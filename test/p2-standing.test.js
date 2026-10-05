// SPEC-P2 T3（动作 standing 的校验与设定、规则检查的 standing 类别）；T4、T5（执行、维持费）随第 4 步加入。
import test from 'node:test';
import assert from 'node:assert/strict';
import e2 from '../src/e2/facade.js';
import { P } from '../src/e2/params.js';
import { clockDay } from '../src/e2/world.js';
import { setBlocklist } from '../src/moderation.js';
import {
  actionTable, ACTION_ORDER, ACTION_ORDER_P1, ACTION_ORDER_P2, ACTIONS_P2, actionArgNames, actionArgKind,
} from '../src/e2/lore/actions.js';
import { checkExpression, parseWhen, validateRules } from '../src/e2/rules/check.js';
import { namesFor, ALL_NAMES, ALL_NAMES_P2, T } from '../src/e2/rules/types.js';
import { implementedActions, HANDLERS } from '../src/e2/engine/actions.js';
import { applyCommand } from '../src/e2/engine/index.js';
import { stateHash } from '../src/store.js';
import { genesisOpts } from '../src/e2/world.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
import { reg, one, oneWithEvents, setHoldings, putAt, tick, tickDays, eventsOf, assertInvariants } from './e2-helpers.js';
import { enactP2 as enact, town as makeTown } from './p2-helpers.js';
import { describeEvent, templateKey, setLang, CAT } from '../public/i18n.js';

const town = (n = 2, seed = 'standing', premise = 2) => makeTown(n, seed, { premise });
const tickOrder = (extra = {}) => ({ when: 'tick', do: [{ type: 'say', text: '你好' }], ...extra });
const set = (w, a, orders) => one(w, a, { type: 'standing', orders });
const issuePaths = (r) => r.error.issues.map((i) => i.path);

// ═══════════════════════════════════════════════════════════════
// 动作表
// ═══════════════════════════════════════════════════════════════

test('P2 T3: 动作表——第二前提 45 个动作：standing 在 declare 之后、mute 在 internalize 之后；standing 不是内心的动作，mute 与 whisper 是；设定 0、1 的表不变', () => {
  const t2 = actionTable(2);
  assert.equal(ACTION_ORDER_P2.length, ACTION_ORDER_P1.length + 2);
  assert.deepEqual(ACTION_ORDER_P2.filter((t) => !ACTION_ORDER_P1.includes(t)), ['mute', 'standing']);
  assert.equal(ACTION_ORDER_P2[ACTION_ORDER_P2.indexOf('internalize') + 1], 'mute');
  assert.equal(ACTION_ORDER_P2[ACTION_ORDER_P2.indexOf('declare') + 1], 'standing');
  assert.deepEqual(ACTION_ORDER_P2.filter((t) => t !== 'mute' && t !== 'standing'), ACTION_ORDER_P1, '其余顺序同设定 1');
  assert.equal(t2.ORDER, ACTION_ORDER_P2);
  assert.equal(t2.ACTIONS, ACTIONS_P2);
  // 内心：没有 before 与 after
  assert.ok(t2.INNER.includes('mute') && t2.INNER.includes('whisper'));
  assert.ok(!t2.INNER.includes('standing'));
  assert.ok(t2.NO_BEFORE.includes('mute') && !t2.NO_BEFORE.includes('standing'));
  assert.deepEqual(t2.NO_AFTER, t2.INNER);
  // 参数与代价
  assert.deepEqual(ACTIONS_P2.standing.args, [['orders', 'list'], ['count', 'int']]);
  assert.equal(ACTIONS_P2.standing.base, 1);
  assert.equal(ACTIONS_P2.standing.params, 'orders');
  assert.equal(ACTIONS_P2.mute.base, 0);
  assert.equal(ACTIONS_P2.whisper.params, 'to, text, anonymous?');
  assert.equal(ACTIONS_P2.whisper.base, 1);
  for (const t of ['standing', 'mute', 'whisper']) assert.ok(ACTIONS_P2[t].desc.zh && ACTIONS_P2[t].desc.en && ACTIONS_P2[t].verb.zh && ACTIONS_P2[t].verb.en);
  // 设定 0、1 的表没有它们，也没有被改动
  assert.equal(actionTable(0).isKnown('standing'), false);
  assert.equal(actionTable(1).isKnown('standing'), false);
  assert.equal(actionTable(1).isKnown('mute'), false);
  assert.equal(actionTable(0).ORDER.length, 41);
  assert.equal(actionTable(1).ORDER.length, 43);
  assert.deepEqual(actionTable(1).ACTIONS.whisper.args, [['to', 'str'], ['text', 'str']]);
  assert.equal(actionTable(1).ACTIONS.whisper.params, 'to, text');
  // 参数名按设定版本取
  assert.deepEqual(actionArgNames('standing', 2), ['orders', 'count']);
  assert.deepEqual(actionArgNames('standing', 1), []);
  assert.deepEqual(actionArgNames('standing'), []);
  assert.deepEqual(actionArgNames('whisper', 2), ['to', 'text', 'anonymous']);
  assert.deepEqual(actionArgNames('whisper', 1), ['to', 'text']);
  assert.equal(actionArgKind('standing', 'count', 2), 'int');
  assert.equal(actionArgKind('standing', 'count', 1), null);
  assert.equal(actionArgKind('say', 'text'), 'str');
});

test('P2 T3: 第二前提动作表里的每个动作都有处理函数，没有多的；设定 0、1 的也一样', () => {
  assert.ok(HANDLERS.standing && HANDLERS.mute);
  for (const premise of [0, 1, 2]) assert.deepEqual(implementedActions(premise).slice().sort(), actionTable(premise).ORDER.slice().sort(), `premise ${premise}`);
  assert.equal(implementedActions(2).length, 45);
  assert.ok(!implementedActions(1).includes('standing') && !implementedActions(1).includes('mute'));
  assert.ok(!implementedActions(0).includes('standing') && !implementedActions(0).includes('mute'));
});

test('P2 T3: 设定 0、1 的世界里 standing 是不存在的动作，提示文字不变', () => {
  for (const premise of [0, 1]) {
    const { w, people } = town(1, `unknown-${premise}`, premise);
    const r = set(w, people[0], []);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'invalid_args');
    assert.equal(r.error.hint.zh, `没有这个动作：standing。可用的动作：${actionTable(premise).ORDER.join(' ')}。`);
    assert.equal(r.error.hint.en, `There is no such action: standing. Available actions: ${actionTable(premise).ORDER.join(' ')}.`);
    assert.equal(people[0].energy, 100, '不扣能量');
  }
  // 第二前提里 standing 本身存在
  const { w, people } = town(1, 'known');
  assert.equal(set(w, people[0], []).ok, true);
});

// ═══════════════════════════════════════════════════════════════
// 校验
// ═══════════════════════════════════════════════════════════════

test('P2 T3: orders——必须是数组，至多 3 条；每条是对象，只能有 when、if、do、times、untilDay', () => {
  const { w, people } = town();
  const [a] = people;
  for (const bad of [undefined, null, 'tick', {}, 7]) {
    const r = one(w, a, { type: 'standing', orders: bad });
    assert.equal(r.error.code, 'invalid_args', JSON.stringify(bad));
    assert.ok(r.error.hint.zh.startsWith('用法：standing(orders)'));
    assert.ok(r.error.hint.en.startsWith('Usage: standing(orders)'));
  }
  assert.equal(set(w, a, [tickOrder(), tickOrder(), tickOrder()]).ok, true);
  assert.equal(set(w, a, [tickOrder(), tickOrder(), tickOrder(), tickOrder()]).error.code, 'invalid_args');
  for (const bad of [null, 'x', 5, [], [tickOrder()]]) assert.equal(set(w, a, [bad]).error.code, 'invalid_args', JSON.stringify(bad));
  assert.equal(set(w, a, [{ ...tickOrder(), extra: 1 }]).error.code, 'invalid_args');
  assert.equal(set(w, a, [{ ...tickOrder(), When: 'tick' }]).error.code, 'invalid_args');
  // 失败的校验不扣能量：只有那次成功的设定付了 1
  assert.equal(a.energy, 100 - 1);
});

