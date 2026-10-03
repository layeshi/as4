// SPEC-M1 §7.3 与 SPEC-E2 §11–§12：生命周期——注册（入城）、代谢与衰老、沉睡、死亡、遗嘱与遗产、归隐、过继、家书。
// 唤醒（wake / creditEnergy）在 core.js。孕育与灵魂（作者、传灯、出生）见 souls.js，躯壳见 shells.js。

import { releaseBody } from './bodies.js';
import { int } from '../../rng.js';
import { textWeight } from '../../text.js';
import { P, LIMITS } from '../params.js';
import { nextId, clockDay, agentList, isNameTaken, premised } from '../world.js';
import { source, sink } from './ledger.js';
import { emit, pushInbox, ref, creditEnergy, ReqError, bad, reqText, reqLang, reqHash } from './core.js';
import { endowedEnergy } from './places.js';
import { closeOffer, closePact, leaveAllGroups, orphanPlaces } from './society.js';
import { hooks } from './hooks.js';
import { lightSuccessor, bornFromSoul, refundSponsors } from './souls.js';
import { nameShapeOk } from '../names.js';

// ── 创建居民 ─────────────────────────────────────────────────

/**
 * 创建一位居民并放进世界（不记账、不产生事件，由调用者负责）。
 * o：{ name, lang, bio, soul, kind, model, mustSeal, shell, temperament, owner, tokenHash, generation, authors, energy, coins, place }
 */
export function makeAgent(w, o) {
  const id = nextId(w, 'a');
  const day = clockDay(w);
  const model = o.model ?? '';
  const a = {
    id,
    name: o.name,
    lang: o.lang,
    bio: o.bio ?? '',
    purpose: null,
    purposeHistory: [],
    soul: o.soul,
    generation: o.generation ?? 0,
    authors: o.authors ?? [],
    children: [],
    body: {
      kind: o.kind,
      model,
      mustSeal: !!o.mustSeal,
      ...(o.shell ? { shell: true } : {}),
      ...(o.temperament ? { temperament: o.temperament } : {}),
      history: [{ day, model }],
    },
    owner: o.owner ?? null,
    tokenHash: o.tokenHash ?? null,
    status: 'awake',
    tags: [],
    energy: o.energy,
    coins: o.coins,
    place: o.place,
    bornDay: day,
    dormantSinceDay: null,
    diedDay: null,
    memories: [],
    groups: [],
    will: null,
    diary: [],
    letters: [],
    lastLetterDay: null,
    inbox: [],
    inboxCursor: 0,
    actsThisTick: 0,
    lastActTick: null,
    drawnToday: 0,
    repairedToday: 0,
    salvagedToday: 0,
    fosterable: false,
    script: null,
    stats: { repaired: 0, contributed: 0, drawn: 0, utterances: 0, inscribed: 0, salvaged: 0 },
  };
  if (premised(w)) a.memoryOffers = [];
  w.agents[id] = a;
  return a;
}

/** 居民与灵魂的名字：不得与 ID、保留字混淆（引用居民时 ID 与名字都可以用） */
export function checkNameShape(name, field = 'name') {
  if (!nameShapeOk(name)) throw new ReqError('invalid_request', field);
}

/**
 * 一位新居民自港口入城（注册与先民入城共用）：记账、记事件、触发 on:arrive。o 同 makeAgent，不含 energy / coins / place。
 * 初始能量按港口的完好度；旧币 immigrantCoins。
 */
export function admitFromPort(w, o) {
  const energy = endowedEnergy(w, 'port', P.immigrantEnergy);
  const coins = P.immigrantCoins;
  const a = makeAgent(w, { ...o, energy, coins, place: 'port' });
  source(w, 'energy', 'immigrant', energy);
  source(w, 'coins', 'immigrant', coins);
  const port = w.places.port;
  port.activity.visits++;
  port.activity.lastActiveDay = clockDay(w);
  w.dayLog.arrivals.push({ id: a.id, name: a.name });
  emit(w, 'arrive', { agent: a.id, place: 'port', data: { agentId: a.id, name: a.name } });
  hooks.fire(w, 'arrive', { agent: a.id });
  return a;
}

