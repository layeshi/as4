// SPEC-M1 §6.5、§7.9 与 SPEC-E2 §10：天象——投票、排期、征兆、开始与结束时的效果（第二纪）。
//
// 时间线：观众在第 M−1 个月里投票，决定第 M 个月的天象；第 M 月开始时（前一日结算的第 13 步）取票数最高者排期，
// 并清空投票开始收集下个月的。第 0 个月没有天象。天象在某个不预告的日子降临，降临前 1–2 日先出现征兆。
// 征兆只以自然语言描述，不透露类型与日期。与第一纪的差别：征兆地点是 w.places 里现有的地点（遗址没有征兆）；
// 观测模块代替观星台；震作用于全部有完好度的地点与全部道路；迁徙潮同时延后排队中的灵魂的期限。

import { P, WEATHER_DEFS, WEATHER_CODES, WEATHER } from '../params.js';
import { L } from '../lore/index.js';
import { clockDay, monthOfDay, agentList } from '../world.js';
import { int, pickWeighted } from '../../rng.js';
import { emit, pushInbox, bad, HASH_RE } from './core.js';
import { applyDamage } from './environment.js';
import { hasModuleAt } from './places.js';
import { hooks } from './hooks.js';

const DEFAULT_WEIGHTS = WEATHER_CODES.map((c) => [c, WEATHER_DEFS[c].weight]);

// ── 投票（命令 weather_vote） ─────────────────────────────────

/**
 * 命令 weather_vote：观众投票决定下一个世界月的天象。每个投票者每月一票，不能改票。
 * 载荷：voterHash（投票者指纹的哈希，由 HTTP 层生成）、type。
 */
export function weatherVote(w, p) {
  if (typeof p.voterHash !== 'string' || !HASH_RE.test(p.voterHash)) return bad('invalid_request', { field: 'voterHash' });
  if (typeof p.type !== 'string' || !WEATHER_CODES.includes(p.type)) return bad('invalid_request', { field: 'type' });
  const v = w.weather.votes;
  if (v.voters.includes(p.voterHash)) return bad('rate_limited', { tallies: { ...v.tallies }, month: v.month });
  v.voters.push(p.voterHash);
  v.tallies[p.type] = (v.tallies[p.type] || 0) + 1;
  return { ok: true, month: v.month, tallies: { ...v.tallies } };
}

// ── 排期（每日结算第 13 步） ──────────────────────────────────

/** 取票数最高者；并列时用 weather 流在并列者中抽取（按天象表的顺序）；无人投票时返回 null */
function voteWinner(w) {
  const tallies = w.weather.votes.tallies;
  let best = 0;
  for (const c of WEATHER_CODES) best = Math.max(best, tallies[c] || 0);
  if (best === 0) return null;
  const tied = WEATHER_CODES.filter((c) => (tallies[c] || 0) === best);
  return tied.length === 1 ? tied[0] : tied[int(w.rng.weather, tied.length)];
}

/**
 * 每个月的第 0 日开始时（前一日结算的第 13 步）：决定这个月的天象并排期，清空投票开始收集下个月的。
 * month 为刚刚开始的那个月（≥ 1）。
 */
export function scheduleMonth(w, month) {
  const rng = w.rng.weather;
  let type;
  let decidedBy;
  let startDom = null;
  if (WEATHER.mode === 'schedule') {
    const entry = WEATHER.schedule.find((s) => s.month === month);
    type = entry ? entry.type : 'calm';
    startDom = entry ? entry.dayOfMonth : null;
    decidedBy = 'schedule';
  } else if (WEATHER.mode === 'random') {
    type = pickWeighted(rng, DEFAULT_WEIGHTS);
    decidedBy = 'random';
  } else {
    type = voteWinner(w);
    decidedBy = 'vote';
    if (type === null) {
      type = pickWeighted(rng, DEFAULT_WEIGHTS);
      decidedBy = 'random';
    }
  }
  const votes = { ...w.weather.votes.tallies };
  w.weather.scheduled = null;
  if (type !== 'calm') {
    if (startDom === null) startDom = 3 + int(rng, 18); // dayOfMonth ∈ [3, 20]
    const lead = 1 + int(rng, 2); // 征兆提前量 ∈ {1, 2}
    const startDay = month * P.daysPerMonth + startDom;
    w.weather.scheduled = { month, type, startDay, lead, decidedBy, votes };
    emit(w, 'weather_scheduled', { vis: 'internal', data: { month, type, startDay, lead, decidedBy } });
  }
  w.weather.votes = { month, tallies: {}, voters: [] };
}

