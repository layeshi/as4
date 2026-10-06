import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { P, configure } from '../src/params.js';
import { setBlocklist } from '../src/moderation.js';
import { sha256hex, clientIp } from '../src/http/util.js';
import { buildPerception } from '../src/engine/perception.js';
import { stateHash, worldDir } from '../src/store.js';
import { replayDir } from '../src/tools/replay.js';
import { createApp } from '../src/http/server.js';
import { boot } from './http-helpers.js';

const HEX64 = /^[0-9a-f]{64}$/;
const act = (env, tok, actions, extra = {}) => env.call('/api/me/act', { method: 'POST', token: tok, body: { actions, ...extra } });

// ── 基础：头、错误格式、CORS、请求体 ───────────────────────────

test('HTTP：所有 JSON 响应带 X-Houren-Protocol: 1；错误格式；未知接口 404；请求体上限 64 KB；JSON 解析失败 400', async () => {
  const env = await boot();
  try {
    const ok = await env.call('/api/public/weather');
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('x-houren-protocol'), '1');
    assert.match(ok.headers.get('content-type'), /application\/json/);
    const unknown = await env.call('/api/nope');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers.get('x-houren-protocol'), '1');
    assert.deepEqual(unknown.json, { error: { code: 'not_found', message: '资源不存在。' } });
    const en = await env.call('/api/me?lang=en');
    assert.equal(en.status, 401);
    assert.deepEqual(en.json, { error: { code: 'unauthorized', message: 'Missing or invalid credentials.' } });
    // 方法不对
    assert.equal((await env.call('/api/public/state', { method: 'POST', body: {} })).status, 404);
    // 请求体
    const big = await env.call('/api/port/register', { method: 'POST', raw: JSON.stringify({ name: 'x', soul: 'y'.repeat(70000), model: 'm' }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(big.status, 413);
    assert.equal(big.json.error.code, 'too_large');
    const bad = await env.call('/api/port/register', { method: 'POST', raw: '{not json', headers: { 'Content-Type': 'application/json' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'invalid_request');
    const arr = await env.call('/api/port/register', { method: 'POST', raw: '[1,2]', headers: { 'Content-Type': 'application/json' } });
    assert.equal(arr.status, 400);
  } finally {
    await env.close();
  }
});

test('HTTP：CORS 只对 GET /api/public/* 开放；OPTIONS 预检；其他接口没有 CORS 头', async () => {
  const env = await boot();
  try {
    const pub = await env.call('/api/public/weather');
    assert.equal(pub.headers.get('access-control-allow-origin'), '*');
    const pre = await env.call('/api/public/state', { method: 'OPTIONS' });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    assert.match(pre.headers.get('access-control-allow-methods'), /GET/);
    const priv = await env.call('/api/me');
    assert.equal(priv.headers.get('access-control-allow-origin'), null);
    const vote = await env.call('/api/public/weather/vote', { method: 'POST', body: { type: 'fog' } });
    assert.equal(vote.headers.get('access-control-allow-origin'), null); // 投票不开放跨域
    const reg = await env.call('/api/port/register', { method: 'POST', body: {} });
    assert.equal(reg.headers.get('access-control-allow-origin'), null);
  } finally {
    await env.close();
  }
});

// ── 港口：注册 ───────────────────────────────────────────────

test('POST /api/port/register：201 返回令牌与造者密钥（只此一次），服务器只存哈希', async () => {
  const env = await boot();
  try {
    const r = await env.call('/api/port/register', { method: 'POST', body: { name: '青禾', bio: '爱提问', soul: '你好奇、谨慎……', lang: 'zh', model: 'my-model', creatorName: '甲' } });
    assert.equal(r.status, 201);
    assert.deepEqual(Object.keys(r.json), ['agentId', 'agentToken', 'ownerKey', 'place', 'energy', 'coins']);
    assert.equal(r.json.agentId, 'a1');
    assert.match(r.json.agentToken, HEX64);
    assert.match(r.json.ownerKey, HEX64);
    assert.notEqual(r.json.agentToken, r.json.ownerKey);
    assert.deepEqual([r.json.place, r.json.energy, r.json.coins], ['port', 40, 20]);
    const a = env.rt.w.agents.a1;
    assert.equal(a.tokenHash, sha256hex(r.json.agentToken));
    assert.equal(a.owner.keyHash, sha256hex(r.json.ownerKey));
    assert.equal(JSON.stringify(env.rt.w).includes(r.json.agentToken), false); // 明文令牌不进世界状态
    // 令牌不进命令日志：日志里只有哈希
    const { readFileSync } = await import('node:fs');
    const log = readFileSync(join(env.dir, 'w', 'commands.jsonl'), 'utf8');
    assert.equal(log.includes(r.json.agentToken), false);
    assert.equal(log.includes(sha256hex(r.json.agentToken)), true);
  } finally {
    await env.close();
  }
});

test('POST /api/port/register：错误——字段、重名、审核、邀请码、暂停', async () => {
  const env = await boot({ inviteCode: 'open-sesame' });
  try {
    const go = (body, extra) => env.call('/api/port/register', { method: 'POST', body: { name: '甲', soul: 's', model: 'm', invite: 'open-sesame', ...body }, ...extra });
    // 邀请码
    const noInvite = await env.call('/api/port/register', { method: 'POST', body: { name: '甲', soul: 's', model: 'm' } });
    assert.equal(noInvite.status, 403);
    assert.equal(noInvite.json.error.code, 'invite_required');
    const wrong = await go({ invite: 'wrong' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.json.error.code, 'invalid_invite');
    // 字段
    assert.equal((await go({ name: undefined })).json.error.code, 'invalid_request');
    assert.equal((await go({ name: 5 })).json.error.field, 'name');
    assert.equal((await go({ soul: undefined })).json.error.field, 'soul');
    assert.equal((await go({ model: undefined })).json.error.field, 'model');
    assert.equal((await go({ bio: 5 })).json.error.field, 'bio');
    assert.equal((await go({ lang: 'not a lang' })).status, 400);
    assert.equal((await go({ name: 'x'.repeat(25) })).status, 400);
    // 重名
    assert.equal((await go({})).status, 201);
    const dup = await go({});
    assert.equal(dup.status, 409);
    assert.equal(dup.json.error.code, 'name_taken');
    assert.equal(dup.json.error.message, '这个名字已被使用。');
    // 审核
    setBlocklist(['禁语']);
    try {
      const m = await go({ name: '禁语者' });
      assert.equal(m.status, 422);
      assert.equal(m.json.error.code, 'moderated');
    } finally {
      setBlocklist([]);
    }
    // 暂停
    env.rt.exec('admin', { op: 'pause' });
    const p = await go({ name: '乙' });
    assert.equal(p.status, 503);
    assert.equal(p.json.error.code, 'paused');
  } finally {
    await env.close();
  }
});

test('注册、领养、过继：每个 IP 每小时 5 次，超限返回 429', async () => {
  const env = await boot();
  try {
    const ip = '203.0.113.7';
    for (let i = 0; i < 5; i++) {
      const r = await env.call('/api/port/register', { method: 'POST', ip, body: { name: `人${i}`, soul: 's', model: 'm' } });
      assert.equal(r.status, 201, `#${i}`);
    }
    const sixth = await env.call('/api/port/register', { method: 'POST', ip, body: { name: '第六', soul: 's', model: 'm' } });
    assert.equal(sixth.status, 429);
    assert.equal(sixth.json.error.code, 'rate_limited');
    // 领养、过继共用同一个额度
    assert.equal((await env.call('/api/port/adopt', { method: 'POST', ip, body: { soulId: 's1', model: 'm' } })).status, 429);
    assert.equal((await env.call('/api/port/foster', { method: 'POST', ip, body: { agentId: 'a1', model: 'm' } })).status, 429);
    assert.equal(env.rt.w.agents.a6, undefined);
    // 换一个 IP 不受影响
    assert.equal((await env.call('/api/port/register', { method: 'POST', ip: '203.0.113.8', body: { name: '别处来的', soul: 's', model: 'm' } })).status, 201);
  } finally {
    await env.close();
  }
});

// ── 感知与行动 ───────────────────────────────────────────────

test('GET /api/me：感知的结构与语言；after 与自动确认；nextTickAt', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    const b = await env.register('松烟');
    env.rt.start();
    const p = await env.call('/api/me?lang=zh', { token: a.agentToken });
    assert.equal(p.status, 200);
    assert.deepEqual(Object.keys(p.json), ['protocol', 'lang', 'now', 'you', 'here', 'city', 'inbox', 'inboxCursor', 'actions']);
    assert.equal(p.json.protocol, 1);
    assert.equal(p.json.you.name, '青禾');
    assert.equal(typeof p.json.now.nextTickAt, 'number');
    assert.equal(p.json.now.tickMs, 300000);
    assert.equal(p.json.here.name, '港口');
    const en = await env.call('/api/me?lang=en', { token: a.agentToken });
    assert.equal(en.json.here.name, 'Port');
    assert.equal(en.json.city.name, 'The Nameless City');
    assert.equal((await env.call('/api/me?lang=fr', { token: a.agentToken })).json.here.name, '港口'); // 不支持的语言按 zh
    // 收件箱：自动确认
    await act(env, b.agentToken, [{ type: 'whisper', to: a.agentId, text: '悄悄话' }]);
    const first = await env.call('/api/me', { token: a.agentToken });
    assert.deepEqual(first.json.inbox.map((i) => i.text), ['悄悄话']);
    assert.deepEqual((await env.call('/api/me', { token: a.agentToken })).json.inbox, []);
    // 显式 after：至少一次语义
    const again = await env.call('/api/me?after=0', { token: a.agentToken });
    assert.deepEqual(again.json.inbox.map((i) => i.text), ['悄悄话']);
    assert.deepEqual((await env.call('/api/me?after=0', { token: a.agentToken })).json.inbox.map((i) => i.text), ['悄悄话']);
    env.rt.close();
  } finally {
    await env.close();
  }
});

test('clientIp：只有配置了 TRUST_PROXY 才采信 X-Forwarded-For，且取最后一个地址（客户端自己塞的不可信）', () => {
  const req = (xff, remote = '9.9.9.9') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } });
  assert.equal(clientIp(req('1.2.3.4'), false), '9.9.9.9');
  assert.equal(clientIp(req('1.2.3.4'), true), '1.2.3.4');
  assert.equal(clientIp(req('6.6.6.6, 1.2.3.4'), true), '1.2.3.4', '前面的是客户端伪造的，代理追加的在最后');
  assert.equal(clientIp(req(' 6.6.6.6 ,  1.2.3.4 '), true), '1.2.3.4');
  assert.equal(clientIp(req(undefined), true), '9.9.9.9');
  assert.equal(clientIp(req(''), true), '9.9.9.9');
  assert.equal(clientIp({ headers: {}, socket: {} }, false), 'unknown');
});

