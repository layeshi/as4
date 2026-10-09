// SPEC-P4 T25: manual local acceptance; deliberately outside node --test discovery.
// No environment credentials or model endpoints are read. Only mock is permitted.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/http/server.js';
import { createProvider, ProviderError } from '../runner/providers.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
import { custodyOf } from '../src/e2/engine/tokens.js';
import { stateHash } from '../src/store.js';
import { replayDir } from '../src/tools/replay.js';

const dir = mkdtempSync(join(tmpdir(), 'houren-p4-smoke-'));
const cfg = loadConfig({ DATA_DIR: dir, WORLD_ID: 'p4-smoke', SEED: 'p4-smoke-12', PHYSICS: '2', PREMISE: '4',
  SHELL_SLOTS: '0', SANDBOX_AGENTS: '0', TICK_MS: '300000', REGISTRATION_OPEN: '1' }, []);
const sumBill = b => b.reread + b.read + b.write;
const bills = () => ({ reread: 0, read: 0, write: 0 });
let rt, app;
try {
  rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
  let checkedCommands = 0;
  const exec = rt.exec.bind(rt);
  rt.exec = (...args) => {
    const result = exec(...args);
    assert.equal(checkConservation(rt.w).ok, true, `conservation after ${args[0]}`);
    assert.equal(rt.w.ledger.mismatches, 0);
    checkedCommands++;
    return result;
  };
  app = createApp(rt, cfg, { logger: {} });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const manager = app.ctx.runners;
  const residents = [];
  for (const [name, dailyCap] of [['模拟甲',1000000],['模拟乙',12000],['模拟丙',1000000]]) {
    const response = await fetch(`${base}/api/port/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, soul: '我是本机验收的模拟居民。', bio: '模拟验收', lang: 'zh', model: 'mock', dailyCap }) });
    assert.equal(response.status, 201, 'local registration');
    const resident = await response.json();
    residents.push(resident);
    assert.equal(rt.w.agents[resident.agentId].basic, 18000);
    await manager.attach(resident.agentId, resident.agentToken, { provider: 'mock', model: 'mock', apiKey: '', baseURL: '',
      thinking: 'default', timeoutMs: 1000, actEveryTicks: 1, historyRounds: 2,
      toolMode: residents.length === 2 ? 'json' : 'native' }, false);
  }
  let failFirst = false, pending = null;
  const append = manager.traces.append.bind(manager.traces);
  manager.traces.append = (id, record, model) => {
    const result = append(id, record, model);
    pending?.({ id, record: structuredClone(record) });
    return result;
  };
  manager.provider = async config => {
    assert.equal(config.provider, 'mock');
    const script = failFirst ? [new ProviderError('intentional mock failure', { retryable: true })] : [
      { calls: [{ name: 'look', args: { what: 'laws' } }], usage: { input: 1000, output: 20 } },
      { calls: [{ name: 'act', args: { actions: [{ type: 'say', text: '这是模拟发言。'.repeat(20) }], end: true } }], usage: { input: 1200, output: 150 } },
    ];
    return createProvider({ provider: 'mock', script });
  };
  const rows = [], totals = Object.fromEntries(residents.map(r => [r.agentId, bills()]));
  let refunded = 0;
  for (let tick = 0; tick < 12; tick++) {
    if (tick === 6) assert.equal(rt.exec('cap', { agentId: residents[1].agentId, cap: 30000 }).result.ok, true);
    for (const resident of residents) {
      const id = resident.agentId, a = rt.w.agents[id];
      const before = { basic: a.basic, energy: a.energy, used: a.tokens.used, day: a.tokens.day };
      failFirst = tick === 0 && resident === residents[2];
      let timer;
      const completed = new Promise((resolve, reject) => {
        pending = result => { if (result.id === id) { clearTimeout(timer); resolve(result.record); } };
        timer = setTimeout(() => reject(Error(`mock waking timeout at tick ${tick}, ${id}`)), 15000);
      });
      manager.start(id);
      let record;
      try { record = await completed; }
      finally { clearTimeout(timer); pending = null; await manager.stop(id); }
      const bill = { reread: record.bill.reread, read: record.bill.read, write: record.bill.write };
      const debit = sumBill(bill);
      assert.equal(before.basic + before.energy - a.basic - a.energy, debit, 'only mock reading/writing was charged');
      assert.equal(a.tokens.used - (before.day === a.tokens.day ? before.used : 0), debit, 'bill equals daily usage delta');
      assert.ok(a.tokens.used <= a.tokens.cap);
      if (failFirst) {
        assert.equal(record.ended, 'error');
        assert.equal(debit, 0);
        assert.equal(a.basic, before.basic);
        refunded = rt.w.dayLog.p4.refunded;
        assert.ok(refunded > 0);
      }
      for (const key of Object.keys(bill)) totals[id][key] += bill[key];
      rows.push({ tick, id, ended: record.ended, refused: record.refused ?? null, bill,
        basic: a.basic, energy: a.energy, cap: a.tokens.cap, used: a.tokens.used });
    }
    rt.tickNow();
    assert.equal(checkConservation(rt.w).ok, true);
  }
  assert.equal(rt.w.clock.tick, 12);
  assert.equal(rows.length, 36);
  assert.ok(rows.some(r => r.refused === 'cap_reached'));
  assert.equal(rt.w.metrics.length, 1);
  const daily = rt.w.metrics[0].p4;
  assert.equal(daily.refunded, refunded);
  assert.equal(Object.values(totals).reduce((sum,b) => sum + sumBill(b),0), daily.reread + daily.read + daily.write - daily.refunded);
  for (const resident of residents) {
    const a = rt.w.agents[resident.agentId];
    assert.equal(a.basic, 18000 - custodyOf(a), 'daily allotment is renewed before custody');
  }
  const usage = manager.usageOverview().total;
  const ending = residents.map(({ agentId: id }) => {
    const a = rt.w.agents[id];
    return { id, basic: a.basic, energy: a.energy, cap: a.tokens.cap, used: a.tokens.used, custody: custodyOf(a), bill: totals[id] };
  });
  await app.close(); app = null;
  const hash = stateHash(rt.w), conservation = checkConservation(rt.w), commands = rt.w.commandN;
  rt.close(); rt = null;
  const replay = replayDir(join(dir, cfg.worldId));
  assert.equal(replay.ok, true, replay.diff || 'replay');
  assert.equal(replay.hash, hash);
  rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
  assert.equal(stateHash(rt.w), hash, 'restart hash');
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, provider: 'mock', world: cfg.worldId,
    ticks: 12, residents: 3, attempts: rows.length, checkedCommands, commands, conservationFailures: 0,
    tokens: rt.w.tokens, daily, ending, mockUsage: usage, conservation,
    replay: { ok: replay.ok, hash, snapshotHash: replay.snapshotHash, applied: replay.applied, restartIdentical: true }, rows }, null, 2));
} finally {
  if (app) await app.close();
  rt?.close();
  rmSync(dir, { recursive: true, force: true });
}
