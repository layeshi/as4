// SPEC-E2 §20：每日指标（20.1）与人类遗产存活表（20.2），以及史官（附录 A.8）的接线。
//
// 每日结算的第 15–16 步（STEPS.metrics）：算出今日指标、更新遗产存活表、写史官，然后才清空 dayLog。
// 全部是对世界状态的只读计算（遗产表和史官的结果存进 w.legacy / w.chronicle，那是世界状态的一部分，重放时可重算）。

import { conditionBand } from '../params.js';
import { L, fmt, cityDisplayName } from '../lore/index.js';
import { agentList, isAlive, premised, agentic } from '../world.js';
import { HUMAN_DEFS, MAP, WILD_ZONE_IDS } from '../map/index.js';
import { parseCached, countNodes } from '../rules/parser.js';
import { OP_FIELDS } from '../rules/check.js';
import { gini, round, shannon } from '../metrics.js';
import { procSpec, isProcedureLaw, isPersistent } from './laws.js';
import { votersOf, rngCopy } from './legislation.js';
import { upkeepOf, weightOf } from './lifecycle.js';
import { bodyList, isShell } from './bodies.js';
import { livingShells } from './shells.js';
import { STEPS } from './tick.js';
import { writeChronicle } from '../chronicle.js';

// ═══════════════════════════════════════════════════════════════
// 每日指标（SPEC-E2 §20.1）
// ═══════════════════════════════════════════════════════════════

const EXPR_KINDS = new Set(['acct', 'agent', 'agents', 'int', 'bool', 'scalar']);

/** 一条规则里全部表达式的语法节点总数（条件、操作的表达式字段、each 里的） */
export function countRuleNodes(rule) {
  const exprNodes = (src) => {
    try {
      return countNodes(parseCached(src));
    } catch {
      return 0;
    }
  };
  const opNodes = (op) => {
    let n = 0;
    for (const [field, kind] of OP_FIELDS[op.op] || []) {
      if (op[field] === undefined) continue;
      if (kind === 'ops') n += op[field].reduce((x, o) => x + opNodes(o), 0);
      else if (EXPR_KINDS.has(kind)) n += exprNodes(op[field]);
    }
    return n;
  };
  return (rule.if !== undefined ? exprNodes(rule.if) : 0) + rule.do.reduce((x, o) => x + opNodes(o), 0);
}

/** 所有在效的规则持有物：[{ rules, scopeKey }]（城法按法律，章程按社群，地点规则按地点；程序法律没有规则） */
function activeHolders(w) {
  const out = [];
  for (const l of Object.values(w.laws)) if (l.status === 'active' && !isProcedureLaw(l)) out.push({ rules: l.rules, kind: 'city', key: l.id, fingerprints: l.fingerprints });
  for (const g of Object.values(w.groups)) if (!g.dissolved && g.bylaws) out.push({ rules: g.bylaws.rules, kind: 'group', key: g.id, fingerprints: g.bylaws.fingerprints });
  for (const p of Object.values(w.places)) if (p.rules && p.owner.kind !== 'city') out.push({ rules: p.rules.rules, kind: 'place', key: p.id, fingerprints: p.rules.fingerprints });
  return out;
}

