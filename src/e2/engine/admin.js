// SPEC-E2 §13.7、PROTOCOL-2 §11：管理命令 admin。
// 所有管理操作都会产生公开的 admin 事件（不含管理员身份）。载荷：op, args。
//
//   pause / resume   暂停 / 恢复（城中表现为「时间静止」）
//   weather          强行排期一次天象（测试与对照城用）。公开事件里不含天象类型与日期（排期对观众保密）
//   redact           遮盖内容：{ kind: event | inscription | doc | lexicon, id }；历史不删除，原文留在命令日志里
//   adjust           修正余额：{ agentId, energy?, coins?, reason }，增减量；记入账本的 admin 来源
//   curtain          谢幕：公开模型、身体的种类与人类书写的灵魂（含先民）
//   shell_models     设定躯壳醒来时轮流分配的模型名（第 8 步）
//   seed_sandbox     开发用：放入 N 位由沙盘脑驱动的先民（第 13 步；生产环境必须为 0）

import { premised, agentList, isAlive } from '../world.js';
import { LIMITS } from '../params.js';
import { nameKey, normalizeText, cpLength } from '../../text.js';
import { source } from './ledger.js';
import { emit, bad, creditEnergy, pushInbox } from './core.js';
import { forceWeather } from './weather.js';
import { resetOwnerKey } from '../../owner-key.js';

const isInt = (v) => typeof v === 'number' && Number.isSafeInteger(v);

/** 其他步骤加入的管理操作：{ op: (w, args) => result } */
export const EXTRA_ADMIN_OPS = {};

export function adminCommand(w, p) {
  const args = p.args && typeof p.args === 'object' ? p.args : {};
  switch (p.op) {
    case 'reset_owner_key':
      return resetOwnerKey(w, args, { emit, bad });
    case 'pause':
      if (args.experiment === true && (!w.paused || !w.experimentControl?.active)) {
        w.experimentControl = { active: true, generation: w.commandN, remainingMs: Number.isSafeInteger(args.remainingMs) && args.remainingMs >= 0 ? args.remainingMs : 0 };
      }
      w.paused = true;
      emit(w, 'admin', { data: { op: 'pause' } });
      return { ok: true, paused: true };
    case 'resume':
      if (w.experimentControl) w.experimentControl.active = false;
      w.paused = false;
      emit(w, 'admin', { data: { op: 'resume' } });
      if (premised(w)) notifyBackstage(w, 'resume');
      return { ok: true, paused: false };
    case 'curtain':
      w.revealed = true;
      emit(w, 'admin', { data: { op: 'curtain' } });
      return { ok: true, revealed: true };
    case 'weather': {
      const r = forceWeather(w, args);
      if (!r.ok) return r;
      emit(w, 'admin', { data: { op: 'weather' } });
      return { ok: true };
    }
    case 'redact':
      return redact(w, args);
    case 'adjust':
      return adjust(w, args);
    default:
      if (typeof p.op === 'string' && Object.prototype.hasOwnProperty.call(EXTRA_ADMIN_OPS, p.op)) return EXTRA_ADMIN_OPS[p.op](w, args);
      return bad('invalid_request', { field: 'op' });
  }
}

function redact(w, { kind, id }) {
  let target = id;
  if (kind === 'event') {
    if (!isInt(id) || id < 1 || id > w.counters.event) return bad('not_found');
    if (!w.redacted.events.includes(id)) w.redacted.events.push(id);
  } else if (kind === 'inscription') {
    const i = typeof id === 'string' && Object.prototype.hasOwnProperty.call(w.inscriptions, id) ? w.inscriptions[id] : null;
    if (!i) return bad('not_found');
    i.redacted = true;
  } else if (kind === 'doc') {
    const d = typeof id === 'string' && Object.prototype.hasOwnProperty.call(w.docs, id) ? w.docs[id] : null;
    if (!d) return bad('not_found');
    d.redacted = true;
  } else if (kind === 'lexicon') {
    const e = typeof id === 'string' && Object.prototype.hasOwnProperty.call(w.lexicon, nameKey(id)) ? w.lexicon[nameKey(id)] : null;
    if (!e) return bad('not_found');
    e.redacted = true;
    target = e.word;
  } else {
    return bad('invalid_request', { field: 'kind' });
  }
  emit(w, 'admin', { data: { op: 'redact' } });
  emit(w, 'redacted', { data: { kind, id: target } });
  return { ok: true, kind, id: target };
}

function adjust(w, { agentId, energy = 0, coins = 0, reason }) {
  const a = typeof agentId === 'string' && Object.prototype.hasOwnProperty.call(w.agents, agentId) ? w.agents[agentId] : null;
  if (!a) return bad('not_found');
  if (a.status !== 'awake' && a.status !== 'dormant') return bad('not_awake', { status: a.status });
  if (!isInt(energy) || !isInt(coins) || (energy === 0 && coins === 0)) return bad('invalid_request', { field: 'energy' });
  const why = normalizeText(reason);
  if (why === null || why === '' || cpLength(why) > LIMITS.note) return bad('invalid_request', { field: 'reason' });
  if (a.energy + energy < 0 || a.coins + coins < 0) return bad('invalid_request', { field: 'energy' });
  source(w, 'energy', 'admin', energy);
  source(w, 'coins', 'admin', coins);
  a.coins += coins;
  if (energy >= 0) creditEnergy(w, a, energy, null);
  else a.energy += energy;
  emit(w, 'admin', { data: { op: 'adjust', agentId: a.id, energy, coins, reason: why } });
  return { ok: true, agentId: a.id, energy: a.energy, coins: a.coins };
}

export function notifyBackstage(w, kind, direction) {
  const data = { kind, ...(kind === 'budget' ? { direction } : {}) };
  emit(w, 'backstage', { data });
  w.dayLog.p1.backstage.push(kind);
  const code = kind === 'budget' ? `backstage_budget_${direction}` : `backstage_${kind}`;
  for (const a of agentList(w)) if (isAlive(a)) pushInbox(w, a, 'system', { code });
}
EXTRA_ADMIN_OPS.backstage = (w, args) => {
  if (!premised(w)) return bad('invalid_request', { field: 'op' });
  const { kind, fp, direction, initial } = args;
  if (!['code', 'bodies', 'budget'].includes(kind)) return bad('invalid_request', { field: 'kind' });
  if (fp !== undefined && fp !== null && typeof fp !== 'string') return bad('invalid_request', { field: 'fp' });
  if (initial !== undefined && typeof initial !== 'boolean') return bad('invalid_request', { field: 'initial' });
  if (direction !== undefined && (!['up', 'down'].includes(direction) || kind !== 'budget')) return bad('invalid_request', { field: 'direction' });
  if (kind === 'budget' && !initial && direction === undefined) return bad('invalid_request', { field: 'direction' });
  if (initial) { w.backstage[kind] = fp ?? null; return { ok: true }; }
  w.backstage[kind] = fp ?? w.backstage[kind];
  emit(w, 'admin', { data: { op: 'backstage' } });
  notifyBackstage(w, kind, direction);
  return { ok: true };
};
