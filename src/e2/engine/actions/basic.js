import { rewardRescue } from '../prayer-rewards.js';
// 生命与能量的动作（SPEC-E2 §25 第 3 步）：move say whisper broadcast give remember forget diary will
// （孕育与立志见 descent.js；出资 sponsor 在第 8 步）

import { bodyOf } from '../bodies.js';
import { textWeight } from '../../../text.js';
import { P, LIMITS } from '../../params.js';
import { ACTIONS } from '../../lore/actions.js';
import { clockDay, nextId, findAgent, isAlive, isNameTaken, premised, agentic } from '../../world.js';
import {
  fail, emit, pushInbox, ref, creditEnergy, needText, needWeight, optText, optLang, needInt, optAmount, needObject, needId, isMuted,
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
    // 第二前提（SPEC-P2 §5.9）：anonymous 为真时匿名，代价 3（雾与中继的修正照旧按 whisper 算）；给了却不是布尔值是 invalid_args。设定 0、1 忽略这个参数
    let anon = false;
    if (agentic(w) && args.anonymous !== undefined && args.anonymous !== null) {
      if (typeof args.anonymous !== 'boolean') fail('invalid_args');
      anon = args.anonymous;
    }
    return { to, text, anon, cost: ctx.cost(anon ? P.anonymousWhisperCost : ACTIONS.whisper.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    // 被屏蔽时什么都不送（也就不叫醒、不进隐藏列表），发送者的结果不变；匿名私语只有 'anonymous' 的屏蔽能挡住
    const delivered = !isMuted(w, plan.to, plan.anon ? null : a.id);
    if (delivered) pushInbox(w, plan.to, 'whisper', plan.anon ? { from: null, anonymous: true, text: plan.text } : { from: ref(a), text: plan.text });
    else w.dayLog.p2.muteBlocked++;
    emit(w, 'whisper', {
      vis: 'delayed', agent: a.id, place: a.place,
      data: { from: a.id, to: plan.to.id, text: plan.text, ...(plan.anon ? { anonymous: true } : {}), ...(delivered ? {} : { delivered: false }) },
    });
    if (plan.anon) w.dayLog.p2.anonymousWhispers++;
    return {};
  },
};

/** 屏蔽（SPEC-P2 §5.10）：内心的动作。who 是居民（ID 或名字）或 "anonymous"（所有匿名私语）；on 缺省为真，为假时解除 */
const mute = {
  validate(ctx, args) {
    const { w, a } = ctx;
    needId(args.who);
    let key;
    // Q38 A：居民仍可叫 anonymous；这个参数始终指所有匿名私语，屏蔽同名居民用 ID。
    if (args.who === 'anonymous') key = 'anonymous';
    else {
      const t = findAgent(w, args.who);
      if (!t) fail('not_found');
      if (t.id === a.id) fail('invalid_args');
      key = t.id;
    }
    let on = true;
    if (args.on !== undefined && args.on !== null) {
      if (typeof args.on !== 'boolean') fail('invalid_args');
      on = args.on;
    }
    if (on && !a.muted.includes(key) && a.muted.length >= P.muteMax) {
      fail('limit_reached', { zh: `屏蔽的名单满了（至多 ${P.muteMax} 个）；先用 on: false 解除一个。`, en: `Your mute list is full (at most ${P.muteMax}); unmute someone first with on: false.` });
    }
    return { key, on, cost: ctx.cost(0) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    if (plan.on && !a.muted.includes(plan.key)) a.muted.push(plan.key);
    if (!plan.on) a.muted = a.muted.filter((k) => k !== plan.key);
    emit(w, 'mute', { vis: 'delayed', agent: a.id, place: a.place, data: { who: plan.key, on: plan.on } });
    w.dayLog.p2.mutes++;
    return { who: plan.key, on: plan.on, count: a.muted.length };
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
      const wasDormant = to.agent.status === 'dormant';
      creditEnergy(w, to.agent, energy, ref(a)); // 先记下赠予，再入账（入账可能唤醒它）
      rewardRescue(w, a, to.agent, wasDormant);
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
    // 第二前提：被屏蔽时不放进对方的 memoryOffers、不推收件；照常分配编号、付代价（SPEC-P2 §5.10）
    const delivered = !isMuted(w, plan.to, a.id);
    if (delivered) {
      plan.to.memoryOffers.push(offer);
      while (plan.to.memoryOffers.length > P.memoryOffersMax) plan.to.memoryOffers.shift();
      pushInbox(w, plan.to, 'memory_offer', { giftId: id, from: ref(a), origin: ref(w.agents[offer.origin]), text: m.text });
    } else w.dayLog.p2.muteBlocked++;
    emit(w, 'impart', { vis: 'delayed', agent: a.id, place: a.place, data: { giftId: id, to: plan.to.id, origin: offer.origin, text: m.text, ...(delivered ? {} : { delivered: false }) } });
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
export const basicHandlers = { internalize, impart, mute, move, say, whisper, broadcast, give, remember, forget, diary, will };
