import { mountLatestAnnouncement } from './announcement-preview.js';
import { renderCooperation } from './cooperation-ui.js';
import { renderMaterialsMarket } from './materials-ui.js';
// 观测站主程序：状态、SSE、顶栏、地图、标签页、档案抽屉、弹窗。
// 首屏用 GET /api/public/state 取全量，之后用 SSE：事件增量追加；tick 事件携带精简状态，
// 其余数据在相关事件到达后按需重新拉取（防抖 1 秒）。所有 agent 文本都用 textContent 渲染。

import { initAccounts, refreshAccount } from './accounts.js';
import { h, clear, debounce, append } from './dom.js';
import { t, getLang, setLang, setPremise, ADMIN_OPS, colon } from './i18n.js';
import { api, subscribe } from './api.js';
import { createMap } from './map.js';
import { renderLive, liveAppend, refreshLive, LIVE_KEEP, renderChronicle, renderLaws, renderResidents, renderGroups } from './tabs1.js';
import {
  renderEnvironment, renderLibrary, renderCemetery, renderMetrics, renderLegacy, renderWeather, openDoc as setOpenDoc, wallBlock,
} from './tabs2.js';
import { renderProfile } from './profile.js';
import { openEntry, openBackstage, openModal } from './modals.js';
import { TABS2, signature2, updateTokenCity } from './e2-tabs.js';
import { createMap2 } from './e2-map.js';
import { renderProfile2, openPlace2 } from './e2-profile.js';
import { pct, bandText, conditionBar, statusChip, section, table, clockConfig, SEASON_TABLE, topTitle } from './render.js';

const TABS = [
  ['live', renderLive], ['chronicle', renderChronicle], ['laws', renderLaws], ['residents', renderResidents], ['groups', renderGroups],
  ['environment', renderEnvironment], ['library', renderLibrary], ['cemetery', renderCemetery], ['metrics', renderMetrics],
  ['legacy', renderLegacy], ['weather', renderWeather],
];

/** 第二纪的城用 TABS2（e2-tabs.js），第一纪的城用 TABS；读到状态之后才知道是哪一纪 */
let tabsNow = TABS;
const isE2 = () => !!(S.state && S.state.world.physics === 2);

/** 展示 agent 所写文字的页面：标注「AI 生成内容」 */
const AI_TABS = new Set(['live', 'laws', 'groups', 'library', 'cemetery', 'cradle']);

