import { prayerHandlers } from './actions/prayers.js';
import { prayersEnabled } from './prayer-rewards.js';
// SPEC-E2 §7.6、§16、PROTOCOL-2 §4：动作的注册与分发、行动预算、规则的接入。
// 各动作的实现在 actions/ 下，按领域分文件；代价计算与共用辅助见 actions/util.js。

import { P, LIMITS } from '../params.js';
import { ACTIONS, ACTION_ORDER, NO_BEFORE_ACTIONS, NO_AFTER_ACTIONS, isKnownAction, actionTable } from '../lore/actions.js';
import { fmt } from '../lore/index.js';
import { clockDay } from '../world.js';
import { cpLength, normalizeText, truncateCp } from '../../text.js';
import { screen } from '../../moderation.js';
import { ActError, fail, emit, bad } from './core.js';
import { sink } from './ledger.js';
import { makeCtx } from './actions/util.js';
import { hooks } from './hooks.js';
import { payFee } from './accounts.js';
import { basicHandlers } from './actions/basic.js';
import { envHandlers } from './actions/env.js';
import { socialHandlers } from './actions/social.js';
import { politicsHandlers } from './actions/politics.js';
import { cityHandlers } from './actions/city.js';
import { descentHandlers } from './actions/descent.js';
import { standingHandlers } from './actions/standing.js';

export { actionCost } from './actions/util.js';

/** 动作处理函数的注册表：{ type: { validate, apply } }。后面的步骤陆续加入（politics、city、souls、shells） */
export const HANDLERS = {
  ...prayerHandlers,
  ...basicHandlers,
  ...envHandlers,
  ...socialHandlers,
  ...politicsHandlers,
  ...cityHandlers,
  ...descentHandlers,
  ...standingHandlers,
};

/** 注册更多的处理函数（供按领域分文件的模块在加载时使用） */
export function registerHandlers(more) {
  for (const [type, h] of Object.entries(more)) {
    if (!actionTable(2, true).isKnown(type)) throw new Error(`registerHandlers: unknown action ${type}`);
    if (typeof h.validate !== 'function' || typeof h.apply !== 'function') throw new Error(`registerHandlers: ${type} needs validate and apply`);
    HANDLERS[type] = h;
  }
}

/** 已注册处理函数的动作（实现进度用；测试会核对它与动作表一致） */
export const implementedActions = (premise = 0) => Object.keys(HANDLERS).filter(actionTable(premise).isKnown);

export const actionsLeft = (a) => Math.max(0, P.maxActionsPerTick - a.actsThisTick);

/**
 * invalid_args 没有带说明时，给模型一句能据以纠正的话：没有这个动作、缺哪些必填参数，或该动作的用法与说明。
 * （只是对结果的文字说明，不进入世界状态。）
 */
function argsHint(type, act, premise = 0, prayers = false) {
  const { ACTIONS, ORDER: ACTION_ORDER, isKnown: isKnownAction } = actionTable(premise, prayers);
  if (!isKnownAction(type)) {
    const list = ACTION_ORDER.join(' ');
    return { zh: `没有这个动作：${type}。可用的动作：${list}。`, en: `There is no such action: ${type}. Available actions: ${list}.` };
  }
  const spec = ACTIONS[type];
  const tokens = spec.params.split(',').map((x) => x.trim()).filter(Boolean);
  const required = tokens.filter((x) => !x.endsWith('?') && !x.includes('|') && !x.includes('…'));
  const missing = required.filter((k) => act[k] === undefined || act[k] === null || act[k] === '');
  const sig = `${type}(${spec.params})`;
  if (missing.length) return { zh: `缺少必填参数：${missing.join('、')}。用法：${sig}`, en: `Missing required parameter(s): ${missing.join(', ')}. Usage: ${sig}` };
  const vars = { memorySlots: P.memorySlots };
  return {
    zh: `参数不合法（缺失、越界或组合不对）。用法：${sig}——${fmt(spec.desc.zh, vars)}`,
    en: `Invalid parameters (missing, out of range, or a bad combination). Usage: ${sig} — ${fmt(spec.desc.en, vars)}`,
  };
}

/** 规则收的费汇总：{ energy, coins } */
function feeTotals(fees) {
  let energy = 0;
  let coins = 0;
  for (const f of fees) {
    energy += f.energy;
    coins += f.coins;
  }
  return { energy, coins };
}

/**
 * 执行一个动作（SPEC-E2 §7.6 的处理流程）：
 *   1. validate：只读，做全部物理校验，返回计划（失败不扣能量）
 *   2. 收集 before 规则（城法 → 社群章程 → 地点规则）：任一 deny → forbidden；其余是费用
 *   3. 门（move）：不被允许 → gated
 *   4. 付费：能量须 ≥ 代价 + 托管 + 费用中的能量，旧币同理；不足 → insufficient_*（什么都不扣）
 *   5. 扣动作代价（action_cost）→ apply → 把费用转给各自的去向
 *   6. 收集并施行 after 规则
 */
