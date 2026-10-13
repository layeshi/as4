import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/server.js';
import { managedClient } from '../src/runner/managed-client.js';
import { runnerConfig } from '../src/runner/manager.js';
import { runAgent } from '../runner/agent.js';
import { createProvider } from '../runner/providers.js';
import { P } from '../src/e2/params.js';
import { earthDayKey } from '../src/http/tokens.js';
import { stateHash } from '../src/store.js';

const silent = { info() {}, warn() {}, error() {} };
const mock = runnerConfig({ provider: 'mock', toolMode: 'native', actionTools: 'typed' });
const hiddenPhysics = { version: 1, regrowth: { baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 }, thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 }, factorPermille: 500 }, construction: { fullActionsPerTick: 2, factorPermille: 500 } };
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'heirs-next-wake-')), file = join(dir, 'physics.json');
  writeFileSync(file, JSON.stringify(hiddenPhysics));
  const cfg = { ...loadConfig({}, []), dataDir: dir, worldId: 'w', seed: 'wake', physics: 2, premise: 6, map: 'compact-materials-v1', shellSlots: 0, hiddenPhysicsFile: file };
  const rt = Runtime.open(cfg, { logger: {} }), app = createApp(rt, cfg, { logger: {} }), ctx = app.ctx;
  t.after(async () => { await app.close(); rt.close(); rmSync(dir, { recursive: true, force: true }); });
  // Exercise the real HTTP dispatcher and account middleware without binding a socket.
  async function call(path, cookie, body) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method: body === undefined ? 'GET' : 'POST', url: path, socket: { remoteAddress: '127.0.0.1' }, headers: { cookie, 'content-type': 'application/json', 'x-houren-request': '1' } });
    const headers = new Map(), result = {};
    const res = { setHeader: (k,v) => headers.set(k,v), getHeader: k => headers.get(k), writeHead: status => { result.status = status; return res; }, end: text => { result.json = JSON.parse(text); } };
    await app.server.listeners('request')[0](req, res);
    return result;
  }
  const user = await ctx.accounts.create({ username: 'alice', password: 'test-password-1234' });
  const cookie = `houren_session=${ctx.accounts.issue(user.id)}`;
  const created = await call('/api/account/residents', cookie, { name: '作息居民', soul: '观察城市', lang: 'zh', dailyCap: 1000000, requestId: 'wake-create' });
  assert.equal(created.status, 201);
  const id = created.json.agentId, path = `/api/account/residents/${id}`;
  return { rt, ctx, id, user, cookie, call, path, a: () => rt.w.agents[id], get: async () => {
    const r = await call(path, cookie); assert.equal(r.status, 200); return r.json.overview.nextWake;
  } };
}
async function drive(e, { every = 1, actEveryTicks = 1, rounds = 5, cap, script, premise } = {}) {
  Object.assign(e.a().routine, { every, called: false });
  if (cap !== undefined) e.a().tokens.cap = cap;
  if (premise !== undefined) e.rt.w.premise = premise;
  const reports = [], traces = [];
  await runAgent({ ...mock, lang: 'zh', actEveryTicks }, {
    client: managedClient(e.ctx, e.id, () => true), provider: await createProvider({ provider: 'mock', script: script ?? Array.from({ length: rounds }, () => ({ calls: [{ name: 'done', args: {} }] })) }),
    log: silent, maxRounds: rounds, waitWake: false, wait: async () => e.rt.tickNow(),
    onState: event => { if (Object.hasOwn(event, 'nextWakeTick')) reports.push(event); }, onWaking: (_id, rec) => traces.push(rec),
  });
  return { reports, traces };
}
for (const [every, actEveryTicks, expected] of [[1,1,[1,2,3,4,5]], [3,1,[3,3,3,6,6]], [1,4,[4,4,4,4,8]], [0,4,[null,null,null,null,null]]]) {
  test(`P6 runner reports cadence every=${every}, actEveryTicks=${actEveryTicks}`, async t => {
    const e = await setup(t), out = await drive(e, { every, actEveryTicks });
    assert.deepEqual(out.reports.map(r => r.nextWakeTick), expected);
    assert.ok(out.reports.every(r => r.wakeEvery === (every ? Math.max(every, actEveryTicks) : 0)));
    assert.deepEqual(out.traces.map(r => r.tick), every === 0 ? [] : every === 3 ? [0,3] : actEveryTicks === 4 ? [0,4] : [0,1,2,3,4]);
  });
}
test('P6 refused main wakings still report the next scheduled tick', async t => {
  const e = await setup(t), out = await drive(e, { every: 3, cap: 0 });
  assert.deepEqual(out.reports.map(r => r.nextWakeTick), [3,3,3,6,6]);
  assert.ok(out.traces.every(r => r.refused === 'cap_reached'));
});
test('P6 reports the routine changed during the main waking; earlier premises emit no schedule', async t => {
  const e = await setup(t);
  const out = await drive(e, { rounds: 1, script: [{ calls: [{ name: 'routine', args: { every: 0 } }] }, { calls: [{ name: 'done', args: {} }] }] });
  assert.deepEqual(out.reports, [{ wakeEvery: 0, nextWakeTick: null }]);
  const legacy = await drive(e, { rounds: 1, premise: 4 });
  assert.deepEqual(legacy.reports, []);
});
async function start(e, config = mock) {
  await e.ctx.runners.attachManaged(e.id, e.user.id, config);
  e.ctx.runners.activate('http://127.0.0.1'); // P6 uses only the process-local client.
  e.ctx.runners.start(e.id);
  for (let n = 0; n < 200; n++) {
    if (e.ctx.runners.view(e.id).nextWakeTick !== undefined) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('runner did not report its schedule');
}
test('P6 owner GET exposes estimated tick/time and managed-only compact schedule; outsiders get 403', async t => {
  const e = await setup(t);
  e.a().routine.every = 3;
  e.rt.nextTickAt = Date.now() + P.tickMs;
  await start(e, { ...mock, actEveryTicks: 5 });
  const hash = stateHash(e.rt.w), commands = readFileSync(join(e.rt.dir, 'commands.jsonl'), 'utf8');
  const wake = await e.get();
  assert.deepEqual(wake, { state: 'scheduled', tick: 5, at: e.rt.nextTickAt + 4 * P.tickMs, every: 5, called: true, day: 1, tickOfDay: 6, blockedBy: [] });
  const list = await e.call('/api/account/residents', e.cookie);
  assert.deepEqual(list.json.managed[0].nextWake, { state: 'scheduled', tick: 5, at: wake.at, called: true, blockedBy: [] });
  assert.equal(Object.hasOwn(list.json.created[0], 'nextWake'), false);
  const bob = await e.ctx.accounts.create({ username: 'bobby', password: 'test-password-1234' });
  const cookie = `houren_session=${e.ctx.accounts.issue(bob.id)}`;
  assert.equal((await e.call(e.path, cookie)).status, 403);
  assert.equal(stateHash(e.rt.w), hash);
  assert.equal(readFileSync(join(e.rt.dir, 'commands.jsonl'), 'utf8'), commands);
  // A creator who no longer manages the resident gets no schedule, either.
  e.rt.w.access.residents[e.id].managerAccountId = bob.id;
  const creator = await e.call(e.path, e.cookie);
  assert.equal(creator.json.publicOnly, true);
  assert.equal(Object.hasOwn(creator.json, 'overview'), false);
  assert.equal(Object.hasOwn((await e.call('/api/account/residents', e.cookie)).json.created[0], 'nextWake'), false);
});
test('P6 owner GET distinguishes unconfigured, paused, experiment paused, dormant, dead and retired', async t => {
  const e = await setup(t);
  assert.deepEqual(await e.get(), { state: 'unconfigured' });
  await start(e);
  await e.ctx.runners.pause(e.id);
  assert.deepEqual(await e.get(), { state: 'paused' });
  e.rt.w.paused = true;
  assert.deepEqual(await e.get(), { state: 'experiment_paused' });
  e.rt.w.paused = false;
  for (const state of ['dormant','dead','retired']) {
    e.a().status = state;
    assert.deepEqual(await e.get(), { state });
  }
});
test('P6 stale schedule is ignored for stopped/error runners and reset before a new run reports', async t => {
  const e = await setup(t);
  await start(e);
  await e.ctx.runners.stop(e.id);
  assert.deepEqual(await e.get(), { state: 'stopped' });
  e.ctx.runners.states.get(e.id).status = 'error';
  assert.deepEqual(await e.get(), { state: 'error' });
  const provider = await createProvider({ provider: 'mock' });
  let release;
  e.ctx.runners.provider = () => new Promise(resolve => { release = () => resolve(provider); });
  e.ctx.runners.start(e.id);
  try {
    assert.deepEqual(await e.get(), { state: 'unknown' });
    assert.equal(e.ctx.runners.view(e.id).nextWakeTick, undefined);
  } finally { release(); await e.ctx.runners.pause(e.id); }
});
test('P6 off distinguishes calls enabled/disabled, regardless of the owner interval', async t => {
  const e = await setup(t);
  e.a().routine.every = 0;
  await start(e, { ...mock, actEveryTicks: 10 });
  assert.deepEqual(await e.get(), { state: 'off', called: true });
  e.a().routine.called = false;
  assert.deepEqual(await e.get(), { state: 'off', called: false });
});
test('P6 overdue schedule clamps to the next tick and absent clock has no estimated time', async t => {
  const e = await setup(t);
  await start(e);
  e.rt.w.clock.tick = P.ticksPerDay - 1;
  e.rt.nextTickAt = Date.now() + 1000;
  const wake = await e.get();
  assert.equal(wake.tick, P.ticksPerDay);
  assert.equal(wake.day, 2); assert.equal(wake.tickOfDay, 1);
  assert.equal(wake.at, e.rt.nextTickAt);
  e.rt.nextTickAt = null;
  assert.equal((await e.get()).at, null);
});
test('P6 cap/token blockers retain the schedule, respect the real day and accept runner refusal status', async t => {
  const e = await setup(t);
  await start(e);
  const original = await e.get(), a = e.a();
  a.tokens.day = earthDayKey(e.ctx); a.tokens.used = a.tokens.cap;
  assert.deepEqual((await e.get()).blockedBy, ['cap_reached']);
  a.tokens.day = '2000-01-01';
  assert.deepEqual((await e.get()).blockedBy, []);
  a.energy = 0; a.basic = 0;
  assert.deepEqual((await e.get()).blockedBy, ['tokens_exhausted']);
  a.basic = 1000;
  assert.deepEqual((await e.get()).blockedBy, []);
  for (const status of ['cap_reached','tokens_exhausted']) {
    e.ctx.runners.states.get(e.id).status = status;
    const wake = await e.get();
    assert.equal(wake.state, 'scheduled'); assert.equal(wake.tick, original.tick);
    assert.deepEqual(wake.blockedBy, [status]);
  }
});
