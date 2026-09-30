// 地图（src/map/，附录 C）：地图定义自检、经典地图与附录 B 一致、边疆世界的创建与确定性、
// 按路程计价的移动、荒野各地带的探索与再生、放逐、感知、公开数据、史官与遗产表、HTTP 与回放。
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, MAP_IDS, DEFAULT_MAP, getMap, mapOf, shortestCosts, publicMap, wildPool } from '../src/map/index.js';
import { PLACE_DEFS, P, snapshotP, restoreP, configureWeather } from '../src/params.js';
import { RELICS, RELICS_FRONTIER, relicByN, L } from '../src/lore/index.js';
import { applyCommand } from '../src/engine/index.js';
import { buildPerception } from '../src/engine/perception.js';
import { publicState, publicPlace } from '../src/engine/visibility.js';
import { stateHash, worldDir } from '../src/store.js';
import { loadConfig } from '../src/config.js';
import { runSandbox } from '../src/sandbox/run.js';
import { configureSandbox } from '../src/sandbox/brains.js';
import { renderPerception } from '../runner/render.js';
import { buildSystemPrompt, promptParams } from '../runner/prompt.js';
import { replayDir } from '../src/tools/replay.js';
import { newWorld, reg, one, grant, tickDays, assertInvariants, eventsOf, settle } from './helpers.js';
import { boot } from './http-helpers.js';

const savedP = snapshotP();
test.after(() => {
  restoreP(savedP);
  configureSandbox({ scenario: 'default' });
  configureWeather({ mode: 'random' });
});

const frontierWorld = (seed = 'frontier-seed') => newWorld(seed, { map: 'frontier' });
const KINDS = new Set(['well', 'cost', 'endow', 'none', 'open']);

// ── 地图定义 ──────────────────────────────────────────────────

