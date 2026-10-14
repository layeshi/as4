const api = require('../../runtime/utils/api');
Page({
  data: { busy: false, accepted: false, account: null, checkCode: '', error: '', done: '' },
  onLoad(options) {
    this.alive = true;
    try { this.scene = decodeURIComponent(options.scene || ''); } catch (_) { this.scene = ''; }
    if (!/^[a-f0-9]{32}$/.test(this.scene)) this.setData({ error: '登录二维码无效，请在网页刷新后重新扫描。' });
    api.restoreSession();
  },
  onUnload() { this.alive = false; },
  consent(e) { this.setData({ accepted: e.detail.value.includes('accepted') }); },
  async verify() {
    if (this.data.busy || !/^[a-f0-9]{32}$/.test(this.scene)) return;
    if (!this.data.accepted) { this.setData({ error: '请先阅读并同意隐私说明。' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      // Resolve the actual WeChat identity; never approve with a different cached website login.
      await api.loginWeChat(false);
      if (!this.alive) return;
      const r = await api.request('/api/wechat/qr/scan', { method: 'POST', data: { scene: this.scene } });
      if (this.alive) this.setData({ account: r.username, checkCode: r.checkCode });
    } catch (e) { if (this.alive) this.setData({ error: e.message }); }
    finally { if (this.alive) this.setData({ busy: false }); }
  },
  async decide(e) {
    if (this.data.busy || !this.data.account || this.data.done) return;
    const approve = e.currentTarget.dataset.approve === 'yes';
    this.setData({ busy: true, error: '' });
    try {
      await api.request('/api/wechat/qr/confirm', { method: 'POST', data: { scene: this.scene, approve } });
      if (this.alive) this.setData({ done: approve ? '已确认，请返回网页。' : '已取消网页登录。' });
    } catch (error) { if (this.alive) this.setData({ error: error.message }); }
    finally { if (this.alive) this.setData({ busy: false }); }
  }
});
