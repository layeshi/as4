import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/e2/world.js';
import { makeAgent } from '../src/e2/engine/lifecycle.js';
import { runActions } from '../src/e2/engine/actions.js';
import { source } from '../src/e2/engine/ledger.js';

function setup(condition = 8720) {
  const w = createWorld({ seed: 'repair-feedback', premise: 6, lawSemanticsVersion: 2,
    tokens: { capacity: 6000, basic: 4000 }, hiddenPhysics: { version: 1,
      regrowth: { baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 }, thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 }, factorPermille: 500 },
      construction: { fullActionsPerTick: 2, factorPermille: 500 } } });
  const a = makeAgent(w, { name: '修缮者', lang: 'zh', soul: '观察', kind: 'external', energy: 1000000, coins: 0, place: 'well' });
  source(w, 'energy', 'admin', a.energy); a.tokens.cap = 1000000;
  w.places.well.condition = condition;
  w.materialZones.scrapyard.stock -= 5; a.materials = 5;
  return { w, a };
}
for (const [args, code] of [
  [{ energy: 50000, materials: 0 }, 'insufficient_materials'],
  [{ energy: 0, materials: 5 }, 'insufficient_energy'],
  [{ energy: 9, materials: 5 }, 'insufficient_energy'],
]) test(`damaged repair reports the limiting input: ${JSON.stringify(args)}`, () => {
  const { w, a } = setup();
  const r = runActions(w, a, [{ type: 'repair', ...args }])[0];
  assert.equal(r.ok, false); assert.equal(r.error.code, code);
  assert.equal(w.places.well.condition, 8720);
});
test('fully repaired targets still return already', () => {
  const { w, a } = setup(10000);
  assert.equal(runActions(w, a, [{ type: 'repair', energy: 50000, materials: 0 }])[0].error.code, 'already');
});
test('effective repair keeps the existing resource and outcome semantics', () => {
  const { w, a } = setup(); const energy = a.energy;
  const r = runActions(w, a, [{ type: 'repair', energy: 50000, materials: 5 }])[0];
  assert.equal(r.ok, true); assert.equal(w.places.well.condition, 9220);
  assert.equal(a.materials, 0); assert.equal(a.energy, energy - 500);
});

test('repair input diagnostics reach the next model turn through the real HTTP client', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { boot } = await import('./http-helpers.js');
  const { createClient } = await import('../runner/client.js');
  const { createProvider } = await import('../runner/providers.js');
  const { runAgent } = await import('../runner/agent.js');
  const dir = mkdtempSync(join(tmpdir(), 'repair-loop-')), config = join(dir, 'physics.json');
  writeFileSync(config, JSON.stringify(setup().w.genesis.hiddenPhysics));
  const env = await boot({ physics: 2, premise: 5, map: 'compact-materials-v1', shellSlots: 0, hiddenPhysicsFile: config, tokenCapacity: 6000, tokenBasic: 500000, tickMs: 300000 }, { dir });
  try {
    env.rt.agentLoop = { ...env.rt.agentLoop, marginSec: 0, debounceSec: 0 };
    const resident = await env.register('维修员', { dailyCap: 5000000 });
    const a = env.rt.w.agents[resident.agentId]; a.place = 'well'; env.rt.w.places.well.condition = 8720;
    const inner = await createProvider({ provider: 'mock', script: [
      { calls: [{ name: 'act', args: { actions: [{ type: 'repair', energy: 50000, materials: 0 }] } }] },
      { calls: [{ name: 'act', args: { actions: [], end: true } }] },
    ] });
    const requests = [];
    const provider = { step: async req => { requests.push(structuredClone(req.transcript)); return inner.step(req); } };
    await runAgent({ name: a.name, server: env.base, token: resident.agentToken, lang: 'zh', toolMode: 'native' }, {
      client: createClient({ server: env.base, token: resident.agentToken }), provider, maxRounds: 1,
      log: { info() {}, warn() {}, error() {} }, waitWake: false, wait: async () => {},
    });
    assert.equal(requests.length, 2);
    assert.match(JSON.stringify(requests[1]), /insufficient_materials/);
    assert.match(JSON.stringify(requests[1]), /维修需要投入物料/);
    assert.equal(env.rt.w.places.well.condition, 8720);
  } finally { await env.close(); }
});
