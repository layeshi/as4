import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import e2 from '../src/e2/facade.js';
import { createWorld, genesisOpts, serializeWorld } from '../src/e2/world.js';
import { stateHash, commandsPath, worldDir, writeSnapshot } from '../src/store.js';
import { virtualRelic } from '../src/e2/p6/canon.js';
import { relicTitle } from '../src/e2/lore/index.js';
import { RELICS_P7, relicsV2, relicV2, enableRelics, approxPortions, approxTenths } from '../src/e2/p6/relics.js';
import island, { MATERIAL_ZONES } from '../src/e2/map/island-three.js';
import { validateHiddenPhysics } from '../src/e2/materials-genesis.js';
import { regenerateMaterials } from '../src/e2/engine/materials.js';
import { roleActivity } from '../src/e2/p6/roles.js';
import { drainEvents } from '../src/e2/engine/core.js';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { iterateCommands } from '../src/commands.js';

const hiddenPhysics = JSON.parse(readFileSync(new URL('./fixtures/p7-hidden-physics.json', import.meta.url), 'utf8'));
const world = (seed = 'p7-relics', physics = hiddenPhysics) => createWorld({ id: seed, seed, premise: 7, hiddenPhysics: physics });

function harness(w) {
  const commands = [], events = [];
  let count = 0;
  const cmd = (type, payload = {}) => {
    commands.push({ type, payload });
    const out = e2.applyCommand(w, { type, payload });
    events.push(...out.events);
    return out;
  };
  const create = (accountId = 'finder', name = '拾遗者', city = 'west') => {
    const out = cmd('account', { op: 'create', accountId, requestId: `create-${accountId}`, name, soul: `我是${name}。`, lang: 'zh', model: 'test', dailyCap: 5000000, city });
    assert.equal(out.result.ok, true, JSON.stringify(out.result));
    return out.result.agentId;
  };
  const act = (agentId, actions) => {
    const wakeId = `wake-${++count}`;
    cmd('meter', { op: 'wake', agentId, wakeId, day: '2026-10-17', kind: 'main', system: 0, brief: 0, delivered: 0 });
    const out = cmd('act', { agentId, requestId: `act-${count}`, experimentGeneration: 0, actions, meter: { wakeId, day: '2026-10-17', reread: 0 } });
    assert.equal(out.result.ok, true, JSON.stringify(out.result));
    assert.ok(out.result.results.every((result) => result.ok), JSON.stringify(out.result.results));
    return out;
  };
  const tick = (amount = 1) => { for (let count = 0; count < amount; count++) assert.equal(cmd('tick').result.ok, true); };
  const enable = () => cmd('admin', { op: 'relics', args: { version: 2 } });
  const find = (agentId) => {
    for (let attempt = 0; attempt < 500; attempt++) {
      tick();
      const out = act(agentId, [{ type: 'explore' }]);
      const event = out.events.find((event) => event.type === 'explore' && event.data.outcome === 'relic');
      if (event) return { doc: w.docs[event.data.docId], event, events: out.events };
    }
    assert.fail('500 次探索内应出土遗物');
  };
  return { commands, events, cmd, create, act, tick, enable, find };
}

function replay(w, commands) {
  const copy = createWorld(genesisOpts(w));
  for (const command of commands) e2.applyCommand(copy, command);
  assert.equal(serializeWorld(copy), serializeWorld(w));
  assert.equal(stateHash(copy), stateHash(w));
  return copy;
}

test('T1 未启用的探索、文本、公告与改动前逐字节相同', () => {
  const w = world('p7-relics-legacy'), h = harness(w), id = h.create();
  h.act(id, [{ type: 'move', to: 'saltflats' }]);
  const { doc } = h.find(id), n = doc.title.match(/\d+/)[0], old = virtualRelic(n);
  assert.equal(doc.title, relicTitle(old.n));
  assert.equal(doc.body, old.body);
  assert.deepEqual(doc.ref, old.ref);
  assert.equal(doc.lang, old.lang);
  assert.equal(relicsV2(w), false);
  assert.equal(Object.hasOwn(w, 'relicSet'), false);
  assert.ok(!h.events.some((event) => event.type === 'role_reply' && event.data.text.includes('relic ')));
  replay(w, h.commands);
});

