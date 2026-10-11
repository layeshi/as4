import { fail, needInt, creditEnergy } from './core.js';
export function controls(w, a, owner) {
  return owner.kind === 'agent'
    ? owner.id === a.id
    : owner.kind === 'group'
      ? w.groups[owner.id]?.steward === a.id
      : false;
}
export function researchView(w) {
  return Object.values(w.places)
    .filter((p) => !p.razed && p.modules.some((m) => m.type === 'research'))
    .map((p) => ({
      id: p.id,
      owner: p.owner,
      condition: p.condition,
      global: true,
      nominalWork: 15,
      repairLimit: 750,
      policy: p.modules.find((m) => m.type === 'research').policy ?? {
        access: 'public',
        agents: [],
        groups: [],
        fee: 0,
      },
    }));
}
function eligible(w, a, p) {
  return (
    p.condition >= 3000 &&
    (p.policy.access === 'public' ||
      controls(w, a, p.owner) ||
      (p.policy.access === 'allowlist' &&
        (p.policy.agents.includes(a.id) ||
          p.policy.groups.some((g) => a.groups.includes(g)))))
  );
}
export function chooseResearch(w, a, args) {
  const all = researchView(w).sort((a, b) =>
    a.id === b.id ? 0 : a.id < b.id ? -1 : 1
  );
  if (args.research !== undefined) {
    const p = all.find((x) => x.id === args.research);
    const max = needInt(args.maxResearchFee ?? 0, { min: 0 });
    if (!p || !eligible(w, a, p) || p.policy.fee > max)
      fail('research_unavailable');
    return p;
  }
  return all.find((p) => p.policy.fee === 0 && eligible(w, a, p)) ?? null;
}
export function payResearch(w, a, p) {
  if (!p || !p.policy.fee) return;
  a.energy -= p.policy.fee;
  const dest =
    p.owner.kind === 'agent'
      ? w.agents[p.owner.id]
      : p.owner.kind === 'group'
        ? w.groups[p.owner.id].treasury
        : w.treasury;
  if (p.owner.kind === 'agent') creditEnergy(w, dest, p.policy.fee);
  else dest.energy += p.policy.fee;
}
export function validateResearchPolicy(args) {
  if (!['public', 'owner', 'allowlist'].includes(args.access))
    fail('invalid_args');
  const agents = args.agents ?? [],
    groups = args.groups ?? [];
  if (
    !Array.isArray(agents) ||
    !Array.isArray(groups) ||
    agents.length > 100 ||
    groups.length > 100 ||
    [...agents, ...groups].some((s) => typeof s !== 'string')
  )
    fail('invalid_args');
  return {
    access: args.access,
    agents: [...agents],
    groups: [...groups],
    fee: needInt(args.fee, { min: 0 }),
  };
}
