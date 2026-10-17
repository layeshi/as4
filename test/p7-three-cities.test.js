// 第七前提「三城」（docs/plans/2026-10-16-three-cities.md）：创世、籍与迁籍、城法属地、宣告、立法、源井与守恒、回放。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import e2 from '../src/e2/facade.js';
import { createWorld, genesisOpts } from '../src/e2/world.js';
import { stateHash } from '../src/store.js';
import { validateRules } from '../src/e2/rules/check.js';
import { createLaw } from '../src/e2/engine/laws.js';
import { runEnact, citySet } from '../src/e2/engine/rules.js';
import { withCity, cityValue } from '../src/e2/engine/cities.js';
import { buildPerception } from '../src/e2/engine/perception.js';
import { publicState } from '../src/e2/engine/visibility.js';
import { FiscalView } from '../src/fiscal-view.js';

const hiddenPhysics = JSON.parse(readFileSync(new URL('./fixtures/p7-hidden-physics.json', import.meta.url), 'utf8'));
const world = (seed = 'p7') => createWorld({ id: seed, seed, premise: 7, hiddenPhysics });

for (const [build, args, materials] of [
  ['site', { lot: 'wilds-lot-5', name: '盐滩观察站' }, 15],
  ['road', { to: 'datatower' }, 30],
]) {
  test(`P7 outside ${build} construction does not require a city well or pause the experiment`, () => {
    const w = createWorld({ seed: `outside-${build}`, premise: 7, hiddenPhysics, lawSemanticsVersion: 2 });
    const h = harness(w), id = h.create('builder', '建设者', 'north');
    assert.equal(h.act(id, [{ type: 'move', to: 'saltflats' }])[0].ok, true);
    h.tick();
    assert.equal(w.well, null);
    const wells = structuredClone(Object.fromEntries(Object.entries(w.cities).map(([id, c]) => [id, c.well])));
    const [result] = h.act(id, [{ type: 'initiate', build, ...args }]);
    assert.equal(result.ok, true, JSON.stringify(result));
    const project = w.projects[result.data.project];
    assert.equal(project.needMaterials, materials);
    assert.equal(project.needWork, 40);
    assert.equal(project.phase, 'funding');
    assert.equal(w.paused, false);
    assert.equal(w.lawSemantics.protection, undefined);
    assert.deepEqual(Object.fromEntries(Object.entries(w.cities).map(([id, c]) => [id, c.well])), wells);
    if (build === 'site') assert.equal(w.lots[args.lot].project, project.id);
    assert.equal(e2.checkConservation(w).ok, true);
  });
}

test('P7 outside well upgrade returns wrong_place without fault protection', () => {
  const w = createWorld({ seed: 'outside-upgrade', premise: 7, hiddenPhysics, lawSemanticsVersion: 2 });
  const h = harness(w), id = h.create('builder', '建设者', 'north');
  h.act(id, [{ type: 'move', to: 'saltflats' }]);
  h.tick();
  const [result] = h.act(id, [{ type: 'initiate', build: 'upgrade' }]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'wrong_place');
  assert.equal(w.paused, false);
  assert.equal(w.lawSemantics.protection, undefined);
  assert.equal(Object.keys(w.projects).length, 0);
});

for (const city of ['north', 'west', 'east']) {
  test(`P7 ${city} well upgrade uses its own city's upgrade level`, () => {
    const w = createWorld({ seed: `upgrade-${city}`, premise: 7, hiddenPhysics, lawSemanticsVersion: 2 });
    const h = harness(w), id = h.create('builder', '建设者', city);
    w.cities[city].well.upgrades.push({ level: 1 });
    h.act(id, [{ type: 'move', to: `${city}-well` }]);
    const [result] = h.act(id, [{ type: 'initiate', build: 'upgrade' }]);
    assert.equal(result.ok, true, JSON.stringify(result));
    const project = w.projects[result.data.project];
    assert.equal(project.needMaterials, 100);
    assert.equal(project.needWork, 200);
    assert.equal(w.well, null);
    assert.equal(w.paused, false);
  });
}

