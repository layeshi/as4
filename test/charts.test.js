// 指标图（public/charts.js）：按容器宽度绘制、随容器缩放重画、页眉排版与悬停读数。用假 DOM 渲染，不需要浏览器。
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { lineChart, CHART_HEIGHT } from '../public/charts.js';
import { renderMetrics } from '../public/tabs2.js';
import { renderMetrics2 } from '../public/e2-tabs.js';
import { setLang, getLang } from '../public/i18n.js';

const days = (n, f) => Array.from({ length: n }, (_, i) => [i + 1, f(i)]);
const num = (el, attr) => Number(el.getAttribute(attr));

/** 装好假 DOM 跑一段，再还原 */
function withDom(fn) {
  const dom = installFakeDom();
  try {
    return fn(dom);
  } finally {
    dom.restore();
  }
}

/** 一个记录自己观察对象、可手动触发回调的 ResizeObserver */
function fakeResizeObserver() {
  const saved = globalThis.ResizeObserver;
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      observers.push(this);
    }

    observe(target) {
      this.targets.push(target);
    }

    disconnect() {}

    resize(width) {
      this.callback([{ target: this.targets[0], contentRect: { width, height: CHART_HEIGHT } }]);
    }
  };
  return {
    observers,
    restore() {
      if (saved === undefined) delete globalThis.ResizeObserver;
      else globalThis.ResizeObserver = saved;
    },
  };
}

/** 横轴刻度文字与它们的横坐标（横轴的文字都在画布底部那一行） */
const xAxis = (svg, height = CHART_HEIGHT) => svg.querySelectorAll('text.axis').filter((t) => num(t, 'y') === height - 8).map((t) => ({ label: t.textContent, x: num(t, 'x') }));

test('指定宽度：viewBox 与宽度一一对应，字号写在根元素上，高度固定', () => withDom(() => {
  const svg = lineChart({ series: [{ name: '人口', points: days(30, (i) => i * 2) }], width: 480 });
  assert.equal(svg.getAttribute('viewBox'), `0 0 480 ${CHART_HEIGHT}`);
  assert.equal(svg.getAttribute('font-size'), '12');
  assert.equal(svg.style.height, `${CHART_HEIGHT}px`);
  assert.equal(svg.querySelectorAll('path.series').length, 1);
  assert.equal(svg.querySelectorAll('line.grid').length, 5);

  const custom = lineChart({ series: [{ name: '人口', points: days(3, (i) => i) }], width: 300, height: 200 });
  assert.equal(custom.getAttribute('viewBox'), '0 0 300 200');
  assert.equal(custom.style.height, '200px');
}));

test('不指定宽度：随容器宽度重画；宽度没变、被隐藏时不动；指定了宽度或没有数据时根本不观察', () => withDom(() => {
  const ro = fakeResizeObserver();
  try {
    const series = [{ name: '人口', points: days(10, (i) => i) }];
    const svg = lineChart({ series });
    assert.equal(ro.observers.length, 1);
    assert.deepEqual(ro.observers[0].targets, [svg]);
    assert.equal(svg.getAttribute('viewBox'), `0 0 640 ${CHART_HEIGHT}`, '量到宽度之前先按缺省宽度画');

    ro.observers[0].resize(733.4);
    assert.equal(svg.getAttribute('viewBox'), `0 0 733 ${CHART_HEIGHT}`);
    assert.equal(svg.querySelectorAll('path.series').length, 1, '重画不会叠加');

    const first = svg.firstChild;
    ro.observers[0].resize(733.2);
    assert.equal(svg.firstChild, first, '取整后宽度没变就不重画');
    ro.observers[0].resize(0);
    assert.equal(svg.getAttribute('viewBox'), `0 0 733 ${CHART_HEIGHT}`, '宽度为 0（被隐藏）时保持原样');
    ro.observers[0].resize(375);
    assert.equal(svg.getAttribute('viewBox'), `0 0 375 ${CHART_HEIGHT}`);

    lineChart({ series, width: 500 });
    lineChart({ series: [{ name: '空', points: [] }] });
    assert.equal(ro.observers.length, 1, '固定宽度与空图不需要观察');
  } finally {
    ro.restore();
  }
}));

test('没有 ResizeObserver（假 DOM、很老的浏览器）也能画', () => withDom(() => {
  assert.equal(typeof globalThis.ResizeObserver, 'undefined');
  const svg = lineChart({ series: [{ name: 'a', points: days(5, (i) => i) }] });
  assert.equal(svg.getAttribute('viewBox'), `0 0 640 ${CHART_HEIGHT}`);
  assert.equal(svg.querySelectorAll('path.series').length, 1);
}));

