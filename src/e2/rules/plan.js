// Versioned resource proofs. No world mutation or wall-clock inputs.
import { parseCached } from './parser.js';
import { parseTemplate } from './check.js';
import { createHash } from 'node:crypto';

const analyses = new WeakMap();
export function expressionDependencies(n) {
  if (analyses.has(n)) return analyses.get(n);
  let pure = true, freeIt = false;
  if (n.t === 'name') freeIt = n.n === 'it';
  const add = (child, binds = false) => {
    const d = expressionDependencies(child);
    pure &&= d.pure;
    freeIt ||= !binds && d.freeIt;
  };
  if (n.t === 'field') add(n.o);
  if (n.t === 'un') add(n.a);
  if (n.t === 'bin') { add(n.a); add(n.b); }
  if (n.t === 'call') {
    pure = n.f !== 'sample';
    n.a.forEach((a, i) => add(a, i === 1 && ['filter', 'sum', 'top'].includes(n.f)));
  }
  const d = { pure, freeIt };
  analyses.set(n, d);
  return d;
}

export const DEFAULT_CAPACITY = Object.freeze({ maxAgents: 512, maxSouls: 512, maxGroups: 512, maxPlaces: 512, maxRoads: 512, maxProjects: 512, maxOffers: 1024, maxPacts: 512, maxBodies: 512, maxWeather: 512, maxActionsPerTick: 4, maxRules: 1024, maxRuleFuel: 200000, maxCommandFuel: 2000000, maxIntents: 8192, maxCommandIntents: 32768, maxWorldBytes: 67108864 });
const CEILINGS = { maxAgents: 2048, maxSouls: 2048, maxGroups: 2048, maxPlaces: 2048, maxRoads: 4096, maxProjects: 2048, maxOffers: 4096, maxPacts: 2048, maxBodies: 2048, maxWeather: 4096, maxActionsPerTick: 64, maxRules: 4096, maxRuleFuel: 2000000, maxCommandFuel: 20000000, maxIntents: 65536, maxCommandIntents: 262144, maxWorldBytes: 134217728 };
export function normalizeCapacity(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid capacity');
  const out = { ...DEFAULT_CAPACITY };
  for (const [k, v] of Object.entries(value)) {
    if (!Object.hasOwn(out, k) || !Number.isSafeInteger(v) || v < 1 || v > CEILINGS[k]) throw new Error('invalid capacity');
    out[k] = v;
  }
  if (out.maxCommandFuel < out.maxRuleFuel) throw new Error('command budget below rule budget');
  return out;
}

const children = n => n.t === 'field' ? [n.o] : n.t === 'un' ? [n.a] : n.t === 'bin' ? [n.a, n.b] : n.t === 'call' ? n.a : [];
const builtin = new Set(['min', 'max', 'abs', 'if', 'default', 'count', 'sum', 'filter', 'top', 'sample', 'contains', 'tagged', 'members', 'at', 'has_tag', 'in_group', 'awake', 'is_wild', 'owner', 'agent', 'group', 'soul', 'names', 'weather']);
const scalarNames = new Set(['city', 'var', 'treasury', 'actor', 'args', 'result', 'here', 'event', 'it', 'yes', 'no', 'abstain', 'voted', 'total', 'turnout']);
const clamp = n => Math.min(Number.MAX_SAFE_INTEGER, n);
const plus = (a, b) => clamp(a + b);
const times = (a, b) => clamp(a * b);
export function sortWork(length) {
  let power = 1, levels = 0;
  while (power <= length) { power *= 2; levels++; }
  return length * levels;
}

function listBound(n, c) {
  if (n.t === 'name' && n.n === 'agents') return c.maxAgents;
  if (n.t === 'name' && n.n === 'cradle') return c.maxSouls;
  if (n.t === 'call' && ['tagged', 'members', 'at'].includes(n.f)) return c.maxAgents;
  if (n.t === 'call' && ['filter', 'top', 'sample'].includes(n.f)) return listBound(n.a[0], c);
  if (n.t === 'call' && n.f === 'if') return Math.max(listBound(n.a[1], c), listBound(n.a[2], c));
  if (n.t === 'call' && n.f === 'default') return Math.max(listBound(n.a[0], c), listBound(n.a[1], c));
  // Known event/args collection fields are bounded by the world capacity.
  if (n.t === 'field' && n.o.t === 'name' && ['event', 'args'].includes(n.o.n)) return c.maxAgents + c.maxSouls + c.maxGroups + c.maxPlaces + c.maxRules;
  throw new Error('list_bound_unknown');
}