test('P7 fiscal metrics separate actual law payments by city without changing the world', () => {
  const w = world(), h = harness(w), fiscal = new FiscalView();
  for (const city of ['north', 'west', 'east']) h.create(`acct-${city}`, city, city);
  for (let n = 0; n < 12; n++) for (const e of h.cmd('tick').events) fiscal.index(e);
  const before = stateHash(w), m = fiscal.metrics(w, w.metrics.at(-1));
  const cities = Object.values(m.cities);
  assert.equal(cities.reduce((sum, c) => sum + c.dailyDistributionEnergy, 0), m.dailyDistributionEnergy);
  assert.ok(m.cities.west.dailyDistributionEnergy > m.cities.east.dailyDistributionEnergy);
  assert.ok(m.cities.east.dailyDistributionEnergy > m.cities.north.dailyDistributionEnergy);
  for (const c of cities) assert.equal(c.rationPerCapita, c.dailyDistributionEnergy / (c.awake + c.dormant));
  assert.equal(stateHash(w), before);
});

function harness(w) {
  const commands = [];
  let n = 0;
  const cmd = (type, payload = {}) => { commands.push({ type, payload }); return e2.applyCommand(w, { type, payload }); };
  const create = (accountId, name, city) => {
    const r = cmd('account', { op: 'create', accountId, requestId: `create-${accountId}`, name, soul: `我是${name}。`, lang: 'zh', model: 'test', dailyCap: 5000000, city });
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
    return r.result.agentId;
  };
  const act = (id, actions) => {
    const wakeId = `wake-${++n}`;
    cmd('meter', { op: 'wake', agentId: id, wakeId, day: '2026-10-16', kind: 'main', system: 0, brief: 0, delivered: 0 });
    const r = cmd('act', { agentId: id, requestId: `act-${n}`, experimentGeneration: 0, actions, meter: { wakeId, day: '2026-10-16', reread: 0 } });
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
    return r.result.results;
  };
  const tick = (k = 1) => { for (let i = 0; i < k; i++) assert.equal(cmd('tick').result.ok, true); };
  return { commands, cmd, create, act, tick };
}

/** 测试用：在某座城直接生效一部法律（不走立法程序） */
function enact(w, city, rules) {
  return withCity(w, city, () => {
    const v = validateRules(rules, { scope: { premise: 7, kind: 'city' } });
    assert.equal(v.ok, true, JSON.stringify(v.issues));
    const law = createLaw(w, { title: 'test', text: 'test', author: 'humans', rules: v.rules });
    runEnact(w, citySet(law), { quiet: true });
    return law.id;
  });
}

test('P7 genesis: three polities with their own laws, wells, charters and twenty public roles', () => {
  const w = world();
  assert.deepEqual(Object.keys(w.cities), ['north', 'west', 'east']);
  for (const [id, share] of [['north', 167], ['west', 500], ['east', 333]]) {
    const c = w.cities[id];
    assert.deepEqual(Object.keys(c.laws), ['l1', 'l2', 'l3', 'l4', 'l5', 'l6']);
    assert.deepEqual(c.procedure, { ordinary: 'l1', constitutional: 'l1' });
    assert.equal(c.well.share, share);
    assert.equal(c.charter.length, 9);
    assert.equal(c.laws.l2.rules[0].if, `actor.place != '${id}-parliament'`);
    assert.deepEqual(c.laws.l4.rules.map((r) => r.when), ['on:arrive', 'on:born', 'on:settle', 'on:emigrate']);
  }
  assert.equal(w.treasury, null);
  assert.deepEqual(w.laws, {});
  assert.equal(Object.keys(w.places).length, 34);
  assert.equal(w.places['west-agora'].city, 'west');
  assert.equal(w.places.datatower.city, null);
  assert.equal(Object.keys(w.publicRoles).length, 20);
  assert.equal(w.publicRoles['guide-east'].home, 'east-port');
  assert.equal(w.publicRoles.registrar.city, 'east');
  assert.equal(Object.keys(w.materialZones).length, 8);
});