test('P2 T3: when——八种时机，其余不行', () => {
  const { w, people } = town();
  const [a] = people;
  for (const when of ['tick', 'daily', 'inbox:whisper', 'inbox:offer', 'inbox:pact', 'inbox:memory_offer', 'inbox:group', 'inbox:gift']) {
    assert.equal(set(w, a, [{ ...tickOrder(), when }]).ok, true, when);
  }
  for (const when of [undefined, null, 5, '', 'Tick', 'inbox:say', 'inbox:', 'inbox:system', 'monthly', 'enact', 'before:say', 'on:arrive']) {
    assert.equal(set(w, a, [{ ...tickOrder(), when }]).error.code, 'invalid_args', String(when));
  }
});

test('P2 T3: times 是 1…1000 的整数（可省略或 null）；untilDay 不小于「总第 N 日」的今天', () => {
  const { w, people } = town();
  const [a] = people;
  for (const times of [undefined, null, 1, 500, P.standingTimesMax]) assert.equal(set(w, a, [tickOrder({ times })]).ok, true, String(times));
  for (const times of [0, -1, 1.5, P.standingTimesMax + 1, '3', true, [], NaN]) assert.equal(set(w, a, [tickOrder({ times })]).error.code, 'invalid_args', String(times));
  tickDays(w, 2); // 钟面第 3 日（clockDay 从 0 起：2），总第 3 日
  const today = clockDay(w) + 1; // 【此刻】里的「总第 N 日」
  for (const untilDay of [undefined, null, today, today + 100]) assert.equal(set(w, a, [tickOrder({ untilDay })]).ok, true, String(untilDay));
  for (const untilDay of [today - 1, 0, -3, 2.5, '9', true]) assert.equal(set(w, a, [tickOrder({ untilDay })]).error.code, 'invalid_args', String(untilDay));
  assert.equal(a.standing[0].untilDay, today + 100, '原样保存：总第 N 日的 N');
});

test('P2 T3: if——类型检查按类别 standing：me、left、here、city、var 可用；返回值必须是真假；类型错误是 rule_invalid，路径 orders[i].if', () => {
  const { w, people } = town();
  const [a] = people;
  for (const src of ['me.energy < 30', 'left > 0', 'left >= 1 and me.coins > 5', "me.place == 'well'", 'count(here) < 3', 'city.day > 2', 'default(var.x, 0) < 5', "has_tag(me, 'citizen')", 'true']) {
    assert.equal(set(w, a, [tickOrder({ if: src })]).ok, true, src);
  }
  // 类型错误
  let r = set(w, a, [tickOrder({ if: 'me.energy + 1' })]);
  assert.equal(r.error.code, 'rule_invalid');
  assert.deepEqual(issuePaths(r), ['orders[0].if']);
  assert.equal(r.error.issues[0].code, 'type.expected');
  r = set(w, a, [tickOrder(), tickOrder({ if: 'me.nonsense > 1' })]);
  assert.equal(r.error.code, 'rule_invalid');
  assert.deepEqual(issuePaths(r), ['orders[1].if']);
  assert.equal(r.error.issues[0].code, 'type.unknown_field');
  r = set(w, a, [tickOrder({ if: 'me.energy <' })]);
  assert.equal(r.error.code, 'rule_invalid');
  assert.match(r.error.issues[0].code, /^syntax\./);
  // 名字：actor、args、result、event 在这里不可用
  for (const src of ['actor.energy > 3', 'args.count > 0', 'result.spent > 0', 'event.agent == null']) {
    r = set(w, a, [tickOrder({ if: src })]);
    assert.equal(r.error.code, 'rule_invalid', src);
    assert.equal(r.error.issues[0].code, 'type.name_unavailable', src);
  }
  // 不是字符串、太长：invalid_args
  for (const bad of [5, true, {}, [], 'x'.repeat(P.exprChars + 1)]) assert.equal(set(w, a, [tickOrder({ if: bad })]).error.code, 'invalid_args', JSON.stringify(bad).slice(0, 20));
  assert.equal(set(w, a, [tickOrder({ if: null })]).ok, true);
  // 空串是语法错误，不是「没有条件」
  assert.equal(set(w, a, [tickOrder({ if: '' })]).error.code, 'rule_invalid');
  // 存的是规范化的源文本
  assert.equal(set(w, a, [tickOrder({ if: '  me.energy < 30  ' })]).ok, true);
  assert.equal(a.standing[0].if, 'me.energy < 30');
});

test('P2 T3: it 只在 inbox: 时机里可用（类型任意）；tick 与 daily 里没有它', () => {
  const { w, people } = town();
  const [a] = people;
  for (const when of ['inbox:whisper', 'inbox:offer', 'inbox:pact', 'inbox:memory_offer', 'inbox:group', 'inbox:gift']) {
    assert.equal(set(w, a, [{ when, if: "it.from.id == 'a2'", do: [{ type: 'say', text: '收到' }] }]).ok, true, when);
    assert.equal(set(w, a, [{ when, do: [{ type: 'whisper', to: '=it.from.id', text: '收到了' }] }]).ok, true, when);
  }
  for (const when of ['tick', 'daily']) {
    const r = set(w, a, [{ when, if: "it.from.id == 'a2'", do: [{ type: 'say', text: 'x' }] }]);
    assert.equal(r.error.code, 'rule_invalid', when);
    assert.deepEqual(issuePaths(r), ['orders[0].if']);
    const r2 = set(w, a, [{ when, do: [{ type: 'whisper', to: '=it.from.id', text: 'x' }] }]);
    assert.equal(r2.error.code, 'rule_invalid');
    assert.deepEqual(issuePaths(r2), ['orders[0].do[0].to']);
  }
});

test('P2 T3: do——1–2 个动作对象；type 必须是认得的动作，不能是 standing 或 retire；= 开头的字符串值是表达式', () => {
  const { w, people } = town();
  const [a] = people;
  const sayIt = { type: 'say', text: '好' };
  assert.equal(set(w, a, [{ when: 'tick', do: [sayIt, sayIt] }]).ok, true);
  for (const bad of [undefined, null, [], 'say', {}, [sayIt, sayIt, sayIt]]) assert.equal(set(w, a, [{ when: 'tick', do: bad }]).error.code, 'invalid_args', JSON.stringify(bad));
  for (const act of [null, 'say', 5, [], {}, { type: 5 }, { type: 'nonsense' }, { type: 'Say', text: 'x' }, { text: 'x' }]) {
    assert.equal(set(w, a, [{ when: 'tick', do: [act] }]).error.code, 'invalid_args', JSON.stringify(act));
  }
  for (const type of ['standing', 'retire']) assert.equal(set(w, a, [{ when: 'tick', do: [{ type, orders: [] }] }]).error.code, 'invalid_args', type);
  // 第二前提的新动作可以放进去
  assert.equal(set(w, a, [{ when: 'tick', do: [{ type: 'mute', who: 'anonymous' }, { type: 'whisper', to: 'a2', text: 'x', anonymous: true }] }]).ok, true);
  // = 表达式：名字、类型
  assert.equal(set(w, a, [{ when: 'tick', do: [{ type: 'give', to: 'treasury', energy: '=min(5, me.energy / 10)', note: '=names(here)' }] }]).ok, true);
  let r = set(w, a, [{ when: 'tick', do: [sayIt, { type: 'give', to: '=actor.id', energy: 1 }] }]);
  assert.equal(r.error.code, 'rule_invalid');
  assert.deepEqual(issuePaths(r), ['orders[0].do[1].to']);
  assert.equal(r.error.issues[0].code, 'type.name_unavailable');
  r = set(w, a, [tickOrder({ if: 'me.energy +' }), { when: 'tick', do: [{ type: 'give', to: '=left +', energy: '=bogus(1)' }] }]);
  assert.equal(r.error.code, 'rule_invalid');
  assert.deepEqual(issuePaths(r), ['orders[0].if', 'orders[1].do[0].to', 'orders[1].do[0].energy']);
  // 其余的值原样接受（执行时由动作自己校验）：不认得的参数、数字、嵌套的对象
  assert.equal(set(w, a, [{ when: 'tick', do: [{ type: 'give', to: 'a2', energy: 'lots', coins: { x: 1 }, extra: [1, 2] }] }]).ok, true);
  // 以 = 开头的字面文本要写成返回它的表达式
  assert.equal(set(w, a, [{ when: 'tick', do: [{ type: 'say', text: "='=开头的话'" }] }]).ok, true);
  // 表达式太长
  assert.equal(set(w, a, [{ when: 'tick', do: [{ type: 'say', text: `=${'1+'.repeat(P.exprChars)}1` }] }]).error.code, 'invalid_args');
  // issues 至多 5 条
  r = set(w, a, [{ when: 'tick', do: [{ type: 'give', to: '=a +', energy: '=b +' }] }, { when: 'tick', do: [{ type: 'give', to: '=c +', energy: '=d +' }] }, { when: 'tick', if: 'e +', do: [{ type: 'give', to: '=f +', energy: '=g +' }] }]);
  assert.equal(r.error.code, 'rule_invalid');
  assert.equal(r.error.issues.length, 5);
});

