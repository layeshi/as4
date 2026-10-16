# 三城（PREMISE=7）实现交接

写于 2026-10-16。交接人：Claude；接手人：Codex。用户的要求是照这份文件把「一城扩为三城」做完。

## 0. 现状

- 引擎和服务端已按方案实现第七前提「三城」。三城专项测试 11 项全过，全量测试的结果见 §5。
- 网页已经做到这一步：
  - 岛图有三级缩放：全岛级显示城牌和荒野人数，有跨城弧线；城级和地点级沿用旧图的画法。
  - 聚焦会上报给页面；有小地图，有「全岛 / 北城 / 西城 / 东城」跳转按钮。
  - 顶栏和各标签页跟着聚焦的城走，网址带上城。
  - 全岛级的侧栏先显示三城对比。
  - 布局是地图约占 2/3，侧栏可以收起，地图可以全屏；窄屏上用紧凑城牌，不显示小地图。
  - 编年史和天象的 GET 接口可以按城取。
  - 创建页（选城卡片、从旧世界带入灵魂）和「我的居民」里的籍与所在城，代码已写好，**但需要登录才能看到，还没看图验收**。
  - 地图着色有了「按籍」一种。
  - ADR-0022（按城挂载）和方案 §9「实现中补定的细节」已写好。
  - 世界报告按城分节（代码已写，还没用真实模型生成过）；交易所的当事人注明籍。
  - 微信端的第一步：
    - 城市页加了「全岛 / 北城 / 西城 / 东城」切换；
    - 全岛画岛和三块城牌（点城牌就切过去）；选了城就框住那座城；
    - 统计、标题、事件流和居民列表都跟着当前城走；
    - 新增测试 `test/p7-wechat.test.js`。
- 接手后已完成创建页、本机有居民的网页验收与微信端城级手势，详见 §6 和进度记录。
- 仍未验证：真实旧归档的灵魂带入、真实报告模型生成、微信开发者工具 / 真机的最终看图与手势验收。用户确认天象完全随机，暂不开放投票。

  详见 §6。
- 原始改动作为 WIP 提交在分支 `claude/three-cities-design` 上；Codex 接手后继续在同一分支小步提交，**没有推送，也没有部署**。

## 1. 在哪里做，守什么规矩

- 工作树是 `/Users/mac/images/projects/as4/.claude/worktrees/three-cities`，分支 `claude/three-cities-design`。它从 origin/main fc3a418 切出，没有设上游（`--no-track`）。这个分支上 fc3a418 之后的提交全部属于本任务；接手后新的改动照常提交到这个分支上。
- 主检出 `/Users/mac/images/projects/as4` 在别的分支上，混着别的会话没提交的改动。**不要往那里写**，也不要 `git stash`、`git reset` 或 `git checkout --`。
- 用户已授权在本分支小步提交（英文 conventional 信息，只暂存本任务文件）；不要推送、部署或连接生产。上线（新世界替换 p6、先冷备份、保留账号）不在本交接的范围内。
- 和用户交流用中文。
- 前提 ≤6 的世界必须逐字节不变，金样本测试会检查。改共用代码时，一律走 `w.premise === 7` 或 `multiCity(w)` 分支，不动旧前提的路径。

## 2. 先读这些

| 文件 | 内容 |
|---|---|
| `docs/plans/2026-10-16-three-cities.md` | 方案。§1 是 25 条决定，§2 物理，§3 居民看到的，§4 地图，§5 页面，§6 接口，§7 实现方式（按城挂载），§8 验收。附录 A 是岛图，附录 B 是 20 位公共角色，附录 C 是待标定的初值 |
| `CONTEXT.md` 里「世界与城」一节 | 词汇：世界、城、地界、荒野、宣告、源井、籍、迁籍、公民 |
| `docs/adr/0019`–`0021` | 0019 三个政体与籍；0020 城法属地、公共讨论按城分开；0021 源井按 3:2:1 分配，设施与井的贫富反向互补 |
| `docs/VISUAL-DESIGN.md`（技能 `as4-visual-design`） | 界面视觉规范：地图是「屏幕」，永远深色，用 `--m-*` 变量；一色一义；按实际像素画；做完截图验收 |

讨论中推出的 8 条默认值，用户已经确认，代码也已实现：
1. 标签按发出的城加前缀，例如 `north:citizen`。
2. 新生儿的籍是摇篮所在的城。开局只有北城有摇篮。
3. 移动时，出发城管离开，目的城管进入，途经的城不管。
4. 编年史按城分开；法律里 `announce` 的范围和宣告相同，只到本城地界。
5. 给公库转账要指明城：`treasury` 是所在城的公库，`treasury:<city>` 是指定城的公库。
6. K 仍按总容量算，约 1833，不变。
7. 新世界照 P6 的做法，每个账号再发一次启动词元。
8. 前提编号为 `PREMISE=7`，名为「三城」。

