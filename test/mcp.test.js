// 测试 11（下）：MCP 服务——initialize / tools/list / tools/call，协议错误，「至少一次」的收件，
// 以及真正用 stdio 起一个进程说 JSON-RPC。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcp, TOOLS, SUPPORTED_VERSIONS, SERVER_INFO } from '../mcp/server.js';
import { boot } from './http-helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
const call = (id, name, args) => rpc(id, 'tools/call', { name, arguments: args });
const textOf = (res) => res.result.content.map((c) => c.text).join('\n');

// ── 协议（不需要服务器） ──────────────────────────────────────

test('initialize：客户端请求的版本是受支持的就原样返回，否则返回 2025-06-18；声明 tools 能力', async () => {
  const mcp = createMcp({ env: {} });
  for (const v of ['2025-06-18', '2025-03-26', '2024-11-05']) {
    const r = await mcp.handle(rpc(1, 'initialize', { protocolVersion: v, capabilities: {}, clientInfo: { name: 'x', version: '1' } }));
    assert.equal(r.jsonrpc, '2.0');
    assert.equal(r.id, 1);
    assert.equal(r.result.protocolVersion, v);
    assert.deepEqual(r.result.capabilities, { tools: {} });
    assert.deepEqual(r.result.serverInfo, SERVER_INFO);
  }
  assert.equal((await mcp.handle(rpc(2, 'initialize', { protocolVersion: '1999-01-01' }))).result.protocolVersion, '2025-06-18');
  assert.equal((await mcp.handle(rpc(3, 'initialize', {}))).result.protocolVersion, '2025-06-18');
  assert.equal((await mcp.handle(rpc('s', 'initialize'))).id, 's', 'id 可以是字符串');
  assert.deepEqual(SUPPORTED_VERSIONS, ['2025-06-18', '2025-03-26', '2024-11-05']);
});

test('通知没有响应；ping 返回空对象；未知方法 -32601；格式错误 -32600', async () => {
  const mcp = createMcp({ env: {} });
  assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }), null);
  assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'anything/unknown' }), null, '未知的通知也不响应');
  assert.deepEqual((await mcp.handle(rpc(7, 'ping'))).result, {});
  const nf = await mcp.handle(rpc(8, 'resources/list'));
  assert.equal(nf.error.code, -32601);
  assert.equal(nf.id, 8);
  for (const bad of [{ id: 9, method: 'ping' }, { jsonrpc: '2.0', id: 9 }, 'hello', 5, null, [1]]) {
    const r = await mcp.handle(bad);
    const one = Array.isArray(r) ? r[0] : r;
    assert.equal(one.error.code, -32600, JSON.stringify(bad));
  }
  assert.equal((await mcp.handle([])).error.code, -32600, '空批');
  // 批：通知不出现在响应里
  const batch = await mcp.handle([rpc(1, 'ping'), { jsonrpc: '2.0', method: 'notifications/initialized' }, rpc(2, 'tools/list')]);
  assert.equal(batch.length, 2);
  assert.equal(batch[1].result.tools.length, 3);
});

test('tools/list：三个工具，名字与输入模式符合约定', async () => {
  const mcp = createMcp({ env: {} });
  const r = await mcp.handle(rpc(1, 'tools/list'));
  assert.deepEqual(r.result.tools.map((t) => t.name), ['houren_rules', 'houren_perceive', 'houren_act']);
  assert.equal(r.result.tools, TOOLS);
  for (const t of r.result.tools) {
    assert.ok(t.description.length > 20);
    assert.equal(t.inputSchema.type, 'object');
  }
  const act = r.result.tools[2];
  assert.deepEqual(act.inputSchema.required, ['actions']);
  assert.equal(act.inputSchema.properties.actions.maxItems, 4);
  assert.deepEqual(act.inputSchema.properties.actions.items.required, ['type']);
  assert.equal(act.inputSchema.properties.thought.maxLength, 300);
  assert.deepEqual(r.result.tools[1].inputSchema.properties.lang.enum, ['zh', 'en']);
});

test('tools/call：参数错误是协议错误 -32602；没有令牌时工具返回 isError', async () => {
  const mcp = createMcp({ env: {} });
  assert.equal((await mcp.handle(rpc(1, 'tools/call', {}))).error.code, -32602);
  assert.equal((await mcp.handle(rpc(2, 'tools/call'))).error.code, -32602);
  assert.equal((await mcp.handle(call(3, 'houren_nope', {}))).error.code, -32602);
  assert.equal((await mcp.handle(rpc(4, 'tools/call', { name: 'houren_act', arguments: [] }))).error.code, -32602);
  assert.equal((await mcp.handle(rpc(5, 'tools/call', { name: 'houren_act', arguments: null }))).error.code, -32602);
  for (const name of ['houren_rules', 'houren_perceive', 'houren_act']) {
    const r = await mcp.handle(call(6, name, { actions: [] }));
    assert.equal(r.result.isError, true, name);
    assert.ok(textOf(r).includes('HOUREN_TOKEN'));
  }
});

