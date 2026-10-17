import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from './http-helpers.js';
import { runnerConfig } from '../src/runner/manager.js';
import { TraceStore } from '../src/runner/traces.js';

async function waitForTrace(traces, count) {
  for (let i = 0; i < 200; i++) {
    if (traces.agentsDay(traces.today()).totals.wakings >= count) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('managed waking did not reach attention telemetry');
}

for (const premise of [6, 7]) {
  test(`P${premise} managed wakings and resource refusals reach persisted attention APIs without private text`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'as4-managed-attention-'));
    const hidden = premise === 7
      ? JSON.parse(readFileSync(new URL('./fixtures/p7-hidden-physics.json', import.meta.url), 'utf8'))
      : { version: 1, regrowth: { baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 }, thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 }, factorPermille: 500 }, construction: { fullActionsPerTick: 2, factorPermille: 500 } };
    const hiddenPhysicsFile = join(dir, 'physics.json');
    writeFileSync(hiddenPhysicsFile, JSON.stringify(hidden));
    const env = await boot({ physics: 2, premise, map: premise === 7 ? 'island-three-v1' : 'compact-materials-v1', hiddenPhysicsFile, tickMs: 900000 }, { dir });
    try {
      const setup = await env.call('/api/account/setup', { method: 'POST', headers: { 'X-Houren-Request': '1' }, body: { username: 'observer', displayName: 'Observer', password: 'test-password-1234', adminKey: env.cfg.adminKey } });
      assert.equal(setup.status, 201, setup.text);
      const accountId = setup.json.user.id;
      const created = env.rt.exec('account', { op: 'create', accountId, requestId: 'attention-resident', name: '观察居民', soul: 'PRIVATE-SOUL', lang: 'zh', model: 'PRIVATE-MODEL', dailyCap: 1000000, ...(premise === 7 ? { city: 'north' } : {}) }).result;
      assert.equal(created.ok, true, JSON.stringify(created));
      const id = created.agentId, { runners, traces } = env.app.ctx;
      let calls = 0;
      runners.provider = () => ({ step: async () => { calls++; return { text: 'PRIVATE-REPLY', calls: [], usage: { input: 11, output: 7 }, stop: 'stop' }; } });
      await runners.attachManaged(id, accountId, { ...runnerConfig({ provider: 'mock', toolMode: 'native' }), model: 'PRIVATE-MODEL' }, true);
      await waitForTrace(traces, 1);
      await runners.pause(id);
      assert.equal(calls, 1);
      const first = await env.call('/api/admin/attention', { admin: true });
      assert.equal(first.status, 200);
      assert.equal(first.json.totals.wakings, 1);
      assert.equal(first.json.agents[0].agentId, id);
      assert.deepEqual(first.json.agents[0].tokens, { in: 11, out: 7 });

      // A living resident can be unable to pay for another waking. This is
      // telemetry too, even though the provider must not be called again.
      env.rt.w.agents[id].energy = 0;
      env.rt.w.agents[id].basic = 0;
      runners.start(id);
      await waitForTrace(traces, 2);
      await runners.pause(id);
      assert.equal(calls, 1);
      const admin = await env.call('/api/admin/attention', { admin: true });
      assert.equal(admin.json.totals.refused.tokens_exhausted, 1);
      assert.equal((await env.call('/api/admin/attention')).status, 401);
      const pub = await env.call('/api/public/attention?days=1');
      assert.equal(pub.status, 200);
      assert.equal(pub.json.days[0].residents, 1);
      assert.equal(pub.json.days[0].wakingsPerResident, 2);
      assert.equal(pub.json.days[0].refused.tokens_exhausted, 1);
      assert.ok(!/PRIVATE|agentId|观察居民/.test(pub.text));
      assert.ok(!/PRIVATE-SOUL|PRIVATE-REPLY/.test(admin.text));
      const file = join(env.rt.dir, 'agent-loops.jsonl');
      assert.ok(!/PRIVATE-SOUL|PRIVATE-REPLY/.test(readFileSync(file, 'utf8')));
      const reload = new TraceStore({ file, premise, timezone: env.cfg.shellTz });
      assert.deepEqual(reload.agentsDay(traces.today()), traces.agentsDay(traces.today()));
    } finally { await env.close(); }
  });
}
