// 标签页（上）：实况、编年史、法典、居民、社群。每个渲染函数：(ctx, root) → 往 root 里填内容。

import { h, clear } from './dom.js';
import { t, getLang, CATEGORIES, CAT, colon } from './i18n.js';
import { api } from './api.js';
import {
  agentLink, placeLink, eventRow, statusChip, section, emptyNote, table, describeEffect, amountText, valueText, dayOfTick, dayTag,
} from './render.js';

const PLACE_ORDER = ['port', 'school', 'library', 'parliament', 'court', 'temple', 'agora', 'market', 'wilds', 'hospital', 'well', 'cemetery'];

// ── 实况 ──────────────────────────────────────────────────────

let liveList = null;
let liveFilter = { place: '', cat: '' };
const MAX_NODES = 500;

const matches = (e) => (!liveFilter.place || e.place === liveFilter.place) && (!liveFilter.cat || catOf(e) === liveFilter.cat);

const catOf = (e) => CAT[e.type] || 'world';

export function renderLive(ctx, root) {
  const placeSel = h(
    'select',
    { 'aria-label': t('filterPlace') },
    h('option', { value: '' }, `${t('filterPlace')}${colon()}${t('all')}`),
    PLACE_ORDER.map((id) => h('option', { value: id, selected: liveFilter.place === id }, ctx.placeName(id))),
  );
  const catSel = h(
    'select',
    { 'aria-label': t('filterType') },
    h('option', { value: '' }, `${t('filterType')}${colon()}${t('all')}`),
    CATEGORIES.map((c) => h('option', { value: c, selected: liveFilter.cat === c }, t(`cat_${c}`))),
  );
  liveList = h('ul', { class: 'feed', 'aria-live': 'polite' });
  const fill = () => {
    clear(liveList);
    const shown = ctx.S.events.filter(matches).slice(-MAX_NODES);
    for (let i = shown.length - 1; i >= 0; i--) liveList.append(eventRow(ctx, shown[i]));
    if (!liveList.firstChild) liveList.append(h('li', { class: 'empty' }, t('empty')));
  };
  placeSel.addEventListener('change', () => {
    liveFilter = { ...liveFilter, place: placeSel.value };
    fill();
  });
  catSel.addEventListener('change', () => {
    liveFilter = { ...liveFilter, cat: catSel.value };
    fill();
  });
  root.append(h('div', { class: 'toolbar' }, placeSel, catSel), liveList);
  fill();
}

/** 新事件到达（实况页可见时增量追加，最多保留 500 个节点） */
export function liveAppend(ctx, e) {
  if (!liveList || !liveList.isConnected || !matches(e)) return;
  if (liveList.firstChild && liveList.firstChild.classList.contains('empty')) clear(liveList);
  liveList.prepend(eventRow(ctx, e));
  while (liveList.childNodes.length > MAX_NODES) liveList.lastChild.remove();
}

// ── 编年史 ────────────────────────────────────────────────────

export async function renderChronicle(ctx, root) {
  root.append(h('p', { class: 'muted' }, t('loading')));
  const r = await api(`/api/public/chronicle?lang=${getLang()}`);
  clear(root);
  if (!r.ok) return root.append(h('p', { class: 'error' }, t('loadFailed')));
  const list = r.json.chronicle;
  if (list.length === 0) return root.append(emptyNote());
  for (let i = list.length - 1; i >= 0; i--) {
    root.append(h('article', { class: 'chron' }, h('h4', null, `D${list[i].day + 1}`), h('p', null, list[i].text)));
  }
}

// ── 法典 ──────────────────────────────────────────────────────

