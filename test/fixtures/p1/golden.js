// Recorded before premise implementation at 31a398b. No provider or external data.
import e2 from '../../../src/e2/facade.js';
import { reg } from '../../e2-helpers.js';
import { renderPerception2 } from '../../../runner/render2.js';
import { buildSystemPrompt, promptParams } from '../../../runner/prompt.js';
import { runSandbox } from '../../../src/e2/sandbox/run.js';
import { stateHash } from '../../../src/store.js';
export function goldenSamples() {
  const opts = { id: 'p0-golden', seed: 'p0-golden-1', codeVersion: '0.1.0' };
  const w = e2.createWorld(opts);
  const created = JSON.stringify(w);
  const agents = ['醒者', '睡者', '眠者'].map((n) => reg(w, n));
  const samples = [];
  const prompts = {};
  for (let t = 1; t <= 120; t++) {
    e2.applyCommand(w, { type: 'tick' });
    if ([1, 50, 100].includes(t)) {
      // Controlled status copies avoid modifying the command-driven source world.
      for (const [i, status] of ['awake', 'dormant', 'dead'].entries()) {
        const copy = JSON.parse(JSON.stringify(w));
        copy.agents[agents[i].id].status = status;
        if (status === 'dormant') copy.agents[agents[i].id].dormantSinceDay = 0;
        for (const lang of ['zh', 'en']) {
          const p = e2.buildPerception(copy, agents[i].id, { lang, ack: false });
          samples.push({ tick: t, status, lang, perception: JSON.stringify(p), render: renderPerception2(p) });
          if (t === 1 && i === 0) prompts[lang] = buildSystemPrompt(promptParams(p));
        }
      }
    }
  }
  return { created, samples, prompts, metrics: JSON.stringify(w.metrics), chronicle: JSON.stringify(w.chronicle), hash: stateHash(w) };
}
export function sandboxBaseline() {
  const { report } = runSandbox({ days: 120, agents: 10, seed: 1 });
  report.meta.elapsedMs = 0; // runtime duration is not a deterministic simulation output
  return stateHash(report);
}
