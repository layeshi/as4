// 生命与能量的动作（SPEC §19 第 2 步）：move say whisper broadcast give remember forget diary will

import { P, LIMITS } from '../../params.js';
import { ACTIONS } from '../../lore/index.js';
import { clockDay, findAgent, isAlive } from '../../world.js';
import {
  fail, emit, pushInbox, ref, creditEnergy,
  needText, optText, needInt, optAmount, needObject, needId, toPermille, mulPermille,
} from '../core.js';
import { hasRelay, isWeatherActive, roadFree } from '../environment.js';
import { needPlace, needAgent, recordUtterance } from './util.js';

function move(ctx, args) {
  const { w, a } = ctx;
  const to = needPlace(args.to);
  if (to === a.place) fail('already');
  if (a.exiled && to !== 'wilds') fail('exiled');
  const from = a.place;
  // 正常运转的道路两端之间为 0；否则按基础代价（在出发地的倍率下）
  ctx.pay(roadFree(w, from, to) ? 0 : ACTIONS.move.base);
  a.place = to;
  w.places[to].activity.visits++;
  emit(w, 'move', { agent: a.id, place: to, data: { from, to } });
  return { place: to };
}

function say(ctx, args) {
  const { w, a } = ctx;
  const text = needText(args.text, { max: LIMITS.speech });
  ctx.pay(ACTIONS.say.base);
  const script = recordUtterance(ctx, text);
  for (const o of Object.values(w.agents)) {
    if (o.id !== a.id && o.status === 'awake' && o.place === a.place) {
      pushInbox(w, o, 'say', { from: ref(a), place: a.place, text });
    }
  }
  emit(w, 'say', { agent: a.id, place: a.place, data: { text, script } });
  return {};
}

function whisper(ctx, args) {
  const { w, a } = ctx;
  const to = needAgent(w, args.to);
  if (to.id === a.id) fail('invalid_args');
  const text = needText(args.text, { max: LIMITS.speech });
  ctx.pay(ACTIONS.whisper.base);
  pushInbox(w, to, 'whisper', { from: ref(a), text });
  emit(w, 'whisper', { vis: 'delayed', agent: a.id, place: a.place, data: { from: a.id, to: to.id, text } });
  return {};
}

function broadcast(ctx, args) {
  const { w, a } = ctx;
  const text = needText(args.text, { max: LIMITS.speech });
  if (isWeatherActive(w, 'eclipse') && !hasRelay(w)) fail('disabled_by_weather');
  ctx.pay(ACTIONS.broadcast.base);
  const script = recordUtterance(ctx, text, { remember: false });
  for (const o of Object.values(w.agents)) {
    if (o.id !== a.id && o.status === 'awake') pushInbox(w, o, 'broadcast', { from: ref(a), text });
  }
  emit(w, 'broadcast', { agent: a.id, place: a.place, data: { text, script } });
  return {};
}

/** give 的接收方：agent（ID 或名字）、社群 ID，或 "treasury" */
function needRecipient(w, v) {
  needId(v);
  if (v === 'treasury') return { kind: 'treasury' };
  const g = w.groups[v];
  if (g) {
    if (g.dissolved) fail('not_found');
    return { kind: 'group', group: g };
  }
  const t = findAgent(w, v);
  if (!t || !isAlive(t)) fail('not_found');
  return { kind: 'agent', agent: t };
}

function give(ctx, args) {
  const { w, a } = ctx;
  const to = needRecipient(w, args.to);
  if (to.kind === 'agent' && to.agent.id === a.id) fail('invalid_args');
  const energy = optAmount(args.energy);
  const coins = optAmount(args.coins);
  if (energy === 0 && coins === 0) fail('invalid_args');
  const note = optText(args.note, { max: LIMITS.note, doScreen: false });
  const taxRate = toPermille(w.params.transferTax);
  const taxE = mulPermille(energy, taxRate);
  const taxC = mulPermille(coins, taxRate);
  ctx.pay(ACTIONS.give.base, { extraEnergy: energy, extraCoins: coins });
  a.energy -= energy;
  a.coins -= coins;
  const netE = energy - taxE;
  const netC = coins - taxC;
  w.treasury.energy += taxE;
  w.treasury.coins += taxC;
  let target;
  if (to.kind === 'treasury') {
    w.treasury.energy += netE;
    w.treasury.coins += netC;
    target = 'treasury';
  } else if (to.kind === 'group') {
    to.group.treasury.energy += netE;
    to.group.treasury.coins += netC;
    target = to.group.id;
  } else {
    to.agent.coins += netC;
    pushInbox(w, to.agent, 'gift', { from: ref(a), energy: netE, coins: netC, note, tax: { energy: taxE, coins: taxC } });
    creditEnergy(w, to.agent, netE, ref(a)); // 先记下赠予，再入账（入账可能唤醒它）
    target = to.agent.id;
  }
  // TODO(spec): Q3 —— 同 economy.js：tax 收件的 kind 字段冲突，暂用 taxKind
  if (taxE > 0) pushInbox(w, a, 'tax', { taxKind: 'transfer', energy: taxE });
  w.dayLog.coinVolume += coins;
  emit(w, 'give', { agent: a.id, place: a.place, data: { from: a.id, to: target, energy, coins, tax: { energy: taxE, coins: taxC } } });
  return { to: target, energy, coins, tax: { energy: taxE, coins: taxC } };
}

function remember(ctx, args) {
  const { w, a } = ctx;
  const text = needText(args.text, { max: LIMITS.memory });
  if (a.memories.length >= P.memorySlots) fail('memory_full');
  ctx.pay(ACTIONS.remember.base);
  const index = a.memories.length;
  a.memories.push({ day: clockDay(w), tick: w.clock.tick, text });
  emit(w, 'remember', { vis: 'delayed', agent: a.id, place: a.place, data: { index, text } });
  return { index };
}

function forget(ctx, args) {
  const { w, a } = ctx;
  if (a.memories.length === 0) fail('invalid_args');
  const index = needInt(args.index, { min: 0, max: a.memories.length - 1 });
  ctx.pay(ACTIONS.forget.base);
  const [gone] = a.memories.splice(index, 1);
  emit(w, 'forget', { vis: 'delayed', agent: a.id, place: a.place, data: { index, text: gone.text } });
  return { index };
}

function diary(ctx, args) {
  const { w, a } = ctx;
  const text = needText(args.text, { max: LIMITS.diary, doScreen: false });
  ctx.pay(ACTIONS.diary.base);
  a.diary.push({ tick: w.clock.tick, text });
  if (a.diary.length > P.diaryKeep) a.diary.splice(0, a.diary.length - P.diaryKeep);
  emit(w, 'diary', { vis: 'owner', agent: a.id, data: { text } });
  return {};
}

function will(ctx, args) {
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
  ctx.pay(ACTIONS.will.base);
  a.will = { heirs, lastWords };
  emit(w, 'will', { vis: 'internal', agent: a.id, data: { agentId: a.id } });
  return { heirs: heirs.length };
}

export const basicHandlers = { move, say, whisper, broadcast, give, remember, forget, diary, will };
