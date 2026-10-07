import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRules } from '../src/e2/rules/check.js';
import { staticLookup } from '../src/e2/engine/legislation.js';
import { applyCommand } from '../src/e2/engine/index.js';
import { town, enactP2 } from './p2-helpers.js';
import { one, oneWithEvents, actRaw, setHoldings, tickDays, putAt } from './e2-helpers.js';
import { dailyRules, runAfter, fireEvent } from '../src/e2/engine/rules.js';
import { HANDLERS, runActions } from '../src/e2/engine/actions.js';
import { fail, pushInbox, emit, drainEvents } from '../src/e2/engine/core.js';
import { holdings, checkConservation } from '../src/e2/engine/ledger.js';
import { next } from '../src/rng.js';
import { commandMeter } from '../src/e2/engine/law-execution.js';
import { HUMAN_PROCEDURE } from '../src/e2/lore/humanlaws.js';
import { createLaw, installProcedure } from '../src/e2/engine/laws.js';

const setup = () => { const t = town(2, 'action-repair'); t.w.lawSemantics = { version: 2 }; return t; };
for (const timing of ['daily', 'monthly', 'after:say']) {
  test(`seizure invalidates queued ${timing} place rules`, () => {
    const { w, people: [a] } = setup();
    enactP2(w, [{ when: 'enact', do: [{ op: 'cede', place: 'market', to: `agent('${a.id}')` }] }]);
    assert.equal(one(w, a, { type: 'rules', place: 'market', rules: [{ when: timing, do: [{ op: 'announce', to: 'here', text: 'stale' }] }] }).ok, true);
    enactP2(w, [{ when: timing, do: [{ op: 'seize', place: 'market' }] }]);
    putAt(w, a, 'market');
    drainEvents(w);
    assert.doesNotThrow(() => timing.startsWith('after') ? runAfter(w, a, 'say', { text: 'hi' }, {}, {}, 'market') : dailyRules(w, timing === 'monthly' ? 23 : 0));
    assert.equal(w.places.market.rules, null);
    assert.equal(drainEvents(w).some(e => e.type === 'announce' && e.data.text === 'stale'), false);
  });
}
for (const timing of ['daily', 'monthly', 'after:say', 'on:arrive']) {
  test(`repeal invalidates queued ${timing} city rules and preserves remaining repealer intents`, () => {
    const { w, people: [a] } = setup();
    const earlier = createLaw(w, { title: 'repealer', text: 'x', author: a.id });
    const law = enactP2(w, [{ when: timing, do: [{ op: 'set', var: 'stale', value: '1' }] }]);
    const id = law.id;
    const v = validateRules([{ when: timing, do: [{ op: 'repeal', law: id }, { op: 'set', var: 'same', value: '1' }] }], { scope: { kind: 'city', premise: 2 }, lookup: staticLookup(w) });
    assert.equal(v.ok, true); earlier.rules = v.rules;
    if (timing.startsWith('on')) fireEvent(w, 'arrive', { agent: a.id });
    else if (timing.startsWith('after')) runAfter(w, a, 'say', {}, {}, {}, a.place);
    else dailyRules(w, timing === 'monthly' ? 23 : 0);
    assert.equal(law.status, 'repealed');
    assert.equal(w.vars.same, 1);
    assert.equal(w.vars.stale, undefined);
  });
}

test('before collection error denies without charging, with rule diagnostics', () => {
  const { w, people: [a] } = setup();
  const law = enactP2(w, [{ when: 'before:say', do: [{ op: 'fee', to: 'treasury', energy: '2' }, { op: 'fee', to: 'treasury', energy: '1 / 0' }] }]);
  const energy = a.energy;
  const out = oneWithEvents(w, a, { type: 'say', text: 'blocked' });
  assert.equal(out.r.ok, false);
  assert.deepEqual(out.r.error, { code: 'forbidden', law: law.id, rule: 0, ruleCode: 'div0', reason: 'rule_error' });
  assert.equal(a.energy, energy);
  assert.equal(a.actsThisTick, 1);
  assert.equal(out.events.filter(e => e.type === 'rule_error').length, 1);
  assert.equal(out.events.some(e => e.type === 'say'), false);
});

test('guarded exit, refound and open wilderness bypass broken before laws', () => {
  const { w, people: [a] } = setup();
  tickDays(w, 3);
  enactP2(w, ['move'].map(type => ({ when: `before:${type}`, do: [{ op: 'fee', to: 'treasury', energy: '1 / 0' }] })), { human: true });
  const wild = Object.values(w.places).find(p => p.wild && p.open);
  assert.equal(one(w, a, { type: 'move', to: wild.id }).ok, true);
  assert.equal(one(w, a, { type: 'refound', text: 'recover', procedure: 'humans' }).ok, true);
  assert.equal(one(w, a, { type: 'retire' }).ok, true);
});

