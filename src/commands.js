// SPEC-M1 §11.2：命令日志。文件 DATA_DIR/WORLD_ID/commands.jsonl，每行 { n, tick, type, payload }，n 连续递增。
// 先写日志，再执行；执行中的校验失败也是确定性的，回放会得到同样的失败。日志只追加，从不改写或删除。

import { closeSync, fsyncSync, openSync, readSync, fstatSync, writeSync, renameSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { receiptChecksum } from './command-receipt.js';

export class CommandLog {
  /** @param {string} file 日志文件路径；null 表示只在内存里记（沙盘与测试） */
  constructor(file = null, { repair = false } = {}) {
    this.file = file;
    this.n = 0; // 最后一条命令的编号
    if (file) {
      mkdirSync(dirname(file), { recursive: true });
      if (existsSync(file)) {
        const info = inspectCommands(file);
        if (repair) repairValidatedTail(file, info);
        this.n = repair ? info.committedN : info.lastN;
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
      // Node cannot open directory handles for fsync on Windows; file data above is flushed.
      if (process.platform !== 'win32') {
        const dir = openSync(dirname(this.file), 'r');
        try { fsyncSync(dir); } finally { closeSync(dir); }
      }
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
export function readCommands(file, options = {}) {
  return [...iterateCommands(file, options)];
}

// Fixed-size reads bound memory by one record, even when the file is much
// larger than the heap. Capture its length so an online reader has a cutoff.
function* commandLines(file) {
  const fd = openSync(file, 'r'), size = fstatSync(fd).size;
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let offset = 0, start = 0, parts = [];
  try {
    while (offset < size) {
      const n = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (!n) throw new Error('Command log changed while reading');
      let cursor = 0;
      for (let end = buffer.indexOf(10, cursor); end >= 0 && end < n; end = buffer.indexOf(10, cursor)) {
        parts.push(buffer.subarray(cursor, end));
        yield { text: Buffer.concat(parts).toString('utf8'), start, end: offset + end + 1, terminated: true };
        parts = []; cursor = end + 1; start = offset + cursor;
      }
      if (cursor < n) parts.push(Buffer.from(buffer.subarray(cursor, n)));
      offset += n;
    }
    if (parts.length) yield { text: Buffer.concat(parts).toString('utf8'), start, end: size, terminated: false };
  } finally { closeSync(fd); }
}

/** Validate the entire prefix, yielding only the requested range. */
export function* iterateCommands(file, { fromN = 0, toN = Infinity, info = {} } = {}) {
  Object.assign(info, { lastN: 0, committedN: 0, truncateTo: null });
  if (!existsSync(file)) return;
  let expected = null, seenReceipt = false, badTail = null, lineNumber = 0;
  for (const line of commandLines(file)) {
    lineNumber++;
    if (line.text === '') continue;
    if (badTail) throw badTail;
    let row;
    try {
      row = JSON.parse(line.text);
    } catch (e) {
      const error = new Error(`commands.jsonl 第 ${lineNumber} 行损坏：${e.message}`);
      const completeReceipt = line.terminated && (seenReceipt || /command-receipt|\"format\"\s*:|\"receipt\"\s*:/.test(line.text));
      if (completeReceipt) throw error;
      // Legacy malformed tails may be discarded only after confirming that
      // no later nonempty record exists. Complete corrupt receipts never are.
      badTail = error; info.truncateTo = line.start; continue;
    }
    if (row.format !== undefined && row.format !== 'command-receipt-v1') throw new Error('Unsupported command receipt format');
    if (row.format === 'command-receipt-v1') {
      seenReceipt = true;
      // A parseable frame without the delimiter is still an incomplete append.
      if (!line.terminated) { info.truncateTo = line.start; break; }
      if (!row.command || row.sha256 !== receiptChecksum(row.command)) throw new Error(`commands.jsonl 第 ${lineNumber} 行回执校验失败`);
      row = row.command;
      if (!row.receipt || row.receipt.version !== 1) throw new Error('Unsupported command receipt');
    }
    if (expected !== null && row.n !== expected) throw new Error(`commands.jsonl 编号不连续：期望 ${expected}，得到 ${row.n}（第 ${lineNumber} 行）`);
    expected = row.n + 1;
    info.lastN = row.n;
    if (line.terminated) info.committedN = row.n;
    else info.truncateTo = line.start;
    if (row.n > fromN && row.n <= toN) yield row;
  }
}

function inspectCommands(file) {
  const info = {};
  for (const _ of iterateCommands(file, { info })) { /* validate without retaining commands */ }
  return info;
}

/** 如果最后一行是只写了一半的坏行，把它从文件里截掉（启动时调用，保证之后的追加从干净的行开始） */
export function repairCommandLog(file) {
  return repairValidatedTail(file, inspectCommands(file));
}

// Copy the validated prefix using bounded buffers. An interruption must leave
// either the original file or the complete acknowledged prefix, never half.
function repairValidatedTail(file, { truncateTo }) {
  if (truncateTo === null) return false;
  const temporary = `${file}.tmp`;
  const source = openSync(file, 'r'), target = openSync(temporary, 'w', 0o600);
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let offset = 0;
    while (offset < truncateTo) {
      const n = readSync(source, buffer, 0, Math.min(buffer.length, truncateTo - offset), offset);
      if (!n) throw new Error('Command log changed during tail repair');
      let written = 0;
      while (written < n) {
        const count = writeSync(target, buffer, written, n - written);
        if (!count) throw new Error('Short command tail repair write');
        written += count;
      }
      offset += n;
    }
    fsyncSync(target);
  } finally { closeSync(source); closeSync(target); }
  renameSync(temporary, file);
  if (process.platform !== 'win32') {
    const dir = openSync(dirname(file), 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  return true;
}
