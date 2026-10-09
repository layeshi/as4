import { tokenized } from './e2/world.js';
import { L as tokenLore, fmt as tokenFmt } from './e2/lore/index.js';
// Response-only diagnostics: never mutate engine results or persisted history.
import { LIMITS, P } from './e2/params.js';
import { normalizeText, cpLength } from './text.js';

/**
 * 第二前提的反馈（SPEC-P2 §13、附录 A.9）：只在 premise >= 2 的世界里加，其余世界的结果逐字节不变。
 * F4b 的字段到 LIMITS 的对应：每个动作的文本字段，按引擎校验的顺序；上限取引擎实际用的那一项（remember 在设定 1 之后用 P.memoryCpMax）。
 */
const TEXT_FIELDS = {
  say: [['text', () => LIMITS.speech]], whisper: [['text', () => LIMITS.speech]], broadcast: [['text', () => LIMITS.speech]],
  remember: [['text', () => P.memoryCpMax]], diary: [['text', () => LIMITS.diary]],
  write: [['title', () => LIMITS.docTitle], ['body', () => LIMITS.docBody]],
  define: [['word', () => LIMITS.word], ['meaning', () => LIMITS.meaning]],
  propose: [['title', () => LIMITS.proposalTitle], ['text', () => LIMITS.proposalText]],
  refound: [['text', () => LIMITS.refoundText]],
  found: [['name', () => LIMITS.name], ['manifesto', () => LIMITS.manifesto]],
  inscribe: [['text', () => LIMITS.inscription]], epitaph: [['text', () => LIMITS.epitaph]],
  will: [['lastWords', () => LIMITS.lastWords]],
  declare: [['purpose', () => LIMITS.purpose], ['bio', () => LIMITS.bio]],
  offer: [['note', () => LIMITS.note]], give: [['note', () => LIMITS.note]],
  vote: [['reason', () => LIMITS.reason]],
  conceive: [['name', () => LIMITS.name]],
};

const READ_EXAMPLE = {
  zh: ' 例：{"type":"read","law":"l8"}。待表决的提案用 look proposal 看读法，不用 read。',
  en: ' Example: {"type":"read","law":"l8"}. To see an open proposal\'s reading, use look proposal, not read.',
};

/** 失败的动作结果的补充（F4a：read 的用法提示加一个例子；F4b：text_too_long 说清楚是哪一项、上限与现在的长度） */
function errorFeedback(r, lang, act) {
  const e = r.error;
  if (e.code === 'invalid_args' && r.type === 'read' && typeof e.message === 'string') return { ...r, error: { ...e, message: `${e.message}${READ_EXAMPLE[lang === 'en' ? 'en' : 'zh']}` } };
  if (e.code === 'text_too_long' && e.limit === undefined && act && typeof act === 'object') {
    for (const [field, limit] of TEXT_FIELDS[r.type] || []) {
      const text = normalizeText(act[field]);
      if (text !== null && cpLength(text) > limit()) return { ...r, error: { ...e, field, limit: limit(), actual: cpLength(text) } };
    }
  }
  return r;
}

/** F5b：draft 的规则带持续时机（daily、monthly、before:、after:、on:——enact 不算）时，写上通过后每日要付的维持费 */
function costNote(act, lang, tokens) {
  const rules = act && Array.isArray(act.rules) ? act.rules : [];
  const n = (tokens?.ruleUpkeep ?? P.ruleUpkeep) * rules.filter((rule) => rule && typeof rule.when === 'string' && rule.when.trim() !== 'enact').length;
  if (!n) return null;
  if (tokens) return lang === 'en' ? `${n} tokens a day to keep once enacted` : `通过后每日维持 ${n} 词元`;
  return lang === 'en' ? `${n} energy a day to keep once enacted` : `通过后每日维持 ${n} 能量`;
}

/**
 * 动作结果的补充说明。opts：{ premise?, act? }——世界的设定版本与原来的动作；premise 小于 2 时（缺省）只有原来的 draft 诊断，逐字节不变。
 */
export function actionFeedback(r, lang = 'zh', { premise = 0, act, tokenValues } = {}) {
  if (tokenized({ premise }) && !r.ok && ['tokens_exhausted', 'cap_reached'].includes(r.error?.code)) return { ...r, error: { ...r.error, message: tokenFmt(tokenLore(lang).errors[r.error.code], r.error) } };
  if (premise >= 2 && !r.ok && r.error) return errorFeedback(r, lang, act);
  if (r.type !== 'draft' || !r.ok || !r.data) return r;
  const data = r.data;
  const runtimeErrors = (data.preview || []).filter(p => p.error).map(p => ({
    path: `rules[${p.rule}]`, code: p.error, message: p.detail,
  }));
  const staticOk = data.staticOk ?? data.ok;
  const costErrors = data.budget?.ok === false ? (data.budget.issues || []).map(i => ({ path: i.path, code: i.code, message: lang === 'en' ? 'The cost proof did not fit the supported capacity.' : '成本证明未满足平台支持的计算容量。' })) : [];
  const note = premise >= 2 && data.reading ? costNote(act, lang, tokenized({ premise }) ? tokenValues : undefined) : null;
  return { ...r, data: { ...data, staticOk, previewOk: staticOk && runtimeErrors.length === 0,
    ok: staticOk && runtimeErrors.length === 0 && costErrors.length === 0,
    errors: [...(data.errors || []), ...runtimeErrors, ...costErrors],
    ...(runtimeErrors.length ? { diagnostic: lang === 'en'
      ? 'Preview failed. Operations in one rule read the state before that rule: set is not visible to later expressions in the same do. Split dependent calculations into separate rules or inline expressions.'
      : '试算失败。同一条规则的所有表达式读取该规则执行前的状态：同一 do 中前面的 set 对后面的表达式不可见。请拆成独立规则或直接展开表达式。' } : {}),
    ...(note ? { costNote: note } : {}),
  } };
}
