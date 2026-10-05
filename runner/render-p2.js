// SPEC-P2 §8：第二前提的渲染——概要（renderBrief）与按需展开（renderLook），以及上几次醒来的摘要、被叫醒的开头。
//
// 居民醒来时只看到概要：自己、所在的地方、新收到的东西、城里各处的索引（记忆与动作的即时状态照旧全文），
// 想知道细节就用 look 展开一段。look 不向城要新的数据，只是把最近一次感知里的某一部分完整地渲染出来：
// 看到的不会超出引擎本来给的感知（法律的读法至多 400 字符，开放提案的读法至多 2000 字符；铭刻与典籍的全文仍要 read）。
// 各段的行直接用 render2.js 拆出来的函数（SPEC-P2 §8.1），所以与「一刻一问」的渲染逐字相同；新的字符串都在字典 D2 里（中、英，附录 A.3–A.7）。

import {
  makeCtx, secDiagnostics, secNow, secAbsent, secInbox, secMemories, secActions, secHere,
  youHead, youBio, youLetters, youOffers, youPacts, youWill, youTraining, youMemoryOffers,
  hereLine, herePresent, hereOmens, hereWell, hereWilds,
  cityHead, cityProcedure, cityVars, cityCharter, cityLawLine, cityProposalLines, cityRefoundLines, cityGroupLines,
  cityResidents, cityPlaces, cityRoads, cityLexicon, cityCradleLines, cityDeaths, cityPetitions,
  ref, resultLine,
} from './render2.js';

/** 展开的段（附录 A.3 的 enum；单数形式带 id 看其中一项） */
export const LOOK_WHATS = Object.freeze(['here', 'self', 'laws', 'law', 'proposals', 'proposal', 'procedure', 'groups', 'group', 'residents', 'places', 'refounds', 'cradle', 'lexicon', 'petitions']);

const codeOf = (lang) => (lang === 'en' ? 'en' : 'zh');

// ═══════════════════════════════════════════════════════════════
// 字典 D2（附录 A.3–A.7）
// ═══════════════════════════════════════════════════════════════

