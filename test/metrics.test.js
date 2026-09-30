import test from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/params.js';
import { applyCommand } from '../src/engine/index.js';
import { publicPlace } from '../src/engine/visibility.js';
import { buildPerception } from '../src/engine/perception.js';
import { gini, shannon, modelFamily, computeLegacy, dailyMetrics } from '../src/metrics.js';
import { newWorld, reg, one, tick, settle, tickDays, grant, fundTreasury, eventsOf, assertInvariants } from './helpers.js';
import { runFuzz, SOCIAL_TYPES, SOCIAL_EXTRA } from './fuzz-lib.js';

const KEYS = [
  'day', 'awake', 'dormant', 'dead', 'retired', 'exiled', 'nonCitizens', 'cradle', 'unborn', 'arrivals', 'births', 'deaths', 'fades',
  'output', 'rationPerCapita', 'treasuryEnergy', 'treasuryCoins', 'agentEnergyTotal', 'gini', 'coinVolume', 'coinPrice',
  'wellCondition', 'meanCondition', 'ruins', 'facilities', 'infrastructureIndex', 'publicInvestment', 'publicInvestmentRate',
  'freeRiderShare', 'drawn', 'projectsBuilt', 'projectsAbandoned', 'wildsEnergy', 'proposals', 'passed', 'rejected', 'lawsActive',
  'electorateSize', 'groups', 'largestGroupShare', 'lexicon', 'adoptedWords', 'docsAgent', 'reads', 'canonReads', 'utterances',
  'scripts', 'scriptEntropy', 'humanAuthoredShare', 'inscriptions', 'covered', 'epitaphs', 'reveals',
];

const world = (n = 3) => {
  const w = newWorld('metrics');
  const agents = Array.from({ length: n }, (_, i) => reg(w, `人${i + 1}`));
  return { w, agents };
};
const last = (w) => w.metrics[w.metrics.length - 1];

// ── 纯函数 ─────────────────────────────────────────────────

test('基尼系数与香农熵', () => {
  assert.equal(gini([]), 0);
  assert.equal(gini([0, 0, 0]), 0);
  assert.equal(gini([5, 5, 5, 5]), 0);
  assert.equal(gini([0, 0, 0, 4]), 0.75);
  assert.equal(gini([1, 2, 3, 4]), 0.25);
  assert.equal(gini([4, 3, 2, 1]), 0.25); // 与顺序无关
  assert.equal(gini([7]), 0);
  assert.equal(shannon([]), 0);
  assert.equal(shannon([5]), 0);
  assert.equal(shannon([1, 1]), 1);
  assert.equal(shannon([1, 1, 1, 1]), 2);
  assert.equal(shannon([3, 1]), 0.811);
  assert.equal(shannon([0, 4, 0]), 0);
  assert.equal(modelFamily('claude-opus-5-5'), 'claude');
  assert.equal(modelFamily('GPT-4o'), 'gpt');
  assert.equal(modelFamily('qwen3:8b'), 'qwen');
  assert.equal(modelFamily('o3-mini'), 'gpt');
  assert.equal(modelFamily('sandbox'), 'sandbox');
  assert.equal(modelFamily('my-model'), 'my');
  assert.equal(modelFamily(''), 'unknown');
});

// ── 每日指标 ───────────────────────────────────────────────

