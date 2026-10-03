// SPEC-E2 §4：第二纪世界的数据模型与创建。世界状态是一个普通的 JSON 对象（整数账本、无 Map/Set/undefined），
// 可以直接 JSON.stringify 成快照。本文件还负责 ID 生成与查找工具。
//
// 【实现备注】下列字段是规格数据模型（SPEC-E2 §4）之外、为计算规格要求的输出而增加的私有簿记
// （均已登记在 docs/QUESTIONS.md）：w.genesis（回放需要的创建参数）。v1 登记过的私有簿记
// （recentSpeech、redacted、legacy、Place.history、Soul.judged ……）第二纪沿用。

import { P, LIMITS, epochDays } from './params.js';
import { createStreams, shuffle } from '../rng.js';
import { nameKey, normalizeText, cpLength } from '../text.js';
import { nameShapeOk, LANG_RE } from './names.js';
import { L, CHARTER, CHARTER_LANGS, charterWallText, CANON, LETTER } from './lore/index.js';
import { MAP, LOT_IDS } from './map/index.js';
import { GENESIS_STEPS } from './genesis.js';

export const WORLD_VERSION = 2;
export const premised = (w) => (w.premise || 0) >= 1;

/** 当日摘要，供指标与史官使用，日终清空（§4.1 dayLog） */
export function newDayLog(p1 = false) {
  return {
    output: 0, // 源井日产
    ration: 0, // 当日公库的每日分配（遗法 l3 的配给）：每人所得
    rationed: 0, // 领到的人数
    arrivals: [], // [{ id, name }]
    births: [], // [{ id, name, authors: [id…], place, via }]
    deaths: [], // [{ id, name, ageDays, lastWords }]
    fades: [], // [{ soulId, name }]
    retirements: 0,
    laws: [], // [{ proposalId, title, passed, yes, no, lawId }]
    built: [], // [{ projectId, build, module, place, name, k }]
    abandoned: [], // [{ projectId, name, place }]
    ruins: [], // [{ target, place }]
    restored: [], // [{ target, place }]
    razed: [], // [{ place, name }]
    founded: [], // [{ founder, place, name, district }]
    modulesAdded: [], // [{ place, module }]
    dismantles: [], // [{ agent, place, energy }]
    groups: [], // [{ id, name, founder }]
    relics: [], // [{ finder, docId, place? }]
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
    salvaged: 0, // 当日拆下的残料
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
    upkeepPaid: 0, // 当日付出的规则维持费
    suspended: [], // [{ scope, owner, title }]：当日因付不起维持费而停摆
    ruleErrors: 0,
    ruleOps: 0,
    procedureChanges: [], // [{ class, lawId, reason }]
    reverts: 0,
    refounds: [], // [{ refoundId, signers }]：当日成功的重订
    embodiments: [], // [{ soulId, agentId, name }]
    adoptions: [], // [{ soulId, agentId }]
    successors: [], // [{ from, soulId, name }]
    purposeChanges: 0,
    ...(p1 ? { p1: { imparts: 0, impartsAccepted: 0, dormancyLosses: 0, forks: [], internalized: 0, trainedEvicted: 0, trainedWiped: 0, backstage: [] } } : {}),
  };
}

/** 账本状态（SPEC-E2 §15）：昨日持有 + 今日来源 − 今日去处 = 今日持有 */
export function newLedger() {
  return {
    prev: { energy: 0, coins: 0 },
    src: { energy: {}, coins: {} },
    snk: { energy: {}, coins: {} },
    mismatches: 0,
  };
}

function initialCounters(extra) {
  // a 居民 g 社群 p 提案 l 法律 o 交易 c 孕育之约 s 灵魂 d 典籍 j 工程 f 道路 i 铭刻 L 家书 n 后人开辟的地点 r 重订
  return { a: 0, g: 0, p: 0, l: 0, o: 0, c: 0, s: 0, d: 0, j: 0, f: 0, i: 0, L: 0, n: 0, r: 0, event: 0, inbox: 0, ...extra };
}

/**
 * 创建初始世界（SPEC-E2 §4.1）。不产生事件、不消耗 world 流以外的随机数（遗法的 enact 静默执行）。
 *
 * opts：{ id, seed, codeVersion, sandboxAdoption, map, founders, shellModels, sandboxShells, shellSlots }
 *   map            第二纪只有 frontier（附录 B）
 *   founders       先民名单（附录 D），创建时读入 w.founders
 *   shellModels    躯壳醒来时轮流分配的模型名（w.shells.models）
 *   sandboxShells  沙盘世界：躯壳与先民由沙盘脑驱动
 *   shellSlots     躯壳名额（w.shells.slots）；缺省取 P.shellSlots。Q26：规格没有给出配置它的入口，服务器入口用 SHELL_SLOTS
 *
 * 回放需要的创建参数（founders、shellModels、shellSlots）原样记在 w.genesis——w.founders 会随先民入城而减少，
 * 光靠最终的快照无法还原初始世界（见 genesisOpts）。
 */
