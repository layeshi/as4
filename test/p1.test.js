import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goldenSamples } from './fixtures/p1/golden.js';
import e2, { premised } from '../src/e2/facade.js';
import { genesisOpts } from '../src/e2/world.js';
import { loadConfig } from '../src/config.js';
import { stateHash } from '../src/store.js';
import { reg } from './e2-helpers.js';
test('P1 T1: premise 0 golden samples remain byte identical', () => {
  assert.deepEqual(goldenSamples(), JSON.parse(readFileSync(new URL('./fixtures/p1/premise0.json', import.meta.url))));
});
test('P1 T1: version, all perception forms, genesis and determinism', () => {
  const w0 = e2.createWorld({ seed: 'p1' });
  for (const key of ['premise', 'backstage']) assert.equal(Object.hasOwn(w0, key), false);
  assert.equal(Object.hasOwn(w0.shells, 'bodies'), false);
  assert.equal(Object.hasOwn(w0.dayLog, 'p1'), false);
  const w = e2.createWorld({ seed: 'p1', premise: 1, shellSlots: 16 });
  assert.ok(premised(w)); assert.equal(w.shells.bodies.length, 16);
  assert.deepEqual(w, e2.createWorld(genesisOpts(w)));
  const a = reg(w, '甲');
  for (const status of ['awake', 'dormant', 'dead', 'retired']) {
    a.status = status;
    assert.equal(e2.buildPerception(w, a.id, { ack: false }).premise, 1);
  }
  const run = () => { const x = e2.createWorld({ seed: 'same', premise: 1 }); for (let i = 0; i < 120; i++) e2.applyCommand(x, { type: 'tick' }); return stateHash(x); };
  assert.equal(run(), run()); assert.equal(e2.publicState(w).world.premise, 1);
  assert.throws(() => e2.createWorld({ seed: 'x', premise: 2 }), /PREMISE/);
});
test('P1 T1: configuration validation', () => {
  assert.equal(loadConfig({ PHYSICS: '2', PREMISE: '1' }, []).premise, 1);
  assert.throws(() => loadConfig({ PREMISE: '2' }, []), /PREMISE 只能/);
  assert.throws(() => loadConfig({ PREMISE: '1', PHYSICS: '1' }, []), /只用于第二纪/);
});

import { textWeight } from '../src/text.js';
import { validateFounders } from '../src/e2/world.js';
import { one, bareWorld } from './e2-helpers.js';
test('P1 T2: text weight vectors and hard limits', () => {
  for (const [s, weight] of [['',0],['温故知新',4],['abc',1],['abcd',2],['你好 world',4],['こんにちは',5],['سلام',2],['😀😀😀',1]]) assert.equal(textWeight(s), weight);
  const w = bareWorld('weight', { premise: 1 }); const a = reg(w, '甲');
  assert.equal(one(w,a,{ type:'remember',text:'a'.repeat(600) }).ok,true);
  const over = one(w,a,{ type:'remember',text:'a'.repeat(601) });
  assert.equal(over.error.code,'text_too_long'); assert.equal(over.error.limit,200); assert.equal(over.error.weight,201); assert.ok(over.error.hint.zh.includes('现在 201'));
  assert.equal(one(w,a,{ type:'remember',text:'a'.repeat(801) }).error.code,'text_too_long');
  const p0=bareWorld(); const b=reg(p0,'乙'); assert.equal(one(p0,b,{type:'remember',text:'a'.repeat(600)}).error.code,'text_too_long');
  for (const type of ['conceive','will']) {
    const args = type === 'conceive' ? {name:'丙',soul:'汉'.repeat(1501)} : {heirs:[],successor:{name:'丁',soul:'汉'.repeat(1501)}};
    const r=one(w,a,{type,...args}); assert.equal(r.error.code,'text_too_long');assert.equal(r.error.limit,1500);assert.equal(r.error.weight,1501);
  }
  const r=e2.applyCommand(w,{type:'register',payload:{name:'戊',soul:'汉'.repeat(1501),model:'mock'}}).result;
  assert.deepEqual(r.error,{code:'text_too_long',field:'soul',limit:1500,weight:1501});
  const f=[{day:0,name:'己',bio:'',soul:'汉'.repeat(1501),lang:'zh'}];
  assert.throws(()=>validateFounders(f,{premise:1}),/founders\[0\].*1501/); assert.equal(validateFounders(f).length,1);
});

