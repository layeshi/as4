// Validate a disposable, offline backup copy. Never point this at live data.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, writeFileSync, openSync, readSync, fstatSync, closeSync, createReadStream } from 'node:fs';
import { createDecipheriv, createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [code, data, envFile, outFile, allowTail] = process.argv.slice(2);
assert.ok(code && data && envFile && outFile, 'usage: offline.mjs CODE DATA ENV_JSON REPORT_JSON [allow-tail]');
const get = p => import(pathToFileURL(join(code, p)).href);
const { loadConfig, applyConfig } = await get('src/config.js');
const { Runtime } = await get('src/runtime.js');
const { stateHash, canonicalJson } = await get('src/store.js');
const { iterateCommands } = await get('src/commands.js');
const { archivedWorlds } = await get('src/world-archives.js');
const { engineOf, createWorldFromSnapshot } = await get('src/engines.js');
const { AccountStore } = await get('src/accounts/store.js');
const { RunnerManager } = await get('src/runner/manager.js');
const { Budget } = await get('src/shells/budget.js');
const env = JSON.parse(readFileSync(envFile, 'utf8'));
const accounts = new AccountStore(data);
const archivedIds = new Set(archivedWorlds(data).map(w => w.id));
const output = { accounts: accounts.data.users.length, worlds: [] };

// The runtime can repair incomplete tails. A backup validator must reject
// them first, so damage cannot be hidden by a successful recovery/close.
function completeLog(file, expected, label) {
  if (!existsSync(file)) { assert.equal(expected, 0, label + ' missing'); return; }
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    if (size) {
      const byte = Buffer.alloc(1); readSync(fd, byte, 0, 1, size - 1);
      assert.equal(byte[0], 10, label + ' incomplete tail');
    }
  } finally { closeSync(fd); }
}
async function* eventRows(file) {
  let last = 0;
  if (existsSync(file)) {
    for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { throw new Error('event log damaged'); }
      assert.equal(event.seq, last + 1, 'event log not continuous'); last = event.seq;
      yield event;
    }
  }
}
async function fileDigest(file) {
  const hash = createHash('sha256');
  if (existsSync(file)) for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function replayWithEvents(dir, snap, last, recoverTail) {
  const file = join(dir, 'events.jsonl'); completeLog(file, snap.counters.event, 'event log');
  const world = createWorldFromSnapshot(snap), engine = engineOf(snap);
  const events = eventRows(file), snapshotHash = stateHash(snap), eventDigest = createHash('sha256');
  let next, applied = 0, generated = 0;
  try {
    next = await events.next();
    if (snap.commandN === 0) assert.equal(stateHash(world), snapshotHash, 'snapshot replay failed');
    // Compare the actual event contract during the same full command replay;
    // no second engine replay or accumulated event array is required.
    for (const cmd of iterateCommands(join(dir, 'commands.jsonl'))) {
      const out = engine.applyCommand(world, cmd); applied++;
      for (const event of out.events) {
        assert.equal(event.seq, generated + 1, 'replayed events not continuous'); generated = event.seq;
        eventDigest.update(canonicalJson(event) + '\n');
        if (!next.done) {
          assert.ok(canonicalJson(next.value) === canonicalJson(event), 'event log output mismatch with replayed events at sequence ' + event.seq);
          next = await events.next();
        } else {
          assert.ok(recoverTail && event.seq > snap.counters.event, 'event log shorter than snapshot');
        }
      }
      if (cmd.n === snap.commandN) assert.equal(stateHash(world), snapshotHash, 'snapshot replay failed');
    }
    assert.ok(next.done, 'unexpected event log tail beyond replayed events');
    assert.equal(generated, world.counters.event, 'replayed events do not reach full command boundary');
    assert.equal(applied, last, 'full command replay did not reach log boundary');
    return { world, applied, hash: stateHash(world), eventHash: eventDigest.digest('hex') };
  } finally { await events.return(); }
}
async function verifyClosedFiles(dir, expected, commandHash) {
  assert.equal(await fileDigest(join(dir, 'commands.jsonl')), commandHash, 'command log changed during runtime recovery/close');
  const snapshot = JSON.parse(readFileSync(join(dir, 'snapshot.json'), 'utf8'));
  assert.equal(snapshot.commandN, expected.applied, 'closed snapshot command boundary mismatch');
  assert.equal(stateHash(snapshot), expected.hash, 'closed snapshot mismatch');
  const file = join(dir, 'events.jsonl'), hash = createHash('sha256');
  completeLog(file, expected.world.counters.event, 'closed event log');
  let last = 0;
  for await (const event of eventRows(file)) { last = event.seq; hash.update(canonicalJson(event) + '\n'); }
  assert.equal(last, expected.world.counters.event, 'closed event log boundary mismatch');
  assert.equal(hash.digest('hex'), expected.eventHash, 'closed event log output mismatch');
}
function archivedRunnerRecords(dir) {
  const file = join(dir, 'runners.enc');
  if (!existsSync(file)) return {};
  // RunnerManager's constructor chmods credentials and can prune telemetry.
  // Read and authenticate the same AES-GCM envelope without those writes.
  const key = readFileSync(join(dir, 'runners.key'));
  const encrypted = JSON.parse(readFileSync(file, 'utf8'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'hex')), decipher.final()]).toString());
}

