// SPEC-E2 §7.2：表达式的语法，按 PROTOCOL-2 §6.4 的优先级递归下降。
//
// 语法树节点：
//   { t: "int", v } | { t: "str", v } | { t: "bool", v } | { t: "null" }
//   { t: "name", n } | { t: "field", o: Node, f: string } | { t: "call", f: string, a: Node[] }
//   { t: "un", op: "-" | "not", a: Node } | { t: "bin", op, a: Node, b: Node }
// 每个节点另带 p（起点的位置，诊断用，不影响语义）。节点数超过 exprNodes、字符数超过 exprChars 为错误。

import { P } from '../params.js';
import { RuleSyntaxError } from './errors.js';
import { tokenize } from './lexer.js';

const COMPARE = new Set(['==', '!=', '<', '<=', '>', '>=']);
const MAX_DEPTH = 64;

/**
 * 解析一个表达式，返回语法树。
 * 抛 RuleSyntaxError：code 与 pos 见 messages.js。
 */
export function parseExpr(src, { maxChars = P.exprChars, maxNodes = P.exprNodes } = {}) {
  if (typeof src !== 'string') throw new RuleSyntaxError('not_string', null);
  const len = Array.from(src).length;
  if (len > maxChars) throw new RuleSyntaxError('too_long', maxChars + 1, { max: maxChars, length: len });
  const toks = tokenize(src);
  if (toks.length === 1) throw new RuleSyntaxError('empty', 1);
  let k = 0;
  let nodes = 0;
  let depth = 0;

  const peek = () => toks[k];
  const next = () => toks[k++];
  const isOp = (tok, v) => tok.t === 'op' && tok.v === v;
  const isPunct = (tok, v) => tok.t === 'punct' && tok.v === v;
  const isKw = (tok, v) => tok.t === 'kw' && tok.v === v;
  const node = (n, p) => {
    if (++nodes > maxNodes) throw new RuleSyntaxError('too_many_nodes', p, { max: maxNodes });
    return { ...n, p };
  };
  const unexpected = (tok) => new RuleSyntaxError(tok.t === 'eof' ? 'unexpected_end' : 'unexpected_token', tok.p, { tok: tok.t === 'eof' ? '' : tok.t === 'str' ? `'${tok.v}'` : String(tok.v) });
  const enter = (tok) => {
    if (++depth > MAX_DEPTH) throw new RuleSyntaxError('too_deep', tok.p, { max: MAX_DEPTH });
  };

  function parseOr() {
    let left = parseAnd();
    while (isKw(peek(), 'or')) {
      const t = next();
      const right = parseAnd();
      left = node({ t: 'bin', op: 'or', a: left, b: right }, t.p);
    }
    return left;
  }

  function parseAnd() {
    let left = parseNot();
    while (isKw(peek(), 'and')) {
      const t = next();
      const right = parseNot();
      left = node({ t: 'bin', op: 'and', a: left, b: right }, t.p);
    }
    return left;
  }

  function parseNot() {
    const t = peek();
    if (isKw(t, 'not')) {
      next();
      enter(t);
      const a = parseNot();
      depth--;
      return node({ t: 'un', op: 'not', a }, t.p);
    }
    return parseCompare();
  }

  function parseCompare() {
    const left = parseSum();
    const t = peek();
    if (t.t === 'op' && COMPARE.has(t.v)) {
      next();
      const right = parseSum();
      const again = peek();
      if (again.t === 'op' && COMPARE.has(again.v)) throw new RuleSyntaxError('chained_comparison', again.p);
      return node({ t: 'bin', op: t.v, a: left, b: right }, t.p);
    }
    return left;
  }

  function parseSum() {
    let left = parseProduct();
    for (;;) {
      const t = peek();
      if (!(isOp(t, '+') || isOp(t, '-'))) return left;
      next();
      const right = parseProduct();
      left = node({ t: 'bin', op: t.v, a: left, b: right }, t.p);
    }
  }

  function parseProduct() {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (!(isOp(t, '*') || isOp(t, '/') || isOp(t, '%'))) return left;
      next();
      const right = parseUnary();
      left = node({ t: 'bin', op: t.v, a: left, b: right }, t.p);
    }
  }

  function parseUnary() {
    const t = peek();
    if (isOp(t, '-')) {
      next();
      enter(t);
      const a = parseUnary();
      depth--;
      return node({ t: 'un', op: '-', a }, t.p);
    }
    return parsePostfix();
  }

  function parsePostfix() {
    let e = parsePrimary();
    while (isPunct(peek(), '.')) {
      const dot = next();
      const name = peek();
      if (name.t !== 'name') {
        if (name.t === 'kw') throw new RuleSyntaxError('keyword_as_name', name.p, { tok: name.v });
        throw new RuleSyntaxError('expected_name', name.p, { tok: name.t === 'eof' ? '' : String(name.v) });
      }
      next();
      e = node({ t: 'field', o: e, f: name.v }, dot.p);
    }
    return e;
  }

  function parsePrimary() {
    const t = next();
    switch (t.t) {
      case 'int':
        return node({ t: 'int', v: t.v }, t.p);
      case 'str':
        return node({ t: 'str', v: t.v }, t.p);
      case 'kw':
        if (t.v === 'true') return node({ t: 'bool', v: true }, t.p);
        if (t.v === 'false') return node({ t: 'bool', v: false }, t.p);
        if (t.v === 'null') return node({ t: 'null' }, t.p);
        throw unexpected(t); // and / or / not 出现在操作数的位置
      case 'name': {
        if (isPunct(peek(), '(')) {
          next();
          const args = [];
          if (isPunct(peek(), ')')) {
            next();
          } else {
            enter(t);
            for (;;) {
              args.push(parseOr());
              const sep = next();
              if (isPunct(sep, ')')) break;
              if (!isPunct(sep, ',')) {
                k--;
                throw sep.t === 'eof' ? new RuleSyntaxError('unclosed_paren', t.p) : unexpected(sep);
              }
            }
            depth--;
          }
          return node({ t: 'call', f: t.v, a: args }, t.p);
        }
        return node({ t: 'name', n: t.v }, t.p);
      }
      case 'punct':
        if (t.v === '(') {
          enter(t);
          const e = parseOr();
          depth--;
          const close = next();
          if (!isPunct(close, ')')) {
            k--;
            throw close.t === 'eof' ? new RuleSyntaxError('unclosed_paren', t.p) : unexpected(close);
          }
          return e; // 括号只影响结构，不产生节点
        }
        throw unexpected(t);
      default:
        throw unexpected(t);
    }
  }

  const tree = parseOr();
  const rest = peek();
  if (rest.t !== 'eof') {
    if (isOp(rest, '=')) throw new RuleSyntaxError('single_equals', rest.p);
    throw unexpected(rest);
  }
  return tree;
}

