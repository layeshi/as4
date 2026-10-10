import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { pushInbox } from '../src/e2/engine/core.js';
import { textWeight } from '../src/text.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
import { earthDay } from '../src/shells/budget.js';
const city = () => boot({ physics: 2, premise: 4, shellSlots: 0, tokenBasic: 500000 });
const post = (env, path, token, body) => env.call(path, { method: 'POST', token, body });
const billTotal = b => b.reread + b.read + b.write;

for (const lang of ['zh', 'en']) {
  test(`P4 Q65: ${lang} acquired content is delivered but free at wake and every later round`, async () => {
    const env = await city();
    try {
      const r = await env.register('甲', { dailyCap: 1000000, lang });
      const a = env.rt.w.agents[r.agentId];
      // Keep the standard pricing language fixed independently of transport options.
      a.lang = lang;
      const baseline = await post(env, '/api/me/wake', r.agentToken, { kind: 'main', lang });
      assert.equal(baseline.status, 200, baseline.text);
      const standardWeight = textWeight(baseline.json.system);
      const acquired = '习得 ABC 🧠 不再计费。'.repeat(35);
      a.body.trained.push({ text: acquired, weight: textWeight(acquired), by: a.id, day: 0 });
      for (const toolMode of ['native', 'json', 'mcp']) {
        const wake = await post(env, '/api/me/wake', r.agentToken, { kind: 'main', lang, toolMode });
        assert.equal(wake.status, 200, wake.text);
        assert.ok(wake.json.system.includes(acquired), 'the model still receives acquired content');
        assert.equal(wake.json.bill.reread, Math.ceil(standardWeight / 10));
        assert.equal(wake.json.bill.read, textWeight(wake.json.text));
        const wakeId = wake.json.wakeId;
        const look = await post(env, '/api/me/look', r.agentToken, { wakeId, what: 'self', turn: 2, lang });
        assert.equal(look.status, 200, look.text);
        assert.equal(look.json.bill.reread - wake.json.bill.reread, Math.ceil(standardWeight / 10));
        const act = await post(env, '/api/me/act', r.agentToken, { wakeId, actions: [], turn: 3, lang });
        assert.equal(act.status, 200, act.text);
        assert.equal(act.json.bill.reread - look.json.bill.reread,
          Math.ceil((standardWeight + textWeight(wake.json.text)) / 10));
        assert.equal(checkConservation(env.rt.w).ok, true);
      }
      // Exact remaining allowance proves later rereading of acquired content cannot cause a cap refusal.
      const expectedWakeCost = Math.ceil(standardWeight / 10);
      const probe = await post(env, '/api/me/wake', r.agentToken, { kind: 'main', lang });
      assert.equal(probe.status, 200);
      const cap = a.tokens.used + expectedWakeCost;
      await post(env, '/api/owner/cap', r.ownerKey, { dailyCap: cap });
      const next = await post(env, '/api/me/act', r.agentToken, { wakeId: probe.json.wakeId, actions: [], turn: 2, lang });
      assert.equal(next.status, 200, next.text);
      assert.equal(a.tokens.used, cap);
    } finally { await env.close(); }
  });
}

test('P4 T7/T18: status is free and private, wake/look/act meter explicit and implicit turns', async () => {
  const env = await city();
  try {
    const resident = await env.register('甲', { dailyCap: 1000000 });
    const token = resident.agentToken, a = env.rt.w.agents[resident.agentId];
    const before = env.rt.w.commandN;
    const status = await env.call('/api/me?after=ignored', { token });
    assert.equal(status.status, 200);
    assert.equal(env.rt.w.commandN, before);
    for (const key of ['city','here','inbox','actions']) assert.equal(Object.hasOwn(status.json, key), false);
    for (const key of ['soul','memories','trained']) assert.equal(Object.hasOwn(status.json.you, key), false);
    assert.equal(status.json.waking, null);
    let r = await post(env, '/api/me/act', token, { actions: [] });
    assert.equal(r.status, 409);
    const wake = await post(env, '/api/me/wake', token, { kind: 'main' });
    assert.equal(wake.status, 200, wake.text);
    const id = wake.json.wakeId;
    assert.equal(wake.json.bill.reread, Math.ceil(textWeight(wake.json.system) / 10));
    assert.equal(wake.json.bill.read, textWeight(wake.json.text));
    const look = await post(env, '/api/me/look', token, { wakeId: id, what: 'laws', turn: 1 });
    assert.equal(look.status, 200, look.text);
    assert.equal(look.json.bill.reread, wake.json.bill.reread);
    assert.equal(look.json.bill.read - wake.json.bill.read, textWeight(look.json.text));
    r = await post(env, '/api/me/act', token, { wakeId: id, turn: 2, actions: [] });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.bill.reread - look.json.bill.reread, Math.ceil((textWeight(wake.json.system) + textWeight(wake.json.text)) / 10));
    assert.equal(a.tokens.used, billTotal(r.json.bill));
    const wake2 = await post(env, '/api/me/wake', token, { kind: 'main', toolMode: 'json' });
    assert.equal(wake2.json.bill.reread, wake.json.bill.reread, 'standard prompt price is independent of transport mode');
    const first = await post(env, '/api/me/look', token, { wakeId: wake2.json.wakeId, what: 'self' });
    const second = await post(env, '/api/me/look', token, { wakeId: wake2.json.wakeId, what: 'self' });
    assert.equal(first.json.bill.reread, wake2.json.bill.reread);
    assert.ok(second.json.bill.reread > first.json.bill.reread);
    assert.equal(checkConservation(env.rt.w).ok, true);
    assert.equal((await post(env, '/api/me/refund', token, { wakeId: id })).status, 404);
  } finally { await env.close(); }
});

