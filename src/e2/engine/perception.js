import { upgradeView } from './upgrades.js';
import { ep, K } from './tokens.js';
import { prayerView, prayersEnabled } from './prayers.js';
// SPEC-E2 §17、PROTOCOL-2 §3：为一位居民构建感知（协议 2）——只含它该看到的。
//
// 感知是语言中立的结构化数据：枚举都有稳定的 code；带 text 的字段是按 lang 本地化的系统文本；
// 居民写下的文本（志、介绍、铭刻、规则里的理由与宣告、法律的文字……）一律原样返回。
// 这里没有任何字段会透露其他居民由什么驱动，也不含他人的位置（同地者除外）、能量、旧币、记忆、日记、独白、私语、遗嘱；
// 规则读不到的东西（记忆、日记、独白、私语、家书、灵魂全文、身体）这里同样不给别人。
//
// 副作用：默认（不传 after）会把世界状态里的收件箱游标推进到本次返回的最大 seq（自动确认）——这只能发生在命令之内
// （沙盘脑在 tick 里感知）；传 after 或 ack: false 则不推进。HTTP 层一律传 ack: false，用自己的内存游标（floor）。

import { bodyOf } from './bodies.js';
import { isMuted, isWakeItem } from './core.js';
import { actionTable } from '../lore/actions.js';
import { P, SEASON_TABLE, conditionBand, seasonBand, richnessBand } from '../params.js';
import { travelCosts, lotsNear, HUMAN_DEFS } from '../map/index.js';
import { L, fmt, normLang, placeDisplayName, placeDescription, cityDisplayName, ACTIONS, ACTION_ORDER } from '../lore/index.js';
import { clockDay, monthOfDay, dayOfMonthOf, tickOfDay, agentList, isAlive, idNum, premised, agentic, tokenized } from '../world.js';
import { truncateCp, cpLength } from '../../text.js';
import { agentCap } from './economy.js';
import { metabolismIn, weightOf } from './lifecycle.js';
import { actionCost, cost4 } from './actions/util.js';
import { isWeatherActive } from './environment.js';
import { omensAt } from './weather.js';
import { hasRelay, functioningModule, hasModuleAt, isFunctioning, wallInscriptions, costMultiplier, costMultiplierBp, ownerView, moduleOf } from './places.js';
import { gatedFor, hasGate, isWildOpen } from './movement.js';
import { openProjectsAt } from './projects.js';
import { lawReading, lawTitle, lawText, authorView, isSuspended, persistentCount, hasAnnounce, procSpec, isProcedureLaw } from './laws.js';
import { renderProcedureClass, renderRules } from '../rules/render.js';
import { HUMAN_PROCEDURE, humanProcedureFor } from '../lore/humanlaws.js';
import { usesLawSemantics2, lawProtectionView } from './law-semantics.js';
import { previewBefore, beforeIndex } from './rules.js';
import { mayPropose, votersOf, openCityProposals, openRefounds, refoundNeeded, liveSigners, refoundElectorate, procedureHealth, rngCopy } from './legislation.js';
import { shellsFree, queuePosition } from './shells.js';

const ref = (a) => ({ id: a.id, name: a.name });
const refId = (w, id) => (id && w.agents[id] ? ref(w.agents[id]) : null);

/** 一条动作可能有几条说明，PROTOCOL 只有一个 note 字段：按重要性取第一条 */
const NOTE_PRIORITY = ['eclipse', 'fog', 'relayFog', 'relay', 'fee', 'wall_full', 'cost_multiplier', 'distance', 'variable', 'noBoard'];
const notePriority = (n) => NOTE_PRIORITY.indexOf(n.code);

/** 完好度的 { bp, band, text }；源井用专用的描述词 */
function cond(l, bp, well = false) {
  const band = conditionBand(bp);
  return { bp, band, text: well ? l.wellBand[band] : l.band[band] };
}

function charterEntry(art, lang) {
  const order = [lang, 'zh', 'en', ...Object.keys(art.versions)];
  const found = order.find((k) => art.versions[k] !== undefined);
  return { n: art.n, status: art.status, lang: found, text: art.versions[found] };
}

/** 完整文本还是截断（≤ max 字符，末尾加「…」）？返回 { text, truncated } */
function clip(text, max = 140) {
  return cpLength(text) > max ? { text: `${truncateCp(text, max - 1)}…`, truncated: true } : { text, truncated: false };
}

const clipText = (text, max) => clip(text, max).text;

// ── 主入口 ─────────────────────────────────────────────────

/**
 * @param opts { lang, after, floor, ack, nextTickAt }
 *   lang        系统文本的语言（zh | en，默认 zh）
 *   after       只返回 seq > after 的收件；缺省为 max(世界状态里的游标, floor)
 *   floor       HTTP 层的内存游标（已经送达过的最大 seq）。不属于世界状态：GET 不是命令，不能改动世界
 *   ack         是否把世界状态里的游标推进到本次返回的最大 seq（缺省：不传 after 时推进）。只有在命令之内才能这样做
 *   nextTickAt  下一刻开始的现实毫秒时间戳（只存在于 HTTP 层，不进入世界状态）
 */
