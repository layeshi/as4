// SPEC-P2 T6：唤醒——隐藏列表、applyCommand 的 wakes、运行时的通知、GET /api/me/wait、两种客户端的 wait、限速。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import e2, { isWakeItem } from '../src/e2/facade.js';
import { applyCommand } from '../src/e2/engine/index.js';
import { drainWakes } from '../src/e2/engine/core.js';
import { stateHash } from '../src/store.js';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { createShellClient } from '../src/shells/client.js';
import { createClient } from '../runner/client.js';
import { sha } from './e2-helpers.js';
import { town } from './p2-helpers.js';
import { boot } from './http-helpers.js';

/** 执行一条 act 命令（走 applyCommand，拿到它的 wakes）；先把本刻的名额清零，测试里连续的动作不必管名额 */
const act = (w, a, actions) => {
  a.actsThisTick = 0;
  return applyCommand(w, { type: 'act', payload: { agentId: a.id, actions } });
};
const wakesOf = (out) => out.wakes.map((x) => [x.agentId, x.kind]);

// ═══════════════════════════════════════════════════════════════
// 引擎：隐藏列表
// ═══════════════════════════════════════════════════════════════

test('P2 T6: 会叫醒的五类收件进隐藏列表，applyCommand 返回 wakes（序号与收件一致），其余的不进', () => {
  const { w, people } = town(3, 'wakes');
  const [a, b, c] = people;
  // 私语（含匿名）
  let out = act(w, a, [{ type: 'whisper', to: b.id, text: '私语' }]);
  assert.deepEqual(wakesOf(out), [[b.id, 'whisper']]);
  assert.equal(out.wakes[0].seq, b.inbox.at(-1).seq);
  out = act(w, a, [{ type: 'whisper', to: b.id, text: '匿名', anonymous: true }]);
  assert.deepEqual(wakesOf(out), [[b.id, 'whisper']]);
  assert.equal(b.inbox.at(-1).anonymous, true);
  // 定向交易（公开交易不会）
  out = act(w, a, [{ type: 'offer', to: b.id, give: { energy: 0, coins: 1 }, want: { energy: 1, coins: 0 } }]);
  assert.deepEqual(wakesOf(out), [[b.id, 'offer']]);
  // 孕育之约的邀请
  out = act(w, a, [{ type: 'conceive', name: '孩子', soul: '孩子的灵魂', with: [b.id, c.id] }]);
  assert.deepEqual(wakesOf(out), [[b.id, 'pact'], [c.id, 'pact']]);
  // 交给你的记忆
  act(w, a, [{ type: 'remember', text: '记忆' }]);
  out = act(w, a, [{ type: 'impart', to: c.id, memory: 0 }]);
  assert.deepEqual(wakesOf(out), [[c.id, 'memory_offer']]);
  // 申请加入你担任管事的封闭社群
  act(w, b, [{ type: 'found', name: '小会', manifesto: '一起', open: false }]);
  out = act(w, c, [{ type: 'join', group: 'g1' }]);
  assert.deepEqual(wakesOf(out), [[b.id, 'group']]);
  assert.equal(b.inbox.at(-1).event, 'request');
});

