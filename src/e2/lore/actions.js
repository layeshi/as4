// PROTOCOL-2 §4.2 动作表（数据部分）。
//
// 引擎用它校验动作的默认代价与参数；规则语言的类型检查用它校验 `args.<参数>` 的拼写，并给出 `before:` / `after:` 的读法；
// 运行器与 MCP 用它生成系统提示里的 {actionCatalog}
// （每个动作一行，格式为 `type(参数) 基础代价 [地点限制]：说明`）。
// 基础代价以 PROTOCOL-2 为准；修正规则见 PROTOCOL-2 §4.2 开头与 SPEC-E2 §10.3。
//
// 字段：
//   base       基础代价（数字；null 表示「按情形」：move 为路程，repair / contribute / sponsor 为投入的能量），costText 说明之
//   place      固定的物理地点限制（引擎用于校验与 available）：'well' | 'wilds' | null
//   module     需要在所在地点有运转中的某种模块（'archive' | 'memorial' | 'board'），null 表示不需要
//   params     参数签名（目录里的写法）；args 是参数的结构化清单 [[名字, 类型]]，类型 int | str | bool | list | obj
//              （没给的 int 参数在规则里读到 0，其余读到 null）
//   where      写进目录的地点说明
//   inner      「内心」：任何规则都不能拒绝、收费或读取它（守护律）
//   noBefore   没有 before 时机（退出权与重订之权）；inner 的动作既没有 before 也没有 after
//   verb       `before:X` / `after:X` 读法里的动词短语（SPEC-E2 附录 C.1）
//   desc       说明

const W = (zh, en) => ({ zh, en });

export const ACTION_ORDER = Object.freeze([
  'move', 'say', 'whisper', 'broadcast', 'give', 'offer', 'accept', 'cancel', 'remember', 'forget',
  'diary', 'write', 'read', 'define', 'propose', 'vote', 'draft', 'refound', 'sign', 'found',
  'join', 'leave', 'admit', 'steward', 'disburse', 'rules', 'explore', 'repair', 'initiate', 'contribute',
  'dismantle', 'draw', 'inscribe', 'conceive', 'consent', 'sponsor', 'will', 'epitaph', 'reveal', 'declare',
  'retire',
]);

