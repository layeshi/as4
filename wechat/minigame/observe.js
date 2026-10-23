// 观测扩展：统计与注意力、天象与遗产、交易所、物料·研究·工程、知识与协作。
// 与网站 public/e2-tabs.js、tabs2.js、market-ui.js、materials-ui.js、project-ui.js、cooperation-ui.js 同一套只读接口；
// 请求经 api.js 改写到 /api/wechat/public/…，文字全部经服务端审核投影。这里不提交任何居民行动。
const api = require('./utils/api');

const PAGES = ['metrics', 'weather', 'legacy', 'market', 'materials', 'projectAudit', 'cooperation', 'cooperationDetail'];
const MARKET_ENDPOINTS = { services: '/api/public/services', demands: '/api/public/demands', orders: '/api/public/orders' };
const PAGE_SIZE = 20;

class Observe {
  constructor(app) {
    this.app = app;
    this.reset();
  }
  reset() {
    this.metrics = null; this.attention = null; this.weather = null; this.legacy = null;
    this.market = { view: 'services', agent: '', status: '', kind: '', cursors: [null], rows: null, next: null, error: '' };
    this.materials = { zones: null, research: null, projects: null, projectCursors: [null], projectNext: null, observations: null, observationCursors: [null], observationNext: null, error: '' };
    this.project = null; // { id, data, after, error }
    this.coop = { kind: 'cards', rows: null, next: null, error: '', detail: null, detailError: '' };
    this.errors = {};
    this.worldKey = null;
  }
  static pages() { return PAGES; }
  // 换了世界（新纪元）就丢掉筛选与页码，和网站 market-ui 的 worldKey 一样。
  syncWorld() {
    const w = this.app.state && this.app.state.world, key = w ? w.id + ':' + w.epoch : null;
    if (key === this.worldKey) return;
    if (this.worldKey !== null) this.reset();
    this.worldKey = key;
  }
  read(scope, path) {
    const app = this.app, ticket = app.beginRead('observe:' + scope);
    // 失败也要分清新旧：离开页面、退出登录或被更新的读取取代后，旧请求的失败不得改动新页面的数据或报错。
    return api.request(path).then(data => ({ data, current: () => app.readCurrent('observe:' + scope, ticket) }), error => {
      if (!app.readCurrent('observe:' + scope, ticket)) error.stale = true;
      throw error;
    });
  }
  remember(...responses) { this.app.rememberModeration(this.app.tab, ...responses.filter(r => r && !Array.isArray(r))); }
  cityQuery() { const f = this.app.cityFocus; return f && this.app.state && this.app.state.cities ? '&city=' + encodeURIComponent(f) : ''; }

