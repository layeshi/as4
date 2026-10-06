// SPEC-E2 §7.4：表达式的求值。
//
// 值：整数（number）、真假、字符串、null、引用（居民 / 社群 / 灵魂 / 城公库）、列表（引用的数组）、
// 记录（city / var / args / result / event，普通对象）。
//
// 求值是纯的：除了 sample 推进随机数，不改变世界。本文件不碰世界：需要世界的地方通过 host 取得。
//
// host 接口（引擎在 engine/rulehost.js 里按世界实现，纯函数测试里用假的）：
//   host.city                      城的数字（普通对象：day dayOfMonth month season treasury …）
//   host.vars                      法律设定的变量（普通对象，没设过的为 undefined）
//   host.agents() host.cradle()    在世居民 / 摇篮中的灵魂（引用的数组，按 ID 升序）
//   host.tagged(tag) host.members(gid) host.at(pid)     居民的引用数组（在世者，按 ID 升序）
//   host.hasTag(ref, tag) host.inGroup(ref, gid) host.isAwake(ref)     真假
//   host.isWild(pid) host.ownerOf(pid) host.weather(code)
//   host.lookup(kind, text)        'agent' | 'group' | 'soul' → 引用或 null（居民可用 ID 或精确的名字）
//   host.field(ref, name)          居民 / 社群 / 灵魂的字段：数字、字符串、null 或引用；不存在的字段返回 undefined
//   host.rngInt(n)                 [0, n) 的随机整数（推进世界的随机数流）
//
// 步数（§7.4）：每求一个语法节点 1 步；filter、sum、top、count、contains、each 每遍历一个元素 1 步；收集每个操作 5 步。
// 超过 ruleFuel 为错误 fuel。整数运算的结果绝对值超过 MAX_SAFE_INTEGER 为 overflow；/ 与 % 向下取整，除数为 0 为 div0；
// 运行时类型不符（含 any 字段取到意外的值、对 null 取字段）为 type。

import { P } from '../params.js';
import { RuleError } from './errors.js';
import { expressionDependencies, sortWork } from './plan.js';

// ── 值 ─────────────────────────────────────────────────────

export const TREASURY = Object.freeze({ $: 'treasury', id: 'treasury' });
export const agentRef = (id) => ({ $: 'agent', id });
export const groupRef = (id) => ({ $: 'group', id });
export const soulRef = (id) => ({ $: 'soul', id });

export const isRef = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.$ === 'string';
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.$ !== 'string';
const isInt = (v) => typeof v === 'number' && Number.isSafeInteger(v);

const kindOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'list';
  if (isRef(v)) return v.$;
  return typeof v === 'object' ? 'record' : typeof v;
};

