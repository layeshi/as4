import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotificationService, diaryDeadline } from '../src/wechat/notifications.js';
import { notificationTemplates } from '../src/wechat/notification-config.js';
import { identityHash, WechatService } from '../src/wechat/service.js';
const appid = 'wx1234567890abcdef', openid = 'secret-openid-test123', templateId = 'template-1234567890';
const identity = { appid, openid, verifiedAt: Date.now() };
function setup(t, { configured = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'resident-notifications-'));
  let now = Date.parse('2026-10-18T11:59:00Z');
  const user = { id: 'u', status: 'active', wechatIdentity: identityHash(appid, openid) };
  const listeners = new Set(), sent = [], runner = { status: 'waiting' };
  const service = { enabled: true, async accessToken() { return 'token'; }, async sendSubscription(payload) { sent.push(payload); return { errcode: 0 }; } };
  const ctx = {
    cfg: { dataDir: dir, wechatNotificationTemplates: configured ? Object.fromEntries(['death','diary','runner_stopped','balance_low'].map(k => [k, { appid, templateId, fields: { thing1: 'name', thing2: 'kind', time3: 'time' } }])) : {} },
    rt: { w: { id: 'world', counters: { event: 0 }, agents: { a: { name: '居民甲' } }, access: { residents: { a: { managerAccountId: 'u', ownershipRevision: 1 } } } }, events: {}, onCommand(fn) { listeners.add(fn); return () => listeners.delete(fn); } },
    accounts: { get(id) { return id === user.id ? user : null; } },
    wechat: { forApp(id) { if (id !== appid) throw Error('app'); return service; }, requireIdentity() {} },
    runners: { records: { a: { enabled: true } }, view() { return runner; } },
  };
  let n = new NotificationService(ctx, { now: () => now });
  t.after(async () => { await n.close(); rmSync(dir, { recursive: true, force: true }); });
  return { ctx, user, sent, service, runner, get n() { return n; }, setNow(v) { now = v; }, advance(v) { now += v; }, now: () => now,
    enable(types = ['death','diary','runner_stopped','balance_low']) { n.preferences('u', appid, 'a', types, identity); },
    grant() { const { ticket } = n.authorization('u', appid, ['death'], identity); n.authorizationResult('u', ticket, { [templateId]: 'accept' }); return ticket; },
    event(type) { const event = { seq: ++ctx.rt.w.counters.event, type, agent: 'a', data: { text: 'private diary body' } }; for (const fn of listeners) fn({ events: [event] }); return event; },
    async restart() { await n.close(); n = new NotificationService(ctx, { now: () => now }); return n; },
  };
}
test('default off, ownership enforced, private bodies and OpenID never appear in API or plaintext storage', async t => {
  const e = setup(t); e.event('diary'); assert.equal(e.n.records('u').records.length, 0);
  assert.throws(() => e.n.preferences('other', appid, 'a', ['death']), x => x.status === 403);
  e.enable(); e.event('diary');
  const file = readFileSync(e.n.file, 'utf8');
  assert.ok(!file.includes(openid)); assert.ok(!file.includes('private diary body'));
  assert.equal(statSync(e.n.file).mode & 0o777, 0o600);
  assert.equal(statSync(e.n.keyFile).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(e.n.records('u')).includes('private diary body'));
  assert.ok(!JSON.stringify(e.n.get('u', appid)).includes(openid));
  await e.restart(); assert.equal(e.n.records('u').records.length, 1);
});
test('single-use authorization and one credit for shared template, no replay after replenishing', async t => {
  const e = setup(t); e.enable(); const ticket = e.grant();
  assert.throws(() => e.n.authorizationResult('u', ticket, { [templateId]: 'accept' }), x => x.code === 'invalid_ticket');
  e.event('death'); await e.n.pump(); assert.equal(e.sent.length, 1);
  assert.deepEqual(Object.keys(e.sent[0].data), ['thing1','thing2','time3']);
  assert.ok(!JSON.stringify(e.sent[0]).includes('private diary body'));
  e.runner.status = 'hosted_balance_low'; e.n.runnerChanged('a'); await e.n.pump();
  assert.equal(e.n.records('u').records[0].delivery, 'unavailable');
  e.grant(); await e.n.pump(); assert.equal(e.sent.length, 1);
});
test('20:00 Shanghai boundary, multiple diaries coalesce and next-day window is independent', async t => {
  const e = setup(t); e.enable(['diary']); e.grant();
  const boundary = Date.parse('2026-10-18T12:00:00Z');
  assert.equal(diaryDeadline(boundary - 1), boundary);
  assert.equal(diaryDeadline(boundary), boundary + 86400000);
  e.event('diary'); e.event('diary'); await e.n.pump(); assert.equal(e.sent.length, 0);
  e.setNow(boundary); await e.n.pump(); assert.equal(e.sent.length, 1);
  assert.equal(e.n.records('u').records[0].count, 2);
  e.event('diary'); e.grant(); await e.n.pump(); assert.equal(e.sent.length, 1);
  e.advance(86400000); await e.n.pump(); assert.equal(e.sent.length, 2);
});
test('disable/re-enable discards pending and events while disabled', async t => {
  const e = setup(t); e.enable(); e.grant(); e.event('death');
  e.enable([]); e.event('diary'); e.enable(['diary']); await e.n.pump();
  assert.equal(e.sent.length, 0); assert.equal(e.n.records('u').records.length, 1);
  assert.equal(e.n.records('u').records[0].delivery, 'cancelled');
});
test('transfer away and back cannot resurrect subscriptions or expose old notification details', async t => {
  const e = setup(t); e.enable(); e.grant(); e.event('death');
  e.ctx.rt.w.access.residents.a = { managerAccountId: 'other', ownershipRevision: 2 };
  await e.n.pump(); assert.equal(e.sent.length, 0); assert.equal(e.n.records('u').records.length, 0);
  e.ctx.rt.w.access.residents.a = { managerAccountId: 'u', ownershipRevision: 3 };
  assert.deepEqual(e.n.get('u', appid).residents, []);
  assert.equal(e.n.records('u').records.length, 0);
});
test('revalidate after asynchronous token retrieval, revoked binding cancels queued sends', async t => {
  const e = setup(t); e.enable(); e.grant(); e.event('death');
  e.service.accessToken = async () => { e.user.wechatIdentity = null; return 'token'; };
  await e.n.pump(); assert.equal(e.sent.length, 0);
  assert.equal(e.n.records('u').records[0].delivery, 'cancelled');
  assert.equal(e.n.get('u', appid).bindingReady, false);
});
test('transient errors, paused and caps excluded; persistent fault only once until recovery', async t => {
  const e = setup(t); e.enable();
  for (const status of ['error','paused','experiment_paused','cap_reached','tokens_exhausted']) { e.runner.status = status; e.n.runnerChanged('a'); }
  assert.equal(e.n.records('u').records.length, 0);
  e.runner.status = 'hosted_balance_low'; e.n.runnerChanged('a'); e.n.runnerChanged('a');
  assert.equal(e.n.records('u').records.length, 1);
  await e.restart(); e.n.runnerChanged('a'); assert.equal(e.n.records('u').records.length, 1);
  e.runner.status = 'waiting'; e.n.runnerChanged('a', { recovered: true });
  e.runner.status = 'hosted_balance_low'; e.n.runnerChanged('a'); assert.equal(e.n.records('u').records.length, 2);
  e.ctx.runners.records.a.enabled = false; e.runner.status = 'error'; e.n.runnerChanged('a');
  assert.equal(e.n.records('u').records[0].kind, 'runner_stopped');
});
test('subscribing while already in a fault does not push a pre-subscription incident', t => {
  const e = setup(t); e.runner.status = 'hosted_balance_low'; e.enable(); e.n.runnerChanged('a'); assert.equal(e.n.records('u').records.length, 0);
});
test('no template permits inbox but no send; retention clears only reminder data and read flags persist', async t => {
  const e = setup(t, { configured: false }); e.enable(); e.event('diary');
  const id = e.n.records('u').records[0].id; e.n.read('u', [id]);
  await e.restart(); assert.ok(e.n.records('u').records[0].readAt);
  e.advance(60000); await e.n.pump(); assert.equal(e.sent.length, 0);
  assert.equal(e.n.records('u').records[0].delivery, 'unavailable');
  e.advance(90 * 86400000); assert.equal(e.n.records('u').records.length, 0); assert.ok(e.ctx.rt.w.agents.a);
});
test('ambiguous send is never retried, including restart', async t => {
  const e = setup(t); e.enable(); e.grant(); let calls = 0;
  e.service.sendSubscription = async () => { calls++; throw Error('timeout'); };
  e.event('death'); await e.n.pump(); await e.restart(); await e.n.pump();
  assert.equal(calls, 1); assert.equal(e.n.records('u').records[0].delivery, 'unknown');
});
test('persisted sending attempt becomes unknown on crash recovery', async t => {
  const e = setup(t); e.enable(); e.grant(); e.event('death');
  e.n.state.records[0].delivery = 'sending'; e.n.persist();
  await e.restart(); await e.n.pump(); assert.equal(e.sent.length, 0); assert.equal(e.n.records('u').records[0].delivery, 'unknown');
});
test('missed event recovery creates inbox record without old push; repeated recovery deduplicates', async t => {
  const e = setup(t); e.enable(); e.grant();
  const event = { seq: ++e.ctx.rt.w.counters.event, type: 'death', agent: 'a' };
  e.ctx.rt.events.file = join(e.ctx.cfg.dataDir, 'events.jsonl'); writeFileSync(e.ctx.rt.events.file, JSON.stringify(event) + '\n');
  await e.restart(); await e.n.start(); assert.equal(e.n.records('u').records.length, 1); assert.equal(e.sent.length, 0);
  await e.restart(); await e.n.start(); assert.equal(e.n.records('u').records.length, 1);
});
test('configuration refuses unrelated fields, malformed template, and invalid app', () => {
  assert.throws(() => notificationTemplates({ death: { appid, templateId, fields: { thing1: 'balance' } } }));
  assert.throws(() => notificationTemplates('{'));
});
test('official adapter uses POST and strips upstream diagnostic text', async () => {
  let request;
  const svc = new WechatService({ wechatAppId: appid, wechatAppSecret: 'secret' }, { fetcher: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ errcode: 43101, errmsg: 'contains sensitive data' }) }; } });
  const result = await svc.sendSubscription({ token: 'access', openid, templateId, data: { thing1: { value: '居民' } }, page: 'pages/society/index', state: 'trial' });
  assert.deepEqual(result, { errcode: 43101 }); assert.equal(request.options.method, 'POST');
  assert.equal(request.url.pathname, '/cgi-bin/message/subscribe/send');
  assert.equal(JSON.parse(request.options.body).miniprogram_state, 'trial');
});

