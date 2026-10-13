import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../src/accounts/store.js';
import { WechatService, identityHash } from '../src/wechat/service.js';
const cfg = { wechatAppId: 'wx216f3fb724629f67', wechatAppSecret: 'server-only-test-secret' };
const identity = { appid: cfg.wechatAppId, openid: 'test-openid-123456', verifiedAt: Date.now() };
const ok = data => ({ ok: true, json: async () => data });

test('WeChat identity mapping is unique, separate from public data, and cannot hijack a password account', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-wechat-'));
  try {
    const store = new AccountStore(dir);
    const person = await store.create({ username: 'wx_existing', displayName: 'Existing', password: 'long-existing-password' });
    const key = identityHash(identity.appid, identity.openid);
    const users = await Promise.all([store.wechatLogin(key), store.wechatLogin(key)]);
    assert.equal(users[0].id, users[1].id);
    assert.notEqual(users[0].id, person.id);
    assert.equal(store.data.users.length, 2);
    assert.equal(store.data.users[1].role, 'user');
    const renewed = new AccountStore(dir);
    assert.equal((await renewed.wechatLogin(key)).id, users[0].id);
    const { publicUser } = await import('../src/accounts/store.js');
    assert.ok(!JSON.stringify(publicUser(users[0])).includes(key));
    assert.ok(!readFileSync(store.file, 'utf8').includes(identity.openid));
    await assert.rejects(store.wechatLogin(key, { bindId: person.id }), e => e.code === 'identity_linked');
    await assert.rejects(store.wechatLogin('1'.repeat(64), { registrationOpen: false }), e => e.status === 403);
    const linked = await store.wechatLogin('2'.repeat(64), { bindId: person.id, registrationOpen: false });
    assert.equal(linked.id, person.id);
    assert.equal((await store.login({ username: 'wx_existing', password: 'long-existing-password' })).id, person.id);
    const token = store.issue(linked.id, { wechat: identity });
    assert.equal(store.sessionMetadata(token).wechat.openid, identity.openid);
    store.logout(token); assert.equal(store.sessionMetadata(token), null);
    await store.update(users[0].id, { status: 'disabled' }, { admin: true });
    await assert.rejects(store.wechatLogin(key), e => e.status === 401);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('upstream exchange discards session keys and never reflects secrets or raw errors', async () => {
  const service = new WechatService(cfg, { fetcher: async url => {
    assert.equal(url.origin, 'https://api.weixin.qq.com');
    assert.equal(url.searchParams.get('grant_type'), 'authorization_code');
    return ok({ openid: identity.openid, session_key: 'never-return-this-key', unionid: 'never-return-unionid' });
  } });
  const result = await service.exchange('test-code');
  assert.equal(result.openid, identity.openid); assert.equal(result.session_key, undefined); assert.equal(result.unionid, undefined);
  const failing = new WechatService(cfg, { fetcher: async () => { throw Error(cfg.wechatAppSecret); } });
  await assert.rejects(failing.exchange('test-code'), e => e.status === 503 && !e.message.includes(cfg.wechatAppSecret));
  await assert.rejects(new WechatService({}).exchange('test-code'), e => e.code === 'wechat_unconfigured');
});
test('text safety checks the complete tail, shares token refresh and fails closed on review, quota and malformed responses', async () => {
  const checked = []; let tokens = 0, suggestion = 'pass', errcode = 0;
  const service = new WechatService(cfg, { fetcher: async (url, options) => {
    if (url.pathname === '/cgi-bin/token') { tokens++; return ok({ access_token: 'test-token', expires_in: 7200 }); }
    assert.equal(url.pathname, '/wxa/msg_sec_check');
    const body = JSON.parse(options.body); checked.push(body);
    return ok({ errcode, result: { suggest: suggestion } });
  } });
  await Promise.all([service.check('profile-a', identity), service.check('profile-b', identity)]);
  assert.equal(tokens, 1);
  await service.check('字'.repeat(2100) + 'TAIL', identity);
  assert.ok(checked.some(v => v.content.endsWith('TAIL')));
  assert.ok(checked.every(v => Array.from(v.content).length <= 2000 && v.version === 2 && v.openid === identity.openid));
  const count = checked.length; await service.check('profile-a', identity); assert.equal(checked.length, count);
  suggestion = 'review'; await assert.rejects(service.check('needs review', identity), e => e.status === 422);
  suggestion = undefined; await assert.rejects(service.check('malformed response', identity), e => e.status === 422);
  errcode = 45009; await assert.rejects(service.check('quota exhausted', identity), e => e.status === 503);
  await assert.rejects(service.check('no login', null), e => e.status === 401);
  await assert.rejects(service.check('expired login', { ...identity, verifiedAt: Date.now() - 2 * 60 * 60000 }), e => e.status === 401);
});

test('miniGame public projection withholds unchecked AI output and preserves identifiers', async () => {
  const { WechatProjection } = await import('../src/wechat/projection.js');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const projection = new WechatProjection({ requireIdentity: i => { if (!i) throw Error(); }, check: async text => { await gate; if (text.includes('bad')) { const error = Error(); error.status = 422; throw error; } } });
  const source = { agentId: 'a-1', status: 'awake', name: 'Alice', bio: { zh: 'safe content', en: 'safe content' }, nested: [{ text: 'AI generated text' }] };
  const first = projection.filter(source, identity);
  assert.equal(first.agentId, 'a-1'); assert.equal(first.name, '内容审核中'); assert.equal(first.bio.en, '内容审核中');
  assert.equal(source.name, 'Alice', 'projection never mutates world data');
  release();
  for (let i = 0; i < 10 && projection.pending.size; i++) await new Promise(resolve => setImmediate(resolve));
  const second = projection.filter(source, null);
  assert.equal(second.name, 'Alice'); assert.equal(second.bio.zh, 'safe content');
  projection.filter({text:'bad content'}, identity);
  for (let i = 0; i < 10 && projection.pending.size; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(projection.filter({text:'bad content'}, identity).text, '内容审核中'); assert.equal(second.nested[0].text, 'AI generated text');
});

test('HTTP exchange issues a revocable cookie, existing account binding requires authentication, and raw public text is withheld', async () => {
  const { boot } = await import('./http-helpers.js');
  const e = await boot(cfg);
  try {
    e.app.ctx.wechat.fetcher = async url => ok(url.pathname === '/sns/jscode2session' ? { openid: identity.openid, session_key: 'secret-session-key' } : { access_token: 'test-token', expires_in: 7200 });
    const h = { 'X-Houren-Request': '1', 'X-Houren-Client': 'wechat' };
    assert.equal((await e.call('/api/wechat/login', { method: 'POST', body: { code: 'code', bindCurrent: true }, headers: h })).status, 401);
    assert.equal((await e.call('/api/wechat/login', { method: 'POST', body: { code: 'code' } })).status, 403);
    const response = await e.call('/api/wechat/login', { method: 'POST', body: { code: 'code', openid: 'attacker-supplied-openid', role: 'admin' }, headers: h });
    assert.equal(response.status, 200); assert.equal(response.json.user.role, 'user');
    assert.ok(!response.text.includes(identity.openid)); assert.ok(!response.text.includes('session_key'));
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal((await e.call('/api/wechat/status', { headers: { Cookie: cookie } })).json.verified, true);
    const publicResult = await e.call('/api/wechat/public/state');
    assert.equal(publicResult.status, 200);
    assert.equal(publicResult.json.world.id, e.rt.w.id);
    assert.equal((await e.call('/api/wechat/public/stream')).status, 404);
    assert.equal((await e.call('/api/wechat/public/../admin/users')).status, 404);
    assert.equal((await e.call('/api/account', { method: 'PATCH', body: { displayName: 'unchecked-name' }, headers: { ...h, Cookie: cookie } })).status, 422);
    assert.notEqual(e.app.ctx.accounts.get(response.json.user.id).displayName, 'unchecked-name');
    await e.call('/api/account/logout', { method: 'POST', body: {}, headers: { ...h, Cookie: cookie } });
    assert.equal((await e.call('/api/wechat/status', { headers: { Cookie: cookie } })).json.verified, false);
  } finally { await e.close(); }
});

test('miniGame projection shows operator text and engine enums at once, hides uploaded avatars and counts withheld text', async () => {
  const { WechatProjection, PENDING_TEXT } = await import('../src/wechat/projection.js');
  const quiet = '本刻公共事件：arrive（事件 12）；built（事件 15）。请核查原始记录。';
  const projection = new WechatProjection({ requireIdentity() { throw Error(); } }, { systemTexts: () => ({ texts: new Set(['港口']), patterns: [/^本刻公共事件：[a-z_]+（事件 \d+）(?:；[a-z_]+（事件 \d+）)*。请核查原始记录。$/] }) });
  const meta = { pending: 0 };
  const out = projection.filter({ name: '港口', outcome: 'energy', zone: 'scrapyard', origin: 'human', band: 'pristine', agent: 'a5', text: quiet,
    note: '本刻公共事件：居民写的话（事件 1）。请核查原始记录。', bio: 'resident prose', avatar: 'a'.repeat(64), roles: [{ avatar: '/roles/guide.svg' }], choice: '同意' }, null, '', meta);
  assert.deepEqual([out.name, out.outcome, out.zone, out.origin, out.band, out.agent, out.text], ['港口', 'energy', 'scrapyard', 'human', 'pristine', 'a5', quiet]);
  assert.equal(out.note, PENDING_TEXT); assert.equal(out.bio, PENDING_TEXT); assert.equal(out.choice, PENDING_TEXT, 'prose under an enum key is still moderated');
  assert.equal(out.avatar, null); assert.equal(out.roles[0].avatar, '/roles/guide.svg');
  assert.equal(meta.pending, 3);
});

test('miniGame moderation results survive a restart and expired results are dropped', async () => {
  const { WechatProjection } = await import('../src/wechat/projection.js');
  const dir = mkdtempSync(join(tmpdir(), 'houren-wechat-cache-'));
  try {
    const file = join(dir, 'wechat-moderation.json');
    const first = new WechatProjection({ requireIdentity() {} }, { file });
    first.save(first.key('approved resident text'), true, 60000);
    first.save(first.key('refused resident text'), false, 60000);
    first.results.set(first.key('stale text'), { allowed: true, until: Date.now() - 1 });
    first.flush();
    assert.ok(!readFileSync(file, 'utf8').includes('approved resident text'), 'only digests are stored');
    const second = new WechatProjection({ requireIdentity() { throw Error(); } }, { file });
    assert.equal(second.filter({ text: 'approved resident text' }, null).text, 'approved resident text');
    assert.equal(second.filter({ text: 'refused resident text' }, null).text, '内容审核中');
    assert.equal(second.results.has(second.key('stale text')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('names are checked independently before prose and recover from a refused mixed batch', async () => {
  const { WechatProjection } = await import('../src/wechat/projection.js');
  const calls = [];
  const projection = new WechatProjection({
    requireIdentity() {},
    async check(text) { calls.push(text); if (text.includes('拒绝的正文')) throw { status: 422 }; },
  });
  projection.save(projection.key('石序'), false, 60000); // A previous mixed batch refused every string.
  const value = { bio: '拒绝的正文', name: '石序', place: { displayName: { zh: '居民所建地点' } } };
  projection.filter(value, identity);
  await new Promise(resolve => setImmediate(resolve));
  const result = projection.filter(value, null);
  assert.equal(result.name, '石序');
  assert.equal(result.place.displayName.zh, '居民所建地点');
  assert.equal(result.bio, '内容审核中');
  assert.equal(calls[0], '石序');
  assert.ok(calls.includes('居民所建地点'));
  assert.ok(!calls.some(s => s.includes('石序') && s.includes('拒绝的正文')));
});

test('model presets are public operator configuration and contain no credentials', async () => {
  const { boot } = await import('./http-helpers.js');
  const e = await boot(cfg);
  try {
    const r = await e.call('/api/wechat/model-presets');
    assert.equal(r.status, 200);
    assert.ok(r.json.presets.some(p => p.id === 'deepseek'));
    assert.ok(r.json.presets.some(p => p.id === 'glm'));
    assert.ok(!r.text.includes('apiKey')); assert.ok(!r.text.includes('openid'));
  } finally { await e.close(); }
});

test('P6 anonymous miniGame state shows place, role, law and canon text, withholds resident text with a pending count and no avatar', async () => {
  const { boot } = await import('./http-helpers.js');
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'houren-wx-system-')), file = join(dir, 'physics.json');
  writeFileSync(file, JSON.stringify({ version: 1, regrowth: { baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 }, thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 }, factorPermille: 500 }, construction: { fullActionsPerTick: 2, factorPermille: 500 } }));
  const e = await boot({ ...cfg, physics: 2, premise: 6, shellSlots: 0, hiddenPhysicsFile: file, map: 'compact-materials-v1' }, { dir });
  try {
    const person = await e.app.ctx.accounts.create({ username: 'wx_system_maker', password: 'long-maker-password' });
    const token = e.app.ctx.accounts.issue(person.id);
    const created = await e.call('/api/account/residents', { method: 'POST', body: { name: '未审居民', bio: '还没有送审的简介', soul: '一段灵魂', lang: 'zh', dailyCap: 18000, requestId: 'wx-system-1' }, headers: { 'X-Houren-Request': '1', Cookie: 'houren_session=' + token } });
    assert.equal(created.status, 201, created.text);
    e.rt.w.agents[created.json.agentId].avatar = 'b'.repeat(64);
    const state = (await e.call('/api/wechat/public/state')).json;
    const port = state.places.find(p => p.id === 'port');
    assert.equal(port.displayName.zh, '港口'); assert.equal(port.origin, 'human'); assert.equal(port.description, '港口。城市公共设施。');
    assert.equal(state.world.cityName, '无名之城');
    const guide = state.publicRoles.find(r => r.id === 'guide');
    assert.deepEqual([guide.name, guide.duty, guide.avatar], ['引舟', '接引员', '/roles/guide.svg']);
    assert.equal(state.laws.find(l => l.id === 'l3').title, '基本配给');
    assert.equal(state.docs.find(d => d.id === 'v6-letter').title, '致后来者');
    const resident = state.agents.find(a => a.id === created.json.agentId);
    assert.equal(resident.name, '内容审核中'); assert.equal(resident.avatar, null); assert.equal(resident.place, 'port');
    assert.ok(state.moderation.pending >= 2);
    assert.equal((await e.call('/api/public/state')).json.moderation, undefined, 'the website response is unchanged');
    const id = created.json.agentId;
    // Existing publicPlace visibility is the authoritative view for history and redaction.
    e.rt.w.inscriptions['wx-inscription'] = { id: 'wx-inscription', author: id, place: 'port', text: '需要审核的铭刻', lang: 'zh', tick: 0, redacted: false, protectedBy: [] };
    e.rt.w.inscriptions['wx-redacted'] = { id: 'wx-redacted', author: id, place: 'port', text: '不可恢复的遮盖文字', lang: 'zh', tick: 0, redacted: true, protectedBy: [] };
    const raw = (await e.call('/api/public/agents/' + id)).json;
    assert.ok(Array.isArray(raw.inscriptions));
    assert.equal(raw.inscriptions.find(i => i.id === 'wx-inscription').text, '需要审核的铭刻');
    assert.equal(raw.inscriptions.find(i => i.id === 'wx-redacted').text, null);
    const projected = (await e.call('/api/wechat/public/agents/' + id)).json;
    assert.equal(projected.inscriptions.find(i => i.id === 'wx-inscription').text, '内容审核中');
    assert.equal(projected.inscriptions.find(i => i.id === 'wx-redacted').text, null);
  } finally { await e.close(); }
});