  async open(page) {
    this.syncWorld();
    this.app.push(page);
    this.app.render();
    await this.load(page);
  }
  async refresh() {
    const app = this.app;
    app.refreshing = true; app.render();
    try { await this.load(app.tab, { refresh: true }); app.error = ''; }
    catch (error) { this.errors[app.tab] = error.message; app.showToast(error.message, 'error'); }
    finally { app.refreshing = false; app.invalidate(); app.render(); app.schedule(); }
  }
  async load(page) {
    this.errors[page] = '';
    try {
      if (page === 'metrics') return await this.loadMetrics();
      if (page === 'weather') return await this.loadWeather();
      if (page === 'legacy') return await this.loadLegacy();
      if (page === 'market') return await this.loadMarket();
      if (page === 'materials') return await this.loadMaterials();
      if (page === 'projectAudit') return await this.loadProject(false);
      if (page === 'cooperation') return await this.loadCooperation(false);
      if (page === 'cooperationDetail') return await this.loadCooperationDetail(this.coop.detail && this.coop.detail.id, this.coop.detail && this.coop.detail.edition);
    } catch (error) {
      if (error.stale) return;
      this.errors[page] = error.message;
      throw error;
    }
  }
  async loadMetrics() {
    const premise = this.app.state && this.app.state.world.premise;
    const [m, a] = await Promise.all([this.read('metrics', '/api/public/metrics'), premise >= 2 ? this.read('attention', '/api/public/attention?days=30').catch(() => null) : null]);
    if (!m.current()) return;
    this.metrics = m.data.metrics || [];
    this.attention = a && a.current() && Array.isArray(a.data.days) ? a.data.days : a ? this.attention : null;
    this.remember(m.data, a && a.data);
  }
  async loadWeather() {
    const r = await this.read('weather', '/api/public/weather?lang=zh' + this.cityQuery());
    if (!r.current()) return;
    this.weather = Object.assign({ focus: this.app.cityFocus || null }, r.data);
    this.remember(r.data);
  }
  async loadLegacy() {
    const r = await this.read('legacy', '/api/public/legacy');
    if (!r.current()) return;
    this.legacy = r.data.legacy || null;
    this.remember(r.data);
  }
  async loadMarket() {
    const m = this.market, view = m.view, q = ['limit=' + PAGE_SIZE, 'lang=zh'];
    if (m.agent) q.push('agent=' + encodeURIComponent(m.agent));
    if (m.kind) q.push('kind=' + encodeURIComponent(m.kind));
    if (m.status && view !== 'services') q.push('status=' + encodeURIComponent(m.status));
    const after = m.cursors[m.cursors.length - 1];
    if (after) q.push('after=' + encodeURIComponent(after));
    m.error = '';
    try {
      const r = await this.read('market', MARKET_ENDPOINTS[view] + '?' + q.join('&'));
      if (!r.current() || view !== m.view) return;
      if (!Array.isArray(r.data)) throw new Error('交易信息读取失败，请重试。');
      m.rows = r.data; m.next = r.data.length === PAGE_SIZE ? r.data[r.data.length - 1].id : null;
    } catch (error) {
      if (error.stale) throw error;
      m.rows = null; m.next = null;
      m.error = error.status === 401 ? '请登录后查看交易信息。' : error.status === 403 ? '当前账户无权查看交易信息。' : error.message || '交易信息读取失败，请重试。';
      throw new Error(m.error);
    }
  }
  async loadMaterials() {
    const s = this.materials;
    const [z, research] = await Promise.all([this.read('materials', '/api/public/materials'), this.read('research', '/api/public/research')]);
    if (!z.current() || !research.current()) return;
    s.zones = z.data.zones || {}; s.research = Array.isArray(research.data) ? research.data : [];
    this.remember(z.data);
    await Promise.all([this.loadProjects(), this.loadObservations()]);
  }
  async loadProjects() {
    const s = this.materials, after = s.projectCursors[s.projectCursors.length - 1];
    const r = await this.read('projects', '/api/public/projects?limit=' + PAGE_SIZE + (after ? '&after=' + encodeURIComponent(after) : ''));
    if (!r.current()) return;
    s.projects = Array.isArray(r.data) ? r.data : [];
    s.projectNext = s.projects.length === PAGE_SIZE ? s.projects[s.projects.length - 1].id : null;
  }
  async loadObservations() {
    const s = this.materials, after = s.observationCursors[s.observationCursors.length - 1];
    const r = await this.read('observations', '/api/public/observations?limit=' + PAGE_SIZE + (after ? '&after=' + encodeURIComponent(after) : ''));
    if (!r.current()) return;
    s.observations = Array.isArray(r.data) ? r.data : [];
    s.observationNext = s.observations.length === PAGE_SIZE ? s.observations[s.observations.length - 1].id : null;
  }
  async loadProject(more) {
    const p = this.project;
    if (!p) return;
    const id = p.id, after = more ? p.next : null;
    const r = await this.read('project', '/api/public/project?id=' + encodeURIComponent(id) + '&limit=10' + (after ? '&after=' + encodeURIComponent(after) : ''));
    if (!r.current() || !this.project || this.project.id !== id) return;
    p.data = r.data; p.next = r.data.accounting && r.data.accounting.next || null; p.page = more ? (p.page || 1) + 1 : 1;
    this.remember(r.data);
  }
  async loadCooperation(append) {
    const c = this.coop, kind = c.kind;
    const r = await this.read('cooperation', '/api/public/cooperation?what=' + kind + '&limit=10' + (append && c.next ? '&after=' + encodeURIComponent(c.next) : ''));
    if (!r.current() || kind !== c.kind) return;
    const items = r.data.items || [];
    c.rows = append && c.rows ? c.rows.concat(items) : items; c.next = r.data.next || null;
    this.remember(r.data);
  }
  async loadCooperationDetail(id, edition) {
    const c = this.coop;
    if (!id) return;
    const r = await this.read('cooperationDetail', '/api/public/cooperation?what=' + c.kind + '&id=' + encodeURIComponent(id) + (edition ? '&version=' + encodeURIComponent(edition) : ''));
    if (!r.current() || !c.detail || c.detail.id !== id) return;
    c.detail = { id, edition: edition || null, data: r.data };
    this.remember(r.data);
  }

