import { h, clear } from './dom.js';
import { getLang } from './i18n.js';

const tr = (zh, en) => getLang() === 'en' ? en : zh;
let scriptPromise;

function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = h('script', { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async: true });
    const failed = () => { script.remove(); scriptPromise = null; reject(new Error('Turnstile unavailable')); };
    script.addEventListener('load', () => window.turnstile ? resolve(window.turnstile) : failed());
    script.addEventListener('error', failed);
    document.head.append(script);
  });
  return scriptPromise;
}

export function mountLoginChallenge(container, sitekey, action = 'login') {
  let api, id, disposed = false;
  container.textContent = tr('正在加载人机验证…', 'Loading verification…');
  loadScript().then((turnstile) => {
    if (disposed || !container.isConnected) return;
    clear(container);
    api = turnstile;
    id = api.render(container, { sitekey, action, theme: 'auto', 'response-field': false });
  }).catch(() => {
    if (!disposed && container.isConnected) container.textContent = tr('人机验证加载失败，请稍后重试。', 'Verification failed to load. Please try again later.');
  });
  return {
    token: () => id === undefined ? '' : api.getResponse(id) || '',
    reset: () => { if (id !== undefined) api.reset(id); },
    dispose: () => { disposed = true; if (id !== undefined) api.remove(id); id = undefined; },
  };
}
