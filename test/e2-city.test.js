// SPEC-E2 §24.1 测试 7（§25 第 6 步）：城——开辟、模块、修路、工程的出工 / 建成 / 烂尾、拆解、遗址、门、代价倍率、震。
import test from 'node:test';
import assert from 'node:assert/strict';
import { P, MODULE_DEFS } from '../src/e2/params.js';
import { travelCosts, LOT_DEFS, lotsNear } from '../src/e2/map/index.js';
import { placeNameTaken, hasModuleAt } from '../src/e2/engine/places.js';
import {
  newWorld, bareWorld, reg, one, oneWithEvents, setHoldings, setTreasury, fundTreasury, putAt, tick, tickDays, settle, eventsOf, assertInvariants,
} from './e2-helpers.js';
import { enact } from './e2-law-helpers.js';

const drainOut = (w) => { const o = w.$out || []; w.$out = []; return o; };

/** 一座没有法律的城，n 位居民，各 500 能量（便于出工） */
const town = (n = 2, seed = 'city') => {
  const w = bareWorld(seed);
  const people = [];
  for (let i = 0; i < n; i++) {
    const a = reg(w, `民${i + 1}`);
    setHoldings(w, a, { energy: 500 });
    people.push(a);
  }
  return { w, people };
};

/** 发起并出工凑够，返回建成的结果 */
const buildIt = (w, a, args, cost) => {
  const r = one(w, a, { type: 'initiate', ...args });
  assert.equal(r.ok, true, JSON.stringify(r));
  const c = one(w, a, { type: 'contribute', project: r.data.project, energy: cost ?? r.data.need });
  assert.equal(c.ok, true, JSON.stringify(c));
  return { project: r.data.project, result: c.data };
};

// ═══════════════════════════════════════════════════════════════
// 开辟（site）
// ═══════════════════════════════════════════════════════════════

test('initiate site（lot）：须身在空地块相邻的地点；造价城内 40、荒野 30；名字不得重名；owner 缺省 self；记工程、占住空地块、事件 initiate；代价 2', () => {
  const { w, people } = town();
  const [a] = people;
  putAt(w, a, 'market'); // commons-3、commons-4、east-3 与它相邻
  assert.deepEqual(lotsNear(w, 'market'), ['commons-3', 'commons-4', 'east-3']);
  const e0 = a.energy;
  const { r, events } = oneWithEvents(w, a, { type: 'initiate', build: 'site', lot: 'commons-4', name: '灯屋', description: '路口的一盏灯' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.cost, r.data.need, r.data.expiresDay], [2, 40, P.projectDays]);
  assert.equal(a.energy, e0 - 2);
  const j = w.projects[r.data.project];
  assert.deepEqual([j.build, j.lot, j.place, j.name, j.description, j.owner, j.need, j.have, j.initiator, j.status, j.result], ['site', 'commons-4', 'market', '灯屋', '路口的一盏灯', { kind: 'agent', id: a.id }, 40, 0, a.id, 'open', null]);
  assert.equal(w.lots['commons-4'].project, j.id);
  const ev = eventsOf(events, 'initiate')[0];
  assert.deepEqual([ev.data.projectId, ev.data.build, ev.data.type, ev.data.name, ev.data.lot, ev.data.need], [j.id, 'site', 'site', '灯屋', 'commons-4', 40]);
  // 荒野空地块 30（先去荒野的邻地：wilds-1 与 wilds 相邻）
  putAt(w, a, 'wilds');
  assert.equal(one(w, a, { type: 'initiate', build: 'site', lot: 'wilds-1', name: '荒野营地' }).data.need, 30);
  assertInvariants(w);
});

