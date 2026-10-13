import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { boot } from './http-helpers.js';
import { installFakeDom } from './fake-dom.js';
import { openAccount } from '../public/accounts.js';
import { serverStatusPanel } from '../public/admin-panels.js';
import { closeAllModals } from '../public/modals.js';
import { getLang, setLang } from '../public/i18n.js';

const cpu = (user, nice, sys, irq, idle) => ({ times: { user, nice, sys, irq, idle } });
const net = (rx, tx, lo = 900000) => `Inter-| Receive | Transmit
 face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed
 lo: ${lo} 0 0 0 0 0 0 0 ${lo} 0 0 0 0 0 0 0
 eth-secret: ${rx} 0 0 0 0 0 0 0 ${tx} 0 0 0 0 0 0 0
 veth-secret: 300 0 0 0 0 0 0 0 600 0 0 0 0 0 0 0`;
async function fixture() {
  const { ServerStatusSampler } = await import('../src/server-status.js');
  const state = { cpus: [cpu(10, 10, 10, 10, 60), cpu(10, 10, 10, 10, 60)], time: 0,
    mem: 'MemTotal: 8192 kB\nMemFree: 1024 kB\nMemAvailable: 3072 kB\n', net: net(100, 200), paths: [] };
  const sampler = new ServerStatusSampler({
    cpus: () => state.cpus, totalmem: () => 8192 * 1024, freemem: () => 1024 * 1024,
    loadavg: () => [0.1, 0.2, 0.3], uptime: () => 1234, processUptime: () => 42,
    memoryUsage: () => ({ rss: 1000, heapUsed: 500, secret: 'must not escape' }),
    now: () => Date.UTC(2026, 9, 13) + state.time, monotonic: () => state.time,
    readFile: async (path) => {
      state.paths.push(path);
      const value = path === '/proc/meminfo' ? state.mem : state.net;
      if (value instanceof Error) throw value;
      return value;
    },
  });
  return { sampler, state };
}

test('server sampler computes aggregate CPU deltas, available memory and non-loopback network rates', async () => {
  const { sampler, state } = await fixture();
  const first = await sampler.sample();
  assert.equal(first.cpu.busyPercent, null);
  assert.deepEqual(first.network, { available: true, receiveBytes: 400, transmitBytes: 800, receiveBytesPerSecond: null, transmitBytesPerSecond: null });
  state.cpus = [cpu(30, 20, 20, 20, 110), cpu(10, 10, 20, 10, 150)];
  state.net = net(1100, 2200, 9999999);
  state.time = 5000;
  const s = await sampler.sample();
  assert.deepEqual(s.cpu, { busyPercent: 30, cores: 2, loadavg: [0.1, 0.2, 0.3] });
  assert.deepEqual(s.memory, { totalBytes: 8388608, availableBytes: 3145728, usedBytes: 5242880, usedPercent: 62.5, rss: 1000, heapUsed: 500 });
  assert.deepEqual(s.network, { available: true, receiveBytes: 1400, transmitBytes: 2800, receiveBytesPerSecond: 200, transmitBytesPerSecond: 400 });
  assert.deepEqual(s.uptime, { systemSeconds: 1234, processSeconds: 42 });
  assert.equal(s.sampledAt, '2026-10-13T00:00:05.000Z');
  assert.deepEqual([...new Set(state.paths)].sort(), ['/proc/meminfo', '/proc/net/dev']);
  assert.strictEqual(sampler.view(), s, 'view reuses the sample without I/O');
});

test('server sampler falls back without proc files and recovers without a spurious traffic spike', async () => {
  const { sampler, state } = await fixture();
  await sampler.sample();
  state.mem = state.net = new Error('unavailable /private/path');
  state.time = 5000;
  const s = await sampler.sample();
  assert.deepEqual(s.network, { available: false, receiveBytes: null, transmitBytes: null, receiveBytesPerSecond: null, transmitBytesPerSecond: null });
  assert.equal(s.memory.availableBytes, 1048576);
  assert.equal(s.memory.usedPercent, 87.5);
  state.mem = 'MemFree: 12 kB\n';
  state.net = net(2000, 3000);
  state.time = 10000;
  assert.equal((await sampler.sample()).network.receiveBytesPerSecond, null);
  state.net = net(1, 2);
  state.time = 15000;
  const reset = await sampler.sample();
  assert.equal(reset.network.receiveBytesPerSecond, null, 'counter resets are not negative traffic');
  assert.equal(reset.memory.availableBytes, 1048576);
});

