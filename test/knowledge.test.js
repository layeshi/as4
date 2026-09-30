import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../src/engine/index.js';
import { setBlocklist } from '../src/moderation.js';
import { newWorld, reg, act, actRaw, one, tick, settle, grant, eventsOf, assertInvariants } from './helpers.js';

const world = (names = ['甲', '乙']) => {
  const w = newWorld('know');
  const agents = names.map((n) => reg(w, n));
  for (const a of agents) grant(w, a, 100);
  return { w, agents };
};
const at = (a, place) => { a.place = place; };

// ── 著述与阅读 ───────────────────────────────────────────────

test('write：只能在图书馆，花 3 能量；存入典籍，所有人可读；lang 缺省取自己的语言', () => {
  const { w, agents: [a] } = world(['甲']);
  assert.equal(one(w, a, { type: 'write', title: '题', body: '文' }).error.code, 'wrong_place');
  at(a, 'library');
  const { result, events } = actRaw(w, a, [{ type: 'write', title: '论井', body: '井是城的心脏。' }]);
  const r = result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.cost, 3);
  assert.deepEqual(r.data, { doc: 'd24' });
  const d = w.docs.d24;
  assert.deepEqual([d.kind, d.title, d.body, d.lang, d.author, d.source, d.ref, d.reads], ['agent', '论井', '井是城的心脏。', 'zh', a.id, null, null, 0]);
  assert.deepEqual(eventsOf(events, 'write')[0].data, { docId: 'd24', title: '论井' });
  assert.equal(one(w, a, { type: 'write', title: 'x', body: 'y', lang: 'es' }).ok, true);
  assert.equal(w.docs.d25.lang, 'es');
  assert.equal(one(w, a, { type: 'write', title: '', body: 'y' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'write', title: 'x'.repeat(61), body: 'y' }).error.code, 'text_too_long');
  assert.equal(one(w, a, { type: 'write', title: 'x', body: 'y'.repeat(4001) }).error.code, 'text_too_long');
  assert.equal(one(w, a, { type: 'write', title: 'x', body: 'y'.repeat(4000) }).ok, true);
  assertInvariants(w);
});

test('write：图书馆损坏时代价上升（废墟时 ×2）', () => {
  const { w, agents: [a] } = world(['甲']);
  at(a, 'library');
  w.places.library.condition = 0;
  assert.equal(one(w, a, { type: 'write', title: 'x', body: 'y' }).cost, 6);
});

test('read：读取典籍全文，reads 与 readsByDay 加 1；人类典籍的阅读单独计数', () => {
  const { w, agents: [a, b] } = world();
  at(a, 'library');
  at(b, 'agora');
  assert.equal(one(w, b, { type: 'read', doc: 'd2' }).error.code, 'wrong_place');
  const { result, events } = actRaw(w, a, [{ type: 'read', doc: 'd2' }]);
  const r = result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.cost, 0);
  assert.equal(r.data.doc.id, 'd2');
  assert.equal(r.data.doc.title, '老子《道德经》第一章');
  assert.equal(r.data.doc.body, '道可道，非常道；名可名，非常名。');
  assert.equal(r.data.doc.kind, 'canon');
  assert.equal(r.data.doc.author, null);
  assert.ok(r.data.doc.ref.en.includes('constant Way'));
  assert.equal(w.docs.d2.reads, 1);
  assert.deepEqual(w.docs.d2.readsByDay, { 0: 1 });
  assert.equal(w.dayLog.reads, 1);
  assert.equal(w.dayLog.canonReads, 1);
  assert.deepEqual(eventsOf(events, 'read')[0].data, { docId: 'd2', title: '老子《道德经》第一章' });
  // agent 的著述：带作者
  one(w, a, { type: 'write', title: '我的书', body: '内容' });
  at(b, 'library');
  const rb = one(w, b, { type: 'read', doc: 'd24' });
  assert.deepEqual(rb.data.doc.author, { id: a.id, name: '甲' });
  assert.equal(w.dayLog.canonReads, 1);
  assert.equal(w.dayLog.reads, 2);
  assert.equal(one(w, b, { type: 'read', doc: 'd999' }).error.code, 'not_found');
  // 参数：doc 与 inscription 二选一
  assert.equal(one(w, b, { type: 'read' }).error.code, 'invalid_args');
  assert.equal(one(w, b, { type: 'read', doc: 'd2', inscription: 'i1' }).error.code, 'invalid_args');
  // 一天里再读一次，按日累计
  tick(w, 12);
  one(w, b, { type: 'read', doc: 'd2' });
  assert.deepEqual(w.docs.d2.readsByDay, { 0: 1, 1: 1 });
  assert.equal(w.docs.d2.reads, 2);
});

