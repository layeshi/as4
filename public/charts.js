// 指标页的 SVG 折线图（不用第三方库）。颜色由 CSS 类 c0…c5 决定（随主题变化）。
//
// 图按容器的实际像素宽度绘制：viewBox 的一个单位就是一个 CSS 像素，字号与线宽不会随侧栏变窄被等比缩小。
// 容器宽度变了（缩放窗口、出现滚动条）就重画；没有 ResizeObserver（测试用的假 DOM、很老的浏览器）或指定了 width 时只画一次。

const NS = 'http://www.w3.org/2000/svg';

/** 折线图的缺省高度（像素）；指标页的每张图都用它 */
export const CHART_HEIGHT = 260;

const FONT = 12; // 坐标轴、图例、读数的字号（像素），经 svg 根元素的 font-size 属性生效
const ROW = 18; // 页眉（日期与各序列的图例、读数）每行的高度
const PAD = 6; // 四周留白
const GAP = 14; // 页眉里相邻两项的间隔
const FALLBACK_WIDTH = 640; // 还没量到容器宽度时先按这个宽度画

export function el(name, attrs = {}, text) {
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

/** 文字宽度的估计（绘制前拿不到排版结果）：全角字符按 1 em，其余按 0.6 em */
function textWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += ch.codePointAt(0) > 0x2e7f ? FONT : FONT * 0.6;
  return w;
}

/** 名称放不下时截断并加省略号 */
function fit(s, max) {
  if (textWidth(s) <= max) return String(s);
  const cs = [...String(s)];
  while (cs.length > 1 && textWidth(`${cs.join('')}…`) > max) cs.pop();
  return `${cs.join('')}…`;
}

/** 横轴刻度：整数日序号，取个数不超过 max 的最小整齐间隔（1、2、5 × 10ⁿ）；范围内没有整齐的刻度时退回两端 */
function xTicks(x0, x1, max) {
  if (x1 <= x0) return [x0];
  for (let mag = 1; ; mag *= 10) {
    for (const m of [1, 2, 5]) {
      const step = m * mag;
      const first = Math.ceil(x0 / step);
      const last = Math.floor(x1 / step);
      if (last - first + 1 > max) continue; // 太密
      if (last < first) return [x0, x1];
      return Array.from({ length: last - first + 1 }, (_, k) => (first + k) * step);
    }
  }
}

/**
 * 折线图。
 * opts：{ series: [{ name, points: [[x, y], ...], axis?: 'left' | 'right', color?: 0..5 }],
 *         width?（固定宽度；缺省按容器宽度绘制并随之重画）, height?（缺省 CHART_HEIGHT）, yFormat?, y2Format?, yMax?, y2Max?,
 *         xLabel?（横轴刻度与读数的前缀，如 'D'）, ariaLabel? }
 * 返回 SVG 元素。数据为空时返回空图。
 */
