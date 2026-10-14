import { durableFile } from '../durable-file.js';
// Human accounts are separate from the deterministic world and its command log.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const hash = (v) => createHash('sha256').update(v).digest('hex');
const TTL = 7 * 24 * 60 * 60 * 1000;
export const MAX_LINKS = 100; // residents one account may link
const validLink = (l) => !!l && typeof l.world === 'string' && typeof l.agentId === 'string' && typeof l.token === 'string';
export class AccountError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const fail = (status, code, message) => { throw new AccountError(status, code, message); };
export function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,32}$/.test(value)) fail(400, 'invalid_username', '用户名须为 3–32 位英文字母、数字或下划线。');
  return value.toLowerCase();
}
function displayName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60) fail(400, 'invalid_display_name', '昵称须为 1–60 个字符。');
  return value.trim();
}
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail(400, 'invalid_password', '密码须为 12–128 个字符。');
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${key.toString('hex')}`;
}
async function verify(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, expected] = encoded.split(':');
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(key, Buffer.from(expected, 'hex'));
}
export const wechatBindings = (u, legacyAppId) => [
  ...(u.wechatIdentity ? [{ appid: u.wechatAppId || legacyAppId, identity: u.wechatIdentity }] : []),
  ...(u.wechatBindings || []),
];
export const hasWechatIdentity = (u, identity) => wechatBindings(u).some(b => b.identity === identity);
export const publicUser = (u) => {
  const { id, username, displayName, role, status, createdAt, updatedAt } = u;
  return { id, username, displayName, role, status, createdAt, updatedAt,
    wechatLinked: wechatBindings(u).length > 0,
    // Legacy generated users had an unknown random password. This is display state only;
    // password setup always requires a new upstream identity proof, even for legacy users.
    passwordLoginEnabled: u.passwordLoginEnabled ?? !(u.wechatIdentity && /^wx_[a-f0-9]{24}$/.test(username)) };
};
export class AccountStore {
  constructor(dir) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'accounts.json');
    this.data = { version: 1, users: [] };
    try { this.data = JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (this.data.version !== 1 || !Array.isArray(this.data.users)) throw new Error('Invalid accounts store');
    this.sessions = new Map();
    // Same-cost verification for unknown users, without storing a real password.
    this.dummy = `${'0'.repeat(32)}:${'0'.repeat(128)}`;
    this.pendingHashes = 0;
  }
  async expensive(fn) {
    if (this.pendingHashes >= 4) fail(429, 'busy', '登录请求较多，请稍后重试。');
    this.pendingHashes++;
    try { return await fn(); } finally { this.pendingHashes--; }
  }
  commit(change) {
    const next = structuredClone(this.data);
    const result = change(next.users);
    durableFile(this.file, JSON.stringify(next));
    this.data = next;
    return result;
  }
  get(id) { return this.data.users.find((u) => u.id === id); }
  hasAdmin() { return this.data.users.some((u) => u.role === 'admin'); }
  // Read-only links from an account to the residents it placed (docs/plans/2026-10-03-usage-accounts-admin.md). They live with the
  // user, outside the world and its command log: { world, agentId, token, at }, where `token` is the resident's agent-token hash.
  // A link is valid only while the resident still has that hash: a transfer replaces it, an owner-key reset does not.
  linksOf(userId, world) {
    const u = this.get(userId);
    return (u && Array.isArray(u.agents) ? u.agents : []).filter((l) => validLink(l) && l.world === world).map((l) => ({ ...l }));
  }
  /** Link a resident to an account (idempotent: linking again only refreshes the token hash). Returns true for a new link. */
  linkAgent(userId, { world, agentId, token }) {
    const existing = this.linksOf(userId, world).find((l) => l.agentId === agentId);
    if (existing && existing.token === token) return false;
    return this.commit((users) => {
      const u = users.find((x) => x.id === userId);
      if (!u) fail(404, 'not_found', '用户不存在。');
      const links = Array.isArray(u.agents) ? u.agents : (u.agents = []);
      const i = links.findIndex((l) => validLink(l) && l.world === world && l.agentId === agentId);
      if (i >= 0) { links[i] = { ...links[i], token }; return false; }
      if (links.length >= MAX_LINKS) fail(409, 'too_many_agents', `每个账号最多关联 ${MAX_LINKS} 位居民。`);
      links.push({ world, agentId, token, at: new Date().toISOString() });
      return true;
    });
  }
  /** Drop an account's links to some residents; returns how many were removed. */
  unlinkAgents(userId, world, agentIds) {
    const drop = new Set(agentIds);
    if (!this.linksOf(userId, world).some((l) => drop.has(l.agentId))) return 0;
    return this.commit((users) => {
      const u = users.find((x) => x.id === userId);
      const before = u.agents.length;
      u.agents = u.agents.filter((l) => !(validLink(l) && l.world === world && drop.has(l.agentId)));
      return before - u.agents.length;
    });
  }
  /** For the operator: agentId → [{ username, token }], every account that has linked each resident in this world. */
  linkIndex(world) {
    const index = new Map();
    for (const u of this.data.users) {
      for (const l of Array.isArray(u.agents) ? u.agents : []) {
        if (!validLink(l) || l.world !== world) continue;
        if (!index.has(l.agentId)) index.set(l.agentId, []);
        index.get(l.agentId).push({ username: u.username, token: l.token });
      }
    }
    return index;
  }
  async create(body, { role = 'user', bootstrap = false, authorize = () => {} } = {}) {
    const name = username(body.username);
    const nickname = displayName(body.displayName ?? body.username);
    const encoded = await this.expensive(() => passwordHash(body.password));
    authorize();
    return this.commit((users) => {
      if (bootstrap && users.some((u) => u.role === 'admin')) fail(409, 'already_initialized', '管理员已初始化，请登录。');
      if (users.some((u) => u.username === name)) fail(409, 'username_taken', '该用户名已被使用。');
      const now = new Date().toISOString();
      const u = { id: randomUUID(), username: name, displayName: nickname, passwordHash: encoded, role, status: 'active', revision: 1, createdAt: now, updatedAt: now };
      users.push(u);
      return publicUser(u);
    });
  }
  /** Verified WeChat identity only; never link by username or client-supplied OpenID. */
  async wechatLogin(identity, { registrationOpen = true, bindId = null, appid, legacyAppId, authorize = () => {} } = {}) {
    if (typeof identity !== 'string' || !/^[a-f0-9]{64}$/.test(identity)) fail(400, 'invalid_identity', '微信身份无效。');
    const existing = this.data.users.find(u => hasWechatIdentity(u, identity));
    if (existing) {
      authorize();
      if ((existing.status !== 'active' || existing.mergePending)) fail(401, 'unauthorized', '账号已停用。');
      if (bindId && existing.id !== bindId) fail(409, 'identity_linked', '此微信已关联另一个账号，不能覆盖绑定。请退出后使用微信登录；可在原微信账号中选择「合并到已有网站账号」并验证两端身份。');
      return existing;
    }
    if (!bindId && !registrationOpen) fail(403, 'registration_closed', '公开注册已关闭，请登录已有账号后关联微信。');
    const encoded = bindId ? null : await this.expensive(() => passwordHash(randomBytes(48).toString('hex')));
    authorize();
    return this.commit(users => {
      const current = users.find(u => hasWechatIdentity(u, identity));
      if (current) {
        if ((current.status !== 'active' || current.mergePending) || bindId && current.id !== bindId) fail(409, 'identity_linked', '微信关联已变化，请重新登录。');
        return current;
      }
      if (bindId) {
        const user = users.find(u => u.id === bindId && u.status === 'active' && !u.mergePending);
        if (!user || wechatBindings(user, legacyAppId).some(b => !appid || b.appid === appid || !b.appid)) fail(409, 'identity_linked', '此账号已关联该微信应用的其他身份，请使用原微信登录。');
        if (!user.wechatIdentity) { user.wechatIdentity = identity; user.wechatAppId = appid; }
        else { (user.wechatBindings ||= []).push({ appid, identity }); }
        user.updatedAt = new Date().toISOString();
        return user;
      }
      const now = new Date().toISOString();
      // Random account name prevents a pre-registered name from hijacking this identity.
      let name;
      do { name = 'wx_' + randomBytes(12).toString('hex'); } while (users.some(u => u.username === name));
      const user = { id: randomUUID(), username: name, displayName: '微信访客', passwordHash: encoded, passwordLoginEnabled: false, wechatIdentity: identity, wechatAppId: appid, role: 'user', status: 'active', revision: 1, createdAt: now, updatedAt: now };
      users.push(user); return user;
    });
  }
  async setWechatPassword(id, identity, password, { authorize = () => {} } = {}) {
    const before = this.get(id);
    if (!before || before.status !== 'active' || !hasWechatIdentity(before, identity)) fail(403, 'identity_mismatch', '当前微信与账号不匹配。');
    const encoded = await this.expensive(() => passwordHash(password));
    authorize();
    return this.commit(users => {
      const u = users.find(u => u.id === id);
      if (!u || (u.status !== 'active' || u.mergePending) || u.revision !== before.revision || (u.authRevision || 0) !== (before.authRevision || 0) || !hasWechatIdentity(u, identity)) fail(409, 'account_changed', '账号已更新，请重新登录。');
      u.passwordHash = encoded; u.passwordLoginEnabled = true;
      u.authRevision = (u.authRevision || 0) + 1; u.updatedAt = new Date().toISOString();
      return publicUser(u);
    });
  }
  async login(body) {
    const name = typeof body.username === 'string' ? body.username.toLowerCase() : '';
    const before = this.data.users.find((u) => u.username === name);
    const valid = await this.expensive(() => verify(body.password, before?.passwordHash ?? this.dummy));
    const current = before && this.get(before.id);
    if (!valid || !current || (current.status !== 'active' || current.mergePending) || current.revision !== before.revision || current.passwordHash !== before.passwordHash) fail(401, 'invalid_credentials', '用户名或密码错误，或账号已停用。');
    return current;
  }
  session(token) {
    if (typeof token !== 'string' || !token) return null;
    const key = hash(token), session = this.sessions.get(key);
    const u = session && this.get(session.userId);
    if (!session || session.expires <= Date.now() || !u || (u.status !== 'active' || u.mergePending) || u.revision !== session.revision || (u.authRevision || 0) !== (session.authRevision || 0)) {
      this.sessions.delete(key); return null;
    }
    return u;
  }
  issue(id, metadata = {}) {
    const u = this.get(id);
    if (!u || (u.status !== 'active' || u.mergePending)) fail(401, 'unauthorized', '请重新登录。');
    for (const [key, s] of this.sessions) if (s.expires <= Date.now()) this.sessions.delete(key);
    // Bound sessions per user and globally.
    const own = [...this.sessions].filter(([, s]) => s.userId === id);
    for (const [key] of own.slice(0, Math.max(0, own.length - 9))) this.sessions.delete(key);
    if (this.sessions.size >= 10000) this.sessions.delete(this.sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    this.sessions.set(hash(token), { userId: id, revision: u.revision, authRevision: u.authRevision || 0, expires: Date.now() + TTL, wechat: metadata.wechat });
    return token;
  }
  sessionMetadata(token) {
    if (!this.session(token)) return null;
    return this.sessions.get(hash(token));
  }
  logout(token) { if (token) this.sessions.delete(hash(token)); }
  async update(id, body, { admin = false, authorize = () => {} } = {}) {
    const before = this.get(id);
    if (!before) fail(404, 'not_found', '用户不存在。');
    if (before.mergePending || before.mergedTo) fail(409, 'account_merging', '账号正在合并或已合并。');
    const patch = {};
    if (body.displayName !== undefined) patch.displayName = displayName(body.displayName);
    if (admin) {
      for (const [key, values] of [['role', ['user', 'admin']], ['status', ['active', 'disabled']]]) {
        if (body[key] !== undefined) {
          if (!values.includes(body[key])) fail(400, 'invalid_request', '角色或账号状态无效。');
          patch[key] = body[key];
        }
      }
    }
    if (body.password !== undefined) {
      if (!admin && !await this.expensive(() => verify(body.currentPassword, before.passwordHash))) fail(401, 'invalid_password', '当前密码错误。');
      patch.passwordHash = await this.expensive(() => passwordHash(body.password));
      patch.passwordLoginEnabled = true;
    }
    authorize();
    return this.commit((users) => {
      const u = users.find((u) => u.id === id);
      if (u.mergePending || u.mergedTo || u.revision !== before.revision || (u.authRevision || 0) !== (before.authRevision || 0)) fail(409, 'account_changed', '账号已更新，请刷新后重试。');
      const next = { ...u, ...patch };
      if (u.role === 'admin' && u.status === 'active' && (next.role !== 'admin' || next.status !== 'active') && !users.some((v) => v.id !== id && v.role === 'admin' && v.status === 'active')) fail(409, 'last_admin', '必须保留至少一个启用的管理员。');
      const invalidate = patch.passwordHash || (patch.role && patch.role !== u.role) || (patch.status && patch.status !== u.status);
      Object.assign(u, patch, { updatedAt: new Date().toISOString() });
      if (invalidate) u.revision++;
      return publicUser(u);
    });
  }
}
