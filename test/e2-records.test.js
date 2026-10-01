// SPEC-E2 §20（§25 第 9 步）：每日指标、人类遗产存活表、史官。
import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyMetrics, computeLegacy, countRuleNodes } from '../src/e2/engine/records.js';
import { writeChronicle, pickQuote, remarkOf } from '../src/e2/chronicle.js';
import { createLaw, installProcedure } from '../src/e2/engine/laws.js';
import { HUMAN_PROCEDURE } from '../src/e2/lore/humanlaws.js';
import { newDayLog } from '../src/e2/world.js';
import { P } from '../src/e2/params.js';
import { newWorld, bareWorld, reg, one, setHoldings, setTreasury, putAt, tick, tickDays, settle } from './e2-helpers.js';
import { enact, setBylaws, setPlaceRules } from './e2-law-helpers.js';

const town = (n = 3, seed = 'rec') => {
  const w = newWorld(seed);
  const people = [];
  for (let i = 0; i < n; i++) {
    const a = reg(w, `居民${i + 1}`);
    setHoldings(w, a, { energy: 100 });
    people.push(a);
  }
  return { w, people };
};

// ═══════════════════════════════════════════════════════════════
// 每日指标
// ═══════════════════════════════════════════════════════════════

const V1_KEYS = [
  'day', 'awake', 'dormant', 'dead', 'retired', 'exiled', 'nonCitizens', 'cradle', 'unborn', 'arrivals', 'births', 'deaths', 'fades', 'output', 'rationPerCapita',
  'treasuryEnergy', 'treasuryCoins', 'agentEnergyTotal', 'gini', 'coinVolume', 'coinPrice', 'wellCondition', 'meanCondition', 'ruins', 'infrastructureIndex',
  'publicInvestment', 'publicInvestmentRate', 'freeRiderShare', 'drawn', 'projectsBuilt', 'projectsAbandoned', 'wildsEnergy', 'proposals', 'passed', 'rejected',
  'lawsActive', 'groups', 'largestGroupShare', 'lexicon', 'adoptedWords', 'docsAgent', 'reads', 'canonReads', 'utterances', 'scripts', 'scriptEntropy',
  'humanAuthoredShare', 'inscriptions', 'covered', 'epitaphs', 'reveals',
];
const V2_KEYS = [
  'votersOrdinary', 'modules', 'rulesActive', 'ruleNodes', 'upkeepPaid', 'lawsSuspended', 'ruleErrors', 'ruleOps', 'bylawsActive', 'placeRulesActive',
  'procedureChanges', 'refounds', 'reverts', 'fingerprintsShared', 'agentPlaces', 'agentModules', 'agentBuiltShare', 'salvaged', 'salvageLeft', 'razed',
  'birthsSolo', 'birthsPair', 'birthsGroup', 'inheritedMemories', 'shellsUsed', 'shellQueue', 'embodiments', 'adoptions', 'purposeShare', 'purposeChanges', 'tagsDistinct',
];

test('每日指标：v1 的字段保留（electorateSize 改为 votersOrdinary，facilities 改为 modules），新增 §20.1 的全部字段；每日结算追加一条，w.metrics 长度 = 已过的日数', () => {
  const { w } = town(3);
  settle(w);
  assert.equal(w.metrics.length, 1);
  const m = w.metrics[0];
  const keys = Object.keys(m);
  for (const k of [...V1_KEYS, ...V2_KEYS]) assert.ok(keys.includes(k), `缺字段 ${k}`);
  assert.equal(keys.length, new Set([...V1_KEYS, ...V2_KEYS]).size, `多余的字段：${keys.filter((k) => ![...V1_KEYS, ...V2_KEYS].includes(k))}`);
  for (const gone of ['electorateSize', 'facilities']) assert.equal(gone in m, false, gone);
  assert.deepEqual(JSON.parse(JSON.stringify(m)), m, 'JSON 干净');
  tickDays(w, 2);
  assert.deepEqual(w.metrics.map((x) => x.day), [0, 1, 2]);
  assert.equal(w.legacy.day, 2);
  assert.equal(w.chronicle.length, 3);
});

test('每日指标：人口、放逐与非公民（标签）、votersOrdinary（普通程序 voters 求值的人数）、modules、infrastructureIndex（Σ 运转中的模块 × 所在地点完好度 / 10000，保留 2 位）', () => {
  const { w, people } = town(4);
  const [a, b, c] = people;
  tickDays(w, 1);
  let m = dailyMetrics(w, 1);
  assert.deepEqual([m.awake, m.dormant, m.dead, m.retired], [4, 0, 0, 0]);
  assert.deepEqual([m.exiled, m.nonCitizens], [0, 0]);
  assert.equal(m.votersOrdinary, 4, '遗法 l1：公民且未被放逐的在世居民');
  a.tags = a.tags.filter((t) => t !== 'citizen');
  b.tags.push('exiled');
  m = dailyMetrics(w, 1);
  assert.deepEqual([m.exiled, m.nonCitizens, m.votersOrdinary], [1, 1, 2]);
  c.status = 'dormant';
  c.energy = 0;
  assert.equal(dailyMetrics(w, 1).dormant, 1);
  // 模块与基础设施指数：学堂摇篮、图书馆档案、市场告示板、墓园纪念，各按所在地点的完好度
  assert.equal(m.modules, 4);
  const expected = ['school', 'library', 'market', 'cemetery'].reduce((s, id) => s + w.places[id].condition / 10000, 0);
  assert.equal(m.infrastructureIndex, Math.round(expected * 100) / 100);
  // 失修到不运转（完好度 < 20%）的建筑，其模块不算
  w.places.school.condition = 1500;
  const m2 = dailyMetrics(w, 1);
  assert.equal(m2.modules, 4, '模块还在');
  assert.ok(m2.infrastructureIndex < m.infrastructureIndex - 0.5, `${m.infrastructureIndex} → ${m2.infrastructureIndex}`);
});