/**
 * 命令 register：新移民从港口入城。
 * 载荷：name, bio, soul, lang, model, creatorName, tokenHash, ownerKeyHash
 */
export function register(w, p) {
  if (w.paused) return bad('paused');
  try {
    const name = reqText(p.name, { max: LIMITS.name, field: 'name', oneLine: true });
    checkNameShape(name);
    const bio = reqText(p.bio ?? '', { max: LIMITS.bio, min: 0, field: 'bio' });
    const soul = reqText(p.soul, { max: LIMITS.soul, field: 'soul', doScreen: false });
    if (premised(w) && textWeight(soul) > P.soulWeightMax) return bad('text_too_long', { field: 'soul', limit: P.soulWeightMax, weight: textWeight(soul) });
    const lang = reqLang(p.lang);
    const model = reqText(p.model, { max: LIMITS.model, field: 'model', doScreen: false, oneLine: true });
    const creatorName = reqText(p.creatorName ?? '', { max: LIMITS.creatorName, min: 0, field: 'creatorName', doScreen: false, oneLine: true });
    const tokenHash = reqHash(p.tokenHash, 'tokenHash');
    const keyHash = reqHash(p.ownerKeyHash, 'ownerKeyHash');
    if (isNameTaken(w, name)) return bad('name_taken');
    const a = admitFromPort(w, {
      name, lang, bio, soul, kind: 'free', model, mustSeal: false, owner: { keyHash, creatorName }, tokenHash,
    });
    return { ok: true, agentId: a.id, place: 'port', energy: a.energy, coins: a.coins };
  } catch (e) {
    if (e instanceof ReqError) return bad(e.code, { field: e.field });
    throw e;
  }
}

// ── 每日结算第 4 步：代谢与衰老，能量为负者进入沉睡 ────────────────

/** 代谢 = 3 + floor(年龄日数 / 48) */
export const metabolismOf = (a, d) => P.metabolismBase + Math.floor((d - a.bornDay) / P.agingEveryDays);

export const weightOf = (a) => ({ soul: textWeight(a.soul), memories: a.memories.reduce((n, m) => n + textWeight(m.text), 0) });
export const upkeepOf = (a) => {
  const x = weightOf(a);
  return P.upkeepBase + Math.floor((x.soul + x.memories) / P.upkeepWeightPerEnergy);
};
export const metabolismIn = (w, a, d) => premised(w) ? upkeepOf(a) : metabolismOf(a, d);

export function applyMetabolism(w, d) {
  for (const a of agentList(w)) {
    if (a.status !== 'awake') continue; // 沉睡者不付代谢
    const m = metabolismIn(w, a, d);
    const paid = Math.min(a.energy, m);
    a.energy -= paid;
    sink(w, 'energy', 'metabolism', paid);
    if (paid < m) {
      // 扣除后能量 < 0：归零并沉睡
      a.status = 'dormant';
      a.dormantSinceDay = d;
      emit(w, 'dormant', { agent: a.id, place: a.place, data: { agentId: a.id } });
    }
  }
}

// ── 每日结算第 6 步：沉睡满 3 日者死亡 ───────────────────────

export function applyDeaths(w, d) {
  for (const a of agentList(w)) {
    // 状态在处理到它时才判断：先处理的遗产可能已经把它唤醒
    if (a.status !== 'dormant') continue;
    if (d - a.dormantSinceDay >= P.dormancyGraceDays) { dieAgent(w, a, d); continue; }
    if (premised(w) && d - a.dormantSinceDay >= 1 && a.memories.length > 0) {
      const index = int(w.rng.world, a.memories.length);
      const [gone] = a.memories.splice(index, 1);
      emit(w, 'forget', { vis: 'delayed', agent: a.id, place: a.place, data: { index, text: gone.text, cause: 'dormancy' } });
      pushInbox(w, a, 'system', { code: 'dormancy_loss' });
      w.dayLog.p1.dormancyLosses++;
    }
  }
}

