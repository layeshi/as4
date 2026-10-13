// 界面组件：每个组件在构建时按给定宽度算好高度，返回 { height, paint(g, x, y) }。
// g = { ctx, hit(x, y, w, h, action), pressed(action), avatar(agent) }；构建结果缓存到数据变化为止。
const { C, STATUS_COLOR, size, font, RADIUS } = require('./theme');
const T = require('./text');
const P = require('./paint');
const { usable } = require('../utils/feed');

let measureCtx = null;
let blocks = null;
function begin(ctx, collect) { measureCtx = ctx; blocks = collect; }
const note = (kind, text, extra) => { if (blocks) blocks.push(Object.assign({ kind, text }, extra || {})); };

const node = (height, paint) => ({ height, paint });
function space(h) { return node(h, () => {}); }

function styleFont(style, opts = {}) {
  const s = size(style);
  return { font: font(s.size, { bold: !!opts.bold, serif: !!opts.serif, text: opts.text || '' }), size: s.size, line: opts.line || s.line };
}

/** 段落文字。maxLines 截断；align 可为 center。 */
function text(W, value, opts = {}) {
  value = String(value == null ? '' : value);
  note(opts.kind || 'text', value, { style: opts.style });
  const f = styleFont(opts.style || 'body', { bold: opts.bold, serif: opts.serif, text: value, line: opts.line });
  const { lines } = opts.maxLines ? T.clamp(measureCtx, value, W, f.font, opts.maxLines) : { lines: T.wrap(measureCtx, value, W, f.font) };
  const color = opts.color || C.text;
  return node(lines.length * f.line, (g, x, y) => {
    lines.forEach((l, i) => P.text(g.ctx, l, opts.align === 'center' ? x + W / 2 : x, y + i * f.line + f.line / 2, f.font, color, opts.align === 'center' ? 'center' : 'left'));
    if (opts.action) g.hit(x, y, W, lines.length * f.line, opts.action);
  });
}

/** 富文本：segments = [{ text, color, bold, action }]，同一字号。 */
function rich(W, segments, opts = {}) {
  const st = styleFont(opts.style || 'action');
  const segs = segments.filter(s => s && s.text !== '' && s.text != null).map(s => ({ text: String(s.text), font: font(st.size, { bold: !!s.bold }), color: s.color || opts.color || C.text2, action: s.action || null }));
  note('rich', segs.map(s => s.text).join(''));
  let rows = T.wrapRich(measureCtx, segs, W);
  if (opts.maxLines && rows.length > opts.maxLines) rows = rows.slice(0, opts.maxLines);
  return node(rows.length * st.line, (g, x, y) => {
    rows.forEach((row, i) => {
      const cy = y + i * st.line + st.line / 2;
      for (const run of row.runs) {
        P.text(g.ctx, run.text, x + run.x, cy, run.seg.font, run.seg.color, 'left');
        if (run.seg.action) g.hit(x + run.x - 2, y + i * st.line, run.w + 4, st.line, run.seg.action);
      }
    });
  });
}

/** 纵向堆叠若干组件。 */
function stack(children, gap = 0) {
  children = children.filter(Boolean);
  const height = children.reduce((s, c) => s + c.height, 0) + Math.max(0, children.length - 1) * gap;
  return node(height, (g, x, y) => { let cy = y; for (const c of children) { c.paint(g, x, cy); cy += c.height + gap; } });
}
/** 卡片：inner(width) 返回内部组件数组。 */
function card(W, inner, opts = {}) {
  const pad = opts.pad === undefined ? 14 : opts.pad, padY = opts.padY === undefined ? pad : opts.padY;
  const body = stack(inner(W - pad * 2), opts.gap === undefined ? 8 : opts.gap);
  const h = body.height + padY * 2;
  return node(h, (g, x, y) => {
    const pressed = opts.action && g.pressed(opts.action);
    P.fillRound(g.ctx, x, y, W, h, opts.radius || RADIUS.card, pressed ? C.raised : opts.fill || C.card);
    if (opts.border !== false) P.strokeRound(g.ctx, x, y, W, h, opts.radius || RADIUS.card, opts.border || C.line, 1);
    if (opts.dashed && g.ctx.setLineDash) { /* 由调用方画虚线框 */ }
    body.paint(g, x + pad, y + padY);
    if (opts.action) g.hit(x, y, W, h, opts.action);
  });
}
/** 横向等分列。 */
function columns(W, cells, gap = 10) {
  const n = cells.length, cw = (W - gap * (n - 1)) / n;
  const built = cells.map(c => c(cw));
  const h = Math.max(0, ...built.map(b => b.height));
  return node(h, (g, x, y) => built.forEach((b, i) => b.paint(g, x + i * (cw + gap), y)));
}
/** 在固定高度的行里放左右两部分（如标题与右侧链接）。 */
function split(W, left, right, h) {
  return node(h, (g, x, y) => { if (left) left(g, x, y, h); if (right) right(g, x + W, y, h); });
}

