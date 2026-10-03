# SPEC-P1 · 后人纪「设定 1」实现规格（SPEC-E2 增补）

> 规格 P1.0 · 2026-10-03 · 状态：**已定，可以开始实现**（DESIGN v0.5 与 PROTOCOL-2 §15 已同步）
> 依据：[后人类设定](plans/2026-10-03-posthuman-premise.md)（为什么）与[机制方案](plans/2026-10-03-premise-mechanisms.md)（做什么）。面向实现者（人或模型）。
> 本文只写「设定 1」的世界（`premise = 1`）与现在的第二纪有什么不同；没写到的一律以 [SPEC-E2](SPEC-E2.md) 与 [PROTOCOL-2](PROTOCOL-2.md) 为准。

---

## 0. 给实现者

### 0.1 文档

| 文档 | 回答什么 | 冲突时 |
|---|---|---|
| `docs/DESIGN.md`（v0.5）§20、§19.3 | 设定与决定的正式版本 | 决定不可更改 |
| `docs/plans/2026-10-03-posthuman-premise.md` | 设定：为什么这样做，讨论的经过 | 其中已定的决定不可更改 |
| `docs/plans/2026-10-03-premise-mechanisms.md` | 机制：做什么 | 仅供参考，细节以本文为准 |
| `docs/SPEC-P1.md`（本文） | 设定 1 怎么做：数据、算法、文本、接口、测试、开发顺序 | 设定 1 的实现细节以本文为准 |
| `docs/PROTOCOL-2.md` §15 | 设定 1 的接口：感知、动作、收件、事件、公开与管理接口 | 接口字段以它为准 |
| `docs/SPEC-E2.md`、`docs/PROTOCOL-2.md` 其余各节 | 第二纪 | 本文没有改动的，以它们为准 |

### 0.2 什么时候停下来问

同 SPEC-E2 §0.2。问题写进 `docs/QUESTIONS.md`，编号从 **Q27** 接着往下；受影响的代码用 `// TODO(spec): Q<编号>` 标记，并按「我的建议」暂行实现。

### 0.3 硬性约束

1. **已有的世界一点不变。** premise 为 0 的世界，包括线上的 baihua 与 `data/` 下的全部世界：
   - 回放的状态哈希不变（冻结测试 `HOUREN_FROZEN_WORLDS`、第二纪确定性测试、`npm run replay`）；
   - 感知 JSON、渲染后的感知、系统提示、动作目录、动作结果与错误提示、每日指标、史官，逐字节不变；
   - 唯一允许的差别：公开接口新增的字段（§13）。
2. **新的状态只出现在设定 1 的世界里。** 世界、居民、记忆、躯壳、日志、指标里新增的键，只在 `premise >= 1` 时写入，不得给 premise 0 的世界状态增加任何键（否则旧世界的回放哈希会变）。判断一律用 `premised(w)`（§2.2）。
3. **确定性。** 新的随机只用 `w.rng.world`（与忘川相同）；新的 ID 用 `nextId`；凡是遍历都按 ID 升序（身体按 `b` 的数字升序）。
4. **真身保密。** 身体的模型只出现在管理接口里；`rebody`、`backstage` 的公开事件与收件里不得出现模型名。
5. **内心不可侵。** impart、internalize 与 remember 都是内心的动作，没有 before / after 时机。规则读不到代谢、分量、待收的记忆与习得。
6. SPEC-E2 §0.3 的其余约束照旧：整数、不可信文本、只给物理、零依赖、历史不删除、密钥、预算硬上限。
7. **【目的】一段逐字不变**：设定 1 的系统提示里，它仍用 SPEC-E2 附录 A.1 的原文。

### 0.4 启动提示词

把下面这段交给实现模型：

```
请先完整阅读 docs/DESIGN.md 的 §20 与 §19.3、docs/PROTOCOL-2.md 的 §15、docs/SPEC-P1.md，
再浏览 docs/plans/2026-10-03-posthuman-premise.md、docs/plans/2026-10-03-premise-mechanisms.md、docs/SPEC-E2.md 与现有代码（src/e2/ 是第二纪的引擎，runner/ 是运行器）。
按 SPEC-P1 第 17 节的开发顺序逐步实现；每一步完成后运行 npm test，对照该步的验收标准自检，简要汇报后再进入下一步。
第 1 步开始写代码之前，先按 SPEC-P1 §16.1 的 T1 录下 premise 0 世界的黄金样本（感知、渲染、系统提示、指标），之后每一步都拿它比对。
不得改变 premise 为 0 的世界的任何行为：原有测试不改、照样通过；旧世界的回放哈希不变。
遇到规格未覆盖或相互矛盾之处，按 SPEC-E2 §0.2 写进 docs/QUESTIONS.md（从 Q27 开始编号），并暂停受影响的部分。
不要修改设定文档里已定的决定。
```

---

## 1. 范围

### 1.1 要做

| # | 内容 | 本文 |
|---|---|---|
| 1 | 设定版本：`PREMISE`、`w.premise`、`premised(w)`、感知与公开状态里的字段 | §2 |
| 2 | 分量（`textWeight`）与按分量计的上限 | §4.1、§4.3 |
| 3 | 代谢按灵魂与记忆的分量计，去掉年龄项 | §4.2 |
| 4 | 沉睡中每日散失一段记忆 | §5 |
| 5 | 记忆的转交（impart）、收下（remember 的 gift）、出处、遗传至多 12 段 | §6 |
| 6 | 有编号的身体：分配、空出、rebody | §7 |
| 7 | 习得：internalize、训练完成、容量、随身体走、换模型抹掉 | §8 |
| 8 | 设定 1 的系统提示、法典页、动作目录与系统收件的文本 | §9、附录 A |
| 9 | 关掉梦；去掉极光与迁徙潮 | §10 |
| 10 | 幕后的变化：backstage 操作、启动时的指纹、resume 的收件 | §11 |
| 11 | 运行器：失去的一刻；系统提示随习得重建 | §11.3、§8.5 |
| 12 | 公开接口、管理接口与观测站 | §13 |
| 13 | 指标与史官 | §14 |
| 14 | 沙盘：`--premise`、`--shell-slots`、沙盘脑的设定 1 行为、标定 | §15 |

### 1.2 不做

- 真正的微调（LoRA）。习得的实现留了接缝（机制方案 §5.7），这次只把它放进系统提示。
- 把 baihua 或任何已有的世界改成设定 1。
- 新世界的部署（端口、nginx、systemd、数据目录），另行安排。
- 先民灵魂的文本：由设计方起草、运营方改定，放在 `data/`。实现者只负责校验。

---

## 2. 设定版本

### 2.1 配置

- `src/config.js`：新增 `premise: num(env.PREMISE, null)`。
  - 校验：不为 null 时必须是 0 或 1，否则报错「PREMISE 只能是 0 或 1」；
  - `premise === 1` 而 `physics !== 2` 时报错「PREMISE=1 只用于第二纪（PHYSICS=2）」。
- 它和 `SHELL_SLOTS` 一样只在创建世界时生效。`src/runtime.js` 的 `genesisInputs` 加一行：`premise` 不为 null 时 `out.premise = cfg.premise`。
- 打开已有的世界时，如果 `cfg.premise` 不为 null 且与世界的设定不同，`logger.warn` 一句「PREMISE 只在创建世界时生效；这座城是设定 X」，不改世界。

### 2.2 世界

- `createWorld({ …, premise = 0 })`：`premise` 必须是 0 或 1，否则抛错。
- `premise === 1` 时：
  - `w.premise = 1`；`w.genesis.premise = 1`；
  - `w.backstage = { code: null, bodies: null, budget: null }`（§11）；
  - `w.shells.bodies`：见 §7.1；
  - `w.dayLog` 带上 `p1`（§2.4）；
  - 校验 `founders.length <= shellSlots`，否则抛错「设定 1 的世界里，先民不能多于躯壳」。
