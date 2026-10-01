// SPEC-E2 §13.1：躯壳配置文件 SHELLS_FILE。
//
//   { "tokensPerDay": 50000000, "timezone": "Asia/Shanghai", "reserve": 0.05, "concurrency": 4, "historyRounds": 2,
//     "lines": [ { "model", "provider", "baseURL", "apiKeyEnv", "extraBody", "maxTokens", "timeoutMs" }, … ] }
//
// 密钥只从 apiKeyEnv 指定的环境变量读取，不出现在配置文件、日志与任何接口里。
// 环境变量 SHELL_TOKENS_PER_DAY、SHELL_TZ 可以覆盖文件里的 tokensPerDay 与 timezone。

import { readFileSync } from 'node:fs';

export const DEFAULTS = Object.freeze({ tokensPerDay: 50000000, timezone: 'Asia/Shanghai', reserve: 0.05, concurrency: 4, historyRounds: 2, maxTokens: 1200, timeoutMs: 120000 });

const LINE_KEYS = new Set(['model', 'provider', 'baseURL', 'apiKeyEnv', 'extraBody', 'maxTokens', 'timeoutMs', 'effort', 'fallbacks', 'seed', 'chatty']);
const PROVIDERS = ['openai', 'anthropic', 'mock'];

const int = (v, d, min, max, where) => {
  if (v === undefined) return d;
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${where} 必须是 ${min}–${max} 的整数。`);
  return v;
};

/** 时区名是否有效（Intl 在运行时可用，SPEC-E2 §13.3） */
export function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析并校验配置对象。overrides：{ tokensPerDay?, timezone? }（来自环境变量）。
 * 返回 { tokensPerDay, timezone, reserve, concurrency, historyRounds, lines: [{ model, provider, baseURL?, apiKeyEnv?, extraBody?, maxTokens, timeoutMs, … }] }；
 * 有问题时抛出带说明的 Error。
 */
export function parseShellsConfig(raw, overrides = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('躯壳配置必须是一个 JSON 对象。');
  const tokensPerDay = overrides.tokensPerDay ?? int(raw.tokensPerDay, DEFAULTS.tokensPerDay, 1, Number.MAX_SAFE_INTEGER, 'tokensPerDay');
  const timezone = overrides.timezone ?? raw.timezone ?? DEFAULTS.timezone;
  if (typeof timezone !== 'string' || !validTimeZone(timezone)) throw new Error(`timezone 不是有效的时区名：${timezone}`);
  const reserve = raw.reserve === undefined ? DEFAULTS.reserve : raw.reserve;
  if (typeof reserve !== 'number' || !(reserve >= 0 && reserve < 1)) throw new Error('reserve 必须是 0 到 1 之间的数（不含 1）。');
  const concurrency = int(raw.concurrency, DEFAULTS.concurrency, 1, 64, 'concurrency');
  const historyRounds = int(raw.historyRounds, DEFAULTS.historyRounds, 0, 20, 'historyRounds');
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) throw new Error('lines 必须是非空数组。');
  const seen = new Set();
  const lines = raw.lines.map((l, i) => {
    const where = `lines[${i}]`;
    if (!l || typeof l !== 'object' || Array.isArray(l)) throw new Error(`${where} 必须是对象。`);
    for (const k of Object.keys(l)) if (!LINE_KEYS.has(k)) throw new Error(`${where}.${k} 不是认得的字段（可用：${[...LINE_KEYS].join('、')}）。`);
    if (typeof l.model !== 'string' || l.model.trim() === '' || /[\r\n]/.test(l.model) || l.model.length > 100) throw new Error(`${where}.model 必须是 1–100 个字符的单行模型名。`);
    if (seen.has(l.model)) throw new Error(`${where}.model 重复：${l.model}`);
    seen.add(l.model);
    if (!PROVIDERS.includes(l.provider)) throw new Error(`${where}.provider 必须是 ${PROVIDERS.join(' / ')} 之一。`);
    if (l.apiKeyEnv !== undefined && (typeof l.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(l.apiKeyEnv))) throw new Error(`${where}.apiKeyEnv 必须是环境变量名。`);
    if (l.baseURL !== undefined && typeof l.baseURL !== 'string') throw new Error(`${where}.baseURL 必须是字符串。`);
    if (l.extraBody !== undefined && (l.extraBody === null || typeof l.extraBody !== 'object' || Array.isArray(l.extraBody))) throw new Error(`${where}.extraBody 必须是一个 JSON 对象。`);
    return { ...l, model: l.model.trim(), maxTokens: int(l.maxTokens, DEFAULTS.maxTokens, 64, 32000, `${where}.maxTokens`), timeoutMs: int(l.timeoutMs, DEFAULTS.timeoutMs, 1000, 120000, `${where}.timeoutMs`) };
  });
  return { tokensPerDay, timezone, reserve, concurrency, historyRounds, lines };
}

/** 读文件并解析；cfg 是服务器配置（带 shellTokensPerDay、shellTz 覆盖） */
export function loadShellsConfig(file, cfg = {}) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`读不了躯壳配置文件 ${file}：${e.message}`);
  }
  return parseShellsConfig(raw, { ...(cfg.shellTokensPerDay ? { tokensPerDay: cfg.shellTokensPerDay } : {}), ...(cfg.shellTz ? { timezone: cfg.shellTz } : {}) });
}
