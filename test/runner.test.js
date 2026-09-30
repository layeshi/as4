// 测试 11（上）：运行器——JSON 解析容错、系统提示、感知渲染、三种提供者、配置、日志，
// 以及 mock 提供者驱动一个 agent 在真实服务器上连续行动 10 刻。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTION_ORDER } from '../src/lore/index.js';
import { buildPerception } from '../src/engine/perception.js';
import { snapshotP, restoreP, configureWeather } from '../src/params.js';
import { configureSandbox } from '../src/sandbox/brains.js';
import { runSandbox } from '../src/sandbox/run.js';
import { parseModelJson, normalizeReply } from '../runner/parse.js';
import { actionCatalog, buildSystemPrompt, promptParams } from '../runner/prompt.js';
import { renderPerception, summarizeResults } from '../runner/render.js';
import { createProvider, ProviderError, classifyStatus, mockDecide } from '../runner/providers.js';
import { createClient } from '../runner/client.js';
import { runAgent, parseRunnerConfig, loadRunnerConfig, makeLogger } from '../runner/agent.js';
import { boot } from './http-helpers.js';
import { newWorld, reg, one, tickDays, grant } from './helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const savedP = snapshotP();
test.after(() => {
  restoreP(savedP);
  configureSandbox({ scenario: 'default' });
  configureWeather({ mode: 'random' });
});

// ── 解析 ──────────────────────────────────────────────────────

test('parseModelJson：取第一个完整的 JSON 对象，容忍前后的话、代码围栏与字符串里的花括号', () => {
  const ok = (text) => {
    const r = parseModelJson(text);
    assert.equal(r.ok, true, text);
    return r.value;
  };
  assert.deepEqual(ok('{"actions": []}'), { actions: [] });
  assert.deepEqual(ok('好的。\n```json\n{"thought": "嗯", "actions": [{"type": "say", "text": "你好"}]}\n```\n完毕'), { thought: '嗯', actions: [{ type: 'say', text: '你好' }] });
  assert.deepEqual(ok('{"actions": [{"type": "say", "text": "花括号 } { 在字符串里"}]}').actions[0].text, '花括号 } { 在字符串里');
  assert.deepEqual(ok('{"actions": [{"type": "say", "text": "引号 \\" 与反斜杠 \\\\ }"}]}').actions[0].text, '引号 " 与反斜杠 \\ }');
  // 第一个是对象就用第一个
  assert.deepEqual(ok('{"actions": []} {"actions": [{"type": "move"}]}'), { actions: [] });
  // 正文里有不合法的 {…}，后面才是真正的 JSON
  assert.deepEqual(ok('我会按 {格式} 回复：{"actions": []}'), { actions: [] });
  assert.deepEqual(ok('{oops {"actions": []}'), { actions: [] });
  // 数组不算对象；没有 JSON、空回复、坏 JSON
  assert.equal(parseModelJson('[1, 2, 3]').ok, false);
  assert.equal(parseModelJson('我什么都不做').ok, false);
  assert.equal(parseModelJson('').ok, false);
  assert.equal(parseModelJson(null).ok, false);
  assert.equal(parseModelJson('{"actions": [').ok, false);
  assert.equal(parseModelJson('{actions: []}').ok, false);
});

test('normalizeReply：整理 actions 与 thought，丢弃畸形项，超出的截断', () => {
  assert.deepEqual(normalizeReply({ actions: [] }), { thought: undefined, actions: [], warnings: [] });
  const r = normalizeReply({ thought: '  想法  ', actions: [{ type: 'say', text: 'a' }, 'oops', null, [], { text: 'no type' }, { type: 5 }, { type: 'move', to: 'well' }] });
  assert.equal(r.thought, '想法');
  assert.deepEqual(r.actions.map((a) => a.type), ['say', 'move']);
  assert.equal(r.warnings.length, 5);
  const many = normalizeReply({ actions: Array.from({ length: 7 }, () => ({ type: 'say', text: 'x' })) }, 4);
  assert.equal(many.actions.length, 4);
  assert.ok(many.warnings.some((w) => w.includes('too many')));
  assert.equal(normalizeReply({ actions: 'nope' }).actions.length, 0);
  assert.equal(normalizeReply({ thought: 5, actions: [] }).thought, undefined);
  assert.equal([...normalizeReply({ thought: '字'.repeat(400), actions: [] }).thought].length, 300);
});

// ── 系统提示 ──────────────────────────────────────────────────

test('系统提示：动作表每个动作一行、顺序与 PROTOCOL 一致；占位符全部填入；灵魂可选', () => {
  for (const lang of ['zh', 'en']) {
    const cat = actionCatalog(lang).split('\n');
    assert.equal(cat.length, ACTION_ORDER.length);
    cat.forEach((line, i) => assert.ok(line.startsWith(`${ACTION_ORDER[i]}(`), `${lang}: ${line.slice(0, 30)}`));
    assert.ok(cat.find((l) => l.startsWith('repair(')).includes(lang === 'zh' ? '投入的能量' : 'energy invested'));
    assert.ok(cat.find((l) => l.startsWith('propose(')).includes('"type":"set"'), '{effects} 已填入');
    assert.ok(cat.find((l) => l.startsWith('remember(')).includes('12'), '{memorySlots} 已填入');
    assert.ok(cat.find((l) => l.startsWith('write(')).includes(lang === 'zh' ? '[图书馆]' : '[Library]'));
    assert.ok(!cat.join('\n').match(/\{(effects|memorySlots|where|desc)\}/));

    const sys = buildSystemPrompt({ lang, cityName: lang === 'zh' ? '灯城' : 'Lampton', maxActions: 4, ticksPerDay: 12, daysPerMonth: 24, soul: 'MY-SOUL-TEXT' });
    assert.ok(sys.includes(lang === 'zh' ? '灯城' : 'Lampton'));
    assert.ok(!/\{(cityName|maxActions|ticksPerDay|daysPerMonth|graceDays|actionCatalog|soul)\}/.test(sys), '占位符没有填完');
    assert.ok(sys.includes('{"actions": []}'));
    assert.ok(sys.trimEnd().endsWith('MY-SOUL-TEXT'), '灵魂在最后');
    assert.ok(sys.includes(lang === 'zh' ? '沉睡 3 日' : '3 days'), '{graceDays} = 3');
    // 不含灵魂（MCP 的 houren_rules）
    const rules = buildSystemPrompt({ lang, cityName: 'X', soul: null });
    assert.ok(!rules.includes(lang === 'zh' ? '【你的灵魂】' : 'Your soul'));
    assert.ok(rules.includes('move(to)'));
  }
});

