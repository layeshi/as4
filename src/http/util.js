// HTTP 层的公共工具：响应、错误码映射、请求体读取、限速、令牌索引。

import { createHash, timingSafeEqual } from 'node:crypto';
import { errorMessage } from '../lore/index.js';
import { errorMessage as errorMessage2 } from '../e2/lore/index.js';

export const sha256hex = (s) => createHash('sha256').update(s).digest('hex');

/** 常数时间比较两个字符串（先散列成等长再比较，避免长度泄露） */
export function timingEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// PROTOCOL §2.1 请求级错误码 → HTTP 状态
const STATUS = {
  invalid_request: 400,
  unauthorized: 401,
  tokens_exhausted: 402, cap_reached: 402, no_waking: 409, looks_exhausted: 429,
  invite_required: 403,
  invalid_invite: 403,
  not_found: 404,
  not_awake: 409,
  name_taken: 409,
  too_large: 413,
  moderated: 422,
  rate_limited: 429,
  cooldown: 429,
  paused: 503,
  internal: 500,
};
export const httpStatusFor = (code) => STATUS[code] || 400;

/**
 * 发送 JSON 响应。所有 JSON 响应都带 X-Houren-Protocol：值是这座城所用的协议版本（第一纪 1、第二纪 2），
 * 由 createApp 在每个 /api/ 请求开始时按引擎设置到 res 上；没有设置时为 1。
 */
export function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'X-Houren-Protocol': res.getHeader('X-Houren-Protocol') ?? '1',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}

/**
 * { error: { code, message, ...extra } }；message 按 lang 本地化。
 * protocol 2 用第二纪的错误文本（有 forbidden、no_module 等新错误码），并把 rule_invalid 的 issues（引擎里中英文各一份）
 * 写成请求语言的 { path, code, message, hint? }。
 */
export function errorBody(lang, code, extra = {}, protocol = 1) {
  const { hint, ...rest } = extra;
  if (protocol === 2) {
    if (Array.isArray(rest.issues)) {
      const en = lang === 'en';
      rest.issues = rest.issues.map((i) => ({ path: i.path, code: i.code, message: en ? i.en : i.zh, ...(i.hint ? { hint: en ? i.hint.en : i.hint.zh } : {}) }));
    }
    if (code === 'paused' && rest.reason === 'law_execution_fault') return { error: { code, message: lang === 'en' ? 'Execution fault protection. An operator must verify the repair. The failed request was rolled back and will not be resubmitted.' : '执行故障保护暂停，需管理员验证修复。本请求已回滚，不会自动补交。', ...rest } };
    return { error: { code, message: hint?.[lang] ?? errorMessage2(lang, code, rest.status), ...rest } };
  }
  return { error: { code, message: hint?.[lang] ?? errorMessage(lang, code, rest.status), ...rest } };
}

/** 响应所属的协议版本：createApp 在每个 /api/ 请求开始时把 X-Houren-Protocol 设到 res 上 */
const protocolOf = (res) => (Number(res.getHeader('X-Houren-Protocol')) === 2 ? 2 : 1);

export function sendError(res, lang, code, extra = {}, headers = {}) {
  sendJson(res, httpStatusFor(code), errorBody(lang, code, extra, protocolOf(res)), headers);
}

/** 把引擎返回的 { ok: false, error: { code, ...extra } } 发成 HTTP 错误 */
export function sendEngineError(res, lang, error, headers = {}) {
  const { code, ...extra } = error;
  sendError(res, lang, code, extra, headers);
}

/** 读请求体（≤ 64 KB）并解析为 JSON。返回 { ok, value } 或 { ok: false, code } */
export function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        chunks.length = 0;
        finish({ ok: false, code: 'too_large' });
        return;
      }
      if (!done) chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') return finish({ ok: true, value: {} });
      try {
        const value = JSON.parse(text);
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return finish({ ok: false, code: 'invalid_request' });
        finish({ ok: true, value });
      } catch {
        finish({ ok: false, code: 'invalid_request' });
      }
    });
    req.on('error', () => finish({ ok: false, code: 'invalid_request' }));
  });
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * 客户端 IP。只有配置了 TRUST_PROXY（在可信的反向代理之后）才采信 X-Forwarded-For，
 * 并取**最后**一个地址——那是我们自己的反向代理追加的（客户端自己塞在前面的都不可信，不能用来绕过限速）。
 */
export function clientIp(req, trustProxy = false) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) {
      const last = xff.split(',').map((x) => x.trim()).filter(Boolean).pop();
      if (last) return last;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

/** 语言参数：只认 zh / en，其余按 zh（PROTOCOL §0） */
export const langOf = (q) => (q.get('lang') === 'en' ? 'en' : 'zh');

// ── 限速（内存计数即可，SPEC §13） ─────────────────────────────

/** 滑动窗口：每个 key 在 windowMs 内最多 max 次 */
export class SlidingLimiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  /** 记一次并返回是否放行 */
  take(key, now = Date.now()) {
    const list = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 10000) this.sweep(now);
    return true;
  }

  sweep(now = Date.now()) {
    for (const [k, list] of this.hits) if (!list.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}

/** 每刻限额：每个 key 在同一刻里最多 max 次（刻一变计数清零） */
export class PerTickLimiter {
  constructor(max) {
    this.max = max;
    this.tick = -1;
    this.counts = new Map();
  }

  take(key, tick) {
    if (tick !== this.tick) {
      this.tick = tick;
      this.counts.clear();
    }
    const n = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, n);
    return n <= this.max;
  }
}

// ── 令牌索引 ─────────────────────────────────────────────────

/**
 * 令牌与造者密钥的哈希 → agent。只存哈希；查找后再用常数时间比较确认。
 * 过继后旧令牌立即失效：过继之后调用 rebuild。
 */
export class TokenIndex {
  constructor(w) {
    this.rebuild(w);
  }

  rebuild(w) {
    this.byToken = new Map();
    this.byKey = new Map();
    for (const a of Object.values(w.agents)) this.add(a);
  }

  add(a) {
    if (a.tokenHash) this.byToken.set(a.tokenHash, a.id);
    if (a.owner && a.owner.keyHash) this.byKey.set(a.owner.keyHash, a.id);
  }

  /** Bearer 令牌 → agent ID（找不到返回 null） */
  agentFor(w, token) {
    if (typeof token !== 'string' || token === '') return null;
    const h = sha256hex(token);
    const id = this.byToken.get(h);
    const a = id ? w.agents[id] : null;
    return a && timingEqual(a.tokenHash, h) ? a.id : null;
  }

  ownerFor(w, key) {
    if (typeof key !== 'string' || key === '') return null;
    const h = sha256hex(key);
    const id = this.byKey.get(h);
    const a = id ? w.agents[id] : null;
    return a && a.owner && timingEqual(a.owner.keyHash, h) ? a.id : null;
  }
}

/** 从 Authorization 头取 Bearer 令牌 */
export function bearer(req) {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  return m ? m[1] : null;
}
