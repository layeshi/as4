// 测试 10（SPEC §18.1）：沙盘。default 场景 720 日跑完、守恒成立、动作覆盖满足；
// 另加：确定性、三个场景各自的特征、沙盘脑的语言与性情、报告格式，以及标定脚本的判定函数。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotP, restoreP, configureWeather } from '../src/params.js';
import { agentList } from '../src/world.js';
import { ACTION_ORDER } from '../src/lore/index.js';
import { checkConservation } from '../src/engine/ledger.js';
import { stateHash } from '../src/store.js';
import { runSandbox, metricsCsv, summaryMarkdown, stressSchedule, SCENARIOS } from '../src/sandbox/run.js';
import { configureSandbox, TEMPERAMENTS } from '../src/sandbox/brains.js';
import { median, summarize, shockRecoveries, evaluate } from '../src/sandbox/calibrate.js';

const savedP = snapshotP();
after(() => {
  restoreP(savedP);
  configureSandbox({ scenario: 'default' });
  configureWeather({ mode: 'random' });
});

// ── default 场景：720 日 ───────────────────────────────────────

let full;
before(() => {
  full = runSandbox({ days: 720, agents: 24, seed: 1 });
});

test('default 场景：720 日跑完，账本每日守恒，60 秒内完成', () => {
  const { world, report } = full;
  assert.equal(report.meta.conservationFailure, null);
  assert.equal(report.meta.worldDays, 720);
  assert.equal(world.ledger.mismatches, 0);
  assert.equal(checkConservation(world).ok, true);
  assert.equal(report.metrics.length, 720);
  assert.ok(report.meta.elapsedMs < 60000, `耗时 ${report.meta.elapsedMs} ms`);
  assert.equal(report.meta.scenario, 'default');
});

test('default 场景：PROTOCOL §4 中的每一种动作至少被成功执行一次', () => {
  const { report } = full;
  assert.deepEqual(Object.keys(report.actionUsage), [...ACTION_ORDER]);
  const never = Object.entries(report.actionUsage).filter(([, s]) => s.ok === 0).map(([t]) => t);
  assert.deepEqual(never, [], `从未成功过的动作：${never.join(', ')}`);
});

test('沙盘脑只提合法的动作：失败率很低，且失败的多是竞争（交易被抢先、提案已满）', () => {
  const { report } = full;
  let ok = 0;
  let fail = 0;
  for (const s of Object.values(report.actionUsage)) {
    ok += s.ok;
    fail += s.fail;
  }
  assert.ok(ok > 10000, `成功 ${ok}`);
  assert.ok(fail / (ok + fail) < 0.02, `失败率 ${(fail / (ok + fail)).toFixed(4)}`);
});

test('领养：沙盘脑生出的孩子被领养后也是沙盘脑，累计入城人数超过初始的 24', () => {
  const { world, report } = full;
  assert.ok(report.final.agentsEver > 24);
  const kids = agentList(world).filter((a) => a.body.kind === 'sandbox' && a.bornDay > 0);
  assert.ok(kids.length >= 1);
  for (const k of kids) {
    assert.ok(TEMPERAMENTS.includes(k.body.temperament));
    assert.equal(k.owner, null);
  }
});

