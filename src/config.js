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
    resourceCpu: num(env.RESOURCE_CPU_LIMIT, null),
    resourceMemoryMb: num(env.RESOURCE_MEMORY_MB, null),
    computeWorkers: num(env.COMPUTE_WORKERS, null),
    computeCacheMb: num(env.COMPUTE_CACHE_MB, null),
    computeQueueLimit: num(env.COMPUTE_QUEUE_LIMIT, 256),
    worldExecution: env.WORLD_EXECUTION_MODE || 'auto',
    port: num(env.PORT, 8787),
    host: env.HOST || '127.0.0.1',
    worldId: env.WORLD_ID || 'baihua',
    seed: env.SEED || null, // 只在创建新世界时生效；未设置则在创建时随机生成
    physics: env.PHYSICS === undefined || env.PHYSICS === '' ? defaultPhysics : num(env.PHYSICS), // 新世界用哪一纪的物理；只在创建新世界时生效
    map: env.MAP || (Number(env.PREMISE) === 7 ? 'island-three-v1' : [5, 6].includes(Number(env.PREMISE)) ? 'compact-materials-v1' : DEFAULT_MAP), // 新世界用哪张地图（src/map/）；只在创建新世界时生效，之后以快照为准
    tickMs: num(env.TICK_MS, demo ? 3000 : 300000),
    ticksPerDay: num(env.TICKS_PER_DAY, 12),
    daysPerMonth: num(env.DAYS_PER_MONTH, 24),
    monthsPerEpoch: num(env.MONTHS_PER_EPOCH, 30),
    dataDir: env.DATA_DIR || './data',
    allowLocalModels: env.ALLOW_LOCAL_MODELS === '1',
    adminKey: env.ADMIN_KEY || null,
    loginCaptcha: env.LOGIN_CAPTCHA || null,
    altchaMaxCounter: num(env.ALTCHA_MAX_COUNTER, 2000),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
    turnstileSecretKey: env.TURNSTILE_SECRET_KEY || null,
    aliyunAccessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID || null,
    aliyunAccessKeySecret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || null,
    aliyunMailFrom: env.ALIYUN_MAIL_FROM || null,
    aliyunMailRegion: env.ALIYUN_MAIL_REGION || 'cn-hangzhou',
    aliyunSmsSign: env.ALIYUN_SMS_SIGN || null,
    smsDailyLimit: num(env.SMS_DAILY_LIMIT, 100),
    registrationOpen: env.REGISTRATION_OPEN !== '0',
    wechatNotificationTemplates: env.WECHAT_NOTIFICATION_TEMPLATES || null,
    wechatAppId: env.WECHAT_APPID || null,
    wechatAppSecret: env.WECHAT_APP_SECRET || null,
    wechatWebLogin: env.WECHAT_WEB_LOGIN !== '0',
    wechatQrEnvironment: env.WECHAT_QR_ENVIRONMENT || 'release',
    wechatMiniprogramAppId: env.WECHAT_MINIPROGRAM_APPID || null,
    wechatMiniprogramAppSecret: env.WECHAT_MINIPROGRAM_APP_SECRET || null,
    inviteCode: env.INVITE_CODE || null,
    weatherMode: [6, 7].includes(Number(env.PREMISE)) ? 'random' : env.WEATHER_MODE || 'vote',
    privateDelayTicks: num(env.PRIVATE_DELAY_TICKS, 288),
    sandboxAgents: num(env.SANDBOX_AGENTS, demo ? 16 : 0),
    blocklistFile: env.MODERATION_WORDS_FILE || null,
    // 第二纪（SPEC-E2 §3）
    foundersFile: env.FOUNDERS_FILE || null, // 先民文件（附录 D），只在创建第二纪的新世界时读取
    shellsFile: env.SHELLS_FILE || null, // 躯壳配置文件（§13.1）；没有它时躯壳居民不会被驱动
    premise: num(env.PREMISE, null),
    // 保留原始输入；只有创建 P4 新世界时才解析和校验，已有快照忽略这些环境变量。
    tokenCapacity: env.TOKEN_CAPACITY || 1100000,
    hiddenPhysicsFile: env.HIDDEN_PHYSICS_FILE || null,
    tokenBasic: env.TOKEN_BASIC || 18000,
    shellSlots: num(env.SHELL_SLOTS, null), // 躯壳名额；缺省取 P.shellSlots（30）。只在创建第二纪的新世界时生效，之后记在世界里（Q26）
    shellTokensPerDay: num(env.SHELL_TOKENS_PER_DAY, null), // 覆盖每地球日的预算；缺省取 SHELLS_FILE，再缺省 50000000
    shellTz: env.SHELL_TZ || null, // 地球日的时区；缺省取 SHELLS_FILE，再缺省 Asia/Shanghai
    demo,
    reset,
  };
  for (const k of ['port', 'tickMs', 'ticksPerDay', 'daysPerMonth', 'monthsPerEpoch', 'privateDelayTicks', 'sandboxAgents']) {
    if (!Number.isInteger(cfg[k]) || cfg[k] < 0) throw new Error(`配置 ${k} 必须是非负整数`);
  }
  if (cfg.tickMs < 1 || cfg.ticksPerDay < 1 || cfg.daysPerMonth < 1 || cfg.monthsPerEpoch < 1) throw new Error('时间参数必须 ≥ 1');
  if (!MAP_IDS.includes(cfg.map) && cfg.map !== 'compact-materials-v1' && cfg.map !== 'island-three-v1') throw new Error(`MAP 必须是 ${MAP_IDS.join(' / ')} 之一`);
  if (cfg.physics !== null && cfg.physics !== 1 && cfg.physics !== 2) throw new Error('PHYSICS 必须是 1 或 2');
  if (cfg.premise !== null && cfg.premise !== 0 && cfg.premise !== 1 && cfg.premise !== 2 && cfg.premise !== 4 && cfg.premise !== 5 && cfg.premise !== 6 && cfg.premise !== 7) throw new Error('PREMISE 只能是 0、1、2、4、5、6 或 7');
  if (cfg.premise !== null && cfg.premise >= 1 && cfg.physics !== 2) throw new Error('PREMISE=1、2、4、5、6 或 7 只用于第二纪（PHYSICS=2）');
  if (cfg.physics === 2 && cfg.map !== (cfg.premise === 7 ? 'island-three-v1' : (cfg.premise === 5 || cfg.premise === 6) ? 'compact-materials-v1' : 'frontier')) throw new Error('PHYSICS=2 的地图须与前提相符：PREMISE=7 用 island-three-v1，5、6 用 compact-materials-v1，其余用 frontier');
  if (cfg.shellTokensPerDay !== null && (!Number.isInteger(cfg.shellTokensPerDay) || cfg.shellTokensPerDay < 1)) throw new Error('SHELL_TOKENS_PER_DAY 必须是正整数');
  if (cfg.shellSlots !== null && (!Number.isInteger(cfg.shellSlots) || cfg.shellSlots < 0)) throw new Error('SHELL_SLOTS 必须是非负整数');
  if (!!cfg.turnstileSiteKey !== !!cfg.turnstileSecretKey) throw new Error('TURNSTILE_SITE_KEY 与 TURNSTILE_SECRET_KEY 必须同时设置');
  if (cfg.loginCaptcha !== null && !['altcha', 'turnstile', 'none'].includes(cfg.loginCaptcha)) throw new Error('LOGIN_CAPTCHA 必须是 altcha、turnstile 或 none');
  if (cfg.loginCaptcha === 'turnstile' && !cfg.turnstileSecretKey) throw new Error('LOGIN_CAPTCHA=turnstile 必须配置 Turnstile 密钥');
  if (!Number.isInteger(cfg.altchaMaxCounter) || cfg.altchaMaxCounter < 500 || cfg.altchaMaxCounter > 20000) throw new Error('ALTCHA_MAX_COUNTER 必须是 500–20000 的整数');
  if (!Number.isInteger(cfg.smsDailyLimit) || cfg.smsDailyLimit < 1) throw new Error('SMS_DAILY_LIMIT 必须是正整数');
  if (!['auto', 'worker', 'inline'].includes(cfg.worldExecution)) throw new Error('WORLD_EXECUTION_MODE must be auto, worker or inline');
  for (const key of ['resourceCpu', 'resourceMemoryMb', 'computeWorkers', 'computeCacheMb', 'computeQueueLimit']) {
    if (cfg[key] !== null && (!Number.isFinite(cfg[key]) || cfg[key] < (key === 'computeCacheMb' ? 0 : key === 'resourceCpu' ? 0.01 : 1) || (key !== 'resourceCpu' && !Number.isSafeInteger(cfg[key])))) throw new Error(`Invalid compute configuration: ${key}`);
  }
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