/**
 * 管理接口强行排期一次天象（测试与对照城用）。返回 { ok, scheduled } 或错误。
 * month 缺省为当前月；dayOfMonth 缺省为「今天 + lead + 1」；开始日必须在未来（≥ 明天）。
 */
export function forceWeather(w, { type, month, dayOfMonth, lead }) {
  if (typeof type !== 'string' || !(type in WEATHER_DEFS) || type === 'calm') return bad('invalid_request', { field: 'type' });
  const today = clockDay(w);
  const m = month === undefined || month === null ? monthOfDay(today) : month;
  const ld = lead === undefined || lead === null ? 1 : lead;
  if (!Number.isInteger(m) || m < 0 || !Number.isInteger(ld) || ld < 1 || ld > 3) return bad('invalid_request', { field: 'month' });
  const dom = dayOfMonth === undefined || dayOfMonth === null ? null : dayOfMonth;
  const startDay = dom === null ? today + ld + 1 : m * P.daysPerMonth + dom;
  if (dom !== null && (!Number.isInteger(dom) || dom < 0 || dom >= P.daysPerMonth)) return bad('invalid_request', { field: 'dayOfMonth' });
  if (startDay <= today) return bad('invalid_request', { field: 'dayOfMonth' });
  w.weather.scheduled = { month: monthOfDay(startDay), type, startDay, lead: ld, decidedBy: 'schedule', votes: {} };
  emit(w, 'weather_scheduled', { vis: 'internal', data: { month: monthOfDay(startDay), type, startDay, lead: ld, decidedBy: 'schedule', forced: true } });
  if (startDay - ld <= today) announceOmens(w); // 征兆已经出现了：立即记一条公开事件
  return { ok: true, scheduled: { ...w.weather.scheduled } };
}

// ── 开始与结束（每日结算第 12 步） ────────────────────────────────

const OMEN_ID = (s) => `m${s.month}`;

/** 征兆出现的地点：震在所有（没有成为遗址的）地点，其余各有固定地点（人类的地点，成为遗址后就没有了） */
export function omenPlaces(w, type) {
  const at = WEATHER_DEFS[type].omenPlace;
  if (at === 'all') return Object.values(w.places).filter((p) => !p.razed).map((p) => p.id);
  return at && w.places[at] && !w.places[at].razed ? [at] : [];
}

/** 记下征兆第一次出现的公开事件（地点与文本，不含类型） */
function announceOmens(w) {
  const s = w.weather.scheduled;
  if (!s) return;
  for (const place of omenPlaces(w, s.type)) {
    emit(w, 'omen', {
      place,
      data: { place, omenId: OMEN_ID(s), text: { zh: L('zh').omen[s.type], en: L('en').omen[s.type] } },
    });
  }
}

function notifyAwake(w, code, event) {
  for (const a of agentList(w)) if (a.status === 'awake') pushInbox(w, a, 'weather', { code, event });
}

