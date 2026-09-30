import test from 'node:test';
import assert from 'node:assert/strict';
import { createStream, createStreams, next, int, shuffle, pickWeighted, STREAMS } from '../src/rng.js';
import { normalizeText, cpLength, truncateCp, checkText, nameKey, detectScript, countWord } from '../src/text.js';
import { screen, setBlocklist } from '../src/moderation.js';

// ── rng ───────────────────────────────────────────────────

test('rng：同一种子与流名给出同一序列，不同流互相独立', () => {
  const a = createStream('s', 'world');
  const b = createStream('s', 'world');
  const c = createStream('s', 'weather');
  const d = createStream('t', 'world');
  const sa = Array.from({ length: 20 }, () => next(a));
  const sb = Array.from({ length: 20 }, () => next(b));
  const sc = Array.from({ length: 20 }, () => next(c));
  const sd = Array.from({ length: 20 }, () => next(d));
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.notDeepEqual(sa, sd);
  for (const x of sa) assert.ok(x >= 0 && x < 1);
});

test('rng：状态可序列化，恢复后继续同一序列；createStreams 有三条流', () => {
  const streams = createStreams('seed');
  assert.deepEqual(Object.keys(streams), [...STREAMS]);
  for (let i = 0; i < 7; i++) next(streams.world);
  const saved = JSON.parse(JSON.stringify(streams));
  const cont1 = Array.from({ length: 10 }, () => next(streams.world));
  const cont2 = Array.from({ length: 10 }, () => next(saved.world));
  assert.deepEqual(cont1, cont2);
});

test('rng：分布大致均匀；int、shuffle、pickWeighted 行为正确', () => {
  const s = createStream('dist', 'world');
  let sum = 0;
  const buckets = new Array(10).fill(0);
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const x = next(s);
    sum += x;
    buckets[Math.floor(x * 10)]++;
  }
  assert.ok(Math.abs(sum / N - 0.5) < 0.01);
  for (const b of buckets) assert.ok(Math.abs(b / N - 0.1) < 0.02);

  for (let i = 0; i < 1000; i++) {
    const v = int(s, 7);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 7);
  }
  const arr = Array.from({ length: 30 }, (_, i) => i);
  const sh = shuffle(s, arr.slice());
  assert.deepEqual(sh.slice().sort((x, y) => x - y), arr);
  assert.notDeepEqual(sh, arr);

  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 6000; i++) counts[pickWeighted(s, [['a', 1], ['b', 2], ['c', 3]])]++;
  assert.ok(counts.c > counts.b && counts.b > counts.a);
  assert.equal(pickWeighted(s, [['x', 0], ['y', 5]]), 'y');
});

// ── text ──────────────────────────────────────────────────

test('text：NFC、去控制字符（保留换行）、去首尾空白', () => {
  assert.equal(normalizeText('  é  '), 'é'); // e + 组合重音 → é
  assert.equal(normalizeText('a\u0000b\u0007c\td'), 'abcd');
  assert.equal(normalizeText('第一行\r\n第二行'), '第一行\n第二行');
  assert.equal(normalizeText('\n  hi \n'), 'hi');
  assert.equal(normalizeText(42), null);
  assert.equal(normalizeText(undefined), null);
});

test('text：长度按码点计', () => {
  assert.equal(cpLength('abc'), 3);
  assert.equal(cpLength('你好'), 2);
  assert.equal(cpLength('😀😀'), 2);
  assert.equal(truncateCp('😀😀😀', 2), '😀😀');
  assert.equal(truncateCp('hello', 10), 'hello');
  assert.equal(truncateCp('你好世界', 2), '你好');
});

test('text：checkText 的错误码', () => {
  assert.deepEqual(checkText('hi', { max: 5 }), { ok: true, text: 'hi' });
  assert.deepEqual(checkText('toolong', { max: 3 }), { ok: false, code: 'text_too_long' });
  assert.deepEqual(checkText('   ', { max: 3 }), { ok: false, code: 'invalid_args' });
  assert.deepEqual(checkText(5, { max: 3 }), { ok: false, code: 'invalid_args' });
  assert.deepEqual(checkText('😀😀😀', { max: 3 }), { ok: true, text: '😀😀😀' });
  assert.equal(checkText('', { max: 3, min: 0 }).ok, true);
});

test('text：名字比较键做 NFC + 小写', () => {
  assert.equal(nameKey('Élan'), nameKey('élan'));
  assert.equal(nameKey('ABC'), 'abc');
});

test('text：文字系统识别', () => {
  assert.equal(detectScript('你好，世界'), 'han');
  assert.equal(detectScript('こんにちは、世界'), 'kana');
  assert.equal(detectScript('今日はいい天気ですね'), 'kana');
  assert.equal(detectScript('Hello there'), 'latin');
  assert.equal(detectScript('¿Hay alguien aquí?'), 'latin');
  assert.equal(detectScript('Привет, город'), 'cyrillic');
  assert.equal(detectScript('مرحبا بالمدينة'), 'arabic');
  assert.equal(detectScript('नमस्ते'), 'devanagari');
  assert.equal(detectScript('안녕하세요'), 'hangul');
  assert.equal(detectScript('πάντα ῥεῖ'), 'greek');
  assert.equal(detectScript('12345 !!!'), null);
  assert.equal(detectScript('😀'), null);
  assert.equal(detectScript(''), null);
  // 中文里夹一个片假名词，仍是汉字
  assert.equal(detectScript('我们在市场里遇到了一位叫做タロウ的商人，他说了很多话'), 'han');
});

test('text：词典匹配——汉字词做子串匹配，其他词按词边界（不区分大小写）', () => {
  assert.equal(countWord('灯火与灯火之间还有灯', '灯火'), 2);
  assert.equal(countWord('灯火', '灯火'), 1);
  assert.equal(countWord('nothing here', '灯火'), 0);
  assert.equal(countWord('The lamplight, the LAMP, a lamp.', 'lamp'), 2);
  assert.equal(countWord('lamplight', 'lamp'), 0);
  assert.equal(countWord('Lamp-post', 'lamp'), 1);
  assert.equal(countWord('c++ is c++', 'c++'), 2);
  assert.equal(countWord('anything', ''), 0);
});

// ── moderation ────────────────────────────────────────────

test('moderation：默认全部通过；设置屏蔽词后拦截，子串、不区分大小写', () => {
  setBlocklist([]);
  assert.deepEqual(screen('任何话'), { ok: true });
  setBlocklist(['BadWord', '  ', '坏词']);
  assert.equal(screen('this has a badword inside').ok, false);
  assert.equal(screen('这里有个坏词。').ok, false);
  assert.equal(screen('干净的话').ok, true);
  setBlocklist([]);
});