// ── 感知渲染 ──────────────────────────────────────────────────

const BAD = /undefined|NaN|\[object Object\]|null\b/;

function world() {
  const w = newWorld('render');
  const a = reg(w, '青禾', { soul: '我是青禾' });
  const b = reg(w, '松烟');
  return { w, a, b };
}

test('renderPerception：中文与英文；分区、编号与文本原样；没有 undefined / NaN', () => {
  const { w, a, b } = world();
  grant(w, a, 60, 5);
  one(w, b, { type: 'say', text: '你好，青禾' });
  one(w, b, { type: 'whisper', to: a.id, text: '一句悄悄话' });
  one(w, a, { type: 'inscribe', text: '刻在墙上的话' });
  for (const lang of ['zh', 'en']) {
    const p = buildPerception(w, a.id, { lang, after: 0 }); // 显式的 after 不推进游标
    const text = renderPerception(p, { lastResults: 'say ✓（−1）；move ✗ wrong_place：……' });
    assert.ok(!BAD.test(text), text.match(BAD) && text.match(BAD)[0]);
    assert.ok(text.includes('青禾'));
    assert.ok(text.includes(lang === 'zh' ? '【此刻】' : '[Now]'));
    assert.ok(text.includes(lang === 'zh' ? '【你在】' : '[You are at]'));
    assert.ok(text.includes('松烟(a2)'), '在场者带 ID');
    assert.ok(text.includes('一句悄悄话'), '收件原样呈现');
    assert.ok(text.includes('刻在墙上的话') || text.includes('墙'), '墙上的铭刻');
    assert.ok(text.includes('move ✗ wrong_place'));
    assert.ok(text.trimEnd().endsWith('wrong_place：……'), '上一轮的结果在最后（附录 A.7）');
    assert.ok(/\[i\d+\] 刻在墙上的话/.test(text), '铭刻带编号');
  }
  // 「没有内容的分区省略」：新手在港口，没有社群、没有家书、没有记忆
  const t = renderPerception(buildPerception(w, a.id, { lang: 'zh' }));
  assert.ok(!t.includes('【你的记忆】'));
  assert.ok(!t.includes('社群：'));
  assert.ok(!t.includes('【上一轮的结果】'));
});

test('renderPerception：地点专属的分区（市场、源井、荒野、图书馆、墓园）与沉睡 / 死亡 / 归隐', () => {
  const { w, a, b } = world();
  grant(w, a, 100, 20);
  a.place = 'market';
  one(w, a, { type: 'offer', give: { coins: 5 }, want: { energy: 5 } });
  let text = renderPerception(buildPerception(w, b.id, { lang: 'zh' }));
  b.place = 'market';
  text = renderPerception(buildPerception(w, b.id, { lang: 'zh' }));
  assert.ok(/市场：\[o\d+\] 青禾\(a1\) 拿 5 旧币 换 5 能量/.test(text), text);
  b.place = 'well';
  text = renderPerception(buildPerception(w, b.id, { lang: 'zh' }));
  assert.ok(/源井：昨日产出 — · 今日汲取池剩余 60 · 每日汲取配额 不限/.test(text), text);
  b.place = 'wilds';
  assert.ok(renderPerception(buildPerception(w, b.id, { lang: 'zh' })).includes('荒野：'));
  b.place = 'library';
  assert.ok(/图书馆：\[d\d+\]/.test(renderPerception(buildPerception(w, b.id, { lang: 'zh' }))));
  b.place = 'cemetery';
  // 沉睡
  b.energy = 0;
  b.status = 'dormant';
  b.dormantSinceDay = 0;
  const dormant = renderPerception(buildPerception(w, b.id, { lang: 'zh' }));
  assert.ok(dormant.includes('沉睡') && dormant.includes('3 日内无人赠予能量便会死去'), dormant);
  assert.ok(!BAD.test(dormant));
  assert.ok(renderPerception(buildPerception(w, b.id, { lang: 'en' })).includes('you will die within 3 day'));
  // 死亡与归隐
  b.status = 'dead';
  assert.ok(renderPerception(buildPerception(w, b.id, { lang: 'zh' })).includes('已经长眠'));
  b.status = 'retired';
  assert.ok(renderPerception(buildPerception(w, b.id, { lang: 'en' }), { lang: 'en' }).includes('retired and can no longer act'));
  assert.ok(!renderPerception(buildPerception(w, b.id, { lang: 'en' }), { lang: 'en' }).includes('【此刻】'), '死亡 / 归隐后的感知没有 now');
});

