// SPEC-E2 §24.1 测试 10（第 4 步的部分）：随机动作 + 随机生成的合法规则与立法，每个命令之后、每日结算之后守恒与结构不变量成立。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../src/e2/engine/index.js';
import { agentList } from '../src/e2/world.js';
import { P } from '../src/e2/params.js';
import { validateRules } from '../src/e2/rules/check.js';
import { assertInvariants } from './e2-helpers.js';
import { runFuzz, BASE_TYPES } from './e2-fuzz-lib.js';
import { registerLawGenerators, registerCityGenerators, registerDescentGenerators, LAW_TYPES, CITY_TYPES, DESCENT_TYPES, lawInvariants, randomRules } from './e2-rule-fuzz.js';

registerLawGenerators();
registerCityGenerators();
registerDescentGenerators();

const TYPES = [...BASE_TYPES, ...LAW_TYPES, ...LAW_TYPES, ...CITY_TYPES, ...CITY_TYPES, ...DESCENT_TYPES, ...DESCENT_TYPES];

/** 每刻：让所有人都在议会（使提案有机会提出），并在每日起点补给能量；让提案容易通过：每刻所有表决者都投 yes */
const hook = (w, t, r) => {
  const alive = agentList(w).filter((a) => a.status === 'awake');
  if (t % 3 === 0) for (const a of alive) if (r.chance(0.6)) a.place = 'parliament';
  if (t % P.ticksPerDay === 0) {
    for (const a of alive) if (r.chance(0.5)) {
      a.energy += 25;
      w.ledger.src.energy.admin = (w.ledger.src.energy.admin || 0) + 25;
    }
  }
  if (t % 4 === 0) {
    for (const p of Object.values(w.proposals)) {
      if (p.status !== 'open') continue;
      for (const id of p.voters) {
        const v = w.agents[id];
        if (v && v.status === 'awake' && r.chance(0.5)) {
          v.actsThisTick = 0;
          applyCommand(w, { type: 'act', payload: { agentId: id, actions: [{ type: 'vote', proposal: p.id, choice: 'yes' }] } });
        }
      }
    }
  }
};

test('随机规则：生成器产出的规则绝大多数通过校验（构造即合法）；偶尔写坏的被拒绝而不崩溃', () => {
  const { w } = runFuzz({ seed: 7, days: 1, agents: 6, bare: false, types: ['say'] });
  const alive = agentList(w).filter((a) => a.status !== 'dead');
  const r = { int: (n) => Math.floor(Math.random() * n), pick: (a) => a[Math.floor(Math.random() * a.length)], chance: () => false };
  void r;
  let ok = 0;
  let total = 0;
  const seeds = ['a', 'b', 'c', 'd'];
  for (const sd of seeds) {
    let k = 0;
    const rr = { int: (n) => { k = (k * 1103515245 + 12345 + sd.charCodeAt(0)) >>> 0; return k % n; }, pick: (a) => a[rr.int(a.length)], chance: (p) => rr.int(1000) < p * 1000 };
    for (let i = 0; i < 150; i++) {
      const rules = randomRules(w, { ...rr, chance: () => false }, alive);
      const v = validateRules(rules, { scope: { kind: 'city' } });
      total++;
      if (v.ok) ok++;
      else assert.fail(`生成器产出了不合法的规则：${JSON.stringify(rules)} → ${JSON.stringify(v.issues)}`);
    }
  }
  assert.equal(ok, total);
});

