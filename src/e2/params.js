// SPEC-E2 §5：第二纪的物理参数。
//
// 第二纪没有「法律参数」（v1 的 LAW_DEFAULTS / LAW_SPEC）：配给比例、选民范围、表决门槛、转赠税、汲取配额……
// 都不再是参数，而是遗法里的变量与规则（SPEC-E2 §9）。这里只有物理。
//
// P 是一个可变对象：服务器启动时按环境变量调用 configure()，沙盘按 --params 调用它。引擎的确定性以「同一份 P」为前提。
// v2 的代码不得引入 v1 的 params.js（SPEC-E2 §2.2）：下面凡是「沿用 v1」的数值，都是复制过来的，两代各自独立。

/** §5.1 沿用 v1 的数值（时间、能量与生命、环境、探索、梦、史官、沙盘领养）与 §5.2 新增的数值 */
export const P = {
  // 时间（SPEC-M1 §6.1）
  ticksPerDay: 12,
  daysPerMonth: 24,
  monthsPerEpoch: 30,
  tickMs: 300000, // 仅调度用，不进入世界状态

  // 能量与生命（SPEC-M1 §6.2）
  wellBaseOutput: 600,
  wellFloorPermille: 200,
  wellDrawPoolPerDay: 60,
  drawDamageBp: 20,
  drawMaxPerAction: 20,
  immigrantEnergy: 40,
  immigrantCoins: 20,
  metabolismBase: 3,
  agingEveryDays: 48,
  capAgent: 120,
  capGroup: 100,
  capTreasury: 300,
  reservoirCapacity: 200, // 储能模块给所有者增加的腐坏上限
  reservoirMaxPerOwner: 3,
  decayRate: 0.1,
  reviveThreshold: 5,
  dormancyGraceDays: 3,
  birthCost: 40, // 一个灵魂的初始能量，由全体作者平摊（SPEC-E2 §11.1）
  cradleDays: 24,
  pactTicks: 12,
  offerTicks: 12,
  memorySlots: 12,
  letterCooldownDays: 24,
  maxActionsPerTick: 4,

  // 环境（SPEC-M1 §6.4）
  repairLowBp: 1000, // 完好度低于此值时修缮效率减半
  repairRateLow: 5, // 基点 / 能量
  repairRateNormal: 10,
  functioningBp: 3000, // 模块「正常运转」的完好度下限（模块表里每种另有自己的下限）
  projectDays: 24, // 工程期限（日）
  projectsPerPlace: 3,

  // 探索（SPEC-M1 §7.8）
  exploreEnergyP: 0.45,
  exploreRelicP: 0.1,
  exploreCoinP: 0.08,
  exploreEnergyBase: 3,
  exploreEnergySpan: 10, // 3 + randInt(0..9)
  exploreCoinBase: 2,
  exploreCoinSpan: 7, // 2 + randInt(0..6)

  // 梦（SPEC-M1 §7.14）
  dreamP: 0.5,
  dreamFragments: 2,
  dreamChars: 60,

  // 史官
  quoteChars: 80,

  // 沙盘领养（SPEC-M1 §8.2 第 10 步 / §16.1）
  sandboxAdoptMinAgeDays: 2,
  sandboxAdoptP: 0.5,
  sandboxMutateP: 0.1,

  // PRIVATE_DELAY_TICKS：私语、独白、记忆对观众延迟公开的刻数（= 1 个世界月）
  privateDelayTicks: 288,

  // 感知与保留条数
  heardTicks: 12,
  heardMax: 8,
  lexiconInPerception: 30,
  recentDeathsInPerception: 5,
  inboxKeep: 200,
  diaryKeep: 200,
  wellHistoryDays: 48,

  // ── §5.2 新增 ──
  lawFloor: 10, // 生存底线
  ruleUpkeep: 1, // 每条持续生效的规则每日的维持费
  ruleFuel: 2000, // 每次执行的步数上限
  rulesPerLaw: 8,
  opsPerRule: 8,
  exprChars: 300,
  exprNodes: 120,
  lawBytes: 4096, // 一部法律（或一份章程、一份地点规则）的 JSON 字节数
  templateChars: 280, // 宣告模板
  varsCity: 64,
  varsGroup: 16,
  varNameChars: 32,
  tagChars: 24,
  periodMin: 1, // 表决期（刻）
  periodMax: 168,
  autoRevertDays: 3,
  refoundCost: 6,
  signCost: 1,
  refoundWindowTicks: 36, // 3 日
  refoundResidenceDays: 3, // 分母只算入城满 3 日的在世居民
  refoundCooldownDays: 24,
  refoundsOpenMax: 3, // 全城同时进行中的重订
  groupVoteTicks: 12, // 社群提案的表决期
  siteCostCity: 40, // 开辟新地点的造价
  siteCostWild: 30,
  siteDecay: 20, // 后人开辟的地点的基础衰败与墙位
  siteWalls: 4,
  modulesPerPlace: 4,
  pathCostCity: 1, // 新地点连上的小路的代价
  pathCostWild: 2,
  salvagePerAction: 15,
  dismantleBase: 2, // 拆解的动作代价
  roadCost: 60,
  roadDecay: 50,
  authorsMax: 5,
  inheritMemoriesMax: 3, // 每位作者
  successorMax: 40, // 传灯时从遗产里取的初始能量上限
  shellSlots: 30, // 创建世界时写入 w.shells.slots
  shellCost: 200,
  shellQueueDays: 24,
  purposeChars: 200,
  purposeKeep: 20,
  purposeInPresent: 60,
  lawsInPerception: 30,
  lawTextInPerception: 200,
  readingInPerception: 400,
};

