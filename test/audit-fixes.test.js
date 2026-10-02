import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventStore } from '../src/events.js';
import { boot } from './http-helpers.js';
import { enact } from './e2-law-helpers.js';
import { summarizeResults } from '../runner/render.js';
import { stateHash } from '../src/store.js';
import { actionFeedback } from '../src/action-feedback.js';

test('draft response exposes runtime failure without changing the engine result', async () => {
  const env = await boot({ physics: 2 });
  try {
    const a = await env.register('试算者');
    const r = await env.call('/api/me/act', { method: 'POST', token: a.agentToken, body: { actions: [{ type: 'draft', rules: [
      { when: 'daily', do: [{ op: 'set', var: 'n', value: 'count(agents)' }, { op: 'set', var: 'pay', value: '100 / var.n' }] },
    ] }] } });
    const d = r.json.results[0].data;
    assert.equal(r.status, 200); assert.equal(d.staticOk, true); assert.equal(d.ok, false); assert.equal(d.previewOk, false);
    assert.match(d.errors[0].message, /null/);
    assert.match(summarizeResults(r.json.results), /draft ✗/);
    const raw = { type: 'draft', ok: true, data: { ok: true, errors: [], preview: [{ rule: 0, error: 'type', detail: 'null' }] } };
    const before = JSON.stringify(raw); actionFeedback(raw); assert.equal(JSON.stringify(raw), before);
  } finally { await env.close(); }
});

test('public metrics count each+transfer without changing world or replay state', async () => {
  const env = await boot({ physics: 2 });
  try {
    await env.register('甲'); await env.register('乙');
    env.rt.w.laws.l3.status = 'repealed';
    enact(env.rt.w, [{ when: 'daily', do: [{ op: 'each', in: 'agents', do: [
      { op: 'transfer', from: 'treasury', to: 'it', energy: '30' },
    ] }] }]);
    for (let i = 0; i < 12; i++) env.rt.tickNow();
    const before = stateHash(env.rt.w);
    const r = await env.call('/api/public/metrics');
    assert.equal(r.json.metrics[0].rationPerCapita, 30);
    assert.equal(r.json.metrics[0].dailyDistributionEnergy, 60);
    assert.equal(r.json.metrics[0].legacyRationPerCapita, 0);
    const s = await env.call('/api/public/state');
    assert.equal(s.json.metrics.rationPerCapita, 30);
    assert.equal(stateHash(env.rt.w), before);
  } finally { await env.close(); }
});

test('fiscal projection survives ring eviction and restart, counts partial actual amounts and separates repair', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fiscal-'));
  try {
    const file = join(dir, 'events.jsonl'), events = new EventStore(file);
    const w = { laws: { l3: { rules: [{ when: 'daily' }] }, l7: { rules: [{ when: 'daily' }] }, l8: { rules: [{ when: 'after:repair' }] } } };
    let seq = 0;
    const emit = data => events.append([{ seq: ++seq, tick: 12, day: 0, type: 'rule_op', vis: 'public', data: { scope: 'city', rule: 0, from: 'treasury', ok: true, ...data } }]);
    emit({ owner: 'l3', op: 'share', among: 2, each: { energy: 29 } });
    for (const to of ['a1', 'a2']) emit({ owner: 'l7', op: 'transfer', to, energy: 29, note: 'partial:29/50' });
    emit({ owner: 'l8', op: 'transfer', to: 'a1', energy: 5 });
    for (let i = 0; i < 2100; i++) events.append([{ seq: ++seq, tick: 13, day: 1, type: 'say', vis: 'public', data: {} }]);
    const fresh = new EventStore(file); fresh.load({ tick: 13 });
    for (const es of [events, fresh]) {
      const m = es.fiscal.metrics(w, { day: 0, awake: 2, dormant: 0, rationPerCapita: 29 });
      assert.equal(m.rationPerCapita, 58); assert.equal(m.dailyDistributionEnergy, 116); assert.equal(m.otherLawPaymentsEnergy, 5);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

import { newWorld, reg, putAt, tick, actRaw } from './e2-helpers.js';
import { runAgent } from '../runner/agent.js';
import { buildPerception } from '../src/e2/engine/perception.js';
test('two-round runner delivers draft diagnostics and read body to next model invocation', async () => {
  const l10daily = { when: 'daily', do: [{op:'set',var:'n',value:'count(agents)'},{op:'set',var:'pay',value:'100 / var.n'}] };
  const w = newWorld(), a = reg(w, '读取者');
  putAt(w, a, 'library');
  const doc = Object.values(w.docs).find(d => d.kind === 'canon' && d.body);
  assert.ok(doc);
  let calls = 0, secondMessages, returned;
  await runAgent({ lang: 'zh', historyRounds: 1 }, {
    maxRounds: 2,
    log: { info() {}, warn() {}, error() {} },
    wait: async () => { tick(w); },
    client: {
      me: async () => ({ ok: true, json: buildPerception(w, a.id, { lang: 'zh', ack: false }) }),
      act: async payload => {
        const r = actRaw(w, a, payload.actions);
        returned = r.result.results;
        return { ok: true, json: r.result };
      },
    },
    provider: { complete: async ({ messages }) => {
      if (++calls === 1) return { text: JSON.stringify({ actions: [
        { type: 'draft', rules: [l10daily] }, { type: 'read', doc: doc.id },
      ] }) };
      secondMessages = messages.map(m => m.content).join('\n');
      return { text: '{"actions":[]}' };
    } },
  });
  assert.equal(returned[0].data.preview[0].error, 'type');
  assert.equal(returned[1].data.doc.body, doc.body);
  assert.ok(secondMessages.includes('draft ✗'));
  assert.ok(secondMessages.includes('read ✓'));
  assert.ok(secondMessages.includes(returned[0].data.preview[0].detail));
  assert.ok(secondMessages.includes(JSON.stringify(doc.body).slice(1, -1)));
});
