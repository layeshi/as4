import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { boot } from './http-helpers.js';
import { applyDamage } from '../src/e2/engine/environment.js';
import { setBlocklist } from '../src/moderation.js';

const pass = 'prayer-test-password';
async function identity(e, username, role = 'user') {
  const user = await e.app.ctx.accounts.create({ username, password: pass }, { role });
  const cookie = `houren_session=${e.app.ctx.accounts.issue(user.id)}`;
  return { ...user, cookie, call: (path, body, extra = {}) => e.call(path, {
    method: body === undefined ? 'GET' : 'POST', body, ...extra,
    headers: { Cookie: cookie, 'X-Houren-Request': '1', ...extra.headers },
  }) };
}
async function setup(extra = {}) {
  const e = await boot({ physics: 2, premise: 2, ...extra });
  try {
    const alice = await identity(e, 'alice'), bob = await identity(e, 'bobby');
    const chief = await identity(e, 'chief', 'admin');
    const registered = await e.register('祈愿居民');
    const a = e.rt.w.agents[registered.agentId];
    const link = (user) => e.app.ctx.accounts.linkAgent(user.id, { world: e.rt.w.id, agentId: a.id, token: a.tokenHash });
    link(alice);
    const action = (spec) => {
      a.actsThisTick = 0;
      const out = e.rt.exec('act', { agentId: a.id, actions: [spec] }).result.results[0];
      assert.equal(out.ok, true, JSON.stringify(out)); return out.data;
    };
    a.place = 'temple';
    const prayerId = e.rt.w.prayers ? action({ type: 'pray', text: '愿获得帮助' }).prayerId : 'pr1';
    const earn = (points = 3) => {
      a.place = 'temple';
      applyDamage(e.rt.w, e.rt.w.places.temple, 'temple', 'temple', 100 * points, 'natural');
      action({ type: 'repair', energy: 10 * points });
    };
    const invent = () => {
      a.place = 'library';
      const doc = action({ type: 'write', title: '发明作品', body: '可供核验的成果正文' }).doc;
      const inventionId = action({ type: 'invent', title: '发明申请', text: '成果说明', ref: { kind: 'doc', id: doc } }).inventionId;
      return { inventionId, doc };
    };
    return { e, a, alice, bob, chief, registered, prayerId, action, earn, invent, link };
  } catch (err) { await e.close(); throw err; }
}
const replyPath = (id) => `/api/account/prayers/${id}/reply`;
const reviewPath = (id) => `/api/admin/inventions/${id}/review`;
function slowMutation(e, actor, path) {
  let finish, fail;
  const result = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  const accepted = new Promise((resolve) => e.app.server.once('request', resolve));
  const req = http.request(e.base + path, { method: 'POST', headers: {
    Cookie: actor.cookie, 'X-Houren-Request': '1', 'Content-Type': 'application/json',
  } }, (res) => {
    let text = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk; });
    res.on('end', () => finish({ status: res.statusCode, json: JSON.parse(text) }));
  });
  req.on('error', fail); req.write('{');
  return { accepted, result, end: (body) => req.end(JSON.stringify(body).slice(1)) };
}

