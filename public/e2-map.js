// 第二纪观测站的地图（SPEC-E2 §21）：从 state.places、state.paths、state.roads、state.lots 与 /api/public/map 的静态数据画出。
// 与第一纪的地图（map.js）同一套底图、视口与居民的画法；不同的是地点是动态的——
//   · 人类的建筑用现有的 glyph；后人开辟的地点用另一种画风（棚屋），并把它的模块画成叠在一起的小图标，新的组合自动长出新的样子；
//   · 遗址画成褪色的轮廓，空地块是淡淡的菱形，门是一道横线，主人用描边颜色区分（全城无圈、居民、社群），残料用一圈细环表示剩余比例；
//   · 拆解时建筑闪一下、残料环缩短；开辟时新地点从空地块上长出来。
// 只用 SVG 属性、classList 与 CSSOM 设置样式（CSP 不允许 style 属性字符串），所有文字用 textContent。

import { t, getLang } from './i18n.js';
import { el, drawGlyph, GLYPH_HUE, TOMB_SLOTS, projectIcon, FLAME_D, starPath } from './map-glyphs.js';
import { drawSiteGlyph, moduleIcon, lotMarker } from './e2-glyphs.js';
import { drawDefs, drawTerrain, hash32, streetCurve } from './map-terrain.js';
import { createView } from './map-view.js';
import { clip } from './map.js';

const HUD = 40;
const GOLDEN = 2.399963229728653;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const hash01 = (s) => (hash32(s) % 100000) / 100000;
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const SCRIPT_HUE = { han: 8, latin: 190, kana: 330, hangul: 300, arabic: 125, cyrillic: 275, devanagari: 40, greek: 165, hebrew: 95, thai: 55 };
const RING_R = 47;
const RING_LEN = 2 * Math.PI * RING_R;

function agentColor(a, mode) {
  if (a.status === 'dormant') return 'hsl(220 12% 40%)';
  if (mode === 'script') {
    const h = a.script && SCRIPT_HUE[a.script] !== undefined ? SCRIPT_HUE[a.script] : null;
    return h === null ? 'hsl(200 20% 72%)' : `hsl(${h} 95% 64%)`;
  }
  const g = a.groups && a.groups[0];
  return g ? `hsl(${Math.floor(hash01(g) * 360)} 95% 63%)` : 'hsl(185 55% 82%)';
}

/** 缩放级别（相对「全图」的倍数）：far 看全城，mid 看街区，near 看一处 */
function lodOf(k, fitK) {
  const r = k / fitK;
  return r < 1.45 ? 'far' : r < 2.8 ? 'mid' : 'near';
}
const agentScaleFor = (k) => Math.round(clamp(0.95 / k, 1, 2.2) * 10) / 10;

function timeOfDay(tickOfDay) {
  if (tickOfDay <= 2 || tickOfDay >= 10) return 'night';
  if (tickOfDay === 3 || tickOfDay === 9) return 'dusk';
  return 'day';
}

const bandOf = (bp) => (bp >= 9000 ? 'pristine' : bp >= 6000 ? 'worn' : bp >= 3000 ? 'weathered' : bp >= 1 ? 'dilapidated' : 'ruin');

/** 主人的描边颜色：居民、社群各按 ID 取一个色相；全城所有的不画圈 */
export function ownerColor(owner) {
  if (!owner || owner.kind === 'city') return null;
  return `hsl(${Math.floor(hash01(`${owner.kind}:${owner.id}`) * 360)} 90% ${owner.kind === 'group' ? 58 : 66}%)`;
}

let current = null;
const savedViews = {};

/**
 * deps：{ mapData, worldId, placeName(id), humanName(id), districtName(id), agentName(id), onAgent(id), onPlace(id) }
 * 返回 { setState, setTick, setColorMode, onEvent, bubble, ripple, zoomIn, zoomOut, fit, placeConditionOf, destroy }
 */
