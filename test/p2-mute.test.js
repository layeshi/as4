// SPEC-P2 T17（匿名私语，§5.9）与 T18（屏蔽，§5.10）。「不叫醒、不进隐藏列表」的部分随第 5 步（唤醒）补上。
import test from 'node:test';
import assert from 'node:assert/strict';
import e2 from '../src/e2/facade.js';
import { P } from '../src/e2/params.js';
import { setBlocklist } from '../src/moderation.js';
import { one, oneWithEvents, setHoldings, putAt, tick, tickDays, eventsOf, reg } from './e2-helpers.js';
import { town } from './p2-helpers.js';

const per = (w, a) => e2.buildPerception(w, a.id, { ack: false });
const whispers = (a) => a.inbox.filter((i) => i.kind === 'whisper');
const kinds = (a) => a.inbox.map((i) => i.kind);

// ═══════════════════════════════════════════════════════════════
// T17：匿名私语
// ═══════════════════════════════════════════════════════════════

test('P2 T17: 匿名私语——代价 3（普通 1）；收件里没有发送者；延迟事件带 anonymous 与发送者；dayLog.p2.anonymousWhispers', () => {
  const { w, people } = town(2, 'anon');
  const [a, b] = people;
  const before = a.energy;
  const { r, events } = oneWithEvents(w, a, { type: 'whisper', to: b.id, text: '有人想告诉你', anonymous: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.cost, 3);
  assert.equal(a.energy, before - 3);
  assert.deepEqual(r.data, {});
  const item = whispers(b).at(-1);
  assert.deepEqual({ ...item, seq: 0, tick: 0 }, { seq: 0, tick: 0, kind: 'whisper', from: null, anonymous: true, text: '有人想告诉你' });
  assert.equal(JSON.stringify(item).includes(a.id), false, '收件里没有任何发送者的痕迹');
  assert.equal(JSON.stringify(item).includes(a.name), false);
  const ev = events.find((e) => e.type === 'whisper');
  assert.equal(ev.vis, 'delayed');
  assert.deepEqual(ev.data, { from: a.id, to: b.id, text: '有人想告诉你', anonymous: true }, '观测者一个月后看得到是谁');
  assert.equal(w.dayLog.p2.anonymousWhispers, 1);
  // 普通私语：代价 1，署名，事件没有 anonymous
  const plain = oneWithEvents(w, a, { type: 'whisper', to: b.id, text: '是我' });
  assert.equal(plain.r.cost, 1);
  assert.deepEqual(whispers(b).at(-1).from, { id: a.id, name: a.name });
  assert.equal(Object.hasOwn(whispers(b).at(-1), 'anonymous'), false);
  assert.deepEqual(plain.events.find((e) => e.type === 'whisper').data, { from: a.id, to: b.id, text: '是我' });
  assert.equal(w.dayLog.p2.anonymousWhispers, 1);
  // anonymous: false 与省略、null 一样是普通私语
  for (const anonymous of [false, undefined, null]) {
    const x = one(w, a, { type: 'whisper', to: b.id, text: '署名', anonymous });
    assert.equal(x.cost, 1, String(anonymous));
    assert.ok(whispers(b).at(-1).from);
  }
});

test('P2 T17: 雾里 6，有中继时 3（修正照旧按 whisper 算）；普通私语雾里 2', () => {
  const { w, people } = town(2, 'anon-fog');
  const [a, b] = people;
  w.weather.active.push({ type: 'fog', startDay: 0, endDay: 5 });
  assert.equal(one(w, a, { type: 'whisper', to: b.id, text: 'x', anonymous: true }).cost, 6);
  assert.equal(one(w, a, { type: 'whisper', to: b.id, text: 'x' }).cost, 2);
  w.places.temple.modules.push({ type: 'relay', salvage: 60, builtDay: 0, projectId: 'j1', inherent: false }); // 广场是空地，中继不运转；神殿有完好度
  assert.equal(one(w, a, { type: 'whisper', to: b.id, text: 'x', anonymous: true }).cost, 3, '有中继：雾不加倍');
  assert.equal(one(w, a, { type: 'whisper', to: b.id, text: 'x' }).cost, 1);
  // 感知里的代价说明仍按 whisper 的基础代价（动作表 1）
  assert.equal(per(w, a).actions.find((x) => x.type === 'whisper').cost, 1);
});

test('P2 T17: 匿名私语照样审核；anonymous 不是布尔值是 invalid_args；对自己、不存在的人照旧报错；不够付 3 时 insufficient_energy', () => {
  const { w, people } = town(2, 'anon-check');
  const [a, b] = people;
  setBlocklist(['badword']);
  try {
    assert.equal(one(w, a, { type: 'whisper', to: b.id, text: 'a badword here', anonymous: true }).error.code, 'moderated');
  } finally {
    setBlocklist([]);
  }
  for (const anonymous of ['yes', 'true', 1, 0, {}, []]) assert.equal(one(w, a, { type: 'whisper', to: b.id, text: 'x', anonymous }).error.code, 'invalid_args', JSON.stringify(anonymous));
  assert.equal(one(w, a, { type: 'whisper', to: a.id, text: 'x', anonymous: true }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'whisper', to: 'a99', text: 'x', anonymous: true }).error.code, 'not_found');
  setHoldings(w, a, { energy: 2 });
  assert.equal(one(w, a, { type: 'whisper', to: b.id, text: 'x', anonymous: true }).error.code, 'insufficient_energy');
  assert.equal(one(w, a, { type: 'whisper', to: b.id, text: 'x' }).ok, true, '普通私语付得起');
  assert.equal(whispers(b).length, 1);
});

