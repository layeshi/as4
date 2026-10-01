// 规则语言的错误说明（中英文）。校验错误要让模型能改对（SPEC-E2 §7.8）：给出路径、说明与一条建议。

const list = (xs, lang) => xs.join(lang === 'zh' ? '、' : ', ');
const q = (s, lang) => (lang === 'zh' ? `「${s}」` : `"${s}"`);

/** 表达式语法错误 → { zh, en }。err 为 RuleSyntaxError */
export function syntaxMessage(err) {
  const { code, pos, params: p = {} } = err;
  const at = (zh, en) => ({
    zh: pos ? `第 ${pos} 个字符：${zh}` : zh,
    en: pos ? `Character ${pos}: ${en}` : en,
  });
  switch (code) {
    case 'not_string': return at('表达式必须是字符串', 'an expression must be a string');
    case 'empty': return at('表达式是空的', 'the expression is empty');
    case 'too_long': return at(`表达式不能超过 ${p.max} 个字符（现在 ${p.length}）`, `an expression may not exceed ${p.max} characters (this one has ${p.length})`);
    case 'too_many_nodes': return at(`表达式太复杂：不能超过 ${p.max} 个语法节点`, `the expression is too complex: at most ${p.max} syntax nodes`);
    case 'too_deep': return at(`括号或嵌套太深（至多 ${p.max} 层）`, `nesting is too deep (at most ${p.max} levels)`);
    case 'int_too_long': return at(`整数至多 ${p.max} 位`, `an integer has at most ${p.max} digits`);
    case 'decimal': return at('只有整数，没有小数；比例请用千分比（600 即六成，「× 60%」写作 * 600 / 1000）', 'there are only integers, no decimals; use per-mille for ratios (600 is 60%; "× 60%" is written * 600 / 1000)');
    case 'bad_number': return at(`数字后面不能紧跟字母：${p.text}`, `a number cannot be followed directly by letters: ${p.text}`);
    case 'unterminated_string': return at('字符串没有结束的单引号', 'the string has no closing single quote');
    case 'string_too_long': return at(`字符串至多 ${p.max} 个字符`, `a string has at most ${p.max} characters`);
    case 'bad_escape': return at("字符串里只能转义 \\' 和 \\\\", "only \\' and \\\\ can be escaped inside a string");
    case 'newline_in_string': return at('字符串不能换行', 'a string cannot contain a line break');
    case 'single_equals': return at('比较是否相等用 ==（规则语言里没有赋值）', 'use == to compare for equality (there is no assignment in the rule language)');
    case 'bang': return at('否定用 not，不等用 !=', 'use not for negation and != for inequality');
    case 'ampersand': return at('「并且」用 and', 'use and for "and"');
    case 'pipe': return at('「或者」用 or', 'use or for "or"');
    case 'unexpected_char': return at(`无法识别的字符「${p.ch}」`, `unexpected character "${p.ch}"`);
    case 'unexpected_token': return at(`这里不应出现「${p.tok}」`, `unexpected "${p.tok}" here`);
    case 'unexpected_end': return at('表达式在这里意外结束', 'the expression ends unexpectedly here');
    case 'unclosed_paren': return at('括号没有闭合', 'a parenthesis is not closed');
    case 'chained_comparison': return at('比较不能连写（a < b < c）；请拆成 a < b and b < c', 'comparisons cannot be chained (a < b < c); write a < b and b < c');
    case 'keyword_as_name': return at(`「${p.tok}」是关键字，不能当字段名`, `"${p.tok}" is a keyword and cannot be used as a field name`);
    case 'expected_name': return at('「.」后面应是字段名', 'a field name must follow "."');
    default: return at(`语法错误（${code}）`, `syntax error (${code})`);
  }
}

export { list, q };
