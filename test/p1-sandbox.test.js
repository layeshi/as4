import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSandbox } from '../src/e2/sandbox/run.js';
import { sandboxBaseline } from './fixtures/p1/golden.js';
import { stateHash } from '../src/store.js';

test('P1 T14: three 120-day seeds conserve, cover memory actions and replay deterministically', () => {
  const totals={imparts:0,impartsAccepted:0,internalized:0};
  for(const seed of [1,2,3]) {
    const {world,report}=runSandbox({premise:1,agents:10,shellSlots:16,days:120,seed});
    assert.equal(report.meta.worldDays,120);assert.equal(world.ledger.mismatches,0);assert.equal(report.meta.conservationFailure,null);
    for(const m of world.metrics)for(const k of Object.keys(totals))totals[k]+=m[k];
    assert.equal(world.shells.bodies.length,16);assert.ok(Object.values(world.agents).filter(a=>a.generation===0).every(a=>a.bornDay===0));
    const again=runSandbox({premise:1,agents:10,shellSlots:16,days:120,seed});assert.equal(stateHash(world),stateHash(again.world));
  }
  for(const [k,v] of Object.entries(totals))assert.ok(v>0,`${k} did not occur`);
  assert.throws(()=>runSandbox({premise:1,agents:17,shellSlots:16,days:1}),/先民不能多于躯壳/);
});
test('P1 T14: premise 0 report equals pre-implementation golden hash (Q34)', () => {
  assert.equal(sandboxBaseline(),JSON.parse(readFileSync(new URL('./fixtures/p1/sandbox0.json',import.meta.url))).hash);
});
