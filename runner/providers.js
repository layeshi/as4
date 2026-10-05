// 模型提供者（SPEC §15.2）：createProvider(config) → { name, complete({ system, messages, perception? }) → { text, stop }, step?(…) }。
//
// complete：文本进、文本出（一刻一问，以及第二前提的文本 JSON 方式）。
// step（SPEC-P2 §9.1，只在原生工具调用方式里用；anthropic、openai、openai-responses 有，mock 有）：
//   step({ system, transcript, tools, signal, timeoutMs, perception? }) → { calls: [{ id, name, args }], text, stop, usage, raw }
//   transcript 是中立格式：{ role: 'user', text } | { role: 'assistant', raw }（上一次 step 返回的 raw，原样传回）
//     | { role: 'tool', results: [{ id, name, text, isError }] }；tools 是 [{ name, description, schema }]。
//   args 解析失败（比如 arguments 的 JSON 坏了）的调用，args 为 null。perception 只有 mock 用。
//   complete 与 step 都可以带 timeoutMs：这一次调用的超时（运行器按离下一刻的剩余时间算），缺省取线路配置。
//
// - anthropic：官方 SDK @anthropic-ai/sdk，动态 import；未安装时给出安装提示。
// - openai：任何 OpenAI 兼容接口，用 fetch，不引依赖。
// - openai-responses：OpenAI Responses 接口，用 fetch，不引依赖。
// - mock：不联网，按感知随机生成合法动作，用于测试与演示。
//
// 安全：API 密钥只从环境变量读取，绝不进入提示，也不出现在错误信息与日志里。
// 错误分级（ProviderError）：fatal——停止该 agent 并清楚地报错（认证失败、模型不存在）；
// retryable——本刻放弃，等到下一刻再来（限速、5xx、超时、网络）；其余——本刻放弃并记录。

