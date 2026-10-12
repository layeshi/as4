const api = require('../../utils/api');
const page = require('../../utils/page');
const view = require('../../utils/view');
Page({
  data: { user: null, registrationOpen: false, mode: 'login', username: '', password: '', displayName: '', accepted: false, rows: [], error: '', busy: false },
  input: page.input,
  onShow() { this.refresh(); },
  onHide() { this.setData({ password: '' }); },
  onPullDownRefresh() { return this.refresh().finally(() => wx.stopPullDownRefresh()); },
  async refresh() {
    this.setData({ error: '' });
    try {
      const account = await api.request('/api/account');
      this.setData({ user: account.user, registrationOpen: account.registrationOpen, rows: [] });
      if (account.user) {
        const result = await api.request('/api/account/agents');
        this.setData({ rows: result.agents.map(a => ({ id: a.agentId, name: a.name, status: view.status(a.status), runner: view.status(a.runnerStatus) })) });
      }
    } catch (error) { page.showError(this, error); }
  },
  mode(event) { this.setData({ mode: event.currentTarget.dataset.mode, password: '', error: '' }); },
  consent(event) { this.setData({ accepted: event.detail.value.includes('accepted') }); },
  async submit() {
    if (this.data.busy) return;
    if (!this.data.accepted) { this.setData({ error: '请先阅读并同意隐私说明。' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      await api.request('/api/account/' + this.data.mode, { method: 'POST', data: { username: this.data.username.trim(), password: this.data.password, displayName: this.data.displayName.trim() || this.data.username.trim() }, timeout: 30000 });
      this.setData({ password: '' }); await this.refresh();
    } catch (error) { page.showError(this, error); }
    finally { this.setData({ busy: false }); }
  },
  async logout() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await api.request('/api/account/logout', { method: 'POST', data: {} });
      api.clearSession(); getApp().globalData.ownerKey = ''; getApp().globalData.ownerAgent = null;
      this.setData({ user: null, rows: [] });
    } catch (error) { page.showError(this, error); }
    finally { this.setData({ busy: false }); }
  },
  owner() { wx.navigateTo({ url: '/pages/owner/index' }); },
  entry() { wx.navigateTo({ url: '/pages/entry/index' }); },
  about() { wx.navigateTo({ url: '/pages/about/index' }); },
  openAgent(event) { wx.navigateTo({ url: view.detailUrl('agent', event.currentTarget.dataset.id) }); }
});
