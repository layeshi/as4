const config = require('../config');
let cookies = {};
const storageKey = 'houren.session:' + config.apiBase;

function restoreSession() {
  try {
    const token = wx.getStorageSync(storageKey);
    if (typeof token === 'string' && /^[a-zA-Z0-9_-]{20,256}$/.test(token)) cookies.houren_session = token;
  } catch (_) { /* 无持久化存储时仍可匿名观测 */ }
}
function clearSession() {
  delete cookies.houren_session;
  try { wx.removeStorageSync(storageKey); } catch (_) {}
}
function captureCookies(response) {
  const header = response.header || {};
  const values = response.cookies && response.cookies.length ? response.cookies : [header['Set-Cookie'] || header['set-cookie'] || ''];
  values.forEach(value => {
    const pattern = /(?:^|,\s*)(houren_session|hv)=([^;,\s]*)/g;
    let match;
    while ((match = pattern.exec(value))) {
      const name = match[1], token = match[2];
      if (token) cookies[name] = token;
      else delete cookies[name];
      if (name === 'houren_session') {
        try {
          if (token) wx.setStorageSync(storageKey, token);
          else wx.removeStorageSync(storageKey);
        } catch (_) {}
      }
    }
  });
}
function request(path, options = {}) {
  if (!/^\/api\//.test(path) || path.includes('..')) return Promise.reject(new Error('接口路径无效'));
  if (path.startsWith('/api/public/')) path = path.replace('/api/public/', '/api/wechat/public/');
  if ((!options.method || options.method === 'GET') && /^\/api\/account\/residents(?:\/|$)/.test(path)) path = path.replace('/api/account/residents', '/api/wechat/residents');
  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json', 'X-Houren-Request': '1', 'X-Houren-Client': 'wechat' };
    const cookie = Object.keys(cookies).map(name => name + '=' + cookies[name]).join('; ');
    if (cookie) header.Cookie = cookie;
    if (options.ownerKey) header.Authorization = 'Bearer ' + options.ownerKey;
    wx.request({
      url: config.apiBase + path, method: options.method || 'GET', data: options.data,
      timeout: options.timeout || 15000, header,
      success(response) {
        captureCookies(response);
        const body = response.data;
        if (response.statusCode >= 200 && response.statusCode < 300 && body && typeof body === 'object' && !body.error) return resolve(body);
        if (response.statusCode === 401 && !options.ownerKey) clearSession();
        const error = new Error(body && body.error && (body.error.message || body.error.code) || '服务暂不可用，请稍后刷新');
        error.status = response.statusCode;
        error.code = body && body.error && body.error.code;
        reject(error);
      },
      fail() { reject(new Error('连接失败，请检查网络后重试')); }
    });
  });
}
function loginWeChat(bindCurrent) {
  return new Promise((resolve, reject) => {
    wx.login({ timeout: 10000, success: result => result.code ? resolve(result.code) : reject(new Error('微信登录失败，请重试')), fail: () => reject(new Error('微信登录失败，请重试')) });
  }).then(code => request('/api/wechat/login', { method: 'POST', timeout: 30000, data: { code, bindCurrent: !!bindCurrent } }));
}
function requestId() {
  // Idempotency identifier, not an authentication credential.
  return 'wx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

module.exports = { request, restoreSession, clearSession, loginWeChat, requestId };
