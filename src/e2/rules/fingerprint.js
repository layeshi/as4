// SPEC-E2 §7.11：指纹。
//
// 规范形：键按字母排序；表达式字符串替换为语法树的规范序列化（完全加括号、单空格分隔、字符串用单引号）；
// JSON.stringify；SHA-256；取前 12 个十六进制字符。程序的每一类单独算一个指纹（前缀 `proc:`）。
// 空白与括号不同、语义相同的规则得到同一指纹。公共接口与观测站用指纹追踪规则的复制与传播；对居民没有机制作用。

import { createHash } from 'node:crypto';
import { canonExpr, parseCached } from './parser.js';
import { parseTemplate, OP_FIELDS } from './check.js';

const EXPR_KINDS = new Set(['acct', 'agent', 'agents', 'int', 'bool', 'scalar']);

/** 键按字母排序的 JSON（递归） */
export function sortedJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${sortedJson(v[k])}`).join(',')}}`;
}

const sha12 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

const canon = (src) => canonExpr(parseCached(src));

/** 模板的规范形：字面部分原样，花括号里的表达式换成规范序列化 */
function canonTemplate(text) {
  return parseTemplate(text).map((p) => (p.lit !== undefined ? { lit: p.lit } : { expr: canon(p.expr.trim()) }));
}

function fieldKind(op, field) {
  const hit = (OP_FIELDS[op] || []).find(([n]) => n === field);
  return hit ? hit[1] : null;
}

function canonOp(op) {
  const out = {};
  for (const [k, v] of Object.entries(op)) {
    if (k === 'op') {
      out.op = v;
      continue;
    }
    const kind = fieldKind(op.op, k);
    if (EXPR_KINDS.has(kind)) out[k] = canon(v);
    else if (kind === 'ops') out[k] = v.map(canonOp);
    else if (kind === 'template') out[k] = canonTemplate(v);
    else out[k] = v;
  }
  return out;
}

/** 一条规则的规范形（对象） */
export function canonRule(rule) {
  const out = { when: rule.when.trim(), do: rule.do.map(canonOp) };
  if (rule.if !== undefined) out.if = canon(rule.if);
  return out;
}

/** 一条规则的指纹：12 个十六进制字符 */
export function fingerprintRule(rule) {
  return sha12(sortedJson(canonRule(rule)));
}

/** 一组规则的指纹（每条一个） */
export const fingerprintRules = (rules) => rules.map(fingerprintRule);

/** 一类程序的规范形与指纹（前缀 proc:） */
export function fingerprintProcClass(c) {
  if (c.none) return `proc:${sha12(sortedJson({ none: true }))}`;
  return `proc:${sha12(sortedJson({
    proposers: canon(c.proposers), voters: canon(c.voters), weight: canon(c.weight), period: c.period, secret: c.secret, decide: canon(c.decide),
  }))}`;
}
