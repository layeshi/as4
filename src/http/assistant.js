import { accountFor, accountWrap } from './accounts.js';
import { AccountError } from '../accounts/store.js';
import { sendJson } from './util.js';
import { wechatIdentity } from './wechat.js';

const signed=fn=>accountWrap(fn,{signedIn:true,bodyLimit:24000});
const credentials=req=>({adminKey:req.headers['x-admin-key'],ownerKey:req.headers['x-owner-key'],wechat:req.headers['x-houren-client']==='wechat'});
function wechat(ctx,req) {if(req.headers['x-houren-client']!=='wechat')return null;const identity=wechatIdentity(ctx,req);ctx.wechat.requireIdentity(identity);return identity;}
function projection(ctx,identity,data,userId) {
  if(!identity)return data;
  // 网页上提的问题没经过微信内容检查，微信端暂不显示用第一问做的标题。
  if(data.conversation)data.conversation.title='实验对话';
  if(data.conversation)data.conversation.messages=data.conversation.messages.map(m=>{
    if(m.status==='generating')return {...m,text:'',sources:[]};
    const meta={};const joined=[m.text,...(m.sources??[]).map(s=>s.title)].join('\n');
    ctx.wechatProjection.filter(joined,identity,'text',meta);
    if(ctx.assistant.presentationTimedOut(`${userId}:message:${m.id}`,!!meta.pending,m.reviewDeadline))return {...m,text:'',sources:[],status:'withheld',moderation:{unavailable:1},error:'内容审核超过等待时限，请重新提问。'};
    if(Object.values(meta).some(Boolean))return {...m,text:'',sources:[],moderation:meta,status:meta.pending?'pending':'withheld',error:meta.pending?'内容审核中':'内容暂不可用，请稍后重试。'};
    return m;
  });
  if(data.source){const meta={};ctx.wechatProjection.filter(data.source.title+'\n'+data.source.text,identity,'text',meta);if(ctx.assistant.presentationTimedOut(`${userId}:source:${data.source.id}`,!!meta.pending))return {source:{...data.source,title:'回答依据',text:'内容审核超过等待时限，请稍后重新提问。'},moderation:{unavailable:1}};if(Object.values(meta).some(Boolean))return {source:{...data.source,title:'回答依据',text:meta.pending?'内容审核中':'内容暂不可用'},moderation:meta};}
  return data;
}
export const assistantRoutes=[
  ['GET','/api/assistant/status',accountWrap(async({req,res,ctx,authorize})=>{const user=accountFor(ctx,req),identity=wechat(ctx,req);const data=await ctx.assistant.status(user,credentials(req));if(user&&!accountFor(ctx,req))return sendJson(res,401,{error:{code:'unauthorized',message:'请重新登录。'}});if(identity){const names=rows=>rows?.map(a=>({...a,name:ctx.wechatProjection.filter(a.name,identity,'text')}));data.residents=names(data.residents);if(data.branches)data.branches=data.branches.map(b=>({...b,residents:names(b.residents)}));if(data.conversations)data.conversations=data.conversations.map(c=>({...c,title:'实验对话'}));}authorize();sendJson(res,200,data);})],
  ['POST','/api/assistant/questions',signed(async({req,res,ctx,actor,body,authorize})=>{const started=Date.now(),identity=wechat(ctx,req);let timer;try { if(identity)await Promise.race([ctx.wechat.check(body.text,identity,2),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new AccountError(503,'assistant_timeout','文本检查超过等待时限，请重试。')),ctx.assistant.deadlineMs);timer.unref();})]); } finally {clearTimeout(timer);}authorize();sendJson(res,202,await ctx.assistant.ask(actor,body,{...credentials(req),wechatIdentity:identity},authorize,started));})],
  ['GET',/^\/api\/assistant\/conversations\/([a-f0-9-]+)$/,signed(({req,res,ctx,actor,params,authorize})=>{const identity=wechat(ctx,req);const data=projection(ctx,identity,ctx.assistant.conversation(actor,params[0],credentials(req)),actor.id);authorize();sendJson(res,200,data);})],
  ['GET',/^\/api\/assistant\/conversations\/([a-f0-9-]+)\/sources\/([a-f0-9-]+)$/,signed(({req,res,ctx,actor,params,authorize})=>{const identity=wechat(ctx,req);const data=projection(ctx,identity,ctx.assistant.source(actor,params[0],params[1],credentials(req)),actor.id);authorize();sendJson(res,200,data);})],
  ['DELETE',/^\/api\/assistant\/conversations\/([a-f0-9-]+)$/,signed(({res,ctx,actor,params})=>sendJson(res,200,ctx.assistant.remove(actor,params[0])))],
  ['POST',/^\/api\/assistant\/questions\/([a-f0-9-]+)\/cancel$/,signed(({res,ctx,actor,params})=>sendJson(res,200,ctx.assistant.cancel(actor,params[0])))],
  ['GET','/api/admin/assistant',accountWrap(({res,ctx})=>sendJson(res,200,ctx.assistant.adminView()),{admin:true})],
  ['POST','/api/admin/assistant',accountWrap(({res,ctx,body})=>sendJson(res,200,ctx.assistant.configure(body)),{admin:true})],
];
