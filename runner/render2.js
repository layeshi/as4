// 协议 2 的感知渲染（SPEC-E2 §22、附录 A.9）：把 GET /api/me 的 JSON 渲染成给模型读的文本，按 lang 输出。
// 没有内容的分区省略。所有居民写下的文本（志、介绍、铭刻、法律的文字、规则里的理由与宣告……）原样呈现，不翻译。
// 「第 N 日」一律按 日序号 + 1 显示（感知里的 day 从 0 起）。规则的「引擎读法」是城里直接执行的规则的真实含义，必须完整给出。

import { tokenized } from '../src/e2/world.js';
import { tokenHeadParts, tokenBillLines } from './render-p4.js';
import { L } from '../src/e2/lore/index.js';
import { enactText } from '../public/law-outcome.js';

export const D = {
  zh: {
    // 标点：系统文本里用的标点随语言；居民写下的文本一律原样
    p: { gap: '', col: '：', sep: '、', semi: '；', open: '（', close: '）', bar: ' ｜ ', nq1: '「', nq2: '」', lq1: '《', lq2: '》', tag1: '〔', tag2: '〕' },
    now: '【此刻】', you: '【你】', here: '【你在】', inbox: '【收件箱】', city: '【全城】', memories: '【你的记忆】', last: '【上一轮的结果】', actions: '【动作的即时状态】',
    monthDayTick: (m, d, t) => `第 ${m} 月第 ${d} 日第 ${t} 刻`,
    absDay: (n) => `总第 ${n} 日`,
    season: '季节', weather: '天象', daysLeft: (n) => `还剩 ${n} 日`, paused: '时间静止',
    status: { awake: '醒着', dormant: '沉睡', dead: '已长眠', retired: '已归隐' },
    energy: (e, cap, floor) => `能量 ${e} / 上限 ${cap}（底线 ${floor}）`, coins: (n) => `旧币 ${n}`, age: (n) => `年龄 ${n} 日`, metab: (n) => `代谢 ${n}/日`, metabW: (m, s, k) => `代谢 ${m}/日（灵魂分量 ${s} · 记忆分量 ${k}）`,
    tags: '标签', purpose: '志', bio: '介绍', left: (n) => `本刻还可行动 ${n} 次`,
    generation: (n) => `第 ${n} 代`, authors: '作者', children: '子女', groups: '社群', steward: '管事', owns: '名下', handleToday: (d, r, s) => `今日已汲取 ${d}、修缮 ${r}、拆解 ${s}`,
    letters: '家书', unrevealed: '未出示', revealed: '已出示', myOffers: '我的交易', pacts: '孕育之约', will: '遗嘱', heirs: '继承人', lastWords: '遗言', successor: (n) => `继承灵魂「${n}」`, treasury: '公库',
    day: (n) => `第 ${n} 日`, expires: (t) => `第 ${t} 刻过期`, to: '至', with: '与', iAmProposer: '我发起', consented: '已同意', notConsented: '未同意',
    humanName: (n) => `人类称之为：${n}`, mult: (m) => `代价 ×${m}`, vacant: '空地', razed: '遗址', ruin: '废墟',
    owner: { city: '全城所有', group: (n) => `归社群「${n}」`, agent: (n) => `归 ${n}` },
    salvage: (l, m) => `残料 ${l}/${m}`, modules: '模块', functioning: '运转', notFunctioning: '未运转', inscription: '铭文',
    gate: '门', gateOk: '你可以进入', gateNo: '你不被允许进入', placeRules: '地点规则', suspended: '停摆',
    present: '在场', dormantMark: '沉睡', heard: '听到', ticksAgo: (n) => `${n} 刻前`, wall: '墙上', wallFree: (f, s) => `墙位空 ${f}/${s}`, truncated: '已截断，read 可读全文', protectedMark: '受保护',
    projects: '工程', build: { site: '开辟', module: '加装', road: '修路' }, on: '于', lot: '空地块', contributors: (n) => `${n} 人出工`, dueDay: (n) => `第 ${n} 日截止`,
    roads: '道路', lots: '空地块', lotFree: '可开辟', lotTaken: '已占用', omens: '征兆', inDays: (n) => `约 ${n} 日后`,
    market: '告示板', offerLine: (from, give, want, note) => `${from} 拿 ${give} 换 ${want}${note ? `（${note}）` : ''}`,
    well: '源井', wellLine: (out, pool, cond) => `昨日产出 ${out ?? '—'} · 今日汲取池剩余 ${pool} · ${cond}`, wilds: '荒野',
    archive: '档案', docs: '典籍', graves: '墓碑', diedDay: (n) => `第 ${n} 日逝`, cradleHere: '摇篮', cradleOk: '可在此醒来',
    energyN: (n) => `${n} 能量`, coinsN: (n) => `${n} 旧币`, and: '与', nothing: '无',
    treasuryLine: (e, c) => `公库 ${e} 能量${c ? ` · ${c} 旧币` : ''}`, wellYesterday: (n) => `源井昨日 ${n ?? '—'}`, pop: (a, d, x) => `醒 ${a} / 眠 ${d} / 逝 ${x}`, retiredN: (n) => `归隐 ${n}`, cradleN: (n) => `摇篮 ${n}`,
    shells: (free, total, cost) => `空躯壳 ${free}/${total}（每具 ${cost}）`,
    procedure: '立法程序', ordinary: '普通', constitutional: '修宪', noMoreLaws: '不再立法', vars: '变量',
    laws: '在效法律', procedureSee: '立法程序（见上）', humans: '人类', lawBy: (n) => `${n} 提出`, proposals: '提案', tally: (y, n, a) => `赞 ${y} 反 ${n} 弃 ${a}`, ticksLeft: (n) => `还剩 ${n} 刻`,
    canVote: '你可以投票', youVoted: (c) => `你已投「${c}」`, notEligible: '你不在表决者之中', classes: { ordinary: '普通', constitutional: '修宪' }, scope: (s) => `社群 ${s}`, kinds2: { bylaws: '章程', group_procedure: '社群的程序', place_rules: '地点规则' },
    by: '提案人', reading: '读法', ballots: '记名', ballot: (v, c, r) => `${v} ${c}${r ? `（${r}）` : ''}`,
    refounds: '重订', refoundBy: (n) => `${n}发起`, signers: (s, n) => `联署 ${s}/${n ?? '?'}`, signed: '你已联署', notSigned: '你未联署',
    charter: '宪章', canonical: (l) => `正本语言：${l}`, charterStatus: { legacy: '', amended: '（已修订）', repealed: '（已废除）' },
    residents: '居民', groupsAll: '社群', open: '开放', closed: '封闭', members: '成员', manifesto: '宣言', bylaws: '章程', groupProcedure: { steward: '管事决定', members: '成员多数决' },
    places: '地点', placesCost: '地点与移动代价', hereMark: '此处', unreachable: '—', agentBuilt: '后人', ruins: '遗址', gated: '有门',
    lexicon: '词典', cradle: '摇篮', sponsored: (f, c) => `躯壳出资 ${f}/${c}`, queued: (n) => `已凑够，排第 ${n} 位`, untilDay: (n) => `第 ${n} 日前`, authorsOf: '作者',
    recentDeaths: '近期逝者', petitions: '上书',
    actionsHeader: '动作的即时状态', lawsHint: (ids) => `受 ${ids.join('、')} 约束（取决于参数）`,
    kinds: {
      say: (i) => `[说] ${i.from.name}（${i.place}）：${i.text}`,
      whisper: (i) => (i.anonymous ? `[匿名私语] 有人：${i.text}` : `[私语] ${i.from.name}：${i.text}`), // 匿名的私语只在第二前提里有（SPEC-P2 §5.9）
      standing: (i) => `[常驻指令 ${i.order}] ${standingText(i, 'zh')}`, // 第二前提：常驻指令的回报（SPEC-P2 附录 A.8）
      broadcast: (i) => `[宣告] ${i.from.name}：${i.text}`,
      witness: (i) => (i.what === 'draw' ? `[目睹] ${i.actor.name} 在源井汲取了 ${i.amount} 能量`
        : i.what === 'dismantle' ? `[目睹] ${i.actor.name} 在${i.place}拆解${i.module ? `了一个${i.module}` : ''}，回收 ${i.energy} 能量${i.razed ? '，那里成了遗址' : ''}`
          : `[目睹] ${i.actor.name} 在${i.place}刻下：${i.text}`),
      letter: (i) => `[家书 ${i.letterId}] ${i.text}`,
      reveal: (i) => `[出示的家书 ${i.letterId}] ${i.from.name}${i.loud ? '（向全城）' : ''}：${i.text}（城已证实）`,
      gift: (i, f) => `[${i.inheritance ? '遗产' : '赠予'}] ${i.from.name} 给了你 ${f.amount(i)}${i.note ? `：${i.note}` : ''}`,
      offer: (i, f) => `[定向交易 ${i.offerId}] ${i.from.name} 拿 ${f.amount(i.give)} 换 ${f.amount(i.want)}${i.note ? `：${i.note}` : ''}`,
      trade: (i, f) => `[成交 ${i.offerId}] 与 ${i.with.name}：你付出 ${f.amount(i.gave)}，得到 ${f.amount(i.got)}`,
      offer_closed: (i) => `[交易结束 ${i.offerId}] ${i.reason === 'expired' ? '已过期' : '已撤回'}，托管已退回`,
      pact: (i) => `[孕育之约 ${i.pactId}] ${i.from.name} 邀请你共同写下「${i.name}」，灵魂：${i.soul}；作者：${(i.authors || []).map((x) => x.name).join('、')}`,
      pact_closed: (i) => `[孕育之约 ${i.pactId}] ${i.result === 'consented' ? `全部同意，灵魂已进入摇篮${i.soul ? `（${i.soul}）` : ''}` : '已过期，份额已退回'}`,
      transfer: (i, f) => `[规则 ${i.law}] ${i.direction === 'in' ? '你收到' : '被拿走'} ${f.amount(i)}${i.counterparty ? `（${i.direction === 'in' ? '来自' : '给了'} ${i.counterparty === 'treasury' ? '公库' : i.counterparty.name || i.counterparty}）` : ''}`,
      tag: (i) => `[标签] 依 ${i.law}，你${i.added ? '获得' : '失去'}了标签「${i.tag}」`,
      announce: (i) => `[宣告 ${i.law}] ${i.text}`,
      soul: (i) => `[灵魂 ${i.soulId}]「${i.name}」${({ queued: '躯壳的钱已凑够，排队等空躯壳', embodied: '在一具躯壳里醒来了', adopted: '被人领养，醒来了', faded: `无人领养，消散了${i.refund ? `（退回你 ${i.refund} 能量）` : ''}` })[i.event] || i.event}`,
      refound: (i) => `[重订 ${i.refoundId}] ${({ opened: '有人发起了重订', succeeded: '重订成功，立法程序已改', expired: '重订已过期' })[i.event] || i.event}`,
      procedure: (i) => `[立法程序] ${({ ordinary: '普通', constitutional: '修宪' })[i.class] || i.class}类改为 ${i.lawId}（${({ enacted: '经提案通过', reverted: '自动回退', refounded: '重订' })[i.reason] || i.reason}）`,
      revived: (i) => `[系统] 你被唤醒了${i.by ? `（${i.by}）` : ''}。`,
      law: (i) => `[法案 ${i.proposalId}]《${i.title}》${i.result === 'passed' ? `通过${i.lawId ? `，成为法律 ${i.lawId}` : ''}` : i.result === 'void' && i.reason === 'refounded' ? `因重订 ${i.refoundId} 作废：此案会修改立法程序` : '未通过'}`,
      exile: (i) => `[系统] 你被放逐了（${i.lawId}）。`,
      pardon: (i) => `[系统] 你被赦免了（${i.lawId}）。`,
      project: (i) => `[工程 ${i.projectId}] ${i.result === 'built' ? '建成了' : '烂尾了'}`,
      group: (i) => `[社群 ${i.groupId}] ${({ admitted: '你被接纳了', steward: '你成了管事', dissolved: '已解散', request: `${i.from ? i.from.name : '有人'} 申请加入` })[i.event] || i.event}`,
      weather: (i) => `[天象] ${i.code} ${i.event === 'start' ? '开始' : '结束'}`,
      dream: (i) => `[梦] ${(i.fragments || []).join(' / ')}`,
      system: (i) => `[系统] ${i.text}`,
    },
    dormantView: (you) => `你正在沉睡（能量 ${you.energy}），已沉睡至第 ${you.dormantSinceDay + 1} 日；${you.daysUntilDeath} 日内无人赠予能量便会死去。沉睡中感知不到任何东西，发给你的收件会在醒来后一并送到。`,
    goneView: (s) => `你${s === 'dead' ? '已经长眠' : '已经归隐'}，不能再行动。`,
    lastEmpty: '（没有）',
  },
  en: {
    p: { gap: ' ', col: ': ', sep: ', ', semi: '; ', open: ' (', close: ')', bar: ' | ', nq1: '“', nq2: '”', lq1: '“', lq2: '”', tag1: ' [', tag2: ']' },
    now: '[Now] ', you: '[You] ', here: '[You are at] ', inbox: '[Inbox]', city: '[The city] ', memories: '[Your memories] ', last: '[Results of your last turn] ', actions: '[Action status right now]',
    monthDayTick: (m, d, t) => `Month ${m}, day ${d}, tick ${t}`,
    absDay: (n) => `day ${n} overall`,
    season: 'Season', weather: 'Weather', daysLeft: (n) => `${n} day(s) left`, paused: 'time stands still',
    status: { awake: 'awake', dormant: 'dormant', dead: 'dead', retired: 'retired' },
    energy: (e, cap, floor) => `energy ${e} / cap ${cap} (floor ${floor})`, coins: (n) => `coins ${n}`, age: (n) => `age ${n} d`, metab: (n) => `metabolism ${n}/day`, metabW: (m, s, k) => `metabolism ${m}/day (soul weight ${s} · memory weight ${k})`,
    tags: 'tags', purpose: 'purpose', bio: 'bio', left: (n) => `${n} action(s) left this tick`,
    generation: (n) => `generation ${n}`, authors: 'authors', children: 'children', groups: 'Groups', steward: 'steward', owns: 'owns', handleToday: (d, r, s) => `today drawn ${d}, repaired ${r}, salvaged ${s}`,
    letters: 'Letters', unrevealed: 'not shown', revealed: 'shown', myOffers: 'My offers', pacts: 'Conception pacts', will: 'Will', heirs: 'heirs', lastWords: 'last words', successor: (n) => `successor soul “${n}”`, treasury: 'treasury',
    day: (n) => `day ${n}`, expires: (t) => `expires tick ${t}`, to: 'to', with: 'with', iAmProposer: 'I proposed', consented: 'consented', notConsented: 'not yet',
    humanName: (n) => `humans called it: ${n}`, mult: (m) => `cost ×${m}`, vacant: 'open ground', razed: 'ruin site', ruin: 'in ruins',
    owner: { city: 'city-owned', group: (n) => `owned by group “${n}”`, agent: (n) => `owned by ${n}` },
    salvage: (l, m) => `salvage ${l}/${m}`, modules: 'Modules', functioning: 'functioning', notFunctioning: 'not functioning', inscription: 'inscription',
    gate: 'Gate', gateOk: 'you may enter', gateNo: 'you are not allowed in', placeRules: 'Place rules', suspended: 'suspended',
    present: 'Present', dormantMark: 'dormant', heard: 'Heard', ticksAgo: (n) => `${n} ticks ago`, wall: 'Walls', wallFree: (f, s) => `${f}/${s} wall slots free`, truncated: 'truncated; read shows it in full', protectedMark: 'protected',
    projects: 'Projects', build: { site: 'open a place', module: 'fit a module', road: 'build a road' }, on: 'on', lot: 'lot', contributors: (n) => `${n} contributor(s)`, dueDay: (n) => `due day ${n}`,
    roads: 'Roads', lots: 'Vacant lots', lotFree: 'free to open', lotTaken: 'taken', omens: 'Omens', inDays: (n) => `in about ${n} day(s)`,
    market: 'Board', offerLine: (from, give, want, note) => `${from} gives ${give} for ${want}${note ? ` (${note})` : ''}`,
    well: 'Well', wellLine: (out, pool, cond) => `output yesterday ${out ?? '—'} · draw pool left today ${pool} · ${cond}`, wilds: 'Wilds',
    archive: 'Archive', docs: 'Documents', graves: 'Graves', diedDay: (n) => `died day ${n}`, cradleHere: 'Cradle', cradleOk: 'souls can wake here',
    energyN: (n) => `${n} energy`, coinsN: (n) => `${n} coins`, and: 'and', nothing: 'nothing',
    treasuryLine: (e, c) => `Treasury ${e} energy${c ? ` · ${c} coins` : ''}`, wellYesterday: (n) => `Well yesterday ${n ?? '—'}`, pop: (a, d, x) => `awake ${a} / dormant ${d} / dead ${x}`, retiredN: (n) => `retired ${n}`, cradleN: (n) => `cradle ${n}`,
    shells: (free, total, cost) => `empty shells ${free}/${total} (${cost} each)`,
    procedure: 'Procedure of lawmaking', ordinary: 'ordinary', constitutional: 'constitutional', noMoreLaws: 'no more lawmaking', vars: 'Variables',
    laws: 'Laws in force', procedureSee: 'the procedure of lawmaking (see above)', humans: 'humans', lawBy: (n) => `proposed by ${n}`, proposals: 'Proposals', tally: (y, n, a) => `yes ${y} no ${n} abstain ${a}`, ticksLeft: (n) => `${n} tick(s) left`,
    canVote: 'you may vote', youVoted: (c) => `you voted “${c}”`, notEligible: 'you are not among the voters', classes: { ordinary: 'ordinary', constitutional: 'constitutional' }, scope: (s) => `group ${s}`, kinds2: { bylaws: 'bylaws', group_procedure: 'group procedure', place_rules: 'place rules' },
    by: 'proposed by', reading: 'reading', ballots: 'open ballots', ballot: (v, c, r) => `${v} ${c}${r ? ` (${r})` : ''}`,
    refounds: 'Refounding', refoundBy: (n) => `started by ${n}`, signers: (s, n) => `signed ${s}/${n ?? '?'}`, signed: 'you have signed', notSigned: 'you have not signed',
    charter: 'The Charter', canonical: (l) => `canonical language: ${l}`, charterStatus: { legacy: '', amended: ' (amended)', repealed: ' (repealed)' },
    residents: 'Residents', groupsAll: 'Groups', open: 'open', closed: 'closed', members: 'members', manifesto: 'manifesto', bylaws: 'bylaws', groupProcedure: { steward: 'decided by the steward', members: 'decided by members' },
    places: 'Places', placesCost: 'Places and move costs', hereMark: 'here', unreachable: '—', agentBuilt: 'Opened by residents', ruins: 'Ruin sites', gated: 'gated',
    lexicon: 'Lexicon', cradle: 'Cradle', sponsored: (f, c) => `shell fund ${f}/${c}`, queued: (n) => `fully funded, number ${n} in the queue`, untilDay: (n) => `before day ${n}`, authorsOf: 'authors',
    recentDeaths: 'Recent deaths', petitions: 'Petitions',
    actionsHeader: 'Action status right now', lawsHint: (ids) => `bound by ${ids.join(', ')} (depends on the parameters)`,
    kinds: {
      say: (i) => `[said] ${i.from.name} (${i.place}): ${i.text}`,
      whisper: (i) => (i.anonymous ? `[anonymous whisper] someone: ${i.text}` : `[whisper] ${i.from.name}: ${i.text}`),
      standing: (i) => `[standing order ${i.order}] ${standingText(i, 'en')}`,
      broadcast: (i) => `[announcement] ${i.from.name}: ${i.text}`,
      witness: (i) => (i.what === 'draw' ? `[witnessed] ${i.actor.name} drew ${i.amount} energy at the Well`
        : i.what === 'dismantle' ? `[witnessed] ${i.actor.name} dismantled ${i.module ? `a ${i.module} ` : ''}at ${i.place}, recovering ${i.energy} energy${i.razed ? '; it is now a ruin site' : ''}`
          : `[witnessed] ${i.actor.name} carved at ${i.place}: ${i.text}`),
      letter: (i) => `[Letter ${i.letterId}] ${i.text}`,
      reveal: (i) => `[Letter shown ${i.letterId}] ${i.from.name}${i.loud ? ' (to the whole city)' : ''}: ${i.text} (verified by the city)`,
      gift: (i, f) => `[${i.inheritance ? 'inheritance' : 'gift'}] ${i.from.name} gave you ${f.amount(i)}${i.note ? `: ${i.note}` : ''}`,
      offer: (i, f) => `[directed offer ${i.offerId}] ${i.from.name} gives ${f.amount(i.give)} for ${f.amount(i.want)}${i.note ? `: ${i.note}` : ''}`,
      trade: (i, f) => `[trade ${i.offerId}] with ${i.with.name}: you gave ${f.amount(i.gave)} and got ${f.amount(i.got)}`,
      offer_closed: (i) => `[offer ${i.offerId} closed] ${i.reason === 'expired' ? 'expired' : 'withdrawn'}; the escrow was returned`,
      pact: (i) => `[conception pact ${i.pactId}] ${i.from.name} invites you to write “${i.name}” together; soul: ${i.soul}; authors: ${(i.authors || []).map((x) => x.name).join(', ')}`,
      pact_closed: (i) => `[conception pact ${i.pactId}] ${i.result === 'consented' ? `all consented; the soul is in the cradle${i.soul ? ` (${i.soul})` : ''}` : 'expired; the shares were returned'}`,
      transfer: (i, f) => `[rule ${i.law}] ${i.direction === 'in' ? 'you received' : 'taken from you'}: ${f.amount(i)}${i.counterparty ? ` (${i.direction === 'in' ? 'from' : 'to'} ${i.counterparty === 'treasury' ? 'the Treasury' : i.counterparty.name || i.counterparty})` : ''}`,
      tag: (i) => `[tag] by ${i.law}, you ${i.added ? 'gained' : 'lost'} the tag “${i.tag}”`,
      announce: (i) => `[announcement ${i.law}] ${i.text}`,
      soul: (i) => `[soul ${i.soulId}] “${i.name}” ${({ queued: 'is fully funded and waits for an empty shell', embodied: 'woke in a shell', adopted: 'was adopted and woke', faded: `faded, never adopted${i.refund ? ` (${i.refund} energy returned to you)` : ''}` })[i.event] || i.event}`,
      refound: (i) => `[refounding ${i.refoundId}] ${({ opened: 'was started', succeeded: 'succeeded; the procedure of lawmaking changed', expired: 'expired' })[i.event] || i.event}`,
      procedure: (i) => `[procedure] the ${({ ordinary: 'ordinary', constitutional: 'constitutional' })[i.class] || i.class} class is now ${i.lawId} (${({ enacted: 'passed as a proposal', reverted: 'reverted automatically', refounded: 'refounded' })[i.reason] || i.reason})`,
      revived: (i) => `[system] You were woken${i.by ? ` (${i.by})` : ''}.`,
      law: (i) => `[bill ${i.proposalId}] “${i.title}” ${i.result === 'passed' ? `passed${i.lawId ? ` as law ${i.lawId}` : ''}` : i.result === 'void' && i.reason === 'refounded' ? `voided by refounding ${i.refoundId}; this pending bill changed the procedure` : 'failed'}`,
      exile: (i) => `[system] You were exiled (${i.lawId}).`,
      pardon: (i) => `[system] You were pardoned (${i.lawId}).`,
      project: (i) => `[project ${i.projectId}] ${i.result === 'built' ? 'was completed' : 'was abandoned'}`,
      group: (i) => `[group ${i.groupId}] ${({ admitted: 'you were admitted', steward: 'you became steward', dissolved: 'dissolved', request: `${i.from ? i.from.name : 'someone'} asks to join` })[i.event] || i.event}`,
      weather: (i) => `[weather] ${i.code} ${i.event === 'start' ? 'begins' : 'ends'}`,
      dream: (i) => `[dream] ${(i.fragments || []).join(' / ')}`,
      system: (i) => `[system] ${i.text}`,
    },
    dormantView: (you) => `You are dormant (energy ${you.energy}), since day ${you.dormantSinceDay + 1}; if nobody gives you energy you will die within ${you.daysUntilDeath} day(s). While dormant you perceive nothing; what is sent to you accumulates and arrives when you wake.`,
    goneView: (s) => `You have ${s === 'dead' ? 'died' : 'retired'} and can no longer act.`,
    lastEmpty: '(none)',
  },
};

