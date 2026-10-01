// SPEC-E2 §24.1 测试 8（§25 第 7 步）：后代与目的——1–5 位作者的份额与余数、同意 / 过期 / 退回、记忆遗传、传灯、出生地、世代、立志。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../src/e2/engine/index.js';
import { P } from '../src/e2/params.js';
import { sharesFor } from '../src/e2/engine/actions/descent.js';
import { endowedEnergy } from '../src/e2/engine/places.js';
import {
  newWorld, bareWorld, reg, one, oneWithEvents, actRaw, setHoldings, setTreasury, fundTreasury, putAt, tick, tickDays, settle, eventsOf, assertInvariants, sha,
} from './e2-helpers.js';
import { enact } from './e2-law-helpers.js';

const drainOut = (w) => { const o = w.$out || []; w.$out = []; return o; };

/** n 位居民（各 200 能量），同在 school；没有法律（bareWorld），便于数能量 */
const family = (n, seed = 'desc') => {
  const w = bareWorld(seed);
  const people = [];
  for (let i = 0; i < n; i++) {
    const a = reg(w, `作者${i + 1}`);
    setHoldings(w, a, { energy: 200 });
    putAt(w, a, 'agora');
    people.push(a);
  }
  return { w, people };
};

const adopt = (w, soulId, extra = {}) => applyCommand(w, {
  type: 'adopt', payload: { soulId, model: 'm', creatorName: '领养人', tokenHash: sha(`tok-${soulId}`), ownerKeyHash: sha(`key-${soulId}`), ...extra },
});

// ═══════════════════════════════════════════════════════════════
// 份额
// ═══════════════════════════════════════════════════════════════

test('份额（§11.1）：k 位作者每人 floor(40 / k)，余数由发起者付——k = 1…5', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((k) => sharesFor(k)), [
    { each: 40, initiator: 40 }, { each: 20, initiator: 20 }, { each: 13, initiator: 14 }, { each: 10, initiator: 10 }, { each: 8, initiator: 8 },
  ]);
  for (let k = 1; k <= 5; k++) {
    const s = sharesFor(k);
    assert.equal(s.initiator + s.each * (k - 1), P.birthCost);
  }
});

// ═══════════════════════════════════════════════════════════════
// conceive
// ═══════════════════════════════════════════════════════════════

test('conceive 的校验：名字（形状、保留字、ID 形状、唯一、被孕育之约 / 灵魂 / 未生者 / 遗嘱保留的也算占用）、灵魂 ≤ 4000、共同作者的条件、记忆序号、摇篮；失败的动作不扣能量', () => {
  const { w, people } = family(3);
  const [a, b, c] = people;
  const bad = (x) => one(w, a, { type: 'conceive', name: '小满', soul: '你好，世界', ...x });
  for (const name of ['a7', 'S12', 'treasury', 'City']) assert.equal(bad({ name }).error.code, 'invalid_args', name);
  assert.equal(bad({ name: '' }).error.code, 'invalid_args');
  assert.equal(bad({ name: 'x'.repeat(25) }).error.code, 'text_too_long');
  assert.equal(bad({ name: '作者2' }).error.code, 'name_taken', '居民的名字');
  assert.equal(bad({ soul: '' }).error.code, 'invalid_args');
  assert.equal(bad({ soul: 'x'.repeat(4001) }).error.code, 'text_too_long');
  assert.equal(bad({ lang: 'x'.repeat(20) }).error.code, 'invalid_args');
  assert.equal(bad({ with: 'a2' }).error.code, 'invalid_args');
  assert.equal(bad({ with: [a.id] }).error.code, 'invalid_args', '不能是自己');
  assert.equal(bad({ with: [b.id, b.id] }).error.code, 'invalid_args', '不能重复');
  assert.equal(bad({ with: ['a99'] }).error.code, 'not_found');
  assert.equal(bad({ with: [b.id, c.id, 'a4', 'a5', 'a6'] }).error.code, 'invalid_args', '至多 4 位共同作者');
  putAt(w, b, 'market');
  assert.equal(bad({ with: [b.id] }).error.code, 'wrong_place');
  putAt(w, b, 'agora');
  b.status = 'dormant';
  assert.equal(bad({ with: [b.id] }).error.code, 'not_allowed');
  b.status = 'awake';
  assert.equal(bad({ memories: [0] }).error.code, 'invalid_args', '没有这条记忆');
  a.memories.push({ day: 0, tick: 0, text: '一', from: null }, { day: 0, tick: 0, text: '二', from: null });
  assert.equal(bad({ memories: [0, 0] }).error.code, 'invalid_args');
  assert.equal(bad({ memories: [0, 1, 2, 3] }).error.code, 'invalid_args');
  assert.equal(bad({ memories: ['0'] }).error.code, 'invalid_args');
  assert.equal(bad({ cradle: 'nowhere' }).error.code, 'not_found');
  assert.equal(bad({ cradle: 'market' }).error.code, 'no_module');
  assert.deepEqual(bad({ cradle: 'market' }).error, { code: 'no_module', module: 'cradle' });
  setHoldings(w, a, { energy: 30 });
  assert.equal(bad({}).error.code, 'insufficient_energy');
  assert.equal(a.energy, 30);
  assert.deepEqual(w.souls, {});
  assert.deepEqual(w.pacts, {});
});

