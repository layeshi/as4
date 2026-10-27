import v8 from 'node:v8';
import { ComputePool } from './pool.js';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { usesLawSemantics2 } from '../e2/engine/law-semantics.js';
import { ResourceBudget, ByteCache } from './resources.js';
import { commandAuthority } from './authority.js';

export const busy = () => Object.assign(new Error('计算资源繁忙，请稍后重试。'), { status: 503, code: 'compute_busy' });

// Read mirrors are JSON projections, never engine inputs. Only changed paths
// are visited; stable resident objects used by in-flight readers stay stable.
export function updateMirror(world, changes) {
  for (const change of changes) {
    if(!Array.isArray(change.path)||!change.path.length||change.path.some(key=>typeof key!=='string'))throw new Error('Invalid mirror path');
    let target = world;
    for (const key of change.path.slice(0, -1)) {
      if (!target || typeof target!=='object' || !Object.hasOwn(target, key)) throw new Error('Invalid mirror path');
      target = target[key];
    }
    const key = change.path.at(-1);
    if (typeof key!=='string') throw new Error('Invalid mirror path');
    if (change.remove) delete target[key]; else Object.defineProperty(target, key, { value: change.value, writable: true, configurable: true, enumerable: true });
  }
}

export class WorldComputer {
  constructor(rt, {readers} = {}) {
    this.rt = rt; this.budget = new ResourceBudget(rt.cfg, readers); this.cache = new ByteCache(this.budget.current.cacheBytes);
    this.mode = rt.cfg.worldExecution === 'inline' || !usesLawSemantics2(rt.w) ? 'inline' : 'worker';
    this.queue = 0; this.queueBytes = 0; this.tail = Promise.resolve(); this.requests = new Map(); this.nextId = 0;
    this.closed = false; this.failed = null; this.worldBytes = Buffer.byteLength(JSON.stringify(rt.w)); this.heapLimit = null;
  }
  async start() {
    this.pool = new ComputePool(this);
    if (this.mode === 'inline') return;
    if (!this.budget.canRun(this.worldBytes*8+64*1048576)) throw busy();
    this.worker = new Worker(new URL('./world-worker.js', import.meta.url), { workerData: { world: this.rt.w, cfg: Object.fromEntries(['tickMs','ticksPerDay','daysPerMonth','monthsPerEpoch','privateDelayTicks','weatherMode','blocklistFile'].map(key=>[key,this.rt.cfg[key]])) },
      resourceLimits: { maxOldGenerationSizeMb: Math.max(64, Math.floor(this.budget.current.budget / 1048576 / 2)) } });
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.worker.on('message', m => {
      if (m.ready) { this.committedHash=m.hash; this.heapLimit=m.heapLimitBytes; return this.readyResolve(); }
      const request = this.requests.get(m.id); if (!request) return;
      this.requests.delete(m.id); clearTimeout(request.timer);
      m.error ? request.reject(new Error(m.error)) : request.resolve(m.value);
    });
    const failed = error => {
      this.failed = error; this.readyReject(error);
      for (const r of this.requests.values()) { clearTimeout(r.timer); r.reject(error); } this.requests.clear();
      if (!this.closed && this.started) this.rt.failStop();
    };
    this.worker.on('error', failed);
    this.worker.on('exit', code => { if (!this.closed) failed(new Error(`World worker exited (${code})`)); });
    await this.ready; this.started = true;
  }
  call(op, cmd) {
    if (this.failed || this.closed) return Promise.reject(this.failed ?? new Error('World computer closed'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); this.rt.failStop(); reject(new Error('World computation timed out; restart recovery required')); this.worker.terminate(); }, 120000);
      this.requests.set(id, { resolve, reject, timer }); this.worker.postMessage({ id, op, cmd });
    });
  }
  submit(type, payload, { authorize, skipRequestAuthority = false, expectedVersion } = {}) {
    if (this.closed || this.closing || this.rt.receiptFailed) return Promise.reject(busy());
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    if (this.queue >= (this.rt.cfg.computeQueueLimit ?? 256) || this.queueBytes + bytes > 8 * 1048576) return Promise.reject(busy());
    const requestAuthority = skipRequestAuthority ? null : commandAuthority.getStore();
    const check = () => { requestAuthority?.(); authorize?.(); };
    const copied = structuredClone(payload), started = performance.now();
    this.queue++; this.queueBytes += bytes;
    const work = this.tail.then(async () => {
      if (this.failed || this.rt.receiptFailed || performance.now() - started > 30000) throw busy();
      check();
      if (expectedVersion !== undefined && expectedVersion !== this.rt.w.commandN) throw busy();
      if(this.budget.current.slots===1 && this.budget.backgroundActive)await this.pool.yieldToWorld();
      const reserve = this.worldBytes * 8 + bytes * 2 + (type==='act'&&copied.actions?.some(a=>['program','service_order'].includes(a.type)) ? 128*1048576 : 0);
      if (!this.budget.canRun(reserve)) { this.cache.clear(); if (!this.budget.canRun(reserve)) throw busy(); }
      this.budget.reserved += reserve; this.budget.worldActive++;
      try {
        if (this.mode === 'inline') {
          check(); const out=this.rt.executeInline(type, copied); this.worldBytes=Buffer.byteLength(JSON.stringify(this.rt.w)); return out;
        }
        const context = this.rt.commandContext(type, copied), cmd = { n: this.rt.log.n + 1, tick: this.rt.w.clock.tick, type, payload: context.payload };
        let prepared; try { prepared=await this.call('prepare', cmd); } catch(error){this.rt.failStop();throw error;}
        const {receipt,heapLimitBytes}=prepared; this.heapLimit=heapLimitBytes;
        try { check(); } catch (error) { try{await this.call('discard');}catch(fault){this.rt.failStop();throw fault;} throw error; }
        if (receipt.version !== 1 || receipt.before!==this.committedHash || cmd.n !== this.rt.log.n + 1 || cmd.n !== this.rt.w.commandN + 1) {this.rt.failStop();throw new Error('Stale world candidate');}
        // No await between the final authority check and the durable append.
        let committed;
        try { committed = this.rt.log.appendReceipt(cmd, receipt); this.rt.receiptEventsPending = true; }
        catch (error) { this.rt.failStop(); throw error; }
        const wantSnapshot = type === 'tick' && receipt.out.result.settled || receipt.changes.some(c => ['paused', 'experimentControl', 'lawSemantics', 'ruleExecution'].includes(c.path[0]));
        let ack;
        try { ack = await this.call('commit', { n: cmd.n, after: receipt.after, wantSnapshot }); } catch (error) { this.rt.failStop(); throw error; }
        try {
          updateMirror(this.rt.w, receipt.changes); this.committedHash=receipt.after;
          this.worldBytes = ack.worldBytes ?? this.worldBytes;
          if (ack.snapshot) this.rt.preparedSnapshot = { n: cmd.n, text: ack.snapshot };
          return this.rt.publishCommand(receipt.out, cmd, { ...context, durable: true, committedCommand: committed });
        } catch (error) { this.rt.failStop(); throw error; }
      } finally { this.budget.worldActive--; this.budget.reserved -= reserve; }
    });
    this.tail = work.catch(() => {});
    return work.finally(() => { this.queue--; this.queueBytes -= bytes; });
  }
  capture(authorize = () => {}) {
    if(this.closed||this.closing||this.queue>=(this.rt.cfg.computeQueueLimit??256))return Promise.reject(busy());
    this.queue++;
    const work = this.tail.then(async () => {
      if (this.closed || this.failed || this.rt.receiptFailed) throw busy();
      authorize();
      if(this.budget.current.slots===1&&this.budget.backgroundActive)await this.pool.yieldToWorld();
      const reserved=this.worldBytes*4;
      if (!this.budget.canRun(reserved)) { this.cache.clear(); if(!this.budget.canRun(reserved))throw busy(); }
      this.budget.reserved+=reserved;this.budget.worldActive++;
      try{
        const captured = this.mode === 'worker' ? await this.call('capture') : { snapshot: JSON.stringify(this.rt.w), hash: (await import('../store.js')).stateHash(this.rt.w) };
        authorize();
        const files = Object.fromEntries(['commands.jsonl', 'events.jsonl'].map(name => {
          const path = join(this.rt.dir, name); let bytes = 0; try { bytes = statSync(path).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
          return [name, { path, bytes }];
        }));
        return { ...captured, files, boundary: {worldId:this.rt.w.id,physics:this.rt.engine.physics,tick:this.rt.w.clock.tick,day:this.rt.engine.clockDay(this.rt.w),commandN:this.rt.w.commandN,eventSeq:this.rt.w.counters.event,codeVersion:this.rt.w.codeVersion} };
      }finally{this.budget.reserved-=reserved;this.budget.worldActive--;}
    });
    this.tail = work.catch(() => {}); return work.finally(()=>{this.queue--;});
  }
  view() { return { ...this.budget.view(), mode: this.mode, worldHeapLimitBytes: this.heapLimit, mainHeapLimitBytes:v8.getHeapStatistics().heap_size_limit, backgroundHeapLimitBytes:[...this.pool?.workers??[]].map(entry=>entry.heapLimit??null), queue: { world: this.queue, background: this.pool?.queue.length ?? 0 }, cache: this.cache.view() }; }
  async close() { this.closing = true; await this.tail; this.closed = true; await this.pool?.close(); if (this.worker) await this.worker.terminate(); }
}
