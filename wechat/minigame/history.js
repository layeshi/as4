// 报告与导出共用账号会话；旧账号或旧页面的响应不能覆盖当前页面。
const api = require('./utils/api');
class History {
  constructor(app) { this.app = app; this.ownerId = null; this.reset(); }
  reset() { this.version = (this.version || 0) + 1; this.reports = []; this.jobs = []; this.branches = []; this.report = null; this.reportBranchId = null; this.branchId = null; this.agentId = null; this.kind = 'day'; this.page = 1; this.total = 0; this.saved = null; this.error = ''; this.requestId = null; this.loading = false; }
  sync() { const id = this.app.user?.id || null; if (id !== this.ownerId) { this.reset(); this.ownerId = id; } return !!id; }
  ticket() { return { user: this.ownerId, version: this.version, read: this.app.beginRead('history') }; }
  current(t) { return t.user === this.app.user?.id && t.version === this.version && this.app.readCurrent('history', t.read); }
  async refresh() {
    if (!this.sync()) return;
    const t = this.ticket(); this.loading = true; this.error = ''; this.app.invalidate(); this.app.render();
    try {
      if (this.app.tab === 'reports') {
        const [data, branches] = await Promise.all([api.request(`/api/reports?kind=${this.kind}&page=${this.page}${this.reportBranchId ? '&branchId=' + encodeURIComponent(this.reportBranchId) : ''}`), api.request('/api/history/branches')]);
        if (!this.current(t)) return; this.reports = data.reports; this.total = data.total; this.branches = branches.branches; this.app.rememberModeration('reports', data);
      } else if (this.app.tab === 'worldReport') {
        const data = await api.request('/api/reports/' + encodeURIComponent(this.reportId));
        if (!this.current(t)) return; this.report = data; this.app.rememberModeration('worldReport', data);
      } else {
        const [branches, jobs] = await Promise.all([api.request('/api/history/branches'), api.request('/api/history/exports')]);
        if (!this.current(t)) return; this.branches = branches.branches; this.jobs = jobs.exports; this.app.rememberModeration(this.app.tab, branches, jobs);
        const owned = this.branches.filter(b => b.residents.length);
        if (!owned.some(b => b.id === this.branchId)) this.branchId = owned.find(b => b.active)?.id || owned[0]?.id;
        const branch = this.branches.find(b => b.id === this.branchId);
        if (!branch?.residents.some(r => r.id === this.agentId)) this.agentId = branch?.residents[0]?.id;
      }
    } catch (error) {
      if (!this.current(t)) return;
      if (error.status === 401 && error.sessionCurrent !== false) { if (error.code !== 'wechat_login_required') this.app.user = null; else this.app.loginRequired[this.app.tab] = 1; this.reset(); }
      this.error = error.message;
    } finally { if (t.version === this.version) this.loading = false; this.app.invalidate(); this.app.render(); }
  }
  async handle(a) {
    this.sync();
    if (a.type === 'historyReports') { this.app.push('reports'); return this.refresh(); }
    if (a.type === 'historyReport') { this.reportId = a.id; this.report = null; this.app.push('worldReport'); return this.refresh(); }
    if (a.type === 'historyOpen') { this.agentId = a.id || this.app.residentId; this.app.push('historyExport'); return this.refresh(); }
    if (a.type === 'historyRecords') { this.app.push('exports'); return this.refresh(); }
    if (a.type === 'historyKind') { this.kind = a.kind; this.page = 1; return this.refresh(); }
    if (a.type === 'historyReportBranch') { this.reportBranchId = a.id; this.page = 1; return this.refresh(); }
    if (a.type === 'historyPage') { this.page = Math.max(1, Math.min(Math.ceil(this.total / 30) || 1, this.page + a.delta)); return this.refresh(); }
    if (a.type === 'historyBranch') { this.branchId = a.id; this.agentId = this.branches.find(b => b.id === a.id)?.residents[0]?.id; this.app.invalidate(); return; }
    if (a.type === 'historyResident') { this.agentId = a.id; this.app.invalidate(); return; }
    if (a.type === 'historyRefresh') return this.refresh();
    if (!this.ownerId) throw Error('请先登录后查看居民历史');
    const t = this.ticket();
    if (a.type === 'historyCreate') {
      const f = this.app.form, body = { branchId: this.branchId, agentId: this.agentId, ...(f.historyFrom ? { fromDay: Number(f.historyFrom) - 1 } : {}), ...(f.historyTo ? { toDay: Number(f.historyTo) - 1 } : {}) };
      const draft = JSON.stringify(body); if (draft !== this.draft) { this.draft = draft; this.requestId = api.requestId(); }
      await api.request('/api/history/exports', { method: 'POST', data: { ...body, requestId: this.requestId } });
      if (!this.current(t)) return; this.requestId = null; this.draft = null; this.app.push('exports'); await this.refresh(); this.app.showToast('已开始生成，可以离开后再回来下载', 'ok');
    } else if (a.type === 'historyRetry') {
      await api.request('/api/history/exports/' + encodeURIComponent(a.id) + '/retry', { method: 'POST', data: {} }); if (this.current(t)) await this.refresh();
    } else if (a.type === 'historyDownload') {
      const filePath = await api.download('/api/history/exports/' + encodeURIComponent(a.id) + '/download');
      if (!this.current(t)) return; this.saved = { id: a.id, filePath }; this.app.showToast('历史包已下载', 'ok'); this.app.invalidate();
    } else if (a.type === 'historyShare' && this.saved) {
      if (this.app.wx.shareFileMessage) this.app.wx.shareFileMessage({ filePath: this.saved.filePath, fileName: '居民历史.zip', fail: () => this.app.showToast('未保存或分享文件，可再次操作', 'error') });
      else this.app.wx.setClipboardData({ data: require('./config').apiBase + '/history.html', success: () => this.app.showToast('已复制网页入口，可登录同一账号下载', 'ok') });
    }
  }
}
module.exports = { History };
