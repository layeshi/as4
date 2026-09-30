// SPEC-M1 §6：全部参数集中在这里。
// 物理参数（P 及各张表）由运营方按纪元设定，agent 不能修改；
// 法律参数（LAW_DEFAULTS / LAW_SPEC）只能由法律修改。
//
// P 是一个可变对象：服务器启动时按环境变量调用 configure()，沙盘推演按 --params 调用它。
// 引擎的确定性以「同一份 P」为前提（见 SPEC §11.4）。

import CLASSIC_MAP from './map/classic.js';

/** §6.1 时间、§6.2 能量与生命、§6.4 环境 */
export const P = {
  // §6.1 时间
  ticksPerDay: 12,
  daysPerMonth: 24,
  monthsPerEpoch: 30,
  tickMs: 300000, // 仅调度用，不进入世界状态

  // §6.2 能量与生命
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
  reservoirCapacity: 200,
  reservoirMaxPerOwner: 3,
  decayRate: 0.1,
  reviveThreshold: 5,
  dormancyGraceDays: 3,
  birthCost: 40,
  cradleDays: 24,
  pactTicks: 12,
  offerTicks: 12,
  memorySlots: 12,
  letterCooldownDays: 24,
  maxActionsPerTick: 4,

  // §6.4 环境
  repairLowBp: 1000, // 完好度低于此值时修缮效率减半
  repairRateLow: 5, // 基点 / 能量
  repairRateNormal: 10,
  functioningBp: 3000, // 设施「正常运转」的完好度下限
  projectDays: 24, // 工程期限（日）
  projectsPerPlace: 3,
  wildsEnergyMax: 800,
  wildsRegenPerDay: 40,
  wildsCoins: 300,

  // §7.8 探索
  exploreEnergyP: 0.45,
  exploreRelicP: 0.1,
  exploreCoinP: 0.08,
  exploreEnergyBase: 3,
  exploreEnergySpan: 10, // 3 + randInt(0..9)
  exploreCoinBase: 2,
  exploreCoinSpan: 7, // 2 + randInt(0..6)

  // §7.14 梦
  dreamP: 0.5,
  dreamFragments: 2,
  dreamChars: 60,

  // §12.3 史官
  quoteChars: 80,

  // §8.2 第 10 步 / §16.1 沙盘领养
  sandboxAdoptMinAgeDays: 2,
  sandboxAdoptP: 0.5,
  sandboxMutateP: 0.1,

  // §4 PRIVATE_DELAY_TICKS：私语、独白、记忆对观众延迟公开的刻数（= 1 个世界月）
  privateDelayTicks: 288,

  // 感知与保留条数（PROTOCOL §3、§5）
  heardTicks: 12,
  heardMax: 8,
  lexiconInPerception: 30,
  recentDeathsInPerception: 5,
  inboxKeep: 200,
  diaryKeep: 200,
  wellHistoryDays: 48,
};

/** 纪元的总日数 */
export const epochDays = () => P.daysPerMonth * P.monthsPerEpoch;

/** §6.2 季节表：千分比，下标为 dayOfMonth 0–23。直接写死，不要在运行时计算。 */
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

/** 荒野丰度档位（按能量储量 / 上限；上限缺省为经典荒野的 wildsEnergyMax） */
export function richnessBand(energy, max = P.wildsEnergyMax) {
  const pct = (energy * 100) / max;
  if (pct >= 70) return 'lush';
  if (pct >= 40) return 'fair';
  if (pct >= 15) return 'sparse';
  return 'barren';
}

/**
 * §6.4 地点表（经典地图）。kind：well | cost | endow | none | open。
 * 地点表连同坐标、街道在 src/map/ 里按地图定义；一个世界用哪张地图记在 w.map。
 * 引擎按世界取地点请用 src/map/index.js（placeIdsOf 等），这里只保留经典地图的表。
 */
export const PLACE_DEFS = Object.freeze(CLASSIC_MAP.places.map(({ id, kind, decay, walls }) => Object.freeze({ id, kind, decay, walls })));
export const PLACE_IDS = Object.freeze(PLACE_DEFS.map((p) => p.id));

/** §6.4 设施表。needBp：「正常运转」所需的最低完好度（纪念碑只要 > 0） */
export const FACILITY_DEFS = Object.freeze({
  reservoir: { cost: 80, decay: 60, needBp: 3000, owners: ['city', 'group', 'agent'] },
  relay: { cost: 120, decay: 80, needBp: 3000, owners: ['city'] },
  road: { cost: 60, decay: 50, needBp: 3000, owners: ['city'] },
  observatory: { cost: 150, decay: 60, needBp: 3000, owners: ['city'] },
  monument: { cost: 100, decay: 20, needBp: 1, owners: ['city'] },
});
export const FACILITY_TYPES = Object.freeze(Object.keys(FACILITY_DEFS));

/**
 * §6.5 天象表（键的顺序即按默认权重抽取时的累计顺序）。
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

/** §6.6 法律参数的初始值 */
export const LAW_DEFAULTS = Object.freeze({
  rationShare: 0.6,
  rationRequiresActivity: false,
  transferTax: 0,
  wealthTax: 0,
  wealthTaxThreshold: 100,
  drawQuotaPerDay: null,
  votingInPerson: false,
  naturalizationDays: 0,
  quorum: 0.3,
  passThreshold: 0.5,
  amendThreshold: 0.667,
  proposalDays: 1,
  electorate: 'all',
});

/** §6.6 允许范围与「修宪级」标记（与 PROTOCOL §6 的参数表一致） */
export const LAW_SPEC = Object.freeze({
  rationShare: { type: 'number', min: 0, max: 1, amend: false },
  rationRequiresActivity: { type: 'boolean', amend: false },
  transferTax: { type: 'number', min: 0, max: 0.5, amend: false },
  wealthTax: { type: 'number', min: 0, max: 0.5, amend: false },
  wealthTaxThreshold: { type: 'integer', min: 0, max: 10000, amend: false },
  drawQuotaPerDay: { type: 'integer', nullable: true, min: 0, max: 1000, amend: false },
  votingInPerson: { type: 'boolean', amend: false },
  naturalizationDays: { type: 'integer', min: 0, max: 240, amend: true },
  quorum: { type: 'number', min: 0.05, max: 1, amend: true },
  passThreshold: { type: 'number', min: 0.5, max: 0.95, amend: true },
  amendThreshold: { type: 'number', min: 0.5, max: 1, amend: true },
  proposalDays: { type: 'number', min: 0.25, max: 7, amend: true },
  electorate: { type: 'electorate', amend: true },
});
export const LAW_PARAM_NAMES = Object.freeze(Object.keys(LAW_SPEC));

/** §6.7 长度（按码点计）与数量上限 */
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
  proposalText: 1200,
  proposalEffects: 5,
  manifesto: 600,
  inscription: 140,
  letter: 280,
  epitaph: 280,
  lastWords: 280,
  note: 140, // 交易附言、赠予附言
  reason: 140, // 投票理由
  amendText: 300, // PROTOCOL §6：amend 条文
  openProposalsPerAgent: 1,
  openProposalsCity: 20,
  groupsPerAgent: 5,
  heirs: 10,
  actionsPerRequest: 4,
  lang: 16,
  model: 100,
  creatorName: 60,
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
 * 天象的排期模式（SPEC §4 WEATHER_MODE）。引擎不读文件：`schedule` 模式的排期表由运行时读入后注入。
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