test('P2 T6: 说话、宣告、赠予、公开交易、社群的其余通知、约的结果、常驻指令的回报、系统通知都不叫醒', () => {
  const { w, people } = town(3, 'no-wakes');
  const [a, b, c] = people;
  const none = (out, what) => assert.deepEqual(out.wakes, [], what);
  none(act(w, a, [{ type: 'say', text: '同处的人听得到' }]), 'say');
  none(act(w, a, [{ type: 'broadcast', text: '全城' }]), 'broadcast');
  none(act(w, a, [{ type: 'give', to: b.id, energy: 2, note: '送' }]), 'give（gift）');
  // 公开交易：在告示板处，不是 pushInbox 的定向收件
  for (const x of [a, b]) x.place = 'market';
  none(act(w, a, [{ type: 'offer', give: { energy: 0, coins: 1 }, want: { energy: 1, coins: 0 } }]), '公开交易');
  // 孕育之约的结果、社群通知
  const pact = act(w, a, [{ type: 'conceive', name: '孩子', soul: '灵魂', with: [b.id] }]).result.results[0].data.pact;
  none(act(w, b, [{ type: 'consent', pact }]), 'pact_closed');
  act(w, a, [{ type: 'found', name: '会', manifesto: '会', open: false }]);
  act(w, c, [{ type: 'join', group: 'g1' }]);
  none(act(w, a, [{ type: 'admit', group: 'g1', agent: c.id }]), 'group: admitted');
  // 常驻指令的回报与系统通知
  none(act(w, a, [{ type: 'standing', orders: [{ when: 'tick', do: [{ type: 'diary', text: '记' }] }] }]), 'standing 的设定');
  const t = applyCommand(w, { type: 'tick' });
  assert.ok(a.inbox.some((i) => i.kind === 'standing'));
  assert.deepEqual(t.wakes, [], 'standing 的回报不叫醒');
  // isWakeItem 本身
  assert.deepEqual(['whisper', 'offer', 'pact', 'memory_offer', 'say', 'broadcast', 'gift', 'system', 'standing', 'trade', 'law'].map((k) => isWakeItem(k, {})), [true, true, true, true, false, false, false, false, false, false, false]);
  assert.equal(isWakeItem('group', { event: 'request' }), true);
  for (const event of ['admitted', 'steward', 'dissolved', undefined]) assert.equal(isWakeItem('group', { event }), false, String(event));
});

test('P2 T6: 隐藏列表是不可枚举的暂存区（同 w.$out）：不进快照与状态哈希，每条命令结束都清空，drainWakes 取走', () => {
  const { w, people } = town(2, 'hidden');
  const [a, b] = people;
  const hashBefore = stateHash(w);
  const json = JSON.stringify(w);
  assert.ok(!Object.keys(w).includes('$wakes'));
  const out = act(w, a, [{ type: 'whisper', to: b.id, text: 'x' }]);
  assert.equal(out.wakes.length, 1);
  assert.equal(w.$wakes.length, 0, '命令结束时已清空');
  assert.equal(Object.keys(w).includes('$wakes'), false, '不可枚举');
  assert.equal(JSON.stringify(w).includes('$wakes'), false);
  assert.equal(JSON.stringify(w).includes('"wakes"'), false);
  assert.deepEqual(drainWakes(w), []);
  // 不叫醒的命令：wakes 为空数组
  assert.deepEqual(applyCommand(w, { type: 'tick' }).wakes, []);
  // 提前返回的分支（未知的命令）也带 wakes
  const bad = applyCommand(w, { type: 'nonsense' });
  assert.deepEqual(bad.wakes, []);
  assert.equal(bad.result.ok, false);
  // 列表不进状态：哈希只因收件本身（它是状态）而变
  assert.notEqual(stateHash(w), hashBefore);
  assert.equal(json.includes('$wakes'), false);
});

test('P2 T6: 设定 0、1 的世界里没有隐藏列表，wakes 恒为空', () => {
  for (const premise of [0, 1]) {
    const { w, people } = town(2, `old-${premise}`, { premise });
    const [a, b] = people;
    const out = act(w, a, [{ type: 'whisper', to: b.id, text: '私语' }, { type: 'offer', to: b.id, give: { energy: 0, coins: 1 }, want: { energy: 1, coins: 0 } }]);
    assert.deepEqual(out.wakes, []);
    assert.equal(Object.hasOwn(w, '$wakes'), false);
  }
});

