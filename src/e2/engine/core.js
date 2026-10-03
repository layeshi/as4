// 引擎的公共底座：动作级错误、事件产出、收件箱、参数校验器（第二纪，从 v1 复制后修改）。
//
// 事件不在这里落盘：引擎把事件放进世界上一个不可枚举的暂存区（w.$out，不进快照、不进哈希），
// 命令处理完后由 applyCommand 一并取走，交给 events.js（写日志、推送 SSE、延迟释放）。
// 这样引擎本身没有 I/O，回放时只要丢弃取出的事件即可。

import { P } from '../params.js';
import { nextSeq, clockDay } from '../world.js';
import { checkText, textWeight } from '../../text.js';
export { textWeight } from '../../text.js';
import { screen } from '../../moderation.js';

/**
 * 动作级错误（PROTOCOL-2 §2.2）。hint 是可选的 { zh, en } 具体说明；
 * extra 是错误里附带的结构化字段：forbidden 的 law / reason，no_module 的 module，gated 的 place，cooldown 的 untilDay，
 * rule_invalid 的 issues（校验错误的列表，HTTP 层按请求的语言写成 hint 文本）。
 */
export class ActError extends Error {
  constructor(code, hint = null, extra = null) {
    super(code);
    this.name = 'ActError';
    this.code = code;
    this.hint = hint;
    this.extra = extra;
  }
}

export function fail(code, hint, extra) {
  throw new ActError(code, hint, extra);
}

// ── 事件 ───────────────────────────────────────────────────

function hidden(w, key, value) {
  Object.defineProperty(w, key, { value, writable: true, enumerable: false, configurable: true });
}

/** 日终结算期间，事件的 day 记为「刚结束的那一日」d（而不是钟面上已经翻过去的 d+1） */
export function setSettling(w, d) {
  if (!Object.prototype.hasOwnProperty.call(w, '$settling')) hidden(w, '$settling', d);
  else w.$settling = d;
}

/**
 * 产出一个事件（SPEC §10）。
 * vis：public | delayed | owner | internal；delayed 的事件带 releaseTick。
 */
export function emit(w, type, { vis = 'public', agent, place, data = {}, day } = {}) {
  const ev = {
    seq: nextSeq(w, 'event'),
    tick: w.clock.tick,
    day: day ?? w.$settling ?? clockDay(w),
    type,
    vis,
  };
  if (vis === 'delayed') ev.releaseTick = w.clock.tick + P.privateDelayTicks;
  if (agent !== undefined && agent !== null) ev.agent = agent;
  if (place !== undefined && place !== null) ev.place = place;
  ev.data = data;
  if (!Object.prototype.hasOwnProperty.call(w, '$out')) hidden(w, '$out', []);
  w.$out.push(ev);
  return ev;
}

/** 取走并清空暂存的事件 */
export function drainEvents(w) {
  const out = w.$out;
  if (!out || out.length === 0) return [];
  w.$out = [];
  return out;
}

// ── 收件箱（PROTOCOL §5） ───────────────────────────────────

/** 给 agent 的收件箱追加一条，只保留最近 P.inboxKeep 条；溢出时留下一条 system 通知 */
export function pushInbox(w, agent, kind, fields = {}) {
  const item = { seq: nextSeq(w, 'inbox'), tick: w.clock.tick, kind, ...fields };
  agent.inbox.push(item);
  trimInbox(w, agent);
  return item;
}

function trimInbox(w, agent) {
  let dropped = 0;
  while (agent.inbox.length > P.inboxKeep) {
    const old = agent.inbox.shift();
    if (old.seq > agent.inboxCursor && !(old.kind === 'system' && old.code === 'inbox_overflow')) dropped++;
    else if (old.seq > agent.inboxCursor) dropped += old.dropped || 0;
  }
  if (dropped === 0) return;
  // 合并进已有的未读溢出通知，否则新写一条（它自己会占一个位置，再多挤掉一条最旧的）
  const existing = agent.inbox.find((i) => i.kind === 'system' && i.code === 'inbox_overflow' && i.seq > agent.inboxCursor);
  if (existing) {
    existing.dropped += dropped;
    return;
  }
  agent.inbox.push({ seq: nextSeq(w, 'inbox'), tick: w.clock.tick, kind: 'system', code: 'inbox_overflow', dropped });
  trimInbox(w, agent);
}

/** 引用某位 agent 的精简写法 { id, name } */
export const ref = (a) => ({ id: a.id, name: a.name });

// ── 能量入账与唤醒 ──────────────────────────────────────────

