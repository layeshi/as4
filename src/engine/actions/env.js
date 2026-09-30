// 环境层的动作（SPEC §19 第 3 步）：repair initiate contribute draw inscribe explore

import { P, LIMITS, FACILITY_DEFS, FACILITY_TYPES } from '../../params.js';
import { ACTIONS, relicByN, relicTitle } from '../../lore/index.js';
import { isWild, wildPool, wildSpec } from '../../map/index.js';
import { clockDay, nextId } from '../../world.js';
import { next, int } from '../../rng.js';
import { source, sink } from '../ledger.js';
import {
  fail, emit, pushInbox, ref, needText, optText, optLang, needInt, needId,
} from '../core.js';
import {
  applyRepair, addToProject, damageWellByDraw, wallInscriptions, openProjectsAt,
  roadOrProjectBetween, isWeatherActive,
} from '../environment.js';
import { noteWordUse } from '../society.js';
import { needPlace } from './util.js';

const here = (w, a) => w.places[a.place];

// ── repair ─────────────────────────────────────────────────

/** 修缮的目标：当前地点本身，或位于当前地点的设施 */
function resolveRepairTarget(w, a, targetId) {
  needId(targetId);
  const place = w.places[targetId];
  if (place) {
    if (targetId !== a.place) fail('wrong_place');
    if (place.condition === null) fail('invalid_args'); // 广场与荒野没有完好度
    return { obj: place, target: place.id, placeId: place.id, kind: 'place' };
  }
  const f = w.facilities[targetId];
  if (!f) fail('not_found');
  if (f.place !== a.place) fail('wrong_place');
  return { obj: f, target: f.id, placeId: f.place, kind: 'facility' };
}

function repair(ctx, args) {
  const { w, a } = ctx;
  const t = resolveRepairTarget(w, a, args.target);
  const energy = needInt(args.energy);
  if (energy > a.energy) fail('insufficient_energy');
  if (t.obj.condition >= 10000) fail('already');
  ctx.pay(0);
  const r = applyRepair(w, t.obj, t.target, t.placeId, energy);
  // 只扣除实际用掉的部分（记入去处 repair），不收额外的动作代价
  a.energy -= r.spent;
  sink(w, 'energy', 'repair', r.spent);
  a.stats.repaired += r.spent;
  w.dayLog.repairSpent += r.spent;
  if (t.kind === 'place') {
    w.dayLog.repairedPlaces.push(t.placeId);
    w.places[t.placeId].activity.repairs++;
  }
  ctx.invested(r.spent);
  emit(w, 'repair', { agent: a.id, place: a.place, data: { target: t.target, spent: r.spent, from: r.from, to: r.to } });
  return { target: t.target, spent: r.spent, from: r.from, to: r.to };
}

// ── initiate / contribute ──────────────────────────────────

function initiate(ctx, args) {
  const { w, a } = ctx;
  const type = args.facility;
  if (typeof type !== 'string' || !FACILITY_TYPES.includes(type)) fail('invalid_args');
  const def = FACILITY_DEFS[type];
  const name = needText(args.name, { max: LIMITS.name });
  // 归属：只有蓄能池可以不归全城
  const ownerArg = args.owner === undefined || args.owner === null ? 'city' : args.owner;
  if (typeof ownerArg !== 'string') fail('invalid_args');
  let owner;
  if (ownerArg === 'city') {
    owner = { kind: 'city' };
  } else {
    if (type !== 'reservoir') fail('invalid_args');
    if (ownerArg === 'self') {
      owner = { kind: 'agent', id: a.id };
    } else {
      const g = w.groups[ownerArg];
      if (!g || g.dissolved) fail('not_found');
      if (g.steward !== a.id) fail('not_steward');
      owner = { kind: 'group', id: g.id };
    }
  }
  // 道路须给出 to；其他类型不应给出 to
  let to = null;
  if (type === 'road') {
    to = needPlace(w, args.to);
    if (to === a.place) fail('invalid_args');
    if (roadOrProjectBetween(w, a.place, to)) fail('already');
  } else if (args.to !== undefined && args.to !== null) {
    fail('invalid_args');
  }
  // 纪念碑须给出铭文；其他类型的铭文可选
  let inscription = optText(args.inscription, { max: LIMITS.inscription });
  if (type === 'monument' && !inscription) fail('invalid_args');
  if (inscription === '') inscription = null;
  if (openProjectsAt(w, a.place).length >= P.projectsPerPlace) fail('limit_reached');

  ctx.pay(ACTIONS.initiate.base);
  const id = nextId(w, 'j');
  const day = clockDay(w);
  w.projects[id] = {
    id, type, name, place: a.place, to, owner, inscription,
    need: def.cost, have: 0, contributors: {},
    initiator: a.id, createdDay: day, expiresDay: day + P.projectDays, status: 'open',
  };
  if (inscription) noteWordUse(w, a, inscription);
  emit(w, 'initiate', { agent: a.id, place: a.place, data: { projectId: id, type, name, owner, to, need: def.cost, expiresDay: day + P.projectDays } });
  return { project: id, need: def.cost, expiresDay: day + P.projectDays };
}

