import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { AccountError } from '../src/accounts/store.js';
import { PENDING_TEXT } from '../src/wechat/projection.js';
const appid = 'wx83d31aa7fc9a797e';
async function setup() {
  const e = await boot({ wechatAppId: 'wx216f3fb724629f67', wechatAppSecret: 'test-secret', wechatMiniprogramAppId: appid, wechatMiniprogramAppSecret: 'test-small-secret' });
  e.app.ctx.wechat.fetcher = async url => ({ ok: true, json: async () => url.pathname === '/sns/jscode2session' ? { openid: 'board-openid-' + url.searchParams.get('js_code') } : url.pathname === '/cgi-bin/token' ? { access_token: 'test-token', expires_in: 7200 } : { errcode: 0, result: { suggest: 'pass' } } });
  const login = async name => {
    const result = await e.call('/api/wechat/login', { method: 'POST', body: { code: name, appid }, headers: { 'X-Houren-Request': '1' } });
    assert.equal(result.status, 200);
    const cookie = result.headers.get('set-cookie').split(';')[0];
    return { user: result.json.user, cookie, call: (path, body, method = body === undefined ? 'GET' : 'POST') => e.call(path, { method, body, headers: { 'X-Houren-Request': '1', Cookie: cookie } }) };
  };
  return { e, login };
}
const drain = async projection => { for (let i = 0; i < 100 && (projection.active || projection.queue.length || projection.pending.size); i++) await new Promise(r => setImmediate(r)); assert.equal(projection.active, 0); };

test('微信留言要求账号与微信身份，只读同一批网页留言，手机写入被拒绝', async () => {
  const { e, login } = await setup();
  try {
    const a = await login('alice');
    assert.equal((await e.call('/api/wechat/messages')).status, 401);
    const regular = await e.app.ctx.accounts.create({ username: 'plain', password: 'long-test-password' });
    const token = e.app.ctx.accounts.issue(regular.id);
    const plain = await e.call('/api/wechat/messages', { headers: { Cookie: 'houren_session=' + token } });
    assert.equal(plain.status, 401); assert.equal(plain.json.error.code, 'wechat_login_required');
    const checks = [];
    e.app.ctx.wechat.check = async (text, identity, scene) => { e.app.ctx.wechat.requireIdentity(identity); checks.push({ text, appid: identity.appid, scene }); };
    const denied = await a.call('/api/wechat/messages', { text: '小程序的留言' });
    assert.equal(denied.status, 403); assert.equal(denied.json.error.code, 'wechat_observation_only');
    assert.equal(checks.length, 0);
    const webToken = e.app.ctx.accounts.issue(a.user.id);
    const created = await e.call('/api/messages', { method: 'POST', headers: { Cookie: 'houren_session=' + webToken, 'X-Houren-Request': '1' }, body: { text: '来自网页的留言' } });
    assert.equal(created.status, 201, created.text);
    await a.call('/api/wechat/messages'); await drain(e.app.ctx.wechatProjection);
    const read = await a.call('/api/wechat/messages');
    assert.equal(read.json.messages[0].text, created.json.message.text);
    assert.ok(checks.length > 0 && checks.every(c => c.appid === appid));
    assert.equal(read.headers.get('cache-control'), 'no-store');
    assert.equal(read.headers.get('access-control-allow-origin'), null);
  } finally { await e.close(); }
});

test('微信读取不泄露未检查文字，编号、时间、游标、回复对象与权限保持完整', async () => {
  const { e, login } = await setup();
  try {
    const a = await login('alice'), b = await login('bob'), store = e.app.ctx.messageBoard;
    const root = store.create(a.user, '未经检查的网页文字'), r = store.create(b.user, '回复中的未知文字', { threadId: root.id });
    store.create(a.user, '回复对象的引用', { threadId: root.id, replyToId: r.id });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    e.app.ctx.wechat.check = async () => gate;
    const result = await a.call(`/api/wechat/messages/${root.id}/replies`);
    assert.equal(result.status, 200);
    assert.equal(result.json.root.text, PENDING_TEXT);
    assert.ok(!JSON.stringify(result.json).includes('未经检查') && !JSON.stringify(result.json).includes('未知文字'));
    assert.equal(result.json.root.id, root.id); assert.equal(result.json.root.createdAt, root.createdAt);
    assert.equal(result.json.messages[0].id, r.id); assert.equal(result.json.messages[0].threadId, root.id);
    assert.equal(result.json.messages[1].replyTo.id, r.id); assert.equal(result.json.messages[1].canEdit, true);
    assert.equal(result.json.messages[0].canEdit, false); assert.equal(result.json.nextCursor, null);
    assert.ok(result.json.moderation.pending > 0);
    release(); await drain(e.app.ctx.wechatProjection);
    assert.equal((await a.call(`/api/wechat/messages/${root.id}/replies`)).json.root.text, root.text);
  } finally { await e.close(); }
});

