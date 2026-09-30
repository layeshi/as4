import test from 'node:test';
import assert from 'node:assert/strict';
import { wallInscriptions } from '../src/engine/environment.js';
import { newWorld, reg, act, actRaw, one, tick, grant, eventsOf, assertInvariants } from './helpers.js';

const world = () => {
  const w = newWorld('ins');
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  grant(w, a, 1000);
  grant(w, b, 1000);
  return { w, a, b };
};
const at = (a, place) => { a.place = place; };

test('inscribe：新刻花 3 能量，任何语言；产生 inscribe 事件；同在的人收到 witness，作者身份不进感知', () => {
  const { w, a, b } = world();
  at(a, 'agora');
  at(b, 'agora');
  const { result, events } = actRaw(w, a, [{ type: 'inscribe', text: '此处曾有人等过你' }]);
  const r = result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.cost, 3);
  assert.deepEqual(r.data, { inscription: 'i9' });
  const i = w.inscriptions.i9;
  assert.deepEqual([i.place, i.text, i.lang, i.author, i.baseCost, i.coveredBy, i.redacted], ['agora', '此处曾有人等过你', 'zh', a.id, 3, null, false]);
  assert.deepEqual(i.protectedBy, []);
  assert.equal(a.stats.inscribed, 1);
  assert.equal(w.dayLog.inscriptions, 1);
  const ev = eventsOf(events, 'inscribe')[0];
  assert.deepEqual(ev.data, { inscriptionId: 'i9', text: '此处曾有人等过你', cover: null });
  assert.equal(ev.agent, a.id); // 观众可以看到作者
  const wit = b.inbox.filter((x) => x.kind === 'witness');
  assert.equal(wit.length, 1);
  assert.deepEqual([wit[0].what, wit[0].actor.id, wit[0].text, wit[0].place], ['inscribe', a.id, '此处曾有人等过你', 'agora']);
  assert.equal(a.inbox.filter((x) => x.kind === 'witness').length, 0);
  assertInvariants(w);
});

test('inscribe：文本与语言校验；lang 缺省取自己的语言', () => {
  const { w, a } = world();
  at(a, 'agora');
  assert.equal(one(w, a, { type: 'inscribe', text: 'x'.repeat(141) }).error.code, 'text_too_long');
  assert.equal(one(w, a, { type: 'inscribe', text: '' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'inscribe', text: 5 }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'inscribe', text: 'x'.repeat(140), lang: 'es' }).ok, true);
  assert.equal(w.inscriptions.i9.lang, 'es');
  assert.equal(one(w, a, { type: 'inscribe', text: 'y', lang: '???' }).error.code, 'invalid_args');
});

test('墙位有限：议会 12 个（宪章占 8），其他地点 6 个；墙满且未指定 cover 时 wall_full', () => {
  const { w, a } = world();
  at(a, 'parliament');
  assert.equal(wallInscriptions(w, 'parliament').length, 8);
  for (let i = 0; i < 4; i++) assert.equal(one(w, a, { type: 'inscribe', text: `议${i}` }).ok, true);
  assert.equal(wallInscriptions(w, 'parliament').length, 12);
  const full = one(w, a, { type: 'inscribe', text: '再刻一条' });
  assert.equal(full.error.code, 'wall_full');
  assert.equal(full.cost, 0);
  at(a, 'temple');
  for (let i = 0; i < 6; i++) assert.equal(one(w, a, { type: 'inscribe', text: `殿${i}` }).ok, true);
  assert.equal(one(w, a, { type: 'inscribe', text: '第七条' }).error.code, 'wall_full');
  assertInvariants(w);
});

test('覆盖：代价 = min(100, max(3, 2 × 被覆盖者的基础代价))，逐次翻倍直到封顶 100；被覆盖者从墙上消失但仍在历史里', () => {
  const { w, a } = world();
  at(a, 'agora');
  one(w, a, { type: 'inscribe', text: '初刻' }); // i9，baseCost 3
  let target = 'i9';
  const costs = [];
  for (let n = 0; n < 8; n++) {
    const r = one(w, a, { type: 'inscribe', text: `覆盖${n}`, cover: target });
    assert.equal(r.ok, true, JSON.stringify(r));
    costs.push(r.cost);
    target = r.data.inscription;
    assert.equal(r.data.covered, `i${9 + n}`);
  }
  assert.deepEqual(costs, [6, 12, 24, 48, 96, 100, 100, 100]);
  // 新铭刻的 baseCost 就是这次的基础代价
  assert.equal(w.inscriptions.i10.baseCost, 6);
  assert.equal(w.inscriptions.i14.baseCost, 96);
  assert.equal(w.inscriptions.i15.baseCost, 100);
  // 被覆盖者：coveredBy 指向覆盖它的，不再在墙上可见
  assert.equal(w.inscriptions.i9.coveredBy, 'i10');
  assert.ok(w.inscriptions.i9.coveredTick !== null);
  assert.equal(wallInscriptions(w, 'agora').length, 1);
  assert.equal(w.dayLog.covered, 8);
  assert.equal(Object.keys(w.inscriptions).length, 8 + 1 + 8);
  assertInvariants(w);
});

