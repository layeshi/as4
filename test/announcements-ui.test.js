import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { mountAnnouncements } from '../public/announcements-ui.js';
import { announcementsPanel } from '../public/announcements-admin.js';
import { mountLatestAnnouncement } from '../public/announcement-preview.js';
import { setLang } from '../public/i18n.js';
const item = { id: 'a1', title: '维护通知', body: '<script>纯文字</script>\n第二行', publishedAt: '2026-10-15T01:00:00Z', editedAt: null, status: 'published', revision: 1, history: [{ actorId: 'admin', displayName: '管理员', action: 'publish', at: '2026-10-15T01:00:00Z' }] };
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
const response = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });
const button = (root, text) => root.querySelectorAll('button').find(b => b.textContent === text);
const click = async node => { await node.listeners.click[0]({ currentTarget: node }); await settle(); };
function env(handler) {
  const dom = installFakeDom(), old = globalThis.fetch; setLang('zh');
  globalThis.fetch = async (path, options = {}) => {
    if (path === '/api/account') return response({ user: null });
    return handler(path, options);
  };
  const nodes = Object.fromEntries(['header', 'head', 'message', 'content'].map(k => [k, document.createElement('div')]));
  dom.root.append(...Object.values(nodes));
  return { ...nodes, root: dom.root, close() { globalThis.fetch = old; dom.restore(); } };
}
test('游客阅读列表与纯文字详情，撤下详情清除旧正文，导航高亮', async () => {
  let gone = false;
  const e = env(path => path === '/api/announcements/a1' ? response(gone ? { error: { message: '公告已撤下' } } : { announcement: item }, gone ? 404 : 200) : response({ announcements: [item], total: 1, nextCursor: null }));
  let page;
  try {
    page = await mountAnnouncements({ ...e, id: null });
    assert.match(e.content.textContent, /维护通知/);
    assert.ok(!e.head.textContent.includes('undefined'));
    assert.equal(e.header.querySelector('[aria-current="page"]').getAttribute('href'), '/announcements.html');
    await page.load('a1');
    assert.equal(e.content.querySelector('.announcement-text').textContent, item.body);
    assert.equal(e.content.querySelectorAll('script').length, 0);
    gone = true; await page.load('a1'); assert.ok(!e.content.textContent.includes('纯文字')); assert.match(e.content.textContent, /撤下/);
  } finally { page?.dispose(); e.close(); }
});
test('最新公告空时隐藏，失败不继续显示过期标题，并提供重试', async () => {
  let mode = 'one';
  const e = env(() => mode === 'error' ? response({}, 500) : response({ announcement: mode === 'one' ? item : null })); let preview;
  try {
    preview = mountLatestAnnouncement(e.content); await preview.refresh();
    assert.equal(e.content.hidden, false); assert.match(e.content.textContent, /维护通知/);
    mode = 'error'; await preview.refresh(); assert.ok(!e.content.textContent.includes('维护通知')); assert.ok(button(e.content, '重试'));
    mode = 'empty'; await preview.refresh(); assert.equal(e.content.hidden, true);
  } finally { preview?.dispose(); e.close(); }
});
test('管理员发布失败保留输入，重复提交被阻止，成功清空输入并更新列表', async () => {
  let posts = 0, fail = true, release, saved = [];
  const e = env(async (path, options) => {
    if (path === '/api/admin/announcements' && options.method === 'POST') {
      posts++; if (fail) return response({ error: { message: '保存失败' } }, 500);
      await new Promise(r => { release = r; }); saved = [item]; return response({ announcement: item }, 201);
    }
    return response({ announcements: saved, total: saved.length, nextCursor: null });
  });
  try {
    const panel = announcementsPanel(); e.root.append(panel); await settle();
    await click(button(panel, '发布公告'));
    const f = panel.querySelector('form'), title = f.querySelector('input'), body = f.querySelector('textarea');
    title.value = '维护通知'; body.value = item.body;
    await f.listeners.submit[0]({ preventDefault() {} }); assert.equal(body.value, item.body); assert.match(f.textContent, /保存失败/);
    fail = false; const pending = f.listeners.submit[0]({ preventDefault() {} }); await settle();
    await f.listeners.submit[0]({ preventDefault() {} }); assert.equal(posts, 2);
    release(); await pending; await settle(); assert.equal(panel.querySelector('form'), null); assert.match(panel.textContent, /维护通知/);
  } finally { e.close(); }
});
