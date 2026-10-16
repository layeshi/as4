import { stripCoins } from './p6/coins.js';
const p6View = (fn) => (w,...args) => { const out=fn(w,...args); return (w.premise===6 || w.premise === 7) ? stripCoins(out) : out; };
import { lawProtectionView } from './engine/law-semantics.js';
import { premised as isPremised } from './world.js';
import { weatherCodesFor } from './engine/weather.js';
// TODO(spec): Q32 — preserve premise 0 calm votes; premise 1 HTTP uses public types.
export const weatherTypes = (w) => isPremised(w) ? weatherCodesFor(w).filter((c) => c !== 'calm') : weatherCodesFor(w);
// SPEC-E2 §2.1：共用 v1 的门面契约，另有 E2 的 genesisOpts / prepareCommand 能力。
//
// 运行时、HTTP、回放、沙盘命令行只通过门面使用引擎。

export { premised, agentic, tokenized } from './world.js';
export { isWakeItem } from './engine/core.js';
export { wakeItems } from './engine/perception.js';

import { P, configure, configureWeather } from './params.js';
import { createWorld, genesisOpts, agentList, isAlive, clockDay } from './world.js';
import { applyCommand, prepareCommand } from './engine/index.js';
import { drainEvents } from './engine/core.js';
import { checkConservation } from './engine/ledger.js';
import { shellsFree } from './engine/shells.js';
import { buildPerception, inboxView } from './engine/perception.js';
import { publicState, publicEvent, ownerEvent, publicAgent, publicMemories, publicPlace, publicDoc, publicWeather, publicLaw, publicCradle, eventMatchesLaw } from './engine/visibility.js';
import { publicMap } from './map/index.js';
import { researchMetrics } from './metrics.js';
import { publicLore } from './lore/index.js';
import { wellPlace } from './engine/environment.js';
import { multiCity, cityValue, CITY_IDS } from './engine/cities.js';

/** SSE tick 事件的精简状态。nextTickAt 只存在于运行时，由调用者传入；第二纪另带 shells: { free, total } */
function tickSummary(w, { nextTickAt = null } = {}) {
  if (multiCity(w)) return islandTickSummary(w, nextTickAt);
  const hist = w.well.outputHistory;
  const well = wellPlace(w);
  return {
    ...(lawProtectionView(w) ? { lawProtection: lawProtectionView(w) } : {}),
    tick: w.clock.tick,
    day: Math.floor(w.clock.tick / P.ticksPerDay),
    nextTickAt,
    agents: agentList(w).filter(isAlive).map((a) => ({ id: a.id, place: a.place, energy: a.energy, status: a.status })),
    treasury: { energy: w.treasury.energy, coins: w.treasury.coins },
    well: { condition: well ? well.condition : null, outputYesterday: hist.length ? hist[hist.length - 1] : null },
    shells: { free: shellsFree(w), total: w.shells.slots },
  };
}

/** 第七前提「三城」：每座城一份公库与源井，顶层是全岛合计（源井完好度取三口的平均） */
function islandTickSummary(w, nextTickAt) {
  const cities = Object.fromEntries(CITY_IDS.map((id) => {
    const hist = cityValue(w, id, 'well').outputHistory;
    return [id, { treasury: { energy: cityValue(w, id, 'treasury').energy }, well: { condition: wellPlace(w, id).condition, outputYesterday: hist.length ? hist[hist.length - 1] : null } }];
  }));
  const list = Object.values(cities);
  return {
    ...(lawProtectionView(w) ? { lawProtection: lawProtectionView(w) } : {}),
    tick: w.clock.tick,
    day: Math.floor(w.clock.tick / P.ticksPerDay),
    nextTickAt,
    agents: agentList(w).filter(isAlive).map((a) => ({ id: a.id, place: a.place, energy: a.energy, status: a.status, city: a.city })),
    treasury: { energy: list.reduce((n, c) => n + c.treasury.energy, 0) },
    well: { condition: Math.round(list.reduce((n, c) => n + c.well.condition, 0) / list.length), outputYesterday: list.reduce((n, c) => n + (c.well.outputYesterday || 0), 0) },
    cities,
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
  prepareCommand,
  drainEvents,
  buildPerception: p6View(buildPerception),
  inboxView,
  publicState: p6View(publicState),
  publicAgent: p6View(publicAgent),
  publicMemories,
  publicPlace: p6View(publicPlace),
  publicDoc: p6View(publicDoc),
  publicWeather: p6View(publicWeather),
  publicEvent: p6View(publicEvent),
  ownerEvent,
  publicMap,
  publicLaw: p6View(publicLaw),
  publicCradle,
  publicLore,
  eventMatchesLaw,
  researchMetrics,
  tickSummary: p6View(tickSummary),
  checkConservation: p6View(checkConservation),
  clockDay,
  configure,
  configureWeather,
});
