import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';

test('explicit typed HTTP gateway rejects malformed actions before creating a world command', async () => {
  const e = await boot({ physics: 2, premise: 2 });
  try {
    const a = await e.register('typed-http');
    const before = e.rt.w.commandN;
    const bad = await e.call('/api/me/act', { method: 'POST', token: a.agentToken, body: { actionTools: 'typed', actions: [{ type: 'read', target: 'l7' }] } });
    assert.equal(bad.status, 400);
    assert.equal(e.rt.w.commandN, before);
    const good = await e.call('/api/me/act', { method: 'POST', token: a.agentToken, body: { actionTools: 'typed', actions: [{ type: 'say', text: 'hello' }] } });
    assert.equal(good.status, 200);
    assert.equal(good.json.results[0].ok, true);
  } finally { await e.close(); }
});

test('law execution preflight is authenticated and read-only; explicit activation persists for replay', async () => {
  const e = await boot({ physics: 2, premise: 2 });
  try {
    const n = e.rt.w.commandN;
    assert.equal((await e.call('/api/admin/law-execution')).status, 401);
    const read = await e.call('/api/admin/law-execution', { admin: true });
    assert.equal(read.status, 200);
    assert.equal(read.json.preflight.ok, true);
    assert.equal(e.rt.w.commandN, n);
    const write = await e.call('/api/admin/law-execution', { admin: true, method: 'POST', body: { version: 2 } });
    assert.equal(write.status, 200);
    const state = await e.call('/api/public/state');
    assert.equal(state.json.world.lawExecution.version, 2);
    assert.equal(e.rt.w.commandN, n + 1);
  } finally { await e.close(); }
});
