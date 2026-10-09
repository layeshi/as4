import { filterValues } from '../../collections.js';
import { buildUpgrade } from './upgrades.js';
import { K } from './tokens.js';
import { rewardProject } from './prayer-rewards.js';
// SPEC-E2 §10.5：工程——开辟新地点（site）、加装模块（module）、修路（road）。
//
// 发起（initiate）建一个工程：池子（have）从 0 开始，居民出工（contribute）或公库出资（规则的 fund）往里投能量，
// 凑够造价（need）立即建成；一个月（projectDays）内没有建成则烂尾，已投入的不退还（去处 project_abandoned）。
// 建成时池子里的能量记去处 project_built（能量变成了建筑本身）。
//
// 工程的形状（SPEC-E2 §4.4）：
//   { id, build: 'site' | 'module' | 'road', place（发起与出工的地点）, lot?, on?, module?, inscription?, to?, name?, description?,
//     owner, need, have, contributors, initiator, createdDay, expiresDay, status: 'open' | 'built' | 'abandoned', result }

import { P, MODULE_DEFS } from '../params.js';
import { nextId, clockDay, isAlive, tokenized } from '../world.js';
import { LOT_DEFS } from '../map/index.js';
import { sink } from './ledger.js';
import { emit, pushInbox } from './core.js';
import { hooks } from './hooks.js';
import { STEPS } from './tick.js';
import { placeNameTaken } from './places.js';
import { nameKey } from '../../text.js';

// ── 查询 ───────────────────────────────────────────────────

/** 某地点进行中的工程 */
export function openProjectsAt(w, placeId) {
  return filterValues(w.projects, (j) => j.status === 'open' && j.place === placeId);
}

/** 两地之间是否已有道路或进行中的道路工程（不分方向） */
export function roadOrProjectBetween(w, a, b) {
  for (const r of Object.values(w.roads)) if ((r.a === a && r.b === b) || (r.a === b && r.b === a)) return true;
  for (const j of Object.values(w.projects)) {
    if (j.build !== 'road' || j.status !== 'open') continue;
    if ((j.place === a && j.to === b) || (j.place === b && j.to === a)) return true;
  }
  return false;
}

/** 开辟的造价：荒野 siteCostWild，城内 siteCostCity */
export const siteCost = (wild) => (wild ? P.siteCostWild : P.siteCostCity);

/** 所有者是否仍然有效（居民在世、社群未解散）；无效则改归全城 */
export function validOwner(w, owner) {
  if (owner.kind === 'agent') {
    const a = w.agents[owner.id];
    return a && isAlive(a) ? owner : { kind: 'city' };
  }
  if (owner.kind === 'group') {
    const g = w.groups[owner.id];
    return g && !g.dissolved ? owner : { kind: 'city' };
  }
  return owner;
}

/** 工程的出资者（居民；公库 'treasury' 没有收件箱）收到结果 */
function notifyContributors(w, j, result) {
  for (const key of Object.keys(j.contributors)) {
    if (key === 'treasury') continue;
    const a = w.agents[key];
    if (a && isAlive(a)) pushInbox(w, a, 'project', { projectId: j.id, result });
  }
}

/** 工程在事件里的显示名：开辟与修路有名字，加装模块用模块的种类 */
const projectLabel = (j) => j.name ?? j.module ?? j.build;
/** 事件里的种类（与第一纪的 type 字段对应，观测站的模板用它）：site | road | 模块的种类 */
const projectKind = (j) => (j.build === 'module' ? j.module : j.build);

// ── 建成 ───────────────────────────────────────────────────

/** 进行中的开辟工程已经占用的名字（发起时检查，避免两项工程取同一个名字） */
export function pendingSiteNames(w) {
  return filterValues(w.projects, (j) => j.status === 'open' && j.build === 'site').map((j) => nameKey(j.name));
}

/**
 * 建成时名字仍须唯一：发起之后可能有法律给别的地点改了同名（规则的 rename）。万一撞名，加数字后缀（「名字 2」「名字 3」……），
 * 不让已经出了力的工程因此建不成。
 * TODO(spec): Q19 —— 规格没有说发起之后名字被占用怎么办
 */
function uniqueName(w, name, exceptId = null) {
  if (!placeNameTaken(w, name, exceptId)) return name;
  for (let k = 2; ; k++) {
    const candidate = `${name} ${k}`;
    if (!placeNameTaken(w, candidate, exceptId)) return candidate;
  }
}

/** 新地点的记录（开辟与遗址上重新开辟共用的初始状态，SPEC-E2 §10.5） */
function siteFields(w, j, exceptId = null) {
  const salvage = Math.floor(j.need / 2);
  return {
    name: uniqueName(w, j.name, exceptId),
    description: j.description ?? null,
    origin: 'agent',
    open: false,
    explorable: false,
    landmark: null,
    condition: 10000,
    decayPerDay: P.siteDecay,
    wallSlots: P.siteWalls,
    modules: [],
    salvage,
    salvageMax: salvage,
    owner: validOwner(w, j.owner),
    rules: null,
    ruined: false,
    razed: false,
    founder: j.initiator,
    foundedDay: clockDay(w),
    renamedBy: null,
    history: [],
  };
}

