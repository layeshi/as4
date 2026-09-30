// 观测站的地图（SPEC §14.1、附录 C）：按 /api/public/map 的地图数据绘制，赛博朋克 + 废土的风格，可缩放平移。
// 只用 SVG 属性、classList 与 CSSOM 设置样式（CSP 不允许 style 属性字符串），所有文字用 textContent。
//
// 分层：底图（地面、海与幕、河、街区、城墙、街道、废土装饰）→ 道路 → 地点 → 设施与工程 → 居民 → 文字 → 特效；
// 顶部的天穹带（逝者之星）是固定在屏幕上的 HUD，不随地图缩放。

import { t } from './i18n.js';
import { el, drawGlyph, GLYPH_HUE, TOMB_SLOTS, facilityIcon, projectIcon, FLAME_D, starPath } from './map-glyphs.js';
import { drawDefs, drawTerrain, hash32, streetCurve } from './map-terrain.js';
import { createView } from './map-view.js';

const HUD = 40;
const GOLDEN = 2.399963229728653;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const hash01 = (s) => (hash32(s) % 100000) / 100000;
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const SCRIPT_HUE = { han: 8, latin: 190, kana: 330, hangul: 300, arabic: 125, cyrillic: 275, devanagari: 40, greek: 165, hebrew: 95, thai: 55 };

function agentColor(a, mode) {
  if (a.status === 'dormant') return 'hsl(220 12% 40%)';
  if (mode === 'script') {
    const h = a.script && SCRIPT_HUE[a.script] !== undefined ? SCRIPT_HUE[a.script] : null;
    return h === null ? 'hsl(200 20% 72%)' : `hsl(${h} 95% 64%)`;
  }
  const g = a.groups && a.groups[0];
  return g ? `hsl(${Math.floor(hash01(g) * 360)} 95% 63%)` : 'hsl(185 55% 82%)';
}

/** 按码点截断到 max 个字符（气泡最多 24 个） */
export function clip(text, max = 24) {
  const cps = [...String(text)];
  return cps.length > max ? `${cps.slice(0, max).join('')}…` : cps.join('');
}

/** 缩放级别（相对「全图」的倍数）：far 看全城，mid 看街区，near 看一处 */
function lodOf(k, fitK) {
  const r = k / fitK;
  return r < 1.45 ? 'far' : r < 2.8 ? 'mid' : 'near';
}
/** 居民的放大倍数：缩得越小放得越大，让焰在屏幕上始终看得见（按 0.1 取整，变化时才重新排布） */
const agentScaleFor = (k) => Math.round(clamp(0.95 / k, 1, 2.2) * 10) / 10;

/** 一日里的时辰：夜（0–2、10–11 刻）、晨昏（3、9 刻）、昼 */
function timeOfDay(tickOfDay) {
  if (tickOfDay <= 2 || tickOfDay >= 10) return 'night';
  if (tickOfDay === 3 || tickOfDay === 9) return 'dusk';
  return 'day';
}

const bandOf = (bp) => (bp >= 9000 ? 'pristine' : bp >= 6000 ? 'worn' : bp >= 3000 ? 'weathered' : bp >= 1 ? 'dilapidated' : 'ruin');

let current = null; // 当前的地图实例（重建前先拆掉旧的监听器）
const savedViews = {}; // 地图 ID → 视口（切换语言重建时恢复）

/**
 * deps：{ mapData, worldId, placeName(id), humanName(id), districtName(id), agentName(id), onAgent(id), onPlace(id) }
 * 返回 { setState, setTick, setColorMode, onEvent, bubble, ripple, zoomIn, zoomOut, fit, placeConditionOf, destroy }
 */