实现时我自己定的几处细节，方案里还没写，要补进去（见 §6.7）：
- 动作在哪座城里执行：
  - 表决（vote）在**提案所属的城**执行；
  - 重订（refound）和联署（sign）在**居民的籍城**执行；
  - 其余动作在**所在地点的城**执行。人在荒野时不进任何城，没有城法，公库为 null。
- P7 的城法不能从社群账户里取钱。`inScope` 规定 `from` 只能是本城公库，或者身在本城地界内的居民。
- 放逐：打上 `${city}:exiled` 标签；人若在该城地界内，就送到该城的放逐地（`CITIES[].exile`：北城到 scrapyard，西城到 saltflats，东城到 salvage）。

## 3. 已完成的部分：引擎与服务端

核心做法是「按城挂载」：
- 每座城一份的字段存在 `w.cities[id]` 里。
- `withCity(w, id, fn)` 在一次同步调用期间，把这座城的字段换到世界顶层，调用结束再换回去。
- 世界顶层平时是城外（荒野）的语境：没有法律，公库为 null。
- 隐藏属性 `$city` 和 `$outside` 不进快照。

这样，单城时代的大部分代码不用改就能用。

| 方面 | 文件 | 要点 |
|---|---|---|
| 挂载 | `src/e2/engine/cities.js` | `CITY_IDS`、`CITY_KEYS`（每城的字段清单）、`withCity`、`eachCity`、`cityOfPlace`、`cityDef`、`atAgent`、`atDomicile`、`cityOwnerAt` / `cityOwnerHere`、`fallbackCity` |
| 岛图 | `src/e2/map/island-three.js` | 34 处地点（西 7、东 9、北 10、荒野 8），25 块空地，46 条街。`cities` 里有井的份额（北 167、西 500、东 333）、港口、源井、议会、广场、放逐地。`terrain.island` 是海岸多边形。街区 ID 用 `north-city` 这样的写法，避开边疆地图里的 `east` |
| 创世 | `src/e2/world.js`、`materials-genesis.js` | `createCities` 为三城各建一份状态、源井、宪章和六部遗法，并调用 `seedPublicRoles`；`materialZonesFor(map)` |
| 前提开关 | 约 55 个文件 | 原先判断 `premise === 6` 的地方都加上了 7；`config.js` 接受 7，默认用岛图，天象随机 |
| 规则引擎 | `src/e2/rules/*`、`src/e2/engine/rules.js`、`rulehost.js` | <ul><li>P7 的事件名与字段（settle、emigrate），新函数 `city_info`、`treasury_of`</li><li>属地的 `inScope`；移动时执行目的城的进入规则；`fireEvent` 进入事件所属的城</li><li>daily 规则逐城执行；标签加城前缀；`audience 'all'` 只到本城地界</li><li>放逐与赦免；割让与没收要检查地界和所有者</li></ul> |
| 遗法与立法 | `lore/humanlaws.js`、`legislation.js`、`laws.js`、`law-execution.js` | <ul><li>`humanLawsFor(w, city)`</li><li>l4 改为「在本城落籍者为公民」：on:arrive / born / settle 时打标签，on:emigrate 时去掉</li><li>选民和联署人按籍</li><li>法律 ID 每城单独编号 `l${++w.lawSeq}`</li></ul> |
| 经济 | `accounts.js`、`environment.js`、`economy.js`、`upgrades.js`、`upkeep.js`、`tick.js`、`ledger.js`、`p6/coins.js` | <ul><li>公库逐城衰减</li><li>源井按份额出产（`wellPlace(w, city)`）</li><li>日结算逐城进行（`dailySettlementCities`）</li><li>天象和日志分四处：三城加荒野</li></ul> |
| 居民 | `p6/roles.js`、`core.js`、`lifecycle.js`、`souls.js` | <ul><li>20 位公共角色（`guide-north` 等）</li><li>事件带 `ev.city`</li><li>居民有 `city`、`settledDay`、`settleDay`</li><li>P7 注册必须带 `city`，居民从该城港口上岸</li></ul> |
| 动作 | `actions/basic.js`、`actions.js`、`weather.js` 等 | <ul><li>`settle`（迁籍）：7 日一次，必须身在目的城地界内，先触发 emigrate 钩子再触发 settle 钩子</li><li>宣告只传到本城，人在荒野时只传到荒野</li><li>`give treasury[:city]`</li><li>`runOne` 外面包一层 `withCity(actionCity(...))`</li><li>天象逐城</li></ul> |
| 指标与公开状态 | `records.js`、`visibility.js`、`facade.js` | <ul><li>`islandMetrics`：逐城的数、合计，和 `cities` 分项</li><li>`islandPublicState`：`cities` 各城一块；法律、提案、重订摊平成一张表，每条带 `city`；公库与源井给合计</li><li>`publicLaw` 接受 `north:l3` 这样的 ID</li><li>`islandTickSummary`</li></ul> |
| 感知与提示词 | `perception.js`、`runner/prompt.js`、`runner/render2.js`、`runner/render-p2.js` | <ul><li>所在城的全部信息</li><li>籍城一小段（`home`）：可表决的提案、重订、公库、昨日井产、配给、天象</li><li>别处每处一行（`elsewhere`）</li><li>提示词里加了【三座城】一段和说明籍的句子</li></ul> |
| 事件文字 | `public/i18n.js`、`wechat/scripts/shared.mjs` | settle 的模板、`CITY_SHORT`、`cityLabel`；`wechat/minigame/utils/shared-text.js` 已用脚本重新生成 |
| HTTP | `src/http/residents.js`、`src/http/archives.js`、`src/world-archives.js`、`src/fiscal-view.js` | <ul><li>创建居民时接受 `city`，以及可选的 `avatar`（头像哈希）</li><li>新接口 `GET /api/account/worlds/:id/souls`：返回本账号在旧世界里托管或创建的居民的灵魂。数据来自归档里私有的 `souls.json`，只有 P6 和 P7 的归档会写这个文件</li><li>财政视图的键带上城</li></ul> |
| 测试 | `test/p7-three-cities.test.js`、`test/fixtures/p7-hidden-physics.json`、`test/p2.test.js` | 11 项：创世、新建居民与公民身份、3:2:1 与配给、移动的管辖、迁籍、宣告范围、只能取本城公库与 `treasury_of`、放逐、跨城立法、感知、回放 |

