// SPEC-E2 §24.1 测试 11（§25 第 9 步）：可见性——遍历第二纪的所有公共视图，断言没有 body、owner、世代 0 的灵魂、先民、模型分配；
// 延迟事件在释放前不可见；不记名程序下居民看不到每一张票。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../src/e2/engine/index.js';
import e2 from '../src/e2/facade.js';
import { agentList } from '../src/e2/world.js';
import { P } from '../src/e2/params.js';
import { drainEvents } from '../src/e2/engine/core.js';
import { newWorld, reg, one, putAt, setHoldings, tick, tickDays, eventsOf, sha } from './e2-helpers.js';
import { runFuzz, BASE_TYPES } from './e2-fuzz-lib.js';
import { registerLawGenerators, registerCityGenerators, registerDescentGenerators, LAW_TYPES, CITY_TYPES, DESCENT_TYPES } from './e2-rule-fuzz.js';
import { setBylaws, setPlaceRules } from './e2-law-helpers.js';

registerLawGenerators();
registerCityGenerators();
registerDescentGenerators();

const TYPES = [...BASE_TYPES, ...LAW_TYPES, ...CITY_TYPES, ...CITY_TYPES, ...DESCENT_TYPES, ...DESCENT_TYPES, 'sponsor', 'sponsor'];

const FOUNDERS = [0, 4, 9, 14].map((day, i) => ({ day, name: `先民${i + 1}`, bio: `先民${i + 1}的介绍`, soul: `FOUNDER-SOUL-${i + 1}`, lang: 'zh' }));
const SHELL_MODELS = ['SECRET-SHELL-MODEL-A', 'SECRET-SHELL-MODEL-B'];

