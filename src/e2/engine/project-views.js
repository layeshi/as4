import { ownerView } from './places.js';
import { controls } from './research.js';
import { pageRecords } from './materials.js';

// Basic participation checks only; execution still checks law, balances and services.
// Keep these conditions aligned with actions/materials.js participation().
export function projectParticipation(w, j, a) {
  const authorized = j.access === 'public' || controls(w, a, j.owner) ||
    (j.access === 'group' && j.owner.kind === 'group' && a.groups.includes(j.owner.id));
  const atSite = a.place === j.place;
  const funded = j.phase === 'building';
  const reasons = [];
  if (j.status !== 'open') reasons.push('project_closed');
  if (!atSite) reasons.push('wrong_place');
  if (!funded && j.status === 'open') reasons.push('project_unfunded');
  if (!authorized) reasons.push('not_allowed');
  return { authorized, atSite, funded, canAttemptConstruct: reasons.length === 0, reasons,
    remainingChecks: ['law', 'budget', 'research'] };
}

export function materialProjectView(w, j, agentId = null) {
  return {
    id: j.id, name: j.name ?? null, build: j.build, module: j.module ?? null,
    place: j.place, owner: ownerView(w, j.owner), status: j.status, phase: j.phase,
    access: j.access, need: j.need, have: j.have,
    needMaterials: j.needMaterials, haveMaterials: j.haveMaterials,
    needWork: j.needWork, progress: j.progress,
    spentEnergy: j.spentEnergy, spentMaterials: j.spentMaterials,
    ...(agentId && w.agents[agentId] ? { participation: projectParticipation(w, j, w.agents[agentId]) } : {}),
  };
}

export function projectAccounting(w, j, args = {}) {
  const recordsAvailable = Array.isArray(j.contributions);
  const byAccount = new Map();
  const totals = { energy: 0, materials: 0, spentEnergy: 0, spentMaterials: 0 };
  for (const c of j.contributions ?? []) {
    const id = `${c.beneficiary.kind}:${c.beneficiary.id ?? 'city'}`;
    if (!byAccount.has(id)) byAccount.set(id, { id, account: ownerView(w, c.beneficiary),
      energy: 0, materials: 0, spentEnergy: 0, spentMaterials: 0 });
    for (const key of Object.keys(totals)) {
      byAccount.get(id)[key] += c[key] ?? 0;
      totals[key] += c[key] ?? 0;
    }
  }
  const contributors = pageRecords([...byAccount.values()], { ...args, limit: args.limit ?? 10 });
  const remaining = pageRecords([...byAccount.values()], { limit: 1, ...(contributors.length ? { after: contributors.at(-1).id } : args.after ? { after: args.after } : {}) });
  return {
    recordsAvailable, totals: recordsAvailable ? totals : null,
    escrow: { energy: j.status === 'open' ? j.have : 0, materials: j.status === 'open' ? j.haveMaterials : 0 },
    contributors, contributorCount: byAccount.size,
    next: contributors.length && remaining.length ? contributors.at(-1).id : null,
    note: '记录归属账户的实际投入及已消耗数；代管物料归属其受益账户。投入不等于产权或股权，赠与、承诺和失败出资不计入。关闭工程托管余额为零，历史投入保留；退款或继承分配不由投入数推断。缺少历史明细时不补猜。 / Recorded asset owners, actual deposits and consumption; deposits do not grant ownership. Gifts, promises and rejected deposits are excluded. Closed escrow is zero; historical deposits remain. Refund or inheritance allocations cannot be inferred from deposits. Missing records are not reconstructed.',
  };
}