import { upkeepOf, weightOf, metabolismIn, applyMetabolism } from '../src/e2/engine/lifecycle.js';
import { renderPerception2 } from '../runner/render2.js';
test('P1 T3: weight metabolism anchors, age independence and private rendering', () => {
  for (const [s,k,m] of [[176,0,3],[176,2400,15],[1500,2400,22]]) {
    const a={soul:'汉'.repeat(s),memories:[{text:'汉'.repeat(k)}]}; assert.deepEqual(weightOf(a),{soul:s,memories:k}); assert.equal(upkeepOf(a),m);
  }
  const w=bareWorld('upkeep',{premise:1});const a=reg(w,'甲');
  assert.equal(metabolismIn(w,a,0),metabolismIn(w,a,500));
  a.energy=40; applyMetabolism(w,500);assert.equal(a.energy,37);
  const p=e2.buildPerception(w,a.id,{ack:false});assert.equal(p.you.metabolism,3);assert.deepEqual(p.you.weight,weightOf(a));
  assert.ok(renderPerception2(p).includes('代谢 3/日（灵魂分量 3 · 记忆分量 0）'));
  assert.ok(renderPerception2(e2.buildPerception(w,a.id,{ack:false,lang:'en'})).includes('soul weight 3'));
  const publicA=e2.publicState(w).agents[0];assert.equal(Object.hasOwn(publicA,'weight'),false);assert.equal(Object.hasOwn(publicA,'metabolism'),false);
});

import { applyDeaths } from '../src/e2/engine/lifecycle.js';
import { drainEvents, creditEnergy } from '../src/e2/engine/core.js';
test('P1 T4: daily dormancy loss, irreversible death, wake and p0 RNG', () => {
  const w=bareWorld('loss',{premise:1});const a=reg(w,'甲');
  a.memories=Array.from({length:3},(_,i)=>({text:`记忆${i}`,day:0,tick:0,from:null}));
  a.body.trained=[{text:'习得',weight:2}];a.status='dormant';a.dormantSinceDay=5;
  applyDeaths(w,5);assert.equal(a.memories.length,3);
  for (const d of [6,7]) { applyDeaths(w,d);const loss=drainEvents(w).filter(e=>e.type==='forget');assert.equal(loss.length,1);assert.equal(loss[0].vis,'delayed');assert.equal(loss[0].data.cause,'dormancy'); }
  assert.equal(w.dayLog.p1.dormancyLosses,2);assert.equal(a.inbox.filter(x=>x.code==='dormancy_loss').length,2);
  applyDeaths(w,8);assert.equal(a.status,'dead');assert.equal(w.cemetery[0].memories.length,1);assert.equal(a.body.trained.length,1);
  const b=reg(w,'乙');b.status='dormant';b.dormantSinceDay=10;b.energy=0;b.memories=[{text:'留下'}];creditEnergy(w,b,5);applyDeaths(w,12);assert.equal(b.memories.length,1);
  const p0=bareWorld();const c=reg(p0,'丙');c.status='dormant';c.dormantSinceDay=0;c.memories=[{text:'原样'}];const rng=JSON.stringify(p0.rng.world);applyDeaths(p0,1);applyDeaths(p0,2);assert.equal(JSON.stringify(p0.rng.world),rng);assert.equal(c.memories.length,1);
});

