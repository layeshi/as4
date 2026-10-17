import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { mountAltcha } from '../public/login-altcha.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const dom = installFakeDom();
  const original = document.createElement;
  const widgets = [];
  document.createElement = (tag) => {
    const node = original(tag);
    if (tag === 'altcha-widget') {
      widgets.push(node);
      node.configure = options => { node.options = options; };
      node.verify = options => { node.controller = options.controller; };
      node.reset = () => { node.wasReset = true; };
    }
    return node;
  };
  const container = original('div');
  dom.root.append(container);
  return { dom, widgets, container };
}

test('ALTCHA refresh clears old tokens, ignores stale events and aborts work on modal disposal', async () => {
  const { dom, widgets, container } = fixture();
  const captcha = mountAltcha(container, { load: async () => {} });
  try {
    await settle();
    const first = widgets[0];
    first.fire('load');
    first.fire('statechange', { detail: { state: 'verified', payload: 'one-use-proof' } });
    assert.equal(captcha.getResponse(), 'one-use-proof');
    captcha.reset();
    assert.equal(captcha.getResponse(), '');
    assert.equal(first.controller.signal.aborted, true);
    assert.equal(first.wasReset, true);
    await settle();
    first.fire('statechange', { detail: { state: 'verified', payload: 'stale-proof' } });
    assert.equal(captcha.getResponse(), '');
    widgets[1].fire('load');
    widgets[1].fire('statechange', { detail: { state: 'verified', payload: 'new-proof' } });
    assert.equal(captcha.getResponse(), 'new-proof');
    widgets[1].fire('statechange', { detail: { state: 'expired' } });
    assert.equal(captcha.getResponse(), '');
    assert.equal(container.querySelector('button').hidden, false);
    captcha.remove();
    assert.equal(widgets[1].controller.signal.aborted, true);
    assert.equal(widgets[1].isConnected, false);
    widgets[1].fire('statechange', { detail: { state: 'verified', payload: 'late-proof' } });
    assert.equal(captcha.getResponse(), '');
  } finally { captcha.remove(); dom.restore(); }
});

test('closing while resources load cannot create or start a detached widget', async () => {
  const { dom, widgets, container } = fixture();
  let finish;
  const captcha = mountAltcha(container, { load: () => new Promise(resolve => { finish = resolve; }) });
  try {
    captcha.remove();
    finish();
    await settle();
    assert.equal(widgets.length, 0);
    assert.equal(captcha.getResponse(), '');
  } finally { captcha.remove(); dom.restore(); }
});

test('load and verification errors remain closed and provide a working retry', async () => {
  const { dom, widgets, container } = fixture();
  let attempts = 0;
  const captcha = mountAltcha(container, { load: async () => { if (attempts++ === 0) throw new Error('offline'); } });
  try {
    await settle();
    assert.equal(captcha.getResponse(), '');
    assert.equal(container.querySelector('button').hidden, false);
    container.querySelector('button').click();
    await settle();
    assert.equal(widgets.length, 1);
    widgets[0].fire('load');
    widgets[0].fire('statechange', { detail: { state: 'error' } });
    assert.equal(captcha.getResponse(), '');
    assert.equal(widgets[0].hidden, true);
    assert.equal(container.querySelector('button').hidden, false);
  } finally { captcha.remove(); dom.restore(); }
});