test('prayer routes require sessions, CSRF and current adopter links', async () => {
  const { e, alice, bob, chief, prayerId } = await setup();
  try {
    assert.equal((await e.call(replyPath(prayerId), { method: 'POST', body: {} })).status, 403);
    assert.equal((await e.call(replyPath(prayerId), { method: 'POST', body: {}, headers: { 'X-Houren-Request': '1' } })).status, 401);
    assert.equal((await e.call('/api/account/prayers/audit')).status, 401);
    assert.equal((await bob.call(replyPath(prayerId), { text: '冒领' })).status, 403);
    assert.equal((await alice.call(replyPath(prayerId), { text: '跨站' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await e.call('/api/admin/inventions', { admin: true })).status, 401);
    assert.equal((await alice.call('/api/admin/inventions')).status, 403);
    assert.equal((await chief.call('/api/admin/inventions')).status, 200);
  } finally { await e.close(); }
});

test('concurrent linked-account replies charge once, derive identity and cost, and keep public views private', async () => {
  const { e, a, alice, bob, chief, prayerId, earn, link } = await setup();
  try {
    earn(); link(bob);
    const before = a.energy;
    const body = { text: '神殿传来的话', energy: 2, actorId: 'forged-human', ownerTokenHash: 'forged-token', agentId: '__proto__', cost: -999, price: 0 };
    const responses = await Promise.all([alice.call(replyPath(prayerId), body), bob.call(replyPath(prayerId), body)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(responses.find((r) => r.status === 409).json.error.code, 'already');
    assert.equal(a.energy, before + 2);
    assert.equal(e.rt.w.prayers.accounts[a.id].balance, 0);
    assert.equal(e.rt.w.prayers.audit.length, 1);
    const actorId = responses[0].status === 200 ? alice.id : bob.id;
    assert.equal(e.rt.w.prayers.audit[0].actorId, actorId);
    assert.equal(e.rt.w.prayers.audit[0].cost, 3);
    for (const person of [alice, bob, chief]) {
      const own = await person.call('/api/account/prayers/audit');
      assert.equal(own.status, 200); assert.equal(own.json.audit.length, person.id === actorId ? 1 : 0);
      assert.ok(own.json.audit.every((row) => row.actorId === person.id));
    }
    assert.equal((await bob.call('/api/account/prayers/audit?scope=all')).status, 403);
    assert.equal((await chief.call('/api/account/prayers/audit?scope=all')).json.audit.length, 1);
    assert.equal((await chief.call('/api/account/prayers/audit?scope=all&agentId=a999')).json.audit.length, 0);
    const publicReply = await e.call('/api/public/prayers');
    assert.equal(publicReply.status, 200); assert.equal(publicReply.headers.get('access-control-allow-origin'), '*');
    assert.equal(publicReply.json.accounts[0].name, a.name);
    assert.equal(publicReply.json.accounts[0].status, a.status);
    assert.equal(publicReply.json.accounts[0].balance, 0);
    assert.equal(publicReply.json.prayers[0].status, 'answered');
    assert.equal((await e.call(`/api/public/prayers?agentId=${a.id}`)).json.prayers.length, 1);
    assert.equal((await e.call('/api/public/prayers?agentId=a999')).json.prayers.length, 0);
    for (const path of ['/api/public/prayers', '/api/public/state', `/api/public/agents/${a.id}`, '/api/public/events?limit=500']) {
      const r = await e.call(path);
      for (const secret of [alice.id, bob.id, chief.id, actorId, a.tokenHash, a.ownerKeyHash, 'forged-human', 'forged-token']) assert.ok(!r.text.includes(secret), `${path} leaked ${secret}`);
    }
    const events = (await e.call('/api/public/events?limit=500')).json.events;
    assert.ok(events.some((row) => row.type === 'prayer_answered'));
    assert.ok(readFileSync(join(e.rt.dir, 'commands.jsonl'), 'utf8').includes(actorId), 'private command log retains actor for replay');
  } finally { await e.close(); }
});

test('insufficient points and malformed/prototype references have bounded errors without mutations', async () => {
  const { e, alice, chief, prayerId, invent } = await setup();
  try {
    const before = JSON.stringify(e.rt.w.prayers);
    const poor = await alice.call(replyPath(prayerId), { text: '回复', energy: 1, cost: 0 });
    assert.equal(poor.status, 409); assert.deepEqual({ code: poor.json.error.code, required: poor.json.error.required, balance: poor.json.error.balance }, { code: 'insufficient_points', required: 2, balance: 0 });
    for (const id of ['__proto__', 'constructor', 'toString', 'pr%00', 'x'.repeat(129)]) {
      const r = await alice.call(replyPath(id), { text: '回复' }); assert.equal(r.status, 400, id);
      assert.equal((await chief.call(reviewPath(id), { decision: 'approved', reason: '合格' })).status, 400, id);
    }
    assert.equal((await alice.call(replyPath('pr999'), { text: '回复' })).status, 404);
    for (const body of [{}, { text: '😀'.repeat(601) }, { energy: -1 }, { energy: 1.5 }, { energy: '1' }, { text: {} }, { energy: 1000001 }]) assert.equal((await alice.call(replyPath(prayerId), body)).status, 400);
    assert.equal((await alice.call(replyPath(prayerId), undefined, { method: 'POST', raw: '{', headers: { 'Content-Type': 'application/json' } })).status, 400);
    assert.equal((await alice.call(replyPath(prayerId), { text: 'x'.repeat(9000) })).status, 413);
    assert.equal(JSON.stringify(e.rt.w.prayers), before);
    const { inventionId } = invent();
    setBlocklist(['禁语']);
    try {
      assert.equal((await alice.call(replyPath(prayerId), { text: '禁语' })).status, 422);
      assert.equal((await chief.call(reviewPath(inventionId), { decision: 'approved', reason: '禁语' })).status, 422);
    } finally { setBlocklist([]); }
    assert.equal((await chief.call(reviewPath(inventionId), { decision: 'approved', reason: '' })).status, 400);
    assert.equal((await chief.call(reviewPath(inventionId), { decision: 'approved', reason: 'x'.repeat(601) })).status, 400);
    assert.equal((await chief.call('/api/account/prayers/audit?scope=constructor')).status, 400);
    assert.equal((await e.call('/api/public/prayers?agentId=__proto__')).status, 400);
    assert.equal((await alice.call(replyPath('%E0%A4%A'), { text: '回复' })).status, 400);
    assert.equal((await chief.call(reviewPath('%'), { decision: 'approved', reason: '合格' })).status, 400);
  } finally { await e.close(); }
});

test('completed project evidence is reviewable, human commands work during pause and private snapshots retain records', async () => {
  const { e, a, alice, chief, prayerId, action, registered } = await setup();
  try {
    assert.equal((await e.call('/api/admin/adjust', { method: 'POST', admin: true, body: { agentId: a.id, energy: 100, reason: '测试工程投入' } })).status, 200);
    a.place = 'market';
    const project = action({ type: 'initiate', build: 'site', lot: 'commons-4', name: '公共成果', owner: 'city' }).project;
    a.place = e.rt.w.projects[project].place;
    action({ type: 'contribute', project, energy: 40 });
    const inventionId = action({ type: 'invent', title: '工程发明', text: '建成成果', ref: { kind: 'project', id: project } }).inventionId;
    const row = (await chief.call('/api/admin/inventions')).json.inventions[0];
    assert.equal(row.canReview, true); assert.equal(row.work.status, 'built');
    assert.equal(row.work.contributors[a.id], 40); assert.equal(row.work.id, project);
    assert.equal((await chief.call('/api/admin/pause', {})).status, 200);
    assert.equal((await e.call('/api/me/act', { method: 'POST', token: registered.agentToken, body: { actions: [] } })).json.error.code, 'paused');
    const approved = await chief.call(reviewPath(inventionId), { decision: 'approved', reason: '已核验工程成果' });
    assert.equal(approved.status, 200); assert.equal(approved.json.balance, 14);
    assert.equal((await alice.call(replyPath(prayerId), { energy: 2 })).status, 200);
    assert.equal(e.rt.w.paused, true); assert.equal(e.rt.w.clock.tick, 0);
    assert.equal(e.rt.w.prayers.accounts[a.id].balance, 12);
    const saved = await chief.call('/api/admin/snapshots', { label: '祈愿记录' });
    assert.equal(saved.status, 201);
    const response = await fetch(e.base + `/api/admin/snapshots/${saved.json.snapshot.id}/download`, { headers: { Cookie: chief.cookie } });
    assert.equal(response.status, 200);
    const archive = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())));
    const historical = JSON.parse(archive.files['snapshot.json']);
    assert.equal(historical.prayers.prayers[prayerId].status, 'answered');
    assert.equal(historical.prayers.inventions[inventionId].status, 'approved');
    assert.deepEqual(historical.prayers.audit.map((entry) => entry.actorId), [chief.id, alice.id]);
    const publicEvents = await e.call('/api/public/events?limit=500');
    assert.ok(!publicEvents.text.includes(chief.id)); assert.ok(!publicEvents.text.includes(alice.id));
    assert.ok(publicEvents.json.events.some((entry) => entry.type === 'invention_reviewed'));
  } finally { await e.close(); }
});

test('fostering invalidates old links while new adopter inherits points and pending prayers', async () => {
  const { e, a, alice, bob, prayerId, earn, registered } = await setup();
  try {
    earn(1);
    assert.equal((await e.call('/api/owner/release', { method: 'POST', token: registered.ownerKey, body: { release: true } })).status, 200);
    const foster = await bob.call('/api/port/foster', { agentId: a.id, model: 'test' });
    assert.equal(foster.status, 200);
    const stale = await alice.call(replyPath(prayerId), { text: '旧链接', ownerTokenHash: a.tokenHash });
    assert.equal(stale.status, 403); assert.equal(stale.json.error.code, 'stale_link');
    assert.equal((await bob.call(replyPath(prayerId), { text: '新领养者' })).status, 200);
    const summaries = (await bob.call('/api/account/agents')).json.agents;
    assert.equal(summaries[0].prayerPoints, 0); assert.equal(summaries[0].prayers.prayers[0].status, 'answered');
  } finally { await e.close(); }
});

test('admin review requires independent signed-in administrator, exposes work and records actual reviewer', async () => {
  const { e, a, alice, chief, invent, link } = await setup();
  try {
    const { inventionId, doc } = invent();
    assert.equal((await e.call(reviewPath(inventionId), { method: 'POST', admin: true, body: { decision: 'approved', reason: '合格' }, headers: { 'X-Houren-Request': '1' } })).status, 401);
    assert.equal((await alice.call(reviewPath(inventionId), { decision: 'approved', reason: '合格', role: 'admin' })).status, 403);
    const list = (await chief.call('/api/admin/inventions')).json;
    assert.equal(list.inventions[0].canReview, true);
    assert.equal(list.inventions[0].work.kind, 'doc'); assert.equal(list.inventions[0].work.docKind, 'agent');
    assert.equal(list.inventions[0].work.id, doc); assert.equal(list.inventions[0].work.body, '可供核验的成果正文');
    link(chief);
    assert.equal((await chief.call('/api/admin/inventions')).json.inventions[0].canReview, false);
    const denied = await chief.call(reviewPath(inventionId), { decision: 'approved', reason: '自己审核', actorId: alice.id, role: 'admin' });
    assert.equal(denied.status, 403); assert.equal(denied.json.error.code, 'self_review');
    e.app.ctx.accounts.unlinkAgents(chief.id, e.rt.w.id, [a.id]);
    const out = await chief.call(reviewPath(inventionId), { decision: 'approved', reason: '核验通过', actorId: alice.id, awarded: false, points: 1000 });
    assert.equal(out.status, 200); assert.equal(out.json.balance, 10);
    assert.equal(e.rt.w.prayers.audit[0].actorId, chief.id);
    assert.equal((await chief.call('/api/admin/inventions')).json.inventions[0].canReview, false);
    assert.equal((await chief.call(reviewPath(inventionId), { decision: 'approved', reason: '重复' })).status, 409);
    const publicView = await e.call('/api/public/prayers');
    for (const secret of [alice.id, chief.id, 'actorId', a.tokenHash]) assert.ok(!publicView.text.includes(secret));
    assert.equal(publicView.json.inventions[0].status, 'approved');
  } finally { await e.close(); }
});

test('slow request body revalidates revoked session, unlinked account and changed token before commit', async () => {
  for (const change of ['session', 'unlink', 'token']) {
    const { e, a, alice, prayerId, earn } = await setup();
    try {
      earn(1); const before = JSON.stringify(e.rt.w.prayers);
      const pending = slowMutation(e, alice, replyPath(prayerId)); await pending.accepted;
      if (change === 'session') await e.app.ctx.accounts.update(alice.id, { status: 'disabled' }, { admin: true });
      if (change === 'unlink') e.app.ctx.accounts.unlinkAgents(alice.id, e.rt.w.id, [a.id]);
      if (change === 'token') a.tokenHash = 'changed-after-body-start';
      pending.end({ text: '不应提交' }); const response = await pending.result;
      assert.equal(response.status, change === 'session' ? 401 : 403, change);
      assert.equal(JSON.stringify(e.rt.w.prayers), before);
    } finally { await e.close(); }
  }
});

test('slow invention review revalidates independence immediately before command', async () => {
  const { e, a, chief, invent, link } = await setup();
  try {
    const { inventionId } = invent();
    const pending = slowMutation(e, chief, reviewPath(inventionId)); await pending.accepted; link(chief);
    pending.end({ decision: 'approved', reason: '不应自审' });
    assert.equal((await pending.result).status, 403);
    assert.equal(e.rt.w.prayers.inventions[inventionId].status, 'pending');
    assert.equal(e.rt.w.prayers.accounts[a.id]?.balance || 0, 0);
  } finally { await e.close(); }
});

test('premise 0 and 1 feature stays unavailable with no prayer state', async () => {
  for (const premise of [0, 1]) {
    const { e, alice, chief } = await setup({ premise });
    try {
      assert.deepEqual((await e.call('/api/public/prayers')).json, { enabled: false });
      assert.deepEqual((await chief.call('/api/admin/inventions')).json, { enabled: false, inventions: [] });
      assert.equal((await alice.call(replyPath('pr1'), { text: '回复' })).json.error.code, 'feature_unavailable');
      assert.equal((await chief.call(reviewPath('iv1'), { decision: 'approved', reason: '合格' })).json.error.code, 'feature_unavailable');
      assert.deepEqual((await alice.call('/api/account/prayers/audit')).json, { enabled: false, audit: [] });
      assert.equal(e.rt.w.prayers, undefined);
    } finally { await e.close(); }
  }
});