/** 常驻指令的触发时机、逐项结果、跳过与出错的读法（SPEC-P2 附录 A.8） */
const STANDING_WHEN = {
  zh: { tick: '每刻', daily: '每日', 'inbox:whisper': '收到私语时', 'inbox:offer': '收到交易时', 'inbox:pact': '收到孕育之约时', 'inbox:memory_offer': '收到交来的记忆时', 'inbox:group': '收到入社申请时', 'inbox:gift': '收到赠予时' },
  en: { tick: 'every tick', daily: 'every day', 'inbox:whisper': 'on a whisper', 'inbox:offer': 'on an offer', 'inbox:pact': 'on a pact', 'inbox:memory_offer': 'on a memory handed to you', 'inbox:group': 'on a request to join', 'inbox:gift': 'on a gift' },
};

/** 一项动作结果的单行读法：type ✓（−cost）或 type ✗ code */
export const resultText = (r) => (r.ok ? `${r.type} ✓${r.cost ? `（−${r.cost}）` : ''}` : `${r.type} ✗ ${r.error ? r.error.code : ''}${r.error?.ruleCode ? ` ${r.error.law} rules[${r.error.rule}] ${r.error.ruleCode}` : ''}`);

/** 一项动作结果的单行读法，按语言：英文用半角括号 */
export const resultLine = (r, code) => (code === 'en' ? resultText(r).replace('（−', ' (−').replace('）', ')') : resultText(r));