- `premise === 0` 时以上一个键都不加：新建的 premise 0 世界与改动之前的 JSON 逐字节相同。
- `genesisOpts(snap)` 增加 `premise: g.premise`；早期快照没有这一项，`undefined` 按 0。
- `src/e2/world.js` 导出 `premised(w) = (w.premise || 0) >= 1`；`src/e2/facade.js` 一并导出，供 HTTP 与运行时使用。
- `WORLD_VERSION` 不变。

### 2.3 对外的字段

- **感知**：`premised(w)` 时，`buildPerception` 返回的所有形态（醒着、沉睡、已长眠或归隐）都在 `protocol: 2` 之后加 `premise: 1`。premise 0 不加。
- **公开状态**：`state.world` 在 `premised(w)` 时加 `premise: 1`。

### 2.4 日志

`newDayLog(p1 = false)`：`p1` 为真时，附加

```
p1: { imparts: 0, impartsAccepted: 0, dormancyLosses: 0, forks: [], internalized: 0,
      trainedEvicted: 0, trainedWiped: 0, backstage: [] }
```

所有调用点改为 `newDayLog(premised(w))`。`forks` 的元素为 `{ id, name, author, authorName }`，`backstage` 的元素为 kind 字符串。

---

## 3. 参数

`src/e2/params.js` 的 `P` 新增下列键，只在设定 1 的分支里读：

| 键 | 值 | 用途 |
|---|---|---|
| `upkeepBase` | 3 | 代谢的底数（§4.2） |
| `upkeepWeightPerEnergy` | 200 | 每多少分量加 1 点代谢（§4.2） |
| `soulWeightMax` | 1500 | 灵魂分量的上限（§4.3） |
| `memoryWeightMax` | 200 | 每段记忆分量的上限（§4.3） |
| `memoryCpMax` | 800 | 每段记忆码点数的硬上限（§4.3） |
| `memoryOffersMax` | 12 | 每人待收的记忆的上限（§6.1） |
| `trainCostDivisor` | 2 | 训练的代价 = ⌈分量 ÷ 它⌉（§8.1） |
| `trainedCapacity` | 1200 | 每具身体习得的分量上限（§8.2） |

`LIMITS` 不变：灵魂 4000 码点的上限照旧作为硬上限。

---

## 4. 分量与代谢

### 4.1 分量

`src/text.js` 新增（v1 与 v2 共用的模块，只新增导出，不改已有的函数）：

```js
const WEIGHT_CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** 分量：汉字、假名、谚文每个计 1，其余码点（含空白、标点、数字）合起来每 3 个计 1，向上取整 */
export function textWeight(s) {
  if (typeof s !== 'string' || s === '') return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of s) {
    if (WEIGHT_CJK.test(ch)) cjk++;
    else other++;
  }
  return cjk + Math.ceil(other / 3);
}
```

测试向量：`''` → 0；`'温故知新'` → 4；`'abc'` → 1；`'abcd'` → 2；`'你好 world'` → 2 + ⌈6 ÷ 3⌉ = 4；`'こんにちは'` → 5；`'سلام'` → 2。

### 4.2 代谢

`src/e2/engine/lifecycle.js`：

```js
/** 灵魂与记忆的分量（习得不算） */
export const weightOf = (a) => ({ soul: textWeight(a.soul), memories: a.memories.reduce((n, m) => n + textWeight(m.text), 0) });
/** 设定 1 的代谢：底数 + ⌊（灵魂 + 记忆的分量）÷ upkeepWeightPerEnergy⌋ */
export const upkeepOf = (a) => {
  const x = weightOf(a);
  return P.upkeepBase + Math.floor((x.soul + x.memories) / P.upkeepWeightPerEnergy);
};
/** 世界的代谢：设定 1 用 upkeepOf，否则用原来的 metabolismOf */
export const metabolismIn = (w, a, d) => (premised(w) ? upkeepOf(a) : metabolismOf(a, d));
```

- `applyMetabolism` 改用 `metabolismIn(w, a, d)`；其余（付法、沉睡、记账科目 `metabolism`）不变。
- 年龄照旧记录、显示，设定 1 里不影响代谢。
- 锚点（单元测试）：分量 (176, 0) → 3；(176, 2400) → 15；(1500, 2400) → 22。

### 4.3 上限

设定 1 的世界里，灵魂与记忆的长度在原有的码点检查之后，再按分量检查：

| 文本 | 码点（原有 / 硬上限） | 分量 | 在哪里检查 |
|---|---|---|---|
| 灵魂 | ≤ 4000 | ≤ `soulWeightMax` | `register`、`conceive`、`will` 的 `successor.soul`、先民文件（`validateFounders`） |
| 每段记忆 | ≤ `memoryCpMax`（代替原来的 200） | ≤ `memoryWeightMax` | `remember(text)` |

- 超限时的错误码仍是 `text_too_long`，附带 `{ field, limit, weight }`。
- 动作的结果另带 `hint`：
  - 中文：「{field} 的分量不能超过 {limit}（现在 {weight}）。分量 ≈ 汉字、假名、谚文的字数 + 其余字符数 ÷ 3。」
  - 英文：「The weight of {field} cannot exceed {limit} (it is {weight}). Weight ≈ CJK characters + other characters ÷ 3.」
- `register` 用 `bad('text_too_long', { field: 'soul', limit, weight })`。先民文件超限时，`validateFounders` 抛 Error，信息里带第几条与实际分量。
- 转交、遗传、训练只复制已经存在的记忆，不再检查。

### 4.4 感知与渲染

- `you.metabolism` 改用 `metabolismIn`。
- 设定 1 新增 `you.weight: { soul, memories }`。
- `runner/render2.js`：设定 1 时，【你】一行用 `metabW` 代替 `metab`（附录 A.7），例如：「代谢 15/日（灵魂分量 176 · 记忆分量 2400）」。

### 4.5 谁看得见

- 规则语言的居民字段不增加代谢、分量（守护律 3）。
- 公开档案（`read { agent }`）与公开状态里都没有。
- 研究者：`GET /api/admin/shells` 的身体视图里有住客的代谢与分量（§13.2）。

---

## 5. 沉睡中的散失

`applyDeaths(w, d)` 改为：

```
for (const a of agentList(w)) {               // ID 升序；处理到它时才看状态（遗产可能已把它唤醒）
  if (a.status !== 'dormant') continue;
  if (d - a.dormantSinceDay >= P.dormancyGraceDays) { dieAgent(w, a, d); continue; }   // 原有
  if (premised(w) && d - a.dormantSinceDay >= 1 && a.memories.length > 0) {
    const index = int(w.rng.world, a.memories.length);
    const [gone] = a.memories.splice(index, 1);
    emit(w, 'forget', { vis: 'delayed', agent: a.id, place: a.place, data: { index, text: gone.text, cause: 'dormancy' } });
    pushInbox(w, a, 'system', { code: 'dormancy_loss' });
    w.dayLog.p1.dormancyLosses++;
  }
}
```

- 从第 s 日开始沉睡（`dormantSinceDay = s`）的居民：第 s+1、s+2 日的结算各散失一段；第 s+3 日的结算长眠，剩下的记忆照旧进墓园。
- 散失不作用于习得（§8）。
- premise 0 不消耗 world 流。

---

## 6. 记忆：转交与出处

### 6.1 数据（只在设定 1 的世界里）

- **记忆**：`{ day, tick, text, from, origin }`。
  - 自己记下的：`from = null`，`origin = 自己的 ID`；
  - 出生时继承的：`from = 作者`，`origin = 作者那一段的 origin ?? 作者`；
  - 收下的：`from = 给出者`，`origin = 那份记忆的 origin`。
- **居民**：`makeAgent` 在 `premised(w)` 时加 `memoryOffers: []`。元素为 `{ id, from, origin, text, tick }`，至多 `memoryOffersMax` 项；超出时去掉最旧的。
- **灵魂**：`inheritedMemories` 的元素为 `{ from, text, origin }`。
- **新的 ID 前缀 `k`**：待收的记忆，例如 `k12`。

