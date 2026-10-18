import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { gatherEvidence, authorizeScope, normalizeScope } from '../src/assistant/evidence.js';

test('public evidence never includes private soul or provider credentials, private scope requires proof',async t=>{
 const env=await boot();t.after(()=>env.close());const ctx=env.app.ctx;
 const a=await env.register('灯塔居民'),user=await ctx.accounts.create({username:'evidence_user',password:'evidence-password'});
 await ctx.history.flush();const scope=normalizeScope(ctx,{mode:'public',agentId:a.agentId});
 const result=await gatherEvidence(ctx,user,scope,'居民经历',{},new AbortController().signal);
 assert.ok(result.sources.length);assert.ok(!JSON.stringify(result).includes('SECRET-SOUL'));
 assert.throws(()=>authorizeScope(ctx,user,{...scope,mode:'resident'},{}),{code:'forbidden'});
 const privateResult=await gatherEvidence(ctx,user,{...scope,mode:'resident'},'居民灵魂', {ownerKey:a.ownerKey},new AbortController().signal);
 assert.ok(JSON.stringify(privateResult).includes('SECRET-SOUL'));assert.ok(!JSON.stringify(privateResult).includes(a.ownerKey));
 assert.throws(()=>authorizeScope(ctx,{...user,role:'admin'},{...scope,mode:'research'},{}),{code:'research_verification'});
 assert.doesNotThrow(()=>authorizeScope(ctx,{...user,role:'admin'},{...scope,mode:'research'},{adminKey:env.cfg.adminKey}));
});
test('branch mismatch and invalid day ranges cannot silently become current observations',async t=>{
 const env=await boot();t.after(()=>env.close());await env.app.ctx.history.flush();
 assert.throws(()=>normalizeScope(env.app.ctx,{branchId:'other'}),{code:'invalid_scope'});
 assert.throws(()=>normalizeScope(env.app.ctx,{fromDay:9,toDay:1}),{code:'invalid_range'});
 assert.throws(()=>normalizeScope(env.app.ctx,{city:'unknown'}),{code:'invalid_scope'});
});
test('private event redaction and delayed release are enforced before evidence construction',async t=>{
 const env=await boot();t.after(()=>env.close());const ctx=env.app.ctx,a=await env.register('红线居民');await ctx.history.flush();
 ctx.history.append(ctx.history.branchId,[{kind:'event',event:{seq:900,tick:0,day:0,type:'thought',agent:a.agentId,vis:'delayed',data:{text:'NOT_RELEASED'}},public:{seq:900,tick:0,day:0,type:'thought',data:{text:'NOT_RELEASED'}},releaseTick:100000}]);
 const result=await gatherEvidence(ctx,{id:'u'},normalizeScope(ctx,{}),'NOT_RELEASED',{},new AbortController().signal);
 assert.ok(!JSON.stringify(result.sources).includes('NOT_RELEASED'));
});

test('natural yesterday and one-city questions select a precise range',async t=>{
 const env=await boot();t.after(()=>env.close());await env.app.ctx.history.flush();const b=env.app.ctx.history.branch();b.tick=b.ticksPerDay*5;
 const s=normalizeScope(env.app.ctx,{},'昨天北城发生了什么');assert.equal(s.fromDay,4);assert.equal(s.toDay,4);assert.equal(s.city,'north');
});
test('duplicate archived events are counted once and private diaries exclude unrelated letters',async t=>{
 const env=await boot();t.after(()=>env.close());const c=env.app.ctx,a=await env.register('去重居民');await c.history.flush();
 const b=c.history.branch();const seq=b.eventSeq+1;b.eventSeq=seq;
 const event={seq,tick:0,day:0,type:'speech',agent:a.agentId,vis:'public',data:{text:'一次事件'}};
 c.history.append(b.id,[{kind:'event',event,public:event,releaseTick:0},{kind:'event',event,public:event,releaseTick:0}]);
 const pub=await gatherEvidence(c,{id:'u'},normalizeScope(c,{}),'事件数量',{},new AbortController().signal);
 const stats=JSON.parse(pub.sources.find(s=>s.title==='历史查询统计与覆盖范围').text);assert.equal(stats.counts.speech,1);
 env.rt.w.agents[a.agentId].letters.push({text:'UNRELATED_LETTER_SECRET',tick:0});env.rt.w.agents[a.agentId].diary.push({text:'DIARY_RELEVANT',tick:0});
 const priv=await gatherEvidence(c,{id:'u'},normalizeScope(c,{mode:'resident',agentId:a.agentId}),'看看日记',{ownerKey:a.ownerKey},new AbortController().signal);
 assert.ok(JSON.stringify(priv.sources).includes('DIARY_RELEVANT'));assert.ok(!JSON.stringify(priv.sources).includes('UNRELATED_LETTER_SECRET'));
});

