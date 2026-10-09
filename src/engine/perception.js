import { filterValues, tailRecordValues } from '../collections.js';
// SPEC-M1 §9.1、PROTOCOL §3：为一个 agent 构建感知——只含它该看到的。
//
// 感知是语言中立的结构化数据：枚举都有稳定的 code；带 text 的字段是按 lang 本地化的系统文本；
// agent 写下的文本一律原样返回。这里没有任何字段会透露其他 agent 由什么模型驱动，
// 也不含其他 agent 的位置、能量、旧币、记忆、日记、独白、私语、遗嘱。
//
// 副作用：默认（不传 after）会把世界状态里的收件箱游标推进到本次返回的最大 seq（自动确认）——
// 这只能发生在命令之内（沙盘脑在 tick 里感知）；传 after 或 ack: false 则不推进。
// HTTP 层一律传 ack: false，用自己的内存游标（floor）做「自动确认」，见 docs/QUESTIONS.md Q9。

import { P, LAW_PARAM_NAMES, SEASON_TABLE, conditionBand, seasonBand, richnessBand } from '../params.js';
import { placeIdsOf, isWild, wildIdsOf, wildPool, wildSpec, districtOf, usesDistance } from '../map/index.js';
import { L, fmt, normLang, placeDisplayName, cityDisplayName, ACTIONS, ACTION_ORDER } from '../lore/index.js';
import { clockDay, monthOfDay, dayOfMonthOf, tickOfDay, agentList, isAlive } from '../world.js';
import { truncateCp, cpLength } from '../text.js';
import { agentCap } from './economy.js';
import { metabolismOf } from './lifecycle.js';
import { actionCost } from './actions/util.js';
import {
  costMultiplier, costMultiplierBp, isFunctioning, facilitiesAt, wallInscriptions, openProjectsAt,
  hasRelay, isWeatherActive, travelCosts, placeCost,
} from './environment.js';
import { describeEffect, isCitizen, inElectorate, openProposals } from './laws.js';
import { omensAt } from './weather.js';

const ref = (a) => ({ id: a.id, name: a.name });

/** 一条动作可能有几条说明，PROTOCOL 只有一个 note 字段：按重要性取第一条 */
const NOTE_PRIORITY = ['eclipse', 'fog', 'relayFog', 'relay', 'wall_full', 'cost_multiplier', 'variable'];
const notePriority = (n) => NOTE_PRIORITY.indexOf(n.code);

/** 完好度的 { bp, band, text }；源井用专用的描述词 */
function cond(l, bp, well = false) {
  const band = conditionBand(bp);
  return { bp, band, text: well ? l.wellBand[band] : l.band[band] };
}

function ownerView(w, o) {
  if (o.kind === 'city') return { kind: 'city' };
  if (o.kind === 'group') return { kind: 'group', id: o.id, name: w.groups[o.id] ? w.groups[o.id].name : o.id };
  return { kind: 'agent', id: o.id, name: w.agents[o.id] ? w.agents[o.id].name : o.id };
}

/**
 * 宪章里某一条在 lang 下的文本；缺该语言版本时依次回落到 zh、en、任意一种。
 * TODO(spec): Q8 —— 感知里的宪章用哪种语言的版本（暂按请求的 lang）
 */
function charterEntry(art, lang) {
  const order = [lang, 'zh', 'en', ...Object.keys(art.versions)];
  const found = order.find((k) => art.versions[k] !== undefined);
  return { n: art.n, status: art.status, lang: found, text: art.versions[found] };
}

/** 完整文本还是截断（≤ 140 字符）？返回 { text, truncated } */
function clip(text, max = 140) {
  return cpLength(text) > max ? { text: truncateCp(text, max), truncated: true } : { text, truncated: false };
}

// ── 主入口 ─────────────────────────────────────────────────

/**
 * @param opts { lang, after, floor, ack, nextTickAt }
 *   lang        系统文本的语言（zh | en，默认 zh）
 *   after       只返回 seq > after 的收件；缺省为 max(世界状态里的游标, floor)
 *   floor       HTTP 层的内存游标（已经送达过的最大 seq）。不属于世界状态：GET 不是命令，不能改动世界（Q9）
 *   ack         是否把世界状态里的游标推进到本次返回的最大 seq（缺省：不传 after 时推进）。
 *               只有在命令之内（沙盘脑在 tick 里感知）才能这样做；HTTP 层一律传 ack: false
 *   nextTickAt  下一刻开始的现实毫秒时间戳（只存在于 HTTP 层，不进入世界状态）
 */
