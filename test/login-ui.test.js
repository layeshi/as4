// 登录页与登录门的前端（public/login.js、public/api.js、public/accounts.js）：用假 DOM 渲染，不需要浏览器。
// 要点：登录与注册提交什么、成功后去哪（只认本站路径，防开放重定向）、已登录直接送进去且不无限往返、
// 会话失效（login_required、实时流被拒）时回登录页并记住原来的页面、主动退出不带着这一页、支持页不被弹走。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.js';
import { boot } from './http-helpers.js';
import { CSP } from '../src/http/server.js';
import { safeNext, mountLogin, renderHero } from '../public/login.js';
import { api, subscribe, leaveForLogin } from '../public/api.js';
import { refreshAccount, signOut, openAccount as openModalAccount } from '../public/accounts.js';
import { closeAllModals } from '../public/modals.js';
import { getLang, setLang } from '../public/i18n.js';

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve)); };
const reply = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
const openAccount = { user: null, registrationOpen: true, loginRequired: true };

/** 假的浏览器环境：fetch 按路径返回，location 记录跳转，sessionStorage 是个 Map */
function setup(account, routes = {}) {
  const dom = installFakeDom();
  const saved = { fetch: globalThis.fetch, lang: getLang(), location: globalThis.location, sessionStorage: globalThis.sessionStorage, EventSource: globalThis.EventSource };
  setLang('zh');
  const calls = [], replaced = [], navigated = [], store = new Map();
  let current = account;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, method: options.method || 'GET', body });
    if (url === '/api/account') return reply(200, current);
    if (routes[url]) return routes[url](body);
    return reply(404, { error: { code: 'not_found' } });
  };
  globalThis.location = { pathname: '/residents.html', search: '?tab=2', hash: '#x', replace: (to) => replaced.push(to) };
  globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const root = document.createElement('main');
  dom.root.append(root);
  return {
    dom, root, calls, replaced, navigated, store, setAccount: (a) => { current = a; },
    mount: (opts = {}) => mountLogin({ root, navigate: (to) => navigated.push(to), ...opts }),
    restore() {
      dom.restore();
      setLang(saved.lang);
      for (const k of ['fetch', 'location', 'sessionStorage', 'EventSource']) {
        if (saved[k] === undefined) delete globalThis[k]; else globalThis[k] = saved[k];
      }
    },
  };
}
const tabs = (root) => root.querySelectorAll('.login-tab').map((b) => b.textContent);
const inputs = (root) => root.querySelectorAll('input');
const names = (root) => inputs(root).map((i) => i.getAttribute('name'));
const fill = (root, values) => { for (const i of inputs(root)) if (i.getAttribute('name') in values) i.value = values[i.getAttribute('name')]; };
const submit = async (root) => { root.querySelector('form').fire('submit'); await settle(); };
const message = (root) => root.querySelector('.account-message');

test('safeNext：只认本站的路径，其余回首页（防开放重定向）', () => {
  assert.equal(safeNext('/residents.html'), '/residents.html');
  assert.equal(safeNext('/?resident=a1'), '/?resident=a1');
  assert.equal(safeNext('/admin.html#users'), '/admin.html#users');
  assert.equal(safeNext('/residents.html?tab=2#x'), '/residents.html?tab=2#x');
  for (const bad of [null, undefined, '', 42, 'residents.html', '//evil.example', '//evil.example/x', '/\\evil.example', '/\\/evil.example', 'https://evil.example', 'http://localhost/x', 'javascript:alert(1)', '/\t/evil.example', '/\n/evil.example', '/%0d%0a', '/login.html', '/login.html?next=/', `/${'a'.repeat(3000)}`]) {
    if (bad === '/%0d%0a') { assert.equal(safeNext(bad), '/%0d%0a', '已编码的换行留在路径里，不会变成分隔符'); continue; }
    assert.equal(safeNext(bad), '/', String(bad).slice(0, 40));
  }
  assert.equal(safeNext('/x', 'https://heirscity.site'), '/x');
});

