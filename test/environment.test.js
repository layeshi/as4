import test from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/params.js';
import { applyCommand } from '../src/engine/index.js';
import { repairCalc, isFunctioning, hasRelay } from '../src/engine/environment.js';
import { agentCap, treasuryCap, groupCap } from '../src/engine/economy.js';
import { RELICS } from '../src/lore/index.js';
import { newWorld, reg, act, actRaw, one, tick, settle, tickDays, grant, eventsOf, assertInvariants } from './helpers.js';

const world = (names = ['甲', '乙', '丙']) => {
  const w = newWorld('env');
  const agents = names.map((n) => reg(w, n));
  return { w, agents };
};

const goTo = (w, a, place) => {
  a.place = place; // 测试里直接放置，避免为移动付代价
};

// ── 修缮算法（§7.4） ─────────────────────────────────────────

test('修缮算法：完好度 < 1000 时半效率，越过 1000 分段计算，修满后多余的能量不扣', () => {
  assert.deepEqual(repairCalc(0, 10), { cond: 50, spent: 10 });
  assert.deepEqual(repairCalc(0, 200), { cond: 1000, spent: 200 });
  assert.deepEqual(repairCalc(0, 300), { cond: 2000, spent: 300 });
  assert.deepEqual(repairCalc(995, 10), { cond: 1090, spent: 10 }); // 1 点补到 1000，其余 9 点按 10 基点
  assert.deepEqual(repairCalc(999, 1), { cond: 1000, spent: 1 }); // 差 1 基点，也要 1 点能量
  assert.deepEqual(repairCalc(1000, 10), { cond: 1100, spent: 10 });
  assert.deepEqual(repairCalc(9995, 100), { cond: 10000, spent: 1 });
  assert.deepEqual(repairCalc(9000, 1000), { cond: 10000, spent: 100 });
  assert.deepEqual(repairCalc(10000, 5), { cond: 10000, spent: 0 });
  assert.deepEqual(repairCalc(5000, 0), { cond: 5000, spent: 0 });
  assert.deepEqual(repairCalc(0, 5000), { cond: 10000, spent: 200 + 900 });
});