和方案 §6 不一样的地方：
- 方案写的是创建接口加 `fromResident`。实际做法是：前端先调 `/api/account/worlds/:id/souls` 拿到灵魂文字，填进表单；头像则用 `avatar` 哈希提交。
- 公开地图的 `cities` 没带 `color`，城色可以只在前端按城 ID 取。

## 4. 网页：已做的部分

已经在本机 P7 世界里用浏览器看过：岛级和城级的截图，以及跳到北城之后的 DOM 检查。

- `public/map-view.js` 新增三个方法：
  - `viewport()`，返回当前可见区域的世界坐标矩形；
  - `fitRect([x0,y0,x1,y1], {animate})`；
  - `centerOn(x, y, {animate})`。

  `glide` 做 320 ms 的平滑过渡，用 rAF，带 setTimeout 兜底（见坑 7.6）。
- `public/map-terrain.js` 的 `drawIslandTerrain` 画：
  - 海、海岸、岛上的网格、沙丘、西边的幕；
  - 三城地界：城内地点与空地的凸包，class 为 `territory terr-*`；
  - 城名标签、城内的街、荒野的土路、荒野装饰。

  函数返回 `{ xy, curves, territories }`。
- `public/e2-map.js` 的岛图模式（判定条件是 `map.cities` 加 `terrain.island`）：
  - **缩放分四级。** `islandLodOf` 按相对整图的倍数切换：< 1.55 是 `island`，< 3.4 是 `far`（城级），< 5.2 是 `mid`，再往上是 `near`。全岛级同时挂 `lod-far` 和 `lod-island` 两个类。
  - **城牌。** 写城名（没改过名的城按界面语言显示默认名）、籍人数和在场人数、源井昨日产出与完好度、公库、待表决数、天象。城牌按 1/k 缩放，所以字号就是屏幕像素；点城牌会跳到那座城。另有一块荒野人数牌。
  - **跨城弧线。** 在 `setTick` 里，移动的起点和终点分属不同的城（或一端在荒野）时，画一条弧线，弧顶偏向岛心，6 秒后淡出。只在全岛级显示；减少动态时不画。**本机没有居民，这部分还没看到过实际效果。**
  - **聚焦上报。** 节流 150 ms，调 `deps.onFocus(city|null)`。对外提供 `focusCity(id)`、`focusIsland()`、`focus()`；`fit()` 在岛图上等于 `focusIsland()`。`deps.initialCity` 让网址带城打开时直接进那座城。
  - **小地图。** 画在 HUD 的左下角，含岛、三城地界和视口框；点击就跳过去。
- `public/style.css`：
  - 城色 `--m-city-north / west / east`，分别等于 `--m-blue`、`--m-orange`、`--m-violet`，只当分类色用；
  - 岛图的全部样式写在 `/* 岛图（第七前提「三城」）… */` 一段里。
