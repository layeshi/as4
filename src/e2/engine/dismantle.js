// SPEC-E2 §10.6–§10.7：拆解与遗址。
//
// 建筑与模块都有「残料」（salvage）：拆解回收残料，每次至多 salvagePerAction；建筑的残料拆尽就成为遗址。
//   后人开辟的地点残料 = floor(造价 / 2)；后人加装的模块 = floor(造价 / 2)；人类建筑的残料见附录 B；人类建筑原有的模块残料为 0（一次即可移除）。
//   拆建筑：完好度下降 ceil(回收量 × 10000 / 残料总量)；降到 0 时成为废墟（可修复，不同于遗址）。
//   遗址：墙、碑、模块、进行中的工程与告示板上的交易随之消失；地点仍是图上的节点，与它相连的街道、小路与道路照旧。

import { clockDay } from '../world.js';
import { source } from './ledger.js';
import { emit, pushInbox, ref } from './core.js';
import { hooks } from './hooks.js';
import { applyDamage } from './environment.js';
import { closeOffer } from './society.js';
import { abandonProject, openProjectsAt } from './projects.js';

/** 取消某地告示板上的公开交易，托管退回发起者（告示板被拆除，或地点成为遗址） */
export function cancelBoardOffers(w, placeId) {
  for (const o of Object.values(w.offers)) {
    if (o.status === 'open' && o.board === placeId) closeOffer(w, o, 'cancelled');
  }
}

/**
 * 地点成为遗址（残料拆尽，§10.7）：
 *   razed / open 为真，condition = null，模块、墙、地点规则、残料都没有了，主人改归全城，不再是废墟；
 *   墙上可见的铭刻全部 lost（包括受保护的；碑的铭文随碑消失）；此地进行中的工程全部烂尾；告示板上的交易取消并退回；
 *   事件 razed（触发 on:razed），dayLog.razed。
 * 名字（p.name）保留为拆毁前的名字；遗址的显示名是「X 的遗址」（附录 A.7，按语言生成），也不占用 X 这个名字（placeNameTaken 跳过遗址）。
 */
export function razePlace(w, p) {
  const day = clockDay(w);
  cancelBoardOffers(w, p.id);
  for (const j of openProjectsAt(w, p.id)) abandonProject(w, j, 'razed');
  for (const ins of Object.values(w.inscriptions)) {
    if (ins.place === p.id && !ins.coveredBy && !ins.redacted) ins.lost = true;
  }
  p.razed = true;
  p.open = true;
  p.condition = null;
  p.modules = [];
  p.wallSlots = 0;
  p.rules = null;
  p.owner = { kind: 'city' };
  p.salvage = 0;
  p.salvageMax = 0;
  p.ruined = false;
  const inc = p.incarnations[p.incarnations.length - 1];
  if (inc) inc.toDay = day;
  w.dayLog.razed.push({ place: p.id, name: p.name });
  w.counters.razed = (w.counters.razed || 0) + 1; // 累计遗址数（每日指标 razed；遗址上重新开辟后当前的遗址数会减少，累计数不减）
  emit(w, 'razed', { place: p.id, data: { place: p.id, name: p.name } });
  hooks.fire(w, 'razed', { place: p.id });
}

/** 同在此地的醒着的居民（除执行者）收到 witness（what: dismantle） */
function witnesses(w, a, data) {
  for (const o of Object.values(w.agents)) {
    if (o.id !== a.id && o.status === 'awake' && o.place === a.place) {
      pushInbox(w, o, 'witness', { what: 'dismantle', actor: ref(a), ...data, place: a.place });
    }
  }
}

/**
 * 拆解（SPEC-E2 §10.6，已通过校验）。n：回收量（已取过 min）。module 为模块的种类，缺省拆建筑。
 * 返回 { energy, salvageLeft, razed, module? }。
 */
export function dismantleAt(w, a, { module = null, n }) {
  const p = w.places[a.place];
  let razed = false;
  let salvageLeft;
  if (module) {
    const m = p.modules.find((x) => x.type === module);
    m.salvage -= n;
    salvageLeft = m.salvage;
    if (m.salvage <= 0) {
      p.modules = p.modules.filter((x) => x !== m);
      if (module === 'board') cancelBoardOffers(w, p.id);
    }
  } else {
    p.salvage -= n;
    salvageLeft = p.salvage;
    const bp = Math.ceil((n * 10000) / p.salvageMax);
    applyDamage(w, p, p.id, p.id, bp);
  }
  if (n > 0) {
    a.energy += n;
    source(w, 'energy', 'salvage', n);
  }
  a.salvagedToday += n;
  a.stats.salvaged += n;
  p.activity.salvaged += n;
  w.dayLog.salvaged += n;
  w.dayLog.dismantles.push({ agent: a.id, place: p.id, energy: n });
  witnesses(w, a, { energy: n, ...(module ? { module } : {}) });
  emit(w, 'dismantle', { agent: a.id, place: p.id, data: { agent: a.id, place: p.id, energy: n, ...(module ? { module } : {}), salvageLeft } });
  if (!module && p.salvage <= 0) {
    razePlace(w, p);
    razed = true;
  }
  return { energy: n, salvageLeft, razed, ...(module ? { module } : {}) };
}
