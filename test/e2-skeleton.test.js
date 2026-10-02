// SPEC-E2 §25 第 1 步：门面与分派、第二纪的骨架。
// 两代引擎共用同一个运行时、HTTP 层与回放工具，按世界的 physics 分派。

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import v1 from '../src/engine/facade.js';
import e2 from '../src/e2/facade.js';
import { ENGINES, engineOf, engineForPhysics, createWorldFromSnapshot } from '../src/engines.js';
import { Runtime } from '../src/runtime.js';
import { createApp } from '../src/http/server.js';
import { loadConfig, applyConfig, DEFAULT_PHYSICS } from '../src/config.js';
import { replayDir } from '../src/tools/replay.js';
import { stateHash, worldDir, readSnapshot, commandsPath } from '../src/store.js';
import { createWorld as createWorldV2, genesisOpts } from '../src/e2/world.js';
import { shellsFree } from '../src/e2/engine/shells.js';
import { P as P1 } from '../src/params.js';
import { P as P2, WEATHER_CODES as WEATHER_CODES2, SEASON_TABLE as SEASON2 } from '../src/e2/params.js';
import { WEATHER_CODES as WEATHER_CODES1, SEASON_TABLE as SEASON1 } from '../src/params.js';
import { boot } from './http-helpers.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'houren-e2-'));
const cfgFor = (dataDir, extra = {}) => ({ ...loadConfig({}, []), dataDir, worldId: 'w', seed: 'e2-seed', physics: 2, ...extra });

// ── 门面与分派 ───────────────────────────────────────────────

test('门面：两代引擎的形状相同；physics / protocol 各自为 1 与 2', () => {
  assert.equal(v1.physics, 1);
  assert.equal(v1.protocol, 1);
  assert.equal(e2.physics, 2);
  assert.equal(e2.protocol, 2);
  assert.deepEqual(Object.keys(e2).filter((k) => !(k in v1)), ['genesisOpts']); // 第二纪多一个回放用的函数，其余成员两代一致
  for (const k of Object.keys(v1)) assert.ok(k in e2, `v2 的门面缺少 ${k}`);
  for (const k of ['createWorld', 'applyCommand', 'drainEvents', 'buildPerception', 'inboxView', 'publicState', 'publicAgent', 'publicMemories',
    'publicPlace', 'publicDoc', 'publicWeather', 'publicEvent', 'ownerEvent', 'publicMap', 'publicLaw', 'researchMetrics', 'tickSummary',
    'checkConservation', 'configure']) {
    assert.equal(typeof v1[k], 'function', `v1.${k}`);
    assert.equal(typeof e2[k], 'function', `v2.${k}`);
  }
  assert.equal(v1.publicLaw({}, 'l1'), null); // 第一纪没有 /api/public/laws/:id
  assert.ok(Object.isFrozen(v1) && Object.isFrozen(e2));
});

test('分派：physics 为 2 的世界用 v2，没有这个字段（或为 1）的用 v1；不认识的版本报错', () => {
  assert.equal(engineOf({}), v1);
  assert.equal(engineOf({ physics: 1 }), v1);
  assert.equal(engineOf({ physics: 2 }), e2);
  assert.equal(engineOf(null), v1);
  assert.equal(engineForPhysics(1), v1);
  assert.equal(engineForPhysics(2), e2);
  assert.throws(() => engineForPhysics(3), /unknown physics/);
  assert.deepEqual(Object.keys(ENGINES), ['1', '2']);
});

test('两代引擎的天象表与季节表一致（SPEC-E2 §5.1：不变）；时间参数的初值一致', () => {
  assert.deepEqual(WEATHER_CODES2, WEATHER_CODES1);
  assert.deepEqual([...SEASON2], [...SEASON1]);
  for (const k of ['ticksPerDay', 'daysPerMonth', 'monthsPerEpoch', 'tickMs', 'privateDelayTicks', 'maxActionsPerTick', 'metabolismBase']) {
    assert.equal(P2[k], P1[k], k);
  }
});

// ── 空的第二纪世界 ───────────────────────────────────────────

