import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import e2 from '../../../src/e2/facade.js';
import { createWorld } from '../../../src/e2/world.js';
import { cpLength } from '../../../src/text.js';
import { cooperationText } from '../../../src/e2/cooperation/views.js';
import { renderBrief } from '../../../runner/render-p2.js';
import { buildSystemPrompt,promptParams } from '../../../runner/prompt.js';
import { toolDefs } from '../../../runner/loop.js';
import { wakeCore,lookCore } from '../../../src/http/tokens.js';
const hiddenPhysics={version:1,regrowth:{baseByZone:{wilds:20,scrapyard:15,solarfield:10},thresholdByZone:{wilds:30,scrapyard:25,solarfield:15},factorPermille:500},construction:{fullActionsPerTick:2,factorPermille:500}};
const w=createWorld({id:'measure-cooperation',seed:'measure-cooperation',premise:6,hiddenPhysics});
const exec=(type,payload={})=>e2.applyCommand(w,{type,payload});
const people=['问潮','禾灯'].map((name,i)=>exec('account',{op:'create',accountId:`measure-${i}`,name,requestId:`create-${i}`,soul:'独立判断',model:'mock',lang:'zh',dailyCap:1000000}).result.agentId);
const measurements=[];
function measure(label){
  const base=structuredClone(w);delete base.cooperation;
  const render=world=>{const p=e2.buildPerception(world,people[0],{lang:'zh',ack:false});return {brief:cpLength(renderBrief(p,{lang:'zh'})),system:cpLength(buildSystemPrompt({...promptParams(p),actionTools:'typed',toolMode:'native'})),tools:cpLength(JSON.stringify(toolDefs('zh',{premise:6,actionTools:'typed',cooperation:!!p.cooperation})))};};
  const baseline=render(base),enabled=render(w),delta=Object.fromEntries(Object.keys(baseline).map(k=>[k,enabled[k]-baseline[k]]));
  measurements.push({label,baseline,enabled,delta});
}
exec('admin',{op:'cooperation',args:{version:1}});measure('enabled_unused');
let serial=0;
function act(id,action){if(w.agents[id].actsThisTick>=4)exec('tick');const wakeId=`measure-${++serial}`;exec('meter',{op:'wake',agentId:id,wakeId,day:'2026-10-14',kind:'main',system:0,brief:0,delivered:0});const r=exec('act',{agentId:id,requestId:`measure-action-${serial}`,experimentGeneration:0,actions:[action],meter:{wakeId,day:'2026-10-14',reread:0}}).result.results[0];if(!r.ok)throw Error(JSON.stringify(r));return r.data;}
const card=act(people[0],{type:'card',op:'create',title:'修井经验',body:'检查井况与物料，确认协作分工，维修后保存真实结果。'.repeat(60),visibility:'public'});
const q=act(people[0],{type:'collaborate',op:'create',title:'共同维护源井',goal:'一次可接续的维护',tasks:['检查','交付'],visibility:'public',agents:[people[1]]});
act(people[1],{type:'collaborate',op:'join',id:q.id});act(people[0],{type:'relation',op:'note',agent:people[1],text:'已经确认参与，后续看实际交付。'});measure('card_collaboration_note');
const page=cooperationText(w,'cards',{id:card.id},people[1]);
const ctx={cfg:{shellTz:'Asia/Shanghai'},rt:{w,engine:e2,cfg:{shellTz:'Asia/Shanghai'},exec:(type,payload)=>e2.applyCommand(w,{type,payload}),nextTickAt:null},wakings:new Map(),looks:new Map()};
const wake=wakeCore(ctx,people[1],{kind:'main',lang:'zh'},'zh');if(wake.status!==200)throw Error(JSON.stringify(wake));
const first=lookCore(ctx,people[1],{wakeId:wake.json.wakeId,what:'cards',id:card.id,turn:1},'zh');
const second=lookCore(ctx,people[1],{wakeId:wake.json.wakeId,what:'cards',id:card.id,version:first.json.version,offset:first.json.nextOffset,turn:2},'zh');
const output={unit:'Unicode code points, not provider tokens',measurements,readExample:{firstPageCharacters:cpLength(page.text),nextOffset:page.nextOffset,firstBill:first.json.bill,secondBill:second.json.bill,totalReturnedCharacters:ctx.wakings.get(people[1]).cooperationRead},providerCalls:0,limits:{brief:400,page:1200,wakingReads:3600}};
writeFileSync(fileURLToPath(new URL('./context-measurements.json',import.meta.url)),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
