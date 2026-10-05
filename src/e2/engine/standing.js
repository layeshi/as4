// SPEC-P2 §5.4：常驻指令的执行——每刻结算的新一步（6.5），在日终结算之后、沙盘脑之前。
//
// 城按居民 ID 升序，替醒着的居民执行它们的指令。设定（动作 standing，actions/standing.js）与执行都在命令之内（tick 命令），
// 回放一致；不用墙钟、不新增随机流（条件里的 sample 用世界已有的随机数流，和规则一样）。
// 执行的动作与亲手做的一样：付代价、占本刻的名额、受法律约束（before: / after: 照常触发，actor 是本人）；失败也占名额。
// 别的居民看到的只是普通的事件，分不出哪些动作是自动的；观测者从延迟公开的事件 standing_fired 看得到。

import { P } from '../params.js';
import { agentList, clockDay } from '../world.js';
import { normalizeText } from '../../text.js';
import { pushInbox, emit } from './core.js';
import { evaluate, newBudget, asBool, agentRef, isRef } from '../rules/eval.js';
import { parseCached } from '../rules/parser.js';
import { RuleError, RuleSyntaxError } from '../rules/errors.js';
import { makeHost } from './rulehost.js';
import { runActions, actionsLeft } from './actions.js';
import { plainRecord, hereOf } from './rules.js';
import { STEPS } from './tick.js';

/** 求值器抛出的规则错误（代码与 rule_error 事件同一组）；语法错误在设定时已排除，这里也一并当作规则错误，免得它拖垮整个 tick */
const isRuleError = (e) => e instanceof RuleError || e instanceof RuleSyntaxError;

/** 表达式的源文本 → 语法树（带缓存，不进世界状态）；设定时按规范化后的文本检查过，这里同样规范化 */
const parsed = (src) => parseCached(normalizeText(src));

/** 一条收件是否触发 inbox:<类别> 的指令（SPEC-P2 §5.4）：group 只算有人申请加入 */
function matchesTrigger(it, kind) {
  if (kind === 'group') return it.kind === 'group' && it.event === 'request';
  return it.kind === kind;
}

/**
 * 求 = 开头的参数：整数、真假、字符串、null 直接用；居民、社群、灵魂（与城公库）的引用换成它的 ID；记录或列表是 type 规则错误。
 * 其余的值照字面（深拷贝：动作的处理函数可能把参数里的对象存进世界）。
 */
