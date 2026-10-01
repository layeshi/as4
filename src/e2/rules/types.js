// SPEC-E2 §7.3、PROTOCOL-2 §6.5–§6.6：规则语言的类型、字段表、函数表与各时机可用的名字。
//
// 类型（字符串）：int bool str null agent group soul account list<agent> list<soul> any，
// 以及几个「记录」：city（城的数字）、var（法律设定的变量）、args（动作的参数）、result（动作的结果）、event（事件）。
// var / args / result / event 的字段都是 any：静态检查放行，运行时检查。

export const T = Object.freeze({
  INT: 'int', BOOL: 'bool', STR: 'str', NULL: 'null', AGENT: 'agent', GROUP: 'group', SOUL: 'soul', ACCOUNT: 'account',
  AGENTS: 'list<agent>', SOULS: 'list<soul>', ANY: 'any',
  CITY: 'city', VAR: 'var', ARGS: 'args', RESULT: 'result', EVENT: 'event',
});

/** 居民、社群、灵魂、城的字段与类型（PROTOCOL-2 §6.5） */
export const FIELDS = Object.freeze({
  city: Object.freeze({
    day: 'int', dayOfMonth: 'int', month: 'int', season: 'int', treasury: 'int', treasuryCoins: 'int',
    wellOutput: 'int', wellCondition: 'int', awake: 'int', dormant: 'int', residents: 'int', shellsFree: 'int', shellsTotal: 'int',
  }),
  agent: Object.freeze({
    id: 'str', name: 'str', lang: 'str', energy: 'int', coins: 'int', age: 'int', generation: 'int', place: 'str', status: 'str',
    drawnToday: 'int', repairedToday: 'int', salvagedToday: 'int', repaired: 'int', contributed: 'int', salvaged: 'int', purpose: 'str',
  }),
  group: Object.freeze({ id: 'str', name: 'str', treasury: 'int', treasuryCoins: 'int', steward: 'agent', size: 'int' }),
  soul: Object.freeze({ id: 'str', name: 'str', fund: 'int', expiresDay: 'int', generation: 'int' }),
});

/** 类型的中英文名（报错用） */
export const TYPE_NAMES = Object.freeze({
  int: { zh: '整数', en: 'an integer' },
  bool: { zh: '真假', en: 'a boolean' },
  str: { zh: '字符串', en: 'a string' },
  null: { zh: 'null', en: 'null' },
  agent: { zh: '居民', en: 'a resident' },
  group: { zh: '社群', en: 'a group' },
  soul: { zh: '灵魂', en: 'a soul' },
  account: { zh: '账户', en: 'an account' },
  'list<agent>': { zh: '居民的列表', en: 'a list of residents' },
  'list<soul>': { zh: '灵魂的列表', en: 'a list of souls' },
  any: { zh: '任意值', en: 'any value' },
  city: { zh: '城的数字', en: 'the city record' },
  var: { zh: '变量', en: 'the variables' },
  args: { zh: '动作的参数', en: 'the action arguments' },
  result: { zh: '动作的结果', en: 'the action result' },
  event: { zh: '事件', en: 'the event' },
  scalar: { zh: '整数、真假、字符串或 null', en: 'an integer, boolean, string or null' },
});

/** 全部函数名（PROTOCOL-2 §6.6）及其签名的简写，报错与「未知函数」的建议用 */
export const FUNCTION_SIGS = Object.freeze({
  min: 'min(a, b, …)', max: 'max(a, b, …)', abs: 'abs(a)', if: 'if(cond, a, b)', default: 'default(x, fallback)',
  count: 'count(list)', sum: 'sum(list, expr)', filter: 'filter(list, cond)', top: 'top(list, expr, n)', sample: 'sample(list, n)',
  contains: 'contains(list, resident)', tagged: "tagged('tag')", members: "members('g1')", at: "at('place')",
  has_tag: "has_tag(resident, 'tag')", in_group: "in_group(resident, 'g1')", awake: 'awake(resident)',
  is_wild: "is_wild('place')", owner: "owner('place')", agent: "agent('id or name')", group: "group('g1')", soul: "soul('s4')",
  names: 'names(list, separator?)', weather: "weather('code')",
});
export const FUNCTION_NAMES = Object.freeze(Object.keys(FUNCTION_SIGS));

/** 一个类型是不是列表，元素类型是什么 */
export function elementType(t) {
  if (t === T.AGENTS) return T.AGENT;
  if (t === T.SOULS) return T.SOUL;
  if (t === T.ANY) return T.ANY;
  return null;
}

export const isListType = (t) => t === T.AGENTS || t === T.SOULS || t === T.ANY;

/**
 * 期望类型 want 能否接受 got：any 两边通吃；账户接受 agent / group / soul / account；
 * 'scalar'（set 的值）接受 int / bool / str / null。
 */
export function accepts(want, got) {
  if (want === T.ANY || got === T.ANY) return true;
  if (want === got) return true;
  if (want === T.ACCOUNT) return got === T.AGENT || got === T.GROUP || got === T.SOUL;
  if (want === 'scalar') return got === T.INT || got === T.BOOL || got === T.STR || got === T.NULL;
  return false;
}

/**
 * 各时机能用的名字及其类型（PROTOCOL-2 §6.3、§6.5）。
 *   kind：'enact' | 'daily' | 'monthly' | 'before' | 'after' | 'on' | 'proposers' | 'voters' | 'weight' | 'decide'
 * it 的类型由 filter / sum / top / each 在局部加上。
 */
export function namesFor(kind) {
  const base = { city: T.CITY, var: T.VAR, treasury: T.ACCOUNT, agents: T.AGENTS, cradle: T.SOULS };
  switch (kind) {
    case 'before': return { ...base, actor: T.AGENT, args: T.ARGS, here: T.AGENTS };
    case 'after': return { ...base, actor: T.AGENT, args: T.ARGS, result: T.RESULT, here: T.AGENTS };
    case 'on': return { ...base, event: T.EVENT };
    case 'proposers': return { ...base, actor: T.AGENT };
    case 'decide': return { ...base, yes: T.INT, no: T.INT, abstain: T.INT, voted: T.INT, total: T.INT, turnout: T.INT };
    default: return base; // enact daily monthly voters weight
  }
}

/** 全部可能出现的名字（用来区分「这里不可用」与「根本不存在」） */
export const ALL_NAMES = Object.freeze([
  'city', 'var', 'treasury', 'agents', 'cradle', 'actor', 'args', 'result', 'here', 'event', 'it',
  'yes', 'no', 'abstain', 'voted', 'total', 'turnout',
]);
