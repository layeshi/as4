import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { domainToASCII } from 'node:url';
import { durableFile } from '../durable-file.js';
import { SlidingLimiter } from '../http/util.js';
import { fail } from './store.js';

const hash = value => createHash('sha256').update(value).digest();
const TTL = 5 * 60 * 1000;
const PURPOSES = new Set(['register', 'first_login', 'recover', 'contact']);

export function normalizeContact(channel, value) {
  if (channel === 'phone') {
    const compact = typeof value === 'string' ? value.replace(/[\s-]/g, '') : '';
    const phone = compact.startsWith('+86') ? compact : '+86' + compact;
    if (!/^\+861[3-9]\d{9}$/.test(phone)) fail(400, 'invalid_contact', '请输入有效的中国大陆手机号。');
    return phone;
  }
  if (channel === 'email' && typeof value === 'string') {
    const raw = value.trim();
    const at = raw.lastIndexOf('@');
    const local = raw.slice(0, at), domain = domainToASCII(raw.slice(at + 1));
    if (at < 1 || raw.length > 254 || local.length > 64 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
      || !/^(?=.{1,253}$)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(domain)
      || domain.split('.').some(part => part.startsWith('-') || part.endsWith('-'))) fail(400, 'invalid_contact', '请输入有效的邮箱地址。');
    return `${local.toLowerCase()}@${domain.toLowerCase()}`;
  }
  fail(400, 'invalid_contact', '请选择邮箱或手机号。');
}

export class VerificationService {
  constructor(delivery, { smsDailyLimit = 100, now = Date.now, counterFile = null } = {}) {
    this.delivery = delivery;
    this.now = now;
    this.smsDailyLimit = smsDailyLimit;
    this.challenges = new Map();
    this.proofs = new Map();
    this.ipLimit = new SlidingLimiter(20, 15 * 60000);
    this.contactLimit = new SlidingLimiter(5, 24 * 60 * 60000);
    this.smsDay = '';
    this.smsCount = 0;
    this.counterFile = counterFile;
    if (counterFile) {
      try {
        const saved = JSON.parse(readFileSync(counterFile, 'utf8'));
        if (saved.version !== 1 || typeof saved.day !== 'string' || !Number.isSafeInteger(saved.count) || saved.count < 0) throw new Error('Invalid SMS budget');
        this.smsDay = saved.day; this.smsCount = saved.count;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  available(channel) { return channel === 'email' ? this.delivery.emailReady : channel === 'phone' && this.delivery.phoneReady; }
  prune() {
    for (const [id, row] of this.challenges) if (row.expires <= this.now()) this.challenges.delete(id);
    for (const [key, row] of this.proofs) if (row.expires <= this.now()) this.proofs.delete(key);
  }
  async request({ channel, value, purpose, ip, ownerId = null, userId = null, deliver = true, deferDelivery = false }) {
    if (!PURPOSES.has(purpose)) fail(400, 'invalid_request', '验证用途无效。');
    const contact = normalizeContact(channel, value);
    if (!this.available(channel)) fail(503, 'verification_unavailable', '验证服务暂不可用，请稍后重试。');
    this.prune();
    if ([...this.challenges.values()].some(row => row.channel === channel && row.contact === contact && row.purpose === purpose && row.expires - TTL + 60000 > this.now())) fail(429, 'rate_limited', '请在 60 秒后重新发送。');
    if (this.challenges.size >= 10000 || !this.ipLimit.take(ip, this.now()) || !this.contactLimit.take(`${channel}:${contact}`, this.now())) fail(429, 'rate_limited', '验证码发送过于频繁，请稍后再试。');
    if (channel === 'phone') {
      const day = new Date(this.now()).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
      if (this.smsDay !== day) { this.smsDay = day; this.smsCount = 0; }
      if (this.smsCount >= this.smsDailyLimit) fail(429, 'sms_daily_limit', '今日短信验证码发送已达上限，请稍后再试。');
      if (deliver) {
        this.smsCount++;
        if (this.counterFile) durableFile(this.counterFile, JSON.stringify({ version: 1, day: this.smsDay, count: this.smsCount }));
      }
    }
    const id = randomBytes(16).toString('hex');
    const code = channel === 'email' ? String(randomInt(1000000)).padStart(6, '0') : null;
    const row = { channel, contact, purpose, ownerId, userId, decoy: !deliver, codeHash: code ? hash(code) : null, attempts: 0, expires: this.now() + TTL };
    this.challenges.set(id, row);
    const send = async () => {
      try {
        if (deliver) {
          if (channel === 'email') await this.delivery.sendEmail(contact, code, purpose);
          else await this.delivery.sendSms(contact, purpose, id);
        }
      } catch (error) {
        this.challenges.delete(id);
        if (!deferDelivery) throw error;
        return;
      }
      if (!deliver) return;
      for (const [previousId, previous] of this.challenges) if (previousId !== id && previous.channel === channel && previous.contact === contact && previous.purpose === purpose) this.challenges.delete(previousId);
      for (const [proofId, previous] of this.proofs) if (previous.channel === channel && previous.contact === contact && previous.purpose === purpose) this.proofs.delete(proofId);
    };
    if (deferDelivery) void send();
    else await send();
    return { challengeId: id, expiresIn: 300 };
  }
  async confirm(id, code) {
    this.prune();
    const row = typeof id === 'string' && this.challenges.get(id);
    if (!row || typeof code !== 'string' || !/^\d{6}$/.test(code)) fail(400, 'invalid_code', '验证码无效或已过期。');
    if (++row.attempts >= 5) this.challenges.delete(id);
    let valid = false;
    if (!row.decoy) {
      if (row.channel === 'email') valid = timingSafeEqual(hash(code), row.codeHash);
      else valid = await this.delivery.checkSms(row.contact, code, row.purpose, id);
    }
    if (!valid) fail(400, 'invalid_code', '验证码无效或已过期。');
    this.challenges.delete(id);
    const proof = randomBytes(32).toString('hex');
    this.proofs.set(hash(proof).toString('hex'), { ...row, expires: this.now() + TTL });
    return { proof, expiresIn: 300 };
  }
  consume(proof, purpose, ownerId = null) {
    this.prune();
    const key = typeof proof === 'string' && /^[a-f0-9]{64}$/.test(proof) ? hash(proof).toString('hex') : '';
    const row = this.proofs.get(key);
    if (!row || row.purpose !== purpose || row.ownerId !== ownerId) fail(400, 'verification_required', '请先完成联系方式验证。');
    this.proofs.delete(key);
    return row;
  }
}
