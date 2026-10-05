import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAcceptance } from './fixtures/p2/acceptance.mjs';

for (const mode of ['json', 'native']) {
  test(`P2 T16 端到端（${mode}）：十位示例先民、一日、先看再投票、同刻回应、常驻指令、轨迹、预算与重启回放`, async () => {
    const env = await prepareAcceptance({ mode });
    try {
      assert.equal(env.report.days, 1);
      assert.equal(env.report.tick, 12);
      assert.ok(Object.values(env.report.checks).every(Boolean), JSON.stringify(env.report.checks));
    } finally { await env.cleanup(); }
  });
}