test('read：读取铭刻全文（在它所在的地点），不含作者；被覆盖的、别处的读不到', () => {
  const { w, agents: [a, b] } = world();
  at(a, 'parliament');
  at(b, 'parliament');
  const r = one(w, b, { type: 'read', inscription: 'i1' });
  assert.equal(r.ok, true);
  assert.equal(r.cost, 0);
  assert.equal(r.data.inscription.id, 'i1');
  assert.ok(r.data.inscription.text.startsWith('1. 凡自港口入城者'));
  assert.equal(r.data.inscription.lang, 'zh');
  assert.equal('author' in r.data.inscription, false);
  at(b, 'agora');
  assert.equal(one(w, b, { type: 'read', inscription: 'i1' }).error.code, 'wrong_place');
  one(w, a, { type: 'inscribe', text: '覆盖', cover: 'i1' });
  at(b, 'parliament');
  assert.equal(one(w, b, { type: 'read', inscription: 'i1' }).error.code, 'not_found');
  assert.equal(one(w, b, { type: 'read', inscription: 'i99' }).error.code, 'not_found');
});

test('read：被遮盖的典籍读不到内容', () => {
  const { w, agents: [a] } = world(['甲']);
  at(a, 'library');
  w.docs.d2.redacted = true;
  const r = one(w, a, { type: 'read', doc: 'd2' });
  assert.deepEqual(r.data.doc, { id: 'd2', kind: 'canon', redacted: true });
});

// ── 词典 ───────────────────────────────────────────────────

test('define：造新词收入词典，词在全城唯一（NFC + 小写比较）；花 2 能量', () => {
  const { w, agents: [a, b] } = world();
  const { result, events } = actRaw(w, a, [{ type: 'define', word: '灯语', meaning: '在黑暗里传递的话' }]);
  const r = result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.cost, 2);
  assert.deepEqual(w.lexicon['灯语'], { word: '灯语', meaning: '在黑暗里传递的话', coiner: a.id, tick: 0, uses: 0, users: [], redacted: false });
  assert.deepEqual(eventsOf(events, 'define')[0].data, { word: '灯语', meaning: '在黑暗里传递的话' });
  assert.equal(one(w, b, { type: 'define', word: '灯语', meaning: '另一个意思' }).error.code, 'name_taken');
  assert.equal(one(w, a, { type: 'define', word: 'Lumen', meaning: 'light' }).ok, true);
  assert.equal(one(w, b, { type: 'define', word: 'LUMEN', meaning: 'x' }).error.code, 'name_taken');
  assert.equal(one(w, b, { type: 'define', word: 'lumen', meaning: 'x' }).error.code, 'name_taken');
  assert.equal(one(w, b, { type: 'define', word: 'x'.repeat(25), meaning: 'x' }).error.code, 'text_too_long');
  assert.equal(one(w, b, { type: 'define', word: 'a\nb', meaning: 'x' }).error.code, 'invalid_args');
  assert.equal(one(w, b, { type: 'define', word: '词', meaning: 'x'.repeat(201) }).error.code, 'text_too_long');
  assert.equal(one(w, b, { type: 'define', word: '', meaning: 'x' }).error.code, 'invalid_args');
  assertInvariants(w);
});

test('词典使用次数：say、broadcast、inscribe、write、epitaph、提案正文里出现的词都会计数；创造者的释义与私语不计', () => {
  const { w, agents: [a, b] } = world();
  one(w, a, { type: 'define', word: '灯语', meaning: '传递的话，灯语' }); // 释义里的「灯语」不计
  one(w, a, { type: 'define', word: 'lumen', meaning: 'light' });
  const uses = () => [w.lexicon['灯语'].uses, w.lexicon.lumen.uses];
  assert.deepEqual(uses(), [0, 0]);
  one(w, b, { type: 'say', text: '灯语与灯语之间，也有 Lumen。' });
  assert.deepEqual(uses(), [2, 1]);
  assert.deepEqual(w.lexicon['灯语'].users, [b.id]);
  one(w, b, { type: 'whisper', to: a.id, text: '灯语灯语灯语' }); // 私语不计
  assert.deepEqual(uses(), [2, 1]);
  one(w, b, { type: 'broadcast', text: '一句 lumen。lumens 不算。' }); // 词边界：lumens 不算
  assert.deepEqual(uses(), [2, 2]);
  at(b, 'agora');
  one(w, b, { type: 'inscribe', text: '灯语在此' });
  assert.deepEqual(uses(), [3, 2]);
  at(b, 'library');
  one(w, b, { type: 'write', title: '灯语志', body: '灯语。lumen。' });
  assert.deepEqual(uses(), [5, 3]);
  // 第二个使用者
  one(w, a, { type: 'say', text: '灯语' });
  assert.deepEqual(uses(), [6, 3]);
  assert.deepEqual(w.lexicon['灯语'].users, [b.id, a.id]);
  assert.deepEqual(w.lexicon.lumen.users, [b.id]);
});

