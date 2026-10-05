// SPEC-E2 §7.3、§7.8：类型检查与静态校验。
//
// 提交（propose / rules / draft / refound）时整体校验，任何一条不合法即整体拒绝（rule_invalid）：
//   1. JSON 的形状：未知的键是错误（帮助模型发现拼写错误）；必填字段齐全；字段类型对；
//   2. when 合法，且对这个作用域可用；before: / after: 后面的动作存在，且不在守护律排除的名单里；on: 后面的事件存在；
//   3. 每个操作在这个时机、这个作用域里可用；each 不嵌套；
//   4. 表达式能解析、能通过类型检查；数额字段是 int；账户字段是账户；条件是 bool；among、in 是居民的列表；
//   5. 数量与长度上限；
//   6. 字面的引用存在（由调用者提供 lookup，纯函数测试时不提供则跳过）；
//   7. 内容审核；
//   8. 程序：两类之一或两者；period 在范围内；表达式按类型检查；{ none: true } 不能带其他字段。
//
// 报错要让模型能改对：每个错误给出路径（如 rules[2].do[0].energy）、中英文说明，以及一条建议；最多返回 5 个。
// 本文件是纯函数：不碰世界。需要世界的检查（地点是否存在……）通过 opts.lookup 注入。

import { actionTable } from '../lore/actions.js';
import { P, LIMITS, WEATHER_CODES } from '../params.js';
import { normalizeText, cpLength } from '../../text.js';
import { screen } from '../../moderation.js';
import { RuleSyntaxError } from './errors.js';
import { parseExpr, countNodes } from './parser.js';
import { syntaxMessage, list as listOf, q } from './messages.js';
import {
  T, FIELDS, TYPE_NAMES, FUNCTION_SIGS, FUNCTION_NAMES, ALL_NAMES, ALL_NAMES_P2, namesFor, elementType, isListType, accepts,
} from './types.js';
import {
  ACTION_ORDER, ACTIONS, EVENTS, EVENT_NAMES, EVENT_FIELDS, NO_BEFORE_ACTIONS, NO_AFTER_ACTIONS, isKnownAction, actionArgNames,
} from '../lore/actions.js';

export const MAX_ISSUES = 5;
const LANG_RE = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}$/;

// ═══════════════════════════════════════════════════════════════
// 诊断
// ═══════════════════════════════════════════════════════════════

/** 一个校验错误：{ path, code, zh, en, hint: {zh, en} | null } */
function issue(path, code, zh, en, hint = null) {
  return { path, code, zh, en, hint };
}

/** 类型检查中途抛出的错误（带表达式内的位置）；校验层捕获后加上路径 */
class CheckAbort extends Error {
  constructor(code, pos, zh, en, hint = null) {
    super(code);
    this.code = code;
    this.pos = pos;
    this.zh = zh;
    this.en = en;
    this.hint = hint;
  }
}

const withPos = (pos, zh, en) => ({ zh: pos ? `第 ${pos} 个字符：${zh}` : zh, en: pos ? `Character ${pos}: ${en}` : en });
const typeName = (t, lang) => (TYPE_NAMES[t] ? TYPE_NAMES[t][lang] : t);

function abort(code, pos, zh, en, hint = null) {
  const m = withPos(pos, zh, en);
  throw new CheckAbort(code, pos, m.zh, m.en, hint);
}

// ═══════════════════════════════════════════════════════════════
// 时机
// ═══════════════════════════════════════════════════════════════

/**
 * 解析 when。返回 { kind, action?, event? }：kind 为 enact | daily | monthly | before | after | on。
 * 不合法返回 { error: issue 的 { zh, en, hint } }。scope：{ kind: 'city' | 'group' | 'place' }。
 */
export function parseWhen(when, scope) {
  const bad = (zh, en, hint = null) => ({ error: { zh, en, hint } });
  const forms = {
    zh: 'enact、daily、monthly、before:动作、after:动作、on:事件',
    en: 'enact, daily, monthly, before:<action>, after:<action>, on:<event>',
  };
  if (typeof when !== 'string') return bad('when 必须是字符串', 'when must be a string', { zh: `可用的写法：${forms.zh}`, en: `Valid forms: ${forms.en}` });
  const w = when.trim();
  if (w === 'enact' || w === 'daily' || w === 'monthly') return { kind: w };
  const m = /^(before|after|on):([A-Za-z_]+)$/.exec(w);
  if (!m) return bad(`不认识的时机「${w}」`, `unknown timing "${w}"`, { zh: `可用的写法：${forms.zh}`, en: `Valid forms: ${forms.en}` });
  const [, kind, what] = m;
  if (kind === 'on') {
    if (scope.kind === 'place') return bad('地点规则不能用 on: 事件', 'place rules cannot use on: events', { zh: '地点规则可用的时机：enact、daily、monthly、before:动作、after:动作、before:enter', en: 'Place rules can use: enact, daily, monthly, before:<action>, after:<action>, before:enter' });
    if (!EVENT_NAMES.includes(what)) return bad(`不认识的事件「${what}」`, `unknown event "${what}"`, { zh: `可用的事件：${EVENT_NAMES.join('、')}`, en: `Available events: ${EVENT_NAMES.join(', ')}` });
    return { kind: 'on', event: what };
  }
  if (kind === 'before' && what === 'enter') {
    if (scope.kind !== 'place') return bad('before:enter 只用于地点规则（且地点须有运转中的门）', 'before:enter is only for place rules (and the place needs a functioning gate)');
    return { kind: 'before', action: 'move', enter: true };
  }
  const { ACTIONS, ORDER: ACTION_ORDER, NO_BEFORE: NO_BEFORE_ACTIONS, NO_AFTER: NO_AFTER_ACTIONS, isKnown: isKnownAction } = actionTable(scope.premise || 0);
  if (!isKnownAction(what)) {
    return bad(`不认识的动作「${what}」`, `unknown action "${what}"`, { zh: `可用的动作：${ACTION_ORDER.join(' ')}`, en: `Available actions: ${ACTION_ORDER.join(' ')}` });
  }
  if (kind === 'before' && NO_BEFORE_ACTIONS.includes(what)) {
    const inner = ACTIONS[what].inner;
    return bad(
      inner ? `「${what}」是内心的动作，没有 before：记忆、日记与私语不受任何规则约束（守护律）` : `「${what}」不能被规则拒绝或收费，没有 before（退出权与重订之权，守护律）`,
      inner ? `"${what}" is part of the inner life and has no before: memories, diaries and whispers are beyond every rule (guardian law)` : `"${what}" cannot be refused or charged by any rule, so it has no before (the right to exit and to refound, guardian law)`,
      { zh: `没有 before 的动作：${NO_BEFORE_ACTIONS.join(' ')}`, en: `Actions without before: ${NO_BEFORE_ACTIONS.join(' ')}` },
    );
  }
  if (kind === 'after' && NO_AFTER_ACTIONS.includes(what)) {
    return bad(`「${what}」是内心的动作，没有 after：记忆、日记与私语不受任何规则约束（守护律）`, `"${what}" is part of the inner life and has no after: memories, diaries and whispers are beyond every rule (guardian law)`,
      { zh: `没有 after 的动作：${NO_AFTER_ACTIONS.join(' ')}`, en: `Actions without after: ${NO_AFTER_ACTIONS.join(' ')}` });
  }
  return { kind, action: what };
}

// ═══════════════════════════════════════════════════════════════
// 类型检查
// ═══════════════════════════════════════════════════════════════

