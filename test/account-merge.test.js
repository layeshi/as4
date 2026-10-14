import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from './http-helpers.js';
import { AccountStore } from '../src/accounts/store.js';
import { BillingStore } from '../src/hosted/billing.js';
import { identityHash } from '../src/wechat/service.js';
const mini = 'wx83d31aa7fc9a797e', password = 'website-password';
const headers = { 'X-Houren-Request': '1' };
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'houren-merge-')), file = join(dir, 'physics.json');
  writeFileSync(file, JSON.stringify({ version: 1, regrowth: { baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 }, thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 }, factorPermille: 500 }, construction: { fullActionsPerTick: 2, factorPermille: 500 } }));
  const e = await boot({ physics: 2, premise: 6, shellSlots: 0, hiddenPhysicsFile: file, map: 'compact-materials-v1', wechatAppId: 'wx216f3fb724629f67', wechatAppSecret: 'game-secret', wechatMiniprogramAppId: mini, wechatMiniprogramAppSecret: 'mini-secret' }, { dir });
  t.after(() => e.close());
  const s = e.app.ctx.accounts;
  const source = await s.wechatLogin(identityHash(mini, 'verified-owner'), { appid: mini });
  const target = await s.create({ username: 'website', password });
  const sourceToken = s.issue(source.id), targetToken = s.issue(target.id);
  const auth = { ...headers, Cookie: 'houren_session=' + sourceToken };
  e.app.ctx.wechat.fetcher = async () => ({ ok: true, json: async () => ({ openid: 'verified-owner' }) });
  const create = async (token, name) => {
    const r = await e.call('/api/account/residents', { method: 'POST', headers: { ...headers, Cookie: 'houren_session=' + token }, body: { name, soul: '观察与生活', lang: 'zh', dailyCap: 18000, requestId: 'create-' + name } });
    assert.equal(r.status, 201, r.text); return r.json.agentId;
  };
  const a = await create(sourceToken, 'source'), b = await create(targetToken, 'target');
  const billing = e.app.ctx.hosted.billing;
  billing.adjust(source.id, 7000000, 'operator', 'test'); billing.adjust(target.id, -1000000, 'operator', 'test');
  const sourceRequest = billing.request(source.id, { requestId: 'same-id', amountMicro: 1000000 });
  billing.request(target.id, { requestId: 'merge-' + sourceRequest.id, amountMicro: 1000000 });
  billing.request(target.id, { requestId: 'same-id', amountMicro: 1000000 });
  e.app.ctx.runners.records[a] = { accountId: source.id, accountRevision: source.revision, ownershipRevision: 1, config: { model: 'test', apiKey: 'preserve-this-secret' }, enabled: false };
  e.app.ctx.runners.usage.record(a + '@' + source.id, { input: 10, output: 20 });
  const preview = async (body = {}) => e.call('/api/wechat/merge/preview', { method: 'POST', headers: auth, body: { username: 'website', password, code: 'fresh-code', appid: mini, ...body } });
  return { e, s, source, target, sourceToken, targetToken, auth, a, b, billing, preview };
}
test('two proofs and explicit confirmation merge residents, balances and bindings exactly once', async t => {
  const { e, s, source, target, sourceToken, targetToken, auth, a, b, billing, preview } = await setup(t);
  assert.equal((await preview({ password: 'wrong-password' })).status, 401);
  assert.ok(s.session(sourceToken));
  const p = await preview(); assert.equal(p.status, 200, p.text); assert.equal(p.json.residents, 1); assert.equal(p.json.sourceBalanceMicro, 7000000);
  assert.equal(s.get(source.id).status, 'active', 'preview has no migration side effect');
  const body = { ticket: p.json.ticket, confirm: true };
  assert.equal((await e.call('/api/wechat/merge/confirm', { method: 'POST', headers: auth, body: { ...body, confirm: false } })).status, 400);
  const energy = e.rt.w.agents[a].energy;
  const r = await e.call('/api/wechat/merge/confirm', { method: 'POST', headers: auth, body });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.user.id, target.id);
  assert.equal(billing.balance(source.id), 0); assert.equal(billing.balance(target.id), 6000000);
  assert.equal(e.rt.w.access.residents[a].managerAccountId, target.id);
  assert.equal(e.rt.w.access.residents[a].creatorAccountId, target.id);
  assert.equal(e.rt.w.access.residents[b].managerAccountId, target.id);
  assert.equal(e.rt.w.agents[a].energy, energy);
  assert.ok(e.rt.w.access.startupClaims[target.id]);
  assert.equal(s.session(sourceToken), null); assert.equal(s.session(targetToken), null);
  assert.equal(s.get(source.id).mergedTo, target.id);
  assert.equal((await s.wechatLogin(identityHash(mini, 'verified-owner'))).id, target.id);
  assert.equal((await s.login({ username: 'website', password })).id, target.id);
  await assert.rejects(s.update(source.id, { status: 'active' }, { admin: true }), x => x.code === 'account_merging');
  assert.equal(e.app.ctx.runners.valid(a), true); assert.equal(e.app.ctx.runners.records[a].config.apiKey, 'preserve-this-secret');
  assert.equal(e.app.ctx.runners.usage.view(a + '@' + target.id).total.tokens, 30);
  assert.equal(billing.accountView(target.id).requests.length, 3);
  assert.equal((await e.call('/api/wechat/merge/confirm', { method: 'POST', headers: auth, body })).status, 401);
  assert.equal(billing.balance(target.id), 6000000);
  const reload = new BillingStore({ file: billing.file }); assert.equal(reload.fault, false); assert.equal(reload.balance(target.id), 6000000);
  assert.equal(reload.accountView(target.id).requests.length, 3);
});
test('failed publication stays locked and durable recovery does not double-credit', async t => {
  const { e, source, target, auth, a, billing, preview } = await setup(t);
  const p = await preview();
  const merger = e.app.ctx.accountMerger;
  merger.mergeUsage = () => { throw new Error('simulated interruption'); };
  const r = await e.call('/api/wechat/merge/confirm', { method: 'POST', headers: auth, body: { ticket: p.json.ticket, confirm: true } });
  assert.equal(r.status, 500);
  assert.equal(billing.balance(target.id), 6000000);
  assert.ok(new AccountStore(e.dir).get(target.id).mergePending);
  await e.close({ keepDir: true }); e.close = async () => {};
  const restarted = await boot(e.cfg, { dir: e.dir }); t.after(() => restarted.close());
  restarted.app.ctx.accountMerger.recover(); // repeated recovery is a no-op
  const ctx = restarted.app.ctx;
  assert.equal(ctx.hosted.billing.balance(target.id), 6000000);
  assert.equal(ctx.hosted.billing.data.merges.length, 1);
  assert.equal(ctx.accounts.get(source.id).mergedTo, target.id);
  assert.equal(ctx.runners.valid(a), true);
  assert.equal(ctx.runners.usage.view(a + '@' + target.id).total.tokens, 30);
  assert.ok(!readFileSync(ctx.accounts.file, 'utf8').includes('mergePending'));
});
test('password change after preview invalidates approval and leaves data intact', async t => {
  const { e, s, source, target, auth, billing, preview } = await setup(t);
  const p = await preview();
  await s.update(target.id, { password: 'changed-password' }, { admin: true });
  const r = await e.call('/api/wechat/merge/confirm', { method: 'POST', headers: auth, body: { ticket: p.json.ticket, confirm: true } });
  assert.equal(r.status, 409); assert.equal(billing.balance(source.id), 7000000);
  assert.equal(s.get(source.id).status, 'active');
});

