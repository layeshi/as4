// 后人纪小游戏：画布界面的控制器（导航、触摸、滚动、数据与动作）。界面由 screens/ 构建，组件在 ui/。
const api = require('./utils/api');
const config = require('./config');
const theme = require('./ui/theme');
const N = require('./ui/nodes');
const P = require('./ui/paint');
const T = require('./ui/text');
const { Scroller } = require('./ui/scroll');
const { CityMap } = require('./ui/map');
const { buildFeed } = require('./utils/feed');
const { parseChronicle } = require('./utils/chronicle');
const screens = require('./screens/index');
const serifChars = require('./ui/serif-chars');
const modelPresets = require('./utils/model-presets');
const { GAME_NAME } = require('./copy');
const { MessageBoard } = require('./messages');
const { History } = require('./history');
const { Announcements } = require('./announcements');
const { C, font } = theme;

const TABS = [['city', '观测', 'city'], ['residents', '居民', 'residents'], ['archive', '档案', 'archive'], ['account', '我的', 'me']];
const TAB_IDS = TABS.map(t => t[0]);
// 不访问网络、也不改数据的动作，处理中也可以点。
const UI_ONLY = new Set(['tab', 'back', 'sheet', 'closeSheet', 'filter', 'segment', 'sort', 'expand', 'field', 'toggle', 'pref', 'about', 'aboutBack', 'settings', 'health', 'dismiss', 'noop', 'provider', 'preset', 'modelChoice', 'messageExpand']);
const PREFS_KEY = 'houren.prefs';
const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
const caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null;

