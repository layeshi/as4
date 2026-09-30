// 标签页（下）：环境、典籍、墓园、指标、遗产、天象。

import { h, clear, ai, storageGet, storageSet } from './dom.js';
import { t, getLang, colon } from './i18n.js';
import { api, errorText } from './api.js';
import { lineChart } from './charts.js';
import {
  agentLink, placeLink, section, emptyNote, table, conditionBar, progressBar, bandText, pct, spark, SEASON_TABLE, statusChip, amountText,
} from './render.js';

const WELL_BASE = 600; // 默认参数下的源井基础日产（仅用于「今日预计产出」的估算）

const ownerText = (ctx, o) => {
  if (!o || o.kind === 'city') return t('owner_city');
  if (o.kind === 'group') return t('owner_group', { name: ctx.groupName(o.id) });
  return t('owner_agent', { name: ctx.agentName(o.id) });
};

// ── 环境 ──────────────────────────────────────────────────────

export function renderEnvironment(ctx, root) {
  const S = ctx.S.state;
  const lore = ctx.lore;

  root.append(wellPanel(ctx));

  // 地点表（有街区的地图多一列街区）
  const fx = (p) => {
    if (p.wild) return t('fx_wild');
    if (p.kind === 'open') return t('fx_open');
    if (p.id === 'port') return t('fx_port');
    if (p.id === 'school') return t('fx_school');
    if (p.kind === 'well') return t('fx_well');
    if (p.kind === 'cost') return t('fx_cost');
    return t('fx_none');
  };
  const trend = (p) => {
    const hst = p.history || [];
    if (p.condition === null) return '—';
    if (hst.length < 2) return '—';
    const d = hst[hst.length - 1] - hst[0];
    const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '＝';
    return h('span', { class: `trend ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`.trim() }, spark(hst), ` ${arrow} ${(Math.abs(d) / 100).toFixed(1)}`);
  };
  const districts = S.places.some((p) => p.district);
  root.append(
    section(
      t('places'),
      table(
        [t('col_name'), ...(districts ? [t('col_district')] : []), t('condition'), t('band'), t('trend7'), t('decay'), t('effect')],
        S.places.map((p) => [
          h('span', null, placeLink(ctx, p.id), p.renamedBy ? h('small', { class: 'muted' }, ` (${lore.place[p.id].name})`) : null),
          ...(districts ? [ctx.districtName(p.district)] : []),
          p.condition === null ? '—' : h('span', { class: 'cond' }, conditionBar(p.condition), ` ${pct(p.condition)}`),
          p.condition === null ? '—' : bandText(ctx, p.condition, p.id === 'well'),
          trend(p),
          p.decayPerDay ? t('decayPerDay', { n: p.decayPerDay }) : '—',
          fx(p),
        ]),
        'places',
      ),
    ),
  );

  // 设施
  const facilities = S.places.flatMap((p) => p.facilities);
  root.append(
    section(
      t('facilities'),
      facilities.length
        ? table(
          [t('col_name'), t('filterType'), t('col_place'), t('builtBy'), t('condition'), t('col_status')],
          facilities.map((f) => [
            ai(f.name),
            lore.facility[f.type] || f.type,
            f.type === 'road' ? h('span', null, placeLink(ctx, f.place), ' ↔ ', placeLink(ctx, f.to)) : placeLink(ctx, f.place),
            ownerText(ctx, f.owner),
            h('span', { class: 'cond' }, conditionBar(f.condition), ` ${pct(f.condition)}`),
            f.ruined ? t('ruined') : f.functioning ? t('functioning') : t('notFunctioning'),
          ]),
        )
        : emptyNote(),
    ),
  );

  // 工程
  const projects = S.places.flatMap((p) => p.projects);
  root.append(
    section(
      t('projects'),
      projects.length
        ? table(
          [t('col_name'), t('filterType'), t('col_place'), t('builtBy'), t('progress'), ''],
          projects.map((j) => [
            ai(j.name),
            lore.facility[j.type] || j.type,
            placeLink(ctx, j.place),
            ownerText(ctx, j.owner),
            h('span', { class: 'cond' }, progressBar(j.have, j.need), ` ${j.have}/${j.need}`),
            t('expires', { n: j.expiresDay + 1 }),
          ]),
        )
        : emptyNote(),
    ),
  );

  // 墙上的铭刻
  const walls = S.places.filter((p) => p.inscriptions.length > 0);
  root.append(
    section(
      t('walls'),
      walls.length
        ? walls.map((p) => wallBlock(ctx, p))
        : emptyNote(),
    ),
  );

  // 荒野：经典地图只有一个荒野；边疆地图的荒野分成几个地带，各有储量与遗物
  const words = S.world.map === 'classic' ? lore.richness : lore.richnessWild || lore.richness;
  const regions = S.regions || [];
  root.append(
    section(
      regions.length > 1 ? t('regions') : t('wilds'),
      table(
        [t('col_region'), t('richness'), t('wildsEnergy'), t('regen'), t('wildsCoins'), t('relicsFound')],
        regions.map((r) => [
          placeLink(ctx, r.id),
          words[r.richness] || r.richness,
          h('span', { class: 'cond' }, progressBar(r.energy, r.energyMax), ` ${r.energy}/${r.energyMax}`),
          t('perDay', { n: r.regen }),
          String(r.coins),
          `${r.relicsFound}/${r.relics}`,
        ]),
        'regions',
      ),
    ),
  );
}

