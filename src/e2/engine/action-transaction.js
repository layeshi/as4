// Per-action business failures keep the action slot and computation already used.
// Mutate existing records so in-process callers keep valid world/agent references.
function restore(target, saved) {
  for (const k of Object.keys(target)) if (!Object.hasOwn(saved, k)) delete target[k];
  for (const [k, value] of Object.entries(saved)) {
    if (value && typeof value === 'object' && target[k] && typeof target[k] === 'object' && Array.isArray(value) === Array.isArray(target[k])) {
      restore(target[k], value);
      if (Array.isArray(value)) target[k].length = value.length;
    } else target[k] = value;
  }
}

export function actionCheckpoint(w) {
  const saved = structuredClone(w);
  const hidden = {};
  for (const k of ['$out', '$wakes', '$sandboxStats', '$feeEscrow']) {
    if (Object.hasOwn(w, k)) hidden[k] = structuredClone(w[k]);
  }
  return { saved, hidden };
}

export function rollbackAction(w, a, checkpoint) {
  const diagnostics = (w.$out || []).slice(checkpoint.hidden.$out?.length || 0).filter(e => ['rule_error', 'procedure_error'].includes(e.type));
  const faults = diagnostics.some(e => e.type === 'procedure_error') && w.procedureFaults ? structuredClone(w.procedureFaults) : null;
  w.agents[a.id] = a;
  restore(w, checkpoint.saved);
  for (const k of ['$out', '$wakes', '$sandboxStats', '$feeEscrow']) {
    if (Object.hasOwn(checkpoint.hidden, k)) Object.defineProperty(w, k, { value: checkpoint.hidden[k], writable: true, configurable: true });
    else delete w[k];
  }
  if (faults) w.procedureFaults = faults;
  for (const ev of diagnostics) {
    if (ev.type === 'rule_error') w.dayLog.ruleErrors++;
    if (!Object.hasOwn(w, '$out')) Object.defineProperty(w, '$out', { value: [], writable: true, configurable: true });
    w.$out.push(ev);
    w.counters.event = Math.max(w.counters.event || 0, ev.seq);
  }
}