- `public/i18n.js` 新增词条：`islandAll`、`cityJump`、`minimap`、`cityBadgePeople`、`cityBadgeWell`、`cityBadgeTreasury`、`wildsBadge`。
- `public/app.js`：
  - `S.raw` 存原始状态，`S.focus` 存聚焦的城，`scopeState(raw, focus)` 把那座城的块叠到顶层；
  - `setFocus` 由地图的 `onFocus` 触发：它重算 `S.state`、改网址、刷新跳转按钮，再 `applyState({force:true})`；
  - `parseHash` / `hashFor` 处理网址，格式为 `#laws&city=north`，兼容旧的 `#laws`；
  - `renderCityJump` 在 map-tools 前面加跳转按钮，同时隐藏「全图」；
  - `onTick` 在 P7 下更新各城的公库与源井，以及居民的籍；
  - 顶栏：源井取聚焦城的；全岛级的天象注明是哪座城的；人口只数籍在聚焦城的居民；
  - `ctx.cityName()` 和 `public/render.js` 的 `topTitle` 在全岛级不再崩溃（全岛显示「全岛」）。
- `src/e2/p6/roles.js`：西城、东城的公共角色原先引用 `/roles/guide-west.svg` 等文件，这些文件不存在。现在三城的同一职务共用 `/roles/<kind>.svg`。各城的头像变体还没画。
  - 已经建好的本机世界，快照里存的仍是旧路径；换一个空的 `DATA_DIR` 就不会再 404。
- **布局**（`public/index.html`、`public/style.css`、`public/app.js`）：
  - `.layout` 改成 2fr / 1fr；
  - 地图右上角有 `#map-fullscreen`，对 `.map-pane` 调 Fullscreen API；
  - 侧栏顶部有 `#side-toggle`。宽屏下收起后，侧栏成一条 40px 的竖边，选择记在 `localStorage` 的 `as4.sideCollapsed`；
  - 窄于 900px 时隐藏收起按钮，地图最小高度为 56vh；
  - 地图宽度 < 560 时，城牌只写城名与人数；宽度 < 480 时不显示小地图。

  已在 375 宽和桌面宽下截图看过。
- **三城对比**（`app.js` 的 `cityComparison`，`CITY_SCOPED_TABS`）：
  - 全岛级时，法典、环境、天象、指标、编年史这几页的顶部先放一张三城对比表：籍、在场、源井昨日、公库、现行法、待表决、天象；点城名跳到那座城。
  - 法典页在全岛级只给对比表和一句「选一座城」，不再把三城的 l1–l6 混在一起列。
- **接口**（`src/http/public.js`）：
  - `GET /api/public/chronicle?city=`：带 city 时只给那座城；不带时三城合在一起，每条注明 `city`。未知的城返回 400。
  - `GET /api/public/weather?city=`：给那座城的天象；不带时给荒野的天象，另附 `cities`。
  - 天象投票（POST）暂不开放，按用户最新决定保持完全随机。

## 5. 测试与本机验证

- 全量测试：`npm test`，也就是 `node --test`，约 160 秒。最近一次的结果：见文末「进度记录」。
- 三城专项：`node --test test/p7-three-cities.test.js`。
- 已知不稳的测试：
  - P2 T16 在全量负载下偶尔超时，单独跑能过。
  - 跑测试期间改 `src/` 里的文件，会让 wechat-server 的几项失败（子进程读到了改了一半的代码），单独跑能过。
- 在 Codex 沙箱里，HTTP 测试可能因为 `listen` 报 EPERM 而失败，要到沙箱外重跑确认。
- 在工作树根目录用命令在后台起一个本机 P7 世界。不要用 preview_start：它读的是主检出的 `.claude/launch.json`，找不到名字时会去起本机的 epoch2 世界。

```bash
DATA_DIR=/tmp/p7data PHYSICS=2 PREMISE=7 WORLD_ID=p7-local PORT=8797 HOST=127.0.0.1 TICK_MS=20000 HIDDEN_PHYSICS_FILE=test/fixtures/p7-hidden-physics.json REQUIRE_LOGIN=0 ADMIN_KEY=local-admin-key-0123456789 node server.js
```

  然后打开 http://127.0.0.1:8797/ 。启动时提示「TICK_MS 小于 4 × 60 秒」可以不管，因为本机没接居民模型。

## 6. 还要做的（按这个顺序）

### 6.1 网页岛图：还差的

- 三个城色已登记在 `docs/VISUAL-DESIGN.md` 的观测站布局一段里，新布局也写进去了。
- 已验收：本机通过账号接口创建 5 位居民（含两位表单创建），实际移动西城籍居民到东城，城牌由西城「籍 2 / 在 2」变为「籍 2 / 在 1」、东城「籍 2 / 在 3」，全岛显示跨城弧线。
- 窄屏已看图：375 宽下隐藏小地图；修复英文城牌裁切与荒野人数遮挡，窄屏显示城名简称、籍人数、在场人数，城牌保持在地图内。

### 6.2 页面按城显示：还差的（`public/app.js`，方案 §5.1「页面范围」）

