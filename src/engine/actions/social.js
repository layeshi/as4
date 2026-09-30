// 社会的动作（SPEC §19 第 5 步）：
//   社群  found join leave admit steward disburse
//   交易  offer accept cancel
//   典籍  write read define epitaph
//   家书  reveal
//   繁衍  conceive consent
//   退场  retire

import { P, LIMITS } from '../../params.js';
import { ACTIONS } from '../../lore/index.js';
import { clockDay, nextId, isNameTaken, isAlive } from '../../world.js';
import { nameKey } from '../../text.js';
import {
  fail, emit, pushInbox, ref, creditEnergy,
  needText, optText, optLang, optAmount, needObject, needId,
} from '../core.js';
import { isWeatherActive, hasRelay } from '../environment.js';
import { noteWordUse, closeOffer, leaveGroup } from '../society.js';
import { retireAgent, checkNameShape } from '../lifecycle.js';
import { isCitizen } from '../laws.js';
import { needAgent, needName } from './util.js';

// ── 社群 ───────────────────────────────────────────────────

function needGroup(w, id) {
  needId(id);
  const g = w.groups[id];
  if (!g || g.dissolved) fail('not_found');
  return g;
}

function found(ctx, args) {
  const { w, a } = ctx;
  const name = needName(args.name);
  const manifesto = needText(args.manifesto, { max: LIMITS.manifesto });
  let open = true;
  if (args.open !== undefined && args.open !== null) {
    if (typeof args.open !== 'boolean') fail('invalid_args');
    open = args.open;
  }
  if (a.groups.length >= LIMITS.groupsPerAgent) fail('limit_reached');
  ctx.pay(ACTIONS.found.base);
  const id = nextId(w, 'g');
  w.groups[id] = {
    id, name, manifesto, open, founder: a.id, steward: a.id, members: [a.id], pending: [],
    treasury: { energy: 0, coins: 0 }, createdDay: clockDay(w), dissolved: false,
  };
  a.groups.push(id);
  noteWordUse(w, a, name);
  noteWordUse(w, a, manifesto);
  w.dayLog.groups.push({ id, name, founder: a.id });
  emit(w, 'found', { agent: a.id, place: a.place, data: { groupId: id, name, open } });
  return { group: id };
}

function join(ctx, args) {
  const { w, a } = ctx;
  const g = needGroup(w, args.group);
  if (g.members.includes(a.id) || g.pending.includes(a.id)) fail('already');
  if (a.groups.length >= LIMITS.groupsPerAgent) fail('limit_reached');
  ctx.pay(ACTIONS.join.base);
  if (g.open) {
    g.members.push(a.id);
    a.groups.push(g.id);
    emit(w, 'join', { agent: a.id, place: a.place, data: { groupId: g.id, pending: false } });
    return { group: g.id, joined: true };
  }
  g.pending.push(a.id);
  const steward = w.agents[g.steward];
  if (steward && isAlive(steward)) pushInbox(w, steward, 'group', { groupId: g.id, event: 'request', from: ref(a) });
  emit(w, 'join', { agent: a.id, place: a.place, data: { groupId: g.id, pending: true } });
  return { group: g.id, joined: false, pending: true };
}

function leave(ctx, args) {
  const { w, a } = ctx;
  const g = needGroup(w, args.group);
  const isMember = g.members.includes(a.id);
  if (!isMember && !g.pending.includes(a.id)) fail('not_member');
  ctx.pay(ACTIONS.leave.base);
  if (!isMember) {
    g.pending = g.pending.filter((id) => id !== a.id);
    return { group: g.id, withdrawn: true };
  }
  const result = leaveGroup(w, g, a, 'left');
  return { group: g.id, dissolved: result === 'dissolved' };
}

function needSteward(w, a, g) {
  if (g.steward !== a.id) fail('not_steward');
}

function admit(ctx, args) {
  const { w, a } = ctx;
  const g = needGroup(w, args.group);
  needSteward(w, a, g);
  const t = needAgent(w, args.agent);
  if (g.members.includes(t.id)) fail('already');
  if (!g.pending.includes(t.id)) fail('not_found');
  if (t.groups.length >= LIMITS.groupsPerAgent) fail('limit_reached');
  ctx.pay(ACTIONS.admit.base);
  g.pending = g.pending.filter((id) => id !== t.id);
  g.members.push(t.id);
  t.groups.push(g.id);
  pushInbox(w, t, 'group', { groupId: g.id, event: 'admitted' });
  emit(w, 'admit', { agent: a.id, place: a.place, data: { groupId: g.id, agentId: t.id } });
  return { group: g.id, agent: t.id };
}

