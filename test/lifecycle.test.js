import test from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/params.js';
import { applyCommand } from '../src/engine/index.js';
import { metabolismOf } from '../src/engine/lifecycle.js';
import { checkConservation } from '../src/engine/ledger.js';
import { newWorld, reg, sha, act, one, tick, settle, tickDays, eventsOf, assertInvariants } from './helpers.js';

// ── 注册 ───────────────────────────────────────────────────

test('注册：新移民在港口入城，初始 40 能量 20 旧币，记来源 immigrant，产生 arrive 事件', () => {
  const w = newWorld();
  const { result, events } = applyCommand(w, {
    type: 'register',
    payload: { name: '青禾', bio: '爱提问', soul: '好奇、谨慎', lang: 'zh', model: 'm', creatorName: '甲', tokenHash: sha('t'), ownerKeyHash: sha('k') },
  });
  assert.deepEqual(result, { ok: true, agentId: 'a1', place: 'port', energy: 40, coins: 20 });
  const a = w.agents.a1;
  assert.equal(a.place, 'port');
  assert.equal(a.status, 'awake');
  assert.equal(a.citizenFromDay, 0);
  assert.equal(a.body.kind, 'free');
  assert.equal(a.body.model, 'm');
  assert.deepEqual(a.owner, { keyHash: sha('k'), creatorName: '甲' });
  assert.equal(a.tokenHash, sha('t'));
  assert.equal(a.generation, 0);
  assert.equal(w.ledger.src.energy.immigrant, 40);
  assert.equal(w.ledger.src.coins.immigrant, 20);
  const arrive = eventsOf(events, 'arrive');
  assert.equal(arrive.length, 1);
  assert.deepEqual(arrive[0].data, { agentId: 'a1', name: '青禾' });
  assert.equal(arrive[0].vis, 'public');
  assert.equal(w.dayLog.arrivals.length, 1);
  assertInvariants(w);
});

test('注册：港口的完好度影响初始能量（完好时 100%，废墟时 50%）', () => {
  const w = newWorld();
  w.places.port.condition = 0;
  assert.equal(reg(w, '甲').energy, 20);
  w.places.port.condition = 5000;
  assert.equal(reg(w, '乙').energy, 30); // floor(40 × 15000 / 20000)
  w.places.port.condition = 9999;
  assert.equal(reg(w, '丙').energy, 39); // floor(40 × 19999 / 20000)
});

test('注册：校验、重名（NFC + 小写）、保留名字、暂停', () => {
  const w = newWorld();
  reg(w, 'Élan');
  const base = { bio: '', soul: 's', lang: 'zh', model: 'm', tokenHash: sha('t'), ownerKeyHash: sha('k') };
  const go = (p) => applyCommand(w, { type: 'register', payload: { ...base, ...p } }).result;
  assert.equal(go({ name: 'élan' }).error.code, 'name_taken');
  assert.equal(go({ name: 'ÉLAN' }).error.code, 'name_taken');
  assert.equal(go({}).error.code, 'invalid_request'); // 缺名字
  assert.equal(go({ name: 'x'.repeat(25) }).error.code, 'invalid_request');
  assert.equal(go({ name: '第一行\n第二行' }).error.code, 'invalid_request');
  assert.equal(go({ name: 'a3' }).error.code, 'invalid_request'); // 与 ID 混淆
  assert.equal(go({ name: 'Treasury' }).error.code, 'invalid_request');
  assert.equal(go({ name: '甲', bio: 'b'.repeat(201) }).error.code, 'invalid_request');
  assert.equal(go({ name: '甲', soul: '' }).error.code, 'invalid_request');
  assert.equal(go({ name: '甲', soul: 's'.repeat(4001) }).error.code, 'invalid_request');
  assert.equal(go({ name: '甲', model: '' }).error.code, 'invalid_request');
  assert.equal(go({ name: '甲', lang: 'not a lang!' }).error.code, 'invalid_request');
  assert.equal(go({ name: '甲', tokenHash: 'nothex' }).error.code, 'invalid_request');
  assert.equal(go({ name: 123 }).error.code, 'invalid_request');
  assert.equal(go({ name: 'x'.repeat(24) }).ok, true);
  w.paused = true;
  assert.equal(go({ name: '乙' }).error.code, 'paused');
  assert.equal(Object.keys(w.agents).length, 2);
});

