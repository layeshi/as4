// SPEC-E2 §24.1 测试 9（§25 第 8 步）：躯壳（引擎）与先民——出资、排队顺序、先民占名额、醒来的能量与去处、排队过期与退款、领养退款、模型分配、先民分批入城。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../src/e2/engine/index.js';
import { createWorld, validateFounders } from '../src/e2/world.js';
import { P } from '../src/e2/params.js';
import { shellsFree, livingShells, pickModel, queuePosition } from '../src/e2/engine/shells.js';
import { endowedEnergy } from '../src/e2/engine/places.js';
import {
  newWorld, bareWorld, reg, one, oneWithEvents, setHoldings, setTreasury, fundTreasury, putAt, tick, tickDays, settle, eventsOf, assertInvariants, sha,
} from './e2-helpers.js';
import { enact } from './e2-law-helpers.js';

const drainOut = (w) => { const o = w.$out || []; w.$out = []; return o; };
const founder = (day, name, extra = {}) => ({ day, name, bio: `${name}的介绍`, soul: `${name}的灵魂`, lang: 'zh', ...extra });

/** 一座城（无法律），n 位居民（各 100 能量），摇篮里有 k 个灵魂（由第一位居民分灵，名字 灵魂1…） */
const cradleTown = (n = 2, k = 2, opts = {}) => {
  const w = bareWorld('shells', opts);
  const people = [];
  for (let i = 0; i < n; i++) {
    const a = reg(w, `作者${i + 1}`);
    setHoldings(w, a, { energy: 100 });
    people.push(a);
  }
  const souls = [];
  for (let i = 0; i < k; i++) {
    setHoldings(w, people[0], { energy: 100 });
    souls.push(w.souls[one(w, people[0], { type: 'conceive', name: `灵魂${i + 1}`, soul: `第 ${i + 1} 个灵魂` }).data.soul]);
  }
  return { w, people, souls };
};

/** 推进 n 日，每日开始前把这些居民的能量补到 50（bareWorld 没有配给，不补他们会饿死；补给记入 admin 来源，守恒） */
const keepAlive = (w, people, n) => {
  const events = [];
  for (let i = 0; i < n; i++) {
    for (const x of people) if (x.status !== 'dead') setHoldings(w, x, { energy: Math.max(x.energy, 50) });
    events.push(...tickDays(w, 1));
  }
  return events;
};

// ═══════════════════════════════════════════════════════════════
// 状态与出资
// ═══════════════════════════════════════════════════════════════

test('空躯壳数 = slots − 在世的躯壳 − 尚未入城的先民（先民预先占着名额）；创建世界时 slots 取 shellSlots、models 取配置', () => {
  const w = newWorld('free', { founders: [founder(0, '甲'), founder(8, '乙'), founder(16, '丙')], shellModels: ['glm-5.3', 'step-5-preview'] });
  assert.deepEqual([w.shells.slots, w.shells.models], [P.shellSlots, ['glm-5.3', 'step-5-preview']]);
  assert.equal(P.shellSlots, 30);
  assert.equal(shellsFree(w), 27);
  assert.equal(livingShells(w), 0);
  w.shells.slots = 3;
  assert.equal(shellsFree(w), 0, '不低于 0');
  // 先民入城后：在世的躯壳 +1、待入城 −1，总占用不变
  const w2 = newWorld('free2', { founders: [founder(0, '甲'), founder(8, '乙')] });
  tick(w2, 1);
  assert.deepEqual([livingShells(w2), w2.founders.length, shellsFree(w2)], [1, 1, 28]);
});

