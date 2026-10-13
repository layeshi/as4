import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../wechat/minigame/', import.meta.url));

// The Canvas and wx APIs are platform boundaries; all controllers and components run unchanged.
export function minigame({ respond = () => ({}) } = {}) {
  const modules = new Map(), timers = new Map(), requests = [], drawn = [];
  let timerId = 0, now = 100000;
  const ctx = new Proxy({
    measureText: s => ({ width: Array.from(String(s)).length * 8 }),
    fillText: s => drawn.push(String(s)),
  }, { get: (t, k) => k in t ? t[k] : () => {}, set: () => true });
  const wx = {
    createCanvas: () => ({ getContext: () => ctx }),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 3, statusBarHeight: 47, safeArea: { bottom: 810 } }),
    getStorageSync: () => '', hideKeyboard() {}, showKeyboard() {},
    request(o) {
      const path = new URL(o.url).pathname + new URL(o.url).search;
      requests.push(path);
      Promise.resolve().then(() => respond(path, o)).then(data => o.success({ statusCode: 200, data }), () => o.fail());
    },
  };
  for (const event of ['TouchStart', 'TouchMove', 'TouchEnd', 'Hide', 'Show', 'KeyboardInput', 'KeyboardConfirm', 'KeyboardComplete']) wx['on' + event] = fn => { wx['emit' + event] = fn; };
  class ClockDate extends Date { static now() { return now; } }
  function load(path) {
    path = resolve(path);
    if (modules.has(path)) return modules.get(path).exports;
    const module = { exports: {} }; modules.set(path, module);
    const run = runInNewContext('(function(require,module,exports){' + readFileSync(path, 'utf8') + '\n})', {
      wx, Date: ClockDate, console,
      setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
      clearTimeout: id => timers.delete(id),
    }, { filename: path });
    run(name => load(resolve(dirname(path), name + '.js')), module, module.exports);
    return module.exports;
  }
  const { SocietyGame } = load(resolve(root, 'society.js'));
  const game = new SocietyGame();
  return {
    game, wx, requests, timers, drawn, load,
    setNow: value => { now = value; },
    async fire(delay) {
      const entry = [...timers].find(([, t]) => t.delay === delay);
      if (!entry) throw new Error('No timer at ' + delay);
      timers.delete(entry[0]);
      await entry[1].fn();
    },
  };
}
