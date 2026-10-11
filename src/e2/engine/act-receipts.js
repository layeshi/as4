import { materialsEnabled } from '../world.js';
import { bad } from './core.js';
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .filter((k) => v[k] !== undefined)
            .map((k) => [k, canonical(v[k])])
        )
      : v;
export function requestIdentity(w, p) {
  if (!materialsEnabled(w)) return null;
  if (
    typeof p.requestId !== 'string' ||
    !/^[A-Za-z0-9_.:-]{1,120}$/.test(p.requestId)
  )
    return { error: bad('invalid_request', { field: 'requestId' }) };
  const generation = p.experimentGeneration ?? 0;
  if (
    !Number.isSafeInteger(generation) ||
    generation !== (w.experimentControl?.generation ?? 0)
  )
    return { error: bad('experiment_changed') };
  const key = `${p.agentId}:${generation}:${p.requestId}`;
  const fingerprint = JSON.stringify(
    canonical({
      actions: p.actions,
      thought: p.thought ?? null,
      lang: p.lang ?? 'zh',
      wakeId: p.meter?.wakeId ?? p.wakeId,
      turn: p.requestTurn ?? p.turn ?? null,
    })
  );
  const receipt = w.actReceipts[key];
  if (receipt && receipt.fingerprint !== fingerprint)
    return { error: bad('conflict') };
  return {
    key,
    fingerprint,
    result: receipt ? structuredClone(receipt.result) : null,
  };
}
export function saveRequest(w, identity, result) {
  if (identity && !identity.error)
    w.actReceipts[identity.key] = {
      fingerprint: identity.fingerprint,
      result: structuredClone(result),
    };
  return result;
}
