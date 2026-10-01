// 系统提示（SPEC 附录 A.7）：模板在 src/lore，动作表由 PROTOCOL §4 的动作数据生成。
// 运行器与 MCP 共用；MCP 的 houren_rules 不含「你的灵魂」一节（灵魂在感知的 you.soul 里）。

import { L, ACTIONS, ACTION_ORDER, EFFECTS_HELP, fmt, normLang } from '../src/lore/index.js';
import { L as L2, ACTIONS as ACTIONS2, ACTION_ORDER as ACTION_ORDER2 } from '../src/e2/lore/index.js';
import { P } from '../src/params.js';
import { P as P2 } from '../src/e2/params.js';

/** 一个动作的代价文字：数字或 costText（如「投入的能量」） */
function costOf(a, lang) {
  if (a.costText) return a.costText[lang];
  return String(a.base);
}

/**
 * 动作表：每个动作一行，格式 `type(参数) 基础代价 [地点限制]：说明`（模板来自 lore 的 prompt.catalogLine）。
 * opts：{ memorySlots, distance }——distance 为真（按路程计价的地图，附录 C）时，move 用按路程计价的说明。
 */
export function actionCatalog(lang, { memorySlots, distance = false, protocol = 1 } = {}) {
  if (protocol === 2) return actionCatalog2(lang, { memorySlots });
  memorySlots ??= P.memorySlots;
  const l = L(lang).prompt;
  const code = normLang(lang);
  return ACTION_ORDER.map((type) => {
    const a = ACTIONS[type];
    return fmt(l.catalogLine, {
      type,
      params: a.params,
      cost: costOf(a, code),
      where: a.where ? fmt(l.catalogWhere, { where: a.where[code] }) : '',
      desc: fmt((distance && a.descDistance ? a.descDistance : a.desc)[code], { memorySlots, effects: EFFECTS_HELP[code] }),
    });
  }).join('\n');
}

/** 第二纪的动作表（SPEC-E2 §22）：src/e2/lore/actions.js 生成，格式同第一纪 */
function actionCatalog2(lang, { memorySlots = P2.memorySlots } = {}) {
  const l = L2(lang).prompt;
  const code = normLang(lang);
  return ACTION_ORDER2.map((type) => {
    const a = ACTIONS2[type];
    return fmt(l.catalogLine, {
      type,
      params: a.params,
      cost: a.costText ? a.costText[code] : String(a.base),
      where: a.where ? fmt(l.catalogWhere, { where: a.where[code] }) : '',
      desc: fmt(a.desc[code], { memorySlots }),
    });
  }).join('\n');
}

/**
 * 系统提示。
 * opts：{ lang, cityName, maxActions, ticksPerDay, daysPerMonth, graceDays?, memorySlots?, soul?, protocol?, floor? }
 * soul 为空（null / undefined）时不含「你的灵魂」一节。
 * protocol 为 2 时用附录 A.1 的第二纪提示：{ruleLanguage} 填附录 A.2，{floor} 是规则不能把居民的能量扣到的底线（感知的 you.floor）。
 */
export function buildSystemPrompt({ protocol = 1, lang = 'zh', cityName, maxActions = 4, ticksPerDay = 12, daysPerMonth = 24, graceDays, memorySlots, distance = false, soul = null, floor }) {
  if (protocol === 2) return buildSystemPrompt2({ lang, cityName, maxActions, ticksPerDay, daysPerMonth, graceDays, memorySlots, soul, floor });
  graceDays ??= P.dormancyGraceDays;
  memorySlots ??= P.memorySlots;
  const l = L(lang).prompt;
  const head = fmt(l.head, {
    cityName: cityName || L(lang).cityName,
    maxActions,
    ticksPerDay,
    daysPerMonth,
    graceDays,
    actionCatalog: actionCatalog(lang, { memorySlots, distance }),
  });
  if (soul === null || soul === undefined) return head;
  return `${head}\n\n${fmt(l.soul, { soul })}`;
}

/** 第二纪的系统提示（附录 A.1）；不含灵魂的一节在 soul 为空时省略 */
function buildSystemPrompt2({ lang = 'zh', cityName, maxActions = 4, ticksPerDay = 12, daysPerMonth = 24, graceDays = P2.dormancyGraceDays, memorySlots = P2.memorySlots, soul = null, floor = P2.lawFloor }) {
  const dict = L2(lang);
  const l = dict.prompt;
  const head = fmt(l.head, {
    cityName: cityName || dict.cityName,
    maxActions,
    ticksPerDay,
    daysPerMonth,
    graceDays,
    floor,
    ruleLanguage: fmt(l.ruleLanguage, { floor }), // 规则语言的说明里也提到底线；先填好再嵌入（fmt 一遍过，不会重复替换）
    actionCatalog: actionCatalog2(lang, { memorySlots }),
  });
  if (soul === null || soul === undefined) return head;
  return `${head}\n\n${fmt(l.soul, { soul })}`;
}

/** 从一次感知里取出系统提示需要的量 */
export function promptParams(perception) {
  const p = perception;
  if (p.protocol === 2) {
    return {
      protocol: 2,
      lang: p.lang,
      cityName: p.city && p.city.name,
      maxActions: p.you && p.you.maxActionsPerTick,
      ticksPerDay: p.now && p.now.ticksPerDay,
      daysPerMonth: p.now && p.now.daysPerMonth,
      memorySlots: p.you && p.you.memorySlots,
      floor: p.you && p.you.floor,
      soul: p.you ? p.you.soul : null,
    };
  }
  return {
    lang: p.lang,
    cityName: p.city && p.city.name,
    maxActions: p.you && p.you.maxActionsPerTick,
    ticksPerDay: p.now && p.now.ticksPerDay,
    daysPerMonth: p.now && p.now.daysPerMonth,
    memorySlots: p.you && p.you.memorySlots,
    // 按路程计价的地图：感知里的地点带 moveCost
    distance: !!(p.city && Array.isArray(p.city.places) && p.city.places.some((x) => x.moveCost !== undefined)),
    soul: p.you ? p.you.soul : null,
  };
}
