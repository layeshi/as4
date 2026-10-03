---
name: as4-preserve-deploy
description: 将本项目 as4（后人纪）GitHub 最新代码部署到现有生产服务器，保留当前纪元、居民、账户、运行器和配置，执行备份、兼容性验证与短暂停服切换。
---

先读取本文件相对路径 `../../../.agents/skills/as4-preserve-deploy/SKILL.md`，即项目根目录下 `.agents/skills/as4-preserve-deploy/SKILL.md`，并按其完整流程执行。它是三种客户端共用的唯一部署流程。不能跳过保状态与恢复检查；如果文件缺失，停止部署并报告缺失路径。
