import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { stateHash } from '../src/store.js';
import { HistoryArchive } from '../src/history/archive.js';
import { ExportManager } from '../src/history/exports.js';
import { periods, ReportManager } from '../src/history/reports.js';
import { publishWorldArchive } from '../src/world-archives.js';

async function setup(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'heirs-history-'));
  const hiddenPhysicsFile = join(dataDir, 'physics.json');
  writeFileSync(hiddenPhysicsFile, JSON.stringify({ version: 1, regrowth: { baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 }, thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 }, factorPermille: 500 }, construction: { fullActionsPerTick: 2, factorPermille: 500 } }));
  const cfg = { ...loadConfig({}, []), dataDir, worldId: 'history', physics: 2, premise: 6, map: 'compact-materials-v1', shellSlots: 0, hiddenPhysicsFile, seed: 'history', allowLocalModels: true };
  const rt = Runtime.open(cfg, { logger: {} });
  const ctx = { rt, cfg, accounts: { linksOf: () => [] } };
  const archive = new HistoryArchive(rt); ctx.history = archive;
  await archive.ready;
  t.after(async () => { await archive.close(); rt.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const result = rt.exec('account', { op: 'create', accountId: 'alice', name: '记录者', soul: '观察世界', model: 'secret-model', dailyCap: 1000000, requestId: 'create-history' }).result;
  assert.equal(result.ok, true);
  await archive.flush();
  return { rt, cfg, ctx, archive, id: result.agentId };
}

test('calendar closes days, months and ten-month years, with a partial final year', () => {
  const p = { enabledDay: 0, ticksPerDay: 12, daysPerMonth: 24, tick: 2880, ended: false };
  assert.equal(periods(p).filter(x => x.kind === 'year').length, 1);
  assert.deepEqual(periods(p).filter(x => x.kind === 'year').map(x => [x.fromDay, x.toDay, x.partial]), [[0, 239, false]]);
  assert.equal(periods({ ...p, tick: 3000, ended: false }).filter(x => x.kind === 'year').length, 1);
  assert.deepEqual(periods({ ...p, tick: 3000, ended: true }).filter(x => x.kind === 'year').at(-1), { kind: 'year', fromDay: 240, toDay: 249, partial: true });
});

test('history records actual failed attempts and does not alter deterministic world state', async t => {
  const { rt, archive, id } = await setup(t);
  const before = stateHash(rt.w);
  await archive.flush(); assert.equal(stateHash(rt.w), before);
  const result = rt.exec('act', { agentId: id, actions: [{ type: 'move', to: 'not-a-place' }], thought: '保留我的选择' }).result;
  await archive.flush();
  const rows = await archive.residentRecords(archive.branchId, id, { fromDay: 0, toDay: 9999 });
  const action = rows.find(r => r.kind === 'action');
  assert.equal(action.result.ok, false); assert.equal(action.result.error.code, result.results?.[0]?.error.code ?? result.error.code);
  assert.ok(rows.some(r => r.kind === 'thought' && JSON.stringify(r).includes('保留我的选择')));
  assert.ok(!JSON.stringify(rows).includes('keyHash'));
});

test('two attempts in the same tick remain distinct, and reports include real daily metrics', async t => {
  const { rt, archive, id } = await setup(t);
  rt.exec('act', { agentId: id, actions: [{ type: 'move', to: 'missing-one' }] });
  rt.exec('act', { agentId: id, actions: [{ type: 'move', to: 'missing-two' }] });
  for (let n = 0; n < 12; n++) rt.tickNow(); await archive.flush();
  const records = await archive.residentRecords(archive.branchId, id);
  assert.equal(records.filter(r => r.kind === 'action').length, 2);
  const sources = await archive.publicSources(archive.branchId, { fromDay: 0, toDay: 0 });
  assert.ok(sources.summary.lastAvailableDailySnapshot);
  assert.equal(sources.summary.lastAvailableDailySnapshot.day, 0);
});

test('idempotent delivery retries do not duplicate a resident decision or its cost', async t => {
  const { rt, archive, id } = await setup(t);
  rt.exec('meter', { op: 'wake', agentId: id, wakeId: 'wake-once', day: '2026-10-15', kind: 'main', system: 0, brief: 0, delivered: 0 });
  const input = { agentId: id, requestId: 'act-once', actions: [{ type: 'diary', text: '只写一次的日记' }], meter: { wakeId: 'wake-once', day: '2026-10-15', reread: 0 }, experimentGeneration: 0 };
  const first = rt.exec('act', input).result; assert.equal(first.results?.[0]?.ok, true, JSON.stringify(first));
  const after = structuredClone(rt.w.agents[id]);
  assert.deepEqual(rt.exec('act', input).result, first);
  assert.deepEqual(rt.w.agents[id], after); await archive.flush();
  const rows = await archive.residentRecords(archive.branchId, id);
  assert.equal(rows.filter(r => r.kind === 'action').length, 1);
});

test('long-period report statistics are complete while representative evidence stays bounded', async t => {
  const { archive } = await setup(t);
  archive.append(archive.branchId, Array.from({ length: 1000 }, (_, n) => {
    const event = { seq: 10000 + n, tick: 0, day: 0, type: 'say', vis: 'public', data: { text: `公开发言 ${n}` } };
    return { kind: 'event', event, public: event, releaseTick: 0 };
  }));
  const data = await archive.publicSources(archive.branchId, { fromDay: 0, toDay: 239 });
  assert.equal(data.summary.eventCounts.say, 1000); assert.ok(data.sources.length <= 81);
});

test('private events with missing or unreached release times never become report material', async t => {
  const { archive, id } = await setup(t);
  const events = [
    { seq: 100, tick: 0, day: 0, type: 'diary', vis: 'owner', agent: id, data: { text: 'SECRET-DIARY' } },
    { seq: 101, tick: 0, day: 0, type: 'thought', vis: 'delayed', agent: id, releaseTick: 288, data: { text: 'SECRET-THOUGHT' } },
    { seq: 102, tick: 0, day: 0, type: 'thought', vis: 'delayed', agent: id, data: { text: 'SECRET-MISSING-DEADLINE' } },
  ];
  archive.append(archive.branchId, archive.eventRows(events));
  const sources = await archive.publicSources(archive.branchId, { fromDay: 0, toDay: 23 });
  assert.ok(!JSON.stringify(sources).includes('SECRET-'));
  archive.meta.tick = 288;
  const released = JSON.stringify(await archive.publicSources(archive.branchId, { fromDay: 0, toDay: 23 }));
  assert.ok(released.includes('SECRET-THOUGHT')); assert.ok(!released.includes('SECRET-DIARY')); assert.ok(!released.includes('SECRET-MISSING-DEADLINE'));
});

test('received anonymous whispers hide the sender and blocked whispers are not received history', async t => {
  const { rt, archive, id } = await setup(t);
  const receiver = rt.exec('account', { op: 'create', accountId: 'bob', name: '收信人', soul: '倾听', model: 'mock', dailyCap: 1000000, requestId: 'create-receiver' }).result.agentId;
  const act = (agentId, requestId, action) => {
    rt.exec('meter', { op: 'wake', agentId, wakeId: requestId, day: '2026-10-15', kind: 'main', system: 0, brief: 0, delivered: 0 });
    const result = rt.exec('act', { agentId, requestId, actions: [action], experimentGeneration: 0, meter: { wakeId: requestId, day: '2026-10-15', reread: 0 } }).result;
    assert.equal(result.results?.[0]?.ok, true, JSON.stringify(result));
  };
  act(id, 'anonymous-first', { type: 'whisper', to: receiver, text: '只保留信，不揭示来者', anonymous: true });
  act(receiver, 'mute-anonymous', { type: 'mute', who: 'anonymous' });
  act(id, 'anonymous-blocked', { type: 'whisper', to: receiver, text: '被屏蔽的信', anonymous: true });
  await archive.flush();
  const received = (await archive.residentRecords(archive.branchId, receiver)).filter(r => r.kind === 'whisper');
  assert.equal(received.length, 1); assert.equal(received[0].data.from, null);
  const sent = (await archive.residentRecords(archive.branchId, id)).filter(r => r.kind === 'whisper');
  assert.equal(sent.length, 2); assert.ok(sent.every(r => r.data.from === id));
});

test('ZIP export is readable, contains all formats, and rechecks current ownership', async t => {
  const { rt, ctx, archive, id } = await setup(t);
  const letter = rt.exec('account', { op: 'letter', accountId: 'alice', agentId: id, ownershipRevision: 1, text: '<script>alert(1)</script>', requestId: 'letter-xss' }).result;
  assert.equal(letter.ok, true); await archive.flush();
  const exports = new ExportManager(ctx, archive); t.after(() => exports.close());
  const job = await exports.create({ id: 'alice' }, { agentId: id, requestId: 'export-once' });
  await exports.idle();
  assert.equal(exports.get({ id: 'alice' }, job.id).status, 'ready');
  const bytes = await exports.download({ id: 'alice' }, job.id);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.ok(bytes.includes(Buffer.from('history.json'))); assert.ok(bytes.includes(Buffer.from('actions.csv'))); assert.ok(bytes.includes(Buffer.from('index.html')));
  const nameLength = bytes.readUInt16LE(26), htmlLength = bytes.readUInt32LE(18);
  const packed = bytes.subarray(30 + nameLength, 30 + nameLength + htmlLength);
  const html = (bytes.readUInt16LE(8) === 8 ? inflateRawSync(packed) : packed).toString();
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  const relation = rt.w.access.residents[id]; relation.managerAccountId = 'bob'; relation.ownershipRevision++;
  await assert.rejects(exports.download({ id: 'alice' }, job.id), e => e.status === 403);
  await assert.rejects(exports.create({ id: 'alice' }, { agentId: id }), e => e.status === 403);
});

test('a verified account merge preserves access to archived resident history', async t => {
  const { ctx, archive, id } = await setup(t);
  const branch = structuredClone(archive.meta); branch.id = 'archived-before-merge'; archive.index.branches.push(branch);
  copyFileSync(archive.file(archive.branchId), archive.file(branch.id));
  ctx.accounts.get = id => id === 'alice' ? { status: 'disabled', mergedTo: 'bob' } : { status: 'active' };
  const exports = new ExportManager(ctx, archive); t.after(() => exports.close());
  const job = await exports.create({ id: 'bob' }, { branchId: branch.id, agentId: id });
  await exports.idle(); assert.equal(exports.get({ id: 'bob' }, job.id).status, 'ready'); assert.ok(exports.get({ id: 'bob' }, job.id).records > 0);
  await assert.rejects(exports.download({ id: 'charlie' }, job.id), e => e.status === 403);
});

test('restoring an earlier command prefix creates a separate archive branch', async t => {
  const { rt, archive } = await setup(t), first = archive.branchId;
  const saved = structuredClone(rt.w); rt.tickNow(); await archive.flush();
  rt.w = saved;
  const restored = new HistoryArchive(rt); await restored.ready; t.after(() => restored.close());
  assert.notEqual(restored.branchId, first);
  assert.equal(restored.branches().length, 2);
});

test('existing read-only world archives are imported without reopening or changing the old world', async t => {
  const { rt, cfg, archive } = await setup(t);
  const old = Runtime.open({ ...cfg, worldId: 'old-history', physics: 1, premise: null, map: 'classic' }, { logger: {} });
  for (let n = 0; n < 12; n++) old.tickNow(); old.close();
  await publishWorldArchive(cfg.dataDir, 'old-history', 'test');
  const before = readFileSync(join(cfg.dataDir, 'old-history', 'snapshot.json'));
  await archive.close(); const imported = new HistoryArchive(rt); await imported.ready; t.after(() => imported.close());
  assert.ok(imported.branches().some(b => b.worldId === 'old-history'));
  assert.deepEqual(readFileSync(join(cfg.dataDir, 'old-history', 'snapshot.json')), before);
});

test('report generation sends only public sources, preserves references and separates analysis', async t => {
  const { rt, ctx, archive } = await setup(t);
  for (let n = 0; n < 12; n++) rt.tickNow(); await archive.flush();
  let prompt;
  const reports = new ReportManager(ctx, archive, { provider: { complete: async input => {
    prompt = JSON.stringify(input);
    return { text: JSON.stringify({ title: '第一日报', overview: '世界开始运行。', facts: [{ text: '一天已经结束。', sources: ['period'] }], analysis: [{ text: '仍需继续观察。', sources: ['period'] }] }), usage: { input: 300, output: 100 } };
  } } });
  t.after(() => reports.close()); reports.save({ provider: 'mock', model: 'mock', dailyLimit: 100000 });
  await reports.discover(); await reports.idle();
  const report = reports.list({ kind: 'day' }).reports[0]; assert.equal(report.status, 'ready');
  assert.ok(!prompt.includes('secret-model')); assert.ok(!prompt.includes('观察世界'));
  const shown = reports.get(report.id); assert.equal(shown.content.analysis.length, 1); assert.ok(shown.sources.some(s => s.id === 'period'));
  assert.equal(reports.view().used, 400);
  assert.ok(!readFileSync(reports.configFile).includes(Buffer.from('"provider"')));
});

test('insufficient report budget waits without calling a model or debiting residents', async t => {
  const { rt, ctx, archive } = await setup(t);
  for (let n = 0; n < 12; n++) rt.tickNow(); await archive.flush();
  const before = stateHash(rt.w); let calls = 0;
  const reports = new ReportManager(ctx, archive, { provider: { complete: async () => { calls++; throw Error('unexpected'); } } });
  t.after(() => reports.close()); reports.save({ provider: 'mock', dailyLimit: 1 });
  await reports.discover(); await reports.idle();
  assert.equal(calls, 0); assert.equal(reports.list().reports[0].reason, 'budget'); assert.equal(stateHash(rt.w), before);
});

test('invalid model citations fail after bounded retries and never publish', async t => {
  const { rt, ctx, archive } = await setup(t);
  for (let n = 0; n < 12; n++) rt.tickNow(); await archive.flush();
  let now = Date.now(), calls = 0;
  const reports = new ReportManager(ctx, archive, { now: () => now, provider: { complete: async () => {
    calls++; return { text: JSON.stringify({ title: '不应发布', overview: '', facts: [{ text: '伪造来源', sources: ['event:nonexistent'] }], analysis: [] }), usage: { input: 100, output: 50 } };
  } } });
  t.after(() => reports.close()); reports.save({ provider: 'mock', dailyLimit: 1000000 });
  for (let n = 0; n < 4; n++) { await reports.discover(); await reports.idle(); now += 100000; }
  assert.equal(calls, 3); assert.equal(reports.list().reports[0].status, 'failed');
});

test('manual backfill rejects inherited object names as report kinds', async t => {
  const { ctx, archive } = await setup(t), reports = new ReportManager(ctx, archive);
  t.after(() => reports.close());
  await assert.rejects(reports.request({ kind: 'toString', fromDay: 0 }), e => e.status === 400);
});