// ── 墓志 ───────────────────────────────────────────────────

test('epitaph：只能在墓园，为死者写墓志（归隐者没有墓碑）；花 1 能量；进入墓园记录', () => {
  const { w, agents: [a, b, c] } = world(['甲', '乙', '丙']);
  w.params.rationShare = 0;
  one(w, b, { type: 'give', to: 'treasury', energy: b.energy });
  one(w, c, { type: 'retire', lastWords: '我先走了' });
  assert.equal(c.status, 'retired');
  for (let i = 0; i < 4; i++) settle(w);
  assert.equal(b.status, 'dead');
  at(a, 'agora');
  assert.equal(one(w, a, { type: 'epitaph', deceased: b.id, text: '安息' }).error.code, 'wrong_place');
  at(a, 'cemetery');
  grant(w, a, 50);
  w.places.cemetery.condition = 10000; // 已过去几天，墓园衰败了；这里要核对的是完好时的代价
  const { result, events } = actRaw(w, a, [{ type: 'epitaph', deceased: '乙', text: '他把最后的能量给了公库。' }]);
  const r = result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.cost, 1);
  assert.deepEqual(w.cemetery[0].epitaphs, [{ author: a.id, text: '他把最后的能量给了公库。', tick: w.clock.tick }]);
  assert.deepEqual(eventsOf(events, 'epitaph')[0].data, { deceased: b.id, text: '他把最后的能量给了公库。' });
  assert.equal(w.dayLog.epitaphs, 1);
  assert.equal(one(w, a, { type: 'epitaph', deceased: c.id, text: 'x' }).error.code, 'not_found'); // 归隐者没有墓碑
  assert.equal(one(w, a, { type: 'epitaph', deceased: a.id, text: 'x' }).error.code, 'not_found'); // 还活着
  assert.equal(one(w, a, { type: 'epitaph', deceased: b.id, text: 'x'.repeat(281) }).error.code, 'text_too_long');
  assert.equal(one(w, a, { type: 'epitaph', deceased: b.id, text: '' }).error.code, 'invalid_args');
  // 墓园损坏时更贵
  w.places.cemetery.condition = 0;
  assert.equal(one(w, a, { type: 'epitaph', deceased: b.id, text: '再写一条' }).cost, 2);
  assert.equal(w.cemetery[0].epitaphs.length, 2);
  assertInvariants(w);
});

test('内容审核：公开文本未通过时动作失败并返回 moderated，不扣能量', () => {
  const { w, agents: [a] } = world(['甲']);
  setBlocklist(['禁语']);
  try {
    at(a, 'library');
    const e = a.energy;
    for (const act of [
      { type: 'write', title: '禁语', body: 'x' },
      { type: 'write', title: 'x', body: '含有禁语的正文' },
      { type: 'define', word: '禁语', meaning: 'x' },
      { type: 'inscribe', text: '禁语' },
      { type: 'found', name: '禁语会', manifesto: 'x' },
      { type: 'remember', text: '禁语' },
      { type: 'whisper', to: '甲', text: '禁语' },
    ]) {
      const r = one(w, a, act);
      assert.ok(r.error && (r.error.code === 'moderated' || r.error.code === 'invalid_args'), JSON.stringify([act, r]));
    }
    assert.equal(one(w, a, { type: 'diary', text: '日记里的禁语不审核' }).ok, true);
    assert.equal(a.energy, e);
    const reg2 = applyReg(w, '含禁语的名字');
    assert.equal(reg2.error.code, 'moderated');
  } finally {
    setBlocklist([]);
  }
});

function applyReg(w, name) {
  return applyCommand(w, { type: 'register', payload: { name, soul: 's', lang: 'zh', model: 'm', tokenHash: 'a'.repeat(64), ownerKeyHash: 'b'.repeat(64) } }).result;
}