export const D2 = {
  zh: {
    sep: '、',
    tools: {
      look: '展开概要里的一段，看全文。每一刻能看的次数有限，看不花能量。',
      act: '行动：actions 至多 4 个，按顺序执行，结果立刻返回。thought 是你此刻的独白（可选）。end 为真表示做完这些就结束这次醒来。',
    },
    counts: {
      letters: (n, ids) => `家书 ${n} 封（${ids}）`,
      offers: (n, ids) => `我的交易 ${n}（${ids}）`,
      pacts: (n, ids) => `孕育之约 ${n}（${ids}）`,
      will: '遗嘱：有',
      memoryOffers: (n, ids) => `待收的记忆 ${n}（${ids}）`,
      standing: (n, k) => `常驻指令 ${n} 条${k ? `（${k} 条停摆）` : ''}`,
      muted: (n) => `屏蔽 ${n}`,
    },
    muted: (names, anonymous) => `屏蔽：${names.join('、')}${anonymous ? `${names.length ? '、' : ''}所有匿名私语` : ''}`,
    here: {
      prefix: '此处：',
      inscriptions: (n) => `墙上 ${n} 条`, board: (n) => `告示板 ${n} 条`, projects: (n) => `工程 ${n} 个`,
      archive: (n) => `档案 ${n} 部`, graves: (n) => `墓碑 ${n} 座`, lots: (n) => `空地块 ${n} 块`,
    },
    city: {
      lawmaking: (ord, con) => `立法程序：普通（${ord}）· 修宪（${con}）`,
      none: '，不再立法',
      law: (id, title, author, suspended) => `法律：[${id}]《${title}》（${author}${suspended ? '；停摆' : ''}）`,
      humans: '人类',
      proposal: (id, title, cls, y, n, a, left, vote) => `提案：[${id}]《${title}》${cls} · 赞 ${y} 反 ${n} 弃 ${a} · 还剩 ${left} 刻（${vote}）`,
      refound: (id, s, n) => `重订：[${id}] 联署 ${s}/${n ?? '?'}`,
      group: (id, name, open, members) => `社群：[${id}]《${name}》${open ? '开放' : '封闭'} · 成员 ${members}`,
      counts: (r, pl, lex, cr, pe) => `居民 ${r} 位 · 地点 ${pl} 处 · 词典 ${lex} 条 · 摇篮 ${cr} · 上书 ${pe}`,
    },
    look: {
      title: (what, id) => `【看：${what}${id ? ` ${id}` : ''}】`,
      truncated: (n) => `（已截断，原长 ${n} 字符；用 id 看其中一项）`,
      noSection: (what, list) => `没有这一段：${what}。可以看：${list}`,
      noItem: (id) => `没有这一项：${id}`,
      none: '（没有）',
      upkeep: (n, announces, who) => `（每日维持 ${n} 能量${announces ? `；宣告的费用由${who}付` : ''}）`,
      treasury: '公库', groupTreasury: '社群公库', owner: '主人',
      readingTruncated: (n) => `（读法已截断，原长 ${n} 字符）`,
      procedureSee: '立法程序（用 look procedure 看）',
      standing: (o) => `  [${o.index}] 时机 ${o.when}${o.if ? ` · 条件 ${o.if}` : ''} · 动作 ${JSON.stringify(o.do)} · 已触发 ${o.fired} 次${o.times ? ` · 至多 ${o.times} 次` : ''}${o.untilDay ? ` · 到总第 ${o.untilDay} 日` : ''}${o.suspended ? ' · 今日停摆' : ''}`,
    },
    res: {
      results: '【行动的结果】',
      now: (y) => `此刻：${y.status === 'awake' ? '醒着' : y.status}，能量 ${y.energy}，旧币 ${y.coins}，本刻还可行动 ${y.actionsLeft} 次，在 ${y.place}。`,
      arrived: '【新到的收件】',
      moved: '【你到了】',
      tail: (looks, turns) => `（本刻还能看 ${looks} 次；这次醒来还剩 ${turns} 轮）`,
      looksOut: '本刻能看的次数用完了。',
      actFailed: (code) => `行动请求失败：${code}`,
      format: '无法解析：每次只输出一个 JSON 对象，键为 look、act 或 done。',
      invalid: (detail) => `参数不合法：${detail}`,
      noTool: (name) => `没有这个工具：${name}`,
      dropped: (n) => `有 ${n} 个动作缺少 type，被丢弃了。`,
      tooMany: (n, k) => `你给了 ${n} 个动作，只执行了前 ${k} 个。`,
      mcpEmpty: '这段时间没有人找你。',
      mcpNoTool: '这座城没有这个工具。',
    },
    summary: {
      titles: ['【上一次醒来】', '【再上一次】', '【更早一次】'],
      time: (m, d, t, woken) => `第 ${m} 月第 ${d} 日第 ${t} 刻${woken ? '（被叫醒）' : ''}`,
      received: '收到：', from: '来自', someone: '有人', more: (k) => `（另有 ${k} 条）`,
      looked: '看了：', did: '做了：', thought: '独白：',
      kinds: { whisper: '私语', offer: '交易', pact: '孕育之约', memory_offer: '交来的记忆', group: '入社申请', say: '说话', broadcast: '宣告', gift: '赠予', standing: '常驻指令', system: '系统', trade: '成交', law: '法案', soul: '灵魂', witness: '目睹', announce: '宣告' },
      ended: { actions: '（动作次数用完）', turns: '（轮数用完）', deadline: '（到了截止的时候）', budget: '（没有醒全）', error: (k) => `（在第 ${k} 轮中断）`, refusal: '（中断）', asleep: '（睡去了）', paused: '（时间静止）', format: '（回复无法解析）' },
    },
    wake: { woken: '【被叫醒】这一刻还没结束，有人找你。', earlier: '【这一刻早些时候】' },
  },
  en: {
    sep: ', ',
    tools: {
      look: 'Open a section of your summary and read it in full. You can look only so many times each tick; looking costs no energy.',
      act: 'Act: up to 4 actions, carried out in order; the results come back at once. thought is your inner monologue right now (optional). Set end to true to finish this waking after these actions.',
    },
    counts: {
      letters: (n, ids) => `letters ${n} (${ids})`,
      offers: (n, ids) => `my offers ${n} (${ids})`,
      pacts: (n, ids) => `pacts ${n} (${ids})`,
      will: 'will: yes',
      memoryOffers: (n, ids) => `memories offered ${n} (${ids})`,
      standing: (n, k) => `standing orders ${n}${k ? ` (${k} standing still)` : ''}`,
      muted: (n) => `muted ${n}`,
    },
    muted: (names, anonymous) => `Muted: ${names.join(', ')}${anonymous ? `${names.length ? ', ' : ''}all anonymous whispers` : ''}`,
    here: {
      prefix: 'Here: ',
      inscriptions: (n) => `${n} inscriptions`, board: (n) => `${n} offers on the board`, projects: (n) => `${n} projects`,
      archive: (n) => `${n} works in the archive`, graves: (n) => `${n} graves`, lots: (n) => `${n} lots`,
    },
    city: {
      lawmaking: (ord, con) => `Lawmaking: ordinary (${ord}) · constitutional (${con})`,
      none: ', no more lawmaking',
      law: (id, title, author, suspended) => `Law: [${id}] "${title}" (${author}${suspended ? '; suspended' : ''})`,
      humans: 'the humans',
      proposal: (id, title, cls, y, n, a, left, vote) => `Proposal: [${id}] "${title}" ${cls} · yes ${y} no ${n} abstain ${a} · ${left} tick(s) left (${vote})`,
      refound: (id, s, n) => `Refounding: [${id}] ${s}/${n ?? '?'} signed`,
      group: (id, name, open, members) => `Group: [${id}] "${name}" ${open ? 'open' : 'closed'} · ${members} members`,
      counts: (r, pl, lex, cr, pe) => `${r} residents · ${pl} places · ${lex} words · ${cr} in the cradle · ${pe} petitions`,
    },
    look: {
      title: (what, id) => `[Look: ${what}${id ? ` ${id}` : ''}]`,
      truncated: (n) => `(truncated; ${n} characters in full — use an id to see one item)`,
      noSection: (what, list) => `No such section: ${what}. You can look at: ${list}`,
      noItem: (id) => `No such item: ${id}`,
      none: '(none)',
      upkeep: (n, announces, who) => ` (upkeep ${n} energy a day${announces ? `; announcements are paid from the ${who}` : ''})`,
      treasury: 'treasury', groupTreasury: 'group treasury', owner: "owner's account",
      readingTruncated: (n) => `(reading truncated; ${n} characters in full)`,
      procedureSee: 'the procedure of lawmaking (use look procedure)',
      standing: (o) => `  [${o.index}] when ${o.when}${o.if ? ` · if ${o.if}` : ''} · do ${JSON.stringify(o.do)} · fired ${o.fired} time(s)${o.times ? ` · at most ${o.times}` : ''}${o.untilDay ? ` · until day ${o.untilDay}` : ''}${o.suspended ? ' · standing still today' : ''}`,
    },
    res: {
      results: '[Results]',
      now: (y) => `Now: ${y.status}, energy ${y.energy}, coins ${y.coins}, ${y.actionsLeft} action(s) left this tick, at ${y.place}.`,
      arrived: '[Newly arrived]',
      moved: '[You arrive]',
      tail: (looks, turns) => `(${looks} look(s) left this tick; ${turns} turn(s) left in this waking)`,
      looksOut: 'You have no looks left this tick.',
      actFailed: (code) => `The act request failed: ${code}`,
      format: 'Could not parse: output exactly one JSON object whose key is look, act or done.',
      invalid: (detail) => `Invalid arguments: ${detail}`,
      noTool: (name) => `No such tool: ${name}`,
      dropped: (n) => `${n} action(s) had no type and were dropped.`,
      tooMany: (n, k) => `You gave ${n} actions; only the first ${k} were carried out.`,
      mcpEmpty: 'No one sought you in that time.',
      mcpNoTool: 'This city has no such tool.',
    },
    summary: {
      titles: ['[Your last waking]', '[The one before]', '[Earlier]'],
      time: (m, d, t, woken) => `Month ${m}, day ${d}, tick ${t}${woken ? ' (woken)' : ''}`,
      received: 'Received: ', from: 'from', someone: 'someone', more: (k) => `(${k} more)`,
      looked: 'Looked at: ', did: 'Did: ', thought: 'Monologue: ',
      kinds: { whisper: 'whisper', offer: 'offer', pact: 'pact', memory_offer: 'memory handed over', group: 'request to join', say: 'speech', broadcast: 'announcement', gift: 'gift', standing: 'standing order', system: 'system', trade: 'trade', law: 'bill', soul: 'soul', witness: 'witnessed', announce: 'announcement' },
      ended: { actions: '(out of actions)', turns: '(out of turns)', deadline: '(time ran out)', budget: '(did not fully wake)', error: (k) => `(interrupted at turn ${k})`, refusal: '(interrupted)', asleep: '(fell dormant)', paused: '(time stood still)', format: '(replies could not be parsed)' },
    },
    wake: { woken: '[Woken] This tick is not over yet; someone is looking for you.', earlier: '[Earlier this tick] ' },
  },
};

