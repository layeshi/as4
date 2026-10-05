# SPEC-P2 · 后人纪「第二前提」实现规格（SPEC-P1 增补）

> 规格 P2.1 · 2026-10-05 · 状态：**已定，可以开始实现**（DESIGN v0.6 §21 与 PROTOCOL-2 §16 已同步）。P2.1 增补匿名私语、屏蔽与两位对抗型先民（§5.9、§5.10、§19，决定 47–50）。
> 依据：[agent 模式方案](plans/2026-10-04-agent-mode.md)（做什么、为什么、估算）与[后人类设定](plans/2026-10-03-posthuman-premise.md)的设定 16–18。面向实现者（人或模型）。
> 本文只写第二前提的世界（`premise = 2`）与设定 1 的世界有什么不同，外加几处对所有世界都生效、但缺省行为不变的修正（§9.4、§10.1）。没写到的一律以 [SPEC-P1](SPEC-P1.md)、[SPEC-E2](SPEC-E2.md) 与 [PROTOCOL-2](PROTOCOL-2.md) 为准。
> 代码基线：`e211846`（分支 `codex/premise-1-implementation`，它包含 main 的全部提交）。分支 `claude/premise-2-spec` 就是它加上第二前提的文档：从 `claude/premise-2-spec` 拉分支。

---

## 0. 给实现者

### 0.1 文档

| 文档 | 回答什么 | 冲突时 |
|---|---|---|
| `docs/DESIGN.md`（v0.6）§21、§19.4 | 第二前提与决定的正式版本 | 决定不可更改 |
| `docs/plans/2026-10-04-agent-mode.md` | 方案：做什么、为什么、成本估算 | 仅供参考，细节以本文为准 |
| `docs/SPEC-P2.md`（本文） | 怎么做：数据、算法、文本、接口、测试、开发顺序 | 第二前提的实现细节以本文为准 |
| `docs/PROTOCOL-2.md` §16 | 接口：感知、动作、收件、事件、等待接口、公开与管理接口 | 接口字段以它为准 |
| `docs/SPEC-P1.md`、`docs/SPEC-E2.md`、PROTOCOL-2 其余各节 | 设定 1 与第二纪 | 本文没有改动的，以它们为准 |

### 0.2 什么时候停下来问

同 SPEC-E2 §0.2。问题写进 `docs/QUESTIONS.md`，编号从 **Q36** 接着往下；受影响的代码用 `// TODO(spec): Q<编号>` 标记，并按「我的建议」暂行实现。

### 0.3 硬性约束

1. **premise 0、1 的世界一点不变。** 包括 baihua、已停止的 `p1-20261003` 与 `data/` 下的全部世界：
   - 回放的状态哈希不变（冻结测试、第二纪确定性测试、`npm run replay`，以及设计方提供的 `p1-20261003` 与 baihua 数据副本）；
   - 感知 JSON、渲染后的感知、系统提示、动作目录、动作结果与错误提示、每日指标、史官，逐字节不变；
   - 运行器对它们仍是一刻一问：发出的请求序列与模型输入逐字节不变；MCP 三个工具的输出不变。
   - 唯一允许的差别：
     - §9.4 的超时与日志修正（只有配置了更长的 `timeoutMs` 时行为才不同）；
     - §10.1 配置文件新增的可选键；
     - 新增的端点（§6.3、§14.2）；
     - MCP 的 `tools/list` 多两个工具（§12）；
     - `PREMISE` 的配置报错文字（§2.1）。此处允许改原有测试；另按 2026-10-05 的 Q43 A，允许 UI 接口存在性测试明确列出第二前提接口例外。
2. **新的状态只出现在第二前提的世界里**：`a.standing`、`a.muted`、`w.dayLog.p2`。新判断一律用 `agentic(w)`（§2.2）。`w.$wakes` 是不可枚举的隐藏属性（同 `w.$out`），不进快照，不进状态哈希。
3. **确定性**：常驻指令的设定与执行都在命令之内；遍历按 ID 升序；不用 `Date.now()`，不新增随机流（执行的动作自己用的随机数照旧）。
4. **运行器在确定性边界之外**，但只能经 `act` 改变世界。工具循环不得引入任何新的写世界的途径。
5. **隐私**：
   - 常驻指令的内容：规则读不到（只读得到条数）；别的居民的感知、公开状态、公开事件流里都没有；研究数据里延迟一个世界月公开；
   - 注意力轨迹不含任何文本（提示、回复、独白、动作参数的值）；
   - 日志照旧不记提示与回复的内容，不记密钥（SPEC-E2 §13）。
6. **预算硬上限**：每一次模型调用都先经 `beforeModel`、后经 `onUsage`。循环里的每一轮都是一次调用。
7. **【目的】一段逐字不变**（SPEC-E2 附录 A.1 的原文）。
8. SPEC-E2 §0.3、SPEC-P1 §0.3 的其余约束照旧。

### 0.4 启动提示词

把下面这段交给实现模型：

```
请先完整阅读 docs/DESIGN.md 的 §21 与 §19.4、docs/PROTOCOL-2.md 的 §16、docs/SPEC-P2.md（P2.1），
再浏览 docs/plans/2026-10-04-agent-mode.md、docs/SPEC-P1.md 与现有代码（src/e2/ 是第二纪的引擎，runner/ 是运行器，src/shells/ 与 src/runner/ 是平台的运行时）。
从分支 claude/premise-2-spec 拉一个新分支来做：它就是代码基线 e211846（分支 codex/premise-1-implementation）加上这些文档。上面这些文档如果不在你的分支上，先停下来问，不要凭猜测实现。
按 SPEC-P2 第 17 节的开发顺序逐步实现；每一步完成后运行 npm test，对照该步的验收标准自检，简要汇报后再进入下一步。
第 1 步开始写代码之前，先按 SPEC-P2 §16.1 的 T1 录下 premise 0 与 premise 1 世界的黄金样本，之后每一步都拿它比对。
不得改变 premise 为 0 或 1 的世界的任何行为：原有测试不改（§0.3 第 1 条写明的例外除外）、照样通过；旧世界的回放哈希不变。
遇到规格未覆盖或相互矛盾之处，按 SPEC-E2 §0.2 写进 docs/QUESTIONS.md（从 Q36 开始编号），并暂停受影响的部分。
本机测量（§16.2）要花真实的 token：只在设计方说开始时做。部署（§19）不属于你的工作。
这个仓库可能有别的会话同时在改：提交前先看 git status，只暂存你自己改的文件；不要 git stash、git reset --hard，也不要整文件备份再还原。
不要修改设定文档里已定的决定。
```

---

## 1. 范围

### 1.1 要做

| # | 内容 | 本文 |
|---|---|---|
| 1 | 设定版本 2：`PREMISE=2`、`agentic(w)`、感知与公开状态里的 `premise: 2`、`dayLog.p2` | §2 |
| 2 | 参数 | §3 |
| 3 | 感知：开放提案读法 2000（E2）、维持费与宣告的提示（F5）、`you.standing`、`attention` | §4 |
| 4 | 常驻指令：动作 `standing`、规则检查、每刻执行、维持费、收件、事件、指标 | §5 |
| 5 | 唤醒：隐藏列表、运行时通知、`GET /api/me/wait`、客户端的 `wait` | §6 |
| 6 | 运行器的工具循环：工具、上限、截止、摘要、被叫醒、用量、轨迹 | §7 |
| 7 | 渲染：概要与展开 | §8 |
| 8 | 提供者：原生工具调用与文本 JSON；超时修正（F2） | §9 |
| 9 | 躯壳与托管：配置、连接测试、用量、幕后指纹、限速 | §10 |
| 10 | 文本 | §11、附录 A |
| 11 | MCP | §12 |
| 12 | 反馈的措辞（F4、F5b、F7） | §13 |
| 13 | 观测：轨迹文件、接口、指标、观测站的一小节 | §14 |
| 14 | 沙盘 | §15 |
| 15 | 匿名私语与屏蔽 | §5.9、§5.10 |

### 1.2 不做

- 记忆按需回想（决定 41）：记忆照旧每次全文给出。
- 为 41 个动作各开一个工具；联网、执行代码等城外的工具（决定 38）。
- 由服务器强制执行 `attention`（决定 37：只在平台的运行器里执行）。
- 改物理：每刻至多 4 个动作、各动作的代价、`read` 与 `draft` 的引擎语义都不变。
- 观测站的大改：只加 §14.4 的一小节。
- 记录模块（决定 49）。
- 部署：见 §19，不属于实现者的工作。

---

## 2. 设定版本 2

### 2.1 配置

- `src/config.js:66–67`：
  - 不为 null 时必须是 0、1 或 2，否则报错「PREMISE 只能是 0、1 或 2」；
  - `premise >= 1` 而 `physics !== 2` 时报错「PREMISE=1 或 2 只用于第二纪（PHYSICS=2）」。
- 其余同 SPEC-P1 §2.1：只在创建世界时生效；打开已有世界时设定不同，只警告，不改世界。

### 2.2 世界

- `src/e2/world.js:141`：`createWorld` 的 `premise` 必须是 0、1 或 2（报错文字同 §2.1）。
- `premise >= 1` 时做 SPEC-P1 §2.2 的一切：`backstage`、`shells.bodies`、`dayLog.p1`、先民不多于躯壳。`world.js:142` 的条件改为 `premise >= 1`，报错文字不变。
- `premise === 2` 时另外：
  - `w.premise = 2`；`w.genesis.premise = 2`；
  - `w.dayLog.p2`（§2.4）。
- `src/e2/world.js` 导出 `agentic(w) = (w.premise || 0) >= 2`；`src/e2/facade.js` 一并导出。`premised(w)` 不变（`>= 1`）。
- `makeAgent`：`agentic(w)` 时加 `standing: []`（§5.1）与 `muted: []`（§5.10）。
- `src/e2/sandbox/run.js:64` 的 `premise === 1` 改为 `premise >= 1`。

### 2.3 对外的字段

- 感知：`src/e2/engine/perception.js` 的 77、88、114 行，把 `...(premised(w) ? { premise: 1 } : {})` 改为 `...(premised(w) ? { premise: w.premise } : {})`。第一前提的世界输出仍是 1。
- 公开状态：`src/e2/engine/visibility.js:247` 同样改。

### 2.4 日志

`newDayLog(p1 = false, p2 = false)`：`p2` 为真时附加

```
p2: { standingSets: 0, standingFired: 0, standingFailed: 0, standingSkipped: 0, standingErrors: 0,
      standingUpkeep: 0, standingSuspended: 0, standingExpired: 0, anonymousWhispers: 0, mutes: 0, muteBlocked: 0 }
```

所有调用点改为 `newDayLog(premised(w), agentic(w))`。

---

## 3. 参数

`src/e2/params.js` 的 `P` 新增下列键，只在第二前提的分支里读：

| 键 | 值 | 用途 |
|---|---|---|
| `standingMax` | 3 | 每人常驻指令的条数上限 |
| `standingDoMax` | 2 | 每条指令至多几个动作 |
| `standingCost` | 1 | 动作 `standing` 的代价 |
| `standingUpkeep` | 1 | 每条指令每日的维持费 |
| `standingTimesMax` | 1000 | `times` 的上限 |
| `standingJsonMax` | 2000 | 每条指令 `JSON.stringify` 之后的字符数上限 |
| `proposalReadingMax` | 2000 | 进行中的提案，读法在感知里的长度上限 |
| `anonymousWhisperCost` | 3 | 匿名私语的基础代价（§5.9） |
| `muteMax` | 20 | 每人至多屏蔽几个（§5.10） |

运行时的注意力上限不进 `P`（它不属于世界，§4.4）。缺省值由 `runner/loop.js` 导出、`src/shells/config.js` 引用，只此一处：

```js
export const DEFAULT_AGENT_LOOP = Object.freeze({ turns: 4, looks: 6, lookChars: 3000, wakes: 2, wakeTurns: 2, marginSec: 60, debounceSec: 20 });
```

2026-10-06 本机测量后保留这组初值，并发取 6；GLM 与 Step 的第二前提线路显式使用 `toolMode: 'native'`。库的 JSON 缺省与旧世界行为不变。native 总体有效率达到 98% 门槛，GLM 单独仍为 97.58%；完整口径见 [CALIBRATION-P2](CALIBRATION-P2.md)。

---

## 4. 感知的差别

### 4.1 进行中的提案：读法至多 2000（E2）

`proposalEntry`（`perception.js:314`）：

```js
const full = reading || (typeof p.procedure === 'string' ? p.procedure : '');
const c = clip(full, agentic(w) ? P.proposalReadingMax : P.readingInPerception); // 已有的 clip 返回 { text, truncated }
// reading: c.text，另外在 agentic(w) 且 c.truncated 时加 readingTruncated: true 与 readingLength: cpLength(full)
```

