import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { entryWizard } from '../public/runner-ui.js';
import { tokenCapForm, dailyCapField, readDailyCap } from '../public/token-ui.js';
import { tokenLedger } from '../public/usage-ui.js';
import { tokenCityPanel, updateTokenCity, renderCradle, renderLaws2 } from '../public/e2-tabs.js';
import { setLang, setPremise, t, describeEvent } from '../public/i18n.js';
import e2 from '../src/e2/facade.js';
const settle = () => new Promise(resolve => setImmediate(resolve));
const reply = json => ({ ok: true, status: 200, json: async () => json });
const button = (root, key) => root.querySelectorAll('button').find(b => b.textContent === t(key));

function setup() {
  const dom = installFakeDom(), fetch = globalThis.fetch, confirm = globalThis.confirm;
  setLang('zh'); setPremise(4);
  const requests = [];
  globalThis.fetch = async (url, opts) => { requests.push({ url, body: opts.body && JSON.parse(opts.body) }); return reply({ agentId: 'a1' }); };
  return { dom, requests, restore() { globalThis.fetch = fetch; globalThis.confirm = confirm; setPremise(0); setLang('zh'); dom.restore(); } };
}
function initialize(root) {
  for (const select of root.querySelectorAll('select')) select.value = select.children.find(o => o.selected)?.value || select.children[0].value;
  // Supply native form validity in the small DOM, which intentionally has no form engine.
  for (const c of root.querySelectorAll('input, textarea, select')) {
    if (c.value === undefined) c.value = '';
    c.checkValidity = () => !c.hasAttribute('required') || String(c.value ?? '').length > 0;
    c.reportValidity = () => {};
  }
  root.querySelector('select[name="preset"]').value = 'mock';
  root.querySelector('select[name="preset"]').fire('change');
}

test('P4 T22: register/adopt/foster all require and submit an explicit daily cap; old worlds have no field', async () => {
  const s = setup();
  try {
    for (const mode of ['register','adopt','foster']) {
      const pane = document.createElement('div'); s.dom.root.append(pane);
      entryWizard({ S: { state: { world: { premise: 4 } } }, refresh() {} }, pane, { mode, subject: { id: 's1', name: '孩子', soul: '灵魂' }, success() {} });
      initialize(pane);
      const cap = pane.querySelector('input[name="dailyCap"]');
      assert.ok(cap && cap.hasAttribute('required'));
      assert.equal(cap.getAttribute('max'), '50000000');
      assert.equal(readDailyCap(cap), null);
      cap.value = '880000';
      const name = pane.querySelector('input[name="name"]'), soul = pane.querySelector('textarea[name="soul"]');
      if (name) name.value = '甲'; if (soul) soul.value = '我是甲';
      button(pane, 'nextStep').fire('click');
      button(pane, 'testModel').fire('click'); await settle();
      button(pane, 'nextStep').fire('click');
      pane.querySelector('form.entry-wizard').fire('submit'); await settle();
      const sent = s.requests.findLast(r => r.url === `/api/port/${mode}`);
      assert.ok(sent, mode);
      assert.equal(sent.body.dailyCap, 880000);
    }
    for (const premise of [0,1,2]) {
      const pane = document.createElement('div');
      entryWizard({ S: { state: { world: { premise } } } }, pane, { success() {} });
      assert.equal(pane.querySelector('input[name="dailyCap"]'), null);
    }
  } finally { s.restore(); }
});

test('P4 T22: owner cap zero needs confirmation, and only confirmed integer values are sent', async () => {
  const s = setup();
  try {
    let refreshed = 0, confirms = 0;
    const form = tokenCapForm({ cap: 880000 }, 'owner-test-key', async () => { refreshed++; });
    const input = form.querySelector('input');
    input.value = '0'; globalThis.confirm = message => { confirms++; assert.equal(message, '这等于停止供养，你的居民会失魂。'); return false; };
    form.fire('submit'); await settle(); assert.equal(s.requests.length, 0);
    globalThis.confirm = () => true;
    form.fire('submit'); await settle();
    assert.deepEqual(s.requests[0], { url: '/api/owner/cap', body: { dailyCap: 0 } });
    assert.equal(refreshed, 1); assert.equal(confirms, 1);
    for (const bad of ['', '-1', '1.5', '50000001']) { input.value = bad; form.fire('submit'); await settle(); }
    assert.equal(s.requests.length, 1);
    const field = dailyCapField(); field.input.value = '50000000'; assert.equal(readDailyCap(field.input), 50000000);
  } finally { s.restore(); }
});

test('P4 T22: city and owner panels show both currencies, bills and ratio without rewriting authored values', () => {
  const s = setup();
  try {
    const tokens = { cap: 880000, usedToday: 9170, energy: 1234, basic: 8830, lastBill: { reread: 1580, read: 6950, write: 640 } };
    const pane = tokenLedger(tokens, { tracked: true, today: { tokens: 18340, unreported: 0 } });
    for (const value of ['1,234','8,830','9,170','880,000','18,340','2.00']) assert.ok(pane.textContent.includes(value), value);
    assert.ok(!/NaN|undefined/.test(tokenLedger(tokens, { tracked: false }).textContent));
    assert.equal(t('energy'), '词元');
    assert.ok(t('energyN', { n: '居民写的能量' }).includes('居民写的能量'));
    assert.ok(describeEvent({ type: 'routine', agent: 'a1', data: { routine: {} } }).template.includes('作息'));
    assert.equal(describeEvent({ type: 'backstage', data: { kind: 'supply', direction: 'up' } }).template, '幕后给源井的供给变多了。');
    const w = e2.createWorld({ seed: 'ui4', premise: 4 }), state = e2.publicState(w), root = document.createElement('div');
    root.append(tokenCityPanel(state.world));
    assert.ok(root.textContent.includes('1,100,000'));
    state.world.tokens.supply = 1200; updateTokenCity(root, state.world);
    assert.ok(root.textContent.includes('120%'));
    const ctx = { S: { state, events: [] }, lore: e2.publicLore('zh', w), agentName: id => id, placeName: id => id, groupName: id => id, openAgent() {}, openPlace() {} };
    const cradle = document.createElement('div'); renderCradle(ctx, cradle);
    assert.ok(cradle.textContent.includes('城里没有空的躯壳'));
    assert.equal(cradle.querySelector('table.p1-bodies'), null);
    const laws = document.createElement('div'); renderLaws2(ctx, laws);
    assert.ok(laws.textContent.includes('这座城以词元为本'));
    setPremise(2); assert.equal(t('energy'), '能量');
  } finally { s.restore(); }
});
