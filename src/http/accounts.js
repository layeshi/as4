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
  return { ip: new SlidingLimiter(30, 15 * 60000), username: new SlidingLimiter(15, 15 * 60000), register: new SlidingLimiter(5, 60 * 60000), claim: new SlidingLimiter(20, 15 * 60000) };
}
const CLAIM_BATCH = 50; // owner keys per claim request (the body limit is 8 KB; a key is 64 hex characters)
/**
 * The residents an account has linked, each with its status and token usage. A link to a resident that was since transferred
 * (its agent-token hash changed) is no longer the account's: it is left out and dropped.
 */
export function linkedAgents(ctx, user) {
  const w = ctx.rt.w, rows = [], stale = [];
  for (const link of ctx.accounts.linksOf(user.id, w.id)) {
    const a = Object.prototype.hasOwnProperty.call(w.agents, link.agentId) ? w.agents[link.agentId] : null;
    if (!a || !a.owner || a.tokenHash !== link.token) { stale.push(link.agentId); continue; }
    rows.push({ agentId: a.id, name: a.name, status: a.status, runnerStatus: ctx.runners.view(a.id).status, linkedAt: link.at, usage: ctx.runners.usageView(a.id) });
  }
  if (stale.length) {
    try { ctx.accounts.unlinkAgents(user.id, w.id, stale); } catch { /* tidying only; the next listing tries again */ }
  }
  return rows;
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
  // Residents linked to the signed-in account: read-only. The owner key stays the only credential that controls a resident.
  ['GET', '/api/account/agents', wrap(({ res, ctx, actor }) => {
    sendJson(res, 200, { agents: linkedAgents(ctx, actor) });
  }, { signedIn: true })],
  ['POST', '/api/account/agents', wrap(({ res, ctx, body, actor }) => {
    if (!ctx.accountLimits.claim.take(actor.id)) fail(429, 'rate_limited', '认领太频繁，请稍后再试。');
    const keys = body.ownerKeys !== undefined ? body.ownerKeys : [body.ownerKey];
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > CLAIM_BATCH || keys.some((k) => typeof k !== 'string' || !k.trim() || k.length > 200)) fail(400, 'invalid_request', `请提供 1–${CLAIM_BATCH} 把造者密钥。`);
    const w = ctx.rt.w;
    const results = keys.map((key) => {
      // A wrong key and a key whose resident no longer exists look the same.
      const id = ctx.tokens.ownerFor(w, key.trim());
      if (!id) return { ok: false, code: 'not_found' };
      try { ctx.accounts.linkAgent(actor.id, { world: w.id, agentId: id, token: w.agents[id].tokenHash }); }
      catch (e) {
        if (e instanceof AccountError) return { ok: false, code: e.code };
        throw e;
      }
      return { ok: true, agentId: id, name: w.agents[id].name };
    });
    sendJson(res, 200, { results });
  }, { signedIn: true })],
  ['DELETE', /^\/api\/account\/agents\/([^/]+)$/, wrap(({ res, ctx, params, actor }) => {
    ctx.accounts.unlinkAgents(actor.id, ctx.rt.w.id, [params[0]]);
    sendJson(res, 200, { ok: true });
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
