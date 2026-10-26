// 留言板在小程序内只读：留言属于登录账号可见的内容，网络结果需同时匹配账号、导航及读取版本。
// 发表、回复、编辑与删除不在小程序提供；意见反馈使用客服邮箱。
const api = require('./utils/api');
class MessageBoard {
  constructor(app) { this.app = app; this.ownerId = null; this.version = 0; this.verified = false; this.reset(); }
  reset() {
    this.version++; this.roots = []; this.total = 0; this.cursor = null; this.loaded = false; this.loading = false; this.error = '';
    this.replies = new Map(); this.expanded = new Set(); this.threadId = '';
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
  requireLogin() { if (!this.sync()) throw new Error('请先使用微信登录后阅读留言'); }
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
  apply(item) {
    if (item.threadId === null) {
      const index = this.roots.findIndex(root => root.id === item.id);
      if (index >= 0) this.roots[index] = item;
      else this.roots.unshift(item);
      this.roots.sort((a, b) => b.seq - a.seq);
    } else {
      let state = this.replies.get(item.threadId);
      if (!state) { state = { messages: [], loaded: false, loading: false, cursor: null, error: '' }; this.replies.set(item.threadId, state); }
      const index = state.messages.findIndex(row => row.id === item.id);
      if (index >= 0) state.messages[index] = item; else state.messages.push(item);
      state.messages.sort((a, b) => a.seq - b.seq);
    }
    for (const state of this.replies.values()) for (const reply of state.messages) if (reply.replyTo?.id === item.id) {
      reply.replyTo = { id: item.id, displayName: item.author.displayName, deleted: !!item.deletedAt };
    }
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
      case 'messageExpand': if (this.expanded.has(action.id)) this.expanded.delete(action.id); else this.expanded.add(action.id); break;
      case 'messageRefresh': await this.refresh(); break;
      default: break;
    }
  }
}
module.exports = { MessageBoard };