function runOne(w, a, type, act, index, lang) {
  const { NO_BEFORE: NO_BEFORE_ACTIONS, NO_AFTER: NO_AFTER_ACTIONS } = actionTable(w.premise || 0, prayersEnabled(w));
  const handler = HANDLERS[type];
  if (!handler) fail('invalid_args');
  const ctx = makeCtx(w, a, index, type, lang);
  const plan = handler.validate(ctx, act);
  // 守护律：内心的动作与退出权、重订之权没有 before；内心的动作没有 after；目的地是荒野地带的移动跳过 before（荒野永远可以进入）
  const skipBefore = NO_BEFORE_ACTIONS.includes(type) || !!plan.skipBefore;
  const skipAfter = NO_AFTER_ACTIONS.includes(type);
  const before = skipBefore ? { denied: null, fees: [] } : hooks.before(w, a, type, act, plan);
  if (before.denied) fail('forbidden', null, { law: before.denied.law, reason: before.denied.reason });
  if (plan.gate) plan.gate();
  const fees = before.fees;
  const feeSum = feeTotals(fees);
  const reserve = plan.reserve || { energy: 0, coins: 0 };
  const cost = plan.cost || 0;
  if (a.energy < cost + (reserve.energy || 0) + feeSum.energy) fail('insufficient_energy');
  if (a.coins < (reserve.coins || 0) + feeSum.coins) fail('insufficient_coins');
  if (cost > 0) {
    a.energy -= cost;
    sink(w, 'energy', 'action_cost', cost);
    w.dayLog.actionCost += cost;
    ctx.spent += cost;
  }
  const startPlace = a.place; // after 规则里的地点规则用动作发生时的地点（move 之后 a.place 已变）
  const data = handler.apply(ctx, plan) ?? {};
  if (fees.length) {
    ctx.fees = fees;
    a.energy -= feeSum.energy;
    a.coins -= feeSum.coins;
    ctx.spent += feeSum.energy;
    for (const f of fees) payFee(w, a, f);
    data.fees = fees.map((f) => ({ law: f.law, energy: f.energy, coins: f.coins, to: f.to.k === 'treasury' ? 'treasury' : f.to.id }));
  }
  a.lastActTick = w.clock.tick;
  w.places[a.place].activity.lastActiveDay = clockDay(w);
  if (!skipAfter) hooks.after(w, a, type, act, data, plan, startPlace);
  return { data, spent: ctx.spent };
}

/**
 * 依次执行一个居民本次请求中的各个动作（最多 4 个，后一个看到前一个执行后的状态）。
 * 失败的动作不扣能量，但占用一次动作次数；次数用完后的动作得到 budget_exhausted。
 */
export function runActions(w, a, actions, lang = 'zh') {
  const results = [];
  for (let i = 0; i < actions.length; i++) {
    const act = actions[i];
    const type = (typeof act.type === 'string' ? act.type : String(act.type)).slice(0, 40);
    if (a.status !== 'awake') {
      // 例如本次请求里前面的动作是 retire
      results.push({ index: i, type, ok: false, cost: 0, error: { code: 'not_allowed' } });
      continue;
    }
    if (a.actsThisTick >= P.maxActionsPerTick) {
      results.push({ index: i, type, ok: false, cost: 0, error: { code: 'budget_exhausted' } });
      continue;
    }
    a.actsThisTick++;
    try {
      if (!actionTable(w.premise || 0, prayersEnabled(w)).isKnown(type)) fail('invalid_args');
      const { data, spent } = runOne(w, a, type, act, i, lang);
      results.push({ index: i, type, ok: true, cost: spent, data });
    } catch (e) {
      if (!(e instanceof ActError)) throw e;
      const hint = e.hint || (e.code === 'invalid_args' ? argsHint(type, act, w.premise || 0, prayersEnabled(w)) : null);
      results.push({ index: i, type, ok: false, cost: 0, error: { code: e.code, ...(hint ? { hint } : {}), ...(e.extra || {}) } });
    }
  }
  return results;
}

/**
 * 命令 act：一个居民在本刻提交的独白与动作。
 * 请求本身合法时总是成功（ok: true），每个动作的成败写在 results 里（PROTOCOL-2 §4.1）。
 * 载荷：agentId, thought, actions, ackSeq?, lang?（请求的语言 zh | en，缺省 zh：draft 的说明与 read { law } 的读法按它取）
 */
export function actCommand(w, p) {
  const a = p && typeof p.agentId === 'string' ? w.agents[p.agentId] : null;
  if (!a) return bad('not_found');
  if (w.paused) return bad('paused');
  if (a.status !== 'awake') return bad('not_awake', { status: a.status });
  if (!Array.isArray(p.actions) || p.actions.length > LIMITS.actionsPerRequest) return bad('invalid_request', { field: 'actions' });
  for (const act of p.actions) {
    if (act === null || typeof act !== 'object' || Array.isArray(act)) return bad('invalid_request', { field: 'actions' });
  }
  let thought = null;
  if (p.thought !== undefined && p.thought !== null) {
    if (typeof p.thought !== 'string') return bad('invalid_request', { field: 'thought' });
    thought = normalizeText(p.thought);
    // 超长的独白按码点截断（同第一纪的 Q4）
    if (cpLength(thought) > LIMITS.thought) thought = truncateCp(thought, LIMITS.thought);
    if (thought !== '' && !screen(thought).ok) return bad('moderated', { field: 'thought' });
  }
  // 收件确认（Q9）：HTTP 层把「已经送达」的最大 seq 放在命令里（ackSeq），世界状态里的游标只在这里推进，
  // 所以回放与崩溃恢复都能重建它。它只影响收件箱溢出时「有几条没读到」的计数。
  if (Number.isInteger(p.ackSeq) && p.ackSeq > a.inboxCursor) a.inboxCursor = p.ackSeq;
  if (thought) emit(w, 'thought', { vis: 'delayed', agent: a.id, place: a.place, data: { text: thought } });
  const results = runActions(w, a, p.actions, p.lang === 'en' ? 'en' : 'zh');
  return {
    ok: true,
    results,
    you: { status: a.status, energy: a.energy, coins: a.coins, actionsLeft: actionsLeft(a), place: a.place },
  };
}
