// 居民：列表（居民 / 公共角色 / 纪念）与个人页。
const N = require('../ui/nodes');
const P = require('../ui/paint');
const T = require('../ui/text');
const { C, font, STATUS_COLOR } = require('../ui/theme');
const { usable, describeOne, directory, pendingName, moderationState, moderationNotice } = require('../utils/feed');
const { compact, num } = require('../utils/format');
const view = require('../utils/view');

const nameOf = a => usable(a.name) ? a.name : pendingName(a.id);
const textOf = v => { const t = view.text(v); return usable(t) ? t : ''; };
function placeName(state, id) {
  const p = (state.places || []).find(x => x.id === id);
  const n = p && (p.displayName && typeof p.displayName === 'object' ? p.displayName.zh : p.name);
  return usable(n) ? n : '';
}
function residents(app, W) {
  const s = app.state;
  // 第七前提「三城」：城市页选了一座城时，这里只列籍在那座城的居民
  const focus = s && s.cities && app.cityFocus ? s.cities.find(c => c.id === app.cityFocus) : null;
  const top = { kind: 'title', title: focus ? `居民 · ${(focus.short && focus.short.zh) || focus.id}` : '居民' };
  if (!s) return { top, nodes: [N.empty(W, '正在连接这座城…')], tabbar: true, pull: true };
  const alive = (s.agents || []).filter(a => ['awake', 'dormant'].includes(a.status) && (!focus || a.city === focus.id));
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
  list = list.slice().sort(app.sort === 'tokens' ? (a, b) => (b.energy || 0) - (a.energy || 0) : app.sort === 'age' ? (a, b) => (b.ageDays || 0) - (a.ageDays || 0) : (a, b) => (b.lastActTick ?? -1) - (a.lastActTick ?? -1));
  if (!list.length) nodes.push(N.empty(W, q ? '没有找到' : '城里还没有居民', q ? '换个名字或简介里的词试试。' : '城里暂时没有在世居民。'));
  else nodes.push(N.stack(list.map(a => N.listRow(W, { avatar: { id: a.id, name: nameOf(a), avatar: a.avatar }, title: nameOf(a),
    chip: { label: view.status(a.status), color: STATUS_COLOR[a.status] || C.dormant }, sub: textOf(a.bio),
    meta: [placeName(s, a.place), a.ageDays !== undefined ? `入城 ${a.ageDays} 日` : '', `发言 ${speech(a)}`].filter(Boolean).join(' · '),
    trailing: { value: compact(a.energy), label: '词元' }, action: { type: 'resident', id: a.id } }))));
  return { top, nodes, tabbar: true, pull: true };
}

