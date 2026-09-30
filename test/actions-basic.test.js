import test from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/params.js';
import { applyCommand } from '../src/engine/index.js';
import { setBlocklist } from '../src/moderation.js';
import { newWorld, reg, sha, act, actRaw, one, tick, settle, eventsOf, assertInvariants } from './helpers.js';

const fresh = () => {
  const w = newWorld();
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  const c = reg(w, '丙');
  return { w, a, b, c };
};

// ── invalid_args 的说明（让模型能据以纠正） ─────────────────────

test('invalid_args 带说明：没有这个动作、缺少必填参数、参数不合法时给出用法——真实的 GLM 联调里，模型只看到「参数缺失、越界或组合不合法」，猜不出错在哪', () => {
  const { w, a } = fresh();
  // 没有这个动作：列出可用的动作
  let r = one(w, a, { type: 'propose_law', title: 'x' });
  assert.equal(r.error.code, 'invalid_args');
  assert.ok(r.error.hint.zh.includes('没有这个动作：propose_law') && r.error.hint.zh.includes(' propose ') && r.error.hint.zh.includes('：move say '));
  assert.ok(r.error.hint.en.includes('There is no such action: propose_law'));
  // 缺少必填参数：点名缺哪些（可选参数带 ? 的不算；「a | b」二选一的不查）
  r = one(w, a, { type: 'initiate', facility: 'road' });
  assert.equal(r.error.code, 'invalid_args');
  assert.equal(r.error.hint.zh, '缺少必填参数：name。用法：initiate(facility, name, owner?, to?, inscription?)');
  assert.ok(r.error.hint.en.startsWith('Missing required parameter(s): name. Usage: initiate('));
  r = one(w, a, { type: 'define' });
  assert.equal(r.error.hint.zh, '缺少必填参数：word、meaning。用法：define(word, meaning)', '不带任何参数');
  // 参数都给了但组合不对（道路没有 to）：给出用法与说明，说明里写着「道路须给出 to」
  r = one(w, a, { type: 'initiate', facility: 'road', name: '源井路' });
  assert.equal(r.error.code, 'invalid_args');
  assert.ok(r.error.hint.zh.startsWith('参数不合法') && r.error.hint.zh.includes('道路须给出 to'), r.error.hint.zh);
  assert.ok(r.error.hint.en.includes('a road needs to'));
  // propose 的说明里带着法律效力的语法（{effects} 已填入），remember 的槽位数（{memorySlots}）也是
  a.place = 'parliament';
  r = one(w, a, { type: 'propose', title: 5, text: '文' }); // 标题不是字符串：没有专门的说明，回落到用法与说明
  assert.equal(r.error.code, 'invalid_args');
  assert.ok(r.error.hint.zh.includes('"type":"set"') && !r.error.hint.zh.includes('{effects}'), r.error.hint.zh.slice(0, 200));
  assert.ok(r.error.hint.en.includes('"type":"set"') && !r.error.hint.en.includes('{effects}'));
  // 已经有专门说明的（effects 不是数组）保持原样
  r = one(w, a, { type: 'propose', title: '题', text: '文', effects: 'not-an-array' });
  assert.equal(r.error.code, 'invalid_args');
  assert.ok(r.error.hint.zh.startsWith('effects 必须是最多 5 条的数组'), r.error.hint.zh);
  r = one(w, a, { type: 'remember', text: '' });
  assert.ok(!/\{memorySlots\}/.test(JSON.stringify(r.error.hint)));
  // 已经有专门说明的失败（如出工超过所需）保持原样；其他错误码不受影响
  const wrongPlace = one(w, a, { type: 'draw', energy: 3 });
  assert.equal(wrongPlace.error.code, 'wrong_place');
  assert.equal(wrongPlace.error.hint, undefined);
  // 说明只是对结果的文字说明，不进入世界状态：同样的失败不改变哈希（除了动作次数计数，用两个世界对照）
  const w2 = newWorld();
  const a2 = reg(w2, '甲');
  reg(w2, '乙');
  reg(w2, '丙');
  one(w2, a2, { type: 'initiate', facility: 'road' });
  const w3 = newWorld();
  const a3 = reg(w3, '甲');
  reg(w3, '乙');
  reg(w3, '丙');
  one(w3, a3, { type: 'nonexistent' });
  assert.deepEqual(Object.keys(w2.agents.a1).sort(), Object.keys(w3.agents.a1).sort());
  assertInvariants(w);
});

