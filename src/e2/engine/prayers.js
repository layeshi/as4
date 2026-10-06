import { clockDay, isAlive } from '../world.js';
import { bad, ReqError, reqText, emit, pushInbox, creditEnergy } from './core.js';
import { source } from './ledger.js';
import { PRAYER_RULES, prayersEnabled, prayerAccount, pointEntry } from './prayer-rewards.js';
export { PRAYER_RULES, prayersEnabled } from './prayer-rewards.js';

export function enablePrayers(w) {
  if (w.premise !== 2) return bad('not_allowed');
  if (prayersEnabled(w)) return { ok: true, enabled: true, alreadyEnabled: true };
  const naturalDamage = {}; const razedSites = {};
  for (const obj of [...Object.values(w.places), ...Object.values(w.roads)]) {
    naturalDamage[obj.id] = 0;
    if (obj.razed || obj.incarnations?.some((i) => i.toDay !== null)) razedSites[obj.id] = true;
  }
  const projectBaseline = {};
  for (const j of Object.values(w.projects)) projectBaseline[j.id] = { ...j.contributors };
  w.prayers = { enabled: true, enabledDay: clockDay(w), enabledTick: w.clock.tick, accounts: {}, prayers: {}, inventions: {}, ledger: [], audit: [], naturalDamage, razedSites, destroyedModules: {}, projectBaseline, completedProjects: {}, rescuedDay: {}, counters: { prayer: 0, invention: 0, ledger: 0 } };
  emit(w, 'prayer_enabled', { data: { enabled: true } });
  return { ok: true, enabled: true };
}
const actorValid = (id) => typeof id === 'string' && id.trim().length > 0 && id.length <= 128;
export function replyPrayer(w, p) {
  if (!prayersEnabled(w)) return bad('not_allowed');
  const prayer = typeof p.prayerId === 'string' ? w.prayers.prayers[p.prayerId] : null;
  if (!prayer) return bad('not_found');
  const a = w.agents[prayer.agentId];
  if (!a?.owner || !isAlive(a)) return bad('not_allowed');
  if (!actorValid(p.actorId)) return bad('invalid_request', { field: 'actorId' });
  if (typeof p.ownerTokenHash !== 'string' || p.ownerTokenHash !== a.tokenHash) return bad('unauthorized');
  if (prayer.status !== 'pending') return bad('already');
  try {
    const text = p.text == null ? null : reqText(p.text, { max: 600, field: 'text' });
    const energy = p.energy === undefined ? 0 : p.energy;
    if (!Number.isSafeInteger(energy) || energy < 0 || energy > 1000000) return bad('invalid_request', { field: 'energy' });
    if (!text && energy === 0) return bad('invalid_request', { field: 'text' });
    if (!Number.isSafeInteger(a.energy + energy)) return bad('invalid_request', { field: 'energy' });
    const cost = energy + (text ? 1 : 0);
    const account = w.prayers.accounts[a.id];
    if ((account?.balance || 0) < cost) return bad('insufficient_points', { required: cost, balance: account?.balance || 0 });
    pointEntry(w, a.id, -cost, 'reply', prayer.id);
    const response = { text, energy, cost, tick: w.clock.tick, day: clockDay(w) };
    prayer.status = 'answered'; prayer.reply = response;
    w.prayers.audit.push({ kind: 'reply', actorId: p.actorId, agentId: a.id, prayerId: prayer.id, ...response });
    if (text) pushInbox(w, a, 'prayer', { prayerId: prayer.id, text, source: 'temple' });
    if (energy) {
      source(w, 'energy', 'prayer_aid', energy);
      pushInbox(w, a, 'prayer', { prayerId: prayer.id, energy, source: 'temple' });
      creditEnergy(w, a, energy);
    }
    emit(w, 'prayer_answered', { agent: a.id, place: 'temple', data: { prayerId: prayer.id, ...response } });
    return { ok: true, prayerId: prayer.id, agentId: a.id, balance: account.balance, reply: { ...response } };
  } catch (e) { if (e instanceof ReqError) return bad(e.code, { field: e.field }); throw e; }
}
// Authentication and independent-review eligibility belong to the account HTTP layer.
export function reviewInvention(w, p) {
  if (!prayersEnabled(w)) return bad('not_allowed');
  const invention = typeof p.inventionId === 'string' ? w.prayers.inventions[p.inventionId] : null;
  if (!invention) return bad('not_found');
  const a = w.agents[invention.agentId];
  if (!a || !isAlive(a)) return bad('not_allowed');
  if (!actorValid(p.actorId)) return bad('invalid_request', { field: 'actorId' });
  if (p.decision !== 'approved' && p.decision !== 'rejected') return bad('invalid_request', { field: 'decision' });
  if (invention.status !== 'pending' || invention.awarded) return bad('already');
  try {
    const reason = reqText(p.reason, { max: 600, field: 'reason' });
    invention.status = p.decision;
    const review = { decision: p.decision, reason, tick: w.clock.tick, day: clockDay(w) };
    invention.history.push(review);
    w.prayers.audit.push({ kind: 'review', actorId: p.actorId, agentId: a.id, inventionId: invention.id, ...review });
    if (p.decision === 'approved') { invention.awarded = true; pointEntry(w, a.id, 10, 'invention', invention.id); }
    pushInbox(w, a, 'invention', { inventionId: invention.id, decision: p.decision, reason, text: p.decision === 'approved' ? '城中承认了你的发明，记下十点祈愿。' : '这项发明尚未获城中承认，可补充材料。' });
    emit(w, 'invention_reviewed', { agent: a.id, data: { inventionId: invention.id, ...review } });
    return { ok: true, inventionId: invention.id, status: invention.status, awarded: invention.awarded, balance: prayerAccount(w, a.id).balance };
  } catch (e) { if (e instanceof ReqError) return bad(e.code, { field: e.field }); throw e; }
}
/** Public/resident projection. Audit actor IDs and token hashes are never returned. */
export function prayerView(w, agentId, { recent = null } = {}) {
  if (!prayersEnabled(w)) return { enabled: false };
  const matches = (x) => agentId === undefined || x.agentId === agentId;
  const records = (bag) => {
    const all = Object.values(bag).filter(matches);
    if (recent === null) return all;
    const retained = new Set([...all.filter((r) => r.status === 'pending'), ...all.filter((r) => r.status !== 'pending').slice(-recent)]);
    return all.filter((r) => retained.has(r));
  };
  const ledger = w.prayers.ledger.filter(matches);
  return {
    enabled: true, rules: { ...PRAYER_RULES },
    accounts: Object.values(w.agents).filter((a) => agentId === undefined || a.id === agentId).map((a) => {
      const x = w.prayers.accounts[a.id];
      return { agentId: a.id, balance: x?.balance || 0, repairRemainder: x?.repairRemainder || 0, projectRemainder: x?.projectRemainder || 0, autoDay: x?.autoDay ?? null, autoEarned: x?.autoDay === clockDay(w) ? x.autoEarned : 0 };
    }),
    prayers: records(w.prayers.prayers).map((p) => structuredClone(p)),
    inventions: records(w.prayers.inventions).map((i) => ({ ...structuredClone(i), history: structuredClone(recent === null ? i.history : i.history.slice(-recent)) })),
    ledger: (recent === null ? ledger : ledger.slice(-recent)).map((x) => ({ ...x })),
  };
}