test('第二纪的世界可以创建、序列化并推进刻；同一种子逐位相同', () => {
  const mk = (seed = 's1') => createWorldV2({ id: 't', seed, codeVersion: '0.1.0' });
  const w = mk();
  assert.equal(w.physics, 2);
  assert.equal(w.version, 2);
  assert.equal(w.epoch, 2);
  assert.equal(w.map, 'frontier');
  assert.deepEqual(w.shells, { slots: 30, models: [] });
  assert.deepEqual(w.founders, []);
  assert.deepEqual(JSON.parse(JSON.stringify(w)), w, '序列化往返后深度相等');
  assert.equal(JSON.stringify(mk('a')), JSON.stringify(mk('a')));
  assert.notEqual(JSON.stringify(mk('a')), JSON.stringify(mk('b')));
  assert.throws(() => createWorldV2({}), /seed/);
  assert.throws(() => createWorldV2({ seed: 'x', map: 'classic' }), /frontier/);

  const r = e2.applyCommand(w, { type: 'tick' });
  assert.deepEqual(r.result, { ok: true, tick: 1, day: 0, settled: false });
  for (let i = 0; i < P2.ticksPerDay - 1; i++) e2.applyCommand(w, { type: 'tick' });
  assert.equal(w.clock.tick, P2.ticksPerDay);
  assert.deepEqual(e2.drainEvents(w), [], 'applyCommand 已取走本命令的事件，暂存区应为空');
  assert.equal(w.commandN, P2.ticksPerDay);
  assert.equal(e2.checkConservation(w).ok, true);
});

test('第二纪：每日结算产生 day 事件；暂停时 tick 返回 paused；未知命令返回 invalid_request；纪元结束时暂停并记 great_sleep', () => {
  const w = createWorldV2({ seed: 's', codeVersion: '0.1.0' });
  let events = [];
  for (let i = 0; i < P2.ticksPerDay; i++) events.push(...e2.applyCommand(w, { type: 'tick' }).events);
  const day = events.find((e) => e.type === 'day');
  assert.ok(day);
  assert.equal(day.data.day, 0);
  assert.equal(day.day, 0, '日终结算的事件记在刚结束的那一日');
  assert.deepEqual(day.data.population, { awake: 0, dormant: 0, dead: 0, retired: 0 });
  assert.equal(e2.applyCommand(w, { type: 'admin', payload: { op: 'pause' } }).result.paused, true);
  assert.equal(e2.applyCommand(w, { type: 'tick' }).result.error.code, 'paused');
  assert.equal(e2.applyCommand(w, { type: 'admin', payload: { op: 'resume' } }).result.paused, false);
  assert.equal(e2.applyCommand(w, { type: 'nope' }).result.error.code, 'invalid_request');
  assert.equal(e2.applyCommand(w, { type: 'admin', payload: { op: 'nope' } }).result.error.field, 'op');

  // 纪元结束
  const short = createWorldV2({ seed: 's' });
  const epochTicks = P2.ticksPerDay * P2.daysPerMonth * P2.monthsPerEpoch;
  let last;
  for (let i = 0; i < epochTicks; i++) last = e2.applyCommand(short, { type: 'tick' });
  assert.equal(short.paused, true);
  assert.ok(last.events.some((e) => e.type === 'great_sleep'));
  assert.equal(short.ledger.mismatches, 0);
});

test('第二纪：回放用的创建参数（先民名单、躯壳模型）原样记在 genesis，快照足以还原初始世界', () => {
  const founders = [
    { day: 8, name: '乙', bio: '', soul: 's2', lang: 'zh' },
    { day: 0, name: '甲', bio: '', soul: 's1', lang: 'zh' },
    { day: 8, name: '丙', bio: '', soul: 's3', lang: 'en' },
  ];
  const w = createWorldV2({ seed: 'g', founders, shellModels: ['glm-5.3', 'step-5-preview'], sandboxShells: true });
  assert.deepEqual(w.founders.map((f) => f.name), ['甲', '乙', '丙'], '按 day 再按文件顺序排序');
  assert.deepEqual(w.genesis.founders.map((f) => f.name), ['甲', '乙', '丙']);
  assert.deepEqual(w.shells.models, ['glm-5.3', 'step-5-preview']);
  const snap = JSON.parse(JSON.stringify(w));
  w.founders.shift(); // 先民入城后 w.founders 会减少
  const w2 = createWorldFromSnapshot(JSON.parse(JSON.stringify({ ...snap, founders: w.founders })));
  assert.equal(stateHash(w2), stateHash(createWorldV2({ seed: 'g', founders, shellModels: ['glm-5.3', 'step-5-preview'], sandboxShells: true })));
  assert.deepEqual(genesisOpts(snap).founders.map((f) => f.name), ['甲', '乙', '丙']);
  assert.equal(genesisOpts(snap).sandboxShells, true);
  assert.equal(snap.sandboxShells, true);
});