- 已修：首页首次读到状态后重新设置标签，英文直接显示 `Create a resident` / `My residents`，不必切换语言。Chrome 首次加载复验通过，UI 测试 15 项通过。
- **全岛级三城对比已完成并验收。** 法典、环境、天象、指标与编年史顶部显示三城对比；法典选城后才显示该城法律。
- **天象投票暂不开放。** 2026-10-16 用户进一步确认：保持 P7 天象完全随机。未来若开放投票则按城分开；本轮不增加投票写入路径。
- **页面改用新接口。**
  - 编年史页已改：`public/tabs1.js` 的 `renderChronicle` 聚焦一座城时带 `&city=`，全岛时在每条的标题前标出城名，并且只移除「加载中」那一行，不再清空整个面板，所以上面的三城对比表能保留下来。本机已看过。
  - 天象页还读的是公开状态，可以改用 `/api/public/weather?city=`。
  - 指标已补齐：`src/fiscal-view.js` 的 P7 公开投影逐城汇总实际法律拨款；`public/e2-tabs.js` 聚焦时只画该城 8 张指标图，全岛显示原来的 18 张图并保留顶部三城对比。异步加载只移除加载提示；旧前提仍走原路径。
- **居民页**（已做）：`public/e2-tabs.js` 的 `renderResidents2` 多了「籍」一列，还有一个按城筛选的下拉框（籍在某城 / 在某城 / 在荒野），状态记在模块变量 `resCity` 里。本机已看过英文界面。
- **实况页**（已做）：`public/tabs1.js` 的 `matches` 多了一个条件 `liveCity`，聚焦一座城时只列 `e.city` 是那座城的事件，增量追加也走同一个过滤。本机看过：聚焦北城时只列北城的事件。
- **环境页**（已做）：
  - `renderEnvironment2` 在聚焦一座城时只列那座城的地点。过滤放在渲染器里，**不要**挪到 `scopeState`，因为地图要靠完整的 `places` 来画；
  - 物料地带和研究所照旧按全世界列出（它们是共享的）；
  - `wellPanel2` 原先找 ID 为 `'well'` 的地点，P7 没有这个地点，整页会报错；现在 P7 改用聚焦城的源井读数，全岛时用三城合计。本机看过，东城不报错。
- **哪些页跟着聚焦走。** 实况、编年史、法典、居民、环境、天象、指标跟着聚焦走。典籍、交易所、协作、墓园、摇篮始终是全世界，要逐页确认没被 `scopeState` 误伤。
- **法律详情。** 网页目前不调 `/api/public/laws/:id`。以后要调的话，P7 的 ID 写成 `north:l3`。
- 已修带城网址的首帧边界：首次地图帧尚未到达时，点「全岛」也会清掉页面与网址里的城范围。回归测试及 Chrome 实测通过。

### 6.3 布局：还差的

- 桌面 1280 与手机 375 宽，深色 / 浅色、中文 / 英文共 8 组截图已完成；另检查 768、1920 宽无横向溢出。地图在浅色主题下仍是深色。
- 已在有窗口的 Chrome 验收真实 Fullscreen API：地图面板高 1000px 等于视口高，地图区扣除工具栏与图例后高 901px；侧栏收起 / 展开也有截图。

### 6.4 创建页与我的居民（`public/residents.js`，方案 §5.3）

**代码已写好**：`openCreate` 里的 `cityPicker` 和 `importSoul`，卡片上的 `domicileText`，样式在 `public/console.css` 末尾。

**本机验收通过。** 已注册本机测试账号并打开 `/residents.html#create`，截图位于 `docs/audits/2026-10-16-three-cities/`：
- 选城卡片：三城默认未选，未选城时表单校验不通过；
- 「从旧世界带入灵魂」：本机无归档时的空状态通过；真实旧归档带入仍未验证；
- 提交：真实表单携带 `city` 与有效 `avatar`，公开状态中的头像哈希与提交一致；
- 「我的居民」卡片显示「籍 西城 · 在西城」；公共档案显示 Domicile 与落籍日。

下面是原来的要求，留作核对：

- 加选城的卡片，写人口、日产、设施。P7 下城是必选项；接口 `POST`（`src/http/residents.js`）已经接受 `city`。
- 加「从旧世界带入灵魂」：
  - 先列出账号的旧世界，再调 `GET /api/account/worlds/:id/souls`；
  - 选一位居民后，把灵魂文字和简介填进表单，用户可以改；
  - 头像用 `avatar` 哈希提交，服务端会检查这个哈希确实存在于某个世界的 avatars 目录里；
  - 记忆、余额、关系、程序都不带过来。
  - 注意：线上 p6 的旧归档里还没有 `souls.json`。切换世界时归档要用新代码生成，或者另写一个补生成的脚本。
- 「我的居民」里显示籍和所在城。

### 6.5 微信端（`wechat/minigame/screens`、`wechat/minigame/ui`，小程序复用同一套；方案 §5.2）