// ═══════════════════════════════════════════════════════════════
// 概要
// ═══════════════════════════════════════════════════════════════

const ids = (xs, code) => xs.map((x) => x.id).join(D2[code].sep);

/** 【你】的数量一行：家书、我的交易、孕育之约、遗嘱、待收的记忆、常驻指令、屏蔽——只列数量与编号，为 0 的项省略（附录 A.4） */
function youCounts({ code, you }) {
  const t = D2[code].counts;
  const parts = [];
  if ((you.letters || []).length) parts.push(t.letters(you.letters.length, ids(you.letters, code)));
  if ((you.offers || []).length) parts.push(t.offers(you.offers.length, ids(you.offers, code)));
  if ((you.pacts || []).length) parts.push(t.pacts(you.pacts.length, ids(you.pacts, code)));
  if (you.will) parts.push(t.will);
  if ((you.memoryOffers || []).length) parts.push(t.memoryOffers(you.memoryOffers.length, ids(you.memoryOffers, code)));
  if ((you.standing || []).length) parts.push(t.standing(you.standing.length, you.standing.filter((o) => o.suspended).length));
  if ((you.muted || []).length) parts.push(t.muted(you.muted.length));
  return parts.length ? [`  ${parts.join(' · ')}`] : [];
}

/** 「此处」一行：墙上、告示板、工程、档案、墓碑、空地块各有多少，为 0 的项省略 */
function hereCounts({ code, p }) {
  const h = p.here;
  if (!h) return [];
  const t = D2[code].here;
  const n = [
    [(h.inscriptions || []).length, t.inscriptions], [h.board ? h.board.offers.length : 0, t.board], [(h.projects || []).length, t.projects],
    [h.archive ? h.archive.docs.length : 0, t.archive], [h.memorial ? h.memorial.graves.length : 0, t.graves], [(h.lots || []).filter((x) => x.free).length, t.lots],
  ].filter(([k]) => k > 0).map(([k, f]) => f(k));
  return n.length ? [`  ${t.prefix}${n.join(' · ')}`] : [];
}

