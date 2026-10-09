import { tokenized } from '../../world.js';
import { jsonWeight } from '../tokens.js';
import { costMultiplierBp } from '../places.js';
// 社会的动作（SPEC-E2 §25 第 3 步）：
//   社群  found join leave admit steward disburse
//   交易  offer accept cancel
//   典籍  write read define epitaph
//   家书  reveal
//   退场  retire
// （立法 propose vote draft refound sign rules 在第 4–5 步；孕育 conceive consent、立志 declare 在第 7 步；出资 sponsor 在第 8 步）

import { P, LIMITS } from '../../params.js';
import { ACTIONS } from '../../lore/actions.js';
import { clockDay, nextId, isAlive, findAgent } from '../../world.js';
import { nameKey } from '../../../text.js';
import {
  fail, emit, pushInbox, ref, creditEnergy, needText, optText, optLang, optAmount, needObject, needId, isMuted,
} from '../core.js';
import { hasRelay, hasModuleAt } from '../places.js';
import { isWeatherActive } from '../environment.js';
import { noteWordUse, closeOffer, leaveGroup } from '../society.js';
import { retireAgent } from '../lifecycle.js';
import { lawView } from '../laws.js';
import { agentProfile } from '../profile.js';
import { needAgent, needName } from './util.js';

// ── 社群 ───────────────────────────────────────────────────

export function needGroup(w, id) {
  needId(id);
  const g = Object.prototype.hasOwnProperty.call(w.groups, id) ? w.groups[id] : null;
  if (!g || g.dissolved) fail('not_found');
  return g;
}

const GROUP_PROCEDURES = ['steward', 'members'];

