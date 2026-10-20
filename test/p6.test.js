import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import e2 from '../src/e2/facade.js';
import { createWorld,genesisOpts } from '../src/e2/world.js';
import { stateHash } from '../src/store.js';
import { replayDir } from '../src/tools/replay.js';
import { validateRules,checkExpression } from '../src/e2/rules/check.js';
import { typedActionTools } from '../runner/action-tools.js';
import { boot, verifiedBody } from './http-helpers.js';
import { PublicRoleService } from '../src/runner/public-roles.js';
import { UsageStore } from '../src/runner/usage.js';
const hiddenPhysics={version:1,regrowth:{baseByZone:{wilds:20,scrapyard:15,solarfield:10},thresholdByZone:{wilds:30,scrapyard:25,solarfield:15},factorPermille:500},construction:{fullActionsPerTick:2,factorPermille:500}};
const world=()=>createWorld({id:'p6',seed:'p6',premise:6,hiddenPhysics});
const creation=(accountId,name,requestId)=>({op:'create',accountId,name,requestId,lang:'zh',soul:'独立观察',model:'待配置',dailyCap:1000000});
const cmd=(w,type,payload={})=>e2.applyCommand(w,{type,payload});
function create(w,accountId='user-a',name='甲居民',requestId='create-aaaa'){const r=cmd(w,'account',creation(accountId,name,requestId));assert.equal(r.result.ok,true,JSON.stringify(r));return r.result.agentId;}

test('P6 genesis, atomic grants, failed creation, idempotency and deterministic replay',()=>{
  const w=world(),commands=[];
  assert.equal(Object.keys(w.agents).length,0);assert.equal(Object.keys(w.publicRoles).length,10);assert.equal(Object.keys(w.docs).length,6);assert.equal(w.weather.votes,undefined);
  const exec=(type,payload={})=>{commands.push({type,payload});return cmd(w,type,payload).result;};
  const p=creation('alice','甲居民','create-once');
  assert.equal(exec('account',{...p,soul:''}).ok,false);assert.equal(Object.keys(w.access.startupClaims).length,0);
  const r=exec('account',p);assert.equal(r.startupGrant,50000);assert.deepEqual(exec('account',p),r);
  assert.equal(exec('account',{...p,name:'乙居民'}).error.code,'conflict');
  assert.equal(exec('account',creation('alice','乙居民','create-second')).startupGrant,0);
  assert.equal(exec('account',creation('bob','丙居民','create-third')).startupGrant,50000);
  assert.equal(Object.keys(w.agents).length,3);assert.equal(w.ledger.src.energy.startup_grant,100000);
  assert.equal(exec('register',p).ok,false);
  for(let n=0;n<600;n++)assert.equal(exec('tick').ok,true);
  assert.equal(e2.checkConservation(w).ok,true);
  assert.equal(JSON.stringify(w).includes('"coins"'),false);assert.equal(JSON.stringify(w).includes('tokenHash'),false);assert.equal(JSON.stringify(w).includes('keyHash'),false);
  assert.ok(w.weather.history.every(h=>['quake','fog','eclipse'].includes(h.type)&&h.decidedBy==='random'));
  const copy=createWorld(genesisOpts(w));for(const c of commands)cmd(copy,c.type,c.payload);assert.equal(stateHash(copy),stateHash(w));
  const output=JSON.stringify(e2.publicState(w));assert.equal(output.includes('managerAccountId'),false);assert.equal(output.includes('hiddenPhysics'),false);assert.equal(output.includes('startupClaims'),false);
});

test('P6 rejects legacy currency in actions, law expressions and schema',()=>{
  const w=world(),id=create(w);
  assert.equal(cmd(w,'admin',{op:'adjust',args:{agentId:id,coins:1,reason:'test'}}).result.ok,false);
  assert.equal(cmd(w,'weather_vote',{type:'quake',voterHash:'a'.repeat(64)}).result.ok,false);
  assert.equal(cmd(w,'admin',{op:'weather',args:{type:'quake'}}).result.ok,false);
  assert.equal(checkExpression('actor.coins > 0','bool','before',{premise:6}).ok,false);
  assert.equal(validateRules([{when:'daily',do:[{op:'mint',coins:'1'}]}],{scope:{kind:'city',premise:6}}).ok,false);
  const tools=typedActionTools('zh',{premise:6});
  const say=tools.find(t=>t.name==='say');assert.ok(say.schema.properties.publicRoleId);
  assert.ok(!JSON.stringify(tools).includes('"coins"'));assert.ok(!JSON.stringify(tools).includes('"mint"'));
});