test('地图定义自检：ID 唯一、坐标在画布内、街道合法且连通、荒野各地带自成连通、物理字段合法', () => {
  assert.deepEqual([...MAP_IDS].sort(), ['classic', 'frontier']);
  assert.equal(DEFAULT_MAP, 'frontier');
  for (const m of Object.values(MAPS)) {
    const ids = m.places.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${m.id}: ID 重复`);
    const [W, H] = m.size;
    for (const p of m.places) {
      assert.ok(KINDS.has(p.kind), `${m.id}.${p.id} kind`);
      assert.ok(Number.isInteger(p.decay) && p.decay >= 0 && Number.isInteger(p.walls) && p.walls > 0, `${m.id}.${p.id} decay/walls`);
      assert.equal(p.kind === 'open', p.decay === 0, `${m.id}.${p.id}：只有 open 类型没有衰败`);
      assert.ok(p.xy[0] > 0 && p.xy[0] < W && p.xy[1] > 0 && p.xy[1] < H, `${m.id}.${p.id} 坐标越界`);
      assert.equal(typeof p.glyph, 'string');
      if (p.wild) assert.equal(p.kind, 'open', `${m.id}.${p.id}：荒野没有完好度`);
      if (m.districts.length) assert.ok(m.districts.includes(p.district), `${m.id}.${p.id} 街区`);
      for (const lang of ['zh', 'en']) assert.ok(L(lang).place[p.id] && L(lang).place[p.id].name && L(lang).place[p.id].desc, `${lang} 缺少地点 ${p.id}`);
    }
    const seen = new Set();
    for (const e of m.edges) {
      assert.ok(m.byId[e.a] && m.byId[e.b] && e.a !== e.b, `${m.id} 街道 ${e.a}–${e.b}`);
      assert.ok(Number.isInteger(e.cost) && e.cost >= 1, `${m.id} 街道代价`);
      const key = [e.a, e.b].sort().join('|');
      assert.ok(!seen.has(key), `${m.id} 街道重复 ${key}`);
      seen.add(key);
    }
    const all = shortestCosts(m, m.placeIds[0]);
    assert.equal(Object.keys(all).length, m.placeIds.length, `${m.id}：街道图不连通`);
    const wild = shortestCosts(m, m.wildIds[0], { only: (id) => !!m.byId[id].wild });
    assert.equal(Object.keys(wild).length, m.wildIds.length, `${m.id}：荒野各地带之间不连通`);
    for (const id of m.legacy) assert.equal(m.byId[id].kind, 'none', `${m.id} 遗产表里的 ${id}`);
  }
});

test('经典地图与 SPEC §6.4、附录 B 一致（地点表、坐标、装饰性街道）', () => {
  const m = getMap('classic');
  assert.deepEqual(m.places.map(({ id, kind, decay, walls }) => ({ id, kind, decay, walls })), PLACE_DEFS.map((p) => ({ ...p })));
  assert.deepEqual(m.byId.port.xy, [80, 380]);
  assert.deepEqual(m.byId.cemetery.xy, [730, 545]);
  assert.deepEqual(m.byId.wilds.xy, [910, 420]);
  assert.equal(m.edges.length, 16);
  assert.equal(m.distance, false);
  assert.deepEqual(m.wildIds, ['wilds']);
  assert.deepEqual([...m.legacy], ['temple', 'court', 'hospital']);
});

test('边疆地图：原 12 处的物理不变；遗物 1–28 各分到一个地带且只分一次；街道距离', () => {
  const m = getMap('frontier');
  const classic = getMap('classic');
  for (const p of classic.places) {
    const q = m.byId[p.id];
    assert.ok(q, `边疆地图缺少 ${p.id}`);
    assert.deepEqual([q.kind, q.decay, q.walls], [p.kind, p.decay, p.walls], p.id);
  }
  assert.equal(m.placeIds.length, 23);
  assert.equal(m.wildIds.length, 5);
  const relics = m.wildIds.flatMap((id) => m.byId[id].wild.relics);
  assert.deepEqual(relics.slice().sort((a, b) => a - b), Array.from({ length: 28 }, (_, i) => i + 1));
  for (const n of relics) assert.ok(relicByN(n), `遗物 ${n}`);
  assert.equal(RELICS.length, 16);
  assert.deepEqual(RELICS_FRONTIER.map((r) => r.n), Array.from({ length: 12 }, (_, i) => i + 17));
  const d = shortestCosts(m, 'port');
  assert.deepEqual([d.school, d.agora, d.market, d.well, d.wilds, d.highway], [1, 2, 3, 2, 4, 7]);
  assert.equal(shortestCosts(m, 'agora').parliament, 1);
});

// ── 世界 ──────────────────────────────────────────────────────

test('经典世界不写 map / regions 字段，荒野仍在 w.wilds（旧快照逐位相同）', () => {
  const w = newWorld('classic-fields');
  assert.equal('map' in w, false);
  assert.equal('regions' in w, false);
  assert.deepEqual(Object.keys(w.places), PLACE_DEFS.map((p) => p.id));
  assert.equal(w.wilds.energy, P.wildsEnergyMax);
  assert.equal(mapOf(w).id, 'classic');
});

test('边疆世界：23 处地点、5 个荒野地带的储量与遗物顺序；同一种子得到同一个世界', () => {
  const w = frontierWorld();
  assert.equal(w.map, 'frontier');
  assert.equal('wilds' in w, false);
  assert.deepEqual(Object.keys(w.places), getMap('frontier').placeIds);
  assert.equal(w.places.lighthouse.condition, 10000);
  assert.equal(w.places.scrapyard.condition, null);
  assert.equal(w.places.parliament.wallSlots, 12);
  for (const id of getMap('frontier').wildIds) {
    const spec = getMap('frontier').byId[id].wild;
    const pool = w.regions[id];
    assert.equal(pool.energy, spec.energyMax);
    assert.equal(pool.coins, spec.coins);
    assert.equal(pool.relicsFound, 0);
    assert.deepEqual(pool.relicOrder.map(Number).sort((a, b) => a - b), spec.relics.slice().sort((a, b) => a - b));
  }
  assert.equal(stateHash(frontierWorld()), stateHash(w));
  assert.notEqual(stateHash(frontierWorld('another')), stateHash(w));
  assert.throws(() => newWorld('x', { map: 'atlantis' }), /unknown map/);
});

// ── 移动 ──────────────────────────────────────────────────────

test('按路程计价：代价 = 街道图上的最短路；正常运转的道路那段为 0，失修的道路不算；出发地的倍率照旧', () => {
  const w = frontierWorld();
  const a = reg(w, '行者');
  grant(w, a, 200);
  let r = one(w, a, { type: 'move', to: 'agora' }); // port → school → agora
  assert.equal(r.ok, true);
  assert.equal(r.cost, 2);
  r = one(w, a, { type: 'move', to: 'wilds' }); // agora → market → wilds
  assert.equal(r.cost, 2);
  r = one(w, a, { type: 'move', to: 'highway' }); // wilds → scrapyard → highway
  assert.equal(r.cost, 3);
  // 道路：港口—广场（正常运转）
  w.facilities.f1 = { id: 'f1', type: 'road', name: '海路', place: 'port', to: 'agora', owner: { kind: 'city' }, condition: 10000, decayPerDay: 50, inscription: null, builtDay: 0, projectId: 'j1', contributors: {}, ruined: false };
  a.place = 'port';
  assert.equal(one(w, a, { type: 'move', to: 'agora' }).cost, 0);
  assert.equal(one(w, a, { type: 'move', to: 'port' }).cost, 0);
  assert.equal(one(w, a, { type: 'move', to: 'market' }).cost, 1); // 0 + 1
  w.facilities.f1.condition = 2999; // 不运转
  a.place = 'port';
  assert.equal(one(w, a, { type: 'move', to: 'agora' }).cost, 2);
  // 出发地的倍率：市场完好度 0 时 ×2
  a.place = 'market';
  w.places.market.condition = 0;
  assert.equal(one(w, a, { type: 'move', to: 'wilds' }).cost, 2);
  assert.equal(one(w, a, { type: 'move', to: 'nowhere' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'move', to: 'wilds' }).error.code, 'already');
  assertInvariants(w);
});

test('经典世界的移动：任意两地 1，道路两端 0（与 SPEC §7 一致，不受新地图影响）', () => {
  const w = newWorld('classic-move');
  const a = reg(w, '旧人');
  grant(w, a, 50);
  assert.equal(one(w, a, { type: 'move', to: 'cemetery' }).cost, 1);
  assert.equal(one(w, a, { type: 'move', to: 'wilds' }).cost, 1);
  assert.equal(one(w, a, { type: 'move', to: 'lighthouse' }).error.code, 'invalid_args');
});

test('放逐（边疆地图）：被移到荒野，只能在荒野各地带之间移动，代价只走荒野里的路', () => {
  const w = frontierWorld();
  const a = reg(w, '流人');
  grant(w, a, 100);
  a.exiled = true;
  a.place = 'wilds';
  assert.equal(one(w, a, { type: 'move', to: 'market' }).error.code, 'exiled');
  assert.equal(one(w, a, { type: 'move', to: 'scrapyard' }).cost, 1);
  assert.equal(one(w, a, { type: 'move', to: 'saltflats' }).cost, 3); // scrapyard → wilds → saltflats（不能穿城走地铁）
  const p = buildPerception(w, a.id, { ack: false });
  const byId = new Map(p.city.places.map((x) => [x.id, x]));
  assert.equal(byId.get('market').moveCost, null);
  assert.equal(byId.get('highway').moveCost, 2);
  assert.equal(p.actions.find((x) => x.type === 'move').available, true);
});

// ── 荒野各地带 ────────────────────────────────────────────────

test('探索：只在荒野的地带可用；能量、旧币、遗物都从所在地带取出；每日按地带再生；账本守恒', () => {
  const w = frontierWorld('explore-seed');
  const a = reg(w, '拾荒');
  grant(w, a, 5000);
  a.place = 'market';
  assert.equal(one(w, a, { type: 'explore' }).error.code, 'wrong_place');
  const found = [];
  for (const region of ['scrapyard', 'saltflats']) {
    a.place = region;
    const pool = w.regions[region];
    for (let i = 0; i < 300; i++) {
      const r = one(w, a, { type: 'explore' });
      assert.equal(r.ok, true);
      if (r.data.outcome === 'relic') found.push([region, Number(r.data.doc.title.match(/\d+/)[0]), r.data.doc.lang]);
    }
    assert.ok(pool.energy < getMap('frontier').byId[region].wild.energyMax, `${region} 的能量被取走`);
    assert.equal(pool.relicsFound, pool.relicOrder.length, `${region} 的遗物找完了`);
  }
  for (const [region, n, lang] of found) {
    assert.ok(getMap('frontier').byId[region].wild.relics.includes(n), `${region} 找到了别处的遗物 ${n}`);
    assert.equal(lang, relicByN(n).lang);
  }
  assert.equal(w.regions.solarfield.energy, 500); // 没去过的地带不受影响
  const before = w.regions.scrapyard.energy;
  settle(w);
  assert.equal(w.regions.scrapyard.energy, Math.min(250, before + 10));
  assertInvariants(w);
});

test('感知（边疆地图）：地点带街区、荒野标记与实际代价；所在街区；荒野地带的丰度用 richnessWild', () => {
  const w = frontierWorld();
  const a = reg(w, '看客');
  let p = buildPerception(w, a.id, { ack: false });
  assert.deepEqual(p.here.district, { code: 'harbor', text: '港区' });
  const port = p.city.places.find((x) => x.id === 'port');
  assert.deepEqual(port, { id: 'port', name: '港口', district: 'harbor', moveCost: null });
  assert.deepEqual(p.city.places.find((x) => x.id === 'saltflats'), { id: 'saltflats', name: '盐滩', district: 'wilds', wild: true, moveCost: 5 });
  assert.equal(p.actions.find((x) => x.type === 'explore').available, false);
  a.place = 'solarfield';
  p = buildPerception(w, a.id, { ack: false, lang: 'en' });
  assert.deepEqual(p.here.wilds, { richness: 'lush', text: 'plenty left' });
  assert.equal(p.actions.find((x) => x.type === 'explore').available, true);
  // 经典地图的感知不变：地点只有 id 与 name
  const c = newWorld('classic-perc');
  const b = reg(c, '旧客');
  const q = buildPerception(c, b.id, { ack: false });
  assert.deepEqual(q.city.places[0], { id: 'port', name: '港口' });
  assert.equal(q.here.district, undefined);
});

test('运行器：边疆地图的地点按街区分组并标出代价；动作表用按路程计价的 move 说明', () => {
  const w = frontierWorld();
  const a = reg(w, '读者');
  const p = buildPerception(w, a.id, { ack: false });
  const text = renderPerception(p);
  assert.match(text, /地点与移动代价：港区：港口\(port\) 此处、灯塔\(lighthouse\) 1；旧城：/);
  assert.match(text, /荒野：荒野\(wilds\) 4、废车场\(scrapyard\) 5/);
  assert.match(text, /【你在】港口 \[port\] · 港区/);
  const params = promptParams(p);
  assert.equal(params.distance, true);
  assert.match(buildSystemPrompt(params), /代价按路程计/);
  const c = newWorld('classic-render');
  const b = reg(c, '旧读者');
  const q = buildPerception(c, b.id, { ack: false });
  assert.equal(promptParams(q).distance, false);
  assert.doesNotMatch(buildSystemPrompt(promptParams(q)), /代价按路程计/);
  assert.match(renderPerception(q), /地点：港口\(port\)、广场\(agora\)/);
});

// ── 公开数据、史官、遗产表 ──────────────────────────────────────

test('公开数据：地图数据不含种子；state 带 world.map、各地带与合计；地点带街区', () => {
  const w = frontierWorld('public-seed');
  const m = publicMap(w);
  assert.equal(m.id, 'frontier');
  assert.equal(m.places.length, 23);
  assert.deepEqual(m.places.find((x) => x.id === 'solarfield').wild, { energyMax: 500, regen: 25 });
  assert.equal(JSON.stringify(m).includes('public-seed'), false);
  const st = publicState(w);
  assert.equal(st.world.map, 'frontier');
  assert.equal(st.places.length, 23);
  assert.equal(st.regions.length, 5);
  assert.deepEqual(st.wilds, { energy: 1500, coins: 500, richness: 'lush', relicsFound: 0 });
  assert.deepEqual(publicPlace(w, 'metro').district, 'waterworks');
  assert.equal(publicPlace(w, 'highway').wild, true);
  const c = newWorld('classic-public');
  const cs = publicState(c);
  assert.equal(cs.world.map, 'classic');
  assert.deepEqual(cs.regions.map((r) => [r.id, r.energy, r.energyMax, r.relics]), [['wilds', 800, 800, 16]]);
  assert.equal(publicMap(c).places.length, 12);
});

test('史官写出拾得遗物的地带；遗产表列出边疆地图的空壳建筑', () => {
  const w = frontierWorld('chron-seed');
  const a = reg(w, '史料');
  grant(w, a, 2000);
  a.place = 'highway';
  for (let i = 0; i < 200 && w.regions.highway.relicsFound === 0; i++) one(w, a, { type: 'explore' });
  assert.ok(w.regions.highway.relicsFound > 0);
  tickDays(w, 1);
  const zh = w.chronicle.map((c) => c.zh).join('\n');
  assert.match(zh, /史料 在公路尽头拾得遗物。/);
  assert.match(w.chronicle.map((c) => c.en).join('\n'), /found a relic at the Road's End\./);
  const keys = w.legacy.items.map((x) => x.key);
  for (const id of ['temple', 'lighthouse', 'clocktower', 'metro', 'workshop']) assert.ok(keys.includes(id), id);
  assert.equal(w.legacy.items.find((x) => x.key === 'lighthouse').name.zh, '灯塔');
});

// ── 沙盘、HTTP 与回放 ──────────────────────────────────────────

test('沙盘（边疆地图）：守恒、确定；沙盘脑去了多个荒野地带，移动不会因为到不了而失败', () => {
  const run = () => runSandbox({ days: 60, agents: 16, seed: 7, map: 'frontier' });
  const { world, report } = run();
  assert.equal(report.meta.map, 'frontier');
  assert.equal(report.meta.conservationFailure, null);
  assert.equal(world.map, 'frontier');
  const explored = Object.values(world.regions).filter((r, i) => r.energy < getMap('frontier').byId[getMap('frontier').wildIds[i]].wild.energyMax || r.relicsFound > 0);
  assert.ok(explored.length >= 2, '至少两个地带被探索过');
  assert.ok(report.actionUsage.move.ok > 50);
  assert.equal(stateHash(run().world), stateHash(world));
  const classic = runSandbox({ days: 5, agents: 8, seed: 7, map: 'classic' });
  assert.equal('map' in classic.world, false);
});

test('HTTP：新世界默认用边疆地图，GET /api/public/map 可用；MAP=classic 创建经典世界；MAP 不合法时报错', async () => {
  assert.equal(loadConfig({}, []).map, 'frontier');
  assert.equal(loadConfig({ MAP: 'classic' }, []).map, 'classic');
  assert.throws(() => loadConfig({ MAP: 'mars' }, []), /MAP/);
  const env = await boot();
  try {
    const m = await env.call('/api/public/map');
    assert.equal(m.status, 200);
    assert.equal(m.json.id, 'frontier');
    assert.equal(m.json.places.length, 23);
    assert.equal(m.headers.get('access-control-allow-origin'), '*');
    const st = await env.call('/api/public/state');
    assert.equal(st.json.world.map, 'frontier');
    assert.equal(st.json.regions.length, 5);
    const lore = await env.call('/api/public/lore?lang=en');
    assert.equal(lore.json.district.harbor, 'Harbor');
    assert.equal(lore.json.richnessWild.barren, 'picked clean');
  } finally {
    await env.close();
  }
  const old = await boot({ map: 'classic' });
  try {
    assert.equal((await old.call('/api/public/map')).json.id, 'classic');
    assert.equal((await old.call('/api/public/state')).json.places.length, 12);
  } finally {
    await old.close();
  }
});

test('回放（边疆地图）：沙盘脑与真人在各地带活动若干日后，回放的状态与快照一致', async () => {
  const env = await boot({ sandboxAgents: 0 });
  try {
    const { rt } = env;
    rt.exec('admin', { op: 'seed_sandbox', args: { count: 10 } });
    await env.register('远行');
    const id = Object.values(rt.w.agents).find((a) => a.name === '远行').id;
    for (let d = 0; d < 6; d++) {
      rt.exec('act', { agentId: id, actions: [{ type: 'move', to: d % 2 ? 'wilds' : 'agora' }, { type: 'say', text: `第 ${d} 日` }] });
      for (let t = 0; t < P.ticksPerDay; t++) rt.tickNow();
    }
    const evs = rt.events.since(0, 5000).filter((e) => e.type === 'move');
    assert.ok(evs.length > 5);
    rt.snapshot();
    const r = replayDir(worldDir(env.dir, 'w'));
    assert.equal(r.ok, true, r.diff);
    assert.equal(r.world.map, 'frontier');
  } finally {
    await env.close();
  }
});

test('被放逐者在边疆地图上被移到荒野（近郊）', () => {
  const w = frontierWorld('exile-seed');
  const [a, b, c] = ['甲', '乙', '丙'].map((n) => reg(w, n));
  for (const x of [a, b, c]) {
    grant(w, x, 100);
    x.place = 'parliament';
  }
  const prop = one(w, a, { type: 'propose', title: '放逐', text: '放逐丙', effects: [{ type: 'exile', target: c.id }] });
  assert.equal(prop.ok, true);
  for (const x of [a, b]) one(w, x, { type: 'vote', proposal: prop.data.proposal, choice: 'yes' });
  const events = tickDays(w, 2);
  assert.equal(eventsOf(events, 'exile').length, 1);
  assert.equal(c.place, 'wilds');
  assert.equal(c.exiled, true);
  assert.equal(wildPool(w, 'wilds').energy <= 400, true);
});