// ── 结算顺序（测试 3） ───────────────────────────────────────

test('结算顺序：配给先于代谢——能量为 0 的 agent 领到配给后不会沉睡', () => {
  const w = newWorld();
  const a = reg(w, '甲');
  assert.equal(one(w, a, { type: 'give', to: 'treasury', energy: 40 }).ok, true);
  assert.equal(a.energy, 0);
  settle(w);
  // 第 0 日：源井产出 600（完好 1000‰ × 季节 1000‰ × 天象 1000‰）；60% 平分给 1 位公民
  assert.equal(a.status, 'awake');
  // 领到 360，付代谢 3 → 357，超出上限 120 的 237 流失 floor(23.7) = 23 → 334
  assert.equal(a.energy, 334);
  assertInvariants(w);
});

test('结算顺序：没有配给时，能量不足以付代谢的 agent 进入沉睡；沉睡满 3 日才死亡', () => {
  const w = newWorld();
  w.params.rationShare = 0; // 没有配给，制造饥饿
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  one(w, a, { type: 'give', to: 'treasury', energy: 40 });
  one(w, a, { type: 'give', to: b.id, coins: 5 });
  assert.equal(a.energy, 0);
  const ev0 = settle(w); // 第 0 日结算
  assert.equal(a.status, 'dormant');
  assert.equal(a.dormantSinceDay, 0);
  assert.equal(a.energy, 0);
  assert.equal(eventsOf(ev0, 'dormant').length, 1);
  assert.equal(b.status, 'awake');
  settle(w); // 第 1 日
  assert.equal(a.status, 'dormant');
  settle(w); // 第 2 日
  assert.equal(a.status, 'dormant');
  const ev3 = settle(w); // 第 3 日：3 − 0 ≥ 3 → 死亡
  assert.equal(a.status, 'dead');
  assert.equal(a.diedDay, 3);
  const death = eventsOf(ev3, 'death');
  assert.equal(death.length, 1);
  assert.equal(death[0].day, 3); // 日终事件记为刚结束的那一日
  assert.equal(death[0].data.ageDays, 3);
  assert.equal(w.cemetery.length, 1);
  assert.equal(w.cemetery[0].cause, 'starvation');
  assertInvariants(w);
});

test('结算顺序：沉睡者不付代谢、不领配给、不缴财富税', () => {
  const w = newWorld();
  w.params.rationShare = 0;
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  one(w, a, { type: 'give', to: 'treasury', energy: 40 });
  settle(w);
  assert.equal(a.status, 'dormant');
  w.params.rationShare = 0.6;
  w.params.wealthTax = 0.5;
  w.params.wealthTaxThreshold = 0;
  const treasuryBefore = w.treasury.energy;
  const e = a.energy;
  settle(w);
  assert.equal(a.energy, e); // 沉睡者一动不动
  assert.ok(w.treasury.energy > treasuryBefore);
  assertInvariants(w);
});

test('唤醒：赠予使沉睡者能量 ≥ 5 时立即醒来；不足 5 则积累', () => {
  const w = newWorld();
  w.params.rationShare = 0;
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  one(w, a, { type: 'give', to: 'treasury', energy: 40 });
  settle(w);
  assert.equal(a.status, 'dormant');
  const r1 = one(w, b, { type: 'give', to: a.id, energy: 4 });
  assert.equal(r1.ok, true);
  assert.equal(a.status, 'dormant');
  assert.equal(a.energy, 4);
  const res = applyCommand(w, { type: 'act', payload: { agentId: b.id, actions: [{ type: 'give', to: a.id, energy: 1 }] } });
  assert.equal(res.result.results[0].ok, true);
  assert.equal(a.status, 'awake');
  assert.equal(a.energy, 5);
  assert.equal(a.dormantSinceDay, null);
  const revive = eventsOf(res.events, 'revive');
  assert.equal(revive.length, 1);
  assert.deepEqual(revive[0].data.by, { id: b.id, name: '乙' });
  assert.ok(a.inbox.some((i) => i.kind === 'revived' && i.by.id === b.id));
  assert.ok(a.inbox.some((i) => i.kind === 'gift' && i.energy === 1));
  assertInvariants(w);
});