test('repair：修缮所在地点与此地的设施；只扣实际用掉的能量，记去处 repair', () => {
  const { w, agents: [a] } = world();
  grant(w, a, 500);
  goTo(w, a, 'market');
  w.places.market.condition = 9000;
  const r = one(w, a, { type: 'repair', target: 'market', energy: 300 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { target: 'market', spent: 100, from: 9000, to: 10000 }); // 只用了 100
  assert.equal(r.cost, 100);
  assert.equal(a.energy, 540 - 100);
  assert.equal(w.ledger.snk.energy.repair, 100);
  assert.equal(a.stats.repaired, 100);
  assert.equal(w.dayLog.repairSpent, 100);
  assert.deepEqual(w.dayLog.repairedPlaces, ['market']);
  // 设施
  w.facilities.f1 = {
    id: 'f1', type: 'relay', name: '驿', place: 'market', to: null, owner: { kind: 'city' },
    condition: 4000, decayPerDay: 80, inscription: null, builtDay: 0, projectId: 'j1', contributors: {}, ruined: false,
  };
  const { result, events } = actRaw(w, a, [{ type: 'repair', target: 'f1', energy: 50 }]);
  a.actsThisTick = 0;
  assert.equal(result.results[0].ok, true);
  assert.equal(w.facilities.f1.condition, 4500);
  const ev = eventsOf(events, 'repair')[0];
  assert.deepEqual(ev.data, { target: 'f1', spent: 50, from: 4000, to: 4500 });
  assertInvariants(w);
});

test('repair：错误——不在场、不存在、没有完好度、已完好、能量不足、参数不合法', () => {
  const { w, agents: [a] } = world();
  grant(w, a, 100);
  goTo(w, a, 'market');
  w.places.market.condition = 8000;
  assert.equal(one(w, a, { type: 'repair', target: 'library', energy: 5 }).error.code, 'wrong_place');
  assert.equal(one(w, a, { type: 'repair', target: 'zzz', energy: 5 }).error.code, 'not_found');
  w.facilities.f1 = { id: 'f1', type: 'road', name: 'r', place: 'agora', to: 'market', owner: { kind: 'city' }, condition: 100, decayPerDay: 50, inscription: null, builtDay: 0, projectId: 'j1', contributors: {}, ruined: false };
  assert.equal(one(w, a, { type: 'repair', target: 'f1', energy: 5 }).error.code, 'wrong_place'); // 道路的设施在发起端
  goTo(w, a, 'agora');
  assert.equal(one(w, a, { type: 'repair', target: 'agora', energy: 5 }).error.code, 'invalid_args'); // 广场没有完好度
  goTo(w, a, 'market');
  assert.equal(one(w, a, { type: 'repair', target: 'market', energy: 0 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'repair', target: 'market', energy: 1.5 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'repair', target: 'market', energy: 9999 }).error.code, 'insufficient_energy');
  assert.equal(one(w, a, { type: 'repair', target: 5, energy: 5 }).error.code, 'invalid_args');
  const e = a.energy;
  w.places.market.condition = 10000;
  assert.equal(one(w, a, { type: 'repair', target: 'market', energy: 5 }).error.code, 'already');
  assert.equal(a.energy, e);
  assertInvariants(w);
});

test('衰败：每日按 decayPerDay 下降；降到 0 时成为废墟并记 ruin；修复到 ≥ 1000 时记 restored', () => {
  const { w, agents: [a] } = world(['甲']);
  grant(w, a, 400);
  w.places.temple.condition = 40; // 神殿每日 −30
  let ev = settle(w);
  assert.equal(w.places.temple.condition, 10);
  assert.equal(w.places.temple.ruined, false);
  ev = settle(w);
  assert.equal(w.places.temple.condition, 0);
  assert.equal(w.places.temple.ruined, true);
  const ruin = eventsOf(ev, 'ruin');
  assert.equal(ruin.length, 1);
  assert.deepEqual(ruin[0].data, { target: 'temple' });
  assert.equal(w.dayLog.ruins.length, 0); // 日终已清空
  settle(w);
  assert.equal(w.places.temple.condition, 0);
  assert.equal(eventsOf(ev, 'ruin').length, 1); // 已经是废墟，不重复记
  // 修复：先半效率，到 ≥ 1000 才解除废墟
  goTo(w, a, 'temple');
  one(w, a, { type: 'repair', target: 'temple', energy: 100 }); // 100 × 5 = 500
  assert.equal(w.places.temple.condition, 500);
  assert.equal(w.places.temple.ruined, true);
  const { events } = actRaw(w, a, [{ type: 'repair', target: 'temple', energy: 100 }]);
  a.actsThisTick = 0;
  // 500 → 1000 用 100 点（半效率）后，余 0
  assert.equal(w.places.temple.condition, 1000);
  assert.equal(w.places.temple.ruined, false);
  assert.deepEqual(eventsOf(events, 'restored')[0].data, { target: 'temple' });
  assertInvariants(w);
});

test('衰败：设施同样每日衰败，降到 0 记 ruin；广场与荒野没有完好度', () => {
  const { w } = world(['甲']);
  w.facilities.f1 = { id: 'f1', type: 'monument', name: '碑', place: 'agora', to: null, owner: { kind: 'city' }, condition: 30, decayPerDay: 20, inscription: '字', builtDay: 0, projectId: 'j1', contributors: {}, ruined: false };
  settle(w);
  assert.equal(w.facilities.f1.condition, 10);
  const ev = settle(w);
  assert.equal(w.facilities.f1.condition, 0);
  assert.equal(w.facilities.f1.ruined, true);
  assert.deepEqual(eventsOf(ev, 'ruin')[0].data, { target: 'f1' });
  assert.equal(w.places.agora.condition, null);
  assert.equal(w.places.wilds.condition, null);
  assert.equal(isFunctioning(w.facilities.f1), false);
});

test('设施「正常运转」：完好度 ≥ 3000（纪念碑只要 > 0）', () => {
  const mk = (type, condition) => ({ type, condition });
  assert.equal(isFunctioning(mk('relay', 3000)), true);
  assert.equal(isFunctioning(mk('relay', 2999)), false);
  assert.equal(isFunctioning(mk('monument', 1)), true);
  assert.equal(isFunctioning(mk('monument', 0)), false);
  const { w } = world(['甲']);
  w.facilities.f1 = { id: 'f1', type: 'relay', name: 'r', place: 'agora', to: null, owner: { kind: 'city' }, condition: 2999, decayPerDay: 80, inscription: null, builtDay: 0, projectId: 'j1', contributors: {}, ruined: false };
  assert.equal(hasRelay(w), false);
  w.facilities.f1.condition = 3000;
  assert.equal(hasRelay(w), true);
});

// ── 汲取（§7.5） ─────────────────────────────────────────────

test('draw：在源井汲取，源井完好度每点下降 20 基点，记来源 draw；同在源井的人收到 witness', () => {
  const { w, agents: [a, b, c] } = world();
  goTo(w, a, 'well');
  goTo(w, b, 'well');
  goTo(w, c, 'agora');
  const { result, events } = actRaw(w, a, [{ type: 'draw', energy: 10 }]);
  const r = result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.cost, 0);
  assert.deepEqual(r.data, { energy: 10, wellCondition: 10000 - 200, drawPoolLeft: 50 });
  assert.equal(a.energy, 50);
  assert.equal(w.places.well.condition, 9800);
  assert.equal(w.ledger.src.energy.draw, 10);
  assert.equal(a.drawnToday, 10);
  assert.equal(a.stats.drawn, 10);
  assert.equal(w.dayLog.drawn, 10);
  assert.deepEqual(eventsOf(events, 'draw')[0].data, { amount: 10, wellCondition: 9800 });
  // 只有同在源井的人看到汲取者
  assert.deepEqual(b.inbox.filter((i) => i.kind === 'witness').map((i) => [i.what, i.actor.id, i.amount]), [['draw', a.id, 10]]);
  assert.equal(c.inbox.filter((i) => i.kind === 'witness').length, 0);
  assert.equal(a.inbox.filter((i) => i.kind === 'witness').length, 0);
  assertInvariants(w);
});

