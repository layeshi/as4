// Statistical bookkeeping has its own version; historical worlds keep v1.
import { P } from './params.js';
export const usesStatistics2 = w => [6, 7].includes(w.premise) && w.statistics?.version === 2;
export function enableStatistics(w, args = {}) {
  if (![6, 7].includes(w.premise)) return { ok: false, error: { code: 'not_allowed' } };
  if (args.version !== 2 || Object.keys(args).some(k => k !== 'version')) return { ok: false, error: { code: 'invalid_request', field: 'version' } };
  if (!usesStatistics2(w)) w.statistics = { version: 2, enabledCommand: w.commandN, enabledTick: w.clock.tick, firstCompleteDay: Math.floor(w.clock.tick / P.ticksPerDay) + 1 };
  return { ok: true, ...w.statistics };
}
