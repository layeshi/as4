// 幕后的 token 用量界面（public/usage-ui.js 与 modals.js 的接线）：用假 DOM 渲染，不需要浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { usagePanel, usageOverview } from '../public/usage-ui.js';
import { openBackstage, closeAllModals } from '../public/modals.js';
import { t, setLang, getLang } from '../public/i18n.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const day = (i) => new Date(Date.UTC(2026, 8, 21 + i)).toISOString().slice(0, 10);

/** 与服务器 GET /api/owner/usage 同形的一份数据：近 14 日里有两天有调用，共 7 次（1 次失败） */
function fixture(extra = {}) {
  const days = Array.from({ length: 14 }, (_, i) => ({ day: day(i), calls: 0, failed: 0, unreported: 0, input: 0, output: 0, tokens: 0 }));
  days[11] = { day: day(11), calls: 4, failed: 0, unreported: 0, input: 40000, output: 800, tokens: 40800 };
  days[13] = { day: day(13), calls: 3, failed: 1, unreported: 0, input: 20000, output: 400, tokens: 20400 };
  return {
    agentId: 'a1', name: '青禾', tracked: true, timezone: 'Asia/Shanghai', day: day(13), since: '2026-09-30T02:00:00.000Z',
    total: { calls: 7, failed: 1, unreported: 0, input: 60000, output: 1200, tokens: 61200 }, today: days[13], days,
    recent: [
      { at: '2026-10-04T01:00:00.000Z', ok: true, reported: true, input: 10000, output: 200, ms: 2100, model: 'glm-5.3' },
      { at: '2026-10-04T01:05:00.000Z', ok: false, input: 0, output: 0, ms: 50, model: 'glm-5.3', status: 429 },
      { at: '2026-10-04T01:10:00.000Z', ok: true, reported: false, input: 0, output: 0, ms: 3000, model: 'glm-5.3' },
    ],
    ...extra,
  };
}
const reply = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });

/** 装好假 DOM 与假 fetch，固定用中文；返回 { dom, requests, restore } */
function setup(route) {
  const dom = installFakeDom();
  const saved = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, lang: getLang() };
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  setLang('zh');
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const key = (options.headers.Authorization || '').replace('Bearer ', '');
    requests.push({ url, key });
    return route(url, key);
  };
  return {
    dom, requests, store,
    restore() {
      closeAllModals();
      dom.restore();
      setLang(saved.lang);
      Object.assign(globalThis, { fetch: saved.fetch, localStorage: saved.localStorage });
    },
  };
}
const buttons = (root, label) => root.querySelectorAll('button').filter((b) => b.textContent === label);

