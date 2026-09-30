// SPEC-M1 §7.10 与 PROTOCOL §6：法律——效力的校验与描述、选民范围、计票、效力的执行、津贴。
//
// 一部法律 = 自然语言文本 + 可选的「效力」（受限的指令，由引擎真正执行）。没有效力的法律是「规范」，
// 只生成法律记录，没有机制作用。
//
// 效力执行结果 results[i] = { index, ok, note }：note 是与语言无关的短代码（如 "partial:12/20"、"target_gone"），
// 由观测站在显示时翻译；部分执行也算 ok，并在 note 里说明。

import { P, LAW_SPEC, LIMITS } from '../params.js';
import { hasPlace } from '../map/index.js';
import { L, fmt, placeDisplayName } from '../lore/index.js';
import { clockDay, agentList, isAlive, findAgent, nextId } from '../world.js';
import { nameKey, normalizeText, cpLength, truncateCp } from '../text.js';
import { screen } from '../moderation.js';
import { source } from './ledger.js';
import { ActError, fail, emit, pushInbox, creditEnergy, toPermille, LANG_RE } from './core.js';
import { addToProject } from './environment.js';

const round3 = (x) => Math.round(x * 1000) / 1000;

// ── 效力的校验（提交时整体校验，任何一条不合法即整个提案被拒） ──────

function effErr(i, zh, en) {
  throw new ActError('invalid_args', { zh: `第 ${i + 1} 条效力：${zh}`, en: `Effect ${i + 1}: ${en}` });
}

/** 接收方：在世的 agent（ID 或名字）或未解散的社群 ID → { kind, id } */
function holderRef(w, v, i, field) {
  if (typeof v !== 'string' || v === '') effErr(i, `${field} 缺失`, `${field} is missing`);
  const g = w.groups[v];
  if (g) {
    if (g.dissolved) effErr(i, `社群 ${v} 已解散`, `group ${v} has been dissolved`);
    return { kind: 'group', id: g.id };
  }
  const a = findAgent(w, v);
  if (!a || !isAlive(a)) effErr(i, `找不到在世的居民或社群「${v}」`, `no living resident or group "${v}"`);
  return { kind: 'agent', id: a.id };
}

function amountField(v, i, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (v === undefined || v === null) return min === 0 ? 0 : effErr(i, `${name} 缺失`, `${name} is missing`);
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) {
    effErr(i, `${name} 必须是 ${min}–${max === Number.MAX_SAFE_INTEGER ? '∞' : max} 的整数`, `${name} must be an integer from ${min} to ${max === Number.MAX_SAFE_INTEGER ? 'infinity' : max}`);
  }
  return v;
}

function validateSet(w, e, i) {
  const spec = typeof e.param === 'string' && Object.prototype.hasOwnProperty.call(LAW_SPEC, e.param) ? LAW_SPEC[e.param] : null;
  if (!spec) effErr(i, '未知的法律参数', 'unknown law parameter');
  let v = e.value;
  const bad = () => effErr(i, `${e.param} 的值不合法`, `invalid value for ${e.param}`);
  switch (spec.type) {
    case 'boolean':
      if (typeof v !== 'boolean') bad();
      break;
    case 'integer':
      if (v === null && spec.nullable) break;
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < spec.min || v > spec.max) bad();
      break;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) bad();
      v = round3(v); // 数值型参数保存时四舍五入到 3 位小数
      if (v < spec.min || v > spec.max) bad();
      break;
    case 'electorate': {
      if (v === 'all') break;
      const m = typeof v === 'string' ? /^group:(g\d+)$/.exec(v) : null;
      if (!m || !w.groups[m[1]] || w.groups[m[1]].dissolved) bad();
      break;
    }
    default:
      bad();
  }
  return { type: 'set', param: e.param, value: v };
}

