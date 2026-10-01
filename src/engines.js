// 两代引擎的注册与分派（SPEC-E2 §2.1）。
//
// 世界状态里 `physics` 为 2 的是第二纪的城（引擎 v2）；没有这个字段（或为 1）的是第一纪的城（引擎 v1，冻结）。
// 运行时、HTTP、回放、沙盘命令行都通过这里取得对应的门面。

import v1 from './engine/facade.js';
import e2 from './e2/facade.js';

export const ENGINES = Object.freeze({ 1: v1, 2: e2 });

/** 世界所属的引擎（按世界或快照的 physics） */
export const engineOf = (w) => (w && w.physics === 2 ? e2 : v1);

/** 按物理版本取引擎；不认识的版本报错 */
export function engineForPhysics(physics) {
  const engine = ENGINES[physics];
  if (!engine) throw new Error(`unknown physics: ${physics}`);
  return engine;
}

/**
 * 回放用：由快照还原「创建时的世界」。回放 = 创建初始世界 + 重放全部命令。
 * 第一纪：种子、版本、地图（快照里没有 map 字段的是经典地图）；第二纪另需先民名单与躯壳模型（w.genesis）。
 */
export function createWorldFromSnapshot(snap) {
  if (snap.physics === 2) return e2.createWorld(e2.genesisOpts(snap));
  return v1.createWorld({ id: snap.id, seed: snap.seed, codeVersion: snap.codeVersion, sandboxAdoption: snap.sandboxAdoption, map: snap.map || 'classic' });
}