test('第二纪：躯壳名额（SHELL_SLOTS，Q26）在创建时写入 w.shells.slots 与 genesis，快照足以还原，不依赖环境', () => {
  const founders = [{ day: 0, name: '甲', bio: '', soul: 's1', lang: 'zh' }, { day: 8, name: '乙', bio: '', soul: 's2', lang: 'en' }];
  const fresh = () => createWorldV2({ seed: 's', founders, shellModels: ['glm-5.3'], shellSlots: 10 });
  const w = fresh();
  assert.equal(w.shells.slots, 10);
  assert.equal(w.genesis.shellSlots, 10);
  assert.equal(shellsFree(w), 8, '先民预先占着名额');
  const snap = JSON.parse(JSON.stringify(w));
  assert.equal(genesisOpts(snap).shellSlots, 10);
  assert.equal(stateHash(createWorldFromSnapshot(snap)), stateHash(fresh()), '快照足以还原初始世界');
  // 缺省仍取 P.shellSlots，也记进 genesis
  const dflt = createWorldV2({ seed: 's' });
  assert.deepEqual([dflt.shells.slots, dflt.genesis.shellSlots], [P2.shellSlots, P2.shellSlots]);
  // 早期的快照没有 genesis.shellSlots：回放时缺省取 P.shellSlots，与当时的创建一致
  const old = JSON.parse(JSON.stringify(dflt));
  delete old.genesis.shellSlots;
  assert.equal(genesisOpts(old).shellSlots, undefined);
  assert.equal(createWorldFromSnapshot(old).shells.slots, P2.shellSlots);
  for (const bad of [-1, 1.5, '10', NaN, null]) assert.throws(() => createWorldV2({ seed: 's', shellSlots: bad }), /shellSlots/);
});

// ── 运行时：快照、崩溃恢复、回放 ──────────────────────────────