test('微信写入在内容检查之前拒绝，模型与审核服务不可用也不会改变结果', async () => {
  const { e, login } = await setup();
  try {
    const a = await login('alice'), store = e.app.ctx.messageBoard;
    let checks = 0;
    e.app.ctx.wechat.check = async () => { checks++; throw new AccountError(503, 'moderation_unavailable', '稍后重试'); };
    for (const text of ['', '长'.repeat(2001), '新留言']) {
      const r = await a.call('/api/wechat/messages', { text });
      assert.equal(r.status, 403); assert.equal(r.json.error.code, 'wechat_observation_only');
    }
    assert.equal(checks, 0); assert.equal(store.data.entries.length, 0);
  } finally { await e.close(); }
});

test('微信不能回复、编辑或删除，独立网页会话仍可处理自己的留言', async () => {
  const { e, login } = await setup();
  try {
    const a = await login('alice'), b = await login('bob'), store = e.app.ctx.messageBoard;
    e.app.ctx.wechat.check = async () => {};
    const root = store.create(a.user, '主留言');
    const r = store.create(b.user, '答复', { threadId: root.id });
    const snapshot = JSON.stringify(store.data);
    for (const who of [a, b]) for (const [method, path, body] of [
      ['POST', `/api/wechat/messages/${root.id}/replies`, { text: '回复乙' }],
      ['PATCH', `/api/wechat/messages/${root.id}`, { text: '修改后' }],
      ['DELETE', `/api/wechat/messages/${root.id}`, {}],
      ['POST', `/api/messages/${root.id}/replies`, { text: '绕开投影的回复' }],
    ]) assert.equal((await who.call(path, body, method)).json.error.code, 'wechat_observation_only');
    assert.equal(JSON.stringify(store.data), snapshot);
    const webToken = e.app.ctx.accounts.issue(a.user.id), headers = { Cookie: 'houren_session=' + webToken, 'X-Houren-Request': '1' };
    assert.equal((await e.call(`/api/messages/${root.id}`, { method: 'PATCH', body: { text: '网页修改后' }, headers })).status, 200);
    assert.equal((await e.call(`/api/messages/${root.id}`, { method: 'DELETE', body: {}, headers })).status, 200);
    const data = (await a.call(`/api/wechat/messages/${root.id}/replies`)).json;
    assert.equal(data.root.text, null); assert.equal(data.messages.length, 1); assert.equal(store.get(r.id).text, '答复');
  } finally { await e.close(); }
});

test('微信投影拒绝的网页留言不改写网页数据，微信旧审批不能放行新编辑正文', async () => {
  const { e, login } = await setup();
  try {
    const a = await login('alice'), store = e.app.ctx.messageBoard, projection = e.app.ctx.wechatProjection;
    const root = store.create(a.user, '禁止通过的原文');
    e.app.ctx.wechat.check = async text => { if (text.includes('禁止')) throw new AccountError(422, 'moderated', '拒绝'); };
    await a.call('/api/wechat/messages'); await drain(projection);
    const blocked = await a.call('/api/wechat/messages');
    assert.equal(blocked.json.messages[0].text, '内容未通过安全检查');
    assert.ok(blocked.json.moderation.rejected > 0);
    assert.equal((await a.call('/api/messages')).json.messages[0].text, '禁止通过的原文');
    store.edit(a.user, root.id, '新正文，尚未检查');
    let release; const gate = new Promise(resolve => { release = resolve; });
    e.app.ctx.wechat.check = async () => gate;
    assert.equal((await a.call('/api/wechat/messages')).json.messages[0].text, PENDING_TEXT);
    release(); await drain(projection);
  } finally { await e.close(); }
});
