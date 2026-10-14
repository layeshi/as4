import { archivedWorlds } from '../world-archives.js';
import { assetPosition } from '../e2/p6/journal.js';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import sharp from 'sharp';
import { accountWrap, accountFor } from './accounts.js';
import { AccountError, fail } from '../accounts/store.js';
import { relation } from '../e2/p6/access.js';
import { publicRoles } from '../e2/p6/roles.js';
import { involves } from '../events.js';
import { sendJson, clientIp } from './util.js';
import { runnerConfig, RunnerError } from '../runner/manager.js';
import { earthDayKey, usedToday } from './tokens.js';
import { P } from '../e2/params.js';

function p6(ctx) { if(ctx.rt.w.premise!==6)fail(404,'not_found','此世界不提供账号居民管理。'); }
function owned(ctx,actor,id) {
  p6(ctx); const r=relation(ctx.rt.w,id);
  if(!r||r.managerAccountId!==actor.id)fail(403,'forbidden','你没有此居民的管理权。');
  return r;
}
function command(ctx,actor,body) {
  const r=body.agentId?owned(ctx,actor,body.agentId):null;
  const result=ctx.rt.exec('account',{...body,accountId:actor.id,...(r?{ownershipRevision:r.ownershipRevision}:{})}).result;
  if(!result.ok)fail(result.error.code==='unauthorized'?403:400,result.error.code,'操作未完成，请核对输入与当前状态。');
  return result;
}
const wrap=fn=>accountWrap(async args=>{p6(args.ctx);try{await fn(args);}catch(e){if(e instanceof RunnerError)fail(e.status,'runner_config',e.message);throw e;}},{signedIn:true});
// Owner-only projection: runner telemetry is process-local and may outlive a stopped job.
function nextWake(ctx,a,runner) {
  const w=ctx.rt.w,called=!!a.routine.called;
  if(['dead','retired','dormant'].includes(a.status))return {state:a.status};
  if(w.paused)return {state:'experiment_paused'};
  if(['unconfigured','paused','stopped','error','hosted_unavailable'].includes(runner.status))return {state:runner.status};
  const job=ctx.runners.jobs.get(a.id);
  if(!ctx.runners.valid(a.id)||!ctx.runners.records[a.id]?.enabled||!job||job.controller.signal.aborted)return {state:'stopped'};
  if(runner.wakeEvery===0)return {state:'off',called};
  if(!Number.isInteger(runner.nextWakeTick)||!Number.isInteger(runner.wakeEvery)||runner.wakeEvery<=0)return {state:'unknown'};
  const tick=Math.max(w.clock.tick+1,runner.nextWakeTick),blockedBy=[];
  if(usedToday(a,earthDayKey(ctx))>=a.tokens.cap||runner.status==='cap_reached')blockedBy.push('cap_reached');
  if(a.energy+a.basic<=0||runner.status==='tokens_exhausted')blockedBy.push('tokens_exhausted');
  if(runner.status==='hosted_balance_low')blockedBy.push('hosted_balance_low');
  return {state:'scheduled',tick,at:ctx.rt.nextTickAt===null?null:ctx.rt.nextTickAt+(tick-w.clock.tick-1)*P.tickMs,
    every:runner.wakeEvery,called,day:Math.floor(tick/P.ticksPerDay)+1,tickOfDay:tick%P.ticksPerDay+1,blockedBy};
}
function row(ctx,id,managed=false) {
  const a=ctx.rt.w.agents[id],runner=ctx.runners.view(id),out={...ctx.rt.engine.publicAgent(ctx.rt.w,a),agentId:id,runnerStatus:runner.status};
  if(managed){const {every,day,tickOfDay,...compact}=nextWake(ctx,a,runner);out.nextWake=compact;}
  return out;
}
export async function residentEvents(ctx,id,query,authorize) {
  const w=ctx.rt.w,limit=Math.max(1,Math.min(200,Number(query.get('limit'))||50));
  let after=0,through=w.counters.event;
  if(query.get('cursor'))try{
    const c=JSON.parse(Buffer.from(query.get('cursor'),'base64url').toString());
    if(c.world!==w.id||c.id!==id||!Number.isSafeInteger(c.after)||!Number.isSafeInteger(c.through)||c.after<0||c.through>w.counters.event)throw Error();
    after=c.after;through=c.through;
  }catch{fail(400,'invalid_cursor','分页游标无效。');}
  const selected=[],type=query.get('type'),day=query.get('day');
  const visit=e=>{
    if(e.seq<=after||e.seq>through||type&&e.type!==type||day!==null&&e.day!==Number(day))return;
    if(id.startsWith('role:')){if(e.vis!=='public'||e.data?.publicRoleId!==id.slice(5))return;}
    else if(!involves(e,id)&&e.data?.actor!==id&&e.data?.requester!==id&&e.data?.provider!==id&&w.roleRequests?.[e.data?.requestId]?.agentId!==id)return;
    if(e.vis==='internal')return;
    if(e.vis==='owner'&&e.agent!==id)return;
    if(w.redacted.events.includes(e.seq))selected.push({seq:e.seq,tick:e.tick,day:e.day,type:e.type,redacted:true});
    else selected.push(e);
  };
  if(ctx.rt.events.file&&existsSync(ctx.rt.events.file)){
    const stream=createReadStream(ctx.rt.events.file),lines=createInterface({input:stream,crlfDelay:Infinity});
    try{for await(const line of lines){if(!line)continue;let e;try{e=JSON.parse(line);}catch{break;}visit(e);if(selected.length>limit)break;}}
    finally{lines.close();stream.destroy();}
  }else for(const e of ctx.rt.events.ring) {visit(e);if(selected.length>limit)break;}
  authorize();
  const more=selected.length>limit,events=selected.slice(0,limit);
  return {events,through,cursor:more?Buffer.from(JSON.stringify({world:w.id,id,after:events.at(-1).seq,through})).toString('base64url'):null};
}
function detail(ctx,id) {
  const w=ctx.rt.w,a=w.agents[id];
  const assets=assetPosition(w,a),escrow=assets.escrow;
  const runner=ctx.runners.view(id);
  return {resident:row(ctx,id),overview:{assets,energy:a.energy,basic:a.basic,materials:a.materials,escrow,dailyCap:a.tokens.cap,usedToday:usedToday(a,earthDayKey(ctx)),routine:a.routine,model:a.body.model,runner,nextWake:nextWake(ctx,a,runner),nextTickAt:ctx.rt.nextTickAt},statistics:w.residentStats[id]??null,usage:ctx.runners.usageView(id)};
}
export const residentRoutes=[
  ['GET','/api/account/residents',wrap(({res,ctx,actor})=>{
    const rows=Object.entries(ctx.rt.w.access.residents);
    sendJson(res,200,{world:ctx.rt.w.id,managed:rows.filter(([,r])=>r.managerAccountId===actor.id).map(([id])=>row(ctx,id,true)),created:rows.filter(([,r])=>r.creatorAccountId===actor.id).map(([id])=>row(ctx,id)),startupAvailable:!Object.hasOwn(ctx.rt.w.access.startupClaims,actor.id)});
  })],
  ['POST','/api/account/residents',wrap(({req,res,ctx,actor,body})=>{
    if(!ctx.limits.port.take(clientIp(req,ctx.cfg.trustProxy)))fail(429,'rate_limited','创建过于频繁，请稍后重试。');
    if(ctx.cfg.inviteCode&&body.invite!==ctx.cfg.inviteCode)fail(403,'invite_required','入城需要邀请码。');
    const allowed=['requestId','name','bio','soul','lang','dailyCap','creatorName'];
    const p=Object.fromEntries(allowed.filter(k=>Object.hasOwn(body,k)).map(k=>[k,body[k]]));
    sendJson(res,201,command(ctx,actor,{...p,op:'create',model:'待配置',creatorName:actor.displayName}));
  })],
  ['POST','/api/account/residents/adopt',wrap(({res,ctx,actor,body})=>sendJson(res,201,command(ctx,actor,{op:'adopt',soulId:body.soulId,dailyCap:body.dailyCap,requestId:body.requestId,model:'待配置',creatorName:actor.displayName})))],
  ['GET',/^\/api\/account\/residents\/([^/]+)$/,wrap(({res,ctx,actor,params})=>{
    const id=params[0],r=relation(ctx.rt.w,id);
    if(r?.managerAccountId===actor.id)sendJson(res,200,detail(ctx,id));
    else if(r?.creatorAccountId===actor.id)sendJson(res,200,{resident:ctx.rt.engine.publicAgent(ctx.rt.w,ctx.rt.w.agents[id]),publicOnly:true});
    else fail(403,'forbidden','你没有此居民的访问权。');
  })],
  ['GET',/^\/api\/account\/residents\/([^/]+)\/private$/,wrap(({res,ctx,actor,params})=>{
    owned(ctx,actor,params[0]);const a=ctx.rt.w.agents[params[0]];
    sendJson(res,200,{soul:a.soul,memories:a.memories,diary:a.diary,letters:a.letters,inbox:a.inbox});
  })],
  ['GET',/^\/api\/account\/residents\/([^/]+)\/events$/,wrap(async({res,ctx,actor,params,url,authorize})=>{
    owned(ctx,actor,params[0]);const validate=()=>{authorize();owned(ctx,actor,params[0]);};
    sendJson(res,200,await residentEvents(ctx,params[0],url.searchParams,validate));
  })],
  ['GET',/^\/api\/account\/residents\/([^/]+)\/export$/,wrap(async({res,ctx,actor,params,url,authorize})=>{
    const id=params[0];owned(ctx,actor,id);
    if(url.searchParams.get('format')==='csv'){
      const rows=ctx.rt.w.residentStats[id]?.ledger??[],day=url.searchParams.get('day');
      const cell=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return `"${s.replaceAll('"','""')}"`;};
      const data=[['commandN','tick','worldDay','kind','op','tokensChange','basicChange','materialsChange'],...rows.filter(r=>day===null||r.day===Number(day)).map(r=>[r.commandN,r.tick,r.day,r.kind,r.op,r.delta.energy,r.delta.basic,r.delta.materials])].map(r=>r.map(cell).join(',')).join('\r\n');
      authorize();owned(ctx,actor,id);res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${id}-ledger.csv"`});res.end('\uFEFF'+data);
    }else {const data=await residentEvents(ctx,id,url.searchParams,()=>{authorize();owned(ctx,actor,id);});sendJson(res,200,data,{'Content-Disposition':`attachment; filename="${id}-events.json"`});}
  })],
  ['POST',/^\/api\/account\/residents\/([^/]+)\/(cap|letter|transfer|cancel_transfer)$/,wrap(({res,ctx,actor,params,body})=>{
    let to;
    if(params[1]==='transfer'){
      const user=ctx.accounts.data.users.find(u=>u.username===String(body.username??'').toLowerCase()&&u.status==='active'&&!u.mergePending&&!u.mergedTo);
      if(!user)fail(404,'not_found','接收账号不存在或不可用。');to=user.id;
    }
    sendJson(res,200,command(ctx,actor,{op:params[1],agentId:params[0],dailyCap:body.dailyCap,text:body.text,transferId:body.transferId,to,...(params[1]==='transfer'?{now:Date.now()}:{}),requestId:body.requestId}));
  })],
  ['GET','/api/account/transfers',wrap(({res,ctx,actor})=>{
    sendJson(res,200,{transfers:Object.values(ctx.rt.w.access.transfers).filter(t=>t.to===actor.id||t.from===actor.id).map(t=>({id:t.id,agentId:t.agentId,name:ctx.rt.w.agents[t.agentId].name,direction:t.to===actor.id?'incoming':'outgoing',expiresAt:t.expiresAt,status:t.status}))});
  })],
  ['POST',/^\/api\/account\/transfers\/([^/]+)\/accept$/,wrap(async({res,ctx,actor,params,body,authorize})=>{
    const config=body.config?.hosted===true?ctx.hosted.runnerChoice(body.config):runnerConfig(body.config);authorize();
    const invitation=ctx.rt.w.access.transfers[params[0]], sender=invitation&&ctx.accounts.get(invitation.from);if(invitation&&(sender?.status!=='active'||sender.mergePending||sender.mergedTo))fail(409,'conflict','原管理账号当前不可用。');
    const result=command(ctx,actor,{op:'accept_transfer',transferId:params[0],dailyCap:body.dailyCap,model:config.model,now:Date.now(),requestId:body.requestId});
    const check=()=>{authorize();if(owned(ctx,actor,result.agentId).ownershipRevision!==result.ownershipRevision)fail(409,'conflict','管理权已再次变更。');};
    check();
    if(!ctx.runners.valid(result.agentId)){
      await ctx.runners.remove(result.agentId);check();
      await ctx.runners.attachManaged(result.agentId,actor.id,config,false,check);
    }
    sendJson(res,200,result);
  })],
  ['POST',/^\/api\/account\/residents\/([^/]+)\/runner$/,wrap(async({res,ctx,actor,params,body,authorize})=>{
    const id=params[0],r=owned(ctx,actor,id),revision=r.ownershipRevision;
    const check=()=>{authorize();if(owned(ctx,actor,id).ownershipRevision!==revision)fail(409,'conflict','管理权已变更。');};
    if(body.op==='test'){const config=await ctx.runners.prepare(body.config,ctx.runners.valid(id)?ctx.runners.records[id]?.config:{});check();sendJson(res,200,{ok:true,model:config.model});}
    else if(body.op==='save'){const previous=ctx.runners.valid(id)?ctx.runners.records[id]?.config:{};const config=body.config?.hosted===true?ctx.hosted.runnerChoice(body.config,previous):runnerConfig(body.config,previous);await ctx.runners.attachManaged(id,actor.id,config,false,check);sendJson(res,200,ctx.runners.view(id));}
    else if(body.op==='start'){check();sendJson(res,200,ctx.runners.start(id));}
    else if(body.op==='pause'){await ctx.runners.pause(id);check();sendJson(res,200,ctx.runners.view(id));}
    else if(body.op==='remove'){await ctx.runners.remove(id);check();sendJson(res,200,{ok:true});}
    else fail(400,'invalid_request','运行操作无效。');
  })],
  ['POST',/^\/api\/account\/residents\/([^/]+)\/avatar$/,uploadAvatar],
  ['DELETE',/^\/api\/account\/residents\/([^/]+)\/avatar$/,wrap(({res,ctx,actor,params,body})=>sendJson(res,200,command(ctx,actor,{op:'avatar',agentId:params[0],avatar:null,requestId:body.requestId})))],
  ['GET',/^\/api\/public\/avatars\/([a-f0-9]{64})$/,async(req,res,ctx,url,params)=>{
    try{let image;for(const dir of [ctx.rt.dir,...archivedWorlds(ctx.cfg.dataDir).map(a=>join(ctx.cfg.dataDir,a.id))]){try{image=await readFile(join(dir,'avatars',`${params[0]}.webp`));break;}catch{}}if(!image)throw Error('missing');res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'});res.end(image);}catch{res.writeHead(404).end();}
  }],
  ['GET','/api/public/roles',(req,res,ctx)=>sendJson(res,200,{roles:publicRoles(ctx.rt.w)})],
  ['GET',/^\/api\/public\/roles\/([^/]+)\/events$/,accountWrap(async({res,ctx,params,url})=>{
    if(!ctx.rt.w.publicRoles?.[params[0]])fail(404,'not_found','公共角色不存在。');
    sendJson(res,200,await residentEvents(ctx,`role:${params[0]}`,url.searchParams,()=>{}));
  })],
];
async function uploadAvatar(req,res,ctx,url,params) {
  try{
    if(req.headers['x-houren-request']!=='1'||req.headers['sec-fetch-site']==='cross-site')fail(403,'csrf','请求验证失败。');
    const actor=accountFor(ctx,req);if(!actor)fail(401,'unauthorized','请先登录。');
    const id=params[0],revision=owned(ctx,actor,id).ownershipRevision;
    const check=()=>{const user=accountFor(ctx,req);if(!user||user.id!==actor.id||user.revision!==actor.revision)fail(401,'unauthorized','请重新登录。');if(owned(ctx,actor,id).ownershipRevision!==revision)fail(409,'conflict','管理权已变更。');};
    const requestId=req.headers['x-request-id'];if(typeof requestId!=='string'||!/^[\w-]{8,128}$/.test(requestId))fail(400,'invalid_request','需要请求编号。');
    if(!ctx.accountLimits.claim.take(actor.id))fail(429,'rate_limited','图片更换过于频繁。');
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>5*1024*1024)fail(413,'too_large','图片不能超过5 MiB。');chunks.push(chunk);}
    let encoded;
    try{
      const input=Buffer.concat(chunks),meta=await sharp(input,{limitInputPixels:16000000,animated:true}).metadata();
      if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages??1)!==1)fail(400,'invalid_image','只支持静态 JPEG、PNG、WebP。');
      let pipeline=sharp(input,{limitInputPixels:16000000}).rotate();
      if(req.headers['x-avatar-crop']) {
        let crop;try{crop=JSON.parse(req.headers['x-avatar-crop']);}catch{fail(400,'invalid_crop','裁剪参数无效。');}
        if(!crop||!['left','top','width','height'].every(k=>Number.isFinite(crop[k]))||crop.left<0||crop.top<0||crop.width<=0||crop.height<=0||crop.left+crop.width>1.00001||crop.top+crop.height>1.00001)fail(400,'invalid_crop','裁剪范围无效。');
        const oriented=await pipeline.toBuffer(), info=await sharp(oriented).metadata();
        const left=Math.floor(crop.left*info.width),top=Math.floor(crop.top*info.height),width=Math.min(info.width-left,Math.max(1,Math.floor(crop.width*info.width))),height=Math.min(info.height-top,Math.max(1,Math.floor(crop.height*info.height)));
        pipeline=sharp(oriented).extract({left,top,width,height});
      }
      encoded=await pipeline.resize(512,512,{fit:'cover'}).webp({quality:85}).toBuffer();
    }catch(e){if(e instanceof AccountError)throw e;fail(400,'invalid_image','图片无法解码或超过16MP。');}
    check();const hash=createHash('sha256').update(encoded).digest('hex'),dir=join(ctx.rt.dir,'avatars');
    await mkdir(dir,{recursive:true});await writeFile(join(dir,`${hash}.webp`),encoded,{mode:0o600});check();
    sendJson(res,200,command(ctx,actor,{op:'avatar',agentId:id,avatar:hash,requestId}));
  }catch(e){if(!(e instanceof AccountError))throw e;sendJson(res,e.status,{error:{code:e.code,message:e.message}});}
}
