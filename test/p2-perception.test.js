// SPEC-P2 T2：第二前提的感知——开放提案的读法（E2）、维持费与宣告的提示（F5）、you.standing、you.muted、attention。
// premise 0、1 的感知与渲染逐字节不变由 p2-golden.test.js 保证；这里只测第二前提多出来的东西，以及它们在 premise 0、1 里不出现。
import test from 'node:test';
import assert from 'node:assert/strict';
import e2 from '../src/e2/facade.js';
import { cpLength } from '../src/text.js';
import { P } from '../src/e2/params.js';
import { renderRules } from '../src/e2/rules/render.js';
import { clockDay } from '../src/e2/world.js';
import { createShellClient } from '../src/shells/client.js';
import { DEFAULT_AGENT_LOOP } from '../runner/loop.js';
import { newWorld, reg, one, setHoldings, putAt, tickDays } from './e2-helpers.js';
import { enact } from './e2-law-helpers.js';
import { boot } from './http-helpers.js';

const per = (w, a, lang = 'zh') => e2.buildPerception(w, a.id, { lang, ack: false });

/** 一座有 n 位居民的城；住了几日（居民成了公民），都在议会，能量充足 */
function town(n, seed, premise) {
  const w = newWorld(seed, { premise, shellSlots: 12 });
  const people = Array.from({ length: n }, (_, i) => reg(w, `居民${i + 1}`));
  tickDays(w, 3);
  for (const a of people) { setHoldings(w, a, { energy: 100 }); putAt(w, a, 'parliament'); }
  return { w, people };
}

/** 读法很长的一组规则：8 条每日宣告，每条一段 250 字符的英文 */
const longRules = (len = 250) => Array.from({ length: 8 }, (_, i) => ({ when: 'daily', do: [{ op: 'announce', to: 'all', text: `${i}`.padEnd(len, 'x') }] }));
const fullReading = (rules, lang = 'zh') => renderRules(rules, lang, {}).join('\n');

// ═══════════════════════════════════════════════════════════════
// E2：进行中的提案，读法至多 2000
// ═══════════════════════════════════════════════════════════════

test('P2 T2 E2: 进行中的提案的读法在 2000 处截断（末尾「…」），带 readingTruncated 与原长；法律与程序、章程仍是 400', () => {
  const { w, people } = town(2, 'e2-long', 2);
  const [a, b] = people;
  const rules = longRules();
  const full = fullReading(rules);
  assert.ok(cpLength(full) > P.proposalReadingMax, `读法 ${cpLength(full)} 字符，应当超过 ${P.proposalReadingMax}`);
  const r = one(w, a, { type: 'propose', title: '长读法', text: '很多条宣告', rules });
  assert.equal(r.ok, true, JSON.stringify(r));
  const q = per(w, b).city.proposals[0];
  assert.equal(cpLength(q.reading), P.proposalReadingMax);
  assert.ok(q.reading.endsWith('…'));
  assert.equal(q.reading, `${[...full].slice(0, P.proposalReadingMax - 1).join('')}…`);
  assert.equal(q.readingTruncated, true);
  assert.equal(q.readingLength, cpLength(full));
  // 英文
  const qen = per(w, b, 'en').city.proposals[0];
  assert.equal(qen.readingTruncated, true);
  assert.equal(qen.readingLength, cpLength(fullReading(rules, 'en')));
  // 不超过 2000 的读法原样给出，不带标记
  const r2 = one(w, b, { type: 'propose', title: '短读法', text: '一条', rules: [{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '早安' }] }] });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const short = per(w, a).city.proposals.find((x) => x.id === r2.data.proposal);
  assert.equal(Object.hasOwn(short, 'readingTruncated'), false);
  assert.equal(Object.hasOwn(short, 'readingLength'), false);
  assert.ok(cpLength(short.reading) < 400);
  // 在效的法律仍是 400
  const law = enact(w, longRules(), { title: '长法', author: a.id });
  const entry = per(w, a).city.laws.find((l) => l.id === law.id);
  assert.ok(cpLength(entry.reading) <= P.readingInPerception);
  assert.ok(entry.reading.endsWith('…'));
  assert.equal(Object.hasOwn(entry, 'readingTruncated'), false, '只有进行中的提案带 readingTruncated');
});

test('P2 T2 E2: 设定 0、1 的世界里，进行中的提案的读法仍是 400，没有 readingTruncated', () => {
  for (const premise of [0, 1]) {
    const { w, people } = town(2, `e2-old-${premise}`, premise);
    const [a, b] = people;
    const r = one(w, a, { type: 'propose', title: '长读法', text: '很多条宣告', rules: longRules() });
    assert.equal(r.ok, true, JSON.stringify(r));
    const q = per(w, b).city.proposals[0];
    assert.equal(cpLength(q.reading), P.readingInPerception, `premise ${premise}`);
    assert.equal(Object.hasOwn(q, 'readingTruncated'), false);
    assert.equal(Object.hasOwn(q, 'upkeep'), false);
    assert.equal(Object.hasOwn(q, 'announces'), false);
  }
});

