// Private deterministic command outcomes. The runtime fsyncs the framed receipt
// before committing its isolated candidate; replay never executes receipt handlers.
import { createHash } from 'node:crypto';
import { stateHash } from './store.js';

const HIDDEN = ['$out', '$wakes', '$sandboxStats', '$feeEscrow'];
export function cloneCommandWorld(w) {
  const copy = structuredClone(w);
  for (const key of HIDDEN) if (Object.hasOwn(w, key)) Object.defineProperty(copy, key, { value: structuredClone(w[key]), writable: true, configurable: true });
  return copy;
}
export function commitCommandWorld(target, source) {
  for (const key of Object.keys(target)) if (!Object.hasOwn(source, key)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    if (Object.hasOwn(target, key) && target[key] === value) continue;
    if (value && typeof value === 'object' && Object.hasOwn(target, key) && target[key] && typeof target[key] === 'object' && Array.isArray(value) === Array.isArray(target[key])) {
      commitCommandWorld(target[key], value);
      if (Array.isArray(value)) target[key].length = value.length;
    } else Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: true });
  }
}
export function commitCommandCandidate(target, source) {
  commitCommandWorld(target, source);
  for (const key of HIDDEN) {
    if (Object.hasOwn(source, key)) Object.defineProperty(target, key, { value: source[key], writable: true, configurable: true });
    else delete target[key];
  }
  for (const key of ['$lawMeter', '$ruling', '$settling', '$boundary']) delete target[key];
}
function diff(before, after, path = [], changes = []) {
  for (const key of Object.keys(before)) if (before[key] !== undefined && (!Object.hasOwn(after, key) || after[key] === undefined)) changes.push({ path: [...path, key], remove: true });
  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    const old = Object.hasOwn(before, key) ? before[key] : undefined, nextPath = [...path, key];
    if (value && old && typeof value === 'object' && typeof old === 'object' && !Array.isArray(value) && !Array.isArray(old)) diff(old, value, nextPath, changes);
    else if (JSON.stringify(old) !== JSON.stringify(value)) changes.push({ path: nextPath, value });
  }
  return changes;
}
export function makeReceipt(before, after, out) {
  return { version: 1, before: stateHash(before), after: stateHash(after), changes: diff(before, after), out };
}
export function applyReceipt(w, cmd) {
  const receipt = cmd.receipt;
  if (receipt.version !== 1 || receipt.before !== stateHash(w)) throw new Error(`Command receipt #${cmd.n}: incompatible pre-state`);
  const candidate = cloneCommandWorld(w);
  for (const change of receipt.changes) {
    const path = change.path;
    if (!Array.isArray(path) || !path.length || path.some(k => typeof k !== 'string')) throw new Error('Invalid command receipt path');
    let target = candidate;
    for (const key of path.slice(0, -1)) { if (!Object.hasOwn(target, key)) throw new Error('Invalid command receipt parent'); target = target[key]; }
    const key = path.at(-1);
    if (change.remove) delete target[key];
    else Object.defineProperty(target, key, { value: structuredClone(change.value), writable: true, configurable: true, enumerable: true });
  }
  if (candidate.commandN !== cmd.n || stateHash(candidate) !== receipt.after) throw new Error(`Command receipt #${cmd.n}: incompatible outcome`);
  for (const key of ['$out', '$wakes', '$feeEscrow']) delete candidate[key];
  commitCommandCandidate(w, candidate);
  return structuredClone(receipt.out);
}
export const receiptChecksum = cmd => createHash('sha256').update(JSON.stringify(cmd)).digest('hex');
