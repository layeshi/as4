import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { createApp, CSP } from '../src/http/server.js';
import { installFakeDom } from './fake-dom.js';
import { openAccount } from '../public/accounts.js';
import { supportQrPanel } from '../public/admin-panels.js';
import { adminSections } from '../public/admin.js';
import { closeAllModals } from '../public/modals.js';
import { getLang, setLang } from '../public/i18n.js';

const qrPath = kind => `/api/admin/support/qr/${kind}`;
const png = (background = '#fff', width = 32, height = 24) => sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length); chunk.write(type, 4); data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}
async function apng() {
  const frames = await Promise.all([png('#000', 2, 2), png('#fff', 2, 2)]);
  const idat = frame => {
    const chunks = [];
    for (let offset = 8; offset + 12 <= frame.length;) {
      const length = frame.readUInt32BE(offset);
      if (frame.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(frame.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    return Buffer.concat(chunks);
  };
  const control = Buffer.alloc(8); control.writeUInt32BE(2);
  const frameControl = sequence => {
    const data = Buffer.alloc(26); data.writeUInt32BE(sequence); data.writeUInt32BE(2, 4); data.writeUInt32BE(2, 8); data.writeUInt16BE(1, 20); data.writeUInt16BE(10, 22);
    return pngChunk('fcTL', data);
  };
  const sequence = Buffer.alloc(4); sequence.writeUInt32BE(2);
  return Buffer.concat([frames[0].subarray(0, 33), pngChunk('acTL', control), frameControl(0), pngChunk('IDAT', idat(frames[0])), frameControl(1), pngChunk('fdAT', Buffer.concat([sequence, idat(frames[1])])), pngChunk('IEND', Buffer.alloc(0))]);
}
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'heirs-support-'));
  const cfg = { ...loadConfig({}, []), dataDir: dir, worldId: 'w', seed: 'support' };
  const rt = Runtime.open(cfg, { logger: {} }), app = createApp(rt, cfg, { logger: {} });
  t.after(async () => { await app.close(); rt.close(); rmSync(dir, { recursive: true, force: true }); });
  const admin = await app.ctx.accounts.create({ username: 'chief', password: 'test-password-1234' }, { role: 'admin' });
  const user = await app.ctx.accounts.create({ username: 'alice', password: 'test-password-1234' });
  const cookies = Object.fromEntries([['admin', admin], ['user', user]].map(([key, u]) => [key, `houren_session=${app.ctx.accounts.issue(u.id)}`]));
  // Use the real dispatcher and middleware without a socket, so the security tests
  // also run in sandboxes that forbid listen(). Images only exist in this temp dir.
  async function call(path, { method = 'GET', as, raw, chunks, headers = {} } = {}) {
    const req = Readable.from(chunks ?? (raw === undefined ? [] : [raw]));
    Object.assign(req, { method, url: path, socket: { remoteAddress: '127.0.0.1' }, headers: { cookie: cookies[as], 'x-houren-request': '1', 'content-type': 'application/json', ...headers } });
    const result = { headers: new Headers() };
    const res = {
      setHeader: (k, v) => result.headers.set(k, v), getHeader: k => result.headers.get(k),
      writeHead(status, values = {}) { result.status = status; for (const [k, v] of Object.entries(values)) result.headers.set(k, v); this.headersSent = true; return this; },
      end(body) { result.body = Buffer.from(body ?? ''); result.text = result.body.toString(); try { result.json = JSON.parse(result.text); } catch {} },
    };
    await app.server.listeners('request')[0](req, res);
    return result;
  }
  const upload = (raw, options = {}) => call(qrPath('wechat'), { method: 'POST', as: 'admin', raw, ...options });
  return { dir, app, admin, cookies, call, upload, file: kind => join(dir, 'support', `${kind}.png`) };
}

test('support upload requires an active admin session and same-site mutation header', async t => {
  const e = await setup(t), image = await png();
  for (const [options, status, code] of [
    [{ as: undefined }, 401, 'unauthorized'], [{ as: 'user' }, 403, 'forbidden'],
    [{ headers: { 'x-houren-request': undefined } }, 403, 'csrf'],
    [{ headers: { 'sec-fetch-site': 'cross-site' } }, 403, 'csrf'],
  ]) {
    const r = await e.upload(image, options);
    assert.equal(r.status, status, r.text); assert.equal(r.json.error.code, code);
  }
  e.app.ctx.accounts.get(e.admin.id).status = 'disabled';
  assert.equal((await e.upload(image)).status, 401);
  assert.equal(existsSync(e.file('wechat')), false);
});

