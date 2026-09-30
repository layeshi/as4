// 地图的视口：缩放与平移（滚轮、拖拽、双指、双击、键盘、按钮）。
// SVG 的 viewBox 等于它在页面上的像素大小，世界层用 translate + scale 摆放；顶部留出天穹带（HUD）的高度。
// 拖拽超过几个像素后，松开时的 click 会被吞掉，免得拖地图时误点了地点或居民。

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * svg：<svg> 元素；world：要变换的 <g>；opts：{ hud: 顶部 HUD 高度（像素）, onChange({ k, tx, ty, W, H, fitK }) }
 * 返回 { setBounds([w, h]), fit(), zoomBy(f), panBy(dx, dy), state(), setState(s), toScreen(x, y), destroy() }
 */
export function createView(svg, world, { hud = 40, onChange = () => {} } = {}) {
  let W = 0;
  let H = 0;
  let bw = 1000;
  let bh = 640;
  let k = 1;
  let tx = 0;
  let ty = 0;
  let fitK = 1;
  let fitted = false;

  const kMin = () => fitK * 0.75;
  const kMax = () => Math.max(fitK * 8, 2.5);

  function measure() {
    const r = svg.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const availH = Math.max(1, H - hud);
    fitK = Math.min(W / bw, availH / bh) * 0.96;
  }

  /** 至少留一部分地图在视口里 */
  function clampPan() {
    const mw = bw * k;
    const mh = bh * k;
    const marginX = Math.min(W * 0.5, mw * 0.5);
    const marginY = Math.min((H - hud) * 0.5, mh * 0.5);
    tx = clamp(tx, marginX - mw, W - marginX);
    ty = clamp(ty, hud + marginY - mh, H - marginY);
  }

  function apply() {
    clampPan();
    world.setAttribute('transform', `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(5)})`);
    onChange({ k, tx, ty, W, H, fitK });
  }

  function fit() {
    measure();
    k = fitK;
    tx = (W - bw * k) / 2;
    ty = hud + (H - hud - bh * k) / 2;
    fitted = true;
    apply();
  }

  function zoomAt(px, py, factor) {
    const nk = clamp(k * factor, kMin(), kMax());
    const wx = (px - tx) / k;
    const wy = (py - ty) / k;
    k = nk;
    tx = px - wx * k;
    ty = py - wy * k;
    apply();
  }

  const center = () => [W / 2, hud + (H - hud) / 2];
  const zoomBy = (f) => zoomAt(...center(), f);
  function panBy(dx, dy) {
    tx += dx;
    ty += dy;
    apply();
  }

  /** 屏幕上的点（相对 svg 左上角） */
  function local(ev) {
    const r = svg.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  }

  // ── 滚轮 ──
  const onWheel = (ev) => {
    ev.preventDefault();
    const [x, y] = local(ev);
    const delta = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
    zoomAt(x, y, Math.exp(-clamp(delta, -300, 300) * 0.0018));
  };

  // ── 拖拽与双指 ──
  const pointers = new Map();
  let dragged = false;
  let start = null; // { x, y, tx, ty, dist, k, mid }

  const onDown = (ev) => {
    if (ev.button !== undefined && ev.button !== 0 && ev.pointerType === 'mouse') return;
    pointers.set(ev.pointerId, local(ev));
    dragged = false;
    begin();
  };
  function begin() {
    const pts = [...pointers.values()];
    if (pts.length === 1) start = { x: pts[0][0], y: pts[0][1], tx, ty };
    else if (pts.length >= 2) {
      const [a, b] = pts;
      start = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, k, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], tx, ty };
    }
  }
  const onMove = (ev) => {
    if (!pointers.has(ev.pointerId) || !start) return;
    pointers.set(ev.pointerId, local(ev));
    const pts = [...pointers.values()];
    if (pts.length === 1 && start.x !== undefined) {
      const dx = pts[0][0] - start.x;
      const dy = pts[0][1] - start.y;
      if (!dragged && Math.hypot(dx, dy) < 5) return;
      if (!dragged) {
        dragged = true;
        try {
          svg.setPointerCapture(ev.pointerId);
        } catch {
          // 指针已经不在了
        }
        svg.classList.add('dragging');
      }
      tx = start.tx + dx;
      ty = start.ty + dy;
      apply();
    } else if (pts.length >= 2 && start.dist) {
      dragged = true;
      const [a, b] = pts;
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const nk = clamp(start.k * (dist / start.dist), kMin(), kMax());
      const wx = (start.mid[0] - start.tx) / start.k;
      const wy = (start.mid[1] - start.ty) / start.k;
      k = nk;
      tx = mid[0] - wx * k;
      ty = mid[1] - wy * k;
      apply();
    }
  };
  const onUp = (ev) => {
    pointers.delete(ev.pointerId);
    svg.classList.remove('dragging');
    if (pointers.size) begin();
    else start = null;
    // 拖拽后紧跟着的 click（同一次派发里）会被吞掉；触屏平移之后没有 click，下一次轻点不能被误吞
    if (dragged && !pointers.size) setTimeout(() => {
      dragged = false;
    }, 0);
  };
  // 拖拽之后的那一次 click 不算数
  const onClickCapture = (ev) => {
    if (dragged) {
      ev.stopPropagation();
      ev.preventDefault();
      dragged = false;
    }
  };
  const onDbl = (ev) => {
    if (ev.target.closest && ev.target.closest('.place, .agent, .star')) return;
    const [x, y] = local(ev);
    zoomAt(x, y, ev.shiftKey ? 1 / 1.8 : 1.8);
  };
  const onKey = (ev) => {
    if (ev.target !== svg) return;
    const step = 60;
    const keys = {
      '+': () => zoomBy(1.4), '=': () => zoomBy(1.4), '-': () => zoomBy(1 / 1.4), _: () => zoomBy(1 / 1.4), 0: fit,
      ArrowLeft: () => panBy(step, 0), ArrowRight: () => panBy(-step, 0), ArrowUp: () => panBy(0, step), ArrowDown: () => panBy(0, -step),
    };
    const fn = keys[ev.key];
    if (!fn) return;
    ev.preventDefault();
    fn();
  };

  svg.addEventListener('wheel', onWheel, { passive: false });
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
  svg.addEventListener('click', onClickCapture, true);
  svg.addEventListener('dblclick', onDbl);
  svg.addEventListener('keydown', onKey);

  // 尺寸变化：保持视口中心对准同一处世界坐标
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (!fitted) return;
      const [cx, cy] = center();
      const wx = (cx - tx) / k;
      const wy = (cy - ty) / k;
      const wasFit = Math.abs(k - fitK) < 1e-6;
      measure();
      if (wasFit) {
        fit();
        return;
      }
      const [nx, ny] = center();
      tx = nx - wx * k;
      ty = ny - wy * k;
      apply();
    });
    ro.observe(svg);
  }

  return {
    setBounds([w, h]) {
      bw = w;
      bh = h;
    },
    fit,
    zoomBy,
    panBy,
    state: () => ({ k, tx, ty, W, H, fitK, fitted }),
    /** 恢复之前的视口（重建地图时，例如切换语言） */
    setState(s) {
      measure();
      if (!s || !s.fitted) return fit();
      k = clamp(s.k, kMin(), kMax());
      tx = s.tx;
      ty = s.ty;
      fitted = true;
      apply();
      return undefined;
    },
    /** 世界坐标 → 屏幕坐标（相对 svg） */
    toScreen: (x, y) => [tx + x * k, ty + y * k],
    destroy() {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('pointerdown', onDown);
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerup', onUp);
      svg.removeEventListener('pointercancel', onUp);
      svg.removeEventListener('click', onClickCapture, true);
      svg.removeEventListener('dblclick', onDbl);
      svg.removeEventListener('keydown', onKey);
      if (ro) ro.disconnect();
    },
  };
}
