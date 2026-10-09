import { upgradeCost } from '../upgrades.js';
import { ep, K } from '../tokens.js';
// 城的动作（SPEC-E2 §25 第 6 步）：initiate contribute dismantle。
//
// initiate  发起工程：开辟新地点（site）、加装模块（module）、修路（road）。基础代价 2；同一地点进行中的工程不超过 3 个。
// contribute 出工：投入的能量就是代价；凑够造价即建成；一个月内未建成则烂尾，已投入的不退还。
// dismantle 拆解：回收残料（至多 15），建筑的残料拆尽成为遗址。

import { P, LIMITS, MODULE_DEFS, MODULE_TYPES } from '../../params.js';
import { ACTIONS } from '../../lore/actions.js';
import { LOT_DEFS, streetNeighbors } from '../../map/index.js';
import { clockDay, nextId, tokenized } from '../../world.js';
import { fail, emit, needInt, needId, optText } from '../core.js';
import { placeNameTaken, moduleOf } from '../places.js';
import { noteWordUse } from '../society.js';
import { needPlace, needName } from './util.js';
import { openProjectsAt, roadOrProjectBetween, siteCost, addToProject, pendingSiteNames } from '../projects.js';
import { nameKey } from '../../../text.js';
import { dismantleAt } from '../dismantle.js';

const given = (v) => v !== undefined && v !== null;
const BUILDS = ['site', 'module', 'road'];

/** 加装模块的建筑须完好度 ≥ 10% */
const MIN_CONDITION_BP = 1000;

/** 建筑的所有者能不能在这里加装：全城所有任何人，居民所有只有主人，社群所有只有成员 */
function mayBuildOn(w, a, place) {
  if (place.owner.kind === 'city') return true;
  if (place.owner.kind === 'agent') return place.owner.id === a.id;
  return a.groups.includes(place.owner.id);
}

/** initiate 的 owner 参数：self（缺省）| city | 你担任管事的社群 ID */
function ownerOf(w, a, arg) {
  if (!given(arg) || arg === 'self') return { kind: 'agent', id: a.id };
  if (arg === 'city') return { kind: 'city' };
  if (typeof arg !== 'string') fail('invalid_args');
  const g = Object.prototype.hasOwnProperty.call(w.groups, arg) ? w.groups[arg] : null;
  if (!g || g.dissolved) fail('not_found');
  if (g.steward !== a.id) fail('not_steward');
  return { kind: 'group', id: g.id };
}

// ── initiate ────────────────────────────────────────────────

function planSite(ctx, args) {
  const { w, a } = ctx;
  const hasLot = given(args.lot);
  const hasOn = given(args.on);
  if (hasLot === hasOn) fail('invalid_args', { zh: 'site 要给 lot（空地块）或 on（遗址）之一。', en: 'site takes either lot (a vacant lot) or on (a ruin site).' });
  const name = needName(args.name);
  if (placeNameTaken(w, name) || pendingSiteNames(w).includes(nameKey(name))) fail('name_taken');
  const description = optText(args.description, { max: LIMITS.description });
  const owner = ownerOf(w, a, args.owner);
  let target;
  let wild;
  if (hasLot) {
    needId(args.lot);
    const lot = Object.prototype.hasOwnProperty.call(LOT_DEFS, args.lot) ? LOT_DEFS[args.lot] : null;
    if (!lot) fail('not_found');
    const state = w.lots[args.lot];
    if (state.place !== null || state.project !== null) fail('lot_taken');
    if (!lot.near.includes(a.place)) fail('wrong_place', { zh: '须身在这块空地相邻的地点（见 here.lots）。', en: 'You must stand at a place next to the lot (see here.lots).' });
    target = { lot: args.lot };
    wild = lot.district === 'wilds';
  } else {
    const p = w.places[needPlace(w, args.on)];
    if (!p.razed) fail('invalid_args', { zh: 'on 须是遗址。', en: 'on must be a ruin site.' });
    if (a.place !== p.id && !streetNeighbors(w, p.id).includes(a.place)) fail('wrong_place');
    // 遗址上已经有进行中的开辟工程
    if (Object.values(w.projects).some((j) => j.status === 'open' && j.build === 'site' && j.on === p.id)) fail('lot_taken');
    target = { on: p.id };
    wild = p.wild;
  }
  return { ...target, name, description, owner, need: siteCost(wild) * K(w) };
}

