// 地图上的图形（赛博朋克 + 废土）：地点按 glyph 画成霓虹线稿，设施与工程是小图标。
// 每个图形以地点为原点，大致占 76 × 60 个单位。只用 SVG 属性与 class（CSP 不允许 style 属性字符串）。
//
// class 约定（颜色都在 style.css 里按地点的色系定义）：
//   b   建筑体：深色填充 + 霓虹描边      n   霓虹线（无填充）      d   暗的细节线
//   w   窗与灯：有人在时亮起              core / fire / beam / panel / salt / tomb / fence / plaza：各自的特殊部件

const NS = 'http://www.w3.org/2000/svg';

export function el(name, attrs = {}, text) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}

const P = (d, c = 'n') => ['path', { d, class: c }];
const R = (x, y, w, h, c = 'b', rx = 1.5) => ['rect', { x, y, width: w, height: h, rx, class: c }];
const C = (cx, cy, r, c = 'n') => ['circle', { cx, cy, r, class: c }];
const E = (cx, cy, rx, ry, c = 'n') => ['ellipse', { cx, cy, rx, ry, class: c }];
const Ln = (x1, y1, x2, y2, c = 'n') => ['line', { x1, y1, x2, y2, class: c }];

/** 墓园最多画几块墓碑（按真实的墓碑数点亮） */
export const TOMB_SLOTS = 12;

