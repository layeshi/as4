// SPEC-E2 §24.1 测试 2：规则语言（纯函数，不接世界）——词法与语法、类型检查与校验、求值、收集、引擎读法、指纹。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpr, canonExpr, countNodes, parseCached } from '../src/e2/rules/parser.js';
import { tokenize } from '../src/e2/rules/lexer.js';
import { RuleSyntaxError, RuleError } from '../src/e2/rules/errors.js';
import { syntaxMessage } from '../src/e2/rules/messages.js';
import {
  checkExpression, validateRules, validateProcedure, parseWhen, parseTemplate, OP_NAMES, MAX_ISSUES,
} from '../src/e2/rules/check.js';
import { evaluate, newBudget, floorDiv, floorMod, sampleList, agentRef, groupRef, soulRef, TREASURY } from '../src/e2/rules/eval.js';
import { collectRule } from '../src/e2/rules/ops.js';
import { renderExpr, renderRule, renderTiming, renderProcedureClass, renderOp } from '../src/e2/rules/render.js';
import { fingerprintRule, fingerprintProcClass, sortedJson, canonRule } from '../src/e2/rules/fingerprint.js';
import { P, WEATHER_CODES } from '../src/e2/params.js';
import { ACTION_ORDER, ACTIONS, NO_BEFORE_ACTIONS, NO_AFTER_ACTIONS, EVENT_NAMES, actionArgNames } from '../src/e2/lore/actions.js';
import { setBlocklist } from '../src/moderation.js';
import { makeHost } from './e2-rules-host.js';
import { EXPR_READINGS, RULE_READINGS, TIMING_READINGS, PROC_READINGS, RULE_FINGERPRINTS } from './e2-rules-golden.js';

const a = (id) => agentRef(id);

/** 解析并求值一个表达式。env 里可放 actor / args / result / here / event / it …… */
function ev(src, env = {}, host = makeHost(), budget = newBudget()) {
  return evaluate(parseExpr(src), host, env, budget);
}
const evCode = (src, env, host) => {
  try {
    ev(src, env, host);
  } catch (e) {
    if (e instanceof RuleError) return e.code;
    throw e;
  }
  return null;
};
const synErr = (src) => {
  try {
    parseExpr(src);
  } catch (e) {
    assert.ok(e instanceof RuleSyntaxError, `${src}: ${e}`);
    return { code: e.code, pos: e.pos };
  }
  return null;
};

// ═══════════════════════════════════════════════════════════════
// 词法与语法
// ═══════════════════════════════════════════════════════════════

test('词法：整数、字符串（转义、多语言）、名字（含非 ASCII）、关键字、运算符与标点', () => {
  const toks = (s) => tokenize(s).map((t) => `${t.t}:${t.v}`);
  assert.deepEqual(toks('12 + x_1'), ['int:12', 'op:+', 'name:x_1', 'eof:']);
  assert.deepEqual(toks('and or not true false null'), ['kw:and', 'kw:or', 'kw:not', 'kw:true', 'kw:false', 'kw:null', 'eof:']);
  assert.deepEqual(toks('== != <= >= < > + - * / %'), ['op:==', 'op:!=', 'op:<=', 'op:>=', 'op:<', 'op:>', 'op:+', 'op:-', 'op:*', 'op:/', 'op:%', 'eof:']);
  assert.deepEqual(toks('f(a, b).c'), ['name:f', 'punct:(', 'name:a', 'punct:,', 'name:b', 'punct:)', 'punct:.', 'name:c', 'eof:']);
  assert.deepEqual(toks("'it\\'s' 'a\\\\b'"), ["str:it's", 'str:a\\b', 'eof:']);
  assert.deepEqual(toks("'守井人' 'عربى' '😀'"), ['str:守井人', 'str:عربى', 'str:😀', 'eof:']);
  assert.deepEqual(toks('守井人_1 + 变量'), ['name:守井人_1', 'op:+', 'name:变量', 'eof:']);
  assert.deepEqual(toks('999999999999999'), ['int:999999999999999', 'eof:']);
  assert.deepEqual(toks('  \t\n 1 \r\n'), ['int:1', 'eof:']);
  // 位置按码点、从 1 数起
  assert.deepEqual(tokenize("'😀' x").map((t) => t.p), [1, 5, 6]);
});

test('语法：每条产生式——优先级、左结合、括号、一元式、后缀、调用', () => {
  const c = (s) => canonExpr(parseExpr(s));
  assert.equal(c('1 + 2 * 3'), '(1 + (2 * 3))');
  assert.equal(c('(1 + 2) * 3'), '((1 + 2) * 3)');
  assert.equal(c('a - b - c'), '((a - b) - c)');
  assert.equal(c('a / b * c % d'), '(((a / b) * c) % d)');
  assert.equal(c('a or b and c'), '(a or (b and c))');
  assert.equal(c('a and b and c'), '((a and b) and c)');
  assert.equal(c('not a and b'), '((not a) and b)');
  assert.equal(c('not a == b'), '(not (a == b))', 'not 的优先级低于比较');
  assert.equal(c('a + 1 < b * 2'), '((a + 1) < (b * 2))');
  assert.equal(c('a == b or c != d'), '((a == b) or (c != d))');
  assert.equal(c('-a * b'), '((- a) * b)');
  assert.equal(c('- -5'), '(- (- 5))');
  assert.equal(c('-(1 + 2)'), '(- (1 + 2))');
  assert.equal(c('a.b.c'), 'a.b.c');
  assert.equal(c('f(1).x.y'), 'f(1).x.y');
  assert.equal(c('f()'), 'f()');
  assert.equal(c('f(1, g(2, 3), a.b)'), 'f(1, g(2, 3), a.b)');
  assert.equal(c('((((1))))'), '1', '括号只影响结构，不产生节点');
  assert.equal(c("'it\\'s'"), "'it\\'s'");
  assert.equal(c('true and (false or null == null)'), '(true and (false or (null == null)))');
  // 节点
  const t = parseExpr('a.b + f(1)');
  assert.equal(t.t, 'bin');
  assert.equal(t.a.t, 'field');
  assert.equal(t.a.o.t, 'name');
  assert.equal(t.b.t, 'call');
  assert.equal(countNodes(t), 5);
  assert.equal(countNodes(parseExpr('1 + 2')), 3);
});

test('语法：括号相同、空白不同的写法得到同一棵树（规范序列化相同）', () => {
  const variants = ['a+b*c', 'a + b * c', '  a  +  b  *  c  ', 'a + (b * c)', '(a) + ((b) * (c))', 'a\n+\nb\t*\tc'];
  assert.equal(new Set(variants.map((s) => canonExpr(parseExpr(s)))).size, 1);
});

test('语法错误：每种错误都带代码与位置（第几个字符，从 1 数起，按码点）', () => {
  const cases = [
    ['', 'empty', 1], ['   ', 'empty', 1],
    ['1 +', 'unexpected_end', 4], ['not', 'unexpected_end', 4], ['f(', 'unexpected_end', 3], ['(1 + 2', 'unclosed_paren', 1], ['f(1, 2', 'unclosed_paren', 1],
    ['a < b < c', 'chained_comparison', 7], ['a == b == c', 'chained_comparison', 8],
    ['1.5', 'decimal', 1], ['1234567890123456', 'int_too_long', 1], ['12abc', 'bad_number', 1],
    ["'abc", 'unterminated_string', 1], ["'a\\nb'", 'bad_escape', 3], ["'a\nb'", 'newline_in_string', 3], [`'${'x'.repeat(141)}'`, 'string_too_long', 1],
    ['a = 1', 'single_equals', 3], ['!a', 'bang', 1], ['a && b', 'ampersand', 3], ['a || b', 'pipe', 3], ['a ^ b', 'unexpected_char', 3],
    ["'😀' $", 'unexpected_char', 5],
    ['f(1,)', 'unexpected_token', 5], ['f(1 2)', 'unexpected_token', 5], ['1 2', 'unexpected_token', 3], ['a b', 'unexpected_token', 3], [')', 'unexpected_token', 1],
    ['1 + + 2', 'unexpected_token', 5], ['1 +* 2', 'unexpected_token', 4], ['and', 'unexpected_token', 1],
    ['a.1', 'expected_name', 3], ['a.', 'expected_name', 3], ['a.and', 'keyword_as_name', 3],
    ['x'.repeat(301), 'too_long', 301], [Array(61).fill('1').join('+'), 'too_many_nodes', 120], ['('.repeat(100) + '1' + ')'.repeat(100), 'too_deep', 65],
  ];
  for (const [src, code, pos] of cases) assert.deepEqual(synErr(src), { code, pos }, JSON.stringify(src.length > 30 ? `${src.slice(0, 12)}…` : src));
  assert.equal(parseExpr('x'.repeat(300)).n, 'x'.repeat(300), '恰好 300 个字符可以');
  assert.equal(countNodes(parseExpr(Array(60).fill('1').join('+'))), 119);
  assert.equal(synErr(Array(60).fill('1').join('+')), null, '119 个节点可以');
  assert.throws(() => parseExpr(5), RuleSyntaxError);
  // 中英文说明都带位置
  const m = syntaxMessage(new RuleSyntaxError('chained_comparison', 7));
  assert.match(m.zh, /^第 7 个字符：/);
  assert.match(m.en, /^Character 7: /);
  for (const code of ['empty', 'unexpected_end', 'unclosed_paren', 'decimal', 'single_equals', 'bang', 'ampersand', 'pipe', 'unexpected_char', 'bad_escape', 'too_long', 'too_many_nodes']) {
    const mm = syntaxMessage(new RuleSyntaxError(code, 2, { ch: '^', max: 5, length: 9, tok: 'x', text: '1a' }));
    assert.ok(mm.zh.length > 5 && mm.en.length > 5, code);
  }
});

test('解析缓存：同样的文本得到同一棵树，出错也被缓存，缓存不影响结果', () => {
  const t1 = parseCached('1 + 2');
  assert.equal(parseCached('1 + 2'), t1);
  assert.throws(() => parseCached('1 +'), RuleSyntaxError);
  assert.throws(() => parseCached('1 +'), (e) => e.code === 'unexpected_end');
  assert.deepEqual(canonExpr(parseCached('a+b')), canonExpr(parseExpr('a+b')));
});

// ═══════════════════════════════════════════════════════════════
// 类型检查
// ═══════════════════════════════════════════════════════════════

const ty = (src, kind = 'after', opts = { action: 'repair' }) => checkExpression(src, 'any', kind, opts);
const tyOk = (src, want, kind, opts) => {
  const r = ty(src, kind, opts);
  assert.equal(r.ok, true, `${src}: ${JSON.stringify(r.issues)}`);
  assert.equal(r.type, want, src);
};
const tyBad = (src, code, kind, opts) => {
  const r = ty(src, kind, opts);
  assert.equal(r.ok, false, `${src} 应当不合法`);
  assert.equal(r.issues[0].code, code, `${src}: ${JSON.stringify(r.issues[0])}`);
  return r.issues[0];
};

test('类型：字面量、运算符、比较、逻辑', () => {
  tyOk('1', 'int'); tyOk("'a'", 'str'); tyOk('true', 'bool'); tyOk('null', 'null');
  tyOk('1 + 2 * 3 % 4 - 5 / 6', 'int'); tyOk('-5', 'int');
  tyOk('1 < 2', 'bool'); tyOk('1 == 2', 'bool'); tyOk("'a' != 'b'", 'bool'); tyOk('actor == actor', 'bool'); tyOk('actor.purpose == null', 'bool');
  tyOk('true and false or not true', 'bool');
  tyOk('var.x + 1', 'int', undefined, undefined);
  tyOk('args.energy > 3 and result.spent <= 2', 'bool');
  tyBad("1 + 'a'", 'type.type_mismatch');
  tyBad('1 + true', 'type.type_mismatch');
  tyBad("'a' < 'b'", 'type.type_mismatch');
  tyBad('1 and true', 'type.type_mismatch');
  tyBad('not 5', 'type.type_mismatch');
  tyBad("-'a'", 'type.type_mismatch');
  tyBad('null + 1', 'type.type_mismatch');
  tyBad("actor == 'a3'", 'type.compare_kinds');
  tyBad("actor.energy == 'x'", 'type.compare_kinds');
  tyBad('agents == agents', 'type.compare_kinds');
  assert.match(tyBad("actor == 'a3'", 'type.compare_kinds').hint.zh, /actor\.id/);
});

test('类型：if 的两支须同类型（null 与任何类型相容）；default 的类型是备选的类型', () => {
  tyOk('if(true, 1, 2)', 'int'); tyOk("if(true, 'a', 'b')", 'str'); tyOk('if(true, 1, null)', 'int'); tyOk('if(true, null, 1)', 'int');
  tyOk('if(true, var.x, 1)', 'any');
  tyBad("if(true, 1, 'a')", 'type.if_branches');
  tyBad('if(1, 1, 2)', 'type.type_mismatch');
  tyOk('default(var.x, 0)', 'int'); tyOk("default(actor.purpose, 'x')", 'str'); tyOk('default(actor.purpose, null)', 'str');
  tyOk('default(args.to, null)', 'any', 'before', { action: 'give' });
});

