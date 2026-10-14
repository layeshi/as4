import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from './http-helpers.js';
import { wakeCore, lookCore, tokenStatus } from '../src/http/tokens.js';
import { actCore } from '../src/http/agent.js';
import { managedClient } from '../src/runner/managed-client.js';
import { createMcp } from '../mcp/server.js';
import { typedActionTools, validateAction } from '../runner/action-tools.js';
import { toolDefs, runWaking4 } from '../runner/loop.js';
import { cpLength, textWeight } from '../src/text.js';
import { P } from '../src/e2/params.js';
import { stateHash } from '../src/store.js';
import { replayDir } from '../src/tools/replay.js';
const physics={version:1,regrowth:{baseByZone:{wilds:20,scrapyard:15,solarfield:10},thresholdByZone:{wilds:30,scrapyard:25,solarfield:15},factorPermille:500},construction:{fullActionsPerTick:2,factorPermille:500}};
async function fixture(enabled=true){
  const dir=mkdtempSync(join(tmpdir(),'cooperation-http-')),file=join(dir,'physics.json');writeFileSync(file,JSON.stringify(physics));
  const env=await boot({physics:2,premise:6,map:'compact-materials-v1',shellSlots:0,hiddenPhysicsFile:file},{dir});
  const people=['问潮','禾灯','远山'].map((name,i)=>env.rt.exec('account',{op:'create',accountId:`account-${i}`,name,requestId:`create-${i}`,soul:'保持独立判断',lang:'zh',model:'mock',dailyCap:1000000}).result.agentId);
  const ctx=env.app.ctx;
  if(enabled){const r=await env.call('/api/admin/cooperation',{method:'POST',admin:true,body:{version:1}});assert.equal(r.status,200,r.text);}
  let count=0;
  const waking=id=>{const r=wakeCore(ctx,id,{kind:'main',lang:'zh',actionTools:'typed'},'zh');assert.equal(r.status,200,JSON.stringify(r));return r.json;};
  const act=(id,action)=>{if(env.rt.w.agents[id].actsThisTick>=P.maxActionsPerTick)env.rt.exec('tick');const wake=waking(id);return actCore(ctx,id,{wakeId:wake.wakeId,requestId:`test-act-${++count}`,experimentGeneration:0,actionTools:'typed',actions:[action]},'zh');};
  return Object.assign(env,{ctx,people,waking,act});
}
function success(r){assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.json.results[0].ok,true,JSON.stringify(r));return r.json.results[0].data;}

