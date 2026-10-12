# 后人纪 · 微信小游戏

面向 AppID `wx216f3fb724629f67`（个人主体）的 Canvas 小游戏客户端。默认工程类型为 `game`，入口为 `minigame/game.js`，复用现有生产 HTTPS API；不会部署或替换生产引擎与世界数据。

## 功能

城市实况、可点选地图、居民搜索与墓园、居民及地点档案、编年史、法典、典籍、社群与摇篮；网站账号注册/登录/退出；造者密钥连接、家书、运行器启动/暂停、账号关联；模型连接测试、托管入城和一次性凭据复制。当前版本没有充值、支付或真实货币兑换。网页管理界面、完整用量图表、领养/过继、天象投票尚未移植。

线上运行词元/材料版本，客户端同时兼容本地两代引擎。公开实况每 30 秒刷新，进入后台停止轮询。网站会话按现有 Cookie 协议处理；造者密钥仅留内存，模型 API Key 不写入本地存储，切入后台清除输入中的密码和模型密钥。

## 构建与验证

Node.js ≥ 20；在本目录执行：

```bash
npm ci --ignore-scripts
npm run check
npm run prepare
```

微信开发者工具导入 `wechat/build/`。源码位于 `wechat/minigame/`，当前约 33 KiB；源文件大小不代表微信编译后的包大小。`prepare` 同步公共 API/显示模块，输出独立工程，不包含世界数据、模型配置或上传凭据。`check` 验证 JSON、JavaScript 语法、模块引用及只读生产接口；离线检查用 `node scripts/release.mjs check --offline`。结构与 HTTP 检查不替代微信编译、真机测试或审核。2026-10-11 微信官方 CI 编译、预览生成与开发版本 0.1.0 上传成功，后台显示上传时间 19:46:13；用户已扫码确认真机预览正常。服务类目已通过并进入审核流程，当前平台拦截为“缺少资质材料”；尚未提交版本审核或正式发布。

仓库根目录执行接口及客户端测试：

```bash
node --test test/wechat.test.js test/accounts.test.js test/account-agents.test.js test/managed-runner.test.js
```

2026-10-11：30 项通过，包括小游戏 Canvas 导航、真实本地 HTTP 会话、造者私有数据隔离、家书、托管入口、秘密不持久化、后台轮询停止和线上响应兼容性。

## 上传

使用官方 `miniprogram-ci`，按 `miniGame` 上传。私钥必须位于源码和构建目录之外，不放入 Git，也不要通过聊天发送。

```bash
WECHAT_PRIVATE_KEY_PATH=/绝对路径/private.wx216f3fb724629f67.key npm run preview
WECHAT_PRIVATE_KEY_PATH=/绝对路径/private.wx216f3fb724629f67.key npm run upload
```

默认版本 `0.1.0`，可用 `WECHAT_VERSION` 覆盖。通过 `WECHAT_APPID`、`WECHAT_API_BASE` 可生成其他账号/域名工程。当前登录复用网站账号，不需要 AppSecret。CI 需要代码上传密钥和允许上传的出口 IP；也可在微信开发者工具登录上传。工具只上传开发版本，不自动提审或发布。

## 后台状态与上线步骤

2026-10-11 通过管理员扫码实际核验：AppID 与个人主体正确；名称「后人纪之词元本位」审核中；服务类目「游戏 → 其他游戏」已添加并显示已通过。`request` 合法域名已成功保存 `https://www.heirscity.site`，保留原有 `https://api.deepseek.com`。代码上传密钥已在明确授权后生成并存放于本机工程外，上传 IP 白名单已添加本机出口 `219.236.8.200`，白名单校验保持开启。

介绍已更新为实际 AI 社会模拟游戏。名称、游戏资质、备案、隐私/UGC 和适龄提示仍需完成或核验。微信授权登录与内容安全集成尚需补齐，详见 [上线记录](RELEASE-STATUS.md)。首页显示未备案；用户隐私保护指引已更新但内容尚待逐项核对，UGC 未声明，适龄提示未设置。不能把域名配置成功、上传成功或审核提交当作正式上线。

上线顺序：微信编译与预览 → 真机验收 → 开发版本上传 → 完善基础资料、备案、真实隐私与内容声明 → 提交微信审核 → 审核通过后发布 → 微信扫码核验正式版本。运营者身份、证件、真实联系方式及备案承诺由运营者填写/确认，不编造信息。涉及创建居民或模型调用的验收使用独立测试世界。

普通原生小程序源码保留于 `miniprogram/`，备用工程为 `project.miniprogram.config.json`。只有使用真正的普通小程序账号时，才通过 `WECHAT_TARGET=miniprogram WECHAT_APPID=wx真实AppID npm run prepare` 构建该版本。

参考：[微信官方 CI 仓库](https://github.com/wechat-miniprogram/miniprogram-ci-dist)、[微信网络配置文档](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)、[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/devtools.html)。账号限制及审核以实际微信后台为准。

## 0.2.0 配套后端

新版小游戏需要隔离工作树 `/Users/mac/.codex/worktrees/wechat-auth/as4` 的微信服务端集成。服务端通过受限配置读取 `WECHAT_APPID` 和 `WECHAT_APP_SECRET`，客户端不得包含 AppSecret。微信后台隐私指引需同步客服邮箱 `wong.laye@outlook.com` 与微信身份、文本审核数据流。

P6 使用账号居民管理；0.2.0 取消旧的造者密钥、港口注册和一次性凭据入口。0.1.0 已上传，不含这次集成；0.2.0 必须先完成后端部署和真实联调，再上传并提审。
