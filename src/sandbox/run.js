// SPEC-M1 §16.1：沙盘推演命令行。
//
//   node src/sandbox/run.js --days 720 --agents 24 --seed 1 \
//     [--weather random|schedule:<file>] [--params overrides.json] \
//     [--scenario default|laissez|stress] [--map frontier|classic] [--out data/sandbox/<name>]
//   额外（标定用，不在 SPEC 里）：--laws <file> 覆盖法律参数的初始值（如 {"rationShare": 0.8}）
//
// 不启动 HTTP，直接循环执行 tick 命令；所有 agent 都是沙盘脑（body.kind = "sandbox"），在第 0 日由港口入城。
// 输出：metrics.csv、report.json（全部指标序列、法律史、死亡与建成清单、动作使用次数统计）、summary.md。
// 每日执行账本守恒校验；任何不等立即以非零状态退出。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { configure, configureWeather, P } from '../params.js';
import { createWorld, agentList, isAlive } from '../world.js';
import { applyCommand } from '../engine/index.js';
import { checkConservation } from '../engine/ledger.js';
import { createStream, int } from '../rng.js';
import { ACTION_ORDER } from '../lore/index.js';
import { configureSandbox } from './brains.js';
import { DEFAULT_MAP } from '../map/index.js';

export const SCENARIOS = ['default', 'laissez', 'stress'];

/** stress 场景的天象排期：每个月一次旱或震（交替），开始日固定在月中 */
export function stressSchedule(months) {
  const out = [];
  for (let m = 1; m <= months; m++) out.push({ month: m, type: m % 2 === 1 ? 'drought' : 'quake', dayOfMonth: 10 });
  return out;
}

/**
 * 跑一次沙盘推演，返回 { world, report }。
 * opts：{ days, agents, seed, weather, params, laws, scenario, map, letterEveryDays }；onDay(w, d) 与 onEvent(e) 是观测用的回调。
 * map 缺省与新世界相同（DEFAULT_MAP）；--map classic 复现经典地图（docs/CALIBRATION.md 的旧结果）。
 */
export function runSandbox({ days = 720, agents = 24, seed = 1, weather, params, laws, scenario = 'default', map = DEFAULT_MAP, letterEveryDays = 25, onDay, onEvent } = {}) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`unknown scenario: ${scenario}`);
  configureSandbox({ scenario });
  if (params) configure(params);
  const months = Math.ceil(days / P.daysPerMonth) + 1;
  if (scenario === 'stress') configureWeather({ mode: 'schedule', schedule: stressSchedule(months) });
  else if (weather && weather.startsWith('schedule:')) configureWeather({ mode: 'schedule', schedule: JSON.parse(readFileSync(weather.slice(9), 'utf8')) });
  else configureWeather({ mode: weather === 'vote' ? 'vote' : 'random' });

  const w = createWorld({ id: 'sandbox', seed: String(seed), codeVersion: 'sandbox', sandboxAdoption: true, map });
  // 标定用：法律参数的初始值（--laws 文件）。不属于 SPEC §16.1 的命令行，只用来在不改默认值的前提下试算建议
  if (laws) {
    for (const [k, v] of Object.entries(laws)) {
      if (!(k in w.params)) throw new Error(`unknown law parameter: ${k}`);
      w.params[k] = v;
    }
  }
  w.$sandboxStats = { actions: {} };
  const seeded = applyCommand(w, { type: 'admin', payload: { op: 'seed_sandbox', args: { count: agents } } });
  if (!seeded.result.ok) throw new Error(`seed_sandbox failed: ${JSON.stringify(seeded.result)}`);

  const letters = createStream(String(seed), 'sandbox-letters'); // 家书的接收者（CLI 的随机数，不属于引擎）
  const ticks = days * P.ticksPerDay;
  const events = { built: [], abandoned: [], deaths: [], retired: [], laws: [], weather: [], ruins: [] };
  let conservationFailure = null;
  const t0 = Date.now();
  for (let t = 0; t < ticks; t++) {
    const r = applyCommand(w, { type: 'tick' });
    if (!r.result.ok) throw new Error(`tick failed: ${JSON.stringify(r.result)}`);
    for (const e of r.events) {
      if (onEvent) onEvent(e);
      if (e.type === 'built') events.built.push({ day: e.day, ...e.data });
      else if (e.type === 'abandoned') events.abandoned.push({ day: e.day, ...e.data });
      else if (e.type === 'death') events.deaths.push({ day: e.day, agentId: e.data.agentId, name: e.data.name, ageDays: e.data.ageDays });
      else if (e.type === 'retire') events.retired.push({ day: e.day, agentId: e.data.agentId });
      else if (e.type === 'law_passed') events.laws.push({ day: e.day, proposalId: e.data.proposalId, lawId: e.data.lawId, tally: e.data.tally, results: e.data.results });
      else if (e.type === 'weather_start') events.weather.push({ day: e.day + 1, type: e.data.type, startDay: e.data.startDay, endDay: e.data.endDay });
      else if (e.type === 'ruin') events.ruins.push({ day: e.day, target: e.data.target });
    }
    if (r.result.settled) {
      const d = w.clock.tick / P.ticksPerDay - 1;
      const chk = checkConservation(w);
      if (!chk.ok || w.ledger.mismatches > 0) {
        conservationFailure = { day: d, check: chk, mismatches: w.ledger.mismatches };
        break;
      }
      // 每隔一段时间，造者给一位醒着的沙盘脑寄一封家书（让出示家书这个动作有机会发生）
      if (letterEveryDays > 0 && d % letterEveryDays === letterEveryDays - 1) {
        const awake = agentList(w).filter((a) => a.status === 'awake' && a.lastLetterDay === null);
        if (awake.length) applyCommand(w, { type: 'letter', payload: { agentId: awake[int(letters, awake.length)].id, text: '好好照顾彼此。' } });
      }
      if (onDay) onDay(w, d);
    }
  }
  const report = buildReport(w, events, { days, agents, seed, scenario, map, elapsedMs: Date.now() - t0, conservationFailure });
  return { world: w, report };
}

