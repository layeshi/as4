import { prayersEnabled } from './prayer-rewards.js';
import { usesLawSemantics2 } from './law-semantics.js';
// SPEC-E2 §7.5–§7.7：规则的执行——时机的接入、调用（收集 → 施行）、操作的施行。
//
// 规则住在三个地方（作用域）：城法（w.laws[*].rules）、社群章程（group.bylaws）、地点规则（place.rules）。
// 引擎的物理模块通过 hooks.js 的三个钩子调用这里（本文件加载时 installHooks）：
//   before(w, a, type, args, plan)   动作成功之前：收集会拒绝或收费的规则
//   after(w, a, type, args, data, plan, startPlace)   动作成功之后：收集并施行 after 规则
//   fire(w, type, data)              物理事件发生时：on:<事件> 规则
// 另有 enact（法律生效 / 章程或地点规则被设定）与 daily / monthly（每日结算第 3 步）。
//
// 一次调用（§7.5）：求条件 → 收集（只读，求出每个操作所有字段的值，得到意图）→ 任何一步出错则丢弃全部意图、记 rule_error
//   → 施行（§7.7）：按顺序施行每个意图，每个意图记一条 rule_op。历史 before 出错放行；法律语义 2 拒绝本动作。
// 不级联（§7.6）：规则施行期间 w.$ruling 为真，fire 什么都不做；施行引起的事件照常产生，只是不触发任何规则。

import { P } from '../params.js';
import { clockDay, isAlive, findAgent } from '../world.js';
import { ACTIONS, EVENT_FIELDS, actionTable } from '../lore/actions.js';
import { parseWhen, OP_FIELDS } from '../rules/check.js';
import { collectRule } from '../rules/ops.js';
import { parseCached } from '../rules/parser.js';
import { newBudget, agentRef } from '../rules/eval.js';
import { RuleError } from '../rules/errors.js';
import { budgetForRule, usesLawVM2, CapacityError, meterIntents } from './law-execution.js';
import { screen } from '../../moderation.js';
import { emit, pushInbox } from './core.js';
import { source, sink } from './ledger.js';
import { installHooks } from './hooks.js';
import { makeHost } from './rulehost.js';
import { balanceOf, credit, debit, notifyTransfer, acctRef, accountProblem } from './accounts.js';
import { actionCost } from './actions/util.js';
import { isWeatherActive } from './environment.js';
import { hasRelay, placeNameTaken } from './places.js';
import { hasGate } from './movement.js';
import { repealLaw, isSuspended } from './laws.js';
import { addToProject } from './projects.js';
import { STEPS } from './tick.js';

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const idNum = (id) => Number(String(id).slice(1)) || 0;

// ═══════════════════════════════════════════════════════════════
// 规则集：城法、社群章程、地点规则
// ═══════════════════════════════════════════════════════════════

/** 一个「规则集」描述一组规则住在哪里：scope（作用域）、owner（所属）、key（收件与费用里的 law 字段） */
const citySet = (law) => ({ kind: 'city', owner: law.id, key: law.id, scopeStr: 'city', rules: law.rules, holder: law, law });
const groupSet = (g) => ({ kind: 'group', owner: g.id, key: `group:${g.id}`, scopeStr: `group:${g.id}`, rules: g.bylaws.rules, holder: g.bylaws, group: g });
const placeSet = (p) => ({ kind: 'place', owner: p.id, key: `place:${p.id}`, scopeStr: `place:${p.id}`, rules: p.rules.rules, holder: p.rules, place: p, placeOwner: { ...p.owner } });

/** Prefetched sets must still belong to the current live holder before each rule. */
function currentRule(w, set, idx, rule) {
  if (!usesLawSemantics2(w)) return true;
  if (isSuspended(w, set.holder) || set.holder.rules !== set.rules || set.rules[idx] !== rule) return false;
  if (set.kind === 'city') return w.laws[set.owner] === set.holder && set.holder.status === 'active';
  if (set.kind === 'group') return w.groups[set.owner] === set.group && !set.group.dissolved && set.group.bylaws === set.holder;
  const p = w.places[set.owner];
  return p === set.place && p.rules === set.holder && p.owner.kind !== 'city' && p.owner.kind === set.placeOwner.kind && p.owner.id === set.placeOwner.id
    && !accountProblem(w, { k: p.owner.kind, id: p.owner.id });
}

/** 在效的、带规则的城法（程序法律没有规则），按 ID 升序 */
export function cityRuleSets(w, { includeSuspended = false } = {}) {
  const out = [];
  for (const law of Object.values(w.laws)) {
    if (law.status !== 'active' || law.procedure || law.rules.length === 0) continue;
    if (!includeSuspended && isSuspended(w, law)) continue;
    out.push(citySet(law));
  }
  return out;
}

/** 居民所在的社群的章程（有章程且未停摆的），按社群 ID 升序 */
export function groupRuleSetsOf(w, a, { includeSuspended = false } = {}) {
  const out = [];
  for (const gid of a.groups.slice().sort((x, y) => idNum(x) - idNum(y))) {
    const g = w.groups[gid];
    if (!g || g.dissolved || !g.bylaws || g.bylaws.rules.length === 0) continue;
    if (!includeSuspended && isSuspended(w, g.bylaws)) continue;
    out.push(groupSet(g));
  }
  return out;
}

/** 某个地点的地点规则（有规则且未停摆）；没有返回 null */
export function placeRuleSetAt(w, placeId, { includeSuspended = false } = {}) {
  const p = has(w.places, placeId) ? w.places[placeId] : null;
  if (!p || !p.rules || p.rules.rules.length === 0 || p.owner.kind === 'city') return null;
  if (!includeSuspended && isSuspended(w, p.rules)) return null;
  return placeSet(p);
}

export { citySet, groupSet, placeSet };

// ═══════════════════════════════════════════════════════════════
// 时机
// ═══════════════════════════════════════════════════════════════

const TIMING = new WeakMap(); // rule 对象 → 解析后的时机（不进快照）

/** 规则的时机：{ kind: 'enact'|'daily'|'monthly'|'before'|'after'|'on', action?, event? } */
function timingOf(rule) {
  let t = TIMING.get(rule);
  if (!t) {
    // 存下来的规则在存入时已按它所在世界的设定版本校验过；这里用最全的动作表（设定 2）解析，设定 0、1 里存下的规则解析的结果不变，
    // 第二前提里的 before:standing、after:standing 才解析得出来（SPEC-P2 §5.3）
    t = parseWhen(rule.when, { kind: 'city', premise: 2, prayers: true });
    if (t.error) t = parseWhen(rule.when, { kind: 'place', premise: 2, prayers: true }); // before:enter 只有地点规则才有
    if (t.error) throw new Error(`stored rule has an invalid timing: ${rule.when}`);
    TIMING.set(rule, t);
  }
  return t;
}