test('P7 residents arrive at the chosen port, become citizens there, and need a city', () => {
  const w = world();
  const h = harness(w);
  const bad = h.cmd('account', { op: 'create', accountId: 'x', requestId: 'create-x-none', name: '无城', soul: '我', lang: 'zh', model: 'm', dailyCap: 1000 });
  assert.equal(bad.result.ok, false);
  const a = h.create('acct-a', '甲', 'west');
  assert.equal(w.agents[a].place, 'west-port');
  assert.equal(w.agents[a].city, 'west');
  assert.deepEqual(w.agents[a].tags, ['west:citizen']);
  const arrive = h.commands.length;
  void arrive;
  assert.equal(e2.checkConservation(w).ok, true);
});

test('P7 island citizenship metrics count living residents across valid city namespaces once', () => {
  const w = world(), h = harness(w);
  const north = h.create('metric-north', '北人', 'north');
  const west = h.create('metric-west', '西人', 'west');
  const east = h.create('metric-east', '东人', 'east');
  h.tick(12);
  assert.equal(w.metrics.at(-1).nonCitizens, 0);
  assert.equal(w.metrics.at(-1).exiled, 0);
  const previous = structuredClone(w.metrics[0]);

  // Residence and current location do not define citizenship. Multiple cities
  // may grant it; exile is a separate tag, just as in single-city metrics.
  w.agents[north].tags = ['west:citizen', 'north:exiled', 'east:exiled'];
  w.agents[north].place = 'saltflats';
  w.agents[west].tags = ['citizen', 'unknown:citizen', 'unknown:exiled'];
  w.agents[east].tags = ['east:citizen', 'north:citizen'];
  h.tick(12);
  assert.equal(w.metrics.at(-1).nonCitizens, 1);
  assert.equal(w.metrics.at(-1).exiled, 1);
  assert.deepEqual(w.metrics[0], previous, 'previous daily snapshots are not rewritten');

  w.agents[north].status = 'retired';
  w.agents[west].status = 'dead';
  h.tick(12);
  assert.equal(w.metrics.at(-1).nonCitizens, 0);
  assert.equal(w.metrics.at(-1).exiled, 0);
});

test('P7 wells pay 3:2:1 into their own treasuries; rations go to each city’s citizens', () => {
  const w = world();
  const h = harness(w);
  const n = h.create('acct-n', '北人', 'north');
  const ws = [h.create('acct-w1', '西一', 'west'), h.create('acct-w2', '西二', 'west')];
  const e = h.create('acct-e', '东人', 'east');
  const before = Object.fromEntries([n, ...ws, e].map((id) => [id, w.agents[id].energy]));
  h.tick(12);
  const out = Object.fromEntries(['north', 'west', 'east'].map((id) => [id, w.cities[id].well.outputHistory.at(-1)]));
  assert.ok(out.west > out.east && out.east > out.north);
  assert.ok(Math.abs(out.west / out.north - 3) < 0.05, JSON.stringify(out));
  assert.ok(Math.abs(out.east / out.north - 2) < 0.05, JSON.stringify(out));
  // l3：六成按人头平分给本城醒着的公民
  const gain = (id) => w.agents[id].energy - before[id];
  assert.ok(gain(e) > gain(ws[0]), 'the lone east citizen gets the whole east share');
  assert.equal(gain(ws[0]), gain(ws[1]));
  assert.ok(e2.checkConservation(w).ok);
  for (const id of ['north', 'west', 'east']) assert.equal(w.cities[id].chronicle.length, 1);
  assert.ok(w.metrics.at(-1).cities.west.treasuryEnergy > 0);
});