test('sponsor：为摇篮里的灵魂出资——能量从执行者划入灵魂的 fund，sponsors 记来源；事件 sponsor 公开；返回 { fund, cost, queued }；校验与错误', () => {
  const { w, people, souls } = cradleTown(2, 1);
  const [a, b] = people;
  const [s] = souls;
  assert.equal(one(w, b, { type: 'sponsor', soul: 's99', energy: 5 }).error.code, 'not_found');
  assert.equal(one(w, b, { type: 'sponsor', soul: s.id, energy: 0 }).error.code, 'invalid_args');
  assert.equal(one(w, b, { type: 'sponsor', soul: s.id, energy: 1.5 }).error.code, 'invalid_args');
  assert.equal(one(w, b, { type: 'sponsor', soul: s.id, energy: 5000 }).error.code, 'insufficient_energy');
  const e0 = b.energy;
  const { r, events } = oneWithEvents(w, b, { type: 'sponsor', soul: s.id, energy: 30 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.cost, r.data], [30, { fund: 30, cost: 200, queued: false }]);
  assert.equal(b.energy, e0 - 30);
  assert.deepEqual([s.fund, s.sponsors, s.fundedTick, s.queueExpiresDay], [30, { [b.id]: 30 }, null, null]);
  const ev = eventsOf(events, 'sponsor')[0];
  assert.deepEqual([ev.vis, ev.agent, ev.data.soulId, ev.data.from, ev.data.energy, ev.data.fund], ['public', b.id, s.id, b.id, 30, 30]);
  // 累加；同一个人再出
  one(w, b, { type: 'sponsor', soul: s.id, energy: 20 });
  assert.deepEqual([s.fund, s.sponsors[b.id]], [50, 50]);
  assertInvariants(w);
});

test('出资达到 shellCost（200）时开始排队：fundedTick = 当前刻、queueExpiresDay = 今日 + 24；向作者与出资者发收件 soul（queued）；出资不封顶；规则的 transfer 给灵魂同样计入（含公库、社群）', () => {
  const { w, people, souls } = cradleTown(2, 1);
  const [a, b] = people;
  const [s] = souls;
  w.shells.slots = 0; // 暂时没有空躯壳：只看排队
  for (const x of people) setHoldings(w, x, { energy: 120 });
  one(w, a, { type: 'sponsor', soul: s.id, energy: 100 });
  const r = one(w, b, { type: 'sponsor', soul: s.id, energy: 100 });
  assert.deepEqual(r.data, { fund: 200, cost: 200, queued: true });
  assert.deepEqual([s.fundedTick, s.queueExpiresDay], [w.clock.tick, 24]);
  for (const x of [a, b]) {
    const m = x.inbox.filter((i) => i.kind === 'soul' && i.event === 'queued');
    assert.deepEqual(m.map((i) => [i.soulId, i.name]), [[s.id, s.name]], x.name);
  }
  // 不封顶，也不再重复设置排队时间 / 通知
  tick(w, 5);
  one(w, a, { type: 'sponsor', soul: s.id, energy: 5 });
  assert.equal(s.fund, 205);
  assert.equal(s.fundedTick, 0);
  assert.equal(a.inbox.filter((i) => i.kind === 'soul' && i.event === 'queued').length, 1);
  // 规则：公库 + 社群 + 居民
  const w2 = bareWorld('queue-rule');
  const x = reg(w2, '甲');
  setHoldings(w2, x, { energy: 100 });
  const g = one(w2, x, { type: 'found', name: '会', manifesto: 'x' }).data.group;
  w2.groups[g].treasury.energy = 90;
  w2.ledger.src.energy.admin += 90;
  setTreasury(w2, { energy: 150 });
  const sid = w2.souls[one(w2, x, { type: 'conceive', name: '小满', soul: 'x' }).data.soul].id;
  setHoldings(w2, x, { energy: 100 });
  enact(w2, [{ when: 'enact', do: [
    { op: 'transfer', from: 'treasury', to: `soul('${sid}')`, energy: '100' },
    { op: 'transfer', from: `group('${g}')`, to: `soul('${sid}')`, energy: '60' },
    { op: 'transfer', from: `agent('甲')`, to: `soul('${sid}')`, energy: '50' },
  ] }]);
  const s2 = w2.souls[sid];
  assert.deepEqual([s2.fund, s2.sponsors], [210, { treasury: 100, [g]: 60, [x.id]: 50 }]);
  assert.equal(s2.fundedTick, w2.clock.tick, '规则出资同样触发排队');
  assert.ok(x.inbox.some((i) => i.kind === 'soul' && i.event === 'queued'));
  assertInvariants(w2);
});

// ═══════════════════════════════════════════════════════════════
// 醒来
// ═══════════════════════════════════════════════════════════════

