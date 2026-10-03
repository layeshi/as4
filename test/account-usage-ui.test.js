// 用户中心里的「我的居民」与管理员的「托管用量」（public/account-usage-ui.js）：用假 DOM 渲染，不需要浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './fake-dom.js';
import { accountAgentsPanel, adminUsageView } from '../public/account-usage-ui.js';
import { t, setLang, getLang } from '../public/i18n.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const reply = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
const bucket = (o = {}) => ({ calls: 0, failed: 0, unreported: 0, input: 0, output: 0, tokens: 0, ...o });
const day = (i) => new Date(Date.UTC(2026, 8, 21 + i)).toISOString().slice(0, 10);

/** 装好假 DOM 与假 fetch（记录每个请求），固定用中文 */
function setup(route) {
  const dom = installFakeDom();
  const saved = { fetch: globalThis.fetch, lang: getLang() };
  setLang('zh');
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const req = { url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined };
    requests.push(req);
    return route(req);
  };
  return { dom, requests, restore() { dom.restore(); setLang(saved.lang); globalThis.fetch = saved.fetch; } };
}
const buttons = (root, label) => root.querySelectorAll('button').filter((b) => b.textContent === label);
const rowsOf = (root) => root.querySelectorAll('tbody tr').map((r) => r.textContent);

const usage = (extra = {}) => ({
  tracked: true, timezone: 'Asia/Shanghai', day: day(13), since: '2026-09-30T02:00:00.000Z',
  total: bucket({ calls: 7, failed: 1, input: 60000, output: 1200, tokens: 61200 }), today: bucket({ calls: 3, input: 20000, output: 400, tokens: 20400 }), days: [], recent: [], ...extra,
});
const agents = () => [
  { agentId: 'a1', name: '青禾', status: 'awake', runnerStatus: 'waiting', linkedAt: '2026-10-01T00:00:00.000Z', usage: usage() },
  { agentId: 'a2', name: '松烟', status: 'dead', runnerStatus: 'stopped', linkedAt: '2026-10-01T00:00:00.000Z', usage: usage({ total: bucket({ calls: 2, unreported: 2 }), today: bucket() }) },
  { agentId: 'a3', name: '长庚', status: 'awake', runnerStatus: 'unconfigured', linkedAt: '2026-10-01T00:00:00.000Z', usage: { tracked: false } },
];

