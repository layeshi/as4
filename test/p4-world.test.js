import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import e2, { tokenized } from '../src/e2/facade.js';
import { loadConfig } from '../src/config.js';
import { Runtime } from '../src/runtime.js';
import { K, ep } from '../src/e2/engine/tokens.js';
import { P } from '../src/e2/params.js';
import { applyRepair, damageWellByDraw } from '../src/e2/engine/environment.js';
import { agentCap } from '../src/e2/engine/economy.js';
import { sharesFor } from '../src/e2/engine/actions/descent.js';

test('P4 T2: configuration, empty city, genesis round trip and P4-only state', () => {
  const cfg = loadConfig({ PHYSICS: '2', PREMISE: '4' }, []);
  assert.equal(cfg.tokenCapacity, 1100000);
  assert.equal(cfg.tokenBasic, 18000);
  const w = e2.createWorld({ seed: 'p4', premise: 4 });
  assert.equal(tokenized(w), true);
  assert.deepEqual(w.tokens, { capacity: 1100000, k: 1833, basic: 18000 });
  assert.deepEqual(w.well.upgrades, []);
  assert.equal(w.well.supply, 1000);
  assert.equal(w.shells.slots, 0);
  assert.deepEqual(e2.createWorld(e2.genesisOpts(w)), w);
  for (const premise of [0, 1, 2]) {
    const old = e2.createWorld({ seed: 'p4', premise });
    assert.equal(K(old), 1);
    for (const key of ['capAgent', 'lawFloor', 'birthCost', 'standingUpkeep']) assert.equal(ep(old, key), P[key]);
    assert.equal(Object.hasOwn(old, 'tokens'), false);
    assert.equal(Object.hasOwn(old.dayLog, 'p4'), false);
    assert.equal(Object.hasOwn(old.well, 'supply'), false);
  }
});

test('review C1: token inputs are validated only for new P4 worlds; snapshots retain their genesis', () => {
  for (const premise of [0, 1, 2, 4]) {
    const dir = mkdtempSync(join(tmpdir(), 'p4-config-compat-'));
    const env = { PHYSICS: '2', PREMISE: String(premise), DATA_DIR: dir, WORLD_ID: 'w', SHELL_SLOTS: '0' };
    try {
      const rt = Runtime.open(loadConfig(env, []), { logger: {} });
      const tokens = rt.w.tokens && { ...rt.w.tokens };
      rt.close();
      for (const value of ['0', '-1', '1.5', 'invalid', 'Infinity', '9007199254740992']) {
        const cfg = loadConfig({ ...env, TOKEN_CAPACITY: value, TOKEN_BASIC: value }, []);
        const restored = Runtime.open(cfg, { logger: {} });
        assert.deepEqual(restored.w.tokens, tokens);
        restored.close();
        const fresh = { ...cfg, worldId: `new-${value}` };
        if (premise === 4) {
          assert.throws(() => Runtime.open(fresh), /正整数/);
          assert.equal(existsSync(join(dir, fresh.worldId, 'snapshot.json')), false);
        } else {
          const old = Runtime.open(fresh, { logger: {} });
          assert.equal(old.w.tokens, undefined);
          old.close();
        }
      }
      if (premise === 4) {
        for (const key of ['TOKEN_CAPACITY', 'TOKEN_BASIC']) {
          const cfg = loadConfig({ ...env, WORLD_ID: key, [key]: 'invalid' }, []);
          assert.throws(() => Runtime.open(cfg), /正整数/);
        }
        const custom = Runtime.open(loadConfig({ ...env, WORLD_ID: 'custom', TOKEN_CAPACITY: '6000', TOKEN_BASIC: '4000' }, []));
        assert.equal(custom.w.tokens.capacity, 6000);
        assert.equal(custom.w.tokens.basic, 4000);
        custom.close();
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('P4 T2: runtime rejects forbidden genesis inputs before saving a world', () => {
  for (const extra of [{ shellSlots: 1 }, { foundersFile: '/not-read' }, { sandboxAgents: 1 }, { tokenBasic: 3999 }]) {
    const dir = mkdtempSync(join(tmpdir(), 'p4-genesis-'));
    try {
      const cfg = { ...loadConfig({ PHYSICS: '2', PREMISE: '4' }, []), worldId: 'w', dataDir: dir, seed: 'p4', ...extra };
      assert.throws(() => Runtime.open(cfg), /PREMISE=4|TOKEN_BASIC/);
      assert.equal(existsSync(join(dir, 'w', 'snapshot.json')), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('P4 T3: reserves, pool, caps, birth shares, draw damage and repair use world K', () => {
  const old = e2.createWorld({ seed: 'scale', premise: 2, shellSlots: 0 });
  const w = e2.createWorld({ seed: 'scale', premise: 4, tokens: { capacity: 6000, basic: 4000 } });
  assert.equal(K(w), 10);
  for (const id of Object.keys(w.places)) {
    assert.equal(w.places[id].salvage, old.places[id].salvage * 10);
    assert.equal(w.places[id].salvageMax, old.places[id].salvageMax * 10);
  }
  for (const id of Object.keys(w.regions)) assert.equal(w.regions[id].energy, old.regions[id].energy * 10);
  const map = e2.publicMap(w);
  for (const place of map.places.filter(p => p.wild)) assert.equal(place.wild.energyMax, w.regions[place.id].energy);
  assert.equal(w.well.drawPoolLeft, 600);
  assert.equal(agentCap(w, { id: 'a1' }), 1200);
  assert.deepEqual(sharesFor(3, w), { each: 133, initiator: 134 });
  damageWellByDraw(w, 10);
  assert.equal(w.places.well.condition, 9980);
  assert.equal(applyRepair(w, w.places.well, 'well', 'well', 29).spent, 20);
  assert.equal(w.places.well.condition, 10000);
});

import { cityHandlers } from '../src/e2/engine/actions/city.js';
import { makeCtx } from '../src/e2/engine/actions/util.js';
import { MODULE_DEFS } from '../src/e2/params.js';
import { addToProject } from '../src/e2/engine/projects.js';
import { holdings } from '../src/e2/engine/ledger.js';
test('P4 T3: module construction scales its funding target and salvaged materials once', () => {
  const w = e2.createWorld({ seed: 'modules', premise: 4, tokens: { capacity: 6000 } });
  const a = { id: 'a1', place: 'school', groups: [], energy: 10000 };
  const ctx = makeCtx(w, a, 0, 'initiate');
  const plan = cityHandlers.initiate.validate(ctx, { build: 'module', module: 'store' });
  assert.equal(plan.need, MODULE_DEFS.store.cost * 10);
  const j = { id: 'j1', place: a.place, build: 'module', module: 'store', have: 0, need: plan.need, contributors: {}, owner: { kind: 'city' }, initiator: a.id };
  w.projects[j.id] = j;
  addToProject(w, j, 'treasury', plan.need);
  assert.equal(w.places.school.modules.find(m => m.type === 'store').salvage, Math.floor(MODULE_DEFS.store.cost * 10 / 2));
  assert.equal(holdings(w).energy, 0);
});
