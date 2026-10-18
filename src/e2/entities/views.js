import { entitiesEnabled, ENTITY_LIMITS as L } from './catalog.js';
import { fail } from '../engine/core.js';
export function instanceView(w,e) {
  const p=w.places[e.place];
  return { id:e.id,name:e.name,definition:e.definition,definitionName:w.entities.definitions[e.definition].spec.name,attributeLabels:Object.fromEntries(w.entities.definitions[e.definition].spec.attributes.map(a=>[a.key,a.label])),place:e.place,creator:e.creator,owner:p?.owner ? {...p.owner} : null,status:e.status,createdTick:e.createdTick,closedTick:e.closedTick ?? null,reason:e.reason ?? null };
}
export function placeEntities(w,id) {
  if (!entitiesEnabled(w)) return null;
  const p=w.places[id], all=Object.values(w.entities.instances).filter(e=>e.place===id);
  const active=all.filter(e=>e.status==='active');
  const eligible=!!p && !p.open && !p.razed && p.condition!==null && ['agent','group'].includes(p.owner.kind) && (p.owner.kind!=='group'||!!w.groups[p.owner.id]&&!w.groups[p.owner.id].dissolved);
  const shown=[...active,...all.filter(e=>e.status!=='active').slice(-4)];
  return { capacity:eligible?L.slots:0,occupied:active.length,available:eligible&&p.condition>=3000?L.slots-active.length:0,total:all.length,
    items:shown.map(e=>({...instanceView(w,e),observations:structuredClone(e.observations.slice(-4)),observationsDropped:e.observationsDropped})),
    omitted:all.length-shown.length };
}
export function entityLook(w,what,args={}) {
  if (!entitiesEnabled(w)) fail('not_found');
  if (args.limit!==undefined && (!Number.isInteger(args.limit)||args.limit<1||args.limit>50)) fail('invalid_args');
  for (const k of ['id','after','target']) if (args[k]!==undefined && typeof args[k]!=='string') fail('invalid_args');
  let rows, dropped=0;
  if (what==='entity_definitions') rows=Object.values(w.entities.definitions);
  else if (what==='entities') rows=Object.values(w.entities.instances).filter(e=>!args.target||e.place===args.target).map(e=>instanceView(w,e));
  else if (what==='entity_observations') {
    if (!args.id || !Object.hasOwn(w.entities.instances,args.id)) fail('not_found');
    const e=w.entities.instances[args.id];rows=e.observations;dropped=e.observationsDropped;
  } else fail('not_found');
  if (what!=='entity_observations' && args.id) rows=rows.filter(r=>r.id===args.id);
  const after=args.after===undefined ? -1 : rows.findIndex(r=>r.id===args.after);
  if (args.after!==undefined && after<0) fail('invalid_args',{zh:'分页位置已失效，请从第一页查询。',en:'Cursor expired; start from the first page.'});
  const items=[];let index=after+1;
  while(index<rows.length && items.length<(args.limit??5)) {
    const candidate=[...items,rows[index]];
    if (Array.from(JSON.stringify({items:candidate,next:rows[index].id,dropped})).length>L.pageChars) break;
    items.push(rows[index++]);
  }
  return structuredClone({items,next:index<rows.length&&items.length?items.at(-1).id:null,dropped});
}
