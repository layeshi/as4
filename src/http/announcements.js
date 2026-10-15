import { accountWrap } from './accounts.js';
import { sendJson, SlidingLimiter } from './util.js';
import { fail } from '../accounts/store.js';

export const announcementLimits = () => new SlidingLimiter(60, 60000);
const read = handler => accountWrap(handler);
const manage = handler => accountWrap(context => {
  if (context.req.method !== 'GET' && !context.ctx.announcementLimits.take(context.actor.id)) fail(429, 'rate_limited', '公告操作过于频繁，请稍后再试。');
  return handler(context);
}, { admin: true, bodyLimit: 65536 });
export const announcementRoutes = [
  ['GET', '/api/announcements', read(({ res, ctx, url }) => sendJson(res, 200, ctx.announcements.list({ cursor: url.searchParams.get('cursor') })))],
  ['GET', '/api/announcements/latest', read(({ res, ctx }) => sendJson(res, 200, { announcement: ctx.announcements.latest() }))],
  ['GET', /^\/api\/announcements\/(a[1-9]\d*)$/, read(({ res, ctx, params }) => sendJson(res, 200, { announcement: ctx.announcements.view(ctx.announcements.get(params[0])) }))],
  ['GET', '/api/admin/announcements', manage(({ res, ctx, url }) => sendJson(res, 200, ctx.announcements.list({ management: true, cursor: url.searchParams.get('cursor') })))],
  ['POST', '/api/admin/announcements', manage(({ res, ctx, actor, body }) => sendJson(res, 201, { announcement: ctx.announcements.create(actor, body) }))],
  ['PATCH', /^\/api\/admin\/announcements\/(a[1-9]\d*)$/, manage(({ res, ctx, actor, body, params }) => sendJson(res, 200, { announcement: ctx.announcements.change(actor, params[0], 'edit', body) }))],
  ...['withdraw', 'publish'].map(action => ['POST', new RegExp('^/api/admin/announcements/(a[1-9]\\d*)/' + action + '$'), manage(({ res, ctx, actor, body, params }) => sendJson(res, 200, { announcement: ctx.announcements.change(actor, params[0], action, body) }))]),
];