export function wallBlock(ctx, p) {
  const visible = new Set(p.wallVisible);
  const authorOf = (i) => (i.author === 'humans' ? h('span', { class: 'chip' }, t('authorHumans')) : i.author ? agentLink(ctx, i.author.id) : '?');
  const line = (i) => h(
    'li',
    { class: `inscription ${visible.has(i.id) ? '' : 'covered'}`.trim() },
    h('span', { class: 'muted' }, `${i.id} · D${i.day + 1} · `), authorOf(i), ' ',
    i.text === null ? h('em', null, ctx.lore.redacted) : i.author === 'humans' ? h('span', { lang: i.lang }, i.text) : ai(i.text),
    i.protectedBy && i.protectedBy.length ? h('span', { class: 'chip' }, t('protectedMark')) : null,
    i.coveredBy ? h('span', { class: 'chip' }, t('coveredBy', { id: i.coveredBy })) : null,
  );
  const shown = p.inscriptions.filter((i) => visible.has(i.id));
  const hidden = p.inscriptions.filter((i) => !visible.has(i.id));
  return h(
    'div',
    { class: 'wall' },
    h('h4', null, placeLink(ctx, p.id), ` (${shown.length}/${p.wallSlots})`),
    h('ul', null, shown.map(line)),
    hidden.length ? h('details', null, h('summary', null, `${t('history')} (${hidden.length})`), h('ul', null, hidden.map(line))) : null,
  );
}

function wellPanel(ctx) {
  const S = ctx.S.state;
  const well = S.places.find((p) => p.id === 'well');
  const day = S.world.dayOfMonth;
  const weatherF = S.weather.active.some((x) => x.type === 'drought') ? 600 : S.weather.active.some((x) => x.type === 'bounty') ? 1400 : 1000;
  const wellF = Math.max(Math.floor(well.condition / 10), 200);
  const expected = Math.floor((WELL_BASE * wellF * SEASON_TABLE[day] * weatherF) / 1e9);
  const hist = S.well.outputHistory;
  const draws = ctx.S.events.filter((e) => e.type === 'draw').slice(-8).reverse();
  const curve = lineChart({
    series: [{ name: t('season'), points: SEASON_TABLE.map((v, i) => [i + 1, v / 10]), color: 2 }, { name: t('today'), points: [[day + 1, SEASON_TABLE[day] / 10]], color: 1 }],
    height: 140, yMax: 140, yFormat: (v) => `${v}%`, ariaLabel: t('seasonCurve'),
  });
  const outChart = hist.length > 1
    ? lineChart({ series: [{ name: t('s_output'), points: hist.map((v, i) => [S.world.day - hist.length + 1 + i, v]), color: 0 }], height: 140, ariaLabel: t('outputHistory') })
    : null;
  return section(
    t('wellPanel'),
    h(
      'dl',
      { class: 'kv' },
      h('dt', null, t('condition')), h('dd', null, h('span', { class: 'cond' }, conditionBar(well.condition), ` ${pct(well.condition)} · ${bandText(ctx, well.condition, true)}`)),
      h('dt', null, t('wellOutput', { n: hist.length ? hist[hist.length - 1] : '—' })), h('dd', null, `${t('expectedOutput')}${colon()}≈ ${expected}`),
      h('dt', null, t('drawPool')), h('dd', null, `${S.well.drawPoolLeft}`),
      h('dt', null, t('drawQuota')), h('dd', null, S.params.drawQuotaPerDay === null ? ctx.lore.law.unlimited : String(S.params.drawQuotaPerDay)),
    ),
    h('div', { class: 'charts two' }, h('figure', null, curve, h('figcaption', null, t('seasonCurve'))), outChart ? h('figure', null, outChart, h('figcaption', null, t('outputHistory'))) : null),
    draws.length
      ? h('div', null, h('h4', null, t('recentDraws')), h('ul', { class: 'plain' }, draws.map((e) => h('li', null, agentLink(ctx, e.agent), ` · ${t('energyN', { n: e.data.amount })} · D${e.day + 1}`))))
      : null,
  );
}