/**
 * 表达式的检查上下文：
 *   kind    namesFor 的类别；names 由它得出
 *   it      当前的 it 的类型（filter / sum / top / each 里），否则为 null
 *   action  before / after 规则所对应的动作（用来核对 args.<参数>）
 *   event   on 规则所对应的事件（用来核对 event.<字段>）
 *   refs    收集字面的引用 [{ kind, id, pos }]，供校验层核对存在
 *   strs    收集字面的字符串 [{ text, pos }]，供校验层审核
 */
export function makeCtx(kind, { action = null, event = null, premise = 0 } = {}) {
  // weight 里的 it 是投票者（PROTOCOL-2 §6.8）；premise 决定动作的参数名（actionArgNames）与哪些名字算「这里不可用」（nameError）
  return { kind, names: namesFor(kind), it: kind === 'weight' ? T.AGENT : null, action, event, premise, refs: [], strs: [] };
}

const kindHere = {
  actor: { zh: '「actor」只在 before: 与 after: 规则里可用（每日、每月、通过时与事件规则里没有执行者）', en: '"actor" is only available in before: and after: rules (daily, monthly, enact and event rules have no actor)' },
  args: { zh: '「args」只在 before: 与 after: 规则里可用', en: '"args" is only available in before: and after: rules' },
  here: { zh: '「here」只在 before: 与 after: 规则里可用', en: '"here" is only available in before: and after: rules' },
  result: { zh: '「result」只在 after: 规则里可用（动作成功之后才有结果）', en: '"result" is only available in after: rules (a result exists only after the action succeeded)' },
  event: { zh: '「event」只在 on: 规则里可用', en: '"event" is only available in on: rules' },
  it: { zh: '「it」只能用在 filter、sum、top 的第二个参数里，以及 each 的 if 与 do 里', en: '"it" can only be used as the second argument of filter, sum and top, and inside each\'s if and do' },
  yes: { zh: '「yes no abstain voted total turnout」只在程序的 decide 里可用', en: '"yes no abstain voted total turnout" are only available in a procedure\'s decide' },
};
for (const n of ['no', 'abstain', 'voted', 'total', 'turnout']) kindHere[n] = kindHere.yes;
// 第二前提（SPEC-P2 附录 A.9）：只在 ctx.premise >= 2 时会用到
kindHere.me = { zh: '「me」「left」只在常驻指令里可用', en: '"me" and "left" are only available in standing orders' };
kindHere.left = kindHere.me;

function nameError(n, ctx) {
  const avail = [...Object.keys(ctx.names), ...(ctx.it ? ['it'] : [])];
  const hint = { zh: `这里可用的名字：${listOf(avail, 'zh')}`, en: `Names available here: ${listOf(avail, 'en')}` };
  if ((ctx.premise >= 2 ? ALL_NAMES_P2 : ALL_NAMES).includes(n.n)) abort('name_unavailable', n.p, kindHere[n.n].zh, kindHere[n.n].en, hint);
  const near = avail.find((a) => a.toLowerCase() === n.n.toLowerCase());
  abort('unknown_name', n.p, `不认识的名字「${n.n}」${near ? `（是不是想写 ${near}？名字区分大小写）` : ''}`, `unknown name "${n.n}"${near ? ` (did you mean ${near}? names are case-sensitive)` : ''}`, hint);
}

function fieldType(ot, f, node, ctx) {
  if (ot === T.ANY || ot === T.VAR || ot === T.RESULT) return T.ANY;
  if (FIELDS[ot]) {
    const t = FIELDS[ot][f];
    if (t) return t;
    const names = Object.keys(FIELDS[ot]);
    const near = names.find((x) => x.toLowerCase() === f.toLowerCase());
    abort('unknown_field', node.p, `${typeName(ot, 'zh')}没有字段「${f}」${near ? `（是不是想写 ${near}？）` : ''}`, `${typeName(ot, 'en')} has no field "${f}"${near ? ` (did you mean ${near}?)` : ''}`,
      { zh: `可用的字段：${listOf(names, 'zh')}`, en: `Available fields: ${listOf(names, 'en')}` });
  }
  if (ot === T.ARGS) {
    if (ctx.action) {
      const names = actionArgNames(ctx.action, ctx.premise);
      if (!names.includes(f)) {
        const near = names.find((x) => x.toLowerCase() === f.toLowerCase());
        abort('unknown_arg', node.p, `动作 ${ctx.action} 没有参数「${f}」${near ? `（是不是想写 ${near}？）` : ''}`, `action ${ctx.action} has no argument "${f}"${near ? ` (did you mean ${near}?)` : ''}`,
          { zh: names.length ? `这个动作的参数：${listOf(names, 'zh')}` : '这个动作没有参数', en: names.length ? `Arguments of this action: ${listOf(names, 'en')}` : 'This action has no arguments' });
      }
    }
    return T.ANY;
  }
  if (ot === T.EVENT) {
    if (ctx.event) {
      const names = EVENT_FIELDS[ctx.event] || [];
      if (!names.includes(f)) {
        abort('unknown_event_field', node.p, `事件 ${ctx.event} 没有字段「${f}」`, `event ${ctx.event} has no field "${f}"`,
          { zh: `这个事件的字段：${listOf(names, 'zh')}`, en: `Fields of this event: ${listOf(names, 'en')}` });
      }
    }
    return T.ANY;
  }
  abort('field_of_non_record', node.p, `不能对${typeName(ot, 'zh')}取字段「${f}」`, `cannot take field "${f}" of ${typeName(ot, 'en')}`,
    ot === T.CITY ? null : { zh: '只有 city、居民、社群、灵魂、var、args、result、event 有字段', en: 'Only city, residents, groups, souls, var, args, result and event have fields' });
}

/** what：被检查的东西的名字；中英文不同时给 [zh, en] */
function need(node, got, want, ctx, what) {
  if (!accepts(want, got)) {
    const [wz, we] = Array.isArray(what) ? what : [what, what];
    abort('type_mismatch', node.p, `${wz}需要${typeName(want, 'zh')}，这里是${typeName(got, 'zh')}`, `${we.trim()} needs ${typeName(want, 'en')}, but this is ${typeName(got, 'en')}`);
  }
}

const COMPARE_ORDER = new Set(['<', '<=', '>', '>=']);
const ARITH = new Set(['+', '-', '*', '/', '%']);

/** 求一个语法树的静态类型。出错抛 CheckAbort */
export function typeOf(n, ctx) {
  switch (n.t) {
    case 'int': return T.INT;
    case 'str':
      ctx.strs.push({ text: n.v, pos: n.p });
      return T.STR;
    case 'bool': return T.BOOL;
    case 'null': return T.NULL;
    case 'name': {
      if (n.n === 'it') {
        if (ctx.it) return ctx.it;
        return nameError(n, ctx);
      }
      const t = ctx.names[n.n];
      if (t) return t;
      return nameError(n, ctx);
    }
    case 'field': return fieldType(typeOf(n.o, ctx), n.f, n, ctx);
    case 'un': {
      const t = typeOf(n.a, ctx);
      if (n.op === '-') {
        need(n.a, t, T.INT, ctx, ['负号', 'unary minus']);
        return T.INT;
      }
      need(n.a, t, T.BOOL, ctx, 'not');
      return T.BOOL;
    }
    case 'bin': return binType(n, ctx);
    case 'call': return callType(n, ctx);
    default: throw new Error(`typeOf: unknown node ${n.t}`);
  }
}

