// Dijkstra with the original vertex and neighbor order. Integer indexes avoid
// repeated string-key/Set lookups in the O(V²) selection loop; returned key order
// remains the order in which the original algorithm first discovers each node.
export function orderedDistances(ids, from, neighbors, only = null) {
  const result = { [from]: 0 };
  const positions = new Map(ids.map((id, index) => [id, index]));
  const distance = ids.map(id => result[id]);
  const reached = Uint8Array.from(distance, value => value !== undefined ? 1 : 0);
  const done = new Uint8Array(ids.length);
  for (;;) {
    let u = -1;
    for (let i = 0; i < ids.length; i++) {
      if (done[i] || !reached[i]) continue;
      if (u < 0 || distance[i] < distance[u]) u = i;
    }
    if (u < 0) break;
    done[u] = 1;
    for (const { to, cost } of neighbors(ids[u])) {
      if (only && !only(to)) continue;
      const next = distance[u] + cost;
      if (result[to] === undefined || next < result[to]) {
        result[to] = next;
        const index = positions.get(to);
        if (index !== undefined) { distance[index] = next; reached[index] = 1; }
      }
    }
  }
  return result;
}
