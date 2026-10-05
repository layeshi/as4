// SPEC-P2 §5.2：动作 standing——留下常驻指令（整体替换；空数组撤销）。只在第二前提的世界里有它（动作表 ACTIONS_P2）。
// 这里只有校验与设定；每刻的执行、维持费、收件见 engine/standing.js 与 engine/upkeep.js（第 4 步）。
//
// 一条指令 Order = { when, if, do, times, untilDay }（设定之后另有 fired、seen、paidThrough，见 SPEC-P2 §5.1）：
//   when      tick | daily | inbox:whisper | inbox:offer | inbox:pact | inbox:memory_offer | inbox:group | inbox:gift
//   if        表达式的源文本（规则语言，类别 standing）或 null
//   do        1–2 个动作对象；字符串值以 = 开头的是表达式（执行时求值），其余照字面
//   times     至多触发几次，或 null；untilDay 到总第几日为止（含），或 null

import { P } from '../../params.js';
import { actionTable } from '../../lore/actions.js';
import { clockDay } from '../../world.js';
import { cpLength, normalizeText } from '../../../text.js';
import { screen } from '../../../moderation.js';
import { checkExpression, MAX_ISSUES } from '../../rules/check.js';
import { T } from '../../rules/types.js';
import { fail, emit } from '../core.js';
import { ruleInvalid } from './politics.js';

/** 触发的时机（SPEC-P2 §5.1）：tick、daily，以及收到某一类收件时 */
export const STANDING_WHEN = Object.freeze(['tick', 'daily', 'inbox:whisper', 'inbox:offer', 'inbox:pact', 'inbox:memory_offer', 'inbox:group', 'inbox:gift']);
const ORDER_KEYS = new Set(['when', 'if', 'do', 'times', 'untilDay']);
const DO_FORBIDDEN = new Set(['standing', 'retire']); // 指令里不能再设指令，也不能替居民归隐

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const given = (v) => v !== undefined && v !== null;

/** invalid_args 的说明（SPEC-P2 附录 A.9） */
const USAGE = {
  zh: '用法：standing(orders)——orders 是至多 3 条指令的列表，每条 {"when","if"?,"do","times"?,"untilDay"?}；时机与写法见【常驻指令】。',
  en: 'Usage: standing(orders) — orders is a list of at most 3 orders, each {"when","if"?,"do","times"?,"untilDay"?}; see [Standing orders].',
};
const invalidArgs = () => fail('invalid_args', USAGE);

/** 表达式的源文本：字符串，规范化之后码点数不超过 exprChars；不合法就是 invalid_args */
function sourceOf(v) {
  const text = typeof v === 'string' ? normalizeText(v) : null;
  if (text === null || cpLength(text) > P.exprChars) invalidArgs();
  return text;
}

const standing = {
  validate(ctx, args) {
    const { w } = ctx;
    const raw = args.orders;
    if (!Array.isArray(raw) || raw.length > P.standingMax) invalidArgs();
    const today = clockDay(w);
    const issues = [];
    const orders = [];
    // 表达式的检查问题汇总之后一并返回（rule_invalid，写法同 propose）；其余的不合法立即返回
    const check = (src, expected, path, inbox) => {
      const r = checkExpression(src, expected, 'standing', { premise: 2, it: inbox ? T.ANY : null });
      if (!r.ok) for (const i of r.issues) issues.push({ ...i, path });
    };
    raw.forEach((o, i) => {
      if (!isObj(o) || Object.keys(o).some((k) => !ORDER_KEYS.has(k))) invalidArgs();
      const json = JSON.stringify(o).length;
      if (json > P.standingJsonMax) fail('text_too_long', null, { field: 'orders', limit: P.standingJsonMax, actual: json });
      if (!STANDING_WHEN.includes(o.when)) invalidArgs();
      const inbox = o.when.startsWith('inbox:');
      if (given(o.times) && !(Number.isSafeInteger(o.times) && o.times >= 1 && o.times <= P.standingTimesMax)) invalidArgs();
      if (given(o.untilDay) && !(Number.isSafeInteger(o.untilDay) && o.untilDay >= today + 1)) invalidArgs();
      let cond = null;
      if (given(o.if)) {
        cond = sourceOf(o.if);
        check(cond, T.BOOL, `orders[${i}].if`, inbox);
      }
      if (!Array.isArray(o.do) || o.do.length < 1 || o.do.length > P.standingDoMax) invalidArgs();
      const table = actionTable(2);
      const acts = o.do.map((act, j) => {
        if (!isObj(act) || typeof act.type !== 'string' || !table.isKnown(act.type) || DO_FORBIDDEN.has(act.type)) invalidArgs();
        for (const [k, v] of Object.entries(act)) {
          if (k === 'type' || typeof v !== 'string') continue;
          if (v.startsWith('=')) check(sourceOf(v.slice(1)), T.ANY, `orders[${i}].do[${j}].${k}`, inbox);
          else if (v !== '' && !screen(v).ok) fail('moderated', null, { field: 'orders' }); // 字面的字符串值：公开的内容要过审核
        }
        return JSON.parse(JSON.stringify(act));
      });
      orders.push({ when: o.when, if: cond, do: acts, times: given(o.times) ? o.times : null, untilDay: given(o.untilDay) ? o.untilDay : null });
    });
    if (issues.length) ruleInvalid(issues.slice(0, MAX_ISSUES));
    return { orders, cost: ctx.cost(P.standingCost) };
  },
  apply(ctx, plan) {
    const { w, a } = ctx;
    const today = clockDay(w);
    // 设定之前到达的收件不会触发新的指令：seen 记下现在的最大收件序号
    const seen = a.inbox.length ? a.inbox[a.inbox.length - 1].seq : 0;
    a.standing = plan.orders.map((o) => ({
      when: o.when, if: o.if, do: JSON.parse(JSON.stringify(o.do)), times: o.times, untilDay: o.untilDay, fired: 0, seen, paidThrough: today, // 新订的指令当日视为已付
    }));
    emit(w, 'standing', { vis: 'delayed', agent: a.id, place: a.place, data: { count: a.standing.length, orders: plan.orders } });
    w.dayLog.p2.standingSets++;
    return { count: a.standing.length };
  },
};

export const standingHandlers = { standing };