test('server sampler bounds concurrent reads and clears its unrefed timer on close', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { sampler, state } = await fixture();
  sampler.start();
  await sampler.sample();
  const initial = state.paths.length;
  t.mock.timers.tick(5000);
  await sampler.sample();
  assert.equal(state.paths.length, initial + 2);
  sampler.close();
  t.mock.timers.tick(10000);
  assert.equal(state.paths.length, initial + 2);
});

test('restricted system uptime cannot prevent app startup or other metrics', async () => {
  const { sampler } = await fixture();
  sampler.readers.uptime = () => { throw new Error('EPERM'); };
  const sample = await sampler.sample();
  assert.equal(sample.uptime.systemSeconds, null);
  assert.equal(sample.uptime.processSeconds, 42);
  assert.equal(sample.memory.rss, 1000);
});

test('user count windows include boundaries and exclude future or invalid dates', async () => {
  const { registeredUserCounts } = await import('../src/server-status.js');
  const now = Date.UTC(2026, 9, 13), day = 86400000;
  const users = [0, day, 7 * day, 7 * day + 1, -1].map(age => ({ role: 'user', status: 'active', createdAt: new Date(now - age).toISOString() }));
  users.push({ role: 'admin', status: 'disabled', wechatIdentity: 'secret', createdAt: 'invalid' });
  assert.deepEqual(registeredUserCounts(users, now), { total: 6, active: 5, disabled: 1, admins: 1, wechatLinked: 1, createdLast24Hours: 2, createdLast7Days: 3 });
});

test('server status UI: refresh, retained values after failure, stop after leaving, admin-only entry and English fallback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = installFakeDom();
  const saved = { fetch: globalThis.fetch, lang: getLang() };
  const { sampler } = await fixture();
  const status = await sampler.sample();
  status.users = { total: 12, active: 10, disabled: 2, admins: 1, wechatLinked: 5, createdLast24Hours: 3, createdLast7Days: 7 };
  status.cpu.busyPercent = 30;
  status.network.receiveBytesPerSecond = 1024;
  status.network.transmitBytesPerSecond = 2 * 1024 * 1024;
  let role = 'admin', failed = false, requests = 0;
  const reply = (code, json) => ({ ok: code === 200, status: code, json: async () => json });
  globalThis.fetch = async url => {
    if (url === '/api/account') return reply(200, { user: { role, username: 'chief', displayName: 'Chief' } });
    if (url !== '/api/admin/server-status') return reply(200, { agents: [] });
    requests++;
    return failed ? reply(500, { error: { message: 'refresh failed' } }) : reply(200, status);
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const button = label => dom.root.querySelectorAll('button').find(b => b.textContent === label);
  try {
    setLang('zh');
    const modal = serverStatusPanel(); dom.root.append(modal); await settle();
    assert.match(modal.textContent, /30.0% · 2 核/);
    assert.match(modal.textContent, /5.0 MiB \/ 8.0 MiB \(62.5%\)/);
    assert.match(modal.textContent, /↓ 接收 1.0 KiB\/s · ↑ 发送 2.0 MiB\/s/);
    assert.match(modal.textContent, /最近 24 小时 \/ 7 天注册 · 3 \/ 7/);
    assert.match(modal.textContent, /采样时间/);
    failed = true;
    t.mock.timers.tick(10000); await settle();
    assert.match(modal.textContent, /refresh failed/);
    assert.match(modal.textContent, /30.0%/);
    failed = false; status.cpu.busyPercent = 70;
    t.mock.timers.tick(10000); await settle();
    assert.match(modal.textContent, /70.0%/);
    assert.doesNotMatch(modal.textContent, /refresh failed/);
    modal.remove(); // 离开这一块（管理后台切到别的功能）
    const beforeClose = requests;
    t.mock.timers.tick(30000); await settle();
    assert.equal(requests, beforeClose);
    const consoleLink = () => dom.root.querySelectorAll('a').find(a => a.getAttribute('href') === '/admin.html');
    role = 'user'; await openAccount();
    assert.equal(consoleLink(), undefined); assert.equal(button('服务器状态'), undefined);
    closeAllModals();
    role = 'admin'; setLang('en');
    status.network.available = false; status.uptime.systemSeconds = null;
    await openAccount(); assert.ok(consoleLink()); closeAllModals();
    dom.root.append(serverStatusPanel()); await settle();
    assert.match(dom.root.textContent, /Network · Unavailable/);
    assert.match(dom.root.textContent, /System uptime · Unavailable/);
    assert.doesNotMatch(dom.root.textContent, /NaN|undefined/);
  } finally {
    closeAllModals(); dom.restore(); setLang(saved.lang); globalThis.fetch = saved.fetch;
  }
});

