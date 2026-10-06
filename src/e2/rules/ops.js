// SPEC-E2 §7.5：一次调用的「收集」——只读：对规则的每个操作求出所有字段的值，得到「意图」列表。
// 施行（修改世界）在引擎里（engine/rules.js），按 §7.7 逐个意图进行。
//
// 任何一步出错（fuel / type / overflow / div0）：整次收集失败，抛 RuleError；调用者丢弃全部意图并记 rule_error。
// before 规则出错时视为「没有拒绝、没有费用」。
//
// 意图（intent）的形状（账户 acct 为 { k: 'treasury' } | { k: 'agent', id } | { k: 'group', id } | { k: 'soul', id }）：
//   { op: 'transfer', from: acct, to: acct, energy, coins }       数额已是非负整数，不全为 0
//   { op: 'share', from: acct, among: [居民 ID…], energy, coins }
//   { op: 'deny', reason }                                         reason 为字符串，遗法里可以是 { zh, en }
//   { op: 'fee', to: acct, energy, coins }
//   { op: 'set', var, value }
//   { op: 'tag' | 'untag', who: 居民 ID, tag }
//   { op: 'announce', to, text }                                   text 已插值
//   { op: 'exile' | 'pardon', who: 居民 ID }
//   { op: 'rename', target, name }
//   { op: 'mint', coins, to: acct }
//   { op: 'protect' | 'unprotect', inscription }
//   { op: 'amend', article, lang, text } | { op: 'amend', canonical }
//   { op: 'repeal', law } · { op: 'fund', project, energy } · { op: 'cede', place, to: acct } · { op: 'seize', place } · { op: 'petition', text }
// each 在收集时已展开：它里面的操作对每个元素各出一份意图，顺序是「元素 1 的全部操作、元素 2 的……」。

import { P } from '../params.js';
import { cpLength, truncateCp } from '../../text.js';
import { RuleError } from './errors.js';
import { parseCached } from './parser.js';
import { parseTemplate } from './check.js';
import { evalNode, tick, isRef, nameOf } from './eval.js';

const MAX_ANNOUNCE = 1200;
const typeErr = (msg) => new RuleError('type', msg);

function evalExpr(src, ctx) {
  let tree;
  try {
    if (ctx.budget.memo) {
      ctx.budget.trees ||= new Map();
      tree = ctx.budget.trees.get(src);
      if (!tree) { tree = parseCached(src); ctx.budget.trees.set(src, tree); }
    } else tree = parseCached(src);
  } catch (e) {
    throw typeErr(`表达式无法解析：${src}`);
  }
  return evalNode(tree, ctx);
}

/** 账户：城公库、在世的居民、未解散的社群、摇篮中的灵魂（只能作为去向） */
function account(v, ctx, { dest = false, what = '账户' } = {}) {
  if (!isRef(v)) throw typeErr(`${what}不是一个账户（得到 ${v === null ? 'null' : typeof v}）`);
  if (v.$ === 'treasury') return { k: 'treasury' };
  if (v.$ === 'soul') {
    if (!dest) throw typeErr('灵魂只能作为转入的一方');
    if (!ctx.host.isLive(v)) throw typeErr(`灵魂 ${v.id} 不在摇篮里`);
    return { k: 'soul', id: v.id };
  }
  if (!ctx.host.isLive(v)) throw typeErr(`${v.$ === 'agent' ? '居民' : '社群'} ${v.id} 已不在世`);
  return { k: v.$, id: v.id };
}

function agentId(v, ctx, what) {
  if (!isRef(v) || v.$ !== 'agent') throw typeErr(`${what}需要居民`);
  if (!ctx.host.isLive(v)) throw typeErr(`居民 ${v.id} 已不在世`);
  return v.id;
}

function amount(src, ctx, what) {
  if (src === undefined) return 0;
  const v = evalExpr(src, ctx);
  if (!Number.isSafeInteger(v)) throw typeErr(`${what}需要整数`);
  return v > 0 ? v : 0;
}

/** 插值宣告模板：整数、字符串、居民的名字填进花括号；{{ 与 }} 是花括号本身 */
function interpolate(template, ctx) {
  let parts;
  try {
    parts = parseTemplate(template);
  } catch (e) {
    throw typeErr('宣告的模板格式不对');
  }
  let out = '';
  for (const part of parts) {
    if (part.lit !== undefined) {
      out += part.lit;
      continue;
    }
    const v = evalExpr(part.expr.trim(), ctx);
    if (Number.isSafeInteger(v)) out += String(v);
    else if (typeof v === 'string') out += v;
    else if (isRef(v) && v.$ === 'agent') out += nameOf(v, ctx.host);
    else throw typeErr('花括号里的结果必须是整数、字符串或居民');
  }
  return cpLength(out) > MAX_ANNOUNCE ? truncateCp(out, MAX_ANNOUNCE - 1) + '…' : out;
}

