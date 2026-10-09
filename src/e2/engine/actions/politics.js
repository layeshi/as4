import { tokenized } from '../../world.js';
import { jsonWeight } from '../tokens.js';
import { usesLawSemantics2 } from '../law-semantics.js';
import { prayersEnabled } from '../prayer-rewards.js';
// 立法的动作（SPEC-E2 §25 第 4 步）：propose vote draft refound sign。
// （rules 订立社群章程与地点规则在第 5 步；read { law } 在 social.js 的 read 里。）

import { P, LIMITS } from '../../params.js';
import { ACTIONS } from '../../lore/actions.js';
import { clockDay } from '../../world.js';
import { validateRules, validateProcedure } from '../../rules/check.js';
import { fail, needText, needId, optText } from '../core.js';
import { needGroup } from './social.js';
import { needPlace } from './util.js';
import { GROUP_PROCEDURES, setGroupBylaws, setPlaceRulesOf, setGroupProcedure, openGroupProposal, openGroupProposals } from '../bylaws.js';
import { isOwnerOrSteward } from '../places.js';
import { classify, procSpec } from '../laws.js';
import {
  staticLookup, issuesHint, mayPropose, votersOf, rngCopy, openCityProposals, openProposal,
  openRefounds, openRefound, signRefound, refoundNeeded, refoundElectorate, procedureSource, observeProcedureFault,
} from '../legislation.js';
import { previewRules, citySet, groupSet, placeSet } from '../rules.js';
import { emit } from '../core.js';
import { renderRules, renderProcedure } from '../../rules/render.js';
import { usesLawVM2, lawDiagnostics, capacityCheck } from '../law-execution.js';

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const given = (v) => v !== undefined && v !== null;

function admit(w, rules, procedure = null, replacePath = null, ballotSpec = null) {
  if (!usesLawVM2(w)) return;
  const proof = lawDiagnostics(w, rules, procedure);
  const prospective = [{ path: 'candidate', rules, procedure }];
  if (ballotSpec) prospective.push({ path: 'candidate.ballot', rules: [], procedure: { ballot: ballotSpec } });
  const aggregate = capacityCheck(w, w.ruleExecution.capacity, prospective, replacePath);
  proof.issues.push(...aggregate.issues);
  proof.ok &&= aggregate.ok;
  if (!proof.ok) ruleInvalid(proof.issues.map(i => ({ ...i, zh: '无法证明此规则在支持规模内满足计算预算。', en: 'The rule cannot be certified within the supported computation capacity.', hint: { zh: '先用 draft 查看成本诊断。', en: 'Use draft to inspect the cost diagnostics first.' } })));
}

/** 校验失败 → 动作级错误 rule_invalid（hint 说明哪一条规则、哪个字段、为什么） */
export function ruleInvalid(issues) {
  return fail('rule_invalid', issuesHint(issues), { issues: issues.map((i) => ({ path: i.path, code: i.code, zh: i.zh, en: i.en, hint: i.hint })) });
}

// ── propose ─────────────────────────────────────────────────