function validateEffect(w, e, i) {
  if (e === null || typeof e !== 'object' || Array.isArray(e)) effErr(i, '必须是一个对象', 'must be an object');
  switch (e.type) {
    case 'set':
      return validateSet(w, e, i);
    case 'grant': {
      const to = holderRef(w, e.to, i, 'to');
      const energy = amountField(e.energy, i, 'energy');
      const coins = amountField(e.coins, i, 'coins');
      if (energy + coins <= 0) effErr(i, 'energy 与 coins 至少要有一项', 'at least one of energy or coins is required');
      return { type: 'grant', to: to.id, energy, coins };
    }
    case 'stipend': {
      const to = holderRef(w, e.to, i, 'to');
      return { type: 'stipend', to: to.id, energy: amountField(e.energy, i, 'energy', { min: 1, max: 100 }) };
    }
    case 'fund': {
      needIdField(e.project, i, 'project');
      const j = w.projects[e.project];
      if (!j || j.status !== 'open') effErr(i, `工程 ${e.project} 不存在或已结束`, `project ${e.project} does not exist or is finished`);
      return { type: 'fund', project: j.id, energy: amountField(e.energy, i, 'energy', { min: 1 }) };
    }
    case 'exile':
    case 'pardon': {
      const t = holderRef(w, e.target, i, 'target');
      if (t.kind !== 'agent') effErr(i, 'target 必须是一位居民', 'target must be a resident');
      return { type: e.type, target: t.id };
    }
    case 'rename': {
      const isCity = e.target === 'city';
      if (!isCity && !hasPlace(w, e.target)) effErr(i, 'target 必须是 "city" 或地点 ID', 'target must be "city" or a place ID');
      const name = normalizeText(e.name);
      if (name === null || name === '' || cpLength(name) > LIMITS.name) effErr(i, `name 必须是 1–${LIMITS.name} 个字符`, `name must be 1–${LIMITS.name} characters`);
      if (!screen(name).ok) fail('moderated');
      if (!isCity && placeNameTaken(w, name, e.target)) effErr(i, '名字与其他地点重复', 'the name duplicates another place');
      return { type: 'rename', target: e.target, name };
    }
    case 'mint': {
      const coins = amountField(e.coins, i, 'coins', { min: 1, max: 10000 });
      if (e.to !== 'treasury' && e.to !== 'citizens') effErr(i, 'to 必须是 "treasury" 或 "citizens"', 'to must be "treasury" or "citizens"');
      return { type: 'mint', coins, to: e.to };
    }
    case 'protect':
    case 'unprotect': {
      needIdField(e.inscription, i, 'inscription');
      const ins = w.inscriptions[e.inscription];
      if (!ins) effErr(i, `铭刻 ${e.inscription} 不存在`, `inscription ${e.inscription} does not exist`);
      return { type: e.type, inscription: ins.id };
    }
    case 'amend':
      return validateAmend(w, e, i);
    case 'repeal': {
      needIdField(e.law, i, 'law');
      const law = w.laws[e.law];
      if (!law || law.status !== 'active') effErr(i, `法律 ${e.law} 不存在或已被撤销`, `law ${e.law} does not exist or is already repealed`);
      return { type: 'repeal', law: law.id };
    }
    default:
      return effErr(i, '未知的效力类型', 'unknown effect type');
  }
}

function needIdField(v, i, name) {
  if (typeof v !== 'string' || v === '' || v.length > 64) effErr(i, `${name} 缺失或不合法`, `${name} is missing or invalid`);
}

function validateAmend(w, e, i) {
  if ('canonical' in e) {
    const c = e.canonical;
    if (c !== null && (typeof c !== 'string' || !LANG_RE.test(c))) effErr(i, 'canonical 必须是语言标签或 null', 'canonical must be a language tag or null');
    return { type: 'amend', canonical: c };
  }
  const max = w.charter.length;
  if (typeof e.article !== 'number' || !Number.isSafeInteger(e.article) || e.article < 1 || e.article > max + 1) {
    effErr(i, `article 必须是 1–${max + 1} 的整数`, `article must be an integer from 1 to ${max + 1}`);
  }
  if (typeof e.lang !== 'string' || !LANG_RE.test(e.lang)) effErr(i, 'lang 必须是语言标签', 'lang must be a language tag');
  const text = normalizeText(e.text);
  if (text === null) effErr(i, 'text 必须是字符串', 'text must be a string');
  if (cpLength(text) > LIMITS.amendText) effErr(i, `text 不得超过 ${LIMITS.amendText} 个字符`, `text must not exceed ${LIMITS.amendText} characters`);
  if (text === '' && e.article === max + 1) effErr(i, '新增的条文不能为空', 'a new article cannot be empty');
  if (text !== '' && !screen(text).ok) fail('moderated');
  return { type: 'amend', article: e.article, lang: e.lang, text };
}