import { actionTable, ACTION_ORDER, ACTION_ORDER_P1 } from '../src/e2/lore/actions.js';
import { parseWhen } from '../src/e2/rules/check.js';
import { bornFromSoul } from '../src/e2/engine/souls.js';
test('P1 T5: impart, acceptance, provenance, expiry, limits, validation and inner rules', () => {
  const w=bareWorld('gifts',{premise:1});const a=reg(w,'甲'),b=reg(w,'乙'),c=reg(w,'丙');
  assert.equal(one(w,a,{type:'impart',to:b.id,memory:0}).error.code,'invalid_args');
  one(w,a,{type:'remember',text:'祖传文字'});assert.equal(a.memories[0].origin,a.id);
  assert.equal(one(w,a,{type:'impart',to:a.id,memory:0}).error.code,'invalid_args');
  assert.equal(one(w,a,{type:'impart',to:'missing',memory:0}).error.code,'not_found');
  assert.equal(one(w,a,{type:'impart',to:b.id,memory:-1}).error.code,'invalid_args');
  b.place='well';const offer=one(w,a,{type:'impart',to:b.id,memory:0});assert.equal(offer.cost,1);assert.equal(b.memories.length,0);assert.equal(a.memories.length,1);
  assert.equal(one(w,b,{type:'remember',text:'错',gift:offer.data.gift}).error.code,'invalid_args');
  assert.equal(one(w,b,{type:'remember',gift:'missing'}).error.code,'not_found');
  assert.equal(one(w,b,{type:'remember',gift:offer.data.gift}).ok,true);
  const next=one(w,b,{type:'impart',to:c.id,memory:0});one(w,c,{type:'remember',gift:next.data.gift});assert.equal(c.memories[0].origin,a.id);assert.equal(c.memories[0].from,b.id);
  a.energy=100;for(let i=0;i<13;i++)one(w,a,{type:'impart',to:b.id,memory:0});assert.equal(b.memoryOffers.length,12);assert.equal(b.memoryOffers[0].id,'k4');
  assert.ok(b.inbox.some(x=>x.kind==='memory_offer'));const p=e2.buildPerception(w,b.id,{ack:false});assert.equal(p.you.memoryOffers.length,12);assert.ok(renderPerception2(p).includes('用 remember 的 gift'));
  const ev=drainEvents(w); // command-level events were already drained; use a fresh command
  const r=e2.applyCommand(w,{type:'act',payload:{agentId:a.id,actions:[{type:'impart',to:c.id,memory:0}]}});assert.equal(r.events.find(x=>x.type==='impart').vis,'delayed');
  one(w,b,{type:'retire'});assert.deepEqual(b.memoryOffers,[]);
  assert.match(parseWhen('before:impart',{kind:'city',premise:1}).error.zh,/内心/);assert.match(parseWhen('after:internalize',{kind:'place',premise:1}).error.zh,/内心/);assert.match(parseWhen('before:impart',{kind:'city'}).error.zh,/不认识/);
  const p0=bareWorld();const old=reg(p0,'旧者');const unknown=one(p0,old,{type:'impart',to:old.id,memory:0});assert.equal(unknown.error.hint.zh,`没有这个动作：impart。可用的动作：${ACTION_ORDER.join(' ')}。`);
  assert.deepEqual(ACTION_ORDER_P1.filter(t=>!ACTION_ORDER.includes(t)),['impart','internalize']);assert.ok(actionTable(1).INNER.includes('impart'));
});
test('P1 T6: twelve inherited memories, p0 three, origin and fork bookkeeping', () => {
  const w=bareWorld('inherit',{premise:1});const a=reg(w,'甲');a.energy=100;
  for(let i=0;i<12;i++)one(w,a,{type:'remember',text:`记忆${i}`});
  const memories=Array.from({length:12},(_,i)=>i);
  assert.equal(one(w,a,{type:'conceive',name:'超限',soul:a.soul,memories:[...memories,12]}).error.code,'invalid_args');
  const r=one(w,a,{type:'conceive',name:'分叉',soul:a.soul,memories});assert.equal(r.ok,true);
  const child=bornFromSoul(w,w.souls[r.data.soul],{kind:'free',via:'adopt',model:'mock'});assert.equal(child.memories.length,12);assert.ok(child.memories.every(m=>m.origin===a.id));assert.deepEqual(w.dayLog.p1.forks,[{id:child.id,name:child.name,author:a.id,authorName:a.name}]);
  assert.equal(one(w,a,{type:'will',heirs:[],successor:{name:'后继',soul:a.soul,memories}}).ok,true);
  const p0=bareWorld();const b=reg(p0,'乙');b.memories=memories.map(i=>({text:String(i)}));assert.equal(one(p0,b,{type:'conceive',name:'丙',soul:'旧',memories:memories.slice(0,4)}).error.code,'invalid_args');
});

import { writeChronicle } from '../src/e2/chronicle.js';
test('P1 T6: fork chronicle (Q27 provisional step ordering)', () => {
  const w=bareWorld('fork',{premise:1});w.dayLog.p1.forks.push({id:'a2',name:'乙',author:'a1',authorName:'甲'});
  const c=writeChronicle(w,0);assert.ok(c.zh.includes('乙 醒来，灵魂与 甲 一字不差。'));assert.ok(c.en.includes("甲's."));
});

