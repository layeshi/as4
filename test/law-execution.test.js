import test from 'node:test';
import assert from 'node:assert/strict';
import { town, enactP2 } from './p2-helpers.js';
import { applyCommand } from '../src/e2/engine/index.js';
import { one, putAt, sha } from './e2-helpers.js';
import { stateHash } from '../src/store.js';
import { actionFeedback } from '../src/action-feedback.js';
import { normalizeCapacity } from '../src/e2/rules/plan.js';
import { capacityCheck } from '../src/e2/engine/law-execution.js';

const ration = [{ when: 'daily', do: [{ op: 'each', in: "filter(agents, has_tag(it, 'citizen') and not has_tag(it, 'exiled'))", do: [{ op: 'transfer', from: 'treasury', to: 'it', energy: "city.wellOutput * var.rationShare / 1000 / count(filter(agents, has_tag(it, 'citizen') and not has_tag(it, 'exiled')))" }] }] }];
const enable = (w, capacity = {}) => applyCommand(w, { type: 'admin', payload: { op: 'law_execution', args: { version: 2, capacity } } });

test('migration rejects premise0 with no premise field and premise1 without adding VM state', () => {
  for (const premise of [0, 1]) {
    const { w } = town(1, 'old-migration-' + premise, { premise });
    assert.equal(enable(w).result.ok, false);
    assert.equal(Object.hasOwn(w, 'ruleExecution'), false);
  }
});

test('capacity updates preserve omitted settings and reject malformed capacity instead of resetting defaults', () => {
  const { w } = town(1, 'capacity-update');
  assert.equal(enable(w, { maxAgents: 2, maxRules: 20 }).result.ok, true);
  assert.equal(applyCommand(w, { type: 'admin', payload: { op: 'law_execution', args: { version: 2 } } }).result.ok, true);
  assert.equal(w.ruleExecution.capacity.maxAgents, 2);
  assert.equal(enable(w, { maxAgents: 4 }).result.ok, true);
  assert.equal(w.ruleExecution.capacity.maxRules, 20);
  for (const capacity of [null, false, 0, '']) assert.equal(applyCommand(w, { type: 'admin', payload: { op: 'law_execution', args: { version: 2, capacity } } }).result.ok, false);
});

test('law VM migration is explicit, preserves original rule text, and resolves the real l7 fuel failure', () => {
  const { w } = town(14, 'l7-regression');
  w.laws.l3.status = 'repealed';
  const law = enactP2(w, ration);
  const original = JSON.stringify(law.rules);
  const legacy = structuredClone(w);
  let oldErrors = [];
  for (let i = 0; i < 12; i++) oldErrors.push(...applyCommand(legacy, { type: 'tick' }).events.filter(e => e.type === 'rule_error'));
  assert.ok(oldErrors.some(e => e.data.owner === law.id && e.data.code === 'fuel'));
  assert.equal(enable(w).result.ok, true);
  let newErrors = [], transfers = [];
  for (let i = 0; i < 12; i++) {
    const o = applyCommand(w, { type: 'tick' });
    newErrors.push(...o.events.filter(e => e.type === 'rule_error'));
    transfers.push(...o.events.filter(e => e.type === 'rule_op' && e.data.owner === law.id && e.data.op === 'transfer'));
  }
  assert.equal(newErrors.length, 0);
  assert.equal(transfers.length, 14);
  assert.equal(JSON.stringify(w.laws[law.id].rules), original);
});

test('capacity breach freezes entire command before any settlement, resume requires successful preflight', () => {
  const { w } = town(2, 'capacity-protect');
  assert.equal(enable(w, { maxAgents: 2 }).result.ok, true);
  const before = { tick: w.clock.tick, treasury: structuredClone(w.treasury), agents: Object.keys(w.agents) };
  const o = applyCommand(w, { type: 'register', payload: { name: 'extra', bio: '', soul: 'x', lang: 'zh', model: 'm', creatorName: 't', tokenHash: sha('extra'), ownerKeyHash: sha('extra-owner') } });
  assert.equal(o.result.ok, false);
  assert.equal(w.paused, true);
  assert.equal(w.clock.tick, before.tick);
  assert.deepEqual(w.treasury, before.treasury);
  assert.deepEqual(Object.keys(w.agents), before.agents);
  assert.equal(w.ruleExecution.protection.code, 'capacity');
  const letters = w.agents.a1.letters.length;
  assert.equal(applyCommand(w, { type: 'letter', payload: { agentId: 'a1', text: 'capacity-paused' } }).result.ok, false);
  assert.equal(w.agents.a1.letters.length, letters);
  assert.equal(applyCommand(w, { type: 'admin', payload: { op: 'resume' } }).result.ok, false);
  assert.equal(enable(w, { maxAgents: 4 }).result.ok, true);
  assert.equal(applyCommand(w, { type: 'admin', payload: { op: 'resume' } }).result.ok, true);
});

