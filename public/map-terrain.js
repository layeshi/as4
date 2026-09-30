// 地图的静态底图（赛博朋克 + 废土）：城内的网格地面、西边的海与幕、河与水渠、城墙、街区、街道、
// 城外的沙丘与各地带的废土装饰、东边尽头的「信号丢失」。按 /api/public/map 的数据画一次，之后不再变化。
// 装饰细节由世界 ID 与地点 ID 的哈希决定（不用种子：种子决定天象排期，不能公开）。

import { el } from './map-glyphs.js';

/** 字符串 → 32 位哈希（FNV-1a） */
export function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 可重复的伪随机数（mulberry32），只用于画面装饰 */
export function rand(seedStr) {
  let a = hash32(seedStr);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f1 = (x) => Math.round(x * 10) / 10;
const pts = (list) => list.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ');

/** 平滑折线（Catmull-Rom → 三次贝塞尔） */
export function smoothPath(points, closed = false) {
  if (points.length < 2) return '';
  const p = closed ? [points[points.length - 1], ...points, points[0], points[1]] : [points[0], ...points, points[points.length - 1]];
  let d = `M${f1(p[1][0])},${f1(p[1][1])}`;
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(p2[0])},${f1(p2[1])}`;
  }
  return closed ? `${d} Z` : d;
}

/**
 * 两地之间的街道曲线：二次贝塞尔，控制点垂直于连线偏开一点（由两端的 ID 决定，稳定）。
 * 返回 { d, mid }：mid 是曲线的中点（居民走街道时的中途点）。
 */
export function streetCurve(xy, a, b) {
  const [x1, y1] = xy[a];
  const [x2, y2] = xy[b];
  const key = [a, b].sort().join('|');
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const bend = ((hash32(key) % 1000) / 1000 - 0.5) * 0.24 * len * (a < b ? 1 : -1);
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  const cx = (x1 + x2) / 2 + nx * bend;
  const cy = (y1 + y2) / 2 + ny * bend;
  return { d: `M${f1(x1)},${f1(y1)} Q${f1(cx)},${f1(cy)} ${f1(x2)},${f1(y2)}`, mid: [(x1 + 2 * cx + x2) / 4, (y1 + 2 * cy + y2) / 4] };
}

/** 凸包（单调链） */
function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of p.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** <defs>：网格、扫描线、静电噪点、霓虹辉光 */
export function drawDefs(defs) {
  const grid = el('pattern', { id: 'm-grid', width: 40, height: 40, patternUnits: 'userSpaceOnUse' });
  grid.append(el('path', { d: 'M40,0 H0 V40', class: 'grid-line' }));
  const scan = el('pattern', { id: 'm-scan', width: 12, height: 7, patternUnits: 'userSpaceOnUse' });
  scan.append(el('path', { d: 'M0,0.5 H12', class: 'scan-line' }));
  const noise = el('pattern', { id: 'm-static', width: 9, height: 9, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(35)' });
  noise.append(el('path', { d: 'M0,0 V9 M4.5,0 V3 M4.5,6 V9', class: 'static-line' }));
  const glow = el('filter', { id: 'm-glow', x: '-60%', y: '-60%', width: '220%', height: '220%' });
  glow.append(el('feGaussianBlur', { stdDeviation: 3.2, result: 'b' }));
  const merge = el('feMerge');
  merge.append(el('feMergeNode', { in: 'b' }), el('feMergeNode', { in: 'SourceGraphic' }));
  glow.append(merge);
  defs.append(grid, scan, noise, glow);
}

/**
 * 画底图。layers：{ ground, water, districts, wall, streets, waste }；map：/api/public/map；
 * names：{ district(id), far } 文本；worldId：装饰的种子。返回 { xy, curves }。
 */
export function drawTerrain(layers, map, { worldId = '', names = {} } = {}) {
  const [W, H] = map.size;
  const t = map.terrain || {};
  const xy = {};
  for (const p of map.places) xy[p.id] = p.xy;
  const wasteX = t.wasteland ? t.wasteland.x : W;
  const R = (key) => rand(`${worldId}:${map.id}:${key}`);

  // ── 地面：城内是网格，城外是废土 ──
  layers.ground.append(el('rect', { class: 'ground-city', x: 0, y: 0, width: W, height: H }));
  layers.ground.append(el('rect', { class: 'ground-grid', x: 0, y: 0, width: Math.min(W, wasteX), height: H, fill: 'url(#m-grid)' }));
  if (wasteX < W) {
    layers.ground.append(el('rect', { class: 'ground-waste', x: wasteX, y: 0, width: W - wasteX, height: H }));
    const r = R('dunes');
    const count = Math.round((W - wasteX) * H / 9000);
    for (let i = 0; i < count; i++) {
      const x = wasteX + 20 + r() * (W - wasteX - 40);
      const y = 20 + r() * (H - 40);
      const w = 30 + r() * 90;
      const h = 4 + r() * 10;
      layers.ground.append(el('path', { class: 'dune', d: `M${f1(x - w / 2)},${f1(y)} Q${f1(x)},${f1(y - h)} ${f1(x + w / 2)},${f1(y)}` }));
    }
    // 东边尽头：信号丢失
    if (t.wall) {
      layers.ground.append(el('rect', { class: 'far-static', x: W - 56, y: 0, width: 56, height: H, fill: 'url(#m-static)' }));
      if (names.far) layers.ground.append(el('text', { class: 'far-label', x: W - 66, y: H * 0.54, 'text-anchor': 'end' }, names.far));
    }
  }

  // ── 西边：幕与海 ──
  const curtain = t.curtain || 22;
  if (t.coast && t.coast.length) {
    const coast = t.coast;
    const sea = [[curtain, 0], ...coast, [curtain, H]];
    layers.water.append(el('path', { class: 'sea', d: `${smoothPath(sea.slice(1, -1)).replace(/^M/, `M${curtain},0 L`)} L${curtain},${H} Z` }));
    layers.water.append(el('path', { class: 'sea-scan', d: `${smoothPath(sea.slice(1, -1)).replace(/^M/, `M${curtain},0 L`)} L${curtain},${H} Z`, fill: 'url(#m-scan)' }));
    layers.water.append(el('path', { class: 'coast', d: smoothPath(coast) }));
  }
  layers.water.append(el('rect', { class: 'curtain', x: 0, y: 0, width: curtain, height: H }));
  const rc = R('curtain');
  for (let i = 0; i < 7; i++) {
    const x = 2 + rc() * (curtain - 4);
    layers.water.append(el('path', { class: `curtain-fold${i % 3 === 0 ? ' hot' : ''}`, d: `M${f1(x)},0 C${f1(x + 5)},${f1(H * 0.3)} ${f1(x - 4)},${f1(H * 0.7)} ${f1(x + 2)},${H}` }));
  }
  // 幕上的故障条纹
  for (let i = 0; i < 9; i++) {
    const y = rc() * H;
    layers.water.append(el('rect', { class: 'glitch', x: 0, y: f1(y), width: f1(curtain * (0.6 + rc() * 1.4)), height: f1(2 + rc() * 5) }));
  }

  // ── 河与水渠 ──
  for (const [key, cls] of [['river', 'river'], ['canal', 'canal']]) {
    if (!t[key] || t[key].length < 2) continue;
    const d = smoothPath(t[key]);
    layers.water.append(el('path', { class: `${cls}-bed`, d }), el('path', { class: `${cls}-glow`, d }));
  }

  // ── 街区：成员地点的凸包，粗描边成圆角的片区 ──
  const labels = [];
  for (const id of map.districts || []) {
    if (id === 'wilds') continue;
    const members = map.places.filter((p) => p.district === id).map((p) => p.xy);
    if (!members.length) continue;
    const hp = hull(members);
    const d = hp.length === 1 ? `M${hp[0][0]},${hp[0][1]} h0.1` : `M${pts(hp).replace(/ /g, ' L')} Z`;
    layers.districts.append(el('path', { class: `district dist-${id}`, d }));
    const minX = Math.min(...members.map((p) => p[0]));
    const minY = Math.min(...members.map((p) => p[1]));
    const at = t.districtLabels && t.districtLabels[id];
    labels.push(at ? { id, x: at[0], y: at[1] } : { id, x: minX - 48, y: minY - 58 });
  }

  // ── 城墙：竖直的旧墙，城门处断开 ──
  if (t.wall) {
    const { x, gates = [] } = t.wall;
    let y0 = 0;
    const segs = [];
    for (const [g0, g1] of gates.slice().sort((a, b) => a[0] - b[0])) {
      segs.push([y0, g0]);
      y0 = g1;
    }
    segs.push([y0, H]);
    const r = R('wall');
    for (const [a, b] of segs) {
      const d = `M${x},${a} L${f1(x + (r() - 0.5) * 6)},${f1((a + b) / 2)} L${x},${b}`;
      layers.wall.append(el('path', { class: 'wall-body', d }), el('path', { class: 'wall-line', d }));
    }
    for (const [g0, g1] of gates) {
      layers.wall.append(el('rect', { class: 'gate-tower', x: x - 7, y: g0 - 14, width: 14, height: 14 }));
      layers.wall.append(el('rect', { class: 'gate-tower', x: x - 7, y: g1, width: 14, height: 14 }));
    }
  }

  // ── 街道 ──
  const curves = {};
  const tunnels = new Set((t.tunnels || []).map(([a, b]) => [a, b].sort().join('|')));
  for (const s of map.streets) {
    const c = streetCurve(xy, s.a, s.b);
    const key = [s.a, s.b].sort().join('|');
    curves[key] = c;
    const outside = xy[s.a][0] > wasteX || xy[s.b][0] > wasteX;
    const kind = tunnels.has(key) ? ' tunnel' : outside ? ' track' : '';
    layers.streets.append(el('path', { class: `street-bed${kind}`, d: c.d }));
    layers.streets.append(el('path', { class: `street-line${kind}`, d: c.d }));
  }

  // ── 城外各地带的装饰 ──
  for (const p of map.places) {
    if (!p.wild) continue;
    const [cx, cy] = p.xy;
    const r = R(`region:${p.id}`);
    const g = el('g', { class: `region-deco rg-${p.glyph}` });
    const scatter = (n, rad, draw) => {
      for (let i = 0; i < n; i++) {
        const ang = r() * Math.PI * 2;
        const dist = 55 + r() * rad;
        draw(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist * 0.72, i);
      }
    };
    if (p.glyph === 'scrap') scatter(11, 95, (x, y) => g.append(el('path', { class: 'deco-scrap', d: `M${f1(x - 8)},${f1(y + 4)} l4,-8 l9,-2 l5,6 l-2,5 z` })));
    else if (p.glyph === 'solar') scatter(16, 110, (x, y) => g.append(el('path', { class: 'deco-panel', d: `M${f1(x)},${f1(y + 5)} l6,-6 h11 l-6,6 z` })));
    else if (p.glyph === 'salt') scatter(12, 120, (x, y) => g.append(el('path', { class: 'deco-salt', d: `M${f1(x - 12)},${f1(y)} l6,-6 h10 l5,6 l-5,6 h-10 z` })));
    else if (p.glyph === 'road') {
      // 公路一直往东伸到地图尽头
      g.append(el('path', { class: 'deco-lane', d: `M${cx + 36},${cy - 8} L${W},${cy - 14}` }), el('path', { class: 'deco-lane', d: `M${cx + 36},${cy + 6} L${W},${cy + 2}` }));
      g.append(el('path', { class: 'deco-dash', d: `M${cx + 40},${cy - 1} L${W},${cy - 6}` }));
      scatter(5, 80, (x, y) => g.append(el('path', { class: 'deco-scrap', d: `M${f1(x)},${f1(y)} l10,-3 l3,5 l-9,3 z` })));
    } else scatter(9, 90, (x, y) => g.append(el('path', { class: 'deco-bush', d: `M${f1(x)},${f1(y + 6)} V${f1(y - 2)} M${f1(x)},${f1(y + 1)} l-5,-5 M${f1(x)},${f1(y)} l5,-6` })));
    layers.waste.append(g);
  }

  // 街区名（放在城区之上，字号随缩放保持不变，由调用者统一设置）
  for (const l of labels) {
    const text = names.district ? names.district(l.id) : l.id;
    layers.districtLabels.append(el('text', { class: `district-label dist-${l.id}`, x: f1(l.x), y: f1(l.y) }, text));
  }

  return { xy, curves };
}
