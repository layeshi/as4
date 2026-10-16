// 城市地图：画在离屏画布上，数据或尺寸变化时才重画；返回地点与居民的点按区域（地图内坐标）。
const { C, font } = require('./theme');
const P = require('./paint');
const T = require('./text');
const { usable } = require('../utils/feed');

// 与引擎创世规则一致：tenements、temple 是「可修复和改装的空壳」（src/e2/world.js）。
const SHELLS = new Set(['tenements', 'temple']);
const DISTRICT_TINT = { harbor: '#7FB2FF', oldtown: '#B79CFF', commons: '#5CC8A0', waterworks: '#5FD0D8', east: '#7FB2FF' };

function kindOf(p) {
  if (p.wild) return 'wild';
  if (p.origin === 'agent') return 'built';
  if (p.ruined || p.razed || SHELLS.has(p.id)) return 'shell';
  return 'facility';
}
/** 取景：旧地图铺满整张图；第七前提「三城」的岛图全岛时框住整座岛，选了城就框住那座城（地点与空地外扩一圈） */
function frame(map, focus, w, h, pad = 14, view = null) {
  const [mw, mh] = map.size || [1200, 900], terrain = map.terrain || {};
  const pts = map.cities && focus ? (map.places || []).filter(p => p.city === focus).map(p => p.xy).concat((map.lots || []).filter(l => l.city === focus).map(l => l.xy)) : terrain.island || null;
  let box = [0, 0, mw, mh];
  if (pts && pts.length) {
    const m = map.cities && focus ? 90 : 20, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    box = [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m];
  }
  const bw = box[2] - box[0], bh = box[3] - box[1], fit = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  if (map.cities && focus && view) {
    view.zoom = Math.max(1, Math.min(4, view.zoom));
    const s = fit * view.zoom, maxX = Math.max(0, (bw * s - w + pad * 2) / 2), maxY = Math.max(0, (bh * s - h + pad * 2) / 2);
    view.x = Math.max(-maxX, Math.min(maxX, view.x));
    view.y = Math.max(-maxY, Math.min(maxY, view.y));
    return { s, ox: w / 2 - (box[0] + box[2]) / 2 * s + view.x, oy: h / 2 - (box[1] + box[3]) / 2 * s + view.y };
  }
  const s = fit;
  return { s, ox: (w - bw * s) / 2 - box[0] * s, oy: (h - bh * s) / 2 - box[1] * s };
}
function placeLabel(p) {
  const name = p.displayName && typeof p.displayName === 'object' ? p.displayName.zh : p.displayName || p.name;
  return usable(name) ? name : '地名暂未显示';
}