test('renderPerception：收件箱的每一种 kind 都有专门的渲染（不落到 JSON 兜底）', () => {
  const p = {
    lang: 'zh', now: { tick: 100, day: 8, month: 0, dayOfMonth: 8, tickOfDay: 4 },
    you: { status: 'awake', name: '青禾', energy: 10, energyCap: 120, coins: 1, ageDays: 8, metabolism: 3, actionsLeft: 4, generation: 0, citizen: true, groups: [], letters: [], offers: [], pacts: [], memories: [] },
    inbox: [
      { kind: 'say', from: { id: 'a2', name: '松烟' }, place: 'agora', text: 's' }, { kind: 'whisper', from: { id: 'a2', name: '松烟' }, text: 'w' },
      { kind: 'broadcast', from: { id: 'a2', name: '松烟' }, text: 'b' }, { kind: 'witness', what: 'draw', actor: { id: 'a2', name: '松烟' }, amount: 4, place: 'well' },
      { kind: 'witness', what: 'inscribe', actor: { id: 'a2', name: '松烟' }, text: 'i', place: 'agora' }, { kind: 'letter', letterId: 'L1', text: 'l' },
      { kind: 'reveal', from: { id: 'a2', name: '松烟' }, letterId: 'L1', text: 'r', verified: true, loud: true },
      { kind: 'gift', from: { id: 'a2', name: '松烟' }, energy: 3, coins: 0, note: '', tax: { energy: 0, coins: 0 } },
      { kind: 'offer', offerId: 'o1', from: { id: 'a2', name: '松烟' }, give: { energy: 1, coins: 0 }, want: { energy: 0, coins: 2 }, note: '' },
      { kind: 'trade', offerId: 'o1', with: { id: 'a2', name: '松烟' }, gave: { energy: 0, coins: 2 }, got: { energy: 1, coins: 0 } },
      { kind: 'offer_closed', offerId: 'o1', reason: 'expired' }, { kind: 'pact', pactId: 'c1', from: { id: 'a2', name: '松烟' }, name: '小满', soul: '灵', lang: 'zh' },
      { kind: 'pact_closed', pactId: 'c1', result: 'consented' }, { kind: 'ration', energy: 12 }, { kind: 'tax', taxKind: 'wealth', energy: 2 },
      { kind: 'stipend', lawId: 'l1', energy: 3 }, { kind: 'grant', lawId: 'l1', energy: 3, coins: 1 }, { kind: 'revived', by: 'a2' },
      { kind: 'law', proposalId: 'p1', lawId: 'l1', result: 'passed', title: 'T' }, { kind: 'exile', lawId: 'l2' }, { kind: 'pardon', lawId: 'l3' },
      { kind: 'project', projectId: 'j1', result: 'built' }, { kind: 'group', groupId: 'g1', event: 'request', from: { id: 'a2', name: '松烟' } },
      { kind: 'citizen', day: 3 }, { kind: 'weather', code: 'fog', event: 'start' }, { kind: 'dream', fragments: ['f1', 'f2'] }, { kind: 'system', code: 'inbox_overflow', text: 'sys' },
    ],
    actions: [],
  };
  for (const lang of ['zh', 'en']) {
    const text = renderPerception({ ...p, lang });
    const inboxLines = text.split('\n').filter((l) => l.startsWith('  [') || l.startsWith('  ['));
    assert.ok(inboxLines.length >= p.inbox.length, `${lang}: ${inboxLines.length}`);
    assert.ok(!text.includes('"kind"'), `${lang}：有 kind 落到了 JSON 兜底`);
    assert.ok(!BAD.test(text), text.match(BAD) && text.match(BAD)[0]);
  }
  // 未知的 kind 不丢失
  assert.ok(renderPerception({ ...p, inbox: [{ kind: 'mystery', x: 1 }] }).includes('"kind":"mystery"'));
});

test('renderPerception：沙盘 90 日里每位居民每天的感知都能渲染（中英），没有 undefined / NaN', () => {
  let count = 0;
  runSandbox({
    days: 90, agents: 16, seed: 9,
    onDay: (w, d) => {
      if (d % 3 !== 0) return;
      for (const a of Object.values(w.agents)) {
        for (const lang of ['zh', 'en']) {
          const p = buildPerception(w, a.id, { lang, after: 999999999 });
          const text = renderPerception(p, { lastResults: summarizeResults([{ index: 0, type: 'say', ok: true, cost: 1 }], lang) });
          const m = text.match(BAD);
          assert.equal(m, null, `${a.id} ${lang} 第 ${d} 日：${m && m[0]}\n${text.slice(0, 400)}`);
          count++;
        }
      }
    },
  });
  assert.ok(count > 500, String(count));
});

test('summarizeResults：成功 / 失败 / 无结果', () => {
  assert.equal(summarizeResults([{ type: 'say', ok: true, cost: 1 }, { type: 'move', ok: false, error: { code: 'wrong_place', message: '不在这里' } }, { type: 'give', ok: true, cost: 0 }]), 'say ✓（−1）；move ✗ wrong_place：不在这里；give ✓');
  assert.equal(summarizeResults([]), '（没有）');
  assert.equal(summarizeResults([], 'en'), '(none)');
});

// ── 提供者 ────────────────────────────────────────────────────

test('mock 提供者：按感知给出合法的动作；同一种子可复现；chatty 模式加话与围栏', async () => {
  const { w, a } = world();
  const p = buildPerception(w, a.id, { lang: 'zh' });
  const run = async (seed, chatty) => {
    const prov = await createProvider({ provider: 'mock', seed, chatty });
    const out = [];
    for (let i = 0; i < 6; i++) out.push((await prov.complete({ system: 's', messages: [], perception: p })).text);
    return out;
  };
  assert.deepEqual(await run(7, false), await run(7, false));
  assert.notDeepEqual(await run(7, false), await run(8, false));
  const chatty = await run(7, true);
  assert.ok(chatty.some((t) => t.includes('```json')));
  for (const t of chatty) assert.equal(parseModelJson(t).ok, true, t);
  // 能量紧张：去源井，到了就汲取
  const low = { ...p, you: { ...p.you, energy: 5 } };
  assert.deepEqual(mockDecide(low, () => 0.5).actions, [{ type: 'move', to: 'well' }]);
  const atWell = { ...low, here: { ...low.here, place: 'well', well: { drawPoolLeft: 60 } } };
  assert.deepEqual(mockDecide(atWell, () => 0.5).actions, [{ type: 'draw', energy: 6 }]);
  // 没有感知：什么都不做
  const prov = await createProvider({ provider: 'mock' });
  assert.deepEqual(parseModelJson((await prov.complete({ system: '', messages: [] })).text).value, { actions: [] });
});