function binType(n, ctx) {
  const ta = typeOf(n.a, ctx);
  const tb = typeOf(n.b, ctx);
  if (ARITH.has(n.op)) {
    need(n.a, ta, T.INT, ctx, [`运算符 ${n.op} `, `operator ${n.op}`]);
    need(n.b, tb, T.INT, ctx, [`运算符 ${n.op} `, `operator ${n.op}`]);
    return T.INT;
  }
  if (COMPARE_ORDER.has(n.op)) {
    need(n.a, ta, T.INT, ctx, [`比较 ${n.op} `, `comparison ${n.op}`]);
    need(n.b, tb, T.INT, ctx, [`比较 ${n.op} `, `comparison ${n.op}`]);
    return T.BOOL;
  }
  if (n.op === 'and' || n.op === 'or') {
    need(n.a, ta, T.BOOL, ctx, n.op);
    need(n.b, tb, T.BOOL, ctx, n.op);
    return T.BOOL;
  }
  // == !=：同种的值才能比较（null 与任何类型可比）；居民按 ID 比较
  const comparable = ta === tb || ta === T.ANY || tb === T.ANY || ta === T.NULL || tb === T.NULL;
  if (!comparable || isListType(ta) && ta !== T.ANY || isListType(tb) && tb !== T.ANY) {
    abort('compare_kinds', n.p, `不能比较${typeName(ta, 'zh')}与${typeName(tb, 'zh')}`, `cannot compare ${typeName(ta, 'en')} with ${typeName(tb, 'en')}`,
      ta === T.AGENT || tb === T.AGENT ? { zh: '要拿居民和 ID 字符串比，请写 actor.id == \'a3\'', en: "To compare a resident with an ID string, write actor.id == 'a3'" } : null);
  }
  return T.BOOL;
}

function arity(n, min, max = min) {
  const k = n.a.length;
  if (k < min || k > max) {
    const sig = FUNCTION_SIGS[n.f];
    abort('arity', n.p, `函数 ${n.f} 需要 ${min === max ? min : `${min}–${max}`} 个参数，这里给了 ${k} 个。用法：${sig}`, `function ${n.f} takes ${min === max ? min : `${min} to ${max}`} argument(s), but ${k} were given. Usage: ${sig}`);
  }
}

function unify(n, t1, t2) {
  if (t1 === t2) return t1;
  if (t1 === T.NULL) return t2;
  if (t2 === T.NULL) return t1;
  if (t1 === T.ANY || t2 === T.ANY) return T.ANY;
  return abort('if_branches', n.p, `if 的两支必须同类型：这里是${typeName(t1, 'zh')}与${typeName(t2, 'zh')}`, `the two branches of if must have the same type: here ${typeName(t1, 'en')} and ${typeName(t2, 'en')}`);
}

function needList(arg, t) {
  if (!isListType(t)) {
    abort('type_mismatch', arg.p, `这里需要居民（或灵魂）的列表，得到${typeName(t, 'zh')}`, `a list of residents (or souls) is needed, but this is ${typeName(t, 'en')}`);
  }
}