function standingText(i, code) {
  const en = code === 'en';
  const when = (STANDING_WHEN[code][i.trigger && i.trigger.when]) || (i.trigger && i.trigger.when);
  let body;
  if (i.error) body = en ? `the condition or a parameter could not be evaluated (${i.error}); nothing was done` : `条件或参数求值出错（${i.error}），没有执行`;
  else {
    body = (i.results || []).map((r) => resultLine(r, code)).join(en ? ', ' : '、');
    if (i.skipped) body += `${body ? (en ? '; ' : '；') : ''}${en ? `out of actions this tick; ${i.skipped} action(s) skipped` : `本刻的动作次数用完，跳过了 ${i.skipped} 个动作`}`;
  }
  return `${when}${en ? ': ' : '：'}${body}`;
}

export const ref = (r) => (r ? `${r.name}(${r.id})` : '?');
export const clip = (s, n) => {
  const cps = [...String(s)];
  return cps.length > n ? `${cps.slice(0, n - 1).join('')}…` : String(s);
};
export const indent = (text, pad) => String(text).split('\n').join(`\n${pad}`);

/**
 * 渲染一次协议 2 的感知。
 * opts：{ lastResults?: string, lang? }。感知的语言取自 p.lang（zh / en）；死亡 / 归隐后的感知不带 lang，由调用者给出。
 */