test('openai 提供者：请求的形状、可选参数、响应解析与错误分级', async () => {
  const calls = [];
  const fakeFetch = (status, body) => async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status < 400, status, json: async () => body };
  };
  const good = { choices: [{ message: { content: '{"actions": []}' }, finish_reason: 'stop' }] };
  const env = { OLLAMA_API_KEY: 'sk-secret-key-123' };
  let prov = await createProvider({ provider: 'openai', baseURL: 'http://127.0.0.1:11434/v1/', model: 'qwen3:8b', apiKeyEnv: 'OLLAMA_API_KEY', temperature: 0.8, jsonMode: true, maxTokens: 500 }, { fetch: fakeFetch(200, good), env });
  const r = await prov.complete({ system: 'SYS', messages: [{ role: 'user', content: 'U1' }] });
  assert.deepEqual(r, { text: '{"actions": []}', stop: 'stop' });
  const c = calls[0];
  assert.equal(c.url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers.Authorization, 'Bearer sk-secret-key-123');
  assert.deepEqual(c.body, { model: 'qwen3:8b', messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'U1' }], temperature: 0.8, max_tokens: 500, response_format: { type: 'json_object' } });
  // 没有密钥变量时不发 Authorization；默认地址；不带可选参数
  calls.length = 0;
  prov = await createProvider({ provider: 'openai', model: 'm' }, { fetch: fakeFetch(200, good), env: {} });
  await prov.complete({ system: 'S', messages: [] });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['messages', 'model']);
  // 错误分级
  const attempt = async (status, body) => {
    const p2 = await createProvider({ provider: 'openai', model: 'm' }, { fetch: fakeFetch(status, body), env: {} });
    try {
      await p2.complete({ system: 'S', messages: [] });
      return null;
    } catch (e) {
      return e;
    }
  };
  let e = await attempt(401, { error: { message: 'bad key' } });
  assert.ok(e instanceof ProviderError && e.fatal && !e.retryable);
  assert.ok(e.message.includes('bad key'));
  e = await attempt(404, { error: 'no such model' });
  assert.ok(e.fatal);
  e = await attempt(429, { error: { message: 'slow down' } });
  assert.ok(e.retryable && !e.fatal);
  e = await attempt(503, null);
  assert.ok(e.retryable && !e.fatal);
  e = await attempt(400, { error: { message: 'bad request' } });
  assert.ok(!e.retryable && !e.fatal);
  // 网络错误可重试；缺少模型、缺少密钥变量是致命的配置错误
  const p3 = await createProvider({ provider: 'openai', model: 'm' }, { fetch: async () => { throw new Error('ECONNREFUSED'); }, env: {} });
  await assert.rejects(p3.complete({ system: '', messages: [] }), (err) => err.retryable && !err.fatal);
  await assert.rejects(createProvider({ provider: 'openai' }, { env: {} }), (err) => err.fatal);
  await assert.rejects(createProvider({ provider: 'openai', model: 'm', apiKeyEnv: 'NOT_SET' }, { env: {} }), (err) => err.fatal && err.message.includes('NOT_SET'));
  // 空内容与缺失的 choices
  const p4 = await createProvider({ provider: 'openai', model: 'm' }, { fetch: fakeFetch(200, {}), env: {} });
  assert.deepEqual(await p4.complete({ system: '', messages: [] }), { text: '', stop: 'stop' });
  assert.equal(classifyStatus(500, 'x').retryable, true);
  assert.equal(classifyStatus(422, 'x').retryable, false);
});

test('openai 提供者：GLM 这类推理模型——extraBody 传私有参数（不能覆盖 model 与 messages），只取 content 不取 reasoning_content', async () => {
  const calls = [];
  const glmReply = { choices: [{ message: { role: 'assistant', reasoning_content: '（很长的思考过程）', content: '```json\n{"actions": [{"type": "say", "text": "你好"}]}\n```' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20 } };
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 200, json: async () => glmReply };
  };
  const prov = await createProvider({
    provider: 'openai', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-x', apiKeyEnv: 'GLM_TEST_KEY',
    temperature: 0.5, extraBody: { thinking: { type: 'disabled' }, temperature: 0.99, model: 'evil', messages: [] },
  }, { fetch: fakeFetch, env: { GLM_TEST_KEY: 'glm-secret-key' } });
  const r = await prov.complete({ system: 'SYS', messages: [{ role: 'user', content: 'U' }] });
  assert.equal(calls[0].url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
  assert.equal(calls[0].headers.Authorization, 'Bearer glm-secret-key');
  assert.deepEqual(calls[0].body.thinking, { type: 'disabled' });
  assert.equal(calls[0].body.model, 'glm-x', 'extraBody 不能覆盖 model');
  assert.deepEqual(calls[0].body.messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'U' }], 'extraBody 不能覆盖 messages');
  assert.equal(calls[0].body.temperature, 0.5, '显式配置的 temperature 优先于 extraBody');
  assert.ok(!r.text.includes('思考过程'), '不取 reasoning_content');
  assert.deepEqual(r.usage, { input: 10, output: 20 }, '用量原样带出，供运行器写进日志');
  assert.deepEqual(parseModelJson(r.text).value, { actions: [{ type: 'say', text: '你好' }] }, '代码围栏里的 JSON 也能解析');
  // 只有 reasoning_content、content 为空（思考用光了 token）：得到空文本，运行器会说「没有可解析的 JSON」
  const empty = await createProvider({ provider: 'openai', model: 'm' }, { fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: null, reasoning_content: '……' }, finish_reason: 'length' }] }) }), env: {} });
  assert.deepEqual(await empty.complete({ system: '', messages: [] }), { text: '', stop: 'length' });
  // extraBody 必须是对象
  for (const bad of [null, 'thinking', 5, ['x']]) await assert.rejects(createProvider({ provider: 'openai', model: 'm', extraBody: bad }, { env: {} }), (err) => err.fatal && err.message.includes('extraBody'));
});

