// 会员页顶栏与管理后台（public/console-ui.js、public/admin.js）：用假 DOM 渲染，不需要浏览器。
// 要点：管理功能只在管理后台、只给管理员；导航按身份显示；切换功能后旧的一块停止刷新；新页面都走 CSP、不写内联样式或脚本。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.js';
import { boot } from './http-helpers.js';
import { CSP } from '../src/http/server.js';
import { mountShell } from '../public/console-ui.js';
import { mountAdmin, adminSections } from '../public/admin.js';
import { refreshAccount, openAccount } from '../public/accounts.js';
import { closeAllModals } from '../public/modals.js';
import { getLang, setLang } from '../public/i18n.js';

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve)); };
const reply = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
const hostedAdmin = { config: { enabled: false, baseURL: 'https://api.deepseek.com', model: '', thinking: 'default', maxOutputTokens: 4096, pricesMicro: null, hasApiKey: false }, available: false, storageFault: false, timezone: 'Asia/Shanghai', day: '2026-10-13', stats: { balanceMicro: 0, reservedMicro: 0, today: { calls: 0, input: 0, cacheRead: 0, output: 0, costMicro: 0, tokens: 0 }, hostedResidents: 0 }, requests: [{ id: 'r1', amountMicro: 1000000, note: '', createdAt: '2026-10-13T01:00:00Z', username: 'a' }, { id: 'r2', amountMicro: 2000000, note: '', createdAt: '2026-10-13T01:00:00Z', username: 'b' }], accounts: [] };
function setup(user) {
  const dom = installFakeDom();
  const saved = { fetch: globalThis.fetch, lang: getLang() };
  setLang('zh');
  const requests = [];
  let who = user;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    if (url === '/api/account') return reply(200, { user: who, registrationOpen: true, setupAvailable: false });
    if (url === '/api/account/logout') { who = null; return reply(200, { ok: true }); }
    if (url === '/api/admin/hosted') return reply(200, hostedAdmin);
    if (url === '/api/admin/server-status') return reply(500, { error: { message: '采样失败' } });
    if (url.startsWith('/api/admin/users')) return reply(200, { users: [], total: 0, page: 1, pageSize: 20 });
    return reply(200, {});
  };
  const header = document.createElement('header'), app = document.createElement('div');
  dom.root.append(header, app);
  return { dom, header, app, requests, setUser: (u) => { who = u; }, restore() { closeAllModals(); dom.restore(); setLang(saved.lang); globalThis.fetch = saved.fetch; } };
}
const links = (root) => root.querySelectorAll('a').map((a) => [a.textContent, a.getAttribute('href')]);
const navLinks = (header) => header.querySelectorAll('a').filter((a) => a.classList.contains('console-link')).map((a) => a.querySelector('span').textContent);
const navBadge = (header) => header.querySelectorAll('a').find((a) => a.getAttribute('href') === '/admin.html')?.querySelector('.nav-badge');
const admin = { id: 'u1', username: 'chief', displayName: '城市维护者', role: 'admin' };
const user = { id: 'u2', username: 'alice', displayName: 'Alice', role: 'user' };

test('管理后台：分组侧栏列出全部管理功能，默认服务器状态，待处理入账显示角标，切换后旧的一块停止刷新', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = setup(admin);
  try {
    const console = await mountAdmin({ header: env.header, app: env.app }); await settle();
    const ids = adminSections().flatMap(([, items]) => items.map(([id]) => id));
    assert.deepEqual(ids, ['server', 'experiment', 'snapshots', 'users', 'topups', 'hosted', 'usage', 'public-model', 'inventions', 'support']);
    assert.deepEqual(env.app.querySelectorAll('.admin-nav-group').map((g) => g.textContent), ['运行', '用户与充值', '模型', '内容与支持']);
    assert.equal(env.app.querySelectorAll('.admin-nav-link').length, ids.length);
    assert.equal(console.shown, 'server'); assert.match(env.app.querySelector('h1').textContent, /服务器状态/);
    assert.equal(env.app.querySelector('[aria-current="page"]').getAttribute('href'), '#server');
    assert.match(env.app.textContent, /采样失败/);
    const badge = env.app.querySelectorAll('.admin-nav-link').find((a) => a.getAttribute('href') === '#topups').querySelector('.nav-badge');
    assert.equal(badge.textContent, '2');
    const statusCalls = () => env.requests.filter((r) => r.url === '/api/admin/server-status').length;
    const before = statusCalls();
    console.show('users'); await settle();
    assert.match(env.app.querySelector('h1').textContent, /用户管理/); assert.match(env.app.textContent, /没有匹配的用户/);
    t.mock.timers.tick(30000); await settle();
    assert.equal(statusCalls(), before, '服务器状态离开页面后不再刷新');
    console.show('topups'); await settle();
    assert.match(env.app.textContent, /待处理入账申请/); assert.match(env.app.textContent, /共 2 笔/);
    console.show('no-such-section'); await settle();
    assert.equal(console.shown, 'server', '未知编号回到第一块');
    assert.ok(navLinks(env.header).includes('管理后台'));
  } finally { env.restore(); }
});

