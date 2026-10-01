// SPEC-E2 §7.6：规则的接入点。
//
// 物理的引擎（环境、生命周期、动作……）在固定的时机调用这里的三个钩子：
//   before(w, a, type, args, plan)  动作成功之前：收集会拒绝或收费的规则 → { denied: { law, reason } | null, fees: [{ law, to, energy, coins }] }
//   after(w, a, type, args, result, plan)  动作成功之后：收集并施行 after 规则
//   fire(w, type, data)             物理事件发生时（arrive born death retire built abandoned ruin razed weather_start weather_end law_passed law_rejected）
// 实现由规则引擎（engine/rules.js）在加载时注册（installHooks），这样物理模块不必反过来依赖规则引擎，避免循环引用。
// 没有安装时，三个钩子什么都不做——第 3 步的引擎在这种状态下运行。

const NOOP_BEFORE = Object.freeze({ denied: null, fees: Object.freeze([]) });

export const hooks = {
  before: () => NOOP_BEFORE,
  after: () => {},
  fire: () => {},
};

/** 规则引擎注册自己的实现 */
export function installHooks(impl) {
  if (impl.before) hooks.before = impl.before;
  if (impl.after) hooks.after = impl.after;
  if (impl.fire) hooks.fire = impl.fire;
}
