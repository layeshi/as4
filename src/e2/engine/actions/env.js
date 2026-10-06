import { rewardRepair } from '../prayer-rewards.js';
// 环境层的动作（SPEC-E2 §25 第 3 步）：repair draw inscribe explore
// （initiate contribute dismantle 在第 6 步）

import { P, LIMITS } from '../../params.js';
import { ACTIONS } from '../../lore/actions.js';
import { relicByN, relicTitle } from '../../lore/index.js';
import { HUMAN_DEFS } from '../../map/index.js';
import { clockDay, nextId } from '../../world.js';
import { next, int } from '../../../rng.js';
import { source, sink } from '../ledger.js';
import { fail, emit, pushInbox, ref, needText, optLang, needInt, needId } from '../core.js';
import { applyRepair, damageWellByDraw, isWeatherActive } from '../environment.js';
import { wallInscriptions } from '../places.js';
import { noteWordUse } from '../society.js';

// ── repair ─────────────────────────────────────────────────

/** 修缮的目标：所在之处的地点本身（缺省），或一端在此处的道路。广场、荒野地带与遗址没有完好度，不能修缮 */
function resolveRepairTarget(w, a, targetId) {
  if (targetId === undefined || targetId === null || targetId === a.place) {
    const place = w.places[a.place];
    if (place.open || place.condition === null) fail('invalid_args', { zh: '广场、荒野与遗址没有完好度，不能修缮。', en: 'Open ground and ruin sites have no condition to repair.' });
    return { obj: place, target: place.id, placeId: place.id, kind: 'place' };
  }
  needId(targetId);
  if (Object.prototype.hasOwnProperty.call(w.places, targetId)) fail('wrong_place');
  const road = Object.prototype.hasOwnProperty.call(w.roads, targetId) ? w.roads[targetId] : null;
  if (!road) fail('not_found');
  if (road.a !== a.place && road.b !== a.place) fail('wrong_place');
  return { obj: road, target: road.id, placeId: a.place, kind: 'road' };
}

const repair = {
  validate(ctx, args) {
    const { a } = ctx;
    const t = resolveRepairTarget(ctx.w, a, args.target);
    const energy = needInt(args.energy);
    if (energy > a.energy) fail('insufficient_energy');
    if (t.obj.condition >= 10000) fail('already');
    return { ...t, energy, cost: 0, reserve: { energy } };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const r = applyRepair(w, plan.obj, plan.target, plan.placeId, plan.energy);
    rewardRepair(w, a, plan.obj, plan.target, r.eligible || 0);
    // 只扣除实际用掉的部分（记入去处 repair），不收额外的动作代价
    a.energy -= r.spent;
    sink(w, 'energy', 'repair', r.spent);
    a.stats.repaired += r.spent;
    a.repairedToday += r.spent;
    w.dayLog.repairSpent += r.spent;
    if (plan.kind === 'place') {
      w.dayLog.repairedPlaces.push(plan.placeId);
      w.places[plan.placeId].activity.repairs++;
    }
    ctx.invested(r.spent);
    emit(w, 'repair', { agent: a.id, place: a.place, data: { target: plan.target, spent: r.spent, from: r.from, to: r.to } });
    return { target: plan.target, spent: r.spent, from: r.from, to: r.to };
  },
};

// ── draw ───────────────────────────────────────────────────

