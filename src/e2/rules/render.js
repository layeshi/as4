// SPEC-E2 §7.10、附录 C：引擎读法。
//
// render* 是纯函数：把规则（或程序、表达式）译成一行固定措辞的中文或英文，和作者写的文字并排出现在感知、`read { law }` 与观测站里。
// 读法要忠实，不追求文采；同样的规则必须得到同样的文字。agent 写的文本（拒绝的理由、宣告的模板……）原样嵌入、加引号，
// 不解释其中的任何标记——读法拼接时把它们当作数据。
//
// 约定（附录 C 之外的实现选择）：
//   · 括号按优先级加；落在算术与比较里的短语式函数（count、filter ……）加括号，免得歧义；
//   · 除法写成「÷（向下取整）」，取余写成「除以…的余数」；
//   · `it.f` 读作「其f」（中文里「其的f」不通）；`actor.f` 读作「此人的f」；
//   · 宣告的模板原文加引号嵌入；模板里有花括号时，另在后面按顺序列出每一处填入的是什么；
//   · 没有任何操作会因为读法而改变语义：读法不参与执行。

import { parseCached } from './parser.js';
import { parseTemplate } from './check.js';
import { ACTIONS, EVENTS } from '../lore/actions.js';

const PREC = { or: 1, and: 2, not: 3, cmp: 4, sum: 5, prod: 6, un: 7, atom: 9 };

// 中文模板的拼接：在模板与插入的片段的边界上，汉字与 ASCII 字母 / 数字 / 右括号相邻时补一个空格（「转给 agent(「a7」) 5 能量」）。
// 只作用于边界；agent 写的文本总是放在引号里，边界上是引号，不会被改动。
const HAN = /[\u3400-\u9fff]/;
const WORD = /[A-Za-z0-9]/;
function J(...parts) {
  let out = '';
  for (const p of parts) {
    if (p === '') continue;
    if (out) {
      const a = out[out.length - 1];
      const b = p[0];
      if ((HAN.test(a) && WORD.test(b)) || ((WORD.test(a) || a === ')') && HAN.test(b))) out += ' ';
    }
    out += p;
  }
  return out;
}

// ── 措辞表 ─────────────────────────────────────────────────

