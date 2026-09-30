import test from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/params.js';
import { applyCommand } from '../src/engine/index.js';
import { setBlocklist } from '../src/moderation.js';
import { newWorld, reg, sha, act, actRaw, one, tick, settle, tickDays, grant, fundTreasury, eventsOf, assertInvariants } from './helpers.js';

const world = (names = ['甲', '乙', '丙']) => {
  const w = newWorld('soc');
  const agents = names.map((n) => reg(w, n));
  return { w, agents };
};
const at = (a, place) => { a.place = place; };

// ── 社群 ───────────────────────────────────────────────────

test('found：创立社群，你成为管事；花 8 能量；校验名字、宣言与「每个 agent 最多加入 5 个社群」', () => {
  const { w, agents: [a] } = world(['甲']);
  grant(w, a, 100);
  const { result, events } = actRaw(w, a, [{ type: 'found', name: '守灯会', manifesto: '守住那盏灯。' }]);
  const r = result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.cost, 8);
  assert.deepEqual(r.data, { group: 'g1' });
  const g = w.groups.g1;
  assert.deepEqual([g.name, g.open, g.founder, g.steward, g.members, g.pending, g.dissolved], ['守灯会', true, a.id, a.id, [a.id], [], false]);
  assert.deepEqual(g.treasury, { energy: 0, coins: 0 });
  assert.deepEqual(a.groups, ['g1']);
  assert.deepEqual(eventsOf(events, 'found')[0].data, { groupId: 'g1', name: '守灯会', open: true });
  assert.equal(w.dayLog.groups.length, 1);
  assert.equal(one(w, a, { type: 'found', name: '', manifesto: 'x' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'found', name: 'x'.repeat(25), manifesto: 'x' }).error.code, 'text_too_long');
  assert.equal(one(w, a, { type: 'found', name: 'a\nb', manifesto: 'x' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'found', name: '会', manifesto: 'x'.repeat(601) }).error.code, 'text_too_long');
  assert.equal(one(w, a, { type: 'found', name: '会', manifesto: 'x', open: 'yes' }).error.code, 'invalid_args');
  for (let i = 2; i <= 5; i++) assert.equal(one(w, a, { type: 'found', name: `会${i}`, manifesto: 'x', open: i % 2 === 0 }).ok, true);
  assert.equal(one(w, a, { type: 'found', name: '第六个', manifesto: 'x' }).error.code, 'limit_reached');
  assertInvariants(w);
});

test('join / leave / admit：开放社群直接加入；封闭社群进入待审，管事接纳；可以撤回申请', () => {
  const { w, agents: [a, b, c] } = world();
  grant(w, a, 50);
  one(w, a, { type: 'found', name: '开放会', manifesto: 'x' }); // g1
  one(w, a, { type: 'found', name: '封闭会', manifesto: 'x', open: false }); // g2
  const j1 = one(w, b, { type: 'join', group: 'g1' });
  assert.deepEqual([j1.ok, j1.cost, j1.data.joined], [true, 1, true]);
  assert.deepEqual(w.groups.g1.members, [a.id, b.id]);
  assert.deepEqual(b.groups, ['g1']);
  assert.equal(one(w, b, { type: 'join', group: 'g1' }).error.code, 'already');
  assert.equal(one(w, b, { type: 'join', group: 'g9' }).error.code, 'not_found');
  // 封闭社群
  const j2 = one(w, b, { type: 'join', group: 'g2' });
  assert.deepEqual([j2.ok, j2.data.pending], [true, true]);
  assert.deepEqual(w.groups.g2.pending, [b.id]);
  assert.deepEqual(w.groups.g2.members, [a.id]);
  const req = a.inbox.find((i) => i.kind === 'group' && i.event === 'request');
  assert.deepEqual([req.groupId, req.from.id], ['g2', b.id]);
  assert.equal(one(w, b, { type: 'join', group: 'g2' }).error.code, 'already');
  // 只有管事能接纳；只有待审者能被接纳
  assert.equal(one(w, b, { type: 'admit', group: 'g2', agent: b.id }).error.code, 'not_steward');
  assert.equal(one(w, a, { type: 'admit', group: 'g2', agent: c.id }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'admit', group: 'g2', agent: 'a99' }).error.code, 'not_found');
  const ad = one(w, a, { type: 'admit', group: 'g2', agent: b.id });
  assert.equal(ad.ok, true);
  assert.equal(ad.cost, 0);
  assert.deepEqual(w.groups.g2.members, [a.id, b.id]);
  assert.deepEqual(w.groups.g2.pending, []);
  assert.ok(b.inbox.some((i) => i.kind === 'group' && i.groupId === 'g2' && i.event === 'admitted'));
  assert.equal(one(w, a, { type: 'admit', group: 'g2', agent: b.id }).error.code, 'already');
  // 撤回申请
  one(w, c, { type: 'join', group: 'g2' });
  assert.deepEqual(w.groups.g2.pending, [c.id]);
  assert.equal(one(w, c, { type: 'leave', group: 'g2' }).ok, true);
  assert.deepEqual(w.groups.g2.pending, []);
  assert.equal(one(w, c, { type: 'leave', group: 'g2' }).error.code, 'not_member');
  // 每个 agent 最多加入 5 个社群
  for (let i = 3; i <= 7; i++) one(w, a, { type: 'found', name: `会${i}`, manifesto: 'x' });
  assert.equal(a.groups.length, 5); // g1 g2 + 三个
  assertInvariants(w);
});

