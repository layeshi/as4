// 系统提示（SPEC 附录 A.7）：模板在 src/lore，动作表由 PROTOCOL §4 的动作数据生成。
// 运行器与 MCP 共用；MCP 的 houren_rules 不含「你的灵魂」一节（灵魂在感知的 you.soul 里）。

import { L, ACTIONS, ACTION_ORDER, EFFECTS_HELP, fmt, normLang } from '../src/lore/index.js';
import { L as L2, ACTIONS as ACTIONS2, ACTION_ORDER as ACTION_ORDER2 } from '../src/e2/lore/index.js';
import { actionTable } from '../src/e2/lore/actions.js';
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
export function actionCatalog(lang, { memorySlots, distance = false, protocol = 1, premise = 0 } = {}) {
  if (protocol === 2) return actionCatalog2(lang, { memorySlots, premise });
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
export function actionCatalog2(lang, { memorySlots = P2.memorySlots, premise = 0 } = {}) {
  const { ACTIONS: ACTIONS2, ORDER: ACTION_ORDER2 } = actionTable(premise);
  const l = promptDict(L2(lang), premise);
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

/** 第二纪按设定版本取提示的字典：第二前提 promptP2、第一前提 promptP1、设定 0 prompt */
const promptDict = (dict, premise) => (premise >= 2 ? dict.promptP2 : premise >= 1 ? dict.promptP1 : dict.prompt);

/**
 * 系统提示。
 * opts：{ lang, cityName, maxActions, ticksPerDay, daysPerMonth, graceDays?, memorySlots?, soul?, protocol?, floor?, premise?, trained?, toolMode? }
 * soul 为空（null / undefined）时不含「你的灵魂」一节。
 * protocol 为 2 时用附录 A.1 的第二纪提示：{ruleLanguage} 填附录 A.2，{floor} 是规则不能把居民的能量扣到的底线（感知的 you.floor）。
 * toolMode（只在第二前提）：'native' | 'json'（缺省）| 'mcp'，决定【怎样行动】一段写哪一种（SPEC-P2 §11.1）。
 */
export function buildSystemPrompt({ protocol = 1, lang = 'zh', cityName, maxActions = 4, ticksPerDay = 12, daysPerMonth = 24, graceDays, memorySlots, distance = false, soul = null, floor, premise = 0, trained = [], toolMode = 'json', actionTools }) {
  if (protocol === 2) return buildSystemPrompt2({ lang, cityName, maxActions, ticksPerDay, daysPerMonth, graceDays, memorySlots, soul, floor, premise, trained, toolMode, actionTools });
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

/** 第二纪的系统提示（附录 A.1）；不含灵魂的一节在 soul 为空时省略。第二前提（premise >= 2）按 toolMode 填【怎样行动】，并有【常驻指令】一段 */
export function buildSystemPrompt2({ lang = 'zh', cityName, maxActions = 4, ticksPerDay = 12, daysPerMonth = 24, graceDays = P2.dormancyGraceDays, memorySlots = P2.memorySlots, soul = null, floor = P2.lawFloor, premise = 0, trained = [], toolMode = 'json', actionTools }) {
  const dict = L2(lang);
  const l = promptDict(dict, premise);
  const agent = premise >= 2 ? { howToAct: l[toolMode === 'native' ? 'howToActNative' : toolMode === 'mcp' ? 'howToActMcp' : 'howToActJson'], standingLanguage: l.standingLanguage } : {};
  if (premise >= 2 && actionTools === 'typed' && toolMode === 'native') {
    const prefix = l.howToActNative.split(lang === 'en' ? 'Use act to act:' : '用 act 行动：')[0];
    agent.howToAct = prefix + (lang === 'en'
      ? 'Use each named action tool with its declared parameters; read_law/read_document/read_inscription/read_agent submit the corresponding read action. Use done to end this waking. Calls in one reply execute sequentially. look remains free; read actions and all other actions use the existing action allowance. Preserve your intended text and amounts; use visible IDs and correct reported parameter paths, without guessing targets.'
      : '直接使用各个动作工具及其规定参数；read_law/read_document/read_inscription/read_agent 分别提交相应的 read 动作。用 done 结束这次醒来。同一回复的调用依次执行。look 免费，read 与其余动作使用既有行动名额。保持原意、文字和数额；使用可见 ID，按错误路径纠正参数，不猜测目标。');
  }
  const head = fmt(l.head, {
    cityName: cityName || dict.cityName,
    maxActions,
    ticksPerDay,
    daysPerMonth,
    graceDays,
    floor,
    ruleLanguage: fmt(l.ruleLanguage, { floor }), // 规则语言的说明里也提到底线；先填好再嵌入（fmt 一遍过，不会重复替换）
    actionCatalog: actionCatalog2(lang, { memorySlots, premise }),
    ...agent,
  });
  let text = soul === null || soul === undefined ? head : `${head}\n\n${fmt(l.soul, { soul })}`;
  if (premise >= 1 && trained.length) text += `\n\n${l.trainedHead}\n${trained.join('\n')}`;
  if (premise >= 2 && actionTools === 'typed') text += lang === 'en'
    ? (toolMode === 'json' ? '\n\nPrivate thought JSON: {"think":{"thought":"your private thought"},"done":true}. No action quota is spent; this is not public speech.' : '\n\nUse the think tool with its thought field for a private inner monologue. It spends no action quota and is not public speech.')
    : (toolMode === 'json' ? '\n\n私有独白的 JSON：{"think":{"thought":"你的独白"},"done":true}。不占行动次数，不是公开发言。' : '\n\n私有独白用 think 工具的 thought 字段，不占行动次数，不是公开发言。');
  if (premise >= 2 && actionTools === 'typed' && toolMode === 'json') text += lang === 'en'
    ? '\n\nNamed action tools also work as JSON keys: {"say":{"text":"your exact words"},"done":true}. read_law/read_document/read_inscription/read_agent take law/doc/inscription/agent respectively. Named calls run in the supplied order after look and legacy act; done ends this waking after all calls. Preserve text and amounts and use visible IDs.'
    : '\n\n也可直接用动作工具名作为 JSON 键：{"say":{"text":"你的原话"},"done":true}。read_law/read_document/read_inscription/read_agent 的参数分别是 law/doc/inscription/agent。先处理 look 和兼容的 act，其余命名调用按所写顺序执行；done 在全部调用之后结束这次醒来。保持文字和数额，使用可见 ID。';
  return text;
}

/** 从一次感知里取出系统提示需要的量 */
export function promptParams(perception) {
  const p = perception;
  if (p.protocol === 2) {
    return {
      protocol: 2,
      premise: p.premise || 0,
      trained: (p.you && p.you.trained) || [],
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
