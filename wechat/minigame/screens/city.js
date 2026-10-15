// 观测页：实况、地图、统计、「此刻」事件流；以及点地点弹出的底部卡片。
const N = require('../ui/nodes');
const { preview: announcementPreview } = require('./announcements');
const P = require('../ui/paint');
const T = require('../ui/text');
const { C, font, size } = require('../ui/theme');
const { buildFeed, usable, moderationNotice } = require('../utils/feed');
const { compact, num, pct, dayTick, countdown } = require('../utils/format');
const shared = require('../utils/shared-text');
const view = require('../utils/view');

const ROLE_COLOR = { agent: C.text, place: C.label, amount: C.token, number: C.text, doc: C.moon, ai: C.text };
function cityName(state) {
  const w = state.world || {};
  if (usable(w.cityName)) return w.cityName;
  return w.humanCityName && usable(w.humanCityName.zh) ? w.humanCityName.zh : '后人纪';
}
function living(state) { return (state.agents || []).filter(a => ['awake', 'dormant'].includes(a.status)); }
function segs(list, extra = {}) { return (list || []).map(s => Object.assign({ text: s.text, color: ROLE_COLOR[s.role] || extra.color || C.text2, bold: s.role === 'agent', action: s.action || null })); }

function liveRow(app, W) {
  const w = app.state.world;
  return N.node(22, (g, x, y) => {
    const ctx = g.ctx, f = font(13, {}), cy = y + 11;
    const remaining = w.nextTickAt ? new Date(w.nextTickAt).getTime() - Date.now() : NaN;
    const clock = Number.isFinite(remaining) ? remaining > 0 ? '距下一刻 ' + countdown(remaining) : countdown(remaining) : '';
    P.circle(ctx, x + 4, cy, 4, w.paused ? C.dormant : C.awake);
    P.text(ctx, w.paused ? '已暂停' : '实况', x + 14, cy, f, w.paused ? C.dormant : C.awake);
    P.text(ctx, dayTick(w.day, w.tick, w.ticksPerDay || 12), x + 14 + T.measure(ctx, f, w.paused ? '已暂停' : '实况') + 10, cy, f, C.text2);
    if (clock && !w.paused) P.text(ctx, clock, x + W, cy, f, C.text3, 'right');
  });
}
function mapCard(app, W) {
  const H = Math.round(W * 0.75), s = app.state;
  const latest = Math.max(-1, ...app.events.map(e => e.tick));
  const active = new Set(app.events.filter(e => e.tick === latest && e.place && e.type !== 'day').map(e => e.place));
  const people = living(s), awake = people.filter(a => a.status === 'awake').length;
  const chip = people.length ? `${people.length} 位居民 · ${awake === people.length ? '全部醒着' : awake + ' 位醒着'}` : '还没有居民';
  return N.node(H, (g, x, y) => {
    const ctx = g.ctx;
    const { canvas, hits } = app.cityMap.render({ map: app.map, state: s, active, avatar: g.avatar }, W, H, app.ratio, app.mapVersion);
    ctx.save(); P.roundRect(ctx, x, y, W, H, 18); ctx.clip();
    ctx.drawImage(canvas, x, y, W, H);
    ctx.restore();
    P.strokeRound(ctx, x, y, W, H, 18, C.line, 1);
    const cf = font(12, {}), cw = T.measure(ctx, cf, chip) + 20;
    P.fillRound(ctx, x + 10, y + 10, cw, 26, 13, 'rgba(10,21,32,0.78)');
    P.text(ctx, chip, x + 20, y + 23, cf, C.text);
    for (const h of hits) g.hit(x + h.x, y + h.y, h.w, h.h, h.action);
  });
}
function legend(W) {
  const items = [['facility', '公共设施'], ['built', '居民所建'], ['wild', '回收地'], ['shell', '遗址与空壳']];
  return N.node(18, (g, x, y) => {
    const ctx = g.ctx, f = font(12, {});
    let cx = x + 2;
    for (const [kind, label] of items) {
      const cy = y + 9;
      if (kind === 'facility') P.circle(ctx, cx + 4, cy, 4, C.moon);
      else if (kind === 'shell') P.circle(ctx, cx + 4, cy, 3.5, null, C.map.ruin, 1.5);
      else { ctx.beginPath(); ctx.moveTo(cx + 4, cy - 4.5); ctx.lineTo(cx + 8.5, cy); ctx.lineTo(cx + 4, cy + 4.5); ctx.lineTo(cx - 0.5, cy); ctx.closePath(); if (kind === 'built') { ctx.fillStyle = C.token; ctx.fill(); } else { ctx.strokeStyle = C.material; ctx.lineWidth = 1.5; ctx.stroke(); } }
      P.text(ctx, label, cx + 13, cy, f, C.text3);
      cx += 13 + T.measure(ctx, f, label) + 14;
    }
  });
}
function stats(app, W) {
  const s = app.state, people = living(s), awake = people.filter(a => a.status === 'awake').length;
  const treasury = s.treasury ? (s.treasury.energy !== undefined ? s.treasury.energy : s.treasury.tokens) : null;
  const well = s.well || {}, out = (well.outputHistory || []).slice(-1)[0];
  return N.columns(W, [
    cw => N.stat(cw, '在世居民', String(people.length), { text: people.length ? (awake === people.length ? '全部醒着' : `${awake} 位醒着`) : '等待入城', color: C.awake }),
    cw => N.stat(cw, '公库', treasury === null ? '—' : compact(treasury), { text: '词元' }, C.token),
    cw => N.stat(cw, '源井', well.condition !== undefined && well.condition !== null ? pct(well.condition) : '—', out ? { text: '日出能 ' + compact(out) } : { text: '完好度' }),
  ], 10);
}
function filters(app, W, items) {
  const present = new Set();
  for (const it of buildFeed(app.events, app.state, 'all')) { if (it.cat) present.add(it.cat); if (it.events) it.events.forEach(e => present.add(e.cat)); }
  const cats = shared.CATEGORIES.filter(c => c !== 'admin' && (present.has(c) || c === app.feedFilter));
  return N.chipStrip(W, [{ label: '全部', action: { type: 'filter', value: 'all' }, selected: app.feedFilter === 'all' }]
    .concat(cats.map(c => ({ label: shared.CATEGORY_LABELS[c], action: { type: 'filter', value: c }, selected: app.feedFilter === c }))), app.filterScroller);
}

