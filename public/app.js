// 观测站主程序：状态、SSE、顶栏、地图、标签页、档案抽屉、弹窗。
// 首屏用 GET /api/public/state 取全量，之后用 SSE：事件增量追加；tick 事件携带精简状态，
// 其余数据在相关事件到达后按需重新拉取（防抖 1 秒）。所有 agent 文本都用 textContent 渲染。

import { h, clear, debounce, append } from './dom.js';
import { t, getLang, setLang, ADMIN_OPS, colon } from './i18n.js';
import { api, subscribe } from './api.js';
import { createMap } from './map.js';
import { renderLive, liveAppend, renderChronicle, renderLaws, renderResidents, renderGroups } from './tabs1.js';
import {
  renderEnvironment, renderLibrary, renderCemetery, renderMetrics, renderLegacy, renderWeather, openDoc as setOpenDoc, wallBlock,
} from './tabs2.js';
import { renderProfile } from './profile.js';
import { openEntry, openBackstage, openModal } from './modals.js';
import { pct, bandText, conditionBar, statusChip, section, table, clockConfig, SEASON_TABLE } from './render.js';

const TABS = [
  ['live', renderLive], ['chronicle', renderChronicle], ['laws', renderLaws], ['residents', renderResidents], ['groups', renderGroups],
  ['environment', renderEnvironment], ['library', renderLibrary], ['cemetery', renderCemetery], ['metrics', renderMetrics],
  ['legacy', renderLegacy], ['weather', renderWeather],
];

/** 展示 agent 所写文字的页面：标注「AI 生成内容」 */
const AI_TABS = new Set(['live', 'laws', 'groups', 'library', 'cemetery']);

/** 这些事件很频繁，且不改变需要整体重拉的数据 */
const QUIET = new Set(['say', 'move', 'whisper', 'broadcast', 'thought', 'remember', 'forget', 'read', 'omen']);
/** 带 agent 字段、能代表「最近行动」的事件 */
const NOT_ACTION = new Set(['day', 'month', 'omen', 'weather_start', 'weather_end', 'admin', 'redacted', 'great_sleep', 'letter_received']);

const S = {
  state: null,
  mapData: null, // GET /api/public/map：这个世界所用地图的静态数据
  lore: {},
  events: [],
  lastSeq: 0,
  lastAct: {},
  tick: null,
  connected: false,
  tab: 'live',
};

let agentIndex = new Map();
let groupIndex = new Map();
let placeIndex = new Map();
let map = null;
let sse = null;
const seen = new Set();
const sigs = {};
let drawerId = null;

const els = {};

// ── 上下文（各页共用） ────────────────────────────────────────

const ctx = {
  S,
  get lore() {
    return S.lore[getLang()] || S.lore.zh || null;
  },
  agent: (id) => agentIndex.get(id),
  agentName: (id) => (agentIndex.get(id) ? agentIndex.get(id).name : String(id)),
  groupName: (id) => (groupIndex.get(id) ? groupIndex.get(id).name : String(id)),
  placeName(id) {
    const p = placeIndex.get(id);
    if (p && p.renamedBy) return p.name;
    const lore = ctx.lore;
    return lore && lore.place[id] ? lore.place[id].name : id;
  },
  /** 地点的顺序：按地图定义（边疆地图按街区排列） */
  placeOrder() {
    if (S.mapData) return S.mapData.places.map((p) => p.id);
    return S.state ? S.state.places.map((p) => p.id) : [];
  },
  districtName(id) {
    const lore = ctx.lore;
    return id && lore && lore.district && lore.district[id] ? lore.district[id] : id || '';
  },
  cityName() {
    const w = S.state.world;
    return w.cityName === w.humanCityName.zh ? w.humanCityName[getLang()] : w.cityName;
  },
  adminOp: (op) => (ADMIN_OPS[getLang()] || ADMIN_OPS.zh)[op] || op,
  openAgent,
  openPlace,
  openDoc(id) {
    setOpenDoc(id);
    closeDrawer();
    selectTab('library');
  },
  refresh: () => refreshNow(),
};

