// 观测站的地图（SPEC §14.1、附录 B）：SVG，viewBox 0 0 1000 640。
// 只用 SVG 属性、classList 与 CSSOM 设置样式（CSP 不允许 style 属性字符串），所有文字用 textContent。

import { t } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';

export const PLACE_XY = {
  port: [80, 380], school: [230, 300], library: [250, 170], parliament: [470, 140], court: [640, 210], temple: [820, 140],
  agora: [480, 330], market: [690, 370], wilds: [910, 420], hospital: [300, 480], well: [500, 530], cemetery: [730, 545],
};

const STREETS = [
  ['port', 'school'], ['port', 'hospital'], ['school', 'library'], ['school', 'agora'], ['library', 'parliament'], ['parliament', 'agora'],
  ['parliament', 'court'], ['court', 'temple'], ['court', 'agora'], ['agora', 'market'], ['agora', 'well'], ['market', 'wilds'],
  ['market', 'cemetery'], ['well', 'hospital'], ['well', 'cemetery'], ['temple', 'wilds'],
];

/** 每处地点的基调色相 */
const HUE = { port: 205, school: 45, library: 265, parliament: 18, court: 335, temple: 170, market: 35, well: 190, hospital: 150, cemetery: 250, agora: 60, wilds: 110 };

const BOX_W = 112;
const BOX_H = 54;
const OPEN_KINDS = new Set(['agora', 'wilds']);
const GOLDEN = 2.399963229728653;

function el(name, attrs = {}, text) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}

/** 字符串 → 稳定的 0..1（FNV-1a） */
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const SCRIPT_HUE = { han: 8, latin: 205, kana: 330, hangul: 300, arabic: 125, cyrillic: 275, devanagari: 40, greek: 165, hebrew: 95, thai: 55 };

