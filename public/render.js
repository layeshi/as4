// 各页共用的渲染工具：名字链接、事件句子、金额、法律效力的描述、完好度档位。
// ctx（由 app.js 提供）：{ S, lore, agent(id), agentName(id), placeName(id), groupName(id), openAgent(id), openPlace(id), openDoc(id) }

import { h, ai } from './dom.js';
import { t, fmt, getLang, describeEvent, CAT } from './i18n.js';

export const SEASON_TABLE = [
  1000, 1065, 1125, 1177, 1217, 1241, 1250, 1241, 1217, 1177, 1125, 1065,
  1000, 935, 875, 823, 783, 759, 750, 759, 783, 823, 875, 935,
];

const PERCENT_PARAMS = new Set(['rationShare', 'transferTax', 'wealthTax', 'quorum', 'passThreshold', 'amendThreshold']);

export const pct = (bp) => `${Math.round(bp / 100)}%`;

/** 每日刻数来自服务器配置（TICKS_PER_DAY）；app.js 在拿到状态后设置 */
export const clockConfig = { ticksPerDay: 12 };
export const dayOfTick = (tick) => Math.floor(tick / clockConfig.ticksPerDay);
/** 第几日（1 起）的标签，如 D12 */
export const dayTag = (tick) => `D${dayOfTick(tick) + 1}`;

/** 可点击的居民名字 */
export function agentLink(ctx, id) {
  const a = ctx.agent(id);
  const name = a ? a.name : String(id);
  const b = h('button', { class: `link agent-link ${a ? `st-${a.status}` : ''}`.trim(), type: 'button', title: a ? t(`status_${a.status}`) : '' }, name);
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    ctx.openAgent(id);
  });
  return b;
}

export function placeLink(ctx, id) {
  const b = h('button', { class: 'link place-link', type: 'button' }, ctx.placeName(id));
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    ctx.openPlace(id);
  });
  return b;
}

export function groupChip(ctx, id) {
  return h('span', { class: 'chip group-chip' }, ctx.groupName(id));
}

/** {energy, coins} → 「3 能量 与 2 旧币」 */
export function amountText(amount) {
  const parts = [];
  if (amount.energy > 0) parts.push(t('energyN', { n: amount.energy }));
  if (amount.coins > 0) parts.push(t('coinsN', { n: amount.coins }));
  return parts.length ? parts.join(` ${t('and')} `) : t('none');
}

/** 一个占位符的取值 → DOM 节点 / 文本 */
function renderValue(ctx, v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v !== 'object') return String(v);
  if (v.agent !== undefined) return agentLink(ctx, v.agent);
  if (v.place !== undefined) return placeLink(ctx, v.place);
  if (v.group !== undefined) return groupChip(ctx, v.group);
  if (v.doc !== undefined) {
    const d = ctx.S.state && ctx.S.state.docs.find((x) => x.id === v.doc);
    const title = (d && d.title) || v.title || v.doc;
    const b = h('button', { class: 'link doc-link', type: 'button' }, title);
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ctx.openDoc(v.doc);
    });
    return b;
  }
  if (v.text !== undefined) return ai(v.text);
  if (v.amount !== undefined) return amountText(v.amount);
  if (v.treasury) return t('treasury');
  if (v.city) return ctx.S.state ? ctx.cityName() : '';
  if (v.facilityType !== undefined) return (ctx.lore && ctx.lore.facility[v.facilityType]) || v.facilityType;
  if (v.weather !== undefined) return (ctx.lore && ctx.lore.weather[v.weather]) || v.weather;
  if (v.facility !== undefined) {
    for (const p of ctx.S.state ? ctx.S.state.places : []) {
      const f = p.facilities.find((x) => x.id === v.facility);
      if (f) return f.name;
    }
    return v.facility;
  }
  return '';
}

/** describeEvent 的结果 → 一个 DocumentFragment 里的子节点数组 */
export function renderTemplate(ctx, desc) {
  const nodes = [];
  const parts = desc.template.split(/(\{\w+\})/);
  for (const p of parts) {
    const m = /^\{(\w+)\}$/.exec(p);
    if (!m) {
      if (p) nodes.push(p);
      continue;
    }
    const key = m[1];
    if (key === 'op') {
      nodes.push(ctx.adminOp(desc.vars.op));
      continue;
    }
    nodes.push(renderValue(ctx, desc.vars[key]));
  }
  return nodes;
}

/** 事件的时间标签：D<日>·<刻> */
export function timeTag(e) {
  return `D${e.day + 1}·${(e.tick % clockConfig.ticksPerDay) + 1}`;
}

/** 一行事件（实况、档案与地点页共用） */
export function eventRow(ctx, e) {
  const desc = describeEvent(e);
  const cat = CAT[e.type] || 'world';
  const li = h(
    'li',
    { class: `ev cat-${cat} type-${e.type}`, dataset: { seq: e.seq, type: e.type, place: e.place || '', cat } },
    h('span', { class: 'ev-time', title: `tick ${e.tick}` }, timeTag(e)),
    h('span', { class: 'ev-body' }, renderTemplate(ctx, desc)),
    e.delayed ? h('span', { class: 'chip delayed', title: t('delayedMark') }, t('delayedMark')) : null,
  );
  return li;
}

// ── 完好度与档位 ──────────────────────────────────────────────

export function bandOf(bp) {
  if (bp >= 9000) return 'pristine';
  if (bp >= 6000) return 'worn';
  if (bp >= 3000) return 'weathered';
  if (bp >= 1) return 'dilapidated';
  return 'ruin';
}