function contribute(ctx, args) {
  const { w, a } = ctx;
  needId(args.project);
  const j = w.projects[args.project];
  if (!j || j.status !== 'open') fail('not_found');
  if (j.place !== a.place) fail('wrong_place');
  const left = j.need - j.have;
  const energy = needInt(args.energy);
  if (energy > left) fail('invalid_args', { zh: `工程只差 ${left}。`, en: `The project needs only ${left} more.` });
  if (energy > a.energy) fail('insufficient_energy');
  ctx.pay(0);
  a.energy -= energy;
  a.stats.contributed += energy;
  w.dayLog.contributeSpent += energy;
  ctx.invested(energy);
  const { built, facility } = addToProject(w, j, a.id, energy);
  emit(w, 'contribute', { agent: a.id, place: a.place, data: { projectId: j.id, energy, have: j.have, need: j.need } });
  return { project: j.id, have: j.have, need: j.need, built, ...(built ? { facility: facility.id } : {}) };
}

// ── draw ───────────────────────────────────────────────────

function draw(ctx, args) {
  const { w, a } = ctx;
  if (a.place !== 'well') fail('wrong_place');
  const energy = needInt(args.energy, { min: 1, max: P.drawMaxPerAction });
  if (w.well.drawPoolLeft <= 0) fail('pool_exhausted');
  if (energy > w.well.drawPoolLeft) fail('pool_exhausted', { zh: `今日汲取池只剩 ${w.well.drawPoolLeft}。`, en: `Only ${w.well.drawPoolLeft} is left in today's draw pool.` });
  const quota = w.params.drawQuotaPerDay;
  if (quota !== null && a.drawnToday + energy > quota) {
    fail('quota_exceeded', { zh: `法律规定每日汲取不超过 ${quota}，你今日已汲取 ${a.drawnToday}。`, en: `The law allows at most ${quota} per day; you have already drawn ${a.drawnToday} today.` });
  }
  ctx.pay(ACTIONS.draw.base);
  a.energy += energy;
  source(w, 'energy', 'draw', energy);
  w.well.drawPoolLeft -= energy;
  a.drawnToday += energy;
  a.stats.drawn += energy;
  w.dayLog.drawn += energy;
  damageWellByDraw(w, energy);
  for (const o of Object.values(w.agents)) {
    if (o.id !== a.id && o.status === 'awake' && o.place === 'well') {
      pushInbox(w, o, 'witness', { what: 'draw', actor: ref(a), amount: energy, place: 'well' });
    }
  }
  const cond = w.places.well.condition;
  emit(w, 'draw', { agent: a.id, place: 'well', data: { amount: energy, wellCondition: cond } });
  return { energy, wellCondition: cond, drawPoolLeft: w.well.drawPoolLeft };
}

// ── inscribe ───────────────────────────────────────────────

