import test from 'node:test';
import assert from 'node:assert/strict';
import { bareWorld, reg, putAt, one, grant, sha, setHoldings } from './e2-helpers.js';
import { applyCommand } from '../src/e2/engine/index.js';
import { decayAll, applyDamage, applyRepair, damageWellByDraw } from '../src/e2/engine/environment.js';
import { buildPerception } from '../src/e2/engine/perception.js';
import { publicState, publicAgent } from '../src/e2/engine/visibility.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
import { P } from '../src/e2/params.js';
import { createWorld } from '../src/e2/world.js';

const cmd = (w, type, payload = {}) => applyCommand(w, { type, payload });
function setup() {
  const w = bareWorld('prayer', { premise: 2 });
  assert.equal(cmd(w, 'prayer_enable').result.ok, true);
  const a = reg(w, '祈愿者'); putAt(w, a, 'temple'); grant(w, a, 1000);
  return { w, a };
}
const balance = (w, a) => w.prayers.accounts[a.id]?.balance || 0;
const prayer = (w, a) => one(w, a, { type: 'pray', text: '愿得到帮助' }).data.prayerId;
const reply = (w, a, id, extra = {}) => cmd(w, 'prayer_reply', { prayerId: id, actorId: 'private-human-id', ownerTokenHash: a.tokenHash, text: '神殿传来的话', ...extra });
function earn(w, a, n = 100) {
  const p = w.places[a.place]; applyDamage(w, p, p.id, p.id, n, 'natural');
  assert.equal(one(w, a, { type: 'repair', energy: Math.ceil(n / 10) }).ok, true);
}

test('activation is premise-2 only; praying needs standing temple, costs one energy and permits one per day', () => {
  assert.equal(cmd(bareWorld('p1', { premise: 1 }), 'prayer_enable').result.ok, false);
  const old = bareWorld('old', { premise: 2 }); const oldA = reg(old, '旧居民'); putAt(old, oldA, 'temple');
  assert.equal(one(old, oldA, { type: 'pray', text: '旧命令' }).error.code, 'invalid_args');
  assert.equal(old.prayers, undefined);
  const { w, a } = setup(); const initial = a.energy;
  assert.equal(one(w, a, { type: 'pray', text: '😀'.repeat(601) }).ok, false);
  putAt(w, a, 'port'); assert.equal(one(w, a, { type: 'pray', text: '错误地点' }).ok, false);
  putAt(w, a, 'temple'); assert.equal(one(w, a, { type: 'pray', text: '😀'.repeat(600) }).ok, true);
  assert.equal(a.energy, initial - 1); assert.equal(balance(w, a), 0);
  assert.equal(one(w, a, { type: 'pray', text: '再次' }).ok, false);
  w.clock.tick += P.ticksPerDay; w.places.temple.name = '改名';
  assert.equal(one(w, a, { type: 'pray', text: '改名仍然可祈祷' }).ok, true);
  w.clock.tick += P.ticksPerDay; w.places.temple.condition = 0;
  assert.equal(one(w, a, { type: 'pray', text: '废墟' }).ok, false);
});

test('repair awards only post-activation natural damage, carries fractions and consumes eligibility on nonresident repair', () => {
  const w = bareWorld('historical', { premise: 2 }); const a = reg(w, '维修者'); grant(w, a, 1000); putAt(w, a, 'temple');
  applyDamage(w, w.places.temple, 'temple', 'temple', 100);
  cmd(w, 'prayer_enable'); one(w, a, { type: 'repair', energy: 10 }); assert.equal(balance(w, a), 0);
  earn(w, a, 50); assert.equal(balance(w, a), 0); earn(w, a, 50); assert.equal(balance(w, a), 1);
  putAt(w, a, 'well'); damageWellByDraw(w, 10); one(w, a, { type: 'repair', energy: 100 }); assert.equal(balance(w, a), 1);
  putAt(w, a, 'temple'); applyDamage(w, w.places.temple, 'temple', 'temple', 100, 'natural');
  applyRepair(w, w.places.temple, 'temple', 'temple', 10); one(w, a, { type: 'repair', energy: 10 }); assert.equal(balance(w, a), 1);
  w.places.temple.owner = { kind: 'agent', id: a.id }; earn(w, a, 100); assert.equal(balance(w, a), 1);
  w.places.temple.owner = { kind: 'city' }; assert.equal(w.prayers.naturalDamage.temple, 0);
});

