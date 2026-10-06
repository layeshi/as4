import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newWorld } from './e2-helpers.js';
const api = await import('../src/tools/deploy-preflight.js').catch(() => ({}));
const uid = process.getuid();
const gid = process.getgid();
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'houren-preflight-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const releaseDir = join(dir, 'release'); const dataDir = join(dir, 'data'); const world = join(dataDir, 'test');
  mkdirSync(releaseDir); mkdirSync(world, { recursive: true });
  writeFileSync(join(releaseDir, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  writeFileSync(join(releaseDir, 'REVISION'), 'abcdef1234567890\n');
  writeFileSync(join(world, 'snapshot.json'), JSON.stringify(newWorld()), { mode: 0o600 });
  writeFileSync(join(world, 'commands.jsonl'), '', { mode: 0o600 });
  writeFileSync(join(world, 'events.jsonl'), '', { mode: 0o600 });
  return { world, options: { releaseDir, dataDir, worldId: 'test', serviceUid: uid, serviceGid: gid, serviceGroups: [gid], expectedVersion: '0.1.0', expectedHash: 'abcdef1234567890', configFiles: [] } };
}
test('preflight checks service UID permissions rather than root privileges', () => {
  assert.equal(typeof api.posixAccess, 'function');
  const rootOwned = { uid: 0, gid: 0, mode: 0o100600 };
  assert.equal(api.posixAccess(rootOwned, { uid: 991, groups: [991] }, 4), false);
  assert.equal(api.posixAccess({ ...rootOwned, uid: 991, gid: 991 }, { uid: 991, groups: [991] }, 4), true);
});
test('valid release and world pass without changing any world bytes', t => {
  const { world, options } = fixture(t);
  assert.equal(typeof api.deployPreflight, 'function');
  const before = readFileSync(join(world, 'snapshot.json'));
  assert.deepEqual(api.deployPreflight(options), { ok: true, checks: [], version: '0.1.0', hash: 'abcdef1234567890', commandN: 0 });
  assert.deepEqual(readFileSync(join(world, 'snapshot.json')), before);
});
test('unreadable snapshot, encrypted key and untraversable parent reject independently', t => {
  const { world, options } = fixture(t);
  assert.equal(typeof api.deployPreflight, 'function');
  chmodSync(join(world, 'snapshot.json'), 0);
  assert.equal(api.deployPreflight(options).checks.some(c => c.code === 'unreadable' && c.target === 'snapshot'), true);
  chmodSync(join(world, 'snapshot.json'), 0o600);
  writeFileSync(join(world, 'runners.key'), 'PRIVATE', { mode: 0 });
  assert.equal(api.deployPreflight(options).checks.some(c => c.code === 'unreadable' && c.target === 'runners.key'), true);
  chmodSync(join(world, 'runners.key'), 0o600);
  chmodSync(world, 0o600);
  assert.equal(api.deployPreflight(options).checks.some(c => c.code === 'untraversable'), true);
  chmodSync(world, 0o700);
  assert.equal(api.deployPreflight(options).ok, true);
});
test('malformed snapshots, truncated command tails and gaps reject without repairs', t => {
  const { world, options } = fixture(t);
  assert.equal(typeof api.deployPreflight, 'function');
  const file = join(world, 'commands.jsonl');
  for (const contents of ['{"n":1', '{"n":1,"tick":0,"type":"tick","payload":{}}', '{"n":2,"tick":0,"type":"tick","payload":{}}\n']) {
    writeFileSync(file, contents);
    assert.equal(api.deployPreflight(options).ok, false);
    assert.equal(readFileSync(file, 'utf8'), contents);
  }
  writeFileSync(file, '');
  writeFileSync(join(world, 'snapshot.json'), '{}');
  assert.equal(api.deployPreflight(options).checks.some(c => c.code === 'invalid_snapshot'), true);
});
test('release mismatch and malformed events are reported only as safe codes', t => {
  const { world, options } = fixture(t);
  assert.equal(typeof api.deployPreflight, 'function');
  writeFileSync(join(world, 'events.jsonl'), 'PRIVATE-KEY https://private\n');
  const result = api.deployPreflight({ ...options, expectedHash: 'mismatch', expectedVersion: '2' });
  assert.equal(result.ok, false);
  assert.equal(result.checks.some(c => c.code === 'release_hash_mismatch'), true);
  assert.equal(result.checks.some(c => c.code === 'release_version_mismatch'), true);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});

test('CLI checks the named service identity and emits only safe diagnostics', async t => {
  const { options, world } = fixture(t);
  const { execFileSync, spawnSync } = await import('node:child_process');
  const name = execFileSync('id', ['-un'], { encoding: 'utf8' }).trim();
  const argv = ['src/tools/deploy-preflight.js', '--release-dir', options.releaseDir, '--data-dir', options.dataDir, '--world-id', 'test', '--service-user', name, '--expected-version', '0.1.0', '--expected-hash', options.expectedHash];
  const run = () => spawnSync(process.execPath, argv, { encoding: 'utf8' });
  assert.equal(run().status, 0);
  writeFileSync(join(world, 'runner.key.enc'), 'PRIVATE-KEY', { mode: 0 });
  const result = run();
  assert.equal(result.status, 1);
  assert.equal(result.stdout.includes('PRIVATE-KEY'), false);
  assert.equal(JSON.parse(result.stdout).checks.some(c => c.target === 'runner.key.enc' && c.code === 'unreadable'), true);
  chmodSync(join(world, 'runner.key.enc'), 0o600);
  assert.equal(run().status, 0);
});

test('explicit content manifest verifies release bytes and rejects traversal', async t => {
  const { options } = fixture(t);
  const { createHash } = await import('node:crypto');
  const path = join(options.releaseDir, 'server.js');
  writeFileSync(path, 'export const version = 1;\n');
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  const manifest = { 'server.js': digest };
  assert.equal(api.deployPreflight({ ...options, contentManifest: manifest }).contentVerified, true);
  writeFileSync(path, 'export const version = 2;\n');
  const changed = api.deployPreflight({ ...options, contentManifest: manifest });
  assert.equal(changed.ok, false);
  assert.equal(changed.checks.some(c => c.code === 'content_hash_mismatch'), true);
  for (const invalid of ['../snapshot.json', '/etc/passwd', 'src/../../private', 'src\\private']) {
    assert.equal(api.deployPreflight({ ...options, contentManifest: { [invalid]: digest } }).checks.some(c => c.code === 'invalid_manifest_path'), true);
  }
});
