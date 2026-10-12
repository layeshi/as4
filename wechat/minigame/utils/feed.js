// 事件流：事件 → 中文句子（片段可点）→ 按刻分组、合并、日终摘要。只产出数据，界面在 screens/city.js。
const shared = require('./shared-text');
const { compact, num, dayTick } = require('./format');
const PENDING = '内容审核中';
const usable = v => typeof v === 'string' && v.trim() !== '' && v !== PENDING;
const MERGEABLE = new Set(['econ', 'life', 'env']);
const ICON = { speech: 'speech', econ: 'gather', polity: 'law', life: 'life', know: 'know', env: 'build', world: 'sun', admin: 'info' };
const TYPE_ICON = { explore: 'explore', move: 'move', give: 'give', gather: 'gather', weather_start: 'weather', weather_end: 'weather' };

function directory(state) {
  const dir = { agents: {}, places: {}, groups: {}, docs: {}, roles: {} };
  (state.agents || []).concat(state.cemetery || [], state.retired || []).forEach(a => { if (a && a.id) dir.agents[a.id] = a; });
  (state.places || []).forEach(p => { dir.places[p.id] = p; });
  (state.groups || []).forEach(g => { dir.groups[g.id] = g; });
  (state.docs || []).forEach(d => { dir.docs[d.id] = d; });
  (state.publicRoles || []).forEach(r => { dir.roles[r.id] = r; });
  return dir;
}
function agentName(dir, id) { const a = dir.agents[id]; return a && usable(a.name) ? a.name : '一位居民'; }
function placeName(dir, id) {
  const p = dir.places[id];
  if (!p) return '某处';
  const n = p.displayName && typeof p.displayName === 'object' ? p.displayName.zh : p.name;
  return usable(n) ? n : '某处';
}
/** 占位符的值 → 片段。role 决定颜色与是否可点（见 screens/city.js）。 */
function ref(v, dir) {
  if (v === null || v === undefined || v === '') return [];
  if (typeof v === 'number') return [{ text: compact(v), role: 'number' }];
  if (typeof v === 'string') return [{ text: v }];
  if (v.agent !== undefined) return v.agent ? [{ text: agentName(dir, v.agent), role: 'agent', action: { type: 'resident', id: v.agent } }] : [];
  if (v.place !== undefined) return [{ text: placeName(dir, v.place), role: 'place', action: { type: 'sheet', kind: 'place', id: v.place } }];
  if (v.group !== undefined) { const g = dir.groups[v.group]; return [{ text: g && usable(g.name) ? g.name : '一个社群' }]; }
  if (v.doc !== undefined) {
    const d = dir.docs[v.doc], title = v.title || (d && d.title);
    return [{ text: usable(title) ? `《${title}》` : '一篇典籍', role: 'doc', action: v.doc ? { type: 'detail', kind: 'doc', id: v.doc } : null }];
  }
  if (v.text !== undefined) { const t = String(v.text); return [{ text: t === PENDING ? '（审核中）' : t, role: 'ai' }]; }
  if (v.amount) {
    const parts = [];
    if (v.amount.energy) parts.push(compact(v.amount.energy) + ' 词元');
    if (v.amount.coins) parts.push(num(v.amount.coins) + ' 旧币');
    return [{ text: parts.join('、') || '0 词元', role: 'amount' }];
  }
  if (v.facilityType !== undefined) return [{ text: shared.LORE.module[v.facilityType] || String(v.facilityType) }];
  if (v.weather !== undefined) return [{ text: shared.LORE.weather[v.weather] || String(v.weather) }];
  if (v.treasury) return [{ text: '公库' }];
  if (v.city) return [{ text: '城' }];
  if (v.facility !== undefined) return [{ text: '一处设施' }];
  return [];
}
function fill(template, vars, dir, skip) {
  const out = [];
  for (const part of template.split(/(\{\w+\})/)) {
    const m = /^\{(\w+)\}$/.exec(part);
    if (!m) { if (part) out.push({ text: part }); continue; }
    if (skip && skip.includes(m[1])) continue;
    if (vars[m[1]] !== undefined) out.push(...ref(vars[m[1]], dir));
  }
  // 去掉被省略的主语留下的开头空格
  while (out.length && !out[0].text.trim()) out.shift();
  if (out.length) out[0] = Object.assign({}, out[0], { text: out[0].text.replace(/^\s+/, '') });
  return out.filter(s => s.text !== '');
}
const QUOTED_TEXT = /[：:，,]?\s*[「“]\{text\}[」”][。！]?/;