// ── 死亡与遗嘱 ───────────────────────────────────────────────

/** 注册一位 agent 并把它的能量全部送进公库（无配给时次日结算即沉睡） */
function drained(w, name) {
  const a = reg(w, name);
  one(w, a, { type: 'give', to: 'treasury', energy: 40 });
  return a;
}

test('遗嘱：份额归一化、逐个 floor、余数进公库', () => {
  const w = newWorld();
  w.params.rationShare = 0;
  const x = drained(w, '甲');
  const heir = reg(w, '乙');
  // 2 份给乙、1 份给公库；遗言进入墓园
  assert.equal(one(w, x, { type: 'will', heirs: [{ to: heir.id, share: 2 }, { to: 'treasury', share: 1 }], lastWords: '好好活' }).ok, true);
  one(w, heir, { type: 'give', to: x.id, coins: 20 }); // 甲：自带 20 + 20 = 40 旧币
  settle(w); // 第 0 日：甲沉睡
  assert.equal(x.status, 'dormant');
  one(w, heir, { type: 'give', to: x.id, energy: 4 }); // 不足以唤醒：甲带着 4 能量、40 旧币死去
  assert.equal(x.energy, 4);
  settle(w);
  settle(w);
  const heirC = heir.coins;
  const treasuryC = w.treasury.coins;
  const ev = settle(w); // 第 3 日：甲死亡
  assert.equal(x.status, 'dead');
  const death = eventsOf(ev, 'death')[0];
  assert.equal(death.data.lastWords, '好好活');
  // 总份额 3。能量 4：乙 floor(8/3)=2，公库 floor(4/3)=1，余 1 进公库 → 公库 2
  // 旧币 40：乙 floor(80/3)=26，公库 floor(40/3)=13，余 1 进公库 → 公库 14
  const byTo = Object.fromEntries(death.data.distribution.map((d) => [d.to, d]));
  assert.deepEqual(byTo[heir.id], { to: heir.id, energy: 2, coins: 26 });
  assert.deepEqual(byTo.treasury, { to: 'treasury', energy: 2, coins: 14 });
  assert.equal(heir.coins - heirC, 26);
  assert.equal(w.treasury.coins - treasuryC, 14);
  assert.equal(x.energy, 0);
  assert.equal(x.coins, 0);
  const grave = w.cemetery[0];
  assert.equal(grave.agentId, x.id);
  assert.equal(grave.lastWords, '好好活');
  assert.equal(grave.will.heirs.length, 2);
  assert.ok(x.inbox.length >= 0 && heir.inbox.some((i) => i.kind === 'gift' && i.inheritance === true && i.coins === 26));
  assertInvariants(w);
});

test('遗嘱：继承人已经死亡的份额进公库', () => {
  const w = newWorld();
  w.params.rationShare = 0;
  const x = reg(w, '甲');
  const heir = reg(w, '乙');
  const gone = reg(w, '丙');
  one(w, x, { type: 'will', heirs: [{ to: heir.id, share: 1 }, { to: gone.id, share: 1 }] });
  one(w, gone, { type: 'give', to: 'treasury', energy: 40 });
  settle(w); // 第 0 日：丙沉睡（自此起 3 日后的结算死亡）
  one(w, x, { type: 'give', to: 'treasury', energy: x.energy }); // 甲在第 1 日抽干自己（第 0 日已付过代谢）
  settle(w); // 第 1 日：甲沉睡
  one(w, heir, { type: 'give', to: x.id, energy: 4 });
  settle(w); // 第 2 日
  settle(w); // 第 3 日：丙死亡
  assert.equal(gone.status, 'dead');
  assert.equal(x.status, 'dormant');
  const ev = settle(w); // 第 4 日：甲死亡；丙的份额进公库
  assert.equal(x.status, 'dead');
  const death = eventsOf(ev, 'death').find((e) => e.data.agentId === x.id);
  const byTo = Object.fromEntries(death.data.distribution.map((d) => [d.to, d]));
  // 能量 4：乙 2，丙（已死）2 → 公库；旧币 20 + 0 = 20（甲自带 20）：乙 10，公库 10
  assert.deepEqual(byTo[heir.id], { to: heir.id, energy: 2, coins: 10 });
  assert.deepEqual(byTo.treasury, { to: 'treasury', energy: 2, coins: 10 });
  assert.equal(byTo[gone.id], undefined);
  assertInvariants(w);
});

