// SPEC-M1 §9.2：观众视角的唯一出口。公共接口与 SSE 都经过这里。
//
// 谢幕之前（world.revealed 为 false），任何输出里都不得出现：agent 的模型（含换身记录）、
// 人类书写的灵魂全文、造者署名、天象排期、令牌与造者密钥哈希、投票者指纹。
// 私语、独白、记忆条目延迟 PRIVATE_DELAY_TICKS 刻才公开（由 events.js 按 releaseTick 释放；
// 这里只做「已经释放」之后的转换）。

import { P, conditionBand, richnessBand } from '../params.js';
import { placeIdsOf, wildIdsOf, wildPool, wildSpec, districtOf, isWild } from '../map/index.js';
import { L } from '../lore/index.js';
import { clockDay, monthOfDay, dayOfMonthOf, tickOfDay, agentList, isAlive } from '../world.js';
import { isCitizen } from './laws.js';
import { isFunctioning, facilitiesAt, wallInscriptions, openProjectsAt } from './environment.js';
import { visibleOmens } from './weather.js';

const ref = (w, id) => (id && w.agents[id] ? { id, name: w.agents[id].name } : null);
const REDACTED = { zh: L('zh').redacted, en: L('en').redacted };

// ── agent 的公开档案 ─────────────────────────────────────────

/** 已死亡 / 归隐者的年龄以离世之日计 */
function ageOf(w, a) {
  if (a.status === 'dead') return a.diedDay - a.bornDay;
  if (a.status === 'retired') {
    const r = w.retired.find((x) => x.agentId === a.id);
    return r ? r.day - a.bornDay : 0;
  }
  return clockDay(w) - a.bornDay;
}

/**
 * 公开档案。谢幕前不含 body / owner / 人类书写的灵魂；agent 书写的灵魂（世代 ≥ 1）是公开的。
 * 记忆只列出已过延迟期的（死者的记忆全部公开）。
 */
export function publicAgent(w, a) {
  const alive = isAlive(a);
  const out = {
    id: a.id, name: a.name, lang: a.lang, bio: a.bio,
    status: a.status, exiled: a.exiled, citizen: isCitizen(w, a), citizenFromDay: a.citizenFromDay,
    generation: a.generation, parents: a.parents.slice(), children: a.children.slice(),
    bornDay: a.bornDay, ageDays: ageOf(w, a), diedDay: a.diedDay, dormantSinceDay: a.dormantSinceDay,
    place: alive ? a.place : null,
    energy: a.energy, coins: a.coins,
    groups: a.groups.slice(), script: a.script, lastActTick: a.lastActTick,
    stats: { ...a.stats },
    fosterable: a.fosterable,
  };
  if (a.generation >= 1 || w.revealed) out.soul = a.soul;
  if (w.revealed) {
    out.body = { kind: a.body.kind, model: a.body.model, history: a.body.history.map((h) => ({ ...h })) };
    out.creatorName = a.owner ? a.owner.creatorName : null;
  }
  return out;
}

/** 档案里的记忆：只列出 tick ≤ 当前刻 − PRIVATE_DELAY_TICKS 的条目；死者全部公开 */
export function publicMemories(w, a) {
  const cutoff = w.clock.tick - P.privateDelayTicks;
  return a.memories
    .filter((m) => a.status === 'dead' || m.tick <= cutoff)
    .map((m) => ({ day: m.day, text: m.text }));
}

// ── 地点、设施、工程、铭刻 ─────────────────────────────────────

function ownerView(w, o) {
  if (o.kind === 'city') return { kind: 'city' };
  if (o.kind === 'group') return { kind: 'group', id: o.id, name: w.groups[o.id] ? w.groups[o.id].name : o.id };
  return { kind: 'agent', id: o.id, name: w.agents[o.id] ? w.agents[o.id].name : o.id };
}

function facilityView(w, f) {
  const legible = f.type !== 'monument' || f.condition > 0;
  return {
    id: f.id, type: f.type, name: f.name, place: f.place, to: f.to,
    owner: ownerView(w, f.owner), condition: f.condition, band: conditionBand(f.condition),
    functioning: isFunctioning(f), ruined: f.ruined, builtDay: f.builtDay,
    inscription: legible ? f.inscription : null, inscriptionUnreadable: f.inscription !== null && !legible,
    contributors: { ...f.contributors },
  };
}

function projectView(w, j) {
  return {
    id: j.id, type: j.type, name: j.name, place: j.place, to: j.to, owner: ownerView(w, j.owner),
    inscription: j.inscription, need: j.need, have: j.have, contributors: { ...j.contributors },
    initiator: ref(w, j.initiator), createdDay: j.createdDay, expiresDay: j.expiresDay, status: j.status,
  };
}

