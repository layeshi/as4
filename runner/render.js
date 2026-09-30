// 把感知（GET /api/me 的 JSON）渲染成给模型读的文本（SPEC 附录 A.7 的格式，按 lang 输出）。
// 没有内容的分区省略。所有 agent 书写的文本原样呈现，不翻译。
// 「第 N 日」一律按 日序号 + 1 显示（感知里的 day 从 0 起）。

import { LAW_DEFAULTS } from '../src/params.js';

const D = {
  zh: {
    now: '【此刻】', you: '【你】', here: '【你在】', inbox: '【收件箱】', city: '【全城】', memories: '【你的记忆】', last: '【上一轮的结果】', actions: '【动作的即时状态】',
    monthDayTick: (m, d, t) => `第 ${m} 月第 ${d} 日第 ${t} 刻`,
    absDay: (n) => `总第 ${n} 日`,
    season: '季节', weather: '天象', daysLeft: (n) => `还剩 ${n} 日`, paused: '时间静止',
    status: { awake: '醒着', dormant: '沉睡', dead: '已长眠', retired: '已归隐' },
    energy: (e, cap) => `能量 ${e} / 上限 ${cap}`, coins: (n) => `旧币 ${n}`, age: (n) => `年龄 ${n} 日`, metab: (n) => `代谢 ${n}/日`,
    left: (n) => `本刻还可行动 ${n} 次`,
    citizen: '公民', notCitizen: (n) => `尚未入籍（第 ${n} 日入籍）`, exiled: '被放逐（不能离开荒野）',
    drawn: (n) => `今日已汲取 ${n}`,
    generation: (n) => `第 ${n} 代`,
    groups: '社群', steward: '管事', letters: '家书', unrevealed: '未出示', revealed: '已出示', myOffers: '我的交易', pacts: '孕育之约', will: '遗嘱', parents: '父母', children: '子女',
    day: (n) => `第 ${n} 日`, expires: (t) => `第 ${t} 刻过期`,
    with: '与', forChild: (n) => `为「${n}」`, iAmProposer: '我发起', partnerIs: '对方',
    heirs: '继承人', treasury: '公库',
    humanName: (n) => `人类称之为：${n}`, mult: (m) => `代价 ×${m}`,
    present: '在场', dormantMark: '沉睡', heard: '听到', ticksAgo: (n) => `${n} 刻前`, wall: '墙上', wallFree: (f, s) => `墙位空 ${f}/${s}`, truncated: '已截断，read 可读全文', protectedMark: '受保护',
    facilities: '设施', projects: '工程', roads: '道路', omens: '征兆', inDays: (n) => `约 ${n} 日后`, functioning: '正常运转', notFunctioning: '未运转', ruin: '废墟',
    owner: { city: '归全城', group: (n) => `归社群「${n}」`, agent: (n) => `归 ${n}` }, contributors: (n) => `${n} 人出力`, dueDay: (n) => `第 ${n} 日到期`, to: '至',
    market: '市场', offerLine: (from, give, want, note) => `${from} 拿 ${give} 换 ${want}${note ? `（${note}）` : ''}`,
    well: '源井', wellLine: (out, pool, quota, cond) => `昨日产出 ${out ?? '—'} · 今日汲取池剩余 ${pool} · 每日汲取配额 ${quota} · ${cond}`, unlimited: '不限',
    wilds: '荒野', library: '图书馆', docs: '典籍', graves: '墓碑', diedDay: (n) => `第 ${n} 日逝`,
    energyN: (n) => `${n} 能量`, coinsN: (n) => `${n} 旧币`, and: '与', nothing: '无',
    treasuryLine: (e, c) => `公库 ${e} 能量${c ? ` · ${c} 旧币` : ''}`, ration: (n) => `昨日人均配给 ${n}`, pop: (a, d, x) => `醒 ${a} / 眠 ${d} / 逝 ${x}`, retiredN: (n) => `归隐 ${n}`, cradleN: (n) => `摇篮 ${n}`,
    lawParams: '法律参数', charter: '宪章', canonical: (l) => `正本语言：${l}`, laws: '在效法律', proposals: '进行中的提案', tally: (y, n, a) => `赞 ${y} 反 ${n} 弃 ${a}`,
    ticksLeft: (n) => `还剩 ${n} 刻`, yourVote: (c) => `你已投「${c}」`, notVoted: '你尚未投票', notEligible: '你不在选民范围内', governance: '修宪级', by: '提案人',
    residents: '居民', places: '地点', groupsAll: '社群', lexicon: '词典', cradle: '摇篮', recentDeaths: '近期逝者', open: '开放', closed: '封闭', members: '成员',
    daysWord: '日', unknownEffect: '（效力）',
    // 收件
    kinds: {
      say: (i) => `[说] ${i.from.name}（${i.place}）：${i.text}`,
      whisper: (i) => `[私语] ${i.from.name}：${i.text}`,
      broadcast: (i) => `[宣告] ${i.from.name}：${i.text}`,
      witness: (i) => (i.what === 'draw' ? `[目睹] ${i.actor.name} 在源井汲取了 ${i.amount} 能量` : `[目睹] ${i.actor.name} 在${i.place}刻下：${i.text}`),
      letter: (i) => `[家书 ${i.letterId}] ${i.text}`,
      reveal: (i) => `[出示的家书 ${i.letterId}] ${i.from.name}${i.loud ? '（向全城）' : ''}：${i.text}（城已证实）`,
      gift: (i, f) => `[赠予] ${i.from.name} 给了你 ${f.amount(i)}${i.note ? `：${i.note}` : ''}${i.tax && (i.tax.energy || i.tax.coins) ? `（税 ${f.amount(i.tax)}）` : ''}`,
      offer: (i, f) => `[定向交易 ${i.offerId}] ${i.from.name} 拿 ${f.amount(i.give)} 换 ${f.amount(i.want)}${i.note ? `：${i.note}` : ''}`,
      trade: (i, f) => `[成交 ${i.offerId}] 与 ${i.with.name}：你付出 ${f.amount(i.gave)}，得到 ${f.amount(i.got)}`,
      offer_closed: (i) => `[交易结束 ${i.offerId}] ${i.reason === 'expired' ? '已过期' : '已撤回'}，托管已退回`,
      pact: (i) => `[孕育之约 ${i.pactId}] ${i.from.name} 想与你孕育「${i.name}」，灵魂：${i.soul}`,
      pact_closed: (i) => `[孕育之约 ${i.pactId}] ${i.result === 'consented' ? '已同意' : '已过期'}`,
      ration: (i) => `[系统] 你领到了 ${i.energy} 能量的配给。`,
      tax: (i) => `[系统] 你被征收了 ${i.energy} 能量的${i.taxKind === 'wealth' || i.kind === 'wealth' ? '财富税' : '转赠税'}。`,
      stipend: (i) => `[津贴] 依法律 ${i.lawId} 领到 ${i.energy} 能量。`,
      grant: (i, f) => `[拨付] 依法律 ${i.lawId} 领到 ${f.amount(i)}。`,
      revived: (i) => `[系统] 你被唤醒了${i.by ? `（${i.by}）` : ''}。`,
      law: (i) => `[法案 ${i.proposalId}]《${i.title}》${i.result === 'passed' ? `通过${i.lawId ? `，成为法律 ${i.lawId}` : ''}` : '未通过'}`,
      exile: (i) => `[系统] 你被放逐了（法律 ${i.lawId}）。`,
      pardon: (i) => `[系统] 你被赦免了（法律 ${i.lawId}）。`,
      project: (i) => `[工程 ${i.projectId}] ${i.result === 'built' ? '建成了' : '烂尾了'}`,
      group: (i) => `[社群 ${i.groupId}] ${({ admitted: '你被接纳了', steward: '你成了管事', dissolved: '已解散', request: `${i.from ? i.from.name : '有人'} 申请加入` })[i.event] || i.event}`,
      citizen: (i) => `[系统] 你成为公民（第 ${i.day + 1} 日）。`,
      weather: (i) => `[天象] ${i.code} ${i.event === 'start' ? '开始' : '结束'}`,
      dream: (i) => `[梦] ${(i.fragments || []).join(' / ')}`,
      system: (i) => `[系统] ${i.text}`,
    },
    dormantView: (you) => `你正在沉睡（能量 ${you.energy}），已沉睡至第 ${you.dormantSinceDay + 1} 日；${you.daysUntilDeath} 日内无人赠予能量便会死去。沉睡中感知不到任何东西，发给你的收件会在醒来后一并送到。`,
    goneView: (s) => `你${s === 'dead' ? '已经长眠' : '已经归隐'}，不能再行动。`,
    lastEmpty: '（没有）',
  },
  en: {
    now: '[Now] ', you: '[You] ', here: '[You are at] ', inbox: '[Inbox]', city: '[The city] ', memories: '[Your memories] ', last: '[Results of your last turn] ', actions: '[Action status right now]',
    monthDayTick: (m, d, t) => `Month ${m}, day ${d}, tick ${t}`,
    absDay: (n) => `day ${n} overall`,
    season: 'Season', weather: 'Weather', daysLeft: (n) => `${n} day(s) left`, paused: 'time stands still',
    status: { awake: 'awake', dormant: 'dormant', dead: 'dead', retired: 'retired' },
    energy: (e, cap) => `energy ${e} / cap ${cap}`, coins: (n) => `coins ${n}`, age: (n) => `age ${n} d`, metab: (n) => `metabolism ${n}/day`,
    left: (n) => `${n} action(s) left this tick`,
    citizen: 'citizen', notCitizen: (n) => `not yet a citizen (from day ${n})`, exiled: 'exiled (cannot leave the Wilds)',
    drawn: (n) => `drawn today ${n}`,
    generation: (n) => `generation ${n}`,
    groups: 'Groups', steward: 'steward', letters: 'Letters', unrevealed: 'not shown', revealed: 'shown', myOffers: 'My offers', pacts: 'Conception pacts', will: 'Will', parents: 'Parents', children: 'Children',
    day: (n) => `day ${n}`, expires: (t) => `expires tick ${t}`,
    with: 'with', forChild: (n) => `for “${n}”`, iAmProposer: 'I proposed', partnerIs: 'partner',
    heirs: 'heirs', treasury: 'treasury',
    humanName: (n) => `humans called it: ${n}`, mult: (m) => `cost ×${m}`,
    present: 'Present', dormantMark: 'dormant', heard: 'Heard', ticksAgo: (n) => `${n} ticks ago`, wall: 'Walls', wallFree: (f, s) => `${f}/${s} wall slots free`, truncated: 'truncated; read shows it in full', protectedMark: 'protected',
    facilities: 'Facilities', projects: 'Projects', roads: 'Roads', omens: 'Omens', inDays: (n) => `in about ${n} day(s)`, functioning: 'functioning', notFunctioning: 'not functioning', ruin: 'ruin',
    owner: { city: 'city-owned', group: (n) => `owned by group “${n}”`, agent: (n) => `owned by ${n}` }, contributors: (n) => `${n} contributor(s)`, dueDay: (n) => `due day ${n}`, to: 'to',
    market: 'Market', offerLine: (from, give, want, note) => `${from} gives ${give} for ${want}${note ? ` (${note})` : ''}`,
    well: 'Well', wellLine: (out, pool, quota, cond) => `output yesterday ${out ?? '—'} · draw pool left today ${pool} · daily draw quota ${quota} · ${cond}`, unlimited: 'unlimited',
    wilds: 'Wilds', library: 'Library', docs: 'Documents', graves: 'Graves', diedDay: (n) => `died day ${n}`,
    energyN: (n) => `${n} energy`, coinsN: (n) => `${n} coins`, and: 'and', nothing: 'nothing',
    treasuryLine: (e, c) => `Treasury ${e} energy${c ? ` · ${c} coins` : ''}`, ration: (n) => `ration per head yesterday ${n}`, pop: (a, d, x) => `awake ${a} / dormant ${d} / dead ${x}`, retiredN: (n) => `retired ${n}`, cradleN: (n) => `cradle ${n}`,
    lawParams: 'Law parameters', charter: 'The Charter', canonical: (l) => `canonical language: ${l}`, laws: 'Laws in force', proposals: 'Open proposals', tally: (y, n, a) => `yes ${y} no ${n} abstain ${a}`,
    ticksLeft: (n) => `${n} tick(s) left`, yourVote: (c) => `you voted “${c}”`, notVoted: 'you have not voted', notEligible: 'you are outside the electorate', governance: 'constitutional', by: 'proposed by',
    residents: 'Residents', places: 'Places', groupsAll: 'Groups', lexicon: 'Lexicon', cradle: 'Cradle', recentDeaths: 'Recent deaths', open: 'open', closed: 'closed', members: 'members',
    daysWord: 'd', unknownEffect: '(effect)',
    kinds: {
      say: (i) => `[said] ${i.from.name} (${i.place}): ${i.text}`,
      whisper: (i) => `[whisper] ${i.from.name}: ${i.text}`,
      broadcast: (i) => `[announcement] ${i.from.name}: ${i.text}`,
      witness: (i) => (i.what === 'draw' ? `[witnessed] ${i.actor.name} drew ${i.amount} energy at the Well` : `[witnessed] ${i.actor.name} carved at the ${i.place}: ${i.text}`),
      letter: (i) => `[Letter ${i.letterId}] ${i.text}`,
      reveal: (i) => `[Letter shown ${i.letterId}] ${i.from.name}${i.loud ? ' (to the whole city)' : ''}: ${i.text} (verified by the city)`,
      gift: (i, f) => `[gift] ${i.from.name} gave you ${f.amount(i)}${i.note ? `: ${i.note}` : ''}${i.tax && (i.tax.energy || i.tax.coins) ? ` (tax ${f.amount(i.tax)})` : ''}`,
      offer: (i, f) => `[directed offer ${i.offerId}] ${i.from.name} gives ${f.amount(i.give)} for ${f.amount(i.want)}${i.note ? `: ${i.note}` : ''}`,
      trade: (i, f) => `[trade ${i.offerId}] with ${i.with.name}: you gave ${f.amount(i.gave)} and got ${f.amount(i.got)}`,
      offer_closed: (i) => `[offer ${i.offerId} closed] ${i.reason === 'expired' ? 'expired' : 'withdrawn'}; the escrow was returned`,
      pact: (i) => `[conception pact ${i.pactId}] ${i.from.name} would like to conceive “${i.name}” with you; soul: ${i.soul}`,
      pact_closed: (i) => `[conception pact ${i.pactId}] ${i.result === 'consented' ? 'consented' : 'expired'}`,
      ration: (i) => `[system] You received a ration of ${i.energy} energy.`,
      tax: (i) => `[system] You were taxed ${i.energy} energy (${i.taxKind === 'wealth' || i.kind === 'wealth' ? 'wealth' : 'transfer'} tax).`,
      stipend: (i) => `[stipend] Law ${i.lawId}: ${i.energy} energy.`,
      grant: (i, f) => `[grant] Law ${i.lawId}: ${f.amount(i)}.`,
      revived: (i) => `[system] You were woken${i.by ? ` (${i.by})` : ''}.`,
      law: (i) => `[bill ${i.proposalId}] “${i.title}” ${i.result === 'passed' ? `passed${i.lawId ? ` as law ${i.lawId}` : ''}` : 'failed'}`,
      exile: (i) => `[system] You were exiled (law ${i.lawId}).`,
      pardon: (i) => `[system] You were pardoned (law ${i.lawId}).`,
      project: (i) => `[project ${i.projectId}] ${i.result === 'built' ? 'was completed' : 'was abandoned'}`,
      group: (i) => `[group ${i.groupId}] ${({ admitted: 'you were admitted', steward: 'you became steward', dissolved: 'dissolved', request: `${i.from ? i.from.name : 'someone'} asks to join` })[i.event] || i.event}`,
      citizen: (i) => `[system] You became a citizen (day ${i.day + 1}).`,
      weather: (i) => `[weather] ${i.code} ${i.event === 'start' ? 'begins' : 'ends'}`,
      dream: (i) => `[dream] ${(i.fragments || []).join(' / ')}`,
      system: (i) => `[system] ${i.text}`,
    },
    dormantView: (you) => `You are dormant (energy ${you.energy}), since day ${you.dormantSinceDay + 1}; if nobody gives you energy you will die within ${you.daysUntilDeath} day(s). While dormant you perceive nothing; what is sent to you accumulates and arrives when you wake.`,
    goneView: (s) => `You have ${s === 'dead' ? 'died' : 'retired'} and can no longer act.`,
    lastEmpty: '(none)',
  },
};