test('admin server status requires a signed-in administrator and returns only aggregate numbers', async () => {
  const e = await boot();
  try {
    const path = '/api/admin/server-status';
    assert.equal((await e.call(path)).status, 401);
    assert.equal((await e.call(path, { admin: true })).status, 401, 'ADMIN_KEY alone is not a session');
    const create = async (route, username, extra = {}) => {
      const r = await e.call(route, { method: 'POST', headers: { 'X-Houren-Request': '1' }, body: { username, displayName: username, password: 'long-test-password', ...extra } });
      assert.equal(r.status, 201);
      return r.headers.get('set-cookie').split(';')[0];
    };
    const admin = await create('/api/account/setup', 'chief', { adminKey: e.cfg.adminKey });
    const user = await create('/api/account/register', 'member');
    assert.equal((await e.call(path, { headers: { Cookie: user } })).status, 403);
    const now = Date.now(), day = 86400000;
    const users = e.app.ctx.accounts.data.users;
    users[0].createdAt = new Date(now - 8 * day).toISOString();
    users[1].createdAt = new Date(now - 2 * day).toISOString();
    users.push({ role: 'user', status: 'disabled', wechatIdentity: 'secret-wechat', createdAt: new Date(now - 3600000).toISOString() });
    users.push({ role: 'admin', status: 'disabled', createdAt: new Date(now - 10 * day).toISOString() });
    const r = await e.call(path, { headers: { Cookie: admin } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(r.json.users, { total: 4, active: 2, disabled: 2, admins: 2, wechatLinked: 1, createdLast24Hours: 1, createdLast7Days: 2 });
    assert.deepEqual(Object.keys(r.json).sort(), ['cpu', 'memory', 'network', 'sampledAt', 'uptime', 'users']);
    assert.ok(Number.isFinite(Date.parse(r.json.sampledAt)));
    assert.deepEqual(Object.keys(r.json.cpu).sort(), ['busyPercent', 'cores', 'loadavg']);
    assert.equal(r.json.cpu.loadavg.length, 3);
    assert.deepEqual(Object.keys(r.json.memory).sort(), ['availableBytes', 'heapUsed', 'rss', 'totalBytes', 'usedBytes', 'usedPercent']);
    assert.deepEqual(Object.keys(r.json.network).sort(), ['available', 'receiveBytes', 'receiveBytesPerSecond', 'transmitBytes', 'transmitBytesPerSecond']);
    assert.deepEqual(Object.keys(r.json.uptime).sort(), ['processSeconds', 'systemSeconds']);
    const check = (value) => {
      if (value === null || typeof value === 'boolean') return;
      if (typeof value === 'object') return Object.values(value).forEach(check);
      assert.equal(typeof value, 'number');
      assert.ok(Number.isFinite(value) && value >= 0);
    };
    const { sampledAt, ...numbers } = r.json;
    check(numbers);
    assert.ok(!r.text.includes(os.hostname()));
    assert.doesNotMatch(r.text, /127\.0\.0\.1|eth-secret|veth-secret|secret-wechat|hostname|interfaces|\/proc\//);
    assert.equal((await e.call('/api/public/server-status')).status, 404);
  } finally { await e.close(); }
});
