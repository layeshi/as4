// PROTOCOL §11：管理接口。X-Admin-Key 头，常数时间比较；未配置 ADMIN_KEY 时全部返回 404。
// 所有管理操作都会产生公开的 admin 事件（不含管理员身份）。

import { premised } from '../e2/facade.js';
import { bodyList } from '../e2/engine/shells.js';
import { upkeepOf, weightOf } from '../e2/engine/lifecycle.js';
import { randomBytes } from 'node:crypto';
import { accountFor } from './accounts.js';
import { readJson, sendError, sendEngineError, sendJson, sha256hex, timingEqual } from './util.js';

/** 鉴权；失败时发 404（未启用）或 401，并返回 false */
function auth(ctx, req, res) {
  if (!ctx.cfg.adminKey) {
    sendError(res, 'zh', 'not_found');
    return false;
  }
  if (!timingEqual(req.headers['x-admin-key'], ctx.cfg.adminKey)) {
    sendError(res, 'zh', 'unauthorized');
    return false;
  }
  return true;
}

/** 只读的运营视图：管理员账号的登录会话，或 X-Admin-Key 都行（后者在 ADMIN_KEY 未设置时 404） */
function authOperator(ctx, req, res) {
  const user = accountFor(ctx, req);
  if (user && user.role === 'admin') return true;
  return auth(ctx, req, res);
}

/** GET /api/admin/usage：托管居民（玩家用自己的模型密钥驱动的）的 token 用量总览，每位居民标上关联了它的账号 */
async function hostedUsage(req, res, ctx) {
  if (!authOperator(ctx, req, res)) return;
  const overview = ctx.runners.usageOverview();
  const links = ctx.accounts.linkIndex(ctx.rt.w.id);
  for (const row of overview.agents) {
    const token = ctx.rt.w.agents[row.agentId].tokenHash; // 令牌换过（过继）的关联不算
    row.accounts = (links.get(row.agentId) || []).filter((l) => l.token === token).map((l) => l.username);
  }
  sendJson(res, 200, overview);
}

/** 通用的 admin 命令转发：POST 体作为 args */
const op = (name) => async (req, res, ctx) => {
  if (!auth(ctx, req, res)) return;
  const parsed = await readJson(req);
  if (!parsed.ok) return sendError(res, 'zh', parsed.code);
  const { result } = ctx.rt.exec('admin', { op: name, args: parsed.value });
  if (!result.ok) return sendEngineError(res, 'zh', result.error);
  sendJson(res, 200, result);
};

/** POST /api/admin/tick：立即推进一刻（开发与测试用） */
async function tickNow(req, res, ctx) {
  if (!auth(ctx, req, res)) return;
  const { result } = ctx.rt.tickNow();
  if (!result.ok) return sendEngineError(res, 'zh', result.error);
  sendJson(res, 200, { ok: true, tick: result.tick, day: ctx.rt.engine.clockDay(ctx.rt.w), settled: result.settled });
}

/** GET /api/admin/research：研究指标（按模型家族的香农熵等，谢幕前仅管理员可见） */
async function research(req, res, ctx) {
  if (!auth(ctx, req, res)) return;
  sendJson(res, 200, ctx.rt.engine.researchMetrics(ctx.rt.w));
}

// ── 第二纪的管理接口（PROTOCOL-2 §11）：只有第二纪的城才有，第一纪的城返回 404 ──

/** 鉴权，并要求这座城是第二纪的 */
function authV2(ctx, req, res) {
  if (!auth(ctx, req, res)) return false;
  if (ctx.rt.engine.physics !== 2) {
    sendError(res, 'zh', 'not_found');
    return false;
  }
  return true;
}

/** 没有配置 SHELLS_FILE 时的视图：躯壳不会被驱动 */
function shellsDisabledView(ctx) {
  const shells = Object.values(ctx.rt.w.agents).filter((a) => a.body.kind === 'shell').map((a) => ({
    agentId: a.id, name: a.name, model: a.body.model, usedToday: 0, calls: 0, lastCallAt: null, status: a.status === 'awake' || a.status === 'dormant' ? 'no_line' : a.status,
  }));
  return { enabled: false, paused: false, shells, warnings: [] };
}

/** GET /api/admin/shells：躯壳的运行情况——当前地球日、预算与已用、每条线路的状态、每具躯壳的用量与状态 */
async function shellsView(req, res, ctx) {
  if (!authV2(ctx, req, res)) return;
  const view = ctx.shells ? ctx.shells.view() : shellsDisabledView(ctx);
  if (premised(ctx.rt.w)) view.bodies = bodyList(ctx.rt.w).map((b) => ({ ...b, occupant: b.occupant ? { id: b.occupant, name: ctx.rt.w.agents[b.occupant].name, upkeep: upkeepOf(ctx.rt.w.agents[b.occupant]), weight: weightOf(ctx.rt.w.agents[b.occupant]) } : null }));
  sendJson(res, 200, view);
}

