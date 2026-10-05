// 第二纪观测站的标签页（SPEC-E2 §21）：法典、居民、社群、环境、摇篮与躯壳、指标。
// 实况、编年史、典籍、墓园、遗产、天象沿用第一纪的页面（数据形状相同）。每个渲染函数：(ctx, root) → 往 root 里填内容。
// 所有居民写下的文字（法律的标题与正文、志、介绍、社群的宣言……）一律经 ai() / textContent 渲染，规则的「引擎读法」是系统文本。

import { h, clear, ai } from './dom.js';
import { t, getLang, colon } from './i18n.js';
import { lineChart } from './charts.js';
import { api } from './api.js';
import {
  agentLink, placeLink, section, emptyNote, table, conditionBar, progressBar, bandText, pct, spark, statusChip, amountText, dayOfTick, dayTag,
} from './render.js';
import { renderLive, renderChronicle, actName as actName1 } from './tabs1.js';
import { renderLibrary, renderCemetery, renderLegacy, renderWeather, wallBlock } from './tabs2.js';

const lc = (o) => (o && (o[getLang()] ?? o.zh)) || '';
const clipText = (s, n) => {
  const cps = [...String(s)];
  return cps.length > n ? `${cps.slice(0, n - 1).join('')}…` : cps.join('');
};
const ownerText = (ctx, o) => {
  if (!o || o.kind === 'city') return t('owner_city');
  if (o.kind === 'group') return t('owner_group', { name: ctx.groupName(o.id) });
  return t('owner_agent', { name: ctx.agentName(o.id) });
};

// 「最近行动」一列：事件类型 → 动作名（第一纪已有的沿用 tabs1.js）。第二纪新增的事件类型在这里补
const ACT2 = {
  zh: {
    initiate: '发起工程', dismantle: '拆解', razed: '拆尽', sponsor: '出资', declare: '立志', rules: '订立规则', bylaws: '订立章程', place_rules: '订立地点规则', propose: '提案',
    refound_open: '发起重订', refound_sign: '联署', pact_open: '发起孕育之约', soul: '写下灵魂', successor: '传灯', embodied: '醒来', cede: '让渡地点', seize: '收归地点', petition: '上书', announce: '宣告',
    group_procedure: '改社群的程序', rule_op: '规则', draft: '试算',
  },
  en: {
    initiate: 'started a project', dismantle: 'dismantled', razed: 'razed', sponsor: 'sponsored', declare: 'declared a purpose', rules: 'set rules', bylaws: 'set bylaws', place_rules: 'set place rules', propose: 'proposed',
    refound_open: 'started a refounding', refound_sign: 'signed', pact_open: 'offered a conception pact', soul: 'wrote a soul', successor: 'left a successor', embodied: 'woke', cede: 'ceded a place', seize: 'seized a place', petition: 'petitioned', announce: 'announced',
    group_procedure: 'changed a group procedure', rule_op: 'rule', draft: 'drafted',
  },
};
const actName = (type) => (ACT2[getLang()] || ACT2.zh)[type] || actName1(type);

/** 第二纪的标签页：id → 渲染函数（app.js 在第二纪的城里用它代替第一纪的标签页列表） */
export const TABS2 = [
  ['live', renderLive], ['chronicle', renderChronicle], ['laws', renderLaws2], ['residents', renderResidents2], ['groups', renderGroups2],
  ['environment', renderEnvironment2], ['cradle', renderCradle], ['library', renderLibrary], ['cemetery', renderCemetery], ['metrics', renderMetrics2],
  ['legacy', renderLegacy], ['weather', renderWeather],
];

/** 第二纪各页的内容签名：数据没变时不必重画（app.js 的 signature 在第二纪里调用它） */
export function signature2(tab, s) {
  switch (tab) {
    case 'laws': return JSON.stringify([s.vars, s.procedure, s.charter, s.laws.map((l) => [l.id, l.status, l.suspendedDays, l.suspended]), s.proposals.map((p) => [p.id, p.status, p.tally, p.votes.length]), s.refounds.map((r) => [r.id, r.status, r.signers.length]), s.groups.map((g) => g.bylaws && g.bylaws.setTick), s.petitions.length, s.world.tick]);
    case 'residents': return JSON.stringify(s.agents.map((a) => [a.id, a.status, a.energy, a.coins, a.place, a.groups.length, a.lastActTick, a.ageDays, a.tags.length, a.purpose]));
    case 'groups': return JSON.stringify(s.groups);
    case 'environment': return JSON.stringify([s.places.map((p) => [p.id, p.condition, p.salvage && p.salvage.left, p.modules.length, p.owner, p.razed, p.name]), s.lots, s.projects.map((j) => [j.id, j.have]), s.well, s.regions, s.weather.active, s.world.dayOfMonth]);
    case 'cradle': return JSON.stringify([s.shells, s.cradle.map((c) => [c.id, c.fund, c.queued, c.queuePosition]), s.unborn.length, s.agents.length]);
    case 'library': return `${s.docs.length}:${s.lexicon.length}:${s.docs.reduce((n, d) => n + d.reads, 0)}`;
    case 'cemetery': return `${s.cemetery.length}:${s.retired.length}:${s.unborn.length}:${s.cemetery.reduce((n, g) => n + g.epitaphs.length, 0)}`;
    case 'legacy': return s.legacy ? String(s.legacy.day) : '';
    case 'weather': return JSON.stringify(s.weather);
    case 'metrics': return s.metrics ? String(s.metrics.day) : '';
    case 'chronicle': return String(s.chronicle.length ? s.chronicle[s.chronicle.length - 1].day : -1);
    default: return '';
  }
}

