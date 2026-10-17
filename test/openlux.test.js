import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODEL_IDS, selectCatalog, priceModel, product, applicablePrices, reservePrices } from '../src/hosted/catalog.js';
import { HostedService } from '../src/hosted/service.js';
import { BillingStore, costMicro } from '../src/hosted/billing.js';
import { estimateHosted } from '../public/hosted-estimate.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/openlux-pricing-2026-10-17.json', import.meta.url)));
const catalog = selectCatalog(fixture);
const priced = (id = 'deepseek-v4.1-flash', group = 'Self-Deployed-2', multiplier = '1.2') => priceModel(catalog.find(m => m.id === id), group, multiplier);

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'openlux-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ctx = { cfg: { dataDir: dir, shellTz: 'Asia/Shanghai' }, runners: { refreshHosted: async () => {} } };
  const service = new HostedService(ctx, { pricingFetch: async () => Response.json(fixture), provider: () => ({ step: async () => ({ calls: [{name:'done'}], usage: {input:100,output:5} }) }) });
  return { service, ctx, dir };
}
async function prepare(s, models = [['deepseek-v4.1-flash','Self-Deployed-2']]) {
  await s.save({ version:2, enabled:true, baseURL:'https://models.example.invalid/v1', apiKey:'test-only-secret', multiplier:'1.2', maxOutputTokens:256 });
  await s.syncCatalog();
  for (const [model,group] of models) await s.testCatalog({ draftId:s.config.draft.id,model,group,groupConfirmed:true });
  return s.config.draft.id;
}

test('official catalog: exact nine IDs, no fuzzy substitutions, all selected models parse', () => {
  assert.deepEqual(catalog.map(m=>m.id),MODEL_IDS);
  for (const m of catalog) { assert.ok(m.groups.length); assert.equal(priceModel(m,m.groups[0].group,'1.2').id,m.id); }
  const copy=structuredClone(fixture);copy.data=copy.data.filter(m=>m.model_name!=='gpt-6-luna');
  assert.match(selectCatalog(copy)[0].error,/没有唯一/);
  assert.throws(()=>priced(undefined,'default'),/分组/);
});
test('USD times 7 times 1.2 uses exact decimal products and rounds only final CNY micro price', () => {
  assert.equal(product(['0.1','0.2',7,'1.2'],true),168000);
  const m=priced();
  assert.equal(m.usd.miss,'0.150000000000');
  assert.equal(m.pricesMicro.miss,1260000);
  assert.equal(m.pricesMicro.hit,25200);
  assert.equal(m.pricesMicro.output,5040000);
  assert.equal(product(['0.000000000001',7,'1.2'],true),1);
  for (const value of [-1,NaN,Infinity,'1e3','']) assert.throws(()=>product([value],true));
  assert.throws(()=>priced(undefined,undefined,0));
});
test('whole-request input-tier boundaries and conservative reservation rates', () => {
  const m=priced('gpt-6-luna','Azure-Gpt-3');
  assert.equal(applicablePrices(m,272000).miss,184800);
  assert.equal(applicablePrices(m,272001).miss,369600);
  assert.equal(applicablePrices(m,272001).output,1386000);
  assert.throws(()=>applicablePrices(m,1000001));
  assert.equal(reservePrices(m).output,1386000);
  const entry=structuredClone(catalog[0]);entry.source.step_ratios[0].completion_step_size=1;
  assert.throws(()=>priceModel(entry,entry.groups[0].group,'1.2'),/暂不支持/);
  entry.source.quota_type=1;assert.throws(()=>priceModel(entry,entry.groups[0].group,'1.2'),/仅支持/);
});
test('cache reads, 5m and 1h writes are exclusive input categories; unknown price not free', () => {
  const prices={miss:1000000,hit:100000,output:5000000,write:1250000,writeHour:2000000};
  assert.equal(costMicro({input:1000,cacheRead:200,cacheWrite:300,cacheWriteHour:100,output:100},prices),1470);
  assert.equal(costMicro({input:100,cacheWrite:50,cacheWriteHour:51,output:0},prices),null);
  assert.equal(costMicro({input:100,cacheRead:80,cacheWrite:21,output:0},prices),null);
  assert.equal(costMicro({input:100,cacheWrite:10,output:0},{...prices,write:null}),null);
});
test('catalog stays unpublished until tested + explicit publication; no secrets or groups in public view', async t => {
  const {service:s,ctx}=setup(t),draftId=await prepare(s);
  assert.equal(s.available(),false);
  await assert.rejects(s.publishCatalog({draftId,models:['gpt-6-astra']}),/已经测试/);
  await assert.rejects(s.publishCatalog({draftId:'stale',models:['deepseek-v4.1-flash']}),/草稿/);
  await s.publishCatalog({draftId,models:['deepseek-v4.1-flash']});
  assert.ok(s.available('deepseek-v4.1-flash'));
  assert.equal(s.available('gpt-6-astra'),false);
  assert.throws(()=>s.runnerChoice({hosted:true,model:'deepseek-chat'}));
  assert.equal(s.runnerChoice({hosted:true,model:'deepseek-v4.1-flash',apiKey:'ignored'}).model,'deepseek-v4.1-flash');
  const view=JSON.stringify(s.publicConfig());assert.ok(!view.includes('test-only-secret'));assert.ok(!view.includes('Self-Deployed'));
  const oldPrice=s.snapshot('deepseek-v4.1-flash').pricesMicro.output,version=s.config.priceVersion;
  await s.save({multiplier:'2'});
  assert.equal(s.snapshot('deepseek-v4.1-flash').pricesMicro.output,oldPrice);
  assert.equal(s.config.priceVersion,version);
  const reload=new HostedService(ctx);assert.equal(reload.config.priceVersion,version);assert.equal(reload.config.apiKey,'test-only-secret');
  await s.save({apiKey:'changed-key'});assert.equal(s.available(),false);assert.equal(s.config.draft,null);
});
test('catalog validation blocks stale drafts, unsupported groups and missing usage/tools', async t => {
  const {service:s}=setup(t);await prepare(s);const draftId=s.config.draft.id;
  await assert.rejects(s.testCatalog({draftId,model:'deepseek-v4.1-flash',group:'Self-Deployed-2',groupConfirmed:false}),/核对/);
  s.providerOverride=()=>({step:async()=>({calls:[{name:'done'}]})});
  await assert.rejects(s.testCatalog({draftId,model:'deepseek-v4.1-flash',group:'Self-Deployed-2',groupConfirmed:true}),/测试失败/);
  await s.save({multiplier:'1.3'});assert.equal(s.config.draft,null);
  await assert.rejects(s.publishCatalog({draftId,models:['deepseek-v4.1-flash']}),/草稿/);
});
test('in-flight charges retain model + published version, reload and merge preserve audit basis', async t => {
  const {service:s,ctx}=setup(t);const draftId=await prepare(s);await s.publishCatalog({draftId,models:['deepseek-v4.1-flash']});
  const b=s.billing;b.adjust('user',100000000,'admin','test');
  const snapshot=s.snapshot('deepseek-v4.1-flash'),reservation=b.reserve('user','resident',1000,snapshot);
  snapshot.pricesMicro.miss=999999999; // reserve owns immutable copy
  await s.save({multiplier:'2'});await s.syncCatalog();await s.testCatalog({draftId:s.config.draft.id,model:'deepseek-v4.1-flash',group:'Self-Deployed-2',groupConfirmed:true});await s.publishCatalog({draftId:s.config.draft.id,models:['deepseek-v4.1-flash']});
  assert.equal(b.settle(reservation,{input:1000,output:100},{ok:true}),1764);
  const current=s.snapshot('deepseek-v4.1-flash'),r=b.reserve('user','resident',1000,current),reserved=b.reservations.get(r).amountMicro;
  assert.equal(b.settle(r,null,{ok:true}),reserved);
  assert.equal(b.data.daily.length,2);assert.equal(b.data.daily[1].estimatedCalls,1);assert.equal(b.data.daily[0].basis.pricesMicro.miss,1260000);
  const reload=new HostedService(ctx);assert.deepEqual(reload.billing.data.daily,b.data.daily);
  b.mergeAccounts('merge','user','other');assert.equal(b.accountView('other').usage.details.length,2);
});
test('daily/monthly estimates respond to cap and model; empirical samples take precedence', () => {
  const m={...priced(),available:true};
  const e=estimateHosted(m,880000),twice=estimateHosted(m,1760000);
  assert.equal(e.basis,'粗略估算');assert.equal(e.monthly[1],e.daily[1]*30);assert.equal(twice.daily[1],e.daily[1]*2);
  assert.deepEqual(estimateHosted(m,0).daily,[0,0]);assert.equal(estimateHosted(m,-1),null);assert.equal(estimateHosted(m,NaN),null);
  const samples=Array.from({length:10},()=>({input:100,output:10,cacheRead:20,cacheWrite:0,cacheWriteHour:0,gameTokens:50}));
  const measured=estimateHosted({...m,samples},1000);assert.equal(measured.basis,'运行样本估算');assert.ok(measured.daily[0]<=measured.daily[1]);
  assert.notEqual(estimateHosted({...m,pricesMicro:{...m.pricesMicro,output:99999999},tiers:null},880000).daily[1],e.daily[1]);
});