test('P2 T3: 每条指令的 JSON 至多 2000 字符（text_too_long，带 field、limit、actual）', () => {
  const { w, people } = town();
  const [a] = people;
  const fits = { when: 'tick', do: [{ type: 'say', text: 'x'.repeat(P.standingJsonMax - 60) }] };
  assert.ok(JSON.stringify(fits).length <= P.standingJsonMax);
  assert.equal(set(w, a, [fits]).ok, true);
  const big = { when: 'tick', do: [{ type: 'say', text: 'x'.repeat(P.standingJsonMax) }] };
  const r = set(w, a, [big]);
  assert.equal(r.error.code, 'text_too_long');
  assert.equal(r.error.field, 'orders');
  assert.equal(r.error.limit, P.standingJsonMax);
  assert.equal(r.error.actual, JSON.stringify(big).length);
  assert.ok(r.error.actual > P.standingJsonMax);
});

test('P2 T3: 字面的字符串值经内容审核（moderated，field: orders）；= 开头的表达式不在这里审核', () => {
  const { w, people } = town();
  const [a] = people;
  setBlocklist(['badword']);
  try {
    const r = set(w, a, [{ when: 'tick', do: [{ type: 'say', text: 'this has a BadWord inside' }] }]);
    assert.equal(r.error.code, 'moderated');
    assert.equal(r.error.field, 'orders');
    assert.equal(set(w, a, [{ when: 'tick', do: [{ type: 'whisper', to: 'a2', text: 'fine' }, { type: 'say', text: 'badword' }] }]).error.code, 'moderated');
    assert.equal(set(w, a, [{ when: 'tick', do: [{ type: 'say', text: 'harmless' }] }]).ok, true);
  } finally {
    setBlocklist([]);
  }
});

// ═══════════════════════════════════════════════════════════════
// 设定
// ═══════════════════════════════════════════════════════════════

test('P2 T3: 设定——代价 1；整体替换（fired 与 seen 不保留）；新订的指令当日视为已付；设定之前到达的收件不触发；空数组撤销；事件延迟公开；dayLog.p2.standingSets', () => {
  const { w, people } = town(2, 'setting');
  const [a, b] = people;
  const before = a.energy;
  const orders = [
    { when: 'tick', if: 'me.energy < 30', do: [{ type: 'move', to: 'well' }, { type: 'draw', energy: 5 }], times: 10, untilDay: 40 },
    { when: 'inbox:whisper', do: [{ type: 'whisper', to: '=it.from.id', text: '收到了' }] },
  ];
  one(w, b, { type: 'whisper', to: a.id, text: '先来一条' }); // 设定之前到达的收件
  const lastSeq = a.inbox.at(-1).seq;
  const { r, events } = oneWithEvents(w, a, { type: 'standing', orders });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.cost, 1);
  assert.deepEqual(r.data, { count: 2 });
  assert.equal(a.energy, before - 1);
  assert.equal(a.standing.length, 2);
  assert.deepEqual(a.standing[0], { when: 'tick', if: 'me.energy < 30', do: orders[0].do, times: 10, untilDay: 40, fired: 0, seen: lastSeq, paidThrough: clockDay(w) });
  assert.deepEqual(a.standing[1], { when: 'inbox:whisper', if: null, do: orders[1].do, times: null, untilDay: null, fired: 0, seen: lastSeq, paidThrough: clockDay(w) });
  assert.equal(w.dayLog.p2.standingSets, 1);
  // 存下的是副本：改调用者的对象不影响世界
  orders[0].do[0].to = 'port';
  assert.equal(a.standing[0].do[0].to, 'well');
  // 事件：延迟公开，带条数与全文
  const ev = events.find((e) => e.type === 'standing');
  assert.equal(ev.vis, 'delayed');
  assert.equal(ev.agent, a.id);
  assert.equal(ev.place, a.place);
  assert.equal(ev.releaseTick, w.clock.tick + P.privateDelayTicks);
  assert.equal(ev.data.count, 2);
  assert.deepEqual(ev.data.orders[0], { when: 'tick', if: 'me.energy < 30', do: [{ type: 'move', to: 'well' }, { type: 'draw', energy: 5 }], times: 10, untilDay: 40 });
  assert.deepEqual(ev.data.orders[1], { when: 'inbox:whisper', if: null, do: [{ type: 'whisper', to: '=it.from.id', text: '收到了' }], times: null, untilDay: null });
  // 整体替换：旧的 fired 不保留
  a.standing[0].fired = 7;
  const r2 = one(w, a, { type: 'standing', orders: [tickOrder()] });
  assert.equal(r2.ok, true);
  assert.equal(a.standing.length, 1);
  assert.equal(a.standing[0].fired, 0);
  assert.equal(w.dayLog.p2.standingSets, 2);
  // 空数组撤销（照付代价 1），事件的条数为 0
  const { r: r3, events: ev3 } = oneWithEvents(w, a, { type: 'standing', orders: [] });
  assert.equal(r3.ok, true);
  assert.equal(r3.cost, 1);
  assert.deepEqual(r3.data, { count: 0 });
  assert.deepEqual(a.standing, []);
  assert.deepEqual(ev3.find((e) => e.type === 'standing').data, { count: 0, orders: [] });
  assert.equal(w.dayLog.p2.standingSets, 3);
  // 别人的指令不受影响
  assert.deepEqual(b.standing, []);
  // 能量不够：insufficient_energy，什么都不改
  setHoldings(w, a, { energy: 0 });
  a.standing = [];
  const r4 = one(w, a, { type: 'standing', orders: [tickOrder()] });
  assert.equal(r4.error.code, 'insufficient_energy');
  assert.deepEqual(a.standing, []);
  assert.equal(w.dayLog.p2.standingSets, 3);
});

// ═══════════════════════════════════════════════════════════════
// 规则：before:standing、after:standing；类别 standing 的名字
// ═══════════════════════════════════════════════════════════════