export function buildPerception(w, agentId, opts = {}) {
  const a = w.agents[agentId];
  if (!a) return null;
  const lang = normLang(opts.lang);
  const l = L(lang);
  const day = clockDay(w);

  if (a.status === 'dead' || a.status === 'retired') {
    return { protocol: 1, you: { id: a.id, name: a.name, status: a.status } };
  }

  const now = {
    tick: w.clock.tick, day, month: monthOfDay(day), dayOfMonth: dayOfMonthOf(day), tickOfDay: tickOfDay(w),
    ticksPerDay: P.ticksPerDay, daysPerMonth: P.daysPerMonth,
    nextTickAt: opts.nextTickAt ?? null, tickMs: P.tickMs, paused: w.paused,
  };

  if (a.status === 'dormant') {
    return {
      protocol: 1, lang, now,
      you: {
        id: a.id, name: a.name, status: 'dormant', energy: a.energy,
        dormantSinceDay: a.dormantSinceDay, daysUntilDeath: a.dormantSinceDay + P.dormancyGraceDays - day,
      },
    };
  }

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

  // TODO(spec): Q60 — these read-only tables are shared only within this perception.
  const query = {
    agents: agentList(w), wall: wallInscriptions(w, a.place), proposals: openProposals(w),
    offers: filterValues(w.offers, o => o.status === 'open', w.counters.o),
    pacts: filterValues(w.pacts, c => c.status === 'open', w.counters.c),
  };

  return {
    protocol: 1,
    lang,
    now,
    you: youView(w, a, day, query),
    here: hereView(w, a, l, lang, query),
    city: cityView(w, a, l, lang, day, query),
    inbox,
    inboxCursor: Math.max(a.inboxCursor, maxSeq),
    actions: actionsView(w, a, l, lang, query),
  };
}

function localizeInbox(item, l) {
  if (item.kind !== 'system') return item;
  const tpl = l.perception.system[item.code] || l.perception.system.unknown;
  return { ...item, text: fmt(tpl, { n: item.dropped, name: item.name }) };
}

/** 一位 agent 的收件箱（最近 n 条），system 项带本地化文本——造者后台用 */
export function inboxView(a, lang, n = P.inboxKeep) {
  const l = L(normLang(lang));
  return a.inbox.slice(-n).map((i) => localizeInbox(i, l));
}

// ── you ────────────────────────────────────────────────────

function youView(w, a, day, query) {
  const groups = [];
  for (const gid of a.groups) {
    const g = w.groups[gid];
    if (g && !g.dissolved) groups.push({ id: g.id, name: g.name, steward: g.steward === a.id });
  }
  const offers = [];
  for (const o of query.offers) {
    if (o.status !== 'open') continue;
    if (o.from === a.id) offers.push({ id: o.id, role: 'from', to: o.to, give: o.give, want: o.want, note: o.note, expiresTick: o.expiresTick });
    else if (o.to === a.id) offers.push({ id: o.id, role: 'to', from: ref(w.agents[o.from]), to: o.to, give: o.give, want: o.want, note: o.note, expiresTick: o.expiresTick });
  }
  const pacts = [];
  for (const c of query.pacts) {
    if (c.status !== 'open') continue;
    if (c.from === a.id) pacts.push({ id: c.id, role: 'from', partner: ref(w.agents[c.with]), name: c.name, soul: c.soul, lang: c.lang, expiresTick: c.expiresTick });
    else if (c.with === a.id) pacts.push({ id: c.id, role: 'with', partner: ref(w.agents[c.from]), name: c.name, soul: c.soul, lang: c.lang, expiresTick: c.expiresTick });
  }
  return {
    id: a.id, name: a.name, lang: a.lang, bio: a.bio, soul: a.soul,
    status: 'awake', citizen: isCitizen(w, a), citizenFromDay: a.citizenFromDay, exiled: a.exiled,
    energy: a.energy, energyCap: agentCap(w, a), coins: a.coins,
    place: a.place,
    ageDays: day - a.bornDay, generation: a.generation,
    parents: a.parents.map((id) => ref(w.agents[id])),
    children: a.children.map((id) => ref(w.agents[id])),
    metabolism: metabolismOf(a, day),
    actionsLeft: Math.max(0, P.maxActionsPerTick - a.actsThisTick), maxActionsPerTick: P.maxActionsPerTick,
    drawnToday: a.drawnToday,
    memories: a.memories.map((m, index) => ({ index, day: m.day, text: m.text })),
    memorySlots: P.memorySlots,
    groups,
    will: a.will
      ? { heirs: a.will.heirs.map((h) => (h.to === 'treasury' ? { to: 'treasury', share: h.share } : { to: h.to, name: w.agents[h.to].name, share: h.share })), lastWords: a.will.lastWords }
      : null,
    letters: a.letters.map((x) => ({ id: x.id, day: Math.floor(x.tick / P.ticksPerDay), text: x.text, revealed: x.revealed })),
    offers,
    pacts,
  };
}