test('报告：report.json 的结构、metrics.csv 与 summary.md', () => {
  const { report } = full;
  for (const k of ['meta', 'final', 'metrics', 'laws', 'events', 'actionUsage', 'weatherHistory', 'legacy']) assert.ok(k in report, k);
  assert.ok(Array.isArray(report.events.built) && Array.isArray(report.events.deaths) && Array.isArray(report.events.laws));
  JSON.parse(JSON.stringify(report)); // 可序列化
  const csv = metricsCsv(report.metrics);
  const lines = csv.trimEnd().split('\n');
  assert.equal(lines.length, 721); // 表头 + 720 日
  assert.deepEqual(lines[0].split(','), Object.keys(report.metrics[0]));
  assert.ok(/"\{""(han|latin)"":\d+/.test(csv), '对象值应写成带转义引号的 JSON 字符串');
  const md = summaryMarkdown(report);
  assert.ok(md.startsWith('# 沙盘推演摘要 · default · 种子 1'));
  for (const h of ['## 重要事件', '## 动作使用次数（成功 / 失败）', '人均配给', '源井完好度']) assert.ok(md.includes(h), h);
});

test('前 24 个沙盘脑：九种性情都有；语言约三分之一英文、六分之一西班牙文，其余中文', () => {
  const first = agentList(full.world).slice(0, 24);
  assert.equal(new Set(first.map((a) => a.body.temperament)).size, 9);
  const langs = { zh: 0, en: 0, es: 0 };
  for (const a of first) langs[a.lang]++;
  assert.deepEqual(langs, { zh: 12, en: 8, es: 4 });
  for (const a of first) {
    assert.equal(a.body.kind, 'sandbox');
    assert.equal(a.body.model, 'sandbox');
    assert.equal(a.owner, null);
  }
});

// ── 确定性 ─────────────────────────────────────────────────────

test('确定性：同种子的两次沙盘推演最终状态哈希相同，不同种子不同', () => {
  const a = runSandbox({ days: 60, agents: 12, seed: 7 });
  const b = runSandbox({ days: 60, agents: 12, seed: 7 });
  const c = runSandbox({ days: 60, agents: 12, seed: 8 });
  assert.equal(stateHash(a.world), stateHash(b.world));
  assert.notEqual(stateHash(a.world), stateHash(c.world));
  assert.deepEqual(a.report.metrics, b.report.metrics);
});

// ── 三个场景 ───────────────────────────────────────────────────

test('laissez：从不提案、从不修缮、从不出工、不发起工程，但会汲取', () => {
  const { report } = runSandbox({ days: 150, agents: 24, seed: 2, scenario: 'laissez' });
  assert.equal(report.meta.conservationFailure, null);
  for (const t of ['propose', 'repair', 'contribute', 'initiate']) {
    assert.deepEqual(report.actionUsage[t], { ok: 0, fail: 0 }, t);
  }
  assert.ok(report.actionUsage.draw.ok > 0);
  assert.equal(report.final.facilities, 0);
  assert.equal(report.final.lawsPassed, 0);
});

test('laissez 与 default 是同一批沙盘脑：只差公共事务（同种子、开局前几日的行为一致）', () => {
  const d = runSandbox({ days: 2, agents: 24, seed: 3, scenario: 'default' });
  const l = runSandbox({ days: 2, agents: 24, seed: 3, scenario: 'laissez' });
  assert.deepEqual(agentList(d.world).map((a) => a.name), agentList(l.world).map((a) => a.name));
  assert.deepEqual(agentList(d.world).map((a) => a.body.temperament), agentList(l.world).map((a) => a.body.temperament));
});

test('stress：每个月一次旱或震（交替），天象按文件排期而非随机', () => {
  assert.deepEqual(stressSchedule(3).map((s) => s.type), ['drought', 'quake', 'drought']);
  for (const s of stressSchedule(4)) assert.equal(s.dayOfMonth, 10);
  const { report } = runSandbox({ days: 130, agents: 12, seed: 4, scenario: 'stress' });
  assert.equal(report.meta.conservationFailure, null);
  const types = report.events.weather.map((e) => e.type);
  assert.ok(types.length >= 5, `天象 ${types.join(',')}`);
  assert.ok(types.every((t) => t === 'drought' || t === 'quake'), `只有旱与震：${types.join(',')}`);
  assert.ok(types.includes('drought') && types.includes('quake'));
  // 每月第 10 日开始：startDay 落在 24 日一个月的第 10 日
  for (const e of report.events.weather) assert.equal(e.startDay % 24, 10);
});

test('场景名不合法时报错；--laws 覆盖法律参数的初始值，未知参数报错', () => {
  assert.deepEqual([...SCENARIOS], ['default', 'laissez', 'stress']);
  assert.throws(() => runSandbox({ days: 1, scenario: 'chaos' }), /unknown scenario/);
  const { world } = runSandbox({ days: 2, agents: 6, seed: 1, laws: { rationShare: 0.9, drawQuotaPerDay: 5 } });
  assert.equal(world.params.rationShare, 0.9);
  assert.equal(world.params.drawQuotaPerDay, 5);
  assert.throws(() => runSandbox({ days: 1, laws: { nonsense: 1 } }), /unknown law parameter/);
});

test('--params 覆盖物理参数，且不会写回默认值以外的地方（P 在测试后还原）', () => {
  const { world } = runSandbox({ days: 5, agents: 6, seed: 1, params: { wellBaseOutput: 300 } });
  assert.equal(world.metrics[0].output, 300);
  assert.throws(() => runSandbox({ days: 1, params: { notAParameter: 1 } }), /unknown parameter/);
  restoreP(savedP);
});

// ── 标定脚本的判定函数 ─────────────────────────────────────────

test('calibrate：median', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([1, null, undefined, 5, NaN]), 3);
});

const run = (o = {}) => ({
  seed: 1, scenario: 'default', initial: 24, alive: 20, rationMedian: 12, deathsBy400: 3, wellMedian: 6000, wellFirstLe2000: 90,
  built: 5, lawsPassed: 7, shocks: [], series: { alive: [], treasury: [], well: [] }, ...o,
});