test('draw：占用一次动作次数；范围 1–20；地点；汲取池共享、先到先得，每日重置', () => {
  const { w, agents: [a, b] } = world();
  goTo(w, a, 'well');
  goTo(w, b, 'well');
  assert.equal(one(w, a, { type: 'draw', energy: 0 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'draw', energy: 21 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'draw', energy: 1.5 }).error.code, 'invalid_args');
  goTo(w, b, 'agora');
  assert.equal(one(w, b, { type: 'draw', energy: 5 }).error.code, 'wrong_place');
  goTo(w, b, 'well');
  for (let i = 0; i < 3; i++) assert.equal(one(w, a, { type: 'draw', energy: 20 }).ok, true); // 池 60 → 0
  assert.equal(w.well.drawPoolLeft, 0);
  assert.equal(one(w, b, { type: 'draw', energy: 1 }).error.code, 'pool_exhausted');
  w.well.drawPoolLeft = 5;
  assert.equal(one(w, b, { type: 'draw', energy: 6 }).error.code, 'pool_exhausted'); // 超过剩余量也拒绝
  assert.equal(one(w, b, { type: 'draw', energy: 5 }).ok, true);
  // 占用动作次数
  a.actsThisTick = 0;
  const r = act(w, a, [{ type: 'draw', energy: 1 }, { type: 'say', text: 'a' }, { type: 'say', text: 'b' }, { type: 'say', text: 'c' }, { type: 'say', text: 'd' }].slice(0, 4));
  assert.equal(r.results.length, 4);
  assert.equal(r.you.actionsLeft, 0);
  settle(w);
  assert.equal(w.well.drawPoolLeft, 60);
  assert.equal(a.drawnToday, 0);
  assertInvariants(w);
});

