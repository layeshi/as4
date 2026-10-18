import { modelFetch } from '../runner/endpoint.js';
import { product, FX, RATE_KEYS, canonicalRoutingGroup } from '../hosted/catalog.js';

export function costSnapshot(snapshot) {
  if(snapshot.version!==2 || !snapshot.tiers?.length)throw Error('助手需要已核验的 OpenLux 模型目录与上游成本价格。');
  const tiers=snapshot.tiers.map(t=>({upTo:t.upTo,pricesMicro:Object.fromEntries(RATE_KEYS.map(k=>[k,t.usd?.[k]==null?null:product([t.usd[k],snapshot.exchangeRate??FX],true)]))}));
  if(tiers.some(t=>!Number.isSafeInteger(t.pricesMicro.miss)||!Number.isSafeInteger(t.pricesMicro.output)))throw Error('上游成本价格不完整。');
  return {...snapshot,tiers,pricesMicro:tiers[0].pricesMicro,maxOutputTokens:Math.min(snapshot.maxOutputTokens??2048,2048)};
}
export function validUsage(u) {
  if(!u || !['input','output'].every(k=>Number.isSafeInteger(u[k])&&u[k]>=0))return null;
  for(const k of ['cacheRead','cacheWrite','cacheWriteHour'])if(u[k]!==undefined && (!Number.isSafeInteger(u[k])||u[k]<0))return null;
  if((u.cacheRead??0)+(u.cacheWrite??0)>u.input || (u.cacheWriteHour??0)>(u.cacheWrite??0))return null;
  return u;
}
function usageOf(u,responses) {
  if(!u)return null;
  const input=responses?u.input_tokens:u.prompt_tokens,output=responses?u.output_tokens:u.completion_tokens;
  if(![input,output].every(n=>Number.isSafeInteger(n)&&n>=0))return null;
  const details=responses?u.input_tokens_details:u.prompt_tokens_details;
  return validUsage({input,output,cacheRead:details?.cached_tokens??u.prompt_cache_hit_tokens??0,cacheWrite:u.cache_creation_input_tokens??details?.cache_write_tokens??0,cacheWriteHour:u.cache_creation?.ephemeral_1h_input_tokens??0});
}
/** A single bounded text call. No tools, no world writes and no automatic retry. */
export async function streamAnswer(config,{system,messages,signal,onDelta=()=>{},onUsage=()=>{},fetch:fetchOverride,allowLocal=false}) {
  const responses=config.provider==='openai-responses';
  const endpoint=config.baseURL.replace(/\/$/,'')+(responses?'/responses':'/chat/completions');
  const body=responses?{model:config.model,instructions:system,input:messages,store:false,stream:true,max_output_tokens:config.maxOutputTokens}
    :{model:config.model,messages:[{role:'system',content:system},...messages],stream:true,stream_options:{include_usage:true},max_tokens:config.maxOutputTokens};
  const response=await (fetchOverride??modelFetch(allowLocal,{timeoutMs:60000,stream:true}))(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},body:JSON.stringify(body),signal});
  if(!response.ok) {await response.body?.cancel();throw Error(`模型接口暂不可用（HTTP ${response.status}）。`);}
  if(config.group && canonicalRoutingGroup(config.model,response.headers.get('x-routing-group'))!==config.group) {await response.body?.cancel();throw Error('模型路由分组已变化，请管理员重新核验。');}
  let text='',usage=null,completed=false,done=false;
  const delta=value=>{if(typeof value!=='string')return;text+=value;if(Buffer.byteLength(text)>64000)throw Error('回答过长，已停止。');onDelta(value);};
  const parse=value=>{
    if(value==='[DONE]'){done=true;return;}
    const e=JSON.parse(value);
    const raw=responses?e.response?.usage:e.usage;if(raw){usage=usageOf(raw,responses);onUsage(usage);}
    if(e.error||['response.failed','response.incomplete','error'].includes(e.type))throw Error('模型未完整生成回答。');
    if(responses){
      if(e.type==='response.output_text.delta')delta(e.delta);
      if(e.type==='response.completed')completed=e.response?.status==='completed';
    } else {
      for(const choice of e.choices??[]){delta(choice.delta?.content);if(choice.finish_reason){if(choice.finish_reason!=='stop')throw Error('模型未完整生成回答。');completed=true;}}
    }
  };
  if(!response.headers.get('content-type')?.includes('text/event-stream')) {await response.body?.cancel();throw Error('模型未返回所需的流式文本响应。');}
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0;
  try {
    for(;;){signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>4*1024*1024)throw Error('模型响应过大。');buffer=(buffer+decoder.decode(chunk.value,{stream:true})).replace(/\r\n/g,'\n');
      let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(data)parse(data);}
    }
    if(buffer.trim())throw Error('模型未完整返回流式数据。');
    if(!completed||!responses&&!done||!text.trim())throw Error('模型未完整生成回答。');
    signal.throwIfAborted();return {text,usage};
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
