// SPEC-E2 §24.1 第 1 条与 §0.3 第 8 条：第一纪冻结。
//
// 原有的全部测试不修改、照样通过（这由 npm test 本身保证）；这里再验证三个旧世界（baihua、mycity、frontier-demo）
// 的数据副本：用 v1 引擎回放，状态哈希与快照一致——快照是改动前的代码写下的，所以「一致」就是「回放哈希不变」。
//
// 数据副本放在环境变量 HOUREN_FROZEN_WORLDS 指向的目录里（每个世界一个子目录，含 snapshot.json 与 commands.jsonl）。
// 没有设置时跳过并提示：这些世界在 data/ 里，不进代码库。
//   HOUREN_FROZEN_WORLDS=/path/to/copies npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { replayDir } from '../src/tools/replay.js';
import { readSnapshot } from '../src/store.js';
import { engineOf } from '../src/engines.js';

const WORLDS = ['baihua', 'mycity', 'frontier-demo'];
const dir = process.env.HOUREN_FROZEN_WORLDS;

if (!dir) {
  test('第一纪冻结：旧世界的回放哈希不变', { skip: '未设置 HOUREN_FROZEN_WORLDS（指向 baihua、mycity、frontier-demo 的数据副本所在的目录），已跳过' }, () => {});
} else {
  for (const id of WORLDS) {
    const path = join(dir, id);
    if (!existsSync(join(path, 'snapshot.json'))) {
      test(`第一纪冻结：${id}`, { skip: `${path} 里没有快照，已跳过` }, () => {});
      continue;
    }
    test(`第一纪冻结：${id} 用 v1 引擎回放，状态哈希与快照一致`, () => {
      const snap = readSnapshot(path);
      assert.notEqual(snap.physics, 2, '旧世界不是第二纪的世界');
      assert.equal(engineOf(snap).physics, 1, '没有 physics 字段的快照由 v1 引擎处理');
      const r = replayDir(path);
      assert.equal(r.ok, true, r.diff || '回放与快照不一致');
      assert.equal(r.diff, null);
      assert.ok(r.applied > 0);
    });
  }
}