// ── 请求级 ─────────────────────────────────────────────────

test('act：请求级错误——未知 agent、格式错误、动作过多、沉睡、暂停', () => {
  const { w, a } = fresh();
  const go = (payload) => applyCommand(w, { type: 'act', payload }).result;
  assert.equal(go({ agentId: 'a99', actions: [] }).error.code, 'not_found');
  assert.equal(go({ agentId: a.id }).error.code, 'invalid_request');
  assert.equal(go({ agentId: a.id, actions: 'say' }).error.code, 'invalid_request');
  assert.equal(go({ agentId: a.id, actions: [1] }).error.code, 'invalid_request');
  assert.equal(go({ agentId: a.id, actions: [null] }).error.code, 'invalid_request');
  assert.equal(go({ agentId: a.id, actions: [[]] }).error.code, 'invalid_request');
  assert.equal(go({ agentId: a.id, actions: Array(5).fill({ type: 'say', text: 'x' }) }).error.code, 'invalid_request');
  assert.equal(go({ agentId: a.id, thought: 5, actions: [] }).error.code, 'invalid_request');
  assert.deepEqual(go({ agentId: a.id, actions: [] }).results, []); // 什么都不做是合法的
  a.status = 'dormant';
  assert.deepEqual(go({ agentId: a.id, actions: [] }), { ok: false, error: { code: 'not_awake', status: 'dormant' } });
  a.status = 'awake';
  w.paused = true;
  assert.equal(go({ agentId: a.id, actions: [] }).error.code, 'paused');
});

test('act：请求合法时总是 ok，每个动作的成败写在 results 里；失败的动作不扣能量但占用次数', () => {
  const { w, a } = fresh();
  const r = act(w, a, [
    { type: 'say', text: '你好' },
    { type: 'nonsense' },
    { type: 'move', to: 'nowhere' },
    { type: 'say', text: '再见' },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.map((x) => x.ok), [true, false, false, true]);
  assert.equal(r.results[1].error.code, 'invalid_args');
  assert.equal(r.results[2].error.code, 'invalid_args');
  assert.equal(r.results[0].cost, 1);
  assert.equal(r.results[1].cost, 0);
  assert.equal(a.energy, 40 - 2);
  assert.equal(r.you.actionsLeft, 0);
  // 本刻已用完 4 次：第 5 个动作 budget_exhausted，且不再占用
  const r2 = act(w, a, [{ type: 'say', text: 'x' }]);
  assert.equal(r2.results[0].error.code, 'budget_exhausted');
  assert.equal(a.energy, 38);
  // 新的一刻，预算恢复
  tick(w);
  assert.equal(act(w, a, [{ type: 'say', text: 'x' }]).results[0].ok, true);
});

test('act：能量不足时失败、不扣能量；零能量仍可做免费动作', () => {
  const { w, a } = fresh();
  one(w, a, { type: 'give', to: 'treasury', energy: 40 });
  tick(w);
  assert.equal(a.energy, 0);
  const r = one(w, a, { type: 'say', text: '有人吗' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'insufficient_energy');
  assert.equal(a.energy, 0);
  assert.equal(one(w, a, { type: 'remember', text: '免费' }).ok, true);
  assertInvariants(w);
});

test('thought：成为延迟公开的独白事件；超长按码点截断；未通过审核则整个请求 422', () => {
  const { w, a } = fresh();
  const { events } = actRaw(w, a, [{ type: 'say', text: 'hi' }], '先去看看。');
  const th = eventsOf(events, 'thought');
  assert.equal(th.length, 1);
  assert.equal(th[0].vis, 'delayed');
  assert.equal(th[0].releaseTick, w.clock.tick + P.privateDelayTicks);
  assert.equal(th[0].agent, a.id);
  assert.equal(th[0].data.text, '先去看看。');
  tick(w);
  const long = eventsOf(actRaw(w, a, [], '长'.repeat(400)).events, 'thought')[0];
  assert.equal([...long.data.text].length, 300);
  setBlocklist(['禁语']);
  try {
    tick(w);
    const r = applyCommand(w, { type: 'act', payload: { agentId: a.id, thought: '这是禁语', actions: [{ type: 'say', text: 'x' }] } }).result;
    assert.deepEqual(r, { ok: false, error: { code: 'moderated', field: 'thought' } });
    assert.equal(a.actsThisTick, 0);
  } finally {
    setBlocklist([]);
  }
});

// ── move ───────────────────────────────────────────────────

test('move：花 1 能量前往另一地点；原地、未知地点失败；产生 move 事件', () => {
  const { w, a } = fresh();
  const { result, events } = actRaw(w, a, [{ type: 'move', to: 'agora' }]);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].cost, 1);
  assert.equal(a.place, 'agora');
  assert.equal(a.energy, 39);
  const mv = eventsOf(events, 'move')[0];
  assert.deepEqual(mv.data, { from: 'port', to: 'agora' });
  assert.equal(mv.place, 'agora');
  assert.equal(w.places.agora.activity.visits, 1);
  assert.equal(one(w, a, { type: 'move', to: 'agora' }).error.code, 'already');
  assert.equal(one(w, a, { type: 'move', to: 'atlantis' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'move', to: 7 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'move' }).error.code, 'invalid_args');
});

