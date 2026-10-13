import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BillingStore, yuanToMicro, costMicro, reservationMicro } from '../src/hosted/billing.js';

const config = { maxOutputTokens: 4096, pricesMicro: { miss: 2000000, hit: 500000, output: 3000000 } };
function setup(t, at = '2026-10-13T00:00:00Z') {
  const dir = mkdtempSync(join(tmpdir(), 'heirs-billing-')), file = join(dir, 'billing.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let now = Date.parse(at);
  const options = { file, now: () => now, timezone: 'Asia/Shanghai' };
  return { store: new BillingStore(options), options, file, dir, advance: days => { now += days * 86400000; } };
}
const error = status => e => e.status === status;

test('integer yuan conversion, exact ceiling, cache clamping, and large intermediate products', () => {
  assert.equal(yuanToMicro('0.000001'), 1); assert.equal(yuanToMicro(1.23), 1230000); assert.equal(yuanToMicro('5000'), 5000000000);
  for (const x of ['-1', '1e3', '0.0000001', NaN, Infinity, '', '1.2x']) assert.throws(() => yuanToMicro(x));
  assert.equal(costMicro({ input: 7, cacheRead: 4, output: 3 }, config.pricesMicro), 17);
  assert.equal(costMicro({ input: 2, cacheRead: 10, output: 0 }, config.pricesMicro), 1);
  assert.equal(costMicro({ input: 1, output: 0 }, { miss: 1, hit: 1, output: 1 }), 1);
  assert.equal(reservationMicro(100, 4096, config.pricesMicro), 12488);
  assert.equal(costMicro({ input: 1000000000, output: 0 }, { miss: 99999999, hit: 0, output: 0 }), 99999999000);
  assert.equal(costMicro(null, config.pricesMicro), null);
  assert.equal(costMicro({ input: NaN, output: -1 }, config.pricesMicro), null);
  assert.throws(() => reservationMicro(-1, 4096, config.pricesMicro));
});

test('reservations share an account, all settlement outcomes and repeated settlement', t => {
  const { store: b } = setup(t);
  b.adjust('alice', 25000, 'admin', 'initial');
  const a = b.reserve('alice', 'resident-a', 100, config), c = b.reserve('alice', 'resident-b', 100, config);
  assert.ok(a); assert.ok(c); assert.equal(b.reserve('alice', 'resident-c', 100, config), null);
  assert.equal(b.reserved('alice'), 24976);
  assert.equal(b.settle(a, { input: 7, cacheRead: 4, output: 3 }, { ok: true }), 17);
  assert.equal(b.settle(a, null, { ok: true }), 0);
  assert.equal(b.settle(c, null, { ok: false }), 0);
  assert.equal(b.balance('alice'), 24983); assert.equal(b.reserved(), 0);
  const cancelled = b.reserve('alice', 'resident-a', 0, config);
  b.settle(cancelled, { input: 100, output: 100 }, { ok: true, cancelled: true });
  assert.equal(b.balance('alice'), 24983);
  const missing = b.reserve('alice', 'resident-a', 0, config);
  assert.equal(b.settle(missing, null, { ok: true }), 12288);
  const overrun = b.reserve('alice', 'resident-a', 0, config);
  assert.equal(b.settle(overrun, { input: 10000, output: 10000 }, { ok: true }), 50000);
  assert.ok(b.balance('alice') < 0); assert.equal(b.reserve('alice', 'resident-a', 0, config), null);
  assert.equal(b.accountView('alice').total.calls, 3);
});

test('mixed credits, adjustments and calls conserve balances; reload loses only reservations', t => {
  const { store: b, file, options } = setup(t);
  const r = b.request('alice', { amountMicro: 1000000, note: 'paid', requestId: 'once' });
  b.decide(r.id, 'admin', true, { creditMicro: 1200000, note: 'verified' });
  b.adjust('alice', -20000, 'admin', 'refund'); b.adjust('bob', 800000, 'admin', 'gift');
  const a = b.reserve('alice', 'resident', 100, config), c = b.reserve('bob', 'resident', 200, config);
  b.settle(a, { input: 12, output: 5, cacheRead: 2 }, { ok: true }); b.settle(c, null, { ok: true });
  b.reserve('alice', 'resident', 200, config);
  const balances = Object.values(b.data.accounts).reduce((n, a) => n + a.balanceMicro, 0);
  const credits = b.data.ledger.reduce((n, l) => n + l.amountMicro, 0);
  const charges = Object.values(b.data.accounts).reduce((n, a) => n + a.total.costMicro, 0);
  assert.equal(balances, credits - charges);
  const reload = new BillingStore(options);
  assert.deepEqual(JSON.parse(JSON.stringify(reload.data)), JSON.parse(JSON.stringify(b.data)));
  assert.equal(reload.reserved(), 0); assert.ok(b.reserved() > 0);
  assert.ok(!readFileSync(file, 'utf8').includes('reservations'));
  assert.equal(reload.accountView('alice').usage.residents.length, 1);
});

test('real-day timezone boundaries, 30-day resident view and 90-day retention preserve lifetime charges', t => {
  const e = setup(t, '2026-01-01T16:01:00Z'), b = e.store;
  b.adjust('alice', 10000000, 'admin', 'initial');
  const charge = () => b.settle(b.reserve('alice', 'resident', 0, config), { input: 10, output: 0 }, { ok: true });
  charge(); assert.equal(b.data.daily[0].day, '2026-01-02');
  e.advance(29); charge(); assert.equal(b.accountView('alice').usage.residents[0].calls, 2);
  e.advance(1); assert.equal(b.accountView('alice').usage.residents[0].calls, 1);
  e.advance(59); assert.equal(b.data.daily.length, 2); b.prune(); assert.equal(b.data.daily.length, 2);
  e.advance(1); const reload = new BillingStore(e.options);
  assert.equal(reload.data.daily.length, 1); assert.equal(reload.data.accounts.alice.total.calls, 2);
  e.advance(90); reload.prune(); assert.equal(reload.data.daily.length, 0); assert.equal(reload.data.accounts.alice.total.costMicro, 40);
});

test('request validation, pending/hour limits, account-scoped idempotency, and final-state conflicts', t => {
  const e = setup(t), b = e.store;
  for (const amountMicro of [0, 999999, 1000001, 5000000001, 1.1, '1000000']) assert.throws(() => b.request('alice', { amountMicro, requestId: 'bad' }), error(400));
  assert.throws(() => b.request('alice', { amountMicro: 1000000, requestId: 'bad', note: '文'.repeat(201) }), error(400));
  assert.throws(() => b.request('alice', { amountMicro: 1000000, requestId: [] }), error(400));
  const req = i => b.request('alice', { amountMicro: 1000000, requestId: `r-${i}`, note: '文'.repeat(200) });
  const first = req(0);
  for (let i = 1; i < 5; i++) req(i);
  assert.deepEqual(req(0), first); assert.throws(() => req(5), error(429));
  assert.throws(() => b.cancel(first.id, 'bob'), error(404));
  const other = b.request('bob', { amountMicro: 1000000, requestId: 'r-0' }); assert.notEqual(other.id, first.id);
  b.decide(first.id, 'admin', false, { note: 'not received' });
  assert.throws(() => b.decide(first.id, 'admin', true, { creditMicro: 1000000 }), error(409));
  for (const r of b.data.requests.filter(r => r.accountId === 'alice' && r.status === 'pending')) b.cancel(r.id, 'alice');
  for (let i = 5; i < 10; i++) { const r = req(i); b.cancel(r.id, 'alice'); }
  assert.throws(() => req(10), error(429));
  const reload = new BillingStore(e.options); assert.throws(() => reload.request('alice', { amountMicro: 1000000, requestId: 'r-10' }), error(429));
  e.advance(1 / 24); assert.ok(req(10));
  assert.throws(() => b.adjust('alice', 1, 'admin', ' '), error(400));
});

test('defensive loading drops unsafe metadata, fails closed on corruption, and failed writes never credit', t => {
  const e = setup(t), b = e.store;
  b.adjust('alice', 1000000, 'admin', 'gift');
  const raw = JSON.parse(readFileSync(e.file, 'utf8'));
  raw.accounts.alice.total.secret = 'do-not-keep'; raw.daily = [{ accountId: 'alice', residentId: 'r', day: 'invalid' }];
  raw.ledger[0].extra = 'do-not-keep';
  writeFileSync(e.file, JSON.stringify(raw));
  const cleaned = new BillingStore(e.options);
  assert.ok(!JSON.stringify(cleaned.data).includes('do-not-keep')); assert.deepEqual(cleaned.data.daily, []);
  writeFileSync(e.file, '{'); const broken = new BillingStore(e.options);
  assert.equal(broken.fault, true); assert.equal(broken.reserve('alice', 'r', 0, config), null);
  assert.throws(() => broken.adjust('alice', 1, 'admin', 'gift'), error(503));
  b.file = join(e.dir, 'missing', 'billing.json');
  assert.throws(() => b.adjust('alice', 100, 'admin', 'gift')); assert.equal(b.balance('alice'), 1000000); assert.equal(b.fault, true);
  mkdirSync(join(e.dir, 'missing')); assert.throws(() => b.adjust('alice', 1, 'admin', 'gift'), error(503));
});

test('reservation snapshots retain prices across config updates, while admin actual credit can differ from request limits', t => {
  const { store: b } = setup(t);
  const r = b.request('alice', { amountMicro: 1000000, requestId: 'small-actual' });
  b.decide(r.id, 'admin', true, { creditMicro: 500000 });
  assert.equal(b.balance('alice'), 500000);
  const next = b.request('alice', { amountMicro: 1000000, requestId: 'reject-reason' });
  assert.throws(() => b.decide(next.id, 'admin', false, {}), error(400));
  const c = structuredClone(config), reservation = b.reserve('alice', 'resident', 0, c);
  c.pricesMicro.output = 9000000;
  assert.equal(b.settle(reservation, { input: 0, output: 100 }, { ok: true }), 300);
});
