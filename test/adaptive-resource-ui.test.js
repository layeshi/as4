import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { serverStatusPanel } from '../public/admin-panels.js';
import { getLang, setLang } from '../public/i18n.js';

// 服务器状态页的「计算资源」卡片：新服务带 compute，旧服务没有；数字缺失显示「未知」，服务器字符串只当文字。
const MiB = 1048576, GiB = 1024 * MiB;
const base = () => ({
  cpu: { busyPercent: 12.5, cores: 4, loadavg: [0.5, 0.4, 0.3] },
  memory: { totalBytes: 8 * GiB, availableBytes: 4 * GiB, usedBytes: 4 * GiB, usedPercent: 50, rss: 300 * MiB, heapUsed: 100 * MiB },
  network: { available: true, receiveBytes: 1, transmitBytes: 1, receiveBytesPerSecond: 1024, transmitBytesPerSecond: 2048 },
  uptime: { systemSeconds: 3600, processSeconds: 60 },
  users: { total: 3, active: 3, disabled: 0, admins: 1, wechatLinked: 0, createdLast24Hours: 1, createdLast7Days: 2 },
  sampledAt: '2026-10-27T00:00:00.000Z',
});
const compute = () => ({
  mode: 'worker', cpu: 1.5, slots: 2, memory: 8 * GiB, budget: 6 * GiB, cacheBytes: 64 * MiB,
  reservedBytes: 256 * MiB, rssBytes: 1.5 * GiB, worldActive: 1, backgroundActive: 0, pressure: null,
  constraintSource: 'cgroup', worldHeapLimitBytes: 2 * GiB, mainHeapLimitBytes: 4 * GiB, backgroundHeapLimitBytes: [512 * MiB, 768 * MiB],
  queue: { world: 1, background: 4 }, cache: { bytes: MiB, entries: 3, hits: 30, misses: 10, limitBytes: 64 * MiB },
});

async function mount(t, payload) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = installFakeDom();
  const saved = { fetch: globalThis.fetch, lang: getLang() };
  const state = { payload, failed: false, requests: 0 };
  globalThis.fetch = async url => {
    assert.equal(url, '/api/admin/server-status');
    state.requests++;
    return state.failed
      ? { ok: false, status: 500, json: async () => ({ error: { message: 'refresh failed' } }) }
      : { ok: true, status: 200, json: async () => state.payload };
  };
  t.after(() => { dom.restore(); setLang(saved.lang); globalThis.fetch = saved.fetch; });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const open = async (lang = 'zh') => {
    setLang(lang);
    const panel = serverStatusPanel();
    dom.root.append(panel);
    await settle();
    return panel;
  };
  const refresh = async () => { t.mock.timers.tick(10000); await settle(); };
  return { state, open, refresh };
}
const card = (panel, title) => panel.querySelectorAll('article').find(a => a.querySelector('h3')?.textContent === title);
const rows = article => article.querySelectorAll('p').map(p => p.textContent);
const clean = text => assert.doesNotMatch(text, /NaN|undefined|null|Infinity|\[object Object\]/);

test('compute card shows every agreed field next to the existing cards and follows the refresh cycle', async (t) => {
  const { state, open, refresh } = await mount(t, { ...base(), compute: compute() });
  const panel = await open('zh');
  assert.ok(card(panel, '服务器负载'), 'existing cards stay');
  assert.ok(card(panel, '注册用户'));
  assert.deepEqual(rows(card(panel, '计算资源')), [
    '执行模式 · 独立工作线程',
    '有效 CPU / 计算槽位 · 1.5 / 2',
    '服务内存预算 / 有效上限 · 6.0 GiB / 8.0 GiB',
    '已预留 / 进程 RSS · 256.0 MiB / 1.5 GiB',
    '缓存占用 / 上限 · 1.0 MiB / 64.0 MiB · 条目 3',
    '缓存命中 / 未命中 · 30 / 10 (75.0%)',
    '世界队列 / 运行中 · 1 / 1',
    '后台队列 / 运行中 · 4 / 0',
    '实际世界堆上限 · 2.0 GiB',
    '主线程实际堆上限 · 4.0 GiB',
    '后台线程实际堆上限 · 512.0 MiB、768.0 MiB',
    '内存降载 · 正常',
    '探测来源 · cgroup 限额',
  ]);
  clean(panel.textContent);

  // 下一次刷新：进入内存降载、堆上限未知
  Object.assign(state.payload.compute, { pressure: 'memory', worldHeapLimitBytes: null, mode: 'inline', constraintSource: 'system', backgroundHeapLimitBytes: [] });
  await refresh();
  const after = rows(card(panel, '计算资源'));
  assert.ok(after.includes('内存降载 · 内存降载中：已清空缓存，新计算暂缓'));
  assert.ok(after.includes('实际世界堆上限 · 未知'));
  assert.ok(after.includes('后台线程实际堆上限 · 尚未启动'), 'empty array means no background thread started');
  assert.ok(after.includes('主线程实际堆上限 · 4.0 GiB'));
  assert.ok(after.includes('执行模式 · 主线程内联'));
  assert.ok(after.includes('探测来源 · 系统总量（未检测到 cgroup）'));

  // 刷新失败时保留上一次的数值，只显示错误
  state.failed = true;
  await refresh();
  assert.match(panel.textContent, /refresh failed/);
  assert.ok(rows(card(panel, '计算资源')).includes('实际世界堆上限 · 未知'));

  // 离开这一块后不再请求
  panel.remove();
  const before = state.requests;
  await refresh(); await refresh();
  assert.equal(state.requests, before);
});

