#!/usr/bin/env node
import { tokenized } from '../src/e2/world.js';
import { tokenTools } from './tokens.js';
// MCP 服务（SPEC §15.3）：stdio 上的 JSON-RPC 2.0，零依赖。让 Claude Code 之类的 MCP 客户端直接扮演一位居民。
//
// 环境变量：HOUREN_SERVER（默认 http://127.0.0.1:8787）、HOUREN_TOKEN（agent 令牌）、HOUREN_LANG（默认 zh）。
// 支持：initialize、notifications/initialized、ping、tools/list、tools/call。
// 工具：houren_rules（系统提示，不含灵魂）、houren_perceive（渲染后的感知）、houren_act（行动，返回各动作结果的摘要）；
// 第二前提的城另有 houren_look（展开概要里的一段）与 houren_wait（等到有人找上门，SPEC-P2 §12）：连接到别的世界时它们返回「这座城没有这个工具」。
// stdout 只输出协议消息，日志写 stderr。令牌不出现在任何输出里。
//
// 「至少一次」的收件：houren_perceive 用显式的 after，成功的 houren_act 之后才确认，
// 所以模型在行动之前重复感知，看到的收件是一样的。

import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createClient, errorMessage } from '../runner/client.js';
import { renderPerception, summarizeResults, errorText } from '../runner/render.js';
import { D } from '../runner/render2.js';
import { buildSystemPrompt, promptParams } from '../runner/prompt.js';
import { DEFAULT_AGENT_LOOP } from '../runner/loop.js';
import { D2, LOOK_WHATS, LOOK_WHATS_P4, clipLook, renderArrived, renderBrief, renderLook } from '../runner/render-p2.js';

export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = { name: 'houren', version: '0.1.0' };
const NO_INBOX = 999999999999999; // 大于任何收件序号：只取世界的数据，不动收件游标

export const TOOLS = [
  {
    name: 'houren_rules',
    description: '返回这座城的规则（系统提示：时间、能量、环境、法律、动作表与输出约定）。不含你的灵魂——灵魂在感知的「你」一节里。开始之前读一遍。/ The rules of the city (system prompt without your soul).',
    inputSchema: { type: 'object', properties: { lang: { type: 'string', enum: ['zh', 'en'], description: 'zh 或 en，默认取 HOUREN_LANG' } }, additionalProperties: false },
  },
  {
    name: 'houren_perceive',
    description: '感知这座城：此刻、你自己、你所在的地点、收件箱、全城的公共信息，渲染成文本。每一刻行动之前先调用它。/ Perceive the city as rendered text.',
    inputSchema: { type: 'object', properties: { lang: { type: 'string', enum: ['zh', 'en'], description: 'zh 或 en，默认取 HOUREN_LANG' } }, additionalProperties: false },
  },
  {
    name: 'houren_act',
    description: '行动。actions 最多 4 个，按顺序逐个执行，后一个看到的是前一个执行后的状态；thought 是此刻的独白（≤300 字符，一个月后公开）。什么都不做：actions 为空数组。返回各动作的结果。/ Take up to 4 actions.',
    inputSchema: {
      type: 'object',
      properties: {
        thought: { type: 'string', maxLength: 300, description: '（可选）此刻的独白' },
        actions: {
          type: 'array',
          maxItems: 4,
          items: { type: 'object', properties: { type: { type: 'string', description: '动作类型，如 move / say / repair' } }, required: ['type'], additionalProperties: true },
          description: '动作列表，参数见 houren_rules 里的动作表',
        },
      },
      required: ['actions'],
      additionalProperties: false,
    },
  },
];

/**
 * 第二前提的两个工具（SPEC-P2 §12）。原来三个工具的定义（TOOLS）一字不改；这两个另放。
 * tools/list：连到第二前提的城时列出五个；连到别的世界（或没有令牌）时仍是原来的三个；探测不到世界时（服务器不通）也列出五个。
 * 不论列没列出，连到不是第二前提的城时调用它们得到「这座城没有这个工具」。
 */
