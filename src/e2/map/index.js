import { orderedDistances } from '../../graph-distance.js';
// SPEC-E2 §10.2、附录 B：第二纪的地图。
//
// 静态部分（附录 B）：人类地点的坐标与 glyph、街道、空地块、地形。
// 动态部分（世界状态）：w.places、w.paths（开辟新地点时连上的小路）、w.roads（道路）、w.lots。
// 移动的图：街道 + 小路 + 正常运转的道路（代价 0）。节点是 w.places 的全部 ID——遗址仍是节点，与它相连的街道、小路照旧。

import { K } from '../engine/tokens.js';
import { P } from '../params.js';
import MAP from './frontier-e2.js';

export { MAP };
export const MAP_ID = MAP.id;

/** 人类地点的 ID，按地图的顺序 */
export const HUMAN_PLACE_IDS = Object.freeze(MAP.places.map((p) => p.id));
export const HUMAN_DEFS = Object.freeze(Object.fromEntries(MAP.places.map((p) => [p.id, p])));
export const LOT_DEFS = Object.freeze(Object.fromEntries(MAP.lots.map((l) => [l.id, l])));
export const LOT_IDS = Object.freeze(MAP.lots.map((l) => l.id));
/** 荒野五地带的 ID（人类的、可以探索的） */
export const WILD_ZONE_IDS = Object.freeze(MAP.places.filter((p) => p.wild).map((p) => p.id));

/** 一条道路是否正常运转：完好度达到运转下限 */
export const roadFunctioning = (road) => road.condition >= P.functioningBp;

/** 地点的邻接：街道、小路（代价各异）与正常运转的道路（代价 0）。返回 Map<id, [{to, cost}]> */
function adjacency(w) {
  const adj = new Map();
  for (const id of Object.keys(w.places)) adj.set(id, []);
  const add = (a, b, cost) => {
    if (!adj.has(a) || !adj.has(b)) return;
    adj.get(a).push({ to: b, cost });
    adj.get(b).push({ to: a, cost });
  };
  for (const [a, b, cost = 1] of MAP.streets) add(a, b, cost);
  for (const p of w.paths) add(p.a, p.b, p.cost);
  for (const r of Object.values(w.roads)) if (roadFunctioning(r)) add(r.a, r.b, 0);
  return adj;
}

/**
 * 从 from 出发到各地点的最小代价（整数代价的 Dijkstra；地点不多，O(n²) 足够）。
 * 返回 { [placeId]: cost }，到不了的地点没有键。
 */
export function travelCosts(w, from) {
  const adj = adjacency(w);
  return orderedDistances(Object.keys(w.places), from, id => adj.get(id));
}

/** 与一个地点有街道或小路（不含道路）直接相连的地点——遗址上重新开辟时「相邻」的含义 */
export function streetNeighbors(w, id) {
  const out = new Set();
  for (const [a, b] of MAP.streets) {
    if (a === id) out.add(b);
    else if (b === id) out.add(a);
  }
  for (const p of w.paths) {
    if (p.a === id) out.add(p.b);
    else if (p.b === id) out.add(p.a);
  }
  return [...out].filter((x) => w.places[x]);
}

/** 空地块的状态：{ id, ..., place, project }（w.lots 里记着占用） */
export const lotOf = (w, id) => (Object.prototype.hasOwnProperty.call(w.lots, id) ? w.lots[id] : null);

/** 与某地点相邻的空地块 ID，按附录 B.2 的顺序 */
export const lotsNear = (w, placeId) => MAP.lots.filter((l) => l.near.includes(placeId)).map((l) => l.id);

/**
 * GET /api/public/map：地图的静态数据（给观测站画图）。不含任何世界状态，更不含种子。
 * 当前的地点与小路在 state 里。
 */
export function publicMap(w = {}) {
  return {
    id: MAP.id,
    size: MAP.size.slice(),
    distance: true,
    districts: MAP.districts.slice(),
    places: MAP.places.map((p) => ({
      id: p.id, district: p.district, xy: p.xy.slice(), glyph: p.glyph, landmark: p.landmark, open: p.open,
      wild: p.wild ? { energyMax: p.wild.energyMax * K(w), regen: p.wild.regen * K(w) } : null,
    })),
    streets: MAP.streets.map(([a, b, cost = 1]) => ({ a, b, cost })),
    lots: MAP.lots.map((l) => ({ id: l.id, district: l.district, xy: l.xy.slice(), near: l.near.slice(), wild: l.district === 'wilds' })),
    legacy: MAP.legacy.slice(),
    terrain: JSON.parse(JSON.stringify(MAP.terrain)),
  };
}