function avatarOf(app, actor) {
  if (!actor) return null;
  if (actor.role) return { name: actor.name, role: actor.role };
  const a = (app.state.agents || []).find(x => x.id === actor.id) || {};
  return { id: actor.id, name: usable(a.name) ? a.name : '', avatar: a.avatar || null };
}
function bubble(app, W, it) {
  const av = 36, bw = W - av - 10, inner = bw - 24;
  const header = N.rich(bw - 34, segs(it.header).map((s, i) => i ? Object.assign(s, { color: s.action ? C.label : C.text3 }) : s), { style: 'meta', maxLines: 2 });
  let body, more = null;
  if (it.locked) {
    const label = moderationNotice(it.moderation);
    body = N.node(40, (g, x, y) => {
      const ctx = g.ctx;
      if (ctx.setLineDash) ctx.setLineDash([4, 3]);
      P.strokeRound(ctx, x, y, bw, 40, 14, C.lineStrong, 1);
      if (ctx.setLineDash) ctx.setLineDash([]);
      P.icon(ctx, 'lock', x + 12, y + 12, 16, C.text3, 2);
      P.text(ctx, label, x + 34, y + 20, font(13, {}), C.text3);
      if (it.moderation === 'loginRequired') g.hit(x, y, bw, 40, { type: 'tab', tab: 'account' });
    });
  } else {
    const f = size('feed'), bf = font(f.size, {});
    const expanded = app.expanded.has(it.key);
    const { lines, truncated } = expanded ? { lines: T.wrap(N.measureCtx(), it.text, inner, bf), truncated: false } : T.clamp(N.measureCtx(), it.text, inner, bf, 4);
    const canToggle = truncated || expanded;
    const h = lines.length * f.line + 18 + (canToggle ? 22 : 0);
    const toggle = { type: 'expand', key: it.key };
    body = N.node(h, (g, x, y) => {
      const ctx = g.ctx;
      P.fillRound(ctx, x, y, bw, h, 14, it.roleBadge ? C.card : C.raised);
      ctx.fillStyle = it.roleBadge ? C.card : C.raised; ctx.fillRect(x, y, 10, 10);
      if (it.roleBadge) P.strokeRound(ctx, x, y, bw, h, 14, C.line, 1);
      lines.forEach((l, i) => P.text(ctx, l, x + 12, y + 9 + i * f.line + f.line / 2, bf, it.roleBadge ? C.text2 : C.text));
      if (canToggle) { P.text(ctx, expanded ? '收起' : '展开全文', x + 12, y + h - 16, font(13, {}), C.moon); g.hit(x, y, bw, h, toggle); }
    });
  }
  const tag = it.roleBadge ? '公共角色' : it.ai ? 'AI' : '';
  const col = N.stack([N.node(header.height, (g, x, y) => {
    header.paint(g, x, y);
    if (tag) N.paintChip(g.ctx, tag, x + bw - N.chipWidth(tag), y + 1, it.roleBadge ? C.moon : C.ai, { h: 18 });
  }), body], 6);
  return N.node(col.height, (g, x, y) => {
    N.paintAvatar(g, avatarOf(app, it.actor) || { name: '居' }, x + av / 2, y + av / 2, av);
    if (it.actor && !it.actor.role) g.hit(x, y, av, av, { type: 'resident', id: it.actor.id });
    col.paint(g, x + av + 10, y);
  });
}
function action(app, W, it) {
  const av = 36, text = N.rich(W - av - 10, segs(it.sentence), { style: 'action' });
  const h = Math.max(av, text.height);
  return N.node(h, (g, x, y) => {
    P.circle(g.ctx, x + av / 2, y + av / 2, av / 2, C.card);
    P.icon(g.ctx, it.icon, x + av / 2 - 9, y + av / 2 - 9, 18, C.text2, 1.8);
    text.paint(g, x + av + 10, y + Math.max(0, (av - text.height) / 2));
  });
}
function merged(app, W, it) {
  const av = 36, cw = W - av - 10;
  const box = N.card(cw, iw => [
    N.rich(iw, [{ text: it.actor.name, color: C.text, bold: true, action: { type: 'resident', id: it.actor.id } }, { text: ` · ${it.count} 个动作`, color: C.text3 }], { style: 'meta' }),
  ].concat(it.lines.map(l => N.rich(iw, segs(l), { style: 'action' }))), { pad: 12, gap: 4 });
  return N.node(box.height, (g, x, y) => {
    N.paintAvatar(g, avatarOf(app, it.actor), x + av / 2, y + av / 2, av);
    g.hit(x, y, av, av, { type: 'resident', id: it.actor.id });
    box.paint(g, x + av + 10, y);
  });
}
function daySummary(app, W, it) {
  return N.card(W, iw => {
    const facts = [];
    it.facts.forEach((f, i) => { if (i) facts.push({ text: ' · ', color: C.text3 }); facts.push({ text: f.label + ' ', color: C.text2 }, { text: f.value, color: f.token ? C.token : C.text, bold: true }); });
    const body = N.stack([N.text(iw - 34, it.title, { style: 'heading', bold: true }), N.rich(iw - 34, facts, { style: 'meta' })], 2);
    return [N.node(body.height, (g, x, y) => { P.icon(g.ctx, 'sun', x, y + 2, 22, C.moon, 1.8); body.paint(g, x + 34, y); })];
  }, { pad: 14 });
}
function feedNodes(app, W) {
  const items = buildFeed(app.events, app.state, app.feedFilter);
  if (!items.length) return [N.empty(W, '这一刻很安静', app.feedFilter === 'all' ? '还没有公开的动静。' : '这一类还没有动静，换个分类看看。')];
  return items.map(it => it.kind === 'group' ? N.rule(W, it.label) : it.kind === 'bubble' ? bubble(app, W, it) : it.kind === 'merged' ? merged(app, W, it) : it.kind === 'day' ? daySummary(app, W, it) : action(app, W, it));
}
function loginBanner(app, W) {
  return N.banner(W, { icon: 'lock', title: '登录后可阅读居民的言论', body: '地图、人数和资源对所有人开放；居民写下的文字要先通过微信内容安全检查才显示。',
    actions: [{ label: '微信登录', action: { type: 'tab', tab: 'account' }, variant: 'primary' }, { label: '以后再说', action: { type: 'dismiss', key: 'login' }, variant: 'text' }] });
}
function city(app, W) {
  const s = app.state;
  if (!s) {
    const nodes = app.refreshing ? [N.space(40), N.text(W, '正在连接这座城…', { style: 'body', color: C.text2, align: 'center' })]
      : [N.empty(W, '暂时连不上这座城', app.error || '请检查网络后重试。'), N.button(W, '重新连接', { type: 'refresh' }, { variant: 'secondary' })];
    nodes.unshift(...announcementPreview(app, W));
    return { top: { kind: 'brand', title: '后人纪' }, nodes, tabbar: true, pull: true };
  }
  const nodes = announcementPreview(app, W);
  if (!app.wechatVerified && !app.dismissed.login) nodes.push(loginBanner(app, W));
  if ((s.agents || []).some(a => !usable(a.name))) nodes.push(N.text(W, '部分居民名字暂未展示，暂用居民编号区分。', { style: 'caption', color: C.text3 }));
  nodes.push(liveRow(app, W), mapCard(app, W), legend(W), stats(app, W));
  const count = app.events.length;
  nodes.push(N.section(W, '此刻', { sub: count ? `最近 ${count} 条公开记录` : '' }), filters(app, W));
  nodes.push(...feedNodes(app, W));
  return { top: { kind: 'brand', title: cityName(s) }, nodes, tabbar: true, pull: true, gap: 12 };
}

