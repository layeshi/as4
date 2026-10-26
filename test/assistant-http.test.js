import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { readFileSync } from 'node:fs';
import { assistantRoutes } from '../src/http/assistant.js';

async function setup(t,options) {
 const e=await boot(options);t.after(()=>e.close());const c=e.app.ctx;
 const u=await c.accounts.create({username:'assistant_user',password:'assistant-password'});
 const headers={Cookie:`houren_session=${c.accounts.issue(u.id)}`,'X-Houren-Request':'1'};
 c.hosted.config={version:2,enabled:true,apiKey:'TEST-SECRET-KEY',baseURL:'https://example.com/v1',priceVersion:'p',maxOutputTokens:2048,models:[{id:'gpt-6-luna',provider:'openai-responses',group:'Openai-Gpt-1',tiers:[{upTo:null,usd:{miss:'1',hit:'0.1',output:'2',write:null,writeHour:null}}]}]};
 if(c.assistant)c.assistant.generate=async(_config,{onDelta,onUsage})=>{onDelta('依据资料 [S1]');const usage={input:100,output:10};onUsage(usage);return {text:'依据资料 [S1]',usage};};
 return {e,c,u,headers};
}
test('assistant requires login and CSRF, async answer has inspectable sources without keys',async t=>{
 const {e,c,headers}=await setup(t);
 assert.equal((await e.call('/api/assistant/status')).json?.signedIn,false);
 assert.equal((await e.call('/api/assistant/questions',{method:'POST',body:{text:'实验是什么'}})).status,403);
 assert.equal((await e.call('/api/assistant/questions',{method:'POST',headers:{'X-Houren-Request':'1'},body:{text:'实验是什么'}})).status,401);
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'实验是什么'}});assert.equal(r.status,202,r.text);
 await c.assistant.idle();
 const view=await e.call(`/api/assistant/conversations/${r.json.conversationId}`,{headers});assert.equal(view.status,200);const m=view.json.conversation.messages.at(-1);assert.equal(m.status,'complete');assert.ok(m.sources.length);
 const source=await e.call(`/api/assistant/conversations/${r.json.conversationId}/sources/${m.sources[0].id}`,{headers});assert.equal(source.status,200);assert.ok(source.json.source.text);
 assert.ok(!readFileSync(c.assistant.store.file,'utf8').includes('TEST-SECRET-KEY'));
});
test('private conversation becomes withheld after ownership changes, including source and followup',async t=>{
 const {e,c,headers}=await setup(t),a=await e.register('私人居民');
 const h={...headers,'X-Owner-Key':a.ownerKey};const r=await e.call('/api/assistant/questions',{method:'POST',headers:h,body:{text:'分析日记',scope:{mode:'resident',agentId:a.agentId}}});assert.equal(r.status,202,r.text);await c.assistant.idle();
 const path=`/api/assistant/conversations/${r.json.conversationId}`;const before=(await e.call(path,{headers:h})).json.conversation.messages.at(-1);
 e.rt.w.agents[a.agentId].owner.keyHash='changed';
 const after=await e.call(path,{headers:h});assert.equal(after.json.conversation.messages.at(-1).status,'withheld');assert.equal(after.json.conversation.messages.at(-1).text,'');
 assert.equal((await e.call(`${path}/sources/${before.sources[0].id}`,{headers:h})).status,403);
});
test('delete cancels in-flight generation and no late reply resurrects the conversation',async t=>{
 const {e,c,headers}=await setup(t);let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 c.assistant.generate=async(_,{signal,onDelta})=>{entered();await gate;signal.throwIfAborted();onDelta('late [S1]');return {text:'late [S1]'};};
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'解释实验'}});assert.equal(r.status,202,r.text);await started;
 assert.equal((await e.call(`/api/assistant/conversations/${r.json.conversationId}`,{method:'DELETE',headers,body:{}})).status,200);release();await c.assistant.idle();
 assert.equal((await e.call(`/api/assistant/conversations/${r.json.conversationId}`,{headers})).status,404);
});
test('unknown citations fail and missing usage retains reserved model costs',async t=>{
 const {e,c,headers}=await setup(t);c.assistant.generate=async()=>({text:'虚构 [S999]'});
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'解释实验'}});assert.equal(r.status,202,r.text);await c.assistant.idle();
 const m=(await e.call(`/api/assistant/conversations/${r.json.conversationId}`,{headers})).json.conversation.messages.at(-1);assert.equal(m.status,'failed');assert.equal(m.text,'');assert.ok(c.assistant.store.usage().costYuan>0);
});