function buildSite(w, j) {
  const day = clockDay(w);
  if (j.lot) {
    const lot = LOT_DEFS[j.lot];
    const id = nextId(w, 'n');
    const wild = lot.district === 'wilds';
    const fields = siteFields(w, j);
    w.places[id] = {
      id,
      humanName: null,
      district: lot.district,
      xy: lot.xy.slice(),
      wild,
      ...fields,
      incarnations: [{ name: fields.name, origin: 'agent', founder: j.initiator, fromDay: day, toDay: null }],
      activity: { utterances: 0, visits: 0, lastActiveDay: null, repairs: 0, salvaged: 0 },
    };
    for (const near of lot.near) w.paths.push({ a: id, b: near, cost: wild ? P.pathCostWild : P.pathCostCity, day, projectId: j.id });
    w.lots[j.lot] = { place: id, project: null };
    w.dayLog.founded.push({ founder: j.initiator, place: id, name: fields.name, district: lot.district });
    return id;
  }
  // 在遗址上重新开辟：复用遗址的 ID 与连接，把它改回建筑
  const p = w.places[j.on];
  Object.assign(p, siteFields(w, j, p.id));
  p.incarnations.push({ name: p.name, origin: 'agent', founder: j.initiator, fromDay: day, toDay: null });
  w.dayLog.founded.push({ founder: j.initiator, place: p.id, name: p.name, district: p.district });
  return p.id;
}

function buildModule(w, j) {
  const place = w.places[j.place];
  place.modules.push({
    type: j.module,
    salvage: Math.floor(MODULE_DEFS[j.module].cost * K(w) / 2),
    builtDay: clockDay(w),
    projectId: j.id,
    inherent: false,
    contributors: { ...j.contributors },
    ...(j.inscription ? { inscription: j.inscription } : {}),
  });
  w.dayLog.modulesAdded.push({ place: place.id, module: j.module });
  return place.id;
}

function buildRoad(w, j) {
  const id = nextId(w, 'f');
  w.roads[id] = {
    id,
    a: j.place,
    b: j.to,
    name: j.name ?? null,
    condition: 10000,
    decayPerDay: P.roadDecay,
    ruined: false,
    builtDay: clockDay(w),
    projectId: j.id,
    contributors: { ...j.contributors },
  };
  return id;
}

/** 池中能量达到造价时立即建成：池中能量记入去处 project_built，按种类建出结果，释放空地块，记事件 built（触发 on:built） */
export function buildProject(w, j) {
  j.status = 'built';
  sink(w, 'energy', 'project_built', j.have);
  const result = tokenized(w) && j.build === 'upgrade' ? buildUpgrade(w, j) : j.build === 'site' ? buildSite(w, j) : j.build === 'module' ? buildModule(w, j) : buildRoad(w, j);
  j.result = result;
  rewardProject(w, j);
  const where = j.build === 'site' ? result : j.place;
  const k = Object.keys(j.contributors).length;
  w.dayLog.built.push({ projectId: j.id, build: j.build, module: j.module ?? null, place: where, name: projectLabel(j), k });
  emit(w, 'built', {
    place: where,
    data: { projectId: j.id, build: j.build, type: projectKind(j), result, name: projectLabel(j), contributors: k, ...(j.module ? { module: j.module } : {}) },
  });
  notifyContributors(w, j, 'built');
  hooks.fire(w, 'built', { place: where, build: j.build });
  return result;
}

/**
 * 向进行中的工程投入 amount 能量（来自居民的出工或公库的 fund；调用者已经从出资者那里扣下）。
 * who：出资者的 ID，或 'treasury'。凑够造价即建成。返回 { built, result }。
 */
export function addToProject(w, j, who, amount) {
  j.have += amount;
  j.contributors[who] = (j.contributors[who] || 0) + amount;
  if (j.have >= j.need) return { built: true, result: buildProject(w, j) };
  return { built: false, result: null };
}

// ── 烂尾 ───────────────────────────────────────────────────

/** 工程烂尾：池中能量记去处 project_abandoned，释放空地块，记事件 abandoned（触发 on:abandoned） */
export function abandonProject(w, j, reason = 'expired') {
  j.status = 'abandoned';
  sink(w, 'energy', 'project_abandoned', j.have);
  if (j.lot && w.lots[j.lot] && w.lots[j.lot].project === j.id) w.lots[j.lot].project = null;
  w.dayLog.abandoned.push({ projectId: j.id, name: projectLabel(j), place: j.place });
  emit(w, 'abandoned', {
    place: j.place,
    data: { projectId: j.id, build: j.build, type: projectKind(j), name: projectLabel(j), have: j.have, need: j.need, reason },
  });
  notifyContributors(w, j, 'abandoned');
  hooks.fire(w, 'abandoned', { place: j.place, build: j.build });
}

/** 每日结算第 8 步：到期仍未建成的工程烂尾（d 为刚结束的那一日） */
export function abandonExpired(w, d) {
  for (const j of Object.values(w.projects)) {
    if (j.status === 'open' && d >= j.expiresDay) abandonProject(w, j, 'expired');
  }
}

STEPS.abandonProjects = abandonExpired;
