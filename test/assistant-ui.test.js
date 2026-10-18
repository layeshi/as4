import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { mountAssistant } from '../public/assistant-ui.js';
import { setLang } from '../public/i18n.js';

for (const signedIn of [false, true]) test(`assistant renders ${signedIn ? 'signed-in context and controls' : 'guest introduction'} safely`, async () => {
  const dom = installFakeDom(), saved = { fetch: globalThis.fetch, location: globalThis.location, window: globalThis.window };
  setLang('zh');
  globalThis.window = { addEventListener() {} };
  globalThis.location = { pathname: '/assistant.html', search: '?lawId=law-1', hash: '' };
  globalThis.fetch = async path => ({ ok: true, status: 200, json: async () => path === '/api/account' ? { user: signedIn ? { id: 'test', username: 'test', displayName: 'Tester' } : null, loginRequired: true } : { signedIn, available: true, model: 'gpt-6-luna', world: { id: 'world', day: 3, cities: [{ id: 'north', name: '北城' }] }, branches: [], residents: [], conversations: [], quota: { remaining: 20, limit: 20, resetAt: '2026-10-19T00:00:00+08:00' } } });
  for (const id of ['console-header', 'page-head', 'message', 'content']) { const el = document.createElement('div'); dom.register(id, el); dom.root.append(el); }
  let controller;
  try {
    controller = await mountAssistant();
    // Account watchers can launch the replacement read when initial identity arrives.
    await new Promise(resolve => setImmediate(resolve));
    const text = document.getElementById('content').textContent;
    assert.match(text, signedIn ? /本次问题范围/ : /登录后向实验提问/);
    if (signedIn) { assert.match(text, /law-1/); assert.match(text, /今日剩余 20/); assert.ok(document.getElementById('content').querySelector('textarea')); }
    assert.doesNotMatch(text, /undefined|\[object Object\]/);
  } finally { controller?.dispose(); globalThis.fetch = saved.fetch; globalThis.location = saved.location; globalThis.window = saved.window; dom.restore(); }
});