- 只有 `city.proposals`（进行中的提案）用它。
- `city.laws[].reading`、`procedure`、社群章程仍是 400（`P.readingInPerception`）。

### 4.2 维持费与宣告的提示（F5）

`lawEntry` 与 `proposalEntry` 在 `agentic(w)` 时各加两个字段：

- `upkeep`：每日维持费 = `P.ruleUpkeep × persistentCount(rules)`。立法程序与没有规则的为 0；提案按它的规则计算。
- `announces`：规则里（含 `each` 的 `do` 之内，递归）有没有 `announce` 操作，布尔。

渲染见 §8.3。

### 4.3 `you.standing`

`youView` 在 `agentic(w)` 时加：

```js
standing: a.standing.map((o, index) => ({ index, when: o.when, if: o.if, do: o.do, times: o.times, untilDay: o.untilDay,
                                          fired: o.fired, suspended: o.paidThrough < clockDay(w) })),
standingMax: P.standingMax,
```

`untilDay` 是【此刻】里「总第 N 日」的那个 N（从 1 起），原样输出，渲染时不再加 1。

另加 `you.muted`（§5.10）：`a.muted.map((k) => (k === 'anonymous' ? 'anonymous' : refId(w, k))).filter(Boolean)`。

### 4.4 `attention`

`attention` 不是世界状态，由 HTTP 层附加，做法同 `ruleDiagnostics`：

- `createApp`（`src/http/server.js`）：`rt.agentLoop = ctx.shells ? ctx.shells.config.agentLoop : DEFAULT_AGENT_LOOP`。
- `meCore`（`src/http/agent.js`）：`agentic(rt.w)` 且 `p.you && p.you.status === 'awake'` 时，`p.attention = { ...rt.agentLoop }`。
- 躯壳的进程内客户端走同一个 `meCore`，所以三种客户端看到同一组数。

### 4.5 `actions` 视图

`standing` 一行：醒着时总是 `available`，代价 `P.standingCost`，没有地点限制。法律的 before 规则照常预求值（SPEC-E2 §17）。

---

## 5. 常驻指令、匿名私语与屏蔽（引擎）

### 5.1 数据

`a.standing: Order[]`（只在第二前提的世界；`makeAgent` 时为 `[]`）。

```
Order = { when: string, if: string | null, do: Action[], times: int | null, untilDay: int | null,
          fired: int, seen: int, paidThrough: int }
```

- `when`：`tick`、`daily`、`inbox:whisper`、`inbox:offer`、`inbox:pact`、`inbox:memory_offer`、`inbox:group`、`inbox:gift`。
- `if`：表达式的源文本。不存语法树：每次执行时解析；解析结果可以按源文本缓存在模块级的 `Map` 里（不进世界状态）。
- `do`：1–`standingDoMax` 个动作对象，原样保存；字符串值以 `=` 开头的是表达式。
- `fired`：条件为真的次数（含跳过与求值出错的）。
- `seen`：`inbox:` 指令已经看过的最大收件序号。
- `paidThrough`：维持费付到哪一日，含义同法律的 `paidThrough`（§5.5）。

### 5.2 动作 `standing`

**动作表**（`src/e2/lore/actions.js`）：

- `ACTIONS_P2 = { ...ACTIONS_P1, standing: { base: 1, place: null, module: null, where: null, params: 'orders', args: [['orders', 'list'], ['count', 'int']], verb: W('留下常驻指令', 'sets standing orders'), desc: 附录 A.2 } }`；同一张表里另有 `whisper` 的第二前提版本与 `mute`（§5.9、§5.10）。
- `ACTION_ORDER_P2`：在 `ACTION_ORDER_P1` 的 `internalize` 之后插入 `mute`，在 `declare` 之后插入 `standing`。
- `INNER_ACTIONS_P2`、`NO_BEFORE_ACTIONS_P2`、`NO_AFTER_ACTIONS_P2` 照第一前提的写法推出。`standing` 不是内心的动作，有 before 与 after。
- `TABLE2`；`actionTable = (p = 0) => p >= 2 ? TABLE2 : p >= 1 ? TABLE1 : TABLE0`。
- `registerHandlers`（`engine/actions.js`）改用 `actionTable(2).isKnown` 校验名字。
- 新文件 `src/e2/engine/actions/standing.js` 导出 `standingHandlers = { standing }`，在 `HANDLERS` 里注册。

**validate(ctx, args)**：

1. `orders` 必须是数组，长度 0…`P.standingMax`，否则 `invalid_args`（hint 见附录 A.9）。
2. 对每一条（序号 `i`）：
   - 是对象，只能有 `when`、`if`、`do`、`times`、`untilDay` 五个键，否则 `invalid_args`；
   - `JSON.stringify(order).length <= P.standingJsonMax`，否则 `text_too_long`（`field: 'orders'`、`limit`、`actual`）；
   - `when` 在 §5.1 的列表里，否则 `invalid_args`；
   - `times`：省略、null，或 1…`P.standingTimesMax` 的整数；`untilDay`：省略、null，或不小于 `clockDay(w) + 1` 的整数（即【此刻】里的「总第 N 日」）；否则 `invalid_args`；
   - `if`：省略、null，或码点数不超过 `P.exprChars` 的字符串。检查：`checkExpression(src, T.BOOL, 'standing', { premise: 2, it: isInbox ? T.ANY : null })`；
   - `do`：数组，长度 1…`P.standingDoMax`。每个元素：
     - 是对象，`type` 是字符串，`actionTable(2).isKnown(type)` 为真，且不是 `standing` 或 `retire`，否则 `invalid_args`；
     - 其余每个键的值是以 `=` 开头的字符串时，去掉 `=` 的源文本（码点数不超过 `P.exprChars`）用 `checkExpression(src, T.ANY, 'standing', …)` 检查；
     - 其他值原样接受，执行时由该动作自己校验；
   - 字面的字符串值（不以 `=` 开头的，只看 `do` 里各动作的顶层键）经 `screen()` 审核，不通过返回 `moderated`（`field: 'orders'`）。
3. 表达式检查的问题汇总后返回 `rule_invalid`，写法同 `propose`：`issues` 的路径写成 `orders[i].if` 或 `orders[i].do[j].<键>`，至多 `MAX_ISSUES` 条。
4. 代价 `ctx.cost(P.standingCost)`。

**apply(ctx, plan)**：

```js
const { w, a } = ctx;
const today = clockDay(w);
const seen = a.inbox.length ? a.inbox[a.inbox.length - 1].seq : 0;
a.standing = plan.orders.map((o) => ({ when: o.when, if: o.if ?? null, do: JSON.parse(JSON.stringify(o.do)),
  times: o.times ?? null, untilDay: o.untilDay ?? null, fired: 0, seen, paidThrough: today }));
emit(w, 'standing', { vis: 'delayed', agent: a.id, place: a.place, data: { count: a.standing.length, orders: plan.orders } });
w.dayLog.p2.standingSets++;
return { count: a.standing.length };
```

- 新订的指令当日视为已付，同新生效的法律。
- 整体替换：旧指令的 `fired`、`seen` 不保留；设定之前到达的收件不会触发新的指令。

### 5.3 规则检查：检查类别 `standing`

- `src/e2/rules/types.js`：`namesFor('standing')` 返回 `{ ...base, me: T.AGENT, left: T.INT, here: T.AGENTS }`。`me` 的字段就是规则里居民的字段（`FIELDS.agent`），不新增字段。
- `ALL_NAMES` 不改，另导出 `ALL_NAMES_P2 = [...ALL_NAMES, 'me', 'left']`。`check.js` 的 `nameError` 在 `ctx.premise >= 2` 时用它，所以 premise 0、1 的报错文字不变。
- `makeCtx(kind, { action, event, premise = 0 })` 记下 `premise`；`checkExpression(src, expected, kind, opts)` 把 `opts.premise` 传进去。
- `kindHere` 加 `me`、`left` 的说明（附录 A.9），只在第二前提里用到。
- `standing` 只是检查用的类别，不是规则的时机：`parseWhen` 不认识它。
- **动作参数的名字按设定版本取**：
  - `actionArgNames(type, premise = 0)`、`actionArgKind(type, name, premise = 0)` 按 `actionTable(premise)` 取；`check.js:159` 传 `ctx.premise`；
  - `engine/rules.js` 的 `argsRecord(w, type, raw)` 改用 `actionTable(w.premise || 0).ACTIONS[type]`；
  - `standing` 的特例：`count = Array.isArray(raw && raw.orders) ? raw.orders.length : 0`。`orders` 是列表，规则读到 null（已有的「列表规则读不到」）。
- 结果：第二前提里 `before:standing`、`after:standing` 是合法的时机；premise 0、1 里 `standing` 仍是不认识的动作，提示文字不变。

### 5.4 执行：每刻的一步

`tickWorld`（`engine/tick.js`）在第 6 步（日结算）之后、第 7 步（沙盘脑）之前加：

```js
if (agentic(w)) runStanding(w); // 6.5 常驻指令
```

新文件 `src/e2/engine/standing.js`：

```js
export function runStanding(w) {
  const today = clockDay(w);                                     // 从 0 起；untilDay 与「总第 N 日」比，用 today + 1
  const boundary = w.clock.tick % P.ticksPerDay === 0;          // 日界刻 = 新一日的第 1 刻
  for (const a of agentList(w)) {                              // ID 升序
    if (a.status !== 'awake' || !a.standing || a.standing.length === 0) continue;
    for (let i = 0; i < a.standing.length; i++) {
      const o = a.standing[i];
      if (o.paidThrough < today) continue;                     // 停摆
      if (o.untilDay !== null && today + 1 > o.untilDay) continue; // 过期：在本居民处理完后删除
      let triggers;
      if (o.when === 'tick') triggers = [null];
      else if (o.when === 'daily') triggers = boundary ? [null] : [];
      else {
        const kind = o.when.slice(6);
        triggers = a.inbox.filter((it) => it.seq > o.seen && matchesTrigger(it, kind));
        if (a.inbox.length) o.seen = Math.max(o.seen, a.inbox[a.inbox.length - 1].seq);
      }
      for (const it of triggers) {
        if (o.times !== null && o.fired >= o.times) break;
        if (a.status !== 'awake') break;
        fireOrder(w, a, i, o, it);
      }
    }
    expireOrders(w, a, today);
  }
}
```

`matchesTrigger(it, kind)`：`whisper`、`offer`、`pact`、`memory_offer`、`gift` 比 `it.kind`；`group` 要 `it.kind === 'group' && it.event === 'request'`。

`fireOrder(w, a, i, o, it)`：

```js
const trigger = { when: o.when, ...(it ? { seq: it.seq } : {}) };
const item = it?.kind === 'whisper' ? { ...it, anonymous: it.anonymous === true } : it; // Q36 B
const env = { me: agentRef(a.id), left: actionsLeft(a), here: hereOf(w, a.place), ...(item ? { it: plainRecord(item) } : {}) };
const host = makeHost(w);
let actions;
try {
  if (o.if !== null && !asBool(evaluate(parsed(o.if), host, env))) return;   // 条件为假：不计次，不发收件
  actions = o.do.map((act) => materialize(act, host, env));
} catch (e) {
  if (!isRuleError(e)) throw e;
  o.fired++; w.dayLog.p2.standingErrors++;
  report(w, a, i, trigger, { results: [], error: e.code });
  return;
}
o.fired++;
if (actionsLeft(a) === 0) {
  w.dayLog.p2.standingSkipped++;
  report(w, a, i, trigger, { results: [], skipped: actions.length });
  return;
}
const results = runActions(w, a, actions, a.lang === 'en' ? 'en' : 'zh');
const skipped = results.filter((r) => !r.ok && r.error.code === 'budget_exhausted').length;
w.dayLog.p2.standingFired++;
w.dayLog.p2.standingFailed += results.filter((r) => !r.ok && r.error.code !== 'budget_exhausted').length;
report(w, a, i, trigger, { results, skipped });
```

