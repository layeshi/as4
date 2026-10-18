// Human-facing notifications are observational side effects, never world commands.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { durableFile } from '../durable-file.js';
import { fail, hasWechatIdentity } from '../accounts/store.js';
import { identityHash } from './service.js';
import { NOTIFICATION_TYPES, notificationTemplates, notificationData } from './notification-config.js';
const DAY = 86400000, RETENTION = 90 * DAY;
export function diaryDeadline(now) {
  // Asia/Shanghai is UTC+08:00; 20:00 local is 12:00 UTC.
  const today = Math.floor(now / DAY) * DAY + 12 * 3600000;
  return now < today ? today : today + DAY;
}
const prefKey = (user, appid, agent) => JSON.stringify([user, appid, agent]);
const recipientKey = (user, appid) => JSON.stringify([user, appid]);
export class NotificationService {
  constructor(ctx, { now = Date.now } = {}) {
    this.ctx = ctx; this.now = now; this.templates = notificationTemplates(ctx.cfg.wechatNotificationTemplates || {});
    this.file = join(ctx.cfg.dataDir, 'resident-notifications.enc');
    this.keyFile = join(ctx.cfg.dataDir, 'resident-notifications.key');
    this.state = { version: 1, preferences: {}, recipients: {}, records: [], tickets: {}, cursors: {} };
    this.closed = false; this.running = null; this.timer = null; this.recovering = false; this.buffer = []; this.candidates = new Map();
    if (existsSync(this.file)) {
      const e = JSON.parse(readFileSync(this.file, 'utf8'));
      this.key = readFileSync(this.keyFile);
      const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(e.iv, 'hex'));
      d.setAuthTag(Buffer.from(e.tag, 'hex'));
      this.state = JSON.parse(Buffer.concat([d.update(Buffer.from(e.data, 'hex')), d.final()]).toString());
      if (this.state.version !== 1) throw new Error('Invalid resident notifications store');
      // A crash after dispatch is ambiguous. Never repeat a potentially delivered message.
      for (const r of this.state.records) if (r.delivery === 'sending') r.delivery = 'unknown';
    }
    this.unsubscribe = ctx.rt.onCommand(({ events }) => {
      if (this.recovering) this.buffer.push(...events);
      else this.ingest(events);
    });
  }
  persist() {
    mkdirSync(this.ctx.cfg.dataDir, { recursive: true });
    if (!this.key) {
      this.key = existsSync(this.keyFile) ? readFileSync(this.keyFile) : randomBytes(32);
      if (!existsSync(this.keyFile)) durableFile(this.keyFile, this.key);
    }
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([c.update(JSON.stringify(this.state)), c.final()]);
    durableFile(this.file, JSON.stringify({ iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), data: data.toString('hex') }));
  }
  relation(agentId) { return this.ctx.rt.w.access?.residents?.[agentId]; }
  owns(userId, agentId, revision) {
    const user = this.ctx.accounts.get(userId), link = this.relation(agentId);
    return !!(user?.status === 'active' && !user.mergePending && link?.managerAccountId === userId && this.ctx.rt.w.agents[agentId] && (revision === undefined || revision === link.ownershipRevision));
  }
  epoch(userId, appid) {
    const user = this.ctx.accounts.get(userId);
    return `${user?.notificationEpoch || 0}:${user?.wechatNotificationEpochs?.[appid] || 0}`;
  }
  validPref(p) { return (p.epoch || '0:0') === this.epoch(p.userId, p.appid) && p.world === this.ctx.rt.w.id && this.owns(p.userId, p.agentId, p.revision); }
  validRecipient(r) {
    const user = this.ctx.accounts.get(r?.userId);
    return !!(user?.status === 'active' && !user.mergePending && (r.epoch || '0:0') === this.epoch(r.userId, r.appid) && hasWechatIdentity(user, r.identity));
  }
  template(kind, appid) {
    const t = this.templates[kind];
    if (t?.appid !== appid) return null;
    try { return this.ctx.wechat.forApp(appid).enabled ? t : null; } catch { return null; }
  }
  candidate(userId, appid, identity) {
    const stored = this.state.recipients[recipientKey(userId, appid)];
    if (stored && this.validRecipient(stored)) return stored;
    if (!identity || identity.appid !== appid) return null;
    this.ctx.wechat.requireIdentity(identity);
    const hash = identityHash(identity.appid, identity.openid);
    const user = this.ctx.accounts.get(userId);
    if (!user || !hasWechatIdentity(user, hash)) fail(403, 'identity_mismatch', '当前微信与账号不匹配。');
    return { userId, appid, epoch: this.epoch(userId, appid), openid: identity.openid, identity: hash, credits: {} };
  }
  get(userId, appid, identity) {
    this.ctx.wechat.forApp(appid);
    this.cleanup();
    let recipient;
    try { recipient = this.candidate(userId, appid, identity); } catch {}
    const types = Object.entries(NOTIFICATION_TYPES).map(([key, label]) => ({ key, label, templateId: this.template(key, appid)?.templateId || null, available: !!this.template(key, appid) }));
    const residents = Object.values(this.state.preferences).filter(p => p.userId === userId && p.appid === appid && this.validPref(p)).map(p => ({ agentId: p.agentId, types: Object.keys(p.types) }));
    const selected = new Set(residents.flatMap(r => r.types));
    return { types, residents, bindingReady: !!recipient && this.validRecipient(recipient), needsAuthorization: types.some(t => selected.has(t.key) && t.available && !(recipient?.credits[t.templateId] > 0)) };
  }
  preferences(userId, appid, agentId, types, identity) {
    this.ctx.wechat.forApp(appid);
    this.cleanup();
    if (!this.owns(userId, agentId)) fail(403, 'forbidden', '你没有此居民的管理权。');
    if (!Array.isArray(types) || types.length > 4 || types.some(t => !Object.hasOwn(NOTIFICATION_TYPES, t))) fail(400, 'invalid_types', '提醒类型无效。');
    const key = prefKey(userId, appid, agentId), previous = this.state.preferences[key];
    const current = previous && this.validPref(previous) ? previous : null;
    const nextTypes = Object.fromEntries([...new Set(types)].map(t => [t, current?.types[t] || { since: this.now(), after: this.ctx.rt.w.counters.event, fault: this.fault(agentId) === t }]));
    const p = { userId, appid, agentId, epoch: this.epoch(userId, appid), world: this.ctx.rt.w.id, revision: this.relation(agentId).ownershipRevision, types: nextTypes };
    this.state.preferences[key] = p;
    for (const r of this.state.records) if (r.pref === key && r.delivery === 'pending' && (!nextTypes[r.kind] || r.revision !== p.revision)) r.delivery = 'cancelled';
    this.persist();
  }
  authorization(userId, appid, types, identity) {
    this.cleanup();
    const r = this.candidate(userId, appid, identity);
    if (!r || !this.validRecipient(r)) fail(401, 'wechat_login_required', '请先使用当前微信登录或关联账号。');
    if (!Array.isArray(types) || types.length > 4 || types.some(t => !Object.hasOwn(NOTIFICATION_TYPES, t))) fail(400, 'invalid_types', '提醒类型无效。');
    const templates = [...new Set(types.map(t => this.template(t, appid)?.templateId).filter(Boolean))];
    if (templates.length > 3) fail(400, 'too_many_templates', '每次最多授权三类微信消息，请分批授权。');
    if (Object.values(this.state.tickets).filter(t => t.userId === userId).length >= 10) fail(429, 'rate_limited', '授权操作过于频繁，请稍后重试。');
    const ticket = randomUUID();
    this.candidates.set(ticket, r);
    this.state.tickets[ticket] = { userId, appid, identity: r.identity, epoch: r.epoch, templates, expires: this.now() + 10 * 60000 };
    this.persist();
    return { ticket, templates };
  }
  authorizationResult(userId, ticket, results) {
    const t = this.state.tickets[ticket], r = t && (this.state.recipients[recipientKey(userId, t.appid)] || this.candidates.get(ticket));
    if (!t || t.userId !== userId || t.expires < this.now() || !r || !this.validRecipient(r) || r.identity !== t.identity || t.epoch !== this.epoch(userId, t.appid)) fail(400, 'invalid_ticket', '授权已过期，请重新操作。');
    if (!results || typeof results !== 'object' || Array.isArray(results) || Object.entries(results).some(([key, value]) => !t.templates.includes(key) || !['accept', 'reject', 'ban'].includes(value))) fail(400, 'invalid_result', '授权结果无效。');
    // Client acceptance is an estimate, not proof. WeChat enforces actual grants on send.
    if (Object.values(results).includes('accept')) this.state.recipients[recipientKey(userId, t.appid)] = r;
    for (const [id, value] of Object.entries(results)) r.credits[id] = value === 'accept' ? Math.min(100, (r.credits[id] || 0) + 1) : 0;
    delete this.state.tickets[ticket]; this.candidates.delete(ticket);
    this.persist();
  }
  add(p, kind, eventKey, createdAt = this.now(), recovered = false) {
    const key = prefKey(p.userId, p.appid, p.agentId);
    if (this.state.records.some(r => r.pref === key && r.eventKey === eventKey)) return;
    const deadline = kind === 'diary' ? diaryDeadline(createdAt) : createdAt;
    const group = kind === 'diary' && this.state.records.find(r => r.pref === key && r.kind === kind && r.revision === p.revision && r.due === deadline && r.delivery === 'pending');
    if (group) { group.count++; group.readAt = null; return; }
    this.state.records.push({ id: randomUUID(), pref: key, world: p.world, userId: p.userId, appid: p.appid, agentId: p.agentId, revision: p.revision, kind, eventKey, createdAt, due: deadline, readAt: null, count: 1, delivery: recovered ? 'unavailable' : 'pending' });
  }
  ingest(events, recovered = false) {
    let changed = this.cleanup(false);
    const world = this.ctx.rt.w.id;
    for (const e of events) {
      if (e.seq <= (this.state.cursors[world] || 0)) continue;
      this.state.cursors[world] = e.seq;
      if (!['death', 'diary'].includes(e.type)) continue;
      const id = e.agent || e.data?.agentId;
      for (const p of Object.values(this.state.preferences)) {
        if (p.agentId !== id || !this.validPref(p) || !p.types[e.type] || e.seq <= p.types[e.type].after) continue;
        this.add(p, e.type, `${world}:${e.seq}`, this.now(), recovered); changed = true;
      }
    }
    if (changed) this.persist();
  }
  fault(agentId) {
    const runners = this.ctx.runners, status = runners.view(agentId).status;
    if (status === 'hosted_balance_low') return 'balance_low';
    if (status === 'hosted_unavailable' || status === 'error' && runners.records[agentId]?.enabled === false) return 'runner_stopped';
    return null;
  }
  runnerChanged(agentId, { recovered = false } = {}) {
    if (this.closed) return;
    let changed = false;
    const kind = this.fault(agentId);
    // Starting/paused/experiment-paused do not prove recovery of an existing fault.
    const healthy = type => recovered === true || Array.isArray(recovered) && recovered.includes(type);
    for (const p of Object.values(this.state.preferences)) {
      if (p.agentId !== agentId || !this.validPref(p)) continue;
      for (const type of ['runner_stopped', 'balance_low']) {
        const setting = p.types[type]; if (!setting) continue;
        if (kind === type) {
          if (!setting.fault) { setting.fault = true; this.add(p, type, randomUUID()); changed = true; }
        } else if (healthy(type) && setting.fault) { setting.fault = false; changed = true; }
      }
    }
    if (changed) this.persist();
  }
  cleanup(save = true) {
    let changed = false;
    for (const [key, p] of Object.entries(this.state.preferences)) if (!this.validPref(p)) { delete this.state.preferences[key]; changed = true; }
    for (const [key, r] of Object.entries(this.state.recipients)) if (!this.validRecipient(r)) {
      delete this.state.recipients[key]; changed = true;
      for (const [pk, p] of Object.entries(this.state.preferences)) if (p.userId === r.userId && p.appid === r.appid) delete this.state.preferences[pk];
    }
    for (const r of this.state.records) if (r.delivery === 'pending' && !this.active(r)) { r.delivery = 'cancelled'; changed = true; }
    const keep = this.state.records.filter(r => this.now() - r.createdAt < RETENTION);
    if (keep.length !== this.state.records.length) { this.state.records = keep; changed = true; }
    for (const [id, t] of Object.entries(this.state.tickets)) if (t.expires < this.now() || t.epoch !== this.epoch(t.userId, t.appid)) { delete this.state.tickets[id]; this.candidates.delete(id); changed = true; }
    if (save && changed) this.persist();
    return changed;
  }
  active(r) {
    const p = this.state.preferences[r.pref];
    return !!(p && this.validPref(p) && p.revision === r.revision && p.types[r.kind]);
  }
  records(userId, { limit = 30, before } = {}) {
    this.cleanup();
    const all = this.state.records.filter(r => r.userId === userId && r.world === this.ctx.rt.w.id && this.owns(userId, r.agentId, r.revision)).slice().reverse();
    let start = 0;
    if (before) { start = all.findIndex(r => r.id === before) + 1; if (!start) fail(400, 'invalid_cursor', '记录分页已过期，请刷新。'); }
    limit = Math.min(100, Math.max(1, Number(limit) || 30));
    return { records: all.slice(start, start + limit).map(r => ({ id: r.id, agentId: r.agentId, kind: r.kind, title: NOTIFICATION_TYPES[r.kind], createdAt: r.createdAt, readAt: r.readAt, delivery: r.delivery === 'sending' ? 'pending' : r.delivery, count: r.count })), hasMore: start + limit < all.length };
  }
  read(userId, ids) {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(x => typeof x !== 'string')) fail(400, 'invalid_ids', '提醒记录参数无效。');
    for (const r of this.state.records) if (ids.includes(r.id) && r.userId === userId && r.world === this.ctx.rt.w.id && this.owns(userId, r.agentId, r.revision)) r.readAt ||= this.now();
    this.persist();
  }
  async deliver(r) {
    if (!this.active(r)) { r.delivery = 'cancelled'; return; }
    const recipient = this.state.recipients[recipientKey(r.userId, r.appid)], template = this.template(r.kind, r.appid);
    if (!template || !recipient || !this.validRecipient(recipient) || !(recipient.credits[template.templateId] > 0)) { r.delivery = 'unavailable'; return; }
    const service = this.ctx.wechat.forApp(r.appid);
    // Token acquisition yields; revalidate all revocable conditions before dispatch.
    let token;
    try { token = await service.accessToken(); } catch { r.delivery = 'failed'; return; }
    if (this.closed || r.delivery !== 'pending' || !this.active(r) || !this.validRecipient(recipient) || this.state.recipients[recipientKey(r.userId, r.appid)] !== recipient || !(recipient.credits[template.templateId] > 0)) { r.delivery = 'cancelled'; return; }
    r.delivery = 'sending'; recipient.credits[template.templateId]--;
    this.persist(); // At-most-once attempt, persisted before external side effect.
    try {
      const data = notificationData(template, { name: this.ctx.rt.w.agents[r.agentId].name, kind: r.kind, createdAt: r.createdAt });
      const result = await service.sendSubscription({ token, openid: recipient.openid, templateId: template.templateId, data, page: `pages/society/index?notification=${encodeURIComponent(r.id)}&agentId=${encodeURIComponent(r.agentId)}`, state: template.state });
      r.delivery = result.errcode === 0 ? 'sent' : result.errcode === 43101 ? 'unavailable' : 'failed';
      if (result.errcode === 43101) recipient.credits[template.templateId] = 0;
    } catch { r.delivery = 'unknown'; }
  }
  pump() {
    if (this.running) return this.running;
    if (this.closed || this.recovering) return Promise.resolve();
    this.running = (async () => {
      let changed = this.cleanup(false);
      for (const p of Object.values(this.state.preferences)) this.runnerChanged(p.agentId);
      for (const r of this.state.records) {
        if (this.closed) break;
        if (r.delivery !== 'pending' || r.due > this.now()) continue;
        // Do not replay a missed daily summary on restart or after a long outage.
        if (this.now() - r.due > (r.kind === 'diary' ? 15 * 60000 : 60 * 60000)) r.delivery = 'unavailable';
        else await this.deliver(r);
        changed = true;
      }
      if (changed) this.persist();
    })().finally(() => { this.running = null; });
    return this.running;
  }
  start() {
    if (!this.starting) this.starting = this.recover();
    return this.starting;
  }
  async recover() {
    const through = this.ctx.rt.w.counters.event;
    this.recovering = true;
    try {
      if (Object.keys(this.state.preferences).length && this.ctx.rt.events.file && existsSync(this.ctx.rt.events.file)) {
        const input = createReadStream(this.ctx.rt.events.file), lines = createInterface({ input, crlfDelay: Infinity });
        try {
          let batch = [];
          for await (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.seq > through) break;
            if (event.seq <= (this.state.cursors[this.ctx.rt.w.id] || 0)) continue;
            batch.push(event);
            if (batch.length >= 1000) { this.ingest(batch, true); batch = []; }
          }
          if (batch.length) this.ingest(batch, true);
        }
        finally { lines.close(); input.destroy(); }
      }
    } finally { this.recovering = false; this.ingest(this.buffer); this.buffer = []; }
    if (this.closed) return;
    await this.pump();
    if (this.closed) return;
    this.timer = setInterval(() => this.pump().catch(() => this.ctx.rt.logger?.error?.('居民提醒处理失败')), 5000);
    this.timer.unref();
  }
  async close() {
    this.closed = true; clearInterval(this.timer); this.unsubscribe();
    if (this.starting) await this.starting;
    if (this.running) await this.running;
  }
}
