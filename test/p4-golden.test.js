import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goldenSamples } from './fixtures/p4/golden.js';

test('P4 T1: premise 2 perceptions, text, results, daily records and replay remain byte-identical', () => {
  const expected = JSON.parse(readFileSync(new URL('./fixtures/p4/premise2.json', import.meta.url), 'utf8'));
  const actual = goldenSamples();
  assert.equal(actual.hash, actual.replayHash);
  for (const key of Object.keys(expected)) assert.equal(JSON.stringify(actual[key]), JSON.stringify(expected[key]), key);
});

import { clientSamples } from './fixtures/p4/clients.js';
test('P4 T1: premise 2 runner model inputs and MCP requests/results remain byte-identical', async () => {
  const expected = JSON.parse(readFileSync(new URL('./fixtures/p4/clients.json', import.meta.url), 'utf8'));
  assert.equal(JSON.stringify(await clientSamples()), JSON.stringify(expected));
});
// TODO(spec): Q60 — baseline sandbox timing assertions remain unchanged; report separately.
