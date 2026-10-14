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

test('微信留言要求账号与微信身份，写入检查昵称与正文，网页可读同一数据', async () => {
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
    const created = await a.call('/api/wechat/messages', { text: '小程序的留言\n可以换行' });
    assert.equal(created.status, 201); assert.equal(created.json.message.text, '小程序的留言\n可以换行');
    assert.deepEqual(checks.map(c => c.scene), [1, 2]); assert.ok(checks.every(c => c.appid === appid));
    const web = await a.call('/api/messages');
    assert.equal(web.json.messages[0].text, created.json.message.text);
    assert.equal(created.headers.get('cache-control'), 'no-store');
    assert.equal(created.headers.get('access-control-allow-origin'), null);
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

test('检查拒绝、不可用和非法输入不写入；检查期间撤销会话不能提交', async () => {
  const { e, login } = await setup();
  try {
    const a = await login('alice'), store = e.app.ctx.messageBoard;
    let checks = 0;
    e.app.ctx.wechat.check = async () => { checks++; throw new AccountError(422, 'moderated', '请修改文字'); };
    assert.equal((await a.call('/api/wechat/messages', { text: '' })).status, 400);
    assert.equal((await a.call('/api/wechat/messages', { text: '长'.repeat(2001) })).status, 400);
    assert.equal(checks, 0);
    assert.equal((await a.call('/api/wechat/messages', { text: '被拒绝' })).status, 422);
    e.app.ctx.wechat.check = async () => { throw new AccountError(503, 'moderation_unavailable', '稍后重试'); };
    assert.equal((await a.call('/api/wechat/messages', { text: '服务不可用' })).status, 503);
    assert.equal(store.data.entries.length, 0);
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; });
    e.app.ctx.wechat.check = async (_, __, scene) => { if (scene === 2) { started(); await new Promise(resolve => { release = resolve; }); } };
    const pending = a.call('/api/wechat/messages', { text: '不得在退出后提交' });
    await waiting;
    e.app.ctx.accounts.logout(a.cookie.split('=')[1]);
    release();
    assert.equal((await pending).status, 401); assert.equal(store.data.entries.length, 0);
  } finally { await e.close(); }
});

test('微信回复、编辑与删除复用权限和讨论边界，拒绝的网页文字也可以由作者删除', async () => {
  const { e, login } = await setup();
  try {
    const a = await login('alice'), b = await login('bob'), store = e.app.ctx.messageBoard;
    e.app.ctx.wechat.check = async () => {};
    const root = (await a.call('/api/wechat/messages', { text: '主留言' })).json.message;
    const other = (await b.call('/api/wechat/messages', { text: '另一个讨论' })).json.message;
    const r = (await b.call(`/api/wechat/messages/${root.id}/replies`, { text: '答复' })).json.message;
    const second = await a.call(`/api/wechat/messages/${root.id}/replies`, { text: '回复乙', replyToId: r.id });
    assert.equal(second.status, 201); assert.equal(second.json.message.replyTo.id, r.id);
    assert.equal((await a.call(`/api/wechat/messages/${root.id}/replies`, { text: '跨讨论', replyToId: other.id })).status, 400);
    assert.equal((await b.call(`/api/wechat/messages/${root.id}`, { text: '越权编辑' }, 'PATCH')).status, 403);
    assert.equal((await b.call(`/api/wechat/messages/${root.id}`, {}, 'DELETE')).status, 403);
    assert.equal((await a.call(`/api/wechat/messages/${root.id}`, { text: '修改后' }, 'PATCH')).status, 200);
    e.app.ctx.wechat.check = async () => { throw new Error('删除不应检查原文'); };
    assert.equal((await a.call(`/api/wechat/messages/${root.id}`, {}, 'DELETE')).status, 200);
    const data = (await a.call(`/api/wechat/messages/${root.id}/replies`)).json;
    assert.equal(data.root.text, null); assert.equal(data.messages.length, 2);
    assert.equal(store.get(r.id).text, '答复');
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
