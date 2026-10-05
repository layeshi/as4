// SPEC-P2 T9（提供者：原生工具调用、文本 JSON、mock 脚本）与 T10（超时 F2）。
// 三家的响应用录好的夹具：它们按各家文档的形状写成，含思考块、推理项、多个调用同在一轮。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createProvider, ProviderError, mockDecide } from '../runner/providers.js';
import { toolDefs, parseToolJson } from '../runner/loop.js';
import { modelFetch } from '../src/runner/endpoint.js';
import { parseShellsConfig, DEFAULTS } from '../src/shells/config.js';
import { runnerConfig } from '../src/runner/manager.js';
import { ShellManager } from '../src/shells/manager.js';
import { boot } from './http-helpers.js';
import { richP2World } from './p2-helpers.js';

const TOOLS = toolDefs('zh');
const LOOK = { name: 'look', description: '展开概要里的一段，看全文。每一刻能看的次数有限，看不花能量。', schema: TOOLS[0].schema };

// ═══════════════════════════════════════════════════════════════
// 工具的定义
// ═══════════════════════════════════════════════════════════════

test('P2 T9: 工具的中立定义——look 与 act 的 schema（附录 A.3），描述按居民的语言给', () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ['look', 'act']);
  assert.deepEqual(TOOLS[0].schema, {
    type: 'object',
    properties: { what: { type: 'string', enum: ['here', 'self', 'laws', 'law', 'proposals', 'proposal', 'procedure', 'groups', 'group', 'residents', 'places', 'refounds', 'cradle', 'lexicon', 'petitions'] }, id: { type: 'string' } },
    required: ['what'], additionalProperties: false,
  });
  assert.deepEqual(TOOLS[1].schema, {
    type: 'object',
    properties: {
      actions: { type: 'array', maxItems: 4, items: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] } },
      thought: { type: 'string', maxLength: 300 }, end: { type: 'boolean' },
    },
    required: ['actions'], additionalProperties: false,
  });
  assert.equal(TOOLS[0].description, LOOK.description);
  assert.equal(TOOLS[1].description, '行动：actions 至多 4 个，按顺序执行，结果立刻返回。thought 是你此刻的独白（可选）。end 为真表示做完这些就结束这次醒来。');
  const en = toolDefs('en');
  assert.equal(en[0].description, 'Open a section of your summary and read it in full. You can look only so many times each tick; looking costs no energy.');
  assert.ok(en[1].description.startsWith('Act: up to 4 actions'));
  assert.deepEqual(en.map((t) => t.schema), TOOLS.map((t) => t.schema));
});

// ═══════════════════════════════════════════════════════════════
// 文本 JSON 的解析
// ═══════════════════════════════════════════════════════════════

test('P2 T9: 文本 JSON——look（对象、数组、段名字符串）、act、done、混合（按 look、act、done 的顺序）；id 是 j1、j2……', () => {
  assert.deepEqual(parseToolJson('{"look": {"what": "here"}}'), { ok: true, calls: [{ id: 'j1', name: 'look', args: { what: 'here' } }] });
  assert.deepEqual(parseToolJson('{"look": {"what": "law", "id": "l3"}}').calls[0].args, { what: 'law', id: 'l3' });
  assert.deepEqual(parseToolJson('{"look": [{"what": "here"}, {"what": "proposal", "id": "p1"}]}').calls, [
    { id: 'j1', name: 'look', args: { what: 'here' } }, { id: 'j2', name: 'look', args: { what: 'proposal', id: 'p1' } }]);
  assert.deepEqual(parseToolJson('{"look": "laws"}').calls[0].args, { what: 'laws' }, '容忍直接写段名');
  assert.deepEqual(parseToolJson('{"look": ["here", {"what": "self"}]}').calls.map((c) => c.args), [{ what: 'here' }, { what: 'self' }]);
  assert.deepEqual(parseToolJson('{"act": {"thought": "想一想", "actions": [{"type": "say", "text": "hi"}], "end": true}}'),
    { ok: true, calls: [{ id: 'j1', name: 'act', args: { thought: '想一想', actions: [{ type: 'say', text: 'hi' }], end: true } }] });
  assert.deepEqual(parseToolJson('{"act": [{"type": "say", "text": "hi"}]}').calls[0].args, { actions: [{ type: 'say', text: 'hi' }] }, 'act 直接写动作数组');
  assert.deepEqual(parseToolJson('{"done": true}'), { ok: true, calls: [{ id: 'j1', name: 'done', args: {} }] });
  // 混合：不管键的先后，按 look、act、done 处理
  const mixed = parseToolJson('{"done": true, "act": {"actions": []}, "look": {"what": "here"}}');
  assert.deepEqual(mixed.calls.map((c) => [c.id, c.name]), [['j1', 'look'], ['j2', 'act'], ['j3', 'done']]);
  // 前后有话、代码围栏、字符串里的花括号
  assert.equal(parseToolJson('好的，我先看一眼。\n```json\n{"look": {"what": "here"}}\n```\n').calls[0].name, 'look');
  assert.deepEqual(parseToolJson('{"act": {"actions": [{"type": "say", "text": "里面有 {花括号}"}]}}').calls[0].args.actions[0].text, '里面有 {花括号}');
  // 第一个 JSON 对象
  assert.deepEqual(parseToolJson('{"look": {"what": "here"}} {"act": {"actions": []}}').calls.map((c) => c.name), ['look']);
});

