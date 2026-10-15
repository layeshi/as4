# 管理员公告实施计划

> **For agentic workers:** Use superpowers:executing-plans inline, following the user's authorization to implement. Do not delegate to subagents.

**Goal:** 在网页与微信端交付共享的管理员公告，遵守已确认设计和 docs/VISUAL-DESIGN.md。

**Architecture:** 公告使用 DATA_DIR/announcements.json 独立持久化，复用 durableFile 原子写入。公共读取使用 /api/announcements，不经过世界数据或居民文字投影；管理写入复用管理员账号会话与请求验证。网页复用 console-ui.js 和 console.css，微信端复用 Canvas nodes 与主题。

**Tech Stack:** Node.js 原生 ES 模块、node:test、原生 DOM/CSS、微信 Canvas。

## 1. 公告存储与接口

- [x] 新建 test/announcements.test.js，先验证缺失接口导致失败。
- [x] 新建 src/announcements.js：Unicode 字数校验、发布顺序游标、编辑/撤下/重发、修订冲突检查、操作记录、原子保存与加载校验。
- [x] 新建 src/http/announcements.js：匿名列表/最新/详情；管理员列表、发布、编辑、撤下与重发。
- [x] 修改 src/http/accounts.js 的包装器以允许此功能指定 64 KB 请求体上限，其他接口保持原有上限；修改 src/http/server.js 挂载独立存储与路由。
- [x] 修改 src/http/login-wall.js 放行公告页，验证登录门开启仍可匿名阅读。
- [x] 执行 node --test test/announcements.test.js，覆盖权限、排序、撤下旧链接、Unicode 边界、重启与世界边界。

## 2. 网页阅读与管理

- [x] 新建 test/announcements-ui.test.js，验证匿名可读、纯文字、错误重试、表单保留和管理操作。
- [x] 新建 public/announcements.html、announcements.js、announcements-ui.js 和 announcements-admin.js，使用现有 shell/pageHead/card/btn/emptyState。
- [x] 修改 public/console-ui.js、accounts.js、admin.js 添加公告导航、用户中心管理入口和后台管理分区。
- [x] 修改 public/app.js、index.html、login.html、login.js：最新公告提示与登录前公告入口；新增样式仅用现有变量、排版层级与断点。
- [x] 执行 node --test test/announcements-ui.test.js test/ui.test.js test/admin-console-ui.test.js。

## 3. 微信端

- [x] 新建 test/wechat-announcements.test.js，先验证未实现的匿名入口和详情失败。
- [x] 新建 wechat/minigame/announcements.js、screens/announcements.js，修改 screens/index.js、screens/city.js、screens/me.js 与 society.js。
- [x] 复用 /api/announcements，冷启动确认前不联网；支持列表分页、详情、刷新、加载和错误状态，迟到响应不能覆盖新页面。
- [x] 执行 node --test test/wechat-announcements.test.js test/wechat-client.test.js test/wechat-minigame-ui.test.js，并执行微信离线检查。

## 4. 验证与交付（最终回归结果见验收报告）

- [x] 按视觉规范在网页 375/768/1280/1920、深浅主题与中英文截图；检查长内容、空、失败、未登录、无权限和管理员状态。
- [x] 浏览器 Canvas 预览检查微信端 375×667、390×844、393×851，验证列表、长详情与匿名入口。
- [x] npm test 完整回归，git diff --check；记录实际验证结果与不能完成的真机验证。
- [x] 更新公告说明、词汇表、ADR、视觉规范的组件/入口说明与设计状态；不执行生产部署或微信上传。
