import test from 'node:test';
import assert from 'node:assert/strict';
import { filterValues, tailValues, withRecordQueries } from '../src/collections.js';

test('read-only table queries preserve own-property order, references and legacy slice behavior', () => {
  const rows = Object.create({ inherited: { open: true } });
  rows.i2 = Object.freeze({ id: 'i2', open: true });
  rows[10] = Object.freeze({ id: '10', open: true });
  rows[2] = Object.freeze({ id: '2', open: false });
  rows.i1 = Object.freeze({ id: 'i1', open: true });
  Object.defineProperty(rows, 'hidden', { value: { open: true }, enumerable: false });
  rows[Symbol('hidden')] = { open: true };
  Object.freeze(rows);
  const all = Object.values(rows), expected = all.filter(row => row.open);
  const actual = filterValues(rows, row => row.open);
  assert.deepEqual(actual, expected);
  assert.ok(actual.every((row, i) => row === expected[i]));
  actual.pop();
  assert.deepEqual(filterValues(rows, row => row.open), expected, 'each query owns its result array');
  for (const n of [0, 1, 2, 100, -1]) assert.deepEqual(tailValues(rows, n), all.slice(-n));
});

test('numbered table key index follows ID revisions, reads live values, and never enters serialized state', () => {
  let revision = 0;
  const table = {};
  const selected = () => filterValues(table, row => row.open, revision);
  const verify = () => assert.equal(JSON.stringify(selected()), JSON.stringify(Object.values(table).filter(row => row.open)));
  withRecordQueries([table], () => {
    verify();
    for (let i = 1; i <= 40; i++) {
      table[`p${i}`] = { open: true, n: i }; revision++;
      verify();
      table[`p${i}`].open = false; verify();
      table[`p${i}`] = { open: true, n: -i }; verify();
    }
    selected()[0].open = false;
    verify();
    assert.equal(Object.getOwnPropertySymbols(table).length, 0);
  });
  const restored = JSON.parse(JSON.stringify(table));
  assert.equal(JSON.stringify(filterValues(restored, row => row.open, revision)), JSON.stringify(Object.values(restored).filter(row => row.open)));
});

import { recordKeys, invalidateRecordKeys, tailRecordValues } from '../src/collections.js';
test('lexicon key index invalidation preserves numeric-key ordering, replacements and redaction', () => {
  const table = { word: { text: 'first' } };
  withRecordQueries([table], () => {
    for (const key of ['another', '12', '3', '词', 'word']) {
      recordKeys(table);
      table[key] = { text: key };
      invalidateRecordKeys(table);
      assert.deepEqual(recordKeys(table), Object.keys(table));
      assert.deepEqual(tailRecordValues(table, 3), Object.values(table).slice(-3));
      table[key].text = 'redacted';
      assert.deepEqual(tailRecordValues(table, 3), Object.values(table).slice(-3));
    }
  });
});

test('command query scope is discarded on success and errors, so direct edits stay visible', () => {
  const table = { p1: { open: true } };
  const read = () => filterValues(table, row => row.open, 1);
  withRecordQueries([table], () => { read(); recordKeys(table); });
  table.p2 = { open: true };
  assert.equal(read().length, 2);
  assert.equal(recordKeys(table).length, 2);
  assert.throws(() => withRecordQueries([table], () => { read(); throw Error('abort'); }));
  delete table.p1;
  assert.equal(read().length, 1);
  withRecordQueries([table], () => {
    read();
    withRecordQueries([table], () => { table.p3 = { open: true }; });
    assert.equal(read().length, 2);
  });
});
