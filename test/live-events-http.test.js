import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';

test('实况最近窗口：一次返回最新 500 条，保留 since 协议及延迟/私密可见性', async () => {
  const env = await boot();
  try {
    const events = Array.from({ length: 2200 }, (_, i) => ({ seq: i + 1, tick: 0, day: 0, type: 'say', vis: 'public', data: { text: `public-${i + 1}` } }));
    env.rt.events.append(events);
    env.rt.events.append([
      { seq: 2201, tick: 0, day: 0, type: 'thought', vis: 'delayed', releaseTick: 5, data: { text: 'delay-secret' } },
      { seq: 2202, tick: 0, day: 0, type: 'letter', vis: 'owner', data: { text: 'owner-secret' } },
      { seq: 2203, tick: 0, day: 0, type: 'diary', vis: 'internal', data: { text: 'internal-secret' } },
    ]);
    const r = await env.call('/api/public/events?recent=1&limit=500');
    assert.equal(r.status, 200);
    assert.equal(r.json.events.length, 500);
    assert.equal(r.json.events[0].seq, 1701);
    assert.equal(r.json.events.at(-1).seq, 2200);
    assert.equal(r.json.last, 2203);
    assert.doesNotMatch(r.text, /secret/);
    const incremental = await env.call('/api/public/events?since=2198&limit=1');
    assert.equal(incremental.json.events[0].seq, 2199);
    env.rt.events.release(5);
    const released = await env.call('/api/public/events?recent=1&since=2203&limit=1');
    assert.equal(released.json.events[0].seq, 2201, '近期按公开顺序读取，包含游标前才释放的消息');
    assert.equal(released.json.events[0].delayed, true);
    assert.equal(released.json.events[0].releaseTick, undefined);
    env.rt.w.redacted.events.push(2201);
    assert.doesNotMatch((await env.call('/api/public/events?recent=1&limit=1')).text, /delay-secret/);
    for (const query of ['recent=2', 'recent=no', 'recent=1&limit=501', 'recent=1&limit=0']) {
      assert.equal((await env.call(`/api/public/events?${query}`)).status, 400);
    }
  } finally { await env.close(); }
});
