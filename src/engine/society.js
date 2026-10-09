import { filterValues, recordKeys } from '../collections.js';
// SPEC-M1 §7.11：社群、交易、典籍、词典（家书、梦、孕育见本文件后半部分，第 5 步补全）。
// 第 2 步只放死亡与归隐要用到的部分：词典计数、交易与孕育之约的关闭、社群的退出与解散。

import { P } from '../params.js';
import { next, int } from '../rng.js';
import { countWord, truncateCp } from '../text.js';
import { emit, pushInbox, creditEnergy } from './core.js';
import { orphanFacilities } from './environment.js';

// ── 词典 ───────────────────────────────────────────────────

/**
 * 每条公开文本写入时，统计其中出现的词典词（§7.11）：每出现一次 uses + 1，并把说话者加入 users。
 * 词的创造者在 define 时的释义不计入（define 不调用本函数）。
 */
export function noteWordUse(w, a, text) {
  for (const key of recordKeys(w.lexicon)) {
    const e = w.lexicon[key];
    const n = countWord(text, key);
    if (n > 0) {
      e.uses += n;
      if (!e.users.includes(a.id)) e.users.push(a.id);
    }
  }
}

// ── 交易与孕育之约的关闭（退回托管） ────────────────────────────

/** 关闭一笔进行中的交易：状态改为 cancelled | expired，托管退回发起者 */
export function closeOffer(w, o, reason) {
  o.status = reason === 'expired' ? 'expired' : 'cancelled';
  const from = w.agents[o.from];
  if (o.give.energy > 0) creditEnergy(w, from, o.give.energy, null);
  if (o.give.coins > 0) from.coins += o.give.coins;
  emit(w, 'offer_close', { agent: o.from, data: { offerId: o.id, reason } });
  if (from.status === 'awake' || from.status === 'dormant') pushInbox(w, from, 'offer_closed', { offerId: o.id, reason });
}

/** 关闭一份进行中的孕育之约（过期或一方离世）：托管的能量退回发起者，保留的名字释放 */
export function closePact(w, c, reason = 'expired') {
  c.status = 'expired';
  const from = w.agents[c.from];
  creditEnergy(w, from, c.escrow, null);
  c.escrow = 0;
  emit(w, 'pact_expired', { agent: c.from, data: { pactId: c.id, name: c.name, reason } });
  if (from.status === 'awake' || from.status === 'dormant') pushInbox(w, from, 'pact_closed', { pactId: c.id, result: 'expired' });
  const partner = w.agents[c.with];
  if (partner && (partner.status === 'awake' || partner.status === 'dormant')) {
    pushInbox(w, partner, 'pact_closed', { pactId: c.id, result: 'expired' });
  }
}

// ── 社群的退出与解散 ────────────────────────────────────────

/** 解散一个社群：社群公库并入城公库，蓄能池改归全城，成员收到通知 */
export function dissolveGroup(w, g) {
  const members = g.members.slice();
  w.treasury.energy += g.treasury.energy;
  w.treasury.coins += g.treasury.coins;
  g.treasury = { energy: 0, coins: 0 };
  g.dissolved = true;
  g.members = [];
  g.pending = [];
  g.steward = null;
  for (const id of members) {
    const m = w.agents[id];
    m.groups = m.groups.filter((x) => x !== g.id);
    pushInbox(w, m, 'group', { groupId: g.id, event: 'dissolved' });
  }
  orphanFacilities(w, 'group', g.id);
  emit(w, 'dissolve', { data: { groupId: g.id, name: g.name } });
}

/**
 * agent 退出一个社群。若它是管事，管事之职交给入社最早的在世成员；成员为 0 时社群解散。
 * 返回 'left' | 'dissolved'。
 */