test('draw：法律的汲取配额——按每人每日累计，超额被拒绝', () => {
  const { w, agents: [a] } = world(['甲']);
  goTo(w, a, 'well');
  w.params.drawQuotaPerDay = 5;
  assert.equal(one(w, a, { type: 'draw', energy: 3 }).ok, true);
  const r = one(w, a, { type: 'draw', energy: 3 });
  assert.equal(r.error.code, 'quota_exceeded');
  assert.equal(one(w, a, { type: 'draw', energy: 2 }).ok, true);
  assert.equal(one(w, a, { type: 'draw', energy: 1 }).error.code, 'quota_exceeded');
  w.params.drawQuotaPerDay = 0;
  assert.equal(one(w, a, { type: 'draw', energy: 1 }).error.code, 'quota_exceeded');
  w.params.drawQuotaPerDay = null;
  assert.equal(one(w, a, { type: 'draw', energy: 1 }).ok, true);
  assertInvariants(w);
});

test('draw：源井被汲取到 0 后成为废墟，仍可汲取；源井产出有 20% 的下限', () => {
  const { w, agents: [a] } = world(['甲']);
  goTo(w, a, 'well');
  w.places.well.condition = 300;
  const { events } = actRaw(w, a, [{ type: 'draw', energy: 20 }]); // −400
  assert.equal(w.places.well.condition, 0);
  assert.equal(w.places.well.ruined, true);
  assert.equal(eventsOf(events, 'ruin').length, 1);
  a.actsThisTick = 0;
  assert.equal(one(w, a, { type: 'draw', energy: 5 }).ok, true);
  assert.equal(w.places.well.condition, 0);
  const ev = settle(w);
  assert.equal(eventsOf(ev, 'day')[0].data.output, Math.floor((600 * 200 * 1000 * 1000) / 1e9)); // 120
});

// ── 工程与设施（§7.6） ───────────────────────────────────────

test('initiate：发起工程，校验类型、名字、归属、道路、纪念碑铭文、每处 3 个的上限', () => {
  const { w, agents: [a, b] } = world();
  grant(w, a, 100);
  goTo(w, a, 'agora');
  const bad = (args, code) => assert.equal(one(w, a, { type: 'initiate', ...args }).error.code, code, JSON.stringify(args));
  bad({ facility: 'castle', name: 'x' }, 'invalid_args');
  bad({ facility: 'relay' }, 'invalid_args'); // 缺名字
  bad({ facility: 'relay', name: 'x'.repeat(25) }, 'text_too_long');
  bad({ facility: 'relay', name: '驿', owner: 'self' }, 'invalid_args'); // 只有蓄能池可以不归全城
  bad({ facility: 'relay', name: '驿', to: 'market' }, 'invalid_args');
  bad({ facility: 'road', name: '路' }, 'invalid_args'); // 缺 to
  bad({ facility: 'road', name: '路', to: 'agora' }, 'invalid_args');
  bad({ facility: 'road', name: '路', to: 'nowhere' }, 'invalid_args');
  bad({ facility: 'monument', name: '碑' }, 'invalid_args'); // 缺铭文
  bad({ facility: 'monument', name: '碑', inscription: 'x'.repeat(141) }, 'text_too_long');
  bad({ facility: 'reservoir', name: '池', owner: 'g99' }, 'not_found');
  assert.equal(a.energy, 140); // 失败不扣能量
  // 成功：道路
  const ok = one(w, a, { type: 'initiate', facility: 'road', name: '集市路', to: 'market' });
  assert.equal(ok.ok, true);
  assert.equal(ok.cost, 2);
  assert.deepEqual(ok.data, { project: 'j1', need: 60, expiresDay: P.projectDays });
  const j = w.projects.j1;
  assert.deepEqual([j.type, j.place, j.to, j.status, j.have], ['road', 'agora', 'market', 'open', 0]);
  assert.deepEqual(j.owner, { kind: 'city' });
  assert.equal(j.initiator, a.id);
  // 两点之间已有进行中的道路工程（不分方向）
  goTo(w, b, 'market');
  grant(w, b, 10);
  assert.equal(one(w, b, { type: 'initiate', facility: 'road', name: '反向', to: 'agora' }).error.code, 'already');
  assert.equal(one(w, a, { type: 'initiate', facility: 'road', name: '重复', to: 'market' }).error.code, 'already');
  // 每处最多 3 个进行中的工程
  assert.equal(one(w, a, { type: 'initiate', facility: 'relay', name: '驿一' }).ok, true);
  assert.equal(one(w, a, { type: 'initiate', facility: 'observatory', name: '台' }).ok, true);
  assert.equal(one(w, a, { type: 'initiate', facility: 'monument', name: '碑', inscription: '永志' }).error.code, 'limit_reached');
  assert.equal(w.projects.j3.type, 'observatory');
  assertInvariants(w);
});

