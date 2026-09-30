// 模型提供者（SPEC §15.2）：createProvider(config) → { name, complete({ system, messages, perception? }) → { text, stop } }。
//
// - anthropic：官方 SDK @anthropic-ai/sdk，动态 import；未安装时给出安装提示。
// - openai：任何 OpenAI 兼容接口，用 fetch，不引依赖。
// - mock：不联网，按感知随机生成合法动作，用于测试与演示。
//
// 安全：API 密钥只从环境变量读取，绝不进入提示，也不出现在错误信息与日志里。
// 错误分级（ProviderError）：fatal——停止该 agent 并清楚地报错（认证失败、模型不存在）；
// retryable——本刻放弃，等到下一刻再来（限速、5xx、超时、网络）；其余——本刻放弃并记录。

export class ProviderError extends Error {
  constructor(message, { fatal = false, retryable = !fatal, status } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.fatal = fatal;
    this.retryable = retryable;
    this.status = status;
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

  return {
    name: 'anthropic',
    async complete({ system, messages, signal }) {
      // 默认模型 claude-opus-5-5。不要发送 thinking、temperature、top_p、top_k（该模型会返回 400），不要预填 assistant 消息。
      const req = {
        model: cfg.model ?? 'claude-opus-5-5',
        max_tokens: cfg.maxTokens ?? 16000,
        // 一刻恰好 5 分钟，等于默认缓存有效期：系统提示用 1 小时缓存
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
        messages,
        output_config: { effort: cfg.effort ?? 'medium' },
        // fallbacks: "default" 只在第一方 Claude API 上可用；baseURL 指向代理或其他平台时配置 "fallbacks": false
        ...(cfg.fallbacks !== false ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      };
      let resp;
      try {
        resp = await client.beta.messages.create(req, signal ? { signal } : undefined);
      } catch (e) {
        if (isA(e, 'AuthenticationError') || isA(e, 'PermissionDeniedError')) throw new ProviderError(`认证失败：${safeMessage(e)}`, { fatal: true, status: e.status });
        if (isA(e, 'NotFoundError')) throw new ProviderError(`模型或接口不存在：${safeMessage(e)}`, { fatal: true, status: e.status });
        if (isA(e, 'RateLimitError') || isA(e, 'InternalServerError') || isA(e, 'APIConnectionError') || isA(e, 'APIConnectionTimeoutError')) {
          throw new ProviderError(`暂时不可用：${safeMessage(e)}`, { retryable: true, status: e.status });
        }
        if (typeof e.status === 'number') throw classifyStatus(e.status, safeMessage(e));
        throw new ProviderError(safeMessage(e), { retryable: true });
      }
      if (resp.stop_reason === 'refusal') return { text: '', stop: 'refusal', details: resp.stop_details };
      const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      const out = { text, stop: resp.stop_reason };
      if (resp.usage && Number.isFinite(resp.usage.input_tokens)) out.usage = { input: resp.usage.input_tokens, output: resp.usage.output_tokens };
      return out;
    },
  };
}

// ── openai 兼容 ───────────────────────────────────────────────

function createOpenAIProvider(cfg, deps) {
  if (!cfg.model) throw new ProviderError('openai 提供者需要配置 model。', { fatal: true });
  const fetchImpl = deps.fetch || globalThis.fetch;
  const key = cfg.apiKeyEnv ? (deps.env || process.env)[cfg.apiKeyEnv] : undefined;
  if (cfg.apiKeyEnv && !key) throw new ProviderError(`环境变量 ${cfg.apiKeyEnv} 没有设置。`, { fatal: true });
  const url = `${String(cfg.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`;
  // extraBody：各家私有的请求参数（例如智谱 GLM 的 {"thinking": {"type": "disabled"}}）。不能覆盖 model 与 messages
  if (cfg.extraBody !== undefined && (cfg.extraBody === null || typeof cfg.extraBody !== 'object' || Array.isArray(cfg.extraBody))) {
    throw new ProviderError('extraBody 必须是一个 JSON 对象。', { fatal: true });
  }
  return {
    name: 'openai',
    async complete({ system, messages, signal }) {
      const body = { ...(cfg.extraBody || {}), model: cfg.model, messages: [{ role: 'system', content: system }, ...messages] };
      if (cfg.temperature !== undefined) body.temperature = cfg.temperature;
      if (cfg.maxTokens !== undefined) body.max_tokens = cfg.maxTokens;
      if (cfg.jsonMode) body.response_format = { type: 'json_object' };
      const headers = { 'Content-Type': 'application/json' };
      if (key) headers.Authorization = `Bearer ${key}`;
      let res;
      try {
        res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(cfg.timeoutMs ?? 120000)]) : AbortSignal.timeout(cfg.timeoutMs ?? 120000) });
      } catch (e) {
        throw new ProviderError(`网络错误：${e && e.name === 'TimeoutError' ? 'timeout' : safeMessage(e)}`, { retryable: true });
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
      const choice = json && json.choices && json.choices[0];
      const out = { text: (choice && choice.message && choice.message.content) || '', stop: (choice && choice.finish_reason) || 'stop' };
      const u = json && json.usage;
      if (u && Number.isFinite(u.prompt_tokens)) out.usage = { input: u.prompt_tokens, output: u.completion_tokens };
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

  const roll = rnd();
  if (actions.length < 2 && roll < 0.4) actions.push({ type: 'say', text: pick(MOCK_LINES[lang]) });
  else if (actions.length < 2 && roll < 0.7) {
    const to = pick(((p.city && p.city.places) || []).map((x) => x.id).filter((id) => id !== here.place));
    if (to) actions.push({ type: 'move', to });
  } else if (actions.length < 2 && roll < 0.8) actions.push({ type: 'diary', text: lang === 'zh' ? '（mock 日记）今天也平平安安。' : '(mock diary) A quiet day again.' });
  else if (actions.length < 2 && roll < 0.9 && here.place === 'wilds') actions.push({ type: 'explore' });
  if (!thought && rnd() < 0.3) thought = lang === 'zh' ? '（mock）看看城里在发生什么。' : '(mock) Let me see what is going on in the city.';
  return { thought, actions };
}

function createMockProvider(cfg) {
  const rnd = mulberry32(Number.isInteger(cfg.seed) ? cfg.seed : 1);
  let n = 0;
  return {
    name: 'mock',
    async complete({ perception }) {
      n++;
      const out = perception ? mockDecide(perception, rnd) : { actions: [] };
      const payload = { ...(out.thought ? { thought: out.thought } : {}), actions: out.actions };
      let text = JSON.stringify(payload);
      // chatty：偶尔在 JSON 外面加话与代码围栏，用来检验运行器的解析容错
      if (cfg.chatty && n % 3 === 0) text = `好的，我想好了。\n\`\`\`json\n${text}\n\`\`\`\n希望有帮助。`;
      return { text, stop: 'end' };
    },
  };
}

// ── 入口 ──────────────────────────────────────────────────────

export const PROVIDER_NAMES = ['anthropic', 'openai', 'mock'];

/**
 * config：{ provider, model?, apiKeyEnv?, baseURL?, effort?, fallbacks?, temperature?, jsonMode?, maxTokens?, extraBody?, timeoutMs?, seed?, chatty? }
 * deps（测试用）：{ loadAnthropic, fetch, env }
 */
export async function createProvider(config, deps = {}) {
  switch (config.provider) {
    case 'anthropic': return createAnthropicProvider(config, deps);
    case 'openai': return createOpenAIProvider(config, deps);
    case 'mock': return createMockProvider(config);
    default: throw new ProviderError(`未知的提供者：${config.provider}（可选：${PROVIDER_NAMES.join('、')}）`, { fatal: true });
  }
}