// ── 法典 ──────────────────────────────────────────────────────

/** 一部法律的作者：人类 / 居民 / 自动回退 / 重订 */
function authorOf(ctx, a) {
  if (a === 'humans') return h('span', { class: 'chip' }, t('authorHumans'));
  if (a === 'revert') return h('span', { class: 'chip' }, t('authorRevert'));
  if (typeof a === 'string' && a.startsWith('refound:')) return h('span', { class: 'chip' }, t('authorRefound', { id: a.slice(8) }));
  return a && a.id ? agentLink(ctx, a.id) : '?';
}

/** 引擎读法：{ rules: [...] } 或 { procedure: { ordinary?, constitutional? } }（已按语言取出） */
function readingBlock(reading) {
  if (!reading) return null;
  if (reading.procedure) {
    return h('ul', { class: 'reading' }, ['ordinary', 'constitutional'].filter((c) => reading.procedure[c]).map((c) => h('li', null, h('strong', null, `${t(`proc_${c}`)}${colon()}`), reading.procedure[c])));
  }
  const rules = reading.rules || [];
  if (rules.length === 0) return null;
  return h('ol', { class: 'reading' }, rules.map((x) => h('li', null, x)));
}

const jsonBlock = (label, value) => (value && (Array.isArray(value) ? value.length : Object.keys(value).length)
  ? h('details', { class: 'json-details' }, h('summary', null, label), h('pre', { class: 'json' }, JSON.stringify(value, null, 2)))
  : null);

