import { accountWrap } from './accounts.js';
import { wechatIdentity } from './wechat.js';
import { sendJson } from './util.js';
const wrap = handler => accountWrap(handler, { signedIn: true });
const appid = (ctx, value) => value || ctx.wechat.miniprogram?.appid || ctx.wechat.appid;
export const notificationRoutes = [
  ['GET', '/api/wechat/notifications', wrap(({ req, res, ctx, url, actor }) => {
    sendJson(res, 200, ctx.notifications.get(actor.id, appid(ctx, url.searchParams.get('appid')), wechatIdentity(ctx, req)));
  })],
  ['POST', '/api/wechat/notifications/preferences', wrap(({ req, res, ctx, body, actor }) => {
    ctx.notifications.preferences(actor.id, appid(ctx, body.appid), body.agentId, body.types, wechatIdentity(ctx, req));
    sendJson(res, 200, { ok: true });
  })],
  ['POST', '/api/wechat/notifications/authorization', wrap(({ req, res, ctx, body, actor }) => {
    sendJson(res, 200, ctx.notifications.authorization(actor.id, appid(ctx, body.appid), body.types, wechatIdentity(ctx, req)));
  })],
  ['POST', '/api/wechat/notifications/authorization/result', wrap(({ res, ctx, body, actor }) => {
    ctx.notifications.authorizationResult(actor.id, body.ticket, body.results);
    sendJson(res, 200, { ok: true });
  })],
  ['GET', '/api/wechat/notifications/records', wrap(({ res, ctx, url, actor }) => {
    sendJson(res, 200, ctx.notifications.records(actor.id, { limit: url.searchParams.get('limit'), before: url.searchParams.get('before') }));
  })],
  ['POST', '/api/wechat/notifications/records/read', wrap(({ res, ctx, body, actor }) => {
    ctx.notifications.read(actor.id, body.ids);
    sendJson(res, 200, { ok: true });
  })],
];