const propose = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const title = needText(args.title, { max: LIMITS.proposalTitle });
    if (title.includes('\n')) fail('invalid_args');
    const text = needText(args.text, { max: LIMITS.proposalText });
    const hasRules = given(args.rules);
    const hasProc = given(args.procedure);
    if (hasRules && hasProc) {
      fail('invalid_args', { zh: 'rules 与 procedure 不能同时出现：立法程序是一部只有 procedure 的法律。', en: 'rules and procedure cannot both be given: a procedure of lawmaking is a law with only a procedure.' });
    }
    let rules = [];
    let procedure = null;
    const lookup = staticLookup(w);
    if (hasRules) {
      const v = validateRules(args.rules, { scope: { premise: w.premise || 0, prayers: prayersEnabled(w), kind: 'city' }, lookup });
      if (!v.ok) ruleInvalid(v.issues);
      rules = v.rules;
    }
    if (hasProc) {
      const v = validateProcedure(args.procedure, { lookup });
      if (!v.ok) ruleInvalid(v.issues);
      procedure = v.procedure;
    }
    let basedOn = null;
    if (given(args.basedOn)) {
      needId(args.basedOn);
      if (!has(w.laws, args.basedOn)) fail('not_found', { zh: `basedOn 指向的法律 ${args.basedOn} 不存在。`, en: `The law named by basedOn (${args.basedOn}) does not exist.` });
      basedOn = args.basedOn;
    }
    const cls = classify(rules, procedure);
    const spec = procSpec(w, cls);
    if (!spec || spec.none) fail('not_allowed', { zh: '这一类已不再立法，只能重订。', en: 'This class no longer makes laws; only a refounding can change that.' });
    admit(w, rules, procedure, null, spec);
    const rng = rngCopy(w); // 校验用副本：失败的动作不推进真正的随机数；成功时 apply 一并提交
    const source = procedureSource(w, cls);
    const onError = (field, e, context) => observeProcedureFault(w, source, field, e, context);
    if (!mayPropose(w, spec, a, rng, onError)) fail('not_eligible');
    const open = openCityProposals(w);
    if (open.length >= LIMITS.openProposalsCity || open.some((p) => p.proposer === a.id)) fail('limit_reached');
    const voters = votersOf(w, spec, rng, onError);
    if (voters === null || voters.length === 0) {
      fail('not_allowed', { zh: '当前程序没有合格的表决者。', en: 'The current procedure has no eligible voters.' });
    }
    return { title, text, rules, procedure, basedOn, cls, spec, voters, rngAfter: rng, cost: ctx.cost(ACTIONS.propose.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    w.rng.world.splice(0, 4, ...plan.rngAfter);
    const p = openProposal(w, a, plan);
    return { proposal: p.id, closesTick: p.closesTick, class: p.class };
  },
};

// ── vote ────────────────────────────────────────────────────

const CHOICES = ['yes', 'no', 'abstain'];

