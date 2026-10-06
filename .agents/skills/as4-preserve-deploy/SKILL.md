---
name: as4-preserve-deploy
description: 将 as4（后人纪）GitHub 最新代码部署到现有生产服务器，保留当前纪元、居民、账户、运行器和配置，执行兼容性检查、一致性备份、短暂停服切换与验证。用于更新或部署本项目，不用于新建或重置世界。
---

# 后人纪保状态部署

使用普通 Git、SSH、Shell、Node.js 和 HTTP 工具执行，不依赖某个 Agent 的专有工具。用户要求部署即授权执行本流程；只要求创建技能、审查或预演时不改变生产。未提出的提交、推送、模型更换、调参和新建世界不在范围内。

## 不变量

- 默认目标：GitHub `https://github.com/layeshi/as4.git` 的远端默认分支最新提交。发布开始时解析并固定完整 SHA，不拿本地 HEAD、脏工作区或旧远端缓存冒充最新代码。
- 历史生产地址 `root@38.76.221.106:53251`，服务 `houren.service`，程序 `/opt/houren/current` → `/opt/houren/releases/…`，数据 `/var/lib/houren/data`，私有配置 `/etc/houren`。这些是发现线索，每次以服务器实际服务配置为准。不要误用旧服务器 38.76.221.157。
- 保留有效 DATA_DIR、WORLD_ID、纪元/physics、seed、地图、时钟、命令/事件历史、居民、法律、能量、账户、凭据、托管绑定及累计用量。保留现有模型、预算、时间参数和暂停/启用状态；不能用旧文档参数覆盖当前值。
- 禁止 `--reset`、`npm run fresh`、demo/seed、初始化管理员、重置密钥、手动推进 tick、重新生成先民、删存档、覆盖私有配置或 `rsync --delete` 到持久目录。升级不是重新开一纪。
- 不同时运行两个写入同一世界目录的进程。预演只能使用隔离副本，不启动真实模型驱动、不监听公网、不执行模型动作。
- 这是短暂停服升级，不保证零中断。正常退出保存快照；登录会话、SSE 连接、进行中的模型请求和内存日志不能完整保留，登录可能失效，连接需重建，刻定时器重置。部署前告知这些边界。

## 1. 读取现场、固定版本

1. 在项目根读取 `docs/DEPLOYMENT-38.76.221.106.md` 和存在的部署文档；检查 `git status --short`、origin URL。保护已有修改，不 stash/reset/提交它们。
2. 用 `git ls-remote --symref https://github.com/layeshi/as4.git HEAD` 识别默认分支；用户指定分支时优先使用。独立临时 clone/fetch，固定 SHA 后 checkout detached，并记录分支与 SHA。查询失败就停止，不回退缓存。若最新提交在准备期间变化，报告本次固定时间，不循环追逐。
3. 通过已配置 SSH 身份或安全交互认证连接，不硬编码密码，不关闭 host-key 校验。确认主机、服务和路径：读取 current 链接、服务 MainPID/ExecStart/WorkingDirectory/User/EnvironmentFiles/TimeoutStopUSec/Restart 信息，检查磁盘空间和 nginx/Xray 当前状态。不要输出 Environment 全量、私有文件或含凭据的参数；仅提取非敏感白名单及摘要。
4. 核对实际 DATA_DIR 和 WORLD_ID；必须是现有世界，有可读且非空的 snapshot.json、commands.jsonl（合法零命令世界除外）和所需文件。目录缺失、权限不符、路径变化或服务原本异常时先诊断，不能让 Runtime.open 创建新世界掩盖问题。
5. 记录停机前非敏感基线：发布目录、世界 id/physics/epoch/seed 的内部摘要、tick、commandN、事件序号、居民数量、账户数量、运行器数量及 enabled 状态、躯壳暂停状态、用量日期与累计值；私有基线仅留服务器受限目录。记录持久目录和配置的权限及属主。
6. 对比服务器当前源码/发布清单（包括 AUDIT-RELEASE.json 等热修复清单）与目标 SHA。package.json 的 version 不能证明发布版本。重点确认历史 reset_owner_key 命令、运行器 ownerHash 修复及其他线上热修复已包含；有缺失或语义回退就停止并解释，不暗中叠补丁后仍称 GitHub 原版。