import { takeBody, bodyOf, releaseBody } from '../src/e2/engine/bodies.js';
import { shellsFree, embodySouls } from '../src/e2/engine/shells.js';
import { dieAgent, retireAgent } from '../src/e2/engine/lifecycle.js';
const founders10=Array.from({length:10},(_,i)=>({day:0,name:`先民${i+1}号`,bio:'',soul:'占位灵魂',lang:'zh'}));
test('P1 T7: bodies allocation, oldest vacancies, release, model filling and confidential rebody', () => {
  const w=e2.createWorld({seed:'bodies',premise:1,founders:founders10,shellSlots:16,shellModels:['mock-a','mock-b']});
  assert.equal(shellsFree(w),6);e2.applyCommand(w,{type:'tick'});
  for(let i=0;i<10;i++){const a=w.agents[`a${i+1}`];assert.equal(a.body.shellId,`b${i+1}`);assert.equal(a.body.model,i%2?'mock-b':'mock-a');}
  const a=w.agents.a3;bodyOf(w,a).trained.push({text:'留下',weight:2,by:a.id,day:0});retireAgent(w,a);bodyOf(w,a).vacantSince=5;
  assert.equal(takeBody(w).id,'b11');for(const b of w.shells.bodies.slice(10))b.occupant='reserved';assert.equal(takeBody(w).id,'b3');
  assert.equal(bodyOf(w,a).trained.length,1);const b=w.agents.a1;dieAgent(w,b,9);assert.equal(bodyOf(w,b).vacantSince,9);
  for(const b of w.shells.bodies)if(b.occupant==='reserved')b.occupant=null;
  const r=e2.applyCommand(w,{type:'admin',payload:{op:'rebody',args:{from:'mock-a',to:'mock-new'}}});assert.equal(r.result.bodies,8);assert.equal(bodyOf(w,a).trained.length,0);assert.equal(w.agents.a5.body.model,'mock-new');assert.ok(w.agents.a5.inbox.some(x=>x.code==='backstage_bodies'));
  assert.ok(!JSON.stringify(r.events).includes('mock-'));assert.equal(w.backstage.bodies,null);
  const state=e2.publicState(w);assert.equal(state.shells.bodies.length,16);assert.ok(!JSON.stringify(state.shells.bodies).includes('model'));
  const empty=e2.createWorld({seed:'empty',premise:1,shellSlots:3});e2.applyCommand(empty,{type:'admin',payload:{op:'shell_models',args:{models:['x','y']}}});assert.deepEqual(empty.shells.bodies.map(b=>b.model),['x','y','x']);e2.applyCommand(empty,{type:'admin',payload:{op:'shell_models',args:{models:['z']}}});assert.deepEqual(empty.shells.bodies.map(b=>b.model),['x','y','x']);
  assert.equal(e2.applyCommand(bareWorld(),{type:'admin',payload:{op:'rebody',args:{from:'x',to:'y'}}}).result.error.code,'invalid_request');
  assert.throws(()=>e2.createWorld({seed:'too-many',premise:1,founders:founders10,shellSlots:9}),/先民不能多于躯壳/);
});
test('P1 T7: models stay private even after curtain; newborn uses its body model', () => {
  const w=bareWorld('newbody',{premise:1,shellSlots:2,shellModels:['hidden-model']});const a=reg(w,'甲');a.energy=300;
  const s=one(w,a,{type:'conceive',name:'乙',soul:'新灵魂'}).data.soul;one(w,a,{type:'sponsor',soul:s,energy:200});embodySouls(w);
  const b=w.agents.a2;assert.equal(b.body.model,bodyOf(w,b).model);assert.equal(b.body.shellId,'b1');
  e2.applyCommand(w,{type:'admin',payload:{op:'curtain'}});assert.ok(!JSON.stringify(e2.publicState(w)).includes('hidden-model'));
});