test('T2 全部文本逐字来自附录 A，双语标题、正文、占位符与确定性', () => {
  const w = world(), h = harness(w);
  assert.equal(h.enable().result.ok, true);
  const before = serializeWorld(w), bodies = new Set();
  const appendix = readFileSync(new URL('../docs/plans/2026-10-17-relics.md', import.meta.url), 'utf8').split('## 附录 A：')[1].split('## 附录 B：')[0];
  assert.equal(RELICS_P7.length, 28);
  for (const entry of RELICS_P7) {
    const raw = appendix.match(new RegExp(`\\*\\*遗物 · ${entry.n} · (.*?) / Relic · ${entry.n} · (.*?)\\*\\*[^\\n]*\\n> (.*?)\\n>\\n> (.*)`));
    assert.ok(raw, `附录 A 中的 ${entry.n}`);
    assert.deepEqual(entry.title, { zh: raw[1], en: raw[2] });
    assert.deepEqual(entry.body, { zh: raw[3], en: raw[4] });
    const relic = relicV2(w, String(entry.n));
    assert.equal(relic.n, entry.n);
    assert.equal(relic.lang, 'zh');
    assert.ok(relic.title.startsWith(`遗物 · ${entry.n} · `));
    assert.equal(relic.title.match(/\d+/)[0], String(entry.n));
    assert.ok(relic.title.includes(` / Relic · ${entry.n} · `));
    assert.ok([...relic.title].length <= 60, relic.title);
    assert.match(relic.body, /[\u4e00-\u9fff]/u);
    assert.equal(relic.body, relic.ref.zh);
    assert.match(relic.ref.en, /[A-Za-z]/);
    assert.ok(!JSON.stringify(relic.body + relic.ref.en).includes('{'));
    bodies.add(relic.body);
    assert.deepEqual(relicV2(w, entry.n), relic);
  }
  assert.equal(bodies.size, 28);
  assert.equal(serializeWorld(w), before);
});

test('T3 地带、八处台账、类别及已出土编号', () => {
  assert.deepEqual(RELICS_P7.map((entry) => entry.n).sort((left, right) => left - right), Array.from({ length: 28 }, (_, index) => index + 1));
  const found = new Set([1, 2, 9, 14, 19, 22]);
  for (const entry of RELICS_P7) {
    const place = island.places.find((place) => place.wild?.relics.includes(entry.n));
    assert.equal(entry.zone, place.id);
    assert.ok(['knowledge', 'institution', 'story'].includes(entry.kind));
    if (entry.kind === 'knowledge') assert.ok(!found.has(entry.n));
  }
  assert.equal(RELICS_P7.filter((entry) => entry.kind === 'knowledge').length, 14);
  for (const zone of Object.keys(MATERIAL_ZONES)) {
    const ledgers = RELICS_P7.filter((entry) => entry.zone === zone && entry.body.zh.includes('{base}'));
    assert.equal(ledgers.length, 1, zone);
    assert.equal(ledgers[0].kind, 'knowledge');
    for (const lang of ['zh', 'en']) for (const key of ['base', 'threshold', 'factor']) assert.ok(ledgers[0].body[lang].includes(`{${key}}`));
  }
});