export class ProviderError extends Error {
  /** timeout：这次失败是超时（运行器据此区分「被刻点截断」与线路自己的故障，SPEC-P2 §7.4） */
  constructor(message, { fatal = false, retryable = !fatal, status, timeout = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.fatal = fatal;
    this.retryable = retryable;
    this.status = status;
    this.timeout = timeout;
  }
}

/** HTTP 状态 → 错误级别 */
export function classifyStatus(status, message) {
  if (status === 401 || status === 403) return new ProviderError(`认证失败（HTTP ${status}）：${message}`, { fatal: true, status });
  if (status === 404) return new ProviderError(`接口或模型不存在（HTTP 404）：${message}`, { fatal: true, status });
  if (status === 408 || status === 409 || status === 429 || status >= 500) return new ProviderError(`暂时不可用（HTTP ${status}）：${message}`, { retryable: true, status });
  return new ProviderError(`请求被拒绝（HTTP ${status}）：${message}`, { retryable: false, status });
}

/** 从异常里取一句不含密钥的话 */
function safeMessage(e) {
  const m = (e && (e.message || String(e))) || 'error';
  return String(m).slice(0, 300);
}

/** 超时：AbortSignal.timeout 与 modelFetch 的超时都叫 TimeoutError；有些封装把它放在 cause 里（SPEC-P2 §9.4） */
const isTimeout = (e) => !!e && (e.name === 'TimeoutError' || (e.cause && e.cause.name === 'TimeoutError'));
const seconds = (ms) => Math.round(ms / 1000);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 工具调用的参数：字符串（JSON）或对象；解析不出对象就是 null，运行器给它参数错误的结果 */
function parseArgs(raw) {
  if (isObject(raw)) return raw;
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw !== 'string') return null;
  try {
    const v = JSON.parse(raw);
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

// ── anthropic ─────────────────────────────────────────────────

async function createAnthropicProvider(cfg, deps) {
  let mod;
  try {
    mod = await (deps.loadAnthropic ? deps.loadAnthropic() : import('@anthropic-ai/sdk'));
  } catch {
    throw new ProviderError('缺少 @anthropic-ai/sdk：请先运行 npm install @anthropic-ai/sdk（或改用 provider "openai" / "mock"）。', { fatal: true });
  }
  const Anthropic = mod.default || mod.Anthropic || mod;
  const apiKey = cfg.apiKeyEnv ? (deps.env || process.env)[cfg.apiKeyEnv] : undefined; // 省略 apiKeyEnv 时用 SDK 默认的凭据解析
  if (cfg.apiKeyEnv && !apiKey) throw new ProviderError(`环境变量 ${cfg.apiKeyEnv} 没有设置。`, { fatal: true });
  const client = new Anthropic({
    ...(apiKey ? { apiKey } : {}),
    ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
    ...(cfg.timeoutMs ? { timeout: cfg.timeoutMs } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.fetch ? { maxRetries: 0 } : {}),
  });

  const isA = (e, name) => typeof Anthropic[name] === 'function' && e instanceof Anthropic[name];

  /** 异常 → ProviderError（错误分级） */
  const classify = (e) => {
    if (isA(e, 'AuthenticationError') || isA(e, 'PermissionDeniedError')) return new ProviderError(`认证失败：${safeMessage(e)}`, { fatal: true, status: e.status });
    if (isA(e, 'NotFoundError')) return new ProviderError(`模型或接口不存在：${safeMessage(e)}`, { fatal: true, status: e.status });
    if (isA(e, 'RateLimitError') || isA(e, 'InternalServerError') || isA(e, 'APIConnectionError') || isA(e, 'APIConnectionTimeoutError')) {
      return new ProviderError(`暂时不可用：${safeMessage(e)}`, { retryable: true, status: e.status, timeout: isA(e, 'APIConnectionTimeoutError') });
    }
    if (typeof e.status === 'number') return classifyStatus(e.status, safeMessage(e));
    return new ProviderError(safeMessage(e), { retryable: true });
  };

  // 默认模型 claude-opus-5-5。不要发送 thinking、temperature、top_p、top_k（该模型会返回 400），不要预填 assistant 消息。
  const request = (system, messages) => ({
    model: cfg.model ?? 'claude-opus-5-5',
    max_tokens: cfg.maxTokens ?? 16000,
    // 一刻恰好 5 分钟，等于默认缓存有效期：系统提示用 1 小时缓存
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages,
    output_config: { effort: cfg.effort ?? 'medium' },
    // fallbacks: "default" 只在第一方 Claude API 上可用；baseURL 指向代理或其他平台时配置 "fallbacks": false
    ...(cfg.fallbacks !== false ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  });

  const call = async (req, signal, timeoutMs) => {
    const options = signal || timeoutMs ? { ...(signal ? { signal } : {}), ...(timeoutMs ? { timeout: timeoutMs } : {}) } : undefined;
    try {
      return await client.beta.messages.create(req, options);
    } catch (e) {
      throw classify(e);
    }
  };

  // 用量：输入含缓存写入与缓存命中（缓存命中也照常计入，SPEC-E2 §13.3）；响应里没有缓存字段时与原来相同
  const usageOf = (resp) => (resp.usage && Number.isFinite(resp.usage.input_tokens)
    ? { usage: { input: resp.usage.input_tokens + (resp.usage.cache_creation_input_tokens || 0) + (resp.usage.cache_read_input_tokens || 0), output: resp.usage.output_tokens } }
    : {});

  /** 中立的对话记录 → anthropic 的消息；助手的内容（含思考块与 tool_use 块）原样传回 */
  const toMessages = (transcript) => transcript.map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.text };
    if (m.role === 'assistant') return { role: 'assistant', content: m.raw.content };
    return { role: 'user', content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.text, ...(r.isError ? { is_error: true } : {}) })) };
  });

  /** 在最后一条消息的最后一个块上加缓存断点，让同一次醒来里的前缀命中缓存（不改传进来的块：它们还要留在记录里） */
  const cacheLast = (messages) => {
    const last = messages[messages.length - 1];
    const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content.slice();
    if (blocks.length === 0) return messages;
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } };
    return [...messages.slice(0, -1), { ...last, content: blocks }];
  };

  return {
    name: 'anthropic',
    async complete({ system, messages, signal, timeoutMs }) {
      const resp = await call(request(system, messages), signal, timeoutMs);
      if (resp.stop_reason === 'refusal') return { text: '', stop: 'refusal', details: resp.stop_details };
      const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return { text, stop: resp.stop_reason, ...usageOf(resp) };
    },
    /** 原生工具调用（SPEC-P2 §9.3）：calls 是 tool_use 块；raw 是整段 content（思考块与 tool_use 块一并，下一轮原样传回） */
    async step({ system, transcript, tools, signal, timeoutMs }) {
      const req = { ...request(system, cacheLast(toMessages(transcript))), tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })) };
      const resp = await call(req, signal, timeoutMs);
      const content = resp.content || [];
      if (resp.stop_reason === 'refusal') return { calls: [], text: '', stop: 'refusal', raw: { content }, details: resp.stop_details, ...usageOf(resp) };
      const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      // 输出在 tool_use 中途被 max_tokens 截断：块里的 input 不完整，不当作行动
      const calls = resp.stop_reason === 'max_tokens' ? [] : content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: isObject(b.input) ? b.input : null }));
      return { calls, text, stop: resp.stop_reason, raw: { content }, ...usageOf(resp) };
    },
  };
}