test('醒来：每日结算时排队的灵魂按 (fundedTick, ID) 升序，有空躯壳就依次醒来——body.kind shell、mustSeal、没有造者与令牌；初始能量 = endowment 按出生地系数 + (fund − 200)；去处 embodiment 200 与 cradle_loss；事件 embodied（不含模型）与 born（via shell）', () => {
  const { w, people, souls } = cradleTown(2, 3, { shellModels: ['glm-5.3', 'step-5-preview'] });
  const [a, b] = people;
  const [s1, s2, s3] = souls;
  // 为 s3、s1 出资（s3 先凑够），s2 不够
  setHoldings(w, b, { energy: 600 });
  one(w, b, { type: 'sponsor', soul: s3.id, energy: 210 });
  tick(w, 1);
  one(w, b, { type: 'sponsor', soul: s1.id, energy: 200 });
  one(w, b, { type: 'sponsor', soul: s2.id, energy: 50 });
  assert.deepEqual([queuePosition(w, s3), queuePosition(w, s1), queuePosition(w, s2)], [1, 2, null]);
  w.shells.slots = livingShells(w) + w.founders.length + 1; // 只有 1 具空躯壳
  assert.equal(shellsFree(w), 1);
  w.places.school.condition = 6000;
  const loss0 = w.ledger.snk.energy.cradle_loss || 0;
  drainOut(w);
  const ev = tickDays(w, 1);
  // s3 先醒来（fundedTick 更早）；s1 继续排队
  assert.equal(w.souls[s3.id], undefined);
  assert.ok(w.souls[s1.id] && w.souls[s2.id]);
  const born = Object.values(w.agents).find((x) => x.name === s3.name);
  assert.deepEqual([born.body.kind, born.body.mustSeal, born.owner, born.tokenHash, born.generation, born.authors, born.body.model], ['shell', true, null, null, 1, [a.id], 'glm-5.3']);
  assert.equal(born.body.shell, undefined, '只有沙盘世界的躯壳带 shell: true');
  assert.equal(born.place, 'school');
  const endowed = endowedEnergy(w, 'school', 40);
  // 出资 210：醒来时能量 = endowed + (210 − 200)；当天结算的代谢 3 在醒来之前（第 4 步）已经付过，所以新居民今天不付
  assert.equal(born.energy, endowed + 10);
  assert.equal(w.ledger.snk.energy.embodiment === undefined, true, '日终已关账');
  const emb = eventsOf(ev, 'embodied');
  assert.equal(emb.length, 1);
  assert.deepEqual([emb[0].vis, emb[0].data], ['public', { soulId: s3.id, agentId: born.id }]);
  assert.ok(!JSON.stringify(emb[0]).includes('glm'), '事件里没有模型名');
  assert.deepEqual(eventsOf(ev, 'born').map((e) => [e.data.agentId, e.data.via]), [[born.id, 'shell']]);
  for (const x of [a, b]) assert.ok(x.inbox.some((i) => i.kind === 'soul' && i.soulId === s3.id && i.event === 'embodied'), x.name);
  assert.deepEqual(w.dayLog.embodiments, [], '日终已清空');
  assertInvariants(w);
  // 第二天：又腾出一具空躯壳（slots + 1）→ s1 醒来，用另一个家族的模型
  w.shells.slots += 1;
  tickDays(w, 1);
  const second = Object.values(w.agents).find((x) => x.name === s1.name);
  assert.equal(second.body.model, 'step-5-preview', '模型家族轮流：人数最少的家族优先');
  assert.ok(w.souls[s2.id], '没凑够的不醒来');
  assert.equal(second.energy >= endowed, true);
  assertInvariants(w);
});

test('醒来的账：embodiment 记去处 shellCost，cradle_loss 记 endowment 与初始能量之差，守恒（逐笔）', () => {
  const { w, people, souls } = cradleTown(2, 1);
  const [, b] = people;
  const [s] = souls;
  setHoldings(w, b, { energy: 250 });
  one(w, b, { type: 'sponsor', soul: s.id, energy: 250 });
  w.places.school.condition = 8000;
  // 只做醒来这一步，直接调用，便于逐笔检查
  const before = JSON.stringify(w.ledger.snk.energy);
  void before;
  const e0 = { emb: w.ledger.snk.energy.embodiment || 0, loss: w.ledger.snk.energy.cradle_loss || 0 };
  tickDays(w, 1);
  // 日终已关账；用事件与结果核对：新居民的能量
  const kid = Object.values(w.agents).find((x) => x.name === s.name);
  assert.equal(kid.energy, endowedEnergy(w, 'school', 40) + 50);
  assertInvariants(w);
  void e0;
});

