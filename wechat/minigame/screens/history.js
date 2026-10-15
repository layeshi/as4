const N = require('../ui/nodes');
const { C } = require('../ui/theme');
const { usable } = require('../utils/feed');
const label = value => usable(value) ? value : '文字暂未展示';
const kinds = { day: '日报', month: '月报', year: '年报' };
const status = r => r.status === 'ready' ? '已发布' : r.status === 'generating' ? '正在生成…' : r.status === 'failed' ? '待补生成' : r.reason === 'budget' ? '等待额度恢复' : '待生成';
const range = r => r.fromDay === r.toDay ? `第 ${r.fromDay + 1} 日` : `第 ${r.fromDay + 1}–${r.toDay + 1} 日`;
function login(app, W, title) {
  return { top: { kind: 'back', title }, tabbar: false, nodes: [N.empty(W, '登录后查看', '世界报告与居民历史仅对登录用户开放。'), N.button(W, '前往登录', { type: 'tab', tab: 'account' }, { variant: 'primary' })] };
}
function base(app, W, title) {
  const h = app.history; h.sync();
  if (!app.user) return login(app, W, title);
  const nodes = [];
  if (h.loading) nodes.push(N.text(W, '正在加载…', { style: 'meta', color: C.text3 }));
  if (h.error) nodes.push(N.banner(W, { title: '暂时无法读取', body: h.error, actions: [{ label: '重试', action: { type: 'historyRefresh' } }] }));
  if (app.needsWechatLogin) nodes.push(N.button(W, '前往微信登录', { type: 'tab', tab: 'account' }, { variant: 'secondary' }));
  if (app.pendingCount) nodes.push(N.text(W, '部分文字正在检查，暂未展示。可稍后刷新。', { style: 'caption', color: C.text3 }));
  return { top: { kind: 'back', title }, nodes, tabbar: false, pull: true };
}
function reports(app, W) {
  const page = base(app, W, '世界报告'); if (!app.user) return page;
  const h = app.history;
  page.nodes.push(N.text(W, 'AI 史官回顾世界，仅供人类观测。', { style: 'meta', color: C.text2 }), N.chips(W, Object.keys(kinds).map(kind => ({ label: kinds[kind], selected: h.kind === kind, action: { type: 'historyKind', kind } }))));
  if (h.branches.length > 1) page.nodes.push(N.chips(W, [{ label: '当前世界', selected: !h.reportBranchId, action: { type: 'historyReportBranch', id: '' } }, ...h.branches.map(b => ({ label: `${b.worldId} · ${b.id.slice(0, 6)}`, selected: h.reportBranchId === b.id, action: { type: 'historyReportBranch', id: b.id } }))]));
  if (!h.reports.length && !h.loading) page.nodes.push(N.empty(W, '尚无报告', '世界周期结束后自动生成，旧周期可由管理员补生成。'));
  for (const r of h.reports) page.nodes.push(N.card(W, iw => [N.text(iw, `${kinds[r.kind]} · ${range(r)}`, { style: 'meta', color: C.text3 }), N.text(iw, r.title ? label(r.title) : status(r), { style: 'heading', bold: true }), N.text(iw, 'AI 生成 · ' + status(r) + (r.partial ? ' · 未满一年' : ''), { style: 'caption', color: C.ai }), N.text(iw, `${r.worldId} · 分支 ${r.branchId.slice(0, 8)}`, { style: 'caption', color: C.text3 })], { action: r.status === 'ready' ? { type: 'historyReport', id: r.id } : null }));
  if (h.total > 30) page.nodes.push(N.buttonRow(W, [{ label: '上一页', action: { type: 'historyPage', delta: -1 }, variant: 'secondary' }, { label: '下一页', action: { type: 'historyPage', delta: 1 }, variant: 'secondary' }]));
  return page;
}
function worldReport(app, W) {
  const page = base(app, W, '世界报告'); if (!app.user) return page;
  const r = app.history.report; if (!r) { if (!app.history.loading) page.nodes.push(N.empty(W, '报告暂不可用', '下拉刷新后重试。')); return page; }
  const c = r.content; if (!c) { page.nodes.push(N.empty(W, status(r))); return page; }
  page.nodes.push(N.text(W, label(c.title), { style: 'title', bold: true }), N.text(W, `${kinds[r.kind]} · ${range(r)}${r.partial ? ' · 未满一年' : ''}`, { style: 'meta', color: C.text3 }), N.text(W, 'AI 生成 · 事实与分析分别展示', { style: 'caption', color: C.ai }), N.text(W, label(c.overview), { style: 'body' }));
  for (const [key, title] of [['facts', '历史事实'], ['analysis', 'AI 观察与分析']]) {
    page.nodes.push(N.section(W, title));
    for (const item of c[key] || []) if (usable(item.text)) page.nodes.push(N.card(W, iw => [N.text(iw, item.text, { style: 'body' }), N.text(iw, '来源：' + item.sources.map(id => id === 'period' ? '周期统计' : id.replace('event:', '事件 ')).join('、'), { style: 'caption', color: C.text3 })]));
  }
  page.nodes.push(N.section(W, '历史依据'), N.text(W, `${r.worldId} · 纪元 ${r.epoch} · ${r.branchId}`, { style: 'caption', color: C.text3 }));
  for (const s of r.sources || []) {
    const text = JSON.stringify(s, null, 2);
    if (/内容审核中|内容未通过安全检查|内容暂不可用|请微信登录后阅读|内容暂未展示/.test(text)) continue;
    page.nodes.push(N.card(W, iw => [N.text(iw, s.id === 'period' ? '周期统计' : s.id.replace('event:', '事件 '), { style: 'meta', color: C.moon }), N.text(iw, text, { style: 'meta', color: C.text2 })]));
  }
  return page;
}
function historyExport(app, W) {
  const page = base(app, W, '导出居民历史'); if (!app.user) return page;
  const h = app.history, branches = h.branches.filter(b => b.residents.length), b = branches.find(b => b.id === h.branchId);
  page.nodes.push(N.text(W, '下载 ZIP：HTML 时间线、JSON 历史、CSV 行动表。默认包含全部已保存历史。', { style: 'meta', color: C.text2 }));
  if (!branches.length && !h.loading) page.nodes.push(N.empty(W, '尚无可导出的居民', '创建或领养居民后可保存它的经历。'));
  if (branches.length) {
    page.nodes.push(N.section(W, '世界与历史分支'), N.chips(W, branches.map(x => ({ label: `${x.worldId} · ${x.id.slice(0, 6)}`, selected: h.branchId === x.id, action: { type: 'historyBranch', id: x.id } }))));
    page.nodes.push(N.section(W, '居民'), N.chips(W, (b?.residents || []).map(r => ({ label: label(r.name), selected: h.agentId === r.id, action: { type: 'historyResident', id: r.id } }))));
    page.nodes.push(N.field(W, '起始世界日（留空为全部）', app.form.historyFrom || '', { type: 'field', name: 'historyFrom', max: 9 }, { placeholder: '例如 1' }), N.field(W, '结束世界日（留空为当前）', app.form.historyTo || '', { type: 'field', name: 'historyTo', max: 9 }, { placeholder: '例如 24' }), N.button(W, '生成历史包', { type: 'historyCreate' }, { variant: 'primary' }));
  }
  page.nodes.push(N.button(W, '查看导出记录', { type: 'historyRecords' }, { variant: 'secondary' }), N.text(W, '只包含该居民有权知悉的记录。缺失内容如实说明，不包含模型内部推理。', { style: 'caption', color: C.text3 }));
  return page;
}
function exportsPage(app, W) {
  const page = base(app, W, '导出记录'); if (!app.user) return page;
  const h = app.history;
  page.nodes.push(N.text(W, '生成期间可以离开页面，下拉刷新查看最新状态。下载时仍会核验当前归属。', { style: 'meta', color: C.text2 }));
  if (!h.jobs.length && !h.loading) page.nodes.push(N.empty(W, '尚无导出记录'));
  for (const j of h.jobs) page.nodes.push(N.card(W, iw => [N.text(iw, label(j.name), { style: 'heading', bold: true }), N.text(iw, `${range(j)} · ${j.worldId} · ${j.branchId.slice(0, 8)}`, { style: 'caption', color: C.text3 }), N.text(iw, ({ queued: '等待生成', generating: '正在生成…', ready: '可下载', failed: '生成失败' })[j.status], { style: 'meta', color: j.status === 'ready' ? C.awake : C.text2 }), j.status === 'ready' ? N.button(iw, '下载 ZIP', { type: 'historyDownload', id: j.id }, { variant: 'secondary' }) : j.status === 'failed' ? N.button(iw, '重新生成', { type: 'historyRetry', id: j.id }, { variant: 'secondary' }) : null, h.saved?.id === j.id ? N.button(iw, '保存或分享文件', { type: 'historyShare' }, { variant: 'secondary' }) : null]));
  page.nodes.push(N.button(W, '刷新导出记录', { type: 'historyRefresh' }, { variant: 'secondary' })); return page;
}
module.exports = { reports, worldReport, historyExport, exports: exportsPage };
