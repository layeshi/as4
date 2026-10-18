const { SocietyGame } = require('../../runtime/society');
const { createPlatform } = require('../../platform');
Page({
  data: { editing: false, inputValue: '', inputLabel: '', multiple: false, secret: false, maxLength: 4000, error: '', subscribing: false, subscribeTitle: '', subscribeBody: '', subscribeLabel: '' },
  onLoad(query) { this._alive = true; this._visible = true; this._launch = query || null; },
  onReady() { this.init(); },
  init() {
    const generation = this._generation = (this._generation || 0) + 1;
    this.setData({ error: '' });
    this.createSelectorQuery().select('#society').fields({ node: true, size: true }).exec(results => {
      if (!this._alive || generation !== this._generation) return;
      const canvas = results && results[0] && results[0].node;
      if (!canvas) { this.setData({ error: '无法初始化画布，请升级微信后重试。' }); return; }
      try {
        this.platform = createPlatform(wx, canvas, this);
        this.game = new SocietyGame(this.platform.api);
        this.game.visible = this._visible;
        if (this._launch) { this.game.setLaunch(this._launch); this._launch = null; }
        Promise.resolve(this.game.start()).catch(() => { if (this._alive) this.setData({ error: '加载失败，请重试。' }); });
        if (!this._visible) this.platform.emit('Hide');
      } catch (_) { this.setData({ error: '当前微信不支持此画布，请升级微信后重试。' }); }
    });
  },
  retry() { if (this.game) this.game.hide(); if (this.platform) this.platform.dispose(); this.init(); },
  // 热启动时页面不会重新 onLoad；本次进入的参数从 getEnterOptionsSync 读取，控制器只处理新的一组。
  onShow() {
    this._visible = true;
    if (!this.platform) return;
    let query = null;
    try {
      const enter = wx.getEnterOptionsSync && wx.getEnterOptionsSync();
      if (enter && String(enter.path || '').replace(/^\//, '') === 'pages/society/index') query = enter.query || null;
    } catch (_) { query = null; }
    this.platform.emit('Show', query ? { query } : {});
  },
  onHide() { this._visible = false; if (this.platform) this.platform.emit('Hide'); },
  onUnload() {
    this.onHide(); this._alive = false; this._generation++;
    if (this.game) { this.game.navigation++; this.game.ctx = null; }
    if (this.platform) this.platform.dispose();
    this.game = null; this.platform = null;
  },
  onResize() { if (this.platform && !this.data.editing) this.platform.emit('WindowResize'); },
  touchStart(e) { if (this.platform) this.platform.emit('TouchStart', e); },
  touchMove(e) { if (this.platform) this.platform.emit('TouchMove', e); },
  touchEnd(e) { if (this.platform) this.platform.emit('TouchEnd', e); },
  touchCancel(e) { if (this.platform) this.platform.emit('TouchCancel', e); },
  input(e) {
    if (!this.data.editing) return;
    this.setData({ inputValue: e.detail.value });
    this.platform.emit('KeyboardInput', { value: e.detail.value });
  },
  confirmInput(e) {
    if (!this.data.editing) return;
    const value = e && e.detail && typeof e.detail.value === 'string' ? e.detail.value : this.data.inputValue;
    this.platform.emit('KeyboardConfirm', { value });
  },
  subscribe() { if (this.platform) this.platform.subscribe(); },
  cancelSubscribe() { if (this.platform) this.platform.cancelSubscribe(); },
  noop() {},
  onShareAppMessage() { return { title: '后人纪 · AI 社会模拟', path: '/pages/society/index' }; }
});
