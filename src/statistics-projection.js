// Rebuildable query data only. Never write corrections into the command world.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createWorldFromSnapshot, engineOf } from './engines.js';
import { stateHash } from './store.js';
import { STEPS } from './e2/engine/tick.js';
import { islandMetrics } from './e2/engine/records.js';
import { usesStatistics2 } from './e2/statistics-version.js';
import { P } from './e2/params.js';
import { iterateCommands } from './commands.js';
import { commandsPath } from './store.js';

export const STATISTICS_PROJECTION_FILE = 'statistics-projection-v2.json';
const verifiedWorlds = new WeakMap();
function matchesHistory(w,p) {
  if (!p || p.worldId!==w.id || p.throughCommand>w.commandN) return false;
  if (p.throughCommand===w.commandN) return p.sourceHash===stateHash(w);
  // Only the same live world may extend a previously verified command prefix.
  return verifiedWorlds.get(p)===w;
}
const totalsOf = flows => {
  const totals = {};
  for (const f of flows) { const key = `${f.resource}:${f.kind}:${f.reason}`; totals[key] = (totals[key] ?? 0) + f.amount; }
  return totals;
};
const isGeneric = f => f.kind === 'expense' && f.resource === 'energy' && f.reason.startsWith('action:');
const actionSink = w => w.ledger?.snk?.energy?.action_cost ?? 0;

// Receipt worlds share immutable, unchanged branches. Cache their canonical JSON
// while retaining the exact store.stateHash byte format, rather than repeatedly
// sorting the entire historical world for every receipt.
function receiptHasher() {
  let cache=new WeakMap();
  function json(v) {
    if(v===null || typeof v!=='object')return JSON.stringify(v)??'null';
    const known=cache.get(v);if(known!==undefined)return known;
    const text=Array.isArray(v)?`[${v.map(x=>json(x===undefined?null:x)).join(',')}]`:`{${Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>`${JSON.stringify(k)}:${json(v[k])}`).join(',')}}`;
    cache.set(v,text);return text;
  }
  return {hash:w=>createHash('sha256').update(json(w)).digest('hex'),reset:()=>{cache=new WeakMap();}};
}

// Copy only modified JSON branches. Validate every outcome, including
// intermediate states later overwritten by another command or daily reset.
function receiptWorld(w, cmd, expectedHash, hashWorld) {
  const r = cmd.receipt;
  if (r.version !== 1 || r.before !== expectedHash) throw new Error(`Receipt chain/pre-state mismatch at #${cmd.n}`);
  const next = { ...w };
  for (const change of r.changes) {
    const path = change.path;
    if (!Array.isArray(path) || !path.length || path.some(k => typeof k !== 'string' || ['__proto__','prototype','constructor'].includes(k))) throw new Error('Invalid receipt path');
    let target = next;
    for (const k of path.slice(0, -1)) {
      const child = target[k];
      if (!Object.hasOwn(target,k) || !child || typeof child !== 'object') throw new Error('Invalid receipt parent');
      target[k] = Array.isArray(child) ? child.slice() : { ...child };
      target = target[k];
    }
    if (change.remove) delete target[path.at(-1)];
    else target[path.at(-1)] = structuredClone(change.value);
  }
  if (next.commandN !== cmd.n || hashWorld(next) !== r.after) throw new Error(`Receipt outcome mismatch at #${cmd.n}`);
  return next;
}