export function bandText(ctx, bp, isWell = false) {
  const b = bandOf(bp);
  const table = isWell ? ctx.lore.wellBand : ctx.lore.band;
  return (table && table[b]) || b;
}

/** 完好度条（宽度用 CSSOM 设置） */
export function conditionBar(bp) {
  const fill = h('span', { class: `bar-fill band-${bandOf(bp)}` });
  fill.style.width = `${Math.max(0, Math.min(100, bp / 100))}%`;
  return h('span', { class: 'bar', role: 'img', 'aria-label': pct(bp) }, fill);
}

export function progressBar(have, need) {
  const fill = h('span', { class: 'bar-fill band-worn' });
  fill.style.width = `${Math.max(0, Math.min(100, (have / Math.max(1, need)) * 100))}%`;
  return h('span', { class: 'bar', role: 'img', 'aria-label': `${have}/${need}` }, fill);
}

// ── 法律效力 ──────────────────────────────────────────────────

function holderName(ctx, id) {
  if (ctx.S.state.groups.find((g) => g.id === id)) return `「${ctx.groupName(id)}」`;
  return ctx.agentName(id);
}

export function valueText(ctx, l, param, v) {
  if (typeof v === 'boolean') return v ? l.yes : l.no;
  if (v === null) return l.unlimited;
  if (param === 'electorate') return v === 'all' ? l.everyone : fmt(l.groupMembers, { name: ctx.groupName(String(v).slice(6)) });
  if (PERCENT_PARAMS.has(param)) return `${Math.round(v * 1000) / 10}%`;
  return String(v);
}

/** 法律效力 → 一句人类可读的话（与引擎的 describeEffect 一致，模板来自 /api/public/lore） */
export function describeEffect(ctx, e) {
  const l = ctx.lore && ctx.lore.law;
  if (!l) return e.type;
  const langName = (code) => l.langNames[code] || code;
  const amt = (energy, coins) => {
    const parts = [];
    if (energy > 0) parts.push(fmt(l.amountEnergy, { n: energy }));
    if (coins > 0) parts.push(fmt(l.amountCoins, { n: coins }));
    return parts.join(` ${l.and} `);
  };
  const S = ctx.S.state;
  switch (e.type) {
    case 'set': return fmt(l.set, { param: l.params[e.param] || e.param, value: valueText(ctx, l, e.param, e.value) });
    case 'grant': return fmt(l.grant, { amount: amt(e.energy || 0, e.coins || 0), to: holderName(ctx, e.to) });
    case 'stipend': return fmt(l.stipend, { to: holderName(ctx, e.to), energy: e.energy });
    case 'fund': {
      const proj = S.places.flatMap((p) => p.projects).find((j) => j.id === e.project);
      return fmt(l.fund, { project: proj ? proj.name : e.project, energy: e.energy });
    }
    case 'exile': return fmt(l.exile, { target: ctx.agentName(e.target) });
    case 'pardon': return fmt(l.pardon, { target: ctx.agentName(e.target) });
    case 'rename': return e.target === 'city' ? fmt(l.renameCity, { name: e.name }) : fmt(l.renamePlace, { target: ctx.placeName(e.target), name: e.name });
    case 'mint': return fmt(e.to === 'treasury' ? l.mintTreasury : l.mintCitizens, { coins: e.coins });
    case 'protect': {
      const ins = S.places.flatMap((p) => p.inscriptions).find((i) => i.id === e.inscription);
      const text = ins && ins.text ? [...ins.text].slice(0, 20).join('') : '';
      return fmt(l.protect, { id: e.inscription, text });
    }
    case 'unprotect': return fmt(l.unprotect, { id: e.inscription });
    case 'amend':
      if ('canonical' in e) return e.canonical === null ? l.canonicalNone : fmt(l.canonical, { lang: langName(e.canonical) });
      if (e.text === '') return fmt(l.amendRepeal, { n: e.article });
      return fmt(e.article > S.charter.articles.length ? l.amendNew : l.amendArticle, { n: e.article, lang: langName(e.lang), text: e.text });
    case 'repeal': {
      const law = S.laws.find((x) => x.id === e.law);
      return fmt(l.repeal, { id: e.law, title: law ? law.title : '' });
    }
    default: return e.type;
  }
}

// ── 杂项 ───────────────────────────────────────────────────────

/** 状态标签 */
export function statusChip(status) {
  return h('span', { class: `chip st-${status}` }, t(`status_${status}`));
}

/** 版块标题 */
export function section(title, ...kids) {
  return h('section', { class: 'sec' }, h('h3', null, title), ...kids);
}

export function emptyNote(text) {
  return h('p', { class: 'empty' }, text || t('empty'));
}

/** 表格：head 是表头文字数组，rows 是单元格（节点或文本）数组的数组 */
export function table(head, rows, cls = '') {
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: `tbl ${cls}`.trim() },
      h('thead', null, h('tr', null, head.map((x) => (x instanceof Node ? h('th', null, x) : h('th', { scope: 'col' }, x))))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c))))),
    ),
  );
}

export const langNow = () => getLang();

/** 迷你折线（地点的近 7 日趋势） */
export function spark(values, w = 64, hgt = 16) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(hgt));
  svg.setAttribute('aria-hidden', 'true');
  if (values.length < 2) return svg;
  const lo = Math.min(...values);
  const hi = Math.max(...values, lo + 1);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 2) + 1).toFixed(1)},${(hgt - 2 - ((v - lo) / (hi - lo)) * (hgt - 4)).toFixed(1)}`);
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', pts.join(' '));
  svg.append(line);
  return svg;
}
