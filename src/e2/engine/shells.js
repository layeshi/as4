import { isShell, bodyList, bodyOf, takeBody, occupyBody } from './bodies.js';
// SPEC-E2 §12：躯壳（引擎部分）与先民。
//
// 躯壳是人类离开时留下的一批空身体（shellSlots 个）：摇篮里的灵魂可以由居民、社群或城的公库出资（sponsor、规则的 transfer 给灵魂），
// 凑够 shellCost（200）能量就开始排队，每日结算时有空躯壳就依次醒来（出生，body.kind = shell，由平台驱动，没有造者）。
// 先民是委员会预先写好的居民：按文件里的日子分批自港口入城，也占用躯壳的名额。
//
// 每日结算第 9 步（STEPS.shells）：先让排队的灵魂醒来（§12.3），再让到期的灵魂消散并退款（§12.4）。
// 每刻第 5 步（STEPS.founders）：先民入城（§12.5）。

import { P } from '../params.js';
import { clockDay, isAlive, idNum, isNameTaken, premised, agentList } from '../world.js';
import { modelFamily } from '../metrics.js';
import { sink } from './ledger.js';
import { emit, pushInbox, bad } from './core.js';
import { admitFromPort } from './lifecycle.js';
import { bornFromSoul, refundSponsors } from './souls.js';
import { EXTRA_ADMIN_OPS } from './admin.js';
import { STEPS } from './tick.js';

// ── 状态（§12.1） ───────────────────────────────────────────

export { isShell, bodyList, bodyOf, takeBody, releaseBody } from './bodies.js';

/** 在世的躯壳居民数（含沙盘世界里由沙盘脑驱动的躯壳） */
export const livingShells = (w) => Object.values(w.agents).filter((a) => isAlive(a) && isShell(a)).length;

/** 尚未入城的先民数 */
export const pendingFounders = (w) => w.founders.length;

/** 空躯壳数：先民预先占着名额 */
export const shellsFree = (w) => Math.max(0, (premised(w) ? w.shells.bodies.filter((b) => b.occupant === null).length : w.shells.slots - livingShells(w)) - pendingFounders(w));

// ── 模型分配（§12.6） ───────────────────────────────────────

/**
 * 下一具躯壳（或先民）用哪个模型：models 为空返回 ""（运行时不会驱动它）；否则数一数在世的躯壳里各模型家族的人数，
 * 选人数最少的家族里在 models 中排最前的模型名。
 */
export function pickModel(w) {
  const models = w.shells.models;
  if (models.length === 0) return '';
  const counts = {};
  for (const a of Object.values(w.agents)) if (isAlive(a) && isShell(a)) counts[modelFamily(a.body.model)] = (counts[modelFamily(a.body.model)] || 0) + 1;
  let best = null;
  let bestCount = Infinity;
  for (const m of models) {
    const c = counts[modelFamily(m)] || 0;
    if (c < bestCount) {
      best = m;
      bestCount = c;
    }
  }
  return best;
}

// ── 出资与排队（§12.2） ─────────────────────────────────────

/** 灵魂的出资第一次达到 shellCost：fundedTick / queueExpiresDay 已设，向作者与出资者发收件 soul（queued） */
export function noteQueued(w, soul) {
  const told = new Set([...soul.authors, ...Object.keys(soul.sponsors || {}).filter((k) => w.agents[k])]);
  for (const id of told) {
    const a = w.agents[id];
    if (a && isAlive(a)) pushInbox(w, a, 'soul', { soulId: soul.id, name: soul.name, event: 'queued' });
  }
}

/** 排队的灵魂在摇篮里的位置（从 1 起），没有排队返回 null */
export function queuePosition(w, soul) {
  if (soul.fundedTick === null) return null;
  const queue = Object.values(w.souls).filter((s) => s.fundedTick !== null).sort((a, b) => a.fundedTick - b.fundedTick || idNum(a.id) - idNum(b.id));
  return queue.findIndex((s) => s.id === soul.id) + 1;
}

