import { randomBytes, randomUUID } from 'node:crypto';
import { durableFile } from '../durable-file.js';
import { fail, publicUser, wechatBindings, MAX_LINKS } from './store.js';

// Durable intent lives in accounts.json. Once locked, all steps roll forward;
// each store publishes an idempotent receipt before the accounts unlock.
export class AccountMerger {
  constructor(ctx) { this.ctx = ctx; this.tickets = new Map(); }
  validate(from, to) {
    const { rt, accounts, wechat, hosted } = this.ctx;
    const source = accounts.get(from), target = accounts.get(to);
    if ((rt.w.premise !== 6 && rt.w.premise !== 7)) fail(409, 'merge_unsupported', '当前世界暂不支持账号合并。');
    if (!source || !target || from === to) fail(409, 'same_account', '两端已经是同一个账号，无需合并。');
    if ([source, target].some(u => u.status !== 'active' || u.mergePending || u.mergedTo)) fail(409, 'merge_unavailable', '仅支持两个正常使用的账号合并。');
    if (source.role !== 'user' || !['user', 'admin'].includes(target.role)) fail(409, 'merge_unavailable', '仅支持普通微信账号合入网站账号；管理员账号必须作为保留账号。');
    const bindings = [...wechatBindings(target, wechat.appid), ...wechatBindings(source, wechat.appid)];
    if (bindings.some((b, i) => bindings.some((other, j) => j < i && b.appid === other.appid && b.identity !== other.identity))) fail(409, 'identity_linked', '两个账号已关联该微信应用的不同身份，不能合并。');
    for (const kind of ['email', 'phone']) if (source.contacts?.[kind] && target.contacts?.[kind] && source.contacts[kind] !== target.contacts[kind]) fail(409, 'contact_conflict', '两个账号的已验证联系方式不同，请先解除其中一个。');
    const links = [...(target.agents || []), ...(source.agents || [])].filter((l, i, all) => all.findIndex(x => x.world === l.world && x.agentId === l.agentId) === i);
    if (links.length > MAX_LINKS) fail(409, 'too_many_agents', '合并后的历史居民关联超出账号上限。');
    const b = hosted.billing;
    if (b.fault) fail(503, 'billing_unavailable', '托管账本暂不可用。');
    for (const value of [b.balance(from) + b.balance(to), ...['calls','input','cacheRead','output','costMicro'].map(k => (b.data.accounts[from]?.total[k] || 0) + (b.data.accounts[to]?.total[k] || 0))]) {
      if (!Number.isSafeInteger(value)) fail(409, 'amount_overflow', '合并金额或用量超过支持范围。');
    }
    return { source, target, bindings, links };
  }
  reviewState(from, to) {
    const { rt, hosted } = this.ctx;
    return JSON.stringify([rt.w.id, hosted.billing.balance(from), hosted.billing.balance(to),
      Object.entries(rt.w.access.residents).filter(([, r]) => [from, to].includes(r.managerAccountId) || [from, to].includes(r.creatorAccountId)).map(([id, r]) => [id, r.creatorAccountId, r.managerAccountId, r.ownershipRevision]).sort()]);
  }
  preview(from, to, identity) {
    const { source, target } = this.validate(from, to), { rt, hosted } = this.ctx;
    for (const [key, value] of this.tickets) if (value.until < Date.now()) this.tickets.delete(key);
    if (this.tickets.size >= 1000) fail(429, 'busy', '合并请求较多，请稍后重试。');
    const ticket = randomBytes(32).toString('hex');
    this.tickets.set(ticket, { from, to, sourceRevision: source.revision, targetRevision: target.revision, sourceAuthRevision: source.authRevision || 0, targetAuthRevision: target.authRevision || 0, identity, reviewState: this.reviewState(from, to), until: Date.now() + 5 * 60000 });
    return { ticket, source: publicUser(source), target: publicUser(target),
      residents: Object.values(rt.w.access.residents).filter(r => r.managerAccountId === from).length,
      sourceBalanceMicro: hosted.billing.balance(from), targetBalanceMicro: hosted.billing.balance(to) };
  }
  async confirm(actor, ticket) {
    const proof = this.tickets.get(ticket);
    if (!proof || proof.until < Date.now() || proof.from !== actor.id) fail(409, 'merge_expired', '合并确认已过期，请重新验证两端身份。');
    const { source, target, bindings, links } = this.validate(proof.from, proof.to);
    if (source.revision !== proof.sourceRevision || target.revision !== proof.targetRevision || (source.authRevision || 0) !== proof.sourceAuthRevision || (target.authRevision || 0) !== proof.targetAuthRevision) fail(409, 'account_changed', '账号已更新，请重新验证两端身份。');
    if (proof.reviewState !== this.reviewState(proof.from, proof.to)) fail(409, 'merge_changed', '居民或余额已变化，请重新预览后确认。');
    const { accounts, runners, rt } = this.ctx;
    const plan = { id: randomUUID(), from: source.id, to: target.id, world: rt.w.id, bindings, links,
      runners: Object.keys(runners.records).filter(id => [source.id, target.id].includes(runners.records[id].accountId) && runners.valid(id)) };
    accounts.commit(users => {
      for (const u of users.filter(u => [source.id, target.id].includes(u.id))) { u.mergePending = u.id === target.id ? plan : plan.id; u.revision++; }
    });
    this.tickets.delete(ticket);
    // No new authenticated work can start while these accounts are locked.
    await Promise.all(Object.keys(runners.records).filter(id => [source.id, target.id].includes(runners.records[id].accountId)).map(id => runners.stop(id)));
    this.finish(plan);
    for (const id of plan.runners) if (runners.records[id]?.enabled && runners.serverURL && !runners.closing && ['awake', 'dormant'].includes(rt.w.agents[id]?.status)) {
      try { runners.start(id); } catch { /* Durable merge is complete; resume can be retried from the resident page. */ }
    }
    return { user: publicUser(accounts.get(target.id)), identity: proof.identity };
  }
  recover() {
    for (const u of this.ctx.accounts.data.users) if (u.mergePending && typeof u.mergePending === 'object') this.finish(u.mergePending);
  }
  finish(plan) {
    const { rt, hosted, runners, accounts } = this.ctx;
    if (rt.w.id !== plan.world || (rt.w.premise !== 6 && rt.w.premise !== 7)) throw new Error('Account merge requires its original world');
    hosted.billing.mergeAccounts(plan.id, plan.from, plan.to);
    const result = rt.exec('account', { op: 'merge_accounts', accountId: plan.to, from: plan.from, requestId: plan.id }).result;
    if (!result.ok) throw new Error('Account merge world receipt failed');
    const target = accounts.get(plan.to);
    for (const id of plan.runners) {
      const r = runners.records[id], relation = rt.w.access.residents[id];
      if (r && relation?.managerAccountId === plan.to) { r.accountId = plan.to; r.accountRevision = target.revision; r.ownershipRevision = relation.ownershipRevision; }
    }
    if (plan.runners.length) runners.persist();
    this.mergeUsage(plan.from, plan.to);
    accounts.commit(users => {
      const from = users.find(u => u.id === plan.from), to = users.find(u => u.id === plan.to);
      const [first, ...rest] = plan.bindings;
      to.wechatIdentity = first.identity; to.wechatAppId = first.appid; to.wechatBindings = rest;
      to.contacts = { ...from.contacts, ...to.contacts };
      delete from.contacts;
      to.agents = plan.links;
      to.mergedAccountIds = [...new Set([...(to.mergedAccountIds || []), from.id, ...(from.mergedAccountIds || [])])];
      from.status = 'disabled'; from.mergedTo = to.id; from.agents = [];
      delete from.wechatIdentity; delete from.wechatAppId; delete from.wechatBindings;
      delete from.mergePending; delete to.mergePending;
      from.updatedAt = to.updatedAt = new Date().toISOString();
    });
  }
  mergeUsage(from, to) {
    const store = this.ctx.runners.usage, next = structuredClone(store.agents);
    const sum = (a, b) => {
      const out = structuredClone(a);
      for (const [key, value] of Object.entries(b)) {
        if (typeof value === 'number') out[key] = (out[key] || 0) + value;
        else if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = sum(out[key] || {}, value);
      }
      return out;
    };
    for (const key of Object.keys(next)) if (key.endsWith('@' + from)) {
      const dest = key.slice(0, -from.length) + to, a = next[key], b = next[dest];
      next[dest] = b ? { since: a.since < b.since ? a.since : b.since, total: sum(b.total, a.total), days: sum(b.days, a.days), recent: [...b.recent, ...a.recent].sort((x, y) => x.at.localeCompare(y.at)) } : a;
      delete next[key];
    }
    if (store.file) durableFile(store.file, JSON.stringify({ version: 1, agents: next }));
    store.agents = next;
  }
}