const draw = {
  validate(ctx, args) {
    const { w, a } = ctx;
    if (w.places[a.place].landmark !== 'well') fail('wrong_place');
    const energy = needInt(args.energy, { min: 1, max: P.drawMaxPerAction });
    if (w.well.drawPoolLeft <= 0) fail('pool_exhausted');
    if (energy > w.well.drawPoolLeft) fail('pool_exhausted', { zh: `今日汲取池只剩 ${w.well.drawPoolLeft}。`, en: `Only ${w.well.drawPoolLeft} is left in today's draw pool.` });
    // 没有物理的配额：限额是法律的事（before:draw 的规则）
    return { energy, cost: ctx.cost(ACTIONS.draw.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { energy } = plan;
    a.energy += energy;
    source(w, 'energy', 'draw', energy);
    w.well.drawPoolLeft -= energy;
    a.drawnToday += energy;
    a.stats.drawn += energy;
    w.dayLog.drawn += energy;
    damageWellByDraw(w, energy);
    for (const o of Object.values(w.agents)) {
      if (o.id !== a.id && o.status === 'awake' && o.place === a.place) {
        pushInbox(w, o, 'witness', { what: 'draw', actor: ref(a), amount: energy, place: a.place });
      }
    }
    const cond = w.places.well.condition;
    emit(w, 'draw', { agent: a.id, place: a.place, data: { amount: energy, wellCondition: cond } });
    return { energy, wellCondition: cond, drawPoolLeft: w.well.drawPoolLeft };
  },
};

// ── inscribe ───────────────────────────────────────────────

const inscribe = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const place = w.places[a.place];
    if (place.wallSlots <= 0) fail('wrong_place', { zh: '遗址没有墙。', en: 'A ruin site has no wall.' });
    const text = needText(args.text, { max: LIMITS.inscription });
    const lang = optLang(args.lang, a.lang);
    const wall = wallInscriptions(w, a.place);
    let base = 3;
    let target = null;
    if (args.cover !== undefined && args.cover !== null) {
      needId(args.cover);
      target = w.inscriptions[args.cover];
      if (!target || target.place !== a.place || target.coveredBy || target.redacted || target.lost) fail('not_found');
      if (target.protectedBy.length > 0) fail('protected');
      base = Math.min(100, Math.max(3, 2 * target.baseCost));
    } else if (wall.length >= place.wallSlots) {
      fail('wall_full');
    }
    return { text, lang, target, base, cost: ctx.cost(base) }; // 铭刻不使用模块，不受倍率影响
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const id = nextId(w, 'i');
    w.inscriptions[id] = {
      id, place: a.place, text: plan.text, lang: plan.lang, author: a.id, baseCost: plan.base, tick: w.clock.tick,
      coveredBy: null, coveredTick: null, protectedBy: [], redacted: false, lost: false,
    };
    if (plan.target) {
      plan.target.coveredBy = id;
      plan.target.coveredTick = w.clock.tick;
      w.dayLog.covered++;
    }
    w.dayLog.inscriptions++;
    a.stats.inscribed++;
    noteWordUse(w, a, plan.text);
    for (const o of Object.values(w.agents)) {
      if (o.id !== a.id && o.status === 'awake' && o.place === a.place) {
        pushInbox(w, o, 'witness', { what: 'inscribe', actor: ref(a), text: plan.text, place: a.place });
      }
    }
    emit(w, 'inscribe', { agent: a.id, place: a.place, data: { inscriptionId: id, text: plan.text, cover: plan.target ? plan.target.id : null } });
    return { inscription: id, ...(plan.target ? { covered: plan.target.id } : {}) };
  },
};

// ── explore ────────────────────────────────────────────────

/** 在荒野五地带探索：概率与产出按这个地带自己的储量与上限计算。在荒野里开辟的地点不能探索 */
const explore = {
  validate(ctx) {
    const { w, a } = ctx;
    if (!w.places[a.place].explorable) fail('wrong_place');
    return { cost: ctx.cost(ACTIONS.explore.base) };
  },
  apply(ctx) {
    const { w, a } = ctx;
    const rng = w.rng.world;
    const wilds = w.regions[a.place];
    const spec = HUMAN_DEFS[a.place].wild;
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
        tick: w.clock.tick, reads: 0, readsByDay: {}, redacted: false,
      };
      w.docs[id] = doc;
      w.dayLog.relics.push({ finder: a.id, docId: id, place: a.place });
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
  },
};

export const envHandlers = { repair, draw, inscribe, explore };