const BUTTON_H = { large: 52, normal: 46, small: 36 };
/** 按钮：primary（月白实心）、secondary（描边）、text（文字）、danger（警示文字）。 */
function button(W, label, action, opts = {}) {
  note('button', label, { action });
  const variant = opts.variant || 'secondary', h = BUTTON_H[opts.size || 'normal'];
  const f = font(opts.size === 'small' ? 14 : opts.size === 'large' ? 17 : 15, { bold: variant === 'primary' });
  return node(h, (g, x, y) => {
    const ctx = g.ctx, pressed = g.pressed(action);
    if (variant === 'primary') P.fillRound(ctx, x, y, W, h, RADIUS.button, pressed ? '#E8D6B6' : C.moon);
    else if (variant === 'secondary') { if (pressed) P.fillRound(ctx, x, y, W, h, RADIUS.button, C.raised); P.strokeRound(ctx, x, y, W, h, RADIUS.button, C.lineStrong, 1); }
    else if (pressed) P.fillRound(ctx, x, y, W, h, RADIUS.small, C.raised);
    const color = variant === 'primary' ? C.ink : variant === 'text' ? C.moon : variant === 'danger' ? C.danger : C.text;
    const labelW = T.measure(ctx, f, label), iconW = opts.icon ? 20 : 0;
    const startX = opts.align === 'left' ? x + 12 : x + (W - labelW - iconW) / 2;
    if (opts.icon) P.icon(ctx, opts.icon, startX, y + h / 2 - 8, 16, color, 2);
    P.text(ctx, label, startX + iconW, y + h / 2, f, color, 'left');
    g.hit(x, y, W, h, action);
  });
}
/** 一行等宽按钮。specs = [{ label, action, variant }] */
function buttonRow(W, specs, gap = 10, opts = {}) {
  return columns(W, specs.map(s => cw => button(cw, s.label, s.action, Object.assign({}, opts, s))), gap);
}

