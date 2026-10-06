import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { experimentPanel } from '../public/experiment-ui.js';
import { setLang, getLang } from '../public/i18n.js';
const settle = () => new Promise((resolve) => setImmediate(resolve));
const response = (status, json) => ({ ok: status < 400, status, json: async () => json });
const button = (root, label) => root.querySelectorAll('button').find((b) => b.textContent === label);

test('实验面板：实际状态、暂停/恢复、重复点击防护与操作边界说明', async () => {
  const dom = installFakeDom(), originalFetch = globalThis.fetch, lang = getLang();
  setLang('zh');
  let view = { state: 'running', paused: false, remainingMs: 3000, tick: 42 }, finishPause, posts = 0, changed = 0;
  globalThis.fetch = async (path, opts = {}) => {
    if (opts.method === 'POST') {
      posts++;
      assert.equal(opts.headers['X-Houren-Request'], '1');
      if (path.endsWith('/pause')) return new Promise((resolve) => { finishPause = () => { view = { ...view, state: 'paused', paused: true }; resolve(response(200, { ok: true, paused: true })); }; });
      view = { ...view, state: 'running', paused: false };
      return response(200, { ok: true, paused: false });
    }
    return response(200, view);
  };
  try {
    const root = experimentPanel({ onChanged: () => { changed++; } });
    await settle();
    assert.match(root.textContent, /实验运行中/);
    assert.match(root.textContent, /模型配置和连接测试/);
    assert.match(root.textContent, /无法强制中止/);
    assert.equal(button(root, '恢复实验').disabled, true);
    button(root, '暂停实验').click();
    await button(root, '暂停实验').click();
    assert.equal(posts, 1);
    assert.match(root.textContent, /正在暂停实验/);
    assert.equal(button(root, '恢复实验').disabled, true);
    finishPause();
    await settle();
    assert.match(root.textContent, /实验已暂停/);
    assert.match(root.textContent, /恢复后距离下一刻约 3 秒/);
    assert.equal(button(root, '恢复实验').disabled, false);
    button(root, '恢复实验').click();
    await settle();
    assert.match(root.textContent, /实验运行中/);
    assert.equal(changed, 2);
  } finally { globalThis.fetch = originalFetch; setLang(lang); dom.restore(); }
});

test('实验面板：加载失败不显示可操作的旧状态，可刷新恢复', async () => {
  const dom = installFakeDom(), originalFetch = globalThis.fetch, lang = getLang();
  setLang('zh');
  let failing = true;
  globalThis.fetch = async () => failing ? response(403, { error: { message: '需要管理员权限' } }) : response(200, { state: 'paused', paused: true, remainingMs: 9000, tick: 0 });
  try {
    const root = experimentPanel();
    await settle();
    assert.match(root.textContent, /需要管理员权限/);
    assert.equal(button(root, '暂停实验').disabled, true);
    assert.equal(button(root, '恢复实验').disabled, true);
    failing = false;
    button(root, '刷新状态').click();
    await settle();
    assert.match(root.textContent, /实验已暂停/);
    assert.equal(button(root, '恢复实验').disabled, false);
  } finally { globalThis.fetch = originalFetch; setLang(lang); dom.restore(); }
});
