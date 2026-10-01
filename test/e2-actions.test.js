// SPEC-E2 §25 第 3 步：第二纪的基础动作——动作框架、移动、发言与代价修正、赠予、记忆、遗嘱。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../src/e2/engine/index.js';
import { HANDLERS, implementedActions } from '../src/e2/engine/actions.js';
import { ACTION_ORDER } from '../src/e2/lore/actions.js';
import { P } from '../src/e2/params.js';
import {
  newWorld, reg, act, actRaw, one, oneWithEvents, grant, fundTreasury, putAt, tick, settle, eventsOf, assertInvariants,
} from './e2-helpers.js';

const world2 = () => {
  const w = newWorld('actions');
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  grant(w, a, 100, 10);
  grant(w, b, 100, 10);
  return { w, a, b };
};

// ═══════════════════════════════════════════════════════════════
// 动作框架
// ═══════════════════════════════════════════════════════════════

test('动作框架：每刻最多 4 个动作，失败的动作不扣能量但占用次数；结果按顺序，后一个看到前一个执行后的状态', () => {
  const { w, a } = world2();
  const before = a.energy;
  const out = act(w, a, [
    { type: 'say', text: '一' }, { type: 'move', to: 'nowhere' }, { type: 'say', text: '三' }, { type: 'say', text: '四' }, { type: 'say', text: '五' },
  ].slice(0, 4));
  assert.equal(out.ok, true);
  assert.deepEqual(out.results.map((r) => [r.index, r.type, r.ok]), [[0, 'say', true], [1, 'move', false], [2, 'say', true], [3, 'say', true]]);
  assert.equal(out.results[1].error.code, 'invalid_args');
  assert.equal(out.results[1].cost, 0);
  assert.equal(a.energy, before - 3, '三个 say 各 1 能量，失败的 move 什么都不扣');
  assert.equal(out.you.actionsLeft, 0);
  assert.equal(a.actsThisTick, 4);
  // 次数用完后的动作：budget_exhausted（需要分两次提交）
  const again = act(w, a, [{ type: 'say', text: '再说' }]);
  assert.equal(again.results[0].error.code, 'budget_exhausted');
  assert.equal(a.energy, before - 3);
  tick(w);
  assert.equal(a.actsThisTick, 0);
  // 后一个动作看到前一个执行后的状态：先移动再说话，说话发生在新地点
  const seq = act(w, a, [{ type: 'move', to: 'school' }, { type: 'say', text: '到了' }]);
  assert.deepEqual(seq.results.map((r) => r.ok), [true, true]);
  assert.equal(a.place, 'school');
  assertInvariants(w);
});

test('动作框架：请求级校验——不是数组、超过 4 个、元素不是对象、独白不是字符串；沉睡 / 暂停 / 未知居民', () => {
  const { w, a } = world2();
  const raw = (payload) => applyCommand(w, { type: 'act', payload }).result;
  assert.equal(raw({ agentId: a.id, actions: 'x' }).error.code, 'invalid_request');
  assert.equal(raw({ agentId: a.id, actions: Array(5).fill({ type: 'say', text: 'x' }) }).error.field, 'actions');
  assert.equal(raw({ agentId: a.id, actions: [null] }).error.code, 'invalid_request');
  assert.equal(raw({ agentId: a.id, actions: [[]] }).error.code, 'invalid_request');
  assert.equal(raw({ agentId: a.id, actions: [], thought: 5 }).error.field, 'thought');
  assert.equal(raw({ agentId: 'a99', actions: [] }).error.code, 'not_found');
  assert.equal(raw({ actions: [] }).error.code, 'not_found');
  assert.equal(raw({ agentId: a.id, actions: [] }).ok, true, '空行动合法');
  a.status = 'dormant';
  assert.deepEqual(raw({ agentId: a.id, actions: [] }).error, { code: 'not_awake', status: 'dormant' });
  a.status = 'awake';
  w.paused = true;
  assert.equal(raw({ agentId: a.id, actions: [] }).error.code, 'paused');
  w.paused = false;
  // 独白：延迟公开的事件；超长按码点截断；审核不过则整个请求被拒
  const { events } = actRaw(w, a, [], '想'.repeat(400));
  const thought = eventsOf(events, 'thought')[0];
  assert.equal(thought.vis, 'delayed');
  assert.equal(Array.from(thought.data.text).length, 300);
  assert.equal(thought.releaseTick, w.clock.tick + P.privateDelayTicks);
  // ackSeq 推进世界里的收件箱游标（只增不减）
  a.inbox.push({ seq: 77, tick: 0, kind: 'system' });
  applyCommand(w, { type: 'act', payload: { agentId: a.id, actions: [], ackSeq: 50 } });
  assert.equal(a.inboxCursor, 50);
  applyCommand(w, { type: 'act', payload: { agentId: a.id, actions: [], ackSeq: 10 } });
  assert.equal(a.inboxCursor, 50);
});

