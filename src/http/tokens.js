// Fourth-premise transport. Render first, commit only integer weights, then release text.
import { randomBytes } from 'node:crypto';
import { P } from '../e2/params.js';
import { clockDay, tokenized } from '../e2/world.js';
import { ep, K, tokenView, rereadCost } from '../e2/engine/tokens.js';
import { textWeight, cpLength } from '../text.js';
import { earthDay } from '../shells/budget.js';
import { normLang, cityDisplayName } from '../e2/lore/index.js';
import { buildSystemPrompt, promptParams } from '../../runner/prompt.js';
import { renderBrief, renderWake, renderLook, clipLook, renderArrived, renderArrival } from '../../runner/render-p2.js';
import { makeCtx, secInbox } from '../../runner/render2.js';
import { DEFAULT_AGENT_LOOP } from '../../runner/loop.js';
import { actionFeedback } from '../action-feedback.js';
import { errorBody, httpStatusFor } from './util.js';

export const earthDayKey = ctx => earthDay(Date.now(), (ctx.cfg || ctx.rt.cfg).shellTz || 'Asia/Shanghai').key;
export const usedToday = (a, day) => a.tokens.day === day ? a.tokens.used : 0;
const limits = ctx => ctx.rt.agentLoop || DEFAULT_AGENT_LOOP;
const failure = (lang, code, extra = {}) => ({ status: httpStatusFor(code), json: errorBody(lang, code, extra, 2) });
const failed = (lang, result) => { const { code, ...extra } = result.error; return failure(lang, code, extra); };
const maxSeq = (items, base) => items.reduce((n, i) => Math.max(n, i.seq), base);
const object = v => v && typeof v === 'object' && !Array.isArray(v);
export const tokenValues = w => ({ k: K(w), capacity: w.tokens.capacity, basicAllotment: w.tokens.basic,
  reviveThreshold: ep(w, 'reviveThreshold'), ruleUpkeep: ep(w, 'ruleUpkeep'), standingUpkeep: ep(w, 'standingUpkeep'), floor: ep(w, 'lawFloor') });