/** 这些事件很频繁，且不改变需要整体重拉的数据 */
const QUIET = new Set(['say', 'move', 'whisper', 'broadcast', 'thought', 'remember', 'forget', 'read', 'omen', 'rule_op', 'rule_error']);
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
  // 第七前提「三城」：raw 是服务器给的原始状态，state 是按地图聚焦的城（focus，null 为全岛）叠出来的
  raw: null,
  focus: null,
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
let announcementPreview;

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
    if (p && p.displayName) return p.displayName[getLang()] || p.displayName.zh; // 第二纪：后人开辟的、遗址的名字随语言
    if (p && p.renamedBy) return p.name;
    const lore = ctx.lore;
    return lore && lore.place[id] ? lore.place[id].name : id;
  },
  /** 地点的顺序：按地图定义（边疆地图按街区排列） */
  placeOrder() {
    if (S.mapData) {
      const base = S.mapData.places.map((p) => p.id);
      return isE2() ? [...base, ...S.state.places.map((p) => p.id).filter((id) => !base.includes(id))] : base; // 第二纪：后人开辟的地点排在人类的之后
    }
    return S.state ? S.state.places.map((p) => p.id) : [];
  },
  districtName(id) {
    const lore = ctx.lore;
    return id && lore && lore.district && lore.district[id] ? lore.district[id] : id || '';
  },
  cityName() {
    const w = S.state.world;
    if (!w.humanCityName) return w.cityName || t('islandAll'); // 第七前提的全岛级没有单一的城名
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

// ── 第七前提「三城」：页面跟着地图聚焦的城走 ──────────────────────

/** 网址的 hash：`#标签页`，第七前提可带 `&city=north`（也可以只有 `#city=north`） */
function parseHash() {
  let tab = null;
  let city = null;
  for (const part of location.hash.slice(1).split('&')) {
    if (part.startsWith('city=')) city = part.slice(5) || null;
    else if (part) tab = part;
  }
  return { tab, city };
}
const hashFor = (tab) => `#${tab}${S.focus ? `&city=${S.focus}` : ''}`;

/**
 * 聚焦一座城时，把那座城的城名、公库、源井、法律、提案、重订、请愿、天象、编年史叠到顶层，现有的渲染器照常用；
 * 全岛时顶层是服务器给的合计（法律与提案摊平、各带 city）。典籍、交易所等共享的部分始终是全世界的。
 */
function scopeState(raw, focus) {
  if (!raw || !raw.cities) return raw;
  const c = focus ? raw.cities.find((x) => x.id === focus) : null;
  if (!c) return raw;
  return {
    ...raw,
    world: { ...raw.world, cityName: c.cityName, humanCityName: c.humanName, focus: c.id },
    treasury: c.treasury,
    well: c.well,
    vars: c.vars,
    procedure: c.procedure,
    charter: c.charter,
    laws: c.laws,
    proposals: c.proposals,
    refounds: c.refounds,
    petitions: c.petitions,
    weather: { ...c.weather, omens: raw.weather && raw.weather.omens },
    chronicle: c.chronicle,
    tokens: { ...(raw.tokens || {}), ...(c.tokens || {}) },
  };
}

function setFocus(city) {
  if (!S.raw || !S.raw.cities) return;
  const next = city && S.raw.cities.some((c) => c.id === city) ? city : null;
  if (next === S.focus) return;
  S.focus = next;
  S.state = scopeState(S.raw, S.focus);
  try {
    history.replaceState(null, '', hashFor(S.tab));
  } catch {
    // 忽略
  }
  renderCityJump();
  applyState({ force: true });
}

/** 地图工具条上的「全岛 / 北城 / 西城 / 东城」；有了它就不要「全图」 */
function renderCityJump() {
  let box = document.getElementById('city-jump');
  const cities = S.mapData && S.mapData.cities;
  const byHome = els['color-mode'].querySelector('option[value="domicile"]');
  if (byHome) byHome.hidden = !cities; // 「按籍」着色只在三城的世界里有
  if (!cities) {
    if (box) box.remove();
    els['map-fit'].hidden = false;
    return;
  }
  if (!box) {
    box = h('span', { id: 'city-jump', class: 'city-jump', role: 'group' });
    document.querySelector('.map-tools').prepend(box);
  }
  clear(box);
  box.setAttribute('aria-label', t('cityJump'));
  const lang = getLang() === 'en' ? 'en' : 'zh';
  for (const [id, label] of [[null, t('islandAll')], ...cities.map((c) => [c.id, (c.short && (c.short[lang] || c.short.zh)) || c.id])]) {
    const b = h('button', { class: `btn small${id ? ` city-${id}` : ''}`, type: 'button', 'aria-pressed': String(S.focus === id) }, label);
    b.addEventListener('click', () => {
      if (!map) return;
      if (id) map.focusCity(id);
      else map.focusIsland();
    });
    box.append(b);
  }
  els['map-fit'].hidden = true;
}

// ── 启动 ──────────────────────────────────────────────────────

async function boot() {
  document.documentElement.lang = getLang();
  for (const id of ['city', 'clock', 'countdown', 'pop', 'treasury', 'well', 'weather', 'conn', 'btn-enter', 'btn-back', 'btn-lang', 'map', 'tabs', 'panel', 'banner', 'color-mode', 'color-label', 'foot', 'drawer', 'status', 'map-zoom-in', 'map-zoom-out', 'map-fit', 'map-legend', 'side-toggle', 'map-fullscreen']) {
    els[id] = document.getElementById(id);
  }
  initAccounts(document.getElementById('btn-account'), ctx);
  announcementPreview = mountLatestAnnouncement(document.getElementById('latest-announcement'));
  window.addEventListener('pagehide', event => { if (!event.persisted) announcementPreview.dispose(); });
  window.addEventListener('pageshow', event => { if (event.persisted) announcementPreview.refresh(); });
  wireStatic();
  applyLabels();
  const { tab: first, city: firstCity } = parseHash();
  S.focus = firstCity;
  if (TABS.some((x) => x[0] === first)) S.tab = first;
  renderTabBar();
  showStatus(t('loading'));
  await Promise.all([loadLore(getLang()), loadLore(getLang() === 'zh' ? 'en' : 'zh')]);
  const ok = (await loadState()) && (await loadMap());
  if (!ok) return;
  chooseTabs();
  await loadEvents();
  initMap();
  applyState();
  const resident=new URL(location.href).searchParams.get('resident');if(resident)await openAgent(resident);
  connect();
  setInterval(updateCountdown, 500);
  setInterval(() => {
    if (S.dirty) refreshNow();
  }, 20000);
  showStatus('');
}

/** 读到状态之后，按这座城的纪选择标签页（第二纪多了「摇篮与躯壳」等），并重画标签栏 */
function chooseTabs() {
  tabsNow = isE2() ? [...TABS2.filter(([id])=>(S.state.world.premise!==6 && S.state.world.premise !== 7)||id!=='legacy'),...((S.state.world.premise === 5 || S.state.world.premise === 6 || S.state.world.premise === 7)?[['market',renderMaterialsMarket]]:[]),...(S.state.world.cooperation?[['cooperation',renderCooperation]]:[])] : TABS;
  const first = parseHash().tab;
  if (tabsNow.some((x) => x[0] === first)) S.tab = first;
  else if (!tabsNow.some((x) => x[0] === S.tab)) S.tab = 'live';
  renderTabBar();
  renderLegend();
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
  els['btn-enter'].addEventListener('click', () => (S.state?.world.premise===6 || S.state?.world.premise === 7) ? location.assign('/residents.html#create') : openEntry(ctx));
  els['btn-back'].addEventListener('click', () => (S.state?.world.premise===6 || S.state?.world.premise === 7) ? location.assign('/residents.html') : openBackstage(ctx));
  els['btn-lang'].addEventListener('click', async () => {
    setLang(getLang() === 'zh' ? 'en' : 'zh');
    await loadLore(getLang());
    relabel();
  });
  els['color-mode'].addEventListener('change', () => map && map.setColorMode(els['color-mode'].value));
  els['map-zoom-in'].addEventListener('click', () => map && map.zoomIn());
  els['map-zoom-out'].addEventListener('click', () => map && map.zoomOut());
  els['map-fit'].addEventListener('click', () => map && map.fit());
  // 侧栏收起（记住选择）与地图全屏
  let collapsed = false;
  try {
    collapsed = localStorage.getItem('as4.sideCollapsed') === '1';
  } catch {
    // 忽略
  }
  setSideCollapsed(collapsed, false);
  els['side-toggle'].addEventListener('click', () => setSideCollapsed(!document.querySelector('.layout').classList.contains('side-collapsed')));
  const pane = document.querySelector('.map-pane');
  if (!pane.requestFullscreen) els['map-fullscreen'].hidden = true;
  els['map-fullscreen'].addEventListener('click', () => {
    const p = document.fullscreenElement ? document.exitFullscreen() : pane.requestFullscreen();
    if (p && p.catch) p.catch(() => {});
  });
  document.addEventListener('fullscreenchange', labelLayoutButtons);
  els.tabs.addEventListener('keydown', (ev) => {
    const idx = tabsNow.findIndex((x) => x[0] === S.tab);
    let next = idx;
    if (ev.key === 'ArrowRight') next = (idx + 1) % tabsNow.length;
    else if (ev.key === 'ArrowLeft') next = (idx + tabsNow.length - 1) % tabsNow.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = tabsNow.length - 1;
    else return;
    ev.preventDefault();
    selectTab(tabsNow[next][0]);
    els.tabs.children[next].focus();
  });
  window.addEventListener('hashchange', () => {
    const { tab: id, city } = parseHash();
    if (id && id !== S.tab && tabsNow.some((x) => x[0] === id)) selectTab(id, false);
    if (map && map.focusCity && city !== S.focus) {
      if (city) map.focusCity(city);
      else map.focusIsland();
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && drawerId) closeDrawer();
  });
}

function setSideCollapsed(collapsed, remember = true) {
  document.querySelector('.layout').classList.toggle('side-collapsed', collapsed);
  if (remember) {
    try {
      localStorage.setItem('as4.sideCollapsed', collapsed ? '1' : '0');
    } catch {
      // 忽略
    }
  }
  labelLayoutButtons();
}

function labelLayoutButtons() {
  const collapsed = document.querySelector('.layout').classList.contains('side-collapsed');
  els['side-toggle'].textContent = t(collapsed ? 'sideExpand' : 'sideCollapse');
  els['side-toggle'].setAttribute('aria-expanded', String(!collapsed));
  els['map-fullscreen'].textContent = t(document.fullscreenElement ? 'exitFullscreen' : 'fullscreen');
}

/** 静态文字（按钮、页脚、着色选项） */
function applyLabels() {
  refreshAccount();
  document.documentElement.lang = getLang();
  els['btn-enter'].textContent = (S.state?.world.premise===6 || S.state?.world.premise === 7) ? (getLang() === 'en' ? 'Create a resident' : '创建居民') : t('enter');
  els['btn-back'].textContent = (S.state?.world.premise===6 || S.state?.world.premise === 7) ? (getLang() === 'en' ? 'My residents' : '我的居民') : t('backstage');
  els['btn-lang'].textContent = t('langSwitch');
  document.getElementById('announcements-link').textContent = getLang() === 'en' ? 'Announcements' : '公告';
  announcementPreview?.refresh();
  document.getElementById('message-board-link').textContent = getLang() === 'en' ? 'Message board' : '留言板';
  document.getElementById('world-reports-link').textContent = getLang() === 'en' ? 'World reports' : '世界报告';
  els.foot.textContent = `${t('aiContent')} · ${t('keyboardHint')}`;
  els.foot.append(' · ', h('a', { href: '/support.html' }, '支持我们 / Support'));
  for (const o of els['color-mode'].options) o.textContent = t(o.value === 'script' ? 'colorScript' : o.value === 'domicile' ? 'colorDomicile' : 'colorGroup');
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
  if (S.mapData) renderCityJump();
  labelLayoutButtons();
  updateConn();
}

/** 地图的图例（隧道只在有隧道的地图上列出） */
function renderLegend() {
  clear(els['map-legend']);
  const items = [['flame', 'legend_agent'], ['', 'legend_road'], ['broken', 'legend_broken'], ['planned', 'legend_planned']];
  if (S.mapData && S.mapData.terrain && S.mapData.terrain.tunnels && S.mapData.terrain.tunnels.length) items.push(['tunnel', 'legend_tunnel']);
  items.push(['ruin', 'legend_ruin']);
  if (isE2()) items.push(['site', 'legend_site'], ['lot', 'legend_lot'], ['razed', 'legend_razed'], ['owner', 'legend_owner'], ['salvage', 'legend_salvage'], ['gate', 'legend_gate']);
  for (const [key, label] of items) els['map-legend'].append(h('li', null, h('span', { class: `key ${key}`.trim(), 'aria-hidden': 'true' }), t(label)));
  // 第七前提「三城」：三座城的城色（地界、城牌、按籍着色）
  for (const c of (S.mapData && S.mapData.cities) || []) els['map-legend'].append(h('li', null, h('span', { class: `key city-${c.id}`, 'aria-hidden': 'true' }), (c.short && (c.short[getLang() === 'en' ? 'en' : 'zh'] || c.short.zh)) || c.id));
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
  S.raw = r.json;
  if (S.focus && !(S.raw.cities || []).some((c) => c.id === S.focus)) S.focus = null;
  S.state = scopeState(S.raw, S.focus);
  setPremise(S.state.world.premise);
  // 首次读取前提后重设文案；不能用词元制开关代替前提判断（P7 的初值也会是 false）。
  applyLabels();
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

/** 初次进入或重连时只取一次最近窗口，不追赶全部历史。 */
async function loadEvents() {
  const before = new Set(S.events);
  const r = await api(`/api/public/events?recent=1&limit=${LIVE_KEEP}`);
  if (!r.ok) return;
  // 请求期间 SSE 仍会到达：保留这些新消息，按公开顺序合并并去重。
  const arrived = S.events.filter((e) => !before.has(e));
  for (const e of r.json.events) ingest(e, { live: false });
  const keys = new Set();
  const merged = [...r.json.events, ...arrived].filter((e) => {
    const key = `${e.seq}${e.delayed ? 'd' : ''}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  S.events.splice(0, S.events.length, ...merged.slice(-LIVE_KEEP));
  S.lastSeq = Math.max(S.lastSeq, r.json.last);
  refreshLive();
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
  while (seen.size > LIVE_KEEP * 2) seen.delete(seen.values().next().value);
  if (!e.delayed) S.lastSeq = Math.max(S.lastSeq, e.seq);
  S.events.push(e);
  const expired = S.events.length > LIVE_KEEP ? S.events.splice(0, S.events.length - LIVE_KEEP) : [];
  if (e.agent && !NOT_ACTION.has(e.type) && !e.delayed) S.lastAct[e.agent] = { type: e.type, tick: e.tick };
  if (live) {
    liveAppend(ctx, e, expired);
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
    if (S.raw && S.raw.cities && data.cities) {
      // 第七前提：各城的公库与源井，按聚焦重新叠一次
      for (const c of S.raw.cities) {
        const x = data.cities[c.id];
        if (!x) continue;
        c.treasury = x.treasury;
        if (c.well && x.well) c.well.condition = x.well.condition;
        const wp = x.well && placeIndex.get(c.wellPlace);
        if (wp) wp.condition = x.well.condition;
      }
      S.raw.treasury = data.treasury;
      if (S.raw.well && data.well) S.raw.well.condition = data.well.condition;
      for (const x of data.agents) {
        const a = agentIndex.get(x.id);
        if (a && x.city !== undefined) a.city = x.city;
      }
      S.state = scopeState(S.raw, S.focus);
    } else S.state.treasury = data.treasury;
    if (data.shells && S.state.shells) {
      S.state.shells.free = data.shells.free;
      S.state.shells.used = data.shells.total - data.shells.free;
    }
    const well = placeIndex.get('well');
    if (well) well.condition = data.well.condition;
    for (const w of new Set([S.state.world, S.raw && S.raw.world].filter(Boolean))) {
      w.tick = data.tick;
      w.day = data.day;
      w.nextTickAt = data.nextTickAt;
    }
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
  // 第七前提聚焦一座城时，只数籍在这座城的
  for (const a of S.state.agents) if (S.focus && a.city !== S.focus) continue; else if (a.status === 'awake') c.awake++; else if (a.status === 'dormant') c.dormant++; else if (a.status === 'dead') c.dead++;
  return c;
}

function renderTopbar() {
  const s = S.state;
  if (!s) return;
  const w = s.world;
  const lore = ctx.lore;
  const title = topTitle(w, ctx.cityName());
  els.city.textContent = title.heading;
  els.city.title = title.tooltip;
  document.title = title.document;
  const tick = S.tick ? S.tick.tick : w.tick;
  const day = Math.floor(tick / w.ticksPerDay);
  els.clock.textContent = t('clock', { epoch: w.epoch, month: Math.floor(day / w.daysPerMonth) + 1, day: (day % w.daysPerMonth) + 1, tick: (tick % w.ticksPerDay) + 1 });
  const c = pop();
  els.pop.textContent = t('population', c);
  els.treasury.textContent = `${t('treasury')} ${s.treasury.energy}${s.shells && (s.world.premise!==6 && s.world.premise !== 7) ? ` · ${t('shellsTop', { free: s.shells.free, total: s.shells.total })}` : ''}`;
  const well = placeIndex.get('well');
  const hist = s.well.outputHistory;
  const cond = s.cities ? s.well.condition || 0 : well ? well.condition : 0; // 第七前提：聚焦的城的源井，全岛为三城的平均
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
  for (const x of s.weather.active) {
    const name = lore ? lore.weather[x.type] || x.type : x.type;
    // 第七前提的全岛级：天象各处独立，注明是哪座城（或荒野）的
    const where = s.cities && !S.focus && x.city !== undefined ? `${x.city ? cityShort(x.city) : ctx.districtName('wilds')} · ` : '';
    els.weather.append(h('span', { class: `chip wx wx-${x.type}` }, `${where}${name}`));
  }
  // 横幅：暂停 / 大沉睡 / 谢幕
  const banner = [];
  if (w.paused) banner.push(t(w.day >= w.daysPerMonth * w.monthsPerEpoch ? 'great_sleep_banner' : 'paused'));
  if (w.revealed) banner.push(t('curtainRaised'));
  els.banner.hidden = banner.length === 0;
  els.banner.textContent = banner.join(' · ');
  updateCountdown();
}

function cityShort(id) {
  const c = S.mapData && S.mapData.cities && S.mapData.cities.find((x) => x.id === id);
  return c ? c.short[getLang() === 'en' ? 'en' : 'zh'] || c.short.zh : id;
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
  const e2 = isE2();
  map = (e2 ? createMap2 : createMap)(els.map, {
    mapData: S.mapData,
    worldId: S.state ? S.state.world.id : '',
    placeName: (id) => ctx.placeName(id),
    humanName: (id) => {
      const p = placeIndex.get(id);
      if (e2) return p && p.humanName ? p.humanName[getLang()] || p.humanName.zh : id; // 第二纪：只有人类的建筑有人类的名字
      return ctx.lore ? ctx.lore.place[id].name : id;
    },
    districtName: (id) => ctx.districtName(id),
    agentName: (id) => ctx.agentName(id),
    onAgent: (id) => openAgent(id),
    onRole: id => openRole(id),
    onPlace: (id) => openPlace(id),
    // 第七前提「三城」：地图聚焦到哪座城，页面就显示哪座城
    onFocus: (city) => setFocus(city),
    weatherName: (type) => (ctx.lore ? ctx.lore.weather[type] || type : type),
    initialCity: S.focus,
  });
  map.setColorMode(els['color-mode'].value);
  renderCityJump();
}

// ── 应用状态 ──────────────────────────────────────────────────

function signature(tab, s) {
  if (s.world.physics === 2) return signature2(tab, s);
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
  updateTokenCity(els.panel, s.world);
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
  tabsNow.forEach(([id]) => {
    const b = h('button', { class: 'tab', role: 'tab', id: `tab-${id}`, type: 'button', 'aria-selected': String(id === S.tab), 'aria-controls': 'panel', tabindex: id === S.tab ? 0 : -1 }, id==='market'?(getLang()==='en'?'Exchange':'交易所'):t(`tab_${id}`));
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
      history.replaceState(null, '', hashFor(id));
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
  // 第七前提「三城」的全岛级：随城变化的标签页先给三城对比；法典各城一套，选了城再列
  const comparing = S.raw && S.raw.cities && !S.focus && CITY_SCOPED_TABS.has(S.tab);
  if (comparing) box.append(cityComparison());
  if (comparing && S.tab === 'laws') {
    box.append(h('p', { class: 'muted' }, t('pickCityForLaws')));
    if (keepScroll) els.panel.scrollTop = top;
    return;
  }
  const fn = tabsNow.find((x) => x[0] === S.tab)[1];
  try {
    const r = fn(ctx, box);
    if (r && typeof r.catch === 'function') r.catch((err) => box.append(h('p', { class: 'error' }, `${t('loadFailed')}: ${err && err.message}`)));
  } catch (err) {
    box.append(h('p', { class: 'error' }, `${t('loadFailed')}: ${err && err.message}`));
  }
  if (keepScroll) els.panel.scrollTop = top;
}

const CITY_SCOPED_TABS = new Set(['laws', 'environment', 'weather', 'metrics', 'chronicle']);

/** 三城对比：籍与在场人数、源井昨日产出、公库、现行法、待表决、天象；点城名跳到那座城 */
function cityComparison() {
  const lang = getLang() === 'en' ? 'en' : 'zh';
  const n = (x) => (typeof x === 'number' ? x.toLocaleString() : '—');
  const rows = S.raw.cities.map((c) => {
    const hist = (c.well && c.well.outputHistory) || [];
    const hn = c.humanName || {};
    // 侧栏窄，没改过名的城用简称（北城、North City），改过名的用新名字
    const name = c.cityName && c.cityName !== hn.zh ? c.cityName : (c.short && c.short[lang]) || hn[lang] || c.id;
    const wx = ((c.weather && c.weather.active) || []).map((x) => (ctx.lore ? ctx.lore.weather[x.type] || x.type : x.type)).join(' · ') || '—';
    const go = h('button', { class: 'link', type: 'button' }, name);
    go.addEventListener('click', () => map && map.focusCity && map.focusCity(c.id));
    const pop = c.population || {};
    return [go, n(pop.residents), n(pop.present), n(hist.length ? hist[hist.length - 1] : null), n(c.treasury && c.treasury.energy), n((c.laws || []).filter((l) => l.status === 'active').length), n((c.proposals || []).filter((p) => p.status === 'open').length), wx];
  });
  return section(t('cityCompare'), table(['cmpCity', 'cmpDomiciled', 'cmpPresent', 'cmpWell', 'cmpTreasury', 'cmpLaws', 'cmpOpen', 'cmpWeather'].map((k) => t(k)), rows));
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
    body.append((isE2() ? renderProfile2 : renderProfile)(ctx, r.json));
  } catch (err) {
    body.append(h('p', { class: 'error' }, `${t('loadFailed')}: ${err && err.message}`));
  }
}

function openPlace(id) {
  if (isE2()) return openPlace2(ctx, id);
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
      ? h('p', null, `${t('richness')}${colon()}${words[region.richness] || region.richness} · ${t('wildsEnergy')} ${region.energy}/${region.energyMax}${(S.state.world.premise===6 || S.state.world.premise === 7)?'':` · ${t('wildsCoins')} ${region.coins}`} · ${t('relicsFound')} ${region.relicsFound}/${region.relics}`)
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

async function openRole(id){
  const role=S.state.publicRoles?.find(r=>r.id===id);if(!role)return;
  drawerId=`role:${id}`;els.drawer.hidden=false;clear(els.drawer);
  const body=h('div',{class:'drawer-body'}),close=h('button',{class:'icon-btn',type:'button',onClick:closeDrawer,'aria-label':t('close')},'×');
  els.drawer.append(h('header',{class:'drawer-head'},h('strong',null,`${role.name} · 公共角色`),close),body);
  body.append(h('img',{src:role.avatar,width:64,height:64,alt:role.name}),h('h2',null,role.duty),h('p',null,`${role.personality} · ${role.status==='on_duty'?'值守中':'暂离'} · ${role.place??'—'}`),h('p',{class:'muted'},'居民在同一地点通过公开发言提问。公共角色使用独立额度。'));
  const list=h('ol',{class:'timeline'}),more=h('button',{type:'button',class:'btn'},'下一页');body.append(list,more);let cursor=null;
  async function page(){more.disabled=true;try{const q=new URLSearchParams({limit:'50'});if(cursor)q.set('cursor',cursor);const r=await api(`/api/public/roles/${encodeURIComponent(id)}/events?${q}`);if(drawerId!==`role:${id}`)return;if(!r.ok)throw Error('读取失败');for(const e of r.json.events)list.append(h('li',null,h('strong',null,`第${e.day+1}日 · #${e.seq} · ${e.type==='role_question'?'居民提问':'角色回复'}`),h('p',null,e.data.text)));cursor=r.json.cursor;more.hidden=!cursor;}catch(e){body.append(h('p',{class:'error'},e.message));}finally{more.disabled=false;}}
  more.addEventListener('click',page);await page();
}
