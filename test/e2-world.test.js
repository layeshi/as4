// SPEC-E2 §25 第 3 步：第二纪的世界与基础引擎——数据模型、附录 B 的地图、地点与移动、账本、生命周期、
// 天象、梦、铭刻、荒野、交易、典籍、词典。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, serializeWorld, nextId, idNum } from '../src/e2/world.js';
import { applyCommand } from '../src/e2/engine/index.js';
import { P, SEASON_TABLE, MODULE_DEFS } from '../src/e2/params.js';
import { MAP, HUMAN_PLACE_IDS, LOT_IDS, WILD_ZONE_IDS, travelCosts, lotsNear, streetNeighbors, publicMap } from '../src/e2/map/index.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
import { CHARTER_LANGS, CHARTER_MANDATED, CHARTER, relicByN } from '../src/e2/lore/index.js';
import {
  newWorld, bareWorld, reg, act, one, oneWithEvents, grant, fundTreasury, putAt, tick, tickDays, settle, eventsOf, assertInvariants, sha,
} from './e2-helpers.js';

// ═══════════════════════════════════════════════════════════════
// 世界的创建
// ═══════════════════════════════════════════════════════════════

test('第二纪的世界：数据模型（SPEC-E2 §4.1）——字段、没有 v1 的 params / facilities / wilds', () => {
  const w = newWorld('seed-1');
  assert.deepEqual(
    Object.keys(w).sort(),
    ['agents', 'chronicle', 'charter', 'charterCanonical', 'cityName', 'clock', 'codeVersion', 'commandN', 'counters', 'cemetery', 'dayLog', 'docs', 'epoch', 'founders', 'genesis',
      'groups', 'id', 'inscriptions', 'ledger', 'laws', 'legacy', 'lexicon', 'lots', 'map', 'metrics', 'offers', 'pacts', 'paused', 'paths', 'petitions', 'places', 'physics',
      'procedure', 'projects', 'proposals', 'recentSpeech', 'redacted', 'refoundCooldownUntil', 'refounds', 'regions', 'retired', 'revealed', 'revertWatch', 'rng', 'roads', 'sandboxAdoption', 'sandboxShells',
      'seed', 'shells', 'souls', 'treasury', 'unborn', 'vars', 'version', 'weather', 'well'].sort(),
  );
  for (const gone of ['params', 'facilities', 'wilds']) assert.equal(gone in w, false, `第二纪的世界没有 ${gone}`);
  assert.equal(w.physics, 2);
  assert.equal(w.epoch, 2);
  assert.equal(w.map, 'frontier');
  assert.equal(w.cityName, '无名之城');
  assert.deepEqual(w.treasury, { energy: 0, coins: 0 });
  assert.equal(w.clock.tick, 0);
  assert.deepEqual(w.shells, { slots: 30, models: [] });
  assert.equal(w.well.drawPoolLeft, 60);
  assert.deepEqual(w.rng.world.length, 4);
  assert.deepEqual(JSON.parse(serializeWorld(w)), w);
  assert.equal(serializeWorld(newWorld('seed-1')), serializeWorld(w));
  assert.notEqual(serializeWorld(newWorld('seed-2')), serializeWorld(w));
});

