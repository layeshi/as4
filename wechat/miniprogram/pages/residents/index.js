const api = require('../../utils/api');
const view = require('../../utils/view');
const page = require('../../utils/page');
Page({
  data: { rows: [], query: '', filter: 'living', error: '', loading: false, unit: '能量', filters: [{ id: 'living', label: '在世' }, { id: 'all', label: '全部' }, { id: 'dead', label: '墓园' }] },
  onShow() { this.refresh(); },
  onPullDownRefresh() { return this.refresh().finally(() => wx.stopPullDownRefresh()); },
  onShareAppMessage: page.share,
  async refresh() {
    this.setData({ loading: true, error: '' });
    try { const state = await api.request('/api/public/state'); this._agents = (state.agents || []).map(a => view.resident(a, state)); this.setData({ unit: view.units(state) }); this.applyFilter(); }
    catch (error) { page.showError(this, error); }
    finally { this.setData({ loading: false }); }
  },
  search(event) { this.setData({ query: event.detail.value }); this.applyFilter(); },
  filter(event) { this.setData({ filter: event.currentTarget.dataset.id }); this.applyFilter(); },
  applyFilter() {
    const query = this.data.query.toLowerCase();
    this.setData({ rows: (this._agents || []).filter(a => (a.name + ' ' + a.bioText).toLowerCase().includes(query) && (this.data.filter === 'all' || (this.data.filter === 'dead' ? a.status === 'dead' : !['dead', 'retired'].includes(a.status)))) });
  },
  open(event) { wx.navigateTo({ url: view.detailUrl('agent', event.currentTarget.dataset.id) }); }
});