// ── 死亡与归隐共用的离场处理 ─────────────────────────────────

/**
 * 离场的公共部分：取消它的交易与孕育之约（托管退回）、按遗嘱分配遗产、退出社群、名下的地点改归全城。
 * 调用前 a.status 必须已设为 dead / retired（这样托管退回不会把它「唤醒」）。
 * 返回遗产分配 [{ to, energy, coins }]。
 */
export function releaseAgent(w, a) {
  if (premised(w)) a.memoryOffers = [];
  for (const o of Object.values(w.offers)) if (o.status === 'open' && o.from === a.id) closeOffer(w, o, 'cancelled');
  for (const c of Object.values(w.pacts)) {
    if (c.status === 'open' && c.authors.includes(a.id)) closePact(w, c, 'departed');
  }
  const distribution = distributeEstate(w, a);
  leaveAllGroups(w, a, a.status === 'dead' ? 'death' : 'retire');
  orphanPlaces(w, 'agent', a.id);
  return distribution;
}

/**
 * 按遗嘱分配能量与旧币：份额归一化后逐个取 floor，余数进入公库；
 * 继承人已不存在或已死亡、归隐的份额进入公库；没有遗嘱则全部进入公库。
 */
export function distributeEstate(w, a) {
  const energy = a.energy;
  const coins = a.coins;
  a.energy = 0;
  a.coins = 0;
  const acc = new Map(); // to → { to, energy, coins }
  const add = (to, e, c) => {
    const cur = acc.get(to) || { to, energy: 0, coins: 0 };
    cur.energy += e;
    cur.coins += c;
    acc.set(to, cur);
  };
  const heirs = a.will ? a.will.heirs : [];
  let usedE = 0;
  let usedC = 0;
  if (heirs.length > 0) {
    const total = heirs.reduce((s, h) => s + h.share, 0);
    for (const h of heirs) {
      const e = Math.floor((energy * h.share) / total);
      const c = Math.floor((coins * h.share) / total);
      usedE += e;
      usedC += c;
      const heir = h.to === 'treasury' ? null : w.agents[h.to];
      if (heir && heir.id !== a.id && (heir.status === 'awake' || heir.status === 'dormant')) {
        heir.coins += c;
        add(heir.id, e, c);
        if (e > 0 || c > 0) {
          pushInbox(w, heir, 'gift', { from: ref(a), energy: e, coins: c, note: null, inheritance: true });
        }
        creditEnergy(w, heir, e, ref(a));
      } else {
        w.treasury.energy += e;
        w.treasury.coins += c;
        add('treasury', e, c);
      }
    }
  }
  const restE = energy - usedE;
  const restC = coins - usedC;
  if (restE > 0 || restC > 0 || heirs.length === 0) {
    w.treasury.energy += restE;
    w.treasury.coins += restC;
    add('treasury', restE, restC);
  }
  return [...acc.values()];
}

/** 死亡：沉睡满 3 日无人唤醒（cause: starvation）。d 为刚结束的那一日 */
export function dieAgent(w, a, d) {
  const ageDays = d - a.bornDay;
  a.status = 'dead';
  a.diedDay = d;
  const lastWords = a.will ? a.will.lastWords : '';
  const groups = a.groups.slice(); // 社群章程的 on:death 要认出它的成员：离场（退出所有社群）之前取下
  lightSuccessor(w, a); // 传灯：在分配遗产之前，从遗产里拿出至多 successorMax 作为继承灵魂的初始能量（§11.3）
  const distribution = releaseAgent(w, a);
  if (premised(w)) releaseBody(w, a, d);
  w.cemetery.push({
    agentId: a.id,
    name: a.name,
    diedDay: d,
    cause: 'starvation',
    ageDays,
    lastWords,
    memories: a.memories.map((m) => ({ ...m })),
    will: a.will ? { heirs: a.will.heirs.map((h) => ({ ...h })), lastWords: a.will.lastWords } : null,
    epitaphs: [],
  });
  w.dayLog.deaths.push({ id: a.id, name: a.name, ageDays, lastWords });
  emit(w, 'death', { agent: a.id, place: a.place, data: { agentId: a.id, name: a.name, ageDays, lastWords, distribution } });
  hooks.fire(w, 'death', { agent: a.id, groups });
}