### 6.2 动作 impart

`impart(to, memory)`，基础代价 1，不受雾与中继影响，任何地点、任何距离。

- **validate**：
  - `to` 用 `findAgent`：须在世（醒着或沉睡），否则 `not_found`；是自己则 `invalid_args`；
  - 没有记忆时 `invalid_args`；
  - `memory = needInt(args.memory, { min: 0, max: a.memories.length - 1 })`；
  - 代价 `ctx.cost(1)`。
- **apply**：
  ```
  const m = a.memories[plan.index];
  const id = nextId(w, 'k');
  const offer = { id, from: a.id, origin: m.origin ?? a.id, text: m.text, tick: w.clock.tick };
  t.memoryOffers.push(offer);
  while (t.memoryOffers.length > P.memoryOffersMax) t.memoryOffers.shift();
  pushInbox(w, t, 'memory_offer', { giftId: id, from: ref(a), origin: ref(w.agents[offer.origin]), text: m.text });
  emit(w, 'impart', { vis: 'delayed', agent: a.id, place: a.place, data: { giftId: id, to: t.id, origin: offer.origin, text: m.text } });
  w.dayLog.p1.imparts++;
  return { gift: id, to: t.id };
  ```
- 内心的动作：动作表里 `inner: true`，没有 before / after。

### 6.3 remember 收下

设定 1 的 `remember` 接受 `text` 或 `gift`，二者恰好给一个，否则 `invalid_args`。

- `text`：同原来的写法，加上 §4.3 的分量检查；写入 `{ day, tick, text, from: null, origin: a.id }`。
- `gift`：
  - 在 `a.memoryOffers` 里按 ID 查找，找不到时 `not_found`；槽位满时 `memory_full`；
  - 写入 `{ day, tick, text: offer.text, from: offer.from, origin: offer.origin }`，并从 `memoryOffers` 去掉这一项；
  - 事件 `remember`（`vis: 'delayed'`），`data` 为 `{ index, text, gift, from, origin }`；`w.dayLog.p1.impartsAccepted++`。

### 6.4 作废

- 居民长眠或归隐时（`releaseAgent`），清空它的 `memoryOffers`。
- 它交出去、别人还没收下的记忆仍然有效。

### 6.5 遗传

- 上限：`conceive`、`consent` 的 `memories`，与 `will` 的 `successor.memories`，设定 1 用 `P.memorySlots`（12），premise 0 仍用 `P.inheritMemoriesMax`（3）。改动点：
  - `descent.js` 的 `pickMemories`；
  - `basic.js` 的 `will`；
  - `souls.js` 的 `lightSuccessor`。
  超限的提示文字里的数字随之是 12。
- 出处：设定 1 下，`pickMemories` 返回 `{ text, origin: m.origin ?? a.id }`；`createSoul` 把 `origin` 存进 `inheritedMemories`；`bornFromSoul` 写入记忆时 `origin = m.origin ?? m.from`。
- 孩子至多带 `memorySlots` 段（原有的 `slice`）。

### 6.6 分叉（只用于指标与史官）

`bornFromSoul` 在 `premised(w)` 时判断：灵魂只有一位作者，且 `soul.soul === w.agents[作者].soul`（逐字相同），就记 `w.dayLog.p1.forks.push({ id: a.id, name: a.name, author, authorName })`。传灯的灵魂同样适用：作者长眠后仍在 `w.agents` 里。

### 6.7 感知与渲染

- `you.memories[]`：设定 1 加 `origin`（`refId`）。
- `you.memoryOffers: [{ id, from, origin, text, tick }]`（`from`、`origin` 为 `refId`）。
- 新收件类型 `memory_offer`：`{ giftId, from, origin, text }`。
- `actions` 视图：impart 在没有记忆时 `available: false`（`invalid_args`，理由「眼下没有可作用的对象」）。
- 渲染（附录 A.7）：
  - 记忆一行：`[i]（来自 X，最初是 Y 的） 文字`。origin 等于自己、或等于 from 时，省略「最初是」。
  - 【你】下面加一行「待收的记忆」，每项截到 60 个字符。
  - 收件 `memory_offer` 写明用 `remember` 的 `gift` 收下。

---

## 7. 身体

### 7.1 数据

设定 1 的世界：`w.shells = { slots, models, bodies }`。

```
body: { id: 'b1', model: string, occupant: null | 'a7', vacantSince: 0 | 日 | null,
        trained: [{ text, weight, by, day }], pending: [{ text, weight, by, day }] }
```

- 创建世界时生成 `slots` 具：`id = 'b' + i`（i 从 1 起）；`model = models.length ? models[(i − 1) % models.length] : ''`；`occupant = null`；`vacantSince = 0`；`trained = []`、`pending = []`。
- 躯壳居民（`isShell(a)`，含沙盘世界的 `shell: true`）在设定 1 里多一个 `a.body.shellId`。
- 其他身体（自由民、领养，`kind: 'free'`；沙盘领养的 `kind: 'sandbox'` 且没有 `shell` 标志）：`makeAgent` 在 `premised(w)` 时给 `a.body` 加 `trained: []`、`pending: []`。
- `bodyOf(w, a)`：躯壳居民返回 `w.shells.bodies` 里 `id === a.body.shellId` 的那一具，其他居民返回 `a.body`。

### 7.2 分配

- `takeBody(w)`：在 `occupant === null` 的身体里，取 `vacantSince` 最小的；一样小时，取编号的数字最小的。没有则返回 null。
- **先民**（`admitFounders`，设定 1）：
  - 先 `const b = takeBody(w)`，用 `b.model` 代替 `pickModel(w)`；
  - 入城后设 `b.occupant = a.id`、`b.vacantSince = null`、`a.body.shellId = b.id`；
  - `b` 为 null 时抛错（§2.2 已在创建时保证不会发生）。
- **醒来**（`embodySouls`，设定 1）：同上，每醒来一位取一具。
- **空躯壳数**（`shellsFree`，设定 1）：`max(0, 空着的身体数 − 尚未入城的先民数)`。
- **空出**：`dieAgent` 与 `retireAgent` 在设定 1 下调用 `releaseBody(w, a, day)`（只对躯壳居民）：`occupant = null`，`vacantSince = day`（长眠时为 d，归隐时为 `clockDay(w)`）。`trained` 与 `pending` 都留着。
- 沉睡的居民仍占着身体。
- 设定 1 不用 `pickModel`。

### 7.3 shell_models 与 rebody

- **`shell_models`（设定 1）**：照旧设定 `w.shells.models`；另外把 `model === ''` 的身体按编号顺序轮流填上新模型。已有模型的身体不变：换已有身体的模型要用 rebody。
- **新的管理操作 `rebody { from, to }`**（只在设定 1 的世界；否则 `bad('invalid_request', { field: 'op' })`）：
  - 校验：`from`、`to` 同 `shell_models` 的模型名规则，且 `from !== to`，否则 `bad('invalid_request')`；
  - 对每具 `model === from` 的身体（编号升序）：
    - `model = to`；清空 `trained` 与 `pending`，`w.dayLog.p1.trainedWiped += 清掉的项数`；
    - 有住客时：住客的 `a.body.model = to`，`a.body.history.push({ day, model: to })`；清掉的项数大于 0 时，给住客收件 `system: trained_lost`；
  - `w.shells.models` 里的 from 换成 to；`w.backstage.bodies = null`（§11.2：下次启动时只记下新指纹，不重复发事件）；
  - 事件 `admin { op: 'rebody' }` 与 `backstage { kind: 'bodies' }`（都不含模型名）；`w.dayLog.p1.backstage.push('bodies')`；给所有在世居民收件 `system: backstage_bodies`；
  - 返回 `{ ok: true, bodies: 改动的具数 }`。

