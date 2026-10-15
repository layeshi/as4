// 与网页共用的管理员公告：公开阅读，无微信登录依赖，也不触发居民文字投影。
const api = require('./utils/api');
class Announcements {
  constructor(app) {
    this.app = app; this.items = []; this.latest = null; this.latestError = ''; this.detail = null; this.detailId = '';
    this.cursor = null; this.total = 0; this.loaded = false; this.loading = false; this.error = ''; this.versions = {};
  }
  async read(scope, path, apply) {
    const version = (this.versions[scope] || 0) + 1; this.versions[scope] = version;
    try {
      const data = await api.request(path);
      if (version !== this.versions[scope]) return;
      apply(data);
    } catch (error) {
      if (version !== this.versions[scope]) return;
      if (scope === 'latest') { this.latest = null; this.latestError = error.message; }
      else { this.error = error.message; if (scope === 'detail') this.detail = null; }
    } finally {
      if (version === this.versions[scope]) {
        if (scope !== 'latest') this.loading = false;
        this.app.invalidate(); this.app.render();
      }
    }
  }
  async loadLatest() {
    if (!this.app.entered) return;
    return this.read('latest', '/api/announcements/latest', data => { this.latest = data.announcement; this.latestError = ''; });
  }
  async load(more = false) {
    if (!this.app.entered || more && (this.loading || !this.cursor)) return;
    this.loading = true; this.error = ''; this.app.invalidate(); this.app.render();
    return this.read('list', '/api/announcements' + (more ? '?cursor=' + this.cursor : ''), data => {
      const items = data.announcements || [];
      this.items = more ? this.items.concat(items.filter(item => !this.items.some(old => old.id === item.id))) : items;
      this.cursor = data.nextCursor; this.total = data.total; this.loaded = true;
    });
  }
  async loadDetail(id) {
    if (!this.app.entered) return;
    this.detailId = id; this.detail = null; this.loading = true; this.error = ''; this.app.invalidate(); this.app.render();
    return this.read('detail', '/api/announcements/' + encodeURIComponent(id), data => { this.detail = data.announcement; });
  }
  async refresh() { return this.app.tab === 'announcement' ? this.loadDetail(this.detailId) : this.load(); }
  async handle(action) {
    if (action.type === 'announcements') { this.app.push('announcements'); return this.load(); }
    if (action.type === 'announcement') { this.app.push('announcement'); return this.loadDetail(action.id); }
    if (action.type === 'announcementMore') return this.load(true);
    if (action.type === 'announcementLatest') return this.loadLatest();
    return this.refresh();
  }
}
module.exports = { Announcements };