for (const id of readdirSync(data)) {
  const dir = join(data, id);
  if (!existsSync(join(dir, 'snapshot.json'))) continue;
  const snap = JSON.parse(readFileSync(join(dir, 'snapshot.json'), 'utf8'));
  assert.equal(snap.id, id, 'snapshot world ID mismatch');
  const archived = archivedIds.has(id), commands = join(dir, 'commands.jsonl'), info = {};
  completeLog(commands, snap.commandN, 'command log');
  const commandHash = archived ? null : await fileDigest(commands);
  let last = 0;
  for (const cmd of iterateCommands(commands, { info })) {
    assert.equal(cmd.n, last + 1, 'command log not continuous'); last = cmd.n;
  }
  assert.equal(info.truncateTo, null, 'command log damaged or incomplete tail');
  assert.ok(last >= snap.commandN, 'command log shorter than snapshot');
  if (archived) assert.equal(last, snap.commandN, 'archived command tail');
  else if (allowTail !== 'allow-tail') assert.equal(last, snap.commandN, 'unexpected command tail');
  const cfg = loadConfig({ ...env, DATA_DIR: data, WORLD_ID: id }, []); applyConfig(cfg);
  // All worlds replay from genesis through the full log and check the saved
  // snapshot at its exact boundary, including any complete active command tail.
  const expected = await replayWithEvents(dir, snap, last, !archived && allowTail === 'allow-tail');

  let rt, manager;
  try {
    let world, engine, records, usage, validBindings, historicalBindings, currentAccountBindings;
    if (archived) {
      world = expected.world; engine = engineOf(world); records = archivedRunnerRecords(dir);
      const usageFile = join(dir, 'runner-usage.json');
      usage = existsSync(usageFile) ? JSON.parse(readFileSync(usageFile, 'utf8')).agents || {} : {};
      const view = { records, rt: { w: world }, ctx: { accounts } };
      if (world.premise === 6) {
        historicalBindings = Object.keys(records).filter(k => {
          const r = records[k], link = world.access?.residents[k];
          return r && world.agents[k] && link && link.managerAccountId === r.accountId && link.ownershipRevision === r.ownershipRevision;
        }).length;
        assert.equal(historicalBindings, Object.keys(records).length, 'historical runner binding mismatch');
        // Accounts live outside deterministic history. Current status/revision
        // cannot certify a historical account's status when this world closed.
        validBindings = null;
        currentAccountBindings = Object.keys(records).filter(k => RunnerManager.prototype.valid.call(view, k)).length;
      } else {
        historicalBindings = Object.keys(records).filter(k => RunnerManager.prototype.valid.call(view, k)).length;
        assert.equal(historicalBindings, Object.keys(records).length, 'historical runner binding mismatch');
        validBindings = historicalBindings;
      }
    } else {
      rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
      assert.equal(stateHash(rt.w), expected.hash, 'runtime recovery mismatch');
      manager = new RunnerManager(rt, cfg); manager.ctx = { accounts };
      world = rt.w; engine = rt.engine; records = manager.records; usage = manager.usage.agents;
      validBindings = Object.keys(records).filter(k => manager.valid(k)).length;
      assert.equal(validBindings, Object.keys(records).length, 'runner binding mismatch');
    }
    const ids = Object.keys(records), budgetFile = join(dir, 'shells-usage.json');
    const raw = existsSync(budgetFile) ? JSON.parse(readFileSync(budgetFile, 'utf8')) : null;
    const budget = new Budget({ file: budgetFile, tokensPerDay: raw?.tokensPerDay || 100000000, timezone: env.SHELL_TZ || 'Asia/Shanghai' });
    if (raw) assert.equal(budget.paused, raw.paused === true);
    const totals = raw ? Object.fromEntries(Object.entries(raw.days || {}).map(([d, b]) => [d, b.total])) : {};
    output.worlds.push({ id, archived, premise: world.premise || 0, physics: engine.physics, tick: world.clock.tick,
      commandN: world.commandN, replayedCommands: expected.applied, stateHash: stateHash(world), residents: Object.keys(world.agents).length,
      runners: ids.length, enabled: ids.filter(k => records[k].enabled).length, validBindings,
      ...(archived ? { historicalBindings, ...(world.premise === 6 ? { currentAccountBindings, accountValidation: 'historical-ownership-only; current account status/revision is informational' } : {}) } : {}),
      usageAgents: Object.keys(usage).length, shellPaused: budget.paused, shellUsage: totals });
  } finally {
    if (manager) await manager.close();
    if (rt) rt.close();
  }
  // The full deterministic proof above remains valid when commands did not
  // change, the closed snapshot equals its resulting state, and all persisted
  // events (including recovered suffixes) equal its emitted event contract.
  if (!archived) await verifyClosedFiles(dir, expected, commandHash);
}
writeFileSync(outFile, JSON.stringify(output, null, 2), { mode: 0o600 });
console.log(JSON.stringify(output));