// ═══════════════════════════════════════════════════════════════
// 「正在施行规则」的标志（不级联）
// ═══════════════════════════════════════════════════════════════

function setRuling(w, v) {
  if (!has(w, '$ruling')) Object.defineProperty(w, '$ruling', { value: v, writable: true, enumerable: false, configurable: true });
  else w.$ruling = v;
}
export const isRuling = (w) => has(w, '$ruling') && w.$ruling === true;

export function withRuling(w, fn) {
  const prev = isRuling(w);
  setRuling(w, true);
  try {
    return fn();
  } finally {
    setRuling(w, prev);
  }
}

// ═══════════════════════════════════════════════════════════════
// 名字的环境：args、result、here、event
// ═══════════════════════════════════════════════════════════════

const NAME_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;
// 规则读不到的参数（守护律「内心不可侵」：灵魂全文、记忆）
const HIDDEN_ARGS = { conceive: ['soul', 'memories'], consent: ['memories'], will: ['successor'] };
// 参数里「居民」一类的引用：既可以写 ID 也可以写名字，规则里统一读成 ID
const AGENT_ARGS = new Set(['to', 'agent', 'deceased']);
// after 规则里 result.<字段> 没有时读成 0 的数字字段（其余没有的读成 null）
const RESULT_INTS = {
  repair: ['spent', 'from', 'to'],
  draw: ['energy', 'wellCondition', 'drawPoolLeft'],
  explore: ['energy', 'coins'],
  dismantle: ['energy', 'salvageLeft'],
  give: ['energy', 'coins'],
  disburse: ['energy', 'coins'],
  contribute: ['spent'],
  sponsor: ['fund', 'cost'],
};

/** 把动作返回的 data（或参数里的对象）化成规则能读的记录：标量，嵌套的对象至多一层 */
export function plainRecord(v, depth = 0, hidden = []) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (hidden.includes(k) || !NAME_RE.test(k)) continue;
    if (x === null || typeof x === 'boolean') out[k] = x;
    else if (typeof x === 'number') {
      if (Number.isSafeInteger(x)) out[k] = x;
    } else if (typeof x === 'string') out[k] = x;
    else if (depth < 1 && typeof x === 'object' && !Array.isArray(x)) {
      const r = plainRecord(x, depth + 1, hidden);
      if (r) out[k] = r;
    }
  }
  return out;
}

/** args.<参数>：没给的数字参数为 0，其余为 null；居民的引用统一成 ID */
export function argsRecord(w, type, raw) {
  const spec = actionTable(w.premise || 0, prayersEnabled(w)).ACTIONS[type];
  const hidden = HIDDEN_ARGS[type] || [];
  const out = {};
  for (const [name, kind] of spec.args) {
    const v = raw ? raw[name] : undefined;
    // standing：orders 是列表，规则读到 null；count 是指令的条数（SPEC-P2 §5.3）
    if (type === 'standing' && name === 'count') out.count = Array.isArray(raw && raw.orders) ? raw.orders.length : 0;
    else if (hidden.includes(name)) out[name] = kind === 'int' ? 0 : null;
    else if (kind === 'int') out[name] = Number.isSafeInteger(v) ? v : 0;
    else if (kind === 'bool') out[name] = typeof v === 'boolean' ? v : null;
    else if (kind === 'str') {
      if (typeof v !== 'string') out[name] = null;
      else if (AGENT_ARGS.has(name) && !(name === 'to' && (type === 'move' || type === 'announce'))) {
        const t = findAgent(w, v);
        out[name] = t ? t.id : v;
      } else out[name] = v;
    } else if (kind === 'obj') out[name] = plainRecord(v, 0, hidden);
    else out[name] = null; // 列表（rules 等）规则读不到
  }
  return out;
}

/** result.<字段>：动作返回的 data；没有的数字字段为 0 */
export function resultRecord(type, data) {
  const out = plainRecord(data || {}) || {};
  for (const k of RESULT_INTS[type] || []) if (typeof out[k] !== 'number') out[k] = 0;
  return out;
}

/** event.<字段>：按事件的种类给出相应的字段（PROTOCOL-2 §6.5） */
export function eventRecord(type, data) {
  const out = {};
  for (const f of EVENT_FIELDS[type] || []) {
    if (f === 'agent') out.agent = data.agent ? agentRef(data.agent) : null;
    else out[f] = data[f] === undefined ? null : data[f];
  }
  return out;
}

/** 执行者所在之处的、在世居民列表（含执行者） */
export function hereOf(w, placeId) {
  const out = [];
  for (const o of Object.values(w.agents)) if (isAlive(o) && o.place === placeId) out.push(agentRef(o.id));
  return out;
}

/** before / after 的名字环境；here 在第一次用到时才计算 */
function actionEnv(w, a, type, args, result) {
  const env = { actor: agentRef(a.id), args: argsRecord(w, type, args) };
  if (result !== undefined) env.result = resultRecord(type, result);
  let here = null;
  Object.defineProperty(env, 'here', { enumerable: true, configurable: true, get: () => (here === null ? (here = hereOf(w, a.place)) : here) });
  return env;
}

// ═══════════════════════════════════════════════════════════════
// 一次调用：收集
// ═══════════════════════════════════════════════════════════════

/** 规则里 var 读到的变量：城法读 w.vars；社群章程读该社群自己的；地点规则读城的（只读） */
const varsFor = (w, set) => (set.kind === 'group' ? set.group.vars : w.vars);

function reportError(w, set, idx, e, run) {
  if (run.quiet) throw new Error(`rule error during genesis (${set.key}#${idx}): ${e.message}`);
  w.dayLog.ruleErrors++;
  emit(w, 'rule_error', { data: { scope: set.scopeStr, owner: set.owner, rule: idx, code: e.code, detail: e.detail || '' } });
}

function validateIntentAccounts(w, intents) {
  if (!usesLawSemantics2(w)) return;
  for (const it of intents) {
    if (it.op !== 'fee' && it.op !== 'transfer') continue;
    const code = accountProblem(w, it.to, it.coins) || (it.op === 'transfer' && accountProblem(w, it.from));
    if (code) throw new RuleError(code);
  }
}