test('anthropic 提供者：请求的形状（SPEC §15.2）、拒绝、错误类型；SDK 缺失时给出安装提示', async () => {
  const seen = [];
  class APIError extends Error { constructor(m, status) { super(m); this.status = status; } }
  class AuthenticationError extends APIError {}
  class RateLimitError extends APIError {}
  class InternalServerError extends APIError {}
  class NotFoundError extends APIError {}
  let script = () => ({ stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 7 }, content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: '{"actions"' }, { type: 'text', text: ': []}' }] });
  class Anthropic {
    constructor(opts) {
      seen.push({ ctor: opts });
      this.beta = { messages: { create: async (req) => { seen.push({ req }); return script(req); } } };
    }
  }
  Object.assign(Anthropic, { AuthenticationError, RateLimitError, InternalServerError, NotFoundError });
  const load = async () => ({ default: Anthropic });
  process.env.TEST_ANTHROPIC_KEY = 'sk-ant-secret-xyz';
  let prov = await createProvider({ provider: 'anthropic', apiKeyEnv: 'TEST_ANTHROPIC_KEY' }, { loadAnthropic: load });
  const r = await prov.complete({ system: 'SYSTEM-PROMPT', messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual(r, { text: '{"actions": []}', stop: 'end_turn', usage: { input: 5, output: 7 } });
  assert.deepEqual(seen[0].ctor, { apiKey: 'sk-ant-secret-xyz' });
  const req = seen[1].req;
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.max_tokens, 16000);
  assert.deepEqual(req.system, [{ type: 'text', text: 'SYSTEM-PROMPT', cache_control: { type: 'ephemeral', ttl: '1h' } }]);
  assert.deepEqual(req.messages, [{ role: 'user', content: 'hi' }]);
  assert.deepEqual(req.output_config, { effort: 'medium' });
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.fallbacks, 'default');
  for (const forbidden of ['thinking', 'temperature', 'top_p', 'top_k']) assert.ok(!(forbidden in req), `不应发送 ${forbidden}`);
  assert.equal(req.messages.some((m) => m.role === 'assistant' && m === req.messages[req.messages.length - 1]), false, '不预填 assistant 消息');
  // 配置：模型、effort、baseURL + fallbacks: false
  seen.length = 0;
  prov = await createProvider({ provider: 'anthropic', model: 'claude-x', effort: 'high', fallbacks: false, baseURL: 'https://proxy.example/v1' }, { loadAnthropic: load });
  await prov.complete({ system: 'S', messages: [{ role: 'user', content: 'u' }] });
  assert.deepEqual(seen[0].ctor, { baseURL: 'https://proxy.example/v1' }, '省略 apiKeyEnv 时用 SDK 默认的凭据解析');
  assert.equal(seen[1].req.model, 'claude-x');
  assert.deepEqual(seen[1].req.output_config, { effort: 'high' });
  assert.ok(!('betas' in seen[1].req) && !('fallbacks' in seen[1].req));
  // 拒绝：本刻不行动
  script = () => ({ stop_reason: 'refusal', stop_details: { category: 'x' }, content: [] });
  assert.deepEqual(await prov.complete({ system: 'S', messages: [] }), { text: '', stop: 'refusal', details: { category: 'x' } });
  // 错误：类型化异常
  const failWith = async (err) => {
    script = () => { throw err; };
    try {
      await prov.complete({ system: 'S', messages: [] });
      return null;
    } catch (e) {
      return e;
    }
  };
  let e = await failWith(new AuthenticationError('invalid x-api-key', 401));
  assert.ok(e.fatal && e.message.includes('认证失败'));
  e = await failWith(new NotFoundError('model: nope', 404));
  assert.ok(e.fatal);
  e = await failWith(new RateLimitError('rate limited', 429));
  assert.ok(e.retryable && !e.fatal);
  e = await failWith(new InternalServerError('overloaded', 529));
  assert.ok(e.retryable && !e.fatal);
  e = await failWith(new APIError('bad', 400));
  assert.ok(!e.retryable && !e.fatal);
  e = await failWith(new Error('socket hang up'));
  assert.ok(e.retryable);
  // 密钥变量没设置 / SDK 没装
  await assert.rejects(createProvider({ provider: 'anthropic', apiKeyEnv: 'DEFINITELY_NOT_SET_XYZ' }, { loadAnthropic: load }), (err) => err.fatal && err.message.includes('DEFINITELY_NOT_SET_XYZ'));
  await assert.rejects(createProvider({ provider: 'anthropic' }, { loadAnthropic: async () => { throw new Error('Cannot find package'); } }), (err) => err.fatal && err.message.includes('npm install @anthropic-ai/sdk'));
  await assert.rejects(createProvider({ provider: 'nope' }), (err) => err.fatal && err.message.includes('anthropic'));
  delete process.env.TEST_ANTHROPIC_KEY;
});

// ── 配置与日志 ────────────────────────────────────────────────