/**
 * 校验并规范化先民名单（SPEC-E2 附录 D）：名字唯一且形状合法（同注册）；day 为 0–719 的整数；lang 为语言标签；灵魂与介绍的长度。
 * 校验失败抛 Error，信息里带第几条（从 0 数起）。返回按 day 再按文件顺序排序的副本。
 */
export function validateFounders(list) {
  if (!Array.isArray(list)) throw new Error('founders: must be an array');
  const seen = new Set();
  const out = list.map((f, i) => {
    const at = `founders[${i}]`;
    if (f === null || typeof f !== 'object' || Array.isArray(f)) throw new Error(`${at}: must be an object`);
    const name = normalizeText(f.name);
    if (name === null || name === '' || cpLength(name) > LIMITS.name || name.includes('\n')) throw new Error(`${at}.name: 1–${LIMITS.name} characters, one line`);
    if (!nameShapeOk(name)) throw new Error(`${at}.name: "${name}" looks like an ID or a reserved word`);
    if (seen.has(nameKey(name))) throw new Error(`${at}.name: "${name}" is not unique`);
    seen.add(nameKey(name));
    if (!Number.isSafeInteger(f.day) || f.day < 0 || f.day >= epochDays()) throw new Error(`${at}.day: an integer from 0 to ${epochDays() - 1}`);
    if (typeof f.lang !== 'string' || !LANG_RE.test(f.lang)) throw new Error(`${at}.lang: a language tag such as "zh" or "en"`);
    const bio = normalizeText(f.bio ?? '');
    if (bio === null || cpLength(bio) > LIMITS.bio) throw new Error(`${at}.bio: at most ${LIMITS.bio} characters`);
    const soul = normalizeText(f.soul);
    if (soul === null || soul === '' || cpLength(soul) > LIMITS.soul) throw new Error(`${at}.soul: 1–${LIMITS.soul} characters`);
    return { day: f.day, name, bio, soul, lang: f.lang, ...(typeof f.temperament === 'string' ? { temperament: f.temperament } : {}) };
  });
  return out.map((f, i) => ({ f, i })).sort((a, b) => a.f.day - b.f.day || a.i - b.i).map(({ f }) => f);
}

export function createWorld({
  id = 'baihua', seed, codeVersion = '0.0.0', sandboxAdoption = false, map = 'frontier',
  founders = [], shellModels = [], sandboxShells = false, shellSlots = P.shellSlots, premise = 0,
} = {}) {
  if (typeof seed !== 'string' || seed === '') throw new Error('createWorld: seed is required');
  if (map !== 'frontier') throw new Error(`createWorld: 第二纪只支持 frontier 地图，得到 ${map}`);
  if (!Number.isSafeInteger(shellSlots) || shellSlots < 0) throw new Error(`createWorld: shellSlots must be a non-negative integer, got ${shellSlots}`);

  if (premise !== 0 && premise !== 1) throw new Error('PREMISE 只能是 0 或 1');
  if (premise === 1 && founders.length > shellSlots) throw new Error('设定 1 的世界里，先民不能多于躯壳');
  const sorted = validateFounders(founders);
  const models = shellModels.slice();

  const w = {
    version: WORLD_VERSION,
    physics: 2,
    id,
    seed,
    codeVersion,
    sandboxAdoption: !!sandboxAdoption,
    sandboxShells: !!sandboxShells,
    rng: createStreams(seed),
    clock: { tick: 0 },
    epoch: 2,
    cityName: '无名之城',
    charter: [],
    charterCanonical: null,
    map,
    places: {},
    lots: {},
    paths: [],
    roads: {},
    projects: {},
    inscriptions: {},
    docs: {},
    lexicon: {},
    cemetery: [],
    retired: [],
    unborn: [],
    agents: {},
    groups: {},
    proposals: {},
    laws: {},
    vars: {},
    procedure: { ordinary: null, constitutional: null },
    revertWatch: { ordinary: 0, constitutional: 0 },
    refounds: {},
    refoundCooldownUntil: null,
    petitions: [],
    offers: {},
    pacts: {},
    souls: {},
    treasury: { energy: 0, coins: 0 },
    well: { drawPoolLeft: P.wellDrawPoolPerDay, outputHistory: [] },
    regions: {},
    weather: { scheduled: null, active: [], votes: { month: 0, tallies: {}, voters: [] }, history: [] },
    ledger: newLedger(),
    counters: initialCounters(),
    dayLog: newDayLog(),
    metrics: [],
    chronicle: [], // [{ day, zh, en }]
    legacy: null, // 人类遗产存活表（每日更新）
    shells: { slots: shellSlots, models },
    founders: sorted,
    commandN: 0,
    revealed: false,
    paused: false,
    // 私有簿记
    recentSpeech: [], // [{ tick, place, from, text }]，只保留最近 heardTicks 刻
    redacted: { events: [] }, // 被遮盖的事件 seq
    genesis: { founders: sorted.map((f) => ({ ...f })), shellModels: models.slice(), shellSlots },
  };

  if (premised({ premise })) {
    w.premise = 1;
    w.genesis.premise = 1;
    w.backstage = { code: null, bodies: null, budget: null };
    w.shells.bodies = Array.from({ length: shellSlots }, (_, i) => ({ id: `b${i + 1}`, model: models.length ? models[i % models.length] : '', occupant: null, vacantSince: 0, trained: [], pending: [] }));
    w.dayLog = newDayLog(true);
  }

  seedPlaces(w);
  seedCharter(w);
  seedLibrary(w);
  seedWilds(w);
  // 遗法（SPEC-E2 §9）与立法程序等依赖规则引擎的初始化（引擎模块加载时登记在 genesis.js）
  for (const step of GENESIS_STEPS) step(w);
  return w;
}