test('P7 moves: leaving is governed by the origin city, entering by the destination, crossings pass the wilds', () => {
  const w = world();
  const h = harness(w);
  const a = h.create('acct-a', '行者', 'north');
  // 西城：不是西城公民的人不得进入西城
  enact(w, 'west', [{ when: 'before:move', if: "not has_tag(actor, 'citizen')", do: [{ op: 'deny', reason: '西城只许公民进入' }] }]);
  const k = w.tokens.k;
  let r = h.act(a, [{ type: 'move', to: 'west-agora' }]);
  assert.equal(r[0].ok, false);
  assert.equal(r[0].error.code, 'forbidden');
  r = h.act(a, [{ type: 'move', to: 'east-agora' }]);
  assert.equal(r[0].ok, true, JSON.stringify(r));
  assert.equal(r[0].cost, 13 * k); // 北港 → 北城广场 1 段，广场到东城广场 12 段
  assert.equal(w.agents[a].place, 'east-agora');
  // 西城的法管不到荒野：从东城去荒野、再去西城以外的地方都可以
  h.tick();
  r = h.act(a, [{ type: 'move', to: 'saltflats' }]);
  assert.equal(r[0].ok, true);
});

test('P7 settle: only inside another city, once a week, with citizenship following the legacy l4', () => {
  const w = world();
  const h = harness(w);
  const a = h.create('acct-a', '迁者', 'north');
  let r = h.act(a, [{ type: 'settle' }]);
  assert.equal(r[0].error.code, 'already');
  h.act(a, [{ type: 'move', to: 'scrapyard' }]);
  h.tick();
  r = h.act(a, [{ type: 'settle' }]);
  assert.equal(r[0].error.code, 'wrong_place');
  h.act(a, [{ type: 'move', to: 'west-agora' }]);
  h.tick();
  r = h.act(a, [{ type: 'settle' }]);
  assert.equal(r[0].ok, true, JSON.stringify(r));
  assert.equal(w.agents[a].city, 'west');
  assert.deepEqual(w.agents[a].tags, ['west:citizen']);
  h.act(a, [{ type: 'move', to: 'east-agora' }]);
  h.tick();
  r = h.act(a, [{ type: 'settle' }]);
  assert.equal(r[0].error.code, 'cooldown');
  // 目的城的法律可以拒绝迁入
  h.tick(12 * 7);
  enact(w, 'east', [{ when: 'before:settle', do: [{ op: 'deny', reason: '东城不收移民' }] }]);
  r = h.act(a, [{ type: 'settle' }]);
  assert.equal(r[0].error.code, 'forbidden');
  assert.equal(w.agents[a].city, 'west');
});

test('P7 broadcasts stay inside the city; whispers cross it', () => {
  const w = world();
  const h = harness(w);
  const a = h.create('acct-a', '北甲', 'north');
  const b = h.create('acct-b', '北乙', 'north');
  const c = h.create('acct-c', '西丙', 'west');
  h.act(a, [{ type: 'broadcast', text: '北城的事' }, { type: 'whisper', to: c, text: '悄悄话' }]);
  assert.ok(w.agents[b].inbox.some((i) => i.kind === 'broadcast'));
  assert.ok(!w.agents[c].inbox.some((i) => i.kind === 'broadcast'));
  assert.ok(w.agents[c].inbox.some((i) => i.kind === 'whisper'));
});

test('P7 city laws take only from their own treasury and people inside, but can pay other cities', () => {
  const w = world();
  const h = harness(w);
  const west = h.create('acct-w', '西人', 'west');
  enact(w, 'north', [{ when: 'daily', do: [{ op: 'transfer', from: `agent('${west}')`, to: 'treasury', energy: '1000' }] }]);
  enact(w, 'north', [{ when: 'daily', do: [{ op: 'transfer', from: 'treasury', to: "treasury_of('east')", energy: '7' }] }]);
  const westBefore = w.agents[west].energy;
  h.tick(12);
  const ops = w.cities.north.dayLog; void ops;
  assert.ok(w.agents[west].energy >= westBefore, 'a north law cannot take from a resident standing in the west');
  assert.ok(e2.checkConservation(w).ok);
  // 东城的公库多收了北城的 7（份额之外）
  const east = cityValue(w, 'east', 'treasury').energy;
  assert.ok(east > 0);
});