export function buildPerception(w, agentId, opts = {}) {
  const a = w.agents[agentId];
  if (!a) return null;
  const lang = normLang(opts.lang);
  const l = L(lang);
  const day = clockDay(w);

  if (a.status === 'dead' || a.status === 'retired') {
    return { protocol: 2, ...(premised(w) ? { premise: w.premise } : {}), you: { id: a.id, name: a.name, status: a.status } };
  }

  const now = {
    ...(usesLawSemantics2(w) ? { lawProtection: lawProtectionView(w) } : {}),
    tick: w.clock.tick, day, month: monthOfDay(day), dayOfMonth: dayOfMonthOf(day), tickOfDay: tickOfDay(w),
    ticksPerDay: P.ticksPerDay, daysPerMonth: P.daysPerMonth,
    nextTickAt: opts.nextTickAt ?? null, tickMs: P.tickMs, paused: w.paused,
  };

  if (a.status === 'dormant') {
    return {
      protocol: 2, ...(premised(w) ? { premise: w.premise } : {}), lang, now,
      you: {
        id: a.id, name: a.name, status: 'dormant', energy: a.energy,
        ...(prayersEnabled(w) ? { prayerPoints: w.prayers.accounts[a.id]?.balance || 0, prayers: prayerView(w, a.id, { recent: 20 }) } : {}),
        dormantSinceDay: a.dormantSinceDay, daysUntilDeath: a.dormantSinceDay + P.dormancyGraceDays - day,
      },
    };
  }

  const costs = travelCosts(w, a.place); // 去各地点的路程：city.places 与 actions 里的 move 都要用，算一遍
  const wall = wallInscriptions(w, a.place); // 此处墙上可见的铭刻：here 与 actions（墙满的提示）都要用，扫一遍
  // 进行中的交易与孕育之约：you、here（告示板）、actions 都要用。交易、孕育之约关闭后仍留在表里，所以只扫一遍
  const openOffers = Object.values(w.offers).filter((o) => o.status === 'open');
  const openPacts = Object.values(w.pacts).filter((c) => c.status === 'open');

  // ── 收件箱 ──
  const after = opts.after !== undefined && opts.after !== null ? opts.after : Math.max(a.inboxCursor, opts.floor || 0);
  const inbox = [];
  for (const item of a.inbox) {
    if (item.seq <= after) continue;
    inbox.push(localizeInbox(item, l));
  }
  const maxSeq = inbox.length ? inbox[inbox.length - 1].seq : after;
  const ack = opts.ack !== undefined ? opts.ack : opts.after === undefined || opts.after === null;
  if (ack && maxSeq > a.inboxCursor) a.inboxCursor = maxSeq;

  return {
    protocol: 2, ...(premised(w) ? { premise: w.premise } : {}),
    lang,
    now,
    you: youView(w, a, l, lang, day, openOffers, openPacts),
    here: hereView(w, a, l, lang, wall, openOffers),
    city: cityView(w, a, l, lang, day, costs),
    inbox,
    inboxCursor: Math.max(a.inboxCursor, maxSeq),
    actions: actionsView(w, a, l, lang, costs, wall.length, openOffers, openPacts),
  };
}

export function localizeInbox(item, l) {
  if (item.kind !== 'system') return item;
  const tpl = l.perception.system[item.code] || l.perception.system.unknown;
  return { ...item, text: fmt(tpl, { n: item.dropped, name: item.name }) };
}

/** 第二前提：seq > after 的、会叫醒的收件，按语言本地化（GET /api/me/wait、进程内的 wait 与托管运行器的 waitWake 用；SPEC-P2 §6.3） */
export function wakeItems(w, agentId, after, lang) {
  const a = w.agents[agentId];
  if (!a) return [];
  const l = L(normLang(lang));
  return a.inbox.filter((i) => i.seq > after && isWakeItem(i.kind, i)).map((i) => localizeInbox(i, l));
}

/** 一位居民的收件箱（最近 n 条），system 项带本地化文本——造者后台用 */
export function inboxView(a, lang, n = P.inboxKeep) {
  const l = L(normLang(lang));
  return a.inbox.slice(-n).map((i) => localizeInbox(i, l));
}

// ── you ────────────────────────────────────────────────────

