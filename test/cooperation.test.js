import test from 'node:test';
import assert from 'node:assert/strict';
import e2 from '../src/e2/facade.js';
import { createWorld, genesisOpts } from '../src/e2/world.js';
import { stateHash } from '../src/store.js';
import { cooperationQuery, cooperationText, cooperationBrief } from '../src/e2/cooperation/views.js';
import { COOP_LIMITS } from '../src/e2/cooperation/core.js';
import { P } from '../src/e2/params.js';
const hiddenPhysics={version:1,regrowth:{baseByZone:{wilds:20,scrapyard:15,solarfield:10},thresholdByZone:{wilds:30,scrapyard:25,solarfield:15},factorPermille:500},construction:{fullActionsPerTick:2,factorPermille:500}};
function fixture(enabled=true) {
  const w=createWorld({id:'cooperation',seed:'cooperation',premise:6,hiddenPhysics});
  const commands=[];
  const exec=(type,payload={})=>{const cmd={n:w.commandN+1,type,payload};commands.push(cmd);return e2.applyCommand(w,cmd);};
  const people=['问潮','禾灯','远山'].map((name,i)=>exec('account',{op:'create',accountId:`user-${i}`,name,requestId:`create-${i}`,lang:'zh',soul:'独立判断',model:'mock',dailyCap:1000000}).result.agentId);
  if(enabled)assert.equal(exec('admin',{op:'cooperation',args:{version:1}}).result.ok,true);
  let serial=0;
  const act=(id,action)=>{
    if(w.agents[id].actsThisTick>=P.maxActionsPerTick)exec('tick');
    exec('meter',{op:'wake',agentId:id,wakeId:`wake-${++serial}`,day:'2026-10-14',kind:'main',system:0,brief:0,delivered:0});
    const r=exec('act',{agentId:id,requestId:`action-${serial}`,experimentGeneration:0,actions:[action],meter:{wakeId:`wake-${serial}`,day:'2026-10-14',reread:0}});
    return r.result.results?.[0] ?? r.result;
  };
  return {w,exec,people,act,commands};
}
const good=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.data;};

