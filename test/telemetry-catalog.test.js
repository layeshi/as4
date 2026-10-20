import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actionTable } from '../src/e2/lore/actions.js';
import { cleanRecord,TraceStore } from '../src/runner/traces.js';
import { safeActionType,safeErrorCode,safeRuntimeLog } from '../src/telemetry-safety.js';
import { safeToolName,cleanToolRejection } from '../src/runner/tool-diagnostics.js';
import { boot } from './http-helpers.js';
import { createClient } from '../runner/client.js';
import { createProvider } from '../runner/providers.js';
import { runAgent } from '../runner/agent.js';
test('every official action survives all telemetry boundaries for its premise',()=>{
 for(const premise of [2,4,5,6,7])for(const type of actionTable(premise,false,true,true,true).ORDER){
  assert.equal(safeActionType(type),type,`logger ${premise}/${type}`);
  assert.equal(safeToolName(type),type,`tools ${premise}/${type}`);
  assert.equal(cleanRecord({acts:[{type,ok:true}]},premise).acts[0].type,type,`trace ${premise}/${type}`);
 }
});
test('material errors retain their code and injected strings remain filtered',()=>{
 assert.equal(safeErrorCode('insufficient_materials'),'insufficient_materials');
 assert.equal(cleanRecord({acts:[{type:'repair',ok:false,error:'insufficient_materials'}]},7).acts[0].error,'insufficient_materials');
 assert.equal(cleanToolRejection({tool:'gather',stage:'local_validation',codes:['insufficient_materials']}).codes[0],'insufficient_materials');
 assert.equal(safeRuntimeLog('  ✗ gather insufficient_materials'),'  ✗ gather insufficient_materials');
 assert.equal(safeActionType('gather PRIVATE'),'other');assert.equal(safeErrorCode('insufficient_materials PRIVATE'),'other');
 assert.equal(safeToolName('program PRIVATE'),'other');
});
test('material and cooperation look sections survive saved traces without accepting text',()=>{
 const rec=cleanRecord({looks:['materials','project:j1','programs','cards:k1','cooperation_rules','entity_observations:en1','PRIVATE']},7);
 assert.deepEqual(rec.looks,['materials','project:j1','programs','cards:k1','cooperation_rules','entity_observations:en1','other']);
});

test('every official action survives trace save, reload and daily action totals',()=>{
 const dir=mkdtempSync(join(tmpdir(),'telemetry-catalog-'));
 try {for(const premise of [2,4,5,6,7]){
  const file=join(dir,`p${premise}.jsonl`),store=new TraceStore({file,premise});
  const types=actionTable(premise,false,true,true,true).ORDER;
  store.append('a1',{acts:types.map(type=>({type,ok:true}))});
  const row=JSON.parse(readFileSync(file,'utf8'));assert.deepEqual(row.acts.map(a=>a.type),types);
  const reloaded=new TraceStore({file,premise});assert.equal(reloaded.agentsDay(reloaded.today()).agents[0].acts,types.length);
 }}finally{rmSync(dir,{recursive:true,force:true});}
});

for(const mode of ['native','json'])test(`real ${mode} tool loop preserves gather and material failure in the persisted trace`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'statistics-loop-'));let env;
 try{
  const physicsFile=join(dir,'physics.json');
  writeFileSync(physicsFile,JSON.stringify({version:1,regrowth:{baseByZone:{wilds:20,scrapyard:15,solarfield:10},thresholdByZone:{wilds:30,scrapyard:25,solarfield:15},factorPermille:500},construction:{fullActionsPerTick:2,factorPermille:500}}));
  env=await boot({physics:2,premise:5,map:'compact-materials-v1',shellSlots:0,hiddenPhysicsFile:physicsFile,tokenBasic:500000,tickMs:300000});
  env.rt.agentLoop={...env.rt.agentLoop,marginSec:0,debounceSec:0};
  const created=await env.register('测试居民',{dailyCap:1000000}),id=created.agentId;
  env.rt.exec('admin',{op:'adjust',args:{agentId:id,energy:50000,reason:'test'}});
  env.rt.w.agents[id].place='scrapyard';env.rt.w.places.scrapyard.condition=8000;env.rt.w.places.scrapyard.open=false;
  const file=join(dir,'traces.jsonl'),store=new TraceStore({file,premise:5});
  const calls=[{name:'gather',args:{}},{name:'repair',args:{energy:1000,materials:0}},{name:'done',args:{}}];let turn=0;
  const inner=mode==='native'?{step:async()=>({calls:[{id:`c${turn}`, ...calls[turn++]}]})}:undefined;
  const script=mode==='json'?calls.map(c=>({text:JSON.stringify({[c.name]:c.name==='done'?true:c.args})})):undefined;
  const provider=inner ?? await createProvider({provider:'mock',script});
  await runAgent({name:'测试居民',token:created.agentToken,server:env.base,lang:'zh',toolMode:mode,actionTools:'typed'},{client:createClient({server:env.base,token:created.agentToken}),provider,log:{info(){},warn(){},error(){}},maxRounds:1,waitWake:false,wait:async()=>{},onWaking:(agentId,rec)=>store.append(agentId,rec)});
  const rows=readFileSync(file,'utf8').trim().split('\n').map(JSON.parse),acts=rows.flatMap(r=>r.acts);
  assert.equal(acts[0]?.type,'gather');assert.equal(acts[0]?.ok,true,JSON.stringify(acts));
  assert.deepEqual(acts[1],{type:'repair',ok:false,error:'insufficient_materials'});
  assert.equal(readFileSync(file,'utf8').includes('PRIVATE_SOUL'),false);
  const reloaded=new TraceStore({file,premise:5});assert.equal(reloaded.agentsDay(reloaded.today()).agents[0].acts,2);
 }finally{if(env)await env.close();rmSync(dir,{recursive:true,force:true});}
});
