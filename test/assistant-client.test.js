import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistantClient, questionScope, assistantRequest } from '../public/assistant-client.js';

test('assistant sends one-based displayed days as zero-based API values', () => {
  assert.deepEqual(questionScope({ mode: 'resident', agentId: 'a', fromDay: '1', toDay: '4', city: '' }), { mode: 'resident', agentId: 'a', fromDay: 0, toDay: 3 });
  assert.throws(() => questionScope({ fromDay: '4', toDay: '2' }), /日期/);
});
test('account changes reject stale replies and clear credentials and sources', async () => {
  let finish;
  const c = new AssistantClient(() => new Promise(resolve => { finish = resolve; }));
  c.account('alice'); c.keys.adminKey = 'secret'; c.source = { text: 'private' };
  const pending = c.open('old'); c.account('bob'); finish({ conversation: { id: 'old', messages: [{ text: 'private' }] } }); await pending;
  assert.equal(c.conversation, null); assert.equal(c.source, null); assert.deepEqual(c.keys, {});
});
test('failed reauthorization clears the whole answer and source', async () => {
  const c = new AssistantClient(async () => { throw Object.assign(Error('denied'), { status: 403 }); });
  c.account('alice'); c.conversation = { id: 'old', messages: [{ text: 'private' }] }; c.source = { text: 'private' };
  await assert.rejects(c.open('old'), /denied/); assert.equal(c.conversation, null); assert.equal(c.source, null);
});
test('deletion invalidates an in-flight response before the server finishes', async () => {
  let finish;
  const c = new AssistantClient((path, options) => options?.method === 'DELETE' ? Promise.resolve({ ok: true }) : new Promise(resolve => { finish = resolve; }));
  c.account('alice'); const read = c.open('old'); await c.remove('old'); finish({ conversation: { id: 'old', messages: [{ text: 'deleted' }] } }); await read;
  assert.equal(c.conversation, null);
});

test('web request keeps verification in headers and disables caching', async () => {
  const saved = globalThis.fetch; let sent;
  globalThis.fetch = async (path, options) => { sent = { path, ...options }; return { ok: true, json: async () => ({ ok: true }) }; };
  try {
    await assistantRequest('/api/assistant/questions', { method: 'POST', body: { text: 'test' }, keys: { adminKey: 'test-admin-key', ownerKey: 'test-owner-key' } });
    assert.equal(sent.headers['X-Admin-Key'], 'test-admin-key'); assert.equal(sent.headers['X-Owner-Key'], 'test-owner-key'); assert.equal(sent.headers['X-Houren-Request'], '1');
    assert.equal(sent.cache, 'no-store'); assert.ok(!sent.body.includes('key')); assert.ok(sent.signal);
  } finally { globalThis.fetch = saved; }
});