test('invalid law scope and full conversation admission do not consume question quota',async t=>{
 const {e,c,u,headers}=await setup(t);
 const bad=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'解释法律',scope:{lawId:'no-law'}}});assert.equal(bad.status,400);assert.equal(c.assistant.store.quota(u.id).used,0);
 for(let n=0;n<100;n++)c.assistant.store.data.conversations.push({id:`test-${n}`,userId:u.id,updatedAt:Date.now(),messages:[]});
 const full=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'解释实验'}});assert.equal(full.status,429);assert.equal(c.assistant.store.quota(u.id).used,0);
});
test('inconsistent upstream cache usage retains the whole reservation',async t=>{
 const {e,c,headers}=await setup(t);c.assistant.generate=async()=>({text:'依据 [S1]',usage:{input:100,output:0,cacheRead:1000}});
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'解释实验'}});assert.equal(r.status,202);await c.assistant.idle();assert.ok(c.assistant.store.usage().costYuan>1);
});
test('submission deadline bounds a stalled archive before spending quota',async t=>{
 const {e,c,u,headers}=await setup(t);await c.history.flush();const original=c.history.flush.bind(c.history);c.history.flush=()=>new Promise(()=>{});c.assistant.deadlineMs=30;
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'解释实验'}});assert.equal(r.status,503);assert.equal(c.assistant.store.quota(u.id).used,0);c.history.flush=original;
});

test('WeChat cannot access web-created assistant answers, even after moderation approval',async t=>{
 const {e,c,u,headers}=await setup(t);const key=c.accounts.issue(u.id,{wechat:{appid:c.wechat.appid,openid:'test-openid',verifiedAt:Date.now()}});
 const wh={...headers,Cookie:`houren_session=${key}`,'X-Houren-Client':'wechat'};
 c.wechat.check=async()=>{};
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'解释实验'}});await c.assistant.idle();
 const path=`/api/assistant/conversations/${r.json.conversationId}`,denied=await e.call(path,{headers:wh});
 assert.equal(denied.status,403);assert.equal(denied.json.error.code,'wechat_observation_only');
 assert.equal((await e.call(path,{headers})).json.conversation.messages.at(-1).status,'complete');
});
test('in-flight account revocation clears partial text and terminates before completion',async t=>{
 const {e,c,u,headers}=await setup(t);let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 c.assistant.generate=async(_,{onDelta,signal})=>{onDelta('partial');entered();await gate;signal.throwIfAborted();return {text:'完成 [S1]'};};
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'解释实验'}});await started;
 c.accounts.get(u.id).revision++;release();await c.assistant.idle();const message=c.assistant.store.data.conversations.find(x=>x.id===r.json.conversationId).messages.at(-1);assert.equal(message.status,'failed');assert.equal(message.text,'');
 assert.equal((await e.call(`/api/assistant/conversations/${r.json.conversationId}`,{headers})).status,401);
});
test('assistant leaves paused world, resident balance and deterministic state untouched',async t=>{
 const {e,c,u,headers}=await setup(t);const {stateHash}=await import('../src/store.js');await c.experiment.setPaused(true);const before=stateHash(e.rt.w),balance=c.hosted.billing.balance(u.id);
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'为什么实验暂停'}});assert.equal(r.status,202,r.text);await c.assistant.idle();assert.equal(stateHash(e.rt.w),before);assert.equal(c.hosted.billing.balance(u.id),balance);
});

test('WeChat assistant rejection happens before presentation moderation or polling begins',async t=>{
 const {e,c,u,headers}=await setup(t);
 const key=c.accounts.issue(u.id,{wechat:{appid:c.wechat.appid,openid:'deadline-openid',verifiedAt:Date.now()}}),wh={...headers,Cookie:`houren_session=${key}`};
 let checks=0;c.wechat.check=async()=>{checks++;};
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'解释实验'}});await c.assistant.idle();
 const path=`/api/assistant/conversations/${r.json.conversationId}`;
 assert.equal((await e.call(path,{headers:wh})).status,403);assert.equal(checks,0);
});

test('switching to public scope does not send earlier private turns back to the model',async t=>{
 const {e,c,headers}=await setup(t),a=await e.register('范围居民'),h={...headers,'X-Owner-Key':a.ownerKey};
 c.assistant.generate=async()=>({text:'PRIVATE_EARLIER_ANSWER [S1]',usage:{input:10,output:10}});
 const first=await e.call('/api/assistant/questions',{method:'POST',headers:h,body:{text:'居民灵魂',scope:{mode:'resident',agentId:a.agentId}}});await c.assistant.idle();let prompt='';
 c.assistant.generate=async(_,{messages})=>{prompt=JSON.stringify(messages);return {text:'公开答案 [S1]',usage:{input:10,output:10}};};
 const next=await e.call('/api/assistant/questions',{method:'POST',headers:h,body:{text:'解释公开规则',conversationId:first.json.conversationId,scope:{mode:'public'}}});assert.equal(next.status,202);await c.assistant.idle();assert.ok(!prompt.includes('PRIVATE_EARLIER_ANSWER'));
});