test('inbox preferences and prepared/rejected authorization do not persist OpenID; accept does', async t => {
  const e = setup(t); e.enable();
  assert.equal(Object.keys(e.n.state.recipients).length, 0);
  const ticket = e.n.authorization('u', appid, ['death'], identity).ticket;
  assert.equal(Object.keys(e.n.state.recipients).length, 0);
  e.n.authorizationResult('u', ticket, { [templateId]: 'reject' });
  assert.equal(Object.keys(e.n.state.recipients).length, 0);
  e.grant(); assert.equal(Object.keys(e.n.state.recipients).length, 1);
  await e.restart(); assert.equal(e.n.get('u', appid).bindingReady, true);
});
test('saving preferences during token retrieval does not cancel unchanged subscription', async t => {
  const e = setup(t); e.enable(); e.grant(); e.event('death');
  e.service.accessToken = async () => { e.enable(); return 'token'; };
  await e.n.pump(); assert.equal(e.sent.length, 1);
});
test('disable and re-enable while token request is pending cannot resurrect a cancelled message', async t => {
  const e = setup(t); e.enable(); e.grant(); e.event('death');
  e.service.accessToken = async () => { e.enable([]); e.enable(); return 'token'; };
  await e.n.pump(); assert.equal(e.sent.length, 0);
  assert.equal(e.n.records('u').records[0].delivery, 'cancelled');
});
test('expired WeChat session metadata cannot prevent disabling preferences', t => {
  const e = setup(t); e.enable();
  e.ctx.wechat.requireIdentity = () => { throw Error('expired'); };
  e.enable([]); assert.deepEqual(e.n.get('u', appid).residents[0].types, []);
});
test('an optimistic waiting state does not clear fault and balance recovery does not clear model failure', t => {
  const e = setup(t); e.enable();
  e.runner.status = 'hosted_balance_low'; e.n.runnerChanged('a');
  e.runner.status = 'waiting'; e.n.runnerChanged('a');
  e.runner.status = 'hosted_balance_low'; e.n.runnerChanged('a');
  assert.equal(e.n.records('u').records.length, 1);
  e.runner.status = 'hosted_unavailable'; e.n.runnerChanged('a');
  e.runner.status = 'waiting'; e.n.runnerChanged('a', { recovered: ['balance_low'] });
  e.runner.status = 'hosted_unavailable'; e.n.runnerChanged('a');
  assert.equal(e.n.records('u').records.length, 2);
});