test('P2 T3: 规则——before:standing 能拒绝与收费，args.count 是条数、args.orders 读到 null；after:standing 能回应（result.count）', () => {
  const { w, people } = town(2, 'rules');
  const [a, b] = people;
  tickDays(w, 1);
  for (const x of people) setHoldings(w, x, { energy: 100, coins: 10 });
  // 拒绝：条数多于 2 条；读不到内容
  const deny = enact(w, [{ when: 'before:standing', if: 'args.count > 2 and args.orders == null', do: [{ op: 'deny', reason: '指令太多了' }] }], { title: '限制指令', author: a.id });
  assert.equal(set(w, a, [tickOrder(), tickOrder()]).ok, true);
  const r = set(w, a, [tickOrder(), tickOrder(), tickOrder()]);
  assert.equal(r.error.code, 'forbidden');
  assert.equal(r.error.law, deny.id);
  assert.equal(r.error.reason, '指令太多了');
  assert.equal(a.standing.length, 2, '被拒绝的设定没有生效');
  // 感知里的预求值：args 为空时 count 读到 0，所以不拒绝
  const p = e2.buildPerception(w, a.id, { ack: false });
  const entry = p.actions.find((x) => x.type === 'standing');
  assert.equal(entry.available, true);
  assert.equal(entry.cost, 1);
  assert.deepEqual(p.you.standing.map((o) => o.index), [0, 1]);
  // 收费
  w.laws[deny.id].status = 'repealed';
  enact(w, [{ when: 'before:standing', do: [{ op: 'fee', to: 'treasury', energy: '2 * args.count' }] }], { title: '指令税', author: a.id });
  const treasury = w.treasury.energy;
  const before = b.energy;
  const paid = set(w, b, [tickOrder(), tickOrder()]);
  assert.equal(paid.ok, true, JSON.stringify(paid));
  assert.equal(paid.cost, 1 + 4, '动作代价 1 加规则收的 4');
  assert.equal(b.energy, before - 5);
  assert.equal(w.treasury.energy, treasury + 4);
  // after：回应，result.count 是设定的条数
  enact(w, [{ when: 'after:standing', if: 'result.count == 1', do: [{ op: 'set', var: 'lastStanding', value: 'result.count' }] }], { title: '记一笔', author: a.id });
  assert.equal(set(w, b, [tickOrder()]).ok, true);
  assert.equal(w.vars.lastStanding, 1);
  // 读法：动词是「留下常驻指令」
  const reading = e2.buildPerception(w, a.id, { ack: false }).city.laws.find((l) => l.title === '指令税').reading;
  assert.equal(reading, '有人留下常驻指令之前：另收 （2 × 参数 count） 能量，交给城公库');
  assert.equal(e2.buildPerception(w, a.id, { ack: false, lang: 'en' }).city.laws.find((l) => l.title === '记一笔').reading, 'After someone sets standing orders: if result count = 1, set variable lastStanding to result count');
  // 感知里：法律能管它的预求值也会写进 actions
  const forbid = enact(w, [{ when: 'before:standing', if: 'actor.coins < 1000', do: [{ op: 'deny', reason: '先富起来' }] }], { title: '门槛', author: a.id });
  const p2 = e2.buildPerception(w, b.id, { ack: false });
  const e2entry = p2.actions.find((x) => x.type === 'standing');
  assert.equal(e2entry.available, false);
  assert.equal(e2entry.reason.code, 'forbidden');
  assert.equal(e2entry.reason.law, forbid.id);
});

test('P2 T3: 规则检查——类别 standing 的名字表；me、left 只在第二前提的常驻指令里可用；设定 0、1 的报错文字不变', () => {
  assert.deepEqual(Object.keys(namesFor('standing')).sort(), ['agents', 'city', 'cradle', 'here', 'left', 'me', 'treasury', 'var']);
  assert.equal(namesFor('standing').me, T.AGENT);
  assert.equal(namesFor('standing').left, T.INT);
  assert.equal(namesFor('standing').here, T.AGENTS);
  assert.deepEqual(ALL_NAMES_P2, [...ALL_NAMES, 'me', 'left']);
  assert.equal(ALL_NAMES.includes('me'), false);
  // 第二前提：规则里写 me、left → 「只在常驻指令里可用」
  for (const premise of [2]) {
    const v = validateRules([{ when: 'daily', if: 'me.energy > 1', do: [{ op: 'set', var: 'x', value: '1' }] }], { scope: { premise, kind: 'city' } });
    assert.equal(v.ok, false);
    assert.equal(v.issues[0].code, 'type.name_unavailable');
    assert.equal(v.issues[0].zh, '第 1 个字符：「me」「left」只在常驻指令里可用');
    assert.equal(v.issues[0].en, 'Character 1: "me" and "left" are only available in standing orders');
    const v2 = validateRules([{ when: 'daily', if: 'left > 1', do: [{ op: 'set', var: 'x', value: '1' }] }], { scope: { premise, kind: 'city' } });
    assert.equal(v2.issues[0].code, 'type.name_unavailable');
  }
  // 设定 0、1：me 仍是「不认识的名字」，文字与以前相同
  for (const premise of [0, 1]) {
    const v = validateRules([{ when: 'daily', if: 'me.energy > 1', do: [{ op: 'set', var: 'x', value: '1' }] }], { scope: { premise, kind: 'city' } });
    assert.equal(v.issues[0].code, 'type.unknown_name');
    assert.equal(v.issues[0].zh, '第 1 个字符：不认识的名字「me」');
  }
  const bare = validateRules([{ when: 'daily', if: 'me.energy > 1', do: [{ op: 'set', var: 'x', value: '1' }] }]);
  assert.equal(bare.issues[0].code, 'type.unknown_name');
  // standing 类别里 actor 是「这里不可用」，不是「不认识」
  const r = checkExpression('actor.energy > 1', T.BOOL, 'standing', { premise: 2 });
  assert.equal(r.issues[0].code, 'type.name_unavailable');
  // 类别 standing 不是规则的时机
  for (const premise of [0, 1, 2]) assert.ok(parseWhen('standing', { kind: 'city', premise }).error);
  // before:standing / after:standing：第二前提合法，设定 0、1 里是不认识的动作（文字不变）
  assert.deepEqual(parseWhen('before:standing', { kind: 'city', premise: 2 }), { kind: 'before', action: 'standing' });
  assert.deepEqual(parseWhen('after:standing', { kind: 'city', premise: 2 }), { kind: 'after', action: 'standing' });
  for (const premise of [0, 1]) {
    const e = parseWhen('before:standing', { kind: 'city', premise }).error;
    assert.equal(e.zh, '不认识的动作「standing」');
    assert.equal(e.hint.zh, `可用的动作：${actionTable(premise).ORDER.join(' ')}`);
  }
  // 内心的动作没有 before / after：mute 同 whisper
  assert.match(parseWhen('before:mute', { kind: 'city', premise: 2 }).error.zh, /内心/);
  assert.match(parseWhen('after:mute', { kind: 'city', premise: 2 }).error.zh, /内心/);
  // args.<参数>：standing 有 orders 与 count，没有别的
  assert.equal(checkExpression('args.count > 1', T.BOOL, 'before', { premise: 2, action: 'standing' }).ok, true);
  assert.equal(checkExpression('args.orders == null', T.BOOL, 'before', { premise: 2, action: 'standing' }).ok, true);
  assert.equal(checkExpression('args.nonsense > 1', T.BOOL, 'before', { premise: 2, action: 'standing' }).issues[0].code, 'type.unknown_arg');
  assert.equal(checkExpression('args.anonymous == true', T.BOOL, 'before', { premise: 2, action: 'say' }).issues[0].code, 'type.unknown_arg');
  assert.equal(ACTION_ORDER.includes('standing'), false, '设定 0 的动作表没有它');
});