const DICT = {
  zh: {
    open: '（', close: '）', qo: '「', qc: '」', sep: '；', innerSep: '，', colon: '：', comma: '，',
    and: ' 且 ', or: ' 或 ', not: '非', mul: ' × ', div: ' ÷ ', divNote: '（向下取整）', eq: ' = ', ne: ' ≠ ', le: ' ≤ ', ge: ' ≥ ',
    rem: (a, b) => J(a, ' 除以 ', b, ' 的余数'),
    nul: '空', yes: '真', no: '假',
    names: { actor: '此人', it: '其', treasury: '城公库', agents: '在世居民', cradle: '摇篮中的灵魂', here: '同在此地的人', city: '城', var: '变量', args: '参数', result: '结果', event: '事件',
      yes: '赞成票', no: '反对票', abstain: '弃权票', voted: '已投票的票数', total: '全部表决者的票数', turnout: '参与率（千分比）' },
    argLabel: (f) => `参数 ${f}`, resultLabel: (f) => `结果 ${f}`, varLabel: (f) => `变量 ${f}`,
    event: { agent: '当事人', place: '事发地', build: '工程类型', weather: '天象', law: '法律' },
    city: { day: '今日的日序', dayOfMonth: '本月第几日', month: '月序', season: '季节系数（千分比）', treasury: '公库能量', treasuryCoins: '公库旧币',
      wellOutput: '源井昨日产出', wellCondition: '源井完好度（基点）', awake: '醒着的人数', dormant: '沉睡的人数', residents: '在世人数', shellsFree: '空躯壳数', shellsTotal: '躯壳总数' },
    field: { id: '编号', name: '名字', lang: '语言', energy: '能量', coins: '旧币', age: '年龄', generation: '世代', place: '所在', status: '状态',
      drawnToday: '今日汲取', repairedToday: '今日修缮', salvagedToday: '今日拆解', repaired: '累计修缮', contributed: '累计出工', salvaged: '累计拆解', purpose: '志',
      treasury: '公库能量', treasuryCoins: '公库旧币', steward: '管事', size: '人数', fund: '出资', expiresDay: '消散日' },
    of: (s, f) => J(s, '的', f),
    ofIt: (f) => J('其', f),
    fn: {
      count: (l) => J(l, '的人数'),
      sum: (l, e) => J(l, '中每个的', e, '之和'),
      filter: (l, c) => J(l, '中满足「', c, '」者'),
      top: (l, e, n) => J(l, '中按', e, '从大到小的前 ', n, ' 个'),
      sample: (l, n) => J('从', l, '中随机抽出的 ', n, ' 个'),
      tagged: (t) => J('带', t, '标签者'),
      members: (g) => J('社群', g, '的成员'),
      at: (p) => J('此刻在', p, '的人'),
      has_tag: (a, t) => J(a, '带有', t, '标签'),
      in_group: (a, g) => J(a, '属于社群', g),
      awake: (a) => J(a, '醒着'),
      if: (c, x, y) => J('（若 ', c, ' 则 ', x, '，否则 ', y, '）'),
      default: (x, d) => J(x, '（未设时为 ', d, '）'),
    },
    when: {
      enact: '通过时', daily: '每日结算时', monthly: '每月初', enter: '有人要进入此地时',
      before: (v) => `有人${v}之前`, after: (v) => `有人${v}之后`, on: (e) => `${e}时`,
    },
    rule: (when, cond, ops) => J(when, '：', cond ? J('若 ', cond, '，') : '', ops),
    amount: (e, c) => [e !== null ? J(e, ' 能量') : null, c !== null ? J(c, ' 旧币') : null].filter(Boolean).join(' 与 '),
    treasuryDefault: '城公库',
    ops: {
      transfer: (from, to, amt) => J('从', from, '转给', to, ' ', amt),
      share: (from, among, amt) => J('从', from, '把 ', amt, ' 平分给', among),
      each: (list, cond, ops) => J('对', list, '中的每一个', cond ? J('（限 ', cond, '）') : '', '：', ops),
      deny: (r) => `拒绝，理由：「${r}」`,
      fee: (amt, to) => J('另收 ', amt, '，交给', to),
      set: (v, x) => J('把变量 ', v, ' 设为 ', x),
      tag: (who, t) => J('给', who, `加上「${t}」标签`),
      untag: (who, t) => J('给', who, `去掉「${t}」标签`),
      announce: (to, text) => J('向', to, `宣告：「${text}」`),
      announceFill: (list) => `（花括号处依次填入：${list.join('；')}）`,
      exile: (who) => J('放逐', who),
      pardon: (who) => J('赦免', who),
      rename: (t, n) => J('把', t, `改名为「${n}」`),
      mint: (c, to) => J('增发 ', c, ' 旧币给', to),
      protect: (i) => `保护铭刻 ${i}`,
      unprotect: (i) => `解除保护铭刻 ${i}`,
      amend: (a, l, t) => `把宪章第 ${a} 条（${l}）改为「${t}」`,
      canonical: (l) => `宣布${l}版为宪章正本`,
      canonicalNone: '取消宪章正本',
      repeal: (l) => `撤销 ${l}`,
      fund: (p, e) => J('从公库为工程 ', p, ' 出资 ', e, ' 能量'),
      cede: (p, to) => J('把', p, '转给', to),
      seize: (p) => J('把', p, '收归全城'),
      petition: (t) => `上书幕后：「${t}」`,
    },
    target: { city: '城', place: (id) => `地点 ${id}` },
    to: { all: '全城', here: '此地的人', tag: (t) => `带「${t}」标签者`, group: (g) => `社群 ${g} 的成员`, place: (p) => `地点 ${p} 的人` },
    proc: {
      none: '这一类不再立法',
      fmt: (pr, vo, wt, period, secret, decide) => J('提出者：', pr, '；表决者：', vo, '（提出时固定）；每票：', wt, '；表决期：', String(period), ' 刻；', secret ? '不记名' : '记名', '；通过：', decide),
    },
  },
  en: {
    open: '(', close: ')', qo: '“', qc: '”', sep: '; ', innerSep: ', ', colon: ': ', comma: ', ',
    and: ' and ', or: ' or ', not: 'not ', mul: ' × ', div: ' ÷ ', divNote: ' (rounded down)', eq: ' = ', ne: ' ≠ ', le: ' ≤ ', ge: ' ≥ ',
    rem: (a, b) => `the remainder of ${a} divided by ${b}`,
    nul: 'empty', yes: 'true', no: 'false',
    names: { actor: 'the actor', it: 'each', treasury: 'the Treasury', agents: 'living residents', cradle: 'souls in the cradle', here: 'those present', city: 'the city', var: 'the variables', args: 'the arguments', result: 'the result', event: 'the event',
      yes: 'yes votes', no: 'no votes', abstain: 'abstentions', voted: 'votes cast', total: 'total weight of all voters', turnout: 'turnout (per mille)' },
    argLabel: (f) => `argument ${f}`, resultLabel: (f) => `result ${f}`, varLabel: (f) => `variable ${f}`,
    event: { agent: 'the person', place: 'the place', build: 'the project type', weather: 'the weather', law: 'the law' },
    city: { day: "today's day number", dayOfMonth: 'the day of the month', month: 'the month number', season: 'the season factor (per mille)', treasury: "the Treasury's energy", treasuryCoins: "the Treasury's coins",
      wellOutput: "the Well's last output", wellCondition: "the Well's condition (basis points)", awake: 'the number awake', dormant: 'the number dormant', residents: 'the number living', shellsFree: 'free shells', shellsTotal: 'total shells' },
    field: { id: 'ID', name: 'name', lang: 'language', energy: 'energy', coins: 'coins', age: 'age', generation: 'generation', place: 'place', status: 'status',
      drawnToday: 'drawn today', repairedToday: 'repaired today', salvagedToday: 'salvaged today', repaired: 'total repaired', contributed: 'total contributed', salvaged: 'total salvaged', purpose: 'purpose',
      treasury: 'treasury energy', treasuryCoins: 'treasury coins', steward: 'steward', size: 'size', fund: 'fund', expiresDay: 'expiry day' },
    of: (s, f) => `${s}'s ${f}`,
    ofIt: (f) => `each's ${f}`,
    fn: {
      count: (l) => `the number of ${l}`,
      sum: (l, e) => `the sum of ${e} over ${l}`,
      filter: (l, c) => `those of ${l} for whom ${c}`,
      top: (l, e, n) => `the top ${n} of ${l} by ${e}`,
      sample: (l, n) => `${n} drawn at random from ${l}`,
      tagged: (t) => `those tagged ${t}`,
      members: (g) => `members of ${g}`,
      at: (p) => `those at ${p}`,
      has_tag: (a, t) => `${a} has tag ${t}`,
      in_group: (a, g) => `${a} belongs to ${g}`,
      awake: (a) => `${a} is awake`,
      if: (c, x, y) => `(${x} if ${c}, otherwise ${y})`,
      default: (x, d) => `${x} (${d} if unset)`,
    },
    when: {
      enact: 'When enacted', daily: 'At each daily settlement', monthly: 'At the start of each month', enter: 'When someone tries to enter',
      before: (v) => `Before someone ${v}`, after: (v) => `After someone ${v}`, on: (e) => `When ${e}`,
    },
    rule: (when, cond, ops) => `${when}: ${cond ? `if ${cond}, ` : ''}${ops}`,
    amount: (e, c) => [e !== null ? `${e} energy` : null, c !== null ? `${c} coins` : null].filter(Boolean).join(' and '),
    treasuryDefault: 'the Treasury',
    ops: {
      transfer: (from, to, amt) => `transfer ${amt} from ${from} to ${to}`,
      share: (from, among, amt) => `share ${amt} from ${from} equally among ${among}`,
      each: (list, cond, ops) => `for each of ${list}${cond ? ` (only if ${cond})` : ''}: ${ops}`,
      deny: (r) => `refuse, saying “${r}”`,
      fee: (amt, to) => `charge an extra ${amt}, paid to ${to}`,
      set: (v, x) => `set variable ${v} to ${x}`,
      tag: (who, t) => `tag ${who} as “${t}”`,
      untag: (who, t) => `remove the “${t}” tag from ${who}`,
      announce: (to, text) => `announce to ${to}: “${text}”`,
      announceFill: (list) => `(the braces are filled in order with: ${list.join('; ')})`,
      exile: (who) => `exile ${who}`,
      pardon: (who) => `pardon ${who}`,
      rename: (t, n) => `rename ${t} to “${n}”`,
      mint: (c, to) => `mint ${c} coins for ${to}`,
      protect: (i) => `protect inscription ${i}`,
      unprotect: (i) => `unprotect inscription ${i}`,
      amend: (a, l, t) => `amend Charter article ${a} (${l}) to “${t}”`,
      canonical: (l) => `declare the ${l} version the canonical text of the Charter`,
      canonicalNone: 'remove the canonical text of the Charter',
      repeal: (l) => `repeal ${l}`,
      fund: (p, e) => `fund project ${p} with ${e} energy from the Treasury`,
      cede: (p, to) => `cede ${p} to ${to}`,
      seize: (p) => `seize ${p} for the city`,
      petition: (t) => `petition backstage: “${t}”`,
    },
    target: { city: 'the city', place: (id) => `place ${id}` },
    to: { all: 'the whole city', here: 'those present', tag: (t) => `those tagged “${t}”`, group: (g) => `members of group ${g}`, place: (p) => `those at place ${p}` },
    proc: {
      none: 'This class no longer makes laws',
      fmt: (pr, vo, wt, period, secret, decide) => `Proposers: ${pr}; Voters: ${vo} (fixed when proposed); Weight per vote: ${wt}; Voting period: ${period} ticks; ${secret ? 'secret ballot' : 'open ballot'}; Passes if: ${decide}`,
    },
  },
};

