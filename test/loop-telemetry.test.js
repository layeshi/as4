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
