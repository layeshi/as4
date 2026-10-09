// SPEC-P4: conversion is world-local; historical worlds retain their exact units.
import { P } from '../params.js';
import { tokenized } from '../world.js';
export const K = (w) => tokenized(w) ? w.tokens.k : 1;
export const ep = (w, key) => P[key] * K(w);

import { agentList, isAlive } from '../world.js';
import { textWeight } from '../../text.js';
import { source, sink } from './ledger.js';
import { wake, emit, ReqError } from './core.js';

export const initialTokens = () => ({
  cap: 0, day: null, used: 0, waking: null, bill: null, lastBill: null,
  wakesDay: null, wakes: 0, called: 0, calledCost: 0,
});
export const custodyOf = (a) => textWeight(a.soul) + a.memories.reduce((n, m) => n + textWeight(m.text), 0);
export const validCap = (n) => Number.isSafeInteger(n) && n >= 0 && n <= P.tokenCapMax;
export function requireDailyCap(w, p) {
  if (tokenized(w) && !validCap(p.dailyCap)) throw new ReqError('invalid_request', 'dailyCap');
}

/** All-or-nothing thinking debit, with a monotonic Earth-day key supplied by a command. */
export function payThinking(w, a, n, day) {
  if (n <= 0) return { ok: true, basic: 0, energy: 0 };
  const t = a.tokens;
  if (t.day === null || day > t.day) { t.day = day; t.used = 0; }
  if (t.used + n > t.cap) return { ok: false, code: 'cap_reached', need: n, have: Math.max(0, t.cap - t.used) };
  if (a.basic + a.energy < n) return { ok: false, code: 'tokens_exhausted', need: n, have: a.basic + a.energy };
  const basic = Math.min(a.basic, n);
  a.basic -= basic;
  a.energy -= n - basic;
  t.used += n;
  sink(w, 'energy', 'thinking', n);
  return { ok: true, basic, energy: n - basic };
}

export function expireBasic(w, a) {
  if (a.basic > 0) {
    sink(w, 'energy', 'basic_expired', a.basic);
    w.dayLog.p4.basicExpired += a.basic;
    a.basic = 0;
  }
}
export function issueBasic(w, a) {
  if (a.tokens.cap <= 0) return;
  a.basic = w.tokens.basic;
  source(w, 'energy', 'basic_allotment', a.basic);
  w.dayLog.p4.basicIssued += a.basic;
}
export function startSupport(w, a, cap) {
  a.tokens.cap = cap;
  issueBasic(w, a);
}

/** Settlement 11.5: expire, issue, revive, then pay custody in resident ID order. */
export function settleTokens(w, d) {
  for (const a of agentList(w).filter(isAlive)) {
    expireBasic(w, a);
    issueBasic(w, a);
    if (a.tokens.cap > 0 && a.status === 'dormant') wake(w, a, null);
    if (a.status !== 'awake') continue;
    const need = custodyOf(a), paid = Math.min(need, a.basic + a.energy);
    const basic = Math.min(a.basic, paid);
    a.basic -= basic;
    a.energy -= paid - basic;
    sink(w, 'energy', 'custody', paid);
    w.dayLog.p4.custody += paid;
    if (paid < need) {
      a.status = 'dormant';
      a.dormantSinceDay = d;
      emit(w, 'dormant', { agent: a.id, place: a.place, data: { agentId: a.id } });
    }
  }
}

export const jsonWeight = (x) => textWeight(JSON.stringify(x));
export function actionWeight(act) {
  const { type, ...args } = act;
  return jsonWeight(args);
}
export const rereadCost = (weight) => Math.ceil(weight * P.tokenRereadPermille / 1000);
export const tokenView = (a) => ({ energy: a.energy, basic: a.basic, cap: a.tokens.cap, usedToday: a.tokens.used, routine: { ...a.routine }, lastBill: structuredClone(a.tokens.lastBill), bill: structuredClone(a.tokens.bill) });
export function recordThinking(w, a, parts) {
  let total = 0;
  for (const key of ['reread', 'read', 'write']) {
    const n = parts[key] || 0;
    if (a.tokens.bill) a.tokens.bill[key] += n;
    w.dayLog.p4[key] += n;
    total += n;
  }
  if (a.tokens.waking?.kind === 'wake') a.tokens.calledCost += total;
}
export const activeWaking = (w, a, id) => typeof id === 'string' && a.tokens.waking?.id === id && a.tokens.waking.tick === w.clock.tick;
export const validMeterDay = (day) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day);

export function capDistribution(w) {
  const caps = agentList(w).filter(isAlive).map(a => a.tokens.cap).sort((a, b) => a - b);
  // TODO(spec): Q63 — use nearest-rank percentiles; an empty population reports zero.
  const percentile = p => caps.length ? caps[Math.ceil(caps.length * p) - 1] : 0;
  return { count: caps.length, zero: caps.filter(n => n === 0).length, p50: percentile(.5), p90: percentile(.9), max: caps.at(-1) ?? 0 };
}
