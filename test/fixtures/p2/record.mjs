// 录制 SPEC-P2 §16.1 T1 的黄金样本：node test/fixtures/p2/record.mjs
// 只在代码基线（第二前提的代码一行也没有）上运行一次；之后每一步由 test/p2-golden.test.js 与它逐字节比对。
// 要重新录制（比如有意改了 premise 0 / 1 的行为——不应当发生），必须先在设计方那里得到许可。
import { writeFileSync } from 'node:fs';
import { goldenSamples, sandboxSamples } from './golden.js';

const dir = new URL('./', import.meta.url);
for (const premise of [0, 1]) {
  const g = await goldenSamples(premise);
  writeFileSync(new URL(`premise${premise}.json`, dir), `${JSON.stringify(g, null, 1)}\n`);
  console.log(`premise${premise}.json`, JSON.stringify(g).length, 'bytes (compact)');
}
writeFileSync(new URL('sandbox.json', dir), `${JSON.stringify(sandboxSamples(), null, 1)}\n`);
console.log('sandbox.json', sandboxSamples());
