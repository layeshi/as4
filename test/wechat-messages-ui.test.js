import test from 'node:test';
import assert from 'node:assert/strict';
import { minigame } from './wechat-minigame-helpers.js';
const root = { id: 'm1', seq: 1, threadId: null, author: { displayName: '观察者' }, text: '与网页共享的留言', createdAt: '2026-10-14T03:00:00Z', editedAt: null, deletedAt: null, replyCount: 1, canEdit: true, canDelete: true };
const reply = { ...root, id: 'm2', seq: 2, threadId: 'm1', text: '一条回复', replyCount: 0, replyTo: { id: 'm1', displayName: '观察者', deleted: false } };
const clone = value => JSON.parse(JSON.stringify(value));
async function setup(handler = () => null) {
  const c = minigame({ respond: async (path, options) => await handler(path, options) || (path === '/api/wechat/messages' ? { messages: [clone(root)], total: 1, nextCursor: null } : path === '/api/wechat/messages/m1/replies' ? { messages: [clone(reply)], root: clone(root), total: 1, nextCursor: null } : {}) });
  await c.game.start();
  Object.assign(c.game, { entered: true, tab: 'messages', user: { id: 'u1', username: 'alice', displayName: '观察者', role: 'user' }, wechatVerified: true });
  await c.game.messageBoard.load(); c.game.invalidate(); c.game.render();
  return c;
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const texts = g => g.blocks.map(b => b.text || '');
const WRITE_ACTIONS = ['messageCompose', 'messageDelete', 'messageSubmit', 'messageCancel'];

test('留言板只读：可阅读主留言与回复，没有发表、回复、编辑或删除入口，反馈指向客服邮箱', async () => {
  const c = await setup(); const g = c.game;
  assert.ok(texts(g).includes(root.text));
  assert.ok(!g.hits.some(h => WRITE_ACTIONS.includes(h.action.type)), 'no write controls on the list');
  assert.equal(g.page.footer, undefined, 'no compose footer');
  assert.ok(texts(g).some(t => t.includes('小程序内仅可阅读留言')));
  assert.ok(g.hits.some(h => h.action.type === 'support'));
  const thread = g.hits.find(h => h.action.type === 'messageThread' && h.action.id === 'm1');
  assert.ok(thread && thread.w >= 44 && thread.h >= 44);
  await g.dispatch(thread.action);
  assert.equal(g.tab, 'messageThread'); assert.ok(texts(g).includes('一条回复'));
  assert.ok(!g.hits.some(h => WRITE_ACTIONS.includes(h.action.type)), 'no write controls in a thread');
  assert.equal(g.page.footer, undefined);
});

test('旧版写留言的动作被拒绝且不发出请求，草稿与编辑器不会出现', async () => {
  const c = await setup(); const g = c.game;
  const before = c.requests.length;
  for (const action of [{ type: 'messageCompose', kind: 'new' }, { type: 'messageCompose', kind: 'reply', id: 'm1' }, { type: 'messageCompose', kind: 'edit', id: 'm1' }, { type: 'messageDelete', id: 'm1' }, { type: 'messageSubmit' }, { type: 'messageCancel' }]) {
    g.error = ''; g.form.messageText = '不应提交的文字';
    await g.dispatch(action);
    assert.match(g.error, /小程序仅提供观测与已有记录查询/, action.type);
    assert.equal(g.tab, 'messages', action.type);
  }
  assert.equal(c.requests.length, before, 'no network request for removed message writes');
  g.tab = 'messageEditor'; g.invalidate(); g.render();
  assert.ok(!g.hits.some(h => WRITE_ACTIONS.includes(h.action.type)), 'an old editor page id falls back to a read-only screen');
});

test('客户端接口层直接拒绝留言写入', async () => {
  const c = await setup(); const api = c.load(new URL('../wechat/minigame/utils/api.js', import.meta.url).pathname);
  for (const [path, method] of [['/api/messages', 'POST'], ['/api/messages/m1/replies', 'POST'], ['/api/messages/m1', 'PATCH'], ['/api/messages/m1', 'DELETE']]) {
    const before = c.requests.length;
    await assert.rejects(api.request(path, { method, data: { text: 'x' } }), error => error.status === 403 && error.code === 'wechat_observation_only');
    assert.equal(c.requests.length, before, method + ' ' + path);
  }
});

test('入口与匿名降级：未登录不显示留言', async () => {
  const c = await setup(); const g = c.game;
  g.tab = 'account'; g.invalidate(); g.render(); assert.ok(g.blocks.some(b => b.action?.type === 'messages'));
  g.user = null; g.wechatVerified = false; g.messageBoard.sync(); g.tab = 'messages'; g.invalidate(); g.render();
  assert.ok(texts(g).includes('微信登录后阅读留言')); assert.ok(!texts(g).includes(root.text));
});

test('旧账号迟到的读取响应不能恢复旧内容', async () => {
  let gate = null, release;
  const c = await setup(async (path) => path === '/api/wechat/messages' && gate ? gate : null); const g = c.game;
  gate = new Promise(resolve => { release = resolve; });
  const pending = g.messageBoard.load(); await settle();
  g.user = null; g.wechatVerified = false; g.messageBoard.sync();
  release({ messages: [{ ...root, text: '旧账号秘密留言' }], total: 1, nextCursor: null }); await pending;
  assert.equal(g.messageBoard.roots.length, 0);
  assert.ok(!texts(g).includes('旧账号秘密留言'));
});

test('未展示内容和长昵称大字布局；未通过检查的正文没有全文入口', async () => {
  const c = await setup(); const g = c.game;
  Object.assign(g.messageBoard.roots[0], { author: { displayName: '非常长的昵称'.repeat(8) }, text: '内容未通过安全检查' });
  await g.dispatch({ type: 'pref', name: 'largeText' });
  assert.ok(texts(g).some(t => t.includes('这段内容暂未展示')));
  assert.ok(!texts(g).some(t => t === '编辑' || t === '全文'));
  assert.ok(g.page.nodes.every(n => Number.isFinite(n.height) && n.height >= 0));
  await g.dispatch({ type: 'pref', name: 'largeText' });
});
