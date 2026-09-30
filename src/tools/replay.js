// SPEC-M1 §11.4：回放工具。
// `npm run replay`（`node src/tools/replay.js [WORLD_ID]`）：用快照中的 seed 创建初始世界，回放全部命令
// （n ≤ 快照的 commandN），把结果的规范化 JSON（键排序）的 SHA-256 与当前快照对比，输出 OK 或第一个差异的路径。
// 回放只保证在同一代码版本下一致；版本不一致时先给出警告再继续。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createWorld } from '../world.js';
import { applyCommand } from '../engine/index.js';
import { readCommands } from '../commands.js';
import { readSnapshot, commandsPath, worldDir, stateHash, firstDiff } from '../store.js';
import { loadConfig, applyConfig } from '../config.js';

/**
 * 回放一个世界的数据目录。返回 { ok, hash, snapshotHash, diff, applied, warnings, world }。
 * toN：只回放到第 toN 条命令（默认到快照的 commandN；此时与快照比对）。
 */
export function replayDir(dir, { toN, currentVersion } = {}) {
  const snap = readSnapshot(dir);
  if (!snap) throw new Error(`${dir} 里没有快照`);
  const warnings = [];
  if (currentVersion && snap.codeVersion !== currentVersion) {
    warnings.push(`世界创建时的代码版本是 ${snap.codeVersion}，当前是 ${currentVersion}：回放可能不一致`);
  }
  const limit = toN === undefined ? snap.commandN : toN;
  const w = createWorld({ id: snap.id, seed: snap.seed, codeVersion: snap.codeVersion, sandboxAdoption: snap.sandboxAdoption });
  const cmds = readCommands(commandsPath(dir), { toN: limit });
  for (const cmd of cmds) applyCommand(w, cmd);
  const hash = stateHash(w);
  if (toN !== undefined && toN !== snap.commandN) return { ok: null, hash, snapshotHash: null, diff: null, applied: cmds.length, warnings, world: w };
  const snapshotHash = stateHash(snap);
  const diff = hash === snapshotHash ? null : firstDiff(w, snap) || '（哈希不同但找不到差异的路径）';
  return { ok: hash === snapshotHash, hash, snapshotHash, diff, applied: cmds.length, warnings, world: w };
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith('--'));
  const cfg = loadConfig(process.env, argv);
  if (positional[0]) cfg.worldId = positional[0];
  applyConfig(cfg);
  const toIdx = argv.indexOf('--to');
  const toN = toIdx >= 0 ? Number(argv[toIdx + 1]) : undefined;
  const dir = worldDir(cfg.dataDir, cfg.worldId);
  let r;
  try {
    r = replayDir(dir, { toN, currentVersion: pkg.version });
  } catch (e) {
    console.error(`回放失败：${e.message}`);
    process.exit(2);
  }
  for (const w of r.warnings) console.warn(`警告：${w}`);
  if (r.ok === null) {
    console.log(`已回放 ${r.applied} 条命令，状态哈希 ${r.hash}`);
  } else if (r.ok) {
    console.log(`OK（回放 ${r.applied} 条命令，状态哈希 ${r.hash.slice(0, 16)}…）`);
  } else {
    console.log(`MISMATCH：第一个差异在 ${r.diff}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
