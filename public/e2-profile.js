// 第二纪的居民档案与地点详情：标签、志与立志史、多作者的谱系网、遗传的记忆的来源；
// 地点的来源、模块、残料、主人、门、地点规则与「前世」（被拆成遗址、又在遗址上重新开辟的历史）。

import { h, ai } from './dom.js';
import { t, getLang, colon } from './i18n.js';
import { openModal } from './modals.js';
import {
  agentLink, placeLink, groupChip, statusChip, section, emptyNote, eventRow, dayTag, conditionBar, progressBar, bandText, pct, table,
} from './render.js';
import { wallBlock } from './tabs2.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs = {}, text) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
};

/**
 * 谱系网：中间一行是这位居民，上面是它的作者（至多三代），下面是它的子女（至多两代）。
 * 多作者时一个孩子有多条线连向它的每位作者——所以是网，不是树。节点可点击。
 */
export function lineageGraph(ctx, a) {
  const S = ctx.S.state;
  const byId = new Map(S.agents.map((x) => [x.id, x]));
  // 层：0 = 本人；-1、-2、-3 = 上溯；1、2 = 下传
  const levels = new Map([[a.id, 0]]);
  const edges = [];
  let frontier = [a.id];
  for (let d = 1; d <= 3; d++) {
    const next = [];
    for (const id of frontier) {
      const x = byId.get(id);
      if (!x) continue;
      for (const au of x.authors) {
        edges.push([au, id]);
        if (!levels.has(au)) {
          levels.set(au, -d);
          next.push(au);
        }
      }
    }
    frontier = next;
  }
  frontier = [a.id];
  for (let d = 1; d <= 2; d++) {
    const next = [];
    for (const id of frontier) {
      const x = byId.get(id);
      if (!x) continue;
      for (const c of x.children) {
        edges.push([id, c]);
        if (!levels.has(c)) {
          levels.set(c, d);
          next.push(c);
        }
      }
    }
    frontier = next;
  }
  if (levels.size <= 1) return null;
  const rows = new Map();
  for (const [id, lv] of levels) (rows.get(lv) || rows.set(lv, []).get(lv)).push(id);
  const lvs = [...rows.keys()].sort((x, y) => x - y);
  const W = 520;
  const rowH = 58;
  const H = lvs.length * rowH + 12;
  const pos = new Map();
  lvs.forEach((lv, ri) => {
    const ids = rows.get(lv).sort();
    ids.forEach((id, i) => pos.set(id, [((i + 1) * W) / (ids.length + 1), 28 + ri * rowH]));
  });
  const svg = svgEl('svg', { class: 'lineage', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('lineage') });
  const seen = new Set();
  for (const [from, to] of edges) {
    const key = `${from}>${to}`;
    if (seen.has(key) || !pos.has(from) || !pos.has(to)) continue;
    seen.add(key);
    const [x1, y1] = pos.get(from);
    const [x2, y2] = pos.get(to);
    svg.append(svgEl('path', { class: 'lin-edge', d: `M${x1},${y1 + 8} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2 - 8}` }));
  }
  for (const [id, [x, y]] of pos) {
    const x0 = byId.get(id);
    const g = svgEl('g', { class: `lin-node${id === a.id ? ' self' : ''}${x0 && x0.status !== 'awake' ? ` st-${x0.status}` : ''}`, transform: `translate(${x} ${y})`, tabindex: 0, role: 'button' });
    g.append(svgEl('circle', { r: 7 }), svgEl('text', { y: 20, 'text-anchor': 'middle' }, x0 ? x0.name : id));
    g.addEventListener('click', () => ctx.openAgent(id));
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') ctx.openAgent(id);
    });
    svg.append(g);
  }
  return svg;
}