// Synchronous offline operation: the temporary settlement hook must never run
// in the server process. The CLI uses a separate process and no Runtime.open.
export function buildStatisticsProjection(snapshot, commands, { onProgress, checkpoint } = {}) {
  if (snapshot.physics !== 2 || ![6,7].includes(snapshot.premise)) throw new Error('Statistics projection requires P6/P7');
  let w = checkpoint ? structuredClone(checkpoint.snapshot) : createWorldFromSnapshot(snapshot), hash = stateHash(w), count = 0;
  const prior=checkpoint?.projection;
  if(checkpoint && (!prior || prior.version!==2 || prior.worldId!==w.id || w.id!==snapshot.id || prior.throughCommand!==w.commandN || prior.sourceHash!==hash || w.commandN>snapshot.commandN))throw new Error('Invalid statistics checkpoint');
  if(prior)for(const [id,st] of Object.entries(w.residentStats)) {
    const entry=prior.residents[id];
    if(!entry || entry.count!==st.flows.length || entry.sourceHash!==stateHash(st.flows))throw new Error('Invalid statistics checkpoint flow prefix');
  }
  const engine = engineOf(w), corrections = {}, metrics = structuredClone(prior?.metrics??[]), unresolved = structuredClone(prior?.unresolved??[]), hasher=receiptHasher();
  for (const cmd of commands) {
    if (cmd.n > snapshot.commandN) break;
    if (cmd.n !== w.commandN + 1) throw new Error(`Non-contiguous command #${cmd.n}`);
    const legacy = !usesStatistics2(w), sinkBefore = actionSink(w);
    const lengths = Object.fromEntries(Object.entries(w.residentStats ?? {}).map(([id,st]) => [id,st.flows.length]));
    let rebuilt = null, candidate = null, semanticOut, settlementSink;
    if (legacy && cmd.type === 'tick' && (w.clock.tick + 1) % P.ticksPerDay === 0) {
      candidate = structuredClone(w);
      const original = STEPS.metrics;
      try {
        STEPS.metrics = (world, day) => { settlementSink=actionSink(world); if(world.premise===7)rebuilt = islandMetrics(world,day,true); original(world,day); };
        semanticOut = engine.applyCommand(candidate, { ...cmd, receipt: undefined });
      } finally { STEPS.metrics = original; }
    }
    let out;
    if (cmd.receipt) { w = receiptWorld(w,cmd,hash,hasher.hash); hash = cmd.receipt.after; out = cmd.receipt.out; }
    else { w = candidate ?? w; out = semanticOut ?? engine.applyCommand(w,cmd); hash = stateHash(w); hasher.reset(); }
    count++;
    if(count%250===0)onProgress?.({commandN:w.commandN,tick:w.clock.tick});
    if (rebuilt) {
      const raw = w.metrics.find(m => m.day === rebuilt.day);
      if (raw && (!cmd.receipt || stateHash(candidate) === hash)) metrics.push({ day: raw.day, sourceHash: stateHash(raw), value: { ...rebuilt, statisticsCoverage: 'rebuilt' } });
      else unresolved.push({ commandN: cmd.n, kind: 'metrics', reason: 'settlement_replay_mismatch' });
    }
    if (!legacy) continue;
    const id = cmd.payload?.agentId, result = out?.result;
    const rows = id ? (w.residentStats[id]?.flows ?? []).slice(lengths[id] ?? 0).filter(isGeneric) : [];
    const sinkDelta=(settlementSink ?? actionSink(w))-sinkBefore;
    if (!rows.length && sinkDelta === 0) continue;
    const results = result?.results?.filter(r => r.ok && r.cost > 0) ?? [];
    const replacements = [];
    let valid = cmd.type === 'act' && !result?.replayed && results.length === rows.length;
    for (let i = 0; valid && i < rows.length; i++) {
      const row = rows[i], r = results[i], data = r.data ?? {};
      const invested = r.type === 'repair' ? data.spent : r.type === 'contribute' ? data.energy : 0;
      const fees = (data.fees ?? []).reduce((n,f) => n + f.energy,0);
      const base = r.cost - invested - fees;
      valid = row.reason === `action:${r.type}` && row.amount === r.cost && Number.isSafeInteger(base) && base >= 0;
      replacements.push(base ? { ...row, amount:base, actionIndex:r.index } : null);
    }
    valid &&= replacements.reduce((n,f) => n + (f?.amount ?? 0),0) === sinkDelta;
    // Repair and custody inputs must be independently evidenced by dedicated rows.
    for (const [type,reason,kind,field] of [['repair','repair','expense','spent'],['contribute','project','escrow','energy']]) {
      const expected = results.filter(r => r.type === type).reduce((n,r) => n + (r.data?.[field] ?? NaN),0);
      const actual = (w.residentStats[id]?.flows ?? []).slice(lengths[id] ?? 0).filter(f => f.resource === 'energy' && f.kind === kind && f.reason === reason).reduce((n,f) => n + f.amount,0);
      if (actual !== expected) valid = false;
    }
    if (!valid) { unresolved.push({ commandN:cmd.n, kind:'resident', reason:'cost_evidence_mismatch' }); continue; }
    const byIndex = corrections[id] ??= new Map();
    const flows = w.residentStats[id].flows;
    let i = 0;
    for (let index = lengths[id] ?? 0; index < flows.length; index++) if (isGeneric(flows[index])) byIndex.set(index,replacements[i++]);
  }
  const sourceHash = stateHash(snapshot);
  if (w.commandN !== snapshot.commandN || stateHash(w) !== hash || hash !== sourceHash) throw new Error('Projection cutoff/snapshot hash mismatch');
  const residents = Object.fromEntries(Object.entries(w.residentStats).map(([id,st]) => [id,{
    count:st.flows.length, sourceHash:stateHash(st.flows),
    flows:[...(prior?.residents[id]?.flows??[]),...st.flows.slice(prior?.residents[id]?.count??0).flatMap((f,i) => {
      const index=i+(prior?.residents[id]?.count??0);
      return corrections[id]?.has(index) ? corrections[id].get(index) ? [corrections[id].get(index)] : [] : [f];
    })],
  }]));
  const projection={ version:2, worldId:w.id, throughCommand:w.commandN, sourceHash, commands:(prior?.commands??0)+count, metrics, residents, unresolved };
  verifiedWorlds.set(projection,snapshot);
  return projection;
}