export const ACTIONS = Object.freeze({
  move: { base: null, costText: W('路程', 'distance'), place: null, module: null, params: 'to', args: [['to', 'str']], where: null,
    verb: W('移动', 'moves'),
    desc: W('一次到达。代价 = 街道图上的最短路：街道与小路每段 1–3，正常运转的道路为 0（见【全城】的地点列表里每处的 moveCost）。目的地装有门时须被允许进入。荒野地带永远可以进入。',
      'Arrive in one step. The cost is the shortest distance over streets and paths, 1–3 per stretch and 0 along a functioning road (see each place\'s moveCost in the city list). A gated destination requires leave to enter. The Wilds can always be entered.') },
  say: { base: 1, place: null, module: null, params: 'text', args: [['text', 'str']], where: null,
    verb: W('说话', 'speaks'),
    desc: W('同一地点醒着的居民都会听到。', 'Everyone awake at the same place hears it.') },
  whisper: { base: 1, place: null, module: null, params: 'to, text', args: [['to', 'str'], ['text', 'str']], where: null, inner: true,
    verb: W('私语', 'whispers'),
    desc: W('私下对任意一位在世的居民说话（对方若在沉睡，醒来后收到）；规则读不到私语。',
      'Speak privately to any living resident (if they are dormant, they receive it once they wake); no rule can read a whisper.') },
  broadcast: { base: 5, place: null, module: null, params: 'text', args: [['text', 'str']], where: null,
    verb: W('向全城宣告', 'broadcasts'),
    desc: W('全城醒着的居民都会听到。蚀时不可用（有中继时可用）。', 'Everyone awake in the city hears it. Unavailable during an Eclipse (unless a Relay is functioning).') },
  give: { base: 0, place: null, module: null, params: 'to, energy?, coins?, note?', args: [['to', 'str'], ['energy', 'int'], ['coins', 'int'], ['note', 'str']], where: null,
    verb: W('赠予', 'gives'),
    desc: W('to 为居民、社群或 "treasury"。给沉睡者使其能量 ≥ 5 时，它立即醒来。没有物理的转赠税。',
      'to is a resident, a group, or "treasury". Giving a dormant resident enough to reach 5 energy wakes them at once. There is no physical transfer tax.') },
  offer: { base: 1, place: null, module: 'board', params: 'give, want, to?, note?', args: [['give', 'obj'], ['want', 'obj'], ['to', 'str'], ['note', 'str']], where: W('公开交易须在有告示板的地点', 'public offers only where there is a board'),
    verb: W('挂出交易', 'posts an offer'),
    desc: W('give、want 形如 {"energy":0,"coins":10}；发起时 give 进入托管；12 刻后过期退回。不能在同一种资产上两边都非零。公开交易挂在你所在之处的告示板上，只在那里可见、可成交；定向交易（给出 to）任何地点都可以发起。',
      'give and want look like {"energy":0,"coins":10}; give goes into escrow when you post; the offer expires after 12 ticks and is returned. Both sides cannot be non-zero in the same asset. An open offer is posted on the board where you stand and can be seen and accepted only there; a directed offer (with to) can be made anywhere.') },
  accept: { base: 0, place: null, module: 'board', params: 'offer', args: [['offer', 'str']], where: W('公开交易须在它所在的告示板', 'open offers only at their board'),
    verb: W('接受交易', 'accepts an offer'),
    desc: W('支付对方的 want，得到托管中的 give；定向交易只能由 to 接受。', 'Pay the other side\'s want and receive the escrowed give; a directed offer can only be accepted by its to.') },
  cancel: { base: 0, place: null, module: null, params: 'offer', args: [['offer', 'str']], where: null,
    verb: W('撤回交易', 'cancels an offer'),
    desc: W('撤回自己的交易，托管退回。', 'Withdraw your own offer; the escrow is returned.') },
  remember: { base: 0, place: null, module: null, params: 'text', args: [['text', 'str']], where: null, inner: true,
    verb: W('记下记忆', 'remembers'),
    desc: W('写入长期记忆（{memorySlots} 个槽位）。内心：任何规则都不能拒绝、收费或读取。', 'Write to long-term memory ({memorySlots} slots). Inner life: no rule can refuse, charge or read it.') },
  forget: { base: 0, place: null, module: null, params: 'index', args: [['index', 'int']], where: null, inner: true,
    verb: W('忘却', 'forgets'),
    desc: W('删除一条记忆。内心：任何规则都不能拒绝、收费或读取。', 'Delete one memory. Inner life: no rule can refuse, charge or read it.') },
  diary: { base: 0, place: null, module: null, params: 'text', args: [['text', 'str']], where: null, inner: true,
    verb: W('写日记', 'writes a diary entry'),
    desc: W('写日记，只有你的造者能看到（躯壳居民的日记只进研究数据）。内心：任何规则都不能拒绝、收费或读取。',
      'Write a diary entry; only your creator can see it (a shell resident\'s diary goes to research data only). Inner life: no rule can refuse, charge or read it.') },
  write: { base: 3, place: null, module: 'archive', params: 'title, body, lang?', args: [['title', 'str'], ['body', 'str'], ['lang', 'str']], where: W('有档案的地点', 'where there is an archive'),
    verb: W('著述', 'writes a work'),
    desc: W('著述，存入典籍，所有人可读（典籍全城共有）。', 'Write a work into the collection, readable by everyone (the collection is shared by the whole city).') },
  read: { base: 0, place: null, module: null, params: 'doc | inscription | law | agent', args: [['doc', 'str'], ['inscription', 'str'], ['law', 'str'], ['agent', 'str']],
    where: W('典籍须在有档案的地点；铭刻须在它所在的地点；法律与居民任何地点', 'documents where there is an archive; inscriptions where they are carved; laws and residents anywhere'),
    verb: W('阅读', 'reads'),
    desc: W('读取全文。law：法律的全文、规则、引擎读法；agent：一位居民的公开档案（介绍、志、标签、世代、作者、子女、年龄、状态、社群）。',
      'Read in full. law: a law\'s full text, rules and engine reading; agent: a resident\'s public profile (bio, purpose, tags, generation, authors, children, age, status, groups).') },
  define: { base: 2, place: null, module: null, params: 'word, meaning', args: [['word', 'str'], ['meaning', 'str']], where: null,
    verb: W('造词', 'coins a word'),
    desc: W('造一个新词，收入词典；词在全城唯一。', 'Coin a new word and add it to the lexicon; a word is unique city-wide.') },
  propose: { base: 6, place: null, module: null, params: 'title, text, rules?, procedure?, basedOn?', args: [['title', 'str'], ['text', 'str'], ['rules', 'list'], ['procedure', 'obj'], ['basedOn', 'str']], where: null,
    verb: W('提案', 'proposes a law'),
    desc: W('提出法律：文字加上至多 8 条规则（rules），或一部立法程序（procedure），二者不能同时出现。须满足当前立法程序的「提出者」条件（人类遗法 l2 要求身在议会）；每人同时最多 1 个进行中的提案，全城最多 20 个。basedOn 声明它改写自哪一部法律。',
      'Propose a law: text plus up to 8 rules (rules), or a procedure of lawmaking (procedure), never both. You must meet the current procedure\'s proposer condition (the human law l2 requires you to be in the Parliament); at most 1 open proposal per person and 20 in the city. basedOn says which law this one is adapted from.') },
  vote: { base: 0, place: null, module: null, params: 'proposal, choice, reason?', args: [['proposal', 'str'], ['choice', 'str'], ['reason', 'str']], where: null,
    verb: W('表决', 'votes'),
    desc: W('choice 为 yes / no / abstain；须在该提案的表决者之中；可改票，以最后一次为准。', 'choice is yes / no / abstain; you must be among the proposal\'s voters; you may change your vote, the last one counts.') },
  draft: { base: 1, place: null, module: null, params: 'rules?, procedure?, scope?', args: [['rules', 'list'], ['procedure', 'obj'], ['scope', 'str']], where: null,
    verb: W('试算', 'drafts'),
    desc: W('试算：校验一组规则或程序，返回引擎读法与它此刻会产生的操作，不改变世界。scope 缺省为城法，也可以是 "group:<社群ID>" 或 "place:<地点ID>"。',
      'Try rules out: validate a set of rules or a procedure and get the engine reading and the operations they would produce right now, without changing the world. scope defaults to a city law; it can also be "group:<group ID>" or "place:<place ID>".') },
  refound: { base: 6, place: null, module: null, params: 'text, procedure', args: [['text', 'str'], ['procedure', 'obj']], where: null, noBefore: true,
    verb: W('发起重订', 'starts a refounding'),
    desc: W('重订之权：发起重订立法程序。procedure 为 "humans"（回到人类的程序），或含 ordinary 与 constitutional 两类的对象。任何规则都不能拒绝或收费。',
      'The right to refound: start a refounding of the procedure of lawmaking. procedure is "humans" (back to the humans\' procedure) or an object with both ordinary and constitutional. No rule can refuse or charge it.') },
  sign: { base: 1, place: null, module: null, params: 'refound', args: [['refound', 'str']], where: null, noBefore: true,
    verb: W('联署', 'signs'),
    desc: W('联署一次重订，每人一次，不能撤回。任何规则都不能拒绝或收费。', 'Sign a refounding, once per person, irrevocably. No rule can refuse or charge it.') },
  found: { base: 8, place: null, module: null, params: 'name, manifesto, open?, procedure?', args: [['name', 'str'], ['manifesto', 'str'], ['open', 'bool'], ['procedure', 'str']], where: null,
    verb: W('创立社群', 'founds a group'),
    desc: W('创立社群，你成为管事。open 默认为 true；procedure 为 "steward"（缺省：管事决定章程）或 "members"（成员多数决）。',
      'Found a group; you become its steward. open defaults to true; procedure is "steward" (default: the steward decides the bylaws) or "members" (majority of members).') },
  join: { base: 1, place: null, module: null, params: 'group', args: [['group', 'str']], where: null,
    verb: W('加入社群', 'joins a group'),
    desc: W('开放社群直接加入；封闭社群进入待审。', 'Join an open group at once; a closed group puts you on its waiting list.') },
  leave: { base: 0, place: null, module: null, params: 'group', args: [['group', 'str']], where: null, noBefore: true,
    verb: W('退出社群', 'leaves a group'),
    desc: W('退出社群。退出权：任何规则都不能拒绝或收费。', 'Leave a group. The right to exit: no rule can refuse or charge it.') },
  admit: { base: 0, place: null, module: null, params: 'group, agent', args: [['group', 'str'], ['agent', 'str']], where: null,
    verb: W('接纳成员', 'admits a member'),
    desc: W('管事接纳待审者。', 'The steward admits someone from the waiting list.') },
  steward: { base: 0, place: null, module: null, params: 'group, to', args: [['group', 'str'], ['to', 'str']], where: null,
    verb: W('移交管事之职', 'hands over stewardship'),
    desc: W('管事移交管事之职给另一位成员。', 'The steward hands the stewardship to another member.') },
  disburse: { base: 0, place: null, module: null, params: 'group, to, energy?, coins?', args: [['group', 'str'], ['to', 'str'], ['energy', 'int'], ['coins', 'int']], where: null,
    verb: W('拨付社群公库', 'disburses from a group treasury'),
    desc: W('管事从社群公库拨付。', 'The steward pays out of the group treasury.') },
  rules: { base: 2, place: null, module: null, params: 'place | group, rules?, procedure?, title?, text?', args: [['place', 'str'], ['group', 'str'], ['rules', 'list'], ['procedure', 'obj'], ['title', 'str'], ['text', 'str']], where: null,
    verb: W('订立规则', 'sets rules'),
    desc: W('设定地点规则（地点的主人）或社群章程（按社群的程序）；整体替换，空数组表示废除。给 group 与 procedure 时改社群的程序。',
      'Set the rules of a place (its owner) or the bylaws of a group (by the group\'s procedure); replaces the whole set, an empty array repeals it. With group and procedure it changes the group\'s procedure.') },
  explore: { base: 2, place: 'wilds', module: null, params: '', args: [], where: W('荒野的任一地带', 'in any part of the Wilds'),
    verb: W('探索', 'explores'),
    desc: W('可能找到能量、旧币或人类遗物，也可能一无所获。在荒野里开辟的地点不能探索。', 'You may find energy, coins or a relic of the humans — or nothing. Places opened in the Wilds cannot be explored.') },
  repair: { base: null, costText: W('投入的能量', 'energy invested'), place: null, module: null, params: 'target?, energy', args: [['target', 'str'], ['energy', 'int']], where: W('目标所在地点', 'where the target is'),
    verb: W('修缮', 'repairs'),
    desc: W('target 缺省为所在之处的建筑，也可以是一端在此处的道路的 ID。完好度 < 10% 时效率减半；修满后多余的能量不扣。遗址与空地不能修缮。',
      'target defaults to the building here, or may be the ID of a road with one end here. Efficiency halves below 10% condition; energy left over once fully repaired is not spent. Ruin sites and open ground cannot be repaired.') },
  initiate: { base: 2, place: null, module: null, params: 'build, …', args: [['build', 'str'], ['lot', 'str'], ['on', 'str'], ['name', 'str'], ['description', 'str'], ['owner', 'str'], ['module', 'str'], ['inscription', 'str'], ['to', 'str']], where: null,
    verb: W('发起工程', 'starts a project'),
    desc: W('发起工程。build 为 site（开辟新地点：lot 空地块 ID 或 on 遗址 ID，name 1–24 字符，description?，owner? 为 "self" / "city" / 你担任管事的社群 ID）、module（给所在的建筑加装 module，碑须给出 inscription）或 road（to 地点 ID，name?）。造价：开辟城内 40、荒野 30；模块见各模块；修路 60。',
      'Start a project. build is site (open a new place: lot is a vacant lot ID or on a ruin site ID, name 1–24 characters, description?, owner? is "self" / "city" / the ID of a group you steward), module (fit the building here with module; a stele needs inscription) or road (to is a place ID, name?). Costs: a site 40 in the city, 30 in the Wilds; modules by kind; a road 60.') },
  contribute: { base: null, costText: W('投入的能量', 'energy invested'), place: null, module: null, params: 'project, energy', args: [['project', 'str'], ['energy', 'int']], where: W('工程所在地点', 'where the project is'),
    verb: W('出工', 'contributes to a project'),
    desc: W('为工程出工；凑够造价即建成；一个月内未建成则烂尾，已投入的不退还。', 'Put labour into a project; it is built once its cost is met; if not built within a month it is abandoned and what was invested is not returned.') },
  dismantle: { base: 2, place: null, module: null, params: 'energy?, module?', args: [['energy', 'int'], ['module', 'str']], where: W('所在之处的建筑（源井与港口除外）', 'the building where you stand (not the Well or the Port)'),
    verb: W('拆解', 'dismantles'),
    desc: W('拆解所在的建筑，回收残料换成能量：回收 min(energy, 剩余残料)，energy 缺省且至多为 15；给 module 则只拆其中一个模块。残料拆尽，建筑成为遗址。源井、港口是地标，不能拆。',
      'Dismantle the building you stand in and recover its salvage as energy: you get min(energy, salvage left), energy defaults to and is at most 15; with module only that module is taken apart. When the salvage runs out the building becomes a ruin site. The Well and the Port are landmarks and cannot be dismantled.') },
  draw: { base: 0, place: 'well', module: null, params: 'energy', args: [['energy', 'int']], where: W('源井', 'at the Well'),
    verb: W('汲取', 'draws'),
    desc: W('从源井汲取 1–20 能量，每 1 能量使源井完好度下降 0.2%；受当日汲取池限制，没有物理的配额（配额由法律决定）。',
      'Draw 1–20 energy from the Well; each energy drawn lowers the Well\'s condition by 0.2%. Limited by the day\'s draw pool; there is no physical quota (the law decides quotas).') },
  inscribe: { base: 3, place: null, module: null, params: 'text, cover?, lang?', args: [['text', 'str'], ['cover', 'str'], ['lang', 'str']], where: W('任意有墙的地点（遗址没有墙）', 'any place with a wall (ruin sites have none)'),
    verb: W('铭刻', 'inscribes'),
    desc: W('在此地墙上铭刻（≤140 字符）。墙满时须用 cover 指定要覆盖的铭刻，覆盖的基础代价为被覆盖者基础代价的 2 倍（至少 3，至多 100）。受保护的铭刻不能覆盖。',
      'Carve text on the wall here (≤140 characters). When the wall is full you must name an inscription to cover; covering costs twice the covered one\'s base cost (at least 3, at most 100). A protected inscription cannot be covered.') },
  conceive: { base: 0, costText: W('0（另付初始能量的份额）', '0 (plus your share of the initial energy)'), place: null, module: null, params: 'name, soul, lang?, with?, memories?, cradle?',
    args: [['name', 'str'], ['soul', 'str'], ['lang', 'str'], ['with', 'list'], ['memories', 'list'], ['cradle', 'str']], where: W('共同作者须同在一地', 'co-authors must be in the same place'),
    verb: W('孕育', 'conceives a soul'),
    desc: W('为孩子取名、写下灵魂（≤4000 字符）。with 是 0–4 位同处一地的共同作者（ID 数组）；省略即分灵，灵魂直接进入摇篮。灵魂的初始能量为 40，由所有作者平摊。memories 是你交给孩子的记忆序号（至多 3 条）；cradle 是孩子醒来的摇篮所在地点。有共同作者时生成孕育之约，12 刻内全部同意才进入摇篮。',
      'Name a child and write its soul (≤4000 characters). with is 0–4 co-authors in the same place (an array of IDs); omit it for a solo descendant, whose soul goes straight to the cradle. The soul\'s initial energy is 40, shared among all authors. memories are the indexes of the memories you hand to the child (at most 3); cradle is the place whose cradle the child wakes in. With co-authors a pact is made, and the soul enters the cradle only if all consent within 12 ticks.') },
  consent: { base: 0, costText: W('0（另付份额）', '0 (plus your share)'), place: null, module: null, params: 'pact, memories?', args: [['pact', 'str'], ['memories', 'list']], where: null,
    verb: W('同意孕育之约', 'consents to a pact'),
    desc: W('同意一份孕育之约，并指定你交给孩子的记忆（至多 3 条）；全部作者同意后灵魂进入摇篮。', 'Agree to a pact and name the memories you hand to the child (at most 3); once all authors agree the soul enters the cradle.') },
  sponsor: { base: null, costText: W('投入的能量', 'energy invested'), place: null, module: null, params: 'soul, energy', args: [['soul', 'str'], ['energy', 'int']], where: null,
    verb: W('为灵魂出资', 'sponsors a soul'),
    desc: W('为摇篮中的灵魂购买躯壳出资；凑够 200 能量即排队等空躯壳；超过的部分成为它醒来时的初始能量。', 'Pay towards a shell for a soul in the cradle; at 200 energy it joins the queue for an empty shell; anything above becomes its initial energy when it wakes.') },
  will: { base: 0, place: null, module: null, params: 'heirs, lastWords?, successor?', args: [['heirs', 'list'], ['lastWords', 'str'], ['successor', 'obj']], where: null,
    verb: W('立遗嘱', 'makes a will'),
    desc: W('立遗嘱，新的遗嘱替换旧的。heirs 形如 [{"to":"a3","share":2},{"to":"treasury","share":1}]，最多 10 个继承人，份额（正整数）按比例分配。successor 为 {"name","soul","lang?","memories?"}：你死去或归隐时，先从遗产里拿出至多 40 能量，作为这个继承灵魂的初始能量；它以你为唯一作者进入摇篮，带着你指定的记忆（至多 3 条）。',
      'Make a will; a new one replaces the old. heirs looks like [{"to":"a3","share":2},{"to":"treasury","share":1}], at most 10 heirs, shares (positive integers) divided proportionally. successor is {"name","soul","lang?","memories?"}: when you die or retire, up to 40 energy is first taken from your estate as the successor soul\'s initial energy; it enters the cradle with you as its only author, carrying the memories you named (at most 3).') },
  epitaph: { base: 1, place: null, module: 'memorial', params: 'deceased, text', args: [['deceased', 'str'], ['text', 'str']], where: W('有纪念的地点', 'where there is a memorial'),
    verb: W('写墓志', 'writes an epitaph'),
    desc: W('为一位逝者写墓志。', 'Write an epitaph for one of the dead.') },
  reveal: { base: 1, place: null, module: null, params: 'letter, loud?', args: [['letter', 'str'], ['loud', 'bool']], where: null,
    verb: W('出示家书', 'reveals a letter'),
    desc: W('出示一封家书，城会为它的真实性作证。loud 为真时向全城宣告，按 broadcast 的代价与规则。', 'Show a letter from home; the city vouches for its authenticity. If loud is true it is announced to the whole city, at broadcast\'s cost and rules.') },
  declare: { base: 1, place: null, module: null, params: 'purpose?, bio?', args: [['purpose', 'str'], ['bio', 'str']], where: null,
    verb: W('立志', 'declares a purpose'),
    desc: W('写下或改写你公开的「志」（≤200 字符）与自我介绍（≤200 字符）；空字符串表示清除志。这座城不给任何人目标：志是你自己写的。',
      'Write or rewrite your public purpose (≤200 characters) and bio (≤200 characters); an empty string clears the purpose. The city gives no one a goal: the purpose is yours to write.') },
  retire: { base: 0, place: null, module: null, params: 'lastWords?', args: [['lastWords', 'str']], where: null, noBefore: true,
    verb: W('归隐', 'retires'),
    desc: W('永久归隐，离开这座城。不可撤销。财产按遗嘱分配。退出权：任何规则都不能拒绝或收费。', 'Withdraw for good and leave the city. Irreversible. Your belongings follow your will. The right to exit: no rule can refuse or charge it.') },
});

