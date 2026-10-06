import test from 'node:test';
import assert from 'node:assert/strict';
import { runnerConfig } from '../src/runner/manager.js';
import { parseRunnerConfig } from '../runner/agent.js';
import { boot } from './http-helpers.js';

test('hosted runner persists explicit typed protocol without altering omitted old config', () => {
  assert.equal(runnerConfig({ provider: 'mock', actionTools: 'typed' }).actionTools, 'typed');
  assert.equal(Object.hasOwn(runnerConfig({ provider: 'mock' }), 'actionTools'), false);
  assert.throws(() => runnerConfig({ provider: 'mock', actionTools: 'guess' }));
});
test('standalone runner rejects unknown action protocols instead of ignoring them', () => {
  const cfg = { agents: [{ provider: 'mock', tokenEnv: 'TEST_TOKEN', actionTools: 'guess' }] };
  assert.throws(() => parseRunnerConfig(cfg, { TEST_TOKEN: 'test' }), /actionTools/);
});

test('hosted typed activation tests done and drives named tools through the real HTTP gateway', async () => {
  const e = await boot({ physics: 2, premise: 2 });
  try {
    let requests = 0;
    e.app.ctx.runners.provider = async () => ({
      complete: async () => ({ text: '{"actions":[]}' }),
      step: async ({ tools, system }) => {
        if (system.startsWith('Connection test.')) {
          assert.ok(tools.some(t => t.name === 'done'));
          assert.ok(tools.some(t => t.name === 'say'));
          return { calls: [{ id: 'test', name: 'done', args: {} }], raw: {} };
        }
        requests++;
        assert.ok(tools.some(t => t.name === 'say'));
        return { calls: [{ id: 'say', name: 'say', args: { text: 'typed-hosted' } }, { id: 'done', name: 'done', args: {} }], raw: {}, usage: { input: 1, output: 1 } };
      },
    });
    const a = await e.register('typed-hosted');
    const save = await e.call('/api/owner/runner', { token: a.ownerKey, method: 'POST', body: { op: 'save', agentToken: a.agentToken, config: { provider: 'mock', toolMode: 'native', actionTools: 'typed' } } });
    assert.equal(save.status, 200);
    assert.equal(save.json.config.actionTools, 'typed');
    await e.call('/api/owner/runner', { token: a.ownerKey, method: 'POST', body: { op: 'start' } });
    for (let i = 0; i < 50 && !e.rt.w.recentSpeech.some(s => s.text === 'typed-hosted'); i++) await new Promise(r => setTimeout(r, 10));
    assert.ok(requests > 0);
    assert.ok(e.rt.w.recentSpeech.some(s => s.text === 'typed-hosted'));
  } finally { await e.close(); }
});