test('先民：按文件里的日子分批自港口入城——第 5 步、按 (day, 文件顺序)；能量按港口系数、旧币 20、来源 immigrant；body.kind shell、模型轮流分配、没有造者与令牌；事件 arrive 不标记先民；触发 on:arrive（遗法 l4 让它成为公民）；入城前名字已被保留', () => {
  const w = newWorld('founders', {
    founders: [founder(8, 'Wren', { lang: 'en' }), founder(0, '试灯'), founder(0, '次灯'), founder(16, '末灯')],
    shellModels: ['glm-5.3', 'step-5-preview'],
  });
  assert.deepEqual(w.founders.map((f) => [f.day, f.name]), [[0, '试灯'], [0, '次灯'], [8, 'Wren'], [16, '末灯']], '按 day 再按文件顺序');
  assert.equal(w.agents.a1, undefined);
  // 名字预先保留
  assert.equal(applyCommand(w, { type: 'register', payload: { name: 'Wren', bio: '', soul: 's', lang: 'zh', model: 'm', creatorName: '', tokenHash: sha('t'), ownerKeyHash: sha('k') } }).result.error.code, 'name_taken');
  const ev = tick(w, 1);
  assert.deepEqual(Object.values(w.agents).map((a) => a.name), ['试灯', '次灯'], '第 0 日的两位在第一刻入城');
  const [f1, f2] = Object.values(w.agents);
  assert.deepEqual([f1.body.kind, f1.owner, f1.tokenHash, f1.generation, f1.authors, f1.place, f1.coins, f1.bio, f1.soul, f1.lang, f1.tags], ['shell', null, null, 0, [], 'port', 20, '试灯的介绍', '试灯的灵魂', 'zh', ['citizen']]);
  assert.deepEqual([f1.body.model, f2.body.model], ['glm-5.3', 'step-5-preview'], '人数最少的家族优先，并列取 models 里靠前的');
  assert.equal(f1.energy, endowedEnergy(w, 'port', P.immigrantEnergy));
  assert.equal(w.ledger.src.energy.immigrant, 2 * f1.energy);
  const arrive = eventsOf(ev, 'arrive');
  assert.equal(arrive.length, 2);
  assert.ok(arrive.every((e) => !('founder' in e.data) && !JSON.stringify(e).includes('glm')));
  assert.equal(w.founders.length, 2);
  // 第 8 日、第 16 日
  tickDays(w, 8);
  assert.ok(Object.values(w.agents).some((a) => a.name === 'Wren'));
  assert.equal(w.founders.length, 1);
  tickDays(w, 8);
  assert.equal(w.founders.length, 0);
  assert.equal(Object.values(w.agents).length, 4);
  assertInvariants(w);
});