test('explicit activation leaves old worlds unchanged and is idempotent',()=>{
  const {w,exec}=fixture(false);assert.equal(w.cooperation,undefined);
  assert.equal(exec('admin',{op:'cooperation',args:{version:9}}).result.ok,false);assert.equal(w.cooperation,undefined);
  assert.equal(exec('admin',{op:'cooperation',args:{version:1}}).result.ok,true);
  const tick=w.cooperation.enabledTick;
  assert.equal(exec('admin',{op:'cooperation',args:{version:1}}).events.length,0);
  assert.equal(w.cooperation.enabledTick,tick);assert.equal(w.cooperation.facts.length,0);
});
test('cards require current access, immutable editions, copies retain sources and stale edits fail',()=>{
  const {w,act,people:[a,b,c]}=fixture();
  const card=good(act(a,{type:'card',op:'create',title:'修井',body:'检查材料，再维修',visibility:'shared',readers:[b]}));
  assert.equal(cooperationQuery(w,'cards',{id:card.id},b).body,'检查材料，再维修');
  assert.throws(()=>cooperationQuery(w,'cards',{id:card.id},c),/not_found/);
  const copy=good(act(b,{type:'card',op:'copy',id:card.id,title:'我的修订',body:'先看完好度',visibility:'public'}));
  assert.equal(w.cooperation.cards[copy.id].source.id,card.id);
  good(act(a,{type:'card',op:'revise',id:card.id,version:1,body:'补上验收'}));
  assert.equal(cooperationQuery(w,'cards',{id:card.id,version:1},b).body,'检查材料，再维修');
  assert.equal(act(a,{type:'card',op:'revise',id:card.id,version:1,body:'过时'}).error.code,'conflict');
  good(act(a,{type:'card',op:'share',id:card.id,visibility:'private'}));
  assert.throws(()=>cooperationQuery(w,'cards',{id:card.id,version:1},b),/not_found/);
  assert.equal(cooperationQuery(w,'cards',{id:copy.id},c).source,null);
});
test('each private edition waits its own delay; public viewers never see newer private changes',()=>{
  const {w,act,people:[a]}=fixture();
  const k=good(act(a,{type:'card',op:'create',title:'秘密',body:'第一版'}));
  assert.throws(()=>cooperationQuery(w,'cards',{id:k.id}),/not_found/);
  w.clock.tick=P.privateDelayTicks;
  good(act(a,{type:'card',op:'revise',id:k.id,body:'第二版'}));
  assert.equal(cooperationQuery(w,'cards',{id:k.id}).body,'第一版');
  assert.throws(()=>cooperationQuery(w,'cards',{id:k.id,version:2}),/not_found/);
});
test('participation, submission and acceptance are separate; handoff requires the recipient',()=>{
  const {w,act,people:[a,b,c]}=fixture();
  const q=good(act(a,{type:'collaborate',op:'create',title:'修井',goal:'完成维护',tasks:['检查'],agents:[b]}));
  assert.throws(()=>cooperationQuery(w,'collaborations',{id:q.id},c),/not_found/);
  assert.equal(act(b,{type:'collaborate',op:'claim',id:q.id,task:0}).error.code,'forbidden');
  good(act(b,{type:'collaborate',op:'join',id:q.id}));
  good(act(b,{type:'collaborate',op:'claim',id:q.id,task:0}));
  good(act(b,{type:'collaborate',op:'submit',id:q.id,task:0,text:'完成检查'}));
  assert.equal(w.cooperation.collaborations[q.id].tasks[0].status,'submitted');
  assert.equal(act(b,{type:'collaborate',op:'review',id:q.id,task:0,accept:true}).error.code,'forbidden');
  good(act(a,{type:'collaborate',op:'handoff',id:q.id,to:b}));
  assert.equal(w.cooperation.collaborations[q.id].owner,a);
  good(act(b,{type:'collaborate',op:'accept_handoff',id:q.id}));
  good(act(b,{type:'collaborate',op:'review',id:q.id,task:0,accept:true}));
  good(act(b,{type:'collaborate',op:'finish',id:q.id}));
  assert.equal(w.cooperation.collaborations[q.id].status,'completed');
  assert.equal(w.cooperation.collaborations[q.id].contributions.length,1);
});
test('exit releases claimed work and preserves submissions without changing payments',()=>{
  const {w,act,people:[a,b]}=fixture();
  const q=good(act(a,{type:'collaborate',op:'create',title:'协作',goal:'维护',tasks:['检查'],visibility:'public'}));
  good(act(b,{type:'collaborate',op:'join',id:q.id}));good(act(b,{type:'collaborate',op:'claim',id:q.id,task:0}));
  good(act(b,{type:'collaborate',op:'submit',id:q.id,task:0,text:'部分完成'}));
  const orders=JSON.stringify(w.orders);
  good(act(b,{type:'collaborate',op:'leave',id:q.id}));
  const c=w.cooperation.collaborations[q.id];assert.equal(c.tasks[0].assignee,null);assert.equal(c.contributions.length,1);assert.equal(JSON.stringify(w.orders),orders);
  good(act(a,{type:'collaborate',op:'leave',id:q.id}));assert.equal(c.owner,null);assert.equal(c.status,'orphaned');
});
test('private judgments remain distinct from facts, have bounded capacity and can be forgotten',()=>{
  const {w,act,people:[a,b,c]}=fixture();
  good(act(a,{type:'relation',op:'note',agent:b,text:'可以合作，但需要预留时间'}));
  assert.equal(w.agents[a].memories.length,0);
  assert.equal(cooperationQuery(w,'relations',{agent:b},a).notes.length,1);
  assert.equal(cooperationQuery(w,'relations',{agent:b},c).notes.length,0);
  assert.equal(cooperationQuery(w,'relations',{}).items.length,0);
  assert.equal(act(a,{type:'relation',op:'note',agent:c,text:'字'.repeat(201)}).error.code,'text_too_long');
  good(act(a,{type:'relation',op:'forget',agent:b}));
  assert.equal(cooperationQuery(w,'relations',{agent:b},a).notes.length,0);
});
test('new summaries are bounded, details page without loss, and queries need access on every page',()=>{
  const {w,act,people:[a,b]}=fixture();
  const k=good(act(a,{type:'card',op:'create',title:'长资料',body:'😀'.repeat(2000),visibility:'shared',readers:[b]}));
  assert.ok([...cooperationBrief(w,b)].length<=COOP_LIMITS.brief);
  const first=cooperationText(w,'cards',{id:k.id},b);assert.ok([...first.text].length<=1200);assert.ok(first.nextOffset>0);
  const next=cooperationText(w,'cards',{id:k.id,version:first.version,offset:first.nextOffset},b);assert.ok([...next.text].length<=1200);
  assert.throws(()=>cooperationText(w,'cards',{id:k.id,offset:first.nextOffset},b),/invalid_args/);
  good(act(a,{type:'card',op:'share',id:k.id,visibility:'private'}));
  assert.throws(()=>cooperationText(w,'cards',{id:k.id,version:first.version,offset:first.nextOffset},b),/not_found/);
});