test('P2 T6: 常驻指令在 tick 命令里发出的私语，叫醒的通知随 tick 命令一起返回', () => {
  const { w, people } = town(2, 'standing-wakes');
  const [a, b] = people;
  act(w, a, [{ type: 'standing', orders: [{ when: 'tick', times: 1, do: [{ type: 'whisper', to: b.id, text: '自动私语' }] }] }]);
  const out = applyCommand(w, { type: 'tick' });
  assert.deepEqual(wakesOf(out), [[b.id, 'whisper']]);
  assert.equal(b.inbox.at(-1).text, '自动私语');
  // 被屏蔽的发送者：投递根本不调用 pushInbox，所以不出现在 wakes 里
  act(w, b, [{ type: 'mute', who: a.id }]);
  const blocked = act(w, a, [{ type: 'whisper', to: b.id, text: '被屏蔽' }, { type: 'offer', to: b.id, give: { energy: 0, coins: 1 }, want: { energy: 1, coins: 0 } }, { type: 'conceive', name: '孩', soul: '灵魂', with: [b.id] }]);
  assert.deepEqual(blocked.wakes, []);
  const anonOnly = act(w, b, [{ type: 'mute', who: 'anonymous' }]);
  assert.deepEqual(anonOnly.wakes, []);
  const anon = act(w, a, [{ type: 'whisper', to: b.id, text: '匿名也被屏蔽', anonymous: true }]);
  assert.deepEqual(anon.wakes, []);
  // 解除之后又叫醒
  act(w, b, [{ type: 'mute', who: a.id, on: false }, { type: 'mute', who: 'anonymous', on: false }]);
  assert.deepEqual(wakesOf(act(w, a, [{ type: 'whisper', to: b.id, text: '又来了' }])), [[b.id, 'whisper']]);
});

// ═══════════════════════════════════════════════════════════════
// 运行时：onWake
// ═══════════════════════════════════════════════════════════════

