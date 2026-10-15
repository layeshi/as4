import { h, clear } from './dom.js';
import { api, errorText } from './api.js';
import { initAccounts, refreshAccount, watchAccount } from './accounts.js';
import { mountShell, pageHead, card, emptyState, btn, chip, field, tr, request, setNotice } from './console-ui.js';

export async function mountHistory() {
  const head = document.getElementById('page-head'), root = document.getElementById('content'), message = document.getElementById('message');
  let version = 0, user = null, timer = null;
  const selectedId = new URLSearchParams(location.search).get('resident');
  mountShell(document.getElementById('console-header'), { active: 'history' }); setNotice(text => { message.textContent = text; });
  initAccounts(null, { onAccountChange: () => load() });
  watchAccount(next => { if (user && user.id !== next?.id) { version++; clear(root); user = next; load(); } });
  window.addEventListener('pagehide', () => clearTimeout(timer));
  async function load() {
    const current = ++version; clearTimeout(timer); clear(root).append(h('p', { class: 'muted', role: 'status' }, tr('正在加载…', 'Loading…')));
    pageHead(head, { eyebrow: tr('我的居民', 'My residents'), title: tr('居民历史', 'Resident history'), lead: tr('保存它的选择与经历。思维、行动和交流按世界时间归档。', 'Keep its choices and experiences, ordered by world time.'), back: { href: '/residents.html', label: tr('我的居民', 'My residents') }, actions: [btn(tr('刷新', 'Refresh'), load)] });
    try {
      const account = await refreshAccount({ notify: false }); if (current !== version) return;
      if (!account.ok) throw Error(tr('账号读取失败，请重试。', 'Unable to load your account.'));
      user = account.json.user;
      if (!user) { clear(root).append(emptyState(tr('登录后导出居民历史', 'Sign in to export resident history'), tr('只有当前造者可以下载居民的私人历史。', 'Only the current manager can download private resident history.'), h('a', { class: 'btn', href: '/login.html?next=' + encodeURIComponent(location.pathname + location.search) }, tr('登录 / 注册', 'Sign in / Register')))); return; }
      const response = await api('/api/history/branches'); if (current !== version) return;
      if (!response.ok) throw Error(errorText(response, tr('历史读取失败。', 'Unable to load history.')));
      clear(root); const branches = response.json.branches.filter(b => b.residents.length);
      const jobsRoot = h('div', { id: 'export-records' });
      if (!branches.length) root.append(emptyState(tr('还没有可导出的居民', 'No residents to export'), tr('创建或领养居民后，可以在这里保存它的历史。', 'Create or adopt a resident to save its history here.'), h('a', { class: 'btn', href: '/residents.html' }, tr('前往我的居民', 'My residents'))));
      else {
        const branch = h('select', { name: 'branchId' }, branches.map(b => h('option', { value: b.id, selected: b.active }, `${b.worldId} · ${tr('纪元', 'Era')} ${b.epoch} · ${b.id.slice(0, 8)}`))), resident = h('select', { name: 'agentId' });
        const from = field(tr('起始世界日（留空为全部）', 'First world day (optional)'), 'fromDay', '', 'number', { min: 1 });
        const to = field(tr('结束世界日（留空为当前）', 'Last world day (optional)'), 'toDay', '', 'number', { min: 1 });
        const range = () => { const b = branches.find(b => b.id === branch.value); clear(resident).append(...b.residents.map(r => h('option', { value: r.id, selected: r.id === selectedId }, r.name))); for (const f of [from, to]) f.querySelector('input').max = Math.floor(b.tick / b.ticksPerDay) + 1; };
        branch.addEventListener('change', range); range();
        const status = h('p', { role: 'status' }), submit = h('button', { type: 'submit', class: 'btn primary' }, tr('生成历史包', 'Generate history bundle'));
        const form = h('form', { class: 'form', onSubmit: async event => {
          event.preventDefault(); if (submit.disabled) return; submit.disabled = true; status.textContent = tr('正在提交…', 'Submitting…');
          const values = Object.fromEntries(new FormData(event.currentTarget));
          try {
            const result = await request('/api/history/exports', { branchId: values.branchId, agentId: values.agentId, ...(values.fromDay ? { fromDay: Number(values.fromDay) - 1 } : {}), ...(values.toDay ? { toDay: Number(values.toDay) - 1 } : {}), requestId: crypto.randomUUID() });
            if (current !== version) return; status.textContent = tr('已开始生成。可以离开页面，之后在导出记录中下载。', 'Generation started. You can leave and download it from export records later.');
            await jobs(jobsRoot, current);
          } catch (error) { if (current === version) status.textContent = error.message; }
          finally { submit.disabled = false; }
        } }, h('label', { class: 'field' }, tr('世界与历史分支', 'World and history branch'), branch), h('label', { class: 'field' }, tr('居民', 'Resident'), resident), h('div', { class: 'form-grid' }, from, to), h('div', { class: 'form-actions' }, submit), status);
        root.append(card(tr('导出历史', 'Export history'), tr('ZIP 包含 HTML 时间线、JSON 历史数据和 CSV 行动表。', 'ZIP includes an HTML timeline, JSON history and CSV action table.'), form,
          h('p', { class: 'muted' }, tr('成功与失败的尝试都会保留。旧记录缺失处如实标注，不包含模型内部推理过程。', 'Successful and failed attempts are included. Missing records are identified; internal model reasoning is excluded.'))));
      }
      root.append(card(tr('导出记录', 'Export records'), tr('过继后下载权限随当前归属变化。', 'Download access follows current ownership.'), jobsRoot)); await jobs(jobsRoot, current);
    } catch (error) { if (current === version) clear(root).append(emptyState(tr('暂时无法读取历史', 'History unavailable'), error.message, btn(tr('重试', 'Retry'), load))); }
  }
  async function jobs(target, current) {
    clearTimeout(timer);
    const result = await api('/api/history/exports'); if (current !== version) return;
    if (!result.ok) { clear(target).append(emptyState(tr('导出记录读取失败', 'Unable to load exports'), errorText(result, tr('请重试。', 'Please retry.')), btn(tr('重试', 'Retry'), load))); return; }
    clear(target); const items = result.json.exports;
    if (!items.length) target.append(h('p', { class: 'muted' }, tr('尚无导出记录。', 'No export records yet.')));
    for (const j of items) target.append(h('div', { class: 'list-item' }, h('div', { class: 'report-heading' }, h('strong', null, j.name), chip(({ queued: tr('等待生成', 'Queued'), generating: tr('正在生成…', 'Generating…'), ready: tr('可下载', 'Ready'), failed: tr('生成失败', 'Failed') })[j.status], j.status === 'ready' ? 'st-awake' : 'st-dormant')),
      h('p', { class: 'muted' }, `${tr('第', 'Days')} ${j.fromDay + 1}–${j.toDay + 1} ${tr('日', '')} · ${j.worldId} · ${j.branchId.slice(0, 8)}${j.records !== undefined ? ` · ${j.records} ${tr('条', 'records')}` : ''}`),
      j.status === 'ready' ? h('a', { class: 'btn', href: `/api/history/exports/${encodeURIComponent(j.id)}/download`, download: true }, tr('下载 ZIP', 'Download ZIP')) : j.status === 'failed' ? btn(tr('重新生成', 'Retry generation'), async () => { await request(`/api/history/exports/${encodeURIComponent(j.id)}/retry`, {}); await jobs(target, current); }) : null));
    if (items.some(j => ['queued', 'generating'].includes(j.status))) timer = setTimeout(() => { if (!document.hidden && current === version) jobs(target, current).catch(error => { message.textContent = error.message; }); }, 4000);
  }
  await load();
}