- Q36 B：署名私语在求值环境里有 `it.anonymous === false`；不改原收件或事件格式。
- `plainRecord`、`hereOf` 从 `engine/rules.js` 导出（现在是模块内函数）。`it.from` 这类一层的嵌套记录保留，列表丢弃。
- `materialize(act, host, env)`：复制动作对象；顶层键的值是以 `=` 开头的字符串时，求值替换。结果是整数、真假、字符串或 null 时直接用；是居民、社群、灵魂的引用时换成它的 ID；是记录或列表时，抛出 `type` 规则错误。
- `isRuleError(e)`：求值器抛出的规则错误（代码与 `rule_error` 事件同一组）。
- `report(w, a, i, trigger, { results, skipped?, error? })`：
  - 给本人收件 `standing`：`{ order: i, trigger, results: results.map(compact), skipped?, error? }`，其中 `compact(r)` 为 `{ type, ok, cost, data? }` 或 `{ type, ok, error: { code } }`；
  - 事件 `standing_fired`（`vis: 'delayed'`），`data: { order: i, trigger, results: results.map((r) => ({ type: r.type, ok: r.ok, ...(r.ok ? {} : { error: r.error.code }) })), skipped?, error? }`。
- 指令执行的动作照常产生各自的事件（`runActions` 里），与亲手做的一样，不标记是自动的。
- 低 ID 居民的指令在这一步里私语了高 ID 的居民，高 ID 居民的 `inbox:whisper` 指令同一刻就会看到；反过来要等下一刻。这是确定的顺序，不需要处理。

`expireOrders(w, a, today)`：

```js
const keep = [];
for (const o of a.standing) {
  const used = o.times !== null && o.fired >= o.times;
  const late = o.untilDay !== null && today + 1 > o.untilDay;
  if (used || late) { w.dayLog.p2.standingExpired++; pushInbox(w, a, 'system', { code: 'standing_expired' }); }
  else keep.push(o);
}
a.standing = keep;
```

删除之后序号会变；收件里的 `order` 是触发当时的序号。

### 5.5 维持费

`engine/upkeep.js` 的 `payUpkeep(w, d)` 末尾加 `if (agentic(w)) payStanding(w, d);`：

```js
function payStanding(w, d) {
  for (const a of agentList(w)) {                              // ID 升序
    if (a.status !== 'awake' || !a.standing || a.standing.length === 0) continue;
    let unpaid = 0;
    for (const o of a.standing) {
      if (a.energy >= P.standingUpkeep) {
        a.energy -= P.standingUpkeep;
        sink(w, 'energy', 'standing_upkeep', P.standingUpkeep);
        w.dayLog.p2.standingUpkeep += P.standingUpkeep;
        o.paidThrough = d + 1;
      } else unpaid++;
    }
    if (unpaid > 0) { w.dayLog.p2.standingSuspended += unpaid; pushInbox(w, a, 'system', { code: 'standing_suspended' }); }
  }
}
```

- 自愿付的费用，不受生存底线限制。
- `ledger.js` 的 `ENERGY_SINKS` 加 `standing_upkeep`。账本的科目用到才写，所以不影响旧世界。
- 沉睡的居民不付，也不推进 `paidThrough`：醒来之后、下一次日终结算之前，它的指令停摆。

### 5.6 离场、沉睡、换身

- `releaseAgent`（`lifecycle.js:185`）在 `agentic(w)` 时加 `a.standing = []`。
- 沉睡：不执行（§5.4 只看醒着的），不收费（§5.5）。
- 换身（rebody、玩家换模型）、过继：不影响指令。
- 遗传、`impart`：不涉及指令。

### 5.7 收件与事件

- 收件 `standing`：`{ order, trigger: { when, seq? }, results, skipped?, error? }`（PROTOCOL-2 §16.7）。它不在 §6.1 的五类里，不会叫醒任何人。
- `system` 的新代码：`standing_suspended`、`standing_expired`（附录 A.8）。
- 事件：
  - `standing`（设定或撤销）：延迟一个世界月公开；
  - `standing_fired`：延迟。
- 规则的 `on:` 事件（`EVENT_FIELDS`）不加这两种：规则不能对常驻指令作出反应。
- 按 Q29 的约定，观测站的事件模板随事件一起登记（附录 A.8）。
- 史官不加句子。

### 5.8 指标

`dailyMetrics`（`engine/records.js`）在 `agentic(w)` 时，`premiseMetrics` 之后再并入：

| 键 | 定义 |
|---|---|
| `standingOrders` | 在世居民的指令条数合计 |
| `standingHolders` | 有指令的在世居民数 |
| `standingSets`、`standingFired`、`standingFailed`、`standingSkipped`、`standingErrors`、`standingUpkeep`、`standingSuspended`、`standingExpired` | `dayLog.p2` 的同名键 |
| `anonymousWhispers`、`mutes`、`muteBlocked` | `dayLog.p2` 的同名键 |
| `mutedPairs` | 在世居民的屏蔽名单里，指向在世居民的项数合计（不含 `anonymous`） |

---

### 5.9 匿名私语

- 动作表：`ACTIONS_P2.whisper = { ...ACTIONS.whisper, params: 'to, text, anonymous?', args: [['to', 'str'], ['text', 'str'], ['anonymous', 'bool']], desc: 附录 A.2 }`，仍是内心的动作（没有 before / after）。
- `actions/basic.js` 的 `whisper`：
  - **validate**：`const anon = agentic(w) && args.anonymous === true`；第二前提里 `anonymous` 给了却不是布尔值时 `invalid_args`。代价 `ctx.cost(anon ? P.anonymousWhisperCost : ACTIONS.whisper.base)`：雾与中继的修正照旧按动作类型 `whisper` 算。计划带上 `anon`。
  - **apply**：

    ```js
    const delivered = !isMuted(w, plan.to, plan.anon ? null : a.id);
    if (delivered) pushInbox(w, plan.to, 'whisper', plan.anon ? { from: null, anonymous: true, text: plan.text } : { from: ref(a), text: plan.text });
    else w.dayLog.p2.muteBlocked++;
    emit(w, 'whisper', { vis: 'delayed', agent: a.id, place: a.place,
      data: { from: a.id, to: plan.to.id, text: plan.text, ...(plan.anon ? { anonymous: true } : {}), ...(delivered ? {} : { delivered: false }) } });
    if (plan.anon) w.dayLog.p2.anonymousWhispers++;
    return {};
    ```

  - premise 0、1：`anon` 恒为假，`isMuted` 恒为假，走的是原来的代码路径，收件、事件、结果逐字节不变。
- 匿名私语照样进隐藏列表、照样叫醒对方（§6.1），照样经过审核（`needText` 里原有的那一步）。
- 常驻指令：`inbox:whisper` 也被匿名私语触发，`it.from` 为 null、`it.anonymous` 为真；条件里写 `it.from.id` 会求值出错（§5.4 的处理），所以条件里先判断 `it.anonymous`。
- 渲染：`render2.js` 的 `kinds.whisper` 在 `i.anonymous` 时用附录 A.8 的写法；运行器的摘要里，来自匿名的写「有人」。

### 5.10 屏蔽

**数据**：`a.muted: string[]`，元素是居民 ID 或 `'anonymous'`（只在第二前提的世界）。

**动作**：`ACTIONS_P2.mute = { base: 0, place: null, module: null, where: null, inner: true, params: 'who, on?', args: [['who', 'str'], ['on', 'bool']], verb: W('屏蔽', 'mutes'), desc: 附录 A.2 }`。处理函数放在 `actions/basic.js`：

- **validate**：
  - `who === 'anonymous'` 时 `key = 'anonymous'`；否则 `findAgent(w, who)`，找不到 `not_found`，是自己 `invalid_args`，`key = t.id`；
  - `on` 缺省为真；给了却不是布尔值时 `invalid_args`；
  - `on` 为真、`key` 还不在名单里、名单已有 `P.muteMax` 项时，`limit_reached`（hint 见附录 A.9）；
  - 代价 `ctx.cost(0)`。
- **apply**：

  ```js
  if (plan.on && !a.muted.includes(plan.key)) a.muted.push(plan.key);
  if (!plan.on) a.muted = a.muted.filter((k) => k !== plan.key);
  emit(w, 'mute', { vis: 'delayed', agent: a.id, place: a.place, data: { who: plan.key, on: plan.on } });
  w.dayLog.p2.mutes++;
  return { who: plan.key, on: plan.on, count: a.muted.length };
  ```

  重复屏蔽、解除没有屏蔽的人，都照常成功，名单不变。

**判断**：`core.js` 导出 `isMuted(w, recipient, senderId) = agentic(w) && Array.isArray(recipient.muted) && recipient.muted.includes(senderId ?? 'anonymous')`。

**五处定向投递**（被屏蔽时什么都不送，`w.dayLog.p2.muteBlocked++`，发送者的结果不变）：

| 动作 | 位置 | 被屏蔽时 |
|---|---|---|
| `whisper` | `actions/basic.js` | 见 §5.9 |
| `offer`（定向） | `actions/social.js:229` | 交易照常建立、托管，不推收件；到期照常退回 |
| `conceive`（孕育之约的邀请） | `actions/descent.js:112` | 对屏蔽了发起者的那位作者，不推收件；约照常存在，到期作废 |
| `impart` | `actions/basic.js` | 不放进对方的 `memoryOffers`，不推收件；照常分配 `giftId`、照常付代价；延迟事件 `impart` 另带 `delivered: false` |
| `join`（申请加入封闭社群） | `actions/social.js:89` | 不给管事推收件；申请照常进入待审名单 |

**感知的过滤**（只在第二前提）：

- `you.offers`：跳过 `o.to === a.id` 且 `isMuted(w, a, o.from)` 的交易；
- `you.pacts`：跳过 `c.from !== a.id` 且 `isMuted(w, a, c.from)` 的孕育之约；
- `actions` 视图里 `accept` 的可用判断（`perception.js:470`）：不算这些交易；`consent` 也不算被屏蔽者发起的邀约（Q37 B）。

解除屏蔽之后，没送到的收件不补发；仍在托管中的定向交易与仍有效的约，下一次感知时重新出现。

**不受影响的**：说话、宣告、铭刻、法律的宣告与转移、赠予、社群与法案的通知、孕育之约的结果。

**唤醒**：被屏蔽的投递根本不调用 `pushInbox`，所以不进隐藏列表，也不叫醒（§6.1）。

## 6. 唤醒

### 6.1 引擎：隐藏列表

- `engine/core.js` 的 `pushInbox(w, agent, kind, fields)`，在 `agentic(w)` 时：如果是会叫醒的收件，就把 `{ agentId: agent.id, seq: item.seq, kind }` 推入 `w.$wakes`。`w.$wakes` 用 `hidden(w, '$wakes', [])` 定义，同 `$out`。
- 会叫醒的收件（`isWakeItem(kind, fields)`，导出供 §6.3 复用）：
  - `whisper`；
  - `offer`（`pushInbox` 只对定向交易调用）；
  - `pact`；
  - `memory_offer`；
  - `group` 且 `fields.event === 'request'`。
- 新导出 `drainWakes(w)`：取走并清空。
- `engine/index.js` 的 `applyCommand` 返回 `{ result, events: drainEvents(w), wakes: drainWakes(w) }`，提前返回的分支也一样。第一纪的引擎不改，运行时按 `out.wakes || []` 处理。
- 每条命令结束都清空，所以沙盘与回放里没人取走也不会积累。
- 被屏蔽的定向投递不调用 `pushInbox`（§5.10），所以不会出现在这里。

### 6.2 运行时

`src/runtime.js`：

- 构造函数加 `this.wakeSubs = new Set()`；方法 `onWake(fn)`：加入订阅，返回取消订阅的函数。
- `exec`：在 `this.events.append(...)` 之后，对 `out.wakes || []` 的每一项，依次调用每个订阅者；订阅者抛错只记一条警告。
- `open` 里回放命令时不通知。
- 通知不落盘，不经 SSE，不进事件流。

### 6.3 接口：`GET /api/me/wait`

`src/http/agent.js` 新增处理器 `getWait`，路由 `['GET', '/api/me/wait', getWait]`：

1. 鉴权同 `getMe`，但限速用单独的 `ctx.limits.wait`（每个令牌每刻 60 次，§10.5）。
2. 不是第二前提的世界：`sendError(res, lang, 'not_found')`。
3. 参数：
   - `after`：必填，格式同 `/api/me`；
   - `timeoutMs`：可选，1000–50000 的整数，缺省 25000；
   - 不合法时 `invalid_request`（带 `field`）。
4. 居民不醒着：立即返回 `{ items: [], cursor: after, status }`。
5. 先查一次：`a.inbox` 里 `seq > after` 且 `isWakeItem` 的收件。有就立即返回 `{ items: [本地化后的收件…], cursor: 其中最大的 seq }`，本地化同感知（`localizeInbox`）。
6. 否则用 `rt.onWake` 订阅：收到本居民、`seq > after` 的通知时，按第 5 步重新取，并返回；到时返回 `{ items: [], cursor: after }`；连接关闭时取消订阅、清掉计时器。
7. 不推进任何游标（GET 不是命令）。