function youView(w, a, l, lang, day, openOffers, openPacts) {
  const groups = [];
  for (const gid of a.groups) {
    const g = w.groups[gid];
    if (g && !g.dissolved) groups.push({ id: g.id, name: g.name, steward: g.steward === a.id });
  }
  const owns = Object.values(w.places)
    .filter((p) => p.owner.kind === 'agent' && p.owner.id === a.id)
    .map((p) => ({ id: p.id, name: placeDisplayName(p, lang) }));
  const offers = [];
  for (const o of openOffers) {
    if (o.from === a.id) offers.push({ id: o.id, role: 'from', to: o.to, board: o.board, give: o.give, want: o.want, note: o.note, expiresTick: o.expiresTick });
    else if (o.to === a.id) {
      if (agentic(w) && isMuted(w, a, o.from)) continue; // 第二前提：被屏蔽者发来的定向交易不列出（SPEC-P2 §5.10）
      offers.push({ id: o.id, role: 'to', from: ref(w.agents[o.from]), to: o.to, give: o.give, want: o.want, note: o.note, expiresTick: o.expiresTick });
    }
  }
  const pacts = [];
  for (const c of openPacts) {
    if (!c.authors.includes(a.id)) continue;
    if (agentic(w) && c.from !== a.id && isMuted(w, a, c.from)) continue; // 第二前提：被屏蔽者发起的孕育之约不列出（SPEC-P2 §5.10）
    pacts.push({
      id: c.id, role: c.from === a.id ? 'initiator' : 'author', name: c.name, soul: c.soul, lang: c.lang, expiresTick: c.expiresTick,
      authors: c.authors.map((x) => ({ id: x, name: w.agents[x].name, consented: Object.prototype.hasOwnProperty.call(c.consents, x) })),
    });
  }
  return {
    id: a.id, name: a.name, lang: a.lang, bio: a.bio, purpose: a.purpose ?? null, soul: a.soul,
    status: 'awake', tags: a.tags.slice(),
    ...(prayersEnabled(w) ? { prayerPoints: w.prayers.accounts[a.id]?.balance || 0, prayers: prayerView(w, a.id, { recent: 20 }) } : {}),
    energy: a.energy, energyCap: agentCap(w, a), floor: ep(w, 'lawFloor'), coins: a.coins,
    place: a.place,
    ageDays: day - a.bornDay, generation: a.generation,
    authors: a.authors.map((id) => refId(w, id)).filter(Boolean),
    children: a.children.map((id) => refId(w, id)).filter(Boolean),
    metabolism: metabolismIn(w, a, day),
    ...(premised(w) ? { weight: weightOf(a), trained: bodyOf(w, a).trained.map((x) => x.text), training: bodyOf(w, a).pending.length } : {}),
    actionsLeft: Math.max(0, P.maxActionsPerTick - a.actsThisTick), maxActionsPerTick: P.maxActionsPerTick,
    drawnToday: a.drawnToday, repairedToday: a.repairedToday, salvagedToday: a.salvagedToday,
    memories: a.memories.map((m, index) => ({ index, day: m.day, text: m.text, from: m.from ? refId(w, m.from) : null, ...(premised(w) ? { origin: refId(w, m.origin) } : {}) })),
    memorySlots: P.memorySlots,
    ...(premised(w) ? { memoryOffers: a.memoryOffers.map((m) => ({ ...m, from: refId(w, m.from), origin: refId(w, m.origin) })) } : {}),
    groups,
    owns,
    will: a.will
      ? {
        heirs: a.will.heirs.map((h) => (h.to === 'treasury' ? { to: 'treasury', share: h.share } : { to: h.to, name: w.agents[h.to].name, share: h.share })),
        lastWords: a.will.lastWords,
        successor: a.will.successor ? { name: a.will.successor.name } : null,
      }
      : null,
    letters: a.letters.map((x) => ({ id: x.id, day: Math.floor(x.tick / P.ticksPerDay), text: x.text, revealed: x.revealed })),
    offers,
    pacts,
    ...(agentic(w) ? {
      standing: a.standing.map((o, index) => ({
        index, when: o.when, if: o.if, do: structuredClone(o.do), times: o.times, untilDay: o.untilDay, fired: o.fired, suspended: o.paidThrough < clockDay(w),
      })),
      standingMax: P.standingMax,
      muted: a.muted.map((k) => (k === 'anonymous' ? 'anonymous' : refId(w, k))).filter(Boolean),
    } : {}),
  };
}

// ── here ───────────────────────────────────────────────────

