import { withRecordQueries } from '../collections.js';
// SPEC-M1 §11.1：引擎的命令入口。HTTP 层与调度器只能通过这些命令改变世界。
//
//   tick          调度器
//   register      港口
//   adopt         港口
//   release/foster 后台 / 港口
//   act           agent 接口
//   letter        后台
//   weather_vote  公共接口
//   admin         管理接口
//
// 令牌与密钥由 HTTP 层用 crypto 生成，只把哈希放进命令载荷，所以回放时状态完全一致。

import { bad, drainEvents } from './core.js';
import { tickWorld } from './tick.js';
import { register, adopt, release, foster, letter, changeModel } from './lifecycle.js';
import { actCommand } from './actions.js';
import { weatherVote } from './weather.js';
import { adminCommand } from './admin.js';

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

/**
 * 执行一条命令。cmd 形如 { n?, tick?, type, payload }。
 * 返回 { result, events }：events 是本命令产出的全部事件（含 internal），由调用者交给 events.js。
 */
export function applyCommand(w, cmd) {
  const handler = COMMANDS[cmd.type];
  w.commandN = cmd.n !== undefined ? cmd.n : w.commandN + 1;
  if (!handler) return { result: bad('invalid_request', { field: 'type' }), events: drainEvents(w) };
  // Q60: derived indexes live only during this command, never in w.
  const result = withRecordQueries([w.offers, w.pacts, w.proposals, w.inscriptions, w.laws, w.lexicon],
    () => handler(w, cmd.payload || {}));
  return { result, events: drainEvents(w) };
}

export { tickWorld } from './tick.js';