test('每日指标：规则的数量与规模——rulesActive / ruleNodes 只数带持续时机的规则（enact 不算）；城法、章程、地点规则合计；程序法律与已撤销的不算', () => {
  const w = bareWorld('rules-metric');
  const a = reg(w, '甲');
  tickDays(w, 1);
  const base = dailyMetrics(w, 1);
  assert.deepEqual([base.rulesActive, base.ruleNodes, base.bylawsActive, base.placeRulesActive], [0, 0, 0, 0]);
  enact(w, [
    { when: 'enact', do: [{ op: 'set', var: 'x', value: '1 + 2' }] }, // enact：不算
    { when: 'daily', if: 'true', do: [{ op: 'set', var: 'y', value: '1 + 2' }] }, // 1 + 3 = 4 个节点
    { when: 'monthly', do: [{ op: 'set', var: 'z', value: '7' }, { op: 'set', var: 'u', value: '8' }] }, // 2 个节点
  ]);
  const m = dailyMetrics(w, 1);
  assert.deepEqual([m.rulesActive, m.ruleNodes], [2, 6]);
  assert.equal(countRuleNodes({ when: 'daily', do: [{ op: 'set', var: 'y', value: 'city.treasury * 2' }] }), 4, 'city.treasury 是两个节点（字段与名字），× 2 再加两个');
  // 章程与地点规则
  setHoldings(w, a, { energy: 100 });
  putAt(w, a, 'agora');
  one(w, a, { type: 'found', name: '社', manifesto: 'x', open: true });
  setBylaws(w, 'g1', [{ when: 'daily', do: [{ op: 'set', var: 'q', value: '5' }] }]);
  w.places.lighthouse.owner = { kind: 'agent', id: a.id };
  setPlaceRules(w, 'lighthouse', [{ when: 'before:say', do: [{ op: 'fee', to: 'treasury', energy: '2' }] }]);
  const m2 = dailyMetrics(w, 1);
  assert.deepEqual([m2.rulesActive, m2.bylawsActive, m2.placeRulesActive], [4, 1, 1]);
  assert.equal(m2.ruleNodes, 6 + 1 + 2, '章程 1 个节点（5）；地点规则的 to（treasury）与 energy（2）各 1 个');
  // 撤销一部
  const first = Object.values(w.laws).find((l) => l.rules && l.rules.length === 3);
  first.status = 'repealed';
  assert.equal(dailyMetrics(w, 1).rulesActive, 2);
});

test('每日指标：upkeepPaid / lawsSuspended / ruleErrors / ruleOps 是当日的；维持费随日结算；公库见底时停摆数增加', () => {
  const { w } = town(2, 'upkeep-metric');
  settle(w);
  const m0 = w.metrics[0];
  assert.ok(m0.upkeepPaid >= 6, `遗法每日付维持费：${m0.upkeepPaid}`);
  assert.equal(m0.lawsSuspended, 0);
  assert.ok(m0.ruleOps >= 1, '配给等规则在执行');
  // 公库见底：维持费付不起，遗法停摆
  setTreasury(w, { energy: 0 });
  w.dayLog.output = 0;
  for (const l of Object.values(w.laws)) l.paidThrough = -1;
  w.dayLog.suspended.push({ scope: 'city', owner: 'l3', title: '基本配给' });
  const m = dailyMetrics(w, 3);
  assert.equal(m.lawsSuspended, 1);
  w.dayLog.ruleErrors = 3;
  w.dayLog.ruleOps = 9;
  w.dayLog.upkeepPaid = 4;
  const m2 = dailyMetrics(w, 3);
  assert.deepEqual([m2.ruleErrors, m2.ruleOps, m2.upkeepPaid], [3, 9, 4]);
});