test('P6 transfer revokes rights, keeps creation and startup eligibility, rejects stale images',()=>{
  const w=world(),id=create(w),r=w.access.residents[id];
  const invite=cmd(w,'account',{op:'transfer',agentId:id,accountId:'user-a',ownershipRevision:1,to:'user-b',now:1000,requestId:'invite-aaaa'}).result;
  assert.equal(invite.ok,true);
  const accept={op:'accept_transfer',transferId:invite.transferId,accountId:'user-b',dailyCap:1000000,model:'new-model',now:2000,requestId:'accept-aaaa'};
  assert.equal(cmd(w,'account',accept).result.ok,true);
  assert.equal(w.access.residents[id].creatorAccountId,'user-a');assert.equal(w.access.residents[id].managerAccountId,'user-b');assert.equal(w.access.startupClaims['user-b'],undefined);
  assert.equal(cmd(w,'account',{op:'avatar',agentId:id,accountId:'user-a',ownershipRevision:1,avatar:'a'.repeat(64),requestId:'avatar-stale'}).result.error.code,'unauthorized');
  assert.equal(cmd(w,'account',{...accept,now:3000}).result.ok,true);
  assert.equal(cmd(w,'account',creation('user-b','新居民','create-user-b')).result.startupGrant,50000);
  assert.ok(w.residentStats[id].ledger.length);assert.equal(w.access.residents[id].ownershipRevision,2);
});

test('P6 same-place role question, limit, separate reply and normal paid inbox',()=>{
  const w=world(),id=create(w),a=w.agents[id];
  cmd(w,'meter',{op:'wake',agentId:id,wakeId:'wake-a',day:'2026-10-11',kind:'main',system:0,brief:0,delivered:0});
  const payload={agentId:id,requestId:'ask-a',experimentGeneration:0,actions:[{type:'say',text:'请说明入城流程',publicRoleId:'guide'}],meter:{wakeId:'wake-a',day:'2026-10-11',reread:0}};
  const first=cmd(w,'act',payload);assert.equal(first.result.results[0].ok,true,JSON.stringify(first));
  assert.equal(first.result.results[0].cost,0);assert.ok(first.result.bill.write>0);
  const requestId=first.result.results[0].data.requestId;
  const again=cmd(w,'act',{...payload,requestId:'ask-b'});assert.equal(again.result.results[0].error.code,'rate_limited');
  const before=a.energy+a.basic;
  const reply=cmd(w,'role_reply',{requestId,text:'请查看当前地图与公开规则。',source:'fixed'});assert.equal(reply.result.ok,true);assert.equal(a.energy+a.basic,before);
  assert.ok(a.inbox.some(i=>i.from?.id==='role:guide'));assert.equal(cmd(w,'role_reply',{requestId,text:'重复',source:'fixed'}).events.length,0);
  const stats=w.residentStats[id].actions;assert.equal(stats.attempted,2);assert.equal(stats.succeeded,1);assert.equal(stats.failed,1);
  const p=e2.buildPerception(w,id,{lang:'zh',ack:false});assert.ok(p.publicRoles.some(r=>r.id==='guide'&&r.place==='port'));assert.ok(!JSON.stringify(p).includes('managerAccountId'));
});

