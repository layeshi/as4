// SPEC-E2 §7.3–§7.4、PROTOCOL-2 §6.5：规则语言的「宿主」——把求值器（rules/eval.js）接到真实的世界上。
//
// 求值器只认引用（{ $: 'agent', id } 之类）与普通记录；它读取世界的一切都通过这里的 host：
// 名字（city var agents cradle）、列表函数（tagged members at）、字段（居民 / 社群 / 灵魂）、随机数。
// 规则读不到的东西（记忆、日记、独白、私语、家书、灵魂全文、身体与模型）在这里根本不暴露（守护律「内心不可侵」）。
//
// 宿主是一次调用一个：它缓存当次调用里算过的列表，调用结束即丢弃；不改变世界（除 sample 推进给定的随机数流）。

import { P, SEASON_TABLE } from '../params.js';
import { clockDay, dayOfMonthOf, monthOfDay, findAgent, isAlive } from '../world.js';
import { agentRef, groupRef, soulRef, isRef } from '../rules/eval.js';
import { int } from '../../rng.js';
import { isWeatherActive } from './environment.js';
import { livingShells, shellsFree } from './shells.js';

export { livingShells, shellsFree };

/** ID 的数字部分 */
const idNum = (id) => Number(String(id).slice(1)) || 0;
const byIdNum = (a, b) => idNum(a) - idNum(b);

/** 规则里的 city 记录（PROTOCOL-2 §6.5）。今日 = 钟面上的今天（日终结算中它已是刚开始的那一日） */
export function cityRecord(w) {
  const day = clockDay(w);
  const dom = dayOfMonthOf(day);
  let awake = 0;
  let dormant = 0;
  for (const a of Object.values(w.agents)) {
    if (a.status === 'awake') awake++;
    else if (a.status === 'dormant') dormant++;
  }
  const hist = w.well.outputHistory;
  return {
    day,
    dayOfMonth: dom,
    month: monthOfDay(day),
    season: SEASON_TABLE[dom],
    treasury: w.treasury.energy,
    treasuryCoins: w.treasury.coins,
    wellOutput: hist.length ? hist[hist.length - 1] : 0,
    wellCondition: w.places.well.condition,
    awake,
    dormant,
    residents: awake + dormant,
    shellsFree: shellsFree(w),
    shellsTotal: w.shells.slots,
  };
}

/**
 * 居民 / 社群 / 灵魂的字段（PROTOCOL-2 §6.5）。不存在的字段返回 undefined（求值器据此报 type 错误）。
 * 居民的 status 通常是 awake | dormant；只有 on:death / on:retire 的 event.agent 会是已离场的居民（status 为 dead | retired，能量与旧币为 0）。
 */
function agentField(w, a, name) {
  switch (name) {
    case 'id': return a.id;
    case 'name': return a.name;
    case 'lang': return a.lang;
    case 'energy': return a.energy;
    case 'coins': return a.coins;
    case 'age': return clockDay(w) - a.bornDay;
    case 'generation': return a.generation;
    case 'place': return a.place;
    case 'status': return a.status;
    case 'drawnToday': return a.drawnToday;
    case 'repairedToday': return a.repairedToday;
    case 'salvagedToday': return a.salvagedToday;
    case 'repaired': return a.stats.repaired;
    case 'contributed': return a.stats.contributed;
    case 'salvaged': return a.stats.salvaged;
    case 'purpose': return a.purpose === null || a.purpose === undefined || a.purpose === '' ? null : a.purpose;
    default: return undefined;
  }
}

function groupField(w, g, name) {
  switch (name) {
    case 'id': return g.id;
    case 'name': return g.name;
    case 'treasury': return g.treasury.energy;
    case 'treasuryCoins': return g.treasury.coins;
    case 'steward': return g.steward && w.agents[g.steward] && isAlive(w.agents[g.steward]) ? agentRef(g.steward) : null;
    case 'size': return g.members.filter((id) => isAlive(w.agents[id])).length;
    default: return undefined;
  }
}

