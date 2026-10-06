import { prayersEnabled } from './prayer-rewards.js';
// SPEC-E2 §8–§9：立法——遗法、提案、表决、计票与生效、自动回退、重订。
//
// 立法程序是一部特殊的法律：它的载荷里只有 procedure（PROTOCOL-2 §6.8），每一类（普通 / 修宪级）有自己的
// proposers / voters / weight / period / secret / decide 六个字段。提案提出时固定表决者与程序的副本（spec）；
// 计票时只计仍在世者的票，权重与「通过」条件用提出时的程序求值。
//
// 本文件有一部分在创建世界（genesis）、每刻（计票、到期的重订）与每日（自动回退）里被调用；
// 动作（propose vote refound sign）本身在 actions/politics.js。

import { P } from '../params.js';
import { budgetForExpression } from './law-execution.js';
import { nextId, clockDay, isAlive } from '../world.js';
import { onGenesis } from '../genesis.js';
import { HUMAN_LAWS, HUMAN_PROCEDURE, SYSTEM_LAW_TEXT } from '../lore/humanlaws.js';
import { validateRules, validateProcedure } from '../rules/check.js';
import { parseCached } from '../rules/parser.js';
import { evaluate, agentRef, asBool, asInt } from '../rules/eval.js';
import { RuleError } from '../rules/errors.js';
import { fingerprintProcClass } from '../rules/fingerprint.js';
import { renderRules, renderProcedure } from '../rules/render.js';
import { emit, pushInbox } from './core.js';
import { makeHost } from './rulehost.js';
import { CLASSES, createLaw, installProcedure, procSpec } from './laws.js';
import { citySet, runEnact } from './rules.js';
import { hooks } from './hooks.js';
import { STEPS } from './tick.js';

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ═══════════════════════════════════════════════════════════════
// 遗法（创建世界时）
// ═══════════════════════════════════════════════════════════════

/** 创建世界时：依次生成遗法 l1–l6，执行它们的 enact（不产生事件），设 w.procedure */
export function seedHumanLaws(w) {
  for (const def of HUMAN_LAWS) {
    let rules = [];
    let procedure = null;
    if (def.rules) {
      const v = validateRules(structuredClone(def.rules), { scope: { premise: w.premise || 0, prayers: prayersEnabled(w), kind: 'city' }, human: true });
      if (!v.ok) throw new Error(`human law ${def.id} is invalid: ${JSON.stringify(v.issues)}`);
      rules = v.rules;
    }
    if (def.procedure) {
      const v = validateProcedure(structuredClone(def.procedure));
      if (!v.ok) throw new Error(`human law ${def.id} procedure is invalid: ${JSON.stringify(v.issues)}`);
      procedure = v.procedure;
    }
    const law = createLaw(w, {
      title: def.title,
      text: def.text,
      i18n: { zh: { title: def.title, text: def.text }, en: def.en },
      author: 'humans',
      rules,
      procedure,
    });
    if (law.id !== def.id) throw new Error(`human law id mismatch: ${law.id} vs ${def.id}`);
    law.paidThrough = 0;
  }
  w.procedure = { ordinary: 'l1', constitutional: 'l1' };
  for (const law of Object.values(w.laws)) {
    if (!law.procedure && law.rules.length > 0) law.results = runEnact(w, citySet(law), { quiet: true });
  }
}

onGenesis(seedHumanLaws);

// ═══════════════════════════════════════════════════════════════
// 校验的辅助
// ═══════════════════════════════════════════════════════════════

/** 静态校验时核对字面引用用的查询（SPEC-E2 §7.8 第 6 条） */
export function staticLookup(w) {
  return {
    place: (id) => has(w.places, id),
    group: (id) => has(w.groups, id) && !w.groups[id].dissolved,
    law: (id) => (has(w.laws, id) ? { active: w.laws[id].status === 'active', isProcedure: !!w.laws[id].procedure } : null),
    inscription: (id) => has(w.inscriptions, id),
  };
}

