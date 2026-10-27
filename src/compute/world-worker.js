import { parentPort, workerData } from 'node:worker_threads';
import v8 from 'node:v8';
import { applyConfig } from '../config.js';
import { engineOf } from '../engines.js';
import { makeReceipt, commitCommandCandidate } from '../command-receipt.js';
import { stateHash } from '../store.js';

applyConfig(workerData.cfg);
const w = workerData.world, engine = engineOf(w);
let pending = null, hash = stateHash(w), worldBytes = Buffer.byteLength(JSON.stringify(w)), commands = 0;
parentPort.on('message', ({ id, op, cmd }) => {
  try {
    if (op === 'prepare') {
      if (pending || cmd.n !== w.commandN + 1) throw new Error('World command boundary mismatch');
      const prepared = engine.prepareCommand(w, cmd);
      pending = { ...prepared, cmd };
      const receipt = makeReceipt(w, prepared.candidate, prepared.out, hash);
      pending.after=receipt.after;
      worldBytes += Buffer.byteLength(JSON.stringify(receipt.changes));
      parentPort.postMessage({ id, value: { receipt, heapLimitBytes: v8.getHeapStatistics().heap_size_limit } });
    } else if (op === 'commit') {
      if (!pending || pending.cmd.n !== cmd.n || pending.after!==cmd.after) throw new Error('World commit boundary mismatch');
      commitCommandCandidate(w, pending.candidate);
      hash = cmd.after; pending = null;
      const measured = cmd.wantSnapshot || ++commands % 128 === 0 ? JSON.stringify(w) : null;
      if (measured) worldBytes = Buffer.byteLength(measured);
      const snapshot = cmd.wantSnapshot ? measured : null;
      parentPort.postMessage({ id, value: { snapshot, worldBytes } });
    } else if (op === 'capture') {
      if (pending) throw new Error('Cannot capture uncommitted state');
      parentPort.postMessage({ id, value: { snapshot: JSON.stringify(w), hash } });
    } else if (op === 'discard') { pending = null; parentPort.postMessage({ id, value: true }); }
    else throw new Error('Unknown world operation');
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
parentPort.postMessage({ ready: true, hash, heapLimitBytes:v8.getHeapStatistics().heap_size_limit });
