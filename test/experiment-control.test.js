import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from './http-helpers.js';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { ShellManager } from '../src/shells/manager.js';
import { ExperimentControl } from '../src/experiment-control.js';
import { replayDir } from '../src/tools/replay.js';

const mock = { provider: 'mock', model: 'mock' };
const control = (e, op) => e.call(`/api/admin/${op}`, { method: 'POST', admin: true, body: {} });

for (const config of [{ physics: 1 }, { physics: 2 }, { physics: 2, premise: 1 }, { physics: 2, premise: 2 }]) test(`实验暂停：允许人工操作、冻结行动与结算、重复操作幂等、可回放（physics ${config.physics}, premise ${config.premise ?? 0}）`, async () => {
  const e = await boot(config);
  try {
    const a = await e.register('原居民');
    assert.equal((await control(e, 'pause')).status, 200);
    const n = e.rt.w.commandN;
    assert.equal((await control(e, 'pause')).status, 200);
    assert.equal(e.rt.w.commandN, n);
    const b = await e.register('暂停期间入城', { runner: mock });
    assert.equal(b.runner.status, 'experiment_paused');
    assert.equal(e.app.ctx.runners.jobs.size, 0);
    assert.equal((await e.call('/api/port/model', { method: 'POST', body: mock })).status, 200);
    const saved = await e.call('/api/owner/runner', { method: 'POST', token: a.ownerKey, body: { op: 'save', config: mock, agentToken: a.agentToken } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.config.provider, 'mock');
    assert.equal((await e.call('/api/owner/runner', { method: 'POST', token: a.ownerKey, body: { op: 'start' } })).json.status, 'experiment_paused');
    assert.equal((await e.call('/api/owner/runner', { method: 'POST', token: a.ownerKey, body: { op: 'pause' } })).json.status, 'paused');
    assert.equal(e.app.ctx.runners.jobs.size, 0);
    assert.equal((await e.call('/api/owner/letter', { method: 'POST', token: a.ownerKey, body: { text: '暂停期间的家书' } })).status, 200);
    assert.equal((await e.call('/api/admin/adjust', { method: 'POST', admin: true, body: { agentId: a.agentId, energy: 1, reason: '人工调整' } })).status, 200);
    assert.equal((await e.call('/api/me/act', { method: 'POST', token: a.agentToken, body: { actions: [] } })).json.error.code, 'paused');
    assert.equal((await e.call('/api/admin/tick', { method: 'POST', admin: true, body: {} })).json.error.code, 'paused');
    assert.equal(e.rt.w.clock.tick, 0);
    const status = await e.call('/api/admin/experiment', { admin: true });
    assert.equal(status.json.state, 'paused');
    assert.equal(status.json.nextTickAt, null);
    assert.equal((await control(e, 'resume')).status, 200);
    await control(e, 'resume');
    assert.equal(e.rt.events.since(0, 100).filter((ev) => ev.type === 'admin' && ev.data.op === 'resume').length, 1);
    e.rt.snapshot();
    assert.equal(replayDir(e.rt.dir).ok, true);
  } finally { await e.close(); }
});

test('暂停轮次拒绝暂停前生成但恢复后到达的行动', async () => {
  const e = await boot();
  try {
    const a = await e.register('迟到行动');
    await control(e, 'pause');
    await control(e, 'resume');
    const n = e.rt.w.commandN;
    const stale = await e.call('/api/me/act', { method: 'POST', token: a.agentToken, body: { actions: [], experimentGeneration: 0 } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.code, 'stale_perception');
    assert.equal(e.rt.w.commandN, n);
    assert.equal((await e.call('/api/me/act', { method: 'POST', token: a.agentToken, body: { actions: [] } })).json.error.code, 'stale_perception');
    const p = await e.call('/api/me', { token: a.agentToken });
    assert.ok(p.json.now.experimentGeneration > 0);
    assert.equal((await e.call('/api/me/act', { method: 'POST', token: a.agentToken, body: { actions: [], experimentGeneration: p.json.now.experimentGeneration } })).status, 200);
  } finally { await e.close(); }
});

test('暂停后重启保持冻结，恢复遵循期间最新的运行器开关', async () => {
  let e = await boot(); const dir = e.dir;
  try {
    await control(e, 'pause');
    const yes = await e.register('恢复后运行', { runner: mock });
    const no = await e.register('恢复后停用', { runner: mock });
    await e.call('/api/owner/runner', { method: 'POST', token: no.ownerKey, body: { op: 'pause' } });
    await e.close({ keepDir: true });
    e = await boot({}, { dir });
    assert.equal(e.rt.w.paused, true);
    assert.equal(e.app.ctx.runners.jobs.size, 0);
    assert.equal(e.app.ctx.runners.view(yes.agentId).status, 'experiment_paused');
    assert.equal(e.app.ctx.runners.view(no.agentId).status, 'paused');
    await control(e, 'resume');
    assert.equal(e.app.ctx.runners.jobs.has(yes.agentId), true);
    assert.equal(e.app.ctx.runners.jobs.has(no.agentId), false);
  } finally { await e.close(); }
});

test('世界倒计时：暂停、重启、恢复均保留剩余时间，暂停期间不补刻', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const dir = mkdtempSync(join(tmpdir(), 'houren-clock-'));
  const cfg = { ...loadConfig({}, []), dataDir: dir, worldId: 'clock', seed: 'clock', tickMs: 10000 };
  let rt = Runtime.open(cfg, { logger: {} });
  try {
    rt.start();
    t.mock.timers.tick(7000);
    rt.exec('admin', { op: 'pause', args: { experiment: true } });
    assert.equal(rt.nextTickAt, null);
    assert.equal(rt.w.experimentControl.remainingMs, 3000);
    t.mock.timers.tick(100000);
    assert.equal(rt.w.clock.tick, 0);
    rt.close();
    rt = Runtime.open(cfg, { logger: {} });
    rt.start();
    assert.equal(rt.nextTickAt, null);
    rt.exec('admin', { op: 'resume' });
    assert.equal(rt.nextTickAt, Date.now() + 3000);
    t.mock.timers.tick(2999);
    assert.equal(rt.w.clock.tick, 0);
    t.mock.timers.tick(1);
    assert.equal(rt.w.clock.tick, 1);
    assert.equal(rt.nextTickAt, Date.now() + 10000);
  } finally { rt.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('管理员会话可控制实验，普通用户、跨站请求与缺少验证头的会话写入被拒绝', async () => {
  const e = await boot();
  try {
    const body = { username: 'operator', displayName: '管理员', password: 'long-enough-password', adminKey: e.cfg.adminKey };
    const setup = await e.call('/api/account/setup', { method: 'POST', body, headers: { 'X-Houren-Request': '1' } });
    const cookie = setup.headers.get('set-cookie').split(';')[0];
    assert.equal((await e.call('/api/admin/experiment', { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await e.call('/api/admin/pause', { method: 'POST', body: {}, headers: { Cookie: cookie } })).status, 403);
    assert.equal((await e.call('/api/admin/pause', { method: 'POST', body: {}, headers: { Cookie: cookie, 'X-Houren-Request': '1', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal(e.rt.w.paused, false);
    assert.equal((await e.call('/api/admin/pause', { method: 'POST', body: {}, headers: { Cookie: cookie, 'X-Houren-Request': '1' } })).status, 200);
    const normal = await e.call('/api/account/register', { method: 'POST', body: { username: 'normal', displayName: '普通用户', password: body.password }, headers: { 'X-Houren-Request': '1' } });
    const other = normal.headers.get('set-cookie').split(';')[0];
    assert.equal((await e.call('/api/admin/experiment', { headers: { Cookie: other } })).status, 403);
    assert.equal((await e.call('/api/admin/resume', { method: 'POST', body: {}, headers: { Cookie: other, 'X-Houren-Request': '1' } })).status, 403);
    assert.equal(e.rt.w.paused, true);
  } finally { await e.close(); }
});

const eventually = async (check) => {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Expected state was not reached');
};

for (const config of [{}, { physics: 2, premise: 2, toolMode: 'json' }, { physics: 2, premise: 2, toolMode: 'native' }]) test(`中止在途托管请求并拒绝迟到回复（premise ${config.premise ?? 0}, ${config.toolMode ?? 'json'}）`, async () => {
  const e = await boot(config);
  let finish, requestSignal;
  try {
    const a = await e.register('在途请求');
    const manager = e.app.ctx.runners;
    const pendingCall = ({ signal }) => { requestSignal = signal; return new Promise((resolve) => { finish = resolve; }); };
    manager.provider = async () => ({ complete: pendingCall, step: pendingCall });
    await manager.attach(a.agentId, a.agentToken, { ...mock, toolMode: config.toolMode, timeoutMs: 120000 }, true);
    await eventually(() => !!finish);
    const result = await control(e, 'pause');
    assert.equal(result.status, 200);
    assert.equal(requestSignal.aborted, true);
    assert.equal(manager.jobs.size, 0);
    assert.equal(manager.records[a.agentId].enabled, true);
    const n = e.rt.w.commandN;
    finish({ text: '{"thought":"迟到独白","actions":[{"type":"say","text":"迟到行动"}]}', stop: 'end' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(e.rt.w.commandN, n);
    assert.equal(e.rt.events.ownerEvents(a.agentId, 'thought').length, 0);
  } finally { await e.close(); }
});

test('并发暂停/恢复串行执行，排队操作执行前重新校验管理员权限', async () => {
  const e = await boot();
  try {
    const x = e.app.ctx.experiment;
    const results = await Promise.all([x.setPaused(true), x.setPaused(false), x.setPaused(true)]);
    assert.deepEqual(results.map((r) => r.paused), [true, false, true]);
    assert.equal(x.view().state, 'paused');
    await assert.rejects(x.setPaused(false, () => { throw new Error('revoked'); }), /revoked/);
    assert.equal(e.rt.w.paused, true);
    assert.equal(e.rt.events.since(0, 100).filter((ev) => ev.type === 'admin').length, 3);
  } finally { await e.close(); }
});

test('躯壳实验暂停释放预算与排队名额，保留独立暂停开关和线路错误', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-exp-shells-'));
  const foundersFile = join(dir, 'founders.json');
  writeFileSync(foundersFile, JSON.stringify(Array.from({ length: 3 }, (_, i) => ({ day: 0, name: `实验先民${i}`, soul: '先民灵魂', bio: '', lang: 'zh' }))));
  const cfg = { ...loadConfig({}, []), dataDir: dir, worldId: 'shells', physics: 2, seed: 'shells', foundersFile, tickMs: 10000 };
  const rt = Runtime.open(cfg, { logger: {} });
  const requests = [];
  const shells = new ShellManager(rt, cfg, { logger: {}, config: { tokensPerDay: 100000000, timezone: 'UTC', reserve: 0, concurrency: 1, historyRounds: 0, lines: [{ model: 'mock', provider: 'mock', maxTokens: 64 }] }, providerFactory: async () => ({ complete: ({ signal }) => new Promise((resolve) => { requests.push({ signal, resolve }); }) }) });
  const runners = { jobs: new Map(), suspendExperiment: async () => {}, resumeExperiment() {} };
  const x = new ExperimentControl(rt, runners, shells);
  try {
    rt.exec('admin', { op: 'shell_models', args: { models: ['mock'] } });
    rt.tickNow(); // founders enter the city
    shells.activate();
    await eventually(() => requests.length === 1 && shells.slots.waiters.length > 0);
    assert.ok(shells.budget.reserved > 0);
    await x.setPaused(true);
    assert.equal(shells.drivers.size, 0);
    assert.equal(shells.slots.active, 0);
    assert.equal(shells.slots.waiters.length, 0);
    assert.equal(shells.budget.reserved, 0);
    assert.equal(shells.paused, false);
    shells.lines.get('mock').status = 'error';
    await x.setPaused(false);
    assert.equal(shells.drivers.size, 0, 'experiment resume does not reset line errors');
    await shells.pause();
    await x.setPaused(true);
    await x.setPaused(false);
    assert.equal(shells.paused, true);
    assert.equal(shells.drivers.size, 0);
    requests[0].resolve({ text: '{"actions":[]}', stop: 'end' });
  } finally { x.close(); await shells.close(); rt.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('崩溃恢复：快照后的暂停命令日志可重建剩余倒计时', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 200000 });
  const dir = mkdtempSync(join(tmpdir(), 'houren-exp-crash-'));
  const cfg = { ...loadConfig({}, []), dataDir: dir, worldId: 'crash', seed: 'crash', tickMs: 10000 };
  let rt = Runtime.open(cfg, { logger: {} });
  try {
    rt.start();
    t.mock.timers.tick(8000);
    rt.snapshot = () => {}; // crash before the post-pause snapshot is written
    rt.exec('admin', { op: 'pause', args: { experiment: true } });
    rt.close();
    rt = Runtime.open(cfg, { logger: {} });
    assert.equal(rt.remainingMs, 2000);
    rt.start();
    rt.exec('admin', { op: 'resume' });
    assert.equal(rt.nextTickAt, Date.now() + 2000);
    t.mock.timers.tick(2000);
    assert.equal(rt.w.clock.tick, 1);
  } finally { rt.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('恢复任务失败时重新冻结实验，修复后可以重试恢复', async () => {
  const e = await boot();
  try {
    const x = e.app.ctx.experiment;
    await x.setPaused(true);
    const original = e.app.ctx.runners.resumeExperiment.bind(e.app.ctx.runners);
    e.app.ctx.runners.resumeExperiment = () => { throw new Error('temporary startup failure'); };
    await assert.rejects(x.setPaused(false), /temporary startup failure/);
    assert.equal(e.rt.w.paused, true);
    assert.equal(x.view().state, 'paused');
    assert.equal(e.app.ctx.runners.jobs.size, 0);
    e.app.ctx.runners.resumeExperiment = original;
    await x.setPaused(false);
    assert.equal(x.view().state, 'running');
  } finally { await e.close(); }
});

test('program fault freezes hosted control; session-authenticated recovery probes without retrying', async () => {
  const { registerCommand } = await import('../src/e2/engine/index.js');
  const e = await boot({ physics: 2, premise: 2 });
  try {
    const setup = await e.call('/api/account/setup', { method: 'POST', body: { username: 'faultadmin', displayName: '管理员', password: 'long-enough-password', adminKey: e.cfg.adminKey }, headers: { 'X-Houren-Request': '1' } });
    const cookie = setup.headers.get('set-cookie').split(';')[0];
    registerCommand('http_fault_test', w => { w.vars.secret = 1; throw new Error('private-command-data'); });
    e.rt.exec('http_fault_test', { tokenHash: 'private-hash', thought: 'private-thought' });
    await e.app.ctx.experiment.pending;
    const status = await e.call('/api/admin/experiment', { headers: { Cookie: cookie } });
    assert.equal(status.json.lawProtection.code, 'engine_exception');
    assert.equal(status.json.state, 'paused');
    assert.doesNotMatch(JSON.stringify(status.json), /private-hash|private-thought|private-command-data/);
    await assert.rejects(e.app.ctx.experiment.setPaused(false));
    const ordinary = await control(e, 'resume');
    assert.equal(ordinary.status, 503);
    assert.equal(ordinary.json.error.reason, 'law_execution_fault');
    assert.equal((await e.call('/api/admin/law-recover', { method: 'POST', body: {}, headers: { Cookie: cookie } })).status, 403);
    assert.equal((await e.call('/api/admin/law-recover', { method: 'POST', body: {}, headers: { Cookie: cookie, 'X-Houren-Request': '1', 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    registerCommand('http_fault_test', w => { w.vars.secret = 2; return { ok: false, error: { code: 'not_found' } }; });
    const recovered = await e.call('/api/admin/law-recover', { method: 'POST', body: {}, headers: { Cookie: cookie, 'X-Houren-Request': '1' } });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.json.probe, 'business_failure');
    assert.equal(e.rt.w.vars.secret, undefined);
    assert.equal(e.app.ctx.experiment.state, 'running');
  } finally { await e.close(); }
});