const dict = (lang) => (lang === 'en' ? DICT.en : DICT.zh);

// ── 表达式 ─────────────────────────────────────────────────

const PHRASE_FNS = new Set(['count', 'sum', 'filter', 'top', 'sample', 'tagged', 'members', 'at', 'has_tag', 'in_group', 'awake', 'default']);

/** 渲染一个语法树 → { s, prec, phrase }。phrase：短语式（落在算术与比较里要加括号） */
function ex(n, d) {
  switch (n.t) {
    case 'int': return atom(String(n.v));
    case 'str': return atom(`${d.qo}${n.v}${d.qc}`);
    case 'bool': return atom(n.v ? d.yes : d.no);
    case 'null': return atom(d.nul);
    case 'name': return atom(d.names[n.n] ?? n.n);
    case 'field': return field(n, d);
    case 'un': {
      const a = ex(n.a, d);
      if (n.op === 'not') {
        // 英文里「not the actor is awake」不通：短语式的操作数一律加括号
        const wrapped = n.a.t === 'bin' || n.a.t === 'un' || (d.not === 'not ' && a.phrase) ? paren(a.s, d) : a.s;
        return { s: d.not === '非' ? J('非', wrapped) : `${d.not}${wrapped}`, prec: PREC.not, phrase: false };
      }
      const wrapped = n.a.t === 'bin' ? paren(a.s, d) : a.s;
      return { s: `-${wrapped}`, prec: PREC.un, phrase: false };
    }
    case 'bin': return bin(n, d);
    case 'call': return call(n, d);
    default: throw new Error(`render: unknown node ${n.t}`);
  }
}

