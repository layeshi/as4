import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { fileURLToPath } from 'node:url';
import { WechatProjection } from '../src/wechat/projection.js';

test('WeChat observation queries preserve web status, parameters and moderation', async t => {
  const env = await boot({ physics: 2 });
  t.after(() => env.close());
  const projected = [];
  env.app.ctx.wechatProjection.filter = payload => {
    projected.push(payload);
    return { filtered: true };
  };
  for (const query of ['metrics', 'metrics?from=invalid', 'weather', 'lore', 'legacy',
    'cooperation?what=cards&limit=3', 'materials', 'services', 'demands', 'orders',
    'research', 'observations?limit=2', 'projects', 'project?id=missing']) {
    const web = await env.call('/api/public/' + query);
    const count = projected.length;
    const wx = await env.call('/api/wechat/public/' + query);
    assert.equal(wx.status, web.status, query);
    assert.equal(projected.length, count + 1, query + ' goes through projection');
    assert.deepEqual(projected.at(-1), web.json, query + ' forwards query parameters');
    assert.equal(wx.json.filtered, true);
    assert.ok(wx.json.moderation);
  }
  for (const path of ['stream', 'unknown', 'agents/a1/private']) {
    const count = projected.length;
    const result = await env.call('/api/wechat/public/' + path);
    assert.equal(result.status, 404);
    assert.equal(projected.length, count);
  }
});

test('P7 market queries keep filters and reference identifiers while withholding unreviewed text', async t => {
  const env = await boot({ physics: 2, premise: 7, map: 'island-three-v1', shellSlots: 0,
    hiddenPhysicsFile: fileURLToPath(new URL('./fixtures/p7-hidden-physics.json', import.meta.url)) });
  t.after(() => env.close());
  env.rt.w.services = {
    s1: { id: 's1', status: 'active', provider: 'a1', title: 'UNREVIEWED TITLE', price: 12, criterionTemplate: { kind: 'repair' } },
    s2: { id: 's2', status: 'active', provider: 'a2', title: 'OTHER TITLE', price: 30, criterionTemplate: { kind: 'repair' } },
  };
  const result = await env.call('/api/wechat/public/services?agent=a1&limit=1');
  assert.equal(result.status, 200);
  assert.equal(result.json.length, 1);
  assert.equal(result.json[0].id, 's1');
  assert.equal(result.json[0].provider, 'a1');
  assert.equal(result.json[0].price, 12);
  assert.notEqual(result.json[0].title, 'UNREVIEWED TITLE');
  assert.equal(env.rt.w.services.s1.title, 'UNREVIEWED TITLE');
});

test('cooperation pagination and machine references survive projection but prose does not', () => {
  const projection = new WechatProjection({ requireIdentity() { throw Error('login required'); } });
  const data = projection.filter({ next: 'c12', city: 'north', requester: 'a1', founder: 'a2',
    assignee: 'a3', visibility: 'public', invited: ['a4'], orders: ['o1'], title: 'hello', body: 'hello', provider: 'free text' }, null);
  assert.equal(data.next, 'c12');
  assert.equal(data.city, 'north');
  assert.equal(data.requester, 'a1');
  assert.equal(data.founder, 'a2');
  assert.equal(data.assignee, 'a3');
  assert.equal(data.visibility, 'public');
  assert.deepEqual(data.invited, ['a4']);
  assert.deepEqual(data.orders, ['o1']);
  assert.notEqual(data.title, 'hello');
  assert.notEqual(data.body, 'hello');
  assert.notEqual(data.provider, 'free text');
  const runtime = projection.filter({ runnerStatus: 'unconfigured', nextWake: { state: 'scheduled', blockedBy: ['cap_reached'] },
    config: { baseURL: 'https://api.deepseek.com', model: 'deepseek-flash', thinking: 'default' },
    finishReason: 'stop', errorKind: 'timeout', tags: ['north:citizen'], brief: 'AIprose', reason: 'AIprose' }, null);
  assert.equal(runtime.runnerStatus, 'unconfigured');
  assert.equal(runtime.nextWake.state, 'scheduled');
  assert.deepEqual(runtime.nextWake.blockedBy, ['cap_reached']);
  assert.equal(runtime.config.baseURL, 'https://api.deepseek.com');
  assert.equal(runtime.config.model, 'deepseek-flash');
  assert.equal(runtime.finishReason, 'stop');
  assert.deepEqual(runtime.tags, ['north:citizen']);
  assert.notEqual(runtime.brief, 'AIprose');
  assert.notEqual(runtime.reason, 'AIprose');
  const fingerprints = projection.filter({ fingerprints: ['a'.repeat(12), 'unreviewed'] }, null);
  assert.equal(fingerprints.fingerprints[0], 'a'.repeat(12));
  assert.notEqual(fingerprints.fingerprints[1], 'unreviewed');
});