test('P2 T9: 文本 JSON——没有 JSON、没有三种键、键的值不对：解析失败或 args 为 null（运行器给参数错误的结果）', () => {
  for (const text of ['', '   ', '我想想……', '{"thought": "只有独白"}', '{"actions": [{"type": "say", "text": "旧格式"}]}', '{"done": false}', '{"done": "yes"}', '[1, 2]', 'null']) {
    const r = parseToolJson(text);
    assert.equal(r.ok, false, JSON.stringify(text));
    assert.deepEqual(r.calls, []);
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(parseToolJson(undefined).ok, false);
  assert.equal(parseToolJson(5).ok, false);
  // 键在，但值不是对象：这一个调用的 args 为 null
  assert.deepEqual(parseToolJson('{"look": 5}').calls, [{ id: 'j1', name: 'look', args: null }]);
  assert.deepEqual(parseToolJson('{"look": [null, {"what": "here"}]}').calls.map((c) => c.args), [null, { what: 'here' }]);
  assert.deepEqual(parseToolJson('{"act": "say hi"}').calls, [{ id: 'j1', name: 'act', args: null }]);
  assert.deepEqual(parseToolJson('{"act": null}').calls, [{ id: 'j1', name: 'act', args: null }]);
});

// ═══════════════════════════════════════════════════════════════
// anthropic：原生工具调用
// ═══════════════════════════════════════════════════════════════

const THINKING = { type: 'thinking', thinking: '先看看法律，再决定投票。', signature: 'EqQBCkYIAxgCIkB...' };
const ANTHROPIC_REPLY = {
  id: 'msg_01XFDUDYJgAACzvnptvVoYEL', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content: [THINKING, { type: 'text', text: '我先看看法律。' },
    { type: 'tool_use', id: 'toolu_01A09q90qw90lq917835lq9', name: 'look', input: { what: 'laws' } },
    { type: 'tool_use', id: 'toolu_01B2c3d4e5f6g7h8i9j0k1l2', name: 'act', input: { thought: '先投票', actions: [{ type: 'vote', proposal: 'p1', choice: 'yes' }], end: true } }],
  stop_reason: 'tool_use', stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 150, cache_creation_input_tokens: 100, cache_read_input_tokens: 4000 },
};

/** 一个假的 Anthropic SDK：记下每次 create 的请求与选项，按顺序返回给定的响应（或抛出错误） */
function fakeAnthropic(responses) {
  const seen = [];
  class Anthropic {
    constructor(opts) { this.opts = opts; this.beta = { messages: { create: async (req, options) => { seen.push({ req, options }); const r = responses.shift(); if (r instanceof Error) throw r; return r; } } }; }
  }
  class AuthenticationError extends Error { constructor(m) { super(m); this.status = 401; } }
  class RateLimitError extends Error { constructor(m) { super(m); this.status = 429; } }
  class APIConnectionTimeoutError extends Error {}
  Object.assign(Anthropic, { AuthenticationError, RateLimitError, APIConnectionTimeoutError });
  return { seen, Anthropic, load: async () => ({ default: Anthropic }) };
}
const anthropic = async (responses, cfg = {}) => {
  const fake = fakeAnthropic(responses);
  const provider = await createProvider({ provider: 'anthropic', apiKeyEnv: 'K', ...cfg }, { loadAnthropic: fake.load, env: { K: 'unit-test-key' } });
  return { provider, fake };
};

test('P2 T9 anthropic: step——tools 转成 input_schema；一轮里有几个调用；思考块与 tool_use 块原样在 raw 里；用量含缓存', async () => {
  const { provider, fake } = await anthropic([structuredClone(ANTHROPIC_REPLY)]);
  assert.equal(typeof provider.step, 'function');
  const out = await provider.step({ system: 'SYS', transcript: [{ role: 'user', text: '概要……' }], tools: TOOLS });
  assert.deepEqual(out.calls, [
    { id: 'toolu_01A09q90qw90lq917835lq9', name: 'look', args: { what: 'laws' } },
    { id: 'toolu_01B2c3d4e5f6g7h8i9j0k1l2', name: 'act', args: { thought: '先投票', actions: [{ type: 'vote', proposal: 'p1', choice: 'yes' }], end: true } },
  ]);
  assert.equal(out.text, '我先看看法律。');
  assert.equal(out.stop, 'tool_use');
  assert.deepEqual(out.usage, { input: 1200 + 100 + 4000, output: 150 });
  assert.deepEqual(out.raw, { content: ANTHROPIC_REPLY.content }, '整段 content，含思考块');
  // 请求
  const { req, options } = fake.seen[0];
  assert.deepEqual(req.tools, TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })));
  assert.equal(req.model, 'claude-opus-5-5');
  assert.deepEqual(req.system, [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral', ttl: '1h' } }]);
  assert.deepEqual(req.output_config, { effort: 'medium' });
  assert.equal(options, undefined, '没有 signal 与 timeoutMs 时不带选项');
  // 最后一条消息是字符串：转成文本块，加缓存断点
  assert.deepEqual(req.messages, [{ role: 'user', content: [{ type: 'text', text: '概要……', cache_control: { type: 'ephemeral' } }] }]);
});

