import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandLog, readCommands, repairCommandLog, iterateCommands } from '../src/commands.js';
import { receiptChecksum } from '../src/command-receipt.js';

function file(t) {
  const dir = mkdtempSync(join(tmpdir(), 'command-lines-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'commands.jsonl');
}
const legacy = n => ({ n, tick: n, type: 'test', payload: {} });
const framed = n => { const command = { ...legacy(n), receipt: { version: 1 } }; return { format: 'command-receipt-v1', command, sha256: receiptChecksum(command) }; };
test('UTF-8 records crossing read boundaries remain exact', t => {
  const path = file(t), record = { ...legacy(1), payload: { text: '界🙂'.repeat(30000) } };
  writeFileSync(path, JSON.stringify(record) + '\r\n\n' + JSON.stringify(legacy(2)) + '\n');
  assert.deepEqual([...iterateCommands(path)], [record, legacy(2)]);
});
test('narrow ranges still reject corruption outside the requested range', t => {
  const path = file(t); const bad = framed(3); bad.sha256 = 'bad';
  writeFileSync(path, [framed(1), framed(2), bad].map(x => JSON.stringify(x) + '\n').join(''));
  assert.throws(() => readCommands(path, { fromN: 1, toN: 2 }), /校验失败/);
});
test('empty lines after a legacy torn tail do not hide following corruption', t => {
  const path = file(t), prefix = JSON.stringify(legacy(1)) + '\n';
  writeFileSync(path, prefix + '{bad\n\n');
  assert.equal(repairCommandLog(path), true); assert.equal(readFileSync(path, 'utf8'), prefix);
  writeFileSync(path, prefix + '{bad\n\n' + JSON.stringify(legacy(2)) + '\n');
  const bytes = readFileSync(path); assert.throws(() => repairCommandLog(path), /损坏/); assert.deepEqual(readFileSync(path), bytes);
});
test('repair-aware construction uses committed sequence for an unterminated legacy command', t => {
  const path = file(t), prefix = JSON.stringify(legacy(1)) + '\n';
  writeFileSync(path, prefix + JSON.stringify(legacy(2)));
  assert.equal(new CommandLog(path, { repair: true }).n, 1); assert.equal(readFileSync(path, 'utf8'), prefix);
});
test('valid logs are not rewritten during repair', t => {
  const path = file(t); writeFileSync(path, JSON.stringify(framed(1)) + '\n');
  const before = statSync(path); assert.equal(repairCommandLog(path), false); assert.equal(statSync(path).ino, before.ino);
});
