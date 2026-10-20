import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import e2 from '../src/e2/facade.js';
import { makeAgent } from '../src/e2/engine/lifecycle.js';
import { runActions } from '../src/e2/engine/actions.js';
import { source } from '../src/e2/engine/ledger.js';
import { buildSystemPrompt } from '../runner/prompt.js';

const islandPhysics = JSON.parse(readFileSync(new URL('./fixtures/p7-hidden-physics.json', import.meta.url), 'utf8'));
const compactPhysics = {
  version: 1,
  regrowth: {
    baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 },
    thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 },
    factorPermille: 500,
  },
  construction: { fullActionsPerTick: 2, factorPermille: 500 },
};

for (const premise of [5, 6, 7]) for (const capacity of [6000, 1100000]) for (const lang of ['zh', 'en']) {
  test(`P${premise} ${lang} material prices use world units at capacity ${capacity}`, () => {
    const w = e2.createWorld({
      seed: 'material-prompt-pricing', premise, lawSemanticsVersion: 2,
      tokens: { capacity, basic: 18000 }, hiddenPhysics: premise === 7 ? islandPhysics : compactPhysics,
    });
    const a = makeAgent(w, {
      name: '价格核验员', lang, soul: '测试角色', kind: 'external',
      energy: 1000000, coins: 0, place: 'scrapyard', ...(premise === 7 ? { city: 'north' } : {}),
    });
    source(w, 'energy', 'admin', a.energy);
    const before = a.energy;
    const result = runActions(w, a, [{ type: 'gather', amount: 10 }])[0];
    assert.equal(result.ok, true);
    assert.equal(result.data.materials, 10);
    assert.equal(before - a.energy, result.cost);
    const k = w.tokens.k;
    assert.equal(result.cost, 2 * k);
    const afterGather = a.energy;
    const invalid = runActions(w, a, [{ type: 'gather', amount: 0 }])[0];
    assert.equal(invalid.error.code, 'invalid_args');
    assert.equal(a.energy, afterGather);
    assert.ok(invalid.error.hint[lang].includes(`费用 ${result.cost} 词元`));

    for (const toolMode of ['native', 'json']) {
      const prompt = buildSystemPrompt({
        protocol: 2, premise, lang, toolMode, actionTools: 'typed',
        tokenValues: { k, capacity, basicAllotment: w.tokens.basic },
      });
      const line = type => prompt.split('\n').find(text => text.startsWith(`${type}(`));
      for (const [type, price] of [['gather', result.cost], ['construct', k], ['dismantle', 2 * k]]) {
        assert.match(line(type), new RegExp(`\\) ${price}(?: |：|:)`));
        assert.ok(line(type).includes(`费用 ${price}`), `${type} description must match its numeric price: ${line(type)}`);
      }
      assert.ok(line('repair').includes(`每 ${k} 词元`), line('repair'));
      for (const type of ['gather', 'construct', 'dismantle', 'repair']) {
        assert.doesNotMatch(line(type), /\b\d*K\b|\{[^}]+\}/);
      }
    }
  });
}

test('world price formatting preserves resident-authored K notation', () => {
  const soul = '我的共采出资约定是2K词元，先确认再支付。';
  const prompt = buildSystemPrompt({ protocol: 2, premise: 7, lang: 'zh', soul, tokenValues: { k: 1833 } });
  assert.ok(prompt.includes(soul));
});
