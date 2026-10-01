// SPEC-E2 §7.2：表达式的词法。手写扫描器，不用正则回溯。
//
// 记号：整数（至多 15 位）、字符串（单引号，至多 140 个字符）、名字、关键字（and or not true false null）、
// 运算符、括号、逗号、点。位置按码点计，从 1 数起。

import { RuleSyntaxError } from './errors.js';

export const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false', 'null']);

const isDigit = (c) => c >= '0' && c <= '9';
const isNameStart = (c) => c === '_' || /^\p{L}$/u.test(c);
const isNameChar = (c) => c === '_' || /^[\p{L}\p{N}]$/u.test(c);
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';

export const MAX_INT_DIGITS = 15;
export const MAX_STRING_CHARS = 140;

/**
 * 把表达式切成记号。每个记号 { t, v, p }：
 *   t：'int' | 'str' | 'name' | 'kw' | 'op' | 'punct' | 'eof'；v：值（整数为数字，字符串为反转义后的内容，其余为文本）；p：位置。
 */
export function tokenize(src) {
  const cs = Array.from(src);
  const out = [];
  let i = 0;
  const at = (k) => (k < cs.length ? cs[k] : '');
  while (i < cs.length) {
    const c = cs[i];
    const p = i + 1;
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (isDigit(c)) {
      let j = i;
      while (j < cs.length && isDigit(cs[j])) j++;
      if (j - i > MAX_INT_DIGITS) throw new RuleSyntaxError('int_too_long', p, { max: MAX_INT_DIGITS });
      if (at(j) === '.' && isDigit(at(j + 1))) throw new RuleSyntaxError('decimal', p);
      if (isNameStart(at(j))) throw new RuleSyntaxError('bad_number', p, { text: cs.slice(i, j + 1).join('') });
      out.push({ t: 'int', v: Number(cs.slice(i, j).join('')), p });
      i = j;
      continue;
    }
    if (isNameStart(c)) {
      let j = i + 1;
      while (j < cs.length && isNameChar(cs[j])) j++;
      const text = cs.slice(i, j).join('');
      out.push({ t: KEYWORDS.has(text) ? 'kw' : 'name', v: text, p });
      i = j;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let s = '';
      let n = 0;
      let closed = false;
      while (j < cs.length) {
        const d = cs[j];
        if (d === "'") {
          closed = true;
          j++;
          break;
        }
        if (d === '\n' || d === '\r') throw new RuleSyntaxError('newline_in_string', j + 1);
        if (d === '\\') {
          const e = at(j + 1);
          if (e !== "'" && e !== '\\') throw new RuleSyntaxError('bad_escape', j + 1, { ch: e });
          s += e;
          j += 2;
        } else {
          s += d;
          j++;
        }
        n++;
        if (n > MAX_STRING_CHARS) throw new RuleSyntaxError('string_too_long', p, { max: MAX_STRING_CHARS });
      }
      if (!closed) throw new RuleSyntaxError('unterminated_string', p);
      out.push({ t: 'str', v: s, p });
      i = j;
      continue;
    }
    const two = c + at(i + 1);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
      out.push({ t: 'op', v: two, p });
      i += 2;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '%' || c === '<' || c === '>') {
      out.push({ t: 'op', v: c, p });
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === ',' || c === '.') {
      out.push({ t: 'punct', v: c, p });
      i++;
      continue;
    }
    if (c === '=') throw new RuleSyntaxError('single_equals', p);
    if (c === '!') throw new RuleSyntaxError('bang', p);
    if (c === '&') throw new RuleSyntaxError('ampersand', p);
    if (c === '|') throw new RuleSyntaxError('pipe', p);
    throw new RuleSyntaxError('unexpected_char', p, { ch: c });
  }
  out.push({ t: 'eof', v: '', p: cs.length + 1 });
  return out;
}