test('横轴刻度：整齐的日序号，带前缀，间隔至少 64 像素，窄图的刻度更少', () => withDom(() => {
  const series = [{ name: 'a', points: days(154, (i) => i) }];
  const steps = [1, 2, 5].flatMap((m) => [1, 10, 100, 1000].map((p) => m * p));
  const check = (width) => {
    const ticks = xAxis(lineChart({ series, width, xLabel: 'D' }));
    assert.ok(ticks.length >= 2, `${width}px 至少两个刻度`);
    const values = ticks.map((t) => Number(t.label.slice(1)));
    assert.ok(values.every((v) => Number.isInteger(v) && v >= 1 && v <= 154), values.join());
    const step = values[1] - values[0];
    assert.ok(steps.includes(step), `间隔 ${step} 应是 1/2/5×10ⁿ`);
    values.forEach((v, i) => i && assert.equal(v - values[i - 1], step));
    ticks.forEach((t, i) => i && assert.ok(t.x - ticks[i - 1].x >= 64, `刻度之间至少 64 像素：${t.x - ticks[i - 1].x}`));
    return values;
  };
  const wide = check(750);
  const narrow = check(325);
  assert.ok(wide.length > narrow.length, `宽图 ${wide.join()} 比窄图 ${narrow.join()} 刻度多`);
  assert.deepEqual(narrow, [50, 100, 150]);

  // 不带前缀（注意力图表的横轴是第几天）
  const bare = lineChart({ series: [{ name: 'a', points: days(30, (i) => i) }], width: 600 });
  assert.deepEqual(xAxis(bare).map((t) => t.label), ['5', '10', '15', '20', '25', '30']);
}));

test('页眉：平时是最新一天的数值，悬停时跟着竖线走，移开后恢复', () => withDom(() => {
  const svg = lineChart({
    width: 500,
    xLabel: 'D',
    yFormat: (v) => `${v}%`,
    series: [
      { name: '完好度', points: [[1, 10], [2, 20], [3, 30]] },
      { name: '日产', axis: 'right', points: [[1, 100], [2, 200], [3, 300]] },
    ],
  });
  const day = () => svg.querySelector('text.readout').textContent;
  const values = () => svg.querySelectorAll('tspan.readout').map((t) => t.textContent);
  const names = svg.querySelectorAll('text.legend').map((t) => t.childNodes[0].textContent);
  assert.deepEqual(names, ['完好度', '日产']);
  assert.equal(day(), 'D3');
  assert.deepEqual(values(), ['30%', '300'], '左轴用 yFormat，右轴用 y2Format（缺省）');

  const overlay = svg.querySelector('rect.overlay');
  const cross = svg.querySelector('line.crosshair');
  assert.equal(cross.style.display, 'none');
  // 假 DOM 的 getBoundingClientRect 宽 1000、左边 0：clientX = 绘图区内的横坐标 ÷ 500 × 1000
  const at = (px) => overlay.fire('mousemove', { clientX: (px / 500) * 1000 });
  at(num(overlay, 'x') + num(overlay, 'width') / 2);
  assert.equal(day(), 'D2');
  assert.deepEqual(values(), ['20%', '200']);
  assert.equal(cross.style.display, 'block');
  assert.ok(Math.abs(num(cross, 'x1') - (num(overlay, 'x') + num(overlay, 'width') / 2)) < 1e-6, '竖线落在第 2 天的位置');

  at(num(overlay, 'x'));
  assert.equal(day(), 'D1');
  at(500 + 100); // 绘图区之外也不越界
  assert.equal(day(), 'D3');

  at(num(overlay, 'x')); // 停在非最新的一天再移开：读数回到最新一天
  assert.equal(day(), 'D1');
  assert.deepEqual(values(), ['10%', '100']);
  overlay.fire('mouseleave');
  assert.equal(cross.style.display, 'none');
  assert.equal(day(), 'D3');
  assert.deepEqual(values(), ['30%', '300']);
}));

test('页眉放不下就换行，过长的名称加省略号，绘图区始终在页眉之下', () => withDom(() => {
  const long = '很长很长很长很长很长很长很长很长很长很长的名称';
  const mk = (name) => ({ name, points: days(5, (i) => i) });
  const svg = lineChart({ width: 300, series: [mk(long), mk('甲'), mk('乙乙乙乙乙')] });
  const names = svg.querySelectorAll('text.legend').map((t) => t.childNodes[0].textContent);
  assert.ok(names[0].endsWith('…') && names[0].length < long.length, names[0]);
  assert.deepEqual(names.slice(1), ['甲', '乙乙乙乙乙']);
  const swatches = svg.querySelectorAll('rect.legend-swatch');
  assert.ok(new Set(swatches.map((r) => r.getAttribute('y'))).size >= 2, '放不下的项换到下一行');
  const top = num(svg.querySelector('line.grid'), 'y1');
  for (const sw of swatches) assert.ok(num(sw, 'y') + num(sw, 'height') <= top, '图例不压到绘图区');

  // 宽度够时全部在一行，名称原样
  const roomy = lineChart({ width: 700, series: [mk(long), mk('甲')] });
  assert.equal(new Set(roomy.querySelectorAll('rect.legend-swatch').map((r) => r.getAttribute('y'))).size, 1);
  assert.equal(roomy.querySelector('text.legend').childNodes[0].textContent, long);
}));

