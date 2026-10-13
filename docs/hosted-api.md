# 平台托管 DeepSeek 后端接口

所有新接口均使用账号会话；`/api/admin/hosted…` 仅限管理员。POST 需 `Content-Type: application/json`、`X-Houren-Request: 1`，沿用现有同站验证。成功均为 HTTP 200；错误沿用 `{ error: { code, message } }`，中文消息。未登录 401，非管理员访问管理接口 403，申请不存在或不属于当前用户 404，非 pending 申请再次处理 409，申请限额 429。

## 金额与公共类型

接口金额均为安全整数微元：1 元 = 1,000,000 微元。页面录入「元」后应做十进制换算；单价同样换算后提交，不能直接提交浮点元值。

- `Prices = { miss, hit, output }`：三个非负整数，单位微元 / 百万 token。尚未配置时为 `null`。
- `Usage = { calls, input, cacheRead, output, costMicro }`：成功调用的次数、服务商报告的输入 / 缓存命中输入 / 输出 token 数、实际扣费。失败或我方取消不计费，也不计入此扣费汇总；现有 runner telemetry 继续记录失败。成功未报用量按预留收费，汇总 token 数为 0。
- `Request = { id, accountId, requestId, amountMicro, note, status, createdAt, updatedAt, decider, decidedAt, cancelledAt, creditMicro, adminNote }`。`status` 为 `pending|approved|rejected|cancelled`；时间为 ISO 8601，未处理的 `decider/decidedAt/cancelledAt` 为 `null`，`creditMicro` 为 0。`decider` 是处理管理员账号 ID。
- `Entry = { id, accountId, at, amountMicro, adminId, note, requestId, kind }`：`kind` 为 `credit|adjustment`；`amountMicro` 带正负号；充值记录的 `requestId` 指向申请 `id`，手动调整为 `null`。
- `Config = { enabled, baseURL, model, thinking, maxOutputTokens, pricesMicro, hasApiKey }`。不含密钥。

## 用户接口

### GET /api/account/hosted

无需请求体。返回：

```js
{
  enabled, available, model, thinking, maxOutputTokens, pricesMicro,
  storageFault, balanceMicro, reservedMicro, total: Usage,
  requests: Request[], // 最近 20 条，新的在前
  ledger: Entry[],     // 最近 50 条，新的在前
  usage: {
    timezone, from, through, // YYYY-MM-DD，含今天的最近 30 个现实日
    residents: [{ residentId, ...Usage }]
  }
}
```

`available` 仅在已开放并配齐模型、密钥和三个单价时为 true。可用金额是 `balanceMicro - reservedMicro`；`storageFault` 为 true 时禁止新预留、充值和调整。收款码继续从已有的 `GET /api/public/support` 获取。

### POST /api/account/hosted/requests

请求 `{ amountMicro, note?, requestId }`；返回 `{ request: Request }`。

金额 1–5,000 元且精确到分，即 `1000000 <= amountMicro <= 5000000000` 且为 10000 的倍数。说明至多 200 个 Unicode 字符。`requestId` 为 1–128 位字母、数字、下划线、冒号或连字符（排除 JavaScript 原型保留名称）。同一账号同一编号始终返回原申请及其当前状态，不另记提交次数；不同账号独立。最多 5 个待处理申请，每个滑动小时最多 10 次成功提交，重启后限额仍有效。

### POST /api/account/hosted/requests/:id/cancel

请求 `{}`；返回 `{ request: Request }`。仅本人 pending 申请可撤回。

## 管理员接口

### GET /api/admin/hosted

无需请求体。返回：

```js
{
  config: Config, available, storageFault, timezone, day,
  stats: {
    balanceMicro, reservedMicro,
    today: { ...Usage, tokens }, // tokens = input + output
    hostedResidents            // 有效托管配置的居民数，含已暂停的
  },
  requests: [{ ...Request, username }], // 全部 pending
  accounts: [{ accountId, username, balanceMicro, reservedMicro, total: Usage }]
}
```

`accounts` 包括余额非零或曾有成功用量的账号；已不存在账号的用户名为 `null`。

### POST /api/admin/hosted/config

请求可部分更新：

```js
{ enabled?, baseURL?, model?, apiKey?, clearApiKey?, thinking?, maxOutputTokens?, pricesMicro? }
```

返回 `{ config: Config, available }`。缺省地址 `https://api.deepseek.com`；`thinking` 为 `default|enabled|disabled`；最大输出缺省 4096，范围 256–32000。首次开放前必须填写三个单价；pricesMicro 更新时必须同时给 miss、hit、output。`apiKey` 省略、空字符串或纯空白保留旧值；`clearApiKey: true` 清除。清除后可保持 enabled，但 available 为 false。

保存后自动停止并重启此前启用的托管运行器；不可用时只保留启用意图，状态为 `hosted_unavailable`。手动暂停的运行器不会被启动。更新管理员模型不改写居民保存时的公开模型标签。

### POST /api/admin/hosted/test

请求形状同 config，可省略字段以复用已保存值；返回 `{ ok: true, model }`。用原生 done 工具验证一次连接；不保存配置、不重启运行器、不扣用户余额。费用由平台承担，失败只返回固定中文错误，不回传上游正文。

### POST /api/admin/hosted/requests/:id/approve

请求 `{ creditMicro, note? }`；返回 `{ request: Request }`。实际入账额必须为正安全整数微元，可与申请金额不同；用户提交申请的金额限额不限制管理员核实后的实收额。批准与记账同一原子写入，只能批准 pending 申请。

### POST /api/admin/hosted/requests/:id/reject

请求 `{ note }`；返回 `{ request: Request }`。原因必填，至多 200 个 Unicode 字符；仅限 pending。

### POST /api/admin/hosted/adjust

请求 `{ username, amountMicro, note }`；返回 `{ entry: Entry, balanceMicro }`。用户名忽略大小写；金额为非零安全整数微元，允许负数；原因必填，至多 200 个 Unicode 字符。

## 居民运行器接入

现有居民 runner save 请求使用 `{ op: 'save', config: { hosted: true, actEveryTicks?, historyRounds?, timeoutMs? } }`。接受过继的现有请求也可使用该 config。运行器强制 `toolMode: 'native'`、`actionTools: 'typed'`，保存管理员当时的 model 标签，不保存 provider、baseURL 或 apiKey。用户对 hosted config 发起 test 会返回 400。

新增状态：`hosted_balance_low`（余额不足，下次作息时刻自动重试）、`hosted_unavailable`（平台关闭或未配齐模型）。前者可能由醒来前输出预留检查或调用前完整预留检查触发；首轮预留不足退回游戏醒来费用，后续轮不足不退。费用始终扣运行器启动时的账号。

数据仅位于数据根目录 `hosted/model.enc`、`hosted/model.key`（0600）和 `hosted/billing.json`。日汇总按 SHELL_TZ（缺省 Asia/Shanghai），读写时清理超过 90 日的记录；每账号累计、充值、调整和申请长期保留。预留只在内存；崩溃中的调用由平台承担。
