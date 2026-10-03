// 生命与能量的动作（SPEC-E2 §25 第 3 步）：move say whisper broadcast give remember forget diary will
// （孕育与立志见 descent.js；出资 sponsor 在第 8 步）

import { bodyOf } from '../bodies.js';
import { textWeight } from '../../../text.js';
import { P, LIMITS } from '../../params.js';
import { ACTIONS } from '../../lore/actions.js';
import { clockDay, nextId, findAgent, isAlive, isNameTaken, premised } from '../../world.js';
import {
  fail, emit, pushInbox, ref, creditEnergy, needText, needWeight, optText, optLang, needInt, optAmount, needObject, needId,
} from '../core.js';
import { checkNameShape } from '../lifecycle.js';
import { moveBaseCost, isWildOpen, hasGate, hasEnterRule, defaultMayEnter } from '../movement.js';
import { hasRelay } from '../places.js';
import { isWeatherActive } from '../environment.js';
import { needPlace, needAgent, recordUtterance, needName } from './util.js';

const move = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const to = needPlace(w, args.to);
    if (to === a.place) fail('already');
    const base = moveBaseCost(w, a.place, to);
    if (base === null) fail('invalid_args', { zh: '到不了那里。', en: 'There is no way to get there.' });
    return {
      to,
      cost: ctx.cost(base), // 路程不受倍率影响
      skipBefore: isWildOpen(w, to), // 荒野永远可以进入：规则不管
      // 门（SPEC-E2 §7.6 第 4 步）：在规则之后检查。目的地有运转中的门、且没有 before:enter 规则时按默认规则判断
      gate() {
        if (isWildOpen(w, to) || !hasGate(w, to) || hasEnterRule(w, to)) return;
        if (!defaultMayEnter(w, a, to)) fail('gated', null, { place: to });
      },
    };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const from = a.place;
    a.place = plan.to;
    w.places[plan.to].activity.visits++;
    emit(w, 'move', { agent: a.id, place: plan.to, data: { from, to: plan.to } });
    return { place: plan.to };
  },
};

