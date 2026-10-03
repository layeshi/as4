// SPEC-E2 §23.1：第二纪的沙盘推演命令行。
//
//   node src/e2/sandbox/run.js --days 720 --agents 24 --seed 1 \
//     [--scenario default|laissez|stress] [--weather random|schedule:<file>] [--params overrides.json] [--out data/sandbox-e2/<name>]
//
// 不启动 HTTP，直接循环执行 tick 命令；所有居民都是沙盘脑（body.kind = "sandbox"）：先民分三批（第 0、8、16 日）自港口入城，
// 此后的新生者来自摇篮里被出资买下的躯壳与沙盘领养。输出：metrics.csv、report.json（全部指标序列、法律史、动作与操作的使用次数……）、summary.md。
// 每日执行账本守恒校验；任何不等立即以非零状态退出。
// `npm run sandbox` 与 `npm run calibrate` 经 src/sandbox/main.js 分派，--physics 缺省为 2。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { configure, configureWeather, P } from '../params.js';
import { createWorld, agentList, isAlive, premised } from '../world.js';
import { applyCommand } from '../engine/index.js';
import { checkConservation } from '../engine/ledger.js';
import { createStream, int } from '../../rng.js';
import { stateHash } from '../../store.js';
import { weightOf } from '../engine/lifecycle.js';
import { ACTION_ORDER, actionTable } from '../lore/actions.js';
import { configureSandbox } from './brains.js';
import { TITLE_KEYS } from './templates.js';

export const SCENARIOS = ['default', 'laissez', 'stress'];

/** 规则语言的全部操作（PROTOCOL-2 §6.7）：覆盖要求是每一种至少被施行一次 */
export const RULE_OPS = Object.freeze([
  'transfer', 'share', 'each', 'deny', 'fee', 'set', 'tag', 'untag', 'announce', 'exile', 'pardon', 'rename', 'mint',
  'protect', 'unprotect', 'amend', 'repeal', 'fund', 'cede', 'seize', 'petition',
]);

/** stress 场景的天象排期：每个月一次旱或震（交替），开始日固定在月中 */
export function stressSchedule(months) {
  const out = [];
  for (let m = 1; m <= months; m++) out.push({ month: m, type: m % 2 === 1 ? 'drought' : 'quake', dayOfMonth: 10 });
  return out;
}

/** 一组规则里用到了哪些操作（含 each 里面的） */
export function opsIn(rules, into = new Set()) {
  for (const rule of rules || []) {
    for (const op of rule.do || []) {
      into.add(op.op);
      if (op.op === 'each') opsIn([{ do: op.do }], into);
    }
  }
  return into;
}

/**
 * 跑一次沙盘推演，返回 { world, report }。
 * opts：{ days, agents, seed, weather, params, scenario, letterEveryDays }；onDay(w, d) 与 onEvent(e) 是观测用的回调。
 */
