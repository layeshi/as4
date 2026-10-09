import { ep } from './tokens.js';
// SPEC-E2 §11：灵魂与出生——孕育（1–5 位作者）、灵魂、传灯、出生地、领养。
//
// 灵魂（Soul）是摇篮里等待身体的人：作者们写下它的名字与灵魂，付出它的初始能量（endowment，共 birthCost = 40，由作者们平摊）。
// 它在摇篮里等一个身体——被真实世界的玩家领养（adopt）、被城出资买下的躯壳（§12）、或沙盘里的沙盘脑——然后出生为居民。
// 到期仍没有身体的灵魂消散（§12.4，第 8 步）。
//
// 灵魂的形状（SPEC-E2 §4.7）：
//   { id, name, soul, lang, authors, generation, endowment, inheritedMemories: [{ from, text }], cradle, createdDay, expiresDay,
//     fund, sponsors, fundedTick, queueExpiresDay, successorOf, judged }

import { P } from '../params.js';
import { nextId, clockDay, isAlive, isNameTaken, premised } from '../world.js';
import { sink } from './ledger.js';
import { emit, pushInbox, creditEnergy } from './core.js';
import { endowedEnergy, hasModuleAt } from './places.js';
import { makeAgent } from './lifecycle.js';
import { hooks } from './hooks.js';

// ── 生成灵魂 ───────────────────────────────────────────────

/**
 * 生成一个灵魂并放进摇篮（w.souls）。
 * o：{ name, soul, lang, authors（发起者在前）, endowment, inheritedMemories, cradle, successorOf }
 * generation = max(作者的世代) + 1；expiresDay = 今日 + cradleDays；事件 soul（agent 书写的灵魂公开）。
 */
export function createSoul(w, o) {
  const id = nextId(w, 's');
  const day = clockDay(w);
  const generation = Math.max(0, ...o.authors.map((x) => w.agents[x].generation)) + 1;
  const s = {
    id,
    name: o.name,
    soul: o.soul,
    lang: o.lang,
    authors: o.authors.slice(),
    generation,
    endowment: o.endowment,
    inheritedMemories: (o.inheritedMemories || []).map((m) => ({ from: m.from, text: m.text, ...(premised(w) ? { origin: m.origin ?? m.from } : {}) })),
    cradle: o.cradle ?? null,
    createdDay: day,
    expiresDay: day + P.cradleDays,
    fund: 0,
    sponsors: {},
    fundedTick: null,
    queueExpiresDay: null,
    successorOf: o.successorOf ?? null,
    judged: false,
  };
  w.souls[id] = s;
  emit(w, 'soul', {
    data: {
      soulId: id, name: s.name, soul: s.soul, lang: s.lang, authors: s.authors.slice(), generation, cradle: s.cradle, expiresDay: s.expiresDay,
      ...(s.successorOf ? { successorOf: s.successorOf } : {}),
    },
  });
  return s;
}

// ── 出生 ───────────────────────────────────────────────────

/** 一个地点是否有运转中的摇篮 */
const hasCradle = (w, placeId) => hasModuleAt(w, placeId, 'cradle');

/**
 * 出生地（§11.4 第 1 步）：灵魂的 cradle 若仍有运转中的摇篮则用它；否则地点顺序中第一个有运转中的摇篮的地点；都没有则港口。
 * 返回 { place, via: 'chosen' | 'first' | 'port' }（via 只是说明用的）。
 */
export function birthPlaceOf(w, soul) {
  if (soul.cradle && w.places[soul.cradle] && hasCradle(w, soul.cradle)) return soul.cradle;
  for (const p of Object.values(w.places)) if (hasCradle(w, p.id)) return p.id;
  return 'port';
}

/** 退回出资：每位出资者取回自己出的（来源是居民时可能唤醒；社群进社群公库；公库回城公库），余数进公库。fund 清零 */
export function refundSponsors(w, soul, by = null) {
  const refunds = [];
  let rest = soul.fund;
  for (const [key, amount] of Object.entries(soul.sponsors)) {
    if (amount <= 0) continue;
    rest -= amount;
    if (key === 'treasury') w.treasury.energy += amount;
    else if (w.groups[key]) {
      const g = w.groups[key];
      if (g.dissolved) w.treasury.energy += amount;
      else g.treasury.energy += amount;
    } else {
      const a = w.agents[key];
      if (a && isAlive(a)) creditEnergy(w, a, amount, by);
      else w.treasury.energy += amount;
    }
    refunds.push({ to: key, energy: amount });
  }
  if (rest > 0) w.treasury.energy += rest;
  soul.fund = 0;
  soul.sponsors = {};
  return refunds;
}

