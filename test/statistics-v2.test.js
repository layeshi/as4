import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import e2 from '../src/e2/facade.js';
import { createWorld, genesisOpts } from '../src/e2/world.js';
import { makeAgent } from '../src/e2/engine/lifecycle.js';
import { source } from '../src/e2/engine/ledger.js';
import { coinScratch, stripCoins } from '../src/e2/p6/coins.js';
import { STEPS } from '../src/e2/engine/tick.js';
import { stateHash,writeSnapshot,worldDir } from '../src/store.js';
import { Runtime } from '../src/runtime.js';
import { replayDir } from '../src/tools/replay.js';
import { validateRules } from '../src/e2/rules/check.js';
import { createLaw } from '../src/e2/engine/laws.js';
import { runEnact,citySet } from '../src/e2/engine/rules.js';
const hiddenPhysics={version:1,regrowth:{baseByZone:{wilds:20,scrapyard:15,solarfield:10},thresholdByZone:{wilds:30,scrapyard:25,solarfield:15},factorPermille:500},construction:{fullActionsPerTick:2,factorPermille:500}};
const islandPhysics=JSON.parse(readFileSync(new URL('./fixtures/p7-hidden-physics.json',import.meta.url),'utf8'));
const world=(premise=6,statisticsVersion=2)=>createWorld({seed:'statistics-v2',premise,statisticsVersion,tokens:{capacity:6000,basic:4000},hiddenPhysics:premise===7?islandPhysics:hiddenPhysics});
const cmd=(w,type,payload={})=>e2.applyCommand(w,{type,payload});
function repairFixture(version=2){
 const w=world(6,version),a=makeAgent(w,{name:'维修员',lang:'zh',soul:'观察',kind:'external',energy:1000000,coins:0,place:'well'});
 source(w,'energy','admin',a.energy);a.tokens.cap=1000000;a.materials=20;w.materialZones.scrapyard.stock-=20;w.places.well.condition=8000;
 let n=0;
 const act=actions=>{const wakeId=`statistics-wake-${++n}`;assert.equal(cmd(w,'meter',{op:'wake',agentId:a.id,wakeId,day:'2026-10-20',kind:'main',system:0,brief:0,delivered:0}).result.ok,true);return cmd(w,'act',{agentId:a.id,requestId:`statistics-act-${n}`,experimentGeneration:0,actions,meter:{wakeId,day:'2026-10-20',reread:0}});};
 return {w,a,act};
}
function metricFixture(version){
 const w=world(7,version);coinScratch(w);
 const logs=[w.dayLog,...['north','west','east'].map(id=>w.cities[id].dayLog)];
 logs.forEach((g,i)=>{Object.assign(g.p4,{wakes:i+1,basicIssued:1000*(i+1),custody:10*(i+1),read:100*(i+1)});g.p2.anonymousWhispers=i+1;g.p1.imparts=i+1;g.scripts={han:i+1,latin:2*(i+1)};g.births=Array.from({length:i+1},()=>({authors:Array.from({length:i%3+1},(_,n)=>`a${n+1}`),memories:i+1}));});
 STEPS.metrics(w,0);stripCoins(w);return {w,m:w.metrics.at(-1)};
}
test('statistics v2 aggregates all four contexts, including nested counters and script distribution',()=>{
 const {m}=metricFixture(2);
 assert.deepEqual(Object.fromEntries(['wakes','basicIssued','custody','read'].map(k=>[k,m.p4[k]])),{wakes:10,basicIssued:10000,custody:100,read:1000});
 assert.equal(m.anonymousWhispers,10);assert.equal(m.imparts,10);assert.deepEqual(m.scripts,{han:10,latin:20});
 assert.ok(Math.abs(m.scriptEntropy-0.9183)<0.001);assert.equal(m.awake,0);
 assert.equal(m.births,10);assert.equal(m.birthsSolo,5);assert.equal(m.birthsPair,2);assert.equal(m.birthsGroup,3);assert.equal(m.inheritedMemories,30);
});
test('statistics v1 retains historical aggregation, while new P6/P7 worlds record their version in genesis',()=>{
 const {m,w}=metricFixture(1);assert.equal(m.p4.wakes,2);assert.equal(m.anonymousWhispers,2);assert.equal(w.statistics,undefined);
 for(const premise of [6,7]){
  const fresh=createWorld({seed:'default-statistics',premise,hiddenPhysics:premise===7?islandPhysics:hiddenPhysics});
  assert.equal(fresh.statistics?.version,2);assert.equal(fresh.genesis.statisticsVersion,2);
  assert.equal(stateHash(createWorld(genesisOpts(fresh))),stateHash(fresh));
 }
});
test('island rule stocks count a global group charter once alongside all three cities',()=>{
 const w=world(7,2);coinScratch(w);STEPS.metrics(w,0);const before=w.metrics.at(-1).rulesActive;
 const checked=validateRules([{when:'daily',do:[{op:'announce',to:'all',text:'全岛说明'}]}],{scope:{kind:'group',premise:7}});
 assert.equal(checked.ok,true,JSON.stringify(checked));
 w.groups.g1={id:'g1',members:[],dissolved:false,bylaws:{rules:checked.rules,fingerprints:checked.fingerprints}};
 STEPS.metrics(w,0);assert.equal(w.metrics.at(-1).rulesActive,before+1);
 stripCoins(w);
});
test('legacy genesis reconstruction never silently opts into new statistics',()=>{
 const old=world(6,1),copy=createWorld(genesisOpts(old));
 assert.equal(copy.statistics,undefined);assert.equal(stateHash(copy),stateHash(old));
});
test('statistics migration is explicit, idempotent, validated and does not change balances or resident parameters',()=>{
 const {w,a}=repairFixture(1);w.clock.tick=7;
 const before={energy:a.energy,basic:a.basic,routine:structuredClone(a.routine),tokens:structuredClone(a.tokens)};
 const result=cmd(w,'admin',{op:'statistics',args:{version:2}}).result;
 assert.equal(result.ok,true);assert.equal(w.statistics.version,2);assert.equal(w.statistics.firstCompleteDay,1);
 assert.deepEqual({energy:a.energy,basic:a.basic,routine:a.routine,tokens:a.tokens},before);
 const activation=structuredClone(w.statistics);assert.equal(cmd(w,'admin',{op:'statistics',args:{version:2}}).result.ok,true);assert.deepEqual(w.statistics,activation);
 for(const args of [{version:1},{version:3},{version:2,reset:true}])assert.equal(cmd(w,'admin',{op:'statistics',args}).result.ok,false);
});
test('v2 actual repair expense is recorded once through the command boundary',()=>{
 const {w,a,act}=repairFixture();const before=a.energy;
 const out=act([{type:'repair',energy:50000,materials:5}]);assert.equal(out.result.results[0].ok,true);assert.equal(out.result.results[0].cost,500);
 const flows=w.residentStats[a.id].flows;
 const repair=flows.filter(f=>f.resource==='energy'&&f.kind==='expense'&&['repair','action:repair'].includes(f.reason));
 assert.equal(repair.reduce((n,f)=>n+f.amount,0),500);
 assert.equal(flows.filter(f=>f.resource==='energy'&&f.kind==='expense').reduce((n,f)=>n+f.amount,0),before-a.energy);
 assert.equal(e2.checkConservation(w).ok,true);
});
test('v1 repair history remains byte-compatible with duplicate categories until explicitly migrated',()=>{
 const {w,a,act}=repairFixture(1);act([{type:'repair',energy:50000,materials:5}]);
 const totals=w.residentStats[a.id].totals;assert.equal(totals['energy:expense:repair'],500);assert.equal(totals['energy:expense:action:repair'],500);
});
test('three equal repairs stay three actual expenses, and duplicate request ids add no expenses',()=>{
 const {w,a}=repairFixture();
 const wakeId='repeat-wake';cmd(w,'meter',{op:'wake',agentId:a.id,wakeId,day:'2026-10-20',kind:'main',system:0,brief:0,delivered:0});
 const payload={agentId:a.id,requestId:'same-request',experimentGeneration:0,actions:Array.from({length:3},()=>({type:'repair',energy:1000,materials:1})),meter:{wakeId,day:'2026-10-20',reread:0}};
 const out=cmd(w,'act',payload);assert.ok(out.result.results.every(r=>r.ok));
 const rows=w.residentStats[a.id].flows.filter(f=>f.reason==='repair'&&f.resource==='energy');assert.equal(rows.length,3);assert.equal(rows.reduce((s,f)=>s+f.amount,0),300);
 assert.equal(w.residentStats[a.id].totals['energy:expense:action:repair'],undefined);
 const totals=structuredClone(w.residentStats[a.id].totals);cmd(w,'act',payload);assert.deepEqual(w.residentStats[a.id].totals,totals);
 assert.deepEqual(rows.map(f=>f.actionIndex),[0,1,2]);
});

