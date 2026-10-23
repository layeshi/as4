// 账户资料（网站 account.html 的 settingsPanel）：昵称、已验证的联系方式（解除、添加或更换）、微信关联。
// 昵称经 PATCH /api/account 提交，服务端对微信会话做内容安全检查；修改密码沿用「网页登录与密码」的微信身份验证流程，
// 不走网站的 PATCH 改密（那会签发不带微信身份的新会话）。
const api = require('./utils/api');

class Profile {
  constructor(app) { this.app = app; this.confirm = null; this.draft = null; }
  reset() { this.confirm = null; this.draft = null; }
  async handle(a) {
    const app = this.app, f = app.form;
    if (!app.user) throw new Error('请先登录');
    switch (a.type) {
      case 'profile':
        this.confirm = null; f.displayName = app.user.displayName || ''; app.push('profile'); return;
      case 'profileSave': {
        const displayName = (f.displayName || '').trim();
        if (!displayName || Array.from(displayName).length > 60) throw new Error('昵称须为 1–60 个字');
        if (displayName === app.user.displayName) { app.showToast('昵称没有变化', 'ok'); return; }
        const result = await api.request('/api/account', { method: 'PATCH', data: { displayName } });
        app.user = result.user || app.user; await app.loadAccount(); app.showToast('资料已保存', 'ok'); return;
      }
      case 'profileRemoveContact': {
        if (!['email', 'phone'].includes(a.kind) || !(app.user.contacts || {})[a.kind]) return;
        if (this.confirm !== 'contact:' + a.kind) { this.confirm = 'contact:' + a.kind; return; }
        let result;
        try {
          if (app.user.passwordLoginEnabled) {
            if (!f.currentPassword) throw new Error('请填写当前密码');
            result = await api.removeContactByPassword(a.kind, f.currentPassword);
          } else result = await api.removeContactByWechat(a.kind);
        } finally { delete f.currentPassword; }
        this.confirm = null; app.user = result.user || app.user; await app.loadAccount(); app.showToast('联系方式已解除', 'ok'); return;
      }
      case 'profileUnlink': {
        if (!(app.user.wechatApps || []).includes(a.appid) || a.appid === app.wechatAppId) return;
        if (this.confirm !== 'unlink:' + a.appid) { this.confirm = 'unlink:' + a.appid; return; }
        if (!f.currentPassword) throw new Error('请填写当前密码');
        let result;
        try { result = await api.request('/api/account/wechat/' + encodeURIComponent(a.appid), { method: 'DELETE', data: { currentPassword: f.currentPassword } }); }
        finally { delete f.currentPassword; }
        this.confirm = null; app.user = result.user || app.user; await app.loadAccount(); app.showToast('已解除这项微信绑定', 'ok'); return;
      }
      case 'profileCancel': this.confirm = null; return;
      default: return;
    }
  }
}
module.exports = { Profile };
