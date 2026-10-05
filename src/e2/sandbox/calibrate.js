// SPEC-E2 §23.3：第二纪的标定脚本。把 default / laissez / stress 三个场景各跑若干个种子（默认 1–5），
// 按规格的目标逐项判定（取种子的中位数），并把结果写成 JSON 与 Markdown 表格。
//
//   node src/e2/sandbox/calibrate.js [--seeds 1,2,3,4,5] [--days 720] [--agents 24]
//     [--scenarios default,laissez,stress] [--params file.json] [--label baseline] [--out docs/calibration-e2/<label>.json] [--md]
//
// 判定只用来发现问题：任何一项不满足，都把数据写进 docs/QUESTIONS.md 并提出参数修改建议——
// 不要自行修改默认参数（SPEC-E2 §23.3）。--params 是试算建议用的覆盖，不会写回任何默认值。
// 口径按 docs/QUESTIONS.md Q25（已决定 A）与 SPEC-E2 §23.3 的原文有两处不同：default 的「公库与源井同时为 0」改为判定
// 「长眠后 120 日内的最低在世人口 ≥ 8」（原指标保留为信息项，只报告、不判定）；laissez 的残料目标改为「≥ 95%（遗法 l6 守着）」。
// 每次运行放在一个 worker 线程里（各线程各有一份 P 与沙盘配置，互不串扰），所以可以并行。

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSandbox, SCENARIOS, coverageGaps } from './run.js';

// ── 单次运行的精简摘要 ───────────────────────────────────────────

