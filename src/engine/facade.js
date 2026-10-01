// 第一纪引擎 v1 的门面（SPEC-E2 §2.1）：只做转出。
//
// 运行时、HTTP、回放、沙盘命令行只通过门面使用引擎，这样两代引擎（v1 冻结、v2 开发中）可以按世界的 `physics` 分派。
// v1 的其余文件冻结：除本文件外，src/engine/ 下的任何行为都不得改变（SPEC-E2 §0.3 第 8 条）。

import { createWorld, agentList, isAlive, clockDay } from '../world.js';
import { P, configure, configureWeather } from '../params.js';
import { applyCommand } from './index.js';
import { drainEvents } from './core.js';
import { buildPerception, inboxView } from './perception.js';
import {
  publicState, publicAgent, publicMemories, publicPlace, publicDoc, publicWeather, publicEvent, ownerEvent,
} from './visibility.js';
import { publicMap } from '../map/index.js';
import { researchMetrics } from '../metrics.js';
import { checkConservation } from './ledger.js';
import { L, normLang } from '../lore/index.js';

/** SSE tick 事件的精简状态（PROTOCOL §9）。nextTickAt 只存在于运行时，由调用者传入 */
function tickSummary(w, { nextTickAt = null } = {}) {
  const hist = w.well.outputHistory;
  return {
    tick: w.clock.tick,
    day: Math.floor(w.clock.tick / P.ticksPerDay),
    nextTickAt,
    agents: agentList(w).filter(isAlive).map((a) => ({ id: a.id, place: a.place, energy: a.energy, status: a.status })),
    treasury: { energy: w.treasury.energy, coins: w.treasury.coins },
    well: { condition: w.places.well.condition, outputYesterday: hist.length ? hist[hist.length - 1] : null },
  };
}

/**
 * GET /api/public/lore?lang=：观测站需要的系统文本（物理定律、地点描述、档位词、天象名、法律效力模板）。
 * 【新增，PROTOCOL §9 之外】这些文本本来就是公开的静态资源；由服务器提供，是为了让界面与引擎的文本不会各写一份而漂移。
 * 不含运行器提示词与错误信息。（原在 src/http/public.js，随门面搬到这里，内容不变）
 */
function publicLore(lang) {
  const nl = normLang(lang);
  const d = L(nl);
  return {
    lang: nl,
    cityName: d.cityName, redacted: d.redacted, unreadableInscription: d.unreadableInscription,
    place: d.place, district: d.district, band: d.band, wellBand: d.wellBand, richness: d.richness, richnessWild: d.richnessWild, season: d.season,
    facility: d.facility, weather: d.weather, omen: d.omen, physics: d.physics, law: d.law,
  };
}

/** GET /api/port/cradle：摇篮中的灵魂（与感知中的 city.cradle 相同，另含 createdDay）。（原在 src/http/port.js，随门面搬到这里，内容不变） */
function publicCradle(w) {
  return Object.values(w.souls).map((s) => ({
    id: s.id, name: s.name,
    parents: s.parents.map((id) => ({ id, name: w.agents[id].name })),
    soul: s.soul, lang: s.lang, generation: s.generation, createdDay: s.createdDay, expiresDay: s.expiresDay,
  }));
}

export default Object.freeze({
  physics: 1,
  protocol: 1,
  P,
  createWorld,
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
  publicLaw: () => null, // 第一纪没有 /api/public/laws/:id
  eventMatchesLaw: () => false,
  publicCradle,
  publicLore,
  researchMetrics,
  tickSummary,
  checkConservation,
  clockDay,
  configure,
  configureWeather,
});
