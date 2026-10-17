import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LoginChallenge } from '../src/accounts/login-challenge.js';
import { solveChallenge } from '../vendor/altcha-lib-2.6.0/dist/esm/v2/pow.js';
import { deriveKey } from '../vendor/altcha-lib-2.6.0/dist/esm/v2/algorithms/pbkdf2.js';
import { SlidingLimiter } from '../src/http/util.js';
import { loadConfig } from '../src/config.js';
import { boot } from './http-helpers.js';

const payload = (challenge, solution) => Buffer.from(JSON.stringify({ challenge, solution })).toString('base64');
async function solve(challenge) {
  const solution = await solveChallenge({ challenge, deriveKey, timeout: 10000 });
  assert.ok(solution);
  return payload(challenge, solution);
}
const make = (options = {}) => new LoginChallenge({ maxCounter: 20, ...options });
const login = (e, body, ip = '192.0.2.1') => e.call('/api/account/login', { method: 'POST', headers: { 'X-Houren-Request': '1' }, body, ip });
const issue = (e, ip = '192.0.2.1') => e.call('/api/account/challenge', { headers: { 'X-Houren-Request': '1' }, ip });
const credentials = { username: 'captcha_user', displayName: 'Captcha User', password: 'captcha-test-password' };

test('ALTCHA overrides legacy login keys while contact-verification keeps its own Turnstile guard', async () => {
  const e = await boot({ loginCaptcha: 'altcha', altchaMaxCounter: 20, turnstileSiteKey: 'contact-site', turnstileSecretKey: 'contact-secret' });
  try {
    await e.app.ctx.accounts.create(credentials);
    const account = (await e.call('/api/account')).json;
    assert.equal(account.loginCaptcha.provider, 'altcha');
    assert.equal(account.turnstileSiteKey, 'contact-site');
    let contacts = 0;
    e.app.ctx.verifyLoginTurnstile = async (_secret, _token, _ip, _fetch, action) => {
      assert.equal(action, 'verify'); contacts++;
    };
    e.app.ctx.verification.request = async () => ({ challengeId: 'test-contact' });
    const token = await solve((await issue(e)).json);
    assert.equal((await login(e, { ...credentials, altcha: token })).status, 200);
    assert.equal(contacts, 0);
    const contact = await e.call('/api/account/verification/request', { method: 'POST', headers: { 'X-Houren-Request': '1' }, body: { purpose: 'recover', channel: 'email', value: 'test@example.org', turnstileToken: 'contact-proof' } });
    assert.equal(contact.status, 200);
    assert.equal(contacts, 1);
    assert.match((await e.call('/login.html')).headers.get('content-security-policy'), /challenges.cloudflare.com/);
  } finally { await e.close(); }
});

test('ALTCHA configuration is explicit, validated and compatible with legacy configuration', () => {
  assert.equal(loadConfig({ LOGIN_CAPTCHA: 'altcha' }, []).loginCaptcha, 'altcha');
  assert.equal(loadConfig({}, []).loginCaptcha, null);
  assert.throws(() => loadConfig({ LOGIN_CAPTCHA: 'typo' }, []));
  assert.throws(() => loadConfig({ LOGIN_CAPTCHA: 'turnstile' }, []));
  for (const value of ['0', '499', '20001', '1.5', 'NaN']) assert.throws(() => loadConfig({ ALTCHA_MAX_COUNTER: value }, []));
});

