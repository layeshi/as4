# 三城观测修复上线记录

2026-10-17，北京时间。用户授权合并main、推送GitHub并保状态部署。

## 发布与验证

- 修复已快进合并main并推送GitHub；固定生产代码提交 `1a62faa1b26839faf648cdfd2916e97a600766f8`。
- 原发布 `/opt/houren/releases/main-ad0378a90682-20261017-wechat-login`，新发布 `/opt/houren/releases/main-1a62faa1b268-20261017-runtime-observation`。
- 对比可信Git归档：原版本1141个文件、新版本1149个文件摘要校验通过；生产代码差异只有公民/放逐统计和运行器轨迹接线。依赖在Linux新发布目录提前安装。
- 本地完整回归1884通过、0失败、1跳过；Linux专项21通过、0失败。
- 15:47:46开始停服，15:48:31恢复HTTP，停服45.095秒；15:48:32部署校验完成。服务active/running，NRestarts=0；nginx、Xray进程未变。

## 保状态证据

- 一致性备份：`/var/backups/houren/runtime-observation-20261017-1548/`。包含完整数据、私有配置、systemd/nginx配置及旧发布；归档内容比对、解包校验通过。备份目录0700，敏感内容留在服务器。
- 最终世界 `p7-20261016`，physics=2、epoch=2、premise=7，地图island-three-v1，tick=67，snapshot commandN=3239，日志末尾=3239，事件序号1702。
- 命令完整性及回执校验和通过；目标版本在隔离副本Runtime.open/close，状态哈希均为 `8fcd2357d05817f94d7ea3af10a3ba4c9341607a29e22e1aca1a47f330b05b8a`，新增回放0条，命令日志字节摘要未变。
- 17居民、4账户、16有效且启用的运行器保留。22个加密配置/密钥文件在启动后验证明文配置或摘要一致；模型、启用状态、运行配置不变，累计用量未倒退，历史命令前缀保留。
- 实验保持running，lawProtection、capacityProtection均null；未重建世界、补发资产、修法或手动推进时间。
- 本次采用最终快照恢复验证，未重新验证创世至今的历史确定性。

## 实际效果与边界

15:49:45自然运行检查：已有12位居民的12条唤醒记录、26轮模型交互、17次动作记录，其中1次因tokens_exhausted拒绝；不再是空注意力统计。该采样不意味着全部模型调用都成功，两个记录结束原因为error；本次没有额外付费模型试调用。历史未收集的轨迹未补造。

生产现有日结仍是内部day=4的旧记录，nonCitizens=17。使用新生产代码对备份的内存副本执行指标生成，得到nonCitizens=0、exiled=0，tick与commandN不变，未写备份。线上新口径在下一次自然日结生效，不重写历史。

回环登录页、账户接口、状态接口、SSE均通过，SSE收到`: connected`。从本机访问真实公网HTTPS域名、www域名及IP登录页均200，JS/CSS和账户接口200；匿名世界接口401符合登录门。初次上线后的Python探测曾超时，随后回环状态接口23ms、管理实验接口138ms、用量接口793ms恢复正常，公网复查也通过；没有因此改配置或重启。未完成长期延迟基准或SSE长时稳定性测试。

相关脱敏证据：deployment.json、runtime-check.json、metrics-check.json、public-check.json。本报告提交仅记录已完成部署，不改变生产代码版本。
