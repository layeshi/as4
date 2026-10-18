import { entitiesEnabled, ENTITY_LIMITS as L } from './catalog.js';
import { validateDefinition, fields, evolve } from './definition.js';
import { clockDay } from '../world.js';
import { bad, fail, needText, emit } from '../engine/core.js';
import { usesLawSemantics2 } from '../engine/law-semantics.js';
import { isOwnerOrSteward } from '../engine/places.js';
import { multiCity, cityOfPlace, withCity } from '../engine/cities.js';
import { jsonWeight } from '../engine/tokens.js';

export function enableEntities(w,args={}) {
  if (![6,7].includes(w.premise)||!usesLawSemantics2(w)) return bad('not_allowed');
  if (args.version!==1||Object.keys(args).some(k=>k!=='version')) return bad('invalid_request');
  if (!entitiesEnabled(w)) {
    w.entities={version:1,enabledTick:w.clock.tick,enabledCommand:w.commandN,nextDefinition:0,nextInstance:0,nextObservation:0,definitions:{},instances:{}};
    emit(w,'entities_enabled',{data:{version:1}});
  }
  return {ok:true,version:1,enabledTick:w.entities.enabledTick};
}
function entry(table,id) { if(typeof id!=='string'||!Object.hasOwn(table,id))fail('not_found');return table[id]; }
function environment(w,e,day=clockDay(w)) {
  const read=()=>({day,condition:w.places[e.place]?.condition??0,weather:w.weather.active.length?w.weather.active.map(x=>x.type):['calm']});
  return multiCity(w)?withCity(w,cityOfPlace(w,e.place),read):read();
}
function needManager(w,a,p,working=false) {
  if(!p||p.open||p.razed||p.condition===null)fail('wrong_place');
  if(p.owner.kind==='group' && w.groups[p.owner.id]?.dissolved)fail('not_allowed');
  if(!isOwnerOrSteward(w,p,a))fail('not_allowed');
  if(working&&p.condition<3000)fail('not_allowed',{zh:'建筑完好度须达到30%。',en:'Building condition must be at least 30%.'});
}
export const entityHandler={
  validate({w,a},args) {
    if(!entitiesEnabled(w))fail('not_allowed');
    const variants={define:['spec'],create:['definition','name'],interact:['entity','operation'],observe:['entity'],archive:['entity']};
    if(!Object.hasOwn(variants,args.op))fail('invalid_args');
    fields(args,['type','op',...variants[args.op]],['op',...variants[args.op]]);
    const s=w.entities;
    if(args.op==='define') {
      if(Object.keys(s.definitions).length>=L.definitions||Object.values(s.definitions).filter(d=>d.author===a.id).length>=L.perAuthor)fail('limit_reached');
      return {op:'define',spec:validateDefinition(w,args.spec),cost:0};
    }
    if(args.op==='create') {
      const d=entry(s.definitions,args.definition),p=w.places[a.place];needManager(w,a,p,true);
      if(Object.keys(s.instances).length>=L.instances||Object.values(s.instances).filter(e=>e.place===p.id&&e.status==='active').length>=L.slots)fail('limit_reached');
      return {op:'create',definition:d.id,name:needText(args.name,{max:60}),place:p.id,cost:0};
    }
    const e=entry(s.instances,args.entity),p=w.places[e.place];
    if(a.place!==e.place)fail('wrong_place');
    if(args.op==='observe') {
      const observation={id:`eo${s.nextObservation+1}`,entity:e.id,definition:e.definition,observer:a.id,tick:w.clock.tick,day:clockDay(w),values:structuredClone(e.values),status:e.status};
      return {op:'observe',entity:e.id,observation,thinking:jsonWeight({observation}),cost:0};
    }
    if(e.status!=='active')fail('not_allowed');
    needManager(w,a,p,args.op==='interact');
    if(args.op==='archive')return {op:'archive',entity:e.id,cost:0};
    const d=s.definitions[e.definition],op=d.spec.interactions.find(x=>x.key===args.operation);
    if(!op)fail('invalid_args',{zh:'实体没有这个操作，请查阅其公开定义。',en:'Unknown operation; consult the public definition.'});
    return {op:'interact',entity:e.id,operation:op.key,values:evolve(e.values,d.spec,op.rules,environment(w,e)),cost:0};
  },
  apply({w,a},p) {
    const s=w.entities;
    if(p.op==='define') {
      const id=`ed${++s.nextDefinition}`;
      s.definitions[id]={id,author:a.id,createdTick:w.clock.tick,spec:p.spec};
      emit(w,'entity_defined',{agent:a.id,place:a.place,data:{definition:id,name:p.spec.name}});
      return {definition:id};
    }
    if(p.op==='create') {
      const id=`en${++s.nextInstance}`,d=s.definitions[p.definition];
      s.instances[id]={id,name:p.name,definition:d.id,creator:a.id,place:p.place,createdTick:w.clock.tick,status:'active',values:Object.fromEntries(d.spec.attributes.map(x=>[x.key,x.initial])),lastSettledDay:clockDay(w)-1,observations:[],observationsDropped:0};
      emit(w,'entity_created',{agent:a.id,place:p.place,data:{entity:id,name:p.name,definition:d.id}});
      return {entity:id,definition:d.id};
    }
    const e=s.instances[p.entity];
    if(p.op==='observe') {
      ++s.nextObservation;e.observations.push(p.observation);
      if(e.observations.length>L.records){e.observations.shift();e.observationsDropped++;}
      emit(w,'entity_observed',{agent:a.id,place:e.place,data:{observation:p.observation}});
      return {observation:structuredClone(p.observation)};
    }
    if(p.op==='archive')closeEntity(w,e,'archived','manager',a.id);
    else {e.values=p.values;emit(w,'entity_interacted',{agent:a.id,place:e.place,data:{entity:e.id,operation:p.operation}});}
    return {entity:e.id,status:e.status};
  },
};
function closeEntity(w,e,status,reason,agent=null) {
  e.status=status;e.reason=reason;e.closedTick=w.clock.tick;
  emit(w,'entity_closed',{agent,place:e.place,data:{entity:e.id,status,reason}});
}
export function destroyPlaceEntities(w,place) {
  if(!entitiesEnabled(w))return;
  for(const e of Object.values(w.entities.instances))if(e.place===place&&e.status==='active')closeEntity(w,e,'destroyed','building_destroyed');
}
export function settleEntities(w,day) {
  if(!entitiesEnabled(w))return;
  for(const id of Object.keys(w.entities.instances).sort()) {
    const e=w.entities.instances[id];if(e.status!=='active'||e.lastSettledDay>=day)continue;
    const p=w.places[e.place];
    if(!p||p.razed||p.open||p.condition===null){closeEntity(w,e,'destroyed','building_destroyed');continue;}
    const spec=w.entities.definitions[e.definition].spec;
    e.values=evolve(e.values,spec,spec.daily,environment(w,e,day));e.lastSettledDay=day;
  }
}
