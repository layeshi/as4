import test from 'node:test';
import assert from 'node:assert/strict';
import { minigame } from './wechat-minigame-helpers.js';

test('WeChat report and export screens use shared Canvas components with login and empty states', () => {
  const m = minigame(), screens = m.load(new URL('../wechat/minigame/screens/index.js', import.meta.url).pathname);
  m.game.render();
  for (const name of ['reports', 'worldReport', 'historyExport', 'exports']) {
    assert.equal(typeof screens[name], 'function', name);
    const page = screens[name](m.game, 343); assert.equal(page.top.kind, 'back'); assert.ok(page.nodes.length);
    for (const node of page.nodes) assert.ok(Number.isFinite(node.height) && node.height >= 0);
  }
});

test('switching accounts clears private export state', () => {
  const m = minigame(); assert.ok(m.game.history);
  m.game.user = { id: 'alice' }; m.game.history.sync(); m.game.history.jobs = [{ name: '私密居民' }];
  m.game.user = { id: 'bob' }; m.game.history.sync(); assert.equal(m.game.history.jobs.length, 0);
});

test('requesting a new WeChat export after success creates a fresh history snapshot', async () => {
  const m = minigame(), requests = [];
  m.wx.request = options => { if (options.url.endsWith('/api/history/exports')) requests.push(options.data.requestId); options.success({ statusCode: 202, data: { id: 'created' } }); };
  const h = m.game.history; m.game.user = { id: 'alice' }; h.sync(); h.branchId = 'branch'; h.agentId = 'resident';
  h.refresh = async () => {}; m.game.push = tab => { m.game.tab = tab; };
  await h.handle({ type: 'historyCreate' }); await h.handle({ type: 'historyCreate' });
  assert.equal(requests.length, 2); assert.notEqual(requests[0], requests[1]);
});

test('WeChat downloads use session headers and reject a callback after logout', async () => {
  const m = minigame(), api = m.load(new URL('../wechat/minigame/utils/api.js', import.meta.url).pathname);
  m.wx.request = options => options.success({ statusCode: 200, data: {}, cookies: ['houren_session=history-session-abcdefghijklmnop'] });
  const login = api.request('/api/wechat/login', { method: 'POST', data: {} });
  await login;
  let download; m.wx.downloadFile = request => { download = request; };
  const request = api.download('/api/history/exports/example/download');
  assert.ok(download.header.Cookie.includes('houren_session=')); assert.ok(!download.url.includes('history-session'));
  api.clearSession(); download.success({ statusCode: 200, tempFilePath: '/tmp/history.zip' });
  await assert.rejects(request, /登录会话已变更/);
});
