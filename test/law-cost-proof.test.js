import test from 'node:test';
import assert from 'node:assert/strict';
import { town } from './p2-helpers.js';
import { parseCached } from '../src/e2/rules/parser.js';
import { expressionCost, DEFAULT_CAPACITY } from '../src/e2/rules/plan.js';
import { makeHost } from '../src/e2/engine/rulehost.js';
import { evaluate, newBudget } from '../src/e2/rules/eval.js';
import { setHoldings } from './e2-helpers.js';

test('1000 nested expressions retain values, errors, lazy branches and RNG while fitting their cost proof', () => {
  const { w } = town(4, 'proof-differential');
  Object.values(w.agents).forEach((a, i) => setHoldings(w, a, { energy: (i + 1) * 11 }));
  const capacity = { ...DEFAULT_CAPACITY, maxAgents: 4, maxSouls: 4 };
  let seed = 17;
  const pick = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  function expression(depth) {
    if (!depth) return ['it.energy', '3', 'count(agents)', 'count(sample(agents, 2))'][pick(4)];
    const a = expression(depth - 1);
    return [`sum(agents, ${a})`, `sum(filter(agents, it.energy > 17), ${a})`, `if(it.energy > 17, ${a}, 1 / 0)`, `(${a}) + (${a})`][pick(4)];
  }
  let checked = 0;
  while (checked < 1000) {
    const src = expression(1 + pick(3));
    let tree; try { tree = parseCached(src); } catch { continue; }
    const oldWorld = structuredClone(w), newWorld = structuredClone(w);
    const oldBudget = newBudget(Number.MAX_SAFE_INTEGER), newBudget2 = newBudget(expressionCost(tree, capacity));
    newBudget2.memo = new Map();
    const run = (world, budget) => { try { return { value: evaluate(tree, makeHost(world), { it: { $: 'agent', id: 'a1' } }, budget) }; } catch (e) { return { error: e.code }; } };
    assert.deepEqual(run(newWorld, newBudget2), run(oldWorld, oldBudget), src);
    assert.deepEqual(newWorld.rng, oldWorld.rng, src);
    assert.ok(newBudget2.steps <= newBudget2.fuel, src);
    checked++;
  }
});
