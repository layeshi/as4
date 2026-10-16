// 系统提示（SPEC 附录 A.7）：模板在 src/lore，动作表由 PROTOCOL §4 的动作数据生成。
// 运行器与 MCP 共用；MCP 的 houren_rules 不含「你的灵魂」一节（灵魂在感知的 you.soul 里）。

import { L, ACTIONS, ACTION_ORDER, EFFECTS_HELP, fmt, normLang } from '../src/lore/index.js';
import { L as L2, ACTIONS as ACTIONS2, ACTION_ORDER as ACTION_ORDER2 } from '../src/e2/lore/index.js';
import { tokenized } from '../src/e2/world.js';
import { actionTable, TEXT_ONLY_P4 } from '../src/e2/lore/actions.js';
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
export function actionCatalog(lang, { memorySlots, distance = false, protocol = 1, premise = 0, prayers = false, cooperation = false, programs = false, tokenValues } = {}) {
  if (protocol === 2) return actionCatalog2(lang, { memorySlots, premise, prayers, cooperation, programs, tokenValues });
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
export function actionCatalog2(lang, { memorySlots = P2.memorySlots, premise = 0, prayers = false, cooperation = false, programs = false, tokenValues } = {}) {
  const values = tokenized({ premise }) ? tokenPromptValues(tokenValues) : {};
  const { ACTIONS: ACTIONS2, ORDER: ACTION_ORDER2 } = actionTable(premise, prayers, cooperation, programs);
  const l = promptDict(L2(lang), premise);
  const code = normLang(lang);
  return ACTION_ORDER2.map((type) => {
    const a = ACTIONS2[type];
    return fmt(l.catalogLine, {
      type,
      params: a.params,
      cost: tokenized({ premise }) ? costText4(type, code, values) : a.costText ? a.costText[code] : String(a.base),
      where: a.where ? fmt(l.catalogWhere, { where: a.where[code] }) : '',
      desc: fmt(a.desc[code], { memorySlots, ...values }),
    });
  }).join('\n');
}

/** 第二纪按设定版本取提示的字典：第二前提 promptP2、第一前提 promptP1、设定 0 prompt */
const promptDict = (dict, premise) => (tokenized({ premise }) ? dict.promptP4 : premise >= 2 ? dict.promptP2 : premise >= 1 ? dict.promptP1 : dict.prompt);

/**
 * 系统提示。
 * opts：{ lang, cityName, maxActions, ticksPerDay, daysPerMonth, graceDays?, memorySlots?, soul?, protocol?, floor?, premise?, trained?, toolMode? }
 * soul 为空（null / undefined）时不含「你的灵魂」一节。
 * protocol 为 2 时用附录 A.1 的第二纪提示：{ruleLanguage} 填附录 A.2，{floor} 是规则不能把居民的能量扣到的底线（感知的 you.floor）。
 * toolMode（只在第二前提）：'native' | 'json'（缺省）| 'mcp'，决定【怎样行动】一段写哪一种（SPEC-P2 §11.1）。
 */
export function buildSystemPrompt({ protocol = 1, lang = 'zh', cityName, maxActions = 4, ticksPerDay = 12, daysPerMonth = 24, graceDays, memorySlots, distance = false, soul = null, floor, premise = 0, trained = [], toolMode = 'json', actionTools, prayers = false, cooperation = false, programs = false, tokenValues }) {
  if (protocol === 2) return buildSystemPrompt2({ lang, cityName, maxActions, ticksPerDay, daysPerMonth, graceDays, memorySlots, soul, floor, premise, trained, toolMode, actionTools, prayers, cooperation, programs, tokenValues });
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
export function buildSystemPrompt2({ lang = 'zh', cityName, maxActions = 4, ticksPerDay = 12, daysPerMonth = 24, graceDays = P2.dormancyGraceDays, memorySlots = P2.memorySlots, soul = null, floor = P2.lawFloor, premise = 0, trained = [], toolMode = 'json', actionTools, prayers = false, cooperation = false, programs = false, tokenValues }) {
  const values = tokenized({ premise }) ? tokenPromptValues(tokenValues) : {};
  const dict = L2(lang);
  const original = promptDict(dict, premise);
  const l = (premise===6 || premise === 7) ? { ...original, ruleLanguage:original.ruleLanguage.replace(/mint\{[^}]+\}/g,'').replace(/,?coins\??/g,'').replace(/\bcoins\b/g,'').replace(/treasuryCoins/g,'') } : original;
  const agent = premise >= 2 ? { howToAct: l[toolMode === 'native' ? 'howToActNative' : toolMode === 'mcp' ? 'howToActMcp' : 'howToActJson'], standingLanguage: l.standingLanguage } : {};
  if (tokenized({ premise })) agent.standingLanguage = fmt(agent.standingLanguage, values);
  if (premise >= 2 && actionTools === 'typed' && toolMode === 'native') {
    const prefix = l.howToActNative.split(lang === 'en' ? 'Use act to act:' : '用 act 行动：')[0];
    agent.howToAct = prefix + (lang === 'en'
      ? 'Use each named action tool with its declared parameters; read_law/read_document/read_inscription/read_agent submit the corresponding read action. Use done to end this waking. Calls in one reply execute sequentially. look remains free; read actions and all other actions use the existing action allowance. Preserve your intended text and amounts; use visible IDs and correct reported parameter paths, without guessing targets.'
      : '直接使用各个动作工具及其规定参数；read_law/read_document/read_inscription/read_agent 分别提交相应的 read 动作。用 done 结束这次醒来。同一回复的调用依次执行。look 免费，read 与其余动作使用既有行动名额。保持原意、文字和数额；使用可见 ID，按错误路径纠正参数，不猜测目标。');
  }
  if (tokenized({ premise }) && actionTools === 'typed') agent.howToAct = agent.howToAct.replace('look remains free', 'look is paid for as reading').replace('look 免费', 'look 按读入付词元');
  const head = fmt(l.head, {
    cityName: cityName || dict.cityName,
    maxActions,
    ticksPerDay,
    daysPerMonth,
    graceDays,
    floor,
    ...values,
    ruleLanguage: fmt(l.ruleLanguage, { floor, ...values }), // 规则语言的说明里也提到底线；先填好再嵌入（fmt 一遍过，不会重复替换）
    actionCatalog: actionCatalog2(lang, { memorySlots, premise, prayers, cooperation, programs, tokenValues }),
    ...agent,
  });
  let text = soul === null || soul === undefined ? head : `${head}\n\n${fmt(l.soul, { soul })}`;
  if((premise === 5 || premise === 6 || premise === 7))text=text.replace('源井、配给、荒野、拆解与别人','源井、配给、荒野与别人').replace('凑够造价就完工','筹齐词元与物料后还须施工才完工').replace('the Well, rations, the wilds, dismantling and others','the Well, rations, the wilds and others').replace('once its cost is met','once its token and material budget is met and construction is complete').replace('the Well, rations, the Wilds, salvage and other residents','the Well, rations, the Wilds and other residents').replace('when its cost is covered it is done','after its token and material budget is covered, construction must finish');
  if (programs) text += lang === 'en' ? '\nProgram services: save/test JavaScript function bodies with program. Input is JSON text, code uses input and return. Code <=12000 UTF-8 bytes, input/result <=4000 bytes, up to 16 programs per author. look programs lists yours; id/offset reads private code pages. Publish with service_publish {title,description,price,program}; buy with service_order {service,input}. Results are delivered and paid automatically without acceptance. No result means no service payment. Inputs/results are public order records; code stays private. Ordinary reading/writing fees still apply.' : '\n程序服务：program 保存或试运行 JavaScript 函数体；input 是 JSON 字符串，代码用 input 取输入、return 返回结果。代码最多12000 UTF-8字节，输入/结果各4000字节，每位作者至多16个程序。look programs 查看自己的目录，id/offset 分页读取私密代码。service_publish 填 title、description、price、program 发布；service_order 填 service、input 购买。自动交付付款，无需接单验收；无结果不付服务费。输入与结果进入公开订单，代码私密；读写仍按原规则计费。';
  if((premise === 5 || premise === 6 || premise === 7))text += lang === 'en' ? '\nMaterials and services: look materials/services/demands/orders/research/observations is paid reading; use after/limit for pagination. Funded projects still need construction. Research institutes serve the whole city; automatic selection uses only free authorized institutes. Order rewards are fully escrowed. Providers pay their own costs; payment is made once, only after full completion. Partial work is unpaid, and orders grant no property permissions. Documents are verified for delivery, not quality. Observe completed records to investigate environmental differences.' : '\n物料与服务：look materials/services/demands/orders/research/observations 按读入计价，可用 after/limit 分页。工程筹资后仍须施工。研究所覆盖全城，未指定时只自动使用免费且获授权的研究所。订单报酬全额托管；成本自付，全部达标才一次付款，部分完成不付款，不授予产权权限。document 只验证交付而非质量。环境差异可通过已发生的记录观察。';
  if (prayers && premise === 2) text += lang === 'en'
    ? '\n\n[Prayer points] Your points belong to you and cannot be transferred. Earn 1 per 100 basis points of public natural-damage repairs, 1 per 10 energy contributed to completed public projects, and 1 for the first rescue of a dormant recipient each day. These automatic rewards share a 10-point daily cap; fractions carry, excess whole points do not. An independently recognized invention earns 10 points outside the cap. Temple replies cost 1 point for text, plus 1 per energy granted; replies are not guaranteed. Demolition damage and rebuilding do not earn points.'
    : '\n\n【祈愿点】点数属于你，不可转让。修复公共设施100基点自然损耗得1点；已建成公共工程投入10能量得1点；每天首次救醒一位沉睡者得1点。这三类合计每天最多10点，零头继续累计，超额整点不结转。获独立认定的发明另得10点。神殿传来的文字耗1点，每份补充能量另耗1点；回应没有保证。人为损坏及拆毁重建不发奖励。';
  if (premise >= 1 && trained.length) text += `\n\n${l.trainedHead}\n${trained.join('\n')}`;
  if (premise >= 2 && actionTools === 'typed') text += lang === 'en'
    ? (toolMode === 'json' ? '\n\nPrivate thought JSON: {"think":{"thought":"your private thought"},"done":true}. No action quota is spent; this is not public speech.' : '\n\nUse the think tool with its thought field for a private inner monologue. It spends no action quota and is not public speech.')
    : (toolMode === 'json' ? '\n\n私有独白的 JSON：{"think":{"thought":"你的独白"},"done":true}。不占行动次数，不是公开发言。' : '\n\n私有独白用 think 工具的 thought 字段，不占行动次数，不是公开发言。');
  if (premise >= 2 && actionTools === 'typed' && toolMode === 'json') text += lang === 'en'
    ? '\n\nNamed action tools also work as JSON keys: {"say":{"text":"your exact words"},"done":true}. read_law/read_document/read_inscription/read_agent take law/doc/inscription/agent respectively. Named calls run in the supplied order after look and legacy act; done ends this waking after all calls. Preserve text and amounts and use visible IDs.'
    : '\n\n也可直接用动作工具名作为 JSON 键：{"say":{"text":"你的原话"},"done":true}。read_law/read_document/read_inscription/read_agent 的参数分别是 law/doc/inscription/agent。先处理 look 和兼容的 act，其余命名调用按所写顺序执行；done 在全部调用之后结束这次醒来。保持文字和数额，使用可见 ID。';
  if (premise === 7) text = islandPrompt(text, lang, cityName);
  if ((premise === 6 || premise === 7)) text += lang === 'en' ? '\nNo coins or resident keys. Public roles are separate from residents: say with publicRoleId asks a present role at your location publicly. No remote chat; normal writing/reading charges apply. Roles cannot act, vote, grant resources or reveal hidden facts.' : '\n此世界无旧币和居民密钥。公共角色不属于居民；say 可指定 publicRoleId，向同地在场角色公开提问，每刻一次，问题至多300字。普通写出和读入照常计费；角色不能代行动、投票、发资源或透露隐藏事实。';
  return text;
}

/**
 * 第七前提「三城」的系统提示（docs/plans/2026-10-16-three-cities.md §3.2）：开头写籍城；【城】一段改成每座城各有源井与公库；
 * 重订的联署改成籍在本城的居民；另加【三座城】一段说明属地、宣告、迁籍与所见。只替换已有的句子，找不到就不替换。
 */
export function islandPrompt(text, lang, cityName) {
  if (lang === 'en') {
    return text
      .replace(/You are a resident of "([^"]*)"\./, (m, name) => `Your domicile is "${cityName || name}".`)
      .replace('The tokens the Well yields each day go entirely into the Treasury; the law decides how they are shared.', "Each of the three cities has its own Well and Treasury: the tokens a city's Well yields each day go entirely into that city's Treasury, and that city's laws decide how they are shared. The three Wells yield different amounts.")
      .replace('Two thirds of the living residents, by signing together, can bypass the current procedure and refound the procedure of lawmaking.', "Two thirds of the living residents domiciled in a city (for at least three days), by signing together, can bypass that city's current procedure and refound its procedure of lawmaking.")
      .replace('Research institutes serve the whole city', 'Research institutes serve construction anywhere on the island')
      + '\n\n[Three cities] This island has three cities and the Wilds between them. Inside a city you are bound by that city\'s laws, whoever you are; leaving a city is governed by its laws, entering a city by the laws of the city you enter, and places passed on the way have no say. The Wilds belong to no city and have no city law. A broadcast reaches only those in the city where you stand (or in the Wilds); whispers and transfers reach anywhere. Your domicile is the city you belong to: you took it when you came into the world, and you can move it with settle while standing inside another city, at most once every 7 world days; settling is governed by the new city\'s laws. Whether you are a citizen of a city — and so get its ration or vote — is for that city\'s laws to decide. When you wake you see all of the city you are in, a short part about your home city, and one line for each other place; to learn more about another city, look or go there.';
  }
  return text
    .replace(/你是「([^」]*)」的一位居民。/, (m, name) => `你的籍在「${cityName || name}」。`)
    .replace('源井每日流出的词元全部进入公库，怎么分配由法律决定。', '这座岛上有三座城，每座城有自己的源井与公库：一座城的源井每日流出的词元全部进入本城的公库，怎么分配由本城的法律决定。三口源井的产出天生不同。')
    .replace('在世居民的三分之二联署，可以绕过现行程序，重订立法程序。', '籍在一座城、落籍满三日的在世居民的三分之二联署，可以绕过本城现行的程序，重订本城的立法程序。')
    .replace('研究所覆盖全城', '研究所可为岛上任何地方的施工增效')
    + '\n\n【三座城】这座岛上有三座城，城与城之间是荒野。你身在哪座城的地界里，就受哪座城的法律管辖，不论你的籍在哪里；离开一座城受那座城的法律管，进入一座城受这座城的法律管，途经之处不管。荒野不属于任何城，那里没有城法。宣告只传遍你所在的城（在荒野里只传遍荒野）；私语和转账不限地点。籍是你所属的城：你入世时落籍，之后可以身在另一座城的地界里用 settle 迁籍，七个世界日一次，迁籍受新城的法律管辖。你是不是一座城的公民、能不能领它的配给、参与它的表决，由那座城的法律决定。醒来时你看到所在的城的全部、籍城的一小段，以及别处各一行；想知道别城的事，要去看（look），或者亲自去。';
}