test('shared core meters writes, pages charged reads and enforces the cross-section waking budget',async()=>{
  const env=await fixture();try{
    const [a,b]=env.people;
    const k=success(env.act(a,{type:'card',op:'create',title:'维护流程',body:'😀'.repeat(2000),visibility:'shared',readers:[b]}));
    const wake=env.waking(b),old=structuredClone(wake.bill);assert.ok(wake.text.includes('知识与协作'));assert.ok(!wake.text.includes('😀'));
    let total=0,reads=0;for(let n=0;n<6;n++){
      const before=env.rt.w.agents[b].tokens.used;
      const r=lookCore(env.ctx,b,{wakeId:wake.wakeId,what:'cards',id:k.id,turn:n+1},'zh');
      if(r.status!==200){assert.equal(r.json.error.code,'limit_reached');assert.ok(!Object.hasOwn(r.json,'text'));break;}
      assert.ok(cpLength(r.json.text)<=1200);total+=cpLength(r.json.text);reads++;
      assert.ok(env.rt.w.agents[b].tokens.used>before);assert.ok(r.json.bill.read>=old.read+textWeight(r.json.text)*P.tokenRead);
    }
    assert.ok(total<=3600);assert.ok(reads>=3);assert.equal(env.ctx.wakings.get(b).cooperationRead,total);
    const leak=lookCore(env.ctx,env.people[2],{wakeId:env.waking(env.people[2]).wakeId,what:'cards',id:k.id},'zh');assert.equal(leak.json.error.code,'not_found');
  }finally{await env.close();}
});
test('quota refusal releases no text and does not consume successful-read budget; retries debit once',async()=>{
  const env=await fixture();try{
    const [a,b]=env.people;
    const k=success(env.act(a,{type:'card',op:'create',title:'费用',body:'可查阅'.repeat(100),visibility:'public'}));
    const wake=env.waking(b);env.rt.exec('cap',{agentId:b,cap:env.rt.w.agents[b].tokens.used+1});
    const r=lookCore(env.ctx,b,{wakeId:wake.wakeId,what:'cards',id:k.id},'zh');assert.equal(r.json.error.code,'cap_reached');assert.ok(!r.json.text);
    assert.ok(!env.ctx.wakings.has(b));
    env.rt.exec('cap',{agentId:a,cap:1000000});
    const awake=env.waking(a),body={wakeId:awake.wakeId,requestId:'idempotent-card',experimentGeneration:0,actions:[{type:'card',op:'cite',id:k.id}]};
    const first=actCore(env.ctx,a,body,'zh'),balance=env.rt.w.agents[a].basic+env.rt.w.agents[a].energy;
    const retry=actCore(env.ctx,a,body,'zh');assert.deepEqual(first,retry);assert.equal(env.rt.w.agents[a].basic+env.rt.w.agents[a].energy,balance);assert.equal(env.rt.w.cooperation.cards[k.id].citations.length,1);
  }finally{await env.close();}
});
test('public HTTP returns only released editions, never latest private state or special object keys',async()=>{
  const env=await fixture();try{
    const [a]=env.people,k=success(env.act(a,{type:'card',op:'create',title:'秘密',body:'FIRST-PRIVATE'}));
    let r=await env.call(`/api/public/cooperation?what=cards&id=${k.id}`);assert.equal(r.status,404);assert.ok(!r.text.includes('FIRST-PRIVATE'));
    env.rt.w.clock.tick=P.privateDelayTicks;
    success(env.act(a,{type:'card',op:'revise',id:k.id,body:'NEW-PRIVATE'}));
    r=await env.call(`/api/public/cooperation?what=cards&id=${k.id}`);assert.equal(r.json.body,'FIRST-PRIVATE');assert.ok(!r.text.includes('NEW-PRIVATE'));
    assert.equal((await env.call('/api/public/cooperation?what=cards&id=__proto__')).status,404);
    assert.equal((await env.call('/api/public/cooperation?what=cards&limit=-1')).status,400);
    const state=await env.call('/api/public/state');assert.equal(state.json.world.cooperation.version,1);assert.ok(!state.text.includes('NEW-PRIVATE'));
  }finally{await env.close();}
});
test('activation survives real snapshots and command receipts; old world snapshots do not gain new state',async()=>{
  const env=await fixture(false);try{
    assert.equal(env.rt.w.cooperation,undefined);
    assert.equal(tokenStatus(env.ctx,env.people[0]).cooperation,undefined);
    env.rt.exec('admin',{op:'cooperation',args:{version:1}});
    success(env.act(env.people[0],{type:'relation',op:'note',agent:env.people[1],text:'第一次共同工作'}));
    env.rt.snapshot();
    const replay=replayDir(env.rt.dir,{params:env.cfg});
    assert.equal(stateHash(replay.world??replay.w),stateHash(env.rt.w));
  }finally{await env.close();}
});
test('typed tools activate only with capability and runtime actually executes the new named tool',async()=>{
  assert.ok(!typedActionTools('zh',{premise:6}).some(t=>t.name==='card'));
  const tools=toolDefs('zh',{premise:6,actionTools:'typed',cooperation:true});assert.ok(tools.some(t=>t.name==='card'));
  assert.ok(tools[0].schema.properties.what.enum.includes('relations'));assert.ok(tools[0].schema.properties.version);
  assert.deepEqual(validateAction({type:'card',op:'create',title:'卡',body:'步骤'},{premise:6,cooperation:{version:1}}),[]);
  const env=await fixture();try{
    const a=env.people[0],client=managedClient(env.ctx,a,()=>true,new AbortController().signal);
    let turns=0;const S={client,cfg:{toolMode:'native',actionTools:'typed',lang:'zh'},provider:{async step(){turns++;return turns===1?{calls:[{id:'card-call',name:'card',args:{op:'create',title:'运行器卡片',body:'实际创建',visibility:'public'}}],text:''}:{calls:[{id:'done-call',name:'done',args:{}}],text:''};}},log:{info(){},warn(){},error(){}},deps:{},report(){},history:[],looks:{tick:-1,n:0},wakes:{tick:-1,n:0},system:null,cursor:0};
    const result=await runWaking4(S,tokenStatus(env.ctx,a),{kind:'main'});
    assert.ok(Object.values(env.rt.w.cooperation.cards).some(k=>k.title==='运行器卡片'),JSON.stringify(result));
  }finally{await env.close();}
});

test('MCP advertises bounded queries and forwards page pins through the shared paid core',async()=>{
  const env=await fixture(false);try{
    const id=env.people[0],client=managedClient(env.ctx,id,()=>true,new AbortController().signal);
    const requests=[];
    const fetch=async(url,options={})=>{
      const path=new URL(url).pathname,body=options.body?JSON.parse(options.body):{};
      requests.push({path,body});
      const r=path==='/api/me'?await client.me():path==='/api/me/wake'?await client.wake(body):path==='/api/me/look'?await client.look(body):path==='/api/me/rules'?await client.rules(body):await client.act(body);
      return new Response(JSON.stringify(r.json),{status:r.status});
    };
    const mcp=createMcp({env:{HOUREN_SERVER:'http://127.0.0.1:9876',HOUREN_TOKEN:'process-local-test-capability',HOUREN_LANG:'zh'},fetch});
    const before=await mcp.handle({jsonrpc:'2.0',id:0,method:'tools/list'});
    assert.ok(!before.result.tools.find(t=>t.name==='houren_look').inputSchema.properties.what.enum.includes('cards'));
    env.rt.exec('admin',{op:'cooperation',args:{version:1}});
    const tools=await mcp.handle({jsonrpc:'2.0',id:1,method:'tools/list'});
    const look=tools.result.tools.find(t=>t.name==='houren_look');assert.ok(look.inputSchema.properties.what.enum.includes('cards'));assert.ok(look.inputSchema.properties.offset);
    await mcp.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'houren_perceive',arguments:{}}});
    await mcp.handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'houren_look',arguments:{what:'cards',id:'k404',version:1,offset:10}}});
    assert.deepEqual(requests.findLast(r=>r.path==='/api/me/look').body.offset,10);assert.equal(requests.findLast(r=>r.path==='/api/me/look').body.version,1);
  }finally{await env.close();}
});