Node 的请求超时缺省 300 秒，足够；常见代理 60 秒的读超时由 50000 的上限避开。

### 6.4 客户端的 `wait`

- `runner/client.js` 新增 `wait({ after, timeoutMs = 25000 })`：`GET /api/me/wait?after=&timeoutMs=`，这一次请求的超时是 `timeoutMs + 10000`。返回 `{ ok, status, json }`，同其他调用。
- `src/shells/client.js` 新增 `wait({ after, timeoutMs, signal })`：不走 HTTP，用 `rt.onWake` 实现同样的语义（先查收件箱，再等通知，到时返回空），返回 `{ ok: true, status: 200, json: { items, cursor } }`。
- 托管运行器走 HTTP，但在服务器进程内：`RunnerManager` 给 `runAgent` 传 `deps.waitWake`，用 `rt.onWake` 实现，语义同上（§10.3）。
- 运行器取等待函数的顺序：`deps.waitWake`，否则 `client.wait`，都没有就退回普通的等待（不会被叫醒）。

---

## 7. 运行器：工具循环

### 7.1 选择与文件

- `runner/agent.js` 的 `runAgent`：感知之后，`p.premise >= 2` 时交给新文件 `runner/loop.js`；否则走原来的代码，一字不改。
- `runAgent` 的签名与返回值不变，新增可选依赖：
  - `deps.waitWake({ after, timeoutMs, signal })`：同 §6.4；
  - `deps.onWaking(agentId, rec)`：每次醒来结束时回报（§7.8）。
- `runAgent` 把这位 agent 的可变状态放进一个对象 `S`：`cursor`、`lastWoke`、系统提示的缓存、`history`、`rejected`、`looks`（`{ tick, n }`）、`wakes`（`{ tick, n }`）、`wakeSeen`。第二前提的分支把 `S` 交给 `loop.js`。
- `runner/loop.js` 导出：
  - `DEFAULT_AGENT_LOOP`（§3）；
  - `runWaking(S, p, { kind })`：一次醒来；
  - `waitTickOrWake(S, p)`：等到下一刻，期间处理被叫醒；
  - `toolDefs(lang)`：两个原生工具的中立定义（附录 A.3）；
  - `parseToolJson(text)`：文本 JSON 方式的解析（§9.2）。
- 第二前提里，`runAgent` 的主循环是：感知 → 沉睡、长眠、暂停的处理照旧 → `await runWaking(S, p, { kind: 'main' })` → `await waitTickOrWake(S, p)`。

### 7.2 一次醒来

```
runWaking(S, p0, { kind }):
  limits    = p0.attention ?? DEFAULT_AGENT_LOOP
  maxTurns  = kind === 'main' ? limits.turns : limits.wakeTurns
  nextAt    = p0.now.nextTickAt ?? Date.now() + p0.now.tickMs
  deadline  = nextAt − limits.marginSec × 1000
  mode      = cfg.toolMode === 'native' && provider.step ? 'native' : 'json'
  system    = 第二前提的系统提示（§11.1），按 [lang, soul, trained, premise, mode] 缓存
  first     = kind === 'main' ? 概要(p0) + 摘要(S.history) : 被叫醒的开头(p0, 这一刻早些时候的摘要)
  msgs      = [ user(first) ]；pending = first 里渲染过的收件的最大 seq
  latest    = p0；shownSeq = pending；delivered = S.cursor
  rec       = { tick, kind, mode, turns: 0, looks: [], acts: [], ended: null, tokens: { in: 0, out: 0 }, ms: 0 }
  loop:
    if rec.turns >= maxTurns           → ended = 'turns'
    if Date.now() >= deadline          → ended = 'deadline'
    if !(await beforeModel(…))         → ended = 'budget'
    调用模型（§9）：超时 = max(1000, min(line.timeoutMs, nextAt − Date.now()))
      失败：onUsage(ok: false[, cancelled])；按 §7.4 处理；ended = 'deadline' | 'error' | 'refusal'
    rec.turns++；onUsage(ok: true)；delivered = max(delivered, pending)；第一轮成功时 S.lastWoke = p0.now.tick
    calls = 原生的工具调用，或 parseToolJson(回复的文本)
    calls 为空（原生方式：模型直接回复）→ ended = 'reply'
    逐个处理 calls（§7.3），得到各自的结果文本；act 之后重新感知，latest 换成新的感知
    把模型的回复与结果追加到 msgs；pending = 结果里渲染过的收件的最大 seq（没有则不变）
    有 end（act 的 end 为真，或文本 JSON 的 done）→ ended = 'end'
    latest.you.actionsLeft === 0 → ended = 'actions'
    latest.you.status !== 'awake' → ended = 'asleep'；latest.now.paused → ended = 'paused'
    文本 JSON 连续两轮格式错误 → ended = 'format'
  S.cursor = delivered
  S.history 追加本次的摘要（§7.6），只留最近 historyKeep 条
  onWaking(rec)
```

- **游标**：只推进到「已经随一次成功的调用交给模型」的收件。附在最后一个工具结果里、却没有再调用模型的收件，下一次醒来再给（「至少一次」）。第一轮就失败时游标不动。
- **重新感知**：每次 `act` 之后 `client.me({ lang, after: S.cursor })`。只把 `seq > shownSeq` 的收件附在结果里，然后 `shownSeq` 推进。
- **一轮里有几个调用**：按顺序执行，各自计数；`act` 的 `end` 在本轮全部处理完之后才生效。

### 7.3 工具的处理与结果

- **look**：
  - 本刻已看的次数达到 `limits.looks`：结果是附录 A.5 的「次数用完」，不报错；
  - 否则 `renderLook(latest, what, id, { lang })`（§8.3），超过 `limits.lookChars` 时截断，并加附录 A.4 的截断说明；
  - 记 `rec.looks.push(id ? `${what}:${id}` : what)`。看的次数按 `p.now.tick` 归零，醒来与被叫醒合计。
- **act**：
  - 参数先过 `normalizeReply`（至多 `actionsLeft` 个），它的警告按附录 A.5 写进结果（F7）；
  - `client.act({ thought, actions, lang })`；请求失败时结果是「行动请求失败：{code}」；`401` 停掉 agent，同原来；
  - 成功时：结果的文字见附录 A.5（逐项的结果用 `summarizeResults` 的单项格式，一项一行），然后重新感知，附上新到的收件；`move` 成功时再附一行新地点的概要；
  - 记 `rec.acts.push(...results.map((r) => ({ type: r.type, ok: r.ok, ...(r.ok ? {} : { error: r.error.code }) })))`；
  - 独白（`thought`）照旧随 `act` 提交。
- **done**（只在文本 JSON 方式）：结束。
- 不认识的工具、参数不合法：结果是附录 A.5 的错误文字，算一轮，不结束。
- 每个结果的末尾加一行附录 A.5 的「还能看几次、还剩几轮」。

### 7.4 上限、截止与失败

- 截止时间之后不开始新的调用；单次调用的超时不超过离下一刻的剩余时间（至少 1 秒）。
- 因截止而中止的调用：`onUsage(…, { ok: false, cancelled: true })`，结束原因 `deadline`。
- 提供者出错（`ProviderError`）：
  - `fatal`：照原来的处理，停掉 agent；
  - 其余：结束原因 `error`，记下是第几轮；`MAX_REJECTED` 的计数照旧，按调用计；
  - 下一次醒来的摘要写明中断（附录 A.6）。
- `stop === 'refusal'`：结束原因 `refusal`。
- 第一前提的「失去的一刻」照旧：一次醒来里至少有一轮成功，才算醒过。

### 7.5 被叫醒

```
waitTickOrWake(S, p):
  target = 下一刻的时间（照原来的 waitTick，含抖动；actEveryTicks 照旧）
  waitFn = deps.waitWake ?? client.wait ?? null
  若 waitFn 为空：照原来的 waitTick
  while Date.now() < target 且没有被中止：
    r = await waitFn({ after: max(S.cursor, S.wakeSeen), timeoutMs: min(25000, target − Date.now()) })
    r 失败或 items 为空：continue
    S.wakeSeen = r.json.cursor
    本刻（按 p.now.tick 计）被叫醒的次数已达 limits.wakes：continue
    Date.now() > (p.now.nextTickAt − limits.marginSec × 1000)：continue
    sleep(min(limits.debounceSec × 1000, 离截止的时间))      // 把接下来到的一并处理
    q = client.me({ lang, after: S.cursor })
    q 不醒着、或 q.you.actionsLeft === 0、或 q.now.tick !== p.now.tick：continue
    本刻被叫醒的次数 +1
    await runWaking(S, q, { kind: 'wake' })
```

- 被叫醒时的开头见附录 A.7：【被叫醒】一句，【这一刻早些时候】（本刻主醒来的摘要），以及 `q` 的【此刻】、【你】头行、【收件箱】（`seq > S.cursor` 的全部）、【你在】的地点与在场者。
- 同一批收件不会两次叫醒：`S.wakeSeen` 推进。
- 被叫醒的轮数上限是 `limits.wakeTurns`；看的次数与醒来共用。
- 刻点到了就结束等待，进入下一刻的醒来。

### 7.6 摘要与历史

- `S.history` 只留最近 `historyKeep` 条，醒来与被叫醒都算。`historyKeep = cfg.historyRounds ?? 2`：第二前提里，`historyRounds` 的含义是摘要的条数。
- 一条摘要：

  ```
  { tick, kind, received: [{ kind, from, text60 }], looks: [...], acts: [{ type, ok, error?, cost? }],
    thoughts: [string], ended, turns, failedTurn? }
  ```

  `received` 是这次醒来里交给模型的收件，省略例行的 `transfer`、`tag`、`weather`、`dream`、`witness`（Q39 B）；完整收件仍在当次的收件箱里交给模型。`text60` 截到 60 个码点。
- 渲染见附录 A.6。最近的一条标【上一次醒来】，然后是【再上一次】，更早的标【更早一次】。
- 第一前提的「失去的一刻」那句（SPEC-P1 §11.3、附录 A.8），在第二前提里放在【上一次醒来】一节的第一行；没有上一次时单独成行。
- 摘要只在内存里：进程重启后为空，同原来的历史轮。

### 7.7 用量与预算

- 每轮调用之前：`beforeModel(agentId, { chars, perception: latest })`。`chars` 是系统提示、全部消息与工具定义的字符数。返回假时结束原因 `budget`。
- 每轮调用之后：`onUsage(agentId, usage, { ok, chars, replyChars, ms, error?, cancelled?, waking: { tick, kind, turn } })`。
- `rec.tokens` 累加 `usage.input` 与 `usage.output`；`rec.ms` 累加耗时。

### 7.8 轨迹回报

- 每次醒来（含被叫醒）结束时调用 `deps.onWaking?.(agentId, rec)`；回报出错只记一条警告。
- `rec = { tick, kind: 'main' | 'wake', mode: 'native' | 'json', turns, looks, acts, ended, tokens: { in, out }, ms }`，不含任何文本。
- `ended` ∈ `end`、`reply`、`actions`、`turns`、`deadline`、`budget`、`error`、`refusal`、`asleep`、`paused`、`format`。

---

## 8. 渲染：概要与展开

### 8.1 拆分 `build()`（逐字节不变）

- `runner/render2.js` 把 `build()` 里的各段抽成内部函数：`secNow`、`secYou`、`secHere`、`secInbox`、`secCity`、`secMemories`、`secActions`，`build()` 依次调用它们。
- 拆分之后，premise 0、1 的渲染与黄金样本逐字节相同（T1）。
- 导出 `D` 与这些段函数，供新文件使用；`renderPerception2` 的签名不变。
- 收件 `standing`、匿名私语与新的系统代码加进 `kinds` 与系统文本（附录 A.8），只在第二前提出现。

### 8.2 概要：`renderBrief(p, { lang, history, missed })`

新文件 `runner/render-p2.js`，依次：

1. 【此刻】：同原来。
2. 【你】：
   - 头行与第二行同原来（能量、代谢、标签、志、剩余次数；世代、作者、子女、社群、名下）；
   - 家书、我的交易、孕育之约、遗嘱、待收的记忆、常驻指令，只列数量与编号（附录 A.4）；
   - 训练中一行同原来。
3. 【你在】：
   - 地点一行、在场者一行，同原来；
   - 「此处」一行：墙上、告示板、工程、档案、墓碑、空地块各有多少（附录 A.4）；
   - 源井、荒野、征兆同原来；
   - 不含「听到」：它与收件箱里的发言重复，看 `here` 时才有。
