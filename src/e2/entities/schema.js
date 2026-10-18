import { ENTITY_LIMITS as L } from './catalog.js';
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const text=(maxLength=60)=>({type:'string',minLength:1,maxLength});
const key={...text(24),pattern:'^[a-z][a-z0-9_]{0,23}$'};
const number={type:'integer',minimum:-1000000,maximum:1000000};
const list=(items,maxItems,minItems=0)=>({type:'array',items,maxItems,minItems});
const condition=obj({field:text(24),op:{type:'string',enum:['eq','ne','lt','lte','gt','gte']},value:{type:['integer','string']}});
const rule=obj({if:condition,attribute:key,delta:number},['attribute','delta']);
export const entitySpecSchema=obj({name:text(),description:text(200),attributes:list(obj({key,label:text(24),min:number,max:number,initial:number}),L.attributes,1),daily:list(rule,L.rules),interactions:list(obj({key,label:text(24),rules:list(rule,L.rules)}),L.interactions)});
export function entityActionSchema(action=false) {
  const fields={op:{type:'string',enum:['define','create','interact','observe','archive']},spec:entitySpecSchema,definition:text(),name:text(),entity:text(),operation:key};
  if(action)fields.type={type:'string',enum:['entity']};
  return {...obj(fields,[...(action?['type']:[]),'op']),anyOf:Object.entries({define:['spec'],create:['definition','name'],interact:['entity','operation'],observe:['entity'],archive:['entity']}).map(([op,required])=>({properties:{op:{enum:[op]}},required}))};
}
