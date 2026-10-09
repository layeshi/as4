// Pricing commands contain integer weights and an Earth day, never rendered text.
import { P } from '../params.js';
import { tokenized, clockDay, isAlive } from '../world.js';
import { bad, pushInbox } from './core.js';
import { source } from './ledger.js';
import { payThinking, recordThinking, rereadCost, tokenView, activeWaking, validMeterDay, validCap } from './tokens.js';
const weight = n => Number.isSafeInteger(n) && n >= 0;
const reply = a => ({ ok: true, bill: structuredClone(a.tokens.bill), you: tokenView(a) });
export function deliver(a, seq) {
  a.delivered = Math.max(a.delivered, seq);
  a.inboxCursor = Math.max(a.inboxCursor, a.delivered);
}

export function meterCommand(w, p) {
  if (!tokenized(w)) return bad('invalid_request', { field: 'type' });
  const a = typeof p.agentId === 'string' ? w.agents[p.agentId] : null;
  if (!a || !isAlive(a) || a.status !== 'awake') return bad('not_awake');
  if (w.paused) return bad('paused');
  if (!['wake', 'look', 'inbox', 'refund'].includes(p.op)) return bad('invalid_request', { field: 'op' });
  if (typeof p.wakeId !== 'string' || !p.wakeId || !validMeterDay(p.day)) return bad('invalid_request', { field: 'meter' });
  const t = a.tokens;
  if (p.op === 'refund') {
    if (!activeWaking(w, a, p.wakeId) || !t.waking.refundable) return bad('not_refundable');
    const { basic, energy } = t.waking.charged;
    const n = basic + energy;
    if (t.wakesDay === clockDay(w)) { a.basic += basic; a.energy += energy; }
    else a.energy += n;
    if (t.day === p.day) t.used = Math.max(0, t.used - n);
    source(w, 'energy', 'thinking_refund', n);
    t.bill = null;
    t.waking.refundable = false;
    w.dayLog.p4.refunded += n;
    return reply(a);
  }
  if (p.op === 'wake') {
    if (!['main', 'wake'].includes(p.kind) || !weight(p.system) || !weight(p.brief) || !weight(p.delivered)) return bad('invalid_request', { field: 'meter' });
    const reread = rereadCost(p.system), read = p.brief * P.tokenRead;
    const paid = payThinking(w, a, reread + read, p.day);
    if (!paid.ok) {
      w.dayLog.p4[paid.code === 'cap_reached' ? 'refusedCap' : 'refusedTokens']++;
      return bad(paid.code, { need: paid.need, have: paid.have });
    }
    if (t.bill) t.lastBill = t.bill;
    t.bill = { id: p.wakeId, tick: w.clock.tick, kind: p.kind, reread: 0, read: 0, write: 0 };
    t.waking = { id: p.wakeId, tick: w.clock.tick, kind: p.kind, charged: { basic: paid.basic, energy: paid.energy }, refundable: true };
    if (t.wakesDay !== clockDay(w)) { t.wakesDay = clockDay(w); t.wakes = 0; t.called = 0; t.calledCost = 0; }
    t.wakes++;
    if (p.kind === 'wake') t.called++;
    recordThinking(w, a, { reread, read });
    w.dayLog.p4[p.kind === 'wake' ? 'called' : 'wakes']++;
    deliver(a, p.delivered);
    return reply(a);
  }
  if (!activeWaking(w, a, p.wakeId)) return bad('no_waking');
  const reread = p.reread ?? 0;
  if (!weight(reread) || !weight(p.read) || (p.op === 'inbox' && !weight(p.delivered))) return bad('invalid_request', { field: 'meter' });
  const read = p.read * P.tokenRead;
  const paid = payThinking(w, a, reread + read, p.day);
  if (!paid.ok) {
    w.dayLog.p4.suffocated++;
    return bad(paid.code, { need: paid.need, have: paid.have });
  }
  recordThinking(w, a, { reread, read });
  t.waking.refundable = false;
  if (p.op === 'inbox') deliver(a, p.delivered);
  return reply(a);
}

export function capCommand(w, p) {
  if (!tokenized(w)) return bad('invalid_request', { field: 'type' });
  const a = typeof p.agentId === 'string' ? w.agents[p.agentId] : null;
  if (!a || !isAlive(a)) return bad('not_awake');
  if (!validCap(p.cap)) return bad('invalid_request', { field: 'cap' });
  if (a.tokens.cap !== p.cap) {
    const direction = p.cap > a.tokens.cap ? 'up' : 'down';
    a.tokens.cap = p.cap;
    pushInbox(w, a, 'system', { code: 'cap_changed', direction });
  }
  return { ok: true, cap: a.tokens.cap };
}