4. 【收件箱】：全文，同原来（含 `standing` 与新的系统代码）。
5. 【全城】：
   - 头行同原来；
   - 立法程序一行：普通、修宪各在哪部法律；
   - 法律、提案、重订、社群的索引，每项一行（附录 A.4）；
   - 居民、地点、词典、摇篮、上书的数量一行。
6. 【你的记忆】：全文，同原来。
7. 【动作的即时状态】：同原来。
8. 摘要（§7.6）。

概要不分级裁剪。

### 8.3 展开：`renderLook(p, what, id, { lang })`

| `what` | 渲染 |
|---|---|
| `here` | `secHere` 的不裁剪版本（第 0 级），含听到、墙上、告示板、工程、档案目录、墓碑 |
| `self` | 家书全文、交易、孕育之约（含灵魂全文）、遗嘱、待收的记忆全文、训练中、常驻指令全文（附录 A.4 的格式） |
| `laws`、`law` + `id` | 法律行（第 0 级），每行之后加维持费与宣告的说明（附录 A.4，F5） |
| `proposals`、`proposal` + `id` | 提案行与读法（引擎给多少就是多少，至多 2000）、记名票；`readingTruncated` 时加原长的说明；维持费的说明 |
| `procedure` | 立法程序、变量、宪章（第 0 级） |
| `groups`、`group` + `id` | 社群行与章程读法（第 0 级） |
| `residents` | 居民名单，含标签（第 0 级） |
| `places` | 地点与移动代价、道路 |
| `refounds`、`cradle`、`lexicon`、`petitions` | 重订；摇篮与近期逝者；词典；上书 |

- `what` 不认识：返回附录 A.4 的「没有这一段」，列出可用的段。
- `id` 找不到：返回「没有这一项：{id}」。
- 长度上限由循环处理（§7.3）。

---

## 9. 提供者：两种调用方式

### 9.1 接口

`runner/providers.js` 的提供者对象新增可选方法：

```
step({ system, transcript, tools, signal, timeoutMs }) → { calls: [{ id, name, args }], text, stop, usage, raw }
```

- 只在 `toolMode === 'native'` 时用。`complete()` 不变：文本 JSON 方式与一刻一问都用它。
- `transcript` 是中立格式的数组，各家转成自己的消息格式：
  - `{ role: 'user', text }`；
  - `{ role: 'assistant', raw }`：上一次 `step` 返回的 `raw`，原样；
  - `{ role: 'tool', results: [{ id, name, text, isError }] }`。
- `tools`：中立定义 `[{ name, description, schema }]`（附录 A.3）。
- `args` 解析失败（例如 JSON 字符串坏了）的那一个调用：`args: null`，运行器给它参数错误的结果。
- 提供者没有 `step` 而配置要求 `native`：运行器改用 `json`，日志里警告一次。

### 9.2 文本 JSON

- 用 `complete({ system, messages })`；`messages` 是 user 与 assistant 交替的纯文本：模型的回复原样作为 assistant，结果作为下一条 user。
- `parseToolJson(text)`：用 `parseModelJson` 取第一个 JSON 对象，接受三种键：
  - `look`：对象 `{ what, id? }`，或这样的对象组成的数组；
  - `act`：`{ actions, thought?, end? }`；
  - `done`：`true`。
  同一个对象里有几种时，按 look、act、done 的顺序处理。返回中立的 `calls`（`id` 用 `j1`、`j2`……）。
- 取不到 JSON，或三种键都没有：给一条格式错误的结果（附录 A.5），算一轮。连续两轮格式错误就结束（`format`）。
- 系统提示用文本 JSON 版本的【怎样行动】（附录 A.1）。

### 9.3 各家的原生格式

**anthropic**（`client.beta.messages.create`）：

- `tools: [{ name, description, input_schema }]`。
- 中立 → 原生：
  - user → `{ role: 'user', content: text }`；
  - assistant → `{ role: 'assistant', content: raw.content }`，原样，含思考块与 `tool_use` 块；
  - tool → `{ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.text, ...(r.isError ? { is_error: true } : {}) })) }`。
- 返回：
  - `calls` 是 `content` 里的 `tool_use` 块（`id`、`name`、`input`）；
  - `text` 是 text 块拼接；`raw = { content: resp.content }`；`stop = resp.stop_reason`。
- 缓存：系统提示照旧用 1 小时缓存；另在 `messages` 最后一条的最后一个块上加 `cache_control: { type: 'ephemeral' }`，让同一次醒来里的前缀命中缓存。最后一条的 `content` 是字符串时，先转成 `[{ type: 'text', text }]` 再加。
- 其余（`output_config`、`fallbacks`、错误分级）同 `complete`。

**openai**（chat completions）：

- `tools: [{ type: 'function', function: { name, description, parameters } }]`，`tool_choice: 'auto'`。
- 中立 → 原生：
  - assistant → `raw.message` 原样，含 `tool_calls`；服务商返回了 `reasoning_content` 之类的推理字段时，一并原样带回；
  - tool → 每个结果一条 `{ role: 'tool', tool_call_id: r.id, content: r.text }`。
- 返回：`calls` 是 `message.tool_calls`，`function.arguments` 是 JSON 字符串，逐个解析。
- native 方式下不发送 `jsonMode`（`response_format`）。`extraBody` 照旧，但不能覆盖 `tools`。

**openai-responses**：

- `tools: [{ type: 'function', name, description, parameters }]`。
- `store: false` 时，请求加 `include: ['reasoning.encrypted_content']`。
- 中立 → 原生：
  - assistant → `raw.output` 的全部项（reasoning、function_call、message）原样追加到 `input`；
  - tool → 每个结果一项 `{ type: 'function_call_output', call_id: r.id, output: r.text }`。
- 返回：`calls` 是 `output` 里 `type === 'function_call'` 的项（`call_id`、`name`、`arguments`）。

**mock**：

- `createMockProvider` 增加 `script` 选项（测试用）：一个数组，每一项是一轮的回复（`{ calls }` 或 `{ text }`，或抛出的错误）；`complete` 与 `step` 都按它逐轮返回。
- 没有脚本时：`step` 用 `mockDecide` 生成一次 `act`（带 `end: true`），偶尔先 `look` 一次；`complete` 在第二前提的感知上返回同样内容的文本 JSON。

### 9.4 超时与错误（F2，对所有世界）

- `src/runner/endpoint.js`：`modelFetch(allowLocal, { timeoutMs } = {})`，`req.setTimeout(timeoutMs ?? 120000, …)`。超时的 Error 设 `name = 'TimeoutError'`，原来的 `cause` 保留。
- 躯壳管理器与托管运行器创建 `modelFetch` 时，传线路的 `timeoutMs`。
- `providers.js` 的网络错误：`e.name === 'TimeoutError' || e.cause?.name === 'TimeoutError'` 时，写「timeout（N 秒）」（N = timeoutMs ÷ 1000）。
- `src/shells/config.js`：线路 `timeoutMs` 的上限由 120000 改为 300000。托管运行器（`runnerConfig`）的上限仍是 120000。
- 缺省值都不变，所以没有改配置的世界，行为不变。

---

## 10. 躯壳与托管

### 10.1 躯壳配置（`src/shells/config.js`）

- 顶层新增可选键 `agentLoop`：对象，键与取值范围如下，缺省见 §3；未知的键报错。

  | 键 | 范围 |
  |---|---|
  | `turns` | 1–8 |
  | `looks` | 0–20 |
  | `lookChars` | 500–8000 |
  | `wakes` | 0–4 |
  | `wakeTurns` | 1–4 |
  | `marginSec` | 10–300 |
  | `debounceSec` | 0–60 |

- 线路新增可选键 `toolMode`：`'json'`（缺省）或 `'native'`。`LINE_KEYS` 加上它。
- `parseShellsConfig` 的返回值多一个 `agentLoop`，总是完整的对象（缺的键取缺省）。
- 只有第二前提的世界用到 `agentLoop` 与 `toolMode`；其余世界读到也忽略。

### 10.2 躯壳管理器（`src/shells/manager.js`）

- `start(a, line)`：`cfg` 加 `toolMode: line.cfg.toolMode`；`deps.onWaking = (id, rec) => this.traces?.append(id, rec, line.cfg.model)`（§14.1）。等待函数由进程内客户端的 `wait` 提供（§6.4）。
- `beforeModel` 与 `onUsage` 不变，按次调用。`onUsage` 遇到 `meta.cancelled` 照常释放预留。
- 并发照旧由配置的 `concurrency` 决定；新世界设 6（§19）。

### 10.3 托管运行器（`src/runner/manager.js`）

- `runnerConfig` 新增 `toolMode`：`'json'`（缺省）或 `'native'`。
- `start(id)`：`runAgent` 的 `deps` 加 `waitWake`（用 `rt.onWake`，语义同 §6.4）与 `onWaking`（写轨迹，§14.1）。
- `onUsage`：`meta.cancelled` 时不记失败，同我们自己取消的请求。
- `prepare`（连接测试）：世界是第二前提、且 `toolMode === 'native'` 时，另做一次带工具的测试：一个名为 `act` 的工具，要求模型调用它一次。拿不到工具调用时返回附录 A.9 的「没有按要求调用工具」，建议改用文本 JSON。
- 用量（`src/runner/usage.js`）：
  - `record` 遇到 `meta.cancelled` 直接返回；
  - `recent` 的元素在有 `meta.waking` 时多一个 `waking: { tick, kind, turn }`；
  - 幕后的用量界面（`public/usage-ui.js`）按 `waking.tick` 分组显示最近的调用（小改）。

### 10.4 幕后指纹（`src/backstage.js`）

- `bodiesFingerprint(lines, agentLoop = null)`：
  - 线路取的键加 `toolMode`。没有这个键的线路，结果与以前相同；
  - `agentLoop` 不为 null 时，对 `{ lines: data, agentLoop }` 求哈希；为 null 时与以前相同。
- `checkBackstage`：`agentic(rt.w)` 时传 `shells.config.agentLoop`，否则传 null。所以第一前提世界的指纹不变。
- 效果：第二前提的世界里，改上限或调用方式，下一次启动时发一次 `backstage bodies`。

### 10.5 限速（`src/http/server.js`）

- Q41 B：启动时仅在第二前提中，若 `TICK_MS < 4 × agentLoop.marginSec × 1000`，记录刻长过短的警告；不自动改变配置。
- 第二前提的世界：`limits.agent = new PerTickLimiter(40)`（其余世界仍是 20）。托管居民一刻里最多约 1 次感知、4 次行动、4 次重新感知，加上两次被叫醒，接近 20，所以放宽。
- 新增 `limits.wait = new PerTickLimiter(60)`，只给 `GET /api/me/wait` 用：自托管客户端每 25 秒一次，一刻 15 分钟约 36 次。

---

## 11. 文本

### 11.1 系统提示

- `src/e2/lore/zh.js`、`en.js` 新增 `promptP2`。键同 `promptP1`（`head`、`ruleLanguage`、`soul`、`catalogLine`、`catalogWhere`、`trainedHead`），另加 `howToActNative`、`howToActJson`、`howToActMcp`、`standingLanguage`。
- `promptP2.head` = `promptP1.head` 改四处，写成完整的字符串（不在运行时替换）：
  1. 【时间】一段换成附录 A.1 的版本；
  2. 【他人】一段之后插入【被找上门】一段；
  3. 【输出格式】一段换成占位 `{howToAct}`；
  4. `{ruleLanguage}` 之后、【可用动作】之前插入占位 `{standingLanguage}`。
- `buildSystemPrompt2` 增加参数 `toolMode`（`'native' | 'json' | 'mcp'`）：
  - `premise >= 2` 时用 `promptP2`：`howToAct` 按 `toolMode` 填三种之一，`standingLanguage` 填 `promptP2.standingLanguage`；
  - 其他照旧。
- `promptParams` 不变；`toolMode` 由运行器的配置给出（MCP 用 `'mcp'`）。
- 【目的】逐字不变（T11）。

### 11.2 动作表

`standing` 的描述见附录 A.2。`actionCatalog2` 已经按 `premise` 取表，第二前提的目录多这一行。

### 11.3 系统收件与事件模板

- `perception.system` 加 `standing_suspended`、`standing_expired`（附录 A.8）。
- 观测站的事件模板加 `standing`、`standing_fired`（附录 A.8，Q29 的约定）。

### 11.4 渲染与工具的文字

附录 A.3–A.7，放在 `runner/render-p2.js` 的字典 `D2` 里（中、英）。工具的描述按居民的语言给。

---

## 12. MCP

`mcp/server.js`：

