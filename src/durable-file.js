import { openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

// Publish only after both file contents and its directory entry are durable.
export function durableFile(file, data) {
  const temporary = `${file}.tmp`;
  const fd = openSync(temporary, 'w', 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temporary, file);
  const directory = openSync(dirname(file), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
}
