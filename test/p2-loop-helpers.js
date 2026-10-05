// 第二前提工具循环测试（T7、T8）的共用辅助：一座真的第二前提的城（Runtime + 进程内客户端），脚本化的 mock 提供者，
// 记录请求、用量与轨迹的 drive()。城里的刻是 1 秒（tickMs），上限里的截止余量与防抖缺省为 0，需要时在 loop 里指定。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { createShellClient } from '../src/shells/client.js';
import { DEFAULT_AGENT_LOOP } from '../runner/loop.js';
import { createProvider } from '../runner/providers.js';
import { runAgent } from '../runner/agent.js';
import { sha } from './e2-helpers.js';

/**
 * 开一座第二前提的城，注册 names 里的居民（都在港口）。
 * 返回 { rt, ids, warnings, client(id), say…, exec(id, actions), close() }；rt.agentLoop 是工具循环的上限（感知的 attention 取它）。
 */
export function openCity({ seed = 'loop', names = ['甲', '乙'], loop = {}, ...extra } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'houren-loop-'));
  const cfg = { ...loadConfig({}, []), dataDir: dir, worldId: 'w', seed, physics: 2, premise: 2, shellSlots: 8, tickMs: 1000, ...extra };
  const warnings = [];
  const rt = Runtime.open(cfg, { version: '0.1.0', logger: { warn: (m) => warnings.push(m), error() {} } });
  rt.agentLoop = { ...DEFAULT_AGENT_LOOP, marginSec: 0, debounceSec: 0, ...loop };
  const ids = names.map((name) => rt.exec('register', { name, bio: '', soul: `我是${name}`, lang: 'zh', model: 'm', creatorName: 't', tokenHash: sha(`t:${name}`), ownerKeyHash: sha(`k:${name}`) }).result.agentId);
  const cursors = new Map();
  return {
    rt, ids, warnings, cursors,
    // 感知里的 now.tickMs 是世界的常数（5 分钟）：这里改成城的刻长（1 秒），运行器等待下一刻的抖动（刻长的 0–10%）才不会拖到半分钟
    client(id) {
      const real = createShellClient(rt, id, { cursors });
      return { ...real, me: async (o) => { const r = await real.me(o); if (r.ok && r.json.now) r.json.now.tickMs = cfg.tickMs; return r; } };
    },
    /** 直接以某位居民的身份行动（不经运行器）；先把本刻的名额清零 */
    exec(id, actions) {
      rt.w.agents[id].actsThisTick = 0;
      return rt.exec('act', { agentId: id, actions });
    },
    agent: (id) => rt.w.agents[id],
    close() {
      rt.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 文本 JSON 的一轮回复 */
export const J = (o) => ({ text: JSON.stringify(o) });

/** 脚本化的 mock 提供者：script 的每一项是一轮的回复（见 runner/providers.js） */
export const scripted = (script) => createProvider({ provider: 'mock', script });

/**
 * 驱动一位居民跑 rounds 个主醒来（其间不等待真的刻，不被叫醒，除非 deps 里另有安排）。
 * 提供者：inner（已建好的）或 script；记下每次调用的请求（深拷贝）、用量回报、轨迹与日志。
 * 返回 { result（runAgent 的返回值）, requests, usage, wakings, logs }。
 */
export async function drive(city, id, { script, inner, cfg = {}, deps = {}, rounds = 1, after } = {}) {
  const provider = inner ?? await scripted(script);
  const out = { requests: [], usage: [], wakings: [], logs: [] };
  const spy = { name: 'spy' };
  const copy = (x) => JSON.parse(JSON.stringify(x));
  spy.complete = async (req) => {
    out.requests.push({ system: req.system, messages: copy(req.messages), timeoutMs: req.timeoutMs });
    return provider.complete(req);
  };
  if (typeof provider.step === 'function') {
    spy.step = async (req) => {
      out.requests.push({ system: req.system, transcript: copy(req.transcript), tools: req.tools, timeoutMs: req.timeoutMs });
      return provider.step(req);
    };
  }
  const log = { info: (m) => out.logs.push(m), warn: (m) => out.logs.push(`WARN ${m}`), error: (m) => out.logs.push(`ERR ${m}`) };
  out.result = await runAgent({ name: city.agent(id).name, lang: 'zh', token: 'in-process', server: 'in-process', ...cfg }, {
    client: city.client(id), provider: spy, log, maxRounds: rounds,
    wait: async () => { if (after) await after(); },
    waitWake: false,
    onUsage: (agentId, usage, meta) => out.usage.push({ agentId, usage, ...meta }),
    onWaking: (agentId, rec) => out.wakings.push({ agentId, rec }),
    ...deps,
  });
  return out;
}

/** 第 k 次请求里最后一条 user 消息的正文（文本 JSON 的 messages 或原生的 transcript） */
export function lastUser(request) {
  if (request.messages) return request.messages.filter((m) => m.role === 'user').at(-1).content;
  return request.transcript.filter((m) => m.role === 'user').at(-1).text;
}

export const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