// ── 启动 ──────────────────────────────────────────────────────

async function boot() {
  document.documentElement.lang = getLang();
  for (const id of ['city', 'clock', 'countdown', 'pop', 'treasury', 'well', 'weather', 'conn', 'btn-enter', 'btn-back', 'btn-lang', 'map', 'tabs', 'panel', 'banner', 'color-mode', 'color-label', 'foot', 'drawer', 'status', 'map-zoom-in', 'map-zoom-out', 'map-fit', 'map-legend']) {
    els[id] = document.getElementById(id);
  }
  wireStatic();
  applyLabels();
  const first = location.hash.slice(1);
  if (TABS.some((x) => x[0] === first)) S.tab = first;
  renderTabBar();
  showStatus(t('loading'));
  await Promise.all([loadLore(getLang()), loadLore(getLang() === 'zh' ? 'en' : 'zh')]);
  const ok = (await loadState()) && (await loadMap());
  if (!ok) return;
  await loadEvents();
  initMap();
  applyState();
  connect();
  setInterval(updateCountdown, 500);
  setInterval(() => {
    if (S.dirty) refreshNow();
  }, 20000);
  showStatus('');
}

function showStatus(text, retry) {
  clear(els.status);
  if (!text) {
    els.status.hidden = true;
    return;
  }
  els.status.hidden = false;
  els.status.append(text);
  if (retry) {
    const b = h('button', { class: 'btn small', type: 'button' }, t('retry'));
    b.addEventListener('click', retry);
    els.status.append(' ', b);
  }
}

function wireStatic() {
  els['btn-enter'].addEventListener('click', () => openEntry(ctx));
  els['btn-back'].addEventListener('click', () => openBackstage(ctx));
  els['btn-lang'].addEventListener('click', async () => {
    setLang(getLang() === 'zh' ? 'en' : 'zh');
    await loadLore(getLang());
    relabel();
  });
  els['color-mode'].addEventListener('change', () => map && map.setColorMode(els['color-mode'].value));
  els['map-zoom-in'].addEventListener('click', () => map && map.zoomIn());
  els['map-zoom-out'].addEventListener('click', () => map && map.zoomOut());
  els['map-fit'].addEventListener('click', () => map && map.fit());
  els.tabs.addEventListener('keydown', (ev) => {
    const idx = TABS.findIndex((x) => x[0] === S.tab);
    let next = idx;
    if (ev.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (ev.key === 'ArrowLeft') next = (idx + TABS.length - 1) % TABS.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = TABS.length - 1;
    else return;
    ev.preventDefault();
    selectTab(TABS[next][0]);
    els.tabs.children[next].focus();
  });
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (id !== S.tab && TABS.some((x) => x[0] === id)) selectTab(id, false);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && drawerId) closeDrawer();
  });
}

/** 静态文字（按钮、页脚、着色选项） */
function applyLabels() {
  document.documentElement.lang = getLang();
  els['btn-enter'].textContent = t('enter');
  els['btn-back'].textContent = t('backstage');
  els['btn-lang'].textContent = t('langSwitch');
  els.foot.textContent = `${t('aiContent')} · ${t('keyboardHint')}`;
  for (const o of els['color-mode'].options) o.textContent = t(o.value === 'script' ? 'colorScript' : 'colorGroup');
  els['color-mode'].setAttribute('aria-label', t('colorBy'));
  els['color-label'].textContent = t('colorBy');
  els.tabs.setAttribute('aria-label', t('tabs'));
  els.map.setAttribute('aria-label', t('map'));
  els['map-zoom-in'].setAttribute('aria-label', t('zoomIn'));
  els['map-zoom-in'].title = t('zoomIn');
  els['map-zoom-out'].setAttribute('aria-label', t('zoomOut'));
  els['map-zoom-out'].title = t('zoomOut');
  els['map-fit'].textContent = t('fitMap');
  renderLegend();
  updateConn();
}

