import { prayersEnabled, recordNaturalDamage, consumeNaturalRepair } from './prayer-rewards.js';
// SPEC-E2 §6、§10.3：环境——完好度、修缮、衰败与受损、源井产出、汲取、荒野。
// （工程、模块的加装、拆解与遗址见 projects.js、dismantle.js。）

import { P, SEASON_TABLE, WEATHER_DEFS, MODULE_DEFS } from '../params.js';
import { emit } from './core.js';
import { hooks } from './hooks.js';

// ── 天象与源井 ──────────────────────────────────────────────

export function isWeatherActive(w, code) {
  return w.weather.active.some((x) => x.type === code);
}

/** 当日生效的天象对源井的系数（千分比）。旱 600、丰 1400，同时生效则连乘 */
export function weatherFactor(w) {
  let f = 1000;
  for (const x of w.weather.active) {
    const wf = WEATHER_DEFS[x.type].factor;
    if (wf) f = Math.floor((f * wf) / 1000);
  }
  return f;
}

/** 源井系数（千分比）：完好度 / 10，但不低于 20% */
export function wellFactor(w) {
  return Math.max(Math.floor(w.places.well.condition / 10), P.wellFloorPermille);
}

/** 源井在第 d 日（dayOfMonth 按 d 计）的产出：基础产出 × 完好度（下限 20%）× 季节 × 天象 */
export function wellOutput(w, d) {
  const seasonF = SEASON_TABLE[d % P.daysPerMonth];
  return Math.floor((P.wellBaseOutput * wellFactor(w) * seasonF * weatherFactor(w)) / 1e9);
}

// ── 修缮（SPEC-M1 §7.4，第二纪不变） ─────────────────────────

/**
 * 修缮算法：完好度 < 1000 时每 1 能量恢复 5 基点，否则每 1 能量恢复 10 基点；
 * 越过 1000 时分段计算，修满 10000 后多余的能量不扣。返回 { cond, spent }。
 */
export function repairCalc(cond, energy) {
  let spent = 0;
  while (spent < energy && cond < 10000) {
    const rate = cond < P.repairLowBp ? P.repairRateLow : P.repairRateNormal;
    const target = cond < P.repairLowBp ? P.repairLowBp : 10000;
    const need = Math.ceil((target - cond) / rate);
    const use = Math.min(need, energy - spent);
    cond = Math.min(target, cond + use * rate);
    spent += use;
  }
  return { cond, spent };
}

/** 完好度降到 0：标记废墟、记事件 ruin、触发 on:ruin。kind：'place' | 'road' */
function markRuin(w, obj, target, place) {
  obj.ruined = true;
  emit(w, 'ruin', { place, data: { target } });
  w.dayLog.ruins.push({ target, place });
  hooks.fire(w, 'ruin', { place: target });
}

/**
 * 对一个地点或道路施加修缮。obj 为 Place 或 Road；target 为它的 ID；place 为它所在的地点。
 * 完好度从低于 1000 回到 ≥ 1000 且 ruined 为真时，ruined = false，记事件 restored。
 * 返回 { from, to, spent }；不做账（由调用者扣能量、记去处 repair）。
 */
export function applyRepair(w, obj, target, place, energy) {
  const from = obj.condition;
  const { cond, spent } = repairCalc(from, energy);
  obj.condition = cond;
  if (obj.ruined && cond >= P.repairLowBp) {
    obj.ruined = false;
    emit(w, 'restored', { place, data: { target } });
    w.dayLog.restored.push({ target, place });
  }
  const eligible = consumeNaturalRepair(w, target, cond - from);
  return { from, to: cond, spent, ...(prayersEnabled(w) ? { eligible } : {}) };
}

/** 受损（汲取、震）：完好度减去 bp，不低于 0；降到 0 时标记废墟。返回实际减少的基点 */
export function applyDamage(w, obj, target, place, bp, cause = 'resident') {
  const before = obj.condition;
  obj.condition = Math.max(0, before - bp);
  if (cause === 'natural') recordNaturalDamage(w, target, before - obj.condition);
  if (before > 0 && obj.condition === 0) markRuin(w, obj, target, place);
  return before - obj.condition;
}

/** 一个地点每日的衰败：基础衰败 + 后人加装的模块各自多衰败的（人类建筑原有的模块不另加） */
export function decayOfPlace(place) {
  let d = place.decayPerDay;
  for (const m of place.modules) if (!m.inherent) d += MODULE_DEFS[m.type].decay;
  return d;
}

/** 每日衰败（结算第 7 步）：每个有完好度的地点（open 为假）与每条道路减去自己的衰败，不低于 0；降到 0 时标记废墟 */
export function decayAll(w) {
  for (const p of Object.values(w.places)) {
    if (p.open || p.condition === null) continue;
    applyDamage(w, p, p.id, p.id, decayOfPlace(p), 'natural');
  }
  for (const r of Object.values(w.roads)) applyDamage(w, r, r.id, r.a, r.decayPerDay, 'natural');
}

/** 汲取：每汲取 1 能量，源井完好度下降 drawDamageBp 基点 */
export function damageWellByDraw(w, amount) {
  return applyDamage(w, w.places.well, 'well', 'well', P.drawDamageBp * amount);
}