test('initiate site 的错误：lot 与 on 二选一、名字（重名 name_taken、长度）、空地块不存在 / 已被占用 / 已有工程（lot_taken）、不在相邻的地点（wrong_place）、owner 为社群须是管事、同一地点进行中的工程至多 3 个', () => {
  const { w, people } = town(2);
  const [a, b] = people;
  putAt(w, a, 'market');
  const bad = (x) => one(w, a, { type: 'initiate', build: 'site', name: '新地点', ...x });
  assert.equal(bad({}).error.code, 'invalid_args');
  assert.equal(bad({ lot: 'commons-4', on: 'market' }).error.code, 'invalid_args');
  assert.equal(bad({ lot: 'commons-4', name: '' }).error.code, 'invalid_args');
  assert.equal(bad({ lot: 'commons-4', name: 'x'.repeat(25) }).error.code, 'text_too_long');
  assert.equal(bad({ lot: 'commons-4', name: '市场' }).error.code, 'name_taken');
  assert.equal(bad({ lot: 'commons-4', name: 'LIBRARY' }).error.code, 'name_taken', '中英文的人类名字、不区分大小写');
  assert.equal(bad({ lot: 'nowhere' }).error.code, 'not_found');
  assert.equal(bad({ lot: 'harbor-1' }).error.code, 'wrong_place', '不在 market 相邻');
  assert.equal(bad({ lot: 'commons-4', owner: 'g9' }).error.code, 'not_found');
  const g = one(w, b, { type: 'found', name: '会', manifesto: 'x' }).data.group;
  assert.equal(bad({ lot: 'commons-4', owner: g }).error.code, 'not_steward');
  assert.equal(bad({ lot: 'commons-4', owner: 5 }).error.code, 'invalid_args');
  assert.equal(bad({ lot: 'commons-4', description: 'x'.repeat(201) }).error.code, 'text_too_long');
  const first = bad({ lot: 'commons-4' });
  assert.equal(first.ok, true);
  assert.equal(bad({ lot: 'commons-4', name: '另一个' }).error.code, 'lot_taken', '已有开辟它的工程');
  assert.equal(bad({ lot: 'commons-3', name: '第二个' }).ok, true);
  assert.equal(bad({ lot: 'east-3', name: '第三个' }).ok, true);
  assert.equal(one(w, a, { type: 'initiate', build: 'road', to: 'agora' }).error.code, 'limit_reached', 'market 已有 3 个进行中的工程');
  assert.equal(one(w, a, { type: 'initiate', build: 'frobnicate' }).error.code, 'invalid_args');
  const bb = reg(w, '乙乙');
  void bb;
  assertInvariants(w);
});

test('contribute：出工须在工程所在地点；超过还差的、超过自己能量的、已建成 / 不存在的都失败；投入的能量就是代价（不是动作代价）；记 contributed；事件 contribute', () => {
  const { w, people } = town(2);
  const [a, b] = people;
  putAt(w, a, 'market');
  const pid = one(w, a, { type: 'initiate', build: 'site', lot: 'commons-4', name: '灯屋' }).data.project;
  assert.equal(one(w, a, { type: 'contribute', project: 'j99', energy: 5 }).error.code, 'not_found');
  putAt(w, b, 'agora');
  assert.equal(one(w, b, { type: 'contribute', project: pid, energy: 5 }).error.code, 'wrong_place');
  assert.equal(one(w, a, { type: 'contribute', project: pid, energy: 41 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'contribute', project: pid, energy: 0 }).error.code, 'invalid_args');
  setHoldings(w, a, { energy: 3 });
  assert.equal(one(w, a, { type: 'contribute', project: pid, energy: 10 }).error.code, 'insufficient_energy');
  assert.equal(a.energy, 3);
  setHoldings(w, a, { energy: 100 });
  const { r, events } = oneWithEvents(w, a, { type: 'contribute', project: pid, energy: 15 });
  assert.equal(r.ok, true);
  assert.deepEqual([r.cost, r.data], [15, { project: pid, have: 15, need: 40, built: false }]);
  assert.equal(a.energy, 85);
  assert.deepEqual([a.stats.contributed, w.dayLog.contributeSpent, w.projects[pid].have, w.projects[pid].contributors], [15, 15, 15, { [a.id]: 15 }]);
  assert.deepEqual(eventsOf(events, 'contribute')[0].data, { projectId: pid, energy: 15, have: 15, need: 40 });
  assertInvariants(w);
});