// ── openai 兼容 ───────────────────────────────────────────────

export const OPENAI_REASONING_EFFORTS = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function validateReasoningEffort(cfg) {
  if (cfg.reasoningEffort !== undefined && !OPENAI_REASONING_EFFORTS.includes(cfg.reasoningEffort)) {
    throw new ProviderError('思考强度无效。', { fatal: true });
  }
}

function createOpenAIProvider(cfg, deps) {
  if (!cfg.model) throw new ProviderError(`${cfg.provider} 提供者需要配置 model。`, { fatal: true });
  validateReasoningEffort(cfg);
  const responses = cfg.provider === 'openai-responses';
  const effort = cfg.reasoningEffort === 'default' ? undefined : cfg.reasoningEffort;
  const fetchImpl = deps.fetch || globalThis.fetch;
  const key = cfg.apiKeyEnv ? (deps.env || process.env)[cfg.apiKeyEnv] : undefined;
  if (cfg.apiKeyEnv && !key) throw new ProviderError(`环境变量 ${cfg.apiKeyEnv} 没有设置。`, { fatal: true });
  const url = `${String(cfg.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/${responses ? 'responses' : 'chat/completions'}`;
  // extraBody：各家私有参数；不能覆盖模型、系统提示和消息输入。
  if (cfg.extraBody !== undefined && (cfg.extraBody === null || typeof cfg.extraBody !== 'object' || Array.isArray(cfg.extraBody))) {
    throw new ProviderError('extraBody 必须是一个 JSON 对象。', { fatal: true });
  }

  /** 思考强度、采样、token 上限的映射（complete 与 step 共用）。native 为真（工具调用方式）时不发 jsonMode */
  const applyParams = (body, { native = false } = {}) => {
    if (effort !== undefined) {
      if (responses) body.reasoning = { ...body.reasoning, effort };
      else body.reasoning_effort = effort;
      // Reasoning models reject sampling controls while thinking is enabled.
      if (effort !== 'none') {
        for (const k of ['temperature', 'top_p', 'top_logprobs', 'logprobs']) delete body[k];
      }
    }
    if (cfg.temperature !== undefined && (effort === undefined || effort === 'none')) body.temperature = cfg.temperature;
    if (cfg.maxTokens !== undefined) {
      if (!responses && effort !== undefined) delete body.max_tokens;
      body[responses ? 'max_output_tokens' : effort !== undefined ? 'max_completion_tokens' : 'max_tokens'] = cfg.maxTokens;
    }
    if (cfg.jsonMode && !native) {
      if (responses) body.text = { ...body.text, format: { type: 'json_object' } };
      else body.response_format = { type: 'json_object' };
    }
    return body;
  };

  /** 发一次请求，返回解析后的 JSON；超时取 timeoutMs（运行器按剩余时间给），缺省取线路配置，再缺省 120 秒（SPEC-P2 §9.4） */
  const post = async (body, signal, timeoutMs) => {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const limit = timeoutMs ?? cfg.timeoutMs ?? 120000;
    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(limit)]) : AbortSignal.timeout(limit) });
    } catch (e) {
      const timedOut = isTimeout(e);
      throw new ProviderError(`网络错误：${timedOut ? `timeout（${seconds(limit)} 秒）` : safeMessage(e)}`, { retryable: true, timeout: timedOut });
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      const detail = json && json.error ? (typeof json.error === 'string' ? json.error : json.error.message) : `HTTP ${res.status}`;
      throw classifyStatus(res.status, String(detail).slice(0, 300));
    }
    return json;
  };

  // ── Responses 的输出：正文、拒绝、未完成 ──
  const responsesOutput = (json) => {
    if (json?.error || json?.status === 'failed') throw new ProviderError('Responses 接口返回失败状态。', { retryable: true });
    const content = (json?.output || []).filter((item) => item.type === 'message' && item.role === 'assistant').flatMap((item) => item.content || []);
    const refused = content.some((part) => part.type === 'refusal');
    const incomplete = json?.status === 'incomplete';
    const pending = json?.status && json.status !== 'completed' && !incomplete;
    const usable = !(refused || incomplete || pending); // 拒绝、未完成的输出不能成为决定
    const stop = refused ? 'refusal' : incomplete ? (json.incomplete_details?.reason === 'max_output_tokens' ? 'length' : 'incomplete') : pending ? json.status : 'stop';
    const text = usable ? content.filter((part) => part.type === 'output_text').map((part) => part.text || '').join('') : '';
    const u = json?.usage;
    const usage = u && Number.isFinite(u.input_tokens) ? { input: u.input_tokens, output: u.output_tokens } : undefined;
    const reasoning = u?.output_tokens_details?.reasoning_tokens;
    if (usage && Number.isFinite(reasoning)) usage.reasoning = reasoning;
    return { usable, stop, text, usage };
  };

  /** 中立的对话记录 → Responses 的 input：助手的输出（含推理项、function_call、message）原样追加 */
  const toResponsesInput = (transcript) => transcript.flatMap((m) => {
    if (m.role === 'user') return [{ role: 'user', content: m.text }];
    if (m.role === 'assistant') return m.raw.output;
    return m.results.map((r) => ({ type: 'function_call_output', call_id: r.id, output: r.text }));
  });

  /** 中立的对话记录 → chat completions 的消息：助手的 message 原样（含 tool_calls 与推理字段），每个工具结果一条 */
  const toChatMessages = (transcript) => transcript.flatMap((m) => {
    if (m.role === 'user') return [{ role: 'user', content: m.text }];
    if (m.role === 'assistant') return [m.raw.message];
    return m.results.map((r) => ({ role: 'tool', tool_call_id: r.id, content: r.text }));
  });

  return {
    name: cfg.provider,
    async complete({ system, messages, signal, timeoutMs }) {
      const body = applyParams(responses
        ? { ...(cfg.extraBody || {}), model: cfg.model, instructions: system, input: messages, store: false, stream: false }
        : { ...(cfg.extraBody || {}), model: cfg.model, messages: [{ role: 'system', content: system }, ...messages] });
      const json = await post(body, signal, timeoutMs);
      if (responses) {
        const o = responsesOutput(json);
        return { text: o.text, stop: o.stop, ...(o.usage ? { usage: o.usage } : {}) };
      }
      const choice = json && json.choices && json.choices[0];
      const out = { text: (choice && choice.message && choice.message.content) || '', stop: (choice && choice.finish_reason) || 'stop' };
      const u = json && json.usage;
      if (u && Number.isFinite(u.prompt_tokens)) out.usage = { input: u.prompt_tokens, output: u.completion_tokens };
      const reasoning = u?.completion_tokens_details?.reasoning_tokens;
      if (out.usage && Number.isFinite(reasoning)) out.usage.reasoning = reasoning;
      return out;
    },
    /** 原生工具调用（SPEC-P2 §9.3）：不发 jsonMode；extraBody 不能覆盖 tools；raw 原样传回（含推理内容） */
    async step({ system, transcript, tools, signal, timeoutMs }) {
      if (responses) {
        const body = applyParams({
          ...(cfg.extraBody || {}), model: cfg.model, instructions: system, input: toResponsesInput(transcript), store: false, stream: false,
          include: [...new Set([...((cfg.extraBody && cfg.extraBody.include) || []), 'reasoning.encrypted_content'])], // store: false 时带上加密的推理项，下一轮原样传回
          tools: tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.schema })),
        }, { native: true });
        const json = await post(body, signal, timeoutMs);
        const o = responsesOutput(json);
        const output = Array.isArray(json?.output) ? json.output : [];
        const calls = o.usable ? output.filter((item) => item.type === 'function_call').map((item) => ({ id: item.call_id, name: item.name, args: parseArgs(item.arguments) })) : [];
        return { calls, text: o.text, stop: o.usable && calls.length ? 'tool_calls' : o.stop, raw: { output }, ...(o.usage ? { usage: o.usage } : {}) };
      }
      const body = applyParams({
        ...(cfg.extraBody || {}), model: cfg.model, messages: [{ role: 'system', content: system }, ...toChatMessages(transcript)],
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })), tool_choice: 'auto',
      }, { native: true });
      const json = await post(body, signal, timeoutMs);
      const choice = json && json.choices && json.choices[0];
      const message = (choice && choice.message) || { role: 'assistant', content: '' };
      const calls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).filter((c) => c && c.function).map((c) => ({ id: c.id, name: c.function.name, args: parseArgs(c.function.arguments) }));
      const out = { calls, text: typeof message.content === 'string' ? message.content : '', stop: (choice && choice.finish_reason) || 'stop', raw: { message } };
      const u = json && json.usage;
      if (u && Number.isFinite(u.prompt_tokens)) out.usage = { input: u.prompt_tokens, output: u.completion_tokens };
      const reasoning = u?.completion_tokens_details?.reasoning_tokens;
      if (out.usage && Number.isFinite(reasoning)) out.usage.reasoning = reasoning;
      return out;
    },
  };
}