function collectOp(op, ctx, out) {
  tick(ctx.budget, 5); // 收集每个操作 5 步
  const ev = (src) => evalExpr(src, ctx);
  switch (op.op) {
    case 'transfer': {
      const from = account(ev(op.from), ctx, { what: 'from' });
      const to = account(ev(op.to), ctx, { dest: true, what: 'to' });
      const energy = amount(op.energy, ctx, 'energy');
      const coins = amount(op.coins, ctx, 'coins');
      if (energy > 0 || coins > 0) out.push({ op: 'transfer', from, to, energy, coins });
      return;
    }
    case 'share': {
      const from = account(ev(op.from), ctx, { what: 'from' });
      const list = ev(op.among);
      if (!Array.isArray(list)) throw typeErr('among 需要居民的列表');
      const among = list.map((x) => agentId(x, ctx, 'among'));
      const energy = amount(op.energy, ctx, 'energy');
      const coins = amount(op.coins, ctx, 'coins');
      if (energy > 0 || coins > 0) out.push({ op: 'share', from, among, energy, coins });
      return;
    }
    case 'each': {
      const list = ev(op.in);
      if (!Array.isArray(list)) throw typeErr('in 需要居民的列表');
      const saved = ctx.env.it;
      try {
        for (const el of list) {
          tick(ctx.budget); // 每遍历一个元素 1 步
          if (!isRef(el) || el.$ !== 'agent') throw typeErr('each 只能遍历居民');
          ctx.env.it = el;
          if (op.if !== undefined) {
            const c = ev(op.if);
            if (typeof c !== 'boolean') throw typeErr('each 的 if 需要真假');
            if (!c) continue;
          }
          for (const inner of op.do) collectOp(inner, ctx, out);
        }
      } finally {
        ctx.env.it = saved;
      }
      return;
    }
    case 'deny':
      out.push({ op: 'deny', reason: op.reason });
      return;
    case 'fee': {
      const to = account(ev(op.to), ctx, { dest: true, what: 'to' });
      const energy = amount(op.energy, ctx, 'energy');
      const coins = amount(op.coins, ctx, 'coins');
      if (energy > 0 || coins > 0) out.push({ op: 'fee', to, energy, coins });
      return;
    }
    case 'set': {
      const v = ev(op.value);
      if (!(v === null || typeof v === 'boolean' || Number.isSafeInteger(v) || typeof v === 'string')) throw typeErr('变量的值必须是整数、真假、字符串或 null');
      if (typeof v === 'string' && cpLength(v) > P.exprChars) throw typeErr('字符串变量的值太长');
      if (typeof v === 'string' && cpLength(v) > 140) throw typeErr('字符串变量的值至多 140 个字符');
      out.push({ op: 'set', var: op.var, value: v });
      return;
    }
    case 'tag':
    case 'untag':
      out.push({ op: op.op, who: agentId(ev(op.who), ctx, 'who'), tag: op.tag });
      return;
    case 'announce':
      out.push({ op: 'announce', to: op.to, text: interpolate(op.text, ctx) });
      return;
    case 'exile':
    case 'pardon':
      out.push({ op: op.op, who: agentId(ev(op.who), ctx, 'who') });
      return;
    case 'rename':
      out.push({ op: 'rename', target: op.target, name: op.name });
      return;
    case 'mint': {
      const coins = amount(op.coins, ctx, 'coins');
      const to = op.to === undefined ? { k: 'treasury' } : account(ev(op.to), ctx, { dest: true, what: 'to' });
      if (to.k === 'soul') throw typeErr('旧币不能交给灵魂');
      if (coins > 0) out.push({ op: 'mint', coins, to });
      return;
    }
    case 'protect':
    case 'unprotect':
      out.push({ op: op.op, inscription: op.inscription });
      return;
    case 'amend':
      out.push('canonical' in op ? { op: 'amend', canonical: op.canonical } : { op: 'amend', article: op.article, lang: op.lang, text: op.text });
      return;
    case 'repeal':
      out.push({ op: 'repeal', law: op.law });
      return;
    case 'fund': {
      const energy = amount(op.energy, ctx, 'energy');
      if (energy > 0) out.push({ op: 'fund', project: op.project, energy });
      return;
    }
    case 'cede': {
      const to = account(ev(op.to), ctx, { dest: true, what: 'to' });
      if (to.k !== 'agent' && to.k !== 'group') throw typeErr('地点只能转给居民或社群');
      out.push({ op: 'cede', place: op.place, to });
      return;
    }
    case 'seize':
      out.push({ op: 'seize', place: op.place });
      return;
    case 'petition':
      out.push({ op: 'petition', text: op.text });
      return;
    default:
      throw typeErr(`不认识的操作 ${op.op}`);
  }
}

/**
 * 收集一条规则的意图。ctx：{ host, env, budget }（见 eval.js）。
 * 条件不成立时返回空数组（不记事件）。出错抛 RuleError。
 */
export function collectRule(rule, ctx) {
  if (rule.if !== undefined) {
    const c = evalExpr(rule.if, ctx);
    if (typeof c !== 'boolean') throw typeErr('条件需要真假');
    if (!c) return [];
  }
  const out = [];
  for (const op of rule.do) collectOp(op, ctx, out);
  return out;
}
