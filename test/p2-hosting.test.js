// SPEC-P2 T12：躯壳与托管——配置（agentLoop、toolMode）、幕后指纹、躯壳管理器与托管运行器的接线、连接测试、用量。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import e2 from '../src/e2/facade.js';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { ShellManager } from '../src/shells/manager.js';
import { parseShellsConfig, TOOL_MODES } from '../src/shells/config.js';
import { bodiesFingerprint, checkBackstage } from '../src/backstage.js';
import { runnerConfig, RunnerError } from '../src/runner/manager.js';
import { UsageStore } from '../src/runner/usage.js';
import { DEFAULT_AGENT_LOOP } from '../runner/loop.js';
import { ProviderError } from '../runner/providers.js';
import { boot } from './http-helpers.js';
import { sleepMs } from './p2-loop-helpers.js';

const LINE = { model: 'm', provider: 'mock' };
const cfgOf = (extra) => parseShellsConfig({ lines: [LINE], ...extra });

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

test('P2 T12 agentLoop：缺省就是 DEFAULT_AGENT_LOOP；缺的键取缺省；总是完整的对象，键的顺序固定；各键的范围', () => {
  assert.deepEqual(cfgOf({}).agentLoop, DEFAULT_AGENT_LOOP);
  assert.deepEqual(DEFAULT_AGENT_LOOP, { turns: 4, looks: 6, lookChars: 3000, wakes: 2, wakeTurns: 2, marginSec: 60, debounceSec: 20 });
  assert.notEqual(cfgOf({}).agentLoop, DEFAULT_AGENT_LOOP, '返回的是拷贝，改它不会改缺省值');
  const partial = cfgOf({ agentLoop: { wakeTurns: 3, turns: 5 } }).agentLoop;
  assert.deepEqual(partial, { turns: 5, looks: 6, lookChars: 3000, wakes: 2, wakeTurns: 3, marginSec: 60, debounceSec: 20 });
  assert.deepEqual(Object.keys(partial), ['turns', 'looks', 'lookChars', 'wakes', 'wakeTurns', 'marginSec', 'debounceSec'], '键的顺序固定（指纹要用）');
  assert.deepEqual(Object.keys(cfgOf({ agentLoop: {} }).agentLoop), Object.keys(DEFAULT_AGENT_LOOP));
  // 范围：每个键的最小与最大值都可以，越界与非整数报错
  const ranges = { turns: [1, 8], looks: [0, 20], lookChars: [500, 8000], wakes: [0, 4], wakeTurns: [1, 4], marginSec: [10, 300], debounceSec: [0, 60] };
  for (const [k, [min, max]] of Object.entries(ranges)) {
    assert.equal(cfgOf({ agentLoop: { [k]: min } }).agentLoop[k], min);
    assert.equal(cfgOf({ agentLoop: { [k]: max } }).agentLoop[k], max);
    for (const bad of [min - 1, max + 1, 1.5, '3', null, NaN]) assert.throws(() => cfgOf({ agentLoop: { [k]: bad } }), new RegExp(`agentLoop\\.${k} 必须是 ${min}–${max} 的整数`), `${k}=${bad}`);
  }
  // 未知的键、不是对象
  assert.throws(() => cfgOf({ agentLoop: { turn: 3 } }), /agentLoop\.turn 不是认得的字段（可用：turns、looks、lookChars、wakes、wakeTurns、marginSec、debounceSec）/);
  for (const bad of [5, 'x', [], null, true]) assert.throws(() => cfgOf({ agentLoop: bad }), /agentLoop 必须是一个 JSON 对象/, JSON.stringify(bad));
  // 其余的键不受影响
  const c = cfgOf({ tokensPerDay: 1000, concurrency: 2, agentLoop: { turns: 2 } });
  assert.deepEqual([c.tokensPerDay, c.concurrency, c.historyRounds, c.lines.length], [1000, 2, 2, 1]);
});