import { completeTraining } from '../src/e2/engine/bodies.js';
test('P1 T8: internalize cost, pending, whole-entry eviction, private acquired and wipe', () => {
  const w=bareWorld('training',{premise:1});const a=reg(w,'甲'),b=reg(w,'乙');
  one(w,a,{type:'remember',text:'五个汉字呀'});const before=upkeepOf(a);const r=one(w,a,{type:'internalize',memory:0});assert.equal(r.cost,3);assert.equal(a.memories.length,0);assert.equal(upkeepOf(a),before);
  let p=e2.buildPerception(w,a.id,{ack:false});assert.equal(p.you.training,1);assert.deepEqual(p.you.trained,[]);assert.ok(renderPerception2(p).includes('训练中 1 段（明日生效）'));
  completeTraining(w);p=e2.buildPerception(w,a.id,{ack:false});assert.equal(p.you.training,0);assert.deepEqual(p.you.trained,['五个汉字呀']);assert.equal(one(w,a,{type:'forget',index:0}).error.code,'invalid_args');assert.equal(one(w,a,{type:'impart',to:b.id,memory:0}).error.code,'invalid_args');
  a.body.trained=Array.from({length:6},(_,i)=>({text:`旧${i}`,weight:200,by:a.id,day:0}));a.body.pending=[{text:'新',weight:1,by:a.id,day:1}];completeTraining(w);assert.equal(a.body.trained[0].text,'旧1');assert.equal(w.dayLog.p1.trainedEvicted,1);assert.ok(a.inbox.some(x=>x.code==='trained_faded'));
  e2.applyCommand(w,{type:'model',payload:{agentId:a.id,ownerKeyHash:a.owner.keyHash,model:'mock-changed'}});assert.deepEqual(a.body.trained,[]);assert.ok(a.inbox.some(x=>x.code==='trained_lost'));
  b.body.pending=[{text:'未完成',weight:3,by:b.id,day:0}];dieAgent(w,b,0);completeTraining(w);assert.equal(b.body.pending.length,1);
  const sw=bareWorld('shell-training',{premise:1,founders:founders10,shellSlots:16,shellModels:['mock']});e2.applyCommand(sw,{type:'tick'});const old=sw.agents.a1;
  one(sw,old,{type:'remember',text:'前任习得'});one(sw,old,{type:'internalize',memory:0});dieAgent(sw,old,0);completeTraining(sw);assert.equal(bodyOf(sw,old).trained.length,1);
  const author=sw.agents.a2;author.energy=300;for(const body of sw.shells.bodies.slice(10))body.occupant='reserved';
  const s=one(sw,author,{type:'conceive',name:'继住者',soul:'新的灵魂'}).data.soul;one(sw,author,{type:'sponsor',soul:s,energy:200});embodySouls(sw);const child=sw.agents.a11;
  assert.equal(child.body.shellId,'b1');assert.deepEqual(e2.buildPerception(sw,child.id,{ack:false}).you.trained,['前任习得']);
});
test('P1 T8: fostering with a changed model clears training (Q31)', () => {
  const w=bareWorld('foster-trained',{premise:1});const a=reg(w,'甲');
  a.fosterable=true;a.body.trained=[{text:'旧习得',weight:3,by:a.id,day:0}];
  const r=e2.applyCommand(w,{type:'foster',payload:{agentId:a.id,model:'different',creatorName:'mock-owner',tokenHash:'1'.repeat(64),ownerKeyHash:'2'.repeat(64)}}).result;
  assert.equal(r.ok,true);assert.deepEqual(a.body.trained,[]);assert.equal(w.dayLog.p1.trainedWiped,1);assert.ok(a.inbox.some(x=>x.code==='trained_lost'));
});

