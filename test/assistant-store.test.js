import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AssistantStore, TTL } from '../src/assistant/store.js';

function setup(t) { const dir=mkdtempSync(join(tmpdir(),'assistant-store-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let now=Date.parse('2026-10-18T15:59:00Z');const file=join(dir,'state.json');return {file,now:()=>now,advance:n=>now+=n}; }
test('budget reservations survive restart and prevent concurrent overspend',t=>{
 const o=setup(t),s=new AssistantStore(o);s.configure({dailyBudgetYuan:1});
 const a=s.begin('u',600000),b=s.begin('v',300000);assert.throws(()=>s.begin('x',200000),{code:'budget_exhausted'});
 s.settle(a.id,100000);assert.equal(s.usage().reservedYuan,.3);assert.equal(s.usage().costYuan,.1);
 const restarted=new AssistantStore(o);assert.equal(restarted.usage().reservedYuan,0);assert.equal(restarted.usage().costYuan,.4);
 restarted.settle(b.id,0);assert.equal(restarted.usage().costYuan,.4);
});
test('questions are counted once admitted, 21st rejected, midnight opens new quota',t=>{
 const o=setup(t),s=new AssistantStore(o);for(let i=0;i<20;i++){const r=s.begin('u',1);s.settle(r.id,0);}
 assert.equal(s.quota('u').remaining,0);assert.throws(()=>s.begin('u',1),{code:'question_limit'});
 o.advance(60001);assert.equal(s.quota('u').remaining,20);assert.equal(s.quota('u').used,0);
});
test('cross-day completion settles the reservation day and missing usage retains full cost',t=>{
 const o=setup(t),s=new AssistantStore(o),r=s.begin('u',900);o.advance(60001);s.settle(r.id,null,true);
 assert.equal(s.usage().costYuan,0);assert.equal(s.data.days[r.day].costMicro,900);
});
test('expiry is checked on read, deletes content and does not refresh on followup',t=>{
 const o=setup(t),s=new AssistantStore(o),c=s.createConversation('u');
 s.append(c.id,{id:'m',role:'user',text:'private',at:o.now(),status:'complete',sources:[]});
 assert.throws(()=>s.get('v',c.id),{code:'not_found'});o.advance(TTL+1);assert.equal(s.get('u',c.id).messages.length,0);
 s.append(c.id,{id:'n',role:'user',text:'later',at:o.now(),status:'complete',sources:[]});s.remove('u',c.id);
 assert.throws(()=>s.get('u',c.id),{code:'not_found'});assert.ok(!JSON.stringify(s.data).includes('private'));
});
test('corrupt state fails closed instead of replacing budget or conversations',t=>{
 const o=setup(t);writeFileSync(o.file,'not json');assert.throws(()=>new AssistantStore(o),/助手存储/);
});
