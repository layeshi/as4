# 只读部署预检

`src/tools/deploy-preflight.js` 检查明确指定的发布目录、数据目录、世界和配置文件。它不调用 `Runtime.open`，不创建世界，不截断或修复日志，也不写入目录、配置或环境变量。

```sh
node src/tools/deploy-preflight.js \
  --release-dir /opt/houren/releases/RELEASE \
  --data-dir /var/lib/houren/data \
  --world-id WORLD_ID \
  --service-user houren \
  --expected-version 0.1.0 \
  --expected-hash FULL_REVISION \
  --config-file /etc/houren/shells.json \
  --manifest-file /path/to/release-file-hashes.json
```

`--service-user` 通过 `id` 查询实际 UID、主 GID 和附加组。也可显式提供 `--uid UID --gid GID --groups GID1,GID2`；这些值必须来自实际服务身份。文件与父目录权限使用这一身份的 POSIX 属主、属组和权限位判断，即使预检进程以 root 运行，root 的读权限也不能代替服务用户的权限。它不检查 ACL、SELinux 或服务沙箱策略。

检查项目包括世界目录可遍历、可写和属主，快照和日志的读写权限与属主，存在的运行器加密文件的属主和私有权限，配置文件可读性与 JSON 语法，快照的基本结构，以及命令、事件 JSONL 的完整尾部与连续编号。快照计数不得领先对应日志。异常只输出固定目标标签和错误码，不输出文件内容、路径、提示、回复或密钥。

`--expected-version` 对比发布目录的 `package.json`。`--expected-hash` 对比发布目录中的 `REVISION`；没有该文件时读取 Git HEAD。二者只证明声明的版本与修订号吻合，不能证明发布目录所有字节都与提交一致，也不证明运行时行为。

可选的 `--manifest-file` 增加发布文件字节核验。清单是明确允许校验的相对路径到小写 SHA-256 的 JSON 对象，例如：

```json
{
  "server.js": "64-character-lowercase-sha256",
  "src/runtime.js": "64-character-lowercase-sha256"
}
```

每项必须是非空、无 `.`/`..` 路径段的相对路径，不能含反斜杠、绝对路径或越出发布目录的符号链接。每个摘要必须恰好是 64 位十六进制。`contentVerified: true` 只证明清单列出的文件字节吻合；清单应覆盖部署所需的全部文件，未列出的文件不在该结论内。未提供清单时，不返回 `contentVerified`，校验仍限于修订号。

退出码：0 为所有检查通过，1 为预检拒绝，2 为命令行参数或服务身份查询失败。检查失败后由部署操作者决定如何修复；工具本身不会更改属主、权限、世界状态或日志。
