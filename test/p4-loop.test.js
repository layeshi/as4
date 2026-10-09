import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { createClient } from '../runner/client.js';
import { createProvider, ProviderError } from '../runner/providers.js';
import { runAgent } from '../runner/agent.js';
import { typedActionTools, validateAction, correctionExample } from '../runner/action-tools.js';
import { earthDay } from '../src/shells/budget.js';
const silent = { info() {}, warn() {}, error() {} };
async function setup(cap = 1000000) {
  const env = await boot({ physics: 2, premise: 4, tokenBasic: 500000, tickMs: 300000 });
  env.rt.agentLoop = { ...env.rt.agentLoop, marginSec: 0, debounceSec: 0 };
  const resident = await env.register('甲', { dailyCap: cap });
  const real = createClient({ server: env.base, token: resident.agentToken }), calls = [], responses = [];
  const client = { ...real };
  for (const key of ['me','wake','look','act','wait']) client[key] = async args => {
    calls.push({ method: key, args: structuredClone(args) });
    const r = await real[key](args); responses.push({ method: key, r: structuredClone(r) }); return r;
  };
  return { env, resident, client, calls, responses, a: env.rt.w.agents[resident.agentId] };
}
async function drive(s, { script, provider, cfg = {}, deps = {}, rounds = 1 } = {}) {
  const inner = provider || await createProvider({ provider: 'mock', script });
  const requests = [], traces = [], usage = [];
  const spy = { name: 'mock-spy', complete: async req => { requests.push({ system: req.system, messages: structuredClone(req.messages) }); return inner.complete(req); } };
  if (inner.step) spy.step = async req => { requests.push({ system: req.system, transcript: structuredClone(req.transcript), tools: req.tools }); return inner.step(req); };
  const result = await runAgent({ name: '甲', server: s.env.base, token: s.resident.agentToken, lang: 'zh', toolMode: 'native', ...cfg }, {
    client: s.client, provider: spy, log: silent, maxRounds: rounds, waitWake: false, wait: async () => {},
    onWaking: (id, rec) => traces.push(structuredClone(rec)), onUsage: (id, u, meta) => usage.push({ u, meta }), ...deps,
  });
  return { result, requests, traces, usage };
}
const call = (name, args) => ({ name, args });

test('P4 T19: native loop uses returned prompt and metered text; one server turn per model turn', async () => {
  const s = await setup();
  try {
    let before = 0;
    const out = await drive(s, { script: [
      { calls: [call('look', { what: 'laws' })] },
      { calls: [call('act', { actions: [{ type: 'say', text: '已经付过写出' }] })] },
      { calls: [call('act', { actions: [{ type: 'routine', brief: 'short' }], end: true })] },
    ], deps: { beforeModel: async () => { before++; return true; } } });
    assert.equal(before, 3);
    assert.equal(out.usage.length, 3);
    assert.deepEqual(s.calls.map(c => c.method), ['me','wake','look','act','act']);
    assert.deepEqual(s.calls.filter(c => ['look','act'].includes(c.method)).map(c => c.args.turn), [1,2,3]);
    const wake = s.responses.find(x => x.method === 'wake').r.json;
    assert.ok(out.requests.every(r => r.system === wake.system));
    assert.equal(out.requests[0].transcript[0].text, wake.text);
    assert.equal(s.a.routine.brief, 'short');
    assert.ok(out.traces[0].wakeId);
    assert.deepEqual(Object.keys(out.traces[0].bill), ['reread','read','write']);
    assert.ok(out.traces[0].bill.write > 0);
    assert.equal(out.traces[0].ended, 'end');
  } finally { await s.env.close(); }
});

test('P4 T19: wake 402 never calls provider; later success explains the missed tick', async () => {
  const s = await setup(1);
  try {
    const out = await drive(s, { rounds: 2, script: [{ calls: [call('done', {})] }], cfg: { actionTools: 'typed' }, deps: { wait: async () => {
      s.env.rt.exec('cap', { agentId: s.a.id, cap: 1000000 }); s.env.rt.tickNow();
    } } });
    assert.equal(out.requests.length, 1);
    assert.equal(out.traces[0].refused, 'cap_reached');
    assert.ok(out.requests[0].transcript[0].text.startsWith('有 1 刻你没能醒来：身体今天的额度用完了。'));
  } finally { await s.env.close(); }
});

test('P4 T19: mid-waking 402 ends without another model call', async () => {
  const s = await setup();
  try {
    const inner = { step: async () => {
      s.env.rt.exec('cap', { agentId: s.a.id, cap: s.a.tokens.used });
      return { text: '', raw: {}, calls: [call('look', { what: 'laws' }), call('act', { actions: [{ type: 'say', text: '不应提交' }] })] };
    } };
    const out = await drive(s, { provider: inner });
    assert.equal(out.requests.length, 1);
    assert.equal(out.traces[0].ended, 'tokens');
    assert.equal(s.calls.filter(c => c.method === 'act').length, 0);
  } finally { await s.env.close(); }
});

test('P4 T19: only hosted first provider failure refunds the waking', async () => {
  const s = await setup();
  try {
    const before = s.a.basic;
    let refunds = 0;
    const out = await drive(s, { script: [new ProviderError('mock failure', { retryable: true })], deps: { refundWake: async wakeId => {
      refunds++;
      return s.env.rt.exec('meter', { op: 'refund', agentId: s.a.id, wakeId, day: earthDay(Date.now(), 'Asia/Shanghai').key }).result;
    } } });
    assert.equal(refunds, 1);
    assert.equal(s.a.basic, before);
    assert.equal(s.a.tokens.used, 0);
    assert.deepEqual(out.traces[0].bill, { reread: 0, read: 0, write: 0 });
    const unpaid = await drive(s, { script: [new ProviderError('mock failure', { retryable: true })] });
    assert.equal(unpaid.requests.length, 1);
    assert.ok(s.a.basic < before);
  } finally { await s.env.close(); }
});