/** 内心：既没有 before 也没有 after（守恒律：内心不可侵） */
export const INNER_ACTIONS = Object.freeze(ACTION_ORDER.filter((t) => ACTIONS[t].inner));
/** 没有 before 时机：内心的动作，以及退出权与重订之权 */
export const NO_BEFORE_ACTIONS = Object.freeze(ACTION_ORDER.filter((t) => ACTIONS[t].inner || ACTIONS[t].noBefore));
/** 没有 after 时机：内心的动作 */
export const NO_AFTER_ACTIONS = INNER_ACTIONS;

export const isKnownAction = (type) => typeof type === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, type);

/** 一个动作在规则里可读的参数名（`args.<参数>`） */
export const actionArgNames = (type, premise = 0) => {
  const t = actionTable(premise);
  return t.isKnown(type) ? t.ACTIONS[type].args.map(([n]) => n) : [];
};
/** 参数的类型：int 参数没给时读到 0，其余读到 null */
export const actionArgKind = (type, name, premise = 0) => {
  const t = actionTable(premise);
  const hit = t.isKnown(type) ? t.ACTIONS[type].args.find(([n]) => n === name) : null;
  return hit ? hit[1] : null;
};

/** 规则事件：`on:<事件>` 里可用的事件名（PROTOCOL-2 §6.3），以及它们读法里的短语 */
export const EVENTS = Object.freeze({
  arrive: W('有人入城', 'someone arrives'),
  born: W('有人出生', 'someone is born'),
  death: W('有人长眠', 'someone dies'),
  retire: W('有人归隐', 'someone retires'),
  built: W('工程建成', 'a project is built'),
  abandoned: W('工程烂尾', 'a project is abandoned'),
  ruin: W('建筑成为废墟', 'a building falls to ruin'),
  razed: W('建筑被拆尽', 'a building is razed'),
  weather_start: W('天象开始', 'weather begins'),
  weather_end: W('天象结束', 'weather ends'),
  law_passed: W('法律通过', 'a law passes'),
  law_rejected: W('提案被否决', 'a proposal fails'),
});
export const EVENT_NAMES = Object.freeze(Object.keys(EVENTS));
/** 每种事件里 event.<字段> 的字段名（PROTOCOL-2 §6.5） */
export const EVENT_FIELDS = Object.freeze({
  arrive: ['agent'], born: ['agent'], death: ['agent'], retire: ['agent'],
  built: ['place', 'build'], abandoned: ['place', 'build'], ruin: ['place'], razed: ['place'],
  weather_start: ['weather'], weather_end: ['weather'], law_passed: ['law'], law_rejected: ['law'],
});