test('an already expired original moderation deadline is never extended',async t=>{
 const {c}=await setup(t);assert.equal(c.assistant.presentationTimedOut('new-wechat-question',true,Date.now()-1),true);
});
test('new WeChat questions are rejected before consuming model budget',async t=>{
 const {e,c,u,headers}=await setup(t);const key=c.accounts.issue(u.id,{wechat:{appid:c.wechat.appid,openid:'timeout-openid',verifiedAt:Date.now()}});
 const wh={...headers,Cookie:`houren_session=${key}`,'X-Houren-Client':'wechat'};
 let calls=0;c.assistant.generate=async()=>{calls++;};
 const r=await e.call('/api/assistant/questions',{method:'POST',headers:wh,body:{text:'解释实验'}});
 assert.equal(r.status,403);assert.equal(r.json.error.code,'wechat_observation_only');assert.equal(calls,0);assert.equal(c.assistant.store.quota(u.id).used,0);
});

test('storage failure in a detached job is contained and reservations remain charged',async t=>{
 const {e,c,u,headers}=await setup(t);let enter,release;const started=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 c.assistant.generate=async()=>{enter();await gate;c.assistant.store.file='/nonexistent-assistant-test-directory/state.json';return {text:'回答 [S1]',usage:{input:10,output:10}};};
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'解释实验'}});await started;const job=c.assistant.jobs.get(r.json.questionId);let rejected=false;const handled=job.promise.catch(()=>{rejected=true;});release();await handled;
 assert.equal(rejected,false);assert.equal(c.assistant.available(),false);assert.ok(Object.keys(c.assistant.store.data.reservations).length>0);
 assert.equal((await e.call('/api/public/state')).status,200);
});

test('private scope without a provable resident is refused before quota; WeChat cannot list titles',async t=>{
 const {e,c,u,headers}=await setup(t);
 const none=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'我的居民怎么样',scope:{mode:'resident'}}});assert.equal(none.status,403);assert.equal(c.assistant.store.quota(u.id).used,0);
 const long='三城公库最近为什么差这么多？\n'.repeat(4);
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:long}});assert.equal(r.status,202,r.text);await c.assistant.idle();
 const status=(await e.call('/api/assistant/status',{headers})).json,title=[...long.replace(/\s+/g,' ').trim()].slice(0,40).join('')+'…';
 assert.equal(status.conversations[0].title,title);assert.ok(status.branches.every(b=>Object.hasOwn(b,'premise')));
 assert.equal((await e.call(`/api/assistant/conversations/${r.json.conversationId}`,{headers})).json.conversation.title,title);
 const key=c.accounts.issue(u.id,{wechat:{appid:c.wechat.appid,openid:'title-openid',verifiedAt:Date.now()}}),wh={...headers,Cookie:`houren_session=${key}`,'X-Houren-Client':'wechat'};
 assert.equal((await e.call('/api/assistant/status',{headers:wh})).json.error.code,'wechat_observation_only');
 assert.equal((await e.call(`/api/assistant/conversations/${r.json.conversationId}`,{headers:wh})).json.error.code,'wechat_observation_only');
});