const vote = {
  validate(ctx, args) {
    const { w, a } = ctx;
    needId(args.proposal);
    const p = has(w.proposals, args.proposal) ? w.proposals[args.proposal] : null;
    if (!p || p.status !== 'open') fail('not_found');
    if (typeof args.choice !== 'string' || !CHOICES.includes(args.choice)) fail('invalid_args', { zh: 'choice 须为 yes、no 或 abstain。', en: 'choice must be yes, no or abstain.' });
    const reason = optText(args.reason, { max: LIMITS.reason }) || '';
    if (!p.voters.includes(a.id)) fail('not_eligible');
    return { p, choice: args.choice, reason, cost: ctx.cost(ACTIONS.vote.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const { p } = plan;
    const changed = has(p.votes, a.id);
    p.votes[a.id] = { choice: plan.choice, reason: plan.reason, tick: w.clock.tick };
    emit(w, 'vote', { agent: a.id, place: a.place, data: { proposalId: p.id, scope: p.scope, choice: plan.choice, reason: plan.reason, changed } });
    return { proposal: p.id, choice: plan.choice, changed };
  },
};

// ── draft ───────────────────────────────────────────────────

/** 解析 draft 的 scope：缺省 / "city" 为城法；"group:<g>"；"place:<id>" */
function parseScope(w, v) {
  if (!given(v) || v === 'city') return { kind: 'city' };
  if (typeof v !== 'string') fail('invalid_args');
  const m = /^(group|place):(.+)$/.exec(v);
  if (!m) fail('invalid_args', { zh: 'scope 须为 "city"、"group:<社群ID>" 或 "place:<地点ID>"。', en: 'scope must be "city", "group:<group ID>" or "place:<place ID>".' });
  const [, kind, id] = m;
  if (kind === 'group') {
    if (!has(w.groups, id) || w.groups[id].dissolved) fail('not_found');
    return { kind, id };
  }
  if (!has(w.places, id)) fail('not_found');
  return { kind, id };
}

/** 试算用的临时规则集（不存进世界） */
function tempSet(w, scope, rules) {
  const base = { owner: 'draft', key: 'draft', rules };
  if (scope.kind === 'group') return { ...groupSet({ id: scope.id, bylaws: { rules }, vars: w.groups[scope.id].vars }), ...base, group: w.groups[scope.id] };
  if (scope.kind === 'place') return { ...placeSet({ id: scope.id, rules: { rules } }), ...base, place: w.places[scope.id] };
  return { ...citySet({ id: 'draft', rules }), ...base };
}

// TODO(spec): Q61 — P4 previews in validate; historical worlds still preview in apply.
function draftData(ctx, plan) {
  const { w, lang } = ctx;
  const pick = (i) => ({ path: i.path, code: i.code, message: lang === 'en' ? i.en : i.zh, ...(i.hint ? { hint: lang === 'en' ? i.hint.en : i.hint.zh } : {}) });
  const lookup = staticLookup(w);
  let data;
  if (plan.rules !== null) {
    const v = validateRules(plan.rules, { scope: { ...plan.scope, premise: w.premise || 0, prayers: prayersEnabled(w) }, lookup });
    if (!v.ok) data = { ok: false, errors: v.issues.map(pick), reading: null, preview: [] };
    else {
      const budget = usesLawVM2(w) ? lawDiagnostics(w, v.rules) : null;
      const scopeOpts = plan.scope.kind === 'group' ? { scope: { premise: w.premise || 0, prayers: prayersEnabled(w), kind: 'group', id: plan.scope.id } } : {};
      data = {
        ok: budget ? budget.ok : true,
        ...(budget ? { staticOk: true, budget } : {}),
        errors: [],
        reading: { rules: renderRules(v.rules, lang, scopeOpts) },
        preview: budget && !budget.ok ? [] : previewRules(w, tempSet(w, plan.scope, v.rules), { rng: rngCopy(w) }),
      };
    }
  } else {
    const v = validateProcedure(plan.procedure, { lookup });
    if (!v.ok) data = { ok: false, errors: v.issues.map(pick), reading: null, preview: [] };
    else {
      const budget = usesLawVM2(w) ? lawDiagnostics(w, [], v.procedure) : null;
      data = { ok: budget ? budget.ok : true, ...(budget ? { staticOk: true, budget } : {}), errors: [], reading: { procedure: renderProcedure(v.procedure, lang) }, preview: [] };
    }
  }
  return data;
}

const draft = {
  validate(ctx, args) {
    const { w } = ctx;
    const hasRules = given(args.rules);
    const hasProc = given(args.procedure);
    if (hasRules === hasProc) fail('invalid_args', { zh: 'draft 要给 rules 或 procedure 之一（不能都给，也不能都不给）。', en: 'draft takes either rules or procedure (not both, and not neither).' });
    const scope = parseScope(w, args.scope);
    if (hasProc && scope.kind !== 'city') fail('invalid_args', { zh: 'procedure 只能试算城法的立法程序。', en: 'A procedure can only be tried out as a city law.' });
    const plan = { rules: hasRules ? args.rules : null, procedure: hasProc ? args.procedure : null, scope, cost: ctx.cost(ACTIONS.draft.base) };
    if (tokenized(w)) { plan.data = draftData(ctx, plan); plan.thinking = jsonWeight(plan.data); }
    return plan;
  },
  apply(ctx, plan) {
    const { w, a, lang } = ctx;
    const data = tokenized(w) ? plan.data : draftData(ctx, plan);
    emit(w, 'draft', { vis: 'internal', agent: a.id, place: a.place, data: { ok: data.ok, scope: plan.scope.kind === 'city' ? 'city' : `${plan.scope.kind}:${plan.scope.id}` } });
    return data;
  },
};

// ── refound / sign ──────────────────────────────────────────

const refound = {
  validate(ctx, args) {
    const { w, a } = ctx;
    if (usesLawSemantics2(w) && !refoundElectorate(w).includes(a.id)) fail('not_eligible', { zh: '重订须入城满三日，且联署须在发起时资格名单内。', en: 'Refounding requires three days of residence; signing requires membership in the opening electorate.' });
    const text = needText(args.text, { max: LIMITS.refoundText });
    let procedure;
    if (args.procedure === 'humans') procedure = 'humans';
    else {
      if (!given(args.procedure) || typeof args.procedure !== 'object' || Array.isArray(args.procedure)) {
        fail('invalid_args', { zh: 'procedure 须为 "humans"，或含 ordinary 与 constitutional 两类的对象。', en: 'procedure must be "humans" or an object with both ordinary and constitutional.' });
      }
      const v = validateProcedure(args.procedure, { requireBoth: true, lookup: staticLookup(w) });
      if (!v.ok) ruleInvalid(v.issues);
      procedure = v.procedure;
    }
    admit(w, [], procedure);
    const today = clockDay(w);
    if (w.refoundCooldownUntil !== null && today < w.refoundCooldownUntil) {
      fail('cooldown', { zh: `重订之后的冷却期，到第 ${w.refoundCooldownUntil} 日。`, en: `Refounding is on cooldown until day ${w.refoundCooldownUntil}.` }, { untilDay: w.refoundCooldownUntil });
    }
    const open = openRefounds(w);
    if (open.length >= P.refoundsOpenMax || open.some((r) => r.by === a.id)) fail('limit_reached');
    return { text, procedure, cost: ctx.cost(ACTIONS.refound.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const r = openRefound(w, a, plan);
    return { refound: r.id, needed: refoundNeeded(w, r), expiresTick: r.expiresTick, ...(r.status !== 'open' ? { succeeded: r.status === 'succeeded' } : {}) };
  },
};


const sign = {
  validate(ctx, args) {
    const { w, a } = ctx;
    needId(args.refound);
    const r = has(w.refounds, args.refound) ? w.refounds[args.refound] : null;
    if (!r || r.status !== 'open') fail('not_found');
    if (usesLawSemantics2(w) && !r.electorate?.includes(a.id)) fail('not_eligible', { zh: '你不在此次重订发起时的资格名单内。', en: 'You are not in this refounding’s opening electorate.' });
    if (r.signers.includes(a.id)) fail('already');
    return { r, cost: ctx.cost(ACTIONS.sign.base) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    return signRefound(w, a, plan.r);
  },
};

// ── rules ───────────────────────────────────────────────────

/**
 * rules：设定社群章程（group + rules）、地点规则（place + rules）、改社群的程序（group + procedure）。
 * 谁来设定、怎么生效：
 *   社群章程 / 社群的程序  steward 程序：只有管事，立即生效；members 程序：任何成员，生成社群提案（成员多数决）
 *   地点规则              居民所有：只有主人，立即生效；社群所有：按社群的程序（管事立即设定，或成员发起提案）；全城所有：没有地点规则
 */
const rules = {
  validate(ctx, args) {
    const { w, a } = ctx;
    const hasPlace = given(args.place);
    const hasGroup = given(args.group);
    if (hasPlace === hasGroup) fail('invalid_args', { zh: 'rules 要给 place（地点规则）或 group（社群章程 / 程序）之一。', en: 'rules takes either place (place rules) or group (bylaws / procedure).' });
    const hasRules = given(args.rules);
    const hasProc = given(args.procedure);
    if (hasRules === hasProc) fail('invalid_args', { zh: 'rules 要给 rules（规则的数组，空数组废除）或 procedure（社群的程序）之一。', en: 'rules takes either rules (an array; an empty array repeals) or procedure (the group procedure).' });
    if (hasProc && hasPlace) fail('invalid_args', { zh: 'procedure 只能用来改社群的程序（给 group）。', en: 'procedure only changes a group\'s procedure (give group).' });
    const title = optText(args.title, { max: LIMITS.proposalTitle });
    const text = optText(args.text, { max: LIMITS.proposalText });
    if (title !== null && title.includes('\n')) fail('invalid_args');
    const lookup = staticLookup(w);
    const cost = ctx.cost(ACTIONS.rules.base);
    if (hasGroup) {
      const g = needGroup(w, args.group);
      const isMember = g.members.includes(a.id);
      if (g.procedure === 'steward') {
        if (g.steward !== a.id) fail('not_steward');
      } else if (!isMember) fail('not_member');
      let kind;
      let rs = null;
      let proc = null;
      if (hasProc) {
        if (typeof args.procedure !== 'string' || !GROUP_PROCEDURES.includes(args.procedure)) {
          fail('invalid_args', { zh: 'procedure 须为 "steward"（管事决定）或 "members"（成员多数决）。', en: 'procedure must be "steward" (the steward decides) or "members" (majority of members).' });
        }
        if (args.procedure === g.procedure) fail('already');
        kind = 'group_procedure';
        proc = args.procedure;
      } else {
        const v = validateRules(args.rules, { scope: { premise: w.premise || 0, prayers: prayersEnabled(w), kind: 'group', id: g.id }, lookup });
        if (!v.ok) ruleInvalid(v.issues);
        admit(w, v.rules, null, g.procedure === 'steward' ? g.id : null);
        kind = 'bylaws';
        rs = v.rules;
      }
      const direct = g.procedure === 'steward';
      if (!direct && openGroupProposals(w, g.id).length >= LIMITS.openProposalsPerGroup) fail('limit_reached');
      return { target: 'group', g, kind, rules: rs, procedure: proc, direct, title, text, cost };
    }
    const place = w.places[needPlace(w, args.place)];
    if (place.owner.kind === 'city') fail('not_owner', { zh: '全城所有的地点没有地点规则；先要有人成为它的主人。', en: 'A place that belongs to the whole city has no place rules; someone must own it first.' });
    if (place.razed) fail('not_allowed');
    let g = null;
    let direct = true;
    if (place.owner.kind === 'agent') {
      if (place.owner.id !== a.id) fail('not_owner');
    } else {
      g = w.groups[place.owner.id];
      if (g.procedure === 'steward') {
        if (!isOwnerOrSteward(w, place, a)) fail('not_owner');
      } else {
        if (!g.members.includes(a.id)) fail('not_owner');
        direct = false;
      }
    }
    const v = validateRules(args.rules, { scope: { premise: w.premise || 0, prayers: prayersEnabled(w), kind: 'place', id: place.id }, lookup });
    if (!v.ok) ruleInvalid(v.issues);
    admit(w, v.rules, null, direct ? place.id : null);
    if (!direct && openGroupProposals(w, g.id).length >= LIMITS.openProposalsPerGroup) fail('limit_reached');
    return { target: 'place', place, g, kind: 'place_rules', rules: v.rules, procedure: null, direct, title, text, cost };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const scope = plan.target === 'group' ? `group:${plan.g.id}` : `place:${plan.place.id}`;
    if (!plan.direct) {
      const dflt = a.lang === 'en'
        ? { bylaws: 'Bylaws', group_procedure: 'Group procedure', place_rules: 'Place rules' }
        : { bylaws: '章程', group_procedure: '社群的程序', place_rules: '地点规则' };
      const p = openGroupProposal(w, a, plan.g, {
        kind: plan.kind, title: plan.title ?? dflt[plan.kind], text: plan.text ?? '', rules: plan.rules, procedure: plan.procedure, place: plan.place ? plan.place.id : null,
      });
      return { scope, proposal: p.id };
    }
    const meta = { title: plan.title, text: plan.text };
    if (plan.kind === 'group_procedure') setGroupProcedure(w, plan.g, plan.procedure, a.id);
    else if (plan.kind === 'bylaws') setGroupBylaws(w, plan.g, plan.rules, a.id, meta);
    else setPlaceRulesOf(w, plan.place, plan.rules, a.id, meta);
    const holder = plan.kind === 'bylaws' ? plan.g.bylaws : plan.kind === 'place_rules' ? plan.place.rules : null;
    return { scope, ...(usesLawSemantics2(w) ? { enact: structuredClone(holder?.enact || { status: 'no_enact', diagnostics: [] }), results: holder?.results || [] } : {}) };
  },
};

export const politicsHandlers = { propose, vote, draft, refound, sign, rules };
