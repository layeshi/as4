import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from './http-helpers.js';
import { identityHash } from '../src/wechat/service.js';
const appid = 'wx1234567890abcdef', templateId = 'template-1234567890';
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'notification-http-')), file = join(dir, 'physics.json');
  writeFileSync(file, JSON.stringify({ version: 1, regrowth: { baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 }, thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 }, factorPermille: 500 }, construction: { fullActionsPerTick: 2, factorPermille: 500 } }));
  const e = await boot({ physics: 2, premise: 6, map: 'compact-materials-v1', shellSlots: 0, hiddenPhysicsFile: file, wechatAppId: appid, wechatAppSecret: 'test-only', wechatNotificationTemplates: { diary: { appid, templateId, fields: { thing1: 'name', thing2: 'kind', time3: 'time' } } } }, { dir });
  t.after(() => e.close());
  const ctx = e.app.ctx, identity = { appid, openid: 'private-openid-12345', verifiedAt: Date.now() };
  const user = await ctx.accounts.wechatLogin(identityHash(appid, identity.openid), { appid });
  const cookie = `houren_session=${ctx.accounts.issue(user.id, { wechat: identity })}`;
  const headers = { Cookie: cookie, 'X-Houren-Request': '1' };
  const created = e.rt.exec('account', { op: 'create', accountId: user.id, name: '提醒居民', requestId: 'notice-create-1', lang: 'zh', soul: '观察城市', model: '待配置', dailyCap: 1000000 });
  assert.equal(created.result.ok, true);
  return { ...e, ctx, user, identity, headers, id: created.result.agentId, post: (path, body) => e.call(path, { method: 'POST', headers, body }) };
}
test('HTTP routes enforce login, CSRF, ownership and actual committed private diary delivery', async t => {
  const e = await setup(t);
  assert.equal((await e.call('/api/wechat/notifications')).status, 401);
  assert.equal((await e.call('/api/wechat/notifications/preferences', { method: 'POST', headers: { Cookie: e.headers.Cookie }, body: {} })).status, 403);
  assert.equal((await e.post('/api/wechat/notifications/preferences', { appid, agentId: 'not-owned', types: ['diary'] })).status, 403);
  assert.equal((await e.post('/api/wechat/notifications/preferences', { appid, agentId: e.id, types: ['diary'] })).status, 200);
  const settings = await e.call(`/api/wechat/notifications?appid=${appid}`, { headers: e.headers });
  assert.equal(settings.json.bindingReady, true); assert.equal(settings.json.needsAuthorization, true);
  assert.deepEqual(settings.json.residents, [{ agentId: e.id, types: ['diary'] }]);
  const auth = await e.post('/api/wechat/notifications/authorization', { appid, types: ['diary'] });
  assert.deepEqual(auth.json.templates, [templateId]);
  assert.equal((await e.post('/api/wechat/notifications/authorization/result', { ticket: auth.json.ticket, results: { [templateId]: 'accept' } })).status, 200);
  assert.equal(e.rt.exec('meter', { op: 'wake', agentId: e.id, wakeId: 'notice-wake-1', day: '2026-10-18', kind: 'main', system: 0, brief: 0, delivered: 0 }).result.ok, true);
  const diary = e.rt.exec('act', { agentId: e.id, requestId: 'notice-diary-1', experimentGeneration: 0, meter: { wakeId: 'notice-wake-1', day: '2026-10-18', reread: 0 }, actions: [{ type: 'diary', text: '不得出现在微信预览的私人日记' }] });
  assert.ok(diary.events.some(e => e.type === 'diary'), JSON.stringify(diary.result));
  const list = await e.call('/api/wechat/notifications/records', { headers: e.headers });
  assert.equal(list.status, 200); assert.equal(list.json.records.length, 1);
  assert.equal(list.json.records[0].kind, 'diary'); assert.ok(!list.text.includes('私人日记'));
  assert.equal((await e.post('/api/wechat/notifications/records/read', { ids: [list.json.records[0].id] })).status, 200);
  assert.ok((await e.call('/api/wechat/notifications/records', { headers: e.headers })).json.records[0].readAt);
  const other = await e.ctx.accounts.create({ username: 'outsider', password: 'strong-pass-test123' });
  const otherHeaders = { Cookie: `houren_session=${e.ctx.accounts.issue(other.id)}` };
  assert.deepEqual((await e.call('/api/wechat/notifications/records', { headers: otherHeaders })).json.records, []);
  e.ctx.notifications.now = () => list.json.records[0].createdAt + 86400000; // Too late: do not send stale summary.
  await e.ctx.notifications.pump();
  assert.equal(e.ctx.notifications.records(e.user.id).records[0].delivery, 'unavailable');
});
test('ordinary logout preserves subscription; account disabled clears pending and binding', async t => {
  const e = await setup(t);
  await e.post('/api/wechat/notifications/preferences', { appid, agentId: e.id, types: ['diary'] });
  assert.equal((await e.post('/api/account/logout', {})).status, 200);
  assert.deepEqual(e.ctx.notifications.get(e.user.id, appid).residents[0].types, ['diary']);
  e.ctx.accounts.commit(users => { users.find(u => u.id === e.user.id).status = 'disabled'; });
  await e.ctx.notifications.pump();
  assert.deepEqual(e.ctx.notifications.get(e.user.id, appid).residents, []);
  assert.equal(e.ctx.notifications.get(e.user.id, appid).bindingReady, false);
});