const GLYPHS = {
  port: () => [
    R(-40, 11, 30, 5, 'd'), R(-40, 19, 24, 4, 'd'),
    P('M-12,18 V-2 H22 V18 Z', 'b'), P('M-14,-2 L5,-12 L24,-2'),
    R(-8, 5, 8, 7, 'w'), R(2, 5, 8, 7, 'w'), R(12, 5, 7, 7, 'w'),
    P('M30,18 V-30 M30,-30 H-2 M30,-21 L20,-30 M0,-30 V-16'), C(0, -13, 2.5, 'w'),
  ],
  lighthouse: () => [
    P('M-40,-22 L-8,-24 M-40,-30 L-8,-25', 'beam'),
    P('M-9,20 L-5,-16 H5 L9,20 Z', 'b'), R(-7, -25, 14, 9, 'b'),
    P('M-9,-25 L0,-34 L9,-25'), R(-4, -23, 8, 5, 'w'),
    Ln(-6, 2, 6, 2, 'd'), Ln(-7, 10, 7, 10, 'd'), Ln(-5, -7, 5, -7, 'd'),
  ],
  school: () => [
    P('M-24,20 V-2 H24 V20 Z', 'b'), P('M-30,-2 L0,-18 L30,-2 Z', 'b'),
    R(-5, -31, 10, 11, 'b'), C(0, -26, 2.5, 'w'),
    R(-4, 8, 8, 12, 'w'), R(-18, 3, 8, 6, 'w'), R(10, 3, 8, 6, 'w'),
  ],
  library: () => [
    R(-32, -18, 64, 6, 'b'), R(-28, -12, 56, 32, 'b'),
    Ln(-20, -12, -20, 20), Ln(-7, -12, -7, 20), Ln(7, -12, 7, 20), Ln(20, -12, 20, 20),
    P('M-16,14 V1 a2.5,2.5 0 0 1 5,0 V14 Z', 'w'), P('M-2.5,14 V1 a2.5,2.5 0 0 1 5,0 V14 Z', 'w'), P('M11,14 V1 a2.5,2.5 0 0 1 5,0 V14 Z', 'w'),
    Ln(-34, 22, 34, 22),
  ],
  clocktower: () => [
    R(-15, 10, 30, 10, 'b'), R(-9, -20, 18, 32, 'b'), P('M-12,-20 L0,-36 L12,-20 Z', 'b'),
    C(0, -8, 6.5), P('M0,-8 V-13 M0,-8 H4'), R(-3, 12, 6, 8, 'w'),
  ],
  parliament: () => [
    R(-36, 15, 72, 5, 'b'), R(-31, -6, 62, 21, 'b'),
    Ln(-23, -6, -23, 15), Ln(-12, -6, -12, 15), Ln(0, -6, 0, 15), Ln(12, -6, 12, 15), Ln(23, -6, 23, 15),
    P('M-17,-6 A17,14 0 0 1 17,-6 Z', 'b'), Ln(0, -20, 0, -31), C(0, -33, 2.5, 'w'), R(-3, 5, 6, 10, 'w'),
  ],
  court: () => [
    R(-27, -6, 54, 26, 'b'), P('M-32,-6 L0,-26 L32,-6 Z', 'b'),
    P('M0,-22 V-11 M-8,-16 H8 M-8,-16 L-10,-11 H-6 Z M8,-16 L6,-11 H10 Z'),
    P('M-6,20 V6 a6,6 0 0 1 12,0 V20', 'w'), R(-21, 2, 7, 8, 'w'), R(14, 2, 7, 8, 'w'),
  ],
  temple: () => [
    R(-28, 12, 56, 8, 'b'), R(-18, -5, 36, 17, 'b'), P('M-30,-5 Q0,-17 30,-5'),
    R(-12, -16, 24, 11, 'b'), P('M-22,-16 Q0,-28 22,-16'), C(0, -33, 5.5, 'core'), R(-4, 2, 8, 10, 'w'),
  ],
  workshop: () => [
    R(-32, -4, 64, 24, 'b'), P('M-32,-4 L-22,-16 V-4 L-12,-16 V-4 L-2,-16 V-4 L8,-16 V-4 L18,-16 V-4'),
    R(22, -28, 7, 24, 'b'), C(-14, 8, 6), C(-14, 8, 2, 'w'), R(4, 5, 14, 15, 'w'),
  ],
  agora: () => [
    E(0, 6, 44, 20, 'plaza'), E(0, 6, 26, 11, 'd'),
    R(-2.5, -26, 5, 30, 'b'), C(0, -28, 5, 'core'),
  ],
  market: () => [
    R(-30, -1, 18, 20, 'b'), R(-9, -1, 18, 20, 'b'), R(12, -1, 18, 20, 'b'),
    P('M-32,-1 L-21,-12 L-10,-1 Z M-11,-1 L0,-12 L11,-1 Z M10,-1 L21,-12 L32,-1 Z'),
    R(-17, -26, 34, 7, 'w'), Ln(-10, -19, -10, -12, 'd'), Ln(10, -19, 10, -12, 'd'),
  ],
  theater: () => [
    P('M-30,20 V-4 A30,22 0 0 1 30,-4 V20 Z', 'b'), P('M-17,20 V4 A17,13 0 0 1 17,4 V20'),
    Ln(-10, 7, -10, 20, 'd'), Ln(-3.5, 4, -3.5, 20, 'd'), Ln(3.5, 4, 3.5, 20, 'd'), Ln(10, 7, 10, 20, 'd'),
    C(-22, -12, 2, 'w'), C(-11, -21, 2, 'w'), C(0, -24, 2, 'w'), C(11, -21, 2, 'w'), C(22, -12, 2, 'w'),
  ],
  overpass: () => [
    R(-42, -8, 84, 8, 'b'), Ln(-42, -13, 42, -13), R(-27, 0, 6, 20, 'b'), R(21, 0, 6, 20, 'b'),
    R(-14, -34, 28, 16, 'b'), R(-11, -31, 22, 10, 'w'), Ln(-8, -18, -8, -13, 'd'), Ln(8, -18, 8, -13, 'd'),
  ],
  tenements: () => {
    const out = [R(-25, -32, 50, 52, 'b'), Ln(-15, -32, -15, -40), Ln(11, -32, 11, -38)];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out.push(R(-19 + c * 10, -25 + r * 11, 6, 6, (r + c) % 3 === 0 ? 'w' : 'd', 0.8));
    return out;
  },
  well: () => [
    P('M-30,0 H-42 M30,0 H42 M0,30 V40 M0,-30 V-40 M-21,-21 L-29,-29 M21,21 L29,29 M21,-21 L29,-29 M-21,21 L-29,29'),
    C(0, 0, 30, 'b'), C(0, 0, 22, 'd ring'), C(0, 0, 14, 'core'),
  ],
  hospital: () => [
    R(-27, -8, 54, 28, 'b'), R(-3.5, -30, 7, 18, 'w'), R(-9, -24.5, 18, 7, 'w'),
    R(-21, 0, 8, 7, 'w'), R(13, 0, 8, 7, 'w'), R(-4, 9, 8, 11, 'w'),
  ],
  cemetery: () => {
    const out = [R(-38, -18, 76, 38, 'fence', 3), P('M-6,20 V13 H6 V20')];
    for (let i = 0; i < TOMB_SLOTS; i++) {
      const x = -31 + (i % 6) * 12;
      const y = i < 6 ? -11 : 1;
      out.push(['path', { d: `M${x},${y + 8} v-6 a3,3 0 0 1 6,0 v6 z`, class: 'tomb', 'data-i': i }]);
    }
    return out;
  },
  metro: () => [
    P('M-28,20 V2 A28,22 0 0 1 28,2 V20 Z', 'b'), P('M-15,20 V10 A15,13 0 0 1 15,10 V20'),
    R(-9, -34, 18, 13, 'b'), P('M-5,-24 V-31 L0,-26 L5,-31 V-24'),
    Ln(-24, 25, 24, 25, 'd'), Ln(-24, 29, 24, 29, 'd'),
  ],
  // ── 城外荒野（废土） ──
  edge: () => [
    Ln(-38, 18, -38, 5, 'd'), Ln(-31, 18, -31, 7, 'd'), Ln(-24, 18, -24, 3, 'd'), P('M-40,9 L-22,6', 'd'),
    P('M-16,18 L0,-10 L16,18 Z', 'b'), P('M-4,18 L0,8 L4,18'),
    P('M24,18 Q28,6 24,-2 Q34,8 29,18 Z', 'fire'),
  ],
  scrap: () => [
    P('M-36,18 L-34,7 L-23,3 H-8 L-2,9 V18 Z', 'b'), P('M-4,18 V7 L5,0 H20 L27,7 V18 Z', 'b'),
    P('M-22,3 L-20,-8 L-11,-13 H2 L7,-6 V3', 'b'),
    C(-28, 18, 3.5, 'd'), C(-10, 18, 3.5, 'd'), C(4, 18, 3.5, 'd'), C(20, 18, 3.5, 'd'),
    P('M32,-34 V-14 M24,-14 H40 M32,-34 H10'),
  ],
  solar: () => {
    const out = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const x = -36 + c * 24 + r * 6;
        const y = -18 + r * 14;
        out.push(P(`M${x},${y + 8} l8,-8 h14 l-8,8 z`, (r * 3 + c) % 4 === 1 ? 'panel broken' : 'panel'));
      }
    }
    out.push(Ln(-24, 26, 30, 26, 'd'));
    return out;
  },
  salt: () => [
    P('M-34,4 l8,-8 h12 l6,8 l-6,8 h-12 z', 'salt'), P('M-8,-8 l8,-8 h12 l6,8 l-6,8 h-12 z', 'salt'), P('M-6,10 l8,-8 h12 l6,8 l-6,8 h-12 z', 'salt'),
    P('M-36,24 H22 M13,16 L24,24 L13,32'),
  ],
  road: () => [
    P('M-44,6 H12 M-44,-8 H4', 'lane'), P('M-44,-1 H8', 'd dash'),
    P('M12,6 L18,2 L14,-2 L20,-8'),
    R(-10, -36, 30, 14, 'b'), Ln(-6, -22, -6, -12, 'd'), Ln(16, -22, 16, -12, 'd'), Ln(-5, -29, 15, -29, 'w'),
  ],
};

