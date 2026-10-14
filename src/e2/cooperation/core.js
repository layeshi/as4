import { P } from '../params.js';
import { bad, emit, fail, needText } from '../engine/core.js';
import { cpLength, truncateCp } from '../../text.js';

export const COOP_LIMITS = Object.freeze({ brief: 400, page: 1200, read: 3600, cards: 32, body: 2000, collaborations: 8, participants: 8, tasks: 8, notes: 32, note: 200 });
export const COOP_LOOKS = Object.freeze(['cards', 'collaborations', 'relations', 'cooperation_rules']);
export const cooperationEnabled = w => w.premise === 6 && w.cooperation?.version === 1;
export function enableCooperation(w, args = {}) {
  if (w.premise !== 6) return bad('not_allowed');
  if (args.version !== 1 || Object.keys(args).some(k => k !== 'version')) return bad('invalid_request', { field: 'version' });
  if (cooperationEnabled(w)) return { ok: true, version: 1, enabledTick: w.cooperation.enabledTick };
  w.cooperation = { version: 1, revision: 1, enabledTick: w.clock.tick, enabledCommand: w.commandN, counters: { card: 0, collaboration: 0, fact: 0 }, cards: {}, collaborations: {}, notes: {}, facts: [], activities: {} };
  emit(w, 'cooperation_enabled', { data: { version: 1, enabledTick: w.clock.tick } });
  return { ok: true, version: 1, enabledTick: w.clock.tick };
}
export function requireCooperation(w) { if (!cooperationEnabled(w)) fail('not_allowed'); return w.cooperation; }
export const nextCoopId = (w, kind) => `${kind === 'card' ? 'k' : 'q'}${++w.cooperation.counters[kind]}`;
export function text(v, max, optional = false) { return optional && (v === undefined || v === null) ? '' : needText(v, { max }); }
export function existingAgent(w, id, living = false) {
  if (typeof id !== 'string' || !Object.hasOwn(w.agents, id)) fail('not_found');
  if (living && ['dead', 'retired'].includes(w.agents[id].status)) fail('not_found');
  return id;
}
export function ids(w, values, max = COOP_LIMITS.participants) {
  if (!Array.isArray(values) || values.length > max || new Set(values).size !== values.length) fail('invalid_args');
  return values.map(id => existingAgent(w, id, true));
}
export function fields(args, allowed) {
  if (Object.keys(args).some(k => !['type', ...allowed].includes(k))) fail('invalid_args');
}
export function snapshot(w, record, kind, actor, op) {
  const value = structuredClone(Object.fromEntries(Object.entries(record).filter(([k]) => !['history','contributions','feedback','citations','tasks'].includes(k))));
  // Append-only logs are shared by editions using immutable prefix lengths.
  // Copying every previous submission into every edition would grow quadratically.
  if (kind === 'knowledge_card') {
    value.feedbackCount = record.feedback.length;
    value.citationCount = record.citations.length;
  }
  if (kind === 'collaboration') {
    value.contributionCount = record.contributions.length;
    value.tasks = record.tasks.map(t => ({ title:t.title, assignee:t.assignee, status:t.status, submissionCount:t.submissions.length, reviewCount:t.reviews.length }));
  }
  const version = record.history.length + 1;
  const publicNow = record.visibility === 'public';
  const entry = { version, tick: w.clock.tick, command: w.commandN, releaseTick: publicNow ? w.clock.tick : w.clock.tick + P.privateDelayTicks, actor, op, value };
  record.history.push(entry);
  w.cooperation.revision++;
  emit(w, kind, { agent: actor, vis: publicNow ? 'public' : 'delayed', data: { id: record.id, version, op } });
  return version;
}
export function bound(s, max) { return cpLength(s) <= max ? s : truncateCp(s, Math.max(0, max - 1)) + '…'; }
export const activeCollaboration = c => ['open', 'active', 'orphaned'].includes(c.status);
export const activeCount = (w, id) => Object.values(w.cooperation.collaborations).filter(c => activeCollaboration(c) && c.members.includes(id)).length;