test('move：在议会等 cost 类地点，代价随完好度上升（ceil）', () => {
  const { w, a } = fresh();
  one(w, a, { type: 'move', to: 'parliament' });
  tick(w);
  w.places.parliament.condition = 9940; // 只坏了 0.6%
  const r1 = one(w, a, { type: 'move', to: 'agora' });
  assert.equal(r1.cost, 2); // ceil(1 × 10060 / 10000) = 2
  one(w, a, { type: 'move', to: 'parliament' });
  tick(w);
  w.places.parliament.condition = 0;
  assert.equal(one(w, a, { type: 'move', to: 'agora' }).cost, 2);
  assertInvariants(w);
});

test('move：两端之间有正常运转的道路时免费；道路失修（< 3000）后不再免费', () => {
  const { w, a } = fresh();
  w.facilities.f1 = {
    id: 'f1', type: 'road', name: '路', place: 'port', to: 'agora', owner: { kind: 'city' },
    condition: 5000, decayPerDay: 50, inscription: null, builtDay: 0, projectId: 'j1', contributors: {},
  };
  const r = one(w, a, { type: 'move', to: 'agora' });
  assert.equal(r.cost, 0);
  assert.equal(a.energy, 40);
  w.facilities.f1.condition = 2999;
  assert.equal(one(w, a, { type: 'move', to: 'port' }).cost, 1); // 反方向同样按道路判断
  assertInvariants(w);
});

// ── say / whisper / broadcast ──────────────────────────────

test('say：同一地点醒着的 agent 收到；说话者、沉睡者、别处的人收不到', () => {
  const { w, a, b, c } = fresh();
  const d = reg(w, '丁');
  one(w, c, { type: 'move', to: 'agora' });
  d.status = 'dormant';
  d.energy = 0;
  w.ledger.prev.energy -= 40;
  const { result, events } = actRaw(w, a, [{ type: 'say', text: '各位好' }]);
  assert.equal(result.results[0].ok, true);
  assert.deepEqual(b.inbox.map((i) => [i.kind, i.text, i.from.id, i.place]), [['say', '各位好', a.id, 'port']]);
  assert.equal(a.inbox.length, 0);
  assert.equal(c.inbox.length, 0);
  assert.equal(d.inbox.length, 0);
  const ev = eventsOf(events, 'say')[0];
  assert.deepEqual(ev.data, { text: '各位好', script: 'han' });
  assert.equal(a.script, 'han');
  assert.equal(w.recentSpeech.length, 1);
  assert.equal(w.dayLog.utterances.length, 1);
  assert.equal(w.dayLog.scripts.han, 1);
  assertInvariants(w);
});