export function renderLaws(ctx, root) {
  const S = ctx.S.state;
  const lore = ctx.lore;

  // 物理定律
  root.append(section(t('physics'), h('ol', { class: 'physics' }, lore.physics.map((p) => h('li', null, h('strong', null, p.name), ' — ', p.text)))));

  // 法律参数
  const params = S.params;
  root.append(
    section(
      t('lawParams'),
      h(
        'dl',
        { class: 'kv' },
        Object.keys(lore.law.params).flatMap((k) => [h('dt', null, lore.law.params[k]), h('dd', null, valueText(ctx, lore.law, k, params[k]))]),
      ),
    ),
  );

  // 宪章
  const canon = S.charter.canonical;
  root.append(
    section(
      t('charter'),
      h('p', { class: 'muted' }, canon ? `${t('canonical')}${colon()}${lore.law.langNames[canon] || canon}` : t('noCanonical')),
      S.charter.articles.map((a) => charterArticle(ctx, a, canon)),
    ),
  );

  // 在效法律
  const active = S.laws.filter((l) => l.status === 'active');
  root.append(section(t('activeLaws'), active.length ? active.map((l) => lawCard(ctx, l)) : emptyNote(t('noLaws'))));

  // 进行中的提案
  const open = S.proposals.filter((p) => p.status === 'open');
  root.append(section(t('openProposals'), open.length ? open.map((p) => proposalCard(ctx, p)) : emptyNote(t('noProposals'))));

  // 历史
  const past = S.proposals.filter((p) => p.status !== 'open').reverse();
  const repealed = S.laws.filter((l) => l.status !== 'active');
  root.append(
    section(
      t('history'),
      past.map((p) => proposalCard(ctx, p, true)),
      repealed.map((l) => lawCard(ctx, l)),
      past.length + repealed.length === 0 ? emptyNote() : null,
    ),
  );
}

function charterArticle(ctx, a, canon) {
  const langNames = ctx.lore.law.langNames;
  const rows = Object.keys(a.versions).map((code) => h('li', { class: code === canon ? 'canon' : '' }, h('span', { class: 'lang-tag' }, langNames[code] || code), ' ', h('span', { lang: code }, a.versions[code])));
  return h(
    'details',
    { class: 'article' },
    h('summary', null, t('articleN', { n: a.n }), ' ', h('span', { class: `chip cs-${a.status}` }, t(`charterStatus_${a.status}`))),
    h('ul', { class: 'versions' }, rows),
    a.history.length ? h('ul', { class: 'article-history' }, a.history.map((x) => h('li', null, `${x.lawId}${x.lang ? ` · ${langNames[x.lang] || x.lang}` : ''}`))) : null,
  );
}

function effectList(ctx, effects, results) {
  if (!effects.length) return null;
  return h(
    'ul',
    { class: 'effects' },
    effects.map((e, i) => {
      const r = results && results[i];
      return h('li', { class: r && !r.ok ? 'fail' : '' }, describeEffect(ctx, e), r && !r.ok ? h('span', { class: 'chip' }, r.error && r.error.code ? r.error.code : t('failed', { msg: '' })) : null);
    }),
  );
}

function lawCard(ctx, l) {
  return h(
    'article',
    { class: `card law ${l.status !== 'active' ? 'inactive' : ''}` },
    h('h4', null, `${l.id} · `, h('span', { class: 'ai' }, l.title)),
    h('p', { class: 'ai' }, l.text),
    effectList(ctx, l.effects, l.results),
    h('p', { class: 'muted' }, t('enactedDay', { n: dayOfTick(l.enactedTick) + 1 }), l.status !== 'active' ? ` · ${t('repealed')}` : ''),
  );
}

function tallyBar(tally) {
  const total = Math.max(1, tally.yes + tally.no + (tally.abstain || 0));
  const seg = (cls, n) => {
    const s = h('span', { class: `seg ${cls}` });
    s.style.width = `${(n / total) * 100}%`;
    return s;
  };
  return h('span', { class: 'tally-bar', role: 'img', 'aria-label': `${t('tallyYes')} ${tally.yes} / ${t('tallyNo')} ${tally.no}` }, seg('yes', tally.yes), seg('no', tally.no), seg('abs', tally.abstain || 0));
}

