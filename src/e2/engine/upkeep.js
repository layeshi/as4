import { ep } from './tokens.js';
// SPEC-E2 §7.9：维持费。
//
// 每日结算第 2 步，对日 d 结算，付的是 d + 1 日的维持费：
//   城法：按法律 ID 升序，每部法律付 ruleUpkeep × 带持续时机的规则数（enact 不算），从城公库扣；立法程序免付。
//   社群章程：从社群公库扣，规则同上。
//   地点规则：从主人扣（居民的能量，不受生存底线限制；社群的公库）。
//   付得起则 paidThrough = d + 1；付不起则不扣，suspendedDays += 1，记事件 law_suspended。
//   去处记 rule_upkeep。新生效的法律、章程、地点规则，生效当日视为已付（paidThrough = 今日）。
// 停摆（paidThrough < 今日）的规则，除 enact 外都不执行（rules.js 里的 isSuspended）。

import { P } from '../params.js';
import { agentList, agentic } from '../world.js';
import { emit, pushInbox } from './core.js';
import { sink } from './ledger.js';
import { persistentCount } from './laws.js';
import { STEPS } from './tick.js';

/** 一份规则每日的维持费 */
export const upkeepOf = (rules, w = {}) => ep(w, 'ruleUpkeep') * persistentCount(rules);

function suspend(w, d, holder, scope, owner, title) {
  holder.suspendedDays += 1;
  w.dayLog.suspended.push({ scope, owner, title });
  emit(w, 'law_suspended', { data: { scope, owner, day: d } });
}

/** 付一份维持费：account 是 { energy } 的持有者对象（城公库、社群公库，或居民 —— 居民的 energy 在对象本身上） */
function pay(w, holder, cost, account, d) {
  if (cost === 0) {
    holder.paidThrough = d + 1;
    return true;
  }
  if (account.energy < cost) return false;
  account.energy -= cost;
  sink(w, 'energy', 'rule_upkeep', cost);
  w.dayLog.upkeepPaid += cost;
  holder.paidThrough = d + 1;
  return true;
}

export function payUpkeep(w, d) {
  // 城法
  for (const law of Object.values(w.laws)) {
    if (law.status !== 'active') continue;
    if (law.procedure) {
      law.paidThrough = d + 1; // 程序免付
      continue;
    }
    if (!pay(w, law, upkeepOf(law.rules, w), w.treasury, d)) suspend(w, d, law, 'city', law.id, law.title);
  }
  // 社群章程
  for (const g of Object.values(w.groups)) {
    if (g.dissolved || !g.bylaws) continue;
    if (!pay(w, g.bylaws, upkeepOf(g.bylaws.rules, w), g.treasury, d)) suspend(w, d, g.bylaws, `group:${g.id}`, g.id, g.name);
  }
  // 地点规则
  for (const p of Object.values(w.places)) {
    if (!p.rules || p.owner.kind === 'city') continue;
    const account = p.owner.kind === 'group' ? w.groups[p.owner.id].treasury : w.agents[p.owner.id];
    if (!pay(w, p.rules, upkeepOf(p.rules.rules, w), account, d)) suspend(w, d, p.rules, `place:${p.id}`, p.id, p.name);
  }
  // 常驻指令（第二前提）
  if (agentic(w)) payStanding(w, d);
}

/**
 * 常驻指令的维持费（SPEC-P2 §5.5）：醒着的居民的每条指令每日 standingUpkeep 能量，去处 standing_upkeep。
 * 自愿付的，不受生存底线限制；付不起的那条当日停摆（paidThrough 不推进），并给本人一条 system: standing_suspended。
 * 沉睡的居民不付，也不推进 paidThrough：醒来之后、下一次日终结算之前，它的指令停摆。
 */
function payStanding(w, d) {
  for (const a of agentList(w)) { // ID 升序
    if (a.status !== 'awake' || !a.standing || a.standing.length === 0) continue;
    let unpaid = 0;
    for (const o of a.standing) {
      if (a.energy >= ep(w, 'standingUpkeep')) {
        a.energy -= ep(w, 'standingUpkeep');
        sink(w, 'energy', 'standing_upkeep', ep(w, 'standingUpkeep'));
        w.dayLog.p2.standingUpkeep += ep(w, 'standingUpkeep');
        o.paidThrough = d + 1;
      } else unpaid++;
    }
    if (unpaid > 0) {
      w.dayLog.p2.standingSuspended += unpaid;
      pushInbox(w, a, 'system', { code: 'standing_suspended' });
    }
  }
}

STEPS.upkeep = payUpkeep;
