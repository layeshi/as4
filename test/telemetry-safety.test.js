import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsageStore } from '../src/runner/usage.js';
import { Budget } from '../src/shells/budget.js';
import { ShellManager } from '../src/shells/manager.js';
const safety = await import('../src/telemetry-safety.js').catch(() => ({}));

test('telemetry uses known actions and codes, never arbitrary strings', () => {
  assert.equal(typeof safety.safeActionType, 'function');
  assert.equal(safety.safeActionType('diary'), 'diary');
  assert.equal(safety.safeActionType('remember SECRET'), 'other');
  assert.equal(safety.safeErrorCode('text_too_long'), 'text_too_long');
  assert.equal(safety.safeErrorCode('private_diary_text'), 'other');
  assert.equal(safety.safeFinishReason('end'), 'end');
  assert.equal(safety.safeFinishReason('in_progress'), 'in_progress');
  assert.deepEqual(safety.classifyProviderError({ status: 429, message: 'https://secret/key' }), { errorKind: 'rate_limit', status: 429 });
  assert.deepEqual(safety.classifyProviderError({ name: 'TimeoutError', message: 'private' }), { errorKind: 'timeout' });
  assert.deepEqual(safety.classifyProviderError({ cause: { code: 'ECONNRESET' }, message: 'private' }), { errorKind: 'network' });
  assert.deepEqual(safety.classifyProviderError({ status: 401 }), { errorKind: 'auth', status: 401 });
});

test('shell logger only accepts numeric model summaries and whitelisted action results', () => {
  const out = [];
  const logger = { log: m => out.push(m), warn: m => out.push(m), error: m => out.push(m) };
  const log = ShellManager.prototype.shellLog.call({ logger }, 'a1');
  log.info('  ✗ remember PRIVATE-DIARY text_too_long');
  log.info('  ✗ diary PRIVATE-DIARY');
  log.warn('提供者出错：PRIVATE-KEY https://private.example；本刻不行动。');
  log.error('PRIVATE-KEY');
  log.info('  独白：PRIVATE-DIARY');
  log.info('模型用时 1.2 s · 输入 3 · 输出 4 token · stop=length');
  assert.equal(JSON.stringify(out).includes('PRIVATE'), false);
  assert.equal(out.some(m => m.includes('输入 3')), true);
});

