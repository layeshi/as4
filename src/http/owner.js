// PROTOCOL §8：造者后台——完整感知、收件箱、日记、独白、家书、交付过继。

import { bearer, langOf, readJson, sendError, sendEngineError, sendJson } from './util.js';

function authOwner(ctx, req, res, lang) {
  const id = ctx.tokens.ownerFor(ctx.rt.w, bearer(req));
  if (!id) {
    sendError(res, lang, 'unauthorized');
    return null;
  }
  return id;
}

/** GET /api/owner */
export async function getOwner(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const id = authOwner(ctx, req, res, lang);
  if (!id) return;
  const { rt } = ctx;
  const { engine } = rt;
  const a = rt.w.agents[id];
  const own = (type) => rt.events.ownerEvents(id, type);
  sendJson(res, 200, {
    agents: [{
      agentId: a.id, name: a.name, status: a.status,
      model: a.body.model, soul: a.soul,
      perception: engine.buildPerception(rt.w, id, { lang, ack: false, floor: ctx.cursors.get(id) || 0, nextTickAt: rt.nextTickAt }), // 与 GET /api/me 相同，但不推进收件箱游标
      inbox: engine.inboxView(a, lang),
      diary: a.diary.map((d) => ({ tick: d.tick, text: d.text })),
      thoughts: own('thought').map((e) => ({ tick: e.tick, text: e.data.text })),
      dreams: own('dream').map((e) => ({ tick: e.tick, fragments: e.data.fragments })),
      letters: a.letters.map((l) => ({ id: l.id, tick: l.tick, text: l.text, revealed: l.revealed })),
      nextLetterDay: a.lastLetterDay === null ? null : a.lastLetterDay + engine.P.letterCooldownDays,
      today: engine.clockDay(rt.w),
      fosterable: a.fosterable,
      runner: ctx.runners.view(id),
      usage: ctx.runners.usageView(id),
    }],
  });
}

/** POST /api/owner/letter */
export async function postLetter(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const id = authOwner(ctx, req, res, lang);
  if (!id) return;
  const parsed = await readJson(req);
  if (!parsed.ok) return sendError(res, lang, parsed.code);
  const body = parsed.value;
  if (typeof body.text !== 'string') return sendError(res, lang, 'invalid_request', { field: 'text' });
  if (body.agentId !== undefined && body.agentId !== id) return sendError(res, lang, 'not_found');
  const w = ctx.rt.w;
  if (w.paused) return sendError(res, lang, 'paused');
  const { result } = ctx.rt.exec('letter', { agentId: id, text: body.text });
  if (!result.ok) return sendEngineError(res, lang, result.error);
  sendJson(res, 200, { letterId: result.letterId, nextLetterDay: result.nextLetterDay });
}

/** POST /api/owner/release */
export async function postRelease(req, res, ctx, url) {
  const lang = langOf(url.searchParams);
  const id = authOwner(ctx, req, res, lang);
  if (!id) return;
  const parsed = await readJson(req);
  if (!parsed.ok) return sendError(res, lang, parsed.code);
  const body = parsed.value;
  if (typeof body.release !== 'boolean') return sendError(res, lang, 'invalid_request', { field: 'release' });
  if (body.agentId !== undefined && body.agentId !== id) return sendError(res, lang, 'not_found');
  const { result } = ctx.rt.exec('release', { agentId: id, release: body.release });
  if (!result.ok) return sendEngineError(res, lang, result.error);
  sendJson(res, 200, { ok: true, fosterable: result.fosterable });
}

export const ownerRoutes = [
  ['GET', '/api/owner', getOwner],
  ['POST', '/api/owner/letter', postLetter],
  ['POST', '/api/owner/release', postRelease],
];
