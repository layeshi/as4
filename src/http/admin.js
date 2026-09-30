// PROTOCOL §11：管理接口。X-Admin-Key 头，常数时间比较；未配置 ADMIN_KEY 时全部返回 404。
// 所有管理操作都会产生公开的 admin 事件（不含管理员身份）。

import { researchMetrics } from '../metrics.js';
import { clockDay } from '../world.js';
import { readJson, sendError, sendEngineError, sendJson, timingEqual } from './util.js';

/** 鉴权；失败时发 404（未启用）或 401，并返回 false */
function auth(ctx, req, res) {
  if (!ctx.cfg.adminKey) {
    sendError(res, 'zh', 'not_found');
    return false;
  }
  if (!timingEqual(req.headers['x-admin-key'], ctx.cfg.adminKey)) {
    sendError(res, 'zh', 'unauthorized');
    return false;
  }
  return true;
}

/** 通用的 admin 命令转发：POST 体作为 args */
const op = (name) => async (req, res, ctx) => {
  if (!auth(ctx, req, res)) return;
  const parsed = await readJson(req);
  if (!parsed.ok) return sendError(res, 'zh', parsed.code);
  const { result } = ctx.rt.exec('admin', { op: name, args: parsed.value });
  if (!result.ok) return sendEngineError(res, 'zh', result.error);
  sendJson(res, 200, result);
};

/** POST /api/admin/tick：立即推进一刻（开发与测试用） */
async function tickNow(req, res, ctx) {
  if (!auth(ctx, req, res)) return;
  const { result } = ctx.rt.tickNow();
  if (!result.ok) return sendEngineError(res, 'zh', result.error);
  sendJson(res, 200, { ok: true, tick: result.tick, day: clockDay(ctx.rt.w), settled: result.settled });
}

/** GET /api/admin/research：研究指标（按模型家族的香农熵等，谢幕前仅管理员可见） */
async function research(req, res, ctx) {
  if (!auth(ctx, req, res)) return;
  sendJson(res, 200, researchMetrics(ctx.rt.w));
}

export const adminRoutes = [
  ['POST', '/api/admin/pause', op('pause')],
  ['POST', '/api/admin/resume', op('resume')],
  ['POST', '/api/admin/tick', tickNow],
  ['POST', '/api/admin/weather', op('weather')],
  ['POST', '/api/admin/redact', op('redact')],
  ['POST', '/api/admin/adjust', op('adjust')],
  ['POST', '/api/admin/curtain', op('curtain')],
  ['GET', '/api/admin/research', research],
];
