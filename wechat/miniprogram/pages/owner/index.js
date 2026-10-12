const api = require('../../utils/api');
const page = require('../../utils/page');
const view = require('../../utils/view');
Page({
  data: { key: '', agent: null, letter: '', diary: [], thoughts: [], letters: [], runnerStatus: '', usage: '', error: '', notice: '', busy: false },
  input: page.input,
  onShow() { if (getApp().globalData.ownerKey) this.refresh(); },
  onHide() { this.setData({ key: '' }); },
  onPullDownRefresh() { return this.refresh().finally(() => wx.stopPullDownRefresh()); },
  async connect() {
    if (this.data.busy) return;
    const key = this.data.key.trim();
    if (!/^[0-9a-f]{64}$/.test(key)) { this.setData({ error: '请输入 64 位造者密钥。' }); return; }
    await this.refresh(key);
  },
  async refresh(key = getApp().globalData.ownerKey) {
    if (!key || this.data.busy) return;
    this.setData({ busy: true, error: '', notice: '' });
    try {
      const result = await api.request('/api/owner', { ownerKey: key });
      const agent = result.agents[0];
      getApp().globalData.ownerKey = key; getApp().globalData.ownerAgent = agent.agentId;
      const rows = list => (list || []).slice(-30).reverse().map((r, i) => ({ id: String(i), tick: r.tick, text: view.text(r.text) }));
      const usage = agent.usage;
      this.setData({ key: '', agent: { agentId: agent.agentId, name: agent.name, today: agent.today, nextLetterDay: agent.nextLetterDay }, diary: rows(agent.diary), thoughts: rows(agent.thoughts), letters: rows(agent.letters),
        runnerStatus: view.status(agent.runner && agent.runner.status),
        usage: usage && usage.tracked ? '用量已由服务器记录，可在网站查看完整统计。' : '该居民的模型调用尚未纳入托管统计。' });
    } catch (error) {
      if (error.status === 401) { getApp().globalData.ownerKey = ''; getApp().globalData.ownerAgent = null; this.setData({ agent: null }); }
      page.showError(this, error);
    } finally { this.setData({ busy: false }); }
  },
  async mutate(path, data) {
    if (this.data.busy || !getApp().globalData.ownerKey) return;
    this.setData({ busy: true, error: '', notice: '' });
    let succeeded = false;
    try { await api.request(path, { method: 'POST', data, ownerKey: getApp().globalData.ownerKey }); succeeded = true; }
    catch (error) { page.showError(this, error); }
    finally { this.setData({ busy: false }); }
    if (succeeded) { this.setData({ letter: '' }); await this.refresh(); this.setData({ notice: '已完成。' }); }
  },
  sendLetter() {
    if (!this.data.letter.trim()) { this.setData({ error: '请写下家书内容。' }); return; }
    return this.mutate('/api/owner/letter', { text: this.data.letter.trim(), agentId: this.data.agent.agentId });
  },
  runner(event) { return this.mutate('/api/owner/runner', { op: event.currentTarget.dataset.op }); },
  async claim() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', notice: '' });
    try {
      const result = await api.request('/api/account/agents', { method: 'POST', data: { ownerKey: getApp().globalData.ownerKey } });
      if (!result.results[0].ok) throw new Error('关联失败，请检查密钥或居民的控制权。');
      this.setData({ notice: '已关联到当前登录账号。' });
    } catch (error) { page.showError(this, error); }
    finally { this.setData({ busy: false }); }
  },
  disconnect() {
    getApp().globalData.ownerKey = ''; getApp().globalData.ownerAgent = null;
    this.setData({ agent: null, diary: [], thoughts: [], letters: [], letter: '', key: '', error: '', notice: '' });
  }
});
