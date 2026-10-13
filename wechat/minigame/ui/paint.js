// 绘图工具：圆角矩形、SVG 路径（线性图标）、印章头像。只用各端 Canvas 都支持的基础指令。
const { C } = require('./theme');

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
function fillRound(ctx, x, y, w, h, r, color) { roundRect(ctx, x, y, w, h, r); ctx.fillStyle = color; ctx.fill(); }
function strokeRound(ctx, x, y, w, h, r, color, width = 1) { roundRect(ctx, x + width / 2, y + width / 2, w - width, h - width, r); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
function circle(ctx, x, y, r, fill, stroke, width = 1) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}
function line(ctx, x1, y1, x2, y2, color, width = 1) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
function text(ctx, value, x, y, font, color, align = 'left') {
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

// ── SVG 路径 → Canvas（M L H V C S Q T A Z，绝对与相对坐标；圆弧转三次贝塞尔） ──
const pathCache = new Map();
function parsePath(d) {
  if (pathCache.has(d)) return pathCache.get(d);
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g) || [];
  const out = [];
  let i = 0, cmd = '';
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd || /z/i.test(cmd)) break; // 没有命令的数字：路径写错了，停在这里
    const n = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }[cmd.toUpperCase()];
    if (n === undefined) break;
    const args = [];
    for (let k = 0; k < n; k++) args.push(num());
    out.push([cmd, args]);
    if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
  }
  pathCache.set(d, out);
  return out;
}
function arcToBeziers(x1, y1, rx, ry, angle, large, sweep, x2, y2) {
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  const phi = angle * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = coef * (rx * y1p) / ry, cyp = coef * -(ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  let start = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && delta > 0) delta -= Math.PI * 2; else if (sweep && delta < 0) delta += Math.PI * 2;
  const segments = Math.ceil(Math.abs(delta) / (Math.PI / 2)), step = delta / segments, k = 4 / 3 * Math.tan(step / 4);
  const result = [];
  for (let s = 0; s < segments; s++) {
    const a1 = start + s * step, a2 = a1 + step;
    const p = (a, r1, r2) => [cx + cos * r1 * Math.cos(a) - sin * r2 * Math.sin(a), cy + sin * r1 * Math.cos(a) + cos * r2 * Math.sin(a)];
    const d = (a) => [-cos * rx * Math.sin(a) - sin * ry * Math.cos(a), -sin * rx * Math.sin(a) + cos * ry * Math.cos(a)];
    const [sx, sy] = p(a1, rx, ry), [ex, ey] = p(a2, rx, ry), [d1x, d1y] = d(a1), [d2x, d2y] = d(a2);
    result.push([sx + k * d1x, sy + k * d1y, ex - k * d2x, ey - k * d2y, ex, ey]);
  }
  return result;
}
/** 在 (x, y) 处按 scale 画 24×24 坐标系里的路径。 */
function tracePath(ctx, d, x, y, scale) {
  let cx = 0, cy = 0, sx = 0, sy = 0, lastC = null, lastQ = null;
  const X = v => x + v * scale, Y = v => y + v * scale;
  ctx.beginPath();
  for (const [cmd, a] of parsePath(d)) {
    const rel = cmd === cmd.toLowerCase(), C0 = cmd.toUpperCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C0 === 'M') { cx = ox + a[0]; cy = oy + a[1]; sx = cx; sy = cy; ctx.moveTo(X(cx), Y(cy)); lastC = lastQ = null; }
    else if (C0 === 'L') { cx = ox + a[0]; cy = oy + a[1]; ctx.lineTo(X(cx), Y(cy)); lastC = lastQ = null; }
    else if (C0 === 'H') { cx = (rel ? cx : 0) + a[0]; ctx.lineTo(X(cx), Y(cy)); lastC = lastQ = null; }
    else if (C0 === 'V') { cy = (rel ? cy : 0) + a[0]; ctx.lineTo(X(cx), Y(cy)); lastC = lastQ = null; }
    else if (C0 === 'C' || C0 === 'S') {
      let x1, y1, x2, y2, ex, ey;
      if (C0 === 'C') { [x1, y1, x2, y2, ex, ey] = [ox + a[0], oy + a[1], ox + a[2], oy + a[3], ox + a[4], oy + a[5]]; }
      else { x1 = lastC ? 2 * cx - lastC[0] : cx; y1 = lastC ? 2 * cy - lastC[1] : cy; [x2, y2, ex, ey] = [ox + a[0], oy + a[1], ox + a[2], oy + a[3]]; }
      ctx.bezierCurveTo(X(x1), Y(y1), X(x2), Y(y2), X(ex), Y(ey)); lastC = [x2, y2]; lastQ = null; cx = ex; cy = ey;
    } else if (C0 === 'Q' || C0 === 'T') {
      let qx, qy, ex, ey;
      if (C0 === 'Q') { [qx, qy, ex, ey] = [ox + a[0], oy + a[1], ox + a[2], oy + a[3]]; }
      else { qx = lastQ ? 2 * cx - lastQ[0] : cx; qy = lastQ ? 2 * cy - lastQ[1] : cy; [ex, ey] = [ox + a[0], oy + a[1]]; }
      ctx.quadraticCurveTo(X(qx), Y(qy), X(ex), Y(ey)); lastQ = [qx, qy]; lastC = null; cx = ex; cy = ey;
    } else if (C0 === 'A') {
      const ex = ox + a[5], ey = oy + a[6];
      for (const b of arcToBeziers(cx, cy, a[0], a[1], a[2], a[3], a[4], ex, ey)) ctx.bezierCurveTo(X(b[0]), Y(b[1]), X(b[2]), Y(b[3]), X(b[4]), Y(b[5]));
      cx = ex; cy = ey; lastC = lastQ = null;
    } else if (C0 === 'Z') { ctx.closePath(); cx = sx; cy = sy; lastC = lastQ = null; }
  }
}
const circlePath = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
// 24×24 线性图标（描边）；fill 为真的画实心。
const ICONS = {
  city: circlePath(15, 7, 3.2) + 'M4 20v-8l2.5-2.5L9 12v8M12 20v-5a2 2 0 0 1 4 0v5M3 20h18',
  residents: circlePath(9, 8.5, 3.2) + 'M3.5 20a5.5 5.5 0 0 1 11 0' + circlePath(17, 9.5, 2.6) + 'M16 14.3a4.6 4.6 0 0 1 4.6 5.7',
  archive: 'M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2zM6 18a2 2 0 0 1 2-2h11M10 8h5',
  me: circlePath(12, 8.5, 3.6) + 'M5 20a7 7 0 0 1 14 0',
  explore: circlePath(12, 12, 8.5) + 'M14.8 9.2l-1.7 4.6-4.6 1.7 1.7-4.6z',
  gather: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  move: 'M5 12h12M13 7l5 5-5 5',
  give: 'M4 11h16v9H4zM12 11v9M3 7.5h18V11H3zM12 7.5c-1.4-3-5-3.2-5-1.2s3.4 1.2 5 1.2c1.6 0 5 .8 5-1.2s-3.6-1.8-5 1.2',
  law: 'M12 4v16M8 20h8M5 7h14M5 7l-2.5 5.5h5zM19 7l-2.5 5.5h5z',
  build: 'M14.5 3.5l6 6-2.5 2.5-6-6zM12 6l-8.5 8.5 3 3L15 9',
  life: 'M12 20s-7-4.3-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4c0 5.3-7 9.6-7 9.6z',
  know: 'M5 19.5l3.8-.9L19.5 7.9l-2.9-2.9L5.9 15.7zM14.6 7l2.9 2.9',
  sun: circlePath(12, 12, 4) + 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
  weather: 'M7 18h10a4 4 0 0 0 .4-8 5.2 5.2 0 0 0-10-1.4A4.6 4.6 0 0 0 7 18z',
  speech: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  lock: 'M7.5 10.5h9a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18v-5a2.5 2.5 0 0 1 2.5-2.5zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
  search: circlePath(11, 11, 6.5) + 'M20 20l-4.2-4.2',
  right: 'M9 5l7 7-7 7', left: 'M15 5l-7 7 7 7', down: 'M5 9l7 7 7-7', up: 'M5 15l7-7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  locate: circlePath(12, 12, 3.5) + 'M12 3v3M12 18v3M3 12h3M18 12h3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z',
  key: circlePath(8, 15, 4) + 'M11 12l9-9M17 6l3 3',
  token: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z',
  settings: circlePath(12, 12, 3.2) + 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  info: circlePath(12, 12, 9) + 'M12 11v6M12 7.6v.4',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5',
  well: 'M5 7c0-1.4 3.1-2.6 7-2.6s7 1.2 7 2.6-3.1 2.6-7 2.6S5 8.4 5 7zM5 7v8c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7V7M12 11v3',
  heart: 'M12 20s-7-4.3-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4c0 5.3-7 9.6-7 9.6z',
  logout: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
  plus: 'M12 5v14M5 12h14',
  pen: 'M4 20l4-1 11-11-3-3L5 16zM14 7l3 3',
  play: 'M8 5v14l11-7z', pause: 'M8 5v14M16 5v14',
  type: 'M5 6h14M12 6v13M9 19h6',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z' + circlePath(12, 12, 3),
};
function icon(ctx, name, x, y, size, color, width = 1.8, fill = false) {
  const d = ICONS[name];
  if (!d) return;
  tracePath(ctx, d, x, y, size / 24);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (fill) { ctx.fillStyle = color; ctx.fill(); }
  else { ctx.strokeStyle = color; ctx.lineWidth = width * size / 24; ctx.stroke(); }
}

