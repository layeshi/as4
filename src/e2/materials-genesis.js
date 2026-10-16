// Private genesis validation. This module supplies no production defaults.
import { mapFor } from './map/index.js';
import { MATERIAL_ZONES as ISLAND_ZONES } from './map/island-three.js';
export const MATERIAL_ZONES = Object.freeze({
  wilds: [60, 120],
  scrapyard: [150, 300],
  solarfield: [90, 180],
});
/** 物料地带 { id: [初始储量, 上限] }：三城岛图有八处，其余地图三处 */
export const materialZonesFor = (map) => (map === 'island-three-v1' ? ISLAND_ZONES : MATERIAL_ZONES);
export function validateHiddenPhysics(h, map) {
  const int = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  if (!h || h.version !== 1 || !h.regrowth || !h.construction)
    throw new Error('PREMISE=5 requires hiddenPhysics version 1');
  const r = h.regrowth,
    c = h.construction;
  if (
    !int(r.factorPermille, 100, 900) ||
    !int(c.factorPermille, 100, 900) ||
    !int(c.fullActionsPerTick, 1, 3)
  )
    throw new Error('Invalid hiddenPhysics parameters');
  for (const [z, [, cap]] of Object.entries(materialZonesFor(map))) {
    const b = r.baseByZone?.[z],
      t = r.thresholdByZone?.[z];
    if (
      !int(b, 2, cap) ||
      !int(t, 1, cap - 1) ||
      Math.max(1, Math.floor((b * r.factorPermille) / 1000)) >= b
    )
      throw new Error('Invalid hiddenPhysics zone parameters');
  }
}
export function initializeMaterials(w, h) {
  w.genesis.hiddenPhysics = structuredClone(h);
  w.materialClaims = {};
  w.services = {};
  w.orders = {};
  w.orderEvidence = {};
  w.actReceipts = {};
  w.observations = [];
  const zones = materialZonesFor(w.map);
  w.materialZones = Object.fromEntries(
    Object.entries(zones).map(([id, [stock, capacity]]) => [
      id,
      { stock, capacity, stockAtStart: stock, harvestedThisDay: 0 },
    ])
  );
  let initial = Object.values(zones).reduce((n, [stock]) => n + stock, 0);
  for (const def of mapFor(w).places) {
    const p = w.places[def.id];
    p.materialRecoverable = def.materialRecoverable;
    p.materialRecoverableMax = def.materialRecoverable;
    initial += def.materialRecoverable;
    for (const m of p.modules) {
      m.materialRecoverable = 0;
      if (m.type === 'research')
        m.policy = { access: 'public', agents: [], groups: [], fee: 0 };
    }
  }
  w.materialLedger = { initial, regenerated: 0, lost: 0 };
}