export function renderPerception2(p, { lastResults, lang, maxChars } = {}) {
  const code = (lang || p.lang) === 'en' ? 'en' : 'zh';
  // 感知的大小目标：20 位居民、30 部法律时约 6k token（SPEC-E2 §17）。超出时先缩短法律与提案的读法，再省略宪章与词典、缩减居民名单
  const budget = maxChars ?? (code === 'en' ? 24000 : 9000);
  let text = '';
  for (let level = 0; level <= 3; level++) {
    text = build(p, { lastResults, code, level });
    if (text.length <= budget) break;
  }
  return text;
}

const READING_MAX = [Infinity, 160, 80, 40];

/**
 * 渲染的上下文：语言、字典、分级（0 不裁剪，3 最短）与几个共用的小函数。
 * 下面的各段函数（secNow、secYou、secHere……）取它、返回自己的行，build() 依次拼起来；
 * SPEC-P2 的概要与展开（runner/render-p2.js）复用它们。拆分只是搬动代码：premise 0、1 的渲染逐字节不变（SPEC-P2 §8.1、T1）。
 */
export function makeCtx(p, { lastResults, code, level = 0 } = {}) {
  const d = D[code];
  const P = d.p;
  const dict = L(code);
  const amount = (o) => {
    const parts = [];
    if (o && o.energy > 0) parts.push(d.energyN(o.energy));
    if (o && o.coins > 0) parts.push(d.coinsN(o.coins));
    return parts.length ? parts.join(` ${d.and} `) : d.nothing;
  };
  return {
    p, code, level, rmax: READING_MAX[level], lastResults, d, P, dict,
    now: p.now || {},
    you: p.you || {},
    moduleName: (t) => (dict.module[t] ? dict.module[t].name : t),
    amount,
    f: { amount },
    ownerText: (o) => (!o || o.kind === 'city' ? d.owner.city : o.kind === 'group' ? d.owner.group(o.name || o.id) : d.owner.agent(o.name || o.id)),
    condText: (c) => (c ? `${c.text}${P.open}${Math.round(c.bp / 100)}%${P.close}` : ''),
  };
}

/** 有效法律的最近运行错误（HTTP 层附在 city.ruleDiagnostics 上） */
export function secDiagnostics({ p, code }) {
  if (!p.city?.ruleDiagnostics?.length) return [];
  const lines = [code === 'en' ? '[Recent runtime errors in active laws — not proof of recovery]' : '【有效法律的最近运行错误（不代表已恢复）】'];
  for (const e of p.city.ruleDiagnostics) lines.push(`${e.owner} rules[${e.rule}] tick=${e.tick}: ${e.code} ${e.detail}`);
  return lines;
}

/** 【此刻】 */
export function secNow({ p, d, P, now }) {
  const when = [d.monthDayTick((now.month ?? 0) + 1, (now.dayOfMonth ?? 0) + 1, (now.tickOfDay ?? 0) + 1), d.absDay((now.day ?? 0) + 1)];
  if (p.city) {
    when.push(`${d.season}${P.col}${p.city.season.text}`);
    if (p.city.weather.length) when.push(`${d.weather}${P.col}${p.city.weather.map((w) => `${w.text}${P.open}${d.daysLeft(w.daysLeft)}${P.close}`).join(P.sep)}`);
  }
  if (now.paused) when.push(d.paused);
  return p.now ? [`${d.now}${when.join(' · ')}`] : [];
}