/** 校验问题 → 动作级错误 rule_invalid 的 hint（中英文各一段，最多 5 条） */
export function issuesHint(issues) {
  const line = (lang) => (i) => {
    const text = lang === 'en' ? i.en : i.zh;
    const hint = i.hint ? (lang === 'en' ? i.hint.en : i.hint.zh) : '';
    return `${i.path}: ${text}${hint ? ` (${hint})` : ''}`;
  };
  return { zh: issues.map(line('zh')).join('\n'), en: issues.map(line('en')).join('\n') };
}

// ═══════════════════════════════════════════════════════════════
// 程序表达式的求值
// ═══════════════════════════════════════════════════════════════

/**
 * 求程序的一个表达式（proposers / voters / weight / decide）。出错抛 RuleError。
 * env：名字（actor、it、yes…）；rng：sample 用的随机数流（缺省 w.rng.world；校验与健康检查传副本）。
 */
export function evalProc(w, expr, env, { rng } = {}) {
  const tree = parseCached(expr);
  return evaluate(tree, makeHost(w, { rng: rng || w.rng.world }), env, budgetForExpression(w, tree));
}

/** 提案者资格：以 actor 求 proposers；为假或出错 → false */
export function mayPropose(w, spec, actor, rng) {
  try {
    return asBool(evalProc(w, spec.proposers, { actor: agentRef(actor.id) }, { rng }), 'proposers') === true;
  } catch (e) {
    if (e instanceof RuleError) return false;
    throw e;
  }
}

/** 表决者名单：求 voters；出错或不是居民列表返回 null。返回居民 ID 的数组（升序） */
export function votersOf(w, spec, rng) {
  try {
    const list = evalProc(w, spec.voters, {}, { rng });
    if (!Array.isArray(list)) return null;
    return list.filter((x) => x && x.$ === 'agent').map((x) => x.id);
  } catch (e) {
    if (e instanceof RuleError) return null;
    throw e;
  }
}

/** 随机数流的副本（校验与健康检查时用，不推进真正的流） */
export const rngCopy = (w) => w.rng.world.slice();

// ═══════════════════════════════════════════════════════════════
// 提案
// ═══════════════════════════════════════════════════════════════

/** 城里进行中的提案 */
export const openCityProposals = (w) => Object.values(w.proposals).filter((p) => p.status === 'open' && p.scope === 'city');

/** 引擎读法（中英文）：提案或法律的规则 / 程序 */
export function readingsOf({ rules, procedure }) {
  return {
    zh: procedure ? { procedure: renderProcedure(procedure, 'zh') } : { rules: renderRules(rules, 'zh') },
    en: procedure ? { procedure: renderProcedure(procedure, 'en') } : { rules: renderRules(rules, 'en') },
  };
}

/** 提出一个城的提案（提案者已通过各项校验并付过代价）。plan 来自 propose.validate */
export function openProposal(w, a, plan) {
  const id = nextId(w, 'p');
  const p = {
    id,
    scope: 'city',
    title: plan.title,
    text: plan.text,
    rules: plan.rules,
    procedure: plan.procedure,
    basedOn: plan.basedOn,
    kind: 'law',
    class: plan.cls,
    spec: structuredClone(plan.spec),
    proposer: a.id,
    openedTick: w.clock.tick,
    closesTick: w.clock.tick + plan.spec.period,
    voters: plan.voters,
    secret: plan.spec.secret,
    votes: {},
    status: 'open',
    tally: null,
    lawId: null,
  };
  w.proposals[id] = p;
  w.dayLog.proposals++;
  emit(w, 'propose', {
    agent: a.id,
    place: a.place,
    data: {
      proposalId: id, scope: 'city', title: p.title, text: p.text, class: p.class, rules: p.rules, procedure: p.procedure,
      basedOn: p.basedOn, reading: readingsOf(p), closesTick: p.closesTick, voters: p.voters.length, secret: p.secret,
    },
  });
  return p;
}