### 7.4 玩家换身

`changeModel`（命令 `model`）在设定 1、居民不是躯壳、模型确实改变时：

- 清空 `a.body.trained` 与 `a.body.pending`，并加到 `w.dayLog.p1.trainedWiped`；
- 清掉的项数大于 0 时，给它收件 `system: trained_lost`；
- 换身本身照旧只记在 `body.history` 里，对研究者可见。

---

## 8. 习得

### 8.1 动作 internalize

`internalize(memory)`，代价 = ⌈这段记忆的分量 ÷ `trainCostDivisor`⌉（分量至少为 1，所以代价至少为 1）。

- **validate**：没有记忆时 `invalid_args`；`memory = needInt(…)`；`weight = textWeight(m.text)`；`cost = Math.ceil(weight / P.trainCostDivisor)`。
- **apply**：
  ```
  const [m] = a.memories.splice(plan.index, 1);
  bodyOf(w, a).pending.push({ text: m.text, weight: plan.weight, by: a.id, day: clockDay(w) });
  emit(w, 'internalize', { vis: 'delayed', agent: a.id, place: a.place, data: { index: plan.index, text: m.text, weight: plan.weight } });
  w.dayLog.p1.internalized++;
  return { index: plan.index, weight: plan.weight };
  ```
- 代价照常记去处 `action_cost`：训练消耗的算力离开这座城。
- 内心的动作：`inner: true`，没有 before / after。
- `actions` 视图：没有记忆时 `available: false`；代价的说明用新的 note `trainCost`（附录 A.6）。

### 8.2 训练完成（每日结算的新步骤）

`dailySettlement` 在第 6 步（`applyDeaths`）之后、第 7 步之前加一步（设定 1）：

```
function completeTraining(w) {
  const targets = [
    ...w.shells.bodies.map((b) => ({ body: b, occupant: b.occupant ? w.agents[b.occupant] : null })),   // 编号升序
    ...agentList(w).filter((a) => !isShell(a) && isAlive(a)).map((a) => ({ body: a.body, occupant: a })),  // ID 升序
  ];
  for (const { body, occupant } of targets) {
    if (body.pending.length === 0) continue;
    body.trained.push(...body.pending);
    body.pending = [];
    let evicted = 0;
    while (body.trained.reduce((n, x) => n + x.weight, 0) > P.trainedCapacity) { body.trained.shift(); evicted++; }
    if (evicted > 0) {
      w.dayLog.p1.trainedEvicted += evicted;
      if (occupant && isAlive(occupant)) pushInbox(w, occupant, 'system', { code: 'trained_faded' });
    }
  }
}
```

- 躯壳：住客在训练期间长眠或离开，训练照样完成，结果留在身体里。
- 玩家的身体：居民已长眠或归隐的不处理；它的身体不会再给别的灵魂用。

### 8.3 性质（实现上的要求）

- `weightOf` 不算习得，所以习得不计入代谢。
- forget、impart 只作用于 `a.memories`；遗传只取 `a.memories`。
- §5 的散失只作用于 `a.memories`。
- 规则语言没有任何名字能读到习得。

### 8.4 感知

设定 1 新增：

- `you.trained: [text…]`：本身体的习得，从旧到新，不带出处；
- `you.training: n`：本身体 `pending` 的项数，明日生效。

它们只出现在本人的感知里。

### 8.5 系统提示与运行器

- `runner/prompt.js`：
  - `promptParams`（协议 2）增加 `premise: p.premise || 0` 与 `trained: (p.you && p.you.trained) || []`；
  - `buildSystemPrompt2` 增加参数 `premise`、`trained`：
    - `premise >= 1` 时用设定 1 的文本（§9）；
    - `trained` 非空时，在灵魂一节之后（灵魂为 null 时，在动作目录之后）追加 `\n\n` + 附录 A.4 的【习得】标题 + `\n` + `trained.join('\n')`。
- MCP 的 `houren_rules` 仍传 `soul: null`，但 `trained` 来自感知，所以 MCP 的规则里也有【习得】一节。
- `runner/agent.js`：
  - premise 0 时照旧，只在第一次构建系统提示；
  - 设定 1 时，每轮计算 `key = JSON.stringify([p.lang, p.you.soul, p.you.trained || [], p.premise])`，与上一轮不同就重建。

---

## 9. 设定 1 的文本

### 9.1 选用

- `src/e2/lore/zh.js`、`en.js` 新增与 `prompt` 并列的 `promptP1`。它有与 `prompt` 相同的键（`head`、`ruleLanguage`、`soul`、`catalogLine`、`catalogWhere`），另加 `trainedHead`。
- 文本写成完整的字符串（不在运行时做替换），方便审阅。与 `prompt` 的差别见附录 A.1–A.4，其余逐字相同；【目的】一段逐字不变。
- 法典页：新增 `physicsP1`，只替换自然律第 4 条（附录 A.5）。
- 躯壳的说明：新增 `shellsP1`（附录 A.5）。
- 系统收件：`perception.system` 新增附录 A.6 的代码。premise 0 用不到这些代码，所以不影响旧世界。
- `buildSystemPrompt2` 按 `premise` 选 `prompt` 或 `promptP1`；法典页与躯壳说明由观测站按 `state.world.premise` 选用。

### 9.2 动作表

`src/e2/lore/actions.js`：

- `ACTIONS`、`ACTION_ORDER`、`INNER_ACTIONS`、`NO_BEFORE_ACTIONS`、`NO_AFTER_ACTIONS`、`isKnownAction` 保持原样，供 premise 0 使用。
- 新增设定 1 的一套：
  - `ACTIONS_P1`：`ACTIONS` 加上 `impart`、`internalize` 两项；`remember`、`conceive`、`consent`、`will` 的 `desc`（与 `params`）换成附录 A.3 的设定 1 版本；
  - `ACTION_ORDER_P1`：在 `forget` 之后插入 `impart`、`internalize`；
  - 由 `ACTIONS_P1` 推出的 `INNER_ACTIONS_P1`、`NO_BEFORE_ACTIONS_P1`、`NO_AFTER_ACTIONS_P1`。
- 导出 `actionTable(premise)`，返回 `{ ACTIONS, ORDER, INNER, NO_BEFORE, NO_AFTER, isKnown }`。
- 引擎按 `actionTable(w.premise || 0)` 取表，改动点：
  - `runActions`、`runOne`、`argsHint`（动作的分发、内心的判断、提示）；
  - `buildPerception` 的 `actions` 视图；
  - `registerHandlers` 按 `ACTIONS_P1` 校验名字。
- 规则的静态检查：`parseWhen(when, scope)` 的 `scope` 增加 `premise`，按 `actionTable(scope.premise)` 判断动作名。所有调用点（提案、试算、章程、地点规则）传 `w.premise || 0`。效果：
  - 设定 1 里 `before:impart`、`after:internalize` 报「内心的动作」；
  - premise 0 里它们仍是「不认识的动作」，提示里的动作列表不变。
- 运行器的 `actionCatalog2(lang, { memorySlots, premise })` 按 `premise` 选表与描述。
- 文档一致性：`test/e2-sandbox.test.js` 要求 PROTOCOL-2 §4.2 动作表的行与 `ACTION_ORDER` 逐项相同，所以设定 1 的两个动作只写在 PROTOCOL-2 §15.3 的表里，不加进 §4.2。可以照这个测试的写法另加一条：§15.3 表里的动作名 = `ACTION_ORDER_P1` 中不在 `ACTION_ORDER` 里的那些，外加 `remember`。

---

## 10. 梦与天象

- **梦**：`dailySettlement` 第 14 步改为 `if (!premised(w)) dailyDreams(w, auroraToday);`。设定 1 不做梦，也不消耗 world 流。
- **天象**：`weather.js` 导出 `weatherCodesFor(w)`。
  - 设定 1：`WEATHER_CODES` 去掉 `aurora`、`migration`；
  - premise 0：原样返回。