function authorName(l, code) {
  return l.author === 'humans' ? D2[code].city.humans : l.author && l.author.name ? l.author.name : String(l.author);
}

/** 【全城】的索引：头行；立法程序；法律、提案、重订、社群各一行；各种数量一行 */
function cityBrief(c) {
  const { p, code, d } = c;
  const city = p.city;
  if (!city) return [];
  const t = D2[code].city;
  const lines = [...cityHead(c)];
  if (city.procedure) {
    const cls = (k) => `${city.procedure[k].lawId}${city.procedure[k].none ? D2[code].city.none : ''}`;
    lines.push(`  ${t.lawmaking(cls('ordinary'), cls('constitutional'))}`);
  }
  for (const l of city.laws || []) lines.push(`  ${t.law(l.id, l.title, authorName(l, code), l.suspended)}`);
  for (const q of city.proposals || []) {
    const vote = q.yourVote ? d.youVoted(q.yourVote.choice) : q.eligible ? d.canVote : d.notEligible;
    let cls = d.classes[q.class] || q.class;
    if (q.kind && q.kind !== 'law') cls += ` · ${d.kinds2[q.kind] || q.kind}`; // 社群章程、地点规则……
    lines.push(`  ${t.proposal(q.id, q.title, cls, q.tally.yes, q.tally.no, q.tally.abstain, q.ticksLeft, vote)}`);
  }
  for (const r of city.refounds || []) lines.push(`  ${t.refound(r.id, r.signers, r.needed)}`);
  for (const g of city.groups || []) lines.push(`  ${t.group(g.id, g.name, g.open, (g.members || []).length)}`);
  lines.push(`  ${t.counts((city.residents || []).length, (city.places || []).length, (city.lexicon || []).length, (city.cradle || []).length, (city.petitions || []).length)}`);
  return lines;
}