/** 标签：可换行排列；selected 为月白实心。 */
function chips(W, items, opts = {}) {
  const f = font(13, {}), fb = font(13, { bold: true }), h = 32, gap = 8, rows = [];
  let row = [], used = 0;
  for (const item of items) {
    const w = Math.ceil(T.measure(measureCtx, item.selected ? fb : f, item.label)) + 28;
    if (row.length && used + w > W) { rows.push(row); row = []; used = 0; }
    row.push({ item, w }); used += w + gap;
  }
  if (row.length) rows.push(row);
  const total = rows.length * h + Math.max(0, rows.length - 1) * gap;
  return node(total, (g, x, y) => {
    rows.forEach((r, ri) => {
      let cx = x;
      for (const { item, w } of r) {
        const cy = y + ri * (h + gap), pressed = g.pressed(item.action);
        if (item.selected) P.fillRound(g.ctx, cx, cy, w, h, h / 2, C.moon);
        else { if (pressed) P.fillRound(g.ctx, cx, cy, w, h, h / 2, C.raised); P.strokeRound(g.ctx, cx, cy, w, h, h / 2, opts.outline || '#2C4760', 1); }
        P.text(g.ctx, item.label, cx + w / 2, cy + h / 2, item.selected ? fb : f, item.selected ? C.ink : C.text2, 'center');
        g.hit(cx, cy - 4, w, h + 8, item.action);
        cx += w + gap;
      }
    });
  });
}
/** 分段控件：options = [{ label, action, selected }] */
function chipStrip(W, items, scroller) {
  const h = 40, gap = 8, f = font(13, {}), fb = font(13, { bold: true });
  const cells = items.map(item => {
    note('filter', item.label, { action: item.action });
    return { item, w: Math.ceil(T.measure(measureCtx, fb, item.label)) + 28 };
  });
  const total = cells.reduce((n, c) => n + c.w, 0) + Math.max(0, cells.length - 1) * gap;
  scroller.setMax(total - W);
  return node(h, (g, x, y) => {
    const ctx = g.ctx;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, W, h); ctx.clip();
    let cx = x - Math.round(scroller.offset);
    for (const { item, w } of cells) {
      if (cx + w > x && cx < x + W) {
        if (item.selected) P.fillRound(ctx, cx, y + 2, w, h - 4, 18, C.moon);
        else { if (g.pressed(item.action)) P.fillRound(ctx, cx, y + 2, w, h - 4, 18, C.raised); P.strokeRound(ctx, cx, y + 2, w, h - 4, 18, C.lineStrong, 1); }
        P.text(ctx, item.label, cx + w / 2, y + h / 2, item.selected ? fb : f, item.selected ? C.ink : C.text2, 'center');
        const left = Math.max(x, cx), right = Math.min(x + W, cx + w);
        g.hit(left, y, right - left, h, item.action);
      }
      cx += w + gap;
    }
    ctx.restore();
    if (g.horizontal && total > W) g.horizontal(x, y, W, h, scroller);
  });
}

function segmented(W, options) {
  const h = 42, pad = 3, n = options.length, cw = (W - pad * 2 - pad * (n - 1)) / n;
  options.forEach(o => note('segment', o.label, { action: o.action }));
  return node(h, (g, x, y) => {
    P.fillRound(g.ctx, x, y, W, h, 14, C.card); P.strokeRound(g.ctx, x, y, W, h, 14, C.line, 1);
    options.forEach((o, i) => {
      const cx = x + pad + i * (cw + pad);
      if (o.selected) P.fillRound(g.ctx, cx, y + pad, cw, h - pad * 2, 11, C.moon);
      else if (g.pressed(o.action)) P.fillRound(g.ctx, cx, y + pad, cw, h - pad * 2, 11, C.raised);
      P.text(g.ctx, o.label, cx + cw / 2, y + h / 2, font(14, { bold: !!o.selected }), o.selected ? C.ink : C.text2, 'center');
      g.hit(cx, y, cw, h, o.action);
    });
  });
}
/** 状态标签（小圆角）。返回宽度以便排版。 */
function chipWidth(label) { return Math.ceil(T.measure(measureCtx, font(12, {}), label)) + 16; }
function paintChip(ctx, label, x, y, color, opts = {}) {
  const w = chipWidth(label), h = opts.h || 20;
  ctx.globalAlpha = 0.16; P.fillRound(ctx, x, y, w, h, h / 2, color); ctx.globalAlpha = 1;
  P.text(ctx, label, x + w / 2, y + h / 2, font(12, {}), color, 'center');
  return w;
}

/** 头像：已审核图片或首字印章。 */
function paintAvatar(g, who, cx, cy, d) {
  const name = usable(who.name) && who.name !== '一位居民' ? who.name : '居';
  const ch = Array.from(name)[0] || '居';
  const f = font(Math.round(d * 0.44), { serif: true, text: ch });
  if (who.role) return P.seal(g.ctx, cx, cy, d, ch, { role: who.role, font: f });
  const image = who.avatar && g.avatar ? g.avatar(who.avatar) : null;
  if (image) P.avatarImage(g.ctx, image, cx, cy, d);
  else P.seal(g.ctx, cx, cy, d, ch, { id: who.id, font: f });
}

