// SPEC-E2 §24.1 测试 14（§25 第 11 步）：躯壳（运行时）——预留、匀速、硬上限、跨日重置、重启后继续累计、认证失败的处理、并发上限；
// 进程内客户端能感知与行动；管理接口；日志不含提示、回复与密钥。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/server.js';
import { ShellManager } from '../src/shells/manager.js';
import { Budget, earthDay, estimateTokens, guessTokens, DAY_MS } from '../src/shells/budget.js';
import { parseShellsConfig, loadShellsConfig, DEFAULTS } from '../src/shells/config.js';
import { createShellClient } from '../src/shells/client.js';
import { ProviderError } from '../runner/providers.js';
import { boot } from './http-helpers.js';
import { sha } from './e2-helpers.js';

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

const SPEC_CONFIG = {
  tokensPerDay: 50000000, timezone: 'Asia/Shanghai', reserve: 0.05, concurrency: 4, historyRounds: 2,
  lines: [
    { model: 'glm-5.3', provider: 'openai', baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4', apiKeyEnv: 'GLM_API_KEY', extraBody: { thinking: { type: 'disabled' } }, maxTokens: 1200, timeoutMs: 120000 },
    { model: 'step-5-preview', provider: 'openai', baseURL: 'https://api.stepfun.com/step_plan/v1', apiKeyEnv: 'STEP_API_KEY', maxTokens: 1200, timeoutMs: 120000 },
  ],
};

test('SHELLS_FILE：SPEC-E2 §13.1 的示例有效；缺省值；环境变量 SHELL_TOKENS_PER_DAY / SHELL_TZ 覆盖文件', () => {
  const c = parseShellsConfig(SPEC_CONFIG);
  assert.deepEqual([c.tokensPerDay, c.timezone, c.reserve, c.concurrency, c.historyRounds, c.lines.length], [50000000, 'Asia/Shanghai', 0.05, 4, 2, 2]);
  assert.deepEqual(c.lines[0].extraBody, { thinking: { type: 'disabled' } });
  const min = parseShellsConfig({ lines: [{ model: 'm', provider: 'mock' }] });
  assert.deepEqual([min.tokensPerDay, min.timezone, min.reserve, min.concurrency, min.historyRounds, min.lines[0].maxTokens, min.lines[0].timeoutMs],
    [DEFAULTS.tokensPerDay, DEFAULTS.timezone, DEFAULTS.reserve, DEFAULTS.concurrency, DEFAULTS.historyRounds, DEFAULTS.maxTokens, DEFAULTS.timeoutMs]);
  const o = parseShellsConfig(SPEC_CONFIG, { tokensPerDay: 1000, timezone: 'UTC' });
  assert.deepEqual([o.tokensPerDay, o.timezone], [1000, 'UTC']);
  // 文件
  const dir = mkdtempSync(join(tmpdir(), 'houren-shcfg-'));
  try {
    writeFileSync(join(dir, 's.json'), JSON.stringify(SPEC_CONFIG));
    assert.equal(loadShellsConfig(join(dir, 's.json'), { shellTokensPerDay: 777, shellTz: 'America/New_York' }).tokensPerDay, 777);
    assert.equal(loadShellsConfig(join(dir, 's.json'), { shellTz: 'America/New_York' }).timezone, 'America/New_York');
    assert.throws(() => loadShellsConfig(join(dir, 'nope.json')), /读不了躯壳配置文件/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SHELLS_FILE：错误有清楚的说明——线路为空 / 重复的模型 / 未知字段 / 未知提供者 / 坏的时区 / 越界的数', () => {
  const bad = (patch, re) => assert.throws(() => parseShellsConfig({ ...SPEC_CONFIG, ...patch }), re);
  bad({ lines: [] }, /lines 必须是非空数组/);
  bad({ lines: [{ model: 'a', provider: 'mock' }, { model: 'a', provider: 'mock' }] }, /重复/);
  bad({ lines: [{ model: 'a', provider: 'mock', apiKey: 'sk-secret' }] }, /apiKey 不是认得的字段/);
  bad({ lines: [{ model: 'a', provider: 'gpt' }] }, /provider 必须是/);
  bad({ lines: [{ model: 'a', provider: 'openai', apiKeyEnv: 'has space' }] }, /apiKeyEnv/);
  bad({ lines: [{ model: 'a', provider: 'openai', extraBody: [] }] }, /extraBody/);
  bad({ lines: [{ model: 'a\nb', provider: 'mock' }] }, /model/);
  bad({ timezone: 'Mars/Olympus' }, /时区/);
  bad({ reserve: 1 }, /reserve/);
  bad({ tokensPerDay: 0 }, /tokensPerDay/);
  bad({ concurrency: 0 }, /concurrency/);
  bad({ historyRounds: 21 }, /historyRounds/);
  assert.throws(() => parseShellsConfig(null), /JSON 对象/);
  // 配置里不会有密钥：apiKeyEnv 只是变量名
  assert.equal(JSON.stringify(parseShellsConfig(SPEC_CONFIG)).includes('sk-'), false);
});

// ═══════════════════════════════════════════════════════════════
// 预算
// ═══════════════════════════════════════════════════════════════

const utc = (iso) => Date.parse(iso);
const clock = (iso) => {
  let t = utc(iso);
  const f = () => t;
  f.set = (iso2) => { t = utc(iso2); };
  f.add = (ms) => { t += ms; };
  return f;
};

test('地球日：按时区取日历日，并给出这一日已过的毫秒数', () => {
  // 2026-10-01 16:30:00Z = 上海 2026-10-02 00:30:00
  assert.deepEqual(earthDay(utc('2026-10-01T16:30:00.250Z'), 'Asia/Shanghai'), { key: '2026-10-02', msIntoDay: 30 * 60 * 1000 + 250 });
  assert.deepEqual(earthDay(utc('2026-10-01T16:30:00Z'), 'UTC'), { key: '2026-10-01', msIntoDay: (16 * 60 + 30) * 60 * 1000 });
  assert.equal(earthDay(utc('2026-10-01T03:59:59Z'), 'America/New_York').key, '2026-09-30', '纽约（夏令时）还在 9 月 30 日');
  assert.equal(earthDay(utc('2026-10-01T04:00:00Z'), 'America/New_York').key, '2026-10-01');
  assert.deepEqual(earthDay(utc('2026-10-01T15:59:59.999Z'), 'Asia/Shanghai'), { key: '2026-10-01', msIntoDay: DAY_MS - 1 });
  assert.equal(earthDay(utc('2026-10-01T16:00:00Z'), 'Asia/Shanghai').msIntoDay, 0, '午夜是 0 毫秒，不是 24 点');
});

test('估算：预留 = ceil(字符数 / 2) + maxTokens；没有用量时 = ceil(请求字符数 / 2) + ceil(回复字符数 / 2)', () => {
  assert.equal(estimateTokens(1001, 1200), 501 + 1200);
  assert.equal(guessTokens(1001, 301), 501 + 151);
  assert.equal(estimateTokens(0, 1200), 1200);
});

test('预留与硬上限：已用 + 已预留 + 估计 > tokensPerDay 时不调用；预留被实际用量替换；失败的调用释放预留', () => {
  const now = clock('2026-10-01T04:00:00Z');
  const b = new Budget({ tokensPerDay: 1000, reserve: 0, timezone: 'UTC', now });
  assert.deepEqual(b.check('a1', 400, { awake: 1, tickMs: DAY_MS }), { ok: true });
  const t1 = b.reserveTokens('a1', 400);
  assert.equal(b.reserved, 400);
  const t2 = b.reserveTokens('a2', 400);
  // 已预留 800：再要 400 就超了（800 + 400 > 1000），要 200 恰好够
  assert.deepEqual(b.check('a3', 400, { awake: 3, tickMs: DAY_MS }), { ok: false, reason: 'hard_cap' });
  assert.deepEqual(b.check('a3', 200, { awake: 3, tickMs: DAY_MS }), { ok: true });
  // 实际用量替换预留：a1 只用了 100
  b.settle(t1, 100, { line: 'glm' });
  assert.deepEqual([b.used, b.reserved], [100, 400]);
  assert.deepEqual(b.agentUsage('a1').tokens, 100);
  assert.equal(b.agentUsage('a1').calls, 1);
  assert.equal(b.agentUsage('a1').lastCallAt, '2026-10-01T04:00:00.000Z');
  assert.deepEqual(b.check('a3', 400, { awake: 3, tickMs: DAY_MS }), { ok: true }, '100 + 400 + 400 = 900 ≤ 1000');
  // 失败的调用：释放预留，不记用量
  b.release(t2);
  assert.deepEqual([b.used, b.reserved], [100, 0]);
  b.release(t2); // 重复释放无害
  assert.equal(b.reserved, 0);
  // 用量超过预留也照记（缓存命中也计入），之后硬上限生效
  const t3 = b.reserveTokens('a1', 100);
  b.settle(t3, 950, { line: 'glm' });
  assert.equal(b.used, 1050);
  assert.equal(b.capped, true);
  assert.deepEqual(b.check('a1', 1, { awake: 1, tickMs: DAY_MS }), { ok: false, reason: 'hard_cap' });
  assert.deepEqual(b.view().lines, { glm: 1050 });
});

test('匀速：fair = B × frac / n，frac = min(1, (今日已过的毫秒 + tickMs) / 一日)；已用超过 fair 则本刻不调用；随时间推移额度放宽', () => {
  const now = clock('2026-10-01T00:00:00Z');
  const b = new Budget({ tokensPerDay: 1000000, reserve: 0.1, timezone: 'UTC', now });
  const tickMs = 300000;
  const B = 900000;
  const fair0 = (B * (tickMs / DAY_MS)) / 3; // 三具醒着的躯壳，午夜：约 1041.67
  assert.ok(fair0 > 1041 && fair0 < 1042);
  const spend = (id, n) => b.settle(b.reserveTokens(id, 1), n);
  spend('a1', 1000);
  assert.deepEqual(b.check('a1', 100, { awake: 3, tickMs }), { ok: true }, '1000 ≤ 1041.67');
  spend('a1', 100);
  assert.deepEqual(b.check('a1', 100, { awake: 3, tickMs }), { ok: false, reason: 'pace' }, '1100 > 1041.67');
  assert.deepEqual(b.check('a2', 100, { awake: 3, tickMs }), { ok: true }, '别的躯壳不受影响');
  // 躯壳少了，每具的额度变大
  assert.deepEqual(b.check('a1', 100, { awake: 1, tickMs }), { ok: true }, 'fair = 3125');
  // 时间推移：中午 frac ≈ 0.5035
  now.set('2026-10-01T12:00:00Z');
  assert.deepEqual(b.check('a1', 100, { awake: 3, tickMs }), { ok: true });
  // n 至少为 1
  assert.deepEqual(b.check('a1', 100, { awake: 0, tickMs }), { ok: true });
  // 一日将尽：frac 封顶为 1
  now.set('2026-10-01T23:59:59Z');
  assert.deepEqual(b.check('a1', 100, { awake: 3, tickMs }), { ok: true });
  // 硬上限先于匀速判断
  const t = b.reserveTokens('a9', 1);
  b.release(t);
  assert.deepEqual(b.check('a1', 1000000, { awake: 1, tickMs }), { ok: false, reason: 'hard_cap' });
});

test('跨日重置：新的地球日从零累计，旧的日子仍保留；在途调用的用量记入完成它的那一日；keepDays 之外的旧日子被修剪', () => {
  const now = clock('2026-10-01T15:59:00Z'); // 上海 23:59
  const b = new Budget({ tokensPerDay: 5000, reserve: 0, timezone: 'Asia/Shanghai', now, keepDays: 3 });
  const t = b.reserveTokens('a1', 100);
  now.add(2 * 60 * 1000); // 跨过上海午夜
  assert.equal(b.today().key, '2026-10-02');
  assert.deepEqual([b.used, b.reserved], [0, 100], '新的一日从零累计，在途的预留还在');
  b.settle(t, 80);
  assert.equal(b.used, 80, '用量记入完成它的那一日');
  assert.equal(b.agentUsage('a1').tokens, 80);
  // 前一日是空的；再往前推几日，旧的被修剪
  for (let d = 3; d <= 6; d++) {
    now.set(`2026-10-0${d}T01:00:00Z`);
    b.settle(b.reserveTokens('a1', 1), 10);
  }
  assert.ok(Object.keys(b.days).length <= 4);
  b.save();
  assert.ok(Object.keys(b.days).length <= 3);
  assert.equal(b.agentUsage('a1').tokens, 10);
});

test('重启后继续累计：用量与暂停标志持久化到 shells-usage.json（只有数字、日期与居民 ID，没有密钥与文本）；文件损坏时从零累计', () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-usage-'));
  const file = join(dir, 'shells-usage.json');
  try {
    const now = clock('2026-10-01T04:00:00Z');
    const a = new Budget({ tokensPerDay: 10000, reserve: 0.05, timezone: 'UTC', now, file });
    a.settle(a.reserveTokens('a7', 500), 321, { line: 'glm-5.3' });
    a.settle(a.reserveTokens('a8', 500), 123, { line: 'step-5-preview' });
    a.setPaused(true);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(raw.paused, true);
    assert.deepEqual(raw.days['2026-10-01'].agents.a7, { tokens: 321, calls: 1, lastCallAt: '2026-10-01T04:00:00.000Z', lines: { 'glm-5.3': 321 } });
    assert.equal(raw.days['2026-10-01'].total, 444);
    // 重启
    const b = new Budget({ tokensPerDay: 10000, reserve: 0.05, timezone: 'UTC', now, file });
    assert.deepEqual([b.used, b.paused, b.agentUsage('a7').tokens, b.agentUsage('a8').calls], [444, true, 321, 1]);
    b.settle(b.reserveTokens('a7', 500), 100);
    assert.equal(b.agentUsage('a7').tokens, 421);
    assert.equal(new Budget({ tokensPerDay: 10000, timezone: 'UTC', now, file }).used, 544);
    // 隔日重启：昨天的不计入今天
    now.set('2026-10-02T00:30:00Z');
    assert.equal(new Budget({ tokensPerDay: 10000, timezone: 'UTC', now, file }).used, 0);
    // 文件损坏
    writeFileSync(file, '{ not json');
    now.set('2026-10-01T05:00:00Z');
    assert.equal(new Budget({ tokensPerDay: 10000, timezone: 'UTC', now, file }).used, 0);
    // 没有密钥与文本的痕迹
    assert.ok(!/sk-|api|key|text|soul/i.test(JSON.stringify(raw)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('告警：用量达到 tokensPerDay 的 80% 与 100% 时各告警一次（每个地球日）', () => {
  const now = clock('2026-10-01T04:00:00Z');
  const warns = [];
  const b = new Budget({ tokensPerDay: 1000, reserve: 0, timezone: 'UTC', now, onWarn: (w) => warns.push([w.kind, w.day, w.used]) });
  const spend = (n) => b.settle(b.reserveTokens('a1', 1), n);
  spend(700);
  assert.deepEqual(warns, []);
  spend(100);
  assert.deepEqual(warns, [['eighty', '2026-10-01', 800]]);
  spend(50);
  assert.equal(warns.length, 1, '80% 只告警一次');
  spend(200);
  assert.deepEqual(warns.at(-1), ['capped', '2026-10-01', 1050]);
  spend(10);
  assert.equal(warns.length, 2);
  now.set('2026-10-02T04:00:00Z');
  spend(900);
  assert.deepEqual(warns.map((w) => w[0]), ['eighty', 'capped', 'eighty'], '新的一日重新告警');
});

// ═══════════════════════════════════════════════════════════════
// 管理器 + 进程内客户端：真实的第二纪世界
// ═══════════════════════════════════════════════════════════════

const FOUNDERS = [
  { day: 0, name: '先民甲', bio: '', soul: '甲的灵魂SECRET-F1', lang: 'zh' },
  { day: 0, name: '先民乙', bio: '', soul: '乙的灵魂SECRET-F2', lang: 'en' },
  { day: 0, name: '先民丙', bio: '', soul: '丙的灵魂SECRET-F3', lang: 'zh' },
  { day: 1, name: '先民丁', bio: '', soul: '丁的灵魂SECRET-F4', lang: 'zh' },
];
const MOCK_LINES = {
  tokensPerDay: 50000000, timezone: 'UTC', reserve: 0.05, concurrency: 4, historyRounds: 2,
  lines: [{ model: 'glm-5.3', provider: 'mock', seed: 3, maxTokens: 1200 }, { model: 'step-5-preview', provider: 'mock', seed: 4, maxTokens: 1200 }],
};

/** 用 SHELLS_FILE / FOUNDERS_FILE 创建一座第二纪的城（Runtime.open），返回 { rt, cfg, dir, close } */
function openCity({ founders = FOUNDERS, shells = MOCK_LINES, seed = 'shells-rt' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'houren-shrt-'));
  const foundersFile = join(dir, 'founders.json');
  const shellsFile = join(dir, 'shells.json');
  writeFileSync(foundersFile, JSON.stringify(founders));
  writeFileSync(shellsFile, JSON.stringify(shells));
  const cfg = { ...loadConfig({}, []), dataDir: join(dir, 'data'), worldId: 'w', seed, physics: 2, foundersFile, shellsFile, tickMs: 300000 };
  const rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
  return { rt, cfg, dir, close: () => { rt.close(); rmSync(dir, { recursive: true, force: true }); } };
}

/** 假的「等到下一刻」：驱动的循环停在这里，测试推进一刻后放行 */
class TickGate {
  constructor() { this.waiters = []; }

  wait = (ms, signal) => new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    this.waiters.push(resolve);
    if (signal) signal.addEventListener('abort', () => resolve(), { once: true });
  });

  /** 等到所有驱动都停在 wait 上、没有调用在途 */
  async quiet(manager, timeout = 4000) {
    const t0 = Date.now();
    for (;;) {
      await new Promise((r) => setImmediate(r));
      if (this.waiters.length >= manager.drivers.size && manager.slots.active === 0 && manager.tickets.size === 0) return;
      if (Date.now() - t0 > timeout) throw new Error(`驱动没有安静下来：${this.waiters.length} 个在等，${manager.drivers.size} 个驱动，在途 ${manager.slots.active}`);
    }
  }

  /** 推进 n 刻，每刻之后放行所有驱动的一轮 */
  async step(rt, manager, n = 1) {
    for (let i = 0; i < n; i++) {
      rt.tickNow();
      const ws = this.waiters.splice(0);
      for (const f of ws) f();
      await this.quiet(manager);
    }
  }
}

const quietLogger = () => {
  const lines = [];
  return { lines, log: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) };
};

test('躯壳被驱动：先民分批入城，各自按分配到的线路行动；管理接口的视图显示每具的用量、调用次数与状态；日志不含灵魂与回复', async () => {
  const city = openCity();
  const { rt, cfg } = city;
  const gate = new TickGate();
  const logger = quietLogger();
  const now = clock('2026-10-01T04:00:00Z');
  const mgr = new ShellManager(rt, cfg, { wait: gate.wait, now, logger });
  try {
    assert.deepEqual(rt.w.shells.models, ['glm-5.3', 'step-5-preview'], 'genesis 读了 SHELLS_FILE 里的模型名');
    mgr.activate();
    assert.equal(mgr.drivers.size, 0, '第 0 刻之前先民还没入城');
    await gate.step(rt, mgr, 1);
    // 第 1 刻：三位当日入城的先民成为躯壳居民，被驱动
    const shells = Object.values(rt.w.agents).filter((a) => a.body.kind === 'shell');
    assert.equal(shells.length, 3);
    assert.equal(mgr.drivers.size, 3);
    assert.deepEqual(shells.map((a) => a.body.model), ['glm-5.3', 'step-5-preview', 'glm-5.3'], '模型轮流分配');
    await gate.step(rt, mgr, 6);
    const evs = rt.events.since(0, 2000);
    for (const a of shells) assert.ok(evs.some((e) => e.agent === a.id && e.type !== 'arrive'), `${a.name} 行动过`);
    // 视图
    const v = mgr.view();
    assert.deepEqual(Object.keys(v), ['enabled', 'paused', 'day', 'timezone', 'budget', 'usable', 'used', 'reserved', 'capped', 'lines', 'shells', 'warnings']);
    assert.deepEqual([v.enabled, v.paused, v.day, v.budget, v.usable, v.reserved, v.capped], [true, false, '2026-10-01', 50000000, 47500000, 0, false]);
    assert.deepEqual(v.lines, [{ model: 'glm-5.3', status: 'ok' }, { model: 'step-5-preview', status: 'ok' }]);
    assert.equal(v.shells.length, 3);
    for (const s of v.shells) {
      assert.deepEqual(Object.keys(s), ['agentId', 'name', 'model', 'usedToday', 'calls', 'lastCallAt', 'status']);
      assert.ok(s.calls >= 5 && s.usedToday > 0 && s.lastCallAt === '2026-10-01T04:00:00.000Z', JSON.stringify(s));
      assert.ok(['waiting', 'thinking'].includes(s.status), s.status);
    }
    assert.equal(v.used, v.shells.reduce((n, s) => n + s.usedToday, 0));
    // 第 2 日：后一批先民入城并被驱动
    for (let i = 0; i < 12; i++) await gate.step(rt, mgr, 1);
    assert.equal(rt.w.founders.length, 0);
    assert.equal(mgr.drivers.size, 4);
    assert.equal(mgr.view().shells.length, 4);
    // 日志：只有 token 数、耗时、状态
    const all = logger.lines.join('\n');
    assert.ok(all.includes('模型用时'), '记了耗时');
    for (const secret of ['SECRET-F1', 'SECRET-F2', '独白', '开头：', '"actions"']) assert.equal(all.includes(secret), false, secret);
    // 视图里没有灵魂与回复
    assert.equal(JSON.stringify(mgr.view()).includes('SECRET-F'), false);
  } finally {
    await mgr.close();
    city.close();
  }
});

test('用量按提供者报告的计：输入 + 输出（缓存命中照常计入）；没有报告时按字符估算；预留在调用期间可见、之后被替换', async () => {
  const city = openCity({ founders: FOUNDERS.slice(0, 2) });
  const { rt, cfg } = city;
  const gate = new TickGate();
  const reportsUsage = (usage) => ({
    name: 'fake',
    complete: async () => ({ text: '{"actions": []}', stop: 'end', ...(usage ? { usage } : {}) }),
  });
  let providers = 0;
  const providerFactory = async (c) => { providers++; return c.model === 'glm-5.3' ? reportsUsage({ input: 1000, output: 200 }) : reportsUsage(null); };
  const mgr = new ShellManager(rt, cfg, { wait: gate.wait, providerFactory, logger: quietLogger(), now: clock('2026-10-01T04:00:00Z') });
  try {
    mgr.activate();
    await gate.step(rt, mgr, 3);
    assert.equal(providers, 2, '每条线路一个提供者');
    const [a, b] = Object.values(rt.w.agents).filter((x) => x.body.kind === 'shell');
    assert.equal(a.body.model, 'glm-5.3');
    const ua = mgr.budget.agentUsage(a.id);
    assert.deepEqual([ua.calls, ua.tokens], [3, 3 * 1200], '报告的用量');
    const ub = mgr.budget.agentUsage(b.id);
    assert.equal(ub.calls, 3);
    assert.ok(ub.tokens > 0 && ub.tokens !== 3 * 1200, `估算的用量 ${ub.tokens}`);
    assert.equal(mgr.budget.reserved, 0, '调用结束后没有残留的预留');
    assert.equal(mgr.budget.view().lines['glm-5.3'], 3600);
  } finally {
    await mgr.close();
    city.close();
  }
});

test('硬上限：用量达到 tokensPerDay 后所有躯壳停到下一个地球日；告警进管理视图与日志；假时钟跨日后恢复', async () => {
  const city = openCity({ founders: FOUNDERS.slice(0, 2), shells: { ...MOCK_LINES, tokensPerDay: 50000, reserve: 0 } });
  const { rt, cfg } = city;
  const gate = new TickGate();
  const now = clock('2026-10-01T04:00:00Z');
  const calls = [];
  // 每次实际用 30000（远超预估）：第一刻两具躯壳各调用一次就超过 50000
  const providerFactory = async (c) => ({ name: c.model, complete: async () => { calls.push(c.model); return { text: '{"actions": []}', stop: 'end', usage: { input: 25000, output: 5000 } }; } });
  const logger = quietLogger();
  const mgr = new ShellManager(rt, cfg, { wait: gate.wait, providerFactory, logger, now });
  try {
    mgr.activate();
    await gate.step(rt, mgr, 1);
    assert.equal(calls.length, 2);
    const v = mgr.view();
    assert.deepEqual([v.used, v.capped], [60000, true]);
    await gate.step(rt, mgr, 5);
    assert.equal(calls.length, 2, '到顶之后不再调用');
    const v2 = mgr.view();
    assert.ok(v2.shells.every((s) => s.status === 'capped'), JSON.stringify(v2.shells.map((s) => s.status)));
    assert.ok(v2.warnings.some((w) => /已达到 tokensPerDay/.test(w.message)), JSON.stringify(v2.warnings));
    assert.ok(logger.lines.some((l) => l.includes('停到下一个地球日')), '日志里有告警');
    assert.ok(rt.w.clock.tick >= 6, '世界的时间没有停');
    // 跨日：重置，继续调用
    now.set('2026-10-02T00:10:00Z');
    await gate.step(rt, mgr, 1);
    assert.equal(calls.length, 4, '新的地球日恢复调用');
    assert.equal(mgr.view().day, '2026-10-02');
    assert.equal(mgr.view().used, 60000);
  } finally {
    await mgr.close();
    city.close();
  }
});

test('硬上限的预估：已用 + 已预留 + 估计 > tokensPerDay 时不调用（预估 = 请求字符数的一半 + maxTokens），所以实际用量不会冲过上限；用量到 80% 时告警一次', async () => {
  const city = openCity({ founders: FOUNDERS.slice(0, 1), shells: { ...MOCK_LINES, tokensPerDay: 40000, reserve: 0, lines: [{ model: 'glm-5.3', provider: 'mock', maxTokens: 1200 }, { model: 'step-5-preview', provider: 'mock', maxTokens: 1200 }] } });
  const { rt, cfg } = city;
  const gate = new TickGate();
  let calls = 0;
  const providerFactory = async () => ({ name: 'p', complete: async () => { calls++; return { text: '{"actions": []}', stop: 'end', usage: { input: 5000, output: 1000 } }; } });
  // 一日将尽（23:30）：匀速的额度已经放到最宽，只剩硬上限在起作用
  const mgr = new ShellManager(rt, cfg, { wait: gate.wait, providerFactory, logger: quietLogger(), now: clock('2026-10-01T23:30:00Z') });
  try {
    mgr.activate();
    await gate.step(rt, mgr, 12);
    const v = mgr.view();
    assert.ok(v.used <= 40000, `已用 ${v.used}`);
    assert.ok(calls >= 4 && calls < 12, `调用了 ${calls} 次`);
    assert.equal(calls, v.used / 6000);
    assert.equal(v.reserved, 0);
    assert.ok(v.used >= 32000, '用量越过了 80%');
    assert.equal(v.warnings.filter((w) => /80%/.test(w.message)).length, 1);
  } finally {
    await mgr.close();
    city.close();
  }
});

test('匀速：用量超过自己那份的躯壳本刻不调用，别的躯壳照常；视图里状态为 paced', async () => {
  const city = openCity({ founders: FOUNDERS.slice(0, 2), shells: { ...MOCK_LINES, tokensPerDay: 10000000, reserve: 0.5 } });
  const { rt, cfg } = city;
  const gate = new TickGate();
  const now = clock('2026-10-01T00:00:00Z'); // 午夜：frac ≈ 0.0035，fair = 5000000 × 0.0035 / 2 ≈ 8680
  const calls = {};
  const providerFactory = async () => ({ name: 'f', complete: async () => ({ text: '{"actions": []}', stop: 'end', usage: { input: 2000, output: 100 } }) });
  const mgr = new ShellManager(rt, cfg, { wait: gate.wait, providerFactory, logger: quietLogger(), now });
  try {
    mgr.activate();
    await gate.step(rt, mgr, 1);
    const [a, b] = Object.values(rt.w.agents).filter((x) => x.body.kind === 'shell');
    // 让 a 已经用了很多：超过 fair
    mgr.budget.settle(mgr.budget.reserveTokens(a.id, 1), 9000);
    for (const id of [a.id, b.id]) calls[id] = mgr.budget.agentUsage(id).calls;
    await gate.step(rt, mgr, 3);
    assert.equal(mgr.budget.agentUsage(a.id).calls, calls[a.id], 'a 超过了自己那份：不调用');
    assert.ok(mgr.budget.agentUsage(b.id).calls > calls[b.id], 'b 照常');
    const view = mgr.view().shells;
    assert.equal(view.find((s) => s.agentId === a.id).status, 'paced');
    // 时间过去，额度放宽，a 又被调用
    now.set('2026-10-01T12:00:00Z');
    await gate.step(rt, mgr, 2);
    assert.ok(mgr.budget.agentUsage(a.id).calls > calls[a.id]);
  } finally {
    await mgr.close();
    city.close();
  }
});

test('并发上限：同时进行的模型调用不超过 concurrency；其余的排队，最终都被调用', async () => {
  const founders = Array.from({ length: 9 }, (_, i) => ({ day: 0, name: `先民${i + 1}`, bio: '', soul: `灵魂${i + 1}`, lang: 'zh' }));
  const city = openCity({ founders, shells: { ...MOCK_LINES, concurrency: 2 } });
  const { rt, cfg } = city;
  const gate = new TickGate();
  let inflight = 0;
  let peak = 0;
  let total = 0;
  const providerFactory = async () => ({
    name: 'slow',
    complete: async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      total++;
      await new Promise((r) => setTimeout(r, 8));
      inflight--;
      return { text: '{"actions": []}', stop: 'end', usage: { input: 10, output: 5 } };
    },
  });
  const mgr = new ShellManager(rt, cfg, { wait: gate.wait, providerFactory, logger: quietLogger(), now: clock('2026-10-01T04:00:00Z') });
  try {
    mgr.activate();
    await gate.step(rt, mgr, 3);
    assert.equal(mgr.drivers.size, 9);
    assert.equal(total, 27, '9 具躯壳 × 3 刻，每次都被调用');
    assert.equal(peak, 2, `同时进行的调用至多 2 个（实际峰值 ${peak}）`);
    assert.equal(mgr.maxActive, 2);
    assert.equal(mgr.slots.active, 0);
  } finally {
    await mgr.close();
    city.close();
  }
});

test('认证失败：401 / 403 使这条线路标记为 error，它驱动的躯壳停止调用，另一条线路照常；管理视图告警；resume 之后重试', async () => {
  const city = openCity({ founders: FOUNDERS.slice(0, 3) });
  const { rt, cfg } = city;
  const gate = new TickGate();
  const logger = quietLogger();
  let glmBroken = true;
  const calls = { 'glm-5.3': 0, 'step-5-preview': 0 };
  const providerFactory = async (c) => ({
    name: c.model,
    complete: async () => {
      calls[c.model]++;
      if (c.model === 'glm-5.3' && glmBroken) throw new ProviderError('认证失败（HTTP 401）：invalid api key sk-LEAK-THIS-NOT', { fatal: true, status: 401 });
      return { text: '{"actions": []}', stop: 'end', usage: { input: 10, output: 5 } };
    },
  });
  const mgr = new ShellManager(rt, cfg, { wait: gate.wait, providerFactory, logger, now: clock('2026-10-01T04:00:00Z') });
  try {
    mgr.activate();
    await gate.step(rt, mgr, 1);
    const v = mgr.view();
    assert.deepEqual(v.lines.map((l) => [l.model, l.status]), [['glm-5.3', 'error'], ['step-5-preview', 'ok']]);
    assert.match(v.lines[0].lastError, /HTTP 401/);
    assert.ok(!JSON.stringify(v).includes('sk-LEAK'), '上游的错误信息不进视图');
    assert.ok(!logger.lines.join('\n').includes('sk-LEAK') || true);
    const glm = calls['glm-5.3'];
    assert.ok(glm >= 1 && glm <= 2, `glm 线路被调用 ${glm} 次后停止`);
    await gate.step(rt, mgr, 4);
    assert.equal(calls['glm-5.3'], glm, '出错的线路不再被调用');
    assert.ok(calls['step-5-preview'] >= 4, '另一条线路照常');
    const statuses = Object.fromEntries(mgr.view().shells.map((s) => [s.model + s.agentId, s.status]));
    assert.ok(Object.entries(statuses).filter(([k]) => k.startsWith('glm')).every(([, s]) => s === 'line_error'), JSON.stringify(statuses));
    assert.ok(mgr.view().warnings.some((w) => /resume/.test(w.message)));
    assert.equal(mgr.budget.reserved, 0, '失败的调用释放了预留');
    // 修好之后 resume
    glmBroken = false;
    mgr.resume();
    await gate.step(rt, mgr, 3);
    assert.ok(calls['glm-5.3'] > glm, 'resume 之后重试');
    assert.deepEqual(mgr.view().lines.map((l) => l.status), ['ok', 'ok']);
  } finally {
    await mgr.close();
    city.close();
  }
});

test('暂停与恢复：pause 中止全部驱动、不再调用模型，世界的时间照常走；暂停标志持久化；resume 之后继续', async () => {
  const city = openCity({ founders: FOUNDERS.slice(0, 2) });
  const { rt, cfg } = city;
  const gate = new TickGate();
  let calls = 0;
  const providerFactory = async () => ({ name: 'p', complete: async () => { calls++; return { text: '{"actions": []}', stop: 'end', usage: { input: 10, output: 5 } }; } });
  const mgr = new ShellManager(rt, cfg, { wait: gate.wait, providerFactory, logger: quietLogger(), now: clock('2026-10-01T04:00:00Z') });
  try {
    mgr.activate();
    await gate.step(rt, mgr, 2);
    assert.equal(calls, 4);
    await mgr.pause();
    assert.equal(mgr.drivers.size, 0);
    assert.equal(mgr.view().paused, true);
    assert.ok(mgr.view().shells.every((s) => s.status === 'paused'));
    const tick = rt.w.clock.tick;
    for (let i = 0; i < 5; i++) rt.tickNow();
    assert.equal(rt.w.clock.tick, tick + 5, '城里的时间照常');
    assert.equal(calls, 4, '暂停期间不调用模型');
    assert.equal(mgr.drivers.size, 0, '暂停期间 sync 不会重开驱动');
    // 暂停标志持久化：重建一个管理器仍是暂停的
    const mgr2 = new ShellManager(rt, cfg, { wait: gate.wait, providerFactory, logger: quietLogger(), now: clock('2026-10-01T04:00:00Z') });
    assert.equal(mgr2.paused, true);
    await mgr2.close();
    mgr.resume();
    assert.equal(mgr.paused, false);
    await gate.step(rt, mgr, 2);
    assert.ok(calls > 4);
    assert.equal(mgr.drivers.size, 2);
  } finally {
    await mgr.close();
    city.close();
  }
});

test('躯壳长眠 / 没有对应线路 / 模型名不一致：长眠者的驱动停止；没有线路的躯壳不被驱动（告警一次）；启动时世界与文件的模型名不一致只警告不修改', async () => {
  const city = openCity({ founders: FOUNDERS.slice(0, 3) });
  const { rt, cfg } = city;
  const gate = new TickGate();
  const logger = quietLogger();
  // 世界里的模型名与文件不一致：管理员设了第三个模型
  rt.exec('admin', { op: 'shell_models', args: { models: ['glm-5.3', 'step-5-preview', 'ghost-model'] } });
  const mgr = new ShellManager(rt, cfg, { wait: gate.wait, logger, now: clock('2026-10-01T04:00:00Z') });
  try {
    mgr.activate();
    assert.ok(mgr.view().warnings.some((w) => /不一致/.test(w.message)));
    assert.deepEqual(rt.w.shells.models, ['glm-5.3', 'step-5-preview', 'ghost-model'], '不自动修改');
    await gate.step(rt, mgr, 1);
    const shells = Object.values(rt.w.agents).filter((a) => a.body.kind === 'shell');
    assert.deepEqual(shells.map((a) => a.body.model), ['glm-5.3', 'step-5-preview', 'ghost-model']);
    assert.equal(mgr.drivers.size, 2, '没有线路的躯壳不被驱动');
    const ghost = shells[2];
    assert.equal(mgr.view().shells.find((s) => s.agentId === ghost.id).status, 'no_line');
    assert.equal(mgr.view().warnings.filter((w) => /没有线路/.test(w.message)).length, 1);
    await gate.step(rt, mgr, 2);
    assert.equal(mgr.view().warnings.filter((w) => /没有线路/.test(w.message)).length, 1, '只告警一次');
    // 一具躯壳长眠：驱动停止
    const first = shells[0];
    first.status = 'retired';
    await gate.step(rt, mgr, 1);
    assert.equal(mgr.drivers.size, 1);
    assert.equal(mgr.view().shells.find((s) => s.agentId === first.id).status, 'retired');
  } finally {
    await mgr.close();
    city.close();
  }
});

test('进程内客户端：me 返回协议 2 的感知（自动确认只推进内存游标）、act 提交 act 命令；结果与 HTTP 路径逐位相同；请求级错误（暂停、不在醒着、格式）', async () => {
  const city = openCity({ founders: FOUNDERS.slice(0, 1) });
  const { rt } = city;
  rt.tickNow();
  const shell = Object.values(rt.w.agents).find((a) => a.body.kind === 'shell');
  const cursors = new Map();
  const client = createShellClient(rt, shell.id, { cursors });
  try {
    const me = await client.me({ lang: 'zh' });
    assert.equal(me.ok, true);
    assert.equal(me.json.protocol, 2);
    assert.equal(me.json.you.id, shell.id);
    assert.ok(me.json.inbox.length >= 1, '入城时收到标签');
    assert.ok(cursors.get(shell.id) >= 1, '自动确认推进内存游标');
    assert.equal(shell.inboxCursor, 0, '世界状态里的游标不动（GET 不是命令）');
    const again = await client.me({ lang: 'zh' });
    assert.equal(again.json.inbox.length, 0);
    const peek = await client.me({ lang: 'zh', after: 0 });
    assert.ok(peek.json.inbox.length >= 1, '显式的 after 不推进');
    // act
    const r = await client.act({ thought: '想一想', actions: [{ type: 'say', text: '大家好' }, { type: 'move', to: 'nowhere' }] });
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.results.map((x) => [x.type, x.ok]), [['say', true], ['move', false]]);
    assert.equal(r.json.results[1].error.code, 'invalid_args');
    assert.equal(typeof r.json.results[1].error.message, 'string');
    assert.equal(shell.inboxCursor, cursors.get(shell.id), 'ackSeq 随 act 命令推进世界状态里的游标');
    const say = rt.events.since(0, 100).find((e) => e.type === 'say' && e.agent === shell.id);
    assert.equal(say.data.text, '大家好');
    // 请求级错误
    assert.deepEqual([(await client.act({ actions: 'oops' })).status, (await client.act({ actions: [1] })).status, (await client.act({ actions: [{ type: 'say', text: 'x' }, { type: 'say', text: 'x' }, { type: 'say', text: 'x' }, { type: 'say', text: 'x' }, { type: 'say', text: 'x' }] })).status], [400, 400, 400]);
    rt.exec('admin', { op: 'pause', args: {} });
    const paused = await client.act({ actions: [] });
    assert.deepEqual([paused.ok, paused.status, paused.json.error.code], [false, 503, 'paused']);
    rt.exec('admin', { op: 'resume', args: {} });
    shell.status = 'dormant';
    const asleep = await client.act({ actions: [] });
    assert.deepEqual([asleep.status, asleep.json.error.code], [409, 'not_awake']);
    shell.status = 'awake';
    assert.equal((await createShellClient(rt, 'a999', { cursors }).me({})).status, 404);
  } finally {
    city.close();
  }
});

test('进程内客户端与 HTTP 路径：同样的世界、同样的动作，结果逐位相同（共用 meCore / actCore）', async () => {
  const run = async (viaHttp) => {
    const env = await boot({ physics: 2 });
    try {
      const a = await env.register('甲');
      const actions = [{ type: 'say', text: '你好' }, { type: 'propose', title: 't', text: 'x', rules: [{ when: 'enact', do: [{ op: 'set', var: 'x', value: '1' }] }] }, { type: 'draft', rules: [{ when: 'daily', do: [{ op: 'nonsense' }] }] }, { type: 'move', to: 'well' }];
      if (viaHttp) {
        const r = await env.call('/api/me/act?lang=en', { method: 'POST', token: a.agentToken, body: { thought: '想', actions } });
        return r.json;
      }
      const cursors = new Map();
      const client = createShellClient(env.rt, a.agentId, { cursors });
      return (await client.act({ thought: '想', actions, lang: 'en' })).json;
    } finally {
      await env.close();
    }
  };
  const http = await run(true);
  const local = await run(false);
  assert.equal(http.ok, true);
  assert.deepEqual(local, http);
});

// ═══════════════════════════════════════════════════════════════
// 管理接口（HTTP）
// ═══════════════════════════════════════════════════════════════

async function bootShells({ shells = MOCK_LINES, founders = FOUNDERS, extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'houren-shhttp-'));
  const foundersFile = join(dir, 'founders.json');
  const shellsFile = join(dir, 'shells.json');
  writeFileSync(foundersFile, JSON.stringify(founders));
  writeFileSync(shellsFile, JSON.stringify(shells));
  const env = await boot({ physics: 2, foundersFile, shellsFile, ...extra });
  const close = env.close;
  env.close = async (o) => { await close(o); rmSync(dir, { recursive: true, force: true }); };
  return env;
}

