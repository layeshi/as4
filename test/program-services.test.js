import { managedClient } from '../src/runner/managed-client.js';
import { createMcp } from '../mcp/server.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from './http-helpers.js';
import { executeProgram } from '../src/e2/programs/executor.js';
import { programLook } from '../src/e2/programs/core.js';
import { wakeCore, lookCore, tokenStatus } from '../src/http/tokens.js';
import { actCore } from '../src/http/agent.js';
import { typedActionTools, typedActSchema, validateAction, schemaIssues } from '../runner/action-tools.js';
import { toolDefs, parseToolJson, runWaking4 } from '../runner/loop.js';
import { buildSystemPrompt } from '../runner/prompt.js';
import { jsonWeight } from '../src/e2/engine/tokens.js';
import { stateHash } from '../src/store.js';
import { replayDir } from '../src/tools/replay.js';
import { Runtime } from '../src/runtime.js';
import { createWorld } from '../src/e2/world.js';
import { enablePrograms } from '../src/e2/programs/core.js';
import { materialLook } from '../src/e2/engine/material-views.js';
const physics={version:1,regrowth:{baseByZone:{wilds:20,scrapyard:15,solarfield:10},thresholdByZone:{wilds:30,scrapyard:25,solarfield:15},factorPermille:500},construction:{fullActionsPerTick:2,factorPermille:500}};
const code = '/* PRIVATE-PROGRAM-SOURCE */ return { affordable: Math.floor(input.budget / input.unitCost) };';
const save = (extra={}) => ({type:'program',op:'save',title:'维修预算',description:'计算可支付数量',inputDescription:'JSON 对象：budget 和 unitCost',code,...extra});
async function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'program-services-')), file=join(dir,'physics.json'); writeFileSync(file,JSON.stringify(physics));
  const env=await boot({physics:2,premise:6,map:'compact-materials-v1',shellSlots:0,hiddenPhysicsFile:file},{dir});
  const people=['作者','买家','旁观居民'].map((name,i)=>env.rt.exec('account',{op:'create',accountId:`user-${i}`,name,requestId:`create-${i}`,soul:'独立判断',lang:'zh',model:'mock',dailyCap:10000000}).result.agentId);
  const ctx=env.app.ctx; let serial=0;
  const wake=id=>{const r=wakeCore(ctx,id,{kind:'main',lang:'zh',actionTools:'typed'},'zh'); assert.equal(r.status,200,JSON.stringify(r)); return r.json;};
  const act=(id,action)=>{if(env.rt.w.agents[id].actsThisTick>=4) env.rt.exec('tick'); const x=wake(id); return actCore(ctx,id,{wakeId:x.wakeId,requestId:`program-${++serial}`,experimentGeneration:0,actions:[action]},'zh');};
  return Object.assign(env,{people,ctx,wake,act});
}
function good(r) { assert.equal(r.status,200,JSON.stringify(r)); assert.equal(r.json.results[0].ok,true,JSON.stringify(r)); return r.json.results[0].data; }
function failed(r,reason) { assert.equal(r.json.results[0].ok,false,JSON.stringify(r)); if(reason)assert.equal(r.json.results[0].error.code,reason); }

