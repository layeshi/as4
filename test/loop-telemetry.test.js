import test from 'node:test';
import assert from 'node:assert/strict';
import { openCity, drive } from './p2-loop-helpers.js';
import { cleanRecord } from '../src/runner/traces.js';
import { createProvider } from '../runner/providers.js';
import { makeLogger } from '../runner/agent.js';
import { classifyProviderError } from '../src/telemetry-safety.js';

test('native usage reports finish reason and raw tool count independently of action acceptance', async () => {
  const city = openCity(['one']);
  try {
    const inner = { step: async () => ({ stop: 'tool_calls', raw: {}, calls: [{ id: 'done', name: 'done', args: {} }], usage: { input: 5, output: 2 } }) };
    const out = await drive(city, city.ids[0], { inner, cfg: { toolMode: 'native', actionTools: 'typed' } });
    assert.equal(out.usage[0].finishReason, 'tool_calls');
    assert.equal(out.usage[0].toolCallCount, 1);
    assert.equal(out.wakings[0].rec.acts.length, 0);
  } finally { city.close(); }
});

test('unknown model action types and provider errors cannot leak private text to runtime logs', async () => {
  const city = openCity(['one']);
  const privateText = 'PRIVATE_AUDIT_SENTINEL';
  try {
    const out = await drive(city, city.ids[0], { script: [{ text: JSON.stringify({ act: { actions: [{ type: `diary ${privateText}` }], end: true } }) }] });
    assert.equal(out.logs.join('\n').includes(privateText), false);
    const fail = await drive(city, city.ids[0], { inner: { complete: async () => { throw new Error(privateText); } } });
    assert.equal(fail.logs.join('\n').includes(privateText), false);
  } finally { city.close(); }
});

test('alphabetic private text is not a valid trace error code', () => {
  const row = cleanRecord({ acts: [{ type: 'say', ok: false, error: 'private_diary_text' }] });
  assert.equal(row.acts[0].error, 'other');
});

test('real provider adapter keeps a safe network category without upstream message text', async () => {
  const provider = await createProvider({ provider: 'openai', model: 'm', baseURL: 'https://example.invalid/v1' }, { fetch: async () => { throw new Error('private-network-body'); } });
  await assert.rejects(provider.complete({ system: 's', messages: [] }), e => classifyProviderError(e).errorKind === 'network');
});

test('standalone logger receives no private thought text from P2 tool loop', async () => {
  const city = openCity(['one']), printed = [];
  try {
    await drive(city, city.ids[0], { cfg: { actionTools: 'typed' }, script: [{ text: JSON.stringify({ act: { actions: [], thought: 'PRIVATE_REVIEW_THOUGHT', end: true } }) }], deps: { log: makeLogger('one', { out: x => printed.push(x), err: x => printed.push(x) }) } });
    assert.equal(printed.join('\n').includes('PRIVATE_REVIEW_THOUGHT'), false);
  } finally { city.close(); }
});

test('default logger rejects arbitrary private client error text at its boundary', () => {
  const printed = [];
  const log = makeLogger('one', { out: x => printed.push(x), err: x => printed.push(x) });
  log.warn('行动失败：PRIVATE_CLIENT_REPLY');
  assert.equal(printed.join('\n').includes('PRIVATE_CLIENT_REPLY'), false);
});

test('Anthropic connection errors expose only the safe network category', async () => {
  class ConnectionFailure extends Error {}
  class SDK {
    static APIConnectionError = ConnectionFailure;
    constructor() { this.beta = { messages: { create: async () => { throw new ConnectionFailure('private'); } } }; }
  }
  const provider = await createProvider({ provider: 'anthropic', model: 'm' }, { loadAnthropic: async () => ({ default: SDK }) });
  await assert.rejects(provider.complete({ system: 's', messages: [] }), e => classifyProviderError(e).errorKind === 'network');
});