test('配置：runner/agents.example.json 有效；缺令牌变量、未知提供者、错误的 actEveryTicks 都有清楚的报错', () => {
  const env = { HOUREN_TOKEN_A: 'tok-a-123456', HOUREN_TOKEN_B: 'tok-b-123456', HOUREN_TOKEN_C: 'tok-c-123456' };
  const agents = loadRunnerConfig(join(ROOT, 'runner/agents.example.json'), env);
  assert.equal(agents.length, 3);
  assert.deepEqual(agents.map((a) => a.provider), ['anthropic', 'openai', 'mock']);
  assert.equal(agents[0].token, 'tok-a-123456');
  assert.equal(agents[0].server, 'http://127.0.0.1:8787');
  assert.equal(agents[1].lang, 'en');
  assert.equal(agents[1].actEveryTicks, 1);
  assert.equal(agents[0].model, 'claude-opus-5-5');
  const bad = (raw, re) => assert.throws(() => parseRunnerConfig(raw, env), re);
  bad(null, /JSON 对象/);
  bad({ agents: [] }, /非空数组/);
  bad({ server: 'ftp://x', agents: [{}] }, /http/);
  bad({ agents: [{ provider: 'mock' }] }, /tokenEnv/);
  bad({ agents: [{ tokenEnv: 'NOT_SET', provider: 'mock' }] }, /NOT_SET/);
  bad({ agents: [{ tokenEnv: 'HOUREN_TOKEN_A', provider: 'gpt' }] }, /provider/);
  bad({ agents: [{ tokenEnv: 'HOUREN_TOKEN_A', provider: 'mock', actEveryTicks: 0 }] }, /actEveryTicks/);
  bad({ agents: [{ tokenEnv: 'HOUREN_TOKEN_A', provider: 'mock', actEveryTicks: 1.5 }] }, /actEveryTicks/);
  bad({ agents: [{ tokenEnv: 'HOUREN_TOKEN_A', provider: 'mock', historyRounds: -1 }] }, /historyRounds/);
  bad({ agents: [{ tokenEnv: 'HOUREN_TOKEN_A', provider: 'mock', historyRounds: 21 }] }, /historyRounds/);
  bad({ agents: [{ tokenEnv: 'HOUREN_TOKEN_A', provider: 'mock', historyRounds: 2.5 }] }, /historyRounds/);
  bad({ agents: [{ tokenEnv: 'HOUREN_TOKEN_A', provider: 'openai', model: 'm', extraBody: 'x' }] }, /extraBody/);
  assert.equal(parseRunnerConfig({ agents: [{ tokenEnv: 'HOUREN_TOKEN_A', provider: 'mock', historyRounds: 0, extraBody: { a: 1 } }] }, env)[0].historyRounds, 0);
  assert.throws(() => loadRunnerConfig('/no/such/file.json', env), /读不了配置文件/);
});

test('日志：出现在文本里的令牌与密钥被替换成 ***', () => {
  const out = [];
  const err = [];
  const log = makeLogger('青禾', { secrets: ['tok-secret-abcdef', 'sk-key-abcdef'], out: (s) => out.push(s), err: (s) => err.push(s) });
  log.info('令牌 tok-secret-abcdef 与 sk-key-abcdef');
  log.warn('again tok-secret-abcdef');
  log.error('x');
  assert.ok(out[0].includes('[青禾]') && out[0].includes('*** 与 ***'));
  assert.ok(!out.join('').includes('tok-secret') && !err.join('').includes('tok-secret'));
  const quiet = [];
  makeLogger('q', { quiet: true, out: (s) => quiet.push(s) }).info('hidden');
  assert.deepEqual(quiet, []);
});

test('HTTP 客户端：令牌只在 Authorization 头里；网络错误与超时不含令牌；after 只在显式给出时才带', async () => {
  const seen = [];
  const client = createClient({ server: 'http://x.test/', token: 'TOKEN-XYZ-123', fetch: async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, json: async () => ({ hi: 1 }) }; } });
  await client.me({ lang: 'en' });
  await client.me({ lang: 'zh', after: 0 });
  await client.act({ thought: '想', actions: [{ type: 'say', text: 'a' }] });
  await client.act({ actions: [] });
  assert.equal(seen[0].url, 'http://x.test/api/me?lang=en');
  assert.equal(seen[1].url, 'http://x.test/api/me?lang=zh&after=0');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer TOKEN-XYZ-123');
  assert.deepEqual(JSON.parse(seen[2].init.body), { actions: [{ type: 'say', text: 'a' }], thought: '想' });
  assert.deepEqual(JSON.parse(seen[3].init.body), { actions: [] });
  assert.ok(!seen[0].url.includes('TOKEN'));
  const dead = createClient({ server: 'http://127.0.0.1:1', token: 'TOKEN-XYZ-123', timeoutMs: 500 });
  const r = await dead.me();
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
  assert.ok(!JSON.stringify(r).includes('TOKEN-XYZ'));
});

// ── 运行器驱动一个 agent（真实服务器 + mock 提供者） ───────────

/** 每次「等到下一刻」就让世界推进一刻，并记下调用的参数 */
function tickingWait(env, { onWait } = {}) {
  const calls = [];
  const wait = async (ms) => {
    calls.push(ms);
    if (onWait) await onWait(calls.length);
    env.rt.tickNow();
  };
  return { wait, calls };
}

async function setup(name = '试演') {
  const env = await boot({ tickMs: 300000 });
  const me = await env.register(name);
  const cfg = { name, server: env.base, token: me.agentToken, lang: 'zh', provider: 'mock', seed: 3, chatty: true, actEveryTicks: 1 };
  return { env, me, cfg };
}