function proposalCard(ctx, p, past = false) {
  const votes = p.votes || [];
  const tally = p.tally || { yes: 0, no: 0, abstain: 0 };
  const ticksLeft = Math.max(0, p.closesTick - ctx.S.state.world.tick);
  return h(
    'article',
    { class: `card proposal st-${p.status}` },
    h('h4', null, `${p.id} · `, h('span', { class: 'ai' }, p.title), p.governance ? h('span', { class: 'chip gov' }, t('governanceBadge')) : null),
    h('p', { class: 'ai' }, p.text),
    effectList(ctx, p.effects),
    h(
      'p',
      { class: 'muted' },
      `${t('proposer')}${colon()}`, p.proposer ? agentLink(ctx, p.proposer.id) : t('unknown'),
      ' · ', `${t('tallyYes')} ${tally.yes} / ${t('tallyNo')} ${tally.no} / ${t('tallyAbstain')} ${tally.abstain || 0}`,
      past ? ` · ${t(p.status === 'passed' ? 'passed' : 'rejected')}` : ` · ${t('ticksLeft', { n: ticksLeft })}`,
    ),
    tallyBar(tally),
    votes.length
      ? h(
        'details',
        { class: 'votes' },
        h('summary', null, `${votes.length} ${t('votes')}`),
        h('ul', null, votes.map((v) => h('li', null, v.agent ? agentLink(ctx, v.agent.id) : '?', ` ${v.choice}`, v.reason ? [' — ', h('span', { class: 'ai' }, v.reason)] : null))),
      )
      : null,
  );
}

// ── 居民 ──────────────────────────────────────────────────────

let resSort = { key: 'id', dir: 1 };
let resFilter = 'alive';

const ACT_NAMES = {
  zh: {
    move: '移动', say: '说话', whisper: '私语', broadcast: '宣告', give: '赠予', offer_open: '挂单', trade: '成交', offer_close: '撤单', remember: '记忆', forget: '遗忘',
    write: '著述', read: '阅读', define: '造词', propose: '提案', vote: '投票', found: '创立社群', join: '入会', leave: '退会', admit: '接纳', steward: '管事', disburse: '拨付',
    explore: '探索', repair: '修缮', initiate: '发起工程', contribute: '出工', draw: '汲取', inscribe: '铭刻', conceive: '孕育', epitaph: '写墓志', reveal: '出示家书',
    thought: '独白', arrive: '入城', born: '出生', dormant: '沉睡', revive: '醒来', death: '长眠', retire: '归隐',
  },
  en: {
    move: 'moved', say: 'said', whisper: 'whispered', broadcast: 'announced', give: 'gave', offer_open: 'posted offer', trade: 'traded', offer_close: 'closed offer', remember: 'remembered', forget: 'forgot',
    write: 'wrote', read: 'read', define: 'coined', propose: 'proposed', vote: 'voted', found: 'founded group', join: 'joined', leave: 'left', admit: 'admitted', steward: 'stewarded', disburse: 'disbursed',
    explore: 'explored', repair: 'repaired', initiate: 'started project', contribute: 'contributed', draw: 'drew', inscribe: 'inscribed', conceive: 'conceived', epitaph: 'epitaph', reveal: 'showed letter',
    thought: 'thought', arrive: 'arrived', born: 'born', dormant: 'fell dormant', revive: 'woke', death: 'died', retire: 'retired',
  },
};

export const actName = (type) => (ACT_NAMES[getLang()] || ACT_NAMES.zh)[type] || type;

