import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, chmodSync, appendFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const code = process.env.VALIDATOR_CODE || fileURLToPath(new URL('../../', import.meta.url));
const script = process.env.VALIDATOR_SCRIPT || join(here, 'offline.mjs');
const { loadConfig, applyConfig } = await import(join(code, 'src/config.js'));
const { Runtime } = await import(join(code, 'src/runtime.js'));
const { RunnerManager } = await import(join(code, 'src/runner/manager.js'));
const { publishWorldArchive } = await import(join(code, 'src/world-archives.js'));
const { writeSnapshot, stateHash } = await import(join(code, 'src/store.js'));
const physics = { version: 1, regrowth: { baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 }, thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 }, factorPermille: 500 }, construction: { fullActionsPerTick: 2, factorPermille: 500 } };

function fixture(t, premise = 6) {
  const root = mkdtempSync(join(here, 'synthetic-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'physics.json'), data = join(root, 'data'), id = 'synthetic-world';
  writeFileSync(file, JSON.stringify(physics));
  const env = { PHYSICS: premise === 6 ? '2' : '1', PREMISE: String(premise), MAP: premise === 6 ? 'compact-materials-v1' : 'classic', SHELL_SLOTS: '0', HIDDEN_PHYSICS_FILE: file, SEED: 'synthetic-validator', DATA_DIR: data, WORLD_ID: id };
  const cfg = loadConfig(env, []); applyConfig(cfg);
  const rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
  const account = { id: 'synthetic-account', status: 'active', revision: 1 };
  writeFileSync(join(data, 'accounts.json'), JSON.stringify({ version: 1, users: [account] }));
  const envFile = join(root, 'env.json'), outFile = join(root, 'report.json');
  writeFileSync(envFile, JSON.stringify(env));
  return { root, data, id, cfg, rt, account, dir: rt.dir, envFile, outFile };
}
function runner(f, change = {}) {
  const created = f.rt.exec('account', { op: 'create', accountId: f.account.id, name: '合成居民', soul: '合成测试灵魂', model: 'fixture-only', dailyCap: 18000, lang: 'zh', requestId: 'synthetic-create-1' });
  assert.equal(created.result.ok, true);
  const id = created.result.agentId, manager = new RunnerManager(f.rt, f.cfg);
  manager.records[id] = { accountId: f.account.id, ownershipRevision: 1, accountRevision: 1, enabled: false, config: { provider: 'mock', model: 'mock' }, ...change };
  manager.persist(); f.rt.close();
  return id;
}
function validate(f, { tail = false, heap, codeDir = code } = {}) {
  const result = spawnSync(process.execPath, [...(heap ? ['--max-old-space-size=' + heap] : []), script, codeDir, f.data, f.envFile, f.outFile, ...(tail ? ['allow-tail'] : [])], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 60000 });
  return { ...result, report: result.status === 0 ? JSON.parse(readFileSync(f.outFile, 'utf8')) : null };
}
function instrumentedCode(f, afterClose = '', onReplay = '') {
  const root = join(f.root, 'synthetic-code'); mkdirSync(join(root, 'src', 'tools'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const name of readdirSync(join(code, 'src'))) {
    if (!['runtime.js', 'tools'].includes(name)) symlinkSync(join(code, 'src', name), join(root, 'src', name));
  }
  for (const name of readdirSync(join(code, 'src', 'tools'))) {
    if (name !== 'replay.js') symlinkSync(join(code, 'src', 'tools', name), join(root, 'src', 'tools', name));
  }
  writeFileSync(join(root, 'src', 'runtime.js'), `import { Runtime as Real } from ${JSON.stringify(pathToFileURL(join(code, 'src/runtime.js')).href)};
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs'; import {join} from 'node:path';
export class Runtime { static open(...args) { const rt=Real.open(...args), close=rt.close.bind(rt); rt.close=()=>{ close(); ${afterClose} }; return rt; } }`);
  writeFileSync(join(root, 'src', 'tools', 'replay.js'), `import {replayDir as realReplay} from ${JSON.stringify(pathToFileURL(join(code, 'src/tools/replay.js')).href)};
export function replayDir(...args) { ${onReplay} return realReplay(...args); }`);
  return root;
}
function manifest(dir) {
  const out = {};
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), s = statSync(p);
    if (s.isDirectory()) out[name] = manifest(p);
    else out[name] = { hash: createHash('sha256').update(readFileSync(p)).digest('hex'), mode: s.mode & 0o777, bytes: s.size, mtime: s.mtimeMs };
  }
  return out;
}