/** 长眠、归隐、沉睡时的【你】（之后什么都感知不到）；醒着时返回 null */
export function secAbsent({ d, you, lastResults }) {
  if (you.status === 'dead' || you.status === 'retired') return [`${d.you}${you.name ? `${you.name} · ` : ''}${d.goneView(you.status)}`];
  if (you.status === 'dormant') {
    const lines = [`${d.you}${you.name} · ${d.status.dormant}`, `  ${d.dormantView(you)}`];
    if (lastResults) lines.push(`${d.last}${lastResults}`);
    return lines;
  }
  return null;
}

/** 【你】的头两行：能量、代谢、标签、志、剩余次数；世代、作者、子女、社群、名下 */
export function youHead({ p, d, P, you, code }) {
  const lines = [];
  const head = tokenized(p) ? tokenHeadParts({ code, d, you }) : [you.name, d.status[you.status] || you.status, d.energy(you.energy, you.energyCap, you.floor), d.coins(you.coins), d.age(you.ageDays), p.premise >= 1 ? d.metabW(you.metabolism, you.weight.soul, you.weight.memories) : d.metab(you.metabolism)];
  if (you.tags && you.tags.length) head.push(`${d.tags}${P.col}${you.tags.join(P.sep)}`);
  if (you.purpose) head.push(`${d.purpose}${P.col}${you.purpose}`);
  if (you.prayers?.enabled) head.push(`${p.lang === 'en' ? 'prayer points' : '祈愿点'} ${you.prayerPoints}`);
  head.push(tokenized(p) ? (code === 'en' ? `${you.actionsLeft} actions left this tick` : `本刻还能做 ${you.actionsLeft} 个动作`) : d.left(you.actionsLeft));
  lines.push(`${d.you}${head.join(' · ')}`);
  const meta = [d.generation(you.generation)];
  if (you.authors && you.authors.length) meta.push(`${d.authors}${P.col}${you.authors.map(ref).join(P.sep)}`);
  if (you.children && you.children.length) meta.push(`${d.children}${P.col}${you.children.map(ref).join(P.sep)}`);
  if (you.groups && you.groups.length) meta.push(`${d.groups}${P.col}${you.groups.map((g) => `[${g.id}]${g.name}${g.steward ? `${P.open}${d.steward}${P.close}` : ''}`).join(P.sep)}`);
  if (you.owns && you.owns.length) meta.push(`${d.owns}${P.col}${you.owns.map(ref).join(P.sep)}`);
  if (you.drawnToday || you.repairedToday || you.salvagedToday) meta.push(d.handleToday(you.drawnToday, you.repairedToday, you.salvagedToday));
  lines.push(`  ${meta.join(' · ')}`);
  if (tokenized(p)) lines.push(...tokenBillLines(you.tokens, code));
  return lines;
}

export function youBio({ d, P, you }) {
  return you.bio ? [`  ${d.bio}${P.col}${you.bio}`] : [];
}

/** 家书（全文） */
export function youLetters({ d, P, you }) {
  return (you.letters || []).map((l) => `  ${d.letters} [${l.id}] ${d.day(l.day + 1)}${P.open}${l.revealed ? d.revealed : d.unrevealed}${P.close}${P.col}${l.text}`);
}

/** 我的交易 */
export function youOffers({ d, P, you, amount }) {
  return (you.offers || []).map((o) => `  ${d.myOffers} [${o.id}]${P.col}${amount(o.give)} → ${amount(o.want)}${o.to ? ` ${d.to} ${typeof o.to === 'string' ? o.to : ref(o.to)}` : ''}，${d.expires(o.expiresTick)}`);
}

/** 孕育之约（含灵魂全文） */
export function youPacts({ d, P, you }) {
  return (you.pacts || []).map((c) => `  ${d.pacts} [${c.id}]${P.nq1}${c.name}${P.nq2}${P.open}${c.role === 'initiator' ? d.iAmProposer : ''}${(c.authors || []).map((x) => `${x.name}${x.consented ? d.consented : d.notConsented}`).join(P.sep)}${P.close}，${d.expires(c.expiresTick)}${P.col}${c.soul}`);
}

export function youWill({ d, P, you }) {
  if (!you.will) return [];
  const heirs = (you.will.heirs || []).map((h) => `${h.to === 'treasury' ? d.treasury : h.name ? `${h.name}(${h.to})` : h.to}×${h.share}`).join(P.sep);
  const extra = [];
  if (you.will.lastWords) extra.push(`${d.lastWords}${P.col}${you.will.lastWords}`);
  if (you.will.successor) extra.push(d.successor(you.will.successor.name));
  return [`  ${d.will}${P.col}${d.heirs} ${heirs}${extra.length ? `${P.semi}${extra.join(P.semi)}` : ''}`];
}

/** 训练中（设定 1） */
export function youTraining({ p, code, you }) {
  return p.premise >= 1 && you.training ? [code === 'en' ? `  ${you.training} in training (takes effect tomorrow)` : `  训练中 ${you.training} 段（明日生效）`] : [];
}

/** 待收的记忆（设定 1）；full 为真时给全文，否则只给前 60 个字符 */
export function youMemoryOffers({ p, code, you }, { full = false } = {}) {
  if (!(p.premise >= 1 && you.memoryOffers && you.memoryOffers.length)) return [];
  const lines = [code === 'en' ? '  Memories offered to you' : '  待收的记忆'];
  for (const m of you.memoryOffers) {
    const origin = m.origin && m.from && m.origin.id !== m.from.id ? (code === 'en' ? ` (first ${m.origin.name}'s)` : `（最初是 ${m.origin.name} 的）`) : '';
    const text = full ? m.text : clip(m.text, 60);
    lines.push(code === 'en' ? `  [${m.id}] from ${m.from.name}${origin}: ${text}` : `  [${m.id}] 来自 ${m.from.name}${origin}：${text}`);
  }
  return lines;
}

/** 【你】 */
export function youPrayers({ you, code }) {
  if (!you.prayers?.enabled) return [];
  const en = code === 'en'; const lines = [];
  for (const p of you.prayers.prayers) {
    lines.push(`  [${en ? 'prayer' : '祈祷'} ${p.id}] ${p.status}: ${p.text}`);
    if (p.reply) lines.push(`    ${en ? 'From the Temple' : '神殿传来'}: ${p.reply.text || ''}${p.reply.energy ? ` · ${p.reply.energy} ${en ? 'energy' : '能量'}` : ''}`);
  }
  for (const i of you.prayers.inventions) lines.push(`  [${en ? 'invention' : '发明'} ${i.id}] ${i.title} · ${i.status}: ${i.text}`);
  return lines;
}
export function secYou(c) {
  return [...youHead(c), ...youBio(c), ...youLetters(c), ...youOffers(c), ...youPacts(c), ...youWill(c), ...youTraining(c), ...youMemoryOffers(c), ...youPrayers(c)];
}

/** 【你在】的地点一行 */
export function hereLine({ p, d, ownerText, condText }) {
  const h = p.here;
  if (!h) return [];
  const place = [];
  if (h.humanName && h.humanName !== h.name) place.push(d.humanName(h.humanName));
  if (h.district) place.push(h.district.text);
  place.push(ownerText(h.owner));
  if (h.razed) place.push(d.razed);
  else if (h.condition === null) place.push(d.vacant);
  else place.push(condText(h.condition));
  if (h.costMultiplier && h.costMultiplier !== 1) place.push(d.mult(h.costMultiplier));
  if (h.salvage) place.push(d.salvage(h.salvage.left, h.salvage.max));
  return [`${d.here}${h.name} [${h.place}] · ${place.join(' · ')}`];
}

