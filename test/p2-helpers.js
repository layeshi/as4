// 第二前提测试的共用辅助（SPEC-P2）。
import assert from 'node:assert/strict';
import { validateRules } from '../src/e2/rules/check.js';
import { createLaw } from '../src/e2/engine/laws.js';
import { runEnact, citySet } from '../src/e2/engine/rules.js';
import { staticLookup } from '../src/e2/engine/legislation.js';
import { newWorld, reg, setHoldings } from './e2-helpers.js';

/**
 * 直接生效一部带规则的城法（绕过表决），校验时带上世界的设定版本——和 propose 一样。
 * test/e2-law-helpers.js 的 enact 不带设定版本，所以第二前提里的 before:standing 之类写不进去；那个文件不改。
 */
export function enactP2(w, rules, extra = {}) {
  const v = validateRules(rules, { scope: { premise: w.premise || 0, kind: 'city' }, lookup: staticLookup(w), human: !!extra.human });
  assert.ok(v.ok, JSON.stringify(v.issues));
  const law = createLaw(w, { title: extra.title || 'T', text: extra.text || 'x', author: extra.author || 'humans', rules: v.rules });
  law.results = runEnact(w, citySet(law));
  return law;
}

/** 一座 n 位居民的第二前提的城（或 premise 指定的设定）；居民能量充足 */
export function town(n = 2, seed = 'p2', { premise = 2, energy = 100, slots = 12 } = {}) {
  const w = newWorld(seed, { premise, shellSlots: slots });
  const people = Array.from({ length: n }, (_, i) => reg(w, `居民${i + 1}`));
  for (const a of people) setHoldings(w, a, { energy });
  return { w, people };
}
