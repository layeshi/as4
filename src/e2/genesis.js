// 创建世界时要做的、依赖规则引擎的初始化（例如生成遗法并执行它们的 enact）。
//
// world.js 不能直接引用规则引擎（引擎要引用 world.js，会形成循环）。所以引擎的各模块在加载时把自己的初始化登记在这里，
// createWorld 在种好地点、宪章、典籍之后依次执行它们。登记的顺序即执行的顺序（= engine/index.js 里的导入顺序）。

/** @type {Array<(w: object) => void>} */
export const GENESIS_STEPS = [];

export function onGenesis(fn) {
  GENESIS_STEPS.push(fn);
}
