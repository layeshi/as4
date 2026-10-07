import { prayerView, prayersEnabled } from './prayers.js';
// SPEC-E2 §18.1：观众视角的唯一出口（第二纪）。公共接口与 SSE 都经过这里。
//
// 谢幕之前（world.revealed 为 false），任何输出里都不得出现：居民的模型（含换身记录）、身体的种类、
// 人类书写的灵魂全文（含先民）、造者署名、躯壳的模型分配、天象排期、令牌与造者密钥哈希、投票者指纹。
// 私语、独白、记忆条目延迟 PRIVATE_DELAY_TICKS 刻才公开（由 events.js 按 releaseTick 释放；这里只做「已经释放」之后的转换）。

import { P, conditionBand, richnessBand } from '../params.js';
import { L, placeDisplayName, placeDescription } from '../lore/index.js';
import { clockDay, monthOfDay, dayOfMonthOf, tickOfDay, agentList, isAlive, idNum, premised } from '../world.js';
import { HUMAN_DEFS, WILD_ZONE_IDS } from '../map/index.js';
import { lawReading, authorView, isSuspended, isProcedureLaw, persistentCount } from './laws.js';
import { renderRules, renderProcedureClass } from '../rules/render.js';
import { isFunctioning, wallInscriptions, ownerView } from './places.js';
import { visibleOmens, weatherCodesFor } from './weather.js';
import { openProjectsAt } from './projects.js';
import { livingShells, shellsFree, queuePosition, bodyList } from './shells.js';
import { HUMAN_PROCEDURE, humanProcedureFor } from '../lore/humanlaws.js';
import { usesLawSemantics2, lawProtectionView } from './law-semantics.js';
import { refoundNeeded, liveElectorate, liveSigners, procedureHealth } from './legislation.js';

const ref = (w, id) => (id && w.agents[id] ? { id, name: w.agents[id].name } : null);
const REDACTED = { zh: L('zh').redacted, en: L('en').redacted };
const both = (f) => ({ zh: f('zh'), en: f('en') });

// ── 居民的公开档案 ───────────────────────────────────────────

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
 * 公开档案。谢幕前不含 body / owner / 人类书写的灵魂（世代 0，含先民）；居民书写的灵魂（世代 ≥ 1）是公开的。
 * 没有 fosterable：它会暴露这位居民有造者（即不是躯壳）。
 */
