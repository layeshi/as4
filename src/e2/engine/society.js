// SPEC-M1 §7.11 与 SPEC-E2 §8.7、§11：社群、交易、孕育之约、词典、梦（第二纪）。

import { P } from '../params.js';
import { next, int } from '../../rng.js';
import { countWord, truncateCp } from '../../text.js';
import { emit, pushInbox, creditEnergy } from './core.js';

// ── 词典 ───────────────────────────────────────────────────

/**
 * 每条公开文本写入时，统计其中出现的词典词（SPEC-M1 §7.11）：每出现一次 uses + 1，并把说话者加入 users。
 * 词的创造者在 define 时的释义不计入（define 不调用本函数）。
 */
export function noteWordUse(w, a, text) {
  for (const [key, e] of Object.entries(w.lexicon)) {
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

/**
 * 关闭一份进行中的孕育之约（过期，或有作者离世 / 归隐）：每位已付者的份额退回（可能唤醒沉睡者），保留的名字释放。
 * 向全体仍在世的作者发 pact_closed（expired）。
 */
export function closePact(w, c, reason = 'expired') {
  c.status = 'expired';
  for (const [id, consent] of Object.entries(c.consents)) {
    if (consent.paid > 0) creditEnergy(w, w.agents[id], consent.paid, null);
  }
  c.escrow = 0;
  emit(w, 'pact_expired', { agent: c.from, data: { pactId: c.id, name: c.name, reason } });
  for (const id of c.authors) {
    const author = w.agents[id];
    if (author && (author.status === 'awake' || author.status === 'dormant')) pushInbox(w, author, 'pact_closed', { pactId: c.id, result: 'expired' });
  }
}

// ── 社群的退出与解散 ────────────────────────────────────────

/**
 * 居民或社群离场 / 解散后，它名下的地点改归全城（记事件 place_owner；地点规则随之作废，全城所有的地点没有地点规则），
 * 以它的名义进行中的工程也一并改归全城（否则建成时会落到一个不存在的主人名下）。
 */
export function orphanPlaces(w, ownerKind, ownerId) {
  for (const p of Object.values(w.places)) {
    if (p.owner.kind === ownerKind && p.owner.id === ownerId) {
      p.owner = { kind: 'city' };
      p.rules = null;
      emit(w, 'place_owner', { place: p.id, data: { placeId: p.id, from: { kind: ownerKind, id: ownerId }, to: { kind: 'city' } } });
    }
  }
  for (const j of Object.values(w.projects)) {
    if (j.status === 'open' && j.owner.kind === ownerKind && j.owner.id === ownerId) j.owner = { kind: 'city' };
  }
}

/** 解散一个社群：社群公库并入城公库，章程作废，名下的地点改归全城，成员收到通知 */
export function dissolveGroup(w, g) {
  const members = g.members.slice();
  w.treasury.energy += g.treasury.energy;
  w.treasury.coins += g.treasury.coins;
  g.treasury = { energy: 0, coins: 0 };
  g.dissolved = true;
  g.members = [];
  g.pending = [];
  g.steward = null;
  g.bylaws = null;
  for (const id of members) {
    const m = w.agents[id];
    m.groups = m.groups.filter((x) => x !== g.id);
    pushInbox(w, m, 'group', { groupId: g.id, event: 'dissolved' });
  }
  orphanPlaces(w, 'group', g.id);
  emit(w, 'dissolve', { data: { groupId: g.id, name: g.name } });
}

/**
 * 居民退出一个社群。若它是管事，管事之职交给入社最早的在世成员；成员为 0 时社群解散。
 * 返回 'left' | 'dissolved'。
 */
export function leaveGroup(w, g, a, reason = 'left') {
  g.members = g.members.filter((id) => id !== a.id);
  g.pending = g.pending.filter((id) => id !== a.id);
  a.groups = a.groups.filter((id) => id !== g.id);
  // 社群章程给成员加的标签随退出一并去掉（标签带着社群 ID 的前缀）
  a.tags = a.tags.filter((t) => !t.startsWith(`${g.id}:`));
  emit(w, 'leave', { agent: a.id, data: { groupId: g.id, reason } });
  if (g.members.length === 0) {
    dissolveGroup(w, g);
    return 'dissolved';
  }
  if (g.steward === a.id) {
    const heir = g.members.find((id) => w.agents[id].status === 'awake' || w.agents[id].status === 'dormant');
    if (heir === undefined) {
      dissolveGroup(w, g);
      return 'dissolved';
    }
    g.steward = heir;
    emit(w, 'steward', { agent: heir, data: { groupId: g.id, from: a.id, to: heir, reason } });
    pushInbox(w, w.agents[heir], 'group', { groupId: g.id, event: 'steward' });
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

/** 每刻结算第 2 步：处理到期的交易与孕育之约（退回托管），按 ID 升序 */
export function expireOffersAndPacts(w) {
  for (const o of Object.values(w.offers)) {
    if (o.status === 'open' && o.expiresTick <= w.clock.tick) closeOffer(w, o, 'expired');
  }
  for (const c of Object.values(w.pacts)) {
    if (c.status === 'open' && c.expiresTick <= w.clock.tick) closePact(w, c, 'expired');
  }
}

/**
 * 每日结算第 14 步：梦（SPEC-M1 §7.14）。对每个醒着的居民，用 world 流判定是否做梦（概率 0.5；极光生效的日子为 1）。
 * 做梦时，从当日所有公开的 say 与 broadcast 中（排除它自己的）用 world 流抽 2 条，各取前 60 个字符作为片段；
 * 不足 2 条时，用当前可见的铭刻或已发现的遗物补足；仍不足时不做梦。送达收件 dream，并产生 owner 事件。
 * auroraToday：这一日是否有极光生效（结算开始时记下，避免极光在结算第 12 步被移除而漏算最后一晚）。
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
          ...Object.values(w.inscriptions).filter((i) => !i.coveredBy && !i.redacted && !i.lost).map((i) => i.text),
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
