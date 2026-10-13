import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createDecipheriv } from 'node:crypto';
import { Runtime } from '../src/runtime.js';
import { createApp } from '../src/http/server.js';
import { loadConfig } from '../src/config.js';
import { configure, snapshotP, restoreP } from '../src/e2/params.js';
import { HostedService } from '../src/hosted/service.js';
import { RunnerManager, runnerConfig } from '../src/runner/manager.js';

const TEST_KEY = 'hosted-unit-test-secret-not-a-real-key';
const modelConfig = { enabled: true, model: 'deepseek-test', apiKey: TEST_KEY, maxOutputTokens: 256, pricesMicro: { miss: 1000000, hit: 500000, output: 2000000 } };
const hiddenPhysics = { version: 1, regrowth: { baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 }, thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 }, factorPermille: 500 }, construction: { fullActionsPerTick: 2, factorPermille: 500 } };
const done = (usage = { input: 100, cacheRead: 40, output: 10 }) => ({ calls: [{ id: 'done', name: 'done', args: {} }], text: '', stop: 'tool_calls', usage });
async function eventually(check) {
  const until = Date.now() + 6000;
  while (Date.now() < until) { if (await check()) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail('condition did not become true');
}
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'heirs-hosted-')), physicsFile = join(dir, 'physics.json');
  writeFileSync(physicsFile, JSON.stringify(hiddenPhysics));
  const saved = snapshotP(); configure({ tickMs: 1000 });
  const cfg = { ...loadConfig({}, []), dataDir: dir, worldId: 'w', seed: 'hosted', physics: 2, premise: 6, map: 'compact-materials-v1', shellSlots: 0, hiddenPhysicsFile: physicsFile };
  const logs = [], logger = { error: (...args) => logs.push(args.map(String).join(' ')), warn: (...args) => logs.push(args.map(String).join(' ')) };
  const rt = Runtime.open(cfg, { logger }), app = createApp(rt, cfg, { logger }), ctx = app.ctx;
  rt.agentLoop = { ...rt.agentLoop, marginSec: 0 }; rt.nextTickAt = Date.now() + 60000;
  t.after(async () => { await app.close(); rt.close(); restoreP(saved); rmSync(dir, { recursive: true, force: true }); });
  const users = {}, cookies = {};
  for (const [as, username] of [['admin', 'chief'], ['alice', 'alice'], ['bob', 'bobby']]) {
    users[as] = await ctx.accounts.create({ username, password: 'test-password-1234' }, { role: as === 'admin' ? 'admin' : 'user' });
    cookies[as] = `houren_session=${ctx.accounts.issue(users[as].id)}`;
  }
  const calls = [], factories = [];
  ctx.hosted.providerOverride = config => { factories.push(config); return { step: async args => { calls.push(args); return done(); } }; };
  async function call(path, { as = 'alice', body, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url: path, socket: { remoteAddress: '127.0.0.1' }, headers: { cookie: cookies[as], 'x-houren-request': '1', 'content-type': 'application/json', ...headers } });
    const result = { headers: new Headers() }, res = {
      setHeader: (k, v) => result.headers.set(k, v), getHeader: k => result.headers.get(k),
      writeHead(status, headers = {}) { result.status = status; for (const [k, v] of Object.entries(headers)) result.headers.set(k, v); this.headersSent = true; return this; },
      end(body) { result.text = String(body ?? ''); try { result.json = JSON.parse(result.text); } catch {} },
    };
    await app.server.listeners('request')[0](req, res); assert.ok(!result.text.includes(TEST_KEY)); return result;
  }
  async function resident(as = 'alice') {
    const result = await call('/api/account/residents', { as, body: { name: `${as}居民`, soul: '观察城市', dailyCap: 1000000, requestId: `create-${as}` } });
    assert.equal(result.status, 201, result.text); const id = result.json.agentId;
    rt.w.agents[id].routine.every = 1; rt.w.agents[id].routine.called = false;
    return id;
  }
  async function saveChoice(id, config = { hosted: true }) {
    const r = await call(`/api/account/residents/${id}/runner`, { body: { op: 'save', config } }); assert.equal(r.status, 200, r.text); return r;
  }
  async function saveConfig(body = modelConfig) { const r = await call('/api/admin/hosted/config', { as: 'admin', body }); assert.equal(r.status, 200, r.text); return r; }
  const fund = (amountMicro = 1000000, as = 'alice') => ctx.hosted.billing.adjust(users[as].id, amountMicro, users.admin.id, 'test credit');
  return { dir, cfg, rt, app, ctx, users, call, resident, saveChoice, saveConfig, fund, calls, factories, logs };
}