/** 天象开始时的一次性效果：震、忘川、迁徙潮 */
function startEffects(w, type) {
  if (type === 'quake') {
    // 所有有完好度的地点与全部道路各受损 1000 + floor(2000 × (10000 − 完好度) / 10000) 基点（不低于 0）
    for (const p of Object.values(w.places)) {
      if (p.open || p.condition === null) continue;
      applyDamage(w, p, p.id, p.id, 1000 + Math.floor((2000 * (10000 - p.condition)) / 10000));
    }
    for (const r of Object.values(w.roads)) {
      applyDamage(w, r, r.id, r.a, 1000 + Math.floor((2000 * (10000 - r.condition)) / 10000));
    }
  } else if (type === 'amnesia') {
    // 每个醒着的居民随机遗忘一条记忆（若有）
    for (const a of agentList(w)) {
      if (a.status !== 'awake' || a.memories.length === 0) continue;
      const index = int(w.rng.world, a.memories.length);
      const [gone] = a.memories.splice(index, 1);
      emit(w, 'forget', { vis: 'delayed', agent: a.id, place: a.place, data: { index, text: gone.text, cause: 'amnesia' } });
    }
  } else if (type === 'migration') {
    // 摇篮中每个灵魂的消散期限延后 12 日；排队中的灵魂的排队期限也延后 12 日
    for (const s of Object.values(w.souls)) {
      s.expiresDay += 12;
      if (s.queueExpiresDay !== null && s.queueExpiresDay !== undefined) s.queueExpiresDay += 12;
    }
  }
}

/**
 * 结算第 12 步：结束已到期的天象；若 scheduled.startDay == d + 1，把它加入 active 并执行「开始时」效果；
 * 首次出现的征兆记事件。d 为刚结束的那一日。
 */
export function stepWeather(w, d) {
  const w0 = w.weather;
  const ended = w0.active.filter((x) => x.endDay <= d);
  w0.active = w0.active.filter((x) => x.endDay > d);
  for (const x of ended) {
    emit(w, 'weather_end', { data: { type: x.type, startDay: x.startDay, endDay: x.endDay } });
    notifyAwake(w, x.type, 'end');
    hooks.fire(w, 'weather_end', { weather: x.type });
  }
  const s = w0.scheduled;
  if (s && s.startDay === d + 1) {
    const endDay = s.startDay + WEATHER_DEFS[s.type].duration - 1;
    w0.active.push({ type: s.type, startDay: s.startDay, endDay });
    w0.history.push({ month: s.month, type: s.type, startDay: s.startDay, endDay, decidedBy: s.decidedBy, votes: s.votes });
    w0.scheduled = null;
    w.dayLog.weather.push(s.type);
    emit(w, 'weather_start', { data: { type: s.type, startDay: s.startDay, endDay } });
    notifyAwake(w, s.type, 'start');
    startEffects(w, s.type);
    hooks.fire(w, 'weather_start', { weather: s.type });
  } else if (s && s.startDay - s.lead === d + 1) {
    announceOmens(w);
  }
}

// ── 征兆（不存储，按需计算） ────────────────────────────────────

/**
 * 某地点此刻能看到的征兆：[{ omenId, code, daysAhead }]。code 仅供引擎内部生成文本，绝不进入对外数据。
 * - 普通征兆：startDay − lead ≤ 今日 < startDay，出现在该天象的征兆地点；
 * - 观测：startDay − 3 ≤ 今日 < startDay，身在有运转中的观测模块的地点，能看到征兆文本并附带「约 N 日后」。
 */
export function omensAt(w, placeId) {
  const s = w.weather.scheduled;
  if (!s) return [];
  const place = w.places[placeId];
  if (!place || place.razed) return [];
  const today = clockDay(w);
  if (today >= s.startDay) return [];
  const daysAhead = s.startDay - today;
  const observed = today >= s.startDay - 3 && hasModuleAt(w, placeId, 'sensor');
  const ordinary = today >= s.startDay - s.lead && omenPlaces(w, s.type).includes(placeId);
  if (!observed && !ordinary) return [];
  return [{ omenId: OMEN_ID(s), code: s.type, daysAhead: observed ? daysAhead : null }];
}

/** 观众能看到的：当前有征兆的地点与文本（看不到排期） */
export function visibleOmens(w) {
  const s = w.weather.scheduled;
  if (!s) return [];
  const today = clockDay(w);
  if (today >= s.startDay || today < s.startDay - s.lead) return [];
  return omenPlaces(w, s.type).map((place) => ({ place, omenId: OMEN_ID(s), text: { zh: L('zh').omen[s.type], en: L('en').omen[s.type] } }));
}
