// 参考运行器（SPEC §15.1）：node runner/agent.js --config runner/agents.json
// 一个进程可以驱动多个 agent，每个 agent 一个异步循环：
//   感知 → 渲染成文本 → 调用提供者 → 解析回复 → 行动 → 记下结果 → 等到下一刻。
// 运行器不受引擎确定性约束（会用随机抖动）。API 密钥与令牌只从环境变量读取，不进入提示与日志。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, errorMessage } from './client.js';
import { createProvider, PROVIDER_NAMES, ProviderError } from './providers.js';
import { renderPerception, summarizeResults } from './render.js';
import { buildSystemPrompt, promptParams } from './prompt.js';
import { parseModelJson, normalizeReply } from './parse.js';

const KEEP_ROUNDS = 6; // 短期记忆：默认只保留最近 6 轮（配置项 historyRounds 可以调小以省 token）
const FALLBACK_TICK_MS = 300000;
const MAX_REJECTED = 5; // 连续多少次被拒绝之后放弃

// ── 配置 ──────────────────────────────────────────────────────

/**
 * 读取并校验配置文件；令牌从环境变量读出。
 * 返回 [{ name, server, token, lang, provider, ...提供者选项, actEveryTicks }]，配置有问题时抛出带说明的 Error。
 */
export function loadRunnerConfig(file, env = process.env) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`读不了配置文件 ${file}：${e.message}`);
  }
  return parseRunnerConfig(raw, env);
}