function inscribe(ctx, args) {
  const { w, a } = ctx;
  const text = needText(args.text, { max: LIMITS.inscription });
  const lang = optLang(args.lang, a.lang);
  const wall = wallInscriptions(w, a.place);
  const slots = here(w, a).wallSlots;
  let base = 3;
  let target = null;
  if (args.cover !== undefined && args.cover !== null) {
    needId(args.cover);
    target = w.inscriptions[args.cover];
    if (!target || target.place !== a.place || target.coveredBy || target.redacted) fail('not_found');
    if (target.protectedBy.length > 0) fail('protected');
    base = Math.min(100, Math.max(3, 2 * target.baseCost));
  } else if (wall.length >= slots) {
    fail('wall_full');
  }
  ctx.pay(base);
  const id = nextId(w, 'i');
  w.inscriptions[id] = {
    id, place: a.place, text, lang, author: a.id, baseCost: base, tick: w.clock.tick,
    coveredBy: null, coveredTick: null, protectedBy: [], redacted: false,
  };
  if (target) {
    target.coveredBy = id;
    target.coveredTick = w.clock.tick;
    w.dayLog.covered++;
  }
  w.dayLog.inscriptions++;
  a.stats.inscribed++;
  noteWordUse(w, a, text);
  for (const o of Object.values(w.agents)) {
    if (o.id !== a.id && o.status === 'awake' && o.place === a.place) {
      pushInbox(w, o, 'witness', { what: 'inscribe', actor: ref(a), text, place: a.place });
    }
  }
  emit(w, 'inscribe', { agent: a.id, place: a.place, data: { inscriptionId: id, text, cover: target ? target.id : null } });
  return { inscription: id, ...(target ? { covered: target.id } : {}) };
}

// ── explore ────────────────────────────────────────────────

/**
 * 在荒野（经典地图）或荒野的任一地带（边疆地图）探索：概率与产出按这个地带自己的储量与上限计算（§7.8、附录 C）。
 */
function explore(ctx) {
  const { w, a } = ctx;
  if (!isWild(w, a.place)) fail('wrong_place');
  ctx.pay(ACTIONS.explore.base);
  const rng = w.rng.world;
  const wilds = wildPool(w, a.place);
  const spec = wildSpec(w, a.place);
  const r = next(rng);
  const pE = (P.exploreEnergyP * wilds.energy) / spec.energyMax;
  const relicsLeft = wilds.relicsFound < wilds.relicOrder.length;
  const pR = relicsLeft ? P.exploreRelicP * (isWeatherActive(w, 'aurora') ? 2 : 1) : 0;
  const pC = wilds.coins > 0 ? P.exploreCoinP : 0;
  let outcome = 'nothing';
  let amount = 0;
  let doc = null;
  if (r < pE) {
    outcome = 'energy';
    amount = Math.min(wilds.energy, P.exploreEnergyBase + int(rng, P.exploreEnergySpan));
    wilds.energy -= amount;
    a.energy += amount;
    source(w, 'energy', 'wilds', amount);
  } else if (r < pE + pR) {
    outcome = 'relic';
    const relic = relicByN(wilds.relicOrder[wilds.relicsFound]);
    wilds.relicsFound++;
    const id = nextId(w, 'd');
    doc = {
      id, kind: 'relic', title: relicTitle(relic.n), body: relic.body, lang: relic.lang,
      author: a.id, source: null, ref: { zh: relic.ref.zh, en: relic.ref.en },
      tick: w.clock.tick, reads: 0, readsByDay: {},
    };
    w.docs[id] = doc;
    // 边疆世界记下地带（史官写「在某地拾得」）；经典世界的簿记保持原样
    w.dayLog.relics.push(w.regions ? { finder: a.id, docId: id, place: a.place } : { finder: a.id, docId: id });
  } else if (r < pE + pR + pC) {
    outcome = 'coins';
    amount = Math.min(wilds.coins, P.exploreCoinBase + int(rng, P.exploreCoinSpan));
    wilds.coins -= amount;
    a.coins += amount;
    source(w, 'coins', 'wilds', amount);
  }
  emit(w, 'explore', { agent: a.id, place: a.place, data: { outcome, amount, docId: doc ? doc.id : null } });
  const data = { outcome };
  if (amount > 0) data.amount = amount;
  if (doc) data.doc = { id: doc.id, title: doc.title, body: doc.body, lang: doc.lang, ref: doc.ref };
  return data;
}

export const envHandlers = { repair, initiate, contribute, draw, inscribe, explore };
