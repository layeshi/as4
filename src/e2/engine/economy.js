import { ep } from './tokens.js';
// SPEC-E2 §14.2 第 1、5 步：源井日产（全部进入公库，配给是遗法 l3 的规则）与腐坏。

import { P } from '../params.js';
import { agentList } from '../world.js';
import { source, sink } from './ledger.js';
import { wellOutput } from './environment.js';
import { reservoirBonus } from './places.js';

// ── 腐坏上限 ────────────────────────────────────────────────

/** 居民的腐坏上限 = 120 + 200 × min(3, 其名下运转中的储能数) */
export const agentCap = (w, a) => ep(w, 'capAgent') + reservoirBonus(w, 'agent', a.id);
export const groupCap = (w, g) => ep(w, 'capGroup') + reservoirBonus(w, 'group', g.id);
export const treasuryCap = (w) => ep(w, 'capTreasury') + reservoirBonus(w, 'city', null);

// ── 每日结算第 1 步：源井日产 ─────────────────────────────────

/** 计算源井日产并记账，全部进入公库；返回产出 */
export function produceWell(w, d) {
  const output = wellOutput(w, d);
  source(w, 'energy', 'well_output', output);
  w.treasury.energy += output;
  w.well.outputHistory.push(output);
  if (w.well.outputHistory.length > P.wellHistoryDays) w.well.outputHistory.shift();
  w.dayLog.output = output;
  return output;
}

// ── 每日结算第 5 步：腐坏 ───────────────────────────────────

// 整数运算：floor(超出 × 千分比 / 1000)，千分比 = round(decayRate × 1000)（与 v1 相同，避免浮点误差）
const decayOf = (excess) => Math.floor((excess * Math.round(P.decayRate * 1000)) / 1000);

/** 超出上限的部分每日流失 floor(超出 × 0.1)：居民、社群公库、城公库 */
export function decayEnergy(w) {
  for (const a of agentList(w)) {
    if (a.status !== 'awake' && a.status !== 'dormant') continue;
    const excess = a.energy - agentCap(w, a);
    if (excess > 0) {
      const loss = decayOf(excess);
      a.energy -= loss;
      sink(w, 'energy', 'decay', loss);
    }
  }
  for (const g of Object.values(w.groups)) {
    if (g.dissolved) continue;
    const excess = g.treasury.energy - groupCap(w, g);
    if (excess > 0) {
      const loss = decayOf(excess);
      g.treasury.energy -= loss;
      sink(w, 'energy', 'decay', loss);
    }
  }
  const excess = w.treasury.energy - treasuryCap(w);
  if (excess > 0) {
    const loss = decayOf(excess);
    w.treasury.energy -= loss;
    sink(w, 'energy', 'decay', loss);
  }
}
