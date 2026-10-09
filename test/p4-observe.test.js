import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bareWorld, reg, tickDays } from './e2-helpers.js';
import e2 from '../src/e2/facade.js';
import { TraceStore, cleanRecord } from '../src/runner/traces.js';
import { boot } from './http-helpers.js';

const record = { tick: 12, kind: 'main', mode: 'native', turns: 1, looks: ['inbox','actions','laws:SECRET_TEXT'], acts: [{ type: 'routine', ok: true, text: 'SECRET_TEXT' }], ended: 'tokens', tokens: { in: 100, out: 10 }, ms: 10,
  wakeId: 'w12-abcdef', bill: { reread: 10, read: 20, write: 4, text: 'SECRET_TEXT' }, cap: 99999, basic: 99999, thought: 'SECRET_TEXT' };

test('P4 T23: daily snapshots carry numeric P4 totals, anonymous caps and allowance holders', () => {
  const w = bareWorld('observe4', { premise: 4 });
  const a = reg(w, '甲', { dailyCap: 880000, soul: '密'.repeat(600) });
  reg(w, '乙', { dailyCap: 0 });
  e2.applyCommand(w, { type: 'meter', payload: { op: 'wake', agentId: a.id, wakeId: 'w0-abcdef', day: '2026-10-09', kind: 'main', system: 100, brief: 100, delivered: 0 } });
  e2.applyCommand(w, { type: 'meter', payload: { op: 'look', agentId: a.id, wakeId: 'w0-abcdef', day: '2026-10-09', read: 20 } });
  tickDays(w, 1);
  const m = w.metrics.at(-1);
  assert.deepEqual([m.p4.wakes, m.p4.reread, m.p4.read, m.capsP50, m.capsZero, m.basicHolders], [1,10,120,0,1,1]);
  assert.equal(m.upkeepMax, 600, 'P4 upkeep reports custody, not the retired metabolism formula');
  assert.ok(Object.values(m.p4).every(Number.isInteger));
  assert.notEqual(m.p4, w.dayLog.p4);
  assert.equal(w.dayLog.p4.wakes, 0);
  assert.ok(!JSON.stringify(m).includes('密'));
});

test('P4 T23/Q68: trace bills contain only numbers; daily public totals survive reload without identity or model', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p4-traces-'));
  try {
    const file = join(dir, 'agent-loops.jsonl'), now = () => Date.UTC(2026, 9, 9);
    const s = new TraceStore({ file, premise: 4, now });
    s.append('a1', record, 'PRIVATE_MODEL');
    s.append('a2', { ...record, bill: null, refused: 'cap_reached', ended: 'cap_reached' }, 'PRIVATE_MODEL');
    const saved = readFileSync(file, 'utf8');
    assert.ok(!saved.includes('SECRET_TEXT') && !saved.includes('"cap":') && !saved.includes('"basic":'));
    const one = JSON.parse(saved.split('\n')[0]);
    assert.deepEqual(one.bill, { reread: 10, read: 20, write: 4 });
    assert.equal(one.wakeId, 'w12-abcdef');
    assert.deepEqual(one.looks, ['inbox','actions','laws']);
    const reload = new TraceStore({ file, premise: 4, now });
    const pub = reload.daySummary('2026-10-09');
    assert.deepEqual(pub.bill, { reread: 10, read: 20, write: 4 });
    assert.deepEqual(pub.refused, { tokens_exhausted: 0, cap_reached: 1 });
    assert.ok(!JSON.stringify(pub).includes('PRIVATE_MODEL') && !JSON.stringify(pub).includes('a1'));
    assert.deepEqual(reload.agentsDay('2026-10-09').totals.bill, pub.bill);
    const old = cleanRecord(record, 2);
    assert.equal(Object.hasOwn(old, 'bill'), false);
    assert.equal(old.acts[0].type, 'other');
    assert.equal(old.ended, 'other');
    assert.equal(Object.hasOwn(cleanRecord({ ...record, wakeId: 'SECRET_TEXT', refused: 'SECRET_TEXT' }, 4), 'wakeId'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('P4 T23: public attention publishes aggregates, admin sees per-resident numeric bills', async () => {
  const env = await boot({ physics: 2, premise: 4 });
  try {
    const a = await env.register('甲', { dailyCap: 880000 });
    env.app.ctx.traces.append(a.agentId, record, 'PRIVATE_MODEL');
    const pub = await env.call('/api/public/attention?days=1');
    assert.equal(pub.status, 200);
    assert.deepEqual(pub.json.days[0].bill, { reread: 10, read: 20, write: 4 });
    assert.ok(!pub.text.includes('PRIVATE_MODEL') && !pub.text.includes('SECRET_TEXT'));
    const admin = await env.call('/api/admin/attention', { admin: true });
    assert.equal(admin.status, 200);
    assert.deepEqual(admin.json.agents[0].bill, pub.json.days[0].bill);
    assert.equal(admin.json.agents[0].model, 'PRIVATE_MODEL');
  } finally { await env.close(); }
});
