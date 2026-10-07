// SPEC-M1 §11.2：命令日志。文件 DATA_DIR/WORLD_ID/commands.jsonl，每行 { n, tick, type, payload }，n 连续递增。
// 先写日志，再执行；执行中的校验失败也是确定性的，回放会得到同样的失败。日志只追加，从不改写或删除。

import { closeSync, fsyncSync, openSync, writeSync, appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { receiptChecksum } from './command-receipt.js';

export class CommandLog {
  /** @param {string} file 日志文件路径；null 表示只在内存里记（沙盘与测试） */
  constructor(file = null) {
    this.file = file;
    this.n = 0; // 最后一条命令的编号
    if (file) {
      mkdirSync(dirname(file), { recursive: true });
      if (existsSync(file)) {
        const rows = readCommands(file);
        this.n = rows.length ? rows[rows.length - 1].n : 0;
      }
    }
  }

  /** One newline-terminated, checksummed frame is the commit point. */
  appendReceipt(cmd, receipt) {
    if (cmd.n !== this.n + 1) throw new Error('Receipt command number is not contiguous');
    const command = JSON.parse(JSON.stringify({ ...cmd, receipt }));
    const frame = { format: 'command-receipt-v1', command, sha256: receiptChecksum(command) };
    if (this.file) {
      const bytes = Buffer.from(`${JSON.stringify(frame)}\n`);
      const fd = openSync(this.file, 'a', 0o600);
      try {
        let offset = 0;
        while (offset < bytes.length) {
          const written = writeSync(fd, bytes, offset, bytes.length - offset);
          if (!written) throw new Error('Short receipt write');
          offset += written;
        }
        fsyncSync(fd);
      } finally { closeSync(fd); }
      // Persist file creation as well as its data before publishing the state.
      const dir = openSync(dirname(this.file), 'r');
      try { fsyncSync(dir); } finally { closeSync(dir); }
    }
    this.n = command.n;
    return command;
  }

  /** 追加一条命令并返回带编号的命令对象（调用者随后执行它） */
  append(type, payload, tick) {
    const cmd = { n: this.n + 1, tick, type, payload };
    if (this.file) appendFileSync(this.file, `${JSON.stringify(cmd)}\n`);
    this.n = cmd.n;
    return cmd;
  }
}

/**
 * 读取命令日志。一次崩溃可能让最后一行只写了一半：只有最后一行可以被丢弃，
 * 中间的坏行意味着日志被破坏，直接报错。
 */
export function readCommands(file, { fromN = 0, toN = Infinity } = {}) {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const out = [];
  let expected = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (e) {
      const isLast = lines.slice(i + 1).every((l) => l === '');
      if (isLast) break; // 崩溃时写了一半的最后一行：丢弃
      throw new Error(`commands.jsonl 第 ${i + 1} 行损坏：${e.message}`);
    }
    if (row.format === 'command-receipt-v1') {
      // A parseable frame without the delimiter is still an incomplete append.
      if (i === lines.length - 1) break;
      if (!row.command || row.sha256 !== receiptChecksum(row.command)) throw new Error(`commands.jsonl 第 ${i + 1} 行回执校验失败`);
      row = row.command;
      if (!row.receipt || row.receipt.version !== 1) throw new Error('Unsupported command receipt');
    }
    if (expected !== null && row.n !== expected) throw new Error(`commands.jsonl 编号不连续：期望 ${expected}，得到 ${row.n}（第 ${i + 1} 行）`);
    expected = row.n + 1;
    if (row.n > fromN && row.n <= toN) out.push(row);
  }
  return out;
}

/** 如果最后一行是只写了一半的坏行，把它从文件里截掉（启动时调用，保证之后的追加从干净的行开始） */
export function repairCommandLog(file) {
  if (!existsSync(file)) return false;
  const text = readFileSync(file, 'utf8');
  if (text === '' || text.endsWith('\n')) {
    // 结尾是换行：仍要检查最后一行是否完整
    const lines = text.split('\n');
    const last = lines.length >= 2 ? lines[lines.length - 2] : '';
    if (last === '') return false;
    try {
      JSON.parse(last);
      return false;
    } catch {
      writeFileSync(file, `${lines.slice(0, -2).join('\n')}${lines.length > 2 ? '\n' : ''}`);
      return true;
    }
  }
  // 结尾没有换行：最后一行是半行
  const cut = text.lastIndexOf('\n');
  writeFileSync(file, cut >= 0 ? text.slice(0, cut + 1) : '');
  return true;
}