// ═══════════════════════════════════════════════════════════════
// 计票与生效（每刻第 3 步）
// ═══════════════════════════════════════════════════════════════

function reportProcError(w, cls, field, e) {
  w.dayLog.ruleErrors++;
  emit(w, 'rule_error', { data: { scope: 'city', owner: w.procedure[cls] || '', rule: field, code: e.code, detail: e.detail || '' } });
}

/** 通知提案者与投过票的人（仍在世者）：收件 law */
function notifyResult(w, p, result) {
  const who = new Set([p.proposer, ...Object.keys(p.votes)]);
  for (const id of who) {
    const a = w.agents[id];
    if (a && isAlive(a)) pushInbox(w, a, 'law', { proposalId: p.id, lawId: p.lawId, result, title: p.title });
  }
}

/**
 * 计票（§8.3）：
 *   在世表决者 = voters 中醒着或沉睡的；weight(v) = 以 it = v 求 spec.weight（负数或出错按 0）；
 *   yes / no / abstain = 投了相应选择的在世表决者的权重之和；voted = 三者之和；total = 全部在世表决者的权重之和；
 *   turnout = total > 0 ? floor(voted × 1000 / total) : 0；passed = 求 spec.decide（出错 → 否决）。
 * 返回 { tally, passed }
 */
export function computeTally(w, p, onError) {
  const spec = p.spec;
  const live = p.voters.filter((id) => w.agents[id] && isAlive(w.agents[id]));
  let yes = 0;
  let no = 0;
  let abstain = 0;
  let total = 0;
  for (const id of live) {
    let weight = 0;
    try {
      weight = Math.max(0, asInt(evalProc(w, spec.weight, { it: agentRef(id) }), 'weight'));
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      onError('weight', e);
    }
    total += weight;
    const v = p.votes[id];
    if (!v) continue;
    if (v.choice === 'yes') yes += weight;
    else if (v.choice === 'no') no += weight;
    else abstain += weight;
  }
  const voted = yes + no + abstain;
  const turnout = total > 0 ? Math.floor((voted * 1000) / total) : 0;
  const tally = { yes, no, abstain, voted, total, turnout };
  let passed = false;
  try {
    passed = asBool(evalProc(w, spec.decide, { yes, no, abstain, voted, total, turnout }), 'decide') === true;
  } catch (e) {
    if (!(e instanceof RuleError)) throw e;
    onError('decide', e);
  }
  return { tally, passed };
}

function settleCityProposal(w, p) {
  const { tally, passed } = computeTally(w, p, (field, e) => reportProcError(w, p.class, field, e));
  p.tally = tally;
  if (passed) enactProposal(w, p);
  else rejectProposal(w, p);
}

function rejectProposal(w, p) {
  p.status = 'rejected';
  w.dayLog.rejected++;
  w.dayLog.laws.push({ proposalId: p.id, title: p.title, passed: false, yes: p.tally.yes, no: p.tally.no, lawId: null });
  emit(w, 'law_rejected', { data: { proposalId: p.id, class: p.class, tally: p.tally } });
  hooks.fire(w, 'law_rejected', { law: null });
  notifyResult(w, p, 'rejected');
}

/** 通过：生成法律；若是程序，取代那一类原来的程序；执行 enact；事件 law_passed（触发 on:law_passed） */
function enactProposal(w, p) {
  p.status = 'passed';
  const law = createLaw(w, { title: p.title, text: p.text, author: p.proposer, rules: p.rules, procedure: p.procedure, basedOn: p.basedOn, proposalId: p.id });
  p.lawId = law.id;
  w.dayLog.passed++;
  w.dayLog.laws.push({ proposalId: p.id, title: p.title, passed: true, yes: p.tally.yes, no: p.tally.no, lawId: law.id });
  if (law.procedure) installProcedure(w, law, 'enacted');
  else if (law.rules.length > 0) law.results = runEnact(w, citySet(law));
  emit(w, 'law_passed', { data: { proposalId: p.id, lawId: law.id, class: law.class, tally: p.tally, results: law.results } });
  hooks.fire(w, 'law_passed', { law: law.id });
  notifyResult(w, p, 'passed');
}