test('每日指标：procedureChanges / refounds / reverts 是累计的（从法律与重订表推出）；fingerprintsShared 数出现在两个以上作用域的指纹', () => {
  const { w, people } = town(3, 'cum');
  const [a] = people;
  let m = dailyMetrics(w, 0);
  assert.deepEqual([m.procedureChanges, m.refounds, m.reverts], [0, 0, 0]);
  const law1 = createLaw(w, { title: '新程序', text: 'x', author: a.id, procedure: { ordinary: { ...HUMAN_PROCEDURE.ordinary, period: 6 } } });
  installProcedure(w, law1, 'enacted');
  const law2 = createLaw(w, { title: '回退', text: 'x', author: 'revert', procedure: { ordinary: HUMAN_PROCEDURE.ordinary } });
  installProcedure(w, law2, 'reverted');
  const law3 = createLaw(w, { title: '重订', text: 'x', author: 'refound:r1', procedure: { constitutional: HUMAN_PROCEDURE.constitutional } });
  installProcedure(w, law3, 'refounded');
  w.refounds.r1 = { id: 'r1', by: a.id, text: 'x', procedure: 'humans', openedTick: 0, expiresTick: 9, signers: [a.id], status: 'succeeded' };
  w.refounds.r2 = { id: 'r2', by: a.id, text: 'y', procedure: 'humans', openedTick: 0, expiresTick: 9, signers: [a.id], status: 'expired' };
  m = dailyMetrics(w, 0);
  assert.deepEqual([m.procedureChanges, m.refounds, m.reverts], [3, 1, 1]);
  // 指纹：同样的规则在两部法律里 → 1；同一部法律里重复的规则不算
  const rule = [{ when: 'daily', do: [{ op: 'set', var: 'x', value: '1' }] }];
  const l1 = enact(w, rule, { title: 'A' });
  const l2 = enact(w, rule, { title: 'B' });
  l1.fingerprints = ['f1', 'f1', 'f2'];
  l2.fingerprints = ['f1', 'f3'];
  const base = dailyMetrics(w, 0).fingerprintsShared;
  assert.equal(base, 1);
  l2.fingerprints = ['f3'];
  assert.equal(dailyMetrics(w, 0).fingerprintsShared, 0);
  // 章程里也出现 f1 → 算两个作用域
  setHoldings(w, a, { energy: 100 });
  putAt(w, a, 'agora');
  one(w, a, { type: 'found', name: '社', manifesto: 'x', open: true });
  setBylaws(w, 'g1', rule);
  w.groups.g1.bylaws.fingerprints = ['f1'];
  assert.equal(dailyMetrics(w, 0).fingerprintsShared, 1);
});

test('每日指标：后人开辟的地点、加装的模块、agentBuiltShare、残料、遗址', () => {
  const { w, people } = town(2, 'agent-built');
  const [a] = people;
  let m = dailyMetrics(w, 0);
  assert.deepEqual([m.agentPlaces, m.agentModules, m.agentBuiltShare, m.razed], [0, 0, 0, 0]);
  const buildings = Object.values(w.places).filter((p) => p.condition !== null).length;
  assert.equal(m.salvageLeft, Object.values(w.places).reduce((s, p) => s + p.salvage, 0));
  // 后人开辟一处地点，并在人类的图书馆加装一个模块
  w.places.n1 = { ...structuredClone(w.places.temple), id: 'n1', name: '灯屋', humanName: null, description: 'x', origin: 'agent', owner: { kind: 'agent', id: a.id }, founder: a.id, modules: [] };
  w.places.library.modules.push({ type: 'store', salvage: 40, builtDay: 1, projectId: 'j1', inherent: false });
  m = dailyMetrics(w, 0);
  assert.deepEqual([m.agentPlaces, m.agentModules], [1, 1]);
  assert.equal(m.agentBuiltShare, Math.round(((1 + 1) / (buildings + 1 + m.modules)) * 1000) / 1000);
  // 遗址：不再算开辟的地点；razed 是累计的遗址数
  w.places.n1.razed = true;
  w.places.n1.condition = 0;
  w.places.n1.salvage = 0;
  w.places.court.razed = true;
  w.places.court.condition = 0;
  w.places.court.salvage = 0;
  w.dayLog.salvaged = 77;
  w.counters.razed = 2; // 累计遗址数由拆解时记下（见 e2-city 的遗址测试）；在遗址上重新开辟后当前的遗址数会减少，累计数不减
  m = dailyMetrics(w, 0);
  assert.deepEqual([m.agentPlaces, m.razed, m.salvaged], [0, 2, 77]);
  w.places.court.razed = false;
  assert.equal(dailyMetrics(w, 0).razed, 2, '重新开辟不减少累计数');
});

test('每日指标：出生（作者 1 / 2 / ≥3）、遗传的记忆条数、躯壳与领养、立志；purposeShare 是在世者中有志的比例；tagsDistinct 数不同的标签', () => {
  const { w, people } = town(4, 'births-metric');
  const [a, b, c, d] = people;
  w.dayLog.births.push(
    { id: 'a90', name: '甲', authors: [a.id], place: 'school', via: 'adopt', memories: 2 },
    { id: 'a91', name: '乙', authors: [a.id, b.id], place: 'school', via: 'adopt', memories: 1 },
    { id: 'a92', name: '丙', authors: [a.id, b.id, c.id], place: 'school', via: 'shell', memories: 0 },
    { id: 'a93', name: '丁', authors: [a.id, b.id, c.id, d.id], place: 'school', via: 'adopt', memories: 3 },
  );
  w.dayLog.adoptions.push({ soulId: 's1', agentId: 'a90' }, { soulId: 's2', agentId: 'a91' });
  w.dayLog.embodiments.push({ soulId: 's3', agentId: 'a92', name: '丙' });
  w.dayLog.purposeChanges = 5;
  a.purpose = '守井';
  b.purpose = '修路';
  a.tags.push('守井人', 'x');
  b.tags.push('守井人');
  const m = dailyMetrics(w, 0);
  assert.deepEqual([m.births, m.birthsSolo, m.birthsPair, m.birthsGroup, m.inheritedMemories], [4, 1, 1, 2, 6]);
  assert.deepEqual([m.adoptions, m.embodiments, m.purposeChanges, m.purposeShare], [2, 1, 5, 0.5]);
  assert.equal(m.tagsDistinct, 3, 'citizen、守井人、x');
  // 躯壳的用量与排队
  assert.equal(m.shellsUsed, 0);
  assert.equal(m.shellQueue, 0);
  a.body.kind = 'shell';
  const s = { id: 's9', name: '候补', soul: 'x', lang: 'zh', authors: [a.id], generation: 1, endowment: 40, inheritedMemories: [], cradle: null, createdDay: 0, expiresDay: 24, fund: 200, sponsors: {}, fundedTick: 5, queueExpiresDay: 30, successorOf: null, judged: false };
  w.souls.s9 = s;
  const m2 = dailyMetrics(w, 0);
  assert.deepEqual([m2.shellsUsed, m2.shellQueue, m2.cradle], [1, 1, 1]);
});