test('开辟建成：新地点 n1（xy 与街区取空地块、完好度 10000、衰败 20、墙位 4、残料 = floor(造价 / 2)、origin agent、founder、incarnations）、为 near 的每处加一条小路（城内 1、荒野 2）、记 project_built、事件 built、触发 on:built、收件 project；新地点可走、可修缮、有墙', () => {
  const { w, people } = town(2);
  const [a, b] = people;
  enact(w, [{ when: 'on:built', do: [{ op: 'set', var: 'builtAt', value: 'event.place' }, { op: 'set', var: 'builtKind', value: 'event.build' }] }]);
  putAt(w, a, 'library');
  const pid = one(w, a, { type: 'initiate', build: 'site', lot: 'oldtown-2', name: '星象台', description: '观测天空', owner: 'city' }).data.project;
  assert.deepEqual(lotsNear(w, 'library'), ['oldtown-1', 'oldtown-2']);
  drainOut(w);
  one(w, a, { type: 'contribute', project: pid, energy: 30 });
  putAt(w, b, 'library');
  const sink0 = w.ledger.snk.energy.project_built || 0;
  const { r, events } = oneWithEvents(w, b, { type: 'contribute', project: pid, energy: 10 });
  assert.deepEqual(r.data, { project: pid, have: 40, need: 40, built: true, result: 'n1' });
  const n = w.places.n1;
  const lot = LOT_DEFS['oldtown-2'];
  assert.deepEqual([n.id, n.name, n.description, n.origin, n.district, n.xy, n.wild, n.open, n.explorable, n.landmark], ['n1', '星象台', '观测天空', 'agent', 'oldtown', lot.xy, false, false, false, null]);
  assert.deepEqual([n.condition, n.decayPerDay, n.wallSlots, n.modules, n.salvage, n.salvageMax, n.owner, n.rules, n.ruined, n.razed], [10000, 20, 4, [], 20, 20, { kind: 'city' }, null, false, false]);
  assert.deepEqual([n.founder, n.foundedDay, n.humanName, n.renamedBy], [a.id, 0, null, null]);
  assert.deepEqual(n.incarnations, [{ name: '星象台', origin: 'agent', founder: a.id, fromDay: 0, toDay: null }]);
  assert.deepEqual(w.paths.map((p) => [p.a, p.b, p.cost, p.projectId]), [['n1', 'library', 1, pid], ['n1', 'clocktower', 1, pid], ['n1', 'parliament', 1, pid]]);
  assert.deepEqual(w.lots['oldtown-2'], { place: 'n1', project: null });
  assert.equal(w.projects[pid].status, 'built');
  assert.equal(w.projects[pid].result, 'n1');
  assert.deepEqual(Object.keys(w.places).slice(-2), ['highway', 'n1'], '地点的顺序：人类的在前，后人开辟的在后');
  const ev = eventsOf(events, 'built')[0];
  assert.deepEqual([ev.place, ev.data.projectId, ev.data.build, ev.data.result, ev.data.name, ev.data.contributors], ['n1', pid, 'site', 'n1', '星象台', 2]);
  assert.equal(w.vars.builtAt, 'n1', 'on:built 的 event.place');
  assert.equal(w.vars.builtKind, 'site', 'event.build');
  assert.ok(a.inbox.some((i) => i.kind === 'project' && i.projectId === pid && i.result === 'built'));
  assert.equal(w.ledger.snk.energy.project_built - sink0, 40, '池中的 40 能量记入去处 project_built');
  // 新地点可走：library → n1 代价 1
  assert.equal(travelCosts(w, 'library').n1, 1);
  const mv = one(w, a, { type: 'move', to: 'n1' });
  assert.deepEqual([mv.ok, mv.cost], [true, 1]);
  // 空地块被占用之后不能再开辟
  assert.equal(one(w, a, { type: 'initiate', build: 'site', lot: 'oldtown-2', name: '又一个' }).error.code, 'lot_taken');
  // 有墙（4 个）、可以铭刻、可以修缮（完好度 10000 时 already）
  assert.equal(one(w, a, { type: 'inscribe', text: '星象台落成' }).ok, true);
  assert.equal(one(w, a, { type: 'repair', energy: 5 }).error.code, 'already');
  assertInvariants(w);
});

test('荒野里开辟的地点：造价 30、小路代价 2、is_wild 为真、不可探索（explorable 为假）；注册的名字不与其他地点重名', () => {
  const { w, people } = town(1);
  const [a] = people;
  putAt(w, a, 'highway');
  const { result } = buildIt(w, a, { build: 'site', lot: 'wilds-7', name: '公路驿站' });
  assert.equal(result.result, 'n1');
  const n = w.places.n1;
  assert.deepEqual([n.wild, n.open, n.explorable, n.salvageMax], [true, false, false, 15]);
  assert.deepEqual(w.paths.map((p) => [p.a, p.b, p.cost]), [['n1', 'highway', 2]]);
  putAt(w, a, 'n1');
  assert.equal(one(w, a, { type: 'explore' }).error.code, 'wrong_place', '在荒野里开辟的地点不能探索');
  assert.equal(placeNameTaken(w, '公路驿站'), true);
  assert.equal(placeNameTaken(w, '公路驿站', 'n1'), false, '不与自己比较');
});