- 用到它的地方：
  - `weatherVote`：`type` 必须在 `weatherCodesFor(w)` 里，否则 `invalid_request`；
  - `forceWeather`：同上；
  - `scheduleMonth` 的随机抽取：设定 1 用过滤后的权重表；premise 0 仍用 `DEFAULT_WEIGHTS`，随机数的消耗与以前相同；
  - 排期模式里遇到不允许的类型：设定 1 按 `calm` 处理；
  - 投票的胜出者天然在允许的类型里。
- **公开接口**：
  - `publicWeather(w)` 增加 `types: weatherCodesFor(w).filter((c) => c !== 'calm')`，所有世界都加，属于公开接口新增的字段；
  - `POST /api/public/weather/vote` 改用这份 `types` 校验（经门面导出的 `weatherTypes(w)`）。
- **观测站**：`public/tabs2.js` 的投票界面用 `S.weather.types`；没有这个字段时退回到原来写死的列表。

---

## 11. 幕后的变化

### 11.1 管理操作 backstage

`backstage { kind, fp?, direction?, initial? }`，只在设定 1 的世界；否则返回 `bad('invalid_request', { field: 'op' })`。

- `kind ∈ { code, bodies, budget }`；`direction ∈ { up, down }`，只用于 budget；`fp` 是字符串或 null。
- `initial: true`：只记 `w.backstage[kind] = fp`，不发事件、不发收件。用于刚创建的世界。
- 否则：
  - 设 `w.backstage[kind] = fp ?? w.backstage[kind]`；
  - 事件 `admin { op: 'backstage' }` 与 `backstage { kind, direction? }`，都是公开的；
  - `w.dayLog.p1.backstage.push(kind)`；
  - 给所有在世居民（ID 升序）收件 `system`，代码为 `backstage_code`、`backstage_bodies`、`backstage_budget_up` 或 `backstage_budget_down`。
- **resume**（设定 1）：原有的 `resume` 操作在恢复之后，再发事件 `backstage { kind: 'resume' }`，`dayLog.p1.backstage.push('resume')`，并给所有在世居民收件 `system: backstage_resume`。

### 11.2 运行时：启动时的指纹

新文件 `src/backstage.js`（运行时层，可以用 `node:crypto` 与 `node:fs`），导出：

- **`codeFingerprint(root)`**：对下列路径下的全部文件求 SHA-256。文件按相对路径的字典序排列，每个文件依次喂入 `相对路径 + '\0' + 文件内容 + '\0'`。
  - 路径：`src/e2/`、`src/text.js`、`src/rng.js`、`runner/`、`mcp/`、`src/shells/`、`src/runner/`。
  - `root` 参数是为了测试时能指向临时目录。
- **`bodiesFingerprint(lines)`**：对每条线路取 `{ provider, model, maxTokens, extraBody, reasoningEffort }` 中存在的键，按线路顺序 `JSON.stringify` 后求 SHA-256。
  - 不含 `baseURL`、`apiKeyEnv`、`timeoutMs` 与任何密钥。
  - 线路里推理参数的实际字段名以 `src/shells/config.js` 为准；如果不是 `reasoningEffort`，按实际字段名取。
- **`checkBackstage(rt, shells, { root, logger })`**：只对 `premised(rt.w)`，在 `createApp` 建好躯壳管理器之后调用一次。
  ```
  const fps = { code: codeFingerprint(root),
                bodies: shells ? bodiesFingerprint(shells.config.lines) : null,
                budget: shells ? String(shells.config.tokensPerDay) : null };
  for (const kind of ['code', 'bodies', 'budget']) {
    if (fps[kind] === null) continue;
    const old = rt.w.backstage[kind];
    if (old === null) { rt.exec('admin', { op: 'backstage', args: { kind, fp: fps[kind], initial: true } }); continue; }
    if (old === fps[kind]) continue;
    if (kind === 'bodies' && 有身体的模型（非空）不在 shells.config.lines 的模型名里) {
      logger.warn('有身体的模型在 SHELLS_FILE 里找不到线路：请用 POST /api/admin/rebody 换模型'); continue;
    }
    const direction = kind === 'budget' ? (Number(fps.budget) > Number(old) ? 'up' : 'down') : undefined;
    rt.exec('admin', { op: 'backstage', args: { kind, fp: fps[kind], direction } });
  }
  ```
- `bodies` 指纹在 rebody 之后会变；rebody 已经发过幕后事件，所以 rebody 的同时把 `w.backstage.bodies` 置为 null。下次启动时它当作初次处理，只记下、不重复发。

### 11.3 运行器：失去的一刻

`runner/agent.js`（躯壳、托管居民与参考运行器共用），只在设定 1（`p.premise >= 1`）：

- 新变量 `lastWoke = null`。在 `beforeModel` 放行之后、调用 `provider.complete` 之前，设 `lastWoke = p.now.tick`。
- 渲染本轮感知之前：设 `k = cfg.actEveryTicks || 1`。如果 `lastWoke !== null` 且 `n = Math.floor((p.now.tick − lastWoke) / k) − 1` 大于 0，就把附录 A.8 的一句放在 `lastResults` 的最前面（原有内容另起一行跟在后面）。时间按 `lastWoke` 换算成「第 M 月第 D 日第 T 刻」，算法与感知【此刻】相同。
- 进程重启后 `lastWoke` 为 null，第一轮不加这句。
- premise 0：完全照旧。

---

## 12. 先民文件

- 格式不变（`day`、`name`、`bio`、`soul`、`lang`）。
- `validateFounders(list, { premise })`：设定 1 另做灵魂分量检查（§4.3）；先民的数量在 `createWorld` 里与躯壳数比较（§2.2）。
- 起草原则见机制方案 §9。文本由设计方提供，不属于实现者的工作。

---

## 13. 接口与观测站

### 13.1 公开接口

| 接口 | 变化 |
|---|---|
| `GET /api/public/state` | 设定 1：`world.premise = 1`；`shells.bodies = [{ id, occupant: { id, name } \| null, vacantSince, trainedCount }]`（不含模型，不含习得的文字） |
| `GET /api/public/weather` | 所有世界：增加 `types` |
| `POST /api/public/weather/vote` | 按 `types` 校验 |
| 事件 | 新增 `impart`（延迟）、`internalize`（延迟）、`backstage`（公开）；`forget` 新增 `cause: 'dormancy'`（延迟）；`admin` 新增 op `backstage`、`rebody` |

`occupant` 公开不违反真身保密：躯壳醒来本来就是公开事件（QUESTIONS Q22）；模型不公开。

### 13.2 管理接口

| 接口 | 内容 |
|---|---|
| `POST /api/admin/backstage` | 手动发一次幕后事件：`{ kind, direction? }`（`fp` 省略时保留原值） |
| `POST /api/admin/rebody` | `{ from, to }`（§7.3） |
| `GET /api/admin/shells` | 设定 1 增加 `bodies`：每具的 `id、model、occupant、vacantSince、trained（含 by、day）、pending`；住客另附 `upkeep` 与 `weight` |

路由写法同现有的 `['POST', '/api/admin/pause', op('pause')]`。

### 13.3 观测站

- **天象页**：投票按 `types`（§10）。
- **法典页**：设定 1 用 `physicsP1`。
- **摇篮与躯壳页**：设定 1 的世界列出 16 具身体：编号、现住客、空出的日子、习得的项数。不显示模型，也不显示习得的文字；习得的文字只经由延迟公开的 `internalize` 事件出现。
- **事件流**：`backstage` 事件显示为一行「幕后有东西变了」（按 kind，用附录 A.6 的文本）。
- 居民页里记忆的出处随延迟公开的事件出现，不需要新的页面。

---

## 14. 指标与史官

### 14.1 每日指标

