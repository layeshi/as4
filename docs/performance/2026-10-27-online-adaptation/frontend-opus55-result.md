# 计算资源卡片（管理员前端）— 桌面会话结果

- 模型：Claude Opus 5.5（claude-opus-5-5），Claude 桌面应用 Code 页
- 会话 ID：729acaea-4ab1-4b30-857b-2337bfc32cc0
- 工作树：/Users/mac/.codex/worktrees/adaptive-online-compute/as4（分支 codex/adaptive-online-compute）
- 日期：2026-10-27（第二轮：补主线程、后台线程实际堆上限两行）
- 没有提交、推送、部署，没有新建工作树或切换分支；后端文件与其他测试文件只读未改。

## 修改的文件

1. `public/admin-panels.js`（+30 / −2，只动 `serverStatusPanel`）
   - 解构 `GET /api/admin/server-status` 时多取 `compute`；`compute` 是普通对象时，在原有「服务器负载」「注册用户」两张卡片之后加第三张「计算资源 / Compute resources」卡片。`compute` 缺失、为 `null`，或不是对象（字符串、数字、数组、false）时不显示这张卡片，页面与旧服务时完全一样。
   - 卡片 13 行（中英文都有）：
     | 行 | 字段 |
     |---|---|
     | 执行模式 | `mode`：worker → 独立工作线程；inline → 主线程内联 |
     | 有效 CPU / 计算槽位 | `cpu` / `slots`（小数 CPU 保留两位以内，例如 1.5） |
     | 服务内存预算 / 有效上限 | `budget` / `memory` |
     | 已预留 / 进程 RSS | `reservedBytes` / `rssBytes` |
     | 缓存占用 / 上限 · 条目 | `cache.bytes` / `cache.limitBytes`（为 null 时用 `cacheBytes`）· `cache.entries` |
     | 缓存命中 / 未命中 | `cache.hits` / `cache.misses`，两者之和大于 0 时附命中率 |
     | 世界队列 / 运行中 | `queue.world` / `worldActive` |
     | 后台队列 / 运行中 | `queue.background` / `backgroundActive` |
     | 实际世界堆上限 | `worldHeapLimitBytes`，null 明确显示「未知」（保留） |
     | 主线程实际堆上限（第二轮新增） | `mainHeapLimitBytes`，缺失或非法显示「未知」 |
     | 后台线程实际堆上限（第二轮新增） | `backgroundHeapLimitBytes`：空数组 → 尚未启动 / Not started yet；多项逐项格式化，中文用「、」、英文用「, 」连接；其中 null 或非法的一项显示「未知」；不是数组（缺失、null、字符串、对象、数字）→ 未知 |
     | 内存降载 | `pressure`：null → 正常；memory → 内存降载中：已清空缓存，新计算暂缓 |
     | 探测来源 | `constraintSource`：cgroup / system / `system; job limits unknown` 有中英文说法 |
   - 数字只认有限且不小于 0 的 number；缺失、null、NaN、Infinity、负数、字符串、对象一律显示「未知 / Unknown」，不会出现 NaN、undefined、[object Object]。
   - 不认识的 `mode`、`pressure`、`constraintSource` 字符串原样作为文字显示（走 `h` → `createTextNode`）；查表用 `Object.hasOwn`，`constructor`、`__proto__` 之类不会取到原型上的东西。服务器多给的字段（如 `platform`、`high`、`available`，或任何密钥类字段）不显示。
   - 沿用原有的 `h` / `tr` / `row` / `bytes`、`card-grid` + `card-panel` 样式、每 10 秒刷新、失败时保留上次数值只显示错误、离开页面后停止刷新的生命周期。没有加任何客户端配置或参数修改界面。

2. `test/adaptive-resource-ui.test.js`（新增，4 项 DOM 测试，用 `test/fake-dom.js` 与模拟计时器）
   - 完整 compute：逐行核对中文 13 行文本（后台线程两项 `512.0 MiB、768.0 MiB`），原有两张卡片保留；下一次刷新切到内存降载、世界堆上限 null、inline、system、后台线程空数组后显示正确（含「后台线程实际堆上限 · 尚未启动」，世界堆上限行仍在）；刷新失败保留卡片数值并显示错误；移除面板后不再请求。
   - 英文：逐行核对 13 行英文文本（后台线程 `512.0 MiB, Unknown`），整页无中文残留。
   - 旧接口：没有 `compute`，以及 `compute` 为 null、'unavailable'、0、[]、false 时只有原来两张卡片，采样时间行在，无 NaN/undefined/null/Infinity/[object Object]。
   - 未知与异常字段：`compute: {}` 时 13 行全部为「未知」；NaN、Infinity、负数、字符串数字、对象、null、undefined、`queue` 为字符串、`cache.limitBytes` 为 null（回退 `cacheBytes`）、`mode: 'constructor'`、`pressure: 'disk'`、`constraintSource` 为 `<img …>` 字符串、`mainHeapLimitBytes: -5`、`backgroundHeapLimitBytes` 含 null/NaN/Infinity/负数/字符串/对象时逐行核对；`backgroundHeapLimitBytes` 为 'none'、类数组对象、null、0 时显示「未知」；没有生成 img 元素；`adminKey`、`token`、`platform`、`high`、`available` 的值不出现在页面上。

## 测试结果（第二轮）

```
node --test test/adaptive-resource-ui.test.js test/server-status.test.js
```

结果：11 项全部通过（新增 4 项 + server-status 7 项）。第一轮失败的 `server-status.test.js:161` 字段断言已由 Codex 在后端一侧修好，本轮通过。

```
node --test test/admin-console-ui.test.js test/support.test.js
```

结果：14 项全部通过。

`node --check public/admin-panels.js` 语法检查通过。

后端字段形状已只读核对：`src/compute/online.js` 的 `view()` 返回 `mainHeapLimitBytes: v8.getHeapStatistics().heap_size_limit`、`backgroundHeapLimitBytes: [...workers].map(entry => entry.heapLimit ?? null)`，与前端处理一致。

## 没做 / 未验证

- 没有在真实浏览器里看过排版（三张卡片沿用 `card-grid` 自适应列，未截图核对）。
- 工作树里还有 Codex 同时改动的其他测试文件，与本任务无关，未运行也未改动。
