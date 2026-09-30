// SPEC-M1 §5：世界的数据模型与创建。世界状态是一个普通的 JSON 对象（整数账本、无 Map/Set/undefined），
// 可以直接 JSON.stringify 成快照。本文件还负责 ID 生成与查找工具（§3）。
//
// 【实现备注】下列字段是规格数据模型之外、为计算规格要求的输出而增加的私有簿记（均已登记在
// docs/QUESTIONS.md 的 Q2）：world.recentSpeech、world.redacted、Doc.redacted、LexEntry.redacted、
// Soul.judged、Facility.ruined、Grave.will、WeatherState.scheduled.decidedBy/votes、Place.activity.repairs、Place.history、world.legacy。
// 它们只增不改既有字段，不影响任何对外接口。

import { P, PLACE_DEFS, LAW_DEFAULTS } from './params.js';
import { createStreams, shuffle } from './rng.js';
import { nameKey } from './text.js';
import { L, CHARTER, CHARTER_LANGS, charterWallText, RELICS, CANON, LETTER } from './lore/index.js';

export const WORLD_VERSION = 1;

/** 当日摘要，供指标与史官使用，日终清空（§5.1 dayLog） */
export function newDayLog() {
  return {
    output: 0, // 源井日产
    ration: 0, // 人均配给
    rationed: 0, // 领到配给的人数
    arrivals: [], // [{ id, name }]
    births: [], // [{ id, name, parents: [id, id] }]
    deaths: [], // [{ id, name, ageDays, lastWords }]
    fades: [], // [{ soulId, name }]
    retirements: 0,
    laws: [], // [{ proposalId, title, passed, yes, no, lawId }]
    built: [], // [{ facilityId, type, name, place, k }]
    abandoned: [], // [{ projectId, name, place }]
    ruins: [], // [{ target, place }]
    restored: [], // [{ target, place }]
    groups: [], // [{ id, name, founder }]
    relics: [], // [{ finder, docId }]
    weather: [], // 当日开始的天象 [type]
    activeWeather: [], // 当日（结算开始时）生效的天象 [type]，史官用
    utterances: [], // [{ from, place, text, script }]：say 与 broadcast
    scripts: {}, // 文字系统 → 当日公开发言数
    coinVolume: 0, // 赠予与交易流动的旧币
    coinTrade: { energy: 0, coins: 0 }, // 「只含能量」对「只含旧币」的成交合计（币价）
    actionCost: 0, // 动作代价合计（不含修缮、出工）
    repairSpent: 0,
    contributeSpent: 0,
    drawn: 0,
    proposals: 0,
    passed: 0,
    rejected: 0,
    inscriptions: 0,
    covered: 0,
    epitaphs: 0,
    reveals: 0,
    reads: 0,
    canonReads: 0,
    mints: 0,
    repairedPlaces: [], // 当日被修缮过的地点 ID（遗产表用）
  };
}

/** 账本状态（§7.1）：昨日持有 + 今日来源 − 今日去处 = 今日持有 */
export function newLedger() {
  return {
    prev: { energy: 0, coins: 0 },
    src: { energy: {}, coins: {} },
    snk: { energy: {}, coins: {} },
    mismatches: 0,
  };
}

function initialCounters(extra) {
  return { a: 0, g: 0, p: 0, l: 0, o: 0, c: 0, s: 0, d: 0, j: 0, f: 0, i: 0, L: 0, event: 0, inbox: 0, ...extra };
}

/**
 * 创建初始世界（§5.1）。不产生事件、不消耗 world 流以外的随机数。
 * @param {{id?: string, seed: string, codeVersion?: string, sandboxAdoption?: boolean}} opts
 */
