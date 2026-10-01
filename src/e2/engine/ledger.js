// SPEC-E2 §15：能量与旧币的账本与守恒校验（第二纪）。
//
// 每一笔进出城的流动都要记账：
//   能量来源 well_output draw wilds salvage immigrant admin
//   能量去处 action_cost metabolism decay repair project_built project_abandoned soul_faded cradle_loss rule_upkeep rule_ops embodiment
//   旧币来源 immigrant mint wilds admin（没有去处）
// 守恒式：今日持有 = 昨日持有 + 今日来源合计 − 今日去处合计（必须精确相等）。
// 城内的转移（赠予、规则的转移与配给、遗产、交易托管、为躯壳出资……）不是来源也不是去处。

import { agentList } from '../world.js';

export const ENERGY_SOURCES = ['well_output', 'draw', 'wilds', 'salvage', 'immigrant', 'admin'];
export const ENERGY_SINKS = [
  'action_cost', 'metabolism', 'decay', 'repair', 'project_built', 'project_abandoned', 'soul_faded', 'cradle_loss',
  'rule_upkeep', 'rule_ops', 'embodiment',
];
export const COIN_SOURCES = ['immigrant', 'mint', 'wilds', 'admin'];

/** 记一笔来源。kind：energy | coins；n 为整数（admin 可以为负） */
export function source(w, kind, key, n) {
  if (!n) return;
  const bag = w.ledger.src[kind];
  bag[key] = (bag[key] || 0) + n;
}

/** 记一笔去处 */
export function sink(w, kind, key, n) {
  if (!n) return;
  const bag = w.ledger.snk[kind];
  bag[key] = (bag[key] || 0) + n;
}

const total = (bag) => Object.values(bag).reduce((s, x) => s + x, 0);

/** 当前所有持有者手里的能量与旧币合计 */
export function holdings(w) {
  let energy = w.treasury.energy;
  let coins = w.treasury.coins;
  for (const a of agentList(w)) {
    energy += a.energy;
    coins += a.coins;
  }
  for (const g of Object.values(w.groups)) {
    energy += g.treasury.energy;
    coins += g.treasury.coins;
  }
  for (const o of Object.values(w.offers)) {
    if (o.status === 'open') {
      energy += o.give.energy;
      coins += o.give.coins;
    }
  }
  for (const c of Object.values(w.pacts)) if (c.status === 'open') energy += c.escrow;
  for (const s of Object.values(w.souls)) energy += s.endowment + s.fund;
  for (const j of Object.values(w.projects)) if (j.status === 'open') energy += j.have;
  return { energy, coins };
}

/** 校验守恒：返回 { ok, energy: {expected, actual}, coins: {expected, actual}, ... } */
export function checkConservation(w) {
  const actual = holdings(w);
  const L = w.ledger;
  const expected = {
    energy: L.prev.energy + total(L.src.energy) - total(L.snk.energy),
    coins: L.prev.coins + total(L.src.coins) - total(L.snk.coins),
  };
  return {
    ok: expected.energy === actual.energy && expected.coins === actual.coins,
    energy: { expected: expected.energy, actual: actual.energy },
    coins: { expected: expected.coins, actual: actual.coins },
    src: { energy: { ...L.src.energy }, coins: { ...L.src.coins } },
    snk: { energy: { ...L.snk.energy }, coins: { ...L.snk.coins } },
    prev: { ...L.prev },
  };
}

/** 今日来源与去处的合计（供指标使用） */
export function dayFlows(w) {
  return {
    energyIn: total(w.ledger.src.energy),
    energyOut: total(w.ledger.snk.energy),
    coinsIn: total(w.ledger.src.coins),
  };
}

/** 日终：以实际持有为新的「昨日持有」，清空当日流水 */
export function closeLedgerDay(w) {
  w.ledger.prev = holdings(w);
  w.ledger.src = { energy: {}, coins: {} };
  w.ledger.snk = { energy: {}, coins: {} };
}
