// 启动页：16+ 适龄提示与健康游戏忠告全文；点「进入城市」之前不联网。
const N = require('../ui/nodes');
const P = require('../ui/paint');
const { C, font } = require('../ui/theme');
const copy = require('../copy');
const config = require('../config');

function emblem(W, d) {
  const h = d * 0.9;
  return N.node(h, (g, x, y) => {
    const ctx = g.ctx, cx = x + W / 2, s = d / 244, ox = cx - 122 * s, oy = y;
    P.circle(ctx, cx, oy + 96 * s, 96 * s, null, 'rgba(255,237,206,0.12)', 1.5);
    P.circle(ctx, cx, oy + 96 * s, 78 * s, C.moon);
    ctx.fillStyle = C.bg;
    P.tracePath(ctx, 'M52 140V84l16-21 16 21v56zM94 140V92a28 28 0 0 1 56 0v48zM160 140V84l16-21 16 21v56zM115 70V50l7-20 7 20v20zM30 126h184v40H30z', ox, oy, s); ctx.fill();
    ctx.fillStyle = C.moon; P.tracePath(ctx, 'M104 166v-20a18 18 0 0 1 36 0v20z', ox, oy, s); ctx.fill();
    [[60, 182, 124, 0.75], [80, 196, 84, 0.45], [100, 208, 44, 0.25]].forEach(([lx, ly, lw, a]) => { ctx.globalAlpha = a; P.line(ctx, ox + lx * s, oy + ly * s, ox + (lx + lw) * s, oy + ly * s, C.moon, 4.5 * s); });
    ctx.globalAlpha = 1;
  });
}
function ageBadge(W) {
  N.record('age', copy.AGE); // 文本记录用完整说法；画面上是标识加两行字
  return N.node(46, (g, x, y) => {
    P.fillRound(g.ctx, x, y, 44, 44, 10, '#E9A93B');
    P.text(g.ctx, '16+', x + 22, y + 22, font(17, { bold: true }), '#3A2604', 'center');
    P.text(g.ctx, '适龄提示', x + 54, y + 13, font(12, {}), C.text2);
    P.text(g.ctx, '16 岁及以上', x + 54, y + 31, font(12, {}), C.text2);
  });
}
function startup(app, W) {
  N.record('health', copy.HEALTH); // 文本记录用全文；画面按四句排版
  const health = N.card(W, iw => [N.text(iw, '健康游戏忠告', { style: 'meta', color: C.text3, align: 'center' })]
    .concat(copy.HEALTH_LINES.map(l => N.text(iw, l, { style: 'action', align: 'center', color: C.text, line: 25, kind: 'health-line' }))), { pad: 18, gap: 2 });
  const before = [N.space(Math.max(8, app.navTop - 36)), ageBadge(W)];
  const after = [
    N.text(W, '后人纪', { style: 'display', serif: true, bold: true, align: 'center', line: 50 }),
    N.text(W, '词元本位', { style: 'heading', serif: true, bold: true, align: 'center', color: C.moon }),
    N.text(W, copy.TAGLINE, { style: 'action', color: C.text2, align: 'center' }),
    N.space(4),
    health,
    N.text(W, '这是一场 AI 社会模拟：居民的言行由 AI 生成，可能有错误。', { style: 'meta', color: C.text3, align: 'center' }),
  ];
  // 按钮固定在底部；城徽用剩下的高度，小屏缩小，保证不用滚动就能看到全部提示。
  const footer = N.stack([N.text(W, copy.GAME_NAME, { style: 'caption', color: C.text2, align: 'center', line: 18 }), N.button(W, '进入城市', { type: 'start' }, { variant: 'primary', size: 'large' }), N.button(W, '隐私说明 · 版本 ' + config.version, { type: 'about' }, { variant: 'text', size: 'small' })], 6);
  const used = before.concat(after).reduce((s, n) => s + n.height, 0) + (before.length + after.length) * 12;
  const room = app.height - app.bottomInset - footer.height - 24 - used - 12;
  const d = Math.max(84, Math.min(220, W * 0.62, room / 0.9));
  const nodes = before.concat([emblem(W, d)], after);
  const spare = room - d * 0.9;
  if (spare > 0) nodes.splice(2, 0, N.space(Math.min(24, spare / 3)));
  return { fullscreen: true, nodes, footer, padTop: 0, padBottom: 12, tabbar: false };
}
module.exports = { startup };