async function environment(){const dir=mkdtempSync(join(tmpdir(),'as4-p6-')),file=join(dir,'physics.json');writeFileSync(file,JSON.stringify(hiddenPhysics));return boot({physics:2,premise:6,map:'compact-materials-v1',shellSlots:0,hiddenPhysicsFile:file},{dir});}
async function user(env,name,admin=false){
  const body={username:name,displayName:name,password:'test-password-1234',...(admin?{adminKey:'test-admin-key'}:{})};
  const r=await env.call(`/api/account/${admin?'setup':'register'}`,{method:'POST',headers:{'X-Houren-Request':'1'},body:admin?body:await verifiedBody(env,body)});
  assert.equal(r.status,201,r.text);return {id:r.json.user.id,cookie:r.headers.get('set-cookie').split(';')[0]};
}
const headers=u=>({'X-Houren-Request':'1',Cookie:u.cookie});
test('P6 HTTP authentication, binary image validation, paged archives, transfer and replay',async()=>{
  const env=await environment();
  try{
    const alice=await user(env,'alice'),bob=await user(env,'bobby');
    assert.equal((await env.call('/api/account/residents',{method:'POST',headers:{'X-Houren-Request':'1'},body:creation('fake','不可创建','unauth-aaaa')})).status,401);
    const p={name:'HTTP居民',soul:'PRIVATE-SOUL',bio:'独立居民',lang:'zh',dailyCap:1000000,requestId:'http-create'};
    const [first,retry]=await Promise.all([env.call('/api/account/residents',{method:'POST',headers:headers(alice),body:p}),env.call('/api/account/residents',{method:'POST',headers:headers(alice),body:p})]);
    assert.equal(first.status,201,first.text);assert.deepEqual(first.json,retry.json);const id=first.json.agentId;
    assert.equal((await env.call(`/api/account/residents/${id}`,{headers:headers(bob)})).status,403);
    for(const path of ['/api/me','/api/me/wake','/api/me/act','/api/owner','/api/port/register'])assert.equal((await env.call(path,{method:path.includes('wake')||path.includes('act')||path.includes('register')?'POST':'GET',headers:headers(alice),token:'old-token',body:path.includes('wake')||path.includes('act')||path.includes('register')?{}:undefined})).status,401);
    const image=await sharp({create:{width:24,height:24,channels:3,background:'#ffaa55'}}).png().toBuffer();
    const avatar=await env.call(`/api/account/residents/${id}/avatar`,{method:'POST',headers:{...headers(alice),'X-Request-Id':'image-first','Content-Type':'image/png'},raw:image});assert.equal(avatar.status,200,avatar.text);
    const output=await sharp(join(env.rt.dir,'avatars',`${avatar.json.avatar}.webp`)).metadata();assert.equal(output.width,512);assert.equal(output.height,512);assert.equal(output.exif,undefined);
    const fake=await env.call(`/api/account/residents/${id}/avatar`,{method:'POST',headers:{...headers(alice),'X-Request-Id':'image-false','Content-Type':'image/png'},raw:Buffer.from('<svg/>')});assert.equal(fake.status,400);
    const binary=await env.call(`/api/account/residents/${id}/avatar`,{method:'POST',headers:{...headers(bob),'X-Request-Id':'image-denied'},raw:image});assert.equal(binary.status,403);
    for(let n=0;n<650;n++)env.rt.exec('account',{op:'avatar',agentId:id,accountId:alice.id,ownershipRevision:1,avatar:avatar.json.avatar,requestId:`history-${n}`});
    const page=await env.call(`/api/account/residents/${id}/events?type=appearance&limit=50`,{headers:headers(alice)});assert.equal(page.status,200,page.text);assert.equal(page.json.events.length,50);assert.ok(page.json.cursor);assert.equal(page.json.events[0].type,'appearance');
    const next=await env.call(`/api/account/residents/${id}/events?type=appearance&cursor=${page.json.cursor}`,{headers:headers(alice)});assert.ok(next.json.events[0].seq>page.json.events.at(-1).seq);
    const csv=await env.call(`/api/account/residents/${id}/export?format=csv`,{headers:headers(alice)});assert.equal(csv.status,200);assert.ok(csv.text.includes('worldDay'));
    const model=await env.call(`/api/account/residents/${id}/runner`,{method:'POST',headers:headers(alice),body:{op:'save',config:{provider:'mock'}}});assert.equal(model.status,200,model.text);assert.ok(!env.app.ctx.runners.records[id].token);
    const invitation=await env.call(`/api/account/residents/${id}/transfer`,{method:'POST',headers:headers(alice),body:{username:'bobby',requestId:'transfer-http'}});assert.equal(invitation.status,200,invitation.text);
    const accepted=await env.call(`/api/account/transfers/${invitation.json.transferId}/accept`,{method:'POST',headers:headers(bob),body:{requestId:'accept-http',dailyCap:1000000,config:{provider:'mock'}}});assert.equal(accepted.status,200,accepted.text);
    assert.equal((await env.call(`/api/account/residents/${id}/private`,{headers:headers(alice)})).status,403);
    assert.equal((await env.call(`/api/account/residents/${id}/events?cursor=${page.json.cursor}`,{headers:headers(alice)})).status,403);
    const original=await env.call(`/api/account/residents/${id}`,{headers:headers(alice)});assert.equal(original.json.publicOnly,true);assert.ok(!original.text.includes('PRIVATE-SOUL'));
    assert.equal((await env.call(`/api/account/residents/${id}`,{headers:headers(bob)})).status,200);
    env.rt.snapshot();const replay=replayDir(env.rt.dir,{params:env.cfg});assert.equal(stateHash(replay.world),stateHash(env.rt.w));
  }finally{await env.close();}
});

