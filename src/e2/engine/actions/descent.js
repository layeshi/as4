// 后代与目的的动作（SPEC-E2 §25 第 7 步）：conceive consent declare。
// （will 的 successor 在 basic.js。）
// sponsor 为摇篮里的灵魂购买躯壳出资（第 8 步，§12.2）。
//
// conceive 写下一个新的灵魂：1–5 位作者（发起者 + with 里的 0–4 位，须同在一地、醒着）。灵魂的初始能量 birthCost = 40，由作者们平摊
//   （k 位作者：每人 floor(40 / k)，余数由发起者付）。没有共同作者（分灵）时立即进入摇篮；否则生成孕育之约，pactTicks 刻内全部同意才进入摇篮，
//   过期则退回所有已付的份额。
// consent 同意一份孕育之约，付自己的份额。
// declare 写下或改写公开的「志」与自我介绍。

import { P, LIMITS } from '../../params.js';
import { ACTIONS } from '../../lore/actions.js';
import { clockDay, nextId, findAgent, isAlive, isNameTaken } from '../../world.js';
import { fail, emit, pushInbox, ref, needText, optText, optLang, needId, needInt } from '../core.js';
import { credit } from '../accounts.js';
import { hasModuleAt } from '../places.js';
import { checkNameShape } from '../lifecycle.js';
import { createSoul } from '../souls.js';
import { noteWordUse } from '../society.js';
import { needName } from './util.js';

const given = (v) => v !== undefined && v !== null;

/** 孩子的名字同样不得与 ID 形状、保留字混淆（与居民的名字同一规则） */
function needChildName(args) {
  const name = needName(args.name);
  try {
    checkNameShape(name);
  } catch {
    fail('invalid_args');
  }
  return name;
}

/** 记忆序号：至多 inheritMemoriesMax 条、不重复、是自己记忆里的序号。返回复制下来的文本 [{ text }] */
function pickMemories(a, v) {
  if (!given(v)) return [];
  if (!Array.isArray(v) || v.length > P.inheritMemoriesMax) fail('invalid_args', { zh: `memories 至多 ${P.inheritMemoriesMax} 个序号。`, en: `memories takes at most ${P.inheritMemoriesMax} indices.` });
  const seen = new Set();
  const out = [];
  for (const i of v) {
    if (!Number.isInteger(i) || i < 0 || i >= a.memories.length || seen.has(i)) fail('invalid_args', { zh: 'memories 须是你自己的、不重复的记忆序号。', en: 'memories must be distinct indices of your own memories.' });
    seen.add(i);
    out.push({ text: a.memories[i].text });
  }
  return out;
}

/** 份额（§11.1）：k 位作者，每人 floor(birthCost / k)，余数由发起者付 */
export function sharesFor(k) {
  const each = Math.floor(P.birthCost / k);
  return { each, initiator: P.birthCost - each * (k - 1) };
}

const conceive = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const name = needChildName(args);
    const soul = needText(args.soul, { max: LIMITS.soul });
    const lang = optLang(args.lang, a.lang);
    // 共同作者：0–4 位不重复、不是自己的 ID；每一位在世、醒着、与你同在一地
    let withIds = [];
    if (given(args.with)) {
      if (!Array.isArray(args.with) || args.with.length > P.authorsMax - 1) fail('invalid_args', { zh: `with 至多 ${P.authorsMax - 1} 位共同作者。`, en: `with takes at most ${P.authorsMax - 1} co-authors.` });
      for (const ref0 of args.with) {
        needId(ref0);
        const t = findAgent(w, ref0);
        if (!t || !isAlive(t)) fail('not_found');
        if (t.id === a.id || withIds.includes(t.id)) fail('invalid_args');
        if (t.status !== 'awake') fail('not_allowed', { zh: '共同作者须醒着。', en: 'A co-author must be awake.' });
        if (t.place !== a.place) fail('wrong_place', { zh: '共同作者须与你同在一地。', en: 'A co-author must be at the same place as you.' });
        withIds.push(t.id);
      }
    }
    const memories = pickMemories(a, args.memories);
    let cradle = null;
    if (given(args.cradle)) {
      needId(args.cradle);
      if (!Object.prototype.hasOwnProperty.call(w.places, args.cradle)) fail('not_found');
      if (!hasModuleAt(w, args.cradle, 'cradle')) fail('no_module', null, { module: 'cradle' });
      cradle = args.cradle;
    }
    if (isNameTaken(w, name)) fail('name_taken');
    const k = 1 + withIds.length;
    const { initiator } = sharesFor(k);
    return { name, soul, lang, withIds, memories, cradle, k, share: initiator, cost: ctx.cost(ACTIONS.conceive.base), reserve: { energy: initiator } };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    a.energy -= plan.share;
    const authors = [a.id, ...plan.withIds];
    if (plan.k === 1) {
      // 分灵：付 40，立即生成灵魂
      const s = createSoul(w, {
        name: plan.name, soul: plan.soul, lang: plan.lang, authors, endowment: plan.share,
        inheritedMemories: plan.memories.map((m) => ({ from: a.id, text: m.text })), cradle: plan.cradle,
      });
      noteWordUse(w, a, plan.soul);
      return { soul: s.id };
    }
    const id = nextId(w, 'c');
    const { each } = sharesFor(plan.k);
    const shares = {};
    for (const x of authors) shares[x] = x === a.id ? plan.share : each;
    w.pacts[id] = {
      id, from: a.id, authors, shares,
      consents: { [a.id]: { paid: plan.share, memories: plan.memories } },
      name: plan.name, soul: plan.soul, lang: plan.lang, cradle: plan.cradle,
      escrow: plan.share, openedTick: w.clock.tick, expiresTick: w.clock.tick + P.pactTicks, status: 'open',
    };
    for (const x of plan.withIds) pushInbox(w, w.agents[x], 'pact', { pactId: id, from: ref(a), name: plan.name, soul: plan.soul, lang: plan.lang, authors: authors.map((y) => ref(w.agents[y])) });
    emit(w, 'pact_open', { agent: a.id, place: a.place, data: { pactId: id, authors: authors.slice(), name: plan.name } });
    return { pact: id };
  },
};