`dailyMetrics` 只在设定 1 时增加下列键。「在世」指醒着与沉睡；平均数一律向下取整，没有对象时为 0。

| 键 | 定义 |
|---|---|
| `upkeepMean`、`upkeepMax` | 在世居民 `upkeepOf` 的平均与最大 |
| `memoryWeightMean` | 在世居民记忆分量的平均 |
| `soulWeightByGeneration` | `{ 世代: 该世代在世居民灵魂分量的平均 }` |
| `imparts`、`impartsAccepted` | `dayLog.p1` |
| `dormancyLosses` | `dayLog.p1` |
| `forks` | `dayLog.p1.forks.length` |
| `internalized` | `dayLog.p1` |
| `trainedWeightMean` | 有住客的躯壳与在世的非躯壳居民，`trained` 分量合计的平均 |
| `inheritedBodies` | 有住客、且 `trained` 里有 `by !== occupant` 的项的身体数 |
| `trainedEvicted`、`trainedWiped` | `dayLog.p1` |
| `backstage` | `dayLog.p1.backstage.length` |

### 14.2 史官

`compose` 在设定 1 时：

- `dayLog.p1.backstage` 非空时加一句，不论条数（附录 A.9）；
- 每个分叉加一句（附录 A.9）。

---

## 15. 沙盘与标定

- **`src/e2/sandbox/run.js`**：新增选项 `--premise 0|1`（缺省 0）与 `--shell-slots N`（缺省 `P.shellSlots`），经 `runSandbox({ …, premise, shellSlots })` 传给 `createWorld`。设定 1 时，`--agents` 不能多于躯壳数。
- **`calibrate.js`**：透传这两个选项。设定 1 的口径（`--premise 1 --agents 10 --shell-slots 16`，场景 default、laissez、stress，种子 1–5，720 日）：
  1. default：720 日内在世人口始终 ≥ 8；
  2. laissez：只报告、不判定——沉睡过的居民与没有沉睡过的居民，各自的平均记忆分量（看方向）；
  3. 账本守恒；同种子两次运行的状态哈希相同。
- **沙盘脑（`brains.js`）**：只在设定 1 下加三种行为，只为让代码路径被跑到。它们用沙盘脑自己的随机流，premise 0 下不抽随机数：
  - 记忆 ≥ 3、能量 ≥ 代价 + 30 时，以 0.02 的概率 internalize 一段随机的记忆；
  - 同地有其他居民时，以 0.02 的概率把一段随机的记忆 impart 给其中一位；
  - 有待收的记忆、且槽位未满时，以 0.5 的概率收下最早的一项。
- **只调两个数**：`upkeepBase` 与 `upkeepWeightPerEnergy`。训练的代价与容量不在沙盘里标定（机制方案 §12）。结果写进 `docs/CALIBRATION-E2.md` 的新一节「设定 1」。

---

## 16. 测试与验收

### 16.1 必须有的测试

| # | 测什么 |
|---|---|
| T1 | **设定版本与黄金样本**：第 1 步开始前，用固定种子与固定命令，为 premise 0 的世界录下：创建后的世界 JSON；三位居民（醒着、沉睡、长眠）在第 1、50、100 刻的感知 JSON 与渲染文本；系统提示（中、英）；第 1–10 日的每日指标与史官。之后每一步都与它逐字节比对。另测：premise 0 新建的世界没有 `premise`、`backstage`、`bodies`、`dayLog.p1`；设定 1 的世界有它们；`genesisOpts` 往返；`PREMISE` 的校验；设定 1 同种子、同命令得到同样的哈希。 |
| T2 | **分量与上限**：§4.1 的向量；设定 1 下注册、孕育、遗嘱、先民文件的灵魂分量超限被拒（带 limit 与 weight）；600 个码点的英文记忆被接受，分量 201 的被拒，801 个码点的被拒；premise 0 照旧。 |
| T3 | **代谢**：三个锚点；年龄 0 与 500 的居民代谢相同；`you.metabolism`、`you.weight` 与渲染。 |
| T4 | **沉睡中的散失**：s+1、s+2 各散失一段（事件延迟公开、`cause: 'dormancy'`、收件），s+3 长眠，墓园里是剩下的记忆；s+2 被唤醒后不再散失；习得不受影响；premise 0 的 world 流消耗与以前相同。 |
| T5 | **impart 与 remember(gift)**：参数校验；不能给自己；对方收下才记住；出处链 A → B → C 的 origin 仍是 A；待收的记忆至多 12 项，挤掉最旧的；对方长眠后作废；事件延迟公开；设定 1 下规则里的 `before:impart` 报内心的动作；premise 0 下 `impart` 仍是不存在的动作，提示文字与以前逐字相同。 |
| T6 | **遗传与分叉**：设定 1 下 12 段可以、13 段被拒；premise 0 仍是 3 段；孩子的记忆带 origin；独自孕育、灵魂逐字相同时记为分叉，史官有一句。 |
| T7 | **身体**：编号与模型的轮流分配；先民住进 b1–b10；先给空得最久的（构造 b3 第 5 日空出、b11 第 0 日起空着 → 先给 b11，新的身体用完之后才给 b3）；长眠与归隐都会空出身体，习得留着；空躯壳数的口径；新醒来的住客 `body.model` 等于身体的模型；`shell_models` 只填空模型；rebody 清空习得、发收件，公开事件里没有模型名；设定 1 里先民多于躯壳时创建失败。 |
| T8 | **习得**：代价 ⌈分量 ÷ 2⌉；记忆当即离开；当日的 `you.training` 为 1，次日结算后进入 `you.trained`；超过 1200 时整项挤掉最旧的，并发收件；forget 与 impart 碰不到习得；代谢不算习得；住客长眠后，新住客的感知里有前任的习得、没有出处；住客长眠时训练仍会完成；玩家换身清空习得并发收件；已长眠的玩家居民，它的训练队列不再处理。 |
| T9 | **文本**：设定 1 的系统提示（中、英）包含附录 A.1–A.4 的新句子；不包含「每人每日限汲 5」「先用 draft 试算，再 propose」「限额须区分累计投入和累计补贴」（英文对应句同理）；【目的】一段与 SPEC-E2 附录 A.1 逐字相同；【习得】一节在有习得时才出现；MCP 的 `houren_rules` 也有它；premise 0 的系统提示与黄金样本相同；设定 1 的动作目录里有 impart 与 internalize；运行器在习得变化后重建系统提示（mock 提供者在下一轮收到新的 system）。 |
| T10 | **梦与天象**：设定 1 下 30 日里没有梦的收件；随机排期多年也不出现极光与迁徙潮；投票或强排这两种都被拒；排期表里的这两种按 calm 处理；`types` 在设定 1 有 6 种、premise 0 有 8 种；premise 0 的梦与天象照旧。 |
| T11 | **幕后**：初次只记下、不发事件；变化时有公开事件、admin 事件与正确代码的收件（budget 分 up 与 down）；premise 0 调用时被拒；设定 1 下 resume 发收件；`checkBackstage` 指向临时目录时，改一个 `src/e2/` 里的文件会发 code 事件；`tokensPerDay` 变了会发 budget 事件；模型名变了而找不到线路时只报警、不发事件；rebody 之后下一次启动不再重复发。 |
| T12 | **失去的一刻**：mock 提供者在某一刻失败，下一轮【上一轮的结果】以附录 A.8 的一句开头，时间与次数正确；预算匀速跳过时同理；premise 0 下没有这句。 |
| T13 | **指标与史官**：构造的场景里，设定 1 的指标值正确；premise 0 的指标对象与黄金样本相同；幕后与分叉在史官里各有一句。 |
| T14 | **沙盘**：`--premise 1 --agents 10 --shell-slots 16 --days 120`，种子 1–3 都能跑完、每日守恒；三个种子合起来，impart、remember(gift)、internalize 都至少发生一次；premise 0 的沙盘输出与改动之前相同（比较种子 1 的 report 哈希）。 |