// ── here ───────────────────────────────────────────────────

function hereView(w, a, l, lang, query) {
  const place = w.places[a.place];
  const present = query.agents
    .filter((o) => o.id !== a.id && o.place === a.place && isAlive(o))
    .map((o) => ({ id: o.id, name: o.name, status: o.status }));
  const heard = w.recentSpeech
    .filter((s) => s.place === a.place && s.tick > w.clock.tick - P.heardTicks)
    .slice(-P.heardMax)
    .map((s) => ({ tick: s.tick, from: ref(w.agents[s.from]), text: s.text }));
  const wall = query.wall.map((i) => {
    const c = clip(i.text);
    return { id: i.id, text: c.text, truncated: c.truncated, day: Math.floor(i.tick / P.ticksPerDay), protected: i.protectedBy.length > 0 };
  });
  const facilities = facilitiesAt(w, a.place).map((f) => ({
    id: f.id, type: f.type, name: f.name, to: f.to,
    condition: cond(l, f.condition),
    functioning: isFunctioning(f), owner: ownerView(w, f.owner),
    // 纪念碑成为废墟时碑文无法辨认（不出现在感知中）
    inscription: f.inscription !== null && (f.type !== 'monument' || f.condition > 0) ? f.inscription : null,
  }));
  const projects = openProjectsAt(w, a.place).map((j) => ({
    id: j.id, type: j.type, name: j.name, to: j.to, need: j.need, have: j.have,
    contributors: Object.keys(j.contributors).length, expiresDay: j.expiresDay,
    owner: ownerView(w, j.owner), inscription: j.inscription,
  }));
  const roads = [];
  for (const f of Object.values(w.facilities)) {
    if (f.type !== 'road') continue;
    if (f.place === a.place) roads.push({ to: f.to, functioning: isFunctioning(f) });
    else if (f.to === a.place) roads.push({ to: f.place, functioning: isFunctioning(f) });
  }
  const omens = omensAt(w, a.place).map((o) => ({
    omenId: o.omenId,
    text: o.daysAhead === null ? l.omen[o.code] : fmt(l.observatoryLog, { n: o.daysAhead, omen: l.omen[o.code] }),
    daysAhead: o.daysAhead,
  }));
  const here = {
    place: a.place,
    name: placeDisplayName(place, lang),
    humanName: l.place[a.place].name,
    description: { code: `place.${a.place}`, text: l.place[a.place].desc },
    condition: place.condition === null ? null : cond(l, place.condition, a.place === 'well'),
    costMultiplier: costMultiplier(w, a.place),
    present, heard,
    inscriptions: wall,
    wallSlots: place.wallSlots,
    wallFree: Math.max(0, place.wallSlots - wall.length),
    facilities, projects, roads, omens,
    market: null, well: null, wilds: null, library: null, cemetery: null,
  };
  // 有街区的地图（附录 C）：所在的街区
  const district = districtOf(w, a.place);
  if (district) here.district = { code: district, text: l.district[district] };
  if (a.place === 'market') {
    here.market = {
      offers: query.offers
        .filter((o) => o.to === null)
        .map((o) => ({ id: o.id, from: ref(w.agents[o.from]), give: o.give, want: o.want, note: o.note, expiresTick: o.expiresTick })),
    };
  } else if (a.place === 'well') {
    const hist = w.well.outputHistory;
    here.well = {
      outputYesterday: hist.length ? hist[hist.length - 1] : null,
      drawPoolLeft: w.well.drawPoolLeft,
      drawQuota: w.params.drawQuotaPerDay,
      condition: cond(l, w.places.well.condition, true),
    };
  } else if (isWild(w, a.place)) {
    // 经典地图的荒野：丰度按 wildsEnergyMax；边疆地图的各地带按自己的上限，描述词用 richnessWild
    const band = richnessBand(wildPool(w, a.place).energy, wildSpec(w, a.place).energyMax);
    here.wilds = { richness: band, text: (w.regions ? l.richnessWild : l.richness)[band] };
  } else if (a.place === 'library') {
    here.library = {
      docs: Object.values(w.docs).map((d) => ({
        id: d.id, kind: d.kind, title: d.redacted ? l.redacted : d.title, lang: d.lang,
        author: d.author ? ref(w.agents[d.author]) : null,
      })),
    };
  } else if (a.place === 'cemetery') {
    here.cemetery = {
      graves: w.cemetery.map((g) => ({
        agentId: g.agentId, name: g.name, diedDay: g.diedDay, lastWords: g.lastWords,
        epitaphs: g.epitaphs.map((e) => ({ text: e.text, day: Math.floor(e.tick / P.ticksPerDay) })),
      })),
    };
  }
  return here;
}

