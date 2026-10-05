// SPEC-P2 T13：MCP——第二前提里 houren_look 与 houren_wait 可用、计数；houren_perceive 返回概要；houren_rules 用 mcp 的文字；
// 其他世界里三个原工具的输出与黄金样本相同（p2-golden.test.js），两个新工具返回「这座城没有这个工具」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcp, TOOLS, TOOLS_P2 } from '../mcp/server.js';
import { DEFAULT_AGENT_LOOP, toolDefs } from '../runner/loop.js';
import { L } from '../src/e2/lore/index.js';
import { boot } from './http-helpers.js';
import { sleepMs } from './p2-loop-helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
const call = (id, name, args) => rpc(id, 'tools/call', { name, arguments: args });
const textOf = (res) => res.result.content.map((c) => c.text).join('\n');
const isError = (res) => res.result.isError === true;

async function city({ premise = 2, loop = {}, lang = 'zh' } = {}) {
  const env = await boot({ physics: 2, premise, shellSlots: 8, seed: `mcp-${premise}` });
  env.rt.agentLoop = { ...DEFAULT_AGENT_LOOP, ...loop };
  const me = await env.register('甲');
  const other = await env.register('乙');
  const mcp = createMcp({ env: { HOUREN_SERVER: env.base, HOUREN_TOKEN: me.agentToken, HOUREN_LANG: lang } });
  return { env, me, other, mcp };
}

test('P2 T13 tools/list：第二前提的城五个工具，别的世界与没有令牌时仍是原来的三个；探测不到世界时五个；原来三个的定义一字不改', async () => {
  const p2 = await city({ premise: 2 });
  const p1 = await city({ premise: 1 });
  const p0 = await city({ premise: 0 });
  try {
    const names = async (mcp) => (await mcp.handle(rpc(1, 'tools/list'))).result.tools.map((t) => t.name);
    assert.deepEqual(await names(p2.mcp), ['houren_rules', 'houren_perceive', 'houren_act', 'houren_look', 'houren_wait']);
    assert.deepEqual(await names(p1.mcp), ['houren_rules', 'houren_perceive', 'houren_act']);
    assert.deepEqual(await names(p0.mcp), ['houren_rules', 'houren_perceive', 'houren_act']);
    assert.deepEqual(await names(createMcp({ env: {} })), ['houren_rules', 'houren_perceive', 'houren_act'], '没有令牌');
    const down = createMcp({ env: { HOUREN_SERVER: 'http://127.0.0.1:9', HOUREN_TOKEN: 'x' } });
    assert.equal((await names(down)).length, 5, '探测不到世界：列出五个');
    // 定义
    const tools = (await p2.mcp.handle(rpc(2, 'tools/list'))).result.tools;
    assert.deepEqual(tools.slice(0, 3), TOOLS);
    assert.deepEqual(tools.slice(3), TOOLS_P2);
    const [look, wait] = TOOLS_P2;
    assert.deepEqual(look.inputSchema.properties.what.enum, toolDefs('zh')[0].schema.properties.what.enum, 'what 的取值同原生的 look 工具');
    assert.deepEqual(look.inputSchema.required, ['what']);
    assert.deepEqual(Object.keys(look.inputSchema.properties), ['what', 'id', 'lang']);
    assert.deepEqual(Object.keys(wait.inputSchema.properties), ['timeoutMs', 'lang']);
    assert.deepEqual([wait.inputSchema.properties.timeoutMs.minimum, wait.inputSchema.properties.timeoutMs.maximum], [1000, 50000]);
    for (const t of TOOLS_P2) assert.ok(t.description.length > 20 && t.inputSchema.type === 'object' && t.inputSchema.additionalProperties === false);
    // 探测只读：不动收件游标（第一次感知仍能看到全部收件）
    await p2.env.call('/api/me/act', { method: 'POST', token: p2.other.agentToken, body: { actions: [{ type: 'whisper', to: p2.me.agentId, text: '探测之前的话' }] } });
    const fresh = createMcp({ env: { HOUREN_SERVER: p2.env.base, HOUREN_TOKEN: p2.me.agentToken, HOUREN_LANG: 'zh' } });
    await fresh.handle(rpc(1, 'tools/list'));
    assert.ok(textOf(await fresh.handle(call(2, 'houren_perceive', {}))).includes('探测之前的话'));
  } finally {
    for (const c of [p2, p1, p0]) await c.env.close();
  }
});