/** 一条事件 → 条目。 */
function describeOne(e, state, dir) {
  const premise = state.world ? state.world.premise : 0;
  // 物料为 0 的赠予、出资、修缮按不含物料的句子写，避免「以及 0 物料」。
  const plain = ['give', 'contribute', 'repair'].includes(e.type) && e.data && e.data.materials === 0;
  const d = shared.describe(plain ? Object.assign({}, e, { data: Object.assign({}, e.data, { materials: undefined }) }) : e, premise);
  const cat = shared.CAT[e.type] || 'world';
  const base = { key: e.seq, seq: e.seq, type: e.type, cat, day: e.day, tick: e.tick, place: e.place || null, event: e };
  const actorId = d.vars.a && d.vars.a.agent !== undefined ? d.vars.a.agent : null;
  const actor = actorId ? { id: actorId, name: agentName(dir, actorId) } : null;
  const textRef = d.vars.text;
  if (e.type === 'role_reply') {
    const role = dir.roles[e.data && e.data.publicRoleId] || {};
    const name = usable(e.data && e.data.name) ? e.data.name : usable(role.name) ? role.name : '公共角色';
    const text = textRef ? String(textRef.text) : '';
    return Object.assign(base, { kind: 'bubble', actor: { id: role.id || e.data.publicRoleId, name, role: role.id || e.data.publicRoleId },
      header: [{ text: name, role: 'agent' }, { text: '  ' + [usable(role.duty) ? role.duty : '公共角色', placeName(dir, e.place)].filter(Boolean).join(' · ') }],
      text: usable(text) ? text : '', locked: !usable(text), ai: !!(e.data && e.data.source === 'model'), roleBadge: true });
  }
  if (textRef && QUOTED_TEXT.test(d.template) && cat === 'speech' || textRef && ['inscribe', 'epitaph', 'petition', 'refound_open', 'announce'].includes(e.type)) {
    const text = String(textRef.text || '');
    let header;
    if (e.type === 'say') header = [].concat(ref(d.vars.a, dir), d.vars.at ? [{ text: ' 在 ' }].concat(ref(d.vars.at, dir)) : [], [{ text: ' 说' }]);
    else header = fill(d.template.replace(QUOTED_TEXT, ''), d.vars, dir).map(s => Object.assign({}, s, { text: s.text.replace(/[：:]$/, '') }));
    return Object.assign(base, { kind: 'bubble', actor, header, text: usable(text) ? text : '', locked: !usable(text), ai: true });
  }
  return Object.assign(base, { kind: 'action', actor, icon: TYPE_ICON[e.type] || ICON[cat] || 'info',
    sentence: fill(d.template, d.vars, dir), rest: actor ? fill(d.template, d.vars, dir, ['a']) : null, ai: false });
}

/**
 * events：接口返回的公开事件；filter：分类（'all' 或 CATEGORIES 之一）。
 * 返回按刻分组、由新到旧的条目：{ kind: 'group' | 'bubble' | 'action' | 'merged' | 'day', ... }。
 */