test('P2 T9 anthropic: step——中立记录 → 原生消息：助手的内容原样（含思考块与 tool_use）、工具结果成 tool_result（isError 带 is_error）；缓存断点加在最后一个块上且不改记录', async () => {
  const { provider, fake } = await anthropic([structuredClone(ANTHROPIC_REPLY), { content: [{ type: 'text', text: '好了' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 } }]);
  const first = await provider.step({ system: 'SYS', transcript: [{ role: 'user', text: '概要' }], tools: TOOLS });
  const transcript = [
    { role: 'user', text: '概要' },
    { role: 'assistant', raw: first.raw },
    { role: 'tool', results: [{ id: first.calls[0].id, name: 'look', text: '【看：laws】……', isError: false }, { id: first.calls[1].id, name: 'act', text: '参数不合法：x', isError: true }] },
  ];
  const snapshot = structuredClone(transcript);
  const out = await provider.step({ system: 'SYS', transcript, tools: TOOLS, signal: new AbortController().signal, timeoutMs: 23000 });
  assert.deepEqual(out.calls, []);
  assert.equal(out.stop, 'end_turn');
  assert.equal(out.text, '好了');
  const { req, options } = fake.seen[1];
  assert.equal(req.messages.length, 3);
  assert.deepEqual(req.messages[0], { role: 'user', content: '概要' }, '不是最后一条：不加缓存断点');
  assert.deepEqual(req.messages[1], { role: 'assistant', content: ANTHROPIC_REPLY.content }, '助手的内容原样传回，思考块的签名也在');
  assert.deepEqual(req.messages[2].content, [
    { type: 'tool_result', tool_use_id: 'toolu_01A09q90qw90lq917835lq9', content: '【看：laws】……' },
    { type: 'tool_result', tool_use_id: 'toolu_01B2c3d4e5f6g7h8i9j0k1l2', content: '参数不合法：x', is_error: true, cache_control: { type: 'ephemeral' } },
  ]);
  assert.equal(req.messages[2].role, 'user');
  assert.deepEqual(transcript, snapshot, '传进来的记录没有被改动（缓存断点加在副本上）');
  assert.equal(options.timeout, 23000);
  assert.ok(options.signal instanceof AbortSignal);
});

test('P2 T9 anthropic: step——拒绝、被 max_tokens 截断（不当作行动）、input 不是对象（args 为 null）；complete 不变（没有 tools）', async () => {
  const { provider, fake } = await anthropic([
    { content: [], stop_reason: 'refusal', stop_details: { category: 'x' }, usage: { input_tokens: 5, output_tokens: 1 } },
    { content: [{ type: 'text', text: '……' }, { type: 'tool_use', id: 't1', name: 'act', input: { actions: [] } }], stop_reason: 'max_tokens', usage: { input_tokens: 5, output_tokens: 99 } },
    { content: [{ type: 'tool_use', id: 't2', name: 'look', input: null }, { type: 'tool_use', id: 't3', name: 'look', input: 'what' }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: '{"actions":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 7, output_tokens: 3 } },
  ]);
  const base = { system: 'S', transcript: [{ role: 'user', text: 'u' }], tools: TOOLS };
  const refusal = await provider.step(base);
  assert.deepEqual([refusal.calls, refusal.text, refusal.stop, refusal.details], [[], '', 'refusal', { category: 'x' }]);
  assert.deepEqual(refusal.usage, { input: 5, output: 1 });
  const cut = await provider.step(base);
  assert.deepEqual(cut.calls, [], '截断的 tool_use 不当作行动');
  assert.equal(cut.stop, 'max_tokens');
  assert.equal(cut.text, '……');
  const bad = await provider.step(base);
  assert.deepEqual(bad.calls, [{ id: 't2', name: 'look', args: null }, { id: 't3', name: 'look', args: null }]);
  assert.equal(Object.hasOwn(bad, 'usage'), false, '响应没有用量就没有 usage');
  const done = await provider.complete({ system: 'S', messages: [{ role: 'user', content: 'u' }] });
  assert.deepEqual(done, { text: '{"actions":[]}', stop: 'end_turn', usage: { input: 7, output: 3 } });
  assert.equal(Object.hasOwn(fake.seen[3].req, 'tools'), false, 'complete 不带 tools');
  assert.deepEqual(fake.seen[3].req.messages, [{ role: 'user', content: 'u' }], 'complete 的消息不加缓存断点');
});

test('P2 T9 anthropic: step 的错误分级同 complete；fallbacks: false 时不带 betas', async () => {
  const fake = fakeAnthropic([]);
  const mk = async (cfg) => createProvider({ provider: 'anthropic', ...cfg }, { loadAnthropic: fake.load });
  const provider = await mk({});
  const reqs = { system: 'S', transcript: [{ role: 'user', text: 'u' }], tools: TOOLS };
  const make = (E, m = 'x') => new E(m);
  for (const [error, fatal, retryable] of [[make(fake.Anthropic.AuthenticationError), true, false], [make(fake.Anthropic.RateLimitError), false, true], [make(fake.Anthropic.APIConnectionTimeoutError), false, true]]) {
    const responses = [error];
    const { provider: p } = await anthropic(responses);
    await assert.rejects(p.step(reqs), (e) => e instanceof ProviderError && e.fatal === fatal && e.retryable === retryable);
  }
  const { provider: p2, fake: f2 } = await anthropic([{ content: [], stop_reason: 'end_turn' }], { fallbacks: false });
  await p2.step(reqs);
  assert.equal(Object.hasOwn(f2.seen[0].req, 'betas'), false);
  assert.equal(Object.hasOwn(f2.seen[0].req, 'fallbacks'), false);
  void provider;
});

// ═══════════════════════════════════════════════════════════════
// openai（chat completions）：原生工具调用
// ═══════════════════════════════════════════════════════════════

const CHAT_REPLY = {
  id: 'chatcmpl-9', object: 'chat.completion',
  choices: [{ index: 0, finish_reason: 'tool_calls', message: {
    role: 'assistant', content: null, reasoning_content: '先看法律，再投票。',
    tool_calls: [
      { id: 'call_1', type: 'function', function: { name: 'look', arguments: '{"what":"laws"}' } },
      { id: 'call_2', type: 'function', function: { name: 'act', arguments: '{"actions":[{"type":"say","text":"大家好"}],"end":true}' } },
      { id: 'call_3', type: 'function', function: { name: 'act', arguments: '{"actions":[{"type":"say"' } },
    ],
  } }],
  usage: { prompt_tokens: 1000, completion_tokens: 120, completion_tokens_details: { reasoning_tokens: 40 } },
};

/** 假的 fetch：记下请求，按顺序返回响应的 JSON */
function fakeFetch(responses) {
  const calls = [];
  return { calls, fetch: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return new Response(JSON.stringify(responses.shift())); } };
}

test('P2 T9 openai: step——tools 与 tool_choice；不发 jsonMode；extraBody 不能覆盖 tools；calls 逐个解析 arguments（坏的 args 为 null）；raw 是整条 message', async () => {
  const f = fakeFetch([structuredClone(CHAT_REPLY)]);
  const provider = await createProvider({
    provider: 'openai', model: 'glm-5.3', baseURL: 'https://gw.example/v1', apiKeyEnv: 'K', jsonMode: true, maxTokens: 1200,
    extraBody: { thinking: { type: 'disabled' }, tools: [{ type: 'function', function: { name: 'hijack' } }], tool_choice: 'none' },
  }, { env: { K: 'unit-test-key' }, fetch: f.fetch });
  const out = await provider.step({ system: 'SYS', transcript: [{ role: 'user', text: '概要' }], tools: TOOLS });
  const body = f.calls[0].body;
  assert.equal(f.calls[0].url, 'https://gw.example/v1/chat/completions');
  assert.deepEqual(body.tools, TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })));
  assert.equal(body.tool_choice, 'auto');
  assert.equal(Object.hasOwn(body, 'response_format'), false, '原生方式不发 jsonMode');
  assert.deepEqual(body.thinking, { type: 'disabled' }, '其余的 extraBody 照旧');
  assert.equal(body.max_tokens, 1200);
  assert.deepEqual(body.messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: '概要' }]);
  assert.deepEqual(out.calls, [
    { id: 'call_1', name: 'look', args: { what: 'laws' } },
    { id: 'call_2', name: 'act', args: { actions: [{ type: 'say', text: '大家好' }], end: true } },
    { id: 'call_3', name: 'act', args: null },
  ]);
  assert.equal(out.text, '');
  assert.equal(out.stop, 'tool_calls');
  assert.deepEqual(out.usage, { input: 1000, output: 120, reasoning: 40 });
  assert.deepEqual(out.raw, { message: CHAT_REPLY.choices[0].message }, '整条 message，含推理内容');
  // complete 仍带 jsonMode、不带 tools
  const f2 = fakeFetch([{ choices: [{ message: { content: '{"actions":[]}' }, finish_reason: 'stop' }] }]);
  const p2 = await createProvider({ provider: 'openai', model: 'm', jsonMode: true }, { fetch: f2.fetch });
  await p2.complete({ system: 'S', messages: [{ role: 'user', content: 'u' }] });
  assert.deepEqual(f2.calls[0].body.response_format, { type: 'json_object' });
  assert.equal(Object.hasOwn(f2.calls[0].body, 'tools'), false);
});