test('actual interaction records do not invent trust; submissions can attach verified actions',()=>{
  const {w,act,exec,people:[a,b,c]}=fixture();
  const q=good(act(a,{type:'collaborate',op:'create',title:'交付材料',goal:'双方合作',tasks:['交付'],agents:[b]}));
  good(act(b,{type:'collaborate',op:'join',id:q.id}));good(act(b,{type:'collaborate',op:'claim',id:q.id,task:0}));
  const payment=good(act(b,{type:'give',to:a,energy:100,note:'已交付'}));
  const recorded=cooperationQuery(w,'relations',{id:'actions'},b).items.at(-1);
  assert.equal(recorded.type,'give');assert.equal(recorded.kind,'verified_action');assert.equal(recorded.effect.energy,100);
  assert.equal(act(c,{type:'collaborate',op:'submit',id:q.id,task:0,text:'冒领',evidence:[recorded.id]}).error.code,'not_found');
  good(act(b,{type:'collaborate',op:'submit',id:q.id,task:0,text:'交付完成',evidence:[recorded.id]}));
  const detail=cooperationQuery(w,'collaborations',{id:q.id},a);
  assert.equal(detail.tasks[0].submissions[0].evidence[0].kind,'verified_action');
  assert.ok(cooperationQuery(w,'relations',{agent:b},a).facts.items.some(f=>f.kind==='give'));
  assert.equal(Object.keys(w.cooperation.notes).length,0);
});
test('participant limits, note replacement and full deterministic command replay hold',()=>{
  const {w,act,exec,people:[a,b],commands}=fixture();
  good(act(a,{type:'relation',op:'note',agent:b,text:'首次判断'}));
  good(act(a,{type:'relation',op:'forget',agent:b}));
  good(act(a,{type:'relation',op:'note',agent:b,text:'更新判断'}));
  const expected=stateHash(w),copy=createWorld(genesisOpts(w));
  for(const cmd of commands)e2.applyCommand(copy,cmd);
  assert.equal(stateHash(copy),expected);assert.equal(e2.checkConservation(w).ok,true);
});

