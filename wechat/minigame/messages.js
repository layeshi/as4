// 留言与草稿属于当前账号；网络结果需同时匹配账号、导航及读取版本。
const api = require('./utils/api');
class MessageBoard {
  constructor(app) { this.app = app; this.ownerId = null; this.version = 0; this.verified = false; this.reset(); }
  reset() {
    this.version++; this.roots = []; this.total = 0; this.cursor = null; this.loaded = false; this.loading = false; this.error = '';
    this.replies = new Map(); this.expanded = new Set(); this.drafts = new Map(); this.editor = null; this.threadId = '';
    delete this.app.form.messageText;
    delete this.app.moderation.messages; delete this.app.loginRequired.messages;
  }
  sync() {
    const id = this.app.user?.id || null, verified = !!this.app.wechatVerified;
    if (id !== this.ownerId || this.verified && !verified) this.reset();
    this.ownerId = id; this.verified = verified;
    return !!id && verified;
  }
  ticket(scope) { return { ownerId: this.ownerId, version: this.version, read: this.app.beginRead(scope), scope }; }
  current(ticket) { return ticket.ownerId === this.app.user?.id && ticket.version === this.version && this.app.readCurrent(ticket.scope, ticket.read); }
  requireLogin() { if (!this.sync()) throw new Error('请先使用微信登录后参与讨论'); }
  fail(error) {
    if (error.status === 401 && error.sessionCurrent !== false) {
      if (error.code !== 'wechat_login_required') this.app.user = null;
      this.app.wechatVerified = false; this.reset(); this.ownerId = this.app.user?.id || null; this.verified = false;
      if (error.code === 'wechat_login_required') this.app.loginRequired.messages = 1;
    }
  }
  get(id) {
    return this.roots.find(item => item.id === id) || [...this.replies.values()].flatMap(state => state.messages).find(item => item.id === id);
  }
  async load(more = false) {
    if (!this.sync()) return;
    if (more && (!this.cursor || this.loading)) return;
    const ticket = this.ticket('messages');
    this.loading = true; this.error = ''; this.app.invalidate(); this.app.render();
    try {
      const data = await api.request('/api/messages' + (more ? '?cursor=' + this.cursor : ''));
      if (!this.current(ticket)) return;
      this.roots = [...new Map((more ? this.roots.concat(data.messages) : data.messages).map(item => [item.id, item])).values()].sort((a, b) => b.seq - a.seq);
      this.cursor = data.nextCursor; this.total = data.total; this.loaded = true;
      if (!more) this.replies.clear();
      this.app.rememberModeration('messages', data);
    } catch (error) {
      if (!this.current(ticket)) return;
      this.fail(error); this.error = error.message;
    } finally { if (this.app.readVersions.messages === ticket.read.version) { this.loading = false; this.app.invalidate(); this.app.render(); } }
  }
  async loadThread(id, more = false) {
    if (!this.sync()) return;
    let state = this.replies.get(id);
    if (!state) { state = { messages: [], loaded: false, loading: false, cursor: null, error: '' }; this.replies.set(id, state); }
    if (more && (!state.cursor || state.loading)) return;
    const ticket = this.ticket('messageThread');
    state.loading = true; state.error = ''; this.app.invalidate(); this.app.render();
    try {
      const data = await api.request('/api/messages/' + id + '/replies' + (more ? '?cursor=' + state.cursor : ''));
      if (!this.current(ticket) || this.threadId !== id) return;
      const rows = more || !state.loaded ? state.messages.concat(data.messages) : data.messages;
      state.messages = [...new Map(rows.map(item => [item.id, item])).values()].sort((a, b) => a.seq - b.seq);
      state.cursor = data.nextCursor; state.loaded = true;
      if (data.root) this.apply(data.root);
      const root = this.get(id); if (root) root.replyCount = data.total;
      this.app.rememberModeration('messages', data);
    } catch (error) { if (this.current(ticket)) { this.fail(error); state.error = error.message; } }
    finally { if (this.app.readVersions.messageThread === ticket.read.version) { state.loading = false; this.app.invalidate(); this.app.render(); } }
  }
  stash() { if (this.editor) this.drafts.set(this.editor.key, this.app.form.messageText || ''); }
  compose(kind, id) {
    this.requireLogin(); this.stash();
    const item = id ? this.get(id) : null;
    if (kind !== 'new' && !item) throw new Error('留言已变更，请刷新后重试');
    const key = kind + ':' + (id || 'new');
    this.editor = { kind, id, key, threadId: item ? item.threadId || item.id : null, item };
    if (!this.drafts.has(key)) this.drafts.set(key, kind === 'edit' ? item.text || '' : '');
    this.app.form.messageText = this.drafts.get(key);
    this.app.push('messageEditor');
  }
  apply(item, created = false) {
    if (item.threadId === null) {
      const index = this.roots.findIndex(root => root.id === item.id);
      if (index >= 0) this.roots[index] = item;
      else { this.roots.unshift(item); if (created) this.total++; }
      this.roots.sort((a, b) => b.seq - a.seq);
    } else {
      let state = this.replies.get(item.threadId);
      if (!state) { state = { messages: [], loaded: false, loading: false, cursor: null, error: '' }; this.replies.set(item.threadId, state); }
      const index = state.messages.findIndex(row => row.id === item.id);
      if (index >= 0) state.messages[index] = item; else state.messages.push(item);
      state.messages.sort((a, b) => a.seq - b.seq);
      const root = this.get(item.threadId); if (created && root) root.replyCount++;
    }
    for (const state of this.replies.values()) for (const reply of state.messages) if (reply.replyTo?.id === item.id) {
      reply.replyTo = { id: item.id, displayName: item.author.displayName, deleted: !!item.deletedAt };
    }
  }
  async submit() {
    this.requireLogin();
    const editor = this.editor;
    if (!editor || this.saving) return;
    const text = (this.app.form.messageText || '').trim();
    if (editor.kind !== 'delete' && (!text || Array.from(text).length > 2000)) throw new Error('请输入 1–2,000 字的留言');
    this.stash();
    this.app.editing = ''; if (this.app.wx.hideKeyboard) this.app.wx.hideKeyboard();
    const ticket = this.ticket('messageWrite');
    const path = editor.kind === 'new' ? '/api/messages' : '/api/messages/' + (editor.kind === 'reply' ? editor.threadId + '/replies' : editor.id);
    const method = editor.kind === 'delete' ? 'DELETE' : editor.kind === 'edit' ? 'PATCH' : 'POST';
    const data = editor.kind === 'delete' ? {} : { text, ...(editor.kind === 'reply' ? { replyToId: editor.id } : {}) };
    this.saving = true;
    try {
      const result = await api.request(path, { method, data, timeout: 60000 });
      if (ticket.ownerId !== this.app.user?.id || ticket.version !== this.version) return;
      const onPage = this.current(ticket);
      this.version++; this.apply(result.message, ['new', 'reply'].includes(editor.kind)); this.loaded = true;
      this.drafts.delete(editor.key);
      if (this.editor === editor) { this.editor = null; delete this.app.form.messageText; }
      this.app.rememberModeration('messages', result);
      if (onPage) this.app.back();
      if (onPage) this.app.showToast(editor.kind === 'delete' ? '留言已删除，已有回复已保留' : editor.kind === 'edit' ? '修改已保存' : editor.kind === 'reply' ? '回复已发布' : '留言已发布', 'ok');
    } catch (error) { if (ticket.ownerId === this.app.user?.id && ticket.version === this.version) this.fail(error); throw error; }
    finally { this.saving = false; }
  }
  async refresh() {
    await this.app.loadAccount();
    if (this.app.tab === 'messages') await this.load();
    else if (this.app.tab === 'messageThread') await this.loadThread(this.threadId);
  }
  async handle(action) {
    switch (action.type) {
      case 'messages': this.app.push('messages'); await this.app.loadAccount(); await this.load(); break;
      case 'messageLogin': this.app.push('account'); await this.app.loadAccount(); break;
      case 'messageMore': await this.load(true); break;
      case 'messageThread': this.requireLogin(); this.threadId = action.id; this.app.push('messageThread'); await this.loadThread(action.id); break;
      case 'messageRepliesMore': await this.loadThread(this.threadId, true); break;
      case 'messageCompose': this.compose(action.kind, action.id); break;
      case 'messageDelete': this.compose('delete', action.id); break;
      case 'messageSubmit': await this.submit(); break;
      case 'messageCancel': this.stash(); this.editor = null; delete this.app.form.messageText; this.app.back(); break;
      case 'messageExpand': if (this.expanded.has(action.id)) this.expanded.delete(action.id); else this.expanded.add(action.id); break;
      case 'messageRefresh': await this.refresh(); break;
      default: break;
    }
  }
}
module.exports = { MessageBoard };
