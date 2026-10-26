import { AccountError, fail, hasContact, hasWechatIdentity, passwordEnabled, publicUser } from '../accounts/store.js';
import { loginCaptchaProvider } from '../accounts/login-challenge.js';
import { normalizeContact } from '../accounts/verification.js';
import { identityHash } from '../wechat/service.js';
import { prayerView } from '../e2/engine/prayers.js';
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
export function setSession(req, res, ctx, id, metadata = {}) {
  if (req.headers['x-houren-client'] === 'wechat') metadata = { ...metadata, client: 'wechat' };
  ctx.accounts.logout(tokenOf(req));
  res.setHeader('Set-Cookie', cookie(req, ctx, ctx.accounts.issue(id, metadata)));
}
export function mutationGate(req) {
  // Custom header cannot be supplied by cross-origin HTML forms. No account CORS.
  if (req.headers['x-houren-request'] !== '1') fail(403, 'csrf', '请求验证失败，请刷新页面。');
  if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'csrf', '不允许跨站请求。');
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'content_type', '请使用 JSON 请求。');
}
export const accountWrap = (handler, { admin = false, signedIn = false, bodyLimit = 8192 } = {}) => async (req, res, ctx, url, params) => {
  try {
    if (req.method !== 'GET') mutationGate(req);
    const actor = signedIn || admin ? requireUser(ctx, req, admin) : null;
    const authorize = () => {
      if (!actor) return;
      const current = requireUser(ctx, req, admin);
      if (current.id !== actor.id || current.revision !== actor.revision) fail(401, 'unauthorized', '账号已更新，请重新登录。');
    };
    let body = {};
    if (req.method !== 'GET') {
      const parsed = await readJson(req, bodyLimit);
      if (!parsed.ok) fail(parsed.code === 'too_large' ? 413 : 400, parsed.code, '请求格式无效或内容过大。');
      body = parsed.value;
      if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'invalid_request', '请求需要 JSON 对象。');
      authorize();
    }
    if (req.method !== 'GET' && /^(?:\/api\/account(?:\/(?:register|residents(?:\/[^/]+\/letter)?))?)$/.test(url.pathname)) {
      const identity = ctx.accounts.sessionMetadata(tokenOf(req))?.wechat;
      if (identity || req.headers['x-houren-client'] === 'wechat') {
        ctx.wechat.requireIdentity(identity);
        for (const key of ['name', 'bio', 'soul', 'displayName', 'text']) {
          if (body[key] !== undefined) await ctx.wechat.check(body[key], identity, key === 'text' ? 2 : 1);
        }
        // Creation uses the account display name, not the submitted creatorName.
        if (url.pathname === '/api/account/residents' && actor) await ctx.wechat.check(actor.displayName, identity, 1);
        authorize();
      }
    }
    await handler({ req, res, ctx, url, params, body, actor, authorize });
  } catch (e) {
    if (!(e instanceof AccountError)) throw e;
    sendJson(res, e.status, { error: { code: e.code, message: e.message } });
  }
};
const wrap = accountWrap;
export function accountLimits() {
  return { login: new SlidingLimiter(120, 60000), ip: new SlidingLimiter(30, 15 * 60000), username: new SlidingLimiter(15, 15 * 60000), register: new SlidingLimiter(5, 60 * 60000), claim: new SlidingLimiter(20, 15 * 60000) };
}
const CLAIM_BATCH = 50; // owner keys per claim request (the body limit is 8 KB; a key is 64 hex characters)
/**
 * The residents an account has linked, each with its status and token usage. A link to a resident that was since transferred
 * (its agent-token hash changed) is no longer the account's: it is left out and dropped.
 */