export function lineChart(opts) {
  const { series, height = CHART_HEIGHT, yFormat = defaultFormat, y2Format = defaultFormat, xLabel = '', ariaLabel = '' } = opts;
  const svg = el('svg', {
    class: 'chart',
    viewBox: `0 0 ${opts.width ?? FALLBACK_WIDTH} ${height}`,
    role: 'img',
    'font-size': FONT,
    'aria-label': ariaLabel || series.map((s) => s.name).join(', '),
  });
  svg.style.height = `${height}px`; // 高度固定：重画只换 viewBox，不会引起版面回流
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

  // 纵轴刻度自上而下 5 档；左右边距按最宽的刻度文字留，数值再大也不会被切掉
  const levels = [4, 3, 2, 1, 0];
  const leftLabels = levels.map((i) => yFormat((yMax * i) / 4));
  const rightLabels = hasRight ? levels.map((i) => y2Format((y2Max * i) / 4)) : [];
  const widest = (labels) => Math.ceil(Math.max(0, ...labels.map((s) => textWidth(s))));
  const marginL = widest(leftLabels) + 2 * PAD;
  const marginR = Math.max(2 * PAD, hasRight ? widest(rightLabels) + 2 * PAD : 0, Math.ceil(textWidth(`${xLabel}${x1}`) / 2) + PAD);

  // 页眉：日期，然后每条序列一项「色块 名称 读数」。读数的宽度按该序列所有取值里最宽的留，悬停换数字时版面不抖
  const nearest = (s, x) => s.points.reduce((best, p) => (best === null || Math.abs(p[0] - x) < Math.abs(best[0] - x) ? p : best), null);
  const valueText = (s, y) => (s.axis === 'right' ? y2Format : yFormat)(y);
  const dayW = textWidth(`${xLabel}${x1}`);
  const items = series.map((s, i) => ({ s, i, valueW: Math.max(0, ...s.points.map((p) => textWidth(valueText(s, p[1])))) }));

  const draw = (width) => {
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // 页眉排版：一行放不下就换行；过长的名称加省略号
    const avail = width - PAD - marginL;
    let lx = marginL;
    let row = 0;
    const place = (w) => {
      if (lx > marginL && lx + w > width - PAD) {
        row++;
        lx = marginL;
      }
      const at = { x: lx, row };
      lx += w + GAP;
      return at;
    };
    const dayAt = place(dayW);
    const heads = items.map((it) => {
      const name = fit(it.s.name, Math.max(textWidth('…'), avail - 17 - 6 - it.valueW));
      return { ...it, name, ...place(17 + textWidth(name) + 6 + it.valueW) };
    });
    const M = { l: marginL, r: marginR, t: PAD + (row + 1) * ROW + 8, b: 30 };
    const W = Math.max(60, width - M.l - M.r);
    const H = Math.max(40, height - M.t - M.b);
    const sx = (x) => M.l + ((x - x0) / span) * W;
    const sy = (y, axis) => M.t + H - (y / ((axis === 'right' ? y2Max : yMax) || 1)) * H;

    // 网格与纵轴刻度
    for (let i = 0; i <= 4; i++) {
      const gy = M.t + (H * i) / 4;
      svg.append(el('line', { class: 'grid', x1: M.l, y1: gy, x2: M.l + W, y2: gy }));
      svg.append(el('text', { class: 'axis', x: M.l - PAD, y: gy + 4, 'text-anchor': 'end' }, leftLabels[i]));
      if (hasRight) svg.append(el('text', { class: 'axis axis-right', x: M.l + W + PAD, y: gy + 4, 'text-anchor': 'start' }, rightLabels[i]));
    }
    // 横轴：整齐的日序号，刻度之间至少 64 像素
    for (const x of xTicks(x0, x1, Math.floor(W / 64))) {
      svg.append(el('text', { class: 'axis', x: sx(x), y: height - 8, 'text-anchor': 'middle' }, `${xLabel}${x}`));
    }

    // 折线
    series.forEach((s, i) => {
      if (s.points.length === 0) return;
      const axis = s.axis || 'left';
      const cls = `series c${s.color ?? i}`;
      const d = s.points.map((p, k) => `${k === 0 ? 'M' : 'L'}${sx(p[0]).toFixed(1)} ${sy(p[1], axis).toFixed(1)}`).join(' ');
      svg.append(el('path', { class: cls, d }));
      if (s.points.length === 1) svg.append(el('circle', { class: `dot c${s.color ?? i}`, cx: sx(s.points[0][0]), cy: sy(s.points[0][1], axis), r: 3.5 }));
    });

    // 页眉：平时显示最新一天的数值，悬停时跟着竖线走
    const rowY = (r) => PAD + r * ROW + ROW / 2;
    const day = el('text', { class: 'readout', x: dayAt.x, y: rowY(dayAt.row) + 4 });
    svg.append(day);
    const values = heads.map((hd) => {
      svg.append(el('rect', { class: `legend-swatch c${hd.s.color ?? hd.i}`, x: hd.x, y: rowY(hd.row) - 2, width: 12, height: 4, rx: 1.5 }));
      const label = el('text', { class: 'legend', x: hd.x + 17, y: rowY(hd.row) + 4 }, hd.name);
      const value = el('tspan', { class: 'readout', dx: 6 });
      label.append(value);
      svg.append(label);
      return value;
    });
    const show = (x) => {
      day.textContent = `${xLabel}${x}`;
      heads.forEach((hd, k) => {
        const pt = nearest(hd.s, x);
        values[k].textContent = pt ? valueText(hd.s, pt[1]) : '—';
      });
    };
    show(x1);

    // 悬停：竖线与读数
    const cross = el('line', { class: 'crosshair', x1: 0, y1: M.t, x2: 0, y2: M.t + H });
    cross.style.display = 'none';
    svg.append(cross);
    const overlay = el('rect', { class: 'overlay', x: M.l, y: M.t, width: W, height: H, fill: 'transparent' });
    overlay.addEventListener('mousemove', (ev) => {
      const box = svg.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * width;
      const x = Math.min(x1, Math.max(x0, Math.round(x0 + ((px - M.l) / W) * span)));
      cross.setAttribute('x1', sx(x));
      cross.setAttribute('x2', sx(x));
      cross.style.display = 'block';
      show(x);
    });
    overlay.addEventListener('mouseleave', () => {
      cross.style.display = 'none';
      show(x1);
    });
    svg.append(overlay);
  };

  draw(opts.width ?? FALLBACK_WIDTH);
  if (opts.width === undefined && typeof ResizeObserver === 'function') {
    let drawn = FALLBACK_WIDTH;
    new ResizeObserver((entries) => {
      const w = Math.round(entries[entries.length - 1].contentRect.width);
      if (w < 1 || w === drawn) return; // 容器被隐藏（宽度为 0）或宽度没变
      drawn = w;
      draw(w);
    }).observe(svg);
  }
  return svg;
}
