import { commandAuthority } from '../compute/authority.js';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { busy } from '../compute/online.js';
import { meCore, actCore, waitCore } from '../http/agent.js';
import { rulesCore, wakeCore, lookCore } from '../http/tokens.js';
const waitForRetry = async (ms,signal) => {
  try { await delay(ms,undefined,{signal}); }
  catch(error) { if(error.name!=='AbortError')throw error; }
};
// A process-local capability, never serialized or available over HTTP.
export function managedClient(ctx,id,valid,signal,{now=()=>performance.now(),wait=waitForRetry}={}) {
  let generation, observedTick;
  const denied = () => ({ok:false,status:401,json:{error:{code:'unauthorized'}}});
  const reply = r => ({ok:r.status>=200&&r.status<300,...r});
  const unavailable = () => ({ok:false,status:503,json:{error:{code:'compute_busy'}}});
  const guarded = (fn,{retry=false,normalize=args=>args,waking=false}={}) => async args => {
    if (!valid() || signal?.aborted) return denied();
    // Keep the action identity and complete payload fixed across admission retries.
    const body = normalize(retry ? structuredClone(args??{}) : args??{});
    const tick = retry ? ((waking ? observedTick : ctx.wakings?.get(id)?.tick??observedTick)??ctx.rt.w.clock.tick) : undefined;
    const deadline = now()+120000;
    const authorize = () => {
      if (!valid() || signal?.aborted) throw Object.assign(new Error('Resident capability expired'), {status:401,code:'unauthorized'});
      if (retry && (ctx.rt.stopped || ctx.rt.w.clock.tick!==tick || now()>=deadline)) throw busy();
    };
    for (let attempt=0;attempt<4;attempt++) {
      let result;
      try { authorize(); result=reply(await commandAuthority.run(authorize,()=>fn(body))); }
      catch (error) { if(error.code==='unauthorized')return denied();if(error.code!=='compute_busy')throw error;result=unavailable(); }
      // Never race an admitted command or override its acknowledged success.
      if (!retry || result.json?.error?.code!=='compute_busy' || attempt===3 || ctx.rt.w.clock.tick!==tick || now()>=deadline) return result;
      await wait(Math.min(250*2**attempt+Math.random()*250,Math.max(0,deadline-now())),signal);
    }
  };
  return {
    base:'internal',
    state:guarded(()=>({status:200,json:ctx.rt.engine.publicState(ctx.rt.w)})),
    me:guarded(args=>{const json=meCore(ctx,id,{lang:args.lang??'zh',after:args.after});generation=json.now?.experimentGeneration??ctx.rt.w.experimentControl?.generation??0;observedTick=json.now?.tick;return {status:200,json};}),
    rules:guarded(args=>rulesCore(ctx,id,args.lang??'zh')),
    wake:guarded(args=>wakeCore(ctx,id,args,args.lang??'zh'),{retry:true,waking:true}),
    look:guarded(args=>lookCore(ctx,id,args,args.lang??'zh'),{retry:true}),
    act:guarded(args=>actCore(ctx,id,args,args.lang??'zh'),{retry:true,normalize:args=>({...args,requestId:args.requestId??randomUUID(),experimentGeneration:args.experimentGeneration??generation})}),
    wait:guarded(async args=>{const json=await waitCore(ctx.rt,id,{...args,signal});return valid()?{status:200,json}:{status:401,json:{error:{code:'unauthorized'}}};}),
  };
}