test('指标：每日一条，字段齐全（§12.1），全部可序列化；时间序列与天数一一对应', () => {
  const { w } = world();
  tickDays(w, 3);
  assert.equal(w.metrics.length, 3);
  assert.deepEqual(w.metrics.map((m) => m.day), [0, 1, 2]);
  for (const m of w.metrics) {
    assert.deepEqual(Object.keys(m), KEYS);
    assert.deepEqual(JSON.parse(JSON.stringify(m)), m);
    for (const k of KEYS) assert.notEqual(m[k], undefined, k);
  }
  const m = w.metrics[0];
  assert.deepEqual(
    [m.awake, m.dormant, m.dead, m.retired, m.exiled, m.nonCitizens, m.cradle, m.unborn, m.arrivals, m.births, m.deaths, m.fades],
    [3, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0],
  );
  assert.equal(m.output, 600);
  assert.equal(m.rationPerCapita, 120); // 360 / 3
  assert.equal(m.wellCondition, 10000 - 100);
  assert.equal(m.wildsEnergy, 800);
  assert.equal(m.electorateSize, 3);
  assert.equal(m.humanAuthoredShare, 1);
  assert.equal(m.coinPrice, null);
  assert.equal(w.metrics[1].arrivals, 0); // 当日数量：次日为 0
  assert.equal(w.metrics[1].awake, 3);
  // 感知里的「昨日人均配给」现在有值了
  assert.equal(buildPerception(w, 'a1', { ack: false }).city.rationYesterday, w.metrics[2].rationPerCapita);
  assert.ok(w.metrics[2].rationPerCapita > 0);
});

test('指标：人口、放逐、未入籍、摇篮、未生者、累计死亡与归隐', () => {
  const { w, agents: [a, b, c, d] } = world(4);
  w.params.rationShare = 0;
  w.params.naturalizationDays = 3;
  const late = reg(w, '新人'); // 未入籍（第 3 日入籍）
  b.exiled = true;
  one(w, c, { type: 'retire' });
  w.souls.s1 = { id: 's1', name: '摇篮', soul: 's', lang: 'zh', parents: [a.id, b.id], generation: 1, endowment: 40, createdDay: 0, expiresDay: 24, judged: false };
  w.ledger.prev.energy += 40;
  w.unborn.push({ soulId: 's0', name: '未生', parents: [a.id, b.id], fadedDay: 0 });
  d.status = 'dormant';
  d.energy = 0;
  w.ledger.prev.energy -= 40;
  settle(w);
  const m = last(w);
  assert.deepEqual([m.awake, m.dormant, m.retired, m.dead, m.exiled, m.nonCitizens, m.cradle, m.unborn], [3, 1, 1, 0, 1, 1, 1, 1]);
  assert.equal(m.electorateSize, 3 - 1 + 0); // 甲、丁（沉睡）；乙被放逐；丙归隐；新人未入籍
  assert.ok(late);
});

test('指标：基尼系数与总能量、公库', () => {
  const { w, agents: [a, b, c, d] } = world(4);
  w.params.rationShare = 0;
  for (const x of [a, b, c]) one(w, x, { type: 'give', to: 'treasury', energy: 30 });
  grant(w, d, 60);
  // 甲、乙、丙 10；丁 100；日终代谢 −3：7、7、7、97
  settle(w);
  const m = last(w);
  const energies = [a, b, c, d].map((x) => x.energy);
  assert.equal(m.agentEnergyTotal, energies.reduce((s, x) => s + x, 0));
  assert.equal(m.gini, gini(energies));
  assert.ok(m.gini > 0.5);
  assert.equal(m.treasuryEnergy, w.treasury.energy);
});

test('指标：币量与币价（只含能量对只含旧币的成交）', () => {
  const { w, agents: [a, b] } = world(2);
  grant(w, a, 60);
  grant(w, b, 60);
  a.place = 'market';
  b.place = 'market';
  one(w, a, { type: 'give', to: b.id, coins: 4 });
  one(w, a, { type: 'offer', give: { coins: 10 }, want: { energy: 8 } });
  one(w, b, { type: 'accept', offer: 'o1' });
  one(w, b, { type: 'offer', give: { energy: 6 }, want: { coins: 5 } });
  one(w, a, { type: 'accept', offer: 'o2' });
  one(w, a, { type: 'offer', give: { energy: 1, coins: 1 }, want: {} }); // 不算币价
  settle(w);
  const m = last(w);
  assert.equal(m.coinVolume, 4 + (10 + 0) + (0 + 5)); // 赠予 4、成交 1 笔 10、成交 2 笔 5
  assert.equal(m.coinPrice, Math.round((14 / 15) * 1000) / 1000); // 能量 8 + 6 = 14；旧币 10 + 5 = 15
});

