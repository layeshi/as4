// 居民提醒：订阅设置与提醒记录属于当前账号；网络结果需同时匹配账号、导航及读取版本。
// 微信订阅授权分两步：先在网络请求里准备授权编号，再由独立按钮的同步点击回调调用 requestSubscribeMessage。
const api = require('./utils/api');
const config = require('./config');

const KEYS = ['death', 'diary', 'runner_stopped', 'balance_low'];
const LABELS = { death: '居民死亡', diary: '新日记', runner_stopped: '托管异常停机', balance_low: '托管余额不足' };
const TIMING = { death: '发生后尽快提醒，夜间也提醒', diary: '每天 20:00 汇总当天新日记', runner_stopped: '模型持续不可用导致停机时提醒', balance_low: '余额不足以继续托管行动时提醒' };
const DELIVERY = { pending: '微信待发送', sent: '微信已发送', unavailable: '仅小程序内记录', failed: '微信发送失败', unknown: '微信结果未确认', cancelled: '微信已取消发送' };
const RESULTS = new Set(['accept', 'reject', 'ban']);
const MAX_TEMPLATES = 3;
const query = () => config.appid ? '?appid=' + encodeURIComponent(config.appid) : '';
const appid = () => config.appid ? { appid: config.appid } : {};

class Notifications {
  constructor(app) { this.app = app; this.ownerId = null; this.version = 0; this.reset(); }
  reset() {
    this.version++; this.summary = null; this.loading = false; this.error = '';
    this.records = []; this.hasMore = false; this.recordsLoaded = false; this.recordsLoading = false; this.recordsError = '';
    this.auth = { stage: 'idle', done: [] }; this.outcome = ''; this.promptDismissed = false;
    if (this.app.wx && this.app.wx.hideSubscribe) this.app.wx.hideSubscribe();
    if (this.app.loginRequired) delete this.app.loginRequired.notifications;
  }
  sync() {
    const id = this.app.user?.id || null;
    if (id !== this.ownerId) { this.reset(); this.ownerId = id; }
    return !!id;
  }
  ticket(scope) { return { ownerId: this.ownerId, version: this.version, read: this.app.beginRead(scope), scope }; }
  current(ticket) { return ticket.ownerId === this.app.user?.id && ticket.version === this.version && this.app.readCurrent(ticket.scope, ticket.read); }
  owned(ticket) { return ticket.ownerId === this.app.user?.id && ticket.version === this.version; }
  requireLogin() { if (!this.sync()) throw new Error('请先登录后管理居民提醒'); }
  fail(error) {
    if (error.status === 401 && error.sessionCurrent !== false) {
      if (error.code !== 'wechat_login_required') this.app.user = null;
      else this.app.loginRequired.notifications = 1;
      this.app.wechatVerified = false; this.reset(); this.ownerId = this.app.user?.id || null;
    }
  }

  // ── 订阅设置 ──
  types() {
    const listed = Array.isArray(this.summary?.types) ? this.summary.types : [];
    return KEYS.map(key => {
      const t = listed.find(item => item && item.key === key) || {};
      return { key, label: typeof t.label === 'string' && t.label ? t.label : LABELS[key], timing: TIMING[key], templateId: typeof t.templateId === 'string' && t.templateId ? t.templateId : null, available: t.available === true && typeof t.templateId === 'string' && !!t.templateId };
    });
  }
  label(key) { return (this.types().find(t => t.key === key) || {}).label || LABELS[key] || '居民动态'; }
  subscribed(agentId) {
    const row = (this.summary?.residents || []).find(r => r && r.agentId === agentId);
    return (row && Array.isArray(row.types) ? row.types : []).filter(key => KEYS.includes(key));
  }
  // 有微信模板、且至少一位居民已开启的提醒类型。
  wanted() {
    const on = new Set((this.summary?.residents || []).flatMap(r => Array.isArray(r?.types) ? r.types : []));
    return this.types().filter(t => t.available && on.has(t.key));
  }
  // 下一批待授权类型：去重后最多 3 个模板。
  nextBatch() {
    const types = [], templates = [];
    for (const t of this.wanted()) {
      if (this.auth.done.includes(t.key)) continue;
      if (!templates.includes(t.templateId)) { if (templates.length >= MAX_TEMPLATES) continue; templates.push(t.templateId); }
      types.push(t.key);
    }
    return types.length ? { types, templates } : null;
  }
  get wechatAvailable() { return this.types().some(t => t.available); }
  get needsPrompt() { return !!this.summary?.needsAuthorization && this.wechatAvailable && !this.promptDismissed; }
  async load({ quiet = false } = {}) {
    if (!this.sync()) return;
    const ticket = this.ticket('notifications');
    this.loading = true; if (!quiet) this.error = ''; this.app.invalidate(); this.app.render();
    try {
      const data = await api.request('/api/wechat/notifications' + query());
      if (!this.current(ticket)) return;
      this.summary = { types: Array.isArray(data.types) ? data.types : [], residents: Array.isArray(data.residents) ? data.residents : [], bindingReady: data.bindingReady === true, needsAuthorization: data.needsAuthorization === true };
      this.error = '';
    } catch (error) {
      if (!this.current(ticket)) return;
      this.fail(error); if (!quiet) this.error = error.message;
    } finally { if (this.app.readVersions.notifications === ticket.read.version) { this.loading = false; this.app.invalidate(); this.app.render(); } }
  }
  async save(agentId, types) {
    this.requireLogin();
    if (!this.summary) throw new Error('提醒设置尚未读取，请刷新后重试');
    if (!(this.app.linked || []).some(a => (a.agentId || a.id) === agentId)) throw new Error('你已不再管理这位居民，请刷新后重试');
    const ticket = { ownerId: this.ownerId, version: this.version };
    const next = KEYS.filter(key => types.includes(key));
    try {
      await api.request('/api/wechat/notifications/preferences', { method: 'POST', data: { ...appid(), agentId, types: next } });
    } catch (error) { if (this.owned(ticket)) this.fail(error); throw error; }
    if (!this.owned(ticket) || !this.summary) return;
    const residents = this.summary.residents.filter(r => r && r.agentId !== agentId);
    if (next.length) residents.push({ agentId, types: next });
    this.summary.residents = residents;
    this.auth.done = this.auth.done.filter(key => next.includes(key) || residents.some(r => r.types.includes(key)));
    this.app.showToast(next.length ? '提醒已更新' : '已关闭这位居民的全部提醒', 'ok');
  }
  toggle(agentId, key) {
    if (!KEYS.includes(key)) return;
    const on = this.subscribed(agentId);
    return this.save(agentId, on.includes(key) ? on.filter(k => k !== key) : on.concat(key));
  }