/** 第 d 日（刚结束的那一日）的指标快照。依赖 dayLog，须在清空 dayLog 之前调用 */
export function dailyMetrics(w, d) {
  const g = w.dayLog;
  const all = agentList(w);
  const alive = all.filter(isAlive);
  const pop = { awake: 0, dormant: 0, dead: 0, retired: 0 };
  for (const a of all) pop[a.status]++;
  const buildings = Object.values(w.places).filter((p) => p.condition !== null);
  const modules = buildings.reduce((n, p) => n + p.modules.length, 0);
  const funcModules = buildings.flatMap((p) => p.modules.filter((m) => p.condition >= (m.type === 'surface' ? 1 : 3000)).map(() => p.condition));
  const invest = g.repairSpent + g.contributeSpent;
  const spent = g.actionCost + invest;
  const adults = alive.filter((a) => d - a.bornDay >= 5);
  const groups = Object.values(w.groups).filter((x) => !x.dissolved);
  const lex = Object.values(w.lexicon);
  const largest = groups.reduce((m, x) => Math.max(m, x.members.length), 0);
  const holders = activeHolders(w);
  const persistentRules = holders.flatMap((h) => h.rules.filter(isPersistent));
  const fpScopes = new Map();
  for (const h of holders) for (const fp of new Set(h.fingerprints)) fpScopes.set(fp, (fpScopes.get(fp) || 0) + 1);
  const agentPlaces = Object.values(w.places).filter((p) => p.origin === 'agent' && !p.razed).length;
  const agentModules = buildings.reduce((n, p) => n + p.modules.filter((m) => !m.inherent).length, 0);
  const salvageLeft = Object.values(w.places).reduce((n, p) => n + p.salvage + p.modules.reduce((x, m) => x + m.salvage, 0), 0);
  const ord = procSpec(w, 'ordinary');
  const voters = ord && !ord.none ? votersOf(w, ord, rngCopy(w)) : null;
  const tags = new Set();
  for (const a of alive) for (const t of a.tags) tags.add(t);
  const births = g.births;
  return {
    day: d,
    awake: pop.awake,
    dormant: pop.dormant,
    dead: pop.dead,
    retired: pop.retired,
    exiled: alive.filter((a) => a.tags.includes('exiled')).length,
    nonCitizens: alive.filter((a) => !a.tags.includes('citizen')).length,
    cradle: Object.keys(w.souls).length,
    unborn: w.unborn.length,
    arrivals: g.arrivals.length,
    births: births.length,
    deaths: g.deaths.length,
    fades: g.fades.length,
    output: g.output,
    rationPerCapita: g.ration,
    treasuryEnergy: w.treasury.energy,
    treasuryCoins: w.treasury.coins,
    agentEnergyTotal: alive.reduce((s, a) => s + a.energy, 0),
    gini: gini(alive.map((a) => a.energy)),
    coinVolume: g.coinVolume,
    coinPrice: g.coinTrade.coins > 0 ? round(g.coinTrade.energy / g.coinTrade.coins) : null,
    wellCondition: w.places.well.condition,
    meanCondition: buildings.length ? round(buildings.reduce((s, p) => s + p.condition, 0) / buildings.length, 1) : 0,
    ruins: buildings.filter((p) => p.condition === 0).length + Object.values(w.roads).filter((r) => r.condition === 0).length,
    modules,
    infrastructureIndex: round(funcModules.reduce((s, c) => s + c / 10000, 0), 2),
    publicInvestment: invest,
    publicInvestmentRate: spent > 0 ? round(invest / spent) : 0,
    freeRiderShare: adults.length ? round(adults.filter((a) => a.stats.repaired + a.stats.contributed === 0).length / adults.length) : 0,
    drawn: g.drawn,
    projectsBuilt: Object.values(w.projects).filter((j) => j.status === 'built').length,
    projectsAbandoned: Object.values(w.projects).filter((j) => j.status === 'abandoned').length,
    wildsEnergy: WILD_ZONE_IDS.reduce((s, id) => s + w.regions[id].energy, 0),
    proposals: g.proposals,
    passed: g.passed,
    rejected: g.rejected,
    lawsActive: Object.values(w.laws).filter((x) => x.status === 'active').length,
    votersOrdinary: voters ? voters.length : 0,
    groups: groups.length,
    largestGroupShare: alive.length ? round(largest / alive.length) : 0,
    lexicon: lex.length,
    adoptedWords: lex.filter((e) => e.users.length >= 3).length,
    docsAgent: Object.values(w.docs).filter((x) => x.kind === 'agent').length,
    reads: g.reads,
    canonReads: g.canonReads,
    utterances: g.utterances.length,
    scripts: { ...g.scripts },
    scriptEntropy: shannon(Object.values(g.scripts)),
    humanAuthoredShare: alive.length ? round(alive.filter((a) => a.generation === 0).length / alive.length) : 0,
    inscriptions: g.inscriptions,
    covered: g.covered,
    epitaphs: g.epitaphs,
    reveals: g.reveals,
    // ── 第二纪新增 ──
    rulesActive: persistentRules.length,
    ruleNodes: persistentRules.reduce((n, r) => n + countRuleNodes(r), 0),
    upkeepPaid: g.upkeepPaid,
    lawsSuspended: g.suspended.length,
    ruleErrors: g.ruleErrors,
    ruleOps: g.ruleOps,
    bylawsActive: groups.filter((x) => x.bylaws).length,
    placeRulesActive: Object.values(w.places).filter((p) => p.rules && p.owner.kind !== 'city').length,
    procedureChanges: Object.values(w.laws).filter((l) => isProcedureLaw(l) && l.author !== 'humans').length,
    refounds: Object.values(w.refounds).filter((r) => r.status === 'succeeded').length,
    reverts: Object.values(w.laws).filter((l) => l.author === 'revert').length,
    fingerprintsShared: [...fpScopes.values()].filter((n) => n >= 2).length,
    agentPlaces,
    agentModules,
    agentBuiltShare: buildings.length + modules > 0 ? round((agentPlaces + agentModules) / (buildings.length + modules)) : 0,
    salvaged: g.salvaged,
    salvageLeft,
    razed: w.counters.razed || 0,
    birthsSolo: births.filter((b) => b.authors.length === 1).length,
    birthsPair: births.filter((b) => b.authors.length === 2).length,
    birthsGroup: births.filter((b) => b.authors.length >= 3).length,
    inheritedMemories: births.reduce((n, b) => n + (b.memories || 0), 0),
    shellsUsed: livingShells(w),
    shellQueue: Object.values(w.souls).filter((s) => s.fundedTick !== null).length,
    embodiments: g.embodiments.length,
    adoptions: g.adoptions.length,
    purposeShare: alive.length ? round(alive.filter((a) => a.purpose).length / alive.length) : 0,
    purposeChanges: g.purposeChanges,
    tagsDistinct: tags.size,
    ...(premised(w) ? premiseMetrics(w) : {}),
    ...(agentic(w) ? agenticMetrics(w) : {}),
  };
}

