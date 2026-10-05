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
import { one, oneWithEvents, setHoldings, putAt, tickDays } from './e2-helpers.js';
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

test('P2 T3: standing 有处理函数并通过规格的注册检查；mute 要到第 4 步', () => {
  assert.ok(HANDLERS.standing);
  assert.ok(implementedActions(2).includes('standing'));
  assert.ok(!implementedActions(1).includes('standing'));
  assert.ok(!implementedActions(0).includes('standing'));
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
