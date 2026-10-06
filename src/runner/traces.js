// 注意力轨迹（SPEC-P2 §14.1）：运行器每次醒来（含被叫醒）结束时回报一条记录，这里追加到世界目录的 agent-loops.jsonl，
// 并按地球日汇总：公开的日平均（没有逐位居民的数据）与管理员的逐位汇总。
//
// 记录里没有任何文本：不含提示、回复、独白，也不含动作参数的值。回报来的 rec 里凡是模型能影响的字符串（看了哪一段、动作的类型、错误码）
// 一律只认已知的名字，其余记作 other——所以即便模型把一句话塞进 what 或 type，文件里也不会有它。
// 文件的每一行：{ at, day, agentId, model, tick, kind, mode, turns, looks, acts, ended, tokens, ms }。day 按配置的时区取地球日（SHELL_TZ）；
// model 只进这个文件与管理接口，不进任何公开接口。不进世界状态与命令日志（不影响确定性与回放）。

import { existsSync, readFileSync, writeFileSync, appendFileSync, renameSync } from 'node:fs';
import { earthDay } from '../shells/budget.js';
import { validTimeZone } from '../shells/config.js';
import { LOOK_WHATS } from '../../runner/render-p2.js';
import { ACTION_ORDER_P2 } from '../e2/lore/actions.js';
import { safeErrorCode } from '../telemetry-safety.js';

export const TRACE_TZ = 'Asia/Shanghai';
export const TRACE_KEEP_DAYS = 30;

const KINDS = new Set(['main', 'wake']);
const MODES = new Set(['native', 'json']);
const ENDED = new Set(['end', 'reply', 'actions', 'turns', 'deadline', 'budget', 'error', 'refusal', 'asleep', 'paused', 'format']);
const SECTIONS = new Set(LOOK_WHATS);
const ACTIONS = new Set(ACTION_ORDER_P2);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

const count = (v, max = 1e9) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : 0);
const errorCode = safeErrorCode;
const plus = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const round2 = (x) => Math.round(x * 100) / 100;
const agentOrder = (a, b) => {
  const na = Number(String(a).replace(/\D/g, ''));
  const nb = Number(String(b).replace(/\D/g, ''));
  return na !== nb ? na - nb : a < b ? -1 : a > b ? 1 : 0;
};