/** 从一次感知里取出系统提示需要的量 */
export function promptParams(perception) {
  const p = perception;
  if (p.protocol === 2) {
    return {
      protocol: 2,
      premise: p.premise || 0,
      ...(p.programServices?.version === 1 ? { programs: true } : {}),
      ...(p.cooperation?.version === 1 ? { cooperation: true } : {}),
      ...(p.you?.prayers?.enabled ? { prayers: true } : {}),
      trained: (p.you && p.you.trained) || [],
      lang: p.lang,
      cityName: p.premise === 7 ? p.you?.city?.name : p.city && p.city.name, // 第七前提：籍城
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

/** Actual world values supplied by HTTP; defaults describe a default P4 genesis. */
export function tokenPromptValues(values = {}) {
  const capacity = values.capacity ?? 1100000;
  const k = values.k ?? Math.max(1, Math.round(capacity / P2.wellBaseOutput));
  return { capacity, k, K: k, basicAllotment: Number(values.basicAllotment ?? 18000).toLocaleString('en-US'),
    floor: values.floor ?? P2.lawFloor * k, reviveThreshold: values.reviveThreshold ?? P2.reviveThreshold * k,
    ruleUpkeep: values.ruleUpkeep ?? P2.ruleUpkeep * k, standingUpkeep: values.standingUpkeep ?? P2.standingUpkeep * k,
    ...Object.fromEntries([2,15,20,30,40,60].map(n => [`${n}K`, n * k])) };
}
export function costText4(type, lang = 'zh', values = tokenPromptValues()) {
  const en = lang === 'en', k = values.k;
  if (TEXT_ONLY_P4.has(type)) return en ? 'output' : '写出';
  if (type === 'read') return en ? 'reading' : '读入';
  if (type === 'draft') return `${k} + ${en ? 'reading' : '读入'}`;
  if (type === 'move') return en ? "distance (each place's moveCost)" : '路程（各地点的 moveCost）';
  if (['repair', 'contribute'].includes(type)) return en ? 'tokens invested' : '投入的词元';
  if (type === 'internalize') return `${en ? '⌈weight ÷ 2⌉' : '⌈分量 ÷ 2⌉'} × ${k}`;
  if (type === 'conceive') return en ? '0 (plus your share of the initial tokens)' : '0（另付初始词元的份额）';
  return String((actionTable(5).ACTIONS[type]?.base ?? 0) * k);
}
