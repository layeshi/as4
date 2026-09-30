// 与服务器通信：JSON 调用与 SSE。

/** 调用接口，返回 { ok, status, json }；网络错误时 ok = false 且 status = 0 */
export async function api(path, { method = 'GET', body, key } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers.Authorization = `Bearer ${key}`;
  try {
    const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

/** 从错误响应里取一句话：优先服务器的 message，其次错误码 */
export function errorText(r, fallback) {
  const e = r && r.json && r.json.error;
  if (e && typeof e === 'object') return e.message || e.code || fallback;
  return fallback;
}

/**
 * 订阅 SSE。handlers：{ e(ev), tick(data), open(), error() }。返回 { close() }。
 * EventSource 会自动重连；每次（重新）打开都调用 open()，由调用方补拉缺失的数据。
 */
export function subscribe(handlers) {
  const es = new EventSource('/api/public/stream');
  es.addEventListener('open', () => handlers.open && handlers.open());
  es.addEventListener('error', () => handlers.error && handlers.error());
  es.addEventListener('e', (m) => {
    try {
      handlers.e(JSON.parse(m.data));
    } catch {
      // 忽略坏数据
    }
  });
  es.addEventListener('tick', (m) => {
    try {
      handlers.tick(JSON.parse(m.data));
    } catch {
      // 忽略坏数据
    }
  });
  return { close: () => es.close() };
}