function callType(n, ctx) {
  const f = n.f;
  if (!Object.prototype.hasOwnProperty.call(FUNCTION_SIGS, f)) {
    const near = FUNCTION_NAMES.find((x) => x.toLowerCase() === f.toLowerCase());
    abort('unknown_function', n.p, `不认识的函数「${f}」${near ? `（是不是想写 ${near}？）` : ''}`, `unknown function "${f}"${near ? ` (did you mean ${near}?)` : ''}`,
      { zh: `可用的函数：${FUNCTION_NAMES.join(' ')}`, en: `Available functions: ${FUNCTION_NAMES.join(' ')}` });
  }
  const arg = (i) => n.a[i];
  const ty = (i, c = ctx) => typeOf(n.a[i], c);
  const withIt = (el) => ({ ...ctx, it: el });
  const litRef = (i, kind) => {
    if (n.a[i].t === 'str') ctx.refs.push({ kind, id: n.a[i].v, pos: n.a[i].p });
  };
  switch (f) {
    case 'min':
    case 'max': {
      arity(n, 1, Infinity);
      n.a.forEach((a, i) => need(a, ty(i), T.INT, ctx, [`${f} 的参数`, `argument of ${f}`]));
      return T.INT;
    }
    case 'abs':
      arity(n, 1);
      need(arg(0), ty(0), T.INT, ctx, ['abs 的参数', 'argument of abs']);
      return T.INT;
    case 'if': {
      arity(n, 3);
      need(arg(0), ty(0), T.BOOL, ctx, ['if 的条件', 'condition of if']);
      return unify(n, ty(1), ty(2));
    }
    case 'default': {
      arity(n, 2);
      const tx = ty(0);
      const td = ty(1);
      return td === T.NULL ? tx : td;
    }
    case 'count':
      arity(n, 1);
      needList(arg(0), ty(0));
      return T.INT;
    case 'sum': {
      arity(n, 2);
      const lt = ty(0);
      needList(arg(0), lt);
      need(arg(1), ty(1, withIt(elementType(lt))), T.INT, ctx, ['sum 的式子', 'expression of sum']);
      return T.INT;
    }
    case 'filter': {
      arity(n, 2);
      const lt = ty(0);
      needList(arg(0), lt);
      need(arg(1), ty(1, withIt(elementType(lt))), T.BOOL, ctx, ['filter 的条件', 'condition of filter']);
      return lt;
    }
    case 'top': {
      arity(n, 3);
      const lt = ty(0);
      needList(arg(0), lt);
      need(arg(1), ty(1, withIt(elementType(lt))), T.INT, ctx, ['top 的式子', 'expression of top']);
      need(arg(2), ty(2), T.INT, ctx, ['top 的 n', 'n of top']);
      return lt;
    }
    case 'sample': {
      arity(n, 2);
      const lt = ty(0);
      needList(arg(0), lt);
      need(arg(1), ty(1), T.INT, ctx, ['sample 的 n', 'n of sample']);
      return lt;
    }
    case 'contains': {
      arity(n, 2);
      const lt = ty(0);
      needList(arg(0), lt);
      need(arg(1), ty(1), T.AGENT, ctx, ['contains 的第二个参数', 'second argument of contains']);
      return T.BOOL;
    }
    case 'tagged':
      arity(n, 1);
      need(arg(0), ty(0), T.STR, ctx, ['tagged 的参数', 'argument of tagged']);
      return T.AGENTS;
    case 'members':
      arity(n, 1);
      need(arg(0), ty(0), T.STR, ctx, ['members 的参数', 'argument of members']);
      litRef(0, 'group');
      return T.AGENTS;
    case 'at':
      arity(n, 1);
      need(arg(0), ty(0), T.STR, ctx, ['at 的参数', 'argument of at']);
      litRef(0, 'place');
      return T.AGENTS;
    case 'has_tag':
      arity(n, 2);
      need(arg(0), ty(0), T.AGENT, ctx, ['has_tag 的第一个参数', 'first argument of has_tag']);
      need(arg(1), ty(1), T.STR, ctx, ['has_tag 的标签', 'tag of has_tag']);
      return T.BOOL;
    case 'in_group':
      arity(n, 2);
      need(arg(0), ty(0), T.AGENT, ctx, ['in_group 的第一个参数', 'first argument of in_group']);
      need(arg(1), ty(1), T.STR, ctx, ['in_group 的社群', 'group of in_group']);
      litRef(1, 'group');
      return T.BOOL;
    case 'awake':
      arity(n, 1);
      need(arg(0), ty(0), T.AGENT, ctx, ['awake 的参数', 'argument of awake']);
      return T.BOOL;
    case 'is_wild':
      arity(n, 1);
      need(arg(0), ty(0), T.STR, ctx, ['is_wild 的参数', 'argument of is_wild']);
      litRef(0, 'place');
      return T.BOOL;
    case 'owner':
      arity(n, 1);
      need(arg(0), ty(0), T.STR, ctx, ['owner 的参数', 'argument of owner']);
      litRef(0, 'place');
      return T.STR;
    case 'agent':
      arity(n, 1);
      need(arg(0), ty(0), T.STR, ctx, ['agent 的参数', 'argument of agent']);
      return T.AGENT;
    case 'group':
      arity(n, 1);
      need(arg(0), ty(0), T.STR, ctx, ['group 的参数', 'argument of group']);
      litRef(0, 'group');
      return T.GROUP;
    case 'soul':
      arity(n, 1);
      need(arg(0), ty(0), T.STR, ctx, ['soul 的参数', 'argument of soul']);
      return T.SOUL;
    case 'names': {
      arity(n, 1, 2);
      needList(arg(0), ty(0));
      if (n.a.length === 2) need(arg(1), ty(1), T.STR, ctx, ['names 的分隔符', 'separator of names']);
      return T.STR;
    }
    case 'weather': {
      arity(n, 1);
      need(arg(0), ty(0), T.STR, ctx, ['weather 的参数', 'argument of weather']);
      if (arg(0).t === 'str' && !WEATHER_CODES.includes(arg(0).v)) {
        abort('unknown_weather', arg(0).p, `不认识的天象代码「${arg(0).v}」`, `unknown weather code "${arg(0).v}"`,
          { zh: `可用的天象：${WEATHER_CODES.join(' ')}`, en: `Available weather codes: ${WEATHER_CODES.join(' ')}` });
      }
      return T.BOOL;
    }
    default:
      throw new Error(`callType: unhandled function ${f}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 表达式字段的校验（解析 + 类型检查 + 期望的类型）
// ═══════════════════════════════════════════════════════════════

/** 把 CheckAbort / RuleSyntaxError 转成 issue；其余异常照常抛出 */
function toIssue(path, e) {
  if (e instanceof RuleSyntaxError) {
    const m = syntaxMessage(e);
    return issue(path, `syntax.${e.code}`, m.zh, m.en);
  }
  if (e instanceof CheckAbort) return issue(path, `type.${e.code}`, e.zh, e.en, e.hint);
  throw e;
}

/**
 * 校验一个表达式字段。成功返回规范化后的文本（并把字面的引用、字符串收集进 ctx），失败把 issue 推进 issues 并返回 null。
 * expected：期望的类型（int / bool / account / agent / list<agent> / scalar / str / any）。
 */
export function checkExprField(value, expected, ctx, path, issues) {
  if (typeof value !== 'string') {
    issues.push(issue(path, 'shape.bad_type', '这里必须是表达式（字符串）', 'this must be an expression (a string)',
      { zh: `例如："${expected === T.BOOL ? "actor.energy > 10" : expected === T.INT ? 'min(10, actor.energy / 2)' : 'actor'}"`, en: `For example: "${expected === T.BOOL ? 'actor.energy > 10' : expected === T.INT ? 'min(10, actor.energy / 2)' : 'actor'}"` }));
    return null;
  }
  const text = normalizeText(value);
  try {
    const tree = parseExpr(text);
    const got = typeOf(tree, ctx);
    if (!accepts(expected, got)) {
      issues.push(issue(path, 'type.expected', `这里需要${typeName(expected, 'zh')}，表达式的结果是${typeName(got, 'zh')}`, `this needs ${typeName(expected, 'en')}, but the expression gives ${typeName(got, 'en')}`,
        expected === T.INT && got === T.BOOL ? { zh: '要把真假当数用，请写 if(条件, 1, 0)', en: 'To use a boolean as a number, write if(cond, 1, 0)' } : null));
      return null;
    }
    return { text, tree, type: got };
  } catch (e) {
    issues.push(toIssue(path, e));
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 操作
// ═══════════════════════════════════════════════════════════════

const BEFORE_OPS = ['deny', 'fee'];
const GROUP_OPS = ['transfer', 'share', 'each', 'deny', 'fee', 'set', 'tag', 'untag', 'announce'];
const PLACE_OPS = ['deny', 'fee', 'transfer', 'announce'];
export const OP_NAMES = Object.freeze([
  'transfer', 'share', 'each', 'deny', 'fee', 'set', 'tag', 'untag', 'announce', 'exile', 'pardon', 'rename', 'mint',
  'protect', 'unprotect', 'amend', 'repeal', 'fund', 'cede', 'seize', 'petition',
]);

// 字段规格：[名字, 种类, 是否必填]。种类：
//   表达式：acct agent agents int bool scalar
//   字面值：reason tag varname name id text600 announceTo renameTarget template lit-article lit-lang amend-text canonical
export const OP_FIELDS = {
  transfer: [['from', 'acct', true], ['to', 'acct', true], ['energy', 'int'], ['coins', 'int']],
  share: [['from', 'acct', true], ['energy', 'int'], ['coins', 'int'], ['among', 'agents', true]],
  each: [['in', 'agents', true], ['if', 'bool'], ['do', 'ops', true]],
  deny: [['reason', 'reason', true]],
  fee: [['to', 'acct', true], ['energy', 'int'], ['coins', 'int']],
  set: [['var', 'varname', true], ['value', 'scalar', true]],
  tag: [['who', 'agent', true], ['tag', 'tag', true]],
  untag: [['who', 'agent', true], ['tag', 'tag', true]],
  announce: [['to', 'announceTo', true], ['text', 'template', true]],
  exile: [['who', 'agent', true]],
  pardon: [['who', 'agent', true]],
  rename: [['target', 'renameTarget', true], ['name', 'name', true]],
  mint: [['coins', 'int', true], ['to', 'acct']],
  protect: [['inscription', 'id', true]],
  unprotect: [['inscription', 'id', true]],
  amend: [['article', 'article'], ['lang', 'lang'], ['text', 'amendText'], ['canonical', 'canonical']],
  repeal: [['law', 'id', true]],
  fund: [['project', 'id', true], ['energy', 'int', true]],
  cede: [['place', 'id', true], ['to', 'acct', true]],
  seize: [['place', 'id', true]],
  petition: [['text', 'text600', true]],
};
// 数额类操作：energy 与 coins 至少要有一项
const NEED_AMOUNT = new Set(['transfer', 'share', 'fee']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 字面字符串（理由、标签、改名、上书……）：规范化、长度、审核。成功返回规范化后的文本，失败推 issue 并返回 null。
 */
function checkLiteral(value, { max, min = 1 }, path, issues, label, { allowNewline = false } = {}) {
  const [lz, le] = Array.isArray(label) ? label : [label, label]; // 中英文不同时给 [zh, en]
  if (typeof value !== 'string') {
    issues.push(issue(path, 'shape.bad_type', `${lz}必须是字符串`, `${le} must be a string`));
    return null;
  }
  const text = normalizeText(value);
  const len = cpLength(text);
  if (len < min) {
    issues.push(issue(path, 'shape.empty', `${lz}不能为空`, `${le} cannot be empty`));
    return null;
  }
  if (len > max) {
    issues.push(issue(path, 'limit.too_long', `${lz}不能超过 ${max} 个字符（现在 ${len}）`, `${le} may not exceed ${max} characters (this has ${len})`));
    return null;
  }
  if (!allowNewline && text.includes('\n')) {
    issues.push(issue(path, 'shape.newline', `${lz}不能换行`, `${le} cannot contain a line break`));
    return null;
  }
  if (!screen(text).ok) {
    issues.push(issue(path, 'moderated', `${lz}未通过内容审核`, `${le} did not pass content review`));
    return null;
  }
  return text;
}

/** 解析宣告模板 → [{ lit } | { expr, pos }]；格式错误抛 CheckAbort（pos 为模板内的字符位置） */
export function parseTemplate(text) {
  const cs = Array.from(text);
  const parts = [];
  let lit = '';
  let i = 0;
  while (i < cs.length) {
    const c = cs[i];
    if (c === '{') {
      if (cs[i + 1] === '{') {
        lit += '{';
        i += 2;
        continue;
      }
      // 找匹配的 }，跳过单引号字符串里的花括号
      let j = i + 1;
      let inStr = false;
      let found = false;
      while (j < cs.length) {
        const d = cs[j];
        if (inStr) {
          if (d === '\\') j++;
          else if (d === "'") inStr = false;
        } else if (d === "'") {
          inStr = true;
        } else if (d === '}') {
          found = true;
          break;
        }
        j++;
      }
      if (!found) abort('template_unclosed', i + 1, '花括号没有闭合；要写花括号本身请用 {{ 与 }}', 'a brace is not closed; write {{ and }} for literal braces');
      if (lit) parts.push({ lit });
      lit = '';
      const src = cs.slice(i + 1, j).join('');
      if (src.trim() === '') abort('template_empty', i + 1, '花括号里是空的', 'the braces are empty');
      parts.push({ expr: src, pos: i + 1 });
      i = j + 1;
      continue;
    }
    if (c === '}') {
      if (cs[i + 1] === '}') {
        lit += '}';
        i += 2;
        continue;
      }
      abort('template_stray', i + 1, '多出一个右花括号；要写花括号本身请用 }}', 'a stray closing brace; write }} for a literal brace');
    }
    lit += c;
    i++;
  }
  if (lit) parts.push({ lit });
  return parts;
}

/** 校验宣告模板，返回规范化的模板文本 */
function checkTemplate(value, ctx, path, issues) {
  if (typeof value !== 'string') {
    issues.push(issue(path, 'shape.bad_type', 'text 必须是字符串（模板）', 'text must be a string (a template)'));
    return null;
  }
  const text = normalizeText(value);
  const len = cpLength(text);
  if (len === 0) {
    issues.push(issue(path, 'shape.empty', '宣告的文字不能为空', 'the announcement text cannot be empty'));
    return null;
  }
  if (len > P.templateChars) {
    issues.push(issue(path, 'limit.too_long', `宣告的模板不能超过 ${P.templateChars} 个字符（现在 ${len}）`, `an announcement template may not exceed ${P.templateChars} characters (this has ${len})`));
    return null;
  }
  let parts;
  try {
    parts = parseTemplate(text);
  } catch (e) {
    issues.push(toIssue(path, e));
    return null;
  }
  let ok = true;
  for (const part of parts) {
    if (part.lit !== undefined) {
      if (!screen(part.lit).ok) {
        issues.push(issue(path, 'moderated', '宣告的文字未通过内容审核', 'the announcement text did not pass content review'));
        ok = false;
      }
      continue;
    }
    try {
      const tree = parseExpr(normalizeText(part.expr));
      const got = typeOf(tree, ctx);
      if (!(got === T.INT || got === T.STR || got === T.AGENT || got === T.ANY)) {
        issues.push(issue(path, 'type.template', `花括号里的结果必须是整数、字符串或居民，这里是${typeName(got, 'zh')}`, `a placeholder must give an integer, a string or a resident, but this gives ${typeName(got, 'en')}`,
          got === T.AGENTS || got === T.SOULS ? { zh: '列表请用 names(列表, 分隔符) 或 count(列表)', en: 'For lists use names(list, separator) or count(list)' } : null));
        ok = false;
      }
    } catch (e) {
      const is = toIssue(path, e);
      is.zh = `花括号里：${is.zh}`;
      is.en = `in the braces: ${is.en}`;
      issues.push(is);
      ok = false;
    }
  }
  return ok ? text : null;
}

/** 校验一个操作。返回规范化后的操作对象，或 null（已把 issue 推进 issues） */
function checkOp(op, rc, path, issues) {
  if (!isObj(op)) {
    issues.push(issue(path, 'shape.bad_type', '操作必须是一个对象', 'an operation must be an object', { zh: `例如：{ "op": "transfer", "from": "treasury", "to": "actor", "energy": "5" }`, en: `For example: { "op": "transfer", "from": "treasury", "to": "actor", "energy": "5" }` }));
    return null;
  }
  const name = op.op;
  if (typeof name !== 'string' || !OP_NAMES.includes(name)) {
    issues.push(issue(`${path}.op`, 'op.unknown', typeof name === 'string' ? `不认识的操作「${name}」` : '操作缺少 op 字段', typeof name === 'string' ? `unknown operation "${name}"` : 'the operation has no op field',
      { zh: `可用的操作：${OP_NAMES.join(' ')}`, en: `Available operations: ${OP_NAMES.join(' ')}` }));
    return null;
  }
  // 时机与作用域是否允许这个操作
  const isBefore = rc.timing.kind === 'before';
  if (isBefore && !BEFORE_OPS.includes(name)) {
    issues.push(issue(`${path}.op`, 'op.timing', `before 规则只能 deny（拒绝）或 fee（收费），不能 ${name}`, `a before rule can only deny or fee, not ${name}`, { zh: '想在动作之后做别的事，请用 after: 规则', en: 'To do something else around the action, use an after: rule' }));
    return null;
  }
  if (!isBefore && BEFORE_OPS.includes(name)) {
    issues.push(issue(`${path}.op`, 'op.timing', `${name} 只能用在 before: 规则里`, `${name} can only be used in before: rules`));
    return null;
  }
  const allowed = rc.scope.kind === 'group' ? GROUP_OPS : rc.scope.kind === 'place' ? PLACE_OPS : null;
  if (allowed && !allowed.includes(name)) {
    issues.push(issue(`${path}.op`, 'op.scope', `${rc.scope.kind === 'group' ? '社群章程' : '地点规则'}不能用操作 ${name}`, `${rc.scope.kind === 'group' ? 'bylaws' : 'place rules'} cannot use the operation ${name}`,
      { zh: `这里可用的操作：${allowed.join(' ')}`, en: `Operations available here: ${allowed.join(' ')}` }));
    return null;
  }
  if (name === 'each' && rc.inEach) {
    issues.push(issue(`${path}.op`, 'op.each_nested', 'each 里面不能再嵌套 each', 'each cannot be nested inside each'));
    return null;
  }

  const specs = OP_FIELDS[name];
  const known = new Set(['op', ...specs.map(([n]) => n)]);
  let ok = true;
  for (const k of Object.keys(op)) {
    if (!known.has(k)) {
      issues.push(issue(`${path}.${k}`, 'shape.unknown_key', `操作 ${name} 没有字段「${k}」`, `operation ${name} has no field "${k}"`,
        { zh: `它的字段：${specs.map(([n]) => n).join('、')}`, en: `Its fields: ${specs.map(([n]) => n).join(', ')}` }));
      ok = false;
    }
  }
  if (!ok) return null;

  const out = { op: name };
  let good = true;
  const fieldIssues = issues.length;
  if (name === 'amend') {
    const hasCanon = 'canonical' in op;
    const hasArt = 'article' in op || 'lang' in op || 'text' in op;
    if (hasCanon === hasArt) {
      issues.push(issue(path, 'op.amend_form', 'amend 要么给 article、lang、text，要么只给 canonical', 'amend takes either article, lang and text, or just canonical'));
      return null;
    }
  }
  for (const [field, kind, required] of specs) {
    if (name === 'amend') {
      if ('canonical' in op && field !== 'canonical') continue;
      if (!('canonical' in op) && field === 'canonical') continue;
    }
    const fp = `${path}.${field}`;
    const present = Object.prototype.hasOwnProperty.call(op, field) && op[field] !== undefined;
    const reqd = required || (name === 'amend');
    if (!present) {
      if (reqd) {
        issues.push(issue(fp, 'shape.missing_key', `操作 ${name} 缺少必填字段「${field}」`, `operation ${name} is missing the required field "${field}"`));
        good = false;
      }
      continue;
    }
    const v = op[field];
    switch (kind) {
      case 'acct':
      case 'agent':
      case 'agents':
      case 'int':
      case 'bool':
      case 'scalar': {
        const expected = kind === 'acct' ? T.ACCOUNT : kind === 'agent' ? T.AGENT : kind === 'agents' ? T.AGENTS : kind === 'int' ? T.INT : kind === 'bool' ? T.BOOL : 'scalar';
        // each 的 if 与 do 里有 it；其余字段（含 in）里没有
        const fctx = name === 'each' && field === 'if' ? { ...rc.ctx, it: T.AGENT } : rc.ctx;
        const r = checkExprField(v, expected, fctx, fp, issues);
        if (r === null) good = false;
        else out[field] = r.text;
        break;
      }
      case 'ops': {
        if (!Array.isArray(v) || v.length < 1) {
          issues.push(issue(fp, 'shape.bad_type', 'do 必须是至少含一个操作的数组', 'do must be an array with at least one operation'));
          good = false;
          break;
        }
        if (v.length > P.opsPerRule) {
          issues.push(issue(fp, 'limit.too_many', `each 的 do 至多 ${P.opsPerRule} 个操作（现在 ${v.length}）`, `each\'s do may hold at most ${P.opsPerRule} operations (this has ${v.length})`));
          good = false;
          break;
        }
        const inner = { ...rc, inEach: true, ctx: { ...rc.ctx, it: T.AGENT } };
        const ops = v.map((o, i) => checkOp(o, inner, `${fp}[${i}]`, issues));
        if (ops.some((o) => o === null)) good = false;
        else out.do = ops;
        break;
      }
      case 'reason': {
        if (rc.human && isObj(v)) {
          // 遗法的理由可以写成 { zh, en }（只给 author: "humans" 用，居民提交的规则不接受）
          const zh = checkLiteral(v.zh, { max: LIMITS.reason }, `${fp}.zh`, issues, 'reason.zh');
          const en = checkLiteral(v.en, { max: LIMITS.reason }, `${fp}.en`, issues, 'reason.en');
          if (zh === null || en === null) good = false;
          else out.reason = { zh, en };
        } else {
          const t = checkLiteral(v, { max: LIMITS.reason }, fp, issues, ['reason（拒绝的理由）', 'reason (the reason for refusing)']);
          if (t === null) good = false;
          else out.reason = t;
        }
        break;
      }
      case 'tag': {
        const t = checkLiteral(v, { max: P.tagChars }, fp, issues, ['标签', 'tag']);
        if (t === null) good = false;
        else out.tag = t;
        break;
      }
      case 'varname': {
        if (typeof v !== 'string' || !/^[\p{L}\p{N}_]+$/u.test(v) || Array.from(v).length > P.varNameChars) {
          issues.push(issue(fp, 'shape.bad_name', `变量名只能由字母、数字、下划线组成，至多 ${P.varNameChars} 个字符`, `a variable name may only contain letters, digits and underscores, at most ${P.varNameChars} characters`));
          good = false;
        } else {
          out.var = normalizeText(v);
        }
        break;
      }
      case 'name': {
        const t = checkLiteral(v, { max: LIMITS.name }, fp, issues, ['名字', 'name']);
        if (t === null) good = false;
        else out.name = t;
        break;
      }
      case 'id': {
        if (typeof v !== 'string' || v === '' || v.length > 64 || /\s/.test(v)) {
          issues.push(issue(fp, 'shape.bad_id', `${field} 必须是一个 ID 字符串（如 "l7"）`, `${field} must be an ID string (such as "l7")`));
          good = false;
        } else {
          out[field] = v;
          rc.refs.push({ kind: field === 'law' ? 'law' : field === 'inscription' ? 'inscription' : field === 'place' ? 'place' : 'project', id: v, path: fp });
        }
        break;
      }
      case 'text600': {
        const t = checkLiteral(v, { max: LIMITS.petition }, fp, issues, ['上书的文字', 'petition text'], { allowNewline: true });
        if (t === null) good = false;
        else out.text = t;
        break;
      }
      case 'announceTo': {
        if (typeof v !== 'string') {
          issues.push(issue(fp, 'shape.bad_type', 'to 必须是字符串', 'to must be a string'));
          good = false;
          break;
        }
        const to = normalizeText(v);
        const forms = { zh: '"all"（全城）、"here"（此地）、地点 ID、"tag:<标签>"、"group:<社群ID>"', en: '"all", "here", a place ID, "tag:<tag>", "group:<group ID>"' };
        if (rc.scope.kind === 'place' && to !== 'here') {
          issues.push(issue(fp, 'op.scope', '地点规则的宣告只能发给 "here"（此地的人）', 'a place rule can only announce to "here"'));
          good = false;
        } else if (to === 'all' || to === 'here') {
          out.to = to;
        } else if (to.startsWith('tag:')) {
          const tg = checkLiteral(to.slice(4), { max: P.tagChars }, fp, issues, ['标签', 'tag']);
          if (tg === null) good = false;
          else out.to = `tag:${tg}`;
        } else if (to.startsWith('group:')) {
          const gid = to.slice(6);
          if (!/^g\d+$/.test(gid)) {
            issues.push(issue(fp, 'shape.bad_id', `社群 ID 的写法不对：${to}`, `malformed group ID: ${to}`, { zh: `to 的写法：${forms.zh}`, en: `Forms of to: ${forms.en}` }));
            good = false;
          } else {
            out.to = to;
            rc.refs.push({ kind: 'group', id: gid, path: fp });
          }
        } else if (/^[a-z][a-z0-9-]*$/i.test(to)) {
          out.to = to;
          rc.refs.push({ kind: 'place', id: to, path: fp });
        } else {
          issues.push(issue(fp, 'shape.bad_id', `不认识的宣告对象「${to}」`, `unknown announcement target "${to}"`, { zh: `to 的写法：${forms.zh}`, en: `Forms of to: ${forms.en}` }));
          good = false;
        }
        break;
      }
      case 'template': {
        const t = checkTemplate(v, rc.ctx, fp, issues);
        if (t === null) good = false;
        else out.text = t;
        break;
      }
      case 'renameTarget': {
        if (typeof v !== 'string' || v === '') {
          issues.push(issue(fp, 'shape.bad_id', 'target 必须是 "city" 或地点 ID', 'target must be "city" or a place ID'));
          good = false;
        } else {
          out.target = v;
          if (v !== 'city') rc.refs.push({ kind: 'place', id: v, path: fp });
        }
        break;
      }
      case 'article': {
        if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) {
          issues.push(issue(fp, 'shape.bad_type', 'article 必须是正整数', 'article must be a positive integer'));
          good = false;
        } else out.article = v;
        break;
      }
      case 'lang': {
        if (typeof v !== 'string' || !LANG_RE.test(v)) {
          issues.push(issue(fp, 'shape.bad_type', 'lang 必须是语言标签（如 "zh"、"en"）', 'lang must be a language tag (such as "zh" or "en")'));
          good = false;
        } else out.lang = v;
        break;
      }
      case 'amendText': {
        if (typeof v !== 'string') {
          issues.push(issue(fp, 'shape.bad_type', 'text 必须是字符串', 'text must be a string'));
          good = false;
          break;
        }
        const t = normalizeText(v);
        if (cpLength(t) > LIMITS.amendText) {
          issues.push(issue(fp, 'limit.too_long', `条文不能超过 ${LIMITS.amendText} 个字符`, `an article may not exceed ${LIMITS.amendText} characters`));
          good = false;
        } else if (t !== '' && !screen(t).ok) {
          issues.push(issue(fp, 'moderated', '条文未通过内容审核', 'the article text did not pass content review'));
          good = false;
        } else out.text = t;
        break;
      }
      case 'canonical': {
        if (v !== null && (typeof v !== 'string' || !LANG_RE.test(v))) {
          issues.push(issue(fp, 'shape.bad_type', 'canonical 必须是语言标签或 null', 'canonical must be a language tag or null'));
          good = false;
        } else out.canonical = v;
        break;
      }
      default:
        throw new Error(`checkOp: unknown field kind ${kind}`);
    }
  }
  if (!good || issues.length > fieldIssues) return null;
  if (NEED_AMOUNT.has(name) && out.energy === undefined && out.coins === undefined) {
    issues.push(issue(path, 'op.need_amount', `操作 ${name} 至少要给 energy 或 coins 之一`, `operation ${name} needs at least one of energy or coins`));
    return null;
  }
  // 保持字段的书写顺序稳定：按规格表的顺序
  const ordered = { op: name };
  for (const [field] of specs) if (field in out) ordered[field] = out[field];
  return ordered;
}