export function parseRunnerConfig(raw, env = process.env) {
  if (!raw || typeof raw !== 'object') throw new Error('配置必须是一个 JSON 对象。');
  const server = raw.server || 'http://127.0.0.1:8787';
  if (typeof server !== 'string' || !/^https?:\/\//.test(server)) throw new Error('"server" 必须是 http(s) 地址。');
  if (!Array.isArray(raw.agents) || raw.agents.length === 0) throw new Error('"agents" 必须是非空数组。');
  return raw.agents.map((a, i) => {
    const where = `agents[${i}]`;
    if (!a || typeof a !== 'object') throw new Error(`${where} 必须是对象。`);
    if (typeof a.tokenEnv !== 'string' || a.tokenEnv === '') throw new Error(`${where}.tokenEnv 必须给出保存令牌的环境变量名（令牌不写在文件里）。`);
    const token = env[a.tokenEnv];
    if (!token) throw new Error(`${where}：环境变量 ${a.tokenEnv} 没有设置。`);
    if (!PROVIDER_NAMES.includes(a.provider)) throw new Error(`${where}.provider 必须是 ${PROVIDER_NAMES.join(' / ')} 之一。`);
    const lang = a.lang === 'en' ? 'en' : 'zh';
    const every = a.actEveryTicks === undefined ? 1 : a.actEveryTicks;
    if (!Number.isInteger(every) || every < 1) throw new Error(`${where}.actEveryTicks 必须是 ≥ 1 的整数。`);
    if (a.historyRounds !== undefined && (!Number.isInteger(a.historyRounds) || a.historyRounds < 0 || a.historyRounds > 20)) throw new Error(`${where}.historyRounds 必须是 0–20 的整数。`);
    if (a.extraBody !== undefined && (a.extraBody === null || typeof a.extraBody !== 'object' || Array.isArray(a.extraBody))) throw new Error(`${where}.extraBody 必须是一个 JSON 对象。`);
    const { tokenEnv, ...rest } = a;
    return { name: a.name || `agent${i + 1}`, ...rest, server: a.server || server, token, lang, actEveryTicks: every, tokenEnv };
  });
}

// ── 日志 ──────────────────────────────────────────────────────

/** 日志：带前缀；出现在文本里的密钥一律替换成 ***（纵深防御，正常情况下它们根本不会被打印） */
export function makeLogger(prefix, { secrets = [], out = (s) => console.log(s), err = (s) => console.error(s), quiet = false } = {}) {
  const clean = (msg) => {
    let s = String(msg);
    for (const k of secrets) if (k && k.length >= 6) s = s.split(k).join('***');
    return s;
  };
  const stamp = () => new Date().toTimeString().slice(0, 8);
  return {
    info: (m) => !quiet && out(`${stamp()} [${prefix}] ${clean(m)}`),
    warn: (m) => err(`${stamp()} [${prefix}] ⚠ ${clean(m)}`),
    error: (m) => err(`${stamp()} [${prefix}] ✖ ${clean(m)}`),
  };
}

// ── 单个 agent 的循环 ─────────────────────────────────────────

function defaultWait(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/**
 * 驱动一个 agent，直到它长眠 / 归隐 / 认证失败 / 被中止 / 达到 maxRounds。
 * cfg：一项 loadRunnerConfig 的结果（或等价的对象：server、token、lang、provider…）。
 * deps（多为测试用）：{ client, provider, providerDeps, log, wait(ms, signal), signal, maxRounds }
 * 返回 { rounds, acted, stopped }，stopped ∈ dead | retired | auth | provider | aborted | maxRounds
 */
export async function runAgent(cfg, deps = {}) {
  const secrets = [cfg.token, cfg.apiKeyEnv && process.env[cfg.apiKeyEnv]].filter(Boolean);
  const log = deps.log || makeLogger(cfg.name || 'agent', { secrets });
  const client = deps.client || createClient({ server: cfg.server, token: cfg.token });
  const wait = deps.wait || defaultWait;
  const signal = deps.signal;
  const maxRounds = deps.maxRounds ?? Infinity;
  let provider;
  try {
    provider = deps.provider || (await createProvider(cfg, deps.providerDeps));
  } catch (e) {
    log.error(e.message);
    return { rounds: 0, acted: 0, stopped: 'provider' };
  }

  const history = []; // [{ user, assistant }]，最多 keep 轮
  const keep = Number.isInteger(cfg.historyRounds) && cfg.historyRounds >= 0 ? cfg.historyRounds : KEEP_ROUNDS;
  let cursor; // 收件箱游标：成功行动（或决定不行动）之后才确认，保证「至少一次」
  let lastResults = null;
  let system = null;
  let rounds = 0;
  let acted = 0;
  let rejected = 0; // 连续被服务商拒绝（非限速的 4xx）的次数：多半是配置错了
  let name = cfg.name || 'agent';

  /** 等到下一刻（乘以 n），加 0–10% 的随机抖动；nextTickAt 已过时至少等 1 秒，避免空转 */
  const waitTick = async (p, n = 1) => {
    const tickMs = (p && p.now && p.now.tickMs) || FALLBACK_TICK_MS;
    const next = p && p.now && p.now.nextTickAt ? p.now.nextTickAt : Date.now() + tickMs;
    const target = next + (n - 1) * tickMs;
    const ms = Math.max(1000, target - Date.now()) + Math.random() * 0.1 * tickMs;
    await wait(ms, signal, p);
  };

  let stopped = 'aborted';
  while (!(signal && signal.aborted)) {
    if (rounds >= maxRounds) {
      stopped = 'maxRounds';
      break;
    }
    const me = await client.me({ lang: cfg.lang, after: cursor });
    if (!me.ok) {
      if (me.status === 401) {
        log.error('认证失败：令牌无效或已被更换。停止该 agent。');
        stopped = 'auth';
        break;
      }
      log.warn(`感知失败：${errorMessage(me)}；下一刻重试。`);
      await wait(FALLBACK_TICK_MS, signal, null);
      continue;
    }
    const p = me.json;
    // 第一次感知没有显式的 after，服务器已经把游标推进了：用第一条收件的序号 − 1 当作「尚未确认」的起点，
    // 这样第一轮就算失败，下一轮仍然能再看到同样的收件
    if (cursor === undefined) cursor = p.inbox && p.inbox.length ? p.inbox[0].seq - 1 : p.inboxCursor;
    const status = p.you && p.you.status;
    if (p.you && p.you.name) name = p.you.name;
    if (status === 'dead' || status === 'retired') {
      log.info(`${name} 已${status === 'dead' ? '长眠' : '归隐'}，停止。`);
      stopped = status;
      break;
    }
    if (status === 'dormant') {
      log.info(`${name} 正在沉睡（能量 ${p.you.energy}），等待下一刻。`);
      await waitTick(p);
      continue;
    }
    if (p.now && p.now.paused) {
      log.info('城中的时间静止了，等待。');
      await waitTick(p);
      continue;
    }

    rounds++;
    // 系统提示只在第一次（或换了语言 / 灵魂）时构建：整轮不变，便于提供者缓存
    if (system === null) system = buildSystemPrompt(promptParams(p));
    const userText = renderPerception(p, { lastResults: lastResults || undefined, lang: cfg.lang });
    const messages = [];
    for (const h of history) messages.push({ role: 'user', content: h.user }, { role: 'assistant', content: h.assistant });
    messages.push({ role: 'user', content: userText });

    let reply;
    const t0 = Date.now();
    try {
      reply = await provider.complete({ system, messages, perception: p });
      // 用时与用量：调「一刻多长」「历史留几轮」的依据
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      const u = reply.usage;
      log.info(`模型用时 ${secs} s${u ? ` · 输入 ${u.input} · 输出 ${u.output} token` : ''}`);
      rejected = 0;
    } catch (e) {
      if (e instanceof ProviderError && e.fatal) {
        log.error(`${e.message} 停止该 agent。`);
        stopped = 'provider';
        break;
      }
      log.warn(`提供者出错：${e && e.message}；本刻不行动。`);
      // 服务商一再拒绝同样的请求（模型名、baseURL、参数不对），重试没有意义：别无限刷屏
      if (e instanceof ProviderError && !e.retryable) rejected++;
      else rejected = 0;
      if (rejected >= MAX_REJECTED) {
        log.error(`连续 ${rejected} 次被服务商拒绝，多半是配置有问题（模型名、baseURL、参数）。停止该 agent。`);
        stopped = 'provider';
        break;
      }
      lastResults = null;
      await waitTick(p);
      continue;
    }
    if (reply.stop === 'refusal') {
      log.warn('模型拒绝了这一轮请求；本刻不行动。');
      await waitTick(p);
      continue;
    }
    const parsed = parseModelJson(reply.text);
    if (!parsed.ok) {
      log.warn(`回复里没有可解析的 JSON（${parsed.error}）；本刻不行动。开头：${String(reply.text).slice(0, 80).replace(/\s+/g, ' ')}`);
      lastResults = cfg.lang === 'en' ? 'Your last reply could not be parsed. Output exactly one JSON object.' : '你上一轮的回复无法解析。请只输出一个 JSON 对象。';
      await waitTick(p);
      continue;
    }
    const { thought, actions, warnings } = normalizeReply(parsed.value, (p.you && p.you.maxActionsPerTick) || 4);
    for (const w of warnings) log.warn(w);

    let results = [];
    if (thought || actions.length > 0) {
      const act = await client.act({ thought, actions });
      if (!act.ok) {
        const code = act.json && act.json.error && act.json.error.code;
        log.warn(`行动失败：${errorMessage(act)}`);
        if (act.status === 401) {
          log.error('认证失败。停止该 agent。');
          stopped = 'auth';
          break;
        }
        lastResults = cfg.lang === 'en' ? `Your last act request failed: ${code || act.status}` : `你上一轮的行动请求失败了：${code || act.status}`;
        await waitTick(p);
        continue;
      }
      results = act.json.results || [];
      acted++;
    } else {
      log.info('本刻不行动。');
    }
    cursor = p.inboxCursor; // 确认：这一批收件已经交给了模型，而模型的回复也已被接受
    lastResults = summarizeResults(results, cfg.lang);
    for (const r of results) {
      log.info(`  ${r.ok ? '✓' : '✗'} ${r.type}${r.ok ? (r.cost ? `（−${r.cost}）` : '') : ` ${r.error ? r.error.code : ''}`}`);
    }
    if (thought) log.info(`  独白：${thought}`);
    history.push({ user: userText, assistant: JSON.stringify({ ...(thought ? { thought } : {}), actions }) });
    while (history.length > keep) history.shift();
    await waitTick(p, cfg.actEveryTicks || 1);
  }
  return { rounds, acted, stopped };
}

// ── 命令行 ────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config') o.config = argv[++i];
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`不认识的参数：${a}`);
  }
  return o;
}

const USAGE = '用法：node runner/agent.js --config runner/agents.json [--quiet]\n配置见 runner/agents.example.json；令牌从 tokenEnv 指定的环境变量读取。';

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    console.error(USAGE);
    process.exit(2);
  }
  if (opts.help || !opts.config) {
    console.log(USAGE);
    process.exit(opts.help ? 0 : 2);
  }
  let agents;
  try {
    agents = loadRunnerConfig(opts.config);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const ac = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => ac.abort());
  const results = await Promise.all(agents.map((cfg) => {
    const secrets = [cfg.token, cfg.apiKeyEnv && process.env[cfg.apiKeyEnv]].filter(Boolean);
    return runAgent(cfg, { signal: ac.signal, log: makeLogger(cfg.name, { secrets, quiet: opts.quiet }) });
  }));
  console.log(results.map((r, i) => `${agents[i].name}: ${r.stopped}（${r.acted} 次行动）`).join('\n'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