test('repair, research payment and law fee reconcile separately; failed repair rolls back its charges',()=>{
 const {w,a,act}=repairFixture();
 const b=makeAgent(w,{name:'研究者',lang:'zh',soul:'观察',kind:'external',energy:0,coins:0,place:'library'});
 w.places.library.owner={kind:'agent',id:b.id};
 w.places.library.modules.push({type:'research',policy:{access:'public',agents:[],groups:[],fee:17}});
 const rules=validateRules([{when:'before:repair',do:[{op:'fee',to:`agent('${b.id}')`,energy:'23'}]}],{scope:{kind:'city',premise:6}});
 assert.equal(rules.ok,true,JSON.stringify(rules));
 const law=createLaw(w,{title:'维修收费',text:'规则',author:'humans',rules:rules.rules});law.results=runEnact(w,citySet(law));
 const before=a.energy;
 const out=act([{type:'repair',energy:50000,materials:5,research:'library',maxResearchFee:17}]);
 const r=out.result.results[0];assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.cost,r.data.spent+23);
 const totals=w.residentStats[a.id].totals;
 assert.equal(totals['energy:expense:repair'],r.data.spent);assert.equal(totals['energy:expense:action:repair'],undefined);
 assert.equal(totals['energy:payment:research'],17);assert.equal(totals['energy:payment:law_fee'],23);
 const paid=w.residentStats[a.id].flows.filter(f=>f.resource==='energy'&&['expense','payment'].includes(f.kind)).reduce((n,f)=>n+f.amount,0);
 assert.equal(paid,before-a.energy);assert.equal(w.residentStats[b.id].totals['energy:income:research'],17);assert.equal(w.residentStats[b.id].totals['energy:income:law_fee'],23);
 const oldPaid=structuredClone(totals);
 const fail=act([{type:'repair',energy:50000,materials:0,research:'library',maxResearchFee:17}]);assert.equal(fail.result.results[0].error.code,'insufficient_materials');
 for(const key of ['energy:expense:repair','energy:payment:research','energy:payment:law_fee'])assert.equal(w.residentStats[a.id].totals[key],oldPaid[key]);
 assert.equal(e2.checkConservation(w).ok,true);
});

