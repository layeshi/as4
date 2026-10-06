import { newBudget } from '../rules/eval.js';
import { certifyRule, certifyRules, expressionCost, normalizeCapacity } from '../rules/plan.js';
import { parseCached } from '../rules/parser.js';
import { LIMITS, P } from '../params.js';

export const usesLawVM2 = w => w.physics === 2 && w.premise >= 2 && w.ruleExecution?.version === 2;
export class CapacityError extends Error {
  constructor(detail) { super('law execution capacity'); this.detail = detail; }
}

export function ruleSets(w) {
  const sets = Object.values(w.laws).filter(l => l.status === 'active').map(l => ({ path: l.id, rules: l.rules, procedure: l.procedure }));
  for (const g of Object.values(w.groups)) if (!g.dissolved && g.bylaws) sets.push({ path: g.id, rules: g.bylaws.rules });
  for (const p of Object.values(w.places)) if (p.rules) sets.push({ path: p.id, rules: p.rules.rules });
  for (const p of Object.values(w.proposals)) if (p.status === 'open') {
    sets.push({ path: p.id, rules: p.rules || [], procedure: p.procedure });
    if (p.spec) sets.push({ path: `${p.id}.ballot`, rules: [], procedure: { ballot: p.spec } });
  }
  for (const r of Object.values(w.refounds)) if (r.status === 'open' && r.procedure && r.procedure !== 'humans') sets.push({ path: r.id, rules: [], procedure: r.procedure });
  for (const g of Object.values(w.groups)) for (const p of Object.values(g.proposals || {})) if (p.status === 'open') sets.push({ path: `${g.id}:${p.id}`, rules: p.rules || [] });
  return sets;
}

export function certifyProcedure(procedure, capacity) {
  const issues = [], certificates = [];
  if (!procedure || procedure === 'humans') return { ok: true, issues, certificates };
  for (const [cls, spec] of Object.entries(procedure)) {
    if (spec.none) continue;
    for (const key of ['proposers', 'voters', 'weight', 'decide']) if (typeof spec[key] === 'string') {
      try {
        const fuel = expressionCost(parseCached(spec[key]), capacity);
        const certificate = { path: `procedure.${cls}.${key}`, fuel, multiplier: key === 'weight' ? capacity.maxAgents : key === 'proposers' ? capacity.maxActionsPerTick * capacity.maxAgents : 1, ok: fuel <= capacity.maxRuleFuel, code: fuel <= capacity.maxRuleFuel ? null : 'cost_limit' };
        certificates.push(certificate); if (!certificate.ok) issues.push(certificate);
      } catch { issues.push({ path: `procedure.${cls}.${key}`, code: 'cost_unproven' }); }
    }
  }
  return { ok: issues.length === 0, issues, certificates };
}

export function lawDiagnostics(w, rules = [], procedure = null, capacity = w.ruleExecution?.capacity) {
  if (!capacity) return null;
  const r = certifyRules(rules, capacity), p = certifyProcedure(procedure, capacity);
  return { ok: r.ok && p.ok, version: 2, capacity, certificates: [...r.certificates, ...p.certificates], issues: [...r.issues, ...p.issues] };
}

export function capacityCheck(w, capacity = w.ruleExecution?.capacity, additional = [], replacePath = null) {
  const count = value => Object.keys(value || {}).length;
  const required = { maxAgents: count(w.agents), maxSouls: count(w.souls), maxGroups: count(w.groups), maxPlaces: count(w.places), maxRoads: count(w.roads), maxProjects: count(w.projects), maxOffers: count(w.offers), maxPacts: count(w.pacts), maxBodies: count(w.shells?.bodies), maxWeather: (w.weather?.scheduled ? 1 : 0) + count(w.weather?.active), maxActionsPerTick: P.maxActionsPerTick, maxRules: 0, maxWorldBytes: Buffer.byteLength(JSON.stringify(w), 'utf8') };
  const issues = [];
  let reserved = 0, reservedIntents = 0;
  for (const set of [...ruleSets(w).filter(s => s.path !== replacePath), ...additional]) {
    required.maxRules += (set.rules || []).length;
    const d = lawDiagnostics(w, set.rules || [], set.procedure, capacity);
    for (let i = 0; i < d.certificates.length; i++) {
      const cert = d.certificates[i], when = (set.rules || [])[i]?.when;
      const multiplier = cert.multiplier ? cert.multiplier * LIMITS.openProposalsCity
        : /^before:|^after:/.test(when || '') ? capacity.maxActionsPerTick * capacity.maxAgents
        : /^on:/.test(when || '') ? capacity.maxActionsPerTick * capacity.maxAgents + capacity.maxSouls + capacity.maxRules + capacity.maxPlaces + capacity.maxRoads + capacity.maxProjects + capacity.maxOffers + capacity.maxPacts + capacity.maxWeather + capacity.maxBodies
        : when === 'enact' ? capacity.maxRules : 1;
      reserved += (cert.fuel || 0) * multiplier;
      reservedIntents += (cert.intents || 0) * multiplier;
    }
    issues.push(...d.issues.map(i => ({ ...i, path: `${set.path}.${i.path}` })));
  }
  for (const [key, n] of Object.entries(required)) if (!Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(capacity[key]) || n > capacity[key]) issues.push({ path: key, code: 'capacity', required: Number.isSafeInteger(n) ? n : null, limit: capacity[key] });
  if (reserved > capacity.maxCommandFuel) issues.push({ path: 'rules', code: 'capacity', required: reserved, limit: capacity.maxCommandFuel });
  if (reservedIntents > capacity.maxCommandIntents) issues.push({ path: 'intents', code: 'capacity', required: reservedIntents, limit: capacity.maxCommandIntents });
  return { ok: issues.length === 0, required, reserved, reservedIntents, issues };
}