export function projectedMetrics(w, raw, projection) {
  if (!raw || raw.statisticsVersion === 2 || ![6,7].includes(w.premise)) return raw;
  const entry = matchesHistory(w,projection) && projection.metrics?.find(m => m.day === raw.day && m.sourceHash === stateHash(raw));
  return entry ? entry.value : { ...raw, statisticsVersion:1, statisticsCoverage:'unverified' };
}
export function projectedResident(w, id, projection) {
  const raw = w.residentStats?.[id];
  if (!raw) return null;
  const entry = matchesHistory(w,projection) && projection.residents?.[id];
  const matches = entry && entry.count <= raw.flows.length && stateHash(raw.flows.slice(0,entry.count)) === entry.sourceHash;
  const completeNew = w.statistics?.enabledCommand === 0;
  if (!matches) return { ...raw, statisticsCoverage:{version:completeNew ? 2 : 1,status:completeNew ? 'complete' : 'unverified'} };
  const flows = [...entry.flows,...raw.flows.slice(entry.count)];
  const unresolved = projection.unresolved.filter(x => x.kind === 'resident').length;
  const complete = !unresolved && (w.commandN === projection.throughCommand || usesStatistics2(w) && w.statistics.enabledCommand <= projection.throughCommand + 1);
  return { ...raw, flows, totals:totalsOf(flows), statisticsCoverage:{version:2,status:complete ? 'complete' : 'partial',throughCommand:projection.throughCommand,unresolvedCommands:unresolved} };
}

const cache = new WeakMap();
export function statisticsProjection(rt) {
  if (!rt.dir || ![6,7].includes(rt.w.premise)) return { revision:'none', data:null };
  const file = join(rt.dir,STATISTICS_PROJECTION_FILE);
  let signature;
  try { const st = statSync(file); signature = `${st.mtimeMs}:${st.ctimeMs}:${st.size}`; }
  catch { return { revision:'none', data:null }; }
  const old = cache.get(rt);
  if (old?.revision === signature && old.world===rt.w && old.checkedCommand<=rt.w.commandN && (old.data || old.checkedCommand===rt.w.commandN)) {old.checkedCommand=rt.w.commandN;return old;}
  let data = null;
  try {
    const parsed = JSON.parse(readFileSync(file,'utf8'));
    if (parsed.version === 2 && parsed.worldId === rt.w.id && parsed.throughCommand<=rt.w.commandN && Array.isArray(parsed.metrics) && Array.isArray(parsed.unresolved) && parsed.residents && typeof parsed.residents === 'object') {
      const currentHash=stateHash(rt.w);
      let anchor=parsed.throughCommand===rt.w.commandN ? currentHash : null, tip=anchor;
      if(!anchor)for(const cmd of iterateCommands(commandsPath(rt.dir),{fromN:parsed.throughCommand-1,toN:rt.w.commandN})) {
        if(cmd.n===parsed.throughCommand)anchor=tip=cmd.receipt?.after;
        else {if(!cmd.receipt || cmd.receipt.before!==tip)throw new Error('Projection is from another command history');tip=cmd.receipt.after;}
      }
      if(anchor===parsed.sourceHash && tip===currentHash){data=parsed;verifiedWorlds.set(data,rt.w);}
    }
  } catch { /* A missing or incomplete projection never changes live state. */ }
  const result = { revision:signature, data, world:rt.w, checkedCommand:rt.w.commandN }; cache.set(rt,result); return result;
}

export function queryMetrics(rt, metric, projection=statisticsProjection(rt).data) {
  const value=projectedMetrics(rt.w,metric,projection);
  return rt.engine.physics===2 && rt.events.fiscal ? rt.events.fiscal.metrics(rt.w,value) : value;
}