test('动作框架：未知动作与缺参数的 invalid_args 带能据以纠正的说明；动作表与实现一致', () => {
  const { w, a } = world2();
  const unknown = one(w, a, { type: 'frobnicate' });
  assert.equal(unknown.error.code, 'invalid_args');
  assert.match(unknown.error.hint.zh, /没有这个动作：frobnicate。可用的动作：move say/);
  assert.match(unknown.error.hint.en, /There is no such action: frobnicate/);
  const missing = one(w, a, { type: 'give' });
  assert.match(missing.error.hint.zh, /缺少必填参数：to。用法：give\(to, energy\?, coins\?, note\?\)/);
  const bad = one(w, a, { type: 'give', to: 'a2', energy: -1 });
  assert.match(bad.error.hint.zh, /参数不合法/);
  assert.match(one(w, a, { type: 'move', to: 5 }).error.hint.zh, /用法：move\(to\)/);
  // 动作表有 41 个动作；本步已实现其中的一部分，实现的都在表里
  assert.equal(ACTION_ORDER.length, 41);
  for (const t of implementedActions()) assert.ok(ACTION_ORDER.includes(t), t);
  for (const t of ['move', 'say', 'whisper', 'broadcast', 'give', 'offer', 'accept', 'cancel', 'remember', 'forget', 'diary', 'write', 'read', 'define', 'found', 'join', 'leave',
    'admit', 'steward', 'disburse', 'explore', 'repair', 'draw', 'inscribe', 'will', 'epitaph', 'reveal', 'retire']) {
    assert.ok(implementedActions().includes(t), `${t} 已实现`);
  }
  for (const h of Object.values(HANDLERS)) assert.deepEqual([typeof h.validate, typeof h.apply], ['function', 'function']);
});