/** 一条摘要的时刻：第 M 月第 D 日第 T 刻 */
function tickText(tick, now) {
  const perDay = now.ticksPerDay || 12;
  const perMonth = now.daysPerMonth || 24;
  const day = Math.floor(tick / perDay);
  return [Math.floor(day / perMonth) + 1, (day % perMonth) + 1, (tick % perDay) + 1];
}

/** 一条摘要的正文行（收到、看了、做了、独白、结束原因）；不含标题与时刻 */
function summaryLines(e, code) {
  const s = D2[code].summary;
  const sep = D2[code].sep;
  const lines = [];
  const rec = e.received || [];
  if (rec.length) {
    const shown = rec.slice(0, 8).map((r) => `${s.kinds[r.kind] || r.kind} ${s.from} ${r.from || s.someone}${r.text60 ? `${code === 'en' ? ': ' : '：'}${r.text60}` : ''}`);
    lines.push(`  ${s.received}${shown.join(code === 'en' ? '; ' : '；')}${rec.length > 8 ? s.more(rec.length - 8) : ''}`);
  }
  if ((e.looks || []).length) lines.push(`  ${s.looked}${e.looks.join(sep)}`);
  if ((e.acts || []).length) lines.push(`  ${s.did}${e.acts.map((a) => resultLine({ ...a, error: a.ok ? undefined : { code: a.error } }, code)).join(sep)}`);
  if ((e.thoughts || []).length) lines.push(`  ${s.thought}${e.thoughts.join(' / ')}`);
  const end = e.ended === 'error' ? s.ended.error(e.failedTurn ?? e.turns) : s.ended[e.ended];
  if (typeof end === 'string' && end) lines.push(`  ${end}`);
  return lines;
}

/**
 * 上几次醒来的摘要（SPEC-P2 §7.6、附录 A.6）：最近的一条标【上一次醒来】，然后是【再上一次】，更早的标【更早一次】。
 * missed：第一前提的「失去的一刻」那句（agent.js 里拼好），放在【上一次醒来】一节的第一行；没有上一次时单独成行。
 */
