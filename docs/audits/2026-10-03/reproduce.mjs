// Diagnostic probes assert the observed defects, not corrected behavior.
// Run: node docs/audits/2026-10-03/reproduce.mjs
// Synthetic worlds only; no production writes or model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newWorld, reg, one, putAt, setTreasury, settle, tick, actRaw } from '../../../test/e2-helpers.js';
import { enact } from '../../../test/e2-law-helpers.js';
import { runAgent } from '../../../runner/agent.js';
import { buildPerception } from '../../../src/e2/engine/perception.js';
const evidence = JSON.parse(fs.readFileSync(new URL('./public-evidence.json', import.meta.url)));
const l10daily = evidence.laws.find(l => l.id === 'l10').rules[1];

{
  const w = newWorld(), a = reg(w, '审计居民');
  const r = one(w, a, { type: 'draft', rules: [l10daily] });
  assert.equal(r.ok, true);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.preview[0].error, 'type');
  assert.match(r.data.preview[0].detail, /null/);
  console.log('REPRO draft: ok=true but preview contains a null arithmetic error');
  w.laws.l3.status = 'repealed';
  const law = enact(w, [l10daily]);
  const events = settle(w);
  assert.ok(events.some(e => e.type === 'rule_error' && e.data.owner === law.id));
  assert.equal(w.vars.ncit, undefined);
  assert.ok(!events.some(e => e.type === 'rule_op' && e.data.owner === law.id));
  console.log('REPRO l10: daily settlement discards all intents, including initial set');
}

{
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
  console.log('FIX VERIFIED two-round runAgent: model receives draft error and read document body');
}

{
  const w = newWorld(); reg(w, '甲'); reg(w, '乙');
  w.laws.l3.status = 'repealed';
  enact(w, [{ when: 'daily', do: [{ op: 'each', in: 'agents', do: [
    { op: 'transfer', from: 'treasury', to: 'it', energy: '30' },
  ] }] }]);
  const events = settle(w);
  const paid = events.filter(e => e.type === 'rule_op' && e.data.op === 'transfer').reduce((n,e) => n + e.data.energy, 0);
  assert.equal(paid, 60);
  assert.equal(w.metrics.at(-1).rationPerCapita, 0);
  console.log('REPRO metrics: each resident receives 30, rationPerCapita remains 0');
}

{
  const w = newWorld(), a = reg(w, '修缮者');
  enact(w, evidence.laws.find(l => l.id === 'l8').rules);
  setTreasury(w, { energy: 100 });
  putAt(w, a, 'library'); w.places.library.condition = 9000;
  const before = w.treasury.energy;
  assert.equal(one(w, a, { type: 'repair', energy: 4 }).ok, true);
  assert.equal(before - w.treasury.energy, 2);
  putAt(w, a, 'well'); w.places.well.condition = 7900;
  assert.equal(one(w, a, { type: 'draw', energy: 3 }).ok, true);
  console.log('REPRO l8: library repair gets well subsidy; 79% well permits drawing 3');
}
