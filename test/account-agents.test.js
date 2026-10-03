// 账号与居民的只读关联，以及管理员的托管用量总览（docs/plans/2026-10-03-usage-accounts-admin.md）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from './http-helpers.js';
import { AccountStore, MAX_LINKS, publicUser } from '../src/accounts/store.js';
import { replayDir } from '../src/tools/replay.js';
import { eventually, startStub } from './model-stub.js';

const pass = 'a-long-test-password';
const person = (username, extra = {}) => ({ username, displayName: `User ${username}`, password: pass, ...extra });
const mock = { provider: 'mock', model: 'mock', historyRounds: 2, actEveryTicks: 1 };

/** 带 Cookie 的客户端（登录状态跟着走），写请求带上账号体系要求的头 */
function client(e) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async call(path, body, method = body === undefined ? 'GET' : 'POST', extra = {}) {
      const r = await e.call(path, { method, body, headers: { Cookie: cookie, 'X-Houren-Request': '1', ...extra } });
      if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
      return r;
    },
  };
}

/** 一座有假模型接口的世界，加两个已登录的账号 alice 与 bob */
async function setup(extra = {}) {
  const stub = await startStub();
  const e = await boot({ allowLocalModels: true, ...extra });
  const alice = client(e), bob = client(e);
  const a = await alice.call('/api/account/register', person('alice'));
  const b = await bob.call('/api/account/register', person('bob'));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  return { e, stub, alice, bob, aliceId: a.json.user.id, bobId: b.json.user.id, close: async () => { await e.close(); await stub.close(); } };
}
const usageOf = async (e, key) => (await e.call('/api/owner/usage', { token: key })).json;

// ── 存储 ──────────────────────────────────────────────────────