test('leave / steward：管事退出时交给入社最早的在世成员；最后一人退出社群解散，公库并入城公库', () => {
  const { w, agents: [a, b, c] } = world();
  grant(w, a, 50);
  one(w, a, { type: 'found', name: '会', manifesto: 'x' });
  one(w, b, { type: 'join', group: 'g1' });
  one(w, c, { type: 'join', group: 'g1' });
  one(w, a, { type: 'give', to: 'g1', energy: 10, coins: 4 });
  assert.deepEqual(w.groups.g1.treasury, { energy: 10, coins: 4 });
  // 主动移交
  assert.equal(one(w, b, { type: 'steward', group: 'g1', to: c.id }).error.code, 'not_steward');
  assert.equal(one(w, a, { type: 'steward', group: 'g1', to: a.id }).error.code, 'already');
  const outsider = reg(w, '丁');
  assert.equal(one(w, a, { type: 'steward', group: 'g1', to: outsider.id }).error.code, 'not_member');
  assert.equal(one(w, a, { type: 'steward', group: 'g1', to: c.id }).ok, true);
  assert.equal(w.groups.g1.steward, c.id);
  assert.ok(c.inbox.some((i) => i.kind === 'group' && i.event === 'steward'));
  // 管事 c 退出：交给入社最早的在世成员（a）
  const { events } = actRaw(w, c, [{ type: 'leave', group: 'g1' }]);
  assert.equal(w.groups.g1.steward, a.id);
  assert.deepEqual(w.groups.g1.members, [a.id, b.id]);
  assert.deepEqual(c.groups, []);
  assert.equal(eventsOf(events, 'leave').length, 1);
  assert.equal(eventsOf(events, 'steward').length, 1);
  // 全部退出：解散
  one(w, a, { type: 'leave', group: 'g1' });
  assert.equal(w.groups.g1.steward, b.id);
  const treasuryE = w.treasury.energy;
  const r = one(w, b, { type: 'leave', group: 'g1' });
  assert.equal(r.data.dissolved, true);
  assert.equal(w.groups.g1.dissolved, true);
  assert.deepEqual(w.groups.g1.treasury, { energy: 0, coins: 0 });
  assert.equal(w.treasury.energy, treasuryE + 10);
  assert.equal(w.treasury.coins, 4);
  assert.equal(one(w, a, { type: 'join', group: 'g1' }).error.code, 'not_found'); // 已解散
  assertInvariants(w);
});

