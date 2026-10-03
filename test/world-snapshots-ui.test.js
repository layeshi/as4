import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { openSnapshots } from '../public/snapshots-ui.js';
import { openAccount } from '../public/accounts.js';
import { closeAllModals } from '../public/modals.js';
import { getLang, setLang } from '../public/i18n.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const reply = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
const snapshot = { id: '01234567-0123-4123-8123-012345678901', label: '<script>存档</script>', createdAt: '2026-10-03T01:00:00Z', day: 0, tick: 5, bytes: 2048 };
const listing = (snapshots = []) => ({ snapshots, total: snapshots.length, page: 1, pageSize: 20 });
function setup(route) {
  const dom = installFakeDom();
  const saved = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, lang: getLang() };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  setLang('zh');
  globalThis.fetch = route;
  return { dom, restore() { closeAllModals(); setLang(saved.lang); dom.restore(); Object.assign(globalThis, { fetch: saved.fetch, localStorage: saved.localStorage }); } };
}
const button = (root, label) => root.querySelectorAll('button').find((b) => b.textContent === label);

test('snapshot UI: saving prevents duplicate submits, retains failed notes, refreshes and handles expired downloads', async () => {
  let rows = [], completeSave, posted = [];
  const env = setup(async (url, options) => {
    if (url.endsWith('/download')) return reply(401, { error: { message: '请重新登录管理员账号。' } });
    if (options.method === 'POST') {
      posted.push(JSON.parse(options.body));
      assert.equal(options.headers['X-Houren-Request'], '1');
      return new Promise((resolve) => { completeSave = resolve; });
    }
    return reply(200, listing(rows));
  });
  try {
    await openSnapshots();
    assert.match(env.dom.root.textContent, /还没有保存快照/);
    const form = env.dom.root.querySelector('form');
    const note = form.querySelector('input');
    const save = button(env.dom.root, '保存当前快照');
    note.value = '稍后重试';
    form.fire('submit'); form.fire('submit');
    assert.equal(save.disabled, true);
    assert.equal(posted.length, 1);
    completeSave(reply(500, { error: { message: '存储不可用' } })); await settle();
    assert.equal(save.disabled, false);
    assert.equal(note.value, '稍后重试');
    assert.match(env.dom.root.textContent, /存储不可用/);
    note.value = snapshot.label;
    form.fire('submit');
    rows = [snapshot];
    completeSave(reply(201, { snapshot })); await settle(); await settle();
    assert.equal(note.value, '');
    assert.match(env.dom.root.textContent, /快照已保存：第 1 日 · 已推进 5 刻/);
    assert.equal(env.dom.root.querySelectorAll('script').length, 0, 'notes render as text');
    assert.match(env.dom.root.textContent, /<script>存档<\/script>/);
    const download = button(env.dom.root, '下载');
    download.click(); await settle();
    assert.match(env.dom.root.textContent, /请重新登录管理员账号/);
    assert.equal(download.disabled, false);
    assert.deepEqual(posted, [{ label: '稍后重试' }, { label: snapshot.label }]);
  } finally { env.restore(); }
});

test('snapshot UI: administrator entry, English text and list retry', async () => {
  let role = 'admin', failed = true;
  const env = setup(async (url) => {
    if (url === '/api/account') return reply(200, { user: { role, username: 'chief', displayName: 'Chief' } });
    if (failed) return reply(500, { error: { message: 'Please retry' } });
    return reply(200, listing([{ ...snapshot, label: '' }]));
  });
  try {
    await openAccount();
    assert.ok(button(env.dom.root, '世界快照'));
    closeAllModals();
    role = 'user';
    await openAccount();
    assert.equal(button(env.dom.root, '世界快照'), undefined);
    closeAllModals(); setLang('en');
    await openSnapshots();
    assert.match(env.dom.root.textContent, /World snapshots/);
    assert.match(env.dom.root.textContent, /Please retry/);
    failed = false;
    button(env.dom.root, 'Retry').click(); await settle();
    assert.match(env.dom.root.textContent, /Day 1 · 5 ticks elapsed/);
    assert.equal(button(env.dom.root, 'Next').disabled, true);
  } finally { env.restore(); }
});