test('运行时：physics 为 2 时创建第二纪的世界，快照写入 physics，重新打开时按快照选择引擎（与 cfg.physics 无关）', () => {
  const dir = tmp();
  try {
    const rt = Runtime.open(cfgFor(dir), { version: '0.1.0', logger: {} });
    assert.equal(rt.engine, e2);
    assert.equal(rt.w.physics, 2);
    for (let i = 0; i < 30; i++) rt.exec('tick');
    rt.close();
    const snap = readSnapshot(worldDir(dir, 'w'));
    assert.equal(snap.physics, 2);
    assert.equal(snap.clock.tick, 30);
    // cfg.physics 只在创建新世界时生效：把它改成 1，已有的第二纪世界仍由 v2 打开
    const rt2 = Runtime.open(cfgFor(dir, { physics: 1 }), { version: '0.1.0', logger: {} });
    assert.equal(rt2.engine, e2);
    assert.equal(rt2.w.clock.tick, 30);
    assert.equal(stateHash(rt2.w), stateHash(snap));
    // SSE 的 tick 摘要由引擎生成，第二纪另带 shells
    const summary = rt2.tickSummary();
    assert.deepEqual(Object.keys(summary), ['tick', 'day', 'nextTickAt', 'agents', 'treasury', 'well', 'shells']);
    assert.deepEqual(summary.shells, { free: 30, total: 30 });
    rt2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('运行时：cfg.physics 未指定（null）时按第一纪创建；physics: 1 同；已有的第一纪世界仍由 v1 打开', () => {
  for (const physics of [null, undefined, 1]) {
    const dir = tmp();
    try {
      const rt = Runtime.open({ ...loadConfig({}, []), dataDir: dir, worldId: 'w', seed: 'v1-seed', physics }, { version: '0.1.0', logger: {} });
      assert.equal(rt.engine, v1);
      assert.equal('physics' in rt.w, false, '第一纪的世界没有 physics 字段');
      rt.close();
      const again = Runtime.open({ ...loadConfig({}, []), dataDir: dir, worldId: 'w', physics: 2 }, { version: '0.1.0', logger: {} });
      assert.equal(again.engine, v1, '已有的世界按快照，不按配置');
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('运行时：崩溃恢复——快照之后的命令由 v2 引擎回放；回放工具对第二纪的世界输出 OK', () => {
  const dir = tmp();
  try {
    const rt = Runtime.open(cfgFor(dir), { version: '0.1.0', logger: {} });
    for (let i = 0; i < 40; i++) rt.exec('tick'); // 第 12、24、36 刻各结算一日并写快照
    const before = stateHash(rt.w);
    // 不调用 close()：模拟崩溃；快照停在第 36 刻，日志里多出 4 条命令
    const snap = readSnapshot(worldDir(dir, 'w'));
    assert.equal(snap.clock.tick, 36);
    const rt2 = Runtime.open(cfgFor(dir), { version: '0.1.0', logger: { log() {} } });
    assert.equal(rt2.w.clock.tick, 40);
    assert.equal(stateHash(rt2.w), before);
    rt2.close();
    const r = replayDir(worldDir(dir, 'w'), { currentVersion: '0.1.0' });
    assert.equal(r.ok, true, r.diff || '');
    assert.equal(r.applied, 40);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('运行时：先民文件与躯壳配置只在创建第二纪的新世界时读取，进入世界状态与 genesis；回放能还原', () => {
  const dir = tmp();
  try {
    const foundersFile = join(dir, 'founders.json');
    const shellsFile = join(dir, 'shells.json');
    writeFileSync(foundersFile, JSON.stringify([{ day: 0, name: '试灯', bio: '', soul: '你说话很慢。', lang: 'zh' }, { day: 8, name: 'Wren', bio: '', soul: 'You walk.', lang: 'en' }]));
    writeFileSync(shellsFile, JSON.stringify({ lines: [{ model: 'glm-5.3' }, { model: 'step-5-preview' }] }));
    const rt = Runtime.open(cfgFor(dir, { foundersFile, shellsFile, sandboxAgents: 0 }), { version: '0.1.0', logger: {} });
    assert.deepEqual(rt.w.founders.map((f) => f.name), ['试灯', 'Wren']);
    assert.deepEqual(rt.w.shells.models, ['glm-5.3', 'step-5-preview']);
    for (let i = 0; i < 25; i++) rt.exec('tick');
    assert.deepEqual(rt.w.founders.map((f) => f.name), ['Wren'], '第 0 日的先民已经入城（第 8 步），第 8 日的还在等');
    assert.equal(Object.values(rt.w.agents).filter((a) => a.name === '试灯').length, 1);
    rt.close();
    const r = replayDir(worldDir(dir, 'w'), { currentVersion: '0.1.0' });
    assert.equal(r.ok, true, r.diff || '');
    // 文件之后被改动或删除，不影响已创建的世界
    rmSync(foundersFile);
    const again = Runtime.open(cfgFor(dir, { foundersFile, shellsFile }), { version: '0.1.0', logger: {} });
    assert.deepEqual(again.w.founders.map((f) => f.name), ['Wren']);
    assert.deepEqual(again.w.genesis.founders.map((f) => f.name), ['试灯', 'Wren'], 'genesis 里存着创建时的全部名单');
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('运行时：SHELL_SLOTS 只在创建第二纪的新世界时生效，之后以世界里记的为准；先民多于名额时警告；回放一致', () => {
  const dir = tmp();
  try {
    const warns = [];
    const logger = { warn: (m) => warns.push(m) };
    const foundersFile = join(dir, 'f.json');
    writeFileSync(foundersFile, JSON.stringify([{ day: 0, name: '甲', bio: '', soul: 's', lang: 'zh' }, { day: 0, name: '乙', bio: '', soul: 's', lang: 'zh' }]));
    const rt = Runtime.open(cfgFor(dir, { foundersFile, shellSlots: 1 }), { version: '0.1.0', logger });
    assert.equal(rt.w.shells.slots, 1);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /先民 2 位多于躯壳名额 1/);
    for (let i = 0; i < 3; i++) rt.exec('tick');
    rt.close();
    const again = Runtime.open(cfgFor(dir, { foundersFile, shellSlots: 5 }), { version: '0.1.0', logger });
    assert.equal(again.w.shells.slots, 1, '已有的世界以快照为准');
    assert.equal(warns.length, 1, '只在创建时警告');
    again.close();
    const r = replayDir(worldDir(dir, 'w'), { currentVersion: '0.1.0' });
    assert.equal(r.ok, true, r.diff || '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 配置 ─────────────────────────────────────────────────────

test('配置：SHELL_SLOTS 缺省 null，给定时必须是非负整数', () => {
  assert.equal(loadConfig({}, []).shellSlots, null);
  assert.equal(loadConfig({ SHELL_SLOTS: '10' }, []).shellSlots, 10);
  assert.equal(loadConfig({ SHELL_SLOTS: '0' }, []).shellSlots, 0);
  for (const bad of ['-1', '2.5']) assert.throws(() => loadConfig({ SHELL_SLOTS: bad }, []), /SHELL_SLOTS/);
  assert.throws(() => loadConfig({ SHELL_SLOTS: 'x' }, []), /不是数字/);
});

test('配置：PHYSICS / FOUNDERS_FILE / SHELLS_FILE / SHELL_TOKENS_PER_DAY / SHELL_TZ；服务器入口缺省第二纪，其余调用方缺省 null', () => {
  const c = loadConfig({}, []);
  assert.equal(c.physics, null);
  assert.equal(loadConfig({}, [], { defaultPhysics: DEFAULT_PHYSICS }).physics, 2);
  assert.equal(DEFAULT_PHYSICS, 2);
  assert.equal(loadConfig({ PHYSICS: '1' }, [], { defaultPhysics: 2 }).physics, 1, '显式的环境变量优先');
  assert.equal(loadConfig({ PHYSICS: '2' }, []).physics, 2);
  assert.throws(() => loadConfig({ PHYSICS: '3' }, []), /PHYSICS/);
  assert.throws(() => loadConfig({ PHYSICS: 'x' }, []), /不是数字/);
  assert.throws(() => loadConfig({ PHYSICS: '2', MAP: 'classic' }, []), /frontier/, 'PHYSICS=2 且 MAP=classic 时启动报错');
  assert.equal(loadConfig({ PHYSICS: '1', MAP: 'classic' }, []).map, 'classic');
  const f = loadConfig({ FOUNDERS_FILE: 'f.json', SHELLS_FILE: 's.json', SHELL_TOKENS_PER_DAY: '1000', SHELL_TZ: 'UTC' }, []);
  assert.deepEqual([f.foundersFile, f.shellsFile, f.shellTokensPerDay, f.shellTz], ['f.json', 's.json', 1000, 'UTC']);
  assert.deepEqual([c.foundersFile, c.shellsFile, c.shellTokensPerDay, c.shellTz], [null, null, null, null]);
  assert.throws(() => loadConfig({ SHELL_TOKENS_PER_DAY: '0' }, []), /SHELL_TOKENS_PER_DAY/);
  assert.throws(() => loadConfig({ SHELL_TOKENS_PER_DAY: '1.5' }, []), /SHELL_TOKENS_PER_DAY/);
});

test('配置：时间参数同时应用到两代引擎的参数对象', () => {
  const saved1 = { ...P1 };
  const saved2 = { ...P2 };
  try {
    applyConfig({ ...loadConfig({ TICKS_PER_DAY: '6', DAYS_PER_MONTH: '10', MONTHS_PER_EPOCH: '3', TICK_MS: '50', PRIVATE_DELAY_TICKS: '24' }, []) });
    for (const P of [P1, P2]) {
      assert.deepEqual([P.ticksPerDay, P.daysPerMonth, P.monthsPerEpoch, P.tickMs, P.privateDelayTicks], [6, 10, 3, 50, 24]);
    }
  } finally {
    Object.assign(P1, saved1);
    Object.assign(P2, saved2);
    applyConfig(loadConfig({}, []));
  }
});

// ── HTTP：协议头随世界的物理 ──────────────────────────────────

test('HTTP：第二纪的城所有 JSON 响应带 X-Houren-Protocol: 2；公共概览带 world.physics / world.protocol；SSE 与错误响应同', async () => {
  const env = await boot({ physics: 2 });
  try {
    assert.equal(env.rt.engine, e2);
    const state = await env.call('/api/public/state');
    assert.equal(state.status, 200);
    assert.equal(state.headers.get('x-houren-protocol'), '2');
    assert.equal(state.json.world.physics, 2);
    assert.equal(state.json.world.protocol, 2);
    const unknown = await env.call('/api/nope');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers.get('x-houren-protocol'), '2');
    const noAuth = await env.call('/api/me');
    assert.equal(noAuth.status, 401);
    assert.equal(noAuth.headers.get('x-houren-protocol'), '2');
    const stream = await fetch(`${env.base}/api/public/stream`);
    assert.equal(stream.headers.get('x-houren-protocol'), '2');
    await stream.body.cancel();
    // 静态文件没有这个头（与第一纪相同）
    const page = await env.call('/');
    assert.equal(page.headers.get('x-houren-protocol'), null);
    // 第二纪的 laws 接口：遗法 l1 存在；不存在的法律是 404
    assert.equal((await env.call('/api/public/laws/l1')).status, 200);
    assert.equal((await env.call('/api/public/laws/l999')).status, 404);
  } finally {
    await env.close();
  }
});

test('HTTP：第一纪的城仍说协议 1，/api/public/laws/:id 不存在（404）', async () => {
  const env = await boot();
  try {
    assert.equal(env.rt.engine, v1);
    const state = await env.call('/api/public/state');
    assert.equal(state.headers.get('x-houren-protocol'), '1');
    assert.equal(state.json.world.protocol, 1);
    assert.equal('physics' in state.json.world, false);
    assert.equal((await env.call('/api/public/laws/l1')).status, 404);
  } finally {
    await env.close();
  }
});

test('HTTP：管理接口在第二纪的城里可用（tick、pause、resume、curtain、research）', async () => {
  const env = await boot({ physics: 2 });
  try {
    const t = await env.call('/api/admin/tick', { method: 'POST', admin: true });
    assert.equal(t.status, 200);
    assert.deepEqual([t.json.tick, t.json.day, t.json.settled], [1, 0, false]);
    assert.equal((await env.call('/api/admin/pause', { method: 'POST', admin: true })).json.paused, true);
    assert.equal((await env.call('/api/admin/tick', { method: 'POST', admin: true })).status, 503);
    assert.equal((await env.call('/api/admin/resume', { method: 'POST', admin: true })).json.paused, false);
    const r = await env.call('/api/admin/research', { admin: true });
    assert.deepEqual(r.json, { livingAgents: 0, families: {}, modelFamilyEntropy: 0 });
    assert.equal(env.rt.w.commandN, 4); // tick、pause、tick（暂停中，仍进日志）、resume
    assert.equal(readFileSync(commandsPath(worldDir(env.dir, 'w')), 'utf8').trim().split('\n').length, 4);
  } finally {
    await env.close();
  }
});

test('HTTP：createApp 不依赖具体引擎——两代的城都能创建应用并关闭', async () => {
  for (const physics of [1, 2]) {
    const dir = tmp();
    try {
      const cfg = { ...loadConfig({}, []), dataDir: dir, worldId: 'w', seed: 'x', physics, trustProxy: true };
      const rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
      const app = createApp(rt, cfg, { logger: {} });
      assert.equal(app.ctx.rt.engine.physics, physics);
      await app.close();
      rt.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