function sessionFor(ctx, id, wakeId) {
  const s = ctx.wakings?.get(id);
  return s && s.tick === ctx.rt.w.clock.tick && (wakeId === undefined || wakeId === s.wakeId) ? s : null;
}
export function tokenStatus(ctx, id, { lang = 'zh' } = {}) {
  const { rt } = ctx, w = rt.w, a = w.agents[id], s = sessionFor(ctx, id);
  const day = clockDay(w), v = tokenView(a);
  return {
    protocol: 2, premise: 4, lang: normLang(lang),
    now: { tick: w.clock.tick, day, ticksPerDay: P.ticksPerDay, daysPerMonth: P.daysPerMonth, tickOfDay: w.clock.tick % P.ticksPerDay,
      nextTickAt: rt.nextTickAt, tickMs: P.tickMs, paused: w.paused, ...(w.experimentControl ? { experimentGeneration: w.experimentControl.generation } : {}) },
    you: { id: a.id, name: a.name, status: a.status, place: a.place, actionsLeft: Math.max(0, P.maxActionsPerTick - a.actsThisTick), maxActionsPerTick: P.maxActionsPerTick,
      energy: v.energy, basic: v.basic, cap: v.cap, usedToday: usedToday(a, earthDayKey(ctx)), routine: v.routine, lastBill: v.lastBill,
      ...(a.status === 'dormant' ? { dormantSinceDay: a.dormantSinceDay, daysUntilDeath: a.dormantSinceDay + P.dormancyGraceDays - day } : {}) },
    waking: s ? { wakeId: s.wakeId, tick: s.tick, kind: s.kind } : null,
    ...(a.status === 'awake' ? { attention: { ...limits(ctx) } } : {}),
  };
}
function perception(ctx, id, lang) {
  const { rt } = ctx, a = rt.w.agents[id];
  const p = rt.engine.buildPerception(rt.w, id, { lang, after: a.delivered, ack: false, nextTickAt: rt.nextTickAt });
  const unread = (p.inbox || []).slice().sort((a, b) => a.seq - b.seq);
  p.inbox = unread.slice(0, P.tokenBriefInbox);
  p.inboxMore = Math.max(0, unread.length - p.inbox.length);
  if (p.you.tokens) p.you.tokens.usedToday = usedToday(a, earthDayKey(ctx));
  p.attention = { ...limits(ctx) };
  return p;
}
function prompt(ctx, id, p, lang, toolMode = 'native', actionTools = 'legacy') {
  const w = ctx.rt.w;
  return buildSystemPrompt({ ...promptParams(p), premise: 4, lang, cityName: cityDisplayName(w.cityName, lang),
    toolMode, actionTools, prayers: false, tokenValues: tokenValues(w) });
}
export function wakeCore(ctx, id, body, lang) {
  const w = ctx.rt.w, a = w.agents[id];
  if (!tokenized(w)) return failure(lang, 'not_found');
  if (!object(body) || !['main', 'wake'].includes(body.kind) || (body.toolMode !== undefined && !['native', 'json', 'mcp'].includes(body.toolMode)) || (body.actionTools !== undefined && !['legacy', 'typed'].includes(body.actionTools)) || (body.lang !== undefined && typeof body.lang !== 'string')) return failure(lang, 'invalid_request');
  if (w.paused) return failure(lang, 'paused');
  if (a.status !== 'awake') return failure(lang, 'not_awake');
  lang = normLang(body.lang ?? a.lang);
  const p = perception(ctx, id, lang), wakeId = `w${w.clock.tick}-${randomBytes(3).toString('hex')}`;
  // TODO(spec): Q66 — preview the bill that this wake will move into lastBill.
  if (p.you.tokens && a.tokens.bill) p.you.tokens.lastBill = structuredClone(a.tokens.bill);
  const text = body.kind === 'wake' ? renderWake(p, { lang }) : renderBrief(p, { lang, brief: a.routine.brief });
  // TODO(spec): Q65 — charge the full standard prompt, including its acquired block.
  const system = prompt(ctx, id, p, normLang(a.lang));
  const result = ctx.rt.exec('meter', { op: 'wake', agentId: id, wakeId, day: earthDayKey(ctx), kind: body.kind,
    system: textWeight(system), brief: textWeight(text), delivered: maxSeq(p.inbox, a.delivered) }).result;
  if (!result.ok) return failed(lang, result);
  ctx.wakings.set(id, { wakeId, tick: w.clock.tick, kind: body.kind, turn: 1, ctx: textWeight(system) + textWeight(text), fresh: textWeight(text), requests: 0 });
  return { status: 200, json: { wakeId, system: prompt(ctx, id, p, lang, body.toolMode ?? 'native', body.actionTools ?? 'legacy'), text,
    bill: result.bill, you: tokenStatus(ctx, id, { lang }).you, attention: { ...limits(ctx) } } };
}
function turnFor(s, body) {
  if (body.turn !== undefined && (!Number.isSafeInteger(body.turn) || body.turn < 1)) return null;
  const turn = body.turn ?? (s.requests === 0 ? 1 : s.turn + 1);
  return { turn: Math.max(s.turn, turn), reread: turn > s.turn ? rereadCost(s.ctx - s.fresh) : 0 };
}
export function lookCore(ctx, id, body, lang) {
  if (!tokenized(ctx.rt.w)) return failure(lang, 'not_found');
  if (!object(body)) return failure(lang, 'invalid_request');
  const s = sessionFor(ctx, id, body.wakeId);
  if (!s || typeof body.wakeId !== 'string') return failure(lang, 'no_waking');
  if (ctx.rt.w.paused) return failure(lang, 'paused');
  if (ctx.rt.w.agents[id].status !== 'awake') return failure(lang, 'not_awake');
  const next = turnFor(s, body);
  if (!next || typeof body.what !== 'string' || (body.id !== undefined && typeof body.id !== 'string') || (body.lang !== undefined && typeof body.lang !== 'string')) return failure(lang, 'invalid_request');
  lang = normLang(body.lang ?? lang);
  const current = ctx.looks.get(id), count = current?.tick === s.tick ? current.n : 0;
  if (count >= limits(ctx).looks) return failure(lang, 'looks_exhausted');
  const p = perception(ctx, id, lang), a = ctx.rt.w.agents[id];
  // Keep the inbox line boundaries for delivery accounting after clipping.
  const lines = body.what === 'inbox' ? secInbox(makeCtx(p, { code: lang, level: 0 })) : null;
  const full = renderLook(p, body.what, body.id, { lang });
  const text = clipLook(full, limits(ctx).lookChars, lang);
  let delivered = a.delivered;
  if (lines) {
    // TODO(spec): Q64 — acknowledge only complete inbox entries visible before clipping.
    let chars = cpLength(lines[0] || '');
    for (let i = 0; i < p.inbox.length; i++) {
      chars += 1 + cpLength(lines[i + 1]);
      if (chars > limits(ctx).lookChars) break;
      delivered = Math.max(delivered, p.inbox[i].seq);
    }
  }
  const result = ctx.rt.exec('meter', { op: lines ? 'inbox' : 'look', agentId: id, wakeId: s.wakeId, day: earthDayKey(ctx), reread: next.reread, read: textWeight(text), ...(lines ? { delivered } : {}) }).result;
  if (!result.ok) { if (['tokens_exhausted', 'cap_reached'].includes(result.error.code)) ctx.wakings.delete(id); return failed(lang, result); }
  s.ctx += textWeight(text); s.fresh = textWeight(text); s.turn = next.turn; s.requests++;
  ctx.looks.set(id, { tick: s.tick, n: count + 1 });
  return { status: 200, json: { text, bill: result.bill, you: tokenStatus(ctx, id, { lang }).you } };
}
export function actTokens(ctx, id, body, lang) {
  const s = sessionFor(ctx, id, body.wakeId);
  if (!s || typeof body.wakeId !== 'string') return failure(lang, 'no_waking');
  const next = turnFor(s, body);
  if (!next) return failure(lang, 'invalid_request', { field: 'turn' });
  const w = ctx.rt.w, a = w.agents[id];
  const result = ctx.rt.exec('act', { agentId: id, actions: body.actions, thought: body.thought ?? undefined, lang,
    meter: { wakeId: s.wakeId, turn: next.turn, reread: next.reread, day: earthDayKey(ctx) } }).result;
  if (!result.ok) { if (['tokens_exhausted', 'cap_reached'].includes(result.error.code)) ctx.wakings.delete(id); return failed(lang, result); }
  s.ctx += result.writeWeight; s.turn = next.turn; s.requests++;
  let bill = result.bill, arrived, arrivedWithheld;
  if (a.status === 'awake') {
    const p = perception(ctx, id, lang);
    const moved = result.results.some(r => r.ok && r.type === 'move');
    const text = [...renderArrived(p, p.inbox, { lang }), ...(moved ? renderArrival(p, { lang }) : [])].join('\n');
    if (text) {
      const metered = ctx.rt.exec('meter', { op: 'inbox', agentId: id, wakeId: s.wakeId, day: earthDayKey(ctx), reread: 0, read: textWeight(text), delivered: maxSeq(p.inbox, a.delivered) }).result;
      if (metered.ok) { s.ctx += textWeight(text); s.fresh = textWeight(text); arrived = text; bill = metered.bill; }
      else { arrivedWithheld = p.inbox.length; ctx.wakings.delete(id); }
    }
  }
  const results = result.results.map(r => actionFeedback(r.ok ? r : { ...r, error: errorBody(lang, r.error.code, r.error, 2).error }, lang, { premise: 4, act: body.actions[r.index], tokenValues: tokenValues(w) }));
  return { status: 200, json: { ok: true, results, you: { ...result.you, ...tokenStatus(ctx, id, { lang }).you }, bill,
    ...(arrived !== undefined ? { arrived } : {}), ...(arrivedWithheld !== undefined ? { arrivedWithheld } : {}) } };
}