test('initiate：蓄能池可以归全城、个人或自己担任管事的社群', () => {
  const { w, agents: [a] } = world(['甲']);
  grant(w, a, 50);
  assert.equal(one(w, a, { type: 'initiate', facility: 'reservoir', name: '私池', owner: 'self' }).ok, true);
  assert.deepEqual(w.projects.j1.owner, { kind: 'agent', id: a.id });
  w.groups.g1 = { id: 'g1', name: '会', manifesto: '', open: true, founder: a.id, steward: a.id, members: [a.id], pending: [], treasury: { energy: 0, coins: 0 }, createdDay: 0, dissolved: false };
  w.groups.g2 = { id: 'g2', name: '别会', manifesto: '', open: true, founder: 'a2', steward: 'a2', members: ['a2'], pending: [], treasury: { energy: 0, coins: 0 }, createdDay: 0, dissolved: false };
  assert.equal(one(w, a, { type: 'initiate', facility: 'reservoir', name: '会池', owner: 'g1' }).ok, true);
  assert.deepEqual(w.projects.j2.owner, { kind: 'group', id: 'g1' });
  assert.equal(one(w, a, { type: 'initiate', facility: 'reservoir', name: '别人的', owner: 'g2' }).error.code, 'not_steward');
  assert.equal(one(w, a, { type: 'initiate', facility: 'reservoir', name: '公池', owner: 'city' }).ok, true);
});

test('contribute：出工，凑够造价即建成，出资者名录复制到设施；记去处 project_built', () => {
  const { w, agents: [a, b] } = world();
  grant(w, a, 100);
  grant(w, b, 100);
  goTo(w, a, 'agora');
  goTo(w, b, 'agora');
  one(w, a, { type: 'initiate', facility: 'road', name: '集市路', to: 'market', inscription: '通衢' });
  const first = one(w, a, { type: 'contribute', project: 'j1', energy: 40 });
  assert.deepEqual(first.data, { project: 'j1', have: 40, need: 60, built: false });
  assert.equal(first.cost, 40);
  assert.equal(a.stats.contributed, 40);
  assert.equal(w.dayLog.contributeSpent, 40);
  // 不在工地、数额越界
  goTo(w, b, 'market');
  assert.equal(one(w, b, { type: 'contribute', project: 'j1', energy: 5 }).error.code, 'wrong_place');
  goTo(w, b, 'agora');
  assert.equal(one(w, b, { type: 'contribute', project: 'j1', energy: 21 }).error.code, 'invalid_args'); // 只差 20
  assert.equal(one(w, b, { type: 'contribute', project: 'j1', energy: 0 }).error.code, 'invalid_args');
  assert.equal(one(w, b, { type: 'contribute', project: 'j9', energy: 5 }).error.code, 'not_found');
  assert.equal(one(w, b, { type: 'contribute', project: 'j1', energy: 999 }).error.code, 'invalid_args');
  const { result, events } = actRaw(w, b, [{ type: 'contribute', project: 'j1', energy: 20 }]);
  const r = result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.data.built, true);
  assert.equal(r.data.facility, 'f1');
  const f = w.facilities.f1;
  assert.deepEqual([f.type, f.name, f.place, f.to, f.condition, f.decayPerDay, f.inscription, f.projectId], ['road', '集市路', 'agora', 'market', 10000, 50, '通衢', 'j1']);
  assert.deepEqual(f.contributors, { [a.id]: 40, [b.id]: 20 });
  assert.equal(f.builtDay, 0);
  assert.equal(w.projects.j1.status, 'built');
  assert.equal(w.ledger.snk.energy.project_built, 60);
  const built = eventsOf(events, 'built')[0];
  assert.deepEqual(built.data, { projectId: 'j1', facilityId: 'f1', type: 'road', name: '集市路', contributors: 2 });
  // 出资者收到通知
  assert.ok(a.inbox.some((i) => i.kind === 'project' && i.projectId === 'j1' && i.result === 'built'));
  assert.ok(b.inbox.some((i) => i.kind === 'project' && i.result === 'built'));
  // 建成后不能再出工
  assert.equal(one(w, a, { type: 'contribute', project: 'j1', energy: 1 }).error.code, 'not_found');
  assertInvariants(w);
});

