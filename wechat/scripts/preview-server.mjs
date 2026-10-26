// 浏览器预览：在普通浏览器的 Canvas 里运行 minigame/ 的同一份代码，用于改界面时截图核对。
// 线上数据只读：只把 GET 转发到线上接口，其他方法一律拒绝；「本地测试数据」完全不连线上。不替代微信编译和真机验收。
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from '../tools/preview/fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8795);
const api = new URL(process.env.PREVIEW_API || 'https://www.heirscity.site').origin;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.ttf': 'font/ttf', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function file(res, base, relative) {
  const path = resolve(base, '.' + sep + relative);
  if (path !== base && !path.startsWith(base + sep)) return send(res, 404, { error: { message: 'not found' } });
  try { send(res, 200, await readFile(path), types[extname(path)] || 'application/octet-stream'); }
  catch { send(res, 404, { error: { message: 'not found' } }); }
}
// approved：把小游戏的审核投影换成网站的公开接口，模拟「文字已审核通过」时的样子；anon：原样转发审核投影。
async function proxy(req, res, mode, path, search) {
  if (req.method !== 'GET') return send(res, 403, { error: { code: 'preview_read_only', message: '预览只读，不会向线上提交任何操作' } });
  if (/^\/api\/wechat\/residents/.test(path)) return send(res, 401, { error: { code: 'unauthorized', message: '预览里没有登录状态' } });
  const target = mode === 'approved' ? path.replace(/^\/api\/wechat\/public\//, '/api/public/') : path;
  try {
    const upstream = await fetch(api + target + search, { headers: { 'X-Houren-Request': '1', 'X-Houren-Client': 'wechat' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    send(res, upstream.status, Buffer.from(await upstream.arrayBuffer()), upstream.headers.get('content-type') || 'application/json');
  } catch { send(res, 502, { error: { code: 'upstream', message: '连接线上接口失败' } }); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://preview.local');
  const local = /^\/proxy\/(fixture|fixture-guest)(\/api\/.*)$/.exec(url.pathname);
  if (local) { const [status, body] = fixture(req.method, local[2] + url.search, { guest: local[1] === 'fixture-guest' }); return send(res, status, body); }
  const m = /^\/proxy\/(anon|approved)(\/api\/.*)$/.exec(url.pathname);
  if (m) return proxy(req, res, m[1], m[2], url.search);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: { message: 'method not allowed' } });
  if (url.pathname === '/') return file(res, join(root, 'tools', 'preview'), 'index.html');
  if (url.pathname.startsWith('/tools/preview/')) return file(res, join(root, 'tools', 'preview'), url.pathname.slice('/tools/preview/'.length));
  if (url.pathname.startsWith('/minigame/')) return file(res, join(root, 'minigame'), url.pathname.slice('/minigame/'.length));
  if (url.pathname === '/miniprogram-app/config.js') return file(res, join(root, 'miniprogram-app'), 'config.js');
  send(res, 404, { error: { message: 'not found' } });
}).listen(port, '127.0.0.1', () => console.log(`小游戏预览：http://127.0.0.1:${port}/  （线上数据来自 ${api}，只读；本地测试数据不联网）`));