test('support upload bounds streaming bytes and rejects invalid, animated and oversized images', async t => {
  const e = await setup(t);
  const large = await e.upload(undefined, { chunks: [Buffer.alloc(1024 * 1024), Buffer.alloc(1024 * 1024), Buffer.from('x')] });
  assert.equal(large.status, 413); assert.equal(large.json.error.code, 'too_large');
  const animated = await sharp(Buffer.concat([Buffer.alloc(12, 150), Buffer.alloc(12, 20)]), { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0 }).toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
  for (const raw of [Buffer.from('not an image'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), animated, await apng(), await png('#fff', 4001, 4001)]) {
    const r = await e.upload(raw); assert.equal(r.status, 400, r.text); assert.equal(r.json.error.code, 'invalid_image');
  }
  assert.equal(existsSync(e.file('wechat')), false);
});

test('support stores lossless PNG at 0600, strips metadata, rotates and only downsizes', async t => {
  const e = await setup(t), image = await png();
  assert.equal((await e.upload(image)).status, 200);
  let meta = await sharp(e.file('wechat')).metadata();
  assert.equal(meta.format, 'png'); assert.equal(meta.width, 32); assert.equal(meta.height, 24);
  assert.deepEqual(await sharp(e.file('wechat')).raw().toBuffer(), await sharp(image).raw().toBuffer());
  const jpeg = await sharp(await png('#358', 1600, 800)).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  assert.ok((await sharp(jpeg).metadata()).exif);
  assert.equal((await e.upload(jpeg)).status, 200);
  meta = await sharp(e.file('wechat')).metadata();
  assert.equal(meta.format, 'png'); assert.equal(meta.width, 512); assert.equal(meta.height, 1024);
  for (const key of ['exif', 'icc', 'iptc', 'xmp', 'orientation']) assert.equal(meta[key], undefined, key);
  assert.equal(statSync(e.file('wechat')).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(join(e.dir, 'support')), ['wechat.png']);
  assert.equal((await e.upload(await sharp(image).webp().toBuffer())).status, 200);
  assert.equal((await sharp(e.file('wechat')).metadata()).format, 'png');
});

test('support lists versioned images, refreshes replacements, and deletes idempotently', async t => {
  const e = await setup(t);
  assert.deepEqual((await e.call('/api/public/support')).json, { qr: { wechat: null, alipay: null } });
  assert.equal((await e.call('/api/public/support/qr/wechat')).status, 404);
  await e.upload(await png());
  const first = (await e.call('/api/public/support')).json.qr.wechat;
  assert.match(first, /^\/api\/public\/support\/qr\/wechat\?v=[a-f0-9]{12,16}$/);
  await e.upload(await png('#000'));
  assert.equal((await e.call(qrPath('alipay'), { method: 'POST', as: 'admin', raw: await png('#348') })).status, 200);
  const listing = await e.call('/api/public/support'), second = listing.json.qr.wechat;
  assert.notEqual(first, second); assert.ok(listing.json.qr.alipay);
  assert.equal(listing.headers.get('cache-control'), 'no-store');
  assert.equal((await e.call('/api/public/support')).json.qr.wechat, second);
  for (const url of [first, second, '/api/public/support/qr/wechat']) {
    const r = await e.call(url);
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('cache-control'), /no-cache|no-store|must-revalidate/);
    assert.deepEqual(r.body, readFileSync(e.file('wechat')));
  }
  for (const [as, headers, status] of [[undefined, {}, 401], ['user', {}, 403], ['admin', { 'x-houren-request': undefined }, 403], ['admin', { 'sec-fetch-site': 'cross-site' }, 403]]) {
    assert.equal((await e.call(qrPath('wechat'), { method: 'DELETE', as, headers })).status, status);
  }
  for (let i = 0; i < 2; i++) assert.equal((await e.call(qrPath('wechat'), { method: 'DELETE', as: 'admin' })).status, 200);
  assert.equal(existsSync(e.file('wechat')), false);
  assert.equal((await e.call(second)).status, 404);
  const remaining = (await e.call('/api/public/support')).json.qr;
  assert.equal(remaining.wechat, null); assert.ok(remaining.alipay);
});

test('support only maps the two fixed QR kinds', async t => {
  const e = await setup(t);
  for (const kind of ['other', '__proto__', '..%2Faccounts.json']) {
    for (const method of ['POST', 'DELETE']) assert.equal((await e.call(qrPath(kind), { method, as: 'admin', raw: method === 'POST' ? await png() : undefined })).status, 404);
    assert.equal((await e.call(`/api/public/support/qr/${kind}`)).status, 404);
  }
  assert.equal(existsSync(join(e.dir, 'support')), false);
});