test('disburse：管事从社群公库拨付；可以唤醒沉睡者；只有管事能拨付；公库不足时失败', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  grant(w, a, 50);
  one(w, a, { type: 'found', name: '会', manifesto: 'x' });
  one(w, a, { type: 'give', to: 'g1', energy: 20, coins: 5 });
  b.status = 'dormant';
  b.energy = 0;
  w.ledger.prev.energy -= 40;
  assert.equal(one(w, a, { type: 'disburse', group: 'g1', to: b.id, energy: 999 }).error.code, 'insufficient_energy');
  assert.equal(one(w, a, { type: 'disburse', group: 'g1', to: b.id, coins: 999 }).error.code, 'insufficient_coins');
  assert.equal(one(w, a, { type: 'disburse', group: 'g1', to: b.id }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'disburse', group: 'g1', to: 'a99', energy: 1 }).error.code, 'not_found');
  const { result, events } = actRaw(w, a, [{ type: 'disburse', group: 'g1', to: b.id, energy: 12, coins: 3 }]);
  assert.equal(result.results[0].ok, true);
  assert.deepEqual(w.groups.g1.treasury, { energy: 8, coins: 2 });
  assert.equal(b.energy, 12);
  assert.equal(b.status, 'awake'); // 12 ≥ 5：被唤醒
  assert.deepEqual(eventsOf(events, 'disburse')[0].data, { groupId: 'g1', to: b.id, energy: 12, coins: 3 });
  assert.ok(b.inbox.some((i) => i.kind === 'gift' && i.via === 'group' && i.energy === 12));
  // 非管事不能拨付
  assert.equal(one(w, b, { type: 'disburse', group: 'g1', to: a.id, energy: 1 }).error.code, 'not_steward');
  assertInvariants(w);
});

test('社群：管事死亡时管事之职交给入社最早的在世成员；最后一位成员离世社群解散，蓄能池改归全城', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  w.params.rationShare = 0;
  grant(w, a, 50);
  one(w, a, { type: 'found', name: '会', manifesto: 'x' });
  one(w, b, { type: 'join', group: 'g1' });
  one(w, a, { type: 'give', to: 'g1', energy: 6 });
  w.facilities.f1 = { id: 'f1', type: 'reservoir', name: '会池', place: 'agora', to: null, owner: { kind: 'group', id: 'g1' }, condition: 10000, decayPerDay: 0, inscription: null, builtDay: 0, projectId: 'j1', contributors: {}, ruined: false };
  // 甲抽干自己后死去
  one(w, a, { type: 'give', to: 'treasury', energy: a.energy });
  tickDays(w, 4);
  assert.equal(a.status, 'dead');
  assert.equal(w.groups.g1.steward, b.id);
  assert.deepEqual(w.groups.g1.members, [b.id]);
  assert.deepEqual(a.groups, []);
  assert.deepEqual(w.facilities.f1.owner, { kind: 'group', id: 'g1' });
  // 乙也死去 → 解散
  one(w, b, { type: 'give', to: 'treasury', energy: b.energy });
  tickDays(w, 4);
  assert.equal(b.status, 'dead');
  assert.equal(w.groups.g1.dissolved, true);
  assert.deepEqual(w.facilities.f1.owner, { kind: 'city' });
  assertInvariants(w);
});

// ── 交易 ───────────────────────────────────────────────────

test('offer：公开交易须在市场，定向交易任何地点都可以；发起时 give 进入托管；产生事件与收件', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  assert.equal(one(w, a, { type: 'offer', give: { coins: 10 }, want: { energy: 8 } }).error.code, 'wrong_place');
  at(a, 'market');
  const { result, events } = actRaw(w, a, [{ type: 'offer', give: { coins: 10 }, want: { energy: 8 }, note: '换能量' }]);
  const r = result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.cost, 1);
  assert.deepEqual(r.data, { offer: 'o1' });
  const o = w.offers.o1;
  assert.deepEqual([o.from, o.to, o.give, o.want, o.note, o.openedTick, o.expiresTick, o.status], [a.id, null, { energy: 0, coins: 10 }, { energy: 8, coins: 0 }, '换能量', 0, 12, 'open']);
  assert.equal(a.coins, 10); // 托管
  assert.equal(a.energy, 39);
  const ev = eventsOf(events, 'offer_open')[0];
  assert.equal(ev.data.offerId, 'o1');
  // 定向：任何地点
  at(a, 'temple');
  const d = one(w, a, { type: 'offer', give: { energy: 5 }, want: { coins: 3 }, to: b.id });
  assert.equal(d.ok, true);
  const inbox = b.inbox.find((i) => i.kind === 'offer');
  assert.deepEqual([inbox.offerId, inbox.from.id, inbox.give, inbox.want], ['o2', a.id, { energy: 5, coins: 0 }, { energy: 0, coins: 3 }]);
  assertInvariants(w);
});