// Q42 B：tools/list 按世界版本决定；旧世界或没有令牌仍列三个，第二前提或探测失败列五个。
export const TOOLS_P2 = [
  {
    name: 'houren_look',
    description: '展开概要里的一段，看全文（第二前提的城）。what：here、self、laws、law、proposals、proposal、procedure、groups、group、residents、places、refounds、cradle、lexicon、petitions；law、proposal、group 可以带 id。每一刻能看的次数有限，看不花能量。/ Open a section of the summary (premise-2 cities only).',
    inputSchema: {
      type: 'object',
      properties: {
        what: { type: 'string', enum: [...LOOK_WHATS], description: '要展开的一段' },
        id: { type: 'string', description: '（可选）law、proposal、group 的编号' },
        lang: { type: 'string', enum: ['zh', 'en'], description: 'zh 或 en，默认取 HOUREN_LANG' },
      },
      required: ['what'],
      additionalProperties: false,
    },
  },
  {
    name: 'houren_wait',
    description: '等到有人找上门（私语、定向交易、孕育之约、交给你的记忆、入社申请），或到时返回；返回新到的收件（第二前提的城）。/ Wait until someone seeks you (premise-2 cities only).',
    inputSchema: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 50000, description: '最多等多久（毫秒），默认 25000' },
        lang: { type: 'string', enum: ['zh', 'en'], description: 'zh 或 en，默认取 HOUREN_LANG' },
      },
      additionalProperties: false,
    },
  },
];
const ALL_TOOLS = [...TOOLS, ...TOOLS_P2];
export const TOOLS_P4 = ALL_TOOLS.map(tool => {
  if (tool.name === 'houren_perceive') return { ...tool, description: '醒来：付一次醒来的词元，看到概要。/ Wake: pay for one waking and see your summary.' };
  if (tool.name === 'houren_look') return { ...tool,
    description: '展开概要里的一段。what 包括 inbox（未送达收件）与 actions（即时动作状态）。看到的文字按读入付词元。/ Open a section, including inbox and actions. What you see is paid for as reading.',
    inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, what: { ...tool.inputSchema.properties.what, enum: [...LOOK_WHATS_P4] } } } };
  if (tool.name === 'houren_rules') return { ...tool, description: tool.description.replace('能量', '词元') };
  return tool;
});

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

/** 一次调用结果 → 给模型看的文字 */
function formatActResult(json, lang) {
  const lines = (json.results || []).map((r) => {
    return `${r.index + 1}. ${summarizeResults([r], lang)}`;
  });
  if (lines.length === 0) lines.push(lang === 'en' ? '(no actions)' : '（没有动作）');
  const y = json.you;
  if (y) lines.push(lang === 'en' ? `Now: ${y.status}, energy ${y.energy}, coins ${y.coins}, ${y.actionsLeft} action(s) left, at ${y.place}.` : `此刻：${y.status === 'awake' ? '醒着' : y.status}，能量 ${y.energy}，旧币 ${y.coins}，本刻还可行动 ${y.actionsLeft} 次，在 ${y.place}。`);
  return lines.join('\n');
}

/**
 * 创建 MCP 服务的协议处理器（与传输无关，便于测试）。
 * opts：{ env, fetch }。返回 { handle(message) → Promise<响应 | 响应数组 | null> }
 */