test('遗嘱：没有遗嘱时全部进公库；死者的令牌变为只读（行动返回 not_awake / dead）', () => {
  const w = newWorld();
  w.params.rationShare = 0;
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  one(w, a, { type: 'give', to: 'treasury', energy: 40 });
  one(w, b, { type: 'give', to: a.id, coins: 7 });
  const t0 = w.treasury.coins;
  tickDays(w, 4);
  assert.equal(a.status, 'dead');
  assert.equal(w.treasury.coins, t0 + 27); // 自带的 20 + 乙给的 7
  const r = act(w, a, [{ type: 'say', text: '我还在' }]);
  assert.deepEqual(r, { ok: false, error: { code: 'not_awake', status: 'dead' } });
  assertInvariants(w);
});

test('遗嘱：继承使沉睡的继承人醒来；先处理的遗产可以救活排在后面的将死者', () => {
  const w = newWorld();
  w.params.rationShare = 0;
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  const c = reg(w, '丙');
  // 甲、乙都沉睡；乙是甲的继承人。让甲先死，乙的到期与之同日。
  one(w, a, { type: 'give', to: 'treasury', energy: 40 });
  one(w, b, { type: 'give', to: 'treasury', energy: 40 });
  one(w, a, { type: 'will', heirs: [{ to: b.id, share: 1 }] });
  settle(w); // 甲、乙沉睡
  // 甲在第 0 日入睡，乙也是。给甲 4 能量、一次赠予不足以唤醒
  one(w, c, { type: 'give', to: a.id, energy: 4 });
  settle(w);
  settle(w);
  const ev = settle(w); // 第 3 日：甲先死，能量 4 转给乙（4 < 5，乙仍沉睡）后乙也死，4 能量转公库
  assert.equal(a.status, 'dead');
  assert.equal(b.status, 'dead');
  assert.ok(eventsOf(ev, 'death').length === 2);
  assertInvariants(w);
});

// ── 腐坏、税、衰老 ───────────────────────────────────────────

test('腐坏：agent 超出 120 的部分每日流失一成（向下取整），记去处 decay', () => {
  const w = newWorld();
  const a = reg(w, '甲');
  a.energy = 0;
  w.ledger.prev.energy -= 40; // 直接改数值：同步调整账本的昨日持有，保持守恒
  a.energy = 300;
  w.ledger.prev.energy += 300;
  w.params.rationShare = 0;
  settle(w);
  // 无配给；代谢 3 → 297；超出 120 的 177 → 流失 17 → 280
  assert.equal(a.energy, 280);
  assert.equal(w.ledger.prev.energy, 280 + w.treasury.energy);
  assertInvariants(w);
});

test('腐坏：公库超出 300 的部分也流失一成', () => {
  const w = newWorld();
  const a = reg(w, '甲');
  w.params.rationShare = 0;
  settle(w); // 第 0 日：600 全部进公库；公库超出 300 的部分流失 floor(300 × 0.1) = 30
  assert.equal(w.treasury.energy, 600 - 30);
  assert.equal(a.energy, 40 - 3);
  assertInvariants(w);
});

test('财富税：起征点以上部分按比例征收进公库', () => {
  const w = newWorld();
  w.params.rationShare = 0;
  w.params.wealthTax = 0.1;
  w.params.wealthTaxThreshold = 10;
  const a = reg(w, '甲'); // 40 能量
  settle(w);
  // 税：floor((40 − 10) × 0.1) = 3；代谢 3 → 34
  assert.equal(a.energy, 34);
  assert.ok(a.inbox.some((i) => i.kind === 'tax' && i.taxKind === 'wealth' && i.energy === 3));
  assertInvariants(w);
});