class CityMap {
  constructor(createCanvas) { this.createCanvas = createCanvas; this.canvas = null; this.key = ''; this.hits = []; this.resetView(); }
  resetView() { this.view = { zoom: 1, x: 0, y: 0 }; this.gesture = null; }
  startGesture(points) {
    if (!this.viewport) return;
    this.gesture = { points, view: { ...this.view } };
  }
  moveGesture(points) {
    const start = this.gesture;
    if (!start || !points.length) return;
    if (start.points.length !== points.length) { this.startGesture(points); return; }
    const center = pts => pts.length > 1 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    const a = center(start.points), b = center(points);
    const distance = pts => Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const factor = points.length > 1 ? distance(points) / Math.max(1, distance(start.points)) : 1;
    const zoom = Math.max(1, Math.min(4, start.view.zoom * factor)), ratio = zoom / start.view.zoom;
    // 世界坐标的指间中心保持在指下；平移按屏幕像素算，字号与点按区不跟着放大。
    this.view = { zoom, x: ratio * start.view.x + b.x - this.width / 2 - ratio * (a.x - this.width / 2), y: ratio * start.view.y + b.y - this.height / 2 - ratio * (a.y - this.height / 2) };
  }
  endGesture() { this.gesture = null; }
  /**
   * model: { map, state, active: Set(placeId), avatar(hash) }；w×h 为 CSS 像素。
   * 返回 { canvas, hits }。
   */
  render(model, w, h, dpr, version) {
    const focus = model.map && model.map.cities && model.focus || null;
    if (this.focus !== focus) { this.resetView(); this.focus = focus; }
    this.width = w; this.height = h;
    this.viewport = model.map ? frame(model.map, focus, w, h, 14, this.view) : null;
    const key = [version, w, h, dpr, focus || '', JSON.stringify(this.view), JSON.stringify(model.moves || [])].join('|');
    if (this.canvas && key === this.key) return { canvas: this.canvas, hits: this.hits };
    if (!this.canvas) this.canvas = this.createCanvas();
    const canvas = this.canvas;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0); else ctx.scale(dpr, dpr);
    // 缩放后的点按区也必须裁到地图内，不能盖住下方统计和事件流。
    this.hits = this.draw(ctx, model, w, h);
    if (model.map && model.map.cities && focus) this.hits = this.hits.map(hit => {
      const x = Math.max(0, hit.x), y = Math.max(0, hit.y);
      return { ...hit, x, y, w: Math.min(w, hit.x + hit.w) - x, h: Math.min(h, hit.y + hit.h) - y };
    }).filter(hit => hit.w > 0 && hit.h > 0);
    this.key = key;
    return { canvas, hits: this.hits };
  }
  draw(ctx, model, w, h) {
    const hits = this.drawBase(ctx, model, w, h), { map, state, focus } = model;
    if (!map || !state || !map.cities || focus) return hits;
    // 全岛：每座城一块城牌（城名、籍与在场人数），点城牌就切到那座城
    const { s, ox, oy } = frame(map, null, w, h), cities = state.cities || [];
    const cityOf = {};
    (map.places || []).concat(state.places || []).forEach(p => { cityOf[p.id] = p.city || null; });
    const alive = (state.agents || []).filter(a => ['awake', 'dormant'].includes(a.status));
    // 跨城的移动（最近一刻）：一道偏向岛心的虚线弧
    const xyOf = {};
    (map.places || []).concat(state.places || []).forEach(p => { if (p.xy) xyOf[p.id] = p.xy; });
    ctx.strokeStyle = 'rgba(242,182,94,0.75)'; ctx.lineWidth = 1.5;
    if (ctx.setLineDash) ctx.setLineDash([4, 4]);
    for (const [a, b] of model.moves || []) {
      if ((cityOf[a] || null) === (cityOf[b] || null) || !xyOf[a] || !xyOf[b]) continue;
      const ax = ox + s * xyOf[a][0], ay = oy + s * xyOf[a][1], bx = ox + s * xyOf[b][0], by = oy + s * xyOf[b][1];
      const mx = (ax + bx) / 2, my = (ay + by) / 2, len = Math.hypot(bx - ax, by - ay) || 1;
      let nx = -(by - ay) / len, ny = (bx - ax) / len;
      if ((mx + nx - w / 2) ** 2 + (my + ny - h / 2) ** 2 > (mx - w / 2) ** 2 + (my - h / 2) ** 2) { nx = -nx; ny = -ny; }
      const k = Math.min(60, len * 0.22);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx + nx * k, my + ny * k, bx, by); ctx.stroke();
    }
    if (ctx.setLineDash) ctx.setLineDash([]);
    for (const c of map.cities) {
      const pts = (map.places || []).filter(p => p.city === c.id).map(p => p.xy);
      if (!pts.length) continue;
      const cx = ox + s * pts.reduce((n, p) => n + p[0], 0) / pts.length, cy = oy + s * pts.reduce((n, p) => n + p[1], 0) / pts.length;
      const block = cities.find(x => x.id === c.id) || {}, short = (c.short && c.short.zh) || c.id;
      const line = `籍 ${alive.filter(a => a.city === c.id).length} · 在场 ${alive.filter(a => cityOf[a.place] === c.id).length}`;
      const f1 = font(13, {}), f2 = font(11, {}), bw = Math.max(T.measure(ctx, f1, short), T.measure(ctx, f2, line)) + 20, bh = 40;
      const bx = Math.max(4, Math.min(w - bw - 4, cx - bw / 2)), by = Math.max(4, Math.min(h - bh - 4, cy - bh / 2));
      P.fillRound(ctx, bx, by, bw, bh, 8, 'rgba(10,21,32,0.86)');
      P.strokeRound(ctx, bx, by, bw, bh, 8, C.map.label || C.moon, 1);
      P.text(ctx, block.cityName && block.humanName && block.cityName !== block.humanName.zh ? block.cityName : short, bx + 10, by + 13, f1, C.text);
      P.text(ctx, line, bx + 10, by + 29, f2, C.text2);
      hits.push({ x: bx, y: by, w: bw, h: bh, action: { type: 'cityFocus', city: c.id } });
    }
    return hits;
  }
  drawBase(ctx, { map, state, active, avatar, focus }, w, h) {
    const hits = [];
    ctx.fillStyle = C.map.land; ctx.fillRect(0, 0, w, h);
    if (!map || !state) return hits;
    const [mw, mh] = map.size || [1200, 900];
    const { s, ox, oy } = frame(map, focus, w, h, 14, this.view);
    const X = v => ox + v * s, Y = v => oy + v * s;
    const terrain = map.terrain || {};
    // 第七前提的岛：海作底，岛是陆地
    if (terrain.island) {
      ctx.fillStyle = C.map.sea; ctx.fillRect(0, 0, w, h);
      ctx.beginPath(); terrain.island.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.closePath();
      ctx.fillStyle = C.map.land; ctx.fill();
    }
    const coords = {}, places = {};
    (map.places || []).concat(state.places || []).forEach(p => { if (p.xy && (!map.cities || !focus || p.city === focus)) coords[p.id] = { x: X(p.xy[0]), y: Y(p.xy[1]) }; });
    (state.places || []).forEach(p => { places[p.id] = p; });

    // 城区底色：按地点的城区求中心，画很淡的圆。
    const groups = {};
    (map.places || []).forEach(p => { if (p.district && p.xy) (groups[p.district] = groups[p.district] || []).push(p.xy); });
    ctx.globalAlpha = 0.06;
    for (const [district, pts] of Object.entries(groups)) {
      if (!DISTRICT_TINT[district]) continue;
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const r = Math.max(...pts.map(p => Math.hypot(p[0] - cx, p[1] - cy))) + 150;
      P.circle(ctx, X(cx), Y(cy), r * s, DISTRICT_TINT[district]);
    }
    ctx.globalAlpha = 1;
    // 城墙以外的荒野：斜线纹。
    const wasteX = terrain.wasteland && terrain.wasteland.x;
    if (wasteX) {
      ctx.save(); ctx.beginPath(); ctx.rect(X(wasteX), 0, w - X(wasteX), h); ctx.clip();
      ctx.strokeStyle = 'rgba(242,182,94,0.08)'; ctx.lineWidth = 2;
      for (let x = X(wasteX) - h; x < w; x += 8) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h, 0); ctx.stroke(); }
      ctx.restore();
    }
    // 海岸：海在西侧，边缘起伏一点，带几道倒影。
    const coast = terrain.coast && terrain.coast[0] ? terrain.coast[0][0] : null;
    if (coast !== null && coast !== undefined) {
      const cx = X(coast);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(cx + 4, 0);
      ctx.quadraticCurveTo(cx - 3, h * 0.25, cx + 4, h * 0.5); ctx.quadraticCurveTo(cx + 8, h * 0.75, cx + 1, h);
      ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = C.map.sea; ctx.fill();
      ctx.globalAlpha = 0.28;
      for (const [y, len] of [[0.33, 7], [0.37, 5], [0.66, 8], [0.7, 4]]) P.line(ctx, Math.max(2, cx * 0.25), h * y, Math.max(2, cx * 0.25) + len, h * y, C.moon, 1.5);
      ctx.globalAlpha = 1;
    }
    // 城墙：虚点线，留出城门。
    const wall = terrain.wall;
    if (wall && wall.x) {
      const gates = (wall.gates || []).slice().sort((a, b) => a[0] - b[0]);
      let from = 0;
      ctx.strokeStyle = C.map.wall; ctx.lineWidth = 2; ctx.lineCap = 'round';
      if (ctx.setLineDash) ctx.setLineDash([1, 5]);
      for (const [g0, g1] of gates.concat([[mh, mh]])) {
        if (g0 > from) { ctx.beginPath(); ctx.moveTo(X(wall.x), Y(from)); ctx.lineTo(X(wall.x), Y(g0)); ctx.stroke(); }
        from = Math.max(from, g1);
      }
      if (ctx.setLineDash) ctx.setLineDash([]);
    }
    // 街道与居民修的路。
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.map.street; ctx.lineWidth = 2;
    (map.streets || []).concat(state.roads || []).forEach(r => { const a = coords[r.a], b = coords[r.b]; if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } });
    if (ctx.setLineDash) ctx.setLineDash([4, 3.5]);
    ctx.strokeStyle = 'rgba(242,182,94,0.75)'; ctx.lineWidth = 1.8;
    (state.paths || []).forEach(r => { const a = coords[r.a], b = coords[r.b]; if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } });
    if (ctx.setLineDash) ctx.setLineDash([]);

    // 有动静的地点：琥珀色光圈。
    for (const id of active || []) {
      const c = coords[id]; if (!c) continue;
      P.circle(ctx, c.x, c.y, 18, null, 'rgba(242,182,94,0.18)', 1.5);
      P.circle(ctx, c.x, c.y, 11.5, null, 'rgba(242,182,94,0.42)', 1.5);
    }
    // 地点标记。
    const nodes = [];
    for (const id of Object.keys(coords)) {
      const p = places[id]; if (!p) continue;
      const c = coords[id], kind = kindOf(p);
      if (kind === 'facility') { P.circle(ctx, c.x, c.y, 6.5, C.map.land); P.circle(ctx, c.x, c.y, 4.6, C.moon); }
      else if (kind === 'shell') { P.circle(ctx, c.x, c.y, 5.5, C.map.land); P.circle(ctx, c.x, c.y, 4, null, C.map.ruin, 1.8); }
      else {
        const r = kind === 'built' ? 5.5 : 4.2;
        ctx.beginPath(); ctx.moveTo(c.x, c.y - r); ctx.lineTo(c.x + r, c.y); ctx.lineTo(c.x, c.y + r); ctx.lineTo(c.x - r, c.y); ctx.closePath();
        if (kind === 'built') { ctx.fillStyle = C.token; ctx.fill(); ctx.strokeStyle = C.map.land; ctx.lineWidth = 1.5; ctx.stroke(); }
        else { ctx.fillStyle = C.map.land; ctx.fill(); ctx.strokeStyle = C.material; ctx.lineWidth = 1.8; ctx.stroke(); }
      }
      nodes.push({ id, x: c.x, y: c.y });
      hits.push({ x: c.x - 18, y: c.y - 18, w: 36, h: 36, action: { type: 'sheet', kind: 'place', id } });
    }
    // 居民：按所在地点排在标记右上方；超过三位显示 +n。
    const residents = {};
    (state.agents || []).filter(a => a.place && ['awake', 'dormant'].includes(a.status)).forEach(a => { (residents[a.place] = residents[a.place] || []).push(a); });
    const occupied = [];
    for (const [placeId, list] of Object.entries(residents)) {
      const c = coords[placeId]; if (!c) continue;
      list.slice(0, 3).forEach((a, i) => {
        const ax = c.x + 13 + i * 15, ay = c.y - 12;
        const ch = Array.from(usable(a.name) ? a.name : '居')[0];
        const image = a.avatar && avatar ? avatar(a.avatar) : null;
        if (image) P.avatarImage(ctx, image, ax, ay, 20);
        else P.seal(ctx, ax, ay, 20, ch, { id: a.id, font: font(10, { serif: true, text: ch }) });
        occupied.push({ x: ax - 10, y: ay - 10, w: 20, h: 20 });
        hits.push({ x: ax - 12, y: ay - 12, w: 24, h: 24, action: { type: 'resident', id: a.id } });
      });
      if (list.length > 3) {
        const bx = c.x + 13 + 3 * 15, by = c.y - 12;
        P.circle(ctx, bx, by, 9, C.raised, C.lineStrong, 1);
        P.text(ctx, '+' + (list.length - 3), bx, by, font(10, { bold: true }), C.text, 'center');
      }
    }
    // 全岛只读城牌；地点名留到城级，避免把三城的标签挤在同一张小图里。
    if (map.cities && !focus) return hits;
    // 标签先贴近标记；拥挤时向外寻找空位，用引线保持地点对应关系。
    const labelFont = font(11, {}), placed = occupied.slice();
    nodes.forEach(n => placed.push({ x: n.x - 6, y: n.y - 6, w: 12, h: 12 }));
    const order = nodes.slice().sort((a, b) => (residents[b.id] ? 1 : 0) - (residents[a.id] ? 1 : 0));
    ctx.font = labelFont;
    for (const n of order) {
      if (map.cities && focus && (n.x < 0 || n.x > w || n.y < 0 || n.y > h)) continue;
      const label = T.ellipsize(ctx, placeLabel(places[n.id]), Math.min(w - 4, Math.max(80, w * 0.3)), labelFont);
      const lw = T.measure(ctx, labelFont, label), lh = 14;
      const tries = [[n.x - lw / 2, n.y + 9], [n.x - lw / 2, n.y - 9 - lh], [n.x + 10, n.y - lh / 2], [n.x - 10 - lw, n.y - lh / 2]];
      const extra = [];
      for (let y = 2; y + lh <= h - 2; y += lh + 3) {
        for (let x = 2; x + lw <= w - 2; x += 8) extra.push([x, y]);
      }
      extra.sort((a, b) => Math.hypot(a[0] + lw / 2 - n.x, a[1] + lh / 2 - n.y) - Math.hypot(b[0] + lw / 2 - n.x, b[1] + lh / 2 - n.y));
      tries.push(...extra);
      const spot = tries.find(([x, y]) => x >= 2 && y >= 2 && x + lw <= w - 2 && y + lh <= h - 2 && !placed.some(r => x < r.x + r.w && x + lw > r.x && y < r.y + r.h && y + lh > r.y));
      if (!spot) continue;
      placed.push({ x: spot[0], y: spot[1], w: lw, h: lh });
      const tx = Math.max(spot[0], Math.min(spot[0] + lw, n.x)), ty = Math.max(spot[1], Math.min(spot[1] + lh, n.y));
      if (Math.hypot(tx - n.x, ty - n.y) > 12) P.line(ctx, n.x, n.y, tx, ty, C.map.wall, 0.7);
      ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = C.map.land; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      if (ctx.strokeText) ctx.strokeText(label, spot[0], spot[1] + lh / 2);
      ctx.fillStyle = '#C9D2DA'; ctx.fillText(label, spot[0], spot[1] + lh / 2);
    }
    return hits;
  }
}
module.exports = { CityMap, kindOf, placeLabel };
