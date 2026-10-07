import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorld, reg, one } from './e2-helpers.js';
import { createWorld, genesisOpts } from '../src/e2/world.js';
import { applyCommand } from '../src/e2/engine/index.js';

test('law semantics opt-in is persisted as original genesis selection', () => {
  const w = newWorld('repair', { lawSemanticsVersion: 2 });
  assert.equal(w.lawSemantics?.version, 2);
  assert.equal(genesisOpts(w).lawSemanticsVersion, 2);
  assert.deepEqual(createWorld(genesisOpts(w)), w);
});

test('legacy genesis stays legacy through a replayable explicit migration', () => {
  const w = newWorld('repair');
  const original = structuredClone(w);
  assert.equal(Object.hasOwn(w, 'lawSemantics'), false);
  assert.equal(Object.hasOwn(w.genesis, 'lawSemanticsVersion'), false);
  const cmd = { type: 'admin', payload: { op: 'law_semantics', args: { version: 2 } } };
  assert.equal(applyCommand(w, cmd).result.ok, true);
  assert.equal(w.lawSemantics.version, 2);
  assert.equal(genesisOpts(w).lawSemanticsVersion, undefined);
  const replay = createWorld(genesisOpts(w));
  assert.deepEqual(replay, original);
  applyCommand(replay, cmd);
  assert.deepEqual(replay, w);
  assert.deepEqual(w.laws, original.laws, 'migration never rewrites human or resident programs');
});

test('open legacy refounds block migration with identifiers and deadlines', () => {
  const w = newWorld('repair');
  const a = reg(w, '青禾');
  const result = one(w, a, { type: 'refound', text: '恢复', procedure: 'humans' });
  const before = structuredClone(w);
  const out = applyCommand(w, { type: 'admin', payload: { op: 'law_semantics', args: { version: 2 } } });
  assert.equal(out.result.ok, false);
  assert.equal(out.result.error.code, 'open_refounds');
  assert.deepEqual(out.result.error.refounds, [{ id: result.data.refound, expiresTick: result.data.expiresTick }]);
  before.commandN = w.commandN;
  assert.deepEqual(w, before);
  assert.deepEqual(out.events, []);
});


test('runtime new second epoch opts in, existing legacy snapshot stays legacy, migration tail/full replay agree', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { Runtime } = await import('../src/runtime.js');
  const { writeSnapshot, worldDir, commandsPath } = await import('../src/store.js');
  const { readCommands } = await import('../src/commands.js');
  const dir = mkdtempSync(join(tmpdir(), 'law-semantics-'));
  const cfg = { dataDir: dir, worldId: 'test', seed: 'repair', physics: 2, tickMs: 300000 };
  let rt;
  try {
    rt = Runtime.open(cfg, { logger: {} });
    assert.equal(rt.w.lawSemantics.version, 2);
    rt.close();
    const legacy = newWorld('repair');
    writeSnapshot(worldDir(dir, 'test'), legacy);
    rt = Runtime.open(cfg, { logger: {} });
    assert.equal(Object.hasOwn(rt.w, 'lawSemantics'), false);
    rt.exec('admin', { op: 'law_semantics', args: { version: 2 } });
    rt.exec('tick');
    const expected = structuredClone(rt.w);
    rt.close();
    // Restore the original snapshot to force a crash-tail replay crossing the explicit migration.
    writeSnapshot(worldDir(dir, 'test'), legacy);
    rt = Runtime.open(cfg, { logger: {} });
    assert.deepEqual(rt.w, expected);
    const all = createWorld(genesisOpts(rt.w));
    for (const cmd of readCommands(commandsPath(worldDir(dir, 'test')))) applyCommand(all, cmd);
    assert.deepEqual(all, expected);
  } finally {
    rt?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