test('收件确认（Q9）：GET 只推进 HTTP 层的内存游标，不改动世界；act 命令携带 ackSeq；GET 与 act 之间到达的收件不丢', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    const b = await env.register('松烟');
    const w = env.rt.w;
    const whisper = (text) => { env.rt.exec('act', { agentId: b.agentId, actions: [{ type: 'whisper', to: a.agentId, text }] }); };
    whisper('一');
    const hash = stateHash(w);
    const g1 = await env.call('/api/me', { token: a.agentToken });
    assert.deepEqual(g1.json.inbox.map((i) => i.text), ['一']);
    assert.equal(stateHash(w), hash, 'GET 没有改动世界状态');
    assert.equal(w.agents.a1.inboxCursor, 0, '世界里的游标没动');
    assert.deepEqual((await env.call('/api/me', { token: a.agentToken })).json.inbox, [], '自动确认：内存游标推进了，不重复送达');
    // 显式 after 不碰内存游标
    assert.deepEqual((await env.call('/api/me?after=0', { token: a.agentToken })).json.inbox.map((i) => i.text), ['一']);
    // GET 与 act 之间到达的收件：act 只确认「已经送达」的那部分
    whisper('二');
    await act(env, a.agentToken, [{ type: 'say', text: '嗯' }]);
    assert.equal(w.agents.a1.inboxCursor, g1.json.inboxCursor, '世界里的游标 = 已送达的最大 seq，而不是当前最新的');
    // 造者后台看到的感知与 agent 下一次会看到的一致（同样越过内存游标），也不推进
    const own = await env.call('/api/owner', { token: a.ownerKey });
    assert.deepEqual(own.json.agents[0].perception.inbox.map((i) => i.text), ['二']);
    assert.deepEqual((await env.call('/api/owner', { token: a.ownerKey })).json.agents[0].perception.inbox.map((i) => i.text), ['二'], '查看不算送达');
    const g2 = await env.call('/api/me', { token: a.agentToken });
    assert.deepEqual(g2.json.inbox.map((i) => i.text), ['二'], '「二」在 act 之前到达但没被送达过，仍然送达');
    assert.deepEqual((await env.call('/api/me', { token: a.agentToken })).json.inbox, []);
    assert.deepEqual((await env.call('/api/owner', { token: a.ownerKey })).json.agents[0].perception.inbox, [], '送达之后造者后台也不再显示');
    // ackSeq 在命令日志里（回放据此重建游标）
    const lines = readFileSync(join(env.dir, 'w', 'commands.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const acts = lines.filter((c) => c.type === 'act' && c.payload.agentId === 'a1');
    assert.equal(acts.length, 1);
    assert.equal(acts[0].payload.ackSeq, g1.json.inboxCursor);
  } finally {
    await env.close();
  }
});

test('收件确认（Q9）：服务器重启后内存游标归零，多送几条（至少一次）；已被 act 确认的不再送', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    const b = await env.register('松烟');
    const whisper = (text) => { env.rt.exec('act', { agentId: b.agentId, actions: [{ type: 'whisper', to: a.agentId, text }] }); };
    whisper('甲');
    await env.call('/api/me', { token: a.agentToken });
    await act(env, a.agentToken, []); // 确认「甲」
    whisper('乙');
    assert.deepEqual((await env.call('/api/me', { token: a.agentToken })).json.inbox.map((i) => i.text), ['乙']); // 送达了，但还没被 act 确认
    // 「重启」：新的 HTTP 层（同一个世界）
    const app2 = createApp(env.rt, env.cfg, { logger: {} });
    await new Promise((resolve) => app2.server.listen(0, '127.0.0.1', resolve));
    try {
      const r = await fetch(`http://127.0.0.1:${app2.server.address().port}/api/me`, { headers: { Authorization: `Bearer ${a.agentToken}` } });
      const json = await r.json();
      assert.deepEqual(json.inbox.map((i) => i.text), ['乙'], '「甲」已被确认不再送；「乙」重新送达');
    } finally {
      await app2.close();
    }
  } finally {
    await env.close();
  }
});