test('Public role budget persists reservations, settles across days, conservatively recovers missing usage',async()=>{
  const env=await environment();let now=Date.parse('2026-10-11T01:00:00Z');
  try{
    const svc=new PublicRoleService(env.app.ctx,{now:()=>now});svc.save({provider:'mock',dailyLimit:10000});
    assert.equal(svc.reserve('one',6000),true);assert.equal(svc.reserve('two',6000),false);
    now+=86400000;svc.settle('one',{input:1000,output:200});assert.equal(svc.view().used,0);assert.equal(svc.budget.days['2026-10-11'],1200);
    assert.equal(svc.reserve('crash',7000),true);
    const restored=new PublicRoleService(env.app.ctx,{now:()=>now});assert.equal(restored.view().used,7000);assert.equal(restored.view().reserved,0);assert.ok(restored.recovered.has('crash'));
    assert.equal(restored.reserve('unknown',2000),true);restored.settle('unknown',null);assert.equal(restored.view().used,9000);
    assert.equal(restored.reserve('overrun',500),true);restored.settle('overrun',{input:600,output:100});assert.equal(restored.reserve('after-overrun',1),false);
    const raw=readFileSync(restored.file,'utf8');assert.ok(!raw.includes('apiKey'));
  }finally{await env.close();}
});

test('P6 usage diagnostics expire after 30 days while lifetime and daily aggregates survive',()=>{
  let now=Date.parse('2026-09-01T00:00:00Z');const usage=new UsageStore({permanent:true,now:()=>now});
  usage.record('a1',{input:11,output:12,cacheRead:7},{ok:true,finishReason:'stop'},'mock');assert.equal(usage.view('a1').recent[0].cacheRead,7);assert.equal(usage.view('a1').recent[0].cacheWrite,null);now+=31*86400000;usage.record('a1',null,{ok:true},'mock');
  const view=usage.view('a1');assert.equal(view.total.calls,2);assert.equal(view.days.length,2);assert.equal(view.recent.length,1);assert.equal(view.recent[0].input,null);
});