test('左右边距跟着最宽的纵轴刻度走，数值再大也不会被切掉', () => withDom(() => {
  const series = [{ name: 'a', points: days(3, () => 5) }];
  const left = (svg) => num(svg.querySelector('text.axis'), 'x');
  const small = lineChart({ width: 400, series });
  const big = lineChart({ width: 400, series, yFormat: (v) => `${v}000000` });
  assert.ok(left(big) > left(small));
  const first = big.querySelector('text.axis'); // 最上面一档，右对齐在 x
  assert.ok(left(big) - first.textContent.length * 12 * 0.6 >= 0, '刻度文字的左端在画布之内');

  const twin = lineChart({ width: 400, series: [{ name: 'a', points: days(3, () => 5) }, { name: 'b', axis: 'right', points: days(3, () => 5000000) }] });
  const right = twin.querySelector('text.axis-right');
  assert.ok(num(right, 'x') + right.textContent.length * 12 * 0.6 <= 400, '右轴刻度文字的右端在画布之内');
}));

test('空数据不报错；单个数据点画成一个点', () => withDom(() => {
  const empty = lineChart({ series: [{ name: 'a', points: [] }, { name: 'b', points: [] }], ariaLabel: '空' });
  assert.equal(empty.childNodes.length, 0);
  assert.equal(empty.getAttribute('aria-label'), '空');

  const one = lineChart({ width: 400, series: [{ name: 'a', points: [[7, 3]] }], xLabel: 'D' });
  assert.equal(one.querySelectorAll('circle.dot').length, 1);
  assert.deepEqual(xAxis(one).map((t) => t.label), ['D7']);
  assert.equal(one.querySelector('text.readout').textContent, 'D7');
}));

test('图里的文字一律走 textContent：序列名里的标记不会变成元素', () => withDom(() => {
  const svg = lineChart({ width: 400, series: [{ name: '<img src=x onerror=alert(1)>', points: days(3, (i) => i) }] });
  assert.equal(svg.querySelectorAll('img').length, 0);
  assert.ok(svg.textContent.includes('<img src=x'));
}));

// ── 指标页（两个纪元）：每张图都用缺省高度，没有谁还带着旧的 190 ──────────────────────

/** 几天的每日指标：两个纪元的指标页读的键都在里面 */
const metricDays = (n) => Array.from({ length: n }, (_, i) => ({
  day: i, awake: 10 + i, dormant: i % 3, wellCondition: 9000 - i * 100, output: 600 + i, treasuryEnergy: 900 + 10 * i, gini: 0.1 + i / 100,
  publicInvestmentRate: 0.1, freeRiderShare: 0.05, humanAuthoredShare: 0.9 - i / 50, scriptEntropy: 1.2, coinVolume: i, coinPrice: 1 + i / 10, lawsActive: 3,
  rationPerCapita: 20, dailyDistributionEnergy: 300, otherLawPaymentsEnergy: 4, rulesActive: 5, upkeepPaid: 2, lawsSuspended: 0, ruleErrors: 0,
  agentBuiltShare: 0.2, salvageLeft: 400 - i, razed: i % 2, shellsUsed: i, shellQueue: 1, purposeShare: 0.4, birthsSolo: 1, birthsPair: 0, birthsGroup: 0,
}));

async function renderPage(fn, ctx) {
  const dom = installFakeDom();
  const saved = { fetch: globalThis.fetch, lang: getLang() };
  setLang('zh');
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ metrics: metricDays(6) }) });
  try {
    const root = document.createElement('div');
    dom.root.append(root);
    await fn(ctx, root);
    return { figures: root.querySelectorAll('figure'), svgs: root.querySelectorAll('svg.chart'), columns: root.querySelectorAll('div.charts') };
  } finally {
    globalThis.fetch = saved.fetch;
    setLang(saved.lang);
    dom.restore();
  }
}

test('指标页（第一纪）：10 张图都用缺省高度，没有写死的小尺寸', async () => {
  const page = await renderPage(renderMetrics, { S: { state: { world: { premise: 0 } } } });
  assert.equal(page.figures.length, 10);
  assert.equal(page.svgs.length, 10);
  for (const svg of page.svgs) {
    assert.equal(svg.getAttribute('viewBox'), `0 0 640 ${CHART_HEIGHT}`);
    assert.equal(svg.style.height, `${CHART_HEIGHT}px`);
    assert.ok(svg.querySelectorAll('path.series').length >= 1, '每张图都有折线');
  }
});

test('指标页（第二纪）：每张图都用缺省高度，没有写死的小尺寸', async () => {
  const page = await renderPage(renderMetrics2, { S: { state: { world: { premise: 0 } } } });
  assert.ok(page.svgs.length >= 18, `只画了 ${page.svgs.length} 张`);
  assert.equal(page.svgs.length, page.figures.length);
  for (const svg of page.svgs) {
    assert.equal(svg.getAttribute('viewBox'), `0 0 640 ${CHART_HEIGHT}`);
    assert.equal(svg.style.height, `${CHART_HEIGHT}px`);
  }
});
