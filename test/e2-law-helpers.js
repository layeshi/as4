// 第 4–5 步测试共用的辅助：直接生效一部城法、设定社群章程与地点规则（绕过表决与 rules 动作，便于测试规则本身）。
import assert from 'node:assert/strict';
import { P } from '../src/e2/params.js';
import { validateRules } from '../src/e2/rules/check.js';
import { createLaw } from '../src/e2/engine/laws.js';
import { runEnact, citySet, groupSet, placeSet } from '../src/e2/engine/rules.js';
import { staticLookup } from '../src/e2/engine/legislation.js';

/** 直接生效一部带规则的城法（绕过表决；表决路径见 e2-legislation.test.js） */
export function enact(w, rules, extra = {}) {
  const v = validateRules(rules, { scope: { kind: 'city' }, lookup: staticLookup(w), human: !!extra.human });
  assert.ok(v.ok, JSON.stringify(v.issues));
  const law = createLaw(w, { title: extra.title || 'T', text: extra.text || 'x', author: extra.author || 'humans', rules: v.rules });
  law.results = runEnact(w, citySet(law));
  return law;
}

/** 给社群设定章程（绕过 rules 动作；动作本身见第 5 步） */
export function setBylaws(w, gid, rules) {
  const g = w.groups[gid];
  const v = validateRules(rules, { scope: { kind: 'group', id: gid }, lookup: staticLookup(w) });
  assert.ok(v.ok, JSON.stringify(v.issues));
  g.bylaws = { rules: v.rules, fingerprints: [], setTick: w.clock.tick, setBy: g.steward, paidThrough: Math.floor(w.clock.tick / P.ticksPerDay), suspendedDays: 0 };
  runEnact(w, groupSet(g));
  return g.bylaws;
}

/** 给地点设定地点规则（绕过 rules 动作） */
export function setPlaceRules(w, pid, rules) {
  const p = w.places[pid];
  const v = validateRules(rules, { scope: { kind: 'place', id: pid }, lookup: staticLookup(w) });
  assert.ok(v.ok, JSON.stringify(v.issues));
  p.rules = { rules: v.rules, fingerprints: [], setTick: w.clock.tick, setBy: p.owner.id, paidThrough: Math.floor(w.clock.tick / P.ticksPerDay), suspendedDays: 0 };
  runEnact(w, placeSet(p));
  return p.rules;
}