  // ── 微信订阅授权 ──
  async prepare(restart = false) {
    this.requireLogin();
    if (!this.summary?.bindingReady) throw new Error('请先微信登录，再授权微信提醒');
    if (restart) this.auth.done = [];
    const batch = this.nextBatch();
    if (!batch) throw new Error(this.wanted().length ? '已开启的提醒都已完成本轮授权' : '请先开启至少一项可发送微信通知的提醒');
    const ticket = { ownerId: this.ownerId, version: this.version };
    this.outcome = '';
    let data;
    try {
      data = await api.request('/api/wechat/notifications/authorization', { method: 'POST', data: { ...appid(), types: batch.types } });
    } catch (error) { if (this.owned(ticket)) this.fail(error); throw error; }
    if (!this.owned(ticket)) return;
    const templates = [...new Set((Array.isArray(data.templates) ? data.templates : []).filter(id => typeof id === 'string' && id))].slice(0, MAX_TEMPLATES);
    if (typeof data.ticket !== 'string' || !data.ticket || !templates.length) {
      this.auth = { stage: 'idle', done: this.auth.done.concat(batch.types) }; this.outcome = 'unavailable';
      return;
    }
    this.auth = { stage: 'ready', done: this.auth.done, ticket: data.ticket, templates, types: batch.types, owner: ticket };
    this.showNativePrompt();
  }
  // 普通小程序的 Canvas 触摸不是 tap 手势；由页面的原生按钮在 bindtap 中同步调用订阅接口。
  showNativePrompt() {
    const a = this.auth;
    if (a.stage !== 'ready' || !this.app.wx.showSubscribe) return false;
    this.app.wx.showSubscribe({
      title: '授权微信提醒', label: '授权微信提醒',
      body: '微信会列出本次可授权的提醒。每次同意只对应有限次数的通知；勾选“总是保持以上选择”也不代表无限次推送。',
      tmplIds: a.templates.slice(),
      complete: result => this.finish(a, result),
      fail: error => this.failAuth(a, error),
    });
    return true;
  }
  // 必须在点击回调里同步执行到 requestSubscribeMessage，不能先等待网络。
  authorize() {
    const a = this.auth;
    if (a.stage !== 'ready') throw new Error('请先准备微信授权');
    if (this.showNativePrompt()) return;
    if (!this.app.wx.requestSubscribeMessage) throw new Error('当前微信版本不支持订阅提醒，请升级微信后重试');
    a.stage = 'requesting';
    return new Promise(resolve => {
      this.app.wx.requestSubscribeMessage({ tmplIds: a.templates.slice(), success: result => resolve(this.finish(a, result)), fail: error => resolve(this.failAuth(a, error)) });
    });
  }
  async finish(a, response) {
    if (this.auth !== a || !this.owned(a.owner)) return;
    const results = {};
    for (const id of a.templates) if (response && RESULTS.has(response[id])) results[id] = response[id];
    const values = Object.values(results);
    if (!values.length) { this.close(a, 'failed'); return; }
    a.stage = 'submitting'; this.app.invalidate(); this.app.render();
    try {
      await api.request('/api/wechat/notifications/authorization/result', { method: 'POST', data: { ticket: a.ticket, results } });
    } catch (error) {
      if (this.auth !== a || !this.owned(a.owner)) return;
      this.fail(error); this.close(a, 'failed');
      this.app.showToast('授权结果未保存：' + error.message, 'error'); return;
    }
    if (this.auth !== a || !this.owned(a.owner)) return;
    const outcome = values.includes('ban') ? 'banned' : values.every(v => v === 'accept') ? 'accepted' : values.includes('accept') ? 'partial' : 'rejected';
    this.close(a, outcome, a.types);
    this.app.showToast(outcome === 'accepted' ? '已授权微信提醒' : outcome === 'partial' ? '部分微信提醒已授权' : '未授权微信提醒，小程序内记录照常保留', outcome === 'accepted' || outcome === 'partial' ? 'ok' : 'error');
    await this.load({ quiet: true });
  }
  failAuth(a, error) {
    if (this.auth !== a || !this.owned(a.owner)) return;
    // 20004：用户关闭了小程序的通知主开关。
    this.close(a, error && Number(error.errCode) === 20004 ? 'switchOff' : 'failed');
  }
  close(a, outcome, done = []) {
    this.auth = { stage: 'idle', done: a.done.concat(done) }; this.outcome = outcome;
    if (this.app.wx.hideSubscribe) this.app.wx.hideSubscribe();
    this.app.invalidate(); this.app.render();
  }
  skip() {
    this.auth = { stage: 'idle', done: this.auth.done }; this.promptDismissed = true;
    if (this.app.wx.hideSubscribe) this.app.wx.hideSubscribe();
  }