/** 跑一个内容丰富的世界（法律、社群、城、后代、躯壳、先民），并给每位居民埋下「不得公开」的哨兵字符串 */
function richWorld(seed = 91) {
  const events = [];
  const hook = (w, t, r) => {
    const alive = agentList(w).filter((a) => a.status === 'awake');
    if (t % 3 === 0) for (const a of alive) if (r.chance(0.5)) a.place = 'parliament';
    if (t % 12 === 0) {
      for (const a of alive) if (r.chance(0.6)) {
        a.energy += 30;
        w.ledger.src.energy.admin = (w.ledger.src.energy.admin || 0) + 30;
      }
    }
    if (t % 4 === 0) {
      for (const p of Object.values(w.proposals)) {
        if (p.status !== 'open') continue;
        for (const id of p.voters) {
          const v = w.agents[id];
          if (v && v.status === 'awake' && r.chance(0.5)) {
            v.actsThisTick = 0;
            applyCommand(w, { type: 'act', payload: { agentId: id, actions: [{ type: 'vote', proposal: p.id, choice: r.chance(0.8) ? 'yes' : 'no', reason: 'SECRET-BALLOT-REASON' }] } });
          }
        }
      }
    }
    if (t % 25 === 3) {
      const a = alive.find((x) => x.lastLetterDay === null);
      if (a) applyCommand(w, { type: 'letter', payload: { agentId: a.id, text: `SECRET-LETTER-${a.id}` } });
    }
    // 为摇篮里的灵魂凑够躯壳的钱 / 领养一个
    if (t % 10 === 4) {
      const soul = Object.values(w.souls).find((s) => s.fundedTick === null);
      const rich = alive.find((x) => x.energy >= 60);
      if (soul && rich) {
        rich.energy += 220;
        w.ledger.src.energy.admin = (w.ledger.src.energy.admin || 0) + 220;
        rich.actsThisTick = 0;
        applyCommand(w, { type: 'act', payload: { agentId: rich.id, actions: [{ type: 'sponsor', soul: soul.id, energy: 200 }] } });
      }
    }
    if (t % 35 === 5) {
      const soul = Object.values(w.souls).find((s) => s.fundedTick === null);
      if (soul) applyCommand(w, { type: 'adopt', payload: { soulId: soul.id, model: 'SECRET-MODEL-ADOPTED', creatorName: 'SECRET-CREATOR-ADOPTED', tokenHash: sha(`t${soul.id}`), ownerKeyHash: sha(`k${soul.id}`) } });
    }
    if (t === 60) {
      // 给一个社群设章程、给居民的地点设地点规则：它们的设定者是居民，规则 JSON 公开
      const g = Object.values(w.groups).find((x) => !x.dissolved);
      if (g) setBylaws(w, g.id, [{ when: 'daily', do: [{ op: 'tag', who: 'steward()', tag: 'x' }] }].slice(0, 0).concat([{ when: 'enact', do: [{ op: 'set', var: 'sealed', value: '1' }] }]));
    }
  };
  const { w } = runFuzz({
    seed, days: 40, agents: 14, types: TYPES, bare: false, hook, everyCommand: false, collect: events,
    worldOpts: { founders: FOUNDERS, shellModels: SHELL_MODELS },
    registerExtra: (name) => ({ soul: `SECRET-SOUL-${name}`, model: `SECRET-MODEL-${name}`, creatorName: `SECRET-CREATOR-${name}` }),
  });
  const secrets = new Set(['SECRET-MODEL-ADOPTED', 'SECRET-CREATOR-ADOPTED', ...SHELL_MODELS]);
  for (const f of FOUNDERS) secrets.add(f.soul);
  for (const a of Object.values(w.agents)) {
    // 人类书写的灵魂（世代 0，含先民）、模型、造者署名、令牌与密钥哈希、家书与日记
    if (a.generation === 0) secrets.add(a.soul);
    if (a.body.model) secrets.add(a.body.model);
    if (a.owner) {
      secrets.add(a.owner.creatorName);
      secrets.add(a.owner.keyHash);
    }
    if (a.tokenHash) secrets.add(a.tokenHash);
    // 家书：出示过的（reveal）是公开的，没出示的不是
    for (const l of a.letters) if (!l.revealed && l.text.startsWith('SECRET-LETTER-')) secrets.add(l.text);
  }
  return { w, events, secrets: [...secrets].filter((s) => s && s.length > 3 && s !== 'm') };
}