test('setting a web password revokes sessions but preserves an existing resident runner', async t => {
  const { e, s, source, sourceToken, a } = await setup(t);
  const runners = e.app.ctx.runners;
  assert.equal(runners.valid(a), true);
  await s.setWechatPassword(source.id, identityHash(mini, 'verified-owner'), 'new-web-password');
  assert.equal(s.session(sourceToken), null);
  assert.equal(runners.valid(a), true);
  runners.activate('http://127.0.0.1:1');
  assert.equal(runners.records[a].config.apiKey, 'preserve-this-secret');
});

test('a third party cannot accept an old transfer while merge waits for a runner to stop', async t => {
  const { e, s, source, target, auth, a, preview } = await setup(t);
  const third = await s.create({ username: 'third', password: 'third-party-password' });
  const invitation = e.rt.exec('account', { op: 'transfer', accountId: source.id, agentId: a, ownershipRevision: 1, to: third.id, now: Date.now(), requestId: 'invite-before-merge' }).result;
  const p = await preview(); assert.equal(p.status, 200, p.text);
  let release, entered;
  const stopped = new Promise(resolve => { entered = resolve; });
  e.app.ctx.runners.stop = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
  const merging = e.call('/api/wechat/merge/confirm', { method: 'POST', headers: auth, body: { ticket: p.json.ticket, confirm: true } });
  await stopped;
  let accept;
  try {
    accept = await e.call('/api/account/transfers/' + invitation.transferId + '/accept', { method: 'POST', headers: { ...headers, Cookie: 'houren_session=' + s.issue(third.id) }, body: { requestId: 'accept-during-merge', dailyCap: 1000000, config: { provider: 'mock' } } });
  } finally { release(); }
  const merged = await merging;
  assert.equal(accept.status, 409, accept.text); assert.equal(merged.status, 200, merged.text);
  assert.equal(e.rt.w.access.residents[a].managerAccountId, target.id);
  assert.equal(e.rt.w.access.transfers[invitation.transferId].status, 'cancelled');
});