test('v1 and v2 execute identical actions and preserve every non-statistical world field',()=>{
 const left=repairFixture(1),right=repairFixture(2);
 const actions=[{type:'repair',energy:1000,materials:1},{type:'repair',energy:1000,materials:0},{type:'move',to:'library'}];
 assert.deepEqual(left.act(actions),right.act(actions));
 const business=w=>{const copy=structuredClone(w);delete copy.statistics;delete copy.genesis.statisticsVersion;delete copy.residentStats;delete copy.metrics;return copy;};
 assert.deepEqual(business(left.w),business(right.w));
});

test('legacy runtime recovery crosses explicit statistics activation with identical receipt and semantic replays',()=>{
 const dir=mkdtempSync(join(tmpdir(),'statistics-recovery-'));let rt;
 try{
  const physicsFile=join(dir,'physics.json');writeFileSync(physicsFile,JSON.stringify(hiddenPhysics));
  const initial=world(6,1),cfg={dataDir:dir,worldId:initial.id,physics:2,premise:6,map:'compact-materials-v1',shellSlots:0,hiddenPhysicsFile:physicsFile,tickMs:300000};
  const saved=worldDir(dir,initial.id);writeSnapshot(saved,initial);
  rt=Runtime.open(cfg,{logger:{}});assert.equal(rt.w.statistics,undefined);
  assert.equal(rt.exec('admin',{op:'statistics',args:{version:2}}).result.ok,true);
  rt.exec('tick');const expected=structuredClone(rt.w);rt.close();rt=null;
  writeSnapshot(saved,initial);rt=Runtime.open(cfg,{logger:{}});assert.equal(stateHash(rt.w),stateHash(expected));rt.close();rt=null;
  assert.equal(replayDir(saved).ok,true);
  const semantic=createWorld(genesisOpts(expected));cmd(semantic,'admin',{op:'statistics',args:{version:2}});cmd(semantic,'tick');
  assert.equal(stateHash(semantic),stateHash(expected));
 }finally{rt?.close();rmSync(dir,{recursive:true,force:true});}
});
