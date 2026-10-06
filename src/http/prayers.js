// Human identity remains private; world commands receive only server-derived authority.
import { fail } from '../accounts/store.js';
import { prayerView, prayersEnabled } from '../e2/engine/prayers.js';
import { isAlive } from '../e2/world.js';
import { accountWrap } from './accounts.js';
import { errorBody, httpStatusFor, langOf, sendJson } from './util.js';

const own = (bag, id) => bag && Object.prototype.hasOwnProperty.call(bag, id) ? bag[id] : null;
function refId(id, prefix) {
  if (typeof id !== 'string' || !new RegExp(`^${prefix}[1-9]\\d{0,14}$`).test(id)) fail(400, 'invalid_request', '记录编号无效。');
  return id;
}
function residentFilter(url) {
  const id = url.searchParams.get('agentId');
  return id === null ? undefined : refId(id, 'a');
}
function enabled(w) {
  if (!prayersEnabled(w)) fail(403, 'feature_unavailable', '此世界尚未开放祈愿。');
}
function linksFor(ctx, actor, a) {
  const links = ctx.accounts.linksOf(actor.id, ctx.rt.w.id).filter((l) => l.agentId === a?.id);
  return { linked: !!a?.owner && links.some((l) => l.token === a.tokenHash), stale: links.length > 0 };
}
function canReview(ctx, actor, invention) {
  const a = own(ctx.rt.w.agents, invention.agentId);
  return actor.role === 'admin' && !!a && isAlive(a) && invention.status === 'pending' && !invention.awarded && !linksFor(ctx, actor, a).linked;
}
function workView(ctx, ref) {
  const w = ctx.rt.w;
  if (ref.kind === 'doc') {
    const doc = own(w.docs, ref.id) && ctx.rt.engine.publicDoc(w, ref.id);
    return doc ? { ...doc, kind: 'doc', docKind: doc.kind } : null;
  }
  const j = own(w.projects, ref.id);
  if (ref.kind !== 'project' || !j) return null;
  // A completed project is absent from publicState's open-project list. Expose
  // its review evidence explicitly instead of serializing a raw world object.
  return {
    kind: 'project', id: j.id, build: j.build, name: j.name ?? null,
    description: j.description ?? null, place: j.place, status: j.status,
    need: j.need, have: j.have, contributors: { ...j.contributors },
    initiator: j.initiator, result: j.result ?? null,
    lot: j.lot ?? null, on: j.on ?? null, module: j.module ?? null,
    to: j.to ?? null, createdDay: j.createdDay, expiresDay: j.expiresDay,
  };
}
function publicView(ctx, agentId) {
  const w = ctx.rt.w, view = prayerView(w, agentId);
  if (!view.enabled) return view;
  const identity = (id) => {
    const a = own(w.agents, id);
    return { name: a?.name ?? null, residentStatus: a?.status ?? null };
  };
  return {
    ...view,
    accounts: view.accounts.map((row) => {
      const { name, residentStatus } = identity(row.agentId);
      return { ...row, name, status: residentStatus };
    }),
    prayers: view.prayers.map((row) => ({ ...row, ...identity(row.agentId) })),
    inventions: view.inventions.map((row) => ({ ...row, ...identity(row.agentId), work: workView(ctx, row.ref) })),
  };
}
function commandResult(res, url, result) {
  if (result.ok) return sendJson(res, 200, result);
  const { code, ...extra } = result.error;
  const status = { insufficient_points: 409, already: 409, unauthorized: 403, not_allowed: 403 }[code] || httpStatusFor(code);
  const hints = {
    insufficient_points: { zh: '祈愿点不足。', en: 'Insufficient prayer points.' },
    already: { zh: '这条记录已处理或关闭。', en: 'This record has already been handled or closed.' },
  };
  sendJson(res, status, errorBody(langOf(url.searchParams), code, { ...extra, ...(hints[code] ? { hint: hints[code] } : {}) }, 2));
}

export const prayerRoutes = [
  ['GET', '/api/public/prayers', accountWrap(({ res, ctx, url }) => {
    sendJson(res, 200, publicView(ctx, residentFilter(url)));
  })],
  ['POST', /^\/api\/account\/prayers\/([^/]+)\/reply$/, accountWrap(({ res, ctx, url, params, body, actor, authorize }) => {
    const prayerId = refId(params[0], 'pr');
    // No await between this fresh check, the linked-token check and rt.exec.
    authorize();
    const w = ctx.rt.w; enabled(w);
    const prayer = own(w.prayers.prayers, prayerId);
    if (!prayer) fail(404, 'not_found', '祈祷记录不存在。');
    const a = own(w.agents, prayer.agentId), link = linksFor(ctx, actor, a);
    if (!link.linked) fail(403, link.stale ? 'stale_link' : 'forbidden', '请使用当前有效关联此居民的账号。');
    const { result } = ctx.rt.exec('prayer_reply', {
      prayerId, actorId: actor.id, ownerTokenHash: a.tokenHash,
      text: body.text, energy: body.energy,
    });
    commandResult(res, url, result);
  }, { signedIn: true })],
  ['GET', '/api/account/prayers/audit', accountWrap(({ res, ctx, url, actor }) => {
    const scope = url.searchParams.get('scope') ?? 'own';
    if (!['own', 'all'].includes(scope)) fail(400, 'invalid_request', '查询范围无效。');
    if (scope === 'all' && actor.role !== 'admin') fail(403, 'forbidden', '此查询需要管理员权限。');
    const agentId = residentFilter(url), w = ctx.rt.w;
    const audit = prayersEnabled(w) ? w.prayers.audit.filter((row) => (scope === 'all' || row.actorId === actor.id) && (agentId === undefined || row.agentId === agentId)) : [];
    sendJson(res, 200, { enabled: prayersEnabled(w), audit });
  }, { signedIn: true })],
  ['GET', '/api/admin/inventions', accountWrap(({ res, ctx, url, actor }) => {
    const view = publicView(ctx, residentFilter(url));
    sendJson(res, 200, { enabled: view.enabled, inventions: (view.inventions || []).map((row) => ({ ...row, canReview: canReview(ctx, actor, row) })) });
  }, { admin: true })],
  ['POST', /^\/api\/admin\/inventions\/([^/]+)\/review$/, accountWrap(({ res, ctx, url, params, body, actor, authorize }) => {
    const inventionId = refId(params[0], 'iv');
    authorize();
    const w = ctx.rt.w; enabled(w);
    const invention = own(w.prayers.inventions, inventionId);
    if (!invention) fail(404, 'not_found', '发明记录不存在。');
    if (linksFor(ctx, actor, own(w.agents, invention.agentId)).linked) fail(403, 'self_review', '管理员不能审核自己关联居民的发明。');
    const { result } = ctx.rt.exec('invention_review', {
      inventionId, actorId: actor.id, decision: body.decision, reason: body.reason,
    });
    commandResult(res, url, result);
  }, { admin: true })],
];