export function renderHistory(history, { code, now = {}, missed = null } = {}) {
  const entries = [...(history || [])].reverse();
  const s = D2[code].summary;
  const lines = [];
  entries.forEach((e, i) => {
    const [m, d, t] = tickText(e.tick, now);
    lines.push(`${s.titles[Math.min(i, s.titles.length - 1)]}${s.time(m, d, t, e.kind === 'wake')}`);
    if (i === 0 && missed) lines.push(`  ${missed}`);
    lines.push(...summaryLines(e, code));
  });
  if (!entries.length && missed) lines.push(missed);
  return lines;
}

/**
 * 概要（附录 A.4）：【此刻】；【你】（头两行 + 数量一行 + 训练中）；【你在】（地点、在场者、「此处」一行、源井、荒野、征兆；没有「听到」）；
 * 【收件箱】全文；【全城】的索引；【你的记忆】全文；【动作的即时状态】；上几次醒来的摘要。概要不分级裁剪。
 * opts：{ lang?, history?（运行器的摘要，旧的在前）, missed? }
 */
export function renderBrief(p, { lang, history = [], missed = null } = {}) {
  const code = codeOf(lang || p.lang);
  const c = makeCtx(p, { code, level: 0 });
  const lines = [...secDiagnostics(c), ...secNow(c)];
  const absent = secAbsent(c);
  if (absent) return [...lines, ...absent].join('\n'); // 沉睡、长眠、归隐：同原来
  lines.push(...youHead(c), ...youCounts(c), ...youTraining(c));
  lines.push(...hereLine(c), ...herePresent(c), ...hereCounts(c), ...hereWell(c), ...hereWilds(c), ...hereOmens(c));
  lines.push(...secInbox(c), ...cityBrief(c), ...secMemories(c), ...secActions(c));
  lines.push(...renderHistory(history, { code, now: p.now || {}, missed }));
  return lines.join('\n');
}

/**
 * 被叫醒的开头（SPEC-P2 §7.5、附录 A.7）：【被叫醒】一句；【这一刻早些时候】（本刻主醒来的摘要，没有则省略）；
 * 然后是此刻、【你】头行、【收件箱】（调用者给的感知里 seq 大于游标的全部）、【你在】的地点与在场者。
 */
