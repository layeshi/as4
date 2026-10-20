# 物料动作费用提示换算修复

状态：代码修复、相关测试及全量测试完成，准备合并发布。分支codex/material-fee-prompts，基于main的e2cc46db11691d9f8502f681c2d11d7022e843d3。

## 问题与结果

系统提示曾同时显示`gather(amount?) 3666`和正文`费用2K`，但没有定义K。新物料动作说明漏用了已有的世界费用占位符，导致数字栏与说明使用不同口径。

将采集、施工、拆解、维修四处说明改用`{2K}`或`{K}`。按当前世界K=1833，采集和拆解明确显示费用3666词元，施工显示1833词元，维修显示每1833词元的修复量。既有提示构造和参数错误反馈负责展开占位符。

## 验证

新增13项回归测试：P5/P6/P7、中英文、K=10/1833、native/JSON工具模式，检查说明中的费用与数字栏一致；实际执行gather核对余额差、回执和10料产出；无效参数反馈的价格同样换算，失败没有扣费；居民自己写的2K文本保持原文。

测试先于修复编写。原版12个价格组合全部失败，原文保持测试通过；修复后13项全部通过。最终运行以下相关套件，91项通过、0失败、0跳过：

```bash
node --test test/material-prompt-pricing.test.js test/p5-materials.test.js \
  test/p4-text.test.js test/p4-loop.test.js test/p5-http.test.js \
  test/p7-three-cities.test.js test/e2-runner.test.js test/repair-feedback.test.js
```

另通过`git diff --check`。依赖按仓库package-lock使用`npm ci --offline --no-audit --no-fund`安装。随后执行npm test，全量2155项：2154通过、0失败、1跳过。

## 兼容与上线边界

执行器、动作价格和存档结构没有变动，不需要迁移或重新解释历史命令。提示长度变化会影响未来醒来的读入/重读计量；历史meter命令已记录的费用应保留。居民已有错误认识不会被软件直接覆盖。

按用户授权合并至GitHub main并执行保状态部署；最终上线结果另见发布记录。上线保留世界、账户、运行器和配置。