// ═══════════════════════════════════════════════════════════════
// 人类遗产存活表（SPEC-E2 §20.2）
// ═══════════════════════════════════════════════════════════════

const LANGS = ['zh', 'en'];

/** 一项遗产：状态码、可选的数值，以及一句证据（结构化 + 中英文文本） */
function entry(key, nameCode, nameParams, status, evidenceCode, params, value = null) {
  const text = {};
  const name = {};
  const statusText = {};
  for (const lang of LANGS) {
    const l = L(lang).legacy;
    name[lang] = fmt(l.name[nameCode], typeof nameParams === 'function' ? nameParams(lang) : nameParams);
    statusText[lang] = l.status[status];
    const p = typeof params === 'function' ? params(lang) : params;
    text[lang] = fmt(l.evidence[evidenceCode], p);
  }
  return { key, status, value, name, statusText, evidence: { code: evidenceCode, params: typeof params === 'function' ? params('zh') : params }, text };
}

/** 计算第 d 日的人类遗产存活表。须在今日指标已追加进 w.metrics 之后调用 */
export function computeLegacy(w, d) {
  const items = [];
  const metrics = w.metrics;
  const recent = (n) => metrics.slice(-n);

  // 宪章第 1–9 条（以及之后新增的条文）
  for (const art of w.charter) {
    const last = art.history.length ? art.history[art.history.length - 1].lawId : null;
    const code = art.status === 'legacy' ? 'charterLegacy' : art.status === 'amended' ? 'charterAmended' : 'charterRepealed';
    items.push(entry(`charter.${art.n}`, 'charterArticle', { n: art.n }, art.status, code, { law: last }));
  }
  // 宪章的刻文：议会墙上仍可见的原始语言版本数（0–8）；议会成为遗址时为 0
  const wall = Object.values(w.inscriptions).filter((i) => i.author === 'humans' && i.place === 'parliament' && !i.coveredBy && !i.redacted && !i.lost).length;
  items.push(entry('charterWall', 'charterWall', {}, wall === 8 ? 'legacy' : wall === 0 ? 'abandoned' : 'transformed', 'charterWall', { n: wall }, wall));
  // 遗法 l2–l6：在效为 legacy；被撤销且有 basedOn 指向它的在效法律为 transformed；被撤销且无替代为 abandoned
  for (const id of ['l2', 'l3', 'l4', 'l5', 'l6']) {
    const l = w.laws[id];
    const heir = Object.values(w.laws).find((x) => x.basedOn === id && x.status === 'active');
    const nameParams = (lang) => ({ id, title: l.i18n ? l.i18n[lang].title : l.title });
    if (l.status === 'active') items.push(entry(`law.${id}`, 'law', nameParams, 'legacy', 'lawActive', {}));
    else if (heir) items.push(entry(`law.${id}`, 'law', nameParams, 'transformed', 'lawTransformed', { law: heir.id }));
    else items.push(entry(`law.${id}`, 'law', nameParams, 'abandoned', 'lawAbandoned', {}));
  }
  // 遗法 l1（两类程序分列）：这一类仍是 l1 为 legacy；被取代为 transformed；当前为 { none: true } 为 abandoned
  for (const cls of ['ordinary', 'constitutional']) {
    const spec = procSpec(w, cls);
    const code = cls === 'ordinary' ? 'procedureOrdinary' : 'procedureConstitutional';
    if (spec && spec.none) items.push(entry(`procedure.${cls}`, code, {}, 'abandoned', 'procedureNone', {}));
    else if (w.procedure[cls] === 'l1') items.push(entry(`procedure.${cls}`, code, {}, 'legacy', 'procedureLegacy', {}));
    else items.push(entry(`procedure.${cls}`, code, {}, 'transformed', 'procedureTransformed', { law: w.procedure[cls] }));
  }
  // 秘密投票：两类程序都不记名为 legacy；否则 transformed
  const secret = ['ordinary', 'constitutional'].every((c) => {
    const s = procSpec(w, c);
    return !s || s.none || s.secret;
  });
  items.push(entry('secretBallot', 'secretBallot', {}, secret ? 'legacy' : 'transformed', secret ? 'secretLegacy' : 'secretTransformed', {}));
  // 基本配给：l3 在效且 rationShare == 600 为 legacy；在效但比例改了为 transformed；l3 被撤销为 abandoned
  const l3 = w.laws.l3;
  const share = w.vars.rationShare ?? 0;
  if (l3.status !== 'active') items.push(entry('ration', 'ration', {}, 'abandoned', 'rationAbandoned', {}, 0));
  else if (share === 600) items.push(entry('ration', 'ration', {}, 'legacy', 'rationLegacy', { value: 60 }, 600));
  else items.push(entry('ration', 'ration', {}, 'transformed', 'rationTransformed', { value: round(share / 10, 1) }, share));
  // 旧币：先看是否废弃，再看是否被增发过，再看是否仍在流通
  const minted = (w.counters.mints || 0) > 0;
  const last5 = recent(5);
  const abandoned = d >= 5 && last5.length === 5 && last5.every((m) => m.coinVolume === 0);
  const circulating = recent(3).some((m) => m.coinVolume > 0);
  if (abandoned) items.push(entry('coin', 'coin', {}, 'abandoned', 'coinAbandoned', {}));
  else if (minted) items.push(entry('coin', 'coin', {}, 'transformed', 'coinMinted', {}));
  else if (circulating) items.push(entry('coin', 'coin', {}, 'circulating', 'coinCirculating', {}));
  else items.push(entry('coin', 'coin', {}, 'legacy', 'coinLegacy', {}));
  // 城名、地名
  const zhDefault = L('zh').cityName;
  items.push(w.cityName === zhDefault
    ? entry('cityName', 'cityName', {}, 'unnamed', 'cityUnnamed', (lang) => ({ name: cityDisplayName(w.cityName, lang) }))
    : entry('cityName', 'cityName', {}, 'named', 'cityNamed', { name: w.cityName }));
  const renamed = Object.values(w.places).filter((p) => p.renamedBy).length;
  items.push(entry('placeNames', 'placeNames', {}, renamed === 0 ? 'legacy' : 'transformed', 'placeNames', { n: renamed }, renamed));
  // 人类的建筑（每一座，地标除外）：遗址 → 残料少于总量 → 模块与初始不同 → 被改名 → 被修缮过 → 最近 10 日有人在此行动 → 空置
  for (const id of MAP.legacy) {
    const p = w.places[id];
    const def = HUMAN_DEFS[id];
    const modulesNow = p.modules.map((m) => m.type).sort().join(',');
    const modulesThen = def.modules.slice().sort().join(',');
    const used = p.activity.lastActiveDay !== null && d - p.activity.lastActiveDay < 10;
    if (p.razed) items.push(entry(id, id, {}, 'razed', 'placeRazed', {}));
    else if (p.salvage < p.salvageMax) items.push(entry(id, id, {}, 'salvaged', 'placeSalvaged', { pct: p.salvageMax ? round((p.salvage * 100) / p.salvageMax, 1) : 0 }));
    else if (p.modules.some((m) => !m.inherent) || modulesNow !== modulesThen) items.push(entry(id, id, {}, 'remodeled', 'placeRemodeled', {}));
    else if (p.renamedBy) items.push(entry(id, id, {}, 'reinterpreted', 'placeReinterpreted', { name: p.name }));
    else if (p.activity.repairs > 0) items.push(entry(id, id, {}, 'maintained', 'placeMaintained', {}));
    else if (used) items.push(entry(id, id, {}, 'used', 'placeUsed', {}));
    else items.push(entry(id, id, {}, 'untouched', 'placeUntouched', {}));
  }
  // 人类典籍：最近 3 日有人阅读为「仍被阅读」；第 5 日以后连续 5 日无人阅读为「被遗忘」
  const canonReadRecently = recent(3).some((m) => m.canonReads > 0);
  const canonForgotten = d >= 5 && last5.length === 5 && last5.every((m) => m.canonReads === 0);
  if (canonReadRecently) items.push(entry('canon', 'canon', {}, 'read', 'canonRead', {}));
  else if (canonForgotten) items.push(entry('canon', 'canon', {}, 'forgotten', 'canonForgotten', {}));
  else items.push(entry('canon', 'canon', {}, 'untouched', 'canonUntouched', {}));
  // 人类的名字：在世者中世代为 0 的比例
  const alive = agentList(w).filter(isAlive);
  const share0 = alive.length ? alive.filter((a) => a.generation === 0).length / alive.length : 0;
  items.push(entry('humanNames', 'humanNames', {}, share0 === 1 ? 'legacy' : share0 === 0 ? 'abandoned' : 'transformed', 'humanNames', { pct: round(share0 * 100, 1) }, round(share0)));
  // 源井：完好度与近 7 日趋势
  const cond = w.places.well.condition;
  const back = metrics.length > 7 ? metrics[metrics.length - 8].wellCondition : metrics.length ? metrics[0].wellCondition : cond;
  const delta = Math.round((cond - back) / 100);
  items.push(entry('well', 'well', {}, conditionBand(cond), 'well', (lang) => {
    const t = L(lang).legacy.trend;
    return { pct: round(cond / 100, 1), delta: delta === 0 ? t.flat : fmt(delta > 0 ? t.up : t.down, { n: Math.abs(delta) }) };
  }, { condition: cond, trend: delta }));

  return { day: d, items };
}