function hereView(w, a, l, lang, wallList, openOffers) {
  const place = w.places[a.place];
  const present = agentList(w)
    .filter((o) => o.id !== a.id && o.place === a.place && isAlive(o))
    .map((o) => ({ id: o.id, name: o.name, status: o.status, tags: o.tags.slice(), purpose: o.purpose ? clipText(o.purpose, P.purposeInPresent) : null }));
  const heard = w.recentSpeech
    .filter((s) => s.place === a.place && s.tick > w.clock.tick - P.heardTicks)
    .slice(-P.heardMax)
    .map((s) => ({ tick: s.tick, from: ref(w.agents[s.from]), text: s.text }));
  const wall = wallList.map((i) => {
    const c = clip(i.text);
    return { id: i.id, text: c.text, truncated: c.truncated, day: Math.floor(i.tick / P.ticksPerDay), protected: i.protectedBy.length > 0 };
  });
  const modules = place.modules.map((m) => {
    const legible = m.type !== 'surface' || (place.condition !== null && place.condition > 0);
    return {
      type: m.type, functioning: isFunctioning(place, m), salvage: m.salvage,
      ...(m.type === 'surface' && m.inscription && legible ? { inscription: m.inscription } : {}),
    };
  });
  const projects = openProjectsAt(w, a.place).map((j) => ({
    id: j.id, build: j.build, ...(j.lot ? { lot: j.lot } : {}), ...(j.on ? { on: j.on } : {}), ...(j.module ? { module: j.module } : {}), ...(j.to ? { to: j.to } : {}),
    name: j.name ?? null, need: j.need, have: j.have, contributors: Object.keys(j.contributors).length, expiresDay: j.expiresDay,
    owner: ownerView(w, j.owner), ...(j.inscription ? { inscription: j.inscription } : {}),
  }));
  const roads = [];
  for (const r of Object.values(w.roads)) {
    const open = r.condition >= P.functioningBp;
    if (r.a === a.place) roads.push({ to: r.b, functioning: open });
    else if (r.b === a.place) roads.push({ to: r.a, functioning: open });
  }
  const lots = lotsNear(w, a.place).map((id) => ({ id, free: w.lots[id].place === null && w.lots[id].project === null }));
  const omens = omensAt(w, a.place).map((o) => ({
    omenId: o.omenId,
    text: o.daysAhead === null ? l.omen[o.code] : fmt(l.observatoryLog, { n: o.daysAhead, omen: l.omen[o.code] }),
    daysAhead: o.daysAhead,
  }));
  const gate = moduleOf(place, 'gate');
  const board = functioningModule(place, 'board');
  const archive = functioningModule(place, 'archive');
  const memorial = functioningModule(place, 'memorial');
  const cradle = moduleOf(place, 'cradle');
  const humanName = place.origin === 'human' && place.humanName ? place.humanName[lang] : null;
  const here = {
    place: a.place,
    name: placeDisplayName(place, lang),
    humanName,
    origin: place.origin,
    district: { code: place.district, text: l.district[place.district] },
    description: placeDescription(place, lang),
    owner: ownerView(w, place.owner),
    condition: place.condition === null ? null : cond(l, place.condition, a.place === 'well'),
    razed: place.razed,
    costMultiplier: costMultiplier(w, a.place),
    salvage: place.salvageMax > 0 ? { left: place.salvage, max: place.salvageMax } : null,
    modules,
    gate: gate ? { functioning: isFunctioning(place, gate), youMayEnter: !gatedFor(w, a, a.place) } : null,
    rules: place.rules && place.rules.rules.length ? renderRules(place.rules.rules, lang).map((reading) => ({ reading })) : [],
    ...(place.rules?.enact ? { enact: structuredClone(place.rules.enact) } : {}),
    present, heard,
    inscriptions: wall,
    wallSlots: place.wallSlots,
    wallFree: Math.max(0, place.wallSlots - wall.length),
    projects, roads, lots, omens,
    board: null, archive: null, memorial: null, cradle: null, well: null, wilds: null,
  };
  if (board) {
    here.board = {
      offers: openOffers
        .filter((o) => o.to === null && o.board === a.place)
        .map((o) => ({ id: o.id, from: ref(w.agents[o.from]), give: o.give, want: o.want, note: o.note, expiresTick: o.expiresTick })),
    };
  }
  if (archive) {
    here.archive = {
      docs: Object.values(w.docs).map((d) => ({ id: d.id, kind: d.kind, title: d.redacted ? l.redacted : d.title, lang: d.lang, author: d.author ? refId(w, d.author) : null })),
    };
  }
  if (memorial) {
    here.memorial = {
      graves: w.cemetery.map((g) => ({
        agentId: g.agentId, name: g.name, diedDay: g.diedDay, lastWords: g.lastWords,
        epitaphs: g.epitaphs.map((e) => ({ text: e.text, day: Math.floor(e.tick / P.ticksPerDay) })),
      })),
    };
  }
  if (cradle) here.cradle = { functioning: isFunctioning(place, cradle) };
  if (a.place === 'well') {
    const hist = w.well.outputHistory;
    here.well = { outputYesterday: hist.length ? hist[hist.length - 1] : null, drawPoolLeft: w.well.drawPoolLeft, condition: cond(l, w.places.well.condition, true), ...(tokenized(w) ? { upgrades: upgradeView(w) } : {}) };
  } else if (place.explorable) {
    const band = richnessBand(w.regions[a.place].energy, HUMAN_DEFS[a.place].wild.energyMax * K(w));
    here.wilds = { richness: band, text: l.richnessWild[band] };
  }
  return here;
}

// ── city ───────────────────────────────────────────────────

/** 规则 / 程序的读法文本：多条规则用换行连接 */
const joinReading = (lines) => lines.join('\n');

