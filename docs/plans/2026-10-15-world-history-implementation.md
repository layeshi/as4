# 世界报告与居民历史实施计划

依据已确认的 [产品方案](2026-10-15-world-reports-resident-history-design.md)，在 `codex/world-reports-history` 独立工作区顺序实施。用户已授权实施全部步骤；页面采用 `docs/VISUAL-DESIGN.md` 的共用组件、主题变量及状态规范。

## 架构

观测归档独立于确定性世界。运行时只向观察者送达已经提交的命令结果，不把归档或模型报告写回世界。归档按世界实例和分支组织，恢复旧快照时核验日志前缀并新建分支。报告使用公开投影，导出使用当前造者有权读取的记录，两种读取路径分开。

## 步骤

- [x] 归档与记录：增加 `src/history/archive.js`、`records.js`，在 `src/runtime.js` 提供提交观察入口；先验证过继、旧日志、回滚分支及失败动作的真实记录。
- [x] 历史包：增加 `src/history/zip.js`、`exports.js`，生成持久化任务与 HTML/JSON/CSV 压缩包；验证权限撤销、文件一致性、转义和表格文本安全。
- [x] AI 报告：增加 `src/history/reports.js`，实现日/月/年周期、专用加密配置、独立额度、公开素材、来源引用、重试与补生成；先用受控提供者验证生成与恢复。
- [x] 服务集成：增加 `src/http/history.js`，复用账号会话和请求验证，接入 `src/http/server.js` 生命周期，覆盖网页及微信的内容检查。
- [x] 网页：增加 `public/reports.html`、`reports-ui.js`、`history.html`、`history-ui.js`，复用 `console-ui.js`；在观测站、居民详情和管理后台增加入口与管理面板。
- [x] 微信：增加 Canvas 报告及导出页面和控制器，复用主题与节点组件，完成带会话的下载与平台文件保存；运行小程序离线构建检查。
- [x] 验收：执行专项和全量回归；真实浏览器检查 375、768、1280、1920 宽度、深浅主题、长内容和异常状态；微信预览检查三类机型。记录证据、完成范围与环境限制。

## 验证命令

归档与报告：`node --test test/history.test.js test/history-http.test.js`。

微信：`node --test test/wechat-client.test.js test/wechat-minigame-ui.test.js test/wechat-history.test.js`，随后 `npm --prefix wechat run check -- --offline`。

完整回归：`npm test`。测试数据全部使用临时世界；不读取生产居民私人记录，不进行生产部署。

## 交付

功能已在独立工作区实现，验证范围、截图与限制见 [验收记录](../audits/2026-10-15-world-history/REPORT.md)。未执行生产部署；微信开发者工具与真机仍须在发布环境验证。