import { Runtime } from '../src/runtime.js';
import { prepareFreshWorld } from '../src/tools/fresh-world.js';
import { assetPosition } from '../src/e2/p6/journal.js';
import { residentEvents } from '../src/http/residents.js';
import { validateAction } from '../runner/action-tools.js';
function residentAction(w,id,action) {
  const a=w.agents[id];a.actsThisTick=0;
  if(!a.tokens.waking)cmd(w,'meter',{op:'wake',agentId:id,wakeId:`wake-${id}`,day:'2026-10-11',kind:'main',system:0,brief:0,delivered:0});
  const out=cmd(w,'act',{agentId:id,requestId:`act-${w.commandN}`,experimentGeneration:0,actions:[action],meter:{wakeId:a.tokens.waking?.id??`wake-${id}`,day:'2026-10-11',reread:0}});
  assert.equal(out.result.results?.[0]?.ok,true,JSON.stringify(out.result));return out.result.results[0].data;
}
test('P6 resource statistics distinguish escrow, refunds, final trade and actual construction',()=>{
  const w=world(),id=create(w),other=create(w,'user-b','乙居民','create-bbbb');
  w.agents[id].place=w.agents[other].place='scrapyard';
  residentAction(w,id,{type:'gather',amount:10});
  residentAction(w,id,{type:'give',to:other,materials:3});
  assert.deepEqual(validateAction({type:'give',to:other,materials:1},{premise:6},6),[]);
  const offer=residentAction(w,id,{type:'offer',to:other,give:{materials:2},want:{energy:40}});
  const stats=w.residentStats[id];
  assert.equal(assetPosition(w,w.agents[id]).materialEscrow,2);
  assert.equal(stats.totals['materials:escrow:trade'],2);
  residentAction(w,id,{type:'cancel',offer:offer.offer});
  assert.equal(w.residentStats[id].totals['materials:refund:trade'],2);
  assert.equal(w.residentStats[id].totals['materials:payment:trade'],undefined);
  const sale=residentAction(w,id,{type:'offer',to:other,give:{materials:2},want:{energy:40}});
  residentAction(w,other,{type:'accept',offer:sale.offer});
  assert.equal(w.residentStats[id].totals['materials:payment:trade'],2);
  assert.equal(w.residentStats[id].totals['energy:income:trade'],40);
  assert.equal(assetPosition(w,w.agents[id]).materialEscrow,0);
  assert.equal(e2.checkConservation(w).ok,true);
  const initial=cmd(w,'account',creation('user-a','第三居民','create-cccc')).result.agentId;
  assert.equal(w.residentStats[initial].totals['energy:issuance:startup_grant'],undefined);
  w.agents[id].actsThisTick=0;
  const invalid=cmd(w,'act',{agentId:id,actions:[{type:'standing',orders:[{when:'tick',if:'actor.coins > 0',do:[{type:'say',text:'x'}]}]}],requestId:'standing-invalid',experimentGeneration:0,meter:{wakeId:`wake-${id}`,day:'2026-10-11',reread:0}});
  assert.equal(invalid.result.results[0].ok,false);
  assert.equal(invalid.result.results[0].error.code,'rule_invalid');
});

test('P6 paginates disk history beyond public and owner ring limits',async()=>{
  const env=await environment();try{
    const id=create(env.rt.w),events=Array.from({length:2200},(_,n)=>({seq:n+1,tick:0,day:0,type:'appearance',vis:'public',agent:id,data:{agentId:id}}));
    env.rt.events.append(events,{tick:0});env.rt.w.counters.event=2200;
    assert.equal(env.rt.events.ring.length,2000);
    const query=new URLSearchParams({limit:'200'}),first=await residentEvents(env.app.ctx,id,query,()=>{});
    assert.equal(first.events[0].seq,1);assert.equal(first.events.length,200);
    let found=first.events.length,cursor=first.cursor;
    while(cursor){query.set('cursor',cursor);const next=await residentEvents(env.app.ctx,id,query,()=>{});found+=next.events.length;cursor=next.cursor;}
    assert.equal(found,2200);
  }finally{await env.close();}
});

test('P6 public model aborts boundedly and restart publishes outbox without billing twice',async()=>{
  const env=await environment();try{
    await env.app.ctx.publicRoles.close();
    const id=create(env.rt.w),data=residentAction(env.rt.w,id,{type:'say',text:'入城后怎样查看当前地点？',publicRoleId:'guide'}),q=env.rt.w.roleRequests[data.requestId];
    let calls=0;const svc=new PublicRoleService(env.app.ctx,{provider:{complete:()=>{calls++;return new Promise(()=>{});}}});svc.save({provider:'mock'});
    const job=svc.run(q,env.rt.w.publicRoles.guide);
    assert.equal(calls,1);assert.equal(svc.view().reserved>0,true);
    await svc.close();await job;
    assert.equal(svc.jobs.size,0);assert.ok(svc.budget.outbox[q.id]);const used=svc.view().used;assert.ok(used>0);
    const restart=new PublicRoleService(env.app.ctx,{provider:{complete:()=>{throw Error('must not retry ambiguous call');}}});restart.pump();
    assert.equal(env.rt.w.roleRequests[q.id].status,'answered');assert.equal(restart.view().used,used);assert.equal(restart.view().active,0);
    assert.equal(JSON.stringify(restart.facts(env.rt.w.publicRoles.guide)).includes('managerAccountId'),false);
    await restart.close();
  }finally{await env.close();}
});