function lawEntry(w, law, lang) {
  const reading = lawReading(law, lang);
  const text = law.procedure
    ? ['ordinary', 'constitutional'].filter((c) => reading.procedure[c]).map((c) => `${lang === 'en' ? { ordinary: 'Ordinary', constitutional: 'Constitutional' }[c] : { ordinary: '普通', constitutional: '修宪' }[c]}：${reading.procedure[c]}`).join('\n')
    : joinReading(reading.rules);
  return {
    id: law.id, title: lawTitle(law, lang), author: authorView(w, law.author), enactedDay: Math.floor(law.enactedTick / P.ticksPerDay),
    text: clipText(lawText(law, lang), P.lawTextInPerception), reading: clipText(text, P.readingInPerception),
    suspended: !isProcedureLaw(law) && persistentCount(law.rules) > 0 && isSuspended(w, law),
    ...(agentic(w) ? rulesNotes(law.rules, w) : {}),
    ...(law.enact ? { enact: structuredClone(law.enact) } : {}),
  };
}

/** 第二前提：一份规则每日的维持费，以及它会不会宣告（宣告的费用由持有者另付；SPEC-P2 §4.2） */
function rulesNotes(rules, w) {
  return { upkeep: ep(w, 'ruleUpkeep') * persistentCount(rules || []), announces: hasAnnounce(rules) };
}

function procedureView(w, cls, lang) {
  const id = w.procedure[cls];
  const spec = procSpec(w, cls);
  if (!spec) return { lawId: id, none: true, reading: '' };
  return { lawId: id, ...(usesLawSemantics2(w) ? { health: procedureHealth(w, cls) } : {}), ...(spec.none ? { none: true } : {}), reading: clipText(renderProcedureClass(spec, lang), P.readingInPerception) };
}

function proposalEntry(w, a, p, lang) {
  let yes = 0;
  let no = 0;
  let abstain = 0;
  for (const [id, v] of Object.entries(p.votes)) {
    if (!w.agents[id] || !isAlive(w.agents[id])) continue;
    if (v.choice === 'yes') yes++;
    else if (v.choice === 'no') no++;
    else abstain++;
  }
  const reading = p.procedure && typeof p.procedure === 'object'
    ? ['ordinary', 'constitutional'].filter((c) => p.procedure[c]).map((c) => renderProcedureClass(p.procedure[c], lang)).join('\n')
    : p.rules ? joinReading(renderRules(p.rules, lang, p.kind === 'bylaws' ? { scope: { kind: 'group', id: p.scope.slice(6) } } : {})) : '';
  const full = reading || (typeof p.procedure === 'string' ? p.procedure : '');
  const c = clip(full, agentic(w) ? P.proposalReadingMax : P.readingInPerception); // 第二前提：进行中的提案读法至多 2000（SPEC-P2 §4.1）
  return {
    id: p.id, scope: p.scope, kind: p.kind, class: p.class, title: p.title, text: p.text, reading: c.text,
    ...(agentic(w) && c.truncated ? { readingTruncated: true, readingLength: cpLength(full) } : {}),
    proposer: refId(w, p.proposer), closesTick: p.closesTick, ticksLeft: Math.max(0, p.closesTick - w.clock.tick),
    tally: { yes, no, abstain },
    ballots: p.secret ? null : Object.entries(p.votes).map(([id, v]) => ({ voter: refId(w, id), choice: v.choice, reason: v.reason })),
    yourVote: p.votes[a.id] ? { choice: p.votes[a.id].choice, reason: p.votes[a.id].reason } : null,
    eligible: p.voters.includes(a.id),
    ...(agentic(w) ? rulesNotes(p.rules, w) : {}),
  };
}