const found = {
  validate(ctx, args) {
    const { a } = ctx;
    const name = needName(args.name);
    const manifesto = needText(args.manifesto, { max: LIMITS.manifesto });
    let open = true;
    if (args.open !== undefined && args.open !== null) {
      if (typeof args.open !== 'boolean') fail('invalid_args');
      open = args.open;
    }
    let procedure = 'steward';
    if (args.procedure !== undefined && args.procedure !== null) {
      if (!GROUP_PROCEDURES.includes(args.procedure)) fail('invalid_args', { zh: 'procedure 须为 "steward"（管事决定章程）或 "members"（成员多数决）。', en: 'procedure must be "steward" (the steward decides the bylaws) or "members" (majority of members).' });
      procedure = args.procedure;
    }
    if (a.groups.length >= LIMITS.groupsPerAgent) fail('limit_reached');
    return { name, manifesto, open, procedure, cost: ctx.cost(ACTIONS.found.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const id = nextId(w, 'g');
    w.groups[id] = {
      id, name: plan.name, manifesto: plan.manifesto, open: plan.open, founder: a.id, steward: a.id, members: [a.id], pending: [],
      treasury: { energy: 0, coins: 0 }, createdDay: clockDay(w), dissolved: false,
      procedure: plan.procedure, bylaws: null, vars: {},
    };
    a.groups.push(id);
    noteWordUse(w, a, plan.name);
    noteWordUse(w, a, plan.manifesto);
    w.dayLog.groups.push({ id, name: plan.name, founder: a.id });
    emit(w, 'found', { agent: a.id, place: a.place, data: { groupId: id, name: plan.name, open: plan.open, procedure: plan.procedure } });
    return { group: id };
  },
};

const join = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const g = needGroup(w, args.group);
    if (g.members.includes(a.id) || g.pending.includes(a.id)) fail('already');
    if (a.groups.length >= LIMITS.groupsPerAgent) fail('limit_reached');
    return { g, cost: ctx.cost(ACTIONS.join.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { g } = plan;
    if (g.open) {
      g.members.push(a.id);
      a.groups.push(g.id);
      emit(w, 'join', { agent: a.id, place: a.place, data: { groupId: g.id, pending: false } });
      return { group: g.id, joined: true };
    }
    g.pending.push(a.id);
    const steward = w.agents[g.steward];
    if (steward && isAlive(steward)) {
      if (isMuted(w, steward, a.id)) w.dayLog.p2.muteBlocked++; // 第二前提：管事屏蔽了申请者——申请照常进入待审名单，只是不给管事推收件（SPEC-P2 §5.10）
      else pushInbox(w, steward, 'group', { groupId: g.id, event: 'request', from: ref(a) });
    }
    emit(w, 'join', { agent: a.id, place: a.place, data: { groupId: g.id, pending: true } });
    return { group: g.id, joined: false, pending: true };
  },
};

const leave = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const g = needGroup(w, args.group);
    const isMember = g.members.includes(a.id);
    if (!isMember && !g.pending.includes(a.id)) fail('not_member');
    return { g, isMember, cost: ctx.cost(ACTIONS.leave.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { g, isMember } = plan;
    if (!isMember) {
      g.pending = g.pending.filter((id) => id !== a.id);
      return { group: g.id, withdrawn: true };
    }
    const result = leaveGroup(w, g, a, 'left');
    return { group: g.id, dissolved: result === 'dissolved' };
  },
};

const admit = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const g = needGroup(w, args.group);
    if (g.steward !== a.id) fail('not_steward');
    const t = needAgent(w, args.agent);
    if (g.members.includes(t.id)) fail('already');
    if (!g.pending.includes(t.id)) fail('not_found');
    if (t.groups.length >= LIMITS.groupsPerAgent) fail('limit_reached');
    return { g, t, cost: ctx.cost(ACTIONS.admit.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { g, t } = plan;
    g.pending = g.pending.filter((id) => id !== t.id);
    g.members.push(t.id);
    t.groups.push(g.id);
    pushInbox(w, t, 'group', { groupId: g.id, event: 'admitted' });
    emit(w, 'admit', { agent: a.id, place: a.place, data: { groupId: g.id, agentId: t.id } });
    return { group: g.id, agent: t.id };
  },
};

const steward = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const g = needGroup(w, args.group);
    if (g.steward !== a.id) fail('not_steward');
    const t = needAgent(w, args.to);
    if (t.id === a.id) fail('already');
    if (!g.members.includes(t.id)) fail('not_member');
    return { g, t, cost: ctx.cost(ACTIONS.steward.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { g, t } = plan;
    g.steward = t.id;
    pushInbox(w, t, 'group', { groupId: g.id, event: 'steward' });
    emit(w, 'steward', { agent: t.id, place: a.place, data: { groupId: g.id, from: a.id, to: t.id, reason: 'handover' } });
    return { group: g.id, steward: t.id };
  },
};

const disburse = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const g = needGroup(w, args.group);
    if (g.steward !== a.id) fail('not_steward');
    const t = needAgent(w, args.to);
    const energy = optAmount(args.energy);
    const coins = optAmount(args.coins);
    if (energy === 0 && coins === 0) fail('invalid_args');
    if (g.treasury.energy < energy) fail('insufficient_energy', { zh: '社群公库的能量不足。', en: "The group's treasury lacks the energy." });
    if (g.treasury.coins < coins) fail('insufficient_coins', { zh: '社群公库的旧币不足。', en: "The group's treasury lacks the coins." });
    return { g, t, energy, coins, cost: ctx.cost(ACTIONS.disburse.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { g, t, energy, coins } = plan;
    g.treasury.energy -= energy;
    g.treasury.coins -= coins;
    t.coins += coins;
    pushInbox(w, t, 'gift', { from: { id: g.id, name: g.name }, via: 'group', energy, coins, note: null });
    creditEnergy(w, t, energy, ref(a));
    w.dayLog.coinVolume += coins;
    emit(w, 'disburse', { agent: a.id, place: a.place, data: { groupId: g.id, to: t.id, energy, coins } });
    return { group: g.id, to: t.id, energy, coins };
  },
};

// ── 交易 ───────────────────────────────────────────────────

/** { energy?, coins? } → { energy, coins }（缺省为 0，均为非负整数） */
function bundle(v) {
  needObject(v);
  return { energy: optAmount(v.energy), coins: optAmount(v.coins) };
}

const isEmpty = (b) => b.energy === 0 && b.coins === 0;

/** 公开交易挂在告示板上，只在那里可见、可成交：这里须有运转中的告示板 */
function needBoard(w, placeId) {
  if (!hasModuleAt(w, placeId, 'board')) fail('no_module', null, { module: 'board' });
}

const offer = {
  validate(ctx, args) {
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
    } else {
      needBoard(w, a.place);
    }
    // 公开交易使用告示板：代价受所在地点的完好度倍率影响；定向交易不受
    return { give, want, note, to, cost: ctx.cost(ACTIONS.offer.base, { usesModule: to === null }), reserve: { energy: give.energy, coins: give.coins } };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { give, want, note, to } = plan;
    a.energy -= give.energy;
    a.coins -= give.coins;
    const id = nextId(w, 'o');
    const o = {
      id, from: a.id, to: to ? to.id : null, give, want, note, board: to ? null : a.place,
      openedTick: w.clock.tick, expiresTick: w.clock.tick + P.offerTicks, status: 'open', acceptedBy: null,
    };
    w.offers[id] = o;
    if (to) {
      if (isMuted(w, to, a.id)) w.dayLog.p2.muteBlocked++; // 第二前提：对方屏蔽了你——交易照常建立、托管，不推收件；到期照常退回（SPEC-P2 §5.10）
      else pushInbox(w, to, 'offer', { offerId: id, from: ref(a), give, want, note });
    }
    emit(w, 'offer_open', {
      agent: a.id, place: a.place,
      data: { offerId: id, from: a.id, to: o.to, board: o.board, give, want, note, expiresTick: o.expiresTick },
    });
    return { offer: id };
  },
};

const accept = {
  validate(ctx, args) {
    const { w, a } = ctx;
    needId(args.offer);
    const o = Object.prototype.hasOwnProperty.call(w.offers, args.offer) ? w.offers[args.offer] : null;
    if (!o || o.status !== 'open') fail('not_found');
    if (o.from === a.id) fail('not_allowed');
    const isPublic = o.to === null;
    if (!isPublic) {
      if (o.to !== a.id) fail('not_allowed'); // 定向交易只能由 to 接受
    } else {
      if (a.place !== o.board) fail('wrong_place', null, { place: o.board });
      needBoard(w, o.board); // 告示板不运转时，交易仍在但不能被接受
    }
    return { o, cost: ctx.cost(ACTIONS.accept.base, { usesModule: isPublic }), reserve: { energy: o.want.energy, coins: o.want.coins } };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { o } = plan;
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
  },
};

const cancel = {
  validate(ctx, args) {
    const { w, a } = ctx;
    needId(args.offer);
    const o = Object.prototype.hasOwnProperty.call(w.offers, args.offer) ? w.offers[args.offer] : null;
    if (!o || o.status !== 'open') fail('not_found');
    if (o.from !== a.id) fail('not_allowed');
    return { o, cost: ctx.cost(ACTIONS.cancel.base) };
  },
  apply(ctx, plan) {
    closeOffer(ctx.w, plan.o, 'cancelled');
    return { offer: plan.o.id };
  },
};

// ── 典籍与词典 ──────────────────────────────────────────────

const write = {
  validate(ctx, args) {
    const { w, a } = ctx;
    if (!hasModuleAt(w, a.place, 'archive')) fail('no_module', null, { module: 'archive' });
    const title = needText(args.title, { max: LIMITS.docTitle });
    const body = needText(args.body, { max: LIMITS.docBody });
    const lang = optLang(args.lang, a.lang);
    return { title, body, lang, cost: ctx.cost(ACTIONS.write.base, { usesModule: true }) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const id = nextId(w, 'd');
    w.docs[id] = {
      id, kind: 'agent', title: plan.title, body: plan.body, lang: plan.lang, author: a.id, source: null, ref: null,
      tick: w.clock.tick, reads: 0, readsByDay: {}, redacted: false,
    };
    noteWordUse(w, a, plan.title);
    noteWordUse(w, a, plan.body);
    emit(w, 'write', { agent: a.id, place: a.place, data: { docId: id, title: plan.title } });
    return { doc: id };
  },
};

// TODO(spec): Q61 — read lives in social.js; prepare exactly the returned data before charging.
function readData(ctx, plan) {
  const { w } = ctx;
  if (plan.kind === 'doc') {
    const d = plan.d;
    const author = d.author ? { id: d.author, name: w.agents[d.author].name } : null;
    if (d.redacted) return { doc: { id: d.id, kind: d.kind, redacted: true } };
    return { doc: { id: d.id, kind: d.kind, title: d.title, body: d.body, lang: d.lang, author, ref: d.ref } };
  }
  if (plan.kind === 'law') return { law: lawView(w, plan.law, ctx.lang) };
  if (plan.kind === 'agent') return { agent: agentProfile(w, plan.t) };
  const ins = plan.ins;
  return { inscription: { id: ins.id, text: ins.text, lang: ins.lang, day: Math.floor(ins.tick / P.ticksPerDay) } };
}
function readPlan(ctx, plan) {
  if (tokenized(ctx.w)) {
    plan.data = readData(ctx, plan);
    plan.thinking = Math.ceil(jsonWeight(plan.data) * (plan.kind === 'doc' ? costMultiplierBp(ctx.w.places[ctx.a.place]) : 10000) / 10000);
  }
  return plan;
}

const read = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const kinds = ['doc', 'inscription', 'law', 'agent'].filter((k) => args[k] !== undefined && args[k] !== null);
    if (kinds.length !== 1) fail('invalid_args'); // 四选一
    const kind = kinds[0];
    if (kind === 'doc') {
      needId(args.doc);
      if (!hasModuleAt(w, a.place, 'archive')) fail('no_module', null, { module: 'archive' });
      const d = Object.prototype.hasOwnProperty.call(w.docs, args.doc) ? w.docs[args.doc] : null;
      if (!d) fail('not_found');
      return readPlan(ctx, { kind, d, cost: ctx.cost(ACTIONS.read.base, { usesModule: true }) });
    }
    if (kind === 'inscription') {
      needId(args.inscription);
      const ins = Object.prototype.hasOwnProperty.call(w.inscriptions, args.inscription) ? w.inscriptions[args.inscription] : null;
      if (!ins || ins.coveredBy || ins.redacted || ins.lost) fail('not_found');
      if (ins.place !== a.place) fail('wrong_place');
      return readPlan(ctx, { kind, ins, cost: ctx.cost(ACTIONS.read.base) });
    }
    if (kind === 'law') {
      needId(args.law);
      const law = Object.prototype.hasOwnProperty.call(w.laws, args.law) ? w.laws[args.law] : null;
      if (!law) fail('not_found');
      return readPlan(ctx, { kind, law, cost: ctx.cost(ACTIONS.read.base) });
    }
    // agent：一位居民的公开档案（介绍、志、标签、世代、作者、子女、年龄、状态、社群）
    const t = findAgent(w, needId(args.agent));
    if (!t) fail('not_found');
    return readPlan(ctx, { kind, t, cost: ctx.cost(ACTIONS.read.base) });
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    if (plan.kind === 'doc') {
      const d = plan.d;
      const day = clockDay(w);
      d.reads++;
      d.readsByDay[day] = (d.readsByDay[day] || 0) + 1;
      w.dayLog.reads++;
      if (d.kind === 'canon') w.dayLog.canonReads++;
      emit(w, 'read', { agent: a.id, place: a.place, data: { docId: d.id, title: d.title } });
      if (tokenized(w)) return plan.data;
      const author = d.author ? { id: d.author, name: w.agents[d.author].name } : null;
      if (d.redacted) return { doc: { id: d.id, kind: d.kind, redacted: true } };
      return { doc: { id: d.id, kind: d.kind, title: d.title, body: d.body, lang: d.lang, author, ref: d.ref } };
    }
    if (tokenized(w)) return plan.data;
    if (plan.kind === 'law') return { law: lawView(w, plan.law, ctx.lang) };
    if (plan.kind === 'agent') return { agent: agentProfile(w, plan.t) };
    const ins = plan.ins;
    return { inscription: { id: ins.id, text: ins.text, lang: ins.lang, day: Math.floor(ins.tick / P.ticksPerDay) } };
  },
};