export function createMap(svg, deps) {
  if (current) current.destroy();
  const map = deps.mapData;
  svg.textContent = '';
  for (const c of [...svg.classList]) if (/^(map-|wx-|tod-|lod-)/.test(c)) svg.classList.remove(c);
  svg.classList.add(`map-${map.id}`, 'lod-far', 'tod-day');
  // 窄屏时地图的高度按地图的宽高比（加上天穹带）定（CSS 的 aspect-ratio 读这个变量）
  svg.style.setProperty('--map-aspect', `${map.size[0]} / ${Math.round(map.size[1] * 1.08 + 30)}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', t('map'));

  const defs = el('defs');
  drawDefs(defs);
  const world = el('g', { class: 'world' });
  const shake = el('g', { class: 'shake' }); // 震：只晃这一层（world 的 transform 属性不受 CSS 动画影响）
  world.append(shake);
  const L = {};
  for (const name of ['ground', 'water', 'districts', 'wall', 'streets', 'roads', 'waste', 'places', 'facilities', 'agents', 'weather', 'districtLabels', 'labels', 'fx']) {
    L[name] = el('g', { class: `layer-${name}` });
    shake.append(L[name]);
  }
  const hud = el('g', { class: 'hud' });
  svg.append(defs, world, hud);

  const { xy, curves } = drawTerrain(L, map, {
    worldId: deps.worldId || '',
    names: { district: (id) => (deps.districtName ? deps.districtName(id) : id), far: t('mapFar') },
  });
  const byId = {};
  for (const p of map.places) byId[p.id] = p;
  const adj = {};
  for (const p of map.places) adj[p.id] = [];
  for (const s of map.streets) {
    adj[s.a].push({ to: s.b, cost: s.cost });
    adj[s.b].push({ to: s.a, cost: s.cost });
  }

  // ── 天象的画面（平时隐藏，按根上的 wx-* 显示） ──
  const [MW, MH] = map.size;
  const port = byId.port ? byId.port.xy : [80, MH / 2];
  const fog = el('g', { class: 'fx-fog' });
  for (let i = 0; i < 7; i++) {
    const r = hash01(`fog${i}`);
    fog.append(el('ellipse', { class: 'fog-wisp', cx: port[0] - 60 + r * 260, cy: port[1] - 240 + i * 80, rx: 160 + r * 120, ry: 26 + r * 18 }));
  }
  const boats = el('g', { class: 'fx-boats' });
  for (let i = 0; i < 3; i++) boats.append(el('path', { class: 'boat', d: `M${port[0] - 150 + i * 28},${port[1] - 40 + i * 42} l24,0 l-5,7 l-15,0 z M${port[0] - 138 + i * 28},${port[1] - 40 + i * 42} v-14 l9,11 z` }));
  const eclipse = el('rect', { class: 'fx-eclipse', x: 0, y: 0, width: MW, height: MH });
  L.weather.append(fog, boats, eclipse);

  // ── 地点 ──
  const placeEls = {};
  for (const p of map.places) {
    const [x, y] = p.xy;
    const g = el('g', {
      class: `place hue-${GLYPH_HUE[p.glyph] || 'cyan'} glyph-${p.glyph}${p.wild ? ' wild' : ''} cond-open`,
      transform: `translate(${x} ${y})`, tabindex: 0, role: 'button', 'data-place': p.id,
    });
    const title = el('title');
    const glyph = el('g', { class: 'glyph' });
    drawGlyph(glyph, p.glyph);
    g.append(title, el('rect', { class: 'hit', x: -46, y: -44, width: 92, height: 74 }), glyph, el('path', { class: 'crack', d: 'M-14,-18 l7,10 l-5,7 l9,9 l-3,9' }));
    g.addEventListener('click', () => deps.onPlace && deps.onPlace(p.id));
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (deps.onPlace) deps.onPlace(p.id);
      }
    });
    L.places.append(g);
    const label = el('text', { class: `label${p.wild ? ' wild' : ''}`, x, y: y + 26, dy: '1em', 'text-anchor': 'middle' });
    const sub = el('text', { class: 'label-sub', x, y: y + 26, dy: '2.55em', 'text-anchor': 'middle' });
    const badge = el('text', { class: 'badge', x: x + 36, y: y - 30, 'text-anchor': 'start' });
    L.labels.append(label, sub, badge);
    placeEls[p.id] = { g, title, label, sub, badge, tombs: [...glyph.querySelectorAll('.tomb')] };
  }

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
  const agents = new Map(); // id → { profile, place, energy, status }
  const agentEls = new Map(); // id → { g, pos: [x, y], place }
  const starEls = new Map(); // id → g
  const bubbles = new Set(); // { g, x, y }
  const bubbleCount = {};

  // ── 视口 ──
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

  // ── 地点的外观 ──
  function paintPlace(p) {
    const pe = placeEls[p.id];
    if (!pe) return;
    const band = p.condition === null || p.condition === undefined ? 'open' : p.ruined ? 'ruin' : bandOf(p.condition);
    for (const c of ['open', 'pristine', 'worn', 'weathered', 'dilapidated', 'ruin']) pe.g.classList.toggle(`cond-${c}`, c === band);
    const name = deps.placeName(p.id);
    pe.label.textContent = name;
    pe.sub.textContent = p.renamedBy ? deps.humanName(p.id) : '';
    const cond = p.condition === null ? t('fx_open') : `${t('condition')} ${(p.condition / 100).toFixed(0)}%`;
    pe.title.textContent = `${name} · ${cond}`;
    pe.g.setAttribute('aria-label', `${name} ${cond}`);
  }

  // ── 设施、工程、道路、征兆 ──
  function roadCurve(a, b) {
    return curves[[a, b].sort().join('|')] || streetCurve(xy, a, b);
  }

  function redrawFacilities() {
    L.roads.textContent = '';
    L.facilities.textContent = '';
    const slot = {};
    const iconAt = (place) => {
      const i = (slot[place] = (slot[place] || 0) + 1) - 1;
      const [x, y] = xy[place];
      return [x - 30 + i * 21, y - 58];
    };
    for (const p of state.places) {
      if (!xy[p.id]) continue;
      for (const f of p.facilities) {
        if (f.type === 'road') {
          if (!xy[f.to]) continue;
          const ok = f.functioning && !f.ruined;
          const path = el('path', { class: ok ? 'road' : 'road broken', d: roadCurve(f.place, f.to).d });
          path.append(el('title', {}, `${f.name} · ${(f.condition / 100).toFixed(0)}%`));
          L.roads.append(path);
          continue;
        }
        const [ix, iy] = iconAt(p.id);
        const g = facilityIcon(f.type);
        g.classList.toggle('off', !f.functioning || f.ruined);
        g.setAttribute('transform', `translate(${ix} ${iy})`);
        if (f.ruined) g.append(el('path', { class: 'facility-x', d: 'M-7,-7 L7,7 M7,-7 L-7,7' }));
        g.append(el('title', {}, `${f.name} · ${(f.condition / 100).toFixed(0)}%`));
        L.facilities.append(g);
      }
      for (const j of p.projects) {
        if (j.type === 'road' && xy[j.to]) {
          const path = el('path', { class: 'road planned', d: roadCurve(j.place, j.to).d });
          path.append(el('title', {}, `${j.name} · ${j.have}/${j.need}`));
          L.roads.append(path);
        }
        const [ix, iy] = iconAt(p.id);
        const g = projectIcon(clamp(j.have / Math.max(1, j.need), 0, 1));
        g.setAttribute('transform', `translate(${ix} ${iy})`);
        g.append(el('title', {}, `${j.name} · ${j.have}/${j.need}`));
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
      // CSS 的 transform 在动画期间取代 transform 属性，所以两端都写绝对位置
      const [fx, fy] = view.toScreen(fromWorld[0], fromWorld[1]);
      g.animate([{ transform: `translate(${fx}px, ${fy}px)`, opacity: 0.2 }, { transform: `translate(${x}px, ${y}px)`, opacity: 1 }], { duration: 2400, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
  }

  // ── 居民 ──
  function flameScale(energy) {
    return clamp(0.7 + Math.sqrt(Math.max(0, energy)) * 0.085, 0.7, 1.75) * agentScale;
  }

  function slotPosition(place, i) {
    const p = byId[place];
    const [cx, cy] = p.xy;
    const s = agentScale;
    const base = p.glyph === 'agora' ? 36 : 50;
    const rad = base + 8 * s * Math.sqrt(i);
    const ang = i * GOLDEN + hash01(place) * 6.28;
    return [cx + Math.cos(ang) * rad * 1.3, cy + 6 + Math.sin(ang) * rad * 0.82];
  }

  /** 两地之间沿街道（与正常运转的道路）的途经点，只用于动画 */
  function waypoints(from, to) {
    if (!adj[from] || !adj[to]) return [];
    const extra = [];
    if (state) {
      for (const p of state.places) {
        for (const f of p.facilities) if (f.type === 'road' && f.functioning && !f.ruined && adj[f.to]) extra.push({ a: f.place, b: f.to });
      }
    }
    const nb = (u) => [...adj[u], ...extra.filter((e) => e.a === u || e.b === u).map((e) => ({ to: e.a === u ? e.b : e.a, cost: 0 }))];
    const dist = { [from]: 0 };
    const prev = {};
    const done = new Set();
    for (;;) {
      let u = null;
      for (const id of Object.keys(dist)) if (!done.has(id) && (u === null || dist[id] < dist[u])) u = id;
      if (u === null || u === to) break;
      done.add(u);
      for (const { to: v, cost } of nb(u)) {
        const nd = dist[u] + cost + 0.001; // 同代价时少走几段
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
      out.push(roadCurve(path[i - 1], path[i]).mid, xy[path[i]]);
    }
    return out;
  }

  const tf = ([x, y], s) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(3)})`;

  function layoutAgents({ animate = true, moved = new Set() } = {}) {
    const byPlace = {};
    for (const [id, a] of agents) {
      if (a.status === 'dead' || a.status === 'retired' || !a.place || !byId[a.place]) continue;
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
          g2(ae, target, scale, motion ? (moved.has(id) && fromPlace !== place ? waypoints(fromPlace, place) : []) : null, from);
          ae.place = place;
          ae.pos = target;
        }
        const color = agentColor({ ...(a.profile || {}), status: a.status }, colorMode);
        ae.g.lastChild.setAttribute('fill', color);
        ae.g.children[1].setAttribute('fill', color);
        ae.g.classList.toggle('dormant', a.status === 'dormant');
        ae.g.classList.toggle('exiled', !!(a.profile && a.profile.exiled));
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

  /** 把一位居民移到 target：有途经点时沿街道走过去，否则平滑挪到新位置 */
  function g2(ae, target, scale, via, from) {
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

  // ── 天象与时辰 ──
  function applyWeather(active) {
    const types = new Set((active || []).map((x) => x.type));
    for (const c of [...svg.classList]) if (c.startsWith('wx-') && !types.has(c.slice(3))) svg.classList.remove(c);
    for (const type of types) svg.classList.add(`wx-${type}`);
  }

  function applyTime(tick) {
    const tod = timeOfDay(((tick % ticksPerDay) + ticksPerDay) % ticksPerDay);
    for (const x of ['day', 'dusk', 'night']) svg.classList.toggle(`tod-${x}`, x === tod);
  }

  // ── 对外接口 ──
  function setState(s) {
    state = s;
    ticksPerDay = s.world.ticksPerDay || 12;
    for (const p of s.places) paintPlace(p);
    const graves = Math.min(TOMB_SLOTS, s.cemetery ? s.cemetery.length : 0);
    for (const pe of Object.values(placeEls)) pe.tombs.forEach((tomb, i) => tomb.classList.toggle('filled', i < graves));
    redrawFacilities();
    agents.clear();
    for (const a of s.agents) {
      agents.set(a.id, { profile: a, place: a.place, energy: a.energy, status: a.status });
      if (a.status === 'dead') ensureStar(a.id);
    }
    layoutAgents({ animate: false });
    applyWeather(s.weather && s.weather.active);
    applyTime(s.world.tick);
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
    // 同一处同时冒出的气泡往上叠（屏幕上的间距固定）
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

  function onEvent(e) {
    if (e.type === 'say' && e.place && e.data && !e.redacted) bubble(e.place, e.data.text, 'say');
    else if (e.type === 'broadcast' && e.place) {
      ripple(e.place);
      bubble(e.place, e.data.text, 'broadcast');
    } else if (e.type === 'death' && e.data) {
      const ae = agentEls.get(e.data.agentId);
      ensureStar(e.data.agentId, ae ? ae.pos : null);
    } else if (e.type === 'weather_start' && e.data && e.data.type === 'quake' && !reduceMotion()) {
      svg.classList.remove('quaking');
      requestAnimationFrame(() => svg.classList.add('quaking'));
      setTimeout(() => svg.classList.remove('quaking'), 1400);
    }
  }

  // 初始视口：恢复上一次（切换语言重建时），否则看全图
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
  current = api;
  return api;
}