// ── 典籍 ──────────────────────────────────────────────────────

let openDocId = null;

export function renderLibrary(ctx, root) {
  const S = ctx.S.state;
  const reader = h('div', { class: 'doc-reader' });
  const showDoc = async (id) => {
    openDocId = id;
    clear(reader);
    reader.append(h('p', { class: 'muted' }, t('loading')));
    const r = await api(`/api/public/docs/${encodeURIComponent(id)}`);
    clear(reader);
    if (!r.ok) return reader.append(h('p', { class: 'error' }, t('loadFailed')));
    const d = r.json;
    const isAgent = d.kind === 'agent';
    reader.append(
      h('h4', null, d.title === null ? ctx.lore.redacted : isAgent ? ai(d.title) : d.title),
      h('p', { class: 'muted' }, `${t(`kind_${d.kind}`)}${d.author ? ' · ' : ''}`, d.author ? agentLink(ctx, d.author.id) : null, d.source ? ` · ${t('source')}${colon()}${d.source}` : '', ` · ${t('reads', { n: d.reads })}`),
      d.body === null ? h('p', null, h('em', null, ctx.lore.redacted)) : h('pre', { class: `doc-body ${isAgent ? 'ai' : ''}`.trim(), lang: d.lang }, d.body),
      d.ref && d.lang !== getLang() && d.ref[getLang()] ? h('div', { class: 'ref' }, h('h5', null, t('refTranslation')), h('pre', { class: 'doc-body' }, d.ref[getLang()])) : null,
    );
    reader.scrollIntoView({ block: 'nearest' });
  };
  const item = (d) => {
    const b = h('button', { class: `link doc-link ${openDocId === d.id ? 'active' : ''}`.trim(), type: 'button' }, d.title === null ? ctx.lore.redacted : d.title);
    b.addEventListener('click', () => showDoc(d.id));
    return h('li', null, b, ' ', h('small', { class: 'muted' }, t('reads', { n: d.reads }), d.author ? ` · ${ctx.agentName(d.author.id)}` : ''));
  };
  const kinds = ['canon', 'relic', 'agent'];
  root.append(
    ...kinds.map((k) => {
      const list = S.docs.filter((d) => d.kind === k);
      return section(`${t(`kind_${k}`)} (${list.length})`, list.length ? h('ul', { class: 'docs' }, list.map(item)) : emptyNote());
    }),
    reader,
  );
  if (openDocId) showDoc(openDocId);

  const lex = S.lexicon.slice().sort((a, b) => b.uses - a.uses || b.tick - a.tick);
  root.append(
    section(
      `${t('lexicon')} (${lex.length})`,
      lex.length
        ? table(
          [t('col_word'), t('col_meaning'), t('col_uses'), t('col_users')],
          lex.map((e) => [ai(e.word), e.meaning === null ? h('em', null, ctx.lore.redacted) : ai(e.meaning), e.uses, e.users]),
        )
        : emptyNote(),
    ),
  );
}

export const openDoc = (id) => {
  openDocId = id;
};

// ── 墓园 ──────────────────────────────────────────────────────