test('calibration accepts all exact model IDs including dots and survives restart', t => {
  const {service:s,ctx}=setup(t);
  for(const model of MODEL_IDS)s.billing.recordSample(model,{input:100,output:10,cacheRead:0,cacheWrite:0,cacheWriteHour:0},50);
  const reload=new HostedService(ctx);
  for(const model of MODEL_IDS)assert.equal(reload.billing.modelSamples(model).length,1,model);
});

test('retesting a draft changes its revision so another admin cannot publish unseen group prices',async t=>{
  const {service:s}=setup(t);const old=await prepare(s);
  const tested=await s.testCatalog({draftId:old,model:'deepseek-v4.1-flash',group:'Self-Deployed-3',groupConfirmed:true});
  assert.notEqual(tested.draftId,old);
  await assert.rejects(s.publishCatalog({draftId:old,models:['deepseek-v4.1-flash']}),/草稿/);
  await s.publishCatalog({draftId:tested.draftId,models:['deepseek-v4.1-flash']});
  assert.equal(s.snapshot('deepseek-v4.1-flash').group,'Self-Deployed-3');
});

test('GPT models select Responses; automatic grouping prices the observed key route, never the guessed candidate',async t=>{
  assert.equal(priced('gpt-6-luna','Openai-Gpt-1').provider,'openai-responses');
  const {service:s}=setup(t);await prepare(s);
  s.providerOverride=config=>({step:async()=>{assert.equal(config.provider,'openai-responses');config.onResponse({routingGroup:'Openai-Gpt-1'});return {calls:[{name:'done'}],usage:{input:100,output:5}};}});
  await s.testCatalog({draftId:s.config.draft.id,model:'gpt-6-luna',autoGroup:true});
  assert.equal(s.config.draft.tested['gpt-6-luna'].group,'Openai-Gpt-1');
  await assert.rejects(s.testCatalog({draftId:s.config.draft.id,model:'gpt-6-luna',group:'Azure-Gpt-3',groupConfirmed:true}),/与所选分组不同/);
});