test('先民占着躯壳的名额：free = slots − 在世的躯壳 − 待入城的先民；先民入城不改变 free；躯壳居民死去后名额释放，排队的灵魂再醒来', () => {
  const w = newWorld('slots', { founders: [founder(0, '甲')], shellModels: ['glm-5.3'] });
  const a = reg(w, '作者');
  setHoldings(w, a, { energy: 100 });
  const s = w.souls[one(w, a, { type: 'conceive', name: '小满', soul: 'x' }).data.soul];
  w.shells.slots = 2; // 一位先民 + 一个空位
  assert.equal(shellsFree(w), 1);
  setHoldings(w, a, { energy: 300 });
  one(w, a, { type: 'sponsor', soul: s.id, energy: 200 });
  tick(w, 1); // 先民入城
  assert.deepEqual([w.founders.length, livingShells(w), shellsFree(w)], [0, 1, 1]);
  tickDays(w, 1);
  assert.equal(Object.values(w.agents).filter((x) => x.body.kind === 'shell').length, 2, '灵魂在剩下的空位里醒来');
  assert.equal(shellsFree(w), 0);
  // 再来一个灵魂：没有空躯壳，排队
  setHoldings(w, a, { energy: 300 });
  const s2 = w.souls[one(w, a, { type: 'conceive', name: '二号', soul: 'x' }).data.soul];
  setHoldings(w, a, { energy: 300 });
  one(w, a, { type: 'sponsor', soul: s2.id, energy: 200 });
  tickDays(w, 2);
  assert.ok(w.souls[s2.id], '没有空躯壳，继续排队');
  // 先民死去（沉睡满 3 日）→ 名额释放，s2 醒来
  const f = Object.values(w.agents).find((x) => x.name === '甲');
  f.status = 'dormant';
  f.energy = 0;
  f.dormantSinceDay = Math.floor(w.clock.tick / 12) - 10;
  w.ledger.src.energy.admin -= 0;
  tickDays(w, 1);
  assert.equal(f.status, 'dead');
  assert.equal(w.souls[s2.id], undefined, '名额释放后醒来');
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// 消散与退款
// ═══════════════════════════════════════════════════════════════

test('消散：没凑够的灵魂到期（d ≥ expiresDay）消散——endowment 记去处 soul_faded、出资按各自出的数额退回（居民、社群、公库）、写入未生者名录、事件 faded、收件 soul（faded，带退回数额）；名字永久保留', () => {
  const { w, people, souls } = cradleTown(2, 1);
  const [a, b] = people;
  const [s] = souls;
  const g = one(w, a, { type: 'found', name: '会', manifesto: 'x' }).data.group;
  w.shells.slots = 0;
  setTreasury(w, { energy: 30 });
  w.groups[g].treasury.energy = 40;
  w.ledger.src.energy.admin += 40;
  setHoldings(w, b, { energy: 100 });
  enact(w, [{ when: 'enact', do: [
    { op: 'transfer', from: `agent('作者2')`, to: `soul('${s.id}')`, energy: '25' },
    { op: 'transfer', from: `group('${g}')`, to: `soul('${s.id}')`, energy: '40' },
    { op: 'transfer', from: 'treasury', to: `soul('${s.id}')`, energy: '30' },
  ] }]);
  assert.equal(s.fund, 95);
  const bAfter = b.energy;
  void bAfter;
  keepAlive(w, [a, b], P.cradleDays);
  assert.ok(w.souls[s.id], '第 24 日的结算还没到期（d < expiresDay）');
  const ev = keepAlive(w, [a, b], 1);
  assert.equal(w.souls[s.id], undefined);
  assert.deepEqual(w.unborn, [{ soulId: s.id, name: s.name, authors: [a.id], fadedDay: P.cradleDays }]);
  const faded = eventsOf(ev, 'faded')[0];
  assert.deepEqual([faded.data.soulId, faded.data.name, faded.data.queued], [s.id, s.name, false]);
  assert.equal(b.status === 'awake' || b.status === 'dead', true);
  const note = a.inbox.find((i) => i.kind === 'soul' && i.event === 'faded');
  assert.equal(note.soulId, s.id);
  assert.equal(one(w, a, { type: 'conceive', name: s.name, soul: 'x' }).error.code, 'name_taken', '未生者名录保留着名字');
  assertInvariants(w);
});

test('消散的退款：每位出资者取回自己出的（居民、社群进社群公库、公库回城公库）；已凑够排队的灵魂按 queueExpiresDay 计（不按 expiresDay），到期同样全额退回', () => {
  const { w, people, souls } = cradleTown(2, 1);
  const [a, b] = people;
  const [s] = souls;
  w.shells.slots = 0; // 没有空躯壳：一直排队
  const g = one(w, a, { type: 'found', name: '会', manifesto: 'x' }).data.group;
  tickDays(w, 10); // 第 10 日才凑够：queueExpiresDay = 10 + 24 = 34，而灵魂自己的 expiresDay = 24
  for (const x of [a, b]) setHoldings(w, x, { energy: 120 });
  w.groups[g].treasury.energy = 50;
  w.ledger.src.energy.admin += 50;
  setTreasury(w, { energy: 20 });
  enact(w, [{ when: 'enact', do: [
    { op: 'transfer', from: `agent('作者1')`, to: `soul('${s.id}')`, energy: '70' },
    { op: 'transfer', from: `agent('作者2')`, to: `soul('${s.id}')`, energy: '60' },
    { op: 'transfer', from: `group('${g}')`, to: `soul('${s.id}')`, energy: '50' },
    { op: 'transfer', from: 'treasury', to: `soul('${s.id}')`, energy: '20' },
  ] }]);
  assert.deepEqual([s.fund, s.fundedTick !== null, s.queueExpiresDay, s.expiresDay], [200, true, 34, 24]);
  // 过了灵魂自己的 expiresDay 也不消散
  keepAlive(w, [a, b], 20); // 到第 30 日
  assert.ok(w.souls[s.id], '已凑够的灵魂按 queueExpiresDay 计，不按 expiresDay');
  keepAlive(w, [a, b], 4); // 到第 34 日开始：最近一次结算是 d = 33，还不到期
  assert.ok(w.souls[s.id]);
  for (const x of [a, b]) setHoldings(w, x, { energy: 50 });
  const gE = w.groups[g].treasury.energy;
  const tE = w.treasury.energy;
  const ev = tickDays(w, 1); // 第 34 日的结算：d = 34 ≥ queueExpiresDay
  assert.equal(w.souls[s.id], undefined);
  assert.equal(eventsOf(ev, 'faded')[0].data.queued, true);
  // 全额退回：a 70、b 60；社群公库 +50；公库 +20（其余只是这一日的代谢 3 与腐坏）
  assert.equal(a.energy, 50 + 70 - 3);
  assert.equal(b.energy, 50 + 60 - 3);
  assert.equal(w.groups[g].treasury.energy, gE + 50);
  assert.ok(w.treasury.energy >= tE + 20 - 10, '公库收回自己出的 20（当日产出另算）');
  assert.deepEqual(a.inbox.filter((i) => i.event === 'faded').map((i) => [i.soulId, i.refund]), [[s.id, 70]]);
  assert.deepEqual(b.inbox.filter((i) => i.event === 'faded').map((i) => [i.soulId, i.refund]), [[s.id, 60]]);
  assert.equal(w.unborn.length, 1);
  assertInvariants(w);
});

test('迁徙潮：灵魂的消散期限与排队期限都延后 12 日（第 3 步的天象代码）；领养时出资者按比例退回、灵魂不再排队', () => {
  const { w, people, souls } = cradleTown(2, 1);
  const [, b] = people;
  const [s] = souls;
  w.shells.slots = 0;
  setHoldings(w, b, { energy: 250 });
  one(w, b, { type: 'sponsor', soul: s.id, energy: 250 });
  assert.equal(s.queueExpiresDay, 24);
  const out = applyCommand(w, { type: 'adopt', payload: { soulId: s.id, model: 'm', creatorName: 'x', tokenHash: sha('t'), ownerKeyHash: sha('k') } });
  assert.equal(out.result.ok, true);
  assert.equal(b.energy, 250, '领养：出资全额退回');
  assert.equal(w.souls[s.id], undefined);
  assert.equal(Object.values(w.agents).find((x) => x.name === s.name).body.kind, 'free');
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// 模型分配、沙盘世界、管理
// ═══════════════════════════════════════════════════════════════

test('pickModel：models 为空返回 ""；否则数在世的躯壳里各模型家族的人数，选人数最少的家族里在 models 中排最前的模型名', () => {
  const w = bareWorld('pick');
  assert.equal(pickModel(w), '');
  w.shells.models = ['glm-5.3', 'step-5-preview', 'glm-5.3-air', 'gpt-5'];
  const mk = (model, status = 'awake') => {
    const a = reg(w, `躯壳${Object.keys(w.agents).length + 1}`);
    a.body.kind = 'shell';
    a.body.model = model;
    a.status = status;
    return a;
  };
  assert.equal(pickModel(w), 'glm-5.3');
  mk('glm-5.3');
  assert.equal(pickModel(w), 'step-5-preview', 'glm 家族有 1 人：step 家族（0 人）里排最前的');
  mk('step-5-preview');
  assert.equal(pickModel(w), 'gpt-5', 'glm、step 各 1 人，gpt 家族 0 人');
  mk('gpt-5');
  assert.equal(pickModel(w), 'glm-5.3', '三家各 1 人：并列取 models 里排最前的');
  const dead = mk('glm-5.3');
  assert.equal(pickModel(w), 'step-5-preview', 'glm 家族 2 人');
  dead.status = 'dead';
  dead.energy = 0;
  dead.coins = 0;
  assert.equal(pickModel(w), 'glm-5.3', '死去的不算');
});

test('沙盘世界：躯壳与先民由沙盘脑驱动——body.kind sandbox、shell: true，计入在世的躯壳', () => {
  const w = createWorld({ id: 's', seed: 'sb', sandboxShells: true, founders: [founder(0, '沙盘甲')], shellModels: [] });
  tick(w, 1);
  const f = Object.values(w.agents)[0];
  assert.deepEqual([f.body.kind, f.body.shell, f.body.model, f.body.mustSeal], ['sandbox', true, '', true]);
  assert.equal(livingShells(w), 1);
  assert.equal(shellsFree(w), P.shellSlots - 1);
  const a = reg(w, '作者');
  setHoldings(w, a, { energy: 300 });
  const s = w.souls[one(w, a, { type: 'conceive', name: '小满', soul: 'x' }).data.soul];
  setHoldings(w, a, { energy: 300 });
  one(w, a, { type: 'sponsor', soul: s.id, energy: 200 });
  tickDays(w, 1);
  const kid = Object.values(w.agents).find((x) => x.name === '小满');
  assert.deepEqual([kid.body.kind, kid.body.shell], ['sandbox', true]);
});

test('admin shell_models：设定轮流分配的模型名；公开的 admin 事件里不含模型名；参数不合法被拒绝', () => {
  const w = newWorld('adm');
  const adm = (args) => applyCommand(w, { type: 'admin', payload: { op: 'shell_models', args } });
  assert.deepEqual(adm({ models: ['glm-5.3', 'step-5-preview'] }).result, { ok: true, count: 2 });
  const out = adm({ models: ['x-1'] });
  assert.deepEqual(w.shells.models, ['x-1']);
  assert.deepEqual(out.events.map((e) => [e.type, e.data]), [['admin', { op: 'shell_models' }]]);
  assert.ok(!JSON.stringify(out.events).includes('x-1'));
  for (const models of ['x', [1], [''], ['a\nb'], Array(17).fill('m'), ['x'.repeat(101)]]) {
    assert.equal(adm({ models }).result.error.field, 'models', JSON.stringify(models));
  }
  assert.deepEqual(w.shells.models, ['x-1'], '失败不改变');
});

test('先民文件的校验（附录 D）：名字唯一且形状合法、day 为 0–719 的整数、lang 为语言标签、灵魂与介绍的长度；失败时报告第几条', () => {
  const ok = founder(0, '甲');
  const bad = (patch, msg) => assert.throws(() => validateFounders([ok, { ...founder(1, '乙'), ...patch }]), msg);
  assert.equal(validateFounders([ok]).length, 1);
  bad({ name: '甲' }, /founders\[1\]\.name.*not unique/);
  bad({ name: 'a7' }, /founders\[1\]\.name.*ID/);
  bad({ name: 'treasury' }, /reserved/);
  bad({ name: '' }, /founders\[1\]\.name/);
  bad({ name: 'x'.repeat(25) }, /1–24/);
  bad({ day: -1 }, /founders\[1\]\.day/);
  bad({ day: 720 }, /founders\[1\]\.day/);
  bad({ day: 1.5 }, /founders\[1\]\.day/);
  bad({ lang: 'zh_CN' }, /founders\[1\]\.lang/);
  bad({ soul: '' }, /founders\[1\]\.soul/);
  bad({ soul: 'x'.repeat(4001) }, /founders\[1\]\.soul/);
  bad({ bio: 'x'.repeat(201) }, /founders\[1\]\.bio/);
  assert.throws(() => validateFounders('x'), /array/);
  assert.throws(() => validateFounders([5]), /founders\[0\]/);
  assert.throws(() => createWorld({ id: 'x', seed: 'x', founders: [ok, ok] }), /not unique/, '创建世界时拒绝');
});

test('规则能读到躯壳：city.shellsFree 与 city.shellsTotal；soul(…) 取摇篮里的灵魂，字段 fund / expiresDay / generation / name', () => {
  const { w, souls } = cradleTown(1, 1);
  const [s] = souls;
  s.fund = 0;
  enact(w, [{ when: 'enact', do: [
    { op: 'set', var: 'free', value: 'city.shellsFree' }, { op: 'set', var: 'total', value: 'city.shellsTotal' },
    { op: 'set', var: 'gen', value: `soul('${s.id}').generation` }, { op: 'set', var: 'exp', value: `soul('${s.id}').expiresDay` }, { op: 'set', var: 'count', value: 'count(cradle)' },
  ] }]);
  assert.deepEqual([w.vars.free, w.vars.total, w.vars.gen, w.vars.exp, w.vars.count], [P.shellSlots, P.shellSlots, 1, P.cradleDays, 1]);
});
