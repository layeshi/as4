// 实验助手与模型操作已从微信客户端移除：模块不存在、旧动作与深链被拒绝、接口层不发请求、构建包里没有实现。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minigame } from './wechat-minigame-helpers.js';
import { syncMiniprogram, observationSharedText } from '../wechat/scripts/miniprogram.mjs';

const wechat = fileURLToPath(new URL('../wechat/', import.meta.url));
const REJECTED = /小程序仅提供观测与已有记录查询，此操作不可用。/;
const REMOVED_MODULES = ['assistant.js', 'stewardship.js', 'screens/assistant.js', 'screens/stewardship.js', 'ui/answer.js', 'utils/model-presets.js'];
const ASSISTANT_ACTIONS = ['assistantOpen', 'assistantRefresh', 'assistantSession', 'assistantList', 'assistantNew', 'assistantAsk', 'assistantRetry', 'assistantCancel', 'assistantDelete', 'assistantSource', 'assistantCloseSource', 'assistantScope', 'assistantResetScope'];
const MANAGEMENT_ACTIONS = ['entry', 'create', 'createCity', 'createLang', 'letter', 'runner', 'disconnect', 'provider', 'preset', 'modelChoice', 'modelTest', 'modelSave', 'stewardTab', 'stewardCap', 'stewardTransfer', 'stewardCancelTransfer', 'stewardAcceptOpen', 'stewardAccept', 'stewardAdoptOpen', 'stewardAdopt', 'stewardRemoveRunner', 'stewardAvatarReset', 'stewardModelSource', 'stewardHostedModel', 'stewardBilling', 'stewardCancelRequest', 'stewardImportOpen', 'stewardImportTake'];

function files(dir) {
  return readdirSync(dir).flatMap(name => statSync(join(dir, name)).isDirectory() ? files(join(dir, name)).map(f => name + '/' + f) : [name]);
}

test('assistant, management and model modules are deleted from the shared client', () => {
  for (const name of REMOVED_MODULES) assert.equal(existsSync(join(wechat, 'minigame', name)), false, name);
  const { game: g } = minigame();
  for (const key of ['assistant', 'steward', 'modelPresets']) assert.equal(g[key], undefined, key);
  for (const method of ['configureRunner', 'enter', 'selectPreset', 'loadModelPresets']) assert.equal(typeof g[method], 'undefined', method);
});

test('every old assistant and management action is rejected without any request', async () => {
  const m = minigame({ respond: () => ({ signedIn: true, conversation: { id: 'c', messages: [] } }) }), g = m.game;
  g.entered = true; g.user = { id: 'alice', role: 'admin' }; g.wechatVerified = true; g.residentId = 'a1'; g.tab = 'account';
  Object.assign(g.form, { assistantText: '一个问题', assistantAdminKey: 'admin-secret', apiKey: 'sk-secret', letter: '家书', name: 'n', soul: 's', entryAccepted: true, modelAccepted: true, adoptAccepted: true });
  for (const type of [...ASSISTANT_ACTIONS, ...MANAGEMENT_ACTIONS]) {
    g.error = '';
    await g.dispatch({ type, id: 'x', agentId: 'a1', lawId: 'l1', op: 'start', tab: 'manage', kind: 'new', source: 'hosted' });
    assert.match(g.error, REJECTED, type);
    assert.notEqual(g.tab, 'assistant', type);
  }
  assert.deepEqual(m.requests, [], 'nothing reached the network');
  assert.equal(g.busy, false);
});

test('the API layer refuses assistant routes for every method and never sends admin or owner keys', async () => {
  const m = minigame(), api = m.load(new URL('../wechat/minigame/utils/api.js', import.meta.url).pathname);
  const sent = []; m.wx.request = options => { sent.push(options); options.success({ statusCode: 200, data: {} }); };
  for (const [path, method] of [['/api/assistant/status', 'GET'], ['/api/assistant/questions', 'POST'], ['/api/assistant/conversations/c', 'GET'], ['/api/assistant/conversations/c', 'DELETE'], ['/api/assistant/questions/q/cancel', 'POST'], ['/api/wechat/model-presets', 'GET'], ['/api/port/model', 'GET'], ['/api/admin/users', 'GET'], ['/api/owner/state', 'GET'], ['/api/me', 'GET']]) {
    await assert.rejects(api.request(path, { method, data: {} }), error => error.status === 403 && error.code === 'wechat_observation_only' && REJECTED.test(error.message), method + ' ' + path);
  }
  assert.equal(sent.length, 0);
  await api.request('/api/wechat/status', { assistantAdminKey: 'admin-secret', assistantOwnerKey: 'owner-secret', ownerKey: 'owner-token' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].header['X-Admin-Key'], undefined); assert.equal(sent[0].header['X-Owner-Key'], undefined); assert.equal(sent[0].header.Authorization, undefined);
  assert.equal(sent[0].header['X-Houren-Client'], 'wechat');
});