export function linkedAgents(ctx, user) {
  const w = ctx.rt.w, rows = [], stale = [];
  if((w.premise===6 || w.premise === 7))return Object.entries(w.access.residents).filter(([,r])=>r.managerAccountId===user.id).map(([id])=>({agentId:id,name:w.agents[id].name,status:w.agents[id].status,runnerStatus:ctx.runners.view(id).status,usage:ctx.runners.usageView(id)}));
  for (const link of ctx.accounts.linksOf(user.id, w.id)) {
    const a = Object.prototype.hasOwnProperty.call(w.agents, link.agentId) ? w.agents[link.agentId] : null;
    if (!a || !a.owner || a.tokenHash !== link.token) { stale.push(link.agentId); continue; }
    const prayers = prayerView(w, a.id);
    rows.push({ agentId: a.id, name: a.name, status: a.status, runnerStatus: ctx.runners.view(a.id).status, linkedAt: link.at, usage: ctx.runners.usageView(a.id), ...(prayers.enabled ? { prayerPoints: prayers.accounts[0].balance, prayers } : {}) });
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
async function passwordLogin({ req, res, ctx, body }, wechat = false) {
  const ip = clientIp(req, ctx.cfg.trustProxy);
  if (!ctx.accountLimits.login.take('all') || !ctx.accountLimits.ip.take(ip)) fail(429, 'rate_limited', '尝试次数过多，请稍后再试。');
  if (typeof body.username !== 'string' || !/^[A-Za-z0-9_]{3,32}$/.test(body.username) || typeof body.password !== 'string' || body.password.length > 128) fail(400, 'invalid_request', '请输入有效的用户名和密码。');
  // A client header is not proof. Exchange a fresh code with the configured
  // WeChat app without creating, binding, or switching a WeChat account.
  if (wechat) await ctx.wechat.exchange(body.code, body.appid);
  else if (loginCaptchaProvider(ctx.cfg) === 'altcha') await ctx.loginChallenge.verify(body.altcha);
  else if (loginCaptchaProvider(ctx.cfg) === 'turnstile') await ctx.verifyLoginTurnstile(ctx.cfg.turnstileSecretKey, body.turnstileToken, ip);
  // Only a verified login attempt may consume the target account's quota.
  if (!ctx.accountLimits.username.take(body.username.toLowerCase())) fail(429, 'rate_limited', '尝试次数过多，请稍后再试。');
  const user = await ctx.accounts.login(body, { allowPending: true });
  if (user.contactRequired && !hasContact(user)) {
    if (!body.proof) fail(428, 'contact_required', '首次登录前请验证邮箱或手机号。');
    const verified = ctx.verification.consume(body.proof, 'first_login');
    ctx.accounts.setContact(user.id, verified.channel, verified.contact, { expectedRevision: user.revision });
  }
  setSession(req, res, ctx, user.id, wechat ? { client: 'wechat' } : {});
  sendJson(res, 200, { user: publicUser(ctx.accounts.get(user.id)) });
}
export async function verifyLoginTurnstile(secret, token, ip, fetchImpl = fetch, action = 'login') {
  if (typeof token !== 'string' || !token || token.length > 2048) fail(400, 'turnstile_required', '请完成人机验证后重试。');
  let result;
  try {
    const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('siteverify unavailable');
    result = await response.json();
  } catch {
    fail(503, 'turnstile_unavailable', '人机验证暂时不可用，请稍后重试。');
  }
  if (result?.success !== true || (action === 'verify' ? result.action !== action : result.action && result.action !== action)) fail(403, 'turnstile_failed', '人机验证未通过，请重试。');
}
async function reauthenticate(ctx, actor, body, authorize) {
  if (passwordEnabled(actor)) await ctx.accounts.verifyPassword(actor.id, body.currentPassword);
  else {
    const identity = await ctx.wechat.exchange(body.wechatCode, body.appid);
    if (!hasWechatIdentity(ctx.accounts.get(actor.id), identityHash(identity.appid, identity.openid))) fail(403, 'identity_mismatch', '微信身份与当前账号不匹配。');
  }
  authorize();
}
export const accountRoutes = [
  ['GET', '/api/account', wrap(({ req, res, ctx }) => {
    const user = accountFor(ctx, req);
    sendJson(res, 200, { user: user ? publicUser(user, ctx.wechat.appid) : null, registrationOpen: ctx.cfg.registrationOpen !== false, loginRequired: ctx.cfg.requireLogin === true, wechatQrEnabled: ctx.wechatWebLogin.enabled, loginCaptcha: { provider: loginCaptchaProvider(ctx.cfg) }, turnstileSiteKey: ctx.cfg.turnstileSiteKey || null, verificationChannels: { email: ctx.verification.available('email'), phone: ctx.verification.available('phone') } });
  })],
  ['GET', '/api/account/challenge', wrap(async ({ req, res, ctx }) => {
    if (!ctx.loginChallenge) fail(404, 'not_found', '登录验证未启用。');
    if (req.headers['x-houren-request'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'csrf', '请求验证失败，请刷新页面。');
    sendJson(res, 200, await ctx.loginChallenge.issue(clientIp(req, ctx.cfg.trustProxy)));
  })],
  ['POST', '/api/account/verification/request', wrap(async ({ req, res, ctx, body }) => {
    const { purpose, channel } = body;
    const actor = accountFor(ctx, req);
    if (purpose === 'register' && ctx.cfg.registrationOpen === false) fail(403, 'registration_closed', '公开注册已关闭。');
    if (purpose === 'contact') {
      if (!actor) fail(401, 'unauthorized', '请先登录。');
    } else if (purpose === 'register' || purpose === 'recover' || purpose === 'first_login') {
      if (!ctx.cfg.turnstileSecretKey) fail(503, 'turnstile_unavailable', '人机验证尚未配置。');
      await ctx.verifyLoginTurnstile(ctx.cfg.turnstileSecretKey, body.turnstileToken, clientIp(req, ctx.cfg.trustProxy), fetch, 'verify');
    } else fail(400, 'invalid_request', '验证用途无效。');
    const contact = normalizeContact(channel, body.value);
    const user = purpose === 'recover' ? ctx.accounts.data.users.find(u => u.status === 'active' && !u.mergePending && passwordEnabled(u) && u.contacts?.[channel] === contact) : null;
    const result = await ctx.verification.request({ channel, value: contact, purpose, ip: clientIp(req, ctx.cfg.trustProxy), ownerId: purpose === 'contact' ? actor.id : null, userId: user?.id || null, deliver: purpose !== 'recover' || !!user, deferDelivery: purpose === 'recover' });
    sendJson(res, 200, { ...result, message: '如该联系方式可用于验证，验证码将发送。' });
  })],
  ['POST', '/api/account/verification/confirm', wrap(async ({ res, ctx, body }) => {
    sendJson(res, 200, await ctx.verification.confirm(body.challengeId, body.code));
  })],
  ['POST', '/api/account/register', wrap(async ({ req, res, ctx, body }) => {
    limit(ctx, req, body, true);
    if (ctx.cfg.registrationOpen === false) fail(403, 'registration_closed', '公开注册已关闭，请联系管理员。');
    const verified = ctx.verification.consume(body.proof, 'register');
    const user = await ctx.accounts.create(body, { verifiedContact: verified });
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
  ['POST', '/api/account/login', wrap(args => passwordLogin(args))],
  ['POST', '/api/wechat/password-login', wrap(args => passwordLogin(args, true))],
  ['POST', '/api/account/recovery', wrap(async ({ res, ctx, body }) => {
    const verified = ctx.verification.consume(body.proof, 'recover');
    await ctx.accounts.resetPasswordByContact(verified.userId, verified.channel, verified.contact, body.password);
    sendJson(res, 200, { ok: true });
  })],
  ['POST', '/api/account/contacts', wrap(async ({ res, ctx, body, actor, authorize }) => {
    await reauthenticate(ctx, actor, body, authorize);
    const verified = ctx.verification.consume(body.proof, 'contact', actor.id);
    sendJson(res, 200, { user: ctx.accounts.setContact(actor.id, verified.channel, verified.contact, { expectedRevision: actor.revision }) });
  }, { signedIn: true })],
  ['DELETE', /^\/api\/account\/contacts\/(email|phone)$/, wrap(async ({ res, ctx, body, actor, params, authorize }) => {
    await reauthenticate(ctx, actor, body, authorize);
    sendJson(res, 200, { user: ctx.accounts.deleteContact(actor.id, params[0], { expectedRevision: actor.revision }) });
  }, { signedIn: true })],
  ['DELETE', /^\/api\/account\/wechat\/([^/]+)$/, wrap(async ({ res, ctx, body, actor, params, authorize }) => {
    if (!passwordEnabled(actor)) fail(409, 'password_required', '请先验证联系方式并启用密码登录。');
    authorize();
    const user = await ctx.accounts.unlinkWechat(actor.id, params[0], body.currentPassword, ctx.wechat.appid);
    ctx.notifications?.cleanup();
    sendJson(res, 200, { user });
  }, { signedIn: true })],
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
  // Linked-resident listing is read-only. Accounts may send scoped prayer replies;
  // ordinary resident controls still require the owner key.
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
    const role = body.role || 'user';
    const user = await ctx.accounts.create(body, { role, contactRequired: role === 'user', authorize });
    sendJson(res, 201, { user });
  }, { admin: true })],
  ['PATCH', /^\/api\/admin\/users\/([^/]+)$/, wrap(async ({ req, res, ctx, body, params, authorize }) => {
    if (body.password !== undefined) limit(ctx, req, { username: params[0] });
    const user = await ctx.accounts.update(params[0], body, { admin: true, authorize });
    sendJson(res, 200, { user });
  }, { admin: true })],
];
