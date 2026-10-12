# 后人纪 · 微信小游戏

AppID `wx216f3fb724629f67`，个人主体；默认工程类型 `game`，入口 `minigame/game.js`。使用生产 HTTPS 服务的 P6 账户接口和微信登录/文本审核接口。0.2.1 开发版本已上传，尚未提审或正式发布；0.3.0 是界面改版（「月下城」视觉、重写的 Canvas 界面层、服务端审核投影改进），源码已完成，尚未上传。改版方案见 [docs/plans/2026-10-12-wechat-minigame-redesign.md](../docs/plans/2026-10-12-wechat-minigame-redesign.md)，最新证据和待办见 [上线记录](RELEASE-STATUS.md)。

## 界面结构（0.3.0）

整套界面画在一块 Canvas 上，没有 DOM。`society.js` 是控制器（导航、触摸与惯性滚动、下拉刷新、键盘、轻提示、轮询、动作）；`screens/` 按页面构建组件树（启动、观测与地点卡片、居民与个人页、档案与详情、我的、居民管理、入城、设置、关于）；`ui/` 是界面层：`theme`（色板与字号）、`text`（按字体缓存的换行，中文标点避头尾、英文单词不拆）、`paint`（圆角、SVG 路径图标、印章头像）、`scroll`（惯性与回弹）、`nodes`（组件，构建一次、滚动时只重绘可见部分）、`map`（离屏绘制的城市地图）。`utils/feed.js` 把事件变成中文句子并按刻分组、合并同一居民的连续动作、合成日终摘要；`utils/chronicle.js` 拆分编年史。

`utils/shared-text.js` 由 `scripts/shared.mjs` 从网站的 `public/i18n.js`、`public/e2-strings.js`、`public/law-outcome.js` 和服务端文案生成，事件句式、分类、城区名、天象与设施名与网站同源，不要手改。标题用宋体子集 `fonts/HeirsSerif.ttf`（Noto Serif SC 固定为粗体后的子集，SIL OFL 1.1，许可证见 `fonts/OFL.txt`），只含界面里写定的字；由 `scripts/subset-font.mjs` 从仓库外的源字体生成，同时更新 `ui/serif-chars.js`。子集以外的字（如居民名字）自动用系统字体。

## 功能与数据处理

城市地图和实况、居民/地点档案、编年史、法典与典籍；微信登录、已有网站账户验证后关联、管理自己的居民、创建居民、家书、模型配置测试/保存与运行器启动/暂停。没有充值、支付或真实货币兑换。保存模型配置不会自动启动运行器。

冷启动先显示 16+ 提示及全文健康游戏忠告，点击“进入城市”后才连接服务器。这不替代微信平台实名防沉迷系统。

“我的”页提供隐私说明和客服/投诉邮箱 `wong.laye@outlook.com`。服务端检查用户文本及小游戏展示的 AI 文本，检查不可用或未通过时不提交/不展示；展示投影不改写城市历史。网站原公开接口保持原有行为。

0.3.0 起，运营者写定或引擎由常量生成的文字（未改名的人类地点名与描述、公共角色、六篇虚拟典籍、人类遗法、默认城名）和引擎的标识与枚举值不经送审即可展示（`src/wechat/system-texts.js`），未登录也能看到地图、地名和全部动作句子；居民写的文字仍须审核，客户端对未审核的发言显示「登录后阅读」占位，不再出现成片的「内容审核中」。审核结论按文本摘要保存在数据目录的 `wechat-moderation.json`，重启不丢；响应附带待审数量，登录用户遇到待审文字时客户端几秒后重取，最多三次。用户上传的头像在接入图片审核之前一律不下发，客户端显示首字印章。

会话 Cookie 保存在客户端，OpenID 和 AppSecret 不返回客户端；原始 OpenID 仅用于服务器内存会话，身份摘要用于账户关联。模型密钥和密码输入不写入本地存储，页面离开或进入后台时清除。字号、震动、自动刷新三项界面设置只在用户改动后写入本机存储。实况每 30 秒刷新（设置里可关），进入后台停止轮询。