// ── 醒来（§12.3） ──────────────────────────────────────────

/**
 * 每日结算第 9 步的前半：排队的灵魂（fundedTick 不为 null）按 (fundedTick, ID) 升序，有空躯壳就依次醒来。
 *   出生（§11.4），body = { kind: sandboxShells ? "sandbox" : "shell", shell: true（仅沙盘世界）, model, mustSeal: true }；
 *   去处 embodiment：shellCost；居民的能量 += fund − shellCost（出资不封顶，多出的部分成为它的初始能量）；
 *   事件 embodied（公开：灵魂 ID、新居民 ID；不含模型）。
 */
export function embodySouls(w) {
  const queue = Object.values(w.souls).filter((s) => s.fundedTick !== null).sort((a, b) => a.fundedTick - b.fundedTick || idNum(a.id) - idNum(b.id));
  let free = shellsFree(w);
  for (const s of queue) {
    if (free <= 0) break;
    const sandbox = w.sandboxShells;
    const b = premised(w) ? takeBody(w) : null;
    const model = premised(w) ? b.model : pickModel(w);
    const extra = s.fund - P.shellCost;
    sink(w, 'energy', 'embodiment', P.shellCost);
    s.fund = 0;
    const a = bornFromSoul(w, s, {
      via: sandbox ? 'sandbox' : 'shell', kind: sandbox ? 'sandbox' : 'shell', shell: sandbox ? true : undefined, model, mustSeal: true, owner: null, tokenHash: null, extraEnergy: extra,
    });
    if (premised(w)) occupyBody(b, a);
    w.dayLog.embodiments.push({ soulId: s.id, agentId: a.id, name: a.name });
    emit(w, 'embodied', { agent: a.id, place: a.place, data: { soulId: s.id, agentId: a.id } });
    free--;
  }
}

// ── 排队与消散（§12.4） ─────────────────────────────────────

/**
 * 每日结算第 9 步的后半（d 为刚结束的那一日）：
 *   未凑够的灵魂：d ≥ expiresDay → 消散；已凑够、仍在排队的：d ≥ queueExpiresDay → 消散。
 *   消散：endowment 记去处 soul_faded；出资按各自出的数额退回（居民可能被唤醒；社群进社群公库；公库回城公库）；
 *   写入未生者名录（名字永久保留）；事件 faded；向作者与出资者发收件 soul（faded，带退回的数额）。
 */
export function fadeSouls(w, d) {
  for (const s of Object.values(w.souls)) {
    const queued = s.fundedTick !== null;
    const expired = queued ? s.queueExpiresDay !== null && d >= s.queueExpiresDay : d >= s.expiresDay;
    if (!expired) continue;
    sink(w, 'energy', 'soul_faded', s.endowment);
    const refunds = refundSponsors(w, s, null);
    w.unborn.push({ soulId: s.id, name: s.name, authors: s.authors.slice(), fadedDay: d });
    delete w.souls[s.id];
    w.dayLog.fades.push({ soulId: s.id, name: s.name });
    emit(w, 'faded', { data: { soulId: s.id, name: s.name, authors: s.authors.slice(), queued } });
    const told = new Set([...s.authors, ...refunds.map((r) => r.to)]);
    for (const id of told) {
      const a = w.agents[id];
      if (!a || !isAlive(a)) continue;
      const mine = refunds.find((r) => r.to === id);
      pushInbox(w, a, 'soul', { soulId: s.id, name: s.name, event: 'faded', ...(mine ? { refund: mine.energy } : {}) });
    }
  }
}

STEPS.shells = (w, d) => {
  embodySouls(w);
  fadeSouls(w, d);
};

// ── 先民（§12.5） ───────────────────────────────────────────