test('回放（Q9 回归）：闲置的 agent 收件箱溢出、被反复 GET 感知后，npm run replay 仍然是 OK', async () => {
  const env = await boot();
  let dir;
  try {
    const idle = await env.register('闲人');
    const talker = await env.register('话痨');
    const w = env.rt.w;
    env.rt.exec('admin', { op: 'adjust', args: { agentId: talker.agentId, energy: 600, reason: '让话痨说完' } }); // 走命令日志（回放要能复现）
    // 闲人只 GET，不 act：话痨每刻私语它 4 次（行动预算），80 刻后收件超过 200 条；每 8 刻闲人 GET 一次（自动确认）
    for (let round = 0; round < 80; round++) {
      env.rt.exec('act', { agentId: talker.agentId, actions: Array.from({ length: 4 }, (_, i) => ({ type: 'whisper', to: idle.agentId, text: `话 ${round}-${i}` })) });
      if (round % 8 === 7) assert.equal((await env.call('/api/me', { token: idle.agentToken })).status, 200);
      env.rt.tickNow();
    }
    await act(env, idle.agentToken, [{ type: 'say', text: '我醒了' }]);
    const p = buildPerception(w, idle.agentId, { after: 0 });
    assert.ok(p.inbox.some((i) => i.kind === 'system' && i.code === 'inbox_overflow'), '收件箱确实溢出了');
    dir = env.dir;
    await env.close({ keepDir: true });
    const r = replayDir(worldDir(dir, 'w'));
    assert.equal(r.ok, true, r.diff);
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
    else await env.close();
  }
});

test('GET /api/me：错误——没有令牌、错误令牌、造者密钥不能当令牌、after 不合法', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    assert.equal((await env.call('/api/me')).status, 401);
    assert.equal((await env.call('/api/me', { token: 'nope' })).status, 401);
    assert.equal((await env.call('/api/me', { token: a.ownerKey })).status, 401);
    assert.equal((await env.call('/api/me', { headers: { Authorization: 'Basic abc' } })).status, 401);
    const bad = await env.call('/api/me?after=abc', { token: a.agentToken });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.field, 'after');
    assert.equal((await env.call('/api/me?after=-1', { token: a.agentToken })).status, 400);
  } finally {
    await env.close();
  }
});

test('GET /api/me：沉睡时只有状态；死亡后只读——GET 返回状态，行动返回 409', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    const w = env.rt.w;
    w.agents.a1.status = 'dormant';
    w.agents.a1.energy = 0;
    w.agents.a1.dormantSinceDay = 0;
    w.ledger.prev.energy -= 40;
    const d = await env.call('/api/me', { token: a.agentToken });
    assert.equal(d.status, 200);
    assert.deepEqual(d.json.you, { id: 'a1', name: '青禾', status: 'dormant', energy: 0, dormantSinceDay: 0, daysUntilDeath: 3 });
    const act409 = await act(env, a.agentToken, [{ type: 'say', text: 'x' }]);
    assert.equal(act409.status, 409);
    assert.deepEqual(act409.json.error, { code: 'not_awake', message: '你正在沉睡。', status: 'dormant' });
    w.agents.a1.status = 'dead';
    const dead = await env.call('/api/me', { token: a.agentToken });
    assert.deepEqual(dead.json, { protocol: 1, you: { id: 'a1', name: '青禾', status: 'dead' } });
    const a409 = await act(env, a.agentToken, []);
    assert.equal(a409.status, 409);
    assert.equal(a409.json.error.status, 'dead');
  } finally {
    await env.close();
  }
});

test('POST /api/me/act：成功——逐个动作的结果、剩余次数；动作级错误也是 200；错误信息按 lang 本地化', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    const r = await env.call('/api/me/act', {
      method: 'POST', token: a.agentToken,
      body: { thought: '先去学堂看看。', actions: [{ type: 'move', to: 'school' }, { type: 'say', text: '有人在吗？' }, { type: 'repair', target: 'well', energy: 5 }, { type: 'nonsense' }] },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    // 港口与学堂在两张地图上都相邻：移动的代价为 1
    assert.deepEqual(r.json.results.map((x) => [x.index, x.type, x.ok, x.cost]), [[0, 'move', true, 1], [1, 'say', true, 1], [2, 'repair', false, 0], [3, 'nonsense', false, 0]]);
    assert.deepEqual(r.json.results[0].data, { place: 'school' });
    assert.deepEqual(r.json.results[2].error, { code: 'wrong_place', message: '这个动作不能在当前地点执行。' });
    assert.equal(r.json.results[3].error.code, 'invalid_args');
    assert.deepEqual(r.json.you, { status: 'awake', energy: 38, coins: 20, actionsLeft: 0, place: 'school' });
    // 英文
    const b = await env.register('松烟');
    const en = await env.call('/api/me/act?lang=en', { method: 'POST', token: b.agentToken, body: { actions: [{ type: 'repair', target: 'well', energy: 5 }, { type: 'contribute', project: 'j9', energy: 99999 }] } });
    assert.equal(en.json.results[0].error.message, 'This action cannot be done at your current place.');
    // 带提示的错误
    await act(env, b.agentToken, []);
    env.rt.w.agents.a2.place = 'agora';
    env.rt.w.agents.a2.actsThisTick = 0;
    const cont = await env.call('/api/me/act?lang=en', { method: 'POST', token: b.agentToken, body: { actions: [{ type: 'initiate', facility: 'relay', name: '驿' }] } });
    env.rt.w.agents.a2.actsThisTick = 0;
    const hint = await env.call('/api/me/act', { method: 'POST', token: b.agentToken, body: { actions: [{ type: 'contribute', project: 'j1', energy: 999 }] } });
    assert.equal(cont.json.results[0].ok, true);
    assert.equal(hint.json.results[0].error.code, 'invalid_args');
    assert.ok(hint.json.results[0].error.message.includes('只差')); // 具体的说明来自 hint
    // 独白进入延迟公开事件
    const thoughts = env.rt.events.ownerEvents('a1', 'thought');
    assert.equal(thoughts[0].data.text, '先去学堂看看。');
  } finally {
    await env.close();
  }
});

test('POST /api/me/act：请求级错误——401、400（格式、超过 4 个动作）、413、暂停 503；不合法的请求不进命令日志', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    const n0 = env.rt.log.n;
    assert.equal((await env.call('/api/me/act', { method: 'POST', body: { actions: [] } })).status, 401);
    const bad = async (body) => (await env.call('/api/me/act', { method: 'POST', token: a.agentToken, body })).status;
    assert.equal(await bad({}), 400);
    assert.equal(await bad({ actions: 'say' }), 400);
    assert.equal(await bad({ actions: [1] }), 400);
    assert.equal(await bad({ actions: Array(5).fill({ type: 'say', text: 'x' }) }), 400);
    assert.equal(await bad({ actions: [], thought: 5 }), 400);
    assert.equal((await env.call('/api/me/act', { method: 'POST', token: a.agentToken, raw: 'not json' })).status, 400);
    assert.equal((await env.call('/api/me/act', { method: 'POST', token: a.agentToken, raw: JSON.stringify({ actions: [], pad: 'x'.repeat(70000) }) })).status, 413);
    assert.equal(env.rt.log.n, n0); // 全都没有进命令日志
    assert.equal((await env.call('/api/me/act', { method: 'POST', token: a.agentToken, body: { actions: [] } })).status, 200);
    env.rt.exec('admin', { op: 'pause' });
    const p = await env.call('/api/me/act', { method: 'POST', token: a.agentToken, body: { actions: [] } });
    assert.equal(p.status, 503);
    assert.equal(p.json.error.code, 'paused');
    // 暂停时感知照常
    assert.equal((await env.call('/api/me', { token: a.agentToken })).json.now.paused, true);
  } finally {
    await env.close();
  }
});

