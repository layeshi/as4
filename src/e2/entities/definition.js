import { fail, needText } from '../engine/core.js';
import { weatherCodesFor } from '../engine/weather.js';
import { ENTITY_LIMITS as L } from './catalog.js';

const forbidden = new Set(['__proto__','prototype','constructor','day','weather','condition','coins','mint','coinVolume','coinTrade','coinPrice','treasuryCoins','coinsIn','totalCoins','mints','minted']);
const key = v => typeof v === 'string' && /^[a-z][a-z0-9_]{0,23}$/.test(v) && !forbidden.has(v);
function invalid(detail) { fail('invalid_args', { zh: `实体定义不合法：${detail}`, en: `Invalid entity definition: ${detail}` }); }
export function fields(v, names, required = names) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !names.includes(k)) || required.some(k => !Object.hasOwn(v,k))) invalid(`expected ${names.join(', ')}`);
}
function integer(v, min=-1000000, max=1000000) {
  if (!Number.isSafeInteger(v) || v < min || v > max) invalid('integer out of range');
}
function array(v, max, min=0) { if (!Array.isArray(v) || v.length < min || v.length > max) invalid(`array length ${min}..${max}`); }
export function validateDefinition(w, spec) {
  fields(spec,['name','description','attributes','daily','interactions']);
  if (Array.from(JSON.stringify(spec)).length > L.specChars) fail('limit_reached');
  spec=structuredClone(spec);
  spec.name=needText(spec.name,{max:60});spec.description=needText(spec.description,{max:200});
  array(spec.attributes,L.attributes,1);array(spec.daily,L.rules);array(spec.interactions,L.interactions);
  const keys = new Set();
  for (const a of spec.attributes) {
    fields(a,['key','label','min','max','initial']);
    if (!key(a.key) || keys.has(a.key)) invalid('attribute key');
    keys.add(a.key);a.label=needText(a.label,{max:24});integer(a.min);integer(a.max);integer(a.initial);
    if (a.min > a.max || a.initial < a.min || a.initial > a.max) invalid('attribute bounds');
  }
  function rules(rs) {
    array(rs,L.rules);
    for (const r of rs) {
      fields(r,['if','attribute','delta'],['attribute','delta']);
      if (!keys.has(r.attribute)) invalid('unknown attribute');integer(r.delta);
      if (r.if !== undefined) {
        const c=r.if;fields(c,['field','op','value']);
        if (!keys.has(c.field) && !['day','condition','weather'].includes(c.field)) invalid('condition field');
        if (!['eq','ne','lt','lte','gt','gte'].includes(c.op)) invalid('comparison');
        if (c.field === 'weather') {
          if (!['eq','ne'].includes(c.op) || !weatherCodesFor(w).includes(c.value)) invalid('weather condition');
        } else integer(c.value, -1000000, 1000000000);
      }
    }
  }
  rules(spec.daily);
  const operations=new Set();
  for (const op of spec.interactions) {
    fields(op,['key','label','rules']);if (!key(op.key) || operations.has(op.key)) invalid('operation key');
    operations.add(op.key);op.label=needText(op.label,{max:24});rules(op.rules);
  }
  return structuredClone(spec);
}
const comparisons = { eq:(a,b)=>a===b, ne:(a,b)=>a!==b, lt:(a,b)=>a<b, lte:(a,b)=>a<=b, gt:(a,b)=>a>b, gte:(a,b)=>a>=b };
export function evolve(values, definition, rules, environment) {
  const next={...values};
  for (const r of rules) {
    if (r.if) {
      const {field,op,value}=r.if;
      const actual=field==='weather' ? environment.weather.includes(value) : Object.hasOwn(next,field) ? next[field] : environment[field];
      const expected=field==='weather' ? true : value;
      if (!comparisons[op](actual,expected)) continue;
    }
    const a=definition.attributes.find(a=>a.key===r.attribute);
    next[r.attribute]=Math.max(a.min,Math.min(a.max,next[r.attribute]+r.delta));
  }
  return next;
}
