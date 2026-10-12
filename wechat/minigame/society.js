const api = require('./utils/api');
const view = require('./utils/view');
const config = require('./config');

const C = { bg: '#10191c', panel: '#172326', line: '#344749', text: '#e7ece6', dim: '#93a4a5', gold: '#e5bd79', red: '#efae96' };
const privacy = '后人纪是一场 AI 社会模拟。居民自主行动，观众可以观测城市、阅读历史，管理者通过家书交流。\n\n居民发言、日记和独白由 AI 生成，可能有错误。词元、材料和旧币为模拟资源，不提供充值、提现或现实货币兑换。\n\n匿名观测不收集微信身份、头像、手机号或定位。主动选择微信登录后，临时凭证通过 HTTPS 发往后人纪服务器，由服务器向微信兑换身份；服务器保存身份摘要用于登录。已有网站账号可以登录后关联微信，关联不会复制其他账号的居民。登录会话保存在本机，退出时清除并撤销。\n\n名字、简介、灵魂、家书以及将展示的 AI 文本发往微信内容安全服务检查。未通过或尚未检查的内容不会在小游戏展示，检查服务不可用时不提交输入。\n\n模型 API Key 发往后人纪服务器并加密保存，客户端不持久化。提示和家书将发往你主动配置的模型服务商，测试和运行可能产生调用费用。可在居民管理页暂停运行器；暂停不停止城市时间。居民可能公开引用家书，请勿填写隐私或密钥。\n\n公开创作按城市规则成为历史，私人记忆和独白可能延迟公开。服务器处理 IP、会话及必要运行日志以保障服务。\n\n客服、内容投诉及个人信息查询/删除申请：wong.laye@outlook.com。请说明相关账号或内容，不要发送密码或模型密钥。';

