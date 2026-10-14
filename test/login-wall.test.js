// 登录门（src/http/login-wall.js）：网页版必须注册并登录后才能看到观测站与公共数据。
// 要点：页面请求 302 到登录页（带回到哪里）、公共读取接口 401 login_required；登录页、支持页、静态资源、/api/account、
// 微信小游戏的接口不设门；管理密钥放行，居民令牌与造者密钥不放行；退出或被停用后重新挡住；不经过服务器入口时缺省关闭。
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { CSP } from '../src/http/server.js';

const pass = 'a-long-test-password';
const person = (username) => ({ username, displayName: `User ${username}`, password: pass });
const JSON_HEADERS = { 'X-Houren-Request': '1' };

/** 不跟随重定向，才能看到 302 */
async function raw(e, path, { method = 'GET', headers = {} } = {}) {
  const res = await fetch(e.base + path, { method, headers, redirect: 'manual' });
  return { status: res.status, headers: res.headers, text: await res.text() };
}
async function register(e, username = 'alice') {
  const r = await e.call('/api/account/register', { method: 'POST', body: person(username), headers: JSON_HEADERS });
  assert.equal(r.status, 201, r.text);
  return r.headers.get('set-cookie').split(';')[0];
}
const wall = (extra = {}) => boot({ requireLogin: true, ...extra });

test('登录门：未登录的页面请求转到登录页，并记住要去的地方；登录页、支持页与静态资源不设门', async () => {
  const e = await wall();
  try {
    for (const [path, next] of [['/', null], ['/index.html', null], ['/?resident=a1', '/?resident=a1'], ['/residents.html', '/residents.html'], ['/billing.html', '/billing.html'], ['/account.html', '/account.html'], ['/admin.html?x=1', '/admin.html?x=1']]) {
      const r = await raw(e, path);
      assert.equal(r.status, 302, path);
      assert.equal(r.headers.get('location'), next === null ? '/login.html' : `/login.html?next=${encodeURIComponent(next)}`, path);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(r.text, '', '重定向不带正文，不泄露页面内容');
    }
    assert.equal((await raw(e, '/', { method: 'HEAD' })).status, 302);
    // 大小写变体：文件系统不区分大小写时落在门上，区分时 404 —— 绝不是 200
    assert.notEqual((await raw(e, '/INDEX.HTML')).status, 200);

    const login = await raw(e, '/login.html');
    assert.equal(login.status, 200);
    assert.equal(login.headers.get('content-security-policy'), CSP);
    assert.match(login.text, /id="login-root"/);
    assert.equal((await raw(e, '/support.html')).status, 200);
    for (const asset of ['/login.js', '/app.js', '/style.css', '/console.css', '/api.js', '/logo.svg', '/favicon.ico']) assert.equal((await raw(e, asset)).status, 200, asset);
  } finally { await e.close(); }
});

test('登录门：未登录读不到公共数据（401 login_required）；打赏页的接口、账号接口与微信小游戏的接口照旧', async () => {
  const e = await wall();
  try {
    for (const path of ['/api/public/state', '/api/public/events', '/api/public/events?recent=1&limit=5', '/api/public/lore', '/api/public/map', '/api/public/metrics', '/api/public/chronicle', '/api/public/weather', '/api/public/legacy', '/api/public/agents/nobody', '/api/public/places/agora', '/api/public/roles', '/api/public/stream']) {
      const r = await e.call(path);
      assert.equal(r.status, 401, path);
      assert.equal(r.json.error.code, 'login_required', path);
      assert.ok(r.headers.get('x-houren-protocol'), path);
      assert.equal(r.headers.get('cache-control'), 'no-store');
    }
    assert.match((await e.call('/api/public/state?lang=en')).json.error.message, /sign in/i);
    assert.match((await e.call('/api/public/state')).json.error.message, /登录/);
    // 公共的写接口同样要登录
    const vote = await e.call('/api/public/weather/vote', { method: 'POST', body: { type: 'rain' } });
    assert.equal(vote.status, 401);
    assert.equal(vote.json.error.code, 'login_required');

    // 不设门的
    const support = await e.call('/api/public/support');
    assert.equal(support.status, 200);
    assert.deepEqual(support.json, { qr: { wechat: null, alipay: null } });
    assert.equal((await e.call('/api/public/support/qr/wechat')).status, 404, '收款码没设置时是 404，不是 401');
    const account = await e.call('/api/account');
    assert.equal(account.status, 200);
    assert.equal(account.json.user, null);
    assert.equal(account.json.loginRequired, true);
    assert.equal((await e.call('/api/wechat/public/state')).status, 200, '微信小游戏有自己的微信登录与内容审核，不走网页的门');
    // 带凭据的接口自己管自己：不是 login_required
    assert.equal((await e.call('/api/me')).json.error.code, 'unauthorized');
  } finally { await e.close(); }
});

