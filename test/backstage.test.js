import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { openBackstage, closeAllModals } from '../public/modals.js';
import { t } from '../public/i18n.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
test('幕后导入多个造者密钥后可以切换，操作使用当前 Agent 的密钥，重开仍保留入口', async () => {
  const dom = installFakeDom();
  const saved = { fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  const store = new Map([['houren.ownerKey', 'key-a']]);
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    const id = options.headers.Authorization === 'Bearer key-a' ? 'a' : 'b';
    return { ok: true, status: 200, json: async () => ({ agents: [{ agentId: id, name: `Agent ${id}`, status: 'awake', model: 'mock', soul: 'test', perception: {} }] }) };
  };
  const button = label => dom.root.querySelectorAll('button').find(b => b.textContent === label);
  const ctx = { S: { state: null } };
  try {
    openBackstage(ctx); await settle();
    assert.match(dom.root.querySelector('.owner-card').textContent, /Agent a/);
    assert.ok(button(t('addOwnerKey')), '需要添加其他 Agent 的入口');
    button(t('addOwnerKey')).click();
    dom.root.querySelector('input[name="ownerKey"]').value = 'key-b';
    dom.root.querySelector('form').fire('submit'); await settle();
    let picker = dom.root.querySelector('select[name="ownerAgent"]');
    assert.equal(picker.children.length, 3);
    picker.value = '0'; picker.fire('change'); await settle();
    assert.match(dom.root.querySelector('.owner-card').textContent, /Agent a/);
    dom.root.querySelector('input[type="checkbox"]').fire('change'); await settle();
    assert.equal(requests.at(-1).headers.Authorization, 'Bearer key-a');
    closeAllModals(); openBackstage(ctx); await settle();
    picker = dom.root.querySelector('select[name="ownerAgent"]');
    assert.equal(picker.children.length, 3);
    picker.value = '1'; picker.fire('change'); await settle();
    assert.match(dom.root.querySelector('.owner-card').textContent, /Agent b/);
    button(t('forget')).click(); await settle();
    assert.match(dom.root.querySelector('.owner-card').textContent, /Agent a/);
    assert.ok(!store.get('houren.ownerKeys').includes('key-b'));
  } finally {
    closeAllModals(); dom.restore(); Object.assign(globalThis, saved);
  }
});

test('幕后快速切换不会被旧响应覆盖，失效密钥不删除其他入口', async () => {
  const dom = installFakeDom();
  const saved = { fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  const store = new Map([
    ['houren.ownerKey', 'key-a'],
    ['houren.ownerKeys', JSON.stringify([{ key: 'key-a', agentId: 'a' }, { key: 'key-b', agentId: 'b' }])],
  ]);
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const pending = [];
  globalThis.fetch = (url, options) => new Promise(resolve => pending.push({ resolve, options }));
  const reply = (index, id, status = 200) => pending[index].resolve({ ok: status === 200, status, json: async () => ({ agents: [{ agentId: id, name: `Agent ${id}`, status: 'awake', perception: {} }] }) });
  try {
    openBackstage({ S: { state: null } });
    let picker = dom.root.querySelector('select[name="ownerAgent"]');
    picker.value = '1'; picker.fire('change');
    reply(1, 'b'); await settle();
    reply(0, 'a'); await settle();
    assert.match(dom.root.querySelector('.owner-card').textContent, /Agent b/);
    assert.equal(store.get('houren.ownerKey'), 'key-b');
    picker = dom.root.querySelector('select[name="ownerAgent"]');
    picker.value = '0'; picker.fire('change');
    reply(2, 'a', 401); await settle();
    assert.deepEqual(JSON.parse(store.get('houren.ownerKeys')).map(x => x.agentId), ['b']);
    picker = dom.root.querySelector('select[name="ownerAgent"]');
    picker.value = '0'; picker.fire('change'); reply(3, 'b'); await settle();
    assert.match(dom.root.querySelector('.owner-card').textContent, /Agent b/);
  } finally {
    closeAllModals(); dom.restore(); Object.assign(globalThis, saved);
  }
});