function planModule(ctx, args) {
  const { w, a } = ctx;
  if (typeof args.module !== 'string' || !MODULE_TYPES.includes(args.module)) {
    fail('invalid_args', { zh: `module 须是下列之一：${MODULE_TYPES.join(' ')}。`, en: `module must be one of: ${MODULE_TYPES.join(' ')}.` });
  }
  const place = w.places[a.place];
  let inscription = null;
  if (args.module === 'surface') {
    inscription = optText(args.inscription, { max: LIMITS.inscription });
    if (!inscription) fail('invalid_args', { zh: '碑必须给出 inscription（铭文）。', en: 'A surface needs its inscription.' });
  } else if (given(args.inscription)) {
    fail('invalid_args', { zh: '只有碑有铭文。', en: 'Only a surface carries an inscription.' });
  }
  if (place.open || place.razed || place.condition === null) fail('invalid_args', { zh: '广场、荒野与遗址不能装模块。', en: 'Open ground and ruin sites cannot hold modules.' });
  if (place.condition < MIN_CONDITION_BP) fail('invalid_args', { zh: '建筑的完好度须不低于 10%。', en: 'The building must be at least 10% in condition.' });
  const pending = openProjectsAt(w, place.id).filter((j) => j.build === 'module');
  if (moduleOf(place, args.module) || pending.some((j) => j.module === args.module)) fail('already');
  if (place.modules.length + pending.length >= P.modulesPerPlace) fail('limit_reached', { zh: `一座建筑至多 ${P.modulesPerPlace} 个模块。`, en: `A building holds at most ${P.modulesPerPlace} modules.` });
  if (!mayBuildOn(w, a, place)) fail('not_owner');
  return { module: args.module, inscription, owner: { ...place.owner }, need: MODULE_DEFS[args.module].cost * K(w) };
}

function planRoad(ctx, args) {
  const { w, a } = ctx;
  const to = needPlace(w, args.to);
  if (to === a.place) fail('invalid_args', { zh: '道路的另一端不能是此地。', en: 'The other end of a road cannot be this place.' });
  if (roadOrProjectBetween(w, a.place, to)) fail('already');
  const name = given(args.name) ? needName(args.name) : null;
  return { to, name, owner: { kind: 'city' }, need: ep(w, 'roadCost') };
}

function planUpgrade(ctx, args) {
  const { w, a } = ctx;
  if (a.place !== 'well') fail('wrong_place');
  if (Object.values(w.projects).some(j => j.build === 'upgrade' && j.status === 'open')) fail('already');
  if (w.well.upgrades.length >= P.upgradeMax) fail('invalid_args', { zh: '源井已经改良到头了', en: 'The Well cannot be upgraded further.' });
  if (args.owner !== undefined && !['self', 'city'].includes(args.owner)) fail('invalid_args');
  const level = w.well.upgrades.length + 1;
  const name = args.name === undefined ? (ctx.lang === 'en' ? `Well upgrade, level ${level}` : `源井改良 第 ${level} 级`) : needName(args.name);
  return { name, owner: ownerOf(w, a, args.owner), need: upgradeCost(w, level) };
}

