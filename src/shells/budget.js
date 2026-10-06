// SPEC-E2 §13.3–§13.4：躯壳的用量计量、预留、匀速与硬上限。
//
// 地球日按配置的时区取日历日；用量 = 接口报告的输入 + 输出（没有报告时由调用者估算）；按地球日、按居民、按线路累计，
// 持久化到世界目录的 shells-usage.json（只有数字与日期，不含任何密钥与文本），重启后继续累计。
//
//   B = tokensPerDay × (1 − reserve)
//   每次调用之前：
//     估计 = ceil((系统提示 + 消息的字符数) / 2) + maxTokens
//     若 当日已用 + 已预留 + 估计 > tokensPerDay：本刻不调用（硬上限）
//     n = 醒着的躯壳数（≥ 1）；frac = min(1, (今日已过的毫秒 + tickMs) / 86400000)；fair = B × frac / n
//     若 该居民当日已用 > fair：本刻不调用（匀速）
//     预留 估计；调用；用实际用量替换预留
//
// 这个文件不碰世界状态，时钟与文件都可以注入（测试用假时钟）。

import { safeCallMetadata, cleanPersistedMetadata, boundedCount, cleanDiagnostics, addCallDiagnostics } from '../telemetry-safety.js';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

export const DAY_MS = 86400000;

/** 某个时刻在给定时区里属于哪个日历日，以及这一日已经过去了多少毫秒 */
export function earthDay(nowMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const key = `${String(g('year')).padStart(4, '0')}-${String(g('month')).padStart(2, '0')}-${String(g('day')).padStart(2, '0')}`;
  const msIntoDay = ((g('hour') * 60 + g('minute')) * 60 + g('second')) * 1000 + (((nowMs % 1000) + 1000) % 1000);
  return { key, msIntoDay };
}

/** 一次调用的预估：请求的字符数的一半，加上回复的上限 */
export const estimateTokens = (chars, maxTokens) => Math.ceil(chars / 2) + maxTokens;

/** 接口没有报告用量时的估算：ceil(请求字符数 / 2) + ceil(回复字符数 / 2) */
export const guessTokens = (requestChars, replyChars) => Math.ceil(requestChars / 2) + Math.ceil(replyChars / 2);

export class Budget {
  /**
   * @param o.tokensPerDay 每个地球日的 token 硬上限
   * @param o.reserve      留出的比例（匀速时只分配 B = tokensPerDay × (1 − reserve)）
   * @param o.timezone     地球日的时区
   * @param o.now          () => 毫秒时间戳（测试注入假时钟）
   * @param o.file         持久化文件（null 则不落盘）
   * @param o.onWarn       ({ kind: 'eighty' | 'capped', day, used, tokensPerDay }) => void：每个地球日各至多一次
   */
  constructor({ tokensPerDay, reserve = 0.05, timezone = 'Asia/Shanghai', now = Date.now, file = null, keepDays = 14, onWarn = null }) {
    this.tokensPerDay = tokensPerDay;
    this.reserve = reserve;
    this.timezone = timezone;
    this.now = now;
    this.file = file;
    this.keepDays = keepDays;
    this.onWarn = onWarn;
    this.days = {}; // { 'YYYY-MM-DD': { total, warned: { eighty, capped }, agents: { id: { tokens, calls, lastCallAt, lines } }, lines } }
    this.paused = false; // 管理员的暂停（持久化：重启后仍然暂停）
    this.reservations = new Map(); // ticket → { agentId, est }
    this.reservedTotal = 0;
    this.nextTicket = 1;
    this.load();
  }