/** 一条规则里全部的叶子操作数（each 本身不计，里面的计） */
function leafCount(ops) {
  let n = 0;
  for (const o of ops) n += o.op === 'each' ? o.do.length : 1;
  return n;
}

// ═══════════════════════════════════════════════════════════════
// 规则、规则集与程序
// ═══════════════════════════════════════════════════════════════

/** 把收集到的字面引用交给 lookup 核对（只在提供了 lookup 时） */
function checkRefs(refs, lookup, issues, basePath) {
  if (!lookup) return;
  for (const r of refs) {
    const path = r.path || basePath;
    if (r.kind === 'place' && lookup.place && !lookup.place(r.id)) {
      issues.push(issue(path, 'ref.place', `地点「${r.id}」不存在`, `place "${r.id}" does not exist`, { zh: '地点 ID 见感知里 city.places', en: 'Place IDs are in the perception under city.places' }));
    } else if (r.kind === 'group' && lookup.group && !lookup.group(r.id)) {
      issues.push(issue(path, 'ref.group', `社群「${r.id}」不存在或已解散`, `group "${r.id}" does not exist or has been dissolved`));
    } else if (r.kind === 'law' && lookup.law) {
      const l = lookup.law(r.id);
      if (!l || !l.active) issues.push(issue(path, 'ref.law', `法律「${r.id}」不存在或已不在效`, `law "${r.id}" does not exist or is no longer in force`));
      else if (l.isProcedure) issues.push(issue(path, 'ref.law', `「${r.id}」是立法程序，不能被撤销，只能被新的程序取代`, `"${r.id}" is a procedure of lawmaking; it cannot be repealed, only replaced by a new procedure`));
    } else if (r.kind === 'inscription' && lookup.inscription && !lookup.inscription(r.id)) {
      issues.push(issue(path, 'ref.inscription', `铭刻「${r.id}」不存在`, `inscription "${r.id}" does not exist`));
    }
  }
}

