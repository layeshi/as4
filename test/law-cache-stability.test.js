import test from 'node:test';
import assert from 'node:assert/strict';
import { town } from './p2-helpers.js';
import { collectRule } from '../src/e2/rules/ops.js';
import { parseCached } from '../src/e2/rules/parser.js';
import { makeHost } from '../src/e2/engine/rulehost.js';
import { newBudget } from '../src/e2/rules/eval.js';

test('optimized fuel and effects do not depend on global parser-cache eviction', () => {
  const { w } = town(32, 'parser-eviction');
  const rule = { when: 'daily', do: [{ op: 'each', in: 'agents', do: [{ op: 'transfer', from: 'treasury', to: 'it', energy: "count(filter(agents, has_tag(it, 'citizen')))", coins: 'it.energy - it.energy' }] }] };
  const measured = [], outputs = [];
  for (let trial = 0; trial < 2; trial++) {
    const budget = newBudget(100000); budget.memo = new Map();
    const host = makeHost(w), field = host.field;
    let evicted = false;
    host.field = (ref, name) => {
      if (trial && !evicted && name === 'energy') {
        evicted = true;
        // Cache bookkeeping does not change the world's field values.
        for (let i = 0; i < 4001; i++) parseCached(String(100000 + i));
      }
      return field(ref, name);
    };
    outputs.push(collectRule(rule, { host, env: {}, budget }));
    measured.push(budget.steps);
  }
  assert.equal(new Set(measured).size, 1, `fuel changed with parser cache: ${measured}`);
  for (const out of outputs) assert.deepEqual(out, outputs[0]);
});