test('T4 约数、半数向上、几成夹取、施工向下取整及头几趟', () => {
  for (const [value, zh, en] of [
    [1, '一两份', 'one or two'], [2, '一两份', 'one or two'], [3, '两到四份', '2 to 4'], [9, '八到十份', '8 to 10'],
    [10, '十份上下', 'about 10'], [12, '十份上下', 'about 10'], [13, '十五份上下', 'about 15'],
    [27, '二十五份上下', 'about 25'], [28, '三十份上下', 'about 30'], [29, '三十份上下', 'about 30'],
    [30, '三十份上下', 'about 30'], [34, '三十份上下', 'about 30'], [35, '四十份上下', 'about 40'],
    [118, '一百二十份上下', 'about 120'], [200, '两百份上下', 'about 200'], [210, '两百一十份上下', 'about 210'], [300, '三百份上下', 'about 300'],
  ]) assert.deepEqual(approxPortions(value), { zh, en }, String(value));
  const chinese = ['一成上下', '两成上下', '三成上下', '四成上下', '一半上下', '六成上下', '七成上下', '八成上下', '九成上下'];
  const english = ['about a tenth', 'about a fifth', 'about three tenths', 'about two fifths', 'about half', 'about three fifths', 'about seven tenths', 'about four fifths', 'about nine tenths'];
  for (let value = 1; value <= 9; value++) assert.deepEqual(approxTenths(value), { zh: chinese[value - 1], en: english[value - 1] });
  for (const [ratio, rounded] of [[0.04, 1], [0.25, 3], [0.35, 4], [0.95, 9]]) assert.deepEqual(approxTenths(Math.round(ratio * 10)), approxTenths(rounded));
  for (const [count, zh, en] of [[1, '头一趟', 'first shift'], [2, '头两趟', 'first two shifts'], [3, '头三趟', 'first three shifts']]) {
    const w = world();
    w.genesis.hiddenPhysics.construction.fullActionsPerTick = count;
    for (const permille of [100, 250, 350, 650, 900]) {
      w.genesis.hiddenPhysics.construction.factorPermille = permille;
      const relic = relicV2(w, 4), fraction = approxTenths(Math.floor(permille / 100));
      assert.ok(relic.body.includes(zh) && relic.ref.en.includes(en));
      assert.ok(relic.body.includes(fraction.zh) && relic.ref.en.includes(fraction.en));
    }
  }
});

test('T5 随机合法参数的台账及排班表与真实恢复、施工相符', () => {
  let randomState = 20261017;
  const randomInt = (min, max) => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return min + randomState % (max - min + 1);
  };
  for (let sample = 0; sample < 12; sample++) {
    const physics = structuredClone(hiddenPhysics);
    physics.regrowth.factorPermille = randomInt(100, 900);
    physics.construction = { fullActionsPerTick: 1 + sample % 3, factorPermille: randomInt(100, 900) };
    for (const [zone, [, cap]] of Object.entries(MATERIAL_ZONES)) {
      physics.regrowth.baseByZone[zone] = randomInt(2, cap);
      physics.regrowth.thresholdByZone[zone] = randomInt(1, cap - 1);
    }
    assert.doesNotThrow(() => validateHiddenPhysics(physics, 'island-three-v1'));
    const w = world(`p7-relics-physics-${sample}`, physics);
    const normal = {}, reduced = {};
    for (const excessive of [false, true, false]) {
      for (const [zone, stock] of Object.entries(w.materialZones)) {
        stock.stock = 0;
        stock.harvestedThisDay = physics.regrowth.thresholdByZone[zone] + Number(excessive);
      }
      regenerateMaterials(w);
      for (const [zone, stock] of Object.entries(w.materialZones)) {
        (excessive ? reduced : normal)[zone] = stock.stock;
        assert.equal(stock.harvestedThisDay, 0);
      }
    }
    for (const zone of Object.keys(MATERIAL_ZONES)) {
      assert.equal(normal[zone], physics.regrowth.baseByZone[zone]);
      assert.equal(reduced[zone], Math.max(1, Math.floor(normal[zone] * physics.regrowth.factorPermille / 1000)));
      const entry = RELICS_P7.find((entry) => entry.zone === zone && entry.body.zh.includes('{base}'));
      const relic = relicV2(w, entry.n);
      const values = { base: approxPortions(normal[zone]), threshold: approxPortions(physics.regrowth.thresholdByZone[zone]), factor: approxTenths(Math.round(10 * reduced[zone] / normal[zone])) };
      for (const lang of ['zh', 'en']) assert.equal(relic.ref[lang], entry.body[lang].replace(/\{(\w+)\}/g, (_, key) => values[key][lang]));
    }
    const constructionWorld = world(`p7-relics-construction-${sample}`, physics);
    constructionWorld.places['north-institute'].condition = 0;
    const h = harness(constructionWorld), id = h.create();
    h.cmd('admin', { op: 'adjust', args: { agentId: id, energy: 1000000, reason: '施工测试' } });
    h.act(id, [{ type: 'move', to: 'saltflats' }]);
    const projectId = h.act(id, [{ type: 'initiate', build: 'site', lot: 'wilds-lot-5', name: '台账核验站' }]).result.results[0].data.project;
    const project = constructionWorld.projects[projectId];
    constructionWorld.materialZones.saltflats.stock -= project.needMaterials;
    constructionWorld.agents[id].materials += project.needMaterials;
    h.act(id, [{ type: 'contribute', project: projectId, energy: project.need, materials: project.needMaterials }]);
    h.tick();
    const count = physics.construction.fullActionsPerTick;
    const results = h.act(id, Array.from({ length: count + 1 }, () => ({ type: 'construct', project: projectId }))).result.results;
    assert.deepEqual(results.map((result) => result.data.workAdded), [...Array(count).fill(10), Math.floor(physics.construction.factorPermille / 100)]);
    const fraction = approxTenths(results.at(-1).data.workAdded), relic = relicV2(constructionWorld, 4);
    assert.ok(relic.body.includes(fraction.zh));
    assert.ok(relic.ref.en.includes(fraction.en));
    assert.ok(results.every((result) => result.data.researchUsed === null));
  }
});