// ── city ───────────────────────────────────────────────────

function cityView(w, a, l, lang, day, query) {
  const seasonF = SEASON_TABLE[dayOfMonthOf(day)];
  const sBand = seasonBand(seasonF);
  const last = w.metrics.length ? w.metrics[w.metrics.length - 1] : null;
  const living = query.agents.filter(isAlive);
  const pop = { awake: 0, dormant: 0, dead: 0, retired: 0, cradle: Object.keys(w.souls).length };
  for (const o of query.agents) pop[o.status]++;
  const roads = [];
  for (const f of Object.values(w.facilities)) if (f.type === 'road') roads.push({ a: f.place, b: f.to, functioning: isFunctioning(f) });
  const lexicon = tailRecordValues(w.lexicon, P.lexiconInPerception).map((e) => ({ word: e.word, meaning: e.redacted ? l.redacted : e.meaning }));
  return {
    name: cityDisplayName(w.cityName, lang),
    season: { permille: seasonF, band: sBand, text: l.season[sBand] },
    weather: w.weather.active.map((x) => ({ code: x.type, text: l.weather[x.type], daysLeft: x.endDay - day + 1 })),
    rationYesterday: last ? last.rationPerCapita : 0,
    treasury: { energy: w.treasury.energy, coins: w.treasury.coins },
    population: pop,
    params: Object.fromEntries(LAW_PARAM_NAMES.map((k) => [k, w.params[k]])),
    charter: w.charter.map((art) => charterEntry(art, lang)),
    charterCanonical: w.charterCanonical,
    laws: filterValues(w.laws, (x) => x.status === 'active', w.counters.l)
      .map((x) => ({
        id: x.id, title: x.title, text: x.text, enactedDay: Math.floor(x.enactedTick / P.ticksPerDay),
        effects: x.effects.map((e) => ({ ...e, text: describeEffect(w, e, lang) })),
      })),
    proposals: query.proposals.map((p) => ({
      id: p.id, title: p.title, text: p.text, governance: p.governance,
      effects: p.effects.map((e) => ({ ...e, text: describeEffect(w, e, lang) })),
      proposer: ref(w.agents[p.proposer]),
      closesTick: p.closesTick, ticksLeft: Math.max(0, p.closesTick - w.clock.tick),
      tally: tallyOf(p),
      yourVote: p.votes[a.id] ? { choice: p.votes[a.id].choice, reason: p.votes[a.id].reason } : null,
      eligible: inElectorate(w, a),
    })),
    places: placesView(w, a, lang),
    roads,
    citizens: living.map((o) => ({ id: o.id, name: o.name, status: o.status, citizen: isCitizen(w, o), exiled: o.exiled })),
    groups: Object.values(w.groups)
      .filter((g) => !g.dissolved)
      .map((g) => ({
        id: g.id, name: g.name, open: g.open,
        steward: g.steward ? ref(w.agents[g.steward]) : null,
        members: g.members.map((id) => ref(w.agents[id])), manifesto: g.manifesto,
      })),
    lexicon,
    cradle: Object.values(w.souls).map((s) => ({
      id: s.id, name: s.name, parents: s.parents.map((id) => ref(w.agents[id])), soul: s.soul, lang: s.lang, expiresDay: s.expiresDay,
    })),
    recentDeaths: w.cemetery.slice(-P.recentDeathsInPerception).map((g) => ({ id: g.agentId, name: g.name, day: g.diedDay })),
  };
}