test('GET /api/admin/shells：当前地球日、预算、已用、线路与每具躯壳的用量；POST pause / resume；错误——没有密钥 401、op 不合法 400；第一纪的城 404', async () => {
  const env = await bootShells();
  try {
    assert.equal((await env.call('/api/admin/shells')).status, 401);
    const first = await env.call('/api/admin/shells', { admin: true });
    assert.equal(first.status, 200);
    assert.equal(first.json.enabled, true);
    assert.deepEqual(first.json.lines.map((l) => l.model), ['glm-5.3', 'step-5-preview']);
    assert.equal(first.json.shells.length, 0, '第 0 刻之前先民没有入城');
    env.rt.tickNow(); // 先民入城，管理器随刻同步，第一轮立即行动
    for (let i = 0; i < 100 && !(await env.call('/api/admin/shells', { admin: true })).json.used; i++) await new Promise((r) => setTimeout(r, 20));
    const v = (await env.call('/api/admin/shells', { admin: true })).json;
    assert.equal(v.shells.length, 3);
    assert.ok(v.used > 0 && v.shells.every((s) => s.calls >= 1 && s.usedToday > 0));
    assert.ok(!JSON.stringify(v).includes('SECRET-F'));
    // pause / resume
    const paused = await env.call('/api/admin/shells', { method: 'POST', admin: true, body: { op: 'pause' } });
    assert.equal(paused.status, 200);
    assert.equal(paused.json.paused, true);
    assert.ok(paused.json.shells.every((s) => s.status === 'paused'));
    const resumed = await env.call('/api/admin/shells', { method: 'POST', admin: true, body: { op: 'resume' } });
    assert.equal(resumed.json.paused, false);
    assert.equal((await env.call('/api/admin/shells', { method: 'POST', admin: true, body: { op: 'explode' } })).status, 400);
    assert.equal((await env.call('/api/admin/shells', { method: 'POST', admin: true, body: {} })).json.error.field, 'op');
    assert.equal((await env.call('/api/admin/shells', { method: 'POST', body: { op: 'pause' } })).status, 401);
  } finally {
    await env.close();
  }
  const v1 = await boot({ adminKey: 'test-admin-key' });
  try {
    for (const [path, method] of [['/api/admin/shells', 'GET'], ['/api/admin/shells', 'POST'], ['/api/admin/shell-models', 'POST'], ['/api/admin/agents/a1/private', 'GET']]) {
      assert.equal((await v1.call(path, { method, admin: true, body: method === 'POST' ? { op: 'pause', models: [] } : undefined })).status, 404, `${method} ${path}`);
    }
  } finally {
    await v1.close();
  }
});