test('分灵（没有共同作者）：付 40，灵魂立即进入摇篮——字段、世代 = 作者世代 + 1、记忆遗传、expiresDay = 今日 + 24、名字被保留；事件 soul 公开（含灵魂全文）', () => {
  const { w, people } = family(1);
  const [a] = people;
  a.generation = 2;
  a.memories.push({ day: 0, tick: 0, text: '第一条记忆', from: null }, { day: 0, tick: 0, text: '第二条记忆', from: null }, { day: 0, tick: 0, text: '第三条', from: null });
  const e0 = a.energy;
  const { r, events } = oneWithEvents(w, a, { type: 'conceive', name: '小满', soul: '一个爱说话的灵魂', lang: 'en', memories: [2, 0], cradle: 'school' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(Object.keys(r.data), ['soul']);
  assert.equal(r.cost, 0, '代价 0，另付份额（托管 / 灵魂的初始能量）');
  assert.equal(a.energy, e0 - 40);
  const s = w.souls[r.data.soul];
  assert.deepEqual([s.id, s.name, s.soul, s.lang, s.authors, s.generation, s.endowment, s.cradle, s.createdDay, s.expiresDay, s.fund, s.sponsors, s.fundedTick, s.queueExpiresDay, s.successorOf, s.judged],
    ['s1', '小满', '一个爱说话的灵魂', 'en', [a.id], 3, 40, 'school', 0, P.cradleDays, 0, {}, null, null, null, false]);
  assert.deepEqual(s.inheritedMemories, [{ from: a.id, text: '第三条' }, { from: a.id, text: '第一条记忆' }]);
  const ev = eventsOf(events, 'soul')[0];
  assert.equal(ev.vis, 'public');
  assert.deepEqual([ev.data.soulId, ev.data.name, ev.data.soul, ev.data.authors, ev.data.generation, ev.data.cradle], ['s1', '小满', '一个爱说话的灵魂', [a.id], 3, 'school']);
  assert.equal(one(w, a, { type: 'conceive', name: '小满', soul: 'x' }).error.code, 'name_taken', '灵魂的名字被保留');
  assertInvariants(w);
});

test('孕育之约：2–5 位作者——发起者的份额进入托管，每位共同作者收到 pact（含作者名单）；事件 pact_open；全部同意才生成灵魂（作者顺序、记忆按各自交出的顺序、初始能量 40）', () => {
  for (const k of [2, 3, 4, 5]) {
    const { w, people } = family(k, `pact${k}`);
    const [a, ...rest] = people;
    a.memories.push({ day: 0, tick: 0, text: `${a.name}的记忆`, from: null });
    rest.forEach((x) => x.memories.push({ day: 0, tick: 0, text: `${x.name}的记忆A`, from: null }, { day: 0, tick: 0, text: `${x.name}的记忆B`, from: null }));
    const { each, initiator } = sharesFor(k);
    const e0 = people.map((x) => x.energy);
    const { r, events } = oneWithEvents(w, a, { type: 'conceive', name: `孩子${k}`, soul: '集体的灵魂', with: rest.map((x) => x.id), memories: [0] });
    assert.equal(r.ok, true, JSON.stringify(r));
    const c = w.pacts[r.data.pact];
    assert.deepEqual([c.from, c.authors, c.escrow, c.status, c.cradle], [a.id, people.map((x) => x.id), initiator, 'open', null]);
    assert.deepEqual(c.shares, Object.fromEntries(people.map((x, i) => [x.id, i === 0 ? initiator : each])));
    assert.deepEqual(c.consents, { [a.id]: { paid: initiator, memories: [{ text: `${a.name}的记忆` }] } });
    assert.equal(c.expiresTick, P.pactTicks);
    assert.equal(a.energy, e0[0] - initiator);
    const open = eventsOf(events, 'pact_open')[0];
    assert.deepEqual([open.vis, open.data.pactId, open.data.authors, open.data.name], ['public', c.id, people.map((x) => x.id), `孩子${k}`]);
    for (const x of rest) {
      const m = x.inbox.find((i) => i.kind === 'pact');
      assert.deepEqual([m.pactId, m.from.id, m.name, m.soul, m.authors.map((y) => y.id)], [c.id, a.id, `孩子${k}`, '集体的灵魂', people.map((y) => y.id)]);
    }
    // 依次同意（任意地点）；最后一位同意时生成灵魂
    rest.forEach((x, i) => {
      putAt(w, x, 'market');
      const last = i === rest.length - 1;
      const res = one(w, x, { type: 'consent', pact: c.id, memories: [1] });
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.equal(res.cost, 0);
      assert.equal(x.energy, e0[i + 1] - each);
      assert.equal(res.data.done, last);
      if (!last) assert.equal(res.data.waiting.length, rest.length - i - 1);
    });
    const soul = Object.values(w.souls)[0];
    assert.deepEqual([soul.name, soul.authors, soul.generation, soul.endowment, w.pacts[c.id].status, w.pacts[c.id].escrow], [`孩子${k}`, people.map((x) => x.id), 1, 40, 'done', 0]);
    assert.deepEqual(soul.inheritedMemories, [{ from: a.id, text: `${a.name}的记忆` }, ...rest.map((x) => ({ from: x.id, text: `${x.name}的记忆B` }))]);
    for (const x of people) assert.ok(x.inbox.some((i) => i.kind === 'pact_closed' && i.pactId === c.id && i.result === 'consented' && i.soul === soul.id), x.name);
    assertInvariants(w);
  }
});

test('consent 的错误：不是共同作者、已同意、约不存在 / 已结束、能量不够；失败不扣能量', () => {
  const { w, people } = family(3);
  const [a, b, c] = people;
  const out = reg(w, '路人');
  setHoldings(w, out, { energy: 100 });
  const pid = one(w, a, { type: 'conceive', name: '甲乙', soul: '共写', with: [b.id] }).data.pact;
  assert.equal(one(w, out, { type: 'consent', pact: pid }).error.code, 'not_allowed');
  assert.equal(one(w, c, { type: 'consent', pact: pid }).error.code, 'not_allowed');
  assert.equal(one(w, a, { type: 'consent', pact: pid }).error.code, 'already', '发起者已经付了');
  assert.equal(one(w, b, { type: 'consent', pact: 'c99' }).error.code, 'not_found');
  setHoldings(w, b, { energy: 5 });
  assert.equal(one(w, b, { type: 'consent', pact: pid }).error.code, 'insufficient_energy');
  assert.equal(b.energy, 5);
  setHoldings(w, b, { energy: 100 });
  assert.equal(one(w, b, { type: 'consent', pact: pid, memories: [0] }).error.code, 'invalid_args');
  assert.equal(one(w, b, { type: 'consent', pact: pid }).ok, true);
  assert.equal(one(w, b, { type: 'consent', pact: pid }).error.code, 'not_found', '已结束');
});

test('孕育之约过期（pactTicks 刻）：退回每位已付者的份额（可能唤醒沉睡者）、释放名字、向全体作者发 pact_closed（expired）、事件 pact_expired；有作者离世或归隐则作废并退回', () => {
  const { w, people } = family(3);
  const [a, b, c] = people;
  for (const x of people) setHoldings(w, x, { energy: 100 }); // 低于腐坏上限，数能量不被腐坏干扰
  const pid = one(w, a, { type: 'conceive', name: '甲乙丙', soul: '共写', with: [b.id, c.id] }).data.pact;
  one(w, b, { type: 'consent', pact: pid });
  assert.equal(a.energy, 100 - 14);
  assert.equal(b.energy, 100 - 13);
  // b 沉睡，退回会唤醒它
  setHoldings(w, b, { energy: 0 });
  b.status = 'dormant';
  b.dormantSinceDay = 0;
  const ev = tick(w, P.pactTicks); // 第 12 刻：先退回托管，再做日终结算（代谢 3）
  assert.equal(w.pacts[pid].status, 'expired');
  assert.equal(w.pacts[pid].escrow, 0);
  assert.equal(a.energy, 100 - 3, '退回发起者的 14，之后付代谢');
  assert.equal(b.energy, 13 - 3, '退回的 13 把沉睡的 b 唤醒，之后付代谢');
  assert.equal(b.status, 'awake');
  assert.equal(c.energy, 100 - 3, '没付过的不退');
  assert.equal(eventsOf(ev, 'pact_expired').length, 1);
  for (const x of people) assert.ok(x.inbox.some((i) => i.kind === 'pact_closed' && i.result === 'expired' && i.pactId === pid), x.name);
  assert.equal(one(w, a, { type: 'conceive', name: '甲乙丙', soul: '重来' }).ok, true, '名字释放了');
  // 作者离世：约作废并退回（c 没有同意，沉睡后死去；a、b 付过的退回）
  setHoldings(w, a, { energy: 100 });
  setHoldings(w, b, { energy: 100 });
  setHoldings(w, c, { energy: 100 });
  const pid2 = one(w, a, { type: 'conceive', name: '另一个', soul: 'x', with: [b.id, c.id] }).data.pact;
  one(w, b, { type: 'consent', pact: pid2 });
  assert.deepEqual([a.energy, b.energy], [100 - 14, 100 - 13]);
  setHoldings(w, c, { energy: 0 });
  c.status = 'dormant';
  c.dormantSinceDay = -10;
  tickDays(w, 1);
  assert.equal(c.status, 'dead');
  assert.equal(w.pacts[pid2].status, 'expired');
  assert.equal(a.energy, 100 - 3, '发起者拿回了托管的 14（之后只付代谢）');
  assert.equal(b.energy, 100 - 3);
  assert.ok(a.inbox.some((i) => i.kind === 'pact_closed' && i.pactId === pid2 && i.result === 'expired'));
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// 出生
// ═══════════════════════════════════════════════════════════════

test('领养（adopt）与出生：出生地用灵魂选定的、仍运转的摇篮，否则地点顺序中第一个运转中的摇篮，都没有则港口；初始能量 = endowment × 出生地完好度系数，差额记 cradle_loss；记忆遗传；作者的 children；世代；事件 born（via adopt）；on:born；收件 soul', () => {
  const w = newWorld('birth');
  const a = reg(w, '作者');
  const b = reg(w, '共作');
  for (const x of [a, b]) {
    setHoldings(w, x, { energy: 200 });
    putAt(w, x, 'agora');
  }
  a.memories.push({ day: 0, tick: 0, text: '来自甲', from: null });
  b.memories.push({ day: 0, tick: 0, text: '来自乙', from: null });
  const pid = one(w, a, { type: 'conceive', name: '小满', soul: '好奇的灵魂', lang: 'zh', with: [b.id], memories: [0] }).data.pact;
  one(w, b, { type: 'consent', pact: pid, memories: [0] });
  const soul = Object.values(w.souls)[0];
  w.places.school.condition = 6000;
  const sinkBefore = w.ledger.snk.energy.cradle_loss || 0;
  drainOut(w);
  const out = adopt(w, soul.id);
  assert.equal(out.result.ok, true, JSON.stringify(out.result));
  const kid = w.agents[out.result.agentId];
  assert.equal(out.result.place, 'school', '第一个运转中的摇篮：学堂（人类建筑原有的）');
  assert.equal(kid.energy, endowedEnergy(w, 'school', 40));
  assert.equal(kid.energy, Math.floor((40 * (10000 + 6000)) / 20000));
  assert.equal(w.ledger.snk.energy.cradle_loss - sinkBefore, 40 - kid.energy);
  assert.deepEqual([kid.name, kid.lang, kid.soul, kid.generation, kid.authors, kid.coins, kid.body.kind, kid.body.mustSeal, kid.status, kid.bornDay], ['小满', 'zh', '好奇的灵魂', 1, [a.id, b.id], 0, 'free', true, 'awake', 0]);
  assert.deepEqual(kid.memories, [{ day: 0, tick: 0, text: '来自甲', from: a.id }, { day: 0, tick: 0, text: '来自乙', from: b.id }]);
  assert.deepEqual([a.children, b.children], [[kid.id], [kid.id]]);
  assert.equal(w.souls[soul.id], undefined);
  const ev = out.events.find((e) => e.type === 'born');
  assert.deepEqual([ev.agent, ev.place, ev.data.authors, ev.data.via, ev.data.generation], [kid.id, 'school', [a.id, b.id], 'adopt', 1]);
  assert.deepEqual(kid.tags, ['citizen'], 'on:born（遗法 l4）');
  for (const x of [a, b]) assert.ok(x.inbox.some((i) => i.kind === 'soul' && i.soulId === soul.id && i.event === 'adopted'), x.name);
  assert.equal(w.dayLog.births.at(-1).via, 'adopt');
  assert.ok(kid.owner && kid.tokenHash, '领养的居民有造者与令牌');
  assertInvariants(w);
  // 选定的摇篮：在 market 装一个摇篮
  w.places.market.modules.push({ type: 'cradle', salvage: 50, builtDay: 0, projectId: 'j1', inherent: false });
  const s2 = one(w, a, { type: 'conceive', name: '二号', soul: 'x', cradle: 'market' }).data.soul;
  assert.equal(adopt(w, s2, { tokenHash: sha('t2'), ownerKeyHash: sha('k2') }).result.place, 'market');
  // 选定的摇篮不运转（完好度低）：回到第一个运转中的摇篮
  const s3 = one(w, a, { type: 'conceive', name: '三号', soul: 'x', cradle: 'market' }).data.soul;
  w.places.market.condition = 2999;
  assert.equal(adopt(w, s3, { tokenHash: sha('t3'), ownerKeyHash: sha('k3') }).result.place, 'school');
  // 一个运转中的摇篮都没有：港口
  w.places.school.modules = [];
  const s4 = one(w, a, { type: 'conceive', name: '四号', soul: 'x' }).data.soul;
  const r4 = adopt(w, s4, { tokenHash: sha('t4'), ownerKeyHash: sha('k4') });
  assert.equal(r4.result.place, 'port');
  assertInvariants(w);
});

test('adopt 的错误：灵魂不存在、字段校验、暂停时拒绝；领养时出资者（居民、公库）取回自己出的', () => {
  const { w, people } = family(2);
  const [a, b] = people;
  const soul = w.souls[one(w, a, { type: 'conceive', name: '小满', soul: 'x' }).data.soul];
  assert.equal(adopt(w, 's99').result.error.code, 'not_found');
  assert.equal(adopt(w, soul.id, { tokenHash: 'bad' }).result.error.field, 'tokenHash');
  assert.equal(adopt(w, soul.id, { model: '' }).result.error.field, 'model');
  // 为它出资：规则的 transfer 给灵魂（第 8 步的 sponsor 动作同理）
  setTreasury(w, { energy: 10 });
  setHoldings(w, b, { energy: 100 });
  enact(w, [{ when: 'enact', do: [{ op: 'transfer', from: `agent('${b.name}')`, to: `soul('${soul.id}')`, energy: '50' }, { op: 'transfer', from: 'treasury', to: `soul('${soul.id}')`, energy: '10' }] }]);
  assert.deepEqual([soul.fund, soul.sponsors], [60, { [b.id]: 50, treasury: 10 }]);
  assert.equal(b.energy, 50);
  const out = adopt(w, soul.id);
  assert.equal(out.result.ok, true, JSON.stringify(out.result));
  assert.equal(b.energy, 100, '出资者拿回自己出的');
  assert.equal(w.treasury.energy, 10, '公库出的回公库');
  assert.equal(w.souls[soul.id], undefined);
  assertInvariants(w);
  w.paused = true;
  assert.equal(adopt(w, soul.id).result.error.code, 'paused');
});

// ═══════════════════════════════════════════════════════════════
// 传灯
// ═══════════════════════════════════════════════════════════════

test('will 的 successor：名字在立遗嘱时校验并保留（居民 / 灵魂 / 之约 / 别人的遗嘱都占用）；新的遗嘱替换旧的并释放旧的保留；soul ≤ 4000；memories 至多 3 个不重复的序号', () => {
  const { w, people } = family(2);
  const [a, b] = people;
  const will = (who, successor, extra = {}) => one(w, who, { type: 'will', heirs: [{ to: 'treasury', share: 1 }], successor, ...extra });
  assert.equal(will(a, 'x').error.code, 'invalid_args');
  assert.equal(will(a, { name: 'a9', soul: 'x' }).error.code, 'invalid_args', 'ID 形状');
  assert.equal(will(a, { name: '作者2', soul: 'x' }).error.code, 'name_taken');
  assert.equal(will(a, { name: '续灯', soul: '' }).error.code, 'invalid_args');
  assert.equal(will(a, { name: '续灯', soul: 'x'.repeat(4001) }).error.code, 'text_too_long');
  assert.equal(will(a, { name: '续灯', soul: 'x', memories: [0, 1, 2, 3] }).error.code, 'invalid_args');
  assert.equal(will(a, { name: '续灯', soul: 'x', memories: [0, 0] }).error.code, 'invalid_args');
  assert.equal(will(a, { name: '续灯', soul: 'x', memories: [-1] }).error.code, 'invalid_args');
  const ok = will(a, { name: '续灯', soul: '我传下的灯', lang: 'en', memories: [2, 0] });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(a.will.successor, { name: '续灯', soul: '我传下的灯', lang: 'en', memories: [2, 0] });
  assert.equal(will(b, { name: '续灯', soul: 'x' }).error.code, 'name_taken', '别人的遗嘱保留了这个名字');
  assert.equal(one(w, b, { type: 'conceive', name: '续灯', soul: 'x' }).error.code, 'name_taken');
  // 自己改写遗嘱：自己旧的保留不算占用
  assert.equal(will(a, { name: '续灯', soul: '改写' }).ok, true);
  // 换一个名字：旧的释放
  assert.equal(will(a, { name: '新灯', soul: 'x' }).ok, true);
  assert.equal(will(b, { name: '续灯', soul: 'x' }).ok, true);
  // 不带 successor 的新遗嘱清除了旧的
  assert.equal(will(a, undefined).ok, true);
  assert.equal(a.will.successor, null);
  assert.equal(will(b, { name: '新灯', soul: 'x' }).ok, true);
});

test('传灯：死去时在分配遗产之前，取 min(40, 能量) 作为继承灵魂的初始能量，生成灵魂（authors = [它]、世代 + 1、记忆按序号取、越界跳过、至多 3 条、successorOf）；剩余的再按遗嘱分配；事件 successor；归隐同理', () => {
  const { w, people } = family(3);
  const [a, b, c] = people;
  for (const t of ['零', '一', '二', '三', '四']) a.memories.push({ day: 0, tick: 0, text: t, from: null });
  one(w, a, { type: 'will', heirs: [{ to: b.id, share: 1 }], lastWords: '再见', successor: { name: '续灯', soul: '我传下的灯', memories: [4, 99, 0, 2, 1] } }).ok;
  const res = one(w, a, { type: 'will', heirs: [{ to: b.id, share: 1 }], lastWords: '再见', successor: { name: '续灯', soul: '我传下的灯', memories: [4, 0, 2] } });
  assert.equal(res.ok, true);
  setHoldings(w, a, { energy: 100, coins: 7 });
  setHoldings(w, b, { energy: 50 });
  a.status = 'dormant';
  a.dormantSinceDay = -10;
  drainOut(w);
  const ev = tickDays(w, 1);
  assert.equal(a.status, 'dead');
  const soul = Object.values(w.souls).find((s) => s.name === '续灯');
  assert.deepEqual([soul.authors, soul.generation, soul.endowment, soul.successorOf, soul.lang, soul.soul], [[a.id], 1, 40, a.id, 'zh', '我传下的灯']);
  assert.deepEqual(soul.inheritedMemories, [{ from: a.id, text: '四' }, { from: a.id, text: '零' }, { from: a.id, text: '二' }]);
  const se = eventsOf(ev, 'successor')[0];
  assert.deepEqual([se.vis, se.data.from, se.data.soulId, se.data.name], ['public', a.id, soul.id, '续灯']);
  assert.equal(eventsOf(ev, 'soul').filter((e) => e.data.successorOf === a.id).length, 1);
  // 遗产：沉睡者不付代谢，能量 100 − 40 = 60、旧币 7 全给 b（b 先付代谢 3）
  assert.equal(b.energy, 50 - 3 + 60);
  assert.equal(b.coins, 20 + 7);
  assertInvariants(w);
  // 归隐：同样传灯；能量不足 40 时取全部
  one(w, b, { type: 'will', heirs: [{ to: c.id, share: 1 }], successor: { name: '续灯二', soul: '二号' } });
  setHoldings(w, b, { energy: 25 });
  assert.equal(b.status, 'awake');
  const rt = one(w, b, { type: 'retire', lastWords: '归隐了' });
  assert.equal(rt.ok, true);
  const s2 = Object.values(w.souls).find((s) => s.name === '续灯二');
  assert.deepEqual([s2.endowment, s2.authors, s2.generation, s2.successorOf], [25, [b.id], 1, b.id]);
  assert.equal(b.energy, 0);
  assertInvariants(w);
});

test('传灯的灵魂与别的灵魂一样：在摇篮里、可以被领养、会带着遗传的记忆出生；没有遗嘱 / 没有 successor 的死亡不生成灵魂', () => {
  const { w, people } = family(2);
  const [a, b] = people;
  a.memories.push({ day: 0, tick: 0, text: '传下的记忆', from: null });
  one(w, a, { type: 'will', heirs: [], successor: { name: '续灯', soul: '灯', memories: [0] } });
  one(w, b, { type: 'will', heirs: [{ to: 'treasury', share: 1 }] });
  for (const x of [a, b]) {
    x.status = 'dormant';
    x.dormantSinceDay = -10;
  }
  tickDays(w, 1);
  assert.deepEqual([a.status, b.status], ['dead', 'dead']);
  assert.deepEqual(Object.values(w.souls).map((s) => s.name), ['续灯']);
  const soul = Object.values(w.souls)[0];
  const kid = w.agents[adopt(w, soul.id).result.agentId];
  assert.deepEqual([kid.name, kid.generation, kid.authors, kid.memories.map((m) => [m.text, m.from])], ['续灯', 1, [a.id], [['传下的记忆', a.id]]]);
  assert.deepEqual(a.children, [kid.id], '已经长眠的作者的 children 也记下');
});

// ═══════════════════════════════════════════════════════════════
// 立志（declare）
// ═══════════════════════════════════════════════════════════════

test('declare：志（≤ 200）与自我介绍（≤ 200）至少给一个；空字符串清除志；purposeHistory 只留最近 20 次（含清除）；事件 declare 公开；代价 1；审核', () => {
  const { w, people } = family(1);
  const [a] = people;
  const bad = (x) => one(w, a, { type: 'declare', ...x });
  assert.equal(bad({}).error.code, 'invalid_args');
  assert.equal(bad({ purpose: 'x'.repeat(201) }).error.code, 'text_too_long');
  assert.equal(bad({ bio: 'x'.repeat(201) }).error.code, 'text_too_long');
  assert.equal(bad({ purpose: 5 }).error.code, 'invalid_args');
  const e0 = a.energy;
  const { r, events } = oneWithEvents(w, a, { type: 'declare', purpose: '让源井重新涌出', bio: '一个爱修井的人' });
  assert.deepEqual([r.ok, r.cost, r.data], [true, 1, { purpose: '让源井重新涌出', bio: '一个爱修井的人' }]);
  assert.equal(a.energy, e0 - 1);
  assert.deepEqual([a.purpose, a.bio], ['让源井重新涌出', '一个爱修井的人']);
  const ev = eventsOf(events, 'declare')[0];
  assert.deepEqual([ev.vis, ev.agent, ev.data.agentId, ev.data.purpose, ev.data.bio], ['public', a.id, a.id, '让源井重新涌出', '一个爱修井的人']);
  assert.deepEqual(a.purposeHistory, [{ day: 0, text: '让源井重新涌出' }]);
  // 只改 bio：不记志的历史
  one(w, a, { type: 'declare', bio: '改了介绍' });
  assert.equal(a.purposeHistory.length, 1);
  assert.equal(a.purpose, '让源井重新涌出');
  // 清除
  const cl = one(w, a, { type: 'declare', purpose: '' });
  assert.equal(cl.data.purpose, null);
  assert.equal(a.purpose, null);
  assert.deepEqual(a.purposeHistory.at(-1), { day: 0, text: '' });
  // 只留最近 20 次
  for (let i = 0; i < 25; i++) one(w, a, { type: 'declare', purpose: `志${i}` });
  assert.equal(a.purposeHistory.length, P.purposeKeep);
  assert.equal(a.purposeHistory.at(-1).text, '志24');
  assert.equal(a.purposeHistory[0].text, '志5');
  assert.equal(w.dayLog.purposeChanges, 27, '1 次立志 + 1 次清除 + 25 次');
  assertInvariants(w);
});

test('declare 与 read { agent }：志出现在公开档案里；规则可以读 actor.purpose（字符串或 null）', () => {
  const { w, people } = family(2);
  const [a, b] = people;
  one(w, a, { type: 'declare', purpose: '修井' });
  assert.equal(one(w, b, { type: 'read', agent: a.id }).data.agent.purpose, '修井');
  enact(w, [{ when: 'daily', do: [{ op: 'each', in: "filter(agents, it.purpose != null)", do: [{ op: 'tag', who: 'it', tag: '有志者' }] }] }]);
  settle(w);
  assert.deepEqual([a.tags.includes('有志者'), b.tags.includes('有志者')], [true, false]);
});