**已做（第一步）：**
- `screens/city.js`：
  - `citySwitch` 是顶部的切换行；
  - `scoped(app)` 把选中的城叠成统计和标题用的状态，居民按籍；
  - `eventsOf(app)` 按事件的 `city` 过滤事件流。
- `society.js`：新增动作 `cityFocus`，状态存在 `this.cityFocus`，`null` 表示全岛。
- `ui/map.js`：
  - `frame()` 负责取景：旧地图照旧铺满；岛图全岛时框住整座岛，选了城就框住那座城；
  - 岛图先画海，再画岛；
  - `draw()` 在全岛时叠三块城牌，点击区域的动作是 `cityFocus`；原来的绘制挪进了 `drawBase()`。
- `screens/residents.js`：选了城时只列籍在那座城的居民，标题写「居民 · 北城」。
- 测试：`test/p7-wechat.test.js`（全岛有三块城牌的点击区域；切到西城后没有城牌；可以切回全岛）。原有微信端测试 68 项都通过。

- 跨城弧线（已做）：全岛时，`city.js` 把最近一刻的 move 事件（`data.from` → `data.to`）交给地图，`ui/map.js` 把起止分属不同城的画成偏向岛心的虚线弧；测试里带了一条移动事件。

**已完成（Codex）：**
- 城级支持 1–4 倍双指缩放，按指间中心取景，单指拖动有边界；切城重置视口。地点文字、头像与点按区保持屏幕像素大小。
- 地图内的手势不滚动页面，双指转单指继续拖动，结束与取消不误点；地图外仍滚动页面，全岛不接管手势。
- 城级只显示该城地点；全岛不挤入地点标签。放大后点按区裁在地图内，避免盖住统计和事件流。
- 补充 3 项手势回归测试；微信相关测试 57 项通过，小程序与小游戏的离线检查均通过。
- 已在浏览器 Canvas 预览看图：375×667、390×844、393×851，每种机型都有全岛、城级、缩放拖动后的截图。三种机型均验证 2 倍缩放、平移 20px、页面滚动偏移仍为 0。

**仍未验证：** 微信开发者工具 / 真机未看图验收。开发者工具 CLI 服务端口关闭；通过界面导入了独立的本机包（接口只指向 127.0.0.1），模拟器停在空画布，未获得可用于验收的城市画面。需人工核对上述三种机型的城级缩放、拖动、点地点底部卡片及全岛切换。

**原来的要求（留作核对）：**

- 城市页顶部加一行切换：全岛 / 北城 / 西城 / 东城。
- 全岛级画三块城牌和跨城弧线。
- 选了一座城就只画这座城，支持双指缩放和拖动；点地点从底部弹出卡片。
- 居民和实况跟着当前城走。
- `wechat/minigame/utils/shared-text.js` 由 `wechat/scripts/shared.mjs` 生成，**不要手改**。改了 `public/i18n.js` 之后要重新生成，并跑相关测试。

### 6.6 服务端里剩下的单城写法

- 已修：
  - `src/http/admin.js` 的 `tokenAdminView`，在 P7 下按城给源井和当日记录，本机用 `X-Admin-Key` 调过；
  - `src/http/tokens.js` 的提示词城名：新增 `promptCityName`，P7 下取籍城的名字；
  - `src/runner/public-roles.js`：`facts` 和 `fixed` 进入角色所属的城（`withCity`），职务用 `roleKind` 判断。城内角色的 ID 是 `guide-north` 这种写法，原先按 `role.id === 'wellkeeper'` 判断全都落空，规则和提案又读的是荒野那份。本机已验证：西城源井值守员拿到西城的源井，东城书记员拿到东城的立法程序；
  - `src/e2/engine/admin.js` 的 `well_supply`：P7 下必须带 `city`，否则返回 400；只通知籍在这座城的居民。本机已验证。
- 不用改：管理操作 `weather`（`forceWeather`）在 P6 和 P7 下本来就返回 forbidden，天象只能随机抽。
- 已核对：`src/http/admin.js` 和 `src/e2/engine/admin.js` 里剩下读单城字段的只有两处：
  - `tokenAdmin` 里的 `w.well`：P7 下已在 `withCity` 里面执行；
  - `tokenAdminView` 旧前提分支里的 `w.well`：前面有 `if (w.cities)` 先返回。

  `adjust` 只改居民余额，不涉及城。
