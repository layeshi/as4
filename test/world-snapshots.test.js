import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { boot } from './http-helpers.js';
import { Runtime } from '../src/runtime.js';
import { stateHash } from '../src/store.js';
import { replayDir } from '../src/tools/replay.js';

async function administrator(e) {
  const r = await e.call('/api/account/setup', { method: 'POST', body: {
    username: 'snapshot_admin', password: 'long-snapshot-password', adminKey: e.cfg.adminKey,
  }, headers: { 'X-Houren-Request': '1' } });
  assert.equal(r.status, 201);
  const headers = { Cookie: r.headers.get('set-cookie').split(';')[0], 'X-Houren-Request': '1' };
  return (path, options = {}) => e.call(path, { ...options, headers: { ...headers, ...options.headers } });
}

for (const physics of [1, 2]) test(`physics ${physics}: immutable world archives include matching logs and restore at the saved tick`, async () => {
  let e = await boot({ physics });
  try {
    let call = await administrator(e);
    const resident = await e.register('Snapshot');
    e.rt.tickNow();
    const savedWorld = JSON.parse(JSON.stringify(e.rt.w));
    const commandText = readFileSync(join(e.rt.dir, 'commands.jsonl'), 'utf8');
    const eventText = readFileSync(join(e.rt.dir, 'events.jsonl'), 'utf8');
    writeFileSync(join(e.rt.dir, 'runners.key'), 'SECRET-RUNNER-KEY');
    writeFileSync(join(e.rt.dir, 'runners.enc'), 'SECRET-RUNNER-CONFIG');
    assert.equal((await call('/api/admin/snapshots')).json.total, 0);
    const saved = await call('/api/admin/snapshots', { method: 'POST', body: { label: ' 第一天 ' } });
    assert.equal(saved.status, 201);
    const meta = saved.json.snapshot;
    assert.equal(meta.label, '第一天');
    assert.equal(meta.worldId, 'w');
    assert.equal(meta.physics, physics);
    assert.equal(meta.tick, savedWorld.clock.tick);
    assert.equal(meta.commandN, savedWorld.commandN);
    assert.equal(meta.stateHash, stateHash(savedWorld));
    assert.deepEqual(e.rt.w, savedWorld, 'saving does not change time, state, commands or events');
    assert.equal(readFileSync(join(e.rt.dir, 'commands.jsonl'), 'utf8'), commandText);
    const archiveDir = join(e.rt.dir, 'snapshots', meta.id);
    assert.equal(statSync(archiveDir).mode & 0o777, 0o700);
    assert.equal(statSync(join(archiveDir, 'archive.json.gz')).mode & 0o777, 0o600);
    const download = await fetch(`${e.base}/api/admin/snapshots/${meta.id}/download`, {
      headers: { 'X-Admin-Key': e.cfg.adminKey },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('cache-control'), 'no-store');
    assert.match(download.headers.get('content-disposition'), /attachment; filename="houren-snapshot-/);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.length, meta.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), meta.sha256);
    const bundle = JSON.parse(gunzipSync(bytes));
    assert.equal(bundle.format, 'houren-world-snapshot');
    assert.equal(bundle.version, 1);
    assert.deepEqual(Object.keys(bundle.files).sort(), ['commands.jsonl', 'events.jsonl', 'snapshot.json']);
    assert.deepEqual(JSON.parse(bundle.files['snapshot.json']), savedWorld);
    assert.equal(bundle.files['commands.jsonl'], commandText);
    assert.equal(bundle.files['events.jsonl'], eventText);
    assert.ok(!JSON.stringify(bundle).includes('SECRET-RUNNER'));
    assert.ok(!JSON.stringify(bundle).includes('long-snapshot-password'));
    assert.ok(!JSON.stringify(bundle).includes(resident.agentToken));
    const restoreRoot = join(e.dir, 'restored');
    const restoreDir = join(restoreRoot, 'w');
    mkdirSync(restoreDir, { recursive: true });
    for (const [name, content] of Object.entries(bundle.files)) writeFileSync(join(restoreDir, name), content);
    assert.equal(replayDir(restoreDir).ok, true);
    const restored = Runtime.open({ ...e.cfg, dataDir: restoreRoot }, { version: '0.1.0', logger: {} });
    assert.equal(stateHash(restored.w), meta.stateHash);
    assert.equal(restored.events.lastSeq, meta.eventSeq);
    restored.close();
    e.rt.tickNow();
    const second = await call('/api/admin/snapshots', { method: 'POST', body: {} });
    assert.equal(second.status, 201);
    assert.notEqual(second.json.snapshot.id, meta.id);
    assert.deepEqual(readFileSync(join(archiveDir, 'archive.json.gz')), bytes);
    const list = (await call('/api/admin/snapshots?page=1')).json;
    assert.equal(list.total, 2);
    assert.equal(list.snapshots[0].id, second.json.snapshot.id);
    const root = e.dir;
    // Remove dummy runner fixtures before booting the real runner manager again.
    rmSync(join(e.rt.dir, 'runners.key'));
    rmSync(join(e.rt.dir, 'runners.enc'));
    await e.close({ keepDir: true });
    e = await boot({ physics }, { dir: root });
    assert.equal((await e.call('/api/admin/snapshots', { admin: true })).json.total, 2);
  } finally { await e.close(); }
});

test('snapshot authorization, CSRF, input validation and path isolation', async () => {
  const e = await boot();
  try {
    const call = await administrator(e);
    for (const options of [{}, { admin: 'wrong' }]) {
      assert.equal((await e.call('/api/admin/snapshots', options)).status, 401);
      assert.equal((await e.call('/api/admin/snapshots', { ...options, method: 'POST', body: {} })).status, 401);
    }
    const user = await e.call('/api/account/register', { method: 'POST', body: { username: 'ordinary', password: 'long-user-password' }, headers: { 'X-Houren-Request': '1' } });
    assert.equal((await e.call('/api/admin/snapshots', { headers: { Cookie: user.headers.get('set-cookie').split(';')[0] } })).status, 403);
    assert.equal((await call('/api/admin/snapshots', { method: 'POST', body: {}, headers: { 'X-Houren-Request': '' } })).status, 403);
    assert.equal((await call('/api/admin/snapshots', { method: 'POST', body: {}, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    for (const body of [null, [], { label: 123 }, { label: 'x'.repeat(121) }, { path: '../escape' }]) {
      assert.equal((await call('/api/admin/snapshots', { method: 'POST', body })).status, 400);
    }
    assert.equal((await call('/api/admin/snapshots/not-a-uuid/download')).status, 404);
    assert.equal((await call('/api/admin/snapshots/00000000-0000-4000-8000-000000000000/download')).status, 404);
    assert.equal((await e.call('/data/w/snapshots')).status, 404);
    const r = await e.call('/api/admin/snapshots', { method: 'POST', body: {}, admin: true });
    assert.equal(r.status, 201, 'server admin key also supports scripting');
    assert.equal((await call('/api/admin/snapshots?page=bad')).json.page, 1);
    assert.equal((await call('/api/admin/snapshots?page=2')).json.snapshots.length, 0);
  } finally { await e.close(); }
});

test('failed snapshot writes leave no visible archive and can be retried', async () => {
  const e = await boot();
  try {
    const call = await administrator(e);
    const root = join(e.rt.dir, 'snapshots');
    writeFileSync(root, 'blocked');
    assert.equal((await call('/api/admin/snapshots', { method: 'POST', body: {} })).status, 500);
    rmSync(root);
    const result = await call('/api/admin/snapshots', { method: 'POST', body: {} });
    assert.equal(result.status, 201);
    assert.deepEqual(readdirSync(root), [result.json.snapshot.id]);
  } finally { await e.close(); }
});

test('snapshot capture stays consistent while time advances; concurrent saves and revoked authorization do not publish', async () => {
  const e = await boot({ physics: 2 });
  try {
    const snapshots = e.app.ctx.snapshots;
    const before = stateHash(e.rt.w);
    const first = snapshots.save({ label: 'captured' });
    e.rt.tickNow();
    await assert.rejects(snapshots.save({}), (error) => error.code === 'snapshot_busy');
    const saved = await first;
    assert.equal(saved.stateHash, before);
    assert.equal(saved.tick, 0);
    assert.equal(e.rt.w.clock.tick, 1);
    await assert.rejects(snapshots.save({}, () => { throw new Error('privileges revoked'); }), /privileges revoked/);
    assert.equal(snapshots.list().total, 1);
    assert.deepEqual(readdirSync(snapshots.root), [saved.id]);
    assert.equal((await snapshots.save({})).tick, 1, 'retry works after revoked authorization');
  } finally { await e.close(); }
});
