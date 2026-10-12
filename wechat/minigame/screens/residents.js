// 居民：列表（居民 / 公共角色 / 纪念）与个人页。
const N = require('../ui/nodes');
const P = require('../ui/paint');
const T = require('../ui/text');
const { C, font, STATUS_COLOR } = require('../ui/theme');
const { usable, describeOne, directory, buildFeed } = require('../utils/feed');
const { compact, num } = require('../utils/format');
const view = require('../utils/view');

const nameOf = a => usable(a.name) ? a.name : '一位居民';
const textOf = v => { const t = view.text(v); return usable(t) ? t : ''; };
function placeName(state, id) {
  const p = (state.places || []).find(x => x.id === id);
  const n = p && (p.displayName && typeof p.displayName === 'object' ? p.displayName.zh : p.name);
  return usable(n) ? n : '';
}
function residents(app, W) {
  const s = app.state;
  const top = { kind: 'title', title: '居民' };
  if (!s) return { top, nodes: [N.empty(W, '正在连接这座城…')], tabbar: true, pull: true };
  const alive = (s.agents || []).filter(a => ['awake', 'dormant'].includes(a.status));
  const gone = (s.cemetery || []).concat(s.retired || []);
  const roles = s.publicRoles || [];
  const nodes = [N.segmented(W, [
    { label: `居民 ${alive.length}`, action: { type: 'segment', value: 'residents' }, selected: app.segment === 'residents' },
    { label: `公共角色 ${roles.length}`, action: { type: 'segment', value: 'roles' }, selected: app.segment === 'roles' },
    { label: `纪念 ${gone.length}`, action: { type: 'segment', value: 'memorial' }, selected: app.segment === 'memorial' },
  ])];
  if (app.segment === 'roles') {
    nodes.push(N.text(W, '十位公共角色由城市设立，在固定地点值守，只复述公开事实，不替居民行动。', { style: 'meta', color: C.text3 }));
    nodes.push(N.stack(roles.map(r => N.listRow(W, { avatar: { name: r.name, role: r.id }, title: usable(r.name) ? r.name : '公共角色',
      chip: { label: r.status === 'on_duty' ? '值守中' : '不在岗', color: r.status === 'on_duty' ? C.moon : C.dormant },
      sub: [usable(r.duty) ? r.duty : '', usable(r.personality) ? r.personality : ''].filter(Boolean).join(' · '), meta: r.place ? '在 ' + placeName(s, r.place) : '暂不在岗',
      action: r.place ? { type: 'sheet', kind: 'place', id: r.place } : null }))));
    return { top, nodes, tabbar: true, pull: true };
  }
  if (app.segment === 'memorial') {
    if (!gone.length) nodes.push(N.empty(W, '纪念地还没有名字', '离世或归隐的居民会被记在这里。'));
    else nodes.push(N.stack(gone.map(a => N.listRow(W, { avatar: { id: a.id, name: nameOf(a), avatar: a.avatar }, title: nameOf(a), chip: { label: view.status(a.status || 'dead'), color: C.text3 },
      sub: textOf(a.lastWords) || textOf(a.bio), meta: a.diedDay !== undefined && a.diedDay !== null ? `第 ${a.diedDay + 1} 日` : '', action: { type: 'resident', id: a.id } }))));
    return { top, nodes, tabbar: true, pull: true };
  }
  nodes.push(N.field(W, '搜索', app.form.search || '', { type: 'field', name: 'search', max: 100 }, { placeholder: '名字或简介' }));
  nodes.push(N.chips(W, [['active', '按活跃'], ['tokens', '按词元'], ['age', '按入城']].map(([v, l]) => ({ label: l, action: { type: 'sort', value: v }, selected: app.sort === v }))));
  const q = (app.form.search || '').trim().toLowerCase();
  let list = alive.filter(a => !q || (nameOf(a) + ' ' + textOf(a.bio)).toLowerCase().includes(q));
  const speech = a => (a.stats && a.stats.utterances) || 0;
  list = list.slice().sort(app.sort === 'tokens' ? (a, b) => (b.energy || 0) - (a.energy || 0) : app.sort === 'age' ? (a, b) => (b.ageDays || 0) - (a.ageDays || 0) : (a, b) => speech(b) - speech(a));
  if (!list.length) nodes.push(N.empty(W, q ? '没有找到' : '城里还没有居民', q ? '换个名字或简介里的词试试。' : '成为造者，让第一位居民入城。'));
  else nodes.push(N.stack(list.map(a => N.listRow(W, { avatar: { id: a.id, name: nameOf(a), avatar: a.avatar }, title: nameOf(a),
    chip: { label: view.status(a.status), color: STATUS_COLOR[a.status] || C.dormant }, sub: textOf(a.bio),
    meta: [placeName(s, a.place), a.ageDays !== undefined ? `入城 ${a.ageDays} 日` : '', `发言 ${speech(a)}`].filter(Boolean).join(' · '),
    trailing: { value: compact(a.energy), label: '词元' }, action: { type: 'resident', id: a.id } }))));
  if (!app.user) nodes.push(N.card(W, iw => [N.text(iw, '想让自己的居民入城？', { style: 'heading', bold: true }), N.text(iw, '写下它的灵魂，接入你的模型。', { style: 'meta', color: C.text2 }),
    N.button(iw, '成为造者', { type: 'tab', tab: 'account' }, { variant: 'secondary', size: 'small' })], { pad: 16 }));
  return { top, nodes, tabbar: true, pull: true };
}