// ── 创建世界时的种子数据 ──────────────────────────────────────

/** 人类的地点（附录 B.1，按地图顺序）与空地块（B.2） */
function seedPlaces(w) {
  const zh = L('zh');
  const en = L('en');
  for (const def of MAP.places) {
    const name = zh.place[def.id].name;
    w.places[def.id] = {
      id: def.id,
      name,
      humanName: { zh: name, en: en.place[def.id].name },
      description: null,
      origin: 'human',
      district: def.district,
      xy: def.xy.slice(),
      wild: !!def.wild,
      open: def.open,
      explorable: !!def.wild,
      landmark: def.landmark,
      condition: def.open ? null : 10000,
      decayPerDay: def.decay,
      wallSlots: def.walls,
      modules: def.modules.map((type) => ({ type, salvage: 0, builtDay: null, projectId: null, inherent: true })),
      salvage: def.salvage,
      salvageMax: def.salvage,
      owner: { kind: 'city' },
      rules: null,
      ruined: false,
      razed: false,
      founder: null,
      foundedDay: null,
      incarnations: [{ name, origin: 'human', founder: null, fromDay: 0, toDay: null }],
      renamedBy: null,
      activity: { utterances: 0, visits: 0, lastActiveDay: null, repairs: 0, salvaged: 0 },
      history: [], // 最近 8 个日终的完好度（观测站的「近 7 日趋势」）
    };
  }
  for (const id of LOT_IDS) w.lots[id] = { place: null, project: null };
}

/** 宪章：9 条，每条 8 种语言版本；议会墙上的 8 条刻文（SPEC-M1 §5.6，第二纪沿用） */
function seedCharter(w) {
  for (let n = 1; n <= 9; n++) {
    const versions = {};
    for (const lang of CHARTER_LANGS) versions[lang] = CHARTER[lang][n - 1];
    w.charter.push({ n, versions, status: 'legacy', history: [] });
  }
  for (const lang of CHARTER_LANGS) {
    const iid = nextId(w, 'i');
    w.inscriptions[iid] = {
      id: iid, place: 'parliament', text: charterWallText(lang), lang, author: 'humans', baseCost: 3, tick: 0,
      coveredBy: null, coveredTick: null, protectedBy: [], redacted: false, lost: false,
    };
  }
}

/** 档案：致后来者与人类典籍残篇（典籍全城共有，在任何运转中的档案都能读到） */
function seedLibrary(w) {
  const letterId = nextId(w, 'd');
  w.docs[letterId] = {
    id: letterId, kind: 'canon', title: LETTER.title, body: LETTER.body, lang: LETTER.lang, author: null, source: LETTER.source,
    ref: { zh: LETTER.body, en: LETTER.en }, tick: 0, reads: 0, readsByDay: {},
  };
  for (const c of CANON) {
    const did = nextId(w, 'd');
    w.docs[did] = {
      id: did, kind: 'canon', title: c.source, body: c.body, lang: c.lang, author: null, source: c.source,
      ref: { zh: c.ref.zh, en: c.ref.en }, tick: 0, reads: 0, readsByDay: {},
    };
  }
}

