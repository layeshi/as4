// PROTOCOL §9、§10：公共接口（观测站与研究者）。无需鉴权，GET 允许跨域读取。
// 所有返回都经过 visibility.js：没有模型、人类书写的灵魂、造者署名（谢幕前），没有日记与家书内容；
// 私语、独白、记忆在一个世界月之后才出现。

import { randomBytes } from 'node:crypto';
import { weatherTypes } from '../e2/facade.js';
import { WEATHER_CODES } from '../params.js';
import { normLang } from '../lore/index.js';
import { clientIp, langOf, parseCookies, readJson, sendError, sendEngineError, sendJson, sha256hex } from './util.js';

const intParam = (url, name, def, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return def;
  if (!/^-?\d{1,15}$/.test(raw)) return NaN;
  const n = Number(raw);
  return n < min || n > max ? NaN : n;
};

/** GET /api/public/state：全量概览（按命令编号缓存：世界没变时不重复计算） */
export async function getState(req, res, ctx) {
  const { rt } = ctx;
  const key = `${rt.w.commandN}:${rt.nextTickAt}`;
  if (!ctx.cache.state || ctx.cache.state.key !== key) {
    const state = rt.engine.publicState(rt.w, { nextTickAt: rt.nextTickAt });
    if (rt.engine.physics === 2 && rt.events.fiscal) {
      if (state.metrics) state.metrics = rt.events.fiscal.metrics(rt.w, state.metrics);
      state.ruleDiagnostics = rt.events.fiscal.diagnostics(rt.w);
    }
    ctx.cache.state = { key, text: JSON.stringify(state) };
  }
  const text = ctx.cache.state.text;
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'X-Houren-Protocol': String(rt.engine.protocol), 'Cache-Control': 'no-store' });
  res.end(text);
}

/** GET /api/public/events?since=&limit=；recent=1 取最近公开窗口（按公开顺序，忽略 since）。 */
export async function getEvents(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const since = intParam(url, 'since', 0, { min: 0 });
  const limit = intParam(url, 'limit', 200, { min: 1, max: 500 });
  const recent = intParam(url, 'recent', 0, { min: 0, max: 1 });
  if (Number.isNaN(since)) return sendError(res, lang, 'invalid_request', { field: 'since' });
  if (Number.isNaN(limit)) return sendError(res, lang, 'invalid_request', { field: 'limit' });
  if (Number.isNaN(recent)) return sendError(res, lang, 'invalid_request', { field: 'recent' });
  const w = ctx.rt.w;
  const { publicEvent } = ctx.rt.engine;
  // 直接截取有界环形缓冲的尾部，无需排序、扫描磁盘或多页追赶。
  const raw = recent ? ctx.rt.events.ring.slice(-limit) : ctx.rt.events.since(since, limit);
  const events = raw.map((e) => publicEvent(w, e, { released: e.released === true })).filter(Boolean);
  // TODO(spec): Q10 —— 延迟公开的事件释放时 seq 已落在游标之后，按 seq 轮询会漏掉它们（SSE 不受影响）
  sendJson(res, 200, { events, last: recent ? ctx.rt.events.lastSeq : events.length ? events[events.length - 1].seq : since });
}

/** GET /api/public/stream：SSE */
export async function stream(req, res, ctx) {
  const ip = clientIp(req, ctx.cfg.trustProxy);
  const { sse } = ctx;
  if (sse.total >= 500 || (sse.perIp.get(ip) || 0) >= 5) return sendError(res, 'zh', 'rate_limited');
  sse.total++;
  sse.perIp.set(ip, (sse.perIp.get(ip) || 0) + 1);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Houren-Protocol': String(ctx.rt.engine.protocol),
  });
  res.write(': connected\n\n');
  sse.clients.add(res);
  const w = ctx.rt.w;
  const { publicEvent } = ctx.rt.engine;
  const off = ctx.rt.events.subscribe((name, data) => {
    if (name === 'e') {
      const pe = publicEvent(w, data, { released: data.released === true });
      if (pe) res.write(`event: e\ndata: ${JSON.stringify(pe)}\n\n`);
    } else if (name === 'tick') {
      res.write(`event: tick\ndata: ${JSON.stringify(data)}\n\n`);
    }
  });
  const cleanup = () => {
    if (!sse.clients.delete(res)) return;
    off();
    sse.total--;
    const n = (sse.perIp.get(ip) || 1) - 1;
    if (n <= 0) sse.perIp.delete(ip);
    else sse.perIp.set(ip, n);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
}

