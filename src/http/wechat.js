import { residentRoutes } from './residents.js';
import { publicRoutes } from './public.js';
import { accountWrap, accountFor, setSession } from './accounts.js';
import { fail, publicUser } from '../accounts/store.js';
import { clientIp, parseCookies, sendJson } from './util.js';
import { identityHash } from '../wechat/service.js';
export function wechatIdentity(ctx, req) {
  return ctx.accounts.sessionMetadata(parseCookies(req.headers.cookie).houren_session)?.wechat;
}
const publicPath = /^\/api\/public\/(?:state|map|events|chronicle|(?:agents|places|laws|docs)\/[^/]+)$/;
export const wechatRoutes = [
  ['GET', /^\/api\/wechat\/public\/(.+)$/, accountWrap(async ({ req, res, ctx, url }) => {
    const target = '/api/public/' + url.pathname.slice('/api/wechat/public/'.length);
    if (!publicPath.test(target)) fail(404, 'not_found', '接口不存在。');
    let matched, params;
    for (const [method, pattern, handler] of publicRoutes) {
      if (method !== 'GET') continue;
      const match = typeof pattern === 'string' ? pattern === target && [] : pattern.exec(target);
      if (match) { matched = handler; params = typeof pattern === 'string' ? [] : match.slice(1).map(decodeURIComponent); break; }
    }
    if (!matched) fail(404, 'not_found', '接口不存在。');
    let status, payload;
    const capture = {
      getHeader: name => res.getHeader(name),
      writeHead: code => { status = code; },
      end: data => { payload = JSON.parse(data); }
    };
    const originalUrl = new URL(url); originalUrl.pathname = target;
    await matched(req, capture, ctx, originalUrl, params);
    if (!status || !payload) fail(503, 'unavailable', '内容暂不可用。');
    // The raw public response never reaches this client. Checks run outside the world log.
    sendJson(res, status, ctx.wechatProjection.filter(payload, wechatIdentity(ctx, req)));
  })],
  ['GET', /^\/api\/wechat\/residents(?:\/([^/]+)(?:\/(private))?)?$/, accountWrap(async ({ req, res, ctx, url }) => {
    const target = '/api/account/residents' + url.pathname.slice('/api/wechat/residents'.length);
    let matched, params;
    for (const [method, pattern, handler] of residentRoutes) {
      if (method !== 'GET') continue;
      const match = typeof pattern === 'string' ? pattern === target && [] : pattern.exec(target);
      if (match) { matched = handler; params = typeof pattern === 'string' ? [] : match.slice(1).map(decodeURIComponent); break; }
    }
    if (!matched) fail(404, 'not_found', '接口不存在。');
    let status, payload;
    const capture = { getHeader: name => res.getHeader(name), writeHead: code => { status = code; }, end: data => { payload = JSON.parse(data); } };
    const originalUrl = new URL(url); originalUrl.pathname = target;
    await matched(req, capture, ctx, originalUrl, params);
    if (!status || !payload) fail(503, 'unavailable', '内容暂不可用。');
    if (status >= 400) return sendJson(res, status, payload);
    sendJson(res, status, ctx.wechatProjection.filter(payload, wechatIdentity(ctx, req)));
  }, { signedIn: true })],
  ['GET', '/api/wechat/status', accountWrap(({ req, res, ctx }) => {
    const identity = wechatIdentity(ctx, req);
    sendJson(res, 200, { enabled: ctx.wechat.enabled, verified: !!identity && Date.now() - identity.verifiedAt < 110 * 60000, supportEmail: 'wong.laye@outlook.com' });
  })],
  ['POST', '/api/wechat/login', accountWrap(async ({ req, res, ctx, body }) => {
    if (!ctx.accountLimits.ip.take(clientIp(req, ctx.cfg.trustProxy))) fail(429, 'rate_limited', '登录过于频繁，请稍后再试。');
    if (body.bindCurrent !== undefined && typeof body.bindCurrent !== 'boolean') fail(400, 'invalid_request', '关联参数无效。');
    const before = body.bindCurrent ? accountFor(ctx, req) : null;
    if (body.bindCurrent && !before) fail(401, 'unauthorized', '请先登录已有网站账号。');
    const authorize = () => {
      if (!before) return;
      const current = accountFor(ctx, req);
      if (!current || current.id !== before.id || current.revision !== before.revision) fail(401, 'unauthorized', '账号已更新，请重新登录。');
    };
    const identity = await ctx.wechat.exchange(body.code);
    authorize();
    const user = await ctx.accounts.wechatLogin(identityHash(identity.appid, identity.openid), { registrationOpen: ctx.cfg.registrationOpen !== false, bindId: before?.id, authorize });
    authorize();
    setSession(req, res, ctx, user.id, { wechat: identity });
    sendJson(res, 200, { user: publicUser(user) });
  })],
];
