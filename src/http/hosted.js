import { accountWrap } from './accounts.js';
import { sendJson } from './util.js';
import { fail } from '../accounts/store.js';
import { RunnerError } from '../runner/manager.js';

const wrap = (fn, admin = false) => accountWrap(async args => {
  try { await fn(args); }
  catch (e) { if (e instanceof RunnerError) fail(e.status, 'hosted_config', e.message); throw e; }
}, admin ? { admin: true } : { signedIn: true });

export const hostedRoutes = [
  ['GET', '/api/account/hosted', wrap(({ res, ctx, actor }) => sendJson(res, 200, ctx.hosted.accountView(actor.id)))],
  ['POST', '/api/account/hosted/requests', wrap(({ res, ctx, actor, body }) => sendJson(res, 200, { request: ctx.hosted.billing.request(actor.id, body) }))],
  ['POST', /^\/api\/account\/hosted\/requests\/([^/]+)\/cancel$/, wrap(({ res, ctx, actor, params }) => sendJson(res, 200, { request: ctx.hosted.billing.cancel(params[0], actor.id) }))],
  ['GET', '/api/admin/hosted', wrap(({ res, ctx }) => sendJson(res, 200, ctx.hosted.adminView()), true)],
  ['POST', '/api/admin/hosted/config', wrap(async ({ res, ctx, body, authorize }) => sendJson(res, 200, await ctx.hosted.save(body, authorize)), true)],
  ['POST', '/api/admin/hosted/test', wrap(async ({ res, ctx, body, authorize }) => { const result = await ctx.hosted.test(body); authorize(); sendJson(res, 200, result); }, true)],
  ['POST', /^\/api\/admin\/hosted\/requests\/([^/]+)\/(approve|reject)$/, wrap(({ res, ctx, actor, params, body }) => sendJson(res, 200, { request: ctx.hosted.billing.decide(params[0], actor.id, params[1] === 'approve', body) }), true)],
  ['POST', '/api/admin/hosted/adjust', wrap(({ res, ctx, actor, body }) => {
    if (typeof body.username !== 'string') fail(400, 'invalid_username', '请填写用户名。');
    const user = ctx.accounts.data.users.find(u => u.username === body.username.trim().toLowerCase());
    if (!user) fail(404, 'not_found', '账号不存在。');
    const entry = ctx.hosted.billing.adjust(user.id, body.amountMicro, actor.id, body.note);
    sendJson(res, 200, { entry, balanceMicro: ctx.hosted.billing.balance(user.id) });
  }, true)],
];