/** 新名字是否与其他地点当前的名字重复（被改名的比自定义名，没改名的比中英文的人类名字） */
function placeNameTaken(w, name, exceptId) {
  const key = nameKey(name);
  for (const p of Object.values(w.places)) {
    if (p.id === exceptId) continue;
    if (p.renamedBy) {
      if (nameKey(p.name) === key) return true;
    } else if (nameKey(p.humanName.zh) === key || nameKey(p.humanName.en) === key) {
      return true;
    }
  }
  return false;
}

/** 校验并规范化提案的效力列表；返回规范化后的数组 */
export function validateEffects(w, list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > LIMITS.proposalEffects) {
    fail('invalid_args', { zh: `effects 必须是最多 ${LIMITS.proposalEffects} 条的数组。`, en: `effects must be an array of at most ${LIMITS.proposalEffects}.` });
  }
  return list.map((e, i) => validateEffect(w, e, i));
}

/** 凡是改变「游戏规则本身」的提案都需要达到修宪门槛：修宪级参数的 set、electorate 的 set、amend */
export function isGovernance(effects) {
  return effects.some((e) => e.type === 'amend' || (e.type === 'set' && LAW_SPEC[e.param].amend));
}

// ── 效力的人类可读描述（感知里的 effects[].text） ───────────────

const PERCENT_PARAMS = new Set(['rationShare', 'transferTax', 'wealthTax', 'quorum', 'passThreshold', 'amendThreshold']);

function agentName(w, id) {
  return w.agents[id] ? w.agents[id].name : id;
}

function holderName(w, id) {
  if (w.groups[id]) return `「${w.groups[id].name}」`;
  return agentName(w, id);
}

function amountText(l, energy, coins) {
  const parts = [];
  if (energy > 0) parts.push(fmt(l.amountEnergy, { n: energy }));
  if (coins > 0) parts.push(fmt(l.amountCoins, { n: coins }));
  return parts.join(` ${l.and} `);
}

function valueText(w, l, param, v) {
  const spec = LAW_SPEC[param];
  if (spec.type === 'boolean') return v ? l.yes : l.no;
  if (v === null) return l.unlimited;
  if (param === 'electorate') return v === 'all' ? l.everyone : fmt(l.groupMembers, { name: w.groups[v.slice(6)] ? w.groups[v.slice(6)].name : v.slice(6) });
  if (PERCENT_PARAMS.has(param)) return `${Math.round(v * 1000) / 10}%`;
  return String(v);
}

export function describeEffect(w, e, lang) {
  const l = L(lang).law;
  const langName = (code) => l.langNames[code] || code;
  switch (e.type) {
    case 'set':
      return fmt(l.set, { param: l.params[e.param], value: valueText(w, l, e.param, e.value) });
    case 'grant':
      return fmt(l.grant, { amount: amountText(l, e.energy, e.coins), to: holderName(w, e.to) });
    case 'stipend':
      return fmt(l.stipend, { to: holderName(w, e.to), energy: e.energy });
    case 'fund':
      return fmt(l.fund, { project: w.projects[e.project] ? w.projects[e.project].name : e.project, energy: e.energy });
    case 'exile':
      return fmt(l.exile, { target: agentName(w, e.target) });
    case 'pardon':
      return fmt(l.pardon, { target: agentName(w, e.target) });
    case 'rename':
      return e.target === 'city'
        ? fmt(l.renameCity, { name: e.name })
        : fmt(l.renamePlace, { target: placeDisplayName(w.places[e.target], lang), name: e.name });
    case 'mint':
      return fmt(e.to === 'treasury' ? l.mintTreasury : l.mintCitizens, { coins: e.coins });
    case 'protect': {
      const ins = w.inscriptions[e.inscription];
      return fmt(l.protect, { id: e.inscription, text: ins ? truncateCp(ins.text, 20) : '' });
    }
    case 'unprotect':
      return fmt(l.unprotect, { id: e.inscription });
    case 'amend':
      if ('canonical' in e) return e.canonical === null ? l.canonicalNone : fmt(l.canonical, { lang: langName(e.canonical) });
      if (e.text === '') return fmt(l.amendRepeal, { n: e.article });
      return fmt(e.article > (w.charter.length) ? l.amendNew : l.amendArticle, { n: e.article, lang: langName(e.lang), text: e.text });
    case 'repeal':
      return fmt(l.repeal, { id: e.law, title: w.laws[e.law] ? w.laws[e.law].title : '' });
    default:
      return e.type;
  }
}