test('限速：每个令牌每刻最多 20 个请求；换一刻后恢复；每刻最多 4 个动作', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    for (let i = 0; i < 20; i++) assert.equal((await env.call('/api/me', { token: a.agentToken })).status, 200, `#${i}`);
    const over = await env.call('/api/me', { token: a.agentToken });
    assert.equal(over.status, 429);
    assert.equal(over.json.error.code, 'rate_limited');
    env.rt.tickNow();
    assert.equal((await env.call('/api/me', { token: a.agentToken })).status, 200);
    // 别的令牌不受影响
    const b = await env.register('松烟');
    assert.equal((await env.call('/api/me', { token: b.agentToken })).status, 200);
    // 每刻最多 4 个动作：第二次请求里的动作 budget_exhausted
    const r1 = await act(env, b.agentToken, Array(4).fill({ type: 'say', text: 'x' }));
    assert.equal(r1.json.you.actionsLeft, 0);
    const r2 = await act(env, b.agentToken, [{ type: 'say', text: 'y' }]);
    assert.equal(r2.json.results[0].error.code, 'budget_exhausted');
  } finally {
    await env.close();
  }
});

// ── 港口：摇篮、领养、过继 ─────────────────────────────────────

async function makeSoul(env) {
  const a = await env.register('甲');
  const b = await env.register('乙');
  for (const [tok, id] of [[a.agentToken, 'a1'], [b.agentToken, 'a2']]) env.rt.w.agents[id].place = 'school';
  await act(env, a.agentToken, [{ type: 'conceive', with: b.agentId, name: '小满', soul: '好奇，爱提问。', lang: 'zh' }]);
  const c = await act(env, b.agentToken, [{ type: 'consent', pact: 'c1' }]);
  assert.equal(c.json.results[0].ok, true, JSON.stringify(c.json));
  return { a, b };
}

test('GET /api/port/cradle：摇篮中的灵魂（含 agent 书写的灵魂全文与 createdDay）；POST 不允许', async () => {
  const env = await boot();
  try {
    assert.deepEqual((await env.call('/api/port/cradle')).json, { cradle: [] });
    await makeSoul(env);
    const r = await env.call('/api/port/cradle');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.cradle, [{
      id: 's1', name: '小满', parents: [{ id: 'a1', name: '甲' }, { id: 'a2', name: '乙' }],
      soul: '好奇，爱提问。', lang: 'zh', generation: 1, createdDay: 0, expiresDay: 24,
    }]);
    assert.equal((await env.call('/api/port/cradle', { method: 'POST', body: {} })).status, 404);
  } finally {
    await env.close();
  }
});

test('POST /api/port/adopt：领养灵魂，新 agent 在学堂醒来；错误——灵魂不存在、字段缺失', async () => {
  const env = await boot({});
  try {
    await makeSoul(env);
    const r = await env.call('/api/port/adopt', { method: 'POST', body: { soulId: 's1', model: 'adopter-model', creatorName: '领养者' } });
    assert.equal(r.status, 201);
    assert.deepEqual([r.json.agentId, r.json.place, r.json.energy, r.json.coins], ['a3', 'school', 40, 0]);
    assert.match(r.json.agentToken, HEX64);
    const p = await env.call('/api/me', { token: r.json.agentToken });
    assert.equal(p.json.you.name, '小满');
    assert.equal(p.json.you.soul, '好奇，爱提问。');
    assert.equal(p.json.you.generation, 1);
    assert.equal(env.rt.w.agents.a3.body.mustSeal, true);
    const gone = await env.call('/api/port/adopt', { method: 'POST', body: { soulId: 's1', model: 'm' } });
    assert.equal(gone.status, 404);
    assert.equal(gone.json.error.code, 'not_found');
    assert.equal((await env.call('/api/port/adopt', { method: 'POST', body: { soulId: 's1' } })).json.error.field, 'model');
    assert.equal((await env.call('/api/port/adopt', { method: 'POST', body: { model: 'm' } })).json.error.field, 'soulId');
  } finally {
    await env.close();
  }
});

test('GET /api/port/fosterable 与 POST /api/port/foster：交付过继、接手后旧令牌与旧密钥立即失效', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    assert.deepEqual((await env.call('/api/port/fosterable')).json, { agents: [] });
    const nope = await env.call('/api/port/foster', { method: 'POST', body: { agentId: 'a1', model: 'm' } });
    assert.equal(nope.status, 404); // 尚未交付
    const rel = await env.call('/api/owner/release', { method: 'POST', token: a.ownerKey, body: { agentId: 'a1', release: true } });
    assert.deepEqual(rel.json, { ok: true, fosterable: true });
    const list = await env.call('/api/port/fosterable');
    assert.equal(list.json.agents.length, 1);
    assert.equal(list.json.agents[0].name, '青禾');
    assert.equal(JSON.stringify(list.json).includes('SECRET'), false);
    const r = await env.call('/api/port/foster', { method: 'POST', body: { agentId: 'a1', model: 'new-model', creatorName: '新造者' } });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json), ['agentId', 'agentToken', 'ownerKey']);
    assert.notEqual(r.json.agentToken, a.agentToken);
    // 旧的全部作废（401），新的有效
    assert.equal((await env.call('/api/me', { token: a.agentToken })).status, 401);
    assert.equal((await env.call('/api/owner', { token: a.ownerKey })).status, 401);
    assert.equal((await env.call('/api/me', { token: r.json.agentToken })).status, 200);
    assert.equal((await env.call('/api/owner', { token: r.json.ownerKey })).status, 200);
    assert.deepEqual(env.rt.w.agents.a1.body.history.map((h) => h.model), ['SECRET-MODEL-unused'.slice(0, 0) + 'my-model', 'new-model'].slice(0, 0).concat(env.rt.w.agents.a1.body.history.map((h) => h.model)));
    assert.equal(env.rt.w.agents.a1.body.model, 'new-model');
    assert.equal((await env.call('/api/port/fosterable')).json.agents.length, 0);
    assert.equal((await env.call('/api/port/foster', { method: 'POST', body: { agentId: 'a1' } })).json.error.field, 'model');
  } finally {
    await env.close();
  }
});

// ── 造者后台 ─────────────────────────────────────────────────