test('P2 T9 openai: step——中立记录 → 消息：助手的 message 原样（含 tool_calls 与 reasoning_content），每个工具结果一条 role: tool', async () => {
  const f = fakeFetch([structuredClone(CHAT_REPLY), { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '好了' } }] }]);
  const provider = await createProvider({ provider: 'openai', model: 'm' }, { fetch: f.fetch });
  const first = await provider.step({ system: 'S', transcript: [{ role: 'user', text: '概要' }], tools: TOOLS });
  const transcript = [
    { role: 'user', text: '概要' }, { role: 'assistant', raw: first.raw },
    { role: 'tool', results: [{ id: 'call_1', name: 'look', text: '看到了', isError: false }, { id: 'call_2', name: 'act', text: '做了', isError: false }, { id: 'call_3', name: 'act', text: '参数不合法：JSON 坏了', isError: true }] },
  ];
  const out = await provider.step({ system: 'S', transcript, tools: TOOLS });
  assert.deepEqual(out, { calls: [], text: '好了', stop: 'stop', raw: { message: { role: 'assistant', content: '好了' } } });
  assert.deepEqual(f.calls[1].body.messages, [
    { role: 'system', content: 'S' }, { role: 'user', content: '概要' },
    CHAT_REPLY.choices[0].message,
    { role: 'tool', tool_call_id: 'call_1', content: '看到了' }, { role: 'tool', tool_call_id: 'call_2', content: '做了' }, { role: 'tool', tool_call_id: 'call_3', content: '参数不合法：JSON 坏了' },
  ]);
  assert.equal(f.calls[1].body.messages[2].reasoning_content, '先看法律，再投票。', '推理内容一并带回');
});

test('P2 T9 openai: step——arguments 为空、已是对象、没有 choices、被 length 截断；思考强度与 maxTokens 的映射同 complete', async () => {
  const f = fakeFetch([
    { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'look', arguments: '' } }, { id: 'c2', type: 'function', function: { name: 'look', arguments: { what: 'here' } } }, { id: 'c3', type: 'function', function: { name: 'look', arguments: '[1]' } }] } }] },
    { choices: [] },
    { choices: [{ finish_reason: 'length', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c9', type: 'function', function: { name: 'act', arguments: '{"actions": [{"type": "sa' } }] } }] },
  ]);
  const provider = await createProvider({ provider: 'openai', model: 'm', reasoningEffort: 'high', maxTokens: 900 }, { fetch: f.fetch });
  const base = { system: 'S', transcript: [{ role: 'user', text: 'u' }], tools: TOOLS };
  assert.deepEqual((await provider.step(base)).calls, [{ id: 'c1', name: 'look', args: {} }, { id: 'c2', name: 'look', args: { what: 'here' } }, { id: 'c3', name: 'look', args: null }]);
  const empty = await provider.step(base);
  assert.deepEqual([empty.calls, empty.text, empty.stop], [[], '', 'stop']);
  const cut = await provider.step(base);
  assert.deepEqual(cut.calls, [{ id: 'c9', name: 'act', args: null }]);
  assert.equal(cut.stop, 'length');
  const body = f.calls[0].body;
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.max_completion_tokens, 900);
  assert.equal(Object.hasOwn(body, 'max_tokens'), false);
});

// ═══════════════════════════════════════════════════════════════
// openai-responses：原生工具调用
// ═══════════════════════════════════════════════════════════════

const RESPONSES_REPLY = {
  id: 'resp_67ccd2bed1ec8190', object: 'response', status: 'completed',
  output: [
    { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'gAAAAABn...' },
    { type: 'function_call', id: 'fc_1', call_id: 'call_a', name: 'look', arguments: '{"what":"here"}', status: 'completed' },
    { type: 'function_call', id: 'fc_2', call_id: 'call_b', name: 'act', arguments: '{"actions":[{"type":"say","text":"hi"}]', status: 'completed' },
    { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '先看看这里。' }] },
  ],
  usage: { input_tokens: 500, output_tokens: 80, output_tokens_details: { reasoning_tokens: 30 } },
};

