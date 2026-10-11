import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, genesisOpts } from '../src/e2/world.js';
import { applyCommand } from '../src/e2/engine/index.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
import { stateHash } from '../src/store.js';
import { sha } from './e2-helpers.js';
const hiddenPhysics = {
  version: 1,
  regrowth: {
    baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 },
    thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 },
    factorPermille: 500,
  },
  construction: { fullActionsPerTick: 2, factorPermille: 500 },
};
test('P5 acceptance: 20 residents, 30 days, real commands, zero model calls, conservation and deterministic replay', (t) => {
  const w = createWorld({
      seed: 'p5-thirty-days',
      premise: 5,
      lawSemanticsVersion: 2,
      tokens: { capacity: 6000, basic: 4000 },
      hiddenPhysics,
    }),
    commands = [];
  const command = (type, payload = {}) => {
    const cmd = { type, payload: structuredClone(payload) };
    commands.push(cmd);
    const out = applyCommand(w, cmd);
    assert.equal(w.paused, false, JSON.stringify(out));
    const ledger = checkConservation(w);
    assert.equal(
      ledger.ok,
      true,
      `${type} ${commands.length} ${JSON.stringify(ledger)}`
    );
    return out.result;
  };
  const ids = [];
  for (let i = 0; i < 20; i++) {
    const name = `居民${String.fromCharCode(0x7532 + i)}`;
    const r = command('register', {
      name,
      soul: '记录世界中的真实变化',
      lang: 'zh',
      model: 'mock',
      tokenHash: sha(`token${i}`),
      ownerKeyHash: sha(`owner${i}`),
      dailyCap: 50000000,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    ids.push(r.agentId);
    command('admin', {
      op: 'adjust',
      args: {
        agentId: r.agentId,
        energy: 100000,
        reason: 'mock initial budget',
      },
    });
  }
  let req = 0;
  const act = (id, actions) => {
    const wakeId = `sim-${++req}`;
    assert.equal(
      command('meter', {
        op: 'wake',
        agentId: id,
        wakeId,
        day: '2026-10-11',
        kind: 'main',
        system: 0,
        brief: 0,
        delivered: 0,
      }).ok,
      true
    );
    return command('act', {
      agentId: id,
      requestId: wakeId,
      experimentGeneration: 0,
      actions,
      meter: { wakeId, day: '2026-10-11', reread: 0 },
    });
  };
  act(ids[0], [
    { type: 'move', to: 'wilds' },
    { type: 'gather' },
    { type: 'gather' },
    { type: 'move', to: 'library' },
  ]);
  command('tick');
  let r = act(ids[0], [
    {
      type: 'initiate',
      build: 'site',
      lot: 'lot-01',
      name: '公共观察室',
      owner: 'city',
    },
  ]);
  assert.equal(r.results[0].ok, true, JSON.stringify(r));
  const project = r.results[0].data.project;
  r = act(ids[0], [
    {
      type: 'contribute',
      project,
      energy: w.projects[project].need,
      materials: 20,
    },
  ]);
  assert.equal(r.results[0].ok, true, JSON.stringify(r));
  command('tick');
  act(
    ids[0],
    Array.from({ length: 4 }, () => ({ type: 'construct', project }))
  );
  assert.equal(w.projects[project].status, 'built');
  const zones = ['wilds', 'scrapyard', 'solarfield'],
    targets = [
      'well',
      'port',
      'library',
      'market',
      'workshop',
      'school',
      'parliament',
      'cemetery',
      'tenements',
      'temple',
    ];
  let repairs = 0,
    gathered = 0,
    expired = 0;
  for (let day = 0; day < 30; day++) {
    while (w.clock.tick < (day + 1) * 12) command('tick');
    for (let i = 0; i < ids.length; i++) {
      const actions = [
        { type: 'move', to: zones[(day + i) % 3] },
        { type: 'gather' },
        { type: 'move', to: targets[i % targets.length] },
        { type: 'repair', energy: 1000, materials: 5 },
      ];
      const out = act(ids[i], actions);
      for (const r of out.results ?? [])
        if (r.ok) {
          if (r.type === 'repair') repairs += r.data.bp;
          if (r.type === 'gather') gathered += r.data.materials;
        }
    }
    command('tick');
    const o = act(ids[1], [
      {
        type: 'demand_publish',
        title: '记录日常',
        description: '新作品',
        price: 5,
        criterion: { kind: 'document' },
        waitTicks: 1,
      },
    ]);
    assert.equal(o.results[0].ok, true, JSON.stringify(o));
    command('tick');
    assert.equal(w.orders[o.results[0].data.order].status, 'expired');
    expired++;
  }
  assert.ok(repairs > 10000);
  assert.ok(gathered > 300);
  assert.equal(expired, 30);
  assert.equal(w.ledger.mismatches, 0);
  assert.ok(
    w.observations.every((o) => o.day >= Math.floor(w.clock.tick / 12) - 24)
  );
  const replay = createWorld(genesisOpts(w));
  for (const c of commands) applyCommand(replay, c);
  assert.equal(stateHash(replay), stateHash(w));
  t.diagnostic(
    JSON.stringify({
      residents: 20,
      days: 30,
      commands: commands.length,
      gathered,
      repairedBp: repairs,
      expiredOrders: expired,
      regenerated: w.materialLedger.regenerated,
      lost: w.materialLedger.lost,
      hash: stateHash(w),
    })
  );
});