const define = {
  validate(ctx, args) {
    const { w } = ctx;
    const word = needName(args.word);
    const meaning = needText(args.meaning, { max: LIMITS.meaning });
    const key = nameKey(word);
    if (Object.prototype.hasOwnProperty.call(w.lexicon, key)) fail('name_taken');
    return { word, meaning, key, cost: ctx.cost(ACTIONS.define.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    w.lexicon[plan.key] = { word: plan.word, meaning: plan.meaning, coiner: a.id, tick: w.clock.tick, uses: 0, users: [], redacted: false };
    emit(w, 'define', { agent: a.id, place: a.place, data: { word: plan.word, meaning: plan.meaning } });
    return { word: plan.word };
  },
};

const epitaph = {
  validate(ctx, args) {
    const { w, a } = ctx;
    if (!hasModuleAt(w, a.place, 'memorial')) fail('no_module', null, { module: 'memorial' });
    const dead = needAgent(w, args.deceased, 'any');
    const grave = w.cemetery.find((g) => g.agentId === dead.id);
    if (!grave) fail('not_found'); // 只有死者有墓碑（归隐者没有）
    const text = needText(args.text, { max: LIMITS.epitaph });
    return { dead, grave, text, cost: ctx.cost(ACTIONS.epitaph.base, { usesModule: true }) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    plan.grave.epitaphs.push({ author: a.id, text: plan.text, tick: w.clock.tick });
    w.dayLog.epitaphs++;
    noteWordUse(w, a, plan.text);
    emit(w, 'epitaph', { agent: a.id, place: a.place, data: { deceased: plan.dead.id, text: plan.text } });
    return { deceased: plan.dead.id };
  },
};

// ── 出示家书 ───────────────────────────────────────────────

const reveal = {
  validate(ctx, args) {
    const { w, a } = ctx;
    needId(args.letter);
    const letter = a.letters.find((l) => l.id === args.letter);
    if (!letter) fail('not_found');
    let loud = false;
    if (args.loud !== undefined && args.loud !== null) {
      if (typeof args.loud !== 'boolean') fail('invalid_args');
      loud = args.loud;
    }
    if (loud && isWeatherActive(w, 'eclipse') && !hasRelay(w)) fail('disabled_by_weather');
    // loud 时按 broadcast 的代价与规则
    return { letter, loud, cost: loud ? ctx.cost(ACTIONS.broadcast.base, { as: 'broadcast' }) : ctx.cost(ACTIONS.reveal.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { letter, loud } = plan;
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
  },
};

// ── 归隐 ───────────────────────────────────────────────────

const retire = {
  validate(ctx, args) {
    const lastWords = optText(args.lastWords, { max: LIMITS.lastWords });
    return { lastWords, cost: ctx.cost(ACTIONS.retire.base) };
  },
  apply(ctx, plan) {
    retireAgent(ctx.w, ctx.a, plan.lastWords === null ? undefined : plan.lastWords);
    return { status: 'retired' };
  },
};

export const socialHandlers = {
  found, join, leave, admit, steward, disburse, offer, accept, cancel, write, read, define, epitaph, reveal, retire,
};