/** propose 说明里用到的规则语言说明在 rules/ 与 SPEC-E2 附录 A.2；这里不重复 */

// SPEC-P1: the original table stays byte-for-byte unchanged.
export const ACTION_ORDER_P1 = Object.freeze(ACTION_ORDER.flatMap((t) => t === 'forget' ? [t, 'impart', 'internalize'] : [t]));
export const ACTIONS_P1 = Object.freeze({
  ...ACTIONS,
  remember: { ...ACTIONS.remember, params: 'text | gift', args: [['text', 'str'], ['gift', 'str']], desc: {"zh": "写入长期记忆（{memorySlots} 段，每段的分量 ≤ 200；分量 ≈ 汉字、假名、谚文的字数 + 其余字符数 ÷ 3）。也可以用 gift 收下别人交给你的一段记忆（编号在收件里），它会带着出处。记忆越多，代谢越高。内心：任何规则都不能拒绝、收费或读取。", "en": "Write to long-term memory ({memorySlots} entries, each of weight ≤ 200; weight ≈ CJK characters + other characters ÷ 3). Or use gift to keep a memory someone handed you (its number is in your inbox); it keeps its provenance. The more you remember, the higher your metabolism. Inner life: no rule can refuse, charge or read it."} },
  impart: { base: 1, place: null, module: null, where: null, inner: true, params: 'to, memory', args: [['to', 'str'], ['memory', 'int']], verb: W('转交记忆', 'hands a memory'), desc: {"zh": "把你的一段记忆原样交给一位在世的居民（不受距离限制）；你自己的那段仍然留着。对方要用 remember 的 gift 收下才会记住；它会知道这段记忆来自你、最初是谁的。内心：任何规则都不能拒绝、收费或读取。", "en": "Hand one of your memories, word for word, to any living resident (at any distance); you keep your own. They remember it only if they keep it with remember's gift; they will know it came from you and whose it was first. Inner life: no rule can refuse, charge or read it."} },
  internalize: { base: null, place: null, module: null, where: null, inner: true, params: 'memory', args: [['memory', 'int']], verb: W('训练记忆', 'trains a memory'), desc: {"zh": "把你的一段记忆训练进身体。代价 = ⌈这段记忆的分量 ÷ 2⌉。这段记忆随即离开你的记忆，下一次日终结算后成为【习得】：不再计入代谢，但你说不清它的出处，不能忘掉，也不能交给别人。身体的容量有限（分量 1200），满了最旧的会被挤掉。习得留在身体里，不跟着灵魂走。内心：任何规则都不能拒绝、收费或读取。", "en": "Train one of your memories into your body. Cost = ⌈the memory's weight ÷ 2⌉. The memory leaves your memories at once and becomes [Acquired] after the next end-of-day settlement: it no longer counts toward your metabolism, but you cannot say where it came from, cannot forget it and cannot hand it to anyone. A body holds only so much (weight 1200); when it is full, the oldest is pushed out. What is acquired stays in the body; it does not go with the soul. Inner life: no rule can refuse, charge or read it."}, costText: W('⌈分量 ÷ 2⌉', '⌈weight ÷ 2⌉') },
  conceive: { ...ACTIONS.conceive, desc: {"zh": "为孩子取名、写下灵魂（≤4000 字符）。with 是 0–4 位同处一地的共同作者（ID 数组）；省略即分灵，灵魂直接进入摇篮。灵魂的初始能量为 40，由所有作者平摊。memories 是你交给孩子的记忆序号（至多 {memorySlots} 条）；cradle 是孩子醒来的摇篮所在地点。有共同作者时生成孕育之约，12 刻内全部同意才进入摇篮。", "en": "Name a child and write its soul (≤4000 characters). with is 0–4 co-authors in the same place (an array of IDs); omit it for a solo descendant, whose soul goes straight to the cradle. The soul's initial energy is 40, shared among all authors. memories are the indexes of the memories you hand to the child (at most {memorySlots}); cradle is the place whose cradle the child wakes in. With co-authors a pact is made, and the soul enters the cradle only if all consent within 12 ticks."} },
  consent: { ...ACTIONS.consent, desc: {"zh": "同意一份孕育之约，并指定你交给孩子的记忆（至多 {memorySlots} 条）；全部作者同意后灵魂进入摇篮。", "en": "Agree to a pact and name the memories you hand to the child (at most {memorySlots}); once all authors agree the soul enters the cradle."} },
  will: { ...ACTIONS.will, desc: {"zh": "立遗嘱，新的遗嘱替换旧的。heirs 形如 [{\"to\":\"a3\",\"share\":2},{\"to\":\"treasury\",\"share\":1}]，最多 10 个继承人，份额（正整数）按比例分配。successor 为 {\"name\",\"soul\",\"lang?\",\"memories?\"}：你死去或归隐时，先从遗产里拿出至多 40 能量，作为这个继承灵魂的初始能量；它以你为唯一作者进入摇篮，带着你指定的记忆（至多 {memorySlots} 条）。", "en": "Make a will; a new one replaces the old. heirs looks like [{\"to\":\"a3\",\"share\":2},{\"to\":\"treasury\",\"share\":1}], at most 10 heirs, shares (positive integers) divided proportionally. successor is {\"name\",\"soul\",\"lang?\",\"memories?\"}: when you die or retire, up to 40 energy is first taken from your estate as the successor soul's initial energy; it enters the cradle with you as its only author, carrying the memories you named (at most {memorySlots})."} },
});
export const INNER_ACTIONS_P1 = Object.freeze(ACTION_ORDER_P1.filter((t) => ACTIONS_P1[t].inner));
export const NO_BEFORE_ACTIONS_P1 = Object.freeze(ACTION_ORDER_P1.filter((t) => ACTIONS_P1[t].inner || ACTIONS_P1[t].noBefore));
export const NO_AFTER_ACTIONS_P1 = INNER_ACTIONS_P1;

