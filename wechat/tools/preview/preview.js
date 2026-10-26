// 浏览器里的 wx 模拟层与 CommonJS 加载器：运行 /minigame/ 下未经改动的小游戏代码。
(function () {
  const query = new URLSearchParams(location.search);
  const devices = {
    iphone15: { w: 390, h: 844, dpr: 3, status: 47, bottom: 34 },
    se: { w: 375, h: 667, dpr: 2, status: 20, bottom: 0 },
    android: { w: 393, h: 851, dpr: 2.75, status: 32, bottom: 0 },
  };
  const deviceName = devices[query.get('device')] ? query.get('device') : 'iphone15';
  const mode = ['anon', 'approved', 'fixture', 'fixture-guest'].includes(query.get('data')) ? query.get('data') : 'fixture';
  const client = query.get('client') === 'game' ? 'game' : 'miniprogram';
  const local = mode.startsWith('fixture');
  const device = devices[deviceName];
  document.getElementById('device').value = deviceName;
  document.getElementById('data').value = mode;
  document.getElementById('client').value = client;
  const reload = () => { const q = new URLSearchParams({ device: document.getElementById('device').value, data: document.getElementById('data').value, client: document.getElementById('client').value }); location.search = q.toString(); };
  for (const id of ['device', 'data', 'client']) document.getElementById(id).onchange = reload;
  document.getElementById('reload').onclick = () => location.reload();

  const phone = document.getElementById('phone');
  phone.style.width = device.w + 'px'; phone.style.height = device.h + 'px';
  const screen = document.createElement('canvas');
  screen.style.width = device.w + 'px'; screen.style.height = device.h + 'px';
  phone.insertBefore(screen, phone.firstChild);

  const listeners = {};
  const on = name => fn => { (listeners[name] = listeners[name] || []).push(fn); };
  const off = name => fn => { listeners[name] = (listeners[name] || []).filter(f => f !== fn); };
  const emit = (name, payload) => (listeners[name] || []).slice().forEach(fn => { try { fn(payload); } catch (error) { console.error(error); } });
  let canvases = 0;

  const wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    createCanvas() { return canvases++ === 0 ? screen : document.createElement('canvas'); },
    createImage() { return new Image(); },
    getWindowInfo() {
      return { windowWidth: device.w, windowHeight: device.h, screenWidth: device.w, screenHeight: device.h, pixelRatio: device.dpr, statusBarHeight: device.status,
        safeArea: { top: device.status, left: 0, right: device.w, bottom: device.h - device.bottom, width: device.w, height: device.h - device.status - device.bottom } };
    },
    getSystemInfoSync() { return wx.getWindowInfo(); },
    getMenuButtonBoundingClientRect() { return { width: 87, height: 32, top: device.status + 6, bottom: device.status + 38, left: device.w - 94, right: device.w - 7 }; },
    getLaunchOptionsSync() { return { query: {} }; },
    setPreferredFramesPerSecond() {},
    vibrateShort() {},
    showShareMenu() {}, onShareAppMessage() {}, onShareTimeline() {}, shareAppMessage() {},
    // 真机上 wx.loadFont 是同步的；浏览器里字体异步加载，加载完清掉按后备字体量出的字宽再重画。
    loadFont(path) {
      const url = '/minigame/' + path.replace(/^\/+/, '');
      const probe = new XMLHttpRequest(); probe.open('HEAD', url, false); probe.send();
      if (probe.status !== 200) return null;
      const family = 'HeirsSerif', face = new FontFace(family, `url(${url})`);
      face.load().then(f => {
        document.fonts.add(f);
        if (window.__game) { window.__loadMinigame('ui/text.js').reset(); window.__game.invalidate(); window.__game.render(); }
      }, () => console.warn('字体未能加载：', path));
      return family;
    },
    getStorageSync(key) { try { const v = localStorage.getItem('wx:' + key); return v === null ? '' : JSON.parse(v); } catch (_) { return ''; } },
    setStorageSync(key, value) { localStorage.setItem('wx:' + key, JSON.stringify(value)); },
    removeStorageSync(key) { localStorage.removeItem('wx:' + key); },
    setClipboardData({ data, success, fail }) { navigator.clipboard.writeText(data).then(() => success && success({}), () => fail && fail({})); },
    // 本地测试数据里微信登录只是本机模拟；线上模式不能登录。
    login({ success, fail }) { setTimeout(() => local ? success && success({ code: 'preview-test-code' }) : fail && fail({ errMsg: 'login:fail 预览里不能微信登录' }), 50); },
    request(options) {
      const url = String(options.url).replace(/^https:\/\/[^/]+/, '/proxy/' + mode);
      const init = { method: options.method || 'GET', headers: options.header || {} };
      if (options.data !== undefined && init.method !== 'GET') init.body = JSON.stringify(options.data);
      fetch(url, init).then(async response => {
        let data = null; try { data = await response.json(); } catch (_) {}
        options.success && options.success({ statusCode: response.status, data, header: {}, cookies: [] });
      }, () => options.fail && options.fail({ errMsg: 'request:fail' }));
    },
    showKeyboard(options) {
      const kb = document.getElementById('kb'), input = document.getElementById('kbInput');
      input.value = options.defaultValue || ''; input.maxLength = options.maxLength || 4000;
      kb.classList.add('open'); input.focus();
      input.oninput = () => emit('KeyboardInput', { value: input.value });
      const done = () => { kb.classList.remove('open'); emit('KeyboardConfirm', { value: input.value }); emit('KeyboardComplete', { value: input.value }); };
      document.getElementById('kbDone').onclick = done;
      input.onkeydown = e => { if (e.key === 'Enter' && !(options.multiple && e.shiftKey)) { e.preventDefault(); done(); } };
      options.success && options.success({});
    },
    hideKeyboard() { document.getElementById('kb').classList.remove('open'); },
    updateKeyboard({ value }) { document.getElementById('kbInput').value = value; },
  };
  for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Hide', 'Show', 'WindowResize', 'KeyboardInput', 'KeyboardConfirm', 'KeyboardComplete']) {
    wx['on' + name] = on(name); wx['off' + name] = off(name);
  }
  document.addEventListener('visibilitychange', () => emit(document.hidden ? 'Hide' : 'Show', {}));

  // 鼠标与触摸都转成小游戏的触摸事件；滚轮转成一次短拖动。
  const point = e => { const r = screen.getBoundingClientRect(); return { identifier: 0, clientX: e.clientX - r.left, clientY: e.clientY - r.top }; };
  let down = false;
  screen.addEventListener('mousedown', e => { down = true; emit('TouchStart', { touches: [point(e)], changedTouches: [point(e)], timeStamp: e.timeStamp }); });
  window.addEventListener('mousemove', e => { if (down) emit('TouchMove', { touches: [point(e)], changedTouches: [point(e)], timeStamp: e.timeStamp }); });
  window.addEventListener('mouseup', e => { if (!down) return; down = false; emit('TouchEnd', { touches: [], changedTouches: [point(e)], timeStamp: e.timeStamp }); });
  screen.addEventListener('wheel', e => {
    e.preventDefault();
    const p = point(e), q = { ...p, clientY: p.clientY - Math.max(-120, Math.min(120, e.deltaY)) };
    emit('TouchStart', { touches: [p], changedTouches: [p], timeStamp: e.timeStamp });
    emit('TouchMove', { touches: [q], changedTouches: [q], timeStamp: e.timeStamp + 16 });
    emit('TouchEnd', { touches: [], changedTouches: [q], timeStamp: e.timeStamp + 400 });
  }, { passive: false });

  window.wx = wx; window.GameGlobal = window;
  const modules = {};
  function resolvePath(from, name) {
    const parts = (from ? from.split('/').slice(0, -1) : []).concat(name.split('/'));
    const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
    return out.join('/').replace(/\.js$/, '') + '.js';
  }
  function load(path) {
    if (modules[path]) return modules[path].exports;
    // 普通小程序用自己的配置（版本、AppID、clientType），其余模块与小游戏同源。
    const source = client === 'miniprogram' && path === 'config.js' ? '/miniprogram-app/config.js' : '/minigame/' + path;
    const xhr = new XMLHttpRequest(); xhr.open('GET', source, false); xhr.send();
    if (xhr.status !== 200) throw new Error('模块不存在：' + path);
    const module = { exports: {} }; modules[path] = module;
    new Function('require', 'module', 'exports', 'wx', 'GameGlobal', xhr.responseText + '\n//# sourceURL=/minigame/' + path)(name => load(resolvePath(path, name)), module, module.exports, wx, window);
    if (path === 'society.js' && module.exports.SocietyGame) {
      const start = module.exports.SocietyGame.prototype.start;
      module.exports.SocietyGame.prototype.start = function () { window.__game = this; return start.apply(this, arguments); };
    }
    return module.exports;
  }
  window.__loadMinigame = load;
  load('game.js');
})();
