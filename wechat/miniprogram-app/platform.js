// Adapt the shared controller to documented Mini Program Canvas 2D and Page events.
function createPlatform(native, canvas, page) {
  const listeners = new Map();
  let first = true, disposed = false, subscription = null;
  const api = {};
  for (const name of ['getWindowInfo', 'getSystemInfoSync', 'getMenuButtonBoundingClientRect', 'getStorageSync', 'setStorageSync', 'removeStorageSync', 'showShareMenu', 'vibrateShort', 'setClipboardData', 'shareFileMessage']) {
    if (native[name]) api[name] = (...args) => native[name](...args);
  }
  api.createCanvas = () => {
    if (first) { first = false; return canvas; }
    return native.createOffscreenCanvas({ type: '2d', width: 1, height: 1 });
  };
  api.createImage = () => canvas.createImage();
  for (const event of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Hide', 'Show', 'WindowResize', 'KeyboardInput', 'KeyboardConfirm', 'KeyboardComplete', 'ShareAppMessage']) {
    api['on' + event] = callback => listeners.set(event, callback);
  }
  api.showKeyboard = options => {
    if (disposed) return;
    const field = page.game.editing;
    const labels = { assistantText: '你的实验问题', assistantAdminKey: '管理密钥', assistantOwnerKey: '旧世界造者密钥', assistantFrom: '起始世界日', assistantTo: '结束世界日', password: '网站账号密码', confirmPassword: '确认新密码', apiKey: '模型 API Key', letter: '家书', messageText: '留言正文', name: '居民名字', bio: '简介', soul: '灵魂', username: '网站账号', baseURL: '模型接口地址', model: '模型名称', invite: '邀请码' };
    page.setData({ editing: true, inputValue: options.defaultValue || '', inputLabel: labels[field] || '编辑内容', multiple: !!options.multiple, secret: ['apiKey', 'assistantAdminKey', 'assistantOwnerKey'].includes(field) || (field === 'password' || field === 'confirmPassword') && !options.showPassword, maxLength: options.maxLength || 4000 });
  };
  // Subscription requests need a native tap: Canvas touches are not tap gestures in a Mini Program.
  if (native.requestSubscribeMessage) api.showSubscribe = options => {
    if (disposed) return;
    subscription = options;
    page.setData({ subscribing: true, subscribeTitle: options.title || '授权微信提醒', subscribeBody: options.body || '', subscribeLabel: options.label || '授权微信提醒' });
  };
  api.hideSubscribe = () => {
    subscription = null;
    if (!disposed) page.setData({ subscribing: false });
  };
  api.hideKeyboard = () => {
    if (!disposed) page.setData({ editing: false, inputValue: '', secret: false });
    if (native.hideKeyboard) native.hideKeyboard({ fail() {} });
  };
  return {
    api,
    emit(event, payload = {}) {
      if (disposed) return;
      // Canvas events may expose x/y rather than clientX/clientY.
      if (event.startsWith('Touch') && payload.touches) payload = { ...payload, touches: payload.touches.map(t => ({ ...t, clientX: t.x ?? t.clientX, clientY: t.y ?? t.clientY })) };
      const handler = listeners.get(event);
      if (handler) handler(payload);
    },
    // Called synchronously from the page's bindtap handler; the request must not wait for anything first.
    subscribe() {
      const options = subscription;
      if (disposed || !options) return;
      subscription = null;
      native.requestSubscribeMessage({ tmplIds: options.tmplIds, success: result => options.complete(result), fail: error => options.fail(error) });
      page.setData({ subscribing: false });
    },
    cancelSubscribe() { api.hideSubscribe(); },
    dispose() { api.hideKeyboard(); api.hideSubscribe(); disposed = true; listeners.clear(); }
  };
}
module.exports = { createPlatform };
