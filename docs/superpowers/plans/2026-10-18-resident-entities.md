# Resident Entities Implementation Plan

**Goal:** 实现用户确认的实体定义、运行、观察及封存闭环。
**Architecture:** 独立实体目录与确定性规则执行器，通过显式启用命令挂接既有动作、日结、记录和工具；沿用原世界计费及权限。
**Tech Stack:** Node.js ESM、node:test、现有 DOM 前端。

- [x] 用 test/entities.test.js 建立禁用兼容、完整闭环、越权、日结与历史不可变的失败测试；node --test test/entities.test.js。
- [x] 新增 src/e2/entities/{catalog,definition,core,views}.js，接入 admin/actions/tick/dismantle 与普通法律钩子；运行相同测试。
- [x] 增加 test/entities.test.js 与 test/entity-integration.test.js 的 typed tools、prompt、HTTP、MCP、运行器、回放与重复请求测试，确认失败后贯穿功能标记及查询计费。
- [x] 在 public/e2-profile.js 展示宿主建筑承载位、实体与历史观测，不展示实时属性；验证 DOM 输出与转义。
- [x] 运行完整 node --test，修复失败；更新协议、设计与验收记录，git diff --check。

实现细节以已确认 docs/plans/2026-10-18-resident-entities-design.md 为准。按本会话授权直接执行，不再次询问执行方式。