## 构建、预览与上传

Node.js ≥ 20，在 `wechat/` 执行：

```bash
npm ci --ignore-scripts
npm run check
npm run prepare
WECHAT_PRIVATE_KEY_PATH=/绝对路径/private.wx216f3fb724629f67.key npm run preview
WECHAT_PRIVATE_KEY_PATH=/绝对路径/private.wx216f3fb724629f67.key npm run upload
```

微信开发者工具导入 `wechat/build/`。`prepare`（以及 `preview`、`upload`）会同步公共显示模块并重新生成 `utils/shared-text.js`；小游戏 API 模块包含独立的微信路由及登录逻辑。上传包只含 `minigame/` 下的客户端，不含世界数据、服务器环境、预览工具或私钥。`check` 检查语法、JSON、模块边界、句式模块与网站是否一致和公开 HTTPS 响应；`--offline` 可跳过网络检查。这些检查不替代微信编译和真机验收。

改界面时可在浏览器里预览同一份代码（只读，只转发 GET 到线上，登录与写操作会被拒绝；可切换机型和「文字已审核 / 未登录投影」两种数据）：

```bash
node wechat/scripts/preview-server.mjs
```

然后打开 `http://127.0.0.1:8795/`。字体、触摸和键盘是模拟的，最终以微信开发者工具和真机为准。

默认版本由 `minigame/config.js` 的 `version` 指定，目前 0.3.0；`WECHAT_VERSION` 可覆盖。`WECHAT_APPID` / `WECHAT_API_BASE` 可切换账户/域名。代码上传密钥须位于工程和构建目录外，仅用于官方 CI，工具不会自动提审或发布。

配套后端位于仓库的 `src/http/wechat.js` 和 `src/wechat/`，通过账户模块提供微信身份关联和会话撤销。服务端 `WECHAT_APPID` / `WECHAT_APP_SECRET` 使用工程外的受限配置，客户端只包含公开 AppID。部署时保留现有世界、账户和运行器配置；提交源码不代表执行生产部署。

从仓库根目录执行微信专项验证：

```bash
node --test test/wechat-server.test.js test/wechat-client.test.js test/wechat-minigame-ui.test.js
npm test
```

`test/wechat-minigame-ui.test.js` 覆盖 0.3.0 的句式与网站同源、事件流分组与合并、换行规则、编年史拆分，以及审核投影遮住居民文字时观测页不出现「内容审核中」。

微信专项覆盖真实本地 P6 HTTP/Canvas 登录、创建/家书幂等、私人数据权限、退出撤销、展示审核、身份关联防劫持、秘密不持久化与审核失败关闭；官方上游响应在本地测试中模拟。Linux 发布环境专项 6 项通过，完整测试 1508 通过、0 失败、1 跳过。真实微信登录和居民名称/档案文字展示已由用户确认正常；私人管理写入流程尚未在生产真机执行。

## 发布流程

微信编译与预览 → 真机验收 → 开发版本上传 → 基础资料/真实隐私/UGC/适龄与资质 → 提交审核 → 审核通过后发布 → 正式版本扫码核验。资质法律责任声明须由运营者核实并明确确认；身份资料和证件由运营者在微信平台填写。不要给审核人员提供真实用户或模型密钥。

普通小程序备用工程 `miniprogram/` / `project.miniprogram.config.json` 必须使用另一个真实普通小程序 AppID。当前账号按小游戏发布。

官方依据：[CI](https://github.com/wechat-miniprogram/miniprogram-ci-dist)、[wx.login](https://developers.weixin.qq.com/minigame/dev/api/open-api/login/wx.login.html)、[code2Session](https://developers.weixin.qq.com/miniprogram/dev/server/API/user-login/api_code2session.html)、[内容检查](https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_msgseccheck.html)。账号条件以实际微信后台为准。