/** 审核表达式里的字面字符串 */
function screenStrings(strs, issues, path) {
  for (const s of strs) {
    if (!screen(s.text).ok) issues.push(issue(path, 'moderated', '表达式里的字符串未通过内容审核', 'a string in the expression did not pass content review'));
  }
}

/**
 * 校验一组规则（一部法律的 rules、一份社群章程、一份地点规则）。
 * opts：{ scope: { kind: 'city' | 'group' | 'place', id? }, human, lookup, path }
 * 返回 { ok, issues, rules }：issues 至多 5 个；rules 是规范化后的规则（失败时为 null）。
 */
export function validateRules(rules, opts = {}) {
  const scope = opts.scope || { kind: 'city' };
  const base = opts.path || 'rules';
  const issues = [];
  if (!Array.isArray(rules)) {
    return { ok: false, issues: [issue(base, 'shape.bad_type', '规则必须是数组', 'rules must be an array', { zh: '例如：[{ "when": "daily", "do": [ … ] }]', en: 'For example: [{ "when": "daily", "do": [ … ] }]' })], rules: null };
  }
  if (rules.length > P.rulesPerLaw) {
    issues.push(issue(base, 'limit.too_many', `规则至多 ${P.rulesPerLaw} 条（现在 ${rules.length}）`, `at most ${P.rulesPerLaw} rules (this has ${rules.length})`));
  }
  const out = [];
  const refs = [];
  rules.forEach((rule, i) => {
    const path = `${base}[${i}]`;
    out.push(checkRule(rule, { scope, human: !!opts.human, refs }, path, issues));
  });
  checkRefs(refs, opts.lookup, issues, base);
  if (issues.length === 0 && Buffer.byteLength(JSON.stringify(out), 'utf8') > P.lawBytes) {
    issues.push(issue(base, 'limit.too_big', `规则的 JSON 不能超过 ${P.lawBytes} 字节`, `the rules' JSON may not exceed ${P.lawBytes} bytes`));
  }
  const ok = issues.length === 0 && out.every((r) => r !== null);
  return { ok, issues: issues.slice(0, MAX_ISSUES), rules: ok ? out : null };
}

