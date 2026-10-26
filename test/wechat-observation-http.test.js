import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { stateHash } from '../src/store.js';
import { wechatObservationAllows } from '../src/http/wechat-observation.js';

const appid = 'wx83d31aa7fc9a797e';
const password = 'observation-password';
async function setup(t) {
  const e = await boot({ wechatAppId: appid, wechatAppSecret: 'test-secret' });
  t.after(() => e.close());
  const ctx = e.app.ctx;
  const user = await ctx.accounts.create({ username: 'observer', password });
  const identity = { appid, openid: 'observer-openid', verifiedAt: Date.now() };
  const phone = ctx.accounts.issue(user.id, { wechat: identity });
  const web = ctx.accounts.issue(user.id);
  const headers = token => ({ Cookie: `houren_session=${token}`, 'X-Houren-Request': '1' });
  ctx.wechat.check = async () => {};
  return { e, ctx, user, identity, phone, web, headers };
}

test('phone sessions cannot generate or mutate residents even with missing or forged client headers', async t => {
  const { e, ctx, user, phone, headers } = await setup(t);
  const before = stateHash(e.rt.w), quota = ctx.assistant.store.quota(user.id).used;
  let calls = 0;
  ctx.assistant.ask = () => { calls++; throw Error('must not generate'); };
  ctx.runners.prepare = () => { calls++; throw Error('must not test model'); };
  const writes = [
    '/api/assistant/questions', '/api/account/residents', '/api/account/residents/adopt',
    '/api/account/residents/a/letter', '/api/account/residents/a/runner',
    '/api/account/residents/a/cap', '/api/account/residents/a/transfer',
    '/api/account/residents/a/cancel_transfer', '/api/account/transfers/t/accept',
    '/api/account/residents/a/avatar', '/api/port/register', '/api/port/adopt',
    '/api/account/agents', '/api/admin/reports/generate', '/api/admin/assistant',
    '/api/wechat/messages', '/api/messages', '/api/wechat/qr/consume',
  ];
  for (const client of [undefined, 'web', 'wechat']) {
    const h = { ...headers(phone), ...(client ? { 'X-Houren-Client': client } : {}) };
    for (const path of writes) {
      const r = await e.call(path, { method: 'POST', headers: h, body: { text: 'hello', op: 'test' } });
      assert.equal(r.status, 403, path + ': ' + r.text);
      assert.equal(r.json.error.code, 'wechat_observation_only', path);
    }
    const removed = await e.call('/api/account/residents/a/avatar', { method: 'DELETE', headers: h, body: {} });
    assert.equal(removed.json.error.code, 'wechat_observation_only');
  }
  assert.equal(calls, 0);
  assert.equal(stateHash(e.rt.w), before);
  assert.equal(ctx.assistant.store.quota(user.id).used, quota);
});

test('all assistant endpoints are unavailable to phone, but the same account can use the web assistant', async t => {
  const { e, ctx, phone, web, headers } = await setup(t);
  ctx.hosted.config = { version: 2, enabled: true, apiKey: 'TEST-KEY', baseURL: 'https://example.com/v1', priceVersion: 'p', maxOutputTokens: 2048, models: [{ id: 'gpt-6-luna', provider: 'openai-responses', group: 'Openai-Gpt-1', tiers: [{ upTo: null, usd: { miss: '1', hit: '0.1', output: '2', write: null, writeHour: null } }] }] };
  ctx.assistant.generate = async () => ({ text: '已有资料 [S1]', usage: { input: 10, output: 10 } });
  const r = await e.call('/api/assistant/questions', { method: 'POST', headers: headers(web), body: { text: '解释实验' } });
  assert.equal(r.status, 202, r.text);
  await ctx.assistant.idle();
  const path = '/api/assistant/conversations/' + r.json.conversationId;
  for (const [method, url] of [
    ['GET', '/api/assistant/status'], ['GET', path], ['GET', path + '/sources/abc'],
    ['DELETE', path], ['POST', '/api/assistant/questions/' + r.json.questionId + '/cancel'],
  ]) {
    const denied = await e.call(url, { method, headers: headers(phone), ...(method === 'GET' ? {} : { body: {} }) });
    assert.equal(denied.json.error.code, 'wechat_observation_only');
  }
  assert.equal((await e.call(path, { headers: headers(web) })).json.conversation.messages.at(-1).status, 'complete');
});