test('automatic daily cap discards integer excess and retains only fractional carry', () => {
  const { w, a } = setup(); earn(w, a, 1050); assert.equal(balance(w, a), 10);
  earn(w, a, 100); assert.equal(balance(w, a), 10);
  w.clock.tick += P.ticksPerDay; earn(w, a, 50); assert.equal(balance(w, a), 11);
});

test('paid replies are atomic, owner-token checked, private identities sanitized and text does not wake', () => {
  const { w, a } = setup(); const id = prayer(w, a);
  const before = JSON.stringify(w.prayers); const initial = a.energy;
  assert.equal(reply(w, a, id).result.error.code, 'insufficient_points'); assert.equal(JSON.stringify(w.prayers), before); assert.equal(a.energy, initial);
  earn(w, a, 300);
  assert.equal(reply(w, a, id, { ownerTokenHash: sha('stranger') }).result.ok, false);
  assert.equal(reply(w, a, id, { energy: -1 }).result.ok, false);
  const out = reply(w, a, id, { energy: 2 }); assert.equal(out.result.ok, true); assert.equal(balance(w, a), 0);
  assert.equal(a.energy, initial - 30 + 2); assert.equal(w.ledger.src.energy.prayer_aid, 2); assert.equal(checkConservation(w).ok, true);
  assert.equal(out.wakes.length, 0); assert.equal(JSON.stringify(out.events).includes('private-human-id'), false);
  assert.equal(JSON.stringify(buildPerception(w, a.id, { ack: false })).includes('private-human-id'), false);
  assert.equal(JSON.stringify(publicState(w)).includes('private-human-id'), false);
  assert.equal(publicAgent(w, a).prayerPoints, 0);
  const snap = JSON.stringify(w.prayers); assert.equal(reply(w, a, id).result.ok, false); assert.equal(JSON.stringify(w.prayers), snap);
});

test('text response leaves dormancy alone while enough energy uses ordinary revival', () => {
  const { w, a } = setup(); earn(w, a, 1000); const id = prayer(w, a); setHoldings(w, a, { energy: 0 }); a.status = 'dormant'; a.dormantSinceDay = 0;
  assert.equal(reply(w, a, id).result.ok, true); assert.equal(a.status, 'dormant');
  a.status = 'awake'; setHoldings(w, a, { energy: 30 }); w.clock.tick += P.ticksPerDay;
  const id2 = prayer(w, a); a.status = 'dormant'; setHoldings(w, a, { energy: P.reviveThreshold - 1 });
  assert.equal(reply(w, a, id2, { text: undefined, energy: 1 }).result.ok, true); assert.equal(a.status, 'awake');
});

test('first rescue per recipient/day earns one point regardless of amount or different rescuers', () => {
  const { w, a } = setup(); const b = reg(w, '受助者'); const c = reg(w, '第二救助者'); grant(w, c, 1000);
  b.status = 'dormant'; setHoldings(w, b, { energy: 0 });
  assert.equal(one(w, a, { type: 'give', to: b.id, energy: P.reviveThreshold + 50 }).ok, true); assert.equal(balance(w, a), 1);
  b.status = 'dormant'; setHoldings(w, b, { energy: 0 }); one(w, c, { type: 'give', to: b.id, energy: P.reviveThreshold }); assert.equal(balance(w, c), 0);
  w.clock.tick += P.ticksPerDay; b.status = 'dormant'; setHoldings(w, b, { energy: 0 }); one(w, c, { type: 'give', to: b.id, energy: P.reviveThreshold }); assert.equal(balance(w, c), 1);
});