export function expressionCost(n, capacity = DEFAULT_CAPACITY, repeat = false) {
  const d = expressionDependencies(n);
  if (repeat && d.pure && !d.freeIt) return 1;
  if (!['int', 'str', 'bool', 'null', 'name', 'field', 'un', 'bin', 'call'].includes(n.t)) throw new Error('node_unknown');
  if (n.t === 'name' && !['agents', 'cradle'].includes(n.n) && !scalarNames.has(n.n)) throw new Error('name_unknown');
  if (n.t !== 'call') return children(n).reduce((s, x) => plus(s, expressionCost(x, capacity, repeat)), 1);
  if (!builtin.has(n.f)) throw new Error('function_unknown');
  if (['filter', 'sum', 'top'].includes(n.f)) {
    const len = listBound(n.a[0], capacity);
    // Bound the first evaluation and all repeated bindings conservatively.
    const traversal = len ? plus(expressionCost(n.a[1], capacity, repeat), times(len - 1, expressionCost(n.a[1], capacity, true))) : 0;
    let cost = plus(1, plus(expressionCost(n.a[0], capacity, repeat), plus(len, traversal)));
    if (n.f === 'top') cost = plus(cost, plus(expressionCost(n.a[2], capacity, repeat), sortWork(len)));
    return cost;
  }
  let cost = n.a.reduce((s, x) => plus(s, expressionCost(x, capacity, repeat)), 1);
  if (['count', 'contains', 'names', 'sample'].includes(n.f)) cost = plus(cost, listBound(n.a[0], capacity));
  if (n.f === 'sample') cost = plus(cost, sortWork(listBound(n.a[0], capacity)));
  return cost;
}

const expressionFields = {
  transfer: ['from', 'to', 'energy', 'coins'], share: ['from', 'among', 'energy', 'coins'], fee: ['to', 'energy', 'coins'],
  set: ['value'], tag: ['who'], untag: ['who'], exile: ['who'], pardon: ['who'], mint: ['coins', 'to'], fund: ['energy'], cede: ['to'],
};
const literalOps = new Set(['deny', 'rename', 'protect', 'unprotect', 'amend', 'repeal', 'seize', 'petition']);
function opCost(op, c, repeat = false) {
  if (op.op === 'each') {
    const tree = parseCached(op.in), len = listBound(tree, c);
    const body = repeated => op.do.reduce((sum, x) => plus(sum, opCost(x, c, repeated).fuel), op.if === undefined ? 0 : expressionCost(parseCached(op.if), c, repeated));
    const fuel = plus(5, plus(expressionCost(tree, c, repeat), plus(len, len ? plus(body(repeat), times(len - 1, body(true))) : 0)));
    return { fuel, intents: times(len, op.do.length) };
  }
  let fuel = 5;
  if (op.op === 'announce') {
    for (const part of parseTemplate(op.text)) if (part.expr !== undefined) fuel = plus(fuel, expressionCost(parseCached(part.expr.trim()), c, repeat));
  } else if (expressionFields[op.op]) {
    for (const key of expressionFields[op.op]) if (op[key] !== undefined) fuel = plus(fuel, expressionCost(parseCached(op[key]), c, repeat));
  } else if (!literalOps.has(op.op)) throw new Error('operation_unknown');
  return { fuel, intents: 1 };
}

export function certifyRule(rule, capacity = DEFAULT_CAPACITY, path = 'rule') {
  try {
    let fuel = rule.if === undefined ? 0 : expressionCost(parseCached(rule.if), capacity), intents = 0;
    for (const op of rule.do) { const cost = opCost(op, capacity); fuel = plus(fuel, cost.fuel); intents = plus(intents, cost.intents); }
    const bottlenecks = [];
    const describe = (ops, prefix) => ops.forEach((op, i) => {
      const current = `${prefix}[${i}]`;
      if (op.op === 'each') {
        bottlenecks.push({ path: `${current}.in`, firstEvaluationFuel: expressionCost(parseCached(op.in), capacity), supportedIterations: listBound(parseCached(op.in), capacity) });
        describe(op.do, `${current}.do`);
      } else for (const key of expressionFields[op.op] || []) if (op[key] !== undefined) bottlenecks.push({ path: `${current}.${key}`, firstEvaluationFuel: expressionCost(parseCached(op[key]), capacity), repeatedEvaluationFuel: expressionCost(parseCached(op[key]), capacity, true) });
    });
    describe(rule.do, `${path}.do`);
    const ok = fuel <= capacity.maxRuleFuel && intents <= capacity.maxIntents;
    return { version: 2, ruleHash: createHash('sha256').update(JSON.stringify(rule)).digest('hex'), ok, path, fuel, intents, limit: capacity.maxRuleFuel, bottlenecks, code: ok ? null : 'cost_limit' };
  } catch (e) { return { version: 2, ok: false, path, code: 'cost_unproven', reason: ['list_bound_unknown', 'node_unknown', 'name_unknown', 'function_unknown', 'operation_unknown'].includes(e.message) ? e.message : 'invalid_expression' }; }
}

export function certifyRules(rules, capacity = DEFAULT_CAPACITY, path = 'rules') {
  const certificates = rules.map((r, i) => certifyRule(r, capacity, `${path}[${i}]`));
  return { ok: certificates.every(c => c.ok), certificates, issues: certificates.filter(c => !c.ok) };
}