/** 列表行：头像、名字 + 状态、简介一行、说明一行、右侧数值。 */
function listRow(W, o) {
  const av = o.avatar ? 46 : 0, gap = av ? 12 : 0, right = o.trailing ? 76 : (o.chevron ? 18 : 0);
  const tw = W - av - gap - right;
  const titleF = font(16, { bold: true }), subF = font(13, {}), metaF = font(12, {});
  note('row', o.title, { action: o.action });
  const sub = o.sub ? T.ellipsize(measureCtx, o.sub, tw, subF) : '';
  const meta = o.meta ? T.ellipsize(measureCtx, o.meta, tw, metaF) : '';
  const h = Math.max(av + 24, 24 + 22 + (sub ? 20 : 0) + (meta ? 18 : 0));
  return node(h, (g, x, y) => {
    const ctx = g.ctx;
    if (g.pressed(o.action)) { ctx.fillStyle = C.card; ctx.fillRect(x - 16, y, W + 32, h); }
    if (o.avatar) paintAvatar(g, o.avatar, x + av / 2, y + h / 2, av);
    const tx = x + av + gap;
    let cy = y + (h - (22 + (sub ? 20 : 0) + (meta ? 18 : 0))) / 2;
    const name = T.ellipsize(ctx, o.title, tw - (o.chip ? chipWidth(o.chip.label) + 8 : 0), titleF);
    P.text(ctx, name, tx, cy + 11, titleF, C.text);
    if (o.chip) paintChip(ctx, o.chip.label, tx + T.measure(ctx, titleF, name) + 8, cy + 1, o.chip.color);
    cy += 22;
    if (sub) { P.text(ctx, sub, tx, cy + 10, subF, C.text2); cy += 20; }
    if (meta) P.text(ctx, meta, tx, cy + 9, metaF, C.text3);
    if (o.trailing) {
      P.text(ctx, o.trailing.value, x + W, y + h / 2 - 9, font(16, { bold: true }), o.trailing.color || C.token, 'right');
      P.text(ctx, o.trailing.label, x + W, y + h / 2 + 11, metaF, C.text3, 'right');
    } else if (o.chevron) P.icon(ctx, 'right', x + W - 14, y + h / 2 - 7, 14, '#5B6E82', 2.4);
    P.line(ctx, x, y + h - 0.5, x + W, y + h - 0.5, C.divider, 1);
    if (o.action) g.hit(x - 16, y, W + 32, h, o.action);
  });
}
/** 设置类列表（一组圆角卡片里的行）。rows = [{ label, hint, action, icon, danger }] */
function menu(W, rows) {
  const h = 52;
  rows.forEach(r => note('menu', r.label, { action: r.action }));
  return node(rows.length * h, (g, x, y) => {
    const ctx = g.ctx;
    P.fillRound(ctx, x, y, W, rows.length * h, RADIUS.card, C.card); P.strokeRound(ctx, x, y, W, rows.length * h, RADIUS.card, C.line, 1);
    rows.forEach((r, i) => {
      const ry = y + i * h;
      if (g.pressed(r.action)) { ctx.save(); P.roundRect(ctx, x, y, W, rows.length * h, RADIUS.card); ctx.clip(); ctx.fillStyle = C.raised; ctx.fillRect(x, ry, W, h); ctx.restore(); }
      let tx = x + 14;
      if (r.icon) { P.icon(ctx, r.icon, tx, ry + h / 2 - 10, 20, r.danger ? C.danger : C.text2, 1.8); tx += 30; }
      P.text(ctx, r.label, tx, ry + h / 2, font(15, {}), r.danger ? C.danger : C.text);
      if (r.hint) P.text(ctx, r.hint, x + W - 34, ry + h / 2, font(13, {}), C.text3, 'right');
      if (r.toggle !== undefined) paintToggle(ctx, x + W - 58, ry + h / 2 - 14, r.toggle);
      else P.icon(ctx, 'right', x + W - 26, ry + h / 2 - 7, 14, '#5B6E82', 2.4);
      if (i < rows.length - 1) P.line(ctx, x + 14, ry + h - 0.5, x + W - 14, ry + h - 0.5, C.raised, 1);
      g.hit(x, ry, W, h, r.action);
    });
  });
}
function paintToggle(ctx, x, y, on) {
  P.fillRound(ctx, x, y, 46, 28, 14, on ? C.awake : '#2C4760');
  P.circle(ctx, on ? x + 32 : x + 14, y + 14, 11, '#F3EEE4');
}

