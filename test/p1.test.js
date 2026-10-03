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
