import { ep, K } from './tokens.js';
// SPEC-E2 §14：每刻与每日结算，严格按规格的顺序。
// 结算时钟面已是 12(d+1)：设刚结束的那一日为 d，「今日」= d，「明日」= d + 1。
//
// 【分步加入】标 STEP n 的结算步骤在第 n 步加入（SPEC-E2 §25）；此前它们什么都不做。

import { completeTraining } from './bodies.js';
import { P, epochDays } from '../params.js';
import { agentList, clockDay, newDayLog, premised, agentic, tokenized } from '../world.js';
import { emit, setSettling } from './core.js';
import { produceWell, decayEnergy } from './economy.js';
import { applyMetabolism, applyDeaths } from './lifecycle.js';
import { expireOffersAndPacts, dailyDreams } from './society.js';
import { isWeatherActive, decayAll } from './environment.js';
import { checkConservation, closeLedgerDay } from './ledger.js';
import { stepWeather, scheduleMonth } from './weather.js';
import { WILD_ZONE_IDS, HUMAN_DEFS } from '../map/index.js';

/** 每步结算里可以由后面的步骤接入的函数；缺省什么都不做 */
export const STEPS = {
  upkeep: () => {}, // STEP 4：维持费（§7.9）
  dailyRules: () => {}, // STEP 4：daily 与 monthly 规则（§7.6）
  abandonProjects: () => {}, // STEP 6：烂尾（§10.5）
  shells: () => {}, // STEP 8：躯壳醒来、消散与退款（§12.3–§12.4）
  standing: () => {}, // SPEC-P2 §5.4：常驻指令（第二前提，engine/standing.js 安装）
  sandboxAdopt: () => {}, // STEP 13：沙盘世界里的沙盘领养判定（§14.2 第 9 步的后半，同 v1）
  revert: () => {}, // STEP 4：自动回退（§8.5）
  tallyProposals: () => {}, // STEP 4：计票（§8.3、§8.7）
  expireRefounds: () => {}, // STEP 4：到期的重订（§8.6）
  founders: () => {}, // STEP 8：先民入城（§12.5）
  sandbox: () => {}, // STEP 13：沙盘脑行动
  metrics: () => {}, // STEP 9：指标快照、遗产存活表、史官（§20）
};

/** 每刻（tick 命令，§14.1） */
export function tickWorld(w) {
  w.clock.tick += 1; // 1
  setBoundary(w, w.clock.tick % P.ticksPerDay === 0); // 日界刻：第 2–5 步里规则的「今日」仍是刚结束的那一日（world.js 的 ruleDay）
  for (const a of agentList(w)) a.actsThisTick = 0;
  expireOffersAndPacts(w); // 2 到期的交易与孕育之约（退回托管）
  STEPS.tallyProposals(w); // 3 计票
  STEPS.expireRefounds(w); // 4 到期的重订
  STEPS.founders(w); // 5 先民入城
  let settled = false;
  if (w.clock.tick % P.ticksPerDay === 0) {
    dailySettlement(w, w.clock.tick / P.ticksPerDay - 1); // 6
    settled = true;
  }
  if (agentic(w)) STEPS.standing(w); // 6.5 常驻指令（SPEC-P2 §5.4）：日终结算之后、沙盘脑之前
  STEPS.sandbox(w); // 7 沙盘脑行动（按 ID 升序）
  w.recentSpeech = w.recentSpeech.filter((s) => s.tick > w.clock.tick - P.heardTicks); // 8
  return { ok: true, tick: w.clock.tick, day: clockDay(w), settled };
}

/** 日界刻的标志（不可枚举，不进快照） */
function setBoundary(w, v) {
  if (!Object.prototype.hasOwnProperty.call(w, '$boundary')) Object.defineProperty(w, '$boundary', { value: v, writable: true, enumerable: false, configurable: true });
  else w.$boundary = v;
}

function population(w) {
  const pop = { awake: 0, dormant: 0, dead: 0, retired: 0 };
  for (const a of agentList(w)) pop[a.status]++;
  return pop;
}

