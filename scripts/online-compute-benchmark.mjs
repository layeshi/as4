// Synthetic online workload; never opens production DATA_DIR or calls models.
// node scripts/online-compute-benchmark.mjs [legacy|worker] [history=20000]
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/server.js';
import { stateHash } from '../src/store.js';

const mode=process.argv[2]??'worker', records=Number(process.argv[3]??20000);
assert.ok(['legacy','worker'].includes(mode)); assert.ok(Number.isSafeInteger(records)&&records>=0);
const dir=mkdtempSync(join(tmpdir(),'houren-online-bench-'));
const cfg={...loadConfig({},[]),dataDir:dir,worldId:'benchmark',seed:'benchmark',physics:2,premise:7,map:'island-three-v1',shellSlots:0,
  hiddenPhysicsFile:fileURLToPath(new URL('../test/fixtures/p7-hidden-physics.json',import.meta.url)),adminKey:'local-benchmark-only',requireLogin:false,worldExecution:'worker'};
const rt=Runtime.open(cfg,{version:'0.1.0',logger:{}});let app,polling=false,reader;
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]:null;
try{
  const ids=[];
  for(let i=0;i<12;i++)ids.push(rt.exec('account',{op:'create',accountId:`bench-${i}`,requestId:`bench-create-${i}`,name:`基准居民${i}`,soul:'合成负载',model:'mock',lang:'zh',dailyCap:5000000,city:['north','west','east'][i%3]}).result.agentId);
  for(let i=0;i<records;i++){
    const a=rt.w.agents[ids[i%ids.length]];
    rt.w.residentStats[a.id].ledger.push({commandN:0,tick:0,day:0,kind:'diagnostic',op:null,delta:{energy:0,basic:0,materials:0},balance:{energy:a.energy,basic:a.basic,materials:a.materials},events:[]});
  }
  rt.snapshot();app=createApp(rt,cfg,{logger:{}});await app.ctx.history.ready;
  // Fix the command stream: autonomous services are tested elsewhere.
  app.ctx.publicRoles.start=()=>{};app.ctx.reports.start=()=>{};app.ctx.notifications.start=async()=>{};app.ctx.runners.activate=async()=>{};app.ctx.historyExports.kick=()=>{};
  if(mode==='worker')await rt.enableCompute();
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`,headers={'Content-Type':'application/json','X-Admin-Key':cfg.adminKey};
  await fetch(base+'/api/public/state').then(r=>r.arrayBuffer());
  const loop=monitorEventLoopDelay({resolution:10});loop.enable();polling=true;let peakRss=process.memoryUsage.rss();
  const reads=[],ticks=[];
  reader=(async()=>{while(polling){const start=performance.now();const response=await fetch(base+'/api/public/state');assert.equal(response.status,200);await response.arrayBuffer();reads.push(performance.now()-start);peakRss=Math.max(peakRss,process.memoryUsage.rss());await delay(5);}})();
  const cpuStart=process.cpuUsage(), start=performance.now();
  for(let i=0;i<24;i++){const t=performance.now();const response=await fetch(base+'/api/admin/tick',{method:'POST',headers,body:'{}'});assert.equal(response.status,200,await response.text());ticks.push(performance.now()-t);}
  const elapsedMs=performance.now()-start,cpu=process.cpuUsage(cpuStart);polling=false;await reader;loop.disable();
  const result={node:process.version,platform:process.platform,mode,syntheticHistoryRecords:records,residents:12,worldBytes:Buffer.byteLength(JSON.stringify(rt.w)),
    elapsedMs,cpuMs:(cpu.user+cpu.system)/1000,tickP50Ms:percentile(ticks,.5),tickP95Ms:percentile(ticks,.95),readSamples:reads.length,readP50Ms:percentile(reads,.5),readP95Ms:percentile(reads,.95),eventLoopP95Ms:loop.percentile(95)/1e6,
    peakRssBytes:Math.max(peakRss,process.resourceUsage().maxRSS*1024),worldHash:stateHash(rt.w),resources:rt.compute?.view()??null};
  if(rt.compute){
    const data={worldId:'export-fixture',epoch:0,branchId:'synthetic',resident:{name:'基准居民'},fromDay:0,toDay:500,ticksPerDay:12,throughTick:6000,generatedAt:'2026-10-27T00:00:00.000Z',coverage:{note:'synthetic'},
      records:Array.from({length:10000},(_,i)=>({kind:'thought',tick:Math.floor(i/2),day:Math.floor(i/24),seq:i+1,source:{type:'event',seq:i+1},data:{text:`合成历史记录 ${i}：居民思考与固定计算负载。`}}))};
    const run=()=>rt.compute.pool.run('export',data,64*1048576);
    await Promise.all(Array.from({length:Math.max(1,rt.compute.budget.current.slots-1)},run));
    const started=performance.now(),cpuBefore=process.cpuUsage();
    const output=await Promise.all(Array.from({length:12},run));
    const used=process.cpuUsage(cpuBefore);
    assert.equal(new Set(output.map(o=>o.sha256)).size,1);
    result.background={jobs:output.length,elapsedMs:performance.now()-started,cpuMs:(used.user+used.system)/1000,workers:rt.compute.pool.workers.size,outputBytes:output[0].bytes.length};
  }
  console.log(JSON.stringify(result));
}finally{
  polling=false;if(reader)await reader.catch(()=>{});
  rt.stopped=true;if(rt.timer)clearTimeout(rt.timer);
  if(app)await app.close();await rt.closeAsync();rmSync(dir,{recursive:true,force:true});
}