/** 统计块。 */
function stat(W, label, value, sub, color) {
  const h = 76;
  return node(h, (g, x, y) => {
    P.fillRound(g.ctx, x, y, W, h, 14, C.card); P.strokeRound(g.ctx, x, y, W, h, 14, C.line, 1);
    P.text(g.ctx, label, x + 12, y + 18, font(12, {}), C.text3);
    P.text(g.ctx, T.ellipsize(g.ctx, value, W - 24, font(20, { bold: true })), x + 12, y + 40, font(20, { bold: true }), color || C.text);
    if (sub) P.text(g.ctx, T.ellipsize(g.ctx, sub.text, W - 24, font(12, {})), x + 12, y + 61, font(12, {}), sub.color || C.text3);
  });
}
/** 输入框：点按后由微信键盘输入。 */
function field(W, label, value, action, opts = {}) {
  note('field', label, { action });
  const labelF = font(12, {}), valueF = font(15, {}), inner = W - 28;
  const shown = value ? (opts.secret ? '•'.repeat(Math.min(24, Array.from(value).length)) : value) : opts.placeholder || '点击填写';
  const { lines } = T.clamp(measureCtx, shown, inner, valueF, opts.multiline ? opts.lines || 6 : 1);
  const boxH = Math.max(46, lines.length * 24 + 22);
  const h = 22 + boxH + (opts.hint ? 22 : 0);
  return node(h, (g, x, y) => {
    const ctx = g.ctx, editing = g.editing && g.editing === action.name;
    P.text(ctx, label, x, y + 9, labelF, C.text3);
    if (opts.counter) P.text(ctx, `${Array.from(value || '').length} / ${opts.counter}`, x + W, y + 9, labelF, C.text3, 'right');
    P.fillRound(ctx, x, y + 22, W, boxH, 12, g.pressed(action) || editing ? '#22394F' : C.raised);
    P.strokeRound(ctx, x, y + 22, W, boxH, 12, editing ? C.moon : opts.error ? C.danger : C.line, editing ? 1.5 : 1);
    lines.forEach((l, i) => P.text(ctx, l, x + 14, y + 22 + 11 + i * 24 + 12, opts.mono && value ? font(14, {}) : valueF, value ? C.text : C.text3));
    if (opts.hint) P.text(ctx, opts.hint, x, y + 22 + boxH + 12, labelF, opts.error ? C.danger : C.text3);
    g.hit(x, y + 22, W, boxH, action);
  });
}
/** 勾选：label 里 link 部分可另点。 */
function checkbox(W, label, checked, action, link) {
  note('checkbox', label, { action, checked });
  const f = font(13, {});
  const segs = [{ text: label, font: f, color: C.text2 }];
  if (link) segs.push({ text: link.label, font: f, color: C.moon, action: link.action });
  const rows = T.wrapRich(measureCtx, segs, W - 30);
  const h = Math.max(28, rows.length * 20 + 6);
  return node(h, (g, x, y) => {
    const ctx = g.ctx;
    g.hit(x - 8, y - 6, 38, h + 12, action);
    rows.forEach((row, i) => g.hit(x + 30, y + i * 20, row.width, 24, action));
    P.fillRound(ctx, x, y + 4, 20, 20, 6, checked ? C.moon : 'rgba(0,0,0,0)');
    P.strokeRound(ctx, x, y + 4, 20, 20, 6, checked ? C.moon : C.lineStrong, 1.5);
    if (checked) P.icon(ctx, 'check', x + 2, y + 6, 16, C.ink, 3);
    rows.forEach((row, i) => row.runs.forEach(run => {
      P.text(ctx, run.text, x + 30 + run.x, y + 4 + 10 + i * 20, run.seg.font, run.seg.color);
      if (run.seg.action) g.hit(x + 30 + run.x, y + i * 20, run.w, 24, run.seg.action);
    }));
  });
}
/** 进度条。 */
function progress(W, ratio, color, h = 8) {
  return node(h, (g, x, y) => {
    P.fillRound(g.ctx, x, y, W, h, h / 2, C.raised);
    const w = Math.max(0, Math.min(1, ratio || 0)) * W;
    if (w > 0.5) P.fillRound(g.ctx, x, y, Math.max(h, w), h, h / 2, color || C.moon);
  });
}
/** 小节标题：左边宋体标题与说明，右边可选链接。 */
function section(W, title, opts = {}) {
  note('heading', title);
  const f = font(opts.small ? 17 : 21, { bold: true, serif: true, text: title });
  const h = opts.small ? 30 : 36;
  return node(h, (g, x, y) => {
    P.text(g.ctx, title, x, y + h / 2, f, C.text);
    if (opts.sub) P.text(g.ctx, opts.sub, x + T.measure(g.ctx, f, title) + 10, y + h / 2 + 2, font(13, {}), C.text3);
    if (opts.link) {
      const lf = font(14, {});
      P.text(g.ctx, opts.link.label, x + W, y + h / 2, lf, C.moon, 'right');
      g.hit(x + W - T.measure(g.ctx, lf, opts.link.label) - 12, y, T.measure(g.ctx, lf, opts.link.label) + 12, h, opts.link.action);
    }
  });
}
/** 分隔说明行：左边文字，右边延伸细线（如「第 8 日 · 第 2 刻」）。 */
function rule(W, label) {
  return node(28, (g, x, y) => {
    const f = font(12, {}), w = T.measure(g.ctx, f, label);
    P.text(g.ctx, label, x, y + 16, f, C.text3);
    P.line(g.ctx, x + w + 10, y + 16.5, x + W, y + 16.5, C.line, 1);
  });
}
/** 空状态。 */
function empty(W, title, body) {
  return stack([space(24), text(W, title, { style: 'heading', color: C.text2, align: 'center', bold: true }), body ? text(W, body, { style: 'meta', color: C.text3, align: 'center' }) : null, space(24)], 6);
}
/** 提示横幅：图标 + 标题 + 正文 + 按钮。 */
function banner(W, o) {
  return card(W, iw => {
    const tw = iw - 50;
    const parts = [
      o.title ? text(tw, o.title, { style: 'heading', bold: true }) : null,
      o.body ? text(tw, o.body, { style: 'meta', color: C.text2 }) : null,
      o.actions ? columnsLeft(tw, o.actions) : null,
    ];
    const content = stack(parts, 6);
    return [node(Math.max(38, content.height), (g, x, y) => {
      P.circle(g.ctx, x + 19, y + 19, 19, 'rgba(255,237,206,0.12)');
      P.icon(g.ctx, o.icon || 'info', x + 9, y + 9, 20, C.moon, 1.9);
      content.paint(g, x + 50, y);
    })];
  }, { border: o.border || C.lineStrong });
}
function columnsLeft(W, actions) {
  const built = actions.map(a => { const w = Math.ceil(T.measure(measureCtx, font(14, { bold: a.variant === 'primary' }), a.label)) + (a.variant === 'text' ? 8 : 32); return { a, w, b: button(w, a.label, a.action, { variant: a.variant, size: 'small' }) }; });
  return node(36, (g, x, y) => { let cx = x; for (const it of built) { it.b.paint(g, cx, y); cx += it.w + 10; } });
}

module.exports = { begin, record: note, measureCtx: () => measureCtx, node, space, text, rich, stack, card, columns, split, button, buttonRow, chips, chipStrip, segmented, chipWidth, paintChip, paintAvatar, listRow, menu, stat, field, checkbox, progress, section, rule, empty, banner, STATUS_COLOR, paintToggle };