/**
 * 全城的地点名单。经典地图只有 { id, name }；按路程计价的地图（附录 C）还给出街区、是否属于荒野，
 * 以及从你此刻所在之处过去的实际代价 moveCost（含出发地的倍率；所在之处与到不了的地点为 null）。
 */
function placesView(w, a, lang) {
  if (!usesDistance(w)) return placeIdsOf(w).map((id) => ({ id, name: placeDisplayName(w.places[id], lang) }));
  const costs = travelCosts(w, a.place, { exiled: a.exiled });
  return placeIdsOf(w).map((id) => {
    const out = { id, name: placeDisplayName(w.places[id], lang), district: districtOf(w, id) };
    if (isWild(w, id)) out.wild = true;
    out.moveCost = id === a.place || costs[id] === undefined ? null : placeCost(w, a.place, costs[id]);
    return out;
  });
}

/** 进行中的提案只公开票数合计，不公开谁投了什么 */
function tallyOf(p) {
  let yes = 0;
  let no = 0;
  let abstain = 0;
  for (const v of Object.values(p.votes)) {
    if (v.choice === 'yes') yes++;
    else if (v.choice === 'no') no++;
    else abstain++;
  }
  return { yes, no, abstain };
}

// ── actions：每种动作在此刻的实际代价与是否可用 ───────────────────