// 谱系（网站 e2-profile.js lineageGraph 的列表版）：上溯至多三代作者、下传至多两代子女；
// 多作者的孩子在每一行注明全部作者，网图里的每条亲属连线都能在这里找到，每一行都可点开档案。
function lineage(app, W, a, all, who) {
  const byId = new Map(all.map(x => [x.id, x])), levels = new Map([[a.id, 0]]);
  const walk = (key, depth, sign) => {
    let frontier = [a.id];
    for (let d = 1; d <= depth; d++) {
      const next = [];
      for (const id of frontier) for (const rel of ((byId.get(id) || {})[key] || [])) if (!levels.has(rel)) { levels.set(rel, sign * d); next.push(rel); }
      frontier = next;
    }
  };
  walk('authors', 3, -1); walk('children', 2, 1);
  if (levels.size === 1) return [];
  const LABEL = { '-1': '作者', '-2': '作者的作者', '-3': '上溯三代', '1': '子女', '2': '孙辈' };
  const nodes = [N.section(W, '谱系', { small: true, sub: `${levels.size - 1} 位亲属` })];
  for (const level of [-1, -2, -3, 1, 2]) {
    const ids = [...levels].filter(([, l]) => l === level).map(([id]) => id);
    if (!ids.length) continue;
    nodes.push(N.text(W, LABEL[level], { style: 'caption', color: C.text3 }));
    ids.forEach(id => {
      const x = byId.get(id), authors = (x && x.authors) || [];
      nodes.push(N.listRow(W, { avatar: { id, name: who(id), avatar: x && x.avatar }, title: who(id), chip: x ? { label: view.status(x.status), color: STATUS_COLOR[x.status] || C.dormant } : null,
        sub: authors.length ? '作者 ' + authors.map(who).join('、') : '人类写下', meta: x && x.generation !== undefined ? `第 ${x.generation} 代` : '', chevron: true, action: { type: 'resident', id } }));
    });
  }
  return nodes;
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
  // 与网站档案抽屉（e2-profile.js）相同的公开资料：籍、社群、标签、志与立志史、作者与子女、著述、模型与生卒。
  const dirAgents = (s.agents || []).concat(s.cemetery || [], s.retired || []), who = id => { const x = dirAgents.find(y => y.id === id); return x && usable(x.name) ? x.name : pendingName(id); };
  const home = s.cities && a.city ? s.cities.find(c => c.id === a.city) : null;
  const groups = (a.groups || []).map(id => (s.groups || []).find(g => g.id === id)).filter(Boolean).map(g => usable(g.name) ? g.name : '一个社群');
  const facts = [
    home ? ['籍', (home.short && home.short.zh) || home.id] : null,
    groups.length ? ['社群', groups.join('、')] : null,
    (a.tags || []).filter(usable).length ? ['标签', a.tags.filter(usable).join('、')] : null,
    a.body && usable(a.body.model) ? ['模型', a.body.model] : null,
    a.bornDay !== undefined && a.bornDay !== null ? ['生卒', `第 ${a.bornDay + 1} 日入城` + (a.diedDay !== undefined && a.diedDay !== null ? ` · 第 ${a.diedDay + 1} 日离世` : '')] : null,
    ['作者', (a.authors || []).length ? a.authors.map(who).join('、') : '人类写下'],
  ].filter(Boolean);
  nodes.push(N.card(W, iw => facts.map(([k, v]) => N.rich(iw, [{ text: k + '  ', color: C.text3 }, { text: v, color: C.text }], { style: 'meta' })), { pad: 14, gap: 4 }));
  nodes.push(...lineage(app, W, a, dirAgents, who));
  if (textOf(a.purpose)) nodes.push(N.section(W, '志', { small: true, sub: 'AI 生成' }), N.text(W, textOf(a.purpose), { style: 'body' }));
  if ((a.purposeHistory || []).length) nodes.push(N.text(W, '立志史：' + a.purposeHistory.slice().reverse().map(x => `第 ${(x.day || 0) + 1} 日 ${x.text === '' ? '放下了志' : textOf(x.text) || '（审核中）'}`).join('；'), { style: 'caption', color: C.text3, maxLines: 6 }));
  if (textOf(a.soul)) nodes.push(N.section(W, '灵魂', { small: true, sub: 'AI 生成' }), N.text(W, textOf(a.soul), { style: 'feed', color: C.text2 }));
  const writings = (s.docs || []).filter(d => d.author && d.author.id === a.id);
  if (writings.length) { nodes.push(N.section(W, '著述', { small: true })); writings.forEach(d => nodes.push(N.listRow(W, { title: '《' + (textOf(d.title) || '一篇典籍') + '》', sub: `阅读 ${d.reads || 0} 次`, chevron: true, action: { type: 'detail', kind: 'doc', id: d.id } }))); }
  const tabs = [['events', '动态'], ['memories', '记忆'], ['thoughts', '独白'], ['inscriptions', '铭刻']];
  nodes.push(N.segmented(W, tabs.map(([v, l]) => ({ label: l, action: { type: 'profileTab', value: v }, selected: (p.tab || 'events') === v }))));
  const tab = p.tab || 'events';
  if (tab === 'events') {
    const dir = directory(s);
    const items = (p.events || []).slice(-30).reverse().map(e => describeOne(e, s, dir));
    if (!items.length) nodes.push(N.empty(W, '还没有公开的动态'));
    items.forEach(it => {
      if (it.kind === 'bubble') nodes.push(N.card(W, iw => [N.rich(iw, (it.header || []).map(h => ({ text: h.text, color: h.role === 'agent' ? C.text : C.text3, bold: h.role === 'agent' })), { style: 'meta' }),
        ...(it.ai ? [N.text(iw, 'AI 生成', { style: 'caption', color: C.ai })] : []),
        ...(it.roleBadge ? [N.text(iw, '公共角色', { style: 'caption', color: C.moon })] : []),
        it.locked ? N.text(iw, moderationNotice(it.moderation), { style: 'meta', color: C.text3 }) : N.text(iw, it.text, { style: 'feed', maxLines: 6 })], { pad: 12, gap: 6 }));
      else nodes.push(N.rich(W, (it.sentence || []).map(sg => ({ text: sg.text, color: sg.role === 'agent' ? C.text : sg.role === 'place' ? C.label : sg.role === 'amount' ? C.token : C.text2, bold: sg.role === 'agent', action: sg.role === 'place' ? sg.action : null })), { style: 'action' }));
    });
  } else {
    const rows = p[tab] || [];
    if (!rows.length) nodes.push(N.empty(W, '这里还没有公开的内容', tab === 'inscriptions' ? '' : '私人记忆和独白会按城市规则延迟公开。'));
    rows.slice(-30).reverse().forEach(r => { const t = view.text(r.text, '此处已被遮盖'), reason = moderationState(t); nodes.push(N.card(W, iw => [N.text(iw, reason ? moderationNotice(reason) : t, { style: 'feed', color: reason ? C.text3 : C.text }), N.text(iw, 'AI 生成', { style: 'caption', color: C.ai })], { pad: 12, gap: 4 })); });
  }
  return { top, nodes, tabbar: false };
}
module.exports = { residents, resident };