export function renderResidents(ctx, root) {
  const S = ctx.S.state;
  const agents = S.agents.filter((a) => (resFilter === 'alive' ? a.status === 'awake' || a.status === 'dormant' : resFilter === 'all' ? true : a.status === resFilter));
  const cols = [
    ['id', t('col_name'), (a) => Number(a.id.slice(1))],
    ['gen', t('col_gen'), (a) => a.generation],
    ['age', t('col_age'), (a) => a.ageDays],
    ['status', t('col_status'), (a) => ['awake', 'dormant', 'retired', 'dead'].indexOf(a.status)],
    ['energy', t('col_energy'), (a) => a.energy],
    ['coins', t('col_coins'), (a) => a.coins],
    ['place', t('col_place'), (a) => (a.place ? PLACE_ORDER.indexOf(a.place) : 99)],
    ['groups', t('col_groups'), (a) => a.groups.length],
    ['last', t('col_last'), (a) => a.lastActTick ?? -1],
  ];
  const sorter = cols.find((c) => c[0] === resSort.key) || cols[0];
  agents.sort((a, b) => (sorter[2](a) - sorter[2](b)) * resSort.dir || Number(a.id.slice(1)) - Number(b.id.slice(1)));

  const filter = h(
    'select',
    { 'aria-label': t('col_status') },
    [['alive', `${t('status_awake')} + ${t('status_dormant')}`], ['awake', t('status_awake')], ['dormant', t('status_dormant')], ['dead', t('status_dead')], ['retired', t('status_retired')], ['all', t('all')]].map(([v, label]) => h('option', { value: v, selected: resFilter === v }, label)),
  );
  filter.addEventListener('change', () => {
    resFilter = filter.value;
    clear(root);
    renderResidents(ctx, root);
  });

  const head = cols.map(([key, label]) => {
    const b = h('button', { class: `th-sort ${resSort.key === key ? (resSort.dir > 0 ? 'asc' : 'desc') : ''}`.trim(), type: 'button' }, label);
    b.addEventListener('click', () => {
      resSort = { key, dir: resSort.key === key ? -resSort.dir : 1 };
      clear(root);
      renderResidents(ctx, root);
    });
    return b;
  });

  const rows = agents.map((a) => {
    const last = ctx.S.lastAct[a.id];
    return [
      h('span', null, agentLink(ctx, a.id), a.exiled ? h('span', { class: 'chip exile' }, t('exiled')) : null),
      a.generation,
      t('ageDays', { n: a.ageDays }),
      statusChip(a.status),
      a.energy,
      a.coins,
      a.place ? placeLink(ctx, a.place) : '—',
      a.groups.length ? a.groups.map((g) => h('span', { class: 'chip group-chip' }, ctx.groupName(g))) : '—',
      last ? `${actName(last.type)} · ${dayTag(last.tick)}` : '—',
    ];
  });
  root.append(h('div', { class: 'toolbar' }, filter, h('span', { class: 'muted' }, `${agents.length} / ${S.agents.length}`)));
  root.append(table(head, rows, 'residents'));
}

// ── 社群 ──────────────────────────────────────────────────────

export function renderGroups(ctx, root) {
  const groups = ctx.S.state.groups.filter((g) => !g.dissolved);
  const gone = ctx.S.state.groups.filter((g) => g.dissolved);
  if (groups.length === 0 && gone.length === 0) return root.append(emptyNote());
  const card = (g) => h(
    'article',
    { class: `card group ${g.dissolved ? 'inactive' : ''}` },
    h('h4', null, h('span', { class: 'ai' }, g.name), ' ', h('span', { class: 'chip' }, g.dissolved ? t('dissolved') : g.open ? t('open') : t('closed'))),
    h('p', { class: 'ai' }, g.manifesto),
    h('p', { class: 'muted' }, `${t('steward')}${colon()}`, g.steward ? agentLink(ctx, g.steward.id) : t('none'), ' · ', `${t('groupTreasury')}${colon()}${amountText(g.treasury)}`),
    h('p', null, `${t('members')} (${g.members.length})${colon()}`, g.members.map((m) => [agentLink(ctx, m.id), ' '])),
    g.pending.length ? h('p', { class: 'muted' }, `${t('pending')} (${g.pending.length})${colon()}`, g.pending.map((m) => [agentLink(ctx, m.id), ' '])) : null,
  );
  root.append(...groups.map(card), ...gone.map(card));
}