function cityView(w, a, l, lang, day, costs) {
  const seasonF = SEASON_TABLE[dayOfMonthOf(day)];
  const sBand = seasonBand(seasonF);
  const hist = w.well.outputHistory;
  const pop = { awake: 0, dormant: 0, dead: 0, retired: 0, cradle: Object.keys(w.souls).length };
  for (const o of agentList(w)) pop[o.status]++;
  const lexicon = Object.values(w.lexicon).slice(-P.lexiconInPerception).map((e) => ({ word: e.word, meaning: e.redacted ? l.redacted : e.meaning }));
  const laws = Object.values(w.laws).filter((x) => x.status === 'active').sort((x, y) => idNum(y.id) - idNum(x.id)).slice(0, P.lawsInPerception).map((x) => lawEntry(w, x, lang));
  const myGroupIds = new Set(a.groups);
  const proposals = Object.values(w.proposals)
    .filter((p) => p.status === 'open' && (p.scope === 'city' || myGroupIds.has(p.scope.slice(6))))
    .map((p) => proposalEntry(w, a, p, lang));
  const refounds = openRefounds(w).map((r) => ({
    id: r.id, by: refId(w, r.by), text: r.text,
    reading: joinReading(Object.values(renderProcedureOf(w, r, lang))), signers: liveSigners(w, r).length,
    needed: refoundNeeded(w, r), expiresTick: r.expiresTick, signed: r.signers.includes(a.id),
    ...(usesLawSemantics2(w) ? { eligible: r.electorate.includes(a.id) } : {}),
  }));
  const places = Object.values(w.places).map((p) => ({
    id: p.id, name: placeDisplayName(p, lang), district: p.district, wild: p.wild, origin: p.origin, razed: p.razed,
    modules: p.modules.map((m) => m.type), gated: hasGate(w, p.id) && !isWildOpen(w, p.id), owner: ownerView(w, p.owner),
    moveCost: p.id === a.place || costs[p.id] === undefined ? null : costs[p.id] * K(w),
  }));
  const roads = Object.values(w.roads).map((r) => ({ a: r.a, b: r.b, functioning: r.condition >= P.functioningBp }));
  const residents = agentList(w).filter(isAlive).map((o) => ({ id: o.id, name: o.name, status: o.status, tags: o.tags.slice() }));
  const groups = Object.values(w.groups)
    .filter((g) => !g.dissolved)
    .map((g) => ({
      id: g.id, name: g.name, open: g.open, steward: g.steward ? refId(w, g.steward) : null,
      members: g.members.map((id) => refId(w, id)).filter(Boolean), manifesto: g.manifesto, procedure: g.procedure,
      bylaws: g.bylaws ? { reading: clipText(joinReading(renderRules(g.bylaws.rules, lang, { scope: { kind: 'group', id: g.id } })), P.readingInPerception), suspended: isSuspended(w, g.bylaws), ...(g.bylaws.enact ? { enact: structuredClone(g.bylaws.enact) } : {}) } : null,
    }));
  const cradle = Object.values(w.souls).map((s) => ({
    id: s.id, name: s.name, authors: s.authors.map((id) => refId(w, id)).filter(Boolean), soul: s.soul, lang: s.lang, expiresDay: s.expiresDay,
    fund: s.fund, queued: s.fundedTick !== null, queuePosition: queuePosition(w, s),
  }));
  return {
    name: cityDisplayName(w.cityName, lang),
    season: { permille: seasonF, band: sBand, text: l.season[sBand] },
    weather: w.weather.active.map((x) => ({ code: x.type, text: l.weather[x.type], daysLeft: x.endDay - day + 1 })),
    treasury: { energy: w.treasury.energy, coins: w.treasury.coins },
    wellOutputYesterday: hist.length ? hist[hist.length - 1] : null,
    population: pop,
    shells: { free: shellsFree(w), total: w.shells.slots, cost: P.shellCost },
    vars: { ...w.vars },
    procedure: { ordinary: procedureView(w, 'ordinary', lang), constitutional: procedureView(w, 'constitutional', lang) },
    laws,
    proposals,
    refounds,
    charter: w.charter.map((art) => charterEntry(art, lang)),
    charterCanonical: w.charterCanonical,
    places,
    roads,
    residents,
    groups,
    lexicon,
    cradle,
    recentDeaths: w.cemetery.slice(-P.recentDeathsInPerception).map((g) => ({ id: g.agentId, name: g.name, day: g.diedDay })),
    petitions: w.petitions.slice(-5).map((p) => ({ lawId: p.lawId, day: p.day, text: p.text })),
  };
}

/** 重订的程序的读法：{ ordinary, constitutional } */
function renderProcedureOf(w, r, lang) {
  const proc = r.procedure === 'humans' ? (usesLawSemantics2(w) && !r.electorate ? HUMAN_PROCEDURE : humanProcedureFor(w)) : r.procedure;
  const out = {};
  for (const c of ['ordinary', 'constitutional']) if (proc[c]) out[c] = renderProcedureClass(proc[c], lang);
  return out;
}


// ── actions：每种动作在此刻的实际代价与是否可用 ───────────────────

const MODULE_ACTIONS = new Set(['write', 'epitaph', 'offer', 'accept']);