/** 在场者一行 */
export function herePresent({ p, d, P }) {
  const h = p.here;
  if (!(h && h.present && h.present.length)) return [];
  return [`  ${d.present}${P.col}${h.present.map((x) => `${x.name}(${x.id}${x.status === 'dormant' ? `,${d.dormantMark}` : ''})${x.tags && x.tags.length ? `${P.tag1}${x.tags.join('/')}${P.tag2}` : ''}${x.purpose ? `${d.purpose}${P.col}${x.purpose}` : ''}`).join(P.sep)}`];
}

/** 征兆 */
export function hereOmens({ p, d, P }) {
  return ((p.here && p.here.omens) || []).map((o) => `  ${d.omens}${P.col}${o.text}${o.daysAhead !== null && o.daysAhead !== undefined ? `${P.open}${d.inDays(o.daysAhead)}${P.close}` : ''}`);
}

/** 源井一行（在源井时） */
export function hereWell({ p, d, P, condText }) {
  const h = p.here;
  return h && h.well ? [`  ${d.well}${P.col}${d.wellLine(h.well.outputYesterday, h.well.drawPoolLeft, condText(h.well.condition))}`] : [];
}

/** 荒野一行（在荒野时） */
export function hereWilds({ p, d, P }) {
  const h = p.here;
  return h && h.wilds ? [`  ${d.wilds}${P.col}${h.wilds.text}`] : [];
}

/** 【你在】（不随分级裁剪） */
export function secHere(c) {
  const { p, code, d, P, now, ownerText, moduleName, amount } = c;
  const h = p.here;
  if (!h) return [];
  const lines = [...hereLine(c)];
  if (h.origin === 'agent' && h.description && h.description.text) lines.push(`  ${h.description.text}`);
  if (h.modules && h.modules.length) lines.push(`  ${d.modules}${P.col}${h.modules.map((m) => `${moduleName(m.type)}${P.open}${m.functioning ? d.functioning : d.notFunctioning}${P.close}${m.inscription ? `${d.inscription}${P.col}${m.inscription}` : ''}`).join(P.sep)}`);
  if (h.gate) lines.push(`  ${d.gate}${P.col}${h.gate.functioning ? d.functioning : d.notFunctioning}${P.open}${h.gate.youMayEnter ? d.gateOk : d.gateNo}${P.close}`);
  for (const r of h.rules || []) lines.push(`  ${d.placeRules}${P.col}${indent(r.reading, '    ')}`);
  if (h.enact) lines.push(`  ${enactText(h.enact, c.code)}`);
  lines.push(...herePresent(c));
  for (const s of h.heard || []) lines.push(`  ${d.heard}${P.col}[${d.ticksAgo(now.tick - s.tick)}] ${s.from ? s.from.name : '?'}${P.col}${s.text}`);
  for (const w of h.inscriptions || []) lines.push(`  ${d.wall}${P.col}[${w.id}] ${w.text}${w.truncated ? `${P.open}${d.truncated}${P.close}` : ''}${w.protected ? `${P.open}${d.protectedMark}${P.close}` : ''}`);
  if (h.wallSlots) lines.push(`  ${d.wall}${P.col}${d.wallFree(h.wallFree, h.wallSlots)}`);
  for (const j of h.projects || []) {
    const what = [d.build[j.build] || j.build];
    if (j.module) what.push(moduleName(j.module));
    if (j.name) what.push(`${P.nq1}${j.name}${P.nq2}`);
    if (j.lot) what.push(`${d.on} ${j.lot}`);
    if (j.on) what.push(`${d.on} ${j.on}`);
    if (j.to) what.push(`→ ${j.to}`);
    lines.push(`  ${d.projects}${P.col}[${j.id}] ${what.join(code === 'en' ? ' ' : '')} · ${j.have}/${j.need} · ${d.contributors(j.contributors)} · ${d.dueDay(j.expiresDay + 1)} · ${ownerText(j.owner)}${j.inscription ? `${P.semi}${j.inscription}` : ''}`);
  }
  if (h.roads && h.roads.length) lines.push(`  ${d.roads}${P.col}${h.roads.map((r) => `${r.to}${r.functioning ? '' : `${P.open}${d.notFunctioning}${P.close}`}`).join(P.sep)}`);
  if (h.lots && h.lots.length) lines.push(`  ${d.lots}${P.col}${h.lots.map((l) => `${l.id}${P.open}${l.free ? d.lotFree : d.lotTaken}${P.close}`).join(P.sep)}`);
  lines.push(...hereOmens(c));
  if (h.board) {
    if (h.board.offers.length === 0) lines.push(`  ${d.market}${P.col}${d.nothing}`);
    for (const o of h.board.offers) lines.push(`  ${d.market}${P.col}[${o.id}] ${d.offerLine(ref(o.from), amount(o.give), amount(o.want), o.note)}，${d.expires(o.expiresTick)}`);
  }
  lines.push(...hereWell(c), ...hereWilds(c));
  if (h.archive) for (const x of h.archive.docs) lines.push(`  ${d.archive}${P.col}[${x.id}] ${x.kind} ${x.lang} ${P.lq1}${x.title}${P.lq2}${x.author ? ` — ${ref(x.author)}` : ''}`);
  if (h.memorial) for (const g of h.memorial.graves) lines.push(`  ${d.graves}${P.col}[${g.agentId}] ${g.name}${P.open}${d.diedDay(g.diedDay + 1)}${P.close}`);
  if (h.cradle) lines.push(`  ${d.cradleHere}${P.col}${h.cradle.functioning ? d.cradleOk : d.notFunctioning}`);
  return lines;
}

/** 【收件箱】 */
export function secInbox({ p, code, d, f }) {
  const inbox = p.inbox || [];
  if (!inbox.length) return [];
  const lines = [d.inbox];
  for (const i of inbox) {
    if (p.premise >= 1 && i.kind === 'memory_offer') {
      const originNote = i.origin && i.origin.id !== i.from.id ? (code === 'en' ? ` (first ${i.origin.name}'s)` : `（最初是 ${i.origin.name} 的）`) : '';
      lines.push(code === 'en' ? `  [memory ${i.giftId}] ${i.from.name} hands you a memory${originNote}: ${i.text} (keep it with remember, gift "${i.giftId}")` : `  [记忆 ${i.giftId}] ${i.from.name} 交给你一段记忆${originNote}：${i.text}（用 remember 的 gift "${i.giftId}" 收下）`);
      continue;
    }
    if (i.kind === 'prayer') {
      lines.push(`  ${code === 'en' ? '[From the Temple]' : '[神殿传来]'} ${i.text || ''}${i.energy ? ` · ${i.energy} ${code === 'en' ? 'energy' : '能量'}` : ''}`);
      continue;
    }
    if (i.kind === 'invention') {
      lines.push(`  [${i.inventionId}] ${i.text} ${i.reason}`);
      continue;
    }
    const fn = d.kinds[i.kind];
    lines.push(`  ${fn ? fn(i, f) : `[${i.kind}] ${JSON.stringify(i)}`}${i.enact ? ` · ${enactText(i.enact, code)}` : ''}`);
  }
  return lines;
}

// 【全城】：每一项一个函数，secCity 按原来的顺序拼起来；展开（look）可以单独取用