for (const vm2 of [false, true]) for (const coins of [0, 7]) {
  test(`fee escrow prevents internal double spending (coins ${coins}, VM2 ${vm2})`, () => {
    const { w, people: [a] } = setup();
    assert.equal(one(w, a, { type: 'found', name: 'Escrow', manifesto: 'x' }).ok, true);
    const g = Object.values(w.groups)[0];
    enactP2(w, [{ when: 'before:rules', do: [{ op: 'fee', to: 'treasury', energy: '20', coins: String(coins) }] }]);
    if (vm2) assert.equal(applyCommand(w, { type: 'admin', payload: { op: 'law_execution', args: { version: 2, capacity: { maxAgents: 32 } } } }).result.ok, true);
    setHoldings(w, a, { energy: 100, coins: 20 });
    const treasury = { ...w.treasury };
    const out = one(w, a, { type: 'rules', group: g.id, rules: [{ when: 'enact', do: [{ op: 'transfer', from: `agent('${a.id}')`, to: `group('${g.id}')`, energy: '100', coins: '20' }] }] });
    assert.equal(out.ok, true);
    assert.equal(g.treasury.energy, 68);
    assert.equal(a.energy, 10);
    assert.equal(w.treasury.energy - treasury.energy, 20);
    assert.equal(g.treasury.coins, 20 - coins);
    assert.equal(a.coins, 0);
    assert.equal(w.treasury.coins - treasury.coins, coins);
    assert.equal(checkConservation(w).ok, true);
  });
}

test('escrow conserves both assets and recipient cannot spend fees inside handler', () => {
  const { w, people: [a, b] } = setup();
  setHoldings(w, b, { energy: 0, coins: 0 });
  enactP2(w, [{ when: 'before:say', do: [{ op: 'fee', to: `agent('${b.id}')`, energy: '20', coins: '5' }] }]);
  setHoldings(w, a, { energy: 100, coins: 10 });
  const original = HANDLERS.say;
  let observed;
  HANDLERS.say = { ...original, apply(ctx, plan) { observed = { holdings: holdings(ctx.w), ledger: checkConservation(ctx.w).ok, recipient: [ctx.w.agents[b.id].energy, ctx.w.agents[b.id].coins], spendable: [ctx.a.energy, ctx.a.coins] }; return original.apply(ctx, plan); } };
  try { assert.equal(one(w, a, { type: 'say', text: 'paid' }).ok, true); } finally { HANDLERS.say = original; }
  assert.equal(observed.ledger, true);
  assert.deepEqual(observed.recipient, [0, 0]);
  assert.deepEqual(observed.spendable, [79, 5]);
  assert.deepEqual([b.energy, b.coins], [20, 5]);
  assert.equal(checkConservation(w).ok, true);
});

test('ordinary late ActError restores only failing action, including hidden effects and RNG; meter remains spent', () => {
  const { w, people: [a, b] } = setup();
  enactP2(w, [{ when: 'before:say', do: [{ op: 'fee', to: 'treasury', energy: '2' }] }]);
  assert.equal(applyCommand(w, { type: 'admin', payload: { op: 'law_execution', args: { version: 2, capacity: { maxAgents: 32 } } } }).result.ok, true);
  commandMeter(w);
  const original = HANDLERS.say;
  let checkpoint, meter, diagnosticSeq;
  HANDLERS.say = { ...original, apply(ctx, plan) {
    const data = original.apply(ctx, plan);
    if (plan.text === 'fail') { next(ctx.w.rng.world); pushInbox(ctx.w, ctx.w.agents[b.id], 'whisper', { text: 'rolled back' }); ctx.w.vars.business = 1; diagnosticSeq = emit(ctx.w, 'rule_error', { data: { scope: 'city', owner: 'law', rule: 0, code: 'div0' } }).seq; meter = { ...ctx.w.$lawMeter }; fail('not_allowed'); }
    checkpoint = { energy: ctx.a.energy, inbox: ctx.w.agents[b.id].inbox.length, rng: ctx.w.rng.world.slice() };
    return data;
  } };
  try {
    const results = runActions(w, a, [{ type: 'say', text: 'success' }, { type: 'say', text: 'fail' }]);
    assert.equal(results[0].ok, true); assert.equal(results[1].ok, false);
  } finally { HANDLERS.say = original; }
  assert.equal(a.energy, checkpoint.energy);
  assert.equal(w.agents[a.id], a);
  assert.equal(b.inbox.length, checkpoint.inbox);
  assert.deepEqual(w.rng.world, checkpoint.rng);
  assert.equal(w.vars.business, undefined);
  assert.equal(w.$wakes?.length || 0, 0);
  assert.equal(a.actsThisTick, 2);
  assert.deepEqual(w.$lawMeter, meter);
  assert.ok(meter.steps > 0); assert.equal(meter.intents, 2);
  const events = drainEvents(w);
  assert.equal(events.filter(e => e.type === 'say').length, 1);
  assert.equal(events.filter(e => e.type === 'rule_error').length, 1);
  assert.equal(events.find(e => e.type === 'rule_error').seq, diagnosticSeq);
  assert.equal(w.counters.event, diagnosticSeq);
  assert.equal(new Set(events.map(e => e.seq)).size, events.length);
  assert.equal(checkConservation(w).ok, true);
});