test('response feedback must not turn a failed cost proof into a successful draft', () => {
  const r = { type: 'draft', ok: true, data: { ok: false, staticOk: true, budget: { ok: false, issues: [{ path: 'rules[0]', code: 'cost_limit' }] }, preview: [], errors: [] } };
  const out = actionFeedback(r, 'zh', { premise: 2 });
  assert.equal(out.data.ok, false);
  assert.ok(out.data.errors.some(e => e.code === 'cost_limit'));
});

test('unprovable costly laws remain draftable with diagnostics but cannot be proposed', () => {
  const { w, people: [a] } = town(2, 'law-admission');
  assert.equal(enable(w, { maxAgents: 16, maxRuleFuel: 3000 }).result.ok, true);
  putAt(w, a, 'parliament');
  const expensive = [{ when: 'daily', do: [{ op: 'each', in: 'agents', do: [{ op: 'transfer', from: 'treasury', to: 'it', energy: 'sum(agents, sum(agents, count(sample(agents, 1))))' }] }] }];
  const draft = one(w, a, { type: 'draft', rules: expensive });
  assert.equal(draft.ok, true);
  assert.equal(draft.data.budget.ok, false);
  assert.ok(draft.data.budget.issues.length);
  assert.ok(draft.data.budget.certificates[0].bottlenecks.some(b => b.path.endsWith('.energy')));
  const proposal = one(w, a, { type: 'propose', title: 'costly', text: 'x', rules: expensive });
  assert.equal(proposal.ok, false);
  assert.equal(proposal.error.code, 'rule_invalid');
  assert.equal(Object.values(w.proposals).length, 0);
});

test('same full command history reproduces state through explicit execution migration', () => {
  const { w } = town(2, 'history-seed');
  const base = structuredClone(w), commands = [
    { n: w.commandN + 1, type: 'tick' },
    { n: w.commandN + 2, type: 'admin', payload: { op: 'law_execution', args: { version: 2 } } },
    { n: w.commandN + 3, type: 'tick' },
  ];
  for (const c of commands) applyCommand(w, c);
  for (const c of commands) applyCommand(base, c);
  assert.equal(stateHash(w), stateHash(base));
  assert.equal(w.ruleExecution.version, 2);
});

test('prospective total rule occupancy rejects submission without globally pausing', () => {
  const { w, people: [a] } = town(2, 'prospective');
  assert.equal(enable(w, { maxAgents: 2, maxRules: 7 }).result.ok, true);
  putAt(w, a, 'parliament');
  const proposal = one(w, a, { type: 'propose', title: 'extra', text: 'x', rules: [{ when: 'daily', do: [{ op: 'announce', to: 'all', text: 'hello' }] }] });
  assert.equal(proposal.ok, false);
  assert.equal(proposal.error.code, 'rule_invalid');
  assert.equal(w.paused, false);
  assert.equal(Object.keys(w.proposals).length, 0);
});

test('migration checks its own recorded capacity bytes before mutating configuration', () => {
  const { w } = town(1, 'migration-bytes');
  const bytes = Buffer.byteLength(JSON.stringify(w));
  const out = enable(w, { maxWorldBytes: bytes });
  assert.equal(out.result.ok, false);
  assert.equal(Object.hasOwn(w, 'ruleExecution'), false);
});

test('prospective ballot snapshot reservation rejects submission without a capacity pause', () => {
  const { w, people: [a] } = town(2, 'ballot-reservation');
  const capacity = normalizeCapacity({ maxAgents: 2, maxRuleFuel: 100 });
  const reserved = capacityCheck(w, capacity).reserved;
  assert.equal(enable(w, { maxAgents: 2, maxRuleFuel: 100, maxCommandFuel: reserved + 10 }).result.ok, true);
  putAt(w, a, 'parliament');
  const out = one(w, a, { type: 'propose', title: 'x', text: 'x', rules: [{ when: 'daily', do: [{ op: 'announce', to: 'all', text: 'x' }] }] });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'rule_invalid');
  assert.equal(w.paused, false);
});

test('pending group-owned place rules reserve both old and prospective rules', () => {
  const { w, people: [a] } = town(2, 'place-reservation');
  const found = one(w, a, { type: 'found', name: 'g', manifesto: 'g', procedure: 'members' });
  const g = Object.values(w.groups)[0];
  assert.equal(found.ok, true);
  w.places.market.owner = { kind: 'group', id: g.id };
  w.places.market.rules = { rules: [{ when: 'daily', do: [{ op: 'announce', to: 'here', text: 'old' }] }], paidThrough: 0, suspendedDays: 0 };
  assert.equal(enable(w, { maxAgents: 2, maxRules: 8 }).result.ok, true);
  const out = one(w, a, { type: 'rules', place: 'market', rules: [{ when: 'daily', do: [{ op: 'announce', to: 'here', text: 'new' }] }] });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'rule_invalid');
  assert.equal(w.paused, false);
});