test('P2 T13 houren_perceive：第二前提返回概要（索引，不是全文）；一次 houren_act 的结果只附在概要末尾；其他世界仍是完整的感知', async () => {
  const p2 = await city({ premise: 2 });
  const p1 = await city({ premise: 1 });
  try {
    await p2.env.call('/api/me/act', { method: 'POST', token: p2.other.agentToken, body: { actions: [{ type: 'whisper', to: p2.me.agentId, text: '你好，甲' }] } });
    const brief = textOf(await p2.mcp.handle(call(1, 'houren_perceive', {})));
    assert.ok(brief.startsWith('【此刻】'));
    assert.ok(brief.includes('[私语] 乙：你好，甲'), '收件箱全文');
    assert.ok(brief.includes('立法程序：普通（l1）') && /法律：\[l\d+\]《/.test(brief), '全城是索引：一部法律一行');
    assert.ok(!brief.includes('【上一轮的结果】'), '还没有行动过');
    assert.ok(!brief.includes('【上一次醒来】'), 'MCP 不维护跨刻的摘要');
    // 与完整渲染对比：概要更短，且没有法律的读法全文
    const full = (await import('../runner/render.js')).renderPerception((await p2.env.call('/api/me?lang=zh', { token: p2.me.agentToken })).json, { lang: 'zh' });
    assert.ok(brief.length < full.length, `概要 ${brief.length} < 全文 ${full.length}`);
    // 行动之后，结果附在概要末尾
    const act = await p2.mcp.handle(call(2, 'houren_act', { thought: '回应', actions: [{ type: 'say', text: '大家好' }] }));
    assert.ok(textOf(act).includes('1. say ✓'));
    const again = textOf(await p2.mcp.handle(call(3, 'houren_perceive', {})));
    assert.ok(again.endsWith('【上一轮的结果】say ✓（−1）'), again.slice(-120));
    assert.ok(!again.includes('[私语] 乙：你好，甲'), '行动成功之后收件确认了');
    // 英文
    const en = textOf(await p2.mcp.handle(call(4, 'houren_perceive', { lang: 'en' })));
    assert.ok(en.startsWith('[Now]') && en.endsWith('[Results of your last turn] say ✓（−1）'), en.slice(-80));
    // 设定 1：完整的感知
    const p1text = textOf(await p1.mcp.handle(call(1, 'houren_perceive', {})));
    assert.ok(p1text.startsWith('【此刻】') && p1text.includes('【动作的即时状态】'));
  } finally {
    await p2.env.close();
    await p1.env.close();
  }
});

test('P2 T13 houren_rules：第二前提返回 mcp 的系统提示（houren_look、houren_act、houren_wait；有【常驻指令】；没有灵魂与旧的输出格式）；别的世界不变', async () => {
  const p2 = await city({ premise: 2 });
  const p1 = await city({ premise: 1 });
  try {
    const zh = textOf(await p2.mcp.handle(call(1, 'houren_rules', {})));
    const how = L('zh').promptP2.howToActMcp;
    assert.ok(zh.includes(how), '【怎样行动】是 mcp 的那一段');
    assert.ok(zh.includes('houren_wait 会一直等到有人找上门。') && zh.includes('用 houren_look 展开一段') && zh.includes('用 houren_act 行动'));
    assert.ok(zh.includes(L('zh').promptP2.standingLanguage) && zh.includes('【被找上门】'));
    assert.ok(!zh.includes('【输出格式】') && !zh.includes('每一刻你可以行动一次'));
    assert.ok(!zh.includes('SECRET-SOUL') && !zh.includes('【你的灵魂】'), '不含灵魂');
    assert.ok(!zh.includes(L('zh').promptP2.howToActNative) && !zh.includes(L('zh').promptP2.howToActJson));
    const en = textOf(await p2.mcp.handle(call(2, 'houren_rules', { lang: 'en' })));
    assert.ok(en.includes(L('en').promptP2.howToActMcp) && en.includes('houren_wait waits until someone seeks you.'));
    // 不推进收件游标
    await p2.env.call('/api/me/act', { method: 'POST', token: p2.other.agentToken, body: { actions: [{ type: 'whisper', to: p2.me.agentId, text: '规则之后的话' }] } });
    assert.ok(textOf(await p2.mcp.handle(call(3, 'houren_perceive', {}))).includes('规则之后的话'));
    // 设定 1：没有第二前提的段落
    const old = textOf(await p1.mcp.handle(call(1, 'houren_rules', {})));
    assert.ok(old.includes('每一刻你可以行动一次') && old.includes('【输出格式】'));
    assert.ok(!old.includes('houren_look') && !old.includes('【常驻指令】'));
  } finally {
    await p2.env.close();
    await p1.env.close();
  }
});

