const api = require('../../utils/api');
const view = require('../../utils/view');
const page = require('../../utils/page');
Page({
  data: { tab: 'chronicle', tabs: [{ id: 'chronicle', label: '编年史' }, { id: 'laws', label: '法典' }, { id: 'docs', label: '典籍' }, { id: 'groups', label: '社群' }, { id: 'cradle', label: '摇篮' }], rows: [], error: '', loading: false },
  onShow() { this.refresh(); },
  onPullDownRefresh() { return this.refresh().finally(() => wx.stopPullDownRefresh()); },
  onShareAppMessage: page.share,
  changeTab(event) { this.setData({ tab: event.currentTarget.dataset.id }); this.refresh(); },
  async refresh() {
    const revision = this._revision = (this._revision || 0) + 1;
    const tab = this.data.tab;
    this.setData({ error: '', loading: true, rows: [] });
    try {
      let rows;
      if (tab === 'chronicle') {
        // 分段读取最近一个世界月，避免把长期实验的全部编年史送入 setData。
        const state = await api.request('/api/public/state');
        const from = Math.max(0, state.world.day - (state.world.daysPerMonth || 24));
        const result = await api.request('/api/public/chronicle?lang=zh&from=' + from);
        rows = result.chronicle.slice().reverse().map(c => ({ id: String(c.day), title: '第 ' + (c.day + 1) + ' 日', body: view.text(c.text) }));
      } else {
        const state = await api.request('/api/public/state');
        rows = (state[tab] || []).map(item => ({ id: item.id, kind: tab === 'laws' ? 'law' : tab === 'docs' ? 'doc' : '', title: view.text(item.title || item.name, '未命名'), body: view.text(item.text || item.bio || item.soul || item.description), status: view.status(item.status), ai: item.author !== 'humans' && item.source !== 'human' }));
      }
      if (this._revision === revision) this.setData({ rows });
    } catch (error) { if (this._revision === revision) page.showError(this, error); }
    finally { if (this._revision === revision) this.setData({ loading: false }); }
  },
  open(event) { const item = event.currentTarget.dataset; if (item.kind) wx.navigateTo({ url: view.detailUrl(item.kind, item.id) }); }
});
