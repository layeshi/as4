import { AccountError, fail, publicUser } from '../accounts/store.js';
import { clientIp, parseCookies, readJson, sendJson, SlidingLimiter, timingEqual } from './util.js';

const COOKIE = 'houren_session';
const tokenOf = (req) => parseCookies(req.headers.cookie)[COOKIE];
export const accountFor = (ctx, req) => ctx.accounts.session(tokenOf(req));
function requireUser(ctx, req, admin = false) {
  const user = accountFor(ctx, req);
  if (!user) fail(401, 'unauthorized', '请先登录。');
  if (admin && user.role !== 'admin') fail(403, 'forbidden', '此操作需要管理员权限。');
  return user;
}
function cookie(req, ctx, token = '') {
  const secure = req.socket.encrypted || (ctx.cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https');
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 604800 : 0}${secure ? '; Secure' : ''}`;
}
function setSession(req, res, ctx, id) {
  ctx.accounts.logout(tokenOf(req));
  res.setHeader('Set-Cookie', cookie(req, ctx, ctx.accounts.issue(id)));
}
export function mutationGate(req) {
  // Custom header cannot be supplied by cross-origin HTML forms. No account CORS.
  if (req.headers['x-houren-request'] !== '1') fail(403, 'csrf', '请求验证失败，请刷新页面。');
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'csrf', '不允许跨站请求。');
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'content_type', '请使用 JSON 请求。');
}
const wrap = (handler, { admin = false, signedIn = false } = {}) => async (req, res, ctx, url, params) => {
  try {
    if (req.method !== 'GET') mutationGate(req);
    const actor = signedIn || admin ? requireUser(ctx, req, admin) : null;
    const authorize = () => {
      if (!actor) return;
      const current = requireUser(ctx, req, admin);
      if (current.revision !== actor.revision) fail(401, 'unauthorized', '账号已更新，请重新登录。');
    };
    let body = {};
    if (req.method !== 'GET') {
      const parsed = await readJson(req, 8192);
      if (!parsed.ok) fail(parsed.code === 'too_large' ? 413 : 400, parsed.code, '请求格式无效或内容过大。');
      body = parsed.value;
      authorize();
    }
    await handler({ req, res, ctx, url, params, body, actor, authorize });
  } catch (e) {
    if (!(e instanceof AccountError)) throw e;
    sendJson(res, e.status, { error: { code: e.code, message: e.message } });
  }
};
export function accountLimits() {
  return { ip: new SlidingLimiter(30, 15 * 60000), username: new SlidingLimiter(15, 15 * 60000), register: new SlidingLimiter(5, 60 * 60000) };
}
function limit(ctx, req, body, registering = false) {
  const ip = clientIp(req, ctx.cfg.trustProxy);
  if (!ctx.accountLimits.ip.take(ip) || (registering && !ctx.accountLimits.register.take(ip)) || (!registering && !ctx.accountLimits.username.take(String(body.username || '').toLowerCase().slice(0, 64)))) fail(429, 'rate_limited', '尝试次数过多，请稍后再试。');
}
export const accountRoutes = [
  ['GET', '/api/account', wrap(({ req, res, ctx }) => {
    const user = accountFor(ctx, req);
    sendJson(res, 200, { user: user ? publicUser(user) : null, registrationOpen: ctx.cfg.registrationOpen !== false, setupAvailable: !!ctx.cfg.adminKey && !ctx.accounts.hasAdmin() });
  })],
  ['POST', '/api/account/register', wrap(async ({ req, res, ctx, body }) => {
    limit(ctx, req, body, true);
    if (ctx.cfg.registrationOpen === false) fail(403, 'registration_closed', '公开注册已关闭，请联系管理员。');
    const user = await ctx.accounts.create(body);
    setSession(req, res, ctx, user.id);
    sendJson(res, 201, { user });
  })],
  ['POST', '/api/account/setup', wrap(async ({ req, res, ctx, body }) => {
    limit(ctx, req, body, true);
    if (!ctx.cfg.adminKey || !timingEqual(body.adminKey, ctx.cfg.adminKey)) fail(403, 'forbidden', '管理密钥无效或管理员初始化未启用。');
    const user = await ctx.accounts.create(body, { role: 'admin', bootstrap: true });
    setSession(req, res, ctx, user.id);
    sendJson(res, 201, { user });
  })],
  ['POST', '/api/account/login', wrap(async ({ req, res, ctx, body }) => {
    limit(ctx, req, body);
    const user = await ctx.accounts.login(body);
    setSession(req, res, ctx, user.id);
    sendJson(res, 200, { user: publicUser(user) });
  })],
  ['POST', '/api/account/logout', wrap(({ req, res, ctx }) => {
    ctx.accounts.logout(tokenOf(req));
    res.setHeader('Set-Cookie', cookie(req, ctx));
    sendJson(res, 200, { ok: true });
  })],
  ['PATCH', '/api/account', wrap(async ({ req, res, ctx, body, actor, authorize }) => {
    limit(ctx, req, { username: actor.username });
    if (body.role !== undefined || body.status !== undefined) fail(403, 'forbidden', '不能自行修改角色或账号状态。');
    const user = await ctx.accounts.update(actor.id, body, { authorize });
    if (body.password !== undefined) setSession(req, res, ctx, user.id);
    sendJson(res, 200, { user });
  }, { signedIn: true })],
  ['GET', '/api/admin/users', wrap(({ res, ctx, url }) => {
    const q = (url.searchParams.get('q') || '').toLowerCase().slice(0, 100);
    const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
    const users = ctx.accounts.data.users.filter((u) => `${u.username} ${u.displayName}`.toLowerCase().includes(q));
    sendJson(res, 200, { users: users.slice((page - 1) * 20, page * 20).map(publicUser), total: users.length, page, pageSize: 20 });
  }, { admin: true })],
  ['POST', '/api/admin/users', wrap(async ({ req, res, ctx, body, authorize }) => {
    limit(ctx, req, body, true);
    if (body.role !== undefined && !['user', 'admin'].includes(body.role)) fail(400, 'invalid_role', '角色无效。');
    const user = await ctx.accounts.create(body, { role: body.role || 'user', authorize });
    sendJson(res, 201, { user });
  }, { admin: true })],
  ['PATCH', /^\/api\/admin\/users\/([^/]+)$/, wrap(async ({ req, res, ctx, body, params, authorize }) => {
    if (body.password !== undefined) limit(ctx, req, { username: params[0] });
    const user = await ctx.accounts.update(params[0], body, { admin: true, authorize });
    sendJson(res, 200, { user });
  }, { admin: true })],
];
