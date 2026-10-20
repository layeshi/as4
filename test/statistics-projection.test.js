import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import e2 from '../src/e2/facade.js';
import { createWorld } from '../src/e2/world.js';
import { stateHash } from '../src/store.js';
import { makeReceipt,receiptChecksum } from '../src/command-receipt.js';
import { P } from '../src/e2/params.js';
import { buildStatisticsProjection, projectedMetrics, projectedResident, statisticsProjection, STATISTICS_PROJECTION_FILE } from '../src/statistics-projection.js';
const hiddenPhysics=JSON.parse(readFileSync(new URL('./fixtures/p7-hidden-physics.json',import.meta.url),'utf8'));
function fixture(){
 const w=createWorld({id:'history',seed:'statistics-history',premise:7,statisticsVersion:1,hiddenPhysics}),commands=[];
 const exec=(type,payload={})=>{
  const before=structuredClone(w),cmd={n:w.commandN+1,tick:w.clock.tick,type,payload};
  const out=e2.applyCommand(w,cmd);commands.push(structuredClone({...cmd,receipt:makeReceipt(before,w,out)}));return out;
 };
 const created=exec('account',{op:'create',accountId:'u1',name:'修缮员',city:'north',requestId:'create-history',lang:'zh',soul:'观察',model:'mock',dailyCap:1000000}).result;
 assert.equal(created.ok,true,JSON.stringify(created));const {agentId}=created;
 const wakeId='history-wake';exec('meter',{op:'wake',agentId,wakeId,day:'2026-10-20',kind:'main',system:0,brief:0,delivered:0});
 // The port starts intact; gathering supplies a positive, pure action fee.
 assert.equal(exec('act',{agentId,requestId:'move-history',experimentGeneration:0,actions:[{type:'move',to:'scrapyard'}],meter:{wakeId,day:'2026-10-20',reread:0}}).result.results[0].ok,true);
 assert.equal(exec('act',{agentId,requestId:'gather-history',experimentGeneration:0,actions:[{type:'gather'}],meter:{wakeId,day:'2026-10-20',reread:0}}).result.results[0].ok,true);
 for(let i=0;i<P.ticksPerDay;i++)assert.equal(exec('tick').result.ok,true);
 exec('meter',{op:'wake',agentId,wakeId:'repair-history-wake',day:'2026-10-20',kind:'main',system:0,brief:0,delivered:0});
 const repaired=exec('act',{agentId,requestId:'repair-history',experimentGeneration:0,actions:[{type:'move',to:'north-port'},{type:'repair',energy:20000,materials:1}],meter:{wakeId:'repair-history-wake',day:'2026-10-20',reread:0}});
 assert.ok(repaired.result.results.every(r=>r.ok),JSON.stringify(repaired.result));
 return {w,commands,agentId,exec};
}
test('historical projection verifies its cutoff and corrects metrics without changing original state',()=>{
 const {w,commands}=fixture(),hash=stateHash(w);
 const p=buildStatisticsProjection(w,commands);
 assert.equal(p.sourceHash,hash);assert.equal(p.throughCommand,w.commandN);assert.equal(stateHash(w),hash);
 assert.ok(p.metrics.length>0,JSON.stringify({tick:w.clock.tick,metrics:w.metrics.length,unresolved:p.unresolved,stats:w.statistics}));assert.equal(p.unresolved.length,0);
 const raw=w.metrics.at(-1),corrected=projectedMetrics(w,raw,p);
 assert.equal(corrected.statisticsVersion,2);assert.equal(corrected.statisticsCoverage,'rebuilt');
 assert.ok(corrected.p4.wakes>=raw.p4.wakes);
 assert.equal(projectedMetrics(w,{...raw,read:987654},p).statisticsCoverage,'unverified');
 const broken=structuredClone(commands);broken[1].receipt.before='a'.repeat(64);
 assert.throws(()=>buildStatisticsProjection(w,broken),/chain|pre-state/);
 const overwritten=structuredClone(commands);
 overwritten.find(c=>c.type==='tick'&&c.tick===P.ticksPerDay-2).receipt.changes.push({path:['dayLog','p4','wakes'],value:999});
 assert.throws(()=>buildStatisticsProjection(w,overwritten),/outcome mismatch/);
 const otherBranch=structuredClone(w);otherBranch.dayLog.p4.wakes++;
 assert.equal(projectedMetrics(otherBranch,otherBranch.metrics.at(-1),p).statisticsCoverage,'unverified');
 assert.equal(projectedResident(otherBranch,Object.keys(otherBranch.agents)[0],p).statisticsCoverage.status,'unverified');
});
test('resident projection rejects a different flow prefix and marks an unrebuilt legacy tail',()=>{
 const {w,commands,agentId,exec}=fixture(),p=buildStatisticsProjection(w,commands);
 const corrected=projectedResident(w,agentId,p);
 assert.equal(corrected.statisticsCoverage.throughCommand,p.throughCommand);
 assert.deepEqual(corrected.ledger,w.residentStats[agentId].ledger);
 const repairs=corrected.flows.filter(f=>f.kind==='expense'&&f.resource==='energy'&&['repair','action:repair'].includes(f.reason));
 assert.ok(repairs.length>0);assert.ok(repairs.every(f=>f.reason==='repair'));
 assert.ok((w.residentStats[agentId].totals['energy:expense:action:repair']??0)>0);
 const bad=structuredClone(p);bad.residents[agentId].sourceHash='b'.repeat(64);
 assert.equal(projectedResident(w,agentId,bad).statisticsCoverage.status,'unverified');
 exec('tick');assert.equal(projectedResident(w,agentId,p).statisticsCoverage.status,'partial');
});

