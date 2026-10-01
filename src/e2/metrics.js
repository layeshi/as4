// SPEC-E2 §20：每日指标与人类遗产存活表（第二纪）。
//
// 每日结算生成一条 DailyMetrics（公共接口可取完整时间序列）和更新后的遗产存活表。
// 另有一个仅管理接口可取的研究指标：按模型家族计算的香农熵（谢幕后公开）。
//
// 每日指标 dailyMetrics 与遗产存活表 computeLegacy 在 engine/records.js（它们要读规则、法律、躯壳，而本文件被它们反过来引用）。

import { agentList, isAlive } from './world.js';

export const round = (x, k = 3) => {
  const m = 10 ** k;
  return Math.round(x * m) / m;
};

const LN2 = 0.6931471805599453;

/**
 * log2(x)（x > 0），只用 + − × ÷：IEEE-754 的基本运算在所有平台上结果相同，而 Math.log2 等超越函数的结果不保证
 * （SPEC-E2 §0.3 第 1 条禁止在引擎里使用）。做法：把 x 归一到 [1, 2)（乘除 2 是精确的），ln(m) = 2·atanh((m−1)/(m+1)) 的级数。
 */
export function log2(x) {
  let e = 0;
  let m = x;
  while (m >= 2) {
    m /= 2;
    e++;
  }
  while (m < 1) {
    m *= 2;
    e--;
  }
  const z = (m - 1) / (m + 1); // ∈ [0, 1/3)
  const z2 = z * z;
  let term = z;
  let sum = 0;
  for (let k = 1; k <= 41; k += 2) {
    sum += term / k;
    term *= z2;
  }
  return e + (2 * sum) / LN2;
}

/** 香农熵（以 2 为底），保留 3 位小数。counts 为非负整数数组 */
export function shannon(counts) {
  const total = counts.reduce((s, x) => s + x, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * log2(p);
  }
  return round(h);
}

/** 基尼系数（保留 3 位小数）。全为 0 或没有样本时为 0 */
export function gini(values) {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  let sum = 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    sum += sorted[i];
    weighted += (i + 1) * sorted[i];
  }
  if (sum === 0) return 0;
  return round((2 * weighted - (n + 1) * sum) / (n * sum));
}

const FAMILIES = ['claude', 'gpt', 'gemini', 'llama', 'qwen', 'mistral', 'deepseek', 'glm', 'kimi', 'gemma', 'phi', 'step', 'sandbox'];

/** 模型名 → 模型家族（粗略的启发式：认得的关键词，否则取第一个字母段） */
export function modelFamily(model) {
  const m = String(model || '').toLowerCase().trim();
  for (const f of FAMILIES) if (m.includes(f)) return f;
  if (/^(o\d|chatgpt)/.test(m)) return 'gpt';
  return m.split(/[-:/_.\d\s]/)[0] || 'unknown';
}

/** 研究指标：按模型家族计算的香农熵（谢幕前仅管理接口可取） */
export function researchMetrics(w) {
  const families = {};
  for (const a of agentList(w)) {
    if (!isAlive(a)) continue;
    const f = modelFamily(a.body.model);
    families[f] = (families[f] || 0) + 1;
  }
  return { livingAgents: Object.values(families).reduce((s, x) => s + x, 0), families, modelFamilyEntropy: shannon(Object.values(families)) };
}