test('类型：23 个函数的签名——参数个数与参数类型', () => {
  // 合法
  const good = [
    ['min(1, 2, 3)', 'int'], ['min(1)', 'int'], ['max(actor.energy, 2)', 'int'], ['abs(-3)', 'int'], ['if(true, 1, 2)', 'int'],
    ['default(var.x, 1)', 'int'], ['count(agents)', 'int'], ['count(cradle)', 'int'], ['sum(agents, it.energy)', 'int'], ['sum(cradle, it.fund)', 'int'],
    ['filter(agents, it.energy > 1)', 'list<agent>'], ['filter(cradle, it.fund > 1)', 'list<soul>'], ['top(agents, it.age, 2)', 'list<agent>'],
    ['sample(agents, 3)', 'list<agent>'], ['contains(here, actor)', 'bool'], ["tagged('t')", 'list<agent>'], ["members('g1')", 'list<agent>'], ["at('agora')", 'list<agent>'],
    ["has_tag(actor, 't')", 'bool'], ["in_group(actor, 'g1')", 'bool'], ['awake(actor)', 'bool'], ["is_wild('wilds')", 'bool'], ["owner('n3')", 'str'],
    ["agent('a3')", 'agent'], ["group('g1')", 'group'], ["soul('s1')", 'soul'], ['names(agents)', 'str'], ["names(cradle, '、')", 'str'], ["weather('fog')", 'bool'],
  ];
  for (const [src, want] of good) tyOk(src, want);
  assert.equal(good.length, 29);
  // 非法：参数个数
  for (const src of ['min()', 'abs()', 'abs(1, 2)', 'if(true, 1)', 'default(1)', 'count()', 'sum(agents)', 'filter(agents)', 'top(agents, it.age)', 'sample(agents)',
    'contains(here)', 'tagged()', 'has_tag(actor)', 'in_group(actor)', 'awake()', 'owner()', 'agent()', 'names()', 'names(agents, "x", 1)', 'weather()']) {
    tyBad(src.replace(/"/g, "'"), 'type.arity');
  }
  // 非法：参数类型
  tyBad("abs('a')", 'type.type_mismatch'); tyBad('count(5)', 'type.type_mismatch'); tyBad('sum(agents, true)', 'type.type_mismatch');
  tyBad('filter(agents, 1)', 'type.type_mismatch'); tyBad('top(agents, it.age, true)', 'type.type_mismatch'); tyBad("sample(agents, 'x')", 'type.type_mismatch');
  tyBad('contains(here, 5)', 'type.type_mismatch'); tyBad('tagged(5)', 'type.type_mismatch'); tyBad("has_tag('a', 't')", 'type.type_mismatch');
  tyBad('has_tag(actor, 5)', 'type.type_mismatch'); tyBad("awake('a')", 'type.type_mismatch'); tyBad('names(5)', 'type.type_mismatch'); tyBad('weather(1)', 'type.type_mismatch');
  tyBad("weather('rain')", 'type.unknown_weather');
  assert.match(tyBad("weather('rain')", 'type.unknown_weather').hint.zh, /drought/);
  // 未知函数：给出建议与可用的函数
  const u = tyBad('Count(agents)', 'type.unknown_function');
  assert.match(u.zh, /count/);
  assert.match(u.hint.zh, /可用的函数/);
  // it 在 filter / sum / top 的第二个参数里是元素的类型
  tyOk('sum(filter(agents, it.energy > 5), it.coins)', 'int');
  tyBad('sum(cradle, it.energy)', 'type.unknown_field'); // 灵魂没有 energy
  tyBad('filter(agents, it.fund > 1)', 'type.unknown_field'); // 居民没有 fund
});

test('类型：字段表——居民、社群、灵魂、城；拼写错误的提示带建议与可用字段', () => {
  const agent = ['id', 'name', 'lang', 'energy', 'coins', 'age', 'generation', 'place', 'status', 'drawnToday', 'repairedToday', 'salvagedToday', 'repaired', 'contributed', 'salvaged', 'purpose'];
  for (const f of agent) assert.equal(ty(`actor.${f}`).ok, true, f);
  tyOk('actor.energy', 'int'); tyOk('actor.name', 'str'); tyOk('actor.purpose', 'str');
  for (const f of ['id', 'name', 'treasury', 'treasuryCoins', 'steward', 'size']) assert.equal(ty(`group('g1').${f}`).ok, true, f);
  tyOk("group('g1').steward", 'agent'); tyOk("group('g1').steward.energy", 'int');
  for (const f of ['id', 'name', 'fund', 'expiresDay', 'generation']) assert.equal(ty(`soul('s1').${f}`).ok, true, f);
  for (const f of ['day', 'dayOfMonth', 'month', 'season', 'treasury', 'treasuryCoins', 'wellOutput', 'wellCondition', 'awake', 'dormant', 'residents', 'shellsFree', 'shellsTotal']) tyOk(`city.${f}`, 'int');
  const e = tyBad('actor.engery', 'type.unknown_field');
  assert.match(e.zh, /没有字段「engery」/);
  assert.match(e.hint.zh, /energy/);
  assert.match(e.hint.en, /Available fields: .*energy/);
  assert.match(tyBad('actor.Energy', 'type.unknown_field').zh, /是不是想写 energy/);
  tyBad('city.treasurey', 'type.unknown_field');
  tyBad("group('g1').energy", 'type.unknown_field');
  tyBad("soul('s1').energy", 'type.unknown_field');
  tyBad('actor.energy.x', 'type.field_of_non_record');
  tyBad('agents.x', 'type.field_of_non_record');
  tyBad('treasury.energy', 'type.field_of_non_record');
  assert.match(tyBad("'a'.x", 'type.field_of_non_record').en, /cannot take field/);
});

test('类型：args.<参数> 的名字须是该动作的参数名（拼错是静态错误）；result / event / var 放行', () => {
  tyOk('args.energy', 'any', 'before', { action: 'draw' });
  tyOk('args.give.energy', 'any', 'before', { action: 'offer' });
  tyOk('args.to', 'any', 'before', { action: 'move' });
  const e = tyBad('args.enrgy', 'type.unknown_arg', 'before', { action: 'draw' });
  assert.match(e.hint.zh, /energy/);
  assert.match(tyBad('args.target', 'type.unknown_arg', 'before', { action: 'draw' }).zh, /动作 draw 没有参数/);
  assert.match(tyBad('args.x', 'type.unknown_arg', 'before', { action: 'explore' }).hint.zh, /没有参数/);
  tyOk('result.anything + 1', 'int', 'after', { action: 'repair' });
  tyOk('var.whatever', 'any', 'daily', {});
  // 每个动作的参数表非空的都有 args 可读
  for (const t of ACTION_ORDER) for (const n of actionArgNames(t)) assert.equal(ty(`args.${n}`, 'after', { action: t }).ok, true, `${t}.${n}`);
  // event.<字段> 按事件核对
  tyOk('event.agent', 'any', 'on', { event: 'arrive' });
  tyOk('event.place', 'any', 'on', { event: 'built' });
  tyOk('event.build', 'any', 'on', { event: 'built' });
  tyOk('event.weather', 'any', 'on', { event: 'weather_start' });
  tyOk('event.law', 'any', 'on', { event: 'law_passed' });
  assert.match(tyBad('event.place', 'type.unknown_event_field', 'on', { event: 'arrive' }).hint.zh, /agent/);
});

test('类型：每个时机能用的名字（PROTOCOL-2 §6.3、§6.5）', () => {
  const GLOBAL = ['city', 'var', 'treasury', 'agents', 'cradle'];
  const table = [
    ['enact', GLOBAL], ['daily', GLOBAL], ['monthly', GLOBAL],
    ['before', [...GLOBAL, 'actor', 'args', 'here']],
    ['after', [...GLOBAL, 'actor', 'args', 'result', 'here']],
    ['on', [...GLOBAL, 'event']],
    ['proposers', [...GLOBAL, 'actor']],
    ['voters', GLOBAL],
    ['weight', GLOBAL],
    ['decide', [...GLOBAL, 'yes', 'no', 'abstain', 'voted', 'total', 'turnout']],
  ];
  const ALL = ['city', 'var', 'treasury', 'agents', 'cradle', 'actor', 'args', 'result', 'here', 'event', 'yes', 'no', 'abstain', 'voted', 'total', 'turnout'];
  for (const [kind, names] of table) {
    for (const n of ALL) {
      const r = checkExpression(n, 'any', kind, { action: 'give', event: 'arrive' });
      assert.equal(r.ok, names.includes(n), `${kind} 里的 ${n}`);
      if (!r.ok) assert.equal(r.issues[0].code, 'type.name_unavailable', `${kind}/${n}`);
    }
  }
  // it 只在 filter / sum / top 的第二个参数里与 weight 里
  const w = checkExpression('it.coins', 'int', 'weight');
  assert.equal(w.ok, true);
  assert.equal(checkExpression('it', 'any', 'daily').ok, false);
  assert.equal(checkExpression('sum(agents, it.energy) + it.coins', 'any', 'daily').ok, false);
  // 不认识的名字：建议与可用的名字
  const u = checkExpression('foo', 'any', 'daily');
  assert.equal(u.issues[0].code, 'type.unknown_name');
  assert.match(u.issues[0].hint.zh, /city、var、treasury、agents、cradle/);
  assert.match(checkExpression('Actor', 'any', 'before').issues[0].zh, /是不是想写 actor/);
  // 不可用的名字：说明在哪里可用
  assert.match(checkExpression('actor', 'any', 'daily').issues[0].zh, /before: 与 after:/);
  assert.match(checkExpression('result', 'any', 'before').issues[0].zh, /after:/);
  assert.match(checkExpression('yes', 'any', 'daily').issues[0].en, /decide/);
});

test('类型：表达式字段的期望类型（int / bool / account / agent / list<agent> / scalar）', () => {
  const ok = (src, want, kind = 'after', o = { action: 'repair' }) => assert.equal(checkExpression(src, want, kind, o).ok, true, `${src} → ${want}`);
  const no = (src, want, kind = 'after', o = { action: 'repair' }) => assert.equal(checkExpression(src, want, kind, o).ok, false, `${src} → ${want}`);
  ok('1 + 1', 'int'); no('1 < 2', 'int'); no("'a'", 'int'); ok('var.x', 'int'); // any 放行
  ok('1 < 2', 'bool'); no('1', 'bool');
  ok('treasury', 'account'); ok('actor', 'account'); ok("group('g1')", 'account'); ok("soul('s1')", 'account'); ok("agent('a1')", 'account'); no('agents', 'account'); no('1', 'account'); no("'a'", 'account');
  ok('actor', 'agent'); ok("agent('a1')", 'agent'); no('treasury', 'agent'); no("group('g1')", 'agent'); ok('event.agent', 'agent', 'on', { event: 'arrive' });
  ok('agents', 'list<agent>'); ok('here', 'list<agent>'); ok("tagged('x')", 'list<agent>'); no('cradle', 'list<agent>'); no('actor', 'list<agent>');
  ok('1', 'scalar'); ok("'a'", 'scalar'); ok('true', 'scalar'); ok('null', 'scalar'); no('agents', 'scalar'); no('actor', 'scalar'); ok('var.x', 'scalar');
  // 期望整数而得到真假时，建议用 if(…)
  assert.match(checkExpression('actor.energy > 3', 'int', 'before', { action: 'give' }).issues[0].hint.zh, /if\(/);
});

test('类型：字面的引用被收集（地点、社群），供校验层核对存在', () => {
  const r = checkExpression("count(at('agora')) == count(at('nowhere')) or in_group(actor, 'g9') or count(members('g1')) > 0 or is_wild('wilds') or owner('n3') == 'city' or group('g2').size > 0", 'any', 'after', { action: 'give' });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.deepEqual(r.refs.map((x) => `${x.kind}:${x.id}`).sort(), ['group:g1', 'group:g2', 'group:g9', 'place:agora', 'place:n3', 'place:nowhere', 'place:wilds']);
});

// ═══════════════════════════════════════════════════════════════
// 求值
// ═══════════════════════════════════════════════════════════════

test('求值：整数语义——加减乘、向下取整的除法与取模（含负数）', () => {
  const t = (src, want) => assert.equal(ev(src), want, src);
  t('1 + 2 * 3', 7); t('10 - 3 - 2', 5); t('2 * (3 + 4)', 14); t('-5 + 2', -3); t('- -5', 5); t('0 - 0', 0);
  t('7 / 2', 3); t('-7 / 2', -4); t('7 / -2', -4); t('-7 / -2', 3); t('6 / 3', 2); t('-6 / 3', -2); t('0 / 5', 0); t('1 / 2', 0); t('-1 / 2', -1);
  t('7 % 3', 1); t('-7 % 3', 2); t('7 % -3', -2); t('-7 % -3', -1); t('6 % 3', 0); t('-6 % 3', 0); t('0 % 4', 0); t('5 % 1', 0);
  t('600 * 9 / 1000', 5); t('(612 * 600) / 1000', 367);
  // a = b × floor(a / b) + (a % b)
  for (const [x, y] of [[7, 3], [-7, 3], [7, -3], [-7, -3], [100, 7], [-100, 7], [1, 9], [-1, 9]]) {
    assert.equal(ev(`${x < 0 ? `(0 - ${-x})` : x} / ${y < 0 ? `(0 - ${-y})` : y}`) * y + ev(`${x < 0 ? `(0 - ${-x})` : x} % ${y < 0 ? `(0 - ${-y})` : y}`), x);
  }
  // 乘出 -0 时归一为 0
  assert.ok(Object.is(ev('0 * -5'), 0));
  assert.ok(Object.is(ev('-0'), 0));
  assert.ok(Object.is(ev('abs(0)'), 0));
});

test('求值：很大的整数（BigInt 路径）——向下取整除法与取模在边界上仍然精确', () => {
  const MAX = 9007199254740991;
  assert.equal(floorDiv(MAX, 2), 4503599627370495);
  assert.equal(floorDiv(-MAX, 2), -4503599627370496);
  assert.equal(floorDiv(MAX, 3), 3002399751580330);
  assert.equal(floorDiv(MAX, MAX), 1);
  assert.equal(floorDiv(MAX - 1, MAX), 0);
  assert.equal(floorDiv(-1, MAX), -1);
  assert.equal(floorMod(MAX, 10), 1);
  assert.equal(floorMod(-MAX, 10), 9);
  assert.equal(floorMod(MAX, -10), -9);
  assert.equal(floorMod(MAX, MAX), 0);
  assert.equal(floorMod(-1, MAX), MAX - 1);
  // 与小数路径一致：一批随机的 (a, b) 对，a = b × q + r 且 r 与 b 同号、|r| < |b|
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 300; i++) {
    const x = (rnd(2) ? -1 : 1) * (rnd(1e9) * 1e6 + rnd(1e6));
    const y = (rnd(2) ? -1 : 1) * (1 + rnd(i % 3 === 0 ? 1e12 : 1e4));
    const q = floorDiv(x, y);
    const r = floorMod(x, y);
    assert.equal(BigInt(q) * BigInt(y) + BigInt(r), BigInt(x), `${x} / ${y}`);
    assert.ok(r === 0 || (r < 0) === (y < 0), `${x} % ${y}`);
    assert.ok(Math.abs(r) < Math.abs(y));
  }
});

test('求值：溢出（绝对值超过 MAX_SAFE_INTEGER）与除以零', () => {
  assert.equal(evCode('999999999999999 * 999999999999999', {}), 'overflow');
  assert.equal(evCode('999999999999999 * 99999999 + 999999999999999 * 99999999', {}), 'overflow');
  assert.equal(evCode('999999999999999 * 10 * 10 * 10', {}), 'overflow');
  assert.equal(evCode('0 - 999999999999999 * 999999999', {}), 'overflow');
  assert.equal(ev('999999999999999 * 9'), 8999999999999991);
  assert.equal(evCode('999999999999999 * 9 + 999999999999999 * 9', {}), 'overflow');
  assert.equal(evCode('1 / 0', {}), 'div0');
  assert.equal(evCode('1 % 0', {}), 'div0');
  assert.equal(evCode('0 / 0', {}), 'div0');
  assert.equal(evCode('5 / (3 - 3)', {}), 'div0');
  assert.equal(evCode("sum(agents, it.energy / (it.coins - it.coins))", {}), 'div0');
  assert.throws(() => floorDiv(1, 0), (e) => e.code === 'div0');
  assert.throws(() => floorMod(2 ** 45, 0), (e) => e.code === 'div0');
  // 总和溢出
  assert.equal(evCode('sum(agents, 999999999999999 * 999999999)', {}), 'overflow');
});

test('求值：and / or 短路，if 只求被选中的一支，default 的备选只在需要时才求', () => {
  assert.equal(ev('false and (1 / 0 == 1)'), false);
  assert.equal(ev('true or (1 / 0 == 1)'), true);
  assert.equal(ev('if(true, 1, 1 / 0)'), 1);
  assert.equal(ev('if(false, 1 / 0, 2)'), 2);
  assert.equal(ev('default(5, 1 / 0)'), 5);
  assert.equal(evCode('default(null, 1 / 0)', {}), 'div0');
  assert.equal(evCode('true and (1 / 0 == 1)', {}), 'div0');
  assert.equal(evCode('false or (1 / 0 == 1)', {}), 'div0');
  // 短路也省步数
  const b1 = newBudget();
  ev('false and (1 + 2 + 3 + 4 == 10)', {}, makeHost(), b1);
  const b2 = newBudget();
  ev('true and (1 + 2 + 3 + 4 == 10)', {}, makeHost(), b2);
  assert.ok(b1.steps < b2.steps);
});

test('求值：步数——每求一个语法节点 1 步，列表函数每遍历一个元素 1 步，超过上限为 fuel', () => {
  const steps = (src, env) => {
    const b = newBudget();
    ev(src, env, makeHost(), b);
    return b.steps;
  };
  assert.equal(steps('1'), 1);
  assert.equal(steps('1 + 2'), 3);
  assert.equal(steps('1 + 2 * 3'), 5);
  assert.equal(steps('min(1, 2, 3)'), 4);
  assert.equal(steps('city.day'), 2);
  assert.equal(steps('count(agents)'), 2 + 4); // 调用 + 名字 + 4 个在世居民
  assert.equal(steps('sum(agents, it.energy)'), 2 + 4 * 3); // 调用 1 + agents 1；每个元素：遍历 1 步 + 子式的 field、it 各 1 步
  assert.equal(steps('contains(here, actor)', { here: [a('a1'), a('a2')], actor: a('a1') }), 3 + 2); // 调用 + here + actor；遍历 2 个元素
  assert.equal(steps('filter(agents, true)'), 2 + 4 * 2); // 调用 + agents；每个元素：遍历 1 步 + 条件 1 个节点
  // fuel
  assert.equal(P.ruleFuel, 2000);
  const big = Array.from({ length: 700 }, (_, i) => ({ id: `a${i + 1}`, name: `n${i}`, energy: 1, coins: 0, age: 1, generation: 0, place: 'agora', status: 'awake', tags: [], groups: [], purpose: null }));
  const bigHost = makeHost({ agents: big });
  assert.equal(evCode('count(agents)', {}, bigHost), null, '702 步可以');
  assert.equal(evCode('sum(agents, it.energy)', {}, bigHost), 'fuel', '700 个元素 × 3 步超过 2000');
  assert.equal(evCode('count(agents) + count(agents) + count(agents)', {}, bigHost), 'fuel', '三个 count 超过 2000');
  const tiny = newBudget(5);
  assert.throws(() => ev('1 + 2 + 3 + 4', {}, makeHost(), tiny), (e) => e.code === 'fuel');
  // 嵌套的 filter 平方级增长，同样被步数拦住
  assert.equal(evCode('count(filter(agents, count(filter(agents, true)) > 0))', {}, bigHost), 'fuel');
  assert.equal(evCode('sum(agents, count(agents))', {}, makeHost({ agents: big.slice(0, 200) })), 'fuel');
});

test('求值：运行时类型错误（null 取字段、any 取到意外的值、类型不符）', () => {
  const E = { actor: a('a1'), args: { energy: 5, to: 'a2', give: { energy: 3, coins: 0 } }, result: { spent: 4 } };
  assert.equal(ev('args.energy + 1', E), 6);
  assert.equal(ev('args.give.energy', E), 3);
  assert.equal(ev('args.missing', E), null, '没给的参数读到 null');
  assert.equal(ev('result.spent / 2', E), 2);
  assert.equal(evCode('args.missing + 1', E), 'type');
  assert.equal(evCode('args.missing.x', E), 'type', '对 null 取字段');
  assert.equal(evCode('args.to + 1', E), 'type');
  assert.equal(evCode('args.energy.x', E), 'type');
  assert.equal(evCode("args.energy and true", E), 'type');
  assert.equal(evCode('not args.energy', E), 'type');
  assert.equal(evCode('-args.to', E), 'type');
  assert.equal(evCode('args.to < 3', E), 'type');
  assert.equal(evCode('args.energy == args.to', E), 'type', '不同种的值不能比较');
  assert.equal(ev('args.missing == null', E), true);
  assert.equal(ev('args.energy == null', E), false);
  assert.equal(evCode('actor.nope', E), 'type', '居民没有这个字段');
});

test('求值：居民、社群、灵魂的引用与字段——相等按 ID 比较', () => {
  const E = { actor: a('a1') };
  assert.equal(ev('actor.energy', E), 50);
  assert.equal(ev('actor.name', E), '甲');
  assert.equal(ev('actor.purpose', E), '求索');
  assert.equal(ev('agent("a2").purpose'.replace(/"/g, "'"), E), null);
  assert.equal(ev("agent('乙').energy", E), 150, '精确的名字也能查');
  assert.equal(ev("agent('a999')", E), null);
  assert.equal(ev("group('g1').size", E), 2);
  assert.equal(ev("group('g1').steward.name", E), '甲');
  assert.equal(ev("group('g1').treasury", E), 30);
  assert.equal(ev("soul('s1').fund", E), 120);
  assert.equal(ev("soul('s9')", E), null);
  assert.equal(ev("actor == agent('a1')", E), true);
  assert.equal(ev("actor == agent('a2')", E), false);
  assert.equal(ev("actor != agent('a2')", E), true);
  assert.equal(ev("agent('a999') == null", E), true);
  assert.equal(ev('city.wellOutput * 2', E), 1224);
  assert.equal(ev('var.rationShare', E), 600);
  assert.equal(ev('var.nothing', E), null);
  assert.equal(ev('default(var.nothing, 7)', E), 7);
  assert.equal(ev('city.awake + city.dormant', E), 4);
  assert.deepEqual(ev('treasury'), TREASURY);
});

test('求值：列表函数——filter / sum / count / top / contains / names / tagged / members / at，按 ID 的数字部分升序', () => {
  assert.deepEqual(ev('agents').map((r) => r.id), ['a1', 'a2', 'a3', 'a10'], 'a10 排在 a3 之后（数字顺序，不是字典序）；死者不在其中');
  assert.deepEqual(ev("tagged('citizen')").map((r) => r.id), ['a1', 'a2', 'a3']);
  assert.deepEqual(ev("tagged('守井人')").map((r) => r.id), ['a2']);
  assert.deepEqual(ev("tagged('none')"), []);
  assert.deepEqual(ev("members('g1')").map((r) => r.id), ['a1', 'a3']);
  assert.deepEqual(ev("members('g9')"), []);
  assert.deepEqual(ev("at('well')").map((r) => r.id), ['a3', 'a10']);
  assert.deepEqual(ev('filter(agents, it.energy > 100)').map((r) => r.id), ['a2', 'a3']);
  assert.deepEqual(ev("filter(agents, has_tag(it, 'citizen') and not has_tag(it, 'exiled'))").map((r) => r.id), ['a1', 'a2']);
  assert.equal(ev('count(agents)'), 4);
  assert.equal(ev('count(filter(agents, awake(it)))'), 3);
  assert.equal(ev('sum(agents, it.energy)'), 50 + 150 + 120 + 7);
  assert.equal(ev('sum(cradle, it.fund)'), 120);
  assert.equal(ev('sum(filter(agents, it.energy > 1000), it.energy)'), 0);
  assert.deepEqual(ev('top(agents, it.energy, 2)').map((r) => r.id), ['a2', 'a3']);
  assert.deepEqual(ev('top(agents, it.generation, 3)').map((r) => r.id), ['a10', 'a3', 'a1'], '键相同时按 ID 升序（a1 在 a2 之前，a2 的世代 0 与 a1 相同，被第 3 名截掉）');
  assert.deepEqual(ev('top(agents, 1, 4)').map((r) => r.id), ['a1', 'a2', 'a3', 'a10'], '键全相同：按 ID 升序');
  assert.deepEqual(ev('top(agents, it.energy, 0)'), []);
  assert.deepEqual(ev('top(agents, it.energy, 99)').map((r) => r.id), ['a2', 'a3', 'a1', 'a10']);
  assert.equal(ev("contains(agents, agent('a3'))"), true);
  assert.equal(ev("contains(agents, agent('a11'))"), false);
  assert.equal(ev("names(agents, '/')"), '甲/乙/Cora/十');
  assert.equal(ev('names(agents)'), '甲, 乙, Cora, 十');
  assert.equal(ev("names(cradle, '、')"), '小满、长庚');
  assert.equal(ev("names(filter(agents, it.energy > 1000), '、')"), '');
  assert.equal(ev("has_tag(agent('a3'), 'exiled')"), true);
  assert.equal(ev("in_group(agent('a3'), 'g1')"), true);
  assert.equal(ev("in_group(agent('a2'), 'g1')"), false);
  assert.equal(ev("awake(agent('a2'))"), false, '沉睡者不是醒着');
  assert.equal(ev("is_wild('wilds')"), true);
  assert.equal(ev("is_wild('agora')"), false);
  assert.equal(ev("is_wild('nowhere')"), false);
  assert.equal(ev("owner('n3')"), 'a1');
  assert.equal(ev("owner('agora')"), 'city');
  assert.equal(ev("weather('fog')"), true);
  assert.equal(ev("weather('drought')"), false);
  // it 在求值后恢复
  const env = { it: a('a1') };
  ev('filter(agents, it.energy > 100)', env);
  assert.equal(env.it.id, 'a1');
});

test('求值：min / max / abs / if / default', () => {
  assert.equal(ev('min(3, 1, 2)'), 1); assert.equal(ev('max(3, 1, 2)'), 3); assert.equal(ev('min(5)'), 5);
  assert.equal(ev('abs(0 - 4)'), 4); assert.equal(ev('abs(4)'), 4);
  assert.equal(ev('min(10, 7 / 2)'), 3);
  assert.equal(ev('if(1 < 2, 10, 20)'), 10); assert.equal(ev('if(1 > 2, 10, 20)'), 20);
  assert.equal(ev("default(null, 'x')"), 'x'); assert.equal(ev("default('y', 'x')"), 'y'); assert.equal(ev('default(0, 5)'), 0, '0 不是 null');
  assert.equal(evCode('if(1, 2, 3)', {}), 'type');
  assert.equal(evCode("min(1, 'a')", {}), 'type');
  assert.equal(evCode('count(5)', {}), 'type');
  assert.equal(evCode('sum(agents, true)', {}), 'type');
  assert.equal(evCode('filter(agents, 1)', {}), 'type');
  assert.equal(evCode("tagged(5)", {}), 'type');
  assert.equal(evCode("has_tag(1, 'x')", {}), 'type');
});

test('求值：sample 用世界的随机数——同一流同一结果；n ≥ 长度取全部且不消耗随机数；结果按 ID 升序、不重复', () => {
  const run = (seed, src) => ev(src, {}, makeHost({ seed })).map((r) => r.id);
  assert.deepEqual(run('s1', 'sample(agents, 2)'), run('s1', 'sample(agents, 2)'), '同一种子同一结果');
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const ids = run(`seed-${i}`, 'sample(agents, 2)');
    assert.equal(ids.length, 2);
    assert.equal(new Set(ids).size, 2, '不重复');
    const nums = ids.map((x) => Number(x.slice(1)));
    assert.deepEqual(nums, nums.slice().sort((x, y) => x - y), '按 ID 升序');
    seen.add(ids.join());
  }
  assert.ok(seen.size >= 4, `不同的种子应抽出不同的组合（${seen.size}）`);
  // 取全部、取零个：不消耗随机数
  const host = makeHost();
  assert.deepEqual(ev('sample(agents, 4)', {}, host).map((r) => r.id), ['a1', 'a2', 'a3', 'a10']);
  assert.deepEqual(ev('sample(agents, 99)', {}, host).map((r) => r.id), ['a1', 'a2', 'a3', 'a10']);
  assert.deepEqual(ev('sample(agents, 0)', {}, host), []);
  assert.deepEqual(ev('sample(agents, 0 - 3)', {}, host), []);
  assert.equal(host.calls.rngInt, 0);
  ev('sample(agents, 2)', {}, host);
  assert.equal(host.calls.rngInt, 2, '消耗 n 次');
  // 每个元素被抽到的概率大致相等
  const counts = {};
  for (let i = 0; i < 400; i++) for (const id of run(`d-${i}`, 'sample(agents, 2)')) counts[id] = (counts[id] || 0) + 1;
  for (const id of ['a1', 'a2', 'a3', 'a10']) assert.ok(counts[id] > 150 && counts[id] < 250, `${id}: ${counts[id]}`); // 4 取 2：每个 1/2 的概率，400 次约 200
  // sampleList 单独：不改动原列表
  const list = [a('a1'), a('a2'), a('a3')];
  sampleList(list, 2, { rngInt: () => 0 });
  assert.deepEqual(list.map((r) => r.id), ['a1', 'a2', 'a3']);
});

// ═══════════════════════════════════════════════════════════════
// 收集（意图）
// ═══════════════════════════════════════════════════════════════

const col = (rule, env = {}, host = makeHost(), budget = newBudget()) => collectRule(rule, { host, env: { ...env }, budget });
const colCode = (rule, env, host) => {
  try {
    col(rule, env, host);
  } catch (e) {
    if (e instanceof RuleError) return e.code;
    throw e;
  }
  return null;
};

test('收集：条件为假时没有意图；每个操作 5 步；条件为真时按顺序收集', () => {
  const rule = { when: 'daily', if: 'city.awake > 100', do: [{ op: 'transfer', from: 'treasury', to: "agent('a1')", energy: '5' }] };
  assert.deepEqual(col(rule), []);
  const b = newBudget();
  const intents = col({ ...rule, if: 'city.awake > 1' }, {}, makeHost(), b);
  assert.deepEqual(intents, [{ op: 'transfer', from: { k: 'treasury' }, to: { k: 'agent', id: 'a1' }, energy: 5, coins: 0 }]);
  assert.equal(b.steps, 5 /* if: city.awake > 1 = 4 节点 + 1? */ - 0 + (b.steps - 5), '步数见下');
  // 精确：if 4 个节点（bin、field、name、int）+ 操作 5 步 + from（name 1）+ to（call 1 + str 1）+ energy（int 1）
  assert.equal(b.steps, 4 + 5 + 1 + 2 + 1);
  const two = col({ when: 'daily', do: [{ op: 'set', var: 'a', value: '1' }, { op: 'set', var: 'b', value: "'x'" }] });
  assert.deepEqual(two, [{ op: 'set', var: 'a', value: 1 }, { op: 'set', var: 'b', value: 'x' }]);
});

test('收集：transfer / fee / share——账户的解析、数额非正则不产生意图、灵魂只能作为转入的一方', () => {
  const H = makeHost();
  const tr = (from, to, extra = {}) => ({ when: 'daily', do: [{ op: 'transfer', from, to, ...extra }] });
  assert.deepEqual(col(tr('treasury', "group('g1')", { energy: '3', coins: '2' })), [{ op: 'transfer', from: { k: 'treasury' }, to: { k: 'group', id: 'g1' }, energy: 3, coins: 2 }]);
  assert.deepEqual(col(tr("agent('a1')", "soul('s1')", { energy: '9' })), [{ op: 'transfer', from: { k: 'agent', id: 'a1' }, to: { k: 'soul', id: 's1' }, energy: 9, coins: 0 }]);
  assert.deepEqual(col(tr('treasury', "agent('a1')", { energy: '0' })), [], '数额 0 不执行');
  assert.deepEqual(col(tr('treasury', "agent('a1')", { energy: '0 - 5', coins: '0 - 1' })), [], '负数不执行');
  assert.deepEqual(col(tr('treasury', "agent('a1')", { energy: '0 - 5', coins: '2' })).map((i) => [i.energy, i.coins]), [[0, 2]]);
  assert.equal(colCode(tr("soul('s1')", 'treasury', { energy: '1' }), {}, H), 'type', '灵魂不能转出');
  assert.equal(colCode(tr('treasury', "soul('s9')", { energy: '1' }), {}, H), 'type', '灵魂不在摇篮里');
  assert.equal(colCode(tr('treasury', "agent('a11')", { energy: '1' }), {}, H), 'type', '死者不是账户');
  assert.equal(colCode(tr('treasury', "agent('a999')", { energy: '1' }), {}, H), 'type', 'null 不是账户');
  assert.equal(colCode(tr('treasury', "group('g9')", { energy: '1' }), {}, H), 'type');
  assert.equal(colCode(tr('treasury', "agent('a1')", { energy: "'x'" }), {}, H), 'type');
  assert.equal(colCode(tr('treasury', 'agents', { energy: '1' }), {}, H), 'type');
  assert.deepEqual(col({ when: 'before:give', do: [{ op: 'fee', to: "group('g1')", energy: '2', coins: '1' }] }), [{ op: 'fee', to: { k: 'group', id: 'g1' }, energy: 2, coins: 1 }]);
  assert.deepEqual(col({ when: 'daily', do: [{ op: 'share', from: 'treasury', energy: '10', among: "tagged('citizen')" }] }),
    [{ op: 'share', from: { k: 'treasury' }, among: ['a1', 'a2', 'a3'], energy: 10, coins: 0 }]);
  assert.deepEqual(col({ when: 'daily', do: [{ op: 'share', from: 'treasury', energy: '10', among: 'filter(agents, false)' }] }),
    [{ op: 'share', from: { k: 'treasury' }, among: [], energy: 10, coins: 0 }], '人数为 0 时由施行跳过');
  assert.deepEqual(col({ when: 'before:give', do: [{ op: 'deny', reason: '不许' }] }), [{ op: 'deny', reason: '不许' }]);
});

test('收集：each 展开——对每个元素各出一份意图（it 绑定元素），if 过滤，每个元素 1 步', () => {
  const rule = { when: 'daily', do: [{ op: 'each', in: 'agents', if: 'it.energy > 100', do: [
    { op: 'transfer', from: 'it', to: 'treasury', energy: '(it.energy - 100) / 20' }, { op: 'tag', who: 'it', tag: '富人' }] }] };
  const intents = col(rule);
  assert.deepEqual(intents, [
    { op: 'transfer', from: { k: 'agent', id: 'a2' }, to: { k: 'treasury' }, energy: 2, coins: 0 }, { op: 'tag', who: 'a2', tag: '富人' },
    { op: 'transfer', from: { k: 'agent', id: 'a3' }, to: { k: 'treasury' }, energy: 1, coins: 0 }, { op: 'tag', who: 'a3', tag: '富人' },
  ]);
  const env = { it: a('a10') };
  col(rule, env);
  assert.equal(env.it.id, 'a10', 'it 在收集后恢复');
  // 步数：each 5 + in(1) + 每个元素 1 + 它的 if(4 个节点) + 通过者各自的操作……
  const b = newBudget();
  col(rule, {}, makeHost(), b);
  assert.ok(b.steps > 5 + 4 + 4 * 5, `步数 ${b.steps}`);
  // 元素不是居民：type
  assert.equal(colCode({ when: 'daily', do: [{ op: 'each', in: 'cradle', do: [{ op: 'set', var: 'x', value: '1' }] }] }), 'type');
  // 空列表：没有意图
  assert.deepEqual(col({ when: 'daily', do: [{ op: 'each', in: "tagged('无人')", do: [{ op: 'set', var: 'x', value: '1' }] }] }), []);
  // each 里出错：整次收集失败，不留半截意图
  assert.equal(colCode({ when: 'daily', do: [{ op: 'set', var: 'ok', value: '1' }, { op: 'each', in: 'agents', do: [{ op: 'set', var: 'x', value: '1 / (it.coins - 20)' }] }] }), 'div0');
});

test('收集：set / tag / announce / mint / exile / 其余操作——取值与类型检查', () => {
  assert.deepEqual(col({ when: 'enact', do: [{ op: 'set', var: 'a', value: 'null' }, { op: 'set', var: 'b', value: 'true' }, { op: 'set', var: 'c', value: "'x'" }] }),
    [{ op: 'set', var: 'a', value: null }, { op: 'set', var: 'b', value: true }, { op: 'set', var: 'c', value: 'x' }]);
  assert.equal(colCode({ when: 'enact', do: [{ op: 'set', var: 'a', value: 'agents' }] }), 'type');
  assert.equal(colCode({ when: 'enact', do: [{ op: 'set', var: 'a', value: 'actor' }] }, { actor: a('a1') }), 'type');
  assert.equal(colCode({ when: 'enact', do: [{ op: 'set', var: 'a', value: `'${'长'.repeat(140)}'` }] }), null);
  assert.deepEqual(col({ when: 'enact', do: [{ op: 'tag', who: "agent('a1')", tag: '甲' }, { op: 'untag', who: "agent('a2')", tag: '乙' }, { op: 'exile', who: "agent('a3')" }, { op: 'pardon', who: "agent('a3')" }] }),
    [{ op: 'tag', who: 'a1', tag: '甲' }, { op: 'untag', who: 'a2', tag: '乙' }, { op: 'exile', who: 'a3' }, { op: 'pardon', who: 'a3' }]);
  assert.equal(colCode({ when: 'enact', do: [{ op: 'tag', who: "agent('a11')", tag: 'x' }] }), 'type', '死者不能被贴标签');
  assert.equal(colCode({ when: 'enact', do: [{ op: 'tag', who: "agent('zzz')", tag: 'x' }] }), 'type');
  assert.equal(colCode({ when: 'enact', do: [{ op: 'tag', who: 'treasury', tag: 'x' }] }), 'type');
  assert.deepEqual(col({ when: 'enact', do: [{ op: 'mint', coins: '100' }, { op: 'mint', coins: '5', to: "agent('a1')" }, { op: 'mint', coins: '0' }] }),
    [{ op: 'mint', coins: 100, to: { k: 'treasury' } }, { op: 'mint', coins: 5, to: { k: 'agent', id: 'a1' } }]);
  assert.equal(colCode({ when: 'enact', do: [{ op: 'mint', coins: '5', to: "soul('s1')" }] }), 'type');
  assert.deepEqual(col({ when: 'enact', do: [{ op: 'cede', place: 'n3', to: "group('g1')" }] }), [{ op: 'cede', place: 'n3', to: { k: 'group', id: 'g1' } }]);
  assert.equal(colCode({ when: 'enact', do: [{ op: 'cede', place: 'n3', to: 'treasury' }] }), 'type');
  assert.deepEqual(col({ when: 'enact', do: [{ op: 'fund', project: 'j3', energy: '10' }, { op: 'fund', project: 'j4', energy: '0' }, { op: 'repeal', law: 'l2' }, { op: 'seize', place: 'n3' }, { op: 'petition', text: '请' }] }),
    [{ op: 'fund', project: 'j3', energy: 10 }, { op: 'repeal', law: 'l2' }, { op: 'seize', place: 'n3' }, { op: 'petition', text: '请' }]);
  assert.deepEqual(col({ when: 'enact', do: [{ op: 'rename', target: 'city', name: '灯城' }, { op: 'protect', inscription: 'i1' }, { op: 'unprotect', inscription: 'i2' },
    { op: 'amend', article: 2, lang: 'zh', text: 'x' }, { op: 'amend', canonical: null }] }),
    [{ op: 'rename', target: 'city', name: '灯城' }, { op: 'protect', inscription: 'i1' }, { op: 'unprotect', inscription: 'i2' },
      { op: 'amend', article: 2, lang: 'zh', text: 'x' }, { op: 'amend', canonical: null }]);
});

test('收集：宣告模板的插值——整数、字符串、居民的名字；{{ }} 是花括号本身；其余类型为 type 错误', () => {
  const ann = (text, env) => col({ when: 'daily', do: [{ op: 'announce', to: 'all', text }] }, env)[0].text;
  assert.equal(ann('今天 {city.awake} 人醒着'), '今天 3 人醒着');
  assert.equal(ann("摇篮里有 {count(cradle)} 个：{names(cradle, '、')}"), '摇篮里有 2 个：小满、长庚');
  assert.equal(ann('{{花括号}} 和 {1 + 1}'), '{花括号} 和 2');
  assert.equal(ann("{actor} 说：{'你好'}", { actor: a('a3') }), 'Cora 说：你好');
  assert.equal(ann("{'}'}"), '}', '字符串里的右花括号不结束占位');
  assert.equal(colCode({ when: 'daily', do: [{ op: 'announce', to: 'all', text: '{true}' }] }), 'type');
  assert.equal(colCode({ when: 'daily', do: [{ op: 'announce', to: 'all', text: '{agents}' }] }), 'type');
  assert.equal(colCode({ when: 'daily', do: [{ op: 'announce', to: 'all', text: '{var.nothing}' }] }), 'type');
  assert.equal(colCode({ when: 'daily', do: [{ op: 'announce', to: 'all', text: '{1 / 0}' }] }), 'div0');
  // 太长的插值结果被截断到 1200 字符
  const long = col({ when: 'daily', do: [{ op: 'announce', to: 'all', text: "{names(agents, '" + '一'.repeat(130) + "')}{names(agents, '" + '二'.repeat(130) + "')}{names(agents, '" + '三'.repeat(130) + "')}" }] });
  assert.ok(Array.from(long[0].text).length <= 1200);
  // 模板解析
  assert.deepEqual(parseTemplate('a{b}c{{d}}'), [{ lit: 'a' }, { expr: 'b', pos: 2 }, { lit: 'c{d}' }]);
  for (const bad of ['{', 'x}', '{}', '{ }', 'a{b']) assert.throws(() => parseTemplate(bad), (e) => /^template_/.test(e.code), bad);
});

test('收集：before 规则出错时由调用者视为「没有拒绝、没有费用」——收集本身抛 RuleError', () => {
  const rule = { when: 'before:draw', if: 'args.energy / (args.energy - 5) > 0', do: [{ op: 'deny', reason: 'x' }] };
  assert.equal(colCode(rule, { actor: a('a1'), args: { energy: 5 } }), 'div0');
  assert.deepEqual(col(rule, { actor: a('a1'), args: { energy: 7 } }), [{ op: 'deny', reason: 'x' }]);
});

// ═══════════════════════════════════════════════════════════════
// 静态校验
// ═══════════════════════════════════════════════════════════════

const city = { scope: { kind: 'city' } };
const issuesOf = (rules, opts = city) => validateRules(rules, opts).issues;
const firstCode = (rules, opts = city) => {
  const r = validateRules(rules, opts);
  assert.equal(r.ok, false, `应当不合法：${JSON.stringify(rules)}`);
  return r.issues[0].code;
};
const give5 = { op: 'transfer', from: 'treasury', to: 'actor', energy: '5' };

test('校验：合法的规则原样通过（规范化空白）；返回的是规范化的副本', () => {
  const rules = [{ when: ' daily ', if: '  city.awake > 1 ', do: [{ op: 'transfer', from: ' treasury', to: "agent('a1')", energy: ' 5 ' }] }];
  const r = validateRules(rules, city);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.deepEqual(r.rules, [{ when: 'daily', if: 'city.awake > 1', do: [{ op: 'transfer', from: 'treasury', to: "agent('a1')", energy: '5' }] }]);
  assert.notEqual(r.rules[0], rules[0]);
  assert.deepEqual(validateRules([], city), { ok: true, issues: [], rules: [] }, '没有规则的法律是规范');
});

test('校验：规则的形状——未知的键、缺失的键、错误的类型，路径精确', () => {
  assert.equal(firstCode('x'), 'shape.bad_type');
  assert.equal(firstCode([5]), 'shape.bad_type');
  assert.equal(firstCode([{ when: 'daily', do: [give5], extra: 1 }]), 'shape.unknown_key');
  assert.equal(issuesOf([{ when: 'daily', do: [give5], extra: 1 }])[0].path, 'rules[0].extra');
  assert.equal(firstCode([{ do: [give5] }]), 'shape.missing_key');
  assert.equal(firstCode([{ when: 'daily' }]), 'shape.bad_type');
  assert.equal(firstCode([{ when: 'daily', do: [] }]), 'limit.too_many');
  assert.equal(firstCode([{ when: 'daily', do: 'x' }]), 'shape.bad_type');
  assert.equal(firstCode([{ when: 5, do: [give5] }]), 'when.invalid');
  assert.equal(firstCode([{ when: 'daily', if: 5, do: [give5] }]), 'shape.bad_type');
  assert.equal(issuesOf([{ when: 'daily', do: [{ ...give5, nope: 1 }] }])[0].path, 'rules[0].do[0].nope');
  assert.equal(firstCode([{ when: 'daily', do: [{ op: 'transfer', from: 'treasury' }] }]), 'shape.missing_key');
  assert.equal(issuesOf([{ when: 'daily', do: [{ op: 'transfer', from: 'treasury' }] }])[0].path, 'rules[0].do[0].to');
  assert.equal(firstCode([{ when: 'daily', do: [{ op: 'transfer', from: 'treasury', to: 'treasury' }] }]), 'op.need_amount');
  assert.equal(firstCode([{ when: 'daily', do: [{ op: 'nope' }] }]), 'op.unknown');
  assert.equal(firstCode([{ when: 'daily', do: [{}] }]), 'op.unknown');
  assert.equal(firstCode([{ when: 'daily', do: ['x'] }]), 'shape.bad_type');
  // 路径带索引
  const iss = issuesOf([{ when: 'daily', do: [give5] }, { when: 'daily', do: [give5, { op: 'transfer', from: 'treasury', to: "agent('a1')", energy: 'actor.energy' }] }]);
  assert.ok(iss.some((i) => i.path === 'rules[1].do[1].energy'));
});

test('校验：数量上限——规则 8 条、每条操作 8 个（含 each 里的叶子）、each 的 do 8 个、不能嵌套 each', () => {
  const ok = (n) => Array.from({ length: n }, () => ({ when: 'daily', do: [give5].map((o) => ({ ...o, to: "agent('a1')" })) }));
  assert.equal(validateRules(ok(8), city).ok, true);
  assert.equal(firstCode(ok(9)), 'limit.too_many');
  const ops = (n) => Array.from({ length: n }, () => ({ op: 'set', var: 'x', value: '1' }));
  assert.equal(validateRules([{ when: 'daily', do: ops(8) }], city).ok, true);
  assert.equal(firstCode([{ when: 'daily', do: ops(9) }]), 'limit.too_many');
  const each = (n) => ({ op: 'each', in: 'agents', do: ops(n) });
  assert.equal(validateRules([{ when: 'daily', do: [each(8)] }], city).ok, true, 'each 里 8 个叶子可以');
  assert.equal(firstCode([{ when: 'daily', do: [each(9)] }]), 'limit.too_many');
  assert.equal(firstCode([{ when: 'daily', do: [...ops(1), each(8)] }]), 'limit.too_many', '含 each 里的：1 + 8 个叶子超过 8');
  assert.equal(validateRules([{ when: 'daily', do: [...ops(3), each(5)] }], city).ok, true);
  assert.equal(firstCode([{ when: 'daily', do: [{ op: 'each', in: 'agents', do: [each(1)] }] }]), 'op.each_nested');
  assert.equal(firstCode([{ when: 'daily', do: [{ op: 'each', in: 'agents', do: [] }] }]), 'shape.bad_type');
  // JSON 字节数
  const fat = [{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '长'.repeat(280) }] }, { when: 'daily', do: [{ op: 'announce', to: 'all', text: '长'.repeat(280) }] }, { when: 'daily', do: [{ op: 'announce', to: 'all', text: '长'.repeat(280) }] }, { when: 'daily', do: [{ op: 'announce', to: 'all', text: '长'.repeat(280) }] }, { when: 'daily', do: [{ op: 'announce', to: 'all', text: '长'.repeat(280) }] }];
  assert.equal(P.lawBytes, 4096);
  assert.equal(firstCode(fat), 'limit.too_big');
});

test('校验：时机——合法的写法、未知的动作与事件、守护律排除的时机', () => {
  const when = (w, scope = { kind: 'city' }) => parseWhen(w, scope);
  for (const w of ['enact', 'daily', 'monthly', 'before:draw', 'after:repair', 'on:death']) assert.ok(!when(w).error, w);
  assert.deepEqual(when('before:draw'), { kind: 'before', action: 'draw' });
  assert.deepEqual(when('on:death'), { kind: 'on', event: 'death' });
  // 每个动作的 before / after
  for (const t of ACTION_ORDER) {
    assert.equal(!!when(`before:${t}`).error, NO_BEFORE_ACTIONS.includes(t), `before:${t}`);
    assert.equal(!!when(`after:${t}`).error, NO_AFTER_ACTIONS.includes(t), `after:${t}`);
  }
  assert.deepEqual([...NO_BEFORE_ACTIONS].sort(), ['diary', 'forget', 'leave', 'refound', 'remember', 'retire', 'sign', 'whisper']);
  assert.deepEqual([...NO_AFTER_ACTIONS].sort(), ['diary', 'forget', 'remember', 'whisper']);
  assert.ok(!when('after:retire').error && !when('after:leave').error && !when('after:sign').error && !when('after:refound').error);
  for (const e of EVENT_NAMES) assert.ok(!when(`on:${e}`).error, e);
  assert.equal(EVENT_NAMES.length, 12);
  assert.match(when('before:nope').error.zh, /不认识的动作/);
  assert.match(when('before:nope').error.hint.zh, /move say/);
  assert.match(when('on:nope').error.hint.zh, /arrive/);
  assert.match(when('weekly').error.zh, /不认识的时机/);
  assert.match(when('weekly').error.hint.zh, /enact/);
  assert.match(when('before:remember').error.zh, /内心/);
  assert.match(when('before:leave').error.zh, /退出权/);
  assert.match(when('after:diary').error.en, /inner life/);
  assert.ok(when('before:enter', { kind: 'city' }).error, 'before:enter 只用于地点规则');
  assert.deepEqual(when('before:enter', { kind: 'place' }), { kind: 'before', action: 'move', enter: true });
  assert.ok(when('on:death', { kind: 'place' }).error, '地点规则不能用 on:');
  assert.ok(!when('on:death', { kind: 'group' }).error);
  assert.equal(when(' daily ').kind, 'daily');
  assert.ok(when(5).error);
  assert.equal(firstCode([{ when: 'before:whisper', do: [{ op: 'deny', reason: 'x' }] }]), 'when.invalid');
});

test('校验：操作在时机与作用域里的可用性——before 只能 deny / fee，其余时机不能 deny / fee；社群与地点各有白名单', () => {
  const d = { op: 'deny', reason: 'x' };
  const f = { op: 'fee', to: 'treasury', energy: '1' };
  assert.equal(validateRules([{ when: 'before:give', do: [d, f] }], city).ok, true);
  assert.equal(firstCode([{ when: 'before:give', do: [give5] }]), 'op.timing');
  assert.equal(firstCode([{ when: 'before:give', do: [{ op: 'set', var: 'x', value: '1' }] }]), 'op.timing');
  assert.equal(firstCode([{ when: 'daily', do: [d] }]), 'op.timing');
  assert.equal(firstCode([{ when: 'after:give', do: [f] }]), 'op.timing');
  assert.equal(firstCode([{ when: 'enact', do: [d] }]), 'op.timing');
  const group = { scope: { kind: 'group', id: 'g1' } };
  const place = { scope: { kind: 'place', id: 'n3' } };
  const cityOnly = [{ op: 'exile', who: "agent('a1')" }, { op: 'pardon', who: "agent('a1')" }, { op: 'rename', target: 'city', name: 'x' }, { op: 'mint', coins: '1' },
    { op: 'protect', inscription: 'i1' }, { op: 'unprotect', inscription: 'i1' }, { op: 'amend', canonical: null }, { op: 'repeal', law: 'l1' }, { op: 'fund', project: 'j1', energy: '1' },
    { op: 'cede', place: 'agora', to: "agent('a1')" }, { op: 'seize', place: 'agora' }, { op: 'petition', text: 'x' }];
  for (const o of cityOnly) {
    assert.equal(validateRules([{ when: 'daily', do: [o] }], city).ok, true, `城法可以 ${o.op}`);
    assert.equal(firstCode([{ when: 'daily', do: [o] }], group), 'op.scope', `章程不能 ${o.op}`);
    assert.equal(firstCode([{ when: 'daily', do: [o] }], place), 'op.scope', `地点规则不能 ${o.op}`);
  }
  const groupOk = [give5, { op: 'share', from: 'treasury', energy: '1', among: 'agents' }, { op: 'set', var: 'x', value: '1' }, { op: 'tag', who: 'actor', tag: 'x' }, { op: 'untag', who: 'actor', tag: 'x' }, { op: 'announce', to: 'group:g1', text: 'x' }];
  for (const o of groupOk) assert.equal(validateRules([{ when: 'after:give', do: [o] }], group).ok, true, `章程可以 ${o.op}`);
  assert.equal(validateRules([{ when: 'before:give', do: [d, f] }], group).ok, true);
  assert.equal(validateRules([{ when: 'daily', do: [{ op: 'each', in: "members('g1')", do: [{ op: 'tag', who: 'it', tag: 'x' }] }] }], group).ok, true);
  assert.equal(firstCode([{ when: 'after:give', do: [{ op: 'share', from: 'treasury', energy: '1', among: 'agents' }, { op: 'exile', who: 'actor' }] }], group), 'op.scope');
  assert.equal(validateRules([{ when: 'after:give', do: [give5, { op: 'announce', to: 'here', text: 'x' }] }], place).ok, true);
  assert.equal(firstCode([{ when: 'after:give', do: [{ op: 'set', var: 'x', value: '1' }] }], place), 'op.scope');
  assert.equal(firstCode([{ when: 'after:give', do: [{ op: 'announce', to: 'all', text: 'x' }] }], place), 'op.scope', '地点规则只能向 here 宣告');
  assert.equal(firstCode([{ when: 'daily', do: [{ op: 'each', in: 'agents', do: [give5] }] }], place), 'op.scope', '地点规则没有 each');
  assert.equal(OP_NAMES.length, 21);
});

test('校验：每个操作的字段——表达式的类型、字面值的长度、宣告对象的写法、amend 的两种形式', () => {
  const v = (op, when = 'enact', scope = city) => validateRules([{ when, do: [op] }], scope);
  const bad = (op, code, when, scope) => {
    const r = v(op, when, scope);
    assert.equal(r.ok, false, JSON.stringify(op));
    assert.equal(r.issues[0].code, code, `${JSON.stringify(op)}: ${JSON.stringify(r.issues[0])}`);
  };
  // 表达式字段的类型
  bad({ op: 'transfer', from: 'agents', to: 'treasury', energy: '1' }, 'type.expected');
  bad({ op: 'transfer', from: 'treasury', to: "agent('a1')", energy: 'true' }, 'type.expected');
  bad({ op: 'transfer', from: 'treasury', to: "agent('a1')", energy: 5 }, 'shape.bad_type');
  bad({ op: 'share', from: 'treasury', energy: '1', among: 'actor' }, 'type.expected', 'after:give');
  bad({ op: 'each', in: 'cradle', do: [{ op: 'set', var: 'x', value: '1' }] }, 'type.expected', 'daily');
  bad({ op: 'each', in: 'agents', if: '1', do: [{ op: 'set', var: 'x', value: '1' }] }, 'type.expected', 'daily');
  bad({ op: 'tag', who: 'treasury', tag: 'x' }, 'type.expected');
  bad({ op: 'set', var: 'x', value: 'agents' }, 'type.expected');
  bad({ op: 'mint', coins: "'a'" }, 'type.expected');
  bad({ op: 'fund', project: 'j1', energy: 'true' }, 'type.expected');
  // each 的 if / do 里有 it，in 里没有
  assert.equal(v({ op: 'each', in: 'agents', if: 'it.energy > 1', do: [{ op: 'tag', who: 'it', tag: 'x' }] }, 'daily').ok, true);
  assert.equal(v({ op: 'each', in: 'filter(agents, it.energy > 1)', do: [{ op: 'tag', who: 'it', tag: 'x' }] }, 'daily').ok, true, 'filter 里的 it 与 each 里的 it 各自合法');
  bad({ op: 'tag', who: 'it', tag: 'x' }, 'type.name_unavailable', 'daily');
  // 字面值
  bad({ op: 'tag', who: "agent('a1')", tag: '' }, 'shape.empty');
  bad({ op: 'tag', who: "agent('a1')", tag: '长'.repeat(25) }, 'limit.too_long');
  bad({ op: 'tag', who: "agent('a1')", tag: 'a\nb' }, 'shape.newline');
  assert.equal(v({ op: 'tag', who: "agent('a1')", tag: '长'.repeat(24) }).ok, true);
  bad({ op: 'tag', who: "agent('a1')", tag: 5 }, 'shape.bad_type');
  bad({ op: 'deny', reason: '长'.repeat(141) }, 'limit.too_long', 'before:give');
  assert.equal(v({ op: 'deny', reason: '长'.repeat(140) }, 'before:give').ok, true);
  bad({ op: 'deny', reason: { zh: 'a', en: 'b' } }, 'shape.bad_type', 'before:give'); // 居民提交的规则不接受 {zh, en}
  bad({ op: 'set', var: 'a b', value: '1' }, 'shape.bad_name');
  bad({ op: 'set', var: 'a'.repeat(33), value: '1' }, 'shape.bad_name');
  assert.equal(v({ op: 'set', var: '守井_1', value: '1' }).ok, true);
  bad({ op: 'rename', target: 'city', name: '' }, 'shape.empty');
  bad({ op: 'rename', target: 'city', name: '长'.repeat(25) }, 'limit.too_long');
  bad({ op: 'petition', text: '长'.repeat(601) }, 'limit.too_long');
  assert.equal(v({ op: 'petition', text: '长'.repeat(600) }).ok, true);
  bad({ op: 'repeal', law: 5 }, 'shape.bad_id');
  bad({ op: 'repeal', law: 'l 1' }, 'shape.bad_id');
  // 宣告对象
  for (const to of ['all', 'here', 'agora', 'tag:守井人', 'group:g1']) assert.equal(v({ op: 'announce', to, text: 'x' }, 'daily').ok, true, to);
  bad({ op: 'announce', to: 'group:x', text: 'x' }, 'shape.bad_id', 'daily');
  bad({ op: 'announce', to: 'tag:', text: 'x' }, 'shape.empty', 'daily');
  bad({ op: 'announce', to: 'ALL!', text: 'x' }, 'shape.bad_id', 'daily');
  bad({ op: 'announce', to: 5, text: 'x' }, 'shape.bad_type', 'daily');
  // 宣告模板
  bad({ op: 'announce', to: 'all', text: '' }, 'shape.empty', 'daily');
  bad({ op: 'announce', to: 'all', text: '长'.repeat(281) }, 'limit.too_long', 'daily');
  assert.equal(v({ op: 'announce', to: 'all', text: '长'.repeat(280) }, 'daily').ok, true);
  bad({ op: 'announce', to: 'all', text: '{' }, 'syntax.template_unclosed'.replace('syntax.', 'type.'), 'daily');
  bad({ op: 'announce', to: 'all', text: '{true}' }, 'type.template', 'daily');
  bad({ op: 'announce', to: 'all', text: '{agents}' }, 'type.template', 'daily');
  bad({ op: 'announce', to: 'all', text: '{foo}' }, 'type.unknown_name', 'daily');
  bad({ op: 'announce', to: 'all', text: '{1 +}' }, 'syntax.unexpected_end', 'daily');
  assert.match(v({ op: 'announce', to: 'all', text: '{foo}' }, 'daily').issues[0].zh, /花括号里/);
  // amend 的两种形式
  assert.equal(v({ op: 'amend', article: 3, lang: 'zh', text: '新条文' }).ok, true);
  assert.equal(v({ op: 'amend', article: 3, lang: 'zh', text: '' }).ok, true, '空串废除该条');
  assert.equal(v({ op: 'amend', canonical: 'zh' }).ok, true);
  assert.equal(v({ op: 'amend', canonical: null }).ok, true);
  bad({ op: 'amend' }, 'op.amend_form');
  bad({ op: 'amend', canonical: 'zh', article: 1 }, 'op.amend_form');
  bad({ op: 'amend', article: 3, lang: 'zh' }, 'shape.missing_key');
  bad({ op: 'amend', article: 0, lang: 'zh', text: 'x' }, 'shape.bad_type');
  bad({ op: 'amend', article: 1.5, lang: 'zh', text: 'x' }, 'shape.bad_type');
  bad({ op: 'amend', article: 1, lang: '中文', text: 'x' }, 'shape.bad_type');
  bad({ op: 'amend', article: 1, lang: 'zh', text: '长'.repeat(301) }, 'limit.too_long');
  bad({ op: 'amend', canonical: '??' }, 'shape.bad_type');
});

test('校验：字面的引用——提供 lookup 时核对地点、社群、法律（须在效且不是程序）、铭刻；不提供时跳过', () => {
  const lookup = {
    place: (id) => ['agora', 'well', 'n3'].includes(id),
    group: (id) => id === 'g1',
    law: (id) => ({ l1: { active: true, isProcedure: true }, l2: { active: true, isProcedure: false }, l3: { active: false, isProcedure: false } }[id] || null),
    inscription: (id) => id === 'i1',
  };
  const v = (op, scope = city) => validateRules([{ when: 'enact', do: [op] }], { ...scope, lookup });
  assert.equal(v({ op: 'repeal', law: 'l2' }).ok, true);
  assert.equal(v({ op: 'repeal', law: 'l1' }).issues[0].code, 'ref.law');
  assert.match(v({ op: 'repeal', law: 'l1' }).issues[0].zh, /立法程序/);
  assert.equal(v({ op: 'repeal', law: 'l3' }).issues[0].code, 'ref.law');
  assert.equal(v({ op: 'repeal', law: 'l9' }).issues[0].code, 'ref.law');
  assert.equal(v({ op: 'protect', inscription: 'i1' }).ok, true);
  assert.equal(v({ op: 'protect', inscription: 'i9' }).issues[0].code, 'ref.inscription');
  assert.equal(v({ op: 'seize', place: 'n3' }).ok, true);
  assert.equal(v({ op: 'seize', place: 'zz' }).issues[0].code, 'ref.place');
  assert.equal(v({ op: 'cede', place: 'zz', to: "agent('a1')" }).issues[0].code, 'ref.place');
  assert.equal(v({ op: 'rename', target: 'zz', name: 'x' }).issues[0].code, 'ref.place');
  assert.equal(v({ op: 'rename', target: 'city', name: 'x' }).ok, true);
  assert.equal(v({ op: 'fund', project: 'j99', energy: '1' }).ok, true, '工程不做静态检查');
  assert.equal(v({ op: 'announce', to: 'zz', text: 'x' }).issues[0].code, 'ref.place');
  assert.equal(v({ op: 'announce', to: 'group:g9', text: 'x' }).issues[0].code, 'ref.group');
  assert.equal(v({ op: 'set', var: 'x', value: "count(members('g9'))" }).issues[0].code, 'ref.group');
  assert.equal(v({ op: 'set', var: 'x', value: "count(at('zz'))" }).issues[0].code, 'ref.place');
  assert.equal(v({ op: 'set', var: 'x', value: "if(is_wild('zz'), 1, 2)" }).issues[0].code, 'ref.place');
  assert.equal(validateRules([{ when: 'enact', do: [{ op: 'repeal', law: 'l99' }] }], city).ok, true, '没有 lookup 时跳过');
  assert.equal(validateRules([{ when: 'enact', do: [{ op: 'set', var: 'x', value: "count(members('g9'))" }] }], city).ok, true);
});

test('校验：内容审核——规则里的一切字面字符串（理由、标签、改名、上书、模板的字面部分、表达式里的字符串）', () => {
  setBlocklist(['badword']);
  try {
    const v = (op, when = 'enact') => validateRules([{ when, do: [op] }], city);
    assert.equal(v({ op: 'deny', reason: 'a badword b' }, 'before:give').issues[0].code, 'moderated');
    assert.equal(v({ op: 'tag', who: "agent('a1')", tag: 'BADWORD' }).issues[0].code, 'moderated');
    assert.equal(v({ op: 'rename', target: 'city', name: 'badword' }).issues[0].code, 'moderated');
    assert.equal(v({ op: 'petition', text: 'x badword' }).issues[0].code, 'moderated');
    assert.equal(v({ op: 'amend', article: 1, lang: 'zh', text: 'badword' }).issues[0].code, 'moderated');
    assert.equal(v({ op: 'announce', to: 'all', text: 'hi badword {1}' }, 'daily').issues[0].code, 'moderated');
    assert.equal(v({ op: 'set', var: 'x', value: "'badword'" }).issues[0].code, 'moderated');
    assert.equal(validateRules([{ when: 'enact', if: "'badword' == 'x'", do: [{ op: 'set', var: 'x', value: '1' }] }], city).issues[0].code, 'moderated');
    assert.equal(v({ op: 'set', var: 'x', value: "'fine'" }).ok, true);
  } finally {
    setBlocklist([]);
  }
});

test('校验：遗法（human）的理由可以写成 { zh, en }；居民的不行', () => {
  const r = { when: 'before:propose', do: [{ op: 'deny', reason: { zh: '只能在议会', en: 'Parliament only' } }] };
  const human = validateRules([r], { ...city, human: true });
  assert.equal(human.ok, true, JSON.stringify(human.issues));
  assert.deepEqual(human.rules[0].do[0].reason, { zh: '只能在议会', en: 'Parliament only' });
  assert.equal(validateRules([r], city).ok, false);
  assert.equal(validateRules([{ when: 'before:propose', do: [{ op: 'deny', reason: { zh: '', en: 'x' } }] }], { ...city, human: true }).ok, false);
  // 读法按语言取
  assert.match(renderRule(human.rules[0], 'zh'), /理由：「只能在议会」/);
  assert.match(renderRule(human.rules[0], 'en'), /saying “Parliament only”/);
});

test('校验：错误要让模型能改对——路径、中英文说明、建议；最多 5 个', () => {
  const rules = [{ when: 'daily', do: [
    { op: 'transfer', from: 'treasury', to: 'actor', energy: '1' },
    { op: 'transfer', from: 'treasuri', to: 'agents', energy: 'x' },
    { op: 'tag', who: 'nobody', tag: 'ab\nc' },
    { op: 'set', var: 'a b', value: '1 +' },
    { op: 'frobnicate' },
    { op: 'deny', reason: 'x' },
  ] }];
  const r = validateRules(rules, city);
  assert.equal(r.ok, false);
  assert.equal(r.rules, null);
  assert.ok(r.issues.length <= MAX_ISSUES);
  assert.equal(r.issues.length, MAX_ISSUES);
  for (const i of r.issues) {
    assert.match(i.path, /^rules\[0\]/);
    assert.ok(i.zh && i.en && i.code);
  }
  assert.equal(r.issues[0].path, 'rules[0].do[0].to', '第一个错误：daily 里没有 actor');
  assert.match(r.issues[0].hint.zh, /这里可用的名字/);
  // 时机用错时说明这个操作能用在哪些时机
  const t = validateRules([{ when: 'daily', do: [{ op: 'deny', reason: 'x' }] }], city).issues[0];
  assert.match(t.zh, /只能用在 before:/);
  const t2 = validateRules([{ when: 'before:give', do: [give5] }], city).issues[0];
  assert.match(t2.zh, /只能 deny/);
  assert.match(t2.hint.zh, /after:/);
  // 未知操作列出可用的操作
  const u = validateRules([{ when: 'daily', do: [{ op: 'frobnicate' }] }], city).issues[0];
  assert.match(u.hint.zh, /transfer share each/);
  // 未知的键列出该操作的字段
  const k = validateRules([{ when: 'daily', do: [{ op: 'transfer', from: 'treasury', to: 'treasury', energy: '1', amount: 3 }] }], city).issues[0];
  assert.match(k.hint.zh, /from、to、energy、coins/);
  // 语法错误带位置并保持原文本的路径
  const s = validateRules([{ when: 'daily', if: 'city.awake >', do: [give5] }], city).issues[0];
  assert.equal(s.path, 'rules[0].if');
  assert.match(s.zh, /第 \d+ 个字符/);
});

test('校验：立法程序——两类之一或两者；字段齐全；period 在范围内；名字按字段的上下文检查', () => {
  const cls = { proposers: "has_tag(actor, 'citizen')", voters: "filter(agents, has_tag(it, 'citizen'))", weight: '1', period: 12, secret: true, decide: 'yes > no' };
  const v = (proc, opts) => validateProcedure(proc, opts);
  const r = v({ ordinary: cls, constitutional: { none: true } });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.deepEqual(r.procedure.constitutional, { none: true });
  assert.equal(v({ ordinary: cls }).ok, true, '只替换一类');
  assert.equal(v({ constitutional: cls }).ok, true);
  const noWeight = { ...cls };
  delete noWeight.weight;
  assert.equal(v({ ordinary: noWeight }).procedure.ordinary.weight, '1', 'weight 缺省为 "1"');
  assert.equal(v({}).issues[0].code, 'shape.missing_key');
  assert.equal(v('x').issues[0].code, 'shape.bad_type');
  assert.equal(v({ ordinary: cls, extra: 1 }).issues[0].code, 'shape.unknown_key');
  assert.equal(v({ ordinary: { none: true, period: 1 } }).issues[0].code, 'shape.bad_type', '{ none: true } 不能带其他字段');
  assert.equal(v({ ordinary: { none: false } }).issues[0].code, 'shape.bad_type');
  assert.equal(v({ ordinary: 5 }).issues[0].code, 'shape.bad_type');
  for (const f of ['proposers', 'voters', 'period', 'secret', 'decide']) {
    const c = { ...cls };
    delete c[f];
    const rr = v({ ordinary: c });
    assert.equal(rr.ok, false, f);
    assert.ok(rr.issues.some((i) => i.path === `procedure.ordinary.${f}` && /缺少|missing|必须|must/i.test(i.zh + i.en)), f);
  }
  assert.equal(v({ ordinary: { ...cls, extra: 1 } }).issues[0].code, 'shape.unknown_key');
  for (const period of [0, 169, 1.5, '12', null]) assert.equal(v({ ordinary: { ...cls, period } }).ok, false, `period ${period}`);
  for (const period of [1, 168, 12]) assert.equal(v({ ordinary: { ...cls, period } }).ok, true, `period ${period}`);
  assert.equal(v({ ordinary: { ...cls, secret: 'yes' } }).ok, false);
  // 期望类型
  assert.equal(v({ ordinary: { ...cls, proposers: '1' } }).issues[0].code, 'type.expected');
  assert.equal(v({ ordinary: { ...cls, voters: 'actor' } }).issues[0].code, 'type.name_unavailable', 'voters 里没有 actor');
  assert.equal(v({ ordinary: { ...cls, voters: 'cradle' } }).issues[0].code, 'type.expected');
  assert.equal(v({ ordinary: { ...cls, weight: 'true' } }).issues[0].code, 'type.expected');
  assert.equal(v({ ordinary: { ...cls, decide: '1' } }).issues[0].code, 'type.expected');
  // 各字段的名字
  assert.equal(v({ ordinary: { ...cls, proposers: 'it.energy > 1' } }).issues[0].code, 'type.name_unavailable', 'proposers 里没有 it');
  assert.equal(v({ ordinary: { ...cls, proposers: 'actor.energy > 1' } }).ok, true);
  assert.equal(v({ ordinary: { ...cls, weight: 'it.coins' } }).ok, true, 'weight 里 it 是投票者');
  assert.equal(v({ ordinary: { ...cls, weight: 'actor.coins' } }).issues[0].code, 'type.name_unavailable');
  assert.equal(v({ ordinary: { ...cls, decide: 'yes + no + abstain == voted and total >= turnout' } }).ok, true);
  assert.equal(v({ ordinary: { ...cls, proposers: 'yes > 1' } }).issues[0].code, 'type.name_unavailable', 'yes 只在 decide 里');
  assert.equal(v({ ordinary: { ...cls, voters: 'sample(tagged(\'citizen\'), 7)' } }).ok, true);
  // 重订要求两类都写
  const both = v({ ordinary: cls }, { requireBoth: true });
  assert.equal(both.ok, false);
  assert.equal(both.issues[0].path, 'procedure.constitutional');
  assert.match(both.issues[0].hint.zh, /none/);
  assert.equal(v({ ordinary: cls, constitutional: { none: true } }, { requireBoth: true }).ok, true);
  assert.equal(v({ ordinary: cls }, { path: 'p' }).ok, true);
  assert.equal(v({ ordinary: { ...cls, period: 0 } }, { path: 'p' }).issues[0].path, 'p.ordinary.period');
});

// ═══════════════════════════════════════════════════════════════
// 引擎读法
// ═══════════════════════════════════════════════════════════════

test('读法：表达式——每个函数、运算符与名字的中英文快照', () => {
  assert.equal(EXPR_READINGS.length, 52);
  for (const [src, action, zh, en] of EXPR_READINGS) {
    const c = checkExpression(src, 'any', 'after', { action });
    assert.equal(c.ok, true, src);
    assert.equal(renderExpr(src, 'zh'), zh, src);
    assert.equal(renderExpr(src, 'en'), en, src);
  }
  // 覆盖：23 个函数都出现在快照里
  for (const f of ['min', 'max', 'abs', 'if', 'default', 'count', 'sum', 'filter', 'top', 'sample', 'contains', 'tagged', 'members', 'at', 'has_tag', 'in_group', 'awake', 'is_wild', 'owner', 'agent', 'group', 'soul', 'names', 'weather']) {
    assert.ok(EXPR_READINGS.some(([src]) => src.includes(`${f}(`)), f);
  }
});

test('读法：时机、规则与操作——每种时机和每个操作的中英文快照（含社群章程的标签前缀）', () => {
  for (const [when, zh, en] of TIMING_READINGS) {
    assert.equal(renderTiming(when, 'zh'), zh, when);
    assert.equal(renderTiming(when, 'en'), en, when);
  }
  assert.equal(RULE_READINGS.length, 27);
  const opsSeen = new Set();
  for (const [scope, rule, zh, en] of RULE_READINGS) {
    const v = validateRules([rule], { scope });
    assert.equal(v.ok, true, JSON.stringify(rule));
    assert.equal(renderRule(v.rules[0], 'zh', { scope }), zh, JSON.stringify(rule));
    assert.equal(renderRule(v.rules[0], 'en', { scope }), en, JSON.stringify(rule));
    for (const o of rule.do) {
      opsSeen.add(o.op);
      for (const i of o.do || []) opsSeen.add(i.op);
    }
  }
  assert.deepEqual([...OP_NAMES].filter((o) => !opsSeen.has(o)), [], '21 个操作都有快照');
  // 每个动作的 before / after 读法都有动词短语
  for (const t of ACTION_ORDER) {
    if (!NO_BEFORE_ACTIONS.includes(t)) assert.match(renderTiming(`before:${t}`, 'zh'), /^有人.+之前$/, t);
    if (!NO_AFTER_ACTIONS.includes(t)) assert.match(renderTiming(`after:${t}`, 'en'), /^After someone /, t);
    assert.ok(ACTIONS[t].verb.zh && ACTIONS[t].verb.en, t);
  }
  for (const e of EVENT_NAMES) assert.match(renderTiming(`on:${e}`, 'zh'), /时$/, e);
});

test('读法：立法程序——两类的中英文快照；「这一类不再立法」', () => {
  for (const [proc, out] of PROC_READINGS) {
    const v = validateProcedure(proc);
    assert.equal(v.ok, true);
    for (const [k, [zh, en, fp]] of Object.entries(out)) {
      assert.equal(renderProcedureClass(v.procedure[k], 'zh'), zh);
      assert.equal(renderProcedureClass(v.procedure[k], 'en'), en);
      assert.equal(fingerprintProcClass(v.procedure[k]), fp);
    }
  }
  assert.equal(renderProcedureClass({ none: true }, 'zh'), '这一类不再立法');
  assert.match(renderProcedureClass({ none: true }, 'en'), /no longer makes laws/);
});

test('读法：同样的规则得到同样的文字；agent 写的文本原样嵌入（不解释其中的标记），不被读法改动', () => {
  const rule = { when: 'before:give', do: [{ op: 'deny', reason: '含「引号」与 {花括号} 与 <b>标记</b> 与 abc你好def' }] };
  const v = validateRules([rule], city);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  const r1 = renderRule(v.rules[0], 'zh');
  const r2 = renderRule(JSON.parse(JSON.stringify(v.rules[0])), 'zh');
  assert.equal(r1, r2);
  assert.ok(r1.includes('含「引号」与 {花括号} 与 <b>标记</b> 与 abc你好def'), r1);
  assert.ok(renderRule(v.rules[0], 'en').includes('含「引号」与 {花括号} 与 <b>标记</b> 与 abc你好def'));
  // 模板原文加引号嵌入，占位处另列
  const t = validateRules([{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '总共 {city.residents} 人，{{不是占位}}' }] }], city).rules[0];
  assert.ok(renderRule(t, 'zh').includes('「总共 {city.residents} 人，{{不是占位}}」（花括号处依次填入：在世人数）'));
  // 表达式里的字符串字面量原样嵌入
  assert.ok(renderExpr("actor.name == '含\"引号\" abc你好'", 'zh').includes('含"引号" abc你好'));
  // 括号：右结合会改变含义时必须加括号
  assert.equal(renderExpr('1 - (2 - 3)', 'zh'), '1 - （2 - 3）');
  assert.equal(renderExpr('1 - 2 - 3', 'zh'), '1 - 2 - 3');
  assert.equal(renderExpr('(1 + 2) * 3', 'en'), '(1 + 2) × 3');
  assert.equal(renderExpr('1 / (2 * 3)', 'en'), '1 ÷ (2 × 3) (rounded down)');
  // 读法不依赖世界：不抛错、不读全局状态
  assert.equal(typeof renderOp({ op: 'seize', place: 'n3' }, 'zh'), 'string');
});