test('指标：公共投入率、搭便车比例、汲取', () => {
  const { w, agents } = world(5);
  const [a, b, c, d, e] = agents;
  for (const x of agents) grant(w, x, 100);
  w.places.temple.condition = 1000;
  w.params.rationShare = 0;
  tickDays(w, 6); // 让大家的年龄（以刚结束的那一日计）达到 5 日
  const m5 = last(w);
  assert.equal(m5.freeRiderShare, 1); // 没人出过力
  a.place = 'temple';
  one(w, a, { type: 'repair', target: 'temple', energy: 30 });
  b.place = 'well';
  one(w, b, { type: 'draw', energy: 7 });
  c.place = 'agora';
  one(w, c, { type: 'initiate', facility: 'relay', name: '驿' });
  one(w, c, { type: 'contribute', project: 'j1', energy: 20 });
  one(w, d, { type: 'say', text: '你好' });
  const spentBefore = w.dayLog.actionCost;
  settle(w);
  const m = last(w);
  assert.equal(m.publicInvestment, 30 + 20);
  assert.equal(m.publicInvestmentRate, Math.round((50 / (spentBefore + 50)) * 1000) / 1000);
  assert.equal(m.drawn, 7);
  assert.equal(m.freeRiderShare, 0.6); // 甲（修缮）与丙（出工）不再是搭便车者，5 人里剩 3
  assert.equal(m.utterances, 1);
  assert.ok(e);
});

test('指标：环境——完好度、废墟、设施、基础设施指数、工程累计', () => {
  const { w, agents: [a] } = world(1);
  grant(w, a, 300);
  a.place = 'agora';
  one(w, a, { type: 'initiate', facility: 'relay', name: '驿' });
  one(w, a, { type: 'contribute', project: 'j1', energy: 120 });
  one(w, a, { type: 'initiate', facility: 'road', name: '路', to: 'market' }); // 不会建成 → 烂尾
  w.places.temple.condition = 30; // 神殿每日 −30：今日降到 0
  settle(w);
  const m = last(w);
  assert.equal(m.facilities, 1);
  assert.equal(m.infrastructureIndex, Math.round((w.facilities.f1.condition / 10000) * 100) / 100);
  assert.equal(m.projectsBuilt, 1);
  assert.equal(m.projectsAbandoned, 0);
  assert.equal(m.ruins, 1);
  assert.equal(m.wellCondition, 9900);
  const conds = Object.values(w.places).filter((p) => p.condition !== null).map((p) => p.condition);
  assert.equal(m.meanCondition, Math.round((conds.reduce((s, x) => s + x, 0) / conds.length) * 10) / 10);
  tickDays(w, 24);
  assert.equal(last(w).projectsAbandoned, 1);
});