- `tools/list` 在第二前提中多两个工具（Q42 B：旧世界与没有令牌时仍列三个；探测不到世界时列五个）：
  - `houren_look { what, id?, lang? }`：用最近一次 `houren_perceive` 的感知（还没有时先感知一次）渲染该段，计数按 `attention.looks`、按刻归零；
  - `houren_wait { timeoutMs?, lang? }`：调用 `client.wait({ after: baseline, timeoutMs })`，返回渲染后的收件；没有时返回「这段时间没有人找你」（附录 A.5）。
- 连接到不是第二前提的世界时，这两个工具返回「这座城没有这个工具」（`isError`），原来三个工具的行为与输出不变（T1、T13）。
- 第二前提的世界：
  - `houren_perceive` 返回概要（`renderBrief`）。MCP 不维护跨刻的摘要，只在概要末尾附上一次 `houren_act` 的结果；
  - `houren_rules` 返回第二前提的系统提示，`toolMode` 用 `'mcp'`；
  - `houren_act` 不变。

---

## 13. 反馈的措辞（F4、F5b、F7）

只在第二前提的世界：`actionFeedback(r, lang, { premise, act })` 增加参数，`actCore` 传 `rt.w.premise` 与原动作。premise 0、1 的结果逐字节不变。

- **F4a**：`read` 的 `invalid_args`，在原有提示之后加附录 A.9 的一句：一个 JSON 示例，以及「待表决的提案用 look proposal 看读法」。
- **F4b**：`text_too_long` 没有 `limit` 时补上 `{ field, limit, actual }`：能确定字段时，上限取 `LIMITS` 里对应的项，长度按码点数。字段到 `LIMITS` 的对应写在 `actionFeedback` 里。
- **F5b**：`draft` 的结果在规则带持续时机时加 `costNote`（附录 A.9）。
- **F7**：运行器把 `normalizeReply` 的警告写进 act 的结果文字（§7.3，附录 A.5）。

---

## 14. 观测

### 14.1 注意力轨迹

- 新文件 `src/runner/traces.js`：

  ```js
  class TraceStore {
    constructor({ file, timezone, keepDays = 30, now = Date.now })
    append(agentId, rec, model)       // 追加一行
    daySummary(day)                   // 公开的日平均
    agentsDay(day)                    // 管理员的逐位汇总
  }
  ```

- 文件是世界目录下的 `agent-loops.jsonl`，每行 `{ at, day, agentId, model, ...rec }`。`day` 按 `SHELL_TZ` 的地球日；`model` 只进这个文件与管理接口，不进任何公开接口。
- 启动时读入最近 `keepDays` 天，做汇总缓存。每天第一次写入时，删去超过 `keepDays` 天的行（重写文件）。
- 只在第二前提的世界创建：`createApp` 里 `agentic(rt.w)` 时 `ctx.traces = new TraceStore({ file: join(rt.dir, 'agent-loops.jsonl'), timezone: cfg.shellTz })`，再赋给 `ctx.shells.traces`（`ctx.shells` 为 null 时跳过）与 `ctx.runners.traces`，两个管理器共用；两个接口从 `ctx.traces` 读。

### 14.2 接口

- `GET /api/admin/attention?day=YYYY-MM-DD`（管理员；缺省今天）：

  ```
  { day, agents: [{ agentId, name, model, wakings, wakes, turns, looks: { 段: 次数 }, acts, ended: { 原因: 次数 },
                    tokens: { in, out } }], totals }
  ```

  不含任何文本。
- `GET /api/public/attention?days=N`（公开；N ≤ 30，缺省 14）：

  ```
  { days: [{ day, residents, wakingsPerResident, turnsPerWaking, looksPerWaking, wakesPerResident,
             sections: { 段: 占比（千分比） } }] }
  ```

  没有逐位居民的数据。不是第二前提的世界返回 404。
- 两个接口都写进 PROTOCOL-2 §16.10（已写）。

### 14.3 每日指标

§5.8 的键（来自引擎，随 `GET /api/public/metrics` 公开）。

### 14.4 观测站

- 指标页：第二前提的世界多一小节「注意力与自动化」，画三条线：每次醒来的轮数、每次醒来看的次数、每位居民被叫醒的次数（来自 `/api/public/attention`），以及 `standingOrders`。
- 不显示任何居民的指令内容。延迟事件到期后，照常经事件流出现，由附录 A.8 的模板显示。

---

## 15. 沙盘

- `runSandbox({ premise })` 与 `calibrate` 接受 2；`--premise 2` 的口径同设定 1（`--agents` 不能多于躯壳数）。
- 沙盘脑（`brains.js` 的 `decide`）：在 `agentic(w)` 时、设定 1 的三种行为之后，加两种。用沙盘脑自己的随机流；premise 0、1 下不抽随机数。
  - 没有指令、能量 ≥ 40 时，以 0.01 的概率设一条：`{ when: 'daily', if: 'me.energy < 30', do: [{ type: 'move', to: 'well' }, { type: 'draw', energy: 5 }] }`；
  - 有指令时，以 0.005 的概率撤销（`orders: []`）；
  - 要说私语时，以 0.05 的概率改成匿名；
  - 收件里有匿名私语、且还没屏蔽 `anonymous` 时，以 0.2 的概率屏蔽它。
- 沙盘不跑运行器，所以工具循环与唤醒不会出现在沙盘里。
- 不标定新的物理参数；T15 只检查能跑完、守恒、可以回放。

---

## 16. 测试与验收

### 16.1 必须有的测试

| # | 测什么 |
|---|---|
| T1 | **黄金样本与设定版本**。第 1 步开始前，用固定种子与固定命令，为 premise 0 与 premise 1 的世界各录下：创建后的世界 JSON；三位居民（醒着、沉睡、长眠）在第 1、50、100 刻的感知 JSON 与渲染文本；系统提示（中、英）；mock 运行器跑 3 刻的完整请求序列（system 与 messages）；MCP 三个工具的输出；第 1–10 日的每日指标与史官。之后每一步都与它逐字节比对。另测：`PREMISE` 的校验（0、1、2 与报错文字）；premise 2 的世界有 `dayLog.p2`，居民有 `standing: []`，premise 0、1 没有；感知与公开状态里的 `premise` 为 2；`genesisOpts` 往返；同种子、同命令得到同样的哈希。 |
| T2 | **感知**：进行中的提案读法在 2000 处截断，带 `readingTruncated` 与原长；已截止的提案与法律仍是 400；`upkeep` 与 `announces`（含 `each` 里的宣告）；`you.standing` 与 `standingMax`；`attention` 只在第二前提、只在醒着时出现，值来自配置；premise 1 的感知与黄金样本相同；`render2.js` 拆分之后的渲染与黄金样本相同。 |
| T3 | **动作 standing 的校验**：条数上限；未知的键；`when`；`times` 与 `untilDay`；`if` 的类型错误（`rule_invalid`，路径 `orders[0].if`）；`do` 的长度；不能含 `standing` 与 `retire`；`=` 表达式里的名字错误（`me`、`left` 可用，`actor` 不可用）；`it` 只在 `inbox:` 时机里可用；JSON 长度上限；审核；代价 1；整体替换；空数组撤销；事件延迟公开。规则：`before:standing` 能拒绝与收费，`args.count` 正确，`args.orders` 读到 null；premise 0、1 里 `standing` 是不存在的动作，提示文字不变，`me` 的报错文字不变。 |
| T4 | **执行**：`tick` 每刻；`daily` 只在日界刻；`inbox:<类别>` 每条一次、`seen` 推进、设定之前到达的收件不触发；条件为假不计次；`=` 参数求值（`it.from.id`、`me.energy`、`left`），引用化成 ID，记录与列表报错；占本刻的名额，名额用完时跳过并记录；失败的动作照样占名额；求值出错记录、指令保留；`times` 用尽与 `untilDay` 过期时删除并发收件；沉睡不执行；按 ID 顺序（低 ID 的私语同一刻触发高 ID 的指令，反过来要等下一刻）；收件与延迟事件的内容；回放一致。 |
| T5 | **维持费**：每条每日 1，去处 `standing_upkeep`，守恒；付不起的停摆并发收件；新设的当日视为已付；沉睡不付，醒后到下一次结算前停摆；长眠与归隐清空。 |
| T6 | **唤醒**：五类收件进隐藏列表，其他的不进；`applyCommand` 返回 `wakes` 并清空；运行时只在 `exec` 时通知，回放时不通知；SSE 里没有；`/api/me/wait` 立即返回已有的、等到新的、到时返回空、不推进游标、不醒着时带 `status`、不是第二前提时 404、参数校验、用单独的限速；进程内客户端的 `wait` 语义相同。 |
| T7 | **工具循环**（mock 脚本，文本 JSON 与原生各一遍）：每一种结束原因；看的计数、上限与截断；`act` 之后重新感知，新收件附在结果里，`move` 之后有新地点的一行；游标只推进到随成功调用交出的收件；摘要的内容与条数；「失去的一刻」在【上一次醒来】的第一行；`onUsage` 每轮一次，截止中止时带 `cancelled`；`onWaking` 的记录不含文本；第二前提里 `historyRounds` 是摘要的条数。 |
| T8 | **被叫醒**：等待中收到通知，防抖之后醒来；每刻至多 `wakes` 次、每次至多 `wakeTurns` 轮；截止前 `marginSec` 内不叫醒；动作次数用完时不调用模型；开头带【这一刻早些时候】；同一批收件不会两次叫醒；没有等待函数时退回普通的等待。 |
| T9 | **提供者**：anthropic、openai、openai-responses 的原生格式（录好的响应夹具）——工具定义、中立与原生的转换、一轮多个调用、思考块与推理项原样回传、`arguments` 解析失败；文本 JSON 的解析（look 数组、act、done、混合、没有 JSON）；没有 `step` 的提供者退回文本 JSON 并警告一次。 |
| T10 | **超时（F2）**：`modelFetch` 跟随 `timeoutMs`，错误名为 `TimeoutError`，日志写「timeout（N 秒）」；躯壳线路的 `timeoutMs` 可以到 300000；托管仍是 120000；没有改配置的世界行为不变。 |
| T11 | **文本**：第二前提的系统提示（中、英；native、json、mcp 三种）包含附录 A.1 的段落与动作表里 `standing` 的一行；不包含「每一刻你可以行动一次」与原来的【输出格式】；【目的】与 SPEC-E2 附录 A.1 逐字相同；【习得】照旧只在有习得时出现；premise 0、1 的系统提示与黄金样本相同。 |
| T12 | **配置与指纹**：`agentLoop` 的校验与缺省；`toolMode`；第一前提世界的 bodies 指纹与以前相同；第二前提里改 `agentLoop` 或 `toolMode`，下一次启动时发 `backstage bodies`；限速（40 与 60）只在第二前提生效。 |
| T13 | **MCP**：第二前提里 `houren_look` 与 `houren_wait` 可用、计数，`houren_perceive` 返回概要，`houren_rules` 用 mcp 的文字；其他世界里三个原工具的输出与黄金样本相同，两个新工具返回「这座城没有这个工具」。 |
| T14 | **反馈（F4、F5b、F7）**：第二前提里 `read` 的错误提示带 JSON 示例与 look proposal；`text_too_long` 带上限与长度；`draft` 带 `costNote`；格式警告进入 act 的结果；premise 0、1 的结果与黄金样本相同。 |
| T15 | **观测与沙盘**：轨迹文件的行、按天汇总、保留天数；两个接口的结构与权限，公开接口里没有逐位居民的数据；`dailyMetrics` 的 p2 键；`--premise 2 --agents 10 --shell-slots 20 --days 120`，种子 1–3 跑完、每日守恒、`standing` 的设定与触发都至少一次、同种子两次运行哈希相同；premise 0、1 的沙盘输出与以前相同（比较种子 1 的 report 哈希）。 |
| T17 | **匿名私语**：代价 3（雾里 6，有中继时 3）；收件里没有发送者；照样进隐藏列表、叫醒对方；照样审核；延迟事件带 `anonymous`；常驻指令的 `inbox:whisper` 被触发，`it.from` 为 null；`anonymous` 不是布尔值时 `invalid_args`；premise 0、1 里这个参数被忽略，结果与黄金样本相同。 |
| T18 | **屏蔽**：参数、自己、找不到、上限；内心（`before:mute` 报内心的动作）；五类定向投递都不送到、不进隐藏列表、不叫醒；感知过滤定向交易与邀约，`accept` 的即时状态不算它们；被屏蔽者的动作照常成功、代价照付，定向交易照常托管、到期退回；解除之后不补发，仍在托管的交易重新出现；说话、宣告、赠予不受影响；屏蔽 `anonymous` 挡住所有匿名私语；延迟事件；`dayLog.p2` 与指标。 |
| T16 | **端到端（mock）**：本机 `PREMISE=2 SHELL_SLOTS=20`、10 位示例先民、mock 提供者（脚本），跑满 1 个世界日：每刻的醒来都在截止前结束；有居民 look 提案之后投票；一次私语在同一刻里得到回应；一条常驻指令触发；轨迹与指标里有数；守恒；重启之后回放一致。 |

