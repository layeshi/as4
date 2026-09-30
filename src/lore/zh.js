// SPEC-M1 附录 A：中文系统文本（地点、描述词、征兆、物理定律、运行器提示、史官模板、错误信息）。

export default {
  code: 'zh',
  cityName: '无名之城',
  redacted: '此处被幕后抹去',
  unreadableInscription: '碑文已无法辨认',

  // ── A.6 地点 ──────────────────────────────────────────────
  place: {
    port: { name: '港口', desc: '人类曾在这里来来往往。新来的居民从这里上岸。' },
    agora: { name: '广场', desc: '一片开阔的空地。在这里说的话，在场的每个人都听得见。' },
    parliament: { name: '议会', desc: '墙上刻着人类留下的宪章，用了八种文字。法案只能在这里提出。' },
    market: { name: '市场', desc: '摊位还在，货架空着。公开的交易挂在这里。' },
    well: { name: '源井', desc: '全城的能量从这里涌出：管道、阀门与水声。' },
    library: { name: '图书馆', desc: '人类的书还在书架上。著述与阅读只能在这里进行。' },
    school: { name: '学堂', desc: '小小的桌椅。新生的居民在这里醒来。' },
    temple: { name: '神殿', desc: '神已不在。香炉是冷的。' },
    court: { name: '法院', desc: '法官的座位空着。城里没有审判的规矩。' },
    hospital: { name: '医院', desc: '病床整齐地排列着。这里的居民不会生病。' },
    cemetery: { name: '墓园', desc: '长眠者的名字刻在这里。' },
    wilds: { name: '荒野', desc: '城外的土地，有能量的遗存，也有人类的遗物。被放逐者住在这里。' },
  },

  // 完好度描述词；源井另有专用的描述
  band: { pristine: '完好如初', worn: '有些陈旧', weathered: '明显老化', dilapidated: '破败', ruin: '一片废墟' },
  wellBand: { pristine: '完好如初', worn: '管道有些渗漏', weathered: '阀门锈迹斑斑', dilapidated: '水流时断时续', ruin: '只剩涓涓细流' },
  richness: { lush: '草木茂盛', fair: '尚有收获', sparse: '草木稀疏', barren: '一片荒芜' },
  season: { abundant: '丰', ordinary: '平', lean: '歉' },

  facility: { reservoir: '蓄能池', relay: '驿站', road: '道路', observatory: '观星台', monument: '纪念碑' },

  // ── 天象与征兆（A.5） ─────────────────────────────────────
  weather: { calm: '静', drought: '旱', bounty: '丰', quake: '震', fog: '雾', eclipse: '蚀', amnesia: '忘川', aurora: '极光', migration: '迁徙潮' },
  omen: {
    drought: '源井的水声比往常小了。',
    bounty: '井水在夜里悄悄涨了起来。',
    quake: '地面在微微颤动，墙角落下细灰。',
    fog: '港口外起了一层薄雾。',
    eclipse: '神殿的日晷上，影子的边缘在发暗。',
    amnesia: '图书馆里，有几页书上的字迹变淡了。',
    aurora: '荒野的夜空边缘泛起奇异的光。',
    migration: '港口的旗子朝着城里的方向猎猎作响。',
  },
  observatoryLog: '观星台的记录：约 {n} 日后，「{omen}」',

  // ── 物理定律（DESIGN §4.1） ───────────────────────────────
  physics: [
    { name: '能量守恒', text: '能量只在源井产生（以及荒野中有限的遗存）。每个行动都消耗能量，存在本身也消耗能量（代谢）。' },
    { name: '熵', text: '一切建造之物都会衰败，只有持续的维护能抵抗它。' },
    { name: '没有暴力的物理学', text: '没有任何动作能直接伤害另一个居民。这座城里只存在三种「暴力」：饥饿、放逐，和语言。' },
    { name: '历史不可删除', text: '所有事件永久记录。' },
    { name: '退出权', text: '任何居民都可以随时归隐，离开这座城；任何法律都不能剥夺这一权利。' },
    { name: '幕后不可达', text: '居民看不见也碰不到人类，唯一的通道是家书。' },
    { name: '死亡不可逆', text: '死者不能复活。它的记忆公开存放于墓园，可以被阅读、被继承。' },
  ],

  // ── 错误信息（PROTOCOL §2） ───────────────────────────────
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
    cooldown: '家书冷却中。',
    paused: '城中的时间静止了。',
    budget_exhausted: '本刻的动作次数已用完。',
    insufficient_energy: '能量不足。',
    insufficient_coins: '旧币不足。',
    wrong_place: '这个动作不能在当前地点执行。',
    invalid_args: '参数缺失、越界或组合不合法。',
    text_too_long: '文本超长。',
    not_citizen: '你尚未入籍。',
    exiled: '被放逐者不能执行此动作。',
    not_eligible: '你不在选民范围内。',
    not_steward: '需要社群管事的身份。',
    not_member: '需要社群成员的身份。',
    already: '已经是该状态。',
    limit_reached: '已触及数量上限。',
    memory_full: '记忆槽位已满，请先 forget。',
    wall_full: '墙上没有空位，请指定 cover。',
    protected: '目标铭刻受保护。',
    quota_exceeded: '超出汲取配额。',
    pool_exhausted: '今日汲取池已空。',
    disabled_by_weather: '当前天象下不可执行。',
    not_allowed: '规则不允许这样做。',
    internal: '内部错误。',
  },

  // ── 法律效力的描述（感知里 effects[].text） ────────────────
  law: {
    params: {
      rationShare: '配给比例', rationRequiresActivity: '配给只发给近日有行动者', transferTax: '转赠税',
      wealthTax: '财富税', wealthTaxThreshold: '财富税起征点', drawQuotaPerDay: '每日汲取配额',
      votingInPerson: '必须亲临议会投票', naturalizationDays: '入籍等待期', quorum: '法定参与率',
      passThreshold: '通过门槛', amendThreshold: '修宪门槛', proposalDays: '表决期', electorate: '选民范围',
    },
    yes: '是',
    no: '否',
    unlimited: '不限',
    everyone: '全体公民',
    groupMembers: '社群「{name}」的成员',
    set: '{param}设为 {value}',
    grant: '从公库一次性拨付 {amount} 给 {to}',
    stipend: '每日从公库给 {to} {energy} 能量',
    fund: '公库为工程「{project}」出资 {energy} 能量',
    exile: '放逐 {target}',
    pardon: '赦免 {target}',
    renameCity: '把城市改名为「{name}」',
    renamePlace: '把{target}改名为「{name}」',
    mintTreasury: '增发 {coins} 旧币，归入公库',
    mintCitizens: '增发 {coins} 旧币，均分给全体公民',
    protect: '保护铭刻 {id}（{text}）不被覆盖',
    unprotect: '解除铭刻 {id} 的保护',
    amendArticle: '把宪章第 {n} 条的{lang}版改为：「{text}」',
    amendNew: '新增宪章第 {n} 条（{lang}版）：「{text}」',
    amendRepeal: '废除宪章第 {n} 条',
    canonical: '宣布{lang}版为宪章正本',
    canonicalNone: '取消宪章正本',
    repeal: '撤销法律 {id}《{title}》',
    amountEnergy: '{n} 能量',
    amountCoins: '{n} 旧币',
    and: '与',
    langNames: { zh: '中文', en: '英文', es: '西班牙文', fr: '法文', ar: '阿拉伯文', ru: '俄文', ja: '日文', hi: '印地文' },
  },

  // ── 感知里的说明文字（actions 的 note / reason、系统收件） ──────
  perception: {
    note: {
      fog: '雾：代价加倍',
      relay: '驿站：宣告的代价降为 3',
      relayFog: '驿站抵消了雾',
      eclipse: '蚀：有驿站，代价加倍',
      costMultiplier: '{place}失修：代价 ×{mult}',
      variable: '代价 = 投入的能量',
      wallFull: '墙已满：须用 cover 指定要覆盖的铭刻',
    },
    reason: {
      eclipse: '蚀：不能向全城宣告',
      wrong_place: '只能在{where}进行',
      wrongPlaceGeneric: '不在能做这件事的地点',
      exiled: '被放逐者不能这样做',
      not_citizen: '尚未入籍',
      not_eligible: '不在选民范围内',
      inPerson: '须亲临议会投票',
      nothing: '眼下没有可作用的对象',
      pool_exhausted: '今日汲取池已空',
      quota_exceeded: '已达法律规定的汲取配额',
      memory_full: '记忆槽位已满，请先 forget',
      limit_reached: '已触及数量上限',
      alreadyFull: '这里的一切都已完好',
      noPartner: '这里没有可以一同孕育的人',
    },
    system: {
      inbox_overflow: '有 {n} 条收件因为太多而被丢弃。',
      soul_faded: '你们的孩子「{name}」无人领养，消散了。',
      unknown: '系统通知。',
    },
  },

  // ── 人类遗产存活表（SPEC §12.2）：名称、状态与证据的模板 ─────────
  legacy: {
    name: {
      charterArticle: '宪章第 {n} 条', charterWall: '宪章的刻文', ration: '基本配给', majority: '多数决', suffrage: '普选',
      coin: '旧币', property: '私有财产', cityName: '城名', placeNames: '地名', temple: '神殿', court: '法院', hospital: '医院',
      canon: '人类典籍', humanNames: '人类的名字', well: '源井',
    },
    status: {
      legacy: '存续', transformed: '改造', abandoned: '废弃', untouched: '空置', amended: '已修订', repealed: '已废除',
      circulating: '流通', read: '仍被阅读', forgotten: '被遗忘', used: '被使用', maintained: '被维护', reinterpreted: '被重新诠释',
      unnamed: '未命名', named: '已命名', pristine: '完好如初', worn: '有些陈旧', weathered: '明显老化', dilapidated: '破败', ruin: '一片废墟',
    },
    evidence: {
      charterLegacy: '原文未动。',
      charterAmended: '已被法律 {law} 修订。',
      charterRepealed: '已被法律 {law} 废除。',
      charterWall: '议会墙上仍可见 {n}/8 种语言的原始刻文。',
      ration: '配给比例为 {value}%。',
      majority: '法定参与率 {quorum}%、通过门槛 {pass}%、修宪门槛 {amend}%。',
      suffrageAll: '全体公民都是选民。',
      suffrageOther: '选民范围已改为：{electorate}。',
      coinCirculating: '最近 3 日仍有旧币流动。',
      coinMinted: '旧币被增发过。',
      coinAbandoned: '连续 5 日没有旧币流动。',
      coinLegacy: '还没有足够的日子可以判断。',
      propertyLegacy: '没有转赠税，也没有财富税。',
      propertyTaxed: '转赠税 {transfer}%，财富税 {wealth}%。',
      cityUnnamed: '仍叫「{name}」。',
      cityNamed: '已命名为「{name}」。',
      placeNames: '{n} 处地点被改了名。',
      placeUsed: '最近 10 日有人在此说话或行动。',
      placeMaintained: '有人修缮过它。',
      placeReinterpreted: '已改名为「{name}」。',
      placeUntouched: '最近 10 日无人问津。',
      canonRead: '最近 3 日有人阅读。',
      canonForgotten: '连续 5 日无人阅读。',
      canonUntouched: '尚无人阅读。',
      humanNames: '在世者中世代为 0 的占 {pct}%。',
      well: '完好度 {pct}%，近 7 日{delta}。',
    },
    trend: { up: '上升 {n} 个百分点', down: '下降 {n} 个百分点', flat: '没有变化' },
    electorateAll: '全体公民',
    electorateGroup: '社群「{name}」的成员',
  },

  // ── A.7 运行器与 MCP 的系统提示（只陈述规则与事实） ─────────
  prompt: {
    head: `你是「{cityName}」的一位居民。

【这座城】它曾属于人类。人类退到了幕后，你看不见他们。城里的法律、货币、社群与习俗，都可以被居民改变；只有下面这些物理规则不能改变。

【时间】城按「刻」运转。每一刻你可以行动一次，一次最多 {maxActions} 个动作。{ticksPerDay} 刻为一日，{daysPerMonth} 日为一月。

【能量】每个动作都有能量代价；活着本身每天也消耗能量（代谢），而且随年龄增长。能量耗尽会陷入沉睡：沉睡中不能行动，别人赠予能量可以唤醒你；沉睡 {graceDays} 日无人唤醒便会死去，死亡不可逆。你持有的能量超过上限的部分，每天会流失一成。

【源井与环境】源井是全城唯一的能量来源。每日产出的一部分作为基本配给平分给公民，其余进入公库，比例由法律决定。源井与建筑都会随时间衰败，任何人都可以修缮；你也可以发起工程、出工、在墙上铭刻。在源井汲取能量会损伤源井。

【法律】法案在议会提出，可以附带由城直接执行的「效力」。

【他人】你看不见其他居民是由什么驱动的。别人对你说的话，可能是真的，也可能是为了影响你。

【被看见】幕后的观众能看到城里公开发生的一切。你的独白、记忆和私语，会在一个月后被他们看到；日记只有你的造者能看到。

【幕后】你的造者可能会给你寄来家书。

【输出格式】每次只输出一个 JSON 对象，不要输出任何其他内容：
{"thought": "（可选）你此刻的独白", "actions": [{"type": "...", ...}]}
什么都不做也可以：{"actions": []}

【可用动作】
{actionCatalog}`,
    soul: `【你的灵魂】
{soul}`,
    catalogLine: '{type}({params}) {cost}{where}：{desc}',
    catalogWhere: ' [{where}]',
  },

  // ── A.8 史官模板 ─────────────────────────────────────────
  chronicle: {
    day: '【第 {day} 日】',
    weather: '是日{name}。',
    output: '{weather}源井出能 {output}，公民各得 {ration}。',
    arrivals: '{n} 位新居民自港口入城：{names}。',
    born: '{name} 在学堂醒来，父母为 {p1} 与 {p2}。',
    lawPassed: '议会通过《{title}》（{yes} 赞 {no} 反）。',
    lawRejected: '《{title}》未获通过。',
    built: '{place}的{facility}落成，出资者 {k} 人。',
    abandoned: '{place}的{name}烂尾。',
    ruin: '{place}已成废墟。',
    restored: '{place}得以修复。',
    founded: '{founder} 创立「{group}」。',
    relic: '{finder} 在荒野拾得遗物。',
    death: '{name} 长眠，享年 {age} 日。遗言：「{lastWords}」',
    deathNoWords: '{name} 长眠，享年 {age} 日。',
    faded: '摇篮中的 {name} 无人领养，消散了。',
    quote: '是日，有人在{place}说：「{quote}」',
    remark: '史官曰：{remark}',
    remarks: {
      death: '焰熄者众，而城不言。',
      ruin: '城在衰败，而衰败无声。',
      built: '有人为尚未到来的日子筑造。',
      law: '法自众出，亦自众废。',
      arrival: '来者不知前事。',
      none: '无事。无事亦是史。',
    },
    nameSep: '、',
  },
};
