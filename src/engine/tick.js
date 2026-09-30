// SPEC-M1 §8：每刻与每日结算，严格按规格的顺序。
// 结算时钟面已是 12(d+1)：设刚结束的那一日为 d，「今日」= d，「明日」= d + 1（见 §8.2）。

import { P, epochDays } from '../params.js';
import { agentList, clockDay, newDayLog } from '../world.js';
import { emit, setSettling } from './core.js';
import { produceAndRation, collectWealthTax, decayEnergy } from './economy.js';
import { applyMetabolism, applyDeaths, fadeSouls, naturalize } from './lifecycle.js';
import { expireOffersAndPacts, dailyDreams } from './society.js';
import { isWeatherActive } from './environment.js';
import { checkConservation, closeLedgerDay } from './ledger.js';
import { decayAll, abandonExpired } from './environment.js';
import { tallyProposals, payStipends } from './laws.js';
import { stepWeather, scheduleMonth } from './weather.js';
import { dailyMetrics, computeLegacy } from '../metrics.js';
import { writeChronicle } from '../chronicle.js';
import { runSandboxBrains, sandboxAdoptions } from '../sandbox/brains.js';
import { wildIdsOf, wildPool, wildSpec } from '../map/index.js';

/** 每刻（tick 命令，§8.1） */
export function tickWorld(w) {
  w.clock.tick += 1; // 1
  for (const a of agentList(w)) a.actsThisTick = 0; // 2
  expireOffersAndPacts(w); // 3 到期的交易与孕育之约（退回托管）
  tallyProposals(w); // 4 计票
  let settled = false;
  if (w.clock.tick % P.ticksPerDay === 0) {
    dailySettlement(w, w.clock.tick / P.ticksPerDay - 1); // 5
    settled = true;
  }
  runSandboxBrains(w); // 6 沙盘脑行动（按 ID 升序）
  w.recentSpeech = w.recentSpeech.filter((s) => s.tick > w.clock.tick - P.heardTicks);
  // 7. tick 事件（SSE 的精简状态）由 HTTP 层根据世界状态产出
  return { ok: true, tick: w.clock.tick, day: clockDay(w), settled };
}

function population(w) {
  const pop = { awake: 0, dormant: 0, dead: 0, retired: 0 };
  for (const a of agentList(w)) pop[a.status]++;
  return pop;
}

/** 每日结算（§8.2 的 20 步）。d 为刚结束的那一日 */
export function dailySettlement(w, d) {
  setSettling(w, d);
  const auroraToday = isWeatherActive(w, 'aurora'); // 结算开始时记下：极光在第 13 步可能已到期被移除，但最后一晚仍算
  w.dayLog.activeWeather = w.weather.active.map((x) => x.type); // 当日生效的天象（史官用，同理在第 13 步之前记下）
  try {
    produceAndRation(w, d); // 1–2 源井日产、配给
    payStipends(w); // 3 津贴
    collectWealthTax(w); // 4
    applyMetabolism(w, d); // 5 代谢与衰老；能量为负者进入沉睡
    decayEnergy(w); // 6 腐坏
    applyDeaths(w, d); // 7 沉睡满 3 日者死亡，执行遗嘱
    decayAll(w); // 8 地点与设施衰败；产生 ruin 事件
    abandonExpired(w, d); // 9 烂尾：到期未建成的工程
    fadeSouls(w, d); // 10 消散：到期的灵魂；再对沙盘脑的孩子做领养判定
    sandboxAdoptions(w, d);
    naturalize(w, d); // 11 入籍
    restoreDaily(w); // 12
    stepWeather(w, d); // 13 天象：结束到期的、开始 startDay == d + 1 的、首次出现的征兆记事件
    if ((d + 1) % P.daysPerMonth === 0) {
      const month = (d + 1) / P.daysPerMonth;
      emit(w, 'month', { data: { month } });
      scheduleMonth(w, month); // 14 一个月的第 0 日开始：排期这个月的天象
    }
    dailyDreams(w, auroraToday); // 15 梦
    recordPlaceHistory(w); // （私有簿记）地点完好度的近况，供观测站画趋势
    w.metrics.push(dailyMetrics(w, d)); // 16 指标快照与人类遗产存活表
    w.legacy = computeLegacy(w, d);
    w.chronicle.push(writeChronicle(w, d)); // 17 史官
    emit(w, 'day', {
      data: { day: d, output: w.dayLog.output, ration: w.dayLog.ration, rationed: w.dayLog.rationed, population: population(w) },
    });
    const chk = checkConservation(w); // 18
    if (!chk.ok) {
      w.ledger.mismatches++;
      emit(w, 'ledger_mismatch', { vis: 'internal', data: chk });
    }
    closeLedgerDay(w);
    w.dayLog = newDayLog(); // 19
    if (d + 1 === epochDays()) {
      // 20 纪元结束：暂停并记「大沉睡」（快照由运行时在命令结束后写入）
      w.paused = true;
      emit(w, 'great_sleep', { data: { epoch: w.epoch } });
    }
  } finally {
    setSettling(w, undefined);
  }
}

/** 记下各地点当日终了时的完好度，只留最近 8 个（近 7 日趋势 = 最后一个 − 第一个）。老快照里没有这个字段，按需补上 */
function recordPlaceHistory(w) {
  for (const p of Object.values(w.places)) {
    if (p.condition === null) continue;
    const h = p.history || (p.history = []);
    h.push(p.condition);
    while (h.length > 8) h.shift();
  }
}

/** 第 12 步：荒野（各地带）恢复、汲取池重置、每人当日汲取量清零 */
function restoreDaily(w) {
  for (const id of wildIdsOf(w)) {
    const pool = wildPool(w, id);
    const spec = wildSpec(w, id);
    pool.energy = Math.min(spec.energyMax, pool.energy + spec.regen);
  }
  w.well.drawPoolLeft = P.wellDrawPoolPerDay;
  for (const a of agentList(w)) a.drawnToday = 0;
}
