// 实验助手：对话工作台。问和答是主角；对话列表、问题范围与额度平时收起或缩成一行
// （docs/plans/2026-10-18-assistant-page-redesign.md）。
// 密钥与草稿只在页面内存里，切到后台即清除；显示、打开依据和追问时服务端都会复核权限。

import { h, clear } from './dom.js';
import { initAccounts, refreshAccount, watchAccount } from './accounts.js';
import { mountShell, btn, chip, tr, setNotice } from './console-ui.js';
import { openModal } from './modals.js';
import { AssistantClient, questionScope } from './assistant-client.js';
import { renderAnswer, citeChip, caretNode } from './assistant-markdown.js';

const LIMIT = 4000;
const DEFAULT_SCOPE = { mode: 'public', agentId: '', branchId: '', city: '', fromDay: '', toDay: '' };

const pad = (n) => String(n).padStart(2, '0');
/** 本地时间：今天写「15:26」，更早写「10-17」；full 时更早的写「10-17 09:37」 */
function when(iso, full = false) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === new Date().toDateString()) return time;
  const date = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return full ? `${date} ${time}` : date;
}
const dayText = (n) => tr(`第 ${n} 日`, `Day ${n}`);
const epochText = (n) => tr(`第 ${n} 纪`, `Epoch ${n}`);
const asOf = (iso) => tr(`截至 ${when(iso, true)}`, `As of ${when(iso, true)}`);
const modes = () => [['public', tr('公开记录', 'Public records')], ['resident', tr('我的居民私人记录', 'My residents’ private records')], ['research', tr('管理员私人研究', 'Administrator research')]];
const cityList = (status) => (status?.world?.cities || []).map((c) => (typeof c === 'string' ? { id: c, name: c } : { id: c.id, name: typeof c.name === 'string' ? c.name : c.name?.zh || c.id }));
const titleText = (title) => (!title || title === '实验对话' ? tr('实验对话', 'Conversation') : title);
const errorText = (error) => (typeof error === 'string' ? error : error?.message || error?.code || '');