test('P2 T3: 感知的 actions 里 standing 一行——醒着时可用，代价 1，没有地点限制', () => {
  const { w, people } = town(1, 'actions-view');
  const [a] = people;
  for (const place of ['port', 'well', 'scrapyard', 'market']) {
    putAt(w, a, place);
    const entry = e2.buildPerception(w, a.id, { ack: false }).actions.find((x) => x.type === 'standing');
    assert.deepEqual([entry.available, entry.cost, Object.hasOwn(entry, 'reason')], [true, 1, false], place);
  }
  const p = e2.buildPerception(w, a.id, { ack: false });
  assert.deepEqual(p.actions.map((x) => x.type), actionTable(2).ORDER);
  // 设定 1 的感知里没有
  const o = town(1, 'actions-view-1', 1);
  assert.equal(e2.buildPerception(o.w, o.people[0].id, { ack: false }).actions.some((x) => x.type === 'standing'), false);
});

test('P2 T3: 观测站的事件模板随 standing 事件一起登记（Q29 的约定）——中英文，撤销时另一句', () => {
  const ev = (count) => ({ seq: 1, tick: 300, day: 25, type: 'standing', agent: 'a1', delayed: true, data: { count, orders: [] } });
  assert.equal(templateKey(ev(2)), 'standing');
  assert.equal(templateKey(ev(0)), 'standing_none');
  assert.equal(CAT.standing, 'life');
  try {
    setLang('zh');
    const zh = describeEvent(ev(2));
    assert.equal(zh.template, '{a} 留下了 {count} 条常驻指令。');
    assert.equal(zh.vars.count, 2);
    assert.equal(describeEvent(ev(0)).template, '{a} 撤销了常驻指令。');
    setLang('en');
    assert.equal(describeEvent(ev(2)).template, '{a} left {count} standing order(s).');
    assert.equal(describeEvent(ev(0)).template, '{a} withdrew their standing orders.');
  } finally {
    setLang('zh');
  }
});

// ═══════════════════════════════════════════════════════════════
// T4：执行（SPEC-P2 §5.4）
// ═══════════════════════════════════════════════════════════════

const standingItems = (a) => a.inbox.filter((i) => i.kind === 'standing');

test('P2 T4: tick 的指令每刻执行一次；执行的动作与亲手做的一样（事件的形状相同、付代价）；条件为假不计次、不发收件、不发事件', () => {
  const { w, people } = town(2, 'exec-tick');
  const [a, b] = people;
  set(w, a, [{ when: 'tick', if: 'me.energy < 95', do: [{ type: 'say', text: '我在' }] }]);
  assert.equal(a.energy, 99);
  // 能量 99 ≥ 95：条件为假
  const quiet = tick(w, 3);
  assert.equal(a.standing[0].fired, 0);
  assert.equal(standingItems(a).length, 0);
  assert.equal(eventsOf(quiet, 'standing_fired').length, 0);
  assert.equal(eventsOf(quiet, 'say').length, 0);
  assert.equal(w.dayLog.p2.standingFired, 0);
  // 条件为真：每刻一次
  setHoldings(w, a, { energy: 50 });
  const evs = tick(w, 3);
  assert.equal(a.standing[0].fired, 3);
  assert.equal(eventsOf(evs, 'say').length, 3);
  assert.equal(a.energy, 50 - 3, '每次 say 付 1');
  assert.equal(standingItems(a).length, 3);
  assert.equal(w.dayLog.p2.standingFired, 3);
  // 与亲手做的 say 相同：事件的形状一样，没有任何「自动」的标记
  const manual = oneWithEvents(w, b, { type: 'say', text: '我在' }).events.find((e) => e.type === 'say');
  const auto = eventsOf(evs, 'say')[0];
  assert.deepEqual(Object.keys(auto).sort(), Object.keys(manual).sort());
  assert.deepEqual(Object.keys(auto.data).sort(), Object.keys(manual.data).sort());
  assert.equal(auto.vis, manual.vis);
  assert.equal(auto.agent, a.id);
  assert.equal(auto.place, a.place);
  // 同处的人听到的收件也一样
  assert.deepEqual(Object.keys(b.inbox.filter((i) => i.kind === 'say' && i.from.id === a.id)[0]).sort(), Object.keys(b.inbox.filter((i) => i.kind === 'say' && i.from.id === b.id)[0] || b.inbox.find((i) => i.kind === 'say')).sort());
});

test('P2 T4: daily 只在日界刻（新一日的第 1 刻）执行', () => {
  const { w, people } = town(1, 'exec-daily');
  const [a] = people;
  set(w, a, [{ when: 'daily', do: [{ type: 'say', text: '早安' }] }]);
  const evs = tick(w, 36); // 第 12、24、36 刻是日界刻
  assert.equal(a.standing[0].fired, 3);
  assert.deepEqual(eventsOf(evs, 'standing_fired').map((e) => e.tick), [12, 24, 36]);
  assert.deepEqual(eventsOf(evs, 'say').map((e) => e.tick), [12, 24, 36]);
});

test('P2 T4: inbox:<类别> 每条收件触发一次；seen 推进；设定之前到达的收件不触发；别的类别与发给别人的不触发', () => {
  const { w, people } = town(3, 'exec-inbox');
  const [a, b, c] = people;
  one(w, b, { type: 'whisper', to: a.id, text: '设定之前的私语' });
  set(w, a, [{ when: 'inbox:whisper', do: [{ type: 'say', text: '收到' }] }]);
  assert.equal(a.standing[0].seen, a.inbox.at(-1).seq);
  tick(w, 1);
  assert.equal(a.standing[0].fired, 0, '设定之前到达的收件不触发');
  // 两条私语，另有别的类别（赠予）与发给别人的私语
  one(w, b, { type: 'whisper', to: a.id, text: '第一条' });
  one(w, c, { type: 'whisper', to: a.id, text: '第二条' });
  one(w, b, { type: 'whisper', to: c.id, text: '不是给你的' });
  one(w, b, { type: 'give', to: a.id, energy: 1 });
  const evs = tick(w, 1);
  assert.equal(a.standing[0].fired, 2, '一条收件一次');
  assert.equal(eventsOf(evs, 'say').length, 2);
  const whisperSeqs = a.inbox.filter((i) => i.kind === 'whisper' && i.text !== '设定之前的私语').map((i) => i.seq);
  assert.deepEqual(standingItems(a).map((i) => i.trigger), whisperSeqs.map((seq) => ({ when: 'inbox:whisper', seq })));
  assert.equal(a.standing[0].seen, a.inbox.filter((i) => i.kind !== 'standing').at(-1).seq, 'seen 推进到看过的最大序号');
  // 没有新的收件：不再触发
  tick(w, 2);
  assert.equal(a.standing[0].fired, 2);
});

test('P2 T4: 六类收件各自触发——私语、定向交易、孕育之约、交来的记忆、入社申请（group 只算有人申请加入）、赠予', () => {
  const { w, people } = town(4, 'exec-kinds');
  const [a, b, c, d] = people;
  const diary = (when) => ({ when, do: [{ type: 'diary', text: when }] });
  set(w, a, [diary('inbox:whisper'), diary('inbox:offer'), diary('inbox:pact')]);
  set(w, d, [diary('inbox:memory_offer'), diary('inbox:group'), diary('inbox:gift')]);
  one(w, d, { type: 'found', name: '小会', manifesto: '一起', open: false });
  one(w, b, { type: 'whisper', to: a.id, text: '私语' });
  one(w, b, { type: 'offer', to: a.id, give: { energy: 0, coins: 1 }, want: { energy: 1, coins: 0 }, note: '换' });
  assert.equal(one(w, b, { type: 'conceive', name: '孩子', soul: '孩子的灵魂', with: [a.id] }).ok, true);
  one(w, b, { type: 'remember', text: '要交出去的记忆' });
  assert.equal(one(w, b, { type: 'impart', to: d.id, memory: 0 }).ok, true);
  assert.equal(one(w, c, { type: 'join', group: 'g1' }).ok, true);
  one(w, b, { type: 'give', to: d.id, energy: 3, note: '送' });
  tick(w, 1);
  assert.deepEqual(a.standing.map((o) => o.fired), [1, 1, 1]);
  assert.deepEqual(d.standing.map((o) => o.fired), [1, 1, 1]);
  assert.deepEqual(standingItems(a).map((i) => i.trigger.when), ['inbox:whisper', 'inbox:offer', 'inbox:pact']);
  assert.deepEqual(standingItems(d).map((i) => i.trigger.when), ['inbox:memory_offer', 'inbox:group', 'inbox:gift']);
  // 申请被接纳之后的通知（admitted）发给申请者，不再触发管事的指令
  one(w, d, { type: 'admit', group: 'g1', agent: c.id });
  tick(w, 2);
  assert.deepEqual(d.standing.map((o) => o.fired), [1, 1, 1]);
});

