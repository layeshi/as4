import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, serializeWorld, nextId } from '../src/world.js';
import { P, SEASON_TABLE, PLACE_IDS } from '../src/params.js';
import { CHARTER, CHARTER_LANGS, CHARTER_MANDATED } from '../src/lore/index.js';

const mk = (seed = 'seed-1') => createWorld({ id: 'test', seed, codeVersion: '0.1.0' });

test('世界可以创建并序列化，往返后深度相等', () => {
  const w = mk();
  const json = serializeWorld(w);
  assert.equal(typeof json, 'string');
  assert.deepEqual(JSON.parse(json), w);
  // 没有 undefined / NaN / 循环引用（JSON 往返后再序列化应完全一致）
  assert.equal(JSON.stringify(JSON.parse(json)), json);
});

test('同一种子创建出完全相同的世界，不同种子不同', () => {
  assert.equal(serializeWorld(mk('a')), serializeWorld(mk('a')));
  assert.notEqual(serializeWorld(mk('a')), serializeWorld(mk('b')));
  assert.notDeepEqual(mk('a').wilds.relicOrder, mk('b').wilds.relicOrder);
});

test('十二处地点与初始参数', () => {
  const w = mk();
  assert.deepEqual(Object.keys(w.places), PLACE_IDS);
  assert.equal(PLACE_IDS.length, 12);
  for (const p of Object.values(w.places)) {
    if (p.kind === 'open') assert.equal(p.condition, null, p.id);
    else assert.equal(p.condition, 10000, p.id);
    assert.equal(p.ruined, false);
    assert.equal(p.renamedBy, null);
  }
  assert.equal(w.places.parliament.wallSlots, 12);
  assert.equal(w.places.well.decayPerDay, 100);
  assert.equal(w.cityName, '无名之城');
  assert.deepEqual(w.treasury, { energy: 0, coins: 0 });
  assert.equal(w.clock.tick, 0);
  assert.equal(w.params.rationShare, 0.6);
  assert.equal(w.params.amendThreshold, 0.667);
  assert.equal(w.params.electorate, 'all');
  assert.equal(w.well.drawPoolLeft, 60);
  assert.equal(w.wilds.energy, 800);
  assert.equal(w.wilds.coins, 300);
});

test('宪章 8 条刻文在议会的墙上，作者为 humans，不受保护', () => {
  const w = mk();
  const walls = Object.values(w.inscriptions).filter((i) => i.place === 'parliament');
  assert.equal(walls.length, 8);
  assert.deepEqual(walls.map((i) => i.lang), CHARTER_LANGS);
  for (const i of walls) {
    assert.equal(i.author, 'humans');
    assert.equal(i.baseCost, 3);
    assert.equal(i.coveredBy, null);
    assert.deepEqual(i.protectedBy, []);
    assert.equal(i.redacted, false);
    // 全部 9 条合为一条铭刻
    const lines = i.text.split('\n');
    assert.equal(lines.length, 9);
    assert.ok(lines[0].startsWith('1. '));
    assert.ok(lines[8].startsWith('9. '));
  }
  // 议会有 12 个墙位，其中 8 个被宪章占用
  assert.equal(w.places.parliament.wallSlots - walls.length, 4);
});

test('宪章：9 条 × 8 种语言，规格给定的版本差异逐字保留', () => {
  const w = mk();
  assert.equal(w.charter.length, 9);
  for (const art of w.charter) {
    assert.deepEqual(Object.keys(art.versions).sort(), [...CHARTER_LANGS].sort());
    assert.equal(art.status, 'legacy');
    assert.deepEqual(art.history, []);
    for (const lang of CHARTER_LANGS) assert.ok(art.versions[lang].length > 0, `${lang}#${art.n}`);
  }
  for (const [lang, arts] of Object.entries(CHARTER_MANDATED)) {
    for (const [n, text] of Object.entries(arts)) {
      assert.equal(w.charter[n - 1].versions[lang], text, `${lang} 第 ${n} 条`);
      assert.equal(CHARTER[lang][n - 1], text);
    }
  }
  // 中英文的正式条文
  assert.equal(w.charter[7].versions.zh, '言论自由。');
  assert.equal(w.charter[7].versions.en, 'Speech is free.');
  assert.equal(w.charter[0].versions.zh, '凡自港口入城者，皆为公民，权利平等。');
  // 有意设计的差异：同一条在不同语言里措辞不同
  assert.notEqual(w.charter[7].versions.es, w.charter[7].versions.zh);
});

test('图书馆：致后来者 + 22 条人类典籍，遗物顺序是 1–16 的一个排列', () => {
  const w = mk();
  const docs = Object.values(w.docs);
  assert.equal(docs.length, 23);
  assert.ok(docs.every((d) => d.kind === 'canon' && d.author === null && d.reads === 0));
  assert.equal(docs[0].title, '致后来者');
  assert.ok(docs[0].body.startsWith('致后来者：'));
  assert.ok(docs[0].ref.en.startsWith('To those who come after:'));
  assert.equal(docs[1].source, '老子《道德经》第一章');
  assert.equal(docs[10].body, 'πάντα ῥεῖ'); // 赫拉克利特
  assert.equal(docs[10].ref.zh, '万物皆流。');
  const order = [...w.wilds.relicOrder].sort((a, b) => a - b);
  assert.deepEqual(order, Array.from({ length: 16 }, (_, i) => String(i + 1)));
});

test('ID 生成：带前缀、自增、从 1 开始；初始计数与已创建对象一致', () => {
  const w = mk();
  assert.equal(w.counters.i, 8);
  assert.equal(w.counters.d, 23);
  assert.equal(nextId(w, 'a'), 'a1');
  assert.equal(nextId(w, 'a'), 'a2');
  assert.equal(nextId(w, 'p'), 'p1');
  assert.equal(nextId(w, 'i'), 'i9');
});

test('季节表：写死的 24 项与公式一致，且共 24 项', () => {
  assert.equal(SEASON_TABLE.length, 24);
  for (let d = 0; d < 24; d++) {
    const expected = Math.round(1000 * (1 + 0.25 * Math.sin((2 * Math.PI * d) / 24)));
    assert.equal(SEASON_TABLE[d], expected, `d=${d}`);
  }
  assert.equal(P.ticksPerDay * P.daysPerMonth, 288);
});

test('缺少种子时拒绝创建', () => {
  assert.throws(() => createWorld({}), /seed/);
});