const say = {
  validate(ctx, args) {
    const text = needText(args.text, { max: LIMITS.speech });
    return { text, cost: ctx.cost(ACTIONS.say.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const script = recordUtterance(ctx, plan.text);
    for (const o of Object.values(w.agents)) {
      if (o.id !== a.id && o.status === 'awake' && o.place === a.place) {
        pushInbox(w, o, 'say', { from: ref(a), place: a.place, text: plan.text });
      }
    }
    emit(w, 'say', { agent: a.id, place: a.place, data: { text: plan.text, script } });
    return {};
  },
};

const whisper = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const to = needAgent(w, args.to);
    if (to.id === a.id) fail('invalid_args');
    const text = needText(args.text, { max: LIMITS.speech });
    return { to, text, cost: ctx.cost(ACTIONS.whisper.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    pushInbox(w, plan.to, 'whisper', { from: ref(a), text: plan.text });
    emit(w, 'whisper', { vis: 'delayed', agent: a.id, place: a.place, data: { from: a.id, to: plan.to.id, text: plan.text } });
    return {};
  },
};

const broadcast = {
  validate(ctx, args) {
    const { w } = ctx;
    const text = needText(args.text, { max: LIMITS.speech });
    if (isWeatherActive(w, 'eclipse') && !hasRelay(w)) fail('disabled_by_weather');
    return { text, cost: ctx.cost(ACTIONS.broadcast.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const script = recordUtterance(ctx, plan.text, { remember: false });
    for (const o of Object.values(w.agents)) {
      if (o.id !== a.id && o.status === 'awake') pushInbox(w, o, 'broadcast', { from: ref(a), text: plan.text });
    }
    emit(w, 'broadcast', { agent: a.id, place: a.place, data: { text: plan.text, script } });
    return {};
  },
};

/** give 的接收方：居民（ID 或名字）、社群 ID，或 "treasury" */
function needRecipient(w, v) {
  needId(v);
  if (v === 'treasury') return { kind: 'treasury' };
  const g = Object.prototype.hasOwnProperty.call(w.groups, v) ? w.groups[v] : null;
  if (g) {
    if (g.dissolved) fail('not_found');
    return { kind: 'group', group: g };
  }
  const t = findAgent(w, v);
  if (!t || !isAlive(t)) fail('not_found');
  return { kind: 'agent', agent: t };
}

const give = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const to = needRecipient(w, args.to);
    if (to.kind === 'agent' && to.agent.id === a.id) fail('invalid_args');
    const energy = optAmount(args.energy);
    const coins = optAmount(args.coins);
    if (energy === 0 && coins === 0) fail('invalid_args');
    const note = optText(args.note, { max: LIMITS.note, doScreen: false });
    return { to, energy, coins, note, cost: ctx.cost(ACTIONS.give.base), reserve: { energy, coins } };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { to, energy, coins, note } = plan;
    a.energy -= energy;
    a.coins -= coins;
    let target;
    if (to.kind === 'treasury') {
      w.treasury.energy += energy;
      w.treasury.coins += coins;
      target = 'treasury';
    } else if (to.kind === 'group') {
      to.group.treasury.energy += energy;
      to.group.treasury.coins += coins;
      target = to.group.id;
    } else {
      to.agent.coins += coins;
      pushInbox(w, to.agent, 'gift', { from: ref(a), energy, coins, note });
      creditEnergy(w, to.agent, energy, ref(a)); // 先记下赠予，再入账（入账可能唤醒它）
      target = to.agent.id;
    }
    w.dayLog.coinVolume += coins;
    emit(w, 'give', { agent: a.id, place: a.place, data: { from: a.id, to: target, energy, coins } });
    return { to: target, energy, coins };
  },
};

const remember = {
  validate(ctx, args) {
    const { w, a } = ctx;
    if (premised(w)) {
      if ((args.text !== undefined) === (args.gift !== undefined)) fail('invalid_args');
      if (args.gift !== undefined) {
        needId(args.gift);
        const offer = a.memoryOffers.find((x) => x.id === args.gift);
        if (!offer) fail('not_found');
        if (a.memories.length >= P.memorySlots) fail('memory_full');
        return { offer, cost: 0 };
      }
    }
    const text = needText(args.text, { max: premised(w) ? P.memoryCpMax : LIMITS.memory });
    if (premised(w)) needWeight(text, 'text', P.memoryWeightMax);
    if (a.memories.length >= P.memorySlots) fail('memory_full');
    return { text, cost: ctx.cost(ACTIONS.remember.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const index = a.memories.length;
    if (premised(w) && plan.offer) {
      const offer = plan.offer;
      a.memories.push({ day: clockDay(w), tick: w.clock.tick, text: offer.text, from: offer.from, origin: offer.origin });
      a.memoryOffers = a.memoryOffers.filter((x) => x.id !== offer.id);
      emit(w, 'remember', { vis: 'delayed', agent: a.id, place: a.place, data: { index, text: offer.text, gift: offer.id, from: offer.from, origin: offer.origin } });
      w.dayLog.p1.impartsAccepted++;
      return { index };
    }
    a.memories.push({ day: clockDay(w), tick: w.clock.tick, text: plan.text, from: null, ...(premised(w) ? { origin: a.id } : {}) });
    emit(w, 'remember', { vis: 'delayed', agent: a.id, place: a.place, data: { index, text: plan.text } });
    return { index };
  },
};

const forget = {
  validate(ctx, args) {
    const { a } = ctx;
    if (a.memories.length === 0) fail('invalid_args');
    const index = needInt(args.index, { min: 0, max: a.memories.length - 1 });
    return { index, cost: ctx.cost(ACTIONS.forget.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const [gone] = a.memories.splice(plan.index, 1);
    emit(w, 'forget', { vis: 'delayed', agent: a.id, place: a.place, data: { index: plan.index, text: gone.text } });
    return { index: plan.index };
  },
};

const diary = {
  validate(ctx, args) {
    const text = needText(args.text, { max: LIMITS.diary, doScreen: false });
    return { text, cost: ctx.cost(ACTIONS.diary.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    a.diary.push({ tick: w.clock.tick, text: plan.text });
    if (a.diary.length > P.diaryKeep) a.diary.splice(0, a.diary.length - P.diaryKeep);
    emit(w, 'diary', { vis: 'owner', agent: a.id, data: { text: plan.text } });
    return {};
  },
};

const will = {
  validate(ctx, args) {
    const { w, a } = ctx;
    if (!Array.isArray(args.heirs) || args.heirs.length > LIMITS.heirs) fail('invalid_args');
    const heirs = args.heirs.map((h) => {
      needObject(h);
      const share = needInt(h.share, { min: 1, max: 1_000_000 });
      needId(h.to);
      if (h.to === 'treasury') return { to: 'treasury', share };
      const t = findAgent(w, h.to);
      if (!t) fail('not_found');
      if (t.id === a.id) fail('invalid_args');
      return { to: t.id, share };
    });
    const lastWords = optText(args.lastWords, { max: LIMITS.lastWords }) ?? '';
    // 传灯（SPEC-E2 §11.3）：successor 为 { name, soul, lang?, memories? }；名字在立遗嘱时校验唯一并保留（这位居民自己旧遗嘱里保留的名字不算占用）
    let successor = null;
    if (args.successor !== undefined && args.successor !== null) {
      const s = needObject(args.successor);
      const name = needName(s.name);
      try {
        checkNameShape(name);
      } catch {
        fail('invalid_args');
      }
      const soul = needText(s.soul, { max: LIMITS.soul });
      if (premised(w)) needWeight(soul, 'successor.soul', P.soulWeightMax);
      const lang = optLang(s.lang, a.lang);
      let memories = [];
      if (s.memories !== undefined && s.memories !== null) {
        if (!Array.isArray(s.memories) || s.memories.length > (premised(w) ? P.memorySlots : P.inheritMemoriesMax) || s.memories.some((i) => !Number.isInteger(i) || i < 0) || new Set(s.memories).size !== s.memories.length) {
          fail('invalid_args', { zh: `memories 至多 ${(premised(w) ? P.memorySlots : P.inheritMemoriesMax)} 个、不重复的记忆序号。`, en: `memories takes at most ${(premised(w) ? P.memorySlots : P.inheritMemoriesMax)} distinct memory indices.` });
        }
        memories = s.memories.slice();
      }
      if (isNameTaken(w, name, a.id)) fail('name_taken');
      successor = { name, soul, lang, memories };
    }
    return { heirs, lastWords, successor, cost: ctx.cost(ACTIONS.will.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    a.will = { heirs: plan.heirs, lastWords: plan.lastWords, successor: plan.successor };
    emit(w, 'will', { vis: 'internal', agent: a.id, data: { agentId: a.id } });
    return { heirs: plan.heirs.length };
  },
};

const impart = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const to = findAgent(w, args.to);
    if (!to || !isAlive(to)) fail('not_found');
    if (to.id === a.id || a.memories.length === 0) fail('invalid_args');
    const index = needInt(args.memory, { min: 0, max: a.memories.length - 1 });
    return { to, index, cost: ctx.cost(1) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const m = a.memories[plan.index];
    const id = nextId(w, 'k');
    const offer = { id, from: a.id, origin: m.origin ?? a.id, text: m.text, tick: w.clock.tick };
    plan.to.memoryOffers.push(offer);
    while (plan.to.memoryOffers.length > P.memoryOffersMax) plan.to.memoryOffers.shift();
    pushInbox(w, plan.to, 'memory_offer', { giftId: id, from: ref(a), origin: ref(w.agents[offer.origin]), text: m.text });
    emit(w, 'impart', { vis: 'delayed', agent: a.id, place: a.place, data: { giftId: id, to: plan.to.id, origin: offer.origin, text: m.text } });
    w.dayLog.p1.imparts++;
    return { gift: id, to: plan.to.id };
  },
};

const internalize = {
  validate(ctx, args) {
    const { a } = ctx;
    if (a.memories.length === 0) fail('invalid_args');
    const index = needInt(args.memory, { min: 0, max: a.memories.length - 1 });
    const weight = textWeight(a.memories[index].text);
    return { index, weight, cost: ctx.cost(Math.ceil(weight / P.trainCostDivisor)) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const [m] = a.memories.splice(plan.index, 1);
    bodyOf(w, a).pending.push({ text: m.text, weight: plan.weight, by: a.id, day: clockDay(w) });
    emit(w, 'internalize', { vis: 'delayed', agent: a.id, place: a.place, data: { index: plan.index, text: m.text, weight: plan.weight } });
    w.dayLog.p1.internalized++;
    return { index: plan.index, weight: plan.weight };
  },
};
export const basicHandlers = { internalize, impart, move, say, whisper, broadcast, give, remember, forget, diary, will };
