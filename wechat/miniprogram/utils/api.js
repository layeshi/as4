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
  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json', 'X-Houren-Request': '1' };
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
module.exports = { request, restoreSession, clearSession };
