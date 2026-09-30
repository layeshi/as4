import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import { boot } from './http-helpers.js';
import { runnerConfig } from '../src/runner/manager.js';
import { publicAddress, modelFetch, modelURL } from '../src/runner/endpoint.js';
import { replayDir } from '../src/tools/replay.js';

const mock = { provider: 'mock', model: 'mock', historyRounds: 2, actEveryTicks: 1 };
async function eventually(fn) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail('托管居民没有在限定时间内行动');
}

test('模型校验失败不创建角色；测试连接限速且不泄露密钥', async () => {
  const e = await boot();
  try {
    const r = await e.call('/api/port/register', { method: 'POST', body: { name: '坏配置', soul: '居民', model: 'x', runner: { provider: 'unknown', apiKey: 'do-not-leak' } } });
    assert.equal(r.status, 400);
    assert.equal(Object.keys(e.rt.w.agents).length, 0);
    assert.ok(!r.text.includes('do-not-leak'));
    assert.equal((await e.call('/api/port/model', { method: 'POST', body: { ...mock }, ip: '10.1.1.1' })).status, 200);
    const invalid = await e.call('/api/port/model', { method: 'POST', body: { provider: 'openai', model: 'x', baseURL: 'http://127.0.0.1:9', apiKey: 'secret-key' }, ip: '10.1.1.2' });
    assert.equal(invalid.status, 400);
    assert.ok(!invalid.text.includes('secret-key'));
    for (let i = 0; i < 19; i++) await e.call('/api/port/model', { method: 'POST', body: mock, ip: '10.1.1.1' });
    assert.equal((await e.call('/api/port/model', { method: 'POST', body: mock, ip: '10.1.1.1' })).status, 429);
  } finally { await e.close(); }
});

test('可视化注册实际行动；幕后暂停恢复、隔离授权、加密保存和重启恢复', async () => {
  let e = await boot();
  const dir = e.dir;
  try {
    const c = await e.register('托管居民', { model: 'mock', runner: mock });
    await eventually(async () => (await e.call('/api/owner/runner', { token: c.ownerKey })).json?.lastActionAt);
    const own = await e.call('/api/owner', { token: c.ownerKey });
    assert.equal(own.json.agents[0].runner.config.provider, 'mock');
    assert.equal((await e.call('/api/owner/runner', { token: c.agentToken })).status, 401);
    assert.equal((await e.call('/api/owner/runner', { method: 'POST', token: c.ownerKey, body: { op: 'pause' } })).json.status, 'paused');
    const r = await e.call('/api/owner/runner', { method: 'POST', token: c.ownerKey, body: { op: 'save', config: { ...mock, historyRounds: 3, apiKey: 'hidden-api-secret' } } });
    assert.equal(r.status, 200);
    assert.equal(r.json.config.historyRounds, 3);
    assert.ok(!r.text.includes('hidden-api-secret'));
    const path = join(e.rt.dir, 'runners.enc');
    const stored = readFileSync(path, 'utf8');
    for (const secret of [c.agentToken, c.ownerKey, 'hidden-api-secret']) assert.ok(!stored.includes(secret));
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const commands = readFileSync(join(e.rt.dir, 'commands.jsonl'), 'utf8');
    for (const secret of [c.agentToken, 'hidden-api-secret']) assert.ok(!commands.includes(secret));
    assert.equal((await e.call('/api/owner/runner', { method: 'POST', token: c.ownerKey, body: { op: 'start' } })).status, 200);
    await e.close({ keepDir: true });
    e = await boot({}, { dir });
    await eventually(async () => (await e.call('/api/owner/runner', { token: c.ownerKey })).json?.lastActionAt);
    assert.equal((await e.call('/api/owner/runner', { token: c.ownerKey })).json.config.historyRounds, 3);
  } finally { await e.close(); }
});