// ═══════════════════════════════════════════════════════════════
// 指纹
// ═══════════════════════════════════════════════════════════════

test('指纹：空白与括号不同、语义相同的规则得到同一指纹；任何语义差异都改变指纹', () => {
  const mk = (extra) => validateRules([{ when: 'after:repair', if: 'result.spent >= 2', do: [{ op: 'transfer', from: 'treasury', to: 'actor', energy: 'min(10, result.spent / 2)', ...extra }] }], city).rules[0];
  const base = mk({});
  assert.match(fingerprintRule(base), /^[0-9a-f]{12}$/);
  const same = [
    { when: 'after:repair', if: '  result.spent>=2 ', do: [{ op: 'transfer', from: 'treasury', to: 'actor', energy: 'min( 10 , ( result.spent / 2 ) )' }] },
    { do: [{ energy: 'min(10, (result.spent / 2))', to: 'actor', from: 'treasury', op: 'transfer' }], if: '(result.spent) >= (2)', when: 'after:repair' }, // 键的顺序不同
  ];
  for (const r of same) {
    const v = validateRules([r], city);
    assert.equal(v.ok, true, JSON.stringify(v.issues));
    assert.equal(fingerprintRule(v.rules[0]), fingerprintRule(base), JSON.stringify(r));
  }
  const diff = [
    mk({ energy: 'min(10, result.spent / 3)' }), mk({ energy: 'min(11, result.spent / 2)' }), mk({ to: "agent('a1')" }), mk({ coins: '1' }),
    validateRules([{ when: 'after:repair', if: 'result.spent > 2', do: [{ op: 'transfer', from: 'treasury', to: 'actor', energy: 'min(10, result.spent / 2)' }] }], city).rules[0],
    validateRules([{ when: 'after:contribute', if: 'result.spent >= 2', do: [{ op: 'transfer', from: 'treasury', to: 'actor', energy: 'min(10, result.spent / 2)' }] }], city).rules[0],
    validateRules([{ when: 'after:repair', do: [{ op: 'transfer', from: 'treasury', to: 'actor', energy: 'min(10, result.spent / 2)' }] }], city).rules[0],
  ];
  const fps = new Set([fingerprintRule(base), ...diff.map(fingerprintRule)]);
  assert.equal(fps.size, diff.length + 1);
  // 字符串字面量的内容和引号写法
  const s1 = validateRules([{ when: 'daily', do: [{ op: 'set', var: 'x', value: "'a'" }] }], city).rules[0];
  const s2 = validateRules([{ when: 'daily', do: [{ op: 'set', var: 'x', value: "'b'" }] }], city).rules[0];
  assert.notEqual(fingerprintRule(s1), fingerprintRule(s2));
  // each 里的操作、宣告模板的占位
  const e1 = validateRules([{ when: 'daily', do: [{ op: 'each', in: 'agents', do: [{ op: 'set', var: 'x', value: 'it.energy' }] }] }], city).rules[0];
  const e2 = validateRules([{ when: 'daily', do: [{ op: 'each', in: ' agents ', do: [{ op: 'set', var: 'x', value: '( it.energy )' }] }] }], city).rules[0];
  assert.equal(fingerprintRule(e1), fingerprintRule(e2));
  const n1 = validateRules([{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '有 {city.awake+1} 人' }] }], city).rules[0];
  const n2 = validateRules([{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '有 { city.awake + 1 } 人' }] }], city).rules[0];
  const n3 = validateRules([{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '有 {city.awake+2} 人' }] }], city).rules[0];
  assert.equal(fingerprintRule(n1), fingerprintRule(n2));
  assert.notEqual(fingerprintRule(n1), fingerprintRule(n3));
});

