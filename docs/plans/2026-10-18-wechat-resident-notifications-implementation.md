# 微信居民提醒实现计划

目标：在既有微信普通小程序提供已确认的四类提醒，隔离存储，按当前管理权授权，支持离线发送和90天记录。
架构：NotificationService 订阅已提交的 Runtime 命令事件，观察 RunnerManager 状态变化；独立加密文件持久化订阅、接收地址、通知与投递状态。微信模板由服务端配置，默认不可发送。通过现有 accountWrap 暴露经过鉴权的接口。
技术：Node.js ESM、node:test、现有 durableFile、AES-256-GCM、微信官方 HTTP API、现有 Canvas 小程序。

- [x] src/wechat/notifications.js：加密持久化、按居民/类型偏好、单次授权票据、记录/已读/清理、归属版本失效、时间注入用于20:00边界测试。
- [x] src/wechat/service.js：发送订阅消息，模板字段白名单，失败脱敏，过期 token 处理，不在模糊超时后自动重复发送。
- [x] src/http/notifications.js：6个端点，沿用CSRF/会话，防止伪造OpenID，异步发送前复核绑定与归属。
- [x] src/http/server.js、src/config.js、src/runner/manager.js：生命周期与状态转移集成。事件恢复仅处理订阅后事件；不修改世界命令、余额或居民行为。
- [x] test/resident-notifications.test.js、test/notification-http.test.js：验证加密恢复、权限/过继、故障去重、日记汇总、授权消耗/重放、取消、90天清理、投递失败状态。
- [x] Claude Opus 5.5 桌面 Code 会话完成 wechat/** 前端和 test/wechat-notifications-ui.test.js，接口契约见 work/claude-frontend/resident-notifications.md。
- [x] 集成审查：node --test 专项、npm test、微信离线检查；记录真实结果及平台配置限制。

验收重点：不读取凭证、不向真实用户试发；生产模板需运营者选择业务匹配模板。部署、发布及真实授权投递与本地实现分别记录，不将模拟测试描述为线上可用。

实施记录：CLI未登录，前端通过 Claude 桌面 Code 模式 Opus 5.5 完成，会话 local_ade6af1e-8a2e-4b1a-8777-ad4d3c49ea7d。Codex完成后端、接口、持久化和集成验证。独立审查已修复：余额预检查误判恢复、保存偏好取消发送、解绑重绑恢复旧订阅/票据、未登录通知跳转丢失。生产模板、真机授权与正式部署不计入本地测试通过结论。
