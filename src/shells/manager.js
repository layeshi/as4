// SPEC-E2 §13：躯壳的运行时。不受引擎确定性约束，但不得改变世界状态，除非通过 rt.exec 提交命令。
//
// 躯壳居民（body.kind === 'shell'，含先民）没有令牌，由本管理器用参考运行器的 runAgent 驱动，客户端是进程内的（client.js）：
//   · 每具躯壳一个异步循环，模型取自它被分配的那条线路（w.shells.models 里轮流分配的模型名 ↔ SHELLS_FILE 的 lines[].model）；
//   · 每次调用模型之前问预算（budget.js：硬上限、匀速），同时进行的调用不超过 concurrency；
//   · 日志只记 token 数、耗时、状态，不记提示与回复的内容，不记密钥；
//   · 线路认证失败（401 / 403 / 404）：这条线路标记为 error，它驱动的躯壳停止调用，管理接口告警，resume 之后重试。
//
// 管理员的操作：pause / resume（暂停时中止在途的模型请求并停掉所有循环，不影响城内的时间与代谢）。

import { join } from 'node:path';
import { createProvider, ProviderError } from '../../runner/providers.js';
import { runAgent } from '../../runner/agent.js';
import { checkEndpoint, modelFetch } from '../runner/endpoint.js';
import { loadShellsConfig } from './config.js';
import { Budget, estimateTokens, guessTokens } from './budget.js';
import { createShellClient } from './client.js';

const isShell = (a) => a.body && a.body.kind === 'shell';
const normLang = (lang) => (lang === 'en' ? 'en' : 'zh');

export class ShellManager {
  /**
   * @param rt   Runtime（第二纪的世界）
   * @param cfg  服务器配置（shellsFile、shellTokensPerDay、shellTz、tickMs、allowLocalModels）
   * @param o    { config, logger, env, now, wait, fetch, providerFactory, usageFile }——多为测试用：
   *             config 直接给解析好的配置；wait(ms, signal, p) 替换运行器的等待；now 是假时钟；fetch 替换模型请求的 fetch
   */
  constructor(rt, cfg, { config, logger = console, env = process.env, now = Date.now, wait, fetch, providerFactory = createProvider, usageFile } = {}) {
    this.rt = rt;
    this.cfg = cfg;
    this.config = config || loadShellsConfig(cfg.shellsFile, cfg);
    this.logger = logger;
    this.env = env;
    this.now = now;
    this.wait = wait;
    this.fetch = fetch;
    this.providerFactory = providerFactory;
    this.warnings = [];
    this.budget = new Budget({
      tokensPerDay: this.config.tokensPerDay, reserve: this.config.reserve, timezone: this.config.timezone, now,
      file: usageFile === undefined ? join(rt.dir, 'shells-usage.json') : usageFile,
      onWarn: (w) => this.onBudgetWarn(w),
    });
    this.lines = new Map(this.config.lines.map((l) => [l.model, { cfg: l, status: 'ok', lastError: null, provider: null }]));
    this.drivers = new Map(); // agentId → { controller, promise, state }
    this.states = new Map(); // agentId → { status, skip? }
    this.cursors = new Map(); // agentId → 已送达的最大收件 seq（内存；Q9）
    this.tickets = new Map(); // agentId → 在途调用的预算票据
    this.slots = { active: 0, waiters: [] };
    this.maxActive = 0; // 同时进行的调用数的最大值（测试用）
    this.noLine = new Set();
    this.paused = this.budget.paused;
    this.closing = false;
    this.unsubscribe = null;
  }

  // ── 生命周期 ─────────────────────────────────────────────

  /** 启动：对照 w.shells.models 与配置里的模型名，开始随刻同步 */
  activate() {
    const have = this.rt.w.shells.models;
    const want = this.config.lines.map((l) => l.model);
    if (JSON.stringify(have) !== JSON.stringify(want)) {
      this.warn(`世界里的躯壳模型 ${JSON.stringify(have)} 与 SHELLS_FILE 的线路 ${JSON.stringify(want)} 不一致：不自动修改（管理员用 POST /api/admin/shell-models 修改）。`);
    }
    this.unsubscribe = this.rt.events.subscribe((name) => {
      if (name === 'tick') this.sync();
    });
    this.sync();
  }

  async close() {
    this.closing = true;
    if (this.unsubscribe) this.unsubscribe();
    for (const w of this.slots.waiters.splice(0)) w(false);
    await this.stopAll();
    this.budget.save();
  }