test('unlink then immediate rebind cannot restore preferences, grants or queued messages even after restart', async t => {
  const e = setup(t);
  const { AccountStore } = await import('../src/accounts/store.js');
  const accounts = new AccountStore(e.ctx.cfg.dataDir);
  const user = await accounts.create({ username: 'notifyowner', password: 'test-pass-very-long' });
  accounts.setContact(user.id, 'email', 'notify@example.org');
  await accounts.wechatLogin(identityHash(appid, openid), { bindId: user.id, appid });
  e.ctx.accounts = accounts; e.ctx.rt.w.access.residents.a.managerAccountId = user.id;
  e.n.preferences(user.id, appid, 'a', ['death'], identity);
  const ticket = e.n.authorization(user.id, appid, ['death'], identity).ticket;
  e.n.authorizationResult(user.id, ticket, { [templateId]: 'accept' });
  e.event('death');
  await accounts.unlinkWechat(user.id, appid, 'test-pass-very-long', appid);
  await accounts.wechatLogin(identityHash(appid, openid), { bindId: user.id, appid });
  await e.restart(); await e.n.pump();
  assert.equal(e.sent.length, 0); assert.deepEqual(e.n.get(user.id, appid).residents, []);
  assert.equal(e.n.get(user.id, appid).bindingReady, false);
});
test('authorization issued before unlink cannot add credits to a newly rebound recipient', t => {
  const e = setup(t); e.enable();
  const old = e.n.authorization('u', appid, ['death'], identity).ticket;
  e.user.wechatNotificationEpochs = { [appid]: 1 };
  const current = e.n.authorization('u', appid, ['death'], identity).ticket;
  e.n.authorizationResult('u', current, { [templateId]: 'accept' });
  assert.throws(() => e.n.authorizationResult('u', old, { [templateId]: 'accept' }), x => x.code === 'invalid_ticket');
  assert.equal(Object.values(e.n.state.recipients)[0].credits[templateId], 1);
});
test('events committed during startup recovery remain live and are not treated as historical backlog', async t => {
  const e = setup(t); e.enable(['death']); e.grant();
  const old = { seq: 1, type: 'death', agent: 'a' }, fresh = { seq: 2, type: 'death', agent: 'a' };
  e.ctx.rt.w.counters.event = 1;
  e.ctx.rt.events.file = join(e.ctx.cfg.dataDir, 'events.jsonl');
  writeFileSync(e.ctx.rt.events.file, JSON.stringify(old) + '\n' + JSON.stringify(fresh) + '\n');
  const recovery = e.n.start();
  e.event('death');
  await recovery;
  assert.equal(e.sent.length, 1);
  assert.deepEqual(e.n.records('u').records.map(r => r.delivery), ['sent', 'unavailable']);
});