test('offer：校验——两边不能都为空、不能在同一种资产上两边都非零、不能对自己、托管需要足够的余额', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  at(a, 'market');
  const bad = (o, code, m) => assert.equal(one(w, a, { type: 'offer', ...o }).error.code, code, m);
  bad({ give: {}, want: {} }, 'invalid_args', '都为空');
  bad({ give: { energy: 0 }, want: { coins: 0 } }, 'invalid_args', '都为零');
  bad({ give: { energy: 5 }, want: { energy: 3 } }, 'invalid_args', '能量换能量');
  bad({ give: { coins: 5, energy: 1 }, want: { coins: 3 } }, 'invalid_args', '旧币换旧币');
  bad({ give: 'x', want: { coins: 1 } }, 'invalid_args', '类型');
  bad({ give: { energy: -1 }, want: { coins: 1 } }, 'invalid_args', '负数');
  bad({ give: { energy: 1 }, want: { coins: 1 }, to: a.id }, 'invalid_args', '对自己');
  bad({ give: { energy: 1 }, want: { coins: 1 }, to: 'a99' }, 'not_found', '对象不存在');
  bad({ give: { energy: 1 }, want: { coins: 1 }, note: 'x'.repeat(141) }, 'text_too_long', '附言');
  bad({ give: { energy: 40 }, want: { coins: 1 } }, 'insufficient_energy', '托管 + 代价 = 41 > 40');
  bad({ give: { coins: 21 }, want: { energy: 1 } }, 'insufficient_coins', '旧币不足');
  assert.equal(a.energy, 40);
  assert.equal(a.coins, 20);
  assert.equal(Object.keys(w.offers).length, 0);
  // 只给不要（赠品）与只要不给（求助）都是合法的
  assert.equal(one(w, a, { type: 'offer', give: { energy: 2 }, want: {} }).ok, true);
  assert.equal(one(w, a, { type: 'offer', give: {}, want: { coins: 2 } }).ok, true);
  assert.equal(b.inbox.length, 0);
});

test('accept：原子交换；公开交易须在市场；定向交易只能由 to 接受；不能接受自己的；余额不足失败', () => {
  const { w, agents: [a, b, c] } = world();
  at(a, 'market');
  one(w, a, { type: 'offer', give: { coins: 10 }, want: { energy: 8 } }); // o1
  at(b, 'agora');
  assert.equal(one(w, b, { type: 'accept', offer: 'o1' }).error.code, 'wrong_place');
  at(b, 'market');
  assert.equal(one(w, a, { type: 'accept', offer: 'o1' }).error.code, 'not_allowed');
  assert.equal(one(w, b, { type: 'accept', offer: 'o9' }).error.code, 'not_found');
  b.energy = 5;
  w.ledger.prev.energy -= 35;
  assert.equal(one(w, b, { type: 'accept', offer: 'o1' }).error.code, 'insufficient_energy');
  assert.equal(w.offers.o1.status, 'open'); // 失败不改变任何东西
  grant(w, b, 30);
  const { result, events } = actRaw(w, b, [{ type: 'accept', offer: 'o1' }]);
  assert.deepEqual(result.results[0].data, { gave: { energy: 8, coins: 0 }, got: { energy: 0, coins: 10 } });
  assert.equal(result.results[0].cost, 0);
  assert.deepEqual([a.energy, a.coins, b.energy, b.coins], [39 + 8, 10, 35 - 8, 30]);
  assert.equal(w.offers.o1.status, 'done');
  assert.equal(w.offers.o1.acceptedBy, b.id);
  const trade = a.inbox.find((i) => i.kind === 'trade');
  assert.deepEqual([trade.offerId, trade.with.id, trade.gave, trade.got], ['o1', b.id, { energy: 0, coins: 10 }, { energy: 8, coins: 0 }]);
  assert.equal(eventsOf(events, 'trade').length, 1);
  assert.equal(one(w, c, { type: 'accept', offer: 'o1' }).error.code, 'not_found'); // 已成交
  // 币价指标：只含能量对只含旧币的交易
  assert.deepEqual(w.dayLog.coinTrade, { energy: 8, coins: 10 });
  assert.equal(w.dayLog.coinVolume, 10);
  // 定向交易
  one(w, a, { type: 'offer', give: { energy: 4 }, want: { coins: 2 }, to: b.id }); // o2
  assert.equal(one(w, c, { type: 'accept', offer: 'o2' }).error.code, 'not_allowed');
  at(b, 'temple'); // 定向交易在任何地点都可以接受
  assert.equal(one(w, b, { type: 'accept', offer: 'o2' }).ok, true);
  assertInvariants(w);
});