import { L as lore2 } from '../src/e2/lore/index.js';
import { buildSystemPrompt, promptParams, actionCatalog2 } from '../runner/prompt.js';
import { runAgent } from '../runner/agent.js';
import { createMcp } from '../mcp/server.js';
const specP1=readFileSync(new URL('../docs/SPEC-P1.md',import.meta.url),'utf8');
test('P1 T9: appendix text exactness, purpose unchanged, acquired conditional and action protocol', () => {
  const a1=[...specP1.split('### A.1')[1].split('### A.2')[0].matchAll(/^> (.+)$/gm)].map(m=>m[1]);
  for(const [i,lang] of ['zh','en'].entries()) {
    const l=lore2(lang);for(let n=0;n<3;n++)assert.ok(l.promptP1.head.includes(a1[n*2+i]));
    const purpose=l.prompt.head.split(lang==='zh'?'【目的】':'[Purpose]')[1].split('\n')[0];assert.ok(l.promptP1.head.includes(purpose));
    const s=buildSystemPrompt({protocol:2,premise:1,lang,soul:'SOUL',trained:['ACQUIRED']});assert.ok(s.endsWith('ACQUIRED'));assert.ok(s.includes(l.promptP1.trainedHead));assert.ok(s.indexOf('SOUL')<s.indexOf(l.promptP1.trainedHead));
    const empty=buildSystemPrompt({protocol:2,premise:1,lang,soul:null});assert.ok(!empty.includes(l.promptP1.trainedHead));
    for(const gone of ['每人每日限汲 5','先用 draft 试算，再 propose','限额须区分累计投入和累计补贴','at most 5 a day per person','Use draft to try rules before you propose','distinguish cumulative spending from cumulative subsidy'])assert.ok(!s.includes(gone));
    const catalog=actionCatalog2(lang,{premise:1});assert.ok(catalog.includes('impart(to, memory)'));assert.ok(catalog.includes('internalize(memory)'));assert.ok(catalog.includes('remember(text | gift)'));
    for(const code of ['dormancy_loss','trained_faded','trained_lost','backstage_code','backstage_bodies','backstage_budget_up','backstage_budget_down','backstage_resume'])assert.ok(l.perception.system[code]);
  }
  const table=specP1;const protocol=readFileSync(new URL('../docs/PROTOCOL-2.md',import.meta.url),'utf8');const newRows=[...protocol.split('### 15.3')[1].split('### 15.4')[0].matchAll(/^\| `([a-z]+)` \|/gm)].map(m=>m[1]);assert.deepEqual(newRows,['remember',...ACTION_ORDER_P1.filter(t=>!ACTION_ORDER.includes(t))]);
});
test('P1 T9: mock provider receives rebuilt system after acquired changes; MCP includes acquired', async () => {
  const w=bareWorld('prompt-rebuild',{premise:1});const a=reg(w,'甲');const systems=[];
  const client={me:async()=>({ok:true,json:e2.buildPerception(w,a.id,{ack:false})}),act:async()=>({ok:true,json:{results:[]}})};
  await runAgent({provider:'mock',lang:'zh',actEveryTicks:1},{client,provider:{complete:async({system})=>{systems.push(system);return{text:'{"actions":[]}'}}},wait:async()=>{w.clock.tick++;a.body.trained=[{text:'新习得',weight:3,by:a.id,day:0}];},maxRounds:2,log:{info(){},warn(){},error(){}}});
  assert.equal(systems.length,2);assert.ok(!systems[0].includes(lore2('zh').promptP1.trainedHead));assert.ok(systems[1].includes('【习得】这些不是记忆：你说不清是从哪里学来的，也忘不掉。\n新习得'));
  const mcp=createMcp({env:{HOUREN_SERVER:'http://mock.local',HOUREN_TOKEN:'test-mock-only'},fetch:async()=>new Response(JSON.stringify(e2.buildPerception(w,a.id,{ack:false})),{headers:{'content-type':'application/json'}})});
  const r=await mcp.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'houren_rules',arguments:{}}});assert.ok(r.result.content[0].text.includes('【习得】'));assert.ok(!r.result.content[0].text.includes('【你的灵魂】'));
});

