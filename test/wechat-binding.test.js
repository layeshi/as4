import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { AccountStore, publicUser } from '../src/accounts/store.js';
import { identityHash } from '../src/wechat/service.js';
const game = 'wx216f3fb724629f67', mini = 'wx83d31aa7fc9a797e';
const cfg = { wechatAppId: game, wechatAppSecret: 'test-game', wechatMiniprogramAppId: mini, wechatMiniprogramAppSecret: 'test-mini', requireLogin: true };
const headers = { 'X-Houren-Request': '1' };
const cookie = r => r.headers.get('set-cookie').split(';')[0];
async function setup(t) {
  const e = await boot(cfg); t.after(() => e.close());
  e.app.ctx.wechat.fetcher = async url => ({ ok: true, json: async () => ({ openid: 'verified-' + url.searchParams.get('js_code') }) });
  return e;
}
test('legacy website binding supports both apps, survives reload and rejects cross-account or same-app replacement', async t => {
  const e = await setup(t), s = e.app.ctx.accounts;
  const u = await s.create({ username: 'website', password: 'existing-password' });
  const old = identityHash(game, 'verified-game-code');
  await s.wechatLogin(old, { bindId: u.id }); // legacy persisted shape has no AppID
  const webCookie = 'houren_session=' + s.issue(u.id);
  const bind = (code, Cookie = webCookie) => e.call('/api/wechat/login', { method: 'POST', headers: { ...headers, Cookie }, body: { code, appid: mini, bindCurrent: true } });
  const bound = await bind('mini-code');
  assert.equal(bound.status, 200, bound.text); assert.equal(bound.json.user.id, u.id);
  assert.equal((await e.call('/api/wechat/status?appid=' + mini, { headers: { Cookie: cookie(bound) } })).json.linked, true);
  assert.equal((await bind('other-mini-code', cookie(bound))).status, 409);
  const other = await s.create({ username: 'other', password: 'different-password' });
  assert.equal((await bind('mini-code', 'houren_session=' + s.issue(other.id))).status, 409);
  const { dirname } = await import('node:path');
  const reloaded = new AccountStore(dirname(s.file));
  assert.equal((await reloaded.wechatLogin(old)).id, u.id);
  assert.equal((await reloaded.wechatLogin(identityHash(mini, 'verified-mini-code'))).id, u.id);
  assert.equal((await reloaded.login({ username: 'website', password: 'existing-password' })).id, u.id);
  assert.equal(reloaded.data.users.length, 2);
  assert.ok(!JSON.stringify(publicUser(reloaded.get(u.id))).includes(old));
});
test('fresh WeChat proof opens web login on the same account and revokes old sessions without changing account data', async t => {
  const e = await setup(t), s = e.app.ctx.accounts;
  const r = await e.call('/api/wechat/login', { method: 'POST', headers, body: { code: 'mini-code', appid: mini } });
  assert.equal(r.status, 200); assert.equal(r.json.user.passwordLoginEnabled, false);
  const id = r.json.user.id, oldCookie = cookie(r);
  s.linkAgent(id, { world: 'history', agentId: 'resident', token: 'resident-hash' });
  const beforeLinks = s.linksOf(id, 'history');
  const set = (code, Cookie = oldCookie, extra = {}) => e.call('/api/wechat/password', { method: 'POST', headers: { ...headers, Cookie }, body: { code, appid: mini, password: 'new-web-password', ...extra } });
  assert.equal((await set('other-code')).status, 403);
  assert.equal((await set('mini-code', '')).status, 401);
  assert.equal((await set('mini-code', oldCookie, { password: 'short' })).status, 400);
  const changed = await set('mini-code');
  assert.equal(changed.status, 200, changed.text); assert.equal(changed.json.user.id, id);
  assert.equal(changed.json.user.passwordLoginEnabled, true);
  assert.equal(s.session(oldCookie.split('=')[1]), null);
  assert.equal((await e.call('/api/wechat/status?appid=' + mini, { headers: { Cookie: cookie(changed) } })).json.verified, true);
  const web = await e.call('/api/account/login', { method: 'POST', headers, body: { username: r.json.user.username, password: 'new-web-password' } });
  assert.equal(web.status, 200); assert.equal(web.json.user.id, id);
  assert.equal((await e.call('/api/wechat/status?appid=' + mini, { headers: { Cookie: cookie(web) } })).json.verified, false);
  assert.equal((await e.call('/api/wechat/status?appid=' + mini, { headers: { Cookie: cookie(web) } })).json.linked, true);
  assert.deepEqual(s.linksOf(id, 'history'), beforeLinks); assert.equal(s.data.users.length, 1);
});
test('logout during upstream proof prevents password setup', async t => {
  const e = await setup(t), s = e.app.ctx.accounts;
  const u = await s.wechatLogin(identityHash(mini, 'verified-mini-code'), { appid: mini });
  const token = s.issue(u.id), before = s.get(u.id).passwordHash;
  e.app.ctx.wechat.fetcher = async () => { s.logout(token); return { ok: true, json: async () => ({ openid: 'verified-mini-code' }) }; };
  const r = await e.call('/api/wechat/password', { method: 'POST', headers: { ...headers, Cookie: 'houren_session=' + token }, body: { code: 'mini-code', appid: mini, password: 'new-web-password' } });
  assert.equal(r.status, 401); assert.equal(s.get(u.id).passwordHash, before);
});
