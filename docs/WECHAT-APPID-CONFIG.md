# 普通小程序身份配置

当前普通小程序为 `wx83d31aa7fc9a797e`。0.4.0 客户端已经在登录请求中发送这个 AppID，并在状态查询中指定相同 AppID。

服务端需在受限环境配置中同时设置：

- `WECHAT_MINIPROGRAM_APPID`：`wx83d31aa7fc9a797e`
- `WECHAT_MINIPROGRAM_APP_SECRET`：该普通小程序在微信后台的 AppSecret。不得填写旧小游戏或另一小程序的密钥。

原有 `WECHAT_APPID` / `WECHAT_APP_SECRET` 继续服务旧小游戏。普通小程序请求根据 AppID 选择自己的密钥、令牌和文本审核服务。未指定 AppID 的旧客户端保持原行为；未知 AppID 返回 `wechat_app_unknown`，不会回退到其他应用凭据。

账号身份仍按 `AppID:OpenID` 摘要保存。需要继续管理已有网站居民时，先在小程序登录原网站账号，再关联微信；不能根据不同 AppID 下的 OpenID 自动合并账号。

上线必须通过保状态部署流程，保留世界、账户、运行器及凭据。当前发布已开启网页登录限制，健康检查应分别确认网页匿名接口返回 `login_required`、微信专用城市接口可访问。

验证项目：

1. `GET /api/wechat/status?appid=wx83d31aa7fc9a797e` 返回匹配 AppID、`enabled: true`，未登录时 `verified: false`。
2. 使用该 AppID 的真实小程序执行微信登录，登录后同一状态接口返回 `verified: true`。
3. 验证居民与家书的权限及文字审核使用同一小程序凭据。
4. 未知 AppID 被拒绝，旧小游戏的登录状态不被误判为普通小程序已验证。

`enabled` 仅说明配置存在，不代表微信上游已验证密钥有效；真实凭据验证与手机登录验收应单独记录。
