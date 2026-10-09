import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedDistances } from '../src/graph-distance.js';

// Frozen reference selection/relaxation loop, including discovery-key order.
function reference(ids, from, neighbors, only) {
  const dist = { [from]: 0 }, done = new Set();
  for (;;) {
    let u = null;
    for (const id of ids) {
      if (done.has(id) || dist[id] === undefined) continue;
      if (u === null || dist[id] < dist[u]) u = id;
    }
    if (u === null) break;
    done.add(u);
    for (const { to, cost } of neighbors(u)) {
      if (only && !only(to)) continue;
      const next = dist[u] + cost;
      if (dist[to] === undefined || next < dist[to]) dist[to] = next;
    }
  }
  return dist;
}
test('indexed distance query is byte-identical to the reference on ties, zero roads, restrictions and disconnected nodes', () => {
  let state = 81421;
  const next = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
  for (let trial = 0; trial < 100; trial++) {
    const ids = Array.from({ length: 18 }, (_, i) => `p${i}`);
    const adj = new Map(ids.map(id => [id, []]));
    for (let i = 0; i < 80; i++) adj.get(ids[next(ids.length)]).push({ to: ids[next(ids.length)], cost: next(4) });
    adj.get(ids[0]).push({ to: 'outside', cost: 1 });
    const neighbors = id => adj.get(id);
    for (const only of [null, id => id !== 'p3' && id !== 'p9']) {
      const from = trial % 10 ? ids[next(ids.length)] : 'missing';
      assert.equal(JSON.stringify(orderedDistances(ids, from, neighbors, only)), JSON.stringify(reference(ids, from, neighbors, only)));
    }
  }
});

import { MAPS, shortestCosts } from '../src/map/index.js';
test('static route memoization respects changed road topology, order, restrictions and caller mutation', () => {
  const map = MAPS.frontier, from = map.placeIds[0];
  const roads = [{ a: from, b: map.placeIds[8], cost: 0 }, { a: from, b: map.placeIds[12], cost: 0 }];
  for (const extra of [[], roads, roads.slice().reverse(), [{ ...roads[0], cost: 3 }], []]) {
    const neighbors = id => [...map.adj[id], ...extra.flatMap(e => e.a === id ? [{to:e.b,cost:e.cost}] : e.b === id ? [{to:e.a,cost:e.cost}] : [])];
    for (const only of [null, id => id !== map.placeIds[3]]) {
      const expected = JSON.stringify(reference(map.placeIds, from, neighbors, only));
      assert.equal(JSON.stringify(shortestCosts(map, from, { extra, only })), expected);
      shortestCosts(map, from, { extra, only })[from] = 999;
      assert.equal(JSON.stringify(shortestCosts(map, from, { extra, only })), expected);
    }
  }
});