## 2. 停服前完成准备

1. 在隔离 checkout 审查目标代码中的 `server.js`、`src/runtime.js`、`src/config.js`、`src/store.js`、`src/tools/replay.js`、账户、运行器及预算存储。确认目标版本支持当前快照、日志与配置；评估存储迁移及旧版回滚兼容性。
2. 按目标 package.json 安装依赖并运行 `npm test`；有 lockfile 用 npm ci，无 lockfile 用 npm install 并记录解析结果。生产依赖在新 release 内提前安装，保持旧程序运行。Node 版本须满足目标 engines；不顺便升级系统 Node 或其他服务。跨平台本地 node_modules 不直接搬到 Linux。
3. 从固定 SHA 的干净 checkout 制作代码归档，不包含本地 data、私有配置、密钥、.git 或测试用生产副本。审查跟踪文件是否误带私密数据。生成 SHA-256；上传到唯一的新 release 目录，服务端校验归档哈希并校验解包结果。记录 SHA、包摘要、依赖安装信息和旧链接目标。
4. 准备受限备份目录（0700，文件 0600）和足够空间。可先做在线预拷贝减少停机时间，但在线多文件拷贝不是一致性备份。完整测试和依赖安装不放进停机窗口。
5. 根据真实数据规模预估停机窗口；如果完整回放过慢，可提前在已有一致性副本预检，但不能跳过最终停止点兼容性验证。不能承诺固定秒数。配置好异常处理，停服后任一失败都进入恢复分支，不能只退出脚本留下服务停止。

## 3. 一致性停止、验证、切换

1. 使用服务器端部署锁（例如 flock）避免并发发布；锁应覆盖最终基线、停止、备份、切换、验收/恢复。在可续接会话或服务端受控任务执行，并持久记录阶段，以免 SSH 断线丢失恢复信息。
2. `systemctl stop houren.service`，等待正常 SIGTERM 退出，核对 MainPID=0、无遗留写进程以及退出状态。检查 TimeoutStopSec 足以完成当前 close 链；超时被 SIGKILL 或快照落盘不完整则停止升级，按旧版本恢复流程处理，不假称干净退出。
3. 此时重新记录最终基线，备份整个实际 DATA_DIR（含所有世界、accounts.json、runners.enc 与 runners.key、shells-usage.json、存在的 runner-usage.json 和未来新增文件），整个 /etc/houren，以及实际 systemd unit/drop-ins、nginx 配置和旧 release。备份保留权限、属主、隐藏文件；不只挑 snapshot.json。不改变 nginx/Xray。
4. 检查归档可解包、必需文件及摘要；在服务器受限临时目录解出副本。确保快照 commandN 对应完整日志末尾，日志连续且没有未说明的尾部；不能只比较文件存在性。
5. 用目标版本在副本上运行回放，依据实际运行配置应用时间/天象等确定性参数。`DATA_DIR=<副本根> node src/tools/replay.js <WORLD_ID>` 仅是入口示例；必须把有效配置安全传入，不能丢掉配置使用默认值，也不能直接 shell source 未验证的 systemd env 文件。要求返回完整回放 OK，不能用 `--to` 的部分回放替代。工具可能输出敏感差异，只在受限日志保留并向用户脱敏汇报。
6. 在同一隔离副本上调用目标版本 Runtime.open → 读取摘要 → Runtime.close（不 rt.start、不 createApp）。核对恢复后 stateHash 与最终快照一致，没有新世界、倒退或丢居民。对存在的账户/运行器/预算存储做离线加载验证，不触发 activate/模型调用；校验加密文件可解密、绑定有效且 enabled/paused 和用量保留。只报告数量/布尔值，不输出凭据。若候选版本没有安全离线入口，编写隔离验证 harness，不能改用生产启动探路。
7. 切换前以实际服务 UID/GID/附加组验证持久目录、快照、日志和存在的运行器加密文件的访问权限与属主；不能以 root 能读代替服务身份可读。目标版本带有 `src/tools/deploy-preflight.js` 时，按 [只读预检说明](../../../docs/DEPLOY-PREFLIGHT.md) 执行，并传入固定 SHA、版本及覆盖发布文件的 SHA-256 清单。非零退出即进入恢复分支，禁止切换或用生产启动探路。没有工具的旧目标也必须完成等效权限检查。仅检查服务直接读取的配置；root-only 的 systemd EnvironmentFiles 由 systemd 读取，不错误要求 houren 用户直接访问。
   若存在法律执行版本迁移，还须确认目标代码完整回放支持该版本，不能仅凭 package.json 或预检修订号判定兼容。通过后保证新 release 属主和可读权限正确、服务工作目录仍通过 current 且 DATA_DIR 指向原持久目录。在同一文件系统创建临时链接后用原子 rename 切换 current；不要把新代码复制覆盖旧 release。
