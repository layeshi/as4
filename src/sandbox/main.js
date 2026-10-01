// `npm run sandbox` 与 `npm run calibrate` 的入口（SPEC-E2 §23.1）：按 --physics 1|2（缺省 2）分派给对应一代的命令行。
//
//   node src/sandbox/main.js run       [--physics 1|2] <该代命令行的参数……>
//   node src/sandbox/main.js calibrate [--physics 1|2] <该代命令行的参数……>
//
// 第一纪的命令行保持原样（src/sandbox/run.js、calibrate.js 仍可直接运行）；第二纪的在 src/e2/sandbox/。这里只做分派，不改变任何一代的行为。

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const TOOLS = {
  run: { 1: join(here, 'run.js'), 2: join(here, '..', 'e2', 'sandbox', 'run.js') },
  calibrate: { 1: join(here, 'calibrate.js'), 2: join(here, '..', 'e2', 'sandbox', 'calibrate.js') },
};

/** 解析命令行：返回 { tool, physics, rest }；不合法时抛错 */
export function parse(argv) {
  const [tool, ...rest] = argv;
  if (!Object.prototype.hasOwnProperty.call(TOOLS, tool)) throw new Error(`用法：main.js run|calibrate [--physics 1|2] ……（收到 ${tool === undefined ? '空' : tool}）`);
  let physics = 2;
  const i = rest.indexOf('--physics');
  if (i >= 0) {
    physics = Number(rest[i + 1]);
    if (physics !== 1 && physics !== 2) throw new Error(`--physics 须为 1 或 2（收到 ${rest[i + 1]}）`);
    rest.splice(i, 2);
  }
  return { tool, physics, rest };
}

export function target({ tool, physics }) {
  return TOOLS[tool][physics];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const parsed = parse(process.argv.slice(2));
    const r = spawnSync(process.execPath, [target(parsed), ...parsed.rest], { stdio: 'inherit' });
    process.exit(r.status === null ? 1 : r.status);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