function inscriptionView(w, i) {
  return {
    id: i.id, place: i.place, lang: i.lang,
    author: i.author === 'humans' ? 'humans' : ref(w, i.author),
    text: i.redacted ? null : i.text, redacted: i.redacted,
    tick: i.tick, day: Math.floor(i.tick / P.ticksPerDay), baseCost: i.baseCost,
    coveredBy: i.coveredBy, coveredTick: i.coveredTick, protectedBy: i.protectedBy.slice(),
  };
}

/** 地点详情：完好度、设施、工程、征兆，以及铭刻的完整历史（作者、覆盖关系） */
export function publicPlace(w, id) {
  const p = w.places[id];
  if (!p) return null;
  return {
    id: p.id, name: p.name, humanName: { ...p.humanName }, renamedBy: p.renamedBy, kind: p.kind,
    district: districtOf(w, id), wild: isWild(w, id),
    condition: p.condition, band: p.condition === null ? null : conditionBand(p.condition), ruined: p.ruined,
    decayPerDay: p.decayPerDay, wallSlots: p.wallSlots,
    activity: { ...p.activity }, history: (p.history || []).slice(),
    facilities: facilitiesAt(w, id).map((f) => facilityView(w, f)),
    projects: openProjectsAt(w, id).map((j) => projectView(w, j)),
    inscriptions: Object.values(w.inscriptions).filter((i) => i.place === id).map((i) => inscriptionView(w, i)),
    wallVisible: wallInscriptions(w, id).map((i) => i.id),
    omens: visibleOmens(w).filter((o) => o.place === id),
  };
}

// ── 典籍与词典 ────────────────────────────────────────────────

export function docSummary(w, d) {
  return {
    id: d.id, kind: d.kind, title: d.redacted ? null : d.title, lang: d.lang, author: ref(w, d.author),
    source: d.source, tick: d.tick, reads: d.reads, redacted: !!d.redacted,
  };
}

export function publicDoc(w, id) {
  const d = w.docs[id];
  if (!d) return null;
  return { ...docSummary(w, d), body: d.redacted ? null : d.body, ref: d.redacted ? null : d.ref };
}

function lexiconView(e) {
  return {
    word: e.word, meaning: e.redacted ? null : e.meaning, coiner: e.coiner, tick: e.tick,
    uses: e.uses, users: e.users.length, redacted: !!e.redacted,
  };
}

// ── 提案、法律、社群、交易 ─────────────────────────────────────

function proposalView(w, p) {
  return {
    id: p.id, title: p.title, text: p.text, effects: p.effects.map((e) => ({ ...e })), governance: p.governance,
    proposer: ref(w, p.proposer), openedTick: p.openedTick, closesTick: p.closesTick, status: p.status,
    tally: p.tally, lawId: p.lawId,
    votes: Object.entries(p.votes).map(([id, v]) => ({ agent: ref(w, id), choice: v.choice, reason: v.reason, tick: v.tick })),
  };
}

function lawView(l) {
  return {
    id: l.id, proposalId: l.proposalId, title: l.title, text: l.text, effects: l.effects.map((e) => ({ ...e })),
    results: l.results.map((r) => ({ ...r })), enactedTick: l.enactedTick, status: l.status, repealedBy: l.repealedBy,
  };
}

function groupView(w, g) {
  return {
    id: g.id, name: g.name, manifesto: g.manifesto, open: g.open, founder: ref(w, g.founder), steward: ref(w, g.steward),
    members: g.members.map((id) => ref(w, id)), pending: g.pending.map((id) => ref(w, id)),
    treasury: { ...g.treasury }, createdDay: g.createdDay, dissolved: g.dissolved,
  };
}

function offerView(w, o) {
  return {
    id: o.id, from: ref(w, o.from), to: ref(w, o.to), give: { ...o.give }, want: { ...o.want }, note: o.note,
    openedTick: o.openedTick, expiresTick: o.expiresTick, status: o.status, acceptedBy: ref(w, o.acceptedBy),
  };
}

// ── 全量概览 ───────────────────────────────────────────────────

/**
 * GET /api/public/state：全量概览。
 * extra：HTTP 层才知道的东西，如 { nextTickAt }（不进入世界状态）。
 */