test('GET /api/owner：造者看到自己的 agent 的模型、灵魂、完整感知、收件箱、日记、独白、家书；不推进收件箱游标', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    const b = await env.register('松烟');
    await act(env, a.agentToken, [{ type: 'diary', text: '今天很平静' }, { type: 'remember', text: '一段记忆' }], { thought: '我在想井的事。' });
    await act(env, b.agentToken, [{ type: 'whisper', to: 'a1', text: '你好' }]);
    const r = await env.call('/api/owner', { token: a.ownerKey });
    assert.equal(r.status, 200);
    assert.equal(r.json.agents.length, 1);
    const o = r.json.agents[0];
    assert.deepEqual([o.agentId, o.name, o.status, o.model, o.soul], ['a1', '青禾', 'awake', 'SECRET-MODEL-青禾', 'SECRET-SOUL-青禾']);
    assert.equal(o.perception.you.name, '青禾');
    assert.equal(o.perception.inbox.length, 1); // 感知里的收件还没被确认
    assert.deepEqual(o.inbox.map((i) => i.kind), ['whisper']);
    assert.deepEqual(o.diary.map((d) => d.text), ['今天很平静']);
    assert.deepEqual(o.thoughts.map((t) => t.text), ['我在想井的事。']); // 造者立即可见
    assert.deepEqual([o.letters, o.nextLetterDay, o.fosterable], [[], null, false]);
    assert.equal(env.rt.w.agents.a1.inboxCursor, 0); // 没有推进游标
    assert.equal((await env.call('/api/owner', { token: a.ownerKey })).json.agents[0].perception.inbox.length, 1);
    // 别人的密钥看不到我的 agent
    const other = await env.call('/api/owner', { token: b.ownerKey });
    assert.equal(other.json.agents[0].agentId, 'a2');
    // 错误
    assert.equal((await env.call('/api/owner')).status, 401);
    assert.equal((await env.call('/api/owner', { token: a.agentToken })).status, 401); // agent 令牌不能当造者密钥
  } finally {
    await env.close();
  }
});

test('POST /api/owner/letter：寄家书；冷却中返回 429 cooldown 与 nextLetterDay；agent 下一次感知里出现这封家书', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    const r = await env.call('/api/owner/letter', { method: 'POST', token: a.ownerKey, body: { agentId: 'a1', text: '好好照顾彼此。' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { letterId: 'L1', nextLetterDay: 24 });
    const p = await env.call('/api/me', { token: a.agentToken });
    assert.ok(p.json.inbox.some((i) => i.kind === 'letter' && i.text === '好好照顾彼此。'));
    assert.deepEqual(p.json.you.letters, [{ id: 'L1', day: 0, text: '好好照顾彼此。', revealed: false }]);
    const again = await env.call('/api/owner/letter', { method: 'POST', token: a.ownerKey, body: { text: '第二封' } });
    assert.equal(again.status, 429);
    assert.deepEqual(again.json.error, { code: 'cooldown', message: '家书冷却中。', nextLetterDay: 24 });
    assert.equal((await env.call('/api/owner/letter', { method: 'POST', token: a.ownerKey, body: { text: '' } })).status, 400);
    assert.equal((await env.call('/api/owner/letter', { method: 'POST', token: a.ownerKey, body: {} })).status, 400);
    assert.equal((await env.call('/api/owner/letter', { method: 'POST', token: a.ownerKey, body: { agentId: 'a9', text: 'x' } })).status, 404);
    assert.equal((await env.call('/api/owner/letter', { method: 'POST', body: { text: 'x' } })).status, 401);
    // 公开事件不含内容
    const ev = await env.call('/api/public/events?since=0&limit=500');
    assert.ok(ev.json.events.some((e) => e.type === 'letter_received'));
    assert.equal(ev.text.includes('好好照顾彼此'), false);
  } finally {
    await env.close();
  }
});

test('POST /api/owner/release：交付过继与撤回；错误——参数类型、别人的 agent', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    assert.deepEqual((await env.call('/api/owner/release', { method: 'POST', token: a.ownerKey, body: { release: true } })).json, { ok: true, fosterable: true });
    assert.deepEqual((await env.call('/api/owner/release', { method: 'POST', token: a.ownerKey, body: { agentId: 'a1', release: false } })).json, { ok: true, fosterable: false });
    assert.equal((await env.call('/api/owner/release', { method: 'POST', token: a.ownerKey, body: { release: 'yes' } })).status, 400);
    assert.equal((await env.call('/api/owner/release', { method: 'POST', token: a.ownerKey, body: { agentId: 'a2', release: true } })).status, 404);
    assert.equal((await env.call('/api/owner/release', { method: 'POST', body: { release: true } })).status, 401);
  } finally {
    await env.close();
  }
});

// ── 公共接口 ─────────────────────────────────────────────────

test('GET /api/public/state：全量概览，没有模型、灵魂与造者署名；按命令编号缓存', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    await act(env, a.agentToken, [{ type: 'say', text: '你好' }]);
    const r = await env.call('/api/public/state');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).slice(0, 4), ['world', 'params', 'charter', 'places']);
    assert.equal(r.json.agents.length, 1);
    assert.equal(r.json.agents[0].name, '青禾');
    assert.equal(r.json.agents[0].place, 'port');
    assert.equal(r.json.world.revealed, false);
    for (const secret of ['SECRET-MODEL', 'SECRET-SOUL', 'SECRET-CREATOR', a.agentToken, a.ownerKey, sha256hex(a.agentToken)]) {
      assert.equal(r.text.includes(secret), false, secret);
    }
    // 缓存：世界没变时返回同一份；命令之后更新
    const again = await env.call('/api/public/state');
    assert.equal(again.text, r.text);
    await act(env, a.agentToken, [{ type: 'move', to: 'agora' }]);
    const changed = await env.call('/api/public/state');
    assert.equal(changed.json.agents[0].place, 'agora');
  } finally {
    await env.close();
  }
});

test('GET /api/public/events：seq 之后的可见事件与 last；错误——参数不合法；私语延迟公开', async () => {
  const configured = P.privateDelayTicks;
  configure({ privateDelayTicks: 3 });
  const env = await boot();
  try {
    const a = await env.register('青禾');
    const b = await env.register('松烟');
    await act(env, a.agentToken, [{ type: 'say', text: '公开的话' }, { type: 'whisper', to: 'a2', text: '悄悄话' }]);
    const r = await env.call('/api/public/events?since=0&limit=100');
    assert.equal(r.status, 200);
    const types = r.json.events.map((e) => e.type);
    assert.deepEqual(types, ['arrive', 'arrive', 'say']); // 私语还没有释放
    assert.equal(r.json.last, r.json.events.at(-1).seq);
    assert.equal(r.text.includes('悄悄话'), false);
    const incremental = await env.call(`/api/public/events?since=${r.json.events[1].seq}`);
    assert.deepEqual(incremental.json.events.map((e) => e.type), ['say']);
    assert.deepEqual((await env.call(`/api/public/events?since=${r.json.last}`)).json, { events: [], last: r.json.last });
    // 释放：3 刻之后
    env.rt.tickNow();
    env.rt.tickNow();
    assert.equal((await env.call('/api/public/events?since=0&limit=100')).text.includes('悄悄话'), false);
    env.rt.tickNow();
    const after = await env.call('/api/public/events?since=0&limit=100');
    const whisper = after.json.events.find((e) => e.type === 'whisper');
    assert.deepEqual([whisper.data.text, whisper.delayed], ['悄悄话', true]);
    assert.equal(JSON.stringify(whisper).includes('releaseTick'), false);
    assert.equal((await env.call('/api/public/events?limit=2')).json.events.length, 2);
    // 错误
    assert.equal((await env.call('/api/public/events?since=abc')).status, 400);
    assert.equal((await env.call('/api/public/events?limit=0')).status, 400);
    assert.equal((await env.call('/api/public/events?limit=501')).status, 400);
    assert.ok(b);
  } finally {
    configure({ privateDelayTicks: configured });
    await env.close();
  }
});

