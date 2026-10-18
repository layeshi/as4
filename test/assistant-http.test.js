import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { readFileSync } from 'node:fs';

async function setup(t) {
 const e=await boot();t.after(()=>e.close());const c=e.app.ctx;
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

test('WeChat withholds the entire answer until approved, including answers created on web',async t=>{
 const {e,c,u,headers}=await setup(t);const key=c.accounts.issue(u.id,{wechat:{appid:c.wechat.appid,openid:'test-openid',verifiedAt:Date.now()}});
 const wh={...headers,Cookie:`houren_session=${key}`,'X-Houren-Client':'wechat'};
 let release;const gate=new Promise(r=>release=r);t.after(()=>release());c.wechat.check=async(_text,_identity,scene)=>{if(scene===3)await gate;};
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'解释实验'}});await c.assistant.idle();
 const path=`/api/assistant/conversations/${r.json.conversationId}`;const pending=await e.call(path,{headers:wh});assert.equal(pending.status,200);assert.equal(pending.json.conversation.messages.at(-1).status,'pending');assert.equal(pending.json.conversation.messages.at(-1).text,'');assert.deepEqual(pending.json.conversation.messages.at(-1).sources,[]);
 release();await new Promise(r=>setTimeout(r,30));const ready=await e.call(path,{headers:wh});assert.equal(ready.json.conversation.messages.at(-1).status,'complete');assert.equal(ready.json.conversation.messages.at(-1).text,'依据资料 [S1]');
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

test('WeChat presentation moderation stops waiting at its deadline without displaying text',async t=>{
 const {e,c,u,headers}=await setup(t);let now=Date.now();c.assistant.now=()=>now;
 const key=c.accounts.issue(u.id,{wechat:{appid:c.wechat.appid,openid:'deadline-openid',verifiedAt:Date.now()}}),wh={...headers,Cookie:`houren_session=${key}`,'X-Houren-Client':'wechat'};
 let release;const gate=new Promise(r=>release=r);c.wechat.check=async(_t,_i,scene)=>{if(scene===3)await gate;};
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'解释实验'}});await c.assistant.idle();const path=`/api/assistant/conversations/${r.json.conversationId}`;
 assert.equal((await e.call(path,{headers:wh})).json.conversation.messages.at(-1).status,'pending');
 now+=61000;const stopped=await e.call(path,{headers:wh});assert.equal(stopped.json.conversation.messages.at(-1).status,'withheld');assert.equal(stopped.json.conversation.messages.at(-1).text,'');release();
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
test('new WeChat answer moderation is inside generation deadline',async t=>{
 const {e,c,u,headers}=await setup(t);c.assistant.deadlineMs=60;const key=c.accounts.issue(u.id,{wechat:{appid:c.wechat.appid,openid:'timeout-openid',verifiedAt:Date.now()}});
 let release;const gate=new Promise(r=>release=r);c.wechat.check=async(_t,_i,scene)=>{if(scene===3)await gate;};
 const wh={...headers,Cookie:`houren_session=${key}`,'X-Houren-Client':'wechat'};
 const r=await e.call('/api/assistant/questions',{method:'POST',headers:wh,body:{text:'解释实验'}});assert.equal(r.status,202,r.text);await c.assistant.idle();release();
 const stored=c.assistant.store.get(u.id,r.json.conversationId).messages.at(-1);assert.equal(stored.status,'failed');assert.equal(stored.text,'');
});

test('storage failure in a detached job is contained and reservations remain charged',async t=>{
 const {e,c,u,headers}=await setup(t);let enter,release;const started=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
 c.assistant.generate=async()=>{enter();await gate;c.assistant.store.file='/nonexistent-assistant-test-directory/state.json';return {text:'回答 [S1]',usage:{input:10,output:10}};};
 const r=await e.call('/api/assistant/questions',{method:'POST',headers,body:{text:'解释实验'}});await started;const job=c.assistant.jobs.get(r.json.questionId);let rejected=false;const handled=job.promise.catch(()=>{rejected=true;});release();await handled;
 assert.equal(rejected,false);assert.equal(c.assistant.available(),false);assert.ok(Object.keys(c.assistant.store.data.reservations).length>0);
 assert.equal((await e.call('/api/public/state')).status,200);
});