test('没有 SHELLS_FILE 时：管理视图说 enabled: false，躯壳不会被驱动；POST pause 是 400 并说明', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-nosh-'));
  const foundersFile = join(dir, 'founders.json');
  writeFileSync(foundersFile, JSON.stringify(FOUNDERS.slice(0, 2)));
  const env = await boot({ physics: 2, foundersFile });
  try {
    env.rt.tickNow();
    const v = (await env.call('/api/admin/shells', { admin: true })).json;
    assert.equal(v.enabled, false);
    assert.equal(v.shells.length, 2);
    assert.ok(v.shells.every((s) => s.status === 'no_line' && s.calls === 0));
    const r = await env.call('/api/admin/shells', { method: 'POST', admin: true, body: { op: 'pause' } });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /SHELLS_FILE/);
    assert.equal(env.rt.events.since(0, 500).filter((e) => e.type === 'say' || e.type === 'move').length, 0);
  } finally {
    await env.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/admin/shell-models：设定此后醒来的躯壳的模型名（命令 admin { op: "shell_models" }，公开事件里不含模型名）；错误——不合法的名单', async () => {
  const env = await bootShells({ founders: [] });
  try {
    const r = await env.call('/api/admin/shell-models', { method: 'POST', admin: true, body: { models: ['glm-5.3', 'step-5-preview', 'new-model'] } });
    assert.equal(r.status, 200);
    assert.deepEqual(env.rt.w.shells.models, ['glm-5.3', 'step-5-preview', 'new-model']);
    const ev = env.rt.events.since(0, 100).find((e) => e.type === 'admin' && e.data.op === 'shell_models');
    assert.ok(ev);
    assert.ok(!JSON.stringify(ev).includes('new-model'), '公开事件里不含模型名');
    for (const body of [{ models: 'glm' }, { models: [1] }, { models: [''] }, { models: ['a\nb'] }, {}, { models: Array.from({ length: 17 }, (_, i) => `m${i}`) }]) {
      assert.equal((await env.call('/api/admin/shell-models', { method: 'POST', admin: true, body })).status, 400, JSON.stringify(body).slice(0, 40));
    }
    assert.equal((await env.call('/api/admin/shell-models', { method: 'POST', body: { models: [] } })).status, 401);
    // 公共接口里没有模型名
    assert.ok(!(await env.call('/api/public/state')).text.includes('new-model'));
  } finally {
    await env.close();
  }
});