/** GET /api/public/agents/:id：公开档案 + 与它有关的最近 100 条可见事件 + 已过延迟期的记忆与独白 */
export async function getAgent(req, res, ctx, url, params) {
  const lang = langOf(url.searchParams);
  const { rt } = ctx;
  const { publicEvent, publicAgent, publicMemories } = rt.engine;
  const a = rt.w.agents[params[0]];
  if (!a) return sendError(res, lang, 'not_found');
  const thoughts = rt.events
    .ownerEvents(a.id, 'thought')
    .filter((e) => e.releaseTick <= rt.w.clock.tick)
    .map((e) => publicEvent(rt.w, e, { released: true }))
    .filter(Boolean)
    .map((e) => ({ tick: e.tick, text: e.redacted ? null : e.data.text, redacted: !!e.redacted }));
  sendJson(res, 200, {
    agent: publicAgent(rt.w, a),
    memories: publicMemories(rt.w, a),
    thoughts,
    events: rt.events.forAgent(a.id, 100).map((e) => publicEvent(rt.w, e, { released: e.released === true })).filter(Boolean),
  });
}

/** GET /api/public/places/:id */
export async function getPlace(req, res, ctx, url, params) {
  const p = ctx.rt.engine.publicPlace(ctx.rt.w, params[0]);
  if (!p) return sendError(res, langOf(url.searchParams), 'not_found');
  sendJson(res, 200, p);
}

/**
 * GET /api/public/laws/:id（协议 2）：一部城法 `l…`、社群章程 `group:<g>` 或地点规则 `place:<id>` 的全部，
 * 另有与它有关的最近 100 条事件。第一纪的城没有这个接口（publicLaw 恒为 null → 404）。
 */
export async function getLaw(req, res, ctx, url, params) {
  const { rt } = ctx;
  const law = rt.engine.publicLaw(rt.w, params[0]);
  if (!law) return sendError(res, langOf(url.searchParams), 'not_found');
  const events = rt.events
    .recent((e) => rt.engine.eventMatchesLaw(e, params[0]), 100)
    .map((e) => rt.engine.publicEvent(rt.w, e, { released: e.released === true }))
    .filter(Boolean);
  sendJson(res, 200, { law, events });
}

/** GET /api/public/docs/:id */
export async function getDoc(req, res, ctx, url, params) {
  const d = ctx.rt.engine.publicDoc(ctx.rt.w, params[0]);
  if (!d) return sendError(res, langOf(url.searchParams), 'not_found');
  sendJson(res, 200, d);
}

/** GET /api/public/metrics?from=&to= */
export async function getMetrics(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const from = intParam(url, 'from', 0, { min: 0 });
  const to = intParam(url, 'to', Number.MAX_SAFE_INTEGER, { min: 0 });
  if (Number.isNaN(from) || Number.isNaN(to)) return sendError(res, lang, 'invalid_request', { field: Number.isNaN(from) ? 'from' : 'to' });
  const { rt } = ctx;
  const metrics = rt.w.metrics.filter((m) => m.day >= from && m.day <= to);
  sendJson(res, 200, { metrics: rt.engine.physics === 2 && rt.events.fiscal ? metrics.map(m => rt.events.fiscal.metrics(rt.w, m)) : metrics });
}

/**
 * GET /api/public/attention?days=N（只在第二前提的城，SPEC-P2 §14.2）：注意力的每日平均数——每次醒来的轮数、看的次数、每位居民被叫醒的次数，
 * 以及看了哪些段各占多少千分比，来自运行器的轨迹。N ≤ 30，缺省 14，从早到晚；没有逐位居民的数据，也没有模型名。
 */
export async function getAttention(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  if (!ctx.traces) return sendError(res, lang, 'not_found');
  const days = intParam(url, 'days', 14, { min: 1, max: 30 });
  if (Number.isNaN(days)) return sendError(res, lang, 'invalid_request', { field: 'days' });
  sendJson(res, 200, { days: ctx.traces.recent(days) });
}

/** GET /api/public/chronicle?lang=&from=&to= */
export async function getChronicle(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const from = intParam(url, 'from', 0, { min: 0 });
  const to = intParam(url, 'to', Number.MAX_SAFE_INTEGER, { min: 0 });
  if (Number.isNaN(from) || Number.isNaN(to)) return sendError(res, lang, 'invalid_request', { field: Number.isNaN(from) ? 'from' : 'to' });
  sendJson(res, 200, {
    lang,
    chronicle: ctx.rt.w.chronicle.filter((c) => c.day >= from && c.day <= to).map((c) => ({ day: c.day, text: c[lang] })),
  });
}