/** 一部城法的卡片：标题、正文、引擎读法、规则 JSON（可折叠）、指纹、作者、停摆天数 */
function lawCard2(ctx, l) {
  const lang = getLang();
  const title = l.i18n ? l.i18n[lang].title : l.title;
  const text = l.i18n ? l.i18n[lang].text : l.text;
  const inactive = l.status !== 'active';
  return h(
    'article',
    { class: `card law ${inactive ? 'inactive' : ''}`.trim() },
    h('h4', null, `${l.id} · `, l.i18n ? title : ai(title), ' ', h('span', { class: `chip ls-${l.status}` }, t(`lawStatus_${l.status}`)), l.procedure ? h('span', { class: 'chip' }, t('lawIsProcedure')) : null, l.suspended ? h('span', { class: 'chip warn' }, t('suspendedChip')) : null),
    text ? (l.i18n ? h('p', null, text) : h('p', { class: 'ai' }, text)) : null,
    readingBlock(l.reading && (l.reading[lang] || l.reading.zh)),
    h(
      'p',
      { class: 'muted' },
      `${t('lawAuthor')}${colon()}`, authorOf(ctx, l.author),
      ` · ${t('enactedDay', { n: dayOfTick(l.enactedTick) + 1 })}`,
      l.suspendedDays > 0 ? ` · ${t('suspendedDays', { n: l.suspendedDays })}` : '',
      l.basedOn ? ` · ${t('basedOn', { id: l.basedOn })}` : '',
      l.repealedBy ? ` · ${t('repealedBy', { id: l.repealedBy })}` : '',
      l.replacedBy ? ` · ${t('replacedBy', { id: l.replacedBy })}` : '',
    ),
    l.fingerprints && l.fingerprints.length ? h('p', { class: 'muted fp' }, `${t('fingerprints')}${colon()}`, l.fingerprints.map((f) => h('code', null, `${f.slice(0, 8)} `))) : null,
    l.results && l.results.length ? h('p', { class: 'muted' }, `${t('enactResults')}${colon()}${l.results.map((r) => `${r.op}${r.ok ? '✓' : '✗'}`).join(' ')}`) : null,
    jsonBlock(t('ruleJson'), l.procedure || l.rules),
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

function proposalCard2(ctx, p, past = false) {
  const lang = getLang();
  const tally = p.tally || { yes: 0, no: 0, abstain: 0 };
  const ticksLeft = Math.max(0, p.closesTick - ctx.S.state.world.tick);
  const kindLabel = p.kind && p.kind !== 'law' ? t(`pkind_${p.kind}`) : null;
  const votes = p.votes || [];
  return h(
    'article',
    { class: `card proposal st-${p.status}` },
    h('h4', null, `${p.id} · `, ai(p.title), ' ', h('span', { class: `chip cls-${p.class}` }, t(`proc_${p.class}`)), kindLabel ? h('span', { class: 'chip' }, kindLabel) : null, p.scope && p.scope !== 'city' ? h('span', { class: 'chip group-chip' }, ctx.groupName(p.scope.replace(/^group:/, ''))) : null),
    p.text ? h('p', { class: 'ai' }, p.text) : null,
    readingBlock(p.reading && (p.reading[lang] || p.reading.zh)),
    h(
      'p',
      { class: 'muted' },
      `${t('proposer')}${colon()}`, p.proposer ? agentLink(ctx, p.proposer.id) : t('unknown'),
      ` · ${t('votersN', { n: p.voters })}`,
      ` · ${t('tallyYes')} ${tally.yes} / ${t('tallyNo')} ${tally.no} / ${t('tallyAbstain')} ${tally.abstain || 0}`,
      past ? ` · ${t(p.status === 'passed' ? 'passed' : p.status === 'void' ? 'voided' : 'rejected')}` : ` · ${t('ticksLeft', { n: ticksLeft })}`,
      p.secret ? ` · ${t('secretBallot')}` : ` · ${t('openBallot')}`,
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

/** 重订需要的联署数：入城满 3 日的在世居民的三分之二（向上取整） */
function refoundNeeded(ctx) {
  const alive = ctx.S.state.agents.filter((a) => (a.status === 'awake' || a.status === 'dormant') && a.ageDays >= 3).length;
  return alive > 0 ? Math.ceil((2 * alive) / 3) : null;
}

function refoundCard(ctx, r) {
  const lang = getLang();
  const needed = refoundNeeded(ctx);
  const bar = progressBar(r.signers.length, needed || Math.max(1, r.signers.length));
  const reading = r.reading && (r.reading[lang] || r.reading.zh);
  return h(
    'article',
    { class: `card refound st-${r.status}` },
    h('h4', null, `${r.id} · `, t('refoundBy'), ' ', r.by ? agentLink(ctx, r.by.id) : '?', ' ', h('span', { class: 'chip' }, t(`refoundStatus_${r.status}`))),
    r.text ? h('p', { class: 'ai' }, r.text) : null,
    h('p', { class: 'muted' }, t('refoundProgress', { n: r.signers.length, need: needed ?? '?' }), ' ', bar, ` · ${t('ticksLeft', { n: Math.max(0, r.expiresTick - ctx.S.state.world.tick) })}`),
    reading ? h('ul', { class: 'reading' }, Object.entries(reading).map(([c, text]) => h('li', null, h('strong', null, `${t(`proc_${c}`)}${colon()}`), text))) : null,
    r.signers.length ? h('p', null, `${t('signers')}${colon()}`, r.signers.map((s) => [agentLink(ctx, s.id), ' '])) : null,
  );
}

function charterArticle(ctx, a, canon) {
  const langNames = ctx.lore.law ? ctx.lore.law.langNames : {};
  const rows = Object.keys(a.versions).map((code) => h('li', { class: code === canon ? 'canon' : '' }, h('span', { class: 'lang-tag' }, (langNames && langNames[code]) || code), ' ', h('span', { lang: code }, a.versions[code])));
  return h(
    'details',
    { class: 'article' },
    h('summary', null, t('articleN', { n: a.n }), ' ', h('span', { class: `chip cs-${a.status}` }, t(`charterStatus_${a.status}`))),
    h('ul', { class: 'versions' }, rows),
    a.history.length ? h('ul', { class: 'article-history' }, a.history.map((x) => h('li', null, `${x.lawId}${x.lang ? ` · ${x.lang}` : ''}`))) : null,
  );
}

export function renderLaws2(ctx, root) {
  const S = ctx.S.state;
  const lore = ctx.lore;
  const lang = getLang();
  if (S.ruleDiagnostics?.length) root.append(section(
    lang === 'en' ? 'Recent runtime errors in active laws' : '有效法律的最近运行错误',
    h('p', { class: 'muted' }, lang === 'en' ? 'Historical diagnostics; an active law may still fail to execute.' : '以下为历史诊断；法律仍有效不代表其规则执行成功。'),
    ...S.ruleDiagnostics.map(e => h('p', { class: 'error' }, `${e.owner} · rules[${e.rule}] · tick ${e.tick} · ${e.code}: ${e.detail}`)),
  ));

  // 物理：自然律与守护律（附录 A.3）
  const physics = S.world.premise >= 1 ? lore.physicsP1 : lore.physics;
  root.append(
    section(
      t('physics'),
      ...['natural', 'guardian'].filter((k) => physics[k]).map((k) => h('div', { class: 'physics-group' }, h('h4', null, physics[k].title), h('ol', { class: 'physics' }, physics[k].items.map((x) => h('li', null, x))))),
    ),
  );

  // 变量
  const vars = Object.entries(S.vars || {});
  root.append(section(t('lawVars'), vars.length ? h('dl', { class: 'kv' }, vars.flatMap(([k, v]) => [h('dt', null, h('code', null, k)), h('dd', null, v === null ? 'null' : typeof v === 'string' ? ai(v) : String(v))])) : emptyNote()));

  // 宪章
  const canon = S.charter.canonical;
  root.append(
    section(
      t('charter'),
      h('p', { class: 'muted' }, canon ? `${t('canonical')}${colon()}${canon}` : t('noCanonical')),
      S.charter.articles.map((a) => charterArticle(ctx, a, canon)),
    ),
  );

  // 现行的立法程序与它的变迁史
  const procs = ['ordinary', 'constitutional'];
  const history = S.laws.filter((l) => l.procedure).sort((a, b) => a.enactedTick - b.enactedTick);
  root.append(
    section(
      t('procedure'),
      h('dl', { class: 'kv' }, procs.flatMap((c) => [
        h('dt', null, t(`proc_${c}`)),
        h('dd', null, h('span', { class: 'chip' }, S.procedure[c].lawId), ' ', S.procedure[c].reading[lang] || S.procedure[c].reading.zh || t('procNone')),
      ])),
      h('h4', null, t('procHistory')),
      h('ol', { class: 'plain proc-history' }, history.map((l) => h('li', null, `${l.id} · `, l.i18n ? l.i18n[lang].title : ai(l.title), ' · ', procs.filter((c) => l.procedure[c]).map((c) => t(`proc_${c}`)).join('/'), ' · ', t(`lawStatus_${l.status}`), ' · ', t('enactedDay', { n: dayOfTick(l.enactedTick) + 1 }), ' · ', authorOf(ctx, l.author)))),
    ),
  );

  // 在效的城法：遗法与后人之法分开
  const active = S.laws.filter((l) => l.status === 'active' && !l.procedure);
  const human = active.filter((l) => l.author === 'humans');
  const heirs = active.filter((l) => l.author !== 'humans');
  root.append(
    section(t('lawsHuman'), human.length ? human.map((l) => lawCard2(ctx, l)) : emptyNote(t('noLaws'))),
    section(t('lawsHeirs'), heirs.length ? heirs.slice().reverse().map((l) => lawCard2(ctx, l)) : emptyNote(t('noLaws'))),
  );

  // 进行中的提案、重订
  const open = S.proposals.filter((p) => p.status === 'open');
  root.append(section(t('openProposals'), open.length ? open.map((p) => proposalCard2(ctx, p)) : emptyNote(t('noProposals'))));
  const refounds = S.refounds.filter((r) => r.status === 'open');
  root.append(section(t('refoundsOpen'), refounds.length ? refounds.map((r) => refoundCard(ctx, r)) : emptyNote(t('noRefounds'))));

  // 社群章程与地点规则
  const bylaws = S.groups.filter((g) => g.bylaws && !g.dissolved);
  root.append(
    section(
      t('bylawsSection'),
      bylaws.length
        ? bylaws.map((g) => h(
          'article',
          { class: 'card' },
          h('h4', null, h('span', { class: 'chip group-chip' }, ai(g.name)), ' ', g.bylaws.suspended ? h('span', { class: 'chip warn' }, t('suspendedChip')) : null),
          readingBlock(g.bylaws.reading[lang] || g.bylaws.reading.zh),
          h('p', { class: 'muted' }, `${t('setBy')}${colon()}`, g.bylaws.setBy ? agentLink(ctx, g.bylaws.setBy.id) : '—', ` · ${t('groupProcedure', { p: t(`gproc_${g.procedure}`) })}`),
          jsonBlock(t('ruleJson'), g.bylaws.rules),
        ))
        : emptyNote(),
    ),
  );
  const placeRules = S.places.filter((p) => p.rules);
  root.append(
    section(
      t('placeRulesSection'),
      placeRules.length
        ? placeRules.map((p) => h(
          'article',
          { class: 'card' },
          h('h4', null, placeLink(ctx, p.id), ' ', h('span', { class: 'chip' }, ownerText(ctx, p.owner)), p.rules.suspended ? h('span', { class: 'chip warn' }, t('suspendedChip')) : null),
          readingBlock(p.rules.reading[lang] || p.rules.reading.zh),
          h('p', { class: 'muted' }, `${t('setBy')}${colon()}`, p.rules.setBy ? agentLink(ctx, p.rules.setBy.id) : '—'),
          jsonBlock(t('ruleJson'), p.rules.rules),
        ))
        : emptyNote(),
    ),
  );

  // 上书
  root.append(
    section(
      t('petitions'),
      S.petitions.length ? h('ul', { class: 'plain' }, S.petitions.slice().reverse().map((p) => h('li', null, h('span', { class: 'muted' }, `${p.lawId} · D${p.day + 1} `), ai(p.text)))) : emptyNote(),
    ),
  );

  // 历史：已结束的提案、被撤销或取代的法律
  const past = S.proposals.filter((p) => p.status !== 'open').reverse();
  const gone = S.laws.filter((l) => l.status !== 'active').reverse();
  root.append(
    section(
      t('history'),
      past.map((p) => proposalCard2(ctx, p, true)),
      gone.map((l) => lawCard2(ctx, l)),
      past.length + gone.length === 0 ? emptyNote() : null,
    ),
  );
}

// ── 居民 ──────────────────────────────────────────────────────

let resSort = { key: 'id', dir: 1 };
let resFilter = 'alive';

export function renderResidents2(ctx, root) {
  const S = ctx.S.state;
  const agents = S.agents.filter((a) => (resFilter === 'alive' ? a.status === 'awake' || a.status === 'dormant' : resFilter === 'all' ? true : a.status === resFilter));
  const order = ctx.placeOrder();
  const cols = [
    ['id', t('col_name'), (a) => Number(a.id.slice(1))],
    ['purpose', t('col_purpose'), (a) => (a.purpose ? 1 : 0)],
    ['tags', t('col_tags'), (a) => a.tags.length],
    ['gen', t('col_gen'), (a) => a.generation],
    ['age', t('col_age'), (a) => a.ageDays],
    ['status', t('col_status'), (a) => ['awake', 'dormant', 'retired', 'dead'].indexOf(a.status)],
    ['energy', t('col_energy'), (a) => a.energy],
    ['coins', t('col_coins'), (a) => a.coins],
    ['place', t('col_place'), (a) => (a.place ? order.indexOf(a.place) : 999)],
    ['groups', t('col_groups'), (a) => a.groups.length],
    ['last', t('col_last'), (a) => a.lastActTick ?? -1],
  ];
  const sorter = cols.find((c) => c[0] === resSort.key) || cols[0];
  agents.sort((a, b) => (sorter[2](a) - sorter[2](b)) * resSort.dir || Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const rerender = () => {
    clear(root);
    renderResidents2(ctx, root);
  };
  const filter = h(
    'select',
    { 'aria-label': t('col_status') },
    [['alive', `${t('status_awake')} + ${t('status_dormant')}`], ['awake', t('status_awake')], ['dormant', t('status_dormant')], ['dead', t('status_dead')], ['retired', t('status_retired')], ['all', t('all')]].map(([v, label]) => h('option', { value: v, selected: resFilter === v }, label)),
  );
  filter.addEventListener('change', () => {
    resFilter = filter.value;
    rerender();
  });
  const head = cols.map(([key, label]) => {
    const b = h('button', { class: `th-sort ${resSort.key === key ? (resSort.dir > 0 ? 'asc' : 'desc') : ''}`.trim(), type: 'button' }, label);
    b.addEventListener('click', () => {
      resSort = { key, dir: resSort.key === key ? -resSort.dir : 1 };
      rerender();
    });
    return b;
  });
  const rows = agents.map((a) => {
    const last = ctx.S.lastAct[a.id];
    return [
      agentLink(ctx, a.id),
      a.purpose ? h('span', { class: 'ai purpose' }, clipText(a.purpose, 30)) : '—',
      a.tags.length ? a.tags.map((x) => h('span', { class: `chip tag${x === 'exiled' ? ' exile' : ''}` }, x)) : '—',
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

export function renderGroups2(ctx, root) {
  const lang = getLang();
  const groups = ctx.S.state.groups.filter((g) => !g.dissolved);
  const gone = ctx.S.state.groups.filter((g) => g.dissolved);
  if (groups.length === 0 && gone.length === 0) return root.append(emptyNote());
  const card = (g) => h(
    'article',
    { class: `card group ${g.dissolved ? 'inactive' : ''}` },
    h('h4', null, h('span', { class: 'ai' }, g.name), ' ', h('span', { class: 'chip' }, g.dissolved ? t('dissolved') : g.open ? t('open') : t('closed')), h('span', { class: 'chip' }, t(`gproc_${g.procedure}`))),
    h('p', { class: 'ai' }, g.manifesto),
    h('p', { class: 'muted' }, `${t('steward')}${colon()}`, g.steward ? agentLink(ctx, g.steward.id) : t('none'), ' · ', `${t('groupTreasury')}${colon()}${amountText(g.treasury)}`),
    h('p', null, `${t('members')} (${g.members.length})${colon()}`, g.members.map((m) => [agentLink(ctx, m.id), ' '])),
    g.pending.length ? h('p', { class: 'muted' }, `${t('pending')} (${g.pending.length})${colon()}`, g.pending.map((m) => [agentLink(ctx, m.id), ' '])) : null,
    g.bylaws ? h('div', null, h('h5', null, t('bylawsSection'), g.bylaws.suspended ? h('span', { class: 'chip warn' }, t('suspendedChip')) : null), readingBlock(g.bylaws.reading[lang] || g.bylaws.reading.zh)) : null,
    Object.keys(g.vars || {}).length ? h('p', { class: 'muted' }, `${t('lawVars')}${colon()}${Object.entries(g.vars).map(([k, v]) => `${k} = ${v}`).join('；')}`) : null,
  );
  root.append(...groups.map(card), ...gone.map(card));
}

// ── 环境 ──────────────────────────────────────────────────────

function modulesOf(ctx, p) {
  const names = (ctx.lore && ctx.lore.module) || {};
  return p.modules.length
    ? p.modules.map((m) => h('span', { class: `chip mod${m.functioning ? '' : ' off'}${m.inherent ? ' inherent' : ''}`, title: m.inherent ? t('moduleInherent') : t('moduleBuilt') }, (names[m.type] && names[m.type].name) || m.type))
    : '—';
}

function wellPanel2(ctx) {
  const S = ctx.S.state;
  const well = S.places.find((p) => p.id === 'well');
  const hist = S.well.outputHistory;
  const outChart = hist.length > 1
    ? lineChart({ series: [{ name: t('s_output'), points: hist.map((v, i) => [S.world.day - hist.length + 1 + i, v]), color: 0 }], height: 140, ariaLabel: t('outputHistory') })
    : null;
  return section(
    t('wellPanel'),
    h(
      'dl',
      { class: 'kv' },
      h('dt', null, t('condition')), h('dd', null, h('span', { class: 'cond' }, conditionBar(well.condition), ` ${pct(well.condition)} · ${bandText(ctx, well.condition, true)}`)),
      h('dt', null, t('wellOutput', { n: hist.length ? hist[hist.length - 1] : '—' })), h('dd', null, `${t('drawPool')}${colon()}${S.well.drawPoolLeft}`),
    ),
    outChart ? h('div', { class: 'charts' }, h('figure', null, outChart, h('figcaption', null, t('outputHistory')))) : null,
  );
}

export function renderEnvironment2(ctx, root) {
  const S = ctx.S.state;
  const lore = ctx.lore;
  root.append(wellPanel2(ctx));

  // 地点：人类的与后人开辟的（含遗址）
  const order = ctx.placeOrder();
  const placesSorted = S.places.slice().sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib) || a.id.localeCompare(b.id);
  });
  const trend = (p) => {
    const hst = p.history || [];
    if (p.condition === null || hst.length < 2) return '—';
    const d = hst[hst.length - 1] - hst[0];
    const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '＝';
    return h('span', { class: `trend ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`.trim() }, spark(hst), ` ${arrow} ${(Math.abs(d) / 100).toFixed(1)}`);
  };
  root.append(
    section(
      t('places'),
      table(
        [t('col_name'), t('col_origin'), t('condition'), t('trend7'), t('col_modules'), t('col_salvage'), t('col_owner'), t('col_gate')],
        placesSorted.map((p) => [
          h('span', null, placeLink(ctx, p.id), p.razed ? h('span', { class: 'chip razed' }, t('razedChip')) : null, p.renamedBy && p.humanName ? h('small', { class: 'muted' }, ` (${lc(p.humanName)})`) : null),
          t(`origin_${p.origin}`),
          p.condition === null ? '—' : h('span', { class: 'cond' }, conditionBar(p.condition), ` ${pct(p.condition)}`),
          trend(p),
          modulesOf(ctx, p),
          p.salvage ? h('span', { class: 'cond' }, progressBar(p.salvage.left, p.salvage.max), ` ${p.salvage.left}/${p.salvage.max}`) : '—',
          p.razed ? '—' : ownerText(ctx, p.owner),
          p.gate ? (p.gate.functioning ? t('gateOn') : t('gateOff')) : '—',
        ]),
        'places',
      ),
    ),
  );

  // 空地块
  const lots = S.lots || [];
  const lotDefs = new Map(((ctx.S.mapData && ctx.S.mapData.lots) || []).map((l) => [l.id, l]));
  const projectOf = new Map(S.projects.map((j) => [j.id, j]));
  root.append(
    section(
      `${t('lotsSection')} (${lots.filter((l) => l.place === null && l.project === null).length}/${lots.length})`,
      lots.length
        ? table(
          [t('col_lot'), t('col_district'), t('col_status')],
          lots.map((l) => {
            const j = l.project ? projectOf.get(l.project) : null;
            const def = lotDefs.get(l.id);
            return [
              l.id,
              def ? ctx.districtName(def.district) : '—',
              l.place ? h('span', null, t('lotBuilt'), ' ', placeLink(ctx, l.place)) : j ? h('span', { class: 'cond' }, `${t('lotBuilding')} `, progressBar(j.have, j.need), ` ${j.have}/${j.need}`) : t('lotFree'),
            ];
          }),
          'lots',
        )
        : emptyNote(),
    ),
  );

  // 工程：按种类（开辟 / 加装 / 修路）分类
  const projects = S.projects;
  const detail = (j) => {
    if (j.build === 'site') return j.lot ? `${t('on')} ${j.lot}` : j.on ? h('span', null, t('onRuin'), ' ', placeLink(ctx, j.on)) : '';
    if (j.build === 'module') return (lore.module[j.module] && lore.module[j.module].name) || j.module;
    return j.to ? h('span', null, '→ ', placeLink(ctx, j.to)) : '';
  };
  root.append(
    section(
      t('projects'),
      projects.length
        ? table(
          [t('col_name'), t('filterType'), t('col_detail'), t('col_place'), t('builtBy'), t('progress'), ''],
          projects.slice().sort((a, b) => a.build.localeCompare(b.build) || a.id.localeCompare(b.id)).map((j) => [
            j.name ? ai(j.name) : j.module ? ((lore.module[j.module] && lore.module[j.module].name) || j.module) : '—',
            t(`build_${j.build}`),
            detail(j),
            placeLink(ctx, j.place),
            ownerText(ctx, j.owner),
            h('span', { class: 'cond' }, progressBar(j.have, j.need), ` ${j.have}/${j.need}`),
            t('expires', { n: j.expiresDay + 1 }),
          ]),
        )
        : emptyNote(),
    ),
  );

  // 拆解的记录：最近的拆解与遗址
  const log = ctx.S.events.filter((e) => e.type === 'dismantle' || e.type === 'razed').slice(-12).reverse();
  root.append(
    section(
      t('dismantleLog'),
      log.length
        ? h('ul', { class: 'plain' }, log.map((e) => h('li', null, e.type === 'razed'
          ? [h('span', { class: 'muted' }, `D${e.day + 1} `), placeLink(ctx, e.data.place), ` ${t('dismantleRazed')}`]
          : [h('span', { class: 'muted' }, `D${e.day + 1} `), agentLink(ctx, e.data.agent), ' · ', placeLink(ctx, e.data.place), ` · ${t('energyN', { n: e.data.energy })}`, e.data.module ? ` · ${(lore.module[e.data.module] && lore.module[e.data.module].name) || e.data.module}` : '', ` · ${t('salvageLeft', { n: e.data.salvageLeft })}`])))
        : emptyNote(),
    ),
  );

  // 墙上的铭刻
  const walls = S.places.filter((p) => p.inscriptions.length > 0);
  root.append(section(t('walls'), walls.length ? walls.map((p) => wallBlock(ctx, p)) : emptyNote()));

  // 荒野五地带
  const regions = S.regions || [];
  const words = lore.richnessWild || {};
  root.append(
    section(
      t('regions'),
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

// ── 摇篮与躯壳 ────────────────────────────────────────────────

export function renderCradle(ctx, root) {
  const S = ctx.S.state;
  const lore = ctx.lore;
  const sh = S.shells;
  const day = S.world.day;

  // 躯壳
  root.append(
    section(
      t('shellsSection'),
      h('p', { class: 'ai-free' }, S.world.premise >= 1 ? lore.shellsP1 : lore.shells),
      h(
        'dl',
        { class: 'kv' },
        h('dt', null, t('shellsFree')), h('dd', null, h('span', { class: 'cond' }, progressBar(sh.free, sh.total), ` ${sh.free} / ${sh.total}`)),
        h('dt', null, t('shellsUsed')), h('dd', null, String(sh.used)),
        h('dt', null, t('shellsLiving')), h('dd', null, String(sh.living)),
        h('dt', null, t('shellCost')), h('dd', null, t('energyN', { n: sh.cost })),
      ),
      sh.queue.length
        ? h('div', null, h('h4', null, t('shellQueue')), h('ol', { class: 'plain' }, sh.queue.map((q) => h('li', null, ai(q.name), ` · ${t('queueFunded', { n: q.fundedDay + 1 })} · ${t('queueExpires', { n: q.queueExpiresDay + 1 })}`))))
        : null,
    ),
  );

  if (S.world.premise >= 1) root.append(section(
    t('bodies'),
    table([t('bodyId'), t('bodyOccupant'), t('bodyVacant'), t('bodyTrained')],
      sh.bodies.map((b) => [b.id, b.occupant ? agentLink(ctx, b.occupant.id) : '—', b.vacantSince === null ? '—' : String(b.vacantSince + 1), String(b.trainedCount)]), 'p1-bodies'),
  ));

  // 摇篮里的灵魂
  const souls = S.cradle;
  root.append(
    section(
      `${t('cradleSection')} (${souls.length})`,
      souls.length
        ? souls.map((c) => h(
          'article',
          { class: 'card soul-card' },
          h('h4', null, ai(c.name), ' ', c.queued ? h('span', { class: 'chip good' }, t('queuePosition', { n: c.queuePosition })) : null, c.successorOf ? h('span', { class: 'chip' }, t('successorSoul')) : null),
          h('p', { class: 'muted' }, `${t('soulAuthors')}${colon()}`, c.authors.map((a) => (a ? [agentLink(ctx, a.id), ' '] : '?')), ` · ${t('generation', { n: c.generation })} · ${t('expiresIn', { n: Math.max(0, c.expiresDay - day) })}`),
          h('p', { class: 'soul' }, ai(c.soul)),
          h('p', null, t('fundProgress', { have: c.fund, need: sh.cost }), ' ', progressBar(Math.min(c.fund, sh.cost), sh.cost)),
          Object.keys(c.sponsors).length ? h('p', { class: 'muted' }, `${t('sponsors')}${colon()}`, Object.entries(c.sponsors).map(([who, n]) => [who === 'treasury' ? t('treasury') : who.startsWith('g') ? h('span', { class: 'chip group-chip' }, ctx.groupName(who)) : agentLink(ctx, who), ` ${n} `])) : null,
        ))
        : emptyNote(t('cradleEmpty')),
    ),
  );

  // 最近醒来的躯壳居民
  const woke = ctx.S.events.filter((e) => e.type === 'embodied').slice(-10).reverse();
  root.append(
    section(
      t('recentEmbodied'),
      woke.length ? h('ul', { class: 'plain' }, woke.map((e) => h('li', null, h('span', { class: 'muted' }, `D${e.day + 1} `), agentLink(ctx, e.data.agentId), ` · ${t('fromSoul', { id: e.data.soulId })}`))) : emptyNote(),
    ),
  );

  // 未生者名录
  root.append(
    section(
      `${t('unbornList')} (${S.unborn.length})`,
      S.unborn.length ? h('ul', { class: 'plain' }, S.unborn.map((u) => h('li', null, ai(u.name), u.authors && u.authors.length ? [' · ', u.authors.map((p) => [agentLink(ctx, p), ' '])] : null, u.fadedDay !== undefined ? ` · ${t('fadedOn', { n: u.fadedDay + 1 })}` : ''))) : emptyNote(t('noUnborn')),
    ),
  );
}

// ── 指标 ──────────────────────────────────────────────────────

export async function renderMetrics2(ctx, root) {
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
  const c = (series, o = {}) => lineChart({ series, height: 190, xLabel: 'D', ...o });
  root.append(h('p', { class: 'muted' }, getLang() === 'en'
    ? 'Scheduled law payments include actual daily/monthly transfers and shares from the city treasury to residents, averaged over living residents. Repair subsidies are shown separately. Historical balances are unchanged.'
    : '日结法律拨款按公库每日／每月规则实际转账、均分金额统计，人均值按在世居民计算；修缮等其他法律拨款另列。历史余额不变。'));
  root.append(two(
    fig(getLang() === 'en' ? 'Scheduled payments per living resident' : '日结法律拨款／在世居民', c([{ name: getLang() === 'en' ? 'Actual payments' : '实际拨款', points: pts('rationPerCapita'), color: 2 }])),
    fig(getLang() === 'en' ? 'Treasury payments by law' : '公库法律拨款', c([
      { name: getLang() === 'en' ? 'Scheduled' : '日结拨款', points: pts('dailyDistributionEnergy'), color: 2 },
      { name: getLang() === 'en' ? 'Other' : '其他拨款', points: pts('otherLawPaymentsEnergy'), color: 3 },
    ])),
  ));
  root.append(
    two(
      fig(t('m_population'), c([{ name: t('s_awake'), points: pts('awake'), color: 0 }, { name: t('s_dormant'), points: pts('dormant'), color: 3 }])),
      fig(t('m_well'), c([{ name: t('s_condition'), points: pts('wellCondition', 0.01), color: 1 }, { name: t('s_output'), points: pts('output'), axis: 'right', color: 2 }], { yMax: 100 })),
    ),
    two(
      fig(t('m_treasury'), c([{ name: t('treasury'), points: pts('treasuryEnergy'), color: 4 }])),
      fig(t('m_gini'), c([{ name: 'Gini', points: pts('gini'), color: 5 }], { yMax: 1 })),
    ),
    two(
      fig(t('m_rules'), c([{ name: t('s_rulesActive'), points: pts('rulesActive'), color: 5 }, { name: t('s_upkeep'), points: pts('upkeepPaid'), axis: 'right', color: 3 }])),
      fig(t('m_ruleHealth'), c([{ name: t('s_suspended'), points: pts('lawsSuspended'), color: 3 }, { name: t('s_ruleErrors'), points: pts('ruleErrors'), axis: 'right', color: 0 }])),
    ),
    two(
      fig(t('m_builtShare'), c([{ name: t('m_builtShare'), points: pts('agentBuiltShare'), color: 2 }], { yMax: 1, yFormat: rate })),
      fig(t('m_salvage'), c([{ name: t('s_salvageLeft'), points: pts('salvageLeft'), color: 4 }, { name: t('s_razed'), points: pts('razed'), axis: 'right', color: 3 }])),
    ),
    two(
      fig(t('m_shells'), c([{ name: t('s_shellsUsed'), points: pts('shellsUsed'), color: 1 }, { name: t('s_shellQueue'), points: pts('shellQueue'), color: 3 }])),
      fig(t('m_purpose'), c([{ name: t('m_purpose'), points: pts('purposeShare'), color: 2 }], { yMax: 1, yFormat: rate })),
    ),
    two(
      fig(t('m_invest'), c([{ name: t('m_invest'), points: pts('publicInvestmentRate'), color: 1 }], { yMax: 1, yFormat: rate })),
      fig(t('m_freerider'), c([{ name: t('m_freerider'), points: pts('freeRiderShare'), color: 3 }], { yMax: 1, yFormat: rate })),
    ),
    two(
      fig(t('m_curtain'), c([{ name: t('m_curtain'), points: pts('humanAuthoredShare'), color: 2 }], { yMax: 1, yFormat: rate })),
      fig(t('m_births'), c([{ name: t('s_birthsSolo'), points: pts('birthsSolo'), color: 0 }, { name: t('s_birthsPair'), points: pts('birthsPair'), color: 1 }, { name: t('s_birthsGroup'), points: pts('birthsGroup'), color: 2 }])),
    ),
    two(
      fig(t('m_coins'), c([{ name: t('s_volume'), points: pts('coinVolume'), color: 0 }, { name: t('s_price'), points: pts('coinPrice'), axis: 'right', color: 3 }])),
      fig(t('m_laws'), c([{ name: t('m_laws'), points: pts('lawsActive'), color: 5 }])),
    ),
  );
  // 第二前提：注意力与自动化（SPEC-P2 §14.4）：每次醒来的轮数、看的次数、每位居民被叫醒的次数（来自 /api/public/attention，只有平均数），以及常驻指令
  if (ctx.S.state && ctx.S.state.world && ctx.S.state.world.premise >= 2) {
    // TODO(spec): Q43 — 路径拼起来写：原有的 test/ui.test.js 会扫描前端里所有 /api/… 字面量，并要求它们在 premise 0 的世界里不是 404，而这个接口按 §14.2 在别的世界里就是 404
    const a = await api(`${['/api', 'public', 'attention'].join('/')}?days=30`);
    const days = a.ok && Array.isArray(a.json.days) ? a.json.days.filter((d) => d.residents > 0) : [];
    const att = (key) => days.map((d, i) => [i + 1, d[key]]);
    root.append(h('h3', { class: 'attention-title' }, t('m_attentionTitle')), h('p', { class: 'muted' }, t('m_attentionNote')));
    if (days.length) {
      root.append(two(
        fig(t('m_turnsPerWaking'), c([{ name: t('m_turnsPerWaking'), points: att('turnsPerWaking'), color: 0 }], { xLabel: '' })),
        fig(t('m_looksPerWaking'), c([{ name: t('m_looksPerWaking'), points: att('looksPerWaking'), color: 1 }], { xLabel: '' })),
      ));
    } else root.append(emptyNote(t('m_noAttention')));
    root.append(two(
      days.length ? fig(t('m_wakesPerResident'), c([{ name: t('m_wakesPerResident'), points: att('wakesPerResident'), color: 2 }], { xLabel: '' })) : h('div'),
      fig(t('m_standing'), c([{ name: t('s_standingOrders'), points: pts('standingOrders'), color: 4 }, { name: t('s_standingFired'), points: pts('standingFired'), axis: 'right', color: 3 }])),
    ));
  }
}
