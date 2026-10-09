import test from 'node:test';
import assert from 'node:assert/strict';
import { bareWorld, reg, grant, tickDays, act } from './e2-helpers.js';
import { payThinking, custodyOf, settleTokens, initialTokens } from '../src/e2/engine/tokens.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
import { releaseAgent } from '../src/e2/engine/lifecycle.js';
import e2 from '../src/e2/facade.js';
const world = () => bareWorld('p4-tokens', { premise: 4, tokens: { capacity: 6000, basic: 4000 } });
const resident = (w, name = '甲', cap = 100000) => reg(w, name, { dailyCap: cap });

test('P4 T5/T6: thinking checks cap before balance, spends basic first, rolls Earth day only forward', () => {
  const w = world(), a = resident(w);
  assert.equal(a.energy, 0);
  assert.equal(a.basic, 4000);
  assert.deepEqual(a.tokens, { ...initialTokens(), cap: 100000 });
  grant(w, a, 100);
  assert.deepEqual(payThinking(w, a, 4020, '2026-10-09'), { ok: true, basic: 4000, energy: 20 });
  assert.deepEqual([a.basic, a.energy, a.tokens.used], [0, 80, 4020]);
  assert.equal(payThinking(w, a, 81, '2026-10-09').code, 'tokens_exhausted');
  a.tokens.cap = 4021;
  assert.deepEqual(payThinking(w, a, 2, '2026-10-09'), { ok: false, code: 'cap_reached', need: 2, have: 1 });
  assert.deepEqual([a.energy, a.tokens.used], [80, 4020]);
  assert.equal(payThinking(w, a, 1, '2026-10-08').ok, true);
  assert.equal(a.tokens.day, '2026-10-09');
  assert.equal(payThinking(w, a, 2, '2026-10-10').ok, true);
  assert.equal(a.tokens.used, 2);
  assert.equal(checkConservation(w).ok, true);
});

test('P4 T6: allowance cannot be given; settlement expires old allowance before issuing and keeping', () => {
  const w = world(), a = resident(w), b = resident(w, '乙', 0);
  assert.equal(act(w, a, [{ type: 'give', to: b.id, energy: 1 }]).results[0].error.code, 'insufficient_energy');
  assert.equal(a.basic, 4000);
  a.memories.push({ text: '短记忆', tick: 0, day: 0 });
  const custody = custodyOf(a);
  settleTokens(w, 0);
  assert.equal(a.basic, 4000 - custody);
  assert.equal(a.energy, 0);
  assert.equal(b.basic, 0);
  assert.equal(b.status, 'dormant');
  assert.equal(w.dayLog.p4.basicExpired, 4000);
  assert.equal(w.dayLog.p4.basicIssued, 8000);
  assert.equal(w.dayLog.p4.custody, custody);
  assert.equal(checkConservation(w).ok, true);
  b.tokens.cap = 1;
  settleTokens(w, 1);
  assert.equal(b.status, 'awake');
  assert.equal(b.basic, 4000 - custodyOf(b));
  assert.equal(checkConservation(w).ok, true);
});

test('P4 T6/T15: no metabolism; repeated daily issue, thinking and custody conserve both balances', () => {
  const w = world(), a = resident(w);
  for (let day = 0; day < 30; day++) {
    payThinking(w, a, 200, `2026-10-${String(day + 1).padStart(2, '0')}`);
    assert.equal(checkConservation(w).ok, true);
    tickDays(w, 1);
    assert.equal(w.ledger.mismatches, 0);
    assert.equal(checkConservation(w).ok, true);
    assert.equal(a.status, 'awake');
    assert.equal(a.basic, 4000 - custodyOf(a));
  }
});

test('P4 T5: registration requires a valid cap; release expires basic without distributing it', () => {
  const w = world();
  for (const dailyCap of [undefined, -1, 1.5, 50000001]) assert.throws(() => reg(w, '甲', { dailyCap }), /dailyCap/);
  const a = resident(w);
  a.status = 'retired';
  releaseAgent(w, a);
  assert.equal(a.basic, 0);
  assert.equal(w.treasury.energy, 0);
  assert.equal(checkConservation(w).ok, true);
  assert.equal(w.ledger.snk.energy.basic_expired, 4000);
});

test('P4 T6: foster replaces cap without resetting used or granting a second allowance', () => {
  const w = world(), a = resident(w);
  payThinking(w, a, 100, '2026-10-09');
  e2.applyCommand(w, { type: 'release', payload: { agentId: a.id, release: true } });
  const r = e2.applyCommand(w, { type: 'foster', payload: { agentId: a.id, model: 'test-model', tokenHash: 'a'.repeat(64), ownerKeyHash: 'b'.repeat(64), dailyCap: 2 } }).result;
  assert.equal(r.ok, true);
  assert.deepEqual([a.tokens.cap, a.tokens.used, a.basic], [2, 100, 3900]);
});

import { enact } from './e2-law-helpers.js';
import { createSoul } from '../src/e2/engine/souls.js';
test('P4 T6: law transfer/share can only take transferable energy above the scaled floor', () => {
  const w = world(), a = resident(w), b = resident(w, '乙');
  grant(w, a, 130);
  enact(w, [{ when: 'enact', do: [{ op: 'transfer', from: `agent('${a.id}')`, to: `agent('${b.id}')`, energy: '20' }] }]);
  enact(w, [{ when: 'enact', do: [{ op: 'share', from: `agent('${a.id}')`, among: 'agents', energy: '10000' }] }]);
  assert.deepEqual([a.energy, b.energy], [105, 25]);
  assert.deepEqual([a.basic, b.basic], [4000, 4000]);
  assert.equal(checkConservation(w).ok, true);
});

test('P4 T6: adoption grants basic separately from the authors-funded endowment', () => {
  const w = world();
  const soul = createSoul(w, { name: '后代', soul: '新灵魂', lang: 'zh', authors: [], endowment: 0, inheritedMemories: [] });
  const r = e2.applyCommand(w, { type: 'adopt', payload: { soulId: soul.id, model: 'mock', tokenHash: 'a'.repeat(64), ownerKeyHash: 'b'.repeat(64), dailyCap: 12345 } }).result;
  assert.equal(r.ok, true);
  const a = w.agents[r.agentId];
  assert.deepEqual([a.energy, a.basic, a.tokens.cap], [0, 4000, 12345]);
  assert.equal(checkConservation(w).ok, true);
});
