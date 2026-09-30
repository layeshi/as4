// SPEC-M1 §11.1 命令 admin、PROTOCOL §11：管理操作。
// 所有管理操作都会产生公开的 admin 事件（不含管理员身份）。载荷：op, args。
//
//   pause / resume   暂停 / 恢复（城中表现为「时间静止」）
//   weather          强行排期一次天象（测试与对照城用）。公开事件里不含天象类型与日期（排期对观众保密）
//   redact           遮盖内容：{ kind: event | inscription | doc | lexicon, id }；历史不删除，原文留在命令日志里
//   adjust           修正余额：{ agentId, energy?, coins?, reason }，增减量；记入账本的 admin 来源
//   curtain          谢幕：公开模型、人类书写的灵魂与造者署名
//   seed_sandbox     开发用：放入 N 个沙盘脑（SANDBOX_AGENTS；生产环境必须为 0）

import { LIMITS } from '../params.js';
import { nameKey, normalizeText, cpLength } from '../text.js';
import { source } from './ledger.js';
import { emit, bad, creditEnergy } from './core.js';
import { forceWeather } from './weather.js';
import { seedSandbox } from '../sandbox/brains.js';

const isInt = (v) => typeof v === 'number' && Number.isSafeInteger(v);

export function adminCommand(w, p) {
  const args = p.args && typeof p.args === 'object' ? p.args : {};
  switch (p.op) {
    case 'pause':
      w.paused = true;
      emit(w, 'admin', { data: { op: 'pause' } });
      return { ok: true, paused: true };
    case 'resume':
      w.paused = false;
      emit(w, 'admin', { data: { op: 'resume' } });
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
    case 'seed_sandbox': {
      // 开发用：在港口放入 N 个沙盘脑（创建新世界时由入口走命令日志执行，这样回放才能重建）
      if (!isInt(args.count) || args.count < 1 || args.count > 500) return bad('invalid_request', { field: 'count' });
      const ids = seedSandbox(w, args.count);
      emit(w, 'admin', { data: { op: 'seed_sandbox', count: ids.length } });
      return { ok: true, agents: ids };
    }
    case 'redact':
      return redact(w, args);
    case 'adjust':
      return adjust(w, args);
    default:
      return bad('invalid_request', { field: 'op' });
  }
}

function redact(w, { kind, id }) {
  let target = id;
  if (kind === 'event') {
    if (!isInt(id) || id < 1 || id > w.counters.event) return bad('not_found');
    if (!w.redacted.events.includes(id)) w.redacted.events.push(id);
  } else if (kind === 'inscription') {
    const i = typeof id === 'string' ? w.inscriptions[id] : null;
    if (!i) return bad('not_found');
    i.redacted = true;
  } else if (kind === 'doc') {
    const d = typeof id === 'string' ? w.docs[id] : null;
    if (!d) return bad('not_found');
    d.redacted = true;
  } else if (kind === 'lexicon') {
    const e = typeof id === 'string' ? w.lexicon[nameKey(id)] : null;
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
  const a = typeof agentId === 'string' ? w.agents[agentId] : null;
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