test('登录页：未登录时有登录与注册两个标签，登录表单只有用户名与密码', async () => {
  const env = setup(openAccount);
  try {
    await env.mount();
    assert.deepEqual(tabs(env.root), ['登录', '注册']);
    assert.match(env.root.querySelector('h2').textContent, /登录后观看/);
    assert.deepEqual(names(env.root), ['username', 'password']);
    assert.equal(env.root.querySelector('input[name="password"]').getAttribute('autocomplete'), 'current-password');
    assert.equal(env.root.querySelector('.login-tab[aria-pressed="true"]').textContent, '登录');
    assert.match(env.root.textContent, /需要登录/);
    assert.ok(!env.root.querySelectorAll('a').some((a) => a.getAttribute('href') === '/'), '开着登录门时没有「先随便看看」');
    assert.deepEqual(env.navigated, []);
  } finally { env.restore(); }
});

test('登录页：登录提交用户名与密码，成功后去 next（带上浏览器保留的哈希）', async () => {
  const env = setup(openAccount, { '/api/account/login': () => reply(200, { user: { id: 'u1' } }) });
  try {
    await env.mount({ search: '?next=%2Fresidents.html%3Ftab%3D2', hash: '#cards' });
    fill(env.root, { username: ' alice ', password: 'a-long-test-password' });
    await submit(env.root);
    const post = env.calls.find((c) => c.url === '/api/account/login');
    assert.equal(post.method, 'POST');
    assert.deepEqual(post.body, { username: 'alice', password: 'a-long-test-password' });
    assert.deepEqual(env.navigated, ['/residents.html?tab=2#cards']);
  } finally { env.restore(); }
});

test('登录页：next 不可信时回首页；next 自带哈希时不重复；没有 next 回首页', async () => {
  const cases = [['?next=https%3A%2F%2Fevil.example%2F', '', '/'], ['?next=%2F%2Fevil.example', '', '/'], ['?next=%2Fadmin.html%23users', '#other', '/admin.html#users'], ['', '', '/'], ['', '#chronicle', '/#chronicle'], ['?next=%2Flogin.html', '', '/']];
  for (const [search, hash, expected] of cases) {
    const env = setup(openAccount, { '/api/account/login': () => reply(200, { user: { id: 'u1' } }) });
    try {
      await env.mount({ search, hash });
      fill(env.root, { username: 'alice', password: 'a-long-test-password' });
      await submit(env.root);
      assert.deepEqual(env.navigated, [expected], `${search} ${hash}`);
    } finally { env.restore(); }
  }
});

test('登录页：登录失败显示服务器的话，不跳转，按钮恢复；网络失败有提示', async () => {
  let down = false;
  const env = setup(openAccount, { '/api/account/login': () => (down ? reply(0, null) : reply(401, { error: { code: 'invalid_credentials', message: '用户名或密码错误，或账号已停用。' } })) });
  try {
    await env.mount();
    fill(env.root, { username: 'alice', password: 'wrong-password-123' });
    await submit(env.root);
    assert.equal(message(env.root).textContent, '用户名或密码错误，或账号已停用。');
    assert.match(message(env.root).className, /error/);
    assert.deepEqual(env.navigated, []);
    assert.ok(!env.root.querySelector('button[type="submit"]').hasAttribute('disabled') && env.root.querySelector('button[type="submit"]').disabled !== true, '失败后按钮可以再点');
    // 网络不通：fetch 抛错 → api() 返回 status 0
    globalThis.fetch = async () => { throw new Error('offline'); };
    await submit(env.root);
    assert.match(message(env.root).textContent, /无法连接服务器/);
    assert.deepEqual(env.navigated, []);
  } finally { env.restore(); }
});