test('登录门：注册后放行页面、数据与实时流；退出后重新挡住', async () => {
  const e = await wall();
  try {
    const cookie = await register(e);
    const page = await raw(e, '/', { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    assert.match(page.text, /<title>/);
    assert.equal((await raw(e, '/residents.html', { headers: { Cookie: cookie } })).status, 200);
    const state = await e.call('/api/public/state', { headers: { Cookie: cookie } });
    assert.equal(state.status, 200);
    assert.ok(state.json.world, '放行后拿到的是完整的公共状态');
    assert.equal((await e.call('/api/public/lore', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await e.call('/api/account', { headers: { Cookie: cookie } })).json.loginRequired, true);

    const ac = new AbortController();
    try {
      const res = await fetch(`${e.base}/api/public/stream`, { headers: { Cookie: cookie }, signal: ac.signal });
      assert.equal(res.status, 200);
      const first = await res.body.getReader().read();
      assert.match(new TextDecoder().decode(first.value), /: connected/);
    } finally { ac.abort(); }

    assert.equal((await e.call('/api/account/logout', { method: 'POST', body: {}, headers: { Cookie: cookie, ...JSON_HEADERS } })).status, 200);
    assert.equal((await e.call('/api/public/state', { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await raw(e, '/', { headers: { Cookie: cookie } })).status, 302);
  } finally { await e.close(); }
});

test('登录门：账号被停用后会话立即失效，重新被挡住；未知的 Cookie 也不放行', async () => {
  const e = await wall();
  try {
    const setup = await e.call('/api/account/setup', { method: 'POST', body: { ...person('chief'), adminKey: 'test-admin-key' }, headers: JSON_HEADERS });
    assert.equal(setup.status, 201, setup.text);
    const adminCookie = setup.headers.get('set-cookie').split(';')[0];
    const cookie = await register(e, 'bob');
    assert.equal((await e.call('/api/public/state', { headers: { Cookie: cookie } })).status, 200);
    const users = (await e.call('/api/admin/users', { headers: { Cookie: adminCookie } })).json.users;
    const bob = users.find((u) => u.username === 'bob');
    const off = await e.call(`/api/admin/users/${bob.id}`, { method: 'PATCH', body: { status: 'disabled' }, headers: { Cookie: adminCookie, ...JSON_HEADERS } });
    assert.equal(off.status, 200, off.text);
    assert.equal((await e.call('/api/public/state', { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await raw(e, '/', { headers: { Cookie: cookie } })).status, 302);
    assert.equal((await e.call('/api/public/state', { headers: { Cookie: 'houren_session=' + '0'.repeat(64) } })).status, 401);
  } finally { await e.close(); }
});

test('登录门：管理密钥放行（运维的验收与审计脚本）；居民令牌与造者密钥不放行', async () => {
  const e = await wall();
  try {
    assert.equal((await e.call('/api/public/state', { admin: true })).status, 200);
    assert.equal((await raw(e, '/', { headers: { 'X-Admin-Key': 'test-admin-key' } })).status, 200);
    assert.equal((await e.call('/api/public/state', { admin: 'wrong-key' })).status, 401);
    assert.equal((await raw(e, '/', { headers: { 'X-Admin-Key': 'wrong-key' } })).status, 302);

    // 匿名也能注册居民（第六前提以前）：拿到令牌就能过门，等于没有门
    const a = await e.register('青禾');
    assert.equal((await e.call('/api/public/state', { token: a.agentToken })).status, 401);
    assert.equal((await e.call('/api/public/state', { token: a.ownerKey })).status, 401);
    assert.equal((await e.call('/api/me', { token: a.agentToken })).status, 200, '居民自己的接口不受影响');
  } finally { await e.close(); }
});

test('登录门：没有配置 ADMIN_KEY 时，空的管理密钥头不会放行', async () => {
  const e = await wall({ adminKey: null });
  try {
    assert.equal((await e.call('/api/public/state', { headers: { 'X-Admin-Key': '' } })).status, 401);
    assert.equal((await e.call('/api/public/state', { headers: { 'X-Admin-Key': 'undefined' } })).status, 401);
    assert.equal((await e.call('/api/public/state', { headers: { 'X-Admin-Key': 'null' } })).status, 401);
  } finally { await e.close(); }
});

test('登录门：不经过服务器入口的调用方（测试、嵌入）缺省关闭，行为与从前一致', async () => {
  const e = await boot();
  try {
    assert.equal((await raw(e, '/')).status, 200);
    assert.equal((await e.call('/api/public/state')).status, 200);
    assert.equal((await e.call('/api/account')).json.loginRequired, false);
  } finally { await e.close(); }
});
