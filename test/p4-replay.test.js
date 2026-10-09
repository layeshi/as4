import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import e2 from '../src/e2/facade.js';
import { sha, rngFor } from './e2-helpers.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
import { stateHash } from '../src/store.js';
import { replayDir } from '../src/tools/replay.js';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';

const registration = (name, cap) => ({ name, soul: `我是${name}`, lang: 'zh', model: 'mock', tokenHash: sha(`t:${name}`), ownerKeyHash: sha(`k:${name}`), dailyCap: cap });
const earth = tick => `2026-10-${String(9 + Math.floor(tick / 96)).padStart(2, '0')}`;
function driver(w) {
  const commands = [];
  const command = (type, payload) => {
    const cmd = JSON.parse(JSON.stringify({ type, payload }));
    commands.push(structuredClone(cmd));
    const out = e2.applyCommand(w, cmd);
    assert.equal(w.paused, false, JSON.stringify(out.result));
    assert.equal(checkConservation(w).ok, true, `command ${commands.length} ${type}: ${JSON.stringify(checkConservation(w))}`);
    assert.equal(w.ledger.mismatches, 0);
    for (const a of Object.values(w.agents)) for (const key of ['energy','basic']) assert.ok(Number.isSafeInteger(a[key]) && a[key] >= 0, `${a.id}.${key}`);
    return out;
  };
  const wake = (a, kind = 'main') => command('meter', { op: 'wake', agentId: a.id, wakeId: `w${w.clock.tick}-${commands.length.toString(16).padStart(6,'0')}`, day: earth(w.clock.tick), kind, system: 1000, brief: 700, delivered: a.delivered }).result;
  const act = (a, actions, extra = {}) => command('act', { agentId: a.id, actions, meter: { wakeId: a.tokens.waking.id, turn: 1, reread: 0, day: earth(w.clock.tick) }, ...extra });
  return { commands, command, wake, act };
}

test('P4 T15/T16: 60 world days conserve every command and replay identically, including upgrades/refunds/caps/admin', context => {
  const w = e2.createWorld({ id: 'p4-long', seed: 'p4-long-60', premise: 4, lawSemanticsVersion: 2 });
  const d = driver(w);
  for (const [name, cap] of [['甲',50000000],['乙',30000],['丙',0]]) d.command('register', registration(name, cap));
  const [a,b,c] = Object.values(w.agents);
  d.command('admin', { op: 'adjust', args: { agentId: a.id, energy: 2000000, reason: 'mock fixture funding' } });
  d.wake(a);
  d.act(a, [{ type: 'move', to: 'well' }, { type: 'initiate', build: 'upgrade', owner: 'self' }, { type: 'contribute', project: 'j1', energy: 1100000 }]);
  assert.equal(w.well.upgrades.length, 1);
  let days = 0, refused = 0;
  for (let t = 0; t < 60 * 12; t++) {
    if (t % 12 === 0) {
      const day = t / 12;
      if (day === 1) d.command('cap', { agentId: c.id, cap: 100000 });
      if (day === 5) d.command('admin', { op: 'well_supply', args: { permille: 1200 } });
      if (day === 10) d.command('admin', { op: 'basic_allotment', args: { basic: 20000 } });
      if (day % 7 === 0) d.command('cap', { agentId: b.id, cap: day % 14 === 0 ? 1 : 30000 });
      for (const actor of Object.values(w.agents).filter(x => x.status === 'awake')) {
        const woke = d.wake(actor);
        if (!woke.ok) { refused++; continue; }
        if (actor.id === c.id && day % 8 === 0) {
          d.command('meter', { op: 'refund', agentId: actor.id, wakeId: actor.tokens.waking.id, day: earth(t) });
          continue;
        }
        d.command('meter', { op: 'look', agentId: actor.id, wakeId: actor.tokens.waking.id, day: earth(t), reread: 0, read: 100 });
        const actions = actor.id === a.id && day === 30 ? [{ type: 'retire', lastWords: '模拟验收' }]
          : [{ type: 'say', text: `模拟第${day}日` }, { type: 'routine', every: day % 4 + 1, called: day % 2 === 0, brief: day % 2 ? 'short' : 'full' }];
        const result = d.act(actor, actions);
        assert.equal(result.result.ok, true);
      }
    }
    d.command('tick');
    if (w.clock.tick % 12 === 0) { days++; assert.equal(w.metrics.length, days); }
  }
  assert.equal(days, 60);
  assert.ok(refused > 0);
  assert.equal(w.agents.a1.status, 'retired');
  assert.ok(w.metrics.some(m => m.p4.dividends > 0));
  assert.ok(w.metrics.some(m => m.p4.refunded > 0));
  assert.equal(w.well.upgrades[0].shares.a1, undefined);
  const replay = e2.createWorld(e2.genesisOpts(w));
  for (const cmd of d.commands) e2.applyCommand(replay, cmd);
  assert.equal(stateHash(replay), stateHash(w));
  context.diagnostic(`P4 60 days: ${d.commands.length} commands; 0 conservation failures; replay ${stateHash(w)}`);
});

