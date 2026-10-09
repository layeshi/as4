// Pure queries over ordinary JSON record tables, retaining Object.values order.
// A command may share key enumeration across its synchronous queries. The scope
// is discarded on return/throw: direct writes between commands remain visible.
const scopes = new WeakMap();
export function withRecordQueries(tables, run) {
  const previous = new Map();
  for (const table of new Set(tables)) {
    previous.set(table, scopes.get(table));
    scopes.set(table, {});
  }
  try { return run(); }
  finally {
    for (const [table, parent] of previous) {
      if (parent) scopes.set(table, {}); // nested work may have inserted keys
      else scopes.delete(table);
    }
  }
}
function keysAtRevision(table, revision) {
  const scope = scopes.get(table);
  if (!scope || revision === undefined) return Object.keys(table);
  if (scope.numbered?.revision !== revision) scope.numbered = { revision, keys: Object.keys(table) };
  return scope.numbered.keys;
}
export function filterValues(table, predicate, revision) {
  const out = [];
  for (const key of keysAtRevision(table, revision)) {
    const value = table[key];
    if (predicate(value)) out.push(value);
  }
  return out;
}
export const tailValues = (table, n) => Object.keys(table).slice(-n).map(key => table[key]);

// The unnumbered lexicon's insertion path explicitly invalidates its scoped keys.
export function recordKeys(table) {
  const scope = scopes.get(table);
  if (!scope) return Object.keys(table);
  return scope.keys ||= Object.keys(table);
}
export function invalidateRecordKeys(table) {
  const scope = scopes.get(table);
  if (scope) delete scope.keys;
}
export const tailRecordValues = (table, n) => recordKeys(table).slice(-n).map(key => table[key]);