/** 地图的图例（隧道只在有隧道的地图上列出） */
function renderLegend() {
  clear(els['map-legend']);
  const items = [['flame', 'legend_agent'], ['', 'legend_road'], ['broken', 'legend_broken'], ['planned', 'legend_planned']];
  if (S.mapData && S.mapData.terrain && S.mapData.terrain.tunnels && S.mapData.terrain.tunnels.length) items.push(['tunnel', 'legend_tunnel']);
  items.push(['ruin', 'legend_ruin']);
  for (const [key, label] of items) els['map-legend'].append(h('li', null, h('span', { class: `key ${key}`.trim(), 'aria-hidden': 'true' }), t(label)));
}

/** 切换语言后：静态文字、顶栏、地图与标签页全部重画 */
function relabel() {
  applyLabels();
  renderTabBar();
  if (S.state) {
    initMap();
    applyState({ force: true });
    if (drawerId) openAgent(drawerId);
  }
}

// ── 数据 ──────────────────────────────────────────────────────

async function loadLore(lang) {
  if (S.lore[lang]) return;
  const r = await api(`/api/public/lore?lang=${lang}`);
  if (r.ok) S.lore[lang] = r.json;
}

/** 地图的静态数据（世界创建后不再变化，只取一次） */
async function loadMap() {
  if (S.mapData) return true;
  const r = await api('/api/public/map');
  if (!r.ok) {
    showStatus(t('loadFailed'), async () => {
      if (await loadMap()) {
        await loadEvents();
        initMap();
        applyState();
        connect();
        showStatus('');
      }
    });
    return false;
  }
  S.mapData = r.json;
  renderLegend();
  return true;
}

async function loadState() {
  const r = await api('/api/public/state');
  if (!r.ok) {
    showStatus(t('loadFailed'), async () => {
      const ok = (await loadState()) && (await loadMap());
      if (ok) {
        await loadEvents();
        initMap();
        applyState();
        connect();
        showStatus('');
      }
    });
    return false;
  }
  S.state = r.json;
  S.dirty = false;
  clockConfig.ticksPerDay = S.state.world.ticksPerDay;
  indexState();
  return true;
}

function indexState() {
  agentIndex = new Map(S.state.agents.map((a) => [a.id, a]));
  groupIndex = new Map(S.state.groups.map((g) => [g.id, g]));
  placeIndex = new Map(S.state.places.map((p) => [p.id, p]));
}

/** 分页取回环形缓冲里的事件（最多 8 页 × 500 条） */
async function loadEvents(since = S.lastSeq) {
  let cursor = since;
  for (let page = 0; page < 8; page++) {
    const r = await api(`/api/public/events?since=${cursor}&limit=500`);
    if (!r.ok) break;
    for (const e of r.json.events) ingest(e, { live: false });
    if (r.json.events.length < 500) {
      cursor = Math.max(cursor, r.json.last);
      break;
    }
    cursor = r.json.last;
  }
  S.lastSeq = Math.max(S.lastSeq, cursor);
}

const refreshNow = debounce(async () => {
  if (await loadState()) applyState();
}, 1000);

// ── 事件 ──────────────────────────────────────────────────────

/** 收下一条事件；返回是否是新事件 */
function ingest(e, { live }) {
  const key = `${e.seq}${e.delayed ? 'd' : ''}`;
  if (seen.has(key)) return false;
  seen.add(key);
  if (seen.size > 6000) {
    for (const k of [...seen].slice(0, 2000)) seen.delete(k);
  }
  if (!e.delayed) S.lastSeq = Math.max(S.lastSeq, e.seq);
  S.events.push(e);
  if (S.events.length > 2500) S.events.splice(0, S.events.length - 2000);
  if (e.agent && !NOT_ACTION.has(e.type) && !e.delayed) S.lastAct[e.agent] = { type: e.type, tick: e.tick };
  if (live) {
    liveAppend(ctx, e);
    if (map) map.onEvent(e);
    if (!QUIET.has(e.type)) refreshNow();
    else S.dirty = true;
    if (e.type === 'great_sleep' || (e.type === 'admin' && e.data && e.data.op === 'curtain')) refreshNow();
  }
  return true;
}

