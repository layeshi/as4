# 第四前提独立代码审查

日期：2026-10-10（Asia/Tokyo）。固定范围：`d735b58e6f6ad0f0da08efc4378a7ff28310686a` → `7d6b4905b5bb917de596cb8c5abdc8096a752237`。

审查命令：`git diff d735b58...7d6b490`；提交记录：`git log d735b58..7d6b490 --oneline`，共 18 个提交。覆盖第四前提全部实现、Q61–Q68 定案与 Q60 查询优化。两个独立审查员分别进行 Standards 与 Spec 审查，主审另行复现 HTTP 会话计价问题。两个轴分别报告，不将规范异味与规格功能问题混为一项。

权威来源：SPEC-P4、QUESTIONS Q61–Q68 最终决定，以及 SPEC-P2/P1/E2、PROTOCOL-2、CONTEXT 与现有 ADR。Q65 按免费习得最终决定审查；Q60 当前验收结果已被用户接受，不列为新问题。仓库没有单独的编码规范文件，也没有 issue-tracker.md；本次有完整本地规格，不依赖外部问题追踪器。

## Standards

### C1 · P3：第四前提参数校验影响旧前提启动（硬规范）

定位：`src/config.js:73`，无条件执行 `tokenCapacity/tokenBasic` 正整数校验。

规范：SPEC-P4 §0.3.1「premise 0、1、2 的世界一点不变」；§2.1（第 114 行）「新的环境变量（只在创建第四前提的新世界时读，之后以世界状态为准）」。

复现：`loadConfig({ PHYSICS: '2', PREMISE: '2', TOKEN_CAPACITY: '0' }, [])` 在当前版本抛出 `tokenCapacity 必须是正整数`；基线不读取该环境变量。旧世界若继承含无效 P4 参数的共享环境，将不能启动。建议把新参数有效性校验限制在第四前提新世界创建入口，保持旧世界忽略这些变量的行为，并补旧前提兼容用例。

### C2 · P3：Data Clumps，感知查询结果用长位置参数传递（判断性异味）

定位：`src/e2/engine/perception.js:135`、`:456`。

hunk：`actionsView(w, a, l, lang, costs, wall.length, openOffers, openPacts, projectsHere, openProposals, pendingRefounds, activeGroups)`。

新增多个同形数组查询结果后，调用与签名达到 12 个位置参数，维护时容易错位。依据 code-review 的 Data Clumps 启发式，建议采用命名 query 对象，参考同一 diff 中第一纪感知的实现。此项是可维护性建议，不是已证实功能错误或上线阻塞。

## Spec

### S1 · P1：MCP 居民无法获取习得内容

定位：`mcp/tokens.js:30–32`、`:40`。`houren_rules` 构建系统提示时没有传 trained；`houren_perceive` 只返回醒来接口的 text，丢弃包含 trained 的 system。P4 免费 GET /me 也不返回 trained，look self 不显示该区块，因此 MCP 工具没有习得内容的获取路径。

规格：SPEC-P4 §4.3（第 271 行）「仍随系统提示提供给模型」；§15（第 855 行）「其余拼接（习得、typed 工具的说明）同第二前提」；§14 要求 rules「照旧返回不含灵魂的系统提示」。旧 MCP rules 通过 promptParams 传入 trained。

独立审查员使用本机真实 HTTP/MCP 复现：注册 P4 居民，在身体 trained 中放入唯一标记，rules/perceive/look self 均成功但均不含该标记；相同居民 HTTP wake.system 包含标记。居民支付内化费用后，在 MCP 中无法使用习得，托管运行器却可以使用。

建议让 MCP 交付居民的习得提示，利用已返回的醒来 system；免费 rules 也应保留免费习得，并继续遵守不含灵魂的要求。增加真正检查工具输出包含 trained 的集成用例。规格明确要求 rules 不含灵魂，因此不把灵魂缺失单独列为问题。

### S2 · P2：read/draft 返回文字没有进入会话计价上下文

定位：`src/http/tokens.js:127`，动作成功后只执行 `s.ctx += result.writeWeight`；read/draft 在引擎内虽支付读入费，其成功返回的长文本分量并未加入 ctx，后续轮次永久漏算其重读。

规格：SPEC-P4 §4.3（第 273 行）ctx 为「这次醒来已在上下文里的计价总分量」；第 276 行要求重读为 `⌈(ctx − fresh) × 0.1⌉`；第 278 行及 §9.4 将 read/draft 长文本作为收费读入，与免费短回执区分。

主审真实 HTTP 复现：wake → read law:l1（turn=1）→ look self（turn=1，替换 fresh）→ 空 act（turn=2），全部返回 200，read 动作成功。读入实际收 611 词元；read 后 ctx 实际 6873，应为 7484。后续重读实际收 688，应收 749，少收 61。没有档案模块倍率或附带新收件，fresh 已由 self 替换，故该差异不是新文字豁免或倍率差异。

建议把成功返回的 read/draft 长文本实际分量纳入 ctx，并按最近新提供文字更新 fresh；失败或回滚的动作不累加。增加跨后续 look/act 轮次的 read、draft 计价与上限测试，不能只断言首次读入收费。

## 审查验证与交付状态

本轮执行了独立 MCP 复现、真实 HTTP 计价复现与旧前提配置拒绝复现。没有修改生产代码、运行长全量测试或调用真实模型。原 1454/1454 全量通过记录仍有效，但现有用例未覆盖上述功能缺口，不应据此将审查发现视为已解决。

发现留待修复。建议先修复 S1、S2，再完成浏览器验收；C1 应补兼容修复，C2 可作为后续维护改进。修复后先运行针对性测试，再按影响范围完成回归，并更新此文的问题状态。

总计：Standards 2 项，最严重为 P3 旧前提配置兼容；Spec 2 项，最严重为 P1 MCP 习得不可达。
