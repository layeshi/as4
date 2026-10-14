// 与服务器通信：JSON 调用与 SSE。

export const LOGIN_PAGE = '/login.html';

/**
 * 登录门（服务器 REQUIRE_LOGIN）：回到登录页，登录后再回到现在这一页。已经在登录页、没有页面地址（测试、非浏览器）时不动；
 * remember = false：主动退出登录，登录后回首页。
 */
export function leaveForLogin({ remember = true } = {}) {
  if (typeof location === 'undefined' || typeof location.pathname !== 'string' || location.pathname === LOGIN_PAGE) return false;
  const here = `${location.pathname}${location.search || ''}${location.hash || ''}`;
  const target = remember && here !== '/' ? `${LOGIN_PAGE}?next=${encodeURIComponent(here)}` : LOGIN_PAGE;
  if (typeof location.replace === 'function') location.replace(target);
  else location.href = target;
  return true;
}

/** 调用接口，返回 { ok, status, json }；网络错误时 ok = false 且 status = 0 */
export async function api(path, { method = 'GET', body, key } = {}) {
  const headers = {};
  if (method !== 'GET' && method !== 'HEAD') headers['X-Houren-Request'] = '1';
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
    if (res.status === 401 && json && json.error && json.error.code === 'login_required') leaveForLogin(); // 会话过期或已被撤销
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
  es.addEventListener('error', () => {
    if (handlers.error) handlers.error();
    // 被服务器拒绝的连接不会自动重连（readyState 为 CLOSED）：多半是登录失效，读一次账号状态，没有登录就回登录页
    if (es.readyState === 2) api('/api/account').then((r) => { if (r.ok && r.json && r.json.loginRequired && !r.json.user) leaveForLogin(); });
  });
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
