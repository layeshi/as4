import { residentRoutes } from './residents.js';
import { archiveRoutes } from './archives.js';
import { hostedRoutes } from './hosted.js';
import { publicRoutes } from './public.js';
import { accountWrap, accountFor, setSession } from './accounts.js';
import { fail, publicUser, wechatBindings, hasWechatIdentity } from '../accounts/store.js';
import { clientIp, parseCookies, sendJson } from './util.js';
import { identityHash } from '../wechat/service.js';
import { MODEL_PRESETS } from '../../public/model-presets.js';
export function wechatIdentity(ctx, req) {
  return ctx.accounts.sessionMetadata(parseCookies(req.headers.cookie).houren_session)?.wechat;
}
// Only real checks trigger a quick retry. Other withheld states retain their reason even at pending=0.
function project(ctx, req, payload) {
  const meta = { pending: 0, rejected: 0, unavailable: 0, loginRequired: 0, withheld: 0 }, out = ctx.wechatProjection.filter(payload, wechatIdentity(ctx, req), '', meta);
  if (out && typeof out === 'object' && !Array.isArray(out)) out.moderation = meta;
  return out;
}
// Keep the WeChat observation surface explicit; every response below still passes
// through project(), including text from market, research and cooperation records.
const publicPath = /^\/api\/public\/(?:state|map|events|chronicle|metrics|attention|lore|legacy|weather|cooperation|materials|services|demands|orders|research|observations|projects|project|(?:agents|places|laws|docs)\/[^/]+)$/;
export const wechatRoutes = [
  ['GET', /^\/api\/wechat\/account\/(?:transfers|hosted|worlds(?:\/[^/]+\/(?:souls|residents))?)$/, accountWrap(async ({ req, res, ctx, url }) => {
    const target = url.pathname.replace('/api/wechat/account/', '/api/account/');
    for (const [method, pattern, handler] of [...residentRoutes, ...archiveRoutes, ...hostedRoutes]) {
      if (method !== 'GET') continue;
      const match = typeof pattern === 'string' ? pattern === target && [] : pattern.exec(target);
      if (!match) continue;
      let status, payload;
      const capture = { getHeader: name => res.getHeader(name), writeHead: code => { status = code; }, end: data => { payload = JSON.parse(data); } };
      const originalUrl = new URL(url); originalUrl.pathname = target;
      await handler(req, capture, ctx, originalUrl, typeof pattern === 'string' ? [] : match.slice(1).map(decodeURIComponent));
      if (!status || !payload) fail(503, 'unavailable', '内容暂不可用。');
      return sendJson(res, status, status >= 400 ? payload : project(ctx, req, payload));
    }
    fail(404, 'not_found', '接口不存在。');
  }, { signedIn: true })],
  ['GET', '/api/wechat/model-presets', accountWrap(({ res }) => sendJson(res, 200, { presets: MODEL_PRESETS }))],
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
    sendJson(res, status, project(ctx, req, payload));
  })],
  ['GET', /^\/api\/wechat\/residents(?:\/([^/]+)(?:\/(private|events))?)?$/, accountWrap(async ({ req, res, ctx, url }) => {
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
    sendJson(res, status, project(ctx, req, payload));
  }, { signedIn: true })],
  ['GET', '/api/wechat/status', accountWrap(({ req, res, ctx, url }) => {
    const identity = wechatIdentity(ctx, req);
    const user = accountFor(ctx, req);
    const selected = ctx.wechat.forApp(url.searchParams.get('appid') || undefined);
    sendJson(res, 200, { linked: !!user && wechatBindings(user, ctx.wechat.appid).some(b => b.appid === selected.appid), appid: selected.appid, enabled: selected.enabled, verified: !!identity && identity.appid === selected.appid && Date.now() - identity.verifiedAt < 110 * 60000, supportEmail: 'wong.laye@outlook.com' });
  })],
  ['POST', '/api/wechat/merge/preview', accountWrap(async ({ req, res, ctx, body, actor, authorize }) => {
    if (!ctx.accountLimits.ip.take(clientIp(req, ctx.cfg.trustProxy)) || !ctx.accountLimits.username.take(String(body.username || '').toLowerCase().slice(0, 64))) fail(429, 'rate_limited', '尝试次数过多，请稍后重试。');
    const target = await ctx.accounts.login(body);
    authorize();
    const identity = await ctx.wechat.exchange(body.code, body.appid);
    authorize();
    if (!hasWechatIdentity(ctx.accounts.get(actor.id), identityHash(identity.appid, identity.openid))) fail(403, 'identity_mismatch', '请先登录要合并的微信账号。');
    if (ctx.accounts.get(target.id)?.revision !== target.revision || ctx.accounts.get(target.id)?.passwordHash !== target.passwordHash) fail(409, 'account_changed', '网站账号已更新，请重新验证。');
    sendJson(res, 200, ctx.accountMerger.preview(actor.id, target.id, identity));
  }, { signedIn: true })],
  ['POST', '/api/wechat/merge/confirm', accountWrap(async ({ req, res, ctx, body, actor }) => {
    if (body.confirm !== true || typeof body.ticket !== 'string') fail(400, 'invalid_request', '请明确确认合并账号。');
    const result = await ctx.accountMerger.confirm(actor, body.ticket);
    setSession(req, res, ctx, result.user.id, { wechat: result.identity });
    sendJson(res, 200, { user: result.user });
  }, { signedIn: true })],
  ['POST', '/api/wechat/password', accountWrap(async ({ req, res, ctx, body, actor, authorize }) => {
    if (!ctx.accountLimits.ip.take(clientIp(req, ctx.cfg.trustProxy)) || !ctx.accountLimits.username.take(actor.id)) fail(429, 'rate_limited', '尝试次数过多，请稍后再试。');
    // A session alone is insufficient: exchange a fresh wx.login code, then prove it
    // belongs to this account. Never bind, create or switch accounts on this route.
    const identity = await ctx.wechat.exchange(body.code, body.appid);
    authorize();
    const key = identityHash(identity.appid, identity.openid);
    if (!hasWechatIdentity(ctx.accounts.get(actor.id), key)) fail(403, 'identity_mismatch', '当前微信与账号不匹配。');
    const user = await ctx.accounts.setWechatPassword(actor.id, key, body.password, { authorize });
    setSession(req, res, ctx, user.id, { wechat: identity });
    sendJson(res, 200, { user });
  }, { signedIn: true })],
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
    const identity = await ctx.wechat.exchange(body.code, body.appid);
    authorize();
    const user = await ctx.accounts.wechatLogin(identityHash(identity.appid, identity.openid), { registrationOpen: ctx.cfg.registrationOpen !== false, bindId: before?.id, appid: identity.appid, legacyAppId: ctx.wechat.appid, authorize });
    authorize();
    setSession(req, res, ctx, user.id, { wechat: identity });
    sendJson(res, 200, { user: publicUser(user) });
  })],
];
