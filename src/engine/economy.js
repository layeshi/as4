// SPEC-M1 §7.2：源井日产、配给、津贴（在 laws.js）、财富税、腐坏。

import { P } from '../params.js';
import { agentList } from '../world.js';
import { source, sink } from './ledger.js';
import { pushInbox, mulPermille, toPermille } from './core.js';
import { wellOutput, reservoirBonus } from './environment.js';

// ── 腐坏上限 ────────────────────────────────────────────────

/** agent 的腐坏上限 = 120 + 200 × min(3, 其个人所有、正常运转的蓄能池数) */
export const agentCap = (w, a) => P.capAgent + reservoirBonus(w, 'agent', a.id);
export const groupCap = (w, g) => P.capGroup + reservoirBonus(w, 'group', g.id);
export const treasuryCap = (w) => P.capTreasury + reservoirBonus(w, 'city', null);

// ── 每日结算第 1、2 步：源井日产与配给 ─────────────────────────

/** 配给资格：醒着、已入籍、未被放逐；若 rationRequiresActivity，还须在最近 12 刻内成功行动过 */
function rationEligible(w, a, d) {
  if (a.status !== 'awake' || a.citizenFromDay > d || a.exiled) return false;
  if (w.params.rationRequiresActivity) {
    // 结算时钟面已是 12(d+1)：「最近 12 刻」即刚结束的这一日的 12 刻（tick ≥ 12d）
    return a.lastActTick !== null && a.lastActTick >= w.clock.tick - P.ticksPerDay;
  }
  return true;
}

/**
 * 第 1 步：计算源井日产并记账；第 2 步：发放配给。
 * pool = floor(output × rationShare)；每人 floor(pool / 人数)，余数与 output − pool 进入公库；
 * 没有人有资格时，output 全部进入公库。
 */
export function produceAndRation(w, d) {
  const output = wellOutput(w, d);
  source(w, 'energy', 'well_output', output);
  w.well.outputHistory.push(output);
  if (w.well.outputHistory.length > P.wellHistoryDays) w.well.outputHistory.shift();

  const eligible = agentList(w).filter((a) => rationEligible(w, a, d));
  let each = 0;
  if (eligible.length === 0) {
    w.treasury.energy += output;
  } else {
    const pool = mulPermille(output, toPermille(w.params.rationShare));
    each = Math.floor(pool / eligible.length);
    const rest = pool - each * eligible.length;
    w.treasury.energy += output - pool + rest;
    if (each > 0) {
      for (const a of eligible) {
        a.energy += each;
        pushInbox(w, a, 'ration', { energy: each });
      }
    }
  }
  w.dayLog.output = output;
  w.dayLog.ration = each;
  w.dayLog.rationed = eligible.length;
  return { output, ration: each, recipients: eligible.length };
}

// ── 每日结算第 4 步：财富税 ─────────────────────────────────

/** 对每个醒着的 agent：tax = floor((energy − 起征点) × wealthTax)（为正时）进入公库 */
export function collectWealthTax(w) {
  const rate = toPermille(w.params.wealthTax);
  if (rate <= 0) return;
  const threshold = w.params.wealthTaxThreshold;
  for (const a of agentList(w)) {
    if (a.status !== 'awake') continue;
    const over = a.energy - threshold;
    if (over <= 0) continue;
    const tax = mulPermille(over, rate);
    if (tax <= 0) continue;
    a.energy -= tax;
    w.treasury.energy += tax;
    // TODO(spec): Q3 —— PROTOCOL §5 的 tax 收件有个字段也叫 kind，与收件自身的 kind 冲突；暂用 taxKind
    pushInbox(w, a, 'tax', { taxKind: 'wealth', energy: tax });
  }
}

// ── 每日结算第 6 步：腐坏 ───────────────────────────────────

function decayOf(excess) {
  return mulPermille(excess, toPermille(P.decayRate));
}

/** 超出上限的部分每日流失 floor(超出 × 0.1)：agent、社群公库、城公库 */
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