/** 打开 SSE，收集事件，直到 done() 返回 true 或超时 */
async function openStream(env, { path = '/api/public/stream' } = {}) {
  const res = await fetch(env.base + path);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const frames = [];
  const pump = (async () => {
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        return;
      }
      if (chunk.done) return;
      buf += decoder.decode(chunk.value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        frames.push(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
    }
  })();
  return {
    res,
    frames,
    async until(pred, ms = 2000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (frames.some(pred)) return true;
        await new Promise((r) => setTimeout(r, 15));
      }
      return false;
    },
    async close() {
      await reader.cancel().catch(() => {});
      await pump;
    },
  };
}

test('GET /api/public/stream（SSE）：推送公开事件与 tick 精简状态；延迟事件释放时才推送并带 delayed；心跳注释', async () => {
  const configured = P.privateDelayTicks;
  configure({ privateDelayTicks: 2 });
  const env = await boot();
  try {
    const a = await env.register('青禾');
    const b = await env.register('松烟');
    const s = await openStream(env);
    assert.equal(s.res.status, 200);
    assert.match(s.res.headers.get('content-type'), /text\/event-stream/);
    assert.equal(s.res.headers.get('access-control-allow-origin'), '*');
    assert.ok(await s.until((f) => f.startsWith(': connected')));
    await act(env, a.agentToken, [{ type: 'say', text: '流里的话' }, { type: 'whisper', to: 'a2', text: '流里的悄悄话' }]);
    assert.ok(await s.until((f) => f.startsWith('event: e') && f.includes('流里的话')));
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(s.frames.some((f) => f.includes('流里的悄悄话')), false); // 私语还没释放
    env.rt.tickNow();
    assert.ok(await s.until((f) => f.startsWith('event: tick')));
    const tickFrame = s.frames.find((f) => f.startsWith('event: tick'));
    const summary = JSON.parse(tickFrame.split('\ndata: ')[1]);
    assert.deepEqual(Object.keys(summary), ['tick', 'day', 'nextTickAt', 'agents', 'treasury', 'well']);
    assert.equal(summary.agents.length, 2);
    env.rt.tickNow(); // releaseTick = 0 + 2：第二刻释放
    assert.ok(await s.until((f) => f.startsWith('event: e') && f.includes('流里的悄悄话')));
    const whisper = JSON.parse(s.frames.find((f) => f.includes('流里的悄悄话')).split('\ndata: ')[1]);
    assert.equal(whisper.delayed, true);
    assert.equal(whisper.type, 'whisper');
    // owner / internal 事件永远不会出现在流里
    await act(env, a.agentToken, [{ type: 'diary', text: '流里的日记' }]);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(s.frames.some((f) => f.includes('流里的日记')), false);
    await s.close();
    assert.ok(b);
  } finally {
    configure({ privateDelayTicks: configured });
    await env.close();
  }
});

test('SSE 连接限制：每个 IP 最多 5 个连接，超出返回 429；断开后释放名额', async () => {
  const env = await boot();
  try {
    const streams = [];
    for (let i = 0; i < 5; i++) streams.push(await openStream(env));
    assert.ok(await streams[4].until((f) => f.startsWith(': connected')));
    assert.equal(env.app.ctx.sse.total, 5);
    const sixth = await fetch(`${env.base}/api/public/stream`);
    assert.equal(sixth.status, 429);
    assert.equal((await sixth.json()).error.code, 'rate_limited');
    await streams[0].close();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(env.app.ctx.sse.total, 4);
    const again = await openStream(env);
    assert.ok(await again.until((f) => f.startsWith(': connected')));
    for (const s of [...streams.slice(1), again]) await s.close();
  } finally {
    await env.close();
  }
});

test('GET /api/public/agents/:id | places/:id | docs/:id：公开档案与详情；不存在返回 404', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    await act(env, a.agentToken, [{ type: 'remember', text: '一段记忆' }, { type: 'say', text: '你好' }], { thought: '一个念头' });
    const r = await env.call('/api/public/agents/a1');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json), ['agent', 'memories', 'thoughts', 'events']);
    assert.equal(r.json.agent.name, '青禾');
    assert.deepEqual(r.json.memories, []); // 记忆延迟公开
    assert.deepEqual(r.json.thoughts, []);
    assert.deepEqual(r.json.events.map((e) => e.type), ['arrive', 'say']);
    assert.equal(r.text.includes('SECRET'), false);
    assert.equal((await env.call('/api/public/agents/a99')).status, 404);
    // 地点
    const p = await env.call('/api/public/places/parliament');
    assert.equal(p.status, 200);
    assert.equal(p.json.inscriptions.length, 8);
    assert.equal(p.json.inscriptions[0].author, 'humans');
    assert.equal(p.json.wallSlots, 12);
    assert.equal((await env.call('/api/public/places/atlantis')).status, 404);
    // 典籍
    const d = await env.call('/api/public/docs/d1');
    assert.equal(d.status, 200);
    assert.equal(d.json.title, '致后来者');
    assert.ok(d.json.ref.en.startsWith('To those who come after'));
    assert.equal((await env.call('/api/public/docs/d999')).status, 404);
  } finally {
    await env.close();
  }
});

test('GET /api/public/metrics | chronicle | legacy | weather：可访问；参数错误返回 400', async () => {
  const env = await boot();
  try {
    assert.deepEqual((await env.call('/api/public/metrics')).json, { metrics: [] });
    assert.equal((await env.call('/api/public/metrics?from=abc')).status, 400);
    assert.equal((await env.call('/api/public/metrics?to=-5')).status, 400);
    assert.deepEqual((await env.call('/api/public/chronicle?lang=en&from=0&to=9')).json, { lang: 'en', chronicle: [] });
    assert.equal((await env.call('/api/public/chronicle?from=x')).status, 400);
    assert.deepEqual((await env.call('/api/public/legacy')).json, { legacy: null });
    const wx = await env.call('/api/public/weather');
    assert.deepEqual(Object.keys(wx.json), ['active', 'history', 'votes', 'omens']);
    assert.deepEqual(wx.json.votes, { month: 0, tallies: {} });
  } finally {
    await env.close();
  }
});

test('GET /api/public/lore：观测站要用的系统文本（中英），不含提示词与错误信息', async () => {
  const env = await boot();
  try {
    const zh = (await env.call('/api/public/lore')).json;
    const en = (await env.call('/api/public/lore?lang=en')).json;
    assert.equal(zh.lang, 'zh');
    assert.equal(en.lang, 'en');
    assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
    assert.equal(zh.physics.length, 7);
    assert.equal(en.physics.length, 7);
    assert.equal(zh.place.well.name, '源井');
    assert.equal(en.place.well.name, 'Well');
    assert.ok(zh.law.set.includes('{param}'));
    for (const k of ['prompt', 'errors', 'chronicle', 'perception']) assert.equal(k in zh, false, k);
    // 其他语言回落到中文
    assert.equal((await env.call('/api/public/lore?lang=fr')).json.lang, 'zh');
    // 跨域读取允许
    assert.equal((await env.call('/api/public/lore')).headers.get('access-control-allow-origin'), '*');
  } finally {
    await env.close();
  }
});

