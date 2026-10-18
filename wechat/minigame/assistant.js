// 实验助手的状态绑定账号，只放内存；未通过检查的草稿不进入画面。
const api = require('./utils/api');
const enc = encodeURIComponent;
class Assistant {
  constructor(app) { this.app = app; this.ownerId = null; this.reset(); }
  reset() {
    clearTimeout(this.timer); this.version = (this.version || 0) + 1;
    this.status = null; this.conversation = null; this.source = null; this.sourceId = null; this.sourceModeration = null; this.error = ''; this.loading = false;
    this.scope = { mode: 'public', branchId: '', city: '', agentId: '', lawId: '' }; this.polls = 0;
    this.sending = false; this.sourceLabel = ''; this.conversationScroll = 0; this.pendingScroll = 0;
    if (this.app.sheet?.kind?.startsWith('assistant')) this.app.sheet = null;
    for (const key of Object.keys(this.app.form || {})) if (key.startsWith('assistant')) delete this.app.form[key];
  }
  stash() { this.reset(); }
  sync() { const id = this.app.user?.id || null; if (id !== this.ownerId) { this.reset(); this.ownerId = id; } return !!id; }
  ticket() { return { owner: this.ownerId, version: this.version, navigation: this.app.navigation }; }
  current(t) { return t.owner === (this.app.user?.id || null) && t.version === this.version && t.navigation === this.app.navigation && this.app.visible; }
  options(method = 'GET', data) { return { method, data, timeout: method === 'POST' && typeof data?.text === 'string' ? 65000 : 15000, assistantAdminKey: this.app.form.assistantAdminKey, assistantOwnerKey: this.app.form.assistantOwnerKey }; }
  paint() { this.app.invalidate(); this.app.render(); }
  branch() { return (this.status?.branches || []).find(b => this.scope.branchId ? b.id === this.scope.branchId : b.active) || null; }
  residents() { return this.branch()?.residents || this.status?.residents || []; }
  residentName(id) { return [...this.residents(), ...(this.status?.residents || [])].find(r => r.id === id)?.name || id; }
  availableModes() {
    const b = this.branch(), modes = ['public'];
    if (!(b?.premise >= 6) || (b.residents || []).some(r => r.managed)) modes.push('resident');
    if (this.app.user?.role === 'admin') modes.push('research');
    return modes;
  }
  normalizeScope() { if (this.status && !this.availableModes().includes(this.scope.mode)) this.scope.mode = 'public'; }
  followBottom() { const sc = this.app.scroller(); return !this.sourceId && sc.max - sc.offset <= 48; }
  get active() { return this.conversation?.messages?.some(m => ['generating', 'pending'].includes(m.status)); }
  async refresh() {
    this.sync(); const t = this.ticket(); this.loading = true; this.error = ''; this.paint();
    try {
      const status = await api.request('/api/assistant/status'); if (!this.current(t)) return;
      if (!status.signedIn) { this.reset(); this.status = status; return; }
      this.status = status; this.normalizeScope();
      if (this.conversation) {
        const data = await api.request('/api/assistant/conversations/' + enc(this.conversation.id), this.options());
        if (!this.current(t)) return;
        const follow = this.followBottom(); this.conversation = data.conversation; if (follow) this.pendingScroll = 'bottom';
        if (this.sourceId) {
          const sourceId = this.sourceId;
          try {
            const result = await api.request('/api/assistant/conversations/' + enc(this.conversation.id) + '/sources/' + enc(sourceId), this.options());
            if (!this.current(t)) return; if (this.sourceId === sourceId) this.setSource(result);
          } catch (error) { if (this.sourceId === sourceId) throw error; }
        }
      }
      if (!this.current(t)) return;
      this.app.rememberModeration('assistant', status, ...(this.conversation?.messages || []).map(m => ({ moderation: m.moderation })));  this.schedule();
    } catch (error) { if (this.current(t)) this.fail(error); }
    finally { if (this.current(t)) { this.loading = false; this.paint(); } }
  }
  fail(error) {
    const needsToast = !!this.sourceId || !this.ownerId;
    this.conversation = null; this.source = null; this.sourceId = null; this.sourceModeration = null; this.error = error.message;
    if (needsToast) this.app.showToast(error.message, 'error');
    if (error.status === 401 && error.sessionCurrent !== false) {
      if (error.code === 'wechat_login_required') this.app.loginRequired.assistant = 1;
      else { this.app.user = null; this.sync(); this.error = error.message; }
    }
  }
  schedule() {
    clearTimeout(this.timer);
    if (this.app.tab !== 'assistant' || !this.app.visible || !this.conversation) return;
    // 审核不可用时停止自动等待，保留手动刷新。
    const waiting = this.active || this.sourceModeration?.pending;
    if (waiting && ++this.polls > 50) { this.error = '等待已结束。若内容仍在审核，可稍后手动刷新。'; if (this.sourceId) this.app.showToast(this.error, 'error'); return; }
    this.timer = setTimeout(() => this.refresh(), waiting ? 1500 : 15000);
  }
  setSource(result) { this.source = result.source; this.sourceModeration = result.moderation || null; this.app.rememberModeration('assistantSource', result); }
  async open(id) {
    this.version++; clearTimeout(this.timer); this.loading = false; this.sending = false; this.source = null; this.sourceId = null; this.sourceModeration = null; this.conversation = null; this.polls = 0;
    const t = this.ticket();
    try { const data = await api.request('/api/assistant/conversations/' + enc(id), this.options()); if (!this.current(t)) return; this.conversation = data.conversation; this.pendingScroll = 'bottom'; this.schedule(); return true; }
    catch (error) { if (this.current(t)) this.fail(error); }
  }
  questionScope() {
    const scope = {};
    for (const [key, value] of Object.entries(this.scope)) if (value) scope[key] = value;
    for (const [key, field] of [['fromDay', 'assistantFrom'], ['toDay', 'assistantTo']]) if (this.app.form[field]) {
      const day = Number(this.app.form[field]); if (!Number.isSafeInteger(day) || day < 1) throw Error('世界日期须为正整数'); scope[key] = day - 1;
    }
    if (scope.fromDay > scope.toDay) throw Error('起止日期顺序无效');
    return scope;
  }
  async handle(a) {
    this.sync();
    if (a.type === 'assistantOpen') {
      this.app.push('assistant'); this.scope.agentId = a.agentId || ''; this.scope.lawId = a.lawId || ''; this.scope.mode = 'public';
      return this.refresh();
    }
    if (a.type === 'assistantRefresh') { this.polls = 0; return this.refresh(); }
    if (a.type === 'assistantScope') { this.scope[a.key] = a.value; this.normalizeScope(); this.paint(); return; }
    if (a.type === 'assistantResetScope') {
      this.scope = { mode: 'public', branchId: '', city: '', agentId: '', lawId: this.scope.lawId };
      for (const key of ['assistantFrom', 'assistantTo', 'assistantAdminKey', 'assistantOwnerKey']) delete this.app.form[key];
      this.paint(); return;
    }
    if (a.type === 'assistantCloseSource') { this.source = null; this.sourceId = null; this.sourceModeration = null; this.pendingScroll = this.conversationScroll; this.paint(); return; }
    if (!this.ownerId) throw Error('请先登录后提问');
    this.error = ''; let t = this.ticket();
    try {
      if (a.type === 'assistantSession') await this.open(a.id);
      else if (a.type === 'assistantList' || a.type === 'assistantNew') { this.app.sheet = null; this.pendingScroll = 0; this.sending = false; this.loading = false; this.version++; clearTimeout(this.timer); this.conversation = null; this.source = null; this.sourceId = null; this.sourceModeration = null; }
      else if (a.type === 'assistantAsk' || a.type === 'assistantRetry') {
        if (this.sending) return;
        if (this.active) throw Error('请先等待当前回答完成，或停止生成');
        let text = (this.app.form.assistantText || '').trim(), scope;
        if (a.type === 'assistantRetry') {
          const messages = this.conversation?.messages || [], index = messages.findIndex(m => m.id === a.id);
          const question = messages.slice(0, index).reverse().find(m => m.role === 'user'); text = question?.text || ''; scope = messages[index]?.scope || this.questionScope();
        }
        if (a.type === 'assistantAsk') scope = this.questionScope();
        if (!text) throw Error('请输入问题；不可访问的旧问题请重新输入');
        this.sending = true; this.paint();
        const result = await api.request('/api/assistant/questions', this.options('POST', { text, scope, ...(this.conversation ? { conversationId: this.conversation.id } : {}) }));
        if (!this.current(t)) return;
        this.sending = false; this.app.sheet = null; delete this.app.form.assistantText; if (await this.open(result.conversationId)) await this.refresh();
      } else if (a.type === 'assistantCancel') {
        const message = this.conversation?.messages?.slice().reverse().find(m => m.status === 'generating');
        if (message) await api.request('/api/assistant/questions/' + enc(message.questionId || message.id) + '/cancel', this.options('POST', {}));
        if (this.current(t)) await this.refresh();
      } else if (a.type === 'assistantDelete') {
        const id = this.conversation?.id; if (!id) return;
        // 请求前清屏，使慢删除和旧读取都无法恢复已删除的内容。
        this.app.sheet = null; this.pendingScroll = 0; this.loading = false; this.sending = false;
        if (this.status?.conversations) this.status.conversations = this.status.conversations.filter(c => c.id !== id);
        this.version++; clearTimeout(this.timer); this.conversation = null; this.source = null; this.sourceId = null; this.sourceModeration = null; t = this.ticket(); this.paint();
        await api.request('/api/assistant/conversations/' + enc(id), this.options('DELETE', {}));
        if (this.current(t)) await this.refresh();
      } else if (a.type === 'assistantSource' && this.conversation) {
        if (!this.sourceId) this.conversationScroll = this.app.scroller().offset;
        this.sourceLabel = (this.conversation.messages || []).reduce((all, m) => all.concat(m.sources || []), []).find(s => s.id === a.id)?.label || '';
        this.source = null; this.sourceId = a.id; this.sourceModeration = null; this.pendingScroll = 0; this.paint();
        const result = await api.request('/api/assistant/conversations/' + enc(this.conversation.id) + '/sources/' + enc(a.id), this.options());
        if (this.current(t) && this.sourceId === a.id) { this.setSource(result); this.polls = 0; this.schedule(); }
      }
    } catch (error) { if (this.current(t) && (a.type !== 'assistantSource' || this.sourceId === a.id)) this.fail(error); }
    if (this.ownerId === t.owner && this.version === t.version) this.sending = false;
    this.paint();
  }
}
module.exports = { Assistant };