function buildFeed(events, state, filter = 'all') {
  if (!state || !Array.isArray(events)) return [];
  const dir = directory(state), perDay = (state.world && state.world.ticksPerDay) || 12;
  const sorted = events.filter(e => e && e.type && (shared.CAT[e.type] || 'world') !== 'admin').slice().sort((a, b) => a.seq - b.seq);
  // 日终：把同一刻的配给（rule_op share）与物料补充并入一张摘要卡。
  const consumed = new Set(), days = {};
  for (const e of sorted) if (e.type === 'day') days[e.tick] = e;
  for (const e of sorted) {
    const day = days[e.tick];
    if (!day || e === day) continue;
    if (e.type === 'material_regrowth' || (e.type === 'rule_op' && e.data && e.data.op === 'share' && e.data.from === 'treasury')) consumed.add(e.seq);
  }
  const items = [];
  for (const e of sorted) {
    if (consumed.has(e.seq)) continue;
    if (e.type === 'day') {
      const same = sorted.filter(x => consumed.has(x.seq) && x.tick === e.tick);
      const share = same.find(x => x.type === 'rule_op');
      const regrowth = same.filter(x => x.type === 'material_regrowth').reduce((s, x) => s + (Number(x.data && x.data.added) || 0), 0);
      const facts = [];
      if (e.data && Number.isFinite(e.data.output)) facts.push({ label: '源井出能', value: compact(e.data.output), token: true });
      if (share && share.data.each && share.data.each.energy) facts.push({ label: '公民各得', value: compact(share.data.each.energy), token: true });
      if (regrowth) facts.push({ label: '回收地补充物料', value: num(regrowth) });
      items.push({ kind: 'day', key: e.seq, seq: e.seq, cat: 'world', tick: e.tick, day: e.day, title: `第 ${Number(e.data && e.data.day) + 1} 日结束`, facts, awake: e.data && e.data.population ? e.data.population.awake : null });
      continue;
    }
    const item = describeOne(e, state, dir);
    const prev = items[items.length - 1];
    if (item.kind === 'action' && item.actor && MERGEABLE.has(item.cat) && prev && (prev.kind === 'action' || prev.kind === 'merged') && prev.actor && prev.actor.id === item.actor.id && prev.tick === item.tick && MERGEABLE.has(prev.cat)) {
      const merged = prev.kind === 'merged' ? prev : { kind: 'merged', key: prev.key, seq: prev.seq, cat: prev.cat, tick: prev.tick, day: prev.day, actor: prev.actor, events: [prev] };
      merged.events.push(item); merged.seq = item.seq; merged.key = item.seq;
      items[items.length - 1] = merged;
      continue;
    }
    items.push(item);
  }
  for (const it of items) if (it.kind === 'merged') summarize(it, dir);
  const shown = items.filter(it => filter === 'all' || it.cat === filter || (it.kind === 'merged' && it.events.some(x => x.cat === filter)));
  const out = [];
  let group = null;
  for (const it of shown.reverse()) {
    // 按刻数分组：日终事件记的是结束的那一天，但发生在下一天的第一刻。
    const label = dayTick(Math.floor(it.tick / perDay), it.tick, perDay);
    if (label !== group) { out.push({ kind: 'group', key: 'g' + it.tick + ':' + it.seq, label }); group = label; }
    out.push(it);
  }
  return out;
}
// 合并后的条目：全是同一处的探索就写成「探索 N 次，共得 X 词元」，否则逐条列出（省去主语）。
function summarize(it, dir) {
  const ev = it.events;
  if (ev.every(x => x.type === 'explore') && ev.every(x => x.place === ev[0].place)) {
    const data = x => x.event.data || {};
    const total = ev.reduce((s, x) => s + (data(x).outcome === 'energy' ? Number(data(x).amount) || 0 : 0), 0);
    const relics = ev.filter(x => data(x).outcome === 'relic').length;
    it.kind = 'action'; it.icon = 'explore'; it.place = ev[0].place;
    it.sentence = [{ text: it.actor.name, role: 'agent', action: { type: 'resident', id: it.actor.id } }, { text: ' 在' }, ...ref({ place: ev[0].place }, dir), { text: `探索 ${ev.length} 次，` }]
      .concat(total ? [{ text: '共得 ' }, { text: compact(total) + ' 词元', role: 'amount' }] : [])
      .concat(relics ? [{ text: (total ? '，' : '') + `拾得遗物 ${relics} 件` }] : [])
      .concat(!total && !relics ? [{ text: '一无所获' }] : [], [{ text: '。' }]);
    return;
  }
  it.count = ev.length;
  it.lines = ev.map(x => x.rest && x.rest.length ? x.rest : x.sentence);
}
module.exports = { buildFeed, describeOne, directory, agentName, placeName, PENDING, usable };
