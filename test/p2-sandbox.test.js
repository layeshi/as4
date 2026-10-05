// SPEC-P2 §16.1 T15：120 日、10 位沙盘先民、20 具躯壳；不调用模型，不标定物理。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSandbox } from '../src/e2/sandbox/run.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
import { stateHash, writeSnapshot } from '../src/store.js';
import { replayDir } from '../src/tools/replay.js';

for (const seed of [1, 2, 3]) {
  test(`P2 T15 沙盘：种子 ${seed} 跑满 120 日、每日守恒、设定与触发常驻指令、重复哈希与落盘回放一致`, () => {
    const commands = [{ type: 'admin', payload: { op: 'seed_sandbox', args: { count: 10 } } }];
    let checked = 0;
    const opts = { premise: 2, shellSlots: 20, agents: 10, days: 120, seed };
    const { world, report } = runSandbox({ ...opts, onDay(w) {
      assert.equal(checkConservation(w).ok, true);
      assert.equal(w.ledger.mismatches, 0);
      checked++;
      for (let i = 0; i < 12; i++) commands.push({ type: 'tick' });
      // CLI 的家书在 onDay 之前寄出；从新添的家书还原同一条命令，不改世界。
      for (const a of Object.values(w.agents)) {
        for (const letter of a.letters) {
          if (letter.tick === w.clock.tick) commands.push({ type: 'letter', payload: { agentId: a.id, text: letter.text } });
        }
      }
    } });
    assert.equal(checked, 120);
    assert.equal(world.clock.tick, 1440);
    assert.equal(report.meta.conservationFailure, null);
    assert.ok(report.metrics.reduce((n, m) => n + m.standingSets, 0) > 0);
    assert.ok(report.metrics.reduce((n, m) => n + m.standingFired, 0) > 0);
    assert.equal(commands.length, world.commandN);
    const second = runSandbox(opts);
    assert.equal(stateHash(second.world), stateHash(world));
    assert.deepEqual({ ...second.report, meta: { ...second.report.meta, elapsedMs: 0 } }, { ...report, meta: { ...report.meta, elapsedMs: 0 } });
    const dir = mkdtempSync(join(tmpdir(), 'houren-p2-sandbox-'));
    try {
      writeSnapshot(dir, world);
      writeFileSync(join(dir, 'commands.jsonl'), commands.map((cmd, i) => JSON.stringify({ n: i + 1, ...cmd })).join('\n') + '\n');
      const replay = replayDir(dir);
      assert.equal(replay.ok, true, replay.diff || '沙盘回放哈希不同');
      assert.equal(replay.hash, report.p1.stateHash);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('P2 T15 沙盘：先民数不能超过躯壳数', () => {
  assert.throws(() => runSandbox({ premise: 2, shellSlots: 9, agents: 10, days: 1 }), /先民不能多于躯壳/);
});