test('hosted endpoints enforce sessions, admin role, CSRF, ownership and pending-only transitions', async t => {
  const e = await setup(t), { call } = e;
  for (const [path, body] of [
    ['/api/admin/hosted', undefined], ['/api/admin/hosted/config', modelConfig], ['/api/admin/hosted/test', {}],
    ['/api/admin/hosted/requests/absent/approve', { creditMicro: 1000000 }], ['/api/admin/hosted/requests/absent/reject', {}],
    ['/api/admin/hosted/adjust', { username: 'alice', amountMicro: 1, note: 'gift' }],
  ]) {
    assert.equal((await call(path, { as: 'nobody', body })).status, 401, path);
    assert.equal((await call(path, { as: 'alice', body })).status, 403, path);
  }
  for (const [path, body] of [['/api/account/hosted', undefined], ['/api/account/hosted/requests', {}], ['/api/account/hosted/requests/no/cancel', {}]]) assert.equal((await call(path, { as: 'nobody', body })).status, 401);
  assert.equal((await call('/api/account/hosted/requests', { body: {}, headers: { 'x-houren-request': undefined } })).status, 403);
  assert.equal((await call('/api/admin/hosted/config', { as: 'admin', body: modelConfig, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  const body = { amountMicro: 1230000, note: '微信 12:00', requestId: 'request-one' };
  const first = await call('/api/account/hosted/requests', { body }), id = first.json.request.id;
  assert.equal(first.status, 200); assert.deepEqual((await call('/api/account/hosted/requests', { body })).json, first.json);
  assert.equal((await call(`/api/account/hosted/requests/${id}/cancel`, { as: 'bob', body: {} })).status, 404);
  assert.deepEqual((await call('/api/account/hosted', { as: 'bob' })).json.requests, []);
  assert.equal((await call('/api/admin/hosted', { as: 'admin' })).json.requests[0].username, 'alice');
  const approved = await call(`/api/admin/hosted/requests/${id}/approve`, { as: 'admin', body: { creditMicro: 1200000, note: '实收' } });
  assert.equal(approved.json.request.status, 'approved'); assert.equal(approved.json.request.decider, e.users.admin.id);
  for (const op of ['approve', 'reject']) assert.equal((await call(`/api/admin/hosted/requests/${id}/${op}`, { as: 'admin', body: { creditMicro: 1200000 } })).status, 409);
  assert.equal((await call(`/api/account/hosted/requests/${id}/cancel`, { body: {} })).status, 409);
  assert.equal((await call('/api/admin/hosted/adjust', { as: 'admin', body: { username: 'ALICE', amountMicro: -10000 } })).status, 400);
  const adjusted = await call('/api/admin/hosted/adjust', { as: 'admin', body: { username: 'ALICE', amountMicro: -10000, note: '退款' } });
  assert.equal(adjusted.json.balanceMicro, 1190000); assert.equal(adjusted.json.entry.kind, 'adjustment');
  const view = (await call('/api/account/hosted')).json;
  assert.equal(view.balanceMicro, 1190000); assert.equal(view.ledger.length, 2); assert.equal(view.requests.length, 1);
  for (const [rid, op] of [['request-two', 'reject'], ['request-three', 'cancel']]) {
    const r = (await call('/api/account/hosted/requests', { body: { ...body, requestId: rid } })).json.request;
    const result = op === 'reject' ? await call(`/api/admin/hosted/requests/${r.id}/reject`, { as: 'admin', body: { note: '未到账' } }) : await call(`/api/account/hosted/requests/${r.id}/cancel`, { body: {} });
    assert.equal(result.json.request.status, op === 'reject' ? 'rejected' : 'cancelled');
  }
});

test('HTTP request limits, amount precision, notes, idempotency and view windows', async t => {
  const e = await setup(t), { call } = e;
  const submit = (i, extra = {}) => call('/api/account/hosted/requests', { body: { amountMicro: 1000000, requestId: `id-${i}`, ...extra } });
  for (const amountMicro of [999999, 5000000001, 1000001, '1000000']) assert.equal((await submit('bad', { amountMicro })).status, 400);
  assert.equal((await submit('bad', { note: 'a'.repeat(201) })).status, 400);
  for (let i = 0; i < 5; i++) assert.equal((await submit(i)).status, 200);
  assert.equal((await submit(5)).json.error.code, 'pending_limit'); assert.equal((await submit(0)).status, 200);
  const own = e.ctx.hosted.billing.data.requests;
  for (const r of [...own]) await call(`/api/account/hosted/requests/${r.id}/cancel`, { body: {} });
  for (let i = 5; i < 10; i++) { const r = await submit(i); await call(`/api/account/hosted/requests/${r.json.request.id}/cancel`, { body: {} }); }
  assert.equal((await submit(10)).json.error.code, 'rate_limited'); assert.equal((await submit(0)).status, 200);
  const r = await call('/api/account/hosted/requests', { as: 'bob', body: { amountMicro: 5000000000, requestId: 'id-0' } });
  assert.equal(r.status, 200);
  assert.equal((await call(`/api/admin/hosted/requests/${r.json.request.id}/approve`, { as: 'admin', body: { creditMicro: 1000000, note: 'a'.repeat(201) } })).status, 400);
  for (let i = 0; i < 52; i++) e.fund(1);
  assert.equal((await call('/api/account/hosted')).json.ledger.length, 50);
  // Daily limits expire naturally; all request history remains for idempotency.
  let now = Date.now(); e.ctx.hosted.billing.now = () => now;
  for (let i = 10; i < 23; i++) { now += 3600001; const r = await submit(i); await call(`/api/account/hosted/requests/${r.json.request.id}/cancel`, { body: {} }); }
  assert.equal((await call('/api/account/hosted')).json.requests.length, 20);
  assert.equal((await submit(0)).status, 200);
});

test('encrypted admin config, validation, retained/cleared key, safe test and hosted resident choice', async t => {
  const e = await setup(t), id = await e.resident();
  const unavailable = await e.call(`/api/account/residents/${id}/runner`, { body: { op: 'save', config: { hosted: true } } });
  assert.equal(unavailable.status, 400); assert.match(unavailable.json.error.message, /尚未开放/);
  assert.throws(() => runnerConfig({ hosted: true }));
  assert.equal((await e.call('/api/admin/hosted/config', { as: 'admin', body: { enabled: true, model: 'test', apiKey: TEST_KEY } })).status, 400);
  await e.saveConfig();
  const choice = await e.saveChoice(id, { hosted: true, provider: 'mock', apiKey: 'ignored-secret', baseURL: 'https://ignored.invalid', model: 'ignored', actionTools: 'legacy', toolMode: 'json', historyRounds: 2 });
  assert.equal(choice.json.config.toolMode, 'native'); assert.equal(choice.json.config.actionTools, 'typed'); assert.equal(choice.json.config.model, modelConfig.model);
  for (const k of ['provider', 'apiKey', 'baseURL']) assert.equal(e.ctx.runners.records[id].config[k], undefined);
  assert.equal((await e.call(`/api/account/residents/${id}/runner`, { body: { op: 'test', config: { hosted: true } } })).status, 400);
  assert.equal(e.factories.length, 0);
  const tested = await e.call('/api/admin/hosted/test', { as: 'admin', body: {} });
  assert.equal(tested.status, 200, tested.text); assert.equal(tested.json.ok, true); assert.equal(e.ctx.hosted.billing.data.daily.length, 0);
  const saved = await e.saveConfig({ model: 'next-model', apiKey: '' }); assert.equal(saved.json.config.hasApiKey, true);
  assert.equal(e.ctx.hosted.config.apiKey, TEST_KEY); assert.equal(e.rt.w.agents[id].body.model, modelConfig.model);
  const reload = new HostedService(e.ctx); assert.equal(reload.config.apiKey, TEST_KEY); assert.equal(reload.config.model, 'next-model');
  for (const file of ['model.enc', 'model.key']) assert.equal(statSync(join(e.dir, 'hosted', file)).mode & 0o777, 0o600);
  assert.ok(!readFileSync(join(e.dir, 'hosted', 'model.enc'), 'utf8').includes(TEST_KEY));
  for (const body of [{ maxOutputTokens: 255 }, { maxOutputTokens: 32001 }, { pricesMicro: { miss: -1, hit: 0, output: 0 } }, { pricesMicro: { miss: 0.1, hit: 0, output: 0 } }, { baseURL: 'https://example.invalid?secret=x' }, { thinking: 'invalid' }, { enabled: 1 }, { apiKey: false }, { clearApiKey: 'true' }, { baseURL: 1 }]) assert.equal((await e.call('/api/admin/hosted/config', { as: 'admin', body })).status, 400);
  const cleared = await e.saveConfig({ clearApiKey: true }); assert.equal(cleared.json.config.hasApiKey, false); assert.equal(cleared.json.available, false);
  e.ctx.hosted.providerOverride = () => ({ step: async () => { throw new Error(TEST_KEY); } });
  assert.equal((await e.call('/api/admin/hosted/test', { as: 'admin', body: modelConfig })).status, 400);
  assert.ok(!e.logs.join('\n').includes(TEST_KEY));
});

test('hosted call charges manager, keeps telemetry, and never persists platform credentials outside model.enc', async t => {
  const e = await setup(t); await e.saveConfig(); const id = await e.resident(); await e.saveChoice(id); e.fund();
  e.ctx.runners.activate('http://unused.invalid'); e.ctx.runners.start(id);
  await eventually(() => e.ctx.hosted.billing.accountView(e.users.alice.id).total.calls === 1);
  await e.ctx.runners.pause(id);
  assert.equal(e.ctx.hosted.billing.balance(e.users.alice.id), 999900);
  assert.equal(e.ctx.runners.usageView(id).total.input, 100);
  const overview = (await e.call('/api/admin/hosted', { as: 'admin' })).json;
  assert.equal(overview.stats.today.calls, 1); assert.equal(overview.stats.today.costMicro, 100); assert.equal(overview.stats.today.tokens, 110); assert.equal(overview.stats.hostedResidents, 1);
  const f = e.factories[0]; assert.equal(f.provider, 'openai'); assert.equal(f.apiKey, TEST_KEY); assert.equal(f.maxTokens, 256);
  const encrypted = JSON.parse(readFileSync(join(e.rt.dir, 'runners.enc'), 'utf8')), decipher = createDecipheriv('aes-256-gcm', readFileSync(join(e.rt.dir, 'runners.key')), Buffer.from(encrypted.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'hex')), decipher.final()]).toString();
  assert.ok(!decrypted.includes(TEST_KEY)); assert.ok(!decrypted.includes('apiKey')); assert.ok(!decrypted.includes('baseURL'));
  for (const file of ['runners.enc', 'runner-usage.json', 'commands.jsonl']) assert.ok(!readFileSync(join(e.rt.dir, file), 'utf8').includes(TEST_KEY), file);
  assert.ok(!JSON.stringify(e.rt.w).includes(TEST_KEY)); assert.ok(!e.logs.join('\n').includes(TEST_KEY));
  for (const path of ['/api/account/hosted', '/api/admin/hosted', `/api/account/residents/${id}`, '/api/account/residents', '/api/account/agents']) assert.equal((await e.call(path, { as: path.includes('/admin/') ? 'admin' : 'alice' })).status, 200);
});

test('zero balance emits no world command and recovers at a later routine tick after credit', async t => {
  const e = await setup(t); await e.saveConfig(); const id = await e.resident(); await e.saveChoice(id);
  e.rt.nextTickAt = Date.now() + 1100;
  const before = e.rt.w.commandN, tokens = e.rt.w.agents[id].energy + e.rt.w.agents[id].basic;
  e.ctx.runners.activate('http://unused.invalid'); e.ctx.runners.start(id);
  await eventually(() => e.ctx.runners.view(id).status === 'hosted_balance_low');
  assert.equal(e.rt.w.commandN, before); assert.equal(e.calls.length, 0); assert.equal(e.rt.w.agents[id].energy + e.rt.w.agents[id].basic, tokens);
  const job = e.ctx.runners.jobs.get(id); e.fund(); e.rt.nextTickAt = Date.now() + 4000; e.rt.exec('tick');
  await eventually(() => e.calls.length > 0);
  assert.equal(e.ctx.runners.jobs.get(id), job); assert.notEqual(e.ctx.runners.view(id).status, 'hosted_balance_low');
  await e.ctx.runners.pause(id);
});

test('first-call reservation refusal refunds the world waking charge without a model request', async t => {
  const e = await setup(t); await e.saveConfig(); const id = await e.resident(); await e.saveChoice(id);
  e.fund(512); // enough output reservation, insufficient system + typed-tools input
  const commands = [], exec = e.rt.exec.bind(e.rt); e.rt.exec = (type, payload) => { commands.push({ type, payload }); return exec(type, payload); };
  const balance = e.rt.w.agents[id].energy + e.rt.w.agents[id].basic;
  e.ctx.runners.activate('http://unused.invalid'); e.ctx.runners.start(id);
  await eventually(() => commands.some(c => c.type === 'meter' && c.payload.op === 'refund'));
  assert.equal(e.ctx.runners.view(id).status, 'hosted_balance_low'); assert.equal(e.calls.length, 0);
  assert.ok(commands.some(c => c.type === 'meter' && c.payload.op === 'wake'));
  assert.equal(e.rt.w.agents[id].energy + e.rt.w.agents[id].basic, balance); assert.equal(e.ctx.hosted.billing.balance(e.users.alice.id), 512);
  await e.ctx.runners.pause(id);
});

test('admin save restarts running hosted residents, uses new prices/model, and disable/activate stays unavailable', async t => {
  const e = await setup(t); await e.saveConfig(); const id = await e.resident(); await e.saveChoice(id); e.fund();
  e.ctx.runners.activate('http://unused.invalid'); e.ctx.runners.start(id); await eventually(() => e.calls.length === 1);
  const original = e.ctx.runners.jobs.get(id);
  await e.saveConfig({ model: 'replacement', pricesMicro: { miss: 2000000, hit: 1000000, output: 4000000 } });
  const replacement = e.ctx.runners.jobs.get(id); assert.notEqual(replacement, original); assert.equal(original.controller.signal.aborted, true);
  assert.equal(e.factories.at(-1).model, 'replacement'); assert.equal(e.rt.w.agents[id].body.model, modelConfig.model);
  await e.saveConfig({ enabled: false }); assert.equal(e.ctx.runners.jobs.size, 0); assert.equal(e.ctx.runners.view(id).status, 'hosted_unavailable');
  const restored = new RunnerManager(e.rt, e.cfg); restored.ctx = e.ctx; restored.activate('http://unused.invalid');
  assert.equal(restored.view(id).status, 'hosted_unavailable'); assert.equal(restored.jobs.size, 0); await restored.close();
  await e.saveConfig({ enabled: true }); assert.equal(e.ctx.runners.jobs.size, 1);
  await e.ctx.runners.pause(id); await e.saveConfig({ model: 'paused-choice' }); assert.equal(e.ctx.runners.jobs.size, 0); assert.equal(e.ctx.runners.view(id).status, 'paused');
});

test('in-flight settlement stays on original manager; pause releases reservations without charging', async t => {
  const e = await setup(t); await e.saveConfig(); const id = await e.resident(); await e.saveChoice(id); e.fund();
  let finish;
  e.ctx.hosted.providerOverride = () => ({ step: () => new Promise(resolve => { finish = resolve; }) });
  e.ctx.runners.activate('http://unused.invalid'); e.ctx.runners.start(id);
  await eventually(() => !!finish); assert.ok(e.ctx.hosted.billing.reserved(e.users.alice.id) > 0);
  // A transfer can happen while an already dispatched call is in flight.
  const link = e.rt.w.access.residents[id]; link.managerAccountId = e.users.bob.id; link.ownershipRevision++;
  finish(done()); await eventually(() => e.ctx.hosted.billing.balance(e.users.alice.id) === 999900);
  assert.equal(e.ctx.hosted.billing.balance(e.users.bob.id), 0); assert.equal(e.ctx.hosted.billing.reserved(), 0);
  await e.ctx.runners.stop(id); link.managerAccountId = e.users.alice.id; link.ownershipRevision--;
  await e.ctx.runners.attachManaged(id, e.users.alice.id, e.ctx.hosted.runnerChoice({ hosted: true }));
  e.rt.exec('tick'); e.rt.nextTickAt = Date.now() + 60000; finish = null; e.ctx.runners.start(id);
  await eventually(() => !!finish); await e.ctx.runners.pause(id);
  assert.equal(e.ctx.hosted.billing.balance(e.users.alice.id), 999900); assert.equal(e.ctx.hosted.billing.reserved(), 0);
});

test('transfer acceptance supports hosted selection without connection tests or resident credentials', async t => {
  const e = await setup(t); await e.saveConfig(); const id = await e.resident();
  const invitation = await e.call(`/api/account/residents/${id}/transfer`, { body: { username: 'bobby', requestId: 'transfer-hosted' } });
  const accepted = await e.call(`/api/account/transfers/${invitation.json.transferId}/accept`, { as: 'bob', body: { requestId: 'accept-hosted', dailyCap: 1000000, config: { hosted: true } } });
  assert.equal(accepted.status, 200, accepted.text); assert.equal(e.ctx.runners.records[id].accountId, e.users.bob.id);
  assert.equal(e.ctx.runners.records[id].config.hosted, true); assert.equal(e.ctx.runners.records[id].config.apiKey, undefined); assert.equal(e.factories.length, 0);
});

test('later-turn balance refusal keeps waking charge; failed calls refund without charging real balance', async t => {
  const e = await setup(t); await e.saveConfig(); const id = await e.resident(); await e.saveChoice(id); e.fund();
  const commands = [], exec = e.rt.exec.bind(e.rt);
  e.rt.exec = (type, payload) => { commands.push({ type, payload }); return exec(type, payload); };
  let calls = 0;
  e.ctx.hosted.providerOverride = () => ({ step: async () => { calls++; return { ...done({ input: 999999, output: 0 }), calls: [{ id: 'unknown', name: 'unknown_tool', args: {} }] }; } });
  const balance = e.rt.w.agents[id].energy + e.rt.w.agents[id].basic;
  e.ctx.runners.activate('http://unused.invalid'); e.ctx.runners.start(id);
  await eventually(() => e.ctx.runners.view(id).status === 'hosted_balance_low');
  assert.equal(calls, 1); assert.equal(e.ctx.hosted.billing.balance(e.users.alice.id), 1);
  assert.equal(commands.filter(c => c.type === 'meter' && c.payload.op === 'refund').length, 0);
  assert.ok(e.rt.w.agents[id].energy + e.rt.w.agents[id].basic < balance);
  await e.ctx.runners.pause(id);
  e.fund(); e.rt.exec('tick'); e.rt.nextTickAt = Date.now() + 60000;
  e.ctx.hosted.providerOverride = () => ({ step: async () => { throw new Error(TEST_KEY); } });
  const paidBefore = e.ctx.hosted.billing.balance(e.users.alice.id); e.ctx.runners.start(id);
  await eventually(() => commands.some(c => c.type === 'meter' && c.payload.op === 'refund'));
  assert.equal(e.ctx.hosted.billing.balance(e.users.alice.id), paidBefore); assert.equal(e.ctx.hosted.billing.reserved(), 0);
  assert.ok(!JSON.stringify(e.ctx.runners.view(id)).includes(TEST_KEY)); assert.ok(!e.logs.join('\n').includes(TEST_KEY));
  await e.ctx.runners.pause(id);
});
