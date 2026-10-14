import test from 'node:test';
import assert from 'node:assert/strict';
import { minigame } from './wechat-minigame-helpers.js';
const root = { id: 'm1', seq: 1, threadId: null, author: { displayName: '观察者' }, text: '与网页共享的留言', createdAt: '2026-10-14T03:00:00Z', editedAt: null, deletedAt: null, replyCount: 0, canEdit: true, canDelete: true };
const clone = value => JSON.parse(JSON.stringify(value));
async function setup(handler = () => null) {
  const c = minigame({ respond: async (path, options) => await handler(path, options) || (path === '/api/wechat/messages' ? { messages: [clone(root)], total: 1, nextCursor: null } : {}) });
  await c.game.start();
  Object.assign(c.game, { entered: true, tab: 'messages', user: { id: 'u1', username: 'alice', displayName: '观察者', role: 'user' }, wechatVerified: true });
  await c.game.messageBoard.load(); c.game.invalidate(); c.game.render();
  return c;
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

test('入口、匿名降级和权限按钮；主留言与回复的操作保持单行', async () => {
  const c = await setup(); const g = c.game;
  assert.ok(g.blocks.some(b => b.text === '留言板' || b.text === '留言讨论'));
  assert.ok(g.blocks.some(b => b.text === root.text));
  const actions = g.hits.filter(h => h.action.id === root.id && ['messageCompose', 'messageDelete', 'messageThread'].includes(h.action.type));
  assert.ok(actions.length >= 4);
  assert.equal(new Set(actions.map(h => h.y)).size, 1); assert.ok(actions.every(h => h.w >= 44 && h.h >= 44));
  g.tab = 'account'; g.invalidate(); g.render(); assert.ok(g.blocks.some(b => b.action?.type === 'messages'));
  g.user = null; g.wechatVerified = false; g.messageBoard.sync(); g.tab = 'messages'; g.invalidate(); g.render();
  assert.ok(g.blocks.some(b => b.text === '微信登录后参与讨论')); assert.ok(!g.blocks.some(b => b.text === root.text));
});

test('断网和检查失败保留草稿，处理中重复点击与输入不会重复提交或覆盖文本', async () => {
  let reject = true, release, posts = 0;
  const c = await setup(async (path, options) => {
    if (path === '/api/wechat/messages' && options.method === 'POST') {
      posts++;
      if (reject) throw Error('offline');
      await new Promise(resolve => { release = resolve; });
      return { message: { ...clone(root), id: 'm2', seq: 2, text: options.data.text }, moderation: {} };
    }
  }); const g = c.game;
  await g.dispatch({ type: 'messageCompose', kind: 'new' }); g.form.messageText = '不能丢失的草稿';
  await g.dispatch({ type: 'messageSubmit' });
  assert.equal(g.tab, 'messageEditor'); assert.equal(g.form.messageText, '不能丢失的草稿'); assert.match(g.error, /连接失败/);
  reject = false;
  const pending = g.dispatch({ type: 'messageSubmit' }); await settle();
  assert.equal(g.busy, true); await g.dispatch({ type: 'messageSubmit' });
  await g.dispatch({ type: 'field', name: 'messageText' }); assert.equal(g.editing, '');
  assert.equal(posts, 2); release(); await pending;
  assert.equal(g.form.messageText, undefined); assert.equal(g.messageBoard.roots[0].text, '不能丢失的草稿');
});

test('回复可指向某条回复，编辑保留内容，删除确认不连带清除后续回复', async () => {
  const r = { ...clone(root), id: 'm2', seq: 2, threadId: 'm1', text: '一条回复', replyTo: { id: 'm1', displayName: '观察者', deleted: false } };
  const c = await setup(async (path, options) => {
    if (path === '/api/wechat/messages/m1/replies' && options.method === 'GET') return { messages: [r], root: { ...clone(root), replyCount: 1 }, total: 1, nextCursor: null };
    if (path === '/api/wechat/messages/m1/replies' && options.method === 'POST') {
      assert.equal(options.data.replyToId, r.id);
      return { message: { ...r, id: 'm3', seq: 3, text: options.data.text, replyTo: { id: r.id, displayName: '观察者', deleted: false } } };
    }
    if (path === '/api/wechat/messages/m1' && options.method === 'DELETE') return { message: { ...clone(root), text: null, deletedAt: '2026-10-14T04:00:00Z', canEdit: false, canDelete: false, replyCount: 2 } };
  }); const g = c.game;
  await g.dispatch({ type: 'messageThread', id: 'm1' });
  await g.dispatch({ type: 'messageCompose', kind: 'reply', id: 'm2' });
  assert.ok(g.blocks.some(b => b.text === '回复对象：观察者'));
  g.form.messageText = '回复这一条'; await g.dispatch({ type: 'messageSubmit' });
  assert.equal(g.messageBoard.replies.get('m1').messages.length, 2);
  await g.dispatch({ type: 'messageDelete', id: 'm1' });
  assert.ok(g.blocks.some(b => b.text.includes('正文将隐藏')));
  await g.dispatch({ type: 'messageCancel' }); assert.ok(!c.requests.some(path => path === '/api/wechat/messages/m1'));
  await g.dispatch({ type: 'messageDelete', id: 'm1' }); await g.dispatch({ type: 'messageSubmit' });
  assert.equal(g.messageBoard.get('m1').text, null); assert.equal(g.messageBoard.get('m2').text, '一条回复');
});

test('旧账号迟到的读取响应不能恢复旧内容与草稿', async () => {
  let gate = null, release;
  const c = await setup(async (path) => path === '/api/wechat/messages' && gate ? gate : null); const g = c.game;
  gate = new Promise(resolve => { release = resolve; });
  const pending = g.messageBoard.load(); await settle();
  g.user = null; g.wechatVerified = false; g.messageBoard.sync();
  release({ messages: [{ ...root, text: '旧账号秘密留言' }], total: 1, nextCursor: null }); await pending;
  assert.equal(g.messageBoard.roots.length, 0); assert.equal(g.messageBoard.drafts.size, 0);
  assert.ok(!g.blocks.some(b => b.text === '旧账号秘密留言'));
});

test('换账号后旧提交结果不能进入新账号列表或恢复草稿', async () => {
  let release;
  const c = await setup(async (path, options) => {
    if (path === '/api/wechat/messages' && options.method === 'POST') return new Promise(resolve => { release = resolve; });
  }); const g = c.game;
  await g.dispatch({ type: 'messageCompose', kind: 'new' }); g.form.messageText = '旧账号的草稿';
  const pending = g.dispatch({ type: 'messageSubmit' }); await settle();
  g.user = { id: 'u2', displayName: '新账号', role: 'user' }; g.messageBoard.sync();
  release({ message: { ...root, id: 'm2', text: '旧账号的草稿' }, moderation: {} }); await pending;
  assert.equal(g.messageBoard.roots.length, 0); assert.equal(g.messageBoard.drafts.size, 0);
  assert.equal(g.form.messageText, undefined); assert.equal(g.messageBoard.editor, null);
});

test('字数、未展示内容和长昵称大字布局；未通过检查的正文没有全文或编辑入口', async () => {
  const c = await setup(); const g = c.game;
  await g.dispatch({ type: 'messageCompose', kind: 'new' }); g.form.messageText = '字'.repeat(2001);
  await g.dispatch({ type: 'messageSubmit' }); assert.match(g.error, /2,000/); assert.equal(c.requests.filter(path => path === '/api/wechat/messages').length, 1);
  await g.dispatch({ type: 'messageCancel' });
  Object.assign(g.messageBoard.roots[0], { author: { displayName: '非常长的昵称'.repeat(8) }, text: '内容未通过安全检查' });
  await g.dispatch({ type: 'pref', name: 'largeText' });
  assert.ok(g.blocks.some(b => b.text.includes('这段内容暂未展示')));
  assert.ok(!g.blocks.some(b => b.text === '编辑' || b.text === '全文'));
  assert.ok(g.page.nodes.every(n => Number.isFinite(n.height) && n.height >= 0));
});