// ── 规范序列化（指纹用，SPEC-E2 §7.11）与节点计数 ───────────────

const escapeStr = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** 完全加括号、单空格分隔、字符串用单引号 */
export function canonExpr(n) {
  switch (n.t) {
    case 'int': return String(n.v);
    case 'str': return `'${escapeStr(n.v)}'`;
    case 'bool': return n.v ? 'true' : 'false';
    case 'null': return 'null';
    case 'name': return n.n;
    case 'field': return `${canonExpr(n.o)}.${n.f}`;
    case 'call': return `${n.f}(${n.a.map(canonExpr).join(', ')})`;
    case 'un': return `(${n.op} ${canonExpr(n.a)})`;
    case 'bin': return `(${canonExpr(n.a)} ${n.op} ${canonExpr(n.b)})`;
    default: throw new Error(`canonExpr: unknown node ${n.t}`);
  }
}

/** 语法树的节点数 */
export function countNodes(n) {
  switch (n.t) {
    case 'field': return 1 + countNodes(n.o);
    case 'call': return 1 + n.a.reduce((s, x) => s + countNodes(x), 0);
    case 'un': return 1 + countNodes(n.a);
    case 'bin': return 1 + countNodes(n.a) + countNodes(n.b);
    default: return 1;
  }
}

// ── 解析缓存 ──────────────────────────────────────────────────
// 编译后的语法树缓存在内存里（模块级，不进世界状态、不进快照）；缓存只按文本，不影响结果。

const CACHE = new Map();
const CACHE_MAX = 4000;

/** 带缓存的解析（语法树必须当作只读） */
export function parseCached(src) {
  const key = `${P.exprChars}/${P.exprNodes}/${src}`;
  const hit = CACHE.get(key);
  if (hit) {
    if (hit.error) throw hit.error;
    return hit.tree;
  }
  try {
    const tree = parseExpr(src);
    if (CACHE.size >= CACHE_MAX) CACHE.clear();
    CACHE.set(key, { tree });
    return tree;
  } catch (e) {
    if (!(e instanceof RuleSyntaxError)) throw e;
    if (CACHE.size >= CACHE_MAX) CACHE.clear();
    CACHE.set(key, { error: e });
    throw e;
  }
}