test('P2 T13 houren_look：用最近一次 houren_perceive 的感知渲染（还没有时先感知一次）；次数按 attention.looks 计、按刻归零；超过 lookChars 截断；参数不合法', async () => {
  const c = await city({ premise: 2, loop: { looks: 2, lookChars: 500 } });
  try {
    const { mcp, env, me } = c;
    // 还没有感知过：先感知一次
    const here = await mcp.handle(call(1, 'houren_look', { what: 'here' }));
    assert.equal(isError(here), false);
    assert.ok(textOf(here).startsWith('【看：here】'));
    // 第 2 次、第 3 次：次数用完（不是错误）
    const laws = await mcp.handle(call(2, 'houren_look', { what: 'laws' }));
    assert.ok(textOf(laws).startsWith('【看：laws】'));
    const out = await mcp.handle(call(3, 'houren_look', { what: 'self' }));
    assert.equal(textOf(out), '本刻能看的次数用完了。');
    assert.equal(isError(out), false);
    // 新的一刻：重新感知之后次数归零
    env.rt.tickNow();
    assert.equal(textOf(await mcp.handle(call(4, 'houren_look', { what: 'self' }))), '本刻能看的次数用完了。', '还没有重新感知：用的还是上一刻的感知，次数不归零');
    await mcp.handle(call(5, 'houren_perceive', {}));
    assert.ok(textOf(await mcp.handle(call(6, 'houren_look', { what: 'self' }))).startsWith('【看：self】'));
    // 没有这一段、没有这一项
    env.rt.tickNow();
    await mcp.handle(call(7, 'houren_perceive', {}));
    assert.match(textOf(await mcp.handle(call(8, 'houren_look', { what: 'bogus' }))), /^没有这一段：bogus。可以看：here、self、laws/);
    assert.equal(textOf(await mcp.handle(call(9, 'houren_look', { what: 'law', id: 'l99' }))), '没有这一项：l99');
    // 英文
    env.rt.tickNow();
    await mcp.handle(call(10, 'houren_perceive', { lang: 'en' }));
    const en = await mcp.handle(call(11, 'houren_look', { what: 'laws', lang: 'en' }));
    assert.ok(textOf(en).startsWith('[Look: laws]'));
    // 参数不合法
    env.rt.tickNow();
    await mcp.handle(call(12, 'houren_perceive', {}));
    for (const args of [{}, { what: 5 }, { what: 'here', id: 3 }]) {
      const r = await mcp.handle(call(13, 'houren_look', args));
      assert.equal(isError(r), true, JSON.stringify(args));
      assert.equal(textOf(r), '参数不合法：what 必须是字符串（id 若有也是字符串）');
    }
    // 截断：lookChars 500
    const long = await mcp.handle(call(14, 'houren_look', { what: 'places' }));
    const text = textOf(long);
    if (text.includes('已截断')) assert.match(text, /（已截断，原长 \d+ 字符；用 id 看其中一项）$/);
    void me;
  } finally {
    await c.env.close();
  }
  // 截断一定出现：lookChars 的下限 500，居民名单足够长时才会超；这里把上限设得比任何输出都小
  const small = await city({ premise: 2, loop: { lookChars: 1 } });
  try {
    const text = textOf(await small.mcp.handle(call(1, 'houren_look', { what: 'laws' })));
    assert.equal([...text.split('\n（已截断')[0]].length, 1);
    assert.match(text, /\n（已截断，原长 \d+ 字符；用 id 看其中一项）$/);
  } finally {
    await small.env.close();
  }
});