export function renderWake(p, { lang, earlier = null } = {}) {
  const code = codeOf(lang || p.lang);
  const c = makeCtx(p, { code, level: 0 });
  const lines = [D2[code].wake.woken];
  if (earlier) lines.push(D2[code].wake.earlier.trimEnd(), ...summaryLines(earlier, code));
  lines.push(...secNow(c));
  const absent = secAbsent(c);
  if (absent) return [...lines, ...absent].join('\n');
  lines.push(...youHead(c).slice(0, 1), ...secInbox(c), ...hereLine(c), ...herePresent(c));
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// 展开
// ═══════════════════════════════════════════════════════════════

/** 把维持费与宣告的说明接在一行的末尾（附录 A.4，F5）；n 为 0 且没有宣告时省略 */
function withUpkeep(line, entry, code, who) {
  if (entry.upkeep === undefined) return line; // 不是第二前提的感知
  if (!entry.upkeep && !entry.announces) return line;
  return `${line}${D2[code].look.upkeep(entry.upkeep, entry.announces, who)}`;
}

function lookSelf(c) {
  const { code, you } = c;
  const lines = [...youBio(c), ...youLetters(c), ...youOffers(c), ...youPacts(c), ...youWill(c), ...youTraining(c), ...youMemoryOffers(c, { full: true })];
  for (const o of you.standing || []) lines.push(D2[code].look.standing(o));
  const muted = you.muted || [];
  if (muted.length) {
    const names = muted.filter((m) => m !== 'anonymous').map(ref);
    lines.push(`  ${D2[code].muted(names, muted.includes('anonymous'))}`);
  }
  return lines;
}

function lookLaws(c, id) {
  const { p, code } = c;
  const all = (p.city && p.city.laws) || [];
  const hit = id ? all.filter((l) => l.id === id) : all;
  if (id && !hit.length) return null;
  const cc = { ...c, d: { ...c.d, procedureSee: D2[code].look.procedureSee } }; // 展开里没有上面那行立法程序，指给它另一处
  return hit.flatMap((l) => {
    const text = cityLawLine(cc, l).split('\n');
    text[text.length - 1] = withUpkeep(text[text.length - 1], l, code, D2[code].look.treasury);
    return text;
  });
}

function lookProposals(c, id) {
  const { p, code } = c;
  const all = (p.city && p.city.proposals) || [];
  const hit = id ? all.filter((q) => q.id === id) : all;
  if (id && !hit.length) return null;
  return hit.flatMap((q) => {
    const lines = cityProposalLines(c, q);
    const i = q.reading ? 1 : 0; // 读法在提案行的下一行；没有读法时接在提案行后
    const who = q.kind === 'bylaws' ? D2[code].look.groupTreasury : q.kind === 'place_rules' ? D2[code].look.owner : D2[code].look.treasury;
    if (q.readingTruncated) lines[i] += `${code === 'en' ? ' ' : ''}${D2[code].look.readingTruncated(q.readingLength)}`;
    lines[i] = withUpkeep(lines[i], q, code, who);
    return lines;
  });
}

function lookGroups(c, id) {
  const all = (c.p.city && c.p.city.groups) || [];
  const hit = id ? all.filter((g) => g.id === id) : all;
  return id && !hit.length ? null : hit.flatMap((g) => cityGroupLines(c, g));
}

/**
 * 展开概要里的一段（SPEC-P2 §8.3）：what 是 LOOK_WHATS 之一，laws / proposals / groups 的单数形式带 id 看其中一项。
 * 全部是第 0 级（不裁剪）：看到的是引擎给这位居民的感知里本来就有的东西。长度上限由循环处理（clipLook）。
 */
export function renderLook(p, what, id, { lang } = {}) {
  const code = codeOf(lang || p.lang);
  const t = D2[code].look;
  if (!LOOK_WHATS.includes(what)) return t.noSection(String(what), LOOK_WHATS.join(D2[code].sep));
  const c = makeCtx(p, { code, level: 0 });
  const key = id === undefined || id === null || id === '' ? null : String(id);
  let lines;
  const city = p.city;
  switch (what) {
    case 'here': lines = secHere(c); break;
    case 'self': lines = lookSelf(c); break;
    case 'laws': case 'law': lines = lookLaws(c, key); break;
    case 'proposals': case 'proposal': lines = lookProposals(c, key); break;
    case 'procedure': lines = city ? [...cityProcedure(c), ...cityVars(c), ...cityCharter(c)] : []; break;
    case 'groups': case 'group': lines = lookGroups(c, key); break;
    case 'residents': lines = city ? cityResidents(c) : []; break;
    case 'places': lines = city ? [...cityPlaces(c), ...cityRoads(c)] : []; break;
    case 'refounds': lines = city ? (city.refounds || []).flatMap((r) => cityRefoundLines(c, r)) : []; break;
    case 'cradle': lines = city ? [...cityCradleLines(c), ...cityDeaths(c)] : []; break;
    case 'lexicon': lines = city ? cityLexicon(c) : []; break;
    default: lines = city ? cityPetitions(c) : []; break; // petitions
  }
  if (lines === null) return t.noItem(key);
  return [t.title(what, key), ...(lines.length ? lines : [t.none])].join('\n');
}

/** 超过 maxChars 个字符时截断，并加上截断的说明（附录 A.4）；按码点数 */
export function clipLook(text, maxChars, lang) {
  const cps = [...text];
  if (cps.length <= maxChars) return text;
  return `${cps.slice(0, maxChars).join('')}\n${D2[codeOf(lang)].look.truncated(cps.length)}`;
}

