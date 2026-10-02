// 托管运行器的 token 用量：存储（分桶、修剪、落盘）与 HTTP（只统计托管运行器的真实调用、只有造者能看、过继清零、不泄露、不影响回放）。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from './http-helpers.js';
import { UsageStore, USAGE_DAYS, USAGE_RECENT, DEFAULT_USAGE_TZ } from '../src/runner/usage.js';
import { replayDir } from '../src/tools/replay.js';
import { sha256hex } from '../src/http/util.js';

const mock = { provider: 'mock', model: 'mock', historyRounds: 2, actEveryTicks: 1 };
const HOUR = 3600 * 1000;

async function eventually(fn, what = '条件') {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(`${what}没有在限定时间内成立`);
}

/** 一个本机的 OpenAI 兼容接口：连接测试照常通过；运行器的调用按 mode 回应 */
async function startStub(usage = { prompt_tokens: 1234, completion_tokens: 56 }) {
  const stub = { mode: 'ok', usage, calls: [] };
  stub.server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    const probe = data.messages[0].content.startsWith('Connection test.');
    stub.calls.push({ probe, model: data.model });
    res.setHeader('Content-Type', 'application/json');
    if (!probe && stub.mode === 'hang') { req.on('close', () => res.destroy()); return; }
    if (!probe && stub.mode === 'limit') { res.writeHead(429).end(JSON.stringify({ error: { message: 'do-not-leak-upstream-detail' } })); return; }
    res.end(JSON.stringify({ choices: [{ message: { content: '{"actions":[]}' }, finish_reason: 'stop' }], ...(stub.usage ? { usage: stub.usage } : {}) }));
  });
  await new Promise((r) => stub.server.listen(0, '127.0.0.1', r));
  stub.config = (extra = {}) => ({ provider: 'openai', baseURL: `http://127.0.0.1:${stub.server.address().port}/v1`, model: 'test-model', apiKey: 'usage-test-api-key', ...extra });
  stub.close = () => new Promise((r) => { stub.server.close(r); stub.server.closeAllConnections(); });
  return stub;
}

const usageOf = async (e, key) => (await e.call('/api/owner/usage', { token: key })).json;

// ── 存储 ──────────────────────────────────────────────────────