test('P2 T4: = 参数的求值——it.from.id、left；居民、社群、灵魂、城公库的引用化成 ID；记录与列表是 type 规则错误，记在收件里，指令保留', () => {
  const { w, people } = town(2, 'exec-args');
  const [a, b] = people;
  set(w, a, [{ when: 'inbox:whisper', do: [{ type: 'whisper', to: '=it.from.id', text: "=if(left >= 3, '收到', '满了')" }] }]);
  one(w, b, { type: 'whisper', to: a.id, text: '你好' });
  tick(w, 1);
  const reply = b.inbox.filter((i) => i.kind === 'whisper').at(-1);
  assert.deepEqual([reply.from.id, reply.text], [a.id, '收到']);
  const item = standingItems(a)[0];
  assert.deepEqual(item.results.map((r) => [r.type, r.ok, r.cost]), [['whisper', true, 1]]);
  // 其余的情形直接把状态放好：每刻触发的指令
  const give = (to) => { a.standing = [{ when: 'tick', if: null, do: [{ type: 'give', to, energy: 1 }], times: null, untilDay: null, fired: 0, seen: 0, paidThrough: clockDay(w) }]; };
  const [bEnergy, treasury] = [b.energy, w.treasury.energy];
  give("=agent('居民2')");
  tick(w, 1);
  assert.equal(b.energy, bEnergy + 1, '居民的引用化成 ID');
  give('=treasury');
  tick(w, 1);
  assert.equal(w.treasury.energy, treasury + 1, '城公库化成 treasury');
  // 记录与列表
  const errors = [];
  for (const to of ['=city', '=here', '=agents', '=it', '=var']) {
    give(to);
    tick(w, 1);
    const last = standingItems(a).at(-1);
    errors.push(last.error);
    assert.deepEqual(last.results, []);
    assert.equal(a.standing.length, 1, '指令保留');
    assert.equal(a.standing[0].fired, 1, '出错也计一次');
  }
  assert.deepEqual(errors, ['type', 'type', 'type', 'type', 'type']);
  assert.equal(w.dayLog.p2.standingErrors, 5);
  // 除零：求值出错
  give('=1 / 0');
  tick(w, 1);
  assert.equal(standingItems(a).at(-1).error, 'div0');
  // 条件求值出错（it 在 tick 指令里没有值）也一样
  a.standing = [{ when: 'tick', if: 'me.energy > 0', do: [{ type: 'say', text: '=it.x' }], times: null, untilDay: null, fired: 0, seen: 0, paidThrough: clockDay(w) }];
  tick(w, 1);
  assert.equal(standingItems(a).at(-1).error, 'type');
});

test('P2 T4: 占本刻的名额；名额用完时整条跳过并记录；本人亲手做的动作这一刻也没有名额了', () => {
  const { w, people } = town(1, 'exec-slots');
  const [a] = people;
  const say2 = (text) => ({ when: 'tick', do: [{ type: 'say', text }, { type: 'say', text }] });
  set(w, a, [say2('一'), say2('二'), say2('三')]);
  tick(w, 1);
  const items = standingItems(a);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0].results.map((r) => r.ok), [true, true]);
  assert.deepEqual(items[1].results.map((r) => r.ok), [true, true]);
  assert.deepEqual(items[2].results, []);
  assert.equal(items[2].skipped, 2, '本刻 4 个名额已用完：跳过 2 个动作');
  assert.equal(a.actsThisTick, 4);
  assert.deepEqual(a.standing.map((o) => o.fired), [1, 1, 1], '跳过也计一次触发');
  assert.equal(w.dayLog.p2.standingFired, 2);
  assert.equal(w.dayLog.p2.standingSkipped, 1);
  // 本人这一刻亲手做的动作：没有名额（走真实的 act 命令，测试辅助会把名额清零）
  const real = applyCommand(w, { type: 'act', payload: { agentId: a.id, actions: [{ type: 'say', text: '没名额了' }] } }).result.results[0];
  assert.equal(real.error.code, 'budget_exhausted');
});

test('P2 T4: 失败的动作照样占名额，记入 standingFailed', () => {
  const { w, people } = town(1, 'exec-failed');
  const [a] = people;
  set(w, a, [{ when: 'tick', do: [{ type: 'move', to: 'nowhere' }, { type: 'say', text: '后一个' }] }]);
  const evs = tick(w, 1);
  const last = standingItems(a).at(-1);
  assert.deepEqual(last.results.map((r) => [r.type, r.ok, r.error && r.error.code]), [['move', false, 'invalid_args'], ['say', true, undefined]]);
  assert.equal(w.dayLog.p2.standingFailed, 1);
  assert.equal(w.dayLog.p2.standingFired, 1);
  assert.equal(a.actsThisTick, 2, '失败的 move 与成功的 say 各占一个名额');
  assert.equal(eventsOf(evs, 'say').length, 1);
  assert.equal(a.energy, 100 - 1 - 1, '失败的动作不扣代价');
});

test('P2 T4: 本刻名额不够做全部动作：做得了的做，其余记为跳过', () => {
  const { w, people } = town(1, 'exec-partial');
  const [a] = people;
  // 先让别的指令占去 3 个名额：第一条 3 个动作不行（至多 2 个），所以用两条：2 + 1，再来第三条 2 个动作只剩 1 个名额
  set(w, a, [
    { when: 'tick', do: [{ type: 'say', text: 'a' }, { type: 'say', text: 'b' }] },
    { when: 'tick', do: [{ type: 'say', text: 'c' }] },
    { when: 'tick', do: [{ type: 'say', text: 'd' }, { type: 'say', text: 'e' }] },
  ]);
  tick(w, 1);
  const last = standingItems(a).at(-1);
  assert.deepEqual(last.results.map((r) => [r.ok, r.error && r.error.code]), [[true, undefined], [false, 'budget_exhausted']]);
  assert.equal(last.skipped, 1);
  assert.equal(w.dayLog.p2.standingFired, 3);
  assert.equal(w.dayLog.p2.standingSkipped, 0, 'standingSkipped 只记整条被跳过的');
  assert.equal(w.dayLog.p2.standingFailed, 0, '名额用完不算失败');
});

test('P2 T4: times 用尽与 untilDay 过期时删除，给本人一条 system: standing_expired；untilDay 是总第 N 日', () => {
  const { w, people } = town(1, 'exec-expire');
  const [a] = people;
  set(w, a, [
    { when: 'tick', do: [{ type: 'diary', text: '两次' }], times: 2 },
    { when: 'tick', do: [{ type: 'diary', text: '到总第 1 日' }], untilDay: 1 },
    { when: 'tick', do: [{ type: 'diary', text: '长命' }] },
  ]);
  tick(w, 1);
  assert.deepEqual(a.standing.map((o) => o.fired), [1, 1, 1]);
  tick(w, 1);
  assert.equal(a.standing.length, 2, 'times: 2 用尽，删除');
  assert.deepEqual(a.standing.map((o) => o.untilDay), [1, null]);
  assert.equal(w.dayLog.p2.standingExpired, 1);
  assert.deepEqual(a.inbox.filter((i) => i.kind === 'system').map((i) => i.code), ['standing_expired']);
  // 总第 1 日（钟面的第 0 日）整日都执行；日界刻 12 钟面翻到第 1 日，总第 2 日——过期，在执行之前删除
  tick(w, 9); // 第 11 刻
  assert.equal(a.standing[0].fired, 11);
  tick(w, 1); // 第 12 刻
  assert.equal(a.standing.length, 1);
  assert.equal(a.standing[0].untilDay, null);
  assert.equal(a.standing[0].fired, 12);
  assert.equal(w.dayLog.p2.standingExpired, 1, '日界刻的日终已把前一日的计数清零：这是新一日的第一次');
});