/** 每刻第 3 步：按 ID 升序处理 closesTick ≤ 当前刻的提案（城的与社群的） */
export function tallyProposals(w) {
  for (const p of Object.values(w.proposals)) {
    if (p.status !== 'open' || p.closesTick > w.clock.tick) continue;
    if (p.scope === 'city') settleCityProposal(w, p);
    else settleGroupProposal(w, p);
  }
}

/** 社群提案的计票（第 5 步实现） */
let settleGroupProposal = () => {};
export function setGroupProposalSettler(fn) {
  settleGroupProposal = fn;
}

STEPS.tallyProposals = tallyProposals;

// ═══════════════════════════════════════════════════════════════
// 自动回退（每日第 10 步）
// ═══════════════════════════════════════════════════════════════

/** 一类程序是否「可用」：醒着的居民里有人能提案，且表决者名单求值不出错、不为空 */
function procedureUsable(w, spec) {
  const awake = Object.values(w.agents).filter((a) => a.status === 'awake');
  const canPropose = awake.some((a) => mayPropose(w, spec, a, rngCopy(w)));
  if (!canPropose) return false;
  const voters = votersOf(w, spec, rngCopy(w));
  return voters !== null && voters.length > 0;
}

/**
 * 每日结算第 10 步：对每一类，连续 autoRevertDays 日没有合格的提出者或表决者，这一类回到人类的程序（遗法 l1 的原始版本）。
 * 写着 { none: true } 的不回退。
 */
export function autoRevert(w) {
  for (const cls of CLASSES) {
    const spec = procSpec(w, cls);
    if (!spec || spec.none) {
      w.revertWatch[cls] = 0;
      continue;
    }
    if (procedureUsable(w, spec)) {
      w.revertWatch[cls] = 0;
      continue;
    }
    w.revertWatch[cls] += 1;
    if (w.revertWatch[cls] < P.autoRevertDays) continue;
    // TODO(spec): Q16 —— 当前程序已经就是人类的原始版本时没有可回退的，不再生成重复的法律
    if (fingerprintProcClass(spec) === fingerprintProcClass(HUMAN_PROCEDURE[cls])) {
      w.revertWatch[cls] = 0;
      continue;
    }
    const sys = SYSTEM_LAW_TEXT.revert;
    const law = createLaw(w, {
      title: sys.zh.title,
      text: sys.zh.text,
      i18n: { zh: sys.zh, en: sys.en },
      author: 'revert',
      procedure: { [cls]: structuredClone(HUMAN_PROCEDURE[cls]) },
    });
    installProcedure(w, law, 'reverted');
    w.dayLog.reverts++;
    emit(w, 'procedure_reverted', { data: { class: cls, lawId: law.id } });
  }
}

STEPS.revert = (w) => autoRevert(w);

// ═══════════════════════════════════════════════════════════════
// 重订（§8.6）
// ═══════════════════════════════════════════════════════════════

export const openRefounds = (w) => Object.values(w.refounds).filter((r) => r.status === 'open');

/** 入城满 refoundResidenceDays 的在世居民数（重订的分母） */
export function refoundResidents(w) {
  const today = clockDay(w);
  return Object.values(w.agents).filter((a) => isAlive(a) && a.bornDay <= today - P.refoundResidenceDays).length;
}

/** 重订所需的联署数：ceil(2n / 3)；n 为 0 时不可能成功（返回 null） */
export function refoundNeeded(w) {
  const n = refoundResidents(w);
  return n === 0 ? null : Math.ceil((2 * n) / 3);
}

/** 仍在世的联署者 */
export const liveSigners = (w, r) => r.signers.filter((id) => w.agents[id] && isAlive(w.agents[id]));

