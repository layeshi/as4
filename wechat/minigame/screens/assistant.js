// 实验助手：列表、对话与依据共用一个页签，提问区固定在底部。
const N = require('../ui/nodes');
const P = require('../ui/paint');
const T = require('../ui/text');
const { C, size, font, RADIUS } = require('../ui/theme');
const { answer, pre } = require('../ui/answer');
const { usable, moderationState, moderationNotice } = require('../utils/feed');
const label = (value, fallback = '文字暂未展示') => usable(value) ? value : fallback;
const reason = meta => Object.keys(meta || {}).find(key => meta[key]);
const modeNames = { public: '公开记录', resident: '我的居民私人记录', research: '管理员私人研究' };
const pad = n => String(n).padStart(2, '0');
function when(iso, full = false) {
  const d = new Date(iso); if (!Number.isFinite(d.getTime())) return '—';
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === new Date().toDateString()) return time;
  const date = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return full ? `${date} ${time}` : date;
}
const cities = s => (s.world?.cities || []).map(c => typeof c === 'string' ? { id: c, name: c } : { id: c.id, name: label(typeof c.name === 'string' ? c.name : c.name?.zh || c.id) });
function summaryText(app) {
  const a = app.assistant, parts = [], b = a.scope.branchId ? a.branch() : null;
  if (b && !b.active) parts.push('历史分支 ' + b.id.slice(0, 8));
  const city = cities(a.status || {}).find(c => c.id === a.scope.city); if (city) parts.push(city.name);
  const from = String(app.form.assistantFrom || '').trim(), to = String(app.form.assistantTo || '').trim();
  if (from && to) parts.push(from === to ? `第 ${from} 日` : `第 ${from}–${to} 日`);
  else if (from) parts.push(`第 ${from} 日起`);
  else if (to) parts.push(`至第 ${to} 日`);
  return a.scope.mode === 'public' && !parts.length ? '范围：全部公开记录' : [modeNames[a.scope.mode], ...parts].join(' · ');
}
function metaText(o) {
  return [o.worldId && `世界 ${o.worldId}`, o.epoch != null && `第 ${o.epoch} 纪`, o.branchId && `分支 ${o.branchId.slice(0, 8)}`, Number.isFinite(o.day) && `第 ${o.day + 1} 日`, o.observedAt && `截至 ${when(o.observedAt, true)}`].filter(Boolean).join(' · ');
}
function composer(app, W) {
  const a = app.assistant, s = a.status || {}, q = s.quota, exhausted = q && q.remaining <= 0, closed = !s.available || exhausted;
  const generating = a.conversation?.messages?.some(m => m.status === 'generating');
  const nodes = [], tags = [];
  if (a.error) nodes.push(N.text(W, a.error, { style: 'caption', color: C.danger, maxLines: 1 }));
  if (a.scope.agentId) tags.push({ text: '居民 ' + label(a.residentName(a.scope.agentId), '居民'), key: 'agentId' });
  if (a.scope.lawId) tags.push({ text: '法律 ' + a.scope.lawId, key: 'lawId' });
  const sf = font(size('action').size), summary = summaryText(app);
  N.record('scope', summary);
  const tagWidths = tags.map(t => Math.min(W * 0.30, T.measure(N.measureCtx(), sf, t.text) + 40));
  const tw = tagWidths.reduce((n, w) => n + w + 4, 0), sw = W - tw;
  nodes.push(N.node(44, (g, x, y) => {
    P.text(g.ctx, T.ellipsize(g.ctx, summary, sw - 24, sf), x, y + 22, sf, C.text2);
    P.text(g.ctx, '▾', x + sw - 18, y + 22, sf, C.text2);
    g.hit(x, y, sw, 44, { type: 'sheet', kind: 'assistantScope' });
    let tx = x + sw;
    tags.forEach((t, i) => {
      const w = tagWidths[i];
      P.fillRound(g.ctx, tx, y + 6, w, 32, RADIUS.chip, C.raised);
      P.text(g.ctx, T.ellipsize(g.ctx, t.text, w - 36, sf), tx + 8, y + 22, sf, C.label);
      P.text(g.ctx, '×', tx + w - 14, y + 22, sf, C.moon);
      g.hit(tx, y, w, 44, { type: 'assistantScope', key: t.key, value: '' }); tx += w + 4;
    });
  }));
  const iw = W - 82, value = app.form.assistantText || '';
  const input = N.text(iw - 28, value || '例如：三城公库最近为什么差这么多？', { style: 'body', maxLines: 3, color: value ? C.text : C.text3 });
  const ih = Math.max(46, input.height + 20), enabled = generating || !(closed || a.active || a.loading || a.sending || app.busy || !value.trim());
  const button = N.button(72, generating ? '停止' : '提问', enabled ? { type: generating ? 'assistantCancel' : 'assistantAsk' } : null, { variant: generating ? 'secondary' : 'primary' });
  nodes.push(N.node(ih, (g, x, y) => {
    g.ctx.save(); if (closed) g.ctx.globalAlpha = 0.5;
    P.fillRound(g.ctx, x, y, iw, ih, RADIUS.button, C.raised); input.paint(g, x + 14, y + 10); g.ctx.restore();
    if (!closed) g.hit(x, y, iw, ih, { type: 'field', name: 'assistantText', multiple: true, max: 4000 });
    g.ctx.save(); if (!enabled) g.ctx.globalAlpha = 0.5; button.paint(g, x + iw + 10, y + ih - 46); g.ctx.restore();
  }));
  // 计次说明单独一行，窄屏折行时不会只剩一个字。
  const quota = !s.available ? '助手暂不可用' : exhausted ? '今日次数已用完 · 北京时间零点恢复' : q ? `今日剩余 ${q.remaining} / ${q.limit} 次 · 北京时间零点恢复\n失败、停止和重试也计次` : '';
  if (quota) nodes.push(N.text(W, quota, { style: 'caption', color: closed ? C.text2 : C.text3 }));
  const body = N.stack(nodes, 8);
  return N.node(body.height, (g, x, y) => { P.line(g.ctx, x - 16, y - 8, x + W + 16, y - 8, C.line, 1); body.paint(g, x, y); });
}
function question(W, m) {
  const state = reason(m.moderation) || moderationState(m.text), readable = m.status === 'complete' && !state && usable(m.text);
  const text = readable ? m.text : m.status === 'pending' || state === 'pending' ? '内容审核中' : '问题未展示';
  const f = font(size('body').size), bw = Math.min(W * 0.8, Math.max(80, ...text.split('\n').map(line => T.measure(N.measureCtx(), f, line) + 28)));
  const bubble = N.card(bw, iw => [N.text(iw, text, { style: 'body', color: readable ? C.text : C.text3 })], { pad: 14, padY: 12, fill: C.raised, border: false });
  return N.node(bubble.height, (g, x, y) => bubble.paint(g, x + W - bw, y));
}
function aiLabel() {
  N.record('label', 'AI 生成');
  return N.node(24, (g, x, y) => N.paintChip(g.ctx, 'AI 生成', x, y + 2, C.ai));
}
// 提示里的动作靠左排，文字与提示正文对齐。
function actionRow(actions) {
  const f = font(15), built = actions.map(a => {
    const w = Math.ceil(T.measure(N.measureCtx(), f, a.label)) + 24;
    return { w, button: N.button(w, a.label, a.action, { variant: 'text' }) };
  });
  return N.node(46, (g, x, y) => { let cx = x - 12; for (const it of built) { it.button.paint(g, cx, y); cx += it.w + 4; } });
}
function notice(W, text, color, actions) {
  const card = N.card(W, iw => [N.text(iw, text, { style: 'meta', color: C.text2 }), actions?.length ? actionRow(actions) : null]);
  return N.node(card.height, (g, x, y) => { card.paint(g, x, y); g.ctx.fillStyle = color; g.ctx.fillRect(x, y + 12, 3, card.height - 24); });
}
function response(W, m) {
  const state = reason(m.moderation) || moderationState(m.text), retry = { label: '重试（计 1 次）', action: { type: 'assistantRetry', id: m.id } };
  if (m.status === 'generating') return N.card(W, iw => [aiLabel(), N.text(iw, '正在生成…', { color: C.text3 })]);
  if (state === 'loginRequired') return notice(W, '微信登录后可阅读', C.moon, [{ label: '前往登录', action: { type: 'tab', tab: 'account' } }]);
  if (m.status === 'pending' || state === 'pending') return N.text(W, '内容审核中', { style: 'meta', color: C.text3 });
  if (m.status === 'withheld' || state) return notice(W, '内容未展示：权限已变化或审核未通过', C.dormant, [{ label: '刷新', action: { type: 'assistantRefresh' } }, retry]);
  if (m.status === 'failed') return notice(W, ['生成失败', typeof m.error === 'string' ? m.error : m.error?.message].filter(Boolean).join(' · '), C.danger, [retry]);
  if (m.status === 'cancelled') return notice(W, '已停止 · 回答不完整', C.text3, [retry]);
  if (m.status !== 'complete') return N.text(W, '内容未展示：权限已变化或审核未通过', { style: 'meta', color: C.text3 });
  return N.card(W, iw => {
    const sources = m.sources || [], foot = [];
    if (sources.length) {
      foot.push({ text: '依据 ' });
      sources.forEach((s, i) => {
        // 记录已通过检查的依据名称，画面只显示标号。
        N.record('source', label(s.title, '依据'), { id: s.id });
        foot.push({ text: (i ? ' ' : '') + (s.label || '依据'), color: C.moon, action: { type: 'assistantSource', id: s.id } });
      });
    }
    const o = m.observation, meta = [Number.isFinite(o?.day) && `第 ${o.day + 1} 日`, o?.observedAt && `截至 ${when(o.observedAt, true)}`].filter(Boolean).join(' · ');
    if (meta) foot.push({ text: (foot.length ? ' · ' : '') + meta });
    return [aiLabel(), answer(iw, m.text || '', sources), foot.length ? N.rich(iw, foot, { style: 'caption', color: C.text3, hitHeight: 44 }) : null];
  }, { gap: 12 });
}
function assistant(app, W) {
  const a = app.assistant; a.sync(); a.normalizeScope();
  const s = a.status || {}, nodes = [], page = { top: { kind: 'back', title: '实验助手' }, nodes, tabbar: false, pull: true, gap: 16 };
  if (!app.user || s.signedIn === false) {
    nodes.push(N.empty(W, '登录后向实验提问'), N.button(W, '前往登录', { type: 'tab', tab: 'account' }, { variant: 'primary' })); return page;
  }
  if (a.sourceId) {
    const src = a.source, state = reason(a.sourceModeration) || moderationState(src?.text) || moderationState(src?.title);
    const sourceLabel = a.sourceLabel || src?.label;
    page.top = { kind: 'back', title: sourceLabel ? '依据 ' + sourceLabel : '依据', back: { type: 'assistantCloseSource' } };
    if (!src) { nodes.push(N.text(W, '正在读取…', { color: C.text3 })); return page; }
    nodes.push(N.text(W, state ? '依据' : label(src.title, '依据'), { style: 'heading', bold: true }));
    const meta = metaText(src); if (meta) nodes.push(N.text(W, meta, { style: 'caption', color: C.text3 }));
    const text = state ? moderationNotice(state) : src.text || '';
    nodes.push(N.card(W, iw => [!state && /^\s*[[{]/.test(text) ? pre(iw, text) : N.text(iw, text, { style: 'feed', color: state ? C.text3 : C.text })], { fill: C.raised, border: false }));
    return page;
  }
  page.footer = composer(app, W);
  if (!a.conversation) {
    nodes.push(N.space(24), N.text(W, a.loading ? '正在读取…' : '向实验提问', { style: 'heading', color: a.loading ? C.text3 : C.text2, align: 'center' }), N.space(12));
    if (s.conversations?.length) {
      nodes.push(N.section(W, '最近的对话', { small: true }));
      nodes.push(N.card(W, iw => (s.conversations || []).map((c, i) => {
        const title = N.text(iw - 60, label(c.title, '实验对话'), { style: 'action', maxLines: 1 });
        const time = when(c.updatedAt), tf = font(size('caption').size); N.record('text', time);
        return N.node(Math.max(48, title.height + 20), (g, x, y) => {
          title.paint(g, x, y + 12); P.text(g.ctx, time, x + iw, y + 12 + size('action').line / 2, tf, C.text3, 'right');
          if (i) P.line(g.ctx, x, y, x + iw, y, C.divider, 1);
          g.hit(x, y, iw, Math.max(48, title.height + 20), { type: 'assistantSession', id: c.id });
        });
      }), { gap: 0, padY: 0 }));
    }
    return page;
  }
  page.top = { kind: 'back', title: label(a.conversation.title, '新对话'), back: { type: 'assistantList' } };
  const w = s.world || {}, b = a.scope.branchId ? a.branch() : null, flags = [];
  if (w.ended) flags.push(['世界已结束', C.text3]); else if (w.paused) flags.push(['世界已暂停', C.dormant]);
  if (b && !b.active) flags.push(['历史分支', C.dormant]);
  const remove = N.button(52, '删除', { type: 'sheet', kind: 'assistantDelete' }, { variant: 'danger' });
  nodes.push(N.node(46, (g, x, y) => { let cx = x; for (const [text, color] of flags) cx += N.paintChip(g.ctx, text, cx, y + 13, color) + 8; remove.paint(g, x + W - 52, y); }));
  for (const m of a.conversation.messages || []) nodes.push(m.role === 'user' ? question(W, m) : response(W, m));
  return page;
}
// 筛选控件在助手卡片里留足 44px 点按高度，其他页面沿用原尺寸。
function touchRow(node) {
  const h = Math.max(44, node.height), inset = (h - node.height) / 2;
  return N.node(h, (g, x, y) => node.paint(Object.assign({}, g, {
    hit: (hx, hy, w, height, action) => g.hit(hx, hy - inset, w, height + inset * 2, action),
    horizontal: g.horizontal ? (hx, hy, w, height, sc) => g.horizontal(hx, hy - inset, w, height + inset * 2, sc) : null,
  }), x, y + inset));
}
function assistantSheet(app, W) {
  const a = app.assistant;
  if (app.sheet.kind === 'assistantDelete') return [N.text(W, '删除这段对话？', { style: 'heading', bold: true }), N.buttonRow(W, [{ label: '删除', variant: 'danger', action: { type: 'assistantDelete' } }, { label: '取消', action: { type: 'closeSheet' } }])];
  a.normalizeScope();
  const s = a.status || {}, b = a.branch(), nodes = [N.section(W, '问题范围', { small: true, link: { label: '恢复默认', action: { type: 'assistantResetScope' } } })];
  const choice = (key, value, text) => ({ label: text, selected: a.scope[key] === value, action: { type: 'assistantScope', key, value } });
  const strip = (key, title, choices) => N.stack([N.text(W, title, { style: 'caption', color: C.text3 }), touchRow(N.chipStrip(W, choices.map(([value, text]) => choice(key, value, text)), app.scroller('assistant-' + key)))], 4);
  nodes.push(touchRow(N.segmented(W, a.availableModes().map(mode => choice('mode', mode, { public: '公开记录', resident: '我的居民', research: '管理员研究' }[mode])))));
  if ((s.branches || []).some(x => !x.active) || a.scope.branchId) nodes.push(strip('branchId', '世界与分支', [['', '当前世界'], ...(s.branches || []).filter(x => !x.active || x.id === a.scope.branchId).map(x => [x.id, `${x.worldId} · 第 ${x.epoch} 纪 · ${x.id.slice(0, 8)}`])]));
  if (cities(s).length) nodes.push(strip('city', '城', [['', '三城'], ...cities(s).map(c => [c.id, c.name])]));
  if (!(a.scope.mode === 'resident' && !(b?.premise >= 6))) {
    const people = a.residents().filter(r => a.scope.mode !== 'resident' || r.managed).slice().sort((x, y) => String(x.name).localeCompare(String(y.name), 'zh')).map(r => [r.id, label(r.name, '居民')]);
    if (a.scope.agentId && !people.some(([id]) => id === a.scope.agentId)) people.unshift([a.scope.agentId, label(a.residentName(a.scope.agentId), '居民')]);
    nodes.push(strip('agentId', '居民', [['', '全部居民'], ...people]));
  }
  const df = font(size('action').size), measure = text => T.measure(N.measureCtx(), df, text);
  const left = measure('第') + 8, middle = measure('日 至 第') + 16, right = measure('日') + 8, dayW = (W - left - middle - right) / 2;
  const dayField = (name) => N.field(dayW, '', app.form[name] || '', { type: 'field', name, max: 9 }, { placeholder: '全部' });
  const from = dayField('assistantFrom'), to = dayField('assistantTo');
  nodes.push(N.stack([N.text(W, '世界日', { style: 'caption', color: C.text3 }), N.node(46, (g, x, y) => {
    P.text(g.ctx, '第', x, y + 23, df, C.text2); from.paint(g, x + left, y - 22);
    P.text(g.ctx, '日 至 第', x + left + dayW + 8, y + 23, df, C.text2); to.paint(g, x + left + dayW + middle, y - 22);
    P.text(g.ctx, '日', x + W - right + 8, y + 23, df, C.text2);
  })], 4));
  const key = (name, text) => N.field(W, text, app.form[name] || '', { type: 'field', name, max: 256, secret: true }, { secret: true });
  if (a.scope.mode === 'resident' && !(b?.premise >= 6)) nodes.push(key('assistantOwnerKey', '造者密钥'));
  if (a.scope.mode === 'research') nodes.push(key('assistantAdminKey', '管理密钥'));
  nodes.push(N.button(W, '完成', { type: 'closeSheet' }));
  return nodes;
}
module.exports = { assistant, assistantSheet, summaryText };