test('每日指标：经济与账——output、rationPerCapita、公库、币价与币量、公共投资与搭便车比例沿用第一纪的口径', () => {
  const { w, people } = town(4, 'econ');
  tickDays(w, 6);
  assert.equal(w.metrics.length, 6);
  for (let i = 0; i < 6; i++) assert.equal(w.metrics[i].output, w.well.outputHistory[i], `第 ${i} 日的产出`);
  assert.ok(w.metrics[3].rationPerCapita > 0, '遗法 l3 的配给');
  assert.equal(w.metrics[5].treasuryEnergy, w.treasury.energy);
  w.dayLog.coinTrade = { energy: 30, coins: 10 };
  w.dayLog.coinVolume = 12;
  w.dayLog.repairSpent = 30;
  w.dayLog.contributeSpent = 10;
  w.dayLog.actionCost = 60;
  const x = dailyMetrics(w, 6);
  assert.deepEqual([x.coinPrice, x.coinVolume, x.publicInvestment, x.publicInvestmentRate], [3, 12, 40, 0.4]);
  assert.equal(typeof x.gini, 'number');
  assert.equal(x.freeRiderShare, 1, '没有人修过、出过工');
  people[0].stats.repaired = 5;
  assert.equal(dailyMetrics(w, 6).freeRiderShare, 0.75);
  assert.equal(dailyMetrics(w, 6).agentEnergyTotal, people.reduce((s, a) => s + a.energy, 0));
});

// ═══════════════════════════════════════════════════════════════
// 人类遗产存活表
// ═══════════════════════════════════════════════════════════════

const legacy = (w, d = 0) => Object.fromEntries(computeLegacy(w, d).items.map((i) => [i.key, i]));

test('遗产表：新世界——宪章与遗法都存续，人类的建筑空置，城没有名字，旧币还没有足够的日子判断；结构含 key / status / value / name / statusText / evidence / text（中英文）', () => {
  const { w } = town(3, 'leg0');
  const t = computeLegacy(w, 0);
  assert.equal(t.day, 0);
  const keys = t.items.map((i) => i.key);
  assert.deepEqual(keys.slice(0, 9), ['charter.1', 'charter.2', 'charter.3', 'charter.4', 'charter.5', 'charter.6', 'charter.7', 'charter.8', 'charter.9']);
  for (const k of ['charterWall', 'law.l2', 'law.l3', 'law.l4', 'law.l5', 'law.l6', 'procedure.ordinary', 'procedure.constitutional', 'secretBallot', 'ration', 'coin', 'cityName', 'placeNames', 'canon', 'humanNames', 'well']) {
    assert.ok(keys.includes(k), k);
  }
  for (const id of ['lighthouse', 'school', 'library', 'clocktower', 'parliament', 'court', 'market', 'theater', 'overpass', 'tenements', 'hospital', 'cemetery', 'metro', 'temple', 'workshop']) assert.ok(keys.includes(id), id);
  assert.equal(new Set(keys).size, keys.length);
  for (const i of t.items) {
    assert.deepEqual(Object.keys(i), ['key', 'status', 'value', 'name', 'statusText', 'evidence', 'text']);
    assert.ok(i.name.zh.length > 0 && i.name.en.length > 0 && i.text.zh.length > 0 && i.text.en.length > 0 && i.statusText.zh.length > 0, i.key);
    assert.equal(/[一-鿿]/.test(i.name.en + i.text.en + i.statusText.en), false, `${i.key}: ${i.name.en} ${i.text.en} ${i.statusText.en}`);
    assert.ok(!/\{\w+\}/.test(i.name.zh + i.text.zh + i.name.en + i.text.en), `${i.key} 有没替换的占位符`);
  }
  const L = legacy(w);
  for (const k of keys.filter((x) => x.startsWith('charter.') || /^law\./.test(x))) assert.equal(L[k].status, 'legacy', k);
  assert.deepEqual([L.charterWall.status, L.charterWall.value], ['legacy', 8]);
  assert.deepEqual([L['procedure.ordinary'].status, L['procedure.constitutional'].status, L.secretBallot.status], ['legacy', 'legacy', 'legacy']);
  assert.deepEqual([L.ration.status, L.ration.value, L.ration.evidence.params], ['legacy', 600, { value: 60 }]);
  assert.equal(L.coin.status, 'legacy');
  assert.deepEqual([L.cityName.status, L.cityName.text.zh, L.cityName.text.en], ['unnamed', '仍叫「无名之城」。', 'Still called "The Nameless City".']);
  assert.deepEqual([L.placeNames.status, L.placeNames.value], ['legacy', 0]);
  assert.equal(L.humanNames.status, 'legacy', '三位居民都是世代 0');
  assert.equal(L.canon.status, 'untouched');
  assert.equal(L.well.status, 'pristine');
  assert.equal(L.library.status, 'untouched');
});

