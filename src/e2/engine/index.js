// SPEC-E2 §2：第二纪引擎的命令入口。HTTP 层、运行时与调度器只能通过这些命令改变世界。
//
//   tick          调度器
//   register      港口
//   adopt         港口（领养摇篮里的灵魂）
//   release/foster/model  后台 / 港口
//   act           居民接口
//   letter        后台
//   weather_vote  公共接口
//   admin         管理接口
//
// 令牌与密钥由 HTTP 层用 crypto 生成，只把哈希放进命令载荷，所以回放时状态完全一致。

import { bad, drainEvents, drainWakes, emit } from './core.js';
import { usesLawVM2, capacityCheck, CapacityError, commandMeter } from './law-execution.js';
import { tickWorld } from './tick.js';
import { register, adopt, release, foster, changeModel, letter } from './lifecycle.js';
import { actCommand } from './actions.js';
import { weatherVote } from './weather.js';
import { adminCommand } from './admin.js';
import './rules.js'; // 安装规则的钩子（hooks.js）与每日规则（tick.js 的 STEPS）
import './upkeep.js'; // 维持费（STEPS.upkeep）
import './legislation.js'; // 遗法（创世时）、计票、自动回退、重订（STEPS.*）
import './bylaws.js'; // 社群章程、地点规则、社群的程序与社群提案
import './shells.js'; // 躯壳：出资排队、醒来、消散、先民入城（STEPS.shells / STEPS.founders）
import './standing.js'; // 第二前提：常驻指令的执行（STEPS.standing）
import './records.js'; // 每日指标、人类遗产存活表、史官（STEPS.metrics）
import '../sandbox/brains.js'; // 沙盘脑 v2：每刻行动（STEPS.sandbox）、沙盘领养（STEPS.sandboxAdopt）与 admin seed_sandbox

const COMMANDS = {
  tick: (w) => (w.paused ? bad('paused') : tickWorld(w)),
  register: (w, p) => register(w, p),
  adopt: (w, p) => adopt(w, p),
  release: (w, p) => release(w, p),
  foster: (w, p) => foster(w, p),
  model: (w, p) => changeModel(w, p),
  letter: (w, p) => letter(w, p),
  act: (w, p) => actCommand(w, p),
  weather_vote: (w, p) => weatherVote(w, p),
  admin: (w, p) => adminCommand(w, p),
};

export const COMMAND_TYPES = () => Object.keys(COMMANDS);

/** 其他步骤加入的命令 */
export function registerCommand(type, fn) {
  COMMANDS[type] = fn;
}

/**
 * 执行一条命令。cmd 形如 { n?, tick?, type, payload }。
 * 返回 { result, events, wakes }：events 是本命令产出的全部事件（含 internal），由调用者交给 events.js；
 * wakes 是本命令里发出的会叫醒居民的收件 [{ agentId, seq, kind }]（第二前提；其余世界恒为空，SPEC-P2 §6.1），运行时据此通知运行器。
 * 每条命令结束都清空，所以沙盘与回放里没人取走也不会积累。
 */
export function applyCommand(w, cmd) {
  const handler = COMMANDS[cmd.type];
  w.commandN = cmd.n !== undefined ? cmd.n : w.commandN + 1;
  if (!handler) return { result: bad('invalid_request', { field: 'type' }), events: drainEvents(w), wakes: drainWakes(w) };
  if (usesLawVM2(w) && !(cmd.type === 'admin' && ['law_execution', 'pause'].includes(cmd.payload?.op))) return applyProtected(w, cmd, handler);
  const result = handler(w, cmd.payload || {});
  return { result, events: drainEvents(w), wakes: drainWakes(w) };
}

// Keep identity of world/agent records used by in-process clients, but commit only
// a fully completed deterministic command. Temporary intent/event buffers stay private.
function commit(target, source) {
  for (const key of Object.keys(target)) if (!Object.hasOwn(source, key)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) target[key] = value;
    else if (value && typeof value === 'object' && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) commit(target[key], value);
    else target[key] = value;
  }
}

function protect(w, detail) {
  w.ruleExecution.protection = detail;
  w.paused = true;
  w.experimentControl = { active: true, generation: w.commandN, remainingMs: 0 };
  emit(w, 'law_capacity', { data: detail });
  return { result: bad('paused', { reason: 'law_execution_capacity', diagnostics: detail }), events: drainEvents(w), wakes: [] };
}

function applyProtected(w, cmd, handler) {
  if (w.ruleExecution.protection) return { result: bad('paused', { reason: 'law_execution_capacity' }), events: drainEvents(w), wakes: drainWakes(w) };
  const before = capacityCheck(w);
  if (!before.ok) return protect(w, { code: 'capacity', required: before.required, issues: before.issues });
  const shadow = structuredClone(w);
  for (const key of ['$out', '$wakes', '$sandboxStats']) if (w[key]) Object.defineProperty(shadow, key, { value: structuredClone(w[key]), configurable: true, writable: true });
  commandMeter(shadow);
  let result;
  try {
    result = handler(shadow, cmd.payload || {});
    const after = capacityCheck(shadow);
    if (!after.ok) throw new CapacityError({ code: 'capacity', required: after.required, issues: after.issues });
  } catch (e) {
    if (!(e instanceof CapacityError)) throw e;
    const failed = capacityCheck(shadow);
    return protect(w, { ...e.detail, code: failed.ok ? e.detail.code : 'capacity', required: { ...failed.required, ...e.detail.required }, issues: failed.issues });
  }
  const events = drainEvents(shadow), wakes = drainWakes(shadow);
  commit(w, shadow);
  if (shadow.$sandboxStats && w.$sandboxStats) commit(w.$sandboxStats, shadow.$sandboxStats);
  // Reset buffers on the original too, so old pending events are not duplicated.
  drainEvents(w); drainWakes(w);
  return { result, events, wakes };
}

export { tickWorld } from './tick.js';