test('say：文本校验——超长、为空、类型错误、控制字符被清除', () => {
  const { w, a } = fresh();
  assert.equal(one(w, a, { type: 'say', text: '长'.repeat(501) }).error.code, 'text_too_long');
  assert.equal(one(w, a, { type: 'say', text: '   ' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'say', text: 42 }).error.code, 'invalid_args');
  const { events } = actRaw(w, a, [{ type: 'say', text: 'a\u0000b\u0007c' }]);
  assert.equal(eventsOf(events, 'say')[0].data.text, 'abc');
  assert.equal(one(w, a, { type: 'say', text: '长'.repeat(500) }).ok, true); // 恰好 500 码点
});

test('say：未通过内容审核时返回 moderated、不扣能量', () => {
  const { w, a } = fresh();
  setBlocklist(['badword']);
  try {
    const r = one(w, a, { type: 'say', text: 'this is BadWord!' });
    assert.equal(r.error.code, 'moderated');
    assert.equal(a.energy, 40);
  } finally {
    setBlocklist([]);
  }
});

test('whisper：私语给任意在世的居民（沉睡者醒来后收到）；产生延迟公开事件；对象无效时失败', () => {
  const { w, a, b } = fresh();
  b.status = 'dormant';
  b.energy = 0;
  w.ledger.prev.energy -= 40;
  const { result, events } = actRaw(w, a, [{ type: 'whisper', to: b.id, text: '悄悄话' }]);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].cost, 1);
  assert.deepEqual(b.inbox.map((i) => [i.kind, i.text]), [['whisper', '悄悄话']]);
  const ev = eventsOf(events, 'whisper')[0];
  assert.equal(ev.vis, 'delayed');
  assert.deepEqual(ev.data, { from: a.id, to: b.id, text: '悄悄话' });
  // 按名字引用也可以
  assert.equal(one(w, a, { type: 'whisper', to: '乙', text: '再一句' }).ok, true);
  assert.equal(one(w, a, { type: 'whisper', to: a.id, text: '自言自语' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'whisper', to: 'a99', text: 'x' }).error.code, 'not_found');
  b.status = 'dead';
  assert.equal(one(w, a, { type: 'whisper', to: b.id, text: 'x' }).error.code, 'not_found');
});

test('broadcast：花 5 能量，全城醒着的居民都收到（包括别处的），沉睡者除外', () => {
  const { w, a, b, c } = fresh();
  one(w, c, { type: 'move', to: 'library' });
  const { result, events } = actRaw(w, a, [{ type: 'broadcast', text: '全城注意' }]);
  assert.equal(result.results[0].cost, 5);
  assert.deepEqual(b.inbox.map((i) => i.kind), ['broadcast']);
  assert.deepEqual(c.inbox.map((i) => i.kind), ['broadcast']);
  assert.equal(a.inbox.length, 0);
  assert.equal(eventsOf(events, 'broadcast').length, 1);
  assert.equal(a.energy, 35);
  assertInvariants(w);
});

test('代价修正：雾使私语与宣告加倍；驿站抵消雾并把宣告降到 3；蚀禁止宣告，有驿站时代价 ×2', () => {
  const { w, a } = fresh();
  const relay = {
    id: 'f1', type: 'relay', name: '驿', place: 'agora', to: null, owner: { kind: 'city' },
    condition: 10000, decayPerDay: 80, inscription: null, builtDay: 0, projectId: 'j1', contributors: {},
  };
  w.weather.active.push({ type: 'fog', startDay: 0, endDay: 1 });
  assert.equal(one(w, a, { type: 'whisper', to: '乙', text: 'x' }).cost, 2);
  assert.equal(one(w, a, { type: 'say', text: 'x' }).cost, 1); // 雾不影响 say
  assert.equal(one(w, a, { type: 'broadcast', text: 'x' }).cost, 10);
  tick(w);
  w.facilities.f1 = relay;
  assert.equal(one(w, a, { type: 'whisper', to: '乙', text: 'x' }).cost, 1); // 驿站抵消雾
  assert.equal(one(w, a, { type: 'broadcast', text: 'x' }).cost, 3);
  tick(w);
  w.weather.active.length = 0;
  w.weather.active.push({ type: 'eclipse', startDay: 0, endDay: 1 });
  assert.equal(one(w, a, { type: 'broadcast', text: 'x' }).cost, 6); // 蚀 + 驿站：3 × 2
  tick(w);
  delete w.facilities.f1;
  const r = one(w, a, { type: 'broadcast', text: 'x' });
  assert.equal(r.error.code, 'disabled_by_weather');
  assert.equal(one(w, a, { type: 'say', text: '蚀时仍可说话' }).ok, true);
  assertInvariants(w);
});

