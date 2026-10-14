import { fail } from '../engine/core.js';
import { COOP_LIMITS, requireCooperation, nextCoopId, text, ids, existingAgent, fields, snapshot, activeCollaboration, activeCount } from './core.js';
import { cardFor } from './cards.js';

export const canReadCollaboration = (c, actor) => c.visibility === 'public' || c.invited.includes(actor) || c.members.includes(actor) || c.owner === actor;
export function collaborationFor(w, id, actor) {
  const records = requireCooperation(w).collaborations;
  const c = Object.hasOwn(records,id) ? records[id] : null;
  if (!c || !canReadCollaboration(c, actor)) fail('not_found');
  return c;
}
function available(w, actor) { if (activeCount(w, actor) >= COOP_LIMITS.collaborations) fail('limit_reached'); }
function refs(w, values, actor) {
  if (!Array.isArray(values) || values.length > 8 || new Set(values).size !== values.length) fail('invalid_args');
  return values.map(id => { cardFor(w, id, actor); return id; });
}
export const collaborationHandler = {
  validate({ w, a }, args) {
    requireCooperation(w);
    fields(args, ['op', 'id', 'title', 'goal', 'tasks', 'visibility', 'agents', 'task', 'text', 'accept', 'to', 'cards', 'order', 'source', 'evidence']);
    if (args.op === 'create') {
      available(w, a.id);
      if (!Array.isArray(args.tasks) || !args.tasks.length || args.tasks.length > COOP_LIMITS.tasks) fail('invalid_args');
      const visibility = args.visibility ?? 'invited';
      if (!['public', 'invited'].includes(visibility)) fail('invalid_args');
      const invited = ids(w, args.agents ?? []).filter(id => id !== a.id);
      if (invited.length >= COOP_LIMITS.participants) fail('limit_reached');
      const source = args.source == null ? null : collaborationFor(w, args.source, a.id).id;
      return { op: args.op, title: text(args.title, 80), goal: text(args.goal, 600), tasks: args.tasks.map(s => text(s, 300)), visibility, invited, source, cost: 0 };
    }
    const c = collaborationFor(w, args.id, a.id);
    const p = { op: args.op, c, cost: 0 };
    if (!['invite', 'join', 'claim', 'submit', 'review', 'update', 'leave', 'handoff', 'accept_handoff', 'finish', 'cancel', 'link'].includes(args.op)) fail('invalid_args');
    if (!activeCollaboration(c)) fail('not_allowed');
    if (['invite', 'review', 'handoff', 'finish', 'cancel', 'link'].includes(args.op) && c.owner !== a.id) fail('forbidden');
    if (['claim', 'submit', 'update', 'leave', 'accept_handoff'].includes(args.op) && !c.members.includes(a.id)) fail('forbidden');
    if (args.op === 'invite') {
      p.invited = [...new Set([...c.invited, ...ids(w, args.agents)])];
      if (new Set([...p.invited, ...c.members]).size > COOP_LIMITS.participants) fail('limit_reached');
    }
    if (args.op === 'join') {
      if (c.members.includes(a.id)) fail('already');
      if (c.visibility !== 'public' && !c.invited.includes(a.id)) fail('forbidden');
      if (new Set([...c.invited, ...c.members, a.id]).size > COOP_LIMITS.participants) fail('limit_reached');
      available(w, a.id);
    }
    if (['claim', 'submit', 'review'].includes(args.op)) {
      if (!Number.isSafeInteger(args.task) || !c.tasks[args.task]) fail('not_found');
      p.task = args.task;
      const t = c.tasks[args.task];
      if (args.op === 'claim' && (t.assignee !== null || t.status !== 'open')) fail('already');
      if (args.op === 'submit' && (t.assignee !== a.id || t.status !== 'claimed')) fail('forbidden');
      if (args.op === 'review' && t.status !== 'submitted') fail('not_allowed');
    }
    if (['submit', 'update'].includes(args.op)) p.text = text(args.text, 600);
    if (args.op === 'submit') {
      p.cards = refs(w, args.cards ?? [], a.id);
      if (args.evidence !== undefined && (!Array.isArray(args.evidence) || args.evidence.length > 8 || new Set(args.evidence).size !== args.evidence.length)) fail('invalid_args');
      p.evidence = (args.evidence ?? []).map(id => {
        const activity = Object.hasOwn(w.cooperation.activities,id) ? w.cooperation.activities[id] : null;
        if (!activity || activity.actor !== a.id) fail('not_found');
        return id;
      });
    }
    if (args.op === 'review') {
      if (typeof args.accept !== 'boolean') fail('invalid_args');
      p.accept = args.accept; p.text = text(args.text, 300, true);
      if (!p.accept && !p.text) fail('invalid_args');
    }
    if (args.op === 'handoff') {
      p.to = existingAgent(w, args.to, true);
      if (p.to === a.id || !c.members.includes(p.to)) fail('invalid_args');
    }
    if (args.op === 'accept_handoff' && c.handoff !== a.id) fail('forbidden');
    if (args.op === 'finish' && c.tasks.some(t => t.status !== 'accepted')) fail('not_allowed');
    if (args.op === 'link') {
      const order = w.orders?.[args.order];
      if (!order || ![order.requester, order.provider].includes(a.id)) fail('not_found');
      if (c.orders.length >= 8 || c.orders.includes(args.order)) fail('limit_reached');
      p.order = args.order;
    }
    // Exiting is guaranteed by the world's guard laws, including an orphaned owner.
    if (args.op === 'leave') p.skipBefore = true;
    return p;
  },
  apply({ w, a }, p) {
    let c = p.c;
    if (p.op === 'create') {
      const id = nextCoopId(w, 'collaboration');
      c = { id, founder: a.id, owner: a.id, title: p.title, goal: p.goal, visibility: p.visibility, invited: [a.id, ...p.invited], members: [a.id], status: 'open', handoff: null, source: p.source, orders: [], history: [], contributions: [], tasks: p.tasks.map(title => ({ title, assignee: null, status: 'open', submissions: [], reviews: [] })) };
      w.cooperation.collaborations[id] = c;
    } else if (p.op === 'invite') c.invited = p.invited;
    else if (p.op === 'join') { c.members.push(a.id); if (c.status === 'open') c.status = 'active'; }
    else if (p.op === 'claim') Object.assign(c.tasks[p.task], { assignee: a.id, status: 'claimed' });
    else if (p.op === 'submit') {
      const result = { actor: a.id, task: p.task, text: p.text, cards: p.cards, evidence: p.evidence, tick: w.clock.tick, kind: 'resident_claim' };
      c.tasks[p.task].submissions.push(result); c.tasks[p.task].status = 'submitted'; c.contributions.push(result);
    } else if (p.op === 'review') {
      c.tasks[p.task].reviews.push({ actor: a.id, accepted: p.accept, text: p.text, tick: w.clock.tick });
      c.tasks[p.task].status = p.accept ? 'accepted' : 'claimed';
    } else if (p.op === 'update') c.contributions.push({ actor: a.id, text: p.text, tick: w.clock.tick, kind: 'resident_claim' });
    else if (p.op === 'handoff') c.handoff = p.to;
    else if (p.op === 'accept_handoff') { c.owner = a.id; c.handoff = null; }
    else if (p.op === 'leave') {
      c.members = c.members.filter(id => id !== a.id);
      for (const t of c.tasks) if (t.assignee === a.id && t.status !== 'accepted') Object.assign(t, { assignee: null, status: 'open' });
      if (c.owner === a.id) { c.owner = null; c.status = 'orphaned'; }
      if (c.handoff === a.id) c.handoff = null;
    } else if (p.op === 'finish') c.status = 'completed';
    else if (p.op === 'cancel') c.status = 'cancelled';
    else if (p.op === 'link') c.orders.push(p.order);
    const version = snapshot(w, c, 'collaboration', a.id, p.op);
    return { id: c.id, version, op: p.op, status: c.status };
  },
};
export function departures(w) {
  if (!w.cooperation) return;
  for (const c of Object.values(w.cooperation.collaborations)) {
    if (!activeCollaboration(c)) continue;
    for (const id of [...c.members]) if (['dead', 'retired'].includes(w.agents[id]?.status)) {
      c.members = c.members.filter(x => x !== id);
      for (const t of c.tasks) if (t.assignee === id && t.status !== 'accepted') Object.assign(t, { assignee: null, status: 'open' });
      if (c.owner === id) { c.owner = null; c.status = 'orphaned'; }
      if (c.handoff === id) c.handoff = null;
      snapshot(w, c, 'collaboration', id, 'departed');
    }
  }
}