export function leaveGroup(w, g, a, reason = 'left') {
  g.members = g.members.filter((id) => id !== a.id);
  g.pending = g.pending.filter((id) => id !== a.id);
  a.groups = a.groups.filter((id) => id !== g.id);
  emit(w, 'leave', { agent: a.id, data: { groupId: g.id, reason } });
  if (g.members.length === 0) {
    dissolveGroup(w, g);
    return 'dissolved';
  }
  if (g.steward === a.id) {
    const next = g.members.find((id) => w.agents[id].status === 'awake' || w.agents[id].status === 'dormant');
    if (next === undefined) {
      dissolveGroup(w, g);
      return 'dissolved';
    }
    g.steward = next;
    emit(w, 'steward', { agent: next, data: { groupId: g.id, from: a.id, to: next, reason } });
    pushInbox(w, w.agents[next], 'group', { groupId: g.id, event: 'steward' });
  }
  return 'left';
}

/** 死亡或归隐时：退出所有社群 */
export function leaveAllGroups(w, a, reason) {
  for (const gid of a.groups.slice()) {
    const g = w.groups[gid];
    if (g && !g.dissolved) leaveGroup(w, g, a, reason);
  }
  a.groups = [];
}


// ═══════════════════════════════════════════════════════════════
// 每刻：到期的交易与孕育之约；每日：梦
// ═══════════════════════════════════════════════════════════════

/** 每刻结算第 3 步：处理到期的交易与孕育之约（退回托管），按 ID 升序 */
export function expireOffersAndPacts(w) {
  for (const o of filterValues(w.offers, o => o.status === 'open', w.counters.o)) {
    if (o.status === 'open' && o.expiresTick <= w.clock.tick) closeOffer(w, o, 'expired');
  }
  for (const c of filterValues(w.pacts, c => c.status === 'open', w.counters.c)) {
    if (c.status === 'open' && c.expiresTick <= w.clock.tick) closePact(w, c, 'expired');
  }
}

/**
 * 每日结算第 15 步：梦（§7.14）。对每个醒着的 agent，用 world 流判定是否做梦（概率 0.5；极光生效的日子为 1）。
 * 做梦时，从当日所有公开的 say 与 broadcast 中（排除它自己的）用 world 流抽 2 条，各取前 60 个字符作为片段；
 * 不足 2 条时，用当前可见的铭刻或已发现的遗物补足；仍不足时不做梦。送达收件 dream，并产生 owner 事件。
 * auroraToday：这一日是否有极光生效（结算开始时记下，避免极光在结算第 13 步被移除而漏算最后一晚）。
 */
export function dailyDreams(w, auroraToday) {
  const rng = w.rng.world;
  const p = auroraToday ? 1 : P.dreamP;
  const utterances = w.dayLog.utterances;
  // 补足用的素材：当前可见的铭刻（按 ID 升序）与已发现的遗物
  let filler = null;
  for (const a of Object.values(w.agents)) {
    if (a.status !== 'awake') continue;
    if (!(next(rng) < p)) continue;
    const pool = utterances.filter((u) => u.from !== a.id).map((u) => u.text);
    const picked = [];
    while (picked.length < P.dreamFragments && pool.length > 0) picked.push(pool.splice(int(rng, pool.length), 1)[0]);
    if (picked.length < P.dreamFragments) {
      if (filler === null) {
        filler = [
          ...Object.values(w.inscriptions).filter((i) => !i.coveredBy && !i.redacted).map((i) => i.text),
          ...Object.values(w.docs).filter((d) => d.kind === 'relic' && !d.redacted).map((d) => d.body),
        ];
      }
      const rest = filler.slice();
      while (picked.length < P.dreamFragments && rest.length > 0) picked.push(rest.splice(int(rng, rest.length), 1)[0]);
    }
    if (picked.length < P.dreamFragments) continue;
    const fragments = picked.map((t) => truncateCp(t, P.dreamChars));
    pushInbox(w, a, 'dream', { fragments });
    emit(w, 'dream', { vis: 'owner', agent: a.id, data: { fragments } });
  }
}