test('phone keeps public observations, account access and notification records; logout still revokes session', async t => {
  const { e, phone, headers } = await setup(t);
  const h = headers(phone);
  assert.equal((await e.call('/api/wechat/public/state', { headers: h })).status, 200);
  assert.equal((await e.call('/api/account', { headers: h })).status, 200);
  assert.equal((await e.call('/api/wechat/notifications/records', { headers: h })).status, 200);
  const read = await e.call('/api/wechat/notifications/records/read', { method: 'POST', headers: h, body: { ids: [] } });
  assert.equal(read.status, 200, read.text);
  assert.equal((await e.call('/api/account/logout', { method: 'POST', headers: h, body: {} })).status, 200);
  assert.equal((await e.call('/api/account', { headers: h })).json.user, null);
});

test('native password login persists observation scope without falsely binding a WeChat identity', async t => {
  const { e, ctx, user } = await setup(t);
  ctx.wechat.exchange = async () => ({ appid, openid: 'different-owner', verifiedAt: Date.now() });
  const r = await e.call('/api/wechat/password-login', { method: 'POST', headers: { 'X-Houren-Request': '1' }, body: { username: user.username, password, code: 'verified-code' } });
  assert.equal(r.status, 200, r.text);
  const cookie = r.headers.get('set-cookie').split(';')[0], token = cookie.split('=')[1];
  assert.equal(ctx.accounts.sessionMetadata(token).client, 'wechat');
  assert.equal(ctx.accounts.sessionMetadata(token).wechat, undefined);
  const denied = await e.call('/api/assistant/status', { headers: { Cookie: cookie } });
  assert.equal(denied.json.error.code, 'wechat_observation_only');
  // A fresh independent browser password login remains a browser session.
  const browser = await e.call('/api/account/login', { method: 'POST', headers: { 'X-Houren-Request': '1' }, body: { username: user.username, password } });
  assert.equal(browser.status, 200, browser.text);
  const h = { Cookie: browser.headers.get('set-cookie').split(';')[0] };
  assert.equal((await e.call('/api/assistant/status', { headers: h })).status, 200);
});

test('browser QR identity is not confused with a phone session; phone re-login cannot upgrade its scope', async t => {
  const { e, ctx, user, phone, headers } = await setup(t);
  const browser = ctx.accounts.issue(user.id, { wechatIdentity: 'qr-bound-identity' });
  assert.equal((await e.call('/api/assistant/status', { headers: headers(browser) })).status, 200);
  const r = await e.call('/api/account/login', { method: 'POST', headers: headers(phone), body: { username: user.username, password } });
  assert.equal(r.status, 200, r.text);
  const h = { Cookie: r.headers.get('set-cookie').split(';')[0] };
  assert.equal((await e.call('/api/assistant/status', { headers: h })).json.error.code, 'wechat_observation_only');
});

test('observation write allowlist is limited to identity, preferences and packaging existing history', () => {
  assert.equal(wechatObservationAllows('GET', '/api/port/model'), false);
  for (const path of ['/api/wechat/qr/scan', '/api/wechat/qr/confirm', '/api/wechat/login', '/api/wechat/notifications/preferences', '/api/history/exports', '/api/history/exports/abc-123/retry']) assert.equal(wechatObservationAllows('POST', path), true, path);
  for (const path of ['/api/account/residents/new-generation', '/api/admin/reports/generate', '/api/account/setup', '/api/wechat/qr/consume', '/api/wechat/notifications/preferences/evil']) assert.equal(wechatObservationAllows('POST', path), false, path);
});