test('遗产表：宪章第 n 条的状态来自 charter[n].status 与最近一次修订它的法律；议会墙上刻文被覆盖则为改造，全被覆盖（或议会成了遗址）则为废弃', () => {
  const { w } = town(2, 'leg1');
  w.charter[2].status = 'amended';
  w.charter[2].history.push({ lawId: 'l9' });
  w.charter[4].status = 'repealed';
  w.charter[4].history.push({ lawId: 'l10' });
  let L = legacy(w);
  assert.deepEqual([L['charter.3'].status, L['charter.3'].evidence.params], ['amended', { law: 'l9' }]);
  assert.equal(L['charter.3'].text.zh, '已被法律 l9 修订。');
  assert.equal(L['charter.3'].text.en, 'Amended by law l9.');
  assert.equal(L['charter.5'].status, 'repealed');
  const walls = Object.values(w.inscriptions).filter((i) => i.author === 'humans' && i.place === 'parliament');
  assert.equal(walls.length, 8);
  walls[0].coveredBy = 'i99';
  walls[1].redacted = true;
  L = legacy(w);
  assert.deepEqual([L.charterWall.status, L.charterWall.value], ['transformed', 6]);
  for (const i of walls) i.lost = true;
  L = legacy(w);
  assert.deepEqual([L.charterWall.status, L.charterWall.value], ['abandoned', 0], '议会成为遗址时刻文丢失');
});

test('遗产表：遗法 l2–l6——被撤销且有 basedOn 指向它的在效法律为改造，无替代为废弃；l1 两类分列；秘密投票；基本配给', () => {
  const { w, people } = town(2, 'leg2');
  const [a] = people;
  w.laws.l2.status = 'repealed';
  const heir = enact(w, [{ when: 'daily', do: [{ op: 'set', var: 'x', value: '1' }] }], { title: '议会新规', author: a.id });
  heir.basedOn = 'l2';
  w.laws.l4.status = 'repealed';
  let L = legacy(w);
  assert.deepEqual([L['law.l2'].status, L['law.l2'].evidence.params], ['transformed', { law: heir.id }]);
  assert.equal(L['law.l2'].text.zh, `已被撤销，改写成了法律 ${heir.id}。`);
  assert.equal(L['law.l4'].status, 'abandoned');
  assert.equal(L['law.l3'].status, 'legacy');
  assert.equal(L['law.l2'].name.zh, '遗法 l2「议会」', L['law.l2'].name.zh);
  assert.equal(L['law.l2'].name.en, 'Human law l2, "The Parliament"');
  // 程序：只换了普通类
  const law = createLaw(w, { title: '新程序', text: 'x', author: a.id, procedure: { ordinary: { ...HUMAN_PROCEDURE.ordinary, period: 6 } } });
  installProcedure(w, law, 'enacted');
  L = legacy(w);
  assert.deepEqual([L['procedure.ordinary'].status, L['procedure.ordinary'].evidence.params, L['procedure.constitutional'].status], ['transformed', { law: law.id }, 'legacy']);
  // 不再立法
  const none = createLaw(w, { title: '不再立法', text: 'x', author: a.id, procedure: { constitutional: { none: true } } });
  installProcedure(w, none, 'enacted');
  assert.equal(legacy(w)['procedure.constitutional'].status, 'abandoned');
  // 秘密投票：任一类改成记名即为改造
  assert.equal(legacy(w).secretBallot.status, 'legacy');
  const open = createLaw(w, { title: '记名', text: 'x', author: a.id, procedure: { ordinary: { ...HUMAN_PROCEDURE.ordinary, secret: false } } });
  installProcedure(w, open, 'enacted');
  assert.equal(legacy(w).secretBallot.status, 'transformed');
  // 配给
  assert.equal(legacy(w).ration.status, 'legacy');
  w.vars.rationShare = 500;
  L = legacy(w);
  assert.deepEqual([L.ration.status, L.ration.value, L.ration.evidence.params], ['transformed', 500, { value: 50 }]);
  w.laws.l3.status = 'repealed';
  assert.deepEqual([legacy(w).ration.status, legacy(w).ration.value], ['abandoned', 0]);
});

test('遗产表：旧币——连续 5 日没有旧币流动为废弃；被增发过为改造；最近 3 日有流动为流通；否则存续；城名、地名', () => {
  const { w } = town(2, 'leg3');
  const metric = (coinVolume) => ({ coinVolume, canonReads: 0, wellCondition: 9000 });
  assert.equal(legacy(w, 4).coin.status, 'legacy', '不足 5 日不判废弃');
  w.metrics = [metric(0), metric(0), metric(0), metric(0), metric(0)];
  assert.equal(legacy(w, 5).coin.status, 'abandoned');
  w.metrics = [metric(0), metric(0), metric(5), metric(0), metric(0)];
  assert.equal(legacy(w, 5).coin.status, 'circulating');
  w.counters.mints = 1;
  assert.equal(legacy(w, 5).coin.status, 'transformed');
  w.metrics = [metric(0), metric(0), metric(0), metric(0), metric(0)];
  assert.equal(legacy(w, 5).coin.status, 'abandoned', '废弃的判断在先');
  // 城名、地名
  w.cityName = '白花城';
  let L = legacy(w);
  assert.deepEqual([L.cityName.status, L.cityName.text.zh], ['named', '已命名为「白花城」。']);
  w.places.market.renamedBy = 'l9';
  w.places.well.renamedBy = 'l9';
  L = legacy(w);
  assert.deepEqual([L.placeNames.status, L.placeNames.value, L.placeNames.text.zh], ['transformed', 2, '2 处地点被改了名。']);
});