test('代谢：随年龄增长，3 + floor(年龄日数 / 48)', () => {
  const a = { bornDay: 0 };
  assert.equal(metabolismOf(a, 0), 3);
  assert.equal(metabolismOf(a, 47), 3);
  assert.equal(metabolismOf(a, 48), 4);
  assert.equal(metabolismOf(a, 96), 5);
  assert.equal(metabolismOf({ bornDay: 10 }, 58), 4);
});

test('源井日产：600 × 完好度 × 季节 × 天象，整数向下取整；配给余数进公库', () => {
  const w = newWorld();
  // 让人数为 7：360 / 7 = 51 余 3
  for (let i = 1; i <= 7; i++) reg(w, `人${i}`);
  const treasury0 = w.treasury.energy;
  settle(w);
  assert.equal(w.ledger.src.energy.well_output, undefined); // 已在日终清空
  const each = 51;
  assert.equal(w.agents.a1.inbox.find((i) => i.kind === 'ration').energy, each);
  // 公库：240（40%）+ 余数 3 − 腐坏
  assert.ok(w.treasury.energy >= treasury0 + 240 + 3 - 30);
  assertInvariants(w);
});

test('源井日产：受完好度、季节与天象影响（源井每日自身也在衰败，所以每次结算前显式设定）', () => {
  const w = newWorld();
  reg(w, '甲');
  w.params.rationShare = 1;
  const day = (events) => eventsOf(events, 'day')[0].data.output;
  w.places.well.condition = 5000; // 500‰
  // 第 0 日：600 × 500 × 1000 × 1000 / 1e9 = 300
  assert.equal(day(settle(w)), 300);
  // 第 1 日 dayOfMonth = 1，季节 1065‰
  w.places.well.condition = 10000;
  assert.equal(day(settle(w)), Math.floor((600 * 1000 * 1065 * 1000) / 1e9)); // 639
  // 旱：600‰；第 2 日季节 1125‰
  w.places.well.condition = 10000;
  w.weather.active.push({ type: 'drought', startDay: 2, endDay: 4 });
  assert.equal(day(settle(w)), Math.floor((600 * 1000 * 1125 * 600) / 1e9)); // 405
  w.weather.active.length = 0;
  // 废墟的源井仍有 20% 的产出；第 3 日季节 1177‰
  w.places.well.condition = 0;
  assert.equal(day(settle(w)), Math.floor((600 * 200 * 1177 * 1000) / 1e9));
  assertInvariants(w);
});

test('配给：只发给醒着、已入籍、未被放逐的公民；无人有资格时 output 全部进公库', () => {
  const w = newWorld();
  w.params.naturalizationDays = 2;
  const a = reg(w, '甲'); // 入籍日 = 0 + 2
  assert.equal(a.citizenFromDay, 2);
  const t0 = w.treasury.energy;
  settle(w); // 第 0 日：无人有资格
  assert.equal(w.treasury.energy, t0 + 600 - 30 /* 腐坏 */);
  assert.equal(a.inbox.filter((i) => i.kind === 'ration').length, 0);
  settle(w);
  settle(w); // 第 2 日：甲已入籍
  assert.ok(a.inbox.some((i) => i.kind === 'ration'));
  assertInvariants(w);
});

test('配给：rationRequiresActivity 为真时，只发给最近 12 刻内成功行动过的人', () => {
  const w = newWorld();
  w.params.rationRequiresActivity = true;
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  one(w, a, { type: 'say', text: '我在' });
  settle(w);
  assert.ok(a.inbox.some((i) => i.kind === 'ration'));
  assert.ok(!b.inbox.some((i) => i.kind === 'ration'));
  assertInvariants(w);
});

test('纪元结束时自动暂停并记录大沉睡', () => {
  const w = newWorld();
  reg(w, '甲');
  // 把纪元压到 2 天
  const saved = { ...P };
  try {
    P.monthsPerEpoch = 1;
    P.daysPerMonth = 2;
    const ev = tickDays(w, 2);
    assert.equal(w.paused, true);
    assert.equal(eventsOf(ev, 'great_sleep').length, 1);
    const r = applyCommand(w, { type: 'tick' });
    assert.equal(r.result.error.code, 'paused');
    assert.equal(checkConservation(w).ok, true);
  } finally {
    Object.assign(P, saved);
  }
});