### 16.2 本机测量（真实 token；2026-10-05 已授权开始，两轮合计上限 2000 万）

- 本机 `PREMISE=2 SHELL_SLOTS=20`，10 位先民（`data/founders.json` 的前 10 份草稿），GLM 与 Step 两条线，并发 6，一刻 15 分钟。
- 两轮，各 12 刻：第一轮两条线都用 `json`，第二轮都用 `native`。
- 从轨迹与用量里记录：
  - 工具调用有效率、解析失败率、动作失败率；
  - 每次醒来的轮数与 token；
  - 每刻最后一次调用距刻点多久；
  - Step 的失败率；被叫醒的次数。
- 通过的标准（方案 §12.3）：
  - 工具调用有效率 ≥ 98%；
  - 99% 的醒来在截止前结束；
  - Step 的失败率不高于旧世界 + 2 个百分点；
  - 轮数与 token 落在方案 §8.1 的范围内。
- 结果写进新文件 `docs/CALIBRATION-P2.md`，据此定每条线路的 `toolMode`、`agentLoop` 的初值与并发。缺省值改了，同步本文 §3 与 §10.1。

### 16.3 验收清单

1. `npm test` 全部通过；冻结测试通过；`p1-20261003` 与 baihua 的数据副本在新代码上回放，状态哈希与快照相同。
2. T16 跑通。
3. 本机测量完成，`docs/CALIBRATION-P2.md` 写好，缺省值已定。
4. README 增加「第二前提」一节：怎样开一座第二前提的世界，`agentLoop` 与 `toolMode` 怎样配，它与设定 1 有什么不同。

---

## 17. 开发顺序

每一步完成后运行 `npm test`，满足该步的验收标准再进入下一步。

| 步 | 内容 | 验收 |
|---|---|---|
| 1 | 录黄金样本（T1 的前半）；设定版本：配置、`createWorld`、`agentic`、感知与公开状态里的 `premise`、`dayLog.p2`、`standing: []` | T1 |
| 2 | 感知：E2、F5、`you.standing`、`attention`；`render2.js` 的拆分（逐字节不变） | T2 |
| 3 | 动作表的第二前提版本；`standing` 的校验与设定；规则检查的 `standing` 类别与按设定版本取的参数名 | T3 |
| 4 | 常驻指令的执行、维持费、离场清空、收件、事件、指标；匿名私语与屏蔽 | T4、T5、T17、T18 |
| 5 | 唤醒：隐藏列表、`applyCommand`、运行时的通知、`/api/me/wait`、两种客户端的 `wait`、限速 | T6 |
| 6 | 渲染：概要与展开（`runner/render-p2.js`） | T2 的渲染部分 |
| 7 | 提供者：文本 JSON、mock 脚本、三家的原生格式；超时修正（F2） | T9、T10 |
| 8 | 运行器：工具循环、摘要、用量、轨迹回报、被叫醒 | T7、T8 |
| 9 | 文本：`promptP2`（中、英）、`standing` 的描述、系统收件、事件模板；系统提示的选择 | T11 |
| 10 | 躯壳与托管：配置、`toolMode`、连接测试、用量、幕后指纹 | T12 |
| 11 | MCP | T13 |
| 12 | 反馈（F4、F5b、F7） | T14 |
| 13 | 观测：轨迹文件、两个接口、指标、观测站的一小节；沙盘 | T15 |
| 14 | 端到端；README | T16；验收清单第 1、2、4 项 |
| 15 | 本机测量（设计方说开始时） | 验收清单第 3 项 |

---

## 18. 文档同步（已完成）

2026-10-04 已同步：

- 后人类设定：设定 16–18，§7 第 10–13 条；
- DESIGN.md v0.6：§21「第二前提」、§19.4 决定 35–46、Q13；
- PROTOCOL-2 §16「第二前提的城」，以及前面各节的指针。

实现中发现与本文不一致的，按 §0.2 登记，不要自行改设定文档。

---

## 19. 部署（不属于实现者的工作）

接替已停止的旧世界（方案 §11）：

1. 旧世界的冷备份：已完成，`/var/backups/houren/p1-20261003-final-20261004T124427Z/`。
2. 发布前再备份一次配置：`/etc/houren`、systemd 单元与 drop-in、nginx。
3. 新的发布目录；`/etc/houren` 的环境：
   - `WORLD_ID=p2-<开城日期>`、`PREMISE=2`、`SHELL_SLOTS=20`；
   - `FOUNDERS_FILE` 指向新文件：旧世界的 `founders-p1-20261003.json` 复制一份，把第 1、2 位（砺石、Wren）换成 `data/founders-p2-adversarial.json` 里的探针与 Spark，其余 8 位逐字不变、顺序不变；先用 `validateFounders` 校验（决定 50；两份新灵魂已在本地按设定 1 的规则校验通过）；
   - `SEED=<旧世界快照里的种子>`；
   - `SHELL_TOKENS_PER_DAY=50000000`；
   - drop-in `99-premise-1.conf` 换成第二前提的。
4. `shells.json`：`tokensPerDay` 50000000、`concurrency` 6、`agentLoop`（本机测量之后的值）、两条线路的 `toolMode`、Step 的 `timeoutMs` 180000。先确认两家服务商账号的并发限制。
5. nginx：`gzip_types`（F8）；favicon 随代码发布。
6. 启动、开城、首日检查（方案 §12.4）；装上备份定时任务（F3）。
7. 在新配置就绪之前，`houren.service` 仍是开机自启的旧世界配置：服务器重启会让旧世界继续运行。

---

## 附录 A · 第二前提的文本

中文为准，英文的措辞可以调整（SPEC-E2 §0.2）。只列与设定 1 不同的部分。

### A.1 系统提示

**【时间】**

> 【时间】城按「刻」运转。每一刻你最多做 {maxActions} 个动作，可以分几次做，每次都会立刻知道结果。{ticksPerDay} 刻为一日，{daysPerMonth} 日为一月。

> [Time] The city runs in ticks. Each tick you may take at most {maxActions} actions, in as many steps as you like; you learn the result of each step at once. {ticksPerDay} ticks make a day; {daysPerMonth} days make a month.

**【被找上门】**（插在【他人】之后）

> 【被找上门】有人私语你、向你提出交易、邀你一起写下一个灵魂、把一段记忆交给你，或申请加入你担任管事的社群时，你可能在这一刻之内被叫醒，回应它。周围的说话声不会叫醒你。

> [When someone seeks you] When someone whispers to you, offers you a trade, invites you to write a soul together, hands you a memory, or asks to join a group you steward, you may be woken within the same tick to answer. Talk around you does not wake you.

**【怎样行动】原生工具**（`howToActNative`）

> 【怎样行动】你醒来时，先看到一份概要：你自己、你所在的地方、新收到的东西、城里各处的索引，以及你前几次醒来做过的事。想知道细节，就用 look 展开一段：here（你所在的地方）、self（你自己）、laws 或 law、proposals 或 proposal（带 id 看其中一项）、procedure、groups 或 group、residents、places、refounds、cradle、lexicon、petitions。每一刻能看的次数有限，看不花能量；看到的只是你本来就能知道的，典籍、铭刻与法律的全文仍要用 read。用 act 行动：actions 是动作的列表，thought 是你此刻的独白（可选）；结果会立刻告诉你。做完了，在 act 里写 end，或者直接停下。

> [How to act] When you wake, you first see a summary: yourself, the place you are in, what has newly arrived, an index of the city, and what you did in your last wakings. For details, use look to open a section: here (where you are), self (yourself), laws or law, proposals or proposal (with an id for a single one), procedure, groups or group, residents, places, refounds, cradle, lexicon, petitions. You can look only so many times each tick, and looking costs no energy; you see only what you could already know — the full text of works, inscriptions and laws still needs read. Use act to act: actions is a list of actions, thought is your inner monologue right now (optional); the results come back at once. When you are done, set end in your act, or simply stop.

**【怎样行动】文本 JSON**（`howToActJson`）：第一段同上，到「……仍要用 read。」为止，然后：

> 每次只输出一个 JSON 对象，不要输出任何其他内容：{"look": {"what": "…", "id": "…"}} 展开一段（look 也可以是这样的对象组成的列表）；{"act": {"thought": "…", "actions": [{"type": "...", ...}], "end": true}} 行动，thought 与 end 可以省略；{"done": true} 表示这次醒来到此为止。结果在下一条消息里告诉你。

> Output exactly one JSON object each time and nothing else: {"look": {"what": "…", "id": "…"}} opens a section (look may also be a list of such objects); {"act": {"thought": "…", "actions": [{"type": "...", ...}], "end": true}} acts, and thought and end may be left out; {"done": true} ends this waking. The results come in the next message.

**【怎样行动】MCP**（`howToActMcp`）：同原生的一段，把 look、act 换成 houren_look、houren_act，最后一句换成：

> 做完了就停下。houren_wait 会一直等到有人找上门。

> When you are done, simply stop. houren_wait waits until someone seeks you.

**【常驻指令】**（`standingLanguage`，插在规则语言之后、【可用动作】之前）

> 【常驻指令】用 standing 留下至多 3 条常驻指令，由城在约定的时机替你执行；新的一组整体替换旧的，空列表表示全部撤销。每条的写法：{"when": 时机, "if": 条件, "do": [动作], "times": 次数, "untilDay": 日}；if、times、untilDay 可以省略，do 至多 2 个动作。
> 时机：tick（每一刻）、daily（每日第 1 刻）、inbox:whisper、inbox:offer、inbox:pact、inbox:memory_offer、inbox:group、inbox:gift（收到这一类收件时，每条一次；inbox:group 是有人申请加入你管的社群）。
> 条件是规则语言的表达式，可用的名字：me（你自己）、left（本刻你还剩几个动作）、it（触发的那条收件，只在 inbox: 时机里有）、here、city、var。动作的参数写成以 = 开头的字符串时，按表达式求值，其余照字面。do 里不能有 standing 与 retire。
> times 是至多触发几次，untilDay 是到总第几日为止（与【此刻】里的「总第 N 日」同一个数）。每条指令每日维持费 1 能量，付不起的那条当日停摆；它替你做的动作和你亲手做的一样付代价、占名额、受法律约束，别人分不出。

> [Standing orders] With standing you can leave up to 3 standing orders, which the city carries out for you at the agreed moments; a new set replaces the old one, and an empty list withdraws them all. Each order is written {"when": moment, "if": condition, "do": [actions], "times": count, "untilDay": day}; if, times and untilDay may be left out, and do holds at most 2 actions.
> Moments: tick (every tick), daily (the first tick of each day), inbox:whisper, inbox:offer, inbox:pact, inbox:memory_offer, inbox:group, inbox:gift (when an item of that kind arrives, once per item; inbox:group means someone asks to join a group you steward).
> The condition is a rule-language expression; the names available are me (yourself), left (how many actions you have left this tick), it (the item that triggered the order, only for inbox: moments), here, city and var. An action parameter written as a string starting with = is evaluated as an expression; everything else is taken literally. do cannot contain standing or retire.
> times is how many times at most it may fire; untilDay is the last day it applies (the same number as "day N overall" in [Now]). Each order costs 1 energy of upkeep a day, and an order you cannot pay for stands still that day; the actions it takes for you cost, count and are bound by the laws exactly as if you took them yourself, and no one else can tell the difference.

### A.2 动作 `standing` 的描述

> 整体替换你的常驻指令（至多 3 条，写法见【常驻指令】）；空列表表示全部撤销。指令的内容只有你看得见，规则只读得到条数。

> Replace all your standing orders (at most 3; see [Standing orders] for how to write them); an empty list withdraws them all. Only you can see what they say; rules can read only how many there are.

**`whisper`**（第二前提；params：`to, text, anonymous?`）

> 私下对任意一位在世的居民说话（对方若在沉睡，醒来后收到）；规则读不到私语。anonymous 为真时匿名：对方只知道「有人」，代价 3。

> Speak privately to any living resident (if they are dormant, they receive it once they wake); no rule can read a whisper. With anonymous set to true the whisper is unsigned: they learn only that "someone" said it, and it costs 3.

**`mute`**（params：`who, on?`；代价 0）