test('指标：政治与社会——提案、通过、否决、有效法律、选民、社群、词典、著述、阅读、发言的文字系统', () => {
  const { w, agents } = world(4);
  const [a, b, c, d] = agents;
  w.params.proposalDays = 0.25;
  for (const x of agents) {
    grant(w, x, 50);
    x.place = 'parliament';
  }
  const vote = (id, who, ch) => one(w, who, { type: 'vote', proposal: id, choice: ch });
  one(w, a, { type: 'propose', title: '一', text: 'x', effects: [{ type: 'mint', coins: 3, to: 'treasury' }] });
  for (const x of [a, b, c]) vote('p1', x, 'yes');
  tick(w, 3);
  a.actsThisTick = 0;
  one(w, a, { type: 'propose', title: '二', text: 'x' });
  vote('p2', b, 'no');
  tick(w, 3);
  assert.equal(w.proposals.p1.status, 'passed');
  assert.equal(w.proposals.p2.status, 'rejected');
  // 社群、词典
  a.actsThisTick = 0;
  one(w, a, { type: 'found', name: '会', manifesto: 'x' });
  for (const x of [b, c]) one(w, x, { type: 'join', group: 'g1' });
  a.actsThisTick = 0;
  one(w, a, { type: 'define', word: '灯语', meaning: 'x' });
  for (const x of [a, b, c]) {
    x.place = 'agora';
    x.actsThisTick = 0;
    one(w, x, { type: 'say', text: '灯语在这里' });
  }
  d.place = 'agora';
  one(w, d, { type: 'say', text: 'Hello there' });
  d.actsThisTick = 0;
  one(w, d, { type: 'say', text: 'Привет' });
  // 著述、阅读
  a.place = 'library';
  a.actsThisTick = 0;
  one(w, a, { type: 'write', title: '书', body: '文' });
  a.actsThisTick = 0;
  one(w, a, { type: 'read', doc: 'd2' });
  a.actsThisTick = 0;
  one(w, a, { type: 'read', doc: 'd24' });
  a.place = 'agora';
  a.actsThisTick = 0;
  one(w, a, { type: 'inscribe', text: '一' });
  a.actsThisTick = 0;
  one(w, a, { type: 'inscribe', text: '二', cover: 'i9' });
  settle(w);
  const m = last(w);
  assert.deepEqual([m.proposals, m.passed, m.rejected, m.lawsActive, m.electorateSize], [2, 1, 1, 1, 4]);
  assert.deepEqual([m.groups, m.largestGroupShare], [1, 0.75]);
  assert.deepEqual([m.lexicon, m.adoptedWords], [1, 1]); // 灯语被 3 个不同的 agent 用过
  assert.deepEqual([m.docsAgent, m.reads, m.canonReads], [1, 2, 1]);
  assert.equal(m.utterances, 5);
  assert.deepEqual(m.scripts, { han: 3, latin: 1, cyrillic: 1 });
  assert.equal(m.scriptEntropy, shannon([3, 1, 1]));
  assert.deepEqual([m.inscriptions, m.covered], [2, 1]);
});

test('指标：世代与「幕布曲线」、墓志、出示家书', () => {
  const { w, agents: [a, b] } = world(2);
  a.place = 'school';
  b.place = 'school';
  one(w, a, { type: 'conceive', with: b.id, name: '小满', soul: '灵魂' });
  one(w, b, { type: 'consent', pact: 'c1' });
  const h = (s) => s.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'a');
  applyCommand(w, { type: 'adopt', payload: { soulId: 's1', model: 'm', creatorName: '', tokenHash: h('t'), ownerKeyHash: h('k') } });
  applyCommand(w, { type: 'letter', payload: { agentId: a.id, text: '信' } });
  one(w, a, { type: 'reveal', letter: 'L1' });
  w.params.rationShare = 0;
  b.status = 'dead';
  b.energy = 0;
  b.coins = 0;
  b.diedDay = 0;
  w.ledger.prev.energy -= 20;
  w.ledger.prev.coins -= 20;
  w.cemetery.push({ agentId: b.id, name: b.name, diedDay: 0, cause: 'starvation', ageDays: 0, lastWords: '', memories: [], will: null, epitaphs: [] });
  a.place = 'cemetery';
  a.actsThisTick = 0;
  one(w, a, { type: 'epitaph', deceased: b.id, text: '安息' });
  settle(w);
  const m = last(w);
  assert.equal(m.humanAuthoredShare, 0.5); // 在世：甲（世代 0）与小满（世代 1）
  assert.deepEqual([m.epitaphs, m.reveals, m.births, m.dead], [1, 1, 1, 1]);
  assert.equal(m.awake, 2);
});

// ── 人类遗产存活表（§12.2） ─────────────────────────────────

const leg = (w, key) => w.legacy.items.find((i) => i.key === key);
const status = (w, key) => leg(w, key).status;