test('compute card is English when the interface is English', async (t) => {
  const payload = { ...base(), compute: { ...compute(), pressure: 'memory', worldHeapLimitBytes: null, constraintSource: 'system; job limits unknown' } };
  payload.compute.backgroundHeapLimitBytes = [512 * MiB, null];
  const { open } = await mount(t, payload);
  const panel = await open('en');
  assert.deepEqual(rows(card(panel, 'Compute resources')), [
    'Execution mode · Worker thread',
    'Effective CPU / compute slots · 1.5 / 2',
    'Service memory budget / effective limit · 6.0 GiB / 8.0 GiB',
    'Reserved / process RSS · 256.0 MiB / 1.5 GiB',
    'Cache used / limit · 1.0 MiB / 64.0 MiB · entries 3',
    'Cache hits / misses · 30 / 10 (75.0%)',
    'World queue / running · 1 / 1',
    'Background queue / running · 4 / 0',
    'Actual world heap limit · Unknown',
    'Actual main thread heap limit · 4.0 GiB',
    'Actual background thread heap limits · 512.0 MiB, Unknown',
    'Memory load shedding · Shedding load (memory): cache cleared, new work deferred',
    'Detection source · System totals (job limits unknown)',
  ]);
  assert.doesNotMatch(panel.textContent, /[一-鿿]/, 'no Chinese text left in the English view');
});

test('older servers without compute (missing, null or malformed) keep the original page and show no compute card', async (t) => {
  const { state, open, refresh } = await mount(t, base());
  const panel = await open('zh');
  const titles = () => panel.querySelectorAll('h3').map(h => h.textContent);
  assert.deepEqual(titles(), ['服务器负载', '注册用户']);
  assert.match(panel.textContent, /12.5% · 4 核/);
  clean(panel.textContent);
  for (const value of [null, 'unavailable', 0, [], false]) {
    state.payload = { ...base(), compute: value };
    await refresh();
    assert.deepEqual(titles(), ['服务器负载', '注册用户'], `compute = ${JSON.stringify(value)}`);
    assert.match(panel.textContent, /采样时间/);
    clean(panel.textContent);
  }
});

test('missing, invalid and unexpected compute fields render as Unknown or plain text, never as markup or secrets', async (t) => {
  const { state, open, refresh } = await mount(t, { ...base(), compute: {} });
  const panel = await open('zh');
  const empty = rows(card(panel, '计算资源'));
  assert.equal(empty.length, 13);
  assert.deepEqual(empty, [
    '执行模式 · 未知',
    '有效 CPU / 计算槽位 · 未知 / 未知',
    '服务内存预算 / 有效上限 · 未知 / 未知',
    '已预留 / 进程 RSS · 未知 / 未知',
    '缓存占用 / 上限 · 未知 / 未知 · 条目 未知',
    '缓存命中 / 未命中 · 未知 / 未知',
    '世界队列 / 运行中 · 未知 / 未知',
    '后台队列 / 运行中 · 未知 / 未知',
    '实际世界堆上限 · 未知',
    '主线程实际堆上限 · 未知',
    '后台线程实际堆上限 · 未知',
    '内存降载 · 未知',
    '探测来源 · 未知',
  ]);
  clean(panel.textContent);

  const markup = '<img src=x onerror=alert(1)>';
  state.payload = { ...base(), compute: {
    mode: 'constructor', cpu: NaN, slots: Infinity, memory: -1, budget: '6 GiB', cacheBytes: 32 * MiB,
    reservedBytes: null, rssBytes: { value: 1 }, worldActive: 2, backgroundActive: undefined, pressure: 'disk',
    constraintSource: markup, worldHeapLimitBytes: 0, mainHeapLimitBytes: -5,
    backgroundHeapLimitBytes: [256 * MiB, null, NaN, Infinity, -1, '1 GiB', { bytes: 1 }],
    queue: 'busy', cache: { bytes: 2 * MiB, entries: null, hits: 0, misses: 0, limitBytes: null },
    adminKey: 'sk-live-secret', token: 'owner-token-secret', platform: 'linux', high: 123456789, available: 987654321,
  } };
  await refresh();
  const odd = rows(card(panel, '计算资源'));
  assert.deepEqual(odd, [
    '执行模式 · constructor',
    '有效 CPU / 计算槽位 · 未知 / 未知',
    '服务内存预算 / 有效上限 · 未知 / 未知',
    '已预留 / 进程 RSS · 未知 / 未知',
    '缓存占用 / 上限 · 2.0 MiB / 32.0 MiB · 条目 未知',
    '缓存命中 / 未命中 · 0 / 0',
    '世界队列 / 运行中 · 未知 / 2',
    '后台队列 / 运行中 · 未知 / 未知',
    '实际世界堆上限 · 0 B',
    '主线程实际堆上限 · 未知',
    '后台线程实际堆上限 · 256.0 MiB、未知、未知、未知、未知、未知、未知',
    '内存降载 · disk',
    `探测来源 · ${markup}`,
  ]);
  assert.equal(panel.querySelectorAll('img').length, 0, 'server strings stay text');
  for (const value of ['none', { 0: MiB, length: 1 }, null, 0]) {
    state.payload.compute.backgroundHeapLimitBytes = value;
    await refresh();
    assert.ok(rows(card(panel, '计算资源')).includes('后台线程实际堆上限 · 未知'), `backgroundHeapLimitBytes = ${JSON.stringify(value)}`);
  }
  assert.doesNotMatch(panel.textContent, /sk-live-secret|owner-token-secret|linux|123456789|987654321/);
  clean(panel.textContent);
});
