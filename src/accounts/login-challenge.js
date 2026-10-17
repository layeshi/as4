import { randomBytes, randomInt } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createChallenge, verifySolution } from '../../vendor/altcha-lib-2.6.0/dist/esm/v2/pow.js';
import { deriveKey } from '../../vendor/altcha-lib-2.6.0/dist/esm/v2/algorithms/pbkdf2.js';
import { fail } from './store.js';
import { SlidingLimiter } from '../http/util.js';

export const loginCaptchaProvider = (cfg) => cfg.loginCaptcha || (cfg.turnstileSecretKey ? 'turnstile' : 'none');
const limited = () => fail(429, 'rate_limited', '验证请求过多，请稍后重试。');
const invalid = () => fail(403, 'altcha_failed', '验证无效或已过期，请重新验证。');

/** Single-process, one-use login proofs. Restarting intentionally invalidates all outstanding work. */
export class LoginChallenge {
  #entries = new Map();
  #secrets = {
    hmacSignatureSecret: randomBytes(32).toString('hex'),
    hmacKeySignatureSecret: randomBytes(32).toString('hex'),
  };
  #issuing = 0;
  #verifying = 0;
  #closed = false;
  constructor({ maxCounter = 2000, maxEntries = 1000, now = Date.now } = {}) {
    this.maxCounter = maxCounter;
    this.maxEntries = maxEntries;
    this.now = now;
    this.ipLimit = new SlidingLimiter(30, 15 * 60000);
    this.globalLimit = new SlidingLimiter(120, 60000);
    this.timer = setInterval(() => this.sweep(), 30000);
    this.timer.unref();
  }
  sweep() {
    const now = this.now();
    for (const [nonce, entry] of this.#entries) if (entry.expires <= now) this.#entries.delete(nonce);
  }
  async issue(ip) {
    if (this.#closed) limited();
    const now = this.now();
    if (!this.globalLimit.take('all', now) || !this.ipLimit.take(ip, now)) limited();
    this.sweep();
    // Reserve capacity before async crypto so concurrent issuers cannot exceed either bound.
    if (this.#issuing >= 4 || this.#entries.size + this.#issuing >= this.maxEntries) limited();
    this.#issuing++;
    try {
      const challenge = await createChallenge({
        algorithm: 'PBKDF2/SHA-256', cost: 1000,
        counter: randomInt(Math.floor(this.maxCounter / 2), this.maxCounter + 1),
        deriveKey, ...this.#secrets,
        expiresAt: new Date(now + 180000), data: { purpose: 'login' },
      });
      if (this.#closed) limited();
      // Match the JSON wire format (undefined optional parameters are omitted).
      const stored = JSON.parse(JSON.stringify(challenge));
      this.#entries.set(stored.parameters.nonce, { challenge: stored, expires: stored.parameters.expiresAt * 1000 });
      return challenge;
    } finally { this.#issuing--; }
  }
  async verify(token) {
    if (typeof token !== 'string' || !token || token.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(token)) {
      fail(400, 'altcha_required', '请完成登录验证后重试。');
    }
    let payload;
    try { payload = JSON.parse(Buffer.from(token, 'base64').toString('utf8')); }
    catch { fail(400, 'altcha_required', '验证数据无效，请重新验证。'); }
    if (!payload?.challenge?.parameters || !payload.solution) fail(400, 'altcha_required', '验证数据无效，请重新验证。');
    const nonce = payload.challenge.parameters.nonce;
    const entry = this.#entries.get(nonce);
    if (this.#closed || !entry || entry.expires <= this.now()) {
      this.#entries.delete(nonce);
      invalid();
    }
    // Use only our original challenge and its parameters for crypto. Reject changed/cross-purpose data.
    if (!isDeepStrictEqual(payload.challenge, entry.challenge) || entry.challenge.parameters.data.purpose !== 'login') invalid();
    if (!Number.isInteger(payload.solution.counter) || payload.solution.counter < 0 || payload.solution.counter > this.maxCounter ||
        typeof payload.solution.derivedKey !== 'string' || !/^[0-9a-f]{64}$/.test(payload.solution.derivedKey)) invalid();
    if (this.#verifying >= 8) limited();
    this.#verifying++;
    try {
      let result;
      try { result = await verifySolution({ challenge: entry.challenge, solution: payload.solution, deriveKey, ...this.#secrets }); }
      catch { invalid(); }
      if (!result.verified || this.#closed || entry.expires <= this.now() || this.#entries.get(nonce) !== entry) invalid();
      // No await between checking ownership and deleting: exactly one concurrent request consumes it.
      this.#entries.delete(nonce);
    } finally { this.#verifying--; }
  }
  close() {
    this.#closed = true;
    clearInterval(this.timer);
    this.#entries.clear();
  }
}
