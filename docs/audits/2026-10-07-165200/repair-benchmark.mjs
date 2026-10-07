import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../../../src/runtime.js';
import { sha, rngFor } from '../../../test/e2-helpers.js';
import { randomActions } from '../../../test/e2-fuzz-lib.js';
import { stateHash } from '../../../src/store.js';
const mode = process.argv[2] || 'modern';
const dataDir = mkdtempSync(join(tmpdir(), 'law-profile-'));
const rt = Runtime.open({ dataDir, worldId: 'bench', physics: 2, premise: 2, seed: 'profile', tickMs: 1000, sandboxAgents: 0 }, { logger: {} });
if (mode === 'legacy') delete rt.w.lawSemantics;
const totals = { engine: 0, append: 0, events: 0, snapshot: 0, total: 0, calls: 0 };
const wrap = (obj, name, key) => { const fn = obj[name].bind(obj); obj[name] = (...args) => { const t = performance.now(); try { return fn(...args); } finally { totals[key] += performance.now() - t; } }; };
rt.engine = { ...rt.engine }; wrap(rt.engine, 'applyCommand', 'engine'); wrap(rt.engine, 'prepareCommand', 'engine'); wrap(rt.log, 'appendReceipt', 'append'); wrap(rt.events, 'append', 'events'); wrap(rt, 'snapshot', 'snapshot');
const exec = (type, payload) => { const t = performance.now(); try { return rt.exec(type, payload); } finally { totals.total += performance.now() - t; totals.calls++; } };
for (let i = 0; i < 8; i++) exec('register', { name: `居民${i}`, bio: '', soul: 's', lang: 'zh', model: 'm', tokenHash: sha('t'+i), ownerKeyHash: sha('k'+i) });
const r = rngFor('profile');
for (let t = 0; t < 60; t++) {
  for (const a of Object.values(rt.w.agents)) if(a.status === 'awake') exec('act', { agentId: a.id, actions: JSON.parse(JSON.stringify(randomActions(rt.w,a,r,['say','diary','remember','move','give','found','inscribe']))) });
  exec('tick');
}
console.log(JSON.stringify({mode, ...totals, worldBytes: Buffer.byteLength(JSON.stringify(rt.w)), hash: stateHash(rt.w)}));
rmSync(dataDir, { recursive: true, force: true });