/**
 * 唤醒一位沉睡者（SPEC §7.3）：状态变为 awake，记事件 revive 与收件 revived。
 * by：唤醒者 { id, name } 或 { lawId }，无来源时为 null。
 */
export function wake(w, a, by = null) {
  a.status = 'awake';
  a.dormantSinceDay = null;
  emit(w, 'revive', { agent: a.id, place: a.place, data: { agentId: a.id, by } });
  pushInbox(w, a, 'revived', { by });
}

/**
 * 从外部给 agent 入账能量（赠予、拨付、继承、托管退回……）。
 * 沉睡者的能量因此达到 ≥ reviveThreshold 时立即醒来。
 */
export function creditEnergy(w, a, n, by = null) {
  if (n <= 0) return;
  a.energy += n;
  if (a.status === 'dormant' && a.energy >= P.reviveThreshold) wake(w, a, by);
}

// ── 命令级错误（HTTP 400 / 409 / 422 一类，不是动作级） ─────────

/** 命令的载荷不合法：code 为 PROTOCOL §2.1 的请求级错误码 */
export class ReqError extends Error {
  constructor(code, field = null) {
    super(code);
    this.name = 'ReqError';
    this.code = code;
    this.field = field;
  }
}

export const bad = (code, extra = {}) => ({ ok: false, error: { code, ...extra } });

/** 请求级文本校验：格式问题 → invalid_request；审核不过 → moderated */
export function reqText(value, { max, min = 1, field, doScreen = true, oneLine = false } = {}) {
  const r = checkText(value, { max, min });
  if (!r.ok) throw new ReqError('invalid_request', field);
  if (oneLine && r.text.includes('\n')) throw new ReqError('invalid_request', field);
  if (doScreen && r.text !== '' && !screen(r.text).ok) throw new ReqError('moderated', field);
  return r.text;
}

export function reqLang(value, fallback = 'zh', field = 'lang') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > 16 || !LANG_RE.test(value)) throw new ReqError('invalid_request', field);
  return value;
}

export const HASH_RE = /^[0-9a-f]{64}$/;
export function reqHash(value, field) {
  if (typeof value !== 'string' || !HASH_RE.test(value)) throw new ReqError('invalid_request', field);
  return value;
}

// ── 校验器（在动作里使用；失败时抛 ActError） ─────────────────

/**
 * 校验并规范化一段文本。
 * doScreen：公开文本要过内容审核（SPEC §17）；私密文本（日记）不需要。
 */
export function needText(value, { max, min = 1, doScreen = true } = {}) {
  const r = checkText(value, { max, min });
  if (!r.ok) fail(r.code);
  if (doScreen && r.text !== '' && !screen(r.text).ok) fail('moderated');
  return r.text;
}

/** 可选文本：undefined / null 视为缺省 */
export function optText(value, opts) {
  if (value === undefined || value === null) return null;
  return needText(value, { ...opts, min: opts?.min ?? 0 });
}

/** 校验整数（默认正整数） */
export function needInt(value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail('invalid_args');
  return value;
}

/** 可选的非负整数，缺省为 0 */
export function optAmount(value, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null) return 0;
  return needInt(value, { min: 0, max });
}

/** 校验一个非空、非数组的普通对象 */
export function needObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('invalid_args');
  return value;
}

/** 校验字符串（不做文本规范化，用于 ID、枚举） */
export function needId(value) {
  if (typeof value !== 'string' || value === '' || value.length > 64) fail('invalid_args');
  return value;
}

/** 语言标签：BCP-47 风格，如 zh、en、es、zh-Hans */
export const LANG_RE = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}$/;
export function optLang(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > 16 || !LANG_RE.test(value)) fail('invalid_args');
  return value;
}

/** 整数除法：向下取整（SPEC §0.3 第 2 条）。要求 a、b 均为安全整数且 a < 2^53 */
export const idiv = (a, b) => Math.floor(a / b);

/** 千分比乘法：floor(n × permille / 1000) */
export const mulPermille = (n, permille) => Math.floor((n * permille) / 1000);

/** 把 3 位小数的法律参数化为千分比整数 */
export const toPermille = (x) => Math.round(x * 1000);

/** Weight check follows the existing code-point check; callers guard with premised(w). */
export function needWeight(text, field, limit) {
  const weight = textWeight(text);
  if (weight > limit) fail('text_too_long', {
    zh: `${field} 的分量不能超过 ${limit}（现在 ${weight}）。分量 ≈ 汉字、假名、谚文的字数 + 其余字符数 ÷ 3。`,
    en: `The weight of ${field} cannot exceed ${limit} (it is ${weight}). Weight ≈ CJK characters + other characters ÷ 3.`,
  }, { field, limit, weight });
}
