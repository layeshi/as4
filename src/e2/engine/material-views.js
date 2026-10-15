import { materialsEnabled } from '../world.js';
import { materialConservation, pageRecords } from './materials.js';
import { researchView } from './research.js';
import { fail } from './core.js';
import { materialProjectView, projectAccounting } from './project-views.js';
export const MATERIAL_LOOKS = [
  'materials',
  'services',
  'demands',
  'orders',
  'research',
  'observations',
  'projects',
  'project',
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
  if (what === 'project') {
    if (typeof args.id !== 'string' || !args.id.length) fail('invalid_args');
    const j = Object.hasOwn(w.projects, args.id) ? w.projects[args.id] : null;
    if (!j) fail('not_found');
    return { ...materialProjectView(w, j, agentId), accounting: projectAccounting(w, j, args) };
  }
  if (what === 'projects') {
    let projects = Object.values(w.projects);
    if (args.id) projects = projects.filter(j => j.id === args.id);
    if (args.mine && agentId) projects = projects.filter(j =>
      j.owner.kind === 'agent' && j.owner.id === agentId ||
      j.contributions?.some(c => c.beneficiary.kind === 'agent' && c.beneficiary.id === agentId));
    return pageRecords(projects, args).map(j => materialProjectView(w, j, agentId));
  }
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
  // 先筛选再分页，保证全城交易查询不会遗漏后续页的匹配记录。
  if (['services', 'demands', 'orders'].includes(what)) {
    if (args.status) records = records.filter(r => r.status === args.status);
    if (args.kind) records = records.filter(r => (r.criterionTemplate ?? r.terms?.criterion)?.kind === args.kind);
  }
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
