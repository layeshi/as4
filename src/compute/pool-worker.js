import v8 from 'node:v8';
import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { open, readFile } from 'node:fs/promises';
import { HistoryArchive } from '../history/archive.js';
import { historyFiles } from '../history/exports.js';
import { zip } from '../history/zip.js';

async function prefix(file, bytes) {
  if (!bytes) return '';
  const fd = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes); let offset = 0;
    while (offset < bytes) { const r = await fd.read(buffer, offset, bytes - offset, offset); if (!r.bytesRead) throw new Error('Snapshot log prefix changed'); offset += r.bytesRead; }
    return buffer.toString('utf8');
  } finally { await fd.close(); }
}
parentPort.on('message', async ({ id, kind, data }) => {
  try {
    let value;
    if (kind === 'export') {
      const style = await readFile(new URL('../../public/history-export.css', import.meta.url), 'utf8');
      const bytes = zip(historyFiles(data, style));
      value = { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
    } else if (kind === 'history') {
      value = await HistoryArchive.prototype.residentRecords.call({ branch: () => data.branch, file: () => data.file, fileBytes:data.fileBytes,maxResultBytes:data.maxResultBytes }, data.branch.id, data.id, data.query);
    } else if (kind === 'snapshot') {
      const files = { 'snapshot.json': data.snapshot };
      for (const name of ['commands.jsonl', 'events.jsonl']) files[name] = await prefix(data.files[name].path, data.files[name].bytes);
      const archive = gzipSync(JSON.stringify({ format: 'houren-world-snapshot', version: 1, metadata: data.metadata, files }));
      value = { archive, sha256: createHash('sha256').update(archive).digest('hex') };
    } else throw new Error('Unsupported computation');
    parentPort.postMessage({ id, value });
  } catch (error) { parentPort.postMessage({ id, error: error.message, code:error.code }); }
});

parentPort.postMessage({ready:true,heapLimitBytes:v8.getHeapStatistics().heap_size_limit});