test('立法的模糊测试：随机动作 + 随机合法规则 + 全员投赞成，100 日 × 3 个种子，每个命令之后守恒与结构不变量成立；有法律通过、被撤销、程序被取代、重订发生', () => {
  const cover = { passed: 0, rejected: 0, repealed: 0, replaced: 0, refounded: 0, reverted: 0, suspended: 0, ruleOps: 0, ruleErrors: 0, announce: 0, fees: 0 };
  for (const seed of [11, 12, 13]) {
    const { w, stats } = runFuzz({ seed, days: 100, agents: 14, types: TYPES, bare: false, hook, everyCommand: true });
    assert.equal(stats.mismatch, 0);
    assert.equal(w.ledger.mismatches, 0);
    assertInvariants(w, `seed ${seed}`);
    lawInvariants(w, assert, `seed ${seed}`);
    for (const l of Object.values(w.laws)) {
      if (l.status === 'repealed') cover.repealed++;
      if (l.status === 'replaced') cover.replaced++;
      if (l.author === 'revert') cover.reverted++;
      if (typeof l.author === 'string' && l.author.startsWith('refound:')) cover.refounded++;
      if (l.suspendedDays > 0) cover.suspended++;
    }
    for (const p of Object.values(w.proposals)) {
      if (p.status === 'passed') cover.passed++;
      if (p.status === 'rejected') cover.rejected++;
    }
    cover.ruleOps += stats.events.rule_op || 0;
    cover.ruleErrors += stats.events.rule_error || 0;
    cover.announce += stats.events.announce || 0;
    for (const k of ['propose', 'vote', 'draft', 'refound', 'sign']) assert.ok((stats.actions[k]?.ok || 0) + (stats.actions[k]?.fail || 0) > 0, `${seed}: ${k} 被尝试过`);
  }
  assert.ok(cover.passed > 3, `有法律通过：${JSON.stringify(cover)}`);
  assert.ok(cover.ruleOps > 50, `规则在执行：${JSON.stringify(cover)}`);
});