test('support rechecks the session after consuming and processing an upload', async t => {
  const e = await setup(t), image = await png();
  await e.upload(image);
  async function* revoked() {
    yield await png('#111');
    e.app.ctx.accounts.logout(e.cookies.admin.split('=')[1]);
  }
  const r = await e.upload(undefined, { chunks: revoked() });
  assert.equal(r.status, 401);
  assert.deepEqual(readFileSync(e.file('wechat')), image);
});

test('support upload rate limit is per administrator', async t => {
  const e = await setup(t), image = await png();
  for (let i = 0; i < 20; i++) assert.equal((await e.upload(image)).status, 200);
  assert.equal((await e.upload(image)).status, 429);
  const second = await e.app.ctx.accounts.create({ username: 'other_admin', password: 'test-password-1234' }, { role: 'admin' });
  e.cookies.second = `houren_session=${e.app.ctx.accounts.issue(second.id)}`;
  assert.equal((await e.upload(image, { as: 'second' })).status, 200);
});

test('support page is served with the strict CSP and bilingual non-profit statement', async t => {
  const e = await setup(t), r = await e.call('/support.html');
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-security-policy'), CSP);
  assert.match(r.text, /支持后人纪 · The Heirs/);
  assert.match(r.text, /后人纪是一个非营利的公开实验，不以盈利为目的，也不出售任何游戏内优势。/);
  assert.match(r.text, /The Heirs is a non-profit public experiment\./);
  assert.doesNotMatch(r.text, /\sstyle=|<script(?![^>]*\bsrc=)/);
  assert.equal((await e.call('/support.js')).status, 200);
});

test('support QR admin panel uploads raw files, refreshes previews, removes codes and reports errors; only admins get the console entry', async () => {
  const dom = installFakeDom(), saved = { fetch: globalThis.fetch, lang: getLang() };
  const qr = { wechat: null, alipay: null }, requests = [];
  let role = 'admin', failed = false;
  const reply = (status, json) => ({ ok: status === 200, status, json: async () => json });
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/account') return reply(200, { user: { role, username: 'chief', displayName: 'Chief' } });
    if (url === '/api/public/support') return reply(200, { qr });
    if (!url.startsWith('/api/admin/support/qr/')) return reply(200, { agents: [] });
    requests.push({ url, ...options });
    if (failed) return reply(400, { error: { message: '图片无法解码。' } });
    const kind = url.split('/').at(-1);
    qr[kind] = options.method === 'DELETE' ? null : `/api/public/support/qr/${kind}?v=1234567890abcdef`;
    return reply(200, { ok: true });
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const button = (root, text) => root.querySelectorAll('button').find(b => b.textContent === text);
  try {
    setLang('zh');
    const modal = supportQrPanel(); dom.root.append(modal); await settle();
    const cards = modal.querySelectorAll('.support-qr-card');
    assert.equal(cards.length, 2); assert.match(cards[0].textContent, /未设置/);
    const file = new Blob([await png()], { type: 'image/png' });
    cards[0].querySelector('input').files = [file];
    button(cards[0], '上传').click(); await settle();
    assert.equal(requests[0].body, file); assert.equal(requests[0].headers['X-Houren-Request'], '1');
    assert.equal(cards[0].querySelector('img').getAttribute('src'), qr.wechat);
    assert.match(modal.textContent, /收款码已更新/);
    failed = true;
    cards[1].querySelector('input').files = [file];
    button(cards[1], '上传').click(); await settle();
    assert.match(modal.textContent, /图片无法解码/); assert.equal(button(cards[1], '上传').disabled, false);
    failed = false; button(cards[0], '移除').click(); await settle();
    assert.equal(requests.at(-1).method, 'DELETE'); assert.equal(requests.at(-1).headers['X-Houren-Request'], '1');
    assert.equal(requests.at(-1).body, '{}'); assert.equal(cards[0].querySelector('img'), null);
    assert.match(modal.textContent, /收款码已移除/);
    modal.remove();
    const consoleLink = () => dom.root.querySelectorAll('a').find(a => a.getAttribute('href') === '/admin.html');
    role = 'user'; await openAccount();
    assert.equal(consoleLink(), undefined); assert.equal(button(dom.root, '打赏收款码'), undefined, '用户中心不再放管理按钮');
    closeAllModals(); role = 'admin'; setLang('en'); await openAccount();
    assert.match(consoleLink().textContent, /Admin console/);
    assert.ok(adminSections().flatMap(([, items]) => items).some(([id, title]) => id === 'support' && title === 'QR codes'));
  } finally { await settle(); closeAllModals(); dom.restore(); setLang(saved.lang); globalThis.fetch = saved.fetch; }
});
