// Manual Q60 diagnostic; kept outside test/ so npm test does not run it.
// Use the same Node executable, run checkouts sequentially, and compare hashes.
// node scripts/q60-performance.mjs [checkout-root] [days=720]
// Short runs diagnose hot paths; only 720 days checks the original 150s threshold.
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const [root = fileURLToPath(new URL('../', import.meta.url)), daysArg = '720'] = process.argv.slice(2);
const days = Number(daysArg);
assert.ok(Number.isSafeInteger(days) && days > 0, 'days must be a positive safe integer');
const { runSandbox, coverageGaps } = await import(pathToFileURL(resolve(root, 'src/e2/sandbox/run.js')));
const { serializeWorld } = await import(pathToFileURL(resolve(root, 'src/e2/world.js')));
const hash = value => createHash('sha256').update(value).digest('hex');
const start = performance.now(), cpuStart = process.cpuUsage();
let last = start;
const { world, report } = runSandbox({ days, agents: 24, seed: 1,
  onDay(w, d) {
    if ((d + 1) % 120 !== 0) return;
    const now = performance.now();
    console.error(JSON.stringify({ day: d + 1, blockMs: Math.round(now - last), elapsedMs: Math.round(now - start),
      agents: Object.keys(w.agents).length, proposals: Object.keys(w.proposals).length,
      docs: Object.keys(w.docs).length, memoryMB: Math.round(process.memoryUsage().heapUsed / 1048576) }));
    last = now;
  }
});
const elapsedMs = report.meta.elapsedMs;
report.meta.elapsedMs = 0;
const cpu = process.cpuUsage(cpuStart);
const output = { root, node: process.version, days, elapsedMs,
  cpuMs: (cpu.user + cpu.system) / 1000, resourceUsage: process.resourceUsage(),
  worldHash: hash(serializeWorld(world)), reportHash: hash(JSON.stringify(report)),
  conservationFailure: report.meta.conservationFailure, mismatches: world.ledger.mismatches, coverageGaps: coverageGaps(report) };
console.log(JSON.stringify(output));
assert.equal(report.meta.conservationFailure, null);
assert.equal(world.ledger.mismatches, 0);
assert.equal(report.meta.worldDays, days);
if (days === 720) { assert.deepEqual(coverageGaps(report), []); assert.ok(elapsedMs < 150000, `${elapsedMs} ms exceeds unchanged 150000 ms threshold`); }
