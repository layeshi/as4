import { openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

// Flush contents before publishing. POSIX also supports flushing the directory entry.
export function durableFile(file, data) {
  const temporary = `${file}.tmp`;
  const fd = openSync(temporary, 'w', 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temporary, file);
  if (process.platform !== 'win32') {
    const directory = openSync(dirname(file), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
}