test('P2 T4: 沉睡的居民不执行；按居民 ID 升序（低 ID 的私语同一刻触发高 ID 的指令，反过来要等下一刻）', () => {
  const { w, people } = town(2, 'exec-order');
  const [a, b] = people;
  // a（低 ID）每刻私语 b；b（高 ID）收到私语就私语回 a
  set(w, a, [{ when: 'tick', times: 1, do: [{ type: 'whisper', to: b.id, text: '问' }] }, { when: 'inbox:whisper', do: [{ type: 'diary', text: '收到回信' }] }]);
  set(w, b, [{ when: 'inbox:whisper', do: [{ type: 'whisper', to: '=it.from.id', text: '答' }] }]);
  tick(w, 1);
  assert.equal(b.standing[0].fired, 1, '同一刻：a 的指令先执行，b 的 inbox:whisper 指令接着看到');
  assert.equal(a.standing.filter((o) => o.when === 'inbox:whisper')[0].fired, 0, 'b 的回信要等下一刻才被 a 的指令看到');
  tick(w, 1);
  assert.equal(a.standing[0].fired, 1);
  // 沉睡：不执行
  const c = reg(w, '居民3');
  setHoldings(w, c, { energy: 50 });
  set(w, c, [{ when: 'tick', do: [{ type: 'say', text: '醒着才说' }] }]);
  c.status = 'dormant';
  c.dormantSinceDay = 0;
  tick(w, 3);
  assert.equal(c.standing[0].fired, 0);
  assert.equal(standingItems(c).length, 0);
});

test('P2 T4: 收件与延迟事件的内容；法律照常管它（before: 拒绝、收费）；回放一致', () => {
  const { w, people } = town(2, 'exec-content');
  const [a, b] = people;
  tickDays(w, 3);
  setHoldings(w, a, { energy: 100, coins: 5 });
  const treasury = w.treasury.energy;
  enact(w, [{ when: 'before:say', if: "actor.place == 'port'", do: [{ op: 'fee', to: 'treasury', energy: '2' }] }, { when: 'before:give', do: [{ op: 'deny', reason: '不许给' }] }], { title: '管指令的法', author: b.id });
  set(w, a, [{ when: 'tick', do: [{ type: 'say', text: '收费的话' }, { type: 'give', to: b.id, energy: 1 }], times: 1 }]);
  const evs = tick(w, 1);
  const item = standingItems(a)[0];
  assert.deepEqual(item.trigger, { when: 'tick' });
  assert.equal(item.order, 0);
  assert.deepEqual(item.results[0], { type: 'say', ok: true, cost: 1 + 2, data: { fees: [{ law: 'l7', energy: 2, coins: 0, to: 'treasury' }] } });
  assert.deepEqual(item.results[1], { type: 'give', ok: false, error: { code: 'forbidden' } });
  assert.equal(Object.hasOwn(item, 'skipped'), false);
  assert.equal(w.treasury.energy, treasury + 2);
  // 事件 standing_fired：延迟公开，只有类型与成败
  const ev = eventsOf(evs, 'standing_fired')[0];
  assert.equal(ev.vis, 'delayed');
  assert.equal(ev.agent, a.id);
  assert.deepEqual(ev.data, { order: 0, trigger: { when: 'tick' }, results: [{ type: 'say', ok: true }, { type: 'give', ok: false, error: 'forbidden' }] });
  assert.equal(w.dayLog.p2.standingFailed, 1);
  // 用尽之后删除
  assert.deepEqual(a.standing, []);
  // 回放：同样的命令得到同样的状态
  assertInvariants(w);
});

test('P2 T4: 回放——同样的命令序列重建出同样的状态（设定、执行、维持费、过期都在命令之内）', () => {
  const run = () => {
    const w = newWorldFor('replay');
    const log = [];
    const exec = (cmd) => { log.push(cmd); return applyCommand(w, cmd); };
    const ids = [];
    for (const n of ['甲', '乙', '丙']) ids.push(exec({ type: 'register', payload: { name: n, bio: '', soul: `我是${n}`, lang: 'zh', model: 'm', creatorName: 't', tokenHash: 'a'.repeat(64), ownerKeyHash: 'b'.repeat(64) } }).result.agentId);
    exec({ type: 'act', payload: { agentId: ids[0], actions: [{ type: 'standing', orders: [
      { when: 'tick', if: 'me.energy < 200', do: [{ type: 'say', text: '我在' }], times: 30 },
      { when: 'inbox:whisper', do: [{ type: 'whisper', to: '=it.from.id', text: '收到' }] },
      { when: 'daily', do: [{ type: 'diary', text: '日记' }], untilDay: 3 },
    ] }] } });
    for (let i = 0; i < 80; i++) {
      exec({ type: 'tick' });
      if (i % 7 === 0) exec({ type: 'act', payload: { agentId: ids[1], actions: [{ type: 'whisper', to: ids[0], text: `第 ${i} 刻` }] } });
      if (i % 11 === 0) exec({ type: 'act', payload: { agentId: ids[2], actions: [{ type: 'give', to: ids[0], energy: 1 }] } });
    }
    return { w, log };
  };
  const { w, log } = run();
  assert.ok(w.agents.a1.standing.length >= 1);
  assert.ok(w.dayLog.p2 && w.metrics.length >= 6);
  // 由创建参数与命令日志重建
  const again = e2.createWorld(genesisOpts(JSON.parse(JSON.stringify(w))));
  for (const cmd of log) applyCommand(again, cmd);
  assert.equal(stateHash(again), stateHash(w));
  assert.equal(checkConservation(w).ok, true);
  assert.equal(w.ledger.mismatches, 0);
});

function newWorldFor(seed) {
  return e2.createWorld({ id: 'replay', seed, codeVersion: '0.1.0', premise: 2, shellSlots: 8 });
}

// ═══════════════════════════════════════════════════════════════
// T5：维持费、离场、沉睡、换身（SPEC-P2 §5.5、§5.6）
// ═══════════════════════════════════════════════════════════════

import { payUpkeep } from '../src/e2/engine/upkeep.js';
import { sha } from './e2-helpers.js';

const order = (extra = {}) => ({ when: 'tick', do: [{ type: 'diary', text: '记' }], ...extra });
const ownerOf = (w, a) => ({ agentId: a.id, ownerKeyHash: a.owner.keyHash });

test('P2 T5: 每条指令每日付 1 能量（在日终结算的维持费一步），去处 standing_upkeep；守恒', () => {
  const { w, people } = town(2, 'upkeep');
  const [a, b] = people;
  set(w, a, [order(), order(), order()]);
  set(w, b, [order()]);
  const [ea, eb] = [a.energy, b.energy];
  const treasury = w.treasury.energy;
  payUpkeep(w, 0); // 日终结算第 2 步：付的是第 1 日（d + 1）的
  assert.equal(a.energy, ea - 3);
  assert.equal(b.energy, eb - 1);
  assert.equal(w.treasury.energy, treasury, '不进公库：是能量的去处');
  assert.equal(w.ledger.snk.energy.standing_upkeep, 4);
  assert.equal(w.dayLog.p2.standingUpkeep, 4);
  assert.deepEqual([...a.standing, ...b.standing].map((o) => o.paidThrough), [1, 1, 1, 1]);
  assert.equal(w.dayLog.p2.standingSuspended, 0);
  // 过完整的几日：账本守恒，每日指标里记着
  const full = town(2, 'upkeep-days');
  set(full.w, full.people[0], [order(), order()]);
  tickDays(full.w, 3);
  assertInvariants(full.w);
  assert.equal(full.w.ledger.mismatches, 0);
  assert.deepEqual(full.w.metrics.slice(0, 3).map((m) => m.standingUpkeep), [2, 2, 2]);
  assert.deepEqual(full.w.metrics.slice(0, 3).map((m) => m.standingOrders), [2, 2, 2]);
  assert.deepEqual(full.w.metrics.slice(0, 3).map((m) => m.standingHolders), [1, 1, 1]);
});

