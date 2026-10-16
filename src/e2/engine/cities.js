// 第七前提「三城」（docs/plans/2026-10-16-three-cities.md §7、ADR-0022）：按城挂载的世界上下文。
//
// 第二纪的引擎把「一座城」的状态直接挂在世界对象上（w.treasury、w.laws、w.procedure……），用在几百处。三城世界里这些字段每城一份，
// 存在 w.cities[城] 里；世界顶层的同名字段平时放的是「城外」的上下文：没有法律、没有公库、没有源井，有荒野自己的天象与当日日志。
// withCity(w, 城, fn) 把那座城的字段挂到顶层，fn 执行完写回、恢复原样；可以嵌套，也可以挂 null（城外）。
// 当前挂着哪座城记在不可枚举的 w.$city 上；挂城期间城外的字段暂存在不可枚举的 w.$outside 上。两者都不进快照与状态哈希。
// premise ≤ 6 的世界没有 w.cities：withCity 直接执行 fn，一切与原来逐字节相同。
//
// 约束：挂城只在一条命令的同步执行之内；命令结束时一定已经全部恢复（try/finally）。挂城期间不要把顶层字段的引用留到挂城之外再用。

import { mapFor } from '../map/index.js';

export const CITY_IDS = Object.freeze(['north', 'west', 'east']);

/** 每城一份、挂到世界顶层的字段 */
export const CITY_KEYS = Object.freeze([
  'cityName', 'charter', 'charterCanonical', 'treasury', 'well', 'laws', 'proposals', 'procedure', 'revertWatch',
  'refounds', 'refoundCooldownUntil', 'vars', 'petitions', 'weather', 'chronicle', 'dayLog', 'lawSeq', 'materialPolicy',
]);

/** 一座城（或城外）上下文的初始字段。dayLog 由调用者给（newDayLog 在 world.js，避免循环引用） */
export function blankCityState({ cityName = null, treasury = null, well = null, dayLog }) {
  return {
    cityName,
    charter: [],
    charterCanonical: null,
    treasury,
    well,
    laws: {},
    proposals: {},
    procedure: { ordinary: null, constitutional: null },
    revertWatch: { ordinary: 0, constitutional: 0 },
    refounds: {},
    refoundCooldownUntil: null,
    vars: {},
    petitions: [],
    weather: { scheduled: null, active: [], history: [] },
    chronicle: [],
    dayLog,
    lawSeq: 0,
    materialPolicy: null,
  };
}

export const multiCity = (w) => w.premise === 7;
export const isCityId = (id) => CITY_IDS.includes(id);

/** 当前挂着的城：'north' | 'west' | 'east'；城外与非三城世界为 null */
export const currentCity = (w) => (multiCity(w) ? (w.$city ?? null) : null);

function hidden(w, key, value) {
  if (Object.prototype.hasOwnProperty.call(w, key)) w[key] = value;
  else Object.defineProperty(w, key, { value, writable: true, enumerable: false, configurable: true });
}

const readTop = (w) => Object.fromEntries(CITY_KEYS.map((k) => [k, w[k]]));
function writeTop(w, vals) {
  for (const k of CITY_KEYS) w[k] = vals[k];
}
/** 把一组字段存回某个上下文的存处：城 → w.cities[城]；城外 → w.$outside */
function put(w, id, vals) {
  if (id === null) hidden(w, '$outside', vals);
  else Object.assign(w.cities[id], vals);
}
const get = (w, id) => (id === null ? w.$outside : w.cities[id]);

/**
 * 在城 id 的上下文里执行 fn（id 为 null 表示城外）。返回 fn 的返回值。
 * 非三城世界、或 id 为 undefined 时直接执行 fn。
 */
export function withCity(w, id, fn) {
  if (!multiCity(w) || id === undefined) return fn();
  if (id !== null && !isCityId(id)) throw new Error(`withCity: unknown city ${id}`);
  const prev = w.$city ?? null;
  if (prev === id) return fn();
  put(w, prev, readTop(w));
  writeTop(w, get(w, id));
  hidden(w, '$city', id);
  try {
    return fn();
  } finally {
    put(w, id, readTop(w));
    writeTop(w, get(w, prev));
    hidden(w, '$city', prev);
    if (prev === null) w.$outside = undefined;
  }
}

/** 依次在每座城的上下文里执行 fn(cityId)，返回 { [cityId]: 结果 } */
export function eachCity(w, fn) {
  const out = {};
  for (const id of CITY_IDS) out[id] = withCity(w, id, () => fn(id));
  return out;
}

/** 读某座城的一个字段（不必挂城）：正挂着的城读顶层，其余读存处 */
export function cityValue(w, id, key) {
  if (!multiCity(w)) return w[key];
  if ((w.$city ?? null) === id) return w[key];
  return id === null ? (w.$outside ? w.$outside[key] : undefined) : w.cities[id][key];
}

// ── 地界 ────────────────────────────────────────────────────

/** 地点所在的城：三城世界里是地点的 city 字段（荒野与后人开辟在荒野的地点为 null）；非三城世界恒为 null */
export function cityOfPlace(w, placeId) {
  if (!multiCity(w)) return null;
  const p = w.places[placeId];
  return p ? (p.city ?? null) : null;
}

/** 某座城的地图定义（名字、港口、源井、议会、广场、放逐去处、源井份额） */
export function cityDef(w, id) {
  const c = (mapFor(w).cities || []).find((x) => x.id === id);
  if (!c) throw new Error(`cityDef: unknown city ${id}`);
  return c;
}

/** 在当前上下文里执行动作或规则时的「这座城」：挂着的城；非三城世界为 undefined（表示不分城） */
export const jurisdiction = (w) => (multiCity(w) ? currentCity(w) : undefined);

/** 居民所在之处的城（荒野为 null） */
export const locatedCity = (w, a) => cityOfPlace(w, a.place);

/** 在居民所在之处的城的上下文里执行 fn */
export const atAgent = (w, a, fn) => withCity(w, multiCity(w) ? locatedCity(w, a) : undefined, fn);

/** 在居民的籍城的上下文里执行 fn */
export const atDomicile = (w, a, fn) => withCity(w, multiCity(w) ? a.city : undefined, fn);

// ── 归城所有 ────────────────────────────────────────────────

/** 「归城所有」的主人：三城世界里是地点所在的城（荒野里为 id null，即无主）；其余前提是 { kind: 'city' } */
export const cityOwnerAt = (w, placeId) => (multiCity(w) ? { kind: 'city', id: cityOfPlace(w, placeId) } : { kind: 'city' });

/** 「归城所有」的主人：当前挂着的城（城外为 id null） */
export const cityOwnerHere = (w) => (multiCity(w) ? { kind: 'city', id: currentCity(w) } : { kind: 'city' });

/**
 * 某个「归城」的去处落在哪座城：给定的城 → 当前挂着的城 → 北城。只用于三城世界里没有明确归属、又必须有个公库收下的余额
 * （例如在荒野里解散的社群的公库、找不到受益者的退款），这种情形很少见。
 */
export const fallbackCity = (w, ...prefer) => prefer.find((c) => isCityId(c)) ?? currentCity(w) ?? CITY_IDS[0];