  load() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object') this.days = raw.days;
      const cleanAggregate = bucket => {
        if (!bucket || typeof bucket !== 'object' || !Object.hasOwn(bucket, 'diagnostics')) return;
        const diagnostics = cleanDiagnostics(bucket.diagnostics);
        if (diagnostics) bucket.diagnostics = diagnostics;
        else delete bucket.diagnostics;
      };
      for (const d of Object.values(this.days)) {
        cleanAggregate(d);
        for (const a of Object.values(d?.agents || {})) {
          cleanAggregate(a);
          if (Array.isArray(a?.recent)) a.recent = a.recent.slice(-20).map(c => ({ at: Number.isFinite(c?.at) ? c.at : 0, ok: c?.ok !== false, ms: boundedCount(c?.ms), ...cleanPersistedMetadata(c), ...(Number.isInteger(c?.status) && c.status >= 100 && c.status <= 599 ? { status: c.status } : {}) }));
        }
      }
      this.paused = raw.paused === true;
    } catch {
      this.days = {}; // 文件损坏：从零累计（宁可多花，不要停摆）；硬上限仍然按今日的新累计算
    }
  }

  save() {
    const keys = Object.keys(this.days).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - this.keepDays))) delete this.days[k]; // 只留最近 keepDays 个地球日
    if (!this.file) return;
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, tokensPerDay: this.tokensPerDay, paused: this.paused, days: this.days }));
      renameSync(`${this.file}.tmp`, this.file);
    } catch {
      // 落盘失败不影响运行；下一次调用会再试
    }
  }

  /** 今天（按配置的时区） */
  today() {
    return earthDay(this.now(), this.timezone);
  }

  /** 今日的累计记录（不存在则创建） */
  day(key = this.today().key) {
    if (!this.days[key]) this.days[key] = { total: 0, warned: { eighty: false, capped: false }, agents: {}, lines: {} };
    return this.days[key];
  }

  get used() {
    return this.day().total;
  }

  get reserved() {
    return this.reservedTotal;
  }

  /** 某位居民今日的累计：{ tokens, calls, lastCallAt } */
  agentUsage(id) {
    const a = this.day().agents[id];
    return a ? { tokens: a.tokens, calls: a.calls, lastCallAt: a.lastCallAt, ...(a.diagnostics ? { diagnostics: cleanDiagnostics(a.diagnostics) } : {}) } : { tokens: 0, calls: 0, lastCallAt: null };
  }

  /** 全天是否已达到硬上限（已用 ≥ tokensPerDay） */
  get capped() {
    return this.used >= this.tokensPerDay;
  }

  /**
   * 能不能调用：返回 { ok: true } 或 { ok: false, reason: 'hard_cap' | 'pace' }。
   * awake：醒着的躯壳数；tickMs：一刻多少毫秒。
   */
  check(agentId, est, { awake = 1, tickMs = 300000 } = {}) {
    const d = this.day();
    if (d.total + this.reservedTotal + est > this.tokensPerDay) return { ok: false, reason: 'hard_cap' };
    const B = this.tokensPerDay * (1 - this.reserve);
    const frac = Math.min(1, (this.today().msIntoDay + tickMs) / DAY_MS);
    const fair = (B * frac) / Math.max(1, awake);
    const used = d.agents[agentId] ? d.agents[agentId].tokens : 0;
    if (used > fair) return { ok: false, reason: 'pace' };
    return { ok: true };
  }

  /** 预留 est，返回票据 */
  reserveTokens(agentId, est) {
    const ticket = this.nextTicket++;
    this.reservations.set(ticket, { agentId, est });
    this.reservedTotal += est;
    return ticket;
  }

  /** 释放一张票据而不记用量（调用失败） */
  release(ticket) {
    const r = this.reservations.get(ticket);
    if (!r) return;
    this.reservations.delete(ticket);
    this.reservedTotal -= r.est;
  }

  /** 用实际用量替换预留：记入完成这次调用时的地球日、该居民与该线路 */
  settle(ticket, tokens, { line = null } = {}) {
    const r = this.reservations.get(ticket);
    if (!r) return;
    this.release(ticket);
    const today = this.today();
    const d = this.day(today.key);
    const a = (d.agents[r.agentId] ||= { tokens: 0, calls: 0, lastCallAt: null, lines: {} });
    a.tokens += tokens;
    a.calls += 1;
    a.lastCallAt = new Date(this.now()).toISOString();
    d.total += tokens;
    if (line) {
      a.lines[line] = (a.lines[line] || 0) + tokens;
      d.lines[line] = (d.lines[line] || 0) + tokens;
    }
    this.save();
    this.warn(today.key, d);
  }

  /** Observation only; failed/unknown calls do not alter budget settlement. */
  recordCall(agentId, usage, meta = {}) {
    if (meta.cancelled) return;
    const d = this.day();
    const a = (d.agents[agentId] ||= { tokens: 0, calls: 0, lastCallAt: null, lines: {} });
    const recent = (a.recent ||= []);
    const reported = meta.ok !== false && !!usage && (boundedCount(usage.input) !== null || boundedCount(usage.output) !== null);
    addCallDiagnostics(d, meta, reported);
    addCallDiagnostics(a, meta, reported);
    recent.push({ at: this.now(), ok: meta.ok !== false, ms: boundedCount(meta.ms), ...safeCallMetadata(meta, reported) });
    if (recent.length > 20) recent.splice(0, recent.length - 20);
    this.save();
  }

  /** 达到 80% 与 100% 时各告警一次（每个地球日） */
  warn(key, d) {
    if (!this.onWarn) return;
    if (d.total >= this.tokensPerDay && !d.warned.capped) {
      d.warned.capped = true;
      d.warned.eighty = true;
      this.onWarn({ kind: 'capped', day: key, used: d.total, tokensPerDay: this.tokensPerDay });
    } else if (d.total >= this.tokensPerDay * 0.8 && !d.warned.eighty) {
      d.warned.eighty = true;
      this.onWarn({ kind: 'eighty', day: key, used: d.total, tokensPerDay: this.tokensPerDay });
    }
  }

  setPaused(v) {
    this.paused = v === true;
    this.save();
  }

  /** GET /api/admin/shells 的预算部分 */
  view() {
    const today = this.today();
    const d = this.day(today.key);
    return {
      day: today.key, timezone: this.timezone, budget: this.tokensPerDay, usable: Math.floor(this.tokensPerDay * (1 - this.reserve)),
      used: d.total, reserved: this.reservedTotal, capped: d.total >= this.tokensPerDay, lines: { ...d.lines }, ...(d.diagnostics ? { diagnostics: cleanDiagnostics(d.diagnostics) } : {}),
    };
  }
}
