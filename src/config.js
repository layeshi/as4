// SPEC-M1 §4 与 SPEC-E2 §3：环境变量与命令行参数。

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { ENGINES } from './engines.js';
import { setBlocklist } from './moderation.js';
import { MAP_IDS, DEFAULT_MAP } from './map/index.js';

/** 新世界缺省用第二纪的物理（SPEC-E2 §3）。只有服务器入口采用它；loadConfig 的缺省见 Q13 */
export const DEFAULT_PHYSICS = 2;

const num = (v, d) => {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`环境变量的值不是数字：${v}`);
  return n;
};

/**
 * 解析配置。env 默认取 process.env，argv 默认取 process.argv.slice(2)。
 * --demo 等价于 TICK_MS=3000、SANDBOX_AGENTS=16（两代物理相同）；--reset 删除当前 WORLD_ID 的数据后重建。
 *
 * PHYSICS（SPEC-E2 §3）：新世界用哪一纪的物理，1 或 2，只在创建新世界时生效。未指定时取 defaultPhysics：
 * 服务器入口传 DEFAULT_PHYSICS（第二纪）；其他调用方不传，得到 null，Runtime.open 按第一纪创建——
 * 这样原有的调用方（包括原有的测试）创建的世界不变。TODO(spec): Q13
 */
export function loadConfig(env = process.env, argv = process.argv.slice(2), { defaultPhysics = null } = {}) {
  const demo = argv.includes('--demo');
  const reset = argv.includes('--reset');
  const cfg = {
    port: num(env.PORT, 8787),
    host: env.HOST || '127.0.0.1',
    worldId: env.WORLD_ID || 'baihua',
    seed: env.SEED || null, // 只在创建新世界时生效；未设置则在创建时随机生成
    physics: env.PHYSICS === undefined || env.PHYSICS === '' ? defaultPhysics : num(env.PHYSICS), // 新世界用哪一纪的物理；只在创建新世界时生效
    map: env.MAP || DEFAULT_MAP, // 新世界用哪张地图（src/map/）；只在创建新世界时生效，之后以快照为准
    tickMs: num(env.TICK_MS, demo ? 3000 : 300000),
    ticksPerDay: num(env.TICKS_PER_DAY, 12),
    daysPerMonth: num(env.DAYS_PER_MONTH, 24),
    monthsPerEpoch: num(env.MONTHS_PER_EPOCH, 30),
    dataDir: env.DATA_DIR || './data',
    allowLocalModels: env.ALLOW_LOCAL_MODELS === '1',
    adminKey: env.ADMIN_KEY || null,
    inviteCode: env.INVITE_CODE || null,
    weatherMode: env.WEATHER_MODE || 'vote',
    privateDelayTicks: num(env.PRIVATE_DELAY_TICKS, 288),
    sandboxAgents: num(env.SANDBOX_AGENTS, demo ? 16 : 0),
    blocklistFile: env.MODERATION_WORDS_FILE || null,
    // 第二纪（SPEC-E2 §3）
    foundersFile: env.FOUNDERS_FILE || null, // 先民文件（附录 D），只在创建第二纪的新世界时读取
    shellsFile: env.SHELLS_FILE || null, // 躯壳配置文件（§13.1）；没有它时躯壳居民不会被驱动
    shellTokensPerDay: num(env.SHELL_TOKENS_PER_DAY, null), // 覆盖每地球日的预算；缺省取 SHELLS_FILE，再缺省 50000000
    shellTz: env.SHELL_TZ || null, // 地球日的时区；缺省取 SHELLS_FILE，再缺省 Asia/Shanghai
    demo,
    reset,
  };
  for (const k of ['port', 'tickMs', 'ticksPerDay', 'daysPerMonth', 'monthsPerEpoch', 'privateDelayTicks', 'sandboxAgents']) {
    if (!Number.isInteger(cfg[k]) || cfg[k] < 0) throw new Error(`配置 ${k} 必须是非负整数`);
  }
  if (cfg.tickMs < 1 || cfg.ticksPerDay < 1 || cfg.daysPerMonth < 1 || cfg.monthsPerEpoch < 1) throw new Error('时间参数必须 ≥ 1');
  if (!MAP_IDS.includes(cfg.map)) throw new Error(`MAP 必须是 ${MAP_IDS.join(' / ')} 之一`);
  if (cfg.physics !== null && cfg.physics !== 1 && cfg.physics !== 2) throw new Error('PHYSICS 必须是 1 或 2');
  if (cfg.physics === 2 && cfg.map !== 'frontier') throw new Error('PHYSICS=2 只支持 MAP=frontier（第二纪没有经典地图）');
  if (cfg.shellTokensPerDay !== null && (!Number.isInteger(cfg.shellTokensPerDay) || cfg.shellTokensPerDay < 1)) throw new Error('SHELL_TOKENS_PER_DAY 必须是正整数');
  return cfg;
}

/**
 * 把配置里属于「确定性环境」的部分应用到两代引擎的 params 与天象模式（SPEC-E2 §3：时间参数同时应用到两个引擎的参数对象），
 * 并载入屏蔽词表。同一个进程只运行一座城，但打开的世界是哪一纪要读了快照才知道，所以两边都设。
 */
export function applyConfig(cfg) {
  const time = {
    tickMs: cfg.tickMs,
    ticksPerDay: cfg.ticksPerDay,
    daysPerMonth: cfg.daysPerMonth,
    monthsPerEpoch: cfg.monthsPerEpoch,
    privateDelayTicks: cfg.privateDelayTicks,
  };
  let weather;
  if (cfg.weatherMode.startsWith('schedule:')) {
    const file = cfg.weatherMode.slice('schedule:'.length);
    weather = { mode: 'schedule', schedule: JSON.parse(readFileSync(file, 'utf8')) };
  } else {
    weather = { mode: cfg.weatherMode, schedule: [] };
  }
  for (const engine of Object.values(ENGINES)) {
    engine.configure(time);
    engine.configureWeather(weather);
  }
  if (cfg.blocklistFile) setBlocklist(readFileSync(cfg.blocklistFile, 'utf8').split('\n'));
}

/** 创建新世界时的随机种子（只在服务器入口使用，不在引擎里） */
export const randomSeed = () => randomBytes(8).toString('hex');
