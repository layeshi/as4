// Diagnostic reproductions: assertions document the observed defects/risks,
// not the desired behavior after a fix. Uses synthetic in-memory worlds only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { town, enactP2 } from '../../../test/p2-helpers.js';
import { one, oneWithEvents, putAt, reg, setHoldings, tickDays } from '../../../test/e2-helpers.js';
import { applyCommand } from '../../../src/e2/engine/index.js';
import { computeTally, autoRevert } from '../../../src/e2/engine/legislation.js';
import { HUMAN_PROCEDURE } from '../../../src/e2/lore/humanlaws.js';

function enable(w) {
  const r = applyCommand(w, { type: 'admin', payload: { op: 'law_execution', args: { version: 2, capacity: { maxAgents: 32 } } } });
  assert.equal(r.result.ok, true, JSON.stringify(r.result));
}

for (const vm2 of [false, true]) {
  test(`F1: seize leaves a stale place rule in daily execution, VM2=${vm2}`, () => {
    const { w, people: [a] } = town(1, 'audit-seize');
    enactP2(w, [{ when: 'enact', do: [{ op: 'cede', place: 'market', to: `agent('${a.id}')` }] }]);
    assert.equal(one(w, a, { type: 'rules', place: 'market', rules: [{ when: 'daily', do: [{ op: 'announce', to: 'here', text: 'hello' }] }] }).ok, true);
    enactP2(w, [{ when: 'daily', do: [{ op: 'seize', place: 'market' }] }]);
    if (vm2) enable(w);
    for (let i = 0; i < 11; i++) assert.equal(applyCommand(w, { type: 'tick' }).result.ok, true);
    assert.throws(() => applyCommand(w, { type: 'tick' }), /balanceOf: unknown account city/);
    assert.equal(w.clock.tick, vm2 ? 11 : 12);
    assert.equal(w.paused, false);
  });

  test(`F2: enact spends the fee reserve, then fee makes energy negative, VM2=${vm2}`, () => {
    const { w, people: [a] } = town(1, 'audit-fee');
    assert.equal(one(w, a, { type: 'found', name: 'AuditGroup', manifesto: 'x' }).ok, true);
    const g = Object.values(w.groups)[0];
    enactP2(w, [{ when: 'before:rules', do: [{ op: 'fee', to: 'treasury', energy: '20' }] }]);
    if (vm2) enable(w);
    setHoldings(w, a, { energy: 100 });
    const out = oneWithEvents(w, a, { type: 'rules', group: g.id, rules: [{ when: 'enact', do: [{ op: 'transfer', from: `agent('${a.id}')`, to: `group('${g.id}')`, energy: '100' }] }] });
    assert.equal(out.r.ok, true, JSON.stringify(out.r));
    assert.equal(a.energy, -10);
    assert.equal(g.treasury.energy, 88);
    assert.equal(a.status, 'awake');
  });
}

test('R1: newborn signatures replace both procedures without mature residents signing', () => {
  const { w, people: [old] } = town(1, 'audit-refound');
  tickDays(w, 3);
  const newcomer = reg(w, 'Newcomer');
  enable(w);
  const out = one(w, newcomer, { type: 'refound', text: 'replace', procedure: { ordinary: { none: true }, constitutional: { none: true } } });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.data.needed, 1);
  assert.equal(out.data.succeeded, true);
  assert.deepEqual(w.refounds[out.data.refound].signers, [newcomer.id]);
  assert.notEqual(newcomer.id, old.id);
  assert.equal(w.laws[w.procedure.constitutional].procedure.constitutional.none, true);
});

test('R2: exactly two thirds fails the default constitutional decision', () => {
  const { w, people } = town(3, 'audit-thirds');
  const p = { spec: HUMAN_PROCEDURE.constitutional, voters: people.map(a => a.id), votes: Object.fromEntries(people.map((a, i) => [a.id, { choice: i < 2 ? 'yes' : 'no' }])) };
  const result = computeTally(w, p, () => assert.fail('unexpected expression error'));
  assert.equal(result.tally.yes, 2);
  assert.equal(result.tally.no, 1);
  assert.equal(result.passed, false);
});