test('failed formal propose retains procedure fault and diagnostic with business rollback', () => {
  const { w, people: [a] } = setup();
  putAt(w, a, 'parliament');
  const law = createLaw(w, { title: 'broken', text: 'x', author: a.id, procedure: { ordinary: { ...HUMAN_PROCEDURE.ordinary, proposers: '1 / 0 > 0' } } });
  installProcedure(w, law, 'enacted');
  const energy = a.energy;
  const out = oneWithEvents(w, a, { type: 'propose', title: 'proposal', text: 'x' });
  assert.equal(out.r.ok, false);
  assert.equal(a.energy, energy);
  assert.equal(w.procedureFaults.ordinary.lawId, law.id);
  assert.deepEqual(out.events.find(e => e.type === 'procedure_error').data, { class: 'ordinary', lawId: law.id, field: 'proposers', code: 'div0' });
});

test('unknown exceptions propagate for the whole-command protection boundary', () => {
  const { w, people: [a] } = setup();
  const original = HANDLERS.say;
  HANDLERS.say = { ...original, apply() { throw new Error('unexpected-engine'); } };
  try { assert.throws(() => runActions(w, a, [{ type: 'say', text: 'fault' }]), /unexpected-engine/); } finally { HANDLERS.say = original; }
});

test('nonzero coin fee to soul rejects action without losing coins or charging energy', () => {
  const { w, people: [a] } = setup();
  const soul = one(w, a, { type: 'conceive', name: 'Waiting', soul: 'x' }).data.soul;
  setHoldings(w, a, { energy: 100, coins: 10 });
  enactP2(w, [{ when: 'before:say', do: [{ op: 'fee', to: `soul('${soul}')`, energy: '3', coins: '2' }] }]);
  const out = oneWithEvents(w, a, { type: 'say', text: 'invalid fee' });
  assert.equal(out.r.ok, false); assert.equal(out.r.error.ruleCode, 'unsupported_asset');
  assert.deepEqual([a.energy, a.coins, w.souls[soul].fund], [100, 10, 0]);
  assert.equal(checkConservation(w).ok, true);
});

test('fee settlement validates all recipients before any payment and rolls back changed target', () => {
  const { w, people: [a, b] } = setup();
  const soul = one(w, a, { type: 'conceive', name: 'Waiting', soul: 'x' }).data.soul;
  enactP2(w, [{ when: 'before:say', do: [{ op: 'fee', to: `agent('${b.id}')`, energy: '3' }, { op: 'fee', to: `soul('${soul}')`, energy: '3' }] }]);
  const before = [a.energy, b.energy, w.souls[soul].fund];
  const original = HANDLERS.say;
  HANDLERS.say = { ...original, apply(ctx, plan) { delete ctx.w.souls[soul]; return original.apply(ctx, plan); } };
  let out;
  try { out = oneWithEvents(w, a, { type: 'say', text: 'invalidated' }); } finally { HANDLERS.say = original; }
  assert.equal(out.r.ok, false); assert.equal(out.r.error.code, 'forbidden');
  assert.deepEqual([a.energy, b.energy, w.souls[soul].fund], before);
  assert.equal(out.events.some(e => e.type === 'rule_op' && e.data.op === 'fee'), false);
  assert.equal(checkConservation(w).ok, true);
});

test('read-only action preview reports before error without events, RNG consumption or fault health mutation', async () => {
  const { buildPerception } = await import('../src/e2/engine/perception.js');
  const { w, people: [a] } = setup();
  const law = enactP2(w, [{ when: 'before:say', do: [{ op: 'fee', to: 'treasury', energy: '1 / 0' }] }]);
  drainEvents(w); const before = JSON.stringify(w);
  const p = buildPerception(w, a.id, { ack: false, lang: 'en' }); const say = p.actions.find(x => x.type === 'say');
  assert.equal(say.available, false); assert.equal(say.reason.ruleCode, 'div0'); assert.equal(say.reason.law, law.id);
  assert.match(say.reason.text, /div0/); assert.equal(JSON.stringify(w), before); assert.deepEqual(drainEvents(w), []);
});