/** 每种 glyph 的色系（style.css 里的 .hue-*） */
export const GLYPH_HUE = {
  port: 'cyan', lighthouse: 'yellow', school: 'yellow', library: 'violet', clocktower: 'blue', parliament: 'magenta', court: 'violet',
  temple: 'green', workshop: 'orange', agora: 'cyan', market: 'orange', theater: 'magenta', overpass: 'blue', tenements: 'violet',
  well: 'cyan', hospital: 'green', cemetery: 'violet', metro: 'yellow',
  edge: 'rust', scrap: 'rust', solar: 'blue', salt: 'sand', road: 'sand',
};

export const GLYPH_NAMES = Object.keys(GLYPHS);

/** 在 g 里画一个地点的图形；未知的 glyph 画成一个方块 */
export function drawGlyph(g, glyph) {
  const parts = (GLYPHS[glyph] || (() => [R(-24, -16, 48, 34, 'b')]))();
  for (const [name, attrs] of parts) g.append(el(name, attrs));
}

// ── 设施与工程 ──────────────────────────────────────────────────

const FACILITY = {
  reservoir: () => [E(0, -5, 7, 3), P('M-7,-5 V6 a7,3 0 0 0 14,0 V-5')],
  relay: () => [P('M0,-9 L6,8 L-6,8 Z'), P('M-5,-9 q5,-5 10,0 M-8,-12 q8,-8 16,0')],
  observatory: () => [P('M-8,6 A8,8 0 0 1 8,6 Z'), Ln(0, -2, 7, -10), C(0, -2, 2)],
  monument: () => [P('M0,-10 L4.5,-2 L3,8 L-3,8 L-4.5,-2 Z')],
};

export function facilityIcon(type) {
  const g = el('g', { class: `facility f-${type}` });
  for (const [name, attrs] of (FACILITY[type] || FACILITY.monument)()) g.append(el(name, attrs));
  return g;
}

/** 工程：底圈 + 进度环（frac 为 0–1） */
export function projectIcon(frac) {
  const r = 8;
  const len = 2 * Math.PI * r;
  const g = el('g', { class: 'project' });
  g.append(el('circle', { class: 'project-base', cx: 0, cy: 0, r }));
  g.append(el('circle', { class: 'project-ring', cx: 0, cy: 0, r, 'stroke-dasharray': `${(frac * len).toFixed(2)} ${len.toFixed(2)}`, transform: 'rotate(-90)' }));
  return g;
}

/** 居民的「焰」：水滴形，原点在焰心 */
export const FLAME_D = 'M0,-7 C3.5,-3 4.5,1 0,5 C-4.5,1 -3.5,-3 0,-7Z';

/** 逝者的星：四角星 */
export function starPath(r) {
  const s = r * 0.3;
  return `M0,${-r} L${s},${-s} L${r},0 L${s},${s} L0,${r} L${-s},${s} L${-r},0 L${-s},${-s} Z`;
}