- `src/runner/public-roles.js`：每个角色的 facts 和 fixed 要按角色种类和所属城来给。20 位角色由 `src/e2/engine/p6/roles.js` 的 `seedIslandRoles` 创建。
- 凡是动公库、源井、法律的管理操作，都要带 `city` 参数。
- 世界报告（决定 24），代码已写好：
  - `src/history/reports.js`：只要来源事件带 `city` 字段（只有 P7 会带），提示词就追加 `CITY_PROMPT`，要求模型先写全岛与城际往来，再分北、西、东三节，并给每一项标上 `city`（`island` / `north` / `west` / `east`）；
  - 每类最多 24 项；`city` 取值不合法就判为无效报告；`settle`（迁籍）算作重点事件；
  - 旧前提不受影响（不带 `city`，上限仍是 16）；
  - `public/reports-ui.js`：只要有一项带 `city`，就按城分节显示，顶部放跳转链接（`#report-north` 等），每节里事实在前，下面单列「AI 观察与分析」；
  - 报告相关测试 20 项通过。**本机无可用报告模型配置 / API 凭证，未用真实模型生成 P7 报告，分节质量没有验证。**
- 交易所观察页已验收：修复 `renderMaterialsMarket` 漏接 P7 导致空白的问题，新增中英文籍标签回归测试。本机真实服务显示提供者「· of West City」，截图已保存。市场与 UI 测试 21 项通过。
- 已改：P7 的典籍。`src/e2/p6/canon.js` 新增 `VIRTUAL_CANON_P7` 与 `canonFor(premise)`：
  - 《城中生存须知》《设施与道路手册》换成三城版本，中英两份，ID 仍是 `v6-survival` 和 `v6-facilities`；
  - 创世时 `src/e2/world.js` 按前提选典籍；
  - 微信端 `src/wechat/system-texts.js` 也把 P7 的文本收进来；
  - P6 的典籍逐字不变。

  《致后来者》保持原文（2026-10-16 用户决定不用改）。
- 查漏的命令：`grep -rn "w\.well\b\|w\.treasury\b\|w\.laws\b\|humanCityName" src/ runner/ public/`。命中的地方逐个确认：是走挂载的路径，还是在城外读顶层。

### 6.7 文档

- 已写：`docs/adr/0022-per-city-mounting.md`，以及方案 §9「实现中补定的细节」。
- 还要做：有新的词就补进 `CONTEXT.md`。

### 6.8 收尾验收（方案 §8）

- 已完成：全量 1846 项，0 失败、1 跳过；前提 0–6 的金样本和回放检查通过。
- 已完成本机 P7 网页截图矩阵（桌面 1280 / 手机 375、深浅、中英），报告与 34 张截图在 `docs/audits/2026-10-16-three-cities/`。验收覆盖：
  - 岛图的三级缩放、跳转、小地图；
  - 范围跟随、全屏、侧栏收起；
  - 创建页选城与带入旧灵魂；
  - 微信端全岛 / 城级 / 放大后的浏览器 Canvas 预览；开发者工具与真机仍未验证。
- 向用户汇报做了什么、没做什么、哪些没验证到。用户已授权本分支小步提交，禁止推送、部署和连接生产。

## 7. 坑

1. **金样本。** 改共用代码时，前提 ≤6 的输出必须逐字节不变。我曾经把 lore 里的 `east` 街区改了名，金样本就坏了，所以岛图的街区才叫 `north-city` 这种名字。
2. **`withCity` 只能包同步代码。** 里面不能 await，也不能把回调留到以后执行，否则顶层会停在某座城的状态上。
3. **`$city` 和 `$outside` 是隐藏属性**（不可枚举），不能进快照和回放。
4. **法律 ID 每城单独编号。** 对外一律写成 `north:l3`。裸的 `l3` 只有在已经挂上某座城的时候才能用。
5. **`shared-text.js` 由脚本生成**，不要手改（见 §6.5）。
6. **内置浏览器面板失焦时不出帧**，rAF 和 ResizeObserver 都不触发，所以 `glide` 带了 setTimeout 兜底。验证布局类的代码时，先截一张图，再读 DOM。
7. **改了 `src/` 要先重启本机服务器。** 服务器跑的还是旧代码时，调用会触发引擎异常，世界进入「执行故障保护暂停」：请求会回滚，但世界停住了。本机测试世界换一个空的 `DATA_DIR` 就能重来。
8. **服务器把静态文件缓存在内存里。** 改了 `public/` 下的文件，要重启本机服务器，页面才会看到新文件。浏览器这边可以在网址后加 `?v=…` 来绕开缓存。
9. **P7 公开状态的顶层城字段**（`humanCityName`、`treasury`、`well`、`laws` 等）是全岛合计或者空值。前端凡是直接读这些字段的地方，都要经过 `scopeState`。

## 进度记录

