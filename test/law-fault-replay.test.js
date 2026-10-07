import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/runtime.js';
import { registerCommand } from '../src/e2/engine/index.js';
import { readCommands } from '../src/commands.js';
import { commandsPath, snapshotPath, stateHash } from '../src/store.js';
import { replayDir } from '../src/tools/replay.js';
const logger = { log() {}, warn() {}, error() {} };
function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'law-receipt-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const cfg = { dataDir, worldId: 'test', physics: 2, premise: 2, seed: 'receipt', tickMs: 100000, sandboxAgents: 0 };
  return { cfg, rt: Runtime.open(cfg, { logger }) };
}
test('fault, blocked write and recovery receipts survive repaired handlers, tail and full replay', t => {
  const { cfg, rt } = setup(t), baseline = readFileSync(snapshotPath(rt.dir));
  registerCommand('receipt_fault_test', w => { w.vars.leak = 1; throw new Error('private'); });
  const out = rt.exec('receipt_fault_test', { secret: 'private' });
  assert.equal(out.result.error.reason, 'law_execution_fault');
  const faultHash = stateHash(rt.w);
  registerCommand('receipt_fault_test', w => { w.vars.leak = 2; return { ok: true }; });
  assert.equal(rt.exec('tick').result.ok, false);
  assert.equal(rt.exec('admin', { op: 'law_recover' }).result.probe, 'success');
  assert.equal(rt.w.vars.leak, undefined);
  const finalHash = stateHash(rt.w);
  rt.snapshot();
  assert.equal(replayDir(rt.dir).ok, true);
  assert.equal(replayDir(rt.dir, { toN: out.cmd.n }).hash, faultHash);
  registerCommand('receipt_fault_test', () => { throw new Error('repair changed again'); });
  assert.equal(replayDir(rt.dir).ok, true, 'recovery is recorded, never reprobed');
  writeFileSync(snapshotPath(rt.dir), baseline);
  const reopened = Runtime.open(cfg, { logger });
  assert.equal(stateHash(reopened.w), finalHash);
});
test('durable append failure stops runtime without exposing candidate state/events/wakes/snapshot', t => {
  const { rt } = setup(t), before = stateHash(rt.w), snapshot = readFileSync(snapshotPath(rt.dir), 'utf8');
  const append = rt.log.appendReceipt;
  rt.log.appendReceipt = () => { throw new Error('disk failed'); };
  assert.throws(() => rt.exec('tick'), /disk failed/);
  assert.equal(stateHash(rt.w), before);
  assert.equal(readFileSync(snapshotPath(rt.dir), 'utf8'), snapshot);
  assert.equal(rt.stopped, true);
  rt.log.appendReceipt = append;
  assert.throws(() => rt.exec('tick'), /stopped|closed/i);
});
test('receipt without terminating newline is incomplete in both replay and startup repair', t => {
  const { cfg, rt } = setup(t), baseline = readFileSync(snapshotPath(rt.dir));
  rt.exec('tick');
  const file = commandsPath(rt.dir), text = readFileSync(file, 'utf8');
  writeFileSync(file, text.slice(0, -1));
  assert.equal(readCommands(file).length, rt.w.commandN - 1);
  writeFileSync(snapshotPath(rt.dir), baseline);
  const reopened = Runtime.open(cfg, { logger });
  assert.equal(reopened.w.clock.tick, 0);
  assert.equal(readCommands(file).length, reopened.w.commandN);
});

test('complete durable append recovers exactly once after crash before visible commit', t => {
  const { cfg, rt } = setup(t), snapshot = readFileSync(snapshotPath(rt.dir)), before = stateHash(rt.w);
  const append = rt.log.appendReceipt.bind(rt.log);
  rt.log.appendReceipt = (cmd, receipt) => { append(cmd, receipt); throw new Error('crash after fsync'); };
  assert.throws(() => rt.exec('tick'), /crash after fsync/);
  assert.equal(stateHash(rt.w), before);
  assert.deepEqual(readFileSync(snapshotPath(rt.dir)), snapshot);
  const recovered = Runtime.open(cfg, { logger });
  assert.equal(recovered.w.clock.tick, 1);
  assert.equal(replayDir(rt.dir).ok, true);
  assert.equal(Runtime.open(cfg, { logger }).w.clock.tick, 1);
});

test('partial append is discarded, complete corrupted frames fail closed', t => {
  const { cfg, rt } = setup(t), snapshot = readFileSync(snapshotPath(rt.dir));
  const file = commandsPath(rt.dir), previous = readFileSync(file, 'utf8');
  rt.exec('tick');
  const full = readFileSync(file, 'utf8'), frame = full.slice(previous.length);
  for (const cut of [1, Math.floor(frame.length / 2), frame.length - 2, frame.length - 1]) {
    writeFileSync(file, previous + frame.slice(0, cut));
    writeFileSync(snapshotPath(rt.dir), snapshot);
    const recovered = Runtime.open(cfg, { logger });
    assert.equal(recovered.w.clock.tick, 0);
    assert.equal(readFileSync(file, 'utf8'), previous);
  }
  const corrupted = JSON.parse(frame); corrupted.command.receipt.out.result.tick = 999;
  writeFileSync(file, previous + JSON.stringify(corrupted) + '\n');
  assert.throws(() => readCommands(file), /校验失败/);
});