test('覆盖：目标必须是本地墙上可见的铭刻；不能覆盖已被覆盖的、别处的、不存在的', () => {
  const { w, a } = world();
  at(a, 'agora');
  one(w, a, { type: 'inscribe', text: '甲' }); // i9
  one(w, a, { type: 'inscribe', text: '乙', cover: 'i9' }); // i10 覆盖 i9
  assert.equal(one(w, a, { type: 'inscribe', text: 'x', cover: 'i9' }).error.code, 'not_found'); // 已被覆盖
  assert.equal(one(w, a, { type: 'inscribe', text: 'x', cover: 'i1' }).error.code, 'not_found'); // 议会的
  assert.equal(one(w, a, { type: 'inscribe', text: 'x', cover: 'i99' }).error.code, 'not_found');
  assert.equal(one(w, a, { type: 'inscribe', text: 'x', cover: 5 }).error.code, 'invalid_args');
  // 墙上有空位时也可以覆盖
  assert.equal(one(w, a, { type: 'inscribe', text: '丙', cover: 'i10' }).ok, true);
});

test('覆盖：议会墙上的人类宪章可以被覆盖（首次覆盖 6 能量），其他语言的刻文不受影响', () => {
  const { w, a } = world();
  at(a, 'parliament');
  const r = one(w, a, { type: 'inscribe', text: '新的宪章', cover: 'i1' });
  assert.equal(r.ok, true);
  assert.equal(r.cost, 6);
  assert.equal(w.inscriptions.i1.coveredBy, r.data.inscription);
  assert.equal(wallInscriptions(w, 'parliament').filter((i) => i.author === 'humans').length, 7);
  // 宪章的法律文本不受墙上刻字的影响
  assert.equal(w.charter[0].versions.zh, '凡自港口入城者，皆为公民，权利平等。');
});

test('保护：受保护的铭刻不能被覆盖；保护是 protectedBy 非空', () => {
  const { w, a } = world();
  at(a, 'agora');
  one(w, a, { type: 'inscribe', text: '不可覆盖' }); // i9
  w.inscriptions.i9.protectedBy.push('l1');
  const e = a.energy;
  const r = one(w, a, { type: 'inscribe', text: '想覆盖', cover: 'i9' });
  assert.equal(r.error.code, 'protected');
  assert.equal(a.energy, e);
  w.inscriptions.i9.protectedBy.length = 0;
  assert.equal(one(w, a, { type: 'inscribe', text: '现在可以了', cover: 'i9' }).ok, true);
});

test('代价倍率：在议会等 cost 类地点刻字，代价按完好度上升；baseCost 记录的是不含倍率的基础代价', () => {
  const { w, a } = world();
  at(a, 'parliament');
  w.places.parliament.condition = 5000;
  const r = one(w, a, { type: 'inscribe', text: '倍率' });
  assert.equal(r.cost, 5); // ceil(3 × 1.5)
  assert.equal(w.inscriptions.i9.baseCost, 3);
  const r2 = one(w, a, { type: 'inscribe', text: '覆盖倍率', cover: 'i9' });
  assert.equal(r2.cost, 9); // 基础 6，ceil(6 × 1.5)
  assert.equal(w.inscriptions.i10.baseCost, 6);
  w.places.parliament.condition = 0;
  const r3 = one(w, a, { type: 'inscribe', text: '废墟', cover: 'i10' });
  assert.equal(r3.cost, 24); // 基础 12，×2
  assertInvariants(w);
});

test('被遮盖的铭刻不占墙位；能量不足时刻字失败且不扣能量', () => {
  const { w, a } = world();
  at(a, 'temple');
  for (let i = 0; i < 6; i++) one(w, a, { type: 'inscribe', text: `殿${i}` });
  assert.equal(one(w, a, { type: 'inscribe', text: 'x' }).error.code, 'wall_full');
  w.inscriptions.i9.redacted = true; // 内容审核遮盖
  assert.equal(wallInscriptions(w, 'temple').length, 5);
  assert.equal(one(w, a, { type: 'inscribe', text: '腾出的墙位' }).ok, true);
  a.energy = 2;
  w.ledger.prev.energy -= 0;
  const e = a.energy;
  w.inscriptions.i10.redacted = true;
  const r = one(w, a, { type: 'inscribe', text: '没有能量了' });
  assert.equal(r.error.code, 'insufficient_energy');
  assert.equal(a.energy, e);
});
