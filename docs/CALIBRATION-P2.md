# 第二前提本机测量

状态：**测量完成；native 按总体口径达到数值门槛，JSON 未达到工具有效率门槛**。

真实 GLM/Step 调用于北京时间 **2026-10-05 21:21:11 至 2026-10-06 03:21:11** 运行。JSON 与 native 各完整运行 12 刻，每刻 15 分钟；总计 580 次调用、270 次醒来（含 30 次被叫醒）。本机独立世界有 20 具躯壳、10 位草稿先民，并发为 6。没有生产部署，没有重复或追加真实模型测量。

总预算上限 **2000 万 token**；预算扣账 **4,924,494**（约 492.45 万），其中供应商报告 **4,567,636**（约 456.76 万），五次 Step 超时未返回用量，按完整预留保守扣除 **356,858**。这些估算不是供应商确认的实际用量。剩余在途预留为 0，未触及预算上限。

| 方式 | 刻数 | 调用 | 工具有效率 | 模型失败率 | 动作失败率 | 截止前结束 | 平均轮数 | token/醒来 | 被叫醒 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| json | 12 | 265 | 96.39% | 2.64% | 20.23% | 100.00% | 1.96 | 13837 | 14 |
| native | 12 | 315 | 98.96% | 0.95% | 13.62% | 100.00% | 2.29 | 19952 | 16 |

工具有效率以工具请求次数为分母，要求工具名与参数形状合法；动作失败独立计算。模型失败包括供应商故障、解析失败、拒绝与截断；本机截止或关闭取消独立计数。本次没有截止取消或关闭时尚未完成的醒来。上表平均轮数来自运行器的成功轮数，失败的模型调用另在调用数及失败率中计入。

## 验收与逐线路选择

| 项 | JSON | native | 门槛与结论 |
|---|---:|---:|---|
| 整体工具有效率 | 320/332，96.39% | 380/384，98.96% | ≥98%；JSON 未通过，native 通过 |
| 截止前完成醒来 | 134/134 | 136/136 | ≥99%；两轮均通过 |
| Step 模型失败率 | 3/137，2.19% | 3/192，1.56% | 旧窗口 7.37% +2 个百分点 =9.37%；两轮均通过 |
| 完整刻数 | 12 | 12 | 两轮均完整 |
| 账本与回放 | 守恒、哈希一致 | 守恒、哈希一致 | 两轮均通过 |

| 线路 | JSON 工具有效率 | native 工具有效率 | native 解析失败 | 本次选择 |
|---|---:|---:|---:|---|
| GLM `glm-5.3` | 145/154，94.16% | 121/124，97.58% | 0/123 | 显式使用 native；较 JSON 更好，但单独仍低于 98% |
| Step `step-5-preview` | 175/178，98.31% | 259/260，99.62% | 0/192 | 显式使用 native |

SPEC-P2 的数值门槛按整体统计判定。**若将 98% 加强为每条线路都必须达到，GLM 本次仍未通过，不能把整体通过表述为每条线路都通过。** GLM native 有三次工具请求的参数形状不合法，但没有解析失败或供应商故障；遥测不保留原始回复，因此本次不据此臆测具体错误参数。Step native 的三次模型失败均为线路超时。动作失败包含规则拒绝、参数错误、地点缺少模块等，不等同于软件故障。

## 初值

根据本次结果，两条真实线路均显式设 `toolMode: "native"`；保留 `agentLoop = { turns: 4, looks: 6, lookChars: 3000, wakes: 2, wakeTurns: 2, marginSec: 60, debounceSec: 20 }` 与并发 **6**。主醒来实际最多 4 轮，被叫醒最多 2 轮；所有醒来均留有充分截止余量，没有数据支持扩大这些上限。

配置片段见 [p2-runtime-initial.json](p2-runtime-initial.json)，与已有线路的 provider、model、endpoint 和凭据变量引用合并使用。它不含密钥，不启动服务。兼容性的库缺省 `toolMode: "json"` 和旧世界行为不变，真实第二前提线路通过显式配置选择 native。本次不修改物理参数或部署配置。

测量沿用 GLM `maxTokens=1200`、Step `maxTokens=8192`、两线 `timeoutMs=120000`；Step 使用原来的 low 推理设置。部署规格 §19 要求的 Step 至少 180000 毫秒由部署阶段落实，本次没有声称测过该超时值。

## 轮数、token 与估算

按实际模型调用分组，一轮醒来的平均输入约 5.6k–6.2k token，四轮约 26.2k–33.4k；低于方案 §8.1 的约 9k 与 45k 估算。JSON 每次醒来平均输入输出合计约 13.84k，native 约 19.95k。估算是预算预测，不把低于预测视为功能失败；本次没有实测到输入开销超过该保守预测。

native 这轮报告用量 2,713,450，JSON 为 1,854,186。第二轮承接第一轮的世界状态，调用次数与行为也不同，不能将差值全部归因于调用格式。仅据本次结果选出较可靠的可运行初值，不把两轮当作独立、同时的因果对照。

## Q40：结果是否补交

native 的 136 次醒来中，40 次因动作名额耗尽而结束；其中 6 次的最后一个动作失败，30 次还留有可用的模型轮数，5 次同时满足这两个条件。JSON 的对应数量为 15、3、9、3。最后失败的结果不会在该次醒来里再交给模型，这是已确认的 A 行为。

