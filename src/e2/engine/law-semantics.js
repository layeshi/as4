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

// Allowlist projection: private failedCommand never leaves persisted engine state.
export function lawProtectionView(w) {
  const p = usesLawSemantics2(w) && w.lawSemantics.protection;
  return p ? { code: 'engine_exception', commandN: p.commandN, type: p.type } : null;
}
