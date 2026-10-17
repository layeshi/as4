import { applicablePrices, reservePrices, MODEL_IDS } from './catalog.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { durableFile } from '../durable-file.js';
import { earthDay } from '../shells/budget.js';
import { validTimeZone } from '../shells/config.js';
import { fail } from '../accounts/store.js';

export const MICRO = 1000000;
const safe = n => Number.isSafeInteger(n);
const count = n => safe(n) && n >= 0;
const object = x => x && typeof x === 'object' && !Array.isArray(x);
const idOK = x => typeof x === 'string' && /^[\w:-]{1,128}$/.test(x) && !['__proto__', 'prototype', 'constructor'].includes(x);
const timeOK = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
const fields = ['calls', 'input', 'cacheRead', 'output', 'costMicro'];
export const emptyUsage = () => Object.fromEntries(fields.map(k => [k, 0]));
export function addUsage(a, b) { for (const k of fields) a[k] = checked(BigInt(a[k] ?? 0) + BigInt(b[k] ?? 0)); return a; }
function checked(n) {
  const value = Number(n);
  if (!safe(value)) fail(400, 'amount_overflow', '金额或用量超过支持范围。');
  return value;
}
function ceilMicro(n) { return checked((n + 999999n) / 1000000n); }
export function yuanToMicro(value) {
  const text = String(value);
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(text)) fail(400, 'invalid_price', '单价须为非负金额，最多六位小数。');
  const [whole, fraction = ''] = text.split('.');
  return checked(BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')));
}
export function usageNumbers(usage) {
  if (!object(usage) || (!count(usage.input) && !count(usage.output))) return null;
  const input = count(usage.input) ? usage.input : 0, output = count(usage.output) ? usage.output : 0;
  return { input, output, cacheRead: Math.min(input, count(usage.cacheRead) ? usage.cacheRead : 0) };
}
export function costMicro(usage, prices) {
  const u = usageNumbers(usage);
  if (!u) return null;
  const write = usage.cacheWrite ?? 0, hour = usage.cacheWriteHour ?? 0;
  if (!count(write) || !count(hour) || hour > write || u.cacheRead + write > u.input) return null;
  const terms = [[u.input - u.cacheRead - write, 'miss'], [u.cacheRead, 'hit'], [u.output, 'output'], [write - hour, 'write'], [hour, 'writeHour']];
  if (terms.some(([n, k]) => n && !count(prices[k]))) return null;
  return ceilMicro(terms.reduce((sum, [n, k]) => sum + BigInt(n) * BigInt(prices[k] ?? 0), 0n));
}
export function reservationMicro(chars, maxOutputTokens, prices) {
  if (!count(chars) || !count(maxOutputTokens)) fail(400, 'invalid_usage', '预留用量无效。');
  return ceilMicro(BigInt(chars) * BigInt(Math.max(prices.miss, prices.write ?? 0, prices.writeHour ?? 0, prices.hit ?? 0)) + BigInt(maxOutputTokens) * BigInt(prices.output));
}
export function noteText(value = '', required = false) {
  if (typeof value !== 'string' || [...value].length > 200 || (required && !value.trim())) fail(400, 'invalid_note', '说明最多 200 字，余额调整或拒绝申请必须填写原因。');
  return value.trim();
}
function topupAmount(value) {
  if (!safe(value) || value < MICRO || value > 5000 * MICRO || value % 10000 !== 0) fail(400, 'invalid_amount', '入账金额须为 1–5,000 元，最多两位小数。');
  return value;
}
function dayBefore(day, n) { return new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10); }
function validDay(day) { return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day; }
const cleanUsage = b => Object.fromEntries(fields.map(k => [k, count(b?.[k]) ? b[k] : 0]));