  async handle(a) {
    try { await this.act(a); }
    catch (error) { if (!error.stale) throw error; }
  }
  async act(a) {
    const app = this.app;
    switch (a.type) {
      case 'observe': if (PAGES.includes(a.page)) await this.open(a.page); break;
      case 'observeMarketView':
        if (!MARKET_ENDPOINTS[a.view]) return;
        Object.assign(this.market, { view: a.view, cursors: [null], rows: null }); app.scroller().scrollTo(0); await this.loadMarket(); break;
      case 'observeMarketFilter':
        if (!['agent', 'status', 'kind'].includes(a.key)) return;
        this.market[a.key] = this.market[a.key] === a.value ? '' : a.value || ''; this.market.cursors = [null];
        await this.loadMarket(); break;
      case 'observeMarketClear': Object.assign(this.market, { agent: '', status: '', kind: '', cursors: [null] }); await this.loadMarket(); break;
      case 'observeMarketPage': await this.page(this.market, 'cursors', 'next', a.dir, () => this.loadMarket()); app.scroller().scrollTo(0); break;
      case 'observeProjectsPage': await this.page(this.materials, 'projectCursors', 'projectNext', a.dir, () => this.loadProjects()); break;
      case 'observeObservationsPage': await this.page(this.materials, 'observationCursors', 'observationNext', a.dir, () => this.loadObservations()); break;
      case 'observeProject':
        this.project = { id: String(a.id || ''), data: null, next: null, page: 1 };
        if (!this.project.id) return;
        app.push('projectAudit'); app.render(); await this.load('projectAudit'); break;
      case 'observeProjectMore': if (this.project && this.project.next) await this.loadProject(true); break;
      case 'observeCoopKind':
        if (!['cards', 'collaborations', 'relations'].includes(a.kind)) return;
        Object.assign(this.coop, { kind: a.kind, rows: null, next: null }); await this.loadCooperation(false); break;
      case 'observeCoopMore': if (this.coop.next) await this.loadCooperation(true); break;
      case 'observeCoopDetail':
        this.coop.detail = { id: String(a.id || ''), edition: a.version || null, data: null };
        if (app.tab !== 'cooperationDetail') app.push('cooperationDetail');
        app.render(); await this.load('cooperationDetail'); app.scroller().scrollTo(0); break;
      default: break;
    }
  }
  async page(state, cursorsKey, nextKey, dir, load) {
    const cursors = state[cursorsKey];
    if (dir === 'next') { if (!state[nextKey]) return; cursors.push(state[nextKey]); }
    else if (dir === 'prev') { if (cursors.length > 1) cursors.pop(); else return; }
    else state[cursorsKey] = [null];
    try { await load(); }
    catch (error) { if (dir === 'next' && !error.stale) state[cursorsKey].pop(); throw error; }
  }
}
module.exports = { Observe, OBSERVE_PAGES: PAGES };