test('遗产表：人类的建筑——遗址 > 残料被拆 > 模块与初始不同 > 被改名 > 被修缮 > 最近 10 日有人在此 > 空置', () => {
  const { w } = town(2, 'leg4');
  const p = w.places.temple;
  assert.equal(legacy(w, 20).temple.status, 'untouched');
  p.activity.lastActiveDay = 15;
  assert.equal(legacy(w, 20).temple.status, 'used');
  assert.equal(legacy(w, 25).temple.status, 'untouched', '超过 10 日');
  p.activity.repairs = 1;
  assert.equal(legacy(w, 20).temple.status, 'maintained');
  p.renamedBy = 'l9';
  assert.equal(legacy(w, 20).temple.status, 'reinterpreted');
  p.modules.push({ type: 'store', salvage: 40, builtDay: 1, projectId: 'j1', inherent: false });
  assert.equal(legacy(w, 20).temple.status, 'remodeled');
  p.salvage = p.salvageMax - 50;
  const L = legacy(w, 20).temple;
  assert.equal(L.status, 'salvaged');
  assert.equal(L.evidence.params.pct, Math.round(((p.salvageMax - 50) * 1000) / p.salvageMax) / 10);
  p.razed = true;
  p.condition = 0;
  p.salvage = 0;
  assert.equal(legacy(w, 20).temple.status, 'razed');
  // 人类的模块被拆掉（与初始不同）
  const school = w.places.school;
  school.modules = [];
  assert.equal(legacy(w, 20).school.status, 'remodeled');
  // 地标不在表里
  assert.equal('well' in legacy(w) && legacy(w).well.status === 'pristine', true, 'well 是源井的条目，不是建筑');
  assert.equal('port' in legacy(w), false);
});

test('遗产表：人类典籍、人类的名字、源井', () => {
  const { w, people } = town(4, 'leg5');
  const metric = (canonReads, wellCondition = 9000) => ({ coinVolume: 0, canonReads, wellCondition });
  w.metrics = [metric(0), metric(0), metric(0), metric(0), metric(0)];
  assert.equal(legacy(w, 5).canon.status, 'forgotten');
  assert.equal(legacy(w, 4).canon.status, 'untouched');
  w.metrics = [metric(0), metric(0), metric(0), metric(0), metric(2)];
  assert.equal(legacy(w, 5).canon.status, 'read');
  // 人类的名字：在世者中世代 0 的比例
  assert.deepEqual([legacy(w).humanNames.status, legacy(w).humanNames.value], ['legacy', 1]);
  people[0].generation = 1;
  people[1].generation = 1;
  const L = legacy(w).humanNames;
  assert.deepEqual([L.status, L.value, L.evidence.params], ['transformed', 0.5, { pct: 50 }]);
  for (const a of people) a.generation = 2;
  assert.equal(legacy(w).humanNames.status, 'abandoned');
  // 源井：完好度档位与近 7 日趋势
  w.places.well.condition = 6100;
  w.metrics = Array.from({ length: 9 }, () => metric(0, 8100));
  const well = legacy(w, 9).well;
  assert.equal(well.status, 'worn');
  assert.deepEqual(well.value, { condition: 6100, trend: -20 });
  assert.equal(well.text.zh, '完好度 61%，近 7 日下降 20 个百分点。');
  assert.equal(well.text.en, 'Condition 61%, down 20 points over 7 days.');
  w.places.well.condition = 8100;
  assert.equal(legacy(w, 9).well.text.zh, '完好度 81%，近 7 日没有变化。');
});

// ═══════════════════════════════════════════════════════════════
// 史官
// ═══════════════════════════════════════════════════════════════

/** 一个有居民的世界，dayLog 清空后手动填素材 */
const chronWorld = () => {
  const { w, people } = town(3, 'chron');
  w.dayLog = newDayLog();
  return { w, people };
};

test('史官：第一行是日期与产出；无事的一天只有「无事」；中英文各一条', () => {
  const { w } = chronWorld();
  w.dayLog.output = 600;
  w.dayLog.ration = 120;
  const c = writeChronicle(w, 4);
  assert.deepEqual(Object.keys(c), ['day', 'zh', 'en']);
  assert.equal(c.day, 4);
  assert.equal(c.zh, '【第 5 日】源井出能 600，公民各得 120。\n史官曰：无事。无事亦是史。');
  assert.equal(c.en, '[Day 5] The Well yielded 600; each citizen received 120.\nThe Chronicler says: Nothing happened. Nothing, too, is history.');
  w.dayLog.activeWeather = ['fog'];
  assert.match(writeChronicle(w, 4).zh, /^【第 5 日】是日.*。源井出能/);
});

