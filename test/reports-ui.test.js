import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { mountReports } from '../public/reports-ui.js';
import { getLang, setLang } from '../public/i18n.js';

test('world report guests see the introduction when the production login wall is enabled', async () => {
  const dom = installFakeDom(), saved = { fetch: globalThis.fetch, location: globalThis.location, lang: getLang() };
  const redirects = [], requests = [];
  setLang('zh');
  globalThis.location = { pathname: '/reports.html', search: '', hash: '', replace: value => redirects.push(value) };
  globalThis.fetch = async path => {
    requests.push(path);
    assert.equal(path, '/api/account', 'a guest must not request report contents');
    return { ok: true, status: 200, json: async () => ({ user: null, loginRequired: true, registrationOpen: true }) };
  };
  for (const id of ['console-header', 'page-head', 'message', 'content']) {
    const element = document.createElement('div'); dom.register(id, element); dom.root.append(element);
  }
  try {
    await mountReports();
    assert.deepEqual(redirects, []);
    assert.match(document.getElementById('content').textContent, /登录后阅读世界报告/);
    assert.equal(document.getElementById('content').querySelector('a').getAttribute('href'), '/login.html?next=%2Freports.html');
    assert.deepEqual(requests, ['/api/account']);
  } finally { globalThis.fetch = saved.fetch; globalThis.location = saved.location; setLang(saved.lang); dom.restore(); }
});
