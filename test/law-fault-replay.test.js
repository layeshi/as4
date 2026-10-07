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
import { createLaw } from '../src/e2/engine/laws.js';
import { pushInbox } from '../src/e2/engine/core.js';
import { P } from '../src/e2/params.js';
import { sha } from './e2-helpers.js';
const logger = { log() {}, warn() {}, error() {} };
function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'law-receipt-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const cfg = { dataDir, worldId: 'test', physics: 2, premise: 2, seed: 'receipt', tickMs: 100000, sandboxAgents: 0 };
  return { cfg, rt: Runtime.open(cfg, { logger }) };
}
test('inbox overflow preserves shared law outcomes, resident identity and durable full replay', t => {
  const { cfg, rt } = setup(t);
  for (const name of ['First', 'Second']) assert.equal(rt.exec('register', {
    name, soul: 's', bio: '', lang: 'zh', model: 'm', creatorName: '', tokenHash: sha(name), ownerKeyHash: sha(name),
  }).result.ok, true);
  registerCommand('receipt_inbox_fixture', w => {
    const [a, b] = Object.values(w.agents);
    a.inbox = []; b.inbox = [];
    const law = createLaw(w, { title: 'No enact', text: 'x', author: a.id });
    pushInbox(w, a, 'law', { lawId: law.id, enact: law.enact });
    pushInbox(w, b, 'law', { lawId: law.id, enact: law.enact });
    // Same shared outcome as notifyResult; trimming only a's inbox moves a
    // different outcome into its old slot, which must not rewrite b or the law.
    pushInbox(w, a, 'law', { lawId: 'other', enact: { status: 'success', diagnostics: [] } });
    while (a.inbox.length < P.inboxKeep) pushInbox(w, a, 'letter', { text: 'older' });
    a.inboxCursor = a.inbox.at(-1).seq;
    return { ok: true, lawId: law.id };
  });
  const lawId = rt.exec('receipt_inbox_fixture').result.lawId;
  rt.snapshot();
  const beforeOverflow = readFileSync(snapshotPath(rt.dir));
  const [a, b] = Object.values(rt.w.agents), inbox = a.inbox;
  const cmd = { n: rt.w.commandN + 1, type: 'letter', payload: { agentId: a.id, text: 'new' } };
  const { candidate } = rt.engine.prepareCommand(rt.w, cmd);
  assert.equal(rt.exec(cmd.type, cmd.payload).result.ok, true);
  assert.equal(stateHash(rt.w), stateHash(candidate), 'visible commit matches recorded candidate');
  assert.equal(rt.w.agents[a.id], a);
  assert.equal(a.inbox, inbox);
  assert.equal(rt.w.laws[lawId].enact.status, 'no_enact');
  assert.equal(b.inbox[0].enact.status, 'no_enact');
  rt.exec('letter', { agentId: b.id, text: 'next command' });
  const hash = stateHash(rt.w);
  rt.snapshot();
  assert.equal(replayDir(rt.dir).hash, hash);
  writeFileSync(snapshotPath(rt.dir), beforeOverflow);
  assert.equal(stateHash(Runtime.open(cfg, { logger }).w), hash);
});
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
  registerCommand('map_key_remove_test', w => { delete w.vars.constructor; return { ok: true }; });
  rt.exec('map_key_remove_test'); rt.snapshot();
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

test('event append failure fail-stops; close cannot snapshot past missing events and reopen repairs them', async t => {
  const { emit } = await import('../src/e2/engine/core.js');
  const { cfg, rt } = setup(t), before = readFileSync(snapshotPath(rt.dir));
  registerCommand('event_failure_test', w => { w.vars.committed = 1; emit(w, 'receipt_event'); return { ok: true }; });
  rt.events.append = () => { throw new Error('event EIO'); };
  assert.throws(() => rt.exec('event_failure_test'), /event EIO/);
  assert.equal(rt.stopped, true);
  assert.equal(rt.w.vars.committed, 1, 'receipt already committed this state');
  rt.close();
  assert.deepEqual(readFileSync(snapshotPath(rt.dir)), before, 'failed publication cannot advance the snapshot');
  const reopened = Runtime.open(cfg, { logger });
  assert.equal(reopened.w.vars.committed, 1);
  assert.equal(reopened.events.since(0, 100).filter(e => e.type === 'receipt_event').length, 1);
  assert.equal(replayDir(rt.dir).ok, true);
});