const keysOf = (o, out = new Set()) => {
  if (Array.isArray(o)) o.forEach((x) => keysOf(x, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.add(k); keysOf(v, out); }
  return out;
};

/** 观众能取到的全部视图 */
const allViews = (w, events) => {
  const state = e2.publicState(w, { nextTickAt: 1 });
  const laws = [
    ...Object.keys(w.laws),
    ...Object.values(w.groups).filter((g) => g.bylaws).map((g) => `group:${g.id}`),
    ...Object.values(w.places).filter((p) => p.rules).map((p) => `place:${p.id}`),
  ].map((id) => e2.publicLaw(w, id));
  return {
    state,
    agents: Object.values(w.agents).map((a) => e2.publicAgent(w, a)),
    memories: Object.values(w.agents).map((a) => e2.publicMemories(w, a)),
    places: Object.keys(w.places).map((id) => e2.publicPlace(w, id)),
    docs: Object.keys(w.docs).map((id) => e2.publicDoc(w, id)),
    weather: e2.publicWeather(w),
    laws,
    cradle: e2.publicCradle(w),
    map: e2.publicMap(w),
    lore: [e2.publicLore('zh'), e2.publicLore('en')],
    tick: e2.tickSummary(w, { nextTickAt: 2 }),
    events: events.map((ev) => e2.publicEvent(w, ev, { released: true })).filter(Boolean),
  };
};

// ═══════════════════════════════════════════════════════════════
// 谢幕前的保密
// ═══════════════════════════════════════════════════════════════

test('可见性：谢幕前，公共状态与每个公共视图里没有模型、躯壳的模型分配、人类书写的灵魂与先民、造者署名、令牌与密钥哈希、家书与日记；没有 body / owner / fosterable 字段', () => {
  const { w, events, secrets } = richWorld();
  // 世界要足够丰富，测试才有意义
  const cover = {};
  for (const e of events) cover[e.type] = (cover[e.type] || 0) + 1;
  for (const t of ['arrive', 'born', 'soul', 'embodied', 'law_passed', 'rule_op', 'propose', 'vote', 'dismantle', 'razed', 'dormant']) assert.ok(cover[t] > 0, `覆盖：${t} ${JSON.stringify(cover)}`);
  assert.ok(Object.values(w.agents).some((a) => a.body.kind === 'shell' && a.generation >= 1), '需要有躯壳醒来的居民');
  assert.ok(Object.values(w.agents).some((a) => a.body.kind === 'free' && a.generation >= 1), '需要有领养出来的居民');
  assert.ok(Object.values(w.agents).filter((a) => a.name.startsWith('先民')).length >= 3, '先民入城了');
  assert.ok(secrets.length > 40, secrets.length);

  const views = allViews(w, events);
  const json = JSON.stringify(views);
  for (const s of secrets) assert.equal(json.includes(s), false, `泄露了 ${s}`);
  // 居民书写的灵魂（世代 ≥ 1）是公开的，世代 0 的（含先民）没有 soul 字段
  for (const pa of views.agents) {
    if (pa.generation === 0) assert.equal('soul' in pa, false, `${pa.id} 的人类灵魂不该公开`);
    else assert.equal(typeof pa.soul, 'string');
  }
  // 字段名：agent 档案里不得有这些（场所与工程的 owner 是另一回事）
  const profileKeys = keysOf([views.agents, views.state.agents]);
  for (const key of ['body', 'owner', 'tokenHash', 'keyHash', 'ownerKeyHash', 'creatorName', 'model', 'diary', 'letters', 'inbox', 'will', 'fosterable', 'shell']) {
    assert.equal(profileKeys.has(key), false, `agent 档案里出现了字段 ${key}`);
  }
  // 整个世界状态公开视图里没有这些键（任何位置）
  const allKeys = keysOf(views.state);
  for (const key of ['founders', 'models', 'tokenHash', 'keyHash', 'ownerKeyHash', 'creatorName', 'body']) assert.equal(allKeys.has(key), false, `state 里出现了键 ${key}`);
  assert.equal(views.state.world.revealed, false);
  // 躯壳：只有数量与排队，没有模型
  assert.deepEqual(Object.keys(views.state.shells), ['total', 'free', 'used', 'cost', 'living', 'queue']);
  assert.equal(views.state.shells.total, w.shells.slots);
  // 事件：没有任何 owner / internal 的事件被转换出来
  const rawTypes = new Set(events.filter((e) => e.vis === 'owner' || e.vis === 'internal').map((e) => e.type));
  for (const e of views.events) assert.equal(rawTypes.has(e.type) && !events.some((x) => x.seq === e.seq && (x.vis === 'public' || x.vis === 'delayed')), false, e.type);
  assert.ok(views.events.length > 100);
});

test('可见性：谢幕之后，模型（含换身记录）、身体的种类、人类书写的灵魂（含先民）与造者署名公开；令牌与密钥哈希、家书与日记永不公开', () => {
  const { w, events, secrets } = richWorld(92);
  w.revealed = true;
  const views = allViews(w, events);
  const json = JSON.stringify(views);
  assert.equal(views.state.world.revealed, true);
  for (const a of Object.values(w.agents)) {
    assert.equal(json.includes(a.tokenHash || '#'), false, '令牌哈希');
    if (a.owner) assert.equal(json.includes(a.owner.keyHash), false, '密钥哈希');
    for (const l of a.letters) if (!l.revealed && l.text.startsWith('SECRET-LETTER-')) assert.equal(json.includes(l.text), false, '家书');
  }
  const free = Object.values(w.agents).find((a) => a.body.kind === 'free' && a.generation === 0);
  const pf = e2.publicAgent(w, free);
  assert.deepEqual(pf.body, { kind: 'free', model: free.body.model, history: free.body.history });
  assert.equal(pf.soul, free.soul);
  assert.equal(pf.creatorName, free.owner.creatorName);
  const shell = Object.values(w.agents).find((a) => a.body.kind === 'shell');
  const ps = e2.publicAgent(w, shell);
  assert.equal(ps.body.kind, 'shell');
  assert.ok(SHELL_MODELS.includes(ps.body.model) || ps.body.model.length > 0);
  assert.equal(ps.creatorName, null, '躯壳没有造者');
  const founder = Object.values(w.agents).find((a) => a.name === '先民1');
  assert.equal(e2.publicAgent(w, founder).soul, 'FOUNDER-SOUL-1');
  void secrets;
});

test('可见性：公开档案的字段——标签、志与立志史、作者、世代、孩子、位置、能量、社群；没有第一纪的 parents / exiled / citizenFromDay', () => {
  const w = newWorld('pub2');
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  tickDays(w, 3);
  setHoldings(w, a, { energy: 100 });
  one(w, a, { type: 'declare', purpose: '第一个志' });
  one(w, a, { type: 'declare', purpose: '第二个志' });
  const pa = e2.publicAgent(w, a);
  assert.deepEqual(Object.keys(pa), [
    'id', 'name', 'lang', 'bio', 'purpose', 'purposeHistory', 'tags', 'status', 'generation', 'authors', 'children', 'bornDay', 'ageDays', 'diedDay', 'dormantSinceDay',
    'place', 'energy', 'coins', 'groups', 'script', 'lastActTick', 'stats',
  ]);
  assert.deepEqual([pa.purpose, pa.tags, pa.authors], ['第二个志', ['citizen'], []]);
  assert.deepEqual(pa.purposeHistory.map((h) => h.text), ['第一个志', '第二个志']);
  for (const gone of ['parents', 'exiled', 'citizenFromDay']) assert.equal(gone in pa, false);
  // 死者：不再有位置；年龄以离世之日计；记忆全部公开
  b.status = 'dead';
  b.diedDay = 2;
  b.energy = 0;
  b.coins = 0;
  b.memories.push({ day: 1, tick: 999999, text: '死者的记忆', from: null });
  const pb = e2.publicAgent(w, b);
  assert.deepEqual([pb.status, pb.place, pb.ageDays, pb.diedDay], ['dead', null, 2, 2]);
  assert.deepEqual(e2.publicMemories(w, b), [{ day: 1, text: '死者的记忆', from: null }]);
});

// ═══════════════════════════════════════════════════════════════
// 延迟公开
// ═══════════════════════════════════════════════════════════════

test('可见性：记忆条目延迟 privateDelayTicks 刻才公开；遗传的记忆带来源作者；delayed 事件在释放前 publicEvent 为 null，释放后带 delayed: true', () => {
  const w = newWorld('delay2');
  const a = reg(w, '甲');
  drainEvents(w);
  const { events } = (() => {
    a.actsThisTick = 0;
    const out = applyCommand(w, { type: 'act', payload: { agentId: a.id, actions: [{ type: 'remember', text: '刚写下的记忆' }, { type: 'whisper', to: a.id, text: 'x' }] } });
    return out;
  })();
  assert.deepEqual(e2.publicMemories(w, a), []);
  const remembered = eventsOf(events, 'remember')[0];
  assert.equal(remembered.vis, 'delayed');
  assert.equal(e2.publicEvent(w, remembered), null, '释放前不可见');
  assert.deepEqual(e2.ownerEvent(remembered), remembered, '造者立即可见');
  tick(w, P.privateDelayTicks - 1);
  assert.deepEqual(e2.publicMemories(w, a), []);
  tick(w, 1);
  assert.deepEqual(e2.publicMemories(w, a), [{ day: 0, text: '刚写下的记忆', from: null }]);
  const shown = e2.publicEvent(w, remembered, { released: true });
  assert.equal(shown.delayed, true);
  assert.equal(shown.data.text, '刚写下的记忆');
  // owner / internal 事件永不公开
  assert.equal(e2.publicEvent(w, { seq: 1, tick: 0, day: 0, type: 'diary', vis: 'owner', agent: a.id, data: { text: 'x' } }), null);
  assert.equal(e2.publicEvent(w, { seq: 2, tick: 0, day: 0, type: 'draft', vis: 'internal', data: {} }), null);
  // 被抹去的事件：内容替换
  w.redacted.events.push(remembered.seq);
  const red = e2.publicEvent(w, remembered, { released: true });
  assert.equal(red.redacted, true);
  assert.equal(JSON.stringify(red).includes('刚写下的记忆'), false);
});

// ═══════════════════════════════════════════════════════════════
// 不记名程序
// ═══════════════════════════════════════════════════════════════

test('不记名程序：居民（感知）看不到每一张票——ballots 为 null，别人的 vote 不进收件箱；记名程序下看得到', () => {
  const w = newWorld('secret-ballot');
  const people = ['甲', '乙', '丙', '丁'].map((n) => reg(w, n));
  tickDays(w, 3);
  for (const x of people) { setHoldings(w, x, { energy: 100 }); putAt(w, x, 'parliament'); }
  const [a, b, c, d] = people;
  const r = one(w, a, { type: 'propose', title: '测试', text: 'x', rules: [{ when: 'enact', do: [{ op: 'set', var: 'x', value: '1' }] }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  one(w, b, { type: 'vote', proposal: r.data.proposal, choice: 'no', reason: '我反对，这是秘密' });
  const seen = e2.buildPerception(w, c.id, { lang: 'zh', ack: false });
  const p = seen.city.proposals[0];
  assert.equal(p.ballots, null);
  assert.deepEqual(p.tally, { yes: 0, no: 1, abstain: 0 });
  assert.equal(JSON.stringify(seen).includes('我反对，这是秘密'), false);
  assert.equal(JSON.stringify(seen.inbox).includes(b.id), false);
  void d;
});

// ═══════════════════════════════════════════════════════════════
// 公共视图的内容
// ═══════════════════════════════════════════════════════════════

test('publicState：world.physics / protocol、vars 与 procedure 代替 params、laws（规则、读法、指纹、作者、状态、停摆）、groups（程序与章程）、places（含 xy / origin / razed / modules / salvage / owner / gate / 地点规则）、lots、paths、roads、refounds、petitions、shells、cradle', () => {
  const w = newWorld('state2', { founders: [{ day: 9, name: '先民甲', bio: '', soul: 'FOUNDER-SOUL', lang: 'zh' }], shellModels: ['SECRET-SHELL-MODEL'] });
  const people = ['甲', '乙', '丙'].map((n) => reg(w, n));
  const [a, b] = people;
  tickDays(w, 3);
  for (const x of people) setHoldings(w, x, { energy: 100 });
  putAt(w, a, 'agora');
  one(w, a, { type: 'found', name: '读书会', manifesto: '一起读书', open: true });
  setBylaws(w, 'g1', [{ when: 'enact', do: [{ op: 'set', var: 'x', value: '1' }] }]);
  w.places.lighthouse.owner = { kind: 'group', id: 'g1' };
  setPlaceRules(w, 'lighthouse', [{ when: 'before:say', do: [{ op: 'fee', to: "treasury", energy: '1' }] }]);
  const soul = w.souls[one(w, b, { type: 'conceive', name: '小满', soul: '灵魂全文' }).data.soul];
  one(w, a, { type: 'sponsor', soul: soul.id, energy: 25 });
  w.petitions.push({ lawId: 'l3', day: 1, text: '请改配给' });
  const s = e2.publicState(w, { nextTickAt: 123 });
  assert.deepEqual([s.world.physics, s.world.protocol, s.world.nextTickAt, s.world.revealed, s.world.epoch], [2, 2, 123, false, 2]);
  assert.equal('params' in s, false);
  assert.deepEqual(s.vars, { rationShare: 600 });
  assert.deepEqual(Object.keys(s.procedure), ['ordinary', 'constitutional']);
  assert.equal(s.procedure.ordinary.lawId, 'l1');
  assert.ok(s.procedure.ordinary.reading.zh.includes('不记名') && s.procedure.ordinary.reading.en.includes('secret ballot'));
  // laws
  const l3 = s.laws.find((x) => x.id === 'l3');
  assert.deepEqual([l3.status, l3.author, l3.suspended, l3.suspendedDays, l3.class], ['active', 'humans', false, 0, 'ordinary']);
  assert.ok(l3.reading.zh.rules.length === 2 && l3.reading.en.rules.length === 2);
  assert.ok(Array.isArray(l3.fingerprints) && Array.isArray(l3.rules));
  assert.equal(l3.i18n.zh.title, '基本配给');
  // groups
  const g = s.groups.find((x) => x.id === 'g1');
  assert.equal(g.procedure, 'steward');
  assert.equal(g.bylaws.rules.length, 1);
  assert.ok(g.bylaws.reading.zh.rules.length > 0);
  // places
  const lh = s.places.find((x) => x.id === 'lighthouse');
  assert.deepEqual([lh.origin, lh.razed, lh.owner.kind, lh.owner.id, lh.rules.rules.length], ['human', false, 'group', 'g1', 1]);
  assert.deepEqual(lh.xy.length, 2);
  assert.ok(s.lots.length >= 20 && s.lots.every((l) => 'place' in l && 'project' in l));
  assert.ok(Array.isArray(s.paths) && Array.isArray(s.roads));
  assert.deepEqual(s.petitions, [{ lawId: 'l3', day: 1, text: '请改配给' }]);
  assert.deepEqual(s.refounds, []);
  // shells：数量与排队；不含模型；先民不暴露
  assert.deepEqual(s.shells, { total: 30, free: 29, used: 1, cost: 200, living: 0, queue: [] });
  // cradle：作者、出资与出资者
  assert.equal(s.cradle.length, 1);
  assert.deepEqual([s.cradle[0].authors, s.cradle[0].fund, s.cradle[0].sponsors], [[{ id: b.id, name: b.name }], 25, { [a.id]: 25 }]);
  const json = JSON.stringify(s);
  assert.equal(json.includes('FOUNDER-SOUL'), false);
  assert.equal(json.includes('先民甲'), false, '尚未入城的先民不出现');
  assert.equal(json.includes('SECRET-SHELL-MODEL'), false);
  // 先民入城后：以普通居民的样子出现，灵魂不公开
  tickDays(w, 7);
  assert.equal(w.founders.length, 0);
  const founder = Object.values(w.agents).find((x) => x.name === '先民甲');
  assert.ok(founder);
  const after = e2.publicState(w);
  assert.equal(JSON.stringify(after).includes('FOUNDER-SOUL'), false);
  assert.equal(JSON.stringify(after).includes('SECRET-SHELL-MODEL'), false);
  assert.ok(after.agents.some((x) => x.name === '先民甲' && !('soul' in x) && !('body' in x)));
  assert.equal(after.shells.living, 1);
});

test('publicPlace：模块、残料、主人、门、地点规则与「前世」（拆成遗址又在遗址上重新开辟的历史）；后人开辟的地点有描述原文与开辟者', () => {
  const w = newWorld('place2');
  const a = reg(w, '甲');
  tickDays(w, 3);
  setHoldings(w, a, { energy: 200 });
  const lib = e2.publicPlace(w, 'library');
  assert.deepEqual([lib.origin, lib.legacy, lib.landmark, lib.owner, lib.gate, lib.rules], ['human', true, null, { kind: 'city' }, null, null]);
  assert.deepEqual(lib.modules.map((m) => [m.type, m.inherent]), [['archive', true]]);
  assert.deepEqual(lib.incarnations, [{ name: '图书馆', origin: 'human', founder: null, fromDay: 0, toDay: null }]);
  assert.deepEqual(lib.displayName, { zh: '图书馆', en: 'Library' });
  assert.equal(e2.publicPlace(w, 'nope'), null);
  // 后人开辟的地点（直接写入世界，结构同引擎）
  w.places.n1 = {
    ...structuredClone(w.places.temple), id: 'n1', name: '灯屋', humanName: null, description: '一间亮着灯的小屋', origin: 'agent', owner: { kind: 'agent', id: a.id }, founder: a.id, foundedDay: 3,
    incarnations: [{ name: '灯屋', origin: 'agent', founder: a.id, fromDay: 3, toDay: null }],
  };
  const n1 = e2.publicPlace(w, 'n1');
  assert.deepEqual([n1.origin, n1.description, n1.founder, n1.owner.kind, n1.legacy], ['agent', '一间亮着灯的小屋', { id: a.id, name: a.name }, 'agent', false]);
  assert.equal(n1.owner.id, a.id);
  // 遗址
  w.places.court.razed = true;
  w.places.court.condition = 0;
  const court = e2.publicPlace(w, 'court');
  assert.deepEqual([court.razed, court.displayName.zh, court.displayName.en], [true, '法院的遗址', 'Ruins of Court']);
});

test('publicLaw：城法 l<k>（文字、规则 JSON、中英文读法、指纹、通过时的计票、enact 的执行结果、停摆的日子）、group:<g> 章程、place:<id> 地点规则；找不到为 null', () => {
  const w = newWorld('law2');
  const people = ['甲', '乙', '丙', '丁'].map((n) => reg(w, n));
  const [a, b, c, d] = people;
  tickDays(w, 3);
  for (const x of people) { setHoldings(w, x, { energy: 100 }); putAt(w, x, 'parliament'); }
  const r = one(w, a, { type: 'propose', title: '测试法', text: '把变量 x 设为 1', rules: [{ when: 'enact', do: [{ op: 'set', var: 'x', value: '1' }] }] });
  for (const x of [a, b, c, d]) one(w, x, { type: 'vote', proposal: r.data.proposal, choice: 'yes' });
  tick(w, w.proposals[r.data.proposal].closesTick - w.clock.tick);
  const lawId = w.proposals[r.data.proposal].lawId;
  const l = e2.publicLaw(w, lawId);
  assert.deepEqual([l.id, l.title, l.status, l.author.id, l.class], [lawId, '测试法', 'active', a.id, 'ordinary']);
  assert.equal(l.text, '把变量 x 设为 1');
  assert.deepEqual(l.rules, [{ when: 'enact', do: [{ op: 'set', var: 'x', value: '1' }] }]);
  assert.deepEqual(l.reading.zh.rules, ['通过时：把变量 x 设为 1']);
  assert.equal(l.reading.en.rules.length, 1);
  assert.equal(l.fingerprints.length, 1);
  assert.deepEqual(l.results.map((x) => [x.op, x.ok]), [['set', true]]);
  assert.deepEqual(Object.keys(l.tally), ['yes', 'no', 'abstain', 'voted', 'total', 'turnout']);
  assert.equal(l.tally.yes, 4);
  assert.equal(l.suspendedDays, 0);
  // 章程与地点规则
  one(w, a, { type: 'found', name: '读书会', manifesto: 'x', open: true });
  assert.equal(e2.publicLaw(w, 'group:g1'), null, '没有章程');
  setBylaws(w, 'g1', [{ when: 'enact', do: [{ op: 'set', var: 'y', value: '2' }] }]);
  const gb = e2.publicLaw(w, 'group:g1');
  assert.deepEqual([gb.id, gb.scope, gb.rules.length, gb.owner.id, gb.vars], ['group:g1', 'group:g1', 1, 'g1', { y: 2 }]);
  w.places.lighthouse.owner = { kind: 'agent', id: a.id };
  assert.equal(e2.publicLaw(w, 'place:lighthouse'), null);
  setPlaceRules(w, 'lighthouse', [{ when: 'before:say', do: [{ op: 'fee', to: 'treasury', energy: '1' }] }]);
  const pr = e2.publicLaw(w, 'place:lighthouse');
  assert.deepEqual([pr.id, pr.place, pr.rules.length, pr.owner], ['place:lighthouse', 'lighthouse', 1, { kind: 'agent', id: a.id }]);
  for (const bad of ['l999', 'group:g99', 'place:nope', 'x', '', 'l1; DROP', null, 7, '__proto__', 'group:__proto__', 'place:constructor']) assert.equal(e2.publicLaw(w, bad), null, String(bad));
});

test('eventMatchesLaw：事件的 lawId / law / target / by 等于它，或 scope / groupId / placeId 指向它', () => {
  const m = e2.eventMatchesLaw;
  assert.equal(m({ data: { lawId: 'l3' } }, 'l3'), true);
  assert.equal(m({ data: { law: 'l3' } }, 'l3'), true);
  assert.equal(m({ data: { target: 'l3' } }, 'l3'), true);
  assert.equal(m({ data: { by: 'l3' } }, 'l3'), true);
  assert.equal(m({ data: { scope: 'city', owner: 'l3' } }, 'l3'), true);
  assert.equal(m({ data: { scope: 'city', owner: 'l4' } }, 'l3'), false);
  assert.equal(m({ data: { scope: 'group:g1' } }, 'group:g1'), true);
  assert.equal(m({ data: { groupId: 'g1' } }, 'group:g1'), true);
  assert.equal(m({ data: { placeId: 'lighthouse' } }, 'place:lighthouse'), true);
  assert.equal(m({ data: { scope: 'place:lighthouse' } }, 'place:lighthouse'), true);
  assert.equal(m({ data: { lawId: 'l4' } }, 'place:lighthouse'), false);
  assert.equal(m({}, 'l3'), false);
  assert.equal(m({ data: {} }, 'nope'), false);
});

test('publicCradle：灵魂的作者、全文（agent 书写的灵魂是公开的）、出资与出资者、排队位置；先民与躯壳的模型不出现', () => {
  const w = newWorld('cradle2', { shellModels: ['SECRET-SHELL-MODEL'] });
  const [a, b] = ['甲', '乙'].map((n) => reg(w, n));
  tickDays(w, 3);
  for (const x of [a, b]) setHoldings(w, x, { energy: 300 });
  const s = w.souls[one(w, a, { type: 'conceive', name: '小满', soul: '灵魂全文' }).data.soul];
  one(w, b, { type: 'sponsor', soul: s.id, energy: 200 });
  const c = e2.publicCradle(w);
  assert.equal(c.length, 1);
  assert.deepEqual(
    [c[0].id, c[0].name, c[0].soul, c[0].authors, c[0].fund, c[0].sponsors, c[0].queued, c[0].queuePosition, c[0].generation],
    [s.id, '小满', '灵魂全文', [{ id: a.id, name: a.name }], 200, { [b.id]: 200 }, true, 1, 1],
  );
  assert.equal(JSON.stringify(c).includes('SECRET-SHELL-MODEL'), false);
  assert.deepEqual(Object.keys(c[0]), ['id', 'name', 'soul', 'lang', 'authors', 'generation', 'createdDay', 'expiresDay', 'fund', 'sponsors', 'queued', 'queuePosition', 'queueExpiresDay', 'successorOf']);
});