test('动作框架：费用的原子性——能量不足时什么都不扣、不改变世界；规则钩子未安装时没有拒绝也没有费用', () => {
  const { w, a, b } = world2();
  putAt(w, a, 'market');
  w.treasury.energy += a.energy - 5; // 把多余的能量交回公库（保持账本守恒）
  a.energy = 5;
  fundTreasury(w, 0);
  const snapshot = JSON.stringify([a.energy, a.coins, b.energy, w.treasury, w.offers]);
  const r = one(w, a, { type: 'give', to: b.id, energy: 5 });
  assert.equal(r.ok, true, '能量 5 恰好够 give 5（代价 0）');
  assert.equal(a.energy, 0);
  const r2 = one(w, a, { type: 'say', text: '没有能量了' });
  assert.deepEqual(r2.error, { code: 'insufficient_energy' });
  assert.equal(a.energy, 0);
  grant(w, a, 3, 0);
  const snap2 = JSON.stringify([a.energy, b.energy, w.offers]);
  const r3 = one(w, a, { type: 'offer', give: { energy: 3 }, want: { coins: 1 } });
  assert.equal(r3.error.code, 'insufficient_energy', '代价 1 + 托管 3 > 3');
  assert.equal(JSON.stringify([a.energy, b.energy, w.offers]), snap2);
  assert.equal(r.cost, 0);
  void snapshot;
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// 移动
// ═══════════════════════════════════════════════════════════════

test('move：代价 = 街道图上的最短路（不受完好度倍率影响）；一次到达；不能移到所在之处；荒野永远可以进入', () => {
  const { w, a } = world2();
  const e0 = a.energy;
  const r = one(w, a, { type: 'move', to: 'library' });
  assert.equal(r.ok, true);
  assert.equal(r.cost, 2, 'port → school → library');
  assert.equal(a.place, 'library');
  assert.equal(a.energy, e0 - 2);
  assert.equal(w.places.library.activity.visits, 1);
  assert.equal(one(w, a, { type: 'move', to: 'library' }).error.code, 'already');
  assert.equal(one(w, a, { type: 'move', to: 'atlantis' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'move', to: undefined }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'move', to: '__proto__' }).error.code, 'invalid_args');
  // 完好度低的地点：移动的代价不受倍率影响（只有使用模块的动作才受）
  w.places.library.condition = 0;
  const r2 = one(w, a, { type: 'move', to: 'school' });
  assert.equal(r2.cost, 1);
  // 事件
  const { events } = oneWithEvents(w, a, { type: 'move', to: 'agora' });
  const mv = eventsOf(events, 'move')[0];
  assert.deepEqual([mv.agent, mv.place, mv.data], [a.id, 'agora', { from: 'school', to: 'agora' }]);
  // 去荒野：按路程计价，没有任何物理阻拦
  const far = one(w, a, { type: 'move', to: 'highway' });
  assert.equal(far.ok, true);
  assert.equal(far.cost, 5, 'agora → market 1 → wilds 1 → scrapyard 1 → highway 2');
  assert.equal(a.place, 'highway');
  assertInvariants(w);
});

test('move：到不了的地点（图不连通）为 invalid_args；遗址仍是节点，移动经过遗址', () => {
  const { w, a } = world2();
  w.places.market.razed = true;
  w.places.market.open = true;
  w.places.market.condition = null;
  const r = one(w, a, { type: 'move', to: 'market' });
  assert.equal(r.ok, true, '可以走到遗址上');
  assert.equal(a.place, 'market');
  const r2 = one(w, a, { type: 'move', to: 'wilds' });
  assert.equal(r2.ok, true);
  assert.equal(r2.cost, 1);
});

// ═══════════════════════════════════════════════════════════════
// 发言与代价的修正
// ═══════════════════════════════════════════════════════════════

test('say / whisper / broadcast：谁听得到；收件；词典计数；文字系统；私语与独白延迟公开', () => {
  const { w, a, b } = world2();
  const c = reg(w, '丙');
  grant(w, c, 50);
  putAt(w, c, 'agora');
  const { r, events } = oneWithEvents(w, a, { type: 'say', text: '你好，灯' });
  assert.equal(r.cost, 1);
  assert.deepEqual(b.inbox.at(-1), { seq: b.inbox.at(-1).seq, tick: 0, kind: 'say', from: { id: a.id, name: '甲' }, place: 'port', text: '你好，灯' });
  assert.equal(c.inbox.some((i) => i.kind === 'say'), false, '不在同一地点的听不到');
  assert.equal(eventsOf(events, 'say')[0].data.script, 'han');
  assert.equal(w.recentSpeech.length, 1);
  assert.equal(a.stats.utterances, 1);
  assert.equal(w.places.port.activity.utterances, 1);
  assert.equal(w.dayLog.scripts.han, 1);
  const w2 = one(w, a, { type: 'whisper', to: c.id, text: '悄悄话' });
  assert.equal(w2.cost, 1);
  assert.equal(c.inbox.at(-1).kind, 'whisper');
  assert.equal(c.inbox.at(-1).text, '悄悄话');
  const wh = oneWithEvents(w, a, { type: 'whisper', to: c.id, text: '又一句' }).events.find((e) => e.type === 'whisper');
  assert.equal(wh.vis, 'delayed');
  assert.equal(one(w, a, { type: 'whisper', to: a.id, text: 'x' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'whisper', to: 'a999', text: 'x' }).error.code, 'not_found');
  const bc = one(w, a, { type: 'broadcast', text: '全城听着' });
  assert.equal(bc.cost, 5);
  assert.equal(c.inbox.at(-1).kind, 'broadcast');
  assert.equal(b.inbox.at(-1).kind, 'broadcast');
  assert.equal(w.recentSpeech.length, 1, '宣告不进「近 12 刻的发言簿」');
  // 词典：词在公开发言里出现的次数
  one(w, b, { type: 'define', word: '灯', meaning: '光' });
  one(w, a, { type: 'say', text: '灯灯灯' });
  assert.equal(w.lexicon['灯'].uses, 3);
  assert.deepEqual(w.lexicon['灯'].users, [a.id]);
  assertInvariants(w);
});

test('代价的修正：雾使私语与宣告 ×2（有中继则抵消）；中继使宣告降为 3；蚀时不可宣告（有中继时可宣告，代价 ×2）', () => {
  const { w, a } = world2();
  grant(w, a, 100);
  const cost = (act1) => one(w, a, act1).cost;
  assert.equal(cost({ type: 'whisper', to: 'a2', text: 'x' }), 1);
  assert.equal(cost({ type: 'broadcast', text: 'x' }), 5);
  w.weather.active.push({ type: 'fog', startDay: 0, endDay: 1 });
  assert.equal(cost({ type: 'whisper', to: 'a2', text: 'x' }), 2, '雾：×2');
  assert.equal(cost({ type: 'broadcast', text: 'x' }), 10);
  assert.equal(cost({ type: 'say', text: 'x' }), 1, '说话不受雾影响');
  // 加一个运转中的中继（后人加装的）
  w.places.agora.modules.push({ type: 'relay', salvage: 60, builtDay: 0, projectId: 'j1', inherent: false });
  // 广场是空地，不能装模块：中继必须在有完好度的地点上才运转
  assert.equal(cost({ type: 'broadcast', text: 'x' }), 10, '空地上的「中继」不运转');
  w.places.agora.modules.pop();
  w.places.temple.modules.push({ type: 'relay', salvage: 60, builtDay: 0, projectId: 'j1', inherent: false });
  assert.equal(cost({ type: 'whisper', to: 'a2', text: 'x' }), 1, '中继抵消雾');
  assert.equal(cost({ type: 'broadcast', text: 'x' }), 3, '中继：基础代价 3');
  w.weather.active.length = 0;
  assert.equal(cost({ type: 'broadcast', text: 'x' }), 3);
  // 蚀
  w.weather.active.push({ type: 'eclipse', startDay: 0, endDay: 1 });
  assert.equal(cost({ type: 'broadcast', text: 'x' }), 6, '蚀 + 中继：×2');
  w.places.temple.condition = 2999; // 中继不再运转
  const blocked = one(w, a, { type: 'broadcast', text: 'x' });
  assert.equal(blocked.error.code, 'disabled_by_weather');
  assert.equal(one(w, a, { type: 'say', text: 'x' }).ok, true);
  assertInvariants(w);
});

test('代价倍率只对使用模块的动作：写作、阅读典籍、公开交易、写墓志——ceil(基础 × (20000 − 完好度) / 10000)；其余动作（含说话、移动、铭刻）不受影响', () => {
  const { w, a, b } = world2();
  putAt(w, a, 'library');
  w.places.library.condition = 5000;
  const wr = one(w, a, { type: 'write', title: '题', body: '文' });
  assert.equal(wr.cost, 5, 'ceil(3 × 1.5)');
  assert.equal(one(w, a, { type: 'say', text: '说话' }).cost, 1, '在失修的图书馆说话不受倍率');
  assert.equal(one(w, a, { type: 'inscribe', text: '刻' }).cost, 3, '铭刻不使用模块');
  assert.equal(one(w, a, { type: 'read', doc: 'd1' }).cost, 0, '阅读的基础代价是 0');
  // 完好度低于模块的运转下限（3000）时档案停止运转：不能写作（倍率最高是 1.7，到不了 2）
  w.places.library.condition = 2999;
  assert.deepEqual(one(w, a, { type: 'write', title: '题2', body: '文' }).error, { code: 'no_module', module: 'archive' });
  w.places.library.condition = 3000;
  assert.equal(one(w, a, { type: 'write', title: '题3', body: '文' }).cost, 6, 'ceil(3 × 1.7) = ceil(5.1) = 6');
  // 公开交易（告示板）受倍率；定向交易不受
  putAt(w, a, 'market');
  w.places.market.condition = 5000;
  assert.equal(one(w, a, { type: 'offer', give: { energy: 2 }, want: { coins: 1 } }).cost, 2, 'ceil(1 × 1.5)');
  assert.equal(one(w, a, { type: 'offer', give: { energy: 2 }, want: { coins: 1 }, to: b.id }).cost, 1, '定向交易不使用告示板');
  // 墓志
  putAt(w, a, 'cemetery');
  w.places.cemetery.condition = 5000;
  w.cemetery.push({ agentId: 'a0', name: '逝者', diedDay: 0, cause: 'starvation', ageDays: 3, lastWords: '', memories: [], will: null, epitaphs: [] });
  w.agents.a0 = { id: 'a0', name: '逝者', status: 'dead', energy: 0, coins: 0, place: 'port', groups: [], tags: [], inbox: [], memories: [], will: null, letters: [], stats: {} };
  assert.equal(one(w, a, { type: 'epitaph', deceased: 'a0', text: '安息' }).cost, 2, 'ceil(1 × 1.5)');
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// 赠予、记忆、日记、遗嘱
// ═══════════════════════════════════════════════════════════════

test('give：居民、社群、公库；没有物理的转赠税；给沉睡者使其能量 ≥ 5 时立即醒来；校验', () => {
  const { w, a, b } = world2();
  const g = one(w, a, { type: 'found', name: '会', manifesto: '宣言' }).data.group;
  const t0 = w.treasury.energy;
  const r = one(w, a, { type: 'give', to: b.id, energy: 10, coins: 4, note: '拿着' });
  assert.deepEqual(r.data, { to: b.id, energy: 10, coins: 4 });
  assert.equal(r.cost, 0, 'give 的代价是 0');
  assert.equal(b.energy, 150);
  assert.equal(b.coins, 34);
  assert.deepEqual(b.inbox.at(-1), { seq: b.inbox.at(-1).seq, tick: 0, kind: 'gift', from: { id: a.id, name: '甲' }, energy: 10, coins: 4, note: '拿着' });
  assert.equal(w.treasury.energy, t0, '没有转赠税');
  assert.equal(one(w, a, { type: 'give', to: g, energy: 5 }).data.to, g);
  assert.equal(w.groups[g].treasury.energy, 5);
  assert.equal(one(w, a, { type: 'give', to: 'treasury', coins: 2 }).data.to, 'treasury');
  assert.equal(w.treasury.coins, 2);
  assert.equal(w.dayLog.coinVolume, 6);
  // 校验
  for (const bad of [{ to: a.id, energy: 1 }, { to: b.id }, { to: b.id, energy: 0 }, { to: b.id, energy: -1 }, { to: b.id, energy: 1.5 }, { to: 5, energy: 1 }, { to: b.id, energy: '3' }]) {
    assert.equal(one(w, a, { type: 'give', ...bad }).error.code, 'invalid_args', JSON.stringify(bad));
  }
  assert.equal(one(w, a, { type: 'give', to: 'a999', energy: 1 }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'give', to: b.id, energy: 10 ** 6 }).error.code, 'insufficient_energy');
  assert.equal(one(w, a, { type: 'give', to: b.id, coins: 10 ** 6 }).error.code, 'insufficient_coins');
  // 唤醒
  b.status = 'dormant';
  b.dormantSinceDay = 0;
  w.treasury.energy += b.energy;
  b.energy = 0;
  const { r: wake, events } = oneWithEvents(w, a, { type: 'give', to: b.id, energy: 4 });
  assert.equal(wake.ok, true);
  assert.equal(b.status, 'dormant', '4 < 5：还不够唤醒');
  const { events: ev2 } = oneWithEvents(w, a, { type: 'give', to: b.id, energy: 1 });
  assert.equal(b.status, 'awake');
  assert.equal(eventsOf(ev2, 'revive').length, 1);
  assert.equal(b.dormantSinceDay, null);
  assert.equal(b.inbox.at(-1).kind, 'revived');
  void events;
  assertInvariants(w);
});

test('remember / forget / diary：记忆槽位、from 为 null、延迟公开的事件、日记只有造者能看到', () => {
  const { w, a } = world2();
  for (let i = 0; i < P.memorySlots; i++) assert.equal(one(w, a, { type: 'remember', text: `记忆${i}` }).data.index, i);
  assert.equal(one(w, a, { type: 'remember', text: '满了' }).error.code, 'memory_full');
  assert.deepEqual(a.memories[0], { day: 0, tick: 0, text: '记忆0', from: null });
  const { r, events } = oneWithEvents(w, a, { type: 'forget', index: 3 });
  assert.equal(r.ok, true);
  assert.equal(eventsOf(events, 'forget')[0].vis, 'delayed');
  assert.equal(a.memories.length, P.memorySlots - 1);
  assert.equal(one(w, a, { type: 'forget', index: 99 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'forget', index: -1 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'remember', text: '' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'remember', text: 'x'.repeat(201) }).error.code, 'text_too_long');
  const d = oneWithEvents(w, a, { type: 'diary', text: '日记' });
  assert.equal(eventsOf(d.events, 'diary')[0].vis, 'owner');
  assert.equal(a.diary.length, 1);
  for (let i = 0; i < 210; i++) {
    a.actsThisTick = 0;
    applyCommand(w, { type: 'act', payload: { agentId: a.id, actions: [{ type: 'diary', text: `d${i}` }] } });
  }
  assert.equal(a.diary.length, P.diaryKeep);
  assertInvariants(w);
});

test('will：继承人最多 10 个、份额为正整数、不能是自己、可以是公库；新的遗嘱替换旧的；successor 见 e2-descent.test.js', () => {
  const { w, a, b } = world2();
  const ok = one(w, a, { type: 'will', heirs: [{ to: b.id, share: 2 }, { to: 'treasury', share: 1 }], lastWords: '好好' });
  assert.deepEqual(ok.data, { heirs: 2 });
  assert.deepEqual(a.will, { heirs: [{ to: 'a2', share: 2 }, { to: 'treasury', share: 1 }], lastWords: '好好', successor: null });
  assert.equal(one(w, a, { type: 'will', heirs: [] }).ok, true, '空数组：没有继承人');
  assert.equal(a.will.heirs.length, 0);
  for (const heirs of ['x', null, Array(11).fill({ to: b.id, share: 1 }), [{ to: a.id, share: 1 }], [{ to: b.id, share: 0 }], [{ to: b.id, share: 1.5 }], [{ to: b.id, share: 2_000_000 }], [5]]) {
    assert.equal(one(w, a, { type: 'will', heirs }).error.code, 'invalid_args', JSON.stringify(heirs));
  }
  assert.equal(one(w, a, { type: 'will', heirs: [{ to: 'a999', share: 1 }] }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'will', heirs: [], successor: { name: '续灯', soul: 's' } }).ok, true, '传灯（第 7 步）');
  assert.equal(a.will.successor.name, '续灯');
});