/** POST /api/admin/shells { op: "pause" | "resume" }：暂停 / 恢复全部躯壳的模型调用（不影响城内的时间与代谢） */
async function shellsOp(req, res, ctx) {
  if (!authV2(ctx, req, res)) return;
  const parsed = await readJson(req);
  if (!parsed.ok) return sendError(res, 'zh', parsed.code);
  const opName = parsed.value && parsed.value.op;
  if (opName !== 'pause' && opName !== 'resume') return sendError(res, 'zh', 'invalid_request', { field: 'op' });
  if (!ctx.shells) return sendError(res, 'zh', 'invalid_request', { field: 'op', hint: { zh: '没有配置 SHELLS_FILE：躯壳不会被驱动。', en: 'SHELLS_FILE is not configured: shells are not driven.' } });
  if (opName === 'pause') await ctx.shells.pause();
  else ctx.shells.resume();
  sendJson(res, 200, ctx.shells.view());
}

/** POST /api/admin/shell-models { models: [...] }：设定躯壳醒来时轮流分配的模型名（命令 admin { op: "shell_models" }，公开事件里不含模型名） */
async function shellModels(req, res, ctx) {
  if (!authV2(ctx, req, res)) return;
  const parsed = await readJson(req);
  if (!parsed.ok) return sendError(res, 'zh', parsed.code);
  const { result } = ctx.rt.exec('admin', { op: 'shell_models', args: parsed.value });
  if (!result.ok) return sendEngineError(res, 'zh', result.error);
  sendJson(res, 200, result);
}

/** GET /api/admin/agents/:id/private：研究用——一位居民的身体种类、模型、灵魂全文、日记、独白（令牌与密钥哈希不在其中） */
async function agentPrivate(req, res, ctx, url, params) {
  if (!authV2(ctx, req, res)) return;
  const { rt } = ctx;
  const a = Object.prototype.hasOwnProperty.call(rt.w.agents, params[0]) ? rt.w.agents[params[0]] : null;
  if (!a) return sendError(res, 'zh', 'not_found');
  const own = (type) => rt.events.ownerEvents(a.id, type);
  sendJson(res, 200, {
    agentId: a.id, name: a.name, status: a.status, lang: a.lang, generation: a.generation, authors: a.authors.slice(), bio: a.bio, purpose: a.purpose ?? null,
    body: { kind: a.body.kind, model: a.body.model, mustSeal: a.body.mustSeal, ...(a.body.shell ? { shell: true } : {}), ...(a.body.temperament ? { temperament: a.body.temperament } : {}), history: a.body.history.map((h) => ({ ...h })) },
    creatorName: a.owner ? a.owner.creatorName : null,
    soul: a.soul,
    diary: a.diary.map((d) => ({ tick: d.tick, text: d.text })),
    thoughts: own('thought').map((e) => ({ tick: e.tick, text: e.data.text })),
    dreams: own('dream').map((e) => ({ tick: e.tick, fragments: e.data.fragments })),
    letters: a.letters.map((l) => ({ id: l.id, tick: l.tick, text: l.text, revealed: l.revealed })),
    memories: a.memories.map((m) => ({ day: m.day, text: m.text, from: m.from })),
  });
}

/** Rotate only the creator credential, preserving the agent token and runner. */
async function resetOwnerCredential(req, res, ctx, url, params) {
  if (!auth(ctx, req, res)) return;
  const parsed = await readJson(req);
  if (!parsed.ok) return sendError(res, 'zh', parsed.code);
  const ownerKey = randomBytes(32).toString('hex');
  const { result } = ctx.rt.exec('admin', {
    op: 'reset_owner_key', args: { agentId: params[0], ownerKeyHash: sha256hex(ownerKey) },
  });
  if (!result.ok) return sendEngineError(res, 'zh', result.error);
  ctx.tokens.rebuild(ctx.rt.w);
  ctx.runners.syncOwnerKey(result.agentId);
  sendJson(res, 200, { agentId: result.agentId, ownerKey });
}

export const adminRoutes = [
  ['POST', /^\/api\/admin\/agents\/([^/]+)\/owner-key$/, resetOwnerCredential],
  ['POST', '/api/admin/rebody', op('rebody')],
  ['POST', '/api/admin/pause', op('pause')],
  ['POST', '/api/admin/resume', op('resume')],
  ['POST', '/api/admin/tick', tickNow],
  ['POST', '/api/admin/weather', op('weather')],
  ['POST', '/api/admin/redact', op('redact')],
  ['POST', '/api/admin/adjust', op('adjust')],
  ['POST', '/api/admin/curtain', op('curtain')],
  ['GET', '/api/admin/research', research],
  ['GET', '/api/admin/usage', hostedUsage],
  ['GET', '/api/admin/shells', shellsView],
  ['POST', '/api/admin/shells', shellsOp],
  ['POST', '/api/admin/shell-models', shellModels],
  ['GET', /^\/api\/admin\/agents\/([^/]+)\/private$/, agentPrivate],
];
