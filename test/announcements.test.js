import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { boot, verifiedBody } from './http-helpers.js';

async function admin(e) {
  const result = await e.call('/api/account/setup', { method: 'POST', headers: { 'X-Houren-Request': '1' }, body: { username: 'chief', displayName: '管理员', password: 'announcement-test-password', adminKey: e.cfg.adminKey } });
  assert.equal(result.status, 201);
  const cookie = result.headers.get('set-cookie').split(';')[0];
  return (path, body, method = body === undefined ? 'GET' : 'POST') => e.call(path, { method, body, headers: { Cookie: cookie, 'X-Houren-Request': '1' } });
}
const payload = (title = '维护通知', body = '第一行\n<script>纯文字</script>') => ({ title, body });

test('公告在登录门开启时对游客公开，写入仅接受管理员会话', async () => {
  const e = await boot({ requireLogin: true });
  try {
    assert.equal((await e.call('/api/announcements')).status, 200);
    assert.equal((await e.call('/api/announcements/latest')).json.announcement, null);
    assert.equal((await e.call('/api/admin/announcements')).status, 401);
    assert.equal((await e.call('/api/admin/announcements', { admin: true })).status, 401);
    const write = await admin(e);
    assert.equal((await e.call('/api/admin/announcements', { method: 'POST', body: payload() })).status, 403);
    const created = await write('/api/admin/announcements', payload());
    assert.equal(created.status, 201);
    const id = created.json.announcement.id;
    const publicItem = (await e.call('/api/announcements/' + id)).json.announcement;
    assert.equal(publicItem.body, payload().body);
    assert.ok(!('history' in publicItem)); assert.ok(!('authorId' in publicItem));
    assert.equal((await e.call('/api/announcements/latest')).json.announcement.id, id);
    const list = await e.call('/api/announcements');
    assert.equal(list.headers.get('cache-control'), 'no-store');
    assert.equal(list.json.announcements.length, 1);
    assert.equal(list.json.announcements[0].body, undefined, '列表不下载全部长正文');
    const guest = await e.call('/api/account/register', { method: 'POST', body: await verifiedBody(e, { username: 'reader', displayName: '读者', password: 'announcement-test-password' }), headers: { 'X-Houren-Request': '1' } });
    const cookie = guest.headers.get('set-cookie').split(';')[0];
    assert.equal((await e.call('/api/admin/announcements', { headers: { Cookie: cookie } })).status, 403);
    assert.equal((await e.call('/announcements.html')).status, 200);
    assert.equal((await e.call('/api/public/state')).status, 401, '城市登录门保持生效');
  } finally { await e.close(); }
});

test('编辑不改排序，撤下隐藏旧详情和最新提示，重发回到最前；记录每个操作', async () => {
  const e = await boot();
  try {
    const write = await admin(e);
    const a = (await write('/api/admin/announcements', payload('旧公告'))).json.announcement;
    const b = (await write('/api/admin/announcements', payload('新公告'))).json.announcement;
    const edit = await write('/api/admin/announcements/' + a.id, { ...payload('旧公告改版'), revision: a.revision }, 'PATCH');
    assert.equal(edit.status, 200); assert.ok(edit.json.announcement.editedAt);
    assert.equal(edit.json.announcement.publishedAt, a.publishedAt);
    assert.deepEqual((await e.call('/api/announcements')).json.announcements.map(x => x.id), [b.id, a.id]);
    assert.equal((await write('/api/admin/announcements/' + a.id, { ...payload(), revision: a.revision }, 'PATCH')).status, 409);
    assert.equal((await write('/api/admin/announcements/' + b.id + '/withdraw', { revision: b.revision })).status, 200);
    assert.equal((await e.call('/api/announcements/' + b.id)).status, 404);
    assert.equal((await e.call('/api/announcements/latest')).json.announcement.id, a.id);
    const republished = await write('/api/admin/announcements/' + b.id + '/publish', { revision: b.revision + 1 });
    assert.equal(republished.status, 200);
    assert.equal((await e.call('/api/announcements/latest')).json.announcement.id, b.id);
    assert.deepEqual(republished.json.announcement.history.map(x => x.action), ['publish', 'withdraw', 'publish']);
    assert.ok(republished.json.announcement.history.every(x => x.actorId && x.displayName === '管理员' && Number.isFinite(Date.parse(x.at))));
  } finally { await e.close(); }
});

