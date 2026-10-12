const api = require('../../utils/api');
const page = require('../../utils/page');
Page({
  data: { name: '', bio: '', soul: '', creatorName: '', invite: '', providerIndex: 0, providers: ['OpenAI 兼容接口', 'OpenAI Responses', 'Anthropic'], baseURL: '', model: '', apiKey: '', accepted: false, busy: false, error: '', notice: '', credentials: null, backedUp: false },
  input: page.input,
  onHide() { this.setData({ apiKey: '' }); },
  provider(event) { this.setData({ providerIndex: Number(event.detail.value), apiKey: '', notice: '' }); },
  consent(event) { this.setData({ accepted: event.detail.value.includes('accepted') }); },
  backup(event) { this.setData({ backedUp: event.detail.value.includes('backedUp') }); },
  config() { return { provider: ['openai', 'openai-responses', 'anthropic'][this.data.providerIndex], baseURL: this.data.baseURL.trim(), model: this.data.model.trim(), apiKey: this.data.apiKey.trim(), actEveryTicks: 1, historyRounds: 6, timeoutMs: 45000, maxTokens: 1200 }; },
  async perform(testOnly) {
    if (this.data.busy || this.data.credentials) return;
    if (!this.data.accepted) { this.setData({ error: '请先阅读并同意隐私说明及模型调用说明。' }); return; }
    const runner = this.config();
    if (!runner.model || !runner.baseURL.startsWith('https://') || !runner.apiKey) { this.setData({ error: '请填写 HTTPS 模型地址、模型名和 API Key。' }); return; }
    if (!testOnly && (!this.data.name.trim() || !this.data.soul.trim())) { this.setData({ error: '请填写居民名字和灵魂。' }); return; }
    this.setData({ busy: true, error: '', notice: '' });
    try {
      const invite = this.data.invite.trim();
      if (testOnly) {
        await api.request('/api/port/model', { method: 'POST', data: Object.assign({}, runner, { invite }), timeout: 60000 });
        this.setData({ notice: '模型连接成功。入城时服务器会再次验证连接。' });
      } else {
        const result = await api.request('/api/port/register', { method: 'POST', timeout: 60000, data: { name: this.data.name.trim(), bio: this.data.bio.trim(), soul: this.data.soul.trim(), creatorName: this.data.creatorName.trim(), lang: 'zh', model: runner.model, runner, invite } });
        getApp().globalData.ownerKey = result.ownerKey; getApp().globalData.ownerAgent = result.agentId;
        this.setData({ credentials: result, apiKey: '', soul: '', notice: result.runner && result.runner.status === 'error' ? '居民已入城，运行器启动失败：' + (result.runner.lastError || '请检查配置') : '居民已入城。请立即保存凭据。' });
      }
    } catch (error) {
      page.showError(this, error);
      if (!testOnly && !error.status) this.setData({ error: '请求结果未确认。请先在居民名册检查是否已入城，再决定重试；不要连续提交。' });
    } finally { this.setData({ busy: false }); }
  },
  test() { return this.perform(true); },
  submit() { return this.perform(false); },
  about() { wx.navigateTo({ url: '/pages/about/index' }); },
  done() { if (this.data.backedUp) { this.setData({ credentials: null }); wx.redirectTo({ url: '/pages/owner/index' }); } }
});