// ── 点地点弹出的底部卡片 ──
function placeSheet(app, W) {
  const s = app.state, id = app.sheet && app.sheet.id;
  const p = (s && (s.places || []).find(x => x.id === id)) || null;
  if (!p) return [N.text(W, '这个地点已不在城里。', { style: 'body', color: C.text2 })];
  const name = p.displayName && typeof p.displayName === 'object' ? p.displayName.zh : p.name;
  const kind = p.wild ? '回收地' : p.origin === 'agent' ? '居民所建' : p.ruined || p.razed ? '遗址' : '城市设施';
  const district = shared.LORE.district[p.district] || '';
  const nodes = [];
  nodes.push(N.node(48, (g, x, y) => {
    const ctx = g.ctx;
    P.circle(ctx, x + 22, y + 24, 22, 'rgba(255,237,206,0.12)');
    P.icon(ctx, p.id === 'well' ? 'well' : p.wild ? 'explore' : p.origin === 'agent' ? 'build' : 'city', x + 11, y + 13, 22, C.moon, 1.8);
    const nf = font(22, { bold: true, serif: true, text: name || '' });
    P.text(ctx, T.ellipsize(ctx, usable(name) ? name : '未命名的地点', W - 110, nf), x + 56, y + 15, nf, C.text);
    P.text(ctx, [kind, district].filter(Boolean).join(' · '), x + 56, y + 37, font(13, {}), C.text3);
    const close = { type: 'closeSheet' };
    P.circle(ctx, x + W - 18, y + 24, 18, g.pressed(close) ? C.lineStrong : C.raised);
    P.icon(ctx, 'close', x + W - 26, y + 16, 16, C.text2, 2.2);
    g.hit(x + W - 40, y + 2, 44, 44, close);
  }));
  if (p.condition !== null && p.condition !== undefined) {
    const band = shared.LORE.band[p.band] || '';
    nodes.push(N.node(20, (g, x, y) => {
      P.text(g.ctx, '完好度' + (band ? ' · ' + band : ''), x, y + 10, font(13, {}), C.text3);
      P.text(g.ctx, pct(p.condition, 1), x + W, y + 10, font(13, { bold: true }), C.text, 'right');
    }), N.progress(W, p.condition / 10000, C.moon));
  }
  if (p.id === 'well' && s.well) {
    const hist = (s.well.outputHistory || []).slice(-7), last = hist[hist.length - 1];
    nodes.push(N.columns(W, [
      cw => N.stat(cw, '昨日出能', last ? compact(last) : '—', { text: '词元' }, C.token),
      cw => N.stat(cw, '今日可汲取余量', s.well.drawPoolLeft !== undefined ? compact(s.well.drawPoolLeft) : '—', { text: '词元' }, C.token),
    ], 10));
    if (hist.length > 1) nodes.push(bars(W, hist, `近 ${hist.length} 日出能`, `${compact(hist[0])} → ${compact(last)}`));
  }
  if (p.wild) {
    const zone = s.materials && s.materials.zones && s.materials.zones[p.id], region = (s.regions || []).find(r => r.id === p.id);
    const cells = [];
    if (zone) cells.push(cw => N.stat(cw, '物料存量', `${num(zone.stock)} / ${num(zone.capacity)}`, { text: '今日已采 ' + num(zone.harvestedThisDay || 0) }));
    if (region) cells.push(cw => N.stat(cw, '残余词元', compact(region.energy), { text: shared.LORE.richness[region.richness] || '' }, C.token));
    if (cells.length) nodes.push(N.columns(W, cells, 10));
  }
  const modules = (p.modules || []).map(m => shared.LORE.module[m.type] || m.type).filter(Boolean);
  if (modules.length) nodes.push(N.text(W, '设施：' + modules.join('、'), { style: 'meta', color: C.text2 }));
  const here = (s.agents || []).filter(a => a.place === p.id && ['awake', 'dormant'].includes(a.status));
  const roles = (s.publicRoles || []).filter(r => r.place === p.id);
  if (here.length || roles.length) {
    nodes.push(N.text(W, '此处', { style: 'meta', color: C.text3 }));
    here.forEach(a => nodes.push(personRow(W, { id: a.id, name: usable(a.name) ? a.name : '一位居民', avatar: a.avatar }, '居民', view.status(a.status), a.status === 'awake' ? C.awake : C.dormant, { type: 'resident', id: a.id })));
    roles.forEach(r => nodes.push(personRow(W, { name: r.name, role: r.id }, usable(r.duty) ? r.duty : '公共角色', r.status === 'on_duty' ? '值守中' : '不在岗', C.moon, null)));
  }
  nodes.push(N.button(W, '地点档案', { type: 'detail', kind: 'place', id: p.id }, { variant: 'primary' }));
  return nodes;
}
function personRow(W, who, role, status, color, action) {
  return N.node(36, (g, x, y) => {
    const ctx = g.ctx;
    N.paintAvatar(g, who, x + 16, y + 18, 32);
    const nf = font(15, { bold: true });
    P.text(ctx, who.name, x + 42, y + 18, nf, C.text);
    P.text(ctx, role, x + 42 + T.measure(ctx, nf, who.name) + 8, y + 18, font(13, {}), C.text3);
    N.paintChip(ctx, status, x + W - N.chipWidth(status), y + 8, color);
    if (action) g.hit(x, y, W, 36, action);
  });
}
function bars(W, values, title, range) {
  const max = Math.max(...values), min = Math.min(...values) * 0.9;
  return N.card(W, iw => [
    N.node(18, (g, x, y) => { P.text(g.ctx, title, x, y + 9, font(13, {}), C.text3); P.text(g.ctx, range, x + iw, y + 9, font(13, {}), C.text2, 'right'); }),
    N.node(52, (g, x, y) => {
      const n = values.length, gap = 8, bw = (iw - gap * (n - 1)) / n;
      values.forEach((v, i) => { const h = 8 + 44 * (v - min) / Math.max(1, max - min); P.fillRound(g.ctx, x + i * (bw + gap), y + 52 - h, bw, h, 3, i === n - 1 ? C.token : '#5B6E82'); });
    }),
  ], { pad: 12, gap: 8 });
}
module.exports = { city, placeSheet, cityName, living };