function connect() {
  if (sse) sse.close();
  sse = subscribe({
    open: async () => {
      S.connected = true;
      updateConn();
      if (S.state) {
        await loadEvents();
        refreshNow();
      }
    },
    error: () => {
      S.connected = false;
      updateConn();
    },
    e: (e) => ingest(e, { live: true }),
    tick: onTick,
  });
}

function onTick(data) {
  S.tick = data;
  if (S.state) {
    for (const x of data.agents) {
      const a = agentIndex.get(x.id);
      if (a) {
        a.place = x.place;
        a.energy = x.energy;
        a.status = x.status;
      }
    }
    S.state.treasury = data.treasury;
    const well = placeIndex.get('well');
    if (well) well.condition = data.well.condition;
    S.state.world.tick = data.tick;
    S.state.world.day = data.day;
    S.state.world.nextTickAt = data.nextTickAt;
  }
  if (map) map.setTick(data);
  renderTopbar();
}

// ── 顶栏 ──────────────────────────────────────────────────────

function updateConn() {
  els.conn.textContent = S.connected ? '●' : '○';
  els.conn.className = `conn ${S.connected ? 'on' : 'off'}`;
  els.conn.title = S.connected ? t('connected') : t('disconnected');
}

function pop() {
  const c = { awake: 0, dormant: 0, dead: 0 };
  for (const a of S.state.agents) if (a.status === 'awake') c.awake++; else if (a.status === 'dormant') c.dormant++; else if (a.status === 'dead') c.dead++;
  return c;
}

function renderTopbar() {
  const s = S.state;
  if (!s) return;
  const w = s.world;
  const lore = ctx.lore;
  const city = ctx.cityName();
  els.city.textContent = city;
  els.city.title = w.cityName === w.humanCityName.zh ? '' : t('humanCalled', { name: w.humanCityName[getLang()] });
  document.title = `${t('title')} · ${city}`;
  const tick = S.tick ? S.tick.tick : w.tick;
  const day = Math.floor(tick / w.ticksPerDay);
  els.clock.textContent = t('clock', { epoch: w.epoch, month: Math.floor(day / w.daysPerMonth) + 1, day: (day % w.daysPerMonth) + 1, tick: (tick % w.ticksPerDay) + 1 });
  const c = pop();
  els.pop.textContent = t('population', c);
  els.treasury.textContent = `${t('treasury')} ${s.treasury.energy}`;
  const well = placeIndex.get('well');
  const hist = s.well.outputHistory;
  const cond = well ? well.condition : 0;
  // 季节档位（≥ 1100 丰，900–1099 平，< 900 歉）：由日序号在月中的位置查季节表
  const dayOfMonth = day % w.daysPerMonth;
  const permille = SEASON_TABLE[dayOfMonth % SEASON_TABLE.length];
  const seasonKey = permille >= 1100 ? 'abundant' : permille >= 900 ? 'ordinary' : 'lean';
  clear(els.well);
  els.well.append(
    h('span', { class: 'lbl' }, t('well')), ' ', conditionBar(cond), ` ${pct(cond)}`,
    h('small', { class: 'muted' }, ` · ${t('wellOutput', { n: hist.length ? hist[hist.length - 1] : '—' })} · ${t('season')} ${lore ? lore.season[seasonKey] : ''}`),
  );
  clear(els.weather);
  if (s.weather.active.length === 0) els.weather.append(h('span', { class: 'chip muted' }, t('weatherNone')));
  for (const x of s.weather.active) els.weather.append(h('span', { class: `chip wx wx-${x.type}` }, lore ? lore.weather[x.type] || x.type : x.type));
  // 横幅：暂停 / 大沉睡 / 谢幕
  const banner = [];
  if (w.paused) banner.push(t(w.day >= w.daysPerMonth * w.monthsPerEpoch ? 'great_sleep_banner' : 'paused'));
  if (w.revealed) banner.push(t('curtainRaised'));
  els.banner.hidden = banner.length === 0;
  els.banner.textContent = banner.join(' · ');
  updateCountdown();
}