// ═══════════════════════════════════════════════════════════════
// F5：维持费与宣告
// ═══════════════════════════════════════════════════════════════

test('P2 T2 F5: 法律与提案带 upkeep（每日维持费）与 announces（有没有宣告，含 each 里的）；立法程序与没有规则的为 0', () => {
  const { w, people } = town(2, 'f5', 2);
  const [a, b] = people;
  // 遗法：l1 是立法程序（0），l2 一条持续规则（1），l3 的 enact 不算、daily 算（1），l4 两条（2）
  const byId = Object.fromEntries(per(w, a).city.laws.map((l) => [l.id, l]));
  assert.deepEqual(['l1', 'l2', 'l3', 'l4', 'l5', 'l6'].map((id) => byId[id].upkeep), [0, 1, 1, 2, 1, 1]);
  assert.ok(Object.values(byId).every((l) => l.announces === false));
  // enact 不付维持费；daily、monthly 付
  const law = enact(w, [
    { when: 'enact', do: [{ op: 'set', var: 'x', value: '1' }] },
    { when: 'daily', do: [{ op: 'announce', to: 'all', text: '每日一句' }] },
    { when: 'monthly', do: [{ op: 'set', var: 'y', value: '2' }] },
  ], { title: '带宣告', author: a.id });
  let e = per(w, a).city.laws.find((l) => l.id === law.id);
  assert.equal(e.upkeep, 2 * P.ruleUpkeep);
  assert.equal(e.announces, true);
  // 宣告在 each 里面
  const nested = enact(w, [{ when: 'daily', do: [{ op: 'each', in: "tagged('citizen')", do: [{ op: 'announce', to: 'all', text: '你好' }] }] }], { title: '逐个宣告', author: a.id });
  e = per(w, a).city.laws.find((l) => l.id === nested.id);
  assert.equal(e.announces, true);
  assert.equal(e.upkeep, 1);
  const plain = enact(w, [{ when: 'daily', do: [{ op: 'each', in: "tagged('citizen')", do: [{ op: 'set', var: 'z', value: '1' }] }] }], { title: '逐个计数', author: a.id });
  assert.equal(per(w, a).city.laws.find((l) => l.id === plain.id).announces, false);
  // 提案按它的规则计算
  const r = one(w, a, { type: 'propose', title: '提案里的宣告', text: 'x', rules: [
    { when: 'daily', do: [{ op: 'announce', to: 'all', text: '早' }] },
    { when: 'monthly', do: [{ op: 'set', var: 'm', value: '1' }] },
    { when: 'enact', do: [{ op: 'set', var: 'e', value: '1' }] },
  ] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const q = per(w, b).city.proposals.find((x) => x.id === r.data.proposal);
  assert.deepEqual([q.upkeep, q.announces], [2, true]);
  // 立法程序的提案没有规则：0、false
  const none = one(w, b, { type: 'propose', title: '不再立法', text: 'x', procedure: { ordinary: { none: true }, constitutional: { none: true } } });
  assert.equal(none.ok, true, JSON.stringify(none));
  const qp = per(w, a).city.proposals.find((x) => x.id === none.data.proposal);
  assert.deepEqual([qp.upkeep, qp.announces], [0, false]);
});

test('P2 T2 F5: 设定 0、1 的法律没有 upkeep 与 announces', () => {
  for (const premise of [0, 1]) {
    const { w, people } = town(1, `f5-old-${premise}`, premise);
    assert.ok(per(w, people[0]).city.laws.every((l) => !Object.hasOwn(l, 'upkeep') && !Object.hasOwn(l, 'announces')));
  }
});

// ═══════════════════════════════════════════════════════════════
// you.standing、you.muted
// ═══════════════════════════════════════════════════════════════

test('P2 T2: you.standing 与 standingMax、you.muted——只在第二前提；停摆按 paidThrough 与今日比；muted 过滤掉不存在的、屏蔽匿名写 "anonymous"', () => {
  const { w, people } = town(3, 'standing-view', 2);
  const [a, b] = people;
  const p0 = per(w, a).you;
  assert.deepEqual(p0.standing, []);
  assert.equal(p0.standingMax, P.standingMax);
  assert.deepEqual(p0.muted, []);
  const day = clockDay(w);
  a.standing = [
    { when: 'inbox:offer', if: "it.from.id == 'a3'", do: [{ type: 'accept', offer: '=it.offerId' }], times: null, untilDay: null, fired: 2, seen: 0, paidThrough: day },
    { when: 'daily', if: null, do: [{ type: 'say', text: '早' }], times: 5, untilDay: day + 9, fired: 0, seen: 0, paidThrough: day - 1 },
  ];
  a.muted = [b.id, 'anonymous', 'a99'];
  const you = per(w, a).you;
  assert.deepEqual(you.standing, [
    { index: 0, when: 'inbox:offer', if: "it.from.id == 'a3'", do: [{ type: 'accept', offer: '=it.offerId' }], times: null, untilDay: null, fired: 2, suspended: false },
    { index: 1, when: 'daily', if: null, do: [{ type: 'say', text: '早' }], times: 5, untilDay: day + 9, fired: 0, suspended: true },
  ]);
  assert.deepEqual(you.muted, [{ id: b.id, name: b.name }, 'anonymous']);
  // 感知里的 do 是副本：改它不会改世界
  you.standing[0].do[0].type = 'give';
  assert.equal(a.standing[0].do[0].type, 'accept');
  // 别人看不到：感知只给本人，别人的 you 里是它自己的
  assert.deepEqual(per(w, b).you.standing, []);
  // 设定 0、1 没有这三个字段
  for (const premise of [0, 1]) {
    const o = town(1, `standing-old-${premise}`, premise);
    const y = per(o.w, o.people[0]).you;
    for (const k of ['standing', 'standingMax', 'muted']) assert.equal(Object.hasOwn(y, k), false, `${premise}/${k}`);
  }
});

// ═══════════════════════════════════════════════════════════════
// attention（HTTP 层附加）
// ═══════════════════════════════════════════════════════════════

test('P2 T2: attention——只在第二前提、只在醒着时出现，值来自 rt.agentLoop（缺省 DEFAULT_AGENT_LOOP），三种客户端看到同一组数', async () => {
  const env = await boot({ physics: 2, premise: 2, shellSlots: 8, seed: 'attention' });
  try {
    const me = await env.register('甲');
    const get = async (lang = 'zh') => (await env.call(`/api/me?lang=${lang}`, { token: me.agentToken })).json;
    // 缺省值
    assert.deepEqual(DEFAULT_AGENT_LOOP, { turns: 4, looks: 6, lookChars: 3000, wakes: 2, wakeTurns: 2, marginSec: 60, debounceSec: 20 });
    assert.deepEqual((await get()).attention, DEFAULT_AGENT_LOOP);
    assert.deepEqual((await get('en')).attention, DEFAULT_AGENT_LOOP);
    // 来自配置：改 rt.agentLoop，感知里的值随之变
    const custom = { turns: 3, looks: 9, lookChars: 1000, wakes: 1, wakeTurns: 1, marginSec: 30, debounceSec: 5 };
    env.rt.agentLoop = custom;
    const p = await get();
    assert.deepEqual(p.attention, custom);
    p.attention.turns = 99; // 响应是副本：不会改配置
    assert.equal(env.rt.agentLoop.turns, 3);
    // 进程内客户端（躯壳用）走同一个 meCore
    const shell = createShellClient(env.rt, me.agentId, { cursors: new Map() });
    assert.deepEqual((await shell.me({ lang: 'zh' })).json.attention, custom);
    // 感知里的位置：顶层，在 protocol / premise / lang 之后，不属于 you
    assert.equal(Object.hasOwn(p.you, 'attention'), false);
    assert.equal(p.premise, 2);
    // 沉睡、长眠：没有 attention
    env.rt.w.agents[me.agentId].status = 'dormant';
    env.rt.w.agents[me.agentId].dormantSinceDay = 0;
    assert.equal(Object.hasOwn(await get(), 'attention'), false);
    env.rt.w.agents[me.agentId].status = 'dead';
    assert.equal(Object.hasOwn(await get(), 'attention'), false);
  } finally {
    await env.close();
  }
});

test('P2 T2: attention——设定 0、1 的世界里没有', async () => {
  for (const premise of [0, 1]) {
    const env = await boot({ physics: 2, ...(premise ? { premise, shellSlots: 8 } : {}), seed: `attention-old-${premise}` });
    try {
      const me = await env.register('甲');
      const p = (await env.call('/api/me', { token: me.agentToken })).json;
      assert.equal(Object.hasOwn(p, 'attention'), false, `premise ${premise}`);
      const shell = createShellClient(env.rt, me.agentId, { cursors: new Map() });
      assert.equal(Object.hasOwn((await shell.me({})).json, 'attention'), false);
    } finally {
      await env.close();
    }
  }
});
