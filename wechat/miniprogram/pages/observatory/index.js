const api = require('../../utils/api');
const view = require('../../utils/view');
const page = require('../../utils/page');
const config = require('../../config');
Page({
  data: { state: null, map: null, events: [], places: [], error: '', loading: false, unit: '能量' },
  onShow() { this._visible = true; this.refresh(); },
  onHide() { this._visible = false; clearTimeout(this._timer); },
  onUnload() { this.onHide(); },
  onPullDownRefresh() { return this.refresh().finally(() => wx.stopPullDownRefresh()); },
  onShareAppMessage: page.share,
  async refresh() {
    clearTimeout(this._timer);
    if (this._busy) return;
    this._busy = true; this.setData({ loading: true, error: '' });
    try {
      const [state, events, map] = await Promise.all([
        api.request('/api/public/state'), api.request('/api/public/events?recent=1&limit=60'),
        this.data.map ? Promise.resolve(this.data.map) : api.request('/api/public/map')
      ]);
      // 谢幕后新世界可能采用另一张地图，不能继续显示旧的地图。
      let currentMap = map;
      if (this.data.state && (this.data.state.world.id !== state.world.id || this.data.state.world.map !== state.world.map)) currentMap = await api.request('/api/public/map');
      const agents = state.agents || [];
      const mapState = { world: state.world, roads: state.roads || [],
        agents: agents.map(a => ({ id: a.id, place: a.place, status: a.status })),
        places: (state.places || []).map(p => ({ id: p.id, name: p.name, displayName: p.displayName, humanName: p.humanName, xy: p.xy, ruined: p.ruined, razed: p.razed })) };
      this.setData({ state: mapState, map: currentMap, unit: view.units(state), events: view.eventRows(events.events, state),
        awake: agents.filter(a => a.status === 'awake').length, population: agents.filter(a => !['dead', 'retired'].includes(a.status)).length,
        treasury: view.number(state.treasury && (state.treasury.energy ?? state.treasury.tokens)),
        places: (state.places || []).map(p => ({ id: p.id, name: view.placeName(p), count: agents.filter(a => a.place === p.id).length })) });
    } catch (error) { page.showError(this, error); }
    finally {
      this._busy = false; this.setData({ loading: false });
      if (this._visible) this._timer = setTimeout(() => this.refresh(), config.pollMs);
    }
  },
  openPlace(event) { const id = event.detail.id || event.currentTarget.dataset.id; wx.navigateTo({ url: view.detailUrl('place', id) }); }
});
