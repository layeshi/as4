import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { boot } from './http-helpers.js';
import { WechatService } from '../src/wechat/service.js';
import { QR_TTL } from '../src/wechat/web-login.js';
const mini = 'wx83d31aa7fc9a797e';
const cfg = { requireLogin: true, wechatAppId: 'wx216f3fb724629f67', wechatAppSecret: 'game-secret', wechatMiniprogramAppId: mini, wechatMiniprogramAppSecret: 'mini-secret' };
const headers = { 'X-Houren-Request': '1' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz8AAAAASUVORK5CYII=', 'base64');
const cookie = r => r.headers.get('set-cookie').split(';')[0];
async function setup(t) {
  const e = await boot(cfg); t.after(() => e.close());
  e.app.ctx.wechat.fetcher = async (url, options) => {
    if (url.pathname === '/wxa/getwxacodeunlimit') {
      const body = JSON.parse(options.body);
      assert.equal(body.page, 'pages/web-login/index'); assert.equal(body.scene.length, 32); assert.equal(body.check_path, true);
      assert.equal(url.searchParams.get('access_token'), 'test-access-token');
      return { ok: true, arrayBuffer: async () => png };
    }
    return { ok: true, json: async () => url.pathname === '/sns/jscode2session' ? { openid: 'test-' + url.searchParams.get('js_code') } : { access_token: 'test-access-token', expires_in: 7200 } };
  };
  const call = (op, body = {}, Cookie = '') => e.call('/api/wechat/qr/' + op, { method: 'POST', headers: { ...headers, Cookie }, body });
  const login = async (code = 'owner-wechat', appid = mini) => e.call('/api/wechat/login', { method: 'POST', headers, body: { code, appid } });
  const created = await call('create'); assert.equal(created.status, 201, created.text);
  return { e, call, login, created, browser: cookie(created), scene: created.json.scene };
}
test('scan requires explicit phone approval and an independent browser proof; consumes once without logging out phone', async t => {
  const { e, call, login, created, browser, scene } = await setup(t);
  assert.equal((await e.call('/api/account')).json.wechatQrEnabled, true);
  assert.ok(!created.text.includes(browser.split('=')[1]));
  assert.match(created.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await e.call(created.json.imageUrl)).status, 403);
  const image = await fetch(e.base + created.json.imageUrl, { headers: { Cookie: browser } });
  assert.equal(image.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal((await call('consume', { scene }, browser)).status, 409);
  assert.equal((await call('status', { scene })).status, 403);
  const phone = await login(); assert.equal(phone.status, 200, phone.text);
  assert.equal((await call('confirm', { scene, approve: true }, cookie(phone))).status, 409);
  const scanned = await call('scan', { scene }, cookie(phone));
  assert.equal(scanned.status, 200); assert.equal(scanned.json.checkCode, created.json.checkCode);
  assert.equal((await call('status', { scene }, browser)).json.state, 'scanned');
  assert.equal((await call('consume', { scene }, browser)).status, 409);
  assert.equal((await call('confirm', { scene, approve: true }, cookie(phone))).status, 200);
  const signed = await call('consume', { scene }, browser); assert.equal(signed.status, 200, signed.text);
  assert.equal(signed.json.user.id, phone.json.user.id);
  assert.equal((await call('consume', { scene }, browser)).status, 410);
  assert.equal((await e.call('/api/account', { headers: { Cookie: cookie(phone) } })).json.user.id, phone.json.user.id);
  assert.equal((await e.call('/api/public/state', { headers: { Cookie: cookie(signed) } })).status, 200);
  assert.equal((await e.call('/api/wechat/status?appid=' + mini, { headers: { Cookie: cookie(signed) } })).json.verified, false);
});
test('different accounts, password-only sessions and wrong app cannot approve a scanned request', async t => {
  const { e, call, login, scene } = await setup(t);
  const p = await login(), other = await login('other-wechat'), game = await login('game-wechat', cfg.wechatAppId);
  assert.equal((await call('scan', { scene }, cookie(game))).status, 401);
  const token = e.app.ctx.accounts.issue(p.json.user.id);
  assert.equal((await call('scan', { scene }, 'houren_session=' + token)).status, 401);
  assert.equal((await call('scan', { scene }, cookie(p))).status, 200);
  assert.equal((await call('scan', { scene }, cookie(other))).status, 409);
  assert.equal((await call('confirm', { scene, approve: true }, cookie(other))).status, 409);
});
test('refresh, expiry and cancellation invalidate requests; cannot replay approval after a password change', async t => {
  const { e, call, login, scene, browser } = await setup(t);
  const p = await login(), phone = cookie(p);
  await call('scan', { scene }, phone);
  await call('confirm', { scene, approve: false }, phone);
  assert.equal((await call('status', { scene }, browser)).json.state, 'denied');
  assert.equal((await call('consume', { scene }, browser)).status, 409);
  const fresh = await call('create', { previousScene: scene }, browser), b = cookie(fresh), s = fresh.json.scene;
  assert.equal((await call('status', { scene }, browser)).status, 410);
  await call('scan', { scene: s }, phone); await call('confirm', { scene: s, approve: true }, phone);
  await e.app.ctx.accounts.update(p.json.user.id, { password: 'changed-password' }, { admin: true });
  assert.equal((await call('consume', { scene: s }, b)).status, 409);
  const last = await call('create', {}, b);
  e.app.ctx.wechatWebLogin.now = () => Date.now() + QR_TTL + 1;
  const renewed = await call('create', { previousScene: last.json.scene }, cookie(last));
  assert.equal(renewed.status, 201, renewed.text);
  assert.equal((await call('status', { scene: last.json.scene }, cookie(last))).status, 410);
});
test('QR mutations have CSRF checks, throttle creation and do not overwrite an existing browser login', async t => {
  const { e, call, login, scene, browser } = await setup(t);
  assert.equal((await e.call('/api/wechat/qr/create', { method: 'POST', body: {} })).status, 403);
  const p = await login();
  await call('scan', { scene }, cookie(p)); await call('confirm', { scene, approve: true }, cookie(p));
  assert.equal((await call('consume', { scene }, browser + '; ' + cookie(p))).status, 409);
  for (let n = 0; n < 5; n++) assert.equal((await call('create')).status, 201);
  assert.equal((await call('create')).status, 429);
});
test('code generation fails closed on upstream errors, sanitizes secrets and isolates the mini-program token', async () => {
  const service = new WechatService(cfg, { fetcher: async (url, options) => {
    if (url.pathname === '/cgi-bin/token') { assert.equal(url.searchParams.get('appid'), mini); return { ok: true, json: async () => ({ access_token: 'only-mini', expires_in: 7200 }) }; }
    assert.equal(JSON.parse(options.body).env_version, 'trial');
    return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ errcode: 40001, errmsg: 'secret-upstream-detail' })) };
  } });
  await assert.rejects(service.miniprogram.loginCode('a'.repeat(32), 'trial'), e => e.code === 'wechat_qr_unavailable' && !e.message.includes('secret-upstream'));
  assert.equal(service.miniprogram.token, null);
});
test('native confirmation page verifies actual WeChat identity and never approves during scan', async () => {
  let page, calls = [];
  const api = { restoreSession() {}, async loginWeChat(bind) { assert.equal(bind, false); calls.push('login'); }, async request(path, options) {
    calls.push([path, options.data]);
    return path.endsWith('/scan') ? { username: 'linked-account', checkCode: 'ABC123' } : { ok: true };
  } };
  runInNewContext(readFileSync(new URL('../wechat/miniprogram-app/pages/web-login/index.js', import.meta.url), 'utf8'), { require: () => api, Page: p => { page = p; } });
  const p = { ...page, data: { ...page.data }, setData(values) { Object.assign(this.data, values); } };
  p.onLoad({ scene: 'a'.repeat(32) }); await p.verify(); assert.equal(calls.length, 0);
  p.consent({ detail: { value: ['accepted'] } }); await p.verify();
  assert.equal(p.data.account, 'linked-account'); assert.equal(calls.length, 2);
  assert.equal(calls[1][0], '/api/wechat/qr/scan');
  await p.decide({ currentTarget: { dataset: { approve: 'yes' } } });
  assert.equal(calls[2][1].approve, true); assert.match(p.data.done, /已确认/);
  await p.decide({ currentTarget: { dataset: { approve: 'yes' } } }); assert.equal(calls.length, 3);
});

test('out-of-order QR creation responses use independent browser cookies', async t => {
  const { e, call } = await setup(t);
  const pending = [];
  e.app.ctx.wechat.miniprogram.loginCode = () => new Promise(resolve => pending.push(resolve));
  const first = call('create');
  while (pending.length < 1) await new Promise(resolve => setImmediate(resolve));
  const second = call('create');
  while (pending.length < 2) await new Promise(resolve => setImmediate(resolve));
  pending[1]({ bytes: png, type: 'image/png' }); const b = await second;
  pending[0]({ bytes: png, type: 'image/png' }); const a = await first;
  assert.notEqual(cookie(a).split('=')[0], cookie(b).split('=')[0]);
  const jar = cookie(b) + '; ' + cookie(a);
  assert.equal((await call('status', { scene: b.json.scene }, jar)).status, 200);
  assert.equal((await call('cancel', { scene: a.json.scene }, jar)).status, 200);
  assert.equal((await call('status', { scene: b.json.scene }, jar)).status, 200);
});
