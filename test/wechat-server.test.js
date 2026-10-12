import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../src/accounts/store.js';
import { WechatService, identityHash } from '../src/wechat/service.js';
const cfg = { wechatAppId: 'wx216f3fb724629f67', wechatAppSecret: 'server-only-test-secret' };
const identity = { appid: cfg.wechatAppId, openid: 'test-openid-123456', verifiedAt: Date.now() };
const ok = data => ({ ok: true, json: async () => data });

test('WeChat identity mapping is unique, separate from public data, and cannot hijack a password account', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-wechat-'));
  try {
    const store = new AccountStore(dir);
    const person = await store.create({ username: 'wx_existing', displayName: 'Existing', password: 'long-existing-password' });
    const key = identityHash(identity.appid, identity.openid);
    const users = await Promise.all([store.wechatLogin(key), store.wechatLogin(key)]);
    assert.equal(users[0].id, users[1].id);
    assert.notEqual(users[0].id, person.id);
    assert.equal(store.data.users.length, 2);
    assert.equal(store.data.users[1].role, 'user');
    const renewed = new AccountStore(dir);
    assert.equal((await renewed.wechatLogin(key)).id, users[0].id);
    const { publicUser } = await import('../src/accounts/store.js');
    assert.ok(!JSON.stringify(publicUser(users[0])).includes(key));
    assert.ok(!readFileSync(store.file, 'utf8').includes(identity.openid));
    await assert.rejects(store.wechatLogin(key, { bindId: person.id }), e => e.code === 'identity_linked');
    await assert.rejects(store.wechatLogin('1'.repeat(64), { registrationOpen: false }), e => e.status === 403);
    const linked = await store.wechatLogin('2'.repeat(64), { bindId: person.id, registrationOpen: false });
    assert.equal(linked.id, person.id);
    assert.equal((await store.login({ username: 'wx_existing', password: 'long-existing-password' })).id, person.id);
    const token = store.issue(linked.id, { wechat: identity });
    assert.equal(store.sessionMetadata(token).wechat.openid, identity.openid);
    store.logout(token); assert.equal(store.sessionMetadata(token), null);
    await store.update(users[0].id, { status: 'disabled' }, { admin: true });
    await assert.rejects(store.wechatLogin(key), e => e.status === 401);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('upstream exchange discards session keys and never reflects secrets or raw errors', async () => {
  const service = new WechatService(cfg, { fetcher: async url => {
    assert.equal(url.origin, 'https://api.weixin.qq.com');
    assert.equal(url.searchParams.get('grant_type'), 'authorization_code');
    return ok({ openid: identity.openid, session_key: 'never-return-this-key', unionid: 'never-return-unionid' });
  } });
  const result = await service.exchange('test-code');
  assert.equal(result.openid, identity.openid); assert.equal(result.session_key, undefined); assert.equal(result.unionid, undefined);
  const failing = new WechatService(cfg, { fetcher: async () => { throw Error(cfg.wechatAppSecret); } });
  await assert.rejects(failing.exchange('test-code'), e => e.status === 503 && !e.message.includes(cfg.wechatAppSecret));
  await assert.rejects(new WechatService({}).exchange('test-code'), e => e.code === 'wechat_unconfigured');
});
test('text safety checks the complete tail, shares token refresh and fails closed on review, quota and malformed responses', async () => {
  const checked = []; let tokens = 0, suggestion = 'pass', errcode = 0;
  const service = new WechatService(cfg, { fetcher: async (url, options) => {
    if (url.pathname === '/cgi-bin/token') { tokens++; return ok({ access_token: 'test-token', expires_in: 7200 }); }
    assert.equal(url.pathname, '/wxa/msg_sec_check');
    const body = JSON.parse(options.body); checked.push(body);
    return ok({ errcode, result: { suggest: suggestion } });
  } });
  await Promise.all([service.check('profile-a', identity), service.check('profile-b', identity)]);
  assert.equal(tokens, 1);
  await service.check('字'.repeat(2100) + 'TAIL', identity);
  assert.ok(checked.some(v => v.content.endsWith('TAIL')));
  assert.ok(checked.every(v => Array.from(v.content).length <= 2000 && v.version === 2 && v.openid === identity.openid));
  const count = checked.length; await service.check('profile-a', identity); assert.equal(checked.length, count);
  suggestion = 'review'; await assert.rejects(service.check('needs review', identity), e => e.status === 422);
  suggestion = undefined; await assert.rejects(service.check('malformed response', identity), e => e.status === 422);
  errcode = 45009; await assert.rejects(service.check('quota exhausted', identity), e => e.status === 503);
  await assert.rejects(service.check('no login', null), e => e.status === 401);
  await assert.rejects(service.check('expired login', { ...identity, verifiedAt: Date.now() - 2 * 60 * 60000 }), e => e.status === 401);
});

test('miniGame public projection withholds unchecked AI output and preserves identifiers', async () => {
  const { WechatProjection } = await import('../src/wechat/projection.js');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const projection = new WechatProjection({ requireIdentity: i => { if (!i) throw Error(); }, check: async text => { await gate; if (text.includes('bad')) { const error = Error(); error.status = 422; throw error; } } });
  const source = { agentId: 'a-1', status: 'awake', name: 'Alice', bio: { zh: 'safe content', en: 'safe content' }, nested: [{ text: 'AI generated text' }] };
  const first = projection.filter(source, identity);
  assert.equal(first.agentId, 'a-1'); assert.equal(first.name, '内容审核中'); assert.equal(first.bio.en, '内容审核中');
  assert.equal(source.name, 'Alice', 'projection never mutates world data');
  release();
  for (let i = 0; i < 10 && projection.pending.size; i++) await new Promise(resolve => setImmediate(resolve));
  const second = projection.filter(source, null);
  assert.equal(second.name, 'Alice'); assert.equal(second.bio.zh, 'safe content');
  projection.filter({text:'bad content'}, identity);
  for (let i = 0; i < 10 && projection.pending.size; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(projection.filter({text:'bad content'}, identity).text, '内容审核中'); assert.equal(second.nested[0].text, 'AI generated text');
});

test('HTTP exchange issues a revocable cookie, existing account binding requires authentication, and raw public text is withheld', async () => {
  const { boot } = await import('./http-helpers.js');
  const e = await boot(cfg);
  try {
    e.app.ctx.wechat.fetcher = async url => ok(url.pathname === '/sns/jscode2session' ? { openid: identity.openid, session_key: 'secret-session-key' } : { access_token: 'test-token', expires_in: 7200 });
    const h = { 'X-Houren-Request': '1', 'X-Houren-Client': 'wechat' };
    assert.equal((await e.call('/api/wechat/login', { method: 'POST', body: { code: 'code', bindCurrent: true }, headers: h })).status, 401);
    assert.equal((await e.call('/api/wechat/login', { method: 'POST', body: { code: 'code' } })).status, 403);
    const response = await e.call('/api/wechat/login', { method: 'POST', body: { code: 'code', openid: 'attacker-supplied-openid', role: 'admin' }, headers: h });
    assert.equal(response.status, 200); assert.equal(response.json.user.role, 'user');
    assert.ok(!response.text.includes(identity.openid)); assert.ok(!response.text.includes('session_key'));
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal((await e.call('/api/wechat/status', { headers: { Cookie: cookie } })).json.verified, true);
    const publicResult = await e.call('/api/wechat/public/state');
    assert.equal(publicResult.status, 200);
    assert.equal(publicResult.json.world.id, e.rt.w.id);
    assert.equal((await e.call('/api/wechat/public/stream')).status, 404);
    assert.equal((await e.call('/api/wechat/public/../admin/users')).status, 404);
    assert.equal((await e.call('/api/account', { method: 'PATCH', body: { displayName: 'unchecked-name' }, headers: { ...h, Cookie: cookie } })).status, 422);
    assert.notEqual(e.app.ctx.accounts.get(response.json.user.id).displayName, 'unchecked-name');
    await e.call('/api/account/logout', { method: 'POST', body: {}, headers: { ...h, Cookie: cookie } });
    assert.equal((await e.call('/api/wechat/status', { headers: { Cookie: cookie } })).json.verified, false);
  } finally { await e.close(); }
});
