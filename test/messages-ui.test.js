import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { mountMessageBoard } from '../public/messages-ui.js';
import { refreshAccount } from '../public/accounts.js';
import { setLang, getLang } from '../public/i18n.js';

const alice = { id: 'alice', username: 'alice', displayName: '甲', role: 'user' };
const bob = { id: 'bob', username: 'bob', displayName: '乙', role: 'user' };
const item = { id: 'm1', seq: 1, threadId: null, author: { displayName: '甲' }, text: '<script>不能执行</script>\n第二行', createdAt: '2026-10-14T03:00:00Z', editedAt: null, deletedAt: null, canEdit: true, canDelete: true, replyCount: 0 };
const reply = (status, json) => ({ ok: status < 400, status, json: async () => json });
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
function setup(who = alice, roots = [item]) {
  const dom = installFakeDom(), savedFetch = globalThis.fetch, lang = getLang();
  setLang('zh');
  let user = who, handler = null;
  const calls = [];
  globalThis.fetch = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === '/api/account') return reply(200, { user, registrationOpen: true });
    if (handler) { const handled = await handler(path, options); if (handled) return handled; }
    if (path === '/api/messages') return reply(200, { messages: roots, total: roots.length, nextCursor: null });
    return reply(200, { messages: [], total: 0, nextCursor: null });
  };
  const elements = Object.fromEntries(['header', 'head', 'message', 'content'].map((name) => [name, document.createElement('div')]));
  dom.root.append(...Object.values(elements));
  return { ...elements, calls, user: (next) => { user = next; }, handler: (fn) => { handler = fn; }, restore: () => { globalThis.fetch = savedFetch; setLang(lang); dom.restore(); } };
}
const click = async (node) => { await node.listeners.click[0]({ currentTarget: node }); await settle(); };
const submit = async (form) => { await form.listeners.submit[0]({ preventDefault() {} }); await settle(); };
const button = (root, text) => root.querySelectorAll('button').find((b) => b.textContent === text);

test('匿名页面不请求或展示留言；文本按原文显示，作者可见适用操作', async () => {
  const e = setup(null); let board;
  try {
    board = await mountMessageBoard(e);
    assert.match(e.content.textContent, /登录后参与讨论/);
    assert.ok(!e.calls.some((c) => c.path === '/api/messages'));
    e.user(alice); await board.load();
    assert.equal(e.content.querySelector('.message-text').textContent, item.text);
    assert.equal(e.content.querySelectorAll('script').length, 0);
    assert.ok(button(e.content, '编辑')); assert.ok(button(e.content, '删除'));
    assert.equal(e.header.querySelector('[aria-current="page"]').getAttribute('href'), '/messages.html');
    e.user(null); await refreshAccount({ notify: false, redirect: false });
    assert.ok(!e.content.textContent.includes('不能执行'), '退出后立即清空已加载内容');
  } finally { board?.dispose(); e.restore(); }
});

test('提交失败保留草稿并可重试；等待期间重复提交只发一次，成功后清空草稿', async () => {
  const e = setup(alice, []); let board;
  try {
    board = await mountMessageBoard(e);
    let fail = true, release;
    e.handler(async (path, options) => {
      if (path === '/api/messages' && options.method === 'POST') {
        if (fail) throw Error('offline');
        await new Promise((r) => { release = r; });
        return reply(201, { message: { ...item, text: JSON.parse(options.body).text } });
      }
    });
    let input = e.content.querySelector('textarea'), form = e.content.querySelector('form');
    input.value = '保留我的草稿'; input.listeners.input[0]();
    await submit(form);
    assert.equal(input.value, '保留我的草稿'); assert.match(form.textContent, /请求失败/);
    fail = false;
    const pending = submit(form); await settle();
    await form.listeners.submit[0]({ preventDefault() {} });
    assert.equal(e.calls.filter((c) => c.options.method === 'POST').length, 2, '失败一次，重试一次，没有重复提交');
    release(); await pending;
    assert.equal(e.content.querySelector('textarea').value, ''); assert.match(e.content.textContent, /保留我的草稿/);
  } finally { board?.dispose(); e.restore(); }
});

