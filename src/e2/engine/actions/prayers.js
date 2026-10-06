import { clockDay } from '../../world.js';
import { fail, needText, needId, emit } from '../core.js';
import { prayerAccount, prayersEnabled } from '../prayer-rewards.js';

function enabled(w) { if (!prayersEnabled(w)) fail('invalid_args'); }
const pray = {
  validate({ w, a }, args) {
    enabled(w);
    const place = w.places[a.place];
    if (a.place !== 'temple' || place.origin !== 'human' || place.razed || place.ruined || place.condition === null || place.condition <= 0) fail('wrong_place');
    const text = needText(args.text, { max: 600 });
    if (w.prayers.accounts[a.id]?.lastPrayerDay === clockDay(w)) fail('cooldown', null, { untilDay: clockDay(w) + 1 });
    return { text, cost: 1 };
  },
  apply({ w, a }, { text }) {
    const id = `pr${++w.prayers.counters.prayer}`;
    w.prayers.prayers[id] = { id, agentId: a.id, text, day: clockDay(w), tick: w.clock.tick, status: 'pending', reply: null };
    prayerAccount(w, a.id).lastPrayerDay = clockDay(w);
    emit(w, 'pray', { agent: a.id, place: 'temple', data: { prayerId: id, text } });
    return { prayerId: id };
  },
};
function workRef(w, a, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_args');
  const id = needId(value.id);
  if (value.kind === 'doc') {
    const doc = w.docs[id];
    if (!doc || doc.kind !== 'agent' || doc.author !== a.id || doc.redacted) fail('not_found');
  } else if (value.kind === 'project') {
    const project = w.projects[id];
    if (!project || project.status !== 'built' || !(project.contributors[a.id] > 0)) fail('not_found');
  } else fail('invalid_args');
  return { kind: value.kind, id };
}
const invent = {
  validate({ w, a }, args) {
    enabled(w);
    const title = needText(args.title, { max: 100 }); const text = needText(args.text, { max: 600 });
    const ref = workRef(w, a, args.ref);
    const existing = Object.values(w.prayers.inventions).find((i) => i.ref.kind === ref.kind && i.ref.id === ref.id);
    let submission = null;
    if (args.submission !== undefined) {
      submission = w.prayers.inventions[needId(args.submission)];
      if (!submission || submission.agentId !== a.id || submission.status !== 'rejected' || submission.awarded || submission.ref.kind !== ref.kind || submission.ref.id !== ref.id) fail('not_allowed');
    } else if (existing) fail('already');
    return { title, text, ref, submission, cost: 1 };
  },
  apply({ w, a }, plan) {
    const id = plan.submission?.id || `iv${++w.prayers.counters.invention}`;
    const record = plan.submission || { id, agentId: a.id, ref: plan.ref, awarded: false, history: [] };
    Object.assign(record, { title: plan.title, text: plan.text, status: 'pending', day: clockDay(w), tick: w.clock.tick });
    record.history.push({ kind: 'submission', title: plan.title, text: plan.text, day: clockDay(w), tick: w.clock.tick });
    w.prayers.inventions[id] = record;
    emit(w, 'invent', { agent: a.id, place: a.place, data: { inventionId: id, title: plan.title, text: plan.text, ref: { ...plan.ref } } });
    return { inventionId: id };
  },
};
export const prayerHandlers = { pray, invent };