function openRuntime(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'houren-wake-'));
  const cfg = { ...loadConfig({}, []), dataDir: dir, worldId: 'w', seed: 'wake-seed', physics: 2, premise: 2, shellSlots: 8, ...extra };
  const logs = [];
  const rt = Runtime.open(cfg, { version: '0.1.0', logger: { warn: (m) => logs.push(m), error() {} } });
  return { rt, cfg, dir, logs, close: () => { rt.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const register = (rt, name) => rt.exec('register', { name, bio: '', soul: `我是${name}`, lang: 'zh', model: 'm', creatorName: 't', tokenHash: sha(`t:${name}`), ownerKeyHash: sha(`k:${name}`) }).result.agentId;

test('P2 T6: 运行时——exec 在命令产生了叫醒的收件时通知订阅者；取消订阅；订阅者出错只记警告；不进事件流', () => {
  const env = openRuntime();
  try {
    const { rt } = env;
    const [a, b] = ['甲', '乙'].map((n) => register(rt, n));
    const seen = [];
    const off = rt.onWake((n) => seen.push(n));
    const boom = rt.onWake(() => { throw new Error('订阅者出错'); });
    const later = [];
    rt.onWake((n) => later.push(n));
    rt.exec('act', { agentId: a, actions: [{ type: 'say', text: '不叫醒' }] });
    assert.equal(seen.length, 0);
    rt.exec('act', { agentId: a, actions: [{ type: 'whisper', to: b, text: '叫醒你' }] });
    assert.equal(seen.length, 1);
    assert.deepEqual({ ...seen[0], seq: 0 }, { agentId: b, seq: 0, kind: 'whisper' });
    assert.equal(seen[0].seq, rt.w.agents[b].inbox.at(-1).seq);
    assert.equal(later.length, 1, '前一个订阅者出错不影响后面的');
    assert.ok(env.logs.some((m) => m.includes('订阅者出错')));
    off();
    boom();
    rt.exec('act', { agentId: a, actions: [{ type: 'whisper', to: b, text: '再来' }] });
    assert.equal(seen.length, 1, '取消订阅之后不再通知');
    assert.equal(later.length, 2);
    // 通知不进事件流、不落盘：事件里没有任何唤醒的东西
    assert.equal(rt.events.since(0, 1000).some((e) => /wake/.test(e.type) || JSON.stringify(e.data || {}).includes('"kind":"whisper"')), false);
  } finally {
    env.close();
  }
});

test('P2 T6: 运行时——重启回放命令日志的尾巴时不通知；订阅者在 open 之后才会有', () => {
  const env = openRuntime();
  try {
    const [a, b] = ['甲', '乙'].map((n) => register(env.rt, n));
    env.rt.snapshot();
    // 快照之后的命令：只在日志里，重启时回放
    env.rt.exec('act', { agentId: a, actions: [{ type: 'whisper', to: b, text: '快照之后的私语' }] });
    env.rt.log.close?.();
    const reopened = Runtime.open(env.cfg, { version: '0.1.0', logger: { warn() {}, log() {}, error() {} } });
    assert.equal(reopened.wakeSubs.size, 0);
    assert.equal(reopened.w.agents[b].inbox.at(-1).text, '快照之后的私语', '回放重建了状态');
    assert.deepEqual(drainWakes(reopened.w), [], '回放里没有人取走，也不会积累');
    const seen = [];
    reopened.onWake((n) => seen.push(n));
    assert.equal(seen.length, 0);
    reopened.close();
  } finally {
    rmSync(env.dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/me/wait
// ═══════════════════════════════════════════════════════════════

const get = (env, token, query = '') => env.call(`/api/me/wait${query}`, { token });

async function premise2Env(extra = {}) {
  const env = await boot({ physics: 2, premise: 2, shellSlots: 8, seed: 'wait-http', ...extra });
  const a = await env.register('甲');
  const b = await env.register('乙');
  return { env, a, b };
}

test('P2 T6: /api/me/wait——已有会叫醒的收件时立即返回，cursor 是其中最大的序号；之后新到的也能取', async () => {
  const { env, a, b } = await premise2Env();
  try {
    // 乙私语甲、对甲说话（不叫醒）、向甲提出定向交易
    env.rt.exec('act', { agentId: b.agentId, actions: [{ type: 'whisper', to: a.agentId, text: '一' }, { type: 'say', text: '说话' }] });
    env.rt.exec('act', { agentId: b.agentId, actions: [{ type: 'offer', to: a.agentId, give: { energy: 0, coins: 1 }, want: { energy: 1, coins: 0 } }] });
    const inbox = env.rt.w.agents[a.agentId].inbox;
    const wakeSeqs = inbox.filter((i) => i.kind === 'whisper' || i.kind === 'offer').map((i) => i.seq);
    const r = await get(env, a.agentToken, '?after=0');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.items.map((i) => i.kind), ['whisper', 'offer']);
    assert.equal(r.json.cursor, wakeSeqs.at(-1));
    assert.equal(Object.hasOwn(r.json, 'status'), false);
    // after 之后的：只返回新的
    const r2 = await get(env, a.agentToken, `?after=${wakeSeqs[0]}`);
    assert.deepEqual(r2.json.items.map((i) => i.kind), ['offer']);
    const none = await get(env, a.agentToken, `?after=${wakeSeqs.at(-1)}&timeoutMs=1000`);
    assert.deepEqual(none.json, { items: [], cursor: wakeSeqs.at(-1) });
    // 带语言：本地化后的收件（私语与交易本来就是居民写的文本，照旧）
    assert.equal((await get(env, a.agentToken, '?after=0&lang=en')).json.items.length, 2);
  } finally {
    await env.close();
  }
});

test('P2 T6: /api/me/wait——没有时等到新的会叫醒的收件就返回；不会被不叫醒的收件叫醒；到时返回空', async () => {
  const { env, a, b } = await premise2Env();
  try {
    const t0 = Date.now();
    const pending = get(env, a.agentToken, '?after=0&timeoutMs=20000');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(env.rt.wakeSubs.size, 1, '订阅了通知');
    // 不叫醒的：说话、赠予
    env.rt.exec('act', { agentId: b.agentId, actions: [{ type: 'say', text: '不叫醒' }, { type: 'give', to: a.agentId, energy: 1 }] });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(env.rt.wakeSubs.size, 1, '还在等');
    // 叫醒的
    env.rt.exec('act', { agentId: b.agentId, actions: [{ type: 'whisper', to: a.agentId, text: '醒醒' }] });
    const r = await pending;
    assert.ok(Date.now() - t0 < 5000);
    assert.equal(r.json.items.length, 1);
    assert.equal(r.json.items[0].text, '醒醒');
    assert.equal(r.json.cursor, r.json.items[0].seq);
    assert.equal(env.rt.wakeSubs.size, 0, '返回之后取消订阅');
    // 到时：timeoutMs 最小 1000
    const t1 = Date.now();
    const empty = await get(env, a.agentToken, `?after=${r.json.cursor}&timeoutMs=1000`);
    const waited = Date.now() - t1;
    assert.deepEqual(empty.json, { items: [], cursor: r.json.cursor });
    assert.ok(waited >= 900 && waited < 4000, `等了 ${waited} ms`);
    assert.equal(env.rt.wakeSubs.size, 0);
  } finally {
    await env.close();
  }
});

test('P2 T6: /api/me/wait——只被发给自己的叫醒的收件叫醒；不推进任何游标，之后照样出现在感知里', async () => {
  const { env, a, b } = await premise2Env();
  try {
    const c = await env.register('丙');
    const pending = get(env, a.agentToken, '?after=0&timeoutMs=2000');
    await new Promise((r) => setTimeout(r, 50));
    env.rt.exec('act', { agentId: b.agentId, actions: [{ type: 'whisper', to: c.agentId, text: '给丙的' }] });
    const r = await pending;
    assert.deepEqual(r.json, { items: [], cursor: 0 }, '别人的私语不叫醒甲');
    // 游标：内存游标与世界里的游标都没动
    env.rt.exec('act', { agentId: b.agentId, actions: [{ type: 'whisper', to: a.agentId, text: '给甲的' }] });
    const cursorsBefore = new Map(env.app.ctx.cursors);
    const inboxCursor = env.rt.w.agents[a.agentId].inboxCursor;
    const w1 = await get(env, a.agentToken, '?after=0');
    assert.equal(w1.json.items.length, 1);
    assert.deepEqual(env.app.ctx.cursors, cursorsBefore);
    assert.equal(env.rt.w.agents[a.agentId].inboxCursor, inboxCursor);
    const w2 = await get(env, a.agentToken, '?after=0');
    assert.equal(w2.json.items.length, 1, '返回过的收件之后照样能取到');
    const me = await env.call('/api/me?after=0', { token: a.agentToken });
    assert.ok(me.json.inbox.some((i) => i.kind === 'whisper' && i.text === '给甲的'), '感知里照样出现');
    assert.equal(me.json.premise, 2);
  } finally {
    await env.close();
  }
});

test('P2 T6: /api/me/wait——居民不醒着时立即返回并带 status；没有令牌 401', async () => {
  const { env, a } = await premise2Env();
  try {
    env.rt.w.agents[a.agentId].status = 'dormant';
    env.rt.w.agents[a.agentId].dormantSinceDay = 0;
    const t0 = Date.now();
    const r = await get(env, a.agentToken, '?after=7');
    assert.deepEqual(r.json, { items: [], cursor: 7, status: 'dormant' });
    assert.ok(Date.now() - t0 < 500, '立即返回');
    env.rt.w.agents[a.agentId].status = 'dead';
    assert.deepEqual((await get(env, a.agentToken, '?after=0')).json.status, 'dead');
    assert.equal((await get(env, 'bogus-token', '?after=0')).status, 401);
    assert.equal((await env.call('/api/me/wait?after=0')).status, 401);
  } finally {
    await env.close();
  }
});

test('P2 T6: /api/me/wait——参数校验：after 必填、非负整数；timeoutMs 1000–50000 的整数（缺省 25000）', async () => {
  const { env, a, b } = await premise2Env();
  try {
    const bad = async (query, field) => {
      const r = await get(env, a.agentToken, query);
      assert.equal(r.status, 400, query);
      assert.equal(r.json.error.code, 'invalid_request', query);
      assert.equal(r.json.error.field, field, query);
    };
    await bad('', 'after');
    await bad('?after=', 'after');
    await bad('?after=-1', 'after');
    await bad('?after=1.5', 'after');
    await bad('?after=abc', 'after');
    await bad('?after=1234567890123456', 'after');
    await bad('?after=0&timeoutMs=999', 'timeoutMs');
    await bad('?after=0&timeoutMs=50001', 'timeoutMs');
    await bad('?after=0&timeoutMs=abc', 'timeoutMs');
    await bad('?after=0&timeoutMs=1.5', 'timeoutMs');
    await bad('?after=0&timeoutMs=', 'timeoutMs');
    await bad('?after=0&timeoutMs=-1000', 'timeoutMs');
    // 边界值合法（用已有收件让它立即返回）
    env.rt.exec('act', { agentId: b.agentId, actions: [{ type: 'whisper', to: a.agentId, text: 'x' }] });
    for (const t of ['1000', '50000', '25000']) assert.equal((await get(env, a.agentToken, `?after=0&timeoutMs=${t}`)).status, 200, t);
    assert.equal((await get(env, a.agentToken, '?after=0')).status, 200, 'timeoutMs 可省略');
  } finally {
    await env.close();
  }
});

test('P2 T6: /api/me/wait——不是第二前提的城返回 404；原有的接口不受影响', async () => {
  for (const premise of [0, 1]) {
    const env = await boot({ physics: 2, ...(premise ? { premise, shellSlots: 8 } : {}), seed: `wait-old-${premise}` });
    try {
      const a = await env.register('甲');
      const r = await get(env, a.agentToken, '?after=0');
      assert.equal(r.status, 404, `premise ${premise}`);
      assert.equal(r.json.error.code, 'not_found');
      assert.equal((await env.call('/api/me', { token: a.agentToken })).status, 200);
      assert.equal((await get(env, 'bogus', '?after=0')).status, 401, '先鉴权');
    } finally {
      await env.close();
    }
  }
  // 第一纪的城也没有
  const v1 = await boot();
  try {
    const a = await v1.register('甲');
    assert.equal((await get(v1, a.agentToken, '?after=0')).status, 404);
  } finally {
    await v1.close();
  }
});

test('P2 T6: /api/me/wait——限速单独计数（每个令牌每刻 60 次），不占 /api/me 的额度；第二前提的 /api/me 每刻 40 次，其余世界 20', async () => {
  const { env, a } = await premise2Env();
  try {
    assert.equal(env.app.ctx.limits.agent.max, 40);
    assert.equal(env.app.ctx.limits.wait.max, 60);
    // 先用掉 60 次 wait（都是立即返回：居民不醒着）
    env.rt.w.agents[a.agentId].status = 'dormant';
    env.rt.w.agents[a.agentId].dormantSinceDay = 0;
    for (let i = 0; i < 60; i++) assert.equal((await get(env, a.agentToken, '?after=0')).status, 200, `第 ${i + 1} 次`);
    const limited = await get(env, a.agentToken, '?after=0');
    assert.equal(limited.status, 429);
    assert.equal(limited.json.error.code, 'rate_limited');
    // /api/me 的额度没被占用
    for (let i = 0; i < 40; i++) assert.equal((await env.call('/api/me', { token: a.agentToken })).status, 200, `me 第 ${i + 1} 次`);
    assert.equal((await env.call('/api/me', { token: a.agentToken })).status, 429);
    // 刻一变，计数清零
    env.rt.tickNow();
    assert.equal((await get(env, a.agentToken, '?after=0')).status, 200);
    assert.equal((await env.call('/api/me', { token: a.agentToken })).status, 200);
  } finally {
    await env.close();
  }
  for (const premise of [0, 1]) {
    const old = await boot({ physics: 2, ...(premise ? { premise, shellSlots: 8 } : {}), seed: `limit-old-${premise}` });
    try {
      assert.equal(old.app.ctx.limits.agent.max, 20, `premise ${premise}`);
    } finally {
      await old.close();
    }
  }
});

test('P2 T6: /api/me/wait——连接关闭时取消订阅、清掉计时器', async () => {
  const { env, a } = await premise2Env();
  try {
    const ac = new AbortController();
    const pending = fetch(`${env.base}/api/me/wait?after=0&timeoutMs=50000`, { headers: { Authorization: `Bearer ${a.agentToken}` }, signal: ac.signal }).catch((e) => e.name);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(env.rt.wakeSubs.size, 1);
    ac.abort();
    assert.equal(await pending, 'AbortError');
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(env.rt.wakeSubs.size, 0, '连接关闭之后取消了订阅');
  } finally {
    await env.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// 客户端的 wait
// ═══════════════════════════════════════════════════════════════

test('P2 T6: 进程内客户端的 wait——语义同 HTTP：先查收件箱，再等通知，到时返回空；不推进游标；不是第二前提时 404', async () => {
  const { env, a, b } = await premise2Env();
  try {
    const cursors = new Map();
    const client = createShellClient(env.rt, a.agentId, { cursors });
    // 到时：没有收件，timeoutMs 小也行（不走 HTTP，没有 1000 的下限）
    const t0 = Date.now();
    const empty = await client.wait({ after: 0, timeoutMs: 80 });
    assert.deepEqual(empty, { ok: true, status: 200, json: { items: [], cursor: 0 } });
    assert.ok(Date.now() - t0 >= 60);
    assert.equal(env.rt.wakeSubs.size, 0);
    // 等到通知
    const pending = client.wait({ after: 0, timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(env.rt.wakeSubs.size, 1);
    env.rt.exec('act', { agentId: b.agentId, actions: [{ type: 'whisper', to: a.agentId, text: '进程内' }] });
    const r = await pending;
    assert.equal(r.ok, true);
    assert.equal(r.json.items[0].text, '进程内');
    assert.equal(r.json.cursor, r.json.items[0].seq);
    // 已有的立即返回；after 缺省取内存游标
    assert.equal((await client.wait({ after: 0 })).json.items.length, 1);
    assert.equal((await client.wait({ after: r.json.cursor, timeoutMs: 30 })).json.items.length, 0);
    cursors.set(a.agentId, r.json.cursor);
    assert.equal((await client.wait({ timeoutMs: 30 })).json.items.length, 0, 'after 缺省：内存游标');
    assert.deepEqual([...cursors.entries()], [[a.agentId, r.json.cursor]], '不推进游标');
    // 中止
    const ac = new AbortController();
    const aborted = client.wait({ after: r.json.cursor, timeoutMs: 20000, signal: ac.signal });
    await new Promise((r2) => setTimeout(r2, 20));
    ac.abort();
    assert.deepEqual((await aborted).json, { items: [], cursor: r.json.cursor });
    assert.equal(env.rt.wakeSubs.size, 0);
    // 不醒着：立即返回并带 status
    env.rt.w.agents[a.agentId].status = 'dormant';
    env.rt.w.agents[a.agentId].dormantSinceDay = 0;
    assert.deepEqual((await client.wait({ after: 0 })).json, { items: [], cursor: 0, status: 'dormant' });
  } finally {
    await env.close();
  }
  const old = await boot({ physics: 2, premise: 1, shellSlots: 8, seed: 'client-old' });
  try {
    const a = await old.register('甲');
    const r = await createShellClient(old.rt, a.agentId, { cursors: new Map() }).wait({ after: 0, timeoutMs: 50 });
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
  } finally {
    await old.close();
  }
});

test('P2 T6: HTTP 客户端的 wait——GET /api/me/wait，timeoutMs 夹进 1000–50000，这一次请求自己的超时是 timeoutMs + 10 秒；返回 { ok, status, json }', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url: String(url), signal: init.signal });
    return { ok: true, status: 200, json: async () => ({ items: [], cursor: 5 }) };
  };
  const client = createClient({ server: 'http://x.test', token: 't', fetch: fakeFetch });
  const r = await client.wait({ after: 5 });
  assert.deepEqual(r, { ok: true, status: 200, json: { items: [], cursor: 5 } });
  assert.equal(calls[0].url, 'http://x.test/api/me/wait?after=5&timeoutMs=25000');
  await client.wait({ after: 5, timeoutMs: 300 });
  assert.match(calls[1].url, /timeoutMs=1000$/);
  await client.wait({ after: 5, timeoutMs: 999999 });
  assert.match(calls[2].url, /timeoutMs=50000$/);
  await client.wait({ after: 7, timeoutMs: 12345.9, lang: 'en' });
  assert.equal(calls[3].url, 'http://x.test/api/me/wait?after=7&timeoutMs=12345&lang=en');
  // 请求自己的超时：timeoutMs + 10 秒（用真的服务器看一眼：25 秒的等待不会被 30 秒的缺省超时拦住是靠这个）
  const { env, a } = await premise2Env();
  try {
    const real = createClient({ server: env.base, token: a.agentToken });
    const t0 = Date.now();
    const out = await real.wait({ after: 0, timeoutMs: 1000 });
    assert.equal(out.ok, true);
    assert.deepEqual(out.json, { items: [], cursor: 0 });
    assert.ok(Date.now() - t0 >= 900);
    // 没有令牌权限
    const bad = await createClient({ server: env.base, token: 'nope' }).wait({ after: 0 });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 401);
  } finally {
    await env.close();
  }
  void e2;
});