test('cancel 与过期：撤回自己的交易退回托管；12 刻后过期退回并通知；他人不能撤回', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  at(a, 'market');
  one(w, a, { type: 'offer', give: { coins: 10 }, want: { energy: 8 } }); // o1
  assert.equal(one(w, b, { type: 'cancel', offer: 'o1' }).error.code, 'not_allowed');
  assert.equal(one(w, a, { type: 'cancel', offer: 'o9' }).error.code, 'not_found');
  const { events } = actRaw(w, a, [{ type: 'cancel', offer: 'o1' }]);
  assert.equal(a.coins, 20);
  assert.equal(w.offers.o1.status, 'cancelled');
  assert.deepEqual(eventsOf(events, 'offer_close')[0].data, { offerId: 'o1', reason: 'cancelled' });
  assert.ok(a.inbox.some((i) => i.kind === 'offer_closed' && i.reason === 'cancelled'));
  assert.equal(one(w, a, { type: 'cancel', offer: 'o1' }).error.code, 'not_found');
  // 过期：发起于第 0 刻，expiresTick = 12，在第 12 刻的结算里退回
  one(w, a, { type: 'offer', give: { energy: 6 }, want: { coins: 1 } }); // o2
  tick(w, 11);
  assert.equal(w.offers.o2.status, 'open'); // 第 11 刻：还没到 expiresTick = 12
  at(b, 'market');
  assert.equal(one(w, b, { type: 'accept', offer: 'o2' }).ok, true); // 仍可接受
});

test('过期：托管退回发起者并通知；沉睡的发起者被退回的能量唤醒', () => {
  const { w, agents: [a] } = world(['甲']);
  w.params.rationShare = 0;
  at(a, 'market');
  one(w, a, { type: 'offer', give: { energy: 30 }, want: { coins: 5 } }); // o1，托管 30
  assert.equal(a.energy, 9);
  // 12 刻后过期。第 12 刻同时是日界：先退回托管（每刻第 3 步），再做当日结算（配给、代谢）
  const ev = tick(w, 12);
  assert.equal(w.offers.o1.status, 'expired');
  assert.deepEqual(eventsOf(ev, 'offer_close')[0].data, { offerId: 'o1', reason: 'expired' });
  assert.ok(a.inbox.some((i) => i.kind === 'offer_closed' && i.reason === 'expired'));
  assert.ok(a.energy >= 30); // 30 退回后再扣代谢与腐坏
  assertInvariants(w);
});

test('过期：一个已经沉睡的发起者，托管退回的能量（≥ 5）会唤醒它', () => {
  const { w, agents: [a] } = world(['甲']);
  w.params.rationShare = 0;
  at(a, 'market');
  one(w, a, { type: 'offer', give: { energy: 37 }, want: { coins: 5 } }); // 托管 37，剩 2
  tick(w, 6);
  // 让它在托管期间入睡：能量 2 < 代谢 3。日界在第 12 刻，而交易也在第 12 刻过期——所以把过期延后
  w.offers.o1.expiresTick = 40;
  settle(w);
  assert.equal(a.status, 'dormant');
  assert.equal(a.energy, 0);
  tick(w, 30);
  assert.equal(w.offers.o1.status, 'expired');
  assert.equal(a.status, 'awake'); // 退回的 37 唤醒了它
  assertInvariants(w);
});