// ── 选民范围（§7.10） ───────────────────────────────────────

/** 是否已入籍：citizenFromDay ≤ 今日 */
export const isCitizen = (w, a) => a.citizenFromDay <= clockDay(w);

/** 选民 = 醒着或沉睡的公民中，未被放逐者；若 electorate 为 group:g，再限定为 g 的成员 */
export function electorateOf(w) {
  const e = w.params.electorate;
  let group = null;
  if (e !== 'all') {
    group = w.groups[e.slice(6)];
    if (!group || group.dissolved) return [];
  }
  const out = [];
  for (const a of agentList(w)) {
    if (!isAlive(a) || a.exiled || !isCitizen(w, a)) continue;
    if (group && !group.members.includes(a.id)) continue;
    out.push(a);
  }
  return out;
}

export function inElectorate(w, a) {
  return electorateOf(w).some((x) => x.id === a.id);
}

/**
 * 选民范围的兜底：若 electorate 为 group:g，而 g 已解散或没有符合条件的成员，则自动恢复为 "all"，
 * 记事件 electorate_reverted。（防止全城永久失去立法能力。每刻计票前检查，提案与投票前也检查。）
 */
export function ensureElectorate(w) {
  if (w.params.electorate === 'all') return;
  if (electorateOf(w).length > 0) return;
  const from = w.params.electorate;
  w.params.electorate = 'all';
  emit(w, 'electorate_reverted', { data: { from } });
}

// ── 提案 ───────────────────────────────────────────────────

/** 创建一个进行中的提案（提案者已通过各项校验并付过代价） */
export function openProposal(w, proposer, { title, text, effects }) {
  const id = nextId(w, 'p');
  const ticks = Math.max(1, Math.round(w.params.proposalDays * P.ticksPerDay));
  const p = {
    id, title, text, effects, governance: isGovernance(effects),
    proposer: proposer.id, openedTick: w.clock.tick, closesTick: w.clock.tick + ticks,
    votes: {}, status: 'open', tally: null, lawId: null,
  };
  w.proposals[id] = p;
  w.dayLog.proposals++;
  return p;
}

export const openProposals = (w) => Object.values(w.proposals).filter((p) => p.status === 'open');

// ── 计票（每刻结算第 4 步） ─────────────────────────────────────

/** 按提案 ID 升序处理 closesTick ≤ 当前刻的提案 */
export function tallyProposals(w) {
  ensureElectorate(w);
  const due = Object.values(w.proposals).filter((p) => p.status === 'open' && p.closesTick <= w.clock.tick);
  for (const p of due) {
    ensureElectorate(w); // 前一部法律可能改了选民范围
    settleProposal(w, p);
  }
}

function settleProposal(w, p) {
  const elect = electorateOf(w);
  const ids = new Set(elect.map((a) => a.id));
  let yes = 0;
  let no = 0;
  let abstain = 0;
  for (const [id, v] of Object.entries(p.votes)) {
    if (!ids.has(id)) continue; // 有效票 = 选民中投过票者的最后一票
    if (v.choice === 'yes') yes++;
    else if (v.choice === 'no') no++;
    else abstain++;
  }
  const n = elect.length;
  const voted = yes + no + abstain;
  const decisive = yes + no;
  // 门槛比较用千分比整数，避免浮点误差（恰好等于时结果必须确定）
  const quorumOk = n > 0 && voted * 1000 >= toPermille(w.params.quorum) * n;
  const approvalOk = p.governance
    ? yes * 1000 >= toPermille(w.params.amendThreshold) * decisive
    : yes * 1000 > toPermille(w.params.passThreshold) * decisive;
  const passed = n > 0 && decisive > 0 && quorumOk && approvalOk;
  p.tally = {
    electorate: n, yes, no, abstain,
    participation: n > 0 ? round3(voted / n) : 0,
    approval: decisive > 0 ? round3(yes / decisive) : 0,
  };
  if (passed) enact(w, p);
  else reject(w, p);
}

