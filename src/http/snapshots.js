import { createReadStream, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { AccountError, fail } from '../accounts/store.js';
import { accountFor, mutationGate } from './accounts.js';
import { readJson, sendJson, timingEqual } from './util.js';

function authorize(ctx, req) {
  if (req.headers['x-admin-key'] !== undefined) {
    if (!ctx.cfg.adminKey || !timingEqual(req.headers['x-admin-key'], ctx.cfg.adminKey)) fail(401, 'unauthorized', '管理密钥无效。');
    return;
  }
  const user = accountFor(ctx, req);
  if (!user) fail(401, 'unauthorized', '请先登录管理员账号。');
  if (user.role !== 'admin') fail(403, 'forbidden', '此操作需要管理员权限。');
  if (req.method !== 'GET') mutationGate(req);
}

const wrap = (handler) => async (req, res, ctx, url, params) => {
  try {
    authorize(ctx, req);
    await handler(req, res, ctx, url, params);
  } catch (e) {
    if (!(e instanceof AccountError)) throw e;
    sendJson(res, e.status, { error: { code: e.code, message: e.message } });
  }
};

export const snapshotRoutes = [
  ['GET', '/api/admin/snapshots', wrap((req, res, ctx, url) => {
    const n = Number(url.searchParams.get('page'));
    const page = Number.isSafeInteger(n) && n > 0 ? n : 1;
    sendJson(res, 200, ctx.snapshots.list(page));
  })],
  ['POST', '/api/admin/snapshots', wrap(async (req, res, ctx) => {
    const body = await readJson(req, 8192);
    if (!body.ok) fail(body.code === 'too_large' ? 413 : 400, body.code, '请求格式无效或内容过大。');
    authorize(ctx, req);
    const snapshot = await ctx.snapshots.save(body.value, () => authorize(ctx, req));
    sendJson(res, 201, { snapshot });
  })],
  ['GET', /^\/api\/admin\/snapshots\/([^/]+)\/download$/, wrap(async (req, res, ctx, url, params) => {
    const file = ctx.snapshots.download(params[0]);
    res.writeHead(200, {
      'Content-Type': 'application/gzip', 'Content-Length': statSync(file).size,
      'Content-Disposition': `attachment; filename="houren-snapshot-${params[0]}.json.gz"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    });
    await pipeline(createReadStream(file), res);
  })],
];