for (const seed of ['a','b','c']) test(`P4 T13: deterministic boundary fuzz ${seed}, conservation and replay`, () => {
  const w = e2.createWorld({ seed: `p4-fuzz-${seed}`, premise: 4, lawSemanticsVersion: 2, tokens: { capacity: 6000, basic: 4000 } });
  const d = driver(w), random = rngFor(seed);
  d.command('register', registration('甲', 50000000));
  d.command('register', registration('乙', 50000000));
  const [a,b] = Object.values(w.agents);
  d.command('admin', { op: 'adjust', args: { agentId: a.id, energy: 1000000, reason: 'fuzz fixture' } });
  const amounts = [0, -1, null, 1.5, 1, 10, 200, 201, Number.MAX_SAFE_INTEGER];
  const actions = () => random.pick([
    { type: 'move', to: random.pick(['well','library','market','port','missing']) },
    { type: 'draw', energy: random.pick(amounts) },
    { type: 'repair', energy: random.pick(amounts) },
    { type: 'give', to: b.id, energy: random.pick(amounts) },
    { type: 'remember', text: `记忆${random.int(100)}` },
    { type: 'routine', every: random.pick([0,1,36,37,-1,null]), called: random.pick([true,false,null]) },
    { type: 'initiate', build: 'upgrade', owner: random.pick(['self','city','bad',null]) },
    { type: 'contribute', project: 'j1', energy: random.pick(amounts) },
    { type: 'read', law: random.pick(['l1','l2','missing']) },
    { type: 'draft', rules: random.pick([[],[{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '模拟' }] }],null]) },
    { type: 'say', text: '随机试验' },
  ]);
  for (let i = 0; i < 160; i++) {
    if (i % 3 === 0) d.command('tick');
    if (i % 11 === 0) d.command('cap', { agentId: a.id, cap: random.pick([0,50000000,10000,-1,1.5]) });
    if (a.status !== 'awake') continue;
    const woke = d.wake(a, i % 2 ? 'main' : 'wake');
    if (!woke.ok) continue;
    d.act(a, [actions(), actions()]);
  }
  const replay = e2.createWorld(e2.genesisOpts(w));
  for (const command of d.commands) e2.applyCommand(replay, command);
  assert.equal(stateHash(w), stateHash(replay));
});