test('P2 T9 openai-responses: step——tools 是 { type, name, description, parameters }；带 include 加密的推理项；calls 来自 function_call（call_id）；raw 是整个 output', async () => {
  const f = fakeFetch([structuredClone(RESPONSES_REPLY)]);
  const provider = await createProvider({ provider: 'openai-responses', model: 'gpt-x', jsonMode: true, maxTokens: 2000, reasoningEffort: 'low', extraBody: { include: ['message.output_text.logprobs'], tools: [] } }, { fetch: f.fetch });
  const out = await provider.step({ system: 'SYS', transcript: [{ role: 'user', text: '概要' }], tools: TOOLS });
  const body = f.calls[0].body;
  assert.equal(f.calls[0].url, 'https://api.openai.com/v1/responses');
  assert.deepEqual(body.tools, TOOLS.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.schema })));
  assert.deepEqual(body.include, ['message.output_text.logprobs', 'reasoning.encrypted_content']);
  assert.equal(body.store, false);
  assert.equal(body.stream, false);
  assert.equal(body.instructions, 'SYS');
  assert.deepEqual(body.input, [{ role: 'user', content: '概要' }]);
  assert.equal(Object.hasOwn(body, 'text'), false, '原生方式不发 jsonMode');
  assert.deepEqual(body.reasoning, { effort: 'low' });
  assert.equal(body.max_output_tokens, 2000);
  assert.deepEqual(out.calls, [{ id: 'call_a', name: 'look', args: { what: 'here' } }, { id: 'call_b', name: 'act', args: null }]);
  assert.equal(out.text, '先看看这里。');
  assert.equal(out.stop, 'tool_calls');
  assert.deepEqual(out.usage, { input: 500, output: 80, reasoning: 30 });
  assert.deepEqual(out.raw, { output: RESPONSES_REPLY.output });
  // complete 不带 include 与 tools
  const f2 = fakeFetch([structuredClone(RESPONSES_REPLY)]);
  const p2 = await createProvider({ provider: 'openai-responses', model: 'gpt-x' }, { fetch: f2.fetch });
  await p2.complete({ system: 'S', messages: [{ role: 'user', content: 'u' }] });
  assert.equal(Object.hasOwn(f2.calls[0].body, 'include'), false);
  assert.equal(Object.hasOwn(f2.calls[0].body, 'tools'), false);
});

test('P2 T9 openai-responses: step——中立记录 → input：助手的输出项（推理、function_call、message）全部原样追加，每个工具结果一项 function_call_output', async () => {
  const f = fakeFetch([structuredClone(RESPONSES_REPLY), { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '好了' }] }] }]);
  const provider = await createProvider({ provider: 'openai-responses', model: 'm' }, { fetch: f.fetch });
  const first = await provider.step({ system: 'S', transcript: [{ role: 'user', text: '概要' }], tools: TOOLS });
  const transcript = [
    { role: 'user', text: '概要' }, { role: 'assistant', raw: first.raw },
    { role: 'tool', results: [{ id: 'call_a', name: 'look', text: '看到了', isError: false }, { id: 'call_b', name: 'act', text: '参数不合法', isError: true }] },
  ];
  const out = await provider.step({ system: 'S', transcript, tools: TOOLS });
  assert.deepEqual(out.calls, []);
  assert.equal(out.text, '好了');
  assert.deepEqual(f.calls[1].body.input, [
    { role: 'user', content: '概要' },
    ...RESPONSES_REPLY.output,
    { type: 'function_call_output', call_id: 'call_a', output: '看到了' },
    { type: 'function_call_output', call_id: 'call_b', output: '参数不合法' },
  ]);
  assert.equal(f.calls[1].body.input[1].encrypted_content, 'gAAAAABn...', '加密的推理项原样传回');
});

test('P2 T9 openai-responses: step——拒绝、未完成、失败的输出不能成为行动；用量仍然保留', async () => {
  for (const [payload, stop] of [
    [{ ...RESPONSES_REPLY, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'length'],
    [{ ...RESPONSES_REPLY, status: 'incomplete', incomplete_details: { reason: 'content_filter' } }, 'incomplete'],
    [{ ...RESPONSES_REPLY, status: 'in_progress' }, 'in_progress'],
    [{ ...RESPONSES_REPLY, output: [...RESPONSES_REPLY.output, { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'no' }] }] }, 'refusal'],
  ]) {
    const provider = await createProvider({ provider: 'openai-responses', model: 'm' }, { fetch: async () => new Response(JSON.stringify(payload)) });
    const out = await provider.step({ system: 'S', transcript: [{ role: 'user', text: 'u' }], tools: TOOLS });
    assert.deepEqual([out.calls, out.text, out.stop], [[], '', stop]);
    assert.deepEqual(out.usage, { input: 500, output: 80, reasoning: 30 });
  }
  const failing = await createProvider({ provider: 'openai-responses', model: 'm' }, { fetch: async () => new Response(JSON.stringify({ status: 'failed' })) });
  await assert.rejects(failing.step({ system: 'S', transcript: [{ role: 'user', text: 'u' }], tools: TOOLS }), ProviderError);
  const noFunction = await createProvider({ provider: 'openai-responses', model: 'm' }, { fetch: async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '只有话' }] }] })) });
  const reply = await noFunction.step({ system: 'S', transcript: [{ role: 'user', text: 'u' }], tools: TOOLS });
  assert.deepEqual([reply.calls, reply.text, reply.stop], [[], '只有话', 'stop']);
});