export function runSandbox({ days = 720, agents = 24, seed = 1, weather, params, scenario = 'default', letterEveryDays = 25, onDay, onEvent, premise = 0, shellSlots = P.shellSlots } = {}) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`unknown scenario: ${scenario}`);
  configureSandbox({ scenario });
  if (params) configure(params);
  const months = Math.ceil(days / P.daysPerMonth) + 1;
  if (scenario === 'stress') configureWeather({ mode: 'schedule', schedule: stressSchedule(months) });
  else if (weather && weather.startsWith('schedule:')) configureWeather({ mode: 'schedule', schedule: JSON.parse(readFileSync(weather.slice(9), 'utf8')) });
  else configureWeather({ mode: weather === 'vote' ? 'vote' : 'random' });

  if (premise === 1 && agents > shellSlots) throw new Error('设定 1 的世界里，先民不能多于躯壳');
  const w = createWorld({ id: 'sandbox', seed: String(seed), codeVersion: 'sandbox', sandboxAdoption: true, sandboxShells: true, premise, shellSlots });
  const everDormant = new Set();
  Object.defineProperty(w, '$sandboxStats', { value: { actions: {} }, writable: true, enumerable: false, configurable: true });
  const seeded = applyCommand(w, { type: 'admin', payload: { op: 'seed_sandbox', args: { count: agents } } });
  if (!seeded.result.ok) throw new Error(`seed_sandbox failed: ${JSON.stringify(seeded.result)}`);

  const letters = createStream(String(seed), 'sandbox-letters'); // 家书的接收者（CLI 的随机数，不属于引擎）
  const ticks = days * P.ticksPerDay;
  const events = { built: [], abandoned: [], deaths: [], retired: [], laws: [], weather: [], ruins: [], razed: [], embodied: [], refounds: [], procedures: [], dismantles: 0 };
  const ops = {}; // 规则操作的施行次数（rule_op 事件）
  const lawOps = new Map(); // 法律 / 章程 / 地点规则 → 它执行过的操作种类
  let conservationFailure = null;
  const t0 = Date.now();
  for (let t = 0; t < ticks; t++) {
    const r = applyCommand(w, { type: 'tick' });
    if (!r.result.ok) throw new Error(`tick failed: ${JSON.stringify(r.result)}`);
    for (const e of r.events) {
      if (premised(w) && e.type === 'dormant') everDormant.add(e.agent);
      if (onEvent) onEvent(e);
      switch (e.type) {
        case 'built': events.built.push({ day: e.day, ...e.data }); break;
        case 'abandoned': events.abandoned.push({ day: e.day, ...e.data }); break;
        case 'death': events.deaths.push({ day: e.day, agentId: e.data.agentId, name: e.data.name, ageDays: e.data.ageDays }); break;
        case 'retire': events.retired.push({ day: e.day, agentId: e.data.agentId }); break;
        case 'law_passed': events.laws.push({ day: e.day, proposalId: e.data.proposalId, lawId: e.data.lawId, tally: e.data.tally }); break;
        case 'weather_start': events.weather.push({ day: e.day + 1, type: e.data.type, startDay: e.data.startDay, endDay: e.data.endDay }); break;
        case 'ruin': events.ruins.push({ day: e.day, target: e.data.target }); break;
        case 'razed': events.razed.push({ day: e.day, place: e.data.place }); break;
        case 'embodied': events.embodied.push({ day: e.day, soulId: e.data.soulId, agentId: e.data.agentId }); break;
        case 'refound_open': events.refounds.push({ day: e.day, kind: 'open', id: e.data.refoundId }); break;
        case 'refounded': events.refounds.push({ day: e.day, kind: 'succeeded', id: e.data.refoundId }); break;
        case 'law_replaced': events.procedures.push({ day: e.day, kind: 'replaced', ...e.data }); break;
        case 'procedure_reverted': events.procedures.push({ day: e.day, kind: 'reverted', ...e.data }); break;
        case 'dismantle': events.dismantles++; break;
        case 'rule_op': {
          if (e.data.ok === false) break; // 只数真正施行了的（目标已经不在、付不起等失败的不算）
          ops[e.data.op] = (ops[e.data.op] || 0) + 1;
          const key = `${e.data.scope}|${e.data.owner}`;
          if (!lawOps.has(key)) lawOps.set(key, new Set());
          lawOps.get(key).add(e.data.op);
          break;
        }
        default: break;
      }
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
  // each 不产生自己的 rule_op（它展开成里面的操作）：某部法律用到了 each 且执行过操作，就算 each 被施行过
  const eachRan = coveredEach(w, lawOps);
  if (eachRan) ops.each = (ops.each || 0) + eachRan;
  const report = buildReport(w, events, ops, { days, agents, seed, scenario, elapsedMs: Date.now() - t0, conservationFailure });
  if (premised(w)) {
    const cohort = (people, sleeping) => {
      const selected = people.filter((a) => everDormant.has(a.id) === sleeping);
      return { count: selected.length, mean: selected.length ? Math.floor(selected.reduce((n, a) => n + weightOf(a).memories, 0) / selected.length) : 0 };
    };
    report.p1 = { stateHash: stateHash(w),
      memoryByDormancy: { everDormant: cohort(agentList(w), true), neverDormant: cohort(agentList(w), false) },
      livingMemoryByDormancy: { everDormant: cohort(agentList(w).filter(isAlive), true), neverDormant: cohort(agentList(w).filter(isAlive), false) },
    };
  }
  return { world: w, report };
}

/** 用到了 each 且执行过操作的规则集合的数量（城法、社群章程、地点规则） */
function coveredEach(w, lawOps) {
  let n = 0;
  for (const l of Object.values(w.laws)) if (l.rules && opsIn(l.rules).has('each') && lawOps.has(`city|${l.id}`)) n++;
  for (const g of Object.values(w.groups)) if (g.bylaws && opsIn(g.bylaws.rules).has('each') && lawOps.has(`group:${g.id}|${g.id}`)) n++;
  for (const p of Object.values(w.places)) if (p.rules && opsIn(p.rules.rules).has('each') && lawOps.has(`place:${p.id}|${p.id}`)) n++;
  return n;
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

/** 人类建筑（地标除外）的残料：剩余 / 总量 */
export function humanSalvage(w) {
  let left = 0;
  let max = 0;
  for (const p of Object.values(w.places)) {
    if (p.origin !== 'human' || p.salvageMax <= 0) continue;
    left += p.salvage;
    max += p.salvageMax;
  }
  return { left, max, share: max > 0 ? left / max : null };
}

function buildReport(w, events, ops, meta) {
  const alive = agentList(w).filter(isAlive);
  const usage = {};
  for (const type of actionTable(w.premise || 0).ORDER) {
    const s = (w.$sandboxStats && w.$sandboxStats.actions[type]) || { ok: 0, fail: 0, errors: {} };
    usage[type] = { ok: s.ok, fail: s.fail, errors: s.errors || {}, ...(s.samples ? { samples: s.samples } : {}) };
  }
  const salvage = humanSalvage(w);
  const last = w.metrics[w.metrics.length - 1] || {};
  return {
    meta: { ...meta, worldDays: Math.floor(w.clock.tick / P.ticksPerDay), version: 2 },
    final: {
      alive: alive.length, awake: alive.filter((a) => a.status === 'awake').length, dormant: alive.filter((a) => a.status === 'dormant').length,
      dead: w.cemetery.length, retired: w.retired.length, unborn: w.unborn.length, agentsEver: Object.keys(w.agents).length,
      wellCondition: w.places.well.condition, treasuryEnergy: w.treasury.energy,
      places: Object.keys(w.places).length, agentPlaces: Object.values(w.places).filter((p) => p.origin === 'agent').length, razedPlaces: Object.values(w.places).filter((p) => p.razed).length,
      humanSalvageLeft: salvage.left, humanSalvageMax: salvage.max, humanSalvageShare: salvage.share,
      lawsPassed: Object.values(w.proposals).filter((p) => p.status === 'passed').length,
      lawsActive: Object.values(w.laws).filter((l) => l.status === 'active').length,
      rulesActive: last.rulesActive ?? null,
      refounds: Object.values(w.refounds).length, refoundsSucceeded: Object.values(w.refounds).filter((x) => x.status === 'succeeded').length,
      groups: Object.values(w.groups).filter((g) => !g.dissolved).length,
      charterArticles: w.charter.length, cityName: w.cityName,
    },
    metrics: w.metrics,
    laws: Object.values(w.laws).map((l) => ({ id: l.id, title: l.title, author: typeof l.author === 'string' ? l.author : l.author, enactedTick: l.enactedTick, status: l.status, procedure: !!l.procedure, rules: l.rules ? l.rules.length : 0 })),
    events,
    actionUsage: usage,
    templateUsage: (w.$sandboxStats && w.$sandboxStats.templates) || {},
    templateOutcomes: templateOutcomes(w),
    // deny 不产生 rule_op 事件（它拒绝一个动作）：每一次 forbidden 的失败就是一次施行
    opUsage: Object.fromEntries(RULE_OPS.map((op) => [op, op === 'deny' ? Object.values(usage).reduce((n, s) => n + (s.errors.forbidden || 0), 0) : ops[op] || 0])),
    weatherHistory: w.weather.history,
    legacy: w.legacy,
  };
}

/** 每个提案模板的结局：按标题认出模板，数一数通过、否决、作废的次数（调试沙盘脑的立法用） */
export function templateOutcomes(w) {
  const out = {};
  for (const p of Object.values(w.proposals)) {
    if (p.scope !== 'city') continue;
    const key = TITLE_KEYS.get(p.title) || 'other';
    const o = (out[key] ||= { passed: 0, rejected: 0, void: 0, open: 0 });
    o[p.status] = (o[p.status] || 0) + 1;
  }
  return out;
}

/** 覆盖要求（SPEC-E2 §23.2）：默认场景跑满 720 日后，返回没有满足的项（空数组 = 全部满足） */
export function coverageGaps(report) {
  const gaps = [];
  for (const [type, s] of Object.entries(report.actionUsage)) if (s.ok === 0) gaps.push(`动作 ${type} 从未成功`);
  for (const [op, n] of Object.entries(report.opUsage)) if (n === 0) gaps.push(`操作 ${op} 从未被施行`);
  if (!report.events.refounds.some((x) => x.kind === 'succeeded')) gaps.push('没有重订成功过');
  if (!report.events.procedures.some((x) => x.kind === 'replaced')) gaps.push('立法程序从未被更替');
  if (report.events.razed.length === 0) gaps.push('没有出现遗址');
  if (report.events.embodied.length === 0) gaps.push('没有躯壳醒来');
  return gaps;
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
    ['基础设施指数', 'infrastructureIndex'], ['在效法律', 'lawsActive'], ['在效规则', 'rulesActive'], ['规则节点数', 'ruleNodes'], ['维持费（当日）', 'upkeepPaid'],
    ['停摆的法律', 'lawsSuspended'], ['后人所建的比例', 'agentBuiltShare'], ['人类建筑残料（总）', 'salvageLeft'], ['躯壳在世', 'shellsUsed'], ['躯壳排队', 'shellQueue'],
    ['有志者的比例', 'purposeShare'], ['幕布曲线（世代 0 的比例）', 'humanAuthoredShare'],
  ];
  const f = (v) => (v === null || v === undefined ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(3));
  const fin = report.final;
  const ev = report.events;
  return [
    `# 第二纪沙盘推演摘要 · ${report.meta.scenario} · 种子 ${report.meta.seed}`,
    '',
    `- ${report.meta.days} 日，${report.meta.agents} 位沙盘先民，耗时 ${report.meta.elapsedMs} ms`,
    `- 账本守恒：${report.meta.conservationFailure ? `**失败**（第 ${report.meta.conservationFailure.day} 日）` : '每日精确成立'}`,
    `- 最终：在世 ${fin.alive}（醒 ${fin.awake} / 眠 ${fin.dormant}），累计入城 ${fin.agentsEver}，长眠 ${fin.dead}，归隐 ${fin.retired}，未生者 ${fin.unborn}`,
    `- 源井完好度 ${(fin.wellCondition / 100).toFixed(1)}%；地点 ${fin.places} 处（后人开辟 ${fin.agentPlaces}，遗址 ${fin.razedPlaces}）；人类建筑残料剩 ${fin.humanSalvageShare === null ? '—' : `${(fin.humanSalvageShare * 100).toFixed(1)}%`}`,
    `- 通过的法案 ${fin.lawsPassed} 部（在效 ${fin.lawsActive}，在效规则 ${fin.rulesActive}）；重订 ${fin.refounds} 次（成功 ${fin.refoundsSucceeded}）；社群 ${fin.groups} 个`,
    '',
    '| 曲线 | 最小 | 最大 | 中位数 |',
    '|---|---|---|---|',
    ...rows.map(([label, key]) => { const s = stat(col(key)); return `| ${label} | ${f(s.min)} | ${f(s.max)} | ${f(s.median)} |`; }),
    '',
    '## 重要事件',
    '',
    `- 第一次长眠：${ev.deaths.length ? `第 ${ev.deaths[0].day + 1} 日（${ev.deaths[0].name}）` : '无'}；长眠共 ${ev.deaths.length} 次`,
    `- 工程建成 ${ev.built.length} 座，烂尾 ${ev.abandoned.length} 个；拆解 ${ev.dismantles} 次，遗址 ${ev.razed.length} 处；躯壳醒来 ${ev.embodied.length} 次`,
    `- 法律 ${ev.laws.length} 部通过；立法程序更替 ${ev.procedures.filter((x) => x.kind === 'replaced').length} 次、自动回退 ${ev.procedures.filter((x) => x.kind === 'reverted').length} 次；重订发起 ${ev.refounds.filter((x) => x.kind === 'open').length} 次`,
    `- 天象 ${ev.weather.length} 次：${ev.weather.slice(0, 10).map((e) => `第 ${e.startDay + 1} 日${e.type}`).join('、')}${ev.weather.length > 10 ? '……' : ''}`,
    '',
    '## 动作使用次数（成功 / 失败）',
    '',
    Object.entries(report.actionUsage).map(([t, s]) => `${t} ${s.ok}/${s.fail}`).join(' · '),
    '',
    '## 规则操作的施行次数',
    '',
    Object.entries(report.opUsage).map(([t, n]) => `${t} ${n}`).join(' · '),
    '',
  ].join('\n');
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
    premise: o.premise === undefined ? 0 : Number(o.premise),
    shellSlots: o['shell-slots'] === undefined ? P.shellSlots : Number(o['shell-slots']),
    weather: o.weather,
    scenario: o.scenario || 'default',
    params: o.params ? JSON.parse(readFileSync(o.params, 'utf8')) : undefined,
  };
  const { report } = runSandbox(opts);
  const out = o.out || join('data', 'sandbox-e2', `${opts.scenario}-${opts.seed}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'metrics.csv'), metricsCsv(report.metrics));
  writeFileSync(join(out, 'report.json'), JSON.stringify(report));
  writeFileSync(join(out, 'summary.md'), summaryMarkdown(report));
  const f = report.final;
  console.log(`沙盘（第二纪）${opts.scenario} · 种子 ${opts.seed} · ${report.meta.worldDays} 日 · ${report.meta.elapsedMs} ms`);
  console.log(`在世 ${f.alive}（长眠 ${f.dead}，归隐 ${f.retired}）· 源井 ${(f.wellCondition / 100).toFixed(1)}% · 地点 ${f.places}（后人 ${f.agentPlaces}，遗址 ${f.razedPlaces}）· 法案 ${f.lawsPassed} · 躯壳醒来 ${report.events.embodied.length} · 输出 ${out}/`);
  if (opts.scenario === 'default' && report.meta.worldDays >= 720) {
    const gaps = coverageGaps(report);
    if (gaps.length) console.log(`覆盖要求未满足：${gaps.join('；')}`);
  }
  if (report.meta.conservationFailure) {
    console.error(`账本守恒失败（第 ${report.meta.conservationFailure.day} 日）：`, JSON.stringify(report.meta.conservationFailure.check));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