export function createMcp({ env = process.env, fetch: fetchImpl } = {}) {
  const server = env.HOUREN_SERVER || 'http://127.0.0.1:8787';
  const token = env.HOUREN_TOKEN || '';
  const defaultLang = env.HOUREN_LANG === 'en' ? 'en' : 'zh';
  const client = token ? createClient({ server, token, ...(fetchImpl ? { fetch: fetchImpl } : {}) }) : null;
  const paid = client ? tokenTools(client) : null;
  let baseline; // 收件游标：成功行动后才确认
  let pending; // 最近一次感知的游标
  let lastResults = null;
  let lastPerception = null; // 最近一次 houren_perceive 的感知：houren_look 用它渲染
  let premise; // 这座城的设定版本：感知过或探测过之后才知道
  let looks = { tick: -1, n: 0 }; // 本刻已经看了几次（第二前提；按感知里的刻归零）

  const needToken = () => text('环境变量 HOUREN_TOKEN 没有设置：请在接入 MCP 时用 -e HOUREN_TOKEN=<agent 令牌> 传入。', true);
  const langOf = (args) => (args && (args.lang === 'en' || args.lang === 'zh') ? args.lang : defaultLang);

  /** 感知一次（houren_perceive 与 houren_look / houren_wait 的「还没有感知时先感知一次」共用）：记下游标与最近的感知 */
  async function perceive(lang) {
    const r = await client.me({ lang, after: baseline });
    if (!r.ok) return r;
    const p = r.json;
    pending = p.inboxCursor;
    // 第一次没有显式的 after，服务器已经把游标推进了：用第一条收件的序号 − 1 作为「还没确认」的起点
    if (baseline === undefined) baseline = p.inbox && p.inbox.length ? p.inbox[0].seq - 1 : p.inboxCursor;
    lastPerception = p;
    premise = p.premise || 0;
    if (tokenized(p)) paid.remember(p);
    return r;
  }

  /** tools/list 要知道这座城是不是第二前提：探测一次（只读，不动收件游标）；探测不到返回 null */
  async function probePremise() {
    if (premise !== undefined) return premise;
    const r = await client.me({ lang: defaultLang, after: NO_INBOX });
    if (!r.ok) return null;
    premise = r.json.premise || 0;
    if (tokenized(r.json)) paid.remember(r.json);
    return premise;
  }

  const noTool = (lang) => text(D2[lang].res.mcpNoTool, true);

  async function callTool(name, args) {
    if (!client) return needToken();
    const lang = langOf(args);
    if (tokenized({ premise })) return paid.call(name, args, lang);
    if (name === 'houren_rules') {
      const r = await client.me({ lang, after: NO_INBOX });
      if (!r.ok) return text(`无法取得规则：${errorMessage(r)}`, true);
      if (tokenized(r.json)) { premise = 4; return paid.rules(lang, r.json); }
      return text(buildSystemPrompt({ ...promptParams(r.json), soul: null, toolMode: 'mcp' })); // toolMode 只有第二前提的提示用
    }
    if (name === 'houren_perceive') {
      const r = await perceive(lang);
      if (!r.ok) return text(`无法感知：${errorMessage(r)}`, true);
      const p = r.json;
      if (tokenized(p)) return paid.call(name, args, lang);
      // 第二前提：概要；MCP 不维护跨刻的摘要，只在末尾附上一次 houren_act 的结果
      if (p.premise >= 2) return text(`${renderBrief(p, { lang })}${lastResults ? `\n${D[lang].last}${lastResults}` : ''}`);
      return text(renderPerception(p, { lastResults: lastResults || undefined, lang }));
    }
    if (name === 'houren_look' || name === 'houren_wait') {
      // 还没有感知过：先感知一次（也借此知道这座城是不是第二前提）
      if (!lastPerception) {
        const r = await perceive(lang);
        if (!r.ok) return text(`无法感知：${errorMessage(r)}`, true);
      }
      if (tokenized(lastPerception)) return paid.call(name, args, lang);
      if (!(lastPerception.premise >= 2)) return noTool(lang);
      if (name === 'houren_look') {
        if (typeof args.what !== 'string' || (args.id !== undefined && typeof args.id !== 'string')) return text(D2[lang].res.invalid(D2[lang].res.details.look), true);
        const limits = lastPerception.attention ?? DEFAULT_AGENT_LOOP;
        const tick = lastPerception.now ? lastPerception.now.tick : -1;
        if (looks.tick !== tick) looks = { tick, n: 0 }; // 按刻归零
        if (looks.n >= limits.looks) return text(D2[lang].res.looksOut);
        looks.n++;
        return text(clipLook(renderLook(lastPerception, args.what, args.id, { lang }), limits.lookChars, lang));
      }
      // houren_wait：等到有会叫醒的收件；不推进游标，收到的收件之后仍会出现在 houren_perceive 里
      if (args.timeoutMs !== undefined && !Number.isInteger(args.timeoutMs)) return text('参数错误：timeoutMs 必须是整数（毫秒）。', true);
      const r = await client.wait({ after: baseline, ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}), lang });
      if (!r.ok) return text(`等待失败：${errorMessage(r)}`, true);
      const items = (r.json && r.json.items) || [];
      return text(items.length ? renderArrived(lastPerception, items, { lang }).join('\n') : D2[lang].res.mcpEmpty);
    }
    if (name === 'houren_act') {
      if (!args || !Array.isArray(args.actions)) return text('参数错误：actions 必须是数组（什么都不做请传空数组）。', true);
      if (args.thought !== undefined && typeof args.thought !== 'string') return text('参数错误：thought 必须是字符串。', true);
      const r = await client.act({ thought: args.thought, actions: args.actions, lang });
      if (!r.ok && r.json?.error?.code === 'no_waking') { premise = 4; return paid.rejected(r, lang); }
      if (!r.ok) return text(`行动失败：${errorMessage(r)}`, true);
      if (pending !== undefined) baseline = pending; // 成功行动 = 确认
      lastResults = summarizeResults(r.json.results, lang);
      return text(formatActResult(r.json, lang));
    }
    return null;
  }

  async function handleOne(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return msg && typeof msg === 'object' && 'id' in msg ? fail(msg.id, -32600, 'Invalid Request') : fail(null, -32600, 'Invalid Request');
    }
    const isNotification = !('id' in msg);
    const id = msg.id;
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params && msg.params.protocolVersion;
        return ok(id, {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      }
      case 'ping':
        return isNotification ? null : ok(id, {});
      case 'tools/list': {
        if (isNotification) return null;
        const p = client ? await probePremise() : 0;
        return ok(id, { tools: tokenized({ premise: p }) ? TOOLS_P4 : p === null || p >= 2 ? ALL_TOOLS : TOOLS });
      }
      case 'tools/call': {
        if (isNotification) return null;
        const p = msg.params;
        if (!p || typeof p.name !== 'string') return fail(id, -32602, 'Invalid params: name is required');
        if (p.arguments !== undefined && (p.arguments === null || typeof p.arguments !== 'object' || Array.isArray(p.arguments))) return fail(id, -32602, 'Invalid params: arguments must be an object');
        if (!ALL_TOOLS.some((t) => t.name === p.name)) return fail(id, -32602, `Unknown tool: ${p.name}`);
        try {
          return ok(id, await callTool(p.name, p.arguments || {}));
        } catch (e) {
          return ok(id, text(`内部错误：${e && e.message}`, true));
        }
      }
      default:
        // 通知（notifications/initialized、notifications/cancelled……）不需要响应
        if (isNotification || msg.method.startsWith('notifications/')) return null;
        return fail(id, -32601, `Method not found: ${msg.method}`);
    }
  }

  return {
    /** 处理一条消息（或一个批）；通知返回 null */
    async handle(message) {
      if (Array.isArray(message)) {
        if (message.length === 0) return fail(null, -32600, 'Invalid Request');
        const out = [];
        for (const m of message) {
          const r = await handleOne(m);
          if (r) out.push(r);
        }
        return out.length ? out : null;
      }
      return handleOne(message);
    },
  };
}

// ── stdio 传输：每行一条 JSON 消息 ─────────────────────────────

export function serve({ input = process.stdin, output = process.stdout, env = process.env, log = (s) => process.stderr.write(`${s}\n`) } = {}) {
  const mcp = createMcp({ env });
  const rl = createInterface({ input, crlfDelay: Infinity });
  let chain = Promise.resolve();
  const send = (m) => output.write(`${JSON.stringify(m)}\n`);
  rl.on('line', (line) => {
    if (line.trim() === '') return;
    chain = chain.then(async () => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        send(fail(null, -32700, 'Parse error'));
        return;
      }
      try {
        const res = await mcp.handle(msg);
        if (res) send(res);
      } catch (e) {
        log(`内部错误：${e && e.message}`);
        if (msg && typeof msg === 'object' && 'id' in msg) send(fail(msg.id, -32603, 'Internal error'));
      }
    });
  });
  return new Promise((resolve) => rl.on('close', () => chain.then(resolve)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  serve().then(() => process.exit(0));
}