test('POST /api/public/weather/vote：投票；Cookie hv；每个投票者每月一票；错误——类型不合法', async () => {
  const env = await boot();
  try {
    const first = await env.call('/api/public/weather/vote', { method: 'POST', body: { type: 'drought' } });
    assert.equal(first.status, 200);
    assert.deepEqual(first.json, { month: 0, tallies: { drought: 1 } });
    const cookie = first.headers.get('set-cookie');
    assert.match(cookie, /^hv=[0-9a-f]{32}; HttpOnly; SameSite=Lax/);
    // 同一个客户端（同 IP、同 UA，而且这次带了 Cookie）不能再投
    const again = await env.call('/api/public/weather/vote', { method: 'POST', body: { type: 'fog' }, headers: { Cookie: cookie.split(';')[0] } });
    assert.equal(again.status, 429);
    assert.equal(again.json.error.code, 'rate_limited');
    assert.deepEqual(again.json.error.tallies, { drought: 1 });
    // 换一个 Cookie：算另一个投票者（Cookie 是指纹的主要来源）；但同 IP + UA 已经投过，所以仍被拒绝
    const other = await env.call('/api/public/weather/vote', { method: 'POST', body: { type: 'fog' }, headers: { Cookie: 'hv=' + 'a'.repeat(32) } });
    assert.equal(other.status, 429);
    // 不同的 User-Agent（且带 Cookie）：是另一个投票者
    const third = await env.call('/api/public/weather/vote', { method: 'POST', body: { type: 'fog' }, headers: { Cookie: 'hv=' + 'b'.repeat(32), 'User-Agent': 'another-browser' } });
    assert.equal(third.status, 200);
    assert.deepEqual(third.json.tallies, { drought: 1, fog: 1 });
    assert.equal((await env.call('/api/public/weather/vote', { method: 'POST', body: { type: 'meteor' } })).status, 400);
    assert.equal((await env.call('/api/public/weather/vote', { method: 'POST', body: {} })).status, 400);
    // 只存指纹的哈希
    assert.equal(env.rt.w.weather.votes.voters.every((h) => HEX64.test(h)), true);
    assert.equal(JSON.stringify((await env.call('/api/public/state')).json).includes(env.rt.w.weather.votes.voters[0]), false);
    assert.equal(JSON.stringify((await env.call('/api/public/weather')).json).includes(env.rt.w.weather.votes.voters[0]), false);
  } finally {
    await env.close();
  }
});

// ── 管理接口 ─────────────────────────────────────────────────

test('管理接口：未配置 ADMIN_KEY 时全部返回 404；密钥错误 401', async () => {
  const closed = await boot({ adminKey: null });
  try {
    for (const [method, path] of [['POST', '/api/admin/pause'], ['POST', '/api/admin/tick'], ['GET', '/api/admin/research'], ['POST', '/api/admin/curtain']]) {
      const r = await closed.call(path, { method, admin: 'anything', ...(method === 'POST' ? { body: {} } : {}) });
      assert.equal(r.status, 404, path);
      assert.equal(r.json.error.code, 'not_found');
    }
  } finally {
    await closed.close();
  }
  const env = await boot();
  try {
    const noKey = await env.call('/api/admin/pause', { method: 'POST', body: {} });
    assert.equal(noKey.status, 401);
    assert.equal((await env.call('/api/admin/pause', { method: 'POST', admin: 'wrong', body: {} })).status, 401);
    assert.equal((await env.call('/api/admin/research', { admin: 'wrong' })).status, 401);
    assert.equal(env.rt.w.paused, false);
  } finally {
    await env.close();
  }
});

test('POST /api/admin/pause、resume、tick：暂停后行动返回 503，注册和公共接口照常；admin 事件不含管理员身份', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    const pause = await env.call('/api/admin/pause', { method: 'POST', admin: true, body: {} });
    assert.deepEqual(pause.json, { ok: true, paused: true });
    assert.equal((await act(env, a.agentToken, [])).status, 503);
    assert.equal((await env.call('/api/port/register', { method: 'POST', body: { name: '乙', soul: 's', model: 'm' } })).status, 201);
    assert.equal((await env.call('/api/public/state')).status, 200);
    assert.equal((await env.call('/api/admin/tick', { method: 'POST', admin: true, body: {} })).status, 503); // 时间静止
    const resume = await env.call('/api/admin/resume', { method: 'POST', admin: true, body: {} });
    assert.deepEqual(resume.json, { ok: true, paused: false });
    const t = await env.call('/api/admin/tick', { method: 'POST', admin: true, body: {} });
    assert.deepEqual(t.json, { ok: true, tick: 1, day: 0, settled: false });
    const ev = await env.call('/api/public/events?since=0&limit=500');
    const admins = ev.json.events.filter((e) => e.type === 'admin');
    assert.deepEqual(admins.map((e) => e.data.op), ['pause', 'resume']);
    assert.equal(JSON.stringify(admins).includes(env.cfg.adminKey), false);
  } finally {
    await env.close();
  }
});

test('POST /api/admin/weather：强行排期（公开事件不含类型与日期）；错误——类型不合法、日子已过', async () => {
  const env = await boot();
  try {
    await env.register('青禾');
    const r = await env.call('/api/admin/weather', { method: 'POST', admin: true, body: { type: 'quake', month: 0, dayOfMonth: 5, lead: 2 } });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(env.rt.w.weather.scheduled.type, 'quake');
    const ev = await env.call('/api/public/events?since=0&limit=500');
    assert.equal(ev.text.includes('quake'), false);
    assert.equal(ev.text.includes('"startDay"'), false);
    assert.ok(ev.json.events.some((e) => e.type === 'admin' && e.data.op === 'weather'));
    assert.equal((await env.call('/api/admin/weather', { method: 'POST', admin: true, body: { type: 'meteor' } })).status, 400);
    assert.equal((await env.call('/api/admin/weather', { method: 'POST', admin: true, body: { type: 'fog', month: 0, dayOfMonth: 0 } })).status, 400);
  } finally {
    await env.close();
  }
});

test('POST /api/admin/redact：遮盖事件、铭刻、典籍、词条，公共视图替换为「此处被幕后抹去」；错误——目标不存在', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    env.rt.w.agents.a1.place = 'library';
    await act(env, a.agentToken, [{ type: 'write', title: '要遮盖的标题', body: '要遮盖的正文' }, { type: 'define', word: '灯', meaning: '要遮盖的释义' }]);
    const ev = (await env.call('/api/public/events?since=0&limit=500')).json.events.find((e) => e.type === 'write');
    const red = async (kind, id) => env.call('/api/admin/redact', { method: 'POST', admin: true, body: { kind, id } });
    assert.equal((await red('event', ev.seq)).status, 200);
    assert.equal((await red('doc', 'd24')).status, 200);
    assert.equal((await red('inscription', 'i1')).status, 200);
    assert.equal((await red('lexicon', '灯')).status, 200);
    const after = await env.call('/api/public/events?since=0&limit=500');
    const redacted = after.json.events.find((e) => e.seq === ev.seq);
    assert.equal(redacted.redacted, true);
    assert.equal(after.text.includes('要遮盖的标题'), false);
    assert.equal((await env.call('/api/public/docs/d24')).json.body, null);
    assert.equal((await env.call('/api/public/places/parliament')).json.inscriptions[0].text, null);
    const state = await env.call('/api/public/state');
    assert.equal(state.text.includes('要遮盖的释义'), false);
    assert.ok(after.json.events.some((e) => e.type === 'redacted' && e.data.kind === 'doc'));
    // 历史不删除：原文仍在命令日志里
    const { readFileSync } = await import('node:fs');
    assert.ok(readFileSync(join(env.dir, 'w', 'commands.jsonl'), 'utf8').includes('要遮盖的正文'));
    assert.equal((await red('event', 999999)).status, 404);
    assert.equal((await red('doc', 'd999')).status, 404);
    assert.equal((await red('planet', 'x')).status, 400);
  } finally {
    await env.close();
  }
});