test('P2 T17: 沉睡的对方醒来后收到；规则读不到私语（匿名的也一样）', () => {
  const { w, people } = town(2, 'anon-dormant');
  const [a, b] = people;
  b.status = 'dormant';
  b.dormantSinceDay = 0;
  assert.equal(one(w, a, { type: 'whisper', to: b.id, text: '睡着也收得到', anonymous: true }).ok, true);
  assert.equal(whispers(b).length, 1);
  assert.equal(whispers(b)[0].anonymous, true);
});

test('P2 T17: 常驻指令的 inbox:whisper 也被匿名私语触发：it.from 为 null、it.anonymous 为真；条件里写 it.from.id 会求值出错（记录，指令保留）', () => {
  const { w, people } = town(2, 'anon-standing');
  const [a, b] = people;
  assert.equal(one(w, a, { type: 'standing', orders: [
    { when: 'inbox:whisper', if: 'it.anonymous == true', do: [{ type: 'diary', text: '收到匿名私语' }] },
    { when: 'inbox:whisper', if: "it.from.id == 'a2'", do: [{ type: 'diary', text: '来自 a2' }] },
  ] }).ok, true);
  one(w, b, { type: 'whisper', to: a.id, text: '匿名', anonymous: true });
  tick(w, 1);
  const items = a.inbox.filter((i) => i.kind === 'standing');
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].results.map((r) => [r.type, r.ok]), [['diary', true]]);
  assert.equal(items[1].error, 'type', 'it.from 是 null：取字段出错');
  assert.deepEqual(a.standing.map((o) => o.fired), [1, 1]);
  // 署名的私语：it.anonymous 读到 null（不是 true），第一条条件为假；第二条按 ID 判断
  one(w, b, { type: 'whisper', to: a.id, text: '署名' });
  tick(w, 1);
  assert.equal(a.standing[0].fired, 1);
  assert.equal(a.standing[1].fired, 2);
  assert.equal(a.inbox.filter((i) => i.kind === 'standing').at(-1).results[0].type, 'diary');
});

test('P2 T17: 设定 0、1 里 anonymous 被忽略：代价 1、署名，事件没有 anonymous（与黄金样本一致）', () => {
  for (const premise of [0, 1]) {
    const { w, people } = town(2, `anon-old-${premise}`, { premise });
    const [a, b] = people;
    const { r, events } = oneWithEvents(w, a, { type: 'whisper', to: b.id, text: '署名', anonymous: true });
    assert.equal(r.ok, true);
    assert.equal(r.cost, 1);
    assert.deepEqual(whispers(b).at(-1).from, { id: a.id, name: a.name });
    assert.equal(Object.hasOwn(whispers(b).at(-1), 'anonymous'), false);
    assert.deepEqual(events.find((e) => e.type === 'whisper').data, { from: a.id, to: b.id, text: '署名' });
    // 非布尔值也被忽略，不报错
    assert.equal(one(w, a, { type: 'whisper', to: b.id, text: 'x', anonymous: 'yes' }).ok, true);
    assert.equal(Object.hasOwn(w.dayLog, 'p2'), false);
  }
});

// ═══════════════════════════════════════════════════════════════
// T18：屏蔽
// ═══════════════════════════════════════════════════════════════

