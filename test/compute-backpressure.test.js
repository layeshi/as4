import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { boot } from './http-helpers.js';
import { managedClient } from '../src/runner/managed-client.js';
import { busy } from '../src/compute/online.js';
import { cleanRecord } from '../src/runner/traces.js';
import { commandAuthority } from '../src/compute/authority.js';

async function setup(t, deps = {}, valid = () => true, signal) {
  const e = await boot({ physics: 2, premise: 7, map: 'island-three-v1', shellSlots: 0,
    hiddenPhysicsFile: fileURLToPath(new URL('./fixtures/p7-hidden-physics.json', import.meta.url)) });
  t.after(async () => { await e.rt.closeAsync(); await e.close(); });
  const id = e.rt.exec('account', { op: 'create', accountId: 'backpressure-account', requestId: 'backpressure-resident',
    name: '退避居民', soul: '测试', model: 'mock', lang: 'zh', dailyCap: 5000000, city: 'north' }).result.agentId;
  await e.rt.enableCompute({ readers: { freemem: () => 1024 * 1024 * 1024 } });
  const client = managedClient(e.app.ctx, id, valid, signal, { wait: async () => {}, ...deps });
  await client.me();
  return { ...e, id, client };
}

test('managed busy wake, look and act retry without duplicate billing and keep one action identity', async t => {
  const e = await setup(t), submit = e.rt.submit.bind(e.rt), attempts = new Map(), n = e.rt.log.n;
  e.rt.submit = async (type, payload, opts) => {
    const key = type === 'act' ? 'act' : payload.op;
    const seen = attempts.get(key) || []; seen.push(structuredClone(payload)); attempts.set(key, seen);
    if (seen.length === 1) throw busy();
    return submit(type, payload, opts);
  };
  const wake = await e.client.wake({ kind: 'main' });
  assert.equal(wake.status, 200);
  const look = await e.client.look({ wakeId: wake.json.wakeId, what: 'self', turn: 1 });
  assert.equal(look.status, 200);
  const act = await e.client.act({ wakeId: wake.json.wakeId, turn: 1, actions: [{ type: 'say', text: '仅一次。' }] });
  assert.equal(act.status, 200);
  for (const key of ['wake', 'look', 'act']) assert.equal(attempts.get(key).length, 2);
  assert.equal(attempts.get('act')[0].requestId, attempts.get('act')[1].requestId);
  assert.deepEqual(attempts.get('act')[0], attempts.get('act')[1]);
  assert.equal(e.rt.log.n, n + 3);
  assert.equal(e.app.ctx.wakings.get(e.id).requests, 2);
});

test('managed busy retries have a fixed attempt bound and a retry-start deadline', async t => {
  let now = 0, attempts = 0, waits = 0;
  const e = await setup(t, { now: () => now, wait: async () => { waits++; } }), n = e.rt.log.n;
  e.rt.submit = async () => { attempts++; throw busy(); };
  assert.equal((await e.client.wake({ kind: 'main' })).status, 503);
  assert.equal(attempts, 4); assert.equal(waits, 3); assert.equal(e.rt.log.n, n);
  const client = managedClient(e.app.ctx, e.id, () => true, undefined,
    { now: () => now, wait: async () => { now += 120000; } });
  attempts = 0;
  assert.equal((await client.wake({ kind: 'main' })).status, 503);
  assert.equal(attempts, 1); assert.equal(e.rt.log.n, n);
});