/** 纪元的总日数 */
export const epochDays = () => P.daysPerMonth * P.monthsPerEpoch;

/** 季节表：千分比，下标为 dayOfMonth 0–23。直接写死，不要在运行时计算（SPEC-M1 §6.2）。 */
export const SEASON_TABLE = Object.freeze([
  1000, 1065, 1125, 1177, 1217, 1241, 1250, 1241, 1217, 1177, 1125, 1065,
  1000, 935, 875, 823, 783, 759, 750, 759, 783, 823, 875, 935,
]);

/** 季节档位：≥1100 丰，900–1099 平，<900 歉 */
export function seasonBand(permille) {
  if (permille >= 1100) return 'abundant';
  if (permille >= 900) return 'ordinary';
  return 'lean';
}

/** 完好度档位（基点） */
export function conditionBand(bp) {
  if (bp >= 9000) return 'pristine';
  if (bp >= 6000) return 'worn';
  if (bp >= 3000) return 'weathered';
  if (bp >= 1) return 'dilapidated';
  return 'ruin';
}

/** 荒野丰度档位（按能量储量 / 上限） */
export function richnessBand(energy, max) {
  const pct = (energy * 100) / max;
  if (pct >= 70) return 'lush';
  if (pct >= 40) return 'fair';
  if (pct >= 15) return 'sparse';
  return 'barren';
}

/**
 * 天象表（SPEC-M1 §6.5，第二纪不变；键的顺序即按默认权重抽取时的累计顺序）。
 * duration：持续日数；factor：源井天象系数（千分比）；omenPlace：征兆出现的地点（all = 所有地点）。
 */
export const WEATHER_DEFS = Object.freeze({
  calm: { duration: 0, weight: 400, omenPlace: null },
  drought: { duration: 3, weight: 120, omenPlace: 'well', factor: 600 },
  bounty: { duration: 3, weight: 120, omenPlace: 'well', factor: 1400 },
  quake: { duration: 1, weight: 80, omenPlace: 'all' },
  fog: { duration: 2, weight: 100, omenPlace: 'port' },
  eclipse: { duration: 1, weight: 60, omenPlace: 'temple' },
  amnesia: { duration: 1, weight: 40, omenPlace: 'library' },
  aurora: { duration: 2, weight: 50, omenPlace: 'wilds' },
  migration: { duration: 1, weight: 30, omenPlace: 'port' },
});
export const WEATHER_CODES = Object.freeze(Object.keys(WEATHER_DEFS));

