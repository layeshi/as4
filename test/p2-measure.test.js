import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TotalBudget, classifyReply, summarizePhase, runMeasurement } from '../src/tools/p2-measure.js';

test('测量总预算跨两轮共用；并发预留、未知用量、失败与重启均不会重置余额', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p2-measure-budget-'));
  try {
    const file = join(dir, 'budget.json');
    const b = new TotalBudget({ cap: 1000, file });
    assert.equal(b.reserve('a1', 600), true);
    assert.equal(b.reserve('a2', 500), false);
    b.settle('a1', { input: 200, output: 100 });
    assert.equal(b.charged, 300);
    assert.equal(b.reserve('a2', 600), true);
    b.cancel('a2');
    assert.equal(b.charged, 300);
    assert.equal(b.reserve('a2', 600), true);
    b.settle('a2', null); // 用量未返回时保守扣掉全部预留
    assert.equal(b.charged, 900);
    assert.equal(b.reserve('a3', 101), false);
    assert.equal(b.reserved, 0);
    const again = new TotalBudget({ cap: 1000, file });
    assert.equal(again.charged, 900);
    assert.throws(() => new TotalBudget({ cap: 2000, file }), /cap/);
    // 重启时不能把在途请求的潜在费用忘掉。
    assert.equal(again.reserve('a3', 100), true);
    assert.equal(new TotalBudget({ cap: 1000, file }).charged, 1000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('测量只记录格式与数量，不记录提示、回复、动作参数；格式失败、原生直接回复与非法工具区分', () => {
  assert.deepEqual(classifyReply('json', { text: '{"look":{"what":"proposal","id":"p1"}}' }), { attempts: 1, valid: 1, parseFailed: false, refusal: false, incomplete: false });
  assert.equal(classifyReply('json', { text: 'SECRET-REPLY' }).parseFailed, true);
  assert.equal(classifyReply('native', { calls: [] }).attempts, 0);
  assert.equal(classifyReply('native', { calls: [{ name: 'exec', args: { text: 'SECRET-ARG' } }] }).valid, 0);
  assert.equal(classifyReply('native', { calls: [{ name: 'look', args: null }] }).parseFailed, true);
  assert.equal(classifyReply('native', { stop: 'refusal', calls: [] }).refusal, true);
  assert.equal(classifyReply('native', { stop: 'length', calls: [] }).incomplete, true);
  assert.ok(!JSON.stringify(classifyReply('json', { text: 'SECRET-REPLY' })).includes('SECRET'));
});

test('测量汇总使用实际调用数作分母；截止取消独立统计；精确检查工具有效率与醒来截止', () => {
  const calls = [
    { model: 'step', ok: true, cancelled: false, attempts: 2, valid: 2, parseFailed: false, input: 200, output: 20 },
    { model: 'step', ok: true, cancelled: false, attempts: 1, valid: 0, parseFailed: true, input: 100, output: 10 },
    { model: 'step', ok: false, cancelled: false, attempts: 0, valid: 0, parseFailed: false, input: 0, output: 0 },
    { model: 'step', ok: false, cancelled: true, attempts: 0, valid: 0, parseFailed: false, input: 0, output: 0 },
  ];
  const wakings = [
    { model: 'step', turns: 2, kind: 'main', acts: [{ ok: true }, { ok: false }], beforeDeadline: true, lastCallMarginMs: 10000 },
    { model: 'step', turns: 1, kind: 'wake', acts: [], beforeDeadline: false, lastCallMarginMs: -1000 },
  ];
  const s = summarizePhase({ calls, wakings });
  assert.equal(s.totals.calls, 4);
  assert.equal(s.totals.cancelled, 1);
  assert.equal(s.totals.modelFailureRate, 2 / 3);
  assert.equal(s.totals.toolValidRate, 2 / 3);
  assert.equal(s.totals.beforeDeadlineRate, 0.5);
  assert.equal(s.totals.actionFailureRate, 0.5);
  assert.equal(s.models.step.wakes, 1);
});

test('测量 mock 冒烟：两种模式、真实调度与十位先民；总预算、无文本遥测、重启回放、进度与报告', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'p2-measure-smoke-'));
  try {
    const privateFile = join(dir, 'models.private.json');
    const foundersFile = join(dir, 'founders.private.json');
    writeFileSync(privateFile, JSON.stringify({ keys: {}, config: { lines: [{ provider: 'mock', model: 'mock-glm' }, { provider: 'mock', model: 'mock-step' }] } }));
    writeFileSync(foundersFile, JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ day: 0, name: `测试先民${i + 1}`, soul: `PRIVATE-SOUL-${i}`, lang: 'zh' }))));
    const result = await runMeasurement({ privateFile, foundersFile, dir, cap: 8000000, ticks: 2, tickMs: 1000, mock: true });
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.phases.map((p) => p.mode), ['json', 'native']);
    assert.ok(result.phases.every((p) => p.ticksCompleted === 2 && p.replay.ok && p.summary.totals.calls >= 10));
    assert.equal(result.phases[0].endTick, result.phases[1].startTick);
    assert.ok(result.budget.charged > 0 && result.budget.charged <= 8000000);
    assert.equal(result.budget.reserved, 0);
    for (const name of ['calls.jsonl', 'wakings.jsonl']) assert.ok(!readFileSync(join(dir, name), 'utf8').includes('PRIVATE-SOUL'));
    assert.equal(JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')).status, 'complete');
    assert.ok(readFileSync(join(dir, 'report.md'), 'utf8').includes('mock'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