/**
 * 收集一条规则的意图（只读）。出错返回 null（已记 rule_error）。
 * run：{ env, rng?, quiet? }——env 是该时机的名字（actor args result here event），rng 是 sample 用的随机数流（缺省 w.rng.world）
 */
function collect(w, set, idx, rule, run) {
  const host = makeHost(w, { vars: varsFor(w, set), rng: run.rng || w.rng.world });
  try {
    run.collectError = null;
    run.conditionMatched = true;
    const intents = collectRule(rule, { host, env: run.env, budget: budgetForRule(w, rule), ...(run.trackOutcome ? { onCondition: c => { run.conditionMatched = c; } } : {}) });
    meterIntents(w, intents);
    validateIntentAccounts(w, intents);
    return intents;
  } catch (e) {
    if (!(e instanceof RuleError)) throw e;
    if (usesLawVM2(w) && e.code === 'fuel') throw new CapacityError({ code: 'proof_breach', path: `${set.key}.rules[${idx}]` });
    reportError(w, set, idx, e, run);
    run.collectError = e.code;
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 作用域对账户的限制（PROTOCOL-2 §6.11）
// ═══════════════════════════════════════════════════════════════

/**
 * 账户在这个规则集的作用域里是否可用。role：from | to | fee | among | target。
 *   城法：任何账户。
 *   社群章程：本社群的公库、本社群的成员；可以 to: treasury（向城纳税）。
 *   地点规则：主人、执行者（fee 只能交给主人）。
 */
function inScope(w, set, acct, role, run) {
  if (set.kind === 'city') return true;
  if (set.kind === 'group') {
    const g = set.group;
    if (acct.k === 'group') return acct.id === g.id;
    if (acct.k === 'treasury') return role === 'to' || role === 'fee';
    if (acct.k === 'agent') return g.members.includes(acct.id);
    return false;
  }
  const owner = set.place.owner;
  if (acct.k === 'agent') {
    if (owner.kind === 'agent' && owner.id === acct.id) return true;
    return role !== 'fee' && !!run.actor && run.actor.id === acct.id;
  }
  if (acct.k === 'group') return owner.kind === 'group' && owner.id === acct.id;
  return false;
}

// ═══════════════════════════════════════════════════════════════
// before：拒绝与收费
// ═══════════════════════════════════════════════════════════════

/** 规则里写的拒绝理由：字符串，或（遗法）{ zh, en }——按执行者的语言取 */
function pickReason(reason, lang) {
  if (typeof reason === 'string') return reason;
  return lang === 'en' ? reason.en : reason.zh;
}

/**
 * 收集 before 规则（§7.6 第 3 步）：城法 → 执行者所在社群的章程 → 地点规则（动作在此地执行时用 a.place 的）；
 * move 时另用目的地的 before:enter（目的地有运转中的门时）。第一个 deny 即返回；fee 汇总。
 * 返回 { denied: { law, reason } | null, fees: [{ law, rule, to, energy, coins }] }
 */
export function collectBefore(w, a, type, args, plan) {
  const fees = [];
  const sets = [...cityRuleSets(w), ...groupRuleSetsOf(w, a)];
  const here = placeRuleSetAt(w, a.place);
  if (here) sets.push(here);
  const run = { env: null, actor: a };
  const get = () => run.env || (run.env = actionEnv(w, a, type, args));
  const isBefore = (t) => t.kind === 'before' && t.action === type && !t.enter;
  for (const set of sets) {
    const r = runBeforeRules(w, a, set, isBefore, run, get, fees);
    if (r) return { denied: r, fees: [] };
  }
  // move：目的地有运转中的门时，另用目的地的 before:enter（城法与章程的 before:move 已在上面照常执行）
  if (type === 'move' && plan && plan.to && hasGate(w, plan.to)) {
    const dest = placeRuleSetAt(w, plan.to);
    if (dest) {
      const r = runBeforeRules(w, a, dest, (t) => t.kind === 'before' && t.enter === true, run, get, fees);
      if (r) return { denied: r, fees: [] };
    }
  }
  return { denied: null, fees };
}

function runBeforeRules(w, a, set, match, run, getEnv, fees) {
  for (let idx = 0; idx < set.rules.length; idx++) {
    const rule = set.rules[idx];
    if (!currentRule(w, set, idx, rule)) continue;
    if (!match(timingOf(rule))) continue;
    run.env = getEnv();
    const intents = collect(w, set, idx, rule, run);
    if (!intents) {
      if (usesLawSemantics2(w)) return { law: set.key, rule: idx, ruleCode: run.collectError, reason: 'rule_error' };
      continue;
    }
    for (const it of intents) {
      if (it.op === 'deny') return { law: set.key, reason: pickReason(it.reason, a.lang) };
      if (it.op === 'fee') {
        if (!inScope(w, set, it.to, 'fee', run)) {
          emitFeeRefused(w, set, idx, it);
          continue;
        }
        if (it.to.k === 'agent' && it.to.id === a.id) continue; // 付给自己：没有意义
        fees.push({ law: set.key, rule: idx, to: it.to, energy: it.energy, coins: it.coins });
      }
    }
  }
  return null;
}

function emitFeeRefused(w, set, idx, it) {
  emit(w, 'rule_op', { data: { scope: set.scopeStr, owner: set.owner, rule: idx, op: 'fee', ok: false, note: 'not_in_scope', to: acctKey(it.to), energy: it.energy, coins: it.coins } });
}

// ═══════════════════════════════════════════════════════════════
// after、on、daily、enact
// ═══════════════════════════════════════════════════════════════

/** 对一组规则集，运行满足 match 的规则并施行（非 before）。返回 enact 用的结果列表 */
function runApply(w, set, match, run) {
  const results = [];
  for (let idx = 0; idx < set.rules.length; idx++) {
    const rule = set.rules[idx];
    if (!currentRule(w, set, idx, rule)) continue;
    if (!match(timingOf(rule))) continue;
    if (run.outcome) run.outcome.matched++;
    const intents = collect(w, set, idx, rule, run);
    if (!intents) {
      if (run.outcome) {
        run.outcome.failed++;
        run.outcome.diagnostics.push({ rule: idx, phase: 'collect', code: run.collectError });
        results.push({ rule: idx, phase: 'collect', ok: false, code: run.collectError, note: run.collectError });
      }
      continue;
    }
    if (run.outcome && run.conditionMatched) run.outcome.ran++;
    withRuling(w, () => {
      intents.forEach((it, k) => {
        const r = applyIntent(w, set, idx, it, run);
        results.push({ rule: idx, index: k, op: it.op, ok: r.ok, note: r.note || '' });
        if (run.outcome) {
          if (!r.ok || r.note?.startsWith('partial:')) {
            run.outcome.failed++;
            run.outcome.diagnostics.push({ rule: idx, index: k, phase: 'apply', code: !r.ok ? r.note : 'partial_payment', ...(r.ok ? { note: r.note } : {}) });
            if (r.ok && r.delivered > 0) run.outcome.succeeded++;
          } else run.outcome.succeeded++;
        }
      });
    });
  }
  return results;
}

/** after 规则（§7.6 第 7 步）：顺序同 before；地点规则用动作发生时的地点（startPlace） */
export function runAfter(w, a, type, args, data, plan, startPlace) {
  if (isRuling(w)) return;
  const sets = [...cityRuleSets(w), ...groupRuleSetsOf(w, a)];
  const here = placeRuleSetAt(w, startPlace ?? a.place);
  if (here) sets.push(here);
  if (sets.length === 0) return;
  const match = (t) => t.kind === 'after' && t.action === type;
  // 先看有没有会跑的规则，免得白白建环境
  if (!sets.some((s) => s.rules.some((r) => match(timingOf(r))))) return;
  const run = { env: actionEnv(w, a, type, args, data), actor: a, here: startPlace ?? a.place };
  for (const set of sets) runApply(w, set, match, run);
}

/**
 * 物理事件发生时（§7.6）：依次执行城法的 on:<type>，以及（event.agent 存在时）它所在社群的章程的 on:<type>。
 * data：{ agent?, place?, build?, weather?, law?, groups? }——groups 是事件当事人当时所在的社群（death、retire 在离场之前取下）。
 */
export function fireEvent(w, type, data) {
  if (isRuling(w)) return;
  const match = (t) => t.kind === 'on' && t.event === type;
  const sets = cityRuleSets(w).filter((s) => s.rules.some((r) => match(timingOf(r))));
  if (data.agent) {
    const a = w.agents[data.agent];
    const gids = (data.groups || a.groups).slice().sort((x, y) => idNum(x) - idNum(y));
    for (const gid of gids) {
      const g = w.groups[gid];
      if (!g || g.dissolved || !g.bylaws || g.bylaws.rules.length === 0 || isSuspended(w, g.bylaws)) continue;
      if (g.bylaws.rules.some((r) => match(timingOf(r)))) sets.push(groupSet(g));
    }
  }
  if (sets.length === 0) return;
  const run = { env: { event: eventRecord(type, data) }, actor: data.agent ? w.agents[data.agent] : null, here: data.place || (data.agent ? w.agents[data.agent].place : null) };
  for (const set of sets) runApply(w, set, match, run);
}

/**
 * 法律生效 / 章程或地点规则被设定时，立即执行它的 enact 规则（按规则顺序）。
 * 返回结果列表 [{ rule, index, op, ok, note }]。quiet：创世时不产生事件。
 */
export function runEnact(w, set, { quiet = false } = {}) {
  const run = { env: {}, actor: null, here: set.kind === 'place' ? set.place.id : null, quiet };
  if (usesLawSemantics2(w)) {
    run.trackOutcome = true;
    run.outcome = { matched: 0, ran: 0, failed: 0, succeeded: 0, diagnostics: [] };
  }
  const results = runApply(w, set, (t) => t.kind === 'enact', run);
  if (run.outcome) {
    const o = run.outcome;
    const status = o.failed ? (o.succeeded ? 'partial_failure' : 'failure') : !o.matched ? 'no_enact' : !o.ran ? 'condition_false' : 'success';
    set.holder.enact = { status, diagnostics: o.diagnostics };
    set.holder.results = results;
  }
  return results;
}

/**
 * 每日结算第 3 步（§7.6）：daily 规则——城法（法律 ID 升序）→ 社群章程（社群 ID 升序）→ 地点规则（地点顺序）；
 * 若 (d + 1) % daysPerMonth == 0，接着以同样的顺序执行 monthly。停摆的（维持费没付到今天）不执行。
 */
export function dailyRules(w, d) {
  const passes = ['daily'];
  if ((d + 1) % P.daysPerMonth === 0) passes.push('monthly');
  for (const kind of passes) {
    const match = (t) => t.kind === kind;
    const sets = [...cityRuleSets(w)];
    for (const g of Object.values(w.groups)) {
      if (!g.dissolved && g.bylaws && g.bylaws.rules.length > 0 && !isSuspended(w, g.bylaws)) sets.push(groupSet(g));
    }
    for (const p of Object.values(w.places)) {
      if (p.rules && p.rules.rules.length > 0 && p.owner.kind !== 'city' && !isSuspended(w, p.rules)) sets.push(placeSet(p));
    }
    for (const set of sets) {
      if (!set.rules.some((r) => match(timingOf(r)))) continue;
      const run = { env: {}, actor: null, here: set.kind === 'place' ? set.place.id : null };
      runApply(w, set, match, run);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 试算与感知用：只收集，不施行
// ═══════════════════════════════════════════════════════════════

const ARGS_REF = new WeakMap(); // rule 对象 → 它的表达式里是否引用 args（不进快照）

/** 一条规则的表达式（条件与各操作的表达式字段，含 each 里的）里是否引用了 args */
export function referencesArgs(rule) {
  if (ARGS_REF.has(rule)) return ARGS_REF.get(rule);
  const uses = (tree) => {
    if (tree.t === 'name') return tree.n === 'args';
    if (tree.t === 'field') return uses(tree.o);
    if (tree.t === 'un') return uses(tree.a);
    if (tree.t === 'bin') return uses(tree.a) || uses(tree.b);
    if (tree.t === 'call') return tree.a.some(uses);
    return false;
  };
  const exprUses = (src) => {
    try {
      return uses(parseCached(src));
    } catch {
      return false;
    }
  };
  const opUses = (op) => {
    for (const [field, kind] of OP_FIELDS[op.op] || []) {
      if (op[field] === undefined) continue;
      if (kind === 'ops') {
        if (op[field].some(opUses)) return true;
      } else if (kind === 'template') {
        // 宣告的模板里 {…} 的表达式：before 规则没有宣告，这里只为完整
        continue;
      } else if (['acct', 'agent', 'agents', 'int', 'bool', 'scalar'].includes(kind) && exprUses(op[field])) return true;
    }
    return false;
  };
  const r = (rule.if !== undefined && exprUses(rule.if)) || rule.do.some(opUses);
  ARGS_REF.set(rule, r);
  return r;
}

/**
 * 对某位居民生效的 before 规则，按动作类型归类：Map<动作, [{ set, idx, rule }]>（不含 before:enter）。
 * 感知要为每种动作各做一次预求值，每次都重新扫一遍全部规则太慢，所以一次建好索引再查。
 */
export function beforeIndex(w, a) {
  const index = new Map();
  const sets = [...cityRuleSets(w), ...groupRuleSetsOf(w, a)];
  const here = placeRuleSetAt(w, a.place);
  if (here) sets.push(here);
  for (const set of sets) {
    for (let idx = 0; idx < set.rules.length; idx++) {
      const rule = set.rules[idx];
      const t = timingOf(rule);
      if (t.kind !== 'before' || t.enter) continue;
      if (!index.has(t.action)) index.set(t.action, []);
      index.get(t.action).push({ set, idx, rule });
    }
  }
  return index;
}

/**
 * 感知里的预求值（SPEC-E2 §7.13）：对某个动作，收集会对它生效的 before 规则（城法、执行者所在社群的章程、所在之处的地点规则）；
 * 不引用 args 的规则以当前的执行者求值（只收集，不施行，随机数用副本）：得到 deny 则 denied；fee 汇总；
 * 引用 args 的规则只把它所属的法律放进 laws，提醒执行者行动时可能被拒绝。历史预求值错误忽略；法律语义 2 返回错误拒绝。
 * 返回 { denied: { law, reason } | null, fees: [{ law, energy, coins, to }], laws: [key…] }
 * index：beforeIndex(w, a) 的结果（逐个动作调用时由调用者建好传入，缺省现建）。
 */
export function previewBefore(w, a, type, lang = 'zh', index = beforeIndex(w, a)) {
  const out = { denied: null, fees: [], laws: [] };
  const entries = index.get(type);
  if (!entries) return out;
  const rng = w.rng.world.slice();
  const env = { actor: agentRef(a.id) };
  Object.defineProperty(env, 'here', { enumerable: true, get: () => hereOf(w, a.place) });
  for (const { set, rule, idx } of entries) {
    if (referencesArgs(rule)) {
      if (!out.laws.includes(set.key)) out.laws.push(set.key);
      continue;
    }
    let intents;
    try {
      intents = collectRule(rule, { host: makeHost(w, { vars: varsFor(w, set), rng }), env, budget: budgetForRule(w, rule) });
      validateIntentAccounts(w, intents);
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      if (usesLawSemantics2(w)) {
        out.denied = { law: set.key, rule: idx, ruleCode: e.code, reason: 'rule_error' };
        out.fees = [];
        return out;
      }
      continue;
    }
    for (const it of intents) {
      if (it.op === 'deny') {
        out.denied = { law: set.key, reason: pickReason(it.reason, lang) };
        return out;
      }
      if (it.op === 'fee' && inScope(w, set, it.to, 'fee', { actor: a }) && !(it.to.k === 'agent' && it.to.id === a.id)) {
        out.fees.push({ law: set.key, energy: it.energy, coins: it.coins, to: acctKey(it.to) });
      }
    }
  }
  return out;
}

/**
 * 试算 draft（§7.12）：对 enact / daily（以及 monthly）规则只做「收集」，返回意图的摘要列表。
 * rng 是 w.rng.world 的副本，不推进真正的随机数；任何东西都不施行，也不记事件。
 */
export function previewRules(w, set, { rng, kinds = ['enact', 'daily', 'monthly'] } = {}) {
  const out = [];
  for (let idx = 0; idx < set.rules.length; idx++) {
    const rule = set.rules[idx];
    const t = timingOf(rule);
    if (!kinds.includes(t.kind)) continue;
    const h = makeHost(w, { vars: varsFor(w, set), rng });
    try {
      const intents = collectRule(rule, { host: h, env: {}, budget: budgetForRule(w, rule) });
      validateIntentAccounts(w, intents);
      for (const it of intents) out.push({ rule: idx, ...intentSummary(it) });
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      out.push({ rule: idx, error: e.code, detail: e.detail || '' });
    }
  }
  return out;
}

/** 意图的摘要（试算的 preview 与 rule_op 共用的口径） */
export function intentSummary(it) {
  switch (it.op) {
    case 'transfer': return { op: 'transfer', from: acctKey(it.from), to: acctKey(it.to), energy: it.energy, coins: it.coins };
    case 'share': return { op: 'share', from: acctKey(it.from), among: it.among.length, energy: it.energy, coins: it.coins };
    case 'set': return { op: 'set', var: it.var, value: it.value };
    case 'tag':
    case 'untag': return { op: it.op, who: it.who, tag: it.tag };
    case 'announce': return { op: 'announce', to: it.to, text: it.text };
    case 'exile':
    case 'pardon': return { op: it.op, who: it.who };
    case 'rename': return { op: 'rename', target: it.target, name: it.name };
    case 'mint': return { op: 'mint', coins: it.coins, to: acctKey(it.to) };
    case 'protect':
    case 'unprotect': return { op: it.op, inscription: it.inscription };
    case 'amend': return 'canonical' in it ? { op: 'amend', canonical: it.canonical } : { op: 'amend', article: it.article, lang: it.lang };
    case 'repeal': return { op: 'repeal', law: it.law };
    case 'fund': return { op: 'fund', project: it.project, energy: it.energy };
    case 'cede': return { op: 'cede', place: it.place, to: acctKey(it.to) };
    case 'seize': return { op: 'seize', place: it.place };
    case 'petition': return { op: 'petition', text: it.text };
    case 'deny': return { op: 'deny', reason: it.reason };
    case 'fee': return { op: 'fee', to: acctKey(it.to), energy: it.energy, coins: it.coins };
    default: return { op: it.op };
  }
}

/** 账户的键：'treasury' | 居民 ID | 社群 ID | 灵魂 ID */
export const acctKey = (acct) => (acct.k === 'treasury' ? 'treasury' : acct.id);

// ═══════════════════════════════════════════════════════════════
// 操作的施行（§7.7）
// ═══════════════════════════════════════════════════════════════

const OK = Object.freeze({ ok: true, note: '' });
const fail = (note) => ({ ok: false, note });
const partial = (got, want) => (got < want ? { ok: true, note: `partial:${got}/${want}` } : OK);

/** 记一条 rule_op（创世时不记） */
function opEvent(w, set, idx, it, res, run, extra = {}, place) {
  if (run.quiet) return;
  w.dayLog.ruleOps++;
  emit(w, 'rule_op', {
    place,
    data: { scope: set.scopeStr, owner: set.owner, rule: idx, op: it.op, ok: res.ok, ...(res.note ? { note: res.note } : {}), ...extra },
  });
}

/** 账户的可转额：从居民 = max(0, 能量 − lawFloor)（旧币不截）；公库与社群公库 = 余额 */
function transferable(w, acct) {
  const b = balanceOf(w, acct);
  if (acct.k === 'agent') return { energy: Math.max(0, b.energy - P.lawFloor), coins: b.coins };
  return b;
}

const sameAcct = (a, b) => a.k === b.k && (a.id || '') === (b.id || '');

function applyIntent(w, set, idx, it, run) {
  switch (it.op) {
    case 'transfer': return opTransfer(w, set, idx, it, run);
    case 'share': return opShare(w, set, idx, it, run);
    case 'set': return opSet(w, set, idx, it, run);
    case 'tag':
    case 'untag': return opTag(w, set, idx, it, run);
    case 'announce': return opAnnounce(w, set, idx, it, run);
    case 'exile': return opExile(w, set, idx, it, run);
    case 'pardon': return opPardon(w, set, idx, it, run);
    case 'rename': return opRename(w, set, idx, it, run);
    case 'mint': return opMint(w, set, idx, it, run);
    case 'protect':
    case 'unprotect': return opProtect(w, set, idx, it, run);
    case 'amend': return opAmend(w, set, idx, it, run);
    case 'repeal': return opRepeal(w, set, idx, it, run);
    case 'fund': return opFund(w, set, idx, it, run);
    case 'cede': return opCede(w, set, idx, it, run);
    case 'seize': return opSeize(w, set, idx, it, run);
    case 'petition': return opPetition(w, set, idx, it, run);
    default: {
      const res = fail('unknown_op');
      opEvent(w, set, idx, it, res, run);
      return res;
    }
  }
}

function opTransfer(w, set, idx, it, run) {
  let res;
  let moved = { energy: 0, coins: 0 };
  const problem = usesLawSemantics2(w) && (accountProblem(w, it.from) || accountProblem(w, it.to, it.coins));
  if (problem) res = fail(problem);
  else if (!inScope(w, set, it.from, 'from', run) || !inScope(w, set, it.to, 'to', run)) res = fail('not_in_scope');
  else if (sameAcct(it.from, it.to)) res = { ok: true, note: 'same_account' };
  else {
    const avail = transferable(w, it.from);
    moved = { energy: Math.min(it.energy, avail.energy), coins: Math.min(it.coins, avail.coins) };
    if (moved.energy > 0 || moved.coins > 0) {
      debit(w, it.from, moved.energy, moved.coins);
      credit(w, it.to, moved.energy, moved.coins, { lawId: set.key }, it.from);
      const by = (acct) => acctRef(w, acct);
      notifyTransfer(w, it.from, { law: set.key, energy: moved.energy, coins: moved.coins, direction: 'out', counterparty: by(it.to) });
      notifyTransfer(w, it.to, { law: set.key, energy: moved.energy, coins: moved.coins, direction: 'in', counterparty: by(it.from) });
    }
    res = partial(moved.energy + moved.coins, it.energy + it.coins);
    if (usesLawSemantics2(w)) res = { ...res, delivered: moved.energy + moved.coins };
  }
  opEvent(w, set, idx, it, res, run, { from: acctKey(it.from), to: acctKey(it.to), energy: moved.energy, coins: moved.coins });
  return res;
}

function opShare(w, set, idx, it, run) {
  let res;
  let each = { energy: 0, coins: 0 };
  const n = it.among.length;
  if (!inScope(w, set, it.from, 'from', run) || !it.among.every((id) => inScope(w, set, { k: 'agent', id }, 'among', run))) res = fail('not_in_scope');
  else if (n === 0) res = { ok: true, note: 'no_recipients' };
  else {
    const avail = transferable(w, it.from);
    const got = { energy: Math.min(it.energy, avail.energy), coins: Math.min(it.coins, avail.coins) };
    each = { energy: Math.floor(got.energy / n), coins: Math.floor(got.coins / n) };
    const total = { energy: each.energy * n, coins: each.coins * n };
    if (total.energy > 0 || total.coins > 0) {
      debit(w, it.from, total.energy, total.coins);
      notifyTransfer(w, it.from, { law: set.key, energy: total.energy, coins: total.coins, direction: 'out' });
      for (const id of it.among) {
        credit(w, { k: 'agent', id }, each.energy, each.coins, { lawId: set.key }, it.from);
        notifyTransfer(w, { k: 'agent', id }, { law: set.key, energy: each.energy, coins: each.coins, direction: 'in', counterparty: acctRef(w, it.from) });
      }
    }
    res = partial(got.energy + got.coins, it.energy + it.coins);
    if (usesLawSemantics2(w)) res = { ...partial(total.energy + total.coins, it.energy + it.coins), delivered: total.energy + total.coins };
    // 史官与指标要的「配给」：每日结算里城法从公库平分给居民的第一笔
    if (set.kind === 'city' && it.from.k === 'treasury' && w.$settling !== undefined && w.dayLog.rationed === 0 && each.energy > 0) {
      w.dayLog.ration = each.energy;
      w.dayLog.rationed = n;
    }
  }
  opEvent(w, set, idx, it, res, run, { from: acctKey(it.from), among: n, each: { energy: each.energy, coins: each.coins } });
  return res;
}

function opSet(w, set, idx, it, run) {
  const vars = set.kind === 'group' ? set.group.vars : set.kind === 'city' ? w.vars : null;
  let res;
  if (!vars) res = fail('not_in_scope');
  else if (it.value === null) {
    delete vars[it.var];
    res = OK;
  } else {
    const cap = set.kind === 'group' ? P.varsGroup : P.varsCity;
    if (!has(vars, it.var) && Object.keys(vars).length >= cap) res = fail('vars_full');
    else {
      vars[it.var] = it.value;
      res = OK;
    }
  }
  opEvent(w, set, idx, it, res, run, { var: it.var, value: it.value });
  return res;
}

function opTag(w, set, idx, it, run) {
  const a = w.agents[it.who];
  const tag = set.kind === 'group' ? `${set.group.id}:${it.tag}` : it.tag;
  let res;
  if (set.kind === 'group' && !set.group.members.includes(a.id)) res = fail('not_in_scope');
  else if (it.op === 'tag') {
    if (a.tags.includes(tag)) res = { ok: true, note: 'already' };
    else {
      a.tags.push(tag);
      pushInbox(w, a, 'tag', { law: set.key, tag, added: true });
      res = OK;
    }
  } else if (!a.tags.includes(tag)) res = { ok: true, note: 'absent' };
  else {
    a.tags = a.tags.filter((x) => x !== tag);
    pushInbox(w, a, 'tag', { law: set.key, tag, added: false });
    res = OK;
  }
  opEvent(w, set, idx, it, res, run, { who: a.id, tag });
  return res;
}

// ── 宣告 ────────────────────────────────────────────────────

/** 宣告的收件人：在世居民，按 ID 升序。章程只能发给成员（取交集）；社群章程里的 tag: 是带前缀的标签 */
function audienceOf(w, set, to, run) {
  let list;
  if (to === 'all') list = Object.values(w.agents).filter(isAlive);
  else if (to === 'here') {
    const pid = set.kind === 'place' ? set.place.id : run.here;
    list = pid ? Object.values(w.agents).filter((a) => isAlive(a) && a.place === pid) : [];
  } else if (to.startsWith('tag:')) {
    const tag = set.kind === 'group' ? `${set.group.id}:${to.slice(4)}` : to.slice(4);
    list = Object.values(w.agents).filter((a) => isAlive(a) && a.tags.includes(tag));
  } else if (to.startsWith('group:')) {
    const g = w.groups[to.slice(6)];
    list = g && !g.dissolved ? g.members.map((id) => w.agents[id]).filter(isAlive) : [];
  } else list = Object.values(w.agents).filter((a) => isAlive(a) && a.place === to);
  if (set.kind === 'group') list = list.filter((a) => set.group.members.includes(a.id));
  return list.sort((x, y) => idNum(x.id) - idNum(y.id));
}

/** 宣告的付款方：城法 → 公库；章程 → 社群公库；地点规则 → 主人（居民的能量，或社群公库）。返回账户 */
function announcePayer(set) {
  if (set.kind === 'city') return { k: 'treasury' };
  if (set.kind === 'group') return { k: 'group', id: set.group.id };
  const o = set.place.owner;
  return { k: o.kind, id: o.id };
}

function opAnnounce(w, set, idx, it, run) {
  let res;
  const all = it.to === 'all';
  if (!screen(it.text).ok) {
    // 插值后的全文再审核一次，不通过则这一条宣告不发出
    res = fail('moderated');
    if (!run.quiet) {
      w.dayLog.ruleErrors++;
      emit(w, 'rule_error', { data: { scope: set.scopeStr, owner: set.owner, rule: idx, code: 'moderated', detail: '' } });
    }
  } else if (all && isWeatherActive(w, 'eclipse') && !hasRelay(w)) res = fail('disabled_by_weather');
  else {
    const cost = all ? actionCost(w, 'broadcast', ACTIONS.broadcast.base, null) : 1;
    const payer = announcePayer(set);
    if (balanceOf(w, payer).energy < cost) res = fail('insufficient');
    else {
      debit(w, payer, cost, 0);
      sink(w, 'energy', 'rule_ops', cost);
      const audience = audienceOf(w, set, it.to, run);
      for (const a of audience) pushInbox(w, a, 'announce', { law: set.key, text: it.text });
      if (!run.quiet) emit(w, 'announce', { data: { scope: set.scopeStr, owner: set.owner, to: it.to, text: it.text, recipients: audience.length } });
      res = OK;
    }
  }
  opEvent(w, set, idx, it, res, run, { to: it.to });
  return res;
}

// ── 放逐与赦免 ──────────────────────────────────────────────

function opExile(w, set, idx, it, run) {
  const a = w.agents[it.who];
  let res;
  if (a.tags.includes('exiled')) res = { ok: true, note: 'already' };
  else {
    a.tags.push('exiled');
    a.place = 'wilds';
    w.places.wilds.activity.visits++;
    pushInbox(w, a, 'exile', { lawId: set.key });
    emit(w, 'exile', { agent: a.id, place: 'wilds', data: { lawId: set.key, scope: set.scopeStr, agentId: a.id } });
    res = OK;
  }
  opEvent(w, set, idx, it, res, run, { who: a.id });
  return res;
}

function opPardon(w, set, idx, it, run) {
  const a = w.agents[it.who];
  let res;
  if (!a.tags.includes('exiled')) res = { ok: true, note: 'not_exiled' };
  else {
    a.tags = a.tags.filter((x) => x !== 'exiled');
    pushInbox(w, a, 'pardon', { lawId: set.key });
    emit(w, 'pardon', { agent: a.id, place: a.place, data: { lawId: set.key, scope: set.scopeStr, agentId: a.id } });
    res = OK;
  }
  opEvent(w, set, idx, it, res, run, { who: a.id });
  return res;
}

// ── 改名、铸币、铭刻、宪章、撤销 ──────────────────────────────

function opRename(w, set, idx, it, run) {
  let res = OK;
  if (it.target === 'city') w.cityName = it.name;
  else if (!has(w.places, it.target)) res = fail('target_gone');
  else if (placeNameTaken(w, it.name, it.target)) res = fail('name_taken');
  else {
    const p = w.places[it.target];
    p.name = it.name;
    p.renamedBy = set.key;
  }
  if (res.ok) emit(w, 'rename', { place: it.target === 'city' ? undefined : it.target, data: { lawId: set.key, scope: set.scopeStr, target: it.target, name: it.name } });
  opEvent(w, set, idx, it, res, run, { target: it.target, name: it.name });
  return res;
}

/** 一次 mint 的上限（PROTOCOL-2 §6.7：1–10000 旧币） */
const MINT_MAX = 10000;

function opMint(w, set, idx, it, run) {
  let res;
  if (it.coins > MINT_MAX) res = fail('out_of_range');
  else {
    source(w, 'coins', 'mint', it.coins);
    w.dayLog.mints++;
    w.counters.mints = (w.counters.mints || 0) + 1;
    credit(w, it.to, 0, it.coins, { lawId: set.key }, null);
    notifyTransfer(w, it.to, { law: set.key, energy: 0, coins: it.coins, direction: 'in' });
    emit(w, 'mint', { data: { lawId: set.key, scope: set.scopeStr, coins: it.coins, to: acctKey(it.to) } });
    res = OK;
  }
  opEvent(w, set, idx, it, res, run, { coins: it.coins, to: acctKey(it.to) });
  return res;
}

function opProtect(w, set, idx, it, run) {
  const ins = has(w.inscriptions, it.inscription) ? w.inscriptions[it.inscription] : null;
  let res;
  if (it.op === 'protect') {
    if (!ins || ins.coveredBy || ins.redacted || ins.lost) res = fail('not_visible');
    else {
      if (!ins.protectedBy.includes(set.key)) ins.protectedBy.push(set.key);
      emit(w, 'protect', { place: ins.place, data: { lawId: set.key, inscriptionId: ins.id } });
      res = OK;
    }
  } else if (!ins) res = fail('target_gone');
  else if (ins.protectedBy.length === 0) res = { ok: true, note: 'not_protected' };
  else {
    // TODO(spec): Q5（第一纪）—— unprotect 清除该铭刻的全部保护
    const removed = ins.protectedBy.slice();
    ins.protectedBy = [];
    emit(w, 'unprotect', { place: ins.place, data: { lawId: set.key, inscriptionId: ins.id, removed } });
    res = OK;
  }
  opEvent(w, set, idx, it, res, run, { inscription: it.inscription });
  return res;
}

/** amend：条文形式（设置某条某语言的文本、空串废除该条、条号 = 最大条号 + 1 时新增）或正本形式（同第一纪） */
function opAmend(w, set, idx, it, run) {
  let res = OK;
  if ('canonical' in it) {
    if (it.canonical !== null && !w.charter.some((art) => it.canonical in art.versions)) res = fail('no_such_version');
    else {
      w.charterCanonical = it.canonical;
      emit(w, 'amend', { place: 'parliament', data: { lawId: set.key, canonical: it.canonical } });
    }
  } else {
    const max = w.charter.length;
    if (it.article === max + 1) {
      if (it.text === '') res = fail('empty_new_article');
      else w.charter.push({ n: it.article, versions: { [it.lang]: it.text }, status: 'amended', history: [{ lawId: set.key, lang: it.lang, text: it.text }] });
    } else if (it.article > max + 1) res = fail('no_such_article');
    else {
      const art = w.charter[it.article - 1];
      if (it.text === '') {
        art.status = 'repealed';
        art.history.push({ lawId: set.key, lang: '*', text: '' });
      } else {
        art.versions[it.lang] = it.text;
        art.status = 'amended';
        art.history.push({ lawId: set.key, lang: it.lang, text: it.text });
      }
    }
    if (res.ok) emit(w, 'amend', { place: 'parliament', data: { lawId: set.key, article: it.article, lang: it.lang, text: it.text } });
  }
  opEvent(w, set, idx, it, res, run, 'canonical' in it ? { canonical: it.canonical } : { article: it.article, lang: it.lang });
  return res;
}

function opRepeal(w, set, idx, it, run) {
  const target = has(w.laws, it.law) ? w.laws[it.law] : null;
  let res;
  if (!target || target.status !== 'active' || target.procedure || target.id === set.owner) res = fail('not_active');
  else {
    repealLaw(w, target, set.owner);
    emit(w, 'repeal', { data: { lawId: set.key, scope: set.scopeStr, target: target.id } });
    res = OK;
  }
  opEvent(w, set, idx, it, res, run, { law: it.law });
  return res;
}

// ── 工程出资、地点所有权、上书 ────────────────────────────────

/** fund：公库为工程出资，数额取「请求数额、还差多少、公库余额」三者的最小值 */
function opFund(w, set, idx, it, run) {
  const j = has(w.projects, it.project) ? w.projects[it.project] : null;
  let res;
  let amount = 0;
  if (!j || j.status !== 'open') res = fail('target_gone');
  else {
    amount = Math.min(it.energy, j.need - j.have, w.treasury.energy);
    if (amount > 0) {
      w.treasury.energy -= amount;
      addToProject(w, j, 'treasury', amount);
    }
    emit(w, 'fund', { place: j.place, data: { lawId: set.key, scope: set.scopeStr, projectId: j.id, energy: amount } });
    res = partial(amount, it.energy);
    if (usesLawSemantics2(w)) res = { ...res, delivered: amount };
  }
  opEvent(w, set, idx, it, res, run, { project: it.project, energy: amount });
  return res;
}

function opCede(w, set, idx, it, run) {
  const p = has(w.places, it.place) ? w.places[it.place] : null;
  let res;
  if (!p) res = fail('target_gone');
  else if (p.owner.kind !== 'city') res = fail('not_city_owned');
  else if (p.open) res = fail('not_ownable');
  else {
    p.owner = { kind: it.to.k, id: it.to.id };
    emit(w, 'cede', { place: p.id, data: { lawId: set.key, scope: set.scopeStr, place: p.id, from: { kind: 'city' }, to: { kind: it.to.k, id: it.to.id } } });
    res = OK;
  }
  opEvent(w, set, idx, it, res, run, { place: it.place, to: acctKey(it.to) }, p ? p.id : undefined);
  return res;
}

function opSeize(w, set, idx, it, run) {
  const p = has(w.places, it.place) ? w.places[it.place] : null;
  let res;
  if (!p) res = fail('target_gone');
  else if (p.owner.kind === 'city') res = fail('already_city');
  else {
    const from = { kind: p.owner.kind, id: p.owner.id };
    p.owner = { kind: 'city' };
    p.rules = null; // 全城所有的地点没有地点规则
    emit(w, 'seize', { place: p.id, data: { lawId: set.key, scope: set.scopeStr, place: p.id, from, to: { kind: 'city' } } });
    res = OK;
  }
  opEvent(w, set, idx, it, res, run, { place: it.place }, p ? p.id : undefined);
  return res;
}

function opPetition(w, set, idx, it, run) {
  w.petitions.push({ lawId: set.key, day: clockDay(w), text: it.text });
  emit(w, 'petition', { data: { lawId: set.key, scope: set.scopeStr, text: it.text } });
  const res = OK;
  opEvent(w, set, idx, it, res, run);
  return res;
}

// ═══════════════════════════════════════════════════════════════
// 接入物理引擎
// ═══════════════════════════════════════════════════════════════

installHooks({
  before: collectBefore,
  after: runAfter,
  fire: fireEvent,
});

STEPS.dailyRules = dailyRules;
