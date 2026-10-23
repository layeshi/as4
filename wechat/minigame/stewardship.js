// 居民管理（与网站 public/residents.js、billing.js、hosted-ui.js、model-form.js 同一组接口）：
// 领养、过继邀请与接受、每日上限、移除配置、恢复默认形象、生涯时间线、流水导出、平台托管与余额、旧世界灵魂带入。
// 含文字的读取经 api.js 改写到 /api/wechat/…审核代理；写入只用网站同一条路由，带请求编号防重复提交。
const api = require('./utils/api');
const { PROVIDERS } = require('./utils/model-presets');

const CAP_MAX = 50000000;
const DEFAULT_CAP = 880000; // 网站创建、领养与接受过继的默认每日上限
const PAGES = ['billing', 'adopt', 'transferAccept', 'soulImport'];

function capValue(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!/^\d{1,9}$/.test(text) || Number(text) > CAP_MAX) throw new Error('每日游戏词元上限须为 0–50,000,000 的整数');
  return Number(text);
}

class Stewardship {
  constructor(app) { this.app = app; this.reset(); }
  reset() {
    this.tab = 'overview'; this.hosted = null; this.hostedError = ''; this.transfers = null; this.transfersError = '';
    this.timeline = null; this.imports = null; this.confirm = null; this.drafts = {}; this.adoptId = null; this.acceptId = null; this.saved = null;
  }
  static pages() { return PAGES; }
  // 同一份草稿重复提交沿用同一个请求编号（服务端按编号去重）；成功或改了内容才换新编号。
  requestId(kind, draft) {
    const d = this.drafts[kind];
    if (!d || d.draft !== draft) this.drafts[kind] = { draft, id: api.requestId() };
    return this.drafts[kind].id;
  }
  done(kind) { delete this.drafts[kind]; }
  ticket(scope) { return { read: this.app.beginRead('steward:' + scope), user: this.app.user && this.app.user.id }; }
  current(scope, t) { return this.app.readCurrent('steward:' + scope, t.read) && (this.app.user && this.app.user.id) === t.user; }
  /** 读取请求：失败时若已离开页面、换了账号或被更新的读取取代，标记为过期，调用方静默丢弃。 */
  read(scope, t, path) {
    return api.request(path).catch(error => { if (!this.current(scope, t)) error.stale = true; throw error; });
  }

