import { premised as isPremised } from './world.js';
import { weatherCodesFor } from './engine/weather.js';
// TODO(spec): Q32 — preserve premise 0 calm votes; premise 1 HTTP uses public types.
export const weatherTypes = (w) => isPremised(w) ? weatherCodesFor(w).filter((c) => c !== 'calm') : weatherCodesFor(w);
// SPEC-E2 §2.1：第二纪引擎 v2 的门面。形状与 src/engine/facade.js（v1）相同。
//
// 运行时、HTTP、回放、沙盘命令行只通过门面使用引擎。

export { premised, agentic } from './world.js';
export { isWakeItem } from './engine/core.js';
export { wakeItems } from './engine/perception.js';

import { P, configure, configureWeather } from './params.js';
import { createWorld, genesisOpts, agentList, isAlive, clockDay } from './world.js';
import { applyCommand } from './engine/index.js';
import { drainEvents } from './engine/core.js';
import { checkConservation } from './engine/ledger.js';
import { shellsFree } from './engine/shells.js';
import { buildPerception, inboxView } from './engine/perception.js';
import { publicState, publicEvent, ownerEvent, publicAgent, publicMemories, publicPlace, publicDoc, publicWeather, publicLaw, publicCradle, eventMatchesLaw } from './engine/visibility.js';
import { publicMap } from './map/index.js';
import { researchMetrics } from './metrics.js';
import { publicLore } from './lore/index.js';

/** SSE tick 事件的精简状态。nextTickAt 只存在于运行时，由调用者传入；第二纪另带 shells: { free, total } */
function tickSummary(w, { nextTickAt = null } = {}) {
  const hist = w.well.outputHistory;
  const well = w.places.well;
  return {
    tick: w.clock.tick,
    day: Math.floor(w.clock.tick / P.ticksPerDay),
    nextTickAt,
    agents: agentList(w).filter(isAlive).map((a) => ({ id: a.id, place: a.place, energy: a.energy, status: a.status })),
    treasury: { energy: w.treasury.energy, coins: w.treasury.coins },
    well: { condition: well ? well.condition : null, outputYesterday: hist.length ? hist[hist.length - 1] : null },
    shells: { free: shellsFree(w), total: w.shells.slots },
  };
}

export default Object.freeze({
  physics: 2,
  protocol: 2,
  P,
  createWorld,
  genesisOpts,
  applyCommand,
  drainEvents,
  buildPerception,
  inboxView,
  publicState,
  publicAgent,
  publicMemories,
  publicPlace,
  publicDoc,
  publicWeather,
  publicEvent,
  ownerEvent,
  publicMap,
  publicLaw,
  publicCradle,
  publicLore,
  eventMatchesLaw,
  researchMetrics,
  tickSummary,
  checkConservation,
  clockDay,
  configure,
  configureWeather,
});
