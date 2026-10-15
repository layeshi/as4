import test from 'node:test';
import assert from 'node:assert/strict';
import { minigame } from './wechat-minigame-helpers.js';
const item = { id: 'a1', title: '版本更新公告', body: '第一行\n第二行\n' + '长公告'.repeat(2000), publishedAt: '2026-10-15T01:00:00Z', editedAt: null };
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
function setup(handler = () => null) {
  return minigame({ respond: async (path, options) => await handler(path, options) || (path === '/api/announcements/latest' ? { announcement: item } : path === '/api/announcements/a1' ? { announcement: item } : path === '/api/announcements' ? { announcements: [item], total: 1, nextCursor: null } : {}) });
}
test('冷启动不请求公告，匿名我的页可进入公告列表与长详情并返回', async () => {
  const c = setup(), g = c.game;
  await g.start(); assert.equal(c.requests.length, 0);
  g.entered = true; g.tab = 'account'; g.invalidate(); g.render();
  assert.ok(g.blocks.some(b => b.action?.type === 'announcements'));
  await g.dispatch({ type: 'announcements' });
  assert.equal(g.tab, 'announcements'); assert.ok(g.blocks.some(b => b.text === item.title));
  assert.ok(c.requests.includes('/api/announcements'));
  await g.dispatch({ type: 'announcement', id: item.id });
  assert.equal(g.tab, 'announcement'); assert.ok(g.blocks.some(b => b.text === item.body));
  assert.ok(g.page.nodes.reduce((n, b) => n + b.height, 0) > 844, '长正文可完整滚动');
  await g.dispatch({ type: 'back' }); assert.equal(g.tab, 'announcements');
});
test('最新公告可匿名加载，错误清除旧正文并展示重试，不影响城市读取', async () => {
  let fail = false;
  const c = setup(path => { if (path === '/api/announcements/a1' && fail) throw Error('offline'); }), g = c.game;
  await g.start(); g.entered = true;
  await g.announcements.loadLatest(); assert.equal(g.announcements.latest.id, 'a1');
  await g.dispatch({ type: 'announcement', id: 'a1' }); assert.equal(g.announcements.detail.id, 'a1');
  fail = true; await g.announcements.loadDetail('a1'); g.invalidate(); g.render();
  assert.equal(g.announcements.detail, null);
  assert.ok(g.blocks.some(b => b.text?.includes('无法读取公告')));
  assert.ok(!g.blocks.some(b => b.text === item.body));
});
test('迟到的旧详情不能覆盖另一条公告，分页不重复', async () => {
  let release;
  const other = { ...item, id: 'a2', title: '另一条公告' };
  const c = setup(path => {
    if (path === '/api/announcements/a1') return new Promise(r => { release = r; });
    if (path === '/api/announcements/a2') return { announcement: other };
    if (path === '/api/announcements') return { announcements: [other], total: 2, nextCursor: 2 };
    if (path === '/api/announcements?cursor=2') return { announcements: [item], total: 2, nextCursor: null };
  }), g = c.game;
  await g.start(); g.entered = true;
  const pending = g.announcements.loadDetail('a1'); await settle();
  await g.announcements.loadDetail('a2'); release({ announcement: item }); await pending;
  assert.equal(g.announcements.detail.id, 'a2');
  await g.announcements.load(); await g.announcements.load(true);
  assert.deepEqual(Array.from(g.announcements.items, x => x.id), ['a2', 'a1']);
});
