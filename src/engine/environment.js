// SPEC-M1 §7.4–§7.9 中与环境有关的规则：完好度、设施的「正常运转」、代价倍率、初始能量系数、
// 源井产出、蓄能池的腐坏上限。（修缮、衰败、工程、汲取、铭刻、荒野见本文件后半部分。）

import { P, FACILITY_DEFS, SEASON_TABLE, WEATHER_DEFS } from '../params.js';
import { nextId, clockDay } from '../world.js';
import { sink } from './ledger.js';
import { emit, pushInbox } from './core.js';

// ── 设施与天象的查询 ────────────────────────────────────────

/** 设施是否「正常运转」：完好度达到该类设施的运转下限（纪念碑只要 > 0） */
export function isFunctioning(f) {
  return f.condition >= FACILITY_DEFS[f.type].needBp;
}

export function facilitiesAt(w, placeId) {
  return Object.values(w.facilities).filter((f) => f.place === placeId);
}

/** 全城有没有一座正常运转的驿站 */
export function hasRelay(w) {
  for (const f of Object.values(w.facilities)) if (f.type === 'relay' && isFunctioning(f)) return true;
  return false;
}

/** 两地之间已建成的道路（不分方向），没有返回 null */
export function roadBetween(w, a, b) {
  for (const f of Object.values(w.facilities)) {
    if (f.type !== 'road') continue;
    if ((f.place === a && f.to === b) || (f.place === b && f.to === a)) return f;
  }
  return null;
}

/** 两地之间往来是否免费：有一条正常运转的道路 */
export function roadFree(w, a, b) {
  const r = roadBetween(w, a, b);
  return !!r && isFunctioning(r);
}

/** 观星台是否在此地且正常运转 */
export function hasObservatoryAt(w, placeId) {
  return facilitiesAt(w, placeId).some((f) => f.type === 'observatory' && isFunctioning(f));
}

export function isWeatherActive(w, code) {
  return w.weather.active.some((x) => x.type === code);
}

// ── 代价与系数 ─────────────────────────────────────────────

/**
 * 「代价倍率」的分子（万分之一）：kind = cost 的地点（议会、市场、图书馆、墓园）为 20000 − 完好度，
 * 完好时 ×1（10000），废墟时 ×2（20000）；其他地点恒为 10000。
 */
export function costMultiplierBp(w, placeId) {
  const p = w.places[placeId];
  if (p.kind !== 'cost') return 10000;
  return 20000 - p.condition;
}

/** 在某地执行的、基础代价为 base 的动作的实际代价：ceil(base × (20000 − 完好度) / 10000) */
export function placeCost(w, placeId, base) {
  if (base <= 0) return 0;
  return Math.ceil((base * costMultiplierBp(w, placeId)) / 10000);
}

/** 感知里的 costMultiplier（1–2 之间的小数，保留 4 位） */
export function costMultiplier(w, placeId) {
  return costMultiplierBp(w, placeId) / 10000;
}

/**
 * 初始能量系数（kind = endow）：港口影响新移民、学堂影响新生儿。
 * floor(基数 × (5000 + 完好度 / 2) / 10000) = floor(基数 × (10000 + 完好度) / 20000)，完好时 100%，废墟时 50%。
 */
export function endowedEnergy(w, placeId, base) {
  return Math.floor((base * (10000 + w.places[placeId].condition)) / 20000);
}

// ── 源井 ───────────────────────────────────────────────────

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

/** §7.2：源井在第 d 日（dayOfMonth 按 d 计）的产出 */
export function wellOutput(w, d) {
  const seasonF = SEASON_TABLE[d % P.daysPerMonth];
  return Math.floor((P.wellBaseOutput * wellFactor(w) * seasonF * weatherFactor(w)) / 1e9);
}

// ── 蓄能池 ─────────────────────────────────────────────────

/** 某所有者名下正常运转的蓄能池数量（未封顶） */
export function reservoirCount(w, ownerKind, ownerId) {
  let n = 0;
  for (const f of Object.values(w.facilities)) {
    if (f.type !== 'reservoir' || !isFunctioning(f)) continue;
    if (f.owner.kind !== ownerKind) continue;
    if (ownerKind !== 'city' && f.owner.id !== ownerId) continue;
    n++;
  }
  return n;
}

/** 蓄能池给所有者增加的腐坏上限：200 × min(3, 数量) */
export function reservoirBonus(w, ownerKind, ownerId) {
  return P.reservoirCapacity * Math.min(P.reservoirMaxPerOwner, reservoirCount(w, ownerKind, ownerId));
}

// ── 所有权 ─────────────────────────────────────────────────

/**
 * 蓄能池的所有者死亡、归隐，或所属社群解散后，该蓄能池改归全城所有（记事件 facility_owner）；
 * 以该所有者名义进行中的工程也一并改归全城（否则建成时会落到一个不存在的所有者名下）。
 */
export function orphanFacilities(w, ownerKind, ownerId) {
  for (const f of Object.values(w.facilities)) {
    if (f.owner.kind === ownerKind && f.owner.id === ownerId) {
      f.owner = { kind: 'city' };
      emit(w, 'facility_owner', { place: f.place, data: { facilityId: f.id, from: { kind: ownerKind, id: ownerId }, to: { kind: 'city' } } });
    }
  }
  for (const j of Object.values(w.projects)) {
    if (j.status === 'open' && j.owner.kind === ownerKind && j.owner.id === ownerId) j.owner = { kind: 'city' };
  }
}

// ═══════════════════════════════════════════════════════════════
// 以下为改变世界的部分：修缮、衰败与受损、工程与设施、荒野
// ═══════════════════════════════════════════════════════════════