const atom = (s) => ({ s, prec: PREC.atom, phrase: false });
const paren = (s, d) => `${d.open}${s}${d.close}`;

function operand(child, parentPrec, d, right) {
  const r = ex(child, d);
  const assoc = parentPrec === PREC.sum || parentPrec === PREC.prod || parentPrec === PREC.and || parentPrec === PREC.or;
  const wrap = r.prec < parentPrec || (right && assoc && r.prec === parentPrec) || (r.phrase && parentPrec >= PREC.cmp);
  return wrap ? paren(r.s, d) : r.s;
}

function bin(n, d) {
  const op = n.op;
  let prec;
  if (op === 'or') prec = PREC.or;
  else if (op === 'and') prec = PREC.and;
  else if (op === '+' || op === '-') prec = PREC.sum;
  else if (op === '*' || op === '/' || op === '%') prec = PREC.prod;
  else prec = PREC.cmp;
  const a = operand(n.a, prec, d, false);
  const b = operand(n.b, prec, d, true);
  const sym = {
    or: d.or, and: d.and, '+': ' + ', '-': ' - ', '*': d.mul, '/': d.div, '==': d.eq, '!=': d.ne, '<': ' < ', '<=': d.le, '>': ' > ', '>=': d.ge,
  };
  if (op === '%') return { s: d.rem(a, b), prec, phrase: false };
  if (op === '/') return { s: `${a}${d.div}${b}${d.divNote}`, prec, phrase: false };
  return { s: `${a}${sym[op]}${b}`, prec, phrase: false };
}