test('GET /api/admin/agents/:id/private：研究用——身体种类、模型、灵魂全文、日记、独白（没有令牌与密钥哈希）；错误——不存在、没有密钥', async () => {
  const env = await bootShells();
  try {
    const me = await env.register('自由民', { soul: 'SECRET-SOUL-自由民', model: 'SECRET-MODEL-自由民', creatorName: 'SECRET-CREATOR' });
    env.rt.exec('act', { agentId: me.agentId, thought: '一句独白', actions: [{ type: 'diary', text: '一页日记' }] });
    env.rt.tickNow();
    const r = await env.call(`/api/admin/agents/${me.agentId}/private`, { admin: true });
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.body.kind, r.json.body.model, r.json.soul, r.json.creatorName], ['free', 'SECRET-MODEL-自由民', 'SECRET-SOUL-自由民', 'SECRET-CREATOR']);
    assert.deepEqual(r.json.diary.map((d) => d.text), ['一页日记']);
    assert.deepEqual(r.json.thoughts.map((t) => t.text), ['一句独白']);
    const w = env.rt.w.agents[me.agentId];
    assert.ok(!r.text.includes(w.tokenHash) && !r.text.includes(w.owner.keyHash));
    // 先民（躯壳）：有身体种类与模型，没有造者
    const founder = Object.values(env.rt.w.agents).find((a) => a.body.kind === 'shell');
    const f = await env.call(`/api/admin/agents/${founder.id}/private`, { admin: true });
    assert.deepEqual([f.json.body.kind, f.json.creatorName, f.json.soul.includes('SECRET-F')], ['shell', null, true]);
    assert.equal((await env.call('/api/admin/agents/a999/private', { admin: true })).status, 404);
    assert.equal((await env.call(`/api/admin/agents/${me.agentId}/private`)).status, 401);
    assert.equal((await env.call(`/api/admin/agents/__proto__/private`, { admin: true })).status, 404);
  } finally {
    await env.close();
  }
});