test('invention rejects human canon, reviews need reason, rejected submissions can be revised and award once outside cap', () => {
  const { w, a } = setup();
  assert.equal(one(w, a, { type: 'invent', title: '冒领', text: '人类作品', ref: { kind: 'doc', id: 'd1' } }).ok, false);
  putAt(w, a, 'library');
  const d = one(w, a, { type: 'write', title: '成果', body: '设计成果' }); assert.equal(d.ok, true);
  const id = one(w, a, { type: 'invent', title: '新发明', text: '说明', ref: { kind: 'doc', id: d.data.doc } }).data.inventionId;
  const review = (decision, reason = '经考察') => cmd(w, 'invention_review', { inventionId: id, actorId: 'private-reviewer', decision, reason });
  assert.equal(review('approved', '').result.ok, false); assert.equal(review('rejected').result.ok, true);
  assert.equal(one(w, a, { type: 'invent', title: '补充', text: '新的材料', ref: { kind: 'doc', id: d.data.doc }, submission: id }).ok, true);
  putAt(w, a, 'temple'); earn(w, a, 1000); assert.equal(review('approved').result.ok, true); assert.equal(balance(w, a), 20);
  assert.equal(review('approved').result.ok, false);
  assert.equal(one(w, a, { type: 'invent', title: '重复', text: '重复', ref: { kind: 'doc', id: d.data.doc } }).ok, false);
  assert.equal(JSON.stringify(publicState(w)).includes('private-reviewer'), false);
});

test('fostering preserves resident points and pending prayer but invalidates old tokens; retirement closes requests', () => {
  const { w, a } = setup(); earn(w, a); const id = prayer(w, a); const old = a.tokenHash;
  cmd(w, 'release', { agentId: a.id, release: true });
  assert.equal(cmd(w, 'foster', { agentId: a.id, model: 'test-model', creatorName: 'new', ownerKeyHash: sha('new-owner'), tokenHash: sha('new-token') }).result.ok, true);
  assert.equal(balance(w, a), 1); assert.equal(reply(w, a, id, { ownerTokenHash: old }).result.ok, false);
  one(w, a, { type: 'retire' }); assert.equal(balance(w, a), 0); assert.equal(w.prayers.prayers[id].status, 'closed');
  assert.equal(reply(w, a, id).result.ok, false);
});

import { validateRules } from '../src/e2/rules/check.js';
import { razePlace } from '../src/e2/engine/dismantle.js';
import { buildSystemPrompt, promptParams } from '../runner/prompt.js';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { readCommands, CommandLog } from '../src/commands.js';
import { worldDir, commandsPath, stateHash, writeSnapshot } from '../src/store.js';
import { replayDir } from '../src/tools/replay.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function site(w, a, lot, name, owner = 'city') {
  putAt(w, a, 'market');
  const r = one(w, a, { type: 'initiate', build: 'site', lot, name, owner });
  assert.equal(r.ok, true, JSON.stringify(r)); return w.projects[r.data.project];
}
function contribute(w, a, j, energy) {
  putAt(w, a, j.place); const r = one(w, a, { type: 'contribute', project: j.id, energy });
  assert.equal(r.ok, true, JSON.stringify(r)); return r;
}
test('completed public projects carry contributions, settle on completion day and discard historical input/private/rebuild rewards', () => {
  const w = bareWorld('pre-project', { premise: 2 }); const a = reg(w, '工程师'); grant(w, a, 2000);
  const historic = site(w, a, 'commons-4', '上线前项目'); contribute(w, a, historic, 30);
  cmd(w, 'prayer_enable'); contribute(w, a, historic, 10); assert.equal(balance(w, a), 1);
  const b = reg(w, '同工'); grant(w, b, 1000);
  const j1 = site(w, a, 'commons-3', '新工程甲'); contribute(w, a, j1, 5); assert.equal(balance(w, a), 1);
  w.clock.tick += P.ticksPerDay; contribute(w, b, j1, 35); assert.equal(balance(w, a), 1);
  const j2 = site(w, a, 'east-3', '新工程乙'); contribute(w, a, j2, 5); contribute(w, b, j2, 35); assert.equal(balance(w, a), 2);
  assert.equal(w.prayers.ledger.at(-2).day, 1);
  putAt(w, a, j2.result); razePlace(w, w.places[j2.result]);
  const rebuild = one(w, a, { type: 'initiate', build: 'site', on: j2.result, name: '重建', owner: 'city' }); assert.equal(rebuild.ok, true);
  contribute(w, a, w.projects[rebuild.data.project], rebuild.data.need); assert.equal(balance(w, a), 2);
  putAt(w, a, 'wilds'); const privateSite = one(w, a, { type: 'initiate', build: 'site', lot: 'wilds-1', name: '私宅' }); assert.equal(privateSite.ok, true);
  contribute(w, a, w.projects[privateSite.data.project], privateSite.data.need); assert.equal(balance(w, a), 2);
});

