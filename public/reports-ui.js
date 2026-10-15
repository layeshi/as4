import { h, clear, ai } from './dom.js';
import { api, errorText } from './api.js';
import { initAccounts, refreshAccount, watchAccount } from './accounts.js';
import { mountShell, pageHead, card, emptyState, btn, chip, metrics, tr, setNotice } from './console-ui.js';

export const reportKind = kind => ({ day: tr('日报', 'Daily'), month: tr('月报', 'Monthly'), year: tr('年报', 'Yearly') })[kind] ?? kind;
export const reportStatus = r => r.status === 'ready' ? tr('已发布', 'Published') : r.status === 'failed' ? tr('待补生成', 'Needs retry') : r.status === 'generating' ? tr('正在生成…', 'Generating…') : r.reason === 'budget' ? tr('等待额度恢复', 'Waiting for budget') : tr('待生成', 'Pending');
export const reportRange = r => r.fromDay === r.toDay ? tr(`第 ${r.fromDay + 1} 日`, `Day ${r.fromDay + 1}`) : tr(`第 ${r.fromDay + 1}–${r.toDay + 1} 日`, `Days ${r.fromDay + 1}–${r.toDay + 1}`);
export async function mountReports() {
  const header = document.getElementById('console-header'), head = document.getElementById('page-head'), message = document.getElementById('message'), root = document.getElementById('content');
  let generation = 0, kind = 'day', branchId = '', page = 1, user = null;
  const id = new URLSearchParams(location.search).get('id');
  mountShell(header, { active: 'reports' }); setNotice(text => { message.textContent = text; });
  initAccounts(null, { onAccountChange: () => load() });
  watchAccount(next => { if (user && next?.id !== user.id) { generation++; clear(root); user = next; load(); } });
  async function load() {
    const current = ++generation; clear(root).append(h('p', { class: 'muted', role: 'status' }, tr('正在加载…', 'Loading…')));
    pageHead(head, { eyebrow: tr('人类观测', 'Observation'), title: tr('世界报告', 'World reports'), lead: tr('由 AI 史官整理的世界回顾。事实附来源，分析单独标注。', 'AI chronicles with historical sources and clearly labeled analysis.'), back: { href: '/', label: tr('观测城市', 'Observe') }, actions: [btn(tr('刷新', 'Refresh'), load)] });
    try {
      const account = await refreshAccount({ notify: false, redirect: false }); if (current !== generation) return;
      if (!account.ok) throw Error(tr('无法读取账号，请重试。', 'Unable to load your account. Retry.'));
      user = account.json.user;
      if (!user) { clear(root).append(emptyState(tr('登录后阅读世界报告', 'Sign in to read world reports'), tr('按世界日、月、年回顾文明的变化。10 个世界月为一年。', 'Follow daily, monthly and yearly changes. A world year has ten months.'), h('a', { class: 'btn', href: '/login.html?next=' + encodeURIComponent(location.pathname + location.search) }, tr('登录 / 注册', 'Sign in / Register')))); return; }
      const result = await api(id ? `/api/reports/${encodeURIComponent(id)}` : `/api/reports?kind=${kind}&page=${page}${branchId ? '&branchId=' + encodeURIComponent(branchId) : ''}`);
      if (current !== generation) return; if (!result.ok) throw Error(errorText(result, tr('报告读取失败。', 'Unable to load reports.')));
      clear(root);
      if (id) { renderReport(result.json); return; }
      const branches = await api('/api/history/branches'); if (current !== generation) return;
      const tabs = h('nav', { class: 'subtabs', 'aria-label': tr('报告类型', 'Report type') }, ['day', 'month', 'year'].map(value => h('button', { class: 'subtab', type: 'button', 'aria-selected': String(kind === value), onClick: () => { kind = value; page = 1; load(); } }, reportKind(value))));
      const selector = h('select', { 'aria-label': tr('世界与历史分支', 'World and history branch'), onChange: e => { branchId = e.target.value; page = 1; load(); } }, h('option', { value: '', selected: branchId === '' }, tr('当前世界与分支', 'Current world and branch')), h('option', { value: 'all', selected: branchId === 'all' }, tr('全部世界与分支', 'All worlds and branches')), (branches.json?.branches ?? []).map(b => h('option', { value: b.id, selected: b.id === branchId }, `${b.worldId} · ${tr('纪元', 'Era')} ${b.epoch} · ${b.id.slice(0, 8)}`)));
      root.append(h('div', { class: 'history-toolbar' }, tabs, selector));
      const rows = result.json.reports;
      if (!rows.length) root.append(emptyState(tr('这个周期还没有报告', 'No reports yet'), tr('周期结束后自动生成。旧周期可由管理员按需补生成。', 'Reports follow completed periods. Administrators can generate older reports.')));
      for (const r of rows) root.append(card(null, null, h('div', { class: 'report-heading' }, h('p', { class: 'eyebrow' }, `${reportKind(r.kind)} · ${reportRange(r)}`), chip(reportStatus(r), r.status === 'ready' ? 'st-awake' : 'st-dormant')),
        h('h2', null, r.title ? ai(r.title) : tr('正在等待 AI 史官', 'Waiting for the AI chronicler')),
        h('p', { class: 'muted' }, `${r.worldId} · ${tr('纪元', 'Era')} ${r.epoch} · ${r.branchId.slice(0, 8)}${r.partial ? tr(' · 未满一年', ' · Partial year') : ''}`),
        r.status === 'ready' ? h('a', { class: 'btn', href: `/reports.html?id=${encodeURIComponent(r.id)}` }, tr('阅读报告 →', 'Read report →')) : h('p', { class: 'muted' }, tr('后台生成不影响世界运转，稍后可回来查看。', 'Generation runs in the background. Check back later.'))));
      if (result.json.total > 30) root.append(h('div', { class: 'form-actions' }, page > 1 ? btn(tr('上一页', 'Previous'), () => { page--; load(); }) : null, h('span', { class: 'muted' }, `${page} / ${Math.ceil(result.json.total / 30)}`), page * 30 < result.json.total ? btn(tr('下一页', 'Next'), () => { page++; load(); }) : null));
    } catch (error) { if (current === generation) clear(root).append(emptyState(tr('暂时无法读取报告', 'Reports unavailable'), error.message, btn(tr('重试', 'Retry'), load))); }
  }
  function renderReport(r) {
    root.append(h('a', { class: 'back-link', href: '/reports.html' }, tr('← 全部报告', '← All reports')));
    if (r.status !== 'ready') { root.append(emptyState(reportStatus(r), tr('报告正在后台处理，请稍后刷新。', 'The report is being processed. Refresh later.'))); return; }
    const data = r.content, summary = r.sources.find(s => s.id === 'period');
    root.append(card(data.title, `${reportKind(r.kind)} · ${reportRange(r)}${r.partial ? tr(' · 未满一年', ' · Partial year') : ''}`, h('p', { class: 'ai-note' }, tr('AI 生成 · 事实与分析分别展示', 'AI generated · Facts and analysis are shown separately')), h('p', { class: 'report-prose' }, ai(data.overview)), metrics([[tr('覆盖世界日', 'World days'), r.toDay - r.fromDay + 1], [tr('公开事件', 'Public events'), Object.values(summary?.eventCounts ?? {}).reduce((n, v) => n + v, 0)], [tr('历史分支', 'History branch'), r.branchId.slice(0, 8)]])));
    const section = (title, items) => card(title, null, ...items.map(item => h('article', { class: 'report-entry' }, h('p', { class: 'report-prose' }, ai(item.text)), h('div', { class: 'form-actions' }, item.sources.map(source => h('a', { class: 'link', href: `#source-${source.replaceAll(':', '-')}` }, `${tr('来源', 'Source')} ${source === 'period' ? tr('周期统计', 'Period statistics') : source.replace('event:', tr('事件 ', 'Event '))}`))))));
    root.append(section(tr('历史事实', 'Historical facts'), data.facts), section(tr('AI 观察与分析', 'AI observations and analysis'), data.analysis));
    root.append(card(tr('历史依据', 'Historical sources'), `${r.worldId} · ${tr('纪元', 'Era')} ${r.epoch} · ${r.branchId}`, h('p', { class: 'muted' }, r.sampledSources ? tr('统计覆盖整个周期，正文使用其中的代表性事件。', 'Statistics cover the whole period; prose uses representative events.') : tr('以下记录是报告引用的公开资料。', 'These are the public records cited by this report.')),
      ...r.sources.map(s => h('details', { class: 'list-item', id: `source-${s.id.replaceAll(':', '-')}` }, h('summary', null, s.id === 'period' ? tr('周期统计', 'Period statistics') : s.id.replace('event:', tr('事件 ', 'Event '))), h('pre', null, JSON.stringify(s, null, 2))))));
  }
  await load();
}
