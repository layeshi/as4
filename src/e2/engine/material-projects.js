import { residentFlow } from '../p6/journal.js';
import { MODULE_DEFS, P } from '../params.js';
import { lotDefs } from '../map/index.js';
import { isAlive } from '../world.js';
import { fraction, newClaim, beneficiary } from './materials.js';
import { sink } from './ledger.js';
import { emit, creditEnergy, pushInbox } from './core.js';
import { hooks } from './hooks.js';
import { wellPlace } from './environment.js';
import { multiCity, cityValue, cityOfPlace, fallbackCity } from './cities.js';
export function initializeProject(w, j, access) {
  const n = w.well.upgrades.length + 1;
  const wild = j.lot
    ? lotDefs(w)[j.lot].district === 'wilds'
    : w.places[j.on]?.wild;
  const materials =
    j.build === 'upgrade'
      ? 50 * n
      : j.build === 'site'
        ? wild
          ? 15
          : 20
        : j.build === 'road'
          ? 30
          : j.module === 'research'
            ? 60
            : Math.ceil(MODULE_DEFS[j.module].cost / 2);
  Object.assign(j, {
    needEnergy: j.need,
    needMaterials: materials,
    needWork:
      j.build === 'upgrade' ? 100 * n : j.module === 'research' ? 60 : 40,
    progress: 0,
    spentEnergy: 0,
    spentMaterials: 0,
    haveMaterials: 0,
    lastProgressTick: w.clock.tick,
    phase: 'funding',
    access:
      access ??
      (j.owner.kind === 'city'
        ? 'public'
        : j.owner.kind === 'group'
          ? 'group'
          : 'owner'),
    contributions: [],
    materialRecoverable: 0,
  });
}
export function contributeMaterials(
  w,
  j,
  who,
  energy,
  materials = 0,
  b = { kind: 'agent', id: who }
) {
  if(b.kind==='agent'){residentFlow(w,b.id,'escrow','project','energy',energy);residentFlow(w,b.id,'escrow','project','materials',materials);}
  j.have += energy;
  j.haveMaterials += materials;
  j.contributors[who] = (j.contributors[who] || 0) + energy;
  j.contributions.push({
    id: j.contributions.length + 1,
    beneficiary: structuredClone(b),
    energy,
    materials,
    spentEnergy: 0,
    spentMaterials: 0,
  });
  if (j.have === j.needEnergy && j.haveMaterials === j.needMaterials)
    j.phase = 'building';
  return { built: false, result: null };
}
export function spendProject(w, j, work) {
  const next = j.progress + work;
  let energy = 0,
    materials = 0;
  for (const c of j.contributions) {
    for (const k of ['energy', 'materials']) {
      const spent = k === 'energy' ? 'spentEnergy' : 'spentMaterials';
      const n = fraction(c[k], next, j.needWork) - c[spent];
      if(c.beneficiary.kind==='agent'&&!c.refunds?.[k])residentFlow(w,c.beneficiary.id,'expense','construction',k,n);
      c[spent] += n;
      if (k === 'energy') energy += n;
      else materials += n;
      if (c.refunds?.[k] && n) {
        const list = c.refunds[k],
          total = list.reduce((s, h) => s + h.amount, 0);
        let cumulative = 0,
          prior = 0;
        for (const h of list) {
          cumulative += h.amount;
          const upto = fraction(n, cumulative, total);
          const use = upto - prior;
          if(h.beneficiary.kind==='agent')residentFlow(w,h.beneficiary.id,'expense','construction',k,use);
          h.amount -= use;
          prior = upto;
        }
      }
    }
  }
  const recovered =
    Math.floor((j.spentMaterials + materials) / 2) -
    Math.floor(j.spentMaterials / 2);
  j.spentEnergy += energy;
  j.spentMaterials += materials;
  j.have -= energy;
  j.haveMaterials -= materials;
  j.materialRecoverable += recovered;
  w.materialLedger.lost += materials - recovered;
  j.progress = next;
  j.lastProgressTick = w.clock.tick;
  sink(w, 'energy', 'project_built', energy);
  return { energy, materials };
}
function refundEnergy(w, b, amount, placeId) {
  b = beneficiary(w, b, placeId);
  // 第七前提「三城」：归城的退款进那座城的公库；居民已离场、又没有明确的城时见 fallbackCity
  const cityTreasury = () => (multiCity(w) ? cityValue(w, fallbackCity(w, b.kind === 'city' ? b.id : null, cityOfPlace(w, placeId)), 'treasury') : w.treasury);
  const dest =
    b.kind === 'agent' &&
    w.agents[b.id] &&
    ['awake', 'dormant'].includes(w.agents[b.id].status)
      ? w.agents[b.id]
      : b.kind === 'group'
        ? w.groups[b.id].treasury
        : cityTreasury();
  if (b.kind === 'agent' && dest === w.agents[b.id])
    creditEnergy(w, dest, amount);
  else dest.energy += amount;
}
export function terminateProject(w, j, reason = 'cancelled') {
  if (j.status !== 'open') return;
  for (const c of j.contributions) {
    for (const k of ['energy', 'materials']) {
      const list = c.refunds?.[k] ?? [
        {
          beneficiary: c.beneficiary,
          amount: c[k] - c[k === 'energy' ? 'spentEnergy' : 'spentMaterials'],
        },
      ];
      for (const h of list)
        if (k === 'energy') { if(h.beneficiary.kind==='agent')residentFlow(w,h.beneficiary.id,'refund','project','energy',h.amount);refundEnergy(w, h.beneficiary, h.amount, j.place); }
        else newClaim(w, j.place, h.amount, h.beneficiary, `project:${j.id}`);
    }
  }
  j.have = 0;
  j.haveMaterials = 0;
  j.status = reason === 'cancelled' ? 'cancelled' : 'abandoned';
  j.phase = j.status;
  if (!j.materialRecoverable && j.lot && w.lots[j.lot]?.project === j.id)
    w.lots[j.lot].project = null;
  w.dayLog.abandoned.push({
    projectId: j.id,
    name: j.name ?? j.module ?? j.build,
    place: j.place,
  });
  for (const id of Object.keys(j.contributors)) {
    const a = w.agents[id];
    if (a && isAlive(a))
      pushInbox(w, a, 'project', { projectId: j.id, result: j.status });
  }
  emit(w, 'abandoned', {
    place: j.place,
    data: {
      projectId: j.id,
      name: j.name ?? j.module ?? j.build,
      build: j.build,
      type: j.module ?? j.build,
      have: 0,
      need: j.need,
      reason,
      materialRecoverable: j.materialRecoverable,
    },
  });
  hooks.fire(w, 'abandoned', { place: j.place, build: j.build });
}
export const projectExpired = (w, j) =>
  w.clock.tick - j.lastProgressTick >= 24 * P.ticksPerDay;
export function attachRecovery(w, j) {
  j.phase = 'built';
  let target;
  if (j.build === 'module')
    target = w.places[j.place].modules.find((m) => m.projectId === j.id);
  else if (j.build === 'site') target = w.places[j.result];
  else if (j.build === 'road') target = w.roads[j.result];
  else target = wellPlace(w);
  target.materialRecoverable =
    (target.materialRecoverable || 0) + j.materialRecoverable;
  target.materialRecoverableMax = target.materialRecoverable;
  if (j.build === 'module' && j.module === 'research')
    target.policy = { access: 'public', agents: [], groups: [], fee: 0 };
  j.materialRecoverable = 0;
}
