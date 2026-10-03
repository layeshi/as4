import { bearer, clientIp, langOf, readJson, sendError, sendJson, timingEqual } from './util.js';
import { RunnerError } from '../runner/manager.js';
import { PROVIDER_NAMES } from '../../runner/providers.js';

export function runnerFailure(res, error) {
  sendJson(res, error instanceof RunnerError ? error.status : 500, { error: { code: 'runner_error', message: error instanceof RunnerError ? error.message : '运行配置无法保存，请稍后重试。' } });
}
export const runnerRoutes = [
  ['GET', '/api/port/model', (req, res, ctx) => sendJson(res, 200, { providers: PROVIDER_NAMES, allowLocalModels: ctx.cfg.allowLocalModels === true })],
  ['POST', '/api/port/model', async (req, res, ctx, url) => {
    const lang = langOf(url.searchParams);
    if (!ctx.limits.model.take(clientIp(req, ctx.cfg.trustProxy))) return sendError(res, lang, 'rate_limited');
    const parsed = await readJson(req);
    if (!parsed.ok) return sendError(res, lang, parsed.code);
    if (ctx.cfg.inviteCode && (typeof parsed.value.invite !== 'string' || !timingEqual(parsed.value.invite, ctx.cfg.inviteCode))) return sendError(res, lang, 'invalid_invite');
    try { await ctx.runners.prepare(parsed.value); sendJson(res, 200, { ok: true }); }
    catch (e) { runnerFailure(res, e); }
  }],
  ['GET', '/api/owner/runner', async (req, res, ctx, url) => {
    const id = ctx.tokens.ownerFor(ctx.rt.w, bearer(req));
    if (!id) return sendError(res, langOf(url.searchParams), 'unauthorized');
    sendJson(res, 200, ctx.runners.view(id));
  }],
  // Token usage of the resident this owner key belongs to. Only the server-driven (hosted) runner can be metered:
  // `tracked: false` means the server never sees this resident's model calls.
  ['GET', '/api/owner/usage', async (req, res, ctx, url) => {
    const id = ctx.tokens.ownerFor(ctx.rt.w, bearer(req));
    if (!id) return sendError(res, langOf(url.searchParams), 'unauthorized');
    sendJson(res, 200, { agentId: id, name: ctx.rt.w.agents[id].name, ...ctx.runners.usageView(id) });
  }],
  ['POST', '/api/owner/runner', async (req, res, ctx, url) => {
    const lang = langOf(url.searchParams), id = ctx.tokens.ownerFor(ctx.rt.w, bearer(req));
    if (!id) return sendError(res, lang, 'unauthorized');
    if (!ctx.limits.agent.take(`owner-runner:${id}`, ctx.rt.w.clock.tick)) return sendError(res, lang, 'rate_limited');
    const parsed = await readJson(req);
    if (!parsed.ok) return sendError(res, lang, parsed.code);
    const body = parsed.value;
    try {
      const current = ctx.runners.valid(id) ? ctx.runners.records[id] : null;
      if (body.op === 'pause') return sendJson(res, 200, await ctx.runners.pause(id));
      if (body.op === 'start') return sendJson(res, 200, ctx.runners.start(id));
      if (!['test', 'save'].includes(body.op)) throw new RunnerError('运行操作无效。');
      const config = await ctx.runners.prepare(body.config, current?.config);
      // Credentials may have rotated while the connection test was in progress.
      if (ctx.tokens.ownerFor(ctx.rt.w, bearer(req)) !== id) return sendError(res, lang, 'unauthorized');
      if (body.op === 'test') return sendJson(res, 200, { ok: true });
      const token = current?.token || body.agentToken;
      if (typeof token !== 'string' || ctx.tokens.agentFor(ctx.rt.w, token) !== id) throw new RunnerError('请提供该居民的有效 agent 令牌。');
      sendJson(res, 200, await ctx.runners.attach(id, token, config, current?.enabled ?? false));
    } catch (e) { runnerFailure(res, e); }
  }],
];
