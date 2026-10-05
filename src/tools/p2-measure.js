// SPEC-P2 §16.2：独立本机世界的两轮测量。此文件不部署，不把模型文本写入遥测。
import { readFileSync, writeFileSync, appendFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runtime } from '../runtime.js';
import { loadConfig, applyConfig } from '../config.js';
import { createApp } from '../http/server.js';
import { createProvider } from '../../runner/providers.js';
import { parseToolJson, DEFAULT_AGENT_LOOP } from '../../runner/loop.js';
import { LOOK_WHATS } from '../../runner/render-p2.js';
import { cleanRecord } from '../runner/traces.js';
import { replayDir } from './replay.js';

const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const finite = (x) => Number.isFinite(x) && x >= 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quiet = { log() {}, info() {}, warn() {}, error() {} };
const save = (file, value) => {
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
};
const append = (file, value) => appendFileSync(file, JSON.stringify(value) + '\n', { mode: 0o600 });

/** 两轮共用的总额；未知用量按完整预留扣除，重启时在途预留也不能退回。 */
export class TotalBudget {
  constructor({ cap, file }) {
    if (!Number.isSafeInteger(cap) || cap <= 0) throw new Error('Invalid token cap');
    this.cap = cap; this.file = file; this.pending = new Map(); this.charged = 0; this.reported = 0; this.estimated = 0; this.exhausted = false;
    if (existsSync(file)) {
      const old = JSON.parse(readFileSync(file, 'utf8'));
      if (old.cap !== cap) throw new Error('Token cap differs from saved cap');
      this.charged = old.charged + old.reserved;
      this.reported = old.reported; this.estimated = old.estimated + old.reserved;
    }
    this.save();
  }
  get reserved() { return [...this.pending.values()].reduce((n, x) => n + x, 0); }
  reserve(id, estimate) {
    if (this.pending.has(id)) throw new Error('Agent already has a token reservation');
    if (!Number.isSafeInteger(estimate) || estimate < 0) throw new Error('Invalid token reservation');
    if (this.charged + this.reserved + estimate > this.cap) { this.exhausted = true; return false; }
    this.pending.set(id, estimate); this.save(); return true;
  }
  cancel(id) { this.pending.delete(id); this.save(); }
  settle(id, usage) {
    const reserved = this.pending.get(id);
    if (reserved === undefined) return;
    this.pending.delete(id);
    const reported = finite(usage?.input) && finite(usage?.output);
    const cost = reported ? Math.ceil(usage.input + usage.output) : reserved;
    this.charged += cost;
    if (reported) this.reported += cost; else this.estimated += cost;
    if (this.charged >= this.cap) this.exhausted = true;
    this.save();
  }
  view() { return { cap: this.cap, charged: this.charged, reported: this.reported, estimated: this.estimated, reserved: this.reserved }; }
  save() { save(this.file, this.view()); }
}

/** 工具有效 = 识别的工具与合法参数形状；动作是否成功由引擎结果另算。 */
export function classifyReply(mode, reply) {
  const refusal = reply?.stop === 'refusal';
  const incomplete = ['length', 'incomplete', 'max_tokens'].includes(reply?.stop);
  const parsed = mode === 'json' ? parseToolJson(reply?.text) : { ok: true, calls: reply?.calls || [] };
  const calls = Array.isArray(parsed.calls) ? parsed.calls : [];
  const valid = calls.filter((c) => {
    if (!object(c.args)) return false;
    if (c.name === 'done') return mode === 'json';
    if (c.name === 'look') return LOOK_WHATS.includes(c.args.what) && (c.args.id === undefined || typeof c.args.id === 'string');
    if (c.name === 'act') return Array.isArray(c.args.actions) && c.args.actions.every((a) => object(a) && typeof a.type === 'string')
      && (c.args.end === undefined || typeof c.args.end === 'boolean') && (c.args.thought === undefined || typeof c.args.thought === 'string');
    return false;
  }).length;
  return { attempts: calls.length || (!parsed.ok || refusal || incomplete ? 1 : 0), valid: refusal || incomplete ? 0 : valid,
    parseFailed: !parsed.ok || calls.some((c) => !object(c.args)), refusal, incomplete };
}