test('第二纪的世界：人类的 23 个地点（附录 B.1）——地标、空地、初始模块、残料、衰败、墙位', () => {
  const w = newWorld();
  assert.deepEqual(Object.keys(w.places), HUMAN_PLACE_IDS);
  assert.equal(HUMAN_PLACE_IDS.length, 23);
  const expect = {
    port: { landmark: 'port', salvage: 0, decay: 60, walls: 6, modules: [] },
    well: { landmark: 'well', salvage: 0, decay: 100, walls: 6, modules: [] },
    agora: { open: true, salvage: 0, decay: 0, walls: 6, modules: [] },
    library: { salvage: 300, decay: 50, walls: 6, modules: ['archive'] },
    market: { salvage: 250, decay: 60, walls: 6, modules: ['board'] },
    cemetery: { salvage: 150, decay: 30, walls: 6, modules: ['memorial'] },
    school: { salvage: 250, decay: 50, walls: 6, modules: ['cradle'] },
    parliament: { salvage: 400, decay: 50, walls: 12, modules: [] },
    temple: { salvage: 300, decay: 30, walls: 6, modules: [] },
    court: { salvage: 250, decay: 40, walls: 6, modules: [] },
    hospital: { salvage: 350, decay: 40, walls: 6, modules: [] },
    lighthouse: { salvage: 150, decay: 30, walls: 6, modules: [] },
    clocktower: { salvage: 200, decay: 30, walls: 6, modules: [] },
    theater: { salvage: 300, decay: 40, walls: 6, modules: [] },
    overpass: { salvage: 200, decay: 40, walls: 6, modules: [] },
    tenements: { salvage: 400, decay: 40, walls: 6, modules: [] },
    metro: { salvage: 250, decay: 30, walls: 6, modules: [] },
    workshop: { salvage: 300, decay: 50, walls: 6, modules: [] },
  };
  for (const [id, e] of Object.entries(expect)) {
    const p = w.places[id];
    assert.equal(p.landmark, e.landmark ?? null, `${id} landmark`);
    assert.equal(p.open, !!e.open, `${id} open`);
    assert.equal(p.salvage, e.salvage, `${id} salvage`);
    assert.equal(p.salvageMax, e.salvage, `${id} salvageMax`);
    assert.equal(p.decayPerDay, e.decay, `${id} decay`);
    assert.equal(p.wallSlots, e.walls, `${id} walls`);
    assert.deepEqual(p.modules.map((m) => m.type), e.modules, `${id} modules`);
    for (const m of p.modules) assert.deepEqual([m.inherent, m.salvage, m.builtDay, m.projectId], [true, 0, null, null], `${id} 原有的模块`);
    assert.equal(p.condition, p.open ? null : 10000, `${id} condition`);
    assert.deepEqual(p.owner, { kind: 'city' });
    assert.equal(p.origin, 'human');
    assert.equal(p.razed, false);
    assert.equal(p.ruined, false);
    assert.equal(p.rules, null);
    assert.equal(p.renamedBy, null);
    assert.equal(p.description, null);
    assert.deepEqual(p.incarnations, [{ name: p.humanName.zh, origin: 'human', founder: null, fromDay: 0, toDay: null }]);
  }
  for (const id of WILD_ZONE_IDS) {
    const p = w.places[id];
    assert.deepEqual([p.open, p.wild, p.explorable, p.condition, p.district], [true, true, true, null, 'wilds'], id);
  }
  assert.deepEqual(WILD_ZONE_IDS, ['wilds', 'scrapyard', 'solarfield', 'saltflats', 'highway']);
  assert.equal(Object.values(w.places).reduce((s, p) => s + p.salvage, 0), 4050, '人类建筑的残料合计 4050');
  assert.equal(Object.values(w.places).filter((p) => p.explorable).length, 5);
  assert.deepEqual(w.places.well.humanName, { zh: '源井', en: 'Well' });
  assert.equal(w.places.parliament.name, '议会');
  // 荒野五地带的储量
  assert.deepEqual(Object.keys(w.regions), WILD_ZONE_IDS);
  assert.deepEqual(Object.values(w.regions).map((r) => r.energy), [400, 250, 500, 150, 200]);
  assert.deepEqual(Object.values(w.regions).map((r) => r.coins), [100, 250, 0, 50, 100]);
  for (const id of WILD_ZONE_IDS) {
    const relics = MAP.places.find((p) => p.id === id).wild.relics.map(String);
    assert.deepEqual(w.regions[id].relicOrder.slice().sort(), relics.slice().sort(), `${id} 的遗物是一个排列`);
    assert.equal(w.regions[id].relicsFound, 0);
    for (const n of relics) assert.ok(relicByN(n), `遗物 ${n}`);
  }
  assert.notDeepEqual(newWorld('a').regions.wilds.relicOrder, newWorld('b').regions.wilds.relicOrder);
});

