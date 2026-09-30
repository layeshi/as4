// PROTOCOL §3、§4：agent 接口——感知与行动。

import { buildPerception } from '../engine/perception.js';
import { errorMessage } from '../lore/index.js';
import { LIMITS } from '../params.js';
import { bearer, langOf, readJson, sendError, sendEngineError, sendJson } from './util.js';

/** 验证 agent 令牌；失败时发 401 并返回 null */
export function authAgent(ctx, req, res, lang) {
  const id = ctx.tokens.agentFor(ctx.rt.w, bearer(req));
  if (!id) {
    sendError(res, lang, 'unauthorized');
    return null;
  }
  // 每个令牌每刻最多 20 个请求（SPEC §13）
  if (!ctx.limits.agent.take(id, ctx.rt.w.clock.tick)) {
    sendError(res, lang, 'rate_limited');
    return null;
  }
  return id;
}

/** GET /api/me?lang=&after= */
export async function getMe(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const id = authAgent(ctx, req, res, lang);
  if (!id) return;
  let after;
  const raw = url.searchParams.get('after');
  if (raw !== null) {
    if (!/^\d{1,15}$/.test(raw)) return sendError(res, lang, 'invalid_request', { field: 'after' });
    after = Number(raw);
  }
  // GET 不是命令，不能改动世界状态（Q9）：「自动确认」只推进 HTTP 层的内存游标；
  // 世界状态里的游标在 act 命令里推进（命令携带 ackSeq，进入命令日志，回放才一致）。
  // 服务器重启后内存游标归零，多送几条收件——「至少一次」。
  const floor = ctx.cursors.get(id) || 0;
  const p = buildPerception(ctx.rt.w, id, { lang, after, floor, ack: false, nextTickAt: ctx.rt.nextTickAt });
  if (after === undefined && p.inboxCursor !== undefined && p.inboxCursor > floor) ctx.cursors.set(id, p.inboxCursor);
  sendJson(res, 200, p);
}

/** POST /api/me/act */
export async function postAct(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const id = authAgent(ctx, req, res, lang);
  if (!id) return;
  const parsed = await readJson(req);
  if (!parsed.ok) return sendError(res, lang, parsed.code);
  const body = parsed.value;
  if (!Array.isArray(body.actions) || body.actions.length > LIMITS.actionsPerRequest || body.actions.some((a) => a === null || typeof a !== 'object' || Array.isArray(a))) {
    return sendError(res, lang, 'invalid_request', { field: 'actions' });
  }
  if (body.thought !== undefined && body.thought !== null && typeof body.thought !== 'string') {
    return sendError(res, lang, 'invalid_request', { field: 'thought' });
  }
  const w = ctx.rt.w;
  const a = w.agents[id];
  // 不合法的请求不进命令日志
  if (w.paused) return sendError(res, lang, 'paused');
  if (a.status !== 'awake') return sendError(res, lang, 'not_awake', { status: a.status });
  // ackSeq：这位 agent 到此刻为止已经被送达的最大收件序号（由 HTTP 层的内存游标而来）
  const { result } = ctx.rt.exec('act', { agentId: id, thought: body.thought ?? undefined, actions: body.actions, ackSeq: ctx.cursors.get(id) || 0 });
  if (!result.ok) return sendEngineError(res, lang, result.error);
  const results = result.results.map((r) => {
    if (r.ok) return r;
    const { hint, ...err } = r.error;
    return { ...r, error: { code: err.code, message: hint?.[lang] ?? errorMessage(lang, err.code) } };
  });
  sendJson(res, 200, { ok: true, results, you: result.you });
}

export const agentRoutes = [
  ['GET', '/api/me', getMe],
  ['POST', '/api/me/act', postAct],
];
