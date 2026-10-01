// SPEC-E2 §10.8：移动与门。
//
//   move { to }：to 须是地点且不是所在之处；代价 = 最短路（不受倍率影响）；到不了 → invalid_args。
//   目的地有运转中的门时：若目的地的地点规则里有 before:enter，由规则决定（deny → forbidden，fee 照收）；
//   否则按默认：全城所有的地点任何人可以进入；居民所有的只有主人；社群所有的只有成员。不被允许 → gated。
//   目的地为荒野地带（wild 且 open）时：跳过一切 before 规则与门（荒野地带不能装门）。
//   只检查目的地；途经之处不受门与规则影响。被放逐者能去哪里由法律决定（遗法 l5）；物理不限制。

import { travelCosts } from '../map/index.js';
import { hasModuleAt } from './places.js';

/** 移动的基础代价（出发地的倍率不适用于移动）。到不了返回 null */
export function moveBaseCost(w, from, to) {
  const c = travelCosts(w, from)[to];
  return c === undefined ? null : c;
}

/** 目的地是不是荒野地带（wild 且 open）：永远可以进入，规则与门都不管 */
export function isWildOpen(w, placeId) {
  const p = w.places[placeId];
  return !!p && p.wild && p.open;
}

/** 目的地有没有运转中的门 */
export const hasGate = (w, placeId) => hasModuleAt(w, placeId, 'gate');

/** 目的地的地点规则里有没有 before:enter */
export function hasEnterRule(w, placeId) {
  const p = w.places[placeId];
  return !!(p && p.rules && p.rules.rules.some((r) => r.when === 'before:enter'));
}

/** 默认的门规则（目的地有运转中的门、且没有 before:enter 规则时）：居民 a 能否进入 */
export function defaultMayEnter(w, a, placeId) {
  const p = w.places[placeId];
  if (p.owner.kind === 'city') return true;
  if (p.owner.kind === 'agent') return p.owner.id === a.id;
  return a.groups.includes(p.owner.id);
}

/** 感知里 gate.youMayEnter / places[].gated 用：a 现在能不能进入目的地（只看默认规则与门，规则的预求值另算） */
export function gatedFor(w, a, placeId) {
  if (isWildOpen(w, placeId) || !hasGate(w, placeId) || hasEnterRule(w, placeId)) return false;
  return !defaultMayEnter(w, a, placeId);
}