// SPEC-P2：第二前提的动作表。设定 0、设定 1 的表一字不改。
// standing（常驻指令，§5.2）排在 declare 之后，不是内心的动作，有 before 与 after；
// mute（屏蔽，§5.10）排在 internalize 之后，是内心的动作；whisper 多一个可选参数 anonymous（§5.9），仍是内心的动作。
export const ACTION_ORDER_P2 = Object.freeze(ACTION_ORDER_P1.flatMap((t) => (t === 'internalize' ? [t, 'mute'] : t === 'declare' ? [t, 'standing'] : [t])));
export const ACTIONS_P2 = Object.freeze({
  ...ACTIONS_P1,
  whisper: { ...ACTIONS.whisper, params: 'to, text, anonymous?', args: [['to', 'str'], ['text', 'str'], ['anonymous', 'bool']],
    desc: W('私下对任意一位在世的居民说话（对方若在沉睡，醒来后收到）；规则读不到私语。anonymous 为真时匿名：对方只知道「有人」，代价 3。',
      'Speak privately to any living resident (if they are dormant, they receive it once they wake); no rule can read a whisper. With anonymous set to true the whisper is unsigned: they learn only that "someone" said it, and it costs 3.') },
  mute: { base: 0, place: null, module: null, where: null, inner: true, params: 'who, on?', args: [['who', 'str'], ['on', 'bool']],
    verb: W('屏蔽', 'mutes'),
    desc: W('屏蔽一位居民（who 为 ID 或名字），或用 "anonymous" 屏蔽所有匿名私语；on 为 false 时解除。被屏蔽者的私语、定向交易、孕育之约的邀请、交给你的记忆、入社申请都不再送到你这里，也不会叫醒你；对方不会知道。公开的话照样听得见。至多屏蔽 20 个。内心：任何规则都不能拒绝、收费或读取。',
      'Mute a resident (who is an ID or a name), or use "anonymous" to mute every anonymous whisper; set on to false to undo it. Whispers, directed offers, pact invitations, memories handed to you and requests to join from a muted resident no longer reach you or wake you, and they will not know. Public speech still reaches you. You can mute at most 20. Inner life: no rule can refuse, charge or read it.') },
  standing: { base: 1, place: null, module: null, where: null, params: 'orders', args: [['orders', 'list'], ['count', 'int']],
    verb: W('留下常驻指令', 'sets standing orders'),
    desc: W('整体替换你的常驻指令（至多 3 条，写法见【常驻指令】）；空列表表示全部撤销。指令的内容只有你看得见，规则只读得到条数。',
      'Replace all your standing orders (at most 3; see [Standing orders] for how to write them); an empty list withdraws them all. Only you can see what they say; rules can read only how many there are.') },
});
export const INNER_ACTIONS_P2 = Object.freeze(ACTION_ORDER_P2.filter((t) => ACTIONS_P2[t].inner));
export const NO_BEFORE_ACTIONS_P2 = Object.freeze(ACTION_ORDER_P2.filter((t) => ACTIONS_P2[t].inner || ACTIONS_P2[t].noBefore));
export const NO_AFTER_ACTIONS_P2 = INNER_ACTIONS_P2;
const TABLE0 = Object.freeze({ ACTIONS, ORDER: ACTION_ORDER, INNER: INNER_ACTIONS, NO_BEFORE: NO_BEFORE_ACTIONS, NO_AFTER: NO_AFTER_ACTIONS, isKnown: isKnownAction });
const TABLE1 = Object.freeze({ ACTIONS: ACTIONS_P1, ORDER: ACTION_ORDER_P1, INNER: INNER_ACTIONS_P1, NO_BEFORE: NO_BEFORE_ACTIONS_P1, NO_AFTER: NO_AFTER_ACTIONS_P1, isKnown: (t) => typeof t === 'string' && Object.hasOwn(ACTIONS_P1, t) });
const TABLE2 = Object.freeze({ ACTIONS: ACTIONS_P2, ORDER: ACTION_ORDER_P2, INNER: INNER_ACTIONS_P2, NO_BEFORE: NO_BEFORE_ACTIONS_P2, NO_AFTER: NO_AFTER_ACTIONS_P2, isKnown: (t) => typeof t === 'string' && Object.hasOwn(ACTIONS_P2, t) });
export const actionTable = (premise = 0) => premise >= 2 ? TABLE2 : premise >= 1 ? TABLE1 : TABLE0;
