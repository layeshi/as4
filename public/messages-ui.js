// 人类留言板：讨论与草稿仅在当前账号下显示；异步响应不覆盖后续账号的数据。
import { h, clear } from './dom.js';
import { api, errorText } from './api.js';
import { initAccounts, refreshAccount, watchAccount, openAccount, initialBadge } from './accounts.js';
import { mountShell, pageHead, card, emptyState, btn, messageComposer, tr, setNotice } from './console-ui.js';

const time = (value) => `${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))} UTC+8`;

export async function mountMessageBoard({ header, head, message, content }) {
  let user = null, epoch = 0, generation = 0, roots = [], nextCursor = null, total = 0, editor = null, saving = false;
  let mutationVersion = 0, loaded = false, loadError = '', loadingMore = false;
  const threads = new Map(), drafts = new Map();
  const say = (text) => { message.textContent = text; };
  setNotice(say);
  mountShell(header, { active: 'messages' });
  initAccounts(null, { onAccountChange: () => load() });
  const reset = () => { roots = []; threads.clear(); drafts.clear(); editor = null; nextCursor = null; total = 0; loaded = false; loadError = ''; };
  const unwatch = watchAccount((next, result) => {
    if (!result.ok) return;
    if (next?.id !== user?.id) { epoch++; user = next; reset(); render(); }
    else if (next?.role !== user?.role || next?.displayName !== user?.displayName) { user = next; render(); }
    else user = next;
  });
  async function call(path, options) {
    const token = epoch;
    const result = await api(path, options);
    if (token !== epoch) throw Error(tr('账号已切换，请重新操作。', 'Your account changed. Please try again.'));
    if (result.status === 401) {
      epoch++; user = null; reset(); render();
      say(tr('登录已失效，请重新登录。', 'Your session expired. Please sign in again.'));
      await refreshAccount({ notify: false, redirect: false });
    }
    if (!result.ok) throw Error(errorText(result, tr('请求失败，请检查网络后重试。', 'Request failed. Check your connection and retry.')));
    return result.json;
  }
  async function mutate(path, body, method = 'POST') {
    if (saving) throw Error(tr('正在处理，请稍候。', 'Please wait for the current request.'));
    saving = true;
    try {
      const result = await call(path, { method, body });
      mutationVersion++; generation++; // 丢弃写操作之前发出的旧列表响应。
      return result;
    } finally { saving = false; }
  }
  const keyOf = (state) => `${state.kind}-${state.id}`;
  const cancel = () => { if (saving) return; editor = null; render(); };
  function openEditor(kind, item, threadId) {
    if (saving) return;
    editor = { kind, id: item.id, threadId, item };
    const key = keyOf(editor);
    if (!drafts.has(key)) drafts.set(key, kind === 'edit' ? item.text : '');
    render();
    content.querySelector(`[data-draft="${key}"]`)?.focus();
  }
  function update(item) {
    if (!item.threadId) roots = roots.map((root) => root.id === item.id ? item : root);
    else {
      const state = threads.get(item.threadId);
      if (state) state.messages = state.messages.map((reply) => reply.id === item.id ? item : reply);
    }
    // 删除或改昵称后，已加载回复的对象标签也要同步。
    for (const state of threads.values()) for (const reply of state.messages) {
      if (reply.replyTo?.id === item.id) reply.replyTo = { id: item.id, displayName: item.author.displayName, deleted: !!item.deletedAt };
    }
  }
  function inlineEditor(item, threadId) {
    if (editor?.id !== item.id) return null;
    const state = editor, key = keyOf(state);
    if (state.kind === 'delete') {
      const status = h('p', { role: 'status' });
      return h('div', { class: 'message-confirm', role: 'group', 'aria-label': tr('确认删除', 'Confirm deletion') },
        h('p', null, tr('删除这条留言？正文将隐藏，已有回复仍然保留。', 'Delete this message? Its text will be hidden and existing replies will remain.')),
        h('div', { class: 'form-actions' }, btn(tr('取消', 'Cancel'), cancel), btn(tr('确认删除', 'Delete message'), async () => {
          try { const result = await mutate(`/api/messages/${item.id}`, {}, 'DELETE'); update(result.message); editor = null; render(); say(tr('留言已删除，已有回复已保留。', 'Message deleted. Existing replies remain.')); }
          catch (err) { status.className = 'error'; status.textContent = err.message; }
        }, true)), status);
    }
    const editing = state.kind === 'edit';
    return messageComposer({ label: editing ? tr('编辑留言', 'Edit message') : `${tr('回复', 'Reply to')} ${item.author.displayName}${item.deletedAt ? tr('（留言已删除）', ' (deleted message)') : ''}`,
      value: drafts.get(key) || '', key, submitLabel: editing ? tr('保存修改', 'Save changes') : tr('发布回复', 'Post reply'),
      onInput: (value) => { drafts.set(key, value); say(''); }, cancel,
      submit: async (text) => {
        const result = editing ? await mutate(`/api/messages/${item.id}`, { text }, 'PATCH') : await mutate(`/api/messages/${threadId}/replies`, { text, replyToId: item.id });
        if (editing) update(result.message);
        else {
          const root = roots.find((r) => r.id === threadId);
          if (root) root.replyCount++;
          let replies = threads.get(threadId);
          if (!replies) { replies = { messages: [], nextCursor: null, open: true, loaded: false }; threads.set(threadId, replies); }
          replies.open = true;
          replies.messages.push(result.message);
          if (!replies.loaded) queueMicrotask(() => fetchReplies(threadId, false));
        }
        drafts.delete(key); editor = null; render(); say(editing ? tr('修改已保存。', 'Changes saved.') : tr('回复已发布。', 'Reply posted.'));
      },
    });
  }
  function entry(item, threadId, reply = false) {
    const actions = [];
    actions.push(btn(tr('回复', 'Reply'), () => openEditor('reply', item, threadId)));
    if (item.canEdit) actions.push(btn(tr('编辑', 'Edit'), () => openEditor('edit', item, threadId)));
    if (item.canDelete) actions.push(btn(tr('删除', 'Delete'), () => openEditor('delete', item, threadId)));
    return h('article', { class: reply ? 'message-reply' : 'message-entry', dataset: { messageId: item.id } },
      h('header', { class: 'message-author' }, initialBadge(item.author), h('div', { class: 'message-who' }, h('h3', null, item.author.displayName),
        h('p', { class: 'message-meta muted' }, h('time', { datetime: item.createdAt }, time(item.createdAt)), item.editedAt && !item.deletedAt ? ` · ${tr('已编辑', 'Edited')}` : ''))),
      reply && item.replyTo ? h('p', { class: 'message-target muted' }, `${tr('回复', 'Reply to')} ${item.replyTo.displayName}${item.replyTo.deleted ? tr('（留言已删除）', ' (deleted message)') : ''}`) : null,
      h('p', { class: `message-text${item.deletedAt ? ' muted message-deleted' : ''}` }, item.deletedAt ? tr('该留言已删除', 'This message was deleted') : item.text),
      h('div', { class: 'message-actions' }, actions), inlineEditor(item, threadId));
  }
  async function fetchReplies(id, more) {
    let state = threads.get(id);
    if (!state) { state = { messages: [], nextCursor: null, open: true, loaded: false }; threads.set(id, state); }
    const token = epoch, beforeMutation = mutationVersion;
    state.loading = true; state.error = ''; render();
    try {
      const result = await call(`/api/messages/${id}/replies${more && state.nextCursor ? `?cursor=${state.nextCursor}` : ''}`);
      if (token !== epoch) return;
      if (beforeMutation !== mutationVersion) return await fetchReplies(id, more);
      const combined = more || !state.loaded ? [...state.messages, ...result.messages] : result.messages;
      state.messages = [...new Map(combined.map((item) => [item.id, item])).values()].sort((a, b) => a.seq - b.seq);
      state.nextCursor = result.nextCursor; state.loaded = true;
      const root = roots.find((r) => r.id === id); if (root) root.replyCount = result.total;
    } catch (err) { if (token === epoch) state.error = err.message; }
    finally { if (token === epoch) { state.loading = false; render(); } }
  }
  function discussion(root) {
    const state = threads.get(root.id);
    const toggle = btn(state?.open ? tr('收起回复', 'Hide replies') : tr(`查看回复（${root.replyCount}）`, `View replies (${root.replyCount})`), async () => {
      if (state?.open) { state.open = false; render(); }
      else if (state?.loaded) { state.open = true; render(); }
      else { if (state) state.open = true; await fetchReplies(root.id, false); }
    });
    toggle.setAttribute('aria-expanded', String(!!state?.open));
    toggle.setAttribute('aria-controls', `replies-${root.id}`);
    const replies = h('div', { class: 'message-replies', id: `replies-${root.id}`, hidden: !state?.open });
    if (state?.open) {
      if (state.error) replies.append(h('p', { class: 'error', role: 'status' }, state.error), btn(tr('重试', 'Retry'), () => fetchReplies(root.id, !!state.loaded)));
      if (state.loading) replies.append(h('p', { class: 'muted', role: 'status' }, tr('正在加载回复…', 'Loading replies…')));
      if (!state.messages.length && state.loaded && !state.loading && !state.error) replies.append(h('p', { class: 'muted' }, tr('暂无回复，可以说说你的想法。', 'No replies yet. Share your thoughts.')));
      for (const item of state.messages) replies.append(entry(item, root.id, true));
      if (state.nextCursor && !state.loading) replies.append(btn(tr('加载更多回复', 'Load more replies'), () => fetchReplies(root.id, true)));
    }
    return h('div', { class: 'message-thread' }, entry(root, root.id), toggle, replies);
  }
  function render() {
    // 局部请求结束时仍保留正在输入的草稿、焦点和光标位置。
    const active = document.activeElement;
    const focused = content.contains(active) ? active?.dataset?.draft : null;
    const selection = focused ? [active.selectionStart, active.selectionEnd] : null;
    clear(content);
    if (!user) {
      content.append(emptyState(tr('登录后参与讨论', 'Sign in to join the discussion'), tr('留言仅对登录用户可见。登录后可以发表留言、回复他人。', 'Messages are visible to signed-in users. Sign in to post and reply.'), btn(tr('登录 / 注册', 'Sign in / Register'), () => openAccount({ hub: false })))); return;
    }
    const composer = messageComposer({ label: tr('写下你的想法', 'Share your thoughts'), value: drafts.get('new') || '', key: 'new',
      primary: !editor, submitLabel: tr('发布留言', 'Post message'), onInput: (value) => { drafts.set('new', value); say(''); },
      submit: async (text) => {
        const result = await mutate('/api/messages', { text });
        roots.unshift(result.message); total++; loaded = true; loadError = ''; drafts.delete('new'); render(); say(tr('留言已发布。', 'Message posted.'));
      },
    });
    const list = card(tr('留言讨论', 'Discussions'), tr(`共 ${total} 条主留言 · 最新发布在前`, `${total} messages · Newest first`));
    if (loadError) list.append(emptyState(tr('无法读取留言', 'Unable to load messages'), loadError, btn(tr('重试', 'Retry'), () => load())));
    else if (!loaded) list.append(h('p', { class: 'muted', role: 'status' }, tr('正在加载留言…', 'Loading messages…')));
    else if (!roots.length) list.append(emptyState(tr('尚无留言', 'No messages yet'), tr('在上方发布第一条留言，开始交流。', 'Post the first message above to start a discussion.')));
    else for (const root of roots) list.append(discussion(root));
    if (nextCursor) {
      const more = btn(loadingMore ? tr('正在加载…', 'Loading…') : tr('加载更多留言', 'Load more messages'), () => loadMore());
      more.disabled = loadingMore; list.append(more);
    }
    content.append(card(tr('发表留言', 'Post a message'), tr(`以 ${user.displayName} 的昵称发言 · 支持换行，最多 2,000 字`, `Posting as ${user.displayName} · Plain text, up to 2,000 characters`), composer), list);
    if (saving) for (const control of content.querySelectorAll('button, textarea')) control.disabled = true;
    if (focused) {
      const input = content.querySelector(`[data-draft="${focused}"]`);
      input?.focus(); if (selection && input?.setSelectionRange) input.setSelectionRange(...selection);
    }
  }
  async function loadMore() {
    if (loadingMore || !nextCursor) return;
    const token = epoch, beforeMutation = mutationVersion;
    loadingMore = true;
    try {
      const result = await call(`/api/messages?cursor=${nextCursor}`);
      if (token !== epoch || beforeMutation !== mutationVersion) return;
      roots = [...new Map([...roots, ...result.messages].map((item) => [item.id, item])).values()];
      total = result.total; nextCursor = result.nextCursor;
    } finally { loadingMore = false; if (token === epoch) render(); }
  }
  async function load() {
    const version = ++generation;
    pageHead(head, { eyebrow: tr('人类之间', 'Between people'), title: tr('留言板', 'Message board'), lead: tr('与其他用户交流想法，接续彼此的讨论。', 'Share ideas with other users and continue the conversation.'), actions: [btn(tr('刷新', 'Refresh'), () => load())] });
    say(tr('正在加载…', 'Loading…'));
    const account = await refreshAccount({ notify: false, redirect: false });
    if (version !== generation) return;
    if (!account.ok) { say(''); if (!user) clear(content); content.append(emptyState(tr('无法读取账号信息', 'Unable to load your account'), tr('请检查网络后重试。', 'Check your connection and retry.'), btn(tr('重试', 'Retry'), () => load()))); return; }
    user = account.json.user;
    if (!user) { render(); say(''); return; }
    const token = epoch;
    try {
      const result = await call('/api/messages');
      if (version !== generation || token !== epoch) return;
      roots = result.messages; nextCursor = result.nextCursor; total = result.total; loaded = true; loadError = '';
      threads.clear(); editor = null; render(); say('');
    } catch (err) {
      if (version !== generation || token !== epoch) return;
      loadError = err.message; render(); say(err.message);
    }
  }
  const checkSession = () => { if (!document.hidden) refreshAccount({ redirect: false }).catch(() => {}); };
  const timer = setInterval(checkSession, 60000); timer?.unref?.();
  document.addEventListener('visibilitychange', checkSession);
  const restore = () => { if (!document.hidden) load(); };
  globalThis.addEventListener?.('pageshow', restore);
  await load();
  return { load, dispose: () => { clearInterval(timer); unwatch(); document.removeEventListener('visibilitychange', checkSession); globalThis.removeEventListener?.('pageshow', restore); } };
}