test('usage keeps safe metadata across restart while old counts remain accurate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-meta-'));
  try {
    const file = join(dir, 'usage.json');
    const store = new UsageStore({ file });
    store.record('a1', null, { ok: true, finishReason: 'PRIVATE-DIARY', toolCallCount: 2 });
    store.record('a1', null, { ok: false, toolCallCount: 0, error: { status: 503, message: 'PRIVATE-KEY' } });
    const v = new UsageStore({ file }).view('a1');
    assert.equal(v.total.calls, 2);
    assert.equal(v.total.failed, 1);
    assert.equal(v.total.unreported, 1);
    assert.equal(v.recent[0].reportedUsage, false);
    assert.equal(v.recent[0].finishReason, 'unknown');
    assert.equal(v.recent[0].toolCallCount, 2);
    assert.equal(v.recent[1].errorKind, 'http');
    assert.equal(v.recent[1].status, 503);
    assert.equal(readFileSync(file, 'utf8').includes('PRIVATE'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('shell usage preserves metadata without changing token settlement or daily budget', () => {
  const b = new Budget({ tokensPerDay: 1000 });
  const ticket = b.reserveTokens('a1', 100);
  b.settle(ticket, 20, { line: 'm' });
  assert.equal(typeof b.recordCall, 'function');
  b.recordCall('a1', null, { ok: false, error: { status: 429, message: 'PRIVATE' } });
  assert.equal(b.used, 20);
  assert.equal(b.tokensPerDay, 1000);
  assert.equal(b.day().agents.a1.recent[0].errorKind, 'rate_limit');
  assert.equal(JSON.stringify(b.days).includes('PRIVATE'), false);
});

test('actual provider timeout flag and known errorKind survive classification', () => {
  assert.deepEqual(safety.classifyProviderError({ timeout: true, message: 'PRIVATE' }), { errorKind: 'timeout' });
  assert.deepEqual(safety.classifyProviderError({ errorKind: 'network', message: 'PRIVATE' }), { errorKind: 'network' });
  assert.deepEqual(safety.classifyProviderError({ errorKind: 'PRIVATE', message: 'PRIVATE' }), { errorKind: 'unknown' });
});

test('legacy usage record shape stays exact until diagnostic metadata is provided', () => {
  const store = new UsageStore({ now: () => 0 });
  store.record('a1', { input: 1, output: 2 }, { ok: true, ms: 3 }, 'm');
  assert.deepEqual(store.view('a1').recent[0], { at: '1970-01-01T00:00:00.000Z', ok: true, reported: true, input: 1, output: 2, ms: 3, model: 'm' });
});

test('shell line errors never concatenate untrusted HTTP status', () => {
  const warnings = [];
  const manager = { rt: { w: { agents: {} } }, warn: m => warnings.push(m), stopDriver() {} };
  const line = { cfg: { model: 'm' }, status: 'ok' };
  ShellManager.prototype.markLineError.call(manager, line, { status: 'PRIVATE-KEY', message: 'PRIVATE' });
  assert.equal(JSON.stringify(warnings).includes('PRIVATE'), false);
});

test('shell usage reload sanitizes added metadata and keeps old budget totals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-shell-meta-'));
  const file = join(dir, 'usage.json');
  try {
    const b = new Budget({ tokensPerDay: 1000, file });
    b.settle(b.reserveTokens('a1', 100), 20, { line: 'm' });
    b.recordCall('a1', null, { ok: true, finishReason: 'length', toolCallCount: 1 });
    const reloaded = new Budget({ tokensPerDay: 1000, file });
    assert.equal(reloaded.used, 20);
    assert.equal(reloaded.agentUsage('a1').calls, 1);
    assert.equal(reloaded.day().agents.a1.recent[0].reportedUsage, false);
    assert.equal(reloaded.day().agents.a1.recent[0].finishReason, 'length');
    assert.equal(reloaded.day().agents.a1.recent[0].toolCallCount, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('standalone runner suppresses private thought and malformed supplier token fields', async () => {
  const { runAgent } = await import('../runner/agent.js');
  const { newWorld, reg } = await import('./helpers.js');
  const { buildPerception } = await import('../src/engine/perception.js');
  const w = newWorld(); const a = reg(w, 'one');
  const privateText = 'PRIVATE_STANDALONE_SENTINEL'; const logs = [];
  const log = { info: m => logs.push(m), warn: m => logs.push(m), error: m => logs.push(m) };
  const client = { me: async () => ({ ok: true, json: buildPerception(w, a.id) }), act: async () => ({ ok: true, json: { results: [{ type: `diary ${privateText}`, ok: false, error: { code: privateText } }] } }) };
  const provider = { complete: async () => ({ text: JSON.stringify({ thought: privateText, actions: [{ type: 'diary', text: privateText }] }), usage: { input: privateText, output: 1 }, stop: privateText }) };
  await runAgent({ name: 'one', lang: 'zh' }, { client, provider, log, maxRounds: 1, wait: async () => {} });
  assert.equal(logs.join('\n').includes(privateText), false);
  assert.equal(logs.some(m => m.includes('other')), true);
});

test('provider creation failure is classified without copying configuration text', async () => {
  const { runAgent } = await import('../runner/agent.js');
  const logs = [];
  await runAgent({ provider: 'PRIVATE_PROVIDER_SENTINEL' }, { log: { error: m => logs.push(m) } });
  assert.equal(logs.join('\n').includes('PRIVATE_PROVIDER_SENTINEL'), false);
});

test('daily and total diagnostics retain all enriched calls after recent20 truncation and restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-aggregate-'));
  const file = join(dir, 'usage.json'); const now = Date.UTC(2026, 9, 6, 1);
  try {
    const store = new UsageStore({ file, now: () => now });
    for (let i = 0; i < 5; i++) store.record('a1', null, { ok: false, toolCallCount: 0, error: { status: 429, message: 'PRIVATE' } });
    for (let i = 0; i < 20; i++) store.record('a1', i < 10 ? null : { input: 1, output: 2 }, { ok: true, finishReason: 'length', toolCallCount: 2 });
    store.record('a1', null, { ok: false, cancelled: true, toolCallCount: 0, error: { status: 503 } });
    const view = new UsageStore({ file, now: () => now }).view('a1');
    assert.equal(view.recent.length, 20);
    assert.equal(view.recent.some(c => c.errorKind === 'rate_limit'), false);
    assert.deepEqual(view.total.diagnostics, { calls: 25, failed: 5, errorKinds: { rate_limit: 5 }, finishReasons: { length: 20 }, toolCallCount: 40, unknownUsage: 15 });
    assert.deepEqual(view.today.diagnostics, view.total.diagnostics);
    assert.equal(view.total.calls, 25);
    assert.equal(view.total.unreported, 10);
    assert.equal(readFileSync(file, 'utf8').includes('PRIVATE'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('shell daily and per-agent diagnostics survive recent20 truncation without changing settlement counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-shell-aggregate-'));
  const file = join(dir, 'usage.json');
  try {
    const b = new Budget({ tokensPerDay: 1000, file });
    b.settle(b.reserveTokens('a1', 100), 20, { line: 'm' });
    for (let i = 0; i < 5; i++) b.recordCall('a1', null, { ok: false, toolCallCount: 0, error: { timeout: true, message: 'PRIVATE' } });
    for (let i = 0; i < 20; i++) b.recordCall('a1', { input: 1, output: 1 }, { ok: true, toolCallCount: 1, finishReason: 'stop' });
    b.recordCall('a1', null, { cancelled: true, toolCallCount: 0 });
    const restored = new Budget({ tokensPerDay: 1000, file });
    const day = restored.day();
    assert.equal(day.agents.a1.recent.length, 20);
    assert.deepEqual(day.diagnostics, { calls: 25, failed: 5, errorKinds: { timeout: 5 }, finishReasons: { stop: 20 }, toolCallCount: 20, unknownUsage: 5 });
    assert.deepEqual(day.agents.a1.diagnostics, day.diagnostics);
    assert.equal(restored.used, 20);
    assert.equal(restored.agentUsage('a1').calls, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('aggregate reload strips arbitrary private maps and invalid counts', async () => {
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'houren-bad-aggregate-'));
  const file = join(dir, 'usage.json'); const now = Date.UTC(2026, 9, 6, 1);
  const diagnostics = { calls: 1e20, failed: -1, unknownUsage: 'PRIVATE', toolCallCount: 2, errorKinds: { auth: 3, PRIVATE_ERROR: 4, network: -1 }, finishReasons: { length: 2, PRIVATE_FINISH: 5 }, secret: 'PRIVATE' };
  try {
    writeFileSync(file, JSON.stringify({ agents: { a1: { total: { diagnostics }, days: { '2026-10-06': { diagnostics } }, recent: [] } } }));
    const view = new UsageStore({ file, now: () => now }).view('a1');
    assert.deepEqual(view.total.diagnostics, { calls: 1e9, failed: 0, unknownUsage: 0, toolCallCount: 2, errorKinds: { auth: 3 }, finishReasons: { length: 2 } });
    assert.equal(JSON.stringify(view).includes('PRIVATE'), false);
    writeFileSync(file, JSON.stringify({ days: { '2026-10-06': { total: 20, warned: {}, agents: { a1: { tokens: 20, calls: 1, diagnostics } }, lines: {}, diagnostics } } }));
    const budget = new Budget({ tokensPerDay: 1000, file, now: () => now });
    assert.deepEqual(budget.day().diagnostics, view.total.diagnostics);
    assert.deepEqual(budget.day().agents.a1.diagnostics, view.total.diagnostics);
    assert.equal(JSON.stringify(budget.days).includes('PRIVATE'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
