// PROTOCOL §3、§4：agent 接口——感知与行动。

import { errorMessage } from '../lore/index.js';
import { LIMITS } from '../params.js';
import { bearer, errorBody, httpStatusFor, langOf, readJson, sendError, sendJson } from './util.js';

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

/**
 * 感知的核心（HTTP 与躯壳的进程内客户端共用）。
 * GET 不是命令，不能改动世界状态（Q9）：「自动确认」只推进内存游标 cursors；世界状态里的游标在 act 命令里推进
 * （命令携带 ackSeq，进入命令日志，回放才一致）。服务器重启后内存游标归零，多送几条收件——「至少一次」。
 * after 缺省时推进内存游标；显式给出时不推进。
 */
export function meCore({ rt, cursors }, id, { lang, after }) {
  const floor = cursors.get(id) || 0;
  const p = rt.engine.buildPerception(rt.w, id, { lang, after, floor, ack: false, nextTickAt: rt.nextTickAt });
  if (after === undefined && p.inboxCursor !== undefined && p.inboxCursor > floor) cursors.set(id, p.inboxCursor);
  return p;
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
  sendJson(res, 200, meCore(ctx, id, { lang, after }));
}

/**
 * 行动的核心（HTTP 与躯壳的进程内客户端共用）：校验请求、提交 act 命令、把动作级错误按语言写成 { code, message, … }。
 * 返回 { status, json }：成功是 200 { ok: true, results, you }，请求级错误是对应的 HTTP 状态与错误体。
 * 不合法的请求不进命令日志。
 */
export function actCore({ rt, cursors }, id, body, lang) {
  const protocol = rt.engine.protocol;
  const fail = (code, extra = {}) => ({ status: httpStatusFor(code), json: errorBody(lang, code, extra, protocol) });
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return fail('invalid_request');
  if (!Array.isArray(body.actions) || body.actions.length > LIMITS.actionsPerRequest || body.actions.some((a) => a === null || typeof a !== 'object' || Array.isArray(a))) {
    return fail('invalid_request', { field: 'actions' });
  }
  if (body.thought !== undefined && body.thought !== null && typeof body.thought !== 'string') {
    return fail('invalid_request', { field: 'thought' });
  }
  const w = rt.w;
  const a = w.agents[id];
  if (w.paused) return fail('paused');
  if (a.status !== 'awake') return fail('not_awake', { status: a.status });
  // ackSeq：这位 agent 到此刻为止已经被送达的最大收件序号（由内存游标而来）
  const payload = { agentId: id, thought: body.thought ?? undefined, actions: body.actions, ackSeq: cursors.get(id) || 0 };
  // 第二纪：请求的语言进入命令（draft 的说明、read { law } 的读法按它取），所以回放一致；第一纪的命令载荷不变
  if (protocol === 2) payload.lang = lang;
  const { result } = rt.exec('act', payload);
  if (!result.ok) {
    const { code, ...extra } = result.error;
    return fail(code, extra);
  }
  const results = result.results.map((r) => {
    if (r.ok) return r;
    const { hint, ...err } = r.error;
    // 第二纪的错误带结构化的附加字段（forbidden 的 law / reason，no_module 的 module，gated 的 place，cooldown 的 untilDay，rule_invalid 的 issues）
    if (protocol === 2) return { ...r, error: { ...errorBody(lang, err.code, { hint, ...err }, 2).error } };
    return { ...r, error: { code: err.code, message: hint?.[lang] ?? errorMessage(lang, err.code) } };
  });
  return { status: 200, json: { ok: true, results, you: result.you } };
}

/** POST /api/me/act */
export async function postAct(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const id = authAgent(ctx, req, res, lang);
  if (!id) return;
  const parsed = await readJson(req);
  if (!parsed.ok) return sendError(res, lang, parsed.code);
  const r = actCore(ctx, id, parsed.value, lang);
  sendJson(res, r.status, r.json);
}

export const agentRoutes = [
  ['GET', '/api/me', getMe],
  ['POST', '/api/me/act', postAct],
];