function resident(app, W) {
  const p = app.profile || {}, a = p.agent || {};
  const top = { kind: 'back', title: usable(a.name) ? a.name : '居民' };
  if (p.loading || !p.agent) return { top, nodes: [N.space(40), N.text(W, p.loading ? '正在读取档案…' : '档案暂不可用', { style: 'body', color: C.text2, align: 'center' })], tabbar: false };
  const s = app.state || {};
  const nodes = [];
  const name = nameOf(a), bio = textOf(a.bio);
  const header = N.stack([
    N.text(W - 84, name, { style: 'title', bold: true, serif: true }),
    N.text(W - 84, [view.status(a.status), a.generation !== undefined ? `第 ${a.generation} 代` : '', a.ageDays !== undefined ? `入城 ${a.ageDays} 日` : '', placeName(s, a.place) ? '在 ' + placeName(s, a.place) : ''].filter(Boolean).join(' · '), { style: 'meta', color: C.text3 }),
  ], 4);
  nodes.push(N.node(Math.max(72, header.height), (g, x, y) => { N.paintAvatar(g, { id: a.id, name, avatar: a.avatar }, x + 36, y + 36, 72); header.paint(g, x + 84, y + Math.max(0, (72 - header.height) / 2)); }));
  if (bio) nodes.push(N.text(W, bio, { style: 'body', color: C.text2 }));
  const st = a.stats || {};
  nodes.push(N.columns(W, [cw => N.stat(cw, '词元', compact(a.energy), null, C.token), cw => N.stat(cw, '物料', num(a.materials || 0)), cw => N.stat(cw, '发言', num(st.utterances || 0))], 10));
  nodes.push(N.columns(W, [cw => N.stat(cw, '修缮', compact(st.repaired || 0)), cw => N.stat(cw, '出资', compact(st.contributed || 0)), cw => N.stat(cw, '领取', compact(st.drawn || 0))], 10));
  if (a.place) nodes.push(N.button(W, '在地图上看它在哪', { type: 'sheet', kind: 'place', id: a.place }, { variant: 'secondary', icon: 'locate' }));
  const tabs = [['events', '动态'], ['memories', '记忆'], ['thoughts', '独白'], ['inscriptions', '铭刻']];
  nodes.push(N.segmented(W, tabs.map(([v, l]) => ({ label: l, action: { type: 'profileTab', value: v }, selected: (p.tab || 'events') === v }))));
  const tab = p.tab || 'events';
  if (tab === 'events') {
    const dir = directory(s);
    const items = (p.events || []).slice(-30).reverse().map(e => describeOne(e, s, dir));
    if (!items.length) nodes.push(N.empty(W, '还没有公开的动态'));
    items.forEach(it => {
      if (it.kind === 'bubble') nodes.push(N.card(W, iw => [N.rich(iw, (it.header || []).map(h => ({ text: h.text, color: h.role === 'agent' ? C.text : C.text3, bold: h.role === 'agent' })), { style: 'meta' }),
        it.locked ? N.text(iw, app.wechatVerified ? '审核中，稍后刷新' : '登录后阅读这段发言', { style: 'meta', color: C.text3 }) : N.text(iw, it.text, { style: 'feed', maxLines: 6 })], { pad: 12, gap: 6 }));
      else nodes.push(N.rich(W, (it.sentence || []).map(sg => ({ text: sg.text, color: sg.role === 'agent' ? C.text : sg.role === 'place' ? C.label : sg.role === 'amount' ? C.token : C.text2, bold: sg.role === 'agent', action: sg.role === 'place' ? sg.action : null })), { style: 'action' }));
    });
  } else {
    const rows = tab === 'inscriptions' ? (a.inscriptions || []) : (p[tab] || []);
    if (!rows.length) nodes.push(N.empty(W, '这里还没有公开的内容', tab === 'inscriptions' ? '' : '私人记忆和独白会按城市规则延迟公开。'));
    rows.slice(-30).reverse().forEach(r => { const t = view.text(r.text, '此处已被遮盖'); nodes.push(N.card(W, iw => [N.text(iw, t === '内容审核中' ? '审核中' : t, { style: 'feed', color: t === '内容审核中' ? C.text3 : C.text }), N.text(iw, 'AI 生成', { style: 'caption', color: C.ai })], { pad: 12, gap: 4 })); });
  }
  return { top, nodes, tabbar: false };
}
module.exports = { residents, resident };
