// 归档只保留领域记录；身份凭据和模型内部推理不属于居民历史。
import { involves } from '../events.js';
const hidden = /^(?:apiKey|api_key|ownerKey|ownerKeyHash|keyHash|ownerHash|tokenHash|agentToken|authorization|password|passwordHash|reasoning|reasoning_content|thinking|managerAccountId|creatorAccountId)$/i;
export function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => !hidden.test(k)).map(([k, v]) => [k, clean(v)]));
  return value;
}
export function profile(a) {
  return clean({ ...Object.fromEntries(['id', 'name', 'lang', 'bio', 'soul', 'status', 'generation', 'authors', 'bornDay', 'diedDay', 'purpose', 'place', 'energy', 'coins', 'basic', 'materials'].filter(k => a[k] !== undefined).map(k => [k, a[k]])), ...(a.body ? { model: a.body.model, modelHistory: a.body.history ?? [] } : {}) });
}
export const position = a => a ? Object.fromEntries(['place', 'energy', 'coins', 'basic', 'materials'].filter(k => a[k] !== undefined).map(k => [k, a[k]])) : null;
export function actionRecords(cmd, result, ticksPerDay, before = {}, agents = {}, idempotent = false) {
  if (cmd.type !== 'act' || !Array.isArray(cmd.payload?.actions)) return [];
  const p = cmd.payload, after = position(agents[p.agentId]);
  const common = { tick: cmd.tick, day: Math.floor(cmd.tick / ticksPerDay), agentId: p.agentId, commandN: cmd.n, source: { type: 'command', n: cmd.n },
    ...(idempotent && result?.ok === true && p.requestId ? { decisionKey: `${p.experimentGeneration ?? 0}:${p.requestId}` } : {}),
  };
  const rows = p.actions.map((action, index) => ({ ...common, kind: 'action', index, type: action.type,
    parameters: clean(action), result: clean(result?.results?.[index] ?? (result?.ok === false ? { ok: false, error: result.error } : { ok: null, note: '旧版本没有保存此动作的执行回执。' })),
    ...(after ? { commandBefore: before[p.agentId] ?? null, commandAfter: after, changeScope: 'command' } : {}),
  }));
  if (p.thought) rows.push({ ...common, kind: 'thought', text: p.thought, submitted: true });
  return rows;
}
export function privateEventFor(e, id) {
  if (e.vis === 'internal') return false;
  if (e.vis === 'owner') return e.agent === id;
  if (e.vis === 'delayed') return e.agent === id || e.type === 'whisper' && (e.data?.from === id || e.data?.to === id && e.data?.delivered !== false);
  return involves(e, id) || e.data?.actor === id || e.data?.requester === id || e.data?.provider === id;
}
export const csvCell = value => {
  let text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