test('登录页：注册要填确认密码，昵称可不填，不把确认密码发给服务器', async () => {
  const env = setup(openAccount, { '/api/account/register': () => reply(201, { user: { id: 'u2' } }) });
  try {
    await env.mount();
    env.root.querySelectorAll('.login-tab')[1].click();
    assert.deepEqual(names(env.root), ['username', 'displayName', 'password', 'confirmPassword']);
    assert.equal(env.root.querySelector('input[name="password"]').getAttribute('autocomplete'), 'new-password');
    assert.equal(env.root.querySelector('input[name="username"]').getAttribute('pattern'), '[A-Za-z0-9_]{3,32}');
    assert.equal(env.root.querySelector('input[name="password"]').getAttribute('minlength'), '12');
    assert.equal(env.root.querySelector('input[name="displayName"]').hasAttribute('required'), false);

    fill(env.root, { username: 'newbie', displayName: '', password: 'a-long-test-password', confirmPassword: 'another-long-password' });
    await submit(env.root);
    assert.equal(message(env.root).textContent, '两次输入的密码不一致。');
    assert.ok(!env.calls.some((c) => c.url === '/api/account/register'), '不一致时不请求服务器');

    fill(env.root, { confirmPassword: 'a-long-test-password' });
    await submit(env.root);
    assert.deepEqual(env.calls.find((c) => c.url === '/api/account/register').body, { username: 'newbie', password: 'a-long-test-password' });
    assert.deepEqual(env.navigated, ['/']);
  } finally { env.restore(); }
});

test('登录页：带昵称注册；mode 参数选标签，不可用的标签回到登录', async () => {
  const env = setup(openAccount, { '/api/account/register': () => reply(201, { user: { id: 'u2' } }) });
  try {
    await env.mount({ search: '?mode=register' });
    assert.equal(env.root.querySelector('.login-tab[aria-pressed="true"]').textContent, '注册');
    fill(env.root, { username: 'newbie', displayName: ' 新人 ', password: 'a-long-test-password', confirmPassword: 'a-long-test-password' });
    await submit(env.root);
    assert.deepEqual(env.calls.find((c) => c.url === '/api/account/register').body, { username: 'newbie', displayName: '新人', password: 'a-long-test-password' });
  } finally { env.restore(); }
  for (const mode of ['setup', 'bogus']) {
    const e2 = setup(openAccount);
    try {
      const page = await e2.mount({ search: `?mode=${mode}` });
      assert.equal(page.mode, 'login', mode);
    } finally { e2.restore(); }
  }
});

test('登录页：英雄区有品牌标题、设定与三件事，中英文各一套，换语言后重画', () => {
  const env = setup(openAccount);
  try {
    const hero = document.createElement('section');
    env.root.append(hero);
    renderHero(hero);
    assert.equal(hero.querySelector('h1').textContent, '后人纪 · 词元本位');
    assert.equal(hero.querySelector('h1').getAttribute('id'), 'login-title');
    assert.match(hero.querySelector('.login-eyebrow').textContent, /人类退场之后/);
    assert.equal(hero.querySelectorAll('li').length, 3);
    assert.deepEqual(hero.querySelectorAll('li').map((li) => li.querySelector('strong').textContent), ['观看', '创建', '家书']);
    setLang('en');
    renderHero(hero);
    assert.equal(hero.querySelectorAll('h1').length, 1, '重画不叠加');
    assert.equal(hero.querySelector('h1').textContent, 'The Heirs: Token Standard');
    assert.deepEqual(hero.querySelectorAll('li').map((li) => li.querySelector('strong').textContent), ['Watch', 'Create', 'Write']);
  } finally { env.restore(); }
});

test('登录页：公开注册关闭时只有登录；没有「初始化管理员」——即便旧版服务器仍报告尚无管理员', async () => {
  const closed = setup({ ...openAccount, registrationOpen: false });
  try {
    await closed.mount();
    assert.deepEqual(tabs(closed.root), ['登录']);
    assert.match(closed.root.textContent, /公开注册已关闭/);
  } finally { closed.restore(); }

  // 管理员只能用接口创建（ADMIN_KEY），页面上没有这个入口：标签、?mode=setup 与 ADMIN_KEY 输入框都不存在
  const legacy = setup({ ...openAccount, setupAvailable: true });
  try {
    const page = await legacy.mount({ search: '?mode=setup' });
    assert.deepEqual(tabs(legacy.root), ['登录', '注册']);
    assert.equal(page.mode, 'login', '?mode=setup 落回登录');
    legacy.root.querySelectorAll('.login-tab')[1].click();
    assert.deepEqual(names(legacy.root), ['username', 'displayName', 'password', 'confirmPassword']);
    assert.doesNotMatch(legacy.root.textContent, /初始化管理员|ADMIN_KEY/);
    assert.ok(!legacy.calls.some((c) => c.url === '/api/account/setup'));
  } finally { legacy.restore(); }
});