test('loading an earlier projection validates its anchor and chain through the current snapshot',()=>{
 const {w,commands,exec}=fixture(),p=buildStatisticsProjection(w,commands);
 const dir=mkdtempSync(join(tmpdir(),'statistics-provenance-'));
 try{
  writeFileSync(join(dir,STATISTICS_PROJECTION_FILE),JSON.stringify(p));exec('tick');
  const log=()=>writeFileSync(join(dir,'commands.jsonl'),commands.map(command=>JSON.stringify({format:'command-receipt-v1',command,sha256:receiptChecksum(command)})).join('\n')+'\n');log();
  assert.ok(statisticsProjection({w,dir}).data);
  const other=structuredClone(w);other.dayLog.p4.wakes++;
  assert.equal(statisticsProjection({w:other,dir}).data,null);
  commands.at(-1).receipt.before='c'.repeat(64);log();
  assert.equal(statisticsProjection({w,dir}).data,null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a verified checkpoint extends to a deployment stop point without replaying genesis again',()=>{
 const {w,commands,exec}=fixture(),snapshot=structuredClone(w),checkpointProjection=buildStatisticsProjection(snapshot,commands);
 const start=commands.length;exec('admin',{op:'statistics',args:{version:2}});exec('tick');
 const extension=buildStatisticsProjection(w,commands.slice(start),{checkpoint:{snapshot,projection:checkpointProjection}});
 const full=buildStatisticsProjection(w,commands);
 assert.deepEqual(extension,full);
 assert.equal(projectedResident(w,Object.keys(w.agents)[0],extension).statisticsCoverage.status,'complete');
 const broken=structuredClone(checkpointProjection);broken.sourceHash='d'.repeat(64);
 assert.throws(()=>buildStatisticsProjection(w,commands.slice(start),{checkpoint:{snapshot,projection:broken}}),/checkpoint/);
 const badPrefix=structuredClone(checkpointProjection);badPrefix.residents[Object.keys(w.agents)[0]].sourceHash='d'.repeat(64);
 assert.throws(()=>buildStatisticsProjection(w,commands.slice(start),{checkpoint:{snapshot,projection:badPrefix}}),/checkpoint/);
});