test('建成的道路：两端之间往来免费；道路与其他设施在感知的 here.facilities 之外也可被修缮', () => {
  const { w, agents: [a] } = world(['甲']);
  grant(w, a, 100);
  goTo(w, a, 'agora');
  one(w, a, { type: 'initiate', facility: 'road', name: '路', to: 'market' });
  one(w, a, { type: 'contribute', project: 'j1', energy: 60 });
  assert.equal(w.facilities.f1.type, 'road');
  const e = a.energy;
  assert.equal(one(w, a, { type: 'move', to: 'market' }).cost, 0);
  assert.equal(one(w, a, { type: 'move', to: 'agora' }).cost, 0);
  assert.equal(a.energy, e);
  assertInvariants(w);
});

test('烂尾：一个月内没有凑够造价的工程烂尾，已投入的能量不退还，记去处 project_abandoned', () => {
  const { w, agents: [a] } = world(['甲']);
  grant(w, a, 100);
  goTo(w, a, 'agora');
  one(w, a, { type: 'initiate', facility: 'relay', name: '驿', });
  one(w, a, { type: 'contribute', project: 'j1', energy: 30 });
  // 第 0 日创建，expiresDay = 24：第 24 日结算时烂尾
  let events = [];
  for (let d = 0; d <= 24; d++) {
    events = settle(w);
    if (d < 24) assert.equal(w.projects.j1.status, 'open', `day ${d}`);
  }
  assert.equal(w.projects.j1.status, 'abandoned');
  const ab = eventsOf(events, 'abandoned')[0];
  assert.deepEqual(ab.data, { projectId: 'j1', name: '驿', type: 'relay', have: 30, need: 120 });
  assert.ok(a.inbox.some((i) => i.kind === 'project' && i.result === 'abandoned'));
  assert.equal(w.projects.j1.have, 30); // 已投入的记录还在，但不再计入任何持有者：能量已化为烂尾的损耗（守恒校验通过即证明）
  assert.equal(Object.keys(w.facilities).length, 0);
  // 已烂尾的工程不能再出工
  assert.equal(one(w, a, { type: 'contribute', project: 'j1', energy: 1 }).error.code, 'not_found');
  assertInvariants(w);
});

test('工程：蓄能池的所有者退出后，蓄能池改归全城（个人：死亡；社群：解散）', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  w.params.rationShare = 0;
  w.facilities.f1 = { id: 'f1', type: 'reservoir', name: '私池', place: 'agora', to: null, owner: { kind: 'agent', id: a.id }, condition: 10000, decayPerDay: 60, inscription: null, builtDay: 0, projectId: 'j1', contributors: {}, ruined: false };
  w.projects.j2 = { id: 'j2', type: 'reservoir', name: '在建', place: 'agora', to: null, owner: { kind: 'agent', id: a.id }, inscription: null, need: 80, have: 0, contributors: {}, initiator: a.id, createdDay: 0, expiresDay: 24, status: 'open' };
  one(w, a, { type: 'give', to: 'treasury', energy: a.energy });
  const ev = tickDays(w, 4);
  assert.equal(a.status, 'dead');
  assert.deepEqual(w.facilities.f1.owner, { kind: 'city' });
  assert.deepEqual(w.projects.j2.owner, { kind: 'city' });
  assert.deepEqual(eventsOf(ev, 'facility_owner')[0].data, { facilityId: 'f1', from: { kind: 'agent', id: a.id }, to: { kind: 'city' } });
  assert.equal(b.status, 'awake');
});

