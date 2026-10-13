# 网站功能上线记录（2026-10-13）

用户要求把 2026-10-13 的网站功能部署到生产：管理员服务器状态与注册用户数、居民下次醒来时间、打赏页、平台托管 DeepSeek。保留当前世界 `p6-20261011`、居民、账号、运行器与配置。按 `as4-preserve-deploy` 执行，开始前与停服前都经用户确认。

## 发布身份

- 发布提交：`dc0bd1bc2f6360a6af5ab3c8938ebc9e4ede63aa`，GitHub main，2026-10-13 09:39 UTC 固定。
- 它合并了 main `4dec96b`（网站功能）与线上 `1239135`。`1239135` 是 `codex/wechat-030-fixes` 的合并提交，10-13 03:35 UTC 起在线。
- 为什么先合并：部署前核对发现线上的 `1239135` 不在 main。直接部署 `4dec96b` 会撤回 `src/http/wechat.js`、`src/wechat/projection.js` 里微信 0.3 的审核状态修复。两边改的文件不重叠，合并没有冲突。经用户同意后快进推送到 main。
- 新目录：`/opt/houren/releases/main-dc0bd1bc2f63-20261013`。旧目录 `/opt/houren/releases/wechat-launch-12391359e82a-20261013` 保留。
- 代码归档 SHA-256：`03821ef56d6688c72d785ace0b5b85152785697bedf17acc65ccf07d26e2ced1`。清单共 707 个文件。与旧版清单不同的 29 个路径，正好等于 `git diff 1239135 dc0bd1b`。
- Node 24.21.0。依赖与旧版相同（sharp 0.35.5，可选 @anthropic-ai/sdk），在新目录内用 `npm ci` 安装。

## 发布前验证

- 本机完整测试：在合并提交的干净工作树上跑，1654 项，1653 通过、0 失败、1 跳过。
- 服务器测试子集：在 Linux 隔离副本上跑，101/101 通过。覆盖服务器状态（读真实 /proc）、打赏与图片处理、托管计费与集成、下次醒来、微信服务端与客户端、部署预检、界面。
- 旧版目录与它的清单逐字节一致，线上没有清单以外的热修复。新目录的 707 个文件与清单一致；服务用户 houren 能加载 sharp 与服务端代码。
- 预检：在 03:19 UTC 的一致性备份上，用新版本完整回放 3771 条命令并做离线恢复，用时 963 秒。状态哈希与上次部署在同一停止点的记录一致（`f80d136a…`），能量与物料守恒，6 位居民、6 个运行器都有效。

## 切换

- 预检与切换都持有部署锁 `/run/houren-deploy.lock`。整点备份用的是同一把锁，所以两个完整回放不会同时运行。
- 停服前先停 `houren-laye-grok-p5.service`。它带 `Wants=houren.service`，重启循环会把停下的主服务拉起来。上线后已恢复它原来的状态。
- 停服：09:39:55 UTC 发送 SIGTERM，服务保存快照后正常退出，退出码 0。
- 一致性备份：`/var/backups/houren/site-features-20261013T093951Z/`。`data-config.tar.gz` 含整个数据目录、`/etc/houren`、服务单元与 drop-in、依赖单元、nginx 配置；`old-release.tar.gz` 是旧代码目录。
- 停止点：第 185 刻，commandN 4127，事件 1794，居民 6，账号 5，运行器 6 个（全部启用）。状态哈希 `d112739762541546955ead0a4a2198c0c6d4ff85898f65c3ae04c600886628ce`。
- 新版本在停止点副本上完整回放并离线恢复，用时 1142 秒，守恒检查通过。
- 原子切换 current 后启动，09:59:35 UTC 就绪。停服共 1183 秒（约 19.7 分钟），主要花在停服后的完整回放上。

## 上线验收

- current 与进程的实际工作目录都是新目录；服务 active，NRestarts=0。nginx、Xray active，nginx 配置未改。
- 回环与公网 `https://heirscity.site` 都通过：首页、引用的 JS/CSS、公开状态、未登录的账号接口、SSE `: connected`、微信公开状态（14 个固定地名可见）、模型预设、公开居民页。
- 新功能：`/support.html` 返回 200；`GET /api/public/support` 返回 `{"qr":{"wechat":null,"alipay":null}}`；未登录访问 `GET /api/admin/server-status` 与 `GET /api/account/hosted` 都返回 401。
- 数据：命令与事件日志的前缀逐字节保留；账号文件与停止点一致；运行器记录没有变化；用量与公共角色预算没有倒退；`/etc/houren` 与有效环境变量不变。新建的 `hosted/` 目录属主 houren、权限 0700。`support/` 会在第一次上传收款码时以 0700 创建。
- 重启后命令从第 4128 条连续接续。启动时按惯例记一条代码指纹（admin/backstage，kind=code）。
- 居民自然调用模型：重启后约 1 分钟内，a1 3 次、a2 4 次、a3 3 次、a4 1 次、a5 4 次，全部成功；a6 还没到醒来时间。
- 世界自然推进：10:14:35 UTC 到第 186 刻（重启后刻的计时重新开始，第一刻在启动 15 分钟后）。没有手动推进 tick，也没有修改法律。
- 第 186 刻之后居民继续调用模型（a2、a5 又各有成功调用），失败计数没有增加。
- 独立复核：10:01–10:24 UTC 的整点备份用新版本在隔离副本上完整回放全部世界。p6 回放 4148 条命令（含重启后新增的 21 条），6 个运行器绑定都有效，账号 5 个。备份目录 `/var/backups/houren/hourly/20261013T100101Z`。
- journalctl：自启动起没有错误或警告。

## 没做的事与待办

- 平台托管 DeepSeek 没有开启。部署过程中没有输入任何 API Key、密码或收款码。以下由管理员在后台完成：用户中心「打赏收款码」上传微信、支付宝收款码；「我的居民」页底部「平台托管 DeepSeek」填 API Key、模型 ID、三个官方单价，并勾选开放；可选地给测试账号小额入账试一次。
- nginx 没改：`client_max_body_size` 仍是 1m，收款码图片要小于 1 MiB。应用本身允许 2 MiB。
- `houren-laye-grok-p5.service` 仍然每 30 秒失败重启一次（部署前就这样），这次没有处理。
- 服务器上暂存的 `deploy-miniprogram-20261013`（`68ddeaa`）已标记取消。它的脚本要求 current 是旧目录，现在会在停服前自行中止。

服务器受限记录：`/opt/houren/deploy-site-features-20261013/`（`phase.json`、`result.json`、`deployment.log`）。