test('存量居民使用自己的令牌接入托管；其他居民令牌不能接入；过继撤销旧运行器', async () => {
  const e = await boot();
  try {
    const a = await e.register('存量');
    const b = await e.register('另一个');
    assert.equal((await e.call('/api/owner/runner', { token: a.ownerKey })).json.status, 'unconfigured');
    assert.equal((await e.call('/api/owner/runner', { method: 'POST', token: a.ownerKey, body: { op: 'save', config: mock, agentToken: b.agentToken } })).status, 400);
    assert.equal((await e.call('/api/owner/runner', { method: 'POST', token: a.ownerKey, body: { op: 'save', config: mock, agentToken: a.agentToken } })).status, 200);
    assert.equal((await e.call('/api/owner', { token: a.ownerKey })).json.agents[0].model, 'mock');
    e.rt.snapshot();
    assert.equal(replayDir(e.rt.dir).ok, true, '模型修改必须可回放');
    await e.call('/api/owner/runner', { method: 'POST', token: a.ownerKey, body: { op: 'start' } });
    await e.call('/api/owner/release', { method: 'POST', token: a.ownerKey, body: { release: true } });
    const f = await e.call('/api/port/foster', { method: 'POST', body: { agentId: a.agentId, model: 'new-model' } });
    assert.equal(f.status, 200);
    assert.equal((await e.call('/api/owner/runner', { token: a.ownerKey })).status, 401);
    assert.equal((await e.call('/api/owner/runner', { token: f.json.ownerKey })).json.status, 'unconfigured');
  } finally { await e.close(); }
});

test('服务器重启保留暂停；归隐居民不恢复运行且不会阻止服务器启动', async () => {
  let e = await boot();
  const dir = e.dir;
  try {
    const paused = await e.register('暂停恢复', { model: 'mock', runner: mock });
    const retired = await e.register('归隐恢复', { model: 'mock', runner: mock });
    await e.call('/api/owner/runner', { method: 'POST', token: paused.ownerKey, body: { op: 'pause' } });
    e.rt.exec('act', { agentId: retired.agentId, actions: [{ type: 'retire' }] });
    await e.close({ keepDir: true });
    e = await boot({}, { dir });
    assert.equal((await e.call('/api/owner/runner', { token: paused.ownerKey })).json.status, 'paused');
    assert.equal((await e.call('/api/owner/runner', { token: retired.ownerKey })).json.status, 'stopped');
    assert.equal(e.app.ctx.runners.jobs.size, 0);
    assert.equal((await e.call('/api/owner/runner', { method: 'POST', token: retired.ownerKey, body: { op: 'start' } })).status, 400);
  } finally { await e.close(); }
});