test('client writes are limited to account identity, reminders and existing-history packaging', async () => {
  const m = minigame(), api = m.load(new URL('../wechat/minigame/utils/api.js', import.meta.url).pathname);
  const sent = []; m.wx.request = options => { sent.push(options.method + ' ' + new URL(options.url).pathname); options.success({ statusCode: 200, data: {} }); };
  for (const [path, method] of [
    ['/api/account/residents', 'POST'], ['/api/account/residents/a1/letter', 'POST'], ['/api/account/residents/a1/runner', 'POST'], ['/api/account/residents/a1/cap', 'POST'],
    ['/api/account/residents/a1/transfer', 'POST'], ['/api/account/residents/adopt', 'POST'], ['/api/account/residents/a1/avatar', 'DELETE'], ['/api/account/transfers/t1/accept', 'POST'],
    ['/api/account/hosted/requests/r1/cancel', 'POST'], ['/api/messages', 'POST'], ['/api/messages/m1', 'PATCH'], ['/api/messages/m1', 'DELETE'], ['/api/account', 'DELETE'], ['/api/account/residents/a1', 'PUT'],
  ]) await assert.rejects(api.request(path, { method, data: {} }), error => error.code === 'wechat_observation_only', method + ' ' + path);
  assert.deepEqual(sent, []);
  for (const [path, method] of [
    ['/api/account/logout', 'POST'], ['/api/account/verification/request', 'POST'], ['/api/account/verification/confirm', 'POST'], ['/api/account/contacts', 'POST'], ['/api/account/contacts/email', 'DELETE'],
    ['/api/account', 'PATCH'], ['/api/account/wechat/wx216f3fb724629f67', 'DELETE'], ['/api/wechat/merge/confirm', 'POST'], ['/api/wechat/qr/scan', 'POST'], ['/api/wechat/qr/confirm', 'POST'],
    ['/api/wechat/notifications/preferences', 'POST'], ['/api/wechat/notifications/authorization', 'POST'], ['/api/wechat/notifications/authorization/result', 'POST'], ['/api/wechat/notifications/records/read', 'POST'],
    ['/api/history/exports', 'POST'], ['/api/history/exports/0b1c2d3e-aaaa-bbbb/retry', 'POST'],
  ]) await api.request(path, { method, data: {} });
  assert.equal(sent.length, 16);
});

test('launch queries cannot open the assistant or management; a resident reminder opens read-only records', async () => {
  const m = minigame({ respond: path => path === '/api/account' ? { user: { id: 'u1' } } : path.startsWith('/api/wechat/status') ? { verified: true, enabled: true, linked: true } : path === '/api/wechat/residents' ? { managed: [{ agentId: 'a1', name: '石序' }], created: [] } : path === '/api/wechat/residents/a1' ? { resident: { name: '石序' }, overview: { energy: 1 } } : path === '/api/wechat/residents/a1/private' ? { diary: [] } : path.startsWith('/api/wechat/notifications') ? { records: [] } : {} }), g = m.game;
  for (const query of [{ assistant: '1' }, { page: 'assistant' }, { agentId: '../assistant' }, { notification: 'x?y' }]) assert.equal(g.setLaunch(query), false, JSON.stringify(query));
  assert.equal(g.setLaunch({ agentId: 'a1' }), true);
  await g.start(); await g.dispatch({ type: 'start' });
  assert.equal(g.tab, 'owner'); assert.equal(g.residentId, 'a1');
  g.invalidate(); g.render();
  assert.equal(g.page.top.title, '居民记录');
  assert.ok(!g.hits.some(h => /^(?:assistant|steward|letter|runner|model|entry|create)/.test(h.action.type)));
  assert.ok(!m.requests.some(path => /assistant|model-presets|\/runner|\/letter/.test(path)), m.requests.join('\n'));
  g.tab = 'assistant'; g.invalidate(); g.render();
  assert.notEqual(g.page.top.title, '实验助手', 'a stale page id falls back to an observation screen');
});

test('the Mini Program runtime package contains no assistant parser or model catalog and still describes events', async () => {
  await syncMiniprogram(wechat);
  const runtime = join(wechat, 'miniprogram-app', 'runtime'), listed = files(runtime);
  for (const name of [...REMOVED_MODULES, 'utils/answer-markdown.js']) assert.ok(!listed.includes(name), name);
  const shared = readFileSync(join(runtime, 'utils', 'shared-text.js'), 'utf8');
  assert.ok(!shared.includes('MODEL_PRESETS')); assert.ok(!/api\.deepseek|bigmodel|anthropic/i.test(shared));
  for (const name of listed.filter(name => name.endsWith('.js'))) {
    const text = readFileSync(join(runtime, name), 'utf8');
    assert.ok(!/['"]\/api\/assistant\//.test(text), name + ' calls an assistant route');
    assert.ok(!/parseAnswer|X-Admin-Key|X-Owner-Key/.test(text), name);
  }
  const m = minigame(), { describe } = m.load(join(runtime, 'utils', 'shared-text.js'));
  assert.equal(typeof describe, 'function');
  assert.throws(() => observationSharedText('module.exports = {};'), /格式已变/);
});
