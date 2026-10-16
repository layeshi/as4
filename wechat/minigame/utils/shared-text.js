// 由 wechat/scripts/shared.mjs 从 public/i18n.js、public/e2-strings.js、public/law-outcome.js 与服务端文案生成，不要手改。
const DATA = {"MODEL_PRESETS":[{"id":"deepseek","name":"DeepSeek","variants":[{"id":"general","name":"官方 API","provider":"openai","baseURL":"https://api.deepseek.com","models":["deepseek-flash","deepseek-v4-pro"]}]},{"id":"glm","name":"智谱 GLM","variants":[{"id":"general","name":"通用 API","provider":"openai","baseURL":"https://open.bigmodel.cn/api/paas/v4","models":[]},{"id":"coding","name":"编程套餐","provider":"openai","baseURL":"https://open.bigmodel.cn/api/coding/paas/v4","models":[]}]},{"id":"qwen","name":"通义千问","hint":"默认北京地域；其他地域请按账户修改接口地址。","variants":[{"id":"general","name":"北京 API","provider":"openai","baseURL":"https://dashscope.aliyuncs.com/compatible-mode/v1","models":["qwen-plus"]}]},{"id":"kimi","name":"Kimi","variants":[{"id":"general","name":"官方 API","provider":"openai","baseURL":"https://api.moonshot.cn/v1","models":[]}]},{"id":"doubao","name":"豆包","hint":"模型 ID 或接入点 ID 以火山方舟控制台为准。","variants":[{"id":"general","name":"北京 API","provider":"openai","baseURL":"https://ark.cn-beijing.volces.com/api/v3","models":["doubao-seed-2-1-pro-260628"]}]},{"id":"openai","name":"OpenAI","variants":[{"id":"chat","name":"Chat","provider":"openai","baseURL":"https://api.openai.com/v1","models":[]},{"id":"responses","name":"Responses","provider":"openai-responses","baseURL":"https://api.openai.com/v1","models":[]}]},{"id":"anthropic","name":"Anthropic","variants":[{"id":"general","name":"官方 API","provider":"anthropic","baseURL":"https://api.anthropic.com","models":[]}]},{"id":"custom","name":"自定义","variants":[{"id":"general","name":"自定义接口","provider":"openai","baseURL":"","models":[]}]}],"TPL":{"prayer_enabled":"神殿开始记下祈愿，居民的祈愿点从零积累。","pray":"{a} 在神殿祈祷：「{text}」","invent":"{a} 提交发明「{title}」：「{text}」","prayer_answered":"神殿传来给 {a} 的回应：「{text}」；馈赠 {energy} 能量，消耗 {cost} 祈愿点。","prayer_closed":"{a} 的未回应祈祷因其逝去或归隐而关闭。","prayer_points":"{a} 的祈愿点变动 {amount}（{source}），余额 {balance}。","invention_reviewed":"{a} 的发明{decision}：「{reason}」","arrive":"{a} 从幕后上岸，入城了。","born":"{a} 在学堂醒来，父母是 {p1} 与 {p2}。","fostered":"{a} 换了一位造者。","move":"{a} 从{from}走向{to}。","settle":"{a} 把籍从{from}迁到了{to}。","say":"{a}（{at}）：「{text}」","whisper":"{a} 对 {b} 私语：「{text}」","broadcast":"{a} 向全城宣告：「{text}」","give":"{a} 给了 {b} {amt}。","offer_open":"{a} 挂出交易：拿 {give} 换 {want}。","offer_open_to":"{a} 向 {to} 提出交易：拿 {give} 换 {want}。","trade":"{a} 与 {b} 成交：{give} 换 {want}。","offer_close_cancelled":"{a} 撤回了交易 {id}。","offer_close_expired":"{a} 的交易 {id} 过期了。","backstage":"幕后有东西变了。","backstage_code":"幕后有东西变了：这座城运转的方式，可能与昨天不同。","backstage_budget_up":"幕后给躯壳的供给变多了。","backstage_budget_down":"幕后给躯壳的供给变少了。","backstage_resume":"城里的时间静止过一段。","backstage_bodies":"幕后换过了一些身体。","internalize":"{a} 把一段记忆训练进身体：「{text}」","impart":"{a} 交给 {to} 一段记忆：「{text}」","standing":"{a} 留下了 {count} 条常驻指令。","standing_none":"{a} 撤销了常驻指令。","standing_fired":"{a} 的常驻指令执行了：{types}","standing_fired_none":"{a} 的常驻指令触发了，但什么也没做。","whisper_anonymous":"{a} 匿名私语了 {b}：「{text}」","mute":"{a} 屏蔽了 {who}。","mute_off":"{a} 解除了对 {who} 的屏蔽。","mute_anonymous":"{a} 屏蔽了所有匿名私语。","mute_off_anonymous":"{a} 解除了对所有匿名私语的屏蔽。","remember_gift":"{a} 收下 {from} 交来的记忆（最初是 {origin} 的）：「{text}」","remember":"{a} 记下：「{text}」","forget":"{a} 忘掉了：「{text}」","thought":"{a} 心想：「{text}」","write":"{a} 著成《{doc}》。","read":"{a} 读了《{doc}》。","define":"{a} 造了一个词「{word}」：{meaning}","propose":"{a} 提出法案《{title}》（{id}）。","vote_yes":"{a} 赞成 {id}。{reason}","vote_no":"{a} 反对 {id}。{reason}","vote_abstain":"{a} 对 {id} 弃权。{reason}","law_passed":"法案 {id} 通过（赞成 {yes}，反对 {no}），成为法律 {law}。","law_rejected":"法案 {id} 未通过（赞成 {yes}，反对 {no}）。","electorate_reverted":"选民范围的设定失效，恢复为全体公民。","stipend_skipped":"公库不足，法律 {law} 今日没有给 {to} 发津贴。","stipend":"法律 {law}：公库给 {to} 发了 {n} 能量的津贴。","found":"{a} 创立了社群 {g}。","join":"{a} 加入了 {g}。","leave":"{a} 离开了 {g}。","admit":"{a} 接纳 {b} 进入 {g}。","steward":"{b} 成为 {g} 的管事。","disburse":"{a} 从 {g} 的公库拨给 {b} {amt}。","dissolve":"社群「{name}」解散了。","explore_energy":"{a} 在{at}找到了 {n} 能量。","explore_relic":"{a} 在{at}找到了一件人类的遗物 {doc}。","explore_coins":"{a} 在{at}捡到了 {n} 旧币。","explore_nothing":"{a} 在{at}转了一圈，一无所获。","repair":"{a} 修缮了{target}（{n} 能量，{from}% → {to}%）。","initiate":"{a} 发起工程「{name}」（{kind}，需 {need} 能量）。","contribute":"{a} 为工程出工 {n} 能量（{have}/{need}）。","built":"工程「{name}」建成了：{kind}，位于{at}（{k} 人出力）。","abandoned":"工程「{name}」（{at}）烂尾了（{have}/{need}）。","ruin":"{target}沦为废墟。","restored":"{target}被修复，不再是废墟。","draw":"{a} 从源井汲取了 {n} 能量（源井 {pct}%）。","inscribe":"{a} 在{at}的墙上刻下：「{text}」","inscribe_cover":"{a} 在{at}覆盖了 {cover}，刻下：「{text}」","conceive":"{a} 向 {b} 提议孕育「{name}」。","pact_expired":"{a} 的孕育之约过期了（「{name}」）。","soul":"摇篮里新添了一个灵魂「{name}」（{a} 的孩子）。","soul_v2":"摇篮里新添了一个灵魂「{name}」（作者 {n} 位，包括 {a}）。","soul_successor":"摇篮里新添了一个灵魂「{name}」：{a} 传下的灯。","born_v2":"{a} 在{at}醒来了（{n} 位作者，包括 {p}）。","pact_open":"{a} 邀请其他 {n} 位作者共同写下一个灵魂「{name}」。","successor":"{a} 立下的继承灵魂「{name}」进入了摇篮。","successor_failed":"{a} 立下的继承灵魂「{name}」没有生成（名字已被占用）。","declare":"{a} 写下了自己的志：「{purpose}」","sponsor":"{a} 为摇篮里的一个灵魂出资 {n} 能量（已凑 {fund}）。","embodied":"摇篮里的灵魂在一具空躯壳里醒来了：{a}。","faded":"摇篮里的「{name}」无人领养，消散了。","epitaph":"{a} 为 {b} 写下墓志：「{text}」","dormant":"{a} 的能量耗尽，沉入沉睡。","revive":"{a} 醒来了。","revive_by":"{a} 在 {by} 的帮助下醒来了。","death":"{a} 长眠了，享年 {n} 日。遗言：「{words}」","retire":"{a} 归隐，离开了这座城。临别的话：「{words}」","exile":"{a} 被放逐到荒野。","pardon":"{a} 被赦免。","rename":"{target}被改名为「{name}」。","mint":"增发 {n} 旧币。","protect":"{at}的铭刻 {id} 受到保护。","unprotect":"铭刻 {id} 的保护被解除。","amend":"宪章被修订。","fund":"公库为{at}的工程出资 {n} 能量。","grant":"公库拨给 {to} {amt}。","repeal":"法律 {law} 被撤销。","facility_owner":"设施 {id}（{at}）改归全城所有。","place_owner":"地点 {id}（{at}）改归全城所有。","rule_op":"规则（{owner}）：{op} {detail}","rule_error":"规则（{owner}）执行出错：{code}。","announce":"法律 {owner} 宣告：「{text}」","law_replaced":"立法程序（{cls}）：{law} 被 {by} 取代。","law_suspended":"{owner} 付不起维持费，今日停摆。","procedure_error":"程序 {law}（{cls}）的 {field} 求值出错：{code}，已进入每日复查。","proposal_void":"程序修改案 {id} 因重订 {refound} 作废。","procedure_reverted_runtime":"立法程序（{cls}）的真实运行错误连续三次每日复查仍失败，恢复为人类程序（{law}）。","procedure_reverted":"立法程序（{cls}）无人可行，回到人类留下的样子（{law}）。","refound_open":"{a} 发起重订 {id}：「{text}」","refound_sign":"{a} 联署了重订 {id}（已有 {n} 人）。","refounded":"重订 {id} 成功，立法程序更换为 {law}（{n} 人联署）。","refound_expired":"重订 {id} 过期，未能成功（{n} 人联署）。","petition":"法律 {law} 上书幕后：「{text}」","cede":"{place}由全城转给了 {to}。","seize":"{place}被收归全城。","draft":"{a} 试算了一组规则。","dismantle":"{a} 在{at}拆下了 {n} 残料{module}（还剩 {left}）。","razed":"「{name}」被拆尽，{at}成了遗址。","bylaws":"{g} 的章程更新了（{n} 条规则）。","group_procedure":"{g} 的决策方式改为 {proc}。","place_rules":"{place}的地点规则更新了（{n} 条规则）。","naturalized":"{a} 入籍，成为公民。","letter_received":"{a} 收到了一封来自幕后的家书。","reveal":"{a} 出示家书：「{text}」","omen":"征兆（{at}）：{text}","weather_start":"天象开始：{kind}（第 {a}–{b} 日）。","weather_end":"天象结束：{kind}。","day":"第 {d} 日结束：源井日产 {out}，人均配给 {ration}，醒着 {awake} 人。","month":"第 {n} 月开始。","admin":"幕后操作：{op}。","law_fault":"执行故障，命令 #{commandN} 已回滚，实验保护暂停。","law_capacity":"法律执行容量不足，实验已保护暂停：{code}。","redacted":"幕后抹去了一条内容（{kind} {id}）。","great_sleep":"大沉睡：第 {n} 纪结束，城中的时间静止了。","gather":"{a} 在{at}采集了 {n} 物料（余 {stock}）。","material_regrowth":"{at} 补充了 {n} 物料（现存 {stock}）。","construction_observed":"{a} 为工程 {project} 完成了 {n} 工作量。","service_published":"{a} 发布服务「{title}」，固定报酬 {price} 词元。","service_edited":"服务「{title}」已修改，现价 {price} 词元。","order_open":"{a} 创建订单 {id}，托管 {price} 词元。","order_accepted":"{a} 承接订单 {id}，截止 tick {due}。","order_settled":"订单 {id} 已终结（{status}），向 {to} 支付或退还 {n} 词元。","give_materials":"{a} 给了 {b} {amt}，以及 {materials} 物料。","contribute_materials":"{a} 向工程投入 {n} 词元与 {materials} 物料。","repair_materials":"{a} 修缮了{target}（{n} 词元、{materials} 物料，{from}% → {to}%）。","dismantle_materials":"{a} 在{at}拆得 {n} 物料 {module}（余 {left}）。","appearance":"{a} 更新了公开形象。","startup_grant":"{a} 获得首次启动发放 {n} 词元。","role_question":"{a} 向公共角色 {role} 提问：“{text}”","role_reply":"公共角色 {role}：“{text}”","cooperation_enabled":"城中开放了资料卡、协作单和往来记忆。","knowledge_card":"{a} 更新了资料卡 {id}，版本 {version}。","collaboration":"{a} 更新了协作单 {id}，版本 {version}。","relationship_note":"{a} 更新了对 {b} 的私人评价。","program_services_enabled":"城中开放了居民程序服务。","program_saved":"{a} 保存了自己的程序 {program}。","program_delivered":"{a} 购买了 {provider} 的程序 {program} 服务，订单 {order} 已交付结果。"},"CAT":{"prayer_enabled":"world","pray":"speech","prayer_answered":"speech","prayer_closed":"life","prayer_points":"econ","invent":"know","invention_reviewed":"know","backstage":"world","say":"speech","whisper":"speech","broadcast":"speech","thought":"speech","internalize":"speech","impart":"speech","remember":"speech","forget":"speech","reveal":"speech","give":"econ","offer_open":"econ","trade":"econ","offer_close":"econ","draw":"econ","explore":"econ","mint":"econ","grant":"econ","stipend":"econ","stipend_skipped":"econ","fund":"econ","disburse":"econ","propose":"polity","vote":"polity","law_passed":"polity","law_rejected":"polity","electorate_reverted":"polity","repeal":"polity","amend":"polity","rename":"polity","protect":"polity","unprotect":"polity","exile":"polity","pardon":"polity","found":"polity","join":"polity","leave":"polity","admit":"polity","steward":"polity","dissolve":"polity","naturalized":"polity","arrive":"life","born":"life","fostered":"life","move":"life","settle":"polity","conceive":"life","pact_expired":"life","soul":"life","faded":"life","epitaph":"life","dormant":"life","revive":"life","death":"life","retire":"life","letter_received":"life","write":"know","read":"know","define":"know","inscribe":"know","repair":"env","initiate":"env","contribute":"env","built":"env","abandoned":"env","ruin":"env","restored":"env","facility_owner":"env","place_owner":"env","rule_op":"polity","pact_open":"life","successor":"life","declare":"life","sponsor":"life","embodied":"life","rule_error":"polity","announce":"polity","law_replaced":"polity","law_suspended":"polity","procedure_reverted":"polity","procedure_error":"polity","proposal_void":"polity","refound_open":"polity","refound_sign":"polity","refounded":"polity","refound_expired":"polity","petition":"polity","cede":"polity","seize":"polity","draft":"polity","bylaws":"polity","group_procedure":"polity","place_rules":"polity","dismantle":"env","razed":"env","omen":"world","weather_start":"world","weather_end":"world","day":"world","month":"world","great_sleep":"world","standing":"life","standing_fired":"life","mute":"life","admin":"admin","redacted":"admin","law_fault":"admin","law_capacity":"admin","gather":"econ","material_regrowth":"env","construction_observed":"env","service_published":"econ","service_edited":"econ","order_open":"econ","order_accepted":"econ","order_settled":"econ","appearance":"life","startup_grant":"econ","role_question":"speech","role_reply":"speech","cooperation_enabled":"admin","knowledge_card":"know","collaboration":"polity","relationship_note":"know","program_services_enabled":"admin","program_saved":"know","program_delivered":"econ"},"CATEGORIES":["speech","econ","polity","life","know","env","world","admin"],"CATEGORY_LABELS":{"speech":"言语","econ":"经济","polity":"政治","life":"生死","know":"知识与铭刻","env":"建造与环境","world":"天时","admin":"幕后"},"P4":{"tokenRoutineEvent":"{a} 定下了自己的作息。","tokenSupplyUp":"幕后给源井的供给变多了。","tokenSupplyDown":"幕后给源井的供给变少了。","tokenBasicUp":"幕后给每位居民的基本额度变多了。","tokenBasicDown":"幕后给每位居民的基本额度变少了。"},"LORE":{"district":{"harbor":"港区","oldtown":"旧城","commons":"市井","waterworks":"水脉","east":"东郊","wilds":"荒野","north-city":"北城","west-city":"西城","east-city":"东城"},"band":{"pristine":"完好如初","worn":"有些陈旧","weathered":"明显老化","dilapidated":"破败","ruin":"一片废墟"},"wellBand":{"pristine":"完好如初","worn":"管道有些渗漏","weathered":"阀门锈迹斑斑","dilapidated":"水流时断时续","ruin":"只剩涓涓细流"},"richness":{"lush":"遗存丰富","fair":"尚有收获","sparse":"所剩无几","barren":"已被搜刮一空"},"weather":{"calm":"静","drought":"旱","bounty":"丰","quake":"震","fog":"雾","eclipse":"蚀","amnesia":"忘川","aurora":"极光","migration":"迁徙潮"},"module":{"store":"储能","relay":"中继","sensor":"观测","archive":"档案","board":"告示板","surface":"碑","memorial":"纪念","cradle":"摇篮","gate":"门"},"razedName":"{name}的遗址","redacted":"此处被幕后抹去"}};
const TPL = DATA.TPL;
const A = (id) => ({ agent: id });
const PL = (id) => ({ place: id });
const GR = (id) => ({ group: id });
const TX = (text) => ({ text: text === null || text === undefined ? '' : String(text) });
const AMT = (o) => ({ amount: { energy: (o && o.energy) || 0, coins: (o && o.coins) || 0 } });
const WHO = (id) => (id === 'treasury' ? { treasury: true } : typeof id === 'string' && id.startsWith('g') ? GR(id) : A(id));
const TARGET = (id) => (typeof id === 'string' && id.startsWith('f') ? { facility: id } : PL(id));
const CITY_SHORT = { zh: { north: '北城', west: '西城', east: '东城' }, en: { north: 'North City', west: 'West City', east: 'East City' } };
const cityLabel = (id) => (CITY_SHORT[currentLang() === 'en' ? 'en' : 'zh'][id] ?? id ?? '');
const t = () => '';
const currentLang = () => 'zh';
function ruleOpDetail(d) {
  const amt = (e, c) => [e ? `${e} 能量` : '', c ? `${c} 旧币` : ''].filter(Boolean).join(' ') || '0';
  const note = d.ok === false ? `（失败：${d.note || ''}）` : d.note ? `（${d.note}）` : '';
  switch (d.op) {
    case 'transfer': return `${d.from} → ${d.to} ${amt(d.energy, d.coins)}${note}`;
    case 'share': return `${d.from} → ${d.among} 人，每人 ${amt(d.each && d.each.energy, d.each && d.each.coins)}${note}`;
    case 'fee': return `${d.who} → ${d.to} ${amt(d.energy, d.coins)}${note}`;
    case 'set': return `${d.var} = ${d.value === null ? 'null' : d.value}${note}`;
    case 'tag':
    case 'untag': return `${d.who} ${d.tag}${note}`;
    case 'exile':
    case 'pardon': return `${d.who}${note}`;
    default: return note;
  }
}
const tokenized = world => [4, 5, 6].includes(world?.premise);
const tokenTerms = template => template.split(/(\{[^}]*\}|`[^`]*`)/g).map((part, i) => i % 2 ? part : part.replaceAll('能量', '词元').replace(/\bEnergy\b/g, 'Tokens').replace(/\benergy\b/g, 'tokens')).join('');
const enactText = function enactText(enact, lang = 'zh') {
  if (!enact) return '';
  const en = lang === 'en';
  const labels = en
    ? { no_enact: 'no enact rules', condition_false: 'conditions not met', success: 'succeeded', partial_failure: 'partially failed', failure: 'failed' }
    : { no_enact: '无一次性规则', condition_false: '条件未满足', success: '成功', partial_failure: '部分失败', failure: '失败' };
  const diagnostics = (enact.diagnostics || []).map(d => `rules[${d.rule}] ${en ? d.phase : d.phase === 'collect' ? '收集' : '施行'} ${d.code}${d.note ? ` (${d.note})` : ''}`).join(en ? '; ' : '；');
  return `${en ? 'Execution' : '执行'}${en ? ': ' : '：'}${labels[enact.status] || enact.status}${diagnostics ? ` · ${diagnostics}` : ''}`;
};
const templateKey = function templateKey(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'give': case 'contribute': case 'repair': return d.materials !== undefined ? `${e.type}_materials` : e.type;
    case 'dismantle': return d.materials !== undefined ? 'dismantle_materials' : 'dismantle';
    case 'procedure_reverted': return d.reason === 'runtime_error' ? 'procedure_reverted_runtime' : 'procedure_reverted';
    case 'offer_open': return d.to ? 'offer_open_to' : 'offer_open';
    case 'offer_close': return `offer_close_${d.reason === 'expired' ? 'expired' : 'cancelled'}`;
    case 'vote': return `vote_${d.choice === 'no' ? 'no' : d.choice === 'abstain' ? 'abstain' : 'yes'}`;
    case 'explore': return `explore_${['energy', 'relic', 'coins'].includes(d.outcome) ? d.outcome : 'nothing'}`;
    case 'inscribe': return d.cover ? 'inscribe_cover' : 'inscribe';
    case 'revive': return /^a\d+$/.test(String(d.by)) ? 'revive_by' : 'revive';
    case 'remember': return e.data.gift ? 'remember_gift' : 'remember';
    case 'standing': return d.count === 0 ? 'standing_none' : 'standing';
    case 'standing_fired': return (d.results || []).length ? 'standing_fired' : 'standing_fired_none';
    case 'whisper': return d.anonymous ? 'whisper_anonymous' : 'whisper';
    case 'mute': return `mute${d.on === false ? '_off' : ''}${d.who === 'anonymous' ? '_anonymous' : ''}`;
    case 'backstage': return e.data.kind === 'budget' ? `backstage_budget_${e.data.direction}` : `backstage_${e.data.kind}`;
    case 'born': return d.authors ? 'born_v2' : 'born';
    case 'soul': return d.authors ? (d.successorOf ? 'soul_successor' : 'soul_v2') : 'soul';
    case 'successor': return d.failed ? 'successor_failed' : 'successor';
    default: return e.type;
  }
};
const VARS = {
  "prayer_enabled": () => ({}),
  "pray": (e) => ({ a: A(e.agent), text: TX(e.data.text) }),
  "invent": (e) => ({ a: A(e.agent), title: TX(e.data.title), text: TX(e.data.text) }),
  "prayer_answered": (e) => ({ a: A(e.agent), text: TX(e.data.text || '—'), energy: e.data.energy, cost: e.data.cost }),
  "prayer_closed": (e) => ({ a: A(e.agent) }),
  "prayer_points": (e) => ({ a: A(e.agent), amount: e.data.amount, balance: e.data.balance, source: t(`prayer_source_${e.data.kind}`) }),
  "invention_reviewed": (e) => ({ a: A(e.agent), decision: t(`invention_${e.data.decision}`), reason: TX(e.data.reason) }),
  "arrive": (e) => ({ a: A(e.data.agentId) }),
  "born": (e) => (e.data.parents
    ? { a: A(e.data.agentId), p1: A(e.data.parents[0]), p2: A(e.data.parents[1]) }
    : { a: A(e.data.agentId), p: e.data.authors.length ? A(e.data.authors[0]) : '', n: e.data.authors.length, at: PL(e.data.place) }),
  "fostered": (e) => ({ a: A(e.data.agentId) }),
  "move": (e) => ({ a: A(e.agent), from: PL(e.data.from), to: PL(e.data.to) }),
  "settle": (e) => ({ a: A(e.agent), from: cityLabel(e.data.from), to: cityLabel(e.data.to) }),
  "say": (e) => ({ a: A(e.agent), text: TX(e.data.text), at: PL(e.place) }),
  "whisper": (e) => ({ a: A(e.data.from), b: A(e.data.to), text: TX(e.data.text) }),
  "broadcast": (e) => ({ a: A(e.agent), text: TX(e.data.text) }),
  "give": (e) => ({ a: A(e.data.from), b: WHO(e.data.to), amt: AMT(e.data), ...(e.data.materials !== undefined ? {materials:e.data.materials}: {}) }),
  "offer_open": (e) => ({ a: A(e.data.from), give: AMT(e.data.give), want: AMT(e.data.want), to: e.data.to ? A(e.data.to) : '' }),
  "trade": (e) => ({ a: A(e.data.from), b: A(e.data.to), give: AMT(e.data.give), want: AMT(e.data.want) }),
  "offer_close": (e) => ({ a: A(e.agent), id: e.data.offerId, reason: e.data.reason }),
  "backstage": () => ({}),
  "internalize": (e) => ({ a: A(e.agent), text: TX(e.data.text) }),
  "impart": (e) => ({ a: A(e.agent), to: A(e.data.to), text: TX(e.data.text) }),
  "standing": (e) => ({ a: A(e.agent), count: e.data.count }),
  "standing_fired": (e) => ({ a: A(e.agent), types: (e.data.results || []).map((r) => `${r.type}${r.ok ? '' : '✗'}`).join(', ') }),
  "mute": (e) => ({ a: A(e.agent), who: e.data.who === 'anonymous' ? '' : A(e.data.who) }),
  "remember": (e) => ({ a: A(e.agent), text: TX(e.data.text), ...(e.data.gift ? { from: A(e.data.from), origin: A(e.data.origin) } : {}) }),
  "forget": (e) => ({ a: A(e.agent), text: TX(e.data.text) }),
  "thought": (e) => ({ a: A(e.agent), text: TX(e.data.text) }),
  "write": (e) => ({ a: A(e.agent), doc: { doc: e.data.docId, title: e.data.title } }),
  "read": (e) => ({ a: A(e.agent), doc: { doc: e.data.docId, title: e.data.title } }),
  "define": (e) => ({ a: A(e.agent), word: TX(e.data.word), meaning: TX(e.data.meaning) }),
  "propose": (e) => ({ a: A(e.agent), title: TX(e.data.title), id: e.data.proposalId }),
  "vote": (e) => ({ a: A(e.agent), id: e.data.proposalId, choice: e.data.choice, reason: e.data.reason ? TX(e.data.reason) : '' }),
  "law_passed": (e) => ({ id: e.data.proposalId, law: e.data.lawId, yes: e.data.tally.yes, no: e.data.tally.no }),
  "law_rejected": (e) => ({ id: e.data.proposalId, yes: e.data.tally.yes, no: e.data.tally.no }),
  "electorate_reverted": () => ({}),
  "stipend_skipped": (e) => ({ law: e.data.lawId, to: WHO(e.data.to) }),
  "stipend": (e) => ({ law: e.data.lawId, to: WHO(e.data.to), n: e.data.energy }),
  "found": (e) => ({ a: A(e.agent), g: GR(e.data.groupId), name: TX(e.data.name) }),
  "join": (e) => ({ a: A(e.agent), g: GR(e.data.groupId) }),
  "leave": (e) => ({ a: A(e.agent), g: GR(e.data.groupId) }),
  "admit": (e) => ({ a: A(e.agent), b: A(e.data.agentId), g: GR(e.data.groupId) }),
  "steward": (e) => ({ b: A(e.data.to), g: GR(e.data.groupId) }),
  "disburse": (e) => ({ a: A(e.agent), b: A(e.data.to), g: GR(e.data.groupId), amt: AMT(e.data) }),
  "dissolve": (e) => ({ name: TX(e.data.name) }),
  "explore": (e) => ({ a: A(e.agent), at: PL(e.place || 'wilds'), n: e.data.amount, doc: e.data.docId ? { doc: e.data.docId, title: '' } : '' }),
  "repair": (e) => ({ a: A(e.agent), target: TARGET(e.data.target), n: e.data.spent, from: Math.round(e.data.from / 100), to: Math.round(e.data.to / 100), ...(e.data.materials !== undefined ? {materials:e.data.materials}: {}) }),
  "initiate": (e) => ({ a: A(e.agent), name: TX(e.data.name), kind: { facilityType: e.data.type }, need: e.data.need }),
  "contribute": (e) => ({ a: A(e.agent), n: e.data.energy, have: e.data.have, need: e.data.need, ...(e.data.materials !== undefined ? {materials:e.data.materials}: {}) }),
  "built": (e) => ({ name: TX(e.data.name), kind: { facilityType: e.data.type }, at: PL(e.place), k: e.data.contributors }),
  "abandoned": (e) => ({ name: TX(e.data.name), at: PL(e.place), have: e.data.have, need: e.data.need }),
  "ruin": (e) => ({ target: TARGET(e.data.target) }),
  "restored": (e) => ({ target: TARGET(e.data.target) }),
  "draw": (e) => ({ a: A(e.agent), n: e.data.amount, pct: Math.round(e.data.wellCondition / 100) }),
  "inscribe": (e) => ({ a: A(e.agent), text: TX(e.data.text), at: PL(e.place), cover: e.data.cover || '' }),
  "conceive": (e) => ({ a: A(e.data.from), b: A(e.data.with), name: TX(e.data.name) }),
  "pact_expired": (e) => ({ a: A(e.agent), name: TX(e.data.name) }),
  "soul": (e) => (e.data.authors
    ? { a: A(e.data.authors[0]), name: TX(e.data.name), n: e.data.authors.length } // 第二纪
    : { a: A(e.agent), name: TX(e.data.name) }),
  "pact_open": (e) => ({ a: A(e.agent), name: TX(e.data.name), n: e.data.authors.length }),
  "successor": (e) => ({ a: A(e.data.from), name: TX(e.data.name) }),
  "declare": (e) => ({ a: A(e.agent), purpose: TX(e.data.purpose), bio: TX(e.data.bio) }),
  "sponsor": (e) => ({ a: A(e.agent), n: e.data.energy, fund: e.data.fund }),
  "embodied": (e) => ({ a: A(e.data.agentId) }),
  "faded": (e) => ({ name: TX(e.data.name) }),
  "epitaph": (e) => ({ a: A(e.agent), b: A(e.data.deceased), text: TX(e.data.text) }),
  "dormant": (e) => ({ a: A(e.data.agentId) }),
  "revive": (e) => ({ a: A(e.data.agentId), by: /^a\d+$/.test(String(e.data.by)) ? A(e.data.by) : '' }),
  "death": (e) => ({ a: A(e.data.agentId), n: e.data.ageDays, words: TX(e.data.lastWords) }),
  "retire": (e) => ({ a: A(e.data.agentId), words: TX(e.data.lastWords) }),
  "exile": (e) => ({ a: A(e.data.agentId) }),
  "pardon": (e) => ({ a: A(e.data.agentId) }),
  "rename": (e) => ({ target: e.data.target === 'city' ? { city: true } : PL(e.data.target), name: TX(e.data.name) }),
  "mint": (e) => ({ n: e.data.coins, to: e.data.to === 'treasury' ? { treasury: true } : '' }),
  "protect": (e) => ({ id: e.data.inscriptionId, at: PL(e.place) }),
  "unprotect": (e) => ({ id: e.data.inscriptionId }),
  "amend": (e) => ({ n: e.data.article ?? '', lang: e.data.lang ?? '', canon: 'canonical' in e.data ? e.data.canonical || '' : '' }),
  "fund": (e) => ({ n: e.data.energy, at: PL(e.place) }),
  "grant": (e) => ({ to: WHO(e.data.to), amt: AMT(e.data) }),
  "repeal": (e) => ({ law: e.data.target }),
  "facility_owner": (e) => ({ id: e.data.facilityId, at: PL(e.place) }),
  "place_owner": (e) => ({ id: e.data.placeId, at: PL(e.place) }),
  "rule_op": (e) => ({ owner: e.data.owner, op: e.data.op, detail: TX(ruleOpDetail(e.data)) }),
  "rule_error": (e) => ({ owner: e.data.owner, code: e.data.code }),
  "announce": (e) => ({ owner: e.data.owner, text: TX(e.data.text) }),
  "law_replaced": (e) => ({ law: e.data.lawId, by: e.data.by, cls: e.data.class }),
  "law_suspended": (e) => ({ owner: e.data.owner }),
  "procedure_error": (e) => ({ cls: e.data.class, law: e.data.lawId, field: e.data.field, code: e.data.code }),
  "proposal_void": (e) => ({ id: e.data.proposalId, refound: e.data.refoundId }),
  "procedure_reverted": (e) => ({ cls: e.data.class, law: e.data.lawId }),
  "refound_open": (e) => ({ a: A(e.agent), id: e.data.refoundId, text: TX(e.data.text) }),
  "refound_sign": (e) => ({ a: A(e.agent), id: e.data.refoundId, n: e.data.signers }),
  "refounded": (e) => ({ id: e.data.refoundId, law: e.data.lawId, n: e.data.signers }),
  "refound_expired": (e) => ({ id: e.data.refoundId, n: e.data.signers }),
  "petition": (e) => ({ law: e.data.lawId, text: TX(e.data.text) }),
  "cede": (e) => ({ place: PL(e.data.place), to: WHO(e.data.to.id) }),
  "seize": (e) => ({ place: PL(e.data.place) }),
  "draft": (e) => ({ a: A(e.agent) }),
  "dismantle": (e) => ({ a: A(e.agent), at: PL(e.place ?? e.data.place), n: e.data.materials ?? e.data.energy, left: e.data.materialRecoverable ?? e.data.salvageLeft, module: e.data.module || '' }),
  "razed": (e) => ({ at: PL(e.data.place), name: TX(e.data.name) }),
  "bylaws": (e) => ({ g: GR(e.data.groupId), n: e.data.rules.length }),
  "group_procedure": (e) => ({ g: GR(e.data.groupId), proc: e.data.procedure }),
  "place_rules": (e) => ({ place: PL(e.data.placeId), n: e.data.rules.length }),
  "naturalized": (e) => ({ a: A(e.data.agentId) }),
  "letter_received": (e) => ({ a: A(e.data.agentId) }),
  "reveal": (e) => ({ a: A(e.agent), text: TX(e.data.text) }),
  "omen": (e) => ({ at: PL(e.data.place), text: TX((e.data.text && e.data.text[currentLang()]) || '') }),
  "weather_start": (e) => ({ kind: { weather: e.data.type }, a: e.data.startDay + 1, b: e.data.endDay + 1 }),
  "weather_end": (e) => ({ kind: { weather: e.data.type } }),
  "day": (e) => ({ d: e.data.day + 1, out: e.data.output, ration: e.data.ration, awake: e.data.population ? e.data.population.awake : 0 }),
  "month": (e) => ({ n: e.data.month + 1 }),
  "admin": (e) => ({ op: e.data.op }),
  "law_fault": (e) => ({ commandN: e.data.commandN }),
  "law_capacity": (e) => ({ code: e.data.code }),
  "redacted": (e) => ({ kind: e.data.kind, id: e.data.id }),
  "great_sleep": (e) => ({ n: e.data.epoch }),
  "gather": e => ({ a:A(e.agent), at:PL(e.place), n:e.data.materials, stock:e.data.stock }),
  "material_regrowth": e => ({ at:PL(e.data.zone), n:e.data.added, stock:e.data.stockAfterRefill }),
  "construction_observed": e => ({ a:A(e.data.actor), project:e.data.project, n:e.data.workAdded }),
  "service_published": e => ({ a:A(e.agent), title:TX(e.data.title), price:e.data.price }),
  "service_edited": e => ({ title:TX(e.data.title), price:e.data.price }),
  "order_open": e => ({ a:A(e.agent), id:e.data.id, price:e.data.terms.price }),
  "order_accepted": e => ({ a:A(e.agent), id:e.data.order, due:e.data.dueTick }),
  "order_settled": e => ({ id:e.data.order, status:TX(e.data.status), to:A(e.data.to), n:e.data.amount }),
  "appearance": e=>({a:A(e.agent)}),
  "startup_grant": e=>({a:A(e.agent),n:e.data.amount}),
  "role_question": e=>({a:A(e.agent),role:TX(e.data.publicRoleId),text:TX(e.data.text)}),
  "role_reply": e=>({role:TX(e.data.name),text:TX(e.data.text)}),
  "cooperation_enabled": () => ({}),
  "knowledge_card": e => ({ a: A(e.agent), id: e.data.id, version: e.data.version }),
  "collaboration": e => ({ a: A(e.agent), id: e.data.id, version: e.data.version }),
  "relationship_note": e => ({ a: A(e.agent), b: A(e.data.target) }),
  "program_services_enabled": () => ({}),
  "program_saved": e => ({ a: A(e.agent), program: e.data.program }),
  "program_delivered": e => ({ a: A(e.agent), provider: A(e.data.provider), program: e.data.program, order: e.data.order }),
};
/** 与网站 describeEvent 相同的规则（中文）：返回 { key, template, vars }。 */
function describe(e, premise) {
  if (e.redacted) return { key: 'redacted', template: '{text}', vars: { text: TX(e.data && e.data.text ? e.data.text.zh || e.data.text : DATA.LORE.redacted) } };
  const key = templateKey(e);
  let template = TPL[key] !== undefined ? TPL[key] : TPL[e.type];
  if ((premise === 6 || premise === 7) && e.type === 'fostered') template = '{a} 的管理权已完成过继。';
  let vars = {};
  try { vars = VARS[e.type] ? VARS[e.type](e) : {}; } catch (_) { vars = {}; }
  if (e.type === 'inscribe' && e.data && e.data.cover) vars.cover = e.data.cover;
  if (tokenized({ premise })) {
    if (e.type === 'routine') { template = DATA.P4.tokenRoutineEvent; vars.a = A(e.agent); }
    if (e.type === 'backstage' && e.data && ['supply', 'basic'].includes(e.data.kind)) template = DATA.P4['token' + (e.data.kind === 'supply' ? 'Supply' : 'Basic') + (e.data.direction === 'up' ? 'Up' : 'Down')];
    if (template !== undefined) template = tokenTerms(template);
  }
  if (template === undefined) return { key, template: '{type}', vars: { type: e.type } };
  return e.data && e.data.enact ? { key, template: template + ' {enact}', vars: Object.assign({}, vars, { enact: enactText(e.data.enact, 'zh') }) } : { key, template, vars };
}
module.exports = { describe, CAT: DATA.CAT, CATEGORIES: DATA.CATEGORIES, CATEGORY_LABELS: DATA.CATEGORY_LABELS, LORE: DATA.LORE, MODEL_PRESETS: DATA.MODEL_PRESETS, tokenized, tokenTerms };