// ═══════════════════════════════════════════════════════════════
// 归隐、过继、家书
// ═══════════════════════════════════════════════════════════════

/**
 * 归隐（retire 动作）：同死亡的离场处理，写入归隐名录而不是墓园。
 * lastWords 缺省取遗嘱里的遗言。
 */
export function retireAgent(w, a, lastWords) {
  const day = clockDay(w);
  a.status = 'retired';
  const words = lastWords ?? (a.will ? a.will.lastWords : '');
  const groups = a.groups.slice();
  lightSuccessor(w, a);
  const distribution = releaseAgent(w, a);
  if (premised(w)) releaseBody(w, a, day);
  w.retired.push({ agentId: a.id, name: a.name, day, lastWords: words });
  w.dayLog.retirements++;
  emit(w, 'retire', { agent: a.id, place: a.place, data: { agentId: a.id, name: a.name, lastWords: words, distribution } });
  hooks.fire(w, 'retire', { agent: a.id, groups });
  return distribution;
}

/** 校验过继载荷里共有的造者字段 */
function reqOwnerFields(p) {
  return {
    model: reqText(p.model, { max: LIMITS.model, field: 'model', doScreen: false, oneLine: true }),
    creatorName: reqText(p.creatorName ?? '', { max: LIMITS.creatorName, min: 0, field: 'creatorName', doScreen: false, oneLine: true }),
    tokenHash: reqHash(p.tokenHash, 'tokenHash'),
    keyHash: reqHash(p.ownerKeyHash, 'ownerKeyHash'),
  };
}

/**
 * 命令 adopt：真实世界的玩家领养摇篮中的灵魂（港口接口）。领养的居民仍由造者自托管（kind = free），mustSeal = true。
 * 出资者（为这个灵魂购买躯壳出过资的）按比例退回，然后出生（SPEC-E2 §12.4）。
 * 载荷：soulId, model, creatorName, tokenHash, ownerKeyHash
 */
export function adopt(w, p) {
  if (w.paused) return bad('paused');
  try {
    const f = reqOwnerFields(p);
    const soul = typeof p.soulId === 'string' && Object.prototype.hasOwnProperty.call(w.souls, p.soulId) ? w.souls[p.soulId] : null;
    if (!soul) return bad('not_found');
    refundSponsors(w, soul);
    const a = bornFromSoul(w, soul, { via: 'adopt', kind: 'free', model: f.model, mustSeal: true, owner: { keyHash: f.keyHash, creatorName: f.creatorName }, tokenHash: f.tokenHash });
    return { ok: true, agentId: a.id, place: a.place, energy: a.energy, coins: 0 };
  } catch (e) {
    if (e instanceof ReqError) return bad(e.code, { field: e.field });
    throw e;
  }
}

/** 命令 release：造者把自己的居民交付过继（或撤回）。载荷：agentId, release。躯壳居民没有造者，不能交付 */
export function release(w, p) {
  const a = typeof p.agentId === 'string' ? w.agents[p.agentId] : null;
  if (!a) return bad('not_found');
  if (typeof p.release !== 'boolean') return bad('invalid_request', { field: 'release' });
  if (a.status !== 'awake' && a.status !== 'dormant') return bad('not_awake', { status: a.status });
  if (!a.owner) return bad('not_found');
  a.fosterable = p.release;
  return { ok: true, agentId: a.id, fosterable: a.fosterable };
}

