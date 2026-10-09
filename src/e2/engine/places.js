import { filterValues } from '../../collections.js';
import { ep } from './tokens.js';
// SPEC-E2 §4.3、§10.1–§10.4：地点与模块的查询——模块是否运转、代价倍率、初始能量系数、储能的腐坏上限。
//
// 一座建筑能做什么，只取决于里面装了什么模块（DESIGN §6.3）。模块「运转」的条件：所在地点不是遗址，
// 且完好度 ≥ 该模块的运转下限（SPEC-E2 §5.3）；空地（广场、荒野地带、遗址）不能装模块。

import { P, MODULE_DEFS } from '../params.js';
import { nameKey } from '../../text.js';

/** 地点上装着的某种模块（不论是否运转），没有返回 null */
export const moduleOf = (place, type) => place.modules.find((m) => m.type === type) || null;

/** 模块是否运转 */
export function isFunctioning(place, mod) {
  if (!place || place.razed || place.open || place.condition === null) return false;
  return place.condition >= MODULE_DEFS[mod.type].needBp;
}

/** 地点上运转中的某种模块，没有返回 null */
export function functioningModule(place, type) {
  const m = moduleOf(place, type);
  return m && isFunctioning(place, m) ? m : null;
}

/** 某个地点有没有运转中的某种模块 */
export function hasModuleAt(w, placeId, type) {
  const p = w.places[placeId];
  return !!p && functioningModule(p, type) !== null;
}

/** 全城有没有运转中的某种模块（中继是全城生效的） */
export function hasModuleAnywhere(w, type) {
  for (const p of Object.values(w.places)) if (functioningModule(p, type)) return true;
  return false;
}

export const hasRelay = (w) => hasModuleAnywhere(w, 'relay');

/** 墙上当前可见的铭刻：未被覆盖、未被遮盖、未随地点消失（lost），按刻写先后 */
export function wallInscriptions(w, placeId) {
  return filterValues(w.inscriptions, (i) => i.place === placeId && !i.coveredBy && !i.redacted && !i.lost);
}

// ── 代价与系数 ─────────────────────────────────────────────

/**
 * 「代价倍率」的分子（万分之一）：20000 − 完好度，完好时 ×1（10000），废墟时 ×2（20000）。
 * 只对使用模块的动作生效（写作、阅读典籍、公开交易、写墓志），见 actionCost；没有完好度的地点为 10000。
 */
export function costMultiplierBp(place) {
  return place.condition === null ? 10000 : 20000 - place.condition;
}

/** 在某地使用模块的、基础代价为 base 的动作的实际代价：ceil(base × (20000 − 完好度) / 10000) */
export function scaledCost(w, placeId, base) {
  if (base <= 0) return 0;
  return Math.ceil((base * costMultiplierBp(w.places[placeId])) / 10000);
}

/** 感知里的 costMultiplier（1–2 之间的小数，保留 4 位） */
export const costMultiplier = (w, placeId) => costMultiplierBp(w.places[placeId]) / 10000;

/**
 * 初始能量系数：新移民（含先民）按港口的完好度，新生者按出生地的完好度。
 * floor(基数 × (10000 + 完好度) / 20000)，完好时 100%，废墟时 50%。
 */
export function endowedEnergy(w, placeId, base) {
  const p = w.places[placeId];
  const cond = p && p.condition !== null ? p.condition : 10000;
  return Math.floor((base * (10000 + cond)) / 20000);
}

// ── 储能（腐坏上限） ─────────────────────────────────────────

/** 某主人名下运转中的储能模块数（未封顶）。ownerKind 'city' 时不看 ownerId */
export function storeCount(w, ownerKind, ownerId) {
  let n = 0;
  for (const p of Object.values(w.places)) {
    if (p.owner.kind !== ownerKind) continue;
    if (ownerKind !== 'city' && p.owner.id !== ownerId) continue;
    if (functioningModule(p, 'store')) n++;
  }
  return n;
}

/** 储能给主人增加的腐坏上限：reservoirCapacity × min(3, 数量) */
export function reservoirBonus(w, ownerKind, ownerId) {
  return ep(w, 'reservoirCapacity') * Math.min(P.reservoirMaxPerOwner, storeCount(w, ownerKind, ownerId));
}

// ── 所有权 ─────────────────────────────────────────────────

/** 地点的主人对居民、社群、城的统一视图 */
export function ownerView(w, o) {
  if (o.kind === 'city') return { kind: 'city' };
  if (o.kind === 'group') return { kind: 'group', id: o.id, name: w.groups[o.id] ? w.groups[o.id].name : o.id };
  return { kind: 'agent', id: o.id, name: w.agents[o.id] ? w.agents[o.id].name : o.id };
}

/** 居民 a 是否是这个地点的主人（居民所有；社群所有时是该社群的管事） */
export function isOwnerOrSteward(w, place, a) {
  if (place.owner.kind === 'agent') return place.owner.id === a.id;
  if (place.owner.kind === 'group') {
    const g = w.groups[place.owner.id];
    return !!g && !g.dissolved && g.steward === a.id;
  }
  return false;
}

// ── 地点的名字 ──────────────────────────────────────────────

/**
 * 新名字是否与其他地点当前的名字重复（遗址不占用拆毁前的名字）。人类建筑没改过名时，中英文的人类名字都算占用。
 * exceptId：被改名的地点自己，不与自己比较。
 */
export function placeNameTaken(w, name, exceptId = null) {
  const key = nameKey(name);
  for (const p of Object.values(w.places)) {
    if (p.id === exceptId || p.razed) continue; // 遗址不占用拆毁前的名字（SPEC-E2 §10.7）
    if (nameKey(p.name) === key) return true;
    if (p.humanName && !p.renamedBy && (nameKey(p.humanName.zh) === key || nameKey(p.humanName.en) === key)) return true;
  }
  return false;
}