test('P4 T7/T17: at most twenty inbox entries are delivered; wait exposes only seq/kind; look budget spans wakings', async () => {
  const env = await city();
  try {
    const r = await env.register('甲', { dailyCap: 1000000 }), a = env.rt.w.agents[r.agentId];
    for (let i = 0; i < 25; i++) pushInbox(env.rt.w, a, 'whisper', { from: { id: 'a2', name: '乙' }, text: `收件${i}` });
    const expected = a.inbox.slice().sort((a,b) => a.seq-b.seq);
    const wait = await env.call('/api/me/wait?after=0&timeoutMs=1000', { token: r.agentToken });
    assert.equal(wait.status, 200);
    assert.ok(wait.json.items.length > 0);
    for (const item of wait.json.items) assert.deepEqual(Object.keys(item), ['seq','kind']);
    const woke = await post(env, '/api/me/wake', r.agentToken, { kind: 'main' });
    assert.equal(woke.status, 200, woke.text);
    assert.equal(a.delivered, expected[19].seq);
    const look = await post(env, '/api/me/look', r.agentToken, { wakeId: woke.json.wakeId, what: 'inbox' });
    assert.equal(look.status, 200, look.text);
    assert.equal(a.delivered, expected.at(-1).seq);
    for (let i = 1; i < env.rt.agentLoop.looks; i++) assert.equal((await post(env, '/api/me/look', r.agentToken, { wakeId: woke.json.wakeId, what: 'self', turn: 1 })).status, 200);
    const again = await post(env, '/api/me/wake', r.agentToken, { kind: 'wake' });
    assert.equal((await post(env, '/api/me/look', r.agentToken, { wakeId: again.json.wakeId, what: 'self' })).status, 429);
    env.rt.tickNow();
    assert.equal((await post(env, '/api/me/look', r.agentToken, { wakeId: again.json.wakeId, what: 'self' })).status, 409);
  } finally { await env.close(); }
});

test('P4 T7/T23: cap refusal returns no text, owner changes apply immediately, public caps are anonymous', async () => {
  const env = await city();
  try {
    const r = await env.register('甲', { dailyCap: 1 });
    let wake = await post(env, '/api/me/wake', r.agentToken, { kind: 'main' });
    assert.equal(wake.status, 402);
    assert.equal(wake.json.error.code, 'cap_reached');
    assert.equal(Object.hasOwn(wake.json, 'text'), false);
    assert.equal(Object.hasOwn(wake.json, 'system'), false);
    assert.equal((await post(env, '/api/owner/cap', r.ownerKey, { dailyCap: 1000000 })).status, 200);
    wake = await post(env, '/api/me/wake', r.agentToken, { kind: 'main' });
    assert.equal(wake.status, 200, wake.text);
    const used = wake.json.you.usedToday;
    await post(env, '/api/owner/cap', r.ownerKey, { dailyCap: used });
    const look = await post(env, '/api/me/look', r.agentToken, { wakeId: wake.json.wakeId, what: 'laws' });
    assert.equal(look.status, 402);
    assert.equal((await env.call('/api/me', { token: r.agentToken })).json.waking, null);
    const owner = (await env.call('/api/owner', { token: r.ownerKey })).json.agents[0];
    assert.equal(owner.tokens.cap, used);
    assert.equal(owner.tokens.usedToday, used);
    const pub = (await env.call('/api/public/state')).json;
    assert.equal(pub.world.tokens.caps.count, 1);
    assert.equal(Object.hasOwn(pub.world.tokens.caps, 'max'), false);
    for (const a of pub.agents) for (const key of ['tokens','basic','cap','routine']) assert.equal(Object.hasOwn(a, key), false);
    const admin = await env.call('/api/admin/tokens', { admin: true });
    assert.equal(admin.status, 200);
    assert.equal(admin.json.caps.max, used);
    assert.equal((await env.call('/api/admin/tokens')).status, 401);
    assert.equal((await env.call('/api/admin/well-supply', { method: 'POST', admin: true, body: { permille: 1200 } })).status, 200);
    assert.equal((await env.call('/api/admin/basic-allotment', { method: 'POST', admin: true, body: { basic: 18000 } })).status, 200);
  } finally { await env.close(); }
});

