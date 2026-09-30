// HTTP 测试辅助：在随机端口上启动完整的服务器（真实的 Runtime + 数据目录），用 fetch 调用。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from '../src/runtime.js';
import { createApp } from '../src/http/server.js';
import { loadConfig } from '../src/config.js';

export async function boot(extra = {}, { dir = mkdtempSync(join(tmpdir(), 'houren-http-')) } = {}) {
  const cfg = { ...loadConfig({}, []), dataDir: dir, worldId: 'w', seed: 'http-seed', adminKey: 'test-admin-key', trustProxy: true, ...extra }; // trustProxy：测试用 X-Forwarded-For 区分「客户端」
  const rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
  const app = createApp(rt, cfg, { logger: {} });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const env = {
    rt, app, base, dir, cfg, ipSeq: 1,
    async close({ keepDir = false } = {}) {
      rt.close();
      await app.close();
      if (!keepDir) rmSync(dir, { recursive: true, force: true });
    },
    /** 调用接口，返回 { status, headers, json, text } */
    async call(path, { method = 'GET', body, token, admin, headers = {}, raw, ip } = {}) {
      const h = { ...headers };
      // 港口接口按 IP 限速（每小时 5 次）：默认给每个请求一个不同的 IP，限速用例显式传 ip 固定住
      if (ip) h['X-Forwarded-For'] = ip;
      else if (/^\/api\/port\/(register|adopt|foster)/.test(path)) h['X-Forwarded-For'] = `10.9.${(env.ipSeq >> 8) & 255}.${env.ipSeq++ & 255}`;
      if (token) h.Authorization = `Bearer ${token}`;
      if (admin) h['X-Admin-Key'] = admin === true ? cfg.adminKey : admin;
      let payload;
      if (raw !== undefined) payload = raw;
      else if (body !== undefined) {
        payload = JSON.stringify(body);
        h['Content-Type'] = 'application/json';
      }
      const res = await fetch(base + path, { method, headers: h, body: payload });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // 不是 JSON（静态文件、SSE）
      }
      return { status: res.status, headers: res.headers, json, text };
    },
    /** 注册一位 agent，返回 { agentId, agentToken, ownerKey } */
    async register(name, extra2 = {}) {
      const r = await env.call('/api/port/register', {
        method: 'POST',
        body: { name, bio: `${name}的自我介绍`, soul: `SECRET-SOUL-${name}`, lang: 'zh', model: `SECRET-MODEL-${name}`, creatorName: `SECRET-CREATOR-${name}`, ...extra2 },
      });
      if (r.status !== 201) throw new Error(`register failed: ${r.status} ${r.text}`);
      return r.json;
    },
  };
  return env;
}