test('代价修正：地点倍率与天象一次性 ceil——议会完好度 5000 时雾中宣告 = 15', () => {
  const { w, a } = fresh();
  one(w, a, { type: 'move', to: 'parliament' });
  tick(w);
  w.places.parliament.condition = 5000;
  w.weather.active.push({ type: 'fog', startDay: 0, endDay: 1 });
  assert.equal(one(w, a, { type: 'broadcast', text: 'x' }).cost, 15);
  tick(w);
  w.weather.active.length = 0;
  assert.equal(one(w, a, { type: 'say', text: 'x' }).cost, 2); // ceil(1 × 1.5)
  assertInvariants(w);
});

// ── give ───────────────────────────────────────────────────

test('give：赠予能量与旧币；产生 give 事件与 gift 收件；数额校验', () => {
  const { w, a, b } = fresh();
  const { result, events } = actRaw(w, a, [{ type: 'give', to: b.id, energy: 10, coins: 5, note: '拿去吧' }]);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].cost, 0);
  assert.equal(a.energy, 30);
  assert.equal(a.coins, 15);
  assert.equal(b.energy, 50);
  assert.equal(b.coins, 25);
  assert.deepEqual(b.inbox.map((i) => [i.kind, i.energy, i.coins, i.note]), [['gift', 10, 5, '拿去吧']]);
  const ev = eventsOf(events, 'give')[0];
  assert.deepEqual(ev.data, { from: a.id, to: b.id, energy: 10, coins: 5, tax: { energy: 0, coins: 0 } });
  assert.equal(w.dayLog.coinVolume, 5);
  assert.equal(one(w, a, { type: 'give', to: b.id }).error.code, 'invalid_args'); // 两项都没有
  assert.equal(one(w, a, { type: 'give', to: b.id, energy: 0, coins: 0 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'give', to: b.id, energy: -1 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'give', to: b.id, energy: 1.5 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'give', to: b.id, energy: '5' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'give', to: a.id, energy: 1 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'give', to: 'a99', energy: 1 }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'give', to: b.id, energy: 999 }).error.code, 'insufficient_energy');
  assert.equal(one(w, a, { type: 'give', to: b.id, coins: 999 }).error.code, 'insufficient_coins');
  assert.equal(a.energy, 30);
  assertInvariants(w);
});

test('give：可以给公库；按转赠税扣税进入公库，其余到达对方', () => {
  const { w, a, b } = fresh();
  one(w, a, { type: 'give', to: 'treasury', energy: 10, coins: 3 });
  assert.equal(w.treasury.energy, 10);
  assert.equal(w.treasury.coins, 3);
  w.params.transferTax = 0.1;
  tick(w);
  const r = one(w, a, { type: 'give', to: b.id, energy: 15, coins: 5 });
  assert.deepEqual(r.data.tax, { energy: 1, coins: 0 }); // floor(1.5) = 1，floor(0.5) = 0
  assert.equal(b.energy, 40 + 14);
  assert.equal(b.coins, 20 + 5);
  assert.equal(w.treasury.energy, 10 + 1);
  assert.ok(a.inbox.some((i) => i.kind === 'tax' && i.taxKind === 'transfer' && i.energy === 1));
  assert.deepEqual(b.inbox.find((i) => i.kind === 'gift').tax, { energy: 1, coins: 0 });
  assertInvariants(w);
});