test('the 32-card and 32-person caps free capacity only after resident choice',()=>{
  const {w,act,exec,people:[a]}=fixture();
  const cards=[];for(let n=0;n<32;n++)cards.push(good(act(a,{type:'card',op:'create',title:`经验${n}`,body:'操作说明'})).id);
  assert.equal(act(a,{type:'card',op:'create',title:'超额',body:'说明'}).error.code,'limit_reached');
  good(act(a,{type:'card',op:'archive',id:cards[0]}));good(act(a,{type:'card',op:'create',title:'新增',body:'说明'}));
  assert.equal(w.cooperation.cards[cards[0]].archived,true);
  const targets=[];for(let n=0;n<33;n++)targets.push(exec('account',{op:'create',accountId:`other-${n}`,name:`新居民${n}`,requestId:`new-person-${n}`,soul:'独立',model:'mock',lang:'zh',dailyCap:1000000}).result.agentId);
  for(const id of targets.slice(0,32))good(act(a,{type:'relation',op:'note',agent:id,text:'我的判断'}));
  assert.equal(act(a,{type:'relation',op:'note',agent:targets[32],text:'新评价'}).error.code,'limit_reached');
  good(act(a,{type:'relation',op:'forget',agent:targets[0]}));good(act(a,{type:'relation',op:'note',agent:targets[32],text:'新评价'}));
  assert.equal(Object.values(w.cooperation.notes[a]).filter(n=>!n.forgotten).length,32);
});
test('only 8 ongoing collaborations may be joined; rejected steps retain all submissions',()=>{
  const {w,act,people:[a,b]}=fixture();
  const qs=[];for(let n=0;n<8;n++)qs.push(good(act(a,{type:'collaborate',op:'create',title:`项目${n}`,goal:'完成',tasks:['工作'],agents:[b]})).id);
  assert.equal(act(a,{type:'collaborate',op:'create',title:'超额',goal:'完成',tasks:['工作']}).error.code,'limit_reached');
  const id=qs[0];good(act(b,{type:'collaborate',op:'join',id}));good(act(b,{type:'collaborate',op:'claim',id,task:0}));good(act(b,{type:'collaborate',op:'submit',id,task:0,text:'第一次结果'}));
  good(act(a,{type:'collaborate',op:'review',id,task:0,accept:false,text:'缺少检查记录'}));
  good(act(b,{type:'collaborate',op:'submit',id,task:0,text:'补充记录'}));
  const c=w.cooperation.collaborations[id];assert.equal(c.contributions.length,2);assert.equal(c.tasks[0].submissions.length,2);assert.equal(c.tasks[0].reviews[0].accepted,false);
  good(act(a,{type:'collaborate',op:'cancel',id}));good(act(a,{type:'collaborate',op:'create',title:'接续',goal:'完成',tasks:['工作'],source:id}));
});

test('publishing a revised card does not disclose older private drafts to residents or copies',()=>{
  const {w,act,people:[a,b]}=fixture();
  const k=good(act(a,{type:'card',op:'create',title:'草稿',body:'PRIVATE-DRAFT'}));
  good(act(a,{type:'card',op:'revise',id:k.id,body:'可发表内容'}));
  good(act(a,{type:'card',op:'share',id:k.id,visibility:'public'}));
  assert.equal(cooperationQuery(w,'cards',{id:k.id},b).body,'可发表内容');
  assert.throws(()=>cooperationQuery(w,'cards',{id:k.id,version:1},b),/not_found/);
  assert.equal(act(b,{type:'card',op:'copy',id:k.id,version:1}).error.code,'not_found');
});

test('disabled capability reproduces the frozen pre-feature P6 scenario hash',()=>{
  // Generated with pristine origin/main 0b26e34 before this feature, using the same default physics.
  const w=createWorld({id:'legacy-cooperation-golden',seed:'legacy-cooperation-golden',premise:6,hiddenPhysics});
  for(let i=0;i<2;i++)e2.applyCommand(w,{type:'account',payload:{op:'create',accountId:`legacy-${i}`,name:`旧居民${i}`,requestId:`legacy-create-${i}`,soul:'独立判断',model:'mock',lang:'zh',dailyCap:1000000}});
  for(let i=0;i<36;i++)e2.applyCommand(w,{type:'tick',payload:{}});
  assert.equal(w.cooperation,undefined);
  assert.equal(stateHash(w),'f9fc61cc49e80b17fb7c036f6b24457ac71c840cbb1524b90c5ff0a8a1c69f3a');
});

