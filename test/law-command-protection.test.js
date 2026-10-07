import test from 'node:test';
import assert from 'node:assert/strict';
import { town } from './p2-helpers.js';
import { applyCommand, registerCommand } from '../src/e2/engine/index.js';
import { HANDLERS } from '../src/e2/engine/actions.js';
import { pushInbox, emit } from '../src/e2/engine/core.js';
import { next } from '../src/rng.js';
import e2 from '../src/e2/facade.js';
import { CapacityError } from '../src/e2/engine/law-execution.js';

const admin = (w, op, args = {}) => applyCommand(w, { type: 'admin', payload: { op, args } });
for (const premise of [0, 1, 2]) for (const vm of premise === 2 ? [1, 2] : [1]) {
  test(`unknown second action atomically rolls back premise ${premise} VM ${vm}`, () => {
    const { w, people: [a, b] } = town(2, 'command-fault', { premise });
    w.lawSemantics = { version: 2 };
    if (vm === 2) assert.equal(admin(w, 'law_execution', { version: 2 }).result.ok, true);
    const before = structuredClone(w);
    const original = HANDLERS.say.apply;
    let reachedDeliberateThrow = false;
    HANDLERS.say.apply = (ctx, plan) => {
      original(ctx, plan);
      next(ctx.w.rng.world); pushInbox(ctx.w, ctx.w.agents[b.id], 'whisper', { text: 'private' });
      reachedDeliberateThrow = true;
      throw new Error('private-thought credential-hash');
    };
    let out;
    try { out = applyCommand(w, { type: 'act', payload: { agentId: a.id, thought: 'private-thought', actions: [{ type: 'diary', text: 'first-action' }, { type: 'say', text: 'second-action' }] } }); }
    finally { HANDLERS.say.apply = original; }
    assert.equal(reachedDeliberateThrow, true, 'RNG/inbox mutation completed before the deliberate private exception');
    assert.equal(out.result.error.reason, 'law_execution_fault');
    assert.equal(w.paused, true);
    assert.equal(w.commandN, before.commandN + 1);
    for (const k of ['agents', 'rng', 'treasury', 'ledger', 'dayLog']) assert.deepEqual(w[k], before[k], k);
    assert.equal(w.counters.inbox, before.counters.inbox);
    assert.equal(w.counters.event, before.counters.event + 1);
    assert.deepEqual(out.wakes, []);
    assert.equal(out.events.length, 1);
    const publicText = JSON.stringify([out, e2.publicState(w), e2.tickSummary(w)]);
    assert.doesNotMatch(publicText, /private-thought|credential-hash|first-action|second-action/);
    const letters = a.letters.length;
    assert.equal(applyCommand(w, { type: 'letter', payload: { agentId: a.id, text: 'blocked' } }).result.ok, false);
    assert.equal(a.letters.length, letters);
    assert.equal(admin(w, 'resume').result.ok, false);
    if (vm === 2) { assert.equal(admin(w, 'law_execution', { version: 2 }).result.ok, true); assert.equal(admin(w, 'resume').result.ok, false); }
    assert.equal(admin(w, 'law_recover').result.probe, 'success');
    assert.equal(w.paused, false);
    assert.deepEqual(w.agents[a.id].diary, before.agents[a.id].diary, 'probe never resubmits successful actions');
    assert.deepEqual(w.rng, before.rng);
  });
}

test('explicit probe preserves protection on engine/capacity faults; business failure recovers distinctly', () => {
  const { w } = town(1); w.lawSemantics = { version: 2 };
  registerCommand('fault_probe_test', s => { s.vars.touched = 1; emit(s, 'probe'); throw new Error('secret'); });
  assert.equal(applyCommand(w, { type: 'fault_probe_test' }).result.ok, false);
  assert.equal(admin(w, 'law_recover').result.error.reason, 'law_execution_fault');
  registerCommand('fault_probe_test', () => { throw new CapacityError({ code: 'capacity' }); });
  assert.equal(admin(w, 'law_recover').result.error.reason, 'law_execution_capacity');
  assert.ok(w.lawSemantics.protection);
  registerCommand('fault_probe_test', s => { s.vars.touched = 2; return { ok: true, results: [{ ok: false, error: { code: 'not_found' } }] }; });
  assert.deepEqual(admin(w, 'law_recover').result, { ok: true, paused: false, probe: 'business_failure', resubmitted: false });
  assert.equal(w.vars.touched, undefined);
});

test('public status and perception report sanitized protection', () => {
  const { w, people: [a] } = town(1); w.lawSemantics = { version: 2 };
  registerCommand('projection_fault_test', () => { throw new Error('hidden-password'); });
  applyCommand(w, { type: 'projection_fault_test', payload: { tokenHash: 'hash-private', thought: 'thought-private' } });
  const projections = [e2.publicState(w).world, e2.tickSummary(w), e2.buildPerception(w, a.id).now];
  for (const view of projections) { assert.equal(view.lawProtection.code, 'engine_exception'); assert.doesNotMatch(JSON.stringify(view), /hidden-password|hash-private|thought-private/); }
});

test('registration and adoption probes never duplicate lifecycle mutations', async () => {
  const { register, adopt } = await import('../src/e2/engine/lifecycle.js');
  const { newWorld, sha } = await import('./e2-helpers.js');
  for (const type of ['register', 'adopt']) {
    const w = newWorld('lifecycle-probe', { premise: 2, lawSemanticsVersion: 2 });
    const handler = type === 'register' ? register : adopt;
    const payload = { name: '探测', soul: 'private soul', bio: '', lang: 'zh', model: 'm', creatorName: 'tester', tokenHash: sha('token'), ownerKeyHash: sha('owner') };
    if (type === 'adopt') {
      const { createSoul } = await import('../src/e2/engine/souls.js');
      const { drainEvents } = await import('../src/e2/engine/core.js');
      payload.soulId = createSoul(w, { name: '摇篮', soul: 'soul', lang: 'zh', authors: [], endowment: 0 }).id;
      drainEvents(w);
    }
    const before = structuredClone(w);
    registerCommand(type, (s, p) => { handler(s, p); throw new Error('late lifecycle fault'); });
    try { assert.equal(applyCommand(w, { type, payload }).result.error.reason, 'law_execution_fault'); }
    finally { registerCommand(type, handler); }
    assert.deepEqual(w.agents, before.agents);
    const recovered = admin(w, 'law_recover');
    assert.equal(recovered.result.probe, 'success');
    assert.deepEqual(w.agents, before.agents);
    assert.deepEqual(w.treasury, before.treasury);
    assert.deepEqual(w.souls, before.souls);
  }
});

test('new semantics bounded realistic laws/actions preserve conservation across command and day boundaries', async () => {
  const { runFuzz } = await import('./e2-fuzz-lib.js');
  const { enactP2 } = await import('./p2-helpers.js');
  for (const vm of [1, 2]) runFuzz({ seed: `law-semantic-${vm}`, days: 3, agents: 4, bare: false, worldOpts: { premise: 2, lawSemanticsVersion: 2 },
    setup(w) {
      enactP2(w, [{ when: 'before:say', do: [{ op: 'fee', to: 'treasury', energy: '1' }] }, { when: 'daily', do: [{ op: 'announce', to: 'all', text: 'day boundary' }] }]);
      if (vm === 2) assert.equal(admin(w, 'law_execution', { version: 2 }).result.ok, true);
    }, hook(w) { assert.equal(w.paused, false); assert.equal(w.$feeEscrow, undefined); }, everyCommand: true });
});