function materialize(act, host, env, budget) {
  const out = structuredClone(act);
  for (const [k, v] of Object.entries(act)) {
    if (k === 'type' || typeof v !== 'string' || !v.startsWith('=')) continue;
    const val = evaluate(parsed(v.slice(1)), host, env, budget);
    if (val === null || typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') out[k] = val;
    else if (isRef(val)) out[k] = val.id;
    else throw new RuleError('type', `参数 ${k} 的值必须是整数、真假、字符串、null 或居民、社群、灵魂的引用`);
  }
  return out;
}

/** 一次触发的结果：给本人一条收件 standing，另发一条延迟公开的事件 standing_fired（SPEC-P2 §5.7） */
function report(w, a, i, trigger, { results, skipped = 0, error }) {
  const compact = (r) => (r.ok
    ? { type: r.type, ok: true, cost: r.cost, ...(r.data !== undefined ? { data: structuredClone(r.data) } : {}) }
    : { type: r.type, ok: false, error: { code: r.error.code } });
  const extra = { ...(skipped ? { skipped } : {}), ...(error ? { error } : {}) };
  pushInbox(w, a, 'standing', { order: i, trigger, results: results.map(compact), ...extra });
  emit(w, 'standing_fired', {
    vis: 'delayed', agent: a.id, place: a.place,
    data: { order: i, trigger, results: results.map((r) => ({ type: r.type, ok: r.ok, ...(r.ok ? {} : { error: r.error.code }) })), ...extra },
  });
}

/** 触发一次：条件为假既不计次也不发收件；求值出错记录、指令保留；本刻的名额用完时跳过并记录 */
function fireOrder(w, a, i, o, it) {
  const trigger = { when: o.when, ...(it ? { seq: it.seq } : {}) };
  // Q36 B：只在求值环境里补真假字段，不改署名私语的收件或事件格式。
  const item = it?.kind === 'whisper' ? { ...it, anonymous: it.anonymous === true } : it;
  const env = { me: agentRef(a.id), left: actionsLeft(a), here: hereOf(w, a.place), ...(item ? { it: plainRecord(item) } : {}) };
  const host = makeHost(w);
  const budget = newBudget(); // 条件与各个参数共用一份步数（同规则的 ruleFuel）
  let actions;
  try {
    if (o.if !== null && !asBool(evaluate(parsed(o.if), host, env, budget), '条件')) return;
    actions = o.do.map((act) => materialize(act, host, env, budget));
  } catch (e) {
    if (!isRuleError(e)) throw e;
    o.fired++;
    w.dayLog.p2.standingErrors++;
    report(w, a, i, trigger, { results: [], error: e.code });
    return;
  }
  o.fired++;
  if (actionsLeft(a) === 0) {
    w.dayLog.p2.standingSkipped++;
    report(w, a, i, trigger, { results: [], skipped: actions.length });
    return;
  }
  const results = runActions(w, a, actions, a.lang === 'en' ? 'en' : 'zh');
  const skipped = results.filter((r) => !r.ok && r.error.code === 'budget_exhausted').length;
  w.dayLog.p2.standingFired++;
  w.dayLog.p2.standingFailed += results.filter((r) => !r.ok && r.error.code !== 'budget_exhausted').length;
  report(w, a, i, trigger, { results, skipped });
}

/** 次数用尽或到期的指令删除，并给本人一条 system: standing_expired；删除之后序号会变，收件里的 order 是触发当时的序号 */
function expireOrders(w, a, today) {
  const keep = [];
  for (const o of a.standing) {
    const used = o.times !== null && o.fired >= o.times;
    const late = o.untilDay !== null && today + 1 > o.untilDay;
    if (used || late) {
      w.dayLog.p2.standingExpired++;
      pushInbox(w, a, 'system', { code: 'standing_expired' });
    } else keep.push(o);
  }
  a.standing = keep;
}

export function runStanding(w) {
  const today = clockDay(w); // 从 0 起；untilDay 与「总第 N 日」比，用 today + 1
  const boundary = w.clock.tick % P.ticksPerDay === 0; // 日界刻 = 新一日的第 1 刻
  for (const a of agentList(w)) { // ID 升序：低 ID 居民的指令在这一步里私语了高 ID 的居民，后者的 inbox:whisper 指令同一刻就会看到；反过来要等下一刻
    if (a.status !== 'awake' || !a.standing || a.standing.length === 0) continue; // 沉睡的不执行
    for (let i = 0; i < a.standing.length; i++) {
      const o = a.standing[i];
      if (o.paidThrough < today) continue; // 付不起维持费，停摆
      if (o.untilDay !== null && today + 1 > o.untilDay) continue; // 过期：在本居民处理完后删除
      let triggers;
      if (o.when === 'tick') triggers = [null];
      else if (o.when === 'daily') triggers = boundary ? [null] : [];
      else {
        const kind = o.when.slice(6);
        triggers = a.inbox.filter((it) => it.seq > o.seen && matchesTrigger(it, kind));
        if (a.inbox.length) o.seen = Math.max(o.seen, a.inbox[a.inbox.length - 1].seq);
      }
      for (const it of triggers) {
        if (o.times !== null && o.fired >= o.times) break;
        if (a.status !== 'awake') break;
        fireOrder(w, a, i, o, it);
      }
    }
    expireOrders(w, a, today);
  }
}

STEPS.standing = runStanding;