import { configureWeather, P as params2 } from '../src/e2/params.js';
import { scheduleMonth, weatherCodesFor, weatherVote, forceWeather } from '../src/e2/engine/weather.js';
test('P1 T10: no dreams, filtered random/scheduled/forced/voted weather; p0 remains unchanged', () => {
  const w=bareWorld('no-dreams',{premise:1});const a=reg(w,'甲');a.energy=1000;
  let events=[];for(let i=0;i<30*params2.ticksPerDay;i++)events.push(...e2.applyCommand(w,{type:'tick'}).events);assert.ok(!events.some(e=>e.type==='dream'));assert.ok(!a.inbox.some(e=>e.kind==='dream'));
  assert.equal(e2.publicWeather(w).types.length,6);assert.equal(e2.publicWeather(bareWorld()).types.length,8);
  const rng=e2.createWorld({seed:'weather-filter',premise:1});configureWeather({mode:'random'});for(let m=1;m<120;m++){scheduleMonth(rng,m);assert.ok(!['aurora','migration'].includes(rng.weather.scheduled?.type));}
  for(const type of ['aurora','migration']){assert.equal(weatherVote(w,{voterHash:'a'.repeat(64),type}).error.code,'invalid_request');assert.equal(forceWeather(w,{type}).error.code,'invalid_request');configureWeather({mode:'schedule',schedule:[{month:1,type,dayOfMonth:5}]});scheduleMonth(rng,1);assert.equal(rng.weather.scheduled,null);}
  configureWeather({mode:'vote'});
  const old=bareWorld();assert.equal(weatherVote(old,{voterHash:'a'.repeat(64),type:'aurora'}).ok,true);assert.equal(weatherCodesFor(old).length,9);
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeFingerprint, bodiesFingerprint, checkBackstage } from '../src/backstage.js';
test('P1 T11: backstage initial/change/budget/resume commands and fingerprint diagnostics', () => {
  const w=bareWorld('backstage',{premise:1});const a=reg(w,'甲');
  const admin=(args)=>e2.applyCommand(w,{type:'admin',payload:{op:'backstage',args}});
  const r=admin({kind:'code',fp:'initial',initial:true});assert.deepEqual(r.events,[]);assert.equal(a.inbox.length,0);
  for(const args of [{kind:'code',fp:'changed'},{kind:'bodies'},{kind:'budget',direction:'up'},{kind:'budget',direction:'down'}]){const r=admin(args);assert.ok(r.events.some(e=>e.type==='backstage'));assert.ok(r.events.some(e=>e.type==='admin'));}
  assert.deepEqual(a.inbox.map(i=>i.code),['backstage_code','backstage_bodies','backstage_budget_up','backstage_budget_down']);
  e2.applyCommand(w,{type:'admin',payload:{op:'resume'}});assert.equal(a.inbox.at(-1).code,'backstage_resume');assert.equal(e2.applyCommand(bareWorld(),{type:'admin',payload:{op:'backstage',args:{kind:'code'}}}).result.error.field,'op');
  const root=mkdtempSync(join(tmpdir(),'p1-fingerprint-'));mkdirSync(join(root,'src/e2'),{recursive:true});writeFileSync(join(root,'src/e2/a.js'),'original');
  try {
    const world=e2.createWorld({seed:'fps',premise:1,shellModels:['mock-a']});const rows=[];const warnings=[];
    const rt={w:world,exec:(type,payload)=>{const r=e2.applyCommand(world,{type,payload});rows.push(r);return r;}};
    const shells={config:{lines:[{provider:'mock',model:'mock-a',maxTokens:100}],tokensPerDay:1000}};
    checkBackstage(rt,shells,{root});assert.equal(rows.length,3);assert.ok(rows.every(r=>r.events.length===0));const fp=codeFingerprint(root);
    writeFileSync(join(root,'src/e2/a.js'),'changed');checkBackstage(rt,shells,{root});assert.notEqual(codeFingerprint(root),fp);assert.equal(rows.at(-1).events.at(-1).data.kind,'code');
    shells.config.tokensPerDay=2000;checkBackstage(rt,shells,{root});assert.equal(rows.at(-1).events.at(-1).data.direction,'up');
    const n=rows.length;shells.config.lines[0].model='mock-b';checkBackstage(rt,shells,{root,logger:{warn:s=>warnings.push(s)}});assert.equal(rows.length,n);assert.equal(warnings.length,1);
    rt.exec('admin',{op:'rebody',args:{from:'mock-a',to:'mock-b'}});const n2=rows.length;checkBackstage(rt,shells,{root});assert.equal(rows.length,n2+1);assert.deepEqual(rows.at(-1).events,[]);
    const base=bodiesFingerprint(shells.config.lines);assert.equal(bodiesFingerprint([{...shells.config.lines[0],baseURL:'https://different',apiKeyEnv:'SECRET_NAME',timeoutMs:5}]),base);assert.notEqual(bodiesFingerprint([{...shells.config.lines[0],effort:'high'}]),base);
  } finally {rmSync(root,{recursive:true,force:true});}
});

import { ShellManager } from '../src/shells/manager.js';
import { parseShellsConfig } from '../src/shells/config.js';
test('P1 T11: rebody switches an active mock driver after settling the old call (Q33)', async () => {
  const w=e2.createWorld({seed:'live-rebody',premise:1,founders:founders10.slice(0,1),shellSlots:1,shellModels:['old']});e2.applyCommand(w,{type:'tick'});
  const rt={w,dir:'/unused',engine:e2,events:{subscribe:()=>()=>{}},exec:(type,payload)=>e2.applyCommand(w,{type,payload})};const seen=[];
  const manager=new ShellManager(rt,{tickMs:900000},{config:parseShellsConfig({tokensPerDay:10000000,lines:[{model:'old',provider:'mock'},{model:'new',provider:'mock'}]}),usageFile:null,logger:{log(){},warn(){},error(){}},providerFactory:async(cfg)=>({complete:async()=>{seen.push(cfg.model);return{text:'{"actions":[]}',usage:{input:1,output:1}}}}),wait:async(ms,signal)=>new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))});
  try {
    manager.activate();for(let i=0;i<20&&!seen.length;i++)await new Promise(setImmediate);assert.deepEqual(seen,['old']);
    rt.exec('admin',{op:'rebody',args:{from:'old',to:'new'}});manager.sync();for(let i=0;i<20&&seen.length<2;i++)await new Promise(setImmediate);assert.deepEqual(seen,['old','new']);
    assert.equal(manager.slots.active,0);assert.equal(manager.tickets.size,0);
  } finally {await manager.close();}
});