const consent = {
  validate(ctx, args) {
    const { w, a } = ctx;
    needId(args.pact);
    const c = Object.prototype.hasOwnProperty.call(w.pacts, args.pact) ? w.pacts[args.pact] : null;
    if (!c || c.status !== 'open') fail('not_found');
    if (!c.authors.includes(a.id)) fail('not_allowed', { zh: '你不是这份孕育之约的共同作者。', en: 'You are not a co-author of this pact.' });
    if (Object.prototype.hasOwnProperty.call(c.consents, a.id)) fail('already');
    const share = c.shares[a.id];
    const memories = pickMemories(a, args.memories);
    return { c, share, memories, cost: ctx.cost(ACTIONS.consent.base), reserve: { energy: share } };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { c } = plan;
    a.energy -= plan.share;
    c.consents[a.id] = { paid: plan.share, memories: plan.memories };
    c.escrow += plan.share;
    if (Object.keys(c.consents).length < c.authors.length) {
      return { pact: c.id, done: false, waiting: c.authors.filter((x) => !Object.prototype.hasOwnProperty.call(c.consents, x)) };
    }
    // 全部同意：生成灵魂（记忆按作者顺序、各自交出的顺序），约结束
    const memories = [];
    for (const x of c.authors) for (const m of c.consents[x].memories) memories.push({ from: x, text: m.text });
    const s = createSoul(w, { name: c.name, soul: c.soul, lang: c.lang, authors: c.authors, endowment: c.escrow, inheritedMemories: memories, cradle: c.cradle });
    c.status = 'done';
    c.escrow = 0;
    noteWordUse(w, a, c.soul);
    for (const x of c.authors) {
      const author = w.agents[x];
      if (author && isAlive(author)) pushInbox(w, author, 'pact_closed', { pactId: c.id, result: 'consented', soul: s.id });
    }
    return { pact: c.id, done: true, soul: s.id };
  },
};

const declare = {
  validate(ctx, args) {
    const hasPurpose = given(args.purpose);
    const hasBio = given(args.bio);
    if (!hasPurpose && !hasBio) fail('invalid_args', { zh: 'declare 要给 purpose（志）或 bio（自我介绍）至少一个。', en: 'declare needs at least one of purpose and bio.' });
    const purpose = hasPurpose ? optText(args.purpose, { max: LIMITS.purpose, min: 0 }) : undefined;
    const bio = hasBio ? optText(args.bio, { max: LIMITS.bio, min: 0 }) : undefined;
    return { purpose, bio, cost: ctx.cost(ACTIONS.declare.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    if (plan.purpose !== undefined) {
      a.purpose = plan.purpose === '' ? null : plan.purpose;
      a.purposeHistory.push({ day: clockDay(w), text: plan.purpose });
      while (a.purposeHistory.length > P.purposeKeep) a.purposeHistory.shift();
      w.dayLog.purposeChanges++;
      if (plan.purpose) noteWordUse(w, a, plan.purpose);
    }
    if (plan.bio !== undefined) {
      a.bio = plan.bio;
      if (plan.bio) noteWordUse(w, a, plan.bio);
    }
    emit(w, 'declare', { agent: a.id, place: a.place, data: { agentId: a.id, purpose: a.purpose, bio: a.bio } });
    return { purpose: a.purpose, bio: a.bio };
  },
};

const sponsor = {
  validate(ctx, args) {
    const { w, a } = ctx;
    needId(args.soul);
    const soul = Object.prototype.hasOwnProperty.call(w.souls, args.soul) ? w.souls[args.soul] : null;
    if (!soul) fail('not_found');
    const energy = needInt(args.energy);
    if (energy > a.energy) fail('insufficient_energy');
    // 投入的能量就是代价：由 apply 直接划给灵魂的出资（不是动作代价），框架先核对余额
    return { soul, energy, cost: 0, reserve: { energy } };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { soul, energy } = plan;
    a.energy -= energy;
    ctx.invested(energy);
    credit(w, { k: 'soul', id: soul.id }, energy, 0, ref(a), { k: 'agent', id: a.id });
    emit(w, 'sponsor', { agent: a.id, place: a.place, data: { soulId: soul.id, from: a.id, energy, fund: soul.fund } });
    return { fund: soul.fund, cost: P.shellCost, queued: soul.fundedTick !== null };
  },
};

export const descentHandlers = { conceive, consent, declare, sponsor };