const rate = (n, d) => d ? n / d : null;
const mean = (xs) => xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : null;
const percentile = (xs, q) => xs.length ? [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * q) - 1)] : null;
export function summarizePhase({ calls, wakings }) {
  const summarize = (cs, ws) => {
    const eligible = cs.filter((c) => !c.cancelled);
    const failed = eligible.filter((c) => !c.ok || c.parseFailed || c.refusal || c.incomplete).length;
    const attempts = cs.reduce((n, c) => n + c.attempts, 0);
    const valid = cs.reduce((n, c) => n + c.valid, 0);
    const actions = ws.flatMap((w) => w.acts);
    const input = cs.reduce((n, c) => n + c.input, 0), output = cs.reduce((n, c) => n + c.output, 0);
    return { calls: cs.length, cancelled: cs.filter((c) => c.cancelled).length, modelFailures: failed, modelFailureRate: rate(failed, eligible.length),
      parseFailures: cs.filter((c) => c.parseFailed).length, parseFailureRate: rate(cs.filter((c) => c.parseFailed).length, eligible.length),
      attempts, valid, toolValidRate: rate(valid, attempts), actions: actions.length, actionFailureRate: rate(actions.filter((a) => !a.ok).length, actions.length),
      wakings: ws.length, unfinished: ws.filter((w) => w.unfinished).length, wakes: ws.filter((w) => w.kind === 'wake').length, beforeDeadlineRate: rate(ws.filter((w) => w.beforeDeadline).length, ws.length),
      turnsPerWaking: mean(ws.map((w) => w.turns)), tokensPerWaking: rate(input + output, ws.length), input, output,
      lastCallMarginP01Ms: percentile(ws.map((w) => w.lastCallMarginMs).filter(Number.isFinite), 0.01) };
  };
  const models = Object.fromEntries([...new Set(calls.map((c) => c.model))].sort().map((model) => [model, summarize(calls.filter((c) => c.model === model), wakings.filter((w) => w.model === model))]));
  return { totals: summarize(calls, wakings), models };
}

function markdown(result) {
  const pct = (x) => x === null ? '无样本' : `${(100 * x).toFixed(2)}%`;
  const lines = ['# 第二前提本机测量', '', `状态：${result.status}。${result.mock ? 'mock 冒烟，不是真实模型验收。' : '真实 GLM/Step 调用。'}起始：${result.startedAt}。`, '',
    `总预算 ${result.budget.cap}；已扣 ${result.budget.charged}（供应商报告 ${result.budget.reported}，未知用量保守预留 ${result.budget.estimated}）。`, '',
    '| 方式 | 刻数 | 调用 | 工具有效率 | 模型失败率 | 动作失败率 | 截止前结束 | 平均轮数 | token/醒来 | 被叫醒 |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const p of result.phases) {
    const s = p.summary.totals;
    lines.push(`| ${p.mode} | ${p.ticksCompleted} | ${s.calls} | ${pct(s.toolValidRate)} | ${pct(s.modelFailureRate)} | ${pct(s.actionFailureRate)} | ${pct(s.beforeDeadlineRate)} | ${s.turnsPerWaking?.toFixed(2) ?? '无样本'} | ${s.tokensPerWaking?.toFixed(0) ?? '无样本'} | ${s.wakes} |`);
  }
  lines.push('', '工具有效率以工具请求次数为分母；动作失败独立计算。模型失败包括供应商故障、解析失败与拒绝；本机截止或关闭取消独立计数。未返回用量的请求按完整预留扣费保护总预算。', '',
    'JSON 与 native 连续运行于同一独立世界，第二轮承接第一轮的状态；顺序与城内变化是比较的限制。十份本地草稿复制后仅将入境日设为 0，源文件与生产世界不变。', '',
    `进度与数字遥测：${result.dir}。不记录模型提示、回复、独白或动作参数。世界命令日志仍按原协议保存居民行动。`, '',
    '逐模型结果：', '```json', JSON.stringify(result.phases.map((p) => ({ mode: p.mode, models: p.summary.models, replay: p.replay })), null, 2), '```');
  if (result.baseline) lines.push('', '旧世界比较基线（2026-10-04 审计的 current 窗口）：', '```json', JSON.stringify(result.baseline, null, 2), '```');
  lines.push('', '验收要求：工具有效率 ≥98%；截止前完成 ≥99%；Step 失败率不高于旧基线 +2 个百分点。工具样本为空、未跑完或预算耗尽时不能判为通过。配置初值先保留，完整测量后依据逐模型结果选择。');
  return lines.join('\n') + '\n';
}