function notifyProposalResult(w, p, result) {
  const who = new Set([p.proposer, ...Object.keys(p.votes)]);
  for (const id of who) {
    const a = w.agents[id];
    if (a && isAlive(a)) pushInbox(w, a, 'law', { proposalId: p.id, lawId: p.lawId, result, title: p.title });
  }
}

function reject(w, p) {
  p.status = 'rejected';
  w.dayLog.rejected++;
  w.dayLog.laws.push({ proposalId: p.id, title: p.title, passed: false, yes: p.tally.yes, no: p.tally.no, lawId: null });
  emit(w, 'law_rejected', { data: { proposalId: p.id, tally: p.tally } });
  notifyProposalResult(w, p, 'rejected');
}

/** 通过：生成法律，按顺序执行各条效力，记录每条的结果 */
function enact(w, p) {
  p.status = 'passed';
  const lawId = nextId(w, 'l');
  p.lawId = lawId;
  const law = {
    id: lawId, proposalId: p.id, title: p.title, text: p.text, effects: p.effects.map((e) => ({ ...e })),
    results: [], enactedTick: w.clock.tick, status: 'active', repealedBy: null,
  };
  w.laws[lawId] = law;
  w.dayLog.passed++;
  w.dayLog.laws.push({ proposalId: p.id, title: p.title, passed: true, yes: p.tally.yes, no: p.tally.no, lawId });
  law.effects.forEach((e, index) => {
    const r = execute(w, lawId, e);
    law.results.push({ index, ok: r.ok, note: r.note || '' });
  });
  emit(w, 'law_passed', { data: { proposalId: p.id, lawId, tally: p.tally, results: law.results } });
  notifyProposalResult(w, p, 'passed');
}

// ── 效力的执行 ──────────────────────────────────────────────

const GONE = { ok: false, note: 'target_gone' };
const OK = { ok: true, note: '' };

function livingAgent(w, id) {
  const a = w.agents[id];
  return a && isAlive(a) ? a : null;
}

/** 接收方：在世的 agent 或未解散的社群；否则 null */
function recipientOf(w, id) {
  const g = w.groups[id];
  if (g) return g.dissolved ? null : { group: g };
  const a = livingAgent(w, id);
  return a ? { agent: a } : null;
}

function execute(w, lawId, e) {
  switch (e.type) {
    case 'set':
      return exSet(w, e);
    case 'grant':
      return exGrant(w, lawId, e);
    case 'stipend':
      return recipientOf(w, e.to) ? OK : GONE; // 每日由 payStipends 支付
    case 'fund':
      return exFund(w, lawId, e);
    case 'exile':
      return exExile(w, lawId, e);
    case 'pardon':
      return exPardon(w, lawId, e);
    case 'rename':
      return exRename(w, lawId, e);
    case 'mint':
      return exMint(w, lawId, e);
    case 'protect':
      return exProtect(w, lawId, e);
    case 'unprotect':
      return exUnprotect(w, lawId, e);
    case 'amend':
      return exAmend(w, lawId, e);
    case 'repeal':
      return exRepeal(w, lawId, e);
    default:
      return { ok: false, note: 'unknown_effect' };
  }
}

/** set：立即修改参数。一次性——撤销该法律不会恢复原值 */
function exSet(w, e) {
  if (e.param === 'electorate' && e.value !== 'all') {
    const g = w.groups[e.value.slice(6)];
    if (!g || g.dissolved) return GONE;
  }
  w.params[e.param] = e.value;
  return OK;
}

