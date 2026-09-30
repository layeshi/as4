// 各动作处理函数共用的辅助：代价计算、上下文、引用校验、公开发言的公共部分。
//
// 每个动作处理函数遵循同一个纪律：先校验一切（抛 ActError），再调用 ctx.pay() 扣代价，再修改世界。
// 这样「失败的动作不扣能量」（PROTOCOL §2.2）是结构性保证，而不是靠每个处理函数自觉。

import { LIMITS } from '../../params.js';
import { hasPlace } from '../../map/index.js';
import { findAgent, isAlive } from '../../world.js';
import { detectScript } from '../../text.js';
import { sink } from '../ledger.js';
import { fail, needId, needText } from '../core.js';
import { placeCost, hasRelay, isWeatherActive } from '../environment.js';
import { noteWordUse } from '../society.js';

/**
 * 实际代价 = 先套天象与驿站的修正得到「有效基础代价」，再按地点倍率一次性 ceil（PROTOCOL §4.2）：
 *   雾：whisper、broadcast ×2，除非全城有一座正常运转的驿站；
 *   驿站：broadcast 的基础代价按 3 计；蚀时仍可宣告，代价 ×2；
 *   议会、市场、图书馆、墓园：ceil(基础代价 × (20000 − 完好度) / 10000)。
 */
export function actionCost(w, type, base, placeId) {
  let b = base;
  const relay = hasRelay(w);
  if (type === 'broadcast') {
    if (relay) b = 3;
    if (isWeatherActive(w, 'fog') && !relay) b *= 2;
    if (isWeatherActive(w, 'eclipse') && relay) b *= 2;
  } else if (type === 'whisper') {
    if (isWeatherActive(w, 'fog') && !relay) b *= 2;
  }
  return placeCost(w, placeId, b);
}

export function makeCtx(w, a, index, type) {
  const ctx = {
    w,
    a,
    index,
    type,
    spent: 0, // 本动作扣掉的能量（结果里的 cost）
    /**
     * 扣代价：先检查余额（含 extra：托管、赠出等另付的部分），再扣。
     * as：按另一种动作的规则计价（出示家书 loud 时按 broadcast）。
     */
    pay(base, { extraEnergy = 0, extraCoins = 0, as = type, place = a.place } = {}) {
      const cost = actionCost(w, as, base, place);
      if (a.energy < cost + extraEnergy) fail('insufficient_energy');
      if (a.coins < extraCoins) fail('insufficient_coins');
      if (cost > 0) {
        a.energy -= cost;
        sink(w, 'energy', 'action_cost', cost);
        w.dayLog.actionCost += cost;
      }
      ctx.spent += cost;
      return cost;
    },
    /** 把直接投入环境的能量（修缮、出工）计入本动作的 cost；它们不是「动作代价」，不进 action_cost */
    invested(n) {
      ctx.spent += n;
    },
  };
  return ctx;
}

/** 这个世界的地点 ID（各张地图的地点不同） */
export function needPlace(w, v) {
  if (!hasPlace(w, v)) fail('invalid_args');
  return v;
}

/** 引用 agent：ID 或精确的名字。mode：living（在世）| any（含死者、归隐者） */
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

/** 名字类文本（agent、灵魂、社群、设施……）：1–24 字符，不含换行 */
export function needName(v) {
  const t = needText(v, { max: LIMITS.name });
  if (t.includes('\n')) fail('invalid_args');
  return t;
}