export function renderCemetery(ctx, root) {
  const S = ctx.S.state;
  const graves = S.cemetery.slice().reverse();
  root.append(
    section(
      `${t('graves')} (${graves.length})`,
      graves.length
        ? graves.map((g) => h(
          'article',
          { class: 'card grave' },
          h('h4', null, agentLink(ctx, g.agentId), ` · ${t('ageAtDeath', { n: g.ageDays })} · D${g.diedDay + 1}`),
          h('p', { class: 'muted' }, `${t('cause')}${colon()}${g.cause === 'dormant' ? t('cause_dormant') : g.cause || t('unknown')}`),
          g.lastWords ? h('p', null, `${t('lastWords')}${colon()}`, ai(g.lastWords)) : null,
          g.epitaphs.length ? h('div', null, h('h5', null, t('epitaphs')), h('ul', { class: 'plain' }, g.epitaphs.map((e) => h('li', null, e.author ? agentLink(ctx, e.author.id) : '?', colon(), ai(e.text))))) : null,
          g.memories.length ? h('details', null, h('summary', null, `${t('memories')} (${g.memories.length})`), h('ul', { class: 'plain' }, g.memories.map((m) => h('li', null, ai(m.text))))) : null,
          g.will && g.will.heirs && g.will.heirs.length
            ? h('p', { class: 'muted' }, `${t('will')}${colon()}`, g.will.heirs.map((x) => [x.to === 'treasury' ? t('treasury') : ctx.agentName(x.to), `×${x.share} `]))
            : null,
        ))
        : emptyNote(t('noGraves')),
    ),
    section(
      `${t('retiredList')} (${S.retired.length})`,
      S.retired.length
        ? h('ul', { class: 'plain' }, S.retired.slice().reverse().map((r) => h('li', null, agentLink(ctx, r.agentId), ` · ${t('retiredOn', { n: r.day + 1 })}`, r.lastWords ? [' · ', ai(r.lastWords)] : null)))
        : emptyNote(t('noRetired')),
    ),
    section(
      `${t('unbornList')} (${S.unborn.length})`,
      S.unborn.length
        ? h('ul', { class: 'plain' }, S.unborn.map((u) => h('li', null, ai(u.name), u.parents ? [' · ', u.parents.map((p) => [agentLink(ctx, p), ' '])] : null)))
        : emptyNote(t('noUnborn')),
    ),
  );
}

// ── 指标 ──────────────────────────────────────────────────────

export async function renderMetrics(ctx, root) {
  root.append(h('p', { class: 'muted' }, t('loading')));
  const r = await api('/api/public/metrics');
  clear(root);
  if (!r.ok) return root.append(h('p', { class: 'error' }, t('loadFailed')));
  const m = r.json.metrics;
  if (m.length === 0) return root.append(emptyNote(t('noData')));
  const pts = (key, scale = 1) => m.filter((x) => typeof x[key] === 'number').map((x) => [x.day + 1, x[key] * scale]);
  const fig = (title, chart) => h('figure', null, chart, h('figcaption', null, title));
  const two = (a, b) => h('div', { class: 'charts two' }, a, b);
  const rate = (v) => `${Math.round(v * 100)}%`;
  root.append(
    two(
      fig(t('m_population'), lineChart({ series: [{ name: t('s_awake'), points: pts('awake'), color: 0 }, { name: t('s_dormant'), points: pts('dormant'), color: 3 }], height: 190, xLabel: 'D' })),
      fig(t('m_well'), lineChart({ series: [{ name: t('s_condition'), points: pts('wellCondition', 0.01), color: 1 }, { name: t('s_output'), points: pts('output'), axis: 'right', color: 2 }], height: 190, yMax: 100, xLabel: 'D' })),
    ),
    two(
      fig(t('m_treasury'), lineChart({ series: [{ name: t('treasury'), points: pts('treasuryEnergy'), color: 4 }], height: 190, xLabel: 'D' })),
      fig(t('m_gini'), lineChart({ series: [{ name: 'Gini', points: pts('gini'), color: 5 }], height: 190, yMax: 1, xLabel: 'D' })),
    ),
    two(
      fig(t('m_invest'), lineChart({ series: [{ name: t('m_invest'), points: pts('publicInvestmentRate'), color: 1 }], height: 190, yMax: 1, yFormat: rate, xLabel: 'D' })),
      fig(t('m_freerider'), lineChart({ series: [{ name: t('m_freerider'), points: pts('freeRiderShare'), color: 3 }], height: 190, yMax: 1, yFormat: rate, xLabel: 'D' })),
    ),
    two(
      fig(t('m_curtain'), lineChart({ series: [{ name: t('m_curtain'), points: pts('humanAuthoredShare'), color: 2 }], height: 190, yMax: 1, yFormat: rate, xLabel: 'D' })),
      fig(t('m_entropy'), lineChart({ series: [{ name: t('m_entropy'), points: pts('scriptEntropy'), color: 4 }], height: 190, xLabel: 'D' })),
    ),
    two(
      fig(t('m_coins'), lineChart({ series: [{ name: t('s_volume'), points: pts('coinVolume'), color: 0 }, { name: t('s_price'), points: pts('coinPrice'), axis: 'right', color: 3 }], height: 190, xLabel: 'D' })),
      fig(t('m_laws'), lineChart({ series: [{ name: t('m_laws'), points: pts('lawsActive'), color: 5 }], height: 190, xLabel: 'D' })),
    ),
  );
}

// ── 遗产 ──────────────────────────────────────────────────────

