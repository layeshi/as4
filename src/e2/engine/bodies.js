// Body helpers without lifecycle or daily-step registration dependencies.
import { idNum } from '../world.js';
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