test('P6 avatar rejects animated and oversized decoded images',async()=>{
  const env=await environment();try{
    const u=await user(env,'image_tester'),created=await env.call('/api/account/residents',{method:'POST',headers:headers(u),body:{name:'图像居民',soul:'观察',lang:'zh',dailyCap:100000,requestId:'image-create'}}),id=created.json.agentId;
    const frames=Buffer.concat([Buffer.alloc(2*2*3,150),Buffer.alloc(2*2*3,20)]);
    const animated=await sharp(frames,{raw:{width:2,height:4,channels:3,pageHeight:2}}).webp({loop:0}).toBuffer();
    assert.equal((await sharp(animated,{animated:true}).metadata()).pages,2);
    for(const [name,raw]of [['animated',animated],['pixels',await sharp({create:{width:4001,height:4001,channels:3,background:'#888'}}).png().toBuffer()],['bytes',Buffer.alloc(5*1024*1024+1)]]){
      const r=await env.call(`/api/account/residents/${id}/avatar`,{method:'POST',headers:{...headers(u),'X-Request-Id':`image-${name}`,'Content-Type':'image/webp'},raw});assert.ok([400,413].includes(r.status),r.text);
    }
    assert.equal(env.rt.w.agents[id].avatar,undefined);
  }finally{await env.close();}
});

test('Offline fresh-world preparation preserves accounts and original files, serves public-only archive',async()=>{
  const env=await boot({physics:2});let next;
  try{
    const u=await user(env,'historic'),a=await env.register('旧城居民');env.app.ctx.accounts.linkAgent(u.id,{world:'w',agentId:a.agentId,token:env.rt.w.agents[a.agentId].tokenHash});
    env.rt.exec('act',{agentId:a.agentId,actions:[{type:'diary',text:'PRIVATE-DIARY-ARCHIVE'}]});
    env.rt.snapshot();await env.app.close();env.rt.close();
    const original=readFileSync(join(env.rt.dir,'snapshot.json')),accounts=readFileSync(join(env.dir,'accounts.json'));
    const file=join(env.dir,'hidden.json');writeFileSync(file,JSON.stringify(hiddenPhysics));
    const result=await prepareFreshWorld({...env.cfg,hiddenPhysicsFile:file},{oldWorldId:'w',newWorldId:'fresh-p6',oldCodeVersion:'test-old-release'});
    assert.equal(result.ordinaryResidents,0);assert.equal(result.publicRoles,10);
    assert.deepEqual(readFileSync(join(env.rt.dir,'snapshot.json')),original);assert.deepEqual(readFileSync(join(env.dir,'accounts.json')),accounts);
    assert.throws(()=>Runtime.open(env.cfg),/read-only/);
    const publicData=readFileSync(join(env.dir,'public-archives','w','state.json'),'utf8')+readFileSync(join(env.dir,'public-archives','w','events.jsonl'),'utf8');assert.ok(!publicData.includes('PRIVATE-DIARY-ARCHIVE'));assert.ok(!publicData.includes('tokenHash'));assert.ok(!publicData.includes('SECRET-SOUL'));
    next=await boot({physics:2,premise:6,map:'compact-materials-v1',worldId:'fresh-p6',hiddenPhysicsFile:file},{dir:env.dir});
    const archive=await next.call('/api/public/worlds/w/state');assert.equal(archive.status,200);assert.equal(archive.json.world.id,'w');
    const login=await next.call('/api/account/login',{method:'POST',headers:{'X-Houren-Request':'1'},body:{username:'historic',password:'test-password-1234'}});const cookie=login.headers.get('set-cookie').split(';')[0];
    const own=await next.call('/api/account/worlds/w/residents',{headers:{Cookie:cookie}});assert.equal(own.json.residents[0].id,a.agentId);assert.equal(own.json.archived,true);
    assert.equal((await next.call('/api/account/residents',{headers:{Cookie:cookie}})).json.managed.length,0);
    assert.equal((await next.call(`/api/public/worlds/w/agents/${a.agentId}/events`)).status,200);
  }finally{if(next)await next.close();else rmSync(env.dir,{recursive:true,force:true});}
});

