import { lawProtectionView } from '../e2/engine/law-semantics.js';
// PROTOCOL §3、§4：agent 接口——感知与行动。

import { errorMessage } from '../lore/index.js';
import { actionFeedback } from '../action-feedback.js';
import { LIMITS } from '../params.js';
import { agentic, wakeItems } from '../e2/facade.js';
import { DEFAULT_AGENT_LOOP } from '../../runner/loop.js';
import { validateAction } from '../../runner/action-tools.js';
import { bearer, errorBody, httpStatusFor, langOf, readJson, sendError, sendJson } from './util.js';

/** 验证 agent 令牌；失败时发 401 并返回 null。limiter：限速器（缺省每刻 20 个请求，第二前提 40；GET /api/me/wait 用自己的，SPEC-P2 §10.5） */
export function authAgent(ctx, req, res, lang, limiter = ctx.limits.agent) {
  const id = ctx.tokens.agentFor(ctx.rt.w, bearer(req));
  if (!id) {
    sendError(res, lang, 'unauthorized');
    return null;
  }
  // 每个令牌每刻最多 20 个请求（SPEC §13）
  if (!limiter.take(id, ctx.rt.w.clock.tick)) {
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
  if (rt.engine.physics === 2 && p.city && rt.events?.fiscal) p.city.ruleDiagnostics = rt.events.fiscal.diagnostics(rt.w);
  // 第二前提：平台的运行器每刻执行的上限（运行时的配置，不是世界状态；SPEC-P2 §4.4）。躯壳的进程内客户端走同一个 meCore，所以三种客户端看到同一组数
  if (agentic(rt.w) && p.you && p.you.status === 'awake') p.attention = { ...(rt.agentLoop || DEFAULT_AGENT_LOOP) };
  if (after === undefined && p.inboxCursor !== undefined && p.inboxCursor > floor) cursors.set(id, p.inboxCursor);
  if (rt.w.experimentControl && p.now) p.now.experimentGeneration = rt.w.experimentControl.generation;
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
  if (w.paused) return fail('paused', lawProtectionView(w) ? { reason: 'law_execution_fault', diagnostics: lawProtectionView(w) } : {});
  if ((w.experimentControl || body.experimentGeneration !== undefined) && (!Number.isSafeInteger(body.experimentGeneration) || body.experimentGeneration !== (w.experimentControl?.generation ?? 0))) {
    return { status: 409, json: { error: { code: 'stale_perception', message: lang === 'en' ? 'The experiment was paused. Read a fresh perception before acting.' : '实验曾被暂停，请重新感知后行动。' } } };
  }
  if (a.status !== 'awake') return fail('not_awake', { status: a.status });
  if (body.actionTools !== undefined && !['legacy', 'typed'].includes(body.actionTools)) return fail('invalid_request', { field: 'actionTools' });
  if (body.actionTools === 'typed') {
    if (!agentic(w)) return fail('invalid_request', { field: 'actionTools' });
    const p = rt.engine.buildPerception(w, id, { lang, ack: false });
    for (let i = 0; i < body.actions.length; i++) {
      const issues = validateAction(body.actions[i], p);
      if (issues.length) return fail('invalid_request', { field: `actions[${i}]`, issues });
    }
  }
  // ackSeq：这位 agent 到此刻为止已经被送达的最大收件序号（由内存游标而来）
  const payload = { agentId: id, thought: body.thought ?? undefined, actions: body.actions, ackSeq: cursors.get(id) || 0 };
  // 第二纪：请求的语言进入命令（draft 的说明、read { law } 的读法按它取），所以回放一致；第一纪的命令载荷不变
  if (protocol === 2) payload.lang = lang;
  const { result } = rt.exec('act', payload);
  if (!result.ok) {
    const { code, ...extra } = result.error;
    return fail(code, extra);
  }
  // 第二前提的反馈（F4、F5b，SPEC-P2 §13）要知道设定版本与原来的动作；其余的世界两者都不看，结果逐字节不变
  const feedback = (r) => actionFeedback(r, lang, { premise: w.premise || 0, act: body.actions[r.index] });
  const results = result.results.map((r) => {
    if (r.ok) return protocol === 2 ? feedback(r) : r;
    const { hint, ...err } = r.error;
    // 第二纪的错误带结构化的附加字段（forbidden 的 law / reason，no_module 的 module，gated 的 place，cooldown 的 untilDay，rule_invalid 的 issues）
    if (protocol === 2) return feedback({ ...r, error: { ...errorBody(lang, err.code, { hint, ...err }, 2).error } });
    return { ...r, error: { code: err.code, message: hint?.[lang] ?? errorMessage(lang, err.code) } };
  });
  return { status: 200, json: { ok: true, results, you: result.you } };
}

/**
 * 等待会叫醒的收件（SPEC-P2 §6.3、§6.4）：HTTP 的 GET /api/me/wait、躯壳的进程内客户端与托管运行器共用。
 * 返回 Promise<{ items, cursor, status? }>：
 *   居民不醒着：立即返回 { items: [], cursor: after, status }；
 *   已有 seq > after 的会叫醒的收件：立即返回它们与其中最大的序号；
 *   否则订阅 rt.onWake，收到本居民的通知就重新取并返回；到时（或 signal 中止）返回 { items: [], cursor: after }。
 * 不推进任何游标（GET 不是命令）；返回过的收件之后照样出现在感知里。
 */
export function waitCore(rt, id, { after, timeoutMs = 25000, signal, lang = 'zh' } = {}) {
  const a = rt.w.agents[id];
  if (!a || a.status !== 'awake') return Promise.resolve({ items: [], cursor: after, status: a ? a.status : 'unknown' });
  const result = (items) => ({ items, cursor: items[items.length - 1].seq });
  const found = wakeItems(rt.w, id, after, lang);
  if (found.length) return Promise.resolve(result(found));
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    let off = () => {};
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(r);
    };
    const onAbort = () => finish({ items: [], cursor: after });
    off = rt.onWake((n) => {
      if (n.agentId !== id || n.seq <= after) return;
      const items = wakeItems(rt.w, id, after, lang);
      if (items.length) finish(result(items));
    });
    timer = setTimeout(() => finish({ items: [], cursor: after }), timeoutMs);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/** GET /api/me/wait?after=&timeoutMs=&lang=（只在第二前提的城；限速单独计数） */
export async function getWait(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const id = authAgent(ctx, req, res, lang, ctx.limits.wait);
  if (!id) return;
  if (!agentic(ctx.rt.w)) return sendError(res, lang, 'not_found');
  const raw = url.searchParams.get('after');
  if (raw === null || !/^\d{1,15}$/.test(raw)) return sendError(res, lang, 'invalid_request', { field: 'after' });
  let timeoutMs = 25000;
  const rawTimeout = url.searchParams.get('timeoutMs');
  if (rawTimeout !== null) {
    if (!/^\d{1,6}$/.test(rawTimeout) || Number(rawTimeout) < 1000 || Number(rawTimeout) > 50000) return sendError(res, lang, 'invalid_request', { field: 'timeoutMs' });
    timeoutMs = Number(rawTimeout);
  }
  const ac = new AbortController();
  res.on('close', () => ac.abort()); // 连接关闭：取消订阅、清掉计时器（响应发出之后再中止是空操作）
  const r = await waitCore(ctx.rt, id, { after: Number(raw), timeoutMs, signal: ac.signal, lang });
  if (!res.destroyed && !res.writableEnded) sendJson(res, 200, r);
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
  ['GET', '/api/me/wait', getWait],
  ['POST', '/api/me/act', postAct],
];
