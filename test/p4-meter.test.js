import test from 'node:test';
import assert from 'node:assert/strict';
import { bareWorld, reg, grant, tick } from './e2-helpers.js';
import e2 from '../src/e2/facade.js';
import { actionWeight } from '../src/e2/engine/tokens.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
import { pushInbox } from '../src/e2/engine/core.js';
const make = (cap = 100000) => {
  const w = bareWorld('meter4', { premise: 4 });
  return { w, a: reg(w, '甲', { dailyCap: cap }) };
};
const meter = (w, a, op, extra = {}) => e2.applyCommand(w, { type: 'meter', payload: { agentId: a.id, wakeId: 'w0-abcdef', day: '2026-10-09', op, ...extra } }).result;
const wake = (w, a, extra = {}) => meter(w, a, 'wake', { system: 5400, brief: 5000, delivered: a.delivered, kind: 'main', ...extra });
const total = b => b.reread + b.read + b.write;

test('P4 T4: appendix C charges 5540 + 1800 + 1830 = 9170, with matching ledger and bill', () => {
  const { w, a } = make();
  const first = wake(w, a);
  assert.equal(total(first.bill), 5540);
  meter(w, a, 'look', { read: 1800, reread: 0 });
  const actions = [{ type: 'say', text: '甲'.repeat(90) }, { type: 'vote', proposal: 'p1', choice: 'yes', reason: '' }];
  while (actions.reduce((n, act) => n + actionWeight(act), 0) < 160) actions[1].reason += '乙';
  assert.equal(actions.reduce((n, act) => n + actionWeight(act), 0), 160);
  const acted = e2.applyCommand(w, { type: 'act', payload: { agentId: a.id, actions, meter: { wakeId: 'w0-abcdef', turn: 2, reread: 1040, day: '2026-10-09' } } }).result;
  assert.equal(acted.ok, true);
  assert.equal(total(acted.bill), 9020);
  meter(w, a, 'inbox', { read: 150, delivered: 0 });
  assert.deepEqual([a.tokens.bill.reread, a.tokens.bill.read, a.tokens.bill.write], [1580, 6950, 640]);
  assert.equal(a.tokens.used, 9170);
  assert.equal(a.basic, 8830);
  assert.equal(w.ledger.snk.energy.thinking, 9170);
  for (const k of ['reread','read','write']) assert.equal(w.dayLog.p4[k], a.tokens.bill[k]);
  assert.equal(total(first.bill), 5540, 'old receipts do not change when the current bill grows');
  assert.equal(checkConservation(w).ok, true);
});

test('P4 T10: refunds restore both sources, used allowance and conservation; duplicates and later requests cannot refund', () => {
  const { w, a } = make();
  grant(w, a, 100);
  wake(w, a, { system: 0, brief: 18020 });
  assert.deepEqual([a.basic, a.energy], [0, 80]);
  let r = meter(w, a, 'refund');
  assert.equal(r.ok, true);
  assert.deepEqual([a.basic, a.energy, a.tokens.used], [18000, 100, 0]);
  assert.equal(a.tokens.bill, null);
  assert.equal(meter(w, a, 'refund').error.code, 'not_refundable');
  wake(w, a);
  meter(w, a, 'look', { read: 1 });
  assert.equal(meter(w, a, 'refund').error.code, 'not_refundable');
  wake(w, a);
  tick(w);
  assert.equal(meter(w, a, 'refund').error.code, 'not_refundable');
  assert.equal(meter(w, a, 'look', { read: 1 }).error.code, 'no_waking');
  assert.equal(checkConservation(w).ok, true);
});

test('P4 T5/T10: immediate cap, forward-only days, wake refusal and delivery boundaries', () => {
  const { w, a } = make(5540);
  const item = pushInbox(w, a, 'system', { code: 'test' });
  const seq = a.inbox.at(-1).seq;
  void item;
  wake(w, a, { delivered: seq });
  assert.equal(a.delivered, seq);
  assert.equal(a.inboxCursor, seq);
  assert.equal(wake(w, a).error.code, 'cap_reached');
  assert.equal(w.dayLog.p4.refusedCap, 1);
  const cap = n => e2.applyCommand(w, { type: 'cap', payload: { agentId: a.id, cap: n } });
  assert.equal(cap(5541).result.ok, true);
  assert.equal(a.inbox.at(-1).code, 'cap_changed');
  assert.equal(a.inbox.at(-1).direction, 'up');
  assert.equal(meter(w, a, 'look', { read: 1 }).ok, true);
  assert.equal(meter(w, a, 'look', { read: 1 }).error.code, 'cap_reached');
  assert.equal(a.tokens.used, 5541);
  assert.equal(meter(w, a, 'look', { read: 1, day: '2026-10-10' }).ok, true);
  assert.equal(a.tokens.used, 1);
  meter(w, a, 'look', { read: 1, day: '2026-10-09' });
  assert.equal(a.tokens.day, '2026-10-10');
  cap(0);
  assert.equal(a.tokens.used, 2);
  assert.equal(wake(w, a).error.code, 'cap_reached');
  assert.equal(checkConservation(w).ok, true);
});

test('P4 T4: reread rounds up, called totals and lastBill rotate; invalid meters never charge', () => {
  const { w, a } = make();
  let r = wake(w, a, { system: 11, brief: 0 });
  assert.equal(r.bill.reread, 2);
  r = wake(w, a, { system: 1, brief: 2, kind: 'wake', wakeId: 'w0-123456' });
  assert.equal(a.tokens.lastBill.reread, 2);
  assert.deepEqual([a.tokens.wakes, a.tokens.called, a.tokens.calledCost], [2, 1, 3]);
  meter(w, a, 'look', { read: 3, wakeId: 'w0-123456' });
  assert.equal(a.tokens.calledCost, 6);
  const before = a.basic;
  assert.equal(meter(w, a, 'look', { read: -1, wakeId: 'w0-123456' }).error.code, 'invalid_request');
  assert.equal(a.basic, before);
  for (const premise of [0,1,2]) for (const type of ['meter','cap']) assert.deepEqual(e2.applyCommand(bareWorld('old', { premise }), { type }).result.error, { code: 'invalid_request', field: 'type' });
});
