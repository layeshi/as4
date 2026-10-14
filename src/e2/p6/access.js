import { residentFlow } from './journal.js';
import { createHash } from 'node:crypto';
import { register, adopt, changeModel, letter } from '../engine/lifecycle.js';
import { bad, emit } from '../engine/core.js';
import { source } from '../engine/ledger.js';
import { validCap } from '../engine/tokens.js';

export const relation = (w, id) => Object.hasOwn(w.access?.residents ?? {}, id) ? w.access.residents[id] : null;
export function manages(w, p) {
  const r = relation(w, p.agentId);
  return !!r && r.managerAccountId === p.accountId && r.ownershipRevision === p.ownershipRevision;
}
const fingerprint = p => createHash('sha256').update(JSON.stringify(p)).digest('hex');
export function accountCommand(w, p) {
  if (w.premise !== 6 || typeof p.accountId !== 'string' || !p.accountId || typeof p.requestId !== 'string' || !/^[\w-]{8,128}$/.test(p.requestId)) return bad('invalid_request');
  const key = `${p.accountId}:${p.requestId}`, digest = fingerprint(Object.fromEntries(Object.entries(p).filter(([k])=>k!=='now')));
  const receipt = w.access.requests[key];
  if (receipt) return receipt.digest === digest ? structuredClone(receipt.result) : bad('conflict');
  let result;
  if (p.op === 'merge_accounts') {
    if (typeof p.from !== 'string' || !p.from || p.from === p.accountId) return bad('invalid_request');
    const moved = [];
    for (const [id, r] of Object.entries(w.access.residents)) {
      if (r.creatorAccountId === p.from) r.creatorAccountId = p.accountId;
      if (r.managerAccountId === p.from) { r.managerAccountId = p.accountId; r.ownershipRevision++; moved.push(id); }
    }
    if (Object.hasOwn(w.access.startupClaims, p.from) && !Object.hasOwn(w.access.startupClaims, p.accountId)) w.access.startupClaims[p.accountId] = structuredClone(w.access.startupClaims[p.from]);
    // Old invitations must not grant control after either principal changed.
    for (const transfer of Object.values(w.access.transfers)) if (transfer.status === 'pending' && [transfer.from, transfer.to].some(id => id === p.from || id === p.accountId)) transfer.status = 'cancelled';
    result = { ok: true, moved };
  } else if (p.op === 'create' || p.op === 'adopt') {
    result = p.op === 'create' ? register(w, p) : adopt(w, p);
    if (result.ok) {
      const a = w.agents[result.agentId];
      w.access.residents[a.id] = { creatorAccountId: p.op === 'create' ? p.accountId : null, managerAccountId: p.accountId, ownershipRevision: 1 };
      let grant = 0;
      if (p.op === 'create' && !Object.hasOwn(w.access.startupClaims, p.accountId)) {
        grant = 50000; a.energy += grant;
        source(w, 'energy', 'startup_grant', grant);
        residentFlow(w,a.id,'issuance','startup_grant','energy',grant);
        w.access.startupClaims[p.accountId] = { agentId: a.id, tick: w.clock.tick };
        emit(w, 'startup_grant', { agent: a.id, data: { amount: grant, source: 'startup_grant' } });
      }
      result = { ok: true, agentId: a.id, startupGrant: grant };
    }
  } else if (p.op === 'accept_transfer') {
    const t = w.access.transfers[p.transferId];
    if (!t || t.to !== p.accountId || t.status !== 'pending' || !Number.isSafeInteger(p.now) || p.now >= t.expiresAt) return bad('not_found');
    const r = relation(w, t.agentId), a = w.agents[t.agentId];
    if (!r || r.managerAccountId !== t.from || r.ownershipRevision !== t.revision || !['awake','dormant'].includes(a.status)) return bad('conflict');
    if (!validCap(p.dailyCap) || typeof p.model !== 'string' || !p.model || p.model.length > 100) return bad('invalid_request');
    r.managerAccountId = p.accountId; r.ownershipRevision++;
    a.tokens.cap = p.dailyCap;
    changeModel(w, { ...p, agentId: a.id, ownershipRevision: r.ownershipRevision });
    a.body.mustSeal = true;
    t.status = 'accepted';
    for (const other of Object.values(w.access.transfers)) if (other.agentId === a.id && other.status === 'pending') other.status = 'cancelled';
    emit(w, 'fostered', { agent: a.id, data: { agentId: a.id } });
    result = { ok: true, agentId: a.id, ownershipRevision: r.ownershipRevision };
  } else {
    if (!manages(w, p)) return bad('unauthorized');
    const a = w.agents[p.agentId];
    switch (p.op) {
      case 'avatar':
        if (p.avatar !== null && (typeof p.avatar !== 'string' || !/^[a-f0-9]{64}$/.test(p.avatar))) return bad('invalid_request');
        a.avatar = p.avatar;
        emit(w, 'appearance', { agent: a.id, data: { agentId: a.id } });
        result = { ok: true, avatar: a.avatar }; break;
      case 'model': result = changeModel(w, p); break;
      case 'letter': result = letter(w, p); break;
      case 'cap':
        if (!validCap(p.dailyCap)) return bad('invalid_request');
        a.tokens.cap = p.dailyCap; result = { ok: true }; break;
      case 'transfer': {
        if (!['awake','dormant'].includes(a.status) || typeof p.to !== 'string' || p.to === p.accountId || !Number.isSafeInteger(p.now)) return bad('invalid_request');
        const id = `transfer-${w.commandN}`;
        w.access.transfers[id] = { id, agentId: a.id, from: p.accountId, to: p.to, revision: p.ownershipRevision, expiresAt: p.now + 86400000, status: 'pending' };
        result = { ok: true, transferId: id }; break;
      }
      case 'cancel_transfer': {
        const t = w.access.transfers[p.transferId];
        if (!t || t.agentId !== a.id || t.status !== 'pending') return bad('not_found');
        t.status = 'cancelled'; result = { ok: true }; break;
      }
      default: return bad('invalid_request');
    }
  }
  if (result.ok) w.access.requests[key] = { digest, result: structuredClone(result) };
  return result;
}