/**
 * 模块表（SPEC-E2 §5.3）。cost：造价；decay：加装后建筑每日多衰败（基点）；needBp：运转下限（基点）。
 * 后人加装的模块，残料 = floor(造价 / 2)；人类建筑原有的模块（inherent），残料为 0，也不另加衰败。
 */
export const MODULE_DEFS = Object.freeze({
  store: { cost: 80, decay: 20, needBp: 3000 },
  relay: { cost: 120, decay: 30, needBp: 3000 },
  sensor: { cost: 150, decay: 30, needBp: 3000 },
  archive: { cost: 120, decay: 20, needBp: 3000 },
  board: { cost: 60, decay: 10, needBp: 3000 },
  surface: { cost: 100, decay: 5, needBp: 1 },
  memorial: { cost: 60, decay: 10, needBp: 3000 },
  cradle: { cost: 100, decay: 20, needBp: 3000 },
  gate: { cost: 40, decay: 10, needBp: 3000 },
});
export const MODULE_TYPES = Object.freeze(Object.keys(MODULE_DEFS));

/** 长度（按码点计）与数量上限（SPEC-M1 §6.7 与 SPEC-E2 §5.4） */
export const LIMITS = Object.freeze({
  name: 24,
  bio: 200,
  soul: 4000,
  speech: 500, // say / whisper / broadcast
  thought: 300,
  diary: 1000,
  memory: 200,
  docTitle: 60,
  docBody: 4000,
  word: 24,
  meaning: 200,
  proposalTitle: 60,
  proposalText: 1200, // 法律正文同提案正文
  manifesto: 600,
  inscription: 140,
  letter: 280,
  epitaph: 280,
  lastWords: 280,
  note: 140, // 交易附言、赠予附言
  reason: 140, // 投票理由、规则里的拒绝理由
  amendText: 300, // amend 条文
  openProposalsPerAgent: 1,
  openProposalsCity: 20,
  openProposalsPerGroup: 3,
  groupsPerAgent: 5,
  heirs: 10,
  actionsPerRequest: 4,
  lang: 16,
  model: 100,
  creatorName: 60,
  // 第二纪新增
  description: 200, // 后人开辟的地点的描述
  purpose: 200, // 志
  petition: 600, // 上书
  refoundText: 1200, // 重订的理由
  stringValue: 140, // 变量的字符串值、表达式里的字符串字面量
});

/**
 * 覆盖 P 中的参数（启动时按环境变量、沙盘按 --params）。
 * 只接受 P 中已有的数值键，拼写错误立即报错，避免静默无效。
 */
export function configure(overrides = {}) {
  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in P)) throw new Error(`unknown parameter: ${k}`);
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`parameter ${k} must be a finite number`);
    P[k] = v;
  }
  return P;
}

/** 复制当前 P（测试里用于还原） */
export function snapshotP() {
  return { ...P };
}
export function restoreP(saved) {
  for (const k of Object.keys(P)) delete P[k];
  Object.assign(P, saved);
}

/**
 * 天象的排期模式（WEATHER_MODE）。引擎不读文件：`schedule` 模式的排期表由运行时读入后注入。
 * mode：vote | random | schedule；schedule：[{ month, type, dayOfMonth }]，缺失的月份为 calm。
 * 与 P 一样，它属于「确定性环境」：回放需要同样的配置。
 */
export const WEATHER = { mode: 'vote', schedule: [] };

export function configureWeather({ mode = 'vote', schedule = [] } = {}) {
  if (!['vote', 'random', 'schedule'].includes(mode)) throw new Error(`unknown weather mode: ${mode}`);
  if (!Array.isArray(schedule)) throw new Error('weather schedule must be an array');
  for (const s of schedule) {
    if (!Number.isInteger(s.month) || s.month < 0 || !(s.type in WEATHER_DEFS) || !Number.isInteger(s.dayOfMonth) || s.dayOfMonth < 0 || s.dayOfMonth >= P.daysPerMonth) {
      throw new Error(`invalid weather schedule entry: ${JSON.stringify(s)}`);
    }
  }
  WEATHER.mode = mode;
  WEATHER.schedule = schedule.map((s) => ({ month: s.month, type: s.type, dayOfMonth: s.dayOfMonth }));
  return WEATHER;
}
