// A separate, fail-closed projection for the miniGame. Never rewrites world history.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
export const PENDING_TEXT = '内容审核中';
// Keys whose values are engine identifiers, references or enums. Prose never matches the value pattern below.
const structural = new Set([
  'id', 'agentId', 'worldId', 'map', 'place', 'type', 'status', 'op', 'lang', 'a', 'b', 'actor', 'author', 'owner', 'from', 'to', 'kind', 'vis', 'scope', 'seq', 'hash', 'cursor', 'world', 'publicRoleId',
  'agent', 'agents', 'docId', 'lawId', 'proposalId', 'groupId', 'placeId', 'projectId', 'project', 'offerId', 'order', 'requestId', 'refoundId', 'facilityId', 'inscriptionId',
  'target', 'by', 'law', 'with', 'deceased', 'parents', 'authors', 'children', 'groups', 'members', 'home', 'lot', 'zone', 'replacedBy', 'repealedBy', 'basedOn',
  'outcome', 'origin', 'band', 'district', 'landmark', 'richness', 'phase', 'access', 'build', 'mode', 'types', 'choice', 'direction', 'procedure', 'class', 'code', 'field', 'decision', 'source', 'script', 'module',
]);
const machine = /^[A-Za-z0-9_.:/-]{1,160}$/;
const roleAvatar = /^\/roles\/[a-z]+\.svg$/;
const DAY = 24 * 60 * 60000;
export class WechatProjection {
  constructor(service, { systemTexts = null, file = null } = {}) {
    this.service = service; this.systemTexts = systemTexts; this.file = file;
    this.results = new Map(); this.pending = new Set(); this.queue = []; this.active = 0; this.scheduled = false; this.timer = null;
    this.load();
  }
  key(text, label = false) { return createHash('sha256').update(label ? 'label\0' + text : text).digest('hex'); }
  // Results survive restarts so readers do not fall back to placeholders after every deployment.
  load() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const now = Date.now(), data = JSON.parse(readFileSync(this.file, 'utf8'));
      for (const [key, allowed, until] of Array.isArray(data?.results) ? data.results : []) {
        if (/^[a-f0-9]{64}$/.test(key) && Number.isFinite(until) && until > now) this.results.set(key, { allowed: allowed === 1, until });
      }
    } catch { this.results.clear(); }
  }
  persist() {
    if (!this.file) return;
    const now = Date.now(), results = [];
    for (const [key, r] of this.results) if (r.until > now) results.push([key, r.allowed ? 1 : 0, r.until]);
    try { writeFileSync(this.file + '.tmp', JSON.stringify({ v: 1, results }), { mode: 0o600 }); renameSync(this.file + '.tmp', this.file); } catch { /* the in-memory cache stays authoritative */ }
  }
  schedulePersist() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.persist(); }, 2000);
    this.timer.unref?.();
  }
  flush() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } this.persist(); }
  enqueue(text, identity, label = false) {
    const key = this.key(text, label), result = this.results.get(key);
    if (result?.until > Date.now() || this.pending.has(key) || this.queue.length >= 5000) return;
    try { this.service.requireIdentity(identity); } catch { return; }
    this.pending.add(key); this.queue.push({ key, text, identity, label });
    if (!this.scheduled) { this.scheduled = true; queueMicrotask(() => { this.scheduled = false; this.drain(); }); }
  }
  drain() {
    while (this.active < 2 && this.queue.length) {
      // Short labels get their own verdict: one refused AI paragraph must not hide every resident name.
      const labelIndex = this.queue.findIndex(job => job.label);
      const first = this.queue.splice(labelIndex < 0 ? 0 : labelIndex, 1)[0], jobs = [first]; let chars = Array.from(first.text).length;
      while (!first.label && this.queue.length && !this.queue[0].label && jobs.length < 20 && chars + Array.from(this.queue[0].text).length + 2 <= 2000) {
        const next = this.queue.shift(); chars += Array.from(next.text).length + 2; jobs.push(next);
      }
      this.active++;
      // Batch nearby text to respect the pre-release daily quota. One failed batch is withheld in full.
      this.service.check(jobs.map(job => job.text).join('\n\n'), first.identity, 3).then(() => {
        for (const job of jobs) this.save(job.key, true, DAY);
      }, error => {
        for (const job of jobs) this.save(job.key, false, error.status === 422 ? DAY : 60000);
      }).finally(() => {
        for (const job of jobs) this.pending.delete(job.key);
        this.active--; this.drain();
      });
    }
  }
  save(key, allowed, ttl) {
    if (this.results.size >= 10000) this.results.delete(this.results.keys().next().value);
    this.results.set(key, { allowed, until: Date.now() + ttl });
    this.schedulePersist();
  }
  system(value) {
    if (!this.systemTexts) return false;
    const { texts, patterns } = this.systemTexts();
    return texts.has(value) || patterns.some(pattern => pattern.test(value));
  }
  /** meta.pending counts the strings withheld in this response, so the client knows to ask again shortly. */
  filter(value, identity, key = '', meta = null, label = false) {
    label = label || ['name', 'displayName', 'humanName'].includes(key);
    if (Array.isArray(value)) return value.map(item => this.filter(item, identity, key, meta, label));
    if (key === 'avatar') return typeof value === 'string' && roleAvatar.test(value) ? value : null; // Uploaded images need image moderation first.
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, item]) => [k, this.filter(item, identity, k, meta, label)]));
    if (typeof value !== 'string' || !value.trim()) return value;
    // Only machine identifiers/enum values can bypass prose moderation.
    if (structural.has(key) && machine.test(value)) return value;
    if (this.system(value)) return value;
    const approved = this.results.get(this.key(value, label));
    if (approved?.until > Date.now() && approved.allowed) return value;
    // Previously approved prose is safe to reuse as a label; refused mixed batches are checked independently.
    const previous = label && this.results.get(this.key(value));
    if (previous?.until > Date.now() && previous.allowed) return value;
    this.enqueue(value, identity, label);
    if (meta) meta.pending = (meta.pending || 0) + 1;
    return PENDING_TEXT;
  }
}