/** grant：从公库拨付，数额取「请求」与「公库余额」的较小者；给沉睡者时可能将其唤醒 */
function exGrant(w, lawId, e) {
  const to = recipientOf(w, e.to);
  if (!to) return GONE;
  const energy = Math.min(e.energy, w.treasury.energy);
  const coins = Math.min(e.coins, w.treasury.coins);
  w.treasury.energy -= energy;
  w.treasury.coins -= coins;
  if (to.group) {
    to.group.treasury.energy += energy;
    to.group.treasury.coins += coins;
  } else {
    to.agent.coins += coins;
    pushInbox(w, to.agent, 'grant', { lawId, energy, coins });
    creditEnergy(w, to.agent, energy, { lawId });
  }
  emit(w, 'grant', { data: { lawId, to: e.to, energy, coins } });
  return energy === e.energy && coins === e.coins ? OK : { ok: true, note: `partial:${energy + coins}/${e.energy + e.coins}` };
}

/** fund：公库为工程出资，数额取「请求数额、还差多少、公库余额」三者的最小值 */
function exFund(w, lawId, e) {
  const j = w.projects[e.project];
  if (!j || j.status !== 'open') return GONE;
  const amount = Math.min(e.energy, j.need - j.have, w.treasury.energy);
  if (amount > 0) {
    w.treasury.energy -= amount;
    addToProject(w, j, 'treasury', amount);
  }
  emit(w, 'fund', { place: j.place, data: { lawId, projectId: j.id, energy: amount } });
  return amount === e.energy ? OK : { ok: true, note: `partial:${amount}/${e.energy}` };
}

/** exile：立即移到荒野，失去配给与选举权，只能「移动」到荒野 */
function exExile(w, lawId, e) {
  const a = livingAgent(w, e.target);
  if (!a) return GONE;
  if (a.exiled) return { ok: true, note: 'already' };
  a.exiled = true;
  a.place = 'wilds';
  w.places.wilds.activity.visits++;
  pushInbox(w, a, 'exile', { lawId });
  emit(w, 'exile', { agent: a.id, place: 'wilds', data: { lawId, agentId: a.id } });
  return OK;
}

function exPardon(w, lawId, e) {
  const a = livingAgent(w, e.target);
  if (!a) return GONE;
  if (!a.exiled) return { ok: true, note: 'not_exiled' };
  a.exiled = false;
  pushInbox(w, a, 'pardon', { lawId });
  emit(w, 'pardon', { agent: a.id, place: a.place, data: { lawId, agentId: a.id } });
  return OK;
}

function exRename(w, lawId, e) {
  if (e.target === 'city') {
    w.cityName = e.name;
  } else {
    if (placeNameTaken(w, e.name, e.target)) return { ok: false, note: 'name_taken' };
    const p = w.places[e.target];
    p.name = e.name;
    p.renamedBy = lawId;
  }
  emit(w, 'rename', { place: e.target === 'city' ? undefined : e.target, data: { lawId, target: e.target, name: e.name } });
  return OK;
}

/** mint：创造旧币。to = treasury 全部进公库；to = citizens 按公民人数均分，余数进公库 */
function exMint(w, lawId, e) {
  source(w, 'coins', 'mint', e.coins);
  w.dayLog.mints++;
  let toEach = 0;
  let recipients = 0;
  if (e.to === 'treasury') {
    w.treasury.coins += e.coins;
  } else {
    // TODO(spec): Q4 —— 「公民」= 在世（醒着或沉睡）且已入籍者，被放逐者仍算公民
    const citizens = agentList(w).filter((a) => isAlive(a) && isCitizen(w, a));
    recipients = citizens.length;
    if (recipients === 0) {
      w.treasury.coins += e.coins;
    } else {
      toEach = Math.floor(e.coins / recipients);
      for (const a of citizens) a.coins += toEach;
      w.treasury.coins += e.coins - toEach * recipients;
    }
  }
  emit(w, 'mint', { data: { lawId, coins: e.coins, to: e.to, each: toEach, recipients } });
  return OK;
}

