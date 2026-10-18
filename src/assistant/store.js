import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { durableFile } from '../durable-file.js';
import { fail } from '../accounts/store.js';
import { yuanToMicro } from '../hosted/billing.js';

export const TTL = 30 * 86400000;
const defaults = { model: 'gpt-6-luna', dailyQuestions: 20, dailyBudgetYuan: 20, timeoutSeconds: 60 };
export class AssistantStore {
  constructor({ file, now = Date.now }) {
    this.file = file; this.now = now; this.fault = false;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.data = { version: 1, config: { ...defaults }, days: {}, reservations: {}, conversations: [] };
    if (existsSync(file)) {
      try {
        const d = JSON.parse(readFileSync(file, 'utf8'));
        if (d.version !== 1 || !d.config || !d.days || !d.reservations || !Array.isArray(d.conversations)) throw Error();
        this.data = d;
      } catch { throw Error('助手存储无效，请先恢复数据；不会重置预算。'); }
    }
    this.transaction(() => {
      // A crashed process cannot prove that an upstream request was free.
      for (const r of Object.values(this.data.reservations)) {
        const d = this.data.days[r.day]; d.costMicro += r.amountMicro; d.failures++;
      }
      this.data.reservations = {};
      for (const c of this.data.conversations) for (const m of c.messages) if (m.status === 'generating') {
        m.status = 'failed'; m.text = ''; m.error = '服务重启，回答未完成，请重试。';
      }
      this.prune();
    });
  }
  day() { return new Date(this.now() + 8 * 3600000).toISOString().slice(0, 10); }
  resetAt() { return new Date(Date.parse(`${this.day()}T00:00:00+08:00`) + 86400000).toISOString(); }
  transaction(fn) {
    if (this.fault) fail(503, 'storage_unavailable', '助手存储暂不可用。');
    const previous = structuredClone(this.data);
    try { const result = fn(); durableFile(this.file, JSON.stringify(this.data)); return result; }
    catch (error) { this.data = previous; if (!error.status) this.fault = true; throw error; }
  }
  prune() {
    const cutoff = this.now() - TTL;
    for (const c of this.data.conversations) c.messages = c.messages.filter(m => m.at > cutoff);
    const first = new Date(this.now() - 90 * 86400000).toISOString().slice(0, 10);
    for (const day of Object.keys(this.data.days)) if (day < first && !Object.values(this.data.reservations).some(r => r.day === day)) delete this.data.days[day];
  }
  configure(raw) {
    const c = { ...this.data.config };
    if (raw.model !== undefined) { if (typeof raw.model !== 'string' || raw.model.length > 100 || !raw.model.trim()) fail(400, 'invalid_config', '模型无效。'); c.model = raw.model.trim(); }
    if (raw.dailyQuestions !== undefined) { if (!Number.isSafeInteger(raw.dailyQuestions) || raw.dailyQuestions < 0 || raw.dailyQuestions > 1000) fail(400, 'invalid_config', '每天次数须为 0–1000。'); c.dailyQuestions = raw.dailyQuestions; }
    if (raw.dailyBudgetYuan !== undefined) { const micro = yuanToMicro(raw.dailyBudgetYuan); if (micro > 1000000 * 1000000) fail(400, 'invalid_config', '每日预算过大。'); c.dailyBudgetYuan = micro / 1000000; }
    return this.transaction(() => { this.data.config = c; return c; });
  }
  quota(userId) {
    const used = this.data.days[this.day()]?.users[userId] ?? 0, limit = this.data.config.dailyQuestions;
    return { used, limit, remaining: Math.max(0, limit - used), resetAt: this.resetAt() };
  }
  usage() {
    const day = this.day(), d = this.data.days[day] ?? { costMicro: 0, calls: 0, failures: 0 };
    return { day, costYuan: d.costMicro / 1000000, reservedYuan: Object.values(this.data.reservations).filter(r => r.day === day).reduce((n,r)=>n+r.amountMicro,0)/1000000, calls:d.calls, failures:d.failures };
  }
  begin(userId, amountMicro) {
    if (!Number.isSafeInteger(amountMicro) || amountMicro < 0) fail(400, 'invalid_cost', '成本预留无效。');
    if (!this.quota(userId).remaining) fail(429, 'question_limit', `今日次数已用完，${this.resetAt()} 恢复。`);
    const day = this.day(), used = this.usage();
    if (Math.round((used.costYuan + used.reservedYuan)*1000000)+amountMicro > yuanToMicro(this.data.config.dailyBudgetYuan)) fail(429,'budget_exhausted',`今日助手预算不足，${this.resetAt()} 恢复。`);
    return this.transaction(() => {
      const d = this.data.days[day] ||= { users: {}, costMicro: 0, calls: 0, failures: 0 };
      d.users[userId] = (d.users[userId] ?? 0) + 1; d.calls++;
      const r = { id: randomUUID(), userId, day, amountMicro }; this.data.reservations[r.id] = r; return r;
    });
  }
  settle(id, cost, failed = false) {
    const r = this.data.reservations[id]; if (!r) return;
    return this.transaction(() => {
      const d = this.data.days[r.day];
      d.costMicro += Number.isSafeInteger(cost) && cost >= 0 ? cost : r.amountMicro;
      if (failed) d.failures++;
      delete this.data.reservations[id];
    });
  }
  createConversation(userId) {
    this.prune();
    if (this.data.conversations.filter(c=>c.userId===userId).length >= 100) fail(429,'conversation_limit','最多保留 100 段对话，请先删除旧对话。');
    return this.transaction(() => { const c={id:randomUUID(),userId,updatedAt:this.now(),messages:[]};this.data.conversations.push(c);return c; });
  }
  get(userId,id) {
    const c = this.data.conversations.find(c=>c.id===id && c.userId===userId);
    if (!c) fail(404,'not_found','对话不存在。');
    if (c.messages.some(m=>m.at<=this.now()-TTL)) this.transaction(()=>this.prune());
    return this.data.conversations.find(c=>c.id===id && c.userId===userId) ?? { ...c, messages: [] };
  }
  append(id,message) {
    return this.transaction(()=>{const c=this.data.conversations.find(c=>c.id===id);if(!c)fail(404,'not_found','对话不存在。');c.messages.push(message);c.updatedAt=this.now();});
  }
  update(id,messageId,fields) {
    return this.transaction(()=>{const c=this.data.conversations.find(c=>c.id===id),m=c?.messages.find(m=>m.id===messageId);if(m)Object.assign(m,fields);});
  }
  remove(userId,id) {this.get(userId,id);this.transaction(()=>{this.data.conversations=this.data.conversations.filter(c=>c.id!==id);});}
}