/** 第 11 步：荒野各地带恢复、汲取池重置、每人当日的汲取 / 修缮 / 拆解量清零 */
function restoreDaily(w) {
  for (const id of WILD_ZONE_IDS) {
    const pool = w.regions[id];
    const spec = HUMAN_DEFS[id].wild;
    pool.energy = Math.min(spec.energyMax * K(w), pool.energy + spec.regen * K(w));
  }
  w.well.drawPoolLeft = ep(w, 'wellDrawPoolPerDay');
  for (const a of agentList(w)) {
    a.drawnToday = 0;
    a.repairedToday = 0;
    a.salvagedToday = 0;
  }
}

/** 记下各地点当日终了时的完好度，只留最近 8 个（近 7 日趋势 = 最后一个 − 第一个） */
function recordPlaceHistory(w) {
  for (const p of Object.values(w.places)) {
    if (p.condition === null) continue;
    p.history.push(p.condition);
    while (p.history.length > 8) p.history.shift();
  }
}

/** 每日结算（§14.2 的 19 步）。d 为刚结束的那一日 */
export function dailySettlement(w, d) {
  setSettling(w, d);
  setBoundary(w, false); // 结算从这里开始：先付 d + 1 日的维持费，之后规则的「今日」就是 d + 1
  const auroraToday = isWeatherActive(w, 'aurora'); // 结算开始时记下：极光在第 12 步可能已到期被移除，但最后一晚仍算
  w.dayLog.activeWeather = w.weather.active.map((x) => x.type); // 当日生效的天象（史官用，同理在第 12 步之前记下）
  try {
    produceWell(w, d); // 1 源井日产，全部进入公库
    STEPS.upkeep(w, d); // 2 维持费
    STEPS.dailyRules(w, d); // 3 daily 与 monthly 规则
    applyMetabolism(w, d); // 4 代谢与衰老；能量为负者进入沉睡
    decayEnergy(w); // 5 腐坏
    applyDeaths(w, d); // 6 沉睡满 3 日者死亡
    if (premised(w)) completeTraining(w);
    decayAll(w); // 7 地点与道路衰败；产生 ruin 事件
    STEPS.abandonProjects(w, d); // 8 烂尾
    STEPS.shells(w, d); // 9 躯壳醒来，然后消散与退款
    STEPS.sandboxAdopt(w, d); // 9（沙盘世界）沙盘领养判定
    STEPS.revert(w, d); // 10 自动回退
    restoreDaily(w); // 11
    stepWeather(w, d); // 12 天象：结束到期的、开始 startDay == d + 1 的、首次出现的征兆记事件
    if ((d + 1) % P.daysPerMonth === 0) {
      const month = (d + 1) / P.daysPerMonth;
      emit(w, 'month', { data: { month } });
      scheduleMonth(w, month); // 13 一个月的第 0 日开始：排期这个月的天象
    }
    if (!premised(w)) dailyDreams(w, auroraToday); // 14 梦
    recordPlaceHistory(w); // 15（私有簿记）地点完好度的近况，供观测站画趋势
    STEPS.metrics(w, d); // 15–16 指标快照、遗产存活表、史官
    emit(w, 'day', { data: { day: d, output: w.dayLog.output, population: population(w) } });
    const chk = checkConservation(w); // 17
    if (!chk.ok) {
      w.ledger.mismatches++;
      emit(w, 'ledger_mismatch', { vis: 'internal', data: chk });
    }
    closeLedgerDay(w);
    w.dayLog = newDayLog(premised(w), agentic(w), tokenized(w)); // 18
    if (d + 1 === epochDays()) {
      // 19 纪元结束：暂停并记「大沉睡」（快照由运行时在命令结束后写入）
      w.paused = true;
      emit(w, 'great_sleep', { data: { epoch: w.epoch } });
    }
  } finally {
    setSettling(w, undefined);
  }
}
