// 规则语言的错误类型。
//
// RuleSyntaxError：表达式的词法 / 语法错误，带位置（第几个字符，从 1 数起，按码点）。
// RuleError：求值时的错误，code 为 fuel | overflow | div0 | type | moderated（SPEC-E2 §7.4、§7.5）。
// 提交时的校验错误（路径、说明、建议）见 check.js 的 `Issue`。

/** 表达式的语法错误。code 见 messages.js 的 syntaxMessage */
export class RuleSyntaxError extends Error {
  constructor(code, pos, params = {}) {
    super(code);
    this.name = 'RuleSyntaxError';
    this.code = code;
    this.pos = pos; // 第几个字符（从 1 数起，按码点）；位置未知为 null
    this.params = params;
  }
}

/** 求值时的错误：fuel（超出步数上限）| overflow | div0 | type | moderated */
export class RuleError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'RuleError';
    this.code = code;
    this.detail = detail;
  }
}
