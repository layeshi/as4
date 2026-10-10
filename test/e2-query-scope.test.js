import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, registerCommand } from '../src/e2/engine/index.js';
import { openCityProposals } from '../src/e2/engine/legislation.js';
import { buildPerception } from '../src/e2/engine/perception.js';
import { actCommand } from '../src/e2/engine/actions.js';
import { nextId } from '../src/e2/world.js';
import { bareWorld, reg, grant } from './e2-helpers.js';

test('E2 command queries see insertions and live status changes, and discard keys on return or throw', () => {
  const w = bareWorld('query-scope');
  const read = world => {
    assert.deepEqual(openCityProposals(world), Object.values(world.proposals).filter(p => p.status === 'open' && p.scope === 'city'));
    return openCityProposals(world);
  };
  const insert = world => {
    const id = nextId(world, 'p');
    world.proposals[id] = { id, status: 'open', scope: 'city' };
    return world.proposals[id];
  };
  insert(w);
  registerCommand('query_scope_probe', world => {
    const first = read(world)[0];
    const added = insert(world);
    assert.ok(read(world).includes(added));
    first.status = 'closed';
    assert.ok(!read(world).includes(first));
    return { ok: true };
  });
  assert.equal(applyCommand(w, { type: 'query_scope_probe' }).result.ok, true);
  // Test and in-process callers can write directly between commands without advancing IDs.
  w.proposals.direct = { id: 'direct', status: 'open', scope: 'city' };
  assert.ok(read(w).includes(w.proposals.direct));
  registerCommand('query_scope_throw', world => { read(world); throw Error('probe'); });
  assert.throws(() => applyCommand(w, { type: 'query_scope_throw' }), /probe/);
  delete w.proposals.direct;
  assert.ok(!read(w).some(p => p.id === 'direct'));
  assert.equal(applyCommand(w, { type: 'query_scope_probe' }).result.ok, true);
});

test('E2 define within one command updates the next perception after its lexicon has already been read', () => {
  const w = bareWorld('lexicon-scope'), a = reg(w, '甲');
  grant(w, a, 100);
  registerCommand('query_scope_define', world => {
    const before = buildPerception(world, a.id, { ack: false }).city.lexicon;
    const out = actCommand(world, { agentId: a.id, actions: [{ type: 'define', word: '新词', meaning: '刚定义的含义' }] });
    assert.equal(out.ok, true);
    assert.equal(out.results[0].ok, true);
    const after = buildPerception(world, a.id, { ack: false }).city.lexicon;
    assert.equal(after.length, before.length + 1);
    assert.deepEqual(after.at(-1), { word: '新词', meaning: '刚定义的含义' });
    return { ok: true };
  });
  assert.equal(applyCommand(w, { type: 'query_scope_define' }).result.ok, true);
});