/** data：GET /api/public/agents/:id 的返回 */
export function renderProfile2(ctx, data) {
  const a = data.agent;
  const S = ctx.S.state;
  const writings = S.docs.filter((d) => d.author && d.author.id === a.id);
  const carved = S.places.flatMap((p) => p.inscriptions.filter((i) => i.author && i.author !== 'humans' && i.author.id === a.id).map((i) => ({ ...i, place: p.id })));
  const lineage = lineageGraph(ctx, a);

  const facts = [
    [t('col_status'), statusChip(a.status)],
    [t('col_gen'), t('generation', { n: a.generation })],
    [t('col_age'), t('ageDays', { n: a.ageDays })],
    [t('col_energy'), String(a.energy)],
    [t('col_coins'), String(a.coins)],
    [t('col_place'), a.place ? placeLink(ctx, a.place) : '—'],
    [t('col_groups'), a.groups.length ? a.groups.map((g) => [groupChip(ctx, g), ' ']) : '—'],
    [t('col_tags'), a.tags.length ? a.tags.map((x) => [h('span', { class: `chip tag${x === 'exiled' ? ' exile' : ''}` }, x), ' ']) : '—'],
  ];

  return h(
    'div',
    { class: 'profile' },
    h('h3', null, a.name),
    h('p', { class: 'muted' }, t('aiContent'), ' · ', a.body ? `${t('model')}${colon()}${a.body.model} · ${t('bodyKind')}${colon()}${t(`bodyKind_${a.body.kind}`)}${a.creatorName ? ` · ${t('creator')}${colon()}${a.creatorName}` : ''}` : t('trueBody')),
    h('dl', { class: 'kv' }, facts.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    h('p', { class: 'muted' }, t('bornDay', { n: a.bornDay + 1 }), a.diedDay !== null && a.diedDay !== undefined ? ` · ${t('diedDay', { n: a.diedDay + 1 })}` : ''),
    a.purpose ? h('p', null, h('strong', null, `${t('purpose')}${colon()}`), ai(a.purpose)) : null,
    a.bio ? h('p', null, h('strong', null, `${t('bio')}${colon()}`), ai(a.bio)) : null,
    a.soul ? h('div', null, h('h4', null, t('soul')), h('p', { class: 'soul' }, ai(a.soul))) : null,
    section(
      `${t('authors')} / ${t('children')}`,
      h('p', null, `${t('authors')}${colon()}`, a.authors.length ? a.authors.map((p) => [agentLink(ctx, p), ' ']) : t('humanWritten')),
      h('p', null, `${t('children')}${colon()}`, a.children.length ? a.children.map((p) => [agentLink(ctx, p), ' ']) : '—'),
      lineage,
    ),
    a.purposeHistory && a.purposeHistory.length
      ? section(t('purposeHistory'), h('ul', { class: 'plain' }, a.purposeHistory.slice().reverse().map((x) => h('li', null, h('span', { class: 'muted' }, `D${x.day + 1} `), x.text === '' ? h('em', null, t('purposeCleared')) : ai(x.text)))))
      : null,
    section(
      t('publicGoods'),
      h('p', null, `${t('repaired')} ${a.stats.repaired} · ${t('contributed')} ${a.stats.contributed} · ${t('drawn')} ${a.stats.drawn} · ${t('salvaged')} ${a.stats.salvaged || 0}`),
    ),
    section(
      `${t('writings')} / ${t('inscriptions')}`,
      writings.length
        ? h('ul', { class: 'plain' }, writings.map((d) => h('li', null, (() => {
          const b = h('button', { class: 'link doc-link', type: 'button' }, d.title || ctx.lore.redacted);
          b.addEventListener('click', () => ctx.openDoc(d.id));
          return b;
        })())))
        : null,
      carved.length ? h('ul', { class: 'plain' }, carved.map((i) => h('li', null, placeLink(ctx, i.place), colon(), i.text === null ? h('em', null, ctx.lore.redacted) : ai(i.text)))) : null,
      writings.length + carved.length === 0 ? emptyNote() : null,
    ),
    section(
      `${t('memories')} (${data.memories.length})`,
      data.memories.length
        ? h('ul', { class: 'plain' }, data.memories.map((m) => h('li', null, h('span', { class: 'muted' }, `D${m.day + 1} `), m.from ? h('span', { class: 'chip inherited' }, t('memoryFrom', { name: ctx.agentName(m.from.id) })) : null, m.from ? ' ' : '', ai(m.text))))
        : emptyNote(),
    ),
    section(
      `${t('thoughts')} (${data.thoughts.length})`,
      data.thoughts.length
        ? h('ul', { class: 'plain' }, data.thoughts.map((x) => h('li', null, h('span', { class: 'muted' }, `${dayTag(x.tick)} `), x.text === null ? h('em', null, ctx.lore.redacted) : ai(x.text))))
        : emptyNote(),
    ),
    section(t('recentEvents'), data.events.length ? h('ul', { class: 'feed compact' }, data.events.slice().reverse().map((e) => eventRow(ctx, e))) : emptyNote()),
  );
}

/** 地点详情（弹窗）：来源、状态、主人、模块、残料、门、地点规则、前世、在场的居民、墙与工程 */
export function openPlace2(ctx, id) {
  const S = ctx.S.state;
  const lore = ctx.lore;
  const lang = getLang();
  const p = S.places.find((x) => x.id === id);
  if (!p || !lore) return;
  const m = openModal(ctx.placeName(id), 'wide');
  const here = S.agents.filter((a) => a.place === id && (a.status === 'awake' || a.status === 'dormant'));
  const region = (S.regions || []).find((r) => r.id === id);
  const moduleName = (type) => (lore.module[type] && lore.module[type].name) || type;
  const desc = p.origin === 'agent' && !p.razed ? p.description : (p.descriptionText && (p.descriptionText[lang] || p.descriptionText.zh)) || '';
  const readingList = (r) => (r && (r.reading[lang] || r.reading.zh) ? h('ol', { class: 'reading' }, (r.reading[lang] || r.reading.zh).rules.map((x) => h('li', null, x))) : null);
  const kids = [
    h('p', { class: 'muted' }, `${t('col_district')}${colon()}${ctx.districtName(p.district)} · ${t('col_origin')}${colon()}${t(`origin_${p.origin}`)}${p.founder ? ` · ${t('founder')}${colon()}` : ''}`, p.founder ? agentLink(ctx, p.founder.id) : null, p.foundedDay !== null && p.foundedDay !== undefined ? ` · ${t('foundedDay', { n: p.foundedDay + 1 })}` : ''),
    desc ? h('p', p.origin === 'agent' && !p.razed ? { class: 'ai' } : null, desc) : null,
    region
      ? h('p', null, `${t('richness')}${colon()}${(lore.richnessWild || {})[region.richness] || region.richness} · ${t('wildsEnergy')} ${region.energy}/${region.energyMax} · ${t('wildsCoins')} ${region.coins} · ${t('relicsFound')} ${region.relicsFound}/${region.relics}`)
      : p.razed ? h('p', { class: 'muted' }, t('mapRazed'))
        : p.condition === null ? h('p', { class: 'muted' }, t('fx_open'))
          : h('p', null, `${t('condition')}${colon()}`, conditionBar(p.condition), ` ${pct(p.condition)} · ${bandText(ctx, p.condition, id === 'well')}`),
    !p.razed && !p.open ? h('p', null, `${t('col_owner')}${colon()}`, p.owner.kind === 'city' ? t('owner_city') : p.owner.kind === 'group' ? t('owner_group', { name: ctx.groupName(p.owner.id) }) : t('owner_agent', { name: ctx.agentName(p.owner.id) })) : null,
    p.salvage ? h('p', null, `${t('col_salvage')}${colon()}`, progressBar(p.salvage.left, p.salvage.max), ` ${p.salvage.left}/${p.salvage.max}`) : null,
    p.gate ? h('p', null, `${t('col_gate')}${colon()}${p.gate.functioning ? t('gateOn') : t('gateOff')}`) : null,
    p.modules.length
      ? section(t('col_modules'), table(
        [t('col_name'), t('col_status'), t('col_salvage'), t('col_origin'), ''],
        p.modules.map((x) => [moduleName(x.type), x.functioning ? t('functioning') : t('notFunctioning'), String(x.salvage), x.inherent ? t('moduleInherent') : t('moduleBuilt'), x.inscription ? ai(x.inscription) : x.inscriptionUnreadable ? h('em', null, ctx.lore.unreadableInscription || '') : '']),
      ))
      : null,
    p.rules ? section(t('placeRulesSection'), readingList(p.rules), p.rules.setBy ? h('p', { class: 'muted' }, `${t('setBy')}${colon()}`, agentLink(ctx, p.rules.setBy.id)) : null) : null,
    section(`${t('col_place')} (${here.length})`, here.length ? h('ul', { class: 'plain inline' }, here.map((a) => h('li', null, h('button', { class: 'link', type: 'button', onClick: () => { m.close(); ctx.openAgent(a.id); } }, a.name), ' ', statusChip(a.status)))) : h('p', { class: 'empty' }, t('empty'))),
    p.inscriptions.length ? section(t('walls'), wallBlock(ctx, p)) : null,
    p.projects.length
      ? section(t('projects'), table(
        [t('col_name'), t('filterType'), t('progress')],
        p.projects.map((j) => [j.name ? ai(j.name) : j.module ? moduleName(j.module) : '—', t(`build_${j.build}`), `${j.have}/${j.need}`]),
      ))
      : null,
    p.incarnations && p.incarnations.length > 1 || (p.incarnations && p.incarnations.some((x) => x.toDay !== null))
      ? section(t('incarnations'), h('ol', { class: 'plain' }, p.incarnations.map((x) => h('li', null, ai(x.name), ` · ${t(`origin_${x.origin}`)} · D${x.fromDay + 1}–${x.toDay === null ? t('now') : `D${x.toDay + 1}`}`, x.founder ? [' · ', agentLink(ctx, x.founder.id)] : null))))
      : null,
  ];
  for (const k of kids) if (k) m.body.append(k);
}