test('我的居民：一张表（状态、今日、累计、调用及提示）与合计；「进入幕后」只在本浏览器有密钥时可点；解除关联', async () => {
  let list = agents();
  const env = setup((req) => {
    if (req.url === '/api/account/agents' && req.method === 'GET') return reply(200, { agents: list });
    if (req.method === 'DELETE') { list = list.filter((a) => req.url !== `/api/account/agents/${a.agentId}`); return reply(200, { ok: true }); }
    return reply(404, null);
  });
  try {
    const opened = [];
    const owners = [{ key: 'key-a1', agentId: 'a1', name: '青禾' }, { key: 'key-unknown' }, { key: 'key-a9', agentId: 'a9' }];
    const panel = accountAgentsPanel({ openBackstage: (key) => opened.push(key), savedOwners: () => owners });
    env.dom.root.append(panel);
    assert.match(panel.textContent, /我的居民/);
    assert.match(panel.textContent, /只能查看居民的状态与 token 用量/);
    await settle();

    const rows = rowsOf(panel);
    assert.equal(rows.length, 4, '三位居民加合计');
    assert.match(rows[0], new RegExp(`青禾 · a1.*${t('status_awake')}.*${t('runnerStatus_waiting')}.*20,400.*61,200.*7.*失败 1 次`));
    assert.match(rows[1], new RegExp(`松烟 · a2.*${t('status_dead')}.*${t('runnerStatus_stopped')}.*0.*0.*2.*未报告用量 2 次`));
    assert.match(rows[2], /长庚 · a3.*未托管运行器，无法统计/);
    assert.match(rows[3], /合计.*20,400.*61,200.*9/, '合计只算托管的两位');
    assert.doesNotMatch(panel.textContent, /NaN|undefined|\[object/);

    assert.equal(buttons(panel, t('accountOpenBackstage')).length, 1, '只有 a1 在本浏览器保存了密钥');
    assert.equal(panel.textContent.split(t('accountNoKeyHere')).length - 1, 2, '其余两位说明原因');
    buttons(panel, t('accountOpenBackstage'))[0].click();
    assert.deepEqual(opened, ['key-a1']);

    assert.equal(buttons(panel, t('accountUnlink')).length, 3);
    buttons(panel, t('accountUnlink'))[0].click();
    await settle();
    const del = env.requests.find((r) => r.method === 'DELETE');
    assert.deepEqual(del, { url: '/api/account/agents/a1', method: 'DELETE', body: {} });
    assert.deepEqual(rowsOf(panel).map((r) => r.split(' · ')[0]), ['松烟', '长庚'], '解除之后重新载入；只剩一位托管的就没有合计行');
  } finally { env.restore(); }
});

test('我的居民：没有关联时的说明；单个居民不出合计；会话失效、网络错误与异常响应不抛错', async () => {
  let next = reply(200, { agents: [] });
  const env = setup(() => next);
  try {
    const make = () => { const p = accountAgentsPanel({ openBackstage() {}, savedOwners: () => [] }); env.dom.root.append(p); return p; };
    let p = make(); await settle();
    assert.match(p.textContent, /还没有关联的居民/);
    assert.equal(p.querySelector('table'), null);

    next = reply(200, { agents: [agents()[0]] });
    p = make(); await settle();
    assert.equal(rowsOf(p).length, 1, '一位托管居民不需要合计行');

    next = reply(401, { error: { code: 'unauthorized', message: '请先登录。' } });
    p = make(); await settle();
    assert.match(p.textContent, /登录已失效/);

    next = reply(0, null);
    p = make(); await settle();
    assert.match(p.textContent, /网络错误/);

    for (const odd of [reply(200, null), reply(200, {}), reply(200, { agents: 'x' }), reply(500, { error: { message: '服务器出错了' } })]) {
      next = odd; p = make(); await settle();
      assert.match(p.textContent, /加载失败|服务器出错了/);
      assert.doesNotMatch(p.textContent, /NaN|undefined/);
    }
    // 状态未知或缺字段的居民也画得出来
    next = reply(200, { agents: [{ agentId: 'a7', name: '怪客', status: 'sleepy', usage: usage() }, { agentId: 'a8', name: '无用量', status: 'awake' }] });
    p = make(); await settle();
    assert.equal(rowsOf(p).length, 2);
    assert.doesNotMatch(p.textContent, /NaN|\[object/);
  } finally { env.restore(); }
});

test('我的居民：粘贴造者密钥认领；一键认领本浏览器保存的；部分失败、上限、全部失败与会话失效都有说明', async () => {
  let results = [{ ok: true, agentId: 'a1', name: '青禾' }];
  let status = 200;
  const env = setup((req) => {
    if (req.url === '/api/account/agents' && req.method === 'GET') return reply(200, { agents: [] });
    if (req.url === '/api/account/agents' && req.method === 'POST') return status === 200 ? reply(200, { results }) : reply(status, { error: { code: 'rate_limited', message: '认领太频繁，请稍后再试。' } });
    return reply(404, null);
  });
  try {
    const owners = [{ key: 'key-a1', agentId: 'a1' }, { key: 'key-b' }, { name: '没有密钥的残缺条目' }, { key: '' }];
    const panel = accountAgentsPanel({ openBackstage() {}, savedOwners: () => owners });
    env.dom.root.append(panel);
    await settle();
    const posts = () => env.requests.filter((r) => r.method === 'POST');
    const input = panel.querySelector('input[name="ownerKey"]');
    const message = () => panel.querySelector('.account-message');
    const submit = async (key) => { input.value = key; panel.querySelector('form').fire('submit'); await settle(); };

    await submit('   ');
    assert.equal(posts().length, 0, '空白不发请求');

    await submit('  key-a1  ');
    assert.deepEqual(posts()[0].body, { ownerKeys: ['key-a1'] }, '去掉空白，按批量接口发');
    assert.match(message().textContent, /已关联 1 位居民。/);
    assert.equal(input.value, '', '认领之后清空输入框');
    assert.equal(message().className, 'account-message');

    const savedBtn = panel.querySelectorAll('button').find((b) => b.textContent.startsWith('认领本浏览器已保存的居民'));
    assert.equal(savedBtn.textContent, t('accountClaimSaved', { n: 4 }));
    assert.equal(savedBtn.hidden, false);
    results = [{ ok: true, agentId: 'a1', name: '青禾' }, { ok: false, code: 'not_found' }];
    savedBtn.click();
    await settle();
    assert.deepEqual(posts()[1].body, { ownerKeys: ['key-a1', 'key-b'] }, '只发有密钥的条目');
    assert.match(message().textContent, /已关联 1 位居民。 1 把密钥无效，或它的居民已不在。/);

    results = [{ ok: false, code: 'not_found' }, { ok: false, code: 'not_found' }];
    await submit('nope');
    assert.match(message().textContent, /已关联 0 位居民。 2 把密钥无效/);
    assert.equal(message().className, 'account-message error', '一位也没关联上算失败');

    results = [{ ok: false, code: 'too_many_agents' }];
    await submit('k');
    assert.match(message().textContent, /关联数量已达上限/);

    status = 429;
    await submit('k');
    assert.match(message().textContent, /认领太频繁/);
    assert.equal(message().className, 'account-message error');
    status = 0;
    await submit('k');
    assert.match(message().textContent, /网络错误/);
  } finally { env.restore(); }

  // 没有保存任何密钥时，一键认领按钮是隐藏的
  const quiet = setup((req) => (req.method === 'GET' ? reply(200, { agents: [] }) : reply(404, null)));
  try {
    const panel = accountAgentsPanel({ openBackstage() {}, savedOwners: () => [] });
    quiet.dom.root.append(panel);
    await settle();
    assert.equal(panel.querySelectorAll('button').find((b) => b.textContent.startsWith('认领本浏览器已保存的居民')).hidden, true);
  } finally { quiet.restore(); }
});

test('我的居民：一键认领一次最多发 50 把密钥（与服务器的批量上限一致）', async () => {
  const env = setup((req) => (req.method === 'GET' ? reply(200, { agents: [] }) : reply(200, { results: [] })));
  try {
    const owners = Array.from({ length: 60 }, (_, i) => ({ key: `key-${i}` }));
    const panel = accountAgentsPanel({ openBackstage() {}, savedOwners: () => owners });
    env.dom.root.append(panel);
    await settle();
    panel.querySelectorAll('button').find((b) => b.textContent.startsWith('认领本浏览器已保存的居民')).click();
    await settle();
    const post = env.requests.find((r) => r.method === 'POST');
    assert.equal(post.body.ownerKeys.length, 50);
    assert.equal(post.body.ownerKeys[0], 'key-0');
  } finally { env.restore(); }
});

const overview = (extra = {}) => {
  const days = Array.from({ length: 14 }, (_, i) => ({ day: day(i), ...bucket() }));
  days[13] = { day: day(13), ...bucket({ calls: 9, failed: 1, unreported: 2, input: 60000, output: 1200, tokens: 61200 }) };
  return {
    timezone: 'Asia/Shanghai', day: day(13), hosted: 2, unhosted: 3,
    total: bucket({ calls: 9, failed: 1, unreported: 2, input: 60000, output: 1200, tokens: 61200 }), today: bucket({ calls: 9, failed: 1, unreported: 2, input: 60000, output: 1200, tokens: 61200 }), days,
    agents: [
      { agentId: 'a1', name: '青禾', status: 'awake', model: 'glm-5.3', creatorName: '<img src=x onerror=alert(1)>', accounts: ['alice', 'bob'], runnerStatus: 'waiting',
        usage: { since: '2026-09-30T02:00:00.000Z', lastCallAt: '2026-10-03T08:00:00.000Z', total: bucket({ calls: 7, failed: 1, input: 60000, output: 1200, tokens: 61200 }), today: bucket({ calls: 7, input: 60000, output: 1200, tokens: 61200 }) } },
      { agentId: 'a2', name: '松烟', status: 'awake', model: 'mock', creatorName: null, accounts: [], runnerStatus: 'paused',
        usage: { since: '2026-09-30T02:00:00.000Z', lastCallAt: null, total: bucket({ calls: 2, unreported: 2 }), today: bucket({ calls: 2, unreported: 2 }) } },
    ],
    ...extra,
  };
};

test('管理员的托管用量：数字块、近 14 日合计图、每位居民的造者与关联账号；造者署名按文本渲染', async () => {
  const env = setup((req) => (req.url === '/api/admin/usage' ? reply(200, overview()) : reply(404, null)));
  try {
    const body = env.dom.root;
    adminUsageView(body);
    assert.match(body.textContent, /托管用量/);
    assert.match(body.textContent, /服务器托管运行的居民/);
    await settle();
    assert.deepEqual(env.requests, [{ url: '/api/admin/usage', method: 'GET', body: undefined }]);
    const text = body.textContent;
    assert.match(text, /托管居民.*2.*另有 3 位在世居民未托管，看不到用量/);
    assert.match(text, /61,200/);
    assert.match(text, /输入 60,000 · 输出 1,200/);
    assert.match(text, /失败 1 次 · 未报告用量 2 次/);
    const chart = body.querySelector('svg.usage-chart');
    assert.ok(chart);
    assert.equal(chart.querySelectorAll('g.usage-bar').length, 14);
    assert.equal(chart.querySelectorAll('rect.in').length, 1, '只有一天有用量');

    const rows = rowsOf(body);
    assert.equal(rows.length, 2);
    assert.match(rows[0], /青禾 · a1.*@alice @bob.*glm-5\.3.*61,200.*7.*失败 1 次/);
    assert.ok(rows[0].includes('<img src=x onerror=alert(1)>'), '造者署名原样显示为文字');
    assert.equal(body.querySelector('img'), null, '没有被当成 HTML');
    assert.match(rows[1], /松烟 · a2.*未关联账号.*mock.*未报告用量 2 次.*尚无调用/);
    assert.doesNotMatch(text, /NaN|undefined|\[object/);
  } finally { env.restore(); }
});

test('管理员的托管用量：没有托管居民、无权限、网络错误与异常响应不抛错', async () => {
  let next = reply(200, overview({ hosted: 0, unhosted: 0, agents: [], days: overview().days.map((d) => ({ ...d, ...bucket() })), total: bucket(), today: bucket() }));
  const env = setup(() => next);
  try {
    let body = env.dom.root;
    adminUsageView(body); await settle();
    assert.match(body.textContent, /还没有托管运行的居民/);
    assert.equal(body.querySelector('table'), null);
    assert.equal(body.querySelector('svg'), null, '一个 token 也没有时不画空图');
    assert.doesNotMatch(body.textContent, /另有/);

    for (const [response, expected] of [[reply(401, { error: { code: 'unauthorized', message: '未授权' } }), /未授权/], [reply(0, null), /网络错误/], [reply(200, {}), /加载失败/], [reply(200, { agents: [] }), /加载失败/], [reply(200, null), /加载失败/]]) {
      next = response;
      body = installFakeRoot(env);
      adminUsageView(body); await settle();
      assert.match(body.textContent, expected);
    }
  } finally { env.restore(); }
});
/** 每次换一块干净的容器，免得和上一轮的内容混在一起 */
function installFakeRoot(env) {
  for (const c of [...env.dom.root.childNodes]) env.dom.root.removeChild(c);
  return env.dom.root;
}

test('用户中心把两块接上了：所有登录用户有「我的居民」，只有管理员有「托管用量」入口', () => {
  const src = readFileSync(new URL('../public/accounts.js', import.meta.url), 'utf8');
  assert.match(src, /import \{[^}]*accountAgentsPanel[^}]*adminUsageView[^}]*\} from '\.\/account-usage-ui\.js'/);
  assert.ok(src.includes('accountAgentsPanel({ openBackstage: (key) => { modal.close(); openBackstage(appCtx, key); }, savedOwners })'), '「我的居民」：进入幕后时先关掉用户中心、带上应用上下文，并传入已保存的密钥');
  assert.match(src, /if \(u\.role === 'admin'\) actions\.append\(button\(tr\('托管用量', 'Hosted usage'\), openAdminUsage\)\)/, '只有管理员有入口');
  assert.match(src, /function openAdminUsage\(\) \{\s*adminUsageView\(/);
  assert.match(src, /initAccounts\(btn, ctx\)/);
  assert.match(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), /initAccounts\(document\.getElementById\('btn-account'\), ctx\)/);
});