// ── 修缮（§7.4） ────────────────────────────────────────────

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

/** 完好度降到 0：标记废墟并记事件 ruin */
function markRuin(w, obj, target, place) {
  obj.ruined = true;
  emit(w, 'ruin', { place, data: { target } });
  w.dayLog.ruins.push({ target, place });
}

/**
 * 对一个地点或设施施加修缮。obj 为 Place 或 Facility；target 为它的 ID；place 为它所在的地点。
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
  return { from, to: cond, spent };
}

/** 受损（汲取、震）：完好度减去 bp，不低于 0；降到 0 时标记废墟 */
export function applyDamage(w, obj, target, place, bp) {
  const before = obj.condition;
  obj.condition = Math.max(0, before - bp);
  if (before > 0 && obj.condition === 0) markRuin(w, obj, target, place);
  return before - obj.condition;
}

// ── 每日衰败（§8.2 第 8 步） ──────────────────────────────────

/** 每个有完好度的地点与设施减去其 decayPerDay，不低于 0；降到 0 时标记废墟 */
export function decayAll(w) {
  for (const p of Object.values(w.places)) {
    if (p.condition === null) continue;
    applyDamage(w, p, p.id, p.id, p.decayPerDay);
  }
  for (const f of Object.values(w.facilities)) applyDamage(w, f, f.id, f.place, f.decayPerDay);
}

// ── 工程与设施（§7.6） ────────────────────────────────────────

/** 工程的出资者（agent 或 treasury）的收件对象 */
function notifyContributors(w, j, result) {
  for (const key of Object.keys(j.contributors)) {
    if (key === 'treasury') continue;
    const a = w.agents[key];
    if (a && (a.status === 'awake' || a.status === 'dormant')) pushInbox(w, a, 'project', { projectId: j.id, result });
  }
}

/** 所有者是否仍然有效（agent 在世、社群未解散）；无效则改归全城 */
function validOwner(w, owner) {
  if (owner.kind === 'agent') {
    const a = w.agents[owner.id];
    return a && (a.status === 'awake' || a.status === 'dormant') ? owner : { kind: 'city' };
  }
  if (owner.kind === 'group') {
    const g = w.groups[owner.id];
    return g && !g.dissolved ? owner : { kind: 'city' };
  }
  return owner;
}

/** 池中能量达到造价时立即建成：池中能量记入去处 project_built，生成设施，完好度 10000 */
function buildProject(w, j) {
  j.status = 'built';
  sink(w, 'energy', 'project_built', j.have);
  const def = FACILITY_DEFS[j.type];
  const id = nextId(w, 'f');
  const f = {
    id,
    type: j.type,
    name: j.name,
    place: j.place,
    to: j.to,
    owner: validOwner(w, j.owner),
    condition: 10000,
    decayPerDay: def.decay,
    inscription: j.inscription,
    builtDay: clockDay(w),
    projectId: j.id,
    contributors: { ...j.contributors },
    ruined: false,
  };
  w.facilities[id] = f;
  const k = Object.keys(j.contributors).length;
  w.dayLog.built.push({ facilityId: id, type: j.type, name: j.name, place: j.place, k });
  emit(w, 'built', { place: j.place, data: { projectId: j.id, facilityId: id, type: j.type, name: j.name, contributors: k } });
  notifyContributors(w, j, 'built');
  return f;
}

/**
 * 向进行中的工程投入 amount 能量（来自 agent 的出工或公库的 fund）。
 * key 为出资者：agent ID 或 "treasury"。调用者负责已从出资者账上扣除。
 * 返回 { built, facility }。
 */
export function addToProject(w, j, key, amount) {
  j.have += amount;
  j.contributors[key] = (j.contributors[key] || 0) + amount;
  if (j.have >= j.need) return { built: true, facility: buildProject(w, j) };
  return { built: false, facility: null };
}

/** 每日结算第 9 步：到期仍未建成的工程烂尾，池中能量记入去处 project_abandoned */
export function abandonExpired(w, d) {
  for (const j of Object.values(w.projects)) {
    if (j.status !== 'open' || d < j.expiresDay) continue;
    j.status = 'abandoned';
    sink(w, 'energy', 'project_abandoned', j.have);
    w.dayLog.abandoned.push({ projectId: j.id, name: j.name, place: j.place });
    emit(w, 'abandoned', { place: j.place, data: { projectId: j.id, name: j.name, type: j.type, have: j.have, need: j.need } });
    notifyContributors(w, j, 'abandoned');
  }
}

/** 某地点进行中的工程 */
export function openProjectsAt(w, placeId) {
  return Object.values(w.projects).filter((j) => j.status === 'open' && j.place === placeId);
}

/** 两地之间是否已有道路或进行中的道路工程（不分方向） */
export function roadOrProjectBetween(w, a, b) {
  if (roadBetween(w, a, b)) return true;
  for (const j of Object.values(w.projects)) {
    if (j.type !== 'road' || j.status !== 'open') continue;
    if ((j.place === a && j.to === b) || (j.place === b && j.to === a)) return true;
  }
  return false;
}

// ── 铭刻（§7.7） ────────────────────────────────────────────

/** 一处地点的墙上当前可见的铭刻（未被覆盖、未被遮盖），按刻写先后 */
export function wallInscriptions(w, placeId) {
  return Object.values(w.inscriptions).filter((i) => i.place === placeId && !i.coveredBy && !i.redacted);
}

/** 汲取：每汲取 1 能量，源井完好度下降 drawDamageBp 基点 */
export function damageWellByDraw(w, amount) {
  return applyDamage(w, w.places.well, 'well', 'well', P.drawDamageBp * amount);
}

