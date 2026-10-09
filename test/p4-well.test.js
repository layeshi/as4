import test from 'node:test';
import assert from 'node:assert/strict';
import { bareWorld, reg, grant } from './e2-helpers.js';
import e2 from '../src/e2/facade.js';
import { runActions } from '../src/e2/engine/actions.js';
import { upgradeCost } from '../src/e2/engine/upgrades.js';
import { wellOutput } from '../src/e2/engine/environment.js';
import { produceWell } from '../src/e2/engine/economy.js';
import { abandonExpired } from '../src/e2/engine/projects.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
import { releaseAgent } from '../src/e2/engine/lifecycle.js';
import { weatherCodesFor } from '../src/e2/engine/weather.js';
const world = () => bareWorld('well4', { premise: 4, tokens: { capacity: 6000, basic: 4000 } });
const person = (w, name) => { const a = reg(w, name, { dailyCap: 100000 }); grant(w, a, 1000000); a.place = 'well'; return a; };
const one = (w, a, action) => { a.actsThisTick = 0; return runActions(w, a, [action])[0]; };
const cmd = (w, op, args) => e2.applyCommand(w, { type: 'admin', payload: { op, args } });

test('P4 T12: capacity, supply and condition determine output, without season/weather multipliers', () => {
  const w = world();
  w.well.supply = 1234;
  w.places.well.condition = 8765;
  const output = Math.floor(6000 * 1234 * 876 / 1000000);
  w.weather.active = [{ type: 'drought' }, { type: 'bounty' }];
  for (let d = 0; d < 24; d++) assert.equal(wellOutput(w, d), output);
  for (const type of ['drought', 'bounty', 'aurora', 'migration']) {
    assert.equal(weatherCodesFor(w).includes(type), false);
    assert.equal(cmd(w, 'weather', { type, startDay: 1 }).result.ok, false);
  }
  w.places.well.condition = 0;
  assert.equal(wellOutput(w, 0), Math.floor(6000 * 1234 * 200 / 1000000));
});

test('P4 T13: private and city upgrades, escalating cost, contributors, dividends, remainder and departure', () => {
  const w = world(), a = person(w, '甲'), b = person(w, '乙');
  assert.deepEqual([1,2,3,4].map(n => upgradeCost(w, n)), [6000,9000,13500,20250]);
  assert.equal(one(w, a, { type: 'initiate', build: 'upgrade' }).ok, true);
  const j = Object.values(w.projects)[0];
  assert.equal(j.need, 6000);
  assert.equal(one(w, a, { type: 'initiate', build: 'upgrade' }).error.code, 'already');
  one(w, a, { type: 'contribute', project: j.id, energy: 4001 });
  one(w, b, { type: 'contribute', project: j.id, energy: 1999 });
  assert.equal(j.status, 'built');
  assert.deepEqual(w.well.upgrades[0], { projectId: j.id, level: 1, owner: 'private', shares: { [a.id]: 4001, [b.id]: 1999 } });
  const before = [a.energy, b.energy, w.treasury.energy];
  produceWell(w, 0);
  assert.deepEqual([a.energy-before[0], b.energy-before[1], w.treasury.energy-before[2]], [200,99,6001]);
  assert.equal(w.dayLog.output, 6000);
  assert.equal(w.dayLog.p4.dividends, 300);
  assert.equal(checkConservation(w).ok, true);
  one(w, a, { type: 'initiate', build: 'upgrade', owner: 'city' });
  const city = Object.values(w.projects)[1];
  one(w, b, { type: 'contribute', project: city.id, energy: city.need });
  assert.equal(wellOutput(w, 0), 6300);
  assert.deepEqual(w.well.upgrades[1].shares, null);
  a.status = 'retired'; releaseAgent(w, a);
  assert.deepEqual(w.well.upgrades[0].shares, { [b.id]: 1999, treasury: 4001 });
  assert.equal(checkConservation(w).ok, true);
});

test('P4 T13: wrong location, ownership, upper level and abandonment', () => {
  const w = world(), a = person(w, '甲');
  a.place = 'port';
  assert.equal(one(w, a, { type: 'initiate', build: 'upgrade' }).error.code, 'wrong_place');
  a.place = 'well';
  for (const owner of ['g1', null, 'private']) assert.equal(one(w, a, { type: 'initiate', build: 'upgrade', owner }).error.code, 'invalid_args');
  one(w, a, { type: 'initiate', build: 'upgrade' });
  const j = Object.values(w.projects)[0];
  one(w, a, { type: 'contribute', project: j.id, energy: 100 });
  abandonExpired(w, j.expiresDay);
  assert.equal(j.status, 'abandoned');
  assert.equal(w.ledger.snk.energy.project_abandoned, 100);
  assert.equal(w.well.upgrades.length, 0);
  w.well.upgrades = Array.from({ length: 10 }, (_, i) => ({ projectId: `j${i}`, level: i+1, owner: 'city', shares: null }));
  assert.equal(one(w, a, { type: 'initiate', build: 'upgrade' }).error.code, 'invalid_args');
  assert.equal(checkConservation(w).ok, true);
});

test('P4 T14: supply/basic commands validate, notify all living residents, and do nothing when unchanged', () => {
  const w = world(), a = person(w, '甲');
  let r = cmd(w, 'well_supply', { permille: 1200 });
  assert.equal(r.result.ok, true);
  assert.deepEqual(r.events.filter(e => e.type === 'backstage').map(e => e.data), [{ kind: 'supply', direction: 'up' }]);
  assert.equal(a.inbox.at(-1).code, 'supply_up');
  assert.equal(cmd(w, 'well_supply', { permille: 1200 }).events.length, 0);
  cmd(w, 'basic_allotment', { basic: 5000 });
  assert.equal(a.basic, 4000);
  assert.equal(w.tokens.basic, 5000);
  assert.equal(a.inbox.at(-1).code, 'basic_up');
  assert.equal(cmd(w, 'well_supply', { permille: 99 }).result.ok, false);
  assert.equal(cmd(w, 'basic_allotment', { basic: 3999 }).result.ok, false);
  for (const premise of [0,1,2]) for (const op of ['well_supply', 'basic_allotment']) {
    assert.equal(cmd(bareWorld('old', { premise }), op, {}).result.error.code, 'not_allowed');
  }
});

import { fundTreasury } from './e2-helpers.js';
import { enact } from './e2-law-helpers.js';
test('P4 T13: laws can fund an upgrade; treasury shares and rounding stay in the city', () => {
  const w = world(), a = person(w, '甲');
  one(w, a, { type: 'initiate', build: 'upgrade' });
  const j = Object.values(w.projects)[0];
  one(w, a, { type: 'contribute', project: j.id, energy: 2999 });
  fundTreasury(w, 3001);
  enact(w, [{ when: 'enact', do: [{ op: 'fund', project: j.id, energy: '3001' }] }]);
  assert.equal(j.status, 'built');
  assert.deepEqual(w.well.upgrades[0].shares, { [a.id]: 2999, treasury: 3001 });
  const before = a.energy;
  produceWell(w, 0);
  assert.equal(a.energy - before, 149);
  assert.equal(w.treasury.energy, 6151);
  assert.equal(checkConservation(w).ok, true);
});