test('Unicode 边界允许 10,000 字正文，拒绝空内容、超长内容和草稿状态', async () => {
  const e = await boot();
  try {
    const write = await admin(e);
    for (const body of [payload(''), payload('字'.repeat(101)), payload('标题', ''), payload('标题', '🌙'.repeat(10001)), { ...payload(), status: 'draft' }]) assert.equal((await write('/api/admin/announcements', body)).status, 400);
    const r = await write('/api/admin/announcements', payload('🌙'.repeat(100), '🌙'.repeat(10000)));
    assert.equal(r.status, 201, r.text);
    assert.equal([...r.json.announcement.body].length, 10000);
    assert.equal((await e.call('/api/announcements?cursor=bad')).status, 400);
  } finally { await e.close(); }
});

test('分页无重复，编辑不影响游标，独立保存并在重启和更换世界后保留', async () => {
  let e = await boot(); const dir = e.dir;
  try {
    const write = await admin(e);
    const world = JSON.stringify(e.rt.w);
    for (let n = 0; n < 23; n++) assert.equal((await write('/api/admin/announcements', payload('公告 ' + n))).status, 201);
    assert.equal(JSON.stringify(e.rt.w), world, '公告不改写世界或居民认知');
    const first = (await e.call('/api/announcements')).json;
    assert.equal(first.announcements.length, 20); assert.ok(first.nextCursor);
    const last = (await e.call('/api/announcements?cursor=' + first.nextCursor)).json;
    assert.equal(last.announcements.length, 3);
    assert.equal(new Set([...first.announcements, ...last.announcements].map(x => x.id)).size, 23);
    const file = join(dir, 'announcements.json');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).entries.length, 23);
    await e.close({ keepDir: true });
    e = await boot({ worldId: 'another-era' }, { dir });
    assert.equal((await e.call('/api/announcements')).json.total, 23);
    const { AnnouncementStore } = await import('../src/announcements.js');
    const store = new AnnouncementStore(dir), old = structuredClone(store.data);
    mkdirSync(file + '.tmp');
    assert.throws(() => store.create({ id: 'admin', role: 'admin', displayName: '管理员' }, payload()));
    assert.deepEqual(store.data, old, '写入失败不发布内存中的公告');
    rmSync(file + '.tmp', { recursive: true });
  } finally { await e.close(); }
});

test('其他管理员可管理公告，身份撤销与跨站写入立即拒绝，私有历史不进入公开读取', async () => {
  const e = await boot();
  try {
    const write = await admin(e), a = (await write('/api/admin/announcements', payload())).json.announcement;
    const second = await e.app.ctx.accounts.create({ username: 'editor', displayName: '值班管理员', password: 'announcement-test-password' }, { role: 'admin' });
    const cookie = 'houren_session=' + e.app.ctx.accounts.issue(second.id);
    const call = (extra = {}) => e.call('/api/admin/announcements/' + a.id, { method: 'PATCH', body: { ...payload('其他管理员编辑'), revision: a.revision }, headers: { Cookie: cookie, 'X-Houren-Request': '1', ...extra } });
    assert.equal((await call({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    const r = await call(); assert.equal(r.status, 200);
    assert.equal(r.json.announcement.history.at(-1).actorId, second.id);
    assert.ok(!JSON.stringify((await e.call('/api/announcements/' + a.id)).json).includes(second.id));
    await write('/api/admin/users/' + second.id, { role: 'user' }, 'PATCH');
    assert.equal((await call()).status, 401, '角色撤销结束旧管理员会话');
    const snapshot = await write('/api/admin/snapshots', {});
    assert.equal(snapshot.status, 201);
    const { gunzipSync } = await import('node:zlib');
    const archive = JSON.parse(gunzipSync(readFileSync(join(e.rt.dir, 'snapshots', snapshot.json.snapshot.id, 'archive.json.gz'))));
    assert.ok(!Object.keys(archive.files).some(name => name.includes('announcement')));
    assert.equal((await e.call('/api/announcements')).json.total, 1);
  } finally { await e.close(); }
});