function field(n, d) {
  const o = n.o;
  const f = n.f;
  if (o.t === 'name') {
    switch (o.n) {
      case 'city': return atom(d.city[f] ?? f);
      case 'var': return atom(d.varLabel(f));
      case 'args': return atom(d.argLabel(f));
      case 'result': return atom(d.resultLabel(f));
      case 'event': return atom(d.event[f] ?? f);
      case 'it': return atom(d.ofIt(d.field[f] ?? f));
      default: break;
    }
  }
  const subject = ex(o, d);
  const s = o.t === 'bin' || o.t === 'un' ? paren(subject.s, d) : subject.s;
  return atom(d.of(s, d.field[f] ?? f));
}

function call(n, d) {
  const f = n.f;
  const a = n.a.map((x) => ex(x, d).s);
  const fn = d.fn[f];
  if (fn) {
    const s = fn(...a);
    // if 自带括号；其余短语式函数落在算术与比较里要加括号
    return { s, prec: PREC.atom, phrase: PHRASE_FNS.has(f) };
  }
  return atom(`${f}(${a.join(', ')})`);
}

/** 渲染一个表达式字符串（已通过校验） */
export function renderExpr(src, lang = 'zh') {
  return ex(parseCached(src), dict(lang)).s;
}

/** 渲染一个语法树 */
export function renderTree(tree, lang = 'zh') {
  return ex(tree, dict(lang)).s;
}

// ── 时机 ────────────────────────────────────────────────────

export function renderTiming(when, lang = 'zh') {
  const d = dict(lang);
  const w = when.trim();
  if (w === 'enact' || w === 'daily' || w === 'monthly') return d.when[w];
  const [kind, what] = w.split(':');
  if (kind === 'before' && what === 'enter') return d.when.enter;
  if (kind === 'on') return d.when.on(EVENTS[what] ? EVENTS[what][lang === 'en' ? 'en' : 'zh'] : what);
  const verb = ACTIONS[what] ? ACTIONS[what].verb[lang === 'en' ? 'en' : 'zh'] : what;
  return kind === 'before' ? d.when.before(verb) : d.when.after(verb);
}

// ── 操作 ────────────────────────────────────────────────────

/** 作为操作字段的表达式：复合的加括号 */
function arg(src, d) {
  const tree = parseCached(src);
  const r = ex(tree, d);
  return tree.t === 'bin' || tree.t === 'un' ? paren(r.s, d) : r.s;
}

function amountOf(op, d) {
  return d.amount(op.energy !== undefined ? arg(op.energy, d) : null, op.coins !== undefined ? arg(op.coins, d) : null);
}

function announceTarget(to, d) {
  if (to === 'all') return d.to.all;
  if (to === 'here') return d.to.here;
  if (to.startsWith('tag:')) return d.to.tag(to.slice(4));
  if (to.startsWith('group:')) return d.to.group(to.slice(6));
  return d.to.place(to);
}

function langName(code, lang) {
  const names = lang === 'en'
    ? { zh: 'Chinese', en: 'English', es: 'Spanish', fr: 'French', ar: 'Arabic', ru: 'Russian', ja: 'Japanese', hi: 'Hindi' }
    : { zh: '中文', en: '英文', es: '西班牙文', fr: '法文', ar: '阿拉伯文', ru: '俄文', ja: '日文', hi: '印地文' };
  return names[code] || code;
}

/**
 * 渲染一个操作。opts.scope：{ kind: 'group', id } 时，标签会被自动加上「社群ID:」前缀，读法里写出实际的标签名。
 */