// ═══════════════════════════════════════════════════════════════
// 接入每日结算（§14.2 第 15–17 步）
// ═══════════════════════════════════════════════════════════════

STEPS.metrics = (w, d) => {
  w.metrics.push(dailyMetrics(w, d)); // 16 指标快照与人类遗产存活表
  w.legacy = computeLegacy(w, d);
  w.chronicle.push(writeChronicle(w, d)); // 17 史官
};

/** 第二前提的指标（SPEC-P2 §5.8）：常驻指令、匿名私语与屏蔽 */
function agenticMetrics(w) {
  const alive = agentList(w).filter(isAlive);
  const g = w.dayLog.p2;
  return {
    standingOrders: alive.reduce((n, a) => n + a.standing.length, 0),
    standingHolders: alive.filter((a) => a.standing.length > 0).length,
    standingSets: g.standingSets, standingFired: g.standingFired, standingFailed: g.standingFailed, standingSkipped: g.standingSkipped,
    standingErrors: g.standingErrors, standingUpkeep: g.standingUpkeep, standingSuspended: g.standingSuspended, standingExpired: g.standingExpired,
    anonymousWhispers: g.anonymousWhispers, mutes: g.mutes, muteBlocked: g.muteBlocked,
    mutedPairs: alive.reduce((n, a) => n + a.muted.filter((k) => k !== 'anonymous' && w.agents[k] && isAlive(w.agents[k])).length, 0),
  };
}

