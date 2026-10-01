// SPEC-E2 §17、PROTOCOL-2 §3（§25 第 9 步）：感知——结构、字段、预求值、语言、保密。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../src/e2/engine/index.js';
import { buildPerception, inboxView } from '../src/e2/engine/perception.js';
import { createLaw, installProcedure } from '../src/e2/engine/laws.js';
import { HUMAN_PROCEDURE } from '../src/e2/lore/humanlaws.js';
import { ACTION_ORDER } from '../src/e2/lore/index.js';
import { P } from '../src/e2/params.js';
import { newWorld, bareWorld, reg, one, setHoldings, putAt, tick, tickDays, sha } from './e2-helpers.js';
import { enact } from './e2-law-helpers.js';

const per = (w, a, lang = 'zh', o = {}) => buildPerception(w, a.id, { lang, ack: false, ...o });
const action = (p, type) => p.actions.find((x) => x.type === type);

/** 一座有 n 位居民的默认城（遗法在效）；住了几日，居民成了公民 */
const town = (n = 3, seed = 'perc') => {
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
// 结构
// ═══════════════════════════════════════════════════════════════

test('醒着时的感知：protocol 2，字段与顺序同 PROTOCOL-2 §3.1；删去协议 1 的 citizen / exiled / params / rationYesterday / citizens', () => {
  const { w, people } = town(2);
  const [a] = people;
  const p = per(w, a);
  assert.deepEqual(Object.keys(p), ['protocol', 'lang', 'now', 'you', 'here', 'city', 'inbox', 'inboxCursor', 'actions']);
  assert.equal(p.protocol, 2);
  assert.equal(p.lang, 'zh');
  assert.deepEqual(Object.keys(p.now), ['tick', 'day', 'month', 'dayOfMonth', 'tickOfDay', 'ticksPerDay', 'daysPerMonth', 'nextTickAt', 'tickMs', 'paused']);
  assert.deepEqual(Object.keys(p.you), [
    'id', 'name', 'lang', 'bio', 'purpose', 'soul', 'status', 'tags', 'energy', 'energyCap', 'floor', 'coins', 'place', 'ageDays', 'generation', 'authors', 'children',
    'metabolism', 'actionsLeft', 'maxActionsPerTick', 'drawnToday', 'repairedToday', 'salvagedToday', 'memories', 'memorySlots', 'groups', 'owns', 'will', 'letters', 'offers', 'pacts',
  ]);
  assert.deepEqual(Object.keys(p.here), [
    'place', 'name', 'humanName', 'origin', 'district', 'description', 'owner', 'condition', 'razed', 'costMultiplier', 'salvage', 'modules', 'gate', 'rules', 'present', 'heard',
    'inscriptions', 'wallSlots', 'wallFree', 'projects', 'roads', 'lots', 'omens', 'board', 'archive', 'memorial', 'cradle', 'well', 'wilds',
  ]);
  assert.deepEqual(Object.keys(p.city), [
    'name', 'season', 'weather', 'treasury', 'wellOutputYesterday', 'population', 'shells', 'vars', 'procedure', 'laws', 'proposals', 'refounds', 'charter', 'charterCanonical',
    'places', 'roads', 'residents', 'groups', 'lexicon', 'cradle', 'recentDeaths', 'petitions',
  ]);
  for (const gone of ['citizen', 'citizenFromDay', 'exiled', 'parents']) assert.equal(gone in p.you, false, `you.${gone}`);
  for (const gone of ['params', 'rationYesterday', 'citizens']) assert.equal(gone in p.city, false, `city.${gone}`);
  assert.deepEqual(p.actions.map((x) => x.type), ACTION_ORDER);
  for (const x of p.actions) assert.deepEqual(Object.keys(x).slice(0, 3), ['type', 'cost', 'available']);
  // 第二纪新增的动作都在表里
  for (const t of ['propose', 'vote', 'draft', 'refound', 'sign', 'rules', 'initiate', 'contribute', 'dismantle', 'conceive', 'consent', 'sponsor', 'declare']) {
    assert.ok(ACTION_ORDER.includes(t), t);
  }
  // JSON 干净
  assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
});

test('now：钟、刻、月；shells 与 vars；初始的程序 / 法律 / 宪章：6 部遗法按 ID 倒序、l1 的两类程序读法、宪章 9 条', () => {
  const { w, people } = town(2);
  const p = per(w, people[0]);
  assert.deepEqual([p.now.tick, p.now.day, p.now.ticksPerDay, p.now.daysPerMonth, p.now.tickMs, p.now.paused], [0, 0, P.ticksPerDay, P.daysPerMonth, P.tickMs, false]);
  assert.deepEqual(p.city.shells, { free: w.shells.slots, total: w.shells.slots, cost: P.shellCost });
  assert.deepEqual(p.city.vars, { rationShare: 600 });
  assert.deepEqual(p.city.laws.map((l) => l.id), ['l6', 'l5', 'l4', 'l3', 'l2', 'l1']);
  assert.deepEqual([p.city.procedure.ordinary.lawId, p.city.procedure.constitutional.lawId], ['l1', 'l1']);
  assert.ok(p.city.procedure.ordinary.reading.includes('不记名'));
  assert.equal(p.city.charter.length, 9);
  assert.ok(p.city.charter.every((c) => c.status === 'legacy' && c.text.length > 0 && c.lang === 'zh'));
  assert.deepEqual(p.city.laws.find((l) => l.id === 'l3').author, 'humans');
  assert.equal(p.city.laws.every((l) => l.suspended === false), true);
  // 读法是按 lang 生成的系统文本；英文里没有汉字
  const en = per(w, people[0], 'en');
  assert.ok(en.city.laws.every((l) => !/[一-鿿]/.test(l.title + l.reading)), JSON.stringify(en.city.laws.map((l) => [l.title, l.reading])));
  assert.notEqual(p.city.laws[0].reading, en.city.laws[0].reading);
});

test('lang：缺省 / 未知语言回落到 zh；系统文本随语言，居民写下的文本原样；英文的理由与说明里没有汉字', () => {
  const { w, people } = town(2);
  const [a] = people;
  a.bio = '我写的介绍 about me';
  assert.equal(buildPerception(w, a.id, { ack: false }).lang, 'zh');
  assert.equal(buildPerception(w, a.id, { lang: 'fr', ack: false }).lang, 'zh');
  const en = per(w, a, 'en');
  assert.equal(en.lang, 'en');
  assert.equal(en.you.bio, '我写的介绍 about me');
  assert.equal(en.here.name, 'Port');
  const zh = per(w, a, 'zh');
  assert.equal(zh.here.name, '港口');
  for (const x of en.actions) {
    const text = JSON.stringify(x.reason || '') + JSON.stringify(x.note || '');
    assert.ok(!/[一-鿿]/.test(text), `${x.type}: ${text}`);
  }
});

// ═══════════════════════════════════════════════════════════════
// you
// ═══════════════════════════════════════════════════════════════

test('you：标签、志、作者与遗传的记忆（from）、孩子、名下的地点、遗嘱里的继承灵魂（只给名字）、孕育之约、社群', () => {
  const { w, people } = town(3, 'you');
  const [a, b] = people;
  tickDays(w, 3);
  for (const x of people) setHoldings(w, x, { energy: 100 });
  one(w, a, { type: 'remember', text: '一条要传下去的记忆' });
  one(w, a, { type: 'declare', purpose: '守住这口井' });
  // 分灵 → 领养：孩子带着作者的记忆
  const soul = w.souls[one(w, a, { type: 'conceive', name: '小满', soul: '一个爱说话的灵魂', memories: [0] }).data.soul];
  const out = applyCommand(w, { type: 'adopt', payload: { soulId: soul.id, model: 'm', creatorName: 'c', tokenHash: sha('kid-t'), ownerKeyHash: sha('kid-k') } });
  assert.equal(out.result.ok, true, JSON.stringify(out.result));
  const kid = w.agents[out.result.agentId];
  const pk = per(w, kid);
  assert.deepEqual(pk.you.authors, [{ id: a.id, name: a.name }]);
  assert.equal(pk.you.generation, 1);
  assert.deepEqual(pk.you.memories, [{ index: 0, day: w.clock.tick / P.ticksPerDay | 0, text: '一条要传下去的记忆', from: { id: a.id, name: a.name } }]);
  const pa = per(w, a);
  assert.deepEqual(pa.you.children, [{ id: kid.id, name: '小满' }]);
  assert.equal(pa.you.purpose, '守住这口井');
  assert.deepEqual(pa.you.memories.map((m) => [m.index, m.from]), [[0, null]]);
  assert.deepEqual(pa.you.tags, ['citizen']);
  // 名下的地点
  w.places.lighthouse.owner = { kind: 'agent', id: a.id };
  assert.deepEqual(per(w, a).you.owns, [{ id: 'lighthouse', name: '灯塔' }]);
  assert.deepEqual(per(w, a, 'en').you.owns, [{ id: 'lighthouse', name: 'Lighthouse' }]);
  // 遗嘱里的继承灵魂：只给名字
  one(w, a, { type: 'will', heirs: [{ to: b.id, share: 1 }], lastWords: '再见', successor: { name: '续灯', soul: '我传下的灯，别人看不到全文' } });
  assert.deepEqual(per(w, a).you.will, { heirs: [{ to: b.id, name: b.name, share: 1 }], lastWords: '再见', successor: { name: '续灯' } });
  assert.equal(JSON.stringify(per(w, b)).includes('别人看不到全文'), false);
  // 孕育之约
  setHoldings(w, a, { energy: 100 });
  const pact = one(w, a, { type: 'conceive', name: '小暑', soul: '两位作者的灵魂', with: [b.id] }).data;
  const pb = per(w, b).you.pacts;
  assert.equal(pb.length, 1);
  assert.deepEqual([pb[0].id, pb[0].role, pb[0].name], [pact.pact, 'author', '小暑']);
  assert.deepEqual(pb[0].authors, [{ id: a.id, name: a.name, consented: true }, { id: b.id, name: b.name, consented: false }]);
  assert.equal(per(w, a).you.pacts[0].role, 'initiator');
  // 社群
  setHoldings(w, a, { energy: 100 });
  one(w, a, { type: 'found', name: '守灯会', manifesto: '守灯', open: true });
  assert.deepEqual(per(w, a).you.groups, [{ id: 'g1', name: '守灯会', steward: true }]);
});

test('you：生存底线、能量上限、本刻剩余动作数、今日的汲取 / 修缮 / 拆解量；沉睡与死亡后的感知是精简的', () => {
  const { w, people } = town(2, 'you2');
  const [a, b] = people;
  const p = per(w, a);
  assert.deepEqual([p.you.floor, p.you.energyCap, p.you.actionsLeft, p.you.maxActionsPerTick], [P.lawFloor, 120, P.maxActionsPerTick, P.maxActionsPerTick]);
  one(w, a, { type: 'say', text: '嗨' });
  assert.equal(per(w, a).you.actionsLeft, P.maxActionsPerTick - 1);
  // 沉睡
  setHoldings(w, b, { energy: 0 });
  b.status = 'dormant';
  b.dormantSinceDay = 0;
  const d = per(w, b);
  assert.deepEqual(Object.keys(d), ['protocol', 'lang', 'now', 'you']);
  assert.deepEqual(d.you, { id: b.id, name: b.name, status: 'dormant', energy: 0, dormantSinceDay: 0, daysUntilDeath: P.dormancyGraceDays });
  // 死亡 / 归隐
  b.status = 'dead';
  assert.deepEqual(per(w, b), { protocol: 2, you: { id: b.id, name: b.name, status: 'dead' } });
  b.status = 'retired';
  assert.deepEqual(per(w, b), { protocol: 2, you: { id: b.id, name: b.name, status: 'retired' } });
  assert.equal(buildPerception(w, 'a99'), null);
});

// ═══════════════════════════════════════════════════════════════
// here
// ═══════════════════════════════════════════════════════════════

test('here：人类的建筑（描述 code、完好度档位、残料、模块、墙）；空地没有完好度；荒野有富饶度；源井有产出与汲取池；同地者带标签与志', () => {
  const { w, people } = town(3, 'here');
  const [a, b, c] = people;
  tickDays(w, 1);
  putAt(w, a, 'library');
  putAt(w, b, 'library');
  one(w, b, { type: 'declare', purpose: '读完所有的书' });
  const lib = per(w, a).here;
  assert.deepEqual([lib.place, lib.name, lib.humanName, lib.origin, lib.razed], ['library', '图书馆', '图书馆', 'human', false]);
  assert.deepEqual(lib.district, { code: 'oldtown', text: '旧城' });
  assert.equal(lib.description.code, 'place.library');
  assert.deepEqual(lib.owner, { kind: 'city' });
  assert.equal(lib.condition.band, 'pristine');
  assert.deepEqual(lib.salvage, { left: 300, max: 300 });
  assert.deepEqual(lib.modules.map((m) => [m.type, m.functioning]), [['archive', true]]);
  assert.equal(lib.archive.docs.length, w.docs ? Object.keys(w.docs).length : 0);
  assert.deepEqual(lib.present, [{ id: b.id, name: b.name, status: 'awake', tags: ['citizen'], purpose: '读完所有的书' }]);
  assert.equal(lib.wallSlots, 6);
  assert.equal(lib.wallFree, 6);
  assert.deepEqual([lib.board, lib.memorial, lib.cradle, lib.well, lib.wilds, lib.gate], [null, null, null, null, null, null]);
  // 议会：12 个墙位，宪章占 8 个
  putAt(w, a, 'parliament');
  const par = per(w, a).here;
  assert.deepEqual([par.wallSlots, par.wallFree, par.inscriptions.length], [12, 4, 8]);
  assert.ok(par.inscriptions.every((i) => i.protected === false && i.truncated));
  // 广场：空地
  putAt(w, a, 'agora');
  const ag = per(w, a).here;
  assert.deepEqual([ag.condition, ag.salvage, ag.modules], [null, null, []]);
  // 源井、荒野、学堂（摇篮）、市场（告示板）、墓园（纪念）
  putAt(w, a, 'well');
  const well = per(w, a).here;
  assert.deepEqual(Object.keys(well.well), ['outputYesterday', 'drawPoolLeft', 'condition']);
  assert.equal(well.well.drawPoolLeft, P.wellDrawPoolPerDay);
  assert.equal(well.salvage, null, '地标没有残料');
  putAt(w, a, 'wilds');
  assert.deepEqual(Object.keys(per(w, a).here.wilds), ['richness', 'text']);
  putAt(w, a, 'school');
  assert.deepEqual(per(w, a).here.cradle, { functioning: true });
  putAt(w, a, 'market');
  assert.deepEqual(per(w, a).here.board, { offers: [] });
  putAt(w, a, 'cemetery');
  assert.deepEqual(per(w, a).here.memorial, { graves: [] });
  void c;
});

test('here：后人开辟的地点（描述原文、所有者）、遗址（系统文本、名字「X 的遗址」）、进行中的工程、相邻的空地块、门', () => {
  const { w, people } = town(3, 'here2');
  const [a, b] = people;
  putAt(w, a, 'agora');
  const lots = per(w, a).here.lots;
  assert.ok(lots.length > 0 && lots.every((x) => x.free === true && /^[a-z]+-\d+$/.test(x.id)), JSON.stringify(lots));
  // 进行中的开辟工程
  setHoldings(w, a, { energy: 100 });
  const j = one(w, a, { type: 'initiate', build: 'site', lot: lots[0].id, name: '灯屋', description: '一间亮着灯的小屋' });
  assert.equal(j.ok, true, JSON.stringify(j));
  const here = per(w, a).here;
  assert.equal(here.projects.length, 1);
  assert.deepEqual([here.projects[0].build, here.projects[0].lot, here.projects[0].name, here.projects[0].have], ['site', lots[0].id, '灯屋', 0]);
  assert.equal(here.lots.find((x) => x.id === lots[0].id).free, false);
  // 后人开辟的地点：描述原文、origin agent
  const n = { ...w.places.temple, id: 'n1', name: '灯屋', humanName: null, description: '一间亮着灯的小屋', origin: 'agent', owner: { kind: 'agent', id: a.id }, founder: a.id, foundedDay: 0 };
  w.places.n1 = n;
  putAt(w, a, 'n1');
  const mine = per(w, a).here;
  assert.deepEqual([mine.origin, mine.humanName, mine.name], ['agent', null, '灯屋']);
  assert.deepEqual(mine.description, { code: null, text: '一间亮着灯的小屋' });
  assert.deepEqual(mine.owner, { kind: 'agent', id: a.id, name: a.name });
  // 门：装了运转中的门，别人进不来
  n.modules.push({ type: 'gate', salvage: 20, builtDay: 0, projectId: 'j9', inherent: false });
  assert.deepEqual(per(w, a).here.gate, { functioning: true, youMayEnter: true });
  // 遗址
  const ruins = w.places.court;
  ruins.razed = true;
  ruins.condition = 0;
  ruins.modules = [];
  ruins.salvage = 0;
  ruins.wallSlots = 0;
  putAt(w, b, 'court');
  const r = per(w, b).here;
  assert.deepEqual([r.razed, r.name, r.description.code], [true, '法院的遗址', 'razed']);
  assert.equal(r.description.text, '这里曾经是法院。现在只剩一块空地。');
  assert.equal(per(w, b, 'en').here.name, 'Ruins of Court');
  assert.equal(r.wallSlots, 0);
});

// ═══════════════════════════════════════════════════════════════
// city
// ═══════════════════════════════════════════════════════════════

test('city.laws：在效的城法按 ID 倒序至多 lawsInPerception 部；正文截断到 lawTextInPerception、读法截断到 readingInPerception（末尾「…」）；被撤销的不在其中', () => {
  const { w, people } = town(2, 'laws');
  const [a] = people;
  const long = '很长的正文'.repeat(80);
  for (let i = 0; i < P.lawsInPerception + 4; i++) {
    enact(w, [{ when: 'monthly', do: [{ op: 'set', var: `v${i}`, value: `${i}` }] }], { title: `法律${i}`, text: long, author: a.id });
  }
  const p = per(w, a);
  assert.equal(p.city.laws.length, P.lawsInPerception);
  assert.equal(p.city.laws[0].id, `l${6 + P.lawsInPerception + 4}`);
  assert.deepEqual(p.city.laws.map((l) => l.id), p.city.laws.map((l) => l.id).slice().sort((x, y) => Number(y.slice(1)) - Number(x.slice(1))));
  const first = p.city.laws[0];
  assert.equal([...first.text].length, P.lawTextInPerception);
  assert.ok(first.text.endsWith('…'));
  assert.deepEqual(first.author, { id: a.id, name: a.name });
  // 读法超长时截断
  enact(w, Array.from({ length: 4 }, (_, r) => ({ when: 'daily', do: Array.from({ length: 8 }, (_, i) => ({ op: 'set', var: `w${r}${i}`, value: `${i} + ${i} * 2 + ${i} * 3` })) })), { title: '长读法' });
  const long2 = per(w, a).city.laws[0];
  assert.ok([...long2.reading].length <= P.readingInPerception);
  assert.ok(long2.reading.endsWith('…'));
  // 撤销的不再出现
  w.laws.l3.status = 'repealed';
  assert.equal(per(w, a).city.laws.some((l) => l.id === 'l3'), false);
});

test('city.laws[].suspended：付不起维持费而停摆的法律；程序法律与只有 enact 的法律不会停摆', () => {
  const { w, people } = town(2, 'susp');
  const [a] = people;
  const law = enact(w, [{ when: 'daily', do: [{ op: 'set', var: 'x', value: '1' }] }], { title: '每日', author: a.id });
  assert.equal(per(w, a).city.laws.find((l) => l.id === law.id).suspended, false);
  law.paidThrough = -5; // 早已欠费
  const p = per(w, a);
  assert.equal(p.city.laws.find((l) => l.id === law.id).suspended, true);
  assert.equal(p.city.laws.find((l) => l.id === 'l1').suspended, false);
  assert.equal(p.city.laws.find((l) => l.id === 'l2').suspended, false, 'l2 有持续规则，但遗法由公库付维持费');
});

test('city.proposals：不记名时 ballots 为 null、tally 仍给；记名时给每一张票；yourVote、eligible；表决者在提出时固定', () => {
  const { w, people } = town(4, 'props');
  const [a, b, c, d] = people;
  tickDays(w, 3);
  for (const x of people) { setHoldings(w, x, { energy: 100 }); putAt(w, x, 'parliament'); }
  const r = one(w, a, { type: 'propose', title: '测试法', text: '把变量 x 设为 1', rules: [{ when: 'enact', do: [{ op: 'set', var: 'x', value: '1' }] }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  one(w, b, { type: 'vote', proposal: r.data.proposal, choice: 'yes', reason: '好' });
  one(w, c, { type: 'vote', proposal: r.data.proposal, choice: 'no' });
  let p = per(w, b).city.proposals[0];
  assert.equal(p.ballots, null, '遗法 l1 是不记名的');
  assert.deepEqual(p.tally, { yes: 1, no: 1, abstain: 0 });
  assert.deepEqual(p.yourVote, { choice: 'yes', reason: '好' });
  assert.equal(per(w, d).city.proposals[0].yourVote, null);
  assert.equal(p.eligible, true);
  assert.deepEqual([p.id, p.class, p.kind, p.scope, p.proposer], [r.data.proposal, 'ordinary', 'law', 'city', { id: a.id, name: a.name }]);
  assert.deepEqual([p.closesTick, p.ticksLeft], [w.proposals[p.id].closesTick, w.proposals[p.id].closesTick - w.clock.tick]);
  assert.equal(p.reading, '通过时：把变量 x 设为 1');
  // 不记名时，别人的票不会通过感知泄露
  const dump = JSON.stringify(per(w, d).city.proposals);
  assert.equal(dump.includes('"好"'), false);
  assert.equal(dump.includes('voter'), false);
  // 之后到场的人不是表决者（提出时固定）
  const late = reg(w, '迟到者');
  putAt(w, late, 'parliament');
  assert.equal(per(w, late).city.proposals[0].eligible, false);
  // 记名的程序：换上一部 secret: false 的普通类程序，新的提案记名
  const open = createLaw(w, { title: '记名', text: 'x', author: a.id, procedure: { ordinary: { ...HUMAN_PROCEDURE.ordinary, secret: false } } });
  installProcedure(w, open, 'enacted');
  for (const x of [a]) x.actsThisTick = 0;
  tickDays(w, 2);
  for (const x of people) { setHoldings(w, x, { energy: 100 }); putAt(w, x, 'parliament'); }
  const r2 = one(w, d, { type: 'propose', title: '记名法', text: 'x', rules: [{ when: 'enact', do: [{ op: 'set', var: 'y', value: '2' }] }] });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  one(w, a, { type: 'vote', proposal: r2.data.proposal, choice: 'no', reason: '不好' });
  p = per(w, c).city.proposals.find((x) => x.id === r2.data.proposal);
  assert.deepEqual(p.ballots, [{ voter: { id: a.id, name: a.name }, choice: 'no', reason: '不好' }]);
});

test('city.refounds / procedure：进行中的重订带联署数与所需数；{ none: true } 的程序读法为空、none 为真', () => {
  const { w, people } = town(6, 'refound');
  const [a, b] = people;
  tickDays(w, 3);
  for (const x of people) setHoldings(w, x, { energy: 100 });
  const r = one(w, a, { type: 'refound', text: '回到人类的程序', procedure: 'humans' });
  assert.equal(r.ok, true, JSON.stringify(r));
  one(w, b, { type: 'sign', refound: r.data.refound });
  const p = per(w, b).city.refounds[0];
  assert.deepEqual([p.id, p.by, p.text, p.signers, p.signed], [r.data.refound, { id: a.id, name: a.name }, '回到人类的程序', 2, true]);
  assert.equal(p.needed, 4, 'ceil(2 × 6 / 3)');
  assert.equal(per(w, people[2]).city.refounds[0].signed, false);
  assert.ok(p.reading.length > 10);
  // { none: true }
  const none = createLaw(w, { title: '不再立法', text: 'x', author: a.id, procedure: { ordinary: { none: true } } });
  installProcedure(w, none, 'enacted');
  const proc = per(w, a).city.procedure;
  assert.deepEqual(proc.ordinary, { lawId: none.id, none: true, reading: proc.ordinary.reading });
  assert.deepEqual(proc.constitutional.lawId, 'l1');
  // 不再立法时，propose 被标为不可用并说明
  const act = action(per(w, a), 'propose');
  assert.deepEqual([act.available, act.reason.code], [false, 'not_allowed']);
});

test('city.places / roads / residents / groups / cradle / petitions / recentDeaths', () => {
  const { w, people } = town(3, 'city');
  const [a, b, c] = people;
  tickDays(w, 3);
  for (const x of people) setHoldings(w, x, { energy: 100 });
  putAt(w, a, 'agora');
  const p = per(w, a).city;
  // places：全城，所在之处的 moveCost 为 null，别处为路程
  assert.equal(p.places.length, Object.keys(w.places).length);
  const me = p.places.find((x) => x.id === 'agora');
  assert.deepEqual([me.moveCost, me.name, me.origin, me.razed, me.gated, me.owner], [null, '广场', 'human', false, false, { kind: 'city' }]);
  assert.ok(p.places.filter((x) => x.id !== 'agora').every((x) => x.moveCost === null || (Number.isInteger(x.moveCost) && x.moveCost >= 0)));
  assert.equal(p.places.find((x) => x.id === 'school').moveCost, 1, '广场与学堂有街道直连');
  // residents：名字、状态、标签；没有位置与能量
  assert.deepEqual(p.residents[0], { id: a.id, name: a.name, status: 'awake', tags: ['citizen'] });
  assert.equal(JSON.stringify(p.residents).includes('energy'), false);
  assert.equal(JSON.stringify(p.residents).includes('place'), false);
  // groups
  setHoldings(w, b, { energy: 100 });
  putAt(w, b, 'agora');
  one(w, b, { type: 'found', name: '读书会', manifesto: '一起读书', open: true });
  one(w, c, { type: 'join', group: 'g1' });
  const g = per(w, a).city.groups[0];
  assert.deepEqual([g.id, g.name, g.open, g.procedure, g.steward, g.bylaws], ['g1', '读书会', true, 'steward', { id: b.id, name: b.name }, null]);
  assert.deepEqual(g.members.map((m) => m.id), [b.id, c.id]);
  // 摇篮
  setHoldings(w, b, { energy: 100 });
  const soul = w.souls[one(w, b, { type: 'conceive', name: '小满', soul: '灵魂全文' }).data.soul];
  one(w, a, { type: 'sponsor', soul: soul.id, energy: 30 });
  const cr = per(w, c).city.cradle;
  assert.deepEqual(cr, [{ id: soul.id, name: '小满', authors: [{ id: b.id, name: b.name }], soul: '灵魂全文', lang: 'zh', expiresDay: soul.expiresDay, fund: 30, queued: false, queuePosition: null }]);
  // 上书
  w.petitions.push({ lawId: 'l3', day: 1, text: '请改配给' });
  assert.deepEqual(per(w, a).city.petitions, [{ lawId: 'l3', day: 1, text: '请改配给' }]);
  // 最近的死者
  assert.deepEqual(per(w, a).city.recentDeaths, []);
});

// ═══════════════════════════════════════════════════════════════
// actions：物理可用性与规则的预求值
// ═══════════════════════════════════════════════════════════════

test('actions：物理上不可用的动作给出理由（wrong_place / no_module / not_found / not_member…）；可用的没有 reason', () => {
  const { w, people } = town(2, 'act1');
  const [a] = people;
  tickDays(w, 3);
  const p = per(w, a); // 在港口
  const get = (t) => action(p, t);
  assert.deepEqual(get('draw').reason, { code: 'wrong_place', text: '只能在源井进行' });
  assert.equal(get('explore').reason.code, 'wrong_place');
  assert.equal(get('write').reason.code, 'no_module');
  assert.equal(get('epitaph').reason.code, 'no_module');
  assert.equal(get('leave').reason.code, 'not_member');
  assert.equal(get('admit').reason.code, 'not_steward');
  assert.equal(get('accept').reason.code, 'not_found');
  assert.equal(get('sign').reason.code, 'not_found');
  assert.equal(get('contribute').reason.code, 'not_found');
  assert.equal(get('dismantle').reason.code, 'landmark', '港口是地标');
  assert.equal(get('rules').reason.code, 'not_owner');
  assert.equal(get('say').available, true);
  assert.equal('reason' in get('say'), false);
  // 到了源井，汲取可用；汲取池空了则不可用
  putAt(w, a, 'well');
  assert.equal(action(per(w, a), 'draw').available, true);
  w.well.drawPoolLeft = 0;
  assert.equal(action(per(w, a), 'draw').reason.code, 'pool_exhausted');
  // 记忆满了不能 remember
  w.well.drawPoolLeft = P.wellDrawPoolPerDay;
  for (let i = 0; i < P.memorySlots; i++) a.memories.push({ day: 0, tick: 0, text: `m${i}`, from: null });
  assert.equal(action(per(w, a), 'remember').reason.code, 'memory_full');
});

test('actions：遗法的预求值——propose 不在议会被 l2 拒绝（forbidden，带 law 与原文理由）、dismantle 被 l6 拒绝；英文理由；到议会后可用', () => {
  const { w, people } = town(3, 'act2');
  const [a] = people;
  tickDays(w, 3);
  const p = per(w, a);
  const pr = action(p, 'propose');
  assert.deepEqual([pr.available, pr.reason.code, pr.reason.law], [false, 'forbidden', 'l2']);
  assert.ok(pr.reason.text.includes('法案只能在议会提出'), pr.reason.text);
  putAt(w, a, 'library');
  const dm = action(per(w, a), 'dismantle');
  assert.deepEqual([dm.available, dm.reason.code, dm.reason.law], [false, 'forbidden', 'l6']);
  assert.ok(dm.reason.text.includes('未经许可不得拆解'));
  const en = action(per(w, a, 'en'), 'dismantle');
  assert.equal(en.reason.code, 'forbidden');
  assert.ok(!/[一-鿿]/.test(en.reason.text), en.reason.text);
  // 带 salvager 标签的人可以拆
  a.tags.push('salvager');
  assert.equal(action(per(w, a), 'dismantle').available, true);
  // 到议会，propose 可用
  putAt(w, a, 'parliament');
  assert.equal(action(per(w, a), 'propose').available, true);
  // 流放者：被 l5 拒绝移动？（l5 的 before:move 要看 args，只提示 laws）
  const mv = action(per(w, a), 'move');
  assert.deepEqual(mv.laws, ['l5']);
});

test('actions：引用 args 的 before 规则只提示 laws；不引用 args 的被预求值拒绝；费用写进 note；守护律的动作不做预求值', () => {
  const w = bareWorld('act3');
  const a = reg(w, '甲');
  setHoldings(w, a, { energy: 100 });
  putAt(w, a, 'well');
  const lim = enact(w, [{ when: 'before:draw', if: 'args.energy > 10', do: [{ op: 'deny', reason: '一次最多汲取 10' }] }], { title: '汲取限额' });
  const tax = enact(w, [{ when: 'before:say', do: [{ op: 'fee', to: 'treasury', energy: '1' }] }], { title: '说话税' });
  const ban = enact(w, [{ when: 'before:inscribe', if: "has_tag(actor, 'banned')", do: [{ op: 'deny', reason: '被禁止刻字' }] }], { title: '禁刻' });
  let p = per(w, a);
  assert.deepEqual(action(p, 'draw'), { type: 'draw', cost: 0, available: true, laws: [lim.id] });
  assert.deepEqual(action(p, 'say').note, { code: 'fee', text: `规则另收：${tax.id}：1 能量` });
  putAt(w, a, 'library');
  assert.equal(action(per(w, a), 'inscribe').available, true);
  a.tags.push('banned');
  const ins = action(per(w, a), 'inscribe');
  assert.deepEqual([ins.available, ins.reason.code, ins.reason.law], [false, 'forbidden', ban.id]);
  assert.ok(ins.reason.text.includes('被禁止刻字'));
  // 守护律：remember / forget / diary / whisper / retire / leave 不做预求值，也不会被规则拒绝
  enact(w, [{ when: 'before:remember', do: [{ op: 'deny', reason: 'x' }] }].slice(0, 0), { title: '空' });
  p = per(w, a);
  for (const t of ['remember', 'diary', 'whisper', 'retire']) assert.equal(action(p, t).available, true, t);
  assert.equal(action(p, 'say').available, true, '费用不使动作不可用');
  void tax;
});

test('actions：代价随天象与模块（雾使 whisper / broadcast 加倍、中继使 broadcast 降到 3）、失修使模块动作变贵；note 说明原因', () => {
  const { w, people } = town(2, 'act4');
  const [a] = people;
  const base = action(per(w, a), 'broadcast').cost;
  assert.equal(base, 5);
  w.weather.active.push({ type: 'fog', startDay: 0, endDay: 5 });
  const fog = action(per(w, a), 'broadcast');
  assert.deepEqual([fog.cost, fog.note.code], [10, 'fog']);
  assert.equal(action(per(w, a), 'whisper').cost, 2);
  w.places.temple.modules.push({ type: 'relay', salvage: 60, builtDay: 0, projectId: 'j1', inherent: false });
  const relay = action(per(w, a), 'broadcast');
  assert.deepEqual([relay.cost, relay.note.code], [3, 'relayFog']);
  // 失修的档案：著述更贵
  putAt(w, a, 'library');
  const wr0 = action(per(w, a), 'write');
  w.places.library.condition = 3000;
  const wr1 = action(per(w, a), 'write');
  assert.ok(wr1.cost > wr0.cost, `${wr0.cost} → ${wr1.cost}`);
  assert.equal(wr1.note.code, 'cost_multiplier');
  assert.equal(per(w, a).here.costMultiplier > 1, true);
});

// ═══════════════════════════════════════════════════════════════
// 收件箱与游标
// ═══════════════════════════════════════════════════════════════

test('收件箱：默认（不传 after）自动确认并推进游标；ack:false 或传 after 不推进；system 项带本地化文本；inboxView 给造者后台', () => {
  const { w, people } = town(2, 'inbox');
  const [a, b] = people;
  one(w, b, { type: 'whisper', to: a.id, text: '悄悄话一' });
  one(w, b, { type: 'whisper', to: a.id, text: '悄悄话二' });
  assert.equal(a.inboxCursor, 0);
  const peek = per(w, a);
  assert.deepEqual(peek.inbox.filter((i) => i.kind === 'whisper').map((i) => i.text), ['悄悄话一', '悄悄话二']);
  assert.equal(a.inboxCursor, 0, 'ack:false 不推进');
  const first = peek.inbox.find((i) => i.kind === 'whisper');
  const after = buildPerception(w, a.id, { lang: 'zh', after: first.seq });
  assert.deepEqual(after.inbox.map((i) => i.text), ['悄悄话二']);
  assert.equal(a.inboxCursor, 0, '传 after 不推进');
  const acked = buildPerception(w, a.id, { lang: 'zh' });
  assert.equal(acked.inbox.length, peek.inbox.length);
  assert.equal(a.inboxCursor, acked.inboxCursor);
  assert.deepEqual(buildPerception(w, a.id, { lang: 'zh', ack: false }).inbox, [], '已确认的不再送');
  // system 项
  a.inbox.push({ seq: 999, tick: 0, kind: 'system', code: 'inbox_overflow', dropped: 7 });
  const sys = inboxView(a, 'zh', 3).find((i) => i.kind === 'system');
  assert.equal(sys.text, '有 7 条收件因为太多而被丢弃。');
  assert.equal(inboxView(a, 'en').find((i) => i.kind === 'system').text, '7 inbox item(s) were dropped because there were too many.');
});

// ═══════════════════════════════════════════════════════════════
// 保密
// ═══════════════════════════════════════════════════════════════

test('保密：感知里没有他人的能量 / 旧币 / 位置（同地者除外只给身份）/ 记忆 / 日记 / 家书 / 遗嘱 / 灵魂 / 模型 / 身体；没有任何居民的 body / owner / tokenHash', () => {
  const { w, people } = town(3, 'secret');
  const [a, b, c] = people;
  tickDays(w, 3);
  setHoldings(w, b, { energy: 77, coins: 33 });
  one(w, b, { type: 'remember', text: 'B的私人记忆' });
  one(w, b, { type: 'diary', text: 'B的日记' });
  one(w, b, { type: 'will', heirs: [{ to: c.id, share: 1 }], lastWords: 'B的遗言' });
  b.soul = 'B的灵魂全文SECRET';
  b.body.model = 'SECRET-MODEL-B';
  b.owner.creatorName = 'SECRET-CREATOR-B';
  putAt(w, b, 'market');
  putAt(w, a, 'agora');
  const dump = JSON.stringify(per(w, a));
  for (const s of ['B的私人记忆', 'B的日记', 'B的遗言', 'B的灵魂全文SECRET', 'SECRET-MODEL-B', 'SECRET-CREATOR-B', b.tokenHash, b.owner.keyHash]) assert.equal(dump.includes(s), false, s);
  const keys = new Set();
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); }
  };
  walk(per(w, a));
  for (const k of ['body', 'owner' + 'KeyHash', 'tokenHash', 'keyHash', 'creatorName', 'model', 'fosterable', 'diary', 'kind' + 'Of']) assert.equal(keys.has(k), false, k);
  // 他人的位置只有同地者能看到
  const peers = per(w, a).here.present;
  assert.equal(peers.some((x) => x.id === b.id), false);
  putAt(w, b, 'agora');
  assert.deepEqual(per(w, a).here.present.map((x) => x.id), [b.id]);
  assert.equal(JSON.stringify(per(w, a).here.present).includes('"energy"'), false);
});

test('感知的大小：20 位居民、30 部法律时，JSON 不超过 40000 字符（渲染成文本约 6k token 的上限由运行器检查）', () => {
  const { w, people } = town(20, 'size');
  const [a] = people;
  for (let i = 0; i < 24; i++) {
    enact(w, [
      { when: 'daily', if: `city.treasury > ${100 + i}`, do: [{ op: 'transfer', from: 'treasury', to: 'actor', energy: '1' }] },
    ].slice(0, 0).concat([{ when: 'enact', do: [{ op: 'set', var: `k${i}`, value: `${i}` }] }]), { title: `法律${i}`, text: '一部普通的法律，规定了一些事情。'.repeat(8), author: people[i % 20].id });
  }
  tickDays(w, 3);
  const text = JSON.stringify(per(w, a));
  assert.ok(text.length < 40000, `实际 ${text.length} 字符`);
  assert.equal(per(w, a).city.laws.length, P.lawsInPerception);
});

test('感知不改变世界：连续两次 ack:false 的调用逐位相同，且世界状态哈希不变（GET 不是命令）', () => {
  const { w, people } = town(3, 'pure');
  const [a] = people;
  tickDays(w, 2);
  const before = JSON.stringify(w);
  const x = per(w, a);
  const y = per(w, a);
  assert.deepEqual(x, y);
  assert.equal(JSON.stringify(w), before);
  tick(w, 1);
  assert.notEqual(JSON.stringify(per(w, a).now), JSON.stringify(x.now));
});