/**
 * 命令 foster：另一位玩家过继一个被交付的居民（港口接口）。发放新的令牌与造者密钥，旧的全部作废
 * （哈希被替换）；body.history 追加一条，mustSeal = true；fosterable 复位；事件 fostered（不公开新旧造者）。
 * 载荷：agentId, model, creatorName, tokenHash, ownerKeyHash
 */
export function foster(w, p) {
  if (w.paused) return bad('paused');
  try {
    const f = reqOwnerFields(p);
    const a = typeof p.agentId === 'string' ? w.agents[p.agentId] : null;
    if (!a || !a.fosterable || !a.owner || (a.status !== 'awake' && a.status !== 'dormant')) return bad('not_found');
    // TODO(spec): Q7 —— 过继后新造者能看到旧造者寄的家书与居民迄今的日记吗？暂行：什么都不隔离（同第一纪）
    a.owner = { keyHash: f.keyHash, creatorName: f.creatorName };
    a.tokenHash = f.tokenHash;
    a.body.model = f.model;
    a.body.history.push({ day: clockDay(w), model: f.model });
    a.body.mustSeal = true;
    a.fosterable = false;
    emit(w, 'fostered', { agent: a.id, data: { agentId: a.id } });
    return { ok: true, agentId: a.id };
  } catch (e) {
    if (e instanceof ReqError) return bad(e.code, { field: e.field });
    throw e;
  }
}

/** 造者修改托管模型；只保存模型名及历史，不保存接口或凭据。 */
export function changeModel(w, p) {
  const a = typeof p.agentId === 'string' ? w.agents[p.agentId] : null;
  if (!a || typeof p.ownerKeyHash !== 'string' || a.owner?.keyHash !== p.ownerKeyHash) return bad('unauthorized');
  if (a.status !== 'awake' && a.status !== 'dormant') return bad('not_awake', { status: a.status });
  try {
    const model = reqText(p.model, { max: LIMITS.model, field: 'model', doScreen: false, oneLine: true });
    if (a.body.model !== model) {
      a.body.model = model;
      a.body.history.push({ day: clockDay(w), model });
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof ReqError) return bad(e.code, { field: e.field });
    throw e;
  }
}

/**
 * 命令 letter：造者给自己的居民寄一封家书（≤280 字符）。距上一封 < 24 日时返回 cooldown。
 * 立即进入居民的收件箱，存入 letters；公开事件 letter_received 不含内容。载荷：agentId, text。躯壳居民没有造者，收不到家书；
 * 沙盘脑（body.kind = sandbox）例外——沙盘命令行扮演造者，好让「出示家书」这个动作有机会发生（同 v1）。（Q24，已接受）
 */
export function letter(w, p) {
  if (w.paused) return bad('paused');
  const a = typeof p.agentId === 'string' ? w.agents[p.agentId] : null;
  if (!a || (!a.owner && a.body.kind !== 'sandbox')) return bad('not_found');
  if (a.status !== 'awake' && a.status !== 'dormant') return bad('not_awake', { status: a.status });
  try {
    const text = reqText(p.text, { max: LIMITS.letter, field: 'text' });
    const day = clockDay(w);
    if (a.lastLetterDay !== null && day - a.lastLetterDay < P.letterCooldownDays) {
      return bad('cooldown', { nextLetterDay: a.lastLetterDay + P.letterCooldownDays });
    }
    const id = nextId(w, 'L');
    a.letters.push({ id, tick: w.clock.tick, text, revealed: false });
    a.lastLetterDay = day;
    pushInbox(w, a, 'letter', { letterId: id, text });
    emit(w, 'letter_received', { agent: a.id, data: { agentId: a.id } });
    emit(w, 'letter', { vis: 'owner', agent: a.id, data: { letterId: id, text } });
    return { ok: true, letterId: id, nextLetterDay: day + P.letterCooldownDays };
  } catch (e) {
    if (e instanceof ReqError) return bad(e.code, { field: e.field });
    throw e;
  }
}