/** 校验一条规则，返回规范化后的规则或 null */
function checkRule(rule, env, path, issues) {
  if (!isObj(rule)) {
    issues.push(issue(path, 'shape.bad_type', '规则必须是一个对象', 'a rule must be an object', { zh: '规则的写法：{ "when": 时机, "if": 条件（可省）, "do": [操作…] }', en: 'A rule looks like { "when": timing, "if": condition (optional), "do": [operations…] }' }));
    return null;
  }
  let ok = true;
  for (const k of Object.keys(rule)) {
    if (k !== 'when' && k !== 'if' && k !== 'do') {
      issues.push(issue(`${path}.${k}`, 'shape.unknown_key', `规则没有字段「${k}」`, `a rule has no field "${k}"`, { zh: '规则只有三个字段：when、if、do', en: 'A rule has three fields: when, if, do' }));
      ok = false;
    }
  }
  if (!('when' in rule)) {
    issues.push(issue(`${path}.when`, 'shape.missing_key', '规则缺少 when（时机）', 'the rule is missing when (the timing)'));
    return null;
  }
  const timing = parseWhen(rule.when, env.scope);
  if (timing.error) {
    issues.push(issue(`${path}.when`, 'when.invalid', timing.error.zh, timing.error.en, timing.error.hint));
    return null;
  }
  if (!Array.isArray(rule.do)) {
    issues.push(issue(`${path}.do`, 'shape.bad_type', 'do 必须是操作的数组', 'do must be an array of operations'));
    return null;
  }
  if (rule.do.length < 1 || rule.do.length > P.opsPerRule) {
    issues.push(issue(`${path}.do`, 'limit.too_many', `每条规则的操作数在 1–${P.opsPerRule} 之间（现在 ${rule.do.length}）`, `a rule has between 1 and ${P.opsPerRule} operations (this has ${rule.do.length})`));
    return null;
  }
  const kind = timing.kind;
  const ctx = makeCtx(kind, { action: timing.action || null, event: timing.event || null, premise: env.scope.premise || 0 });
  const rc = { scope: env.scope, timing, human: env.human, ctx, refs: env.refs, inEach: false };
  const out = { when: normalizeText(rule.when) };
  if (rule.if !== undefined && rule.if !== null) {
    const r = checkExprField(rule.if, T.BOOL, ctx, `${path}.if`, issues);
    if (r === null) ok = false;
    else {
      out.if = r.text;
      screenStrings(ctx.strs, issues, `${path}.if`);
      ctx.strs = [];
      env.refs.push(...ctx.refs.map((x) => ({ ...x, path: `${path}.if` })));
      ctx.refs = [];
    }
  }
  const before = issues.length;
  const ops = rule.do.map((o, i) => checkOp(o, rc, `${path}.do[${i}]`, issues));
  if (ops.some((o) => o === null)) ok = false;
  else out.do = ops;
  if (ok && issues.length === before) {
    if (leafCount(ops) > P.opsPerRule) {
      issues.push(issue(`${path}.do`, 'limit.too_many', `每条规则的操作数（含 each 里的）至多 ${P.opsPerRule}`, `a rule may have at most ${P.opsPerRule} operations (including those inside each)`));
      return null;
    }
  }
  screenStrings(ctx.strs, issues, path);
  env.refs.push(...ctx.refs.map((x) => ({ ...x, path })));
  if (!ok) return null;
  return { when: out.when, ...(out.if !== undefined ? { if: out.if } : {}), do: out.do };
}