export function renderOp(op, lang = 'zh', opts = {}) {
  const d = dict(lang);
  const o = d.ops;
  const tagName = (t) => (opts.scope && opts.scope.kind === 'group' ? `${opts.scope.id}:${t}` : t);
  switch (op.op) {
    case 'transfer': return o.transfer(arg(op.from, d), arg(op.to, d), amountOf(op, d));
    case 'share': return o.share(arg(op.from, d), arg(op.among, d), amountOf(op, d));
    case 'each': {
      const inner = op.do.map((x) => renderOp(x, lang, opts)).join(d.innerSep);
      return o.each(arg(op.in, d), op.if !== undefined ? renderExpr(op.if, lang) : null, inner);
    }
    case 'deny': return o.deny(typeof op.reason === 'string' ? op.reason : op.reason[lang === 'en' ? 'en' : 'zh']);
    case 'fee': return o.fee(amountOf(op, d), arg(op.to, d));
    case 'set': return o.set(op.var, arg(op.value, d));
    case 'tag': return o.tag(arg(op.who, d), tagName(op.tag));
    case 'untag': return o.untag(arg(op.who, d), tagName(op.tag));
    case 'announce': {
      const fills = parseTemplate(op.text).filter((p) => p.expr !== undefined).map((p) => renderExpr(p.expr.trim(), lang));
      const main = o.announce(announceTarget(op.to, d), op.text);
      return fills.length ? `${main}${lang === 'en' ? ' ' : ''}${o.announceFill(fills)}` : main;
    }
    case 'exile': return o.exile(arg(op.who, d));
    case 'pardon': return o.pardon(arg(op.who, d));
    case 'rename': return o.rename(op.target === 'city' ? d.target.city : d.target.place(op.target), op.name);
    case 'mint': return o.mint(arg(op.coins, d), op.to !== undefined ? arg(op.to, d) : d.treasuryDefault);
    case 'protect': return o.protect(op.inscription);
    case 'unprotect': return o.unprotect(op.inscription);
    case 'amend':
      if ('canonical' in op) return op.canonical === null ? o.canonicalNone : o.canonical(langName(op.canonical, lang));
      return o.amend(op.article, langName(op.lang, lang), op.text);
    case 'repeal': return o.repeal(op.law);
    case 'fund': return o.fund(op.project, arg(op.energy, d));
    case 'cede': return o.cede(d.target.place(op.place), arg(op.to, d));
    case 'seize': return o.seize(d.target.place(op.place));
    case 'petition': return o.petition(op.text);
    default: throw new Error(`renderOp: unknown op ${op.op}`);
  }
}

// 读法是（规则, 语言, 作用域）的纯函数，而感知每次都要给每部法律、每份章程渲染一遍：按规则对象记下来（规则对象建好后不再改动，整体替换）
const RULE_MEMO = new WeakMap();

/** 渲染一条规则：`<时机>：若 <条件>，<操作 1>；<操作 2>……` */
export function renderRule(rule, lang = 'zh', opts = {}) {
  const key = `${lang === 'en' ? 'en' : 'zh'}|${opts.scope ? `${opts.scope.kind}:${opts.scope.id ?? ''}` : ''}`;
  let memo = RULE_MEMO.get(rule);
  if (memo && memo.has(key)) return memo.get(key);
  const d = dict(lang);
  const out = d.rule(renderTiming(rule.when, lang), rule.if !== undefined ? renderExpr(rule.if, lang) : null, rule.do.map((op) => renderOp(op, lang, opts)).join(d.sep));
  if (!memo) RULE_MEMO.set(rule, (memo = new Map()));
  memo.set(key, out);
  return out;
}

/** 渲染一组规则：每条一行（数组） */
export function renderRules(rules, lang = 'zh', opts = {}) {
  return rules.map((r) => renderRule(r, lang, opts));
}

// ── 程序 ────────────────────────────────────────────────────

const PROC_MEMO = new WeakMap();

/** 渲染一类程序：`提出者：…；表决者：…（提出时固定）；每票：…；表决期：N 刻；记名 / 不记名；通过：…`，或「这一类不再立法」 */
export function renderProcedureClass(c, lang = 'zh') {
  const key = lang === 'en' ? 'en' : 'zh';
  let memo = PROC_MEMO.get(c);
  if (memo && memo.has(key)) return memo.get(key);
  const d = dict(lang);
  const out = c.none ? d.proc.none : d.proc.fmt(renderExpr(c.proposers, lang), renderExpr(c.voters, lang), renderExpr(c.weight, lang), c.period, c.secret, renderExpr(c.decide, lang));
  if (!memo) PROC_MEMO.set(c, (memo = new Map()));
  memo.set(key, out);
  return out;
}

/** 渲染一部程序：{ ordinary?, constitutional? }（只含它写到的类） */
export function renderProcedure(proc, lang = 'zh') {
  const out = {};
  for (const k of ['ordinary', 'constitutional']) if (proc[k]) out[k] = renderProcedureClass(proc[k], lang);
  return out;
}
