// SPEC-E2 §4.5、§8.3–§8.4：法律——生成、分类、立法程序的取代、撤销、读法。
//
// 一部法律是文字加规则（或一部立法程序）：
//   Law { id, title, text, i18n, author, rules, procedure, class, basedOn, fingerprints, proposalId, enactedTick,
//         status, repealedBy, replacedBy, paidThrough, suspendedDays, results }
// 本文件只管法律这个对象本身；规则的执行在 rules.js，提案与表决在 legislation.js。

import { P } from '../params.js';
import { nextId, ruleDay, isAlive } from '../world.js';
import { fingerprintRules, fingerprintProcClass } from '../rules/fingerprint.js';
import { renderRules, renderProcedure } from '../rules/render.js';
import { emit, pushInbox } from './core.js';

export const CLASSES = Object.freeze(['ordinary', 'constitutional']);

/** 规则里是否有 amend 操作（含 each 里的） */
export function hasAmend(rules) {
  const walk = (ops) => ops.some((o) => o.op === 'amend' || (o.op === 'each' && walk(o.do)));
  return rules.some((r) => walk(r.do));
}

/** 提案 / 法律的类别：含 procedure，或任何规则里有 amend 操作 → 修宪级（constitutional）；否则普通（ordinary） */
export function classify(rules, procedure) {
  return procedure || (rules && hasAmend(rules)) ? 'constitutional' : 'ordinary';
}

/** 一条规则的时机是否「持续生效」（要付维持费）：daily monthly before:* after:* on:*；enact 不算 */
export const isPersistent = (rule) => rule.when.trim() !== 'enact';

/** 一组规则里带持续时机的规则数 */
export const persistentCount = (rules) => rules.filter(isPersistent).length;

/** 一组规则里有没有 announce 操作（含 each 的 do 之内，递归；SPEC-P2 §4.2） */
const opsAnnounce = (ops) => (ops || []).some((op) => op.op === 'announce' || (op.op === 'each' && opsAnnounce(op.do)));
export const hasAnnounce = (rules) => (rules || []).some((rule) => opsAnnounce(rule.do));

/** 法律是不是一部立法程序（载荷里只有 procedure） */
export const isProcedureLaw = (law) => !!law.procedure;

/**
 * 生成一部法律并放进世界（不执行它的 enact）。
 * 参数：{ title, text, i18n?, author, rules?, procedure?, basedOn?, proposalId? }；rules / procedure 须已通过校验。
 * paidThrough = 今日（生效当日视为已付，§7.9；「今日」的含义见 world.js 的 ruleDay）。
 */
export function createLaw(w, { title, text, i18n = null, author, rules = [], procedure = null, basedOn = null, proposalId = null }) {
  const id = nextId(w, 'l');
  const fingerprints = procedure
    ? CLASSES.filter((c) => procedure[c]).map((c) => fingerprintProcClass(procedure[c]))
    : fingerprintRules(rules);
  const law = {
    id,
    title,
    text,
    i18n,
    author,
    rules,
    procedure,
    class: classify(rules, procedure),
    basedOn,
    fingerprints,
    proposalId,
    enactedTick: w.clock.tick,
    status: 'active',
    repealedBy: null,
    replacedBy: null,
    paidThrough: ruleDay(w),
    suspendedDays: 0,
    results: [],
  };
  w.laws[id] = law;
  return law;
}

// ── 立法程序 ────────────────────────────────────────────────

/** 某一类当前生效的程序（ProcClass）；没有返回 null */
export function procSpec(w, cls) {
  const id = w.procedure[cls];
  const law = id ? w.laws[id] : null;
  return law && law.procedure && law.procedure[cls] ? law.procedure[cls] : null;
}

/**
 * 让一部程序法律生效：对它写到的每一类，旧的程序法律若不再管辖任何一类，状态改为 replaced；
 * w.procedure[类] = 新法律，revertWatch[类] = 0；向全体在世居民发收件 procedure（每类一条）。
 * reason：enacted | reverted | refounded。
 */
