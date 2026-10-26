import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createPlatform } = require('../wechat/miniprogram-app/platform.js');
const theme = require('../wechat/minigame/ui/theme.js');
test('没有同步字体加载能力的小程序仍用衬线标题，未知动态名字使用系统正文字体', () => {
  try {
    theme.setSerif(null, '留言板');
    assert.equal(theme.font(17, { bold: true, serif: true, text: '留言板' }), 'bold 17px serif');
    assert.equal(theme.font(17, { bold: true, serif: true, text: '陌生昵称' }), 'bold 17px sans-serif');
    theme.setSerif('HeirsSerif', '留言板');
    assert.equal(theme.font(17, { bold: true, serif: true, text: '留言板' }), '17px "HeirsSerif"');
  } finally { theme.setSerif(null, null); }
});
test('Mini Program adapter routes canvas, input, touch and disposal without persisting secrets', () => {
  const offscreen = {}, canvas = { createImage: () => 'image' };
  const page = { game: { editing: 'password' }, data: {}, setData(d) { Object.assign(this.data, d); } };
  const p = createPlatform({ createOffscreenCanvas: options => { assert.equal(options.type, '2d'); return offscreen; }, hideKeyboard() {} }, canvas, page);
  assert.equal(p.api.createCanvas(), canvas); assert.equal(p.api.createCanvas(), offscreen); assert.equal(p.api.createImage(), 'image');
  p.api.showKeyboard({ defaultValue: 'secret-only-memory', maxLength: 128 });
  assert.equal(page.data.secret, true); assert.equal(page.data.inputValue, 'secret-only-memory');
  page.game.editing = 'confirmPassword'; p.api.showKeyboard({ defaultValue: 'confirmation-secret' });
  assert.equal(page.data.secret, true);
  let touch; p.api.onTouchStart(e => { touch = e.touches[0]; }); p.emit('TouchStart', { touches: [{ x: 15, y: 25 }] });
  assert.equal(touch.clientX, 15); assert.equal(touch.clientY, 25);
  p.api.onHide(() => p.api.hideKeyboard()); p.emit('Hide');
  assert.equal(page.data.inputValue, ''); assert.equal(page.data.editing, false);
  p.dispose(); p.emit('TouchStart', { touches: [{ x: 99, y: 99 }] }); assert.equal(touch.clientX, 15);
});
test('removed assistant and model fields have no native labels; password fields stay masked unless shown', () => {
  const page = { game: { editing: '' }, data: {}, setData(d) { Object.assign(this.data, d); } };
  const p = createPlatform({ hideKeyboard() {} }, {}, page);
  for (const name of ['assistantText', 'assistantAdminKey', 'assistantOwnerKey', 'apiKey', 'baseURL', 'model', 'letter', 'soul', 'messageText']) {
    page.game.editing = name; p.api.showKeyboard({ defaultValue: '' });
    assert.equal(page.data.inputLabel, '编辑内容', name); p.api.hideKeyboard();
  }
  for (const name of ['password', 'confirmPassword', 'currentPassword']) {
    page.game.editing = name; p.api.showKeyboard({ defaultValue: 'secret' }); assert.equal(page.data.secret, true, name);
    p.api.showKeyboard({ defaultValue: 'secret', showPassword: true }); assert.equal(page.data.secret, false, name);
    p.api.hideKeyboard(); assert.equal(page.data.inputValue, '');
  }
});