// ── mock ──────────────────────────────────────────────────────

/** 小型确定性随机数（mulberry32）：运行器不受引擎确定性约束，但测试希望可复现 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MOCK_LINES = {
  zh: ['大家好，我是一个演示用的居民。', '今天的源井怎么样？', '愿灯不灭。', '有人在议会吗？'],
  en: ['Hello, I am a demonstration resident.', 'How is the Well today?', 'May the lamp stay lit.', 'Is anyone at the Parliament?'],
};

/**
 * 协议 2：偶尔提出的模板法律（SPEC-E2 附录 A.2 的三个例子）。规则是校验过的合法写法；标题带一个随机编号，避免同名。
 * 第一个限制汲取，第二个每日给带标签的人发能量，第三个修缮后补贴。
 */
export function mockProposal(lang, rnd) {
  const en = lang === 'en';
  const keeper = en ? 'keeper' : '守井人';
  const examples = [
    {
      title: en ? 'Draw limit' : '汲取限额',
      text: en ? 'At most 5 energy a day may be drawn from the Well per person.' : '每人每日至多从源井汲取 5 能量。',
      rules: [{ when: 'before:draw', if: 'actor.drawnToday + args.energy > 5', do: [{ op: 'deny', reason: en ? 'at most 5 a day per person' : '每人每日限汲 5' }] }],
    },
    {
      title: en ? 'Keepers\' allowance' : '守井人津贴',
      text: en ? 'Each day the Treasury pays every keeper 3 energy.' : '每日公库给每位守井人 3 能量。',
      rules: [{ when: 'daily', do: [{ op: 'each', in: `tagged('${keeper}')`, do: [{ op: 'transfer', from: 'treasury', to: 'it', energy: '3' }] }] }],
    },
    {
      title: en ? 'Repair subsidy' : '修缮补贴',
      text: en ? 'Whoever repairs a place is refunded half of what they spent, up to 10.' : '修缮者可从公库领回所花能量的一半，至多 10。',
      rules: [{ when: 'after:repair', if: 'result.spent >= 2', do: [{ op: 'transfer', from: 'treasury', to: 'actor', energy: 'min(10, result.spent / 2)' }] }],
    },
  ];
  const e = examples[Math.floor(rnd() * examples.length)];
  return { type: 'propose', title: `${e.title} ${1 + Math.floor(rnd() * 999)}`, text: e.text, rules: e.rules };
}

