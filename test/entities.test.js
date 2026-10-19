import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import e2 from '../src/e2/facade.js';
import { adminCommand } from '../src/e2/engine/admin.js';
import { createWorld } from '../src/e2/world.js';
import { runActions } from '../src/e2/engine/actions.js';
import { makeAgent } from '../src/e2/engine/lifecycle.js';
import { stateHash } from '../src/store.js';
import { source } from '../src/e2/engine/ledger.js';
import { razePlace } from '../src/e2/engine/dismantle.js';
import { withCity } from '../src/e2/engine/cities.js';
const physics = JSON.parse(readFileSync(new URL('./fixtures/p7-hidden-physics.json',import.meta.url)));
export const plant = () => ({name:'盐滩植物',description:'居民定义的试验对象',attributes:[{key:'water',label:'含水程度',min:0,max:100,initial:60},{key:'growth',label:'生长程度',min:0,max:100,initial:0}],daily:[{attribute:'water',delta:-5},{if:{field:'water',op:'gte',value:30},attribute:'growth',delta:1}],interactions:[{key:'care',label:'养护',rules:[{attribute:'water',delta:10}]}]});
export function fixture(enable=true) {
 const w=createWorld({seed:'entities',premise:7,hiddenPhysics:physics,lawSemanticsVersion:2});
 const people=['小盏','同行'].map(name=>{const a=makeAgent(w,{name,lang:'zh',soul:'观察',kind:'external',energy:1000000,coins:0,place:'saltflats'});a.tokens.cap=10000000;a.city='north';source(w,'energy','admin',a.energy);return a;});
 const p=structuredClone(Object.values(w.places).find(p=>!p.open && p.condition !== null && !p.landmark));Object.assign(p,{id:'garden',name:'盐滩小圃',city:null,owner:{kind:'agent',id:people[0].id},modules:[],materialRecoverable:0});w.places[p.id]=p;
 people.forEach(a=>a.place=p.id);
 let wake=0;
 const act=(a,args)=>{e2.applyCommand(w,{type:'meter',payload:{op:'wake',agentId:a.id,wakeId:`entity-wake-${++wake}`,day:'2026-10-18',kind:'main',system:0,brief:0,delivered:0}});a=w.agents[a.id];a.actsThisTick=0;const result=e2.applyCommand(w,{type:'act',payload:{agentId:a.id,requestId:`entity-act-${wake}`,experimentGeneration:0,actions:[{type:'entity',...args}],meter:{wakeId:`entity-wake-${wake}`,day:'2026-10-18',reread:0}}}).result;assert.equal(result.ok,true,JSON.stringify(result));return result.results[0];};
 const good=(a,args)=>{const r=act(a,args);assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
 const cmd=(type,payload={})=>e2.applyCommand(w,{type,payload});
 if(enable)assert.equal(cmd('admin',{op:'entities',args:{version:1}}).result.ok,true);
 return {w,a:people[0],b:people[1],p,act,good,cmd};
}
test('activation is explicit, idempotent and keeps old worlds unchanged',()=>{
 const {w}=fixture(false), cmd=(_,p)=>({result:adminCommand(w,p)}),h=stateHash(w);assert.equal(w.entities,undefined);
 assert.equal(cmd('admin',{op:'entities',args:{version:2}}).result.ok,false);assert.equal(stateHash(w),h);
 assert.equal(cmd('admin',{op:'entities',args:{version:1}}).result.ok,true);const after=stateHash(w);
 assert.equal(cmd('admin',{op:'entities',args:{version:1}}).result.ok,true);assert.equal(stateHash(w),after);
});
test('define, create, natural daily evolution, care and repeatable observations',()=>{
 const {w,a,b,good,cmd}=fixture();const definition=good(a,{op:'define',spec:plant()}).definition;
 const entity=good(a,{op:'create',definition,name:'样株一号'}).entity;
 const first=good(a,{op:'observe',entity}).observation;assert.deepEqual(first.values,{water:60,growth:0});
 for(let i=0;i<12;i++)assert.equal(cmd('tick').result.ok,true);
 const second=good(a,{op:'observe',entity}).observation;assert.deepEqual(second.values,{water:55,growth:1});
 good(a,{op:'interact',entity,operation:'care'});
 const third=good(b,{op:'observe',entity}).observation;assert.deepEqual(third.values,{water:65,growth:1});
 assert.deepEqual(good(a,{op:'observe',entity}).observation.values,third.values);
 assert.deepEqual(first.values,{water:60,growth:0});
 const pub=JSON.stringify(e2.publicState(w));assert.ok(pub.includes('样株一号'));assert.ok(!pub.includes('lastSettledDay'));
});
test('remote actions, unauthorized edits and unsafe definitions are rejected',()=>{
 const {w,a,b,good,act}=fixture();const definition=good(a,{op:'define',spec:plant()}).definition;
 const entity=good(a,{op:'create',definition,name:'样株'}).entity;
 assert.equal(act(b,{op:'interact',entity,operation:'care'}).error.code,'not_allowed');
 w.agents[b.id].place='saltflats';assert.equal(act(b,{op:'observe',entity}).error.code,'wrong_place');
 for(const spec of [{...plant(),code:'return 1'}, {...plant(),daily:[{attribute:'treasury',delta:10}]}, {...plant(),daily:[{attribute:'water',delta:Infinity}]}, {...plant(),daily:[{if:{field:'weather',op:'eq',value:'drought'},attribute:'water',delta:-10}]}, {...plant(),attributes:[{key:'__proto__',label:'bad',min:0,max:1,initial:0}]}]){
  const before=JSON.stringify(w.entities);assert.equal(act(a,{op:'define',spec}).ok,false);assert.equal(JSON.stringify(w.entities),before);
 }
});
test('capacity, building ownership transfer, archive, decay and demolition',()=>{
 const {w,a,b,good,act,cmd}=fixture();const definition=good(a,{op:'define',spec:plant()}).definition;
 const e1=good(a,{op:'create',definition,name:'一'}).entity;good(a,{op:'create',definition,name:'二'});
 assert.equal(act(a,{op:'create',definition,name:'三'}).error.code,'limit_reached');
 w.places.garden.owner={kind:'agent',id:b.id};assert.equal(act(a,{op:'interact',entity:e1,operation:'care'}).error.code,'not_allowed');
 good(b,{op:'archive',entity:e1});assert.equal(act(b,{op:'interact',entity:e1,operation:'care'}).ok,false);
 const e3=good(b,{op:'create',definition,name:'三'}).entity;
 w.places.garden.condition=2000;assert.equal(act(b,{op:'interact',entity:e3,operation:'care'}).ok,false);assert.equal(good(b,{op:'observe',entity:e3}).observation.values.water,60);
 razePlace(w,w.places.garden);assert.equal(w.entities.instances[e3].status,'destroyed');
 Object.assign(w.places.garden,{razed:false,open:false,condition:10000,owner:{kind:'agent',id:b.id}});
 for(let i=0;i<12;i++)cmd('tick');assert.equal(w.entities.instances[e3].status,'destroyed');
 assert.equal(w.entities.instances[e1].status,'archived');
});
test('daily rules use local weather and deterministic order, never another city',()=>{
 const {w,a,b,good,cmd}=fixture();const spec=plant();spec.daily=[{attribute:'water',delta:-5},{if:{field:'weather',op:'eq',value:'fog'},attribute:'water',delta:20},{if:{field:'water',op:'gte',value:70},attribute:'growth',delta:1}];
 const definition=good(a,{op:'define',spec}).definition;
 const garden=w.places.garden;garden.city='north';withCity(w,'north',()=>{w.weather.active=[{type:'fog',startDay:0,endDay:10}];});
 const e1=good(a,{op:'create',definition,name:'北'}).entity;
 w.places.other={...structuredClone(garden),id:'other',city:'west',owner:{kind:'agent',id:b.id}};b.place='other';
 const e2id=good(b,{op:'create',definition,name:'西'}).entity;
 for(let i=0;i<12;i++)assert.equal(cmd('tick').result.ok,true);
 assert.deepEqual(good(a,{op:'observe',entity:e1}).observation.values,{water:75,growth:1});
 assert.deepEqual(good(b,{op:'observe',entity:e2id}).observation.values,{water:55,growth:0});
});

test('activated catalogs reach typed tools, prompt and disabled-world schemas',async()=>{
 const {typedActionTools,typedActSchema,validateAction,schemaIssues}=await import('../runner/action-tools.js');
 const {toolDefs,parseToolJson}=await import('../runner/loop.js');
 const {buildSystemPrompt}=await import('../runner/prompt.js');
 const {w,a,good}=fixture();
 const p={premise:7,entities:{version:1}};
 assert.equal(typedActionTools('zh',{premise:7}).some(t=>t.name==='entity'),false);
 assert.equal(typedActionTools('zh',{premise:7,entities:true}).some(t=>t.name==='entity'),true);
 assert.ok(toolDefs('zh',{premise:7,entities:true})[0].schema.properties.what.enum.includes('entity_definitions'));
 const action={type:'entity',op:'define',spec:plant()};
 assert.deepEqual(validateAction(action,p),[]);assert.deepEqual(schemaIssues({actions:[action]},typedActSchema(7,false,false,true)),[]);
 assert.equal(parseToolJson(JSON.stringify({entity:{op:'define',spec:plant()}}),{premise:7,entities:true,actionTools:'typed'}).calls[0].name,'entity');
 assert.match(buildSystemPrompt({protocol:2,premise:7,entities:true}),/entity_definitions/);
 assert.ok(e2.buildPerception(w,a.id).entities);
 assert.ok(e2.publicState(w).world.entities);
});
test('laws can forbid entity operations without bypassing existing world activation',async()=>{
 const {validateRules}=await import('../src/e2/rules/check.js');
 const {w,a,good,act}=fixture();
 const rules=[{when:'before:entity',if:"args.op == 'interact'",do:[{op:'deny',reason:'禁止养护'}]}];
 assert.equal(validateRules(rules,{scope:{kind:'place',id:'garden',premise:7}}).ok,false);
 const checked=validateRules(rules,{scope:{kind:'place',id:'garden',premise:7,entities:true}});
 assert.equal(checked.ok,true,JSON.stringify(checked));
 const definition=good(a,{op:'define',spec:plant()}).definition,entity=good(a,{op:'create',definition,name:'样株'}).entity;
 // Install through the ordinary rules action, including its own validation path.
 a.actsThisTick=0;const installed=runActions(w,w.agents[a.id],[{type:'rules',place:'garden',rules}])[0];assert.equal(installed.ok,true,JSON.stringify(installed));
 assert.equal(act(a,{op:'interact',entity,operation:'care'}).error.code,'forbidden');
 assert.deepEqual(good(a,{op:'observe',entity}).observation.values,{water:60,growth:0});
});
test('remote views show only metadata and recorded observations, with bounded cursors',async()=>{
 const {entityLook}=await import('../src/e2/entities/views.js');const {w,a,good}=fixture();
 const definition=good(a,{op:'define',spec:plant()}).definition,entity=good(a,{op:'create',definition,name:'样株'}).entity;
 assert.equal(entityLook(w,'entities',{id:entity}).items[0].values,undefined);
 assert.deepEqual(entityLook(w,'entity_observations',{id:entity}).items,[]);
 const first=good(a,{op:'observe',entity}).observation;
 good(a,{op:'interact',entity,operation:'care'});
 assert.equal(entityLook(w,'entity_observations',{id:entity}).items[0].values.water,60);
 assert.equal(e2.publicPlace(w,'garden').entities.items[0].values,undefined);
 for(let i=0;i<34;i++)good(a,{op:'observe',entity});
 const page=entityLook(w,'entity_observations',{id:entity,limit:2});assert.equal(page.items.length,2);assert.ok(page.dropped>0);assert.ok(page.next);
 const next=entityLook(w,'entity_observations',{id:entity,after:page.next,limit:2});assert.notEqual(page.items[0].id,next.items[0].id);
 assert.throws(()=>entityLook(w,'entity_observations',{id:entity,after:first.id}));
});

test('definitions remain immutable and reject reserved resource keys and dissolved managers',()=>{
 const {w,a,good,act}=fixture();const first=good(a,{op:'define',spec:plant()}).definition;
 const entity=good(a,{op:'create',definition:first,name:'原样株'}).entity;
 const changed=plant();changed.attributes[0].initial=90;changed.daily=[];
 const second=good(a,{op:'define',spec:changed}).definition;assert.notEqual(first,second);
 assert.equal(w.entities.instances[entity].definition,first);assert.equal(w.entities.definitions[first].spec.attributes[0].initial,60);
 const invalid=plant();invalid.attributes[0].key='coins';invalid.daily=[];invalid.interactions=[];
 assert.equal(act(a,{op:'define',spec:invalid}).ok,false);
 w.agents[a.id].actsThisTick=0;const founded=runActions(w,w.agents[a.id],[{type:'found',name:'观察社',manifesto:'共同观察'}])[0];assert.equal(founded.ok,true,JSON.stringify(founded));const group=Object.values(w.groups).find(g=>g.name==='观察社');group.dissolved=true;w.places.garden.owner={kind:'group',id:group.id};
 assert.equal(act(a,{op:'interact',entity,operation:'care'}).ok,false);
});

test('entities and program-service activation remain independent in resident perception',async()=>{
 const {enablePrograms}=await import('../src/e2/programs/core.js');
 const entityOnly=fixture();assert.equal(e2.buildPerception(entityOnly.w,entityOnly.a.id).programServices,undefined);
 const programOnly=fixture(false);assert.equal(enablePrograms(programOnly.w,{version:1}).ok,true);
 const p=e2.buildPerception(programOnly.w,programOnly.a.id);assert.equal(p.entities,undefined);assert.equal(p.programServices.version,1);
 entityOnly.cmd('admin',{op:'program_services',args:{version:1}});const both=e2.buildPerception(entityOnly.w,entityOnly.a.id);assert.equal(both.entities.version,1);assert.equal(both.programServices.version,1);
});


test('resident field views expose slots and permission facts without live values', async () => {
 const {residentPlaceEntities}=await import('../src/e2/entities/views.js');
 const {renderBrief,renderLook,renderWake}=await import('../runner/render-p2.js');
 const {w,a,b,good}=fixture();
 let p=e2.buildPerception(w,a.id,{ack:false});
 assert.equal(p.here.entities.capacity,2); assert.equal(p.here.entities.available,2);
 assert.equal(p.here.entities.manager,true); assert.equal(p.here.entities.createBlock,null);
 for(const text of [renderBrief(p,{brief:'short'}),renderBrief(p,{brief:'full'}),renderLook(p,'here'),renderLook(p,'actions'),renderWake(p)]) {
  assert.match(text,/entity_help/); assert.match(text,/承载位空闲 2\/2/);
 }
 assert.match(renderLook(p,'actions'),/entity ✓/);
 assert.equal(residentPlaceEntities(w,b).createBlock,'not_manager');
 const definition=good(a,{op:'define',spec:plant()}).definition;
 const entity=good(a,{op:'create',definition,name:'样株'}).entity;
 good(a,{op:'observe',entity});good(a,{op:'interact',entity,operation:'care'});
 p=e2.buildPerception(w,a.id,{ack:false});
 assert.deepEqual(Object.keys(p.here.entities.items[0]).sort(),['definition','id','name','status']);
 assert.equal(JSON.stringify(p.here.entities).includes('water'),false);
 good(a,{op:'create',definition,name:'二'});assert.equal(residentPlaceEntities(w,a).createBlock,'full');
 w.places.garden.condition=2000;
 assert.equal(residentPlaceEntities(w,a).available,0);assert.equal(residentPlaceEntities(w,a).createBlock,'condition');
 good(a,{op:'archive',entity});assert.equal(residentPlaceEntities(w,a).occupied,1);
 w.places.garden.owner={kind:'city'};assert.equal(residentPlaceEntities(w,a).capacity,0);
 w.groups.g_entity={id:'g_entity',steward:a.id,dissolved:false};w.places.garden.owner={kind:'group',id:'g_entity'};
 assert.equal(residentPlaceEntities(w,a).manager,true);
 w.groups.g_entity.dissolved=true;assert.equal(residentPlaceEntities(w,a).capacity,0);assert.equal(residentPlaceEntities(w,a).manager,false);
 w.places.garden.owner={kind:'agent',id:a.id};w.places.garden.razed=true;
 assert.equal(residentPlaceEntities(w,a).createBlock,'ineligible');
 const disabled=fixture(false);const before=stateHash(disabled.w);
 assert.equal(e2.buildPerception(disabled.w,disabled.a.id,{ack:false}).here.entities,undefined);
 assert.equal(stateHash(disabled.w),before);
});

test('entity help gives executable returned-ID steps and a real daily change', async () => {
 const {entityLook}=await import('../src/e2/entities/views.js');
 const {buildSystemPrompt}=await import('../runner/prompt.js');
 const {typedActionTools}=await import('../runner/action-tools.js');
 for(const lang of ['zh','en']) {
  const {w,a,good,cmd}=fixture();const before=stateHash(w),help=entityLook(w,'entity_help',{},lang);
  assert.equal(stateHash(w),before);assert.ok([...JSON.stringify(help)].length<=2600);
  const [define,create,observe]=help.steps.map(x=>x.action);
  const {type:unused,...defineArgs}=define;
  const definition=good(a,defineArgs).definition;
  const {type:unused2,...createArgs}=create;
  const entity=good(a,{...createArgs,definition}).entity;
  const {type:unused3,...observeArgs}=observe;
  assert.equal(good(a,{...observeArgs,entity}).observation.values.count,0);
  for(let i=0;i<12;i++)cmd('tick');
  assert.equal(good(a,{...observeArgs,entity}).observation.values.count,1);
  const prompt=buildSystemPrompt({protocol:2,premise:7,entities:true,lang});
  assert.match(prompt,/entity_help/);
  assert.doesNotMatch(prompt,/一个地方能做什么，取决于它装了什么|What a place can do depends on what it is fitted with/);
  assert.match(typedActionTools(lang,{premise:7,entities:true}).find(t=>t.name==='entity').description,/entity_help/);
 }
 const disabled=fixture(false);assert.throws(()=>entityLook(disabled.w,'entity_help'));
});
