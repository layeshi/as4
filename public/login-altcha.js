import { h, clear } from './dom.js';
import { getLang } from './i18n.js';

const tr = (zh, en) => getLang() === 'en' ? en : zh;
let loading;
function loadAltcha() {
  if (!loading) loading = (async () => {
    const css = h('link', { rel: 'stylesheet', href: '/vendor/altcha-3.4.0/dist/external/altcha.css' });
    const styles = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { css.remove(); reject(new Error('Verification styles timed out')); }, 15000);
      css.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
      css.addEventListener('error', () => { clearTimeout(timeout); css.remove(); reject(new Error('Verification styles unavailable')); }, { once: true });
    });
    document.head.append(css);
    try {
      await Promise.all([
        styles,
        import('./vendor/altcha-3.4.0/dist/external/altcha.min.js'),
        import('./vendor/altcha-3.4.0/dist/i18n/zh-cn.js'),
      ]);
    } catch (error) { css.remove(); throw error; }
    window.$altcha.algorithms.set('PBKDF2/SHA-256', () => new Worker('/vendor/altcha-3.4.0/dist/workers/pbkdf2.js'));
  })().catch((error) => { loading = null; throw error; });
  return loading;
}

/** Each attempt owns a widget and an abort controller, including its challenge fetch. */
export function mountAltcha(container, { load = loadAltcha } = {}) {
  let generation = 0, disposed = false, token = '', element = null, controller = null, timeout;
  const disposeElement = () => {
    clearTimeout(timeout);
    controller?.abort();
    element?.reset?.();
    element?.remove();
    element = null;
  };
  const reset = () => {
    if (disposed) return;
    const attempt = ++generation;
    token = '';
    disposeElement();
    controller = new AbortController();
    const abort = controller;
    clear(container);
    const status = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' }, tr('正在加载登录验证…', 'Loading sign-in verification…'));
    const retry = h('button', { type: 'button', class: 'btn', hidden: true, onClick: reset }, tr('重新验证', 'Retry verification'));
    container.append(status, retry);
    let timedOut = false;
    const current = () => !disposed && !timedOut && generation === attempt && container.isConnected;
    const deadline = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (!current()) return;
        timedOut = true;
        token = '';
        disposeElement();
        status.textContent = tr('验证超时，请重新验证。', 'Verification timed out. Please retry.');
        retry.hidden = false;
      }, 15000);
    };
    deadline();
    load().then(() => {
      if (!current()) return;
      const widget = h('altcha-widget', {
        challenge: '/api/account/challenge', auto: 'off', workers: '2',
        language: getLang() === 'en' ? 'en' : 'zh-cn', name: 'altcha',
        configuration: JSON.stringify({ minDuration: 0, humanInteractionSignature: false, timeout: 15000 }),
      });
      element = widget;
      widget.addEventListener('statechange', (event) => {
        if (!current()) return;
        const { state, payload } = event.detail;
        token = state === 'verified' && typeof payload === 'string' ? payload : '';
        status.textContent = state === 'verifying' ? tr('正在验证，请稍候…', 'Verifying, please wait…') : '';
        if (state === 'verifying') deadline();
        else if (state === 'verified' || state === 'error' || state === 'expired') clearTimeout(timeout);
        if (state === 'error' || state === 'expired') {
          status.textContent = state === 'expired' ? tr('验证已过期，请重新验证。', 'Verification expired. Please retry.') : tr('验证暂时不可用，请稍后重试。', 'Verification is unavailable. Please retry shortly.');
          widget.hidden = true;
          retry.hidden = false;
        }
      });
      widget.addEventListener('load', () => {
        if (!current()) { widget.reset(); return; }
        widget.configure({ fetch: (url, options) => {
          const headers = new Headers(options?.headers);
          headers.set('X-Houren-Request', '1');
          return fetch(url, { ...options, headers, signal: abort.signal });
        } });
        void widget.verify({ controller: abort });
      }, { once: true });
      container.insertBefore(widget, retry);
    }).catch(() => {
      if (!current()) return;
      clearTimeout(timeout);
      status.textContent = tr('验证加载失败，请重试或刷新页面。', 'Verification failed to load. Retry or reload the page.');
      retry.hidden = false;
    });
  };
  reset();
  return {
    getResponse: () => token,
    reset,
    remove() { disposed = true; generation++; token = ''; disposeElement(); },
  };
}
