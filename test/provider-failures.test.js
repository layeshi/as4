import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../runner/providers.js';
import { classifyProviderError, safeCallMetadata, cleanPersistedMetadata } from '../src/telemetry-safety.js';
import { openCity, drive } from './p2-loop-helpers.js';
import { Budget } from '../src/shells/budget.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageStore } from '../src/runner/usage.js';
const request={system:'s',messages:[{role:'user',content:'u'}]};
const native={system:'s',transcript:[{role:'user',text:'u'}],tools:[]};
async function adapter(provider, body, status=200) { return createProvider({provider,model:'m'}, {fetch:async()=>new Response(typeof body==='string'?body:JSON.stringify(body),{status})}); }
for (const provider of ['openai','openai-responses']) for(const method of ['complete','step']) {
 test(`${provider} ${method}: HTTP 200 embedded failure is classified before any output`, async()=>{
  const body=provider==='openai'?{error:{code:429,message:'PRIVATE_UPSTREAM',metadata:{error_type:'rate_limit_exceeded'}},choices:[{message:{role:'assistant',content:'partial'},finish_reason:'error'}]}:{status:'failed',error:{code:'server_error',message:'PRIVATE_UPSTREAM'},error_type:'rate_limit_exceeded',output:[]};
  const p=await adapter(provider,body);
  await assert.rejects(p[method](method==='complete'?request:native),e=>{
   assert.equal(e.status,200);assert.equal(e.retryable,true);assert.equal(e.fatal,false);
   assert.equal(classifyProviderError(e).errorKind,'rate_limit');assert.equal(e.upstreamErrorType,'rate_limit_exceeded');assert.equal(e.phase,'response');
   assert.ok(!e.message.includes('PRIVATE_UPSTREAM'));return true;
  });
 });
 test(`${provider} ${method}: invalid JSON is a decode failure`,async()=>{
  const p=await adapter(provider,'not-json PRIVATE_UPSTREAM');await assert.rejects(p[method](method==='complete'?request:native),e=>classifyProviderError(e).errorKind==='invalid_response'&&e.phase==='decode'&&e.status===200);
 });
 test(`${provider} ${method}: missing output shape is a failure`,async()=>{
  const p=await adapter(provider,{unexpected:'PRIVATE_UPSTREAM'});await assert.rejects(p[method](method==='complete'?request:native),e=>classifyProviderError(e).errorKind==='invalid_response'&&e.phase==='shape');
 });
 test(`${provider} ${method}: normal empty response remains usable`,async()=>{
  const body=provider==='openai'?{choices:[{message:{role:'assistant',content:''},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:0}}:{status:'completed',output:[],usage:{input_tokens:3,output_tokens:0}};
  const r=await (await adapter(provider,body))[method](method==='complete'?request:native);assert.equal(r.text,'');assert.equal(r.usage.input,3);
 });
}
test('choice-level business failure cannot expose partial native calls',async()=>{
 const p=await adapter('openai',{choices:[{message:{role:'assistant',content:'partial',tool_calls:[{id:'a',function:{name:'say',arguments:'{}'}}]},finish_reason:'error',error:{code:502,metadata:{error_type:'server'},message:'PRIVATE'}}]});
 await assert.rejects(p.step(native),e=>classifyProviderError(e).errorKind==='http'&&e.providerCode===502&&e.phase==='response');
});
test('safe failure fields survive hosted persistence and exclude arbitrary text',async()=>{
 const p=await adapter('openai-responses',{status:'failed',error:{code:'server_error',message:'PRIVATE'},error_type:'rate_limit_exceeded'});let error;try{await p.complete(request)}catch(e){error=e}
 const meta={ok:false,error,toolCallCount:0};const u=new UsageStore({file:null});u.record('a11',null,meta,'m');
 assert.equal(u.agents.a11.total.failed,1);const row=u.agents.a11.recent[0];assert.equal(row.status,200);assert.equal(row.upstreamErrorType,'rate_limit_exceeded');assert.equal(row.providerCode,'server_error');assert.equal(row.phase,'response');
 assert.deepEqual(cleanPersistedMetadata(row),safeCallMetadata(meta,false));
 const bad=safeCallMetadata({ok:false,error:{status:200,errorKind:'PRIVATE',upstreamErrorType:'PRIVATE',providerCode:'PRIVATE',phase:'PRIVATE',message:'PRIVATE'}},false);
 assert.ok(!JSON.stringify(bad).includes('PRIVATE'));assert.ok(!JSON.stringify(row).includes('PRIVATE'));
});
test('structured error types separate timeout, authentication and validation without faking HTTP status',async()=>{
 for(const [type,kind]of [['upstream_timeout','timeout'],['authentication','auth'],['invalid_request','http'],['server','http']]){
 const p=await adapter('openai-responses',{status:'failed',error:{code:'server_error',message:'PRIVATE'},error_type:type});await assert.rejects(p.complete(request),e=>classifyProviderError(e).errorKind===kind&&e.status===200&&e.fatal===false);
 }
});
test('non-2xx response preserves actual HTTP status and safe upstream code',async()=>{
 const p=await adapter('openai',{error:{code:429,message:'PRIVATE',metadata:{error_type:'rate_limit_exceeded'}}},429);await assert.rejects(p.complete(request),e=>e.status===429&&e.retryable&&e.upstreamErrorType==='rate_limit_exceeded'&&!JSON.stringify(safeCallMetadata({ok:false,error:e},false)).includes('PRIVATE'));
});
test('Responses incomplete output is not an API failure and still records usage',async()=>{
 const p=await adapter('openai-responses',{status:'incomplete',output:[],incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:3,output_tokens:2}});const r=await p.complete(request);assert.equal(r.stop,'length');assert.equal(r.usage.output,2);
});