test('P2 T18: mute 的参数——who 是居民（ID 或名字）或 "anonymous"；自己、找不到、非字符串；on 缺省为真，非布尔值 invalid_args；代价 0', () => {
  const { w, people } = town(3, 'mute-args');
  const [a, b, c] = people;
  const before = a.energy;
  let r = one(w, a, { type: 'mute', who: b.id });
  assert.deepEqual([r.ok, r.cost, r.data], [true, 0, { who: b.id, on: true, count: 1 }]);
  r = one(w, a, { type: 'mute', who: c.name });
  assert.deepEqual(r.data, { who: c.id, on: true, count: 2 }, '名字也可以，存的是 ID');
  r = one(w, a, { type: 'mute', who: 'anonymous', on: true });
  assert.deepEqual(r.data, { who: 'anonymous', on: true, count: 3 });
  assert.deepEqual(a.muted, [b.id, c.id, 'anonymous']);
  assert.equal(a.energy, before, '代价 0');
  // 重复屏蔽照常成功，名单不变
  r = one(w, a, { type: 'mute', who: b.id });
  assert.deepEqual([r.ok, r.data.count], [true, 3]);
  assert.deepEqual(a.muted, [b.id, c.id, 'anonymous']);
  // 解除
  r = one(w, a, { type: 'mute', who: b.id, on: false });
  assert.deepEqual(r.data, { who: b.id, on: false, count: 2 });
  assert.deepEqual(a.muted, [c.id, 'anonymous']);
  // 解除没有屏蔽的人也成功
  r = one(w, a, { type: 'mute', who: b.id, on: false });
  assert.deepEqual([r.ok, r.data.count], [true, 2]);
  // 错误
  assert.equal(one(w, a, { type: 'mute', who: a.id }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'mute', who: a.name }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'mute', who: 'a99' }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'mute', who: '没有这个人' }).error.code, 'not_found');
  for (const who of [undefined, null, 5, '', {}, ['a2']]) assert.equal(one(w, a, { type: 'mute', who }).error.code, 'invalid_args', JSON.stringify(who));
  for (const on of ['false', 0, 1, 'no', {}]) assert.equal(one(w, a, { type: 'mute', who: b.id, on }).error.code, 'invalid_args', JSON.stringify(on));
  assert.equal(one(w, a, { type: 'mute', who: b.id, on: null }).ok, true, 'null 当作没给');
  assert.deepEqual(a.muted, [c.id, 'anonymous', b.id]);
  // 别人的名单不受影响
  assert.deepEqual(b.muted, []);
});

test('P2 T18: 名单至多 20 个（"anonymous" 也占一个）；满了再屏蔽新的 limit_reached，已有的、解除的不受限', () => {
  const { w, people } = town(23, 'mute-limit');
  const [a, ...others] = people;
  for (let i = 0; i < 19; i++) assert.equal(one(w, a, { type: 'mute', who: others[i].id }).ok, true);
  assert.equal(one(w, a, { type: 'mute', who: 'anonymous' }).data.count, P.muteMax, '第 20 个是 anonymous');
  const full = one(w, a, { type: 'mute', who: others[19].id });
  assert.equal(full.error.code, 'limit_reached');
  assert.equal(full.error.hint.zh, '屏蔽的名单满了（至多 20 个）；先用 on: false 解除一个。');
  assert.equal(full.error.hint.en, 'Your mute list is full (at most 20); unmute someone first with on: false.');
  assert.equal(a.muted.length, 20);
  // 已有的：再屏蔽一次照常成功
  assert.equal(one(w, a, { type: 'mute', who: others[0].id }).ok, true);
  assert.equal(one(w, a, { type: 'mute', who: 'anonymous' }).ok, true);
  // 解除一个，就能屏蔽新的；解除不受上限限制
  assert.equal(one(w, a, { type: 'mute', who: others[0].id, on: false }).ok, true);
  assert.equal(one(w, a, { type: 'mute', who: others[19].id }).ok, true);
  assert.equal(one(w, a, { type: 'mute', who: others[20].id }).error.code, 'limit_reached');
  assert.equal(one(w, a, { type: 'mute', who: others[20].id, on: false }).ok, true, '解除没有屏蔽的人，满了也成功');
});