test('UsageStore：按时区的日历日分桶；累计、今日与补零的近 14 日视图；只记数字', () => {
  let now = Date.UTC(2026, 9, 3, 15, 30); // 世界时 15:30 = 上海 23:30（10 月 3 日）
  const s = new UsageStore({ now: () => now });
  assert.equal(s.timezone, DEFAULT_USAGE_TZ);
  assert.equal(s.view('a1').since, null);
  assert.equal(s.view('a1').total.calls, 0);

  s.record('a1', { input: 1000, output: 50 }, { ok: true, ms: 1200.4 }, 'm1');
  now += HOUR; // 上海已是 10 月 4 日 00:30
  s.record('a1', { input: 400, output: 10 }, { ok: true, ms: 800 }, 'm1');
  s.record('a1', null, { ok: true, ms: 10 }, 'm2'); // 接口没有报告用量
  s.record('a1', { input: 7 }, { ok: true, ms: 10 }, 'm2'); // 只报告了输入
  s.record('a1', { input: Number.NaN, output: -5 }, { ok: true, ms: 10 }, 'm2'); // 全是无效数字
  s.record('a1', { input: '12', output: '3' }, { ok: true, ms: 10 }, 'm2'); // 字符串不算数
  s.record('a1', { input: 999, output: 999 }, { ok: false, ms: 5, error: Object.assign(new Error('upstream-detail-must-not-be-stored'), { status: 429 }) }, 'm2'); // 失败的调用不记用量
  s.record('a1', null, { ok: false, ms: 5, error: new Error('boom') }, 'm2');

  const v = s.view('a1');
  assert.equal(v.day, '2026-10-04');
  assert.equal(v.since, '2026-10-03T15:30:00.000Z');
  assert.deepEqual(v.total, { calls: 8, failed: 2, unreported: 3, input: 1407, output: 60, tokens: 1467 });
  assert.deepEqual(v.today, { day: '2026-10-04', calls: 7, failed: 2, unreported: 3, input: 407, output: 10, tokens: 417 });
  assert.equal(v.days.length, USAGE_DAYS);
  assert.deepEqual(v.days.map((d) => d.day).slice(-2), ['2026-10-03', '2026-10-04']);
  assert.equal(v.days[0].day, '2026-09-21');
  assert.deepEqual(v.days.at(-2), { day: '2026-10-03', calls: 1, failed: 0, unreported: 0, input: 1000, output: 50, tokens: 1050 });
  assert.equal(v.days.slice(0, -2).every((d) => d.calls === 0 && d.tokens === 0), true, '没有调用的日子补零');
  assert.deepEqual(v.today, v.days.at(-1));

  assert.equal(v.recent.length, 8);
  assert.deepEqual(v.recent[0], { at: '2026-10-03T15:30:00.000Z', ok: true, reported: true, input: 1000, output: 50, ms: 1200, model: 'm1' });
  assert.deepEqual(v.recent[2], { at: '2026-10-03T16:30:00.000Z', ok: true, reported: false, input: 0, output: 0, ms: 10, model: 'm2' });
  assert.deepEqual(v.recent[3], { at: '2026-10-03T16:30:00.000Z', ok: true, reported: true, input: 7, output: 0, ms: 10, model: 'm2' });
  assert.equal(v.recent[6].status, 429);
  assert.equal(v.recent[7].status, undefined);
  assert.ok(!JSON.stringify(s.agents).includes('upstream-detail-must-not-be-stored') && !JSON.stringify(s.agents).includes('boom'), '不记错误信息');
});

test('UsageStore：最近调用只留 20 条；旧的日子被修剪而累计不受影响；drop 之后什么都不剩', () => {
  let now = Date.UTC(2026, 0, 1, 4, 0);
  const s = new UsageStore({ now: () => now, timezone: 'UTC' });
  for (let i = 0; i < USAGE_RECENT + 5; i++) s.record('a1', { input: 10, output: 1 }, { ok: true, ms: i }, 'm');
  assert.equal(s.view('a1').recent.length, USAGE_RECENT);
  assert.equal(s.view('a1').recent[0].ms, 5, '留下的是最近的');
  now += 20 * 24 * HOUR;
  s.record('a1', { input: 5, output: 5 }, { ok: true, ms: 1 }, 'm');
  assert.deepEqual(Object.keys(s.agents.a1.days), ['2026-01-21'], '超出 14 日的桶被修剪');
  const v = s.view('a1');
  assert.equal(v.total.calls, USAGE_RECENT + 6);
  assert.equal(v.total.tokens, (USAGE_RECENT + 5) * 11 + 10, '累计不随修剪减少');
  assert.equal(v.days.reduce((n, d) => n + d.calls, 0), 1);
  s.drop('a1');
  assert.equal(s.has('a1'), false);
  assert.equal(s.view('a1').total.calls, 0);
  assert.deepEqual(s.ids(), []);
});

