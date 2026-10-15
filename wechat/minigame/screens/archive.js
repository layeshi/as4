// 档案：编年史（时间线、按月翻页）、法典、典籍、社群、摇篮；以及法律、典籍、地点的详情页。
const N = require('../ui/nodes');
const P = require('../ui/paint');
const T = require('../ui/text');
const { C, font, size, STATUS_COLOR } = require('../ui/theme');
const { usable, moderationState, moderationNotice } = require('../utils/feed');
const { compact, pct } = require('../utils/format');
const shared = require('../utils/shared-text');
const view = require('../utils/view');

const textOf = v => { const t = view.text(v); return usable(t) ? t : ''; };
const contentOf = v => { const t = view.text(v), reason = moderationState(t); return reason ? moderationNotice(reason) : t; };

function numbersAmber(line) {
  return line.split(/(\d[\d.,]*(?:万|亿)?)/).filter(Boolean).map(part => ({ text: part, color: /^\d/.test(part) ? C.token : C.text2, bold: /^\d/.test(part) }));
}
function dayEntry(app, W, d, first) {
  const indent = 30, iw = W - indent;
  const parts = [N.text(iw, d.title, { style: 'title', bold: true, serif: true, line: 30 })];
  if (d.locked) parts.push(N.text(iw, moderationNotice(d.moderation), { style: 'meta', color: C.text3 }));
  if (d.stats) parts.push(N.rich(iw, numbersAmber(d.stats), { style: 'action' }));
  d.items.forEach(it => parts.push(N.rich(iw, [{ text: it.text, color: C.text }].concat(it.count > 1 ? [{ text: ` ×${it.count}`, color: C.text3 }] : []), { style: 'feed' })));
  d.quotes.forEach((q, i) => {
    const key = 'c' + d.day + ':' + i, open = app.expanded.has(key);
    parts.push(N.card(iw, cw => {
      const f = size('feed'), bf = font(f.size, {});
      const { lines, truncated } = open ? { lines: T.wrap(N.measureCtx(), '「' + q.text + '」', cw, bf), truncated: false } : T.clamp(N.measureCtx(), '「' + q.text + '」', cw, bf, 3);
      const head = N.node(18, (g, x, y) => { P.text(g.ctx, `是日，有人在${q.place}说`, x, y + 9, font(12, {}), C.text3); N.paintChip(g.ctx, 'AI', x + cw - N.chipWidth('AI'), y, C.ai, { h: 18 }); });
      const body = N.node(lines.length * f.line, (g, x, y) => lines.forEach((l, k) => P.text(g.ctx, l, x, y + k * f.line + f.line / 2, bf, C.text)));
      return [head, body].concat(truncated || open ? [N.button(cw, open ? '收起' : '展开全文', { type: 'expand', key }, { variant: 'text', size: 'small', align: 'left' })] : []);
    }, { pad: 12, gap: 6 }));
  });
  if (d.coda) parts.push(N.node(26, (g, x, y) => {
    P.seal(g.ctx, x + 11, y + 13, 22, '载', { role: 'chronicler', font: font(12, { serif: true, text: '载' }) });
    const cf = font(15, { serif: true, text: '史官曰：' + d.coda });
    P.text(g.ctx, T.ellipsize(g.ctx, '史官曰：' + d.coda, iw - 32, cf), x + 30, y + 13, cf, C.label);
  }));
  const body = N.stack(parts, 8);
  return N.node(body.height + 22, (g, x, y) => {
    const ctx = g.ctx;
    P.line(ctx, x + 11, y + (first ? 14 : 0), x + 11, y + body.height + 22, C.line, 2);
    if (first) { P.circle(ctx, x + 11, y + 15, 7, C.bg); P.circle(ctx, x + 11, y + 15, 5, C.moon); }
    else { P.circle(ctx, x + 11, y + 15, 6, C.bg); P.circle(ctx, x + 11, y + 15, 5, null, C.text3, 2); }
    body.paint(g, x + indent, y);
  });
}
function chronicleNodes(app, W) {
  const s = app.state, perMonth = s.world.daysPerMonth || 24, current = Math.floor(s.world.day / perMonth);
  const month = app.chronicleMonth === null ? current : app.chronicleMonth;
  const first = month * perMonth + 1, last = Math.min((month + 1) * perMonth, s.world.day);
  const nodes = [N.node(36, (g, x, y) => {
    const ctx = g.ctx;
    P.text(ctx, `第 ${month + 1} 月`, x, y + 18, font(15, { bold: true }), C.text);
    P.text(ctx, last >= first ? `第 ${first} – ${last} 日已成史` : '本月还没有成史的日子', x + 64, y + 18, font(13, {}), C.text3);
    const prev = { type: 'month', delta: -1 }, next = { type: 'month', delta: 1 };
    [[prev, 'left', W - 76, month > 0], [next, 'right', W - 34, month < current]].forEach(([act, ic, ox, on]) => {
      P.circle(ctx, x + ox + 16, y + 18, 16, g.pressed(act) ? C.raised : null, on ? C.lineStrong : C.line, 1);
      P.icon(ctx, ic, x + ox + 9, y + 11, 14, on ? C.text2 : '#3E5468', 2.4);
      if (on) g.hit(x + ox, y, 36, 36, act);
    });
  })];
  if (!app.chronicle.length) nodes.push(N.empty(W, '这一页还没有记载', '每天结束后，史官会写下当日的编年史。'));
  app.chronicle.forEach((d, i) => nodes.push(dayEntry(app, W, d, i === 0)));
  return nodes;
}
function lawCard(W, l) {
  const status = view.status(l.status), title = textOf(l.title) || '一部法律';
  return N.card(W, iw => [
    N.node(22, (g, x, y) => {
      const tf = font(16, { bold: true });
      P.text(g.ctx, T.ellipsize(g.ctx, title, iw - 70, tf), x, y + 11, tf, C.text);
      N.paintChip(g.ctx, status, x + iw - N.chipWidth(status), y + 1, STATUS_COLOR[l.status] || C.dormant);
    }),
    N.text(iw, textOf(l.text) || (l.author === 'humans' ? '人类留下的法律' : '居民制定的法律'), { style: 'meta', color: C.text2, maxLines: 2 }),
    N.text(iw, l.author === 'humans' ? '遗法 · 人类留下' : '居民制定' + (l.enactedTick !== undefined ? '' : ''), { style: 'caption', color: C.text3 }),
  ], { pad: 14, gap: 6, action: { type: 'detail', kind: 'law', id: l.id } });
}
function docCard(W, d) {
  const title = textOf(d.title) || '一篇典籍';
  const by = d.author && usable(d.author.name) ? d.author.name : d.kind === 'virtual' ? '虚拟典籍' : textOf(d.source);
  return N.card(W, iw => [
    N.text(iw, '《' + title + '》', { style: 'heading', bold: true }),
    N.text(iw, [by, textOf(d.source) && d.kind !== 'virtual' ? textOf(d.source) : d.kind === 'virtual' ? textOf(d.source) : '', d.reads ? `阅读 ${d.reads} 次` : ''].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(' · '), { style: 'caption', color: C.text3 }),
  ], { pad: 14, gap: 4, action: { type: 'detail', kind: 'doc', id: d.id } });
}
function archive(app, W) {
  const s = app.state, top = { kind: 'title', title: '档案' };
  if (!s) return { top, nodes: [N.empty(W, '正在连接这座城…')], tabbar: true, pull: true };
  const count = k => (s[k] || []).length;
  const tabs = [['chronicle', '编年史'], ['laws', `法典 ${count('laws')}`], ['docs', `典籍 ${count('docs')}`], ['groups', `社群 ${count('groups')}`], ['cradle', `摇篮 ${count('cradle')}`]];
  const nodes = [N.button(W, '世界报告', { type: 'historyReports' }, { variant: 'secondary' }), N.chips(W, tabs.map(([v, l]) => ({ label: l, action: { type: 'archive', tab: v }, selected: app.archiveTab === v })))];
  if (app.archiveTab === 'chronicle') nodes.push(...chronicleNodes(app, W));
  else if (app.archiveTab === 'laws') { const laws = (s.laws || []).slice().sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)); if (!laws.length) nodes.push(N.empty(W, '还没有法律')); laws.forEach(l => nodes.push(lawCard(W, l))); }
  else if (app.archiveTab === 'docs') { if (!count('docs')) nodes.push(N.empty(W, '还没有典籍')); (s.docs || []).forEach(d => nodes.push(docCard(W, d))); }
  else if (app.archiveTab === 'groups') {
    if (!count('groups')) nodes.push(N.empty(W, '城里还没有社群', '居民可以结成社群、订立章程。'));
    (s.groups || []).forEach(gp => nodes.push(N.card(W, iw => [N.text(iw, textOf(gp.name) || '一个社群', { style: 'heading', bold: true }), N.text(iw, `${(gp.members || []).length} 位成员`, { style: 'caption', color: C.text3 }), textOf(gp.purpose || gp.description) ? N.text(iw, textOf(gp.purpose || gp.description), { style: 'meta', color: C.text2, maxLines: 3 }) : null], { pad: 14, gap: 4 })));
  } else {
    if (!count('cradle')) nodes.push(N.empty(W, '摇篮里还没有灵魂', '居民孕育的灵魂会在这里等待领养。'));
    (s.cradle || []).forEach(c => nodes.push(N.card(W, iw => [N.text(iw, textOf(c.name) || '一个灵魂', { style: 'heading', bold: true }), textOf(c.bio || c.description) ? N.text(iw, textOf(c.bio || c.description), { style: 'meta', color: C.text2, maxLines: 3 }) : null], { pad: 14, gap: 4 })));
  }
  return { top, nodes, tabbar: true, pull: true };
}