test('P2 T18: 内心的动作——事件延迟公开、不进任何公开视图；指标 mutes 与 mutedPairs；别人看不到', () => {
  const { w, people } = town(3, 'mute-inner');
  const [a, b, c] = people;
  const { events } = oneWithEvents(w, a, { type: 'mute', who: b.id });
  const ev = events.find((e) => e.type === 'mute');
  assert.equal(ev.vis, 'delayed');
  assert.deepEqual(ev.data, { who: b.id, on: true });
  assert.equal(ev.agent, a.id);
  assert.equal(e2.publicEvent(w, ev), null, '释放之前不公开');
  assert.deepEqual(e2.publicEvent(w, ev, { released: true }).data, { who: b.id, on: true });
  one(w, a, { type: 'mute', who: 'anonymous' });
  one(w, c, { type: 'mute', who: b.id });
  one(w, c, { type: 'mute', who: b.id, on: false });
  assert.equal(w.dayLog.p2.mutes, 4, '每次 mute 动作计一次，含解除');
  // 别人的感知、公开状态、公开居民里没有屏蔽名单
  assert.equal(Object.hasOwn(per(w, b).you, 'muted') && per(w, b).you.muted.length > 0, false);
  assert.deepEqual(per(w, a).you.muted, [{ id: b.id, name: b.name }, 'anonymous']);
  assert.equal(JSON.stringify(e2.publicState(w)).includes('muted'), false);
  assert.equal(Object.hasOwn(e2.publicAgent(w, a), 'muted'), false);
  // 日终指标
  const d = town(3, 'mute-metrics');
  one(d.w, d.people[0], { type: 'mute', who: d.people[1].id });
  one(d.w, d.people[0], { type: 'mute', who: 'anonymous' });
  one(d.w, d.people[2], { type: 'mute', who: d.people[1].id });
  tickDays(d.w, 1);
  const m = d.w.metrics[0];
  assert.equal(m.mutes, 3);
  assert.equal(m.mutedPairs, 2, 'anonymous 不算');
  assert.equal(m.muteBlocked, 0);
  // 屏蔽的对象长眠之后不再计
  d.people[1].status = 'dead';
  tickDays(d.w, 1);
  assert.equal(d.w.metrics[1].mutedPairs, 0);
});

test('P2 T18: 私语被屏蔽——不送到，发送者的结果不变（代价照付），延迟事件带 delivered: false；屏蔽匿名挡住所有匿名私语，屏蔽某人挡不住它的匿名私语', () => {
  const { w, people } = town(3, 'mute-whisper');
  const [a, b, c] = people;
  one(w, b, { type: 'mute', who: a.id });
  const { r, events } = oneWithEvents(w, a, { type: 'whisper', to: b.id, text: '你听得见吗' });
  assert.equal(r.ok, true);
  assert.equal(r.cost, 1);
  assert.equal(whispers(b).length, 0, '没有送到');
  assert.deepEqual(events.find((e) => e.type === 'whisper').data, { from: a.id, to: b.id, text: '你听得见吗', delivered: false });
  assert.equal(w.dayLog.p2.muteBlocked, 1);
  // 屏蔽的是 a：a 的匿名私语仍然送到（匿名没有发送者可屏蔽）
  const anon = oneWithEvents(w, a, { type: 'whisper', to: b.id, text: '匿名的', anonymous: true });
  assert.equal(whispers(b).length, 1);
  assert.deepEqual(anon.events.find((e) => e.type === 'whisper').data, { from: a.id, to: b.id, text: '匿名的', anonymous: true });
  // 屏蔽 anonymous：所有匿名私语都挡住；署名的不受影响
  one(w, b, { type: 'mute', who: 'anonymous' });
  const blocked = oneWithEvents(w, c, { type: 'whisper', to: b.id, text: '匿名二', anonymous: true });
  assert.equal(blocked.r.cost, 3, '代价照付');
  assert.equal(whispers(b).length, 1);
  assert.deepEqual(blocked.events.find((e) => e.type === 'whisper').data, { from: c.id, to: b.id, text: '匿名二', anonymous: true, delivered: false });
  assert.equal(w.dayLog.p2.muteBlocked, 2);
  assert.equal(w.dayLog.p2.anonymousWhispers, 2, '匿名私语照计');
  one(w, c, { type: 'whisper', to: b.id, text: '署名的' });
  assert.equal(whispers(b).length, 2);
  // 解除之后不补发，新的又送得到
  one(w, b, { type: 'mute', who: a.id, on: false });
  assert.equal(whispers(b).length, 2);
  one(w, a, { type: 'whisper', to: b.id, text: '又来了' });
  assert.equal(whispers(b).length, 3);
});

