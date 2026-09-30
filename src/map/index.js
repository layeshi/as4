// 地图的注册与查询。引擎、感知、可见性、沙盘脑都通过这里取「这个世界有哪些地点」，不再写死地点 ID。
//
// 世界状态里的 w.map 记着它用哪张地图；没有这个字段的世界（M1 以来的所有旧快照）是经典地图。
// 经典世界的状态与行为必须逐位不变：荒野仍是 w.wilds，储量参数取自 P；边疆世界的各荒野地带在 w.regions。

import { P } from '../params.js';
import classic from './classic.js';
import frontier from './frontier.js';

function freezeDeep(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) freezeDeep(v);
  }
  return x;
}

/** 预先算好查询用的索引：byId、placeIds、wildIds、邻接表 */
function compile(def) {
  const byId = {};
  for (const p of def.places) byId[p.id] = p;
  const placeIds = def.places.map((p) => p.id);
  const wildIds = def.places.filter((p) => p.wild).map((p) => p.id);
  const edges = def.streets.map(([a, b, cost = 1]) => ({ a, b, cost }));
  const adj = {};
  for (const id of placeIds) adj[id] = [];
  for (const e of edges) {
    adj[e.a].push({ to: e.b, cost: e.cost });
    adj[e.b].push({ to: e.a, cost: e.cost });
  }
  return freezeDeep({ ...def, byId, placeIds, wildIds, edges, adj });
}

export const MAPS = Object.freeze({ classic: compile(classic), frontier: compile(frontier) });
export const MAP_IDS = Object.freeze(Object.keys(MAPS));
/** 新世界默认用的地图（MAP 环境变量缺省时） */
export const DEFAULT_MAP = 'frontier';

export function getMap(id = 'classic') {
  const m = Object.prototype.hasOwnProperty.call(MAPS, id) ? MAPS[id] : null;
  if (!m) throw new Error(`unknown map: ${id}`);
  return m;
}

/** 世界所用的地图 */
export const mapOf = (w) => getMap(w.map || 'classic');

/** 世界的地点 ID，按地图定义的顺序（感知、公开数据里的顺序） */
export const placeIdsOf = (w) => mapOf(w).placeIds;

/** 是否是这个世界的地点（防原型链上的键） */
export const hasPlace = (w, id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(w.places, id);

/** 是否是城外的荒野地带（可以探索；被放逐者只能待在这里） */
export function isWild(w, id) {
  const d = mapOf(w).byId[id];
  return !!(d && d.wild);
}

export const wildIdsOf = (w) => mapOf(w).wildIds;

/** 地点所在的街区代码（经典地图没有街区，为 null） */
export function districtOf(w, id) {
  const d = mapOf(w).byId[id];
  return (d && d.district) || null;
}

/** 移动是否按路程计价 */
export const usesDistance = (w) => mapOf(w).distance;

/**
 * 荒野地带的储量参数 { energyMax, regen, coins, relics }。
 * 经典地图的荒野取 P（可被 configure 覆盖），relics 为 null（全部 16 件）；其余取地图定义。
 */
export function wildSpec(w, id) {
  const d = mapOf(w).byId[id];
  if (!d || !d.wild) return null;
  if (d.wild === true) return { energyMax: P.wildsEnergyMax, regen: P.wildsRegenPerDay, coins: P.wildsCoins, relics: null };
  return d.wild;
}

/** 荒野地带的储量状态 { energy, coins, relicOrder, relicsFound }：经典世界是 w.wilds，边疆世界是 w.regions[id] */
export function wildPool(w, id) {
  if (w.regions) return Object.prototype.hasOwnProperty.call(w.regions, id) ? w.regions[id] : null;
  return id === 'wilds' ? w.wilds : null;
}

/**
 * 从 from 出发到各地点的最小代价（整数代价的 Dijkstra；地点不多，O(n²) 足够）。
 * extra：额外的边 [{ a, b, cost }]，例如正常运转的道路（代价 0）；
 * only：只经过、只到达满足它的地点（被放逐者只在荒野里走）。
 * 返回 { [placeId]: cost }，到不了的地点没有键。
 */
export function shortestCosts(map, from, { extra = [], only = null } = {}) {
  const dist = { [from]: 0 };
  const done = new Set();
  for (;;) {
    let u = null;
    for (const id of map.placeIds) {
      if (done.has(id) || dist[id] === undefined) continue;
      if (u === null || dist[id] < dist[u]) u = id;
    }
    if (u === null) break;
    done.add(u);
    const out = map.adj[u].slice();
    for (const e of extra) {
      if (e.a === u) out.push({ to: e.b, cost: e.cost });
      else if (e.b === u) out.push({ to: e.a, cost: e.cost });
    }
    for (const { to, cost } of out) {
      if (only && !only(to)) continue;
      const nd = dist[u] + cost;
      if (dist[to] === undefined || nd < dist[to]) dist[to] = nd;
    }
  }
  return dist;
}

/**
 * GET /api/public/map：地图的静态数据（给观测站画图）。不含任何世界状态，更不含种子。
 * 荒野地带附上储量上限与每日再生（经典地图取当前的 P）。
 */
export function publicMap(w) {
  const m = mapOf(w);
  return {
    id: m.id,
    size: m.size.slice(),
    distance: m.distance,
    districts: m.districts.slice(),
    places: m.places.map((p) => {
      const spec = p.wild ? wildSpec(w, p.id) : null;
      return {
        id: p.id, kind: p.kind, district: p.district || null, xy: p.xy.slice(), glyph: p.glyph,
        wild: spec ? { energyMax: spec.energyMax, regen: spec.regen } : null,
      };
    }),
    streets: m.edges.map((e) => ({ a: e.a, b: e.b, cost: e.cost })),
    legacy: m.legacy.slice(),
    terrain: JSON.parse(JSON.stringify(m.terrain)),
  };
}
