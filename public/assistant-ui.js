import { h, clear } from './dom.js';
import { initAccounts, refreshAccount, watchAccount } from './accounts.js';
import { mountShell, pageHead, card, emptyState, btn, tr, setNotice } from './console-ui.js';
import { AssistantClient, questionScope } from './assistant-client.js';

const states = () => ({ generating: tr('正在生成…', 'Generating…'), pending: tr('内容审核中', 'Awaiting content review'), complete: tr('已完成', 'Complete'), failed: tr('生成失败', 'Failed'), cancelled: tr('已停止 · 答案未完成', 'Stopped · Incomplete answer'), withheld: tr('内容未展示，请重新验证权限或稍后再试', 'Content unavailable; verify access or try later') });
export async function mountAssistant() {
  const root = document.getElementById('content'), notice = document.getElementById('message');
  const client = new AssistantClient(), params = new URLSearchParams(location.search);
  let fields = { mode: 'public', agentId: params.get('agentId') || '', lawId: params.get('lawId') || '', branchId: params.get('branchId') || '', city: '', fromDay: '', toDay: '' };
  let draft = '', busy = false, timer, suspended = false, dialog = null, loadVersion = 0;
  let messagesNode, sessionsNode, quotaNode;
  const say = text => { notice.textContent = text || ''; };
  mountShell(document.getElementById('console-header'), { active: 'assistant' }); setNotice(say);
  pageHead(document.getElementById('page-head'), { eyebrow: tr('人类观测', 'Human observation'), title: tr('实验助手', 'Experiment assistant'), lead: tr('从世界记录里找依据，理解居民、规则与三城的变化。', 'Explore residents, rules and changes across the three cities through recorded evidence.'), back: { href: '/', label: tr('观测城市', 'Observe') } });
  function closeSource() { dialog?.remove(); dialog = null; client.source = null; }
  function purge() { loadVersion++; clearTimeout(timer); closeSource(); client.reset(); draft = ''; busy = false; clear(root); }
  const stopWatching = watchAccount(user => { if ((user?.id || null) !== client.owner) { purge(); client.account(user?.id || null); if (!suspended) load(); } });
  initAccounts(null, { onAccountChange: () => { purge(); if (!suspended) load(); } });
  async function run(action) {
    if (busy) return;
    const lifecycle = loadVersion; busy = true; say('');
    try { await action(); }
    catch (error) { if (lifecycle !== loadVersion) return; say(error.message + (error.resetAt ? ' · ' + new Date(error.resetAt).toLocaleString() : '')); if ([401, 403].includes(error.status)) { closeSource(); client.conversation = null; client.lastQuestion = null; client.keys = {}; if (error.status === 401) { client.account(null); clear(root); await load(); } } }
    finally { if (lifecycle === loadVersion) { busy = false; if (!suspended) renderMessages(); } }
  }
  async function load() {
    const v = ++loadVersion;
    try {
      const account = await refreshAccount({ notify: false, redirect: false });
      if (v !== loadVersion || suspended) return;
      if (!account.ok) throw Error(tr('无法读取账号，请刷新重试。', 'Unable to load your account. Refresh to retry.'));
      client.account(account.json.user?.id || null);
      await client.statusRead(); if (v !== loadVersion || suspended) return;
      render();
    } catch (error) { if (v === loadVersion) { say(error.message); clear(root).append(btn(tr('重新加载', 'Reload'), load)); } }
  }
  function select(label, key, options) {
    return h('label', { class: 'field' }, label, h('select', { onChange: e => { fields[key] = e.target.value; if (key === 'branchId') render(); } }, options.map(([value, text]) => h('option', { value, selected: fields[key] === value }, text))));
  }
  function render() {
    const status = client.status; clear(root); closeSource();
    if (!client.owner || !status?.signedIn) { root.append(emptyState(tr('登录后向实验提问', 'Sign in to ask about the experiment'), tr('解释实验规则、查阅已保存的历史，并为重要事实提供来源。', 'Understand experiment rules and recorded history with sources for key facts.'), h('a', { class: 'btn', href: '/login.html?next=' + encodeURIComponent(location.pathname + location.search) }, tr('登录 / 注册', 'Sign in / Register')))); return; }
    const world = status.world || {}, cities = world.cities || [];
    quotaNode = h('p', { class: 'muted' });
    const worldNode = h('p', { class: 'assistant-world muted', title: world.branchId }, `${world.id || '—'} · ${tr('纪元', 'Era')} ${world.epoch ?? '—'} · ${tr('分支', 'Branch')} ${world.branchId?.slice(0, 8) || '—'} · ${tr('第', 'Day')} ${Number.isFinite(world.day) ? world.day + 1 : '—'} ${tr('日', '')} · ${world.ended ? tr('已结束', 'Ended') : world.paused ? tr('已暂停', 'Paused') : tr('运行中', 'Running')}`, h('br'), tr('数据截至：', 'Data as of: '), world.observedAt || status.observedAt || tr('本次服务端查询时点', 'This server observation'));
    const controls = h('div', { class: 'assistant-controls' }, select(tr('证据范围', 'Evidence scope'), 'mode', [['public', tr('公开记录', 'Public records')], ['resident', tr('我的居民私人记录', 'My resident’s private records')], ['research', tr('管理员私人研究', 'Administrator research')]]), select(tr('世界与历史分支', 'World and history branch'), 'branchId', [['', tr('当前世界', 'Current world')], ...(status.branches || []).map(b => [b.id, `${b.worldId} · ${tr('纪元', 'Era')} ${b.epoch} · ${b.id.slice(0, 8)}`])]), select(tr('城市', 'City'), 'city', [['', tr('全部城市', 'All cities')], ...cities.map(c => typeof c === 'string' ? [c, c] : [c.id, typeof c.name === 'string' ? c.name : c.name?.zh || c.id])]), h('label', { class: 'field' }, tr('居民 ID（可选当前居民或填写历史 ID）', 'Resident ID (choose current or enter historical ID)'), h('input', { list: 'assistant-residents', value: fields.agentId, placeholder: tr('未指定', 'None'), onInput: e => { fields.agentId = e.target.value.trim(); } }), h('datalist', { id: 'assistant-residents' }, (status.branches?.find(b => b.id === fields.branchId)?.residents || status.residents || []).map(r => h('option', { value: r.id }, `${r.name} · ${r.managed ? tr('我管理的居民', 'Managed by me') : tr('公开', 'Public')}`)))));
    for (const [key, label] of [['fromDay', tr('起始世界日（可空）', 'First world day (optional)')], ['toDay', tr('结束世界日（可空）', 'Last world day (optional)')]]) controls.append(h('label', { class: 'field' }, label, h('input', { type: 'number', min: 1, value: fields[key], onInput: e => { fields[key] = e.target.value; } })));
    const secrets = h('details', null, h('summary', null, tr('旧世界 / 管理员额外验证', 'Legacy world / administrator verification')), h('p', { class: 'muted' }, tr('P6/P7 居民按当前账号管理权验证。密钥仅在本页内存中使用，切到后台即清除。', 'P6/P7 uses current account ownership. Verification keys stay in page memory and clear in the background.')));
    for (const [key, label] of [['ownerKey', tr('旧世界造者密钥', 'Legacy owner key')], ['adminKey', tr('管理密钥', 'Admin verification key')]]) secrets.append(h('label', { class: 'field' }, label, h('input', { type: 'password', value: client.keys[key] || '', autocomplete: 'off', onInput: e => { client.keys[key] = e.target.value; } })));
    const input = h('textarea', { maxlength: 4000, value: draft, 'aria-label': tr('你的问题', 'Your question'), placeholder: tr('例如：三城公库的变化有哪些已知依据？', 'What records explain changes in the three cities’ treasuries?'), onInput: e => { draft = e.target.value; } });
    const submit = h('button', { type: 'submit', class: 'btn primary', disabled: !status.available }, tr('提问', 'Ask'));
    const composer = h('form', { class: 'assistant-composer', onSubmit: e => { e.preventDefault(); if (client.active || !draft.trim()) return; run(async () => { const text = draft.trim(); await client.ask(text, questionScope(fields)); draft = ''; input.value = ''; await refreshStatus(); renderMessages(); poll(); }); } }, input, h('div', { class: 'form-actions' }, submit), h('p', { class: 'muted' }, tr('只读问答 · 最长等待 60 秒 · 每条消息保留 30 天 · 重试会计入新次数', 'Read-only · Up to 60 seconds · Each message kept for 30 days · Retries count as new questions')));
    messagesNode = h('div', { class: 'assistant-messages', 'aria-label': tr('对话消息', 'Conversation messages') });
    sessionsNode = h('div');
    const sidebar = h('aside', { class: 'assistant-sidebar' }, btn(tr('＋ 新对话', '+ New conversation'), () => { clearTimeout(timer); client.version++; client.conversation = null; client.questionId = null; client.lastQuestion = null; closeSource(); renderMessages(); renderSessions(); }), h('details', { open: true }, h('summary', null, tr('最近对话', 'Recent conversations')), sessionsNode));
    const context = fields.lawId ? h('p', { class: 'assistant-context' }, tr('带入法律：', 'Law context: '), fields.lawId, btn(tr('清除对象', 'Clear context'), () => { fields.lawId = ''; render(); })) : null;
    root.append(h('div', null, quotaNode, worldNode, !status.available ? h('p', { role: 'status' }, tr('助手暂不可用；仍可查看已有对话。', 'Assistant unavailable; saved conversations remain accessible.')) : null, h('div', { class: 'assistant-layout' }, sidebar, h('section', null, card(tr('本次问题范围', 'Scope for this question'), tr('选择私人范围后才会检索授权的私人记录。', 'Private records are retrieved only for the selected authorized scope.'), context, controls, secrets), messagesNode, composer))));
    renderQuota(); renderSessions(); renderMessages();
  }
  function renderQuota() { const q = client.status?.quota; if (quotaNode && q) quotaNode.textContent = `${tr('今日剩余', 'Remaining today')} ${q.remaining} / ${q.limit} · ${tr('恢复时间', 'Resets')} ${new Date(q.resetAt).toLocaleString()} · ${client.status.model || ''}`; }
  function renderSessions() { if (!sessionsNode) return; clear(sessionsNode); for (const c of client.status?.conversations || []) sessionsNode.append(btn(c.title || tr('未命名对话', 'Untitled conversation'), () => run(async () => { clearTimeout(timer); closeSource(); client.questionId = null; await client.open(c.id); renderMessages(); poll(); }), client.conversation?.id === c.id)); }
  function renderMessages() {
    if (!messagesNode || suspended) return;
    clear(messagesNode); const conversation = client.conversation;
    if (!conversation) { messagesNode.append(emptyState(tr('从一个问题开始', 'Start with a question'), tr('回答会附来源。事实不足时，助手应明确说明未知。', 'Answers cite their evidence and should acknowledge missing facts.'))); return; }
    for (const m of conversation.messages || []) {
      const hidden = ['withheld', 'pending'].includes(m.status);
      const o = m.observation;
      const observation = !hidden && o ? h('p', { class: 'muted', title: o.branchId }, `${o.worldId} · ${tr('纪元', 'Era')} ${o.epoch} · ${tr('分支', 'Branch')} ${o.branchId?.slice(0, 8)} · ${tr('世界日', 'World day')} ${o.day + 1} · ${o.ended ? tr('已结束', 'Ended') : o.paused ? tr('已暂停', 'Paused') : tr('运行中', 'Running')} · ${tr('数据截至', 'Data as of')} ${o.observedAt}`) : null;
      const actions = h('div', { class: 'form-actions' });
      if (!hidden) for (const s of m.sources || []) actions.append(btn((s.label ? `[${s.label}] ` : '') + (s.title || s.id), () => run(async () => { closeSource(); await client.readSource(s.id); if (!client.source || suspended) return; const source = client.source; dialog = h('dialog', { class: 'assistant-source', 'aria-label': tr('回答来源', 'Answer source') }, h('h2', null, source.title), h('p', { class: 'muted', title: source.branchId }, `${source.worldId || ''} · ${tr('纪元', 'Era')} ${source.epoch ?? '—'} · ${source.branchId?.slice(0, 8) || ''}${source.day != null ? ' · ' + (source.day + 1) : ''}`), h('pre', null, source.text), btn(tr('关闭', 'Close'), closeSource)); document.body.append(dialog); dialog.addEventListener('cancel', closeSource); dialog.showModal(); })));
      if (m.role === 'assistant' && ['failed', 'cancelled', 'withheld'].includes(m.status)) actions.append(btn(tr('重试（计新次数）', 'Retry (new question)'), () => run(async () => { const index = conversation.messages.indexOf(m); const q = conversation.messages.slice(0, index).findLast(x => x.role === 'user'); if (!q?.text) throw Error(tr('问题不可访问，请重新输入。', 'Question unavailable. Enter it again.')); await client.ask(q.text, m.scope || questionScope(fields)); await refreshStatus(); poll(); })));
      messagesNode.append(h('article', { class: 'assistant-message', dataset: { role: m.role } }, h('p', { class: 'eyebrow' }, m.role === 'user' ? tr('你', 'You') : tr('实验助手 · AI 生成', 'Experiment assistant · AI generated')), h('p', { class: 'assistant-prose' }, hidden ? states()[m.status] : m.text || states()[m.status]), observation, h('p', { class: 'muted', role: 'status' }, states()[m.status] || m.status, m.error ? ' · ' + (typeof m.error === 'string' ? m.error : m.error.message || m.error.code || '') : ''), actions));
    }
    messagesNode.append(h('div', { class: 'form-actions' }, conversation.messages.some(m => m.status === 'generating') ? btn(tr('停止生成', 'Stop generating'), () => run(async () => { await client.cancel(); await client.open(conversation.id); poll(); })) : null, btn(tr('刷新 / 重新验证', 'Refresh / verify access'), () => run(async () => { await client.open(conversation.id); poll(); })), btn(tr('删除此对话', 'Delete conversation'), () => run(async () => { if (!confirm(tr('立即删除此对话及其消息？', 'Delete this conversation and its messages now?'))) return; clearTimeout(timer); closeSource(); await client.remove(conversation.id); await refreshStatus(); renderSessions(); }))));
  }
  async function refreshStatus() { await client.statusRead(); renderQuota(); renderSessions(); }
  function poll() {
    clearTimeout(timer);
    if (!client.conversation || suspended) return;
    const id = client.conversation.id;
    // Recheck authorization even after completion; do not leave a private answer indefinitely cached.
    timer = setTimeout(async () => { if (busy) { poll(); return; } busy = true; try { const sourceId = client.source?.id; await client.open(id); if (sourceId && dialog) { await client.readSource(sourceId); if (client.source && dialog) dialog.querySelector('pre').textContent = client.source.text; else closeSource(); } renderMessages(); if (!client.active) await refreshStatus(); poll(); } catch (error) { closeSource(); say(error.message); renderMessages(); } finally { busy = false; } }, client.active ? 1200 : 15000);
  }
  document.addEventListener('visibilitychange', () => { suspended = document.hidden; if (suspended) purge(); else load(); });
  window.addEventListener('pagehide', purge);
  window.addEventListener('pageshow', event => { if (event.persisted) { suspended = false; load(); } });
  await load();
  return { client, dispose: () => { suspended = true; stopWatching(); purge(); } };
}