for(const reason of ['approved','pending','rejected','loginRequired','unavailable','withheld','other']) {
 test(`WeChat conversation titles respect ${reason} moderation in status and detail; web titles remain unchanged`,async()=>{
  const title='三城公库最近为什么差这么多？',identity={appid:'test-app',openid:'title-user',verifiedAt:Date.now()},user={id:'title-user',revision:1},calls=[];
  const ctx={
   accounts:{session:()=>user,sessionMetadata:()=>({wechat:identity})},
   wechat:{requireIdentity:value=>assert.equal(value,identity)},
   assistant:{status:async()=>({conversations:[{id:'abc',title}],residents:[],branches:[]}),conversation:()=>({conversation:{id:'abc',title,messages:[]}})},
   wechatProjection:{filter:(value,who,key,meta)=>{calls.push({value,who,key});assert.ok(meta);meta.pending=0;if(reason!=='approved')meta[reason]=1;return reason==='approved'?value:'审核占位';}},
  };
  async function read(path,isWechat) {
   const req={method:'GET',headers:{cookie:'houren_session=test',...(isWechat?{'x-houren-client':'wechat'}:{})}};
   let status,payload;
   const res={getHeader:()=>undefined,writeHead:code=>{status=code;},end:data=>{payload=JSON.parse(data);}};
   const route=assistantRoutes.find(([method,pattern])=>method==='GET'&&(typeof pattern==='string'?pattern===path:pattern.test(path)));
   await route[2](req,res,ctx,new URL(path,'https://example.test'),['abc']);
   assert.equal(status,200);return path.endsWith('/status')?payload.conversations[0].title:payload.conversation.title;
  }
  for(const path of ['/api/assistant/status','/api/assistant/conversations/abc']) {
   assert.equal(await read(path,true),reason==='approved'?title:'实验对话');
   const count=calls.length;assert.equal(await read(path,false),title);assert.equal(calls.length,count);
  }
  assert.deepEqual(calls,[{value:title,who:identity,key:'text'},{value:title,who:identity,key:'text'}]);
 });
}
test('WeChat status shows city names only after moderation; web city names remain unchanged',async()=>{
 const identity={appid:'test-app',openid:'city-user',verifiedAt:Date.now()},user={id:'city-user',revision:1};
 const ctx={
  accounts:{session:()=>user,sessionMetadata:()=>({wechat:identity})},
  wechat:{requireIdentity:value=>assert.equal(value,identity)},
  assistant:{status:async()=>({world:{cities:[{id:'north',name:'北城'},{id:'west',name:'居民改的城名'}]},residents:[],branches:[],conversations:[]})},
  wechatProjection:{filter:value=>value==='北城'?value:'审核占位'},
 };
 async function names(isWechat) {
  const req={method:'GET',headers:{cookie:'houren_session=test',...(isWechat?{'x-houren-client':'wechat'}:{})}};
  let payload;
  const res={getHeader:()=>undefined,writeHead:()=>{},end:data=>{payload=JSON.parse(data);}};
  await assistantRoutes.find(([method,pattern])=>method==='GET'&&pattern==='/api/assistant/status')[2](req,res,ctx,new URL('/api/assistant/status','https://example.test'),[]);
  return payload.world.cities.map(c=>c.name);
 }
 assert.deepEqual(await names(true),['北城','审核占位']);
 assert.deepEqual(await names(false),['北城','居民改的城名']);
});
test('P7 answers about all residents stay out of a narrower follow-up and are withheld once any resident leaves',async t=>{
 const {fileURLToPath}=await import('node:url');
 const {e,c,u,headers}=await setup(t,{premise:7,physics:2,map:'island-three-v1',hiddenPhysicsFile:fileURLToPath(new URL('./fixtures/p7-hidden-physics.json',import.meta.url)),shellSlots:0});
 const make=(name,requestId)=>{const r=e.rt.exec('account',{op:'create',accountId:u.id,name,soul:'soul',model:'m',dailyCap:1000000,requestId,city:'north'}).result;assert.equal(r.ok,true,JSON.stringify(r));return r.agentId;};
 const a=make('甲居民','assistant-http-a'),b=make('乙居民','assistant-http-b');await c.history.flush();
 c.assistant.generate=async()=>({text:'ALL_RESIDENTS_ANSWER [S1]',usage:{input:10,output:10}});
 const first=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'我的居民最近怎么样',scope:{mode:'resident'}}});assert.equal(first.status,202,first.text);await c.assistant.idle();
 const stored=c.assistant.store.get(u.id,first.json.conversationId).messages.at(-1);assert.equal(stored.status,'complete');assert.deepEqual([...stored.scope.agentIds].sort(),[a,b].sort());
 let prompt='';c.assistant.generate=async(_,{messages})=>{prompt=JSON.stringify(messages);return {text:'追问回答 [S1]',usage:{input:10,output:10}};};
 const ask=async(text,scope)=>{const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text,scope,conversationId:first.json.conversationId}});assert.equal(r.status,202,r.text);await c.assistant.idle();return prompt;};
 assert.ok(!(await ask('甲居民呢',{mode:'resident',agentId:a})).includes('ALL_RESIDENTS_ANSWER'));
 assert.ok((await ask('再说说全部',{mode:'resident'})).includes('ALL_RESIDENTS_ANSWER'));
 e.rt.w.access.residents[b].managerAccountId='someone-else';
 const view=(await e.call(`/api/assistant/conversations/${first.json.conversationId}`,{headers})).json.conversation;assert.equal(view.messages[1].status,'withheld');assert.equal(view.messages[1].text,'');assert.equal(view.messages[3].status,'complete');
});
