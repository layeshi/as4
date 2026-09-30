// 运行器与 MCP 共用的 HTTP 客户端：GET /api/me、POST /api/me/act。
// 令牌只放在 Authorization 头里，不进日志、不进错误信息。

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * createClient({ server, token, fetch?, timeoutMs? })
 * 每个调用返回 { ok, status, json, error? }：网络错误时 status = 0、error 为一句话（不含令牌）。
 */
export function createClient({ server, token, fetch: fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, signal }) {
  const base = String(server).replace(/\/+$/, '');

  async function call(path, { method = 'GET', body } = {}) {
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetchImpl(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { ok: res.ok, status: res.status, json };
    } catch (e) {
      const why = e && e.name === 'TimeoutError' ? 'timeout' : (e && e.cause && e.cause.code) || (e && e.message) || 'network error';
      return { ok: false, status: 0, json: null, error: String(why) };
    }
  }

  return {
    base,
    /** 感知。after 缺省时由服务器推进收件箱游标；显式给出时不推进（「至少一次」语义） */
    me({ lang = 'zh', after } = {}) {
      const q = new URLSearchParams({ lang });
      if (after !== undefined && after !== null) q.set('after', String(after));
      return call(`/api/me?${q}`);
    },
    act({ thought, actions }) {
      const body = { actions };
      if (thought) body.thought = thought;
      return call('/api/me/act', { method: 'POST', body });
    },
  };
}

/** 错误响应里的一句话 */
export function errorMessage(r) {
  const e = r && r.json && r.json.error;
  if (e && typeof e === 'object') return `${e.code || 'error'}${e.message ? `: ${e.message}` : ''}`;
  return r && r.error ? r.error : `HTTP ${r && r.status}`;
}