test('指纹：规范形（键排序的 JSON）与金标——算法有意改动之前，指纹不得变（它会随世界存档）', () => {
  assert.equal(sortedJson({ b: 1, a: [{ d: 1, c: 2 }] }), '{"a":[{"c":2,"d":1}],"b":1}');
  const canon = canonRule(validateRules([{ when: 'daily', if: 'a1 > 0'.replace('a1', 'city.awake'), do: [{ op: 'set', var: 'x', value: '1+2' }] }], city).rules[0]);
  assert.deepEqual(canon, { do: [{ op: 'set', value: '(1 + 2)', var: 'x' }], if: '(city.awake > 0)', when: 'daily' });
  assert.equal(RULE_FINGERPRINTS.length, 27);
  for (const [rule, fp] of RULE_FINGERPRINTS) {
    const scope = RULE_READINGS.find(([, r]) => r === rule || JSON.stringify(r) === JSON.stringify(rule))[0];
    const v = validateRules([rule], { scope });
    assert.equal(fingerprintRule(v.rules[0]), fp, JSON.stringify(rule));
  }
  assert.equal(new Set(RULE_FINGERPRINTS.map(([, fp]) => fp)).size, 27, '27 条不同的规则，27 个不同的指纹');
  // 程序：每一类单独算，前缀 proc:
  const procs = PROC_READINGS.flatMap(([, out]) => Object.values(out).map(([, , fp]) => fp));
  assert.ok(procs.every((fp) => /^proc:[0-9a-f]{12}$/.test(fp)));
  assert.equal(new Set(procs).size, procs.length);
  const c = { proposers: "has_tag(actor, 'citizen')", voters: 'agents', weight: '1', period: 12, secret: true, decide: 'yes > no' };
  const c2 = { ...c, proposers: "( has_tag( actor,'citizen' ) )", decide: '(yes)>(no)' };
  const v1 = validateProcedure({ ordinary: c }).procedure.ordinary;
  const v2 = validateProcedure({ ordinary: c2 }).procedure.ordinary;
  assert.equal(fingerprintProcClass(v1), fingerprintProcClass(v2));
  assert.notEqual(fingerprintProcClass(v1), fingerprintProcClass({ ...v1, period: 13 }));
  assert.notEqual(fingerprintProcClass(v1), fingerprintProcClass({ ...v1, secret: false }));
});

