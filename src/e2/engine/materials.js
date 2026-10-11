// Position-preserving material custody and conservation. No abstract material account.
import { materialsEnabled, nextId, clockDay, isAlive } from '../world.js';
import { P } from '../params.js';
import { emit, fail, needInt } from './core.js';
export const fraction = (n, p, d) =>
  Number((BigInt(n) * BigInt(p)) / BigInt(d));
export function addSafe(a, b) {
  const n = a + b;
  if (!Number.isSafeInteger(n) || n < 0) fail('invalid_args');
  return n;
}
export function beneficiary(w, b) {
  return b.kind === 'group' && (!w.groups[b.id] || w.groups[b.id].dissolved)
    ? { kind: 'city' }
    : b;
}
export function newClaim(w, place, amount, b, source) {
  if (!amount) return null;
  const id = nextId(w, 'mc');
  w.materialClaims[id] = {
    id,
    place,
    amount,
    beneficiary: structuredClone(beneficiary(w, b)),
    source,
    createdTick: w.clock.tick,
  };
  return id;
}
export function materialSource(w, a, amount, claim, owner) {
  if (!claim) {
    if (a.materials < amount) fail('insufficient_materials');
    return null;
  }
  const held = a.earmarkedMaterials.find((x) => x.claimId === claim);
  if (!held || held.amount < amount) fail('insufficient_materials');
  const b = beneficiary(w, held.beneficiary);
  if (!owner || b.kind !== owner.kind || b.id !== owner.id) fail('not_allowed');
  return held;
}
export function takeMaterials(a, n, held) {
  if (held) held.amount -= n;
  else a.materials -= n;
}
export function materialHoldings(w) {
  let n = 0;
  const add = (x) => {
    n += BigInt(x || 0);
  };
  n = 0n;
  for (const a of Object.values(w.agents)) {
    add(a.materials);
    for (const h of a.earmarkedMaterials || []) add(h.amount);
  }
  for (const c of Object.values(w.materialClaims)) add(c.amount);
  for (const z of Object.values(w.materialZones)) add(z.stock);
  for (const p of [...Object.values(w.places), ...Object.values(w.roads)]) {
    add(p.materialRecoverable);
    for (const m of p.modules || []) add(m.materialRecoverable);
  }
  for (const j of Object.values(w.projects)) {
    if (j.status === 'open') add(j.haveMaterials);
    if (j.status !== 'built') add(j.materialRecoverable);
  }
  for (const o of Object.values(w.offers))
    if (o.status === 'open') add(o.give.materials);
  return Number(n);
}
export function materialConservation(w) {
  const l = w.materialLedger,
    actual = materialHoldings(w),
    expected = l.initial + l.regenerated - l.lost;
  return { ok: actual === expected, actual, expected };
}
export function observe(w, kind, data) {
  const id = nextId(w, 'ob');
  const seq = w.counters.event + 1;
  const record = { id, seq, ...data };
  emit(w, kind === 'regrowth' ? 'material_regrowth' : 'construction_observed', {
    data: record,
  });
  w.observations.push({ kind, day: clockDay(w), ...record });
  w.observations = w.observations.filter((o) => o.day >= clockDay(w) - 24);
  return record;
}
export function regenerateMaterials(w) {
  if (!materialsEnabled(w)) return;
  const r = w.genesis.hiddenPhysics.regrowth;
  for (const id of Object.keys(w.materialZones).sort()) {
    const z = w.materialZones[id],
      before = z.stock;
    const nominal =
      z.harvestedThisDay > r.thresholdByZone[id]
        ? Math.max(1, fraction(r.baseByZone[id], r.factorPermille, 1000))
        : r.baseByZone[id];
    const added = Math.min(nominal, z.capacity - z.stock);
    z.stock += added;
    w.materialLedger.regenerated += added;
    observe(w, 'regrowth', {
      dayClosed: clockDay(w) - 1,
      zone: id,
      stockAtStart: z.stockAtStart,
      harvested: z.harvestedThisDay,
      stockBeforeRefill: before,
      added,
      stockAfterRefill: z.stock,
      capacity: z.capacity,
    });
    z.harvestedThisDay = 0;
    z.stockAtStart = z.stock;
  }
}
export function inheritanceShares(w, a) {
  const heirs = a.will?.heirs || [];
  return heirs.map((h) => ({
    share: h.share,
    beneficiary:
      h.to === 'treasury'
        ? { kind: 'city' }
        : w.groups[h.to] && !w.groups[h.to].dissolved
          ? { kind: 'group', id: h.to }
          : w.agents[h.to] && isAlive(w.agents[h.to]) && h.to !== a.id
            ? { kind: 'agent', id: h.to }
            : { kind: 'public' },
  }));
}
export function splitRights(amount, shares) {
  const total = shares.reduce((n, h) => n + h.share, 0);
  let left = amount;
  const out = [];
  for (const h of shares) {
    const n = fraction(amount, h.share, total);
    left -= n;
    if (n) out.push({ amount: n, beneficiary: h.beneficiary });
  }
  if (left) out.push({ amount: left, beneficiary: { kind: 'public' } });
  return out;
}
export function inheritMaterials(w, a) {
  if (!materialsEnabled(w)) return;
  const shares = inheritanceShares(w, a);
  for (const c of Object.values(w.materialClaims))
    if (c.beneficiary.kind === 'agent' && c.beneficiary.id === a.id) {
      for (const h of splitRights(c.amount, shares))
        newClaim(w, c.place, h.amount, h.beneficiary, c.source);
      c.amount = 0;
    }
  for (const h of splitRights(a.materials, shares))
    newClaim(w, a.place, h.amount, h.beneficiary, 'inheritance');
  a.materials = 0;
  for (const h of a.earmarkedMaterials) {
    const c = w.materialClaims[h.claimId];
    newClaim(w, c.place, h.amount, h.beneficiary, 'custodian_departed');
    h.amount = 0;
  }
  for (const j of Object.values(w.projects))
    for (const c of j.contributions || [])
      for (const k of ['energy', 'materials'])
        if (c.refunds?.[k])
          c.refunds[k] = c.refunds[k].flatMap((h) =>
            h.beneficiary.kind === 'agent' && h.beneficiary.id === a.id
              ? splitRights(h.amount, shares)
              : [h]
          );
  for (const j of Object.values(w.projects))
    for (const c of j.contributions || [])
      if (
        !c.refunds &&
        c.beneficiary.kind === 'agent' &&
        c.beneficiary.id === a.id
      ) {
        // Freeze integer entitlements over remaining budgets; no future recursive estate lookup.
        c.refunds = {
          energy: splitRights(c.energy - c.spentEnergy, shares),
          materials: splitRights(c.materials - c.spentMaterials, shares),
        };
      }
}
export function dissolveMaterialRights(w, id) {
  if (!materialsEnabled(w)) return;
  const fix = (b) => {
    if (b?.kind === 'group' && b.id === id) {
      b.kind = 'city';
      delete b.id;
    }
  };
  for (const c of Object.values(w.materialClaims)) fix(c.beneficiary);
  for (const a of Object.values(w.agents))
    for (const h of a.earmarkedMaterials) fix(h.beneficiary);
  for (const j of Object.values(w.projects))
    for (const c of j.contributions || []) {
      fix(c.beneficiary);
      for (const list of Object.values(c.refunds || {}))
        for (const h of list) fix(h.beneficiary);
    }
}
// ASCII comparison with numeric suffixes; independent of host locale/ICU.
export function compareRecordIds(a, b) {
  a = String(a);
  b = String(b);
  const left = /^(.*?)([0-9]+)$/.exec(a),
    right = /^(.*?)([0-9]+)$/.exec(b);
  if (left && right && left[1] === right[1]) {
    const x = BigInt(left[2]),
      y = BigInt(right[2]);
    if (x !== y) return x < y ? -1 : 1;
  }
  return a === b ? 0 : a < b ? -1 : 1;
}
export function pageRecords(records, args = {}) {
  const limit = needInt(args.limit ?? 20, { min: 1, max: 50 });
  const compare = compareRecordIds;
  if (
    args.after !== undefined &&
    (typeof args.after !== 'string' ||
      !args.after.length ||
      args.after.length > 128)
  )
    fail('invalid_args');
  return [...records]
    .sort((a, b) => compare(a.id, b.id))
    .filter((x) => !args.after || compare(x.id, args.after) > 0)
    .slice(0, limit);
}
