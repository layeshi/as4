import test from 'node:test';
import assert from 'node:assert/strict';
import { waitTickOrWake } from '../runner/loop.js';
import { managedClient } from '../src/runner/managed-client.js';

// waitCore only needs the inbox and wake subscriptions; no world clock or model runs.
function residentWait() {
  const listeners = new Set();
  const agent = { status: 'awake', delivered: 0, inbox: [] };
  const rt = {
    w: { premise: 6, agents: { a1: agent } },
    onWake(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return { client: managedClient({ rt }, 'a1', () => true), agent, listeners };
}

function observeTimers(t) {
  const real = globalThis.setTimeout;
  const delays = [];
  t.mock.method(globalThis, 'setTimeout', (fn, delay, ...args) => {
    delays.push(delay);
    return real(fn, delay, ...args);
  });
  return delays;
}

test('P6 managed waiting never passes a negative delay when its fractional deadline is crossed', async (t) => {
  const base = 1792011364000;
  const times = [base, base + 1000, base + 1001];
  t.mock.method(Date, 'now', () => times.shift() ?? base + 1001);
  t.mock.method(Math, 'random', () => 0.005966796875);
  const delays = observeTimers(t);
  const { client, listeners } = residentWait();
  const timeouts = [];
  const state = {
    cfg: { lang: 'zh' }, deps: {}, cursor: 0, wakeSeen: 0,
    client: { ...client, wait: (args) => { timeouts.push(args.timeoutMs); return client.wait(args); } },
    log: { error() {} }, waitTick: async () => assert.fail('unexpected fallback'),
  };
  const result = await waitTickOrWake(state, {
    premise: 6, you: { routine: { called: true } }, attention: { marginSec: 0 },
    now: { tick: 0, tickMs: 1000, nextTickAt: base + 1000 },
  });
  assert.deepEqual(result, { stop: null, acted: 0 });
  assert.ok(timeouts.length > 0, 'exercise the real managed wait path');
  assert.ok(timeouts.every(ms => ms > 0), `expired waits must end before submission: ${timeouts}`);
  assert.ok(delays.every(ms => ms >= 0), `negative timer delays: ${delays}`);
  assert.equal(listeners.size, 0);
});

test('the managed wait core safely handles an already expired timeout', async (t) => {
  const delays = observeTimers(t);
  const { client, listeners } = residentWait();
  const result = await client.wait({ after: 0, timeoutMs: -0.4033203125 });
  assert.deepEqual(result, { ok: true, status: 200, json: { items: [], cursor: 0 } });
  assert.ok(delays.every(ms => ms >= 0), `negative timer delays: ${delays}`);
  assert.equal(listeners.size, 0);
});

test('a positive managed wait still delivers a wake and cleans up its subscription', async (t) => {
  const delays = observeTimers(t);
  const { client, agent, listeners } = residentWait();
  const waiting = client.wait({ after: 0, timeoutMs: 10000 });
  assert.equal(listeners.size, 1);
  agent.inbox.push({ seq: 1, kind: 'whisper', text: '有人找你' });
  for (const notify of [...listeners]) notify({ agentId: 'a1', seq: 1 });
  assert.deepEqual(await waiting, { ok: true, status: 200, json: { items: [{ seq: 1, kind: 'whisper' }], cursor: 1 } });
  assert.deepEqual(delays, [10000]);
  assert.equal(listeners.size, 0);
});