const LEGACY_TONE = {
  legacy: 'alive', read: 'alive', used: 'alive', maintained: 'alive', circulating: 'alive',
  transformed: 'changed', amended: 'changed', reinterpreted: 'changed', named: 'changed', unnamed: 'alive',
  abandoned: 'gone', forgotten: 'gone', repealed: 'gone', untouched: 'gone',
};

export function renderLegacy(ctx, root) {
  const L = ctx.S.state.legacy;
  root.append(h('p', { class: 'muted' }, t('legacyHint')));
  if (!L) return root.append(emptyNote(t('noData')));
  const lang = getLang();
  root.append(
    h('p', { class: 'muted' }, t('legacyUpdated', { n: L.day + 1 })),
    table(
      [t('col_name'), t('col_status'), ''],
      L.items.map((i) => [
        i.name[lang] || i.name.zh,
        h('span', { class: `chip tone-${LEGACY_TONE[i.status] || 'changed'}` }, i.statusText[lang] || i.statusText.zh),
        i.text[lang] || i.text.zh,
      ]),
      'legacy',
    ),
  );
}

// ── 天象 ──────────────────────────────────────────────────────

const WEATHER_TYPES = ['calm', 'drought', 'bounty', 'quake', 'fog', 'eclipse', 'amnesia', 'aurora', 'migration'];

export function renderWeather(ctx, root) {
  const S = ctx.S.state;
  const lore = ctx.lore;
  const W = S.weather;
  const name = (type) => lore.weather[type] || type;

  root.append(
    section(
      t('weatherActive'),
      W.active.length
        ? h('ul', { class: 'plain' }, W.active.map((x) => h('li', null, h('strong', null, name(x.type)), ` · ${t('fromToDays', { a: x.startDay + 1, b: x.endDay + 1 })} · ${t('daysLeft', { n: x.daysLeft })}`)))
        : emptyNote(t('weatherNoActive')),
    ),
    section(
      t('weatherOmens'),
      W.omens.length
        ? h('ul', { class: 'plain' }, W.omens.map((o) => h('li', null, placeLink(ctx, o.place), ' · ', ai(o.text && typeof o.text === 'object' ? o.text[getLang()] || o.text.zh : o.text))))
        : emptyNote(t('weatherNoOmen')),
    ),
  );

  // 投票
  const month = W.votes.month;
  const votedKey = `houren.voted.${S.world.id}`;
  const voted = storageGet(votedKey) === String(month);
  const msg = h('p', { class: 'muted', role: 'status' });
  const tallies = h('ul', { class: 'plain tallies' });
  const showTallies = (tl) => {
    clear(tallies);
    const entries = Object.entries(tl).sort((a, b) => b[1] - a[1]);
    if (!entries.length) tallies.append(h('li', { class: 'muted' }, t('empty')));
    for (const [type, n] of entries) tallies.append(h('li', null, `${name(type)} × ${n}`));
  };
  showTallies(W.votes.tallies);
  const buttons = WEATHER_TYPES.map((type) => {
    const b = h('button', { class: 'btn small', type: 'button', disabled: voted }, name(type));
    b.addEventListener('click', async () => {
      for (const x of buttons) x.disabled = true;
      const r = await api('/api/public/weather/vote', { method: 'POST', body: { type } });
      if (r.ok) {
        storageSet(votedKey, String(r.json.month));
        showTallies(r.json.tallies);
        msg.textContent = `${t('weatherVoted')}${colon()}${name(type)}`;
      } else {
        msg.textContent = r.status === 429 ? t('rateLimited') : errorText(r, t('networkError'));
        if (r.status === 429 && r.json && r.json.error && r.json.error.tallies) showTallies(r.json.error.tallies);
        if (r.status === 429) storageSet(votedKey, String(month));
      }
    });
    return b;
  });
  root.append(
    section(
      `${t('weatherVote')} (${t('month', { n: month + 2 })})`,
      h('p', { class: 'muted' }, t('weatherVoteHint')),
      h('div', { class: 'vote-buttons' }, buttons),
      msg,
      h('h4', null, t('weatherTallies')),
      tallies,
    ),
    section(
      t('weatherHistory'),
      W.history.length
        ? table(
          [t('filterType'), t('col_days'), t('col_decided')],
          W.history.slice().reverse().map((x) => [name(x.type), t('fromToDays', { a: x.startDay + 1, b: x.endDay + 1 }), x.decidedBy ? t(`decided_${x.decidedBy}`) : '—']),
        )
        : emptyNote(t('weatherNoHistory')),
    ),
  );
}

export { statusChip, amountText };