test('give：不能给死者，可以给沉睡者', () => {
  const { w, a, b, c } = fresh();
  b.status = 'dead';
  b.energy = 0;
  w.ledger.prev.energy -= 40;
  assert.equal(one(w, a, { type: 'give', to: b.id, energy: 1 }).error.code, 'not_found');
  c.status = 'dormant';
  c.energy = 0;
  w.ledger.prev.energy -= 40;
  assert.equal(one(w, a, { type: 'give', to: c.id, energy: 2 }).ok, true);
  assert.equal(c.status, 'dormant');
});

// ── remember / forget / diary / will ────────────────────────

test('remember 与 forget：12 个槽位；满了要先 forget；删除后序号前移；产生延迟公开事件', () => {
  const { w, a } = fresh();
  for (let i = 0; i < 12; i++) {
    a.actsThisTick = 0;
    const { result, events } = actRaw(w, a, [{ type: 'remember', text: `记忆${i}` }]);
    assert.equal(result.results[0].ok, true);
    assert.equal(result.results[0].data.index, i);
    assert.equal(eventsOf(events, 'remember')[0].vis, 'delayed');
  }
  assert.equal(one(w, a, { type: 'remember', text: '第十三条' }).error.code, 'memory_full');
  a.actsThisTick = 0;
  const { events } = actRaw(w, a, [{ type: 'forget', index: 3 }]);
  assert.deepEqual(eventsOf(events, 'forget')[0].data, { index: 3, text: '记忆3' });
  assert.equal(a.memories.length, 11);
  assert.equal(a.memories[3].text, '记忆4');
  assert.equal(one(w, a, { type: 'forget', index: 11 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'forget', index: -1 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'forget', index: 'x' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'remember', text: '长'.repeat(201) }).error.code, 'text_too_long');
  assert.equal(a.energy, 40); // 全部免费
  assertInvariants(w);
});

test('diary：只有造者可见的 owner 事件；只保留最近 200 条；不做内容审核', () => {
  const { w, a } = fresh();
  setBlocklist(['秘密']);
  try {
    const { events } = actRaw(w, a, [{ type: 'diary', text: '一个秘密' }]);
    assert.equal(eventsOf(events, 'diary')[0].vis, 'owner');
  } finally {
    setBlocklist([]);
  }
  for (let i = 0; i < 210; i++) one(w, a, { type: 'diary', text: `d${i}` });
  assert.equal(a.diary.length, 200);
  assert.equal(a.diary[199].text, 'd209');
  assert.equal(one(w, a, { type: 'diary', text: 'x'.repeat(1001) }).error.code, 'text_too_long');
});

test('will：校验继承人；新遗嘱替换旧的；不能把自己列为继承人', () => {
  const { w, a, b } = fresh();
  assert.equal(one(w, a, { type: 'will', heirs: [{ to: b.id, share: 2 }, { to: 'treasury', share: 1 }], lastWords: '再见' }).ok, true);
  assert.deepEqual(a.will, { heirs: [{ to: b.id, share: 2 }, { to: 'treasury', share: 1 }], lastWords: '再见' });
  tick(w);
  assert.equal(one(w, a, { type: 'will', heirs: [{ to: '乙', share: 1 }] }).ok, true); // 按名字引用，存 ID
  assert.deepEqual(a.will, { heirs: [{ to: b.id, share: 1 }], lastWords: '' });
  tick(w);
  assert.equal(one(w, a, { type: 'will', heirs: [{ to: a.id, share: 1 }] }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'will', heirs: [{ to: b.id, share: 0 }] }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'will', heirs: [{ to: b.id, share: 1.5 }] }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'will', heirs: [{ to: 'a99', share: 1 }] }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'will', heirs: 'b' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'will', heirs: Array(11).fill({ to: b.id, share: 1 }) }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'will', heirs: [] }).ok, true);
  assert.deepEqual(a.will, { heirs: [], lastWords: '' });
});
