import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { streamAnswer, costSnapshot } from '../src/assistant/model.js';
const cfg={provider:'openai-responses',baseURL:'https://example.com/v1',model:'gpt-6-luna',apiKey:'test-only',group:'Openai-Gpt-1',maxOutputTokens:2048};
const response=chunks=>new Response(new ReadableStream({start(c){for(const x of chunks)c.enqueue(new TextEncoder().encode(x));c.close();}}),{headers:{'content-type':'text/event-stream','x-routing-group':'openai'}});
test('Responses SSE exposes real text deltas and exact final usage',async()=>{
 const deltas=[];const r=await streamAnswer(cfg,{system:'rules',messages:[{role:'user',content:'question'}],signal:new AbortController().signal,onDelta:d=>deltas.push(d),fetch:async()=>response(['data: {"type":"response.output_text.delta","delta":"答"}\n\n','data: {"type":"response.output_text.delta","delta":"案 [S1]"}\n\n','data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":12,"output_tokens":4,"input_tokens_details":{"cached_tokens":2}}}}\n\n'])});
 assert.deepEqual(deltas,['答','案 [S1]']);assert.equal(r.text,'答案 [S1]');assert.equal(r.usage.input,12);assert.equal(r.usage.cacheRead,2);
});
test('truncated streams and route drift fail without claiming completed answers',async()=>{
 await assert.rejects(streamAnswer(cfg,{system:'',messages:[],signal:new AbortController().signal,fetch:async()=>response(['data: {"type":"response.output_text.delta","delta":"partial"}\n\n'])}),/未完整/);
 await assert.rejects(streamAnswer(cfg,{system:'',messages:[],signal:new AbortController().signal,fetch:async()=>new Response('',{headers:{'x-routing-group':'other'}})}),/路由/);
});
test('cost snapshot removes platform markup using retained upstream USD rates',()=>{
 const c=costSnapshot({...cfg,version:2,priceVersion:'v1',exchangeRate:7,multiplier:'1.2',tiers:[{upTo:null,usd:{miss:'2',hit:'1',output:'10',write:null,writeHour:null}}]});
 assert.equal(c.pricesMicro.miss,14000000);assert.equal(c.pricesMicro.output,70000000);
});
test('Chat SSE normalizes cache usage and completes only with stop marker',async()=>{
 const r=await streamAnswer({...cfg,provider:'openai'},{system:'',messages:[],signal:new AbortController().signal,fetch:async()=>response(['data: {"choices":[{"delta":{"content":"answer [S1]"},"finish_reason":null}]}\n\n','data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n','data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3,"prompt_cache_hit_tokens":2}}\n\ndata: [DONE]\n\n'])});
 assert.equal(r.text,'answer [S1]');assert.equal(r.usage.cacheRead,2);
});
test('production transport delivers first delta before server completes',async t=>{
 let release;const gate=new Promise(r=>release=r);let first=false;
 const server=http.createServer(async(req,res)=>{res.writeHead(200,{'content-type':'text/event-stream','x-routing-group':'openai'});res.write('data: {"type":"response.output_text.delta","delta":"first"}\n\n');await gate;res.end('data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}\n\n');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{release();server.closeAllConnections();server.close();});
 let releasedByTimeout=false;const timeout=setTimeout(()=>{releasedByTimeout=true;release();},1000);
 await streamAnswer({...cfg,baseURL:`http://127.0.0.1:${server.address().port}`},{system:'',messages:[],signal:AbortSignal.timeout(3000),allowLocal:true,onDelta:()=>{first=true;clearTimeout(timeout);release();}});
 assert.equal(first,true);assert.equal(releasedByTimeout,false);
});
test('invalid upstream token components are not normalized into a cheaper valid usage',async()=>{
 const r=await streamAnswer({...cfg,provider:'openai'},{system:'',messages:[],signal:new AbortController().signal,fetch:async()=>response(['data: {"choices":[{"delta":{"content":"answer [S1]"},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":0,"prompt_cache_hit_tokens":1000}}\n\ndata: [DONE]\n\n'])});assert.equal(r.usage,null);
});