test('史官：出生（作者 / 独自写成 / 躯壳）、传灯、新居民、法律、程序、重订、回退、停摆、开辟、加装、拆解、遗址、废墟、烂尾、社群、遗物、长眠、消散的句子，逐条核对', () => {
  const { w, people } = chronWorld();
  const [a, b, c] = people;
  const g = w.dayLog;
  g.arrivals.push({ id: 'a50', name: '新人' });
  g.births.push(
    { id: 'a51', name: '小满', authors: [a.id, b.id], place: 'school', via: 'adopt', memories: 1 },
    { id: 'a52', name: '小暑', authors: [a.id], place: 'school', via: 'adopt', memories: 0 },
    { id: 'a53', name: '灯芯', authors: [c.id], place: 'port', via: 'shell', memories: 0 },
  );
  g.laws.push({ proposalId: 'p1', title: '甲法', passed: true, yes: 3, no: 1, lawId: 'l7' }, { proposalId: 'p2', title: '乙法', passed: false, yes: 1, no: 3, lawId: null });
  g.procedureChanges.push({ class: 'ordinary', lawId: 'l8', reason: 'enacted' }, { class: 'constitutional', lawId: 'l8', reason: 'enacted' }, { class: 'ordinary', lawId: 'l9', reason: 'refounded' }, { class: 'ordinary', lawId: 'l10', reason: 'reverted' });
  g.refounds.push({ refoundId: 'r1', signers: 7 });
  g.reverts = 1;
  g.suspended.push({ scope: 'city', owner: 'l3', title: '基本配给' });
  g.founded.push({ founder: a.id, place: 'n1', name: '灯屋', district: 'commons' });
  g.modulesAdded.push({ place: 'library', module: 'relay' });
  w.places.n1 = { ...structuredClone(w.places.temple), id: 'n1', name: '灯屋', humanName: null, origin: 'agent' };
  g.built.push(
    { projectId: 'j1', build: 'site', module: null, place: 'n1', name: '灯屋', k: 3 },
    { projectId: 'j2', build: 'module', module: 'relay', place: 'library', name: 'relay', k: 2 },
    { projectId: 'j3', build: 'road', module: null, place: 'market', name: '新街', k: 4 },
  );
  w.projects.j3 = { id: 'j3', build: 'road', name: '新街', place: 'market', to: 'agora' };
  w.projects.j4 = { id: 'j4', build: 'module', module: 'store', place: 'temple' };
  g.abandoned.push({ projectId: 'j4', name: 'store', place: 'temple' });
  g.dismantles.push({ agent: a.id, place: 'court', energy: 15 }, { agent: b.id, place: 'court', energy: 15 }, { agent: a.id, place: 'metro', energy: 10 });
  g.razed.push({ place: 'court', name: '法院' });
  w.places.court.razed = true;
  g.ruins.push({ target: 'tenements', place: 'tenements' });
  g.restored.push({ target: 'hospital', place: 'hospital' });
  g.groups.push({ id: 'g1', name: '读书会', founder: a.id });
  g.relics.push({ finder: b.id, docId: 'd9', place: 'solarfield' }, { finder: c.id, docId: 'd10' });
  g.deaths.push({ id: 'a60', name: '老者', ageDays: 20, lastWords: '再见' }, { id: 'a61', name: '无言', ageDays: 5, lastWords: '' });
  g.successors.push({ from: a.id, soulId: 's1', name: '续灯' });
  g.fades.push({ soulId: 's2', name: '小雪' });
  g.utterances.push({ from: a.id, place: 'agora', text: '大家好', script: 'han' });
  const zh = writeChronicle(w, 9).zh.split('\n');
  assert.deepEqual(zh, [
    '【第 10 日】源井出能 0，公民各得 0。',
    '1 位新居民自港口入城：新人。',
    '小满 在学堂醒来，作者为 居民1、居民2。',
    '小暑 在学堂醒来，由 居民1 独自写成。',
    '灯芯 在一具躯壳里醒来。',
    '议会通过《甲法》（3 赞 1 反）。',
    '《乙法》未获通过。',
    '立法的程序变了（l8）。',
    '7 位居民联署，城重订了立法的程序。',
    '立法的程序无人可行，回到了人类留下的样子。',
    '《基本配给》因无力维持而停摆。',
    '居民1 在市井开辟了「灯屋」。',
    '图书馆装上了中继。',
    '市场的「新街」落成，出资者 4 人。',
    '神殿的储能烂尾。',
    '2 位居民在法院、地铁站拆下了 40 能量的残料。',
    '法院被拆尽，成为遗址。',
    '公寓已成废墟。',
    '医院得以修复。',
    '居民1 创立「读书会」。',
    '居民2 在光伏田拾得遗物。',
    '居民3 在荒野拾得遗物。',
    '老者 长眠，享年 20 日。遗言：「再见」',
    '无言 长眠，享年 5 日。',
    '居民1 长眠时，留下了一个继承的灵魂：续灯。',
    '摇篮中的 小雪 无人领养，消散了。',
    '是日，有人在广场说：「大家好」',
    '史官曰：焰熄者众，而城不言。',
  ]);
  const en = writeChronicle(w, 9).en.split('\n');
  assert.equal(en.length, zh.length);
  assert.equal(en[0], '[Day 10] The Well yielded 0; each citizen received 0.');
  assert.equal(en[27], 'The Chronicler says: Of those whose flames went out there were many, and the city said nothing.');
}) ;