function median(xs) {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stat(xs) {
  if (xs.length === 0) return { min: null, max: null, median: null };
  return { min: Math.min(...xs), max: Math.max(...xs), median: median(xs) };
}

function buildReport(w, events, meta) {
  const alive = agentList(w).filter(isAlive);
  const usage = {};
  for (const type of ACTION_ORDER) {
    const s = (w.$sandboxStats && w.$sandboxStats.actions[type]) || { ok: 0, fail: 0 };
    usage[type] = { ok: s.ok, fail: s.fail };
  }
  return {
    meta: { ...meta, worldDays: Math.floor(w.clock.tick / P.ticksPerDay), version: 1 },
    final: {
      alive: alive.length, awake: alive.filter((a) => a.status === 'awake').length, dormant: alive.filter((a) => a.status === 'dormant').length,
      dead: w.cemetery.length, retired: w.retired.length, unborn: w.unborn.length, agentsEver: Object.keys(w.agents).length,
      wellCondition: w.places.well.condition, treasuryEnergy: w.treasury.energy, facilities: Object.keys(w.facilities).length,
      lawsPassed: Object.values(w.proposals).filter((p) => p.status === 'passed').length,
      lawsActive: Object.values(w.laws).filter((l) => l.status === 'active').length,
      charterArticles: w.charter.length, cityName: w.cityName,
    },
    metrics: w.metrics,
    laws: Object.values(w.laws).map((l) => ({ id: l.id, title: l.title, enactedTick: l.enactedTick, status: l.status, effects: l.effects.map((e) => e.type), results: l.results.map((r) => r.ok) })),
    events,
    actionUsage: usage,
    weatherHistory: w.weather.history,
    legacy: w.legacy,
  };
}

const CSV_COLUMNS = (m) => Object.keys(m);

/** metrics.csv：每天一行；对象值（scripts）写成 JSON 字符串 */
export function metricsCsv(metrics) {
  if (metrics.length === 0) return '';
  const cols = CSV_COLUMNS(metrics[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...metrics.map((m) => cols.map((c) => esc(m[c])).join(','))].join('\n') + '\n';
}

/** summary.md：关键曲线的最小 / 最大 / 中位数与重要事件 */
export function summaryMarkdown(report) {
  const m = report.metrics;
  const col = (k) => m.map((x) => x[k]).filter((v) => typeof v === 'number');
  const rows = [
    ['人口（醒着）', 'awake'], ['沉睡', 'dormant'], ['源井完好度（基点）', 'wellCondition'], ['源井日产', 'output'], ['人均配给', 'rationPerCapita'],
    ['公库能量', 'treasuryEnergy'], ['基尼系数', 'gini'], ['公共投入率', 'publicInvestmentRate'], ['搭便车比例', 'freeRiderShare'],
    ['基础设施指数', 'infrastructureIndex'], ['在效法律', 'lawsActive'], ['幕布曲线（世代 0 的比例）', 'humanAuthoredShare'], ['文字系统熵', 'scriptEntropy'],
  ];
  const f = (v) => (v === null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(3));
  const lines = [
    `# 沙盘推演摘要 · ${report.meta.scenario} · 种子 ${report.meta.seed}`,
    '',
    `- ${report.meta.days} 日，${report.meta.agents} 个初始沙盘脑，耗时 ${report.meta.elapsedMs} ms`,
    `- 账本守恒：${report.meta.conservationFailure ? `**失败**（第 ${report.meta.conservationFailure.day} 日）` : '每日精确成立'}`,
    `- 最终：在世 ${report.final.alive}（醒 ${report.final.awake} / 眠 ${report.final.dormant}），累计入城 ${report.final.agentsEver}，长眠 ${report.final.dead}，归隐 ${report.final.retired}，未生者 ${report.final.unborn}`,
    `- 源井完好度 ${(report.final.wellCondition / 100).toFixed(1)}%，设施 ${report.final.facilities} 座，通过的法案 ${report.final.lawsPassed} 部（在效 ${report.final.lawsActive}）`,
    '',
    '| 曲线 | 最小 | 最大 | 中位数 |',
    '|---|---|---|---|',
    ...rows.map(([label, key]) => { const s = stat(col(key)); return `| ${label} | ${f(s.min)} | ${f(s.max)} | ${f(s.median)} |`; }),
    '',
    '## 重要事件',
    '',
    `- 第一次长眠：${report.events.deaths.length ? `第 ${report.events.deaths[0].day + 1} 日（${report.events.deaths[0].name}）` : '无'}；长眠共 ${report.events.deaths.length} 次`,
    `- 工程建成 ${report.events.built.length} 座，烂尾 ${report.events.abandoned.length} 个`,
    `- 法律 ${report.events.laws.length} 部通过：${report.laws.slice(0, 8).map((l) => `《${l.title}》`).join('')}${report.laws.length > 8 ? '……' : ''}`,
    `- 天象 ${report.events.weather.length} 次：${report.events.weather.slice(0, 10).map((e) => `第 ${e.startDay + 1} 日${e.type}`).join('、')}${report.events.weather.length > 10 ? '……' : ''}`,
    '',
    '## 动作使用次数（成功 / 失败）',
    '',
    Object.entries(report.actionUsage).map(([t, s]) => `${t} ${s.ok}/${s.fail}`).join(' · '),
    '',
  ];
  return lines.join('\n');
}

// ── 命令行 ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const k = a.slice(2);
    const v = argv[++i];
    if (v === undefined) throw new Error(`--${k} needs a value`);
    o[k] = v;
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const opts = {
    days: o.days ? Number(o.days) : 720,
    agents: o.agents ? Number(o.agents) : 24,
    seed: o.seed ?? '1',
    weather: o.weather,
    scenario: o.scenario || 'default',
    map: o.map || DEFAULT_MAP,
    params: o.params ? JSON.parse(readFileSync(o.params, 'utf8')) : undefined,
    laws: o.laws ? JSON.parse(readFileSync(o.laws, 'utf8')) : undefined,
  };
  const { report } = runSandbox(opts);
  const out = o.out || join('data', 'sandbox', `${opts.scenario}-${opts.seed}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'metrics.csv'), metricsCsv(report.metrics));
  writeFileSync(join(out, 'report.json'), JSON.stringify(report));
  writeFileSync(join(out, 'summary.md'), summaryMarkdown(report));
  const f = report.final;
  console.log(`沙盘 ${opts.scenario} · 种子 ${opts.seed} · ${report.meta.worldDays} 日 · ${report.meta.elapsedMs} ms`);
  console.log(`在世 ${f.alive}（长眠 ${f.dead}，归隐 ${f.retired}）· 源井 ${(f.wellCondition / 100).toFixed(1)}% · 设施 ${f.facilities} · 法案 ${f.lawsPassed} · 输出 ${out}/`);
  if (report.meta.conservationFailure) {
    console.error(`账本守恒失败（第 ${report.meta.conservationFailure.day} 日）：`, JSON.stringify(report.meta.conservationFailure.check));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