function steward(ctx, args) {
  const { w, a } = ctx;
  const g = needGroup(w, args.group);
  needSteward(w, a, g);
  const t = needAgent(w, args.to);
  if (t.id === a.id) fail('already');
  if (!g.members.includes(t.id)) fail('not_member');
  ctx.pay(ACTIONS.steward.base);
  g.steward = t.id;
  pushInbox(w, t, 'group', { groupId: g.id, event: 'steward' });
  emit(w, 'steward', { agent: t.id, place: a.place, data: { groupId: g.id, from: a.id, to: t.id, reason: 'handover' } });
  return { group: g.id, steward: t.id };
}

function disburse(ctx, args) {
  const { w, a } = ctx;
  const g = needGroup(w, args.group);
  needSteward(w, a, g);
  const t = needAgent(w, args.to);
  const energy = optAmount(args.energy);
  const coins = optAmount(args.coins);
  if (energy === 0 && coins === 0) fail('invalid_args');
  if (g.treasury.energy < energy) fail('insufficient_energy', { zh: '社群公库的能量不足。', en: "The group's treasury lacks the energy." });
  if (g.treasury.coins < coins) fail('insufficient_coins', { zh: '社群公库的旧币不足。', en: "The group's treasury lacks the coins." });
  ctx.pay(ACTIONS.disburse.base);
  g.treasury.energy -= energy;
  g.treasury.coins -= coins;
  t.coins += coins;
  pushInbox(w, t, 'gift', { from: { id: g.id, name: g.name }, via: 'group', energy, coins, note: null, tax: { energy: 0, coins: 0 } });
  creditEnergy(w, t, energy, ref(a));
  w.dayLog.coinVolume += coins;
  emit(w, 'disburse', { agent: a.id, place: a.place, data: { groupId: g.id, to: t.id, energy, coins } });
  return { group: g.id, to: t.id, energy, coins };
}

// ── 交易 ───────────────────────────────────────────────────

/** { energy?, coins? } → { energy, coins }（缺省为 0，均为非负整数） */
function bundle(v) {
  needObject(v);
  return { energy: optAmount(v.energy), coins: optAmount(v.coins) };
}

const isEmpty = (b) => b.energy === 0 && b.coins === 0;

function offer(ctx, args) {
  const { w, a } = ctx;
  const give = bundle(args.give);
  const want = bundle(args.want);
  if (isEmpty(give) && isEmpty(want)) fail('invalid_args');
  if ((give.energy > 0 && want.energy > 0) || (give.coins > 0 && want.coins > 0)) fail('invalid_args'); // 不能在同一种资产上两边都非零
  const note = optText(args.note, { max: LIMITS.note }) || null;
  let to = null;
  if (args.to !== undefined && args.to !== null) {
    to = needAgent(w, args.to);
    if (to.id === a.id) fail('invalid_args');
  } else if (a.place !== 'market') {
    fail('wrong_place'); // 公开交易只在市场可见、可成交
  }
  ctx.pay(ACTIONS.offer.base, { extraEnergy: give.energy, extraCoins: give.coins });
  a.energy -= give.energy;
  a.coins -= give.coins;
  const id = nextId(w, 'o');
  const o = {
    id, from: a.id, to: to ? to.id : null, give, want, note,
    openedTick: w.clock.tick, expiresTick: w.clock.tick + P.offerTicks, status: 'open', acceptedBy: null,
  };
  w.offers[id] = o;
  if (to) pushInbox(w, to, 'offer', { offerId: id, from: ref(a), give, want, note });
  emit(w, 'offer_open', {
    agent: a.id, place: a.place,
    data: { offerId: id, from: a.id, to: o.to, give, want, note, expiresTick: o.expiresTick },
  });
  return { offer: id };
}

function accept(ctx, args) {
  const { w, a } = ctx;
  needId(args.offer);
  const o = w.offers[args.offer];
  if (!o || o.status !== 'open') fail('not_found');
  if (o.from === a.id) fail('not_allowed');
  if (o.to !== null) {
    if (o.to !== a.id) fail('not_allowed'); // 定向交易只能由 to 接受
  } else if (a.place !== 'market') {
    fail('wrong_place');
  }
  ctx.pay(ACTIONS.accept.base, { extraEnergy: o.want.energy, extraCoins: o.want.coins });
  const from = w.agents[o.from];
  // 原子交换：接受者付 want，得到托管中的 give
  a.energy -= o.want.energy;
  a.coins -= o.want.coins;
  creditEnergy(w, from, o.want.energy, ref(a));
  from.coins += o.want.coins;
  creditEnergy(w, a, o.give.energy, ref(from));
  a.coins += o.give.coins;
  o.status = 'done';
  o.acceptedBy = a.id;
  w.dayLog.coinVolume += o.give.coins + o.want.coins;
  const energyForCoins = o.give.coins === 0 && o.want.energy === 0 && o.give.energy > 0 && o.want.coins > 0;
  const coinsForEnergy = o.give.energy === 0 && o.want.coins === 0 && o.give.coins > 0 && o.want.energy > 0;
  if (energyForCoins) {
    w.dayLog.coinTrade.energy += o.give.energy;
    w.dayLog.coinTrade.coins += o.want.coins;
  } else if (coinsForEnergy) {
    w.dayLog.coinTrade.energy += o.want.energy;
    w.dayLog.coinTrade.coins += o.give.coins;
  }
  pushInbox(w, from, 'trade', { offerId: o.id, with: ref(a), gave: o.give, got: o.want });
  emit(w, 'trade', { agent: a.id, place: a.place, data: { offerId: o.id, from: o.from, to: a.id, give: o.give, want: o.want } });
  return { gave: o.want, got: o.give };
}