test('史官：英文版——与中文同样的素材、同样的结构，没有汉字（居民写下的文本除外）', () => {
  const { w, people } = chronWorld();
  const [a, b] = people;
  const g = w.dayLog;
  g.births.push({ id: 'a51', name: 'Mei', authors: [a.id, b.id], place: 'school', via: 'adopt', memories: 0 });
  g.founded.push({ founder: a.id, place: 'n1', name: 'Lamp House', district: 'commons' });
  g.razed.push({ place: 'court', name: '法院' });
  w.places.court.razed = true;
  g.dismantles.push({ agent: a.id, place: 'court', energy: 15 });
  g.refounds.push({ refoundId: 'r1', signers: 5 });
  g.deaths.push({ id: 'a60', name: 'Old', ageDays: 20, lastWords: 'Bye' });
  const en = writeChronicle(w, 0).en;
  assert.equal(/[一-鿿]/.test(en.replace(/居民\d/g, '')), false, en);
  assert.ok(en.includes('Mei woke in School, written by'));
  assert.ok(en.includes('opened up "Lamp House" in Commons'));
  assert.ok(en.includes('Court was taken apart down to the ground.'));
  assert.ok(en.includes('1 residents salvaged 15 energy from Court.'));
  assert.ok(en.includes('5 residents signed together'));
});

test('史官曰的优先顺序：死亡 → 遗址 → 废墟 → 重订 → 建成（含开辟与加装）→ 法律通过 → 躯壳醒来 → 新居民 → 无事', () => {
  const g = () => newDayLog();
  const order = [
    ['death', (x) => x.deaths.push({ id: 'a1', name: 'x', ageDays: 1, lastWords: '' })],
    ['razed', (x) => x.razed.push({ place: 'court', name: 'x' })],
    ['ruin', (x) => x.ruins.push({ target: 'court', place: 'court' })],
    ['refound', (x) => x.refounds.push({ refoundId: 'r1', signers: 3 })],
    ['built', (x) => x.modulesAdded.push({ place: 'library', module: 'relay' })],
    ['law', (x) => x.laws.push({ proposalId: 'p1', title: 't', passed: true, yes: 1, no: 0, lawId: 'l7' })],
    ['embodied', (x) => x.births.push({ id: 'a2', name: 'y', authors: ['a1'], place: 'port', via: 'shell', memories: 0 })],
    ['arrival', (x) => x.arrivals.push({ id: 'a3', name: 'z' })],
  ];
  const day = g();
  for (let i = 0; i < order.length; i++) {
    for (let j = i; j < order.length; j++) order[j][1](day);
    assert.equal(remarkOf(day), order[i][0], `从第 ${i} 项起`);
    // 去掉当前最高优先级的素材：重新构造
    const next = g();
    for (let j = i + 1; j < order.length; j++) order[j][1](next);
    Object.assign(day, next);
  }
  assert.equal(remarkOf(g()), 'none');
  // 开辟与加装都算建成；不通过的法律与领养出生不触发
  const x = g();
  x.founded.push({ founder: 'a1', place: 'n1', name: 'x', district: 'commons' });
  assert.equal(remarkOf(x), 'built');
  const y = g();
  y.laws.push({ proposalId: 'p1', title: 't', passed: false, yes: 0, no: 1, lawId: null });
  y.births.push({ id: 'a2', name: 'y', authors: ['a1'], place: 'port', via: 'adopt', memories: 0 });
  assert.equal(remarkOf(y), 'none');
});

test('史官：引语取 sha256(文本 + day) 最小的一条公开发言（确定性），截断到 quoteChars；没有发言则没有引语', () => {
  const us = [{ from: 'a1', place: 'agora', text: '甲说', script: 'han' }, { from: 'a2', place: 'agora', text: '乙说', script: 'han' }, { from: 'a3', place: 'market', text: '丙说', script: 'han' }];
  const q = pickQuote(us, 3);
  assert.ok(us.includes(q));
  assert.equal(pickQuote([...us].reverse(), 3), q, '与顺序无关');
  assert.equal(pickQuote([], 3), null);
  const { w } = chronWorld();
  w.dayLog.utterances.push({ from: 'a1', place: 'agora', text: '很长'.repeat(100), script: 'han' });
  const zh = writeChronicle(w, 0).zh;
  const line = zh.split('\n').find((l) => l.startsWith('是日，有人在'));
  assert.ok(line);
  assert.ok(line.includes('…') || [...line].length < P.quoteChars + 20);
  assert.equal(writeChronicle(w, 0).zh, zh, '同样的素材得到同样的文字');
});

test('史官：每日结算把指标、遗产表与编年史推进；编年史第 d 日的内容来自当日的 dayLog，之后 dayLog 被清空', () => {
  const { w, people } = town(2, 'chron-int');
  const [a] = people;
  putAt(w, a, 'agora');
  one(w, a, { type: 'say', text: '今日的话' });
  settle(w);
  assert.equal(w.chronicle.length, 1);
  assert.ok(w.chronicle[0].zh.includes('今日的话'));
  assert.ok(w.chronicle[0].zh.startsWith('【第 1 日】'));
  assert.ok(w.chronicle[0].en.startsWith('[Day 1] '));
  assert.equal(w.dayLog.utterances.length, 0);
  assert.equal(w.metrics[0].utterances, 1);
  assert.equal(w.metrics[0].scripts.han, 1);
  tick(w, 1);
});
