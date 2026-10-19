import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { boot } from './http-helpers.js';
import { wakeCore,lookCore,tokenStatus } from '../src/http/tokens.js';
import { actCore } from '../src/http/agent.js';
import { managedClient } from '../src/runner/managed-client.js';
import { runWaking4 } from '../runner/loop.js';
import { createMcp } from '../mcp/server.js';
import { stateHash } from '../src/store.js';
import { replayDir } from '../src/tools/replay.js';
import { Runtime } from '../src/runtime.js';
const spec={name:'盐滩植物',description:'居民设计的试验对象',attributes:[{key:'water',label:'含水程度',min:0,max:100,initial:60}],daily:[{attribute:'water',delta:-5}],interactions:[{key:'care',label:'养护',rules:[{attribute:'water',delta:10}]}]};
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'entity-integration-')),file=join(dir,'physics.json');writeFileSync(file,readFileSync(new URL('./fixtures/p7-hidden-physics.json',import.meta.url)));
 const env=await boot({physics:2,premise:7,map:'island-three-v1',hiddenPhysicsFile:file,shellSlots:0},{dir});const ctx=env.app.ctx;let n=0;
 const people=['小盏','同行'].map((name,i)=>{const r=env.rt.exec('account',{op:'create',accountId:`entity-user-${i}`,name,requestId:`create-${i}`,soul:'观察世界',lang:'zh',model:'mock',dailyCap:10000000,city:'north'}).result;assert.equal(r.ok,true,JSON.stringify(r));return r.agentId;});
 const wake=id=>{const r=wakeCore(ctx,id,{kind:'main',lang:'zh',actionTools:'typed'},'zh');assert.equal(r.status,200,JSON.stringify(r));return r.json;};
 const act=(id,action)=>{if(env.rt.w.agents[id].actsThisTick>=4)env.rt.exec('tick');const wakeId=wake(id).wakeId;return actCore(ctx,id,{wakeId,requestId:`entity-${++n}`,experimentGeneration:0,actions:[action]},'zh');};
 return Object.assign(env,{ctx,people,wake,act});
}
const good=r=>{assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.json.results[0].ok,true,JSON.stringify(r));return r.json.results[0].data;};
test('HTTP creation, real construction, paid observations, duplicate requests, public views, restart and genesis replay',async()=>{
 const env=await fixture();try {
  const [a,b]=env.people,w=env.rt.w;
  const activation=await env.call('/api/admin/entities',{method:'POST',admin:true,body:{version:1}});assert.equal(activation.status,200,JSON.stringify(activation));
  assert.ok(tokenStatus(env.ctx,a).entities);assert.match(env.wake(a).system,/entity_definitions/);
  env.rt.exec('admin',{op:'adjust',args:{agentId:a,energy:1000000,reason:'隔离测试建设预算'}});
  good(env.act(a,{type:'move',to:'saltflats'}));good(env.act(a,{type:'gather',amount:10}));good(env.act(a,{type:'gather',amount:5}));
  const project=good(env.act(a,{type:'initiate',build:'site',lot:'wilds-lot-5',name:'盐滩小圃',description:'观察虚拟样株'})).project;
  good(env.act(a,{type:'contribute',project,energy:w.projects[project].needEnergy,materials:15}));
  for(let i=0;i<10&&w.projects[project].status!=='built';i++)good(env.act(a,{type:'construct',project}));
  assert.equal(w.projects[project].status,'built');const place=w.projects[project].result;good(env.act(a,{type:'move',to:place}));
  const definition=good(env.act(a,{type:'entity',op:'define',spec})).definition,entity=good(env.act(a,{type:'entity',op:'create',definition,name:'样株一号'})).entity;
  const first=good(env.act(a,{type:'entity',op:'observe',entity})).observation;assert.equal(first.values.water,60);
  // Crossing a real day boundary changes state even when no-one observes it.
  const day=Math.floor(w.clock.tick/12);while(Math.floor(w.clock.tick/12)===day)env.rt.exec('tick');
  const page=lookCore(env.ctx,b,{wakeId:env.wake(b).wakeId,what:'entities',id:entity},'zh');assert.equal(page.status,200);assert.equal(JSON.parse(page.json.text).items[0].values,undefined);
  const obs=lookCore(env.ctx,b,{wakeId:env.wake(b).wakeId,what:'entity_observations',id:entity},'zh');assert.equal(JSON.parse(obs.json.text).items[0].values.water,60);
  good(env.act(b,{type:'move',to:place}));
  const body={wakeId:env.wake(b).wakeId,requestId:'observation-once',experimentGeneration:0,actions:[{type:'entity',op:'observe',entity}]};
  const r=actCore(env.ctx,b,body,'zh');assert.equal(good(r).observation.values.water,55);
  const balance=w.agents[b].energy+w.agents[b].basic,records=w.entities.instances[entity].observations.length;
  assert.deepEqual(actCore(env.ctx,b,body,'zh'),r);assert.equal(w.agents[b].energy+w.agents[b].basic,balance);assert.equal(w.entities.instances[entity].observations.length,records);
  assert.ok(w.agents[b].tokens.bill.read>0);
  const publicPlace=env.rt.engine.publicPlace(w,place);assert.equal(publicPlace.entities.items[0].values,undefined);assert.equal(publicPlace.entities.items[0].observations.at(-1).values.water,55);
  assert.equal(env.rt.engine.checkConservation(w).ok,true);
  env.rt.snapshot();const expected=stateHash(w),replay=replayDir(env.rt.dir);assert.equal(stateHash(replay.world),expected,JSON.stringify(replay.diff));
  const restored=Runtime.open(env.cfg,{version:'test',logger:{}});try{assert.equal(stateHash(restored.w),expected);}finally{restored.close();}
 }finally{await env.close();}
});
test('managed runner and MCP discover, create and query public definitions',async()=>{
 const env=await fixture();try {
  env.rt.exec('admin',{op:'entities',args:{version:1}});const [a]=env.people;
  const client=managedClient(env.ctx,a,()=>true,new AbortController().signal);let turn=0;
  const S={client,cfg:{toolMode:'native',actionTools:'typed',lang:'zh'},provider:{async step(){return {text:'',calls:++turn===1?[{id:'define-call',name:'entity',args:{op:'define',spec}}]:[{id:'done-call',name:'done',args:{}}]};}},log:{info(){},warn(){},error(){}},deps:{},report(){},history:[],looks:{tick:-1,n:0},wakes:{tick:-1,n:0},system:null,cursor:0};
  const result=await runWaking4(S,tokenStatus(env.ctx,a),{kind:'main'});assert.equal(result.rec.capabilities.features.entities,true);assert.equal(result.rec.toolAttempts[0].tool,'entity');assert.equal(Object.keys(env.rt.w.entities.definitions).length,1,JSON.stringify(result));
  const fetch=async(url,options={})=>{const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):{};const r=path==='/api/me'?await client.me():path==='/api/me/wake'?await client.wake(body):path==='/api/me/look'?await client.look(body):path==='/api/me/rules'?await client.rules(body):await client.act(body);return new Response(JSON.stringify(r.json),{status:r.status});};
  const mcp=createMcp({env:{HOUREN_SERVER:'http://127.0.0.1:9876',HOUREN_TOKEN:'local-test',HOUREN_LANG:'zh'},fetch});
  const listed=await mcp.handle({jsonrpc:'2.0',id:1,method:'tools/list'});assert.ok(listed.result.tools.find(t=>t.name==='houren_look').inputSchema.properties.what.enum.includes('entities'));
  assert.ok(listed.result.tools.find(t=>t.name==='houren_look').inputSchema.properties.what.enum.includes('entity_help'));
  const call=(name,args={})=>mcp.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name,arguments:args}});
  await call('houren_perceive');
  const help=await call('houren_look',{what:'entity_help'});assert.match(JSON.stringify(help),/每日计数器/);assert.match(JSON.stringify(help),/RETURNED_DEFINITION_ID/);
  const page=await call('houren_look',{what:'entity_definitions'});assert.match(JSON.stringify(page),/盐滩植物/);
  const saved=await call('houren_act',{actions:[{type:'entity',op:'define',spec:{...spec,name:'第二种样株'}}]});assert.equal(Object.keys(env.rt.w.entities.definitions).length,2,JSON.stringify(saved));
 }finally{await env.close();}
});
