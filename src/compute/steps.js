// Keep direct, synchronous engine clients compatible; the online runtime yields
// promises at command boundaries without blocking the HTTP event loop.
export function runSteps(iterator) {
  const step = value => {
    const next = iterator.next(value);
    if (next.done) return next.value;
    return next.value?.then ? next.value.then(step, error => {
      const thrown = iterator.throw(error);
      return thrown.done ? thrown.value : Promise.resolve(thrown.value).then(step);
    }) : step(next.value);
  };
  return step();
}
export const submit = (rt, type, payload, authorize) => rt.compute ? rt.submit(type, payload, { authorize, skipRequestAuthority: payload?.op === 'merge_accounts', ...(type === 'meter' && payload.op !== 'refund' ? {expectedVersion:rt.w.commandN} : {}) }) : (authorize?.(), rt.exec(type, payload));