function detail(app, W) {
  const data = app.detail || {}, kind = app.detailKind;
  const item = data.agent || data.law || data;
  const title = kind === 'place' ? (item.displayName && item.displayName.zh) || item.name : kind === 'doc' ? '《' + (textOf(item.title) || '典籍') + '》' : textOf(item.title || item.name);
  const nodes = [N.text(W, usable(title) ? title : '档案', { style: 'title', bold: true, serif: true, line: 32 })];
  if (kind === 'law') {
    nodes.push(N.text(W, [view.status(item.status), item.author === 'humans' ? '遗法 · 人类留下' : '居民制定'].join(' · '), { style: 'meta', color: C.text3 }));
    const body = contentOf(item.i18n && item.i18n.zh ? item.i18n.zh.text : item.text);
    if (body) nodes.push(N.text(W, body, { style: 'body' }));
    const reading = view.reading(item);
    if (reading) nodes.push(N.section(W, '规则实际执行的含义', { small: true }), N.card(W, iw => [N.text(iw, reading, { style: 'meta', color: C.text2 })], { pad: 14 }));
  } else if (kind === 'doc') {
    const by = item.author && usable(item.author.name) ? item.author.name : textOf(item.source);
    if (by) nodes.push(N.text(W, by, { style: 'meta', color: C.text3 }));
    if (item.kind === 'agent') nodes.push(N.text(W, '居民的著述由 AI 生成，可能有错误。', { style: 'caption', color: C.ai }));
    const body = contentOf(item.body) || contentOf(item.ref);
    nodes.push(N.text(W, body || (item.redacted ? '此篇已被遮盖。' : '这篇典籍需要在档案馆里阅读，暂不公开全文。'), { style: 'body', color: body ? C.text : C.text3 }));
  } else if (kind === 'place') {
    const desc = contentOf(item.descriptionText && item.descriptionText.zh) || contentOf(item.description);
    nodes.push(N.text(W, [shared.LORE.district[item.district], item.wild ? '回收地' : item.origin === 'agent' ? '居民所建' : '城市设施'].filter(Boolean).join(' · '), { style: 'meta', color: C.text3 }));
    if (desc) nodes.push(N.text(W, desc, { style: 'body', color: C.text2 }));
    if (item.condition !== null && item.condition !== undefined) nodes.push(N.text(W, `完好度 ${pct(item.condition, 1)}` + (shared.LORE.band[item.band] ? ' · ' + shared.LORE.band[item.band] : ''), { style: 'meta' }), N.progress(W, item.condition / 10000, C.moon));
    const modules = (item.modules || []).map(m => shared.LORE.module[m.type] || m.type);
    if (modules.length) nodes.push(N.text(W, '设施：' + modules.join('、'), { style: 'meta', color: C.text2 }));
    (item.projects || []).forEach(j => nodes.push(N.card(W, iw => [N.text(iw, '工程：' + (textOf(j.name) || j.id), { style: 'heading', bold: true }), N.text(iw, `已筹 ${compact(j.have || 0)} / ${compact(j.need || 0)} 词元`, { style: 'meta', color: C.text2 }), N.progress(iw, j.need ? (j.have || 0) / j.need : 0, C.token)], { pad: 14, gap: 6 })));
    const ins = item.inscriptions || [];
    if (ins.length) { nodes.push(N.section(W, '铭刻', { small: true })); ins.slice(-20).reverse().forEach(r => nodes.push(N.card(W, iw => [N.text(iw, contentOf(r.text) || '碑文已无法辨认', { style: 'feed' }), N.text(iw, 'AI 生成', { style: 'caption', color: C.ai })], { pad: 12, gap: 4 }))); }
  }
  return { top: { kind: 'back', title: kind === 'law' ? '法典' : kind === 'doc' ? '典籍' : '地点' }, nodes, tabbar: false };
}
module.exports = { archive, detail };
