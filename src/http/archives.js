import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { archivedWorlds, archiveDirectory } from '../world-archives.js';
import { accountWrap } from './accounts.js';
import { fail } from '../accounts/store.js';
import { sendJson } from './util.js';
import { residentEvents } from './residents.js';

function entry(ctx,id){const a=archivedWorlds(ctx.cfg.dataDir).find(a=>a.id===id);if(!a)fail(404,'not_found','世界档案不存在。');return a;}
async function state(ctx,id){entry(ctx,id);return JSON.parse(await readFile(join(archiveDirectory(ctx.cfg.dataDir,id),'state.json'),'utf8'));}
const wrap=fn=>accountWrap(fn,{signedIn:true});
export const archiveRoutes=[
  ['GET','/api/account/worlds',wrap(({res,ctx})=>sendJson(res,200,{current:ctx.rt.w.id,archives:archivedWorlds(ctx.cfg.dataDir)}))],
  ['GET',/^\/api\/account\/worlds\/([^/]+)\/residents$/,wrap(async({res,ctx,actor,params,authorize})=>{
    const id=params[0],publicState=await state(ctx,id);
    const links=ctx.accounts.linksOf(actor.id,id),ids=new Set(links.map(l=>l.agentId));
    if(entry(ctx,id).premise===6){const relations=JSON.parse(await readFile(join(archiveDirectory(ctx.cfg.dataDir,id),'relations.json'),'utf8'));for(const [agentId,r]of Object.entries(relations))if(r.managerAccountId===actor.id||r.creatorAccountId===actor.id)ids.add(agentId);}
    authorize();
    sendJson(res,200,{world:id,archived:true,residents:publicState.agents.filter(a=>ids.has(a.id)),publicState});
  })],
  ['GET',/^\/api\/public\/worlds\/([^/]+)\/state$/,accountWrap(async({res,ctx,params})=>sendJson(res,200,await state(ctx,params[0])))],
  ['GET',/^\/api\/public\/worlds\/([^/]+)\/agents\/([^/]+)\/events$/,accountWrap(async({res,ctx,params,url})=>{
    const [world,id]=params,a=entry(ctx,world),publicState=await state(ctx,world);
    if(!publicState.agents.some(r=>r.id===id))fail(404,'not_found','居民档案不存在。');
    const projection={...ctx,rt:{w:{id:world,counters:{event:a.eventSeq},redacted:{events:[]},roleRequests:{}},events:{file:join(archiveDirectory(ctx.cfg.dataDir,world),'events.jsonl')}}};
    sendJson(res,200,await residentEvents(projection,id,url.searchParams,()=>{}));
  })],
];