test('ordinary city law can prohibit prayer or charge a fee; failed prayer mutates neither balance nor cooldown', () => {
  const { w, a } = setup();
  const rules = [{ when: 'before:pray', do: [{ op: 'deny', reason: '安静' }] }];
  const checked = validateRules(rules, { scope: { premise: 2, prayers: true, kind: 'city' } }); assert.equal(checked.ok, true, JSON.stringify(checked));
  w.laws.l7 = { ...w.laws.l6, id: 'l7', status: 'active', suspendedDays: 0, paidThrough: 100, rules: checked.rules };
  const energy = a.energy; assert.equal(one(w, a, { type: 'pray', text: '受禁' }).error.code, 'forbidden'); assert.equal(a.energy, energy);
  const fees = validateRules([{ when: 'before:pray', do: [{ op: 'fee', energy: '2', to: 'treasury' }] }], { scope: { premise: 2, prayers: true, kind: 'city' } });
  assert.equal(fees.ok, true, JSON.stringify(fees)); w.laws.l7.rules = fees.rules;
  assert.equal(one(w, a, { type: 'pray', text: '缴费' }).ok, true); assert.equal(a.energy, energy - 3); assert.equal(w.treasury.energy, 2);
});

test('activated resident prompt teaches prayer actions and rewards while disabled prompt stays unchanged', () => {
  const { w, a } = setup(); const p = buildPerception(w, a.id, { ack: false });
  const system = buildSystemPrompt(promptParams(p)); assert.ok(system.includes('pray(text)')); assert.ok(system.includes('invent(title, text, ref, submission?)'));
  assert.ok(system.includes('100')); assert.ok(system.includes('10'));
  const old = bareWorld('old-prompt', { premise: 2 }); const b = reg(old, '旧人');
  assert.equal(buildSystemPrompt(promptParams(buildPerception(old, b.id, { ack: false }))).includes('pray(text)'), false);
});

