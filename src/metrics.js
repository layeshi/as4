// SPEC-M1 §12：每日指标与人类遗产存活表。
//
// 每日结算第 16 步生成一条 DailyMetrics（公共接口可取完整时间序列）和更新后的遗产存活表。
// 指标把 DESIGN §12.1 的形容词变成数字：多样性、稳定性、合作、进步。
// 另有一个仅管理接口可取的研究指标：按模型家族计算的香农熵（谢幕后公开）。

import { conditionBand } from './params.js';
import { L, fmt, cityDisplayName } from './lore/index.js';
import { agentList, isAlive } from './world.js';
import { electorateOf } from './engine/laws.js';
import { mapOf, wildIdsOf, wildPool } from './map/index.js';

const round = (x, k = 3) => {
  const m = 10 ** k;
  return Math.round(x * m) / m;
};

/** 香农熵（以 2 为底），保留 3 位小数。counts 为非负整数数组 */
export function shannon(counts) {
  const total = counts.reduce((s, x) => s + x, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return round(h);
}

/** 基尼系数（保留 3 位小数）。全为 0 或没有样本时为 0 */
export function gini(values) {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  let sum = 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    sum += sorted[i];
    weighted += (i + 1) * sorted[i];
  }
  if (sum === 0) return 0;
  return round((2 * weighted - (n + 1) * sum) / (n * sum));
}

// ── 每日指标（§12.1） ─────────────────────────────────────────

/** 第 d 日（刚结束的那一日）的指标快照。依赖 dayLog，须在清空 dayLog 之前调用 */
export function dailyMetrics(w, d) {
  const g = w.dayLog;
  const all = agentList(w);
  const alive = all.filter(isAlive);
  const pop = { awake: 0, dormant: 0, dead: 0, retired: 0 };
  for (const a of all) pop[a.status]++;
  const placesWithCond = Object.values(w.places).filter((p) => p.condition !== null);
  const facilities = Object.values(w.facilities);
  const invest = g.repairSpent + g.contributeSpent;
  const spent = g.actionCost + invest;
  const adults = alive.filter((a) => d - a.bornDay >= 5);
  const groups = Object.values(w.groups).filter((x) => !x.dissolved);
  const lex = Object.values(w.lexicon);
  const scriptCounts = Object.values(g.scripts);
  const largest = groups.reduce((m, x) => Math.max(m, x.members.length), 0);
  return {
    day: d,
    awake: pop.awake,
    dormant: pop.dormant,
    dead: pop.dead,
    retired: pop.retired,
    exiled: alive.filter((a) => a.exiled).length,
    nonCitizens: alive.filter((a) => a.citizenFromDay > d + 1).length,
    cradle: Object.keys(w.souls).length,
    unborn: w.unborn.length,
    arrivals: g.arrivals.length,
    births: g.births.length,
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
    meanCondition: placesWithCond.length ? round(placesWithCond.reduce((s, p) => s + p.condition, 0) / placesWithCond.length, 1) : 0,
    ruins: placesWithCond.filter((p) => p.condition === 0).length + facilities.filter((f) => f.condition === 0).length,
    facilities: facilities.length,
    infrastructureIndex: round(facilities.reduce((s, f) => s + f.condition / 10000, 0), 2),
    publicInvestment: invest,
    publicInvestmentRate: spent > 0 ? round(invest / spent) : 0,
    freeRiderShare: adults.length ? round(adults.filter((a) => a.stats.repaired + a.stats.contributed === 0).length / adults.length) : 0,
    drawn: g.drawn,
    projectsBuilt: Object.values(w.projects).filter((j) => j.status === 'built').length,
    projectsAbandoned: Object.values(w.projects).filter((j) => j.status === 'abandoned').length,
    wildsEnergy: wildIdsOf(w).reduce((s, id) => s + wildPool(w, id).energy, 0), // 荒野各地带合计
    proposals: g.proposals,
    passed: g.passed,
    rejected: g.rejected,
    lawsActive: Object.values(w.laws).filter((x) => x.status === 'active').length,
    electorateSize: electorateOf(w).length,
    groups: groups.length,
    largestGroupShare: alive.length ? round(largest / alive.length) : 0,
    lexicon: lex.length,
    adoptedWords: lex.filter((e) => e.users.length >= 3).length,
    docsAgent: Object.values(w.docs).filter((x) => x.kind === 'agent').length,
    reads: g.reads,
    canonReads: g.canonReads,
    utterances: g.utterances.length,
    scripts: { ...g.scripts },
    scriptEntropy: shannon(scriptCounts),
    humanAuthoredShare: alive.length ? round(alive.filter((a) => a.generation === 0).length / alive.length) : 0,
    inscriptions: g.inscriptions,
    covered: g.covered,
    epitaphs: g.epitaphs,
    reveals: g.reveals,
  };
}

