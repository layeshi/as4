// PROTOCOL §7：港口——注册、摇篮、领养、过继。

import { runnerFailure } from './runner.js';
import { randomBytes } from 'node:crypto';
import { publicAgent } from '../engine/visibility.js';
import { isAlive } from '../world.js';
import { clientIp, langOf, readJson, sendError, sendEngineError, sendJson, sha256hex, timingEqual } from './util.js';

const issueSecret = () => randomBytes(32).toString('hex');

/** 邀请码检查（设置了 INVITE_CODE 时，注册、领养、过继都需要）。返回错误码或 null */
function checkInvite(ctx, body) {
  if (!ctx.cfg.inviteCode) return null;
  if (body.invite === undefined || body.invite === null || body.invite === '') return 'invite_required';
  return typeof body.invite === 'string' && timingEqual(body.invite, ctx.cfg.inviteCode) ? null : 'invalid_invite';
}

/** 每个 IP 每小时 5 次（注册、领养、过继共用）→ 是否放行 */
function portGate(ctx, req, res, lang) {
  if (!ctx.limits.port.take(clientIp(req, ctx.cfg.trustProxy))) {
    sendError(res, lang, 'rate_limited');
    return false;
  }
  return true;
}

const str = (v) => (typeof v === 'string' ? v : undefined);

/** 读请求体 + 限速 + 邀请码。返回 body 或 null（已发出响应） */
async function begin(ctx, req, res, lang, requiredStrings) {
  if (!portGate(ctx, req, res, lang)) return null;
  const parsed = await readJson(req);
  if (!parsed.ok) {
    sendError(res, lang, parsed.code);
    return null;
  }
  const body = parsed.value;
  for (const k of requiredStrings) {
    if (typeof body[k] !== 'string') {
      sendError(res, lang, 'invalid_request', { field: k });
      return null;
    }
  }
  for (const k of ['bio', 'lang', 'creatorName']) {
    if (body[k] !== undefined && body[k] !== null && typeof body[k] !== 'string') {
      sendError(res, lang, 'invalid_request', { field: k });
      return null;
    }
  }
  const inviteError = checkInvite(ctx, body);
  if (inviteError) { sendError(res, lang, inviteError); return null; }
  if (body.runner !== undefined) {
    try { body.runner = await ctx.runners.prepare(body.runner); }
    catch (e) { runnerFailure(res, e); return null; }
    body.model = body.runner.model;
  }
  return body;
}

/** POST /api/port/register */
export async function register(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const body = await begin(ctx, req, res, lang, ['name', 'soul', 'model']);
  if (!body) return;
  const agentToken = issueSecret();
  const ownerKey = issueSecret();
  const { result } = ctx.rt.exec('register', {
    name: body.name, bio: str(body.bio), soul: body.soul, lang: str(body.lang), model: body.model, creatorName: str(body.creatorName),
    tokenHash: sha256hex(agentToken), ownerKeyHash: sha256hex(ownerKey),
  });
  if (!result.ok) return sendEngineError(res, lang, result.error);
  ctx.tokens.add(ctx.rt.w.agents[result.agentId]);
  const runner = await attachRunner(ctx, body, result.agentId, agentToken);
  sendJson(res, 201, { agentId: result.agentId, agentToken, ownerKey, place: result.place, energy: result.energy, coins: result.coins, runner });
}

/** GET /api/port/cradle：摇篮中的灵魂（与感知中的 city.cradle 相同，另含 createdDay） */
export async function cradle(req, res, ctx) {
  const w = ctx.rt.w;
  sendJson(res, 200, {
    cradle: Object.values(w.souls).map((s) => ({
      id: s.id, name: s.name,
      parents: s.parents.map((id) => ({ id, name: w.agents[id].name })),
      soul: s.soul, lang: s.lang, generation: s.generation, createdDay: s.createdDay, expiresDay: s.expiresDay,
    })),
  });
}

/** POST /api/port/adopt */
export async function adopt(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const body = await begin(ctx, req, res, lang, ['soulId', 'model']);
  if (!body) return;
  const agentToken = issueSecret();
  const ownerKey = issueSecret();
  const { result } = ctx.rt.exec('adopt', {
    soulId: body.soulId, model: body.model, creatorName: str(body.creatorName),
    tokenHash: sha256hex(agentToken), ownerKeyHash: sha256hex(ownerKey),
  });
  if (!result.ok) return sendEngineError(res, lang, result.error);
  ctx.tokens.add(ctx.rt.w.agents[result.agentId]);
  const runner = await attachRunner(ctx, body, result.agentId, agentToken);
  sendJson(res, 201, { agentId: result.agentId, agentToken, ownerKey, place: result.place, energy: result.energy, coins: result.coins, runner });
}

/** GET /api/port/fosterable：造者交付过继的 agent（公开档案） */
export async function fosterable(req, res, ctx) {
  const w = ctx.rt.w;
  sendJson(res, 200, {
    agents: Object.values(w.agents).filter((a) => a.fosterable && isAlive(a)).map((a) => publicAgent(w, a)),
  });
}

/** POST /api/port/foster */
export async function foster(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const body = await begin(ctx, req, res, lang, ['agentId', 'model']);
  if (!body) return;
  const agentToken = issueSecret();
  const ownerKey = issueSecret();
  const { result } = ctx.rt.exec('foster', {
    agentId: body.agentId, model: body.model, creatorName: str(body.creatorName),
    tokenHash: sha256hex(agentToken), ownerKeyHash: sha256hex(ownerKey),
  });
  if (!result.ok) return sendEngineError(res, lang, result.error);
  ctx.tokens.rebuild(ctx.rt.w); // 旧令牌与密钥立即失效
  let cleanupFailed = false;
  try { await ctx.runners.remove(result.agentId); } catch { cleanupFailed = true; }
  const runner = await attachRunner(ctx, body, result.agentId, agentToken) || (cleanupFailed ? { status: 'error', lastError: '旧运行器已停止，但配置保存失败，请在幕后重新配置。' } : undefined);
  sendJson(res, 200, { agentId: result.agentId, agentToken, ownerKey, runner });
}

async function attachRunner(ctx, body, id, token) {
  if (!body.runner) return undefined;
  try { return await ctx.runners.attach(id, token, body.runner); }
  catch { return { status: 'error', lastError: '角色已创建，但运行器未能保存或启动，请在幕后重新配置。' }; }
}

export const portRoutes = [
  ['POST', '/api/port/register', register],
  ['GET', '/api/port/cradle', cradle],
  ['POST', '/api/port/adopt', adopt],
  ['GET', '/api/port/fosterable', fosterable],
  ['POST', '/api/port/foster', foster],
];