test('managed batch admission retries an actual expired FIFO entry after the admitted waking finishes', async t => {
  const e = await setup(t);
  const id = (await e.rt.submit('account', { op: 'create', accountId: 'backpressure-account-2', requestId: 'backpressure-resident-2',
    name: '排队居民', soul: '测试', model: 'mock', lang: 'zh', dailyCap: 5000000, city: 'west' })).result.agentId;
  let release, entered, retries = 0;
  const held = new Promise(resolve => { release = resolve; });
  const preparing = new Promise(resolve => { entered = resolve; });
  t.after(() => { release(); t.mock.timers.reset(); });
  const call = e.rt.compute.call.bind(e.rt.compute), n = e.rt.log.n;
  e.rt.compute.call = async (op, cmd) => { const value = await call(op, cmd); if (op === 'prepare') { entered(); await held; } return value; };
  const first = e.client.wake({ kind: 'main' }); await preparing;
  const client = managedClient(e.app.ctx, id, () => true, undefined, { wait: async () => { retries++; release(); t.mock.timers.reset(); } });
  await client.me();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const second = client.wake({ kind: 'main' });
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(30000);
  assert.equal((await second).status, 200); assert.equal((await first).status, 200);
  assert.equal(retries, 1); assert.equal(e.rt.log.n, n + 2);
  assert.equal(e.app.ctx.wakings.size, 2);
});

test('managed backoff stops on revocation, abort and tick change without late charging', async t => {
  for (const change of ['revocation', 'abort', 'tick']) await t.test(change, async t => {
    let allowed = true, attempts = 0;
    const ac = new AbortController();
    const e = await setup(t, { wait: async () => {
      if (change === 'revocation') allowed = false;
      if (change === 'abort') ac.abort();
      if (change === 'tick') await submit('tick');
    } }, () => allowed, ac.signal);
    const submit = e.rt.submit.bind(e.rt), n = e.rt.log.n;
    e.rt.submit = async () => { attempts++; throw busy(); };
    const response = await e.client.wake({ kind: 'main' });
    assert.equal(response.status, change === 'tick' ? 503 : 401);
    assert.equal(attempts, 1); assert.equal(e.rt.log.n, n + (change === 'tick' ? 1 : 0));
    assert.equal(e.app.ctx.wakings.has(e.id), false);
  });
});

test('managed waking rejects a stale perception before admission', async t => {
  const e = await setup(t);
  await e.rt.submit('tick');
  const n = e.rt.log.n;
  assert.equal((await e.client.wake({ kind: 'main' })).json.error.code, 'compute_busy');
  assert.equal(e.rt.log.n, n); assert.equal(e.app.ctx.wakings.has(e.id), false);
  await e.client.me();
  assert.equal((await e.client.wake({ kind: 'main' })).status, 200);
});

test('managed authority is rechecked before appending a prepared command', async t => {
  let allowed = true;
  const e = await setup(t, {}, () => allowed), call = e.rt.compute.call.bind(e.rt.compute), n = e.rt.log.n;
  e.rt.compute.call = async (op, cmd) => { const result = await call(op, cmd); if (op === 'prepare') allowed = false; return result; };
  assert.equal((await e.client.wake({ kind: 'main' })).status, 401);
  assert.equal(e.rt.log.n, n); assert.equal(e.app.ctx.wakings.has(e.id), false);
});

test('managed committed success remains successful after the retry window and tick boundary', async t => {
  let now = 0;
  const e = await setup(t, { now: () => now }), submit = e.rt.submit.bind(e.rt), n = e.rt.log.n;
  e.rt.submit = async (...args) => { const result = await submit(...args); now += 120001; await commandAuthority.run(undefined, () => submit('tick')); return result; };
  assert.equal((await e.client.wake({ kind: 'main' })).status, 200);
  assert.equal(e.rt.log.n, n + 2);
});

test('managed retries exclude quota, business and ordinary execution errors', async t => {
  const e = await setup(t), submit = e.rt.submit.bind(e.rt);
  await submit('cap', { agentId: e.id, cap: 1 });
  let attempts = 0;
  e.rt.submit = (...args) => { attempts++; return submit(...args); };
  assert.equal((await e.client.wake({ kind: 'main' })).status, 402);
  assert.equal(attempts, 1);
  e.rt.submit = async () => { attempts++; throw new Error('execution failed'); };
  await assert.rejects(e.client.wake({ kind: 'main' }), /execution failed/);
  assert.equal(attempts, 2);
});

test('compute busy is a recognized token waking trace ending', () => {
  assert.equal(cleanRecord({ ended: 'compute_busy' }, 7).ended, 'compute_busy');
});