test('回复、编辑与删除就地展开，仅一个主提交；取消删除不发请求', async () => {
  const e = setup(); let board;
  try {
    board = await mountMessageBoard(e);
    await click(button(e.content, '回复'));
    assert.equal(e.content.querySelectorAll('button.primary').length, 1);
    assert.match(e.content.textContent, /回复 甲/);
    await click(button(e.content, '取消'));
    await click(button(e.content, '编辑'));
    assert.equal(e.content.querySelectorAll('textarea')[1].value, item.text);
    await click(button(e.content, '取消'));
    await click(button(e.content, '删除'));
    assert.match(e.content.textContent, /已有回复仍然保留/);
    await click(button(e.content, '取消'));
    assert.ok(!e.calls.some((c) => c.options.method === 'DELETE'));
    e.handler(async (path, options) => options.method === 'DELETE' ? reply(200, { message: { ...item, text: null, deletedAt: '2026-10-14T04:00:00Z', canEdit: false, canDelete: false } }) : null);
    await click(button(e.content, '删除')); await click(button(e.content, '确认删除'));
    assert.match(e.content.textContent, /该留言已删除/); assert.ok(!e.content.textContent.includes('不能执行'));
    assert.ok(!button(e.content, '编辑'));
  } finally { board?.dispose(); e.restore(); }
});

test('换账号后清空草稿与讨论，旧账号迟到的响应不能重新显示私人内容', async () => {
  const e = setup(); let board;
  try {
    board = await mountMessageBoard(e);
    const input = e.content.querySelector('textarea'); input.value = '甲的草稿'; input.listeners.input[0]();
    let release;
    e.handler(async (path) => {
      if (path.startsWith('/api/messages/m1/replies')) return new Promise((r) => { release = () => r(reply(200, { messages: [{ ...item, id: 'm2', seq: 2, threadId: 'm1', text: '旧账号迟到回复' }], total: 1, nextCursor: null })); });
    });
    const pending = click(button(e.content, '查看回复（0）')); await settle();
    e.user(bob); await refreshAccount({ notify: false, redirect: false });
    assert.equal(e.content.querySelector('textarea').value, '');
    release(); await pending;
    assert.ok(!e.content.textContent.includes('旧账号迟到回复')); assert.ok(!e.content.textContent.includes('甲的草稿'));
  } finally { board?.dispose(); e.restore(); }
});

test('回复很多时新发回复仍然立即可见，加载旧回复不会重复或丢失新回复', async () => {
  const e = setup(alice, [{ ...item, replyCount: 25 }]); let board;
  try {
    board = await mountMessageBoard(e);
    const latest = { ...item, id: 'm27', seq: 27, threadId: 'm1', text: '刚刚发表的新回复', replyTo: { id: 'm1', displayName: '甲', deleted: false } };
    e.handler(async (path, options) => {
      if (path === '/api/messages/m1/replies' && options.method === 'POST') return reply(201, { message: latest });
      if (path === '/api/messages/m1/replies') return reply(200, { messages: Array.from({ length: 20 }, (_, i) => ({ ...latest, id: `m${i + 2}`, seq: i + 2, text: `旧回复 ${i}` })), total: 26, nextCursor: 21 });
      if (path === '/api/messages/m1/replies?cursor=21') return reply(200, { messages: [...Array.from({ length: 5 }, (_, i) => ({ ...latest, id: `m${i + 22}`, seq: i + 22, text: `旧回复 ${i + 20}` })), latest], total: 26, nextCursor: null });
    });
    await click(button(e.content, '回复'));
    const input = e.content.querySelectorAll('textarea')[1]; input.value = latest.text; input.listeners.input[0]();
    await submit(e.content.querySelectorAll('form')[1]);
    assert.match(e.content.textContent, /刚刚发表的新回复/);
    await click(button(e.content, '加载更多回复'));
    assert.equal(e.content.querySelectorAll('.message-reply').length, 26);
    assert.equal(e.content.querySelectorAll('.message-reply').at(-1).querySelector('.message-text').textContent, latest.text);
  } finally { board?.dispose(); e.restore(); }
});

test('旧列表响应不能使已删除正文重新出现，读取失败显示重试而非空留言', async () => {
  const e = setup(); let board;
  try {
    board = await mountMessageBoard(e);
    let release;
    e.handler(async (path, options) => {
      if (path === '/api/messages' && options.method === 'GET') return new Promise((r) => { release = () => r(reply(200, { messages: [item], total: 1, nextCursor: null })); });
      if (options.method === 'DELETE') return reply(200, { message: { ...item, text: null, deletedAt: '2026-10-14T04:00:00Z', canDelete: false, canEdit: false } });
    });
    const pending = board.load(); await settle();
    await click(button(e.content, '删除')); await click(button(e.content, '确认删除'));
    release(); await pending;
    assert.match(e.content.textContent, /该留言已删除/); assert.ok(!e.content.textContent.includes('不能执行'));
    e.handler(async (path) => path === '/api/messages' ? reply(500, { error: { message: '服务暂不可用' } }) : null);
    await board.load();
    assert.match(e.content.textContent, /无法读取留言/); assert.ok(button(e.content, '重试'));
  } finally { board?.dispose(); e.restore(); }
});
