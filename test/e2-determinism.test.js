// SPEC-E2 §0.3 第 1 条：v2 引擎的代码（src/e2/ 下除 sandbox/run.js、calibrate.js 以外的全部，包括规则语言）里
// 禁止 Math.random()、Date.now()、new Date()、Math.sin 等超越函数、eval、new Function、Intl、toLocaleString。
// 随机数只用 src/rng.js 的种子流；时间只用刻与日。这个测试把约束变成静态检查。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log2, shannon } from '../src/e2/metrics.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const E2 = join(ROOT, 'src', 'e2');
const EXEMPT = new Set(['sandbox/run.js', 'sandbox/calibrate.js']);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (name.endsWith('.js')) yield p;
  }
}

const BANNED = [
  /Math\.(random|sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|exp|expm1|log|log2|log10|log1p|pow|sqrt|cbrt|hypot)\b/,
  /\bDate\.now\b/, /\bnew Date\b/, /\bDate\(\)/, /\beval\s*\(/, /\bnew Function\b/, /\bFunction\s*\(/, /\bIntl\b/, /toLocale\w*/, /localeCompare/, /performance\.now/, /process\.hrtime/,
];

test('确定性约束：src/e2/ 下（除 sandbox/run.js 与 calibrate.js）没有 Math.random、Date.now、new Date、超越函数、eval、new Function、Intl、toLocale*', () => {
  const hits = [];
  let n = 0;
  for (const f of files(E2)) {
    const rel = relative(E2, f).split('\\').join('/');
    if (EXEMPT.has(rel)) continue;
    n++;
    // 注释与字符串里提到这些名字不算：先抹掉块注释（保留行数），再逐行去掉行注释与字符串字面量
    const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    text.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
      for (const re of BANNED) if (re.test(code)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.ok(n >= 20, `应当检查到足够多的文件（${n}）`);
  assert.deepEqual(hits, []);
});

test('确定性的对数：log2 只用 + − × ÷，与 Math.log2 在 1e-12 内一致；shannon 的结果是几个已知的值', () => {
  for (const x of [1, 2, 4, 0.5, 0.25, 3, 5, 7, 0.1, 0.3333333333333333, 10, 1000, 1e-9, 123456.789]) {
    assert.ok(Math.abs(log2(x) - Math.log2(x)) < 1e-12, `log2(${x}): ${log2(x)} vs ${Math.log2(x)}`);
  }
  assert.equal(log2(1), 0);
  assert.equal(log2(8), 3);
  assert.equal(shannon([]), 0);
  assert.equal(shannon([5]), 0);
  assert.equal(shannon([1, 1]), 1);
  assert.equal(shannon([1, 1, 1, 1]), 2);
  assert.equal(shannon([2, 1, 1]), 1.5);
  assert.equal(shannon([0, 3, 0]), 0);
  assert.equal(shannon([1, 3]), 0.811);
  assert.equal(shannon([1, 2, 3, 4]), 1.846);
});