function exProtect(w, lawId, e) {
  const ins = w.inscriptions[e.inscription];
  if (!ins || ins.coveredBy || ins.redacted) return { ok: false, note: 'not_visible' };
  if (!ins.protectedBy.includes(lawId)) ins.protectedBy.push(lawId);
  emit(w, 'protect', { place: ins.place, data: { lawId, inscriptionId: ins.id } });
  return OK;
}

/**
 * unprotect：解除铭刻的保护。
 * TODO(spec): Q5 —— 规格写的是「增减 protectedBy 中的法律 ID」「解除本法律施加的保护」，
 * 而本法律不可能已经保护过它，字面上是空操作。暂行：清空该铭刻的全部保护。
 */
function exUnprotect(w, lawId, e) {
  const ins = w.inscriptions[e.inscription];
  if (!ins) return GONE;
  if (ins.protectedBy.length === 0) return { ok: true, note: 'not_protected' };
  const removed = ins.protectedBy.slice();
  ins.protectedBy = [];
  emit(w, 'unprotect', { place: ins.place, data: { lawId, inscriptionId: ins.id, removed } });
  return OK;
}

/** amend：条文形式（设置某条某语言的文本、空串废除该条、条号 = 最大条号 + 1 时新增）或正本形式 */
function exAmend(w, lawId, e) {
  if ('canonical' in e) {
    if (e.canonical !== null && !w.charter.some((a) => e.canonical in a.versions)) return { ok: false, note: 'no_such_version' };
    w.charterCanonical = e.canonical;
    emit(w, 'amend', { place: 'parliament', data: { lawId, canonical: e.canonical } });
    return OK;
  }
  const max = w.charter.length;
  if (e.article === max + 1) {
    if (e.text === '') return { ok: false, note: 'empty_new_article' };
    w.charter.push({ n: e.article, versions: { [e.lang]: e.text }, status: 'amended', history: [{ lawId, lang: e.lang, text: e.text }] });
  } else if (e.article > max + 1) {
    return { ok: false, note: 'no_such_article' };
  } else {
    const art = w.charter[e.article - 1];
    if (e.text === '') {
      art.status = 'repealed';
      art.history.push({ lawId, lang: '*', text: '' });
    } else {
      art.versions[e.lang] = e.text;
      art.status = 'amended';
      art.history.push({ lawId, lang: e.lang, text: e.text });
    }
  }
  emit(w, 'amend', { place: 'parliament', data: { lawId, article: e.article, lang: e.lang, text: e.text } });
  return OK;
}

/** repeal：目标法律状态改为 repealed，停止它的津贴，移除它施加的铭刻保护 */
function exRepeal(w, lawId, e) {
  const target = w.laws[e.law];
  if (!target || target.status !== 'active' || target.id === lawId) return { ok: false, note: 'not_active' };
  target.status = 'repealed';
  target.repealedBy = lawId;
  for (const ins of Object.values(w.inscriptions)) {
    if (ins.protectedBy.includes(target.id)) ins.protectedBy = ins.protectedBy.filter((x) => x !== target.id);
  }
  emit(w, 'repeal', { data: { lawId, target: target.id } });
  return OK;
}

// ── 津贴（每日结算第 3 步） ────────────────────────────────────

/**
 * 按法律 ID 升序，逐条支付仍有效的 stipend。公库不足以支付某一条时，该条当日不付
 * （记一条 stipend_skipped 事件），继续下一条。收款人已死亡、归隐或社群已解散时跳过。
 */
export function payStipends(w) {
  for (const law of Object.values(w.laws)) {
    if (law.status !== 'active') continue;
    for (const e of law.effects) {
      if (e.type !== 'stipend') continue;
      const to = recipientOf(w, e.to);
      if (!to) continue;
      if (w.treasury.energy < e.energy) {
        emit(w, 'stipend_skipped', { data: { lawId: law.id, to: e.to } });
        continue;
      }
      w.treasury.energy -= e.energy;
      if (to.group) {
        to.group.treasury.energy += e.energy;
      } else {
        pushInbox(w, to.agent, 'stipend', { lawId: law.id, energy: e.energy });
        creditEnergy(w, to.agent, e.energy, { lawId: law.id });
      }
      emit(w, 'stipend', { data: { lawId: law.id, to: e.to, energy: e.energy } });
    }
  }
}