test('P4 T11: rhythm respects both every and owner actEveryTicks, and every=0/called=false sleeps', async () => {
  const s = await setup();
  try {
    s.a.routine.every = 2;
    s.a.routine.called = false;
    const out = await drive(s, { rounds: 9, cfg: { actEveryTicks: 4 }, script: Array.from({ length: 3 }, () => ({ text: '结束', calls: [] })), deps: { wait: async () => s.env.rt.tickNow() } });
    assert.deepEqual(out.traces.map(t => t.tick), [0,4,8]);
    s.a.routine.every = 0;
    let waited = 0;
    const off = await drive(s, { script: [], deps: { waitWake: async () => { waited++; return { ok: true, json: { items: [] } }; } } });
    assert.equal(off.requests.length, 0);
    assert.equal(waited, 0);
  } finally { await s.env.close(); }
});

test('P4 T19/T11: named JSON tools use routine/upgrade schemas and null local visibility', async () => {
  const tools = typedActionTools('zh', { premise: 4 });
  assert.ok(tools.some(t => t.name === 'routine'));
  for (const name of ['sponsor','pray','invent']) assert.equal(tools.some(t => t.name === name), false);
  assert.deepEqual(validateAction({ type: 'draw', energy: 1000 }, null, 4), []);
  assert.deepEqual(validateAction({ type: 'initiate', build: 'upgrade', owner: 'self' }, null, 4), []);
  assert.ok(validateAction({ type: 'routine' }, null, 4).length);
  assert.ok(validateAction({ type: 'routine', every: 37 }, null, 4).length);
  assert.ok(validateAction({ type: 'routine', called: null }, null, 4).length);
  const example = correctionExample('routine', 4);
  assert.deepEqual(validateAction({ type: example.tool, ...example.args }, null, 4), []);
  const s = await setup();
  try {
    await drive(s, { cfg: { actionTools: 'typed', toolMode: 'json' }, script: [{ text: JSON.stringify({ routine: { brief: 'short', called: false }, done: true }) }] });
    assert.equal(s.a.routine.brief, 'short');
    assert.equal(s.a.routine.called, false);
  } finally { await s.env.close(); }
});

test('P4 T11: every=0 can still be called once, while called=false prevents it', async () => {
  const s = await setup();
  try {
    s.a.routine.every = 0;
    const ac = new AbortController();
    const traces = [];
    const out = await drive(s, { cfg: { actionTools: 'typed' }, script: [{ calls: [call('done', {})] }], deps: {
      signal: ac.signal,
      waitWake: async () => ({ ok: true, json: { items: [{ seq: 100, kind: 'whisper' }], cursor: 100 } }),
      onWaking: (id, rec) => { traces.push(rec); ac.abort(); },
    } });
    assert.equal(out.requests.length, 1);
    assert.equal(traces[0].kind, 'wake');
  } finally { await s.env.close(); }
});

test('P4 Q67: successful refund ends the paid session without changing the refund record shape', async () => {
  const s = await setup();
  try {
    const woke = await s.client.wake({ kind: 'main' });
    const r = s.env.rt.exec('meter', { op: 'refund', agentId: s.a.id, wakeId: woke.json.wakeId, day: earthDay(Date.now(), 'Asia/Shanghai').key }).result;
    assert.equal(r.ok, true);
    assert.equal(s.a.tokens.waking.refundable, false);
    assert.equal((await s.client.me()).json.waking, null);
    assert.equal((await s.client.look({ wakeId: woke.json.wakeId, what: 'self' })).json.error.code, 'no_waking');
  } finally { await s.env.close(); }
});

test('P4 T19: actual hosted manager supplies the internal refund dependency', async () => {
  const s = await setup();
  let timer;
  try {
    const manager = s.env.app.ctx.runners;
    manager.provider = async () => ({ name: 'mock-failure', complete: async () => { throw new ProviderError('mock failure', { retryable: true }); } });
    const recorded = new Promise(resolve => { manager.traces = { append: (id, rec) => resolve(rec) }; });
    const before = s.a.basic;
    await manager.attach(s.a.id, s.resident.agentToken, { provider: 'mock', model: 'mock', apiKey: '', baseURL: '', thinking: 'default', timeoutMs: 1000, actEveryTicks: 1, historyRounds: 2, toolMode: 'json' });
    const rec = await Promise.race([recorded, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('hosted mock did not finish')), 5000); })]);
    assert.equal(rec.ended, 'error');
    assert.equal(s.a.basic, before);
    assert.equal(s.a.tokens.used, 0);
    assert.ok(s.env.rt.w.dayLog.p4.refunded > 0);
    await manager.stop(s.a.id);
  } finally { clearTimeout(timer); await s.env.close(); }
});

test('P4 T11: failed scheduled wakings still respect the resident’s cadence', async () => {
  const s = await setup(1);
  try {
    s.a.routine.every = 4;
    s.a.routine.called = false;
    const out = await drive(s, { rounds: 9, script: [], deps: { wait: async () => s.env.rt.tickNow() } });
    assert.deepEqual(out.traces.map(t => t.tick), [0,4,8]);
    assert.equal(out.requests.length, 0);
  } finally { await s.env.close(); }
});