test('P4 T16: persisted Runtime receipts replay and reopening retains metering state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p4-receipts-'));
  let rt;
  try {
    const cfg = loadConfig({ PHYSICS: '2', PREMISE: '4', WORLD_ID: 'w', DATA_DIR: dir, SEED: 'receipts4' }, []);
    rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
    const a = rt.exec('register', registration('甲',50000000)).result.agentId;
    rt.exec('meter', { op: 'wake', agentId: a, wakeId: 'w0-abcdef', day: '2026-10-09', system: 100, brief: 200, delivered: 0, kind: 'main' });
    rt.exec('meter', { op: 'refund', agentId: a, wakeId: 'w0-abcdef', day: '2026-10-09' });
    rt.exec('cap', { agentId: a, cap: 100000 });
    rt.exec('meter', { op: 'wake', agentId: a, wakeId: 'w0-fedcba', day: '2026-10-10', system: 100, brief: 200, delivered: 0, kind: 'main' });
    rt.exec('act', { agentId: a, actions: [{ type: 'routine', brief: 'short' }], meter: { wakeId: 'w0-fedcba', reread: 0, turn: 1, day: '2026-10-10' } });
    for (let i = 0; i < 12; i++) rt.exec('tick');
    const hash = stateHash(rt.w); rt.close();
    assert.equal(replayDir(join(dir, 'w')).ok, true);
    rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
    assert.equal(stateHash(rt.w), hash);
    assert.equal(rt.w.agents[a].routine.brief, 'short');
    assert.equal(rt.w.agents[a].tokens.day, '2026-10-10');
  } finally { rt?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('P4 numeric action hints contain world values rather than catalog placeholders', () => {
  const w = e2.createWorld({ seed: 'hints4', premise: 4, tokens: { capacity: 6000 } }), d = driver(w);
  d.command('register', registration('甲',50000000));
  const a = w.agents.a1;
  d.command('admin', { op: 'adjust', args: { agentId: a.id, energy: 1000, reason: 'fixture' } });
  d.wake(a); d.act(a, [{ type: 'move', to: 'well' }]);
  const r = d.act(a, [{ type: 'draw', energy: 201 }]).result.results[0];
  assert.equal(r.error.code, 'invalid_args');
  assert.ok(!/\{(?:K|\d+K|capacity)\}/.test(JSON.stringify(r.error.hint)));
  assert.ok(r.error.hint.zh.includes('200'));
});

test('P4 perception shows this world day’s waking counters before its first paid wake', () => {
  const w = e2.createWorld({ seed: 'daily-view4', premise: 4 }), d = driver(w);
  d.command('register', registration('甲',50000000));
  const a = w.agents.a1;
  d.wake(a); d.wake(a, 'wake');
  for (let i = 0; i < 12; i++) d.command('tick');
  const p = e2.buildPerception(w, a.id, { ack: false });
  assert.deepEqual([p.you.tokens.wakes, p.you.tokens.called, p.you.tokens.calledCost], [0,0,0]);
});

import { runActions } from '../src/e2/engine/actions.js';
import { reg, grant, bareWorld } from './e2-helpers.js';
test('P4 T3: exploration consumes the original random stream and scales only energy outcomes', () => {
  const old = bareWorld('explore-equivalence', { premise: 2, shellSlots: 0 });
  const w = bareWorld('explore-equivalence', { premise: 4, tokens: { capacity: 6000 } });
  const a0 = reg(old, '甲'), a4 = reg(w, '甲', { dailyCap: 50000000 });
  const wild = Object.keys(w.regions)[0];
  a0.place = wild; a4.place = wild;
  grant(old, a0, 1000); grant(w, a4, 10000);
  let energy = 0;
  for (let i = 0; i < 20; i++) {
    a0.actsThisTick = 0; a4.actsThisTick = 0;
    const left = runActions(old, a0, [{ type: 'explore' }])[0];
    const right = runActions(w, a4, [{ type: 'explore' }])[0];
    assert.equal(left.ok, true); assert.equal(right.ok, true);
    assert.equal(left.data.outcome, right.data.outcome);
    if (left.data.outcome === 'energy') { energy++; assert.equal(right.data.amount, left.data.amount * 10); }
    if (left.data.outcome === 'coins') assert.equal(right.data.amount, left.data.amount);
    assert.deepEqual(w.rng, old.rng);
    assert.equal(checkConservation(w).ok, true);
  }
  assert.ok(energy > 0);
});
