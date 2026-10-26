const config = require('../config');
let cookies = {};
let sessionGeneration = 0;
const storageKey = 'houren.session:' + (config.appid ? config.appid + ':' : '') + config.apiBase;

function sessionCurrent(generation, token) {
  return generation === sessionGeneration && token === cookies.houren_session;
}

function restoreSession() {
  try {
    const token = wx.getStorageSync(storageKey);
    if (typeof token === 'string' && /^[a-zA-Z0-9_-]{20,256}$/.test(token) && token !== cookies.houren_session) {
      sessionGeneration++;
      cookies.houren_session = token;
    }
  } catch (_) { /* 无持久化存储时仍可匿名观测 */ }
}
function clearSession() {
  sessionGeneration++;
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
      if (name === 'houren_session' && (token || undefined) !== cookies.houren_session) sessionGeneration++;
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
// 小程序只做观测与已有记录查询。读取照常（已移除功能的接口除外）；写入只放行账户身份、居民提醒订阅与已读、
// 已有历史的打包导出，其他写入在本机直接拒绝，不发出请求。服务端对微信会话另有同样的限制。
const OBSERVATION_ONLY = '小程序仅提供观测与已有记录查询，此操作不可用。';
const REMOVED_READS = /^\/api\/(?:assistant|admin|me|owner|runner|port\/model|(?:wechat\/)?model-presets|(?:wechat\/)?account\/(?:hosted|transfers|worlds))(?:[/?]|$)/;
const WRITES = [
  ['POST', /^\/api\/history\/exports(?:\/[a-f0-9-]+\/retry)?$/],
  ['POST', /^\/api\/wechat\/(?:login|password-login|password|merge\/preview|merge\/confirm|qr\/scan|qr\/confirm)$/],
  ['POST', /^\/api\/account\/(?:logout|contacts|verification\/request|verification\/confirm)$/],
  ['DELETE', /^\/api\/account\/contacts\/(?:email|phone)$/],
  ['PATCH', /^\/api\/account$/],
  ['DELETE', /^\/api\/account\/wechat\/wx[0-9a-f]{16}$/],
  ['POST', /^\/api\/wechat\/notifications\/(?:preferences|authorization|authorization\/result|records\/read)$/],
];
function observationOnly() {
  const error = new Error(OBSERVATION_ONLY);
  error.status = 403; error.code = 'wechat_observation_only';
  return error;
}
function permitted(method, path) {
  if (method === 'GET') return !REMOVED_READS.test(path);
  return WRITES.some(([m, pattern]) => m === method && pattern.test(path));
}
function request(path, options = {}) {
  if (!/^\/api\//.test(path) || path.includes('..')) return Promise.reject(new Error('接口路径无效'));
  const method = String(options.method || 'GET').toUpperCase();
  if (!permitted(method, path)) return Promise.reject(observationOnly());
  if (path.startsWith('/api/public/')) path = path.replace('/api/public/', '/api/wechat/public/');
  if (/^\/api\/messages(?:[/?]|$)/.test(path)) path = path.replace('/api/messages', '/api/wechat/messages');
  if (method === 'GET' && /^\/api\/account\/residents(?:[/?]|$)/.test(path)) path = path.replace('/api/account/residents', '/api/wechat/residents');
  const generation = sessionGeneration, session = cookies.houren_session;
  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json', 'X-Houren-Request': '1', 'X-Houren-Client': 'wechat' };
    const cookie = Object.keys(cookies).map(name => name + '=' + cookies[name]).join('; ');
    if (cookie) header.Cookie = cookie;
    wx.request({
      url: config.apiBase + path, method, data: options.data,
      timeout: options.timeout || 15000, header,
      success(response) {
        // Old account callbacks may settle, but cannot change the current credential jar.
        const current = sessionCurrent(generation, session);
        if (current) captureCookies(response);
        const body = response.data;
        const code = body && body.error && body.error.code;
        if (response.statusCode >= 200 && response.statusCode < 300 && body && typeof body === 'object' && !body.error) return resolve(body);
        // Content-check identity expiry is distinct from an invalid website account session.
        if (current && response.statusCode === 401 && !['wechat_login_required', 'invalid_credentials', 'wechat_login_failed', 'invalid_password'].includes(code)) clearSession();
        const error = new Error(body && body.error && (body.error.message || body.error.code) || '服务暂不可用，请稍后刷新');
        error.status = response.statusCode;
        error.code = code;
        error.sessionCurrent = current;
        reject(error);
      },
      fail() { reject(new Error('连接失败，请检查网络后重试')); }
    });
  });
}
function wechatProof(path, data, codeKey = 'code', method = 'POST') {
  const generation = sessionGeneration, session = cookies.houren_session;
  return new Promise((resolve, reject) => {
    wx.login({ timeout: 10000, success: result => result.code ? resolve(result.code) : reject(new Error('微信登录失败，请重试')), fail: () => reject(new Error('微信登录失败，请重试')) });
  }).then(code => {
    if (!sessionCurrent(generation, session)) throw new Error('登录会话已变更，请重试');
    return request(path, { method, timeout: 30000, data: { ...data, [codeKey]: code, ...(config.appid ? { appid: config.appid } : {}) } });
  });
}
function loginWeChat(bindCurrent) { return wechatProof('/api/wechat/login', { bindCurrent: !!bindCurrent }); }
function loginByPassword(username, password) { return wechatProof('/api/wechat/password-login', { username, password }); }
function setWebPassword(password) { return wechatProof('/api/wechat/password', { password }); }
function setContactByWechat(proof) { return wechatProof('/api/account/contacts', { proof }, 'wechatCode'); }
function setContactByPassword(proof, currentPassword) { return request('/api/account/contacts', { method: 'POST', data: { proof, currentPassword } }); }
// 解除联系方式需要重新验证：有网页密码时用当前密码，否则用一次新的微信登录凭证（与网站 reauthenticate 相同）。
function removeContactByWechat(kind) { return wechatProof('/api/account/contacts/' + kind, {}, 'wechatCode', 'DELETE'); }
function removeContactByPassword(kind, currentPassword) { return request('/api/account/contacts/' + kind, { method: 'DELETE', data: { currentPassword } }); }
function previewMerge(username, password) { return wechatProof('/api/wechat/merge/preview', { username, password }); }
function requestId() {
  // Idempotency identifier, not an authentication credential.
  return 'wx-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

// 已生成的历史包与居民流水 CSV（只有数字与命令代码，无居民文字）。其他导出不经下载通道。
const DOWNLOADS = [/^\/api\/history\/exports\/[a-zA-Z0-9-]+\/download$/, /^\/api\/account\/residents\/[A-Za-z0-9_-]{1,128}\/export\?format=csv$/];
function download(path) {
  if (!DOWNLOADS.some(pattern => pattern.test(path))) return Promise.reject(new Error('下载路径无效'));
  if (!cookies.houren_session) return Promise.reject(new Error('请先登录后下载历史'));
  const generation = sessionGeneration, token = cookies.houren_session;
  return new Promise((resolve, reject) => {
    if (!wx.downloadFile) return reject(new Error('当前环境不支持文件下载，请在微信或网页中操作'));
    wx.downloadFile({ url: config.apiBase + path, header: { Cookie: 'houren_session=' + token, 'X-Houren-Client': 'wechat' }, timeout: 120000,
      success(response) {
        if (!sessionCurrent(generation, token)) return reject(new Error('登录会话已变更，请重新下载'));
        if (response.statusCode !== 200) return reject(new Error(response.statusCode === 401 ? '登录已失效，请重新登录' : response.statusCode === 403 ? '你已没有此居民的下载权限' : '下载未完成，请刷新导出记录后重试'));
        const manager = wx.getFileSystemManager && wx.getFileSystemManager();
        const save = manager?.saveFile ? options => manager.saveFile(options) : wx.saveFile ? options => wx.saveFile(options) : null;
        if (!save) return resolve(response.tempFilePath);
        save({ tempFilePath: response.tempFilePath, success: saved => sessionCurrent(generation, token) ? resolve(saved.savedFilePath || saved.filePath || response.tempFilePath) : reject(new Error('登录会话已变更，请重新下载')), fail: () => reject(new Error('文件保存失败，请检查微信存储空间后重试')) });
      }, fail() { reject(new Error('文件下载失败，请检查网络后重试')); },
    });
  });
}

module.exports = { request, download, restoreSession, clearSession, loginWeChat, loginByPassword, setWebPassword, setContactByWechat, setContactByPassword, removeContactByWechat, removeContactByPassword, previewMerge, requestId, observationOnly, OBSERVATION_ONLY };