test('登录弹窗（支持页、游客可看的部署）也没有「初始化管理员」', async () => {
  const env = setup({ ...openAccount, loginRequired: false, setupAvailable: true });
  try {
    await openModalAccount();
    const modal = env.dom.root;
    const labels = modal.querySelectorAll('.subtabs button').map((b) => b.textContent);
    assert.deepEqual(labels, ['登录', '注册']);
    assert.doesNotMatch(modal.textContent, /初始化管理员|ADMIN_KEY/);
  } finally {
    closeAllModals();
    env.restore();
  }
});

test('登录页：登录门关着时多一个「先随便看看」，不强制', async () => {
  const env = setup({ ...openAccount, loginRequired: false });
  try {
    await env.mount();
    assert.ok(env.root.querySelectorAll('a').some((a) => a.getAttribute('href') === '/' && /先随便看看/.test(a.textContent)));
    assert.doesNotMatch(env.root.textContent, /需要登录/);
  } finally { env.restore(); }
});

test('登录页：已登录的人直接送进去；刚送进去又弹回来时不再自动跳，避免无限往返', async () => {
  const signedIn = { ...openAccount, user: { id: 'u1', username: 'alice', displayName: 'Alice' } };
  const env = setup(signedIn);
  try {
    await env.mount({ search: '?next=%2Fresidents.html' });
    assert.deepEqual(env.navigated, ['/residents.html']);
    assert.match(env.root.textContent, /Alice，正在进入/);
    assert.ok(env.root.querySelectorAll('a').some((a) => a.getAttribute('href') === '/residents.html'), '也给一个手动的「进入」');
    // 5 秒内又来到登录页：不再自动跳
    await env.mount({ search: '?next=%2Fresidents.html' });
    assert.deepEqual(env.navigated, ['/residents.html'], '没有第二次自动跳转');
    assert.match(env.root.textContent, /没能打开要去的页面/);
  } finally { env.restore(); }
});

test('登录页：读不到账号状态时给重试，而不是停在空白', async () => {
  const env = setup(openAccount);
  try {
    globalThis.fetch = async () => reply(500, { error: { message: '服务器出错' } });
    await env.mount();
    assert.match(env.root.textContent, /暂时无法连接/);
    assert.match(env.root.textContent, /服务器出错/);
    const retry = env.root.querySelectorAll('button').find((b) => b.textContent === '重试');
    assert.ok(retry);
    globalThis.fetch = async () => reply(200, openAccount);
    retry.click(); await settle();
    assert.deepEqual(tabs(env.root), ['登录', '注册']);
  } finally { env.restore(); }
});

test('登录页：英文界面', async () => {
  const env = setup(openAccount);
  try {
    setLang('en');
    await env.mount();
    assert.deepEqual(tabs(env.root), ['Sign in', 'Register']);
    assert.match(env.root.querySelector('h2').textContent, /Sign in to watch/);
  } finally { env.restore(); }
});

test('api()：服务器说 login_required 就回登录页并记住这一页；别的 401、登录页本身、没有页面地址都不动', async () => {
  const env = setup(openAccount);
  try {
    globalThis.fetch = async () => reply(401, { error: { code: 'login_required', message: '请先登录后再观看这座城。' } });
    const r = await api('/api/public/state');
    assert.equal(r.status, 401);
    assert.deepEqual(env.replaced, ['/login.html?next=%2Fresidents.html%3Ftab%3D2%23x']);

    env.replaced.length = 0;
    globalThis.fetch = async () => reply(401, { error: { code: 'unauthorized', message: '请先登录。' } });
    await api('/api/account/agents');
    globalThis.fetch = async () => reply(401, { error: { code: 'invalid_password', message: '当前密码错误。' } });
    await api('/api/account', { method: 'PATCH', body: {} });
    assert.deepEqual(env.replaced, [], '只有登录门的 login_required 才弹走');

    globalThis.location.pathname = '/login.html';
    globalThis.fetch = async () => reply(401, { error: { code: 'login_required' } });
    await api('/api/public/state');
    assert.deepEqual(env.replaced, [], '已经在登录页');

    delete globalThis.location;
    assert.equal(leaveForLogin(), false, '没有 location（非浏览器）时不抛错');
    await api('/api/public/state');
  } finally { env.restore(); }
});