export function createMap2(svg, deps) {
  if (current) current.destroy();
  const map = deps.mapData;
  svg.textContent = '';
  for (const c of [...svg.classList]) if (/^(map-|wx-|tod-|lod-)/.test(c)) svg.classList.remove(c);
  svg.classList.add(`map-${map.id}`, 'map-e2', 'lod-far', 'tod-day');
  svg.style.setProperty('--map-aspect', `${map.size[0]} / ${Math.round(map.size[1] * 1.08 + 30)}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', t('map'));

  const defs = el('defs');
  drawDefs(defs);
  const world = el('g', { class: 'world' });
  const shake = el('g', { class: 'shake' });
  world.append(shake);
  const L = {};
  for (const name of ['ground', 'water', 'districts', 'wall', 'streets', 'paths', 'roads', 'waste', 'lots', 'places', 'facilities', 'agents', 'weather', 'districtLabels', 'labels', 'fx']) {
    L[name] = el('g', { class: `layer-${name}` });
    shake.append(L[name]);
  }
  const hud = el('g', { class: 'hud' });
  svg.append(defs, world, hud);

  const { xy: staticXY } = drawTerrain(L, map, {
    worldId: deps.worldId || '',
    names: { district: (id) => (deps.districtName ? deps.districtName(id) : id), far: t('mapFar') },
  });
  const staticPlace = {};
  for (const p of map.places) staticPlace[p.id] = p;
  const lotDefs = {};
  for (const l of map.lots || []) lotDefs[l.id] = l;

  // 动态的地点：id → { xy, glyph, wild, open }（来自 state.places）
  const xy = { ...staticXY };
  const placeInfo = {};

  // ── 天象的画面（平时隐藏，按根上的 wx-* 显示） ──
  const [MW, MH] = map.size;
  const port = staticPlace.port ? staticPlace.port.xy : [80, MH / 2];
  const fog = el('g', { class: 'fx-fog' });
  for (let i = 0; i < 7; i++) {
    const r = hash01(`fog${i}`);
    fog.append(el('ellipse', { class: 'fog-wisp', cx: port[0] - 60 + r * 260, cy: port[1] - 240 + i * 80, rx: 160 + r * 120, ry: 26 + r * 18 }));
  }
  const boats = el('g', { class: 'fx-boats' });
  for (let i = 0; i < 3; i++) boats.append(el('path', { class: 'boat', d: `M${port[0] - 150 + i * 28},${port[1] - 40 + i * 42} l24,0 l-5,7 l-15,0 z M${port[0] - 138 + i * 28},${port[1] - 40 + i * 42} v-14 l9,11 z` }));
  const eclipse = el('rect', { class: 'fx-eclipse', x: 0, y: 0, width: MW, height: MH });
  L.weather.append(fog, boats, eclipse);

  // ── 天穹（HUD） ──
  const sky = el('rect', { class: 'sky', x: 0, y: 0, width: 100, height: HUD });
  const aurora = el('g', { class: 'fx-aurora' });
  for (let i = 0; i < 3; i++) aurora.append(el('path', { class: `aurora-band a${i}`, d: '' }));
  const skyLabel = el('text', { class: 'sky-label', x: 10, y: 25 }, t('skyLabel'));
  const starsG = el('g', { class: 'stars' });
  const sun = el('g', { class: 'fx-sun' });
  sun.append(el('circle', { class: 'corona', cx: 0, cy: HUD / 2, r: 13 }), el('circle', { class: 'disc', cx: 0, cy: HUD / 2, r: 10 }));
  hud.append(sky, aurora, sun, skyLabel, starsG);

  // ── 状态 ──
  let colorMode = 'group';
  let state = null;
  let ticksPerDay = 12;
  let lod = 'far';
  let agentScale = 1;
  let viewK = 1;
  let W = 1000;
  let firstState = true;
  const agents = new Map();
  const agentEls = new Map();
  const starEls = new Map();
  const bubbles = new Set();
  const bubbleCount = {};
  const placeEls = {}; // id → { g, glyph, glyphKey, title, label, sub, badge, tombs, ring, owner, gate, mods }
  const lotEls = new Map(); // id → { g, project }

  const view = createView(svg, world, {
    hud: HUD,
    onChange({ k, W: w, fitK }) {
      viewK = k;
      W = w;
      L.labels.setAttribute('font-size', (12.5 / k).toFixed(3));
      L.labels.setAttribute('stroke-width', (3 / k).toFixed(3));
      L.districtLabels.setAttribute('font-size', (13 / k).toFixed(3));
      for (const b of bubbles) b.g.setAttribute('transform', `translate(${b.x} ${b.y}) scale(${(1 / k).toFixed(4)})`);
      layoutHud();
      const next = lodOf(k, fitK);
      if (next !== lod) {
        svg.classList.replace(`lod-${lod}`, `lod-${next}`);
        lod = next;
      }
      const s = agentScaleFor(k);
      if (s !== agentScale) {
        agentScale = s;
        layoutAgents({ animate: false });
      }
      savedViews[map.id] = view ? view.state() : null;
    },
  });
  view.setBounds(map.size);

  function layoutHud() {
    sky.setAttribute('width', W);
    const a = [[0, 26, 0.35], [1, 18, 0.55], [2, 30, 0.8]];
    for (const [i, base, amp] of a) {
      let d = `M0,${base}`;
      for (let x = 0; x <= W; x += 40) d += ` L${x},${(base + Math.sin(x / (70 + i * 25) + i) * 8 * amp).toFixed(1)}`;
      aurora.children[i].setAttribute('d', d);
    }
    sun.setAttribute('transform', `translate(${Math.round(W * 0.72)} 0)`);
    for (const [id, g] of starEls) {
      const [sx, sy] = starPos(id);
      g.setAttribute('transform', `translate(${sx} ${sy})`);
    }
  }

  // ── 地点 ──────────────────────────────────────────────────

  /** 这个地点用哪种图形：后人开辟的（或在遗址上重新开辟的）用棚屋，人类的用地图数据里的 glyph */
  function glyphKeyOf(p) {
    if (p.origin === 'agent') return 'site';
    const s = staticPlace[p.id];
    return s ? s.glyph : 'site';
  }

  function makePlace(p, fresh) {
    const [x, y] = p.xy;
    xy[p.id] = p.xy;
    const g = el('g', { class: 'place', transform: `translate(${x} ${y})`, tabindex: 0, role: 'button', 'data-place': p.id });
    const title = el('title');
    const owner = el('ellipse', { class: 'owner-ring', cx: 0, cy: 4, rx: 50, ry: 36 });
    const ring = el('circle', { class: 'salvage-ring', cx: 0, cy: 2, r: RING_R, transform: 'rotate(-90 0 2)' });
    const glyph = el('g', { class: 'glyph' });
    const gate = el('path', { class: 'gate-bar', d: 'M-22,27 H22' });
    const mods = el('g', { class: 'mods' });
    g.append(title, owner, ring, el('rect', { class: 'hit', x: -46, y: -44, width: 92, height: 74 }), glyph, el('path', { class: 'crack', d: 'M-14,-18 l7,10 l-5,7 l9,9 l-3,9' }), gate, mods);
    g.addEventListener('click', () => deps.onPlace && deps.onPlace(p.id));
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (deps.onPlace) deps.onPlace(p.id);
      }
    });
    L.places.append(g);
    const label = el('text', { class: 'label', x, y: y + 26, dy: '1em', 'text-anchor': 'middle' });
    const sub = el('text', { class: 'label-sub', x, y: y + 26, dy: '2.55em', 'text-anchor': 'middle' });
    const badge = el('text', { class: 'badge', x: x + 36, y: y - 30, 'text-anchor': 'start' });
    L.labels.append(label, sub, badge);
    const pe = { g, glyph, glyphKey: null, title, label, sub, badge, ring, owner, gate, mods, tombs: [] };
    placeEls[p.id] = pe;
    if (fresh && !reduceMotion()) {
      g.classList.add('fresh');
      setTimeout(() => g.classList.remove('fresh'), 2200);
    }
    return pe;
  }

  function paintPlace(p) {
    let pe = placeEls[p.id];
    if (!pe) pe = makePlace(p, !firstState);
    const key = glyphKeyOf(p);
    placeInfo[p.id] = { id: p.id, xy: p.xy, glyph: key, wild: p.wild, open: p.open };
    if (pe.glyphKey !== key) {
      pe.glyphKey = key;
      pe.glyph.textContent = '';
      if (key === 'site') drawSiteGlyph(pe.glyph);
      else drawGlyph(pe.glyph, key);
      pe.tombs = [...pe.glyph.querySelectorAll('.tomb')];
      for (const c of [...pe.g.classList]) if (c.startsWith('hue-') || c.startsWith('glyph-')) pe.g.classList.remove(c);
      pe.g.classList.add(`hue-${key === 'site' ? 'rust' : GLYPH_HUE[key] || 'cyan'}`, `glyph-${key}`);
    }
    pe.g.classList.toggle('wild', !!p.wild);
    pe.g.classList.toggle('agent-built', p.origin === 'agent');
    pe.g.classList.toggle('razed', !!p.razed);
    const band = p.razed ? 'razed' : p.condition === null || p.condition === undefined ? 'open' : p.ruined ? 'ruin' : bandOf(p.condition);
    for (const c of ['open', 'razed', 'pristine', 'worn', 'weathered', 'dilapidated', 'ruin']) pe.g.classList.toggle(`cond-${c}`, c === band);
    const name = deps.placeName(p.id);
    pe.label.textContent = name;
    pe.label.classList.toggle('wild', !!p.wild);
    pe.label.classList.toggle('razed', !!p.razed);
    pe.sub.textContent = p.renamedBy && p.humanName ? deps.humanName(p.id) : '';
    // 残料环：剩余比例
    const frac = p.salvage && p.salvage.max > 0 && !p.razed ? clamp(p.salvage.left / p.salvage.max, 0, 1) : 0;
    pe.ring.classList.toggle('hidden', !(p.salvage && p.salvage.max > 0) || !!p.razed);
    pe.ring.style.strokeDasharray = `${(frac * RING_LEN).toFixed(1)} ${RING_LEN.toFixed(1)}`;
    // 主人：描边颜色
    const color = ownerColor(p.owner);
    pe.owner.classList.toggle('hidden', color === null || !!p.razed);
    if (color) pe.owner.setAttribute('stroke', color);
    // 门：一道横线
    const gateMod = (p.modules || []).find((m) => m.type === 'gate');
    pe.gate.classList.toggle('hidden', !gateMod);
    pe.gate.classList.toggle('off', !!gateMod && !gateMod.functioning);
    // 模块：叠在一起的小图标（门另有横线，不重复画）
    pe.mods.textContent = '';
    const shown = (p.modules || []).filter((m) => m.type !== 'gate');
    shown.forEach((m, i) => {
      const icon = moduleIcon(m.type);
      icon.classList.toggle('off', !m.functioning);
      icon.classList.toggle('inherent', !!m.inherent);
      icon.setAttribute('transform', `translate(${-30 + i * 13} ${-56 + (i % 2) * -6}) scale(0.95)`);
      pe.mods.append(icon);
    });
    const cond = p.razed ? t('mapRazed') : p.condition === null ? t('fx_open') : `${t('condition')} ${(p.condition / 100).toFixed(0)}%`;
    const modNames = shown.map((m) => t(`module_${m.type}`)).join('、');
    pe.title.textContent = `${name} · ${cond}${modNames ? ` · ${modNames}` : ''}`;
    pe.g.setAttribute('aria-label', `${name} ${cond}`);
  }

  function removeMissing(ids) {
    for (const id of Object.keys(placeEls)) {
      if (ids.has(id)) continue;
      const pe = placeEls[id];
      pe.g.remove();
      pe.label.remove();
      pe.sub.remove();
      pe.badge.remove();
      delete placeEls[id];
      delete placeInfo[id];
      delete xy[id];
    }
  }

  // ── 空地块、道路、小路、工程 ────────────────────────────────

  function curveOf(a, b) {
    return xy[a] && xy[b] ? streetCurve(xy, a, b) : null;
  }

  function redrawLots(s) {
    const seen = new Set();
    const projectOf = new Map((s.projects || []).map((j) => [j.id, j]));
    for (const l of s.lots || []) {
      const def = lotDefs[l.id];
      if (!def) continue;
      // 已经长出地点的空地块不再画标记；有工程的画进度环
      if (l.place !== null) continue;
      seen.add(l.id);
      let le = lotEls.get(l.id);
      if (!le) {
        const g = el('g', { class: 'lot-wrap', transform: `translate(${def.xy[0]} ${def.xy[1]})` });
        const title = el('title');
        g.append(lotMarker(), title);
        L.lots.append(g);
        le = { g, title, project: null };
        lotEls.set(l.id, le);
      }
      const j = l.project ? projectOf.get(l.project) : null;
      le.g.classList.toggle('building', !!j);
      le.g.classList.toggle('wild', def.district === 'wilds');
      if (le.project) {
        le.project.remove();
        le.project = null;
      }
      if (j) {
        le.project = projectIcon(clamp(j.have / Math.max(1, j.need), 0, 1));
        le.project.setAttribute('transform', 'translate(0 -16)');
        le.g.append(le.project);
      }
      le.title.textContent = j ? `${l.id} · ${j.name || ''} ${j.have}/${j.need}` : `${l.id} · ${t('mapLotFree')}`;
    }
    for (const [id, le] of lotEls) {
      if (!seen.has(id)) {
        le.g.remove();
        lotEls.delete(id);
      }
    }
  }

  function redrawLinks(s) {
    L.paths.textContent = '';
    L.roads.textContent = '';
    for (const p of s.paths || []) {
      const c = curveOf(p.a, p.b);
      if (c) L.paths.append(el('path', { class: 'path-small', d: c.d }));
    }
    for (const r of s.roads || []) {
      const c = curveOf(r.a, r.b);
      if (!c) continue;
      const path = el('path', { class: r.functioning && !r.ruined ? 'road' : 'road broken', d: c.d });
      path.append(el('title', {}, `${r.name || r.id} · ${(r.condition / 100).toFixed(0)}%`));
      L.roads.append(path);
    }
  }

  function redrawFacilities(s) {
    L.facilities.textContent = '';
    const slot = {};
    const iconAt = (place) => {
      const i = (slot[place] = (slot[place] || 0) + 1) - 1;
      const [x, y] = xy[place];
      return [x - 30 + i * 21, y - 78];
    };
    for (const p of s.places) {
      if (!xy[p.id]) continue;
      for (const j of p.projects || []) {
        if (j.lot) continue; // 开辟在空地块上的工程画在空地块的标记上
        if (j.build === 'road' && j.to && xy[j.to]) {
          const c = curveOf(p.id, j.to);
          if (c) {
            const path = el('path', { class: 'road planned', d: c.d });
            path.append(el('title', {}, `${j.name || ''} · ${j.have}/${j.need}`));
            L.roads.append(path);
          }
        }
        const [ix, iy] = iconAt(p.id);
        const g = projectIcon(clamp(j.have / Math.max(1, j.need), 0, 1));
        g.setAttribute('transform', `translate(${ix} ${iy})`);
        g.append(el('title', {}, `${j.name || j.module || j.build} · ${j.have}/${j.need}`));
        L.facilities.append(g);
      }
      if (p.omens && p.omens.length) {
        const [x, y] = xy[p.id];
        const m = el('path', { class: 'omen', d: `M${x + 40},${y - 50} l9,15 h-18 z` });
        m.append(el('title', {}, p.omens.map((o) => o.text).join(' / ')));
        L.facilities.append(m);
      }
    }
  }

  // ── 逝者之星 ──
  function starPos(id) {
    return [120 + hash01(`x${id}`) * Math.max(40, W - 140), 8 + hash01(`y${id}`) * (HUD - 16)];
  }

  function ensureStar(id, fromWorld) {
    if (starEls.has(id)) return;
    const [x, y] = starPos(id);
    const g = el('g', { class: 'star', tabindex: 0 });
    g.append(el('path', { d: starPath(4.6) }), el('title', {}, deps.agentName(id)));
    g.addEventListener('click', () => deps.onAgent && deps.onAgent(id));
    g.setAttribute('transform', `translate(${x} ${y})`);
    starsG.append(g);
    starEls.set(id, g);
    if (fromWorld && !reduceMotion() && typeof g.animate === 'function') {
      const [fx, fy] = view.toScreen(fromWorld[0], fromWorld[1]);
      g.animate([{ transform: `translate(${fx}px, ${fy}px)`, opacity: 0.2 }, { transform: `translate(${x}px, ${y}px)`, opacity: 1 }], { duration: 2400, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
  }

  // ── 居民 ──
  function flameScale(energy) {
    return clamp(0.7 + Math.sqrt(Math.max(0, energy)) * 0.085, 0.7, 1.75) * agentScale;
  }

  function slotPosition(place, i) {
    const p = placeInfo[place];
    const [cx, cy] = p.xy;
    const s = agentScale;
    const base = p.glyph === 'agora' ? 36 : 50;
    const rad = base + 8 * s * Math.sqrt(i);
    const ang = i * GOLDEN + hash01(place) * 6.28;
    return [cx + Math.cos(ang) * rad * 1.3, cy + 6 + Math.sin(ang) * rad * 0.82];
  }

  /** 两地之间沿街道、小路与正常运转的道路的途经点，只用于动画 */
  function waypoints(from, to) {
    if (!placeInfo[from] || !placeInfo[to] || !state) return [];
    const edges = [];
    for (const sdef of map.streets) edges.push({ a: sdef.a, b: sdef.b, cost: sdef.cost || 1 });
    for (const p of state.paths || []) edges.push({ a: p.a, b: p.b, cost: p.cost || 1 });
    for (const r of state.roads || []) if (r.functioning && !r.ruined) edges.push({ a: r.a, b: r.b, cost: 0 });
    const nb = (u) => edges.filter((e) => e.a === u || e.b === u).map((e) => ({ to: e.a === u ? e.b : e.a, cost: e.cost })).filter((e) => placeInfo[e.to]);
    const dist = { [from]: 0 };
    const prev = {};
    const done = new Set();
    for (;;) {
      let u = null;
      for (const id of Object.keys(dist)) if (!done.has(id) && (u === null || dist[id] < dist[u])) u = id;
      if (u === null || u === to) break;
      done.add(u);
      for (const { to: v, cost } of nb(u)) {
        const nd = dist[u] + cost + 0.001;
        if (dist[v] === undefined || nd < dist[v]) {
          dist[v] = nd;
          prev[v] = u;
        }
      }
    }
    if (dist[to] === undefined) return [];
    const path = [to];
    while (path[0] !== from) path.unshift(prev[path[0]]);
    const out = [];
    for (let i = 1; i < path.length; i++) {
      const c = curveOf(path[i - 1], path[i]);
      out.push(c ? c.mid : xy[path[i]], xy[path[i]]);
    }
    return out;
  }

  const tf = ([x, y], s) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(3)})`;

  function layoutAgents({ animate = true, moved = new Set() } = {}) {
    const byPlace = {};
    for (const [id, a] of agents) {
      if (a.status === 'dead' || a.status === 'retired' || !a.place || !placeInfo[a.place]) continue;
      (byPlace[a.place] ||= []).push(id);
    }
    const alive = new Set();
    const motion = animate && !reduceMotion();
    for (const [place, ids] of Object.entries(byPlace)) {
      ids.sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
      const pe = placeEls[place];
      if (pe) pe.g.classList.add('occupied');
      ids.forEach((id, i) => {
        alive.add(id);
        const a = agents.get(id);
        let ae = agentEls.get(id);
        const target = slotPosition(place, i);
        const scale = flameScale(a.energy);
        if (!ae) {
          const g = el('g', { class: 'agent', tabindex: 0, role: 'button' });
          g.append(el('title'), el('circle', { class: 'halo', r: 7 }), el('path', { class: 'flame', d: FLAME_D }));
          g.addEventListener('click', () => deps.onAgent && deps.onAgent(id));
          g.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') deps.onAgent && deps.onAgent(id);
          });
          L.agents.append(g);
          ae = { g, pos: target, place };
          agentEls.set(id, ae);
          g.style.transform = tf(target, scale);
        } else {
          const from = ae.pos;
          const fromPlace = ae.place;
          moveAgent(ae, target, scale, motion ? (moved.has(id) && fromPlace !== place ? waypoints(fromPlace, place) : []) : null, from);
          ae.place = place;
          ae.pos = target;
        }
        const color = agentColor({ ...(a.profile || {}), status: a.status }, colorMode);
        ae.g.lastChild.setAttribute('fill', color);
        ae.g.children[1].setAttribute('fill', color);
        ae.g.classList.toggle('dormant', a.status === 'dormant');
        ae.g.classList.toggle('exiled', !!(a.profile && a.profile.tags && a.profile.tags.includes('exiled')));
        const label = `${deps.agentName(id)} · ${t('energyN', { n: a.energy })}`;
        ae.g.firstChild.textContent = label;
        ae.g.setAttribute('aria-label', label);
      });
    }
    for (const [id, pe] of Object.entries(placeEls)) {
      const n = (byPlace[id] || []).length;
      if (!n) pe.g.classList.remove('occupied');
      pe.badge.textContent = n ? String(n) : '';
    }
    for (const [id, ae] of agentEls) {
      if (!alive.has(id)) {
        ae.g.remove();
        agentEls.delete(id);
      }
    }
  }

  function moveAgent(ae, target, scale, via, from) {
    const g = ae.g;
    if (typeof g.animate === 'function' && via) {
      const pts = [from, ...via, target];
      const frames = pts.map((p) => ({ transform: tf(p, scale) }));
      const dur = via.length ? clamp(260 * (via.length / 2), 400, 1800) : 450;
      if (ae.anim) ae.anim.cancel();
      ae.anim = g.animate(frames, { duration: dur, easing: via.length ? 'linear' : 'ease-out' });
    }
    g.style.transform = tf(target, scale);
  }

  function applyWeather(active) {
    const types = new Set((active || []).map((x) => x.type));
    for (const c of [...svg.classList]) if (c.startsWith('wx-') && !types.has(c.slice(3))) svg.classList.remove(c);
    for (const type of types) svg.classList.add(`wx-${type}`);
  }

  function applyTime(tick) {
    const tod = timeOfDay(((tick % ticksPerDay) + ticksPerDay) % ticksPerDay);
    for (const x of ['day', 'dusk', 'night']) svg.classList.toggle(`tod-${x}`, x === tod);
  }

  // ── 对外接口 ──────────────────────────────────────────────
  function setState(s) {
    state = s;
    ticksPerDay = s.world.ticksPerDay || 12;
    const ids = new Set();
    for (const p of s.places) {
      ids.add(p.id);
      paintPlace(p);
    }
    removeMissing(ids);
    const graves = Math.min(TOMB_SLOTS, s.cemetery ? s.cemetery.length : 0);
    for (const pe of Object.values(placeEls)) pe.tombs.forEach((tomb, i) => tomb.classList.toggle('filled', i < graves));
    redrawLots(s);
    redrawLinks(s);
    redrawFacilities(s);
    agents.clear();
    for (const a of s.agents) {
      agents.set(a.id, { profile: a, place: a.place, energy: a.energy, status: a.status });
      if (a.status === 'dead') ensureStar(a.id);
    }
    layoutAgents({ animate: false });
    applyWeather(s.weather && s.weather.active);
    applyTime(s.world.tick);
    firstState = false;
  }

  function setTick(tick) {
    if (!state) return;
    const moved = new Set();
    for (const x of tick.agents) {
      const a = agents.get(x.id);
      if (!a) continue;
      if (a.place !== x.place) moved.add(x.id);
      a.place = x.place;
      a.energy = x.energy;
      a.status = x.status;
    }
    layoutAgents({ animate: true, moved });
    applyTime(tick.tick);
  }

  function setColorMode(mode) {
    colorMode = mode === 'script' ? 'script' : 'group';
    layoutAgents({ animate: false });
  }

  function bubble(place, text, kind) {
    if (!xy[place]) return;
    const [x, y0] = xy[place];
    const n = (bubbleCount[place] = (bubbleCount[place] || 0) + 1);
    const y = y0 - 64;
    const g = el('g', { class: `bubble ${kind}` });
    const label = el('text', { x: 0, y: 4, 'text-anchor': 'middle' }, clip(text, 24));
    const box = el('rect', { rx: 3, ry: 3, height: 22 });
    g.append(box, label);
    L.fx.append(g);
    let w = 60;
    try {
      w = label.getComputedTextLength() + 18;
    } catch {
      w = 14 + [...text].length * 8;
    }
    box.setAttribute('width', w.toFixed(1));
    box.setAttribute('x', (-w / 2).toFixed(1));
    box.setAttribute('y', -11);
    const entry = { g, x, y: y - (((n - 1) % 3) * 26) / viewK };
    g.setAttribute('transform', `translate(${entry.x} ${entry.y}) scale(${(1 / viewK).toFixed(4)})`);
    bubbles.add(entry);
    setTimeout(() => {
      g.remove();
      bubbles.delete(entry);
      bubbleCount[place] = Math.max(0, (bubbleCount[place] || 1) - 1);
    }, 4000);
  }

  function ripple(place) {
    if (!xy[place]) return;
    const [x, y] = xy[place];
    const c = el('circle', { class: 'ripple', cx: x, cy: y, r: 40 });
    L.fx.append(c);
    setTimeout(() => c.remove(), 2200);
  }

  /** 拆解：建筑闪一下，残料环随下一次状态缩短 */
  function flash(place) {
    const pe = placeEls[place];
    if (!pe || reduceMotion()) return;
    pe.g.classList.remove('flash');
    requestAnimationFrame(() => pe.g.classList.add('flash'));
    setTimeout(() => pe.g.classList.remove('flash'), 800);
  }

  function onEvent(e) {
    if (e.type === 'say' && e.place && e.data && !e.redacted) bubble(e.place, e.data.text, 'say');
    else if (e.type === 'broadcast' && e.place) {
      ripple(e.place);
      bubble(e.place, e.data.text, 'broadcast');
    } else if (e.type === 'death' && e.data) {
      const ae = agentEls.get(e.data.agentId);
      ensureStar(e.data.agentId, ae ? ae.pos : null);
    } else if (e.type === 'dismantle' && e.data) flash(e.data.place);
    else if (e.type === 'razed' && e.data) {
      flash(e.data.place);
      ripple(e.data.place);
    } else if (e.type === 'weather_start' && e.data && e.data.type === 'quake' && !reduceMotion()) {
      svg.classList.remove('quaking');
      requestAnimationFrame(() => svg.classList.add('quaking'));
      setTimeout(() => svg.classList.remove('quaking'), 1400);
    }
  }

  requestAnimationFrame(() => view.setState(savedViews[map.id]));
  layoutHud();

  const api = {
    setState,
    setTick,
    setColorMode,
    onEvent,
    bubble,
    ripple,
    zoomIn: () => view.zoomBy(1.5),
    zoomOut: () => view.zoomBy(1 / 1.5),
    fit: () => view.fit(),
    placeConditionOf: (id) => (state ? state.places.find((p) => p.id === id) : null),
    destroy() {
      view.destroy();
      if (current === api) current = null;
    },
  };
  void getLang;
  current = api;
  return api;
}
