// 本人居民记录（与网站 public/residents.js 的只读部分同一组接口）：分页、生涯时间线、流水 CSV 下载与分享。
// 小程序只查看已有记录；居民的创建、领养、过继、模型与上限设置都不在这里提供。
// 含文字的读取经 api.js 改写到 /api/wechat/…审核代理。
const api = require('./utils/api');

const TABS = ['overview', 'ledger', 'actions', 'usage', 'timeline'];

class ResidentRecords {
  constructor(app) { this.app = app; this.reset(); }
  reset() { this.tab = 'overview'; this.timeline = null; this.saved = null; }
  ticket(scope) { return { read: this.app.beginRead('records:' + scope), user: this.app.user && this.app.user.id }; }
  current(scope, t) { return this.app.readCurrent('records:' + scope, t.read) && (this.app.user && this.app.user.id) === t.user; }
  /** 读取请求：失败时若已离开页面、换了账号或被更新的读取取代，标记为过期，调用方静默丢弃。 */
  read(scope, t, path) {
    return api.request(path).catch(error => { if (!this.current(scope, t)) error.stale = true; throw error; });
  }
  async loadTimeline(reset) {
    const app = this.app, id = app.residentId, f = app.form, tl = this.timeline && this.timeline.id === id && !reset ? this.timeline : { id, rows: [], cursor: null, type: (f.timelineType || '').trim(), day: (f.timelineDay || '').trim(), loaded: false };
    if (tl.day && !/^[1-9]\d{0,5}$/.test(tl.day)) throw new Error('世界日须为正整数');
    if (tl.type && !/^[a-z_]{1,40}$/.test(tl.type)) throw new Error('事件类型只含小写字母与下划线');
    const q = ['limit=50'];
    if (tl.type) q.push('type=' + encodeURIComponent(tl.type));
    if (tl.day) q.push('day=' + (Number(tl.day) - 1));
    if (!reset && tl.cursor) q.push('cursor=' + encodeURIComponent(tl.cursor));
    const t = this.ticket('timeline');
    const data = await this.read('timeline', t, '/api/account/residents/' + encodeURIComponent(id) + '/events?' + q.join('&'));
    if (!this.current('timeline', t) || app.residentId !== id) return;
    tl.rows = (reset || !tl.loaded ? [] : tl.rows).concat(data.events || []); tl.cursor = data.cursor || null; tl.loaded = true;
    this.timeline = tl;
    app.rememberModeration('owner', data);
  }

  async handle(a) {
    try { await this.act(a); }
    catch (error) { if (!error.stale) throw error; }
  }
  async act(a) {
    const app = this.app, id = app.residentId;
    switch (a.type) {
      case 'recordsTab':
        if (!TABS.includes(a.tab)) return;
        this.tab = a.tab; app.scroller().scrollTo(0);
        if (a.tab === 'timeline' && (!this.timeline || this.timeline.id !== id)) await this.loadTimeline(true);
        return;
      case 'recordsTimelineFilter': await this.loadTimeline(true); return;
      case 'recordsTimelineMore': if (this.timeline && this.timeline.cursor) await this.loadTimeline(false); return;
      case 'recordsLedgerCsv': {
        const t = this.ticket('csv');
        const filePath = await api.download('/api/account/residents/' + encodeURIComponent(id) + '/export?format=csv').catch(error => { if (!this.current('csv', t) || app.residentId !== id) error.stale = true; throw error; });
        if (!this.current('csv', t) || app.residentId !== id) return;
        this.saved = { id, filePath }; app.showToast('流水已下载，可分享或保存', 'ok'); return;
      }
      case 'recordsLedgerShare':
        if (!this.saved || this.saved.id !== id) return;
        if (app.wx.shareFileMessage) app.wx.shareFileMessage({ filePath: this.saved.filePath, fileName: id + '-ledger.csv', fail: () => app.showToast('未保存或分享文件，可再次操作', 'error') });
        else app.showToast('当前微信版本不支持分享文件，请在网页「收支」导出', 'error');
        return;
      default: return;
    }
  }
}
module.exports = { ResidentRecords, RECORD_TABS: TABS };