8. 启动 houren.service。正常更新不改 unit/nginx，无需 daemon-reload 或重启 nginx/Xray。不恢复备份覆盖现有数据，不执行世界初始化。

## 4. 上线验收

- 确认 current 指向目标 release、MainPID 的实际启动目录/命令正确，服务 active，无重启循环，nginx/Xray 与之前状态一致。
- 从本机回环和真实公网入口请求首页、引用的 JS/CSS、`/api/public/state`、`/api/account`（以目标路由为准）。检查响应结构与业务内容，不仅 HTTP 200；未登录状态不等于账号丢失。
- `/api/public/stream` 收到 `: connected`；设置有界超时，收到数据后超时退出不是 SSE 失败。
- 确认相同世界和纪元，tick/commandN/事件序号不倒退；已恢复后的世界可自然变化，居民死亡、token 用量增加不能简单要求上线后逐字节相等。用命令日志解释变化，核实历史前缀保留、账户仍在、运行器配置与启用状态未被启动代码删除。服务运行中多文件副本不能用来断言严格一致性。
- 看启动恢复日志及自然运行器活动；HTTP/SSE 正常不代表模型成功。供应商余额、限流、授权失败单独报告，不擅自换 key/模型或重试真实付费调用。不为测试推进世界或修改法律。
- 输出固定 SHA、新旧 release、备份位置、停机时长、保状态证据、实际检查结果与未验证事项。只在上述证据满足时称部署成功。

## 5. 失败恢复

- 停服前失败：保持原服务，保留诊断后结束。
- 已停止、尚未启动新版本：不改变持久数据；恢复旧 current 并启动原服务，验收旧世界。若存在 SIGKILL/日志尾部异常，先保存现场并在副本用旧版本检查恢复；不要删除日志或使用 reset。若无法证明可安全恢复，保留现场并报告需要处理的原因。
- 新版本已启动：先正常停止并另存失败现场。新进程可能已经推进世界，禁止直接覆盖为发布前备份。先在当前数据副本验证旧代码完整回放和离线恢复兼容；兼容才能回切旧代码并使用当前数据重启。
- 若发生不兼容迁移、旧版不能读新数据或需要丢弃上线后的进展，停止自动回滚；明确损失范围并征求用户对数据恢复的决定。默认升级授权不包含丢弃居民新动作/交易。备份与旧 release 不自动清理。

## 三种工具的入口

本文件是唯一完整流程。项目 `.claude/skills/as4-preserve-deploy/SKILL.md` 和 `.grok/skills/as4-preserve-deploy/SKILL.md` 只引导读取它。Codex 使用项目 `.agents/skills`。

- Codex：`$as4-preserve-deploy 将 GitHub 最新代码部署到服务器，保留当前纪元和运行状态。`
- Claude Code / Grok Build：`/as4-preserve-deploy 将 GitHub 最新代码部署到服务器，保留当前纪元和运行状态。`
- 若当前客户端未刷新技能列表，重新打开项目会话；通用兜底：要求先读取本文件再执行部署。

路径约定依据 [Codex 技能文档](https://developers.openai.com/codex/skills)、[Claude Code 技能文档](https://code.claude.com/docs/en/skills)、[Grok Build 技能文档](https://docs.x.ai/build/features/skills-plugins-marketplaces)。这些入口是兼容配置，不代表已在三个客户端完成实际线上部署测试。
