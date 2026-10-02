import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boot } from './http-helpers.js';
import { replayDir } from '../src/tools/replay.js';
import { sha256hex } from '../src/http/util.js';

for (const physics of [1, 2]) {
  test(`physics ${physics}: admin rotates only the owner key, revokes old access and survives replay/restart`, async () => {
    let e = await boot({ physics });
    try {
      const resident = await e.register('Forgotten');
      const path = `/api/admin/agents/${resident.agentId}/owner-key`;
      const before = structuredClone(e.rt.w.agents[resident.agentId]);
      assert.equal((await e.call(path, { method: 'POST', body: {} })).status, 401);
      assert.equal((await e.call(path, { method: 'POST', body: {}, admin: 'wrong' })).status, 401);
      assert.deepEqual(e.rt.w.agents[resident.agentId], before);
      const r = await e.call(path, { method: 'POST', body: {}, admin: true });
      assert.equal(r.status, 200);
      assert.match(r.json.ownerKey, /^[0-9a-f]{64}$/);
      assert.equal(r.json.agentId, resident.agentId);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      const after = structuredClone(e.rt.w.agents[resident.agentId]);
      assert.equal(after.owner.keyHash, sha256hex(r.json.ownerKey));
      after.owner.keyHash = before.owner.keyHash;
      assert.deepEqual(after, before, 'token, model, owner identity and history are preserved');
      assert.equal((await e.call('/api/owner', { token: resident.ownerKey })).status, 401);
      assert.equal((await e.call('/api/owner', { token: r.json.ownerKey })).status, 200);
      assert.equal((await e.call('/api/me', { token: resident.agentToken })).status, 200);
      const commands = readFileSync(join(e.dir, 'w', 'commands.jsonl'), 'utf8');
      assert.ok(!commands.includes(r.json.ownerKey));
      const publicEvents = (await e.call('/api/public/events')).text;
      assert.ok(!publicEvents.includes(r.json.ownerKey));
      assert.ok(!publicEvents.includes(sha256hex(r.json.ownerKey)));
      e.rt.snapshot();
      assert.equal(replayDir(join(e.dir, 'w')).ok, true);
      const dir = e.dir;
      await e.close({ keepDir: true });
      e = await boot({ physics }, { dir });
      assert.equal((await e.call('/api/owner', { token: resident.ownerKey })).status, 401);
      assert.equal((await e.call('/api/owner', { token: r.json.ownerKey })).status, 200);
    } finally { await e.close(); }
  });

  test(`physics ${physics}: reject missing residents, ownerless residents and malformed hashes`, async () => {
    const e = await boot({ physics });
    try {
      const r = await e.register('Owned');
      const request = (id) => e.call(`/api/admin/agents/${id}/owner-key`, { method: 'POST', body: {}, admin: true });
      assert.equal((await request('missing')).status, 404);
      const before = e.rt.w.agents[r.agentId].owner.keyHash;
      assert.equal(e.rt.exec('admin', { op: 'reset_owner_key', args: { agentId: r.agentId, ownerKeyHash: 'bad' } }).result.ok, false);
      assert.equal(e.rt.w.agents[r.agentId].owner.keyHash, before);
      e.rt.w.agents[r.agentId].owner = null;
      assert.equal((await request(r.agentId)).status, 400);
    } finally { await e.close(); }
  });
}

test('owner reset endpoint stays disabled without ADMIN_KEY', async () => {
  const e = await boot({ adminKey: null });
  try {
    const r = await e.register('Owned');
    assert.equal((await e.call(`/api/admin/agents/${r.agentId}/owner-key`, { method: 'POST', body: {} })).status, 404);
  } finally { await e.close(); }
});
