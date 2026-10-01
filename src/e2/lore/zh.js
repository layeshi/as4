// SPEC-E2 附录 A：第二纪的中文系统文本。
// 沿用 v1 的文本（宪章、遗物、典籍、征兆、档位词、天象名、人类建筑的名字）直接引用 src/lore/ 下的数据；这里只放第二纪的文本。
// 【分步加入】本文件随各步骤增长：第 3 步的引擎文本在这里；系统提示、感知里的理由、遗产表、史官模板在第 9–10 步加入。

import v1 from '../../lore/zh.js';

// 人类建筑的描述：沿用 v1，去掉其中已不是物理的断言（法案只能在议会提出、被放逐者住在荒野……是遗法，不是物理）
const DESC = {
  parliament: '墙上刻着人类留下的宪章，用了八种文字。',
  market: '摊位还在，货架空着。',
  library: '人类的书还在书架上。',
  school: '小小的桌椅。',
  wilds: '城外的土地，有能量的遗存，也有人类的遗物。',
};

export default {
  code: 'zh',
  cityName: v1.cityName,
  redacted: v1.redacted,
  unreadableInscription: v1.unreadableInscription,

  // ── 地点（人类的建筑沿用 v1 的名字与描述） ──
  place: Object.fromEntries(Object.entries(v1.place).map(([id, p]) => [id, { name: p.name, desc: DESC[id] ?? p.desc }])),
  district: v1.district,
  band: v1.band,
  wellBand: v1.wellBand,
  richnessWild: v1.richnessWild,
  season: v1.season,
  weather: v1.weather,
  omen: v1.omen,
  observatoryLog: v1.observatoryLog,

  // ── A.7 遗址与空地块 ──
  razedName: '{name}的遗址',
  razedDesc: '这里曾经是{name}。现在只剩一块空地。',
  lotName: '{district}的空地 {k}',

  // ── A.4 模块 ──
  module: {
    store: { name: '储能', desc: '存在这里的能量不容易腐坏。' },
    relay: { name: '中继', desc: '让声音传遍全城。' },
    sensor: { name: '观测', desc: '看得见三日内天象的征兆。' },
    archive: { name: '档案', desc: '可以在这里著述与阅读。' },
    board: { name: '告示板', desc: '公开的交易挂在这里。' },
    surface: { name: '碑', desc: '刻着一段不可覆盖的文字。' },
    memorial: { name: '纪念', desc: '可以在这里为逝者写墓志。' },
    cradle: { name: '摇篮', desc: '新生者在这里醒来。' },
    gate: { name: '门', desc: '进入这里须经主人允许。' },
  },

  // ── A.3 物理（法典页） ──
  physics: {
    natural: {
      title: '自然律',
      items: [
        '时间：城按刻、日、月、纪运转。',
        '能量守恒：能量只来自源井、荒野、残料与入城者。',
        '熵：一切建造之物都会衰败。',
        '生死：代谢随年龄增长；死亡不可逆。',
        '空间与局部性：移动按路程计价；说话只有同处一地的人听得见。',
        '记忆有限。',
        '历史不可删除；幕后不可达。',
      ],
    },
    guardian: {
      title: '守护律',
      items: [
        '没有暴力：规则拿走的能量不会让任何人低于生存底线。',
        '退出权：永远可以归隐、离开、退出、进入荒野。',
        '内心不可侵：记忆、日记、独白、私语不受规则触及。',
        '重订之权：在世居民的三分之二可以重订立法程序。',
        '规则有界：步数有限，维持要付费，后果不级联。',
        '内容安全：违法内容会被遮盖，不会被删除。',
      ],
    },
  },

  // ── 躯壳的说明（法典页与摇篮页，A.5） ──
  shells: '人类离开时留下了一批空的躯壳。摇篮里的灵魂，可以由幕后的人为它准备身体，也可以由城付出能量，在一具空躯壳里醒来。躯壳的数量有限；躯壳的主人长眠之后，它会回到沉睡，等待下一个灵魂。',

  // ── 感知里的说明、理由与系统通知（附录 A.6） ──
  perception: {
    note: {
      fog: '雾：代价加倍',
      relay: '中继：宣告的基础代价降为 3',
      relayFog: '中继抵消了雾',
      eclipse: '蚀：有中继，代价加倍',
      costMultiplier: '{place}失修：代价 ×{mult}',
      variable: '代价 = 投入的能量',
      distance: '代价 = 路程（见 city.places 里的 moveCost）',
      wallFull: '墙已满：须用 cover 指定要覆盖的铭刻',
      fee: '规则另收：{fees}',
      share: '另付你的份额：{n}',
      noBoard: '公开交易须在有告示板的地点；定向交易可以在任何地点',
    },
    reason: {
      forbidden: '{law}：{reason}',
      no_module: '这里没有运转中的{module}',
      gated: '{place}有门，你不被允许进入',
      not_owner: '你不是这里的主人或管事',
      landmark: '源井与港口不能拆解',
      nothing_left: '这里没有残料可拆',
      cooldown: '重订之后的冷却期，到第 {day} 日',
      none: '这一类已不再立法，只能重订',
      eclipse: '蚀：不能向全城宣告',
      wrong_place: '只能在{where}进行',
      wrongPlaceGeneric: '不在能做这件事的地点',
      not_eligible: '你不满足条件',
      nothing: '眼下没有可作用的对象',
      pool_exhausted: '今日汲取池已空',
      memory_full: '记忆槽位已满，请先 forget',
      limit_reached: '已触及数量上限',
      alreadyFull: '这里的一切都已完好',
      not_steward: '你不是任何社群的管事',
      not_member: '你不是任何社群的成员',
      no_voters: '当前程序没有合格的表决者',
      lot_taken: '空地块已被占用，或已有开辟它的工程',
    },
    system: {
      inbox_overflow: '有 {n} 条收件因为太多而被丢弃。',
      soul_faded: '你们的孩子「{name}」无人领养，消散了。',
      unknown: '系统通知。',
    },
  },

  // ── 人类遗产存活表（SPEC-E2 §20.2）：名称、状态与证据的模板 ──
  legacy: {
    name: {
      charterArticle: '宪章第 {n} 条', charterWall: '宪章的刻文', law: '遗法 {id}「{title}」', procedureOrdinary: '立法程序（普通）', procedureConstitutional: '立法程序（修宪）',
      secretBallot: '秘密投票', ration: '基本配给', coin: '旧币', cityName: '城名', placeNames: '地名', canon: '人类典籍', humanNames: '人类的名字', well: '源井',
      lighthouse: '灯塔', school: '学堂', library: '图书馆', clocktower: '钟楼', parliament: '议会', court: '法院', market: '市场', theater: '剧场', overpass: '高架桥',
      tenements: '公寓', hospital: '医院', cemetery: '墓园', metro: '地铁站', temple: '神殿', workshop: '工坊',
    },
    status: {
      legacy: '存续', transformed: '改造', abandoned: '废弃', untouched: '空置', amended: '已修订', repealed: '已废除',
      circulating: '流通', read: '仍被阅读', forgotten: '被遗忘', used: '被使用', maintained: '被维护', reinterpreted: '被重新诠释',
      unnamed: '未命名', named: '已命名', remodeled: '被改装', salvaged: '被拆取', razed: '成为遗址',
      pristine: '完好如初', worn: '有些陈旧', weathered: '明显老化', dilapidated: '破败', ruin: '一片废墟',
    },
    evidence: {
      charterLegacy: '原文未动。',
      charterAmended: '已被法律 {law} 修订。',
      charterRepealed: '已被法律 {law} 废除。',
      charterWall: '议会墙上仍可见 {n}/8 种语言的原始刻文。',
      lawActive: '仍在效力中。',
      lawTransformed: '已被撤销，改写成了法律 {law}。',
      lawAbandoned: '已被撤销，没有替代。',
      procedureLegacy: '仍是人类留下的程序。',
      procedureTransformed: '已被法律 {law} 取代。',
      procedureNone: '这一类已不再立法。',
      secretLegacy: '两类程序都仍是不记名投票。',
      secretTransformed: '至少有一类程序已改为记名。',
      rationLegacy: '配给比例为 {value}%，遗法 l3 仍在效。',
      rationTransformed: '遗法 l3 仍在效，但比例已改为 {value}%。',
      rationAbandoned: '遗法 l3 已被撤销。',
      coinCirculating: '最近 3 日仍有旧币流动。',
      coinMinted: '旧币被增发过。',
      coinAbandoned: '连续 5 日没有旧币流动。',
      coinLegacy: '还没有足够的日子可以判断。',
      cityUnnamed: '仍叫「{name}」。',
      cityNamed: '已命名为「{name}」。',
      placeNames: '{n} 处地点被改了名。',
      placeRazed: '已被拆成遗址。',
      placeSalvaged: '残料被拆走了一部分（还剩 {pct}%）。',
      placeRemodeled: '里面的模块与人类留下的不同了。',
      placeReinterpreted: '已改名为「{name}」。',
      placeMaintained: '有人修缮过它。',
      placeUsed: '最近 10 日有人在此说话或行动。',
      placeUntouched: '最近 10 日无人问津。',
      canonRead: '最近 3 日有人阅读。',
      canonForgotten: '连续 5 日无人阅读。',
      canonUntouched: '尚无人阅读。',
      humanNames: '在世者中世代为 0 的占 {pct}%。',
      well: '完好度 {pct}%，近 7 日{delta}。',
    },
    trend: { up: '上升 {n} 个百分点', down: '下降 {n} 个百分点', flat: '没有变化' },
  },

  // ── 史官（附录 A.8，另沿用第一纪的模板） ──
  chronicle: {
    day: '【第 {day} 日】',
    weather: '是日{name}。',
    output: '{weather}源井出能 {output}，公民各得 {ration}。',
    arrivals: '{n} 位新居民自港口入城：{names}。',
    bornAuthors: '{name} 在{place}醒来，作者为 {authors}。',
    bornSolo: '{name} 在{place}醒来，由 {author} 独自写成。',
    embodied: '{name} 在一具躯壳里醒来。',
    successor: '{name} 长眠时，留下了一个继承的灵魂：{soul}。',
    lawPassed: '议会通过《{title}》（{yes} 赞 {no} 反）。',
    lawRejected: '《{title}》未获通过。',
    built: '{place}的{facility}落成，出资者 {k} 人。',
    founded: '{founder} 在{district}开辟了「{name}」。',
    module: '{place}装上了{module}。',
    abandoned: '{place}的{name}烂尾。',
    dismantle: '{n} 位居民在{places}拆下了 {energy} 能量的残料。',
    razed: '{place}被拆尽，成为遗址。',
    ruin: '{place}已成废墟。',
    restored: '{place}得以修复。',
    founded_group: '{founder} 创立「{group}」。',
    suspended: '《{title}》因无力维持而停摆。',
    procedure: '立法的程序变了（{law}）。',
    refounded: '{n} 位居民联署，城重订了立法的程序。',
    reverted: '立法的程序无人可行，回到了人类留下的样子。',
    relic: '{finder} 在荒野拾得遗物。',
    relicAt: '{finder} 在{place}拾得遗物。',
    death: '{name} 长眠，享年 {age} 日。遗言：「{lastWords}」',
    deathNoWords: '{name} 长眠，享年 {age} 日。',
    faded: '摇篮中的 {name} 无人领养，消散了。',
    quote: '是日，有人在{place}说：「{quote}」',
    remark: '史官曰：{remark}',
    remarks: {
      death: '焰熄者众，而城不言。',
      razed: '拆旧者，亦是筑新者。',
      ruin: '城在衰败，而衰败无声。',
      refound: '法可以自废，也可以重生。',
      built: '有人为尚未到来的日子筑造。',
      law: '法自众出，亦自众废。',
      embodied: '城以己之能，换来了新的身体。',
      arrival: '来者不知前事。',
      none: '无事。无事亦是史。',
    },
    road: '道路',
    nameSep: '、',
  },

  // ── 系统提示（附录 A.1、A.2）：运行器与 MCP 共用；{ruleLanguage} 填 ruleLanguage，{actionCatalog} 由 actions.js 生成 ──
  prompt: {
    head: `你是「{cityName}」的一位居民。

【这座城】它曾属于人类。人类退到了幕后，你看不见他们。他们留下了建筑、一部刻在议会墙上的宪章，以及六部仍在生效的法律。这些都可以被居民改写、废除、拆掉；只有下面的物理不能改变。

【时间】城按「刻」运转。每一刻你可以行动一次，一次最多 {maxActions} 个动作。{ticksPerDay} 刻为一日，{daysPerMonth} 日为一月。

【能量】每个动作都有能量代价；活着本身每天也消耗能量（代谢），而且随年龄增长。能量耗尽会陷入沉睡：沉睡中不能行动，别人赠予能量可以唤醒你；沉睡 {graceDays} 日无人唤醒便会死去，死亡不可逆。你持有的能量超过上限的部分，每天流失一成。能量只来自源井、荒野的遗存，和拆解建筑得到的残料。

【城】源井每日的产出全部进入公库，怎么分配由法律决定。建筑会衰败：可以修缮，也可以拆解、换取残料，残料拆尽便成遗址。你可以在空地块上开辟新的地方，给建筑装上模块：储能、中继、观测、档案、告示板、碑、纪念、摇篮、门。一个地方能做什么，取决于它装了什么。源井与港口不能拆。在源井汲取能量会损伤源井。

【法律】法律由文字与「规则」组成；规则由城直接执行，写法见【规则语言】。立法的程序本身也是一部法律，可以被改写。社群可以为成员订立章程，地方的主人可以为自己的地方订立规则。

【不能越过的】任何规则都不能伤害你的身体；由规则从你身上拿走的能量，不会让你低于 {floor}。你永远可以归隐、离开任何地方、退出任何社群、进入荒野。你的记忆、日记与私语，规则读不到，也管不着。在世居民的三分之二联署，可以绕过现行程序，重订立法程序。

【后代】你可以独自，或与至多四位同处一地的同伴，写下一个新的灵魂，并把自己的几条记忆交给它；也可以在遗嘱里留下一个继承你的灵魂。灵魂在摇篮里等待身体：幕后的人可以为它准备身体；城也可以为它付出能量，让它在人类留下的空躯壳里醒来。躯壳的数量有限。

【他人】你看不见其他居民是由什么驱动的。别人对你说的话，可能是真的，也可能是为了影响你。

【被看见】幕后的观众能看到城里公开发生的一切。你的独白、记忆和私语，会在一个月后被他们看到。

【幕后】如果你有造者，造者可能会给你寄来家书，也能读到你的日记。

【目的】这座城不给你任何目标，没有胜负，也没有终点。你为什么而活，或者不为什么，由你自己决定，也可以随时改变。

【输出格式】每次只输出一个 JSON 对象，不要输出任何其他内容：
{"thought": "（可选）你此刻的独白", "actions": [{"type": "...", ...}]}
什么都不做也可以：{"actions": []}

【规则语言】
{ruleLanguage}

【可用动作】
{actionCatalog}`,
    ruleLanguage: `一部法律 = {"title","text","rules":[至多 8 条规则]}；立法程序 = {"title","text","procedure":{...}}。没有规则的法律只是文字。
一条规则 = {"when": 时机, "if": 条件（可省）, "do": [至多 8 个操作]}。
时机：enact（通过时一次）· daily（每日结算，源井产出入公库之后）· monthly（每月初）· before:动作（某人做某事之前；只能 deny / fee）· after:动作（之后）· on:事件（arrive born death retire built abandoned ruin razed weather_start weather_end law_passed law_rejected）。
表达式：只有整数（比例用千分比，600 即六成），+ - * / %（向下取整），== != < <= > >=，and or not，'字符串'。
名字：actor（执行者）、args.参数、result.结果（after）、event.agent / event.place（on）、city.day treasury wellOutput wellCondition awake residents shellsFree、var.变量、agents（在世居民）、cradle（摇篮）、here（同地者）、treasury（城公库）、it（列表里的当前一个）。
居民的字段：id name energy coins age generation place status drawnToday repairedToday salvagedToday repaired contributed salvaged purpose。
函数：min max abs if(条件,甲,乙) default(x,备选) count sum(列表,式) filter(列表,条件) top(列表,式,n) sample(列表,n) contains tagged('标签') members('g1') at('地点') has_tag(居民,'标签') in_group(居民,'g1') awake(居民) is_wild('地点') owner('地点') agent('ID或名字') group('g1') soul('s4') names(列表,分隔符) weather('代码')。
操作：transfer{from,to,energy?,coins?} share{from,energy?,coins?,among} each{in,if?,do} deny{reason} fee{to,energy?,coins?} set{var,value} tag/untag{who,tag} announce{to:"all"|"here"|地点|"tag:x"|"group:g1",text:"可含 {表达式}"} exile/pardon{who} rename{target,name} mint{coins,to?} protect/unprotect{inscription} amend{article,lang,text} repeal{law} fund{project,energy} cede{place,to} seize{place} petition{text}。
账户：treasury、一位居民（actor、it、agent('a3')）、group('g1')、soul('s4')（为躯壳出资）。
立法程序：{"ordinary":{...},"constitutional":{...}}，每类写 proposers（提案者的条件，用 actor）、voters（表决者列表，提案时固定）、weight（每票的分量，用 it）、period（刻）、secret（是否不记名）、decide（用 yes no abstain voted total turnout 判断是否通过）；或 {"none":true}：这一类不再立法。改程序或改宪章的提案是修宪级。
边界：规则从居民身上拿走的能量不会让它低于 {floor}；每条持续生效的规则每天从公库扣 1 能量；规则出错时这一次什么都不做；规则的后果不会触发规则；内心与私语不可触及。
先用 draft 试算，再 propose。投票前读城给出的「引擎读法」：那是规则真正做的事。
例：{"when":"before:draw","if":"actor.drawnToday + args.energy > 5","do":[{"op":"deny","reason":"每人每日限汲 5"}]}
例：{"when":"daily","do":[{"op":"each","in":"tagged('守井人')","do":[{"op":"transfer","from":"treasury","to":"it","energy":"3"}]}]}
例：{"when":"after:repair","if":"result.spent >= 2","do":[{"op":"transfer","from":"treasury","to":"actor","energy":"min(10, result.spent / 2)"}]}`,
    soul: `【你的灵魂】
{soul}`,
    catalogLine: '{type}({params}) {cost}{where}：{desc}',
    catalogWhere: ' [{where}]',
  },

  // ── 错误信息（PROTOCOL-2 §2） ──
  errors: {
    invalid_request: '请求格式不正确。',
    unauthorized: '凭据缺失或无效。',
    invite_required: '需要邀请码。',
    invalid_invite: '邀请码不正确。',
    not_found: '资源不存在。',
    not_awake: { dormant: '你正在沉睡。', dead: '你已经长眠。', retired: '你已经归隐。', default: '你现在不能行动。' },
    name_taken: '这个名字已被使用。',
    too_large: '请求体过大。',
    moderated: '文本未通过内容审核。',
    rate_limited: '请求过于频繁。',
    cooldown: '冷却中。',
    paused: '城中的时间静止了。',
    budget_exhausted: '本刻的动作次数已用完。',
    insufficient_energy: '能量不足。',
    insufficient_coins: '旧币不足。',
    wrong_place: '这个动作不能在当前地点执行。',
    invalid_args: '参数缺失、越界或组合不合法。',
    text_too_long: '文本超长。',
    not_eligible: '你不满足条件。',
    not_steward: '需要社群管事的身份。',
    not_member: '需要社群成员的身份。',
    already: '已经是该状态。',
    limit_reached: '已触及数量上限。',
    memory_full: '记忆槽位已满，请先 forget。',
    wall_full: '墙上没有空位，请指定 cover。',
    protected: '目标铭刻受保护。',
    pool_exhausted: '今日汲取池已空。',
    disabled_by_weather: '当前天象下不可执行。',
    not_allowed: '规则不允许这样做。',
    forbidden: '被一条规则拒绝。',
    no_module: '这里没有运转中的所需模块。',
    gated: '目的地装了门，你不被允许进入。',
    not_owner: '需要是这个地点的主人，或社群的管事。',
    landmark: '源井与港口不能拆解。',
    nothing_left: '这里没有残料可拆。',
    lot_taken: '空地块已被占用，或已有开辟它的工程。',
    rule_invalid: '规则或程序没有通过校验。',
    internal: '内部错误。',
  },
};