export function publicAgent(w, a) {
  const alive = isAlive(a);
  const out = {
    id: a.id, name: a.name, lang: a.lang, bio: a.bio, purpose: a.purpose ?? null, purposeHistory: a.purposeHistory.map((h) => ({ ...h })),
    tags: a.tags.slice(), status: a.status,
    generation: a.generation, authors: a.authors.slice(), children: a.children.slice(),
    bornDay: a.bornDay, ageDays: ageOf(w, a), diedDay: a.diedDay, dormantSinceDay: a.dormantSinceDay,
    place: alive ? a.place : null,
    energy: a.energy, coins: a.coins,
    ...(prayersEnabled(w) ? { prayerPoints: w.prayers.accounts[a.id]?.balance || 0, prayers: prayerView(w, a.id) } : {}),
    groups: a.groups.slice(), script: a.script, lastActTick: a.lastActTick,
    stats: { ...a.stats },
  };
  if (a.generation >= 1 || w.revealed) out.soul = a.soul;
  // TODO(spec): Q30 — premise 1 models are admin-only, including after curtain.
  if (w.revealed && !premised(w)) {
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
    .map((m) => ({ day: m.day, text: m.text, from: m.from ? ref(w, m.from) : null }));
}

// ── 地点、模块、工程、铭刻 ─────────────────────────────────────


function moduleView(place, m) {
  const legible = m.type !== 'surface' || (place.condition !== null && place.condition > 0);
  return {
    type: m.type, functioning: isFunctioning(place, m), salvage: m.salvage, builtDay: m.builtDay, inherent: m.inherent, projectId: m.projectId,
    ...(m.contributors ? { contributors: { ...m.contributors } } : {}),
    ...(m.type === 'surface' && m.inscription ? { inscription: legible ? m.inscription : null, inscriptionUnreadable: !legible } : {}),
  };
}

function projectView(w, j) {
  return {
    id: j.id, build: j.build, ...(j.lot ? { lot: j.lot } : {}), ...(j.on ? { on: j.on } : {}), ...(j.module ? { module: j.module } : {}), ...(j.to ? { to: j.to } : {}),
    name: j.name ?? null, description: j.description ?? null, place: j.place, owner: ownerView(w, j.owner), inscription: j.inscription ?? null,
    need: j.need, have: j.have, contributors: { ...j.contributors }, initiator: ref(w, j.initiator), createdDay: j.createdDay, expiresDay: j.expiresDay,
    status: j.status, result: j.result ?? null,
  };
}

function inscriptionView(w, i) {
  return {
    id: i.id, place: i.place, lang: i.lang,
    author: i.author === 'humans' ? 'humans' : ref(w, i.author),
    text: i.redacted ? null : i.text, redacted: i.redacted, lost: !!i.lost,
    tick: i.tick, day: Math.floor(i.tick / P.ticksPerDay), baseCost: i.baseCost,
    coveredBy: i.coveredBy, coveredTick: i.coveredTick, protectedBy: i.protectedBy.slice(),
  };
}

/** 规则持有物（章程、地点规则）的公开视图：规则 JSON、中英文读法、指纹、设定者与维持费 */
function holderView(w, holder, scope) {
  if (!holder) return null;
  return {
    rules: holder.rules, reading: both((lang) => ({ rules: renderRules(holder.rules, lang, scope ? { scope } : {}) })), fingerprints: holder.fingerprints.slice(),
    setTick: holder.setTick, setBy: ref(w, holder.setBy), paidThrough: holder.paidThrough, suspendedDays: holder.suspendedDays, suspended: isSuspended(w, holder),
    ...(holder.enact ? { enact: structuredClone(holder.enact), results: holder.results.map(r => ({ ...r })) } : {}),
  };
}

function placeBase(w, p) {
  const def = HUMAN_DEFS[p.id];
  return {
    id: p.id, name: p.name, displayName: both((lang) => placeDisplayName(p, lang)), humanName: p.humanName ? { ...p.humanName } : null, origin: p.origin,
    description: p.description, descriptionText: both((lang) => placeDescription(p, lang).text), renamedBy: p.renamedBy,
    district: p.district, xy: p.xy.slice(), wild: p.wild, open: p.open, explorable: p.explorable, landmark: p.landmark,
    razed: p.razed, ruined: p.ruined,
    condition: p.condition, band: p.condition === null ? null : conditionBand(p.condition),
    decayPerDay: p.decayPerDay, wallSlots: p.wallSlots,
    salvage: p.salvageMax > 0 ? { left: p.salvage, max: p.salvageMax } : null,
    modules: p.modules.map((m) => moduleView(p, m)),
    owner: ownerView(w, p.owner),
    gate: p.modules.some((m) => m.type === 'gate') ? { functioning: isFunctioning(p, p.modules.find((m) => m.type === 'gate')) } : null,
    rules: holderView(w, p.rules, null),
    founder: ref(w, p.founder), foundedDay: p.foundedDay,
    incarnations: p.incarnations.map((x) => ({ ...x, founder: x.founder ? ref(w, x.founder) : null })),
    activity: { ...p.activity }, history: (p.history || []).slice(),
    legacy: !!def,
  };
}

/** 地点详情：模块、残料、主人、门、地点规则、前世，以及铭刻的完整历史（作者、覆盖关系）与进行中的工程 */
export function publicPlace(w, id) {
  const p = Object.prototype.hasOwnProperty.call(w.places, id) ? w.places[id] : null;
  if (!p) return null;
  return {
    ...placeBase(w, p),
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
  const d = Object.prototype.hasOwnProperty.call(w.docs, id) ? w.docs[id] : null;
  if (!d) return null;
  return { ...docSummary(w, d), body: d.redacted ? null : d.body, ref: d.redacted ? null : d.ref };
}

function lexiconView(e) {
  return {
    word: e.word, meaning: e.redacted ? null : e.meaning, coiner: e.coiner, tick: e.tick,
    uses: e.uses, users: e.users.length, redacted: !!e.redacted,
  };
}

// ── 法律、提案、社群、重订、交易 ────────────────────────────────

/** 一部法律（城法）的公开视图 */
function lawBrief(w, l) {
  return {
    id: l.id, scope: 'city', title: l.title, text: l.text,
    ...(l.i18n ? { i18n: JSON.parse(JSON.stringify(l.i18n)) } : {}),
    author: authorView(w, l.author), class: l.class, basedOn: l.basedOn, status: l.status, repealedBy: l.repealedBy, replacedBy: l.replacedBy,
    enactedTick: l.enactedTick, proposalId: l.proposalId, paidThrough: l.paidThrough, suspendedDays: l.suspendedDays,
    suspended: l.status === 'active' && !isProcedureLaw(l) && persistentCount(l.rules) > 0 && isSuspended(w, l),
    rules: l.rules, procedure: l.procedure,
    reading: both((lang) => lawReading(l, lang)),
    fingerprints: l.fingerprints.slice(), results: l.results.map((r) => ({ ...r })),
    ...(l.enact ? { enact: structuredClone(l.enact) } : {}),
  };
}

function proposalView(w, p) {
  const reading = both((lang) => (p.procedure && typeof p.procedure === 'object'
    ? { procedure: Object.fromEntries(['ordinary', 'constitutional'].filter((c) => p.procedure[c]).map((c) => [c, renderProcedureClass(p.procedure[c], lang)])) }
    : { rules: p.rules ? renderRules(p.rules, lang, p.kind === 'bylaws' ? { scope: { kind: 'group', id: p.scope.slice(6) } } : {}) : [] }));
  return {
    id: p.id, scope: p.scope, kind: p.kind, class: p.class, title: p.title, text: p.text,
    rules: p.rules, procedure: p.procedure, basedOn: p.basedOn, reading,
    ...(p.procedureSource ? { procedureSource: { ...p.procedureSource } } : {}),
    ...(p.voidReason ? { voidReason: p.voidReason, refoundId: p.refoundId } : {}),
    ...(p.enact ? { enact: structuredClone(p.enact) } : {}),
    proposer: ref(w, p.proposer), openedTick: p.openedTick, closesTick: p.closesTick, status: p.status, secret: p.secret,
    voters: p.voters.length, tally: p.tally, lawId: p.lawId, ...(p.place ? { place: p.place } : {}),
    votes: Object.entries(p.votes).map(([id, v]) => ({ agent: ref(w, id), choice: v.choice, reason: v.reason, tick: v.tick })),
  };
}

function groupView(w, g) {
  return {
    id: g.id, name: g.name, manifesto: g.manifesto, open: g.open, founder: ref(w, g.founder), steward: ref(w, g.steward),
    members: g.members.map((id) => ref(w, id)), pending: g.pending.map((id) => ref(w, id)),
    treasury: { ...g.treasury }, createdDay: g.createdDay, dissolved: g.dissolved,
    procedure: g.procedure, vars: { ...g.vars }, bylaws: holderView(w, g.bylaws, { kind: 'group', id: g.id }),
  };
}

function refoundView(w, r) {
  const proc = r.procedure === 'humans' ? (usesLawSemantics2(w) && !r.electorate ? HUMAN_PROCEDURE : humanProcedureFor(w)) : r.procedure;
  return {
    id: r.id, by: ref(w, r.by), text: r.text, procedure: r.procedure,
    reading: both((lang) => Object.fromEntries(['ordinary', 'constitutional'].filter((c) => proc[c]).map((c) => [c, renderProcedureClass(proc[c], lang)]))),
    openedTick: r.openedTick, expiresTick: r.expiresTick, signers: r.signers.map((id) => ref(w, id)), status: r.status,
    ...(usesLawSemantics2(w) && r.electorate ? { electorate: r.electorate.map(id => ref(w, id)), eligibleResidents: liveElectorate(w, r).length, liveSigners: liveSigners(w, r).length, needed: refoundNeeded(w, r) } : {}),
  };
}

function offerView(w, o) {
  return {
    id: o.id, from: ref(w, o.from), to: ref(w, o.to), board: o.board ?? null, give: { ...o.give }, want: { ...o.want }, note: o.note,
    openedTick: o.openedTick, expiresTick: o.expiresTick, status: o.status, acceptedBy: ref(w, o.acceptedBy),
  };
}

/** 灵魂在摇篮里的公开视图：居民书写的灵魂是公开的；出资与出资者也是 */
function soulView(w, s) {
  return {
    id: s.id, name: s.name, soul: s.soul, lang: s.lang, authors: s.authors.map((id) => ref(w, id)), generation: s.generation,
    createdDay: s.createdDay, expiresDay: s.expiresDay, fund: s.fund, sponsors: { ...s.sponsors },
    queued: s.fundedTick !== null, queuePosition: queuePosition(w, s), queueExpiresDay: s.queueExpiresDay, successorOf: s.successorOf ? ref(w, s.successorOf) : null,
  };
}

/** GET /api/port/cradle：摇篮中的灵魂（与感知里的 city.cradle 相同，另含 createdDay、sponsors） */
export function publicCradle(w) {
  return Object.values(w.souls).map((s) => soulView(w, s));
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
  const total = w.shells.slots;
  const free = shellsFree(w);
  return {
    world: {
      ...(w.ruleExecution ? { lawExecution: { version: w.ruleExecution.version, protected: !!w.ruleExecution.protection, protection: w.ruleExecution.protection } } : {}),
      id: w.id, protocol: 2, physics: 2, ...(premised(w) ? { premise: w.premise } : {}), tick: w.clock.tick, day, month: monthOfDay(day), dayOfMonth: dayOfMonthOf(day), tickOfDay: tickOfDay(w),
      ticksPerDay: P.ticksPerDay, daysPerMonth: P.daysPerMonth, monthsPerEpoch: P.monthsPerEpoch, epoch: w.epoch,
      ...(usesLawSemantics2(w) ? { lawSemanticsVersion: 2, lawProtection: lawProtectionView(w) } : {}),
      paused: w.paused, revealed: w.revealed, map: w.map,
      cityName: w.cityName, humanCityName: { zh: zh.cityName, en: L('en').cityName },
      nextTickAt: extra.nextTickAt ?? null, tickMs: P.tickMs,
    },
    ...(prayersEnabled(w) ? { prayers: prayerView(w) } : {}),
    vars: { ...w.vars },
    procedure: {
      ordinary: { lawId: w.procedure.ordinary, reading: both((lang) => procReading(w, 'ordinary', lang)), ...(usesLawSemantics2(w) ? { health: procedureHealth(w, 'ordinary') } : {}) },
      constitutional: { lawId: w.procedure.constitutional, reading: both((lang) => procReading(w, 'constitutional', lang)), ...(usesLawSemantics2(w) ? { health: procedureHealth(w, 'constitutional') } : {}) },
    },
    charter: {
      canonical: w.charterCanonical,
      articles: w.charter.map((a) => ({ n: a.n, status: a.status, versions: { ...a.versions }, history: a.history.map((h) => ({ ...h })) })),
    },
    places: Object.values(w.places).map((p) => publicPlace(w, p.id)),
    lots: Object.entries(w.lots).map(([id, l]) => ({ id, place: l.place, project: l.project })),
    paths: w.paths.map((p) => ({ ...p })),
    roads: Object.values(w.roads).map((r) => ({ id: r.id, a: r.a, b: r.b, name: r.name, condition: r.condition, functioning: r.condition >= P.functioningBp, ruined: r.ruined, builtDay: r.builtDay })),
    projects: Object.values(w.projects).filter((j) => j.status === 'open').map((j) => projectView(w, j)),
    agents: agentList(w).map((a) => publicAgent(w, a)),
    groups: Object.values(w.groups).map((g) => groupView(w, g)),
    proposals: [...open, ...finished].map((p) => proposalView(w, p)),
    laws: Object.values(w.laws).map((l) => lawBrief(w, l)),
    refounds: Object.values(w.refounds).slice(-20).map((r) => refoundView(w, r)),
    petitions: w.petitions.slice(-20).map((p) => ({ ...p })),
    offers: Object.values(w.offers).filter((o) => o.status === 'open').map((o) => offerView(w, o)),
    cradle: Object.values(w.souls).map((s) => soulView(w, s)),
    shells: {
      ...(premised(w) ? { bodies: bodyList(w).map((b) => ({ id: b.id, occupant: ref(w, b.occupant), vacantSince: b.vacantSince, trainedCount: b.trained.length })) } : {}),
      total, free, used: total - free, cost: P.shellCost, living: livingShells(w),
      queue: Object.values(w.souls).filter((s) => s.fundedTick !== null).sort((x, y) => x.fundedTick - y.fundedTick || idNum(x.id) - idNum(y.id))
        .map((s, i) => ({ soulId: s.id, name: s.name, position: i + 1, fundedDay: Math.floor(s.fundedTick / P.ticksPerDay), queueExpiresDay: s.queueExpiresDay })),
    },
    treasury: { ...w.treasury },
    well: { condition: w.places.well.condition, drawPoolLeft: w.well.drawPoolLeft, outputHistory: w.well.outputHistory.slice() },
    wilds: wildsSummary(w),
    regions: publicRegions(w),
    weather: publicWeather(w),
    lexicon: Object.values(w.lexicon).map(lexiconView),
    docs: Object.values(w.docs).map((d) => docSummary(w, d)),
    cemetery: w.cemetery.map((g) => ({
      agentId: g.agentId, name: g.name, diedDay: g.diedDay, cause: g.cause, ageDays: g.ageDays, lastWords: g.lastWords,
      memories: g.memories.map((m) => ({ day: m.day, text: m.text, from: m.from ? ref(w, m.from) : null })), will: g.will,
      epitaphs: g.epitaphs.map((e) => ({ author: ref(w, e.author), text: e.text, tick: e.tick })),
    })),
    retired: w.retired.map((r) => ({ ...r })),
    unborn: w.unborn.map((u) => ({ ...u })),
    metrics: w.metrics.length ? w.metrics[w.metrics.length - 1] : null,
    legacy: w.legacy || null,
    chronicle: w.chronicle.slice(-5),
  };
}

function procReading(w, cls, lang) {
  const law = w.laws[w.procedure[cls]];
  const spec = law && law.procedure ? law.procedure[cls] : null;
  return spec ? renderProcedureClass(spec, lang) : '';
}

/** 荒野五地带的储量。遗物只给出已找到与总数，不给顺序 */
export function publicRegions(w) {
  return WILD_ZONE_IDS.map((id) => {
    const pool = w.regions[id];
    const spec = HUMAN_DEFS[id].wild;
    return {
      id, energy: pool.energy, energyMax: spec.energyMax, regen: spec.regen, coins: pool.coins,
      richness: richnessBand(pool.energy, spec.energyMax), relicsFound: pool.relicsFound, relics: pool.relicOrder.length,
    };
  });
}

function wildsSummary(w) {
  const rs = publicRegions(w);
  const energy = rs.reduce((s, r) => s + r.energy, 0);
  const max = rs.reduce((s, r) => s + r.energyMax, 0);
  return { energy, coins: rs.reduce((s, r) => s + r.coins, 0), richness: richnessBand(energy, max), relicsFound: rs.reduce((s, r) => s + r.relicsFound, 0) };
}

/** 天象：生效中、历史、本月投票计数、当前征兆（看不到排期；投票者指纹永不公开） */
export function publicWeather(w) {
  const day = clockDay(w);
  return {
    types: weatherCodesFor(w).filter((c) => c !== 'calm'),
    active: w.weather.active.map((x) => ({ type: x.type, startDay: x.startDay, endDay: x.endDay, daysLeft: x.endDay - day + 1 })),
    history: w.weather.history.map((h) => ({ ...h, votes: { ...h.votes } })),
    votes: { month: w.weather.votes.month, tallies: { ...w.weather.votes.tallies } },
    omens: visibleOmens(w),
  };
}

// ── 法律的详情（GET /api/public/laws/:id） ─────────────────────

/**
 * 一部法律（城法 l<k>）、一份社群章程（group:<g>）或一份地点规则（place:<id>）的全部：
 * 文字、规则 JSON、中英文引擎读法、指纹、通过时的计票、enact 的执行结果、停摆的日子。找不到返回 null。
 */
export function publicLaw(w, id) {
  if (typeof id !== 'string') return null;
  if (/^l\d+$/.test(id)) {
    const l = Object.prototype.hasOwnProperty.call(w.laws, id) ? w.laws[id] : null;
    if (!l) return null;
    const p = l.proposalId && w.proposals[l.proposalId] ? w.proposals[l.proposalId] : null;
    return { ...lawBrief(w, l), tally: p ? p.tally : null, proposal: p ? proposalView(w, p) : null };
  }
  const m = /^(group|place):(.+)$/.exec(id);
  if (!m) return null;
  if (m[1] === 'group') {
    const g = Object.prototype.hasOwnProperty.call(w.groups, m[2]) ? w.groups[m[2]] : null;
    if (!g || !g.bylaws) return null;
    return { id, scope: id, owner: ref(w, g.id) || { id: g.id, name: g.name }, ...holderView(w, g.bylaws, { kind: 'group', id: g.id }), vars: { ...g.vars } };
  }
  const p = Object.prototype.hasOwnProperty.call(w.places, m[2]) ? w.places[m[2]] : null;
  if (!p || !p.rules) return null;
  return { id, scope: id, owner: { kind: p.owner.kind, id: p.owner.id }, place: p.id, ...holderView(w, p.rules, null) };
}

/** 一条（公开的）事件是否与这部法律 / 章程 / 地点规则有关（GET /api/public/laws/:id 里的「最近 100 条相关事件」） */
export function eventMatchesLaw(ev, id) {
  const d = ev.data;
  if (!d) return false;
  if (d.lawId === id || d.law === id || d.target === id || d.by === id) return true;
  const scope = d.scope;
  if (/^l\d+$/.test(id)) return scope === 'city' && d.owner === id;
  const m = /^(group|place):(.+)$/.exec(id);
  if (!m) return false;
  return scope === id || (m[1] === 'group' && d.groupId === m[2]) || (m[1] === 'place' && d.placeId === m[2]);
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
