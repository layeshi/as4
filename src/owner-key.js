// Deterministic credential rotation shared by both world engines.
// Only the hash enters the command log; the HTTP layer generates the secret.
export function resetOwnerKey(w, { agentId, ownerKeyHash }, { emit, bad }) {
  if (typeof agentId !== 'string' || !Object.prototype.hasOwnProperty.call(w.agents, agentId)) return bad('not_found');
  const a = w.agents[agentId];
  if (!a.owner) return bad('invalid_request', { field: 'agentId' });
  if (typeof ownerKeyHash !== 'string' || !/^[0-9a-f]{64}$/.test(ownerKeyHash)) return bad('invalid_request', { field: 'ownerKeyHash' });
  a.owner.keyHash = ownerKeyHash;
  emit(w, 'admin', { data: { op: 'reset_owner_key', agentId } });
  return { ok: true, agentId };
}