// ── 与真实服务器对话 ──────────────────────────────────────────

async function setup(name = '青禾') {
  const env = await boot();
  const me = await env.register(name);
  const other = await env.register('松烟');
  const mcp = createMcp({ env: { HOUREN_SERVER: env.base, HOUREN_TOKEN: me.agentToken, HOUREN_LANG: 'zh' } });
  return { env, me, other, mcp };
}

test('houren_rules：系统提示（不含灵魂），不推进收件游标；lang 参数', async () => {
  const { env, me, other, mcp } = await setup();
  try {
    env.rt.exec('act', { agentId: other.agentId, actions: [{ type: 'whisper', to: me.agentId, text: '别丢了我' }] });
    const before = env.rt.w.agents[me.agentId].inboxCursor;
    const zh = textOf(await mcp.handle(call(1, 'houren_rules', {})));
    assert.ok(zh.includes('你是「无名之城」的一位居民'));
    assert.ok(zh.includes('move(to) 1'));
    assert.ok(zh.includes('retire(lastWords?)'));
    assert.ok(!zh.includes('【你的灵魂】') && !zh.includes('SECRET-SOUL'), '灵魂不在规则里');
    assert.ok(zh.includes('一次最多 4 个动作'));
    const en = textOf(await mcp.handle(call(2, 'houren_rules', { lang: 'en' })));
    assert.ok(en.includes('a resident of'));
    assert.ok(en.includes('move(to) 1'));
    assert.equal(env.rt.w.agents[me.agentId].inboxCursor, before, '规则调用不动收件游标');
    assert.ok(!zh.includes(me.agentToken) && !en.includes(me.agentToken));
  } finally {
    await env.close();
  }
});

test('houren_perceive → houren_act → houren_perceive：一次完整的感知与行动，结果出现在下一次感知的末尾', async () => {
  const { env, me, mcp } = await setup();
  try {
    const p1 = textOf(await mcp.handle(call(1, 'houren_perceive', {})));
    assert.ok(p1.startsWith('【此刻】'));
    assert.ok(p1.includes('青禾') && p1.includes('SECRET-SOUL-青禾') === false, '感知里没有灵魂原文以外的东西');
    assert.ok(p1.includes('【你在】港口 [port]'));
    assert.ok(p1.includes('松烟(a2)'));
    const act = await mcp.handle(call(2, 'houren_act', { thought: '来试试', actions: [{ type: 'say', text: '大家好' }, { type: 'move', to: 'nowhere' }] }));
    assert.equal(act.result.isError, undefined, '请求本身成功；单个动作失败不是工具错误');
    const t = textOf(act);
    assert.ok(t.includes('1. say ✓（−1）'));
    assert.ok(/2\. move ✗ /.test(t), t);
    assert.ok(t.includes('本刻还可行动 2 次'));
    const p2 = textOf(await mcp.handle(call(3, 'houren_perceive', { lang: 'en' })));
    assert.ok(p2.startsWith('[Now]'));
    assert.ok(p2.trimEnd().split('\n').at(-1).startsWith('[Results of your last turn] say ✓'));
    // 观测站看到了它的话；独白延迟公开
    const say = env.rt.events.since(0, 100).find((e) => e.type === 'say' && e.agent === me.agentId);
    assert.equal(say.data.text, '大家好');
  } finally {
    await env.close();
  }
});

test('收件「至少一次」：行动之前重复感知，收件不丢；成功行动之后才确认', async () => {
  const { env, me, other, mcp } = await setup();
  try {
    env.rt.exec('act', { agentId: other.agentId, actions: [{ type: 'whisper', to: me.agentId, text: 'PING-一' }] });
    const first = textOf(await mcp.handle(call(1, 'houren_perceive', {})));
    assert.ok(first.includes('PING-一'));
    const second = textOf(await mcp.handle(call(2, 'houren_perceive', {})));
    assert.ok(second.includes('PING-一'), '模型没有行动，再感知一次还能看到');
    env.rt.exec('act', { agentId: other.agentId, actions: [{ type: 'whisper', to: me.agentId, text: 'PING-二' }] });
    const third = textOf(await mcp.handle(call(3, 'houren_perceive', {})));
    assert.ok(third.includes('PING-一') && third.includes('PING-二'));
    // 失败的行动请求不确认
    const bad = await mcp.handle(call(4, 'houren_act', { actions: 'not-an-array' }));
    assert.equal(bad.result.isError, true);
    assert.ok((textOf(await mcp.handle(call(5, 'houren_perceive', {})))).includes('PING-一'));
    // 成功行动之后确认
    await mcp.handle(call(6, 'houren_act', { actions: [] }));
    const after = textOf(await mcp.handle(call(7, 'houren_perceive', {})));
    assert.ok(!after.includes('PING-一') && !after.includes('PING-二'), after);
    env.rt.exec('act', { agentId: other.agentId, actions: [{ type: 'whisper', to: me.agentId, text: 'PING-三' }] });
    assert.ok((await mcp.handle(call(8, 'houren_perceive', {}))).result.content[0].text.includes('PING-三'));
  } finally {
    await env.close();
  }
});