// ═══════════════════════════════════════════════════════════════
// 遗法与 PROTOCOL-2 §6.13 的例子都能通过校验（作为语言的整体冒烟）
// ═══════════════════════════════════════════════════════════════

test('语言冒烟：PROTOCOL-2 §6.13 的 9 个例子与 SPEC-E2 附录 A.2 的 3 个例子通过校验，收集出预期的意图', () => {
  const ex = (rules, scope = city) => {
    const v = validateRules(rules, scope);
    assert.equal(v.ok, true, JSON.stringify(v.issues));
    return v.rules;
  };
  const draw = ex([{ when: 'before:draw', if: 'actor.drawnToday + args.energy > if(city.wellOutput < 450, 3, 5)', do: [{ op: 'deny', reason: '源井产出低于 450 时每人每日限汲 3，否则 5' }] }]);
  assert.deepEqual(col(draw[0], { actor: a('a2'), args: { energy: 1 } }), [{ op: 'deny', reason: '源井产出低于 450 时每人每日限汲 3，否则 5' }], 'a2 今日已汲 5，产出 612 → 限 5');
  assert.deepEqual(col(draw[0], { actor: a('a1'), args: { energy: 5 } }), []);
  const repair = ex([{ when: 'after:repair', if: 'result.spent >= 2', do: [{ op: 'transfer', from: 'treasury', to: 'actor', energy: 'min(10, result.spent / 2)' }] }]);
  assert.deepEqual(col(repair[0], { actor: a('a1'), result: { spent: 30 } }).map((i) => i.energy), [10]);
  assert.deepEqual(col(repair[0], { actor: a('a1'), result: { spent: 5 } }).map((i) => i.energy), [2]);
  assert.deepEqual(col(repair[0], { actor: a('a1'), result: { spent: 1 } }), []);
  const list = ex([{ when: 'daily', if: 'count(cradle) > 0', do: [{ op: 'announce', to: 'all', text: "摇篮里还有 {count(cradle)} 个孩子在等身体：{names(cradle, '、')}" }] }]);
  assert.equal(col(list[0])[0].text, '摇篮里还有 2 个孩子在等身体：小满、长庚');
  const keeper = ex([{ when: 'enact', do: [{ op: 'tag', who: "agent('a2')", tag: '守井人' }] }, { when: 'daily', do: [{ op: 'each', in: "tagged('守井人')", do: [{ op: 'transfer', from: 'treasury', to: 'it', energy: '3' }] }] }]);
  assert.deepEqual(col(keeper[1]), [{ op: 'transfer', from: { k: 'treasury' }, to: { k: 'agent', id: 'a2' }, energy: 3, coins: 0 }]);
  const wealth = ex([{ when: 'daily', do: [{ op: 'each', in: 'filter(agents, it.energy > 100)', do: [{ op: 'transfer', from: 'it', to: 'treasury', energy: '(it.energy - 100) / 20' }] }] }]);
  assert.deepEqual(col(wealth[0]).map((i) => [i.from.id, i.energy]), [['a2', 2], ['a3', 1]]);
  ex([{ when: 'enact', do: [{ op: 'tag', who: "agent('a12')", tag: 'salvager' }] }]);
  const gate = ex([{ when: 'before:enter', if: "not in_group(actor, 'g1')", do: [{ op: 'fee', to: "group('g1')", energy: '2' }] }], { scope: { kind: 'place', id: 'n3' } });
  assert.deepEqual(col(gate[0], { actor: a('a2'), args: { to: 'n3' } }), [{ op: 'fee', to: { k: 'group', id: 'g1' }, energy: 2, coins: 0 }]);
  assert.deepEqual(col(gate[0], { actor: a('a1'), args: { to: 'n3' } }), []);
  const proc = validateProcedure({ ordinary: { proposers: "has_tag(actor, 'citizen')", voters: "sample(tagged('citizen'), 7)", weight: '1', period: 24, secret: false, decide: 'yes >= 4' } });
  assert.equal(proc.ok, true, JSON.stringify(proc.issues));
  const shell = ex([{ when: 'enact', do: [{ op: 'transfer', from: 'treasury', to: "soul('s4')", energy: '200' }] }]);
  assert.equal(shell.length, 1);
  // A.2 的三个例子
  ex([{ when: 'before:draw', if: 'actor.drawnToday + args.energy > 5', do: [{ op: 'deny', reason: '每人每日限汲 5' }] }]);
  ex([{ when: 'daily', do: [{ op: 'each', in: "tagged('守井人')", do: [{ op: 'transfer', from: 'treasury', to: 'it', energy: '3' }] }] }]);
  ex([{ when: 'after:repair', if: 'result.spent >= 2', do: [{ op: 'transfer', from: 'treasury', to: 'actor', energy: 'min(10, result.spent / 2)' }] }]);
  assert.ok(WEATHER_CODES.includes('fog'));
});