/** 'YYYY-MM-DD' 往前数 n 天（纯日历运算，与时区无关） */
function dayBefore(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

/** 一条回报 → 文件里的一行里「rec」那一部分：每个字段都规整成合法的形状，不认识的字符串记作 other */
export function cleanRecord(rec) {
  const r = rec && typeof rec === 'object' ? rec : {};
  return {
    tick: count(r.tick),
    kind: KINDS.has(r.kind) ? r.kind : 'main',
    mode: MODES.has(r.mode) ? r.mode : 'json',
    turns: count(r.turns, 1000),
    looks: (Array.isArray(r.looks) ? r.looks : []).slice(0, 200).map((x) => {
      const [what, id] = String(x).split(':');
      if (!SECTIONS.has(what)) return 'other';
      // 轨迹保留看过的具体条目；只接受城内编号，不能把模型给出的文本写进文件。
      return id && /^[lpg][1-9]\d{0,11}$/.test(id) ? `${what}:${id}` : what;
    }),
    acts: (Array.isArray(r.acts) ? r.acts : []).slice(0, 200).map((a) => {
      const o = a && typeof a === 'object' ? a : {};
      return { type: ACTIONS.has(o.type) ? o.type : 'other', ok: o.ok === true, ...(o.ok === true ? {} : { error: errorCode(o.error) }) };
    }),
    ended: ENDED.has(r.ended) ? r.ended : 'other',
    tokens: { in: count(r.tokens && r.tokens.in), out: count(r.tokens && r.tokens.out) },
    ms: count(r.ms),
  };
}

const blank = () => ({ model: '', wakings: 0, wakes: 0, turns: 0, looks: {}, acts: 0, ended: {}, tokens: { in: 0, out: 0 } });

function add(into, line) {
  into.wakings += 1;
  if (line.kind === 'wake') into.wakes += 1;
  into.turns += line.turns;
  for (const s of line.looks) plus(into.looks, s.split(':')[0]);
  into.acts += line.acts.length;
  plus(into.ended, line.ended);
  into.tokens.in += line.tokens.in;
  into.tokens.out += line.tokens.out;
}

export class TraceStore {
  /**
   * @param o.file      agent-loops.jsonl（null 则只在内存里）
   * @param o.timezone  地球日的时区；无效时退回缺省值
   * @param o.keepDays  保留的天数（含今天）
   * @param o.now       () => 毫秒时间戳（测试注入假时钟）
   */
  constructor({ file = null, timezone = TRACE_TZ, keepDays = TRACE_KEEP_DAYS, now = Date.now } = {}) {
    this.file = file;
    this.timezone = typeof timezone === 'string' && validTimeZone(timezone) ? timezone : TRACE_TZ;
    this.keepDays = keepDays;
    this.now = now;
    this.days = new Map(); // day → Map<agentId, 汇总>
    this.lastPrune = null; // 最后一次修剪文件的日子
    this.load();
  }

  today() {
    return earthDay(this.now(), this.timezone).key;
  }

  /** 保留的最早一天（含） */
  cutoff() {
    return dayBefore(this.today(), this.keepDays - 1);
  }

  /** 读入文件里最近 keepDays 天的行，做汇总缓存；坏行、过期的行丢掉 */
  load() {
    if (!this.file || !existsSync(this.file)) return;
    const cutoff = this.cutoff();
    for (const row of readFileSync(this.file, 'utf8').split('\n')) {
      if (!row.trim()) continue;
      let line;
      try {
        line = JSON.parse(row);
      } catch {
        continue;
      }
      if (!line || typeof line !== 'object' || typeof line.day !== 'string' || !DAY_KEY.test(line.day) || line.day < cutoff || typeof line.agentId !== 'string') continue;
      this.tally(line.day, String(line.agentId).slice(0, 40), String(line.model ?? '').slice(0, 100), cleanRecord(line));
    }
  }

  tally(day, agentId, model, rec) {
    if (!this.days.has(day)) this.days.set(day, new Map());
    const agents = this.days.get(day);
    if (!agents.has(agentId)) agents.set(agentId, blank());
    const a = agents.get(agentId);
    if (model) a.model = model;
    add(a, rec);
  }

  /** 每天第一次写入时，把超过 keepDays 天的行删去（重写文件）；缓存里的旧日子也丢掉 */
  prune(today) {
    this.lastPrune = today;
    const cutoff = this.cutoff();
    for (const day of [...this.days.keys()]) if (day < cutoff) this.days.delete(day);
    if (!this.file || !existsSync(this.file)) return;
    const keep = readFileSync(this.file, 'utf8').split('\n').filter((row) => {
      if (!row.trim()) return false;
      try {
        const line = JSON.parse(row);
        return !!line && typeof line === 'object' && typeof line.day === 'string' && DAY_KEY.test(line.day) && line.day >= cutoff && typeof line.agentId === 'string';
      } catch {
        return false;
      }
    });
    writeFileSync(`${this.file}.tmp`, keep.length ? `${keep.join('\n')}\n` : '');
    renameSync(`${this.file}.tmp`, this.file);
  }

  /** 追加一行。rec 是运行器的 onWaking 回报；写不下去（磁盘）不影响运行 */
  append(agentId, rec, model = '') {
    const at = this.now();
    const day = earthDay(at, this.timezone).key;
    const id = String(agentId).slice(0, 40);
    const m = String(model || '').slice(0, 100);
    const clean = cleanRecord(rec);
    try {
      if (this.lastPrune !== day) this.prune(day);
      if (this.file) appendFileSync(this.file, `${JSON.stringify({ at: new Date(at).toISOString(), day, agentId: id, model: m, ...clean })}\n`);
    } catch {
      // 落盘失败不影响运行：汇总照常
    }
    this.tally(day, id, m, clean);
  }

  /**
   * 公开的日平均：{ day, residents, wakingsPerResident, turnsPerWaking, looksPerWaking, wakesPerResident, sections: { 段: 占比（千分比） } }。
   * residents 是当天有过醒来的居民数；没有数据的一天全是 0。没有逐位居民的数据，也没有模型名。
   */
  daySummary(day) {
    const agents = this.days.get(day);
    const out = { day, residents: 0, wakingsPerResident: 0, turnsPerWaking: 0, looksPerWaking: 0, wakesPerResident: 0, sections: {} };
    if (!agents || agents.size === 0) return out;
    const total = blank();
    for (const a of agents.values()) {
      total.wakings += a.wakings;
      total.wakes += a.wakes;
      total.turns += a.turns;
      for (const [s, n] of Object.entries(a.looks)) plus(total.looks, s, n);
    }
    const looks = Object.values(total.looks).reduce((n, x) => n + x, 0);
    out.residents = agents.size;
    out.wakingsPerResident = round2(total.wakings / agents.size);
    out.turnsPerWaking = round2(total.turns / total.wakings);
    out.looksPerWaking = round2(looks / total.wakings);
    out.wakesPerResident = round2(total.wakes / agents.size);
    for (const [s, n] of Object.entries(total.looks).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))) out.sections[s] = Math.round((n * 1000) / looks);
    return out;
  }

  /** 最近 n 天（含今天）的日平均，从早到晚 */
  recent(n) {
    const today = this.today();
    return Array.from({ length: n }, (_, i) => this.daySummary(dayBefore(today, n - 1 - i)));
  }

  /** 管理员的逐位汇总：{ day, agents: [{ agentId, model, wakings, wakes, turns, looks, acts, ended, tokens }], totals }（不含任何文本） */
  agentsDay(day) {
    const agents = this.days.get(day) || new Map();
    const list = [...agents.entries()].sort(([a], [b]) => agentOrder(a, b)).map(([agentId, a]) => ({ agentId, ...structuredClone(a) }));
    const totals = { agents: list.length, wakings: 0, wakes: 0, turns: 0, looks: {}, acts: 0, ended: {}, tokens: { in: 0, out: 0 } };
    for (const a of list) {
      totals.wakings += a.wakings;
      totals.wakes += a.wakes;
      totals.turns += a.turns;
      totals.acts += a.acts;
      for (const [k, n] of Object.entries(a.looks)) plus(totals.looks, k, n);
      for (const [k, n] of Object.entries(a.ended)) plus(totals.ended, k, n);
      totals.tokens.in += a.tokens.in;
      totals.tokens.out += a.tokens.out;
    }
    return { day, agents: list, totals };
  }
}
