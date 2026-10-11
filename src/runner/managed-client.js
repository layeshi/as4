import { randomUUID } from 'node:crypto';
import { meCore, actCore, waitCore } from '../http/agent.js';
import { rulesCore, wakeCore, lookCore } from '../http/tokens.js';
// A process-local capability, never serialized or available over HTTP.
export function managedClient(ctx,id,valid,signal) {
  let generation;
  const denied = () => ({ok:false,status:401,json:{error:{code:'unauthorized'}}});
  const reply = r => ({ok:r.status>=200&&r.status<300,...r});
  const guarded = fn => async args => valid()&&!signal?.aborted ? reply(await fn(args??{})) : denied();
  return {
    base:'internal',
    state:guarded(()=>({status:200,json:ctx.rt.engine.publicState(ctx.rt.w)})),
    me:guarded(args=>{const json=meCore(ctx,id,{lang:args.lang??'zh',after:args.after});generation=json.now?.experimentGeneration??ctx.rt.w.experimentControl?.generation??0;return {status:200,json};}),
    rules:guarded(args=>rulesCore(ctx,id,args.lang??'zh')),
    wake:guarded(args=>wakeCore(ctx,id,args,args.lang??'zh')),
    look:guarded(args=>lookCore(ctx,id,args,args.lang??'zh')),
    act:guarded(args=>actCore(ctx,id,{...args,requestId:args.requestId??randomUUID(),experimentGeneration:args.experimentGeneration??generation},args.lang??'zh')),
    wait:guarded(async args=>{const json=await waitCore(ctx.rt,id,{...args,signal});return valid()?{status:200,json}:{status:401,json:{error:{code:'unauthorized'}}};}),
  };
}