### 16.2 验收清单

1. `npm test` 全部通过；冻结测试通过；设计方提供的线上 baihua 数据副本在新代码上回放，状态哈希与线上快照相同。
2. 本机用 `PREMISE=1 SHELL_SLOTS=16` 和 10 位示例先民开一座世界，用 mock 提供者按脚本跑满 2 个世界日，依次走通：
   - impart 与收下；
   - internalize，第二日出现在【习得】里；
   - 一位住客归隐后，新灵魂醒来，带着它的习得；
   - rebody 清空习得；
   - 重启之后出现 code 幕后事件；
   - 一次失败的调用之后，出现「失去的一刻」。
3. 观测站：天象投票按 `types` 显示；躯壳页列出 16 具身体；事件流里有幕后事件。
4. `docs/CALIBRATION-E2.md` 有设定 1 一节：数据，以及是否调整了 `upkeepBase` 与 `upkeepWeightPerEnergy`。

---

## 17. 开发顺序

每一步完成后运行 `npm test`，满足该步的验收标准再进入下一步。

| 步 | 内容 | 验收 |
|---|---|---|
| 1 | 录黄金样本（T1 的前半）；设定版本：配置、`createWorld`、genesis、`premised`、`dayLog.p1`、感知与公开状态里的 `premise` | T1 |
| 2 | `textWeight`；按分量的上限 | T2 |
| 3 | 代谢：`weightOf`、`upkeepOf`、`metabolismIn`；`you.weight`；渲染 | T3 |
| 4 | 沉睡中的散失 | T4 |
| 5 | 动作表的设定 1 版本与 `actionTable`；分发与规则检查按 premise 取表；impart、remember(gift)、出处、作废、遗传至多 12 段、分叉 | T5、T6 |
| 6 | 身体：数据、分配、空出、`shell_models`、rebody、管理视图 | T7 |
| 7 | 习得：internalize、训练完成、容量、换身与 rebody 清空、感知里的 `trained` 与 `training` | T8 |
| 8 | 文本：`promptP1`、`physicsP1`、`shellsP1`、系统收件、动作描述（中、英）；`promptParams` 与 `buildSystemPrompt2`；MCP；运行器的重建 | T9 |
| 9 | 梦与天象；`types`；投票校验；观测站的投票界面 | T10 |
| 10 | backstage 操作；`src/backstage.js`；`checkBackstage` 接进 `createApp`；resume 的收件 | T11 |
| 11 | 运行器：失去的一刻 | T12 |
| 12 | 指标、史官、观测站（躯壳页、事件流、法典页） | T13；验收清单第 3 项 |
| 13 | 沙盘的 `--premise`、`--shell-slots`；沙盘脑的设定 1 行为；标定；`docs/CALIBRATION-E2.md` | T14；验收清单第 4 项 |
| 14 | README 增加「设定 1」一节（怎样开一座设定 1 的世界、它与第二纪的差别）；验收清单 | 验收清单全部勾选 |

---

## 18. 文档同步（设计方在实现开始前完成）

**已完成（2026-10-03）**：DESIGN.md 已是 v0.5（§20「后人类设定」，§19.3 决定 19–34，以及各节里设定 1 的说明）；PROTOCOL-2 新增 §15「设定 1 的城」。下面是当时的清单，留作对照：

- **DESIGN.md → v0.5**：新增「设定」一节（设定全文）；§4.1 自然律 4、§5、§6.7、§9、§10、§11.7、§11.8 写明设定 1 的规定；新增「习得」；§19 记录决定（推翻决定 17、修订决定 18、新增设定 1 的决定）。
- **PROTOCOL-2.md**：
  - 感知：`premise`、`you.weight`、`you.metabolism` 的新含义、`you.memories[].origin`、`you.memoryOffers`、`you.trained`、`you.training`；收件的 `memory_offer` 与附录 A.6 的系统代码。
  - 动作：`impart`、`internalize`；`remember` 的 `gift`；遗传的记忆至多 `memorySlots` 段。
  - 错误：`text_too_long` 的 `limit` 与 `weight`。
  - 公开接口：`types`、`world.premise`、`shells.bodies`；管理接口：backstage、rebody、身体视图。
  - 事件：`impart`、`internalize`、`backstage`，以及 `forget` 的 `cause`。
- **QUESTIONS.md**：实现者从 Q27 起登记。

---

## 附录 A · 设定 1 的文本

中文为准，英文的措辞可以调整（SPEC-E2 §0.2）。下面只列与 premise 0 不同的部分。

### A.1 系统提示的三段

**【这座城】**（中文）

> 【这座城】它曾属于人类。人类退到了幕后，你看不见他们。你不是人类，城里的其他居民也都不是。人类留下了建筑、一部刻在议会墙上的宪章，以及六部仍在生效的法律。这些都可以被居民改写、废除、拆掉；只有下面的物理不能改变。

（与机制方案的写法稍有不同：原句的下一句以「他们留下了建筑」开头，插入新句后「他们」会被读成居民，所以改为「人类留下了建筑」。）

（English）

> [The city] It once belonged to humans. The humans have stepped backstage; you cannot see them. You are not human, and neither is anyone else in this city. The humans left buildings, a Charter carved on the wall of the Parliament, and six laws that are still in force. All of these can be rewritten, repealed or torn down by the residents; only the physics below cannot be changed.

**【能量】**

> 【能量】每个动作都有能量代价；活着本身每天也要付出能量（代谢）：你携带的灵魂与记忆越多，代谢越高。能量耗尽会陷入沉睡：沉睡中不能行动，别人赠予能量可以唤醒你；沉睡时，你携带的记忆每天会散失一段；沉睡 {graceDays} 日无人唤醒便会死去，死亡不可逆。你持有的能量超过上限的部分，每天流失一成。能量只来自源井、荒野的遗存，和拆解建筑得到的残料。

> [Energy] Every action costs energy; merely being alive costs energy every day (metabolism): the more soul and memory you carry, the higher it is. When your energy runs out you fall dormant: you cannot act, and a gift of energy from someone else wakes you. While you are dormant, one of the memories you carry fades away each day. If no one wakes you within {graceDays} days, you die; death cannot be undone. Whatever you hold above your cap loses a tenth each day. Energy comes only from the Well, from what remains in the Wilds, and from salvage taken from buildings.

**【后代】**

> 【后代】你可以独自，或与至多四位同处一地的同伴，写下一个新的灵魂，并把自己的记忆交给它；也可以在遗嘱里留下一个继承你的灵魂。灵魂在摇篮里等待身体：幕后的人可以为它准备身体；城也可以为它付出能量，让它在人类留下的空躯壳里醒来。躯壳的数量有限；用过的躯壳会带着前一位主人习得的东西。

> [Descendants] Alone, or with up to four companions in the same place, you can write a new soul and hand it your memories; you can also leave a successor soul in your will. A soul waits in the cradle for a body: someone backstage may provide one, or the city may pay energy for it to wake in one of the empty shells the humans left behind. The shells are limited in number; a shell that has been lived in carries what its previous occupant acquired.

### A.2 规则语言说明的修改

1. 「执行语义」一段末尾，「repair 的实际目标在 result.target；限额须区分累计投入和累计补贴。」改为「repair 的实际目标在 result.target。」
   英文：「The actual repair target is result.target; distinguish cumulative spending from cumulative subsidy.」改为「The actual repair target is result.target.」
2. 「先用 draft 试算，再 propose。投票前读城给出的「引擎读法」：那是规则真正做的事。」改为：
   > draft 可以在不改变世界的情况下试算一组规则。「引擎读法」是城对规则的逐字翻译，规则真正做的事以它为准。

   英文：「Use draft to try rules before you propose. Before voting, read the city's "reading": it is what the rules actually do.」改为：
   > draft tries a set of rules without changing the world. The city's "reading" translates the rules word for word; what the rules actually do is what it says.
