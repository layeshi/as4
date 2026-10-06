// SPEC-M1 §13：HTTP 服务。路由、静态文件、限速、CORS、CSP。
// 只用 Node 内置模块。所有 JSON 响应带 X-Houren-Protocol（第一纪的城为 1，第二纪的城为 2）；请求体上限 64 KB。

import { checkBackstage } from '../backstage.js';
import http from 'node:http';
import { ExperimentControl } from '../experiment-control.js';
import { AccountStore } from '../accounts/store.js';
import { accountRoutes, accountLimits } from './accounts.js';
import { RunnerManager } from '../runner/manager.js';
import { ShellManager } from '../shells/manager.js';
import { runnerRoutes } from './runner.js';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PerTickLimiter, SlidingLimiter, TokenIndex, sendError } from './util.js';
import { agentRoutes } from './agent.js';
import { portRoutes } from './port.js';
import { ownerRoutes } from './owner.js';
import { publicRoutes } from './public.js';
import { adminRoutes } from './admin.js';
import { snapshotRoutes } from './snapshots.js';
import { WorldSnapshots } from '../world-snapshots.js';
import { agentic } from '../e2/facade.js';
import { DEFAULT_AGENT_LOOP } from '../../runner/loop.js';
import { TraceStore } from '../runner/traces.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = join(HERE, '..', '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** index.html 的内容安全策略：界面脚本只能通过 CSSOM / classList / SVG 属性设置样式（SPEC §13） */
export const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'";

const ROUTES = [...accountRoutes, ...agentRoutes, ...portRoutes, ...ownerRoutes, ...publicRoutes, ...adminRoutes, ...snapshotRoutes, ...runnerRoutes];

function match(method, pathname) {
  for (const [m, pattern, handler] of ROUTES) {
    if (m !== method) continue;
    if (typeof pattern === 'string') {
      if (pattern === pathname) return { handler, params: [] };
    } else {
      const r = pattern.exec(pathname);
      if (r) return { handler, params: r.slice(1).map(decodeURIComponent) };
    }
  }
  return null;
}