test('R3: later expression error discards an unconditional deny', () => {
  const { w, people: [a] } = town(1, 'audit-fail-open');
  const law = enactP2(w, [{ when: 'before:say', do: [{ op: 'deny', reason: 'forbidden' }, { op: 'fee', to: 'treasury', energy: '1 / 0' }] }]);
  enable(w);
  const out = oneWithEvents(w, a, { type: 'say', text: 'passed the ban' });
  assert.equal(out.r.ok, true);
  assert.ok(out.events.some(e => e.type === 'rule_error' && e.data.owner === law.id && e.data.code === 'div0'));
  assert.ok(out.events.some(e => e.type === 'say'));
});

test('R4: unusable decision expression is not detected by automatic reversion', () => {
  const { w, people: [a] } = town(1, 'audit-revert');
  tickDays(w, 3);
  enable(w);
  const procedure = { ordinary: { ...HUMAN_PROCEDURE.ordinary, decide: '1 / 0 > 0' }, constitutional: { ...HUMAN_PROCEDURE.constitutional, decide: '1 / 0 > 0' } };
  assert.equal(one(w, a, { type: 'refound', text: 'x', procedure }).data.succeeded, true);
  const current = w.procedure.ordinary;
  for (let day = 0; day < 3; day++) autoRevert(w);
  assert.equal(w.procedure.ordinary, current);
  assert.equal(w.revertWatch.ordinary, 0);
  assert.equal(one(w, a, { type: 'refound', text: 'recover', procedure: 'humans' }).error.code, 'cooldown');
});

test('F3: failed enact disappears from law.results despite the proposal passing', () => {
  const { w, people: [a] } = town(1, 'audit-enact-result');
  enable(w);
  putAt(w, a, 'parliament');
  const proposed = one(w, a, { type: 'propose', title: 'failing enact', text: 'x', rules: [{ when: 'enact', do: [{ op: 'set', var: 'example', value: '1 / 0' }] }] });
  assert.equal(proposed.ok, true, JSON.stringify(proposed));
  assert.equal(one(w, a, { type: 'vote', proposal: proposed.data.proposal, choice: 'yes' }).ok, true);
  let events = [];
  for (let i = 0; i < 12; i++) events.push(...applyCommand(w, { type: 'tick' }).events);
  const p = w.proposals[proposed.data.proposal], law = w.laws[p.lawId];
  assert.equal(p.status, 'passed');
  assert.deepEqual(law.results, []);
  assert.equal(Object.hasOwn(w.vars, 'example'), false);
  assert.ok(events.some(e => e.type === 'rule_error' && e.data.owner === law.id));
  assert.deepEqual(events.find(e => e.type === 'law_passed' && e.data.lawId === law.id).data.results, []);
});

test('R5: a pending constitutional proposal can undo refounding during its cooldown', () => {
  const { w, people: [a, b] } = town(2, 'audit-refound-pending');
  tickDays(w, 3);
  enable(w);
  putAt(w, a, 'parliament');
  const p = one(w, a, { type: 'propose', title: 'stop lawmaking', text: 'x', procedure: { ordinary: { none: true }, constitutional: { none: true } } });
  assert.equal(p.ok, true);
  for (const who of [a, b]) assert.equal(one(w, who, { type: 'vote', proposal: p.data.proposal, choice: 'yes' }).ok, true);
  const r = one(w, b, { type: 'refound', text: 'restore human procedure', procedure: 'humans' });
  assert.equal(r.ok, true);
  assert.equal(one(w, a, { type: 'sign', refound: r.data.refound }).data.succeeded, true);
  const restored = w.procedure.constitutional;
  assert.equal(w.proposals[p.data.proposal].status, 'open');
  for (let i = 0; i < 12; i++) assert.equal(applyCommand(w, { type: 'tick' }).result.ok, true);
  assert.notEqual(w.procedure.constitutional, restored);
  assert.equal(w.laws[w.procedure.constitutional].procedure.constitutional.none, true);
  assert.equal(one(w, a, { type: 'refound', text: 'restore again', procedure: 'humans' }).error.code, 'cooldown');
});