test('P2 T18: 定向交易被屏蔽——交易照常建立、托管，不推收件，感知里不列出，accept 的即时状态不算它；到期照常退回；解除之后重新出现', () => {
  const { w, people } = town(2, 'mute-offer');
  const [a, b] = people;
  one(w, b, { type: 'mute', who: a.id });
  const before = a.coins;
  const { r, events } = oneWithEvents(w, a, { type: 'offer', to: b.id, give: { energy: 0, coins: 5 }, want: { energy: 3, coins: 0 }, note: '换' });
  assert.equal(r.ok, true);
  const o = w.offers[r.data.offer];
  assert.equal(o.status, 'open');
  assert.equal(a.coins, before - 5, '托管照常');
  assert.equal(kinds(b).includes('offer'), false, '不推收件');
  assert.equal(eventsOf(events, 'offer_open').length, 1, '事件照旧');
  assert.equal(w.dayLog.p2.muteBlocked, 1);
  // 感知：you.offers 不列出；accept 的即时状态不算它
  assert.equal(per(w, b).you.offers.length, 0);
  assert.equal(per(w, b).actions.find((x) => x.type === 'accept').available, false);
  // 发送者自己仍看得到
  assert.equal(per(w, a).you.offers.length, 1);
  // 公开交易（告示板）不受影响
  putAt(w, a, 'market');
  putAt(w, b, 'market');
  assert.equal(one(w, a, { type: 'offer', give: { energy: 0, coins: 1 }, want: { energy: 1, coins: 0 } }).ok, true);
  assert.equal(per(w, b).here.board.offers.length, 1);
  assert.equal(per(w, b).actions.find((x) => x.type === 'accept').available, true, '公开交易仍可接受');
  // 解除之后，仍在托管中的定向交易重新出现；收件不补发
  one(w, b, { type: 'mute', who: a.id, on: false });
  assert.equal(per(w, b).you.offers.filter((x) => x.role === 'to').length, 1);
  assert.equal(kinds(b).includes('offer'), false, '不补发');
  // 到期照常退回（定向的与公开的都过期）
  one(w, b, { type: 'mute', who: a.id });
  assert.equal(a.coins, before - 5 - 1);
  tick(w, P.offerTicks + 1);
  assert.equal(o.status, 'expired');
  assert.equal(a.coins, before, '托管退回');
});