test('official snapshots retain their verified bytes and licenses', () => {
  const manifest = JSON.parse(readFileSync(new URL('../vendor/altcha-manifest.json', import.meta.url)));
  for (const pkg of manifest) for (const [file, expected] of Object.entries(pkg.files)) {
    const bytes = readFileSync(new URL(`../${pkg.root}/${file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `${pkg.name}: ${file}`);
  }
});

test('signed challenges reject malformed, modified and incorrect payloads without consuming valid work', async () => {
  const service = make();
  try {
    const challenge = await service.issue('ip');
    const token = await solve(challenge);
    for (const invalid of ['', {}, '!', 'A'.repeat(4097), Buffer.from('{}').toString('base64')]) {
      await assert.rejects(service.verify(invalid), { status: 400 });
    }
    for (const change of [c => { c.parameters.data.purpose = 'register'; }, c => { c.parameters.cost = 1; }, c => { c.parameters.expiresAt += 3600; }, c => { c.signature = '0'.repeat(64); }]) {
      const modified = JSON.parse(Buffer.from(token, 'base64'));
      change(modified.challenge);
      await assert.rejects(service.verify(payload(modified.challenge, modified.solution)), { status: 403 });
    }
    const wrong = JSON.parse(Buffer.from(token, 'base64'));
    wrong.solution.derivedKey = '0'.repeat(64);
    await assert.rejects(service.verify(payload(wrong.challenge, wrong.solution)), { status: 403 });
    await service.verify(token);
    await assert.rejects(service.verify(token), { status: 403 });
  } finally { service.close(); }
});

test('exactly one concurrent submission can consume a challenge; a new instance rejects old work', async () => {
  const service = make(), restarted = make();
  try {
    const token = await solve(await service.issue('ip'));
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => service.verify(token)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const unused = await solve(await service.issue('ip'));
    await assert.rejects(restarted.verify(unused), { status: 403 });
  } finally { service.close(); restarted.close(); }
});

test('expiry and capacity fail closed without evicting live challenges', async () => {
  let now = Date.now();
  const service = make({ now: () => now, maxEntries: 1 });
  try {
    const challenge = await service.issue('ip');
    const token = await solve(challenge);
    await assert.rejects(service.issue('other'), { status: 429 });
    await service.verify(token);
    const next = await service.issue('other');
    const expired = await solve(next);
    now = next.parameters.expiresAt * 1000;
    await assert.rejects(service.verify(expired), { status: 403 });
    assert.ok(await service.issue('other'));
  } finally { service.close(); }
});

test('challenge issuance limits per-IP and global requests and reserves capacity before async work', async () => {
  const service = make({ maxEntries: 1 });
  try {
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, n) => service.issue(`ip-${n}`)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  } finally { service.close(); }
  const perIp = make();
  try {
    for (let n = 0; n < 30; n++) await perIp.issue('ip');
    await assert.rejects(perIp.issue('ip'), { status: 429 });
    assert.ok(await perIp.issue('other'));
  } finally { perIp.close(); }
  const global = make();
  try {
    for (let n = 0; n < 120; n++) await global.issue(`ip-${n}`);
    await assert.rejects(global.issue('new'), { status: 429 });
  } finally { global.close(); }
});

test('bounded limiters preserve active keys and reclaim expired capacity', () => {
  const limiter = new SlidingLimiter(1, 1000, 2);
  assert.equal(limiter.take('a', 1000), true);
  assert.equal(limiter.take('b', 1000), true);
  assert.equal(limiter.take('c', 1000), false);
  assert.equal(limiter.take('a', 1000), false);
  assert.equal(limiter.take('c', 3000), true);
});

test('ALTCHA login works offline, consumes failed-password work and protects account quota', async () => {
  const e = await boot({ loginCaptcha: 'altcha', altchaMaxCounter: 20 });
  try {
    await e.app.ctx.accounts.create(credentials);
    e.app.ctx.verifyLoginTurnstile = () => { throw new Error('Must not contact Cloudflare'); };
    assert.equal((await e.call('/api/account')).json.loginCaptcha.provider, 'altcha');
    assert.equal((await e.call('/api/account/challenge')).status, 403);
    const issued = await issue(e);
    assert.equal(issued.status, 200);
    assert.equal(issued.headers.get('cache-control'), 'no-store');
    for (let n = 0; n < 15; n++) assert.equal((await login(e, credentials)).json.error.code, 'altcha_required');
    assert.equal(e.app.ctx.accountLimits.username.hits.has(credentials.username), false);
    const token = await solve(issued.json);
    assert.equal((await login(e, { ...credentials, password: 'wrong', altcha: token }, '192.0.2.2')).status, 401);
    assert.equal((await login(e, { ...credentials, altcha: token }, '192.0.2.2')).status, 403);
    const fresh = await solve((await issue(e, '192.0.2.2')).json);
    const loggedIn = await login(e, { ...credentials, altcha: fresh }, '192.0.2.2');
    assert.equal(loggedIn.status, 200);
    assert.match(loggedIn.headers.get('set-cookie'), /HttpOnly/);
    const page = await e.call('/');
    assert.ok(!page.headers.get('content-security-policy').includes('cloudflare'));
    assert.match(page.headers.get('content-security-policy'), /worker-src 'self'/);
    for (const path of ['/vendor/altcha-3.4.0/dist/external/altcha.min.js', '/vendor/altcha-3.4.0/dist/external/altcha.css', '/vendor/altcha-3.4.0/dist/workers/pbkdf2.js', '/vendor/altcha-3.4.0/dist/i18n/zh-cn.js']) assert.equal((await e.call(path)).status, 200);
  } finally { await e.close(); }
});

test('Turnstile also checks proof before consuming account quota; disabled provider rejects challenge issuance', async () => {
  const e = await boot({ turnstileSiteKey: 'site', turnstileSecretKey: 'secret' });
  try {
    for (let n = 0; n < 15; n++) assert.equal((await login(e, credentials)).json.error.code, 'turnstile_required');
    assert.equal(e.app.ctx.accountLimits.username.hits.has(credentials.username), false);
    assert.equal((await issue(e)).status, 404);
    assert.ok((await e.call('/')).headers.get('content-security-policy').includes('challenges.cloudflare.com'));
  } finally { await e.close(); }
});