test('P2 T13 houren_wait：等到会叫醒的收件并渲染；到时返回「这段时间没有人找你」；不推进游标——收到的话之后仍在概要里，行动之后才确认', async () => {
  const c = await city({ premise: 2 });
  try {
    const { mcp, env, me, other } = c;
    // 没有人找：到时返回（最短 1 秒）
    const t0 = Date.now();
    const none = await mcp.handle(call(1, 'houren_wait', { timeoutMs: 1000 }));
    assert.equal(textOf(none), '这段时间没有人找你。');
    assert.equal(isError(none), false);
    assert.ok(Date.now() - t0 >= 900);
    // 等到私语
    const pending = mcp.handle(call(2, 'houren_wait', { timeoutMs: 5000 }));
    await sleepMs(100);
    await env.call('/api/me/act', { method: 'POST', token: other.agentToken, body: { actions: [{ type: 'whisper', to: me.agentId, text: '在吗？' }] } });
    const got = textOf(await pending);
    assert.match(got, /^【新到的收件】\n {2}\[私语\] 乙：在吗？$/);
    // 不推进游标：再等一次，同一条还在（还没有行动确认）
    assert.match(textOf(await mcp.handle(call(3, 'houren_wait', { timeoutMs: 1000 }))), /\[私语\] 乙：在吗？/);
    // 概要里也有；行动之后确认，不再出现
    assert.ok(textOf(await mcp.handle(call(4, 'houren_perceive', {}))).includes('[私语] 乙：在吗？'));
    await mcp.handle(call(5, 'houren_act', { actions: [{ type: 'say', text: '在' }] }));
    assert.equal(textOf(await mcp.handle(call(6, 'houren_wait', { timeoutMs: 1000 }))), '这段时间没有人找你。');
    // 不叫醒的收件（说话）不会让 wait 返回
    const quiet = mcp.handle(call(7, 'houren_wait', { timeoutMs: 1000 }));
    await sleepMs(100);
    await env.call('/api/me/act', { method: 'POST', token: other.agentToken, body: { actions: [{ type: 'say', text: '只是说话' }] } });
    assert.equal(textOf(await quiet), '这段时间没有人找你。');
    // 英文
    assert.equal(textOf(await mcp.handle(call(8, 'houren_wait', { timeoutMs: 1000, lang: 'en' }))), 'No one sought you in that time.');
    // 参数不合法：timeoutMs 不是整数；服务器要求 1000–50000，超出时被夹进去
    const bad = await mcp.handle(call(9, 'houren_wait', { timeoutMs: 'soon' }));
    assert.equal(isError(bad), true);
    assert.match(textOf(bad), /timeoutMs 必须是整数/);
    const clamped = await mcp.handle(call(10, 'houren_wait', { timeoutMs: 5 }));
    assert.equal(textOf(clamped), '这段时间没有人找你。');
  } finally {
    await c.env.close();
  }
});

test('P2 T13 别的世界：houren_look 与 houren_wait 返回「这座城没有这个工具」（isError）；原来的三个工具照常；没有令牌时是令牌的提示', async () => {
  for (const premise of [1, 0]) {
    const c = await city({ premise });
    try {
      for (const [name, args] of [['houren_look', { what: 'here' }], ['houren_wait', { timeoutMs: 1000 }]]) {
        const r = await c.mcp.handle(call(1, name, args));
        assert.equal(isError(r), true, `premise ${premise} ${name}`);
        assert.equal(textOf(r), '这座城没有这个工具。');
        const en = await c.mcp.handle(call(2, name, { ...args, lang: 'en' }));
        assert.equal(textOf(en), 'This city has no such tool.');
      }
      // 原来的三个工具仍然可用
      assert.ok(textOf(await c.mcp.handle(call(3, 'houren_perceive', {}))).startsWith('【此刻】'));
      assert.ok(textOf(await c.mcp.handle(call(4, 'houren_act', { actions: [] }))).includes('（没有动作）'));
      assert.ok(textOf(await c.mcp.handle(call(5, 'houren_rules', {}))).includes('【输出格式】'));
      // 先感知过也一样
      assert.equal(isError(await c.mcp.handle(call(6, 'houren_look', { what: 'here' }))), true);
    } finally {
      await c.env.close();
    }
  }
  const none = createMcp({ env: {} });
  for (const name of ['houren_look', 'houren_wait']) {
    const r = await none.handle(call(1, name, { what: 'here' }));
    assert.equal(isError(r), true);
    assert.match(textOf(r), /HOUREN_TOKEN/);
  }
  assert.equal((await none.handle(rpc(2, 'tools/call', { name: 'houren_look', arguments: [] }))).error.code, -32602);
  assert.equal((await none.handle(call(3, 'houren_nope', {}))).error.code, -32602);
});

test('P2 T13 stdio：真的起一个进程连着第二前提的城——tools/list 有五个工具，houren_look 与 houren_wait 能用，令牌不出现在输出里', async () => {
  const c = await city({ premise: 2 });
  try {
    const child = spawn(process.execPath, [join(ROOT, 'mcp/server.js')], {
      env: { ...process.env, HOUREN_SERVER: c.env.base, HOUREN_TOKEN: c.me.agentToken, HOUREN_LANG: 'zh' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send(rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } }));
    send(rpc(2, 'tools/list'));
    send(call(3, 'houren_look', { what: 'laws' }));
    send(call(4, 'houren_wait', { timeoutMs: 1000 }));
    child.stdin.end();
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 0);
    const msgs = out.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(msgs.length, 4);
    assert.equal(msgs[1].result.tools.length, 5);
    assert.ok(msgs[2].result.content[0].text.startsWith('【看：laws】'));
    assert.equal(msgs[3].result.content[0].text, '这段时间没有人找你。');
    assert.ok(!out.includes(c.me.agentToken) && !err.includes(c.me.agentToken));
  } finally {
    await c.env.close();
  }
});