/**
 * 从摇篮里的灵魂生出一位居民（领养、躯壳、沙盘领养共用，§11.4）。
 * o：{ via: 'adopt' | 'shell' | 'sandbox', kind, model, mustSeal, shell, temperament, owner, tokenHash, extraEnergy }
 *   extraEnergy：躯壳出资的余额（fund − shellCost），加在初始能量之上（调用者已把它从灵魂的出资里划出，记在居民身上）。
 * 初始能量 = endowedEnergy(出生地的完好度, endowment)，差额记去处 cradle_loss；记忆遗传；作者的 children 加入它；事件 born（触发 on:born）；
 * 向（在世的）作者发收件 soul（adopted / embodied）。
 */
export function bornFromSoul(w, soul, o) {
  const place = birthPlaceOf(w, soul);
  const energy = endowedEnergy(w, place, soul.endowment);
  sink(w, 'energy', 'cradle_loss', soul.endowment - energy);
  const day = clockDay(w);
  const a = makeAgent(w, {
    name: soul.name,
    lang: soul.lang,
    bio: '',
    soul: soul.soul,
    generation: soul.generation,
    authors: soul.authors.slice(),
    kind: o.kind,
    model: o.model,
    mustSeal: o.mustSeal,
    shell: o.shell,
    temperament: o.temperament,
    owner: o.owner ?? null,
    tokenHash: o.tokenHash ?? null,
    energy: energy + (o.extraEnergy || 0),
    coins: 0,
    place,
  });
  for (const m of soul.inheritedMemories.slice(0, P.memorySlots)) a.memories.push({ day, tick: w.clock.tick, text: m.text, from: m.from, ...(premised(w) ? { origin: m.origin ?? m.from } : {}) });
  // TODO(spec): Q27 — confirmed: fork bookkeeping and its chronicle line land in step 5.
  if (premised(w) && soul.authors.length === 1) {
    const author = w.agents[soul.authors[0]];
    if (author && soul.soul === author.soul) w.dayLog.p1.forks.push({ id: a.id, name: a.name, author: author.id, authorName: author.name });
  }
  delete w.souls[soul.id];
  for (const id of soul.authors) if (w.agents[id]) w.agents[id].children.push(a.id);
  const p = w.places[place];
  p.activity.visits++;
  p.activity.lastActiveDay = day;
  w.dayLog.births.push({ id: a.id, name: a.name, authors: soul.authors.slice(), place, via: o.via, memories: a.memories.length });
  if (o.via === 'adopt') w.dayLog.adoptions.push({ soulId: soul.id, agentId: a.id });
  emit(w, 'born', { agent: a.id, place, data: { agentId: a.id, name: a.name, authors: soul.authors.slice(), place, via: o.via, generation: a.generation } });
  const event = o.via === 'adopt' ? 'adopted' : 'embodied';
  const told = new Set([...soul.authors, ...Object.keys(soul.sponsors || {})]);
  for (const id of told) {
    const x = w.agents[id];
    if (x && isAlive(x) && x.id !== a.id) pushInbox(w, x, 'soul', { soulId: soul.id, name: soul.name, event });
  }
  hooks.fire(w, 'born', { agent: a.id });
  return a;
}

// ── 传灯（§11.3） ────────────────────────────────────────────

/**
 * 立遗嘱者死去或归隐时，在分配遗产之前：取 e = min(successorMax, 它的能量) 作为继承灵魂的初始能量，
 * 生成灵魂（authors = [它]、世代 + 1、记忆按 successor.memories 的序号取它此刻的记忆，越界的跳过，至多 inheritMemoriesMax 条），事件 successor。
 * 名字已被别人占用（理论上不会，因为立遗嘱时已保留）时不生成，记事件（failed）。返回灵魂或 null。
 */
export function lightSuccessor(w, a) {
  const s = a.will && a.will.successor;
  if (!s) return null;
  if (isNameTaken(w, s.name, a.id)) {
    emit(w, 'successor', { agent: a.id, data: { from: a.id, name: s.name, failed: true } });
    return null;
  }
  const e = Math.min(ep(w, 'successorMax'), a.energy);
  a.energy -= e;
  const memories = [];
  for (const i of s.memories || []) {
    if (Number.isInteger(i) && i >= 0 && i < a.memories.length && memories.length < (premised(w) ? P.memorySlots : P.inheritMemoriesMax)) memories.push({ from: a.id, text: a.memories[i].text, ...(premised(w) ? { origin: a.memories[i].origin ?? a.id } : {}) });
  }
  const soul = createSoul(w, { name: s.name, soul: s.soul, lang: s.lang, authors: [a.id], endowment: e, inheritedMemories: memories, successorOf: a.id });
  w.dayLog.successors.push({ from: a.id, soulId: soul.id, name: soul.name });
  emit(w, 'successor', { agent: a.id, data: { from: a.id, soulId: soul.id, name: soul.name } });
  return soul;
}
