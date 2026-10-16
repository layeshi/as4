import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { AccountStore } from '../src/accounts/store.js';
import { VerificationService, normalizeContact } from '../src/accounts/verification.js';
import { identityHash } from '../src/wechat/service.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const password = 'a-long-test-password';
function client(e) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async call(path, body, method = body === undefined ? 'GET' : 'POST') {
      const r = await e.call(path, { method, body, headers: { Cookie: cookie, 'X-Houren-Request': '1' } });
      if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
      return r;
    },
  };
}
async function setup() {
  const e = await boot({ turnstileSiteKey: 'site', turnstileSecretKey: 'secret' });
  const sent = [];
  e.app.ctx.verifyLoginTurnstile = async (_secret, token) => { assert.equal(token, 'challenge'); };
  e.app.ctx.verification.delivery = {
    emailReady: true, phoneReady: true,
    async sendEmail(address, code, purpose) { sent.push({ address, code, purpose }); },
    async sendSms(phone, purpose, id) { sent.push({ phone, code: '123456', purpose, id }); },
    async checkSms(phone, code) { return code === '123456' && sent.some(row => row.phone === phone); },
  };
  return { e, sent };
}
async function proof(c, sent, purpose, channel, value) {
  const r = await c.call('/api/account/verification/request', { purpose, channel, value, turnstileToken: 'challenge' });
  assert.equal(r.status, 200, r.text);
  const code = sent.at(-1)?.code;
  const verified = await c.call('/api/account/verification/confirm', { challengeId: r.json.challengeId, code });
  assert.equal(verified.status, 200, verified.text);
  return verified.json.proof;
}

test('registration requires verified contact, rejects reuse, and recovery revokes old sessions', async () => {
  const { e, sent } = await setup();
  const a = client(e), b = client(e);
  try {
    assert.equal((await a.call('/api/account/register', { username: 'alice', password })).json.error.code, 'verification_required');
    const token = await proof(a, sent, 'register', 'email', 'Alice@Example.org');
    const registered = await a.call('/api/account/register', { username: 'alice', password, proof: token });
    assert.equal(registered.status, 201, registered.text);
    assert.equal(registered.json.user.contacts.email, 'al***@example.org');
    assert.equal(e.app.ctx.accounts.get(registered.json.user.id).contacts.email, 'alice@example.org');
    assert.equal((await b.call('/api/account/login', { username: 'alice', password, turnstileToken: 'challenge' })).status, 200);
    const duplicate = await proof(client(e), sent, 'register', 'email', 'alice@example.org');
    assert.equal((await client(e).call('/api/account/register', { username: 'another', password, proof: duplicate })).json.error.code, 'contact_taken');
    const unknown = await client(e).call('/api/account/verification/request', { purpose: 'recover', channel: 'email', value: 'missing@example.org', turnstileToken: 'challenge' });
    assert.equal(unknown.status, 200);
    e.app.ctx.verification.delivery.sendEmail = async () => { throw new Error('upstream unavailable'); };
    const unavailable = await client(e).call('/api/account/verification/request', { purpose: 'recover', channel: 'email', value: 'alice@example.org', turnstileToken: 'challenge' });
    assert.equal(unavailable.status, unknown.status);
    assert.equal(unavailable.json.message, unknown.json.message);
    e.app.ctx.verification.delivery.sendEmail = async (address, code, purpose) => { sent.push({ address, code, purpose }); };
    const resetProof = await proof(client(e), sent, 'recover', 'email', 'alice@example.org');
    assert.equal((await client(e).call('/api/account/recovery', { proof: resetProof, password: 'new-long-password' })).status, 200);
    assert.equal((await a.call('/api/account')).json.user, null);
    assert.equal((await b.call('/api/account')).json.user, null);
    assert.equal((await a.call('/api/account/login', { username: 'alice', password: 'new-long-password', turnstileToken: 'challenge' })).status, 200);
    assert.equal((await a.call('/api/account/recovery', { proof: resetProof, password })).json.error.code, 'verification_required');
  } finally { await e.close(); }
});

test('admin-created user verifies contact before first password session', async () => {
  const { e, sent } = await setup(); const admin = client(e), user = client(e);
  try {
    assert.equal((await admin.call('/api/account/setup', { username: 'chief', password, adminKey: e.cfg.adminKey })).status, 201);
    assert.equal((await admin.call('/api/admin/users', { username: 'newuser', password })).status, 201);
    assert.equal((await user.call('/api/account/login', { username: 'newuser', password, turnstileToken: 'challenge' })).status, 428);
    const token = await proof(user, sent, 'first_login', 'email', 'new@example.org');
    assert.equal((await user.call('/api/account/login', { username: 'newuser', password, proof: token, turnstileToken: 'challenge' })).status, 200);
    assert.equal((await user.call('/api/account')).json.user.contacts.email, 'ne***@example.org');
  } finally { await e.close(); }
});