test('P4 T7: exhausted balance refuses waking; failed attached text stays undelivered', async () => {
  const env = await city();
  try {
    const r = await env.register('甲', { dailyCap: 1000000 }), a = env.rt.w.agents[r.agentId];
    const day = earthDay(Date.now(), 'Asia/Shanghai').key;
    env.rt.exec('meter', { op: 'wake', agentId: a.id, wakeId: 'w0-drain', day, kind: 'main', system: 0, brief: a.basic, delivered: 0 });
    const refused = await post(env, '/api/me/wake', r.agentToken, { kind: 'main' });
    assert.equal(refused.status, 402);
    assert.equal(refused.json.error.code, 'tokens_exhausted');
    assert.equal(a.delivered, 0);
  } finally { await env.close(); }
});

test('P4 T7: new endpoints are absent in older worlds', async () => {
  const env = await boot({ physics: 2, premise: 2, shellSlots: 0 });
  try {
    for (const path of ['/api/me/wake','/api/me/look','/api/owner/cap','/api/admin/well-supply','/api/admin/basic-allotment']) assert.equal((await post(env, path, '', {})).status, 404);
    assert.equal((await env.call('/api/admin/tokens', { admin: true })).status, 404);
  } finally { await env.close(); }
});

test('P4 T7/Q64: clipped inbox entries remain unread; restarting loses only the in-memory waking', async () => {
  const env = await city();
  try {
    const r = await env.register('甲', { dailyCap: 1000000 }), a = env.rt.w.agents[r.agentId];
    const woke = await post(env, '/api/me/wake', r.agentToken, { kind: 'main' });
    env.rt.agentLoop = { ...env.rt.agentLoop, lookChars: 40 };
    pushInbox(env.rt.w, a, 'whisper', { from: { id: 'a2', name: '乙' }, text: '短' });
    const complete = a.inbox.at(-1).seq;
    pushInbox(env.rt.w, a, 'whisper', { from: { id: 'a2', name: '乙' }, text: '长'.repeat(200) });
    const long = a.inbox.at(-1).seq;
    const looked = await post(env, '/api/me/look', r.agentToken, { wakeId: woke.json.wakeId, what: 'inbox' });
    assert.equal(looked.status, 200);
    assert.equal(a.delivered, complete);
    const next = await post(env, '/api/me/wake', r.agentToken, { kind: 'main' });
    assert.equal(next.status, 200);
    assert.equal(a.delivered, long);
    env.app.ctx.wakings.clear();
    assert.equal((await post(env, '/api/me/look', r.agentToken, { wakeId: next.json.wakeId, what: 'self' })).status, 409);
    assert.equal((await env.call('/api/me', { token: r.agentToken })).json.waking, null);
  } finally { await env.close(); }
});

test('P4 T7: unaffordable attached inbox is withheld after a successful action', async () => {
  const env = await city();
  try {
    const r = await env.register('甲', { dailyCap: 1000000 }), a = env.rt.w.agents[r.agentId];
    const woke = await post(env, '/api/me/wake', r.agentToken, { kind: 'main' });
    await post(env, '/api/owner/cap', r.ownerKey, { dailyCap: a.tokens.used });
    pushInbox(env.rt.w, a, 'whisper', { from: { id: 'a2', name: '乙' }, text: '等下一次' });
    const before = a.delivered, pending = a.inbox.filter(i => i.seq > before).length;
    const acted = await post(env, '/api/me/act', r.agentToken, { wakeId: woke.json.wakeId, turn: 1, actions: [] });
    assert.equal(acted.status, 200);
    assert.equal(acted.json.arrivedWithheld, pending);
    assert.equal(Object.hasOwn(acted.json, 'arrived'), false);
    assert.equal(a.delivered, before);
    assert.equal(checkConservation(env.rt.w).ok, true);
  } finally { await env.close(); }
});
