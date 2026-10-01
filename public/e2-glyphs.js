// 第二纪地图上的图形：后人开辟的地点（另一种画风——用废料拼起来的棚屋）、九种模块的小图标、空地块的标记。
// 只用 SVG 属性与 class（CSP 不允许 style 属性字符串）；颜色在 style.css 里按 class 定义。

import { el } from './map-glyphs.js';

const P = (d, c = '') => ['path', { d, class: c }];
const C = (cx, cy, r, c = '') => ['circle', { cx, cy, r, class: c }];
const R = (x, y, w, h, c = '', rx = 1) => ['rect', { x, y, width: w, height: h, rx, class: c }];
const Ln = (x1, y1, x2, y2, c = '') => ['line', { x1, y1, x2, y2, class: c }];

/**
 * 后人开辟的地点：歪斜的棚屋，顶上挂一盏灯，用废料补过的墙。画风与人类的建筑不同——线条是断的、不对称的。
 * 模块另外叠在它上面（moduleIcon）。以地点为原点，大致占 60 × 48 个单位。
 */
export function drawSiteGlyph(g) {
  const parts = [
    P('M-24,20 L-22,-2 L-6,-10 L8,-6 L24,-12 L26,20 Z', 'b'), // 棚屋的体
    P('M-26,-1 L-4,-16 L12,-9 L28,-18', 'n'), // 歪斜的顶
    P('M-22,20 V10 M-13,20 V6 M2,20 V8', 'd'), // 补的墙板
    R(-14, 2, 9, 9, 'w'), R(6, 4, 8, 8, 'w'), // 窗
    Ln(18, -14, 18, -30, 'n'), C(18, -33, 3.2, 'core'), // 挂灯的杆
    P('M-28,22 H30', 'd'),
  ];
  for (const [name, attrs] of parts) g.append(el(name, attrs));
}

/** 九种模块的小图标，以图标中心为原点，约 14 × 14 个单位 */
const MODULE = {
  store: () => [R(-6, -7, 12, 14, '', 1.5), Ln(-6, -2, 6, -2), P('M-2,-10 H2 V-7 H-2 Z')], // 储能：电池
  relay: () => [P('M0,-9 L6,8 L-6,8 Z'), P('M-5,-9 q5,-5 10,0 M-8,-12 q8,-8 16,0')], // 中继：天线
  sensor: () => [P('M-8,6 A8,8 0 0 1 8,6 Z'), Ln(0, -2, 7, -10), C(0, -2, 2)], // 观测：圆顶与望远镜
  archive: () => [R(-7, -8, 14, 4), R(-7, -3, 14, 4), R(-7, 2, 14, 4), Ln(-3, -6, 3, -6)], // 档案：叠起来的书
  board: () => [R(-8, -7, 16, 13, '', 1), Ln(-4, -3, 4, -3), Ln(-4, 1, 2, 1), C(5, 4, 1)], // 告示板
  surface: () => [P('M-5,8 V-4 a5,5 0 0 1 10,0 V8 Z'), Ln(-2, -1, 2, -1), Ln(-2, 3, 2, 3)], // 碑
  memorial: () => [P('M0,-9 C4,-4 5,0 0,6 C-5,0 -4,-4 0,-9 Z'), Ln(-5, 9, 5, 9)], // 纪念：长明的火
  cradle: () => [P('M0,-9 C6,-9 8,-1 8,3 C8,8 -8,8 -8,3 C-8,-1 -6,-9 0,-9 Z'), P('M-3,-1 q3,3 6,0')], // 摇篮：蛋形的舱
  gate: () => [P('M-7,8 V-2 a7,7 0 0 1 14,0 V8'), Ln(0, -9, 0, 8)], // 门：拱与门扇
};

export const MODULE_TYPES = Object.keys(MODULE);

/** 一个模块的小图标；off 表示没有运转（完好度不够） */
export function moduleIcon(type) {
  const g = el('g', { class: `module m-${type}` });
  for (const [name, attrs] of (MODULE[type] || MODULE.surface)()) g.append(el(name, attrs));
  return g;
}

/** 空地块的标记：淡淡的菱形，中心一点 */
export function lotMarker() {
  const g = el('g', { class: 'lot' });
  g.append(el('path', { d: 'M0,-9 L9,0 L0,9 L-9,0 Z', class: 'lot-diamond' }), el('circle', { cx: 0, cy: 0, r: 1.6, class: 'lot-dot' }));
  return g;
}