test('contact changes require reauthentication and keep a recovery channel', async () => {
  const { e, sent } = await setup(); const c = client(e);
  try {
    const initial = await proof(c, sent, 'register', 'email', 'person@example.org');
    assert.equal((await c.call('/api/account/register', { username: 'person', password, proof: initial })).status, 201);
    const next = await proof(c, sent, 'contact', 'phone', '+8613812345678');
    assert.equal((await c.call('/api/account/contacts', { proof: next, currentPassword: 'wrong' })).status, 401);
    assert.equal((await c.call('/api/account/contacts', { proof: next, currentPassword: password })).status, 200);
    assert.equal((await c.call('/api/account/contacts/email', { currentPassword: password }, 'DELETE')).status, 200);
    assert.equal((await c.call('/api/account/contacts/phone', { currentPassword: password }, 'DELETE')).json.error.code, 'last_contact');
  } finally { await e.close(); }
});

test('unbinding one WeChat app removes its sessions but preserves password sessions and other bindings', async () => {
  const { e, sent } = await setup(); const c = client(e);
  try {
    const initial = await proof(c, sent, 'register', 'email', 'wechat@example.org');
    const user = (await c.call('/api/account/register', { username: 'wechatuser', password, proof: initial })).json.user;
    const store = e.app.ctx.accounts;
    const first = identityHash('wx1111111111111111', 'openid-one-12345');
    const second = identityHash('wx2222222222222222', 'openid-two-12345');
    await store.wechatLogin(first, { bindId: user.id, appid: 'wx1111111111111111' });
    await store.wechatLogin(second, { bindId: user.id, appid: 'wx2222222222222222' });
    const firstToken = store.issue(user.id, { wechat: { appid: 'wx1111111111111111', openid: 'openid-one-12345' } });
    const secondToken = store.issue(user.id, { wechat: { appid: 'wx2222222222222222', openid: 'openid-two-12345' } });
    const passwordToken = store.issue(user.id);
    const r = await c.call('/api/account/wechat/wx1111111111111111', { currentPassword: password }, 'DELETE');
    assert.equal(r.status, 200, r.text);
    assert.equal(store.session(firstToken), null);
    assert.ok(store.session(secondToken));
    assert.ok(store.session(passwordToken));
    assert.deepEqual(r.json.user.wechatApps, ['wx2222222222222222']);
  } finally { await e.close(); }
});

test('stored legacy account still signs in without contact', async () => {
  const { e } = await setup(); const c = client(e);
  try {
    const store = new AccountStore(e.dir);
    await store.create({ username: 'legacy', password });
    e.app.ctx.accounts.data = store.data;
    assert.equal((await c.call('/api/account/login', { username: 'legacy', password, turnstileToken: 'challenge' })).status, 200);
  } finally { await e.close(); }
});

test('verification codes expire, lock after five mistakes, and invalidate older codes', async () => {
  let now = Date.now(), code = '';
  const service = new VerificationService({ emailReady: true, phoneReady: false, async sendEmail(_address, value) { code = value; } }, { now: () => now });
  const args = { purpose: 'register', channel: 'email', value: 'one@example.org', ip: '192.0.2.1' };
  const first = await service.request(args);
  await assert.rejects(service.request(args), { code: 'rate_limited' });
  for (let i = 0; i < 5; i++) await assert.rejects(service.confirm(first.challengeId, code === '000000' ? '111111' : '000000'), { code: 'invalid_code' });
  await assert.rejects(service.confirm(first.challengeId, code), { code: 'invalid_code' });
  now += 60000;
  const second = await service.request(args);
  const old = code;
  const olderProof = (await service.confirm(second.challengeId, old)).proof;
  now += 60000;
  const third = await service.request(args);
  assert.notEqual(second.challengeId, third.challengeId);
  assert.throws(() => service.consume(olderProof, 'register'), { code: 'verification_required' });
  await assert.rejects(service.confirm(second.challengeId, old), { code: 'invalid_code' });
  const accepted = await service.confirm(third.challengeId, code);
  assert.equal(service.consume(accepted.proof, 'register').contact, 'one@example.org');
  assert.throws(() => service.consume(accepted.proof, 'register'), { code: 'verification_required' });
  now += 6 * 60000;
  const stale = await service.request({ ...args, value: 'two@example.org' });
  now += 6 * 60000;
  await assert.rejects(service.confirm(stale.challengeId, code), { code: 'invalid_code' });
});

test('SMS daily cap survives a restart and contact input is canonical', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-sms-cap-'));
  let now = Date.now();
  const file = join(dir, 'budget.json');
  const delivery = { emailReady: true, phoneReady: true, async sendSms() {}, async checkSms() { return true; } };
  try {
    assert.equal(normalizeContact('phone', '138 1234 5678'), '+8613812345678');
    assert.equal(normalizeContact('email', ' Alice@Example.org '), 'alice@example.org');
    const first = new VerificationService(delivery, { now: () => now, smsDailyLimit: 2, counterFile: file });
    await first.request({ purpose: 'register', channel: 'phone', value: '13812345678', ip: 'one' });
    await first.request({ purpose: 'register', channel: 'phone', value: '13912345678', ip: 'two' });
    const restarted = new VerificationService(delivery, { now: () => now, smsDailyLimit: 2, counterFile: file });
    await assert.rejects(restarted.request({ purpose: 'register', channel: 'phone', value: '13712345678', ip: 'three' }), { code: 'sms_daily_limit' });
    now += 24 * 60 * 60000;
    assert.ok((await restarted.request({ purpose: 'register', channel: 'phone', value: '13712345678', ip: 'four' })).challengeId);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
