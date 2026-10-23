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
function docCard(W, d) {
  const title = textOf(d.title) || '一篇典籍';
  const by = d.author && usable(d.author.name) ? d.author.name : d.kind === 'virtual' ? '虚拟典籍' : textOf(d.source);
  return N.card(W, iw => [
    N.text(iw, '《' + title + '》', { style: 'heading', bold: true }),
    N.text(iw, [by, textOf(d.source) && d.kind !== 'virtual' ? textOf(d.source) : d.kind === 'virtual' ? textOf(d.source) : '', d.reads ? `阅读 ${d.reads} 次` : ''].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(' · '), { style: 'caption', color: C.text3 }),
  ], { pad: 14, gap: 4, action: { type: 'detail', kind: 'doc', id: d.id } });
}
// 第七前提「三城」：与网站 app.js scopeState 相同，聚焦一座城时法律、提案、重订、上书、宪章与程序取那座城的。
function scopedState(app) {
  const raw = app.state, c = raw && raw.cities && app.cityFocus ? raw.cities.find(x => x.id === app.cityFocus) : null;
  if (!c) return raw;
  return Object.assign({}, raw, { world: Object.assign({}, raw.world, { cityName: c.cityName, humanCityName: c.humanName, focus: c.id }), treasury: c.treasury, well: c.well, vars: c.vars, procedure: c.procedure, charter: c.charter, laws: c.laws, proposals: c.proposals, refounds: c.refounds, petitions: c.petitions });
}
const cityLabel = c => usable(c.cityName) && c.cityName !== (c.humanName || {}).zh ? c.cityName : (c.short && c.short.zh) || c.id;
function cityComparison(app, W) {
  const nodes = [N.section(W, '三城对比', { small: true })];
  app.state.cities.forEach(c => {
    const hist = (c.well && c.well.outputHistory) || [], pop = c.population || {};
    const weather = ((c.weather && c.weather.active) || []).map(x => shared.LORE.weather[x.type] || x.type).join(' · ') || '—';
    nodes.push(N.card(W, iw => [
      N.text(iw, cityLabel(c), { style: 'heading', bold: true }),
      N.text(iw, `籍 ${pop.residents ?? '—'} · 在场 ${pop.present ?? '—'} · 源井昨日 ${hist.length ? compact(hist[hist.length - 1]) : '—'} · 公库 ${c.treasury ? compact(c.treasury.energy) : '—'}`, { style: 'caption', color: C.text2 }),
      N.text(iw, `现行法 ${(c.laws || []).filter(l => l.status === 'active').length} · 待表决 ${(c.proposals || []).filter(p => p.status === 'open').length} · 天象 ${weather}`, { style: 'caption', color: C.text2 }),
    ], { pad: 12, gap: 4, action: { type: 'cityFocus', city: c.id } }));
  });
  return nodes;
}
function healthNode(W, health) {
  if (!health) return null;
  const lines = [`资格恢复观察：${health.eligibilityDays}/3 日。`];
  if (health.fault) lines.push(`程序 ${health.fault.lawId} 运行错误：${(health.fault.fields || []).map(f => `${f.field}（${f.code}）`).join('、')}；连续失败日结复查 ${health.fault.consecutiveDays}/3。`);
  if (health.recovery) lines.push(`最近自动恢复原因：${health.recovery.reason === 'runtime_error' ? '真实运行错误持续' : '没有合格提出者或表决者'}；${health.recovery.previousLawId} → ${health.recovery.lawId}。`);
  return N.text(W, lines.join('\n'), { style: 'caption', color: health.fault ? C.danger : C.text3 });
}
function placeLabel(p) { const n = p.displayName && typeof p.displayName === 'object' ? p.displayName.zh : p.name; return usable(n) ? n : p.id; }
function ownerLabel(app, o) {
  if (!o) return '—';
  if (o.kind === 'city') return '城市所有';
  if (o.kind === 'group') { const g = (app.state.groups || []).find(x => x.id === o.id); return g && usable(g.name) ? g.name : '社群所有'; }
  const a = (app.state.agents || []).find(x => x.id === o.id); return a && usable(a.name) ? a.name : '居民所有';
}
const LAW_STATUS = { active: '在效', repealed: '已撤销', replaced: '已取代' };
const PROC = { ordinary: '普通', constitutional: '修宪' };
function proposalCard(app, W, p, past) {
  const tally = p.tally || { yes: 0, no: 0, abstain: 0 }, left = Math.max(0, (p.closesTick || 0) - app.state.world.tick);
  const result = p.status === 'passed' ? '通过' : p.status === 'void' ? '作废' : '未通过';
  return N.card(W, iw => [
    N.text(iw, `${p.id} · ${textOf(p.title) || '一项提案'}`, { style: 'heading', bold: true }),
    N.text(iw, [PROC[p.class] || p.class, p.kind && p.kind !== 'law' ? (p.kind === 'bylaws' ? '章程' : p.kind) : ''].filter(Boolean).join(' · '), { style: 'caption', color: C.text3 }),
    contentOf(p.text) ? N.text(iw, contentOf(p.text), { style: 'meta', color: C.text2, maxLines: 4 }) : null,
    view.reading(p) ? N.text(iw, view.reading(p), { style: 'caption', color: C.text2, maxLines: 6 }) : null,
    N.text(iw, `表决者 ${p.voters ?? '—'} 人 · 赞成 ${tally.yes} / 反对 ${tally.no} / 弃权 ${tally.abstain || 0} · ${past ? result : `还剩 ${left} 刻`} · ${p.secret ? '不记名' : '记名'}`, { style: 'caption', color: C.text3 }),
    p.voidReason === 'refounded' ? N.text(iw, `重订 ${p.refoundId} 已使这项进行中的程序修改案作废。`, { style: 'caption', color: C.text3 }) : null,
    p.enact ? N.text(iw, enactText(p.enact), { style: 'caption', color: C.text3 }) : null,
    N.progress(iw, (tally.yes + tally.no + (tally.abstain || 0)) ? tally.yes / (tally.yes + tally.no + (tally.abstain || 0)) : 0, C.awake, 6),
    (p.votes || []).length ? N.button(iw, app.expanded.has('votes:' + p.id) ? '收起表决记录' : `${p.votes.length} 票表决记录`, { type: 'expand', key: 'votes:' + p.id }, { variant: 'text', size: 'small', align: 'left' }) : null,
    ...(app.expanded.has('votes:' + p.id) ? (p.votes || []).map(v => N.text(iw, `${v.agent && usable(v.agent.name) ? v.agent.name : '?'} ${{ yes: '赞成', no: '反对', abstain: '弃权' }[v.choice] || contentOf(v.choice)}${v.reason ? ' — ' + contentOf(v.reason) : ''}`, { style: 'caption', color: C.text2 })) : []),
  ], { pad: 14, gap: 6 });
}
// ── 折叠卡片：标题行可点开合，展开后显示网站同一份明细（读法、作者与时间、指纹、执行结果、规则 JSON） ──
function fold(app, W, key, title, chip, body) {
  const open = app.expanded.has(key), toggle = { type: 'expand', key };
  N.record('fold', title, { action: toggle, open });
  return N.card(W, iw => {
    const head = N.node(24, (g, x, y) => {
      const tf = font(15, { bold: true }), cw = chip ? N.chipWidth(chip.label) + 8 : 0;
      P.text(g.ctx, T.ellipsize(g.ctx, title, iw - cw - 26, tf), x, y + 12, tf, C.text);
      if (chip) N.paintChip(g.ctx, chip.label, x + iw - cw - 18, y + 2, chip.color);
      P.icon(g.ctx, open ? 'expand' : 'right', x + iw - 14, y + 5, 14, C.text3, 2);
      g.hit(x - 14, y - 10, iw + 28, 44, toggle);
    });
    return [head].concat(open ? body(iw).filter(Boolean) : []);
  }, { pad: 14, gap: 6 });
}
const json = value => { try { return JSON.stringify(value, null, 2); } catch (_) { return ''; } };
const jsonText = (W, label, value) => value && (Array.isArray(value) ? value.length : Object.keys(value).length) ? N.stack([N.text(W, label, { style: 'caption', color: C.text3 }), N.text(W, json(value), { style: 'caption', color: C.text2 })], 2) : null;
const dayOfTick = (app, tick) => Math.floor((tick || 0) / ((app.state.world && app.state.world.ticksPerDay) || 12)) + 1;
function authorText(a) {
  if (a === 'humans') return '人类留下';
  if (a === 'revert') return '自动回退';
  if (typeof a === 'string' && a.startsWith('refound:')) return '重订 ' + a.slice(8);
  return a && usable(a.name) ? a.name : a && a.id ? a.id : '?';
}
function enactText(enact) {
  if (!enact) return '';
  const status = { no_enact: '无施行项', condition_false: '条件不成立', success: '施行成功', partial_failure: '部分失败', failure: '施行失败' }[enact.status] || enact.status;
  const diag = (enact.diagnostics || []).map(d => `规则 ${d.rule}${d.index !== undefined ? '#' + d.index : ''} ${d.phase === 'collect' ? '收集' : '施行'}：${d.code}`).join('；');
  return '施行结果：' + status + (diag ? '（' + diag + '）' : '');
}
function readingLines(reading) {
  if (!reading) return '';
  const r = reading.zh || reading;
  if (r.procedure) return ['ordinary', 'constitutional'].filter(c => r.procedure[c]).map(c => PROC[c] + '：' + r.procedure[c]).join('\n');
  if (Array.isArray(r.rules)) return r.rules.map((x, i) => `${i + 1}. ${x}`).join('\n');
  return view.text(r);
}
function lawFold(app, W, l) {
  const status = { active: '在效', repealed: '已撤销', replaced: '已取代' }[l.status] || view.status(l.status);
  const title = `${l.id} · ${(l.i18n && l.i18n.zh && textOf(l.i18n.zh.title)) || textOf(l.title) || '一部法律'}`;
  return fold(app, W, 'law:' + (app.cityFocus || '') + ':' + l.id, title, { label: l.suspended ? '停摆' : status, color: l.suspended ? C.token : STATUS_COLOR[l.status] || C.dormant }, iw => [
    l.procedure ? N.text(iw, '立法程序', { style: 'caption', color: C.moon }) : null,
    N.text(iw, contentOf(l.i18n && l.i18n.zh ? l.i18n.zh.text : l.text) || '（无正文）', { style: 'meta', color: C.text2 }),
    readingLines(l.reading) ? N.text(iw, '规则实际执行的含义：\n' + readingLines(l.reading), { style: 'caption', color: C.text2 }) : null,
    N.text(iw, ['作者 ' + authorText(l.author), `第 ${dayOfTick(app, l.enactedTick)} 日生效`, l.suspendedDays > 0 ? `停摆 ${l.suspendedDays} 日` : '', l.basedOn ? '改写自 ' + l.basedOn : '', l.repealedBy ? `被 ${l.repealedBy} 撤销` : '', l.replacedBy ? `被 ${l.replacedBy} 取代` : ''].filter(Boolean).join(' · '), { style: 'caption', color: C.text3 }),
    (l.fingerprints || []).length ? N.text(iw, '指纹：' + l.fingerprints.map(f => String(f).slice(0, 8)).join(' '), { style: 'caption', color: C.text3 }) : null,
    l.enact ? N.text(iw, enactText(l.enact), { style: 'caption', color: C.text3 }) : (l.results || []).length ? N.text(iw, '施行结果：' + l.results.map(r => `${r.op}${r.ok ? '✓' : '✗'}`).join(' '), { style: 'caption', color: C.text3 }) : null,
    jsonText(iw, '规则 JSON', l.procedure || l.rules),
    N.buttonRow(iw, [{ label: '询问实验助手', action: { type: 'assistantOpen', lawId: l.id }, variant: 'secondary' }].concat(app.state.cities ? [] : [{ label: '法律详情', action: { type: 'detail', kind: 'law', id: l.id }, variant: 'secondary' }]), 8, { size: 'small' }),
  ]);
}
function physicsNodes(app, W) {
  const lore = app.archiveLore, w = app.state.world;
  if (!lore) return [N.text(W, app.archiveLoreError || '正在读取物理定律…', { style: 'caption', color: C.text3 })];
  if (shared.tokenized(w)) return [fold(app, W, 'law:physics', '物理定律', null, iw => [N.text(iw, contentOf(lore.physicsP4) || '—', { style: 'meta', color: C.text2 })])];
  const physics = w.premise >= 1 ? lore.physicsP1 : lore.physics;
  return ['natural', 'guardian'].filter(k => physics && physics[k]).map(k => fold(app, W, 'law:physics:' + k, contentOf(physics[k].title) || (k === 'natural' ? '自然律' : '守护律'), null, iw => (physics[k].items || []).map((x, i) => N.text(iw, `${i + 1}. ${contentOf(x)}`, { style: 'meta', color: C.text2 }))));
}
function lawSections(app, W, s) {
  const nodes = [];
  if ((s.ruleDiagnostics || []).length) {
    nodes.push(N.section(W, '有效法律的最近运行错误', { small: true }), N.text(W, '以下为历史诊断；法律仍有效不代表其规则执行成功。', { style: 'caption', color: C.text3 }));
    s.ruleDiagnostics.forEach(e => nodes.push(N.text(W, `${e.owner} · rules[${e.rule}] · 第 ${e.tick} 刻 · ${e.code}：${contentOf(e.detail)}`, { style: 'caption', color: C.danger })));
  }
  nodes.push(N.section(W, '物理', { small: true }), ...physicsNodes(app, W));
  const vars = Object.entries(s.vars || {});
  nodes.push(fold(app, W, 'law:vars:' + (app.cityFocus || ''), '变量', { label: String(vars.length), color: C.text3 }, iw => vars.length ? vars.map(([k, v]) => N.rich(iw, [{ text: k + '  ', color: C.text3 }, { text: v === null ? 'null' : typeof v === 'string' ? contentOf(v) : String(v), color: C.text }], { style: 'meta' })) : [N.text(iw, '没有变量。', { style: 'meta', color: C.text3 })]));
  if (s.procedure) {
    nodes.push(N.section(W, '现行的立法程序', { small: true }));
    ['ordinary', 'constitutional'].forEach(c => { const p = s.procedure[c]; if (p) nodes.push(N.card(W, iw => [N.text(iw, `${PROC[c]} · ${p.lawId}`, { style: 'meta', bold: true }), N.text(iw, view.text(p.reading) || '这一类不再立法', { style: 'caption', color: C.text2 }), healthNode(iw, p.health)], { pad: 12, gap: 4 })); });
    const history = (s.laws || []).filter(l => l.procedure).sort((a, b) => a.enactedTick - b.enactedTick);
    if (history.length) nodes.push(fold(app, W, 'law:prochistory:' + (app.cityFocus || ''), '程序的变迁', { label: String(history.length), color: C.text3 }, iw => history.map(l => N.text(iw, `${l.id} · ${(l.i18n && l.i18n.zh && textOf(l.i18n.zh.title)) || textOf(l.title)} · ${['ordinary', 'constitutional'].filter(c => l.procedure[c]).map(c => PROC[c]).join('/')} · ${({ active: '在效', repealed: '已撤销', replaced: '已取代' })[l.status] || l.status} · 第 ${dayOfTick(app, l.enactedTick)} 日生效 · ${authorText(l.author)}`, { style: 'caption', color: C.text2 }))));
  }
  const laws = s.laws || [], active = laws.filter(l => l.status === 'active' && !l.procedure);
  const human = active.filter(l => l.author === 'humans'), heirs = active.filter(l => l.author !== 'humans').reverse();
  nodes.push(N.section(W, '遗法（人类留下的法律）', { small: true }));
  if (!human.length) nodes.push(N.text(W, '还没有法律。', { style: 'meta', color: C.text3 }));
  human.forEach(l => nodes.push(lawFold(app, W, l)));
  nodes.push(N.section(W, '后人之法', { small: true }));
  if (!heirs.length) nodes.push(N.text(W, '还没有法律。', { style: 'meta', color: C.text3 }));
  heirs.forEach(l => nodes.push(lawFold(app, W, l)));
  const open = (s.proposals || []).filter(p => p.status === 'open');
  nodes.push(N.section(W, '进行中的提案', { small: true }));
  if (!open.length) nodes.push(N.text(W, '没有进行中的提案。', { style: 'meta', color: C.text3 }));
  open.forEach(p => nodes.push(proposalCard(app, W, p, false)));
  const refounds = (s.refounds || []).filter(r => r.status === 'open');
  if (refounds.length) {
    nodes.push(N.section(W, '进行中的重订', { small: true }));
    refounds.forEach(r => nodes.push(N.card(W, iw => [N.text(iw, `${r.id} · 发起人 ${r.by && usable(r.by.name) ? r.by.name : '—'}`, { style: 'heading', bold: true }), contentOf(r.text) ? N.text(iw, contentOf(r.text), { style: 'meta', color: C.text2, maxLines: 4 }) : null, N.text(iw, `联署 ${r.liveSigners ?? (r.signers || []).length}/${r.needed ?? '?'} · 还剩 ${Math.max(0, (r.expiresTick || 0) - app.state.world.tick)} 刻`, { style: 'caption', color: C.text3 })], { pad: 14, gap: 6 })));
  }
  const petitions = (s.petitions || []).slice().reverse();
  if (petitions.length) { nodes.push(N.section(W, '上书', { small: true })); petitions.slice(0, 30).forEach(p => nodes.push(N.text(W, `${p.lawId} · 第 ${p.day + 1} 日 · ${contentOf(p.text)}`, { style: 'meta', color: C.text2 }))); }
  const articles = (s.charter && s.charter.articles) || [];
  if (articles.length) {
    const canon = s.charter.canonical;
    const CHARTER = { legacy: '原文', amended: '已修订', repealed: '已废除' };
    nodes.push(N.section(W, '人类遗宪', { small: true, sub: `${articles.length} 条` }), N.text(W, canon ? '正本：' + canon : '（尚未指定正本语言）', { style: 'caption', color: C.text3 }));
    articles.forEach(a => nodes.push(fold(app, W, 'charter:' + (app.cityFocus || '') + ':' + a.n, `第 ${a.n} 条 · ${contentOf((a.versions || {}).zh || Object.values(a.versions || {})[0]) || '—'}`, { label: CHARTER[a.status] || a.status, color: a.status === 'legacy' ? C.moon : C.token }, iw => Object.entries(a.versions || {}).map(([code, text]) => N.text(iw, `${code}${code === canon ? '（正本）' : ''}：${contentOf(text)}`, { style: 'meta', color: code === canon ? C.text : C.text2 })).concat((a.history || []).length ? [N.text(iw, '修订记录：' + a.history.map(x => x.lawId + (x.lang ? ' · ' + x.lang : '')).join('；'), { style: 'caption', color: C.text3 })] : []))));
  }
  const bylaws = (s.groups || []).filter(g => g.bylaws && !g.dissolved);
  nodes.push(N.section(W, '社群章程', { small: true }));
  if (!bylaws.length) nodes.push(N.text(W, '还没有社群章程。', { style: 'meta', color: C.text3 }));
  bylaws.forEach(g => nodes.push(fold(app, W, 'bylaws:' + g.id, textOf(g.name) || '一个社群', g.bylaws.suspended ? { label: '停摆', color: C.token } : null, iw => [
    readingLines(g.bylaws.reading) ? N.text(iw, readingLines(g.bylaws.reading), { style: 'caption', color: C.text2 }) : null,
    g.bylaws.enact ? N.text(iw, enactText(g.bylaws.enact), { style: 'caption', color: C.text3 }) : null,
    N.text(iw, `设定者 ${g.bylaws.setBy && usable(g.bylaws.setBy.name) ? g.bylaws.setBy.name : '—'} · 社群的程序：${g.procedure || '—'}`, { style: 'caption', color: C.text3 }),
    (g.bylaws.fingerprints || []).length ? N.text(iw, '指纹：' + g.bylaws.fingerprints.map(f => String(f).slice(0, 8)).join(' '), { style: 'caption', color: C.text3 }) : null,
    jsonText(iw, '规则 JSON', g.bylaws.rules),
  ])));
  const placeRules = (s.places || []).filter(p => p.rules && (!app.cityFocus || !s.cities || p.city === app.cityFocus));
  nodes.push(N.section(W, '地点规则', { small: true }));
  if (!placeRules.length) nodes.push(N.text(W, '还没有地点规则。', { style: 'meta', color: C.text3 }));
  placeRules.forEach(p => nodes.push(fold(app, W, 'placerules:' + p.id, placeLabel(p), p.rules.suspended ? { label: '停摆', color: C.token } : { label: ownerLabel(app, p.owner), color: C.text3 }, iw => [
    readingLines(p.rules.reading) ? N.text(iw, readingLines(p.rules.reading), { style: 'caption', color: C.text2 }) : null,
    p.rules.enact ? N.text(iw, enactText(p.rules.enact), { style: 'caption', color: C.text3 }) : null,
    N.text(iw, '设定者 ' + (p.rules.setBy && usable(p.rules.setBy.name) ? p.rules.setBy.name : '—'), { style: 'caption', color: C.text3 }),
    (p.rules.fingerprints || []).length ? N.text(iw, '指纹：' + p.rules.fingerprints.map(f => String(f).slice(0, 8)).join(' '), { style: 'caption', color: C.text3 }) : null,
    jsonText(iw, '规则 JSON', p.rules.rules),
    N.button(iw, '地点档案', { type: 'detail', kind: 'place', id: p.id }, { variant: 'secondary', size: 'small' }),
  ])));
  const past = (s.proposals || []).filter(p => p.status !== 'open').reverse(), gone = laws.filter(l => l.status !== 'active').reverse();
  if (past.length || gone.length) { nodes.push(N.section(W, '历史', { small: true })); past.forEach(p => nodes.push(proposalCard(app, W, p, true))); gone.forEach(l => nodes.push(lawFold(app, W, l))); }
  return nodes;
}
function archive(app, W) {
  const raw = app.state, s = scopedState(app), focus = raw && raw.cities && app.cityFocus ? raw.cities.find(c => c.id === app.cityFocus) : null;
  const top = { kind: 'title', title: focus ? '档案 · ' + ((focus.short && focus.short.zh) || focus.id) : '档案' };
  if (!raw) return { top, nodes: [N.empty(W, '正在连接这座城…')], tabbar: true, pull: true };
  const count = k => (s[k] || []).length;
  const islandLaws = raw.cities && !focus;
  const tabs = [['chronicle', '编年史'], ['laws', islandLaws ? '法典' : `法典 ${count('laws')}`], ['docs', `典籍 ${count('docs')}`], ['groups', `社群 ${count('groups')}`], ['cradle', `摇篮 ${count('cradle')}`]];
  const nodes = [N.button(W, '实验助手', { type: 'assistantOpen' }, { variant: 'secondary' }), N.button(W, '世界报告', { type: 'historyReports' }, { variant: 'secondary' }), N.chips(W, tabs.map(([v, l]) => ({ label: l, action: { type: 'archive', tab: v }, selected: app.archiveTab === v })))];
  if (app.archiveTab === 'chronicle') nodes.push(...chronicleNodes(app, W));
  else if (app.archiveTab === 'laws') {
    if (islandLaws) nodes.push(...cityComparison(app, W), N.text(W, '法典各城一套：点上面的城，或在观测页选一座城。', { style: 'meta', color: C.text3 }));
    else nodes.push(...lawSections(app, W, s));
  }
  else if (app.archiveTab === 'docs') { if (!count('docs')) nodes.push(N.empty(W, '还没有典籍')); (s.docs || []).forEach(d => nodes.push(docCard(W, d))); }
  else if (app.archiveTab === 'groups') {
    if (!count('groups')) nodes.push(N.empty(W, '城里还没有社群', '居民可以结成社群、订立章程。'));
    (s.groups || []).forEach(gp => nodes.push(N.card(W, iw => [N.text(iw, textOf(gp.name) || '一个社群', { style: 'heading', bold: true }), N.text(iw, `${(gp.members || []).length} 位成员${gp.dissolved ? ' · 已解散' : ''}`, { style: 'caption', color: C.text3 }), textOf(gp.purpose || gp.description) ? N.text(iw, textOf(gp.purpose || gp.description), { style: 'meta', color: C.text2, maxLines: 3 }) : null,
      gp.bylaws && !gp.dissolved ? N.text(iw, '章程' + (gp.bylaws.suspended ? '（停摆）' : '') + '：' + (view.reading(gp.bylaws) || '—'), { style: 'caption', color: C.text2, maxLines: 6 }) : null], { pad: 14, gap: 4 })));
  } else {
    if (!count('cradle')) nodes.push(N.empty(W, '摇篮里还没有灵魂', '居民孕育的灵魂会在这里等待领养。'));
    if ([6, 7].includes(s.world.premise) && count('cradle')) nodes.push(N.text(W, app.wechatVerified ? '领养后由你管理并配置模型。' : '登录后可以领养摇篮里的灵魂并配置模型。', { style: 'caption', color: C.text3 }));
    (s.cradle || []).forEach(c => nodes.push(N.card(W, iw => [
      N.text(iw, textOf(c.name) || '一个灵魂', { style: 'heading', bold: true }),
      N.text(iw, [(c.authors || []).filter(Boolean).map(a => usable(a.name) ? a.name : '').filter(Boolean).join('、') ? '作者 ' + (c.authors || []).filter(Boolean).map(a => usable(a.name) ? a.name : '').filter(Boolean).join('、') : '', c.generation !== undefined ? `第 ${c.generation} 代` : '', c.expiresDay !== undefined ? `还剩 ${Math.max(0, c.expiresDay - s.world.day)} 日` : ''].filter(Boolean).join(' · '), { style: 'caption', color: C.text3 }),
      contentOf(c.soul || c.bio || c.description) ? N.text(iw, contentOf(c.soul || c.bio || c.description), { style: 'meta', color: C.text2, maxLines: 4 }) : null,
      [6, 7].includes(s.world.premise) && app.wechatVerified ? N.button(iw, '领养', { type: 'stewardAdoptOpen', id: c.id }, { variant: 'secondary', size: 'small' }) : null,
    ], { pad: 14, gap: 4 })));
  }
  return { top, nodes, tabbar: true, pull: true };
}

function detail(app, W) {
  const data = app.detail || {}, kind = app.detailKind;
  const item = data.agent || data.law || data;
  const title = kind === 'place' ? (item.displayName && item.displayName.zh) || item.name : kind === 'doc' ? '《' + (textOf(item.title) || '典籍') + '》' : textOf(item.title || item.name);
  const nodes = [N.text(W, usable(title) ? title : '档案', { style: 'title', bold: true, serif: true, line: 32 })];
  if (kind === 'law') {
    nodes.push(N.button(W, '询问实验助手', { type: 'assistantOpen', lawId: item.id }, { variant: 'secondary' }));
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