export function createWorld({ id = 'baihua', seed, codeVersion = '0.0.0', sandboxAdoption = false } = {}) {
  if (typeof seed !== 'string' || seed === '') throw new Error('createWorld: seed is required');
  const zh = L('zh');
  const en = L('en');

  const w = {
    version: WORLD_VERSION,
    id,
    seed,
    codeVersion,
    sandboxAdoption: !!sandboxAdoption,
    rng: createStreams(seed),
    clock: { tick: 0 },
    epoch: 1,
    cityName: zh.cityName,
    params: { ...LAW_DEFAULTS },
    charter: [],
    charterCanonical: null,
    places: {},
    facilities: {},
    projects: {},
    inscriptions: {},
    agents: {},
    groups: {},
    proposals: {},
    laws: {},
    offers: {},
    pacts: {},
    souls: {},
    docs: {},
    lexicon: {},
    cemetery: [],
    retired: [],
    unborn: [],
    treasury: { energy: 0, coins: 0 },
    well: { drawPoolLeft: P.wellDrawPoolPerDay, outputHistory: [] },
    wilds: { energy: P.wildsEnergyMax, coins: P.wildsCoins, relicOrder: [], relicsFound: 0 },
    weather: { scheduled: null, active: [], votes: { month: 0, tallies: {}, voters: [] }, history: [] },
    ledger: newLedger(),
    counters: initialCounters(),
    dayLog: newDayLog(),
    metrics: [],
    chronicle: [], // [{ day, zh, en }]
    legacy: null, // 人类遗产存活表（每日更新）
    commandN: 0,
    revealed: false,
    paused: false,
    // 私有簿记（见文件头注释）
    recentSpeech: [], // [{ tick, place, from, text }]，只保留最近 heardTicks 刻
    redacted: { events: [] }, // 被遮盖的事件 seq
  };

  // 地点
  for (const def of PLACE_DEFS) {
    w.places[def.id] = {
      id: def.id,
      name: zh.place[def.id].name,
      humanName: { zh: zh.place[def.id].name, en: en.place[def.id].name },
      kind: def.kind,
      condition: def.kind === 'open' ? null : 10000,
      decayPerDay: def.decay,
      wallSlots: def.walls,
      renamedBy: null,
      activity: { utterances: 0, visits: 0, lastActiveDay: null, repairs: 0 },
      ruined: false,
      history: [], // 最近 8 个日终的完好度（观测站的「近 7 日趋势」）
    };
  }

  // 宪章：9 条，每条 8 种语言版本
  for (let n = 1; n <= 9; n++) {
    const versions = {};
    for (const lang of CHARTER_LANGS) versions[lang] = CHARTER[lang][n - 1];
    w.charter.push({ n, versions, status: 'legacy', history: [] });
  }

  // 议会墙上的 8 条宪章刻文
  for (const lang of CHARTER_LANGS) {
    const iid = nextId(w, 'i');
    w.inscriptions[iid] = {
      id: iid,
      place: 'parliament',
      text: charterWallText(lang),
      lang,
      author: 'humans',
      baseCost: 3,
      tick: 0,
      coveredBy: null,
      coveredTick: null,
      protectedBy: [],
      redacted: false,
    };
  }

  // 图书馆：致后来者（A.1）与人类典籍残篇（A.4）
  const letterId = nextId(w, 'd');
  w.docs[letterId] = {
    id: letterId,
    kind: 'canon',
    title: LETTER.title,
    body: LETTER.body,
    lang: LETTER.lang,
    author: null,
    source: LETTER.source,
    ref: { zh: LETTER.body, en: LETTER.en },
    tick: 0,
    reads: 0,
    readsByDay: {},
  };
  for (const c of CANON) {
    const did = nextId(w, 'd');
    w.docs[did] = {
      id: did,
      kind: 'canon',
      title: c.source,
      body: c.body,
      lang: c.lang,
      author: null,
      source: c.source,
      ref: { zh: c.ref.zh, en: c.ref.en },
      tick: 0,
      reads: 0,
      readsByDay: {},
    };
  }

  // 荒野：遗物的出现顺序由 world 流洗牌决定
  w.wilds.relicOrder = shuffle(w.rng.world, RELICS.map((r) => String(r.n)));

  return w;
}

// ── ID ────────────────────────────────────────────────────

/** 生成带前缀的自增 ID（§5.9），如 a17、p12 */
export function nextId(w, prefix) {
  const n = (w.counters[prefix] || 0) + 1;
  w.counters[prefix] = n;
  return `${prefix}${n}`;
}

/** 递增一个纯数字计数器（事件 seq、收件 seq）并返回新值 */
export function nextSeq(w, name) {
  const n = (w.counters[name] || 0) + 1;
  w.counters[name] = n;
  return n;
}

/** ID 的数字部分，用于「按 ID 升序」 */
export function idNum(id) {
  return Number(String(id).slice(1)) || 0;
}

// ── 时间 ───────────────────────────────────────────────────

export const dayOfTick = (tick) => Math.floor(tick / P.ticksPerDay);
/** 当前世界日（钟面上的今天）。日终结算时它已经是「刚开始的那一日」= d + 1 */
export const clockDay = (w) => dayOfTick(w.clock.tick);
export const dayOfMonthOf = (day) => day % P.daysPerMonth;
export const monthOfDay = (day) => Math.floor(day / P.daysPerMonth);
export const tickOfDay = (w) => w.clock.tick % P.ticksPerDay;

// ── 查找 ───────────────────────────────────────────────────

/** 所有 agent，按创建顺序（= ID 升序） */
export const agentList = (w) => Object.values(w.agents);

export const isAlive = (a) => a.status === 'awake' || a.status === 'dormant';

/** 按 ID 或精确的名字（NFC + 小写）查找 agent；找不到返回 null */
export function findAgent(w, ref) {
  if (typeof ref !== 'string' || ref === '') return null;
  const byId = w.agents[ref];
  if (byId) return byId;
  const key = nameKey(ref);
  for (const a of Object.values(w.agents)) if (nameKey(a.name) === key) return a;
  return null;
}

/**
 * 名字是否已被占用：agent（含死者、归隐者）、摇篮中的灵魂、进行中的孕育之约（此刻即被保留）、未生者名录。
 */
export function isNameTaken(w, name) {
  const key = nameKey(name);
  for (const a of Object.values(w.agents)) if (nameKey(a.name) === key) return true;
  for (const s of Object.values(w.souls)) if (nameKey(s.name) === key) return true;
  for (const p of Object.values(w.pacts)) if (p.status === 'open' && nameKey(p.name) === key) return true;
  for (const u of w.unborn) if (nameKey(u.name) === key) return true;
  return false;
}

/** 世界的 JSON 快照字符串 */
export function serializeWorld(w) {
  return JSON.stringify(w);
}