function agentColor(a, mode) {
  if (a.status === 'dormant') return 'hsl(220 10% 42%)';
  if (mode === 'script') {
    const h = a.script && SCRIPT_HUE[a.script] !== undefined ? SCRIPT_HUE[a.script] : null;
    return h === null ? 'hsl(215 12% 66%)' : `hsl(${h} 70% 62%)`;
  }
  const g = a.groups && a.groups[0];
  return g ? `hsl(${Math.floor(hash01(g) * 360)} 68% 62%)` : 'hsl(215 12% 68%)';
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** 按码点截断到 max 个字符（气泡最多 24 个） */
export function clip(text, max = 24) {
  const cps = [...String(text)];
  return cps.length > max ? `${cps.slice(0, max).join('')}…` : cps.join('');
}

/**
 * deps：{ placeName(id), humanName(id), agentName(id), onAgent(id), onPlace(id) }
 * 返回 { setState, setTick, onEvent, setColorMode, resize }
 */
export function createMap(svg, deps) {
  svg.textContent = '';
  svg.setAttribute('viewBox', '0 0 1000 640');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t('map'));

  // ── 静态层 ──
  const defs = el('defs');
  const skyGrad = el('linearGradient', { id: 'skyGrad', x1: 0, y1: 0, x2: 0, y2: 1 });
  skyGrad.append(el('stop', { offset: '0%', class: 'sky-a' }), el('stop', { offset: '100%', class: 'sky-b' }));
  const curtainGrad = el('linearGradient', { id: 'curtainGrad', x1: 0, y1: 0, x2: 1, y2: 0 });
  curtainGrad.append(el('stop', { offset: '0%', class: 'curtain-a' }), el('stop', { offset: '100%', class: 'curtain-b' }));
  defs.append(skyGrad, curtainGrad);
  svg.append(defs);

  const layers = {};
  for (const name of ['sky', 'streets', 'roads', 'places', 'facilities', 'agents', 'fx', 'curtain']) {
    layers[name] = el('g', { class: `layer-${name}` });
    svg.append(layers[name]);
  }

  layers.sky.append(el('rect', { class: 'sky-band', x: 0, y: 0, width: 1000, height: 70, fill: 'url(#skyGrad)' }));
  layers.sky.append(el('text', { class: 'sky-label', x: 500, y: 64, 'text-anchor': 'middle' }, t('skyLabel')));
  const starsG = el('g', { class: 'stars' });
  layers.sky.append(starsG);

  for (const [a, b] of STREETS) {
    const [x1, y1] = PLACE_XY[a];
    const [x2, y2] = PLACE_XY[b];
    layers.streets.append(el('line', { class: 'street', x1, y1, x2, y2 }));
  }

  // 幕：左侧边缘一道竖向的帷幕
  layers.curtain.append(el('rect', { class: 'curtain-body', x: 0, y: 70, width: 22, height: 570, fill: 'url(#curtainGrad)' }));
  for (let i = 0; i < 6; i++) {
    const x = 3 + i * 3.4;
    layers.curtain.append(el('path', { class: 'curtain-fold', d: `M${x} 70 C ${x + 4} 250, ${x - 3} 450, ${x + 2} 640` }));
  }
  layers.curtain.append(el('text', { class: 'curtain-label', x: 11, y: 350, transform: 'rotate(-90 11 350)', 'text-anchor': 'middle' }, t('curtain')));

  // ── 地点 ──
  const placeEls = {};
  for (const [id, [x, y]] of Object.entries(PLACE_XY)) {
    const g = el('g', { class: 'place', 'data-place': id, tabindex: 0, role: 'button' });
    const open = OPEN_KINDS.has(id);
    const shape = open
      ? el('ellipse', { class: 'place-shape', cx: x, cy: y, rx: BOX_W / 2, ry: BOX_H / 2 + 4 })
      : el('rect', { class: 'place-shape', x: x - BOX_W / 2, y: y - BOX_H / 2, width: BOX_W, height: BOX_H, rx: 10 });
    const crack = el('path', { class: 'place-crack', d: `M${x - 18} ${y - BOX_H / 2} l 9 14 l -7 9 l 11 12 l -4 8` });
    const name = el('text', { class: 'place-name', x, y: y + 5, 'text-anchor': 'middle' });
    const human = el('text', { class: 'place-human', x, y: y + BOX_H / 2 + 12, 'text-anchor': 'middle' });
    const title = el('title');
    g.append(title, shape, crack, name, human);
    g.addEventListener('click', () => deps.onPlace && deps.onPlace(id));
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        if (deps.onPlace) deps.onPlace(id);
      }
    });
    layers.places.append(g);
    placeEls[id] = { g, shape, crack, name, human, title, open };
  }

  // ── 动态状态 ──
  let colorMode = 'group';
  let state = null;
  const agents = new Map(); // id → { profile, place, energy, status }
  const agentEls = new Map(); // id → circle
  const starEls = new Map(); // id → g
  const bubbleCount = {};
  let lastPlacePop = {};

  const placeCondition = (p) => (p.condition === null || p.condition === undefined ? 1 : clamp(p.condition / 10000, 0, 1));

  function paintPlace(p) {
    const pe = placeEls[p.id];
    if (!pe) return;
    const c = placeCondition(p);
    const hue = HUE[p.id] ?? 200;
    const ruin = p.ruined || (p.condition !== null && p.condition <= 0);
    const sat = ruin ? 0 : Math.round(18 + 52 * c);
    const light = ruin ? 32 : Math.round(24 + 10 * c);
    const alpha = ruin ? 0.55 : 0.4 + 0.6 * c;
    pe.shape.setAttribute('fill', `hsl(${hue} ${sat}% ${light}% / ${alpha.toFixed(2)})`);
    pe.shape.setAttribute('stroke', ruin ? 'hsl(0 0% 55%)' : `hsl(${hue} ${Math.max(30, sat)}% ${45 + Math.round(15 * c)}%)`);
    pe.shape.setAttribute('stroke-width', ruin ? 1.5 : 1.8);
    const worn = p.condition !== null && p.condition < 3000;
    if (ruin) pe.shape.setAttribute('stroke-dasharray', '14 8');
    else if (worn) pe.shape.setAttribute('stroke-dasharray', '6 4');
    else if (pe.open) pe.shape.setAttribute('stroke-dasharray', '2 5');
    else pe.shape.removeAttribute('stroke-dasharray');
    pe.crack.style.display = ruin ? 'block' : 'none';
    pe.name.textContent = deps.placeName(p.id);
    pe.human.textContent = p.renamedBy ? deps.humanName(p.id) : '';
    const cond = p.condition === null ? t('fx_open') : `${t('condition')} ${(p.condition / 100).toFixed(0)}%`;
    pe.title.textContent = `${deps.placeName(p.id)} · ${cond}`;
    pe.g.setAttribute('aria-label', `${deps.placeName(p.id)} ${cond}`);
  }

  function redrawFacilities() {
    layers.roads.textContent = '';
    layers.facilities.textContent = '';
    const slot = {};
    const iconAt = (place, i) => {
      const [x, y] = PLACE_XY[place];
      return [x - BOX_W / 2 + 10 + i * 19, y - BOX_H / 2 - 12];
    };
    for (const p of state.places) {
      for (const f of p.facilities) {
        if (f.type === 'road') {
          const [x1, y1] = PLACE_XY[f.place];
          const [x2, y2] = PLACE_XY[f.to];
          const ok = f.functioning && !f.ruined;
          const line = el('line', { class: ok ? 'road' : 'road broken', x1, y1, x2, y2 });
          line.append(el('title', {}, `${f.name} · ${(f.condition / 100).toFixed(0)}%`));
          layers.roads.append(line);
          continue;
        }
        const [ix, iy] = iconAt(p.id, (slot[p.id] = (slot[p.id] || 0) + 1) - 1);
        layers.facilities.append(facilityIcon(f, ix, iy));
      }
      for (const j of p.projects) {
        if (j.type === 'road') {
          const [x1, y1] = PLACE_XY[j.place];
          const [x2, y2] = PLACE_XY[j.to];
          const line = el('line', { class: 'road planned', x1, y1, x2, y2 });
          line.append(el('title', {}, `${j.name} · ${j.have}/${j.need}`));
          layers.roads.append(line);
        }
        const [ix, iy] = iconAt(p.id, (slot[p.id] = (slot[p.id] || 0) + 1) - 1);
        layers.facilities.append(projectIcon(j, ix, iy));
      }
      if (p.omens && p.omens.length) {
        const [x, y] = PLACE_XY[p.id];
        const m = el('circle', { class: 'omen', cx: x + BOX_W / 2 - 6, cy: y - BOX_H / 2 - 4, r: 5 });
        m.append(el('title', {}, p.omens.map((o) => o.text).join(' / ')));
        layers.facilities.append(m);
      }
    }
  }

  function facilityIcon(f, x, y) {
    const g = el('g', { class: `facility ${f.functioning && !f.ruined ? '' : 'off'}`.trim(), transform: `translate(${x} ${y})` });
    const shapes = {
      reservoir: () => [el('ellipse', { cx: 0, cy: -3, rx: 6, ry: 2.6 }), el('path', { d: 'M-6 -3 v 8 a 6 2.6 0 0 0 12 0 v -8' })],
      relay: () => [el('path', { d: 'M0 -8 L 6 6 L -6 6 Z' }), el('path', { d: 'M-3 -3 q 3 -4 6 0' })],
      observatory: () => [el('circle', { cx: 0, cy: 0, r: 5.5 }), el('path', { d: 'M0 -9 v 3 M0 6 v 3 M-9 0 h 3 M6 0 h 3' })],
      monument: () => [el('path', { d: 'M0 -9 L 4.5 -1 L 3 8 L -3 8 L -4.5 -1 Z' })],
    };
    for (const s of (shapes[f.type] || shapes.monument)()) g.append(s);
    if (f.ruined) g.append(el('path', { class: 'facility-x', d: 'M-6 -6 L 6 6 M6 -6 L -6 6' }));
    g.append(el('title', {}, `${f.name} · ${(f.condition / 100).toFixed(0)}%`));
    return g;
  }

  function projectIcon(j, x, y) {
    const r = 7;
    const C = 2 * Math.PI * r;
    const frac = clamp(j.have / Math.max(1, j.need), 0, 1);
    const g = el('g', { class: 'project', transform: `translate(${x} ${y})` });
    g.append(el('circle', { class: 'project-base', cx: 0, cy: 0, r }));
    g.append(el('circle', { class: 'project-ring', cx: 0, cy: 0, r, 'stroke-dasharray': `${(frac * C).toFixed(2)} ${C.toFixed(2)}`, transform: 'rotate(-90)' }));
    g.append(el('title', {}, `${j.name} · ${j.have}/${j.need}`));
    return g;
  }

  // ── 星 ──
  function starPath(cx, cy, r) {
    return `M${cx} ${cy - r} L ${cx + r * 0.32} ${cy - r * 0.32} L ${cx + r} ${cy} L ${cx + r * 0.32} ${cy + r * 0.32} L ${cx} ${cy + r} L ${cx - r * 0.32} ${cy + r * 0.32} L ${cx - r} ${cy} L ${cx - r * 0.32} ${cy - r * 0.32} Z`;
  }

  function starPos(id) {
    return [30 + hash01(`x${id}`) * 940, 10 + hash01(`y${id}`) * 38];
  }

  function ensureStar(id, animateFrom) {
    if (starEls.has(id)) return;
    const [x, y] = starPos(id);
    const g = el('g', { class: 'star', tabindex: 0 });
    g.append(el('path', { d: starPath(0, 0, 4.2) }));
    g.append(el('title', {}, deps.agentName(id)));
    g.addEventListener('click', () => deps.onAgent && deps.onAgent(id));
    if (animateFrom) {
      g.setAttribute('transform', `translate(${animateFrom[0]} ${animateFrom[1]})`);
      g.style.transition = 'transform 2.4s cubic-bezier(.2,.7,.2,1), opacity 2.4s';
      g.style.opacity = '0.2';
      starsG.append(g);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        g.setAttribute('transform', `translate(${x} ${y})`);
        g.style.opacity = '1';
      }));
    } else {
      g.setAttribute('transform', `translate(${x} ${y})`);
      starsG.append(g);
    }
    starEls.set(id, g);
  }

  // ── 居民 ──
  function agentRadius(energy) {
    return clamp(2.8 + Math.sqrt(Math.max(0, energy)) * 0.5, 2.8, 9.5);
  }

  function slotPosition(place, i) {
    const [cx, cy] = PLACE_XY[place];
    const open = OPEN_KINDS.has(place);
    const base = open ? 34 : BOX_H / 2 + 14;
    const rad = base + 6.2 * Math.sqrt(i);
    const ang = i * GOLDEN + hash01(place) * 6.28;
    return [cx + Math.cos(ang) * rad * (open ? 1.2 : 1.35), cy + Math.sin(ang) * rad * 0.9];
  }

  function layoutAgents() {
    const byPlace = {};
    for (const [id, a] of agents) {
      if (a.status === 'dead' || a.status === 'retired' || !a.place) continue;
      (byPlace[a.place] ||= []).push(id);
    }
    lastPlacePop = {};
    const alive = new Set();
    for (const [place, ids] of Object.entries(byPlace)) {
      ids.sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
      lastPlacePop[place] = ids.length;
      ids.forEach((id, i) => {
        alive.add(id);
        const a = agents.get(id);
        let c = agentEls.get(id);
        if (!c) {
          c = el('circle', { class: 'agent', tabindex: 0, role: 'button' });
          c.append(el('title'));
          c.addEventListener('click', () => deps.onAgent && deps.onAgent(id));
          c.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') deps.onAgent && deps.onAgent(id);
          });
          layers.agents.append(c);
          agentEls.set(id, c);
          const [x0, y0] = slotPosition(place, i);
          c.style.transform = `translate(${x0}px, ${y0}px)`;
        }
        const [x, y] = slotPosition(place, i);
        c.style.transform = `translate(${x}px, ${y}px)`;
        c.setAttribute('r', agentRadius(a.energy).toFixed(1));
        c.setAttribute('fill', agentColor({ ...(a.profile || {}), status: a.status }, colorMode));
        c.classList.toggle('dormant', a.status === 'dormant');
        c.classList.toggle('exiled', !!(a.profile && a.profile.exiled));
        c.firstChild.textContent = `${deps.agentName(id)} · ${t('energyN', { n: a.energy })}`;
        c.setAttribute('aria-label', `${deps.agentName(id)} ${t('energyN', { n: a.energy })}`);
      });
    }
    for (const [id, c] of agentEls) {
      if (!alive.has(id)) {
        c.remove();
        agentEls.delete(id);
      }
    }
  }

  // ── 对外接口 ──
  function setState(s) {
    state = s;
    for (const p of s.places) paintPlace(p);
    redrawFacilities();
    agents.clear();
    for (const a of s.agents) {
      agents.set(a.id, { profile: a, place: a.place, energy: a.energy, status: a.status });
      if (a.status === 'dead') ensureStar(a.id);
    }
    layoutAgents();
  }

  function setTick(tick) {
    if (!state) return;
    for (const x of tick.agents) {
      const a = agents.get(x.id);
      if (a) {
        a.place = x.place;
        a.energy = x.energy;
        a.status = x.status;
      }
    }
    layoutAgents();
  }

  function setColorMode(mode) {
    colorMode = mode === 'script' ? 'script' : 'group';
    layoutAgents();
  }

  function bubble(place, text, kind) {
    const [x, y] = PLACE_XY[place];
    const n = (bubbleCount[place] = (bubbleCount[place] || 0) + 1);
    const g = el('g', { class: `bubble ${kind}` });
    const label = el('text', { x: 0, y: 4, 'text-anchor': 'middle' }, clip(text, 24));
    const box = el('rect', { rx: 7, ry: 7, height: 20 });
    g.append(box, label);
    layers.fx.append(g);
    let w = 60;
    try {
      w = label.getComputedTextLength() + 16;
    } catch {
      w = 12 + [...text].length * 8;
    }
    box.setAttribute('width', w.toFixed(1));
    box.setAttribute('x', (-w / 2).toFixed(1));
    box.setAttribute('y', -10);
    const bx = clamp(x, w / 2 + 26, 1000 - w / 2 - 4);
    g.setAttribute('transform', `translate(${bx} ${y - BOX_H / 2 - 30 - ((n - 1) % 3) * 24})`);
    setTimeout(() => {
      g.remove();
      bubbleCount[place] = Math.max(0, (bubbleCount[place] || 1) - 1);
    }, 4000);
  }

  function ripple(place) {
    const [x, y] = PLACE_XY[place];
    const c = el('circle', { class: 'ripple', cx: x, cy: y, r: 12 });
    layers.fx.append(c);
    setTimeout(() => c.remove(), 2200);
  }

  function onEvent(e) {
    if (e.type === 'say' && e.place && e.data && !e.redacted) bubble(e.place, e.data.text, 'say');
    else if (e.type === 'broadcast' && e.place) {
      ripple(e.place);
      bubble(e.place, e.data.text, 'broadcast');
    } else if (e.type === 'death' && e.data) {
      const a = agents.get(e.data.agentId);
      const from = a && a.place ? PLACE_XY[a.place] : null;
      ensureStar(e.data.agentId, from);
    }
  }

  return { setState, setTick, setColorMode, onEvent, bubble, ripple, placeConditionOf: (id) => (state ? state.places.find((p) => p.id === id) : null) };
}