test('archived P6 replays completely without changing archived files or requiring current account revision', async t => {
  const f = fixture(t); runner(f);
  await publishWorldArchive(f.data, f.id, 'synthetic-code');
  // Current accounts can legitimately change after the historical world closes.
  writeFileSync(join(f.data, 'accounts.json'), JSON.stringify({ version: 1, users: [{ ...f.account, revision: 2, status: 'disabled' }] }));
  chmodSync(join(f.dir, 'runners.enc'), 0o640); chmodSync(join(f.dir, 'runners.key'), 0o640);
  writeFileSync(join(f.dir, 'runner-usage.json'), JSON.stringify({ version: 1, agents: { a1: { since: '2020-01-01T00:00:00Z', total: {}, days: {}, recent: [{ at: '2020-01-01T00:00:00Z' }] } } }));
  const before = manifest(f.dir), publishedBefore = manifest(join(f.data, 'public-archives'));
  const result = validate(f);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(manifest(f.dir), before); assert.deepEqual(manifest(join(f.data, 'public-archives')), publishedBefore);
  const w = result.report.worlds[0];
  assert.equal(w.archived, true); assert.equal(w.historicalBindings, 1); assert.equal(w.validBindings, null);
  assert.equal(w.stateHash, stateHash(f.rt.w)); assert.equal(w.replayedCommands, f.rt.w.commandN);
});

test('active P6 accepts the correct current account binding through runtime recovery', t => {
  const f = fixture(t); runner(f);
  const result = validate(f); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.worlds[0].validBindings, 1); assert.equal(result.report.worlds[0].archived, false);
});

for (const change of [{ accountId: 'wrong-account' }, { ownershipRevision: 2 }, { accountRevision: 2 }]) {
  test('active P6 rejects incorrect binding ' + JSON.stringify(change), t => {
    const f = fixture(t); runner(f, change);
    const result = validate(f); assert.notEqual(result.status, 0); assert.match(result.stderr, /runner binding mismatch/);
  });
}

test('archived command receipt corruption is rejected without changing the archive', async t => {
  const f = fixture(t); runner(f); await publishWorldArchive(f.data, f.id, 'synthetic-code');
  const file = join(f.dir, 'commands.jsonl'), rows = readFileSync(file, 'utf8').trimEnd().split('\n'), frame = JSON.parse(rows[0]);
  frame.sha256 = '0'.repeat(64); rows[0] = JSON.stringify(frame); writeFileSync(file, rows.join('\n') + '\n');
  const before = manifest(f.dir), result = validate(f);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /校验失败|checksum/); assert.deepEqual(manifest(f.dir), before);
});

test('archived malformed event log is rejected without changing files', async t => {
  const f = fixture(t); runner(f); await publishWorldArchive(f.data, f.id, 'synthetic-code');
  appendFileSync(join(f.dir, 'events.jsonl'), '{broken-event}\n');
  const before = manifest(f.dir), result = validate(f);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /event log/); assert.deepEqual(manifest(f.dir), before);
});

test('archived P6 still rejects a historical ownership mismatch', async t => {
  const f = fixture(t); runner(f, { ownershipRevision: 2 }); await publishWorldArchive(f.data, f.id, 'synthetic-code');
  const before = manifest(f.dir), result = validate(f);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /historical runner binding mismatch/); assert.deepEqual(manifest(f.dir), before);
});

test('active legacy incomplete command tail is rejected rather than silently repaired', t => {
  const f = fixture(t, 0); f.rt.exec('tick'); f.rt.close();
  appendFileSync(join(f.dir, 'commands.jsonl'), '{"n":');
  const before = manifest(f.dir), result = validate(f, { tail: true });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /incomplete|damaged|tail|损坏/); assert.deepEqual(manifest(f.dir), before);
});

test('allow-tail restores complete active commands beyond the saved snapshot', t => {
  const f = fixture(t); runner(f);
  const rt = Runtime.open(f.cfg, { version: '0.1.0', logger: {} }); rt.exec('tick');
  const expected = stateHash(rt.w), result = validate(f, { tail: true });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.report.worlds[0].stateHash, expected);
});

test('allow-tail rejects an event with no corresponding command before runtime can truncate it', t => {
  const f = fixture(t); f.rt.close();
  assert.equal(f.rt.w.commandN, 0); assert.equal(f.rt.w.counters.event, 0);
  appendFileSync(join(f.dir, 'events.jsonl'), JSON.stringify({ seq: 1, tick: 0, type: 'forged-event', vis: 'public', data: {} }) + '\n');
  const before = manifest(f.dir), result = validate(f, { tail: true });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /event log tail|replayed events/);
  assert.deepEqual(manifest(f.dir), before);
});