test('用量面板：四块数字、近 14 日柱状图、最近调用、统计说明', () => {
  const env = setup(() => reply(500, null));
  try {
    const panel = usagePanel('k', fixture());
    env.dom.root.append(panel);
    const text = panel.textContent;
    assert.match(text, /Token 用量/);
    assert.match(text, /61,200/, '累计');
    assert.match(text, /20,400/, '今日');
    assert.match(text, /输入 60,000 · 输出 1,200/);
    assert.match(text, /10,200/, '平均每次 = 61200 ÷ 6 次报告了用量的调用');
    assert.match(text, /失败 1 次/);
    assert.doesNotMatch(text, /未报告用量 \d+ 次/, '没有未报告的调用时不显示');
    assert.match(text, /今日 3 次调用/);

    const chart = panel.querySelector('svg.usage-chart');
    assert.ok(chart, '有柱状图');
    assert.equal(chart.querySelectorAll('g.usage-bar').length, 14, '每一天一组，含没有调用的日子');
    assert.equal(chart.querySelectorAll('rect.in').length, 2);
    assert.equal(chart.querySelectorAll('rect.out').length, 2);
    assert.match(chart.querySelectorAll('title')[13].textContent, new RegExp(`${day(13)} · 输入 20,000 · 输出 400 · 模型调用 3`));
    assert.equal(chart.querySelectorAll('title')[0].textContent.includes('输入 0'), true, '没有调用的日子也有读数');

    const lines = panel.querySelectorAll('ul.usage-recent li').map((li) => li.textContent);
    assert.equal(lines.length, 3);
    assert.match(lines[0], /接口未报告用量/, '最新的在前');
    assert.match(lines[1], /失败（HTTP 429）/);
    assert.match(lines[2], /输入 10,000 · 输出 200.*2\.1 s.*glm-5\.3/);
    assert.match(text, /Asia\/Shanghai/);
    assert.match(text, /连接测试/);
    assert.doesNotMatch(text, /undefined|NaN|\[object/);
  } finally { env.restore(); }
});

test('用量面板：没有调用、全是未报告（演示模型）、未托管，以及不完整或失败的响应都不抛错', async () => {
  const env = setup(() => reply(500, null));
  try {
    const empty = usagePanel('k', fixture({ since: null, total: { calls: 0, failed: 0, unreported: 0, input: 0, output: 0, tokens: 0 }, days: fixture().days.map((d) => ({ ...d, calls: 0, tokens: 0, input: 0, output: 0 })), recent: [] }));
    assert.match(empty.textContent, /还没有调用过模型/);
    assert.equal(empty.querySelector('svg'), null);
    assert.match(empty.textContent, /平均每次/);

    const demo = fixture({ total: { calls: 5, failed: 0, unreported: 5, input: 0, output: 0, tokens: 0 }, today: { ...fixture().today, tokens: 0 }, days: fixture().days.map((d) => ({ ...d, tokens: 0, input: 0, output: 0 })) });
    const demoPanel = usagePanel('k', demo);
    assert.match(demoPanel.textContent, /未报告用量 5 次/);
    assert.equal(demoPanel.querySelector('svg'), null, '一个 token 也没有时不画空图');
    assert.match(demoPanel.textContent, /最近调用/);

    const manual = usagePanel('k', { agentId: 'a1', tracked: false });
    assert.match(manual.textContent, /没有托管运行器/);
    assert.match(manual.textContent, /运行管理/);

    for (const odd of [undefined, null, {}, { agents: [] }, { tracked: true }, { tracked: true, total: {}, today: {}, days: 'x', recent: [] }]) {
      const p = usagePanel('k', odd);
      assert.match(p.textContent, /加载失败/);
      assert.doesNotMatch(p.textContent, /NaN|undefined/);
    }
  } finally { env.restore(); }
});

test('用量面板：刷新请求 /api/owner/usage 并更新；失败时保留旧数据并说明原因', async () => {
  let next = reply(200, fixture({ total: { calls: 9, failed: 0, unreported: 0, input: 90000, output: 3000, tokens: 93000 } }));
  const env = setup(() => next);
  try {
    const panel = usagePanel('owner-key', fixture());
    env.dom.root.append(panel);
    assert.match(panel.textContent, /61,200/);
    buttons(panel, t('refresh'))[0].click();
    await settle();
    assert.deepEqual(env.requests, [{ url: '/api/owner/usage', key: 'owner-key' }]);
    assert.match(panel.textContent, /93,000/);
    assert.doesNotMatch(panel.textContent, /61,200/);

    next = reply(401, { error: { code: 'unauthorized', message: '未授权' } });
    buttons(panel, t('refresh'))[0].click();
    await settle();
    assert.match(panel.textContent, /密钥无效/);
    assert.match(panel.textContent, /93,000/, '失败时保留上一次的数据');

    next = reply(0, null);
    buttons(panel, t('refresh'))[0].click();
    await settle();
    assert.match(panel.textContent, /网络错误/);
  } finally { env.restore(); }
});

test('用量总览：每把密钥一行，未托管 / 失效 / 失败的行说明原因，合计只算有统计的，「查看」回到那位居民', async () => {
  const env = setup((url, key) => {
    if (key === 'ka') return reply(200, fixture({ agentId: 'a', name: '甲' }));
    if (key === 'kb') return reply(200, fixture({ agentId: 'b', name: '乙', total: { calls: 3, failed: 0, unreported: 0, input: 1000, output: 100, tokens: 1100 }, today: { ...fixture().today, tokens: 500 } }));
    if (key === 'kc') return reply(200, { agentId: 'c', name: '丙', tracked: false });
    if (key === 'kf') return reply(200, fixture({ agentId: 'f', name: '戊', total: { calls: 5, failed: 0, unreported: 5, input: 0, output: 0, tokens: 0 }, today: { ...fixture().today, tokens: 0 } }));
    if (key === 'kd') return reply(401, { error: { code: 'unauthorized' } });
    return reply(0, null);
  });
  try {
    const opened = [];
    const entries = [{ key: 'ka', agentId: 'a', name: '甲' }, { key: 'kb', agentId: 'b', name: '乙' }, { key: 'kc', agentId: 'c' }, { key: 'kd', agentId: 'd', name: '丁' }, { key: 'ke', agentId: 'e' }, { key: 'kf', agentId: 'f', name: '戊' }];
    const overview = usageOverview(entries, { onOpen: (key) => opened.push(key) });
    env.dom.root.append(overview);
    assert.match(overview.textContent, /本浏览器保存了造者密钥/);
    assert.equal(overview.querySelectorAll('tbody tr').length, entries.length + 1, '每把密钥一行，外加合计行');
    await settle();
    assert.deepEqual(env.requests.map((r) => r.key).sort(), ['ka', 'kb', 'kc', 'kd', 'ke', 'kf']);
    const rows = overview.querySelectorAll('tbody tr').map((r) => r.textContent);
    assert.match(rows[0], /甲 · a.*20,400.*61,200.*7.*失败 1 次/, '有失败的调用时在调用数旁提示');
    assert.match(rows[1], /乙 · b.*500.*1,100.*3/);
    assert.match(rows[2], /丙 · c.*未托管运行器，无法统计/);
    assert.match(rows[3], /丁 · d.*造者密钥已失效/);
    assert.match(rows[4], /e.*网络错误/);
    assert.match(rows[5], /戊 · f.*0.*0.*5.*未报告用量 5 次/, '0 token 但有调用：提示是接口没有报告用量，而不是免费');
    assert.match(rows[6], /合计.*20,900.*62,300.*15/, '合计 = 甲 + 乙 + 戊');
    assert.equal(buttons(overview, t('usageOpen')).length, 5, '密钥失效的行没有「查看」');
    assert.equal(buttons(overview, t('usageOpen'))[0].getAttribute('aria-label'), '查看 甲 · a', '读屏时知道是哪位居民');
    buttons(overview, t('usageOpen'))[1].click();
    assert.deepEqual(opened, ['kb']);
    assert.doesNotMatch(overview.textContent, /NaN|undefined|\[object/);

    const none = usageOverview([], { onOpen() {} });
    assert.equal(none.querySelectorAll('tbody tr').length, 1, '没有密钥时只有（隐藏的）合计行');
  } finally { env.restore(); }
});

test('幕后：卡片直接用 GET /api/owner 带来的用量（渲染时不多发请求）；「用量总览」列出全部已保存的居民并能回到某一位', async () => {
  const stored = [{ key: 'ka', agentId: 'a', name: 'Agent a' }, { key: 'kb', agentId: 'b', name: 'Agent b' }];
  const env = setup((url, key) => {
    const id = key.slice(1);
    if (url === '/api/owner') return reply(200, { agents: [{ agentId: id, name: `Agent ${id}`, status: 'awake', model: 'm', soul: 's', perception: {}, usage: fixture({ agentId: id, name: `Agent ${id}` }) }] });
    if (url === '/api/owner/usage') return reply(200, fixture({ agentId: id, name: `Agent ${id}` }));
    return reply(404, null);
  });
  try {
    env.store.set('houren.ownerKeys', JSON.stringify(stored));
    env.store.set('houren.ownerKey', 'ka');
    openBackstage({ S: { state: null } });
    await settle();
    const card = env.dom.root.querySelector('.owner-card');
    assert.ok(card.querySelector('.usage-panel'), '每位居民的卡片里有用量面板');
    assert.match(card.querySelector('.usage-panel').textContent, /61,200/);
    assert.deepEqual(env.requests.map((r) => r.url), ['/api/owner'], '渲染卡片只请求了 /api/owner');

    buttons(env.dom.root, t('usageOverview'))[0].click();
    await settle();
    assert.equal(env.dom.root.querySelector('.owner-card'), null, '总览替换了卡片');
    assert.equal(env.dom.root.querySelectorAll('.usage-overview tbody tr').length, 3);
    assert.deepEqual(env.requests.filter((r) => r.url === '/api/owner/usage').map((r) => r.key).sort(), ['ka', 'kb']);
    assert.match(env.dom.root.querySelector('.usage-overview').textContent, /Agent a · a/);
    assert.match(env.dom.root.querySelector('.usage-overview').textContent, /Agent b · b/);

    buttons(env.dom.root, t('usageOpen'))[1].click();
    await settle();
    assert.match(env.dom.root.querySelector('.owner-card').textContent, /Agent b/);
    assert.equal(env.dom.root.querySelector('.usage-overview'), null);
    assert.equal(env.store.get('houren.ownerKey'), 'kb');
  } finally { env.restore(); }
});

test('幕后：没有保存任何密钥时没有「用量总览」入口；旧服务器不带 usage 时卡片照常渲染', async () => {
  const env = setup((url, key) => reply(200, { agents: [{ agentId: 'a', name: 'Agent a', status: 'awake', model: 'm', soul: 's', perception: {} }] }));
  try {
    openBackstage({ S: { state: null } });
    assert.equal(buttons(env.dom.root, t('usageOverview')).length, 0);
    env.dom.root.querySelector('input[name="ownerKey"]').value = 'ka';
    env.dom.root.querySelector('form').fire('submit');
    await settle();
    assert.match(env.dom.root.querySelector('.owner-card').textContent, /Agent a/);
    assert.match(env.dom.root.querySelector('.usage-panel').textContent, /加载失败/);
    assert.equal(buttons(env.dom.root, t('usageOverview')).length, 1, '有了密钥之后才出现');
  } finally { env.restore(); }
});