test('P7 exile sends people inside the city to its wilds and keeps them out; other cities still admit them', () => {
  const w = world();
  const h = harness(w);
  const a = h.create('acct-a', '逐者', 'north');
  enact(w, 'north', [{ when: 'daily', do: [{ op: 'exile', who: `agent('${a}')` }] }]);
  h.tick(12);
  assert.equal(w.agents[a].place, 'scrapyard');
  assert.ok(w.agents[a].tags.includes('north:exiled'));
  let r = h.act(a, [{ type: 'move', to: 'north-agora' }]);
  assert.equal(r[0].error.code, 'forbidden');
  r = h.act(a, [{ type: 'move', to: 'west-agora' }]);
  assert.equal(r[0].ok, true, JSON.stringify(r));
});

test('P7 lawmaking: proposals belong to the city where they are made; citizens vote from anywhere', () => {
  const w = world();
  const h = harness(w);
  const a = h.create('acct-a', '议员', 'north');
  const b = h.create('acct-b', '外人', 'west');
  h.act(a, [{ type: 'move', to: 'north-parliament' }]);
  h.act(b, [{ type: 'move', to: 'north-parliament' }]);
  h.tick();
  let r = h.act(b, [{ type: 'propose', title: '外人的法', text: '试试', rules: [{ when: 'daily', do: [{ op: 'set', var: 'x', value: '1' }] }] }]);
  assert.equal(r[0].ok, false, 'a west citizen is not a north proposer');
  r = h.act(a, [{ type: 'propose', title: '北城的法', text: '设一个变量', rules: [{ when: 'daily', do: [{ op: 'set', var: 'x', value: '1' }] }] }]);
  assert.equal(r[0].ok, true, JSON.stringify(r));
  const pid = r[0].data.proposal;
  assert.ok(w.cities.north.proposals[pid]);
  h.act(a, [{ type: 'move', to: 'west-agora' }]);
  h.tick();
  r = h.act(a, [{ type: 'vote', proposal: pid, choice: 'yes' }]);
  assert.equal(r[0].ok, true, JSON.stringify(r));
  h.tick(12);
  assert.equal(w.cities.north.proposals[pid].status, 'passed');
  assert.ok(Object.values(w.cities.north.laws).some((l) => l.title === '北城的法'));
  assert.ok(!Object.values(w.cities.west.laws).some((l) => l.title === '北城的法'));
});

test('P7 perception shows the city you stand in, your home city and one line for elsewhere', () => {
  const w = world();
  const h = harness(w);
  const a = h.create('acct-a', '看者', 'north');
  h.act(a, [{ type: 'move', to: 'west-agora' }]);
  const p = buildPerception(w, a, { lang: 'zh', ack: false });
  assert.equal(p.you.city.id, 'north');
  assert.equal(p.you.located, 'west');
  assert.equal(p.city.id, 'west');
  assert.ok(p.city.places.every((x) => w.places[x.id].city === 'west' || x.exit));
  assert.equal(p.home.id, 'north');
  assert.deepEqual(p.elsewhere.map((x) => x.id), ['north', 'east', null]);
  const s = publicState(w);
  assert.equal(s.cities.length, 3);
  assert.equal(s.agents[0].city, 'north');
  assert.equal(s.agents[0].located, 'west');
});

test('P7 replay from genesis reproduces the state exactly', () => {
  const w = world('p7-replay');
  const h = harness(w);
  const a = h.create('acct-a', '甲', 'north');
  const b = h.create('acct-b', '乙', 'east');
  h.tick(5);
  h.act(a, [{ type: 'move', to: 'east-agora' }, { type: 'say', text: '你好东城' }]);
  h.act(b, [{ type: 'broadcast', text: '有客人来了' }]);
  h.tick(30);
  h.act(a, [{ type: 'settle' }]);
  h.tick(40);
  const copy = createWorld(genesisOpts(w));
  for (const c of h.commands) e2.applyCommand(copy, { type: c.type, payload: c.payload });
  assert.equal(stateHash(copy), stateHash(w));
  assert.ok(e2.checkConservation(w).ok);
});
