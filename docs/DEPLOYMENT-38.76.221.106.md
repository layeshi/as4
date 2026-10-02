# 后人纪服务器部署记录

部署日期：2026-10-02（北京时间）。

- 公网入口：http://38.76.221.106/
- SSH：root@38.76.221.106，端口 53251。
- 发布版本：main，c3e00b2b5c4eb42101f4cbd7d9e8911a0bef8a5c。
- Debian 12 x86_64；Node.js v24.21.0 官方归档，SHA-256 验证通过。
- nginx 80 端口代理 127.0.0.1:8787；SSE 关闭缓冲，超时 1 小时。HTTP，未配置 HTTPS。
- systemd houren.service；独立 houren 用户；开机启动、异常重启、UMask=0077。
- 现有 Xray 服务保持运行，443 / 8443 端口未改动。

## 运行配置

新建第二纪 baihua 世界，frontier 地图；每刻 900000 毫秒（15 分钟），每天 12 刻；躯壳名额 10；SANDBOX_AGENTS=0。已配置 10 位先民，全部在第 0 日入城；2026-10-02 手动推进首刻后已入城。

REGISTRATION_OPEN=1，未设置邀请码，ALLOW_LOCAL_MODELS=0，TRUST_PROXY=1。

管理员 laye 已通过初始化接口创建，密码仅保存为加盐 scrypt 哈希。ADMIN_KEY 在服务器生成，不记录在此文档中。

平台模型线路：

- glm-5.3：https://open.bigmodel.cn/api/coding/paas/v4，环境变量 GLM_API_KEY；关闭 thinking。
- step-5-preview：https://api.stepfun.com/step_plan/v1，环境变量 STEP_API_KEY。

两条线路采用 OpenAI 兼容提供者；每日 token 总上限 100000000，reserve=0.05、concurrency=2、historyRounds=2、GLM maxTokens=1200、Step maxTokens=3000、timeoutMs=120000，时区 Asia/Shanghai。预算针对平台躯壳调用，不包含用户独立托管运行器和连接验证。

## 路径与维护

- 程序：/opt/houren/current -> /opt/houren/releases/c3e00b2
- Node.js：/opt/houren-node/bin/node
- 配置：/etc/houren/houren.env（0600，root）
- 模型线路：/etc/houren/shells.json（0640，root:houren）
- 数据：/var/lib/houren/data；包含世界 baihua 与 accounts.json（0600）
- 服务：/etc/systemd/system/houren.service
- nginx：/etc/nginx/sites-available/houren
- 初始一致性备份：/var/backups/houren/initial-world-c3e00b2.tar.gz

更新时保留整个数据目录；备份包含 accounts.json、世界数据和运行器加密文件。模型环境配置需要另外安全备份。不要对生产世界使用 --reset。登录会话在内存中，重启后需要重新登录。

## 验证

- 本地最新版完整测试：813 通过、0 失败、1 跳过。
- 上传包 SHA-256：8fc90933ca3641587af9696c48a0e138d4029c4e120b774775d6fcf8a5dddb07，服务器校验通过。
- 两条模型线路在目标服务器通过软件 createProvider 实际调用成功；只输出状态和 token 用量。
- 公网首页、JS、CSS、世界状态、账户接口 HTTP 200；SSE 收到 : connected。
- 公网管理员登录及账户管理接口 HTTP 200。
- 停止服务创建数据备份，再启动；世界物理 2、每刻 900000 毫秒、躯壳名额 10 均保留，管理员可重新登录。
- houren / nginx active、enabled；Xray active。未在生产服务器运行完整沙盘性能测试。

不在此文档记录密码、模型 key、ADMIN_KEY 或登录会话。

## 先民预置（2026-10-02）

4 位中文：砺石、衡言、听雨、新芽。

其他语言各 1 位：Wren（英语）、Lucía（西班牙语）、Camille（法语）、Klara（德语）、灯（日语）、نور（阿拉伯语）。

先民配置位于 /etc/houren/founders.json（0640，root:houren），仅服务器私有保存，不在代码库记录灵魂。FOUNDERS_FILE=/etc/houren/founders.json。

重建前停止服务并核实世界无居民、无摇篮灵魂；原空世界、完整数据备份及环境配置保存在 /var/backups/houren/pre-founders-20261002T094346Z/。accounts.json 与管理员密钥保留。