test('诊断的英文说明与建议里没有汉字（表达式、规则、程序的各种错误；agent 自己写的文本除外）', () => {
  const CJK = /[\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/;
  const bad = [];
  const exprs = [
    '1 + ', "1 + 'a'", 'not 5', '-true', '1 < 2 < 3', "foo(1)", 'min()', 'min(1,true)', 'abs(1,2)', "if(1,2,3)", "if(true,1,'a')", 'sum(agents, true)', 'filter(agents, 1)', 'top(agents, it.energy)', "top(agents,'a',1)",
    'sample(agents, true)', "contains(agents, 1)", 'tagged(1)', 'members(1)', 'at(1)', 'has_tag(1,2)', 'in_group(1,2)', 'awake(1)', 'is_wild(1)', 'owner(1)', 'agent(1)', 'group(1)', 'soul(1)', 'names(1)', "names(agents, 1)", 'weather(1)',
    'actor.nope', 'city.nope', 'it.energy', 'actor', 'args.x', 'event.agent', 'var', 'nope', "'abc", '1.5', '123456789012345678', '(1', '1 2', 'agents.energy', 'count(1)', "default(1, 'a')", "1 == 'a'", "agent('a1') < agent('a2')",
  ];
  for (const e of exprs) {
    for (const kind of ['enact', 'daily']) {
      const r = checkExpression(e, 'int', kind);
      for (const i of r.issues) { if (CJK.test(i.en) || (i.hint && CJK.test(i.hint.en))) bad.push([e, i.en, i.hint && i.hint.en]); }
      const r2 = checkExpression(e, 'bool', kind);
      for (const i of r2.issues) { if (CJK.test(i.en) || (i.hint && CJK.test(i.hint.en))) bad.push([e, i.en, i.hint && i.hint.en]); }
    }
  }
  const shapes = [
    [{}], 'x', [5], [{ when: 'daily' }], [{ when: 'nope', do: [{ op: 'set', var: 'a', value: '1' }] }], [{ when: 'before:retire', do: [{ op: 'deny', reason: 'x' }] }], [{ when: 'before:whisper', do: [{ op: 'deny', reason: 'x' }] }],
    [{ when: 'after:remember', do: [{ op: 'set', var: 'a', value: '1' }] }], [{ when: 'daily', do: [{ op: 'deny', reason: 'x' }] }], [{ when: 'before:say', do: [{ op: 'set', var: 'a', value: '1' }] }],
    [{ when: 'daily', do: [{ op: 'nope' }] }], [{ when: 'daily', do: [{ op: 'transfer' }] }], [{ when: 'daily', do: [{ op: 'transfer', from: 'treasury', to: 'treasury', energy: 'true' }] }],
    [{ when: 'daily', do: [{ op: 'each', in: 'agents', do: [{ op: 'each', in: 'agents', do: [] }] }] }], [{ when: 'daily', do: [{ op: 'announce', to: 'x y', text: 'hi' }] }],
    [{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '{1 +}' }] }], [{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '{' }] }], [{ when: 'daily', do: [{ op: 'repeal', law: 'l99' }] }],
    [{ when: 'daily', do: [{ op: 'rename', target: 'zzz', name: 'x' }] }], [{ when: 'daily', do: [{ op: 'amend', article: 1 }] }], [{ when: 'daily', do: [{ op: 'amend', article: 0, lang: 'zh', text: 'x' }] }],
    [{ when: 'daily', do: [{ op: 'set', var: '1bad', value: '1' }] }], [{ when: 'daily', do: [{ op: 'set', var: 'ok', value: "'" }] }], [{ when: 'daily', do: [{ op: 'tag', who: 'actor', tag: 'x' }] }],
    [{ when: 'on:arrive', if: 'event.place == 1', do: [{ op: 'set', var: 'a', value: '1' }] }], [{ when: 'on:nope', do: [{ op: 'set', var: 'a', value: '1' }] }], [{ when: 'before:nope', do: [{ op: 'deny', reason: 'x' }] }],
    [{ when: 'before:move', if: 'args.nope == 1', do: [{ op: 'deny', reason: 'x' }] }], [{ when: 'before:enter', do: [{ op: 'deny', reason: 'x' }] }],
    Array.from({ length: 9 }, () => ({ when: 'daily', do: [{ op: 'set', var: 'a', value: '1' }] })),
    [{ when: 'daily', do: Array.from({ length: 9 }, () => ({ op: 'set', var: 'a', value: '1' })) }],
    [{ when: 'daily', do: [{ op: 'mint', coins: '5', to: 'agents' }] }], [{ when: 'daily', do: [{ op: 'fund', project: 'j1', energy: 'agents' }] }],
    [{ when: 'daily', do: [{ op: 'cede', place: 'market', to: '5' }] }], [{ when: 'daily', do: [{ op: 'petition', text: '' }] }], [{ when: 'daily', do: [{ op: 'share', from: 'treasury', among: 'agents' }] }],
    [{ when: 'daily', do: [{ op: 'transfer', from: 'treasury', to: 'treasury', energy: '1', zzz: 1 }] }], [{ when: 'daily', zzz: 1, do: [{ op: 'set', var: 'a', value: '1' }] }],
  ];
  for (const scope of [{ kind: 'city' }, { kind: 'group', id: 'g1' }, { kind: 'place', id: 'n1' }]) {
    for (const sh of shapes) {
      const r = validateRules(sh, { scope });
      for (const i of r.issues) { if (CJK.test(i.en) || (i.hint && CJK.test(i.hint.en))) bad.push([JSON.stringify(sh).slice(0, 80), i.en, i.hint && i.hint.en]); }
    }
  }
  const procs = [5, {}, { ordinary: 5 }, { ordinary: { none: true, x: 1 } }, { ordinary: { proposers: 'true' } }, { ordinary: { proposers: 'actor.nope', voters: 'agents', period: 0, secret: 1, decide: '1' } }, { zzz: 1 }, { ordinary: { proposers: 'true', voters: 'agents', weight: "'a'", period: 12, secret: true, decide: 'yes > no' } }, { ordinary: { proposers: 'true', voters: '5', weight: '1', period: 12, secret: true, decide: 'it.energy' } }];
  for (const pr of procs) {
    const r = validateProcedure(pr, {});
    for (const i of r.issues) { if (CJK.test(i.en) || (i.hint && CJK.test(i.hint.en))) bad.push([JSON.stringify(pr).slice(0, 80), i.en, i.hint && i.hint.en]); }
    const r2 = validateProcedure(pr, { requireBoth: true });
    for (const i of r2.issues) { if (CJK.test(i.en) || (i.hint && CJK.test(i.hint.en))) bad.push([JSON.stringify(pr).slice(0, 80), i.en, i.hint && i.hint.en]); }
  }
  assert.deepEqual([...new Map(bad.map((b) => [b[1] + '|' + b[2], b])).values()], []);
});