test('event sync failure prevents any advanced snapshot, including later close', t => {
  const { rt } = setup(t), before = readFileSync(snapshotPath(rt.dir));
  rt.exec('tick');
  rt.events.sync = () => { throw new Error('event fsync failed'); };
  assert.throws(() => rt.snapshot(), /event fsync failed/);
  assert.equal(rt.stopped, true);
  assert.deepEqual(readFileSync(snapshotPath(rt.dir)), before);
  rt.close();
  assert.deepEqual(readFileSync(snapshotPath(rt.dir)), before);
});

test('malformed complete terminal receipt fails closed in read and repair without altering evidence', async t => {
  const { repairCommandLog } = await import('../src/commands.js');
  const { rt } = setup(t);
  rt.exec('tick');
  const file = commandsPath(rt.dir), full = readFileSync(file, 'utf8');
  const cut = full.lastIndexOf('\n', full.length - 2) + 1;
  const broken = full.slice(0, cut) + full.slice(cut, -2) + '!\n';
  writeFileSync(file, broken);
  assert.throws(() => readCommands(file), /损坏|回执/);
  assert.throws(() => repairCommandLog(file), /损坏|回执/);
  assert.equal(readFileSync(file, 'utf8'), broken);
});

test('startup event truncation uses atomic replacement; a pre-rename crash retains original log', async t => {
  const fs = (await import('node:fs')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { EventStore } = await import('../src/events.js');
  const { eventsPath } = await import('../src/store.js');
  const { rt } = setup(t), file = eventsPath(rt.dir);
  const original = [1, 2].map(seq => JSON.stringify({ seq, tick: 0, type: 'test', vis: 'public', data: {} })).join('\n') + '\n';
  writeFileSync(file, original);
  t.mock.method(fs, 'renameSync', () => { throw new Error('crash before event rename'); });
  syncBuiltinESMExports();
  try {
    assert.throws(() => new EventStore(file).load({ keepSeq: 1 }), /crash before event rename/);
    assert.equal(readFileSync(file, 'utf8'), original);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  const events = new EventStore(file); events.load({ keepSeq: 1 });
  assert.equal(events.lastSeq, 1);
  assert.equal(readFileSync(file, 'utf8'), original.split('\n')[0] + '\n');
});

test('startup leaves an already correct event file untouched', async t => {
  const fs = await import('node:fs');
  const { EventStore } = await import('../src/events.js');
  const { eventsPath } = await import('../src/store.js');
  const { rt } = setup(t), file = eventsPath(rt.dir);
  const original = JSON.stringify({ seq: 1, tick: 0, type: 'test', vis: 'public', data: {} }) + '\n';
  writeFileSync(file, original);
  fs.utimesSync(file, new Date(0), new Date(0));
  new EventStore(file).load({ keepSeq: 1 });
  assert.equal(fs.statSync(file).mtimeMs, 0);
});

test('real event file and directory fsync precede snapshot fsync', async t => {
  const fs = (await import('node:fs')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { eventsPath } = await import('../src/store.js');
  const { rt } = setup(t); rt.exec('tick');
  const eventInode = fs.statSync(eventsPath(rt.dir)).ino, calls = [], original = fs.fsyncSync;
  t.mock.method(fs, 'fsyncSync', fd => {
    const info = fs.fstatSync(fd);
    calls.push(info.isDirectory() ? 'directory' : info.ino === eventInode ? 'events' : 'snapshot');
    original(fd);
  });
  syncBuiltinESMExports();
  try { rt.snapshot(); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.deepEqual(calls, ['events', 'directory', 'snapshot']);
});

test('command tail repair crash before atomic rename preserves acknowledged receipt prefix', async t => {
  const fs = (await import('node:fs')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { repairCommandLog } = await import('../src/commands.js');
  const { rt } = setup(t), file = commandsPath(rt.dir);
  const complete = readFileSync(file, 'utf8'), original = complete + '{"format":"command-receipt-v1"';
  writeFileSync(file, original);
  t.mock.method(fs, 'renameSync', () => { throw new Error('crash before command rename'); });
  syncBuiltinESMExports();
  try {
    assert.throws(() => repairCommandLog(file), /crash before command rename/);
    assert.equal(readFileSync(file, 'utf8'), original);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  repairCommandLog(file);
  assert.equal(readFileSync(file, 'utf8'), complete);
});

test('capacity-rejected legacy migration keeps durable event barriers and historical failed outcome', async t => {
  const { createWorld } = await import('../src/e2/world.js');
  const { writeSnapshot, worldDir } = await import('../src/store.js');
  const { EventStore } = await import('../src/events.js');
  const { capacityCheck } = await import('../src/e2/engine/law-execution.js');
  const { adminCommand } = await import('../src/e2/engine/admin.js');
  const dataDir = mkdtempSync(join(tmpdir(), 'law-migration-capacity-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const cfg = { dataDir, worldId: 'test', physics: 2, premise: 2, seed: 'review-migration-capacity', tickMs: 100000, sandboxAgents: 0 };
  const dir = worldDir(dataDir, cfg.worldId);
  writeSnapshot(dir, createWorld({ id: cfg.worldId, seed: cfg.seed, codeVersion: '0.0.0', premise: 2 }));
  const rt = Runtime.open(cfg, { logger });
  const admin = (op, args = {}) => rt.exec('admin', { op, args });
  assert.equal(admin('law_execution', { version: 2 }).result.ok, true);
  const limit = Buffer.byteLength(JSON.stringify(rt.w)) + 1;
  assert.equal(admin('law_execution', { version: 2, capacity: { maxWorldBytes: limit } }).result.ok, true);
  assert.equal(capacityCheck(rt.w).ok, true);
  assert.ok(Buffer.byteLength(JSON.stringify({ ...rt.w, lawSemantics: { version: 2 } })) > limit);
  rt.snapshot();
  const baseline = readFileSync(snapshotPath(dir)), genesis = structuredClone(rt.w.genesis);
  const sync = rt.events.sync.bind(rt.events);
  let liveSyncs = 0;
  rt.events.sync = () => { liveSyncs++; sync(); };
  const failed = admin('law_semantics', { version: 2 });
  assert.equal(failed.result.error.reason, 'law_execution_capacity');
  assert.equal(Object.hasOwn(rt.w, 'lawSemantics'), false);
  assert.equal(liveSyncs, 1, 'failed migration receipt must sync its event before control snapshot');
  const failedHash = stateHash(rt.w);
  assert.equal(readCommands(commandsPath(dir)).at(-1).receipt.out.result.error.reason, 'law_execution_capacity');
  assert.equal(replayDir(dir).ok, true);
  writeFileSync(snapshotPath(dir), baseline);
  let replaySyncs = 0, repairedHandlerCalled = false;
  const originalSync = EventStore.prototype.sync;
  EventStore.prototype.sync = function () { replaySyncs++; return originalSync.call(this); };
  registerCommand('admin', (w, p) => {
    if (p.op === 'law_semantics') { repairedHandlerCalled = true; w.lawSemantics = { version: 2 }; return { ok: true }; }
    return adminCommand(w, p);
  });
  let reopened;
  try {
    reopened = Runtime.open(cfg, { logger });
    assert.equal(stateHash(reopened.w), failedHash);
    assert.equal(Object.hasOwn(reopened.w, 'lawSemantics'), false);
    assert.equal(replaySyncs, 1, 'receipt tail ending in legacy state must sync events before recovery snapshot');
    assert.equal(replayDir(dir).ok, true);
    assert.equal(repairedHandlerCalled, false, 'recorded failed migration never executes a repaired handler');
  } finally { EventStore.prototype.sync = originalSync; registerCommand('admin', adminCommand); }
  assert.equal(reopened.exec('admin', { op: 'law_execution', args: { version: 2, capacity: { maxWorldBytes: 2000000 } } }).result.ok, true);
  assert.equal(Object.hasOwn(reopened.w, 'lawSemantics'), false);
  assert.equal(reopened.exec('admin', { op: 'resume' }).result.ok, true);
  assert.equal(reopened.exec('admin', { op: 'law_semantics', args: { version: 2 } }).result.ok, true);
  assert.equal(reopened.w.lawSemantics.version, 2);
  assert.deepEqual(reopened.w.genesis, genesis);
  reopened.snapshot();
  assert.equal(replayDir(dir).ok, true);
});