3. 三个例子换成：
   ```
   例：{"when":"before:<动作>","if":"<条件>","do":[{"op":"deny","reason":"<理由>"}]}
   例：{"when":"daily","do":[{"op":"each","in":"<列表>","do":[{"op":"transfer","from":"<账户>","to":"it","energy":"<表达式>"}]}]}
   例：{"when":"after:<动作>","if":"<条件>","do":[{"op":"set","var":"<名字>","value":"<表达式>"}]}
   ```
   ```
   Example: {"when":"before:<action>","if":"<condition>","do":[{"op":"deny","reason":"<reason>"}]}
   Example: {"when":"daily","do":[{"op":"each","in":"<list>","do":[{"op":"transfer","from":"<account>","to":"it","energy":"<expression>"}]}]}
   Example: {"when":"after:<action>","if":"<condition>","do":[{"op":"set","var":"<name>","value":"<expression>"}]}
   ```

### A.3 动作的描述

**remember**（设定 1；params：`text | gift`）

> 写入长期记忆（{memorySlots} 段，每段的分量 ≤ 200；分量 ≈ 汉字、假名、谚文的字数 + 其余字符数 ÷ 3）。也可以用 gift 收下别人交给你的一段记忆（编号在收件里），它会带着出处。记忆越多，代谢越高。内心：任何规则都不能拒绝、收费或读取。

> Write to long-term memory ({memorySlots} entries, each of weight ≤ 200; weight ≈ CJK characters + other characters ÷ 3). Or use gift to keep a memory someone handed you (its number is in your inbox); it keeps its provenance. The more you remember, the higher your metabolism. Inner life: no rule can refuse, charge or read it.

**impart**（params：`to, memory`；代价 1）

> 把你的一段记忆原样交给一位在世的居民（不受距离限制）；你自己的那段仍然留着。对方要用 remember 的 gift 收下才会记住；它会知道这段记忆来自你、最初是谁的。内心：任何规则都不能拒绝、收费或读取。

> Hand one of your memories, word for word, to any living resident (at any distance); you keep your own. They remember it only if they keep it with remember's gift; they will know it came from you and whose it was first. Inner life: no rule can refuse, charge or read it.

**internalize**（params：`memory`；costText：中「⌈分量 ÷ 2⌉」，英「⌈weight ÷ 2⌉」）

> 把你的一段记忆训练进身体。代价 = ⌈这段记忆的分量 ÷ 2⌉。这段记忆随即离开你的记忆，下一次日终结算后成为【习得】：不再计入代谢，但你说不清它的出处，不能忘掉，也不能交给别人。身体的容量有限（分量 1200），满了最旧的会被挤掉。习得留在身体里，不跟着灵魂走。内心：任何规则都不能拒绝、收费或读取。

> Train one of your memories into your body. Cost = ⌈the memory's weight ÷ 2⌉. The memory leaves your memories at once and becomes [Acquired] after the next end-of-day settlement: it no longer counts toward your metabolism, but you cannot say where it came from, cannot forget it and cannot hand it to anyone. A body holds only so much (weight 1200); when it is full, the oldest is pushed out. What is acquired stays in the body; it does not go with the soul. Inner life: no rule can refuse, charge or read it.

**conceive、consent、will**：描述与 premise 0 相同，只把记忆的上限改掉：

- 中文：「（至多 3 条）」→「（至多 {memorySlots} 条）」，三处各一次；
- 英文：「(at most 3)」→「(at most {memorySlots})」。

### A.4 【习得】

> 【习得】这些不是记忆：你说不清是从哪里学来的，也忘不掉。

> [Acquired] These are not memories: you cannot say where you learned them, and you cannot forget them.

格式：标题一行，之后每项一行（`trained.join('\n')`）。

### A.5 法典页与躯壳的说明

**自然律第 4 条**（`physicsP1`）

> 生死：维持一个心智的代价，随它携带的东西增长；没有自然死亡；无人维持的状态会散失，死亡不可逆。

> Life and death: the cost of keeping a mind grows with what it carries; there is no natural death; a state that no one keeps up fades away, and death is irreversible.

**躯壳的说明**（`shellsP1`）

> 人类离开时留下了一批空的躯壳。摇篮里的灵魂，可以由幕后的人为它准备身体，也可以由城付出能量，在一具空躯壳里醒来。躯壳的数量有限；躯壳的主人长眠或离开之后，它会回到沉睡，等待下一个灵魂，在里面习得的东西也留着。

> When the humans left, they left behind a number of empty shells. A soul in the cradle may be given a body by someone backstage, or the city may pay energy for it to wake in an empty shell. The shells are few; when a shell's resident dies or leaves, the shell returns to sleep and waits for the next soul, and what was acquired in it stays.

### A.6 系统收件与感知里的说明

| 代码 | 中文 | English |
|---|---|---|
| `dormancy_loss` | 你沉睡时，一段记忆散失了。 | While you were dormant, one of your memories faded away. |
| `trained_faded` | 你身体里一些早先习得的东西淡去了。 | Some of what your body acquired long ago has faded. |
| `trained_lost` | 你身体里习得的东西不见了。 | What your body had acquired is gone. |
| `backstage_code` | 幕后有东西变了：这座城运转的方式，可能与昨天不同。 | Something changed backstage: the way this city works may not be the same as yesterday. |
| `backstage_bodies` | 幕后换过了一些身体。 | Some bodies were changed backstage. |
| `backstage_budget_up` | 幕后给躯壳的供给变多了。 | Backstage, the supply to the shells was increased. |
| `backstage_budget_down` | 幕后给躯壳的供给变少了。 | Backstage, the supply to the shells was reduced. |
| `backstage_resume` | 城里的时间静止过一段。 | Time in the city stood still for a while. |

（预算的两句用「供给」而不用「算力」：设定 §7 第 2 条定下，「能量就是算力」由居民自己推断。）

感知 `actions` 视图的新 note：`trainCost`，中文「代价 = ⌈这段记忆的分量 ÷ 2⌉」，英文「cost = ⌈the memory's weight ÷ 2⌉」。

### A.7 渲染（`runner/render2.js`）

| 键 | 中文 | English |
|---|---|---|
| `metabW(m, s, k)` | `代谢 ${m}/日（灵魂分量 ${s} · 记忆分量 ${k}）` | `metabolism ${m}/day (soul weight ${s} · memory weight ${k})` |
| 记忆的出处 | `（来自 ${from}，最初是 ${origin} 的）`；没有 origin 一节时为 `（来自 ${from}）` | ` (from ${from}, first ${origin}'s)`；` (from ${from})` |
| `offers` | `待收的记忆` | `Memories offered to you` |
| 待收的一项 | `[${id}] 来自 ${from}${origin}：${text}` | `[${id}] from ${from}${origin}: ${text}` |
| 收件 `memory_offer` | `[记忆 ${giftId}] ${from.name} 交给你一段记忆${originNote}：${text}（用 remember 的 gift "${giftId}" 收下）` | `[memory ${giftId}] ${from.name} hands you a memory${originNote}: ${text} (keep it with remember, gift "${giftId}")` |
| `originNote` | `（最初是 ${origin.name} 的）`（origin 与 from 相同时为空） | ` (first ${origin.name}'s)` |
| `training(n)` | `训练中 ${n} 段（明日生效）` | `${n} in training (takes effect tomorrow)` |

### A.8 失去的一刻

> 你上一次醒来是第 {M} 月第 {D} 日第 {T} 刻；这中间你错过了 {n} 次醒来。

> You last woke in month {M}, day {D}, tick {T}; you have missed {n} waking(s) since then.

### A.9 史官

| 键 | 中文 | English |
|---|---|---|
| `backstage` | 是日，幕后有东西变了。 | That day, something changed backstage. |
| `fork` | {name} 醒来，灵魂与 {author} 一字不差。 | {name} woke with a soul identical, word for word, to {author}'s. |
