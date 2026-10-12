// A separate, fail-closed projection for the miniGame. Never rewrites world history.
import { createHash } from 'node:crypto';
const structural = new Set(['id', 'agentId', 'worldId', 'map', 'place', 'type', 'status', 'op', 'lang', 'a', 'b', 'actor', 'author', 'owner', 'from', 'to', 'kind', 'vis', 'scope', 'seq', 'hash', 'cursor', 'world', 'publicRoleId']);
export class WechatProjection {
  constructor(service) { this.service = service; this.results = new Map(); this.pending = new Set(); this.queue = []; this.active = 0; this.scheduled = false; }
  key(text) { return createHash('sha256').update(text).digest('hex'); }
  enqueue(text, identity) {
    const key = this.key(text), result = this.results.get(key);
    if (result?.until > Date.now() || this.pending.has(key) || this.queue.length >= 5000) return;
    try { this.service.requireIdentity(identity); } catch { return; }
    this.pending.add(key); this.queue.push({ key, text, identity });
    if (!this.scheduled) { this.scheduled = true; queueMicrotask(() => { this.scheduled = false; this.drain(); }); }
  }
  drain() {
    while (this.active < 2 && this.queue.length) {
      const first = this.queue.shift(), jobs = [first]; let chars = Array.from(first.text).length;
      while (this.queue.length && jobs.length < 20 && chars + Array.from(this.queue[0].text).length + 2 <= 2000) {
        const next = this.queue.shift(); chars += Array.from(next.text).length + 2; jobs.push(next);
      }
      this.active++;
      // Batch nearby text to respect the pre-release daily quota. One failed batch is withheld in full.
      this.service.check(jobs.map(job => job.text).join('\n\n'), first.identity, 3).then(() => {
        for (const job of jobs) this.save(job.key, true, 24 * 60 * 60000);
      }, error => {
        for (const job of jobs) this.save(job.key, false, error.status === 422 ? 24 * 60 * 60000 : 60000);
      }).finally(() => {
        for (const job of jobs) this.pending.delete(job.key);
        this.active--; this.drain();
      });
    }
  }
  save(key, allowed, ttl) {
    if (this.results.size >= 10000) this.results.delete(this.results.keys().next().value);
    this.results.set(key, { allowed, until: Date.now() + ttl });
  }
  filter(value, identity, key = '') {
    if (Array.isArray(value)) return value.map(item => this.filter(item, identity, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, item]) => [k, this.filter(item, identity, k)]));
    if (typeof value !== 'string' || !value.trim()) return value;
    // Only machine identifiers/enum values can bypass prose moderation.
    if (structural.has(key) && /^[A-Za-z0-9_.:/-]{1,160}$/.test(value)) return value;
    const approved = this.results.get(this.key(value));
    if (approved?.until > Date.now() && approved.allowed) return value;
    this.enqueue(value, identity);
    return '内容审核中';
  }
}