const PROC_FIELDS = ['proposers', 'voters', 'weight', 'period', 'secret', 'decide'];

/**
 * 校验立法程序：{ ordinary?, constitutional? }，每一类为 { none: true } 或 { proposers, voters, weight?, period, secret, decide }。
 * opts：{ requireBoth（重订要求两类都写）, lookup, path }
 * 返回 { ok, issues, procedure }。
 */
export function validateProcedure(proc, opts = {}) {
  const base = opts.path || 'procedure';
  const issues = [];
  if (!isObj(proc)) {
    return { ok: false, issues: [issue(base, 'shape.bad_type', '立法程序必须是一个对象', 'a procedure must be an object', { zh: '例如：{ "ordinary": { "proposers": "…", "voters": "…", "weight": "1", "period": 12, "secret": true, "decide": "…" } }', en: 'For example: { "ordinary": { "proposers": "…", "voters": "…", "weight": "1", "period": 12, "secret": true, "decide": "…" } }' })], procedure: null };
  }
  for (const k of Object.keys(proc)) {
    if (k !== 'ordinary' && k !== 'constitutional') {
      issues.push(issue(`${base}.${k}`, 'shape.unknown_key', `程序没有字段「${k}」`, `a procedure has no field "${k}"`, { zh: '程序分两类：ordinary（普通法案）与 constitutional（修宪级）', en: 'A procedure has two classes: ordinary and constitutional' }));
    }
  }
  const out = {};
  for (const cls of ['ordinary', 'constitutional']) {
    if (!(cls in proc)) {
      if (opts.requireBoth) issues.push(issue(`${base}.${cls}`, 'shape.missing_key', `重订必须写明两类程序：缺少 ${cls}`, `a refounding must give both classes: ${cls} is missing`, { zh: '这一类不想再立法，可以写 { "none": true }', en: 'If a class should no longer make laws, write { "none": true }' }));
      continue;
    }
    const c = checkProcClass(proc[cls], `${base}.${cls}`, issues);
    if (c) out[cls] = c;
  }
  if (!('ordinary' in proc) && !('constitutional' in proc)) {
    issues.push(issue(base, 'shape.missing_key', '程序至少要写一类（ordinary 或 constitutional）', 'a procedure must define at least one class (ordinary or constitutional)'));
  }
  const ok = issues.length === 0;
  return { ok, issues: issues.slice(0, MAX_ISSUES), procedure: ok ? out : null };
}

function checkProcClass(c, path, issues) {
  if (!isObj(c)) {
    issues.push(issue(path, 'shape.bad_type', '这一类必须是一个对象', 'this class must be an object'));
    return null;
  }
  if ('none' in c) {
    if (c.none !== true || Object.keys(c).length !== 1) {
      issues.push(issue(path, 'shape.bad_type', '{ "none": true } 不能带其他字段', '{ "none": true } cannot carry other fields'));
      return null;
    }
    return { none: true };
  }
  const before = issues.length;
  for (const k of Object.keys(c)) {
    if (!PROC_FIELDS.includes(k)) {
      issues.push(issue(`${path}.${k}`, 'shape.unknown_key', `程序没有字段「${k}」`, `a procedure class has no field "${k}"`, { zh: `它的字段：${PROC_FIELDS.join('、')}`, en: `Its fields: ${PROC_FIELDS.join(', ')}` }));
    }
  }
  const out = {};
  const check = (field, kind, expected) => {
    if (!(field in c)) {
      if (field === 'weight') {
        out.weight = '1';
        return;
      }
      issues.push(issue(`${path}.${field}`, 'shape.missing_key', `缺少必填字段「${field}」`, `the required field "${field}" is missing`));
      return;
    }
    const ctx = makeCtx(kind);
    const r = checkExprField(c[field], expected, ctx, `${path}.${field}`, issues);
    if (r !== null) {
      out[field] = r.text;
      screenStrings(ctx.strs, issues, `${path}.${field}`);
    }
  };
  check('proposers', 'proposers', T.BOOL);
  check('voters', 'voters', T.AGENTS);
  check('weight', 'weight', T.INT);
  check('decide', 'decide', T.BOOL);
  if (!Number.isSafeInteger(c.period) || c.period < P.periodMin || c.period > P.periodMax) {
    issues.push(issue(`${path}.period`, 'shape.bad_type', `period（表决期，单位刻）必须是 ${P.periodMin}–${P.periodMax} 的整数`, `period (the voting period, in ticks) must be an integer from ${P.periodMin} to ${P.periodMax}`));
  } else out.period = c.period;
  if (typeof c.secret !== 'boolean') {
    issues.push(issue(`${path}.secret`, 'shape.bad_type', 'secret 必须是真假（true 为不记名）', 'secret must be a boolean (true for a secret ballot)'));
  } else out.secret = c.secret;
  if (issues.length > before) return null;
  return { proposers: out.proposers, voters: out.voters, weight: out.weight, period: out.period, secret: out.secret, decide: out.decide };
}

/** 方便测试与读法：解析并检查一个孤立的表达式 */
export function checkExpression(src, expected, kind = 'enact', opts = {}) {
  const ctx = makeCtx(kind, opts);
  if (opts.it) ctx.it = opts.it;
  const issues = [];
  const r = checkExprField(src, expected, ctx, 'expr', issues);
  return { ok: r !== null, issues, type: r ? r.type : null, tree: r ? r.tree : null, nodes: r ? countNodes(r.tree) : 0, refs: ctx.refs };
}