const initiate = {
  validate(ctx, args) {
    const { w, a } = ctx;
    if (typeof args.build !== 'string' || !(BUILDS.includes(args.build) || (tokenized(w) && args.build === 'upgrade'))) {
      fail('invalid_args', { zh: `build 须是 ${BUILDS.join(' / ')} 之一。`, en: `build must be one of ${BUILDS.join(' / ')}.` });
    }
    const upgrade = tokenized(w) && args.build === 'upgrade' ? planUpgrade(ctx, args) : null;
    if (openProjectsAt(w, a.place).length >= P.projectsPerPlace) fail('limit_reached');
    const plan = upgrade || (args.build === 'site' ? planSite(ctx, args) : args.build === 'module' ? planModule(ctx, args) : planRoad(ctx, args));
    return { build: args.build, ...plan, cost: ctx.cost(ACTIONS.initiate.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const id = nextId(w, 'j');
    const day = clockDay(w);
    const { build, cost, ...rest } = plan;
    void cost;
    const j = {
      id, build, place: a.place, ...rest, have: 0, contributors: {}, initiator: a.id, createdDay: day, expiresDay: day + P.projectDays, status: 'open', result: null,
    };
    w.projects[id] = j;
    if (j.lot) w.lots[j.lot].project = id;
    if (j.name) noteWordUse(w, a, j.name);
    if (j.inscription) noteWordUse(w, a, j.inscription);
    emit(w, 'initiate', {
      agent: a.id,
      place: a.place,
      data: {
        projectId: id, build, type: build === 'module' ? j.module : build, name: j.name ?? j.module ?? build, owner: j.owner, need: j.need, expiresDay: j.expiresDay,
        ...(j.lot ? { lot: j.lot } : {}), ...(j.on ? { on: j.on } : {}), ...(j.module ? { module: j.module } : {}), ...(j.to ? { to: j.to } : {}),
      },
    });
    return { project: id, need: j.need, expiresDay: j.expiresDay };
  },
};

// ── contribute ──────────────────────────────────────────────

const contribute = {
  validate(ctx, args) {
    const { w, a } = ctx;
    needId(args.project);
    const j = Object.prototype.hasOwnProperty.call(w.projects, args.project) ? w.projects[args.project] : null;
    if (!j || j.status !== 'open') fail('not_found');
    if (j.place !== a.place) fail('wrong_place');
    const left = j.need - j.have;
    const energy = needInt(args.energy);
    if (energy > left) fail('invalid_args', { zh: `工程只差 ${left}。`, en: `The project needs only ${left} more.` });
    if (energy > a.energy) fail('insufficient_energy');
    // 投入的能量就是代价：由 apply 直接扣（不是动作代价），框架先核对余额
    return { j, energy, cost: 0, reserve: { energy } };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { j, energy } = plan;
    a.energy -= energy;
    a.stats.contributed += energy;
    w.dayLog.contributeSpent += energy;
    ctx.invested(energy);
    const r = addToProject(w, j, a.id, energy);
    emit(w, 'contribute', { agent: a.id, place: a.place, data: { projectId: j.id, energy, have: j.have, need: j.need } });
    return { project: j.id, have: j.have, need: j.need, built: r.built, ...(r.built ? { result: r.result } : {}) };
  },
};

// ── dismantle ───────────────────────────────────────────────

const dismantle = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const place = w.places[a.place];
    if (place.landmark) fail('landmark');
    if (place.open || place.razed) fail('nothing_left');
    let want = ep(w, 'salvagePerAction');
    if (given(args.energy)) want = needInt(args.energy);
    let module = null;
    let left;
    if (given(args.module)) {
      if (typeof args.module !== 'string') fail('invalid_args');
      const m = moduleOf(place, args.module);
      if (!m) fail('not_found');
      module = m.type;
      left = m.salvage;
    } else {
      left = place.salvage;
      if (left <= 0) fail('nothing_left');
    }
    const n = Math.min(want, ep(w, 'salvagePerAction'), left);
    return { module, n, cost: ctx.cost(ACTIONS.dismantle.base) }; // 动作代价 dismantleBase，不受倍率影响
  },
  apply(ctx, plan) {
    return dismantleAt(ctx.w, ctx.a, { module: plan.module, n: plan.n });
  },
};

export const cityHandlers = { initiate, contribute, dismantle };