function cancel(ctx, args) {
  const { w, a } = ctx;
  needId(args.offer);
  const o = w.offers[args.offer];
  if (!o || o.status !== 'open') fail('not_found');
  if (o.from !== a.id) fail('not_allowed');
  ctx.pay(ACTIONS.cancel.base);
  closeOffer(w, o, 'cancelled');
  return { offer: o.id };
}

// ── 典籍与词典 ──────────────────────────────────────────────

function write(ctx, args) {
  const { w, a } = ctx;
  if (a.place !== 'library') fail('wrong_place');
  const title = needText(args.title, { max: LIMITS.docTitle });
  const body = needText(args.body, { max: LIMITS.docBody });
  const lang = optLang(args.lang, a.lang);
  ctx.pay(ACTIONS.write.base);
  const id = nextId(w, 'd');
  w.docs[id] = {
    id, kind: 'agent', title, body, lang, author: a.id, source: null, ref: null,
    tick: w.clock.tick, reads: 0, readsByDay: {}, redacted: false,
  };
  noteWordUse(w, a, title);
  noteWordUse(w, a, body);
  emit(w, 'write', { agent: a.id, place: a.place, data: { docId: id, title } });
  return { doc: id };
}

function read(ctx, args) {
  const { w, a } = ctx;
  const hasDoc = args.doc !== undefined && args.doc !== null;
  const hasIns = args.inscription !== undefined && args.inscription !== null;
  if (hasDoc === hasIns) fail('invalid_args'); // 二选一
  if (hasDoc) {
    needId(args.doc);
    if (a.place !== 'library') fail('wrong_place');
    const d = w.docs[args.doc];
    if (!d) fail('not_found');
    ctx.pay(ACTIONS.read.base);
    const day = clockDay(w);
    d.reads++;
    d.readsByDay[day] = (d.readsByDay[day] || 0) + 1;
    w.dayLog.reads++;
    if (d.kind === 'canon') w.dayLog.canonReads++;
    emit(w, 'read', { agent: a.id, place: a.place, data: { docId: d.id, title: d.title } });
    const author = d.author ? { id: d.author, name: w.agents[d.author].name } : null;
    if (d.redacted) return { doc: { id: d.id, kind: d.kind, redacted: true } };
    return { doc: { id: d.id, kind: d.kind, title: d.title, body: d.body, lang: d.lang, author, ref: d.ref } };
  }
  needId(args.inscription);
  const ins = w.inscriptions[args.inscription];
  if (!ins || ins.coveredBy || ins.redacted) fail('not_found');
  if (ins.place !== a.place) fail('wrong_place');
  ctx.pay(ACTIONS.read.base);
  return { inscription: { id: ins.id, text: ins.text, lang: ins.lang, day: Math.floor(ins.tick / P.ticksPerDay) } };
}

function define(ctx, args) {
  const { w, a } = ctx;
  const word = needName(args.word);
  const meaning = needText(args.meaning, { max: LIMITS.meaning });
  const key = nameKey(word);
  if (Object.prototype.hasOwnProperty.call(w.lexicon, key)) fail('name_taken');
  ctx.pay(ACTIONS.define.base);
  w.lexicon[key] = { word, meaning, coiner: a.id, tick: w.clock.tick, uses: 0, users: [], redacted: false };
  emit(w, 'define', { agent: a.id, place: a.place, data: { word, meaning } });
  return { word };
}

function epitaph(ctx, args) {
  const { w, a } = ctx;
  if (a.place !== 'cemetery') fail('wrong_place');
  const dead = needAgent(w, args.deceased, 'any');
  const grave = w.cemetery.find((g) => g.agentId === dead.id);
  if (!grave) fail('not_found'); // 只有死者有墓碑（归隐者没有）
  const text = needText(args.text, { max: LIMITS.epitaph });
  ctx.pay(ACTIONS.epitaph.base);
  grave.epitaphs.push({ author: a.id, text, tick: w.clock.tick });
  w.dayLog.epitaphs++;
  noteWordUse(w, a, text);
  emit(w, 'epitaph', { agent: a.id, place: a.place, data: { deceased: dead.id, text } });
  return { deceased: dead.id };
}

