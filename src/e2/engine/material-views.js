import { materialsEnabled } from '../world.js';
import { materialConservation, pageRecords } from './materials.js';
import { researchView } from './research.js';
export const MATERIAL_LOOKS = [
  'materials',
  'services',
  'demands',
  'orders',
  'research',
  'observations',
];
export function materialSummary(w, a) {
  if (!materialsEnabled(w)) return {};
  const orders = Object.values(w.orders).filter(
    (o) => o.requester === a.id || o.provider === a.id
  );
  return {
    materials: a.materials,
    earmarkedMaterials: a.earmarkedMaterials.reduce((n, h) => n + h.amount, 0),
    materialClaims: Object.values(w.materialClaims)
      .filter(
        (c) => c.beneficiary.kind === 'agent' && c.beneficiary.id === a.id
      )
      .reduce((n, c) => n + c.amount, 0),
    orders: {
      waiting: orders.filter((o) => ['open', 'offered'].includes(o.status))
        .length,
      active: orders.filter((o) => o.status === 'active').length,
      nextDeadline:
        orders
          .filter((o) => ['open', 'offered', 'active'].includes(o.status))
          .map((o) => o.dueTick ?? o.acceptBy)
          .sort((a, b) => a - b)[0] ?? null,
      recentSettlements: orders
        .filter((o) => o.closedTick !== undefined)
        .slice(-3)
        .map((o) => ({ id: o.id, status: o.status, reason: o.reason })),
    },
  };
}
export function materialLook(w, what, args = {}, agentId = null) {
  if (!materialsEnabled(w) || !MATERIAL_LOOKS.includes(what)) return null;
  if (what === 'materials')
    return {
      zones: structuredClone(w.materialZones),
      claims: pageRecords(
        Object.values(w.materialClaims).filter((c) => c.amount > 0),
        args
      ),
      ...(agentId
        ? {
            inventory: w.agents[agentId].materials,
            earmarked: structuredClone(w.agents[agentId].earmarkedMaterials),
          }
        : {}),
      ledger: materialConservation(w),
    };
  let records =
    what === 'research'
      ? researchView(w)
      : what === 'observations'
        ? w.observations.filter(
            (o) =>
              (!args.kind || o.kind === args.kind) &&
              (!args.target ||
                [o.zone, o.project, o.actor].includes(args.target))
          )
        : what === 'services'
          ? Object.values(w.services).filter((s) => s.status === 'active')
          : Object.values(w.orders).filter(
              (o) => what !== 'demands' || o.origin === 'demand'
            );
  if (args.agent)
    records = records.filter(
      (r) => r.requester === args.agent || r.provider === args.agent
    );
  if (args.id) records = records.filter((r) => r.id === args.id);
  if (args.mine && agentId)
    records = records.filter(
      (r) => r.requester === agentId || r.provider === agentId
    );
  return structuredClone(pageRecords(records, args));
}
export function materialPublicState(w) {
  return {
    materials: materialLook(w, 'materials'),
    services: materialLook(w, 'services'),
    demands: materialLook(w, 'demands'),
    orders: materialLook(w, 'orders'),
    research: researchView(w),
    observations: materialLook(w, 'observations'),
  };
}