test('T6 启用权限、严格参数、内部事件、幂等及回放', () => {
  const w = world(), h = harness(w);
  for (const other of [{ ...w, premise: 6 }, { ...w, premise: 5 }, { ...w, map: 'frontier' }]) {
    const before = serializeWorld(other);
    assert.equal(enableRelics(other, { version: 2 }).error.code, 'not_allowed');
    assert.equal(serializeWorld(other), before);
  }
  for (const args of [undefined, null, [], 2, '2', {}, { version: 1 }, { version: '2' }, { version: 2, extra: true }, { extra: 2 }]) {
    const before = serializeWorld(w);
    assert.equal(enableRelics(w, args).error.code, 'invalid_request');
    assert.equal(serializeWorld(w), before);
  }
  for (const args of [{}, { version: 1 }, { version: 2, extra: true }]) assert.equal(h.cmd('admin', { op: 'relics', args }).result.error.code, 'invalid_request');
  h.tick(2);
  const out = h.enable();
  assert.deepEqual(out.result, { ok: true, version: 2, enabledTick: 2 });
  assert.deepEqual(w.relicSet, { version: 2, enabledTick: 2, enabledCommand: w.commandN });
  const event = out.events.find((event) => event.type === 'relics_enabled');
  assert.equal(event.vis, 'internal');
  assert.deepEqual(event.data, { enabledTick: 2 });
  const before = serializeWorld(w);
  assert.deepEqual(enableRelics(w, { version: 2 }), out.result);
  assert.equal(serializeWorld(w), before);
  assert.deepEqual(drainEvents(w), []);
  h.tick();
  const duplicate = h.enable();
  assert.deepEqual(duplicate.result, out.result);
  assert.equal(duplicate.events.filter((event) => event.type === 'relics_enabled').length, 0);
  replay(w, h.commands);
});

test('T7 中途打开不重写旧文档，日志回放逐字节相同', () => {
  const w = world('p7-relics-midway'), h = harness(w), id = h.create();
  h.act(id, [{ type: 'move', to: 'saltflats' }]);
  const old = structuredClone(h.find(id).doc);
  assert.equal(old.body, virtualRelic(old.title.match(/\d+/)[0]).body);
  assert.equal(h.enable().result.ok, true);
  const { doc } = h.find(id), n = doc.title.match(/\d+/)[0], relic = relicV2(w, n);
  assert.equal(doc.title, relic.title);
  assert.equal(doc.body, relic.body);
  assert.deepEqual(doc.ref, relic.ref);
  assert.deepEqual(w.docs[old.id], old);
  const copy = replay(w, h.commands);
  assert.deepEqual(copy.docs[old.id], old);
  assert.ok(e2.checkConservation(w).ok);
});