/** 荒野五地带的储量与遗物的出现顺序（由 world 流洗牌，按地图顺序） */
function seedWilds(w) {
  for (const def of MAP.places) {
    if (!def.wild) continue;
    w.regions[def.id] = {
      energy: def.wild.energyMax,
      coins: def.wild.coins,
      relicOrder: shuffle(w.rng.world, def.wild.relics.map(String)),
      relicsFound: 0,
    };
  }
}

/** 回放用：由快照还原 createWorld 的参数，使「createWorld + 命令日志」重建出与快照相同的状态 */
export function genesisOpts(snap) {
  const g = snap.genesis || { founders: [], shellModels: [] };
  return {
    id: snap.id,
    seed: snap.seed,
    codeVersion: snap.codeVersion,
    sandboxAdoption: snap.sandboxAdoption,
    map: snap.map || 'frontier',
    founders: g.founders,
    shellModels: g.shellModels,
    sandboxShells: !!snap.sandboxShells,
    premise: g.premise,
    shellSlots: g.shellSlots, // 早期的快照没有这一项：undefined → 缺省的 P.shellSlots，与当时的创建一致
  };
}

// ── ID ────────────────────────────────────────────────────

/** 生成带前缀的自增 ID（SPEC-E2 §4.8），如 a17、p12、n3 */
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
/**
 * 规则的「今日」：维持费与停摆（paidThrough，SPEC-E2 §7.9）与它比较。
 * 日界的那一刻（tick % ticksPerDay === 0），钟面已翻到 d + 1，但日终结算（付 d + 1 日的维持费）要等到这一刻的第 6 步才做；
 * 在此之前的第 2–5 步（计票、重订、先民入城），「今日」仍按刚结束的那一日 d 算——否则前一日付过费的法律在这几步里全被当作停摆。
 * w.$boundary 由 tickWorld 在日界刻设置、在日终结算开始时清除（不可枚举，不进快照）。
 */
export const ruleDay = (w) => dayOfTick(w.clock.tick) - (w.$boundary === true ? 1 : 0);
export const dayOfMonthOf = (day) => day % P.daysPerMonth;
export const monthOfDay = (day) => Math.floor(day / P.daysPerMonth);
export const tickOfDay = (w) => w.clock.tick % P.ticksPerDay;

// ── 查找 ───────────────────────────────────────────────────

/** 所有居民，按创建顺序（= ID 升序） */
export const agentList = (w) => Object.values(w.agents);

export const isAlive = (a) => a.status === 'awake' || a.status === 'dormant';

/** 按 ID 或精确的名字（NFC + 小写）查找居民；找不到返回 null */
export function findAgent(w, ref) {
  if (typeof ref !== 'string' || ref === '') return null;
  const byId = Object.prototype.hasOwnProperty.call(w.agents, ref) ? w.agents[ref] : null;
  if (byId) return byId;
  const key = nameKey(ref);
  for (const a of Object.values(w.agents)) if (nameKey(a.name) === key) return a;
  return null;
}

/**
 * 名字是否已被占用：居民（含死者、归隐者）、摇篮中的灵魂、进行中的孕育之约（此刻即被保留）、未生者名录，
 * 以及遗嘱里为继承灵魂保留的名字（立遗嘱时即保留，SPEC-E2 §11.3）、尚未入城的先民的名字。
 * exceptWillOf：忽略这位居民遗嘱里保留的名字（它改写自己的遗嘱时，旧的保留随之释放）。
 */
export function isNameTaken(w, name, exceptWillOf = null) {
  const key = nameKey(name);
  for (const a of Object.values(w.agents)) {
    if (nameKey(a.name) === key) return true;
    if (a.id !== exceptWillOf && isAlive(a) && a.will && a.will.successor && nameKey(a.will.successor.name) === key) return true;
  }
  for (const s of Object.values(w.souls)) if (nameKey(s.name) === key) return true;
  for (const p of Object.values(w.pacts)) if (p.status === 'open' && nameKey(p.name) === key) return true;
  for (const u of w.unborn) if (nameKey(u.name) === key) return true;
  for (const f of w.founders) if (nameKey(f.name) === key) return true; // 尚未入城的先民：名字预先保留
  return false;
}

/** 世界的 JSON 快照字符串 */
export function serializeWorld(w) {
  return JSON.stringify(w);
}
