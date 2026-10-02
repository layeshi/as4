import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { boot } from './http-helpers.js';
import { AccountStore } from '../src/accounts/store.js';
const pass = 'a-long-test-password';
const person = (username, extra = {}) => ({ username, displayName: `User ${username}`, password: pass, ...extra });
function client(e) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async call(path, body, method = body === undefined ? 'GET' : 'POST', extra = {}) {
      const r = await e.call(path, { method, body, headers: { Cookie: cookie, 'X-Houren-Request': '1', ...extra } });
      if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
      return r;
    },
  };
}
test('registration, profile, login, logout, persistence and secret boundaries', async () => {
  const e = await boot(); const c = client(e);
  try {
    assert.equal((await c.call('/api/account')).json.user, null);
    const r = await c.call('/api/account/register', person('Alice', { role: 'admin' }));
    assert.equal(r.status, 201); assert.equal(r.json.user.role, 'user'); assert.equal(r.json.user.username, 'alice');
    assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await c.call('/api/account')).json.user.id, r.json.user.id);
    assert.equal((await c.call('/api/account', { displayName: 'New name' }, 'PATCH')).json.user.displayName, 'New name');
    assert.equal((await c.call('/api/account', { role: 'admin' }, 'PATCH')).status, 403);
    assert.equal((await c.call('/api/account/register', person('ALICE'))).status, 409);
    const disk = readFileSync(join(e.dir, 'accounts.json'), 'utf8');
    assert.ok(!disk.includes(pass)); assert.ok(!JSON.stringify(r.json).includes('passwordHash'));
    assert.equal(statSync(join(e.dir, 'accounts.json')).mode & 0o777, 0o600);
    const fresh = new AccountStore(e.dir);
    assert.equal((await fresh.login(person('alice'))).displayName, 'New name');
    assert.equal(fresh.session(c.cookie.split('=')[1]), null, 'sessions do not survive a restart');
    const oldCookie = c.cookie;
    assert.equal((await c.call('/api/account/logout', {})).status, 200);
    assert.equal((await e.call('/api/account', { headers: { Cookie: oldCookie } })).json.user, null);
    assert.equal((await c.call('/api/account/login', person('alice', { password: 'bad' }))).status, 401);
    assert.equal((await c.call('/api/account/login', person('alice'))).status, 200);
  } finally { await e.close(); }
});
test('password change verifies old password, revokes other sessions and rotates current cookie', async () => {
  const e = await boot(); const a = client(e), b = client(e);
  try {
    await a.call('/api/account/register', person('alice'));
    await b.call('/api/account/login', person('alice'));
    assert.equal((await a.call('/api/account', { currentPassword: 'wrong', password: 'new-long-password' }, 'PATCH')).status, 401);
    assert.equal((await a.call('/api/account', { currentPassword: pass, password: 'new-long-password' }, 'PATCH')).status, 200);
    assert.ok((await a.call('/api/account')).json.user);
    assert.equal((await b.call('/api/account')).json.user, null);
    assert.equal((await b.call('/api/account/login', person('alice'))).status, 401);
    assert.equal((await b.call('/api/account/login', person('alice', { password: 'new-long-password' }))).status, 200);
  } finally { await e.close(); }
});
test('admin initialization, management, privilege isolation and last-admin protection', async () => {
  const e = await boot(); const admin = client(e), user = client(e);
  try {
    assert.equal((await user.call('/api/admin/users')).status, 401);
    assert.equal((await admin.call('/api/account/setup', person('chief', { adminKey: 'wrong' }))).status, 403);
    assert.equal((await admin.call('/api/account/setup', person('chief', { adminKey: e.cfg.adminKey }))).status, 201);
    const chief = (await admin.call('/api/account')).json.user;
    const r = await user.call('/api/account/register', person('alice'));
    const id = r.json.user.id;
    assert.equal((await user.call('/api/admin/users')).status, 403);
    assert.equal((await user.call(`/api/admin/users/${chief.id}`, { role: 'user' }, 'PATCH')).status, 403);
    assert.equal((await admin.call(`/api/admin/users/${chief.id}`, { status: 'disabled' }, 'PATCH')).status, 409);
    assert.equal((await admin.call('/api/account/setup', person('other', { adminKey: e.cfg.adminKey }))).status, 409);
    assert.equal((await admin.call('/api/admin/users?q=alice')).json.total, 1);
    assert.equal((await admin.call(`/api/admin/users/${id}`, { status: 'disabled' }, 'PATCH')).status, 200);
    assert.equal((await user.call('/api/account')).json.user, null);
    assert.equal((await user.call('/api/account/login', person('alice'))).status, 401);
    assert.equal((await admin.call(`/api/admin/users/${id}`, { status: 'active', password: 'reset-long-password' }, 'PATCH')).status, 200);
    assert.equal((await user.call('/api/account/login', person('alice', { password: 'reset-long-password' }))).status, 200);
    assert.equal((await admin.call(`/api/admin/users/${id}`, { role: 'admin' }, 'PATCH')).status, 200);
    assert.equal((await user.call('/api/admin/users')).status, 401);
    await user.call('/api/account/login', person('alice', { password: 'reset-long-password' }));
    assert.equal((await user.call('/api/admin/users')).status, 200);
    assert.equal((await admin.call('/api/admin/users', person('created'))).status, 201);
    assert.equal((await admin.call(`/api/admin/users/${chief.id}`, { role: 'user' }, 'PATCH')).status, 200);
    assert.equal((await admin.call('/api/admin/users')).status, 401);
  } finally { await e.close(); }
});
test('CSRF, input validation, closed registration and secure proxy cookies', async () => {
  const e = await boot({ registrationOpen: false }); const c = client(e);
  try {
    assert.equal((await e.call('/api/account/login', { method: 'POST', body: person('alice') })).status, 403);
    assert.equal((await c.call('/api/account/login', person('alice'), 'POST', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await c.call('/api/account/register', person('alice'))).status, 403);
    const r = await c.call('/api/account/setup', person('chief', { adminKey: e.cfg.adminKey }), 'POST', { 'X-Forwarded-Proto': 'https' });
    assert.equal(r.status, 201); assert.match(r.headers.get('set-cookie'), /; Secure/);
    assert.equal((await c.call('/api/admin/users', person('__proto__', { password: 'short' }))).status, 400);
    assert.equal((await c.call('/api/admin/users', person('bad user'))).status, 400);
  } finally { await e.close(); }
});
test('concurrent registrations remain unique and login attempts are limited', async () => {
  const e = await boot(); const c = client(e);
  try {
    const responses = await Promise.all([c.call('/api/account/register', person('same')), c.call('/api/account/register', person('SAME'))]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    for (let i = 0; i < 15; i++) assert.equal((await c.call('/api/account/login', person('missing'))).status, 401);
    assert.equal((await c.call('/api/account/login', person('missing'))).status, 429);
  } finally { await e.close(); }
});
test('in-flight administrator creation rechecks revoked privileges after password work', async () => {
  const e = await boot(); const a = client(e), b = client(e);
  try {
    const first = await a.call('/api/account/setup', person('first', { adminKey: e.cfg.adminKey }));
    await a.call('/api/admin/users', person('second', { role: 'admin' }));
    await b.call('/api/account/login', person('second'));
    const store = e.app.ctx.accounts;
    const expensive = store.expensive.bind(store);
    let release, started;
    const gate = new Promise((resolve) => { release = resolve; });
    const entered = new Promise((resolve) => { started = resolve; });
    store.expensive = async (fn) => { started(); await gate; return expensive(fn); };
    const pending = a.call('/api/admin/users', person('should_not_exist'));
    await entered;
    assert.equal((await b.call(`/api/admin/users/${first.json.user.id}`, { role: 'user' }, 'PATCH')).status, 200);
    release();
    assert.equal((await pending).status, 401);
    assert.equal(store.data.users.some((u) => u.username === 'should_not_exist'), false);
  } finally { await e.close(); }
});
test('session expiration, unchanged role updates and corrupt stores fail safely', async () => {
  const e = await boot(); const a = client(e);
  try {
    const r = await a.call('/api/account/setup', person('chief', { adminKey: e.cfg.adminKey }));
    assert.equal((await a.call(`/api/admin/users/${r.json.user.id}`, { displayName: 'Renamed', role: 'admin', status: 'active' }, 'PATCH')).status, 200);
    assert.equal((await a.call('/api/admin/users')).status, 200, 'unchanged role and status do not invalidate session');
    for (const s of e.app.ctx.accounts.sessions.values()) s.expires = Date.now() - 1;
    assert.equal((await a.call('/api/account')).json.user, null);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(e.dir, 'accounts.json'), '{broken');
    assert.throws(() => new AccountStore(e.dir));
  } finally { await e.close(); }
});
