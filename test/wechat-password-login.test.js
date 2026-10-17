import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { hasWechatIdentity } from '../src/accounts/store.js';
import { identityHash } from '../src/wechat/service.js';

const appid = 'wx216f3fb724629f67';
const headers = { 'X-Houren-Request': '1', 'X-Houren-Client': 'wechat' };
const password = 'website-password';
async function setup(t) {
  const e = await boot({ turnstileSecretKey: 'test-secret', wechatAppId: appid, wechatAppSecret: 'wechat-secret' });
  t.after(() => e.close());
  const accounts = e.app.ctx.accounts;
  const user = await accounts.create({ username: 'website', password });
  let exchanges = 0;
  e.app.ctx.wechat.fetcher = async url => {
    exchanges++;
    assert.equal(url.searchParams.get('appid'), appid);
    const code = url.searchParams.get('js_code');
    if (code === 'unavailable') throw new Error('offline');
    return { ok: true, json: async () => code === 'expired' ? { errcode: 40029 } : { openid: 'verified-wechat-owner' } };
  };
  const login = (body = {}, extra = {}) => e.call('/api/wechat/password-login', { method: 'POST', headers,
    body: { username: 'website', password, code: 'fresh-code', appid, ...body }, ...extra });
  return { e, accounts, user, login, exchanges: () => exchanges };
}

test('WeChat proof permits password login with Turnstile enabled without creating or binding accounts', async t => {
  const { e, accounts, user, login } = await setup(t);
  for (const alreadyBound of [false, true]) {
    const identity = identityHash(appid, 'verified-wechat-owner');
    const other = alreadyBound ? await accounts.wechatLogin(identity, { appid }) : null;
    const before = structuredClone(accounts.data.users);
    const r = await login();
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.user.id, user.id);
    assert.equal(hasWechatIdentity(accounts.get(user.id), identity), false);
    assert.equal(accounts.data.users.length, before.length);
    if (other) assert.equal((await accounts.wechatLogin(identity, { appid })).id, other.id);
    const token = r.headers.get('set-cookie').match(/houren_session=([^;]+)/)[1];
    assert.equal(accounts.session(token).id, user.id);
    assert.equal(accounts.sessionMetadata(token).wechat, undefined);
  }
  const website = await e.call('/api/account/login', { method: 'POST', headers, body: { username: 'website', password, code: 'fresh-code', appid } });
  assert.equal(website.status, 400);
  assert.equal(website.json.error.code, 'turnstile_required');
});

test('invalid WeChat proofs, unavailable verification and wrong passwords never issue a session', async t => {
  const { accounts, login } = await setup(t);
  for (const [body, status, code] of [
    [{ code: undefined }, 400, 'invalid_code'],
    [{ code: 'expired' }, 401, 'wechat_login_failed'],
    [{ code: 'unavailable' }, 503, 'wechat_unavailable'],
    [{ appid: 'wx0000000000000000' }, 400, 'wechat_app_unknown'],
    [{ password: 'wrong-password' }, 401, 'invalid_credentials'],
  ]) {
    const r = await login(body);
    assert.equal(r.status, status, r.text);
    assert.equal(r.json.error.code, code);
    assert.equal(r.headers.get('set-cookie'), null);
  }
  assert.equal(accounts.data.users.length, 1);
});

test('unverified website attempts cannot exhaust a WeChat password login account quota', async t => {
  const { e, login, exchanges } = await setup(t);
  for (let i = 0; i < 15; i++) {
    const r = await e.call('/api/account/login', { method: 'POST', headers, body: { username: 'website', password }, ip: '10.0.0.1' });
    assert.equal(r.status, 400);
  }
  const r = await login({}, { ip: '10.0.0.2' });
  assert.equal(r.status, 200);
  assert.equal(exchanges(), 1);
});

test('verified website attempts still share the username quota with WeChat password login', async t => {
  const { e, login } = await setup(t);
  e.app.ctx.verifyLoginTurnstile = async () => {};
  for (let i = 0; i < 15; i++) {
    const r = await e.call('/api/account/login', { method: 'POST', headers, body: { username: 'website', password: 'wrong-password', turnstileToken: 'valid' }, ip: '10.0.0.1' });
    assert.equal(r.status, 401);
  }
  const r = await login({}, { ip: '10.0.0.2' });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('set-cookie'), null);
});

test('ALTCHA website mode continues to accept server-verified WeChat identity for native password login', async t => {
  const { e, login, exchanges } = await setup(t);
  e.app.ctx.cfg.loginCaptcha = 'altcha';
  e.app.ctx.loginChallenge = { verify: () => { throw new Error('native login must use WeChat'); }, close() {} };
  assert.equal((await login()).status, 200);
  assert.equal(exchanges(), 1);
});

test('WeChat proof does not bypass required first-login contact verification', async t => {
  const { accounts, user, login } = await setup(t);
  accounts.commit(users => { users.find(u => u.id === user.id).contactRequired = true; });
  const r = await login();
  assert.equal(r.status, 428, r.text);
  assert.equal(r.json.error.code, 'contact_required');
  assert.equal(r.headers.get('set-cookie'), null);
});
