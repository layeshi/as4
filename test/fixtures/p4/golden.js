// Frozen on origin/main d735b58, before any premise-4 engine changes.
import e2 from '../../../src/e2/facade.js';
import { stateHash } from '../../../src/store.js';
import { sha } from '../../e2-helpers.js';
import { renderBrief, renderWake, renderLook, LOOK_WHATS } from '../../../runner/render-p2.js';
import { renderPerception } from '../../../runner/render.js';
import { buildSystemPrompt, promptParams, actionCatalog2 } from '../../../runner/prompt.js';

export function goldenSamples() {
  const opts = { id: 'p4-golden-p2', seed: 'p4-golden-2', premise: 2, shellSlots: 0, codeVersion: '0.1.0' };
  const w = e2.createWorld(opts), commands = [], results = [], samples = [], days = [];
  const command = (type, payload) => {
    const cmd = { type, ...(payload ? { payload } : {}) };
    commands.push(cmd);
    const out = e2.applyCommand(w, cmd);
    results.push(JSON.stringify(out));
    return out.result;
  };
  for (const name of ['甲', '乙', '丙']) command('register', {
    name, bio: '', soul: `我是${name}`, lang: 'zh', model: 'mock', creatorName: 'tester',
    tokenHash: sha(`tok:${name}`), ownerKeyHash: sha(`key:${name}`),
  });
  for (let tick = 0; tick < 120; tick++) {
    const actions = tick === 0 ? [{ type: 'remember', text: '第一段记忆' }, { type: 'mute', who: 'a3' }]
      : tick === 1 ? [{ type: 'standing', orders: [{ when: 'tick', if: 'me.energy > 20', do: [{ type: 'say', text: '早安' }] }] }]
      : [{ type: 'say', text: `第${tick}刻` }, { type: 'whisper', to: 'a2', text: '有人找你', anonymous: tick % 2 === 0 }];
    command('act', { agentId: 'a1', thought: '继续生活', actions });
    if ([0, 1, 12, 60, 119].includes(tick)) for (const lang of ['zh', 'en']) {
      const p = e2.buildPerception(w, 'a1', { lang, after: 0, ack: false });
      samples.push({ tick, lang, perception: JSON.stringify(p), render: renderPerception(p),
        brief: renderBrief(p), wake: renderWake(p),
        looks: LOOK_WHATS.map(what => [what, renderLook(p, what)]),
        prompts: ['native', 'json', 'mcp'].map(toolMode => buildSystemPrompt({ ...promptParams(p), toolMode })),
        catalog: actionCatalog2(lang, { premise: 2 }) });
    }
    command('tick');
    if (w.clock.tick % 12 === 0) days.push({ hash: stateHash(w), metrics: JSON.stringify(w.metrics), chronicle: JSON.stringify(w.chronicle) });
  }
  const replay = e2.createWorld(e2.genesisOpts(w));
  for (const cmd of commands) e2.applyCommand(replay, cmd);
  return { results, samples, days, hash: stateHash(w), replayHash: stateHash(replay) };
}