test('canonical OpenRouter overload, unavailable, payment and permission errors remain identifiable',async()=>{
 for(const [type,kind]of [['provider_overloaded','http'],['provider_unavailable','http'],['payment_required','http'],['permission_denied','auth'],['invalid_prompt','http'],['unmapped','http']]){
  const p=await adapter('openai-responses',{status:'failed',error:{code:'server_error',message:'PRIVATE'},error_type:type});
  await assert.rejects(p.complete(request),e=>{assert.equal(e.upstreamErrorType,type);assert.equal(classifyProviderError(e).errorKind,kind);return true});
 }
});

for (const provider of ['openai','openai-responses']) for(const mode of ['json','native']) test(`${provider} ${mode}: actual runner records failure and never submits partial actions`,async()=>{
 const city=openCity({names:['one']});
 try{
  const inner=await adapter(provider,provider==='openai'?{error:{code:429,metadata:{error_type:'rate_limit_exceeded'}},choices:[{message:{role:'assistant',content:'{"calls":[{"name":"say","args":{"text":"partial"}}]}',tool_calls:[{id:'a',function:{name:'say',arguments:'{"text":"partial"}'}}]},finish_reason:'error'}]}:{status:'failed',error:{code:'server_error'},error_type:'rate_limit_exceeded',output:[{type:'function_call',call_id:'a',name:'say',arguments:'{"text":"partial"}'}]});
  const before=city.rt.w.commandN;const out=await drive(city,city.ids[0],{inner,cfg:{toolMode:mode,actionTools:'typed'}});
  assert.equal(out.requests.length,1);assert.equal(out.usage.length,1);assert.equal(out.usage[0].ok,false);assert.equal(safeCallMetadata(out.usage[0],false).upstreamErrorType,'rate_limit_exceeded');assert.equal(city.rt.w.commandN,before);assert.equal(out.wakings[0].rec.acts.length,0);
 }finally{city.close()}
});
test('hosted and shell failure diagnostics retain safe fields across file reload without changing budget or old usage',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'f1-metadata-'));
 try{
  const p=await adapter('openai-responses',{status:'failed',error:{code:'server_error',message:'PRIVATE'},error_type:'provider_unavailable'});let error;try{await p.complete(request)}catch(e){error=e}
  const file=join(dir,'hosted.json');const u=new UsageStore({file});u.record('a11',{input:5,output:2},{ok:true},'m');u.record('a11',null,{ok:false,error,toolCallCount:0},'m');
  const v=new UsageStore({file});assert.equal(v.agents.a11.total.input,5);assert.equal(v.agents.a11.total.failed,1);assert.equal(v.agents.a11.recent[1].upstreamErrorType,'provider_unavailable');assert.equal(v.agents.a11.recent[1].status,200);
  const shellFile=join(dir,'shell.json'),b=new Budget({file:shellFile,tokensPerDay:1000});const ticket=b.reserveTokens('a1',20);b.settle(ticket,7);b.recordCall('a1',null,{ok:false,error,toolCallCount:0});
  const restored=new Budget({file:shellFile,tokensPerDay:1000});assert.equal(restored.used,7);assert.equal(restored.day().agents.a1.recent[0].upstreamErrorType,'provider_unavailable');assert.equal(restored.day().agents.a1.recent[0].phase,'response');
 }finally{rmSync(dir,{recursive:true,force:true})}
});
