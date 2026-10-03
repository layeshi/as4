// Body helpers without lifecycle or daily-step registration dependencies.
import { P } from '../params.js';
import { pushInbox } from './core.js';
import { idNum, agentList, isAlive } from '../world.js';
export const isShell = (a) => a.body.kind === 'shell' || a.body.shell === true;
/** Numeric body order is independent of array order in imported snapshots. */
export const bodyList = (w) => w.shells.bodies.slice().sort((a, b) => idNum(a.id) - idNum(b.id));
export const bodyOf = (w, a) => isShell(a) ? w.shells.bodies.find((b) => b.id === a.body.shellId) : a.body;
export const takeBody = (w) => bodyList(w).filter((b) => b.occupant === null).sort((a, b) => a.vacantSince - b.vacantSince || idNum(a.id) - idNum(b.id))[0] || null;
export function occupyBody(b, a) { b.occupant = a.id; b.vacantSince = null; a.body.shellId = b.id; }
export function releaseBody(w, a, day) {
  if (!isShell(a)) return;
  const b = bodyOf(w, a);
  b.occupant = null;
  b.vacantSince = day;
}

export function wipeTraining(w, a) {
  const body = bodyOf(w, a);
  const n = body.trained.length + body.pending.length;
  body.trained = []; body.pending = [];
  w.dayLog.p1.trainedWiped += n;
  if (n) pushInbox(w, a, 'system', { code: 'trained_lost' });
}
export function completeTraining(w) {
  const targets = [
    ...bodyList(w).map((body) => ({ body, occupant: body.occupant ? w.agents[body.occupant] : null })),
    ...agentList(w).filter((a) => !isShell(a) && isAlive(a)).map((a) => ({ body: a.body, occupant: a })),
  ];
  for (const { body, occupant } of targets) {
    if (body.pending.length === 0) continue;
    body.trained.push(...body.pending); body.pending = [];
    let evicted = 0;
    let total = body.trained.reduce((n, x) => n + x.weight, 0);
    while (total > P.trainedCapacity) { total -= body.trained.shift().weight; evicted++; }
    if (evicted) {
      w.dayLog.p1.trainedEvicted += evicted;
      if (occupant && isAlive(occupant)) pushInbox(w, occupant, 'system', { code: 'trained_faded' });
    }
  }
}