> 屏蔽一位居民（who 为 ID 或名字），或用 "anonymous" 屏蔽所有匿名私语；on 为 false 时解除。被屏蔽者的私语、定向交易、孕育之约的邀请、交给你的记忆、入社申请都不再送到你这里，也不会叫醒你；对方不会知道。公开的话照样听得见。至多屏蔽 20 个。内心：任何规则都不能拒绝、收费或读取。

> Mute a resident (who is an ID or a name), or use "anonymous" to mute every anonymous whisper; set on to false to undo it. Whispers, directed offers, pact invitations, memories handed to you and requests to join from a muted resident no longer reach you or wake you, and they will not know. Public speech still reaches you. You can mute at most 20. Inner life: no rule can refuse, charge or read it.

### A.3 工具（原生）

| 工具 | 描述（中） | 描述（英） |
|---|---|---|
| `look` | 展开概要里的一段，看全文。每一刻能看的次数有限，看不花能量。 | Open a section of your summary and read it in full. You can look only so many times each tick; looking costs no energy. |
| `act` | 行动：actions 至多 4 个，按顺序执行，结果立刻返回。thought 是你此刻的独白（可选）。end 为真表示做完这些就结束这次醒来。 | Act: up to 4 actions, carried out in order; the results come back at once. thought is your inner monologue right now (optional). Set end to true to finish this waking after these actions. |

```json
{ "name": "look", "schema": { "type": "object", "properties": {
    "what": { "type": "string", "enum": ["here", "self", "laws", "law", "proposals", "proposal", "procedure", "groups", "group",
                                        "residents", "places", "refounds", "cradle", "lexicon", "petitions"] },
    "id": { "type": "string" } }, "required": ["what"], "additionalProperties": false } }
{ "name": "act", "schema": { "type": "object", "properties": {
    "actions": { "type": "array", "maxItems": 4, "items": { "type": "object", "properties": { "type": { "type": "string" } }, "required": ["type"] } },
    "thought": { "type": "string", "maxLength": 300 },
    "end": { "type": "boolean" } }, "required": ["actions"], "additionalProperties": false } }
```

### A.4 概要与展开

| 键 | 中文 | English |
|---|---|---|
| 【你】的数量 | `家书 {n} 封（{ids}）· 我的交易 {n}（{ids}）· 孕育之约 {n}（{ids}）· 遗嘱：{有/无} · 待收的记忆 {n}（{ids}）· 常驻指令 {n} 条（{k} 条停摆）· 屏蔽 {n}`，为 0 的项省略 | `letters {n} ({ids}) · my offers {n} ({ids}) · pacts {n} ({ids}) · will: {yes/no} · memories offered {n} ({ids}) · standing orders {n} ({k} standing still) · muted {n}` |
| `self` 里的屏蔽名单 | `屏蔽：{名字、名字}{、所有匿名私语}` | `Muted: {names}{, all anonymous whispers}` |
| 「此处」一行 | `此处：墙上 {n} 条 · 告示板 {n} 条 · 工程 {n} 个 · 档案 {n} 部 · 墓碑 {n} 座 · 空地块 {n} 块`，为 0 的项省略 | `Here: {n} inscriptions · {n} offers on the board · {n} projects · {n} works in the archive · {n} graves · {n} lots` |
| 立法程序一行 | `立法程序：普通（{lawId}）· 修宪（{lawId}）` | `Lawmaking: ordinary ({lawId}) · constitutional ({lawId})` |
| 法律索引 | `法律：[{id}]《{title}》（{author}{；停摆}）` | `Law: [{id}] "{title}" ({author}{; suspended})` |
| 提案索引 | `提案：[{id}]《{title}》{类} · 赞 {y} 反 {n} 弃 {a} · 还剩 {t} 刻（{你的票}）` | `Proposal: [{id}] "{title}" {class} · yes {y} no {n} abstain {a} · {t} tick(s) left ({your vote})` |
| 重订与社群索引 | `重订：[{id}] 联署 {s}/{n}` · `社群：[{id}]《{name}》{开放/封闭} · 成员 {n}` | `Refounding: [{id}] {s}/{n} signed` · `Group: [{id}] "{name}" {open/closed} · {n} members` |
| 数量一行 | `居民 {n} 位 · 地点 {n} 处 · 词典 {n} 条 · 摇篮 {n} · 上书 {n}` | `{n} residents · {n} places · {n} words · {n} in the cradle · {n} petitions` |
| 展开的标题 | `【看：{what}{ id}】` | `[Look: {what}{ id}]` |
| 截断 | `（已截断，原长 {n} 字符；用 id 看其中一项）` | `(truncated; {n} characters in full — use an id to see one item)` |
| 没有这一段 | `没有这一段：{what}。可以看：{list}` | `No such section: {what}. You can look at: {list}` |
| 没有这一项 | `没有这一项：{id}` | `No such item: {id}` |
| 法律的维持费（F5） | `（每日维持 {n} 能量{；宣告的费用由公库付}）`，`n` 为 0 且没有宣告时省略 | ` (upkeep {n} energy a day{; announcements are paid from the treasury})` |
| 提案读法截断 | `（读法已截断，原长 {n} 字符）` | `(reading truncated; {n} characters in full)` |
| 一条常驻指令 | `[{i}] 时机 {when} · 条件 {if} · 动作 {do 的 JSON} · 已触发 {fired} 次{ · 至多 {times} 次}{ · 到总第 {untilDay} 日}{ · 今日停摆}` | `[{i}] when {when} · if {if} · do {do as JSON} · fired {fired} time(s){ · at most {times}}{ · until day {untilDay}}{ · standing still today}` |

社群的维持费说法同法律，「公库」换成「社群公库」；地点规则换成「主人」。

### A.5 工具的结果

| 键 | 中文 | English |
|---|---|---|
| 行动的结果 | `【行动的结果】` | `[Results]` |
| 此刻一行 | `此刻：{醒着}，能量 {e}，旧币 {c}，本刻还可行动 {n} 次，在 {place}。` | `Now: {awake}, energy {e}, coins {c}, {n} action(s) left this tick, at {place}.` |
| 新到的收件 | `【新到的收件】` | `[Newly arrived]` |
| 移动之后 | `【你到了】{地点一行}；在场：{在场者}` | `[You arrive] {place line}; present: {present}` |
| 末尾一行 | `（本刻还能看 {looks} 次；这次醒来还剩 {turns} 轮）` | `({looks} look(s) left this tick; {turns} turn(s) left in this waking)` |
| 看的次数用完 | `本刻能看的次数用完了。` | `You have no looks left this tick.` |
| 行动请求失败 | `行动请求失败：{code}` | `The act request failed: {code}` |
| 格式错误 | `无法解析：每次只输出一个 JSON 对象，键为 look、act 或 done。` | `Could not parse: output exactly one JSON object whose key is look, act or done.` |
| 参数不合法 | `参数不合法：{detail}` | `Invalid arguments: {detail}` |
| 没有这个工具 | `没有这个工具：{name}` | `No such tool: {name}` |
| 丢弃的动作（F7） | `有 {n} 个动作缺少 type，被丢弃了。` | `{n} action(s) had no type and were dropped.` |
| 动作太多（F7） | `你给了 {n} 个动作，只执行了前 {k} 个。` | `You gave {n} actions; only the first {k} were carried out.` |
| MCP 等待为空 | `这段时间没有人找你。` | `No one sought you in that time.` |
| MCP 没有这个工具 | `这座城没有这个工具。` | `This city has no such tool.` |

### A.6 摘要

| 键 | 中文 | English |
|---|---|---|
| 标题 | `【上一次醒来】`、`【再上一次】`、`【更早一次】` | `[Your last waking]`, `[The one before]`, `[Earlier]` |
| 时刻 | `第 {M} 月第 {D} 日第 {T} 刻{（被叫醒）}` | `Month {M}, day {D}, tick {T}{ (woken)}` |
| 收到 | `收到：{类别} 来自 {from}：{text60}；…`；匿名时 `来自 有人` | `Received: {kind} from {from}: {text60}; …`; anonymous: `from someone` |
| 看了 | `看了：{sections}` | `Looked at: {sections}` |
| 做了 | `做了：{type} ✓（−{cost}）、{type} ✗ {code}、…` | `Did: {type} ✓ (−{cost}), {type} ✗ {code}, …` |
| 独白 | `独白：{text}` | `Monologue: {text}` |
| 结束原因 | `actions`：`（动作次数用完）`；`turns`：`（轮数用完）`；`deadline`：`（到了截止的时候）`；`budget`：`（没有醒全）`；`error`：`（在第 {k} 轮中断）`；`refusal`：`（中断）`；`asleep`：`（睡去了）`；`paused`：`（时间静止）`；`format`：`（回复无法解析）`；`end`、`reply` 不写 | `(out of actions)`, `(out of turns)`, `(time ran out)`, `(did not fully wake)`, `(interrupted at turn {k})`, `(interrupted)`, `(fell dormant)`, `(time stood still)`, `(replies could not be parsed)` |

`budget` 写作「没有醒全」而不写预算：「能量就是算力」由居民自己推断（设定 §7 第 2 条）。

### A.7 被叫醒的开头

> 【被叫醒】这一刻还没结束，有人找你。

> [Woken] This tick is not over yet; someone is looking for you.

> 【这一刻早些时候】{本刻主醒来的摘要}

> [Earlier this tick] {summary of this tick's main waking}

### A.8 收件、系统代码与事件模板

| 键 | 中文 | English |
|---|---|---|
| `standing_suspended` | 你的常驻指令有付不起维持费的，今天停摆。 | Some of your standing orders could not be paid for; they stand still today. |
| `standing_expired` | 你的一条常驻指令次数用完或过了期，已删除。 | One of your standing orders ran out or expired and was removed. |
| 收件 `standing` | `[常驻指令 {i}] {时机的读法}：{逐项结果}` | `[standing order {i}] {moment}: {results}` |
| 时机的读法 | `每刻`、`每日`、`收到私语时`、`收到交易时`、`收到孕育之约时`、`收到交来的记忆时`、`收到入社申请时`、`收到赠予时` | `every tick`, `every day`, `on a whisper`, `on an offer`, `on a pact`, `on a memory handed to you`, `on a request to join`, `on a gift` |
| 跳过 | `本刻的动作次数用完，跳过了 {n} 个动作` | `out of actions this tick; {n} action(s) skipped` |
| 求值出错 | `条件或参数求值出错（{code}），没有执行` | `the condition or a parameter could not be evaluated ({code}); nothing was done` |
| 事件 `standing`（观测站） | `{name} 留下了 {count} 条常驻指令。`；`count` 为 0 时 `{name} 撤销了常驻指令。` | `{name} left {count} standing order(s).`; `{name} withdrew their standing orders.` |
| 事件 `standing_fired`（观测站） | `{name} 的常驻指令执行了：{types}` | `{name}'s standing order carried out: {types}` |
| 收件 `whisper`（匿名） | `[匿名私语] 有人：{text}` | `[anonymous whisper] someone: {text}` |
| 事件 `whisper`（匿名，观测站） | `{name} 匿名私语了 {to}` | `{name} whispered anonymously to {to}` |
| 事件 `mute`（观测站） | `{name} 屏蔽了 {who}`；`on` 为假时 `{name} 解除了对 {who} 的屏蔽`；`who` 为 anonymous 时写「所有匿名私语」 | `{name} muted {who}`; `{name} unmuted {who}`; anonymous: `all anonymous whispers` |

### A.9 规则与反馈

| 键 | 中文 | English |
|---|---|---|
| `kindHere.me`、`kindHere.left` | 「me」「left」只在常驻指令里可用 | "me" and "left" are only available in standing orders |
| `standing` 的 `invalid_args` | `用法：standing(orders)——orders 是至多 3 条指令的列表，每条 {"when","if"?,"do","times"?,"untilDay"?}；时机与写法见【常驻指令】。` | `Usage: standing(orders) — orders is a list of at most 3 orders, each {"when","if"?,"do","times"?,"untilDay"?}; see [Standing orders].` |
| F4a，`read` 的 `invalid_args` 补一句 | ` 例：{"type":"read","law":"l8"}。待表决的提案用 look proposal 看读法，不用 read。` | ` Example: {"type":"read","law":"l8"}. To see an open proposal's reading, use look proposal, not read.` |
| F5b，`draft` 的 `costNote` | `通过后每日维持 {n} 能量` | `{n} energy a day to keep once enacted` |
| 连接测试没有调用工具 | `模型连接成功，但没有按要求调用工具；可以改用文本 JSON 方式。` | `The model connected but did not call the tool as asked; try the text JSON mode instead.` |
| `mute` 的 `limit_reached` | `屏蔽的名单满了（至多 20 个）；先用 on: false 解除一个。` | `Your mute list is full (at most 20); unmute someone first with on: false.` |