export function installProcedure(w, law, reason) {
  const replaced = new Set();
  const classes = CLASSES.filter((c) => law.procedure[c]);
  const events = [];
  for (const c of classes) {
    const oldId = w.procedure[c];
    if (oldId && oldId !== law.id) replaced.add(oldId);
    events.push({ cls: c, oldId });
    w.procedure[c] = law.id;
    w.revertWatch[c] = 0;
  }
  const retired = new Set();
  for (const oldId of replaced) {
    const old = w.laws[oldId];
    if (!Object.values(w.procedure).includes(oldId) && old.status === 'active') {
      old.status = 'replaced';
      old.replacedBy = law.id;
      retired.add(oldId);
    }
  }
  for (const { cls, oldId } of events) {
    if (oldId && oldId !== law.id) emit(w, 'law_replaced', { data: { lawId: oldId, class: cls, by: law.id, retired: retired.has(oldId) } });
    w.dayLog.procedureChanges.push({ class: cls, lawId: law.id, reason });
    for (const a of Object.values(w.agents)) {
      if (isAlive(a)) pushInbox(w, a, 'procedure', { class: cls, lawId: law.id, reason });
    }
  }
}

// ── 撤销 ────────────────────────────────────────────────────

/** 撤销一部在效的城法（rules 的 repeal 操作）：状态改为 repealed，移除它施加的铭刻保护 */
export function repealLaw(w, target, byLawId) {
  target.status = 'repealed';
  target.repealedBy = byLawId;
  for (const ins of Object.values(w.inscriptions)) {
    if (ins.protectedBy.includes(target.id)) ins.protectedBy = ins.protectedBy.filter((x) => x !== target.id);
  }
}

// ── 查询 ────────────────────────────────────────────────────

/** 在效的城法，按 ID 数字升序 */
export function activeLaws(w) {
  return Object.values(w.laws).filter((l) => l.status === 'active');
}

/** 一部法律（或章程、地点规则）今日是否停摆：维持费没有付到今天 */
export const isSuspended = (w, holder) => holder.paidThrough < ruleDay(w);

// ── 读法 ────────────────────────────────────────────────────

const L2 = (lang) => (lang === 'en' ? 'en' : 'zh');

/** 法律的标题（按语言；遗法与系统法律有 i18n） */
export function lawTitle(law, lang = 'zh') {
  const l = L2(lang);
  return law.i18n && law.i18n[l] ? law.i18n[l].title : law.title;
}

/** 法律的正文（按语言） */
export function lawText(law, lang = 'zh') {
  const l = L2(lang);
  return law.i18n && law.i18n[l] ? law.i18n[l].text : law.text;
}

/** 法律的作者的显示：'humans' | 'revert' | 'refound:<r>' | { id, name } */
export function authorView(w, author) {
  if (author === 'humans' || author === 'revert' || (typeof author === 'string' && author.startsWith('refound:'))) return author;
  const a = w.agents[author];
  return a ? { id: a.id, name: a.name } : { id: author, name: author };
}

/** 引擎读法：{ rules: [string…] } 或 { procedure: { ordinary?, constitutional? } } */
export function lawReading(law, lang = 'zh') {
  const l = L2(lang);
  if (law.procedure) return { procedure: renderProcedure(law.procedure, l) };
  return { rules: renderRules(law.rules, l) };
}

/** read { law } 的返回：法律的全文、规则、引擎读法 */
export function lawView(w, law, lang = 'zh') {
  return {
    id: law.id,
    title: lawTitle(law, lang),
    text: lawText(law, lang),
    author: authorView(w, law.author),
    class: law.class,
    status: law.status,
    enactedDay: Math.floor(law.enactedTick / P.ticksPerDay),
    basedOn: law.basedOn,
    suspended: law.status === 'active' && !isProcedureLaw(law) && isSuspended(w, law) && persistentCount(law.rules) > 0,
    rules: law.rules,
    procedure: law.procedure,
    reading: lawReading(law, lang),
    fingerprints: law.fingerprints,
    ...(law.repealedBy ? { repealedBy: law.repealedBy } : {}),
    ...(law.replacedBy ? { replacedBy: law.replacedBy } : {}),
  };
}
