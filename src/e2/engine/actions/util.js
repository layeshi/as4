// 各动作处理函数共用的辅助：代价计算、上下文、引用校验、公开发言的公共部分。
//
// 第二纪的每个动作处理函数拆成两步（SPEC-E2 §7.6）：
//   validate(ctx, args) → plan   只读：做全部物理校验，失败抛 ActError（不扣能量）；plan 里有代价、托管的数额等
//   apply(ctx, plan)    → data   修改世界：框架已扣过动作代价、收费也已确认付得起
// 这样「失败的动作不扣能量」（PROTOCOL-2 §2.2）与「费用的原子性」是结构性保证，而不是靠每个处理函数自觉。

import { K } from '../tokens.js';
import { TEXT_ONLY_P4 } from '../../lore/actions.js';
import { LIMITS } from '../../params.js';
import { findAgent, isAlive, tokenized } from '../../world.js';
import { detectScript } from '../../../text.js';
import { fail, needId, needText } from '../core.js';
import { hasRelay, scaledCost } from '../places.js';
import { isWeatherActive } from '../environment.js';
import { noteWordUse } from '../society.js';

/**
 * 实际代价 = 先套天象与中继的修正得到「有效基础代价」，再（对使用模块的动作）按所在地点的完好度倍率一次性 ceil：
 *   雾：whisper、broadcast ×2，除非全城有一个正常运转的中继；
 *   中继：broadcast 的基础代价按 3 计；蚀时仍可宣告，代价 ×2；
 *   使用模块的动作（写作、阅读典籍、公开交易、写墓志）：ceil(基础代价 × (20000 − 所在地点的完好度) / 10000)。
 * 其余动作（含 move 与 inscribe）不受倍率影响。
 */
export function actionCost(w, type, base, placeId, { usesModule = false } = {}) {
  let b = base;
  if (type === 'broadcast') {
    const relay = hasRelay(w); // 只有这两种动作受中继影响：别的动作不必扫描全城的模块（感知里每种动作都要算一遍代价）
    if (relay) b = 3;
    if (isWeatherActive(w, 'fog') && !relay) b *= 2;
    if (isWeatherActive(w, 'eclipse') && relay) b *= 2;
  } else if (type === 'whisper') {
    if (isWeatherActive(w, 'fog') && !hasRelay(w)) b *= 2;
  }
  return usesModule ? scaledCost(w, placeId, b) : b;
}

export const cost4 = (w, type, base, place, opts) => TEXT_ONLY_P4.has(type) ? 0 : actionCost(w, type, base, place, opts) * K(w);

export function makeCtx(w, a, index, type, lang = 'zh') {
  const ctx = {
    w,
    a,
    index,
    type,
    lang, // 请求的语言（zh | en）：draft 的说明、read { law } 的读法按它取
    spent: 0, // 本动作花掉的能量（结果里的 cost）：动作代价 + 投入的能量 + 规则收的费
    fees: [], // 规则收的费（框架填写）：[{ law, to, energy, coins }]
    /** 一次动作的代价（validate 里用）。as：按另一种动作的规则计价；usesModule：使用模块的动作，适用完好度倍率 */
    cost(base, { as = type, place = a.place, usesModule = false } = {}) {
      return tokenized(w) ? cost4(w, as, base, place, { usesModule }) : actionCost(w, as, base, place, { usesModule });
    },
    /** 把直接投入环境的能量（修缮、出工、出资）计入本动作的 cost；它们不是「动作代价」，不进 action_cost */
    invested(n) {
      ctx.spent += n;
    },
  };
  return ctx;
}

/** 引用一个地点：必须是这个世界现有的地点 ID */
export function needPlace(w, v) {
  if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(w.places, v)) fail('invalid_args');
  return v;
}

/** 引用居民：ID 或精确的名字。mode：living（在世）| any（含死者、归隐者） */
export function needAgent(w, v, mode = 'living') {
  needId(v);
  const t = findAgent(w, v);
  if (!t) fail('not_found');
  if (mode === 'living' && !isAlive(t)) fail('not_found');
  return t;
}

/** 记录一条公开发言（say / broadcast）：文字系统、统计、词典计数、近 12 刻的发言簿 */
export function recordUtterance(ctx, text, { remember = true } = {}) {
  const { w, a } = ctx;
  const script = detectScript(text);
  if (script) {
    a.script = script;
    w.dayLog.scripts[script] = (w.dayLog.scripts[script] || 0) + 1;
  }
  a.stats.utterances++;
  w.places[a.place].activity.utterances++;
  w.dayLog.utterances.push({ from: a.id, place: a.place, text, script });
  noteWordUse(w, a, text);
  if (remember) w.recentSpeech.push({ tick: w.clock.tick, place: a.place, from: a.id, text });
  return script;
}

/** 名字类文本（居民、灵魂、社群、地点……）：1–24 字符，不含换行 */
export function needName(v) {
  const t = needText(v, { max: LIMITS.name });
  if (t.includes('\n')) fail('invalid_args');
  return t;
}