function soulField(w, s, name) {
  switch (name) {
    case 'id': return s.id;
    case 'name': return s.name;
    case 'fund': return s.fund;
    case 'expiresDay': return s.expiresDay;
    case 'generation': return s.generation;
    default: return undefined;
  }
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * 为一次调用建立宿主。
 * opts：
 *   vars  规则里 var 读到的变量（城法：w.vars；社群章程：该社群的 vars；地点规则：城的 vars）
 *   rng   sample 用的随机数流（缺省为 w.rng.world；试算与感知的预求值传一份副本，不推进真正的流）
 */
export function makeHost(w, { vars = w.vars, rng = w.rng.world } = {}) {
  let agentsCache = null;
  let cityCache = null;

  const live = (id) => {
    const a = has(w.agents, id) ? w.agents[id] : null;
    return a && isAlive(a) ? a : null;
  };
  const agentRefs = (pred) => {
    const out = [];
    for (const a of Object.values(w.agents)) if (isAlive(a) && pred(a)) out.push(agentRef(a.id));
    return out;
  };

  return {
    get city() {
      if (cityCache === null) cityCache = cityRecord(w);
      return cityCache;
    },
    vars,
    agents() {
      if (agentsCache === null) agentsCache = agentRefs(() => true);
      return agentsCache.slice();
    },
    cradle: () => Object.keys(w.souls).sort(byIdNum).map((id) => soulRef(id)),
    tagged: (tag) => agentRefs((a) => a.tags.includes(tag)),
    members(gid) {
      const g = has(w.groups, gid) ? w.groups[gid] : null;
      if (!g || g.dissolved) return [];
      return g.members.filter((id) => live(id)).sort(byIdNum).map((id) => agentRef(id));
    },
    at: (pid) => agentRefs((a) => a.place === pid),
    // 事件里的当事人（on:death、on:retire）已不在世，读它的标签 / 名字等仍然可以；只有账户与操作的目标要求在世（isLive）
    hasTag: (r, tag) => has(w.agents, r.id) && w.agents[r.id].tags.includes(tag),
    inGroup: (r, gid) => has(w.agents, r.id) && w.agents[r.id].groups.includes(gid),
    isAwake: (r) => has(w.agents, r.id) && w.agents[r.id].status === 'awake',
    isWild: (pid) => has(w.places, pid) && w.places[pid].wild,
    ownerOf(pid) {
      if (!has(w.places, pid)) return null;
      const o = w.places[pid].owner;
      return o.kind === 'city' ? 'city' : o.id;
    },
    weather: (code) => isWeatherActive(w, code),
    lookup(kind, text) {
      if (kind === 'agent') {
        const a = findAgent(w, text);
        return a && isAlive(a) ? agentRef(a.id) : null;
      }
      if (kind === 'group') return has(w.groups, text) && !w.groups[text].dissolved ? groupRef(text) : null;
      return has(w.souls, text) ? soulRef(text) : null;
    },
    isLive(r) {
      if (!isRef(r)) return false;
      if (r.$ === 'agent') return !!live(r.id);
      if (r.$ === 'group') return has(w.groups, r.id) && !w.groups[r.id].dissolved;
      if (r.$ === 'soul') return has(w.souls, r.id);
      return r.$ === 'treasury';
    },
    field(r, name) {
      if (r.$ === 'agent') return has(w.agents, r.id) ? agentField(w, w.agents[r.id], name) : undefined;
      if (r.$ === 'group') return has(w.groups, r.id) ? groupField(w, w.groups[r.id], name) : undefined;
      if (r.$ === 'soul') return has(w.souls, r.id) ? soulField(w, w.souls[r.id], name) : undefined;
      return undefined;
    },
    rngInt: (n) => int(rng, n),
  };
}