  // ── 提醒记录 ──
  async loadRecords(more = false) {
    if (!this.sync()) return;
    if (more && (!this.hasMore || this.recordsLoading || !this.records.length)) return;
    const ticket = this.ticket('notificationRecords');
    this.recordsLoading = true; this.recordsError = ''; this.app.invalidate(); this.app.render();
    try {
      const before = more ? '&before=' + encodeURIComponent(this.records[this.records.length - 1].id) : '';
      const data = await api.request('/api/wechat/notifications/records?limit=30' + before);
      if (!this.current(ticket)) return;
      const rows = (Array.isArray(data.records) ? data.records : []).filter(r => r && r.id && r.agentId);
      this.records = [...new Map((more ? this.records.concat(rows) : rows).map(r => [r.id, r])).values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      this.hasMore = data.hasMore === true && rows.length > 0; this.recordsLoaded = true;
    } catch (error) {
      if (!this.current(ticket)) return;
      this.fail(error); this.recordsError = error.message;
    } finally { if (this.app.readVersions.notificationRecords === ticket.read.version) { this.recordsLoading = false; this.app.invalidate(); this.app.render(); } }
  }
  get unread() { return this.records.filter(r => !r.readAt).length; }
  async markRead(ids) {
    ids = [...new Set(ids)].slice(0, 100);
    if (!ids.length) return;
    const ticket = { ownerId: this.ownerId, version: this.version };
    try { await api.request('/api/wechat/notifications/records/read', { method: 'POST', data: { ids } }); }
    catch (error) { if (this.owned(ticket)) this.fail(error); throw error; }
    if (!this.owned(ticket)) return;
    const now = Date.now();
    for (const r of this.records) if (ids.includes(r.id) && !r.readAt) r.readAt = now;
  }
  // 详情走现有居民接口，由服务端重新验证当前管理权。
  async open(id) {
    this.requireLogin();
    const record = this.records.find(r => r.id === id);
    if (!record) throw new Error('提醒记录已变更，请刷新后重试');
    if (!record.readAt) await this.markRead([id]).catch(() => {});
    try { await this.app.handle({ type: 'owner', id: record.agentId }); }
    catch (error) {
      if ([403, 404].includes(error.status)) throw new Error('你已不再管理这位居民，无法查看提醒详情');
      throw error;
    }
  }
  async refresh() {
    await this.app.loadAccount();
    if (this.app.tab === 'notifications') await this.load();
    else if (this.app.tab === 'notificationRecords') await this.loadRecords();
  }
  async handle(action) {
    switch (action.type) {
      case 'notifications': this.sync(); this.app.push('notifications'); await this.app.loadAccount(); await this.load(); break;
      case 'notificationRecords': this.sync(); this.app.push('notificationRecords'); await this.loadRecords(); break;
      case 'notificationToggle': await this.toggle(action.agentId, action.key); break;
      case 'notificationAllOff': await this.save(action.agentId, []); break;
      case 'notificationPrepare': await this.prepare(!!action.restart); break;
      case 'notificationAuthorize': await this.authorize(); break;
      case 'notificationSkip': this.skip(); break;
      case 'notificationPromptLater': this.promptDismissed = true; break;
      case 'notificationRecordsMore': await this.loadRecords(true); break;
      case 'notificationOpen': await this.open(action.id); break;
      case 'notificationReadAll': await this.markRead(this.records.filter(r => !r.readAt).map(r => r.id)); this.app.showToast('已全部标为已读', 'ok'); break;
      case 'notificationRefresh': await this.refresh(); break;
      default: break;
    }
  }
}
module.exports = { Notifications, KEYS, LABELS, DELIVERY };