/** 发起一次重订（发起者已通过各项校验并付过代价）：发起者自动联署，向全体在世居民发收件 refound（opened），然后检查 */
export function openRefound(w, a, { text, procedure }) {
  const id = nextId(w, 'r');
  const r = {
    id,
    by: a.id,
    text,
    procedure,
    openedTick: w.clock.tick,
    expiresTick: w.clock.tick + P.refoundWindowTicks,
    signers: [a.id],
    status: 'open',
  };
  w.refounds[id] = r;
  const proc = procedure === 'humans' ? structuredClone(HUMAN_PROCEDURE) : procedure;
  emit(w, 'refound_open', {
    agent: a.id,
    place: a.place,
    data: {
      refoundId: id, by: a.id, text, procedure: procedure === 'humans' ? 'humans' : procedure,
      reading: { zh: renderProcedure(proc, 'zh'), en: renderProcedure(proc, 'en') }, needed: refoundNeeded(w), expiresTick: r.expiresTick,
    },
  });
  for (const o of Object.values(w.agents)) if (isAlive(o)) pushInbox(w, o, 'refound', { refoundId: id, event: 'opened' });
  checkRefound(w, r);
  return r;
}

/** 联署（已校验）：追加联署者，事件 refound_sign，然后立即检查。返回 { signers, needed, succeeded } */
export function signRefound(w, a, r) {
  r.signers.push(a.id);
  emit(w, 'refound_sign', { agent: a.id, place: a.place, data: { refoundId: r.id, signer: a.id, signers: r.signers.length } });
  const succeeded = checkRefound(w, r);
  return { signers: r.signers.length, needed: refoundNeeded(w), succeeded };
}

/** 检查：在世的联署者 ≥ needed → 成功。返回是否成功 */
export function checkRefound(w, r) {
  if (r.status !== 'open') return false;
  const needed = refoundNeeded(w);
  if (needed === null || liveSigners(w, r).length < needed) return false;
  succeedRefound(w, r, needed);
  return true;
}

function succeedRefound(w, r, needed) {
  r.status = 'succeeded';
  const proc = r.procedure === 'humans' ? structuredClone(HUMAN_PROCEDURE) : structuredClone(r.procedure);
  const sys = SYSTEM_LAW_TEXT.refound;
  const law = createLaw(w, {
    title: sys.zh.title,
    text: r.text,
    i18n: { zh: { title: sys.zh.title, text: r.text }, en: { title: sys.en.title, text: r.text } },
    author: `refound:${r.id}`,
    procedure: proc,
  });
  installProcedure(w, law, 'refounded');
  for (const o of Object.values(w.refounds)) if (o.id !== r.id && o.status === 'open') o.status = 'void';
  w.refoundCooldownUntil = clockDay(w) + P.refoundCooldownDays;
  w.dayLog.refounds.push({ refoundId: r.id, signers: liveSigners(w, r).length });
  emit(w, 'refounded', { data: { refoundId: r.id, by: r.by, lawId: law.id, signers: liveSigners(w, r).length, needed } });
  for (const o of Object.values(w.agents)) if (isAlive(o)) pushInbox(w, o, 'refound', { refoundId: r.id, event: 'succeeded' });
}

/** 每刻第 4 步：到期的重订改为 expired，事件 refound_expired，向联署者发收件 */
export function expireRefounds(w) {
  for (const r of Object.values(w.refounds)) {
    if (r.status !== 'open' || r.expiresTick > w.clock.tick) continue;
    r.status = 'expired';
    emit(w, 'refound_expired', { data: { refoundId: r.id, signers: r.signers.length } });
    for (const id of r.signers) {
      const a = w.agents[id];
      if (a && isAlive(a)) pushInbox(w, a, 'refound', { refoundId: r.id, event: 'expired' });
    }
  }
}

STEPS.expireRefounds = expireRefounds;