// Financial writes are synchronous transactions: never acknowledge a credit before durable publication.
// Reservations deliberately live outside data, and disappear on process restart.
export class BillingStore {
  constructor({ file = null, timezone = 'Asia/Shanghai', now = Date.now } = {}) {
    this.file = file; this.timezone = validTimeZone(timezone) ? timezone : 'Asia/Shanghai'; this.now = now;
    this.reservations = new Map(); this.fault = false;
    this.data = { version: 1, accounts: Object.create(null), ledger: [], requests: [], daily: [], merges: [], samples: [] };
    this.load(); this.prune();
  }
  load() {
    if (!this.file || !existsSync(this.file)) return;
    let raw;
    try { raw = JSON.parse(readFileSync(this.file, 'utf8')); }
    catch { this.fault = true; return; } // Never silently overwrite a corrupt financial file.
    if (!object(raw) || !object(raw.accounts)) { this.fault = true; return; }
    for (const [id, a] of Object.entries(raw.accounts)) {
      if (!idOK(id) || !object(a) || !safe(a.balanceMicro)) { this.fault = true; continue; }
      this.data.accounts[id] = { balanceMicro: a.balanceMicro, total: cleanUsage(a.total) };
    }
    for (const l of Array.isArray(raw.ledger) ? raw.ledger : []) {
      if (!object(l) || !idOK(l.id) || !idOK(l.accountId) || !idOK(l.adminId) || !timeOK(l.at) || !safe(l.amountMicro) || !['credit', 'adjustment'].includes(l.kind) || typeof l.note !== 'string' || [...l.note].length > 200 || !(l.requestId === null || idOK(l.requestId))) { this.fault = true; continue; }
      this.data.ledger.push({ id: l.id, accountId: l.accountId, adminId: l.adminId, at: l.at, amountMicro: l.amountMicro, kind: l.kind, note: l.note, requestId: l.requestId, ...(idOK(l.originalAccountId) ? { originalAccountId: l.originalAccountId } : {}) });
    }
    this.data.merges = Array.isArray(raw.merges) ? raw.merges.filter(m => idOK(m.id) && idOK(m.from) && idOK(m.to) && safe(m.amountMicro)) : [];
    this.data.samples = (Array.isArray(raw.samples) ? raw.samples : []).filter(s => object(s) && MODEL_IDS.includes(s.model) && count(s.gameTokens) && s.gameTokens > 0 && count(s.input) && count(s.output) && timeOK(s.at)).slice(-900);
    const seen = new Set();
    for (const r of Array.isArray(raw.requests) ? raw.requests : []) {
      if (!object(r) || !idOK(r.id) || !idOK(r.accountId) || !idOK(r.requestId) || seen.has(`${r.accountId}/${r.requestId}`) || !['pending', 'approved', 'rejected', 'cancelled'].includes(r.status) || !timeOK(r.createdAt) || !timeOK(r.updatedAt) || !safe(r.amountMicro) || r.amountMicro < MICRO || r.amountMicro > 5000 * MICRO || r.amountMicro % 10000 || typeof r.note !== 'string' || [...r.note].length > 200 || typeof r.adminNote !== 'string' || [...r.adminNote].length > 200 || !(r.decider === null || idOK(r.decider)) || !(r.decidedAt === null || timeOK(r.decidedAt)) || !(r.cancelledAt === null || timeOK(r.cancelledAt)) || !count(r.creditMicro)) { this.fault = true; continue; }
      seen.add(`${r.accountId}/${r.requestId}`);
      this.data.requests.push(Object.fromEntries(['id','accountId','requestId','amountMicro','note','status','createdAt','updatedAt','decider','decidedAt','cancelledAt','creditMicro','adminNote'].map(k => [k, r[k]])));
      if (idOK(r.originalAccountId)) this.data.requests.at(-1).originalAccountId = r.originalAccountId;
    }
    for (const d of Array.isArray(raw.daily) ? raw.daily : []) {
      if (object(d) && idOK(d.accountId) && idOK(d.residentId) && validDay(d.day)) this.data.daily.push({ accountId: d.accountId, residentId: d.residentId, day: d.day, ...cleanUsage(d), ...(d.basis ? { basis: d.basis, cacheWrite: d.cacheWrite ?? 0, cacheWriteHour: d.cacheWriteHour ?? 0, estimatedCalls: d.estimatedCalls ?? 0 } : {}) });
    }
  }
  day() { return earthDay(this.now(), this.timezone).key; }
  prune() {
    const today = this.day(), first = dayBefore(today, 89);
    const kept = this.data.daily.filter(d => d.day >= first && d.day <= today);
    if (kept.length !== this.data.daily.length && !this.fault) this.transaction(() => { this.data.daily = kept; });
  }
  transaction(fn) {
    if (this.fault) fail(503, 'billing_unavailable', '托管账本暂不可用，请联系管理员。');
    const previous = structuredClone(this.data);
    try { const result = fn(); if (this.file) durableFile(this.file, JSON.stringify(this.data)); return result; }
    catch (e) { this.data = previous; if (!e.status) this.fault = true; throw e; }
  }
  account(id) {
    if (!idOK(id)) fail(400, 'invalid_account', '账号编号无效。');
    if (!Object.hasOwn(this.data.accounts, id)) this.data.accounts[id] = { balanceMicro: 0, total: emptyUsage() };
    return this.data.accounts[id];
  }
  balance(id) { return Object.hasOwn(this.data.accounts, id) ? this.data.accounts[id].balanceMicro : 0; }
  reserved(id) { return [...this.reservations.values()].filter(r => id === undefined || r.accountId === id).reduce((sum, r) => sum + r.amountMicro, 0); }
  available(id) { return this.fault ? -Infinity : this.balance(id) - this.reserved(id); }
  reserve(accountId, residentId, chars, config) {
    const prices = reservePrices(config);
    const amountMicro = reservationMicro(chars, config.maxOutputTokens, prices);
    if (this.available(accountId) < amountMicro) return null;
    const id = randomUUID();
    this.reservations.set(id, { accountId, residentId, amountMicro, prices: { ...prices }, ...(config.version === 2 ? { basis: structuredClone({ model: config.model, priceVersion: config.priceVersion, exchangeRate: config.exchangeRate, multiplier: config.multiplier, usd: config.usd, tiers: config.tiers, pricesMicro: config.pricesMicro, source: 'https://www.openlux.ai/api/pricing_new' }) } : {}) });
    return id;
  }
  release(id) { this.reservations.delete(id); }
  settle(id, usage, meta = {}) {
    const r = this.reservations.get(id);
    if (!r) return 0;
    if (meta.ok === false || meta.cancelled) { this.release(id); return 0; }
    try {
      let used = usageNumbers(usage), prices = r.prices, calculated = null;
      if (r.basis) {
        // Incomplete/malformed upstream usage follows the agreed full-reservation rule.
        if (!count(usage?.input) || !count(usage?.output) || (usage.cacheRead !== undefined && (!count(usage.cacheRead) || usage.cacheRead > usage.input))) used = null;
        try { if (used) prices = applicablePrices(r.basis, used.input); } catch { used = null; }
      }
      if (used) calculated = costMicro(usage, prices);
      const charge = calculated ?? r.amountMicro;
      const basis = r.basis ? { ...r.basis, appliedPricesMicro: prices, settlement: calculated === null ? 'reservation' : 'usage' } : null;
      this.prune();
      this.transaction(() => {
        const a = this.account(r.accountId), day = this.day();
        a.balanceMicro = checked(BigInt(a.balanceMicro) - BigInt(charge));
        const bucket = { ...emptyUsage(), ...used, calls: 1, costMicro: charge };
        let daily = this.data.daily.find(d => d.accountId === r.accountId && d.residentId === r.residentId && d.day === day && (d.basis?.model ?? null) === (r.basis?.model ?? null) && (d.basis?.priceVersion ?? null) === (r.basis?.priceVersion ?? null) && (!basis || (d.basis?.settlement === basis.settlement && JSON.stringify(d.basis?.appliedPricesMicro) === JSON.stringify(prices))));
        if (!daily) this.data.daily.push(daily = { accountId: r.accountId, residentId: r.residentId, day, ...emptyUsage(), ...(r.basis ? { basis, cacheWrite: 0, cacheWriteHour: 0, estimatedCalls: 0 } : {}) });
        addUsage(a.total, bucket); addUsage(daily, bucket);
        if (r.basis) { daily.cacheWrite += count(usage?.cacheWrite) ? usage.cacheWrite : 0; daily.cacheWriteHour += count(usage?.cacheWriteHour) ? usage.cacheWriteHour : 0; if (calculated === null) daily.estimatedCalls++; }
      });
      this.release(id); return charge;
    } catch (e) { this.fault = true; throw e; }
  }
  credit(accountId, amountMicro, adminId, note, requestId = null) {
    const a = this.account(accountId);
    a.balanceMicro = checked(BigInt(a.balanceMicro) + BigInt(amountMicro));
    const entry = { id: randomUUID(), accountId, at: new Date(this.now()).toISOString(), amountMicro, adminId, note, requestId, kind: requestId ? 'credit' : 'adjustment' };
    this.data.ledger.push(entry); return entry;
  }
  adjust(accountId, amountMicro, adminId, note) {
    note = noteText(note, true);
    if (!safe(amountMicro) || amountMicro === 0) fail(400, 'invalid_amount', '调整金额须为非零整数微元，可为负数。');
    return this.transaction(() => this.credit(accountId, amountMicro, adminId, note));
  }
  request(accountId, body) {
    if (!idOK(body.requestId)) fail(400, 'invalid_request', '请提供有效的请求编号（1–128 位字母、数字、下划线、冒号或连字符）。');
    const existing = this.data.requests.find(r => r.accountId === accountId && r.requestId === body.requestId);
    if (existing) return existing;
    const amountMicro = topupAmount(body.amountMicro), note = noteText(body.note), own = this.data.requests.filter(r => r.accountId === accountId);
    if (own.filter(r => r.status === 'pending').length >= 5) fail(429, 'pending_limit', '每个账号最多有 5 个待处理入账申请。');
    if (own.filter(r => Date.parse(r.createdAt) > this.now() - 3600000).length >= 10) fail(429, 'rate_limited', '每小时最多提交 10 次入账申请。');
    return this.transaction(() => {
      const at = new Date(this.now()).toISOString();
      const r = { id: randomUUID(), accountId, requestId: body.requestId, amountMicro, note, status: 'pending', createdAt: at, updatedAt: at, decider: null, decidedAt: null, cancelledAt: null, creditMicro: 0, adminNote: '' };
      this.data.requests.push(r); return r;
    });
  }
  pending(id, accountId) {
    const r = this.data.requests.find(r => r.id === id && (accountId === undefined || r.accountId === accountId));
    if (!r) fail(404, 'not_found', '入账申请不存在。');
    if (r.status !== 'pending') fail(409, 'conflict', '此申请已处理，不能重复操作。');
    return r;
  }
  cancel(id, accountId) {
    const r = this.pending(id, accountId);
    return this.transaction(() => { r.status = 'cancelled'; r.cancelledAt = r.updatedAt = new Date(this.now()).toISOString(); return r; });
  }
  decide(id, adminId, approve, body) {
    const r = this.pending(id), note = noteText(body.note, !approve), amount = approve ? body.creditMicro : 0;
    if (approve && (!safe(amount) || amount <= 0)) fail(400, 'invalid_amount', '实际入账金额须为正整数微元。');
    return this.transaction(() => {
      r.status = approve ? 'approved' : 'rejected'; r.decider = adminId; r.decidedAt = r.updatedAt = new Date(this.now()).toISOString(); r.adminNote = note; r.creditMicro = amount;
      if (approve) this.credit(r.accountId, amount, adminId, note, r.id);
      return r;
    });
  }
  mergeAccounts(id, from, to) {
    if (this.data.merges.some(m => m.id === id)) return;
    if (this.reserved(from) || this.reserved(to)) fail(409, 'billing_busy', '模型费用正在结算，请稍后重试。');
    return this.transaction(() => {
      const source = this.account(from), target = this.account(to), amountMicro = source.balanceMicro;
      addUsage(target.total, source.total); source.total = emptyUsage();
      this.credit(from, -amountMicro, to, '账号合并转出：' + id);
      this.credit(to, amountMicro, to, '账号合并转入：' + id);
      const used = new Set(this.data.requests.filter(r => r.accountId === to).map(r => r.requestId));
      for (const r of this.data.requests) if (r.accountId === from) {
        r.originalAccountId ||= from; r.accountId = to;
        const base = 'merge-' + r.id; let key = base, suffix = 0;
        while (used.has(key)) key = base + '-' + (++suffix);
        r.requestId = key; used.add(key);
      }
      for (const l of this.data.ledger) if (l.accountId === from) { l.originalAccountId ||= from; l.accountId = to; }
      for (const d of this.data.daily) if (d.accountId === from) d.accountId = to;
      this.data.merges.push({ id, from, to, amountMicro });
    });
  }
  recordSample(model, usage, gameTokens) {
    if (!MODEL_IDS.includes(model) || !count(gameTokens) || !gameTokens || !count(usage?.input) || !count(usage?.output)) return;
    this.transaction(() => { this.data.samples.push({ model, ...usage, gameTokens, at: new Date(this.now()).toISOString() }); this.data.samples = this.data.samples.slice(-900); });
  }
  modelSamples(model) {
    const first = this.now() - 30 * 86400000;
    return this.data.samples.filter(s => s.model === model && Date.parse(s.at) >= first).slice(-100).map(({ gameTokens, input, output, cacheRead = 0, cacheWrite = 0, cacheWriteHour = 0 }) => ({ gameTokens, input, output, cacheRead, cacheWrite, cacheWriteHour }));
  }
  accountView(id) {
    this.prune();
    const residents = new Map(), first = dayBefore(this.day(), 29);
    for (const d of this.data.daily) if (d.accountId === id && d.day >= first) {
      if (!residents.has(d.residentId)) residents.set(d.residentId, { residentId: d.residentId, ...emptyUsage() });
      addUsage(residents.get(d.residentId), d);
    }
    return { balanceMicro: this.balance(id), reservedMicro: this.reserved(id), total: structuredClone(this.data.accounts[id]?.total ?? emptyUsage()),
      requests: this.data.requests.filter(r => r.accountId === id).slice(-20).reverse(), ledger: this.data.ledger.filter(r => r.accountId === id).slice(-50).reverse(),
      usage: { timezone: this.timezone, from: first, through: this.day(), residents: [...residents.values()], details: this.data.daily.filter(d => d.accountId === id && d.day >= first).map(d => structuredClone(d)) } };
  }
}
