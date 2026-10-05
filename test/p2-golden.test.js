// SPEC-P2 §16.1 T1（黄金样本部分）：premise 0 与 premise 1 的世界逐字节不变。
// 样本在代码基线（第二前提的代码一行也没有）上录制，见 test/fixtures/p2/golden.js、record.mjs。
// 每一步都要与它比对；它失败，就是改变了旧世界的行为（SPEC-P2 §0.3 第 1 条）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goldenSamples, sandboxSamples } from './fixtures/p2/golden.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/p2/${name}.json`, import.meta.url), 'utf8'));

/** 逐层比较并报告第一处不同的位置（样本很大，deepEqual 的输出没法读） */
function same(got, want, path) {
  if (typeof want === 'string') {
    if (got === want) return;
    const g = String(got);
    let i = 0;
    while (i < want.length && g[i] === want[i]) i++;
    assert.fail(`${path} 在第 ${i} 个字符处不同（长度 ${want.length} → ${g.length}）\n  录制：…${want.slice(Math.max(0, i - 40), i + 100)}…\n  现在：…${g.slice(Math.max(0, i - 40), i + 100)}…`);
  }
  if (Array.isArray(want)) {
    assert.ok(Array.isArray(got), `${path} 应当是数组`);
    assert.equal(got.length, want.length, `${path}.length`);
    want.forEach((x, i) => same(got[i], x, `${path}[${i}]`));
    return;
  }
  if (want !== null && typeof want === 'object') {
    assert.ok(got !== null && typeof got === 'object', `${path} 应当是对象`);
    assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort(), `${path} 的键`);
    for (const k of Object.keys(want)) same(got[k], want[k], `${path}.${k}`);
    return;
  }
  assert.equal(got, want, path);
}

for (const premise of [0, 1]) {
  test(`P2 T1: premise ${premise} 的世界、感知、渲染、系统提示、运行器请求、MCP 输出、指标与史官逐字节不变`, async () => {
    const got = JSON.parse(JSON.stringify(await goldenSamples(premise)));
    same(got, fixture(`premise${premise}`), `premise${premise}`);
  });
}

// 沙盘调用后会改动进程内的天象设置，所以放在最后
test('P2 T1: 沙盘报告哈希不变（premise 0、premise 1；同 P1 的 Q34，耗时归零）', () => {
  same(sandboxSamples(), fixture('sandbox'), 'sandbox');
});
