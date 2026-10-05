// 2026-10-05 设计方确认的 Q36–Q43；旧世界仍由黄金样本守住。
import test from 'node:test';
import assert from 'node:assert/strict';
import { town } from './p2-helpers.js';
import { one, tick } from './e2-helpers.js';
import e2 from '../src/e2/facade.js';
import { pushInbox } from '../src/e2/engine/core.js';
import { openCity, drive } from './p2-loop-helpers.js';
import { createApp } from '../src/http/server.js';

test('Q36 B：署名私语的 it.anonymous 为 false，匿名私语为 true；不改原收件', () => {
  const { w, people: [a, b] } = town(2, 'q36');
  assert.equal(one(w, a, { type: 'standing', orders: [
    { when: 'inbox:whisper', if: 'not it.anonymous', do: [{ type: 'diary', text: '署名' }] },
    { when: 'inbox:whisper', if: 'it.anonymous', do: [{ type: 'diary', text: '匿名' }] },
  ] }).ok, true);
  one(w, b, { type: 'whisper', to: a.id, text: 'hello' });
  const signed = a.inbox.find((i) => i.kind === 'whisper');
  assert.equal(Object.hasOwn(signed, 'anonymous'), false);
  tick(w, 1);
  assert.deepEqual(a.standing.map((o) => o.fired), [1, 0]);
  assert.equal(w.dayLog.p2.standingErrors, 0);
  one(w, b, { type: 'whisper', to: a.id, text: 'hello', anonymous: true });
  tick(w, 1);
  assert.deepEqual(a.standing.map((o) => o.fired), [1, 1]);
  assert.equal(w.dayLog.p2.standingErrors, 0);
  assert.equal(Object.hasOwn(signed, 'anonymous'), false);
});

test('Q37 B：consent 的即时状态过滤被屏蔽的邀约，解除后恢复', () => {
  const { w, people: [a, b] } = town(2, 'q37');
  one(w, b, { type: 'mute', who: a.id });
  const proposal = one(w, a, { type: 'conceive', name: '新灵魂', soul: '测试灵魂', with: [b.id] });
  assert.equal(proposal.ok, true);
  const perceive = () => e2.buildPerception(w, b.id, { ack: false });
  assert.equal(perceive().you.pacts.length, 0);
  assert.equal(perceive().actions.find((a) => a.type === 'consent').available, false);
  one(w, b, { type: 'mute', who: a.id, on: false });
  assert.equal(perceive().you.pacts.length, 1);
  assert.equal(perceive().actions.find((a) => a.type === 'consent').available, true);
});

test('Q39 B：完整收件仍交给模型，跨刻摘要不列例行系统收件；保留私语与常驻指令', async () => {
  const city = openCity({ seed: 'q39' });
  try {
    const [a, b] = city.ids;
    const person = city.rt.w.agents[a];
    pushInbox(city.rt.w, person, 'tag', { tag: 'routine-marker', on: true });
    pushInbox(city.rt.w, person, 'standing', { order: 0, trigger: { when: 'tick' }, results: [] });
    city.exec(b, [{ type: 'whisper', to: a, text: 'dialogue-marker' }]);
    const out = await drive(city, a, { rounds: 2, after: () => city.rt.tickNow(), cfg: { toolMode: 'native' }, script: [
      { calls: [{ name: 'act', args: { actions: [], end: true } }] },
      { calls: [{ name: 'act', args: { actions: [], end: true } }] },
    ] });
    const first = out.requests[0].transcript[0].text;
    const summary = out.requests[1].transcript[0].text.split('【上一次醒来】')[1];
    assert.ok(first.includes('routine-marker'), '完整的当次收件不裁剪');
    assert.ok(summary.includes('dialogue-marker') && summary.includes('常驻指令'));
    assert.ok(!summary.includes('标签') && !summary.includes('routine-marker'));
  } finally { city.close(); }
});

test('Q41 B：第二前提刻长不足四倍截止余量时只警告，不改变配置；旧世界不警告', async () => {
  for (const [premise, tickMs, expected] of [[2, 1000, 1], [2, 239999, 1], [2, 240000, 0], [2, 900000, 0], [1, 1000, 0], [0, 1000, 0]]) {
    const city = openCity({ seed: `q41-${premise}-${tickMs}`, premise, tickMs });
    const warnings = [];
    const app = createApp(city.rt, city.rt.cfg, { logger: { warn: (x) => warnings.push(x) } });
    try {
      assert.equal(warnings.filter((x) => x.includes('marginSec')).length, expected);
      assert.equal(city.rt.agentLoop.marginSec, 60);
      assert.equal(city.rt.cfg.tickMs, tickMs);
    } finally { await app.close(); city.close(); }
  }
});
