// SPEC-E2 §7.7：账户——城公库、居民、社群公库、摇篮中的灵魂（为躯壳出资）。
//
// 规则引擎的 transfer / share / fee / mint 与动作框架收的费都通过这里入账与出账。账户的形状：
//   { k: 'treasury' } | { k: 'agent', id } | { k: 'group', id } | { k: 'soul', id }
// 记账（来源与去处）不在这里：账户之间的转移既不是来源也不是去处。

import { P } from '../params.js';
import { clockDay, isAlive } from '../world.js';
import { pushInbox, creditEnergy, ref, emit } from './core.js';
import { noteQueued } from './shells.js';

/** Validate captured accounts again before moving assets; souls cannot hold coins. */
export function accountProblem(w, acct, coins = 0) {
  if (acct.k === 'treasury') return null;
  if (acct.k === 'agent') return w.agents[acct.id] && isAlive(w.agents[acct.id]) ? null : 'invalid_account';
  if (acct.k === 'group') return w.groups[acct.id] && !w.groups[acct.id].dissolved ? null : 'invalid_account';
  if (acct.k === 'soul') return !w.souls[acct.id] ? 'invalid_account' : coins > 0 ? 'unsupported_asset' : null;
  return 'invalid_account';
}

/** 账户的余额 { energy, coins }（灵魂只有 energy = fund，旧币为 0；居民可转的额度见 transferable） */
export function balanceOf(w, acct) {
  switch (acct.k) {
    case 'treasury': return { energy: w.treasury.energy, coins: w.treasury.coins };
    case 'group': return { energy: w.groups[acct.id].treasury.energy, coins: w.groups[acct.id].treasury.coins };
    case 'agent': return { energy: w.agents[acct.id].energy, coins: w.agents[acct.id].coins };
    case 'soul': return { energy: w.souls[acct.id].fund, coins: 0 };
    default: throw new Error(`balanceOf: unknown account ${acct.k}`);
  }
}

/** 账户的出账：调用者保证余额足够 */
export function debit(w, acct, energy, coins) {
  switch (acct.k) {
    case 'treasury': w.treasury.energy -= energy; w.treasury.coins -= coins; return;
    case 'group': w.groups[acct.id].treasury.energy -= energy; w.groups[acct.id].treasury.coins -= coins; return;
    case 'agent': w.agents[acct.id].energy -= energy; w.agents[acct.id].coins -= coins; return;
    default: throw new Error(`debit: cannot debit ${acct.k}`);
  }
}

/** 账户的来源键（出资者名录 sponsors 的键）：居民 ID、社群 ID 或 'treasury' */
export const sponsorKey = (acct) => (acct.k === 'treasury' ? 'treasury' : acct.id);

/**
 * 账户的入账。居民入账用 creditEnergy（可能唤醒沉睡者，by 是唤醒者）；灵魂入账 = 出资：fund += energy，sponsors[来源] += energy，
 * 首次达到 shellCost 时设 fundedTick 与 queueExpiresDay（SPEC-E2 §12.2）。from：灵魂出资的来源账户。
 */
export function credit(w, acct, energy, coins, by = null, from = null) {
  switch (acct.k) {
    case 'treasury': w.treasury.energy += energy; w.treasury.coins += coins; return;
    case 'group': w.groups[acct.id].treasury.energy += energy; w.groups[acct.id].treasury.coins += coins; return;
    case 'agent': {
      const a = w.agents[acct.id];
      a.coins += coins;
      creditEnergy(w, a, energy, by);
      return;
    }
    case 'soul': {
      const s = w.souls[acct.id];
      s.fund += energy;
      if (from && energy > 0) s.sponsors[sponsorKey(from)] = (s.sponsors[sponsorKey(from)] || 0) + energy;
      if (s.fundedTick === null && s.fund >= P.shellCost) {
        s.fundedTick = w.clock.tick;
        s.queueExpiresDay = clockDay(w) + P.shellQueueDays;
        noteQueued(w, s);
      }
      return;
    }
    default: throw new Error(`credit: unknown account ${acct.k}`);
  }
}

/** 通知账户的持有者：一条规则给了它或从它身上拿走了能量或旧币（收件 transfer）。居民才有收件箱 */
export function notifyTransfer(w, acct, { law, energy, coins, direction, counterparty = null }) {
  if (acct.k !== 'agent') return;
  const a = w.agents[acct.id];
  if (a.status !== 'awake' && a.status !== 'dormant') return;
  pushInbox(w, a, 'transfer', { law, energy, coins, direction, ...(counterparty ? { counterparty } : {}) });
}

/** 对账户的显示引用 { id, name }（居民、社群）或 'treasury' / 灵魂 */
export function acctRef(w, acct) {
  if (acct.k === 'treasury') return { id: 'treasury', name: 'treasury' };
  if (acct.k === 'agent') return ref(w.agents[acct.id]);
  if (acct.k === 'group') return { id: acct.id, name: w.groups[acct.id].name };
  return { id: acct.id, name: w.souls[acct.id].name };
}

/**
 * 动作成功时把规则收的费转给它的去向（费用已从执行者身上扣下）。
 * fee：{ law, to: acct, energy, coins }；a：执行者。去向的居民收到 transfer 收件。
 */
export function payFee(w, a, fee) {
  const from = { k: 'agent', id: a.id };
  credit(w, fee.to, fee.energy, fee.coins, ref(a), from);
  // 规则收的费公开记一条 rule_op（scope 与 owner 由 law 字段还原：法律 ID、group:<g>、place:<id>）
  const scope = fee.law.startsWith('group:') || fee.law.startsWith('place:') ? fee.law : 'city';
  const owner = scope === 'city' ? fee.law : fee.law.slice(fee.law.indexOf(':') + 1);
  w.dayLog.ruleOps++;
  emit(w, 'rule_op', { agent: a.id, place: a.place, data: { scope, owner, rule: fee.rule, op: 'fee', ok: true, who: a.id, to: fee.to.k === 'treasury' ? 'treasury' : fee.to.id, energy: fee.energy, coins: fee.coins } });
  if (fee.to.k === 'agent' && fee.to.id !== a.id) {
    notifyTransfer(w, fee.to, { law: fee.law, energy: fee.energy, coins: fee.coins, direction: 'in', counterparty: ref(a) });
  }
}