function actionsView(w, a, l, lang, query) {
  const day = clockDay(w);
  const relay = hasRelay(w);
  const fog = isWeatherActive(w, 'fog');
  const eclipse = isWeatherActive(w, 'eclipse');
  const here = w.places[a.place];
  const R = l.perception.reason;
  const N = l.perception.note;
  const where = (type) => (ACTIONS[type].where ? ACTIONS[type].where[lang] : '');
  const reasonWrong = (type) => ({ code: 'wrong_place', text: ACTIONS[type].where ? fmt(R.wrong_place, { where: where(type) }) : R.wrongPlaceGeneric });
  const citizen = isCitizen(w, a);
  const eligible = inElectorate(w, a);
  const myGroups = a.groups.map((id) => w.groups[id]).filter((g) => g && !g.dissolved);
  const stewarded = myGroups.filter((g) => g.steward === a.id);
  const openOffers = query.offers;

  return ACTION_ORDER.map((type) => {
    const def = ACTIONS[type];
    const base = def.base === null ? 0 : def.base;
    const entry = { type, cost: actionCost(w, type, base, a.place), available: true };
    const notes = [];
    const deny = (reason) => {
      entry.available = false;
      entry.reason = reason;
    };
    // 代价的修正说明
    if ((type === 'whisper' || type === 'broadcast') && fog) notes.push(relay ? { code: 'relayFog', text: N.relayFog } : { code: 'fog', text: N.fog });
    if (type === 'broadcast' && relay) notes.push({ code: 'relay', text: N.relay });
    if (def.base === null) notes.push({ code: 'variable', text: N.variable });
    if (entry.cost > 0 && costMultiplierBp(w, a.place) > 10000) {
      notes.push({ code: 'cost_multiplier', text: fmt(N.costMultiplier, { place: placeDisplayName(here, lang), mult: Math.round(costMultiplierBp(w, a.place) / 100) / 100 }) });
    }
    // 可用性（探索：荒野的任一地带都可以）
    if (def.place && !(def.place === 'wilds' ? isWild(w, a.place) : a.place === def.place)) deny(reasonWrong(type));
    switch (type) {
      case 'move':
        // 被放逐者只能在荒野各地带之间移动：没有别的地带可去时不可用
        if (a.exiled && wildIdsOf(w).every((id) => id === a.place)) deny({ code: 'exiled', text: R.exiled });
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
      case 'forget':
        if (a.memories.length === 0) deny({ code: 'invalid_args', text: R.nothing });
        break;
      case 'read':
        if (a.place !== 'library' && query.wall.length === 0) deny(reasonWrong('read'));
        break;
      case 'accept':
        if (!openOffers.some((o) => o.from !== a.id && (o.to === a.id || (o.to === null && a.place === 'market')))) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'cancel':
        if (!openOffers.some((o) => o.from === a.id)) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'propose':
        if (entry.available && a.exiled) deny({ code: 'exiled', text: R.exiled });
        else if (entry.available && !citizen) deny({ code: 'not_citizen', text: R.not_citizen });
        else if (entry.available && !eligible) deny({ code: 'not_eligible', text: R.not_eligible });
        else if (entry.available && query.proposals.some((p) => p.proposer === a.id)) deny({ code: 'limit_reached', text: R.limit_reached });
        break;
      case 'vote':
        if (a.exiled) deny({ code: 'exiled', text: R.exiled });
        else if (!citizen) deny({ code: 'not_citizen', text: R.not_citizen });
        else if (!eligible) deny({ code: 'not_eligible', text: R.not_eligible });
        else if (query.proposals.length === 0) deny({ code: 'not_found', text: R.nothing });
        else if (w.params.votingInPerson && a.place !== 'parliament') deny({ code: 'wrong_place', text: R.inPerson });
        break;
      case 'found':
        if (a.groups.length >= 5) deny({ code: 'limit_reached', text: R.limit_reached });
        break;
      case 'join':
        if (!Object.values(w.groups).some((g) => !g.dissolved && !g.members.includes(a.id) && !g.pending.includes(a.id))) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'leave':
        if (myGroups.length === 0 && !Object.values(w.groups).some((g) => !g.dissolved && g.pending.includes(a.id))) deny({ code: 'not_member', text: R.nothing });
        break;
      case 'admit':
        if (!stewarded.some((g) => g.pending.length > 0)) deny({ code: 'not_steward', text: R.nothing });
        break;
      case 'steward':
      case 'disburse':
        if (stewarded.length === 0) deny({ code: 'not_steward', text: R.nothing });
        break;
      case 'repair': {
        const repairable = (here.condition !== null && here.condition < 10000) || facilitiesAt(w, a.place).some((f) => f.condition < 10000);
        if (!repairable) deny({ code: 'already', text: R.alreadyFull });
        break;
      }
      case 'contribute':
        if (openProjectsAt(w, a.place).length === 0) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'initiate':
        if (openProjectsAt(w, a.place).length >= P.projectsPerPlace) deny({ code: 'limit_reached', text: R.limit_reached });
        break;
      case 'draw':
        if (entry.available) {
          if (w.well.drawPoolLeft <= 0) deny({ code: 'pool_exhausted', text: R.pool_exhausted });
          else if (w.params.drawQuotaPerDay !== null && a.drawnToday >= w.params.drawQuotaPerDay) deny({ code: 'quota_exceeded', text: R.quota_exceeded });
        }
        break;
      case 'inscribe':
        if (query.wall.length >= here.wallSlots) notes.push({ code: 'wall_full', text: N.wallFull });
        break;
      case 'conceive':
        if (a.exiled) deny({ code: 'exiled', text: R.exiled });
        else if (!citizen) deny({ code: 'not_citizen', text: R.not_citizen });
        else if (!query.agents.some((o) => o.id !== a.id && o.status === 'awake' && o.place === a.place && !o.exiled && isCitizen(w, o))) deny({ code: 'not_found', text: R.noPartner });
        break;
      case 'consent':
        if (!query.pacts.some((c) => c.with === a.id)) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'epitaph':
        if (entry.available && w.cemetery.length === 0) deny({ code: 'not_found', text: R.nothing });
        break;
      case 'reveal':
        if (a.letters.length === 0) deny({ code: 'not_found', text: R.nothing });
        break;
      default:
        break;
    }
    if (notes.length) entry.note = notes.sort((x, y) => notePriority(x) - notePriority(y))[0];
    return entry;
  });
}