/** 真正后台运行的入口；mock 仅供自动测试，允许缩短刻长与取消截止余量。 */
export async function runMeasurement({ privateFile, foundersFile, dir, cap = 20000000, ticks = 12, tickMs = 900000, mock = false, reportFile, baseline } = {}) {
  if (!mock && (ticks !== 12 || tickMs !== 900000)) throw new Error('Real measurement requires 12 ticks per mode and 15-minute ticks');
  dir = resolve(dir); mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (existsSync(join(dir, 'status.json'))) throw new Error('Measurement directory already has a run; use a new directory');
  const privateConfig = JSON.parse(readFileSync(privateFile, 'utf8'));
  const sourceLines = privateConfig.config.lines;
  if (sourceLines.length !== 2 || (!mock && sourceLines.some((l) => l.provider === 'mock'))) throw new Error('Measurement needs two real model lines');
  const founders = JSON.parse(readFileSync(foundersFile, 'utf8'));
  if (founders.length !== 10 || founders.some((f) => f.day !== 0)) throw new Error('Measurement needs ten day-0 founders');
  const budget = new TotalBudget({ cap, file: join(dir, 'total-budget.json') });
  const result = { status: 'running', pid: process.pid, mock, dir, startedAt: new Date().toISOString(), phases: [], budget: budget.view(), ...(baseline ? { baseline } : {}) };
  let aborted = false, activeApp, activeRuntime;
  const stop = () => { aborted = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const progress = (extra = {}) => { result.budget = budget.view(); save(join(dir, 'status.json'), { ...result, heartbeatAt: new Date().toISOString(), ...extra }); };
  try {
    for (const mode of ['json', 'native']) {
      if (aborted || budget.exhausted) break;
      const phase = { mode, startedAt: new Date().toISOString(), startTick: activeRuntime?.w.clock.tick ?? 0, ticksCompleted: 0 };
      const phaseFile = join(dir, `shells-${mode}.json`);
      const config = { tokensPerDay: 50000000, concurrency: 6, historyRounds: 2,
        agentLoop: { ...DEFAULT_AGENT_LOOP, ...(mock ? { marginSec: 10, debounceSec: 0 } : {}) }, lines: sourceLines.map((l) => ({ ...l, toolMode: mode })) };
      writeFileSync(phaseFile, JSON.stringify(config), { mode: 0o600 });
      const cfg = loadConfig({ PHYSICS: '2', PREMISE: '2', SHELL_SLOTS: '20', WORLD_ID: 'p2-measurement', DATA_DIR: join(dir, 'worlds'),
        SEED: 'p2-measurement-20261005', TICK_MS: String(tickMs), FOUNDERS_FILE: resolve(foundersFile), SHELLS_FILE: phaseFile,
        SHELL_TZ: 'Asia/Shanghai', REGISTRATION_OPEN: '0', PORT: '0' }, []);
      applyConfig(cfg);
      const rt = Runtime.open(cfg, { version: '0.1.0', logger: quiet }); activeRuntime = rt;
      const app = createApp(rt, cfg, { logger: quiet }); activeApp = app;
      if (mock) rt.agentLoop = { ...rt.agentLoop, marginSec: 0, debounceSec: 0 };
      const shell = app.ctx.shells;
      const responses = new Map(), lastCalls = new Map(), nextTimes = new Map(), pendingWakings = new Map();
      let phaseClosing = false;
      const phaseCalls = [], phaseWakings = [];
      shell.providerFactory = async (line, deps) => {
        const provider = await createProvider(line, { ...deps, env: privateConfig.keys });
        const wrapper = { name: provider.name };
        for (const method of ['complete', 'step']) if (provider[method]) wrapper[method] = async (request) => {
          const id = request.perception.you.id;
          const reply = await provider[method](request);
          responses.set(id, classifyReply(mode, reply)); return reply;
        };
        return wrapper;
      };
      const before = shell.beforeModel.bind(shell), usage = shell.onUsage.bind(shell);
      shell.beforeModel = async (id, line, state, meta) => {
        if (aborted || budget.exhausted) return false;
        // UTF-8 字节上界 + 最大输出 + 格式余量，比平台的匀速预估更保守。
        const reserve = Math.ceil(meta.chars * 3) + line.cfg.maxTokens + 8192;
        if (!budget.reserve(id, reserve)) return false;
        try {
          const allowed = await before(id, line, state, meta);
          if (!allowed) budget.cancel(id);
          return allowed;
        } catch (e) { budget.cancel(id); throw e; }
      };
      shell.onUsage = (id, line, value, meta) => {
        budget.settle(id, meta.ok ? value : null);
        const classified = responses.get(id) ?? { attempts: 0, valid: 0, parseFailed: false, refusal: false }; responses.delete(id);
        const finished = Date.now(); lastCalls.set(id, finished);
        const row = { at: new Date(finished).toISOString(), mode, model: line.cfg.model, agentId: id, tick: meta.waking.tick, kind: meta.waking.kind, turn: meta.waking.turn,
          ok: meta.ok === true, cancelled: meta.cancelled === true || (phaseClosing && !meta.ok), ms: meta.ms, input: finite(value?.input) ? value.input : 0, output: finite(value?.output) ? value.output : 0,
          ...classified, status: Number.isInteger(meta.error?.status) ? meta.error.status : null, timeout: meta.error?.timeout === true };
        phaseCalls.push(row); append(join(dir, 'calls.jsonl'), row);
        const pending = pendingWakings.get(id) ?? { model: line.cfg.model, agentId: id, ...meta.waking, turns: 0, input: 0, output: 0 };
        if (meta.ok) pending.turns++;
        pending.input += row.input; pending.output += row.output;
        pendingWakings.set(id, pending);
        usage(id, line, value, meta);
      };
      const traces = app.ctx.traces;
      const originalAppend = traces.append.bind(traces);
      traces.append = (id, rec, model) => {
        originalAppend(id, rec, model);
        const nextAt = nextTimes.get(rec.tick), at = Date.now(), lastCallAt = lastCalls.get(id) ?? null;
        const row = { at: new Date(at).toISOString(), mode, agentId: id, model, ...cleanRecord(rec), nextAt, deadline: nextAt - rt.agentLoop.marginSec * 1000,
          beforeDeadline: at < nextAt - rt.agentLoop.marginSec * 1000, lastCallMarginMs: lastCallAt === null ? null : nextAt - lastCallAt };
        phaseWakings.push(row); append(join(dir, 'wakings.jsonl'), row);
        pendingWakings.delete(id);
      };
      const startAt = Date.now();
      rt.nextTickAt = startAt + tickMs; nextTimes.set(rt.w.clock.tick + 1, rt.nextTickAt); rt.tickNow();
      phase.ticksCompleted = 1;
      await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
      if (Object.keys(rt.w.agents).length !== 10) throw new Error('Expected ten founders at measurement start');
      progress({ mode, tick: rt.w.clock.tick, localPort: app.server.address().port });
      let lastProgress = 0;
      for (;;) {
        if (aborted || budget.exhausted) break;
        if ([...shell.lines.values()].every((l) => l.status === 'error')) throw new Error('Both measurement lines failed');
        const now = Date.now();
        if (now >= startAt + ticks * tickMs) break;
        if (phase.ticksCompleted < ticks && now >= startAt + phase.ticksCompleted * tickMs) {
          rt.nextTickAt = startAt + (phase.ticksCompleted + 1) * tickMs;
          nextTimes.set(rt.w.clock.tick + 1, rt.nextTickAt); rt.tickNow(); phase.ticksCompleted++;
        }
        if (now - lastProgress > 15000) { progress({ mode, tick: rt.w.clock.tick, calls: phaseCalls.length }); lastProgress = now; }
        await sleep(Math.min(500, Math.max(1, startAt + ticks * tickMs - now)));
      }
      phaseClosing = true;
      await app.close(); activeApp = null; rt.close();
      // 关闭时未完成的醒来也进入截止分母，不能因运行器没回报而被静默漏掉。
      for (const [id, p] of pendingWakings) {
        const nextAt = nextTimes.get(p.tick), at = Date.now();
        const row = { at: new Date(at).toISOString(), mode, agentId: id, model: p.model,
          ...cleanRecord({ tick: p.tick, kind: p.kind, mode, turns: p.turns, looks: [], acts: [], ended: 'deadline', tokens: { in: p.input, out: p.output }, ms: 0 }),
          nextAt, deadline: nextAt - rt.agentLoop.marginSec * 1000, beforeDeadline: false, unfinished: true,
          lastCallMarginMs: nextAt - lastCalls.get(id) };
        phaseWakings.push(row); append(join(dir, 'wakings.jsonl'), row);
      }
      phase.endedAt = new Date().toISOString(); phase.endTick = rt.w.clock.tick;
      const replay = replayDir(rt.dir); phase.replay = { ok: replay.ok, commands: replay.applied, hash: replay.hash, diff: replay.diff };
      if (!replay.ok || !rt.engine.checkConservation(rt.w).ok) throw new Error('Measurement world failed replay or conservation');
      phase.summary = summarizePhase({ calls: phaseCalls, wakings: phaseWakings });
      result.phases.push(phase); progress();
    }
    result.status = aborted ? 'aborted' : budget.exhausted ? 'budget_exhausted' : 'complete';
  } catch (e) {
    // 不把供应商可能回显的正文或凭据写进日志；诊断用失败类型与请求状态。
    result.status = 'failed'; result.error = { name: ['Error', 'ProviderError'].includes(e?.name) ? e.name : 'Error' };
    throw e;
  } finally {
    if (activeApp) await activeApp.close(); activeRuntime?.close();
    result.endedAt = new Date().toISOString(); progress();
    save(join(dir, 'result.json'), result);
    writeFileSync(join(dir, 'report.md'), markdown(result), { mode: 0o600 });
    if (reportFile) writeFileSync(reportFile, markdown(result));
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = Object.fromEntries(process.argv.slice(2).filter((x) => x.includes('=')).map((x) => { const i = x.indexOf('='); return [x.slice(0, i).replace(/^--/, ''), x.slice(i + 1)]; }));
  const baseline = args.baseline ? JSON.parse(readFileSync(args.baseline, 'utf8')) : undefined;
  runMeasurement({ privateFile: args.private, foundersFile: args.founders, dir: args.out, cap: Number(args.cap || 20000000), reportFile: args.report, baseline })
    .then((r) => console.log(JSON.stringify({ status: r.status, budget: r.budget, phases: r.phases.length })))
    .catch(() => { console.error('Measurement failed; inspect the numeric status and telemetry files.'); process.exitCode = 1; });
}
