// SPEC-M1 §11.3：快照读写（原子写：先写临时文件再重命名），以及回放用的规范化哈希。
//
// 快照内容为完整世界状态（含 commandN）。时机：每日结算结束时（这一日在其中发生的那条 tick 命令执行完之后，
// 所以快照里的状态与 commandN 严格对应）、进程正常退出时（SIGINT / SIGTERM）。

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const worldDir = (dataDir, worldId) => join(dataDir, worldId);
export const snapshotPath = (dir) => join(dir, 'snapshot.json');
export const commandsPath = (dir) => join(dir, 'commands.jsonl');
export const eventsPath = (dir) => join(dir, 'events.jsonl');

/** 原子写快照 */
export function writeSnapshot(dir, w) {
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, 'snapshot.json.tmp');
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, JSON.stringify(w));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, snapshotPath(dir));
}

/** 读快照；不存在返回 null */
export function readSnapshot(dir) {
  const file = snapshotPath(dir);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function removeWorld(dir) {
  rmSync(dir, { recursive: true, force: true });
}

// ── 规范化 JSON 与哈希 ───────────────────────────────────────

/**
 * 规范化 JSON：键排序，忽略 undefined。
 * （agents.*.inboxCursor 也参与比较：它只在命令里推进——act 命令携带 ackSeq、沙盘脑在 tick 里感知——见 Q9。）
 */
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(',')}]`;
  const parts = [];
  for (const k of Object.keys(v).sort()) {
    const x = v[k];
    if (x === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(x)}`);
  }
  return `{${parts.join(',')}}`;
}

export const stateHash = (w) => createHash('sha256').update(canonicalJson(w)).digest('hex');

/** 两个状态第一个不同的位置："agents.a3.energy: 5 !== 6"；相同返回 null */
export function firstDiff(a, b, path = '') {
  if (a === b) return null;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb || ta === 'string' || ta === 'number' || ta === 'boolean' || ta === 'null' || ta === 'undefined') {
    if (ta === tb && a === b) return null;
    return `${path || '(root)'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
  }
  if (ta === 'array') {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const k of keys) {
    if (a[k] === undefined && b[k] === undefined) continue;
    const d = firstDiff(a[k], b[k], path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return null;
}