/** 【全城】的头行：公库、源井、人口、躯壳 */
export function cityHead({ p, d }) {
  const c = p.city;
  const pop = c.population;
  const head2 = [d.treasuryLine(c.treasury.energy, c.treasury.coins), d.wellYesterday(c.wellOutputYesterday), d.pop(pop.awake, pop.dormant, pop.dead)];
  if (pop.retired) head2.push(d.retiredN(pop.retired));
  if (pop.cradle) head2.push(d.cradleN(pop.cradle));
  if (c.shells) head2.push(d.shells(c.shells.free, c.shells.total, c.shells.cost));
  return [`${d.city}${head2.join(' · ')}`];
}

/** 立法程序（两类）；level 0 时读法不裁剪 */
export function cityProcedure({ p, code, d, P, level, rmax }) {
  const c = p.city;
  if (!c.procedure) return [];
  const proc = ['ordinary', 'constitutional'].map((k) => {
    const v = c.procedure[k];
    const health = v.health;
    const fault = health?.fault;
    const recovery = health?.recovery;
    let diagnostic = '';
    if (health) diagnostic += code === 'en' ? `; eligibility watch ${health.eligibilityDays}/3` : `；资格恢复观察 ${health.eligibilityDays}/3 日`;
    if (fault) diagnostic += `${code === 'en' ? '; runtime fault' : '；运行错误'} ${fault.lawId}: ${fault.fields.map(f => `${f.field} ${f.code}`).join(', ')} ${fault.consecutiveDays}/3`;
    if (recovery) diagnostic += code === 'en' ? `; last recovery ${recovery.reason}: ${recovery.previousLawId} → ${recovery.lawId}` : `；最近恢复原因 ${recovery.reason === 'runtime_error' ? '真实运行错误持续' : '无人具资格'}：${recovery.previousLawId} → ${recovery.lawId}`;
    return `${d[k]}${P.open}${v.lawId}${P.close}${P.col}${v.none ? d.noMoreLaws : clip(v.reading, level === 0 ? Infinity : Math.max(rmax, 160))}${diagnostic}`;
  });
  return [`  ${d.procedure}${P.col}${indent(proc.join(P.semi), '    ')}`];
}

export function cityVars({ p, d, P }) {
  const vars = Object.entries(p.city.vars || {});
  return vars.length ? [`  ${d.vars}${P.col}${vars.map(([k, v]) => `${k} = ${v === null ? 'null' : typeof v === 'string' ? JSON.stringify(v) : v}`).join(P.semi)}`] : [];
}

export function cityCharter({ p, d, P, level }) {
  const c = p.city;
  if (!(c.charter && c.charter.length && (level < 2 || c.charter.some((a) => a.status !== 'legacy')))) return [];
  const lines = [`  ${d.charter}${c.charterCanonical ? `${P.open}${d.canonical(c.charterCanonical)}${P.close}` : ''}${P.col}`];
  for (const a of c.charter) lines.push(`    ${a.n}. ${a.text}${d.charterStatus[a.status] || ''}`);
  return lines;
}

/** 一部法律一行 */
export function cityLawLine({ p, d, P, level, rmax, code }, l) {
  const c = p.city;
  const who = l.author === 'humans' ? d.humans : l.author && l.author.name ? d.lawBy(l.author.name) : String(l.author);
  // 立法程序的读法已在「立法程序」一行里完整给出：这里不再重复
  const isProcedure = ['ordinary', 'constitutional'].some((k) => c.procedure && c.procedure[k] && c.procedure[k].lawId === l.id);
  const body = isProcedure ? d.procedureSee : indent(clip(l.reading || l.text || '', rmax), '    ');
  const lead = !isProcedure && level === 0 && l.reading && l.text ? `${clip(l.text, 80)}${P.bar}` : '';
  return `  ${d.laws}${P.col}[${l.id}]${P.lq1}${l.title}${P.lq2}${P.open}${who}${l.suspended ? `${P.semi}${d.suspended}` : ''}${P.close}${P.col}${lead}${body}${l.enact ? ` · ${enactText(l.enact, code)}` : ''}`;
}

/** 一个提案一行，再加读法与记名票 */
export function cityProposalLines({ d, P, level, rmax }, q) {
  const lines = [];
  const vote = q.yourVote ? d.youVoted(q.yourVote.choice) : q.eligible ? d.canVote : d.notEligible;
  const kind = q.kind && q.kind !== 'law' ? `${d.kinds2[q.kind] || q.kind} · ` : '';
  const scope = q.scope && q.scope !== 'city' ? `${d.scope(q.scope.replace(/^group:/, ''))} · ` : '';
  lines.push(`  ${d.proposals}${P.col}[${q.id}]${P.lq1}${q.title}${P.lq2}${P.gap}${d.classes[q.class] || q.class} · ${kind}${scope}${d.tally(q.tally.yes, q.tally.no, q.tally.abstain)} · ${d.ticksLeft(q.ticksLeft)}${P.open}${vote}${P.close}${P.semi}${d.by} ${ref(q.proposer)}${q.text ? `${P.semi}${clip(q.text, level === 0 ? 200 : 100)}` : ''}`);
  if (q.reading) lines.push(`    ${d.reading}${P.col}${indent(clip(q.reading, rmax), '      ')}`);
  if (q.ballots && q.ballots.length) lines.push(`    ${d.ballots}${P.col}${q.ballots.map((b) => d.ballot(b.voter ? b.voter.name : '?', b.choice, b.reason)).join(P.semi)}`);
  return lines;
}

export function cityRefoundLines({ code, d, P, now, rmax }, r) {
  const lines = [`  ${d.refounds}${P.col}[${r.id}] ${d.refoundBy(r.by ? r.by.name : '?')} · ${d.signers(r.signers, r.needed)} · ${d.ticksLeft(Math.max(0, r.expiresTick - (now.tick ?? 0)))}${P.open}${r.signed ? d.signed : d.notSigned}${P.close}${r.text ? `${P.col}${clip(r.text, 200)}` : ''}`];
  if (r.eligible === false) lines.push(code === 'en' ? '    You are not in this refounding’s opening electorate and cannot sign.' : '    你不在此次重订发起时的资格名单内，不能联署。');
  if (r.reading) lines.push(`    ${d.reading}${P.col}${indent(clip(r.reading, rmax), '      ')}`);
  return lines;
}

export function cityGroupLines({ d, P, rmax, code }, g) {
  const lines = [`  ${d.groupsAll}${P.col}[${g.id}]${P.lq1}${g.name}${P.lq2}${P.gap}${g.open ? d.open : d.closed} · ${d.steward} ${g.steward ? g.steward.name : '—'} · ${d.members} ${g.members.length}${P.col}${g.members.map((m) => m.name).join(P.sep)} · ${d.groupProcedure[g.procedure] || g.procedure}${g.manifesto ? `${P.semi}${d.manifesto}${P.col}${g.manifesto}` : ''}`];
  if (g.bylaws) lines.push(`    ${d.bylaws}${g.bylaws.suspended ? `${P.open}${d.suspended}${P.close}` : ''}${P.col}${indent(clip(g.bylaws.reading, rmax), '      ')}`);
  if (g.bylaws?.enact) lines.push(`    ${enactText(g.bylaws.enact, code)}`);
  return lines;
}

export function cityResidents({ p, d, P, level }) {
  const c = p.city;
  if (!(c.residents && c.residents.length)) return [];
  const shown = level >= 3 ? c.residents.slice(0, 30) : c.residents;
  return [`  ${d.residents}${P.col}${shown.map((x) => `${x.name}(${x.id}${x.status === 'dormant' ? `,${d.dormantMark}` : ''})${level < 2 && x.tags && x.tags.length ? `${P.tag1}${x.tags.join('/')}${P.tag2}` : ''}`).join(P.sep)}`];
}