// Funding is custody; only actual work spends the contributor's resources.
test('P6 actual construction work and partial refunds reconcile held assets',()=>{
  const w=world(),id=create(w),a=w.agents[id];
  a.place='scrapyard';for(let n=0;n<3;n++)residentAction(w,id,{type:'gather'});
  a.place='library';for(let n=0;n<3;n++){const sponsor=create(w,`sponsor-${n}`,`工程出资人${n}`,`sponsor-create-${n}`);w.agents[sponsor].place='library';residentAction(w,sponsor,{type:'give',to:id,energy:40000});}const first=residentAction(w,id,{type:'initiate',build:'module',module:'board'});
  const j=w.projects[first.project];
  residentAction(w,id,{type:'contribute',project:j.id,energy:j.needEnergy,materials:j.needMaterials});
  assert.equal(w.residentStats[id].totals['energy:expense:repair'],undefined);
  assert.equal(w.residentStats[id].totals['energy:expense:action:contribute'],undefined);
  assert.equal(w.residentStats[id].totals['energy:escrow:project'],j.needEnergy);
  const before=assetPosition(w,a),one=residentAction(w,id,{type:'construct',project:j.id}),two=residentAction(w,id,{type:'construct',project:j.id});
  assert.equal(w.residentStats[id].achievements.constructionWork,one.workAdded+two.workAdded);
  assert.equal(w.residentStats[id].totals['materials:expense:construction'],j.spentMaterials);
  assert.equal(w.residentStats[id].totals['energy:expense:construction'],j.spentEnergy);
  assert.equal(before.escrow.projects-assetPosition(w,a).escrow.projects,j.spentEnergy);
  residentAction(w,id,{type:'cancel_project',project:j.id});
  assert.equal(assetPosition(w,a).escrow.projects,0);
  assert.equal(w.residentStats[id].totals['energy:refund:project'],j.needEnergy-j.spentEnergy);
  assert.equal(w.residentStats[id].totals['energy:income:project'],undefined);
  assert.equal(assetPosition(w,a).materialEscrow,j.needMaterials-j.spentMaterials);
  assert.equal(e2.checkConservation(w).ok,true);
});

test('P6 public role pump enforces two concurrent calls and uses only bounded public facts',async()=>{
  const env=await environment();try{
    await env.app.ctx.publicRoles.close();
    for(const [n,roleId]of ['guide','clerk','registrar'].entries()){const id=create(env.rt.w,`u-${n}`,`居民${n}`,`creation-${n}`);env.rt.w.agents[id].place=env.rt.w.publicRoles[roleId].home;residentAction(env.rt.w,id,{type:'say',text:'请说明你的职能',publicRoleId:roleId});}
    const finishes=[];let calls=0;const svc=new PublicRoleService(env.app.ctx,{provider:{complete:()=>{calls++;return new Promise(resolve=>finishes.push(resolve));}}});svc.save({provider:'mock'});svc.pump();
    assert.equal(calls,2);assert.equal(svc.view().active,2);
    finishes.shift()({text:'请依据当前公开规则查看地点与自己的状态。',usage:{input:80,output:20},stop:'stop'});
    await new Promise(resolve=>setImmediate(resolve));svc.pump();assert.equal(calls,3);assert.equal(svc.view().active,2);
    for(const resolve of finishes)resolve({text:'请查看已公开的记录。',usage:{input:80,output:20},stop:'stop'});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(svc.view().used,300);
    for(const r of Object.values(env.rt.w.publicRoles)){const facts=JSON.stringify(svc.facts(r));for(const secret of ['managerAccountId','seed','hiddenPhysics','weather.schedule','PRIVATE-SOUL'])assert.ok(!facts.includes(secret));}
    await svc.close();
  }finally{await env.close();}
});