  async loadHosted() {
    const t = this.ticket('hosted');
    try {
      const data = await api.request('/api/account/hosted');
      if (!this.current('hosted', t)) return;
      this.hosted = data; this.hostedError = '';
    } catch (error) {
      if (!this.current('hosted', t)) return;
      this.hosted = null; this.hostedError = error.message || '无法读取平台托管信息';
    }
  }
  async loadTransfers() {
    const t = this.ticket('transfers');
    try {
      const data = await api.request('/api/account/transfers');
      if (!this.current('transfers', t)) return;
      this.transfers = data.transfers || []; this.transfersError = '';
    } catch (error) {
      if (!this.current('transfers', t)) return;
      this.transfers = null; this.transfersError = error.message || '无法读取过继邀请';
    }
  }
  /** 「我的」页的附加信息：过继邀请与托管余额；失败只影响各自的卡片。 */
  async loadAccountExtras() {
    if (!this.app.user) { this.hosted = null; this.transfers = null; return; }
    await Promise.all([this.loadHosted(), this.loadTransfers()]);
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
  async loadImports() {
    const t = this.ticket('imports');
    const worlds = await this.read('imports', t, '/api/account/worlds');
    const rows = [];
    for (const world of worlds.archives || []) {
      const data = await this.read('imports', t, '/api/account/worlds/' + encodeURIComponent(world.id) + '/souls');
      (data.souls || []).forEach(soul => rows.push({ world: world.id, soul }));
    }
    if (!this.current('imports', t)) return;
    this.imports = rows;
  }

  /** 模型表单 → 网站 model-form 的同一份配置：平台托管只带模型编号；自备模型带接口、模型与密钥（留空则沿用已保存的密钥）。 */
  runnerConfig(previous) {
    const f = this.app.form;
    if (f.modelSource === 'hosted') {
      const h = this.hosted;
      if (!h || !h.available) throw new Error((h && h.error) || '平台托管暂未开放，可改用自己的模型。');
      if (h.version === 2) {
        const model = f.hostedModel || (h.models || []).find(m => m.available)?.id;
        if (!model || !(h.models || []).some(m => m.id === model && m.available)) throw new Error('该模型尚未开放，请选择其他模型。');
        return { hosted: true, model };
      }
      return { hosted: true };
    }
    const config = { provider: PROVIDERS[f.providerIndex || 0], model: (f.model || '').trim(), baseURL: (f.baseURL || '').trim(), apiKey: (f.apiKey || '').trim(), toolMode: 'native', actionTools: 'typed', actEveryTicks: 1, historyRounds: 6 };
    // 与服务端 runnerConfig 相同：接口类型与地址都不变时，留空沿用已保存的密钥。
    const keeps = !!(previous && !previous.hosted && previous.hasApiKey && previous.provider === config.provider && previous.baseURL === config.baseURL);
    if (!config.model || !config.baseURL.startsWith('https://') || (!config.apiKey && !keeps)) throw new Error('请填写模型名、API Key 和 HTTPS 接口地址');
    return config;
  }
  /** 打开模型表单时按已保存的配置预填（网站同样做法）；密钥从不回填。 */
  prefill(config) {
    const f = this.app.form;
    if (!config) { if (!f.modelSource) f.modelSource = this.hosted && this.hosted.available ? f.modelSource || 'own' : 'own'; return false; }
    if (config.hosted) { f.modelSource = 'hosted'; f.hostedModel = config.model || ''; return true; }
    f.modelSource = 'own';
    const index = PROVIDERS.indexOf(config.provider);
    Object.assign(f, { providerIndex: index < 0 ? 0 : index, baseURL: config.baseURL || '', model: config.model || '', presetId: 'saved' });
    return true;
  }

  async handle(a) {
    try { await this.act(a); }
    catch (error) { if (!error.stale) throw error; }
  }
  async act(a) {
    const app = this.app, f = app.form, id = app.residentId;
    const path = suffix => '/api/account/residents/' + encodeURIComponent(id) + suffix;
    switch (a.type) {
      case 'stewardTab':
        if (!['overview', 'ledger', 'actions', 'usage', 'timeline', 'manage'].includes(a.tab)) return;
        this.tab = a.tab; this.confirm = null; app.scroller().scrollTo(0);
        if (a.tab === 'timeline' && (!this.timeline || this.timeline.id !== id)) await this.loadTimeline(true);
        if (a.tab === 'usage' && !this.hosted && !this.hostedError) await this.loadHosted();
        return;
      case 'stewardModelSource': f.modelSource = a.source === 'hosted' ? 'hosted' : 'own'; delete f.apiKey; return;
      case 'stewardHostedModel': f.hostedModel = a.id; return;
      case 'stewardCap': {
        const dailyCap = capValue(f.dailyCap);
        const requestId = this.requestId('cap:' + id, String(dailyCap));
        await api.request(path('/cap'), { method: 'POST', data: { dailyCap, requestId } });
        this.done('cap:' + id); await app.loadOwner(); app.showToast('每日上限已更新', 'ok'); return;
      }
      case 'stewardTransfer': {
        const username = (f.transferUsername || '').trim().toLowerCase();
        if (!/^[a-z0-9_]{3,32}$/.test(username)) throw new Error('请填写接收账号的用户名（3–32 位字母、数字或下划线）');
        if (this.confirm !== 'transfer:' + username) { this.confirm = 'transfer:' + username; return; }
        const requestId = this.requestId('transfer:' + id, username);
        await api.request(path('/transfer'), { method: 'POST', data: { username, requestId } });
        this.done('transfer:' + id); this.confirm = null; f.transferUsername = '';
        await this.loadTransfers(); app.showToast('邀请已发出；接收者确认前，你仍管理居民。', 'ok'); return;
      }
      case 'stewardCancelTransfer': {
        const requestId = this.requestId('cancel:' + a.transferId, a.transferId);
        await api.request('/api/account/residents/' + encodeURIComponent(a.agentId) + '/cancel_transfer', { method: 'POST', data: { transferId: a.transferId, requestId } });
        this.done('cancel:' + a.transferId); await this.loadTransfers(); app.showToast('过继邀请已取消', 'ok'); return;
      }
      case 'stewardAcceptOpen': {
        const navigation = app.navigation;
        this.acceptId = a.id; f.acceptCap = f.acceptCap || String(DEFAULT_CAP);
        await Promise.all([app.loadModelPresets(), this.loadHosted()]);
        if (app.navigation !== navigation) return;
        if (!f.presetId && !f.baseURL) app.selectPreset('deepseek');
        this.prefill(null); app.push('transferAccept'); return;
      }
      case 'stewardAccept': {
        if (!f.modelAccepted) throw new Error('请先同意模型调用说明');
        const invitation = (this.transfers || []).find(t => t.id === this.acceptId && t.direction === 'incoming' && t.status === 'pending');
        if (!invitation) throw new Error('这份过继邀请已不可接受，请返回刷新');
        const config = this.runnerConfig(null), dailyCap = capValue(f.acceptCap);
        const requestId = this.requestId('accept:' + invitation.id, JSON.stringify([config.hosted ? config.model || 'hosted' : [config.provider, config.baseURL, config.model], dailyCap]));
        let result;
        try { result = await api.request('/api/account/transfers/' + encodeURIComponent(invitation.id) + '/accept', { method: 'POST', timeout: 60000, data: { config, dailyCap, requestId } }); }
        finally { delete f.apiKey; }
        this.done('accept:' + invitation.id);
        await this.openOwner(result.agentId || invitation.agentId, '已接受过继，请在「总览」启动运行器');
        return;
      }
      case 'stewardAdoptOpen':
        if (!app.user || !app.wechatVerified) throw new Error('请先使用微信登录');
        this.adoptId = a.id; f.adoptCap = f.adoptCap || String(DEFAULT_CAP); app.push('adopt'); return;
      case 'stewardAdopt': {
        if (!f.adoptAccepted) throw new Error('请先阅读并同意隐私说明');
        const soul = ((app.state && app.state.cradle) || []).find(s => s.id === this.adoptId);
        if (!soul) throw new Error('这个灵魂已不在摇篮里');
        const dailyCap = capValue(f.adoptCap);
        const requestId = this.requestId('adopt:' + soul.id, String(dailyCap));
        let result;
        try { result = await api.request('/api/account/residents/adopt', { method: 'POST', timeout: 60000, data: { soulId: soul.id, dailyCap, requestId } }); }
        catch (error) { if (!error.status) throw new Error('结果未确认。保留原提交编号，再次提交不会重复领养。'); throw error; }
        this.done('adopt:' + soul.id);
        await this.openOwner(result.agentId, '已领养，请配置模型后启动');
        return;
      }
      case 'stewardRemoveRunner':
        if (this.confirm !== 'remove') { this.confirm = 'remove'; return; }
        await api.request(path('/runner'), { method: 'POST', data: { op: 'remove' } });
        this.confirm = null; await app.loadOwner(); app.showToast('已移除模型配置；居民不会再醒来，直到重新配置', 'ok'); return;
      case 'stewardAvatarReset': {
        if (this.confirm !== 'avatar') { this.confirm = 'avatar'; return; }
        const requestId = this.requestId('avatar:' + id, 'reset');
        await api.request(path('/avatar'), { method: 'DELETE', data: { requestId } });
        this.done('avatar:' + id); this.confirm = null; await app.loadOwner(); app.showToast('已恢复默认形象', 'ok'); return;
      }
      case 'stewardConfirmCancel': this.confirm = null; return;
      case 'stewardTimelineFilter': await this.loadTimeline(true); return;
      case 'stewardTimelineMore': if (this.timeline && this.timeline.cursor) await this.loadTimeline(false); return;
      case 'stewardLedgerCsv': {
        const t = this.ticket('csv');
        const filePath = await api.download(path('/export?format=csv')).catch(error => { if (!this.current('csv', t) || app.residentId !== id) error.stale = true; throw error; });
        if (!this.current('csv', t) || app.residentId !== id) return;
        this.saved = { id, filePath }; app.showToast('流水已下载，可分享或保存', 'ok'); return;
      }
      case 'stewardLedgerShare':
        if (!this.saved || this.saved.id !== id) return;
        if (app.wx.shareFileMessage) app.wx.shareFileMessage({ filePath: this.saved.filePath, fileName: id + '-ledger.csv', fail: () => app.showToast('未保存或分享文件，可再次操作', 'error') });
        else app.showToast('当前微信版本不支持分享文件，请在网页「收支」导出', 'error');
        return;
      case 'stewardBilling':
        if (!app.user) throw new Error('请先登录');
        app.push('billing'); app.render(); await this.loadHosted(); return;
      case 'stewardCancelRequest': {
        await api.request('/api/account/hosted/requests/' + encodeURIComponent(a.id) + '/cancel', { method: 'POST', data: {} });
        await this.loadHosted(); app.showToast('入账申请已撤回', 'ok'); return;
      }
      case 'stewardImportOpen':
        this.imports = null; app.push('soulImport'); app.render(); await this.loadImports(); return;
      case 'stewardImportTake': {
        const row = (this.imports || [])[a.index];
        if (!row) return;
        const { usable } = require('./utils/feed');
        const fields = ['name', 'bio', 'soul'];
        if (!usable(row.soul.name) || !usable(row.soul.soul)) throw new Error('这份灵魂的文字还未通过内容检查，稍后再带入');
        fields.forEach(k => { if (typeof row.soul[k] === 'string' && usable(row.soul[k])) f[k] = row.soul[k]; });
        if (typeof row.soul.lang === 'string' && /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(row.soul.lang)) f.lang = row.soul.lang;
        app.back(); app.showToast('已带入，可以继续修改', 'ok'); return;
      }
      default: return;
    }
  }
  async openOwner(agentId, notice) {
    const app = this.app;
    app.clearSecrets(); app.navigation++; app.residentId = agentId; app.stack = ['account']; app.tab = 'owner'; this.tab = 'overview'; this.timeline = null;
    app.scroller('owner').reset();
    await app.loadOwner();
    app.notice = notice; app.showToast(notice, 'ok');
  }
}
module.exports = { Stewardship, STEWARD_PAGES: PAGES, DEFAULT_CAP, capValue };