test('allow-tail rejects altered complete event text generated by a real command tail', t => {
  const f = fixture(t); runner(f);
  const rt = Runtime.open(f.cfg, { version: '0.1.0', logger: {} });
  const resident = Object.keys(rt.w.agents)[0];
  const result = rt.exec('account', { op: 'letter', accountId: f.account.id, agentId: resident, ownershipRevision: 1, text: '真实合成家书', requestId: 'synthetic-tail-letter' });
  assert.equal(result.result.ok, true); assert.ok(result.events.length > 0);
  const file = join(f.dir, 'events.jsonl'), lines = readFileSync(file, 'utf8').trimEnd().split('\n'), event = JSON.parse(lines.at(-1));
  event.data.text = '被篡改的合成家书'; lines[lines.length - 1] = JSON.stringify(event); writeFileSync(file, lines.join('\n') + '\n');
  const before = manifest(f.dir), validation = validate(f, { tail: true });
  assert.notEqual(validation.status, 0); assert.match(validation.stderr, /event log.*mismatch|replayed events/);
  assert.deepEqual(manifest(f.dir), before);
});

test('allow-tail can regenerate an absent event suffix backed by complete command receipts', t => {
  const f = fixture(t); runner(f);
  const eventFile = join(f.dir, 'events.jsonl'), prefix = readFileSync(eventFile);
  const rt = Runtime.open(f.cfg, { version: '0.1.0', logger: {} });
  const resident = Object.keys(rt.w.agents)[0];
  const result = rt.exec('account', { op: 'letter', accountId: f.account.id, agentId: resident, ownershipRevision: 1, text: '可恢复的合成家书', requestId: 'synthetic-missing-events' });
  assert.equal(result.result.ok, true); assert.ok(result.events.length > 0);
  const expected = stateHash(rt.w); writeFileSync(eventFile, prefix);
  const validation = validate(f, { tail: true });
  assert.equal(validation.status, 0, validation.stderr); assert.equal(validation.report.worlds[0].stateHash, expected);
  assert.ok(readFileSync(eventFile, 'utf8').includes('可恢复的合成家书'));
});

test('active close verification does not run a second full genesis replay', t => {
  const f = fixture(t); runner(f);
  const codeDir = instrumentedCode(f, '', "throw Error('second genesis replay forbidden');");
  const result = validate(f, { codeDir }); assert.equal(result.status, 0, result.stderr);
});

test('active close verification rejects any command log byte change', t => {
  const f = fixture(t); runner(f);
  const codeDir = instrumentedCode(f, "appendFileSync(join(rt.dir,'commands.jsonl'),'\\n');");
  const result = validate(f, { codeDir });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /command log changed/);
});

test('active close verification rejects altered event output after recovery', t => {
  const f = fixture(t); runner(f);
  const codeDir = instrumentedCode(f, "const file=join(rt.dir,'events.jsonl'); const rows=readFileSync(file,'utf8').trimEnd().split('\\n'); const event=JSON.parse(rows[0]); event.data={tampered:true}; rows[0]=JSON.stringify(event); writeFileSync(file,rows.join('\\n')+'\\n');");
  const result = validate(f, { codeDir });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /closed event log output mismatch/);
});

test('active close verification rejects a snapshot changed on close', t => {
  const f = fixture(t); runner(f);
  const codeDir = instrumentedCode(f, "const file=join(rt.dir,'snapshot.json'); const world=JSON.parse(readFileSync(file,'utf8')); world.cityName='tampered'; writeFileSync(file,JSON.stringify(world));");
  const result = validate(f, { codeDir });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /closed snapshot mismatch/);
});

test('archived complete command tail remains rejected even with allow-tail', async t => {
  const f = fixture(t); runner(f); await publishWorldArchive(f.data, f.id, 'synthetic-code');
  appendFileSync(join(f.dir, 'commands.jsonl'), JSON.stringify({ n: f.rt.w.commandN + 1, tick: f.rt.w.clock.tick, type: 'tick', payload: {} }) + '\n');
  const before = manifest(f.dir), result = validate(f, { tail: true });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /archived command tail/); assert.deepEqual(manifest(f.dir), before);
});

test('large archived command history streams and fully replays under a 96 MiB heap', t => {
  const f = fixture(t, 0), padding = 'x'.repeat(64 * 1024), file = join(f.dir, 'commands.jsonl');
  for (let n = 1; n <= 2048; n++) {
    const cmd = { n, tick: 0, type: 'synthetic-unused-command', payload: { padding } };
    appendFileSync(file, JSON.stringify(cmd) + '\n'); f.rt.engine.applyCommand(f.rt.w, cmd);
  }
  writeSnapshot(f.dir, f.rt.w);
  writeFileSync(join(f.data, 'world-archives.json'), JSON.stringify({ version: 1, worlds: [{ id: f.id }] }));
  const result = validate(f, { heap: 96 }); assert.equal(result.status, 0, result.stderr.slice(-1500));
  assert.equal(result.report.worlds[0].replayedCommands, 2048); assert.equal(result.report.worlds[0].stateHash, stateHash(f.rt.w));
});