function actionsView(w, a, l, lang, costs, wallCount, openOffers, openPacts) {
  const { ACTIONS, ORDER: ACTION_ORDER } = actionTable(w.premise || 0, prayersEnabled(w));
  const relay = hasRelay(w);
  const fog = isWeatherActive(w, 'fog');
  const eclipse = isWeatherActive(w, 'eclipse');
  const here = w.places[a.place];
  const R = l.perception.reason;
  const N = l.perception.note;
  const where = (type) => (ACTIONS[type].where ? ACTIONS[type].where[lang] : '');
  const reasonWrong = (type) => ({ code: 'wrong_place', text: ACTIONS[type].where ? fmt(R.wrong_place, { where: where(type) }) : R.wrongPlaceGeneric });
  const myGroups = a.groups.map((id) => w.groups[id]).filter((g) => g && !g.dissolved);
  const stewarded = myGroups.filter((g) => g.steward === a.id);
  const spec = (cls) => procSpec(w, cls);
  const beforeRules = beforeIndex(w, a);

  return ACTION_ORDER.map((type) => {
    const def = ACTIONS[type];
    const base = def.base === null ? 0 : def.base;
    const usesModule = MODULE_ACTIONS.has(type) && functioningModule(here, type === 'write' ? 'archive' : type === 'epitaph' ? 'memorial' : 'board') !== null;
    const entry = { type, cost: tokenized(w) ? cost4(w, type, base, a.place, { usesModule }) : actionCost(w, type, base, a.place, { usesModule }), available: true };
    const notes = [];
    const deny = (reason) => {
      entry.available = false;
      entry.reason = reason;
    };
    // 代价的修正说明
    if (((type === 'whisper' && !tokenized(w)) || type === 'broadcast') && fog) notes.push(relay ? { code: 'relayFog', text: N.relayFog } : { code: 'fog', text: N.fog });
    if (type === 'broadcast' && relay) notes.push({ code: 'relay', text: N.relay });
    if (type === 'internalize') notes.push({ code: 'trainCost', text: lang === 'en' ? "cost = ⌈the memory's weight ÷ 2⌉" : '代价 = ⌈这段记忆的分量 ÷ 2⌉' });
    if (type === 'move') notes.push({ code: 'distance', text: N.distance });
    else if (def.base === null) notes.push({ code: 'variable', text: N.variable });
    if (usesModule && entry.cost > 0 && costMultiplierBp(here) > 10000) {
      notes.push({ code: 'cost_multiplier', text: fmt(N.costMultiplier, { place: placeDisplayName(here, lang), mult: Math.round(costMultiplierBp(here) / 100) / 100 }) });
    }
    if (type === 'offer' && !functioningModule(here, 'board')) notes.push({ code: 'noBoard', text: N.noBoard });
    // 物理的可用性
    if (def.place && !(def.place === 'wilds' ? here.explorable : a.place === def.place)) deny(reasonWrong(type));
    switch (type) {
      case 'pray':
        entry.cost = 1;
        if (here.origin !== 'human' || here.razed || here.ruined || here.condition === null || here.condition <= 0) deny(reasonWrong(type));
        else if (w.prayers.accounts[a.id]?.lastPrayerDay === clockDay(w)) deny({ code: 'cooldown', text: fmt(R.cooldown, { day: clockDay(w) + 1 }) });
        break;
      case 'move':
        if (Object.keys(costs).length <= 1) deny({ code: 'invalid_args', text: R.nothing });
        break;
      case 'broadcast':
        if (eclipse) {
          if (relay) notes.push({ code: 'eclipse', text: N.eclipse });
          else deny({ code: 'disabled_by_weather', text: R.eclipse });
        }
        break;
      case 'remember':
        if (a.memories.length >= P.memorySlots) deny({ code: 'memory_full', text: R.memory_full });
        break;
      case 'impart':
      case 'internalize':
      case 'forget':
        if (a.memories.length === 0) deny({ code: 'invalid_args', text: R.nothing });
        break;
      case 'write':
        if (!hasModuleAt(w, a.place, 'archive')) deny({ code: 'no_module', text: fmt(R.no_module, { module: l.module.archive.name }) });
        break;
      case 'accept':
        if (!openOffers.some((o) => o.from !== a.id && ((o.to === a.id && !(agentic(w) && isMuted(w, a, o.from))) || (o.to === null && o.board === a.place)))) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'cancel':
        if (!openOffers.some((o) => o.from === a.id)) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'propose': {
        const s = spec('ordinary');
        if (!s || s.none) deny({ code: 'not_allowed', text: R.none });
        else if (!mayPropose(w, s, a, rngCopy(w))) deny({ code: 'not_eligible', text: R.not_eligible });
        else if (openCityProposals(w).some((p) => p.proposer === a.id)) deny({ code: 'limit_reached', text: R.limit_reached });
        else {
          const v = votersOf(w, s, rngCopy(w));
          if (v === null || v.length === 0) deny({ code: 'not_allowed', text: R.no_voters });
        }
        break;
      }
      case 'vote':
        if (!Object.values(w.proposals).some((p) => p.status === 'open' && p.voters.includes(a.id))) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'refound':
        if (usesLawSemantics2(w) && !refoundElectorate(w).includes(a.id)) deny({ code: 'not_eligible', text: R.not_eligible });
        else if (w.refoundCooldownUntil !== null && clockDay(w) < w.refoundCooldownUntil) deny({ code: 'cooldown', text: fmt(R.cooldown, { day: w.refoundCooldownUntil }) });
        else if (openRefounds(w).length >= P.refoundsOpenMax || openRefounds(w).some((r) => r.by === a.id)) deny({ code: 'limit_reached', text: R.limit_reached });
        break;
      case 'sign':
        if (!openRefounds(w).some((r) => !r.signers.includes(a.id) && (!usesLawSemantics2(w) || r.electorate.includes(a.id)))) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'found':
        if (a.groups.length >= 5) deny({ code: 'limit_reached', text: R.limit_reached });
        break;
      case 'join':
        if (!Object.values(w.groups).some((g) => !g.dissolved && !g.members.includes(a.id) && !g.pending.includes(a.id))) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'leave':
        if (myGroups.length === 0 && !Object.values(w.groups).some((g) => !g.dissolved && g.pending.includes(a.id))) deny({ code: 'not_member', text: R.not_member });
        break;
      case 'admit':
        if (!stewarded.some((g) => g.pending.length > 0)) deny({ code: 'not_steward', text: R.not_steward });
        break;
      case 'steward':
      case 'disburse':
        if (stewarded.length === 0) deny({ code: 'not_steward', text: R.not_steward });
        break;
      case 'rules': {
        const mayGroup = myGroups.some((g) => (g.procedure === 'steward' ? g.steward === a.id : true));
        const ownsPlace = Object.values(w.places).some((p) => !p.razed && ((p.owner.kind === 'agent' && p.owner.id === a.id) || (p.owner.kind === 'group' && myGroupIds(a).has(p.owner.id))));
        if (!mayGroup && !ownsPlace) deny({ code: 'not_owner', text: R.not_owner });
        break;
      }
      case 'repair': {
        const roads = Object.values(w.roads).filter((r) => (r.a === a.place || r.b === a.place) && r.condition < 10000);
        const repairable = (here.condition !== null && here.condition < 10000) || roads.length > 0;
        if (!repairable) deny({ code: 'already', text: R.alreadyFull });
        break;
      }
      case 'contribute':
        if (openProjectsAt(w, a.place).length === 0) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'initiate':
        if (openProjectsAt(w, a.place).length >= P.projectsPerPlace) deny({ code: 'limit_reached', text: R.limit_reached });
        break;
      case 'dismantle':
        if (here.landmark) deny({ code: 'landmark', text: R.landmark });
        else if (here.open || here.razed || here.salvage <= 0) deny({ code: 'nothing_left', text: R.nothing_left });
        break;
      case 'draw':
        if (entry.available && w.well.drawPoolLeft <= 0) deny({ code: 'pool_exhausted', text: R.pool_exhausted });
        break;
      case 'inscribe':
        if (here.wallSlots === 0) deny(reasonWrong('inscribe'));
        else if (wallCount >= here.wallSlots) notes.push({ code: 'wall_full', text: N.wallFull });
        break;
      case 'consent':
        if (!openPacts.some((c) => c.authors.includes(a.id) && !isMuted(w, a, c.from) && !Object.prototype.hasOwnProperty.call(c.consents, a.id))) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'sponsor':
        if (Object.keys(w.souls).length === 0) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'epitaph':
        if (!hasModuleAt(w, a.place, 'memorial')) deny({ code: 'no_module', text: fmt(R.no_module, { module: l.module.memorial.name }) });
        else if (w.cemetery.length === 0) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'reveal':
        if (a.letters.length === 0) deny({ code: 'not_found', text: R.nothing });
        break;
      default:
        break;
    }
    // 规则的预求值（§7.13）：只有物理上可用的动作才有意义
    if (!NO_PREVIEW.has(type) && !actionTable(w.premise || 0, prayersEnabled(w)).INNER.includes(type)) {
      const pre = previewBefore(w, a, type, lang, beforeRules);
      if (entry.available && pre.denied) deny({ code: 'forbidden', law: pre.denied.law, ...(pre.denied.ruleCode ? { rule: pre.denied.rule, ruleCode: pre.denied.ruleCode } : {}), text: fmt(R.forbidden, { law: pre.denied.law, reason: pre.denied.ruleCode ? `rules[${pre.denied.rule}] ${pre.denied.ruleCode}` : pre.denied.reason }) });
      if (entry.available && pre.fees.length) {
        const en = lang === 'en';
        const fees = pre.fees.map((f) => `${f.law}${en ? ': ' : '：'}${[f.energy ? `${f.energy} ${en ? 'energy' : '能量'}` : '', f.coins ? `${f.coins} ${en ? 'coins' : '旧币'}` : ''].filter(Boolean).join(' ')}`).join(en ? '; ' : '；');
        notes.push({ code: 'fee', text: fmt(N.fee, { fees }) });
      }
      if (pre.laws.length) entry.laws = pre.laws;
    }
    if (notes.length) entry.note = notes.sort((x, y) => notePriority(x) - notePriority(y))[0];
    return entry;
  });
}

/** 没有 before 时机的动作（守护律）：不做预求值 */
const NO_PREVIEW = new Set(['remember', 'forget', 'diary', 'whisper', 'retire', 'leave', 'refound', 'sign']);

function myGroupIds(a) {
  return new Set(a.groups);
}