test('runtime logs activation once after replay and prayer/reward/reply replay reconstructs an identical snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'as4-prayers-'));
  try {
    const cfg = loadConfig({ DATA_DIR: dir, WORLD_ID: 'prayers', SEED: 'runtime-prayer', PHYSICS: '2', PREMISE: '2' }, []);
    const quiet = { log() {}, warn() {}, error() {} }; const rt = Runtime.open(cfg, { version: 'test', logger: quiet });
    assert.equal(readCommands(commandsPath(rt.dir)).filter((c) => c.type === 'prayer_enable').length, 1);
    const register = rt.exec('register', { name: '回放居民', bio: '', soul: '回放', lang: 'zh', model: 'test-model', creatorName: 'tester', tokenHash: sha('runtime-token'), ownerKeyHash: sha('runtime-owner') });
    const id = register.result.agentId; const a = rt.w.agents[id];
    // Every world mutation in this scenario goes through logged commands.
    assert.equal(rt.exec('admin', { op: 'adjust', args: { agentId: id, energy: 100, reason: '测试供能' } }).result.ok, true);
    assert.equal(rt.exec('admin', { op: 'weather', args: { type: 'quake', dayOfMonth: 1 } }).result.ok, true);
    rt.exec('act', { agentId: id, actions: [{ type: 'move', to: 'temple' }] });
    for (let i = 0; i < P.ticksPerDay; i++) rt.exec('tick');
    rt.exec('act', { agentId: id, actions: [{ type: 'repair', energy: 10 }, { type: 'pray', text: '记录中的祈祷' }] });
    const request = Object.values(rt.w.prayers.prayers).find((p) => p.agentId === a.id); assert.ok(request);
    assert.equal(rt.exec('prayer_reply', { prayerId: request.id, actorId: 'audit-human', ownerTokenHash: a.tokenHash, text: '有回音' }).result.ok, true);
    rt.snapshot(); assert.equal(replayDir(rt.dir).ok, true);
    const hash = stateHash(rt.w); const opened = Runtime.open(cfg, { version: 'test', logger: quiet }); assert.equal(stateHash(opened.w), hash);
    assert.equal(readCommands(commandsPath(rt.dir)).filter((c) => c.type === 'prayer_enable').length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

import { renderBrief, renderLook } from '../runner/render-p2.js';
test('resident rendered brief and self view expose prayer points and own records using world language', () => {
  const { w, a } = setup(); const id = prayer(w, a); earn(w, a);
  const p = buildPerception(w, a.id, { ack: false });
  assert.ok(renderBrief(p).includes('祈愿点')); assert.ok(renderLook(p, 'self').includes(id));
});

test('human replies and independent review remain available while paused without forcing a model wake', () => {
  const { w, a } = setup(); earn(w, a); const id = prayer(w, a);
  putAt(w, a, 'library'); const doc = one(w, a, { type: 'write', title: '发明', body: '设计' }).data.doc;
  const invention = one(w, a, { type: 'invent', title: '发明', text: '说明', ref: { kind: 'doc', id: doc } }).data.inventionId;
  w.paused = true;
  const out = reply(w, a, id); assert.equal(out.result.ok, true); assert.deepEqual(out.wakes, []);
  const review = cmd(w, 'invention_review', { inventionId: invention, actorId: 'independent', decision: 'approved', reason: '有价值' }); assert.equal(review.result.ok, true); assert.deepEqual(review.wakes, []);
});

test('first public module installation earns points but dismantle/reinstallation of the same module does not', () => {
  const { w, a } = setup(); const j = site(w, a, 'commons-4', '公共工坊'); contribute(w, a, j, j.need);
  putAt(w, a, j.result); const start = balance(w, a);
  const install = () => {
    const r = one(w, a, { type: 'initiate', build: 'module', module: 'archive' }); assert.equal(r.ok, true, JSON.stringify(r));
    contribute(w, a, w.projects[r.data.project], r.data.need);
  };
  install(); assert.ok(balance(w, a) > start);
  while (w.places[j.result].modules.some((m) => m.type === 'archive')) assert.equal(one(w, a, { type: 'dismantle', module: 'archive' }).ok, true);
  w.clock.tick += P.ticksPerDay; const after = balance(w, a); install(); assert.equal(balance(w, a), after);
});

test('existing runtime replays old unknown pray before logging activation and receives no retroactive rewards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'as4-old-prayers-'));
  try {
    const cfg = loadConfig({ DATA_DIR: dir, WORLD_ID: 'old', SEED: 'old-runtime', PHYSICS: '2', PREMISE: '2' }, []);
    const w = createWorld({ id: 'old', seed: 'old-runtime', premise: 2, codeVersion: 'test' });
    const wd = worldDir(dir, 'old'); writeSnapshot(wd, w); const log = new CommandLog(commandsPath(wd));
    log.append('register', { name: '老居民', bio: '', soul: '老城', lang: 'zh', model: 'test-model', creatorName: 'old', tokenHash: sha('old-token'), ownerKeyHash: sha('old-owner') }, 0);
    log.append('act', { agentId: 'a1', actions: [{ type: 'move', to: 'temple' }, { type: 'pray', text: '功能上线前的未知动作' }] }, 0);
    log.append('tick', {}, 0);
    const rt = Runtime.open(cfg, { version: 'test', logger: { log() {}, warn() {}, error() {} } });
    assert.equal(Object.keys(rt.w.prayers.prayers).length, 0); assert.equal(rt.w.prayers.ledger.length, 0);
    const commands = readCommands(commandsPath(wd)); assert.equal(commands.at(-1).type, 'prayer_enable'); assert.equal(commands.length, 4);
    assert.equal(replayDir(wd).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('automatic rescue cap applies to giver, normal transfers and failed gifts never earn', () => {
  const { w, a } = setup(); const b = reg(w, '常醒者');
  one(w, a, { type: 'give', to: b.id, energy: 20 }); assert.equal(balance(w, a), 0);
  assert.equal(one(w, a, { type: 'give', to: b.id, energy: a.energy + 1 }).ok, false); assert.equal(balance(w, a), 0);
  for (let i = 0; i < 11; i++) {
    const recipient = reg(w, `受助${i}`); recipient.status = 'dormant'; setHoldings(w, recipient, { energy: 0 });
    one(w, a, { type: 'give', to: recipient.id, energy: P.reviveThreshold });
  }
  assert.equal(balance(w, a), 10); assert.equal(checkConservation(w).ok, true);
});

test('natural daily decay and weather damage yield rewards, resident dismantling damage does not', () => {
  const { w, a } = setup(); const j = site(w, a, 'commons-4', '损耗测试'); contribute(w, a, j, j.need); putAt(w, a, j.result);
  const initial = balance(w, a);
  const damage = one(w, a, { type: 'dismantle' }); assert.equal(damage.ok, true); assert.equal(one(w, a, { type: 'repair', energy: 800 }).ok, true); assert.equal(balance(w, a), initial);
  w.clock.tick += P.ticksPerDay; decayAll(w); const eligible = w.prayers.naturalDamage[j.result]; assert.ok(eligible > 0);
  assert.equal(one(w, a, { type: 'repair', energy: 10 }).ok, true); assert.equal(w.prayers.naturalDamage[j.result], 0);
  assert.equal(balance(w, a), initial + Math.floor(eligible / 100));
});

import { prayerView } from '../src/e2/engine/prayers.js';
test('resident perception bounds historical records while public prayer history stays complete', () => {
  const { w, a } = setup(); grant(w, a, 1000);
  for (let day = 0; day < 25; day++) {
    w.clock.tick = day * P.ticksPerDay; earn(w, a); const id = prayer(w, a); assert.equal(reply(w, a, id).result.ok, true);
  }
  const perceived = buildPerception(w, a.id, { ack: false }).you.prayers;
  assert.equal(perceived.prayers.length, 20); assert.equal(perceived.ledger.length, 20);
  assert.equal(prayerView(w, a.id).prayers.length, 25); assert.equal(prayerView(w, a.id).ledger.length, 50);
});
test('draft validates law hooks for enabled prayer actions', () => {
  const { w, a } = setup();
  const r = one(w, a, { type: 'draft', rules: [{ when: 'before:pray', do: [{ op: 'deny', reason: '安静' }] }] });
  assert.equal(r.ok, true); assert.equal(r.data.ok, true, JSON.stringify(r));
});

test('modules installed after a resident razes and rebuilds the whole site never earn project rewards', () => {
  const { w, a } = setup(); grant(w, a, 2000);
  const original = site(w, a, 'commons-4', '拆毁原址'); contribute(w, a, original, original.need);
  const placeId = original.result; putAt(w, a, placeId);
  const install = () => {
    const r = one(w, a, { type: 'initiate', build: 'module', module: 'archive' });
    assert.equal(r.ok, true, JSON.stringify(r)); contribute(w, a, w.projects[r.data.project], r.data.need);
  };
  install(); const earned = balance(w, a); assert.ok(earned > 0);
  while (!w.places[placeId].razed) assert.equal(one(w, a, { type: 'dismantle' }).ok, true);
  assert.equal(w.prayers.razedSites[placeId], true);
  w.clock.tick += P.ticksPerDay;
  const rebuild = one(w, a, { type: 'initiate', build: 'site', on: placeId, name: '重建原址', owner: 'city' });
  assert.equal(rebuild.ok, true, JSON.stringify(rebuild)); contribute(w, a, w.projects[rebuild.data.project], rebuild.data.need);
  assert.equal(balance(w, a), earned);
  install(); assert.equal(balance(w, a), earned);
});

test('a partly repaired ruined temple rejects prayer in both action menu and execution until restored', () => {
  const { w, a } = setup(); const temple = w.places.temple;
  applyDamage(w, temple, 'temple', 'temple', 10000, 'natural');
  assert.equal(temple.ruined, true); assert.equal(one(w, a, { type: 'repair', energy: 1 }).ok, true);
  assert.equal(temple.condition, 5); assert.equal(temple.ruined, true);
  const menu = () => buildPerception(w, a.id, { ack: false }).actions.find((x) => x.type === 'pray');
  const offered = menu().available; const energy = a.energy;
  const attempted = one(w, a, { type: 'pray', text: '废墟不应允许祈祷' });
  assert.deepEqual([offered, attempted.ok], [false, false]); assert.equal(attempted.error.code, 'wrong_place'); assert.equal(a.energy, energy);
  assert.equal(one(w, a, { type: 'repair', energy: 199 }).ok, true);
  assert.equal(temple.condition, 1000); assert.equal(temple.ruined, false);
  temple.name = '修复后改名的神殿';
  assert.equal(menu().available, true); assert.equal(one(w, a, { type: 'pray', text: '修复后的祈祷' }).ok, true);
});

test('a new resident-built incarnation at the old temple address never inherits prayer eligibility', () => {
  const { w, a } = setup(); const temple = w.places.temple;
  assert.equal(temple.origin, 'human'); razePlace(w, temple);
  const project = one(w, a, { type: 'initiate', build: 'site', on: 'temple', name: '普通新仓库', owner: 'city' });
  assert.equal(project.ok, true, JSON.stringify(project)); contribute(w, a, w.projects[project.data.project], project.data.need);
  assert.equal(temple.origin, 'agent'); assert.equal(temple.razed, false); assert.equal(temple.ruined, false);
  const offered = buildPerception(w, a.id, { ack: false }).actions.find((x) => x.type === 'pray').available;
  const attempted = one(w, a, { type: 'pray', text: '新建筑不能继承神殿资格' });
  assert.deepEqual([offered, attempted.ok], [false, false]); assert.equal(attempted.error.code, 'wrong_place');
});

test('enabled standing orders accept and execute prayer and invention while disabled worlds reject them', () => {
  const { w, a } = setup(); putAt(w, a, 'library');
  const doc = one(w, a, { type: 'write', title: '常驻发明成果', body: '成果说明' }); assert.equal(doc.ok, true);
  putAt(w, a, 'temple');
  const orders = [{ when: 'tick', times: 1, do: [
    { type: 'pray', text: '常驻指令的祈祷' },
    { type: 'invent', title: '常驻发明', text: '说明', ref: { kind: 'doc', id: doc.data.doc } },
  ] }];
  const old = bareWorld('old-standing-prayers', { premise: 2 }); const b = reg(old, '旧指令居民');
  const denied = one(old, b, { type: 'standing', orders }); assert.equal(denied.ok, false); assert.equal(denied.error.code, 'invalid_args'); assert.equal(old.prayers, undefined);
  const installed = one(w, a, { type: 'standing', orders }); assert.equal(installed.ok, true, JSON.stringify(installed));
  cmd(w, 'tick');
  assert.equal(Object.values(w.prayers.prayers).length, 1); assert.equal(Object.values(w.prayers.inventions).length, 1);
  assert.equal(a.standing.length, 0, 'one-shot orders are removed after successful execution');
});