function hashIndex(id, n) { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % n; }
// 有的端的 Canvas 不认 hsl()，所以先换成十六进制。
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
  return '#' + f(0) + f(8) + f(4);
}
const ROLE_HUE = { guide: 162, announcer: 174, chronicler: 186, archivist: 198, clerk: 210, registrar: 222, wellkeeper: 234, researcher: 246, cradlekeeper: 258, memorialkeeper: 270 };
/** 首字印章：居民为圆形，公共角色为方形（沿用 public/roles 的色相）。 */
function seal(ctx, cx, cy, d, char, { id = '', role = null, font, ring = 'rgba(255,237,206,0.55)' } = {}) {
  const r = d / 2;
  if (role) {
    const hue = ROLE_HUE[role] !== undefined ? ROLE_HUE[role] : 150;
    roundRect(ctx, cx - r, cy - r, d, d, d * 0.25); ctx.fillStyle = hslHex(hue, 25, 24); ctx.fill();
    roundRect(ctx, cx - r + 0.75, cy - r + 0.75, d - 1.5, d - 1.5, d * 0.24); ctx.strokeStyle = '#a6c5b6'; ctx.lineWidth = 1.2; ctx.stroke();
    text(ctx, char, cx, cy + d * 0.03, font, '#e3e5c9', 'center');
    return;
  }
  circle(ctx, cx, cy, r, C.seal[hashIndex(id, C.seal.length)]);
  circle(ctx, cx, cy, r - Math.max(0.75, d / 40), null, ring, Math.max(1.2, d / 26));
  text(ctx, char, cx, cy + d * 0.03, font, '#F3EEE4', 'center');
}
/** 已审核的头像图片：裁成圆形；图片不可用时调用方改画印章。 */
function avatarImage(ctx, image, cx, cy, d) {
  const r = d / 2;
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.drawImage(image, cx - r, cy - r, d, d);
  ctx.restore();
  circle(ctx, cx, cy, r - 0.75, null, 'rgba(255,237,206,0.55)', Math.max(1.2, d / 26));
}

module.exports = { roundRect, fillRound, strokeRound, circle, line, text, icon, ICONS, tracePath, seal, avatarImage, hashIndex };