test('leaveForLogin：首页不带 next；主动退出（remember: false）不带着这一页', () => {
  const env = setup(openAccount);
  try {
    globalThis.location.pathname = '/'; globalThis.location.search = ''; globalThis.location.hash = '';
    assert.equal(leaveForLogin(), true);
    globalThis.location.pathname = '/admin.html'; globalThis.location.hash = '#users';
    leaveForLogin();
    leaveForLogin({ remember: false });
    assert.deepEqual(env.replaced, ['/login.html', '/login.html?next=%2Fadmin.html%23users', '/login.html']);
  } finally { env.restore(); }
});

test('refreshAccount：登录门开着而没有登录就回登录页；支持页（redirect: false）与登录门关着时不动', async () => {
  const env = setup(openAccount);
  try {
    await refreshAccount({ notify: false });
    assert.deepEqual(env.replaced, ['/login.html?next=%2Fresidents.html%3Ftab%3D2%23x']);
    env.replaced.length = 0;
    await refreshAccount({ notify: false, redirect: false });
    assert.deepEqual(env.replaced, []);
    env.setAccount({ ...openAccount, loginRequired: false });
    await refreshAccount({ notify: false });
    assert.deepEqual(env.replaced, [], '游客可看的部署不弹走');
    env.setAccount({ ...openAccount, user: { id: 'u1', username: 'alice', displayName: 'Alice', role: 'user' } });
    await refreshAccount({ notify: false });
    assert.deepEqual(env.replaced, []);
  } finally { env.restore(); }
});

test('signOut：登录门开着时退出后回登录页（不带这一页）；关着时只是刷新账号状态', async () => {
  const user = { id: 'u1', username: 'alice', displayName: 'Alice', role: 'user' };
  const env = setup({ ...openAccount, user }, { '/api/account/logout': () => reply(200, { ok: true }) });
  try {
    await refreshAccount({ notify: false });
    assert.deepEqual(env.replaced, []);
    const r = await signOut();
    assert.equal(r.ok, true);
    assert.deepEqual(env.replaced, ['/login.html']);
    assert.ok(env.calls.some((c) => c.url === '/api/account/logout' && c.method === 'POST'));

    env.replaced.length = 0;
    env.setAccount({ ...openAccount, loginRequired: false, user });
    await refreshAccount({ notify: false });
    const reads = () => env.calls.filter((c) => c.url === '/api/account').length;
    const before = reads();
    env.setAccount({ ...openAccount, loginRequired: false });
    await signOut();
    assert.deepEqual(env.replaced, []);
    assert.equal(reads(), before + 1, '没有门时退出后重读账号状态');
  } finally { env.restore(); }
});

test('实时流被服务器拒绝（readyState 已关闭）且已不在登录状态时，回登录页；还在自动重连时不动', async () => {
  const env = setup(openAccount);
  try {
    class FakeSource {
      constructor(url) { this.url = url; this.readyState = 0; this.listeners = {}; FakeSource.last = this; }
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
      close() { this.readyState = 2; }
      emit(type) { for (const fn of this.listeners[type] || []) fn({}); }
    }
    globalThis.EventSource = FakeSource;
    let errors = 0;
    subscribe({ error: () => { errors++; }, e() {}, tick() {} });
    assert.equal(FakeSource.last.url, '/api/public/stream');

    FakeSource.last.readyState = 0; // 正在重连：网络抖动
    FakeSource.last.emit('error'); await settle();
    assert.equal(errors, 1);
    assert.deepEqual(env.replaced, []);
    assert.ok(!env.calls.some((c) => c.url === '/api/account'));

    FakeSource.last.readyState = 2; // 被拒绝：不会再重连
    FakeSource.last.emit('error'); await settle();
    assert.equal(errors, 2);
    assert.deepEqual(env.replaced, ['/login.html?next=%2Fresidents.html%3Ftab%3D2%23x']);

    // 关闭了但其实还在登录（比如 429 超限）：留在原地
    env.replaced.length = 0;
    env.setAccount({ ...openAccount, user: { id: 'u1', username: 'alice', displayName: 'Alice', role: 'user' } });
    FakeSource.last.emit('error'); await settle();
    assert.deepEqual(env.replaced, []);
  } finally { env.restore(); }
});

