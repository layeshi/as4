import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { mountWechatLogin } from '../public/wechat-login.js';
const scene = 'a'.repeat(32);
const response = (state) => ({ ok: true, json: { state } });
function fixture(state = 'scanned') {
  const dom = installFakeDom(), root = document.createElement('main'), calls = [], timers = new Map();
  let timer = 0, logins = 0, now = 0;
  const client = mountWechatLogin(root, () => logins++, {
    now: () => now,
    schedule: fn => { const id = ++timer; timers.set(id, fn); return id; }, unschedule: id => timers.delete(id),
    request: async (path) => {
      calls.push(path);
      if (path.endsWith('/create')) return { ok: true, json: { scene, expiresAt: 180000, checkCode: 'ABCDEF', imageUrl: '/api/wechat/qr/image/' + scene } };
      if (path.endsWith('/status')) return response(state);
      return response('done');
    }
  });
  return { dom, root, client, calls, timers, setState: s => { state = s; }, expire: () => { now = 180001; }, get logins() { return logins; },
    async tick() { const [id, fn] = timers.entries().next().value; timers.delete(id); await fn(); }, close() { client.dispose(); dom.restore(); } };
}
test('web scan panel waits for explicit approval, consumes only once, and stops polling on disposal', async () => {
  const f = fixture();
  try {
    await f.client.ready;
    assert.match(f.root.textContent, /ABCDEF/);
    await f.tick(); assert.equal(f.logins, 0); assert.match(f.root.textContent, /手机上确认|Confirm on your phone/);
    f.setState('approved'); await f.tick(); assert.equal(f.logins, 1);
    assert.equal(f.calls.filter(p => p.endsWith('/consume')).length, 1); assert.equal(f.timers.size, 0);
  } finally { f.close(); }
});
test('denied and expired scans stop polling without creating a session', async () => {
  for (const state of ['denied', 'expired']) {
    const f = fixture('denied');
    try {
      await f.client.ready; if (state === 'expired') f.expire();
      await f.tick(); assert.equal(f.logins, 0); assert.equal(f.timers.size, 0);
      assert.ok(!f.calls.some(p => p.endsWith('/consume')));
    } finally { f.close(); }
  }
});
test('late scan response after leaving the panel cannot sign the browser in', async () => {
  const dom = installFakeDom(), root = document.createElement('main'), calls = [];
  let resolve, logins = 0;
  const p = mountWechatLogin(root, () => logins++, { request: (path) => {
    calls.push(path);
    if (path.endsWith('/create')) return new Promise(r => { resolve = r; });
    return Promise.resolve(response('done'));
  } });
  try {
    p.dispose(); resolve({ ok: true, json: { scene, imageUrl: '/api/wechat/qr/image/' + scene, expiresAt: Date.now() + 180000 } });
    await p.ready; assert.equal(logins, 0); assert.ok(calls.some(x => x.endsWith('/cancel')));
  } finally { dom.restore(); }
});