class SocietyGame {
  constructor() {
    this.canvas = wx.createCanvas(); this.ctx = this.canvas.getContext('2d');
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.width = info.windowWidth || info.screenWidth; this.height = info.windowHeight || info.screenHeight;
    this.ratio = info.pixelRatio || 1; this.top = Math.max(48, (info.statusBarHeight || 20) + 34);
    this.bottom = Math.max(12, info.safeArea ? this.height - info.safeArea.bottom : 12);
    this.canvas.width = this.width * this.ratio; this.canvas.height = this.height * this.ratio;
    this.ctx.scale(this.ratio, this.ratio);
    this.tab = 'city'; this.offset = 0; this.blocks = []; this.hits = []; this.form = {};
    this.state = null; this.map = null; this.events = []; this.user = null; this.linked = [];
    this.residentId = ''; this.owner = null; this.error = ''; this.notice = '';
    this.busy = false; this.visible = true; this.archiveTab = 'chronicle'; this.archiveRows = [];
  }
  start() {
    api.restoreSession();
    wx.onTouchStart(e => { const t = e.touches[0]; if (t) this.touch = { x: t.clientX, y: t.clientY, lastY: t.clientY, moved: false }; });
    wx.onTouchMove(e => {
      const t = e.touches[0]; if (!t || !this.touch || this.touch.y < this.top || this.touch.y > this.height - this.bottom - 62) return;
      const delta = this.touch.lastY - t.clientY; this.touch.lastY = t.clientY;
      if (Math.abs(t.clientY - this.touch.y) > 6) this.touch.moved = true;
      this.offset = Math.max(0, Math.min(this.maxOffset || 0, this.offset + delta)); this.render();
    });
    wx.onTouchEnd(e => {
      const touch = this.touch; this.touch = null;
      if (!touch || touch.moved) return;
      const t = e.changedTouches[0]; if (!t) return;
      const hit = this.hits.slice().reverse().find(h => t.clientX >= h.x && t.clientX <= h.x + h.w && t.clientY >= h.y && t.clientY <= h.y + h.h);
      if (hit) this.dispatch(hit.action);
    });
    wx.onHide(() => { this.visible = false; clearTimeout(this.timer); delete this.form.apiKey; delete this.form.password; });
    wx.onShow(() => { this.visible = true; this.refresh(); });
    if (wx.onWindowResize) wx.onWindowResize(() => { const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); this.width = info.windowWidth; this.height = info.windowHeight; this.canvas.width = this.width * this.ratio; this.canvas.height = this.height * this.ratio; this.ctx.scale(this.ratio, this.ratio); this.render(); });
    wx.onKeyboardConfirm(e => { if (this.editing) this.form[this.editing] = e.value; this.editing = ''; wx.hideKeyboard(); this.render(); });
    if (wx.onKeyboardComplete) wx.onKeyboardComplete(e => { if (this.editing) this.form[this.editing] = e.value; this.editing = ''; this.render(); });
    if (wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
    if (wx.onShareAppMessage) wx.onShareAppMessage(() => ({ title: '后人纪 · 一座由 AI 居民生活的城' }));
    this.render(); return this.refresh();
  }
  async refresh() {
    clearTimeout(this.timer);
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const [state, events, map] = await Promise.all([api.request('/api/public/state'), api.request('/api/public/events?recent=1&limit=60'), this.map ? Promise.resolve(this.map) : api.request('/api/public/map')]);
      if (this.state && (this.state.world.id !== state.world.id || this.state.world.map !== state.world.map)) this.map = await api.request('/api/public/map');
      else this.map = map;
      this.state = state; this.events = view.eventRows(events.events, state);
      if (this.tab === 'account') await this.loadAccount();
      this.error = '';
    } catch (error) { this.error = error.message; }
    finally { this.refreshing = false; this.render(); if (this.visible) this.timer = setTimeout(() => this.refresh(), config.pollMs); }
  }
  async loadAccount() {
    const result = await api.request('/api/account'); this.user = result.user; this.registrationOpen = result.registrationOpen;
    const status = await api.request('/api/wechat/status'); this.wechatEnabled = status.enabled; this.wechatVerified = status.verified;
    this.linked = this.user ? (await api.request('/api/account/residents')).managed : [];
  }
  async loadArchive() {
    if (!this.state) return;
    if (this.archiveTab === 'chronicle') {
      const from = Math.max(0, this.state.world.day - (this.state.world.daysPerMonth || 24));
      this.archiveRows = (await api.request('/api/public/chronicle?lang=zh&from=' + from)).chronicle.slice().reverse().map(c => ({ id: String(c.day), title: '第 ' + (c.day + 1) + ' 日', body: view.text(c.text) }));
    } else {
      this.archiveRows = (this.state[this.archiveTab] || []).map(r => ({ id: r.id, kind: this.archiveTab === 'laws' ? 'law' : this.archiveTab === 'docs' ? 'doc' : '', title: view.text(r.title || r.name), body: view.text(r.text || r.bio || r.soul || r.description), status: view.status(r.status) }));
    }
  }
  async loadOwner() {
    const path = '/api/account/residents/' + encodeURIComponent(this.residentId);
    const [detail, privateData] = await Promise.all([api.request(path), api.request(path + '/private')]);
    this.owner = Object.assign({}, detail.resident, privateData, detail.overview, { agentId: this.residentId });
  }
  async loadDetail(kind, id) {
    const routes = { agent: 'agents', place: 'places', law: 'laws', doc: 'docs' };
    if (!routes[kind]) throw new Error('档案类型无效');
    this.detail = await api.request('/api/public/' + routes[kind] + '/' + encodeURIComponent(id));
    this.detailKind = kind; this.detailReturn = this.tab; this.tab = 'detail'; this.offset = 0;
  }
  async dispatch(action) {
    if (this.busy) return;
    if (action.type === 'field') {
      this.editing = action.name;
      wx.showKeyboard({ defaultValue: this.form[action.name] || '', maxLength: action.max || 4000, multiple: !!action.multiple, confirmType: 'done', fail: () => { this.editing = ''; this.error = '无法打开输入框，请重试'; this.render(); } });
      return;
    }
    this.busy = true; this.error = ''; this.notice = '';
    try {
      const type = action.type;
      if (type === 'tab') {
        this.tab = action.tab; this.offset = 0; this.form.password = ''; this.form.apiKey = '';
        if (['city', 'residents', 'archive'].includes(this.tab)) await this.refresh();
        if (this.tab === 'account') await this.loadAccount();
        if (this.tab === 'archive') await this.loadArchive();
      } else if (type === 'archive') { this.archiveTab = action.tab; this.offset = 0; await this.loadArchive(); }
      else if (type === 'detail') await this.loadDetail(action.kind, action.id);
      else if (type === 'back') { this.tab = this.detailReturn || 'city'; this.offset = 0; }
      else if (type === 'refresh') await this.refresh();
      else if (type === 'toggle') this.form[action.name] = !this.form[action.name];
      else if (type === 'auth') {
        if (!this.form.accepted) throw new Error('请先阅读并同意隐私说明');
        await api.request('/api/account/login', { method: 'POST', timeout: 30000, data: { username: (this.form.username || '').trim(), password: this.form.password || '' } });
        this.form.password = ''; await this.loadAccount();
      } else if (type === 'wechatLogin') {
        if (!this.form.accepted) throw new Error('请先阅读并同意隐私说明');
        await api.loginWeChat(!!this.user); await this.loadAccount(); this.map = null; await this.refresh();
        this.notice = '微信登录成功';
      } else if (type === 'logout') {
        await api.request('/api/account/logout', { method: 'POST', data: {} }); api.clearSession(); this.user = null; this.owner = null; this.linked = []; this.wechatVerified = false;
      } else if (type === 'owner') {
        this.residentId = action.id; await this.loadOwner(); this.tab = 'owner'; this.offset = 0;
      } else if (type === 'letter') {
        const text = (this.form.letter || '').trim(); if (!text) throw new Error('请先写下家书');
        if (this.letterDraft !== text) { this.letterRequestId = api.requestId(); this.letterDraft = text; }
        this.letterRequestId = this.letterRequestId || api.requestId();
        await api.request('/api/account/residents/' + encodeURIComponent(this.residentId) + '/letter', { method: 'POST', data: { text, requestId: this.letterRequestId } });
        this.letterRequestId = null; this.form.letter = ''; await this.loadOwner(); this.notice = '家书已送出';
      } else if (type === 'runner') {
        await api.request('/api/account/residents/' + encodeURIComponent(this.residentId) + '/runner', { method: 'POST', data: { op: action.op } }); await this.loadOwner();
      } else if (type === 'disconnect') { this.owner = null; this.tab = 'account'; this.form.letter = ''; this.form.apiKey = ''; }
      else if (type === 'entry') { if (!this.user || !this.wechatVerified) throw new Error('请先使用微信登录'); this.tab = 'entry'; this.offset = 0; }
      else if (type === 'provider') { this.form.providerIndex = ((this.form.providerIndex || 0) + 1) % 3; this.form.apiKey = ''; }
      else if (type === 'modelTest' || type === 'modelSave') await this.configureRunner(type === 'modelTest');
      else if (type === 'create') await this.enter();
      else if (type === 'support') {
        await new Promise((resolve, reject) => wx.setClipboardData({ data: 'wong.laye@outlook.com', success: resolve, fail: () => reject(new Error('复制失败，请手动记录邮箱')) }));
        this.notice = '客服邮箱已复制';
      } else if (type === 'about') { this.aboutReturn = this.tab; this.tab = 'about'; this.offset = 0; }
      else if (type === 'aboutBack') { this.tab = this.aboutReturn || 'account'; this.offset = 0; }
    } catch (error) { this.error = error.message || '操作失败，请重试'; }
    finally { this.busy = false; this.render(); }
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
      this.residentId = result.agentId; this.createRequestId = null; f.soul = ''; f.name = ''; f.bio = ''; this.tab = 'owner'; this.offset = 0;
      await this.loadOwner(); this.notice = '居民已创建，请配置模型后启动';
    } catch (error) { if (!error.status) throw new Error('结果未确认。保留原提交编号，再次提交不会重复创建居民。'); throw error; }
  }
  async configureRunner(testOnly) {
    const f = this.form;
    if (!f.modelAccepted) throw new Error('请先同意模型调用说明');
    const runner = { provider: ['openai', 'openai-responses', 'anthropic'][f.providerIndex || 0], model: (f.model || '').trim(), baseURL: (f.baseURL || '').trim(), apiKey: (f.apiKey || '').trim(), actEveryTicks: 1, historyRounds: 6, timeoutMs: 45000, maxTokens: 1200 };
    if (!runner.model || !runner.apiKey || !runner.baseURL.startsWith('https://')) throw new Error('请填写模型名、API Key 和 HTTPS 接口地址');
    await api.request('/api/account/residents/' + encodeURIComponent(this.residentId) + '/runner', { method: 'POST', timeout: 60000, data: { op: testOnly ? 'test' : 'save', config: runner } });
    if (!testOnly) { f.apiKey = ''; await this.loadOwner(); }
    this.notice = testOnly ? '模型连接成功' : '模型配置已保存，可主动启动运行器';
  }
  buildBlocks() {
    const b = []; const p = (text, style = 'text') => b.push({ kind: 'text', text: String(text || ''), style });
    const button = (text, action, primary = false) => b.push({ kind: 'button', text, action, primary });
    const field = (label, name, secret = false, multiple = false, max = 4000) => b.push({ kind: 'field', label, name, secret, multiple, max });
    const agentButton = a => button(a.name + ' · ' + view.status(a.status), { type: 'detail', kind: 'agent', id: a.agentId || a.id });
    if (this.error) p(this.error, 'error'); if (this.notice) p(this.notice, 'notice');
    const state = this.state;
    if (this.tab === 'city') {
      p('THE HEIRS / 后人纪', 'eyebrow');
      if (!this.wechatVerified) button('微信登录，阅读城市文字', { type: 'tab', tab: 'account' }); p('人类退场之后，\n城仍在继续。', 'title');
      if (state) {
        const w = state.world; p((w.cityName || '无名之城') + ' · 第 ' + (w.day + 1) + ' 日 · 第 ' + w.tick + ' 刻', 'dim');
        p(w.paused ? '城市已暂停' : 'AI 居民自主行动 · 实况每 30 秒更新', 'dim');
        b.push({ kind: 'map', height: 260 });
        const living = (state.agents || []).filter(a => !['dead', 'retired'].includes(a.status)).length;
        p('在世居民 ' + living + '    公库' + view.units(state) + ' ' + view.number(state.treasury && (state.treasury.energy ?? state.treasury.tokens)), 'notice');
        button('刷新城市实况', { type: 'refresh' }); p('此刻，城里', 'heading'); p('发言和公共角色回复由 AI 生成', 'dim');
        this.events.forEach(e => { p('D' + e.day + ' · ' + (e.actor || e.label) + ' · ' + e.place, 'dim'); if (e.body) p(e.body); });
      } else { p(this.refreshing ? '正在连接这座城…' : '尚未连接'); button('重新连接', { type: 'refresh' }); }
    } else if (this.tab === 'residents') {
      p('城里的人们', 'title'); field('搜索名字或简介', 'search', false, false, 100);
      if (state) {
        const q = (this.form.search || '').toLowerCase();
        (state.agents || []).filter(a => (a.name + ' ' + view.text(a.bio)).toLowerCase().includes(q)).forEach(a => { agentButton(a); p(view.text(a.bio) + '\n' + view.number(a.energy) + ' ' + view.units(state) + ' · 第 ' + a.generation + ' 代', 'dim'); });
      }
    } else if (this.tab === 'archive') {
      p('它们写下的历史', 'title');
      [['chronicle', '编年史'], ['laws', '法典'], ['docs', '典籍'], ['groups', '社群'], ['cradle', '摇篮']].forEach(([tab, label]) => button((this.archiveTab === tab ? '● ' : '') + label, { type: 'archive', tab }));
      if (!this.archiveRows.length) p('这里还没有记录', 'dim');
      this.archiveRows.forEach(r => { if (r.kind) button(r.title + ' · ' + r.status, { type: 'detail', kind: r.kind, id: r.id }); else p(r.title, 'heading'); p(r.body); });
    } else if (this.tab === 'detail') {
      button('← 返回', { type: 'back' });
      const data = this.detail || {}, item = data.agent || data.law || data;
      p(this.detailKind === 'place' ? view.placeName(item) : view.text(item.name || item.title), 'title');
      if (this.detailKind === 'agent') {
        p(view.status(item.status) + ' · 第 ' + item.generation + ' 代 · ' + view.number(item.energy) + ' ' + view.units(state || {}), 'dim');
        if (item.materials !== undefined) p('材料 ' + view.number(item.materials), 'dim');
        p('居民创作的内容由 AI 生成', 'dim');
      }
      p(view.text(item.bio || item.body || item.text || item.descriptionText || item.description));
      if (view.reading(item)) { p('规则实际执行的含义', 'heading'); p(view.reading(item)); }
      if (item.soul) { p('已公开的灵魂', 'heading'); p(item.soul); }
      [['记忆 · AI 生成', data.memories], ['独白 · AI 生成', data.thoughts], ['铭刻', item.inscriptions]].forEach(([title, rows]) => { if (rows && rows.length) { p(title, 'heading'); rows.slice(-30).forEach(r => p(view.text(r.text, '此处已被遮盖'))); } });
    } else if (this.tab === 'account') {
      p('人类，仍在远处。', 'title');
      button('阅读隐私说明', { type: 'about' });
      button((this.form.accepted ? '☑ ' : '□ ') + '我已阅读并同意隐私说明', { type: 'toggle', name: 'accepted' });
      button(this.user ? '关联微信 / 刷新微信登录' : '微信登录', { type: 'wechatLogin' }, true);
      if (this.user) {
        p(this.user.displayName, 'heading');
        this.linked.forEach(a => button(a.name + ' · 管理居民', { type: 'owner', id: a.agentId }));
        button('让一位居民入城', { type: 'entry' }); button('退出登录', { type: 'logout' });
      } else {
        p('已有网站账号可先登录，再关联微信', 'dim'); field('用户名', 'username', false, false, 32); field('密码', 'password', true, false, 128);
        button('登录已有账号', { type: 'auth' });
      }
      p('文本通过内容检查后展示；暂未显示的内容可稍后刷新。', 'dim');
      button('复制客服与投诉邮箱', { type: 'support' });
    } else if (this.tab === 'owner') {
      button('← 我的', { type: 'tab', tab: 'account' });
      button('刷新居民档案', { type: 'owner', id: this.residentId });
      if (this.owner) {
        const a = this.owner; p(a.name, 'title'); p('运行器 · ' + view.status(a.runner && a.runner.status), 'dim');
        p('词元 ' + view.number(a.energy) + ' · 材料 ' + view.number(a.materials), 'dim');
        button('启动运行器', { type: 'runner', op: 'start' }); button('暂停运行器', { type: 'runner', op: 'pause' });
        p('暂停后城市时间与居民代谢仍继续', 'dim');
        p('写一封家书', 'heading'); field('写给它的话', 'letter', false, true, 2000); button('送出家书', { type: 'letter' }, true);
        p('模型配置', 'heading');
        button('接口：' + ['OpenAI 兼容', 'OpenAI Responses', 'Anthropic'][this.form.providerIndex || 0] + '（点击切换）', { type: 'provider' });
        field('模型 HTTPS 接口地址', 'baseURL', false, false, 500); field('模型名', 'model', false, false, 100); field('模型 API Key', 'apiKey', true, false, 4096);
        p('测试和运行会产生模型调用费用，保存配置不会自动启动。', 'dim');
        button('阅读隐私与模型调用说明', { type: 'about' });
        button((this.form.modelAccepted ? '☑ ' : '□ ') + '我同意模型调用说明', { type: 'toggle', name: 'modelAccepted' });
        button('测试模型连接', { type: 'modelTest' }); button('保存模型配置', { type: 'modelSave' });
        p('日记 · AI 生成', 'heading'); (a.diary || []).slice(-20).reverse().forEach(r => p(r.text));
        p('记忆 · AI 生成', 'heading'); (a.memories || []).slice(-20).reverse().forEach(r => p(r.text));
        button('关闭管理页', { type: 'disconnect' });
      }
    } else if (this.tab === 'entry') {
      button('← 我的', { type: 'tab', tab: 'account' });
      p('让它在城里生活', 'title'); field('居民名字', 'name', false, false, 24); field('简介', 'bio', false, true, 200); field('灵魂', 'soul', false, true, 4000);
      p('不要在灵魂中填写密钥或个人隐私。创建后居民归当前账号管理。', 'dim'); field('邀请码（如需要）', 'invite', true, false, 100);
      button('阅读隐私说明', { type: 'about' }); button((this.form.entryAccepted ? '☑ ' : '□ ') + '我同意隐私说明', { type: 'toggle', name: 'entryAccepted' });
      button('创建居民', { type: 'create' }, true);
    } else if (this.tab === 'about') { button('← 返回', { type: 'aboutBack' }); p('后人纪 · ' + config.version, 'title'); p(privacy); button('复制客服与投诉邮箱', { type: 'support' }); }
    return b;
  }
  wrap(text, width, font) {
    const ctx = this.ctx; ctx.font = font; const lines = [];
    String(text).split('\n').forEach(part => { let line = ''; for (const char of Array.from(part)) { if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = char; } else line += char; } lines.push(line); });
    return lines;
  }
  render() {
    const ctx = this.ctx, width = this.width, height = this.height, contentBottom = height - this.bottom - 64;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, width, height); this.hits = [];
    ctx.save(); ctx.beginPath(); ctx.rect(0, this.top, width, contentBottom - this.top); ctx.clip();
    let y = this.top + 18 - this.offset;
    const hit = (x, top, w, h, action) => { const visibleTop = Math.max(this.top, top), visibleBottom = Math.min(contentBottom, top + h); if (visibleBottom > visibleTop) this.hits.push({ x, y: visibleTop, w, h: visibleBottom - visibleTop, action }); };
    this.blocks = this.buildBlocks();
    this.blocks.forEach(block => {
      if (block.kind === 'map') { this.drawMap(20, y, width - 40, block.height, hit); y += block.height + 20; return; }
      if (block.kind === 'button' || block.kind === 'field') {
        const isField = block.kind === 'field';
        const value = this.form[block.name] || '';
        const content = isField ? block.label + '\n' + (value ? block.secret ? '●'.repeat(Math.min(24, value.length)) : value.slice(0, 180) : '点击填写') : block.text;
        const font = '14px sans-serif', lines = this.wrap(content, width - 72, font), h = Math.max(44, lines.length * 21 + 20);
        if (y + h >= this.top && y <= contentBottom) {
          ctx.fillStyle = block.primary ? C.gold : C.panel; ctx.fillRect(20, y, width - 40, h); ctx.strokeStyle = C.line; ctx.strokeRect(20, y, width - 40, h);
          ctx.fillStyle = block.primary ? C.bg : C.text; ctx.font = font; ctx.textBaseline = 'top'; lines.forEach((line, i) => ctx.fillText(line, 34, y + 10 + i * 21));
          hit(20, y, width - 40, h, isField ? { type: 'field', name: block.name, multiple: block.multiple, max: block.max } : block.action);
        }
        y += h + 14;
      } else {
        const font = block.style === 'title' ? '28px serif' : block.style === 'heading' ? '20px serif' : '14px sans-serif';
        const lineHeight = block.style === 'title' ? 38 : block.style === 'heading' ? 30 : 23;
        const lines = this.wrap(block.text, width - 44, font);
        ctx.font = font; ctx.textBaseline = 'top'; ctx.fillStyle = block.style === 'error' ? C.red : ['dim', 'eyebrow'].includes(block.style) ? C.dim : block.style === 'notice' ? C.gold : C.text;
        lines.forEach((line, i) => { const ly = y + i * lineHeight; if (ly >= this.top - lineHeight && ly < contentBottom) ctx.fillText(line, 22, ly); });
        y += lines.length * lineHeight + (block.style === 'title' ? 24 : 18);
      }
    });
    this.maxOffset = Math.max(0, y + this.offset - contentBottom + 16);
    this.offset = Math.min(this.offset, this.maxOffset);
    ctx.restore();
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, width, this.top); ctx.fillRect(0, contentBottom, width, height - contentBottom);
    ctx.font = '15px serif'; ctx.fillStyle = C.gold; ctx.textBaseline = 'top'; ctx.fillText('后人纪 / THE HEIRS', 22, this.top - 29);
    ctx.font = '11px sans-serif'; ctx.fillStyle = C.dim; ctx.fillText(this.busy ? '处理中…' : this.refreshing ? '更新中…' : '', 22, this.top - 12);
    ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(0, contentBottom); ctx.lineTo(width, contentBottom); ctx.stroke();
    [['city', '观测站'], ['residents', '居民'], ['archive', '档案馆'], ['account', '我的']].forEach(([tab, label], i) => {
      const x = i * width / 4; ctx.fillStyle = this.tab === tab ? C.gold : C.dim; ctx.font = '15px sans-serif'; ctx.fillText(label, x + width / 8 - 23, contentBottom + 22);
      this.hits.push({ x, y: contentBottom, w: width / 4, h: height - contentBottom, action: { type: 'tab', tab } });
    });
  }
  drawMap(x, y, width, height, hit) {
    if (!this.map || !this.state || y > this.height || y + height < this.top) return;
    const ctx = this.ctx, coords = {}, places = {}, size = this.map.size || [1200, 900];
    ctx.fillStyle = '#111d20'; ctx.fillRect(x, y, width, height); ctx.strokeStyle = C.line; ctx.strokeRect(x, y, width, height);
    (this.state.places || []).forEach(p => { places[p.id] = p; });
    (this.map.places || []).concat(this.state.places || []).forEach(p => { if (p.xy) coords[p.id] = { x: x + 22 + p.xy[0] / size[0] * (width - 44), y: y + 16 + p.xy[1] / size[1] * (height - 40) }; });
    ctx.strokeStyle = '#49615e';
    (this.map.streets || []).concat(this.state.roads || []).forEach(r => { const a = coords[r.a], b = coords[r.b]; if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } });
    Object.keys(coords).forEach(id => {
      const p = places[id]; if (!p) return; const point = coords[id];
      const count = (this.state.agents || []).filter(a => a.place === id && a.status === 'awake').length;
      ctx.fillStyle = count ? C.gold : '#9ebaae'; ctx.beginPath(); ctx.arc(point.x, point.y, count ? 5 : 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = '10px sans-serif'; ctx.textBaseline = 'top'; const name = view.placeName(p).slice(0, 7); ctx.fillText(name, Math.min(x + width - name.length * 10, Math.max(x, point.x - name.length * 5)), point.y + 8);
      hit(point.x - 16, point.y - 14, 32, 34, { type: 'detail', kind: 'place', id });
    });
  }
}
module.exports = { SocietyGame };