export function migrateLawExecution(w, args) {
  if (w.physics !== 2 || !(w.premise >= 2) || args.version !== 2) return { ok: false, error: { code: 'invalid_request', field: 'version' } };
  if (w.ruleExecution && w.ruleExecution.version !== 2) return { ok: false, error: { code: 'invalid_request', field: 'version' } };
  let capacity;
  try {
    if (args.capacity !== undefined && (!args.capacity || typeof args.capacity !== 'object' || Array.isArray(args.capacity))) throw new Error('invalid capacity');
    capacity = normalizeCapacity({ ...(w.ruleExecution?.capacity || {}), ...(args.capacity || {}) });
  }
  catch { return { ok: false, error: { code: 'invalid_request', field: 'capacity' } }; }
  const next = { version: 2, capacity, activatedCommand: w.commandN, protection: null };
  const check = capacityCheck({ ...w, ruleExecution: next }, capacity);
  if (!check.ok) return { ok: false, error: { code: 'rule_invalid', issues: check.issues } };
  const protection = w.ruleExecution?.protection || null;
  if (protection?.required) for (const [k, n] of Object.entries(protection.required)) if (capacity[k] !== undefined && n > capacity[k]) return { ok: false, error: { code: 'invalid_request', field: k } };
  w.ruleExecution = next;
  return { ok: true, version: 2, capacity };
}

export function commandMeter(w) {
  Object.defineProperty(w, '$lawMeter', { value: { steps: 0, intents: 0 }, configurable: true, writable: true });
}

export function meterIntents(w, intents) {
  if (!w.$lawMeter) return;
  w.$lawMeter.intents += intents.length;
  if (w.$lawMeter.intents > w.ruleExecution.capacity.maxCommandIntents) throw new CapacityError({ code: 'capacity', path: 'commandIntents', required: { maxCommandIntents: w.$lawMeter.intents } });
}

function optimizedBudget(w, fuel) {
  const budget = newBudget(fuel);
  budget.memo = new Map();
  if (w.$lawMeter) budget.onSteps = n => {
    w.$lawMeter.steps += n;
    if (w.$lawMeter.steps > w.ruleExecution.capacity.maxCommandFuel) throw new CapacityError({ code: 'capacity', path: 'commandFuel', required: { maxCommandFuel: w.$lawMeter.steps } });
  };
  return budget;
}

export function budgetForRule(w, rule) {
  if (!usesLawVM2(w)) return newBudget();
  const cert = certifyRule(rule, w.ruleExecution.capacity);
  if (!cert.ok) throw new CapacityError({ code: 'capacity', path: cert.path, certificate: cert });
  return optimizedBudget(w, Math.max(1, cert.fuel));
}

export function budgetForExpression(w, tree) {
  if (!usesLawVM2(w)) return newBudget();
  let fuel;
  try { fuel = expressionCost(tree, w.ruleExecution.capacity); } catch { throw new CapacityError({ code: 'capacity', path: 'procedure', reason: 'cost_unproven' }); }
  if (fuel > w.ruleExecution.capacity.maxRuleFuel) throw new CapacityError({ code: 'capacity', path: 'procedure', required: { maxRuleFuel: fuel } });
  return optimizedBudget(w, Math.max(1, fuel));
}