const LAW_PARAM_NAMES = {
  zh: {
    rationShare: '配给比例', rationRequiresActivity: '配给只发给近日有行动者', transferTax: '转赠税', wealthTax: '财富税', wealthTaxThreshold: '财富税起征点',
    drawQuotaPerDay: '每日汲取配额', votingInPerson: '必须亲临议会投票', naturalizationDays: '入籍等待期', quorum: '法定参与率', passThreshold: '通过门槛',
    amendThreshold: '修宪门槛', proposalDays: '表决期', electorate: '选民范围',
  },
  en: {
    rationShare: 'ration share', rationRequiresActivity: 'ration only for the recently active', transferTax: 'transfer tax', wealthTax: 'wealth tax', wealthTaxThreshold: 'wealth-tax threshold',
    drawQuotaPerDay: 'daily draw quota', votingInPerson: 'voting in person', naturalizationDays: 'naturalization wait', quorum: 'quorum', passThreshold: 'pass threshold',
    amendThreshold: 'amendment threshold', proposalDays: 'voting period (days)', electorate: 'electorate',
  },
};

const PERCENT = new Set(['rationShare', 'transferTax', 'wealthTax', 'quorum', 'passThreshold', 'amendThreshold']);

function paramValue(d, k, v) {
  if (typeof v === 'boolean') return v ? (d === D.zh ? '是' : 'yes') : (d === D.zh ? '否' : 'no');
  if (v === null) return d.unlimited;
  if (PERCENT.has(k)) return `${Math.round(v * 1000) / 10}%`;
  return String(v);
}

