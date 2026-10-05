// Pin the resolved address for each request; never follow redirects with credentials.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

const blocked = new BlockList();
for (const [ip, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['192.0.2.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) blocked.addSubnet(ip, prefix);
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
blocked.addSubnet('2001::', 32, 'ipv6');
export function publicAddress(address) {
  return isIP(address) === 4 ? !blocked.check(address, 'ipv4') : isIP(address) === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export function modelURL(raw, requestURL = false) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('模型接口地址必须是完整的 HTTP(S) 地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (!requestURL && url.search) || url.hash) throw new Error('模型接口地址不能包含凭据、查询参数或片段。');
  return url;
}

export async function checkEndpoint(raw, allowLocal = false, requestURL = false) {
  const url = modelURL(raw, requestURL);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || (!allowLocal && addresses.some((a) => !publicAddress(a.address)))) throw new Error('模型接口不能访问内网或本机地址；本地模型需管理员启用 ALLOW_LOCAL_MODELS=1。');
  if (!allowLocal && url.protocol !== 'https:') throw new Error('外部模型接口必须使用 HTTPS。');
  return { url, address: addresses[0] };
}

/** timeoutMs：这一路线的超时（缺省 120000）；超时的错误带 name = 'TimeoutError'，提供者据此写「timeout（N 秒）」（SPEC-P2 §9.4） */
export function modelFetch(allowLocal = false, { timeoutMs } = {}) {
  return async (input, init = {}) => {
    const incoming = input instanceof Request ? input : null;
    const raw = incoming ? incoming.url : String(input);
    const { url, address } = await checkEndpoint(raw, allowLocal, true);
    const headers = Object.fromEntries(new Headers(init.headers || incoming?.headers).entries());
    headers['accept-encoding'] = 'identity';
    const body = init.body ?? (incoming ? Buffer.from(await incoming.arrayBuffer()) : undefined);
    const signal = init.signal || incoming?.signal;
    return new Promise((resolve, reject) => {
      const req = (url.protocol === 'https:' ? https : http).request(url, {
        method: init.method || incoming?.method || 'GET', headers, signal,
        lookup: (_host, opts, cb) => opts.all ? cb(null, [address]) : cb(null, address.address, address.family),
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); reject(new Error('模型接口重定向被拒绝。')); return; }
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) { req.destroy(new Error('模型响应过大。')); return; }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const responseHeaders = new Headers();
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) responseHeaders.set(k, Array.isArray(v) ? v.join(', ') : v);
          resolve(new Response([204, 205, 304].includes(res.statusCode) ? null : Buffer.concat(chunks), { status: res.statusCode, headers: responseHeaders }));
        });
      });
      req.setTimeout(timeoutMs ?? 120000, () => req.destroy(Object.assign(new Error('模型请求超时。'), { name: 'TimeoutError' })));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  };
}