export async function mountAssistant() {
  const root = document.getElementById('content'), notice = document.getElementById('message');
  const client = new AssistantClient(), params = new URLSearchParams(location.search);
  const fields = { ...DEFAULT_SCOPE, agentId: params.get('agentId') || '', lawId: params.get('lawId') || '', branchId: params.get('branchId') || '' };
  let draft = '', busy = false, timer, suspended = false, loadVersion = 0, admin = false;
  let view = null, scopeOpen = false, follow = true, shownThread = null, shownSessions = null, source = null, confirmBox = null;
  const say = (text) => { notice.textContent = text || ''; };
  mountShell(document.getElementById('console-header'), { active: 'assistant' });
  setNotice(say);

  function closeSource() { const open = source; source = null; client.source = null; open?.modal.close(); }
  function closeConfirm() { const open = confirmBox; confirmBox = null; open?.close(); }
  function purge() { loadVersion++; clearTimeout(timer); closeSource(); closeConfirm(); client.reset(); draft = ''; busy = false; scopeOpen = false; follow = true; view = null; shownThread = shownSessions = null; clear(root); }
  const stopWatching = watchAccount((user) => { if ((user?.id || null) !== client.owner) { purge(); client.account(user?.id || null); if (!suspended) load(); } });
  initAccounts(null, { onAccountChange: () => { purge(); if (!suspended) load(); } });

  async function run(action) {
    if (busy) return;
    const lifecycle = loadVersion;
    busy = true; say(''); paintComposer();
    try { await action(); }
    catch (error) {
      if (lifecycle !== loadVersion) return;
      say(error.message + (error.resetAt ? ' · ' + new Date(error.resetAt).toLocaleString() : ''));
      if ([401, 403].includes(error.status)) { closeSource(); client.conversation = null; client.lastQuestion = null; client.keys = {}; renderScope(); if (error.status === 401) { client.account(null); await load(); } }
    } finally { if (lifecycle === loadVersion) { busy = false; paint(); } }
  }
  async function load() {
    const v = ++loadVersion;
    if (!root.firstChild) center(h('p', { class: 'muted' }, tr('正在加载…', 'Loading…')));
    try {
      const account = await refreshAccount({ notify: false, redirect: false });
      if (v !== loadVersion || suspended) return;
      if (!account.ok) throw Error(tr('无法读取账号，请刷新重试。', 'Unable to load your account. Refresh to retry.'));
      const user = account.json.user || null;
      client.account(user?.id || null);
      admin = user?.role === 'admin';
      await client.statusRead(); if (v !== loadVersion || suspended) return;
      if (!client.owner || !client.status?.signedIn) guest(); else build();
    } catch (error) { if (v === loadVersion) { center(btn(tr('重新加载', 'Reload'), load)); say(error.message); } }
  }
  /** 只有一块居中的内容：加载中、出错、未登录 */
  function center(...kids) { view = null; shownThread = shownSessions = null; clear(root).append(h('div', { class: 'assistant-center' }, notice, ...kids)); }
  function guest() {
    center(h('h1', { class: 'assistant-empty' }, tr('登录后向实验提问', 'Sign in to ask the experiment')), h('a', { class: 'btn', href: '/login.html?next=' + encodeURIComponent(location.pathname + location.search) }, tr('登录 / 注册', 'Sign in / Register')));
  }

  // ── 骨架：对话列表、工具条、问答流、提问区。只建一次，之后只更新内容，输入框与焦点不被打断 ──
  function build() {
    const v = {};
    v.newButton = h('button', { type: 'button', class: 'btn assistant-new', onClick: startNew }, tr('＋ 新对话', '+ New conversation'));
    v.sessions = h('ul', { class: 'assistant-sessions' });
    v.sidebar = h('aside', { id: 'assistant-list', class: 'assistant-sidebar', 'aria-label': tr('对话列表', 'Conversations'), onKeydown: (e) => { if (e.key === 'Escape' && drawerOpen()) { e.preventDefault(); drawer(false); } } }, v.newButton, v.sessions);
    v.scrim = h('div', { class: 'assistant-scrim', onClick: () => drawer(false) });
    v.toggle = h('button', { type: 'button', class: 'assistant-tool assistant-toggle', 'aria-controls': 'assistant-list', 'aria-expanded': 'false', onClick: () => drawer(!drawerOpen()) }, tr('对话', 'Chats'));
    v.title = h('h1', { class: 'assistant-title' });
    v.flags = h('div', { class: 'assistant-flags' });
    v.refresh = h('button', { type: 'button', class: 'assistant-tool', onClick: refresh }, tr('刷新', 'Refresh'));
    v.remove = h('button', { type: 'button', class: 'assistant-tool', onClick: removeConversation }, tr('删除', 'Delete'));
    v.thread = h('div', { class: 'assistant-thread' });
    v.stream = h('div', { class: 'assistant-stream', tabindex: '0', 'aria-label': tr('问答', 'Questions and answers'), onScroll: () => { follow = atBottom(); v.latest.hidden = follow; } }, v.thread);
    v.latest = h('button', { type: 'button', class: 'btn small assistant-latest', hidden: true, onClick: () => { follow = true; bottom(); } }, tr('回到最新 ↓', 'Latest ↓'));
    v.scopeRow = h('div', { class: 'assistant-scope-row' });
    v.panel = h('div', { id: 'assistant-scope', class: 'assistant-scope-panel', hidden: true });
    v.input = h('textarea', {
      rows: 1, maxlength: LIMIT, value: draft, 'aria-label': tr('你的问题', 'Your question'), placeholder: tr('例如：三城公库最近为什么差这么多？', 'e.g. Why have the three treasuries drifted apart?'),
      onInput: () => { draft = v.input.value; grow(); paintComposer(); },
      // Enter 发送，Shift+Enter 换行；输入法组字时的 Enter 只是选字
      onKeydown: (e) => { if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing || e.keyCode === 229) return; e.preventDefault(); ask(); },
    });
    v.submit = h('button', { type: 'submit', class: 'btn primary assistant-send' }, tr('提问', 'Ask'));
    v.quota = h('p', { class: 'assistant-quota' });
    v.counter = h('span', { class: 'assistant-counter', hidden: true });
    v.form = h('form', {
      class: 'assistant-composer',
      onSubmit: (e) => { e.preventDefault(); if (client.active) stop(); else ask(); },
      onKeydown: (e) => { if (e.key === 'Escape' && scopeOpen) { e.preventDefault(); scope(false); } },
    }, h('div', { class: 'assistant-composer-inner' }, notice, v.scopeRow, v.panel, h('div', { class: 'assistant-input' }, v.input, v.submit), h('div', { class: 'assistant-meta' }, v.quota, v.counter)));
    v.workbench = h('div', { class: 'assistant-workbench' }, v.sidebar, v.scrim, h('section', { class: 'assistant-chat' },
      h('header', { class: 'assistant-toolbar' }, v.toggle, v.title, v.flags, h('div', { class: 'assistant-tools' }, v.refresh, v.remove)),
      h('div', { class: 'assistant-stream-wrap' }, v.stream, v.latest),
      v.form));
    view = v; shownThread = shownSessions = null;
    clear(root).append(v.workbench);
    renderScope(); paint(); grow();
  }
  const drawerOpen = () => !!view?.workbench.classList.contains('drawer-open');
  /** 手机上的对话列表抽屉；桌面宽度下这个状态不起作用 */
  function drawer(open) {
    if (!view) return;
    const was = drawerOpen();
    view.workbench.classList.toggle('drawer-open', open);
    view.toggle.setAttribute('aria-expanded', String(open));
    if (open && !was) view.newButton.focus();
    if (!open && was) view.toggle.focus();
  }
  const atBottom = () => { const s = view?.stream; return !s || !(s.scrollHeight > 0) || s.scrollHeight - s.scrollTop - s.clientHeight < 48; };
  function bottom() { const s = view?.stream; if (s && s.scrollHeight > 0) s.scrollTop = s.scrollHeight; if (view) view.latest.hidden = true; }
  /** 输入框随内容长高，到 8 行（CSS 的 max-height）后在框内滚动 */
  function grow() {
    const input = view?.input;
    if (!input?.style || !(input.scrollHeight > 0)) return;
    input.style.setProperty('height', 'auto');
    input.style.setProperty('height', `${input.scrollHeight + 2}px`);
  }

  // ── 动作 ──
  function startNew() {
    clearTimeout(timer); closeSource();
    client.version++; client.conversation = null; client.questionId = null; client.lastQuestion = null;
    follow = true; drawer(false); paint(); view?.input.focus();
  }
  function openConversation(id) {
    drawer(false);
    run(async () => { clearTimeout(timer); closeSource(); client.questionId = null; follow = true; await client.open(id); poll(); });
  }
  const canAsk = () => !!client.status?.available && (client.status.quota?.remaining ?? 1) > 0;
  function ask() {
    const text = draft.trim();
    if (!view || busy || client.active || !text || !canAsk()) return;
    run(async () => {
      await client.ask(text, questionScope(fields));
      draft = ''; view.input.value = ''; grow();
      follow = true; scopeOpen = false; renderScope();
      await refreshStatus(); poll();
    });
  }
  function stop() { run(async () => { const id = client.conversation?.id; await client.cancel(); if (id) await client.open(id); poll(); }); }
  function refresh() { const id = client.conversation?.id; if (id) run(async () => { await client.open(id); poll(); }); }
  function retry(m, conversation) {
    run(async () => {
      const index = conversation.messages.indexOf(m);
      const q = conversation.messages.slice(0, index).findLast((x) => x.role === 'user');
      if (!q?.text) throw Error(tr('问题不可访问，请重新输入。', 'Question unavailable. Enter it again.'));
      await client.ask(q.text, m.scope || questionScope(fields));
      follow = true;
      await refreshStatus(); poll();
    });
  }
  function removeConversation() {
    const conversation = client.conversation;
    if (!conversation) return;
    closeConfirm();
    const modal = openModal(tr('删除这段对话？', 'Delete this conversation?'), '', () => { if (confirmBox === modal) confirmBox = null; });
    confirmBox = modal;
    const cancel = h('button', { type: 'button', class: 'btn', onClick: closeConfirm }, tr('取消', 'Cancel'));
    modal.body.append(h('div', { class: 'form-actions assistant-confirm' },
      h('button', { type: 'button', class: 'btn danger', onClick: () => { closeConfirm(); run(async () => { clearTimeout(timer); closeSource(); await client.remove(conversation.id); follow = true; await refreshStatus(); }); } }, tr('删除', 'Delete')),
      cancel));
    cancel.focus();
  }
  function showSource(s) {
    run(async () => {
      closeSource();
      await client.readSource(s.id);
      if (!client.source || suspended || !view) return;
      const modal = openModal(client.source.title || tr('依据', 'Source'), 'wide', () => { if (source?.modal === modal) { source = null; client.source = null; } });
      source = { id: s.id, modal, meta: h('p', { class: 'assistant-source-meta' }), text: h('pre', { class: 'assistant-source-text' }) };
      modal.body.append(source.meta, source.text);
      fillSource(client.source);
    });
  }
  function fillSource(src) {
    source.meta.textContent = [src.worldId && tr(`世界 ${src.worldId}`, `World ${src.worldId}`), src.epoch != null && epochText(src.epoch), src.branchId && tr(`分支 ${src.branchId.slice(0, 8)}`, `Branch ${src.branchId.slice(0, 8)}`), Number.isFinite(src.day) && dayText(src.day + 1), src.observedAt && asOf(src.observedAt)].filter(Boolean).join(' · ');
    source.meta.setAttribute('title', src.branchId || '');
    source.text.textContent = src.text ?? '';
    // 结构化记录（JSON）用等宽小字，文字记录用正文字体
    source.text.classList.toggle('structured', /^\s*[[{]/.test(src.text ?? ''));
  }
  async function refreshStatus() { await client.statusRead(); }
  function poll() {
    clearTimeout(timer);
    if (!client.conversation || suspended) return;
    const id = client.conversation.id;
    // 回答完成后也定时复核权限，不让私人回答一直留在页面上
    timer = setTimeout(async () => {
      if (busy) { poll(); return; }
      const lifecycle = loadVersion;
      busy = true;
      try {
        const sourceId = source?.id;
        await client.open(id);
        if (sourceId && source) { await client.readSource(sourceId); if (client.source && source) fillSource(client.source); else closeSource(); }
        if (!client.active) await refreshStatus();
        poll();
      } catch (error) { if (lifecycle === loadVersion) { closeSource(); say(error.message); } }
      finally { if (lifecycle === loadVersion) { busy = false; paint(); } }
    }, client.active ? 1200 : 15000);
  }

  // ── 画内容 ──
  function paint() {
    if (!view || suspended) return;
    paintSessions(); paintToolbar(); paintThread(); paintComposer();
  }
  function paintSessions() {
    const list = client.status?.conversations || [], current = client.conversation?.id || null;
    const key = JSON.stringify([list, current]);
    if (key === shownSessions) return;
    shownSessions = key;
    clear(view.sessions).append(...list.map((c) => h('li', null, h('button', { type: 'button', class: 'assistant-session', 'aria-current': c.id === current ? 'true' : null, onClick: () => openConversation(c.id) },
      h('span', { class: 'assistant-session-title' }, titleText(c.title)),
      h('time', { class: 'assistant-session-time', datetime: c.updatedAt }, when(c.updatedAt))))));
  }
  function paintToolbar() {
    if (!view) return;
    const c = client.conversation, w = client.status?.world || {}, b = fields.branchId ? branchOf(fields.branchId) : null;
    view.title.textContent = c ? titleText(c.title) : tr('新对话', 'New conversation');
    clear(view.flags).append(...[
      w.ended ? chip(tr('已结束', 'Ended')) : w.paused ? chip(tr('世界已暂停', 'World paused'), 'warn') : null,
      b && !b.active ? chip(tr('历史分支', 'History branch'), 'warn') : null,
    ].filter(Boolean));
    view.refresh.hidden = view.remove.hidden = !c;
  }
  function paintThread() {
    const c = client.conversation, key = c ? JSON.stringify(c) : '';
    if (key === shownThread) return;
    shownThread = key;
    clear(view.thread);
    view.thread.classList.toggle('blank', !c);
    if (!c) { view.thread.append(h('p', { class: 'assistant-empty' }, tr('向实验提问', 'Ask the experiment'))); return; }
    for (const m of c.messages || []) view.thread.append(m.role === 'user' ? question(m) : answer(m, c));
    if (follow) bottom(); else view.latest.hidden = atBottom();
  }
  const question = (m) => h('article', { class: 'assistant-question', 'aria-label': tr('你的问题', 'Your question') }, m.status === 'withheld' ? h('span', { class: 'muted' }, tr('问题未展示', 'Question not shown')) : m.text);
  function answer(m, c) {
    const live = m.status === 'generating', body = [];
    const action = (text, fn) => h('button', { type: 'button', class: 'link', onClick: fn }, text);
    const retryButton = () => action(tr('重试（计 1 次）', 'Retry (counts 1)'), () => retry(m, c));
    const callout = (tone, text, ...actions) => h('div', { class: `callout ${tone} assistant-callout`.replace(/\s+/g, ' '), role: 'status' }, h('span', null, text), actions);
    if (m.status === 'pending') body.push(h('p', { class: 'muted' }, tr('内容审核中', 'Awaiting content review')));
    else if (m.status === 'withheld') body.push(callout('warn', tr('内容未展示：权限已变化或审核未通过', 'Not shown: access changed or review did not pass'), action(tr('刷新', 'Refresh'), refresh), retryButton()));
    else if (m.status === 'failed') body.push(callout('bad', [tr('生成失败', 'Generation failed'), errorText(m.error)].filter(Boolean).join(' · '), retryButton()));
    else {
      if (m.text) body.push(renderAnswer(m.text, { sources: m.sources || [], onSource: showSource, caret: live }));
      else if (live) body.push(h('p', { class: 'muted' }, tr('正在生成…', 'Generating…'), caretNode()));
      if (m.status === 'cancelled') body.push(callout('', tr('已停止 · 回答不完整', 'Stopped · Incomplete answer'), retryButton()));
    }
    // 只有真的显示了模型写的字（或正在写）才挂「AI 生成」和 AI 底色；失败、未展示、审核中只是一条提示
    const ai = live || (['complete', 'cancelled'].includes(m.status) && !!m.text);
    return h('article', { class: ai ? 'assistant-answer' : 'assistant-answer assistant-notice', 'aria-label': ai ? tr('AI 回答', 'AI answer') : tr('回答', 'Answer'), 'aria-busy': live ? 'true' : null },
      ai ? h('span', { class: 'ai-note' }, tr('AI 生成', 'AI generated')) : null, body, ai && !live ? foot(m) : null);
  }
  /** 回答底部一行：依据 S1 S2 · 第 12 日 · 截至 09:37；悬停看世界、纪元与分支全称 */
  function foot(m) {
    const o = m.observation, sources = m.sources || [], parts = [];
    if (sources.length) parts.push(h('span', { class: 'assistant-foot-sources' }, tr('依据', 'Sources'), sources.map((s) => citeChip(s, showSource))));
    if (o && Number.isFinite(o.day)) parts.push(dayText(o.day + 1));
    if (o?.observedAt) parts.push(asOf(o.observedAt));
    if (!parts.length) return null;
    const title = o ? [o.worldId && tr(`世界 ${o.worldId}`, `World ${o.worldId}`), o.epoch != null && epochText(o.epoch), o.branchId && tr(`分支 ${o.branchId}`, `Branch ${o.branchId}`)].filter(Boolean).join(' · ') : '';
    return h('p', { class: 'assistant-foot', title: title || null }, parts.flatMap((p, k) => (k ? [' · ', p] : [p])));
  }
  function paintComposer() {
    if (!view) return;
    const status = client.status || {}, q = status.quota, active = client.active;
    const exhausted = !!q && q.remaining <= 0, closed = !status.available || exhausted;
    view.input.disabled = closed;
    view.submit.textContent = active ? tr('停止', 'Stop') : tr('提问', 'Ask');
    view.submit.className = active ? 'btn assistant-send' : 'btn primary assistant-send';
    view.submit.disabled = active ? false : busy || closed || !draft.trim();
    view.counter.hidden = LIMIT - draft.length >= 400;
    view.counter.textContent = `${draft.length.toLocaleString('en-US')} / ${LIMIT.toLocaleString('en-US')}`;
    view.quota.classList.toggle('warn', closed);
    view.quota.textContent = !status.available ? tr('助手暂不可用', 'Assistant unavailable')
      : exhausted ? tr('今日次数已用完 · 北京时间零点恢复', 'No questions left today · Resets at midnight Beijing time')
        : q ? tr(`今日剩余 ${q.remaining} / ${q.limit} 次 · 北京时间零点恢复 · 失败、停止和重试也计次`, `Remaining today ${q.remaining} / ${q.limit} · Resets at midnight Beijing time · Failures, stops and retries count`) : '';
  }

  // ── 问题范围：平时一行摘要，点开编辑 ──
  const branchOf = (id) => (client.status?.branches || []).find((b) => (id ? b.id === id : b.active)) || null;
  const legacyBranch = (b) => !(b?.premise >= 6);
  const residentName = (id) => [...(branchOf(fields.branchId)?.residents || []), ...(client.status?.residents || [])].find((r) => r.id === id)?.name || id;
  /** 记录类别：管理员私人研究只给管理员；第六前提以后的分支里你不管理任何居民时不给私人记录 */
  function availableModes() {
    const b = branchOf(fields.branchId);
    return modes().filter(([id]) => (id !== 'research' || admin) && (id !== 'resident' || legacyBranch(b) || (b?.residents || []).some((r) => r.managed)));
  }
  function summaryText() {
    const parts = [], b = fields.branchId ? branchOf(fields.branchId) : null;
    if (b && !b.active) parts.push(tr(`历史分支 ${b.id.slice(0, 8)}`, `Branch ${b.id.slice(0, 8)}`));
    const city = cityList(client.status).find((c) => c.id === fields.city);
    if (city) parts.push(city.name);
    const from = String(fields.fromDay ?? '').trim(), to = String(fields.toDay ?? '').trim();
    if (from && to) parts.push(from === to ? dayText(from) : tr(`第 ${from}–${to} 日`, `Days ${from}–${to}`));
    else if (from) parts.push(tr(`第 ${from} 日起`, `From day ${from}`));
    else if (to) parts.push(tr(`至第 ${to} 日`, `Through day ${to}`));
    if (fields.mode === 'public' && !parts.length) return tr('范围：全部公开记录', 'Scope: all public records');
    return [modes().find(([id]) => id === fields.mode)?.[1], ...parts].join(' · ');
  }
  function scope(open) {
    scopeOpen = open;
    renderScope();
    view?.scopeRow.querySelector('.assistant-scope-summary')?.focus();
  }
  /** 重画摘要、带入的标签与面板；focus 是面板里要找回焦点的控件名 */
  function renderScope(focus) {
    if (!view) return;
    if (!availableModes().some(([id]) => id === fields.mode)) fields.mode = 'public';
    const tag = (text, label, drop) => h('span', { class: 'chip assistant-tag' }, h('span', null, text), h('button', { type: 'button', class: 'assistant-tag-clear', 'aria-label': label, onClick: () => { drop(); renderScope(); } }, '×'));
    clear(view.scopeRow).append(...[
      h('button', { type: 'button', class: 'assistant-scope-summary', 'aria-expanded': String(scopeOpen), 'aria-controls': 'assistant-scope', onClick: () => scope(!scopeOpen) },
        h('span', { class: 'assistant-scope-text' }, summaryText()), h('span', { class: 'assistant-chevron', 'aria-hidden': 'true' }, scopeOpen ? '▴' : '▾')),
      fields.agentId ? tag(tr(`居民 ${residentName(fields.agentId)}`, `Resident ${residentName(fields.agentId)}`), tr('清除居民', 'Clear resident'), () => { fields.agentId = ''; }) : null,
      fields.lawId ? tag(tr(`法律 ${fields.lawId}`, `Law ${fields.lawId}`), tr('清除法律', 'Clear law'), () => { fields.lawId = ''; }) : null,
    ].filter(Boolean));
    view.panel.hidden = !scopeOpen;
    clear(view.panel);
    if (scopeOpen) view.panel.append(...scopePanel());
    if (focus) view.panel.querySelector(`[name="${focus}"]`)?.focus();
    paintToolbar();
  }
  function scopePanel() {
    const status = client.status || {}, b = branchOf(fields.branchId);
    const select = (name, label, key, options) => h('label', { class: 'field' }, h('span', null, label), h('select', {
      name,
      onChange: (e) => {
        fields[key] = e.target.value;
        if (key === 'branchId' && fields.agentId && !(branchOf(fields.branchId)?.residents || []).some((r) => r.id === fields.agentId)) fields.agentId = '';
        renderScope(name);
      },
    }, options.map(([value, text]) => h('option', { value, selected: fields[key] === value }, text))));
    const head = h('div', { class: 'assistant-scope-head' },
      h('div', { class: 'field' }, h('span', { id: 'assistant-mode-label' }, tr('记录类别', 'Record type')),
        h('div', { class: 'assistant-segments', role: 'group', 'aria-labelledby': 'assistant-mode-label' }, availableModes().map(([id, text]) => h('button', {
          type: 'button', name: `mode-${id}`, class: 'assistant-segment', 'aria-pressed': String(fields.mode === id), onClick: () => { fields.mode = id; renderScope(`mode-${id}`); },
        }, text)))),
      h('div', { class: 'assistant-scope-actions' },
        h('button', { type: 'button', name: 'reset', class: 'assistant-tool', onClick: () => { Object.assign(fields, DEFAULT_SCOPE); client.keys = {}; renderScope('reset'); } }, tr('恢复默认', 'Reset')),
        h('button', { type: 'button', class: 'assistant-tool', onClick: () => scope(false) }, tr('收起', 'Done'))));
    const grid = h('div', { class: 'assistant-scope-grid' });
    const history = (status.branches || []).filter((x) => !x.active);
    if (history.length || fields.branchId) grid.append(select('branch', tr('世界与分支', 'World and branch'), 'branchId', [['', tr(`当前世界 · 第 ${status.world?.epoch ?? '—'} 纪`, `Current world · Epoch ${status.world?.epoch ?? '—'}`)], ...history.map((x) => [x.id, `${x.worldId} · ${epochText(x.epoch)} · ${x.id.slice(0, 8)}`])]));
    const cities = cityList(status);
    if (cities.length) grid.append(select('city', tr('城', 'City'), 'city', [['', tr('三城', 'All three cities')], ...cities.map((c) => [c.id, c.name])]));
    // 第六前提以前的私人记录由造者密钥认出是哪一位，不用选居民
    if (!(fields.mode === 'resident' && legacyBranch(b))) {
      let list = b?.residents || status.residents || [];
      if (fields.mode === 'resident') list = list.filter((r) => r.managed);
      const people = [...list].sort((x, y) => String(x.name).localeCompare(String(y.name), 'zh')).map((r) => [r.id, r.name]);
      if (fields.agentId && !people.some(([id]) => id === fields.agentId)) people.unshift([fields.agentId, residentName(fields.agentId)]);
      grid.append(select('agent', tr('居民', 'Resident'), 'agentId', [['', tr('全部居民', 'All residents')], ...people]));
    }
    const last = Number.isFinite(b?.day) ? b.day + 1 : null;
    const day = (key, label) => h('input', { type: 'number', name: key, min: 1, max: last, inputmode: 'numeric', value: fields[key], 'aria-label': label, onInput: (e) => { fields[key] = e.target.value; const text = view.scopeRow.querySelector('.assistant-scope-text'); if (text) text.textContent = summaryText(); } });
    grid.append(h('div', { class: 'field' }, h('span', null, tr('世界日', 'World days')),
      h('div', { class: 'assistant-days' }, tr('第', 'Day'), day('fromDay', tr('起始世界日', 'First world day')), tr('日 至 第', 'to'), day('toDay', tr('结束世界日', 'Last world day')), tr('日', ''))));
    const key = (name, label, prop) => h('label', { class: 'field' }, h('span', null, label), h('input', { type: 'password', name, autocomplete: 'off', value: client.keys[prop] || '', onInput: (e) => { client.keys[prop] = e.target.value; } }));
    if (fields.mode === 'resident' && legacyBranch(b)) grid.append(key('owner-key', tr('造者密钥', 'Owner key'), 'ownerKey'));
    if (fields.mode === 'research') grid.append(key('admin-key', tr('管理密钥', 'Admin key'), 'adminKey'));
    return [head, grid];
  }

  document.addEventListener('visibilitychange', () => { suspended = document.hidden; if (suspended) purge(); else load(); });
  window.addEventListener('pagehide', purge);
  window.addEventListener('pageshow', (event) => { if (event.persisted) { suspended = false; load(); } });
  await load();
  return { client, dispose: () => { suspended = true; stopWatching(); purge(); } };
}
