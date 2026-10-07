import { usesLawSemantics2, lawProtectionView } from './e2/engine/law-semantics.js';
/** Coordinate world pause with hosted loops, without changing their own enable switches. */
export class ExperimentControl {
  constructor(rt, runners, shells) {
    this.rt = rt;
    this.runners = runners;
    this.shells = shells;
    this.state = rt.w.paused ? 'paused' : 'running';
    this.pending = Promise.resolve();
    this.queue = Promise.resolve();
    this.unsubscribe = rt.events.subscribe((name) => {
      if (name === 'control') this.reconcile();
    });
  }

  reconcile() {
    const paused = this.rt.w.paused || this.rt.stopped;
    this.state = paused ? 'pausing' : 'resuming';
    // Abort synchronously once the world gate closes. A resume waits for the old loops.
    const stopping = paused
      ? Promise.all([this.runners.suspendExperiment(), this.shells?.suspendExperiment()])
      : Promise.resolve();
    this.pending = Promise.all([this.pending.catch(() => {}), stopping]).then(() => {
      if (this.rt.w.paused || this.rt.stopped) this.state = 'paused';
      else {
        this.runners.resumeExperiment();
        this.shells?.resumeExperiment();
        this.state = 'running';
      }
    });
    // Retain the rejection for the operation to report, without an unhandled promise.
    this.pending.catch(() => { this.state = this.rt.w.paused ? 'pause_error' : 'resume_error'; });
  }

  view() {
    return {
      ...(usesLawSemantics2(this.rt.w) ? { lawProtection: lawProtectionView(this.rt.w), capacityProtection: this.rt.w.ruleExecution?.protection || null } : {}),
      state: this.state,
      paused: this.rt.w.paused,
      remainingMs: this.rt.w.paused ? this.rt.remainingMs : Math.max(0, (this.rt.nextTickAt ?? Date.now() + this.rt.remainingMs) - Date.now()),
      nextTickAt: this.rt.nextTickAt,
      tick: this.rt.w.clock.tick,
      hostedActive: this.runners.jobs.size,
      shellsActive: this.shells?.drivers.size ?? 0,
    };
  }

  setPaused(paused, authorize = () => {}) {
    const operation = this.queue.then(async () => {
      authorize();
      if (this.rt.stopped) throw new Error('Runtime is closed');
      try {
        if (this.rt.w.paused !== paused || (paused && !this.rt.w.experimentControl?.active)) {
          const { result } = this.rt.exec('admin', { op: paused ? 'pause' : 'resume', args: { experiment: true } });
          if (!result.ok) throw Object.assign(new Error('Experiment transition failed'), { engineError: result.error });
        } else if (this.state.endsWith('_error')) this.reconcile();
        await this.pending;
      } catch (error) {
        if (!paused && !this.rt.w.paused) {
          // A partial resume must not leave time or any newly started loop running.
          this.rt.exec('admin', { op: 'pause', args: { experiment: true } });
          await this.pending;
        }
        throw error;
      }
      return { ok: true, paused: this.rt.w.paused };
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  recoverLaw(authorize = () => {}) {
    const operation = this.queue.then(async () => {
      authorize();
      if (this.rt.stopped) throw new Error('Runtime is closed');
      await this.pending;
      authorize();
      const { result } = this.rt.exec('admin', { op: 'law_recover' });
      try { await this.pending; }
      catch (error) {
        if (!this.rt.w.paused) this.rt.exec('admin', { op: 'pause', args: { experiment: true } });
        throw error;
      }
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  close() { this.unsubscribe(); }
}