test('WeChat resident events require the same ownership as the website', async t => {
  const env = await boot({ physics: 2, premise: 7, map: 'island-three-v1', shellSlots: 0,
    hiddenPhysicsFile: fileURLToPath(new URL('./fixtures/p7-hidden-physics.json', import.meta.url)) });
  t.after(() => env.close());
  const anonymous = await env.call('/api/wechat/residents/a1/events');
  assert.equal(anonymous.status, 401);
  const user = await env.app.ctx.accounts.create({ username: 'parity_observer', password: 'test-password-12345' });
  const token = env.app.ctx.accounts.issue(user.id);
  const headers = { Cookie: `houren_session=${token}` };
  const web = await env.call('/api/account/residents/a1/events', { headers });
  const wx = await env.call('/api/wechat/residents/a1/events', { headers });
  assert.equal(wx.status, web.status);
  assert.ok(wx.status >= 400);
  assert.deepEqual(wx.json, web.json);
  const created = await env.call('/api/account/residents', { method: 'POST', headers: { ...headers, 'X-Houren-Request': '1' },
    body: { name: 'Parity resident', bio: 'A resident', soul: 'Private soul', dailyCap: 18000, requestId: 'parity-create', city: 'north' } });
  assert.equal(created.status, 201, created.text);
  const events = await env.call(`/api/wechat/residents/${created.json.agentId}/events?limit=1`, { headers });
  assert.equal(events.status, 200);
  assert.ok(Array.isArray(events.json.events));
  assert.ok(events.json.events.length <= 1);
  assert.ok(events.json.moderation);
});

test('WeChat account read proxies preserve account boundaries and reject unknown routes', async t => {
  const env = await boot({ physics: 2, premise: 7, map: 'island-three-v1', shellSlots: 0,
    hiddenPhysicsFile: fileURLToPath(new URL('./fixtures/p7-hidden-physics.json', import.meta.url)) });
  t.after(() => env.close());
  const user = await env.app.ctx.accounts.create({ username: 'parity_account', password: 'test-password-12345' });
  const headers = { Cookie: `houren_session=${env.app.ctx.accounts.issue(user.id)}` };
  for (const path of ['transfers', 'hosted', 'worlds']) {
    assert.equal((await env.call('/api/wechat/account/' + path)).status, 401);
    const result = await env.call('/api/wechat/account/' + path, { headers });
    assert.equal(result.status, 200, path);
    assert.ok(result.json.moderation, path);
    if (path === 'hosted') {
      assert.equal(result.json.balanceMicro, 0);
      assert.deepEqual(result.json.requests, []);
      assert.equal(result.json.usage.timezone, env.app.ctx.hosted.billing.timezone);
    }
  }
  assert.equal((await env.call('/api/wechat/account/worlds/missing/souls', { headers })).status, 404);
  assert.equal((await env.call('/api/wechat/account/admin', { headers })).status, 404);
});
