// 托管运行器的 token 用量：按居民累计，只给造者看（GET /api/owner/usage）。
//
// 数据来自 runAgent 的 onUsage：每次调用模型之后，接口报告的 { input, output }（没有报告时为 null）。
// 这里只记数字、日期与模型名——不含提示、回复、密钥，也不含接口返回的错误正文（上游的错误信息可能带出密钥片段）。
// 不进世界状态与命令日志（不影响确定性与回放），持久化到世界目录的 runner-usage.json，重启后继续累计。
//
// 日历日按配置的时区取（与躯壳的「地球日」同一个概念，见 shells/budget.js）。时钟与文件都可以注入（测试用）。

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { earthDay } from '../shells/budget.js';
import { validTimeZone } from '../shells/config.js';

export const DEFAULT_USAGE_TZ = 'Asia/Shanghai';
export const USAGE_DAYS = 14; // 保留与展示的日历日数
export const USAGE_RECENT = 20; // 保留与展示的最近调用条数

const blank = () => ({ calls: 0, failed: 0, unreported: 0, input: 0, output: 0 });
const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const validTime = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

// 文件里读回来的东西不可信（手工改过、版本不同）：每一项都规整成合法的形状，不合法的丢掉。
// 这很重要：GET /api/owner 带着用量，一条坏记录不能让整个幕后页加载失败。
const cleanBucket = (b) => ({ calls: count(b && b.calls) ?? 0, failed: count(b && b.failed) ?? 0, unreported: count(b && b.unreported) ?? 0, input: count(b && b.input) ?? 0, output: count(b && b.output) ?? 0 });
function cleanCall(c) {
  if (!c || typeof c !== 'object' || !validTime(c.at)) return null;
  const ok = c.ok !== false;
  return {
    at: c.at, ok, ...(ok ? { reported: c.reported !== false } : {}), input: count(c.input) ?? 0, output: count(c.output) ?? 0,
    ms: Number.isFinite(c.ms) ? Math.round(c.ms) : null, model: String(c.model ?? '').slice(0, 100), ...(Number.isInteger(c.status) && c.status > 0 ? { status: c.status } : {}),
  };
}
const withTokens = (b) => ({ ...b, tokens: b.input + b.output });

/** 'YYYY-MM-DD' 往前数 n 天（纯日历运算，与时区无关，不受夏令时影响） */
function dayBefore(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/** 接口报告的用量 → { input, output }；没有报告（或全是无效数字）时为 null。只报告了一项时，另一项记 0 */
function reported(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const input = count(usage.input);
  const output = count(usage.output);
  return input === null && output === null ? null : { input: input ?? 0, output: output ?? 0 };
}

export class UsageStore {
  /**
   * @param o.file      持久化文件（null 则不落盘）
   * @param o.timezone  日历日的时区；无效时退回缺省值
   * @param o.now       () => 毫秒时间戳（测试注入假时钟）
   */
  constructor({ file = null, timezone = DEFAULT_USAGE_TZ, now = Date.now } = {}) {
    this.file = file;
    this.timezone = typeof timezone === 'string' && validTimeZone(timezone) ? timezone : DEFAULT_USAGE_TZ;
    this.now = now;
    this.agents = Object.create(null); // { agentId: { since, total, days: { 'YYYY-MM-DD': bucket }, recent: [call] } }；无原型，id 取什么名字都不会碰到 Object.prototype
    this.load();
  }

  load() {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object' && raw.agents && typeof raw.agents === 'object' && !Array.isArray(raw.agents)) {
        for (const [id, a] of Object.entries(raw.agents)) {
          if (!a || typeof a !== 'object') continue;
          const days = Object.create(null);
          if (a.days && typeof a.days === 'object' && !Array.isArray(a.days)) for (const [k, b] of Object.entries(a.days)) if (DAY_KEY.test(k)) days[k] = cleanBucket(b);
          const recent = Array.isArray(a.recent) ? a.recent.map(cleanCall).filter(Boolean).slice(-USAGE_RECENT) : [];
          this.agents[id] = { since: validTime(a.since) ? a.since : new Date(this.now()).toISOString(), total: cleanBucket(a.total), days, recent };
        }
      }
    } catch {
      this.agents = Object.create(null); // 文件损坏：从零累计，不要让运行器停摆
    }
  }

  save() {
    if (!this.file) return;
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, agents: this.agents }), { mode: 0o600 });
      renameSync(`${this.file}.tmp`, this.file);
    } catch {
      // 落盘失败不影响运行；下一次调用会再试
    }
  }

  /**
   * 记一次模型调用。
   * usage：接口报告的 { input, output } 或 null；meta：{ ok, ms?, error? }（runAgent 的 onUsage 的第三个参数）；model：当时配置的模型名。
   * 失败的调用只记 HTTP 状态码（有的话）：不记错误信息。
   */
  record(id, usage, meta = {}, model = '') {
    const at = this.now();
    const ok = meta.ok !== false;
    const used = ok ? reported(usage) : null;
    const today = earthDay(at, this.timezone).key;
    const a = (this.agents[id] ||= { since: new Date(at).toISOString(), total: blank(), days: Object.create(null), recent: [] });
    const day = (a.days[today] ||= blank());
    for (const b of [a.total, day]) {
      b.calls += 1;
      if (!ok) b.failed += 1;
      else if (!used) b.unreported += 1;
      if (used) {
        b.input += used.input;
        b.output += used.output;
      }
    }
    const status = !ok && Number.isInteger(meta.error && meta.error.status) ? meta.error.status : null;
    a.recent.push({
      at: new Date(at).toISOString(), ok, ...(ok ? { reported: !!used } : {}), input: used ? used.input : 0, output: used ? used.output : 0,
      ms: Number.isFinite(meta.ms) ? Math.round(meta.ms) : null, model: String(model || '').slice(0, 100), ...(status ? { status } : {}),
    });
    if (a.recent.length > USAGE_RECENT) a.recent.splice(0, a.recent.length - USAGE_RECENT);
    const keep = new Set(Array.from({ length: USAGE_DAYS }, (_, i) => dayBefore(today, i)));
    for (const k of Object.keys(a.days)) if (!keep.has(k)) delete a.days[k];
    this.save();
  }

  has(id) {
    return Object.prototype.hasOwnProperty.call(this.agents, id);
  }

  ids() {
    return Object.keys(this.agents);
  }

  /** 忘掉一位居民的用量（过继、移除托管、记录失效） */
  drop(id) {
    if (!this.has(id)) return;
    delete this.agents[id];
    this.save();
  }

  /**
   * 一位居民的用量视图：累计、今日、最近 USAGE_DAYS 个日历日（补零，从早到晚）、最近的调用（从早到晚）。
   * 没有任何调用时 since 为 null。tokens = input + output。
   */
  view(id) {
    const a = this.has(id) ? this.agents[id] : null;
    const today = earthDay(this.now(), this.timezone).key;
    const days = Array.from({ length: USAGE_DAYS }, (_, i) => dayBefore(today, USAGE_DAYS - 1 - i)).map((day) => ({ day, ...withTokens((a && a.days[day]) || blank()) }));
    return {
      timezone: this.timezone, day: today, since: a ? a.since : null,
      total: withTokens(a ? a.total : blank()),
      today: days[days.length - 1],
      days,
      recent: a ? a.recent.map((c) => ({ ...c })) : [],
    };
  }
}