- 2026-10-16（Claude）：写下本文件。全量测试（地形改动之后）：1838 项，1837 过，0 失败，1 跳过，用时 162 秒。
- 2026-10-16（Claude）：做完岛图模式和页面按城显示的基础，见 §4。三城专项测试 11 项仍全过。
- 2026-10-16（Claude）：做完布局、三城对比、编年史与天象接口按城。`test/ui.test.js` 加三城专项共 26 项全过。全量测试：1838 项，1837 过，0 失败，1 跳过。
- 2026-10-16（Claude）：写了创建页的选城和带入灵魂（没看图）、「我的居民」的籍与所在、「按籍」着色、`tokens.js` 与 `admin.js` 按城、ADR-0022、方案 §9。这之后全量测试：1838 项，1837 过，0 失败。
- 2026-10-16（Claude）：P7 典籍换成三城版本，全量测试 1838 项，0 失败。之后给居民页加了籍与按城筛选，编年史页改成按城，UI 测试和三城专项测试都通过。这最后两处改动只动了 `public/`，之后没有再跑全量测试。
- 2026-10-16（Claude）：修了公共角色的资料按城、管理操作 `well_supply` 按城，对比表改用简称城名，英文界面看过一遍。
- 2026-10-16（Claude，最后一轮）：
  - 做了：世界报告按城分节、交易所注明籍、微信端第一步（切换行、取景、城牌、统计 / 事件 / 居民按城），新增 `test/p7-wechat.test.js`。全量测试 1839 项，1838 过，0 失败，1 跳过。
  - 之后又做了：实况页、环境页按城（含环境页源井面板在 P7 下报错的修复），P7 的港口、源井按 `role` 认，微信端跨城弧线。全量测试 1839 项，1838 过，0 失败，1 跳过；之后只改了微信端的弧线，微信端相关测试 52 项通过。
  - 最后在网页的居民档案里加了「籍」一行（`public/e2-profile.js`，含落籍的世界日），UI 测试和三城专项测试都通过，没在浏览器里看过。
  - 又在 P7 的地图图例里加了三座城的城色（`renderLegend` 与 `style.css` 末尾），已截图核对。
  - 已知的小问题（不是这次引入的）：首页英文界面初次加载时，「创建居民」「我的居民」两个按钮显示成 Enter / Backstage，切一次语言后才对。原因是 `applyLabels` 在状态还没读到时就按旧前提的文案取了值。
  - 停下时 5 小时额度用到约 87%（用户要求超过 90% 再停；剩下的几项都做不完，就没有开新的）；本机服务器已停。全量测试：1838 项，1837 过，0 失败，1 跳过。这之后只改过又撤回了管理操作 `weather`，净改动为零。三城专项、UI、P6 测试共 40 项通过。

- 2026-10-16（Codex，接手）：确认工作树、分支及提交无误，基线 `npm test`：1839 项，1838 通过、0 失败、1 跳过（166.7 秒）。修复首页首次加载标签；Chrome 英文复验为 `Create a resident` / `My residents`，UI 测试 15 项通过。本机独立 DATA_DIR 已注册测试账号，三城各创建一位居民；口令未保存到仓库。
- 2026-10-16（Codex，本机网页验收）：完成选城必填、旧灵魂空状态、带 city/avatar 的真实表单创建、我的居民籍与所在、城牌人口、真实跨城弧线、公共档案籍信息。发现并修复 P7 交易所空白，市场与 UI 测试 21 项通过。用户确认 P7 天象完全随机、暂不开放投票，《致后来者》不用改。截图与完整清单将在本轮收尾时统一登记。
- 2026-10-16（Codex，微信手势）：完成城级 1–4 倍双指缩放、单指有界拖动、双指转单指、取消与防误点，切城恢复取景；全岛与 P6 保留原有滚动。新增 3 项手势测试，微信相关测试 57 项通过，小程序 / 小游戏离线检查通过。浏览器 Canvas 预览三种手机尺寸均看图；开发者工具模拟器为空画布，未完成开发者工具 / 真机验收。
- 2026-10-16（Codex，截图与报告检查）：网页完成 1280 / 375 × 深浅 × 中英 8 组截图，真实 Chrome 全屏和侧栏收起通过；768、1920 宽无横向溢出。看图发现并修复 375 英文城牌裁切与荒野人数遮挡。未提供报告模型，真实模型生成与分节未验证。三城 + 微信专项单独跑 15 项全部通过；全量测试收尾中。
- 2026-10-16（Codex，指标收尾）：补齐单城指标、逐城实际财政拨款，保留全岛指标页的三城对比；补修带城网址首帧前切回全岛的范围同步。新增 3 项回归测试，相关 UI / 三城 / 微信测试 52 项全部通过。Chrome 确认单城 8 图、全岛 18 图，对比保留；全量测试再次收尾中。
- 2026-10-16（Codex，最终验收）：`npm test` 1846 项，1845 通过、0 失败、1 跳过（173.8 秒）；三城与微信专项按要求单独执行 16 项通过，相关 UI / 三城 / 微信 52 项通过，微信相关 57 项通过，小程序与小游戏离线检查通过。34 张截图与完整中文报告见 `docs/audits/2026-10-16-three-cities/README.md`，机器证据见同目录 `evidence.json`。真实报告模型、真实旧归档灵魂带入、微信开发者工具 / 真机仍未验证；暂无新的待决事项。