test('calibrate：default 的六项目标与边界', () => {
  const pass = evaluate('default', [run(), run(), run()]);
  assert.equal(pass.length, 6);
  assert.ok(pass.every((c) => c.pass), JSON.stringify(pass.filter((c) => !c.pass)));
  const byName = (rs, name) => evaluate('default', rs).find((c) => c.name.includes(name));
  // 边界：人口恰好 8 与 120 通过，7 与 121 不通过
  assert.equal(byName([run({ alive: 8 })], '人口').pass, true);
  assert.equal(byName([run({ alive: 120 })], '人口').pass, true);
  assert.equal(byName([run({ alive: 7 })], '人口').pass, false);
  assert.equal(byName([run({ alive: 121 })], '人口').pass, false);
  // 取的是种子的中位数：五个种子里三个通过即通过
  assert.equal(byName([1, 1, 1, 50, 50].map((n) => run({ alive: n })), '人口').pass, false);
  assert.equal(byName([1, 1, 20, 20, 20].map((n) => run({ alive: n })), '人口').pass, true);
  assert.equal(byName([run({ wellMedian: 4000 })], '源井').pass, true);
  assert.equal(byName([run({ wellMedian: 3999 })], '源井').pass, false);
  assert.equal(byName([run({ rationMedian: 5.9 })], '配给').pass, false);
  assert.equal(byName([run({ rationMedian: 20 })], '配给').pass, true);
  assert.equal(byName([run({ deathsBy400: 0 })], '死亡').pass, false);
  assert.equal(byName([run({ built: 2 })], '设施').pass, false);
  assert.equal(byName([run({ lawsPassed: 4 })], '法律').pass, false);
});

test('calibrate：laissez 的两项目标（降到下限的日子 60–120；人口显著下降但不灭绝）', () => {
  const laissez = (o) => evaluate('laissez', [run({ scenario: 'laissez', ...o })]);
  assert.ok(laissez({ wellFirstLe2000: 60, alive: 5 }).every((c) => c.pass));
  assert.equal(laissez({ wellFirstLe2000: 59, alive: 5 })[0].pass, false);
  assert.equal(laissez({ wellFirstLe2000: 120, alive: 5 })[0].pass, true);
  assert.equal(laissez({ wellFirstLe2000: 121, alive: 5 })[0].pass, false);
  assert.equal(laissez({ wellFirstLe2000: null, alive: 5 })[0].pass, false); // 从未降到下限
  assert.equal(laissez({ wellFirstLe2000: 90, alive: 0 })[1].pass, false); // 灭绝
  assert.equal(laissez({ wellFirstLe2000: 90, alive: 13 })[1].pass, false); // 没有显著下降
  assert.equal(laissez({ wellFirstLe2000: 90, alive: 12 })[1].pass, true);
});

test('calibrate：stress——冲击结束后 30 日内人口与公库都回到冲击前的 80% 以上', () => {
  const days = 200;
  const alive = new Array(days).fill(20);
  const treasury = new Array(days).fill(100);
  // 冲击 A：第 20–20 日；人口在第 30 日跌到 10，第 40 日恢复到 18（≥ 16）——公库同时恢复 → 恢复
  for (let d = 21; d < 40; d++) alive[d] = 10;
  for (let d = 40; d < days; d++) alive[d] = 18;
  // 冲击 B：第 100 日；人口回不到 16（只有 14），且一直如此 → 不算恢复
  for (let d = 101; d < days; d++) alive[d] = 14;
  // 冲击 C：第 150 日；人口不变，但公库始终低于 80 → 不算恢复
  for (let d = 151; d < days; d++) treasury[d] = 79;
  const shocks = [
    { type: 'drought', startDay: 20, endDay: 20 },
    { type: 'quake', startDay: 100, endDay: 100 },
    { type: 'drought', startDay: 150, endDay: 152 },
    { type: 'quake', startDay: 180, endDay: 180 }, // 窗口超出模拟范围（180 + 30 > 199）→ 不参与判定
  ];
  const r = run({ scenario: 'stress', series: { alive, treasury, well: [] }, shocks });
  const rec = shockRecoveries(r);
  assert.deepEqual(rec.map((x) => [x.type, x.startDay, x.recovered]), [['drought', 20, true], ['quake', 100, false], ['drought', 150, false]]);
  assert.equal(rec[0].popBefore, 20);
  assert.equal(rec[0].treasuryBefore, 100);
  const verdict = evaluate('stress', [r])[0];
  assert.equal(verdict.value, 0.33);
  assert.equal(verdict.pass, false);
  // 只剩恢复了的那次：比例 1，通过；恰好 0.5 也通过
  assert.equal(evaluate('stress', [{ ...r, shocks: [shocks[0]] }])[0].pass, true);
  assert.equal(evaluate('stress', [{ ...r, shocks: [shocks[0], shocks[1]] }])[0].pass, true);
  // 冲击前没有人：不参与判定
  assert.deepEqual(shockRecoveries(run({ series: { alive: [0, 0, 0, 0, 0], treasury: [0, 0, 0, 0, 0], well: [] }, shocks: [{ type: 'quake', startDay: 1, endDay: 1 }] })), []);
});

test('calibrate：summarize 从一次 report 里取出判定所需的量', () => {
  const s = summarize(full.report, { seed: 1, scenario: 'default', agents: 24 });
  assert.equal(s.seed, 1);
  assert.equal(s.days, 720);
  assert.equal(s.series.alive.length, 720);
  assert.equal(s.alive, full.report.final.alive);
  assert.equal(s.built, full.report.events.built.length);
  assert.equal(s.deathsBy400, full.report.events.deaths.filter((e) => e.day < 400).length);
  assert.ok(s.peak >= 24);
  assert.ok(s.wellFirstLe2000 === null || s.wellFirstLe2000 >= 0);
});