  warn(message) {
    this.warnings.push({ at: new Date(this.now()).toISOString(), message });
    if (this.warnings.length > 20) this.warnings.shift();
    this.logger.warn?.(`[躯壳] ${message}`);
  }

  onBudgetWarn({ kind, day, used, tokensPerDay }) {
    this.warn(kind === 'capped'
      ? `${day}：今日用量 ${used} 已达到 tokensPerDay（${tokensPerDay}），所有躯壳停到下一个地球日。`
      : `${day}：今日用量 ${used} 已达到 tokensPerDay（${tokensPerDay}）的 80%。`);
  }

  // ── 同步：为在世的躯壳开循环，为长眠 / 归隐的停循环 ─────────

  /** 每刻调用：新醒来的躯壳（含先民入城）开始被驱动 */
  sync() {
    if (this.closing) return;
    for (const a of Object.values(this.rt.w.agents)) {
      if (!isShell(a)) continue;
      if (a.status === 'dead' || a.status === 'retired') {
        this.stopDriver(a.id);
        continue;
      }
      if (this.paused || this.drivers.has(a.id)) continue;
      const line = this.lines.get(a.body.model);
      if (!line) {
        if (!this.noLine.has(a.id)) {
          this.noLine.add(a.id);
          this.warn(`${a.id} 被分配的模型「${a.body.model}」在 SHELLS_FILE 里没有线路：不驱动它。`);
        }
        continue;
      }
      if (line.status === 'error') continue;
      this.start(a, line);
    }
  }

