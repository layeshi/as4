import { accountWrap } from './accounts.js';
import { sendJson } from './util.js';
import { fail, AccountError } from '../accounts/store.js';
import { wechatIdentity } from './wechat.js';
import { owns } from '../history/exports.js';

const signed = fn => accountWrap(fn, { signedIn: true });
const admin = fn => accountWrap(fn, { admin: true });
function project(ctx, req, data) {
  if (req.headers['x-houren-client'] !== 'wechat') return data;
  const identity = wechatIdentity(ctx, req); ctx.wechat.requireIdentity(identity);
  const moderation = {}, filter = value => ctx.wechatProjection.filter(value, identity, 'text', moderation);
  if (data.content) data = { ...data, content: { ...data.content, title: filter(data.content.title), overview: filter(data.content.overview), facts: data.content.facts.map(x => ({ ...x, text: filter(x.text) })), analysis: data.content.analysis.map(x => ({ ...x, text: filter(x.text) })) }, sources: filter(data.sources) };
  if (data.reports) data = { ...data, reports: data.reports.map(r => ({ ...r, title: r.title ? filter(r.title) : null })) };
  if (data.exports) data = { ...data, exports: data.exports.map(r => ({ ...r, name: filter(r.name) })) };
  if (data.branches) data = { ...data, branches: data.branches.map(b => ({ ...b, residents: b.residents?.map(r => ({ ...r, name: filter(r.name) })) })) };
  return { ...data, moderation };
}
export const historyRoutes = [
  ['GET', '/api/reports', signed(async ({ req, res, ctx, url, authorize }) => {
    await ctx.history.ready; authorize();
    const q = url.searchParams, kind = q.get('kind') || undefined, page = Number(q.get('page') || 1);
    if (kind && !['day', 'month', 'year'].includes(kind) || !Number.isSafeInteger(page) || page < 1) fail(400, 'invalid_query', '报告筛选条件无效。');
    const requestedBranch = q.get('branchId');
    sendJson(res, 200, project(ctx, req, ctx.reports.list({ kind, branchId: requestedBranch === 'all' ? undefined : requestedBranch || ctx.history.branchId, page })));
  })],
  ['GET', /^\/api\/reports\/([a-f0-9-]+)$/, signed(({ req, res, ctx, params }) => sendJson(res, 200, project(ctx, req, ctx.reports.get(params[0]))))],
  ['GET', '/api/history/branches', signed(async ({ req, res, ctx, actor, authorize }) => {
    await ctx.history.flush(); authorize();
    const branches = ctx.history.branches().map(b => ({ ...b, active: b.id === ctx.history.branchId,
      residents: Object.entries(ctx.history.branch(b.id).residents).filter(([id]) => owns(ctx, ctx.history, actor, b.id, id)).map(([id, r]) => ({ id, name: r.profile.name, status: r.profile.status })),
    }));
    sendJson(res, 200, project(ctx, req, { branches }));
  })],
  ['GET', '/api/history/exports', signed(async ({ req, res, ctx, actor, authorize }) => { await ctx.history.ready; authorize(); sendJson(res, 200, project(ctx, req, { exports: ctx.historyExports.list(actor) })); })],
  ['POST', '/api/history/exports', signed(async ({ res, ctx, actor, body, authorize }) => { const job = await ctx.historyExports.create(actor, body); authorize(); ctx.historyExports.get(actor, job.id); sendJson(res, 202, job); })],
  ['POST', /^\/api\/history\/exports\/([a-f0-9-]+)\/retry$/, signed(({ res, ctx, actor, params }) => {
    ctx.historyExports.get(actor, params[0]); const job = ctx.historyExports.jobs.find(j => j.id === params[0]);
    if (job.status === 'failed') { job.status = 'queued'; delete job.error; ctx.historyExports.save(); ctx.historyExports.kick(); }
    sendJson(res, 202, ctx.historyExports.get(actor, job.id));
  })],
  ['GET', /^\/api\/history\/exports\/([a-f0-9-]+)\/download$/, signed(async ({ req, res, ctx, actor, params, authorize }) => {
    const bytes = await ctx.historyExports.download(actor, params[0]); authorize(); ctx.historyExports.get(actor, params[0]);
    if (req.headers['x-houren-client'] === 'wechat') ctx.wechat.requireIdentity(wechatIdentity(ctx, req));
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="resident-history-${params[0]}.zip"`, 'Content-Length': bytes.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes);
  })],
  ['GET', '/api/admin/reports', admin(({ res, ctx }) => sendJson(res, 200, { ...ctx.reports.view(), ...ctx.reports.list() }))],
  ['POST', '/api/admin/reports/config', admin(({ res, ctx, body }) => {
    try { sendJson(res, 200, ctx.reports.save(body)); } catch (error) { if (error instanceof AccountError) throw error; fail(400, 'invalid_config', '模型配置无效，请核对接口、模型和额度。'); }
  })],
  ['POST', '/api/admin/reports/generate', admin(async ({ res, ctx, body, authorize }) => { const r = await ctx.reports.request(body); authorize(); sendJson(res, 202, r); })],
  ['POST', /^\/api\/admin\/reports\/([a-f0-9-]+)\/retry$/, admin(({ res, ctx, params }) => sendJson(res, 202, ctx.reports.retry(params[0])))],
];