function updateCountdown() {
  if (!S.state) return;
  const w = S.state.world;
  if (w.paused) {
    els.countdown.textContent = t('paused');
    return;
  }
  const next = S.tick ? S.tick.nextTickAt : w.nextTickAt;
  if (!next) {
    els.countdown.textContent = '';
    return;
  }
  const s = Math.max(0, Math.ceil((next - Date.now()) / 1000));
  els.countdown.textContent = s > 0 ? t('nextTick', { s }) : t('nextTickSoon');
}

// ── 地图 ──────────────────────────────────────────────────────

function initMap() {
  if (!S.mapData) return;
  map = createMap(els.map, {
    mapData: S.mapData,
    worldId: S.state ? S.state.world.id : '',
    placeName: (id) => ctx.placeName(id),
    humanName: (id) => (ctx.lore ? ctx.lore.place[id].name : id),
    districtName: (id) => ctx.districtName(id),
    agentName: (id) => ctx.agentName(id),
    onAgent: (id) => openAgent(id),
    onPlace: (id) => openPlace(id),
  });
  map.setColorMode(els['color-mode'].value);
}

// ── 应用状态 ──────────────────────────────────────────────────

function signature(tab, s) {
  switch (tab) {
    case 'laws': return JSON.stringify([s.params, s.charter, s.laws, s.proposals, s.world.tick]);
    case 'residents': return JSON.stringify(s.agents.map((a) => [a.id, a.status, a.energy, a.coins, a.place, a.groups.length, a.lastActTick, a.ageDays]));
    case 'groups': return JSON.stringify(s.groups);
    case 'environment': return JSON.stringify([s.places, s.well, s.wilds, s.regions, s.weather.active, s.world.dayOfMonth]);
    case 'library': return `${s.docs.length}:${s.lexicon.length}:${s.docs.reduce((n, d) => n + d.reads, 0)}`;
    case 'cemetery': return `${s.cemetery.length}:${s.retired.length}:${s.unborn.length}:${s.cemetery.reduce((n, g) => n + g.epitaphs.length, 0)}`;
    case 'legacy': return s.legacy ? String(s.legacy.day) : '';
    case 'weather': return JSON.stringify(s.weather);
    case 'metrics': return s.metrics ? String(s.metrics.day) : '';
    case 'chronicle': return String(s.chronicle.length ? s.chronicle[s.chronicle.length - 1].day : -1);
    default: return '';
  }
}

function applyState({ force = false } = {}) {
  const s = S.state;
  renderTopbar();
  if (map) map.setState(s);
  const sig = signature(S.tab, s);
  if (force || sigs[S.tab] !== sig || S.tab === 'live') {
    // 实况页是增量的：只在首次或强制时重画
    if (force || sigs[S.tab] === undefined || S.tab !== 'live') renderTab({ keepScroll: !force });
    sigs[S.tab] = sig;
  }
}

// ── 标签页 ────────────────────────────────────────────────────

function renderTabBar() {
  clear(els.tabs);
  TABS.forEach(([id]) => {
    const b = h('button', { class: 'tab', role: 'tab', id: `tab-${id}`, type: 'button', 'aria-selected': String(id === S.tab), 'aria-controls': 'panel', tabindex: id === S.tab ? 0 : -1 }, t(`tab_${id}`));
    b.addEventListener('click', () => selectTab(id));
    els.tabs.append(b);
  });
  els.panel.setAttribute('aria-labelledby', `tab-${S.tab}`);
}

function selectTab(id, updateHash = true) {
  S.tab = id;
  renderTabBar();
  if (updateHash) {
    try {
      history.replaceState(null, '', `#${id}`);
    } catch {
      // 忽略
    }
  }
  if (S.state) {
    sigs[id] = signature(id, S.state);
    renderTab({ keepScroll: false });
  }
}