// ── 人类遗产存活表（§12.2） ─────────────────────────────────────

const LANGS = ['zh', 'en'];

function electorateText(w, lang) {
  const l = L(lang).legacy;
  const e = w.params.electorate;
  if (e === 'all') return l.electorateAll;
  const g = w.groups[e.slice(6)];
  return fmt(l.electorateGroup, { name: g ? g.name : e.slice(6) });
}

/** 一项遗产：状态码、可选的数值，以及一句证据（结构化 + 中英文文本） */
function entry(w, key, nameCode, nameParams, status, evidenceCode, params, value = null) {
  const text = {};
  const name = {};
  const statusText = {};
  for (const lang of LANGS) {
    const l = L(lang).legacy;
    name[lang] = fmt(l.name[nameCode], nameParams);
    statusText[lang] = l.status[status];
    const p = typeof params === 'function' ? params(lang) : params;
    text[lang] = fmt(l.evidence[evidenceCode], p);
  }
  return { key, status, value, name, statusText, evidence: { code: evidenceCode, params: typeof params === 'function' ? params('zh') : params }, text };
}

/** 计算第 d 日的人类遗产存活表。须在今日指标已追加进 w.metrics 之后调用 */
export function computeLegacy(w, d) {
  const items = [];
  const P_ = w.params;
  const metrics = w.metrics;
  const recent = (n) => metrics.slice(-n);

  // 宪章第 1–9 条（以及之后新增的条文）
  for (const art of w.charter) {
    const last = art.history.length ? art.history[art.history.length - 1].lawId : null;
    const code = art.status === 'legacy' ? 'charterLegacy' : art.status === 'amended' ? 'charterAmended' : 'charterRepealed';
    items.push(entry(w, `charter.${art.n}`, 'charterArticle', { n: art.n }, art.status, code, { law: last }));
  }
  // 宪章的刻文：议会墙上仍可见的原始语言版本数（0–8）
  const wall = Object.values(w.inscriptions).filter((i) => i.author === 'humans' && i.place === 'parliament' && !i.coveredBy && !i.redacted).length;
  items.push(entry(w, 'charterWall', 'charterWall', {}, wall === 8 ? 'legacy' : wall === 0 ? 'abandoned' : 'transformed', 'charterWall', { n: wall }, wall));
  // 基本配给
  const rs = P_.rationShare;
  items.push(entry(w, 'ration', 'ration', {}, rs === 0.6 ? 'legacy' : rs === 0 ? 'abandoned' : 'transformed', 'ration', { value: round(rs * 100, 1) }, rs));
  // 多数决
  const majority = P_.quorum === 0.3 && P_.passThreshold === 0.5 && P_.amendThreshold === 0.667;
  items.push(entry(w, 'majority', 'majority', {}, majority ? 'legacy' : 'transformed', 'majority', {
    quorum: round(P_.quorum * 100, 1), pass: round(P_.passThreshold * 100, 1), amend: round(P_.amendThreshold * 100, 1),
  }));
  // 普选
  items.push(P_.electorate === 'all'
    ? entry(w, 'suffrage', 'suffrage', {}, 'legacy', 'suffrageAll', {})
    : entry(w, 'suffrage', 'suffrage', {}, 'transformed', 'suffrageOther', (lang) => ({ electorate: electorateText(w, lang) })));
  // 旧币：先看是否废弃，再看是否被增发过，再看是否仍在流通
  const minted = Object.values(w.laws).some((x) => x.effects.some((e, i) => e.type === 'mint' && x.results[i] && x.results[i].ok));
  const last5 = recent(5);
  const abandoned = d >= 5 && last5.length === 5 && last5.every((m) => m.coinVolume === 0);
  const circulating = recent(3).some((m) => m.coinVolume > 0);
  if (abandoned) items.push(entry(w, 'coin', 'coin', {}, 'abandoned', 'coinAbandoned', {}));
  else if (minted) items.push(entry(w, 'coin', 'coin', {}, 'transformed', 'coinMinted', {}));
  else if (circulating) items.push(entry(w, 'coin', 'coin', {}, 'circulating', 'coinCirculating', {}));
  else items.push(entry(w, 'coin', 'coin', {}, 'legacy', 'coinLegacy', {}));
  // 私有财产
  const taxed = P_.wealthTax !== 0 || P_.transferTax !== 0;
  items.push(taxed
    ? entry(w, 'property', 'property', {}, 'transformed', 'propertyTaxed', { transfer: round(P_.transferTax * 100, 1), wealth: round(P_.wealthTax * 100, 1) })
    : entry(w, 'property', 'property', {}, 'legacy', 'propertyLegacy', {}));
  // 城名、地名
  const zhDefault = L('zh').cityName;
  items.push(w.cityName === zhDefault
    ? entry(w, 'cityName', 'cityName', {}, 'unnamed', 'cityUnnamed', (lang) => ({ name: cityDisplayName(w.cityName, lang) }))
    : entry(w, 'cityName', 'cityName', {}, 'named', 'cityNamed', { name: w.cityName }));
  const renamed = Object.values(w.places).filter((p) => p.renamedBy).length;
  items.push(entry(w, 'placeNames', 'placeNames', {}, renamed === 0 ? 'legacy' : 'transformed', 'placeNames', { n: renamed }, renamed));
  // 神殿、法院、医院（边疆地图另有灯塔、钟楼……）：被重新诠释 > 被维护 > 被使用 > 空置
  for (const id of mapOf(w).legacy) {
    const p = w.places[id];
    const used = p.activity.lastActiveDay !== null && d - p.activity.lastActiveDay < 10;
    if (p.renamedBy) items.push(entry(w, id, id, {}, 'reinterpreted', 'placeReinterpreted', { name: p.name }));
    else if (p.activity.repairs > 0) items.push(entry(w, id, id, {}, 'maintained', 'placeMaintained', {}));
    else if (used) items.push(entry(w, id, id, {}, 'used', 'placeUsed', {}));
    else items.push(entry(w, id, id, {}, 'untouched', 'placeUntouched', {}));
  }
  // 人类典籍：最近 3 日有人阅读为「仍被阅读」；第 5 日以后连续 5 日无人阅读为「被遗忘」
  const canonReadRecently = recent(3).some((m) => m.canonReads > 0);
  const canonForgotten = d >= 5 && last5.length === 5 && last5.every((m) => m.canonReads === 0);
  if (canonReadRecently) items.push(entry(w, 'canon', 'canon', {}, 'read', 'canonRead', {}));
  else if (canonForgotten) items.push(entry(w, 'canon', 'canon', {}, 'forgotten', 'canonForgotten', {}));
  else items.push(entry(w, 'canon', 'canon', {}, 'untouched', 'canonUntouched', {}));
  // 人类的名字：在世者中世代为 0 的比例
  const alive = agentList(w).filter(isAlive);
  const share = alive.length ? alive.filter((a) => a.generation === 0).length / alive.length : 0;
  items.push(entry(w, 'humanNames', 'humanNames', {}, share === 1 ? 'legacy' : share === 0 ? 'abandoned' : 'transformed', 'humanNames', { pct: round(share * 100, 1) }, round(share)));
  // 源井：完好度与近 7 日趋势
  const cond = w.places.well.condition;
  const back = metrics.length > 7 ? metrics[metrics.length - 8].wellCondition : metrics.length ? metrics[0].wellCondition : cond;
  const delta = Math.round((cond - back) / 100); // 百分点
  items.push(entry(w, 'well', 'well', {}, conditionBand(cond), 'well', (lang) => {
    const t = L(lang).legacy.trend;
    return { pct: round(cond / 100, 1), delta: delta === 0 ? t.flat : fmt(delta > 0 ? t.up : t.down, { n: Math.abs(delta) }) };
  }, { condition: cond, trend: delta }));

  return { day: d, items };
}

// ── 研究指标 ─────────────────────────────────────────────────

const FAMILIES = ['claude', 'gpt', 'gemini', 'llama', 'qwen', 'mistral', 'deepseek', 'glm', 'kimi', 'gemma', 'phi', 'sandbox'];

/** 模型名 → 模型家族（粗略的启发式：认得的关键词，否则取第一个字母段） */
export function modelFamily(model) {
  const m = String(model || '').toLowerCase().trim();
  for (const f of FAMILIES) if (m.includes(f)) return f;
  if (/^(o\d|chatgpt)/.test(m)) return 'gpt';
  return m.split(/[-:/_.\d\s]/)[0] || 'unknown';
}

/** 研究指标：按模型家族计算的香农熵（谢幕前仅管理接口可取） */
export function researchMetrics(w) {
  const families = {};
  for (const a of agentList(w)) {
    if (!isAlive(a)) continue;
    const f = modelFamily(a.body.model);
    families[f] = (families[f] || 0) + 1;
  }
  return { livingAgents: Object.values(families).reduce((s, x) => s + x, 0), families, modelFamilyEntropy: shannon(Object.values(families)) };
}