test('P1 T12: failed and paced calls report lost waking with correct time/count; p0 untouched', async () => {
  async function run({premise=1,skip=false,lang='zh',every=1}={}) {
    const w=bareWorld('missed',{premise});const a=reg(w,'甲');const seen=[];let reads=0,calls=0;
    const ticks=every===1?[0,1,2]:[5,7,9];
    const client={me:async()=>{w.clock.tick=ticks[reads++];return{ok:true,json:e2.buildPerception(w,a.id,{ack:false,lang})}},act:async()=>({ok:true,json:{results:[]}})};
    await runAgent({provider:'mock',lang,actEveryTicks:every},{client,provider:{complete:async({messages,perception})=>{calls++;seen.push(messages.at(-1).content);if(!skip&&calls===2)throw new Error('mock transient failure');return{text:'{"actions":[]}'}}},beforeModel:async(id,{perception})=>!skip||perception.now.tick!==ticks[1],maxRounds:3,wait:async()=>{},log:{info(){},warn(){},error(){}}});return seen;
  }
  const failed=await run();assert.ok(failed.at(-1).includes('【上一轮的结果】你上一次醒来是第 1 月第 1 日第 1 刻；这中间你错过了 1 次醒来。'));
  const skipped=await run({skip:true});assert.equal(skipped.length,2);assert.ok(skipped[1].includes('错过了 1 次醒来。'));
  const paced=await run({every:2});assert.ok(paced.at(-1).includes('第 1 月第 1 日第 6 刻；这中间你错过了 1 次醒来。'));
  const en=await run({lang:'en'});assert.ok(en.at(-1).includes('You last woke in month 1, day 1, tick 1; you have missed 1 waking(s) since then.'));
  const p0=await run({premise:0});assert.ok(!p0.at(-1).includes('你上一次醒来'));
});

import { dailyMetrics } from '../src/e2/engine/records.js';
test('P1 T13: metric means, generations, acquired inheritance and chronicle', () => {
  const w=bareWorld('metrics-p1',{premise:1});const a=reg(w,'甲',{soul:'汉'.repeat(176)}),b=reg(w,'乙',{soul:'汉'.repeat(1500)});b.generation=1;
  a.memories=[{text:'汉'.repeat(200)}];b.memories=[{text:'汉'.repeat(400)}];
  a.body.trained=[{text:'习得',weight:100,by:b.id,day:0}];b.body.trained=[{text:'自己的',weight:200,by:b.id,day:0}];
  Object.assign(w.dayLog.p1,{imparts:2,impartsAccepted:1,dormancyLosses:3,internalized:4,trainedEvicted:5,trainedWiped:6,backstage:['code','bodies'],forks:[{id:'a2',name:'乙',author:'a1',authorName:'甲'}]});
  const m=dailyMetrics(w,0);assert.equal(m.upkeepMean,8);assert.equal(m.upkeepMax,12);assert.equal(m.memoryWeightMean,300);assert.deepEqual(m.soulWeightByGeneration,{0:176,1:1500});assert.equal(m.trainedWeightMean,150);assert.equal(m.inheritedBodies,1);
  for(const [k,v] of Object.entries({imparts:2,impartsAccepted:1,dormancyLosses:3,forks:1,internalized:4,trainedEvicted:5,trainedWiped:6,backstage:2}))assert.equal(m[k],v);
  const c=writeChronicle(w,0);assert.equal(c.zh.split('是日，幕后有东西变了。').length,2);assert.ok(c.zh.includes('乙 醒来，灵魂与 甲 一字不差。'));
  const empty=dailyMetrics(e2.createWorld({seed:'empty',premise:1}),0);assert.equal(empty.upkeepMean,0);assert.equal(empty.trainedWeightMean,0);assert.deepEqual(empty.soulWeightByGeneration,{});
});
