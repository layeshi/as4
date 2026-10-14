import { fail } from '../engine/core.js';
import { requireCooperation, COOP_LIMITS, nextCoopId, text, ids, fields, snapshot } from './core.js';

export const canReadCard = (card, actor) => card.author === actor || card.visibility === 'public' || card.visibility === 'shared' && card.readers.includes(actor);
export function cardFor(w, id, actor) {
  const records = requireCooperation(w).cards;
  const c = Object.hasOwn(records,id) ? records[id] : null;
  if (!c || !canReadCard(c, actor)) fail('not_found');
  return c;
}
function visibility(value, fallback = 'private') {
  const v = value ?? fallback;
  if (!['private', 'shared', 'public'].includes(v)) fail('invalid_args');
  return v;
}
function sourceFor(w, input, actor) {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['id', 'version'].includes(k))) fail('invalid_args');
  const source = cardFor(w, input.id, actor);
  const version = input.version ?? source.history.length;
  if (!Number.isSafeInteger(version) || version < 1 || !source.history[version - 1] || !canReadCard(source.history[version - 1].value, actor)) fail('not_found');
  return { id: source.id, version };
}
export const cardHandler = {
  validate({ w, a }, args) {
    const state = requireCooperation(w);
    fields(args, ['op', 'id', 'title', 'body', 'visibility', 'readers', 'source', 'version', 'text']);
    if (['create', 'copy'].includes(args.op)) {
      if (Object.values(state.cards).filter(c => c.author === a.id && !c.archived).length >= COOP_LIMITS.cards) fail('limit_reached');
      const source = sourceFor(w, args.source ?? (args.op === 'copy' ? { id: args.id, version: args.version } : null), a.id);
      if (args.op === 'copy' && !source) fail('invalid_args');
      const old = source ? state.cards[source.id].history[source.version - 1].value : null;
      const v = visibility(args.visibility);
      return { op: args.op, title: text(args.title ?? old?.title, 80), body: text(args.body ?? old?.body, COOP_LIMITS.body), visibility: v, readers: v === 'shared' ? ids(w, args.readers ?? []) : [], source, cost: 0 };
    }
    const card = cardFor(w, args.id, a.id);
    if (!['revise', 'share', 'archive', 'cite', 'feedback'].includes(args.op)) fail('invalid_args');
    if (['revise', 'share', 'archive'].includes(args.op) && card.author !== a.id) fail('forbidden');
    if (args.version !== undefined && args.version !== card.history.length) fail('conflict');
    if (card.archived && args.op !== 'cite' && args.op !== 'feedback') fail('not_allowed');
    const plan = { op: args.op, card, cost: 0 };
    if (args.op === 'revise') Object.assign(plan, { title: text(args.title ?? card.title, 80), body: text(args.body, COOP_LIMITS.body) });
    if (args.op === 'share') {
      plan.visibility = visibility(args.visibility, card.visibility);
      plan.readers = plan.visibility === 'shared' ? ids(w, args.readers ?? []) : [];
    }
    if (args.op === 'feedback') plan.text = text(args.text, 300);
    return plan;
  },
  apply({ w, a }, p) {
    let c = p.card;
    if (['create', 'copy'].includes(p.op)) {
      const id = nextCoopId(w, 'card');
      c = { id, author: a.id, title: p.title, body: p.body, visibility: p.visibility, readers: p.readers, source: p.source, archived: false, history: [], feedback: [], citations: [] };
      w.cooperation.cards[id] = c;
    } else if (p.op === 'revise') Object.assign(c, { title: p.title, body: p.body });
    else if (p.op === 'share') Object.assign(c, { visibility: p.visibility, readers: p.readers });
    else if (p.op === 'archive') c.archived = true;
    else if (p.op === 'cite') {
      if (c.citations.length >= 128) fail('limit_reached');
      c.citations.push({ actor: a.id, version: c.history.length, tick: w.clock.tick });
    } else if (p.op === 'feedback') {
      if (c.feedback.length >= 128) fail('limit_reached');
      c.feedback.push({ actor: a.id, text: p.text, tick: w.clock.tick, kind: 'resident_claim' });
    }
    const version = snapshot(w, c, 'knowledge_card', a.id, p.op);
    return { id: c.id, version, op: p.op };
  },
};