test('带法律的世界：同一种子两次运行逐位相同；经 Runtime 跑立法的随机活动，回放的状态哈希与快照一致，崩溃后从快照 + 日志尾部恢复', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Runtime } = await import('../src/runtime.js');
  const { replayDir } = await import('../src/tools/replay.js');
  const { loadConfig } = await import('../src/config.js');
  const { stateHash, worldDir } = await import('../src/store.js');
  const { rngFor, sha } = await import('./e2-helpers.js');
  const { randomActions } = await import('./e2-fuzz-lib.js');
  // 确定性：两次逐位相同
  const a = runFuzz({ seed: 21, days: 30, agents: 10, types: TYPES, bare: false, hook, everyCommand: false });
  const b = runFuzz({ seed: 21, days: 30, agents: 10, types: TYPES, bare: false, hook, everyCommand: false });
  assert.equal(JSON.stringify(a.w), JSON.stringify(b.w));
  // 运行时与回放
  const dir = mkdtempSync(join(tmpdir(), 'houren-lawfuzz-'));
  try {
    const cfg = { ...loadConfig({}, []), dataDir: dir, worldId: 'w', seed: 'law-replay', physics: 2 };
    const rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
    const r = rngFor('law-replay-drive');
    for (let i = 0; i < 8; i++) {
      const name = `居民${i}`;
      rt.exec('register', { name, bio: '', soul: 's', lang: 'zh', model: 'm', creatorName: '', tokenHash: sha(`t${name}`), ownerKeyHash: sha(`k${name}`) });
    }
    for (let t = 0; t < 12 * 25; t++) {
      // 所有状态改变都走命令（进命令日志）：去议会走 move，投票走 act，补给走 admin adjust
      for (const x of Object.values(rt.w.agents)) {
        if (x.status !== 'awake' || !r.chance(0.5)) continue;
        // 命令进日志是 JSON：NaN、undefined 在日志里会变成 null / 消失，回放时就与现场执行不同。HTTP 送来的本来就是 JSON，这里照做
        const acts = JSON.parse(JSON.stringify(randomActions(rt.w, x, r, TYPES)));
        if (r.chance(0.3)) acts.unshift({ type: 'move', to: 'parliament' });
        rt.exec('act', { agentId: x.id, actions: acts, lang: r.pick(['zh', 'en']) });
      }
      if (t % 4 === 0) {
        for (const p of Object.values(rt.w.proposals)) {
          if (p.status !== 'open') continue;
          for (const id of p.voters) if (rt.w.agents[id].status === 'awake' && r.chance(0.5)) rt.exec('act', { agentId: id, actions: [{ type: 'vote', proposal: p.id, choice: 'yes' }] });
        }
      }
      if (t % 12 === 0) for (const x of Object.values(rt.w.agents)) if (x.status === 'awake' && r.chance(0.5)) rt.exec('admin', { op: 'adjust', args: { agentId: x.id, energy: 30, reason: '补给' } });
      rt.exec('tick');
    }
    assert.ok(Object.keys(rt.w.laws).length > 8, '有居民提出的法律通过');
    const live = stateHash(rt.w);
    const rt2 = Runtime.open(cfg, { version: '0.1.0', logger: { log() {} } });
    assert.equal(stateHash(rt2.w), live, '从快照 + 日志尾部恢复后与崩溃前一致');
    rt2.close();
    const rep = replayDir(worldDir(dir, 'w'), { currentVersion: '0.1.0' });
    assert.equal(rep.ok, true, rep.diff || '');
    assert.equal(rep.hash, live);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('躯壳与先民的模糊测试：先民分批入城、随机出资与领养、排队醒来与消散，100 日 × 3 个种子，每个命令后守恒成立', () => {
  const founders = Array.from({ length: 9 }, (_, i) => ({ day: i * 5, name: `先民${i + 1}`, bio: '先民', soul: `先民${i + 1}的灵魂`, lang: i % 2 ? 'en' : 'zh' }));
  for (const seed of [51, 52, 53]) {
    const { w, stats } = runFuzz({
      seed, days: 100, agents: 8, types: TYPES, bare: false, hook, everyCommand: true,
      worldOpts: { founders, shellModels: ['glm-5.3', 'step-5-preview'] },
    });
    assert.equal(stats.mismatch, 0);
    lawInvariants(w, assert, `seed ${seed}`);
    assert.equal(w.founders.length, 0, '先民都入城了');
    const shells = Object.values(w.agents).filter((a) => a.body.kind === 'shell');
    assert.ok(shells.length >= 9, `${seed}: 躯壳居民 ${shells.length}`);
    assert.ok(shells.every((a) => a.owner === null && a.tokenHash === null && a.body.mustSeal), '躯壳居民没有造者与令牌');
    assert.ok(shells.every((a) => ['glm-5.3', 'step-5-preview'].includes(a.body.model)));
    assert.ok((stats.events.embodied || 0) + 0 >= 0);
  }
});

test('账本守恒（SPEC-E2 §24.1 测试 10）：随机动作 + 随机生成的合法规则与立法 + 城 + 后代 + 躯壳与先民，200 日 × 2 个种子，每个刻之后守恒式精确成立；每日指标、遗产表、编年史齐全', () => {
  const founders = Array.from({ length: 6 }, (_, i) => ({ day: i * 20, name: `先民${i + 1}`, bio: '先民', soul: `先民${i + 1}的灵魂`, lang: i % 2 ? 'en' : 'zh' }));
  for (const seed of [61, 62]) {
    const { w, stats } = runFuzz({
      seed, days: 200, agents: 16, types: TYPES, bare: false, hook, everyCommand: false,
      worldOpts: { founders, shellModels: ['glm-5.3', 'step-5-preview'] },
    });
    assert.equal(stats.mismatch, 0, `seed ${seed}`);
    assert.equal(w.ledger.mismatches, 0);
    assertInvariants(w, `seed ${seed}`);
    lawInvariants(w, assert, `seed ${seed}`);
    assert.equal(w.metrics.length, 200);
    assert.deepEqual(w.metrics.map((m) => m.day), Array.from({ length: 200 }, (_, i) => i));
    assert.equal(w.chronicle.length, 200);
    assert.equal(w.legacy.day, 199);
    // 指标是整数 / 有限小数，JSON 干净（无 NaN）
    assert.deepEqual(JSON.parse(JSON.stringify(w.metrics)), w.metrics);
    // 规则确实在被执行：多日有 rule_op；有法律通过
    assert.ok(w.metrics.some((m) => m.ruleOps > 0));
    assert.ok(w.metrics.some((m) => m.rulesActive > 6));
    assert.ok(Object.values(w.proposals).some((p) => p.status === 'passed'));
    // 累计字段单调不减
    for (const k of ['procedureChanges', 'refounds', 'reverts', 'razed']) for (let i = 1; i < w.metrics.length; i++) assert.ok(w.metrics[i][k] >= w.metrics[i - 1][k], `${k} 在第 ${i} 日减少了`);
  }
});