/** 按感知生成一次合法的行动（不联网）。返回 { thought, actions } */
export function mockDecide(p, rnd) {
  const lang = p.lang === 'en' ? 'en' : 'zh';
  const you = p.you;
  const here = p.here;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const actions = [];
  let thought = '';
  if (!you || you.status !== 'awake' || !here) return { actions };

  // 能量紧张：去源井汲取
  if (you.energy < 15) {
    thought = lang === 'zh' ? '（mock）能量不多了，去源井。' : '(mock) Energy is low; heading to the Well.';
    if (here.place !== 'well') actions.push({ type: 'move', to: 'well' });
    else if (here.well && here.well.drawPoolLeft > 0) actions.push({ type: 'draw', energy: Math.min(6, here.well.drawPoolLeft) });
    return { thought, actions };
  }

  // 有没投过票的提案就投票
  const open = ((p.city && p.city.proposals) || []).find((q) => !q.yourVote && q.eligible);
  if (open) actions.push({ type: 'vote', proposal: open.id, choice: rnd() < 0.7 ? 'yes' : 'abstain', reason: lang === 'zh' ? 'mock 的一票' : 'a mock vote' });

  // 修缮所在地点
  if (actions.length < 2 && here.condition && here.condition.bp < 9000 && you.energy > 30) actions.push({ type: 'repair', target: here.place, energy: 5 });

  // 协议 2：偶尔去议会，在那里提出一部合法的模板法律（便于演示与测试）
  if (p.protocol === 2 && actions.length < 2) {
    const prop = (p.actions || []).find((a) => a.type === 'propose');
    const r2 = rnd();
    if (prop && prop.available && r2 < 0.05) {
      actions.push(mockProposal(lang, rnd));
      thought = lang === 'zh' ? '（mock）试着提一部法律。' : '(mock) Let me try proposing a law.';
    } else if (prop && !prop.available && prop.reason && prop.reason.code === 'forbidden' && here.place !== 'parliament' && r2 < 0.06) {
      actions.push({ type: 'move', to: 'parliament' });
    }
  }

  const roll = rnd();
  if (actions.length < 2 && roll < 0.4) actions.push({ type: 'say', text: pick(MOCK_LINES[lang]) });
  else if (actions.length < 2 && roll < 0.7) {
    const to = pick(((p.city && p.city.places) || []).map((x) => x.id).filter((id) => id !== here.place));
    if (to) actions.push({ type: 'move', to });
  } else if (actions.length < 2 && roll < 0.8) actions.push({ type: 'diary', text: lang === 'zh' ? '（mock 日记）今天也平平安安。' : '(mock diary) A quiet day again.' });
  else if (actions.length < 2 && roll < 0.9 && here.wilds) actions.push({ type: 'explore' }); // 荒野（或边疆地图上荒野的任一地带）
  if (!thought && rnd() < 0.3) thought = lang === 'zh' ? '（mock）看看城里在发生什么。' : '(mock) Let me see what is going on in the city.';
  return { thought, actions };
}