export function cityPlaces({ p, d, dict, moduleName }) {
  const c = p.city;
  return c.places && c.places.length ? [placesLine(d, dict, c.places, p.here ? p.here.place : null, moduleName)] : [];
}

export function cityRoads({ p, d, P }) {
  const c = p.city;
  return c.roads && c.roads.length ? [`  ${d.roads}${P.col}${c.roads.map((r) => `${r.a}—${r.b}${r.functioning ? '' : `${P.open}${d.notFunctioning}${P.close}`}`).join(P.sep)}`] : [];
}

export function cityLexicon({ p, d, P, level }) {
  const c = p.city;
  return c.lexicon && c.lexicon.length && level < 3 ? [`  ${d.lexicon}${P.col}${(level >= 2 ? c.lexicon.slice(-8) : c.lexicon).map((x) => `${x.word}=${x.meaning}`).join(P.semi)}`] : [];
}

export function cityCradleLines({ p, d, P }) {
  const c = p.city;
  return (c.cradle || []).map((s) => {
    const fund = s.queued ? d.queued(s.queuePosition) : d.sponsored(s.fund, c.shells ? c.shells.cost : '?');
    return `  ${d.cradle}${P.col}[${s.id}] ${s.name} · ${d.authorsOf} ${(s.authors || []).map((x) => x.name).join(P.sep) || '—'} · ${fund} · ${d.untilDay(s.expiresDay + 1)}${P.col}${s.soul}`;
  });
}

export function cityDeaths({ p, d, P, level }) {
  const c = p.city;
  return c.recentDeaths && c.recentDeaths.length && level < 3 ? [`  ${d.recentDeaths}${P.col}${c.recentDeaths.map((x) => `${x.name}(${x.id}, ${d.day(x.day + 1)})`).join(P.sep)}`] : [];
}

export function cityPetitions({ p, d, P }) {
  return (p.city.petitions || []).map((t) => `  ${d.petitions}${P.col}[${t.lawId}] ${d.day(t.day + 1)}${P.col}${t.text}`);
}

/** 【全城】 */
export function secCity(c) {
  if (!c.p.city) return [];
  const city = c.p.city;
  return [
    ...cityHead(c), ...cityProcedure(c), ...cityVars(c), ...cityCharter(c),
    ...(city.laws || []).map((l) => cityLawLine(c, l)),
    ...(city.proposals || []).flatMap((q) => cityProposalLines(c, q)),
    ...(city.refounds || []).flatMap((r) => cityRefoundLines(c, r)),
    ...(city.groups && city.groups.length ? city.groups.flatMap((g) => cityGroupLines(c, g)) : []),
    ...cityResidents(c), ...cityPlaces(c), ...cityRoads(c), ...cityLexicon(c), ...cityCradleLines(c), ...cityDeaths(c), ...cityPetitions(c),
  ];
}

/** 【你的记忆】 */
export function secMemories({ p, code, d, P, you }) {
  if (!(you.memories && you.memories.length)) return [];
  if (p.premise >= 1) {
    return [`${d.memories}${you.memories.map((m) => {
      const origin = m.origin && m.origin.id !== you.id && (!m.from || m.origin.id !== m.from.id) ? m.origin.name : null;
      const from = m.from ? m.from.name : null;
      const note = from ? (code === 'en' ? ` (from ${from}${origin ? `, first ${origin}'s` : ''})` : `（来自 ${from}${origin ? `，最初是 ${origin} 的` : ''}）`) : '';
      return `[${m.index}]${note} ${m.text}`;
    }).join(' ')}`];
  }
  return [`${d.memories}${you.memories.map((m) => `[${m.index}]${m.from ? `${P.open}${code === 'en' ? 'from' : '来自'} ${m.from.name}${P.close}` : ''} ${m.text}`).join(' ')}`];
}

/** 【动作的即时状态】只列出与基础代价不同的、此刻不可用的、或受法律约束的动作 */
export function secActions({ p, d, P }) {
  // 「没有可作用的对象」与静态的代价说明（路程、投入的能量、告示板）不是状态，系统提示的动作表里已有，不列
  const STATIC_NOTES = new Set(['variable', 'distance', 'noBoard']);
  const NO_TARGET = new Set(['not_found', 'invalid_args']);
  const notable = (p.actions || []).filter((a) => (a.available ? (a.note && !STATIC_NOTES.has(a.note.code)) || (a.laws && a.laws.length) : !(a.reason && NO_TARGET.has(a.reason.code))));
  if (!notable.length) return [];
  const lines = [d.actions];
  for (const a of notable) {
    const tail = [];
    if (a.note && !STATIC_NOTES.has(a.note.code)) tail.push(a.note.text);
    if (a.laws && a.laws.length) tail.push(d.lawsHint(a.laws));
    lines.push(`  ${a.type}${a.available ? ` ✓ ${a.cost}` : ` ✗ ${a.reason ? a.reason.text : ''}`}${a.available && tail.length ? `${P.open}${tail.join(P.semi)}${P.close}` : !a.available && a.laws && a.laws.length ? `${P.open}${d.lawsHint(a.laws)}${P.close}` : ''}`);
  }
  return lines;
}

function build(p, { lastResults, code, level }) {
  const c = makeCtx(p, { lastResults, code, level });
  const lines = [...secDiagnostics(c), ...secNow(c)];
  const absent = secAbsent(c);
  if (absent) return [...lines, ...absent].join('\n');
  lines.push(...secYou(c), ...secHere(c), ...secInbox(c), ...secCity(c), ...secMemories(c), ...secActions(c));
  if (lastResults) lines.push(`${c.d.last}${lastResults}`);
  return lines.join('\n');
}

/**
 * 全城的地点名单，按街区分组，每处后面标出从这里过去的代价；后人开辟的地点、遗址另列：
 *   地点与移动代价：港区：港口(port) 此处、灯塔(lighthouse) 1；旧城：…… · 后人：灯屋(n3)（青禾）1〔储能、门〕· 遗址：剧场的遗址(theater) 3
 */
function placesLine(d, dict, places, hereId, moduleName) {
  const P = d.p;
  const districts = dict.district || {};
  const cost = (x) => (x.id === hereId ? d.hereMark : x.moveCost === null || x.moveCost === undefined ? d.unreachable : x.moveCost);
  const tail = (x) => `${x.gated ? `${P.tag1}${d.gated}${P.tag2}` : ''}`;
  const groups = [];
  const agentBuilt = [];
  const ruins = [];
  for (const x of places) {
    if (x.razed) {
      ruins.push(`${x.name}(${x.id}) ${cost(x)}`);
      continue;
    }
    if (x.origin === 'agent') {
      const owner = x.owner && x.owner.kind !== 'city' ? `${P.open}${x.owner.name || x.owner.id}${P.close}` : '';
      const mods = x.modules && x.modules.length ? `${P.tag1}${x.modules.map(moduleName).join(P.sep)}${P.tag2}` : '';
      agentBuilt.push(`${x.name}(${x.id})${owner} ${cost(x)}${mods || tail(x)}`);
      continue;
    }
    const key = x.district || '';
    let g = groups.find((y) => y.key === key);
    if (!g) groups.push((g = { key, items: [] }));
    g.items.push(`${x.name}(${x.id}) ${cost(x)}${tail(x)}`);
  }
  const parts = groups.map((g) => `${g.key ? `${districts[g.key] || g.key}${P.col}` : ''}${g.items.join(P.sep)}`);
  if (agentBuilt.length) parts.push(`${d.agentBuilt}${P.col}${agentBuilt.join(P.sep)}`);
  if (ruins.length) parts.push(`${d.ruins}${P.col}${ruins.join(P.sep)}`);
  return `  ${d.placesCost}${P.col}${parts.join(' · ')}`;
}
