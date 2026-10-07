// Independent from computation VM selection. Missing version means historical behavior.
export const usesLawSemantics2 = w => w.physics === 2 && w.lawSemantics?.version === 2;

export function migrateLawSemantics(w, args) {
  if (w.physics !== 2 || args.version !== 2 || (w.lawSemantics && w.lawSemantics.version !== 2)) {
    return { ok: false, error: { code: 'invalid_request', field: 'version' } };
  }
  if (!usesLawSemantics2(w)) {
    const refounds = Object.values(w.refounds).filter(r => r.status === 'open').map(r => ({ id: r.id, expiresTick: r.expiresTick }));
    if (refounds.length) return { ok: false, error: { code: 'open_refounds', refounds } };
    w.lawSemantics = { version: 2 };
  }
  return { ok: true, version: 2 };
}