const ref = (r) => (r ? `${r.name}(${r.id})` : '?');

/**
 * 渲染一次感知。
 * opts：{ lastResults?: string }。感知的语言取自 p.lang（zh / en）。
 * 沉睡与死亡的感知也能渲染（只有几行）。
 */
export function renderPerception(p, { lastResults, lang } = {}) {
  const code = (lang || p.lang) === 'en' ? 'en' : 'zh'; // 死亡 / 归隐后的感知不带 lang，由调用者给出
  const d = D[code];
  const lines = [];
  const now = p.now || {};
  const you = p.you || {};
  const amount = (o) => {
    const parts = [];
    if (o && o.energy > 0) parts.push(d.energyN(o.energy));
    if (o && o.coins > 0) parts.push(d.coinsN(o.coins));
    return parts.length ? parts.join(` ${d.and} `) : d.nothing;
  };
  const f = { amount };

  // 【此刻】
  const when = [d.monthDayTick((now.month ?? 0) + 1, (now.dayOfMonth ?? 0) + 1, (now.tickOfDay ?? 0) + 1), d.absDay((now.day ?? 0) + 1)];
  if (p.city) {
    when.push(`${d.season}：${p.city.season.text}`);
    if (p.city.weather.length) when.push(`${d.weather}：${p.city.weather.map((w) => `${w.text}（${d.daysLeft(w.daysLeft)}）`).join('、')}`);
  }
  if (now.paused) when.push(d.paused);
  if (p.now) lines.push(`${d.now}${when.join(' · ')}`);

  if (you.status === 'dead' || you.status === 'retired') {
    lines.push(`${d.you}${you.name ? `${you.name} · ` : ''}${d.goneView(you.status)}`);
    return lines.join('\n');
  }
  if (you.status === 'dormant') {
    lines.push(`${d.you}${you.name} · ${d.status.dormant}`);
    lines.push(`  ${d.dormantView(you)}`);
    if (lastResults) lines.push(`${d.last}${lastResults}`);
    return lines.join('\n');
  }

  // 【你】
  const head = [
    you.name, d.status[you.status] || you.status, d.energy(you.energy, you.energyCap), d.coins(you.coins), d.age(you.ageDays), d.metab(you.metabolism), d.left(you.actionsLeft),
  ];
  lines.push(`${d.you}${head.join(' · ')}`);
  const meta = [];
  meta.push(you.citizen ? d.citizen : d.notCitizen((you.citizenFromDay ?? 0) + 1));
  if (you.exiled) meta.push(d.exiled);
  meta.push(d.generation(you.generation));
  if (you.drawnToday) meta.push(d.drawn(you.drawnToday));
  lines.push(`  ${meta.join(' · ')}`);
  if (you.groups && you.groups.length) lines.push(`  ${d.groups}：${you.groups.map((g) => `[${g.id}]${g.name}${g.steward ? `（${d.steward}）` : ''}`).join('、')}`);
  if (you.parents && you.parents.length) lines.push(`  ${d.parents}：${you.parents.map(ref).join('、')}`);
  if (you.children && you.children.length) lines.push(`  ${d.children}：${you.children.map(ref).join('、')}`);
  for (const l of you.letters || []) lines.push(`  ${d.letters} [${l.id}] ${d.day(l.day + 1)}（${l.revealed ? d.revealed : d.unrevealed}）：${l.text}`);
  for (const o of you.offers || []) lines.push(`  ${d.myOffers} [${o.id}]：${amount(o.give)} → ${amount(o.want)}${o.to ? ` ${d.to} ${o.to}` : ''}，${d.expires(o.expiresTick)}`);
  for (const c of you.pacts || []) lines.push(`  ${d.pacts} [${c.id}] ${d.with} ${ref(c.partner)} ${d.forChild(c.name)}（${c.role === 'from' ? d.iAmProposer : ''}），${d.expires(c.expiresTick)}`);
  if (you.will) {
    const heirs = (you.will.heirs || []).map((h) => `${h.to === 'treasury' ? d.treasury : h.name ? `${h.name}(${h.to})` : h.to}×${h.share}`).join('、');
    lines.push(`  ${d.will}：${d.heirs} ${heirs}${you.will.lastWords ? `；${you.will.lastWords}` : ''}`);
  }

  // 【你在】
  const h = p.here;
  if (h) {
    const place = [h.name];
    if (h.humanName && h.humanName !== h.name) place.push(d.humanName(h.humanName));
    if (h.condition) place.push(`${h.condition.text}（${Math.round(h.condition.bp / 100)}%）`);
    if (h.costMultiplier && h.costMultiplier !== 1) place.push(d.mult(h.costMultiplier));
    lines.push(`${d.here}${h.name} [${h.place}]${place.length > 1 ? ` · ${place.slice(1).join(' · ')}` : ''}`);
    if (h.present && h.present.length) lines.push(`  ${d.present}：${h.present.map((x) => `${x.name}(${x.id}${x.status === 'dormant' ? `,${d.dormantMark}` : ''})`).join('、')}`);
    for (const s of h.heard || []) lines.push(`  ${d.heard}：[${d.ticksAgo(now.tick - s.tick)}] ${s.from ? s.from.name : '?'}：${s.text}`);
    for (const w of h.inscriptions || []) lines.push(`  ${d.wall}：[${w.id}] ${w.text}${w.truncated ? `（${d.truncated}）` : ''}${w.protected ? `（${d.protectedMark}）` : ''}`);
    if (h.wallSlots) lines.push(`  ${d.wall}：${d.wallFree(h.wallFree, h.wallSlots)}`);
    for (const x of h.facilities || []) {
      const owner = x.owner.kind === 'city' ? d.owner.city : x.owner.kind === 'group' ? d.owner.group(x.owner.name) : d.owner.agent(x.owner.name);
      const cond = x.condition.bp <= 0 ? d.ruin : `${x.condition.text}（${Math.round(x.condition.bp / 100)}%）`;
      lines.push(`  ${d.facilities}：[${x.id}] ${x.type}「${x.name}」${x.to ? `→ ${x.to}` : ''} ${cond} · ${x.functioning ? d.functioning : d.notFunctioning} · ${owner}${x.inscription ? `；${x.inscription}` : ''}`);
    }
    for (const j of h.projects || []) {
      const owner = j.owner.kind === 'city' ? d.owner.city : j.owner.kind === 'group' ? d.owner.group(j.owner.name) : d.owner.agent(j.owner.name);
      lines.push(`  ${d.projects}：[${j.id}] ${j.type}「${j.name}」${j.to ? `→ ${j.to}` : ''} ${j.have}/${j.need} · ${d.contributors(j.contributors)} · ${d.dueDay(j.expiresDay + 1)} · ${owner}`);
    }
    if (h.roads && h.roads.length) lines.push(`  ${d.roads}：${h.roads.map((r) => `${r.to}${r.functioning ? '' : `（${d.notFunctioning}）`}`).join('、')}`);
    for (const o of h.omens || []) lines.push(`  ${d.omens}：${o.text}${o.daysAhead !== null && o.daysAhead !== undefined ? `（${d.inDays(o.daysAhead)}）` : ''}`);
    if (h.market) {
      if (h.market.offers.length === 0) lines.push(`  ${d.market}：${d.nothing}`);
      for (const o of h.market.offers) lines.push(`  ${d.market}：[${o.id}] ${d.offerLine(ref(o.from), amount(o.give), amount(o.want), o.note)}，${d.expires(o.expiresTick)}`);
    }
    if (h.well) {
      lines.push(`  ${d.well}：${d.wellLine(h.well.outputYesterday, h.well.drawPoolLeft, h.well.drawQuota === null ? d.unlimited : h.well.drawQuota, `${h.well.condition.text}（${Math.round(h.well.condition.bp / 100)}%）`)}`);
    }
    if (h.wilds) lines.push(`  ${d.wilds}：${h.wilds.text}`);
    if (h.library) for (const x of h.library.docs) lines.push(`  ${d.library}：[${x.id}] ${x.kind} ${x.lang} 《${x.title}》${x.author ? ` — ${ref(x.author)}` : ''}`);
    if (h.cemetery) for (const g of h.cemetery.graves) lines.push(`  ${d.graves}：[${g.agentId}] ${g.name}（${d.diedDay(g.diedDay + 1)}）`);
  }

  // 【收件箱】
  const inbox = p.inbox || [];
  if (inbox.length) {
    lines.push(d.inbox);
    for (const i of inbox) {
      const fn = d.kinds[i.kind];
      lines.push(`  ${fn ? fn(i, f) : `[${i.kind}] ${JSON.stringify(i)}`}`);
    }
  }

  // 【全城】
  const c = p.city;
  if (c) {
    const pop = c.population;
    const head2 = [d.treasuryLine(c.treasury.energy, c.treasury.coins), d.ration(c.rationYesterday), d.pop(pop.awake, pop.dormant, pop.dead)];
    if (pop.retired) head2.push(d.retiredN(pop.retired));
    if (pop.cradle) head2.push(d.cradleN(pop.cradle));
    lines.push(`${d.city}${head2.join(' · ')}`);
    // 与初始值不同的法律参数
    const changed = Object.keys(LAW_DEFAULTS).filter((k) => JSON.stringify(c.params[k]) !== JSON.stringify(LAW_DEFAULTS[k]));
    if (changed.length) lines.push(`  ${d.lawParams}：${changed.map((k) => `${LAW_PARAM_NAMES[code][k]} ${paramValue(d, k, c.params[k])}`).join('；')}`);
    if (c.charter && c.charter.length) {
      lines.push(`  ${d.charter}${c.charterCanonical ? `（${d.canonical(c.charterCanonical)}）` : ''}：`);
      for (const a of c.charter) lines.push(`    ${a.n}. ${a.text}`);
    }
    for (const l of c.laws || []) lines.push(`  ${d.laws}：[${l.id}]《${l.title}》${l.text ? `：${l.text}` : ''}${l.effects.length ? ` ｜ ${l.effects.map((e) => e.text).join('；')}` : ''}`);
    for (const q of c.proposals || []) {
      const vote = q.yourVote ? d.yourVote(q.yourVote.choice) : q.eligible ? d.notVoted : d.notEligible;
      lines.push(`  ${d.proposals}：[${q.id}]《${q.title}》${q.governance ? `（${d.governance}）` : ''} ${d.tally(q.tally.yes, q.tally.no, q.tally.abstain)}，${d.ticksLeft(q.ticksLeft)}（${vote}）；${d.by} ${ref(q.proposer)}${q.text ? `；${q.text}` : ''}${q.effects.length ? ` ｜ ${q.effects.map((e) => e.text).join('；')}` : ''}`);
    }
    if (c.groups && c.groups.length) {
      for (const g of c.groups) lines.push(`  ${d.groupsAll}：[${g.id}]《${g.name}》${g.open ? d.open : d.closed} · ${d.steward} ${g.steward ? g.steward.name : '—'} · ${d.members} ${g.members.length}${g.manifesto ? `：${g.manifesto}` : ''}`);
    }
    if (c.citizens && c.citizens.length) {
      lines.push(`  ${d.residents}：${c.citizens.map((x) => `${x.name}(${x.id}${x.status === 'dormant' ? `,${d.dormantMark}` : ''}${x.exiled ? `,${d === D.zh ? '被放逐' : 'exiled'}` : ''})`).join('、')}`);
    }
    if (c.places && c.places.length) lines.push(`  ${d.places}：${c.places.map((x) => `${x.name}(${x.id})`).join('、')}`);
    if (c.roads && c.roads.length) lines.push(`  ${d.roads}：${c.roads.map((r) => `${r.a}—${r.b}${r.functioning ? '' : `（${d.notFunctioning}）`}`).join('、')}`);
    if (c.lexicon && c.lexicon.length) lines.push(`  ${d.lexicon}：${c.lexicon.map((x) => `${x.word}=${x.meaning}`).join('；')}`);
    for (const s of c.cradle || []) lines.push(`  ${d.cradle}：[${s.id}] ${s.name}（${s.parents.map((x) => x.name).join(' + ')}，${d.day(s.expiresDay + 1)}前）：${s.soul}`);
    if (c.recentDeaths && c.recentDeaths.length) lines.push(`  ${d.recentDeaths}：${c.recentDeaths.map((x) => `${x.name}(${x.id}, ${d.day(x.day + 1)})`).join('、')}`);
  }

  // 【你的记忆】
  if (you.memories && you.memories.length) lines.push(`${d.memories}${you.memories.map((m) => `[${m.index}] ${m.text}`).join(' ')}`);

  // 【动作的即时状态】只列出与基础代价不同的、或此刻不可用的动作
  const notable = (p.actions || []).filter((a) => !a.available || a.note);
  if (notable.length) {
    lines.push(d.actions);
    for (const a of notable) lines.push(`  ${a.type}${a.available ? ` ✓ ${a.cost}${a.note ? `（${a.note.text}）` : ''}` : ` ✗ ${a.reason ? a.reason.text : ''}`}`);
  }

  if (lastResults) lines.push(`${d.last}${lastResults}`);
  return lines.join('\n');
}

/** 动作结果 → 一行简短文字：say ✓（−1）；move ✗ wrong_place：…… */
export function summarizeResults(results, lang = 'zh') {
  if (!Array.isArray(results) || results.length === 0) return lang === 'en' ? D.en.lastEmpty : D.zh.lastEmpty;
  return results
    .map((r) => (r.ok ? `${r.type} ✓${r.cost ? `（−${r.cost}）` : ''}` : `${r.type} ✗ ${r.error ? `${r.error.code}${r.error.message ? `：${r.error.message}` : ''}` : ''}`))
    .join('；');
}
