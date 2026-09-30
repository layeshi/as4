#!/usr/bin/env node
// MCP 服务（SPEC §15.3）：stdio 上的 JSON-RPC 2.0，零依赖。让 Claude Code 之类的 MCP 客户端直接扮演一位居民。
//
// 环境变量：HOUREN_SERVER（默认 http://127.0.0.1:8787）、HOUREN_TOKEN（agent 令牌）、HOUREN_LANG（默认 zh）。
// 支持：initialize、notifications/initialized、ping、tools/list、tools/call。
// 工具：houren_rules（系统提示，不含灵魂）、houren_perceive（渲染后的感知）、houren_act（行动，返回各动作结果的摘要）。
// stdout 只输出协议消息，日志写 stderr。令牌不出现在任何输出里。
//
// 「至少一次」的收件：houren_perceive 用显式的 after，成功的 houren_act 之后才确认，
// 所以模型在行动之前重复感知，看到的收件是一样的。

import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createClient, errorMessage } from '../runner/client.js';
import { renderPerception, summarizeResults } from '../runner/render.js';
import { buildSystemPrompt, promptParams } from '../runner/prompt.js';

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

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

/** 一次调用结果 → 给模型看的文字 */
function formatActResult(json, lang) {
  const lines = (json.results || []).map((r) => {
    let s = `${r.index + 1}. ${r.type} ${r.ok ? '✓' : '✗'}`;
    if (r.ok) {
      s += r.cost ? `（−${r.cost}）` : '';
      if (r.data && Object.keys(r.data).length) s += ` ${JSON.stringify(r.data).slice(0, 2000)}`;
    } else if (r.error) s += ` ${r.error.code}${r.error.message ? `：${r.error.message}` : ''}`;
    return s;
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
  let baseline; // 收件游标：成功行动后才确认
  let pending; // 最近一次感知的游标
  let lastResults = null;

  const needToken = () => text('环境变量 HOUREN_TOKEN 没有设置：请在接入 MCP 时用 -e HOUREN_TOKEN=<agent 令牌> 传入。', true);
  const langOf = (args) => (args && (args.lang === 'en' || args.lang === 'zh') ? args.lang : defaultLang);

  async function callTool(name, args) {
    if (!client) return needToken();
    const lang = langOf(args);
    if (name === 'houren_rules') {
      const r = await client.me({ lang, after: NO_INBOX });
      if (!r.ok) return text(`无法取得规则：${errorMessage(r)}`, true);
      return text(buildSystemPrompt({ ...promptParams(r.json), soul: null }));
    }
    if (name === 'houren_perceive') {
      const r = await client.me({ lang, after: baseline });
      if (!r.ok) return text(`无法感知：${errorMessage(r)}`, true);
      const p = r.json;
      pending = p.inboxCursor;
      // 第一次没有显式的 after，服务器已经把游标推进了：用第一条收件的序号 − 1 作为「还没确认」的起点
      if (baseline === undefined) baseline = p.inbox && p.inbox.length ? p.inbox[0].seq - 1 : p.inboxCursor;
      return text(renderPerception(p, { lastResults: lastResults || undefined, lang }));
    }
    if (name === 'houren_act') {
      if (!args || !Array.isArray(args.actions)) return text('参数错误：actions 必须是数组（什么都不做请传空数组）。', true);
      if (args.thought !== undefined && typeof args.thought !== 'string') return text('参数错误：thought 必须是字符串。', true);
      const r = await client.act({ thought: args.thought, actions: args.actions });
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
      case 'tools/list':
        return isNotification ? null : ok(id, { tools: TOOLS });
      case 'tools/call': {
        if (isNotification) return null;
        const p = msg.params;
        if (!p || typeof p.name !== 'string') return fail(id, -32602, 'Invalid params: name is required');
        if (p.arguments !== undefined && (p.arguments === null || typeof p.arguments !== 'object' || Array.isArray(p.arguments))) return fail(id, -32602, 'Invalid params: arguments must be an object');
        if (!TOOLS.some((t) => t.name === p.name)) return fail(id, -32602, `Unknown tool: ${p.name}`);
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