test('待处理入账申请：管理后台侧栏、顶栏「管理后台」与观测站用户中心都会提示，并定时更新', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = setup(admin);
  const saved = hostedAdmin.requests;
  try {
    await mountAdmin({ header: env.header, app: env.app }); await settle();
    const sideBadge = () => env.app.querySelectorAll('.admin-nav-link').find((a) => a.getAttribute('href') === '#topups').querySelector('.nav-badge');
    assert.equal(sideBadge().textContent, '2'); assert.equal(navBadge(env.header).textContent, '2');
    hostedAdmin.requests = [...saved, { id: 'r3', amountMicro: 3000000, note: '', createdAt: '2026-10-13T02:00:00Z', username: 'c' }];
    t.mock.timers.tick(30000); await settle();
    assert.equal(sideBadge().textContent, '3', '不用刷新页面，侧栏角标就更新'); assert.equal(navBadge(env.header).textContent, '3');
    closeAllModals(); await openAccount(); await settle();
    const entry = env.dom.root.querySelectorAll('a').find((a) => a.getAttribute('href') === '/admin.html' && a.classList.contains('hub-link'));
    assert.match(entry.textContent, /3 笔入账申请待处理/);
    hostedAdmin.requests = [];
    t.mock.timers.tick(30000); await settle();
    assert.equal(sideBadge().hidden, true); assert.equal(navBadge(env.header).hidden, true);
  } finally { hostedAdmin.requests = saved; env.restore(); }
});

test('管理后台：未登录提示登录，普通用户看不到任何管理功能', async () => {
  let env = setup(null);
  try {
    await mountAdmin({ header: env.header, app: env.app }); await settle();
    assert.match(env.app.textContent, /请先登录/); assert.equal(env.app.querySelectorAll('.admin-nav-link').length, 0);
    assert.ok(env.app.querySelectorAll('button').some((b) => b.textContent === '登录'));
  } finally { env.restore(); }
  env = setup(user);
  try {
    await mountAdmin({ header: env.header, app: env.app }); await settle();
    assert.match(env.app.textContent, /没有管理权限/); assert.equal(env.app.querySelectorAll('.admin-nav-link').length, 0);
    assert.ok(!env.requests.some((r) => r.url.startsWith('/api/admin/')), '普通用户不会请求管理接口');
    assert.ok(!navLinks(env.header).includes('管理后台'));
  } finally { env.restore(); }
});

test('会员页顶栏：按身份显示导航，当前页高亮，账户菜单有设置与退出', async () => {
  const env = setup(null);
  try {
    await refreshAccount({ notify: false }); // 清掉前面用例留下的登录状态，像刚打开页面
    mountShell(env.header, { active: 'residents' });
    assert.equal(env.header.querySelectorAll('button').length, 0, '读到账号之前不画登录按钮');
    await refreshAccount({ notify: false }); await settle();
    assert.equal(env.header.querySelector('.console-brand').textContent, '后人纪 · 词元本位');
    assert.deepEqual(navLinks(env.header), ['观测城市', '我的居民', '留言板']);
    assert.ok(env.header.querySelectorAll('button').some((b) => b.textContent === '登录 / 注册'));
    assert.equal(env.header.querySelector('[aria-current="page"]').getAttribute('href'), '/residents.html');
    env.setUser(user); await refreshAccount({ notify: false });
    assert.deepEqual(navLinks(env.header), ['观测城市', '我的居民', '留言板', '余额与充值']);
    assert.match(env.header.querySelector('.account-menu').textContent, /Alice@alice · 普通用户/);
    assert.ok(links(env.header).some(([text, href]) => text === '账户设置' && href === '/account.html'));
    env.setUser(admin); await refreshAccount({ notify: false });
    assert.deepEqual(navLinks(env.header), ['观测城市', '我的居民', '留言板', '余额与充值', '管理后台']);
    const signOut = env.header.querySelectorAll('button').find((b) => b.textContent === '退出登录');
    await signOut.listeners.click[0](); await settle();
    assert.ok(env.requests.some((r) => r.url === '/api/account/logout' && r.method === 'POST'));
    assert.deepEqual(navLinks(env.header), ['观测城市', '我的居民', '留言板']);
  } finally { env.restore(); }
});

test('新页面：走 CSP，不写内联样式或脚本，旧的居民页样式表已移除', async () => {
  const e = await boot();
  try {
    for (const page of ['residents', 'billing', 'account', 'admin', 'support', 'messages']) {
      const r = await e.call(`/${page}.html`);
      assert.equal(r.status, 200, page); assert.equal(r.headers.get('content-security-policy'), CSP, page);
      assert.doesNotMatch(r.text, /\sstyle=|<script(?![^>]*\bsrc=)/, page);
      assert.match(r.text, /href="\/console.css"/, page);
      assert.match(r.text, /<span>后人纪 · 词元本位<\/span>/, page);
    }
    for (const file of ['console.css', 'console-ui.js', 'admin.js', 'admin-panels.js', 'hosted-ui.js', 'hosted-admin.js', 'model-form.js', 'billing.js', 'account.js']) assert.equal((await e.call(`/${file}`)).status, 200, file);
    assert.equal((await e.call('/residents.css')).status, 404);
  } finally { await e.close(); }
  // 观测站的用户中心只做导航：不再放管理按钮
  const src = readFileSync(new URL('../public/accounts.js', import.meta.url), 'utf8');
  for (const gone of ['用户管理', '世界快照', '服务器状态', '实验运行', '打赏收款码', '发明认定']) assert.ok(!src.includes(`'${gone}'`), gone);
});
