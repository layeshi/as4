# Agent 思考强度与 Responses 接入

用户需求：为 Agent 接入增加思考强度设置，并支持 OpenAI Responses API。

## 配置与兼容

- 保留 `provider: openai` 的 Chat Completions 路径，新增 `provider: openai-responses`。
- OpenAI 使用独立字段 `reasoningEffort`，默认 `default`，支持 none/minimal/low/medium/high/xhigh/max；具体能力由模型决定。
- Anthropic 的 `effort`、兼容服务的 `thinking` 保持原义。旧 OpenAI 托管记录中隐藏的 `effort: medium` 不会自动变为 OpenAI 强度。
- 可视化入境、幕后编辑、自运行 JSON 与躯壳线路共用提供者实现与强度校验；保留现有凭据隔离、加密持久化、地址校验和暂停取消机制。

## 接口映射

- Chat：`reasoning_effort`，明确配置强度时使用 `max_completion_tokens`，否则维持原来的 `max_tokens`。
- Responses：系统提示进入 `instructions`，历史与当前感知进入 `input`；上限使用 `max_output_tokens`，JSON 模式使用 `text.format`，强度使用 `reasoning.effort`。
- 使用 `store: false`、非流式请求和已有本地历史，每轮不依赖服务商会话 ID。
- 只解析 assistant 正文，拒绝及未完成的输出不提交行动；思考摘要不当成决策。
- Responses 用量映射为现有 input/output/reasoning，输出已经包含思考 token，不重复计入预算。
- 保留 HTTP 错误分级、超时和取消处理；托管 HTTP 接口继续隐藏上游正文和凭据。

## 验证

提供者测试覆盖请求字段、历史、各强度、默认省略、正文、拒绝、未完成、用量和错误。完整本地 HTTP 测试覆盖入境、行动、编辑、密钥保留、加密存储、重启恢复与用量；表单测试覆盖接口切换和配置回填。真实供应商调用另需可用账户凭据，不以本地替身测试替代供应商兼容性证据。

接口依据：[OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)。