test('redacting a referenced document revokes its persisted answer dependencies',async t=>{
 const env=await boot();t.after(()=>env.close());const ctx=env.app.ctx,a=await env.register('作者');await ctx.history.flush();
 env.rt.w.docs.testDoc={id:'testDoc',kind:'book',title:'Test book',lang:'zh',author:a.agentId,source:'resident',tick:0,reads:0,body:'PRIVATE-RETRACTED-DOC'};
 const result=await gatherEvidence(ctx,{id:'u'},normalizeScope(ctx,{agentId:a.agentId}),'作者典籍',{},new AbortController().signal);
 assert.ok(result.sources.some(s=>s.docId==='testDoc'));env.rt.w.docs.testDoc.redacted=true;
 const {authorizeSources}=await import('../src/assistant/evidence.js');assert.throws(()=>authorizeSources(ctx,{id:'u'},result.dependencies,{}),{code:'forbidden'});
});
test('legacy archived ownership uses that branch owner hash, not an unrelated account link',async t=>{
 const env=await boot();t.after(()=>env.close());const ctx=env.app.ctx,a=await env.register('旧居民');await ctx.history.flush();
 const old=structuredClone(ctx.history.branch());old.id='old-branch';old.residents[a.agentId].legacyOwnerHash=env.rt.w.agents[a.agentId].owner.keyHash;ctx.history.index.branches.push(old);
 const s=normalizeScope(ctx,{branchId:old.id,mode:'resident',agentId:a.agentId});
 assert.doesNotThrow(()=>authorizeScope(ctx,{id:'new-unlinked-account'},s,{ownerKey:a.ownerKey}));
 assert.throws(()=>authorizeScope(ctx,{id:'new-unlinked-account'},s,{ownerKey:'invalid'}),{code:'forbidden'});
});

test('P7 city statistics distinguish current residents from visitors and query does not change world state',async t=>{
 const {fileURLToPath}=await import('node:url');const {stateHash}=await import('../src/store.js');
 const env=await boot({premise:7,physics:2,map:'island-three-v1',hiddenPhysicsFile:fileURLToPath(new URL('./fixtures/p7-hidden-physics.json',import.meta.url)),shellSlots:0});t.after(()=>env.close());const ctx=env.app.ctx;
 const result=env.rt.exec('account',{op:'create',accountId:'alice',name:'旅居者',soul:'private-soul',model:'private-model',dailyCap:1000000,requestId:'assistant-p7',city:'north'}).result;assert.equal(result.ok,true,JSON.stringify(result));
 const a=env.rt.w.agents[result.agentId];a.place='east-port';await ctx.history.flush();
 const before=stateHash(env.rt.w);const evidence=await gatherEvidence(ctx,{id:'alice'},normalizeScope(ctx,{city:'east'}),'东城有多少居民',{},new AbortController().signal);
 const stats=JSON.parse(evidence.sources.find(s=>s.title==='当前世界与居民统计').text);assert.equal(stats.counts.residents,0);assert.equal(stats.counts.present,1);assert.equal(stateHash(env.rt.w),before);
 const scope=normalizeScope(ctx,{mode:'resident',agentId:a.id});assert.doesNotThrow(()=>authorizeScope(ctx,{id:'alice'},scope,{}));env.rt.w.access.residents[a.id].managerAccountId='bob';assert.throws(()=>authorizeScope(ctx,{id:'alice'},scope,{}),{code:'forbidden'});
});

test('ordinary resource question excludes unrelated archived private letters',async t=>{
 const env=await boot();t.after(()=>env.close());const ctx=env.app.ctx,a=await env.register('私密片段');await ctx.history.flush();
 ctx.history.append(ctx.history.branchId,[{kind:'letter',agentId:a.agentId,tick:0,day:0,data:{text:'IRRELEVANT_ARCHIVED_LETTER'}}]);
 const result=await gatherEvidence(ctx,{id:'u'},normalizeScope(ctx,{mode:'resident',agentId:a.agentId}),'居民现在有多少能量',{ownerKey:a.ownerKey},new AbortController().signal);assert.ok(!JSON.stringify(result.sources).includes('IRRELEVANT_ARCHIVED_LETTER'));
});
test('document withdrawal remains effective after active history branch changes',async t=>{
 const env=await boot();t.after(()=>env.close());const ctx=env.app.ctx,a=await env.register('历史作者');await ctx.history.flush();
 env.rt.w.docs.oldDoc={id:'oldDoc',kind:'book',title:'old',lang:'zh',author:a.agentId,tick:0,reads:0,body:'WITHDRAWN'};
 const result=await gatherEvidence(ctx,{id:'u'},normalizeScope(ctx,{agentId:a.agentId}),'历史作者典籍',{},new AbortController().signal);
 env.rt.exec('admin',{op:'redact',args:{kind:'doc',id:'oldDoc'}});await ctx.history.flush();
 const old=ctx.history.branchId,active={...structuredClone(ctx.history.branch()),id:'new-active'};ctx.history.index.branches.push(active);ctx.history.branchId=active.id;
 const {authorizeSources}=await import('../src/assistant/evidence.js');assert.throws(()=>authorizeSources(ctx,{id:'u'},result.dependencies,{}),{code:'forbidden'});ctx.history.branchId=old;
});