/** ID 的数字部分（a17 → 17），用于「按 ID 升序」 */
const idNum = (id) => Number(String(id).slice(1)) || 0;
const byId = (a, b) => idNum(a.id) - idNum(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const typeErr = (msg) => new RuleError('type', msg);

/** 求值的预算：一次调用共用一个 */
export function newBudget(fuel = P.ruleFuel) {
  return { steps: 0, fuel };
}

export function tick(budget, n = 1) {
  budget.steps += n;
  budget.onSteps?.(n);
  if (budget.steps > budget.fuel) throw new RuleError('fuel', `${budget.steps} > ${budget.fuel}`);
}

// ── 整数运算 ─────────────────────────────────────────────────

const SMALL = 2 ** 40;

function safe(r) {
  if (!Number.isSafeInteger(r)) throw new RuleError('overflow');
  return r;
}

/** 向下取整的除法。a、b 为安全整数；b 为 0 是 div0。数值很大时用 BigInt，避免浮点除法在边界上差 1 */
export function floorDiv(a, b) {
  if (b === 0) throw new RuleError('div0');
  if (Math.abs(a) < SMALL) return Math.floor(a / b);
  const A = BigInt(a);
  const B = BigInt(b);
  let q = A / B;
  if ((A % B !== 0n) && ((A < 0n) !== (B < 0n))) q -= 1n;
  return safe(Number(q));
}

/** a − b × floor(a / b) */
export function floorMod(a, b) {
  if (b === 0) throw new RuleError('div0');
  if (Math.abs(a) < SMALL) return a - b * Math.floor(a / b);
  const A = BigInt(a);
  const B = BigInt(b);
  const r = A % B;
  return safe(Number(r !== 0n && ((r < 0n) !== (B < 0n)) ? r + B : r));
}

// ── 求值 ────────────────────────────────────────────────────

/**
 * 对一个语法树求值。
 * ctx：{ host, env, budget }；env 是名字 → 值的对象（actor、args、result、here、event、yes…、it）。
 */
export function evalNode(n, ctx) {
  tick(ctx.budget);
  if (!ctx.budget.memo) return evalUncached(n, ctx);
  const d = expressionDependencies(n);
  if (!d.pure) return evalUncached(n, ctx);
  const key = d.freeIt ? JSON.stringify(ctx.env.it ?? null) : '';
  let values = ctx.budget.memo.get(n);
  if (values?.has(key)) return values.get(key);
  const value = evalUncached(n, ctx); // Lazy: errors and unselected branches are never cached/eagerly evaluated.
  if (!values) { values = new Map(); ctx.budget.memo.set(n, values); }
  values.set(key, value);
  return value;
}

function evalUncached(n, ctx) {
  switch (n.t) {
    case 'int':
    case 'str':
    case 'bool':
      return n.v;
    case 'null':
      return null;
    case 'name':
      return nameValue(n.n, ctx);
    case 'field':
      return fieldValue(evalNode(n.o, ctx), n.f, ctx);
    case 'un': {
      const v = evalNode(n.a, ctx);
      if (n.op === 'not') {
        if (typeof v !== 'boolean') throw typeErr(`not 需要真假，得到 ${kindOf(v)}`);
        return !v;
      }
      if (!isInt(v)) throw typeErr(`负号需要整数，得到 ${kindOf(v)}`);
      return v === 0 ? 0 : safe(-v);
    }
    case 'bin':
      return binValue(n, ctx);
    case 'call':
      return callValue(n, ctx);
    default:
      throw new Error(`evalNode: unknown node ${n.t}`);
  }
}

function nameValue(name, ctx) {
  const { host, env } = ctx;
  switch (name) {
    case 'city': return host.city;
    case 'var': return host.vars;
    case 'treasury': return TREASURY;
    case 'agents': return host.agents();
    case 'cradle': return host.cradle();
    default:
      if (Object.prototype.hasOwnProperty.call(env, name) && env[name] !== undefined) return env[name];
      throw typeErr(`名字 ${name} 在这里没有值`);
  }
}

function fieldValue(o, f, ctx) {
  if (o === null) throw typeErr(`对 null 取字段 ${f}`);
  if (isRef(o)) {
    if (o.$ === 'treasury') throw typeErr(`城公库没有字段 ${f}`);
    const v = ctx.host.field(o, f);
    if (v === undefined) throw typeErr(`${o.$} 没有字段 ${f}`);
    return v;
  }
  if (isPlain(o)) {
    const v = Object.prototype.hasOwnProperty.call(o, f) ? o[f] : undefined;
    return v === undefined ? null : v;
  }
  throw typeErr(`${kindOf(o)} 没有字段 ${f}`);
}

function numeric(v, what) {
  if (!isInt(v)) throw typeErr(`${what}需要整数，得到 ${kindOf(v)}`);
  return v;
}

function boolean(v, what) {
  if (typeof v !== 'boolean') throw typeErr(`${what}需要真假，得到 ${kindOf(v)}`);
  return v;
}

function equals(a, b) {
  if (a === null || b === null) return a === b;
  const ka = kindOf(a);
  const kb = kindOf(b);
  if (ka !== kb) throw typeErr(`不能比较 ${ka} 与 ${kb}`);
  if (isRef(a)) return a.id === b.id;
  if (ka === 'list' || ka === 'record') throw typeErr(`不能比较${ka}`);
  return a === b;
}

function binValue(n, ctx) {
  const op = n.op;
  if (op === 'and') {
    if (!boolean(evalNode(n.a, ctx), 'and')) return false;
    return boolean(evalNode(n.b, ctx), 'and');
  }
  if (op === 'or') {
    if (boolean(evalNode(n.a, ctx), 'or')) return true;
    return boolean(evalNode(n.b, ctx), 'or');
  }
  const a = evalNode(n.a, ctx);
  const b = evalNode(n.b, ctx);
  switch (op) {
    case '+': return safe(numeric(a, '+') + numeric(b, '+'));
    case '-': return safe(numeric(a, '-') - numeric(b, '-'));
    case '*': {
      const r = numeric(a, '*') * numeric(b, '*');
      return r === 0 ? 0 : safe(r);
    }
    case '/': return floorDiv(numeric(a, '/'), numeric(b, '/'));
    case '%': return floorMod(numeric(a, '%'), numeric(b, '%'));
    case '<': return numeric(a, '<') < numeric(b, '<');
    case '<=': return numeric(a, '<=') <= numeric(b, '<=');
    case '>': return numeric(a, '>') > numeric(b, '>');
    case '>=': return numeric(a, '>=') >= numeric(b, '>=');
    case '==': return equals(a, b);
    case '!=': return !equals(a, b);
    default: throw new Error(`binValue: unknown operator ${op}`);
  }
}

// ── 函数 ────────────────────────────────────────────────────

function listOf(v, what) {
  if (!Array.isArray(v)) throw typeErr(`${what}需要列表，得到 ${kindOf(v)}`);
  return v;
}

function strOf(v, what) {
  if (typeof v !== 'string') throw typeErr(`${what}需要字符串，得到 ${kindOf(v)}`);
  return v;
}

function agentOf(v, what) {
  if (!isRef(v) || v.$ !== 'agent') throw typeErr(`${what}需要居民，得到 ${kindOf(v)}`);
  return v;
}

/** 对列表的每个元素求式子（it 绑定为该元素），每个元素 1 步 */
function eachElement(list, ctx, fn) {
  const saved = ctx.env.it;
  try {
    for (const el of list) {
      tick(ctx.budget);
      ctx.env.it = el;
      fn(el);
    }
  } finally {
    ctx.env.it = saved;
  }
}

function callValue(n, ctx) {
  const { host } = ctx;
  const a = n.a;
  const ev = (i) => evalNode(a[i], ctx);
  switch (n.f) {
    case 'min':
    case 'max': {
      let best = numeric(ev(0), n.f);
      for (let i = 1; i < a.length; i++) {
        const v = numeric(ev(i), n.f);
        best = n.f === 'min' ? Math.min(best, v) : Math.max(best, v);
      }
      return best;
    }
    case 'abs': {
      const v = numeric(ev(0), 'abs');
      return v === 0 ? 0 : Math.abs(v);
    }
    case 'if':
      return boolean(ev(0), 'if 的条件') ? ev(1) : ev(2); // 只求被选中的那一支
    case 'default': {
      const x = ev(0);
      return x === null ? ev(1) : x; // 备选只在需要时才求
    }
    case 'count': {
      const l = listOf(ev(0), 'count');
      tick(ctx.budget, l.length);
      return l.length;
    }
    case 'sum': {
      const l = listOf(ev(0), 'sum');
      let total = 0;
      eachElement(l, ctx, () => {
        total = safe(total + numeric(evalNode(a[1], ctx), 'sum 的式子'));
      });
      return total;
    }
    case 'filter': {
      const l = listOf(ev(0), 'filter');
      const out = [];
      eachElement(l, ctx, (el) => {
        if (boolean(evalNode(a[1], ctx), 'filter 的条件')) out.push(el);
      });
      return out;
    }
    case 'top': {
      const l = listOf(ev(0), 'top');
      const keyed = [];
      eachElement(l, ctx, (el) => keyed.push({ el, key: numeric(evalNode(a[1], ctx), 'top 的式子') }));
      const k = numeric(ev(2), 'top 的 n');
      if (ctx.budget.memo) tick(ctx.budget, sortWork(l.length));
      keyed.sort((x, y) => y.key - x.key || byId(x.el, y.el));
      return keyed.slice(0, Math.max(0, k)).map((x) => x.el);
    }
    case 'sample': {
      const l = listOf(ev(0), 'sample');
      const k = numeric(ev(1), 'sample 的 n');
      if (ctx.budget.memo) tick(ctx.budget, l.length + sortWork(l.length));
      return sampleList(l, k, host);
    }
    case 'contains': {
      const l = listOf(ev(0), 'contains');
      const x = agentOf(ev(1), 'contains');
      tick(ctx.budget, l.length);
      return l.some((el) => isRef(el) && el.$ === x.$ && el.id === x.id);
    }
    case 'tagged': return host.tagged(strOf(ev(0), 'tagged'));
    case 'members': return host.members(strOf(ev(0), 'members'));
    case 'at': return host.at(strOf(ev(0), 'at'));
    case 'has_tag': {
      const who = agentOf(ev(0), 'has_tag');
      return host.hasTag(who, strOf(ev(1), 'has_tag'));
    }
    case 'in_group': {
      const who = agentOf(ev(0), 'in_group');
      return host.inGroup(who, strOf(ev(1), 'in_group'));
    }
    case 'awake': return host.isAwake(agentOf(ev(0), 'awake'));
    case 'is_wild': return host.isWild(strOf(ev(0), 'is_wild'));
    case 'owner': return host.ownerOf(strOf(ev(0), 'owner'));
    case 'agent': return host.lookup('agent', strOf(ev(0), 'agent'));
    case 'group': return host.lookup('group', strOf(ev(0), 'group'));
    case 'soul': return host.lookup('soul', strOf(ev(0), 'soul'));
    case 'names': {
      const l = listOf(ev(0), 'names');
      const sep = a.length > 1 ? strOf(ev(1), 'names 的分隔符') : ', ';
      if (ctx.budget.memo) tick(ctx.budget, l.length);
      return l.map((el) => nameOf(el, host)).join(sep);
    }
    case 'weather': return host.weather(strOf(ev(0), 'weather'));
    default:
      throw typeErr(`不认识的函数 ${n.f}`);
  }
}

/** 一个引用的名字（居民、社群、灵魂） */
export function nameOf(ref, host) {
  if (!isRef(ref) || ref.$ === 'treasury') throw typeErr(`${kindOf(ref)} 没有名字`);
  const v = host.field(ref, 'name');
  if (typeof v !== 'string') throw typeErr(`${ref.$} ${ref.id} 没有名字`);
  return v;
}

/**
 * 从列表里不放回地随机取 n 个，结果按 ID 升序。n ≥ 列表长度时取全部（不消耗随机数）；n ≤ 0 时为空。
 * 做法：部分 Fisher–Yates（第 i 步用 rngInt(len − i) 选出剩下的元素之一换到第 i 位），随机数的消耗次数 = n。
 */
export function sampleList(list, n, host) {
  const len = list.length;
  if (n >= len) return list.slice();
  if (n <= 0) return [];
  const pool = list.slice();
  for (let i = 0; i < n; i++) {
    const j = i + host.rngInt(len - i);
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  return pool.slice(0, n).sort(byId);
}

// ── 入口 ────────────────────────────────────────────────────

/**
 * 求一个已解析表达式的值。env：名字 → 值。budget 缺省为新的一份。
 * 返回值是语言里的值；调用者负责按期望的类型检查（asInt / asBool …）。
 */
export function evaluate(tree, host, env = {}, budget = newBudget()) {
  const ctx = { host, env: { ...env }, budget };
  return evalNode(tree, ctx);
}

export const asInt = (v, what = '值') => numeric(v, what);
export const asBool = (v, what = '值') => boolean(v, what);