test('支持页是公开页面：开着登录门而没有登录时也不被弹到登录页，照常读到收款方式', async () => {
  const env = setup(openAccount, { '/api/public/support': () => reply(200, { qr: { wechat: null, alipay: null } }) });
  try {
    const elements = new Map(['#console-header', '#support-message', '#support-qr', '#support-retry'].map((sel) => [sel, document.createElement('div')]));
    for (const el of elements.values()) env.root.append(el);
    document.querySelector = (sel) => elements.get(sel) || null;
    await import('../public/support.js'); // 顶层语句就是页面启动：读账号、读收款方式
    await settle();
    assert.ok(env.calls.some((c) => c.url === '/api/account'), '读了账号状态');
    assert.deepEqual(env.replaced, [], '没有被弹到登录页');
    assert.match(elements.get('#support-message').textContent, /收款方式尚未开放/);
  } finally {
    delete document.querySelector;
    env.restore();
  }
});

test('登录页的文件：走 CSP、不写内联样式或脚本，页面里有 login.js 需要的元素，静态服务可取到', async () => {
  const html = readFileSync(new URL('../public/login.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../public/login.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /\sstyle=|<script(?![^>]*\bsrc=)/);
  assert.match(html, /<script type="module" src="\/login\.js">/);
  assert.match(html, /href="\/console\.css"/);
  for (const [, id] of js.matchAll(/getElementById\('([\w-]+)'\)/g)) assert.match(html, new RegExp(`id="${id}"`), `login.html 缺少 #${id}`);
  assert.doesNotMatch(js, /innerHTML|document\.write|eval\(/);
  // 登录页不引入观测站的模块：首屏轻，也不会因它们的改动而坏
  const imports = [...js.matchAll(/from '\.\/([\w-]+)\.js'/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['api', 'dom', 'i18n']);
  const e = await boot();
  try {
    const r = await e.call('/login.html');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-security-policy'), CSP);
    for (const [, id] of r.text.matchAll(/id="(login-[\w-]+)"/g)) assert.ok(id, id);
    assert.match(r.text, /class="login-scene"/);
    // 背景图：样式引用它，服务器以 SVG 提供，体积有界（它是首屏资源）
    const css = readFileSync(new URL('../public/console.css', import.meta.url), 'utf8');
    assert.match(css, /url\("\/login-bg\.svg"\)/);
    const bg = await e.call('/login-bg.svg');
    assert.equal(bg.status, 200);
    assert.match(bg.headers.get('content-type'), /image\/svg\+xml/);
    assert.ok(bg.text.startsWith('<svg') && bg.text.length < 80 * 1024, `login-bg.svg ${bg.text.length} 字节`);
    assert.doesNotMatch(bg.text, /<script|<image|href=|xlink:|@import|url\(\s*['"]?(?!#)/i, '背景图自包含：没有脚本与外部引用');
    // 窄屏：英雄区后面的暗色衬底不能超出页面的 16px 边距，否则手机上会出现横向滚动
    const narrow = css.slice(css.indexOf('@media (max-width: 900px)'));
    const inset = /\.login-hero::before \{ inset: (-?\d+)px (-?\d+)px (-?\d+)px (-?\d+)px; \}/.exec(narrow.slice(0, narrow.indexOf('@media (max-width: 480px)')));
    assert.ok(inset, '窄屏下要收窄 .login-hero::before');
    assert.ok(Math.abs(Number(inset[2])) <= 16 && Math.abs(Number(inset[4])) <= 16, `衬底左右外扩 ${inset[4]} / ${inset[2]}px，超过了页面边距`);
    assert.match(css, /\.login-main \{[^}]*overflow-x: clip;/);
  } finally { await e.close(); }
});
