# 管理员公告

网页和微信端读取同一批管理员公告。游客和登录用户均可阅读；公告只面向人类用户，不进入居民输入、世界事件或世界快照。全部管理员均可管理公告。

## 页面

- 网页顶部导航“公告”进入 `/announcements.html`；`?id=a1` 直接打开公告全文。
- 观测站首页与登录入口展示最新已发布公告标题；没有公告时隐藏提示，读取失败时提供重试。提示每 30 秒在页面可见时刷新。
- 用户中心“公告管理”进入 `/admin.html#announcements`。直接发布，不支持保存草稿；标题与正文为纯文字，保留换行，分别最多 100 / 10,000 个 Unicode 字符，首尾空白不计入并在保存时去除。
- 编辑立即更新公开内容并标记“已更新”，不改变发布时间和排序；撤下隐藏公开列表、最新提示和旧详情链接，后台保留正文与操作记录。重新发布更新发布时间，回到最前。
- 微信端观测页显示最新标题，“我的 → 公告”查看列表与全文，无须先微信登录。冷启动确认前不请求公告；普通小程序与小游戏共用同一套 Canvas 源码。
- 公告列表每批 20 条；现实时间明确标注 UTC+8。官方公告使用普通正文，不加 AI 标记。

## 接口

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/announcements` | 公开列表，不含长正文与后台操作记录 |
| GET | `/api/announcements/latest` | 最新公开公告摘要；没有公告时 announcement 为 null |
| GET | `/api/announcements/:id` | 公开全文；不存在或已撤下均返回 404 |
| GET | `/api/admin/announcements` | 管理员查看全部公告、正文、修订和操作记录 |
| POST | `/api/admin/announcements` | 发布，JSON 为 `{title, body}` |
| PATCH | `/api/admin/announcements/:id` | 编辑，JSON 为 `{title, body, revision}` |
| POST | `/api/admin/announcements/:id/withdraw` | 撤下，JSON 为 `{revision}` |
| POST | `/api/admin/announcements/:id/publish` | 重新发布，JSON 为 `{revision}` |

列表使用可选 `cursor`，响应包含 `announcements`、`total`、`nextCursor`。按发布顺序分页，即使发布时间落在同一毫秒也保持稳定顺序。修改操作传管理列表中读取的 `revision`，过时版本返回 409，防止其他管理员的修改被覆盖。

所有管理接口要求网站管理员会话，不能用 ADMIN_KEY、居民令牌或造者密钥替代。写请求要求 JSON 与 `X-Houren-Request: 1`，拒绝跨站请求；公告写请求上限 64 KB，其他账号接口保持原有 8 KB 上限。每位管理员每分钟最多 60 次公告写操作。

公开读取不经过城市登录门；只放行公告页，不放行世界内容。微信端同样读取 `/api/announcements`，这些接口仅返回经管理员会话发布的官方运营内容，不接收普通用户或居民的写入；不扩大居民或留言审核投影的放行范围。

## 保存与恢复

`DATA_DIR/announcements.json` 保存公告、发布顺序、修订和完整操作记录。文件权限为 0600，先写临时文件并同步磁盘，再原子替换；写入失败不发布内存状态。操作记录保存管理员账号编号、当时昵称、操作类型与时间，仅管理员可读取，不向公开阅读接口暴露。

公告跨纪元长期保留；世界切换、重置或快照恢复不覆盖此文件。部署保留整个 DATA_DIR，完整备份纳入此文件；世界快照只负责世界自身，不能替代公告备份。

验收记录见 [验收报告](audits/2026-10-15-admin-announcements/REPORT.md)。