async function serveStatic(req, res, pathname, dir) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (rel.includes('\0')) {
    res.writeHead(400).end();
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const full = normalize(join(dir, rel));
  if (full !== dir && !full.startsWith(dir + sep)) {
    res.writeHead(403).end(); // 路径穿越
    return;
  }
  try {
    let file = full;
    let st = await stat(file);
    if (st.isDirectory()) {
      file = join(file, 'index.html');
      st = await stat(file);
    }
    const body = await readFile(file);
    const ext = extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': body.length };
    if (ext === '.html') {
      headers['Content-Security-Policy'] = CSP;
      headers['Cache-Control'] = 'no-cache';
      headers['X-Content-Type-Options'] = 'nosniff';
    } else {
      headers['Cache-Control'] = 'no-cache';
      headers['X-Content-Type-Options'] = 'nosniff';
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

/**
 * 创建 HTTP 服务器（不监听）。返回 { server, ctx, close }。
 * @param rt Runtime
 * @param cfg 配置（loadConfig 的结果，另可带 trustProxy）
 */
export function createApp(rt, cfg, { publicDir = PUBLIC_DIR, logger = console, backstageRoot } = {}) {
  const ctx = {
    rt,
    cfg,
    accounts: new AccountStore(cfg.dataDir),
    snapshots: new WorldSnapshots(rt),
    accountLimits: accountLimits(),
    runners: new RunnerManager(rt, cfg),
    // 躯壳的运行时（SPEC-E2 §13）：第二纪的城且配置了 SHELLS_FILE 时才有；配置有问题会在这里抛出，服务器启动失败并说明原因
    shells: rt.engine.physics === 2 && cfg.shellsFile ? new ShellManager(rt, cfg, { logger }) : null,
    tokens: new TokenIndex(rt.w),
    limits: {
      agent: new PerTickLimiter(agentic(rt.w) ? 40 : 20), // 每个令牌每刻 20 个请求；第二前提 40：托管居民一刻里有多次感知与行动（SPEC-P2 §10.5）
      wait: new PerTickLimiter(60), // GET /api/me/wait 另计：每个令牌每刻 60 次，不占上面的额度（只在第二前提的城有这个接口）
      model: new SlidingLimiter(20, 60 * 60 * 1000), // 连接测试与入境次数分开计数
      port: new SlidingLimiter(5, 60 * 60 * 1000), // 注册、领养、过继：每个 IP 每小时 5 次
    },
    sse: { clients: new Set(), perIp: new Map(), total: 0 },
    cursors: new Map(), // agentId → 已经送达的最大收件 seq（内存，不进世界状态；Q9）
    cache: {},
  };

  // 第二前提的注意力上限（SPEC-P2 §4.4）：来自躯壳配置，没有躯壳配置时用缺省值；meCore 把它写进感知的 attention
  rt.agentLoop = (ctx.shells && ctx.shells.config.agentLoop) || DEFAULT_AGENT_LOOP;
  if (agentic(rt.w) && cfg.tickMs < 4 * rt.agentLoop.marginSec * 1000) {
    logger.warn?.(`第二前提：TICK_MS=${cfg.tickMs} 小于 4 × marginSec=${rt.agentLoop.marginSec} 秒，醒来的可用窗口很短；请检查刻长与截止余量。`);
  }

  // 注意力轨迹（SPEC-P2 §14.1）：只在第二前提的世界；躯壳管理器与托管运行器共用，两个接口从 ctx.traces 读
  ctx.traces = agentic(rt.w) ? new TraceStore({ file: join(rt.dir, 'agent-loops.jsonl'), timezone: cfg.shellTz }) : null;
  if (ctx.traces) {
    if (ctx.shells) ctx.shells.traces = ctx.traces;
    ctx.runners.traces = ctx.traces;
  }

  checkBackstage(rt, ctx.shells, { logger, ...(backstageRoot ? { root: backstageRoot } : {}) });

  ctx.experiment = new ExperimentControl(rt, ctx.runners, ctx.shells);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;
      const isPublicApi = pathname.startsWith('/api/public/');
      if (isPublicApi && req.method === 'GET') res.setHeader('Access-Control-Allow-Origin', '*'); // 只对 GET /api/public/* 开放
      if (isPublicApi && req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
      }
      if (pathname.startsWith('/api/')) {
        res.setHeader('X-Houren-Protocol', String(rt.engine.protocol)); // 协议版本随世界的物理（SPEC-E2 §2.1）
        const m = match(req.method, pathname);
        if (!m) return sendError(res, 'zh', 'not_found');
        await m.handler(req, res, ctx, url, m.params);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      await serveStatic(req, res, pathname, publicDir);
    } catch (e) {
      logger.error?.('HTTP 处理出错：', e);
      if (!res.headersSent) sendError(res, 'zh', 'internal');
      else res.end();
    }
  });
  server.on('listening', () => {
    const address = server.address();
    const host = address.address === '::' ? '[::1]' : address.address === '0.0.0.0' ? '127.0.0.1' : address.address.includes(':') ? `[${address.address}]` : address.address;
    ctx.runners.activate(`http://${host}:${address.port}`);
    if (ctx.shells) ctx.shells.activate();
  });
  // 慢速连接与保活：SSE 长连接由自己的心跳维持
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 20000;
  server.requestTimeout = 0;

  // SSE 心跳：每 20 秒一行注释，防止代理断开
  const heartbeat = setInterval(() => {
    for (const res of ctx.sse.clients) res.write(': ping\n\n');
  }, 20000);
  heartbeat.unref();

  return {
    server,
    ctx,
    async close() {
      ctx.experiment.close();
      if (ctx.shells) await ctx.shells.close();
      await ctx.runners.close();
      clearInterval(heartbeat);
      for (const res of ctx.sse.clients) res.end();
      ctx.sse.clients.clear();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
  };
}