function renderTab({ keepScroll = false } = {}) {
  if (!S.state || !ctx.lore) return;
  const top = els.panel.scrollTop;
  clear(els.panel);
  const box = h('div', { class: 'tabbox' });
  els.panel.append(box);
  if (AI_TABS.has(S.tab)) box.append(h('p', { class: 'ai-note' }, t('aiNote')));
  const fn = TABS.find((x) => x[0] === S.tab)[1];
  try {
    const r = fn(ctx, box);
    if (r && typeof r.catch === 'function') r.catch((err) => box.append(h('p', { class: 'error' }, `${t('loadFailed')}: ${err && err.message}`)));
  } catch (err) {
    box.append(h('p', { class: 'error' }, `${t('loadFailed')}: ${err && err.message}`));
  }
  if (keepScroll) els.panel.scrollTop = top;
}

// ── 档案抽屉与地点弹窗 ────────────────────────────────────────

function closeDrawer() {
  drawerId = null;
  els.drawer.hidden = true;
  clear(els.drawer);
}

async function openAgent(id) {
  drawerId = id;
  els.drawer.hidden = false;
  clear(els.drawer);
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('close') }, '×');
  closeBtn.addEventListener('click', closeDrawer);
  const body = h('div', { class: 'drawer-body' }, h('p', { class: 'muted' }, t('loading')));
  els.drawer.append(h('header', { class: 'drawer-head' }, h('strong', null, t('profile')), closeBtn), body);
  const r = await api(`/api/public/agents/${encodeURIComponent(id)}`);
  if (drawerId !== id) return;
  clear(body);
  if (!r.ok) {
    body.append(h('p', { class: 'error' }, t('loadFailed')));
    return;
  }
  try {
    body.append(renderProfile(ctx, r.json));
  } catch (err) {
    body.append(h('p', { class: 'error' }, `${t('loadFailed')}: ${err && err.message}`));
  }
}

function openPlace(id) {
  const p = placeIndex.get(id);
  const lore = ctx.lore;
  if (!p || !lore) return;
  const m = openModal(ctx.placeName(id), 'wide');
  const here = S.state.agents.filter((a) => a.place === id && (a.status === 'awake' || a.status === 'dormant'));
  const region = (S.state.regions || []).find((r) => r.id === id);
  const words = S.state.world.map === 'classic' ? lore.richness : lore.richnessWild || lore.richness;
  append(m.body, [
    p.district ? h('p', { class: 'muted' }, `${t('col_district')}${colon()}${ctx.districtName(p.district)}`) : null,
    h('p', null, lore.place[id].desc),
    region
      ? h('p', null, `${t('richness')}${colon()}${words[region.richness] || region.richness} · ${t('wildsEnergy')} ${region.energy}/${region.energyMax} · ${t('wildsCoins')} ${region.coins} · ${t('relicsFound')} ${region.relicsFound}/${region.relics}`)
      : p.condition === null ? h('p', { class: 'muted' }, t('fx_open')) : h('p', null, `${t('condition')}${colon()}`, conditionBar(p.condition), ` ${pct(p.condition)} · ${bandText(ctx, p.condition, id === 'well')}`),
    section(`${t('col_place')} (${here.length})`, here.length ? h('ul', { class: 'plain inline' }, here.map((a) => h('li', null, h('button', { class: 'link', type: 'button', onClick: () => { m.close(); openAgent(a.id); } }, a.name), ' ', statusChip(a.status)))) : h('p', { class: 'empty' }, t('empty'))),
    p.inscriptions.length ? section(t('walls'), wallBlock(ctx, p)) : null,
    p.facilities.length || p.projects.length
      ? section(
        `${t('facilities')} / ${t('projects')}`,
        table(
          [t('col_name'), t('filterType'), t('condition')],
          [
            ...p.facilities.map((f) => [f.name, lore.facility[f.type] || f.type, `${pct(f.condition)}${f.ruined ? ` · ${t('ruined')}` : ''}`]),
            ...p.projects.map((j) => [j.name, lore.facility[j.type] || j.type, `${j.have}/${j.need}`]),
          ],
        ),
      )
      : null,
  ]);
}

boot();