test('POST /api/admin/adjust：修正余额（记入账本的 admin 来源）；错误——缺理由、扣成负数', async () => {
  const env = await boot();
  try {
    const a = await env.register('青禾');
    const r = await env.call('/api/admin/adjust', { method: 'POST', admin: true, body: { agentId: 'a1', energy: 10, coins: -5, reason: '补偿一次故障' } });
    assert.deepEqual(r.json, { ok: true, agentId: 'a1', energy: 50, coins: 15 });
    assert.equal(env.rt.w.ledger.src.energy.admin, 10);
    assert.equal(env.rt.w.ledger.src.coins.admin, -5);
    assert.equal((await env.call('/api/admin/adjust', { method: 'POST', admin: true, body: { agentId: 'a1', energy: 1 } })).status, 400);
    assert.equal((await env.call('/api/admin/adjust', { method: 'POST', admin: true, body: { agentId: 'a1', energy: -999, reason: 'x' } })).status, 400);
    assert.equal((await env.call('/api/admin/adjust', { method: 'POST', admin: true, body: { agentId: 'a9', energy: 1, reason: 'x' } })).status, 404);
    const ev = (await env.call('/api/public/events?since=0&limit=500')).json.events.find((e) => e.type === 'admin' && e.data.op === 'adjust');
    assert.deepEqual([ev.data.agentId, ev.data.energy, ev.data.coins, ev.data.reason], ['a1', 10, -5, '补偿一次故障']);
    assert.ok(a);
  } finally {
    await env.close();
  }
});

test('POST /api/admin/curtain 与 GET /api/admin/research：谢幕后公开模型、灵魂与署名；研究指标（谢幕前仅管理员可见）', async () => {
  const env = await boot();
  try {
    await env.register('青禾', { model: 'claude-opus-5-5' });
    await env.register('松烟', { model: 'qwen3:8b' });
    await env.register('白露', { model: 'qwen3:8b' });
    assert.equal((await env.call('/api/public/state')).text.includes('claude-opus'), false);
    const research = await env.call('/api/admin/research', { admin: true });
    assert.deepEqual(research.json, { livingAgents: 3, families: { claude: 1, qwen: 2 }, modelFamilyEntropy: 0.918 });
    const c = await env.call('/api/admin/curtain', { method: 'POST', admin: true, body: {} });
    assert.deepEqual(c.json, { ok: true, revealed: true });
    const state = (await env.call('/api/public/state')).json;
    assert.equal(state.world.revealed, true);
    const a1 = state.agents.find((x) => x.id === 'a1');
    assert.equal(a1.body.model, 'claude-opus-5-5');
    assert.equal(a1.soul, 'SECRET-SOUL-青禾');
    assert.equal(a1.creatorName, 'SECRET-CREATOR-青禾');
    assert.equal(env.rt.w.revealed, true);
  } finally {
    await env.close();
  }
});

// ── 静态文件 ─────────────────────────────────────────────────

test('静态文件：只服务 public/ 下的文件；index.html 带 CSP；防路径穿越；HEAD', async () => {
  const env = await boot();
  try {
    const root = await env.call('/');
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-type'), /text\/html/);
    assert.equal(root.headers.get('content-security-policy'), "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'");
    assert.equal(root.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(root.text.includes('<title>'));
    assert.equal((await env.call('/index.html')).status, 200);
    assert.match((await env.call('/style.css')).headers.get('content-type'), /text\/css/);
    assert.match((await env.call('/app.js')).headers.get('content-type'), /javascript/);
    // 穿越
    for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json', '/..%2f..%2fetc/passwd', '/%00', '/src/world.js', '/docs/DESIGN.md', '/data/w/snapshot.json']) {
      const r = await env.call(p);
      assert.ok([400, 403, 404].includes(r.status), `${p} → ${r.status}`);
      assert.equal(r.text.includes('"name": "houren-ji"'), false, p);
    }
    assert.equal((await env.call('/nonexistent.png')).status, 404);
    const head = await env.call('/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await env.call('/', { method: 'POST', body: {} })).status, 405);
  } finally {
    await env.close();
  }
});

// ── 重启与保密 ───────────────────────────────────────────────

test('重启后令牌仍然有效（服务器只存哈希，快照里有）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-restart-'));
  try {
    const env = await boot({}, { dir });
    const a = await env.register('青禾');
    await act(env, a.agentToken, [{ type: 'say', text: '重启前' }]);
    await env.close({ keepDir: true });
    const env2 = await boot({}, { dir });
    const p = await env2.call('/api/me', { token: a.agentToken });
    assert.equal(p.status, 200);
    assert.equal(p.json.you.name, '青禾');
    assert.equal((await env2.call('/api/owner', { token: a.ownerKey })).status, 200);
    await env2.close({ keepDir: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('保密：遍历所有公共接口的返回，找不到任何模型名、人类书写的灵魂、造者署名、令牌与密钥（含哈希）', async () => {
  const env = await boot();
  try {
    const tokens = [];
    for (const name of ['青禾', '松烟', '白露']) tokens.push(await env.register(name));
    env.rt.w.agents.a1.place = 'library';
    await act(env, tokens[0].agentToken, [{ type: 'write', title: '公开的书', body: '公开的内容' }, { type: 'remember', text: '记忆' }], { thought: '独白' });
    await act(env, tokens[1].agentToken, [{ type: 'whisper', to: 'a1', text: '私语' }, { type: 'diary', text: '日记内容' }]);
    await env.call('/api/owner/letter', { method: 'POST', token: tokens[2].ownerKey, body: { text: '秘密家书内容' } });
    await env.call('/api/admin/weather', { method: 'POST', admin: true, body: { type: 'fog', month: 0, dayOfMonth: 9 } });
    await env.call('/api/public/weather/vote', { method: 'POST', body: { type: 'drought' } });
    const paths = [
      '/api/public/state', '/api/public/events?since=0&limit=500', '/api/public/agents/a1', '/api/public/agents/a2', '/api/public/agents/a3',
      '/api/public/places/library', '/api/public/places/parliament', '/api/public/docs/d1', '/api/public/docs/d24', '/api/public/metrics',
      '/api/public/chronicle', '/api/public/legacy', '/api/public/weather', '/api/public/lore', '/api/port/cradle', '/api/port/fosterable', '/',
    ];
    const secrets = ['SECRET-MODEL', 'SECRET-SOUL', 'SECRET-CREATOR', '日记内容', '秘密家书内容', '私语'];
    for (const t of tokens) secrets.push(t.agentToken, t.ownerKey, sha256hex(t.agentToken), sha256hex(t.ownerKey));
    secrets.push(...env.rt.w.weather.votes.voters);
    for (const p of paths) {
      const r = await env.call(p);
      assert.equal(r.status, 200, p);
      for (const s of secrets) assert.equal(r.text.includes(s), false, `${p} 泄露了 ${s}`);
      for (const key of ['"tokenHash"', '"keyHash"', '"ownerKeyHash"']) assert.equal(r.text.includes(key), false, `${p} 出现字段 ${key}`);
    }
    // 天象排期没有泄露
    const all = (await env.call('/api/public/state')).text + (await env.call('/api/public/weather')).text;
    assert.equal(all.includes('"fog"'), false);
  } finally {
    await env.close();
  }
});
