// 运行器与 MCP 共用的 HTTP 客户端：GET /api/me、POST /api/me/act。
// 令牌只放在 Authorization 头里，不进日志、不进错误信息。

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * createClient({ server, token, fetch?, timeoutMs? })
 * 每个调用返回 { ok, status, json, error? }：网络错误时 status = 0、error 为一句话（不含令牌）。
 */
export function createClient({ server, token, fetch: fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, signal }) {
  const base = String(server).replace(/\/+$/, '');
  let lastExperimentGeneration;

  async function call(path, { method = 'GET', body, timeoutMs: limit = timeoutMs } = {}) {
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetchImpl(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(limit)]) : AbortSignal.timeout(limit),
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
    state() { return call('/api/public/state'); },
    rules({ lang = 'zh' } = {}) { return call(`/api/me/rules?${new URLSearchParams({ lang })}`); },
    wake(body) { return call('/api/me/wake', { method: 'POST', body }); },
    look(body) { return call('/api/me/look', { method: 'POST', body }); },
    /** 感知。after 缺省时由服务器推进收件箱游标；显式给出时不推进（「至少一次」语义） */
    async me({ lang = 'zh', after } = {}) {
      const q = new URLSearchParams({ lang });
      if (after !== undefined && after !== null) q.set('after', String(after));
      const r = await call(`/api/me?${q}`);
      if (r.ok && r.json?.now) lastExperimentGeneration = r.json.now.experimentGeneration ?? 0;
      return r;
    },
    /**
     * 等待会叫醒的收件（只在第二前提的城，SPEC-P2 §6.4）：GET /api/me/wait。有 seq > after 的就立即返回，否则等到有或到时返回空。
     * 服务器要求 timeoutMs 在 1000–50000 之间，这里夹进去；这一次请求自己的超时是 timeoutMs + 10 秒。
     */
    wait({ after, timeoutMs: ms = 25000, lang } = {}) {
      const t = Math.min(50000, Math.max(1000, Math.floor(ms)));
      const q = new URLSearchParams({ after: String(after ?? 0), timeoutMs: String(t) });
      if (lang) q.set('lang', lang);
      return call(`/api/me/wait?${q}`, { timeoutMs: t + 10000 });
    },
    /** lang 为 en 时动作错误的说明用英文（缺省 zh，请求路径不变）；第二纪里它还进入命令（draft 的说明、read { law } 的读法） */
    act({ thought, actions, lang, wakeId, turn, actionTools, experimentGeneration = lastExperimentGeneration }) {
      const body = { actions };
      if (wakeId !== undefined) body.wakeId = wakeId;
      if (turn !== undefined) body.turn = turn;
      if (actionTools !== undefined) body.actionTools = actionTools;
      if (experimentGeneration !== undefined) body.experimentGeneration = experimentGeneration;
      if (thought) body.thought = thought;
      return call(`/api/me/act${lang === 'en' ? '?lang=en' : ''}`, { method: 'POST', body });
    },
  };
}

/** 错误响应里的一句话 */
export function errorMessage(r) {
  const e = r && r.json && r.json.error;
  if (e && typeof e === 'object') return `${e.code || 'error'}${e.message ? `: ${e.message}` : ''}`;
  return r && r.error ? r.error : `HTTP ${r && r.status}`;
}
