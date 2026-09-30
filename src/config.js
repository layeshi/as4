// SPEC-M1 §4：环境变量与命令行参数。

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { configure, configureWeather } from './params.js';
import { setBlocklist } from './moderation.js';

const num = (v, d) => {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`环境变量的值不是数字：${v}`);
  return n;
};

/**
 * 解析配置。env 默认取 process.env，argv 默认取 process.argv.slice(2)。
 * --demo 等价于 TICK_MS=3000、SANDBOX_AGENTS=16；--reset 删除当前 WORLD_ID 的数据后重建。
 */
export function loadConfig(env = process.env, argv = process.argv.slice(2)) {
  const demo = argv.includes('--demo');
  const reset = argv.includes('--reset');
  const cfg = {
    port: num(env.PORT, 8787),
    host: env.HOST || '127.0.0.1',
    worldId: env.WORLD_ID || 'baihua',
    seed: env.SEED || null, // 只在创建新世界时生效；未设置则在创建时随机生成
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
    demo,
    reset,
  };
  for (const k of ['port', 'tickMs', 'ticksPerDay', 'daysPerMonth', 'monthsPerEpoch', 'privateDelayTicks', 'sandboxAgents']) {
    if (!Number.isInteger(cfg[k]) || cfg[k] < 0) throw new Error(`配置 ${k} 必须是非负整数`);
  }
  if (cfg.tickMs < 1 || cfg.ticksPerDay < 1 || cfg.daysPerMonth < 1 || cfg.monthsPerEpoch < 1) throw new Error('时间参数必须 ≥ 1');
  return cfg;
}

/** 把配置里属于「确定性环境」的部分应用到 params 与天象模式，并载入屏蔽词表 */
export function applyConfig(cfg) {
  configure({
    tickMs: cfg.tickMs,
    ticksPerDay: cfg.ticksPerDay,
    daysPerMonth: cfg.daysPerMonth,
    monthsPerEpoch: cfg.monthsPerEpoch,
    privateDelayTicks: cfg.privateDelayTicks,
  });
  if (cfg.weatherMode.startsWith('schedule:')) {
    const file = cfg.weatherMode.slice('schedule:'.length);
    configureWeather({ mode: 'schedule', schedule: JSON.parse(readFileSync(file, 'utf8')) });
  } else {
    configureWeather({ mode: cfg.weatherMode, schedule: [] });
  }
  if (cfg.blocklistFile) setBlocklist(readFileSync(cfg.blocklistFile, 'utf8').split('\n'));
}

/** 创建新世界时的随机种子（只在服务器入口使用，不在引擎里） */
export const randomSeed = () => randomBytes(8).toString('hex');