/** 等 ms 毫秒；signal 中止时抛 AbortError；比 timeoutMs 长就在 timeoutMs 时抛超时（脚本里的 delayMs 用它模拟慢的模型） */
function mockDelay(ms, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    const limit = timeoutMs ?? Infinity;
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (ms > limit) reject(new ProviderError(`网络错误：timeout（${seconds(limit)} 秒）`, { retryable: true, timeout: true }));
      else resolve();
    }, Math.min(ms, limit));
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * 脚本里的调用 → 文本 JSON（第二前提的文本 JSON 方式，SPEC-P2 §9.2）：look 一个时是对象、多个时是数组；act；done。
 * 同一个对象里有几种时，解析时按 look、act、done 的顺序处理。
 */
function callsToJson(calls) {
  const obj = {};
  const looks = calls.filter((c) => c.name === 'look').map((c) => c.args);
  if (looks.length === 1) obj.look = looks[0];
  else if (looks.length > 1) obj.look = looks;
  const act = calls.find((c) => c.name === 'act');
  if (act) obj.act = act.args;
  if (calls.some((c) => c.name === 'done')) obj.done = true;
  return JSON.stringify(obj);
}

const MOCK_LOOKS = ['here', 'laws', 'proposals', 'self', 'places'];

function createMockProvider(cfg) {
  const rnd = mulberry32(Number.isInteger(cfg.seed) ? cfg.seed : 1);
  let n = 0;
  // script（测试用，SPEC-P2 §9.3）：每一项是一轮的回复——{ calls: [{ id?, name, args }], text?, stop?, usage?, delayMs? } 或 { text, … }，或一个 Error（这一轮抛出）。
  // complete 与 step 都按它逐轮返回；用完之后返回「什么都不做」的回复
  const script = Array.isArray(cfg.script) ? cfg.script.slice() : null;
  const scripted = async (signal, timeoutMs) => {
    const item = script.length ? script.shift() : { calls: [], text: '' };
    if (item instanceof Error) throw item;
    if (item.delayMs) await mockDelay(item.delayMs, signal, timeoutMs);
    return item;
  };
  const chatty = (text) => (cfg.chatty && n % 3 === 0 ? `好的，我想好了。\n\`\`\`json\n${text}\n\`\`\`\n希望有帮助。` : text);
  /** 第二前提：这次醒来的第一轮偶尔先 look 一次，然后 act（带 end: true） */
  const decide2 = (perception, first) => {
    if (first && rnd() < 0.2) return [{ name: 'look', args: { what: MOCK_LOOKS[Math.floor(rnd() * MOCK_LOOKS.length)] } }];
    const out = mockDecide(perception, rnd);
    return [{ name: 'act', args: { actions: out.actions, ...(out.thought ? { thought: out.thought } : {}), end: true } }];
  };
  return {
    name: 'mock',
    async complete({ perception, messages, signal, timeoutMs }) {
      n++;
      if (script) {
        const item = await scripted(signal, timeoutMs);
        const text = item.text !== undefined ? item.text : callsToJson(item.calls || []);
        return { text, stop: item.stop ?? 'end', ...(item.usage ? { usage: item.usage } : {}) };
      }
      if (perception && perception.premise >= 2) return { text: chatty(callsToJson(decide2(perception, (messages || []).length <= 1))), stop: 'end' };
      const out = perception ? mockDecide(perception, rnd) : { actions: [] };
      const payload = { ...(out.thought ? { thought: out.thought } : {}), actions: out.actions };
      let text = JSON.stringify(payload);
      // chatty：偶尔在 JSON 外面加话与代码围栏，用来检验运行器的解析容错
      if (cfg.chatty && n % 3 === 0) text = `好的，我想好了。\n\`\`\`json\n${text}\n\`\`\`\n希望有帮助。`;
      return { text, stop: 'end' };
    },
    /** 原生工具调用：按脚本，或用 mockDecide 生成一次 act（偶尔先 look）。raw 只给 mock 自己的记录用 */
    async step({ perception, transcript, tools, signal, timeoutMs }) {
      n++;
      // 没有感知（连接测试）：有 act 工具就调用它一次，让托管运行器的原生工具测试能用 mock 通过
      const idle = tools && tools.some((t) => t.name === 'act') ? [{ name: 'act', args: { actions: [] } }] : [];
      const item = script ? await scripted(signal, timeoutMs) : { calls: perception ? decide2(perception, (transcript || []).length <= 1) : idle, text: '' };
      const calls = (item.calls || []).map((c, i) => ({ id: c.id ?? `m${n}_${i + 1}`, name: c.name, args: c.args === undefined ? {} : c.args }));
      return { calls, text: item.text ?? '', stop: item.stop ?? (calls.length ? 'tool_calls' : 'stop'), raw: { mock: true, calls, text: item.text ?? '' }, ...(item.usage ? { usage: item.usage } : {}) };
    },
  };
}

// ── 入口 ──────────────────────────────────────────────────────

export const PROVIDER_NAMES = ['anthropic', 'openai', 'openai-responses', 'mock'];

/**
 * config：{ provider, model?, apiKeyEnv?, baseURL?, effort?, reasoningEffort?, fallbacks?, temperature?, jsonMode?, maxTokens?, extraBody?, timeoutMs?, seed?, chatty? }
 * deps（测试用）：{ loadAnthropic, fetch, env }
 */
export async function createProvider(config, deps = {}) {
  switch (config.provider) {
    case 'anthropic': return createAnthropicProvider(config, deps);
    case 'openai': return createOpenAIProvider(config, deps);
    case 'openai-responses': return createOpenAIProvider(config, deps);
    case 'mock': return createMockProvider(config);
    default: throw new ProviderError(`未知的提供者：${config.provider}（可选：${PROVIDER_NAMES.join('、')}）`, { fatal: true });
  }
}