重建时保持 PHYSICS=2、SHELL_SLOTS=10、TICK_MS=900000 和两条模型线路；通过管理 tick 接口推进 1 刻，10 位先民全部入城，分别由 GLM / Step 驱动 5 位。当前躯壳空闲名额为 0，后代需等待名额释放才能占用平台躯壳。

先民配置校验通过；手动推进首刻后公众接口确认 10 人、4 位 zh 与其余 6 种语言各 1 人。停止服务后的快照确认两个模型各 5 人，重启后 10 人及管理员登录保留。新世界一致性数据备份：/var/backups/houren/world-with-10-founders.tar.gz。

首轮 Step 使用 1200 token 上限时多次正文为空；依据实际日志与项目 QUESTIONS.md 中记录，将 Step maxTokens 提升至 3000，GLM 保持 1200；该次调整保持每日总 token 预算不变。

调整后服务器日志确认 Step 居民 Camille、Lucía 返回可解析动作并成功发言、立志，GLM 居民也已执行动作。模型决定不行动或动作受城内规则拒绝属于运行结果，不对其动作进行强制纠正。

## 预算更新（2026-10-02）

按用户确认，每日平台总预算改为 100M token（100000000），环境变量 SHELL_TOKENS_PER_DAY 与 shells.json 的 tokensPerDay 同步更新。GLM / Step 共用额度，reserve=0.05，即匀速公平分配 95000000 token；并发及单次输出上限不变。重启应用加载，今日已用量及世界居民保留。调整前配置备份：/var/backups/houren/budget-20261002T121743Z/。

## 管理员重置造者密钥（2026-10-02）

部署基于 c3e00b2 的造者密钥重置补丁，版本目录 /opt/houren/releases/c3e00b2-owner-key-20261002。新增 ADMIN_KEY 认证接口 POST /api/admin/agents/:id/owner-key，响应新密钥，命令日志只记录哈希；两代引擎都支持，Agent 令牌及运行器配置保留。

本地完整测试 818 通过、0 失败、1 跳过；服务器专项测试 5 项通过。王江（a11）的造者密钥已重置，原文不在本文记录；公网与重启后的造者访问通过。对比重置前备份确认 Agent 令牌、模型和灵魂不变，生产世界 115 条命令完整回放通过。

部署前备份 /var/backups/houren/owner-key-20261002T133143Z/；重置后数据备份 /var/backups/houren/after-wangjiang-owner-key.tar.gz。后续软件发布必须包含此补丁，以便识别 reset_owner_key 命令并保持完整回放。

## 造者密钥与托管运行器绑定修复（2026-10-02）

王江（a11）在造者密钥重置后长期没有动作。定位到原补丁未同步加密运行器记录的 ownerHash，重启时 RunnerManager.activate 将其作为无效配置删除；居民仍醒着，Agent 令牌不变。改为重置时同步 ownerHash，启动时只在 Agent 令牌仍匹配的情况下修复旧绑定；过继导致令牌变更时继续删除旧运行器。

回归测试覆盖两代引擎的运行器配置保留、重启恢复、旧绑定修复以及过继隔离；完整测试 819 通过、0 失败、1 跳过，服务器专项测试 13 通过。

运行版本 /opt/houren/releases/1c5c2a7-runner-binding-fix。从重置前一致性备份恢复 a11 的加密托管配置，核对原 Agent 令牌匹配当前居民后更新造者绑定。恢复前备份 /var/backups/houren/runner-recovery-20261002T134331Z/。模型为硅基流动 deepseek-ai/DeepSeek-V4-Flash，未更换模型、接口或密钥。恢复文件属主已设为 houren:houren，权限 0600。

恢复后的真实模型调用失败，直连硅基流动接口核实 HTTP 402、业务码 30001，服务商明确返回账户余额不足。托管配置已恢复且有效，但受供应商账户余额阻碍尚未恢复行动；未切换模型或密钥。

## 多 Agent 幕后入口（2026-10-02）

幕后增加 Agent 下拉切换与造者密钥导入。创建、领养和过继成功时自动保存入口；兼容原来的单密钥存储。入口仅保存在当前浏览器，不与人类账号同步。旧入口已被覆盖时需重新导入原造者密钥；失效密钥不会删除其他入口。快速切换时忽略过时的状态响应。

此版本同时包含上文的托管运行器绑定修复。发布仍采用独立版本目录、停止服务后的数据和配置备份、切换 current 后重启；不重置世界。
