// Deterministic, resident-owned reward accounting. All hooks are inert before activation.
import { clockDay, isAlive } from '../world.js';
import { emit } from './core.js';

export const PRAYER_RULES = Object.freeze({ repairBpPerPoint: 100, projectEnergyPerPoint: 10, rescuePoints: 1, inventionPoints: 10, automaticDailyCap: 10, textReplyCost: 1, energyPerPoint: 1, prayerTextLimit: 600, prayerEnergyCost: 1, prayersPerDay: 1 });
export const prayersEnabled = (w) => w.premise === 2 && w.prayers?.enabled === true;
export function prayerAccount(w, agentId) {
  return w.prayers.accounts[agentId] ||= { balance: 0, repairRemainder: 0, projectRemainder: 0, autoDay: clockDay(w), autoEarned: 0, lastPrayerDay: null };
}
export function pointEntry(w, agentId, amount, kind, sourceId = null) {
  const account = prayerAccount(w, agentId);
  account.balance += amount;
  const entry = { id: `pl${++w.prayers.counters.ledger}`, agentId, day: clockDay(w), tick: w.clock.tick, kind, amount, balance: account.balance, sourceId };
  w.prayers.ledger.push(entry);
  emit(w, 'prayer_points', { agent: agentId, data: { ...entry } });
  return entry;
}
function automatic(w, a, units, kind, divisor, sourceId) {
  if (!prayersEnabled(w) || !isAlive(a)) return 0;
  const account = prayerAccount(w, a.id);
  if (account.autoDay !== clockDay(w)) { account.autoDay = clockDay(w); account.autoEarned = 0; }
  const field = kind === 'repair' ? 'repairRemainder' : kind === 'project' ? 'projectRemainder' : null;
  const total = units + (field ? account[field] : 0);
  const whole = Math.floor(total / divisor);
  if (field) account[field] = total % divisor;
  const amount = Math.min(whole, Math.max(0, PRAYER_RULES.automaticDailyCap - account.autoEarned));
  account.autoEarned += amount;
  if (amount) pointEntry(w, a.id, amount, kind, sourceId);
  return amount;
}
export function recordNaturalDamage(w, target, amount) {
  if (!prayersEnabled(w) || amount <= 0) return;
  w.prayers.naturalDamage[target] = (w.prayers.naturalDamage[target] || 0) + amount;
}
// Called on every repair, including repairs paid by rules and private facilities.
export function consumeNaturalRepair(w, target, amount) {
  if (!prayersEnabled(w)) return 0;
  const eligible = Math.min(amount, w.prayers.naturalDamage[target] || 0);
  w.prayers.naturalDamage[target] = (w.prayers.naturalDamage[target] || 0) - eligible;
  return eligible;
}
export function rewardRepair(w, a, obj, target, eligible) {
  if (!prayersEnabled(w) || (obj.owner && obj.owner.kind !== 'city')) return 0;
  return automatic(w, a, eligible, 'repair', 100, target);
}
export function recordRazed(w, target) {
  if (!prayersEnabled(w)) return;
  w.prayers.razedSites[target] = true;
  w.prayers.naturalDamage[target] = 0;
}
export function recordDismantledModule(w, place, type) {
  if (prayersEnabled(w)) w.prayers.destroyedModules[`${place}:${type}`] = true;
}
export function rewardProject(w, j) {
  if (!prayersEnabled(w) || w.prayers.completedProjects[j.id]) return;
  w.prayers.completedProjects[j.id] = true;
  if (j.owner?.kind !== 'city' || (j.on && w.prayers.razedSites[j.on]) || (j.build === 'module' && (w.prayers.razedSites[j.place] || w.places[j.place]?.owner?.kind !== 'city' || w.prayers.destroyedModules[`${j.place}:${j.module}`]))) return;
  const baseline = w.prayers.projectBaseline[j.id] || {};
  for (const [id, contribution] of Object.entries(j.contributors)) {
    const a = w.agents[id];
    if (a && isAlive(a)) automatic(w, a, Math.max(0, contribution - (baseline[id] || 0)), 'project', 10, j.id);
  }
}
export function rewardRescue(w, giver, recipient, wasDormant) {
  if (!prayersEnabled(w) || !wasDormant || recipient.status !== 'awake') return;
  const day = clockDay(w);
  if (w.prayers.rescuedDay[recipient.id] === day) return;
  w.prayers.rescuedDay[recipient.id] = day;
  // First rescue of the recipient already implies at most one award to each pair/day.
  automatic(w, giver, 1, 'rescue', 1, recipient.id);
}
export function closeResidentPrayers(w, a) {
  if (!prayersEnabled(w)) return;
  const account = prayerAccount(w, a.id);
  if (account.balance) pointEntry(w, a.id, -account.balance, 'exit');
  account.repairRemainder = 0; account.projectRemainder = 0;
  for (const p of Object.values(w.prayers.prayers)) {
    if (p.agentId === a.id && p.status === 'pending') {
      p.status = 'closed'; p.closedDay = clockDay(w); p.closedTick = w.clock.tick;
      emit(w, 'prayer_closed', { agent: a.id, place: 'temple', data: { prayerId: p.id, reason: a.status } });
    }
  }
}
