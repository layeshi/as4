import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { boot } from './http-helpers.js';
import { replayDir } from '../src/tools/replay.js';
import { stateHash } from '../src/store.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
const physics = {
  version: 1,
  regrowth: {
    baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 },
    thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 },
    factorPermille: 500,
  },
  construction: { fullActionsPerTick: 2, factorPermille: 500 },
};
test('P5 HTTP paid discovery, typed actions, retry receipts, public isolation and restart/replay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'as4-p5-http-')),
    config = join(dir, 'physics.json');
  writeFileSync(config, JSON.stringify(physics));
  let env = await boot(
    {
      physics: 2,
      premise: 5,
      map: 'compact-materials-v1',
      shellSlots: 0,
      hiddenPhysicsFile: config,
      tokenCapacity: 6000,
      tokenBasic: 500000,
    },
    { dir }
  );
  try {
    const r = await env.register('甲', { dailyCap: 5000000 }),
      a = env.rt.w.agents[r.agentId];
    env.rt.exec('admin', {
      op: 'adjust',
      args: { agentId: a.id, energy: 100000, reason: 'mock fixture' },
    });
    const post = (path, body) =>
      env.call(path, { method: 'POST', token: r.agentToken, body });
    const woke = await post('/api/me/wake', {
      kind: 'main',
      actionTools: 'typed',
    });
    assert.equal(woke.status, 200, woke.text);
    assert.match(woke.json.system, /demand_publish/);
    const wakeId = woke.json.wakeId;
    const read = await post('/api/me/look', {
      wakeId,
      what: 'materials',
      limit: 1,
    });
    assert.equal(read.status, 200, read.text);
    assert.ok(read.json.bill.read > woke.json.bill.read);
    assert.ok(!read.text.includes('hiddenPhysics'));
    const action = {
      type: 'demand_publish',
      title: '交付文章',
      description: '本人新作',
      price: 100,
      criterion: { kind: 'document' },
    };
    const body = {
      requestId: 'idempotent-demand',
      experimentGeneration: 0,
      wakeId,
      actionTools: 'typed',
      actions: [action],
    };
    const first = await post('/api/me/act', body);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.results[0].ok, true, first.text);
    const beforeRead = stateHash(env.rt.w);
    const filtered = await env.call(`/api/public/orders?agent=${a.id}&status=open&kind=document&limit=1`);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.json.length, 1);
    assert.equal(filtered.json[0].requester, a.id);
    const unmatched = await env.call('/api/public/orders?status=completed&kind=document');
    assert.deepEqual(unmatched.json, []);
    assert.equal(stateHash(env.rt.w), beforeRead, '公开筛选不改变世界状态或居民账目');
    const before = stateHash(env.rt.w);
    const again = await post('/api/me/act', body);
    assert.deepEqual(again.json, first.json);
    assert.equal(stateHash(env.rt.w), before);
    const conflict = await post('/api/me/act', {
      ...body,
      actions: [{ ...action, price: 101 }],
    });
    assert.equal(conflict.status, 409, conflict.text);
    for (const what of [
      'materials',
      'services',
      'demands',
      'orders',
      'research',
      'observations',
    ]) {
      const out = await env.call(`/api/public/${what}`);
      assert.equal(out.status, 200, out.text);
      assert.ok(!out.text.includes('thresholdByZone'));
    }
    for (let i = 0; i < 25 * 12; i++) env.rt.exec('tick');
    const archive = await env.call('/api/public/observations?limit=2');
    assert.equal(archive.status, 200, archive.text);
    assert.equal(archive.json[0].dayClosed, 0);
    assert.equal(archive.json.length, 2);
    const page = await env.call(
      `/api/public/observations?limit=2&after=${archive.json.at(-1).id}`
    );
    assert.notEqual(page.json[0].id, archive.json[0].id);
    assert.equal(checkConservation(env.rt.w).ok, true);
    const expected = stateHash(env.rt.w);
    env.rt.snapshot();
    const cfg = env.cfg;
    await env.close({ keepDir: true });
    env = null;
    const replay = replayDir(join(dir, 'w'));
    assert.equal(replay.ok, true, JSON.stringify(replay));
    const { Runtime } = await import('../src/runtime.js');
    const rt = Runtime.open(
      { ...cfg, hiddenPhysicsFile: null },
      { version: '0.1.0', logger: {} }
    );
    assert.equal(stateHash(rt.w), expected);
    rt.close();
  } finally {
    if (env) await env.close({ keepDir: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