test('烂尾：一个月（projectDays）内没有建成，已投入的不退还——记 project_abandoned、释放空地块、事件 abandoned、触发 on:abandoned、收件 project', () => {
  const { w, people } = town(1);
  const [a] = people;
  enact(w, [{ when: 'on:abandoned', do: [{ op: 'set', var: 'lostAt', value: 'event.place' }] }]);
  putAt(w, a, 'market');
  const pid = one(w, a, { type: 'initiate', build: 'site', lot: 'commons-4', name: '没建成' }).data.project;
  one(w, a, { type: 'contribute', project: pid, energy: 25 });
  const total0 = w.treasury.energy;
  void total0;
  tickDays(w, P.projectDays);
  assert.equal(w.projects[pid].status, 'open', 'expiresDay = 创建日 + 24，在第 24 日的日终结算里烂尾（同 v1）');
  const ev = tickDays(w, 1);
  const j = w.projects[pid];
  assert.equal(j.status, 'abandoned');
  assert.equal(w.lots['commons-4'].project, null, '空地块释放');
  const ab = eventsOf(ev, 'abandoned')[0];
  assert.deepEqual([ab.place, ab.data.projectId, ab.data.have, ab.data.need, ab.data.build, ab.data.reason], ['market', pid, 25, 40, 'site', 'expired']);
  assert.equal(w.vars.lostAt, 'market');
  assert.ok(a.inbox.some((i) => i.kind === 'project' && i.projectId === pid && i.result === 'abandoned'));
  assert.equal(one(w, a, { type: 'contribute', project: pid, energy: 5 }).error.code, 'not_found');
  // 空地块又可以开辟
  assert.equal(one(w, a, { type: 'initiate', build: 'site', lot: 'commons-4', name: '重新来' }).ok, true);
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// 加装（module）
// ═══════════════════════════════════════════════════════════════

test('initiate module：建筑须完好度 ≥ 10%、不是广场 / 荒野 / 遗址、模块不超过 4 个、同一种只能有一个（含进行中的）；碑必须给出铭文；全城所有的任何人可以加装，居民所有的只有主人，社群所有的只有成员', () => {
  const { w, people } = town(3);
  const [a, b, c] = people;
  putAt(w, a, 'market');
  const mod = (x) => one(w, a, { type: 'initiate', build: 'module', ...x });
  assert.equal(mod({ module: 'teleporter' }).error.code, 'invalid_args');
  assert.equal(mod({}).error.code, 'invalid_args');
  assert.equal(mod({ module: 'surface' }).error.code, 'invalid_args', '碑必须给出铭文');
  assert.equal(mod({ module: 'store', inscription: '不该有' }).error.code, 'invalid_args');
  assert.equal(mod({ module: 'surface', inscription: 'x'.repeat(141) }).error.code, 'text_too_long');
  assert.equal(mod({ module: 'board' }).error.code, 'already', 'market 原有一个告示板');
  const first = mod({ module: 'store' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.data.need, 80);
  assert.equal(mod({ module: 'store' }).error.code, 'already', '同一种进行中的也算');
  // 完好度太低
  w.places.market.condition = 999;
  assert.equal(mod({ module: 'relay' }).error.code, 'invalid_args');
  w.places.market.condition = 1000;
  assert.equal(mod({ module: 'relay' }).ok, true);
  w.places.market.condition = 10000;
  // 4 个上限：market 有 board + store(进行中) + relay(进行中) = 3，再加一个 = 4，之后失败
  assert.equal(mod({ module: 'sensor' }).ok, true);
  assert.equal(one(w, a, { type: 'initiate', build: 'module', module: 'gate' }).error.code, 'limit_reached', '同一地点进行中的工程至多 3 个');
  // 广场与遗址
  putAt(w, a, 'agora');
  assert.equal(mod({ module: 'store' }).error.code, 'invalid_args');
  // 所有者
  w.places.library.owner = { kind: 'agent', id: b.id };
  putAt(w, a, 'library');
  putAt(w, b, 'library');
  assert.equal(mod({ module: 'store' }).error.code, 'not_owner');
  assert.equal(one(w, b, { type: 'initiate', build: 'module', module: 'store' }).ok, true);
  const g = one(w, c, { type: 'found', name: '会', manifesto: 'x' }).data.group;
  w.places.theater.owner = { kind: 'group', id: g };
  putAt(w, a, 'theater');
  putAt(w, c, 'theater');
  assert.equal(mod({ module: 'store' }).error.code, 'not_owner', '社群所有的只有成员');
  assert.equal(one(w, c, { type: 'initiate', build: 'module', module: 'store' }).ok, true);
  assertInvariants(w);
});

test('模块建成：加入地点的 modules（inherent 假、残料 = floor(造价 / 2)、builtDay、projectId、contributors、碑的铭文）；模块的效果——告示板使公开交易成为可能、档案使著述成为可能；加装的模块使地点每日多衰败', () => {
  const { w, people } = town(2);
  const [a, b] = people;
  putAt(w, a, 'theater');
  assert.equal(one(w, a, { type: 'write', title: '题', body: '文' }).error.code, 'no_module');
  const base = w.places.theater.decayPerDay;
  buildIt(w, a, { build: 'module', module: 'archive' });
  const m = w.places.theater.modules[0];
  assert.deepEqual([m.type, m.salvage, m.builtDay, m.inherent, m.projectId, m.contributors], ['archive', 60, 0, false, 'j1', { [a.id]: 120 }]);
  assert.equal(hasModuleAt(w, 'theater', 'archive'), true);
  assert.equal(one(w, a, { type: 'write', title: '题', body: '文' }).ok, true, '著述现在可以了');
  // 每日多衰败：基础 40 + 档案 20
  const c0 = w.places.theater.condition;
  settle(w);
  assert.equal(c0 - w.places.theater.condition, base + MODULE_DEFS.archive.decay);
  // 碑：铭文存在模块里
  putAt(w, b, 'cemetery');
  const surf = buildIt(w, b, { build: 'module', module: 'surface', inscription: '此处安息着一座城的记忆' });
  void surf;
  const s = w.places.cemetery.modules.find((x) => x.type === 'surface');
  assert.equal(s.inscription, '此处安息着一座城的记忆');
  assert.equal(s.salvage, 50);
  // 事件 built 带 module
  assert.ok(w.dayLog.modulesAdded.some((x) => x.module === 'surface' && x.place === 'cemetery'));
  assertInvariants(w);
});

test('告示板：公开交易只在告示板所在的地点可见、可接受；告示板不运转（完好度 < 3000）时交易仍在但不能被接受', () => {
  const { w, people } = town(2);
  const [a, b] = people;
  putAt(w, a, 'market');
  putAt(w, b, 'market');
  const oid = one(w, a, { type: 'offer', give: { energy: 5 }, want: { coins: 3 } }).data.offer;
  assert.equal(w.offers[oid].board, 'market');
  w.places.market.condition = 2999;
  assert.equal(one(w, b, { type: 'accept', offer: oid }).error.code, 'no_module');
  assert.equal(w.offers[oid].status, 'open');
  w.places.market.condition = 10000;
  assert.equal(one(w, b, { type: 'accept', offer: oid }).ok, true);
});

// ═══════════════════════════════════════════════════════════════
// 修路（road）
// ═══════════════════════════════════════════════════════════════

test('initiate road：任意两地之间（不限于相邻），已有 / 进行中的道路则 already；造价 60；建成生成 Road（f1，完好度 10000、衰败 50）；正常运转时代价为 0；可修缮；完好度 < 3000 时不运转；震与衰败都作用于道路', () => {
  const { w, people } = town(2);
  const [a, b] = people;
  putAt(w, a, 'port');
  const bad = (x) => one(w, a, { type: 'initiate', build: 'road', ...x });
  assert.equal(bad({}).error.code, 'invalid_args');
  assert.equal(bad({ to: 'port' }).error.code, 'invalid_args');
  assert.equal(bad({ to: 'nowhere' }).error.code, 'invalid_args');
  const first = bad({ to: 'temple', name: '长堤' });
  assert.equal(first.ok, true);
  assert.equal(first.data.need, 60);
  assert.equal(bad({ to: 'temple' }).error.code, 'already');
  putAt(w, b, 'temple');
  assert.equal(one(w, b, { type: 'initiate', build: 'road', to: 'port' }).error.code, 'already', '不分方向');
  const before = travelCosts(w, 'port').temple;
  assert.ok(before > 2);
  one(w, a, { type: 'contribute', project: first.data.project, energy: 60 });
  const road = w.roads.f1;
  assert.deepEqual([road.id, road.a, road.b, road.name, road.condition, road.decayPerDay, road.ruined, road.builtDay, road.projectId], ['f1', 'port', 'temple', '长堤', 10000, P.roadDecay, false, 0, first.data.project]);
  assert.equal(travelCosts(w, 'port').temple, 0, '正常运转的道路：代价 0');
  const mv = one(w, a, { type: 'move', to: 'temple' });
  assert.deepEqual([mv.ok, mv.cost], [true, 0]);
  // 衰败与修缮
  road.condition = 4000;
  assert.equal(travelCosts(w, 'port').temple, 0);
  road.condition = 2999;
  assert.equal(travelCosts(w, 'port').temple, before, '完好度低于运转下限：不运转，回到街道的代价');
  putAt(w, a, 'port');
  const rep = one(w, a, { type: 'repair', target: 'f1', energy: 30 });
  assert.equal(rep.ok, true);
  assert.ok(road.condition > 2999);
  assertInvariants(w);
});

test('遗址不切断道路：道路两端的地点成为遗址后，遗址仍是图上的节点，道路与街道照旧，可以走进遗址', () => {
  const { w, people } = town(1);
  const [a] = people;
  putAt(w, a, 'port');
  buildIt(w, a, { build: 'road', to: 'temple' });
  assert.equal(travelCosts(w, 'port').temple, 0);
  putAt(w, a, 'temple');
  w.places.temple.salvage = 1;
  assert.equal(one(w, a, { type: 'dismantle', energy: 1 }).data.razed, true);
  assert.equal(w.places.temple.razed, true);
  putAt(w, a, 'port');
  assert.equal(travelCosts(w, 'port').temple, 0, '遗址仍是节点，道路照旧');
  assert.equal(one(w, a, { type: 'move', to: 'temple' }).ok, true);
  assert.equal(w.roads.f1.condition, 10000);
});

// ═══════════════════════════════════════════════════════════════
// 拆解（dismantle）与遗址
// ═══════════════════════════════════════════════════════════════

test('dismantle 建筑：回收 min(energy ?? 15, 15, 残料)，完好度下降 ceil(回收量 × 10000 / 残料总量)，执行者得能量（来源 salvage），记 salvagedToday / stats / activity；同地醒着的居民收 witness；事件 dismantle 公开；代价 2、不受倍率影响', () => {
  const { w, people } = town(2);
  const [a, b] = people;
  putAt(w, a, 'lighthouse'); // 残料 150
  putAt(w, b, 'lighthouse');
  setHoldings(w, a, { energy: 100 });
  const { r, events } = oneWithEvents(w, a, { type: 'dismantle' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data, { energy: 15, salvageLeft: 135, razed: false });
  assert.equal(r.cost, 2);
  assert.equal(a.energy, 100 - 2 + 15);
  const p = w.places.lighthouse;
  assert.equal(p.condition, 10000 - Math.ceil((15 * 10000) / 150));
  assert.deepEqual([a.salvagedToday, a.stats.salvaged, p.activity.salvaged], [15, 15, 15]);
  assert.equal(w.ledger.src.energy.salvage, 15);
  const ev = eventsOf(events, 'dismantle')[0];
  assert.equal(ev.vis, 'public');
  assert.deepEqual([ev.agent, ev.place, ev.data.energy, ev.data.salvageLeft, ev.data.module], [a.id, 'lighthouse', 15, 135, undefined]);
  const wit = b.inbox.find((i) => i.kind === 'witness');
  assert.deepEqual([wit.what, wit.actor.id, wit.energy, wit.place], ['dismantle', a.id, 15, 'lighthouse']);
  assert.ok(!a.inbox.some((i) => i.kind === 'witness'));
  // energy 参数：更小的取更小的；大于 15 取 15
  assert.equal(one(w, a, { type: 'dismantle', energy: 4 }).data.energy, 4);
  assert.equal(one(w, a, { type: 'dismantle', energy: 99 }).data.energy, 15);
  assert.equal(one(w, a, { type: 'dismantle', energy: 0 }).error.code, 'invalid_args');
  // 废墟时代价仍是 2（不受倍率影响）：把完好度压到 0
  p.condition = 0;
  p.ruined = true;
  const r2 = one(w, a, { type: 'dismantle', energy: 1 });
  assert.equal(r2.cost, 2);
  assertInvariants(w);
});

test('dismantle 的错误：源井与港口是地标（landmark）；广场、荒野、遗址没有残料（nothing_left）；模块不存在为 not_found', () => {
  const { w, people } = town(1);
  const [a] = people;
  for (const [pid, code] of [['well', 'landmark'], ['port', 'landmark'], ['agora', 'nothing_left'], ['wilds', 'nothing_left'], ['scrapyard', 'nothing_left']]) {
    putAt(w, a, pid);
    assert.equal(one(w, a, { type: 'dismantle' }).error.code, code, pid);
  }
  putAt(w, a, 'library');
  assert.equal(one(w, a, { type: 'dismantle', module: 'gate' }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'dismantle', module: 5 }).error.code, 'invalid_args');
  assert.equal(a.energy, 500, '失败的动作不扣能量');
});

test('dismantle 模块：回收 min(energy ?? 15, 15, 模块残料)；残料拆尽即移除；人类建筑原有的模块残料为 0，一次即可移除（回收 0）；拆告示板取消其上的公开交易并退回托管', () => {
  const { w, people } = town(2);
  const [a, b] = people;
  // 后人加装的档案：残料 60
  putAt(w, a, 'theater');
  buildIt(w, a, { build: 'module', module: 'archive' });
  const e0 = a.energy;
  const r1 = one(w, a, { type: 'dismantle', module: 'archive' });
  assert.deepEqual(r1.data, { energy: 15, salvageLeft: 45, razed: false, module: 'archive' });
  assert.equal(a.energy, e0 - 2 + 15);
  assert.equal(w.places.theater.salvage, 300, '建筑本身的残料不变');
  for (let i = 0; i < 3; i++) one(w, a, { type: 'dismantle', module: 'archive' });
  assert.deepEqual(w.places.theater.modules, [], '拆尽即移除');
  assert.equal(one(w, a, { type: 'write', title: '题', body: '文' }).error.code, 'no_module');
  // 人类建筑原有的告示板（market）：残料 0，一次即移除；取消公开交易，退回托管
  putAt(w, b, 'market');
  const oid = one(w, b, { type: 'offer', give: { energy: 20 }, want: { coins: 3 } }).data.offer;
  const bEnergy = b.energy;
  const r2 = one(w, b, { type: 'dismantle', module: 'board' });
  assert.deepEqual(r2.data, { energy: 0, salvageLeft: 0, razed: false, module: 'board' });
  assert.equal(w.places.market.modules.length, 0);
  assert.equal(w.offers[oid].status, 'cancelled');
  assert.equal(b.energy, bEnergy - 2 + 20, '托管退回');
  assertInvariants(w);
});

test('遗址：残料拆尽时成为遗址——razed / open、完好度 null、模块与墙与地点规则没有了、主人归全城、名字保留（遗址的显示名在感知里生成）；墙上的铭刻（含受保护的）全部 lost；进行中的工程烂尾；告示板的交易取消；事件 razed（触发 on:razed）；dayLog.razed', () => {
  const { w, people } = town(2);
  const [a, b] = people;
  enact(w, [{ when: 'on:razed', do: [{ op: 'set', var: 'razedAt', value: 'event.place' }] }]);
  putAt(w, a, 'market');
  putAt(w, b, 'market');
  w.places.market.salvage = 20; // 方便拆尽
  w.places.market.salvageMax = 250;
  w.places.market.owner = { kind: 'agent', id: b.id };
  const ins = one(w, a, { type: 'inscribe', text: '市场的墙' }).data.inscription;
  w.inscriptions[ins].protectedBy.push('l1');
  const pid = one(w, b, { type: 'initiate', build: 'module', module: 'store' }).data.project;
  one(w, b, { type: 'contribute', project: pid, energy: 30 });
  const oid = one(w, b, { type: 'offer', give: { energy: 7 }, want: { coins: 1 } }).data.offer;
  const bEnergy = b.energy;
  one(w, a, { type: 'dismantle', energy: 15 });
  assert.equal(w.places.market.razed, false);
  const { r, events } = oneWithEvents(w, a, { type: 'dismantle' });
  assert.deepEqual(r.data, { energy: 5, salvageLeft: 0, razed: true });
  const p = w.places.market;
  assert.deepEqual([p.razed, p.open, p.condition, p.modules, p.wallSlots, p.rules, p.owner, p.salvage, p.salvageMax, p.ruined, p.name], [true, true, null, [], 0, null, { kind: 'city' }, 0, 0, false, '市场']);
  assert.equal(w.inscriptions[ins].lost, true, '受保护的铭刻也随地点消失');
  assert.equal(w.projects[pid].status, 'abandoned');
  assert.equal(w.offers[oid].status, 'cancelled');
  assert.equal(b.energy, bEnergy + 7);
  assert.equal(p.incarnations.at(-1).toDay, 0);
  const razed = eventsOf(events, 'razed')[0];
  assert.deepEqual([razed.place, razed.data.name], ['market', '市场']);
  assert.equal(w.vars.razedAt, 'market', 'on:razed');
  assert.equal(w.dayLog.razed.length, 1);
  assert.equal(w.counters.razed, 1, '累计遗址数');
  assert.equal(placeNameTaken(w, '市场'), false, '遗址不占用拆毁前的名字');
  // 之后的动作：没有墙、不能修缮、不能装模块、没有残料
  assert.equal(one(w, a, { type: 'inscribe', text: 'x' }).error.code, 'wrong_place', '遗址没有墙');
  assert.equal(one(w, a, { type: 'repair', energy: 3 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'initiate', build: 'module', module: 'store' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'dismantle' }).error.code, 'nothing_left');
  assertInvariants(w);
});

test('遗址上重新开辟：on 为遗址的 ID，须身在遗址或与它有街道 / 小路相连的地点；造价按遗址是否在荒野；复用遗址的 ID 与连接，把它改回建筑（新名字与描述、origin agent、incarnations 追加）；原来的名字又可以用了', () => {
  const { w, people } = town(2);
  const [a, b] = people;
  putAt(w, a, 'lighthouse');
  w.places.lighthouse.salvage = 1;
  one(w, a, { type: 'dismantle', energy: 1 });
  const lh = w.places.lighthouse;
  assert.equal(lh.razed, true);
  const before = JSON.stringify(travelCosts(w, 'port'));
  // 不是遗址 / 没有名字 / 不在相邻
  assert.equal(one(w, a, { type: 'initiate', build: 'site', on: 'market', name: '新灯塔' }).error.code, 'invalid_args');
  putAt(w, b, 'agora');
  assert.equal(one(w, b, { type: 'initiate', build: 'site', on: 'lighthouse', name: '新灯塔' }).error.code, 'wrong_place');
  assert.equal(placeNameTaken(w, '灯塔'), false);
  const { result } = buildIt(w, a, { build: 'site', on: 'lighthouse', name: '新灯塔', description: '重建的灯塔' });
  assert.equal(result.result, 'lighthouse');
  assert.deepEqual([lh.id, lh.name, lh.description, lh.origin, lh.razed, lh.open, lh.condition, lh.decayPerDay, lh.wallSlots, lh.salvage, lh.salvageMax, lh.founder, lh.owner], ['lighthouse', '新灯塔', '重建的灯塔', 'agent', false, false, 10000, 20, 4, 20, 20, a.id, { kind: 'agent', id: a.id }]);
  assert.equal(lh.incarnations.length, 2);
  assert.deepEqual(lh.incarnations[1], { name: '新灯塔', origin: 'agent', founder: a.id, fromDay: 0, toDay: null });
  assert.equal(JSON.stringify(travelCosts(w, 'port')), before, '连接照旧：没有新增小路');
  assert.equal(w.paths.length, 0);
  assertInvariants(w);
});

test('l6（默认世界）：全城所有的建筑未经许可不得拆解；带 salvager 标签的可以；自己的建筑可以拆；拒绝时不扣能量', () => {
  const w = newWorld('l6city');
  const a = reg(w, '甲');
  setHoldings(w, a, { energy: 100 });
  putAt(w, a, 'library');
  const e0 = a.energy;
  const r = one(w, a, { type: 'dismantle' });
  assert.deepEqual([r.error.code, r.error.law, r.error.reason], ['forbidden', 'l6', '全城所有的建筑未经许可不得拆解（人类遗法 l6）']);
  assert.equal(a.energy, e0);
  a.tags.push('salvager');
  assert.equal(one(w, a, { type: 'dismantle' }).ok, true);
  a.tags = ['citizen'];
  w.places.library.owner = { kind: 'agent', id: a.id };
  assert.equal(one(w, a, { type: 'dismantle' }).ok, true);
});

// ═══════════════════════════════════════════════════════════════
// 门、代价倍率、震
// ═══════════════════════════════════════════════════════════════

test('门：装了运转中的门时，默认全城所有的任何人可以进，居民所有的只有主人，社群所有的只有成员；路过不受阻挡；进入荒野地带永远自由；before:enter 取代默认', () => {
  const { w, people } = town(3);
  const [a, b, c] = people;
  putAt(w, a, 'market');
  w.places.court.owner = { kind: 'agent', id: a.id };
  buildIt(w, a, { build: 'module', module: 'gate' }, 40).result;
  putAt(w, a, 'court');
  buildIt(w, a, { build: 'module', module: 'gate' });
  assert.equal(hasModuleAt(w, 'court', 'gate'), true);
  putAt(w, b, 'agora');
  assert.equal(one(w, b, { type: 'move', to: 'court' }).error.code, 'gated');
  assert.equal(one(w, a, { type: 'move', to: 'agora' }).ok, true);
  assert.equal(one(w, a, { type: 'move', to: 'court' }).ok, true, '主人可以进');
  // 路过不受阻挡：court 是 parliament 与 agora 之间的捷径，从 parliament 走到 temple 的最短路经过 court，但只检查目的地
  putAt(w, b, 'parliament');
  assert.equal(travelCosts(w, 'parliament').temple, 2);
  assert.equal(one(w, b, { type: 'move', to: 'temple' }).ok, true, '途经有门的 court 不受阻挡');
  void c;
});

test('代价倍率只对使用模块的动作（著述、读典籍、公开交易、墓志）；其他动作（移动、铭刻、说话）不受影响', () => {
  const { w, people } = town(1);
  const [a] = people;
  putAt(w, a, 'library');
  w.places.library.condition = 3000; // 刚好运转：倍率 17000 / 10000
  assert.equal(one(w, a, { type: 'write', title: '题', body: '文' }).cost, Math.ceil((3 * 17000) / 10000));
  assert.equal(one(w, a, { type: 'say', text: 'hi' }).cost, 1);
  assert.equal(one(w, a, { type: 'inscribe', text: '墙' }).cost, 3);
});

test('名字的唯一性：进行中的开辟工程占用名字（第二个同名的发起为 name_taken）；建成时万一撞名（发起之后有法律给别的地点改了同名），加数字后缀，工程不因此建不成', () => {
  const { w, people } = town(2);
  const [a, b] = people;
  putAt(w, a, 'market');
  const p1 = one(w, a, { type: 'initiate', build: 'site', lot: 'commons-4', name: '灯屋' }).data.project;
  assert.equal(one(w, a, { type: 'initiate', build: 'site', lot: 'commons-3', name: '灯屋' }).error.code, 'name_taken');
  assert.equal(one(w, a, { type: 'initiate', build: 'site', lot: 'commons-3', name: '灯屋 ' }).error.code, 'name_taken', '规范化之后比较');
  // 发起之后，一部法律给 library 改名「灯屋」
  enact(w, [{ when: 'enact', do: [{ op: 'rename', target: 'library', name: '灯屋' }] }]);
  assert.equal(w.places.library.name, '灯屋');
  one(w, a, { type: 'contribute', project: p1, energy: 40 });
  assert.equal(w.projects[p1].status, 'built');
  assert.equal(w.places.n1.name, '灯屋 2');
  assert.equal(w.places.n1.incarnations[0].name, '灯屋 2');
  void b;
});
