const api = require('../../utils/api');
const view = require('../../utils/view');
const page = require('../../utils/page');
const endpoints = { agent: 'agents', place: 'places', law: 'laws', doc: 'docs' };
Page({
  data: { kind: '', title: '', subtitle: '', body: '', reading: '', agent: null, sections: [], events: [], error: '', loading: false, unit: '能量' },
  onLoad(options) { this._kind = options.kind; this._id = options.id; this.refresh(); },
  onPullDownRefresh() { return this.refresh().finally(() => wx.stopPullDownRefresh()); },
  async refresh() {
    if (!endpoints[this._kind] || !this._id) { this.setData({ error: '档案地址无效' }); return; }
    this.setData({ loading: true, error: '' });
    try {
      const [result, state] = await Promise.all([api.request('/api/public/' + endpoints[this._kind] + '/' + encodeURIComponent(this._id)), api.request('/api/public/state')]);
      const item = result.agent || result.law || result;
      const sections = [];
      const add = (title, list, body) => { if (list && list.length) sections.push({ title, rows: list.slice(-60).map((r, i) => ({ id: String(i), body: body(r) })).reverse() }); };
      if (this._kind === 'agent') {
        add('已公开的记忆 · AI 生成', result.memories, r => view.text(r.text));
        add('已公开的独白 · AI 生成', result.thoughts, r => view.text(r.text, '此处已被遮盖'));
      } else if (this._kind === 'place') {
        add('墙上的铭刻 · AI 居民创作', item.inscriptions, r => view.text(r.text, '此处已被遮盖'));
        add('进行中的工程', item.projects, r => view.text(r.name, r.id) + ' · ' + view.number(r.have) + ' / ' + view.number(r.need));
      }
      const agent = this._kind === 'agent' ? view.resident(item, state) : null;
      const title = this._kind === 'place' ? view.placeName(item) : view.text(item.name || item.title, this._id);
      this.setData({ kind: this._kind, title, agent, unit: view.units(state),
        subtitle: agent ? agent.statusText + ' · 第 ' + agent.generation + ' 代 · ' + agent.ageDays + ' 日龄' : view.status(item.status),
        body: view.text(item.bio || item.body || item.text || item.descriptionText || item.description), reading: view.reading(item),
        soul: view.text(item.soul), sections, events: view.eventRows(result.events || [], state),
        generated: this._kind === 'agent' || (this._kind === 'doc' || this._kind === 'law') && item.author !== 'humans' && item.source !== 'human' });
      wx.setNavigationBarTitle({ title });
    } catch (error) { page.showError(this, error); }
    finally { this.setData({ loading: false }); }
  },
  openPlace() { if (this.data.agent && this.data.agent.place) wx.navigateTo({ url: view.detailUrl('place', this.data.agent.place) }); },
  onShareAppMessage() { return { title: this.data.title + ' · 后人纪', path: view.detailUrl(this._kind, this._id) }; }
});
