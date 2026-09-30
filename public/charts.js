// 指标页的 SVG 折线图（不用第三方库）。颜色由 CSS 类 c0…c5 决定（随主题变化）。

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}

/** 把最大值抬到一个「好看」的刻度 */
export function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * p;
}

const defaultFormat = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

/**
 * 折线图。
 * opts：{ series: [{ name, points: [[x, y], ...], axis?: 'left' | 'right', color?: 0..5 }],
 *         width?, height?, yFormat?, y2Format?, yMax?, y2Max?, xLabel?, ariaLabel? }
 * 返回 SVG 元素。数据为空时返回带说明的空图。
 */
export function lineChart(opts) {
  const { series, width = 640, height = 220, yFormat = defaultFormat, y2Format = defaultFormat, xLabel = '', ariaLabel = '' } = opts;
  const M = { l: 46, r: 46, t: 26, b: 26 };
  const W = width - M.l - M.r;
  const H = height - M.t - M.b;
  const svg = el('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': ariaLabel || series.map((s) => s.name).join(', ') });
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return svg;

  const hasRight = series.some((s) => s.axis === 'right');
  const xs = all.map((p) => p[0]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const span = Math.max(1, x1 - x0);
  const maxOf = (axis) => Math.max(0, ...series.filter((s) => (s.axis || 'left') === axis).flatMap((s) => s.points.map((p) => p[1])));
  const yMax = opts.yMax ?? niceMax(maxOf('left'));
  const y2Max = opts.y2Max ?? niceMax(maxOf('right'));
  const sx = (x) => M.l + ((x - x0) / span) * W;
  const sy = (y, axis) => M.t + H - (y / ((axis === 'right' ? y2Max : yMax) || 1)) * H;

  // 网格与纵轴刻度
  for (let i = 0; i <= 4; i++) {
    const gy = M.t + (H * i) / 4;
    svg.append(el('line', { class: 'grid', x1: M.l, y1: gy, x2: M.l + W, y2: gy }));
    svg.append(el('text', { class: 'axis', x: M.l - 6, y: gy + 3.5, 'text-anchor': 'end' }, yFormat((yMax * (4 - i)) / 4)));
    if (hasRight) svg.append(el('text', { class: 'axis axis-right', x: M.l + W + 6, y: gy + 3.5, 'text-anchor': 'start' }, y2Format((y2Max * (4 - i)) / 4)));
  }
  // 横轴：起点、中点、终点
  for (const [x, anchor] of [[x0, 'start'], [x0 + span / 2, 'middle'], [x1, 'end']]) {
    svg.append(el('text', { class: 'axis', x: sx(x), y: height - 8, 'text-anchor': anchor }, String(Math.round(x))));
  }
  if (xLabel) svg.append(el('text', { class: 'axis axis-label', x: width - 4, y: height - 8, 'text-anchor': 'end' }, xLabel));

  // 折线
  series.forEach((s, i) => {
    if (s.points.length === 0) return;
    const axis = s.axis || 'left';
    const cls = `series c${s.color ?? i}`;
    const d = s.points.map((p, k) => `${k === 0 ? 'M' : 'L'}${sx(p[0]).toFixed(1)} ${sy(p[1], axis).toFixed(1)}`).join(' ');
    svg.append(el('path', { class: cls, d }));
    if (s.points.length === 1) svg.append(el('circle', { class: `dot c${s.color ?? i}`, cx: sx(s.points[0][0]), cy: sy(s.points[0][1], axis), r: 3 }));
  });

  // 图例
  let lx = M.l;
  series.forEach((s, i) => {
    svg.append(el('rect', { class: `legend-swatch c${s.color ?? i}`, x: lx, y: 8, width: 10, height: 3, rx: 1 }));
    const label = el('text', { class: 'legend', x: lx + 14, y: 13 }, s.name);
    svg.append(label);
    lx += 14 + 7 * [...s.name].length + 16;
  });

  // 悬停：竖线与读数
  const cross = el('line', { class: 'crosshair', x1: 0, y1: M.t, x2: 0, y2: M.t + H });
  cross.style.display = 'none';
  const readout = el('text', { class: 'readout', x: M.l + W, y: 13, 'text-anchor': 'end' });
  svg.append(cross, readout);
  const overlay = el('rect', { class: 'overlay', x: M.l, y: M.t, width: W, height: H, fill: 'transparent' });
  overlay.addEventListener('mousemove', (ev) => {
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * width;
    const x = Math.round(x0 + ((px - M.l) / W) * span);
    const parts = [];
    for (const s of series) {
      const pt = s.points.reduce((best, p) => (best === null || Math.abs(p[0] - x) < Math.abs(best[0] - x) ? p : best), null);
      if (pt) parts.push(`${s.name} ${(s.axis === 'right' ? y2Format : yFormat)(pt[1])}`);
    }
    cross.setAttribute('x1', sx(x));
    cross.setAttribute('x2', sx(x));
    cross.style.display = 'block';
    readout.textContent = `${x} · ${parts.join(' · ')}`;
  });
  overlay.addEventListener('mouseleave', () => {
    cross.style.display = 'none';
    readout.textContent = '';
  });
  svg.append(overlay);
  return svg;
}