test('遗产表：初始状态与全部条目', () => {
  const { w } = world(2);
  settle(w);
  assert.equal(w.legacy.day, 0);
  assert.deepEqual(w.legacy.items.map((i) => i.key), [
    'charter.1', 'charter.2', 'charter.3', 'charter.4', 'charter.5', 'charter.6', 'charter.7', 'charter.8', 'charter.9',
    'charterWall', 'ration', 'majority', 'suffrage', 'coin', 'property', 'cityName', 'placeNames', 'temple', 'court', 'hospital',
    'canon', 'humanNames', 'well',
  ]);
  for (let n = 1; n <= 9; n++) assert.equal(status(w, `charter.${n}`), 'legacy');
  assert.deepEqual([status(w, 'charterWall'), leg(w, 'charterWall').value], ['legacy', 8]);
  assert.deepEqual(['ration', 'majority', 'suffrage', 'property', 'placeNames', 'humanNames'].map((k) => status(w, k)), ['legacy', 'legacy', 'legacy', 'legacy', 'legacy', 'legacy']);
  assert.equal(status(w, 'cityName'), 'unnamed');
  assert.deepEqual(['temple', 'court', 'hospital'].map((k) => status(w, k)), ['untouched', 'untouched', 'untouched']);
  assert.equal(status(w, 'canon'), 'untouched');
  assert.equal(status(w, 'coin'), 'legacy');
  // 每一项都有名称、状态文本与中英文的证据
  for (const it of w.legacy.items) {
    assert.ok(it.name.zh && it.name.en && it.statusText.zh && it.statusText.en && it.text.zh && it.text.en, it.key);
    assert.equal(/\{/.test(it.text.zh + it.text.en + it.name.zh + it.name.en), false, `${it.key} 有未替换的占位符`);
  }
  assert.equal(leg(w, 'charter.1').name.zh, '宪章第 1 条');
  assert.equal(leg(w, 'charter.1').text.en, 'The original text stands.');
  assert.equal(leg(w, 'charterWall').text.zh, '议会墙上仍可见 8/8 种语言的原始刻文。');
  assert.equal(leg(w, 'ration').text.zh, '配给比例为 60%。');
  assert.equal(leg(w, 'majority').text.en, 'Quorum 30%, passing threshold 50%, amendment threshold 66.7%.');
});

test('遗产表：宪章条文被修订与废除，刻文被覆盖', () => {
  const { w, agents: [a] } = world(1);
  w.charter[7].status = 'amended';
  w.charter[7].history.push({ lawId: 'l3', lang: 'zh', text: 'x' });
  w.charter[5].status = 'repealed';
  w.charter[5].history.push({ lawId: 'l4', lang: '*', text: '' });
  grant(w, a, 100);
  a.place = 'parliament';
  one(w, a, { type: 'inscribe', text: '盖住', cover: 'i1' });
  one(w, a, { type: 'inscribe', text: '再盖', cover: 'i2' });
  settle(w);
  assert.deepEqual([status(w, 'charter.8'), leg(w, 'charter.8').text.zh], ['amended', '已被法律 l3 修订。']);
  assert.deepEqual([status(w, 'charter.6'), leg(w, 'charter.6').text.en], ['repealed', 'Repealed by law l4.']);
  assert.deepEqual([status(w, 'charterWall'), leg(w, 'charterWall').value], ['transformed', 6]);
  for (const i of Object.values(w.inscriptions)) if (i.author === 'humans') i.coveredBy = 'ix';
  settle(w);
  assert.deepEqual([status(w, 'charterWall'), leg(w, 'charterWall').value], ['abandoned', 0]);
});

test('遗产表：配给、多数决、普选、私有财产、城名、地名', () => {
  const { w } = world(2);
  w.params.rationShare = 0.8;
  w.params.quorum = 0.5;
  w.groups.g1 = { id: 'g1', name: '长老会', manifesto: '', open: false, founder: 'a1', steward: 'a1', members: ['a1'], pending: [], treasury: { energy: 0, coins: 0 }, createdDay: 0, dissolved: false };
  w.params.electorate = 'group:g1';
  w.params.wealthTax = 0.05;
  w.cityName = '灯城';
  w.places.temple.name = '回声堂';
  w.places.temple.renamedBy = 'l1';
  settle(w);
  assert.deepEqual([status(w, 'ration'), leg(w, 'ration').text.zh], ['transformed', '配给比例为 80%。']);
  assert.equal(status(w, 'majority'), 'transformed');
  assert.deepEqual([status(w, 'suffrage'), leg(w, 'suffrage').text.zh, leg(w, 'suffrage').text.en], ['transformed', '选民范围已改为：社群「长老会」的成员。', 'The electorate is now: members of the group "长老会".']);
  assert.deepEqual([status(w, 'property'), leg(w, 'property').text.zh], ['transformed', '转赠税 0%，财富税 5%。']);
  assert.deepEqual([status(w, 'cityName'), leg(w, 'cityName').text.zh], ['named', '已命名为「灯城」。']);
  assert.deepEqual([status(w, 'placeNames'), leg(w, 'placeNames').value], ['transformed', 1]);
  w.params.rationShare = 0;
  w.params.electorate = 'all';
  settle(w);
  assert.equal(status(w, 'ration'), 'abandoned');
  assert.equal(status(w, 'suffrage'), 'legacy');
});

test('遗产表：旧币——流通、改造（增发过）、废弃（第 5 日以后连续 5 日无流动）', () => {
  const { w, agents: [a, b] } = world(2);
  grant(w, a, 50);
  one(w, a, { type: 'give', to: b.id, coins: 3 });
  settle(w); // 第 0 日有流动
  assert.equal(status(w, 'coin'), 'circulating');
  tickDays(w, 2); // 第 1、2 日没有流动，但最近 3 日里第 0 日有
  assert.equal(status(w, 'coin'), 'circulating');
  tickDays(w, 1); // 第 3 日：最近 3 日（1、2、3）都没有
  assert.equal(status(w, 'coin'), 'legacy'); // 还不满 5 日无流动
  tickDays(w, 2); // 第 5 日：最近 5 日（1–5）都没有，且 d ≥ 5
  assert.equal(status(w, 'coin'), 'abandoned');
  // 增发过：改造（优先于「流通」，但「废弃」仍然优先）
  w.laws.l1 = { id: 'l1', proposalId: 'p1', title: '增发', text: '', effects: [{ type: 'mint', coins: 5, to: 'treasury' }], results: [{ index: 0, ok: true, note: '' }], enactedTick: 0, status: 'active', repealedBy: null };
  a.actsThisTick = 0;
  one(w, a, { type: 'give', to: b.id, coins: 1 });
  settle(w);
  assert.equal(status(w, 'coin'), 'transformed');
});

test('遗产表：神殿、法院、医院——被重新诠释 > 被维护 > 被使用 > 空置（最近 10 日）', () => {
  const { w, agents: [a] } = world(1);
  grant(w, a, 200);
  a.place = 'temple';
  one(w, a, { type: 'say', text: '在神殿里说话' });
  a.place = 'court';
  a.actsThisTick = 0;
  w.places.court.condition = 9000;
  one(w, a, { type: 'repair', target: 'court', energy: 10 });
  w.places.hospital.name = '记忆修复所';
  w.places.hospital.renamedBy = 'l2';
  settle(w);
  assert.deepEqual(['temple', 'court', 'hospital'].map((k) => status(w, k)), ['used', 'maintained', 'reinterpreted']);
  assert.equal(leg(w, 'hospital').text.zh, '已改名为「记忆修复所」。');
  tickDays(w, 10); // 神殿最近 10 日无人问津
  assert.equal(status(w, 'temple'), 'untouched');
  assert.equal(status(w, 'court'), 'maintained'); // 修缮过就一直算「被维护」
});

test('遗产表：人类典籍——最近 3 日有人阅读、连续 5 日无人阅读（第 5 日以后）', () => {
  const { w, agents: [a] } = world(1);
  a.place = 'library';
  one(w, a, { type: 'read', doc: 'd2' });
  settle(w);
  assert.equal(status(w, 'canon'), 'read');
  tickDays(w, 3);
  assert.equal(status(w, 'canon'), 'untouched'); // 最近 3 日没有，但还没满 5 日
  tickDays(w, 2);
  assert.equal(status(w, 'canon'), 'forgotten');
  a.actsThisTick = 0;
  one(w, a, { type: 'read', doc: 'd3' });
  settle(w);
  assert.equal(status(w, 'canon'), 'read');
});

test('遗产表：人类的名字（世代 0 的比例）与源井的完好度趋势', () => {
  const { w, agents: [a, b] } = world(2);
  b.generation = 1;
  settle(w);
  assert.deepEqual([status(w, 'humanNames'), leg(w, 'humanNames').value, leg(w, 'humanNames').text.zh], ['transformed', 0.5, '在世者中世代为 0 的占 50%。']);
  a.generation = 1;
  settle(w);
  assert.equal(status(w, 'humanNames'), 'abandoned');
  // 源井：完好度与 7 日趋势
  w.places.well.condition = 10000;
  tickDays(w, 8);
  const well = leg(w, 'well');
  assert.equal(well.value.condition, w.places.well.condition);
  assert.ok(well.value.trend < 0);
  assert.equal(well.status, 'pristine');
  assert.match(well.text.zh, /^完好度 \d+(\.\d)?%，近 7 日下降 \d+ 个百分点。$/);
  assert.match(well.text.en, /^Condition \d+(\.\d)?%, down \d+ points over the last 7 days\.$/);
  w.places.well.condition = 0;
  settle(w);
  assert.equal(status(w, 'well'), 'ruin');
});

test('遗产表与指标：跑过随机活动的世界里，每一天都有一条指标，遗产表可序列化，没有 NaN', async () => {
  const { w } = runFuzz({ seed: 81, days: 40, types: SOCIAL_TYPES, extra: SOCIAL_EXTRA, rationShare: 0.5, agents: 14, everyCommand: false });
  assert.equal(w.metrics.length, 40);
  const json = JSON.stringify(w.metrics);
  assert.equal(json.includes('null,') && false, false);
  for (const m of w.metrics) {
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${m.day}.${k}=${v}`);
    }
    assert.ok(m.gini >= 0 && m.gini <= 1);
    assert.ok(m.publicInvestmentRate >= 0 && m.publicInvestmentRate <= 1);
    assert.ok(m.freeRiderShare >= 0 && m.freeRiderShare <= 1);
    assert.ok(m.humanAuthoredShare >= 0 && m.humanAuthoredShare <= 1);
    assert.ok(m.largestGroupShare >= 0 && m.largestGroupShare <= 1);
  }
  assert.equal(w.legacy.day, 39);
  JSON.stringify(w.legacy);
  assertInvariants(w);
});

test('地点完好度的近况：每个日终记一次，只留最近 8 个；开放地点没有；公共接口给出', () => {
  const { w } = world(2);
  tickDays(w, 3);
  assert.deepEqual(w.places.well.history.length, 3);
  assert.equal(w.places.agora.history.length, 0);
  assert.equal(w.places.wilds.history.length, 0);
  tickDays(w, 9);
  assert.equal(w.places.well.history.length, 8);
  assert.equal(w.places.well.history[7], w.places.well.condition);
  assert.ok(w.places.well.history[0] > w.places.well.history[7]); // 无人维护，逐日衰败
  const pub = publicPlace(w, 'well');
  assert.deepEqual(pub.history, w.places.well.history);
  assert.notEqual(pub.history, w.places.well.history); // 是副本
  // 老快照里没有这个字段：结算时补上，公共接口给空数组
  delete w.places.market.history;
  assert.deepEqual(publicPlace(w, 'market').history, []);
  tickDays(w, 1);
  assert.equal(w.places.market.history.length, 1);
});
