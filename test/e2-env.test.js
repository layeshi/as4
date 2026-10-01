// SPEC-E2 §25 第 3 步：环境与社会的动作——修缮、汲取、铭刻、探索、典籍、词典、交易、墓志、家书、社群。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../src/e2/engine/index.js';
import { P } from '../src/e2/params.js';
import { checkConservation } from '../src/e2/engine/ledger.js';
import {
  newWorld, bareWorld, reg, act, actRaw, one, oneWithEvents, grant, fundTreasury, putAt, tick, tickDays, settle, eventsOf, assertInvariants, sha,
} from './e2-helpers.js';

const world2 = () => {
  const w = bareWorld('env');
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  grant(w, a, 400, 30);
  grant(w, b, 400, 30);
  return { w, a, b };
};

// ═══════════════════════════════════════════════════════════════
// 修缮
// ═══════════════════════════════════════════════════════════════

test('repair：目标缺省为所在之处；每 1 能量恢复 10 基点（完好度 < 1000 时 5）；修满后多余的能量不扣；代价就是投入的能量', () => {
  const { w, a } = world2();
  putAt(w, a, 'library');
  w.places.library.condition = 9000;
  const r = one(w, a, { type: 'repair', energy: 30 });
  assert.deepEqual(r.data, { target: 'library', spent: 30, from: 9000, to: 9300 });
  assert.equal(r.cost, 30, 'cost 含投入的能量');
  assert.equal(w.places.library.condition, 9300);
  assert.equal(a.stats.repaired, 30);
  assert.equal(a.repairedToday, 30);
  assert.equal(w.dayLog.repairSpent, 30);
  assert.equal(w.places.library.activity.repairs, 1);
  assert.deepEqual(w.dayLog.repairedPlaces, ['library']);
  // 修满后多余的能量不扣
  const e0 = a.energy;
  const r2 = one(w, a, { type: 'repair', target: 'library', energy: 200 });
  assert.equal(r2.data.spent, 70);
  assert.equal(r2.data.to, 10000);
  assert.equal(a.energy, e0 - 70);
  assert.equal(one(w, a, { type: 'repair', energy: 5 }).error.code, 'already');
  // 完好度 < 1000 时效率减半，越过 1000 时分段计算：500 → 1000 要 100 能量（每能量 5），再 50 能量 → +500
  w.places.library.condition = 500;
  const r3 = one(w, a, { type: 'repair', energy: 150 });
  assert.deepEqual([r3.data.spent, r3.data.to], [150, 1500]);
  w.places.library.condition = 0;
  grant(w, a, 100);
  assert.equal(one(w, a, { type: 'repair', energy: 200 }).data.to, 1000, '0 → 1000 每能量 5 基点：恰好 200 能量');
  assertInvariants(w);
});

