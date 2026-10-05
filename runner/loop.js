// SPEC-P2 §7：第二前提的工具循环（agent 模式）。
//
// 这个文件现在只有注意力上限的缺省值（第 2 步：感知里的 attention 要用它）；一次醒来、被叫醒、摘要与工具定义在第 8 步加入。
// 缺省值只在这里定义一次：src/shells/config.js 与 src/http/server.js 引用它（SPEC-P2 §3）。

/** 每刻的上限（A）：运行时的配置，不属于世界；平台的运行器执行，服务器只通过感知的 attention 告诉所有客户端 */
export const DEFAULT_AGENT_LOOP = Object.freeze({ turns: 4, looks: 6, lookChars: 3000, wakes: 2, wakeTurns: 2, marginSec: 60, debounceSec: 20 });