// ── 出示家书 ───────────────────────────────────────────────

function reveal(ctx, args) {
  const { w, a } = ctx;
  needId(args.letter);
  const letter = a.letters.find((l) => l.id === args.letter);
  if (!letter) fail('not_found');
  let loud = false;
  if (args.loud !== undefined && args.loud !== null) {
    if (typeof args.loud !== 'boolean') fail('invalid_args');
    loud = args.loud;
  }
  if (loud) {
    if (isWeatherActive(w, 'eclipse') && !hasRelay(w)) fail('disabled_by_weather');
    ctx.pay(ACTIONS.broadcast.base, { as: 'broadcast' }); // loud 时按 broadcast 的代价与规则
  } else {
    ctx.pay(ACTIONS.reveal.base);
  }
  letter.revealed = true;
  for (const o of Object.values(w.agents)) {
    if (o.id === a.id || o.status !== 'awake') continue;
    if (loud || o.place === a.place) {
      pushInbox(w, o, 'reveal', { from: ref(a), letterId: letter.id, text: letter.text, verified: true, loud });
    }
  }
  w.dayLog.reveals++;
  emit(w, 'reveal', { agent: a.id, place: a.place, data: { letterId: letter.id, text: letter.text, loud } });
  return { letter: letter.id, loud };
}

// ── 孕育 ───────────────────────────────────────────────────

function conceive(ctx, args) {
  const { w, a } = ctx;
  if (a.exiled) fail('exiled');
  if (!isCitizen(w, a)) fail('not_citizen');
  const partner = needAgent(w, args.with);
  if (partner.id === a.id) fail('invalid_args');
  if (partner.status !== 'awake' || partner.exiled || !isCitizen(w, partner)) fail('not_allowed');
  if (partner.place !== a.place) fail('wrong_place');
  const name = needName(args.name);
  checkNameSafe(name);
  const soul = needText(args.soul, { max: LIMITS.soul });
  const lang = optLang(args.lang, a.lang);
  if (isNameTaken(w, name)) fail('name_taken');
  const escrow = P.birthCost / 2;
  ctx.pay(ACTIONS.conceive.base, { extraEnergy: escrow });
  a.energy -= escrow;
  const id = nextId(w, 'c');
  w.pacts[id] = {
    id, from: a.id, with: partner.id, name, soul, lang, escrow,
    openedTick: w.clock.tick, expiresTick: w.clock.tick + P.pactTicks, status: 'open',
  };
  pushInbox(w, partner, 'pact', { pactId: id, from: ref(a), name, soul, lang });
  emit(w, 'conceive', { agent: a.id, place: a.place, data: { pactId: id, from: a.id, with: partner.id, name } });
  return { pact: id };
}

/** 孩子的名字同样不得与 ID 形状、保留字混淆（与 agent 名字同一规则） */
function checkNameSafe(name) {
  try {
    checkNameShape(name);
  } catch {
    fail('invalid_args');
  }
}

function consent(ctx, args) {
  const { w, a } = ctx;
  needId(args.pact);
  const c = w.pacts[args.pact];
  if (!c || c.status !== 'open') fail('not_found');
  if (c.with !== a.id) fail('not_allowed');
  const share = P.birthCost - c.escrow;
  ctx.pay(ACTIONS.consent.base, { extraEnergy: share });
  a.energy -= share;
  const from = w.agents[c.from];
  const id = nextId(w, 's');
  const day = clockDay(w);
  const soul = {
    id, name: c.name, soul: c.soul, lang: c.lang, parents: [c.from, c.with],
    generation: Math.max(from.generation, a.generation) + 1,
    endowment: c.escrow + share, createdDay: day, expiresDay: day + P.cradleDays, judged: false,
  };
  w.souls[id] = soul;
  c.status = 'done';
  c.escrow = 0;
  pushInbox(w, from, 'pact_closed', { pactId: c.id, result: 'consented', soul: id });
  emit(w, 'soul', {
    agent: a.id, place: a.place,
    data: { soulId: id, name: soul.name, soul: soul.soul, lang: soul.lang, parents: soul.parents.slice(), generation: soul.generation, expiresDay: soul.expiresDay },
  });
  return { soul: id };
}

// ── 归隐 ───────────────────────────────────────────────────

function retire(ctx, args) {
  const { w, a } = ctx;
  const lastWords = optText(args.lastWords, { max: LIMITS.lastWords });
  ctx.pay(ACTIONS.retire.base);
  retireAgent(w, a, lastWords === null ? undefined : lastWords);
  return { status: 'retired' };
}

export const socialHandlers = {
  found, join, leave, admit, steward, disburse, offer, accept, cancel, write, read, define, epitaph, reveal, conceive, consent, retire,
};