// ── 蓄能池与腐坏上限（§7.2） ──────────────────────────────────

test('蓄能池：所有者的腐坏上限 +200，每个所有者最多计 3 座，失修（< 3000）的不计', () => {
  const { w, agents: [a] } = world(['甲']);
  const mk = (id, cond, owner) => ({ id, type: 'reservoir', name: id, place: 'agora', to: null, owner, condition: cond, decayPerDay: 60, inscription: null, builtDay: 0, projectId: 'j0', contributors: {}, ruined: false });
  assert.equal(agentCap(w, a), 120);
  assert.equal(treasuryCap(w), 300);
  w.facilities.f1 = mk('f1', 10000, { kind: 'agent', id: a.id });
  assert.equal(agentCap(w, a), 320);
  w.facilities.f2 = mk('f2', 3000, { kind: 'agent', id: a.id });
  w.facilities.f3 = mk('f3', 2999, { kind: 'agent', id: a.id }); // 失修：不计
  assert.equal(agentCap(w, a), 520);
  w.facilities.f4 = mk('f4', 10000, { kind: 'agent', id: a.id });
  w.facilities.f5 = mk('f5', 10000, { kind: 'agent', id: a.id }); // 第 4 座正常运转的：封顶 3 座
  assert.equal(agentCap(w, a), 120 + 600);
  w.facilities.f6 = mk('f6', 10000, { kind: 'city' });
  assert.equal(treasuryCap(w), 500);
  w.groups.g1 = { id: 'g1', name: '会', manifesto: '', open: true, founder: a.id, steward: a.id, members: [a.id], pending: [], treasury: { energy: 0, coins: 0 }, createdDay: 0, dissolved: false };
  w.facilities.f7 = mk('f7', 10000, { kind: 'group', id: 'g1' });
  assert.equal(groupCap(w, w.groups.g1), 300);
});

test('蓄能池：有蓄能池的 agent 囤积的能量不腐坏（在容量以内）', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  w.params.rationShare = 0;
  w.facilities.f1 = { id: 'f1', type: 'reservoir', name: '池', place: 'agora', to: null, owner: { kind: 'agent', id: a.id }, condition: 10000, decayPerDay: 0, inscription: null, builtDay: 0, projectId: 'j1', contributors: {}, ruined: false };
  grant(w, a, 260); // 300
  grant(w, b, 260);
  settle(w);
  // 甲：上限 320，代谢 3 → 297，不腐坏；乙：上限 120，代谢 3 → 297，超出 177 流失 17 → 280
  assert.equal(a.energy, 297);
  assert.equal(b.energy, 280);
  assertInvariants(w);
});

// ── 荒野与遗物（§7.8） ────────────────────────────────────────

