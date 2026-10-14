import { accountWrap, accountFor, setSession } from './accounts.js';
import { fail, hasWechatIdentity, publicUser } from '../accounts/store.js';
import { clientIp, parseCookies, sendJson, SlidingLimiter } from './util.js';
import { identityHash } from '../wechat/service.js';
const COOKIE = 'houren_weblogin';
const proof = (req, scene) => parseCookies(req.headers.cookie)[COOKIE + '_' + scene];
export const qrLimits = () => ({ ip: new SlidingLimiter(6, 60000), global: new SlidingLimiter(60, 60000) });
function phone(ctx, req, actor) {
  const identity = ctx.accounts.sessionMetadata(parseCookies(req.headers.cookie).houren_session)?.wechat;
  if (!identity || identity.appid !== ctx.wechat.miniprogram?.appid || !hasWechatIdentity(actor, identityHash(identity.appid, identity.openid))) fail(401, 'wechat_login_required', '请先验证当前微信身份。');
  ctx.wechat.requireIdentity(identity);
}
function browserCookie(req, ctx, scene, value) {
  const secure = req.socket.encrypted || ctx.cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https';
  return `${COOKIE}_${scene}=${value}; Path=/api/wechat/qr; HttpOnly; SameSite=Strict; Max-Age=${value ? 180 : 0}${secure ? '; Secure' : ''}`;
}
export const wechatWebLoginRoutes = [
  ['POST', '/api/wechat/qr/create', accountWrap(async ({ req, res, ctx, body }) => {
    if (accountFor(ctx, req)) fail(409, 'already_signed_in', '网页已登录，请刷新页面。');
    if (!ctx.qrLimits.ip.take(clientIp(req, ctx.cfg.trustProxy)) || !ctx.qrLimits.global.take('all')) fail(429, 'rate_limited', '二维码刷新过于频繁，请稍后再试。');
    ctx.wechatWebLogin.prune();
    if (body.previousScene && ctx.wechatWebLogin.requests.has(body.previousScene)) {
      ctx.wechatWebLogin.browser(body.previousScene, proof(req, body.previousScene));
      ctx.wechatWebLogin.requests.delete(body.previousScene);
    }
    const r = await ctx.wechatWebLogin.create();
    // Independent cookie names stop late responses from replacing a newer QR proof.
    res.setHeader('Set-Cookie', browserCookie(req, ctx, r.scene, r.proof));
    sendJson(res, 201, { scene: r.scene, checkCode: r.checkCode, expiresAt: r.expiresAt, imageUrl: '/api/wechat/qr/image/' + r.scene });
  })],
  ['GET', /^\/api\/wechat\/qr\/image\/([a-f0-9]{32})$/, accountWrap(({ req, res, ctx, params }) => {
    const row = ctx.wechatWebLogin.browser(params[0], proof(req, params[0]));
    if (!row.image) fail(409, 'qr_pending', '二维码正在生成。');
    res.writeHead(200, { 'Content-Type': row.image.type, 'Content-Length': row.image.bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(row.image.bytes);
  })],
  ['POST', '/api/wechat/qr/status', accountWrap(({ req, res, ctx, body }) => {
    const row = ctx.wechatWebLogin.browser(body.scene, proof(req, body.scene));
    if (row.userId) ctx.wechatWebLogin.user(row);
    sendJson(res, 200, { state: row.state, expiresAt: row.expiresAt });
  })],
  ['POST', '/api/wechat/qr/cancel', accountWrap(({ req, res, ctx, body }) => {
    ctx.wechatWebLogin.browser(body.scene, proof(req, body.scene)); ctx.wechatWebLogin.requests.delete(body.scene);
    res.setHeader('Set-Cookie', browserCookie(req, ctx, body.scene, ''));
    sendJson(res, 200, { ok: true });
  })],
  ['POST', '/api/wechat/qr/consume', accountWrap(({ req, res, ctx, body }) => {
    if (accountFor(ctx, req)) fail(409, 'already_signed_in', '网页已登录，请刷新页面。');
    const user = ctx.wechatWebLogin.consume(body.scene, proof(req, body.scene));
    // Browser sessions are independent from the phone session and moderation proof.
    setSession(req, res, ctx, user.id);
    res.setHeader('Set-Cookie', [res.getHeader('Set-Cookie'), browserCookie(req, ctx, body.scene, '')]);
    sendJson(res, 200, { user: publicUser(user) });
  })],
  ['POST', '/api/wechat/qr/scan', accountWrap(({ req, res, ctx, body, actor }) => {
    phone(ctx, req, actor);
    sendJson(res, 200, ctx.wechatWebLogin.scan(body.scene, actor));
  }, { signedIn: true })],
  ['POST', '/api/wechat/qr/confirm', accountWrap(({ req, res, ctx, body, actor }) => {
    phone(ctx, req, actor);
    if (typeof body.approve !== 'boolean') fail(400, 'invalid_request', '请确认或取消登录。');
    ctx.wechatWebLogin.decide(body.scene, actor, body.approve);
    sendJson(res, 200, { ok: true });
  }, { signedIn: true })],
];
