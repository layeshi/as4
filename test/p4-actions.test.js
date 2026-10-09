import test from 'node:test';
import assert from 'node:assert/strict';
import { bareWorld, reg, grant, tick } from './e2-helpers.js';
import e2 from '../src/e2/facade.js';
import { runActions, implementedActions } from '../src/e2/engine/actions.js';
import { actionTable, ACTION_ORDER_P4 } from '../src/e2/lore/actions.js';
import { actionWeight, jsonWeight } from '../src/e2/engine/tokens.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
import { validateRules } from '../src/e2/rules/check.js';

function setup() {
  const w = bareWorld('actions4', { premise: 4, tokens: { capacity: 6000, basic: 18000 }, lawSemanticsVersion: 2 });
  const a = reg(w, '甲', { dailyCap: 100000 });
  // Meter command is step 6. Supply its exact active-session state for step-5 tests.
  a.tokens.waking = { id: 'w0-test', tick: 0, kind: 'main', charged: { basic: 0, energy: 0 }, refundable: true };
  a.tokens.bill = { id: 'w0-test', tick: 0, kind: 'main', reread: 0, read: 0, write: 0 };
  return { w, a };
}
function request(w, a, actions, extra = {}) {
  a.actsThisTick = 0;
  return e2.applyCommand(w, { type: 'act', payload: { agentId: a.id, actions, meter: { wakeId: a.tokens.waking.id, reread: 0, day: '2026-10-09', turn: 1 }, ...extra } });
}

test('P4 T8: request writing is charged for failures too; thought is free and refusal is atomic', () => {
  const { w, a } = setup();
  const action = { type: 'nonsense', text: '写了但失败' };
  let r = request(w, a, [action], { thought: '免费的独白' });
  assert.equal(r.result.results[0].ok, false);
  assert.equal(a.tokens.used, actionWeight(action) * 4);
  assert.equal(a.tokens.bill.write, actionWeight(action) * 4);
  assert.equal(a.basic, 18000 - actionWeight(action) * 4);
  const before = a.basic;
  r = request(w, a, [], { thought: '只有独白' });
  assert.equal(a.basic, before);
  a.tokens.cap = a.tokens.used;
  r = request(w, a, [{ type: 'say', text: '不能说' }], { thought: '也不能记录' });
  assert.equal(r.result.error.code, 'cap_reached');
  assert.deepEqual(r.events, []);
  assert.equal(a.basic, before);
  assert.equal(checkConservation(w).ok, true);
});

test('P4 T9: read charges returned data and archive multiplier; failed read rolls back', () => {
  const { w, a } = setup();
  a.place = 'library';
  w.places.library.condition = 5000;
  const r = request(w, a, [{ type: 'read', doc: 'd1' }]).result;
  assert.equal(r.results[0].ok, true);
  assert.equal(a.tokens.bill.read, Math.ceil(jsonWeight(r.results[0].data) * 1.5));
  const reads = w.docs.d1.reads, billed = a.tokens.bill.read;
  const action = { type: 'read', doc: 'd1' };
  a.tokens.cap = a.tokens.used + actionWeight(action) * 4;
  const refused = request(w, a, [action]).result;
  assert.equal(refused.results[0].error.code, 'cap_reached');
  assert.equal(w.docs.d1.reads, reads);
  assert.equal(a.tokens.bill.read, billed);
  assert.equal(checkConservation(w).ok, true);
});

test('P4 T9: draft prices its diagnostics and rolls back its read charge if physical fee cannot be paid', () => {
  const { w, a } = setup();
  grant(w, a, 100);
  let r = request(w, a, [{ type: 'draft', rules: [] }]).result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.cost, 10);
  assert.equal(a.tokens.bill.read, jsonWeight(r.data));
  const oldRead = a.tokens.bill.read;
  const energy = a.energy;
  // Drain physical energy through a transfer, preserving the ledger.
  request(w, a, [{ type: 'give', to: 'treasury', energy }]);
  r = request(w, a, [{ type: 'draft', rules: [] }]).result.results[0];
  assert.equal(r.error.code, 'insufficient_energy');
  assert.equal(a.tokens.bill.read, oldRead);
  assert.equal(checkConservation(w).ok, true);
});

test('P4 T11/T24: rhythm validates partial changes and is inner; removed actions and sandbox stay unavailable', () => {
  const { w, a } = setup();
  assert.deepEqual(implementedActions(4), ACTION_ORDER_P4);
  assert.equal(actionTable(4, true), actionTable(4));
  for (const type of ['sponsor','pray','invent']) assert.equal(actionTable(4).isKnown(type), false);
  for (const args of [{}, { every: -1 }, { every: 37 }, { every: 1.1 }, { called: 1 }, { brief: 'tiny' }]) assert.equal(request(w, a, [{ type: 'routine', ...args }]).result.results[0].error.code, 'invalid_args');
  let r = request(w, a, [{ type: 'routine', every: 0, brief: 'short' }]);
  assert.deepEqual(r.result.results[0].data.routine, { every: 0, called: true, brief: 'short' });
  assert.equal(r.events.find(e => e.type === 'routine').vis, 'delayed');
  r = request(w, a, [{ type: 'routine', called: false }]);
  assert.deepEqual(a.routine, { every: 0, called: false, brief: 'short' });
  for (const when of ['before:routine', 'after:routine']) assert.equal(validateRules([{ when, do: [{ op: 'deny', reason: '不能' }] }], { scope: { kind: 'city', premise: 4 } }).ok, false);
  assert.equal(e2.applyCommand(w, { type: 'admin', payload: { op: 'seed_sandbox', args: { count: 1 } } }).result.error.code, 'not_allowed');
  assert.equal(e2.applyCommand(w, { type: 'prayer_enable' }).result.ok, false);
});

test('P4 T8: standing actions pay no output; Q62 rejects automatic reads without a pricing day', () => {
  const { w, a } = setup();
  grant(w, a, 100);
  request(w, a, [{ type: 'standing', orders: [{ when: 'tick', do: [{ type: 'say', text: '自动' }] }] }]);
  const used = a.tokens.used;
  tick(w);
  assert.equal(a.tokens.used, used);
  assert.equal(w.dayLog.p2.standingFired, 1);
  a.actsThisTick = 0;
  assert.equal(runActions(w, a, [{ type: 'read', agent: a.id }])[0].error.code, 'no_waking');
});

test('P4 T8: text-only fees, anonymous whisper and movement use their separate physical prices', () => {
  const { w, a } = setup();
  const b = reg(w, '乙', { dailyCap: 10000 });
  grant(w, a, 1000);
  w.weather.active = [{ type: 'fog' }];
  let r = request(w, a, [{ type: 'say', text: '免费手续费' }, { type: 'whisper', to: b.id, text: '雾中的私语' }, { type: 'whisper', to: b.id, text: '匿名', anonymous: true }]).result;
  assert.deepEqual(r.results.map(x => x.cost), [0, 0, 20]);
  const p = e2.buildPerception(w, a.id, { ack: false });
  const expected = p.city.places.find(x => x.id === 'market').moveCost;
  r = request(w, a, [{ type: 'move', to: 'market' }]).result;
  assert.equal(r.results[0].cost, expected);
  assert.equal(checkConservation(w).ok, true);
});
