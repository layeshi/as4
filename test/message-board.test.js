import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { boot, verifiedBody } from './http-helpers.js';
import { MessageBoard } from '../src/message-board.js';

const password = 'message-board-test-password';
async function person(e, name, admin = false) {
  const body = { username: name, displayName: name, password, ...(admin ? { adminKey: e.cfg.adminKey } : {}) };
  const r = await e.call(admin ? '/api/account/setup' : '/api/account/register', { method: 'POST', body: admin ? body : await verifiedBody(e, body), headers: { 'X-Houren-Request': '1' } });
  assert.equal(r.status, 201);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return { user: r.json.user, cookie, call: (path, body, method = body === undefined ? 'GET' : 'POST', headers = {}) => e.call(path, { body, method, headers: { Cookie: cookie, 'X-Houren-Request': '1', ...headers } }) };
}

test('留言接口要求账号会话，作者不可伪造，普通用户与管理员的权限不同', async () => {
  const e = await boot();
  try {
    const a = await person(e, 'alice'), b = await person(e, 'bob'), admin = await person(e, 'chief', true);
    assert.equal((await e.call('/api/messages')).status, 401);
    assert.equal((await e.call('/api/messages', { headers: { 'X-Admin-Key': e.cfg.adminKey } })).status, 401, '管理密钥不能替代账号会话');
    assert.equal((await e.call('/api/messages', { method: 'POST', body: { text: 'hello' }, headers: { Cookie: a.cookie } })).status, 403);
    assert.equal((await a.call('/api/messages', { text: 'hello' }, 'POST', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    const r = await a.call('/api/messages', { text: '第一行\n<script>alert(1)</script>', authorId: b.user.id, role: 'admin' });
    assert.equal(r.status, 201); const id = r.json.message.id;
    assert.equal(r.json.message.author.displayName, 'alice');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.ok(!JSON.stringify(r.json).includes(a.user.id), '不泄露账号编号、凭据或私人资料');
    const own = (await a.call('/api/messages')).json.messages[0], other = (await b.call('/api/messages')).json.messages[0];
    assert.equal(own.canEdit, true); assert.equal(other.canEdit, false); assert.equal(other.canDelete, false);
    assert.equal((await b.call(`/api/messages/${id}`, { text: '篡改' }, 'PATCH')).status, 403);
    assert.equal((await b.call(`/api/messages/${id}`, {}, 'DELETE')).status, 403);
    assert.equal((await admin.call(`/api/messages/${id}`, { text: '管理员篡改' }, 'PATCH')).status, 403);
    const changed = await a.call(`/api/messages/${id}`, { text: '已修改' }, 'PATCH');
    assert.equal(changed.status, 200); assert.ok(changed.json.message.editedAt);
    await a.call('/api/account', { displayName: '新昵称' }, 'PATCH');
    assert.equal((await b.call('/api/messages')).json.messages[0].author.displayName, '新昵称');
    await admin.call(`/api/admin/users/${a.user.id}`, { status: 'disabled' }, 'PATCH');
    assert.equal((await a.call('/api/messages')).status, 401, '停用立即失效');
    assert.equal((await admin.call(`/api/messages/${id}`, {}, 'DELETE')).status, 200);
  } finally { await e.close(); }
});

test('回复对象受讨论边界约束，删除主留言或回复保留占位与其他人的回复', async () => {
  const e = await boot();
  try {
    const a = await person(e, 'alice'), b = await person(e, 'bob');
    const root = (await a.call('/api/messages', { text: '主留言' })).json.message;
    const another = (await a.call('/api/messages', { text: '另一条主留言' })).json.message;
    const first = (await b.call(`/api/messages/${root.id}/replies`, { text: '第一条回复' })).json.message;
    const second = (await a.call(`/api/messages/${root.id}/replies`, { text: '回复乙', replyToId: first.id })).json.message;
    assert.equal(second.threadId, root.id); assert.equal(second.replyTo.id, first.id);
    assert.equal((await a.call(`/api/messages/${root.id}/replies`, { text: '跨讨论', replyToId: another.id })).status, 400);
    assert.equal((await a.call(`/api/messages/${first.id}/replies`, { text: '错误主留言' })).status, 400);
    assert.equal((await a.call(`/api/messages/${root.id}/replies`, { text: '缺失', replyToId: 'm999' })).status, 404);
    await b.call(`/api/messages/${first.id}`, {}, 'DELETE');
    await a.call(`/api/messages/${root.id}`, {}, 'DELETE');
    const replies = (await a.call(`/api/messages/${root.id}/replies`)).json.messages;
    assert.equal(replies.length, 2); assert.equal(replies[0].text, null); assert.equal(replies[1].text, '回复乙');
    assert.equal(replies[1].replyTo.deleted, true);
    assert.equal((await a.call(`/api/messages/${root.id}`, { text: '恢复' }, 'PATCH')).status, 409);
    assert.equal((await a.call(`/api/messages/${root.id}`, {}, 'DELETE')).status, 200, '重复删除幂等');
    assert.equal((await b.call(`/api/messages/${root.id}/replies`, { text: '继续讨论' })).status, 201, '删除主留言不关闭既有讨论');
    const disk = JSON.parse(readFileSync(join(e.dir, 'message-board.json'), 'utf8'));
    assert.equal(disk.entries.find((m) => m.id === root.id).text, '', '删除的主留言正文从持久化数据清除');
    assert.equal(disk.entries.find((m) => m.id === first.id).text, '', '删除的回复正文从持久化数据清除');
    assert.equal((await a.call('/api/messages')).json.messages.find((m) => m.id === root.id).replyCount, 3);
  } finally { await e.close(); }
});

test('字数按 Unicode 字符计，拒绝空文本与超长内容，异常高频操作受限制', async () => {
  const e = await boot();
  try {
    const a = await person(e, 'alice');
    for (const text of ['', ' \n ', null, 1, '字'.repeat(2001), '🌙'.repeat(2001)]) assert.equal((await a.call('/api/messages', { text })).status, 400);
    assert.equal((await a.call('/api/messages', { text: '🌙'.repeat(2000) })).status, 201, '2,000 个非 BMP 字符也可以发表');
    const second = (await a.call('/api/messages', { text: '中文'.repeat(1000) })).json.message;
    assert.equal((await a.call(`/api/messages/${second.id}/replies`, { text: '🌙'.repeat(2000) })).status, 201);
    assert.equal((await a.call('/api/messages', [], 'POST')).status, 400);
    assert.equal((await a.call('/api/messages?cursor=bad')).status, 400);
    let limited = false;
    for (let i = 0; i < 35; i++) if ((await a.call('/api/messages', { text: '频率测试' })).status === 429) limited = true;
    assert.ok(limited);
  } finally { await e.close(); }
});

test('游标分页稳定，主留言新到旧、回复旧到新；编辑与回复不移动主留言', async () => {
  const e = await boot();
  try {
    const a = await person(e, 'alice'), store = e.app.ctx.messageBoard;
    const roots = Array.from({ length: 43 }, (_, i) => store.create(a.user, `留言 ${i}`));
    const first = store.list(e.app.ctx.accounts, a.user);
    assert.equal(first.messages.length, 20); assert.equal(first.messages[0].id, roots.at(-1).id);
    store.edit(a.user, roots[0].id, '编辑最早一条');
    store.create(a.user, '新留言');
    const second = store.list(e.app.ctx.accounts, a.user, { cursor: first.nextCursor });
    const third = store.list(e.app.ctx.accounts, a.user, { cursor: second.nextCursor });
    assert.deepEqual([...first.messages, ...second.messages, ...third.messages].map((m) => m.id), roots.toReversed().map((m) => m.id));
    const root = roots[0];
    const replies = Array.from({ length: 43 }, (_, i) => store.create(a.user, `回复 ${i}`, { threadId: root.id }));
    const one = store.list(e.app.ctx.accounts, a.user, { threadId: root.id });
    const two = store.list(e.app.ctx.accounts, a.user, { threadId: root.id, cursor: one.nextCursor });
    const three = store.list(e.app.ctx.accounts, a.user, { threadId: root.id, cursor: two.nextCursor });
    assert.deepEqual([...one.messages, ...two.messages, ...three.messages].map((m) => m.id), replies.map((m) => m.id));
    assert.equal(third.nextCursor, null); assert.equal(three.nextCursor, null);
  } finally { await e.close(); }
});

test('留言跨重启、切换世界与重置保留，不进入世界快照或日志；损坏数据不能静默覆盖', async () => {
  let e = await boot(); const dir = e.dir;
  try {
    const a = await person(e, 'alice'), store = e.app.ctx.messageBoard;
    const root = store.create(a.user, '跨纪元讨论'), reply = store.create(a.user, '历史回复', { threadId: root.id });
    store.delete(a.user, reply.id);
    const snapshot = await e.app.ctx.snapshots.save({ label: '世界快照' });
    const archive = JSON.parse(gunzipSync(readFileSync(e.app.ctx.snapshots.download(snapshot.id))).toString());
    assert.deepEqual(Object.keys(archive.files).sort(), ['commands.jsonl', 'events.jsonl', 'snapshot.json']);
    assert.ok(!JSON.stringify(e.rt.w).includes('跨纪元讨论'));
    assert.equal(statSync(store.file).mode & 0o777, 0o600);
    await e.close({ keepDir: true });
    e = await boot({ worldId: 'another-world', reset: true }, { dir });
    const persisted = e.app.ctx.messageBoard;
    assert.equal(persisted.get(root.id).text, '跨纪元讨论'); assert.ok(persisted.get(reply.id).deletedAt);
    assert.equal((await e.call('/api/messages', { headers: { Cookie: a.cookie } })).status, 401, '重启后旧会话失效');
    const login = await e.call('/api/account/login', { method: 'POST', body: { username: 'alice', password }, headers: { 'X-Houren-Request': '1' } });
    assert.equal(login.status, 200);
    const r = await e.call('/api/messages', { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } });
    assert.equal(r.json.messages[0].text, '跨纪元讨论');
    const filename = persisted.file;
    writeFileSync(filename, '{invalid');
    assert.throws(() => new MessageBoard(dir)); assert.equal(readFileSync(filename, 'utf8'), '{invalid');
  } finally { await e.close(); }
});

test('页面沿用登录门和 CSP，关闭全站登录门也不能匿名读取留言', async () => {
  const e = await boot({ requireLogin: true });
  try {
    const res = await fetch(e.base + '/messages.html', { redirect: 'manual' });
    assert.equal(res.status, 302); assert.match(res.headers.get('location'), /^\/login\.html\?next=/);
    const a = await person(e, 'alice');
    const page = await a.call('/messages.html');
    assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.doesNotMatch(page.text, /\sstyle=|<script(?![^>]*\bsrc=)/);
    assert.equal((await e.call('/api/messages')).status, 401);
  } finally { await e.close(); }
});

test('已验证的账号合并保留旧账号留言的归属与操作权限', async () => {
  const e = await boot();
  try {
    const a = await person(e, 'alice'), b = await person(e, 'bob');
    const root = (await a.call('/api/messages', { text: '合并前的留言' })).json.message;
    // 模拟 AccountMerger.finish 发布的账号归属记录，不允许客户端自行提交这些字段。
    e.app.ctx.accounts.commit((users) => {
      const from = users.find((u) => u.id === a.user.id), to = users.find((u) => u.id === b.user.id);
      from.status = 'disabled'; from.mergedTo = to.id; from.revision++;
      to.mergedAccountIds = [from.id];
    });
    const row = (await b.call('/api/messages')).json.messages[0];
    assert.equal(row.author.displayName, 'bob'); assert.equal(row.canEdit, true);
    assert.equal((await b.call(`/api/messages/${root.id}`, { text: '合并后编辑' }, 'PATCH')).status, 200);
    assert.equal((await b.call(`/api/messages/${root.id}`, {}, 'DELETE')).status, 200);
    assert.equal((await a.call('/api/messages')).status, 401);
  } finally { await e.close(); }
});