test('P2 T12 toolMode：线路的 json / native；不合法报错；没有写的线路原样，不凭空加一个键', () => {
  assert.deepEqual(TOOL_MODES, ['json', 'native']);
  for (const mode of TOOL_MODES) assert.equal(cfgOf({ lines: [{ ...LINE, toolMode: mode }] }).lines[0].toolMode, mode);
  for (const bad of ['both', 'JSON', '', null, 1, true]) assert.throws(() => cfgOf({ lines: [{ ...LINE, toolMode: bad }] }), /lines\[0\]\.toolMode 必须是 "json" 或 "native"/, String(bad));
  const plain = cfgOf({}).lines[0];
  assert.equal(Object.hasOwn(plain, 'toolMode'), false, '没有 toolMode 的线路没有这个键（指纹与以前相同）');
  assert.deepEqual(plain, { model: 'm', provider: 'mock', maxTokens: 1200, timeoutMs: 120000 });
});

// ═══════════════════════════════════════════════════════════════
// 幕后指纹
// ═══════════════════════════════════════════════════════════════

/** 改动之前的 bodiesFingerprint（逐字抄自第一前提的实现）：没有 toolMode 与 agentLoop 时必须与它逐位相同 */
function legacyBodiesFingerprint(lines) {
  const keys = ['provider', 'model', 'maxTokens', 'extraBody', 'reasoningEffort', 'effort'];
  const data = lines.map((line) => Object.fromEntries(keys.filter((k) => Object.hasOwn(line, k)).map((k) => [k, line[k]])));
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

test('P2 T12 指纹：没有 toolMode 的线路、agentLoop 为 null 时与以前逐位相同；toolMode 与 agentLoop 改了，指纹就变；与线路的其他字段无关', () => {
  const lines = [{ provider: 'openai', model: 'glm-5.3', maxTokens: 1200, extraBody: { thinking: { type: 'disabled' } }, baseURL: 'https://x', apiKeyEnv: 'K', timeoutMs: 1 }, { provider: 'mock', model: 'b', effort: 'high' }];
  const base = bodiesFingerprint(lines);
  assert.equal(base, legacyBodiesFingerprint(lines));
  assert.equal(bodiesFingerprint(lines, null), base);
  // toolMode 是线路取的键
  const native = lines.map((l, i) => (i === 0 ? { ...l, toolMode: 'native' } : l));
  assert.notEqual(bodiesFingerprint(native), base);
  assert.notEqual(bodiesFingerprint(native), bodiesFingerprint(lines.map((l, i) => (i === 0 ? { ...l, toolMode: 'json' } : l))));
  // agentLoop 不为 null：对 { lines, agentLoop } 求哈希
  const withLoop = bodiesFingerprint(lines, DEFAULT_AGENT_LOOP);
  assert.notEqual(withLoop, base);
  assert.equal(withLoop, bodiesFingerprint(lines, { ...DEFAULT_AGENT_LOOP }));
  assert.notEqual(withLoop, bodiesFingerprint(lines, { ...DEFAULT_AGENT_LOOP, wakes: 1 }));
  assert.notEqual(withLoop, bodiesFingerprint(lines, { ...DEFAULT_AGENT_LOOP, marginSec: 90 }));
  // 与 baseURL、密钥名、超时无关（同第一前提）
  assert.equal(bodiesFingerprint(lines.map((l) => ({ ...l, baseURL: 'https://other', apiKeyEnv: 'OTHER', timeoutMs: 999 })), DEFAULT_AGENT_LOOP), withLoop);
});

test('P2 T12 指纹的效果：第二前提的世界里改 agentLoop 或 toolMode，下一次启动发一次 backstage bodies；第一前提的世界里 agentLoop 不算', async () => {
  const mkRoot = () => {
    const root = mkdtempSync(join(tmpdir(), 'p2-fingerprint-'));
    mkdirSync(join(root, 'src/e2'), { recursive: true });
    writeFileSync(join(root, 'src/e2/a.js'), 'original');
    return root;
  };
  const root = mkRoot();
  try {
    for (const premise of [2, 1]) {
      const world = e2.createWorld({ seed: `fp-${premise}`, premise, shellModels: ['m'] });
      const rows = [];
      const rt = { w: world, exec: (type, payload) => { const r = e2.applyCommand(world, { type, payload }); rows.push(r); return r; } };
      const shells = { config: { lines: [{ provider: 'mock', model: 'm', maxTokens: 100 }], tokensPerDay: 1000, agentLoop: { ...DEFAULT_AGENT_LOOP } } };
      const kinds = () => rows.flatMap((r) => r.events).filter((e) => e.type === 'backstage').map((e) => e.data.kind);
      checkBackstage(rt, shells, { root });
      assert.equal(rows.length, 3, `premise ${premise}: 第一次只记初始指纹`);
      checkBackstage(rt, shells, { root });
      assert.equal(rows.length, 3, '没有变：不发');
      // 改 agentLoop
      shells.config.agentLoop = { ...shells.config.agentLoop, turns: 3 };
      checkBackstage(rt, shells, { root });
      assert.deepEqual(kinds(), premise === 2 ? ['bodies'] : [], `premise ${premise}: agentLoop`);
      checkBackstage(rt, shells, { root });
      assert.deepEqual(kinds(), premise === 2 ? ['bodies'] : [], '同一个变化只发一次');
      // 改 toolMode：两种设定都是线路取的键
      shells.config.lines[0].toolMode = 'native';
      checkBackstage(rt, shells, { root });
      assert.deepEqual(kinds(), premise === 2 ? ['bodies', 'bodies'] : ['bodies'], `premise ${premise}: toolMode`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // 端到端：createApp 里的 checkBackstage——重启时发的是收件 backstage_bodies
  const dir = mkdtempSync(join(tmpdir(), 'p2-backstage-'));
  const shellsFile = join(dir, 'shells.json');
  const writeShells = (extra) => writeFileSync(shellsFile, JSON.stringify({ tokensPerDay: 1000000, lines: [{ model: 'm', provider: 'mock' }], ...extra }));
  try {
    writeShells({});
    let env = await boot({ physics: 2, premise: 2, shellSlots: 4, shellsFile, shellModels: ['m'], seed: 'bs' }, { dir: join(dir, 'data') });
    const a = await env.register('甲');
    const bodiesNotices = () => env.rt.w.agents[a.agentId].inbox.filter((i) => i.code === 'backstage_bodies').length;
    assert.equal(bodiesNotices(), 0);
    await env.close({ keepDir: true });
    for (const [extra, expected] of [[{}, 0], [{ agentLoop: { wakes: 1 } }, 1], [{ agentLoop: { wakes: 1 } }, 1], [{ agentLoop: { wakes: 1 }, lines: [{ model: 'm', provider: 'mock', toolMode: 'native' }] }, 2]]) {
      writeShells(extra);
      env = await boot({ physics: 2, premise: 2, shellSlots: 4, shellsFile, shellModels: ['m'], seed: 'bs' }, { dir: join(dir, 'data') });
      assert.equal(bodiesNotices(), expected, JSON.stringify(extra));
      await env.close({ keepDir: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════
// 躯壳管理器
// ═══════════════════════════════════════════════════════════════

const FOUNDERS = [{ day: 0, name: '先民甲', bio: '', soul: '甲的灵魂', lang: 'zh' }, { day: 0, name: '先民乙', bio: '', soul: '乙的灵魂', lang: 'zh' }];
const quiet = () => ({ lines: [], log() {}, warn() {}, error() {} });

async function shellCity({ shells, premise = 2 }) {
  const dir = mkdtempSync(join(tmpdir(), 'p2-shells-'));
  writeFileSync(join(dir, 'founders.json'), JSON.stringify(FOUNDERS));
  writeFileSync(join(dir, 'shells.json'), JSON.stringify(shells));
  const cfg = { ...loadConfig({}, []), dataDir: join(dir, 'data'), worldId: 'w', seed: 'shell-hosting', physics: 2, premise, foundersFile: join(dir, 'founders.json'), shellsFile: join(dir, 'shells.json'), tickMs: 300000 };
  const rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
  return { rt, cfg, close: () => { rt.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('P2 T12 躯壳管理器：线路的 toolMode 与 timeoutMs 交给运行器；onWaking 把轨迹交给 traces；没有 traces 时什么也不做', async () => {
  const city = await shellCity({ shells: { tokensPerDay: 50000000, timezone: 'UTC', agentLoop: { turns: 2 }, lines: [{ model: 'm', provider: 'mock', seed: 5, toolMode: 'native', timeoutMs: 45000 }] } });
  try {
    const seen = [];
    const providerFactory = async (cfg, deps) => {
      const { createProvider } = await import('../runner/providers.js');
      const inner = await createProvider(cfg, deps);
      return {
        name: 'spy',
        complete: async (req) => { seen.push({ via: 'complete' }); return inner.complete(req); },
        step: async (req) => { seen.push({ via: 'step', timeoutMs: req.timeoutMs, tools: req.tools.map((t) => t.name) }); return inner.step(req); },
      };
    };
    const traces = [];
    const waking = [];
    const mgr = new ShellManager(city.rt, city.cfg, { providerFactory, logger: quiet(), waitWake: false, wait: (ms, signal) => new Promise((resolve) => { if (signal && signal.aborted) return resolve(); signal?.addEventListener('abort', resolve, { once: true }); }) });
    assert.deepEqual(mgr.config.agentLoop, { ...DEFAULT_AGENT_LOOP, turns: 2 });
    city.rt.agentLoop = mgr.config.agentLoop;
    mgr.traces = { append: (id, rec, model) => { traces.push({ id, rec, model }); waking.push(rec.kind); } };
    mgr.activate();
    city.rt.tickNow();
    for (let i = 0; i < 200 && traces.length < 2; i++) await sleepMs(10);
    assert.ok(traces.length >= 2, `轨迹 ${traces.length} 条`);
    assert.ok(seen.length >= 2 && seen.every((s) => s.via === 'step'), '线路是 native：用 step');
    assert.ok(seen.every((s) => s.tools.join() === 'look,act'));
    assert.ok(seen.every((s) => s.timeoutMs <= 45000 && s.timeoutMs >= 1000), `单次调用的超时不超过线路的 45 秒：${seen[0].timeoutMs}`);
    assert.ok(traces.every((t) => t.model === 'm' && t.rec.kind === 'main' && t.rec.mode === 'native' && Number.isInteger(t.rec.tick)));
    assert.ok(traces.every((t) => /^a\d+$/.test(t.id)));
    // 没有 traces（缺省）：不出错
    await mgr.close();
    const mgr2 = new ShellManager(city.rt, city.cfg, { providerFactory, logger: quiet(), waitWake: false, wait: (ms, signal) => new Promise((resolve) => { signal?.addEventListener('abort', resolve, { once: true }); }) });
    assert.equal(mgr2.traces, undefined);
    mgr2.activate();
    city.rt.tickNow();
    await sleepMs(150);
    await mgr2.close();
  } finally {
    city.close();
  }
});

test('P2 T12 躯壳管理器：没有 toolMode 的线路用文本 JSON（complete）；设定 1 的世界不受影响（仍是一刻一问）', async () => {
  for (const premise of [2, 1]) {
    const city = await shellCity({ premise, shells: { tokensPerDay: 50000000, timezone: 'UTC', lines: [{ model: 'm', provider: 'mock', seed: 5 }] } });
    try {
      const seen = [];
      const providerFactory = async (cfg, deps) => {
        const { createProvider } = await import('../runner/providers.js');
        const inner = await createProvider(cfg, deps);
        return { name: 'spy', complete: async (req) => { seen.push(req.messages.at(-1).content.slice(0, 8)); return inner.complete(req); } };
      };
      const mgr = new ShellManager(city.rt, city.cfg, { providerFactory, logger: quiet(), waitWake: false, wait: (ms, signal) => new Promise((resolve) => { signal?.addEventListener('abort', resolve, { once: true }); }) });
      if (premise === 2) city.rt.agentLoop = mgr.config.agentLoop;
      mgr.activate();
      city.rt.tickNow();
      for (let i = 0; i < 200 && seen.length < 2; i++) await sleepMs(10);
      assert.ok(seen.length >= 1, `premise ${premise}: 调用了模型`);
      assert.ok(seen.every((s) => s.startsWith('【此刻】') || s.startsWith('【')), `premise ${premise}: ${seen.join('|')}`);
      await mgr.close();
    } finally {
      city.close();
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// 托管运行器
// ═══════════════════════════════════════════════════════════════

test('P2 T12 托管：runnerConfig 的 toolMode——json / native；没有给就不写进配置；不合法报错；其余字段与上限不变（timeoutMs 仍至多 120000）', () => {
  const base = { provider: 'mock', model: 'mock' };
  assert.equal(Object.hasOwn(runnerConfig(base), 'toolMode'), false);
  assert.equal(runnerConfig({ ...base, toolMode: 'native' }).toolMode, 'native');
  assert.equal(runnerConfig({ ...base, toolMode: 'json' }).toolMode, 'json');
  for (const bad of ['both', '', null, 1]) assert.throws(() => runnerConfig({ ...base, toolMode: bad }), (e) => e instanceof RunnerError && e.message === '调用方式无效。', String(bad));
  assert.equal(runnerConfig(base).timeoutMs, 120000);
  assert.throws(() => runnerConfig({ ...base, timeoutMs: 120001 }), RunnerError);
  assert.equal(runnerConfig({ ...base, historyRounds: 3 }).historyRounds, 3);
});

test('P2 T12 托管：连接测试——第二前提且 native 时另做一次带 act 工具的测试，拿不到工具调用就报「没有按要求调用工具」；其他情况不做', async () => {
  const p2 = await boot({ physics: 2, premise: 2, shellSlots: 4, seed: 'prep-2' });
  const p1 = await boot({ physics: 2, premise: 1, shellSlots: 4, seed: 'prep-1' });
  try {
    const mgr = p2.app.ctx.runners;
    const native = { provider: 'mock', model: 'mock', toolMode: 'native' };
    // mock 的 step 会调用 act：通过
    assert.equal((await mgr.prepare(native)).toolMode, 'native');
    assert.equal((await mgr.prepare({ ...native, toolMode: 'json' })).toolMode, 'json');
    assert.equal(Object.hasOwn(await mgr.prepare({ provider: 'mock', model: 'mock' }), 'toolMode'), false);
    // 拿不到工具调用：提供者连接成功（文本 JSON 通过），但 step 没有 act
    const calls = [];
    const stub = (step) => ({ complete: async () => ({ text: '{"actions":[]}' }), ...(step ? { step: async (req) => { calls.push(req); return step; } } : {}) });
    const real = mgr.provider.bind(mgr);
    mgr.provider = () => stub({ calls: [], text: '好的', stop: 'stop' });
    await assert.rejects(mgr.prepare(native), (e) => e instanceof RunnerError && e.message === '模型连接成功，但没有按要求调用工具；可以改用文本 JSON 方式。');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].tools.map((t) => t.name), ['act']);
    assert.equal(calls[0].tools[0].schema.required[0], 'actions');
    assert.ok(calls[0].transcript[0].role === 'user' && /act/.test(calls[0].transcript[0].text));
    // 调用了别的工具、没有 step、拒绝：同样报错
    mgr.provider = () => stub({ calls: [{ id: 'x', name: 'look', args: { what: 'here' } }], text: '', stop: 'tool_calls' });
    await assert.rejects(mgr.prepare(native), /没有按要求调用工具/);
    mgr.provider = () => stub(null);
    await assert.rejects(mgr.prepare(native), /没有按要求调用工具/);
    mgr.provider = () => stub({ calls: [{ id: 'y', name: 'act', args: { actions: [] } }], text: '', stop: 'tool_calls' });
    assert.equal((await mgr.prepare(native)).provider, 'mock', '调用了 act：通过');
    // json 方式不做工具测试
    calls.length = 0;
    mgr.provider = () => stub({ calls: [], text: '', stop: 'stop' });
    await mgr.prepare({ ...native, toolMode: 'json' });
    assert.equal(calls.length, 0);
    mgr.provider = real;
    // 设定 1 的世界：native 也不做工具测试（运行器不用工具循环）
    const m1 = p1.app.ctx.runners;
    calls.length = 0;
    m1.provider = () => stub({ calls: [], text: '', stop: 'stop' });
    assert.equal((await m1.prepare(native)).toolMode, 'native');
    assert.equal(calls.length, 0);
  } finally {
    await p2.close();
    await p1.close();
  }
});

test('P2 T12 托管：waitWake——语义同 GET /api/me/wait（先查收件箱，再等通知，到时返回空，不醒着时带 status）；不是第二前提时 404', async () => {
  const p2 = await boot({ physics: 2, premise: 2, shellSlots: 4, seed: 'ww-2' });
  const p1 = await boot({ physics: 2, premise: 1, shellSlots: 4, seed: 'ww-1' });
  try {
    const a = await p2.register('甲');
    const b = await p2.register('乙');
    const wait = p2.app.ctx.runners.waitWake(a.agentId);
    // 到时返回空
    const t0 = Date.now();
    assert.deepEqual(await wait({ after: 0, timeoutMs: 80 }), { ok: true, status: 200, json: { items: [], cursor: 0 } });
    assert.ok(Date.now() - t0 >= 60);
    // 等到通知
    const pending = wait({ after: 0, timeoutMs: 5000 });
    await sleepMs(30);
    await p2.call('/api/me/act', { method: 'POST', token: b.agentToken, body: { actions: [{ type: 'whisper', to: a.agentId, text: '托管的等待' }] } });
    const r = await pending;
    assert.equal(r.ok, true);
    assert.equal(r.json.items[0].text, '托管的等待');
    assert.equal(r.json.cursor, r.json.items[0].seq);
    // 已有的立即返回；after 在它之后则等到时
    assert.equal((await wait({ after: 0 })).json.items.length, 1);
    assert.equal((await wait({ after: r.json.cursor, timeoutMs: 30 })).json.items.length, 0);
    // 中止
    const ac = new AbortController();
    const aborted = wait({ after: r.json.cursor, timeoutMs: 20000, signal: ac.signal });
    await sleepMs(20);
    ac.abort();
    assert.deepEqual((await aborted).json, { items: [], cursor: r.json.cursor });
    // 不醒着
    p2.rt.w.agents[a.agentId].status = 'dormant';
    p2.rt.w.agents[a.agentId].dormantSinceDay = 0;
    assert.deepEqual((await wait({ after: 0 })).json, { items: [], cursor: 0, status: 'dormant' });
    // 设定 1 的世界与不存在的居民：404
    const x = await p1.register('丙');
    assert.deepEqual(await p1.app.ctx.runners.waitWake(x.agentId)({ after: 0, timeoutMs: 30 }), { ok: false, status: 404, json: null });
    assert.deepEqual(await p2.app.ctx.runners.waitWake('a999')({ after: 0, timeoutMs: 30 }), { ok: false, status: 404, json: null });
  } finally {
    await p2.close();
    await p1.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// 用量
// ═══════════════════════════════════════════════════════════════

test('P2 T12 用量：cancelled 的调用不记；waking 留在最近调用里（合法才留）；重启读回来时仍合法；没有 waking 的调用没有这一项', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p2-usage-'));
  try {
    const file = join(dir, 'u.json');
    let now = Date.parse('2026-10-05T04:00:00Z');
    const store = new UsageStore({ file, timezone: 'UTC', now: () => now });
    store.record('a1', { input: 100, output: 10 }, { ok: true, ms: 1200, waking: { tick: 7, kind: 'main', turn: 1 } }, 'm');
    store.record('a1', null, { ok: false, cancelled: true, ms: 500, waking: { tick: 7, kind: 'main', turn: 2 } }, 'm');
    store.record('a1', { input: 50, output: 5 }, { ok: true, ms: 800, waking: { tick: 7, kind: 'wake', turn: 1 } }, 'm');
    store.record('a1', null, { ok: false, error: { status: 429 }, ms: 90, waking: { tick: 8, kind: 'main', turn: 1 } }, 'm');
    store.record('a1', { input: 1, output: 1 }, { ok: true, ms: 10 }, 'm'); // 其他世界：没有 waking
    store.record('a1', { input: 1, output: 1 }, { ok: true, waking: { tick: -1, kind: 'main', turn: 1 } }, 'm'); // 不合法：丢掉标记，调用照记
    store.record('a1', { input: 1, output: 1 }, { ok: true, waking: { tick: 3, kind: 'sleep', turn: 1 } }, 'm');
    store.record('a1', { input: 1, output: 1 }, { ok: true, waking: { tick: 3, kind: 'main', turn: 0 } }, 'm');
    const v = store.view('a1');
    assert.equal(v.total.calls, 7, 'cancelled 的那一次没有记');
    assert.deepEqual([v.total.failed, v.total.input, v.total.output], [1, 154, 19]);
    assert.deepEqual(v.recent.map((c) => c.waking), [
      { tick: 7, kind: 'main', turn: 1 }, { tick: 7, kind: 'wake', turn: 1 }, { tick: 8, kind: 'main', turn: 1 }, undefined, undefined, undefined, undefined,
    ]);
    assert.ok(v.recent.slice(3).every((c) => !Object.hasOwn(c, 'waking')));
    assert.equal(v.recent[2].status, 429);
    // 落盘再读回来：合法的标记还在，不合法的（手工改坏的）被丢掉，调用仍在
    const raw = JSON.parse(JSON.stringify(store.agents));
    raw.a1.recent[0].waking = { tick: 'x', kind: 'main', turn: 1 };
    writeFileSync(file, JSON.stringify({ version: 1, agents: raw }));
    const again = new UsageStore({ file, timezone: 'UTC', now: () => now });
    const w = again.view('a1').recent.map((c) => c.waking);
    assert.equal(w[0], undefined);
    assert.deepEqual(w.slice(1, 3), [{ tick: 7, kind: 'wake', turn: 1 }, { tick: 8, kind: 'main', turn: 1 }]);
    now += 1000;
    assert.equal(again.view('a1').total.calls, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P2 T12 托管端到端（mock）：第二前提的托管居民主醒来、被叫醒各有用量（带 waking）与轨迹；用量里没有被截断的调用', async () => {
  const env = await boot({ physics: 2, premise: 2, shellSlots: 8, seed: 'managed-p2' });
  try {
    env.rt.agentLoop = { ...DEFAULT_AGENT_LOOP, marginSec: 0, debounceSec: 0, wakes: 2 };
    const traces = [];
    env.app.ctx.runners.traces = { append: (id, rec, model) => traces.push({ id, rec, model }) };
    const a = await env.register('甲', { model: 'mock', runner: { provider: 'mock', model: 'mock', historyRounds: 2, actEveryTicks: 1, toolMode: 'native' } });
    const b = await env.register('乙');
    const recent = () => env.app.ctx.runners.usage.view(a.agentId).recent;
    for (let i = 0; i < 300 && !recent().some((c) => c.waking?.kind === 'main'); i++) await sleepMs(10);
    assert.ok(recent().some((c) => c.waking?.kind === 'main'), '主醒来的调用有用量');
    for (let i = 0; i < 300 && traces.length < 1; i++) await sleepMs(10); // 轨迹在这次醒来结束时才写
    assert.ok(traces.length >= 1 && traces[0].rec.kind === 'main' && traces[0].rec.mode === 'native' && traces[0].model === 'mock' && traces[0].id === a.agentId);
    // 乙给甲私语：甲被叫醒
    const r = await env.call('/api/me/act', { method: 'POST', token: b.agentToken, body: { actions: [{ type: 'whisper', to: a.agentId, text: '喂，在吗' }] } });
    assert.equal(r.status, 200);
    for (let i = 0; i < 400 && !traces.some((t) => t.rec.kind === 'wake'); i++) await sleepMs(10);
    assert.ok(traces.some((t) => t.rec.kind === 'wake'), '被叫醒的轨迹');
    assert.ok(recent().some((c) => c.waking?.kind === 'wake' && c.waking.turn >= 1), '被叫醒的调用有用量，带 waking');
    assert.ok(recent().every((c) => c.ok && c.waking && Number.isInteger(c.waking.tick)));
    // 轨迹里没有文本
    assert.ok(!JSON.stringify(traces).includes('喂，在吗'));
    // 用量接口的最近调用带 waking
    const usage = await env.call('/api/owner/usage', { token: a.ownerKey });
    assert.equal(usage.status, 200);
    assert.ok(usage.json.recent.some((c) => c.waking && c.waking.kind === 'wake'));
  } finally {
    await env.close();
  }
});

test('P2 T12 托管：被刻点截断的调用（cancelled）不记进用量，也不算提供者的失败；线路自己的超时照常记为失败', async () => {
  const env = await boot({ physics: 2, premise: 2, shellSlots: 8, seed: 'managed-cancel' });
  try {
    env.rt.agentLoop = { ...DEFAULT_AGENT_LOOP, marginSec: 0, debounceSec: 0 };
    // 一个守超时的慢提供者：连接测试照常通过，其余的调用一直不回，到 timeoutMs 抛超时
    const seen = [];
    env.app.ctx.runners.provider = () => ({
      name: 'slow',
      complete: async (req) => {
        if (req.system.startsWith('Connection test')) return { text: '{"actions":[]}' };
        seen.push(req.timeoutMs);
        await sleepMs(req.timeoutMs);
        throw new ProviderError(`网络错误：timeout（${Math.round(req.timeoutMs / 1000)} 秒）`, { retryable: true, timeout: true });
      },
    });
    env.rt.nextTickAt = Date.now() + 1200; // 离下一刻只剩 1.2 秒：调用被刻点截断
    const a = await env.register('甲', { model: 'mock', runner: { provider: 'mock', model: 'mock', historyRounds: 2, actEveryTicks: 1 } });
    for (let i = 0; i < 300 && seen.length < 1; i++) await sleepMs(10);
    assert.ok(seen.length >= 1 && seen[0] <= 1200 && seen[0] >= 1000, `超时 ${seen[0]}`);
    await sleepMs(seen[0] + 300);
    assert.equal(env.app.ctx.runners.usage.has(a.agentId), false, '被截断的调用没有记');
    // 线路自己的超时（离下一刻还很久）：失败，照记
    env.rt.nextTickAt = Date.now() + 600000;
    await env.call('/api/owner/runner', { method: 'POST', token: a.ownerKey, body: { op: 'save', config: { provider: 'mock', model: 'mock', historyRounds: 2, actEveryTicks: 1, timeoutMs: 1000 } } });
    for (let i = 0; i < 400 && !env.app.ctx.runners.usage.has(a.agentId); i++) await sleepMs(10);
    const v = env.app.ctx.runners.usage.view(a.agentId);
    assert.ok(v.total.failed >= 1 && v.total.failed === v.total.calls, JSON.stringify(v.total));
  } finally {
    await env.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// 幕后的用量界面：按 waking.tick 分组
// ═══════════════════════════════════════════════════════════════

test('P2 T12 用量界面：最近的调用按 waking.tick 分组（同一刻的几轮归在一起、标出第几轮与被叫醒）；没有 waking 的仍是平的列表', async () => {
  const { installFakeDom } = await import('./fake-dom.js');
  const { recentList } = await import('../public/usage-ui.js');
  const { setLang, getLang } = await import('../public/i18n.js');
  const dom = installFakeDom();
  const saved = getLang();
  setLang('zh');
  try {
    const call = (n, extra = {}) => ({ at: `2026-10-05T04:00:0${n}.000Z`, ok: true, reported: true, input: 100 * n, output: 10, ms: 1000, model: 'm', ...extra });
    // 旧的在前（服务器给的顺序），显示时新的在前
    const recent = [
      call(1, { waking: { tick: 7, kind: 'main', turn: 1 } }), call(2, { waking: { tick: 7, kind: 'main', turn: 2 } }),
      call(3, { waking: { tick: 7, kind: 'wake', turn: 1 } }), call(4, { waking: { tick: 8, kind: 'main', turn: 1 } }),
    ];
    const list = recentList(recent);
    const groups = list.querySelectorAll('li.usage-tick');
    assert.equal(groups.length, 2);
    assert.ok(groups[0].textContent.startsWith('第 8 刻'), '新的一刻在前');
    assert.ok(groups[1].textContent.startsWith('第 7 刻'));
    const inner = (g) => g.querySelectorAll('ul li');
    assert.equal(inner(groups[0]).length, 1);
    assert.equal(inner(groups[1]).length, 3);
    // 同一刻里新的在前：被叫醒的那一轮最先，它带「被叫醒」；主醒来的第 2 轮、第 1 轮
    assert.match(inner(groups[1])[0].textContent, /第 1 轮 · 被叫醒/);
    assert.match(inner(groups[1])[1].textContent, /第 2 轮/);
    assert.ok(!/被叫醒/.test(inner(groups[1])[1].textContent));
    assert.match(inner(groups[1])[2].textContent, /第 1 轮/);
    // 没有 waking：平的列表，没有分组，也没有「第几轮」
    const flat = recentList([call(1), call(2)]);
    assert.equal(flat.querySelectorAll('li.usage-tick').length, 0);
    assert.equal(flat.querySelectorAll('li').length, 2);
    assert.ok(!/第 \d+ 轮/.test(flat.textContent));
    // 混合：没有 waking 的（旧记录）与有的并存，不丢任何一条
    const mixed = recentList([call(1), call(2, { waking: { tick: 9, kind: 'main', turn: 1 } }), call(3)]);
    assert.equal(mixed.querySelectorAll('li').length, 4, '三次调用 + 一个分组');
    // 英文
    setLang('en');
    const en = recentList([call(1, { waking: { tick: 7, kind: 'wake', turn: 2 } })]);
    assert.match(en.textContent, /Tick 7/);
    assert.match(en.textContent, /turn 2 · woken/);
  } finally {
    setLang(saved);
    dom.restore();
  }
});