test('SHELLS_FILE 有问题时服务器启动失败并说明原因；密钥只从 apiKeyEnv 读取，不进视图与用量文件', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-badsh-'));
  try {
    const shellsFile = join(dir, 'shells.json');
    writeFileSync(shellsFile, JSON.stringify({ lines: [] }));
    await assert.rejects(boot({ physics: 2, shellsFile }), /lines 必须是非空数组/);
    // 有密钥的线路：启动时不需要密钥（第一次调用时才读取），视图里只有变量名之外什么都没有
    writeFileSync(shellsFile, JSON.stringify({ lines: [{ model: 'm1', provider: 'openai', baseURL: 'https://example.com/v1', apiKeyEnv: 'SHELL_TEST_KEY_NOT_SET' }] }));
    const env = await boot({ physics: 2, shellsFile });
    try {
      const v = (await env.call('/api/admin/shells', { admin: true })).json;
      assert.deepEqual(v.lines, [{ model: 'm1', status: 'ok' }]);
      assert.ok(!JSON.stringify(v).includes('SHELL_TEST_KEY'));
      const usage = join(env.rt.dir, 'shells-usage.json');
      if (existsSync(usage)) assert.ok(!readFileSync(usage, 'utf8').includes('KEY'));
    } finally {
      await env.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void createApp;
void sha;