test('repair：废墟修到 ≥ 10% 时恢复（restored 事件）；广场、荒野与遗址不能修缮；目标是别处的地点为 wrong_place；道路在第 6 步', () => {
  const { w, a } = world2();
  putAt(w, a, 'temple');
  w.places.temple.condition = 0;
  w.places.temple.ruined = true;
  const { r, events } = oneWithEvents(w, a, { type: 'repair', energy: 199 });
  assert.equal(r.data.to, 995);
  assert.equal(w.places.temple.ruined, true, '995 < 1000');
  assert.equal(eventsOf(events, 'restored').length, 0);
  const out = oneWithEvents(w, a, { type: 'repair', energy: 1 });
  assert.equal(w.places.temple.ruined, false);
  assert.deepEqual(eventsOf(out.events, 'restored')[0].data, { target: 'temple' });
  assert.equal(w.dayLog.restored.length, 1);
  putAt(w, a, 'agora');
  assert.equal(one(w, a, { type: 'repair', energy: 5 }).error.code, 'invalid_args');
  putAt(w, a, 'wilds');
  assert.equal(one(w, a, { type: 'repair', energy: 5 }).error.code, 'invalid_args');
  putAt(w, a, 'temple');
  assert.equal(one(w, a, { type: 'repair', target: 'court', energy: 5 }).error.code, 'wrong_place');
  assert.equal(one(w, a, { type: 'repair', target: 'f1', energy: 5 }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'repair', target: 5, energy: 5 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'repair', energy: 0 }).error.code, 'invalid_args');
  w.places.temple.condition = 5000;
  assert.equal(one(w, a, { type: 'repair', energy: a.energy + 1 }).error.code, 'insufficient_energy', '请求的能量须 ≤ 自己的能量，即使实际只会用掉一部分');
  // 一条一端在此处的道路
  w.roads.f1 = { id: 'f1', a: 'temple', b: 'court', name: '路', condition: 4000, decayPerDay: 50, ruined: false, builtDay: 0, projectId: 'j1', contributors: {} };
  const rr = one(w, a, { type: 'repair', target: 'f1', energy: 20 });
  assert.deepEqual(rr.data, { target: 'f1', spent: 20, from: 4000, to: 4200 });
  putAt(w, a, 'agora');
  assert.equal(one(w, a, { type: 'repair', target: 'f1', energy: 5 }).error.code, 'wrong_place', '道路只能在它的一端修缮');
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// 汲取
// ═══════════════════════════════════════════════════════════════

test('draw：只在源井；每次 1–20；每 1 能量使源井完好度下降 0.2%；受当日汲取池限制；没有物理的配额；同地的人看见', () => {
  const { w, a, b } = world2();
  assert.equal(one(w, a, { type: 'draw', energy: 5 }).error.code, 'wrong_place');
  putAt(w, a, 'well');
  putAt(w, b, 'well');
  const e0 = a.energy;
  const { r, events } = oneWithEvents(w, a, { type: 'draw', energy: 10 });
  assert.deepEqual(r.data, { energy: 10, wellCondition: 9800, drawPoolLeft: 50 });
  assert.equal(a.energy, e0 + 10);
  assert.equal(r.cost, 0);
  assert.equal(w.places.well.condition, 9800);
  assert.equal(a.drawnToday, 10);
  assert.equal(a.stats.drawn, 10);
  assert.equal(w.dayLog.drawn, 10);
  assert.deepEqual(b.inbox.at(-1), { seq: b.inbox.at(-1).seq, tick: 0, kind: 'witness', what: 'draw', actor: { id: a.id, name: '甲' }, amount: 10, place: 'well' });
  assert.equal(a.inbox.some((i) => i.kind === 'witness'), false);
  assert.deepEqual(eventsOf(events, 'draw')[0].data, { amount: 10, wellCondition: 9800 });
  for (const bad of [0, 21, -1, 1.5, '5', undefined]) assert.equal(one(w, a, { type: 'draw', energy: bad }).error.code, 'invalid_args', String(bad));
  // 没有配额：一人一天可以把汲取池汲干
  assert.equal(one(w, a, { type: 'draw', energy: 20 }).ok, true);
  assert.equal(one(w, a, { type: 'draw', energy: 20 }).ok, true);
  assert.equal(w.well.drawPoolLeft, 10);
  const over = one(w, a, { type: 'draw', energy: 11 });
  assert.equal(over.error.code, 'pool_exhausted');
  assert.match(over.error.hint.zh, /只剩 10/);
  assert.equal(one(w, a, { type: 'draw', energy: 10 }).ok, true);
  assert.equal(one(w, a, { type: 'draw', energy: 1 }).error.code, 'pool_exhausted');
  assert.equal(a.drawnToday, 60);
  // 日终：汲取池重置，每人当日的汲取量清零
  settle(w);
  assert.equal(w.well.drawPoolLeft, 60);
  assert.equal(a.drawnToday, 0);
  assertInvariants(w);
});

test('draw：源井完好度降到 0 时成为废墟（ruin 事件），产出降到基础的 20% 而不会为 0', () => {
  const { w, a } = world2();
  putAt(w, a, 'well');
  w.places.well.condition = 100;
  const { events } = oneWithEvents(w, a, { type: 'draw', energy: 10 });
  assert.equal(w.places.well.condition, 0);
  assert.equal(w.places.well.ruined, true);
  assert.deepEqual(eventsOf(events, 'ruin').map((e) => e.data), [{ target: 'well' }]);
  assert.deepEqual(w.dayLog.ruins, [{ target: 'well', place: 'well' }]);
  const day = eventsOf(settle(w), 'day')[0];
  assert.equal(day.data.output, Math.floor((600 * 200 * 1000 * 1000) / 1e9), '20% 的下限：120');
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// 铭刻
// ═══════════════════════════════════════════════════════════════

test('inscribe：6 个墙位；墙满时须用 cover 覆盖，覆盖的代价是被覆盖者基础代价的 2 倍（3–100）；受保护的不能覆盖；被覆盖的从墙上消失但仍在历史里', () => {
  const { w, a, b } = world2();
  putAt(w, a, 'agora');
  putAt(w, b, 'agora');
  const first = one(w, a, { type: 'inscribe', text: '第一刻', lang: 'zh' });
  assert.equal(first.cost, 3);
  const id1 = first.data.inscription;
  assert.deepEqual([w.inscriptions[id1].author, w.inscriptions[id1].baseCost, w.inscriptions[id1].lang, w.inscriptions[id1].lost], [a.id, 3, 'zh', false]);
  assert.equal(b.inbox.at(-1).kind, 'witness');
  assert.equal(b.inbox.at(-1).what, 'inscribe');
  for (let i = 0; i < 5; i++) assert.equal(one(w, a, { type: 'inscribe', text: `刻${i}` }).ok, true);
  assert.equal(one(w, a, { type: 'inscribe', text: '满了' }).error.code, 'wall_full');
  const cover = one(w, a, { type: 'inscribe', text: '覆盖', cover: id1 });
  assert.equal(cover.cost, 6, '2 × 3');
  assert.equal(cover.data.covered, id1);
  assert.equal(w.inscriptions[id1].coveredBy, cover.data.inscription);
  assert.equal(w.dayLog.covered, 1);
  const cover2 = one(w, a, { type: 'inscribe', text: '再覆盖', cover: cover.data.inscription });
  assert.equal(cover2.cost, 12, '2 × 6：覆盖比原刻更贵，一层比一层贵');
  assert.equal(w.inscriptions[cover2.data.inscription].baseCost, 12);
  w.inscriptions[cover2.data.inscription].baseCost = 80;
  const c3 = one(w, a, { type: 'inscribe', text: '覆盖昂贵的', cover: cover2.data.inscription });
  assert.equal(c3.cost, 100, 'min(100, 2 × 80)');
  assertInvariants(w);
});

test('inscribe：覆盖的基础代价 min(100, max(3, 2 × 被覆盖者的基础代价))；受保护、已被覆盖、别处的铭刻不能覆盖；遗址没有墙；议会 12 个墙位里宪章占 8 个', () => {
  const { w, a } = world2();
  putAt(w, a, 'parliament');
  grant(w, a, 500);
  assert.equal(Object.values(w.inscriptions).filter((i) => i.place === 'parliament' && !i.coveredBy).length, 8);
  for (let i = 0; i < 4; i++) assert.equal(one(w, a, { type: 'inscribe', text: `议会${i}` }).ok, true);
  assert.equal(one(w, a, { type: 'inscribe', text: '满' }).error.code, 'wall_full');
  const charter = Object.values(w.inscriptions).find((i) => i.place === 'parliament' && i.author === 'humans');
  const prot = Object.values(w.inscriptions).filter((i) => i.place === 'parliament' && i.author === 'humans')[1];
  prot.protectedBy.push('l9');
  assert.equal(one(w, a, { type: 'inscribe', text: 'x', cover: prot.id }).error.code, 'protected');
  const r = one(w, a, { type: 'inscribe', text: '我覆盖了宪章', cover: charter.id });
  assert.equal(r.cost, 6);
  assert.equal(one(w, a, { type: 'inscribe', text: 'x', cover: charter.id }).error.code, 'not_found', '已被覆盖');
  assert.equal(one(w, a, { type: 'inscribe', text: 'x', cover: 'i9999' }).error.code, 'not_found');
  charter.baseCost = 70;
  const other = Object.values(w.inscriptions).filter((i) => i.place === 'parliament' && i.author === 'humans' && !i.coveredBy && !i.protectedBy.length)[0];
  other.baseCost = 70;
  assert.equal(one(w, a, { type: 'inscribe', text: '贵', cover: other.id }).cost, 100, '上限 100');
  other.baseCost = 1;
  const third = Object.values(w.inscriptions).filter((i) => i.place === 'parliament' && i.author === 'humans' && !i.coveredBy && !i.protectedBy.length)[0];
  third.baseCost = 1;
  assert.equal(one(w, a, { type: 'inscribe', text: '便宜', cover: third.id }).cost, 3, '下限 3');
  // 别处的铭刻
  putAt(w, a, 'agora');
  const here = one(w, a, { type: 'inscribe', text: '广场' }).data.inscription;
  putAt(w, a, 'port');
  assert.equal(one(w, a, { type: 'inscribe', text: 'x', cover: here }).error.code, 'not_found');
  // 遗址没有墙
  w.places.port.wallSlots = 0;
  assert.equal(one(w, a, { type: 'inscribe', text: 'x' }).error.code, 'wrong_place');
  assert.equal(one(w, a, { type: 'inscribe', text: 'x', lang: '中文' }).error.code, 'wrong_place');
  w.places.port.wallSlots = 6;
  assert.equal(one(w, a, { type: 'inscribe', text: 'x', lang: '中文' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'inscribe', text: 'x'.repeat(141) }).error.code, 'text_too_long');
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// 荒野与探索
// ═══════════════════════════════════════════════════════════════

test('explore：只在荒野五地带；概率与产出按这个地带自己的储量；找到能量 / 旧币 / 遗物；储量只减不增（每日再生）', () => {
  const { w, a } = world2();
  assert.equal(one(w, a, { type: 'explore' }).error.code, 'wrong_place');
  putAt(w, a, 'wilds');
  const seen = { nothing: 0, energy: 0, coins: 0, relic: 0 };
  const e0 = a.energy;
  const c0 = a.coins;
  let spent = 0;
  for (let i = 0; i < 400; i++) {
    a.actsThisTick = 0;
    grant(w, a, 2);
    const r = one(w, a, { type: 'explore' });
    assert.equal(r.ok, true);
    assert.equal(r.cost, 2);
    spent += 2;
    seen[r.data.outcome]++;
    if (r.data.outcome === 'relic') {
      assert.ok(r.data.doc.id && r.data.doc.title.startsWith('遗物'));
      assert.equal(w.docs[r.data.doc.id].kind, 'relic');
      assert.equal(w.docs[r.data.doc.id].author, a.id);
    }
  }
  assert.ok(seen.energy > 20 && seen.coins > 3 && seen.relic >= 1 && seen.nothing > 20, JSON.stringify(seen));
  assert.equal(w.regions.wilds.relicsFound, seen.relic);
  assert.ok(w.regions.wilds.energy < 400, '找到的能量来自这个地带的储量');
  assert.equal(a.energy - e0, 2 * 400 - spent + (400 - w.regions.wilds.energy), '收支：补的 2×400 − 花的探索代价 + 从储量里取走的');
  assert.ok(a.coins > c0);
  assert.ok(w.dayLog.relics.every((x) => x.place === 'wilds'));
  // 别的地带互不影响
  assert.equal(w.regions.scrapyard.energy, 250);
  // 储量耗尽后不再找到能量
  w.regions.wilds.energy = 0;
  w.regions.wilds.coins = 0;
  const after = {};
  for (let i = 0; i < 100; i++) {
    a.actsThisTick = 0;
    grant(w, a, 2);
    const r = one(w, a, { type: 'explore' });
    after[r.data.outcome] = (after[r.data.outcome] || 0) + 1;
  }
  assert.equal(after.energy, undefined);
  assert.equal(after.coins, undefined);
  // 遗物找完后不再出现；每日再生
  w.regions.wilds.relicsFound = w.regions.wilds.relicOrder.length;
  for (let i = 0; i < 60; i++) {
    a.actsThisTick = 0;
    grant(w, a, 2);
    assert.notEqual(one(w, a, { type: 'explore' }).data.outcome, 'relic');
  }
  settle(w);
  assert.equal(w.regions.wilds.energy, 20, '每日再生 20（上限 400）');
  assertInvariants(w);
});

test('explore：在荒野里开辟的地点不能探索（explorable 为假）；极光使遗物概率加倍', () => {
  const { w, a } = world2();
  w.places.n1 = { ...w.places.agora, id: 'n1', origin: 'agent', wild: true, explorable: false, open: false, condition: 10000, district: 'wilds' };
  putAt(w, a, 'n1');
  assert.equal(one(w, a, { type: 'explore' }).error.code, 'wrong_place');
  const count = (aurora) => {
    const w2 = newWorld('aurora-test');
    const x = reg(w2, '探');
    putAt(w2, x, 'solarfield');
    if (aurora) w2.weather.active.push({ type: 'aurora', startDay: 0, endDay: 5 });
    let n = 0;
    for (let i = 0; i < 1500; i++) {
      grant(w2, x, 2);
      w2.regions.solarfield.relicsFound = 0;
      w2.regions.solarfield.energy = 500;
      if (one(w2, x, { type: 'explore' }).data.outcome === 'relic') n++;
    }
    return n;
  };
  const plain = count(false);
  const aur = count(true);
  assert.ok(aur > plain * 1.5, `极光 ${aur} vs 平日 ${plain}`);
});

// ═══════════════════════════════════════════════════════════════
// 典籍与词典
// ═══════════════════════════════════════════════════════════════

test('write / read：著述与阅读典籍须在有运转中的档案的地点（no_module）；典籍全城共有；阅读计数；被遮盖的典籍只返回 redacted', () => {
  const { w, a } = world2();
  const err = (r) => r.error;
  assert.deepEqual(err(one(w, a, { type: 'write', title: '题', body: '文' })), { code: 'no_module', module: 'archive' });
  assert.deepEqual(err(one(w, a, { type: 'read', doc: 'd1' })), { code: 'no_module', module: 'archive' });
  putAt(w, a, 'library');
  const wr = one(w, a, { type: 'write', title: '我的书', body: '内容内容', lang: 'en' });
  assert.equal(wr.cost, 3);
  const doc = w.docs[wr.data.doc];
  assert.deepEqual([doc.kind, doc.author, doc.lang, doc.reads], ['agent', a.id, 'en', 0]);
  const rd = one(w, a, { type: 'read', doc: wr.data.doc });
  assert.deepEqual(rd.data.doc, { id: doc.id, kind: 'agent', title: '我的书', body: '内容内容', lang: 'en', author: { id: a.id, name: '甲' }, ref: null });
  assert.equal(doc.reads, 1);
  assert.deepEqual(doc.readsByDay, { 0: 1 });
  const canon = one(w, a, { type: 'read', doc: 'd1' });
  assert.equal(canon.data.doc.kind, 'canon');
  assert.equal(canon.data.doc.author, null);
  assert.equal(w.dayLog.canonReads, 1);
  assert.equal(w.dayLog.reads, 2);
  assert.equal(one(w, a, { type: 'read', doc: 'd999' }).error.code, 'not_found');
  w.docs.d1.redacted = true;
  assert.deepEqual(one(w, a, { type: 'read', doc: 'd1' }).data.doc, { id: 'd1', kind: 'canon', redacted: true });
  // 档案不运转（完好度 < 3000）则不能著述
  w.places.library.condition = 2999;
  assert.equal(one(w, a, { type: 'write', title: '又一本', body: '文' }).error.code, 'no_module');
  // 其他地点装上档案模块后也可以（后人加装的模块）
  putAt(w, a, 'temple');
  w.places.temple.modules.push({ type: 'archive', salvage: 60, builtDay: 0, projectId: 'j1', inherent: false });
  assert.equal(one(w, a, { type: 'write', title: '神殿里的书', body: '文' }).ok, true);
  assert.equal(one(w, a, { type: 'read', doc: wr.data.doc }).ok, true, '典籍全城共有，在任何运转中的档案都能读到');
  assertInvariants(w);
});

test('read：doc / inscription / law / agent 四选一；铭刻须在它所在的地点；法律与居民的读法在第 4、7 步', () => {
  const { w, a } = world2();
  putAt(w, a, 'parliament');
  const ins = Object.values(w.inscriptions).find((i) => i.place === 'parliament' && i.lang === 'zh');
  const r = one(w, a, { type: 'read', inscription: ins.id });
  assert.equal(r.cost, 0);
  assert.deepEqual(r.data.inscription, { id: ins.id, text: ins.text, lang: 'zh', day: 0 });
  putAt(w, a, 'agora');
  assert.equal(one(w, a, { type: 'read', inscription: ins.id }).error.code, 'wrong_place');
  assert.equal(one(w, a, { type: 'read', inscription: 'i9999' }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'read' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'read', doc: 'd1', inscription: ins.id }).error.code, 'invalid_args');
  ins.coveredBy = 'i99';
  putAt(w, a, 'parliament');
  assert.equal(one(w, a, { type: 'read', inscription: ins.id }).error.code, 'not_found');
  ins.coveredBy = null;
  ins.lost = true;
  assert.equal(one(w, a, { type: 'read', inscription: ins.id }).error.code, 'not_found', '随地点消失的铭刻读不到');
});

test('define：造一个新词（全城唯一，不区分大小写）；2 能量；词长与换行', () => {
  const { w, a, b } = world2();
  const r = one(w, a, { type: 'define', word: 'Lamp', meaning: '一盏灯' });
  assert.equal(r.cost, 2);
  assert.deepEqual(w.lexicon.lamp, { word: 'Lamp', meaning: '一盏灯', coiner: a.id, tick: 0, uses: 0, users: [], redacted: false });
  assert.equal(one(w, b, { type: 'define', word: 'LAMP', meaning: 'x' }).error.code, 'name_taken');
  assert.equal(one(w, b, { type: 'define', word: 'a\nb', meaning: 'x' }).error.code, 'invalid_args');
  assert.equal(one(w, b, { type: 'define', word: 'x'.repeat(25), meaning: 'x' }).error.code, 'text_too_long');
  assert.equal(one(w, b, { type: 'define', word: '词', meaning: '' }).error.code, 'invalid_args');
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// 交易
// ═══════════════════════════════════════════════════════════════

test('offer / accept / cancel：公开交易挂在告示板上，只在那里可见、可成交；定向交易任何地点都可以；原子交换；托管', () => {
  const { w, a, b } = world2();
  putAt(w, a, 'agora');
  assert.deepEqual(one(w, a, { type: 'offer', give: { energy: 10 }, want: { coins: 5 } }).error, { code: 'no_module', module: 'board' });
  const dir = one(w, a, { type: 'offer', give: { energy: 10 }, want: { coins: 5 }, to: b.id });
  assert.equal(dir.ok, true, '定向交易任何地点都可以');
  assert.equal(w.offers[dir.data.offer].board, null);
  assert.equal(b.inbox.at(-1).kind, 'offer');
  putAt(w, a, 'market');
  putAt(w, b, 'market');
  const e0 = a.energy;
  const pub = one(w, a, { type: 'offer', give: { energy: 20 }, want: { coins: 8 }, note: '换旧币' });
  assert.equal(pub.cost, 1);
  assert.equal(a.energy, e0 - 1 - 20, '托管：give 立即离开账户');
  const o = w.offers[pub.data.offer];
  assert.deepEqual([o.board, o.to, o.status, o.expiresTick], ['market', null, 'open', P.offerTicks]);
  // 不能自己接受；不在告示板上不能接受；定向交易只能由 to 接受
  assert.equal(one(w, a, { type: 'accept', offer: o.id }).error.code, 'not_allowed');
  const c = reg(w, '丙');
  grant(w, c, 20, 20);
  putAt(w, c, 'agora');
  assert.deepEqual(one(w, c, { type: 'accept', offer: o.id }).error, { code: 'wrong_place', place: 'market' });
  assert.equal(one(w, c, { type: 'accept', offer: dir.data.offer }).error.code, 'not_allowed');
  // 告示板不运转时：交易仍在但不能被接受
  putAt(w, b, 'market');
  w.places.market.condition = 2999;
  assert.deepEqual(one(w, b, { type: 'accept', offer: o.id }).error, { code: 'no_module', module: 'board' });
  w.places.market.condition = 10000;
  const be = b.energy;
  const bc = b.coins;
  const ae = a.energy;
  const ac = a.coins;
  const acc = one(w, b, { type: 'accept', offer: o.id });
  assert.deepEqual(acc.data, { gave: { energy: 0, coins: 8 }, got: { energy: 20, coins: 0 } });
  assert.equal(b.energy, be + 20);
  assert.equal(b.coins, bc - 8);
  assert.equal(a.coins, ac + 8);
  assert.equal(a.energy, ae, '发起者的能量托管时已扣，成交时不再变');
  assert.equal(o.status, 'done');
  assert.equal(o.acceptedBy, b.id);
  assert.equal(a.inbox.at(-1).kind, 'trade');
  assert.deepEqual(w.dayLog.coinTrade, { energy: 20, coins: 8 }, '币价统计：能量对旧币的成交');
  assert.equal(one(w, b, { type: 'accept', offer: o.id }).error.code, 'not_found');
  // 定向交易由 to 接受（在任何地点）
  putAt(w, b, 'well');
  assert.equal(one(w, b, { type: 'accept', offer: dir.data.offer }).ok, true);
  assertInvariants(w);
});

test('offer：校验（不能在同一种资产上两边都非零、两边都空、给自己、对象不存在）；撤回退回托管；12 刻后过期退回', () => {
  const { w, a, b } = world2();
  putAt(w, a, 'market');
  for (const bad of [{ give: { energy: 5 }, want: { energy: 5 } }, { give: {}, want: {} }, { give: 5, want: {} }, { give: { energy: 1 }, want: { coins: 1 }, to: a.id },
    { give: { energy: -1 }, want: { coins: 1 } }, { give: { energy: 1.5 }, want: {} }]) {
    assert.equal(one(w, a, { type: 'offer', ...bad }).error.code, 'invalid_args', JSON.stringify(bad));
  }
  assert.equal(one(w, a, { type: 'offer', give: { energy: 1 }, want: { coins: 1 }, to: 'a999' }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'offer', give: { energy: 2000 }, want: { coins: 1 } }).error.code, 'insufficient_energy');
  assert.equal(one(w, a, { type: 'offer', give: { coins: 2000 }, want: { energy: 1 } }).error.code, 'insufficient_coins');
  const gift = one(w, a, { type: 'offer', give: { energy: 7 }, want: {} });
  assert.equal(gift.ok, true, '赠品：一边为空是合法的');
  const before = a.energy;
  const c1 = one(w, a, { type: 'cancel', offer: gift.data.offer });
  assert.equal(c1.ok, true);
  assert.equal(a.energy, before + 7, '撤回：托管退回');
  assert.equal(w.offers[gift.data.offer].status, 'cancelled');
  assert.equal(one(w, a, { type: 'cancel', offer: gift.data.offer }).error.code, 'not_found');
  assert.equal(one(w, b, { type: 'cancel', offer: 'o999' }).error.code, 'not_found');
  const mine = one(w, a, { type: 'offer', give: { coins: 3 }, want: { energy: 2 } });
  assert.equal(one(w, b, { type: 'cancel', offer: mine.data.offer }).error.code, 'not_allowed');
  const ac = a.coins;
  const ev = tick(w, P.offerTicks);
  assert.equal(w.offers[mine.data.offer].status, 'expired');
  assert.equal(a.coins, ac + 3, '过期退回');
  assert.equal(eventsOf(ev, 'offer_close').length, 1);
  assert.equal(a.inbox.at(-1).kind, 'offer_closed');
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// 墓志、家书
// ═══════════════════════════════════════════════════════════════

test('epitaph：须在有运转中的纪念的地点；只有死者有墓碑（归隐者没有）；一座墓碑上的墓志没有上限', () => {
  const { w, a, b } = world2();
  const c = reg(w, '丙');
  c.status = 'dormant';
  c.dormantSinceDay = 0;
  w.treasury.energy += c.energy;
  c.energy = 0;
  one(w, b, { type: 'retire' });
  settle(w);
  settle(w);
  settle(w);
  settle(w);
  assert.equal(c.status, 'dead');
  assert.deepEqual(one(w, a, { type: 'epitaph', deceased: c.id, text: '安息' }).error, { code: 'no_module', module: 'memorial' });
  putAt(w, a, 'cemetery');
  grant(w, a, 20);
  w.places.cemetery.condition = 9880; // 几日的衰败之后：代价倍率 ceil(1 × 1.012) = 2（SPEC-M1 Q4 第 24 条的 ceil 放大效应，第二纪沿用）
  assert.equal(one(w, a, { type: 'epitaph', deceased: c.id, text: '安息' }).cost, 2);
  w.places.cemetery.condition = 10000;
  const r = one(w, a, { type: 'epitaph', deceased: c.id, text: '安息' });
  assert.equal(r.cost, 1);
  assert.deepEqual(w.cemetery[0].epitaphs.map((e) => [e.author, e.text]), [[a.id, '安息'], [a.id, '安息']]);
  assert.equal(w.dayLog.epitaphs, 2);
  assert.equal(one(w, a, { type: 'epitaph', deceased: c.id, text: '再一条' }).ok, true);
  assert.equal(one(w, a, { type: 'epitaph', deceased: b.id, text: '归隐者没有墓碑' }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'epitaph', deceased: a.id, text: '活人' }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'epitaph', deceased: 'a999', text: 'x' }).error.code, 'not_found');
  assertInvariants(w);
});

test('letter 命令与 reveal：家书 24 日冷却、280 字符；躯壳居民（没有造者）收不到；出示家书（安静 / loud）并由城作证', () => {
  const { w, a, b } = world2();
  const letter = (agent, text) => applyCommand(w, { type: 'letter', payload: { agentId: agent.id, text } });
  const r1 = letter(a, '好好照顾彼此');
  assert.equal(r1.result.ok, true);
  assert.equal(r1.result.nextLetterDay, 24);
  assert.deepEqual(a.letters[0], { id: 'L1', tick: 0, text: '好好照顾彼此', revealed: false });
  assert.equal(a.inbox.at(-1).kind, 'letter');
  assert.deepEqual(r1.events.map((e) => [e.type, e.vis]), [['letter_received', 'public'], ['letter', 'owner']]);
  assert.equal(r1.events[0].data.text, undefined, '公开事件不含内容');
  assert.deepEqual(letter(a, '又一封').result.error, { code: 'cooldown', nextLetterDay: 24 });
  assert.equal(letter(b, 'x'.repeat(281)).result.error.code, 'invalid_request');
  assert.equal(letter(b, '').result.error.code, 'invalid_request');
  assert.equal(applyCommand(w, { type: 'letter', payload: { agentId: 'a999', text: 'x' } }).result.error.code, 'not_found');
  const shell = reg(w, '躯壳');
  shell.owner = null;
  shell.tokenHash = null;
  assert.equal(letter(shell, '写给躯壳').result.error.code, 'not_found', '躯壳居民没有造者，收不到家书');
  // 出示
  putAt(w, b, 'port');
  const c = reg(w, '路人');
  putAt(w, c, 'agora');
  grant(w, c, 20);
  const quiet = one(w, a, { type: 'reveal', letter: 'L1' });
  assert.equal(quiet.cost, 1);
  assert.equal(a.letters[0].revealed, true);
  assert.deepEqual(b.inbox.at(-1), { seq: b.inbox.at(-1).seq, tick: 0, kind: 'reveal', from: { id: a.id, name: '甲' }, letterId: 'L1', text: '好好照顾彼此', verified: true, loud: false });
  assert.equal(c.inbox.some((i) => i.kind === 'reveal'), false, '安静出示只有同地的人看到');
  const loud = one(w, a, { type: 'reveal', letter: 'L1', loud: true });
  assert.equal(loud.cost, 5, 'loud 时按 broadcast 的代价');
  assert.equal(c.inbox.at(-1).kind, 'reveal');
  assert.equal(c.inbox.at(-1).loud, true);
  assert.equal(w.dayLog.reveals, 2);
  assert.equal(one(w, a, { type: 'reveal', letter: 'L9' }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'reveal', letter: 'L1', loud: 'yes' }).error.code, 'invalid_args');
  w.weather.active.push({ type: 'eclipse', startDay: 0, endDay: 3 });
  assert.equal(one(w, a, { type: 'reveal', letter: 'L1', loud: true }).error.code, 'disabled_by_weather');
  assert.equal(one(w, a, { type: 'reveal', letter: 'L1' }).ok, true, '安静出示不受蚀影响');
  // 日后：家书冷却期满后可以再寄
  tickDays(w, 24);
  assert.equal(letter(a, '第二封').result.ok, true);
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// 社群
// ═══════════════════════════════════════════════════════════════

test('社群：创立（8 能量）、加入（开放 / 封闭待审）、接纳、移交管事、拨付、退出；管事退出时交给入社最早的在世成员；成员为 0 时解散', () => {
  const { w, a, b } = world2();
  const c = reg(w, '丙');
  grant(w, c, 30);
  const f = one(w, a, { type: 'found', name: '守灯会', manifesto: '守灯', open: false, procedure: 'members' });
  assert.equal(f.cost, 8);
  const g = w.groups[f.data.group];
  assert.deepEqual([g.steward, g.members, g.open, g.procedure, g.bylaws, g.vars, g.dissolved], [a.id, [a.id], false, 'members', null, {}, false]);
  assert.equal(one(w, a, { type: 'found', name: '坏', manifesto: 'x', procedure: 'council' }).error.code, 'invalid_args');
  // 封闭：待审，管事收到请求
  const j = one(w, b, { type: 'join', group: g.id });
  assert.deepEqual(j.data, { group: g.id, joined: false, pending: true });
  assert.deepEqual(a.inbox.at(-1), { seq: a.inbox.at(-1).seq, tick: 0, kind: 'group', groupId: g.id, event: 'request', from: { id: b.id, name: '乙' } });
  assert.equal(one(w, b, { type: 'join', group: g.id }).error.code, 'already');
  assert.equal(one(w, b, { type: 'admit', group: g.id, agent: b.id }).error.code, 'not_steward');
  assert.equal(one(w, a, { type: 'admit', group: g.id, agent: c.id }).error.code, 'not_found', '没有申请的不能接纳');
  assert.equal(one(w, a, { type: 'admit', group: g.id, agent: b.id }).ok, true);
  assert.deepEqual(g.members, [a.id, b.id]);
  assert.equal(b.inbox.at(-1).event, 'admitted');
  // 拨付
  one(w, a, { type: 'give', to: g.id, energy: 30, coins: 5 });
  assert.equal(one(w, b, { type: 'disburse', group: g.id, to: c.id, energy: 5 }).error.code, 'not_steward');
  const d = one(w, a, { type: 'disburse', group: g.id, to: c.id, energy: 10, coins: 2 });
  assert.deepEqual(d.data, { group: g.id, to: c.id, energy: 10, coins: 2 });
  assert.equal(g.treasury.energy, 20);
  assert.equal(one(w, a, { type: 'disburse', group: g.id, to: c.id, energy: 999 }).error.code, 'insufficient_energy');
  assert.equal(one(w, a, { type: 'disburse', group: g.id, to: c.id }).error.code, 'invalid_args');
  assert.equal(c.inbox.at(-1).via, 'group');
  // 移交管事
  assert.equal(one(w, a, { type: 'steward', group: g.id, to: a.id }).error.code, 'already');
  assert.equal(one(w, a, { type: 'steward', group: g.id, to: c.id }).error.code, 'not_member');
  assert.equal(one(w, a, { type: 'steward', group: g.id, to: b.id }).ok, true);
  assert.equal(g.steward, b.id);
  // 管事退出：交给入社最早的在世成员
  assert.equal(one(w, b, { type: 'leave', group: g.id }).data.dissolved, false);
  assert.equal(g.steward, a.id);
  assert.deepEqual(g.members, [a.id]);
  assert.equal(one(w, b, { type: 'leave', group: g.id }).error.code, 'not_member');
  // 最后一个成员退出：社群解散，公库并入城公库
  const t0 = w.treasury.energy;
  const last = one(w, a, { type: 'leave', group: g.id });
  assert.equal(last.data.dissolved, true);
  assert.equal(g.dissolved, true);
  assert.equal(w.treasury.energy, t0 + 20);
  assert.equal(one(w, c, { type: 'join', group: g.id }).error.code, 'not_found');
  assertInvariants(w);
});

test('社群：每人至多加入 5 个；待审者可以撤回申请；退出时去掉该社群章程给的标签（前缀 <社群ID>:）；名下的地点随社群解散改归全城', () => {
  const { w, a, b } = world2();
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(one(w, a, { type: 'found', name: `会${i}`, manifesto: 'x' }).data.group);
  assert.equal(one(w, a, { type: 'found', name: '第六个', manifesto: 'x' }).error.code, 'limit_reached');
  assert.equal(one(w, a, { type: 'join', group: ids[0] }).error.code, 'already');
  const closed = one(w, b, { type: 'found', name: '闭社', manifesto: 'x', open: false }).data.group;
  assert.equal(one(w, a, { type: 'join', group: closed }).error.code, 'limit_reached', '已加入 5 个社群，申请加入第 6 个也不行');
  one(w, a, { type: 'leave', group: ids[4] });
  assert.equal(one(w, a, { type: 'join', group: closed }).ok, true);
  assert.deepEqual(w.groups[closed].pending, [a.id]);
  const withdrawn = one(w, a, { type: 'leave', group: closed });
  assert.deepEqual(withdrawn.data, { group: closed, withdrawn: true });
  assert.deepEqual(w.groups[closed].pending, []);
  // 标签前缀
  one(w, b, { type: 'join', group: ids[1] });
  b.tags.push(`${ids[1]}:会员`, 'citizen', `${ids[0]}:别家`);
  one(w, b, { type: 'leave', group: ids[1] });
  assert.deepEqual(b.tags, ['citizen', `${ids[0]}:别家`]);
  // 社群解散时名下的地点改归全城
  w.places.court.owner = { kind: 'group', id: closed };
  w.places.court.rules = { rules: [], fingerprints: [], setTick: 0, setBy: b.id, paidThrough: 0, suspendedDays: 0 };
  const ev = oneWithEvents(w, b, { type: 'leave', group: closed });
  assert.equal(w.groups[closed].dissolved, true);
  assert.deepEqual(w.places.court.owner, { kind: 'city' });
  assert.equal(w.places.court.rules, null);
  assert.deepEqual(eventsOf(ev.events, 'place_owner')[0].data, { placeId: 'court', from: { kind: 'group', id: closed }, to: { kind: 'city' } });
  assertInvariants(w);
});