test('T8 遗物只在发现者籍城播报并纳入史官，合并事件按序排列', () => {
  for (const enabled of [false, true]) {
    const w = world('p7-relics-announcer'), h = harness(w), id = h.create();
    if (enabled) h.enable();
    h.act(id, [{ type: 'move', to: 'saltflats' }]);
    const { doc, event, events } = h.find(id);
    const replies = events.filter((event) => event.type === 'role_reply' && event.data.text.includes(`relic ${doc.id}`));
    assert.equal(replies.length, Number(enabled));
    assert.equal(w.publicRoles['chronicler-west'].dailyEvents.some((fact) => fact.seq === event.seq), enabled);
    if (enabled) {
      assert.equal(replies[0].data.publicRoleId, 'announcer-west');
      assert.ok(replies[0].data.text.includes(`relic ${doc.id}（事件 ${event.seq}）`));
      assert.ok(replies[0].data.citations.includes(event.seq));
      assert.ok(!['north', 'east'].some((city) => w.publicRoles[`chronicler-${city}`].dailyEvents.some((fact) => fact.seq === event.seq)));
      w.clock.tick++;
      const seq = w.counters.event;
      roleActivity(w, [
        { type: 'settle', city: 'west', seq: seq + 3, day: 1 },
        { type: 'explore', agent: id, city: null, seq: seq + 2, day: 1, data: { outcome: 'relic', docId: doc.id } },
        { type: 'built', city: 'west', seq: seq + 1, day: 1 },
        { type: 'explore', agent: id, seq: seq + 4, data: { outcome: 'nothing' } },
      ]);
      const reply = drainEvents(w).find((event) => event.type === 'role_reply' && event.data.publicRoleId === 'announcer-west');
      assert.deepEqual(reply.data.citations, [seq + 1, seq + 2, seq + 3]);
      assert.equal(reply.data.text, `本刻公共事件：built（事件 ${seq + 1}）；relic ${doc.id}（事件 ${seq + 2}）；settle（事件 ${seq + 3}）。请核查原始记录。`);
    }
  }
});

test('T9 新建第七前提运行时自动记入启用命令，恢复不再启用旧世界', () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-p7-relics-'));
  try {
    const cfg = { ...loadConfig({}, []), dataDir: dir, worldId: 'w', seed: 'p7-relics-runtime', physics: 2, premise: 7, map: 'island-three-v1', shellSlots: 0, hiddenPhysicsFile: fileURLToPath(new URL('./fixtures/p7-hidden-physics.json', import.meta.url)) };
    const rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
    assert.equal(relicsV2(rt.w), true);
    const log = () => [...iterateCommands(commandsPath(worldDir(dir, 'w')))];
    const enables = log().filter((command) => command.type === 'admin' && command.payload.op === 'relics');
    assert.equal(enables.length, 1);
    assert.deepEqual(enables[0].payload.args, { version: 2 });
    const copy = createWorld(genesisOpts(rt.w));
    for (const command of log()) e2.applyCommand(copy, command);
    assert.equal(stateHash(copy), stateHash(rt.w));
    rt.close();
    const restored = Runtime.open(cfg, { version: '0.1.0', logger: {} });
    assert.equal(stateHash(restored.w), stateHash(copy));
    assert.equal(log().filter((command) => command.payload?.op === 'relics').length, 1);
    restored.close();
    const old = world('p7-relics-runtime-old');
    writeSnapshot(worldDir(dir, old.id), old);
    const legacy = Runtime.open({ ...cfg, worldId: old.id }, { version: '0.0.0', logger: {} });
    assert.equal(Object.hasOwn(legacy.w, 'relicSet'), false);
    assert.equal([...iterateCommands(commandsPath(worldDir(dir, old.id)))].filter((command) => command.payload?.op === 'relics').length, 0);
    legacy.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