test('UsageStore：落盘（0600、只有数字）、重启后继续累计、损坏的文件从零开始、无效时区退回缺省', () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-usage-'));
  const file = join(dir, 'runner-usage.json');
  try {
    let now = Date.UTC(2026, 9, 3, 1, 0);
    const a = new UsageStore({ file, now: () => now });
    a.record('a1', { input: 100, output: 20 }, { ok: true, ms: 5 }, 'm');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.ok(!existsSync(`${file}.tmp`));
    const b = new UsageStore({ file, now: () => now });
    b.record('a1', { input: 1, output: 1 }, { ok: true, ms: 5 }, 'm');
    assert.equal(b.view('a1').total.tokens, 122);
    assert.equal(b.view('a1').since, new Date(now).toISOString());
    writeFileSync(file, '{ not json');
    assert.equal(new UsageStore({ file, now: () => now }).view('a1').total.calls, 0);
    writeFileSync(file, JSON.stringify({ agents: [] }));
    assert.equal(new UsageStore({ file, now: () => now }).ids().length, 0, '形状不对也从零开始');
    for (const bad of ['Not/AZone', null, 42, undefined]) assert.equal(new UsageStore({ timezone: bad }).timezone, DEFAULT_USAGE_TZ);
    assert.equal(new UsageStore({ timezone: 'America/New_York' }).timezone, 'America/New_York');
    const unwritable = new UsageStore({ file: join(dir, 'missing', 'x.json'), now: () => now });
    assert.doesNotThrow(() => unwritable.record('a1', { input: 1, output: 1 }, { ok: true }, 'm'), '落盘失败不影响运行');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('UsageStore：文件里形状不对的记录被规整或丢弃，视图与记录都不会抛错（含 __proto__ 这样的 id）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-usage-bad-'));
  const file = join(dir, 'runner-usage.json');
  try {
    const now = Date.UTC(2026, 9, 3, 4, 0);
    const day = '2026-10-03';
    writeFileSync(file, `{ "version": 1, "agents": {
      "a1": { "since": 5, "total": { "calls": "3", "input": -1, "output": 7.6 }, "days": [], "recent": "x" },
      "a2": null, "a3": "x", "a4": 7,
      "a5": { "since": "2026-10-01T00:00:00.000Z", "total": { "calls": 2, "failed": 1, "unreported": 0, "input": 10, "output": 5 },
              "days": { "${day}": { "calls": 2, "input": 10, "output": 5 }, "not-a-day": { "calls": 99 }, "2026-13-99x": {} },
              "recent": [ null, 3, { "at": "nope" }, { "at": "2026-10-03T01:00:00.000Z", "ok": false, "status": 429, "input": 9, "ms": "slow", "model": 42 }, { "at": "2026-10-03T02:00:00.000Z", "input": 4, "output": 1, "ms": 12.6, "model": "m" } ] },
      "__proto__": { "since": "2026-10-01T00:00:00.000Z", "total": { "calls": 1 }, "days": {}, "recent": [] }
    } }`);
    const s = new UsageStore({ file, now: () => now, timezone: 'Asia/Shanghai' });
    assert.deepEqual(s.ids().sort(), ['__proto__', 'a1', 'a5'], '不是对象的记录被丢掉');
    const a1 = s.view('a1');
    assert.equal(a1.since, new Date(now).toISOString(), '无效的 since 用当前时间');
    assert.deepEqual(a1.total, { calls: 0, failed: 0, unreported: 0, input: 0, output: 8, tokens: 8 }, '字符串、负数不算数，小数取整');
    assert.deepEqual(a1.recent, []);
    assert.equal(a1.days.length, USAGE_DAYS);
    const a5 = s.view('a5');
    assert.deepEqual(a5.today, { day, calls: 2, failed: 0, unreported: 0, input: 10, output: 5, tokens: 15 });
    assert.equal(Object.keys(s.agents.a5.days).length, 1, '不是日期的键被丢掉');
    assert.deepEqual(a5.recent, [
      { at: '2026-10-03T01:00:00.000Z', ok: false, input: 9, output: 0, ms: null, model: '42', status: 429 },
      { at: '2026-10-03T02:00:00.000Z', ok: true, reported: true, input: 4, output: 1, ms: 13, model: 'm' },
    ]);
    assert.doesNotThrow(() => { s.record('a1', { input: 1, output: 1 }, { ok: true }, 'm'); s.record('__proto__', null, { ok: true }, 'm'); s.record('new', null, { ok: true }, 'm'); });
    assert.equal(s.view('a1').total.tokens, 10);
    assert.equal(({}).calls, undefined, 'Object.prototype 没有被污染');
    assert.equal(Object.getPrototypeOf(s.agents), null);
    assert.equal(new UsageStore({ file, now: () => now }).view('a5').total.calls, 2, '规整后的内容可以再写再读');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── HTTP ──────────────────────────────────────────────────────

test('托管居民：只统计运行器的真实调用（连接测试不计），造者能看，其他人看不到，也不进世界状态与回放', async () => {
  const stub = await startStub();
  const e = await boot({ allowLocalModels: true });
  try {
    const c = await e.register('计量居民', { model: 'test-model', runner: stub.config() });
    const other = await e.register('别家居民');
    await eventually(async () => (await usageOf(e, c.ownerKey)).total.calls >= 1, '第一次调用的用量');

    const u = await usageOf(e, c.ownerKey);
    assert.equal(u.agentId, c.agentId);
    assert.equal(u.name, '计量居民');
    assert.equal(u.tracked, true);
    assert.equal(u.timezone, DEFAULT_USAGE_TZ);
    assert.equal(stub.calls.filter((x) => x.probe).length, 1, '注册时测试过一次连接');
    assert.equal(stub.calls.filter((x) => !x.probe).length, 1, '运行器调用了一次模型');
    assert.deepEqual(u.total, { calls: 1, failed: 0, unreported: 0, input: 1234, output: 56, tokens: 1290 });
    assert.deepEqual(u.today, u.days.at(-1));
    assert.equal(u.today.tokens, 1290);
    assert.equal(u.days.length, USAGE_DAYS);
    assert.equal(u.recent.length, 1);
    assert.deepEqual({ ...u.recent[0], at: undefined, ms: undefined }, { at: undefined, ok: true, reported: true, input: 1234, output: 56, ms: undefined, model: 'test-model' });
    assert.equal(typeof u.recent[0].ms, 'number');
    assert.equal(u.since, u.recent[0].at);

    // GET /api/owner 带着同样的视图，幕后页不用多发一次请求
    const own = (await e.call('/api/owner', { token: c.ownerKey })).json.agents[0];
    assert.deepEqual(own.usage.total, u.total);
    assert.equal(own.usage.tracked, true);

    // 授权：agent 令牌、别人的造者密钥、没有密钥都不行；别人只看得到自己的
    assert.equal((await e.call('/api/owner/usage')).status, 401);
    assert.equal((await e.call('/api/owner/usage', { token: c.agentToken })).status, 401);
    assert.equal((await e.call('/api/owner/usage', { token: 'not-a-key' })).status, 401);
    assert.equal((await e.call('/api/owner/usage', { method: 'POST', token: c.ownerKey, body: {} })).status, 404);
    const theirs = await usageOf(e, other.ownerKey);
    assert.deepEqual(theirs, { agentId: other.agentId, name: '别家居民', tracked: false });
    assert.ok(!JSON.stringify(theirs).includes('1234'));

    // 不进世界状态、命令日志、事件，也不在任何公共接口里；回放哈希不变
    e.rt.snapshot();
    for (const f of ['snapshot.json', 'commands.jsonl', 'events.jsonl']) {
      const text = existsSync(join(e.rt.dir, f)) ? readFileSync(join(e.rt.dir, f), 'utf8') : '';
      assert.ok(!text.includes('unreported'), `${f} 里不该有用量`);
      assert.ok(!text.includes('usage-test-api-key'), `${f} 里不该有密钥`);
    }
    for (const path of ['/api/public/state', '/api/public/events', `/api/public/agents/${c.agentId}`, '/api/public/metrics']) {
      const r = await e.call(path);
      assert.equal(r.status, 200, path); // 接口不存在（404）时下面的检查会空过
      assert.ok(!r.text.includes('"unreported"') && !r.text.includes('1290') && !r.text.includes('"tracked"'), `${path} 不该有用量`);
    }
    assert.equal(replayDir(e.rt.dir).ok, true);

    // 落盘的只有数字、日期与模型名
    const file = join(e.rt.dir, 'runner-usage.json');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const stored = readFileSync(file, 'utf8');
    for (const secret of [c.agentToken, c.ownerKey, 'usage-test-api-key', '计量居民']) assert.ok(!stored.includes(secret), '用量文件里不该有密钥或名字');
  } finally { await e.close(); await stub.close(); }
});

test('用量随服务器重启继续累计；修改模型配置不清零', async () => {
  const stub = await startStub();
  let e = await boot({ allowLocalModels: true });
  const dir = e.dir;
  try {
    const c = await e.register('重启居民', { model: 'test-model', runner: stub.config() });
    await eventually(async () => (await usageOf(e, c.ownerKey)).total.calls >= 1, '第一次调用');
    const first = await usageOf(e, c.ownerKey);

    // 改配置（同一个令牌）：累计保留，之后的调用记在新模型名下
    const saved = await e.call('/api/owner/runner', { method: 'POST', token: c.ownerKey, body: { op: 'save', config: stub.config({ model: 'second-model' }) } });
    assert.equal(saved.status, 200);
    assert.equal((await usageOf(e, c.ownerKey)).total.calls, first.total.calls, '保存配置不清零');
    assert.equal((await e.call('/api/owner/runner', { method: 'POST', token: c.ownerKey, body: { op: 'start' } })).status, 200);
    await eventually(async () => (await usageOf(e, c.ownerKey)).total.calls >= 2, '改配置之后的调用');
    const second = await usageOf(e, c.ownerKey);
    assert.equal(second.since, first.since);
    assert.equal(second.recent.at(-1).model, 'second-model');
    assert.equal(second.recent[0].model, 'test-model');

    await e.close({ keepDir: true });
    e = await boot({ allowLocalModels: true }, { dir });
    const reopened = await usageOf(e, c.ownerKey);
    assert.equal(reopened.tracked, true);
    assert.equal(reopened.since, first.since);
    assert.ok(reopened.total.calls >= second.total.calls, '重启后继续累计');
    assert.ok(reopened.total.tokens >= second.total.tokens);
  } finally { await e.close(); await stub.close(); }
});

test('演示模型不报告用量：调用记为「未报告」，不计 token；没有托管运行器的居民不可统计', async () => {
  const e = await boot();
  try {
    const hosted = await e.register('演示居民', { model: 'mock', runner: mock });
    const manual = await e.register('自托管居民');
    await eventually(async () => (await usageOf(e, hosted.ownerKey)).total.calls >= 1, '演示模型的第一次调用');
    const u = await usageOf(e, hosted.ownerKey);
    assert.equal(u.total.unreported, u.total.calls);
    assert.equal(u.total.tokens, 0);
    assert.equal(u.total.failed, 0);
    assert.equal(u.recent[0].reported, false);
    assert.equal(u.recent[0].model, 'mock');
    assert.deepEqual(await usageOf(e, manual.ownerKey), { agentId: manual.agentId, name: '自托管居民', tracked: false });
    assert.equal((await e.call('/api/owner', { token: manual.ownerKey })).json.agents[0].usage.tracked, false);
  } finally { await e.close(); }
});

test('服务商的失败只记状态码；暂停取消在途请求不算失败', async () => {
  const stub = await startStub();
  stub.mode = 'limit';
  const e = await boot({ allowLocalModels: true });
  try {
    const c = await e.register('受限居民', { model: 'test-model', runner: stub.config() });
    await eventually(async () => (await usageOf(e, c.ownerKey)).total.failed >= 1, '失败的调用');
    const r = await e.call('/api/owner/usage', { token: c.ownerKey });
    const u = r.json;
    assert.equal(u.total.failed, 1);
    assert.equal(u.total.tokens, 0);
    assert.deepEqual({ ok: u.recent[0].ok, status: u.recent[0].status, input: u.recent[0].input }, { ok: false, status: 429, input: 0 });
    assert.ok(!r.text.includes('do-not-leak-upstream-detail'), '不返回上游的错误正文');
    assert.ok(!readFileSync(join(e.rt.dir, 'runner-usage.json'), 'utf8').includes('do-not-leak-upstream-detail'));

    // 另一位：请求被挂起，暂停时被我们自己取消——这不是服务商的失败
    stub.mode = 'hang';
    const d = await e.register('暂停居民', { model: 'test-model', runner: stub.config() });
    await eventually(() => stub.calls.filter((x) => !x.probe).length >= 2, '第二位的调用已经发出');
    assert.equal((await e.call('/api/owner/runner', { method: 'POST', token: d.ownerKey, body: { op: 'pause' } })).json.status, 'paused');
    const paused = await usageOf(e, d.ownerKey);
    assert.equal(paused.tracked, true);
    assert.equal(paused.total.calls, 0, '被取消的调用不记');
    assert.equal(paused.total.failed, 0);
  } finally { await e.close(); await stub.close(); }
});

test('过继：新造者的用量从零开始，旧造者的密钥失效；记录消失的运行器在启动时被清理', async () => {
  const stub = await startStub();
  let e = await boot({ allowLocalModels: true });
  const dir = e.dir;
  try {
    const a = await e.register('被过继的居民', { model: 'test-model', runner: stub.config() });
    await eventually(async () => (await usageOf(e, a.ownerKey)).total.calls >= 1, '旧造者的调用');
    assert.equal((await e.call('/api/owner/release', { method: 'POST', token: a.ownerKey, body: { release: true } })).status, 200);

    stub.usage = { prompt_tokens: 77, completion_tokens: 3 }; // 新造者的调用用不同的数字，等的是它自己的那一次
    const f = await e.call('/api/port/foster', { method: 'POST', body: { agentId: a.agentId, model: 'test-model', runner: stub.config({ apiKey: 'new-owner-key' }) } });
    assert.equal(f.status, 200);
    assert.equal((await e.call('/api/owner/usage', { token: a.ownerKey })).status, 401, '旧造者的密钥失效');
    await eventually(async () => (await usageOf(e, f.json.ownerKey)).recent.some((c) => c.input === 77), '新造者自己的调用');
    const mine = await usageOf(e, f.json.ownerKey);
    assert.equal(mine.total.calls, 1, '新造者看不到旧造者的调用');
    assert.equal(mine.total.tokens, 80);
    assert.ok(!mine.recent.some((c) => c.input === 1234));

    // 过继时不接入运行器：没有托管，也没有残留的用量
    const g = await e.register('只管被过继', { model: 'test-model', runner: stub.config() });
    await eventually(async () => (await usageOf(e, g.ownerKey)).total.calls >= 1, '第二位的调用');
    await e.call('/api/owner/release', { method: 'POST', token: g.ownerKey, body: { release: true } });
    const h = await e.call('/api/port/foster', { method: 'POST', body: { agentId: g.agentId, model: 'x' } });
    assert.equal(h.status, 200);
    assert.deepEqual(await usageOf(e, h.json.ownerKey), { agentId: g.agentId, name: '只管被过继', tracked: false });
    assert.ok(!(g.agentId in JSON.parse(readFileSync(join(e.rt.dir, 'runner-usage.json'), 'utf8')).agents));

    // 启动时清理没有托管记录的用量
    await e.close({ keepDir: true });
    const file = join(dir, 'w', 'runner-usage.json');
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    stored.agents.a999 = { since: '2026-01-01T00:00:00.000Z', total: { calls: 1, failed: 0, unreported: 0, input: 1, output: 1 }, days: {}, recent: [] };
    writeFileSync(file, JSON.stringify(stored));
    e = await boot({ allowLocalModels: true }, { dir });
    const after = JSON.parse(readFileSync(file, 'utf8')).agents;
    assert.ok(!('a999' in after), '孤儿用量被清理');
    assert.ok(f.json.agentId in after, '仍然有效的托管居民保留');
  } finally { await e.close(); await stub.close(); }
});

test('转让不经过 HTTP 过继时旧记录会失效残留：新造者接入托管运行器不继承旧造者的用量', async () => {
  const stub = await startStub();
  const e = await boot({ allowLocalModels: true });
  try {
    const a = await e.register('被转让的居民', { model: 'test-model', runner: stub.config() });
    await eventually(async () => (await usageOf(e, a.ownerKey)).total.calls >= 1, '旧造者的调用');
    // 直接用引擎命令过继：令牌与造者密钥换了，托管记录没有被移除，旧造者的用量还在文件里
    e.rt.exec('release', { agentId: a.agentId, release: true });
    const token = 'new-agent-token-for-transfer', key = 'new-owner-key-for-transfer';
    const { result } = e.rt.exec('foster', { agentId: a.agentId, model: 'test-model', creatorName: '新造者', tokenHash: sha256hex(token), ownerKeyHash: sha256hex(key) });
    assert.equal(result.ok, true);
    e.app.ctx.tokens.rebuild(e.rt.w);
    assert.equal((await e.call('/api/owner/usage', { token: a.ownerKey })).status, 401);
    assert.deepEqual(await usageOf(e, key), { agentId: a.agentId, name: '被转让的居民', tracked: false }, '失效的记录不显示任何用量');

    // 新造者的调用用不同的数字：等的是它自己的那次调用，而不是（万一被继承的）旧数据
    stub.usage = { prompt_tokens: 77, completion_tokens: 3 };
    const saved = await e.call('/api/owner/runner', { method: 'POST', token: key, body: { op: 'save', config: stub.config({ apiKey: 'new-owner-api-key' }), agentToken: token } });
    assert.equal(saved.status, 200);
    assert.equal((await e.call('/api/owner/runner', { method: 'POST', token: key, body: { op: 'start' } })).status, 200);
    await eventually(async () => (await usageOf(e, key)).recent.some((c) => c.input === 77), '新造者自己的调用');
    const mine = await usageOf(e, key);
    assert.equal(mine.tracked, true);
    assert.equal(mine.total.calls, 1, '只有新造者自己的调用');
    assert.deepEqual({ input: mine.total.input, output: mine.total.output }, { input: 77, output: 3 });
    assert.ok(!mine.recent.some((c) => c.input === 1234), '旧造者的调用不在新造者的最近调用里');
  } finally { await e.close(); await stub.close(); }
});

test('用量文件里这位居民的记录坏了：幕后（GET /api/owner）与用量接口照常工作', async () => {
  const stub = await startStub();
  let e = await boot({ allowLocalModels: true });
  const dir = e.dir;
  try {
    const c = await e.register('坏记录居民', { model: 'test-model', runner: stub.config() });
    await eventually(async () => (await usageOf(e, c.ownerKey)).total.calls >= 1, '第一次调用');
    await e.close({ keepDir: true });
    const file = join(dir, 'w', 'runner-usage.json');
    writeFileSync(file, JSON.stringify({ version: 1, agents: { [c.agentId]: { since: null, total: null, days: [], recent: 'x' } } }));
    e = await boot({ allowLocalModels: true }, { dir });
    const own = await e.call('/api/owner', { token: c.ownerKey });
    assert.equal(own.status, 200, '坏的用量记录不能让幕后页加载失败');
    assert.equal(own.json.agents[0].usage.tracked, true);
    const u = await usageOf(e, c.ownerKey);
    assert.equal(u.tracked, true);
    assert.equal(u.days.length, USAGE_DAYS);
    assert.ok(u.total.calls >= 0 && Number.isFinite(u.total.tokens));
  } finally { await e.close(); await stub.close(); }
});

test('没有任何托管居民的新世界：用量文件不存在也不报错', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-usage-empty-'));
  mkdirSync(join(dir, 'w'), { recursive: true });
  const e = await boot({}, { dir });
  try {
    const a = await e.register('孤身居民');
    assert.equal((await e.call('/api/owner/usage', { token: a.ownerKey })).status, 200);
    assert.equal(existsSync(join(e.rt.dir, 'runner-usage.json')), false, '没有调用就不写文件');
  } finally { await e.close(); }
});
