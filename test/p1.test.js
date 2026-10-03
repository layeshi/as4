import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goldenSamples } from './fixtures/p1/golden.js';
import e2, { premised } from '../src/e2/facade.js';
import { genesisOpts } from '../src/e2/world.js';
import { loadConfig } from '../src/config.js';
import { stateHash } from '../src/store.js';
import { reg } from './e2-helpers.js';
test('P1 T1: premise 0 golden samples remain byte identical', () => {
  assert.deepEqual(goldenSamples(), JSON.parse(readFileSync(new URL('./fixtures/p1/premise0.json', import.meta.url))));
});
test('P1 T1: version, all perception forms, genesis and determinism', () => {
  const w0 = e2.createWorld({ seed: 'p1' });
  for (const key of ['premise', 'backstage']) assert.equal(Object.hasOwn(w0, key), false);
  assert.equal(Object.hasOwn(w0.shells, 'bodies'), false);
  assert.equal(Object.hasOwn(w0.dayLog, 'p1'), false);
  const w = e2.createWorld({ seed: 'p1', premise: 1, shellSlots: 16 });
  assert.ok(premised(w)); assert.equal(w.shells.bodies.length, 16);
  assert.deepEqual(w, e2.createWorld(genesisOpts(w)));
  const a = reg(w, '甲');
  for (const status of ['awake', 'dormant', 'dead', 'retired']) {
    a.status = status;
    assert.equal(e2.buildPerception(w, a.id, { ack: false }).premise, 1);
  }
  const run = () => { const x = e2.createWorld({ seed: 'same', premise: 1 }); for (let i = 0; i < 120; i++) e2.applyCommand(x, { type: 'tick' }); return stateHash(x); };
  assert.equal(run(), run()); assert.equal(e2.publicState(w).world.premise, 1);
  assert.throws(() => e2.createWorld({ seed: 'x', premise: 2 }), /PREMISE/);
});
test('P1 T1: configuration validation', () => {
  assert.equal(loadConfig({ PHYSICS: '2', PREMISE: '1' }, []).premise, 1);
  assert.throws(() => loadConfig({ PREMISE: '2' }, []), /PREMISE 只能/);
  assert.throws(() => loadConfig({ PREMISE: '1', PHYSICS: '1' }, []), /只用于第二纪/);
});