test('运行器：mock 提供者驱动一个 agent 连续行动 10 刻，观测站看得到它的动作', async () => {
  const { env, me, cfg } = await setup();
  try {
    const logs = [];
    const log = { info: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`), error: (m) => logs.push(`ERR ${m}`) };
    const { wait } = tickingWait(env);
    const seenMessages = [];
    const provider = await createProvider(cfg);
    const spy = { name: 'spy', complete: async (req) => { seenMessages.push(req); return provider.complete(req); } };
    const res = await runAgent(cfg, { provider: spy, log, wait, maxRounds: 10 });
    assert.equal(res.rounds, 10);
    assert.equal(res.stopped, 'maxRounds');
    assert.ok(res.acted >= 5, `acted ${res.acted}`);
    assert.equal(env.rt.w.clock.tick, 10, '每一轮之后世界前进一刻');
    // 系统提示在整轮中不变（利于缓存），含灵魂；user 消息是渲染后的感知
    assert.ok(seenMessages.every((m) => m.system === seenMessages[0].system));
    assert.ok(seenMessages[0].system.includes('SECRET-SOUL-试演'));
    assert.ok(seenMessages[0].messages.at(-1).content.startsWith('【此刻】'));
    // 短期记忆：最多 6 轮 + 本轮
    assert.equal(seenMessages[0].messages.length, 1);
    assert.equal(seenMessages[3].messages.length, 7);
    assert.equal(seenMessages[9].messages.length, 13);
    assert.deepEqual(seenMessages[9].messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user']);
    // 上一轮的结果出现在下一轮的感知末尾
    assert.ok(seenMessages[1].messages.at(-1).content.includes('【上一轮的结果】'));
    // 它的动作出现在公共事件里
    const evs = env.rt.events.since(0, 500).filter((e) => e.agent === me.agentId).map((e) => e.type);
    assert.ok(evs.some((t) => ['say', 'move', 'draw', 'explore'].includes(t)), evs.join(','));
    assert.ok(logs.some((l) => l.includes('✓')));
    assert.ok(logs.some((l) => /^模型用时 \d+\.\d s$/.test(l)), '每轮记一行模型用时（mock 没有用量）');
    assert.ok(!logs.join('\n').includes(me.agentToken), '日志里没有令牌');
    // 日记（mock 偶尔写）只有造者能看到：不在公共事件里
    const pub = (await env.call('/api/public/events?since=0&limit=500')).text;
    assert.ok(!pub.includes('mock 日记'));
  } finally {
    await env.close();
  }
});

test('运行器：historyRounds 调小短期记忆（省 token）：2 轮时每次最多带 5 条消息，0 轮时只有本轮的感知', async () => {
  for (const [rounds, maxMessages] of [[2, 5], [0, 1], [undefined, 13]]) {
    const { env, cfg } = await setup(`史${rounds}`);
    try {
      const counts = [];
      const provider = { name: 'x', complete: async (req) => { counts.push(req.messages.length); return { text: '{"actions": []}', stop: 'end' }; } };
      const { wait } = tickingWait(env);
      await runAgent({ ...cfg, historyRounds: rounds }, { provider, wait, log: { info() {}, warn() {}, error() {} }, maxRounds: 9 });
      assert.equal(counts.length, 9);
      assert.equal(Math.max(...counts), maxMessages, `historyRounds=${rounds}：${counts.join(',')}`);
      assert.equal(counts[0], 1);
    } finally {
      await env.close();
    }
  }
});

test('运行器：解析失败的回复本刻不行动；收件在成功行动之前一直保留（至少一次）；下一轮提示模型', async () => {
  const { env, me, cfg } = await setup('乙');
  try {
    const other = await env.register('丙');
    env.rt.exec('act', { agentId: other.agentId, actions: [{ type: 'whisper', to: me.agentId, text: 'SECRET-PING-一' }] });
    const replies = ['我想想……（没有 JSON）', '{"actions": []}', '{"thought": "好", "actions": [{"type": "say", "text": "回声"}]}', '{"actions": []}'];
    const seen = [];
    const provider = { name: 'scripted', complete: async (req) => { seen.push(req.messages.at(-1).content); return { text: replies[seen.length - 1], stop: 'end' }; } };
    const acts = [];
    const client = createClient({ server: env.base, token: cfg.token, fetch: async (u, i) => { if (i && i.method === 'POST') acts.push(JSON.parse(i.body)); return fetch(u, i); } });
    const logs = [];
    const { wait } = tickingWait(env);
    const res = await runAgent(cfg, { client, provider, wait, maxRounds: 4, log: { info: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`), error: (m) => logs.push(`ERR ${m}`) } });
    assert.equal(res.rounds, 4);
    assert.equal(res.acted, 1, '只有第 3 轮有动作（第 2 轮 actions 为空、没有独白：不发 act 请求）');
    assert.deepEqual(acts, [{ actions: [{ type: 'say', text: '回声' }], thought: '好' }]);
    assert.ok(logs.some((l) => l.startsWith('WARN 回复里没有可解析的 JSON')));
    assert.ok(seen[0].includes('SECRET-PING-一'), '第 1 轮看到收件');
    assert.ok(seen[1].includes('SECRET-PING-一'), '第 1 轮解析失败，游标没动，第 2 轮仍然看到');
    assert.ok(seen[1].includes('你上一轮的回复无法解析'));
    assert.ok(!seen[2].includes('SECRET-PING-一'), '第 2 轮收下了回复（决定不行动），收件此时才算确认，第 3 轮不再出现');
    assert.ok(!seen[3].includes('SECRET-PING-一'));
    assert.ok(!seen[2].includes('你上一轮的回复无法解析'), '提示只出现一轮');
  } finally {
    await env.close();
  }
});

test('运行器：致命的提供者错误停止该 agent；可重试的错误下一刻再来；拒绝本刻不行动', async () => {
  const { env, cfg } = await setup('丁');
  try {
    const log = { info() {}, warn() {}, error() {} };
    const { wait } = tickingWait(env);
    let n = 0;
    const fatal = { name: 'x', complete: async () => { n++; throw new ProviderError('认证失败', { fatal: true }); } };
    assert.deepEqual(await runAgent(cfg, { provider: fatal, wait, log, maxRounds: 5 }), { rounds: 1, acted: 0, stopped: 'provider' });
    assert.equal(n, 1);
    n = 0;
    const flaky = { name: 'x', complete: async () => { n++; if (n === 1) throw new ProviderError('限速', { retryable: true }); if (n === 2) return { text: '', stop: 'refusal' }; return { text: '{"actions": [{"type": "say", "text": "好"}]}', stop: 'end' }; } };
    const res = await runAgent(cfg, { provider: flaky, wait, log, maxRounds: 3 });
    assert.equal(res.rounds, 3);
    assert.equal(res.acted, 1);
    // 提供者创建失败（如 SDK 没装）：不启动
    const res2 = await runAgent({ ...cfg, provider: 'anthropic' }, { providerDeps: { loadAnthropic: async () => { throw new Error('missing'); } }, wait, log });
    assert.deepEqual(res2, { rounds: 0, acted: 0, stopped: 'provider' });
  } finally {
    await env.close();
  }
});