test('trace persistence recognizes entities and strictly cleans tool diagnostics', () => {
 const privateText='PRIVATE_TOOL_SENTINEL';
 const row=cleanRecord({looks:['entity_help','entity_definitions','entities:en1','entity_observations:en1'],acts:[{type:'entity',ok:true}],
  capabilities:{features:{entities:true,evil:privateText},toolCount:73,systemHash:'a'.repeat(64),toolsHash:privateText},
  toolAttempts:[{tool:'entity',turn:1,args:privateText},{tool:privateText,turn:2},null],
  toolRejections:[{tool:'entity',turn:1,stage:'local_validation',codes:['invalid_args',privateText],message:privateText},null],
  modelAttempts:[{turn:1,timeoutMs:120000,ms:120001,limitedBy:'configured',outcome:'failure',errorKind:'timeout',phase:'request',message:privateText},null]},7);
 assert.deepEqual(row.looks,['entity_help','entity_definitions','entities:en1','entity_observations:en1']);
 assert.equal(row.acts[0].type,'entity');assert.equal(row.capabilities.features.entities,true);
 assert.equal(row.toolRejections[0].stage,'local_validation');assert.deepEqual(row.toolRejections[0].codes,['invalid_args','other']);
 assert.equal(row.modelAttempts[0].errorKind,'timeout');assert.equal(JSON.stringify(row).includes(privateText),false);
 assert.deepEqual(cleanRecord(row,7),row);
});

test('native local rejection and unknown tools are captured without arguments', async () => {
 const city=openCity();let turn=0;
 try {
  const out=await drive(city,city.ids[0],{cfg:{toolMode:'native',actionTools:'typed'},inner:{step:async()=>({calls:++turn===1?
   [{id:'a',name:'say',args:{unexpected:'PRIVATE_VALIDATION'}},{id:'b',name:'PRIVATE_TOOL',args:{}}]:[{id:'c',name:'done',args:{}}]})}});
  const rec=cleanRecord(out.wakings[0].rec,2);
  assert.equal(rec.capabilities.toolCount,out.requests[0].tools.length);
  assert.match(rec.capabilities.systemHash,/^[a-f0-9]{64}$/);
  assert.deepEqual(rec.toolRejections.map(r=>r.stage),['local_validation','unknown_tool']);
  assert.deepEqual(rec.toolAttempts.map(r=>r.tool),['say','other','done']);
  assert.equal(rec.modelAttempts[0].outcome,'success');
  assert.equal(JSON.stringify(rec).includes('PRIVATE_'),false);
 } finally {city.close();}
});

test('provider timeout records configured versus tick-limited requests', async () => {
 const {ProviderError}=await import('../runner/providers.js');
 for(const [timeoutMs,limitedBy,ended] of [[10,'configured','error'],[120000,'tick','deadline']]) {
  const city=openCity();
  try {
   const out=await drive(city,city.ids[0],{cfg:{timeoutMs},inner:{complete:async()=>{throw new ProviderError('PRIVATE_TIMEOUT',{timeout:true,phase:'request'});}}});
   const rec=cleanRecord(out.wakings[0].rec,2);
   assert.equal(rec.ended,ended);assert.equal(rec.modelAttempts[0].limitedBy,limitedBy);
   assert.equal(rec.modelAttempts[0].errorKind,'timeout');assert.equal(rec.modelAttempts[0].phase,'request');
   assert.equal(JSON.stringify(rec).includes('PRIVATE_TIMEOUT'),false);
  } finally {city.close();}
 }
});


test('trace store persists capabilities and rejected entity calls without private text', async () => {
 const {TraceStore}=await import('../src/runner/traces.js');
 const {mkdtempSync,readFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'entity-trace-'));
 try {
  const file=join(dir,'agent-loops.jsonl'), store=new TraceStore({file,premise:7});
  store.append('a1',{kind:'main',mode:'native',looks:['entity_help'],acts:[{type:'entity',ok:true}],tokens:{in:1,out:1},
   capabilities:{features:{entities:true},toolCount:72,systemHash:'b'.repeat(64),toolsHash:'c'.repeat(64)},
   toolRejections:[{tool:'entity',turn:1,stage:'local_validation',codes:['invalid_args'],args:'PRIVATE_PERSIST'}]});
  const text=readFileSync(file,'utf8'), row=JSON.parse(text);
  assert.equal(text.includes('PRIVATE_PERSIST'),false);assert.equal(row.toolRejections[0].tool,'entity');
  assert.equal(row.capabilities.features.entities,true);
  const reloaded=new TraceStore({file,premise:7});
  assert.equal(reloaded.agentsDay(reloaded.today()).agents[0].looks.entity_help,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('configured runner guard is a timeout, not a world tick deadline', async () => {
 const city=openCity({tickMs:10000});
 try {
  const out=await drive(city,city.ids[0],{cfg:{timeoutMs:1000},inner:{complete:async()=>new Promise(()=>{})}});
  const rec=cleanRecord(out.wakings[0].rec,2);
  assert.equal(rec.ended,'error');assert.equal(rec.modelAttempts[0].limitedBy,'configured');
  assert.equal(rec.modelAttempts[0].errorKind,'timeout');
 }finally{city.close();}
});