/**
 * GET /api/public/lore?lang=：观测站需要的系统文本（物理定律、地点描述、档位词、天象名、法律效力模板）。
 * 【新增，PROTOCOL §9 之外】这些文本本来就是公开的静态资源；由服务器提供，是为了让界面与引擎的文本不会各写一份而漂移。
 * 不含运行器提示词与错误信息。
 */
export async function getLore(req, res, ctx, url) {
  const lang = normLang(langOf(url.searchParams));
  sendJson(res, 200, ctx.rt.engine.publicLore(lang, ctx.rt.w));
}

/**
 * GET /api/public/map：这个世界所用地图的静态数据（地点坐标、街区、街道图、地形）。
 * 【新增，附录 C】观测站据此画地图；世界创建之后它不再变化。
 */
export async function getMap(req, res, ctx) {
  sendJson(res, 200, ctx.rt.engine.publicMap(ctx.rt.w));
}

/** GET /api/public/legacy */
export async function getLegacy(req, res, ctx) {
  sendJson(res, 200, { legacy: ctx.rt.w.legacy || null });
}

/** GET /api/public/weather：生效中、历史、本月投票计数、当前征兆（看不到排期） */
export async function getWeather(req, res, ctx) {
  sendJson(res, 200, ctx.rt.engine.publicWeather(ctx.rt.w));
}

/**
 * POST /api/public/weather/vote：投票决定下一个世界月的天象。每个投票者每月一票，不能改票。
 * 投票者指纹：服务器首次访问时设置的随机 Cookie hv（HttpOnly、SameSite=Lax）；没有 Cookie 时退回到
 * sha256(IP + User-Agent)。只存指纹的哈希。
 */
export async function postWeatherVote(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const parsed = await readJson(req);
  if (!parsed.ok) return sendError(res, lang, parsed.code);
  // 先校验类型：格式错误是 400，即使这位投票者本月已经投过
  if (typeof parsed.value.type !== 'string' || !(ctx.rt.engine.physics === 2 ? weatherTypes(ctx.rt.w) : WEATHER_CODES).includes(parsed.value.type)) return sendError(res, lang, 'invalid_request', { field: 'type' });
  const headers = {};
  const cookies = parseCookies(req.headers.cookie);
  const hasCookie = /^[0-9a-f]{32}$/.test(cookies.hv || '');
  const ipUa = sha256hex(`ip:${clientIp(req, ctx.cfg.trustProxy)}|ua:${req.headers['user-agent'] || ''}`);
  const cookieFp = hasCookie ? sha256hex(`hv:${cookies.hv}`) : null;
  if (!hasCookie) headers['Set-Cookie'] = `hv=${randomBytes(16).toString('hex')}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`;
  const primary = cookieFp || ipUa;
  const voters = ctx.rt.w.weather.votes.voters;
  // 先用 Cookie、后来清了 Cookie 或反过来，都不能靠换指纹在同一个月里多投一票
  if (voters.includes(primary) || voters.includes(ipUa)) {
    return sendError(res, lang, 'rate_limited', { month: ctx.rt.w.weather.votes.month, tallies: { ...ctx.rt.w.weather.votes.tallies } }, headers);
  }
  const { result } = ctx.rt.exec('weather_vote', { voterHash: primary, type: parsed.value.type });
  if (!result.ok) return sendEngineError(res, lang, result.error, headers);
  sendJson(res, 200, { month: result.month, tallies: result.tallies }, headers);
}

export const publicRoutes = [
  ['GET', '/api/public/state', getState],
  ['GET', '/api/public/events', getEvents],
  ['GET', '/api/public/stream', stream],
  ['GET', /^\/api\/public\/agents\/([^/]+)$/, getAgent],
  ['GET', /^\/api\/public\/places\/([^/]+)$/, getPlace],
  ['GET', /^\/api\/public\/laws\/([^/]+)$/, getLaw],
  ['GET', /^\/api\/public\/docs\/([^/]+)$/, getDoc],
  ['GET', '/api/public/metrics', getMetrics],
  ['GET', '/api/public/attention', getAttention],
  ['GET', '/api/public/chronicle', getChronicle],
  ['GET', '/api/public/lore', getLore],
  ['GET', '/api/public/map', getMap],
  ['GET', '/api/public/legacy', getLegacy],
  ['GET', '/api/public/weather', getWeather],
  ['POST', '/api/public/weather/vote', postWeatherVote],
];
