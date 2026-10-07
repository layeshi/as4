import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReceipt, commitCommandCandidate, makeReceipt } from '../src/command-receipt.js';
import { stateHash } from '../src/store.js';

for (const array of [false, true]) {
  test(`candidate commit separates old aliases and preserves stable records (${array ? 'array' : 'object'})`, () => {
    const shared = array ? [{ value: 1 }] : { value: 1 };
    const target = { commandN: 0, agents: { a1: { energy: 10 } }, first: shared, second: shared };
    const agent = target.agents.a1, first = target.first;
    const candidate = structuredClone(target);
    candidate.commandN++;
    candidate.agents.a1.energy++;
    candidate.second = array ? [{ value: 2 }] : { value: 2 };
    const expected = stateHash(candidate);
    commitCommandCandidate(target, candidate);
    assert.equal(stateHash(target), expected);
    assert.equal(target.agents.a1, agent, 'resident reference stays valid');
    assert.equal(target.first, first, 'first surviving record stays valid');
    assert.notEqual(target.first, target.second);
    assert.equal(stateHash(candidate), expected, 'committing never mutates the candidate');
  });
}

test('candidate commit retains new aliases across old and newly created paths', () => {
  const target = { agents: { a1: { energy: 10 } }, history: [] };
  const agent = target.agents.a1;
  const candidate = structuredClone(target);
  candidate.history.push(candidate.agents.a1);
  commitCommandCandidate(target, candidate);
  assert.equal(target.agents.a1, agent);
  assert.equal(target.history[0], agent);
});

test('receipt path changes split aliases without changing other JSON paths', () => {
  const shared = { value: 1 };
  const target = { commandN: 0, first: shared, second: shared };
  const candidate = { commandN: 1, first: { value: 1 }, second: { value: 2 } };
  const receipt = JSON.parse(JSON.stringify(makeReceipt(target, candidate, { result: { ok: true }, events: [], wakes: [] })));
  applyReceipt(target, { n: 1, receipt });
  assert.equal(stateHash(target), receipt.after);
  const next = { ...structuredClone(candidate), commandN: 2 };
  applyReceipt(target, { n: 2, receipt: makeReceipt(candidate, next, {}) });
  assert.equal(stateHash(target), stateHash(next));
});
