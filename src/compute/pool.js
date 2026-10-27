import { Worker } from 'node:worker_threads';
import { busy } from './online.js';

export class ComputePool {
  constructor(owner) { this.owner = owner; this.budget = owner.budget; this.queue = []; this.workers = new Set(); this.closed = false; this.next = 0; this.queuedBytes = 0; this.timer = setInterval(() => this.pump(), 100); this.timer.unref();
    this.trimTimer=setInterval(()=>{
      const healthy=this.budget.canRun(0); if(!healthy)this.owner.cache.clear();
      for(const entry of this.workers)if(!entry.job&&(!healthy||this.workers.size>Math.max(1,this.budget.current.slots-1))){this.workers.delete(entry);entry.worker.terminate();}
    },1000); this.trimTimer.unref();
  }
  run(kind, data, bytes = 16 * 1048576) {
    if (this.closed || this.queue.length >= (this.owner.rt.cfg.computeQueueLimit ?? 256) || this.queuedBytes + bytes > this.budget.current.budget) return Promise.reject(busy());
    return new Promise((resolve, reject) => {
      const job = { id: ++this.next, kind, data, bytes, resolve, reject, expiresAt: Date.now()+120000 };
      job.waitTimer = setTimeout(() => { const index = this.queue.indexOf(job); if (index >= 0) { this.queue.splice(index, 1); this.queuedBytes -= bytes; reject(busy()); } }, 30000);
      this.queue.push(job); this.queuedBytes += bytes; this.pump();
    });
  }
  spawn() {
    const entry = { worker: new Worker(new URL('./pool-worker.js', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: Math.max(32, Math.floor(this.budget.current.budget / Math.max(2, this.budget.current.slots) / 1048576)) } }), job: null };
    entry.startup=64*1048576; this.budget.reserved+=entry.startup; this.workers.add(entry); entry.worker.unref();
    entry.worker.on('message', m => { if(m.ready){entry.heapLimit=m.heapLimitBytes;this.releaseStartup(entry);return;} if (entry.job?.id !== m.id) return; this.finish(entry, m.error ? Object.assign(new Error(m.error),m.code==='compute_busy'?{code:m.code,status:503}:{}) : null, m.value); });
    entry.worker.on('error', error => { this.workers.delete(entry); this.releaseStartup(entry); this.finish(entry, error); });
    entry.worker.on('exit', () => { this.workers.delete(entry); this.releaseStartup(entry); this.finish(entry, new Error('Compute worker exited')); });
    return entry;
  }
  releaseStartup(entry) { if(entry.startup){this.budget.reserved-=entry.startup;entry.startup=0;} }
  async yieldToWorld() {
    const stopped=[];
    for(const entry of this.workers)if(entry.job){
      const job=entry.job;entry.job=null;clearTimeout(job.timer);this.budget.reserved-=job.bytes;this.budget.backgroundActive--;
      this.workers.delete(entry);this.releaseStartup(entry);
      if(Date.now()>=job.expiresAt){job.reject(busy());stopped.push(entry.worker.terminate());continue;}
      job.waitTimer=setTimeout(()=>{const i=this.queue.indexOf(job);if(i>=0){this.queue.splice(i,1);this.queuedBytes-=job.bytes;job.reject(busy());}},Math.min(30000,job.expiresAt-Date.now()));
      this.queue.unshift(job);this.queuedBytes+=job.bytes;stopped.push(entry.worker.terminate());
    }
    await Promise.all(stopped);
  }
  finish(entry, error, value) {
    const job = entry.job; if (!job) return;
    entry.job = null; clearTimeout(job.timer); this.budget.reserved -= job.bytes; this.budget.backgroundActive--; entry.worker.unref();
    error ? job.reject(error) : job.resolve(value); this.pump();
  }
  pump() {
    if (this.closed || !this.queue.length || this.owner.queue) return;
    while (this.queue.length) {
      const job = this.queue[0];
      let entry = [...this.workers].find(w => !w.job);
      if (!this.budget.canRun(job.bytes + this.owner.worldBytes * 8 + (entry ? 0 : 64*1048576), true)) { if (this.budget.pressure) this.owner.cache.clear(); return; }
      if (!entry && this.workers.size < Math.max(1, this.budget.current.slots - 1)) {try{entry=this.spawn();}catch(error){this.queue.shift();this.queuedBytes-=job.bytes;clearTimeout(job.waitTimer);job.reject(error);continue;}}
      if (!entry) return;
      this.queue.shift(); this.queuedBytes -= job.bytes; clearTimeout(job.waitTimer);
      this.budget.reserved += job.bytes; this.budget.backgroundActive++; entry.job = job; entry.worker.ref();
      job.timer = setTimeout(() => { this.workers.delete(entry); this.releaseStartup(entry); this.finish(entry, new Error('Background computation timed out')); entry.worker.terminate(); }, Math.max(1,job.expiresAt-Date.now()));
      entry.worker.postMessage({ id: job.id, kind: job.kind, data: job.data });
    }
  }
  async close() {
    this.closed = true; clearInterval(this.timer); clearInterval(this.trimTimer);
    for (const job of this.queue.splice(0)) { clearTimeout(job.waitTimer); job.reject(new Error('Compute pool closed')); } this.queuedBytes = 0;
    await Promise.all([...this.workers].map(async entry => { this.releaseStartup(entry); this.finish(entry, new Error('Compute pool closed')); await entry.worker.terminate(); }));
    this.workers.clear();
  }
}