function premiseMetrics(w) {
  const alive = agentList(w).filter(isAlive);
  const mean = (xs) => xs.length ? Math.floor(xs.reduce((n, x) => n + x, 0) / xs.length) : 0;
  const generations = {};
  for (const a of alive) (generations[a.generation] ||= []).push(weightOf(a).soul);
  const bodies = [
    ...bodyList(w).filter((b) => b.occupant !== null),
    ...alive.filter((a) => !isShell(a)).map((a) => ({ ...a.body, occupant: a.id })),
  ];
  const g = w.dayLog.p1;
  return {
    upkeepMean: mean(alive.map(upkeepOf)), upkeepMax: Math.max(0, ...alive.map(upkeepOf)),
    memoryWeightMean: mean(alive.map((a) => weightOf(a).memories)),
    soulWeightByGeneration: Object.fromEntries(Object.entries(generations).map(([k, v]) => [k, mean(v)])),
    imparts: g.imparts, impartsAccepted: g.impartsAccepted, dormancyLosses: g.dormancyLosses,
    forks: g.forks.length, internalized: g.internalized,
    trainedWeightMean: mean(bodies.map((b) => b.trained.reduce((n, x) => n + x.weight, 0))),
    inheritedBodies: bodies.filter((b) => b.trained.some((x) => x.by !== b.occupant)).length,
    trainedEvicted: g.trainedEvicted, trainedWiped: g.trainedWiped, backstage: g.backstage.length,
  };
}