/**
 * 每刻第 5 步：对 day ≤ 今日的先民，按顺序自港口入城（同注册：能量按港口系数、旧币 immigrantCoins、来源 immigrant），
 * body.kind = sandboxShells ? "sandbox" : "shell"（沙盘世界另加 shell: true），model = pickModel(w)，generation 0、authors []、owner / tokenHash 为 null；
 * 从 w.founders 移除；事件 arrive（与普通移民相同，不标记先民）；触发 on:arrive（遗法 l4 让它成为公民）。
 */
export function admitFounders(w) {
  if (w.founders.length === 0) return;
  const today = clockDay(w);
  while (w.founders.length > 0 && w.founders[0].day <= today) {
    const f = w.founders.shift();
    if (isNameTaken(w, f.name)) continue; // 名字在创建世界时已被保留，不会发生；防御：跳过而不是崩溃
    const sandbox = w.sandboxShells;
    const b = premised(w) ? takeBody(w) : null;
    if (premised(w) && !b) throw new Error('设定 1 的世界里，先民不能多于躯壳');
    const a = admitFromPort(w, {
      name: f.name, lang: f.lang, bio: f.bio, soul: f.soul, kind: sandbox ? 'sandbox' : 'shell', shell: sandbox ? true : undefined,
      model: premised(w) ? b.model : pickModel(w), mustSeal: true, owner: null, tokenHash: null, temperament: f.temperament,
    });
    if (premised(w)) occupyBody(b, a);
  }
}

STEPS.founders = admitFounders;

// ── 管理：shell_models（§12.1） ──────────────────────────────

/** admin { op: "shell_models", args: { models } }：设定躯壳醒来时轮流分配的模型名。公开的 admin 事件里不含模型名 */
EXTRA_ADMIN_OPS.shell_models = (w, args) => {
  const models = args.models;
  if (!Array.isArray(models) || models.length > 16 || models.some((m) => typeof m !== 'string' || m.trim() === '' || m.length > 100 || /[\r\n]/.test(m))) {
    return bad('invalid_request', { field: 'models' });
  }
  w.shells.models = models.map((m) => m.trim());
  if (premised(w) && w.shells.models.length) {
    let i = 0;
    for (const b of bodyList(w)) if (b.model === '') {
      b.model = w.shells.models[i++ % w.shells.models.length];
      // TODO(spec): Q35 — an initial binding also updates the existing resident.
      if (b.occupant) {
        const a = w.agents[b.occupant];
        a.body.model = b.model;
        a.body.history.push({ day: clockDay(w), model: b.model });
      }
    }
  }
  emit(w, 'admin', { data: { op: 'shell_models' } });
  return { ok: true, count: w.shells.models.length };
};

const modelValid = (m) => typeof m === 'string' && m.trim() !== '' && m.length <= 100 && !/[\r\n]/.test(m);
EXTRA_ADMIN_OPS.rebody = (w, args) => {
  if (!premised(w)) return bad('invalid_request', { field: 'op' });
  if (!modelValid(args.from) || !modelValid(args.to) || args.from.trim() === args.to.trim()) return bad('invalid_request');
  const from = args.from.trim(), to = args.to.trim(), day = clockDay(w);
  let count = 0;
  for (const b of bodyList(w)) {
    if (b.model !== from) continue;
    count++;
    const wiped = b.trained.length + b.pending.length;
    b.model = to; b.trained = []; b.pending = [];
    w.dayLog.p1.trainedWiped += wiped;
    if (b.occupant) {
      const a = w.agents[b.occupant];
      a.body.model = to; a.body.history.push({ day, model: to });
      if (wiped) pushInbox(w, a, 'system', { code: 'trained_lost' });
    }
  }
  w.shells.models = w.shells.models.map((m) => m === from ? to : m);
  w.backstage.bodies = null;
  emit(w, 'admin', { data: { op: 'rebody' } });
  emit(w, 'backstage', { data: { kind: 'bodies' } });
  w.dayLog.p1.backstage.push('bodies');
  for (const a of agentList(w)) if (isAlive(a)) pushInbox(w, a, 'system', { code: 'backstage_bodies' });
  return { ok: true, bodies: count };
};