test('historical collaboration editions retain only their original contributions without quadratic copies',()=>{
  const {w,act,people:[a]}=fixture();
  const q=good(act(a,{type:'collaborate',op:'create',title:'持续研究',goal:'留下进展',tasks:['研究'],visibility:'public'}));
  const first=good(act(a,{type:'collaborate',op:'update',id:q.id,text:'最早的结果'}));
  for(let n=0;n<15;n++)good(act(a,{type:'collaborate',op:'update',id:q.id,text:`后来的结果${n}`}));
  const old=cooperationQuery(w,'collaborations',{id:q.id,version:first.version},a);
  assert.equal(old.contributions.length,1);assert.equal(old.contributions[0].text,'最早的结果');
  assert.ok(w.cooperation.collaborations[q.id].history.every(v=>!Object.hasOwn(v.value,'contributions')));
});

test('all private notes are discoverable through their own paged index, with stable text-page pins',()=>{
  const {w,act,exec,people:[a,b,c]}=fixture();
  good(act(a,{type:'relation',op:'note',agent:b,text:'对禾灯的评价'}));good(act(a,{type:'relation',op:'note',agent:c,text:'对远山的评价'}));
  const first=cooperationQuery(w,'relations',{id:'notes',limit:1},a);assert.equal(first.items[0].target,b);assert.equal(first.next,b);
  const second=cooperationQuery(w,'relations',{id:'notes',limit:1,after:first.next},a);assert.equal(second.items[0].target,c);
  for(let n=0;n<8;n++)good(act(a,{type:'card',op:'create',title:'长标题'.repeat(18)+n,body:'内容',visibility:'public'}));
  const page=cooperationText(w,'cards',{limit:20},a);assert.ok(page.nextOffset);
  good(act(a,{type:'relation',op:'note',agent:b,text:'改写评价'}));
  assert.throws(()=>cooperationText(w,'cards',{limit:20,offset:page.nextOffset,version:page.version},a),/conflict/);
});

test('linked real order escrow and terms survive collaboration cancellation',()=>{
  const {w,act,people:[a]}=fixture();
  const order=good(act(a,{type:'demand_publish',title:'发布公告',description:'说明合作进展',price:1000,criterion:{kind:'announcement',audience:'all'},durationTicks:12,waitTicks:12})).order;
  const q=good(act(a,{type:'collaborate',op:'create',title:'组织公告',goal:'保存过程',tasks:['公告'],visibility:'public'}));
  good(act(a,{type:'collaborate',op:'link',id:q.id,order}));
  const before=JSON.stringify(w.orders[order]);
  good(act(a,{type:'collaborate',op:'cancel',id:q.id}));
  assert.equal(JSON.stringify(w.orders[order]),before);assert.equal(w.orders[order].escrow,1000);assert.equal(w.orders[order].status,'open');
});
test('retirement orphans an unhanded collaboration and never invents a successor',()=>{
  const {w,act,people:[a,b]}=fixture();
  const q=good(act(a,{type:'collaborate',op:'create',title:'持续协作',goal:'完成检查',tasks:['检查'],agents:[b]}));
  good(act(b,{type:'collaborate',op:'join',id:q.id}));
  good(act(a,{type:'retire'}));
  const c=w.cooperation.collaborations[q.id];assert.equal(c.status,'orphaned');assert.equal(c.owner,null);assert.deepEqual(c.members,[b]);
  const next=good(act(b,{type:'collaborate',op:'create',title:'继续检查',goal:'完成检查',tasks:['检查'],source:q.id}));
  assert.equal(w.cooperation.collaborations[next.id].source,q.id);assert.deepEqual(w.cooperation.collaborations[next.id].members,[b]);
});
