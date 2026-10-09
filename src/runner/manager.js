import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createProvider, PROVIDER_NAMES, validateReasoningEffort } from '../../runner/providers.js';
import { runAgent, makeLogger } from '../../runner/agent.js';
import { parseModelJson } from '../../runner/parse.js';
import { checkEndpoint, modelFetch } from './endpoint.js';
import { UsageStore } from './usage.js';
import { earthDay } from '../shells/budget.js';
import { agentic, tokenized } from '../e2/facade.js';
import { waitCore } from '../http/agent.js';
import { toolDefs } from '../../runner/loop.js';

const hash = (s) => createHash('sha256').update(s).digest('hex');
export class RunnerError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const integer = (v, fallback, min, max) => {
  if (v === undefined) return fallback;
  if (!Number.isInteger(v) || v < min || v > max) throw new RunnerError(`运行参数必须是 ${min}–${max} 范围内的整数。`);
  return v;
};
export function runnerConfig(raw, previous = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RunnerError('请填写模型配置。');
  const provider = raw.provider;
  if (!PROVIDER_NAMES.includes(provider)) throw new RunnerError('请选择支持的模型接口类型。');
  const text = (k, max = 500) => {
    if (raw[k] !== undefined && (typeof raw[k] !== 'string' || raw[k].length > max)) throw new RunnerError('模型配置字段格式或长度不正确。');
    return (raw[k] || '').trim();
  };
  const model = provider === 'mock' ? 'mock' : text('model', 100);
  if (!model || /[\r\n]/.test(model)) throw new RunnerError('请填写有效的单行模型名称。');
  const baseURL = provider === 'mock' ? '' : text('baseURL') || (provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1');
  const key = text('apiKey', 4096);
  const sameEndpoint = previous.provider === provider && previous.baseURL === baseURL;
  const apiKey = raw.clearApiKey === true ? '' : key || (sameEndpoint ? previous.apiKey : '') || '';
  if (provider === 'anthropic' && !apiKey) throw new RunnerError('请填写 API Key。');
  const thinking = raw.thinking || 'default';
  if (!['default', 'enabled', 'disabled'].includes(thinking)) throw new RunnerError('思考模式无效。');
  const effort = raw.effort || 'medium';
  if (!['low', 'medium', 'high'].includes(effort)) throw new RunnerError('思考强度无效。');
  try { validateReasoningEffort(raw); } catch { throw new RunnerError('思考强度无效。'); }
  // toolMode（第二前提的调用方式）：'json'（缺省）或 'native'；没有给就不写进配置，其他世界的配置视图与以前相同
  if (raw.toolMode !== undefined && !['json', 'native'].includes(raw.toolMode)) throw new RunnerError('调用方式无效。');
  if (raw.actionTools !== undefined && !['legacy', 'typed'].includes(raw.actionTools)) throw new RunnerError('动作工具协议无效。');
  const config = { provider, model, baseURL, apiKey, thinking, effort,
    ...(['openai', 'openai-responses'].includes(provider) ? { reasoningEffort: raw.reasoningEffort ?? 'default' } : {}),
    ...(raw.toolMode !== undefined ? { toolMode: raw.toolMode } : {}),
    ...(raw.actionTools !== undefined ? { actionTools: raw.actionTools } : {}),
    actEveryTicks: integer(raw.actEveryTicks, 1, 1, 100), historyRounds: integer(raw.historyRounds, 6, 0, 20),
    timeoutMs: integer(raw.timeoutMs, 120000, 1000, 120000),
    ...(raw.maxTokens !== undefined ? { maxTokens: integer(raw.maxTokens, 4096, 64, 32000) } : {}),
  };
  return config;
}

export class RunnerManager {
  constructor(rt, cfg) {
    this.rt = rt; this.cfg = cfg; this.records = {}; this.jobs = new Map(); this.states = new Map(); this.serverURL = null; this.closing = false;
    this.file = join(rt.dir, 'runners.enc'); this.keyFile = join(rt.dir, 'runners.key');
    // Token usage is telemetry, not a credential: it lives beside the encrypted records, in plain numbers.
    this.usage = new UsageStore({ file: join(rt.dir, 'runner-usage.json'), timezone: cfg.shellTz });
    if (existsSync(this.file)) {
      if (!existsSync(this.keyFile)) throw new Error('托管凭据加密密钥缺失，无法恢复 runners.enc。');
      this.key = readFileSync(this.keyFile);
      const encrypted = JSON.parse(readFileSync(this.file, 'utf8'));
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(encrypted.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));
      this.records = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'hex')), decipher.final()]).toString());
      chmodSync(this.file, 0o600); chmodSync(this.keyFile, 0o600);
    }
  }
  persist() {
    if (!this.key) {
      this.key = existsSync(this.keyFile) ? readFileSync(this.keyFile) : randomBytes(32);
      if (!existsSync(this.keyFile)) writeFileSync(this.keyFile, this.key, { mode: 0o600, flag: 'wx' });
      chmodSync(this.keyFile, 0o600);
    }
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(this.records)), cipher.final()]);
    writeFileSync(this.file + '.tmp', JSON.stringify({ iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') }), { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file); chmodSync(this.file, 0o600);
  }
  valid(id) {
    const r = this.records[id], a = this.rt.w.agents[id];
    return !!(r && a && a.tokenHash === hash(r.token) && a.owner?.keyHash === r.ownerHash);
  }
  syncOwnerKey(id) {
    const r = this.records[id], a = this.rt.w.agents[id];
    // A creator-key reset preserves the agent token. A transfer replaces it,
    // so an old owner's runner must never be rebound after a transfer.
    if (!r || !a?.owner || a.tokenHash !== hash(r.token) || r.ownerHash === a.owner.keyHash) return;
    const previous = r.ownerHash;
    r.ownerHash = a.owner.keyHash;
    try { this.persist(); } catch (e) { r.ownerHash = previous; throw e; }
  }
  view(id) {
    const r = this.valid(id) && this.records[id];
    if (!r) return { status: 'unconfigured', config: null, logs: [] };
    const { apiKey, ...config } = r.config;
    return { status: r.enabled ? 'starting' : 'paused', ...this.states.get(id), ...(r.enabled && this.rt.w.paused ? { status: 'experiment_paused' } : {}), config: { ...config, hasApiKey: !!apiKey } };
  }
  /** Token usage of a hosted resident. `tracked: false` when the server does not drive it: a self-hosted runner is invisible to us. */
  usageView(id) {
    return this.valid(id) ? { tracked: true, ...this.usage.view(id) } : { tracked: false };
  }
  /**
   * The operator's overview: every resident this server drives with a player's own model key, busiest today first, with the city-wide
   * totals and the last days summed. Shells (paid for by the platform) are not here; `unhosted` counts living residents the server
   * does not drive (self-hosted or never connected), which no usage can be seen for.
   */
  usageOverview() {
    const base = this.usage.view(''); // an empty view: today's date, the day window, zeroed buckets
    const add = (sum, b) => { for (const k of ['calls', 'failed', 'unreported', 'input', 'output', 'tokens']) sum[k] += b[k]; return sum; };
    const zero = () => ({ calls: 0, failed: 0, unreported: 0, input: 0, output: 0, tokens: 0 });
    const total = zero(), today = zero(), days = base.days.map((d) => ({ ...d }));
    const agents = [];
    for (const id of Object.keys(this.records)) {
      if (!this.valid(id)) continue;
      const a = this.rt.w.agents[id], u = this.usage.view(id);
      add(total, u.total); add(today, u.today);
      u.days.forEach((d, i) => add(days[i], d));
      agents.push({
        agentId: id, name: a.name, status: a.status, model: this.records[id].config.model, creatorName: a.owner ? a.owner.creatorName ?? null : null,
        runnerStatus: this.view(id).status,
        usage: { since: u.since, lastCallAt: u.recent.length ? u.recent[u.recent.length - 1].at : null, total: u.total, today: u.today },
      });
    }
    agents.sort((x, y) => y.usage.today.tokens - x.usage.today.tokens || y.usage.total.tokens - x.usage.total.tokens || (x.agentId < y.agentId ? -1 : 1));
    const hosted = new Set(agents.map((x) => x.agentId));
    const unhosted = Object.values(this.rt.w.agents).filter((a) => a.owner && a.tokenHash && ['awake', 'dormant'].includes(a.status) && !hosted.has(a.id)).length;
    return { timezone: base.timezone, day: base.day, hosted: agents.length, unhosted, total, today, days, agents };
  }
  provider(config, timeoutMs = config.timeoutMs) {
    const { apiKey, thinking, ...safe } = config;
    return createProvider({ ...safe, timeoutMs, apiKeyEnv: apiKey ? 'MANAGED_KEY' : undefined,
      ...(config.provider === 'openai' && thinking !== 'default' ? { extraBody: { thinking: { type: thinking } } } : {}),
      ...(config.provider === 'anthropic' && config.baseURL !== 'https://api.anthropic.com' ? { fallbacks: false } : {}),
    }, { env: { MANAGED_KEY: apiKey }, fetch: modelFetch(this.cfg.allowLocalModels === true, { timeoutMs }) });
  }
  /**
   * 托管居民的等待函数（runAgent 的 deps.waitWake，SPEC-P2 §6.4、§10.3）：托管运行器走 HTTP 感知与行动，但就在服务器进程里，
   * 所以等待不绕 HTTP，直接用 rt.onWake——语义同 GET /api/me/wait：先查收件箱，再等通知，到时返回空。
   */
  waitWake(id) {
    return async ({ after, timeoutMs = 25000, signal } = {}) => {
      const a = this.rt.w.agents[id];
      if (!a || !agentic(this.rt.w)) return { ok: false, status: 404, json: null };
      return { ok: true, status: 200, json: await waitCore(this.rt, id, { after: after ?? 0, timeoutMs, signal, lang: a.lang === 'en' ? 'en' : 'zh' }) };
    };
  }
  async prepare(raw, previous) {
    const config = runnerConfig(raw, previous);
    try {
      if (config.provider !== 'mock') await checkEndpoint(config.baseURL, this.cfg.allowLocalModels === true);
      const provider = await this.provider(config, 20000);
      const response = await provider.complete({ system: 'Connection test. Output exactly one JSON object: {"actions":[]}.', messages: [{ role: 'user', content: 'Output {"actions":[]}.' }], signal: AbortSignal.timeout(20000) });
      const parsed = parseModelJson(response.text);
      if (response.stop === 'refusal' || !parsed.ok || !Array.isArray(parsed.value.actions)) throw new RunnerError('模型连接成功，但未返回可用的行动 JSON；请检查模型或增加输出上限。');
      // 第二前提且选了原生工具调用：另做一次带工具的测试——一个名为 act 的工具，要求模型调用它一次（SPEC-P2 §10.3）
      if (agentic(this.rt.w) && config.toolMode === 'native') {
        const typed = config.actionTools === 'typed';
        const name = typed ? 'done' : 'act';
        const definitions = toolDefs('en', { actionTools: config.actionTools, premise: this.rt.w.premise });
        const act = definitions.find((t) => t.name === name);
        const instruction = typed ? 'Call the done tool exactly once with an empty object.' : 'Call the act tool exactly once, with an empty actions list.';
        const step = typeof provider.step === 'function'
          ? await provider.step({ system: `Connection test. ${instruction}`, transcript: [{ role: 'user', text: instruction }], tools: typed ? definitions : [act], signal: AbortSignal.timeout(20000), timeoutMs: 20000 })
          : null;
        if (!step || !step.calls.some((c) => c.name === name)) throw new RunnerError('模型连接成功，但没有按要求调用工具；可以改用文本 JSON 方式。');
      }
      return config;
    } catch (e) {
      if (e instanceof RunnerError) throw e;
      // Never return an upstream body, URL, request headers or credentials.
      if (e.message?.includes('缺少 @anthropic-ai/sdk')) throw new RunnerError('服务器缺少 Anthropic SDK，请选择 OpenAI 兼容接口或由管理员安装可选依赖。');
      if (e.message?.startsWith('模型接口') || e.message?.startsWith('外部模型')) throw new RunnerError(e.message);
      throw new RunnerError(`模型连接失败${Number.isInteger(e.status) ? `（HTTP ${e.status}）` : ''}，请检查接口地址、API Key、模型名称及额度。`);
    }
  }
  async attach(id, token, config, enabled = true) {
    const agent = this.rt.w.agents[id];
    if (!agent || !['awake', 'dormant'].includes(agent.status)) throw new RunnerError('已长眠或归隐的居民不能配置运行器。');
    const ownerHash = agent.owner.keyHash;
    const previous = this.records[id];
    await this.stop(id);
    if (agent.owner.keyHash !== ownerHash || agent.tokenHash !== hash(token)) throw new RunnerError('令牌已更换，请重新进入幕后。');
    this.records[id] = { token, ownerHash, config, enabled };
    try { this.persist(); }
    catch (e) {
      if (previous) this.records[id] = previous; else delete this.records[id];
      throw e;
    }
    // Editing the model settings keeps the running total; a record bound to another agent token (a transfer) never inherits it.
    if (!previous || previous.token !== token) this.usage.drop(id);
    if (agent.body.model !== config.model) this.rt.exec('model', { agentId: id, ownerKeyHash: ownerHash, model: config.model });
    this.states.set(id, { status: 'paused', logs: [] });
    if (enabled) this.start(id);
    return this.view(id);
  }
  activate(serverURL) {
    this.serverURL = serverURL;
    for (const id of Object.keys(this.records)) {
      this.syncOwnerKey(id);
      if (!this.valid(id)) { delete this.records[id]; this.persist(); continue; }
      const agent = this.rt.w.agents[id];
      if (['dead', 'retired'].includes(agent.status)) {
        this.records[id].enabled = false; this.states.set(id, { status: 'stopped', logs: [] }); this.persist(); continue;
      }
      if (agent.body.model !== this.records[id].config.model) this.rt.exec('model', { agentId: id, ownerKeyHash: this.records[id].ownerHash, model: this.records[id].config.model });
      if (this.records[id].enabled) this.start(id);
    }
    for (const id of this.usage.ids()) if (!this.records[id]) this.usage.drop(id); // usage of a runner that no longer exists
  }
  start(id) {
    if (this.closing) throw new RunnerError('服务器正在关闭。', 503);
    if (!this.valid(id)) throw new RunnerError('请先保存模型配置并提供该居民的 agent 令牌。');
    if (['dead', 'retired'].includes(this.rt.w.agents[id].status)) throw new RunnerError('已长眠或归隐的居民不能启动。');
    if (this.jobs.has(id)) return this.view(id);
    const r = this.records[id]; r.enabled = true; this.persist();
    if (!this.serverURL || this.rt.w.paused) return this.view(id);
    const controller = new AbortController();
    const state = { ...this.states.get(id), status: 'starting', lastError: null, logs: [] };
    this.states.set(id, state);
    const log = makeLogger(id, { secrets: [r.token, r.config.apiKey], quiet: true, out: () => {}, err: () => {} });
    const promise = Promise.resolve().then(async () => {
      const provider = await this.provider(r.config);
      return runAgent({ ...r.config, token: r.token, server: this.serverURL, lang: this.rt.w.agents[id].lang, name: this.rt.w.agents[id].name }, {
        signal: controller.signal, provider, log,
        ...(tokenized(this.rt.w) ? { refundWake: async wakeId => this.rt.exec('meter', { op: 'refund', agentId: id, wakeId, day: earthDay(Date.now(), this.cfg.shellTz || 'Asia/Shanghai').key }).result } : {}),
        onUsage: (_agentId, usage, meta) => {
          // A request we cancelled ourselves (pause, saving new settings, shutdown, the tick boundary) is not a provider failure.
          if (!meta.ok && (controller.signal.aborted || meta.cancelled)) return;
          this.usage.record(id, usage, meta, r.config.model);
        },
        waitWake: this.waitWake(id),
        onWaking: (_agentId, rec) => this.traces?.append(id, rec, r.config.model), // 观察用的轨迹（第二前提，SPEC-P2 §14.1）；没有 traces 时什么也不做
        onState: (event) => {
          if (controller.signal.aborted) return;
          Object.assign(state, event);
          if (event.lastActionAt) state.logs = [...state.logs, { at: event.lastActionAt, actions: event.actions }].slice(-10);
        },
      });
    }).then((result) => {
      if (!controller.signal.aborted) {
        state.status = ['auth', 'provider'].includes(result.stopped) ? 'error' : 'stopped';
        if (state.status === 'error') state.lastError ||= '运行已停止，请检查模型连接或令牌。';
        r.enabled = false; this.persist();
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        state.status = 'error'; state.lastError = '运行失败，请检查模型配置。'; r.enabled = false;
        try { this.persist(); } catch { state.lastError = '运行状态无法保存，请检查服务器数据目录。'; }
      }
    }).finally(() => this.jobs.delete(id));
    this.jobs.set(id, { controller, promise });
    return this.view(id);
  }
  async stop(id) {
    const job = this.jobs.get(id);
    if (job) { job.controller.abort(); await job.promise; }
  }
  async pause(id) {
    await this.stop(id);
    if (this.valid(id)) { this.records[id].enabled = false; this.persist(); }
    this.states.set(id, { ...this.states.get(id), status: 'paused' });
    return this.view(id);
  }
  async suspendExperiment() {
    const all = [...this.jobs.values()];
    for (const job of all) job.controller.abort();
    await Promise.all(all.map((job) => job.promise));
  }
  resumeExperiment() {
    if (this.closing || this.rt.w.paused) return;
    for (const id of Object.keys(this.records)) {
      if (this.records[id].enabled && this.valid(id) && ['awake', 'dormant'].includes(this.rt.w.agents[id].status)) this.start(id);
    }
  }
  async remove(id) { await this.stop(id); delete this.records[id]; this.usage.drop(id); this.states.delete(id); if (this.key) this.persist(); }
  async close() { this.closing = true; await Promise.all([...this.jobs.keys()].map((id) => this.stop(id))); }
}