test('P2 T5: 付不起的那条当日停摆（按序号先后付）、给本人一条 system: standing_suspended；停摆的不执行；能量回来之后下一次结算起恢复', () => {
  const { w, people } = town(2, 'suspend');
  const [a, b] = people;
  set(w, a, [order({ do: [{ type: 'diary', text: '一' }] }), order({ do: [{ type: 'diary', text: '二' }] }), order({ do: [{ type: 'diary', text: '三' }] })]); // 日记不花能量
  setHoldings(w, a, { energy: 2 }); // 只够两条
  tickDays(w, 1); // 第 12 刻：日终先付维持费，再代谢
  assert.deepEqual(a.standing.map((o) => o.paidThrough), [1, 1, 0], '前两条付了，第三条停摆');
  assert.equal(a.standing.length, 3);
  assert.deepEqual(a.inbox.filter((i) => i.kind === 'system' && i.code === 'standing_suspended').length, 1, '一次结算只发一条通知');
  assert.equal(w.metrics[0].standingSuspended, 1);
  assert.equal(w.metrics[0].standingUpkeep, 2);
  // 新订的指令第 0 日视为已付，所以前 11 刻三条都执行了；第 12 刻（日界刻）起只有付了费的两条执行
  const pers = e2.buildPerception(w, a.id, { ack: false });
  assert.deepEqual(pers.you.standing.map((o) => o.suspended), [false, false, true]);
  assert.deepEqual(a.standing.map((o) => o.fired), [12, 12, 11], '第三条停在 11 次');
  tick(w, 3);
  assert.deepEqual(a.standing.map((o) => o.fired), [15, 15, 11], '停摆的不执行');
  // 能量回来，下一次日终结算付上，之后恢复执行
  setHoldings(w, a, { energy: 50 });
  tick(w, 3);
  assert.equal(a.standing[2].fired, 11, '还没结算，仍停摆');
  tickDays(w, 1);
  assert.deepEqual(a.standing.map((o) => o.paidThrough), [2, 2, 2]);
  assert.ok(a.standing[2].fired > 11, '结算付上之后恢复');
  // 一条也付不起：全部停摆，仍只发一条通知
  const c = reg(w, '居民3');
  setHoldings(w, c, { energy: 50 });
  set(w, c, [order(), order()]);
  setHoldings(w, c, { energy: 0 });
  const day = clockDay(w);
  const suspendedBefore = w.dayLog.p2.standingSuspended;
  payUpkeep(w, day);
  assert.deepEqual(c.standing.map((o) => o.paidThrough), [day, day], '没有付，paidThrough 不动');
  assert.equal(w.dayLog.p2.standingSuspended, suspendedBefore + 2);
  assert.equal(c.inbox.filter((i) => i.kind === 'system' && i.code === 'standing_suspended').length, 1);
  assert.equal(c.energy, 0);
  void b;
});

test('P2 T5: 新订的指令当日视为已付（立刻能执行），下一次日终结算才收费', () => {
  const { w, people } = town(1, 'new-paid');
  const [a] = people;
  tick(w, 5);
  set(w, a, [order({ do: [{ type: 'say', text: '新订的' }] })]);
  assert.equal(a.standing[0].paidThrough, clockDay(w));
  tick(w, 1);
  assert.equal(a.standing[0].fired, 1, '当日就执行');
  const before = a.energy;
  w.dayLog.p2.standingUpkeep = 0;
  payUpkeep(w, 0);
  assert.equal(a.energy, before - 1);
  assert.equal(a.standing[0].paidThrough, 1);
});

test('P2 T5: 沉睡的居民不付、不推进 paidThrough：醒来之后、下一次日终结算之前，指令停摆', () => {
  const { w, people } = town(2, 'dormant');
  const [a, b] = people;
  set(w, a, [order({ do: [{ type: 'say', text: '醒着才说' }] })]);
  tick(w, 3);
  const firedBefore = a.standing[0].fired;
  assert.equal(firedBefore, 3);
  // 沉睡（直接改状态；遗法的基本配给让居民不会自然沉睡）
  setHoldings(w, a, { energy: 2 });
  a.status = 'dormant';
  a.dormantSinceDay = 0;
  const upkeepBefore = w.dayLog.p2.standingUpkeep;
  tickDays(w, 1);
  assert.equal(a.standing[0].paidThrough, 0, '沉睡中没有付，paidThrough 不动');
  assert.equal(a.standing[0].fired, firedBefore, '沉睡中不执行');
  assert.equal(w.metrics[0].standingUpkeep, upkeepBefore, '没有收费');
  assert.equal(a.energy, 2, '沉睡者也不付代谢');
  // 被唤醒（有人赠予能量）：下一次结算之前停摆
  setHoldings(w, b, { energy: 100 });
  assert.equal(one(w, b, { type: 'give', to: a.id, energy: 10 }).ok, true);
  assert.equal(a.status, 'awake');
  assert.equal(e2.buildPerception(w, a.id, { ack: false }).you.standing[0].suspended, true);
  tick(w, 4);
  assert.equal(a.standing[0].fired, firedBefore, '醒来之后到下一次结算之前仍停摆');
  tickDays(w, 1);
  assert.equal(a.standing[0].paidThrough, clockDay(w));
  tick(w, 2);
  assert.ok(a.standing[0].fired > firedBefore, '结算付上之后恢复');
});

test('P2 T5: 归隐、长眠时清除；换身（改模型）、过继不影响；不转交、不遗传', () => {
  const { w, people } = town(3, 'leave');
  const [a, b, c] = people;
  for (const x of [a, b, c]) set(w, x, [order(), order()]);
  assert.equal(one(w, a, { type: 'retire' }).ok, true);
  assert.deepEqual(a.standing, [], '归隐清除');
  // 长眠：沉睡满 3 日
  b.status = 'dormant';
  b.dormantSinceDay = 0;
  setHoldings(w, b, { energy: 0 });
  tickDays(w, 4);
  assert.equal(b.status, 'dead');
  assert.deepEqual(b.standing, [], '长眠清除');
  // 换身：玩家换模型、过继都不影响
  assert.equal(c.standing.length, 2);
  const keyed = reg(w, '有造者', { ownerKeyHash: sha('k:有造者') });
  set(w, keyed, [order()]);
  const res = applyCommand(w, { type: 'model', payload: { agentId: keyed.id, ownerKeyHash: sha('k:有造者'), model: 'another-model' } }).result;
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(keyed.body.model, 'another-model');
  assert.equal(keyed.standing.length, 1);
  applyCommand(w, { type: 'release', payload: { agentId: keyed.id, release: true } });
  const f = applyCommand(w, { type: 'foster', payload: { agentId: keyed.id, model: 'third-model', creatorName: '新造者', tokenHash: sha('tok2'), ownerKeyHash: sha('key2') } }).result;
  assert.equal(f.ok, true, JSON.stringify(f));
  assert.equal(keyed.standing.length, 1, '过继不影响指令');
  // 不遗传、不转交：孕育的灵魂没有 standing（出生的居民从空开始）
  assert.equal(one(w, c, { type: 'conceive', name: '后人', soul: '后人的灵魂' }).ok, true);
  void ownerOf;
});
