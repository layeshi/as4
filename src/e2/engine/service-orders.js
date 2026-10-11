import { residentFlow } from '../p6/journal.js';
// Fixed-price, single-provider orders. Objective facts only; never judge truth or quality.
import { materialsEnabled, nextId, isAlive } from '../world.js';
import {
  fail,
  needInt,
  needText,
  emit,
  pushInbox,
  creditEnergy,
} from './core.js';
import { addSafe } from './materials.js';
export const pendingOrder = (o) =>
  ['open', 'offered', 'active'].includes(o.status);
const own = (table, id) =>
  typeof id === 'string' && Object.hasOwn(table, id) ? table[id] : null;
const integer = (n) => needInt(n, { min: 1 });
const time = (n, d) => needInt(n ?? d, { min: 1, max: 288 });
export function evidencePosition(w, index = 0, effect = 0) {
  return [w.commandN, index, effect];
}
const later = (a, b) =>
  a.some((n, i) => n > b[i] && a.slice(0, i).every((x, k) => x === b[k]));
export function validateCriterion(w, input, { template = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('unsupported_criterion');
  const c = structuredClone(input),
    fields = {
      material_delivery: ['kind', 'to', 'quantity', 'place'],
      construction: ['kind', 'project', 'work'],
      repair: ['kind', 'target', 'bp'],
      document: ['kind', 'publishPlace'],
      announcement: ['kind', 'audience', 'place'],
      proposal: ['kind', 'class'],
    }[c.kind];
  if (!Array.isArray(fields) || Object.keys(c).some((k) => !fields.includes(k)))
    fail('unsupported_criterion');
  if (c.kind === 'material_delivery') {
    integer(c.quantity);
    if (!template || c.place !== undefined) {
      if (!own(w.places, c.place)) fail('not_found');
    }
    if (!template || c.to !== undefined) {
      const a = own(w.agents, c.to),
        j = own(w.projects, c.to);
      if (!a && !j) fail('not_found');
      if (
        (a && !isAlive(a)) ||
        (j &&
          (j.status !== 'open' ||
            j.phase !== 'funding' ||
            j.place !== c.place ||
            c.quantity > j.needMaterials - j.haveMaterials))
      )
        fail('target_unavailable');
    }
  }
  if (c.kind === 'construction') {
    integer(c.work);
    if (!template || c.project !== undefined) {
      const j = own(w.projects, c.project);
      if (!j || j.status !== 'open' || j.needWork - j.progress < c.work)
        fail('target_unavailable');
    }
  }
  if (c.kind === 'repair') {
    integer(c.bp);
    if (!template || c.target !== undefined) {
      const p = own(w.places, c.target) ?? own(w.roads, c.target);
      if (!p || p.condition === null || 10000 - p.condition < c.bp)
        fail('target_unavailable');
    }
  }
  if (
    c.kind === 'document' &&
    c.publishPlace !== undefined &&
    !own(w.places, c.publishPlace)
  )
    fail('not_found');
  if (c.kind === 'announcement') {
    if (!['all', 'place'].includes(c.audience)) fail('unsupported_criterion');
    if (
      c.audience === 'place' &&
      (!template || c.place !== undefined) &&
      !own(w.places, c.place)
    )
      fail('not_found');
  }
  if (
    c.kind === 'proposal' &&
    c.class !== undefined &&
    !['ordinary', 'constitutional'].includes(c.class)
  )
    fail('unsupported_criterion');
  return c;
}
function eligible(w, a, e) {
  return e === 'any' || a.groups.includes(e);
}
function eligibility(w, e = 'any') {
  if (e !== 'any' && (!own(w.groups, e) || w.groups[e].dissolved))
    fail('invalid_args');
  return e;
}
function order(w, id) {
  const o = own(w.orders, id);
  if (!o) fail('not_found');
  return o;
}
export function settleOrder(w, o, status, reason) {
  if (!pendingOrder(o)) return;
  const n = o.escrow,
    to = status === 'completed' ? o.provider : o.requester;
  residentFlow(w,to,status==='completed'?'income':'refund','order','energy',n);
  if(status==='completed')residentFlow(w,o.requester,'payment','order','energy',n);
  o.escrow = 0;
  o.status = status;
  o.closedTick = w.clock.tick;
  o.reason = reason;
  const a = w.agents[to];
  addSafe(a.energy, n);
  creditEnergy(w, a, n);
  emit(w, 'order_settled', {
    data: { order: o.id, status, reason, to, amount: n, ...(w.premise===6?{requester:o.requester,provider:o.provider}:{}) },
  });
  for (const id of [o.requester, o.provider])
    if (w.agents[id] && isAlive(w.agents[id]))
      pushInbox(w, w.agents[id], 'order', {
        order: o.id,
        status,
        amount: n,
        reason,
      });
}
function targetGone(w, c) {
  if (c.kind === 'construction')
    return !w.projects[c.project] || w.projects[c.project].status !== 'open';
  if (c.kind === 'material_delivery') {
    const a = w.agents[c.to],
      j = w.projects[c.to];
    return a ? !isAlive(a) : !j || j.status !== 'open' || j.phase !== 'funding';
  }
  if (c.kind === 'repair') {
    const p = w.places[c.target] ?? w.roads[c.target];
    return !p || p.razed;
  }
  return c.publishPlace && !w.places[c.publishPlace];
}
export function sweepOrders(w, departing = null) {
  if (!materialsEnabled(w)) return;
  for (const o of Object.values(w.orders))
    if (pendingOrder(o)) {
      if (departing && (o.requester === departing || o.provider === departing))
        settleOrder(w, o, 'failed', 'party_departed');
      else if (w.clock.tick >= (o.status === 'active' ? o.dueTick : o.acceptBy))
        settleOrder(w, o, 'expired', 'deadline');
      else if (targetGone(w, o.terms.criterion))
        settleOrder(w, o, 'failed', 'target_unavailable');
    }
  for (const [id, r] of Object.entries(w.serviceReceipts ?? {}))
    if (r.tick < w.clock.tick - 288) delete w.serviceReceipts[id];
  if (departing)
    for (const s of Object.values(w.services))
      if (s.provider === departing) s.status = 'withdrawn';
}
export function validateOrderAction(w, a, act) {
  if (
    !act.order ||
    !['give', 'contribute', 'construct', 'repair'].includes(act.type)
  )
    return;
  const o = order(w, act.order),
    c = o.terms.criterion;
  if (o.status !== 'active' || o.provider !== a.id || w.clock.tick >= o.dueTick)
    fail('order_not_active');
  const match =
    (c.kind === 'construction' &&
      act.type === 'construct' &&
      act.project === c.project) ||
    (c.kind === 'repair' &&
      act.type === 'repair' &&
      (act.target ?? a.place) === c.target) ||
    (c.kind === 'material_delivery' &&
      a.place === c.place &&
      ((act.type === 'give' &&
        (w.agents[act.to]?.id ??
          Object.values(w.agents).find((x) => x.name === act.to)?.id) ===
          c.to) ||
        (act.type === 'contribute' && act.project === c.to)));
  if (!match) fail('order_target_mismatch');
}
function addEvidence(w, o, key, position, amount, ref) {
  if (w.orderEvidence[key]) fail('evidence_used');
  if (!later(position, o.acceptedSeq)) fail('evidence_predates_order');
  w.orderEvidence[key] = o.id;
  o.evidence.push({ key, position, amount, ref });
  o.progress = addSafe(o.progress, amount);
  const c = o.terms.criterion,
    goal = c.quantity ?? c.work ?? c.bp ?? 1;
  if (o.progress >= goal) settleOrder(w, o, 'completed', 'criterion_met');
}
export function recordServiceAction(w, a, act, data, index, startPlace) {
  if (!materialsEnabled(w)) return;
  const seq = evidencePosition(w, index, 1);
  if (
    act.order &&
    ['give', 'contribute', 'construct', 'repair'].includes(act.type)
  ) {
    const o = w.orders[act.order],
      n =
        act.type === 'construct'
          ? data.workAdded
          : act.type === 'repair'
            ? data.to - data.from
            : data.materials;
    if (n > 0) addEvidence(w, o, `action:${seq.join(':')}`, seq, n, null);
  }
  let entity = null,
    kind = null;
  if (act.type === 'write') {
    kind = 'document';
    entity = data.doc ?? data.id;
  }
  if (act.type === 'propose') {
    kind = 'proposal';
    entity = data.proposal;
  }
  if (['say', 'broadcast', 'inscribe'].includes(act.type)) {
    kind = 'announcement';
    entity = `receipt:${seq.join(':')}`;
  }
  if (kind && entity) {
    const id = typeof entity === 'object' ? entity.id : entity;
    w.serviceReceipts ??= {};
    w.serviceReceipts[id] = {
      id,
      kind,
      tick: w.clock.tick,
      actor: a.id,
      position: seq,
      place: startPlace,
      audience: act.type === 'broadcast' ? 'all' : 'place',
      class: act.class ?? 'ordinary',
    };
    data.serviceEvidence = id;
  }
  sweepOrders(w);
}
function listing(w, a, args) {
  return {
    title: needText(args.title, { max: 80 }),
    description: needText(args.description, { max: 600 }),
    price: integer(args.price),
    criterionTemplate: validateCriterion(w, args.criterionTemplate, {
      template: true,
    }),
    waitTicks: time(args.waitTicks, 12),
    durationTicks: time(args.durationTicks, 36),
  };
}
function buyerCapacity(w, a) {
  if (
    Object.values(w.orders).filter(
      (o) => pendingOrder(o) && o.requester === a.id
    ).length >= 10
  )
    fail('limit_reached');
}
function newOrder(w, a, plan) {
  residentFlow(w,a.id,'escrow','order','energy',plan.terms.price);
  a.energy -= plan.terms.price;
  const id = nextId(w, 'so');
  const o = {
    id,
    origin: plan.origin,
    requester: a.id,
    provider: plan.provider ?? null,
    title: plan.title,
    description: plan.description,
    terms: structuredClone(plan.terms),
    escrow: plan.terms.price,
    status: plan.origin === 'demand' ? 'open' : 'offered',
    createdTick: w.clock.tick,
    acceptBy: w.clock.tick + plan.waitTicks,
    progress: 0,
    evidence: [],
    ...(plan.serviceId ? { serviceId: plan.serviceId } : {}),
  };
  w.orders[id] = o;
  emit(w, 'order_open', { agent: a.id, data: structuredClone(o) });
  return {
    order: id,
    escrow: o.escrow,
    status: o.status,
    acceptBy: o.acceptBy,
  };
}
const service_publish = {
  validate({ w, a }, args) {
    if (
      Object.values(w.services).filter(
        (s) => s.provider === a.id && s.status === 'active'
      ).length >= 5
    )
      fail('limit_reached');
    return { ...listing(w, a, args), cost: 0 };
  },
  apply({ w, a }, p) {
    const id = nextId(w, 'sv');
    const { cost, ...fields } = p;
    w.services[id] = {
      id,
      provider: a.id,
      ...fields,
      status: 'active',
      createdTick: w.clock.tick,
      updatedTick: w.clock.tick,
    };
    emit(w, 'service_published', {
      agent: a.id,
      data: structuredClone(w.services[id]),
    });
    return { service: id };
  },
};
const service_edit = {
  validate({ w, a }, args) {
    const s = own(w.services, args.service);
    if (!s || s.provider !== a.id || s.status !== 'active') fail('not_found');
    return { s, fields: listing(w, a, { ...s, ...args }), cost: 0 };
  },
  apply({ w }, { s, fields }) {
    Object.assign(s, fields, { updatedTick: w.clock.tick });
    emit(w, 'service_edited', { data: structuredClone(s) });
    return { service: s.id };
  },
};
const service_withdraw = {
  validate({ w, a }, args) {
    const s = own(w.services, args.service);
    if (!s || s.provider !== a.id) fail('not_found');
    return { s, cost: 0 };
  },
  apply(ctx, { s }) {
    s.status = 'withdrawn';
    return { service: s.id };
  },
};
const demand_publish = {
  validate({ w, a }, args) {
    buyerCapacity(w, a);
    const price = integer(args.price);
    return {
      title: needText(args.title, { max: 80 }),
      description: needText(args.description, { max: 600 }),
      terms: {
        price,
        criterion: validateCriterion(w, args.criterion),
        durationTicks: time(args.durationTicks, 36),
        eligible: eligibility(w, args.eligible),
      },
      waitTicks: time(args.waitTicks, 12),
      origin: 'demand',
      cost: 0,
      reserve: { energy: price },
    };
  },
  apply({ w, a }, p) {
    return newOrder(w, a, p);
  },
};
const service_order = {
  validate({ w, a }, args) {
    buyerCapacity(w, a);
    const s = own(w.services, args.service);
    if (!s || s.status !== 'active' || !isAlive(w.agents[s.provider]))
      fail('not_found');
    if (s.provider === a.id) fail('not_allowed');
    const target = args.targetArgs ?? {};
    if (
      !target ||
      typeof target !== 'object' ||
      Array.isArray(target) ||
      Object.keys(target).some(
        (k) =>
          ![
            'to',
            'place',
            'project',
            'target',
            'publishPlace',
            'class',
          ].includes(k) || s.criterionTemplate[k] !== undefined
      )
    )
      fail('invalid_args');
    const criterion = validateCriterion(w, {
      ...s.criterionTemplate,
      ...target,
    });
    return {
      ...s,
      provider: s.provider,
      serviceId: s.id,
      origin: 'service',
      terms: {
        price: s.price,
        criterion,
        durationTicks: s.durationTicks,
        eligible: 'any',
      },
      cost: 0,
      reserve: { energy: s.price },
    };
  },
  apply({ w, a }, p) {
    return newOrder(w, a, p);
  },
};
const order_accept = {
  validate({ w, a }, args) {
    const o = order(w, args.order);
    if (!['open', 'offered'].includes(o.status) || w.clock.tick >= o.acceptBy)
      fail('order_not_active');
    if (
      o.requester === a.id ||
      (o.provider && o.provider !== a.id) ||
      !eligible(w, a, o.terms.eligible)
    )
      fail('not_allowed');
    if (
      Object.values(w.orders).filter(
        (x) => x.status === 'active' && x.provider === a.id
      ).length >= 5
    )
      fail('limit_reached');
    validateCriterion(w, o.terms.criterion);
    return { o, cost: 0 };
  },
  apply({ w, a, evidenceIndex }, { o }) {
    o.status = 'active';
    o.provider = a.id;
    o.acceptedTick = w.clock.tick;
    o.acceptedSeq = evidencePosition(w, evidenceIndex ?? 0);
    o.dueTick = w.clock.tick + o.terms.durationTicks;
    emit(w, 'order_accepted', {
      agent: a.id,
      data: { order: o.id, dueTick: o.dueTick },
    });
    return { order: o.id, dueTick: o.dueTick };
  },
};
const order_decline = {
  validate({ w, a }, args) {
    const o = order(w, args.order);
    if (o.status !== 'offered' || o.provider !== a.id) fail('not_allowed');
    return { o, cost: 0 };
  },
  apply({ w }, { o }) {
    settleOrder(w, o, 'cancelled', 'declined');
    return { order: o.id, status: o.status };
  },
};
const order_cancel = {
  validate({ w, a }, args) {
    const o = order(w, args.order);
    if (
      !pendingOrder(o) ||
      ![o.requester, o.provider].includes(a.id) ||
      (o.status !== 'active' && o.requester !== a.id)
    )
      fail('not_allowed');
    return { o, cost: 0 };
  },
  apply({ w, a }, { o }) {
    if (
      o.status !== 'active' ||
      (o.cancelRequestedBy && o.cancelRequestedBy !== a.id)
    )
      settleOrder(w, o, 'cancelled', 'agreement');
    else o.cancelRequestedBy = a.id;
    return {
      order: o.id,
      status: o.status,
      cancelRequestedBy: o.cancelRequestedBy ?? null,
    };
  },
};
const order_submit = {
  validate({ w, a }, args) {
    const o = order(w, args.order),
      r = own(
        w.serviceReceipts ?? {},
        args.ref && typeof args.ref === 'object' ? args.ref.id : args.ref
      );
    if (
      o.status !== 'active' ||
      o.provider !== a.id ||
      w.clock.tick >= o.dueTick
    )
      fail('order_not_active');
    const c = o.terms.criterion;
    if (!r || r.actor !== a.id || r.kind !== c.kind) fail('invalid_evidence');
    if (
      (c.publishPlace && r.place !== c.publishPlace) ||
      (c.kind === 'announcement' &&
        (r.audience !== c.audience ||
          (c.audience === 'place' && r.place !== c.place))) ||
      (c.class && r.class !== c.class)
    )
      fail('invalid_evidence');
    if (c.kind === 'document' && (!w.docs[r.id] || w.docs[r.id].redacted))
      fail('invalid_evidence');
    if (c.kind === 'proposal' && !w.proposals[r.id]) fail('invalid_evidence');
    if (w.orderEvidence[`${r.kind}:${r.id}`]) fail('evidence_used');
    if (!later(r.position, o.acceptedSeq)) fail('evidence_predates_order');
    return { o, r, cost: 0 };
  },
  apply({ w }, { o, r }) {
    addEvidence(w, o, `${r.kind}:${r.id}`, r.position, 1, r.id);
    return { order: o.id, status: o.status };
  },
};
export const serviceHandlers = {
  service_publish,
  service_edit,
  service_withdraw,
  service_order,
  demand_publish,
  order_accept,
  order_decline,
  order_cancel,
  order_submit,
};