test('P2 T9: 错误分级（认证、不存在、限速、5xx、拒绝）在 step 里同 complete', async () => {
  for (const kind of ['openai', 'openai-responses']) {
    for (const [status, fatal, retryable] of [[401, true, false], [404, true, false], [429, false, true], [503, false, true], [400, false, false]]) {
      const provider = await createProvider({ provider: kind, model: 'm' }, { fetch: async () => new Response(JSON.stringify({ error: { message: 'test failure' } }), { status }) });
      await assert.rejects(provider.step({ system: 'S', transcript: [{ role: 'user', text: 'u' }], tools: TOOLS }), (e) => e instanceof ProviderError && e.status === status && e.fatal === fatal && e.retryable === retryable);
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// mock
// ═══════════════════════════════════════════════════════════════

test('P2 T9 mock: script——每一轮的回复（calls、text 或错误）；complete 与 step 都按它逐轮返回；用完之后什么都不做', async () => {
  const boom = new ProviderError('这一轮出错', { retryable: true });
  const script = [
    { calls: [{ name: 'look', args: { what: 'here' } }] },
    { calls: [{ id: 'x1', name: 'act', args: { actions: [{ type: 'say', text: 'hi' }], thought: '想', end: true } }], usage: { input: 10, output: 5 } },
    boom,
    { text: '这不是 JSON', stop: 'length' },
  ];
  const mk = () => createProvider({ provider: 'mock', script });
  // step
  const provider = await mk();
  const s1 = await provider.step({ system: 'S', transcript: [] });
  assert.deepEqual(s1.calls, [{ id: 'm1_1', name: 'look', args: { what: 'here' } }]);
  assert.equal(s1.stop, 'tool_calls');
  const s2 = await provider.step({});
  assert.deepEqual(s2.calls, [{ id: 'x1', name: 'act', args: { actions: [{ type: 'say', text: 'hi' }], thought: '想', end: true } }]);
  assert.deepEqual(s2.usage, { input: 10, output: 5 });
  await assert.rejects(provider.step({}), (e) => e === boom);
  const s4 = await provider.step({});
  assert.deepEqual([s4.calls, s4.text, s4.stop], [[], '这不是 JSON', 'length']);
  const s5 = await provider.step({});
  assert.deepEqual([s5.calls, s5.text, s5.stop], [[], '', 'stop'], '用完之后什么都不做');
  // complete：calls 转成文本 JSON（第二前提的文本 JSON 方式），text 原样
  const p2 = await mk();
  const c1 = await p2.complete({ system: 'S', messages: [] });
  assert.deepEqual(parseToolJson(c1.text).calls.map((c) => [c.name, c.args]), [['look', { what: 'here' }]]);
  const c2 = await p2.complete({});
  assert.deepEqual(parseToolJson(c2.text).calls[0].args, { actions: [{ type: 'say', text: 'hi' }], thought: '想', end: true });
  assert.deepEqual(c2.usage, { input: 10, output: 5 });
  await assert.rejects(p2.complete({}), (e) => e === boom);
  assert.deepEqual(await p2.complete({}), { text: '这不是 JSON', stop: 'length' });
  // 同一个脚本不被两个提供者共享：各自从头开始
  assert.equal(script.length, 4);
});

test('P2 T9 mock: script 的 calls 转文本 JSON——多个 look 成数组，look、act、done 可以同在一个对象里', async () => {
  const provider = await createProvider({ provider: 'mock', script: [
    { calls: [{ name: 'look', args: { what: 'here' } }, { name: 'look', args: { what: 'laws' } }, { name: 'act', args: { actions: [] } }, { name: 'done' }] },
  ] });
  const { text } = await provider.complete({});
  assert.deepEqual(JSON.parse(text), { look: [{ what: 'here' }, { what: 'laws' }], act: { actions: [] }, done: true });
  assert.deepEqual(parseToolJson(text).calls.map((c) => c.name), ['look', 'look', 'act', 'done']);
});

test('P2 T9 mock: script 的 delayMs——signal 中止时抛 AbortError，比 timeoutMs 长就按超时抛 ProviderError（测试里模拟慢的模型）', async () => {
  const provider = await createProvider({ provider: 'mock', script: [{ delayMs: 5000, calls: [] }, { delayMs: 5000, calls: [] }, { delayMs: 20, calls: [{ name: 'done' }] }] });
  const ac = new AbortController();
  const pending = provider.step({ signal: ac.signal });
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(pending, (e) => e.name === 'AbortError');
  const t0 = Date.now();
  await assert.rejects(provider.step({ timeoutMs: 1000 }), (e) => e instanceof ProviderError && e.retryable && /timeout（1 秒）/.test(e.message));
  assert.ok(Date.now() - t0 < 2500);
  assert.equal((await provider.step({ timeoutMs: 1000 })).calls[0].name, 'done');
});

test('P2 T9 mock: 没有脚本时——step 用 mockDecide 生成一次带 end: true 的 act（偶尔先 look）；第二前提的 complete 返回同样内容的文本 JSON；设定 0、1 的 complete 不变', async () => {
  const { perception } = await richP2World('mock-default');
  const p = perception();
  const provider = await createProvider({ provider: 'mock', seed: 7 });
  const names = [];
  for (let i = 0; i < 40; i++) {
    const first = await provider.step({ perception: p, transcript: [{ role: 'user', text: 'x' }] });
    assert.equal(first.calls.length, 1);
    names.push(first.calls[0].name);
    if (first.calls[0].name === 'look') assert.ok(['here', 'laws', 'proposals', 'self', 'places'].includes(first.calls[0].args.what));
    else {
      assert.equal(first.calls[0].args.end, true);
      assert.ok(Array.isArray(first.calls[0].args.actions));
    }
    // 不是第一轮（有工具结果）：总是 act
    const later = await provider.step({ perception: p, transcript: [{ role: 'user', text: 'x' }, { role: 'assistant', raw: {} }, { role: 'tool', results: [] }] });
    assert.equal(later.calls[0].name, 'act');
  }
  assert.ok(names.includes('look') && names.includes('act'), `${names.join(',')}`);
  assert.deepEqual(await (await createProvider({ provider: 'mock' })).step({}), { calls: [], text: '', stop: 'stop', raw: { mock: true, calls: [], text: '' } }, '没有感知：什么都不做');
  // 文本 JSON：第二前提的感知
  const j = await createProvider({ provider: 'mock', seed: 7 });
  const kinds = new Set();
  for (let i = 0; i < 40; i++) {
    const r = await j.complete({ perception: p, messages: [{ role: 'user', content: 'x' }] });
    const parsed = parseToolJson(r.text);
    assert.equal(parsed.ok, true, r.text);
    kinds.add(parsed.calls[0].name);
    assert.equal(parsed.calls.length, 1);
  }
  assert.deepEqual([...kinds].sort(), ['act', 'look']);
  // 设定 1 的感知：旧格式 { thought?, actions }
  const old = await createProvider({ provider: 'mock', seed: 7 });
  const r = await old.complete({ perception: { ...p, premise: 1 } });
  assert.ok(Array.isArray(JSON.parse(r.text).actions));
  assert.equal(Object.hasOwn(JSON.parse(r.text), 'act'), false);
  void mockDecide;
});

// ═══════════════════════════════════════════════════════════════
// T10：超时（F2）
// ═══════════════════════════════════════════════════════════════

/** 一个本地服务：收到请求之后过 delay 毫秒才回；delay 为 null 时一直不回（直到对方断开） */
async function slowServer(delay) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (delay === null) return;
      setTimeout(() => { if (!res.destroyed) res.end(JSON.stringify({ choices: [{ message: { content: '{"actions":[]}' }, finish_reason: 'stop' }] })); }, delay);
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/v1`, close: () => { for (const s of sockets) s.destroy(); return new Promise((r) => server.close(r)); } };
}

test('P2 T10 F2: modelFetch 跟随 timeoutMs——超时的错误名为 TimeoutError；缺省时不受影响', { timeout: 30000 }, async () => {
  const hang = await slowServer(null);
  const slow = await slowServer(700);
  try {
    const t0 = Date.now();
    await assert.rejects(modelFetch(true, { timeoutMs: 300 })(`${hang.url}/chat/completions`, { method: 'POST', body: '{}' }), (e) => e.name === 'TimeoutError' && /超时/.test(e.message));
    const waited = Date.now() - t0;
    assert.ok(waited >= 250 && waited < 2500, `等了 ${waited} ms`);
    // 比超时慢的服务：超时；比超时快：成功
    await assert.rejects(modelFetch(true, { timeoutMs: 300 })(`${slow.url}/x`, { method: 'POST', body: '{}' }), (e) => e.name === 'TimeoutError');
    const ok = await modelFetch(true, { timeoutMs: 5000 })(`${slow.url}/x`, { method: 'POST', body: '{}' });
    assert.equal(ok.status, 200);
    // 缺省（不给选项）：照旧可用，也不会在 700 ms 时超时
    const dflt = await modelFetch(true)(`${slow.url}/x`, { method: 'POST', body: '{}' });
    assert.equal(dflt.status, 200);
  } finally {
    await hang.close();
    await slow.close();
  }
});

test('P2 T10 F2: 提供者的网络错误——超时写「timeout（N 秒）」（N 是这次调用实际用的超时），其余照旧', { timeout: 30000 }, async () => {
  const timeoutError = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const request = { system: 'S', messages: [{ role: 'user', content: 'u' }] };
  const label = async (cfg, fetch, extra = {}) => {
    const provider = await createProvider({ provider: 'openai', model: 'm', ...cfg }, { fetch });
    try { await provider.complete({ ...request, ...extra }); } catch (e) { return e; }
    return null;
  };
  let e = await label({ timeoutMs: 180000 }, async () => { throw timeoutError(); });
  assert.ok(e instanceof ProviderError && e.retryable);
  assert.equal(e.message, '网络错误：timeout（180 秒）');
  assert.equal((await label({}, async () => { throw timeoutError(); })).message, '网络错误：timeout（120 秒）', '缺省 120 秒');
  assert.equal((await label({ timeoutMs: 180000 }, async () => { throw timeoutError(); }, { timeoutMs: 23000 })).message, '网络错误：timeout（23 秒）', '这一次调用的超时');
  // 封装把它放在 cause 里
  const wrapped = await label({ timeoutMs: 60000 }, async () => { throw new TypeError('fetch failed', { cause: timeoutError() }); });
  assert.equal(wrapped.message, '网络错误：timeout（60 秒）');
  // 其他网络错误不变
  assert.equal((await label({}, async () => { throw new Error('connect ECONNREFUSED'); })).message, '网络错误：connect ECONNREFUSED');
  // 真的超时：fetch 遵守 signal，线路的超时到了就中止
  const hanging = async (_url, { signal }) => new Promise((_resolve, reject) => {
    // 模拟一个仍在等待网络的请求：AbortSignal.timeout 的计时器不保持事件循环存活。
    // 留一个有引用的计时器，确保测试等到真正的 signal 超时；未超时则明确失败。
    const guard = setTimeout(() => reject(new Error('fetch did not receive an abort')), 3000);
    signal.addEventListener('abort', () => { clearTimeout(guard); reject(signal.reason); }, { once: true });
  });
  const t0 = Date.now();
  const real = await label({ timeoutMs: 1000 }, hanging);
  assert.equal(real.message, '网络错误：timeout（1 秒）');
  assert.ok(Date.now() - t0 < 3000);
  // step 一样
  const provider = await createProvider({ provider: 'openai-responses', model: 'm', timeoutMs: 90000 }, { fetch: async () => { throw timeoutError(); } });
  await assert.rejects(provider.step({ system: 'S', transcript: [{ role: 'user', text: 'u' }], tools: TOOLS }), (err) => err.message === '网络错误：timeout（90 秒）');
});

test('P2 T10 F2: 配置——躯壳线路的 timeoutMs 可以到 300000，托管运行器仍是 120000；缺省不变', () => {
  const line = (timeoutMs) => parseShellsConfig({ lines: [{ model: 'm', provider: 'mock', ...(timeoutMs === undefined ? {} : { timeoutMs }) }] }).lines[0].timeoutMs;
  assert.equal(line(), DEFAULTS.timeoutMs);
  assert.equal(DEFAULTS.timeoutMs, 120000);
  assert.equal(line(180000), 180000);
  assert.equal(line(300000), 300000);
  assert.equal(line(1000), 1000);
  assert.throws(() => line(300001), /timeoutMs 必须是 1000–300000 的整数/);
  assert.throws(() => line(999), /1000–300000/);
  assert.throws(() => line(1.5), /整数/);
  // 托管运行器
  assert.equal(runnerConfig({ provider: 'mock', model: 'mock' }).timeoutMs, 120000);
  assert.equal(runnerConfig({ provider: 'mock', model: 'mock', timeoutMs: 120000 }).timeoutMs, 120000);
  assert.throws(() => runnerConfig({ provider: 'mock', model: 'mock', timeoutMs: 120001 }), /1000.*120000|120000/);
});

/** 记下 run 期间所有 socket.setTimeout 的值（req.setTimeout 最终落在这里），不改变行为 */
async function socketTimeouts(run) {
  const seen = [];
  const original = net.Socket.prototype.setTimeout;
  net.Socket.prototype.setTimeout = function (ms, ...rest) { seen.push(ms); return original.call(this, ms, ...rest); };
  try { await run(); } finally { net.Socket.prototype.setTimeout = original; }
  return seen;
}

test('P2 T10 F2: 线路的 timeoutMs 同时是连接的空闲超时——200 秒的躯壳线路不再被写死的 120 秒截断；托管运行器照它自己的 timeoutMs', { timeout: 30000 }, async () => {
  const fast = await slowServer(0);
  const env = await boot({ allowLocalModels: true });
  const quiet = { log() {}, warn() {}, error() {}, info() {} };
  const ask = (provider) => provider.complete({ system: 'S', messages: [{ role: 'user', content: 'u' }] });
  try {
    const manager = new ShellManager(env.rt, { allowLocalModels: true, shellTz: null }, {
      config: parseShellsConfig({ lines: [{ model: 'shell-m', provider: 'openai', baseURL: fast.url, timeoutMs: 200000 }] }), logger: quiet, usageFile: null,
    });
    const shell = await socketTimeouts(async () => ask(await manager.providerFor(manager.lines.get('shell-m'))));
    assert.ok(shell.includes(200000), `躯壳线路的连接超时：${shell.join(',')}`);
    assert.ok(!shell.includes(120000), '没有写死的 120 秒');
    await manager.close();
    const config = runnerConfig({ provider: 'openai', model: 'm', baseURL: fast.url, apiKey: 'k', timeoutMs: 90000 });
    const hosted = await socketTimeouts(async () => ask(await env.app.ctx.runners.provider(config)));
    assert.ok(hosted.includes(90000), `托管运行器的连接超时：${hosted.join(',')}`);
    assert.ok(!hosted.includes(120000));
    // 不给 timeoutMs 的 modelFetch 仍是 120 秒
    const plain = await socketTimeouts(async () => modelFetch(true)(`${fast.url}/x`, { method: 'POST', body: '{}' }));
    assert.ok(plain.includes(120000));
  } finally {
    await env.close();
    await fast.close();
  }
});

test('P2 T10 F2: 躯壳管理器与托管运行器创建 modelFetch 时传线路的 timeoutMs——端到端：服务不回，到时按「timeout（N 秒）」失败', { timeout: 30000 }, async () => {
  const hang = await slowServer(null);
  const env = await boot({ allowLocalModels: true });
  try {
    // 托管运行器：provider(config, timeoutMs)
    const config = runnerConfig({ provider: 'openai', model: 'm', baseURL: hang.url, apiKey: 'k', timeoutMs: 1000 });
    const hosted = await env.app.ctx.runners.provider(config);
    const t0 = Date.now();
    await assert.rejects(hosted.complete({ system: 'S', messages: [{ role: 'user', content: 'u' }] }), (e) => e instanceof ProviderError && e.message === '网络错误：timeout（1 秒）');
    assert.ok(Date.now() - t0 < 4000);
    // 躯壳管理器：providerFor(line) 用线路的 timeoutMs（可以超过 120 秒；这里用 1.5 秒验证它被用上）
    const manager = new ShellManager(env.rt, { allowLocalModels: true, shellTz: null }, {
      config: parseShellsConfig({ lines: [{ model: 'shell-m', provider: 'openai', baseURL: hang.url, timeoutMs: 1500 }] }), logger: { log() {}, warn() {}, error() {}, info() {} }, usageFile: null,
    });
    const provider = await manager.providerFor(manager.lines.get('shell-m'));
    const t1 = Date.now();
    await assert.rejects(provider.complete({ system: 'S', messages: [{ role: 'user', content: 'u' }] }), (e) => e instanceof ProviderError && e.message === '网络错误：timeout（2 秒）');
    const waited = Date.now() - t1;
    assert.ok(waited >= 1000 && waited < 5000, `等了 ${waited} ms`);
    await manager.close();
  } finally {
    await env.close();
    await hang.close();
  }
});