test('P2 T18: 孕育之约的邀请被屏蔽——约照常存在（到期作废），不推收件，感知里不列出；发起者自己看得到', () => {
  const { w, people } = town(3, 'mute-pact');
  const [a, b, c] = people;
  one(w, b, { type: 'mute', who: a.id });
  const r = one(w, a, { type: 'conceive', name: '孩子', soul: '孩子的灵魂', with: [b.id, c.id] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const pact = w.pacts[r.data.pact];
  assert.equal(pact.status, 'open');
  assert.equal(kinds(b).includes('pact'), false, '被屏蔽的作者没有收到邀请');
  assert.equal(kinds(c).includes('pact'), true, '没有屏蔽的作者照常收到');
  assert.equal(w.dayLog.p2.muteBlocked, 1);
  assert.equal(per(w, b).you.pacts.length, 0);
  assert.equal(per(w, c).you.pacts.length, 1);
  assert.equal(per(w, a).you.pacts.length, 1);
  // 到期作废，份额退回
  const energy = a.energy;
  tick(w, P.pactTicks + 1);
  assert.equal(pact.status === 'open', false);
  assert.equal(a.energy > energy, true, '发起者的份额退回');
});

test('P2 T18: 交来的记忆被屏蔽——不放进 memoryOffers、不推收件；照常付代价、分配编号；延迟事件带 delivered: false', () => {
  const { w, people } = town(2, 'mute-impart');
  const [a, b] = people;
  one(w, a, { type: 'remember', text: '要交出去的记忆' });
  one(w, b, { type: 'mute', who: a.id });
  const counter = w.counters.k || 0;
  const { r, events } = oneWithEvents(w, a, { type: 'impart', to: b.id, memory: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.cost, 1);
  assert.equal(r.data.gift, `k${counter + 1}`, '编号照常分配');
  assert.deepEqual(b.memoryOffers, []);
  assert.equal(kinds(b).includes('memory_offer'), false);
  assert.deepEqual(events.find((e) => e.type === 'impart').data, { giftId: r.data.gift, to: b.id, origin: a.id, text: '要交出去的记忆', delivered: false });
  assert.equal(w.dayLog.p1.imparts, 1);
  assert.equal(w.dayLog.p2.muteBlocked, 1);
  // 没有屏蔽的人照常收到，事件里没有 delivered
  const c = reg(w, '居民3');
  const ok = oneWithEvents(w, a, { type: 'impart', to: c.id, memory: 0 });
  assert.equal(c.memoryOffers.length, 1);
  assert.equal(Object.hasOwn(ok.events.find((e) => e.type === 'impart').data, 'delivered'), false);
});

test('P2 T18: 入社申请被屏蔽——申请照常进入待审名单，不给管事推收件', () => {
  const { w, people } = town(3, 'mute-join');
  const [a, b, c] = people;
  one(w, a, { type: 'found', name: '小会', manifesto: '一起', open: false });
  one(w, a, { type: 'mute', who: b.id });
  assert.equal(one(w, b, { type: 'join', group: 'g1' }).data.pending, true);
  assert.deepEqual(w.groups.g1.pending, [b.id], '申请照常进入待审名单');
  assert.equal(kinds(a).includes('group'), false, '管事没有收到通知');
  assert.equal(w.dayLog.p2.muteBlocked, 1);
  assert.equal(one(w, c, { type: 'join', group: 'g1' }).data.pending, true);
  assert.equal(a.inbox.filter((i) => i.kind === 'group' && i.event === 'request').length, 1, '没有屏蔽的申请者照常通知');
  // 管事仍可接纳被屏蔽者（待审名单里有它）
  assert.equal(one(w, a, { type: 'admit', group: 'g1', agent: b.id }).ok, true);
});

test('P2 T18: 公开的话、赠予、社群与法案的通知、孕育之约的结果、规则的宣告都不受屏蔽影响', () => {
  const { w, people } = town(3, 'mute-unaffected');
  const [a, b, c] = people;
  one(w, b, { type: 'mute', who: a.id });
  one(w, b, { type: 'mute', who: c.id });
  setHoldings(w, a, { energy: 100 });
  // 说话（同处）、宣告
  one(w, a, { type: 'say', text: '公开的话' });
  one(w, a, { type: 'broadcast', text: '全城的话' });
  assert.ok(b.inbox.some((i) => i.kind === 'say' && i.from.id === a.id));
  assert.ok(b.inbox.some((i) => i.kind === 'broadcast' && i.from.id === a.id));
  // 赠予
  one(w, a, { type: 'give', to: b.id, energy: 4, note: '送' });
  assert.ok(b.inbox.some((i) => i.kind === 'gift' && i.from.id === a.id));
  // 孕育之约的结果：共同作者之间被屏蔽，约的结果照样通知
  const r = one(w, c, { type: 'conceive', name: '孩子', soul: '孩子的灵魂', with: [a.id] });
  assert.equal(r.ok, true);
  assert.equal(one(w, a, { type: 'consent', pact: r.data.pact }).ok, true);
  assert.ok(a.inbox.some((i) => i.kind === 'pact_closed' && i.result === 'consented'));
  // 社群：被屏蔽者创立的社群，成员的变化照常通知
  one(w, a, { type: 'found', name: '会', manifesto: '会', open: true });
  assert.equal(one(w, b, { type: 'join', group: 'g1' }).ok, true);
});

test('P2 T18: 被屏蔽者不会知道——它的动作照常成功、代价照付，结果与没被屏蔽时一样', () => {
  const run = (muted) => {
    const { w, people } = town(2, 'mute-blind');
    const [a, b] = people;
    if (muted) one(w, b, { type: 'mute', who: a.id });
    const out = [
      one(w, a, { type: 'whisper', to: b.id, text: '你好' }),
      one(w, a, { type: 'offer', to: b.id, give: { energy: 0, coins: 2 }, want: { energy: 1, coins: 0 } }),
      one(w, a, { type: 'conceive', name: '孩子', soul: '灵魂', with: [b.id] }),
    ];
    return { out: out.map((x) => ({ type: x.type, ok: x.ok, cost: x.cost })), energy: a.energy, coins: a.coins };
  };
  assert.deepEqual(run(true), run(false));
});

test('P2 T18: 设定 0、1 的世界里没有 mute；居民没有 muted；定向投递照旧', () => {
  for (const premise of [0, 1]) {
    const { w, people } = town(2, `mute-old-${premise}`, { premise });
    const [a, b] = people;
    assert.equal(Object.hasOwn(a, 'muted'), false);
    assert.equal(one(w, b, { type: 'mute', who: a.id }).error.code, 'invalid_args');
    one(w, a, { type: 'whisper', to: b.id, text: '照常' });
    assert.equal(whispers(b).length, 1);
  }
});