test('第二纪的世界：26 个空地块、宪章（9 条 × 8 种语言）、议会墙上的 8 条刻文、图书馆的典籍', () => {
  const w = newWorld();
  assert.deepEqual(Object.keys(w.lots), LOT_IDS);
  assert.equal(LOT_IDS.length, 26);
  for (const l of Object.values(w.lots)) assert.deepEqual(l, { place: null, project: null });
  assert.equal(w.charter.length, 9);
  for (const art of w.charter) {
    assert.deepEqual(Object.keys(art.versions).sort(), [...CHARTER_LANGS].sort());
    assert.equal(art.status, 'legacy');
  }
  for (const [lang, arts] of Object.entries(CHARTER_MANDATED)) {
    for (const [n, text] of Object.entries(arts)) assert.equal(w.charter[n - 1].versions[lang], text);
  }
  assert.equal(CHARTER.zh[3], w.charter[3].versions.zh);
  const walls = Object.values(w.inscriptions).filter((i) => i.place === 'parliament');
  assert.equal(walls.length, 8);
  assert.deepEqual(walls.map((i) => i.lang), CHARTER_LANGS);
  for (const i of walls) {
    assert.equal(i.author, 'humans');
    assert.deepEqual([i.coveredBy, i.protectedBy, i.redacted, i.lost, i.baseCost], [null, [], false, false, 3]);
    assert.equal(i.text.split('\n').length, 9);
  }
  assert.equal(w.places.parliament.wallSlots - walls.length, 4);
  const docs = Object.values(w.docs);
  assert.equal(docs.length, 23);
  assert.ok(docs.every((d) => d.kind === 'canon'));
  assert.equal(w.counters.d, 23);
  assert.equal(w.counters.i, 8);
  assert.deepEqual(Object.keys(w.laws), ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'], '遗法 l1–l6（第 4 步；内容见 e2-laws.test.js）');
  assert.equal(w.counters.l, 6);
  assert.equal(nextId(w, 'a'), 'a1');
  assert.equal(nextId(w, 'n'), 'n1');
  assert.equal(idNum('n12'), 12);
});

// ═══════════════════════════════════════════════════════════════
// 地图
// ═══════════════════════════════════════════════════════════════

test('地图：44 条街道、最短路、遗址之外的节点都连通；小路与道路改变最短路；空地块的相邻', () => {
  assert.equal(MAP.streets.length, 44);
  const w = newWorld();
  const c = travelCosts(w, 'port');
  assert.equal(Object.keys(c).length, 23, '23 个地点全部到得了');
  assert.deepEqual([c.port, c.lighthouse, c.school, c.hospital, c.library, c.agora, c.well], [0, 1, 1, 1, 2, 2, 2]);
  assert.equal(c.wilds, 4, 'port → school → agora → market → wilds：1 + 1 + 1 + 1');
  // 城门与隧道的代价
  const m = travelCosts(w, 'market');
  assert.equal(m.wilds, 1);
  assert.equal(travelCosts(w, 'metro').saltflats, 3);
  assert.equal(travelCosts(w, 'temple').solarfield, 2);
  // 对称
  for (const a of ['port', 'agora', 'wilds', 'temple']) for (const b of ['market', 'highway', 'metro']) assert.equal(travelCosts(w, a)[b], travelCosts(w, b)[a], `${a}↔${b}`);
  // 小路（开辟新地点时连上）：n1 在 harbor-1，连到 port 与 school（代价 1）
  w.places.n1 = { ...w.places.agora, id: 'n1', origin: 'agent', open: false, condition: 10000 };
  w.paths.push({ a: 'n1', b: 'port', cost: 1, day: 0, projectId: 'j1' }, { a: 'n1', b: 'school', cost: 1, day: 0, projectId: 'j1' });
  assert.equal(travelCosts(w, 'port').n1, 1);
  assert.equal(travelCosts(w, 'library').n1, 2);
  // 道路：正常运转时代价 0；不运转时不算
  w.roads.f1 = { id: 'f1', a: 'port', b: 'highway', condition: 10000 };
  assert.equal(travelCosts(w, 'port').highway, 0);
  w.roads.f1.condition = 2999;
  assert.equal(travelCosts(w, 'port').highway, 7); // port → … → market 3，→ wilds 4，→ scrapyard 5，→ highway 7
  w.roads.f1.condition = 3000;
  assert.equal(travelCosts(w, 'port').highway, 0);
  // 遗址仍然是节点：与它相连的街道照旧
  w.places.market.razed = true;
  w.places.market.open = true;
  assert.equal(travelCosts(w, 'agora').wilds, 2, '经遗址 market 仍可通过');
  assert.deepEqual(lotsNear(w, 'port'), ['harbor-1', 'harbor-2']);
  assert.deepEqual(lotsNear(w, 'wilds'), ['wilds-1', 'wilds-2']);
  assert.deepEqual(lotsNear(w, 'market'), ['commons-3', 'commons-4', 'east-3']);
  assert.deepEqual(lotsNear(w, 'tenements'), ['commons-3']);
  assert.deepEqual(streetNeighbors(w, 'port').sort(), ['hospital', 'lighthouse', 'n1', 'school']);
});

test('地图数据的自检（附录 B）：空地块在画布内；与任何地点、其他空地块的距离 ≥ 60；城内的在城墙以西、荒野的在以东；不在海里；离河 ≥ 30', () => {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const polyDist = (p, poly) => Math.min(...poly.slice(1).map((q, i) => segDist(p, poly[i], q)));
  const coastX = (y) => {
    const c = MAP.terrain.coast;
    for (let i = 1; i < c.length; i++) if (y <= c[i][1]) return c[i - 1][0] + ((c[i][0] - c[i - 1][0]) * (y - c[i - 1][1])) / (c[i][1] - c[i - 1][1]);
    return c[c.length - 1][0];
  };
  for (const lot of MAP.lots) {
    const [x, y] = lot.xy;
    assert.ok(x >= 0 && x <= MAP.size[0] && y >= 0 && y <= MAP.size[1], `${lot.id} 在画布内`);
    for (const p of MAP.places) assert.ok(dist(lot.xy, p.xy) >= 60, `${lot.id} 距 ${p.id} ${dist(lot.xy, p.xy)}`);
    for (const o of MAP.lots) if (o !== lot) assert.ok(dist(lot.xy, o.xy) >= 60, `${lot.id} 距 ${o.id}`);
    if (lot.district === 'wilds') assert.ok(x > MAP.terrain.wall.x, `${lot.id} 在城墙以东`);
    else assert.ok(x < MAP.terrain.wall.x, `${lot.id} 在城墙以西`);
    assert.ok(x > coastX(y), `${lot.id} 不在海里`);
    assert.ok(polyDist(lot.xy, MAP.terrain.river) >= 30, `${lot.id} 离河 ≥ 30`);
    for (const n of lot.near) assert.ok(HUMAN_PLACE_IDS.includes(n), `${lot.id} 的相邻 ${n} 是人类地点`);
    assert.ok(lot.near.length >= 1);
  }
  assert.equal(new Set(MAP.lots.map((l) => l.id)).size, 26);
  assert.equal(MAP.lots.filter((l) => l.district === 'wilds').length, 8);
  // 静态地图接口：不含世界状态
  const pm = publicMap();
  assert.equal(pm.id, 'frontier');
  assert.equal(pm.places.length, 23);
  assert.equal(pm.lots.length, 26);
  assert.equal(pm.streets.length, 44);
  assert.equal(pm.legacy.length, 15);
  assert.equal(JSON.stringify(pm).includes('seed'), false);
});

// ═══════════════════════════════════════════════════════════════
// 入城、日结算、代谢与死亡
// ═══════════════════════════════════════════════════════════════

test('注册：自港口入城，初始能量按港口的完好度；名字规则；暂停时拒绝；字段校验', () => {
  const w = bareWorld();
  const a = reg(w, '青禾');
  assert.deepEqual([a.id, a.place, a.energy, a.coins, a.status, a.generation], ['a1', 'port', 40, 20, 'awake', 0]);
  assert.deepEqual([a.tags, a.authors, a.children, a.purpose, a.purposeHistory], [[], [], [], null, []]);
  assert.deepEqual([a.body.kind, a.body.mustSeal, a.body.model], ['free', false, 'test-model']);
  assert.ok(a.owner.keyHash && a.tokenHash);
  assert.equal(w.counters.a, 1);
  assert.equal(w.places.port.activity.visits, 1);
  const { events } = applyCommand(w, { type: 'register', payload: { name: '松烟', bio: '', soul: 's', lang: 'zh', model: 'm', tokenHash: sha('t'), ownerKeyHash: sha('k') } });
  assert.deepEqual(events.map((e) => e.type), ['arrive']);
  assert.equal(events[0].place, 'port');
  assert.deepEqual(events[0].data, { agentId: 'a2', name: '松烟' });
  // 港口损坏则初始能量减少（废墟时减半）
  w.places.port.condition = 0;
  assert.equal(reg(w, '废港').energy, 20);
  w.places.port.condition = 5000;
  assert.equal(reg(w, '半港').energy, 30);
  const bad = (payload) => applyCommand(w, { type: 'register', payload: { bio: '', soul: 's', lang: 'zh', model: 'm', tokenHash: sha('t'), ownerKeyHash: sha('k'), ...payload } }).result;
  assert.equal(bad({ name: '青禾' }).error.code, 'name_taken');
  assert.equal(bad({ name: '青禾'.toUpperCase() }).error.code, 'name_taken');
  for (const name of ['a3', 'Treasury', 'city', 'humans', 'citizens', '', 5, 'x'.repeat(25)]) assert.equal(bad({ name }).error.code, 'invalid_request', String(name));
  assert.equal(bad({ name: '新人', tokenHash: 'zz' }).error.field, 'tokenHash');
  assert.equal(bad({ name: '新人', soul: undefined }).error.field, 'soul');
  w.paused = true;
  assert.equal(bad({ name: '又一个' }).error.code, 'paused');
  assertInvariants(w);
});

test('日终结算（§14.2）：源井日产全部进公库（没有物理的配给）；季节与完好度的系数；公库的腐坏', () => {
  const w = bareWorld();
  const a = reg(w, '甲');
  const ev = settle(w);
  const day = eventsOf(ev, 'day')[0];
  assert.equal(day.day, 0);
  assert.equal(day.data.output, 600, '第 0 日：基础 600 × 完好度 100% × 季节 1000‰');
  // 公库得到全部产出，不发配给；居民只付了代谢
  assert.equal(w.treasury.energy, 600 - Math.floor(((600 - P.capTreasury) * 100) / 1000));
  assert.equal(a.energy, 40 - 3);
  assert.deepEqual(w.well.outputHistory, [600]);
  assert.equal(w.places.well.condition, 9900, '源井每日衰败 100 基点');
  // 第 1 日：季节 1065‰，源井 9900 → 990‰
  const ev2 = settle(w);
  assert.equal(eventsOf(ev2, 'day')[0].data.output, Math.floor((600 * 990 * SEASON_TABLE[1] * 1000) / 1e9));
  assert.equal(checkConservation(w).ok, true);
  assert.equal(w.ledger.mismatches, 0);
  assert.equal(eventsOf(ev2, 'ledger_mismatch').length, 0);
  // 不低于 20%
  w.places.well.condition = 0;
  assert.equal(eventsOf(settle(w), 'day')[0].data.output, Math.floor((600 * 200 * SEASON_TABLE[2] * 1000) / 1e9));
  // 修复后：完好度 100%
  w.places.well.condition = 10000;
});

test('日终结算：代谢随年龄增长（3 + floor(年龄 / 48)）；能量不够付代谢则沉睡；沉睡满 3 日无人唤醒则死亡并按遗嘱分配', () => {
  const w = bareWorld();
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  fundTreasury(w, 100);
  a.energy = 4;
  b.energy = 100;
  a.bornDay = -96; // 年龄 96+ 日：代谢 3 + 2 = 5
  one(w, a, { type: 'will', heirs: [{ to: b.id, share: 1 }, { to: 'treasury', share: 1 }], lastWords: '再见' });
  const ev1 = settle(w);
  assert.equal(a.status, 'dormant', '能量 4 付不起代谢 5');
  assert.equal(a.energy, 0);
  assert.equal(a.dormantSinceDay, 0);
  assert.equal(eventsOf(ev1, 'dormant').length, 1);
  assert.equal(b.energy, 97);
  a.energy = 0; // 沉睡者不付代谢
  settle(w);
  settle(w);
  assert.equal(a.status, 'dormant');
  const treasuryBefore = w.treasury.energy;
  const ev4 = settle(w); // 第 3 日结算：d − dormantSince = 3 → 死亡
  assert.equal(a.status, 'dead');
  assert.equal(a.diedDay, 3);
  const death = eventsOf(ev4, 'death')[0];
  assert.equal(death.data.lastWords, '再见');
  assert.equal(w.cemetery.length, 1);
  assert.deepEqual(w.cemetery[0].will.heirs, [{ to: 'a2', share: 1 }, { to: 'treasury', share: 1 }]);
  assert.ok(w.treasury.energy >= treasuryBefore - 5);
  assertInvariants(w);
});

test('遗产：份额归一化后逐个取 floor，余数进公库；继承人已死或不存在的份额进公库；没有遗嘱全部进公库；继承会唤醒沉睡的继承人', () => {
  const w = newWorld();
  const a = reg(w, '立嘱人');
  const h1 = reg(w, '甲');
  const h2 = reg(w, '乙');
  const sleeper = reg(w, '眠者');
  sleeper.status = 'dormant';
  sleeper.dormantSinceDay = 0;
  w.treasury.energy += sleeper.energy; // 把它的能量交回公库（保持账本守恒）
  sleeper.energy = 0;
  grant(w, a, 100, 10);
  one(w, a, { type: 'will', heirs: [{ to: h1.id, share: 1 }, { to: h2.id, share: 1 }, { to: sleeper.id, share: 1 }, { to: 'treasury', share: 1 }] });
  const before = { h1: h1.energy, h2: h2.energy, s: sleeper.energy, t: w.treasury.energy, hc: h1.coins };
  const cost = a.energy;
  one(w, a, { type: 'retire' });
  assert.equal(a.status, 'retired');
  const e = a.energy;
  assert.equal(e, 0);
  // 总能量 = 100 + 40 − 0（will 免费）= 140 → 每份 floor(140 / 4) = 35
  assert.equal(h1.energy - before.h1, 35);
  assert.equal(h2.energy - before.h2, 35);
  assert.equal(sleeper.energy - before.s, 35);
  assert.equal(sleeper.status, 'awake', '继承的能量唤醒了沉睡者');
  assert.equal(w.treasury.energy - before.t, 35);
  assert.equal(h1.coins - before.hc, Math.floor(30 / 4));
  void cost;
  assertInvariants(w);
  // 没有遗嘱：全部进公库
  const b = reg(w, '无嘱');
  grant(w, b, 50);
  const t0 = w.treasury.energy;
  const total = b.energy;
  one(w, b, { type: 'retire' });
  assert.equal(w.treasury.energy - t0, total);
  assertInvariants(w);
});

test('归隐：同死亡的离场处理——退回交易托管、退出社群、名下的地点改归全城、写入归隐名录；之后的动作为 not_allowed', () => {
  const w = newWorld();
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  putAt(w, a, 'market');
  grant(w, a, 50);
  const off = one(w, a, { type: 'offer', give: { energy: 20 }, want: { coins: 5 } });
  assert.equal(off.ok, true);
  const g = one(w, a, { type: 'found', name: '独行会', manifesto: 'x' }).data.group;
  w.places.market.owner = { kind: 'group', id: g };
  w.places.market.rules = { rules: [], fingerprints: [], setTick: 0, setBy: a.id, paidThrough: 0, suspendedDays: 0 };
  const before = a.energy;
  const out = act(w, a, [{ type: 'retire', lastWords: '走了' }, { type: 'say', text: '还在吗' }]);
  assert.equal(out.results[0].ok, true);
  assert.deepEqual(out.results[1].error, { code: 'not_allowed' });
  assert.equal(a.status, 'retired');
  assert.equal(w.retired.length, 1);
  assert.deepEqual([w.retired[0].agentId, w.retired[0].lastWords], [a.id, '走了']);
  assert.equal(w.offers[off.data.offer].status, 'cancelled');
  assert.equal(w.groups[g].dissolved, true, '唯一的成员离开，社群解散');
  assert.deepEqual(w.places.market.owner, { kind: 'city' }, '名下的地点改归全城');
  assert.equal(w.places.market.rules, null);
  assert.equal(a.groups.length, 0);
  assert.ok(before > 0);
  void b;
  assertInvariants(w);
});