test('AccountStore：关联幂等、令牌哈希变了就刷新、按世界分开、多账号可关联同一居民、有上限，落盘且不影响会话与公开字段', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-links-'));
  try {
    const s = new AccountStore(dir);
    const alice = await s.create(person('alice')), bob = await s.create(person('bob'));
    const session = s.issue(alice.id);

    assert.equal(s.linkAgent(alice.id, { world: 'w1', agentId: 'a1', token: 't1' }), true);
    assert.equal(s.linkAgent(alice.id, { world: 'w1', agentId: 'a1', token: 't1' }), false, '重复关联是幂等的');
    assert.equal(s.linkAgent(alice.id, { world: 'w1', agentId: 'a1', token: 't2' }), false, '令牌哈希变了只刷新，不新增');
    assert.deepEqual(s.linksOf(alice.id, 'w1').map((l) => [l.agentId, l.token]), [['a1', 't2']]);
    assert.ok(Number.isFinite(Date.parse(s.linksOf(alice.id, 'w1')[0].at)));
    s.linkAgent(alice.id, { world: 'w2', agentId: 'a1', token: 'x' }); // 另一个世界里同名的 id
    assert.equal(s.linksOf(alice.id, 'w1').length, 1);
    assert.equal(s.linksOf(alice.id, 'w2').length, 1);
    assert.deepEqual(s.linksOf('no-such-user', 'w1'), []);
    assert.throws(() => s.linkAgent('no-such-user', { world: 'w1', agentId: 'a1', token: 't' }), (e) => e.status === 404);

    s.linkAgent(bob.id, { world: 'w1', agentId: 'a1', token: 't2' }); // 多个账号
    assert.deepEqual(s.linkIndex('w1').get('a1').map((x) => x.username).sort(), ['alice', 'bob']);
    assert.equal(s.linkIndex('w3').size, 0);

    assert.ok(s.session(session), '关联不改账号版本，会话照常有效');
    assert.ok(!JSON.stringify(publicUser(s.get(alice.id))).includes('agents'), '公开字段里没有关联');
    assert.equal(statSync(join(dir, 'accounts.json')).mode & 0o777, 0o600);
    assert.equal(new AccountStore(dir).linksOf(alice.id, 'w1').length, 1, '重启后还在');

    assert.equal(s.unlinkAgents(alice.id, 'w1', ['a1', 'nope']), 1);
    assert.equal(s.unlinkAgents(alice.id, 'w1', ['a1']), 0);
    assert.equal(s.linksOf(alice.id, 'w2').length, 1, '别的世界不受影响');
    assert.equal(s.linksOf(bob.id, 'w1').length, 1, '别的账号不受影响');

    for (let i = 1; i < MAX_LINKS; i++) s.linkAgent(bob.id, { world: 'w1', agentId: `x${i}`, token: 't' });
    assert.equal(s.linksOf(bob.id, 'w1').length, MAX_LINKS);
    assert.throws(() => s.linkAgent(bob.id, { world: 'w1', agentId: 'one-too-many', token: 't' }), (e) => e.status === 409 && e.code === 'too_many_agents');
    assert.equal(s.linkAgent(bob.id, { world: 'w1', agentId: 'a1', token: 'refreshed' }), false, '满额时已有的仍可刷新');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AccountStore：旧账号文件没有 agents 照常读；文件里形状不对的关联被忽略，不会抛错', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-links-bad-'));
  try {
    const seed = new AccountStore(dir);
    const alice = await seed.create(person('alice')), bob = await seed.create(person('bob')), carol = await seed.create(person('carol'));
    assert.equal(seed.linksOf(alice.id, 'w').length, 0, '没有 agents 字段');
    const file = join(dir, 'accounts.json');
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    raw.users.find((u) => u.id === alice.id).agents = [null, 5, 'x', { world: 1 }, { world: 'w', agentId: 'a9' }, { world: 'w', agentId: 'a1', token: 't' }];
    raw.users.find((u) => u.id === bob.id).agents = 'not an array';
    raw.users.find((u) => u.id === carol.id).agents = { world: 'w' };
    writeFileSync(file, JSON.stringify(raw));
    const s = new AccountStore(dir);
    assert.deepEqual(s.linksOf(alice.id, 'w').map((l) => l.agentId), ['a1']);
    assert.deepEqual(s.linksOf(bob.id, 'w'), []);
    assert.deepEqual(s.linkIndex('w').get('a1').map((x) => x.username), ['alice']);
    assert.equal(s.linkAgent(bob.id, { world: 'w', agentId: 'a2', token: 't' }), true, '坏的字段被换成数组');
    assert.equal(s.linkAgent(carol.id, { world: 'w', agentId: 'a3', token: 't' }), true);
    assert.equal(s.unlinkAgents(alice.id, 'w', ['a1']), 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── 认领、列表、解除 ──────────────────────────────────────────

test('认领：用造者密钥关联；只读；幂等；批量按顺序返回；解除只影响自己；账号会话不能当造者密钥用', async () => {
  const { e, stub, alice, bob, close } = await setup();
  try {
    const hosted = await e.register('托管甲', { model: 'test-model', runner: stub.config() });
    const manual = await e.register('自托管乙');
    await eventually(async () => (await usageOf(e, hosted.ownerKey)).total.calls >= 1, '托管甲的第一次调用');

    // 未登录、缺 CSRF 头、内容类型不对
    const anon = client(e);
    assert.equal((await anon.call('/api/account/agents')).status, 401);
    assert.equal((await anon.call('/api/account/agents', { ownerKey: hosted.ownerKey })).status, 401);
    assert.equal((await e.call('/api/account/agents', { method: 'POST', body: { ownerKey: hosted.ownerKey }, headers: { Cookie: alice.cookie } })).status, 403, '缺 X-Houren-Request');
    assert.equal((await e.call('/api/account/agents/x', { method: 'DELETE', headers: { Cookie: alice.cookie, 'X-Houren-Request': '1' } })).status, 415, '写请求必须是 JSON');

    assert.deepEqual((await alice.call('/api/account/agents')).json, { agents: [] });
    const claim = await alice.call('/api/account/agents', { ownerKey: hosted.ownerKey });
    assert.equal(claim.status, 200);
    assert.deepEqual(claim.json, { results: [{ ok: true, agentId: hosted.agentId, name: '托管甲' }] });
    assert.ok(!claim.text.includes(hosted.ownerKey), '响应里不回显密钥');

    const [row] = (await alice.call('/api/account/agents')).json.agents;
    assert.equal(row.agentId, hosted.agentId);
    assert.equal(row.name, '托管甲');
    assert.equal(row.status, 'awake');
    assert.notEqual(row.runnerStatus, 'unconfigured');
    assert.ok(Number.isFinite(Date.parse(row.linkedAt)));
    assert.equal(row.usage.tracked, true);
    assert.deepEqual(row.usage.total, { calls: 1, failed: 0, unreported: 0, input: 1234, output: 56, tokens: 1290 });
    const { agentId: _id, name: _name, ...ownerSees } = await usageOf(e, hosted.ownerKey);
    assert.deepEqual(row.usage, ownerSees, '账号看到的用量与造者看到的是同一份');

    // 幂等；错的密钥、agent 令牌、带空白的密钥；一次请求里的顺序
    assert.equal((await alice.call('/api/account/agents', { ownerKey: hosted.ownerKey })).json.results[0].ok, true);
    assert.equal((await alice.call('/api/account/agents')).json.agents.length, 1);
    const batch = await alice.call('/api/account/agents', { ownerKeys: ['nope', manual.ownerKey, hosted.agentToken, `  ${hosted.ownerKey}  `] });
    assert.deepEqual(batch.json.results.map((r) => r.ok), [false, true, false, true]);
    assert.deepEqual([batch.json.results[0].code, batch.json.results[2].code], ['not_found', 'not_found'], 'agent 令牌不是造者密钥');
    assert.equal(batch.json.results[1].agentId, manual.agentId);
    const rows = (await alice.call('/api/account/agents')).json.agents;
    assert.deepEqual(rows.map((r) => r.agentId), [hosted.agentId, manual.agentId]);
    assert.deepEqual(rows[1].usage, { tracked: false }, '自托管的居民没有用量');
    for (const bad of [{}, { ownerKey: 5 }, { ownerKey: '' }, { ownerKey: '   ' }, { ownerKeys: [] }, { ownerKeys: 'x' }, { ownerKeys: Array(51).fill('k') }, { ownerKeys: [1] }, { ownerKeys: ['k'.repeat(201)] }]) {
      assert.equal((await alice.call('/api/account/agents', bad)).status, 400, JSON.stringify(bad).slice(0, 40));
    }

    // 只读：账号会话不是造者的凭据
    for (const path of ['/api/owner', '/api/owner/usage', '/api/owner/runner']) assert.equal((await e.call(path, { headers: { Cookie: alice.cookie } })).status, 401, path);
    assert.equal((await e.call('/api/owner/release', { method: 'POST', body: { release: true }, headers: { Cookie: alice.cookie, 'X-Houren-Request': '1' } })).status, 401);

    // 别的账号看不到；多个账号可以关联同一位居民；解除只影响自己
    assert.deepEqual((await bob.call('/api/account/agents')).json, { agents: [] });
    assert.equal((await bob.call('/api/account/agents', { ownerKey: hosted.ownerKey })).json.results[0].ok, true);
    assert.equal((await alice.call(`/api/account/agents/${hosted.agentId}`, {}, 'DELETE')).status, 200);
    assert.deepEqual((await alice.call('/api/account/agents')).json.agents.map((r) => r.agentId), [manual.agentId]);
    assert.deepEqual((await bob.call('/api/account/agents')).json.agents.map((r) => r.agentId), [hosted.agentId]);
    assert.equal((await alice.call('/api/account/agents/a999', {}, 'DELETE')).status, 200, '解除没有关联的也行');
  } finally { await close(); }
});

test('认领接口限速：每个账号每 15 分钟 20 次请求，别的账号不受影响', async () => {
  const { e, alice, bob, close } = await setup();
  try {
    for (let i = 0; i < 20; i++) assert.equal((await alice.call('/api/account/agents', { ownerKey: 'nope' })).status, 200);
    assert.equal((await alice.call('/api/account/agents', { ownerKey: 'nope' })).status, 429);
    assert.equal((await bob.call('/api/account/agents', { ownerKey: 'nope' })).status, 200);
    assert.equal((await alice.call('/api/account/agents')).status, 200, '只限认领，不限查看');
  } finally { await close(); }
});

// ── 入境自动关联 ──────────────────────────────────────────────

test('登录状态下入境（注册、过继）自动关联；没有登录会话时响应不变；过继后旧主人的关联失效；关联失败不影响入境；不进世界', async () => {
  const { e, stub, alice, bob, aliceId, bobId, close } = await setup();
  try {
    const r = await alice.call('/api/port/register', { name: '登录入境', soul: '居民', model: 'test-model', runner: stub.config() });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.account, { linked: true });
    assert.deepEqual((await alice.call('/api/account/agents')).json.agents.map((a) => a.agentId), [r.json.agentId]);

    const guest = await e.register('游客入境');
    assert.ok(!('account' in guest), '没有登录会话时响应与以前一致');
    assert.equal((await alice.call('/api/account/agents')).json.agents.length, 1);

    // 过继：alice 交付，bob（已登录）过继
    assert.equal((await e.call('/api/owner/release', { method: 'POST', token: r.json.ownerKey, body: { release: true } })).status, 200);
    const f = await bob.call('/api/port/foster', { agentId: r.json.agentId, model: 'test-model' });
    assert.equal(f.status, 200);
    assert.deepEqual(f.json.account, { linked: true });
    assert.deepEqual((await alice.call('/api/account/agents')).json.agents, [], '令牌换了：旧主人账号里的关联失效');
    assert.equal(e.app.ctx.accounts.linksOf(aliceId, e.rt.w.id).length, 0, '失效的关联顺带清掉');
    assert.deepEqual((await bob.call('/api/account/agents')).json.agents.map((a) => a.agentId), [r.json.agentId]);

    // 管理员重置造者密钥：令牌不变，关联保留
    const reset = await e.call(`/api/admin/agents/${r.json.agentId}/owner-key`, { method: 'POST', admin: true, body: {} });
    assert.equal(reset.status, 200);
    assert.deepEqual((await bob.call('/api/account/agents')).json.agents.map((a) => a.agentId), [r.json.agentId]);
    assert.equal((await bob.call('/api/account/agents', { ownerKey: f.json.ownerKey })).json.results[0].ok, false, '旧密钥已被重置作废');
    assert.equal((await bob.call('/api/account/agents', { ownerKey: reset.json.ownerKey })).json.results[0].ok, true);

    // 关联失败（账号已满）不影响入境：居民与一次性凭据照常返回
    for (let i = 0; e.app.ctx.accounts.linksOf(bobId, e.rt.w.id).length < MAX_LINKS; i++) e.app.ctx.accounts.linkAgent(bobId, { world: e.rt.w.id, agentId: `filler${i}`, token: 't' });
    const full = await bob.call('/api/port/register', { name: '关联已满', soul: '居民', model: 'x' });
    assert.equal(full.status, 201);
    assert.deepEqual(full.json.account, { linked: false });
    assert.ok(full.json.agentToken && full.json.ownerKey && full.json.agentId);

    // 关联只在账号文件里：不进命令日志、快照与事件，回放不变
    e.rt.snapshot();
    for (const name of ['commands.jsonl', 'snapshot.json', 'events.jsonl']) {
      let text = '';
      try { text = readFileSync(join(e.rt.dir, name), 'utf8'); } catch { /* 没有这个文件 */ }
      assert.ok(!text.includes(aliceId) && !text.includes(bobId), `${name} 里不该有账号信息`);
    }
    assert.equal(replayDir(e.rt.dir).ok, true);
  } finally { await close(); }
});

test('登录状态下领养：自动关联', async () => {
  const { e, alice, close } = await setup({ inviteCode: 'test-invite' });
  try {
    const a = await e.register('父甲', { invite: 'test-invite' });
    const b = await e.register('父乙', { invite: 'test-invite' });
    for (const x of [a, b]) { e.rt.w.agents[x.agentId].place = 'school'; e.rt.w.agents[x.agentId].energy = 100; }
    e.rt.exec('act', { agentId: a.agentId, actions: [{ type: 'conceive', with: b.agentId, name: '领养验证', soul: '好奇的居民', lang: 'zh' }] });
    assert.equal(e.rt.exec('act', { agentId: b.agentId, actions: [{ type: 'consent', pact: 'c1' }] }).result.results[0].ok, true);
    const adopted = await alice.call('/api/port/adopt', { soulId: 's1', model: 'mock', runner: mock, invite: 'test-invite' });
    assert.equal(adopted.status, 201);
    assert.deepEqual(adopted.json.account, { linked: true });
    const rows = (await alice.call('/api/account/agents')).json.agents;
    assert.deepEqual(rows.map((r) => [r.agentId, r.name]), [[adopted.json.agentId, '领养验证']]);
  } finally { await close(); }
});

// ── 管理员总视图 ──────────────────────────────────────────────

test('管理员总视图：X-Admin-Key 或管理员账号都行，普通用户不行；按今日用量排序，标出关联的账号，过继后不再算；不泄露密钥', async () => {
  const { e, stub, alice, close } = await setup();
  const admin = client(e);
  try {
    // 鉴权
    assert.equal((await e.call('/api/admin/usage')).status, 401);
    assert.equal((await e.call('/api/admin/usage', { admin: 'wrong' })).status, 401);
    assert.equal((await alice.call('/api/admin/usage')).status, 401, '普通用户的会话不行');
    assert.equal((await admin.call('/api/account/setup', person('chief', { adminKey: e.cfg.adminKey }))).status, 201);
    assert.equal((await admin.call('/api/admin/usage')).status, 200, '管理员账号');
    assert.equal((await e.call('/api/admin/usage', { admin: true })).status, 200, 'X-Admin-Key');
    assert.equal((await e.call('/api/admin/usage', { method: 'POST', admin: true, body: {} })).status, 404, '只读');

    // 空的世界
    const empty = (await e.call('/api/admin/usage', { admin: true })).json;
    assert.deepEqual([empty.hosted, empty.unhosted, empty.agents.length, empty.total.tokens, empty.days.length], [0, 0, 0, 0, 14]);

    // 三位托管（用不同的数字，逐个等到各自的第一次调用）、一位自托管。
    // 注册的顺序故意与「今日用量从多到少」相反：丙（0）→ 甲（1290）→ 乙（80），不排序就会露馅
    const C = await e.register('丙', { model: 'mock', runner: mock });
    await eventually(async () => (await usageOf(e, C.ownerKey)).total.calls >= 1, '丙的调用');
    const A = await e.register('甲', { model: 'test-model', runner: stub.config() });
    await eventually(async () => (await usageOf(e, A.ownerKey)).total.calls >= 1, '甲的调用');
    stub.usage = { prompt_tokens: 77, completion_tokens: 3 };
    const B = await e.register('乙', { model: 'test-model', runner: stub.config() });
    await eventually(async () => (await usageOf(e, B.ownerKey)).total.calls >= 1, '乙的调用');
    const D = await e.register('丁');
    assert.equal((await alice.call('/api/account/agents', { ownerKey: A.ownerKey })).json.results[0].ok, true);

    const viaKey = await e.call('/api/admin/usage', { admin: true });
    const o = viaKey.json;
    assert.equal(o.timezone, 'Asia/Shanghai');
    assert.equal(o.hosted, 3);
    assert.equal(o.unhosted, 1, '丁在世但没有托管运行器');
    assert.deepEqual(o.agents.map((a) => a.name), ['甲', '乙', '丙'], '今日用量从多到少');
    assert.deepEqual(o.total, { calls: 3, failed: 0, unreported: 1, input: 1311, output: 59, tokens: 1370 });
    assert.deepEqual(o.today, o.total);
    assert.equal(o.days.length, 14);
    assert.deepEqual(o.days.at(-1), { day: o.day, ...o.total });
    assert.equal(o.days.slice(0, -1).every((d) => d.tokens === 0), true);
    const [a, b, c] = o.agents;
    assert.deepEqual([a.agentId, a.model, a.status, a.creatorName, a.accounts], [A.agentId, 'test-model', 'awake', 'SECRET-CREATOR-甲', ['alice']]);
    assert.deepEqual([b.accounts, c.accounts], [[], []]);
    assert.equal(c.model, 'mock');
    assert.equal(a.usage.total.tokens, 1290);
    assert.equal(a.usage.today.tokens, 1290);
    assert.equal(typeof a.usage.lastCallAt, 'string');
    assert.equal(typeof a.runnerStatus, 'string');
    assert.equal(c.usage.total.unreported, 1);
    assert.ok(!o.agents.some((x) => x.agentId === D.agentId));
    for (const secret of [A.agentToken, A.ownerKey, B.ownerKey, 'usage-test-api-key', 'passwordHash', pass]) assert.ok(!viaKey.text.includes(secret), '总览里不该有凭据');
    assert.deepEqual((await admin.call('/api/admin/usage')).json, o, '管理员账号与 X-Admin-Key 看到的一样');

    // 过继：A 换了令牌，alice 的关联不再算；新造者接入托管之后从零开始
    assert.equal((await e.call('/api/owner/release', { method: 'POST', token: A.ownerKey, body: { release: true } })).status, 200);
    stub.usage = { prompt_tokens: 5, completion_tokens: 1 };
    const f = await e.call('/api/port/foster', { method: 'POST', body: { agentId: A.agentId, model: 'test-model', runner: stub.config() } });
    assert.equal(f.status, 200);
    await eventually(async () => (await usageOf(e, f.json.ownerKey)).total.calls >= 1, '新造者的调用');
    const after = (await e.call('/api/admin/usage', { admin: true })).json;
    const moved = after.agents.find((x) => x.agentId === A.agentId);
    assert.deepEqual(moved.accounts, [], '令牌换了：旧账号不再标在这位居民名下');
    assert.equal(moved.usage.total.tokens, 6, '用量从零开始');
    assert.equal(after.total.tokens, 80 + 0 + 6);
  } finally { await close(); }
});

test('没有 ADMIN_KEY 的服务器：管理员账号照样能看，别人 404', async () => {
  const e = await boot({ adminKey: null });
  const chief = client(e), nobody = client(e);
  try {
    assert.equal((await e.call('/api/admin/usage')).status, 404);
    assert.equal((await nobody.call('/api/admin/usage')).status, 404);
    await e.app.ctx.accounts.create(person('chief'), { role: 'admin' });
    assert.equal((await chief.call('/api/account/login', person('chief'))).status, 200);
    const r = await chief.call('/api/admin/usage');
    assert.equal(r.status, 200);
    assert.equal(r.json.hosted, 0);
    assert.equal((await e.call('/api/admin/usage', { admin: 'anything' })).status, 404);
  } finally { await e.close(); }
});
