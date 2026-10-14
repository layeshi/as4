# 资料卡、协作单与往来记忆 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in the approved isolated worktree.

**Goal:** 在现有第六前提世界显式启用可复用知识、长期协作及按需往来记忆。

**Architecture:** 能力由日志内的 admin/cooperation 操作启用。新数据仅在启用后存在，核心动作复用确定性命令、事务与文字计费；三个精简工具与三个分页查询入口接入既有运行器。观众只能读取公开或已到延迟的历史版本。

**Tech Stack:** Node.js ES modules、node:test、原生网页组件；无新增依赖。

## 1. 能力与核心机制

- [x] 在 `src/e2/cooperation/` 新建 `core.js`、`cards.js`、`collaborations.js`、`relations.js` 和 `views.js`，分别管理能力、卡片版本及权限、协作状态及交接、事实及私人评价、受权限控制的视图。
- [x] 创建 `test/cooperation.test.js`，先证明未启用不会增添世界状态、启用幂等；权限撤销、验收、退出、交接、评价限制及历史版本的测试先失败再实现。
- [x] 在 `src/e2/engine/admin.js` 接入 `{op:'cooperation',args:{version:1}}`；在 `actions.js` 与 `lore/actions.js` 按能力版本启用 card/collaborate/relation 三个工具。
- [x] 在 `engine/index.js` 命令完成时索引实际交往事实，忽略重复回执，不触发新唤醒。旧能力未启用路径必须保持无新状态。
- [x] 运行 `node --test test/cooperation.test.js`，期望全部通过。

## 2. 计费、上下文与接入

- [x] `src/http/tokens.js` 提供 cards/collaborations/relations 查询并执行 1200/3600 字符限制；返回文本进入既有 meter/read/reread 路径，额度失败不提供正文或消耗查询预算。
- [x] `engine/perception.js`、`runner/render-p2.js`、`runner/prompt.js` 提供能力标志及最多400字符概要，不载入全部正文。
- [x] `runner/action-tools.js`、`runner/loop.js`、`mcp/server.js`、`mcp/tokens.js` 传递分页及版本参数；能力未启用时不增加工具定义。
- [x] `test/cooperation-http.test.js` 验证额度不足、分页、共享累计查询上限、重复输入计费及各客户端 schema；期望预算或权限失败时无正文泄漏。

## 3. 人类观测

- [x] `src/http/public.js` 增加 `/api/public/cooperation` 分页列表/详情；`visibility.js` 只给出能力标记，不将全历史塞进公共快照。
- [x] `public/cooperation-ui.js` 提供卡片、协作、延迟评价观测页面；在 `e2-tabs.js`、`app.js`、`i18n.js` 依既有模式接入。
- [x] 使用真实 HTTP 合成世界及浏览器验证空态、历史版本、分页和居民文字转义。

## 4. 验证与交付

- [x] 新机制启用前后的命令重放、receipt恢复与保存/恢复哈希一致；旧主线基线场景哈希相同。
- [x] 运行针对性测试及完整 `npm test`。权限、计费、历史回放、关系容量和交接争议为必要验证点。
- [x] 生成 `docs/audits/2026-10-14-knowledge-cooperation/REPORT.md`：改动、实际测试结果、合成场景上下文增量、城内费用及真实模型账单未调用的限制。
- [x] 更新 `docs/PROTOCOL-2.md`、README和设计状态，提交独立分支，交付可审查结果。生产部署不属于本次实现范围。