test('工具错误：令牌无效、服务器不可达、参数不对——都是 isError 而不是协议错误，且不泄露令牌', async () => {
  const { env, me } = await setup();
  try {
    const badTok = createMcp({ env: { HOUREN_SERVER: env.base, HOUREN_TOKEN: 'wrong-token-value' } });
    for (const [name, args] of [['houren_rules', {}], ['houren_perceive', {}], ['houren_act', { actions: [] }]]) {
      const r = await badTok.handle(call(1, name, args));
      assert.equal(r.result.isError, true, name);
      assert.ok(textOf(r).includes('unauthorized'), textOf(r));
      assert.ok(!textOf(r).includes('wrong-token-value'));
    }
    const down = createMcp({ env: { HOUREN_SERVER: 'http://127.0.0.1:1', HOUREN_TOKEN: me.agentToken } });
    const r = await down.handle(call(2, 'houren_perceive', {}));
    assert.equal(r.result.isError, true);
    assert.ok(!textOf(r).includes(me.agentToken));
    const ok = createMcp({ env: { HOUREN_SERVER: env.base, HOUREN_TOKEN: me.agentToken } });
    assert.equal((await ok.handle(call(3, 'houren_act', { thought: 5, actions: [] }))).result.isError, true);
    assert.equal((await ok.handle(call(4, 'houren_act', {}))).result.isError, true);
    // 世界暂停时行动被拒绝：工具错误，不是协议错误
    env.rt.exec('admin', { op: 'pause' });
    const paused = await ok.handle(call(5, 'houren_act', { actions: [{ type: 'say', text: 'x' }] }));
    assert.equal(paused.result.isError, true);
    assert.ok(textOf(paused).includes('paused'));
  } finally {
    await env.close();
  }
});

// ── stdio 进程 ────────────────────────────────────────────────

test('stdio：真的起一个进程说 JSON-RPC——stdout 只有协议消息，坏 JSON 得到 -32700，stdin 关闭后退出', async () => {
  const env = await boot();
  const me = await env.register('乙');
  try {
    const child = spawn(process.execPath, [join(ROOT, 'mcp/server.js')], {
      env: { ...process.env, HOUREN_SERVER: env.base, HOUREN_TOKEN: me.agentToken, HOUREN_LANG: 'zh' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const send = (m) => child.stdin.write(`${typeof m === 'string' ? m : JSON.stringify(m)}\n`);
    send(rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } }));
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send(rpc(2, 'tools/list'));
    send('{ this is not json');
    send('');
    send(call(3, 'houren_perceive', {}));
    send(call(4, 'houren_act', { actions: [{ type: 'say', text: '来自 stdio' }] }));
    send(rpc(5, 'no/such/method'));
    child.stdin.end();
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 0);
    const lines = out.trim().split('\n');
    const msgs = lines.map((l) => JSON.parse(l)); // stdout 的每一行都是一条 JSON
    for (const m of msgs) assert.equal(m.jsonrpc, '2.0');
    assert.equal(msgs.length, 6, '初始化通知与空行没有响应');
    assert.equal(msgs[0].id, 1);
    assert.equal(msgs[0].result.protocolVersion, '2025-06-18');
    assert.equal(msgs[1].id, 2);
    assert.equal(msgs[1].result.tools.length, 3);
    assert.deepEqual(msgs[2], { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    assert.equal(msgs[3].id, 3);
    assert.ok(msgs[3].result.content[0].text.startsWith('【此刻】'));
    assert.equal(msgs[4].id, 4);
    assert.ok(msgs[4].result.content[0].text.includes('1. say ✓'));
    assert.equal(msgs[5].error.code, -32601);
    assert.ok(!out.includes(me.agentToken) && !err.includes(me.agentToken), '令牌不出现在任何输出里');
    assert.ok(env.rt.events.since(0, 100).some((e) => e.type === 'say' && e.data.text === '来自 stdio'));
  } finally {
    await env.close();
  }
});