test('receipt rejects wrong source state instead of silently applying a delta', async t => {
  const { rt } = setup(t);
  const before = structuredClone(rt.w);
  rt.exec('tick');
  const row = readCommands(commandsPath(rt.dir)).at(-1);
  before.vars.unrecorded = 1;
  const { applyCommand } = await import('../src/e2/engine/index.js');
  const hash = stateHash(before);
  assert.throws(() => applyCommand(before, row), /pre-state/);
  assert.equal(stateHash(before), hash);
});

test('legacy original genesis and explicit mid-world semantics migration replay and restart equally', async t => {
  const { createWorld } = await import('../src/e2/world.js');
  const { writeSnapshot } = await import('../src/store.js');
  const { CommandLog } = await import('../src/commands.js');
  const { applyCommand } = await import('../src/e2/engine/index.js');
  const { cfg, rt } = setup(t);
  const legacy = createWorld({ id: cfg.worldId, seed: cfg.seed, codeVersion: '0.0.0', premise: 2, map: 'frontier', sandboxAdoption: false, sandboxShells: false });
  writeFileSync(commandsPath(rt.dir), '');
  const log = new CommandLog(commandsPath(rt.dir));
  applyCommand(legacy, log.append('prayer_enable', {}, 0));
  applyCommand(legacy, log.append('tick', {}, 0));
  writeSnapshot(rt.dir, legacy);
  const oldSnapshot = readFileSync(snapshotPath(rt.dir));
  const migrated = Runtime.open(cfg, { logger });
  assert.equal(migrated.w.lawSemantics, undefined);
  assert.equal(migrated.exec('admin', { op: 'law_semantics', args: { version: 2 } }).result.ok, true);
  migrated.exec('tick'); migrated.snapshot();
  assert.equal(migrated.w.genesis.lawSemanticsVersion, undefined);
  assert.equal(replayDir(rt.dir).ok, true);
  const hash = stateHash(migrated.w);
  writeFileSync(snapshotPath(rt.dir), oldSnapshot);
  assert.equal(stateHash(Runtime.open(cfg, { logger }).w), hash);
});

test('receipt preserves ordinary map keys named constructor without touching prototypes', t => {
  const { rt } = setup(t);
  registerCommand('map_key_test', w => { Object.defineProperty(w.vars, 'constructor', { value: { value: 42 }, writable: true, configurable: true, enumerable: true }); return { ok: true }; });
  rt.exec('map_key_test'); rt.snapshot();
  assert.equal(replayDir(rt.dir).ok, true);
  assert.equal(Object.prototype.value, undefined);
});

test('fault receipt remains recoverable when control snapshot crashes', t => {
  const { cfg, rt } = setup(t);
  registerCommand('snapshot_fault_test', () => { throw new Error('engine fault'); });
  rt.snapshot = () => { throw new Error('snapshot crash'); };
  assert.throws(() => rt.exec('snapshot_fault_test'), /snapshot crash/);
  const hash = stateHash(rt.w);
  registerCommand('snapshot_fault_test', () => ({ ok: true }));
  const recovered = Runtime.open(cfg, { logger });
  assert.equal(stateHash(recovered.w), hash);
  assert.equal(recovered.w.paused, true);
  assert.equal(replayDir(rt.dir).ok, true);
});

test('capacity failure receipts remain failures after capacity handler changes', async t => {
  const { register } = await import('../src/e2/engine/lifecycle.js');
  const { sha } = await import('./e2-helpers.js');
  const { cfg, rt } = setup(t), baseline = readFileSync(snapshotPath(rt.dir));
  assert.equal(rt.exec('admin', { op: 'law_execution', args: { version: 2, capacity: { maxAgents: 1 } } }).result.ok, true);
  const payload = name => ({ name, bio: '', soul: 's', lang: 'zh', model: 'm', tokenHash: sha(name), ownerKeyHash: sha(name + '-key') });
  assert.equal(rt.exec('register', payload('first')).result.ok, true);
  assert.equal(rt.exec('register', payload('second')).result.error.reason, 'law_execution_capacity');
  assert.equal(rt.w.lawSemantics.protection, undefined);
  assert.equal(Object.keys(rt.w.agents).length, 1);
  const hash = stateHash(rt.w);
  registerCommand('register', () => ({ ok: true }));
  try {
    writeFileSync(snapshotPath(rt.dir), baseline);
    assert.equal(stateHash(Runtime.open(cfg, { logger }).w), hash);
    assert.equal(replayDir(rt.dir).ok, true);
  } finally { registerCommand('register', register); }
});

test('new program protection while manually paused publishes control and snapshots fault', t => {
  const { rt } = setup(t);
  rt.exec('admin', { op: 'pause', args: { experiment: true } });
  const control = [];
  rt.events.subscribe((name, data) => { if (name === 'control') control.push(data); });
  registerCommand('paused_fault_test', () => { throw new Error('fault while paused'); });
  rt.exec('paused_fault_test');
  assert.equal(control.length, 1);
  assert.equal(JSON.parse(readFileSync(snapshotPath(rt.dir), 'utf8')).lawSemantics.protection.commandN, rt.w.commandN);
});