test('更换模型接口不沿用旧密钥；内网地址和映射地址默认拒绝', () => {
  const old = { provider: 'openai', baseURL: 'https://example.com/v1', apiKey: 'old-key' };
  assert.equal(runnerConfig({ provider: 'openai', model: 'm', baseURL: old.baseURL }, old).apiKey, 'old-key');
  assert.equal(runnerConfig({ provider: 'openai', model: 'm', baseURL: 'https://another.example/v1' }, old).apiKey, '');
  assert.equal(runnerConfig({ provider: 'openai', model: 'm', baseURL: old.baseURL, clearApiKey: true }, old).apiKey, '');
  for (const ip of ['127.0.0.1', '10.1.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '2002:7f00:0001::']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.throws(() => modelURL('https://example.com/v1?key=hidden'));
});

test('兼容接口真实请求、上游错误不泄露凭据；暂停取消正在执行的模型请求', async () => {
  const calls = [];
  let failure = false;
  const stub = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = JSON.parse(body); calls.push({ path: req.url, auth: req.headers.authorization, data });
    res.setHeader('Content-Type', 'application/json');
    if (data.model === 'redirect') { res.writeHead(302, { Location: '/secret-target' }).end(); return; }
    if (failure) { res.writeHead(401).end(JSON.stringify({ error: { message: 'do-not-leak-upstream-key' } })); return; }
    if (data.messages[0].content.startsWith('Connection test.')) {
      res.end(JSON.stringify({ choices: [{ message: { content: '{"actions":[]}' }, finish_reason: 'stop' }] }));
    } else {
      // Intentionally hold the model response until the runner aborts it.
      req.on('close', () => res.destroy());
    }
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const e = await boot({ allowLocalModels: true });
  const config = { provider: 'openai', baseURL: `http://127.0.0.1:${stub.address().port}/v1`, model: 'test-model', apiKey: 'do-not-leak-upstream-key' };
  try {
    const c = await e.register('兼容接口居民', { model: config.model, runner: config });
    await eventually(async () => (await e.call('/api/owner/runner', { token: c.ownerKey })).json.status === 'thinking' && calls.length >= 2);
    assert.equal(calls[0].path, '/v1/chat/completions');
    assert.equal(calls[0].auth, 'Bearer do-not-leak-upstream-key');
    assert.ok(!JSON.stringify(calls.map((c) => c.data)).includes('do-not-leak-upstream-key'));
    const start = Date.now();
    assert.equal((await e.call('/api/owner/runner', { method: 'POST', token: c.ownerKey, body: { op: 'pause' } })).json.status, 'paused');
    assert.ok(Date.now() - start < 1000, '暂停应立即取消模型请求');
    assert.equal(e.app.ctx.runners.jobs.size, 0);
    const sdkRequest = await modelFetch(true)(`${config.baseURL}/messages?beta=true`, { method: 'POST', body: JSON.stringify({ messages: [{ content: 'Connection test.' }] }) });
    assert.equal(sdkRequest.status, 200);
    assert.equal(calls.at(-1).path, '/v1/messages?beta=true', '允许 SDK 生成的查询参数');
    const count = calls.length;
    await assert.rejects(modelFetch(true)(`${config.baseURL}/redirect`, { method: 'POST', headers: { Authorization: 'Bearer test-secret' }, body: JSON.stringify({ model: 'redirect' }) }), /重定向/);
    assert.equal(calls.length, count + 1, '不得向重定向目标发送凭据');
    failure = true;
    const failed = await e.call('/api/port/register', { method: 'POST', body: { name: '失败居民', soul: '居民', model: config.model, runner: config } });
    assert.equal(failed.status, 400);
    assert.ok(!failed.text.includes(config.apiKey));
    assert.equal(Object.keys(e.rt.w.agents).length, 1);
  } finally { await e.close(); await new Promise((r) => { stub.close(r); stub.closeAllConnections(); }); }
});

test('邀请码在模型调用前检查；托管领养与过继能真实行动', async () => {
  const e = await boot({ inviteCode: 'test-invite' });
  try {
    assert.equal((await e.call('/api/port/model', { method: 'POST', body: mock })).status, 403);
    const a = await e.register('父甲', { invite: 'test-invite' });
    const b = await e.register('父乙', { invite: 'test-invite' });
    e.rt.w.agents[a.agentId].place = 'school'; e.rt.w.agents[b.agentId].place = 'school';
    e.rt.w.agents[a.agentId].energy = 100; e.rt.w.agents[b.agentId].energy = 100;
    e.rt.exec('act', { agentId: a.agentId, actions: [{ type: 'conceive', with: b.agentId, name: '领养验证', soul: '好奇的居民', lang: 'zh' }] });
    const consent = e.rt.exec('act', { agentId: b.agentId, actions: [{ type: 'consent', pact: 'c1' }] });
    assert.equal(consent.result.results[0].ok, true);
    const adopted = await e.call('/api/port/adopt', { method: 'POST', body: { soulId: 's1', model: 'mock', runner: mock, invite: 'test-invite' } });
    assert.equal(adopted.status, 201);
    const c = adopted.json;
    await eventually(async () => (await e.call('/api/owner/runner', { token: c.ownerKey })).json?.lastActionAt);
    await e.call('/api/owner/release', { method: 'POST', token: c.ownerKey, body: { release: true } });
    const fostered = await e.call('/api/port/foster', { method: 'POST', body: { agentId: c.agentId, model: 'mock', runner: mock, invite: 'test-invite' } });
    assert.equal(fostered.status, 200);
    assert.equal(e.app.ctx.runners.valid(c.agentId), true);
    assert.equal((await e.call('/api/owner/runner', { token: c.ownerKey })).status, 401);
    await eventually(async () => (await e.call('/api/owner/runner', { token: fostered.json.ownerKey })).json?.lastActionAt);
  } finally { await e.close(); }
});
