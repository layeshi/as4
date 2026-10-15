import test from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { boot } from './http-helpers.js';

test('report and history APIs require sessions and export downloads recheck ownership', async t => {
  const env = await boot(); t.after(() => env.close());
  for (const path of ['/api/reports', '/api/history/branches', '/api/history/exports']) assert.equal((await env.call(path)).status, 401, path);
  const user = await env.app.ctx.accounts.create({ username: 'history_owner', password: 'history-password', displayName: '历史造者' });
  const other = await env.app.ctx.accounts.create({ username: 'history_other', password: 'history-password', displayName: '另一个用户' });
  const cookie = `houren_session=${env.app.ctx.accounts.issue(user.id)}`, otherCookie = `houren_session=${env.app.ctx.accounts.issue(other.id)}`;
  const resident = await env.register('档案居民');
  env.app.ctx.accounts.linkAgent(user.id, { world: env.rt.w.id, agentId: resident.agentId, token: env.rt.w.agents[resident.agentId].tokenHash });
  const headers = { Cookie: cookie, 'X-Houren-Request': '1' };
  assert.equal((await env.call('/api/reports', { headers })).status, 200);
  assert.equal((await env.call('/api/admin/reports', { headers })).status, 403);
  assert.equal((await env.call('/api/history/exports', { method: 'POST', headers: { Cookie: cookie }, body: { agentId: resident.agentId } })).status, 403);
  const response = await env.call('/api/history/exports', { method: 'POST', headers, body: { agentId: resident.agentId, requestId: 'history-http' } });
  assert.equal(response.status, 202, response.text);
  await env.app.ctx.historyExports.idle();
  const path = `/api/history/exports/${response.json.id}/download`;
  const download = await fetch(env.base + path, { headers: { Cookie: cookie } });
  assert.equal(download.status, 200); assert.equal(download.headers.get('Content-Type'), 'application/zip');
  assert.equal(Buffer.from(await download.arrayBuffer()).readUInt32LE(0), 0x04034b50);
  assert.equal((await env.call(path, { headers: { Cookie: otherCookie } })).status, 403);
  unlinkSync(join(env.app.ctx.history.root, `${response.json.id}.zip`));
  assert.equal((await env.call(path, { headers })).status, 409);
  assert.equal((await env.call('/api/history/exports', { headers })).json.exports[0].status, 'failed');
  assert.equal((await env.call(`/api/history/exports/${response.json.id}/retry`, { method: 'POST', headers, body: {} })).status, 202);
  await env.app.ctx.historyExports.idle();
  assert.equal((await fetch(env.base + path, { headers })).status, 200);
  env.rt.w.agents[resident.agentId].tokenHash = 'changed-after-transfer';
  assert.equal((await env.call(path, { headers })).status, 403);
});

test('report configuration rejects invalid providers and never returns model credentials', async t => {
  const env = await boot(); t.after(() => env.close());
  const admin = await env.app.ctx.accounts.create({ username: 'report_admin', password: 'history-password' }, { role: 'admin' });
  const headers = { Cookie: `houren_session=${env.app.ctx.accounts.issue(admin.id)}`, 'X-Houren-Request': '1' };
  const bad = await env.call('/api/admin/reports/config', { method: 'POST', headers, body: { provider: 'invalid', model: 'bad' } });
  assert.equal(bad.status, 400);
  const good = await env.call('/api/admin/reports/config', { method: 'POST', headers, body: { provider: 'openai', baseURL: 'https://api.openai.com/v1', model: 'test-model', apiKey: 'TEST-ONLY-SECRET-KEY', dailyLimit: 0 } });
  assert.equal(good.status, 200); assert.ok(!good.text.includes('TEST-ONLY-SECRET-KEY')); assert.equal(good.json.config.hasApiKey, true);
  assert.ok(!(await env.call('/api/admin/reports', { headers })).text.includes('TEST-ONLY-SECRET-KEY'));
});
