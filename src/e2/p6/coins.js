// P6 has no coin assets. Older action arithmetic still expects an additive zero;
// provide it only inside the command candidate and erase it before persistence.
// Coin requests and expressions are rejected before this compatibility boundary.
export function coinScratch(w) {
  if ((w.premise !== 6 && w.premise !== 7)) return;
  const treasuries = w.cities ? Object.values(w.cities).map(c => c.treasury) : [w.treasury]; // 第七前提：每城一个公库（命令开始时没有挂城）
  for (const x of [...treasuries, w.ledger.prev, ...Object.values(w.agents), ...Object.values(w.regions), ...Object.values(w.groups).map(g => g.treasury), ...Object.values(w.offers).flatMap(o => [o.give, o.want])]) x.coins = 0;
  w.ledger.src.coins = {}; w.ledger.snk.coins = {};
  for (const log of [w.dayLog, ...(w.cities ? Object.values(w.cities).map(c => c.dayLog) : [])]) { log.coinVolume = 0; log.coinTrade = { energy: 0, coins: 0 }; log.mints = 0; }
}
const OMIT = new Set(['coins', 'coinVolume', 'coinTrade', 'coinPrice', 'treasuryCoins', 'coinsIn', 'totalCoins', 'mints', 'minted']);
export function stripCoins(value) {
  if (!value || typeof value !== 'object') return value;
  for (const key of Object.keys(value)) {
    if (OMIT.has(key)) delete value[key];
    else stripCoins(value[key]);
  }
  return value;
}
export function hasCoinInput(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([k,v]) => k === 'coins' || k === 'mint' || k === 'op' && v === 'mint' || hasCoinInput(v));
}