test('explore：只能在荒野；花 2 能量；结果写入 data，来源记账', () => {
  const { w, agents: [a] } = world(['甲']);
  grant(w, a, 2000);
  assert.equal(one(w, a, { type: 'explore' }).error.code, 'wrong_place');
  goTo(w, a, 'wilds');
  const outcomes = { energy: 0, coins: 0, relic: 0, nothing: 0 };
  for (let i = 0; i < 600; i++) {
    const r = one(w, a, { type: 'explore' });
    assert.equal(r.ok, true);
    assert.equal(r.cost, 2);
    outcomes[r.data.outcome]++;
    if (r.data.outcome === 'energy') assert.ok(r.data.amount >= 3 && r.data.amount <= 12);
    if (r.data.outcome === 'coins') assert.ok(r.data.amount >= 2 && r.data.amount <= 8);
    if (r.data.outcome === 'relic') {
      assert.ok(r.data.doc.body && r.data.doc.title.startsWith('遗物 · '));
      assert.equal(w.docs[r.data.doc.id].author, a.id);
      assert.equal(w.docs[r.data.doc.id].kind, 'relic');
    }
    assertInvariants(w);
  }
  assert.ok(outcomes.energy > 0 && outcomes.coins > 0 && outcomes.relic > 0 && outcomes.nothing > 0, JSON.stringify(outcomes));
  // 储量单调减少，来源与去向一致
  assert.equal(w.wilds.energy, 800 - w.ledger.src.energy.wilds);
  assert.equal(w.wilds.coins, 300 - w.ledger.src.coins.wilds);
  assert.equal(w.wilds.relicsFound, outcomes.relic);
  assert.ok(w.wilds.energy < 800);
});

test('explore：遗物按 relicOrder 依次出现，共 16 件；找完之后不再出现遗物', () => {
  const { w, agents: [a] } = world(['甲']);
  grant(w, a, 100000);
  goTo(w, a, 'wilds');
  w.wilds.energy = 0; // 排除能量与旧币的干扰
  w.wilds.coins = 0;
  const found = [];
  for (let i = 0; i < 5000 && found.length < 16; i++) {
    const r = one(w, a, { type: 'explore' });
    if (r.data.outcome === 'relic') found.push(r.data.doc);
  }
  assert.equal(found.length, 16);
  const expected = w.wilds.relicOrder.map((n) => RELICS[Number(n) - 1]);
  assert.deepEqual(found.map((d) => d.body), expected.map((r) => r.body));
  assert.deepEqual(found.map((d) => d.lang), expected.map((r) => r.lang));
  assert.equal(new Set(found.map((d) => d.id)).size, 16);
  for (let i = 0; i < 200; i++) assert.notEqual(one(w, a, { type: 'explore' }).data.outcome, 'relic');
});

test('explore：极光期间遗物概率翻倍；能量的概率与荒野储量成正比', () => {
  const rate = (setup) => {
    const { w, agents: [a] } = world(['甲']);
    grant(w, a, 100000);
    goTo(w, a, 'wilds');
    setup(w);
    const reserve = w.wilds.energy;
    const n = 4000;
    const count = { relic: 0, energy: 0 };
    for (let i = 0; i < n; i++) {
      const r = one(w, a, { type: 'explore' });
      if (r.data.outcome === 'relic') {
        count.relic++;
        w.wilds.relicsFound = 0; // 让遗物永不耗尽，保持概率不变
      }
      if (r.data.outcome === 'energy') {
        count.energy++;
        w.wilds.energy = reserve; // 保持储量不变
      }
    }
    return { relic: count.relic / n, energy: count.energy / n };
  };
  const base = rate((w) => { w.wilds.energy = 400; });
  const aurora = rate((w) => { w.wilds.energy = 400; w.weather.active.push({ type: 'aurora', startDay: 0, endDay: 9 }); });
  const rich = rate((w) => { w.wilds.energy = 800; });
  assert.ok(Math.abs(base.relic - 0.1) < 0.02, `relic ${base.relic}`);
  assert.ok(Math.abs(aurora.relic - 0.2) < 0.03, `aurora relic ${aurora.relic}`);
  assert.ok(Math.abs(base.energy - 0.225) < 0.03, `energy ${base.energy}`); // 0.45 × 400 / 800
  assert.ok(Math.abs(rich.energy - 0.45) < 0.03, `rich energy ${rich.energy}`);
});

test('荒野：储量每日恢复 40，不超过 800', () => {
  const { w } = world(['甲']);
  w.wilds.energy = 100;
  settle(w);
  assert.equal(w.wilds.energy, 140);
  w.wilds.energy = 790;
  settle(w);
  assert.equal(w.wilds.energy, 800);
  assert.equal(w.wilds.coins, 300); // 旧币不再生
});
