// 入口：读配置，恢复或创建世界，启动 HTTP 与刻调度器。
//   npm start        正常启动（TICK_MS 默认 5 分钟）
//   npm run demo     快速刻 + 沙盘脑：node server.js --demo
//   npm run fresh    删除当前世界数据后以 demo 模式重开：node server.js --demo --reset

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig, applyConfig } from './src/config.js';
import { Runtime } from './src/runtime.js';
import { createApp } from './src/http/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));

const cfg = loadConfig();
cfg.trustProxy = process.env.TRUST_PROXY === '1';
applyConfig(cfg);
if (cfg.host !== '127.0.0.1' && !cfg.adminKey) console.warn('提示：对外监听但没有设置 ADMIN_KEY，管理接口保持关闭。');

const rt = Runtime.open(cfg, {
  version: pkg.version,
  onCreate: (runtime) => {
    // 演示用的沙盘脑：走命令日志，这样回放才能重建（第 11 步）
    if (cfg.sandboxAgents > 0) runtime.exec('admin', { op: 'seed_sandbox', args: { count: cfg.sandboxAgents } });
  },
});
const app = createApp(rt, cfg);

app.server.listen(cfg.port, cfg.host, () => {
  console.log(`后人纪 · ${rt.w.id}（第 ${rt.w.clock.tick} 刻，种子 ${rt.w.seed}）`);
  console.log(`观测站：http://${cfg.host}:${cfg.port}   一刻 = ${cfg.tickMs} ms${cfg.demo ? '（demo 模式）' : ''}`);
  rt.start();
});

let closing = false;
const shutdown = async (signal) => {
  if (closing) return;
  closing = true;
  console.log(`\n收到 ${signal}，正在保存快照并退出……`);
  await app.close();
  rt.close();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
