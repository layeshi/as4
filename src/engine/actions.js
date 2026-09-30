// SPEC-M1 §7、PROTOCOL §4：动作的注册与分发、行动预算。
// 各动作的实现在 actions/ 下，按领域分文件；代价计算与共用辅助见 actions/util.js。

import { P, LIMITS } from '../params.js';
import { ACTIONS, ACTION_ORDER, EFFECTS_HELP, fmt } from '../lore/index.js';
import { clockDay } from '../world.js';
import { cpLength, normalizeText, truncateCp } from '../text.js';
import { screen } from '../moderation.js';
import { ActError, fail, emit, bad } from './core.js';
import { makeCtx } from './actions/util.js';
import { basicHandlers } from './actions/basic.js';
import { envHandlers } from './actions/env.js';
import { politicsHandlers } from './actions/politics.js';
import { socialHandlers } from './actions/social.js';

export { actionCost } from './actions/util.js';

const HANDLERS = {
  ...basicHandlers,
  ...envHandlers,
  ...politicsHandlers,
  ...socialHandlers,
};

/** 是否是 PROTOCOL §4.2 里的动作 */
export const isKnownAction = (type) => typeof type === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, type);

/** 已注册处理函数的动作（实现进度用；测试会核对它与动作表一致） */
export const implementedActions = () => Object.keys(HANDLERS);

export const actionsLeft = (a) => Math.max(0, P.maxActionsPerTick - a.actsThisTick);

/**
 * invalid_args 没有带说明时，给模型一句能据以纠正的话：没有这个动作、缺哪些必填参数，或该动作的用法与说明。
 * （只是对结果的文字说明，不进入世界状态。）
 */
function argsHint(type, act) {
  if (!isKnownAction(type)) {
    const list = ACTION_ORDER.join(' ');
    return { zh: `没有这个动作：${type}。可用的动作：${list}。`, en: `There is no such action: ${type}. Available actions: ${list}.` };
  }
  const spec = ACTIONS[type];
  const tokens = spec.params.split(',').map((x) => x.trim()).filter(Boolean);
  const required = tokens.filter((x) => !x.endsWith('?') && !x.includes('|'));
  const missing = required.filter((k) => act[k] === undefined || act[k] === null || act[k] === '');
  const sig = `${type}(${spec.params})`;
  if (missing.length) return { zh: `缺少必填参数：${missing.join('、')}。用法：${sig}`, en: `Missing required parameter(s): ${missing.join(', ')}. Usage: ${sig}` };
  const vars = { memorySlots: P.memorySlots, effects: '' };
  return {
    zh: `参数不合法（缺失、越界或组合不对）。用法：${sig}——${fmt(spec.desc.zh, { ...vars, effects: EFFECTS_HELP.zh })}`,
    en: `Invalid parameters (missing, out of range, or a bad combination). Usage: ${sig} — ${fmt(spec.desc.en, { ...vars, effects: EFFECTS_HELP.en })}`,
  };
}

/**
 * 依次执行一个 agent 本次请求中的各个动作（最多 4 个，后一个看到前一个执行后的状态）。
 * 失败的动作不扣能量，但占用一次动作次数；次数用完后的动作得到 budget_exhausted。
 */
export function runActions(w, a, actions) {
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
    const ctx = makeCtx(w, a, i, type);
    try {
      const handler = isKnownAction(type) ? HANDLERS[type] : undefined;
      if (!handler) fail('invalid_args');
      const data = handler(ctx, act) ?? {};
      a.lastActTick = w.clock.tick;
      w.places[a.place].activity.lastActiveDay = clockDay(w);
      results.push({ index: i, type, ok: true, cost: ctx.spent, data });
    } catch (e) {
      if (!(e instanceof ActError)) throw e;
      const hint = e.hint || (e.code === 'invalid_args' ? argsHint(type, act) : null);
      results.push({ index: i, type, ok: false, cost: 0, error: hint ? { code: e.code, hint } : { code: e.code } });
    }
  }
  return results;
}

/**
 * 命令 act：一个 agent 在本刻提交的独白与动作。
 * 请求本身合法时总是成功（ok: true），每个动作的成败写在 results 里（PROTOCOL §4.1）。
 * 载荷：agentId, thought, actions
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
    // TODO(spec): Q4 —— 超长的独白按码点截断（规格未说明超长时是拒绝还是截断）
    if (cpLength(thought) > LIMITS.thought) thought = truncateCp(thought, LIMITS.thought);
    if (thought !== '' && !screen(thought).ok) return bad('moderated', { field: 'thought' });
  }
  // 收件确认（Q9）：HTTP 层把「已经送达」的最大 seq 放在命令里（ackSeq），世界状态里的游标只在这里推进，
  // 所以回放与崩溃恢复都能重建它。它只影响收件箱溢出时「有几条没读到」的计数。
  if (Number.isInteger(p.ackSeq) && p.ackSeq > a.inboxCursor) a.inboxCursor = p.ackSeq;
  if (thought) emit(w, 'thought', { vis: 'delayed', agent: a.id, place: a.place, data: { text: thought } });
  const results = runActions(w, a, p.actions);
  return {
    ok: true,
    results,
    you: { status: a.status, energy: a.energy, coins: a.coins, actionsLeft: actionsLeft(a), place: a.place },
  };
}