class SocietyGame {
  constructor(platform = wx) {
    this.wx = platform;
    this.canvas = this.wx.createCanvas(); this.ctx = this.canvas.getContext('2d');
    this.measure();
    this.tab = 'startup'; this.entered = false; this.stack = []; this.page = null; this.dirty = true;
    this.blocks = []; this.hits = []; this.form = {}; this.scrollers = {};
    this.state = null; this.map = null; this.events = []; this.user = null; this.linked = []; this.created = [];
    this.residentId = ''; this.owner = null; this.detail = null; this.detailKind = ''; this.profile = null;
    this.archiveTab = 'chronicle'; this.archiveRows = []; this.chronicle = []; this.chronicleMonth = null;
    this.feedFilter = 'all'; this.segment = 'residents'; this.sort = 'active'; this.expanded = new Set();
    this.sheet = null; this.toast = null; this.error = ''; this.notice = '';
    this.busy = false; this.refreshing = false; this.visible = true; this.pressed = null; this.editing = '';
    this.pendingCount = 0; this.quickTries = 0; this.mapVersion = 0; this.dismissed = {};
    this.cityFocus = null; // 第七前提「三城」：城市页当前看的城，null 为全岛
    this.moderation = {}; this.loginRequired = {};
    this.navigation = 0; this.readVersions = {};
    this.messageBoard = new MessageBoard(this);
    this.history = new History(this);
    this.announcements = new Announcements(this);
    this.modelPresets = modelPresets.bundled;
    this.cityMap = new CityMap(() => this.wx.createCanvas());
    this.filterScroller = new Scroller(); this.horizontalAreas = [];
    this.images = new Map();
    this.prefs = this.loadPrefs();
    theme.setFontScale(this.prefs.largeText);
  }
  measure() {
    const info = this.wx.getWindowInfo ? this.wx.getWindowInfo() : this.wx.getSystemInfoSync();
    this.width = info.windowWidth || info.screenWidth; this.height = info.windowHeight || info.screenHeight;
    this.ratio = info.pixelRatio || 1;
    const status = info.statusBarHeight || 20;
    let menu = null;
    try { menu = this.wx.getMenuButtonBoundingClientRect && this.wx.getMenuButtonBoundingClientRect(); } catch (_) { menu = null; }
    if (!menu || !menu.width) menu = { top: status + 6, height: 32, left: this.width - 94, right: this.width - 7, bottom: status + 38, width: 87 };
    this.menu = menu; this.navTop = status; this.navH = Math.max(40, (menu.top - status) * 2 + menu.height);
    this.bottomInset = info.safeArea ? Math.max(0, this.height - info.safeArea.bottom) : 0;
    this.tabH = 66 + this.bottomInset;
    this.canvas.width = Math.round(this.width * this.ratio); this.canvas.height = Math.round(this.height * this.ratio);
    if (this.ctx.setTransform) this.ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0); else this.ctx.scale(this.ratio, this.ratio);
  }
  loadPrefs() {
    const prefs = { largeText: false, haptics: true, autoRefresh: true };
    try { const saved = this.wx.getStorageSync(PREFS_KEY); if (saved && typeof saved === 'object') Object.assign(prefs, saved); } catch (_) {}
    return prefs;
  }
  savePrefs() { try { this.wx.setStorageSync(PREFS_KEY, this.prefs); } catch (_) {} }

  start() {
    api.restoreSession();
    this.loadFont();
    this.wx.onTouchStart(e => this.touchStart(e));
    this.wx.onTouchMove(e => this.touchMove(e));
    this.wx.onTouchEnd(e => this.touchEnd(e));
    if (this.wx.onTouchCancel) this.wx.onTouchCancel(() => { this.scroller().dragging = false; this.filterScroller.dragging = false; this.touch = null; this.pressed = null; this.render(); });
    this.wx.onHide(() => this.hide());
    this.wx.onShow(() => { this.visible = true; this.refresh(); });
    if (this.wx.onWindowResize) this.wx.onWindowResize(() => { this.measure(); this.invalidate(); this.render(); });
    if (this.wx.onKeyboardInput) this.wx.onKeyboardInput(e => { if (this.editing) { this.form[this.editing] = e.value; this.invalidate(); this.render(); } });
    this.wx.onKeyboardConfirm(e => { if (this.editing) this.form[this.editing] = e.value; this.editing = ''; if (this.wx.hideKeyboard) this.wx.hideKeyboard(); this.invalidate(); this.render(); });
    if (this.wx.onKeyboardComplete) this.wx.onKeyboardComplete(e => { if (this.editing) this.form[this.editing] = e.value; this.editing = ''; this.invalidate(); this.render(); });
    if (this.wx.showShareMenu) this.wx.showShareMenu({ menus: ['shareAppMessage'] });
    if (this.wx.onShareAppMessage) this.wx.onShareAppMessage(() => ({ title: '后人纪 · 一座由 AI 居民生活的城' }));
    this.render();
    return this.refresh();
  }
  loadFont() {
    if (!serifChars) return;
    // 普通小程序没有小游戏的同步字体加载能力时，固定标题使用系统衬线字体。
    theme.setSerif(null, serifChars);
    if (!this.wx.loadFont) return;
    try { const family = this.wx.loadFont('fonts/HeirsSerif.ttf'); if (family) theme.setSerif(family, serifChars); } catch (_) { /* 用系统字体 */ }
  }
  hide() {
    this.visible = false;
    clearTimeout(this.timer); this.timer = null;
    clearTimeout(this.toastTimer); this.toastTimer = null; this.toast = null;
    clearTimeout(this.clockTimer); this.clockTimer = null;
    if (this.frame) { if (raf && caf) caf(this.frame); else clearTimeout(this.frame); this.frame = null; }
    this.animating = false;
    this.clearSecrets();
  }
  clearSecrets() {
    this.editing = ''; this.mergePreview = null;
    this.messageBoard.stash();
    delete this.form.apiKey; delete this.form.password; delete this.form.confirmPassword;
    if (this.wx.hideKeyboard) this.wx.hideKeyboard();
    this.invalidate();
  }
  rememberModeration(scope, ...responses) {
    this.moderation[scope] = responses.reduce((n, r) => n + (r?.moderation?.pending || 0), 0);
    this.loginRequired[scope] = responses.reduce((n, r) => n + (r?.moderation?.loginRequired || 0), 0);
    this.updatePending();
  }
  get needsWechatLogin() { return Object.values(this.loginRequired).some(count => count > 0); }
  updatePending() {
    const pagePending = this.tab === 'archive' && this.archiveTab !== 'chronicle' ? 0 : this.moderation[this.tab] || 0;
    this.pendingCount = (this.moderation.state || 0) + (this.moderation.events || 0) + (this.moderation.map || 0) + pagePending;
  }
  beginRead(scope) {
    const version = (this.readVersions[scope] || 0) + 1;
    this.readVersions[scope] = version;
    return { version, navigation: this.navigation };
  }
  readCurrent(scope, ticket) {
    return this.readVersions[scope] === ticket.version && this.navigation === ticket.navigation;
  }
  async loadModelPresets() {
    if (!this.presetLoad) this.presetLoad = api.request('/api/wechat/model-presets').then(data => {
      const presets = modelPresets.normalize(data.presets);
      if (presets) this.modelPresets = presets;
    }).catch(() => { /* The same operator catalog is bundled for older/offline servers. */ });
    await this.presetLoad;
  }
  selectPreset(id, variantId) {
    const preset = this.modelPresets.find(p => p.id === id);
    if (!preset) return;
    const variant = preset.variants.find(v => v.id === variantId) || preset.variants[0];
    this.clearSecrets();
    Object.assign(this.form, { presetId: id, presetVariant: variant.id, providerIndex: modelPresets.PROVIDERS.indexOf(variant.provider), baseURL: variant.baseURL, model: variant.models[0] || '', modelAccepted: false });
  }

  // ── 数据 ──
  async refresh(opts = {}) {
    clearTimeout(this.timer); this.timer = null;
    if (!this.entered) { this.render(); return; }
    if (this.refreshing) return;
    if (['reports', 'worldReport', 'historyExport', 'exports'].includes(this.tab)) {
      await this.history.refresh(); return;
    }
    if (['announcements', 'announcement'].includes(this.tab)) {
      this.refreshing = true;
      try { await this.announcements.refresh(); }
      finally { this.refreshing = false; this.invalidate(); this.render(); this.schedule(); }
      return;
    }
    if (['messages', 'messageThread'].includes(this.tab)) {
      this.refreshing = true; this.render();
      try { await this.messageBoard.refresh(); }
      catch (error) { this.messageBoard.fail(error); this.messageBoard.error = error.message; this.showToast(error.message, 'error'); }
      finally { this.refreshing = false; this.invalidate(); this.render(); this.schedule(); }
      return;
    }
    const ticket = this.beginRead('refresh');
    this.refreshing = true; this.render();
    try {
      const [events] = await Promise.all([api.request('/api/public/events?recent=1&limit=60'), this.announcements.loadLatest()]);
      if (!this.readCurrent('refresh', ticket)) return;
      const newest = events.events.length ? events.events[events.events.length - 1].seq : 0;
      const world = this.state && this.state.world;
      const stale = opts.full || !this.state || newest !== this.lastSeq || !world || !world.nextTickAt || Date.now() >= world.nextTickAt || this.pendingCount;
      const state = stale ? await api.request('/api/public/state') : this.state;
      if (!this.readCurrent('refresh', ticket)) return;
      const mapChanged = !this.map || (this.state && (this.state.world.id !== state.world.id || this.state.world.map !== state.world.map));
      if (mapChanged || this.moderation.map) {
        const map = await api.request('/api/public/map');
        if (!this.readCurrent('refresh', ticket)) return;
        this.map = map; this.rememberModeration('map', this.map);
      }
      this.state = state; this.events = events.events; this.lastSeq = newest;
      this.rememberModeration('state', state); this.rememberModeration('events', events);
      this.mapVersion++;
      if (this.tab === 'account') await this.loadAccount();
      else if (this.tab === 'archive') await this.loadArchive();
      else if (this.tab === 'resident' && this.profile?.id) await this.loadProfile(this.profile.id, { refresh: true });
      else if (this.tab === 'detail' && this.detailId) await this.loadDetail(this.detailKind, this.detailId, { refresh: true });
      else if (this.tab === 'owner' && this.residentId) await this.loadOwner();
      if (!this.readCurrent('refresh', ticket)) return;
      this.error = '';
    } catch (error) {
      if (!this.readCurrent('refresh', ticket)) return;
      this.error = error.message;
      if (opts.pull || !this.state) this.showToast(error.message, 'error');
    } finally {
      if (this.readVersions.refresh === ticket.version) {
        this.refreshing = false; this.invalidate(); this.render(); this.schedule();
      }
    }
  }
  schedule() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.visible || !this.entered) return;
    this.updatePending();
    if (!this.pendingCount) this.quickTries = 0;
    // 登录用户看到审核中的文字：几秒后再取，最多连续三次。
    const quick = this.pendingCount > 0 && this.wechatVerified && this.quickTries < 3;
    if (!quick && !this.prefs.autoRefresh) return;
    this.timer = setTimeout(() => { if (quick) this.quickTries++; return this.refresh(); }, quick ? 4000 : config.pollMs);
  }
  async loadAccount() {
    const ticket = this.beginRead('account');
    const result = await api.request('/api/account');
    const status = await api.request('/api/wechat/status' + (config.appid ? '?appid=' + encodeURIComponent(config.appid) : ''));
    const mine = result.user ? await api.request('/api/account/residents') : null;
    if (!this.readCurrent('account', ticket)) return;
    this.user = result.user; this.registrationOpen = result.registrationOpen;
    this.wechatLinked = status.linked; this.wechatEnabled = status.enabled; this.wechatVerified = status.verified;
    this.messageBoard.sync();
    this.linked = mine?.managed || []; this.created = mine?.created || [];
    this.rememberModeration('account', mine);
  }
  async loadArchive() {
    if (!this.state) return;
    if (this.archiveTab !== 'chronicle') return;
    const perMonth = this.state.world.daysPerMonth || 24, current = Math.floor(this.state.world.day / perMonth);
    if (this.chronicleMonth === null || this.chronicleMonth > current) this.chronicleMonth = current;
    const from = this.chronicleMonth * perMonth;
    const month = this.chronicleMonth, ticket = this.beginRead('archive');
    const result = await api.request('/api/public/chronicle?lang=zh&from=' + from);
    if (!this.readCurrent('archive', ticket) || this.archiveTab !== 'chronicle' || this.chronicleMonth !== month) return;
    this.rememberModeration('archive', result);
    this.chronicle = (result.chronicle || []).filter(c => c.day < from + perMonth).slice().reverse().map(parseChronicle);
  }
  async loadOwner() {
    const id = this.residentId, ticket = this.beginRead('owner');
    const path = '/api/account/residents/' + encodeURIComponent(id);
    const [detail, privateData] = await Promise.all([api.request(path), api.request(path + '/private')]);
    if (!this.readCurrent('owner', ticket) || this.residentId !== id) return false;
    this.owner = Object.assign({}, detail.resident, privateData, detail.overview, { agentId: id, usage: detail.usage });
    this.rememberModeration('owner', detail, privateData);
    return true;
  }
  async loadDetail(kind, id, { refresh = false } = {}) {
    const routes = { place: 'places', law: 'laws', doc: 'docs' };
    if (!routes[kind]) throw new Error('档案类型无效');
    const ticket = this.beginRead('detail');
    const data = await api.request('/api/public/' + routes[kind] + '/' + encodeURIComponent(id));
    if (!this.readCurrent('detail', ticket) || (refresh && (this.tab !== 'detail' || this.detailId !== id || this.detailKind !== kind))) return;
    this.detail = data;
    this.detailKind = kind; this.detailId = id;
    this.rememberModeration('detail', this.detail);
    if (!refresh) this.push('detail');
  }
  async loadProfile(id, { refresh = false } = {}) {
    if (!refresh) { this.profile = { id, loading: true }; this.push('resident'); this.render(); }
    const ticket = this.beginRead('resident');
    const data = await api.request('/api/public/agents/' + encodeURIComponent(id));
    if (!this.readCurrent('resident', ticket) || this.tab !== 'resident' || this.profile?.id !== id) return;
    this.profile = Object.assign({ id, tab: this.profile.tab || 'events' }, data);
    this.rememberModeration('resident', data);
  }

  // ── 导航 ──
  push(page) { if (this.tab !== page) { this.clearSecrets(); this.stack.push(this.tab); } this.navigation++; this.tab = page; this.quickTries = 0; this.scroller(page).reset(); this.invalidate(); }
  back() { this.clearSecrets(); this.navigation++; this.tab = this.stack.pop() || (this.entered ? 'city' : 'startup'); this.quickTries = 0; this.invalidate(); }
  scroller(page = this.tab) { return this.scrollers[page] || (this.scrollers[page] = new Scroller()); }
  invalidate() { this.dirty = true; }

  async dispatch(action) {
    if (!action) return;
    if (this.busy && action.type === 'field' && action.name === 'messageText') return;
    if (this.busy && !UI_ONLY.has(action.type)) return;
    if (!this.entered && !['about', 'back'].includes(action.type) && !(this.tab === 'startup' && action.type === 'start')) return;
    if (action.type === 'field') {
      this.editing = action.name; this.invalidate(); this.render();
      this.wx.showKeyboard({ defaultValue: this.form[action.name] || '', maxLength: action.max || 4000, multiple: !!action.multiple, confirmHold: false, confirmType: 'done',
        fail: () => { this.editing = ''; this.showToast('无法打开输入框，请重试', 'error'); } });
      return;
    }
    const network = !UI_ONLY.has(action.type);
    if (network) { this.busy = true; this.error = ''; this.notice = ''; }
    try { await this.handle(action); }
    catch (error) {
      if (error.status === 401 && error.code === 'wechat_login_required' && error.sessionCurrent !== false) this.loginRequired[action.type] = 1;
      this.error = error.message || '操作失败，请重试'; this.showToast(this.error, 'error');
    }
    finally { if (network) this.busy = false; this.invalidate(); this.render(); this.schedule(); }
  }
  async handle(a) {
    const f = this.form;
    if (a.type?.startsWith('history')) return this.history.handle(a);
    if (a.type === 'announcements' || a.type?.startsWith('announcement')) return this.announcements.handle(a);
    if (a.type === 'messages' || a.type?.startsWith('message')) return this.messageBoard.handle(a);
    switch (a.type) {
      case 'start': this.entered = true; this.tab = 'city'; this.stack = []; await Promise.all([this.refresh({ full: true }), this.loadAccount().catch(() => {})]); break;
      case 'tab':
        if (!TAB_IDS.includes(a.tab)) return;
        if (this.tab === a.tab && !this.stack.length) { this.scroller().scrollTo(0); break; }
        this.clearSecrets(); this.navigation++; this.tab = a.tab; this.stack = []; this.sheet = null; this.quickTries = 0;
        if (a.tab === 'account') await this.loadAccount();
        if (a.tab === 'archive') await this.loadArchive();
        if (!this.state) await this.refresh({ full: true });
        break;
      case 'back': this.back(); break;
      case 'refresh': await this.refresh({ full: true, pull: !!a.pull }); break;
      case 'filter': this.feedFilter = a.value; break;
      case 'cityFocus': this.cityFocus = a.city || null; this.mapVersion++; break;
      case 'segment': this.segment = a.value; break;
      case 'sort': this.sort = a.value; break;
      case 'expand': if (this.expanded.has(a.key)) this.expanded.delete(a.key); else this.expanded.add(a.key); break;
      case 'sheet': this.sheet = { kind: a.kind, id: a.id }; break;
      case 'closeSheet': this.sheet = null; break;
      case 'dismiss': this.dismissed[a.key] = true; break;
      case 'toggle': f[a.name] = !f[a.name]; break;
      case 'pref':
        this.prefs[a.name] = !this.prefs[a.name]; this.savePrefs();
        if (a.name === 'largeText') { theme.setFontScale(this.prefs.largeText); T.reset(); }
        if (a.name === 'autoRefresh') this.schedule();
        break;
      case 'clearCache':
        try { this.wx.removeStorageSync(PREFS_KEY); } catch (_) {}
        this.prefs = this.loadPrefs(); theme.setFontScale(false); T.reset(); this.images.clear(); this.mapVersion++;
        this.showToast('已清除本地缓存', 'ok');
        break;
      case 'archive': this.archiveTab = a.tab; this.scroller().scrollTo(0); await this.loadArchive(); break;
      case 'month': this.chronicleMonth = Math.max(0, this.chronicleMonth + a.delta); await this.loadArchive(); this.scroller().scrollTo(0); break;
      case 'detail': this.sheet = null; await this.loadDetail(a.kind, a.id); break;
      case 'resident': this.sheet = null; await this.loadProfile(a.id); break;
      case 'profileTab': if (this.profile) this.profile.tab = a.value; break;
      case 'settings': this.push('settings'); break;
      case 'about': this.push('about'); break;
      case 'aboutBack': this.back(); break;
      case 'health': this.push('about'); break;
      case 'auth':
        if (!f.accepted) throw new Error('请先阅读并同意隐私说明');
        await api.request('/api/account/login', { method: 'POST', timeout: 30000, data: { username: (f.username || '').trim(), password: f.password || '' } });
        f.password = ''; this.navigation++; this.owner = null; this.residentId = ''; this.moderation = {}; this.loginRequired = {}; this.messageBoard.reset(); await this.loadAccount(); this.back(); this.showToast('已登录网站账号', 'ok');
        break;
      case 'linkAccount': this.push('link'); break;
      case 'webLogin': this.push('webLogin'); break;
      case 'mergeAccount': this.push('mergeAccount'); break;
      case 'previewMerge': {
        if (!f.accepted) throw new Error('请先阅读并同意隐私说明');
        let result;
        try { result = await api.previewMerge((f.username || '').trim(), f.password || ''); }
        finally { this.clearSecrets(); }
        this.mergePreview = result;
        break;
      }
      case 'confirmMerge': {
        if (!this.mergePreview) throw new Error('请先验证两端身份');
        const ticket = this.mergePreview.ticket;
        await api.request('/api/wechat/merge/confirm', { method: 'POST', timeout: 60000, data: { ticket, confirm: true } });
        this.clearSecrets(); this.navigation++; this.owner = null; this.residentId = '';
        this.messageBoard.reset();
        this.moderation = {}; this.loginRequired = {}; this.stack = []; this.tab = 'account';
        await this.loadAccount(); this.showToast('账号已合并，请使用网站账号登录', 'ok');
        break;
      }
      case 'copyUsername': this.wx.setClipboardData({ data: this.user.username, success() {} }); break;
      case 'saveWebPassword':
        if (!f.accepted) throw new Error('请先阅读并同意隐私说明');
        if (!f.password || f.password !== f.confirmPassword) throw new Error('两次密码不一致');
        try { await api.setWebPassword(f.password); }
        finally { this.clearSecrets(); }
        this.navigation++; await this.loadAccount(); this.back();
        this.showToast('网页登录密码已设置，其他设备需重新登录', 'ok');
        break;
      case 'wechatLogin':
        if (!f.accepted) throw new Error('请先阅读并同意隐私说明');
        await api.loginWeChat(!!this.user);
        this.navigation++; // Old readers must not restore a previous login's moderation state.
        this.refreshing = false; // A fresh read may replace an outstanding read from the previous login.
        this.moderation = {}; this.loginRequired = {}; this.updatePending();
        this.messageBoard.reset();
        await this.loadAccount(); this.map = null; await this.refresh({ full: true });
        this.notice = '微信登录成功'; this.showToast('微信登录成功', 'ok');
        break;
      case 'logout':
        this.clearSecrets(); this.navigation++;
        // request captures the existing credential synchronously; local privacy never waits for the network.
        const revocation = api.request('/api/account/logout', { method: 'POST', data: {} });
        api.clearSession();
        this.user = null; this.owner = null; this.linked = []; this.created = []; this.wechatVerified = false;
        this.messageBoard.reset();
        this.loginRequired = {};
        this.form = {}; this.residentId = ''; this.letterDraft = ''; this.createDraft = ''; this.letterRequestId = null; this.createRequestId = null;
        this.stack = []; this.sheet = null; this.tab = 'account'; this.moderation.owner = 0; this.moderation.account = 0;
        this.updatePending(); this.invalidate(); this.render();
        try { const result = await revocation; if (result.ok !== true) throw new Error('Unconfirmed revocation'); }
        catch (_) { throw new Error('本机已退出，服务器会话撤销未确认。'); }
        this.notice = '已退出登录';
        this.showToast('已退出登录', 'ok');
        break;
      case 'owner': {
        const navigation = this.navigation;
        if (this.residentId !== a.id) this.clearSecrets(); this.residentId = a.id;
        await this.loadModelPresets();
        if (this.navigation !== navigation || this.residentId !== a.id) break;
        if (!f.presetId && !f.baseURL) this.selectPreset('deepseek');
        if (await this.loadOwner() && this.tab !== 'owner') this.push('owner');
        break;
      }
      case 'letter': {
        const text = (f.letter || '').trim(); if (!text) throw new Error('请先写下家书');
        if (this.letterDraft !== text) { this.letterRequestId = api.requestId(); this.letterDraft = text; }
        this.letterRequestId = this.letterRequestId || api.requestId();
        await api.request('/api/account/residents/' + encodeURIComponent(this.residentId) + '/letter', { method: 'POST', data: { text, requestId: this.letterRequestId } });
        this.letterRequestId = null; f.letter = ''; await this.loadOwner(); this.notice = '家书已送出'; this.showToast('家书已送出', 'ok');
        break;
      }
      case 'runner':
        await api.request('/api/account/residents/' + encodeURIComponent(this.residentId) + '/runner', { method: 'POST', data: { op: a.op } });
        await this.loadOwner(); this.showToast(a.op === 'start' ? '运行器已启动' : '运行器已暂停', 'ok');
        break;
      case 'disconnect': this.owner = null; f.letter = ''; f.apiKey = ''; this.back(); break;
      case 'entry': {
        const navigation = this.navigation;
        if (!this.user || !this.wechatVerified) throw new Error('请先使用微信登录');
        await this.loadModelPresets(); if (this.navigation !== navigation) break;
        if (!f.presetId && !f.baseURL) this.selectPreset('deepseek');
        this.push('entry'); break;
      }
      case 'provider': f.providerIndex = a.index !== undefined ? a.index : ((f.providerIndex || 0) + 1) % 3; f.apiKey = ''; break;
      case 'preset': this.selectPreset(a.id, a.variant); break;
      case 'modelChoice': f.model = a.model; break;
      case 'modelTest': case 'modelSave': await this.configureRunner(a.type === 'modelTest'); break;
      case 'create': await this.enter(); break;
      case 'support':
        await new Promise((resolve, reject) => this.wx.setClipboardData({ data: 'wong.laye@outlook.com', success: resolve, fail: () => reject(new Error('复制失败，请手动记录邮箱')) }));
        this.notice = '客服邮箱已复制'; this.showToast('客服邮箱已复制', 'ok');
        break;
      default: break;
    }
  }
  async enter() {
    const f = this.form;
    if (!f.entryAccepted) throw new Error('请先阅读并同意隐私说明');
    if (!(f.name || '').trim() || !(f.soul || '').trim()) throw new Error('请填写居民名字与灵魂');
    const draft = JSON.stringify([f.name.trim(), f.bio || '', f.soul.trim(), f.invite || '']);
    if (this.createDraft !== draft) { this.createRequestId = api.requestId(); this.createDraft = draft; }
    this.createRequestId = this.createRequestId || api.requestId();
    try {
      const result = await api.request('/api/account/residents', { method: 'POST', timeout: 60000, data: { name: f.name.trim(), bio: f.bio || '', soul: f.soul.trim(), lang: 'zh', dailyCap: 18000, invite: (f.invite || '').trim(), requestId: this.createRequestId } });
      this.residentId = result.agentId; this.createRequestId = null; f.soul = ''; f.name = ''; f.bio = '';
      this.clearSecrets(); this.navigation++; this.stack = ['account']; this.tab = 'owner'; this.scroller('owner').reset();
      await this.loadOwner(); this.notice = '居民已创建，请配置模型后启动'; this.showToast('居民已创建', 'ok');
    } catch (error) { if (!error.status) throw new Error('结果未确认。保留原提交编号，再次提交不会重复创建居民。'); throw error; }
  }
  async configureRunner(testOnly) {
    const f = this.form;
    if (!f.modelAccepted) throw new Error('请先同意模型调用说明');
    const runner = { provider: ['openai', 'openai-responses', 'anthropic'][f.providerIndex || 0], model: (f.model || '').trim(), baseURL: (f.baseURL || '').trim(), apiKey: (f.apiKey || '').trim(), actEveryTicks: 1, historyRounds: 6 };
    if (!runner.model || !runner.apiKey || !runner.baseURL.startsWith('https://')) throw new Error('请填写模型名、API Key 和 HTTPS 接口地址');
    await api.request('/api/account/residents/' + encodeURIComponent(this.residentId) + '/runner', { method: 'POST', timeout: 60000, data: { op: testOnly ? 'test' : 'save', config: runner } });
    if (!testOnly) { f.apiKey = ''; await this.loadOwner(); }
    this.notice = testOnly ? '模型连接成功' : '模型配置已保存，可主动启动运行器';
    this.showToast(this.notice, 'ok');
  }
  showToast(text, kind = 'ok') {
    this.toast = { text, kind };
    clearTimeout(this.toastTimer);
    if (this.visible) this.toastTimer = setTimeout(() => { this.toast = null; this.toastTimer = null; this.render(); }, kind === 'error' ? 3200 : 2200);
  }
  haptic() { if (this.prefs.haptics && this.wx.vibrateShort) { try { this.wx.vibrateShort({ type: 'light', fail() {} }); } catch (_) {} } }
  avatarImage(hash) {
    if (!hash || !/^[a-f0-9]{64}$/.test(hash) || !this.wx.createImage) return null;
    const known = this.images.get(hash);
    if (known) return known.ok ? known.img : null;
    // 头像只在服务端审核通过后才会出现在数据里；加载失败就改用首字印章。
    const img = this.wx.createImage(), rec = { img, ok: false };
    this.images.set(hash, rec);
    img.onload = () => { rec.ok = true; this.mapVersion++; this.invalidate(); this.render(); };
    img.onerror = () => { rec.failed = true; };
    img.src = config.apiBase + '/api/wechat/public/avatars/' + hash + '.jpg';
    return null;
  }

  // ── 触摸 ──
  contentTop() { return this.page && this.page.fullscreen ? 0 : this.navTop + this.navH; }
  contentBottom() { const p = this.page || {}; return this.height - (p.tabbar ? this.tabH : p.footer ? p.footer.height + 16 + this.bottomInset : this.bottomInset + 16); }
  hitAt(x, y) { for (let i = this.hits.length - 1; i >= 0; i--) { const h = this.hits[i]; if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h; } return null; }
  touchStart(e) {
    const t = e.touches && e.touches[0]; if (!t) return;
    const now = Date.now();
    if (this.frame) { if (raf && caf) caf(this.frame); else clearTimeout(this.frame); this.frame = null; this.animating = false; }
    this.touch = { x: t.clientX, y: t.clientY, moved: false, scroll: !this.sheet && t.clientY >= this.contentTop() && t.clientY <= this.contentBottom() };
    const area = this.horizontalAreas.find(h => t.clientX >= h.x && t.clientX <= h.x + h.w && t.clientY >= h.y && t.clientY <= h.y + h.h);
    if (area && this.touch.scroll) { this.touch.horizontal = area.scroller; area.scroller.start(t.clientX, now); }
    const hit = this.hitAt(t.clientX, t.clientY);
    this.pressed = hit ? hit.action : null;
    if (this.touch.scroll) this.scroller().start(t.clientY, now);
    this.render();
  }
  touchMove(e) {
    const t = e.touches && e.touches[0]; if (!t || !this.touch) return;
    const dx = Math.abs(t.clientX - this.touch.x), dy = Math.abs(t.clientY - this.touch.y);
    if (!this.touch.moved && dx + dy > 8) {
      this.touch.moved = true; this.pressed = null;
      this.touch.axis = this.touch.horizontal && dx > dy ? 'horizontal' : 'vertical';
    }
    if (this.touch.scroll && this.touch.moved) {
      if (this.touch.axis === 'horizontal') this.touch.horizontal.move(t.clientX, Date.now());
      else this.scroller().move(t.clientY, Date.now());
    }
    this.render();
  }
  touchEnd() {
    const touch = this.touch; this.touch = null;
    if (!touch) return;
    const action = touch.moved ? null : this.pressed;
    this.pressed = null;
    const horizontal = touch.axis === 'horizontal', sc = horizontal ? touch.horizontal : this.scroller();
    if (touch.horizontal && !horizontal) touch.horizontal.dragging = false;
    if (horizontal) this.scroller().dragging = false;
    if (touch.scroll) { const pull = sc.end(Date.now()); if (!horizontal && pull && this.page && this.page.pull && !this.refreshing) this.dispatch({ type: 'refresh', pull: true }); }
    if (action) { this.haptic(); this.dispatch(action); }
    this.kick(sc);
  }
  kick(scroller = this.scroller()) {
    if (this.animating) return;
    let last = Date.now();
    const step = () => {
      const now = Date.now(), moving = scroller.step(now - last); last = now;
      this.render();
      if (moving && this.visible) { this.animating = true; this.frame = raf ? raf(step) : setTimeout(step, 16); }
      else { this.animating = false; this.frame = null; }
    };
    step();
  }

  // ── 绘制 ──
  build() {
    const blocks = [];
    N.begin(this.ctx, blocks);
    const W = this.width - 32;
    const spec = (screens[this.tab] || screens.city)(this, W);
    spec.gap = spec.gap === undefined ? 12 : spec.gap;
    spec.padTop = spec.padTop === undefined ? 8 : spec.padTop;
    spec.padBottom = spec.padBottom === undefined ? 28 : spec.padBottom;
    spec.height = spec.padTop + spec.padBottom + spec.nodes.reduce((s, n) => s + n.height, 0) + Math.max(0, spec.nodes.length - 1) * spec.gap;
    this.page = spec; this.blocks = blocks; this.dirty = false;
  }
  context(top, bottom, blocked) {
    return {
      ctx: this.ctx, editing: this.editing,
      hit: (x, y, w, h, action) => { if (blocked || !action) return; const t = Math.max(top, y), b = Math.min(bottom, y + h); if (b > t) this.hits.push({ x, y: t, w, h: b - t, action }); },
      horizontal: (x, y, w, h, scroller) => { if (blocked) return; const t = Math.max(top, y), b = Math.min(bottom, y + h); if (b > t) this.horizontalAreas.push({ x, y: t, w, h: b - t, scroller }); },
      pressed: a => !!a && a === this.pressed,
      avatar: hash => this.avatarImage(hash),
    };
  }
  render() {
    if (!this.ctx) return;
    if (this.dirty || !this.page) this.build();
    const ctx = this.ctx, page = this.page;
    this.hits = []; this.horizontalAreas = [];
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, this.width, this.height);
    const top = this.contentTop(), bottom = this.contentBottom(), sc = this.scroller();
    sc.setMax(page.height - (bottom - top));
    ctx.save(); ctx.beginPath(); ctx.rect(0, top, this.width, bottom - top); ctx.clip();
    if (page.pull) this.paintPull(top, sc);
    const g = this.context(top, bottom, !!this.sheet);
    let y = top + page.padTop - Math.round(sc.offset);
    for (const n of page.nodes) { if (y + n.height >= top - 2 && y <= bottom + 2) n.paint(g, 16, y); y += n.height + page.gap; }
    ctx.restore();
    if (!page.fullscreen && page.height > bottom - top + 4) this.paintScrollbar(top, bottom, sc, page.height);
    const chrome = this.context(0, this.height, !!this.sheet);
    if (page.footer) { ctx.fillStyle = C.bg; ctx.fillRect(0, bottom, this.width, this.height - bottom); page.footer.paint(chrome, 16, bottom + 8); }
    if (!page.fullscreen) this.paintNav(page, chrome);
    if (page.tabbar) this.paintTabs(chrome);
    if (this.sheet) this.paintSheet();
    if (!page.footer) P.text(ctx, GAME_NAME, this.width / 2, this.height - this.bottomInset - 8, font(10, {}), C.text3, 'center');
    if (this.toast) this.paintToast();
    this.scheduleClock();
  }
  scheduleClock() {
    const w = this.state?.world;
    if (!this.visible || !this.entered || this.tab !== 'city' || w?.paused || !w?.nextTickAt || !Number.isFinite(new Date(w.nextTickAt).getTime())) {
      clearTimeout(this.clockTimer); this.clockTimer = null; return;
    }
    if (!this.clockTimer) this.clockTimer = setTimeout(() => { this.clockTimer = null; this.render(); }, 1000);
  }
  paintPull(top, sc) {
    const pull = sc.pull;
    if (pull <= 2 && !(this.refreshing && sc.offset < 0)) return;
    const ctx = this.ctx, ready = sc.pullReady, y = top + Math.min(pull, 64) / 2;
    ctx.save(); ctx.translate(this.width / 2 - 34, y); ctx.rotate(Math.min(1, pull / 64) * Math.PI * 1.6);
    P.icon(ctx, 'refresh', -8, -8, 16, ready ? C.moon : C.text3, 2); ctx.restore();
    P.text(ctx, this.refreshing ? '正在刷新…' : ready ? '松开刷新' : '下拉刷新', this.width / 2 - 20, y, font(12, {}), ready ? C.moon : C.text3, 'left');
  }
  paintScrollbar(top, bottom, sc, total) {
    if (!this.touch && !this.animating) return;
    const view = bottom - top, h = Math.max(36, view * view / total), y = top + (view - h) * Math.max(0, Math.min(1, sc.offset / Math.max(1, sc.max)));
    P.fillRound(this.ctx, this.width - 5, y, 3, h, 1.5, 'rgba(237,234,227,0.28)');
  }
  paintNav(page, g) {
    const ctx = this.ctx, y = this.navTop, h = this.navH, cy = y + h / 2;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, this.width, y + h);
    const top = page.top || { kind: 'title', title: '' };
    const maxW = this.menu.left - 24;
    if (top.kind === 'brand') {
      this.paintLogo(16, cy - 13, 26);
      const f = font(19, { bold: true, serif: true, text: top.title });
      P.text(ctx, T.ellipsize(ctx, top.title, maxW - 52, f), 52, cy, f, C.text);
    } else if (top.kind === 'back') {
      const back = { type: 'back' };
      if (g.pressed(back)) P.fillRound(ctx, 6, cy - 18, 36, 36, 18, C.raised);
      P.icon(ctx, 'left', 12, cy - 12, 24, C.text, 2.2);
      g.hit(0, y, 48, h, back);
      P.text(ctx, T.ellipsize(ctx, top.title || '', maxW - 56, font(17, { bold: true })), 48, cy, font(17, { bold: true }), C.text);
    } else {
      const f = font(22, { bold: true, serif: true, text: top.title });
      P.text(ctx, top.title || '', 16, cy, f, C.text);
    }
    if (this.busy || this.refreshing) {
      const label = this.busy ? '处理中…' : '更新中…', lw = T.measure(ctx, font(12, {}), label);
      P.text(ctx, label, this.menu.left - 10 - lw, cy, font(12, {}), C.text3);
    }
  }
  paintLogo(x, y, d) {
    const ctx = this.ctx, s = d / 128;
    P.circle(ctx, x + 64 * s, y + 64 * s, 60 * s, '#19364d');
    P.circle(ctx, x + 64 * s, y + 55 * s, 43 * s, '#ffedce');
    ctx.fillStyle = '#19364d';
    P.tracePath(ctx, 'M27 77V45l9-12 9 12v32zm23 0V49a14 14 0 0 1 28 0v28zm33 0V45l9-12 9 12v32zM19 69h90v24H19z', x, y, s * 1); ctx.fill();
  }
  paintTabs(g) {
    const ctx = this.ctx, top = this.height - this.tabH, w = this.width / TABS.length;
    ctx.fillStyle = C.bar; ctx.fillRect(0, top, this.width, this.tabH);
    P.line(ctx, 0, top + 0.5, this.width, top + 0.5, C.line, 1);
    const current = TAB_IDS.includes(this.tab) ? this.tab : this.stack.find(t => TAB_IDS.includes(t));
    TABS.forEach(([id, label, icon], i) => {
      const active = id === current, color = active ? C.moon : C.text3, cx = i * w + w / 2;
      P.icon(ctx, icon, cx - 12, top + 6, 24, color, 1.8);
      P.text(ctx, label, cx, top + 40, font(11, { bold: active }), color, 'center');
      g.hit(i * w, top, w, 50, { type: 'tab', tab: id });
    });
  }
  paintSheet() {
    const ctx = this.ctx, close = { type: 'closeSheet' };
    ctx.fillStyle = 'rgba(5,10,16,0.55)'; ctx.fillRect(0, 0, this.width, this.height);
    this.hits.push({ x: 0, y: 0, w: this.width, h: this.height, action: close });
    const W = this.width - 36;
    N.begin(this.ctx, null);
    const nodes = screens.sheet(this, W);
    const body = N.stack(nodes, 12), h = Math.min(this.height * 0.82, body.height + 40 + this.bottomInset + 20), top = this.height - h;
    P.fillRound(ctx, 0, top, this.width, h + 30, 22, C.bar);
    P.line(ctx, 22, top + 0.5, this.width - 22, top + 0.5, C.lineStrong, 1);
    P.fillRound(ctx, this.width / 2 - 19, top + 9, 38, 5, 2.5, C.lineStrong);
    this.hits.push({ x: 0, y: top, w: this.width, h, action: { type: 'noop' } });
    ctx.save(); ctx.beginPath(); ctx.rect(0, top, this.width, h); ctx.clip();
    body.paint(this.context(top, this.height, false), 18, top + 28);
    ctx.restore();
  }
  paintToast() {
    const ctx = this.ctx, t = this.toast, f = font(14, {}), maxW = this.width - 64;
    const label = T.ellipsize(ctx, t.text, maxW - 52, f), w = Math.min(maxW, T.measure(ctx, f, label) + 52), h = 40;
    const x = (this.width - w) / 2, y = this.navTop + this.navH + 8;
    const ok = t.kind !== 'error';
    P.fillRound(ctx, x, y, w, h, 20, ok ? '#F3EEE4' : '#4A2226');
    P.icon(ctx, ok ? 'check' : 'info', x + 16, y + h / 2 - 8, 16, ok ? C.ink : '#FFD9D3', 2.4);
    P.text(ctx, label, x + 38, y + h / 2, f, ok ? C.ink : '#FFD9D3');
  }
}
module.exports = { SocietyGame };