export function median(xs) {
  const v = xs.filter((x) => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** 第一位居民长眠（死亡）之后的 window 日内，公库能量与源井完好度同时为 0 的日数；没有人长眠过为 0 */
export function bothZeroAfterFirstDeath(report, window = 120) {
  const d0 = report.events.deaths.length ? report.events.deaths[0].day : null;
  if (d0 === null) return 0;
  let n = 0;
  for (const m of report.metrics) if (m.day >= d0 && m.day <= d0 + window && m.treasuryEnergy === 0 && m.wellCondition === 0) n++;
  return n;
}

/**
 * 第一位居民长眠（死亡）之后的 window 日内，最低的在世人口（醒着 + 沉睡）；窗口超出模拟范围时取到模拟结束为止。
 * 没有人长眠过：取整段运行里最低的在世人口（城没有损失过人，条件自然满足）。
 */
export function minAliveAfterFirstDeath(report, window = 120) {
  const d0 = report.events.deaths.length ? report.events.deaths[0].day : null;
  const alive = report.metrics.filter((m) => d0 === null || (m.day >= d0 && m.day <= d0 + window)).map((m) => m.awake + m.dormant);
  return alive.length ? Math.min(...alive) : null;
}

/** 从一次运行的 report 里取出判定需要的量（不含大数组，只留三条日序列） */
export function summarize(report, { seed, scenario, agents, premise = 0 }) {
  const m = report.metrics;
  const alive = m.map((x) => x.awake + x.dormant);
  const treasury = m.map((x) => x.treasuryEnergy);
  const well = m.map((x) => x.wellCondition);
  const firstDay = (pred) => {
    const i = m.findIndex(pred);
    return i < 0 ? null : m[i].day;
  };
  const shocks = report.events.weather
    .filter((e) => e.type === 'drought' || e.type === 'quake')
    .map((e) => ({ type: e.type, startDay: e.startDay, endDay: e.endDay }));
  const gaps = scenario === 'default' && report.meta.worldDays >= 720 ? coverageGaps(report) : [];
  return {
    seed: Number(seed),
    scenario,
    initial: agents,
    days: report.meta.worldDays,
    alive: report.final.alive,
    awake: report.final.awake,
    dead: report.final.dead,
    retired: report.final.retired,
    agentsEver: report.final.agentsEver,
    peak: Math.max(...alive),
    minAlive: Math.min(...alive),
    wellMedian: median(well),
    wellFinal: report.final.wellCondition,
    wellFirstLe2000: firstDay((x) => x.wellCondition <= 2000),
    wellFirstZero: firstDay((x) => x.wellCondition === 0),
    firstDeathDay: report.events.deaths.length ? report.events.deaths[0].day : null,
    minAliveAfterDeath: minAliveAfterFirstDeath(report),
    bothZero: bothZeroAfterFirstDeath(report), // 信息项（Q25：不再判定）
    embodied: report.events.embodied.length,
    humanSalvageShare: report.final.humanSalvageShare,
    rulesMedian: median(m.map((x) => x.rulesActive)),
    rationMedian: median(m.filter((x) => x.awake > 0).map((x) => x.rationPerCapita)),
    agentPlaces: report.final.agentPlaces,
    razed: report.events.razed.length,
    lawsPassed: report.final.lawsPassed,
    refoundsSucceeded: report.final.refoundsSucceeded,
    procedures: report.events.procedures.filter((x) => x.kind === 'replaced').length,
    coverageGaps: gaps,
    shocks,
    series: { alive, treasury, well },
    elapsedMs: report.meta.elapsedMs,
    conservationFailure: report.meta.conservationFailure,
    ...(report.p1 ? { premise: premise || 1, stateHash: report.p1.stateHash, memoryByDormancy: report.p1.memoryByDormancy, livingMemoryByDormancy: report.p1.livingMemoryByDormancy } : {}),
  };
}

/** stress：每次冲击结束后 30 日内，人口与公库是否都回到冲击前的 80% 以上 */
export function shockRecoveries(run) {
  const { alive, treasury } = run.series;
  const out = [];
  for (const s of run.shocks) {
    const pre = s.startDay - 1;
    if (pre < 0 || s.endDay + 30 > alive.length - 1) continue; // 没有冲击前的基线，或观察窗口超出模拟范围
    if (alive[pre] === 0) continue;
    let recovered = false;
    for (let t = s.endDay + 1; t <= s.endDay + 30 && !recovered; t++) {
      recovered = alive[t] >= 0.8 * alive[pre] && treasury[t] >= 0.8 * treasury[pre];
    }
    out.push({ ...s, popBefore: alive[pre], treasuryBefore: treasury[pre], recovered });
  }
  return out;
}

// ── 目标判定（§23.3，口径按 Q25） ─────────────────────────────────

/** 返回 [{ name, target, values: [每个种子的值], value: 中位数, pass }]；pass 为 null 的是信息项（只报告，不判定） */
export function evaluate(scenario, runs) {
  if (runs.some((r) => r.premise >= 1)) {
    const item = (name, target, values, test) => ({ name, target, values, value: median(values), pass: test ? values.every(test) : null });
    const out = [
      item('账本守恒', '所有种子无失败', runs.map((r) => r.conservationFailure === null ? 1 : 0), (x) => x === 1),
      item('同种子两次状态哈希一致', '所有种子一致', runs.map((r) => r.deterministic ? 1 : 0), (x) => x === 1),
    ];
    if (scenario === 'default') out.unshift(item('720 日内最低在世人口', '每个种子 ≥ 8', runs.map((r) => r.minAlive), (x) => x >= 8));
    if (scenario === 'laissez') {
      out.unshift(item('沉睡过者平均记忆分量（全部已创建居民）', '只报告', runs.map((r) => r.memoryByDormancy.everDormant.mean)), item('未沉睡者平均记忆分量（全部已创建居民）', '只报告', runs.map((r) => r.memoryByDormancy.neverDormant.mean)));
    }
    return out;
  }
  const per = (f) => runs.map(f);
  // 判定用的是精确的中位数；记录时保留两位小数（59.5 不能被四舍五入成 60 而看起来达标）
  const check = (name, target, values, ok) => {
    const value = median(values);
    return { name, target, values, value: value === null ? null : Number(value.toFixed(2)), pass: value !== null && ok(value) };
  };
  const info = (name, values) => {
    const value = median(values);
    return { name, target: '信息项，不判定', values, value: value === null ? null : Number(value.toFixed(2)), pass: null };
  };
  if (scenario === 'default') {
    return [
      check('第一位居民长眠后 120 日内的最低在世人口', '≥ 8', per((r) => r.minAliveAfterDeath), (v) => v >= 8),
      check('第 720 日的人口', '≥ 8', per((r) => r.alive), (v) => v >= 8),
      check('躯壳醒来的次数', '≥ 3', per((r) => r.embodied), (v) => v >= 3),
      check('人类建筑的残料在第 720 日的剩余比例', '≥ 0.2', per((r) => r.humanSalvageShare), (v) => v >= 0.2),
      check('在效规则数的中位数', '5–40', per((r) => r.rulesMedian), (v) => v >= 5 && v <= 40),
      info('第一位居民长眠后 120 日内，公库能量与源井完好度同时为 0 的日数', per((r) => r.bothZero)),
    ];
  }
  if (scenario === 'laissez') {
    const initial = runs.length ? runs[0].initial : 24;
    return [
      check('源井降到下限（完好度 ≤ 20%）的日子', '60–120', per((r) => r.wellFirstLe2000), (v) => v >= 60 && v <= 120),
      check('人类建筑的残料在第 720 日的剩余比例（遗法 l6 守着）', '≥ 0.95', per((r) => r.humanSalvageShare), (v) => v >= 0.95),
      check(`第 720 日的人口（显著下降但不灭绝：≤ ${initial / 2}）`, `1–${initial / 2}`, per((r) => r.alive), (v) => v >= 1 && v <= initial / 2),
    ];
  }
  // stress
  const fractions = per((r) => {
    const rec = shockRecoveries(r);
    return rec.length ? rec.filter((x) => x.recovered).length / rec.length : null;
  });
  return [check('30 日内恢复到冲击前 80% 以上的冲击比例', '≥ 0.5', fractions, (v) => v >= 0.5)];
}

// ── 并行运行 ───────────────────────────────────────────────────

function runInWorker(job) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: job });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exited with code ${code}`));
    });
  });
}

/** 并行度受限的 map */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

/**
 * 跑一组标定。opts：{ seeds, days, agents, scenarios, params, label }
 * 返回 { label, opts, runs: { scenario: [summary] }, verdicts: { scenario: [criterion] } }
 */
export async function calibrate({ seeds = [1, 2, 3, 4, 5], days = 720, agents = 24, scenarios = SCENARIOS, params, label = 'baseline', premise = 0, shellSlots } = {}) {
  const jobs = [];
  for (const scenario of scenarios) for (const seed of seeds) jobs.push({ scenario, seed, days, agents, params, premise, shellSlots });
  const done = await pool(jobs, Math.max(1, availableParallelism() - 1), runInWorker);
  const runs = {};
  for (const r of done) (runs[r.scenario] ||= []).push(r);
  const verdicts = {};
  for (const scenario of scenarios) {
    runs[scenario].sort((a, b) => a.seed - b.seed);
    verdicts[scenario] = evaluate(scenario, runs[scenario]);
  }
  return { label, opts: { seeds, days, agents, scenarios, params: params || null, ...(premise >= 1 ? { premise, shellSlots } : {}) }, runs, verdicts };
}

// ── 输出 ───────────────────────────────────────────────────────

const fmt = (v) => (v === null || v === undefined ? '—' : Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));

export function markdownTables(result) {
  const lines = [];
  for (const scenario of result.opts.scenarios) {
    const runs = result.runs[scenario];
    lines.push(`#### ${scenario}（种子 ${runs.map((r) => r.seed).join('、')}）`, '');
    lines.push('| 目标 | 要求 | 各种子 | 中位数 | 判定 |', '|---|---|---|---|---|');
    for (const c of result.verdicts[scenario]) {
      lines.push(`| ${c.name} | ${c.target} | ${c.values.map(fmt).join(' / ')} | ${fmt(c.value)} | ${c.pass === null ? '—' : c.pass ? '✓' : '✗'} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function runTable(result) {
  const lines = ['| 场景 | 种子 | 末日在世 | 峰值 | 长眠 | 归隐 | 首次长眠（日） | 源井首次 ≤20%（日） | 躯壳醒来 | 后人地点 | 遗址 | 法案 | 重订成功 | 程序更替 | 耗时 ms |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const scenario of result.opts.scenarios) {
    for (const r of result.runs[scenario]) {
      lines.push(`| ${scenario} | ${r.seed} | ${r.alive} | ${r.peak} | ${r.dead} | ${r.retired} | ${fmt(r.firstDeathDay)} | ${fmt(r.wellFirstLe2000)} | ${r.embodied} | ${r.agentPlaces} | ${r.razed} | ${r.lawsPassed} | ${r.refoundsSucceeded} | ${r.procedures} | ${r.elapsedMs} |`);
    }
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const k = a.slice(2);
    if (k === 'md') {
      o.md = true;
      continue;
    }
    const v = argv[++i];
    if (v === undefined) throw new Error(`--${k} needs a value`);
    o[k] = v;
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const result = await calibrate({
    seeds: o.seeds ? o.seeds.split(',').map(Number) : undefined,
    days: o.days ? Number(o.days) : undefined,
    agents: o.agents ? Number(o.agents) : undefined,
    scenarios: o.scenarios ? o.scenarios.split(',') : undefined,
    params: o.params ? JSON.parse(readFileSync(o.params, 'utf8')) : undefined,
    label: o.label,
    premise: o.premise === undefined ? 0 : Number(o.premise),
    shellSlots: o['shell-slots'] === undefined ? undefined : Number(o['shell-slots']),
  });
  if (o.out) {
    mkdirSync(dirname(o.out), { recursive: true });
    // 日序列很长，落盘时去掉；需要时可重跑
    const slim = JSON.parse(JSON.stringify(result));
    for (const list of Object.values(slim.runs)) for (const r of list) delete r.series;
    writeFileSync(o.out, JSON.stringify(slim, null, 1));
  }
  console.log(runTable(result));
  console.log('');
  console.log(markdownTables(result));
  const gaps = (result.runs.default || []).filter((r) => r.coverageGaps.length);
  for (const r of gaps) console.log(`覆盖要求未满足（default#${r.seed}）：${r.coverageGaps.join('；')}`);
  const broken = Object.values(result.runs).flat().filter((r) => r.conservationFailure);
  if (broken.length) {
    console.error(`账本守恒失败：${broken.map((r) => `${r.scenario}#${r.seed}`).join(', ')}`);
    process.exit(1);
  }
}

// ── worker 入口 ────────────────────────────────────────────────

if (!isMainThread && workerData && workerData.scenario) {
  const { scenario, seed, days, agents, params, premise = 0, shellSlots } = workerData;
  const { report } = runSandbox({ scenario, seed, days, agents, params, premise, shellSlots });
  const summary = summarize(report, { seed, scenario, agents, premise });
  if (premise >= 1) {
    const again = runSandbox({ scenario, seed, days, agents, params, premise, shellSlots });
    summary.deterministic = report.p1.stateHash === again.report.p1.stateHash;
  }
  parentPort.postMessage(summary);
} else if (isMainThread && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