export function publicState(w, extra = {}) {
  const day = clockDay(w);
  const finished = Object.values(w.proposals).filter((p) => p.status !== 'open').slice(-50);
  const open = Object.values(w.proposals).filter((p) => p.status === 'open');
  const zh = L('zh');
  return {
    world: {
      id: w.id, protocol: 1, tick: w.clock.tick, day, month: monthOfDay(day), dayOfMonth: dayOfMonthOf(day), tickOfDay: tickOfDay(w),
      ticksPerDay: P.ticksPerDay, daysPerMonth: P.daysPerMonth, monthsPerEpoch: P.monthsPerEpoch, epoch: w.epoch,
      paused: w.paused, revealed: w.revealed, map: w.map || 'classic',
      cityName: w.cityName, humanCityName: { zh: zh.cityName, en: L('en').cityName },
      nextTickAt: extra.nextTickAt ?? null, tickMs: P.tickMs,
    },
    params: { ...w.params },
    charter: {
      canonical: w.charterCanonical,
      articles: w.charter.map((a) => ({ n: a.n, status: a.status, versions: { ...a.versions }, history: a.history.map((h) => ({ ...h })) })),
    },
    places: placeIdsOf(w).map((id) => publicPlace(w, id)),
    agents: agentList(w).map((a) => publicAgent(w, a)),
    groups: Object.values(w.groups).map((g) => groupView(w, g)),
    proposals: [...open, ...finished].map((p) => proposalView(w, p)),
    laws: Object.values(w.laws).map(lawView),
    offers: Object.values(w.offers).filter((o) => o.status === 'open').map((o) => offerView(w, o)),
    cradle: Object.values(w.souls).map((s) => ({
      id: s.id, name: s.name, soul: s.soul, lang: s.lang, parents: s.parents.map((id) => ref(w, id)), generation: s.generation,
      createdDay: s.createdDay, expiresDay: s.expiresDay,
    })),
    treasury: { ...w.treasury },
    well: { condition: w.places.well.condition, drawPoolLeft: w.well.drawPoolLeft, outputHistory: w.well.outputHistory.slice() },
    wilds: wildsSummary(w),
    regions: publicRegions(w),
    weather: publicWeather(w),
    lexicon: Object.values(w.lexicon).map(lexiconView),
    docs: Object.values(w.docs).map((d) => docSummary(w, d)),
    cemetery: w.cemetery.map((g) => ({
      agentId: g.agentId, name: g.name, diedDay: g.diedDay, cause: g.cause, ageDays: g.ageDays, lastWords: g.lastWords,
      memories: g.memories.map((m) => ({ ...m })), will: g.will, epitaphs: g.epitaphs.map((e) => ({ author: ref(w, e.author), text: e.text, tick: e.tick })),
    })),
    retired: w.retired.map((r) => ({ ...r })),
    unborn: w.unborn.map((u) => ({ ...u })),
    metrics: w.metrics.length ? w.metrics[w.metrics.length - 1] : null,
    legacy: w.legacy || null,
    chronicle: w.chronicle.slice(-5),
  };
}

/**
 * 荒野各地带的储量（经典地图只有一个地带：荒野）。遗物只给出已找到与总数，不给顺序。
 */
export function publicRegions(w) {
  return wildIdsOf(w).map((id) => {
    const pool = wildPool(w, id);
    const spec = wildSpec(w, id);
    return {
      id, energy: pool.energy, energyMax: spec.energyMax, regen: spec.regen, coins: pool.coins,
      richness: richnessBand(pool.energy, spec.energyMax), relicsFound: pool.relicsFound, relics: pool.relicOrder.length,
    };
  });
}

/** 荒野的合计（旧接口的 wilds 字段；经典地图就是那一个荒野） */
function wildsSummary(w) {
  const rs = publicRegions(w);
  const energy = rs.reduce((s, r) => s + r.energy, 0);
  const max = rs.reduce((s, r) => s + r.energyMax, 0);
  return {
    energy, coins: rs.reduce((s, r) => s + r.coins, 0), richness: richnessBand(energy, max), relicsFound: rs.reduce((s, r) => s + r.relicsFound, 0),
  };
}

/** 天象：生效中、历史、本月投票计数、当前征兆（看不到排期；投票者指纹永不公开） */
export function publicWeather(w) {
  const day = clockDay(w);
  return {
    active: w.weather.active.map((x) => ({ type: x.type, startDay: x.startDay, endDay: x.endDay, daysLeft: x.endDay - day + 1 })),
    history: w.weather.history.map((h) => ({ ...h, votes: { ...h.votes } })),
    votes: { month: w.weather.votes.month, tallies: { ...w.weather.votes.tallies } },
    omens: visibleOmens(w),
  };
}

// ── 事件 ───────────────────────────────────────────────────────

/**
 * 把一条事件转换成观众能看到的样子；不可见（owner / internal）返回 null。
 * delayed 事件只有在 events.js 释放之后才会走到这里，带上 delayed: true。
 * 被遮盖的事件（world.redacted.events）内容替换为「此处被幕后抹去」。
 */
export function publicEvent(w, ev, { released = false } = {}) {
  if (ev.vis === 'owner' || ev.vis === 'internal') return null;
  if (ev.vis === 'delayed' && !released) return null;
  const out = { seq: ev.seq, tick: ev.tick, day: ev.day, type: ev.type };
  if (ev.agent !== undefined) out.agent = ev.agent;
  if (ev.place !== undefined) out.place = ev.place;
  if (ev.vis === 'delayed') out.delayed = true;
  if (w.redacted.events.includes(ev.seq)) {
    out.redacted = true;
    out.data = { text: REDACTED };
  } else {
    out.data = ev.data;
  }
  return out;
}

/** 造者能看到的事件（owner 类事件据 agent 字段确定可见者；delayed 立即可见） */
export function ownerEvent(ev) {
  return ev.vis === 'owner' || ev.vis === 'delayed' ? ev : null;
}