test('isolated JavaScript computes real results, handles Unicode and preserves input as data',()=>{
  assert.deepEqual(executeProgram('return input.reduce((a,b)=>a+b,0);','[2,3,5]'),{ok:true,output:'10'});
  const input={s:'"); throw new Error("injected"); // 😀'};
  assert.equal(JSON.parse(executeProgram('return input;',JSON.stringify(input)).output).s,input.s);
  assert.equal(executeProgram('return input;', '{}',{compileOnly:true}).ok,true);
  assert.equal(executeProgram('return (', '{}',{compileOnly:true}).code,'program_syntax');
  assert.equal(executeProgram('}); throw Error(); (function(){', '{}',{compileOnly:true}).ok,false);
});
test('guest cannot access host, load modules, retain state or leak exceptions',()=>{
  for(const body of ['return process.env;', 'return require("node:fs").readFileSync("/etc/passwd");', 'return fetch("https://example.com");','return Date.now();','return Math.random();','return this.constructor.constructor("return process")();','throw new Error("PRIVATE-PROGRAM-SOURCE");']) {
    const r=executeProgram(body,'{}');assert.equal(r.ok,false,body);assert.equal(JSON.stringify(r).includes('PRIVATE-PROGRAM-SOURCE'),false);
  }
  assert.equal(executeProgram('globalThis.saved=42; return true;','{}').ok,true);
  assert.equal(executeProgram('return typeof saved;','{}').output,'"undefined"');
  assert.equal(executeProgram('return import("node:fs");','{}').ok,false);
});
test('loop, recursion, memory, native regex and result/input limits are bounded',()=>{
  for(const body of ['while(true) {}','function recurse(){return recurse()} return recurse();','return "x".repeat(1000000000);','return /^(a+)+$/.test("a".repeat(100)+"!");']) {
    const before=performance.now(); assert.equal(executeProgram(body,'{}').ok,false,body); assert.ok(performance.now()-before<2500);
  }
  for(const body of ['return undefined;','return Promise.resolve(5);','const a={};a.self=a;return a;','return 1n;'])assert.equal(executeProgram(body,'{}').ok,false,body);
  assert.equal(executeProgram('return "x".repeat(5000);','{}').code,'program_output_limit');
  assert.equal(executeProgram('return input;', 'x').code,'invalid_args');
  assert.equal(executeProgram('return input;', JSON.stringify('😀'.repeat(2000))).code,'invalid_args');
});
test('explicit activation and schemas keep disabled/older worlds unchanged',()=>{
  const w=createWorld({seed:'programs',premise:6,hiddenPhysics:physics,lawSemanticsVersion:2});
  const hash=stateHash(w); assert.equal(w.programServices,undefined);
  assert.equal(typedActionTools('zh',{premise:6}).some(t=>t.name==='program'),false);
  assert.doesNotMatch(buildSystemPrompt({protocol:2,premise:6,lang:'zh'}),/JavaScript/);
  assert.equal(enablePrograms(w,{version:2}).ok,false); assert.equal(stateHash(w),hash);
  assert.equal(enablePrograms(w,{version:1}).ok,true); const after=stateHash(w); enablePrograms(w,{version:1});assert.equal(stateHash(w),after);
  assert.equal(enablePrograms(createWorld({seed:'old',premise:5,hiddenPhysics:physics}),{version:1}).ok,false);
  const p={premise:6,programServices:{version:1}};
  for(const action of [save(),{type:'program',op:'test',program:'pg1',input:'{}'},{type:'service_publish',title:'x',description:'y',program:'pg1',price:5},{type:'service_order',service:'sv1',input:'{}'}]) {
    assert.deepEqual(validateAction(action,p),[]);
    assert.deepEqual(schemaIssues({actions:[action]},typedActSchema(6,false,true)),[]);
  }
  assert.ok(toolDefs('zh',{premise:6,programs:true,actionTools:'typed'}).some(t=>t.name==='program'));
  assert.ok(toolDefs('zh',{premise:6,programs:true})[0].schema.properties.what.enum.includes('programs'));
  assert.equal(parseToolJson(JSON.stringify({program:{op:'test',program:'pg1',input:'{}'}}),{premise:6,programs:true,actionTools:'typed'}).calls[0].name,'program');
});
test('save, private paid reads, self-test, publish, purchase, accounting and duplicate requests',async()=>{
  const env=await fixture();try {
    const [a,b,c]=env.people,w=env.rt.w;
    assert.ok(tokenStatus(env.ctx,a).programServices);
    const pg=good(env.act(a,save())).program;
    const awake=env.wake(a), before=w.agents[a].tokens.used;
    const read=lookCore(env.ctx,a,{wakeId:awake.wakeId,what:'programs',id:pg},'zh');
    assert.equal(read.status,200); assert.equal(JSON.parse(read.json.text).code,code);assert.ok(w.agents[a].tokens.used>before);
    const denied=lookCore(env.ctx,b,{wakeId:env.wake(b).wakeId,what:'programs',id:pg},'zh');assert.equal(denied.json.error.code,'not_found');
    assert.throws(()=>programLook(w,{id:'__proto__'},a),/not_found/);
    failed(env.act(b,save({program:pg})),'not_found');failed(env.act(b,{type:'program',op:'test',program:pg,input:'{}'}),'not_found');
    assert.deepEqual(JSON.parse(good(env.act(a,{type:'program',op:'test',program:pg,input:'{"budget":90,"unitCost":20}'})).output),{affordable:4});
    const sv=good(env.act(a,{type:'service_publish',title:'预算计算',description:'自动计算',price:50,program:pg})).service;
    assert.equal(w.services[sv].inputDescription,'JSON 对象：budget 和 unitCost');
    const waking=env.wake(b), body={wakeId:waking.wakeId,requestId:'buy-once',experimentGeneration:0,actions:[{type:'service_order',service:sv,input:'{"budget":100,"unitCost":25}'}]};
    const sellerBefore=w.agents[a].energy, buyerBefore=w.agents[b].energy, readBefore=w.agents[b].tokens.bill.read;
    const first=actCore(env.ctx,b,body,'zh'), data=good(first);
    assert.equal(data.status,'completed');assert.equal(data.paid,50);assert.equal(data.output,'{"affordable":4}');
    assert.equal(w.agents[a].energy,sellerBefore+50);assert.equal(w.agents[b].energy,buyerBefore-50);
    assert.equal(w.agents[b].tokens.bill.read-readBefore,jsonWeight({output:data.output}));
    const balance=w.agents[b].energy+w.agents[b].basic;
    assert.deepEqual(actCore(env.ctx,b,body,'zh'),first);assert.equal(w.agents[b].energy+w.agents[b].basic,balance);
    assert.equal(Object.values(w.orders).filter(o=>o.serviceId===sv).length,1);
    for(const path of ['/api/public/state','/api/public/services','/api/public/orders','/api/public/events']) {
      const r=await env.call(path);assert.ok(!r.text.includes('PRIVATE-PROGRAM-SOURCE'),path);assert.ok(!r.text.includes('return { affordable'),path);
    }
    const orders=materialLook(w,'orders',{kind:'program'});assert.equal(orders[0].output,data.output);
    assert.ok(!JSON.stringify(env.rt.engine.buildPerception(w,c,{ack:false})).includes('PRIVATE-PROGRAM-SOURCE'));
    assert.equal(env.rt.engine.checkConservation(w).ok,true);
    const expected=stateHash(w);env.rt.snapshot();const replay=replayDir(env.rt.dir);assert.equal(stateHash(replay.world),expected,replay.diff);
  }finally{await env.close();}
});
test('editing affects future purchases, failures do not pay, withdrawal blocks new purchases and ordinary services still work',async()=>{
 const env=await fixture();try {
   const [a,b]=env.people,w=env.rt.w;
   const pg=good(env.act(a,save())).program;
   const sv=good(env.act(a,{type:'service_publish',title:'计算',description:'计算',price:50,program:pg})).service;
   good(env.act(a,save({program:pg,code:'return input.n + 1;'})));
   const receipt=good(env.act(b,{type:'service_order',service:sv,input:'{"n":4}'}));assert.equal(receipt.output,'5');
   good(env.act(a,save({program:pg,code:'throw Error("PRIVATE-PROGRAM-SOURCE");'})));
   const money=w.agents[a].energy, count=Object.keys(w.orders).length;
   failed(env.act(b,{type:'service_order',service:sv,input:'{}'}),'program_failed');assert.equal(w.agents[a].energy,money);assert.equal(Object.keys(w.orders).length,count);assert.equal(w.orders[receipt.order].output,'5');
   failed(env.act(b,{type:'service_publish',title:'盗用',description:'盗用',price:5,program:pg}),'not_found');
   good(env.act(a,{type:'service_withdraw',service:sv}));failed(env.act(b,{type:'service_order',service:sv,input:'{}'}),'not_found');
   const ordinary=good(env.act(a,{type:'service_publish',title:'文章',description:'写一篇文章',price:5,criterionTemplate:{kind:'document'}})).service;
   const order=good(env.act(b,{type:'service_order',service:ordinary,targetArgs:{}}));assert.equal(order.status,'offered');assert.equal(w.orders[order.order].escrow,5);
 }finally{await env.close();}
});
test('managed runner executes named program tools and MCP reads author pages and receives automatic delivery',async()=>{
 const env=await fixture();try {
   const [a,b]=env.people,client=managedClient(env.ctx,a,()=>true,new AbortController().signal);
   let turn=0;
   const S={client,cfg:{toolMode:'native',actionTools:'typed',lang:'zh'},provider:{async step(){
     turn++;const {type,...args}=save();return {text:'',calls:turn===1?[{id:'save-call',name:'program',args}]:[{id:'done-call',name:'done',args:{}}]};
   }},log:{info(){},warn(){},error(){}},deps:{},report(){},history:[],looks:{tick:-1,n:0},wakes:{tick:-1,n:0},system:null,cursor:0};
   const result=await runWaking4(S,tokenStatus(env.ctx,a),{kind:'main'});
   const pg=Object.values(env.rt.w.programServices.programs)[0];assert.ok(pg,JSON.stringify(result));
   const service=good(env.act(a,{type:'service_publish',title:'预算',description:'计算',price:5,program:pg.id})).service;
   let active=client;
   const fetch=async(url,options={})=>{
     const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):{};
     const r=path==='/api/me'?await active.me():path==='/api/me/wake'?await active.wake(body):path==='/api/me/look'?await active.look(body):path==='/api/me/rules'?await active.rules(body):await active.act(body);
     return new Response(JSON.stringify(r.json),{status:r.status});
   };
   const newMcp=()=>createMcp({env:{HOUREN_SERVER:'http://127.0.0.1:9876',HOUREN_TOKEN:'local-test',HOUREN_LANG:'zh'},fetch});
   let mcp=newMcp();const tools=await mcp.handle({jsonrpc:'2.0',id:1,method:'tools/list'});
   assert.ok(tools.result.tools.find(t=>t.name==='houren_look').inputSchema.properties.what.enum.includes('programs'));
   const call=(name,args={})=>mcp.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name,arguments:args}});
   await call('houren_perceive');
   const own=await call('houren_look',{what:'programs',id:pg.id,offset:0});assert.match(JSON.stringify(own),/PRIVATE-PROGRAM-SOURCE/);
   active=managedClient(env.ctx,b,()=>true,new AbortController().signal);mcp=newMcp();await mcp.handle({jsonrpc:'2.0',id:1,method:'tools/list'});await call('houren_perceive');
   const denied=await call('houren_look',{what:'programs',id:pg.id});assert.doesNotMatch(JSON.stringify(denied),/PRIVATE-PROGRAM-SOURCE/);
   const bought=await call('houren_act',{actions:[{type:'service_order',service,input:'{"budget":80,"unitCost":20}'}]});
   assert.match(JSON.stringify(bought),/affordable/);assert.match(JSON.stringify(bought),/completed/);
 }finally{await env.close();}
});
test('JSON-escaped source can be read fully in bounded pages',async()=>{
 const env=await fixture();try {
   const [a,b]=env.people, body='// '+('"\\'.repeat(700))+'\nreturn "😀";';
   const pg=good(env.act(a,save({code:body}))).program;
   let offset=0,combined='';do{const page=programLook(env.rt.w,{id:pg,offset},a);assert.ok(Array.from(JSON.stringify(page)).length<=1200);combined+=page.code;offset=page.nextOffset;}while(offset!==null);
   assert.equal(combined,body);
   assert.throws(()=>programLook(env.rt.w,{id:pg,offset:-1},a),/invalid_args/);
   assert.throws(()=>programLook(env.rt.w,{id:pg},b),/not_found/);
 }finally{await env.close();}
});
test('purchase cannot leak output or move service funds when reading budget is exhausted; restart preserves settlement',async()=>{
 const env=await fixture();try {
   const [a,b]=env.people,w=env.rt.w;
   const pg=good(env.act(a,save({code:'return "x".repeat(1500);'}))).program;
   const service=good(env.act(a,{type:'service_publish',title:'长结果',description:'长结果',price:10,program:pg})).service;
   const wake=env.wake(b), action={type:'service_order',service,input:'{}'};
   const {type,...fields}=action;
   env.rt.exec('cap',{agentId:b,cap:w.agents[b].tokens.used+jsonWeight(fields)*4+1});
   const seller=w.agents[a].energy;
   const response=actCore(env.ctx,b,{wakeId:wake.wakeId,requestId:'read-cap',experimentGeneration:0,actions:[action]},'zh');
   failed(response,'cap_reached');assert.equal(w.agents[a].energy,seller);assert.equal(Object.keys(w.orders).length,0);assert.ok(!JSON.stringify(response).includes('xxxxxxx'));
   env.rt.exec('cap',{agentId:b,cap:10000000});
   good(env.act(b,action));
   const expected=stateHash(w);
   // Snapshot intentionally predates all program commands; crash recovery must
   // use durable receipts, including any platform watchdog outcome.
   const reopened=Runtime.open(env.cfg,{version:'0.1.0',logger:{}});
   try{assert.equal(stateHash(reopened.w),expected);}finally{reopened.close();}
 }finally{await env.close();}
});