建议**暂时保留 Q40 A**：若改 B，对本次 native 样本可能新增最多 30 次反馈调用（相当于现有 315 次调用的约 9.5%），但是否减少重复错误尚无对照证据；能明确补交最后失败且仍有轮数的样本只有 5 次。若设计方要进一步优化，建议单独评估 B 或 C；本次没有擅自增加反馈轮或修改摘要错误格式。

## 证据与限制

数字遥测 `calls.jsonl`、`wakings.jsonl` 与 `result.json` 已独立重新汇总并逐字段比对。JSON 阶段前 176 条命令与最终 391 条命令分别回放，与记录的状态哈希一致；两者均通过守恒检查。核验结果保存在运行目录的 `verified-analysis.json`。报告不含提示、回复、独白、动作参数或密钥。

报告完成时 `npm test`（启用第一纪冻结世界）1112 项全部通过，无失败、取消或跳过；premise 0/1 黄金样本保持一致。两个生产旧世界的冷备份再次回放通过。配置片段离线解析通过，没有为核验追加真实模型请求。

JSON 与 native 连续运行于同一独立世界，第二轮承接第一轮的状态；顺序与城内变化是比较的限制。十份本地草稿复制后仅将入境日设为 0，源文件与生产世界不变。

进度与数字遥测：/Users/mac/images/projects/as4-premise2/data/p2-measurements/2026-10-05-efspr4i5。不记录模型提示、回复、独白或动作参数。世界命令日志仍按原协议保存居民行动。

逐模型结果：
```json
[
  {
    "mode": "json",
    "models": {
      "glm-5.3": {
        "calls": 128,
        "cancelled": 0,
        "modelFailures": 4,
        "modelFailureRate": 0.03125,
        "parseFailures": 4,
        "parseFailureRate": 0.03125,
        "attempts": 154,
        "valid": 145,
        "toolValidRate": 0.9415584415584416,
        "actions": 89,
        "actionFailureRate": 0.1348314606741573,
        "wakings": 62,
        "unfinished": 0,
        "wakes": 2,
        "beforeDeadlineRate": 1,
        "turnsPerWaking": 2.064516129032258,
        "tokensPerWaking": 12922.725806451614,
        "input": 782702,
        "output": 18507,
        "lastCallMarginP01Ms": 719696
      },
      "step-5-preview": {
        "calls": 137,
        "cancelled": 0,
        "modelFailures": 3,
        "modelFailureRate": 0.021897810218978103,
        "parseFailures": 1,
        "parseFailureRate": 0.0072992700729927005,
        "attempts": 178,
        "valid": 175,
        "toolValidRate": 0.9831460674157303,
        "actions": 173,
        "actionFailureRate": 0.23699421965317918,
        "wakings": 72,
        "unfinished": 0,
        "wakes": 12,
        "beforeDeadlineRate": 1,
        "turnsPerWaking": 1.875,
        "tokensPerWaking": 14624.680555555555,
        "input": 835849,
        "output": 217128,
        "lastCallMarginP01Ms": 476828
      }
    },
    "replay": {
      "ok": true,
      "commands": 176,
      "hash": "fd08ba74ffc1a74bb6323c9f4d2c3ea5db19fb5b64a0b53f1cc670e1cfdfdaa0",
      "diff": null
    }
  },
  {
    "mode": "native",
    "models": {
      "glm-5.3": {
        "calls": 123,
        "cancelled": 0,
        "modelFailures": 0,
        "modelFailureRate": 0,
        "parseFailures": 0,
        "parseFailureRate": 0,
        "attempts": 124,
        "valid": 121,
        "toolValidRate": 0.9758064516129032,
        "actions": 150,
        "actionFailureRate": 0.12,
        "wakings": 64,
        "unfinished": 0,
        "wakes": 4,
        "beforeDeadlineRate": 1,
        "turnsPerWaking": 1.921875,
        "tokensPerWaking": 13573.171875,
        "input": 846883,
        "output": 21800,
        "lastCallMarginP01Ms": 721403
      },
      "step-5-preview": {
        "calls": 192,
        "cancelled": 0,
        "modelFailures": 3,
        "modelFailureRate": 0.015625,
        "parseFailures": 0,
        "parseFailureRate": 0,
        "attempts": 260,
        "valid": 259,
        "toolValidRate": 0.9961538461538462,
        "actions": 217,
        "actionFailureRate": 0.14746543778801843,
        "wakings": 72,
        "unfinished": 0,
        "wakes": 12,
        "beforeDeadlineRate": 1,
        "turnsPerWaking": 2.625,
        "tokensPerWaking": 25621.76388888889,
        "input": 1609784,
        "output": 234983,
        "lastCallMarginP01Ms": 567102
      }
    },
    "replay": {
      "ok": true,
      "commands": 391,
      "hash": "c2a19c046d49845dc2436688d933c1a99250820edc1b573d87a67a6cbbcdc1c3",
      "diff": null
    }
  }
]
```

旧世界比较基线（2026-10-04 审计的 current 窗口）：
```json
{
  "source": "2026-10-04 audit current window",
  "models": {
    "glm-5.3": {
      "calls": 190,
      "providerFailures": 0,
      "parseFailures": 2,
      "modelFailureRate": 0.010526315789473684
    },
    "step-5-preview": {
      "calls": 190,
      "providerFailures": 9,
      "parseFailures": 5,
      "modelFailureRate": 0.07368421052631578
    }
  }
}
```

数值门槛、逐线路限制与初值选择见上文。本次测量已完成；生产部署仍不在实现范围内。
