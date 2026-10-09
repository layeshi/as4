// SPEC-P4 §8: upgrade funding is spent on completion; only future output is distributed.
import { P } from '../params.js';
import { isAlive } from '../world.js';
import { creditEnergy } from './core.js';
import { source } from './ledger.js';

export function upgradeCost(w, level) {
  let n = w.tokens.capacity;
  for (let i = 1; i < level; i++) n = Math.floor(n * P.upgradeGrowthNum / P.upgradeGrowthDen);
  return n;
}
export function buildUpgrade(w, j) {
  const level = w.well.upgrades.length + 1;
  const city = j.owner.kind === 'city';
  w.well.upgrades.push({ projectId: j.id, level, owner: city ? 'city' : 'private', shares: city ? null : { ...j.contributors } });
  w.dayLog.p4.upgradesBuilt++;
  return 'well';
}
export function payDividends(w, amount) {
  for (const upgrade of w.well.upgrades) {
    if (upgrade.owner !== 'private') continue;
    source(w, 'energy', 'well_output', amount);
    const total = Object.values(upgrade.shares).reduce((n, share) => n + share, 0);
    let rest = amount;
    for (const id of Object.keys(upgrade.shares).sort()) {
      const a = w.agents[id];
      if (id === 'treasury' || !a || !isAlive(a)) continue;
      const n = Math.floor(amount * upgrade.shares[id] / total);
      creditEnergy(w, a, n);
      rest -= n;
    }
    w.treasury.energy += rest;
    w.dayLog.p4.dividends += amount;
  }
}
export function releaseShares(w, id) {
  for (const upgrade of w.well.upgrades) {
    if (upgrade.owner !== 'private' || !Object.hasOwn(upgrade.shares, id)) continue;
    upgrade.shares.treasury = (upgrade.shares.treasury || 0) + upgrade.shares[id];
    delete upgrade.shares[id];
  }
}
export function upgradeView(w) {
  const publicLevels = w.well.upgrades.filter(u => u.owner === 'city').length;
  return { level: w.well.upgrades.length, max: P.upgradeMax, public: publicLevels, private: w.well.upgrades.length - publicLevels };
}