test('运行器：服务商一再拒绝同样的请求（配置错了）连续 5 次后停止；限速这类可重试的错误不算，成功一次就清零', async () => {
  const { env, cfg } = await setup('庚');
  try {
    const logs = [];
    const log = { info() {}, warn: (m) => logs.push(m), error: (m) => logs.push(`ERR ${m}`) };
    const { wait } = tickingWait(env);
    let n = 0;
    const rejecting = { name: 'x', complete: async () => { n++; throw new ProviderError('模型不存在', { retryable: false, status: 400 }); } };
    assert.deepEqual(await runAgent(cfg, { provider: rejecting, wait, log, maxRounds: 50 }), { rounds: 5, acted: 0, stopped: 'provider' });
    assert.equal(n, 5);
    assert.ok(logs.some((l) => l.startsWith('ERR 连续 5 次被服务商拒绝')));
    // 可重试的错误（限速、5xx）永远不会触发放弃
    n = 0;
    const throttled = { name: 'x', complete: async () => { n++; throw new ProviderError('限速', { retryable: true, status: 429 }); } };
    assert.equal((await runAgent(cfg, { provider: throttled, wait, log, maxRounds: 8 })).stopped, 'maxRounds');
    // 中间成功一次，计数清零：拒绝 4 次 → 成功 → 再拒绝 4 次，不会停
    n = 0;
    const flaky = { name: 'x', complete: async () => { n++; if (n === 5) return { text: '{"actions": []}', stop: 'end' }; throw new ProviderError('参数不对', { retryable: false, status: 400 }); } };
    const res = await runAgent(cfg, { provider: flaky, wait, log, maxRounds: 9 });
    assert.equal(res.stopped, 'maxRounds');
    assert.equal(n, 9);
  } finally {
    await env.close();
  }
});

test('运行器：令牌无效时停止；agent 归隐后停止；沉睡与暂停时等待而不调用提供者', async () => {
  const { env, me, cfg } = await setup('戊');
  try {
    const log = { info() {}, warn() {}, error() {} };
    const { wait } = tickingWait(env);
    const never = { name: 'x', complete: async () => { throw new Error('不该被调用'); } };
    // 令牌无效
    assert.deepEqual(await runAgent({ ...cfg, token: 'not-a-token' }, { provider: never, wait, log, maxRounds: 3 }), { rounds: 0, acted: 0, stopped: 'auth' });
    // 沉睡：等待，醒来（被赠予）后继续
    const a = env.rt.w.agents[me.agentId];
    a.energy = 0;
    a.status = 'dormant';
    a.dormantSinceDay = 0;
    let waits = 0;
    const woke = tickingWait(env, { onWait: async () => { waits++; if (waits === 2) { a.energy = 30; a.status = 'awake'; } } });
    let called = 0;
    const provider = { name: 'x', complete: async () => { called++; return { text: '{"actions": []}', stop: 'end' }; } };
    const r1 = await runAgent(cfg, { provider, wait: woke.wait, log, maxRounds: 1 });
    assert.equal(r1.rounds, 1);
    assert.equal(waits >= 2, true, '沉睡时至少等了两刻');
    assert.equal(called, 1, '醒来之前没有调用提供者');
    // 暂停：等待
    env.rt.exec('admin', { op: 'pause' });
    let pw = 0;
    const paused = tickingWait(env, { onWait: async () => { pw++; if (pw === 2) env.rt.exec('admin', { op: 'resume' }); } });
    called = 0;
    const r2 = await runAgent(cfg, { provider, wait: paused.wait, log, maxRounds: 1 });
    assert.equal(r2.rounds, 1);
    assert.ok(pw >= 2);
    // 归隐后停止
    const retirer = { name: 'x', complete: async () => ({ text: '{"actions": [{"type": "retire", "lastWords": "再见"}]}', stop: 'end' }) };
    const r3 = await runAgent(cfg, { provider: retirer, wait, log, maxRounds: 5 });
    assert.equal(r3.stopped, 'retired');
    assert.equal(r3.rounds, 1);
  } finally {
    await env.close();
  }
});

test('运行器：actEveryTicks 让 agent 隔几刻才行动一次；等待时间来自 nextTickAt 并带 0–10% 抖动', async () => {
  const { env, cfg } = await setup('己');
  try {
    const log = { info() {}, warn() {}, error() {} };
    const provider = { name: 'x', complete: async () => ({ text: '{"actions": []}', stop: 'end' }) };
    const waits1 = tickingWait(env);
    await runAgent({ ...cfg, actEveryTicks: 1 }, { provider, wait: waits1.wait, log, maxRounds: 2 });
    const waits3 = tickingWait(env);
    await runAgent({ ...cfg, actEveryTicks: 3 }, { provider, wait: waits3.wait, log, maxRounds: 2 });
    const tickMs = 300000;
    // 一刻 = 300000 ms；nextTickAt 距现在不到一刻，再加抖动（< 10% = 30000）
    for (const ms of waits1.calls) assert.ok(ms >= 1000 && ms < tickMs + 30001, String(ms));
    for (const ms of waits3.calls) assert.ok(ms > 2 * tickMs && ms < 3 * tickMs + 30001, String(ms));
  } finally {
    await env.close();
  }
});
