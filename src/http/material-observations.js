import { openSync, readSync, closeSync, existsSync } from 'node:fs';
import { P } from '../e2/params.js';
import { pageRecords, compareRecordIds } from '../e2/engine/materials.js';
export function archivedObservations(rt, args = {}) {
  const matches = (e) =>
    e.vis === 'public' &&
    ['material_regrowth', 'construction_observed'].includes(e.type);
  const row = (e) => ({
    kind: e.type === 'material_regrowth' ? 'regrowth' : 'construction',
    day: Math.floor(e.tick / P.ticksPerDay),
    ...e.data,
  });
  const keep = (o) =>
    (!args.kind || o.kind === args.kind) &&
    (!args.target || [o.zone, o.project, o.actor].includes(args.target));
  // Validate limit before I/O. Read bounded chunks; stop as soon as the requested page is full.
  pageRecords([], args);
  const limit = args.limit ?? 20;
  const after = args.after ?? '';
  const out = [];
  const visit = (e) => {
    if (matches(e)) {
      const o = row(e);
      if (compareRecordIds(o.id, after) > 0 && keep(o)) out.push(o);
    }
  };
  if (!rt.events.file || !existsSync(rt.events.file))
    return pageRecords(rt.w.observations.filter(keep), args);
  const fd = openSync(rt.events.file, 'r'),
    buffer = Buffer.alloc(65536);
  let carry = '';
  // StringDecoder preserves multibyte boundaries in resident-authored event lines.
  const decoder = new StringDecoder('utf8');
  try {
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      carry += decoder.write(buffer.subarray(0, count));
      let end;
      while ((end = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, end);
        carry = carry.slice(end + 1);
        if (line) {
          const e = JSON.parse(line);
          if (e.seq > rt.w.counters.event) break;
          visit(e);
        }
        if (out.length >= limit) return out;
      }
    }
  } finally {
    closeSync(fd);
  }
  return out;
}
import { StringDecoder } from 'node:string_decoder';