  async providerFor(line) {
    if (line.provider) return line.provider;
    const l = line.cfg;
    const allowLocal = this.cfg.allowLocalModels === true;
    if (l.provider !== 'mock') {
      const base = l.baseURL || (l.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1');
      await checkEndpoint(base, allowLocal);
    }
    const { apiKeyEnv, ...rest } = l;
    line.provider = await this.providerFactory({ ...rest, ...(apiKeyEnv ? { apiKeyEnv } : {}) }, { env: this.env, fetch: this.fetch || modelFetch(allowLocal) });
    return line.provider;
  }

  /** 日志只记 token 数、耗时、状态：丢掉独白，截掉回复的开头 */
  shellLog(id) {
    const clean = (m) => String(m).split('开头：')[0].slice(0, 160);
    return {
      info: (m) => { if (!/^\s*独白/.test(m)) this.logger.log?.(`[躯壳 ${id}] ${clean(m)}`); },
      warn: (m) => this.logger.warn?.(`[躯壳 ${id}] ⚠ ${clean(m)}`),
      error: (m) => this.logger.error?.(`[躯壳 ${id}] ✖ ${clean(m)}`),
    };
  }

  start(a, line) {
    const controller = new AbortController();
    const state = { status: 'starting' };
    this.states.set(a.id, state);
    const cfg = { name: a.name, lang: normLang(a.lang), historyRounds: this.config.historyRounds, actEveryTicks: 1, token: 'in-process', server: 'in-process' };
    const deps = {
      client: createShellClient(this.rt, a.id, { cursors: this.cursors }),
      signal: controller.signal,
      log: this.shellLog(a.id),
      beforeModel: (id, meta) => this.beforeModel(a.id, line, state, meta),
      onUsage: (id, usage, meta) => this.onUsage(a.id, line, usage, meta),
      onState: (event) => { if (!controller.signal.aborted) Object.assign(state, event); },
      ...(this.wait ? { wait: this.wait } : {}),
    };
    const promise = (async () => {
      try {
        deps.provider = await this.providerFor(line);
      } catch (e) {
        this.markLineError(line, e);
        return { stopped: 'provider' };
      }
      return runAgent(cfg, deps);
    })().then((result) => {
      if (controller.signal.aborted) return;
      state.status = result.stopped === 'provider' ? 'line_error' : result.stopped === 'dead' || result.stopped === 'retired' ? result.stopped : 'stopped';
      if (result.stopped === 'provider') this.markLineError(line);
    }).catch((e) => {
      state.status = 'error';
      this.logger.error?.(`[躯壳 ${a.id}] 运行出错：${e && e.message}`);
    }).finally(() => {
      this.drivers.delete(a.id);
    });
    this.drivers.set(a.id, { controller, promise, state });
  }

  stopDriver(id) {
    const d = this.drivers.get(id);
    if (d) d.controller.abort();
  }

  async stopAll() {
    const all = [...this.drivers.values()];
    for (const d of all) d.controller.abort();
    await Promise.all(all.map((d) => d.promise));
  }

  // ── 调用之前与之后 ───────────────────────────────────────

  acquireSlot() {
    if (this.slots.active < this.config.concurrency) {
      this.slots.active++;
      this.maxActive = Math.max(this.maxActive, this.slots.active);
      return Promise.resolve(true);
    }
    return new Promise((resolve) => this.slots.waiters.push(resolve));
  }

  releaseSlot() {
    const next = this.slots.waiters.shift();
    if (next) next(true); // 名额直接交给下一位，active 不变
    else this.slots.active = Math.max(0, this.slots.active - 1);
  }

  awakeShells() {
    return Object.values(this.rt.w.agents).filter((a) => isShell(a) && a.status === 'awake').length;
  }

  /** runAgent 的 beforeModel：为假则本刻不调用模型 */
  async beforeModel(agentId, line, state, meta) {
    if (this.closing || this.paused || line.status === 'error') return false;
    const est = estimateTokens(meta.chars, line.cfg.maxTokens);
    const slot = await this.acquireSlot();
    if (!slot) return false;
    if (this.closing || this.paused || line.status === 'error') {
      this.releaseSlot();
      return false;
    }
    const verdict = this.budget.check(agentId, est, { awake: this.awakeShells(), tickMs: this.cfg.tickMs });
    if (!verdict.ok) {
      this.releaseSlot();
      state.skip = verdict.reason; // 'hard_cap' | 'pace'；下一次允许调用时清除
      return false;
    }
    delete state.skip;
    this.tickets.set(agentId, { ticket: this.budget.reserveTokens(agentId, est), chars: meta.chars });
    return true;
  }

  /** runAgent 的 onUsage：用实际用量替换预留；失败时释放预留，认证类失败标记线路 */
  onUsage(agentId, line, usage, meta) {
    const t = this.tickets.get(agentId);
    this.tickets.delete(agentId);
    this.releaseSlot();
    if (!t) return;
    if (meta.ok) {
      const tokens = usage && Number.isFinite(usage.input) && Number.isFinite(usage.output) ? usage.input + usage.output : guessTokens(t.chars, meta.replyChars || 0);
      this.budget.settle(t.ticket, tokens, { line: line.cfg.model });
    } else {
      this.budget.release(t.ticket);
      if (meta.error instanceof ProviderError && meta.error.fatal) this.markLineError(line, meta.error);
    }
  }

  markLineError(line, err) {
    if (line.status === 'error') return;
    line.status = 'error';
    const status = err && err.status ? `HTTP ${err.status}` : '认证失败或模型不可用';
    line.lastError = `${status}：线路「${line.cfg.model}」停止调用，检查密钥与模型后 POST /api/admin/shells { "op": "resume" } 重试。`;
    this.warn(line.lastError);
    // 这条线路驱动的躯壳停止（resume 之后由 sync 重新开始）
    for (const a of Object.values(this.rt.w.agents)) if (isShell(a) && a.body.model === line.cfg.model) this.stopDriver(a.id);
  }

  // ── 管理员的操作 ─────────────────────────────────────────

  async pause() {
    this.paused = true;
    this.budget.setPaused(true);
    await this.stopAll();
    for (const s of this.states.values()) s.status = 'paused';
  }

  resume() {
    this.paused = false;
    this.budget.setPaused(false);
    for (const line of this.lines.values()) {
      line.status = 'ok';
      line.lastError = null;
      line.provider = null; // 密钥可能换了：下次重新建
    }
    this.noLine.clear();
    this.sync();
  }

  /** GET /api/admin/shells */
  view() {
    const b = this.budget.view();
    const shells = Object.values(this.rt.w.agents).filter(isShell).map((a) => {
      const u = this.budget.agentUsage(a.id);
      const state = this.states.get(a.id) || {};
      const line = this.lines.get(a.body.model);
      let status = state.skip ? (state.skip === 'hard_cap' ? 'capped' : 'paced') : state.status || 'waiting';
      if (a.status === 'dead' || a.status === 'retired') status = a.status;
      else if (this.paused) status = 'paused';
      else if (!line) status = 'no_line';
      else if (line.status === 'error') status = 'line_error';
      else if (a.status === 'dormant') status = 'dormant';
      else if (!this.drivers.has(a.id)) status = 'stopped';
      return { agentId: a.id, name: a.name, model: a.body.model, usedToday: u.tokens, calls: u.calls, lastCallAt: u.lastCallAt, status };
    });
    return {
      enabled: true, paused: this.paused, ...b,
      lines: [...this.lines.values()].map((l) => ({ model: l.cfg.model, status: l.status, ...(l.lastError ? { lastError: l.lastError } : {}) })),
      shells,
      warnings: this.warnings.slice(),
    };
  }
}
