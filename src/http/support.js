import { createHash } from 'node:crypto';
import { mkdirSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { AccountError, fail } from '../accounts/store.js';
import { durableFile } from '../durable-file.js';
import { accountFor, accountWrap } from './accounts.js';
import { sendJson } from './util.js';

const KINDS = ['wechat', 'alipay'];
function qrFile(ctx, kind) {
  if (!KINDS.includes(kind)) fail(404, 'not_found', '收款方式不存在。');
  return join(ctx.cfg.dataDir, 'support', `${kind}.png`);
}
async function qrImage(ctx, kind) {
  try { return await readFile(qrFile(ctx, kind)); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
const version = image => createHash('sha256').update(image).digest('hex').slice(0, 16);

// libvips can expose only the first frame of APNG. Reject its animation control
// chunk explicitly, in addition to sharp's page count for other formats.
function animatedPng(input) {
  for (let offset = 8; offset + 12 <= input.length;) {
    const length = input.readUInt32BE(offset);
    if (input.toString('ascii', offset + 4, offset + 8) === 'acTL') return true;
    offset += length + 12;
  }
  return false;
}
async function uploadQr(req, res, ctx, url, params) {
  try {
    const file = qrFile(ctx, params[0]);
    if (req.headers['x-houren-request'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'csrf', '请求验证失败。');
    const actor = accountFor(ctx, req);
    if (!actor) fail(401, 'unauthorized', '请先登录。');
    if (actor.role !== 'admin' || actor.status !== 'active') fail(403, 'forbidden', '此操作需要启用的管理员账号。');
    const check = () => {
      const user = accountFor(ctx, req);
      if (!user || user.id !== actor.id || user.revision !== actor.revision) fail(401, 'unauthorized', '请重新登录。');
      if (user.role !== 'admin' || user.status !== 'active') fail(403, 'forbidden', '此操作需要启用的管理员账号。');
    };
    if (!ctx.accountLimits.claim.take(actor.id)) fail(429, 'rate_limited', '图片更换过于频繁，请稍后重试。');
    const chunks = []; let size = 0;
    // Do not destroy the socket on early iterator exit: the client needs the 413.
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) { req.resume(); fail(413, 'too_large', '图片不能超过2 MiB。'); }
      chunks.push(chunk);
    }
    let encoded;
    try {
      const input = Buffer.concat(chunks), meta = await sharp(input, { limitInputPixels: 16000000, animated: true }).metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages ?? 1) !== 1 || meta.format === 'png' && animatedPng(input)) fail(400, 'invalid_image', '只支持静态 JPEG、PNG、WebP。');
      encoded = await sharp(input, { limitInputPixels: 16000000 }).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    } catch (e) {
      if (e instanceof AccountError) throw e;
      fail(400, 'invalid_image', '图片无法解码或超过16MP。');
    }
    // No asynchronous gap between the final authorization and atomic publication.
    check();
    mkdirSync(join(ctx.cfg.dataDir, 'support'), { recursive: true, mode: 0o700 });
    durableFile(file, encoded);
    sendJson(res, 200, { ok: true });
  } catch (e) {
    if (!(e instanceof AccountError)) throw e;
    sendJson(res, e.status, { error: { code: e.code, message: e.message } });
  }
}

export const supportRoutes = [
  ['POST', /^\/api\/admin\/support\/qr\/([^/]+)$/, uploadQr],
  ['DELETE', /^\/api\/admin\/support\/qr\/([^/]+)$/, accountWrap(({ res, ctx, params }) => {
    try { unlinkSync(qrFile(ctx, params[0])); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    sendJson(res, 200, { ok: true });
  }, { admin: true })],
  ['GET', '/api/public/support', accountWrap(async ({ res, ctx }) => {
    const entries = await Promise.all(KINDS.map(async kind => {
      const image = await qrImage(ctx, kind);
      return [kind, image ? `/api/public/support/qr/${kind}?v=${version(image)}` : null];
    }));
    sendJson(res, 200, { qr: Object.fromEntries(entries) });
  })],
  ['GET', /^\/api\/public\/support\/qr\/([^/]+)$/, accountWrap(async ({ res, ctx, params }) => {
    const image = await qrImage(ctx, params[0]);
    if (!image) fail(404, 'not_found', '收款码尚未设置。');
    // Revalidate even old/unversioned URLs: these fixed slots can be replaced or removed.
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': image.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=0, must-revalidate' });
    res.end(image);
  })],
];
