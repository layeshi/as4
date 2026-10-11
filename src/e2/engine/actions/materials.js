import { residentFlow } from '../../p6/journal.js';
import { fail, needInt, emit } from '../core.js';
import { nextId, isAlive } from '../../world.js';
import { K } from '../tokens.js';
import { cityHandlers } from './city.js';
import {
  materialSource,
  takeMaterials,
  newClaim,
  observe,
  fraction,
  addSafe,
} from '../materials.js';
import {
  initializeProject,
  contributeMaterials,
  spendProject,
  terminateProject,
  attachRecovery,
} from '../material-projects.js';
import {
  chooseResearch,
  payResearch,
  controls,
  validateResearchPolicy,
} from '../research.js';
import { buildProject } from '../projects.js';
import { sink } from '../ledger.js';
import { applyDamage } from '../environment.js';
import { razePlace, cancelBoardOffers } from '../dismantle.js';
const own = (table, id) =>
  typeof id === 'string' && Object.hasOwn(table, id) ? table[id] : null;
const positive = (v) => needInt(v, { min: 1 });
const amount = (v) => needInt(v ?? 0, { min: 0 });
function project(w, id) {
  const j = w.projects[id];
  if (!j || j.status !== 'open') fail('not_found');
  return j;
}
function participation(w, a, j) {
  return (
    j.access === 'public' ||
    controls(w, a, j.owner) ||
    (j.access === 'group' &&
      j.owner.kind === 'group' &&
      a.groups.includes(j.owner.id))
  );
}
const gather = {
  validate({ w, a }, args) {
    const z = w.materialZones[a.place];
    if (!z) fail('wrong_place');
    const n = Math.min(positive(args.amount ?? 10), 10, z.stock);
    if (!n) fail('nothing_left');
    addSafe(a.materials, n);
    return { z, n, cost: 2 * K(w) };
  },
  apply({ w, a }, { z, n }) {
    z.stock -= n;
    z.harvestedThisDay += n;
    residentFlow(w,a.id,'income','gather','materials',n);
    a.materials += n;
    emit(w, 'gather', {
      agent: a.id,
      place: a.place,
      data: { materials: n, stock: z.stock },
    });
    return { materials: n, stock: z.stock };
  },
};
const claim = {
  validate({ w, a }, args) {
    const c = own(w.materialClaims, args.claim);
    if (!c || !c.amount) fail('not_found');
    if (c.place !== a.place) fail('wrong_place');
    const b = c.beneficiary;
    if (b.kind === 'agent' && b.id !== a.id) fail('not_allowed');
    if (
      b.kind === 'group' &&
      w.groups[b.id]?.steward !== a.id &&
      !c.collectors?.includes(a.id)
    )
      fail('not_allowed');
    if (
      b.kind === 'city' &&
      w.materialPolicy?.cityClaimRestricted &&
      !a.tags.includes('public_builder')
    )
      fail('not_allowed');
    const n = positive(args.amount ?? c.amount);
    if (n > c.amount) fail('insufficient_materials');
    return { c, n, cost: 0 };
  },
  apply({ w, a }, { c, n }) {
    c.amount -= n;
    if (['public', 'agent'].includes(c.beneficiary.kind)){
      residentFlow(w,a.id,c.source?.startsWith('project:')||c.source?.startsWith('offer:')?'refund':'income','claim','materials',n);
      a.materials = addSafe(a.materials, n);
    }
    else {
      let h = a.earmarkedMaterials.find((h) => h.claimId === c.id);
      if (!h) {
        h = {
          claimId: c.id,
          beneficiary: structuredClone(c.beneficiary),
          amount: 0,
        };
        a.earmarkedMaterials.push(h);
      }
      h.amount = addSafe(h.amount, n);
    }
    return { claim: c.id, materials: n };
  },
};
const return_materials = {
  validate({ w, a }, args) {
    const c = own(w.materialClaims, args.claim),
      h = a.earmarkedMaterials.find((h) => h.claimId === args.claim);
    if (!c || !h) fail('not_found');
    if (a.place !== c.place) fail('wrong_place');
    const n = positive(args.amount ?? h.amount);
    if (n > h.amount) fail('insufficient_materials');
    return { c, h, n, cost: 0 };
  },
  apply(ctx, { c, h, n }) {
    h.amount -= n;
    c.amount += n;
    return { claim: c.id, materials: n };
  },
};
const initiate = {
  validate(ctx, args) {
    if (
      args.access !== undefined &&
      !['public', 'owner', 'group'].includes(args.access)
    )
      fail('invalid_args');
    return {
      ...cityHandlers.initiate.validate(ctx, args),
      access: args.access,
    };
  },
  apply(ctx, plan) {
    const result = cityHandlers.initiate.apply(ctx, plan),
      j = ctx.w.projects[result.project];
    initializeProject(ctx.w, j, plan.access);
    return {
      ...result,
      needMaterials: j.needMaterials,
      needWork: j.needWork,
      phase: j.phase,
    };
  },
};
const contribute = {
  validate({ w, a }, args) {
    const j = project(w, args.project);
    if (a.place !== j.place) fail('wrong_place');
    if (j.phase !== 'funding') fail('already');
    const energy = Math.min(amount(args.energy), j.needEnergy - j.have),
      materials = Math.min(
        amount(args.materials),
        j.needMaterials - j.haveMaterials
      );
    if (!energy && !materials) fail('invalid_args');
    const held = materialSource(w, a, materials, args.claim, j.owner);
    return { j, energy, materials, held, cost: 0, reserve: { energy } };
  },
  apply(ctx, { j, energy, materials, held }) {
    const { w, a } = ctx;
    a.energy -= energy;
    takeMaterials(a, materials, held);
    // Separate contributors when energy is personal and materials are earmarked.
    if (held) {
      if (energy) contributeMaterials(w, j, a.id, energy);
      if (materials)
        contributeMaterials(w, j, a.id, 0, materials, held.beneficiary);
    } else contributeMaterials(w, j, a.id, energy, materials);
    a.stats.contributed += energy;
    w.dayLog.contributeSpent += energy;
    ctx.invested(energy);
    emit(w, 'contribute', {
      agent: a.id,
      place: a.place,
      data: { projectId: j.id, energy, materials, have: j.have, need: j.need },
    });
    return {
      project: j.id,
      energy,
      materials,
      have: j.have,
      haveMaterials: j.haveMaterials,
      phase: j.phase,
      built: false,
    };
  },
};
const construct = {
  validate({ w, a }, args) {
    const j = project(w, args.project);
    if (j.place !== a.place) fail('wrong_place');
    if (j.phase !== 'building') fail('project_unfunded');
    if (!participation(w, a, j)) fail('not_allowed');
    const research = chooseResearch(w, a, args);
    return {
      j,
      research,
      cost: K(w),
      reserve: { energy: research?.policy.fee ?? 0 },
    };
  },
  apply({ w, a }, { j, research }) {
    const h = w.genesis.hiddenPhysics.construction,
      n =
        a.constructionLoad.tick === w.clock.tick ? a.constructionLoad.count : 0,
      nominal = research ? 15 : 10;
    const work = Math.min(
      j.needWork - j.progress,
      n < h.fullActionsPerTick
        ? nominal
        : Math.max(1, fraction(nominal, h.factorPermille, 1000))
    );
    const before = j.progress,
      spent = spendProject(w, j, work);
    a.constructionLoad = { tick: w.clock.tick, count: n + 1 };
    payResearch(w, a, research);
    const record = observe(w, 'construction', {
      tick: w.clock.tick,
      actor: a.id,
      project: j.id,
      researchUsed: research?.id ?? null,
      workBefore: before,
      workAdded: work,
      workAfter: j.progress,
      workRemainingBefore: j.needWork - before,
      energySpent: spent.energy,
      materialsSpent: spent.materials,
      actionFee: K(w),
      researchFee: research?.policy.fee ?? 0,
    });
    if (j.progress === j.needWork) {
      buildProject(w, j);
      attachRecovery(w, j);
    }
    return { ...record, built: j.status === 'built' };
  },
};
const repair = {
  validate({ w, a }, args) {
    const id = args.target ?? a.place,
      obj = own(w.places, id) ?? own(w.roads, id);
    if (!obj) fail('not_found');
    if (obj.open || obj.razed || obj.condition === null) fail('not_allowed');
    if (obj.id !== a.place && obj.a !== a.place && obj.b !== a.place)
      fail('wrong_place');
    const research = chooseResearch(w, a, args),
      rate = obj.condition < 1000 ? 5 : 10;
    const bp = Math.min(
      10000 - obj.condition,
      research ? 750 : 500,
      amount(args.materials) * 100,
      Math.floor(amount(args.energy) / K(w)) * rate
    );
    if (!bp) fail('already');
    const materials = Math.ceil(bp / 100),
      energy = Math.ceil(bp / rate) * K(w),
      held = materialSource(
        w,
        a,
        materials,
        args.claim,
        obj.owner ?? { kind: 'city' }
      );
    return {
      obj,
      bp,
      energy,
      materials,
      held,
      research,
      cost: 0,
      reserve: { energy: energy + (research?.policy.fee ?? 0) },
    };
  },
  apply(ctx, { obj, bp, energy, materials, held, research }) {
    const { w, a } = ctx,
      from = obj.condition;
    obj.condition += bp;
    if (obj.ruined && obj.condition >= 1000) {
      obj.ruined = false;
      emit(w, 'restored', { place: a.place, data: { target: obj.id } });
      w.dayLog.restored.push({ target: obj.id, place: a.place });
    }
    residentFlow(w,a.id,'expense','repair','energy',energy);
    residentFlow(w,held?.beneficiary.kind==='agent'?held.beneficiary.id:held?null:a.id,'expense','repair','materials',materials);
    a.energy -= energy;
    takeMaterials(a, materials, held);
    w.materialLedger.lost += materials;
    sink(w, 'energy', 'repair', energy);
    payResearch(w, a, research);
    a.stats.repaired += energy;
    a.repairedToday += energy;
    w.dayLog.repairSpent += energy;
    if (w.places[obj.id]) {
      w.dayLog.repairedPlaces.push(obj.id);
      obj.activity.repairs++;
    }
    ctx.invested(energy);
    const data = {
      target: obj.id,
      from,
      to: obj.condition,
      bp,
      spent: energy,
      materials,
      researchUsed: research?.id ?? null,
      researchFee: research?.policy.fee ?? 0,
    };
    emit(w, 'repair', { agent: a.id, place: a.place, data });
    return data;
  },
};
const dismantle = {
  validate({ w, a }, args) {
    if (args.energy !== undefined) fail('invalid_args');
    let p = w.places[a.place],
      target = p;
    if (args.project) {
      p = own(w.projects, args.project);
      if (!p || !['cancelled', 'abandoned'].includes(p.status))
        fail('not_found');
      if (p.place !== a.place) fail('wrong_place');
      target = p;
    } else {
      if (p.landmark) fail('landmark');
      if (p.open || p.razed) fail('nothing_left');
      if (args.module) {
        target = p.modules.find((m) => m.type === args.module);
        if (!target) fail('not_found');
      }
    }
    const n = Math.min(
      positive(args.materials ?? 15),
      15,
      target.materialRecoverable
    );
    if (!n && !args.module) fail('nothing_left');
    return {
      p,
      target,
      n,
      module: args.module,
      project: args.project,
      cost: 2 * K(w),
    };
  },
  apply({ w, a }, { p, target, n, module, project }) {
    target.materialRecoverable -= n;
    residentFlow(w,a.id,'income','dismantle','materials',n);
    a.materials = addSafe(a.materials, n);
    if (project) {
      if (!target.materialRecoverable && p.lot) w.lots[p.lot].project = null;
    } else if (module) {
      if (!target.materialRecoverable) {
        p.modules = p.modules.filter((m) => m !== target);
        if (module === 'board') cancelBoardOffers(w, p.id);
      }
    } else {
      applyDamage(
        w,
        p,
        p.id,
        p.id,
        Math.ceil((n * 10000) / p.materialRecoverableMax)
      );
      if (!p.materialRecoverable) razePlace(w, p);
    }
    a.stats.salvaged += n;
    a.salvagedToday += n;
    w.dayLog.salvaged += n;
    emit(w, 'dismantle', {
      agent: a.id,
      place: a.place,
      data: {
        materials: n,
        materialRecoverable: target.materialRecoverable,
        module: module ?? null,
        project: project ?? null,
      },
    });
    return { materials: n, materialRecoverable: target.materialRecoverable };
  },
};
const cancel_project = {
  validate({ w, a }, args) {
    const j = project(w, args.project);
    if (
      !controls(w, a, j.owner) &&
      !(j.owner.kind === 'city' && j.initiator === a.id)
    )
      fail('not_owner');
    return { j, cost: 0 };
  },
  apply({ w }, { j }) {
    terminateProject(w, j);
    return { project: j.id, status: j.status };
  },
};
const project_policy = {
  validate({ w, a }, args) {
    const j = project(w, args.project);
    if (!controls(w, a, j.owner)) fail('not_owner');
    if (!['public', 'owner', 'group'].includes(args.access))
      fail('invalid_args');
    return { j, access: args.access, cost: 0 };
  },
  apply(ctx, { j, access }) {
    j.access = access;
    return { project: j.id, access };
  },
};
const research_policy = {
  validate({ w, a }, args) {
    const p = own(w.places, args.place),
      m = p?.modules?.find((m) => m.type === 'research');
    if (!m) fail('not_found');
    if (!controls(w, a, p.owner)) fail('not_owner');
    return { m, policy: validateResearchPolicy(args), cost: 0 };
  },
  apply(ctx, { m, policy }) {
    m.policy = policy;
    return { policy };
  },
};
const claim_policy = {
  validate({ w, a }, args) {
    const c = own(w.materialClaims, args.claim);
    if (
      !c ||
      c.beneficiary.kind !== 'group' ||
      w.groups[c.beneficiary.id]?.steward !== a.id
    )
      fail('not_allowed');
    if (
      !Array.isArray(args.agents) ||
      args.agents.length > 100 ||
      args.agents.some((id) => !w.agents[id] || !isAlive(w.agents[id]))
    )
      fail('invalid_args');
    return { c, agents: [...args.agents], cost: 0 };
  },
  apply(ctx, { c, agents }) {
    c.collectors = agents;
    return { claim: c.id, agents };
  },
};
export const materialHandlers = {
  gather,
  claim,
  return_materials,
  initiate,
  contribute,
  construct,
  repair,
  dismantle,
  cancel_project,
  project_policy,
  research_policy,
  claim_policy,
};
