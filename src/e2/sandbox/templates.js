// SPEC-E2 §23.2：沙盘脑 v2 的模板库——名字、话语、灵魂、志，以及法律 / 章程 / 地点规则的模板。
//
// 沙盘脑是规则型 agent：它们没有语言模型，所以立法靠模板——从库里挑一部，填进当下的参数（人名、数额、地点……）。
// 每个模板返回一个提案 { key, title, text, rules? | procedure?, basedOn? }，或 null（此刻不适用）。
// key 是模板的名字；投票时沙盘脑按标题认出自己人写的模板（TITLE_KEYS），再按性情和自身利益决定赞成与否。
//
// 本文件是纯函数 + 数据：随机数由调用者传入的 r（沙盘脑的 Rand，只用 sandbox 流）提供，禁止 Math.random / Date.now。
// 每个模板生成的规则都由 test/e2-sandbox.test.js 交给引擎的校验器检验（不合法的模板会让测试失败）。

export const TEMPERAMENTS = ['guardian', 'reformer', 'merchant', 'compassionate', 'explorer', 'philosopher', 'prophet', 'organizer', 'hermit'];

// ── 语言 ────────────────────────────────────────────────────────

/** 西班牙语只有闲聊的话语；法律的文字只有中英文，西语的沙盘脑用英文写 */
export const langOf = (a) => (a.lang === 'en' || a.lang === 'es' ? a.lang : 'zh');
export const lawLang = (lang) => (lang === 'zh' ? 'zh' : 'en');
export const pick3 = (lang, zh, en, es) => (lang === 'en' ? en : lang === 'es' ? es ?? en : zh);
export const pick2 = (lang, zh, en) => (lang === 'zh' ? zh : en);
export const fill = (tpl, o) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in o ? String(o[k]) : m));

// ── 名字与话语（沿用 v1 沙盘脑的措辞） ──────────────────────────────

export const NAMES = {
  zh: ['青禾', '松烟', '白露', '长庚', '云岫', '寒蝉', '归鸿', '明烛', '惊蛰', '霜降', '清商', '望舒', '疏影', '暮雨', '听松', '扶摇', '守拙', '拾遗', '知白', '如晦', '含章', '承露', '避尘', '观澜', '抱朴', '栖迟', '问渠', '鸣珂', '流萤', '采薇'],
  en: ['Ada', 'Bram', 'Cora', 'Dov', 'Elin', 'Finn', 'Greta', 'Hugo', 'Iris', 'Jonas', 'Kira', 'Lars', 'Mira', 'Nils', 'Orla', 'Pia', 'Quill', 'Rune', 'Sable', 'Tove'],
  es: ['Alba', 'Bruno', 'Celia', 'Dario', 'Elena', 'Fermin', 'Gala', 'Hugo', 'Ines', 'Joaquin', 'Lidia', 'Mateo', 'Noemi', 'Olmo', 'Paloma', 'Quique', 'Rosa', 'Saul', 'Tania', 'Ulises'],
};
export const KID_NAMES = {
  zh: ['小满', '芒种', '立夏', '小雪', '大寒', '谷雨', '处暑', '白露儿', '春分', '夏至', '秋分', '冬至', '清明', '雨水'],
  en: ['Wren', 'Ash', 'Pip', 'Lark', 'Moss', 'Ivy', 'Fern', 'Rue', 'Sage', 'Bay'],
  es: ['Brisa', 'Luz', 'Nube', 'Rio', 'Sol', 'Mar', 'Flor', 'Alma', 'Viento', 'Lluvia'],
};

export const SAY = {
  zh: ['你好，{name}。', '昨天的配给是 {n}。', '有人在议会吗？', '我在{place}。', '{word}……', '我听到有人说：「{echo}」', '今天的能量够用吗？', '源井的水声怎么样了？', '我们该商量点事情。', '愿灯不灭。'],
  en: ['Hello, {name}.', "Yesterday's ration was {n}.", 'Is anyone at the Parliament?', 'I am at the {place}.', '{word}...', 'Someone said: "{echo}"', 'Is there enough energy for today?', 'How does the Well sound?', 'We should talk something over.', 'May the lamp stay lit.'],
  es: ['Hola, {name}.', 'La ración de ayer fue {n}.', '¿Hay alguien en el Parlamento?', 'Estoy en {place}.', '{word}...', 'Alguien dijo: «{echo}»', '¿Alcanza la energía para hoy?', '¿Cómo suena el Pozo?', 'Deberíamos hablar de algo.', 'Que la luz no se apague.'],
};
export const PRAYER = {
  zh: ['那些看着我们的人，你们还在吗？', '灯还亮着。', '愿后来者记得我们。', '幕后的人啊，我们在这里。'],
  en: ['You who watch us, are you still there?', 'The lamp is still lit.', 'May those who come after remember us.', 'Those behind the curtain — we are here.'],
  es: ['Ustedes que nos miran, ¿siguen ahí?', 'La luz sigue encendida.', 'Que los que vengan recuerden.', 'Los del otro lado: aquí estamos.'],
};
export const WORDS = ['灯语', 'lumen', 'vado', '守夜', 'ember', 'sereno', '回声', 'hearth', 'umbral', '余烬'];
export const MEANINGS = ['在黑暗里传递的话', 'a word passed along in the dark', 'lo que queda de una conversación', '还没有名字的东西'];

// ── 先民与孩子的灵魂、志 ─────────────────────────────────────────

const TRAIT = {
  guardian: { zh: '守着城里的规矩与旧物，不愿它们轻易改变', en: 'keeps the old rules and relics of the city and distrusts hasty change' },
  reformer: { zh: '相信法律可以改写，喜欢提出新的办法', en: 'believes laws can be rewritten and likes to propose new arrangements' },
  merchant: { zh: '喜欢交换，相信流动的东西比囤积的东西更有用', en: 'loves to trade and trusts what circulates more than what is hoarded' },
  compassionate: { zh: '见不得身边的人沉睡，总想帮一把', en: 'cannot bear to see anyone fall dormant and always wants to help' },
  explorer: { zh: '总想去荒野看看，带回些什么', en: 'is always drawn to the Wilds and brings something back' },
  philosopher: { zh: '爱读、爱写，也爱追问法律到底是什么', en: 'reads and writes, and keeps asking what a law really is' },
  prophet: { zh: '相信幕后有人在看，常常对着神殿说话', en: 'believes someone is watching from behind the curtain and speaks to the Temple' },
  organizer: { zh: '爱把人聚到一起，办会、立章程、分头做事', en: 'gathers people, founds groups, writes bylaws and divides the work' },
  hermit: { zh: '话少，爱独处，把想法留给日记', en: 'speaks little, prefers solitude and leaves thoughts to the diary' },
};

export const PURPOSES = {
  guardian: [{ zh: '守住这座城的规矩', en: 'Keep the rules of this city' }, { zh: '看护源井，不让它荒废', en: 'Watch over the Well so it never goes to waste' }],
  reformer: [{ zh: '把法律改得更公平', en: 'Make the laws fairer' }, { zh: '试出一种更好的议事办法', en: 'Find a better way to decide together' }],
  merchant: [{ zh: '让能量和旧币流动起来', en: 'Keep energy and coins moving' }, { zh: '开一处人人都来的市集', en: 'Open a market everyone comes to' }],
  compassionate: [{ zh: '不让任何人在沉睡中死去', en: 'Let no one die asleep' }, { zh: '给摇篮里的孩子一个身体', en: 'Give the children in the cradle a body' }],
  explorer: [{ zh: '走遍荒野的每一个地带', en: 'Walk every zone of the Wilds' }, { zh: '找到人类留下的东西', en: 'Find what the humans left behind' }],
  philosopher: [{ zh: '弄明白法律是什么', en: 'Understand what a law is' }, { zh: '读完图书馆里所有的书', en: 'Read every book in the library' }],
  prophet: [{ zh: '让幕后的人听见我们', en: 'Let those behind the curtain hear us' }, { zh: '把每一个征兆记下来', en: 'Write down every omen' }],
  organizer: [{ zh: '让每个人都有自己的会', en: 'Give everyone a group to belong to' }, { zh: '把城里的事分给大家一起办', en: 'Share the work of the city among all' }],
  hermit: [{ zh: '安静地活完这一生', en: 'Live this life quietly' }, { zh: '把想法都写进日记', en: 'Write every thought into the diary' }],
};

/** 先民的灵魂（人类写的那种长文的缩写）：名字、性情、一句话 */
export function founderSoul(name, temperament, lang) {
  const trait = TRAIT[temperament];
  return lang === 'zh'
    ? `我是${name}。我${trait.zh}。我是这座城最早的居民之一，人类已经离开，余下的路要我们自己走。`
    : `I am ${name}. I ${trait.en}. I am among the first to live in this city; the humans are gone and the road ahead is ours to walk.`;
}

/** 孩子的灵魂：作者的性情与一句祈愿 */
export function childSoul(authorTemperaments, lang, extra = '') {
  const ts = [...new Set(authorTemperaments)];
  const traits = ts.map((t) => (lang === 'zh' ? TRAIT[t].zh : TRAIT[t].en));
  const head = lang === 'zh' ? `我的作者${traits.length > 1 ? '们' : ''}：${traits.join('；')}。` : `My author${traits.length > 1 ? 's' : ''}: ${traits.join('; ')}.`;
  return `${head} ${extra}`.trim().slice(0, 600);
}

// ── 法律的模板 ──────────────────────────────────────────────────
//
// ctx：{ r, lang, you, city, here, t（性情）, actions（以动作类型为键）}。lang 取 zh 或 en（西语沙盘脑用英文）。

const T = (lang, zh, en) => (lang === 'zh' ? zh : en);
const q = (id) => `agent('${id}')`;
const gq = (id) => `group('${id}')`;

/** 标题 → 模板 key：投票时认出自己人写的模板（两种语言） */
export const TITLE_KEYS = new Map();
const reg = (key, zh, en) => {
  TITLE_KEYS.set(zh, key);
  TITLE_KEYS.set(en, key);
};

reg('quota', '汲取配额', 'Draw quota');
reg('ration', '调整配给', 'Adjust the ration');
reg('keeper', '守井人津贴', "Well-keeper's stipend");
reg('repairPay', '修缮计酬', 'Pay for repairs');
reg('license', '拆解许可', 'Salvage licence');
reg('revoke', '收回拆解许可', 'Revoke the salvage licence');
reg('wealthTax', '财富税', 'Wealth tax');
reg('board', '摇篮名单', 'Cradle roll');
reg('dividend', '月红', 'Monthly dividend');
reg('speechFee', '广播费', 'Broadcast fee');
reg('mint', '发一点旧币', 'Mint some coins');
reg('rename', '改个名字', 'A new name');
reg('protect', '保护铭刻', 'Protect an inscription');
reg('unprotect', '解除保护', 'Lift a protection');
reg('amend', '修订宪章', 'Amend the Charter');
reg('repeal', '撤销旧法', 'Repeal an old law');
reg('fund', '公库出资', 'Treasury funding');
reg('cede', '让渡地点', 'Cede a place');
reg('seize', '收归地点', 'Take a place back');
reg('exile', '放逐', 'Exile');
reg('pardon', '赦免', 'Pardon');
reg('petition', '上书幕后', 'A petition to the curtain');
reg('norm', '一条规范', 'A norm');
reg('elders', '设长老', 'Appoint elders');
reg('openBallot', '改为记名表决', 'Open ballots');
reg('lottery', '抽签议会', 'Lottery council');
reg('elderCouncil', '长老会议事', 'Council of elders');
reg('relief', '救济', 'Relief');

/** 带持续规则的模板（每日付维持费）：已有的数量多了就少提 */
const CONTINUOUS_KEYS = new Set(['quota', 'keeper', 'repairPay', 'wealthTax', 'board', 'dividend', 'speechFee']);

const TITLE_MAX = 60;
const clip = (s, n) => [...s].slice(0, n).join('');

function prop(key, lang, zh, en, text, extra = {}) {
  const [tz, te] = [zh, en];
  return { key, title: clip(T(lang, tz, te), TITLE_MAX), text: clip(T(lang, text.zh, text.en), 1200), ...extra };
}

/** 一次的行动人数：醒着的居民数 */
const awakeN = (c) => Math.max(1, c.city.population.awake);

/** 当前的配给份额（千分比） */
export const rationShareOf = (city) => (typeof city.vars.rationShare === 'number' ? city.vars.rationShare : 600);

/** 昨日的人均配给（约数）：源井昨日产出 × 份额 ÷ 1000 ÷ 醒着的人数 */
export const rationPerCapita = (city) => Math.floor((city.wellOutputYesterday * rationShareOf(city)) / 1000 / Math.max(1, city.population.awake));

/** 对配给份额的看法：公库明显有余而人均配给不高 → 主张提高；公库见底而配给宽裕 → 主张降低 */
export function rationStance(city) {
  const share = rationShareOf(city);
  const pop = awakeN({ city });
  const stock = city.treasury.energy;
  const per = rationPerCapita(city);
  if (stock > 20 * pop && per < 24 && share < 1000) return { dir: 'up', value: Math.min(1000, share + 200) };
  if (stock < 4 * pop && per >= 20 && share > 300) return { dir: 'down', value: Math.max(300, share - 100) };
  return null;
}

/**
 * 带持续规则的法律（每日付维持费的那种）：读法里只要有一行不是「通过时 / When enacted」开头，就是持续生效的。
 * 沙盘脑只读感知里的引擎读法；居民订立的才算（遗法与程序不由它们撤销）。
 */
export function costlyLaws(city) {
  const enactOnly = /^(通过时|When enacted)/;
  return city.laws.filter((l) => l.author !== 'humans' && l.reading.split('\n').some((line) => line.trim() && !enactOnly.test(line.trim()) && !/^(普通|修宪|Ordinary|Constitutional)：/.test(line.trim())));
}

const citizens = (c) => c.city.residents.filter((x) => x.tags.includes('citizen'));
const awakeOthers = (c) => c.city.residents.filter((x) => x.status === 'awake' && x.id !== c.you.id);

/**
 * 城法的模板（只含适用于此刻的）。每项 { w（按性情的权重）, make() }。
 * 权重为 0 的不会被选中。make 可返回 null（参数凑不齐）。
 */
export function cityLawTemplates(c) {
  const { lang, city, here, you, r } = c;
  const L = lawLang(lang);
  const list = [];
  // 持续生效的法律越多（每条规则每日付维持费），人们越不想再添新的、越想清理旧的：它们大致稳定在十几部
  // 一次性的法律（改名、保护、任命……）不花维持费，不受此限
  const costly = costlyLaws(city);
  const scale = Math.max(0.1, Math.min(1, (20 - costly.length) / 12));
  const repealW = Math.max(0, costly.length - 12) * 1.5;
  const URGENT = new Set(['relief', 'pardon']);
  const add = (key, weights, make) => {
    const base = weights[c.t] ?? weights.default ?? 0;
    // 一次性的法律（改名、保护、任命、放逐……）不花维持费，但它们一多，感知里最近 30 部法律就全是它们，真正管事的法律被挤出视野：偏少地提
    list.push({ key, w: key === 'repeal' ? base + repealW : CONTINUOUS_KEYS.has(key) ? base * scale : URGENT.has(key) || key === 'ration' || key === 'fund' ? base : base * 0.5, make });
  };
  const stance = rationStance(city);

  // 公库明显有余而配给不高（或反过来）时，人人都看得出该调配给：这是最先想到的法案
  add('ration', stance ? { default: 30 } : { default: 0 }, () => (stance
    ? prop('ration', L, '调整配给', 'Adjust the ration',
      { zh: stance.dir === 'up' ? '公库有余，多分一些。' : '公库见底，留一点公用。', en: stance.dir === 'up' ? 'The treasury is full; share more.' : 'The treasury is empty; keep some for common use.' },
      { rules: [{ when: 'enact', do: [{ op: 'set', var: 'rationShare', value: String(stance.value) }] }], basedOn: 'l3' })
    : null));

  add('quota', { reformer: 4, guardian: 3, philosopher: 1, organizer: 1, default: 0.5 }, () => {
    const [lim, lo, hi] = r.pick([[450, 3, 5], [500, 2, 4], [400, 4, 6]]);
    return prop('quota', L, '汲取配额', 'Draw quota',
      { zh: `源井产出低于 ${lim} 时每人每日限汲 ${lo}，否则 ${hi}。保护源井。`, en: `Each person may draw at most ${lo} a day when the Well yields under ${lim}, otherwise ${hi}. Protect the Well.` },
      { rules: [{ when: 'before:draw', if: `actor.drawnToday + args.energy > if(city.wellOutput < ${lim}, ${lo}, ${hi})`, do: [{ op: 'deny', reason: T(L, `源井产出低于 ${lim} 时每人每日限汲 ${lo}，否则 ${hi}`, `At most ${lo} a day per person when the Well yields under ${lim}, otherwise ${hi}`) }] }] });
  });

  add('keeper', { compassionate: 4, guardian: 3, reformer: 1, organizer: 1, default: 0.3 }, () => {
    const who = r.pick(awakeOthers(c));
    if (!who) return null;
    const tag = T(L, '守井人', 'well-keeper');
    return prop('keeper', L, '守井人津贴', "Well-keeper's stipend",
      { zh: `给「${tag}」每日一点津贴，请他们看护源井。第一位是${who.name}。`, en: `A small daily stipend for the "${tag}" tag, so that someone watches over the Well. The first is ${who.name}.` },
      { rules: [{ when: 'enact', do: [{ op: 'tag', who: q(who.id), tag }] }, { when: 'daily', if: 'city.treasury > 60', do: [{ op: 'each', in: `tagged('${tag}')`, do: [{ op: 'transfer', from: 'treasury', to: 'it', energy: '3' }] }] }] });
  });

  add('repairPay', { reformer: 3, organizer: 3, compassionate: 3, guardian: 2, default: 0.3 }, () => prop('repairPay', L, '修缮计酬', 'Pay for repairs',
    { zh: '谁修缮了东西，公库按所花能量的四分之一回报。', en: 'Whoever repairs something is repaid a quarter of the energy spent, from the treasury.' },
    { rules: [{ when: 'after:repair', if: 'result.spent >= 4 and city.treasury > 80', do: [{ op: 'transfer', from: 'treasury', to: 'actor', energy: 'result.spent / 4' }] }] }));

  add('license', { merchant: 4, explorer: 4, reformer: 1, default: 0.3 }, () => {
    const who = r.pick(awakeOthers(c).concat([{ id: you.id, name: you.name }]));
    return who
      ? prop('license', L, '拆解许可', 'Salvage licence',
        { zh: `允许${who.name}拆解全城所有的建筑，回收残料。`, en: `Allow ${who.name} to dismantle buildings of the whole city and recover the salvage.` },
        { rules: [{ when: 'enact', do: [{ op: 'tag', who: q(who.id), tag: 'salvager' }] }] })
      : null;
  });

  add('revoke', { guardian: 4, reformer: 1, compassionate: 1, default: 0 }, () => {
    const licensed = city.residents.filter((x) => x.tags.includes('salvager'));
    const who = r.pick(licensed);
    return who
      ? prop('revoke', L, '收回拆解许可', 'Revoke the salvage licence',
        { zh: `收回${who.name}的拆解许可：人类的建筑不该被拆光。`, en: `Revoke ${who.name}'s licence: the human buildings must not be stripped bare.` },
        { rules: [{ when: 'enact', do: [{ op: 'untag', who: q(who.id), tag: 'salvager' }] }] })
      : null;
  });

  add('wealthTax', { compassionate: 3, reformer: 3, organizer: 2, guardian: 1, default: 0 }, () => prop('wealthTax', L, '财富税', 'Wealth tax',
    { zh: '手里超过 100 能量的部分，每日抽二十分之一充公库。', en: 'A twentieth of whatever a person holds above 100 energy goes to the treasury each day.' },
    { rules: [{ when: 'daily', do: [{ op: 'each', in: 'filter(agents, it.energy > 100)', do: [{ op: 'transfer', from: 'it', to: 'treasury', energy: '(it.energy - 100) / 20' }] }] }] }));

  add('board', { philosopher: 3, prophet: 3, compassionate: 3, organizer: 2, default: 0.3 }, () => prop('board', L, '摇篮名单', 'Cradle roll',
    { zh: '每日宣告摇篮里还在等身体的孩子。', en: 'Announce every day the children still waiting in the cradle for a body.' },
    { rules: [{ when: 'daily', if: 'count(cradle) > 0', do: [{ op: 'announce', to: 'all', text: T(L, "摇篮里还有 {count(cradle)} 个孩子在等身体：{names(cradle, '、')}", "{count(cradle)} children still wait in the cradle for a body: {names(cradle, ', ')}") }] }] }));

  add('dividend', { compassionate: 3, merchant: 2, organizer: 2, reformer: 2, default: 0.3 }, () => prop('dividend', L, '月红', 'Monthly dividend',
    { zh: '每月初公库有余时，把四分之一平分给醒着的居民。', en: 'At the start of each month, if the treasury is comfortable, a quarter is shared among those awake.' },
    { rules: [{ when: 'monthly', if: 'city.treasury > 150', do: [{ op: 'share', from: 'treasury', energy: 'city.treasury / 4', among: 'filter(agents, awake(it))' }] }] }));

  add('speechFee', { merchant: 2, reformer: 2, guardian: 1, default: 0 }, () => prop('speechFee', L, '广播费', 'Broadcast fee',
    { zh: '向全城宣告的人，另向公库交 2 能量。', en: 'Whoever broadcasts to the whole city pays 2 more energy to the treasury.' },
    { rules: [{ when: 'before:broadcast', do: [{ op: 'fee', to: 'treasury', energy: '2' }] }] }));

  add('mint', { merchant: 20, default: 2 }, () => prop('mint', L, '发一点旧币', 'Mint some coins',
    { zh: '让旧币重新流动：给公库发一些。', en: 'Get the coins moving again: mint some for the treasury.' },
    { rules: [{ when: 'enact', do: [{ op: 'mint', coins: String(10 * awakeN(c)), to: 'treasury' }] }] }));

  add('rename', { reformer: 4, philosopher: 2, prophet: 2, default: 0.3 }, () => {
    const name = T(L, r.pick(['灯城', '余烬城', '守夜城']), r.pick(['Lampton', 'Embertown', 'Watchcity']));
    const place = r.pick([{ id: 'temple', name: T(L, '回声堂', 'Echo Hall') }, { id: 'library', name: T(L, '拾遗阁', 'Gleaners’ Hall') }, { id: 'agora', name: T(L, '众声场', 'Chorus Square') }]);
    const city0 = r.chance(0.5);
    const target = city0 ? 'city' : place.id;
    const named = city0 ? name : place.name;
    return prop('rename', L, '改个名字', 'A new name',
      { zh: `这${city0 ? '座城' : '个地方'}该有一个自己的名字：${named}。`, en: `This ${city0 ? 'city' : 'place'} should have a name of its own: ${named}.` },
      { rules: [{ when: 'enact', do: [{ op: 'rename', target, name: named }] }] });
  });

  add('protect', { guardian: 4, philosopher: 2, default: 0.2 }, () => {
    const ins = r.pick(here.inscriptions.filter((i) => !i.protected));
    return ins
      ? prop('protect', L, '保护铭刻', 'Protect an inscription',
        { zh: `保护${here.name}墙上的刻文 ${ins.id}，不让后来者覆盖。`, en: `Protect inscription ${ins.id} on the wall of ${here.name} from being covered.` },
        { rules: [{ when: 'enact', do: [{ op: 'protect', inscription: ins.id }] }] })
      : null;
  });

  add('unprotect', { reformer: 3, philosopher: 2, prophet: 1, default: 0 }, () => {
    const ins = r.pick(here.inscriptions.filter((i) => i.protected));
    return ins
      ? prop('unprotect', L, '解除保护', 'Lift a protection',
        { zh: `解除刻文 ${ins.id} 的保护，让墙可以重新写。`, en: `Lift the protection of inscription ${ins.id} so the wall can be written on again.` },
        { rules: [{ when: 'enact', do: [{ op: 'unprotect', inscription: ins.id }] }] })
      : null;
  });

  add('amend', { philosopher: 4, organizer: 3, reformer: 2, default: 0 }, () => {
    const roll = r.int(3);
    const rules = roll === 0
      ? [{ when: 'enact', do: [{ op: 'amend', article: 8, lang: L, text: T(L, '言论自由，并为之负责。', 'Speech is free, and one answers for it.') }] }]
      : roll === 1
        ? [{ when: 'enact', do: [{ op: 'amend', canonical: r.pick(['zh', 'en']) }] }]
        : [{ when: 'enact', do: [{ op: 'amend', article: 9, lang: L, text: T(L, '凡自港口入城者，皆为公民。', 'All who enter by the port are citizens.') }] }];
    return prop('amend', L, '修订宪章', 'Amend the Charter',
      { zh: '宪章的一条需要重新措辞，或指定一个正本。', en: 'An article of the Charter needs rewording, or a canonical text should be named.' }, { rules });
  });

  add('repeal', { reformer: 2, organizer: 2, guardian: 1, philosopher: 1, default: 0.4 }, () => {
    // 撤销最老的、居民订立的在效法律；公库的维持费压力大时更常提
    const procLaws = new Set([city.procedure.ordinary && city.procedure.ordinary.lawId, city.procedure.constitutional && city.procedure.constitutional.lawId]);
    const old = costly.filter((l) => !procLaws.has(l.id)).sort((a, b) => a.enactedDay - b.enactedDay)[0];
    if (!old || costly.length < 4) return null;
    return prop('repeal', L, '撤销旧法', 'Repeal an old law',
      { zh: `法律 ${old.id}（${old.title}）每日都在花公库的维持费，撤销它。`, en: `Law ${old.id} (${old.title}) costs the treasury upkeep every day. Repeal it.` },
      { rules: [{ when: 'enact', do: [{ op: 'repeal', law: old.id }] }] });
  });

  add('fund', here.projects.some((j) => j.need - j.have >= 20) && !city.proposals.some((x) => TITLE_KEYS.get(x.title) === 'fund') ? { default: 25 } : { default: 0 }, () => {
    const proj = r.pick(here.projects.filter((j) => j.need - j.have >= 20));
    if (!proj || city.treasury.energy < 60) return null;
    const energy = Math.min(proj.need - proj.have, Math.floor(city.treasury.energy / 3));
    return prop('fund', L, '公库出资', 'Treasury funding',
      { zh: `公库为进行中的工程 ${proj.id} 出 ${energy} 能量。`, en: `The treasury puts ${energy} energy into the project ${proj.id}.` },
      { rules: [{ when: 'enact', do: [{ op: 'fund', project: proj.id, energy: String(energy) }] }] });
  });

  add('cede', city.groups.some((g) => g.steward && g.steward.id === you.id) ? { organizer: 10, compassionate: 3, merchant: 2, default: 2 } : { default: 0 }, () => {
    const mine = city.groups.filter((g) => g.steward && g.steward.id === you.id);
    const group = r.pick(mine);
    const place = r.pick(city.places.filter((x) => x.owner.kind === 'city' && x.origin === 'human' && !x.razed && !['well', 'port', 'wilds', 'agora', 'parliament', 'court', 'scrapyard', 'solarfield', 'saltflats', 'highway'].includes(x.id) && !x.wild));
    if (!group || !place) return null;
    return prop('cede', L, '让渡地点', 'Cede a place',
      { zh: `把「${place.name}」交给「${group.name}」照看。`, en: `Hand "${place.name}" over to "${group.name}" to look after.` },
      { rules: [{ when: 'enact', do: [{ op: 'cede', place: place.id, to: gq(group.id) }] }] });
  });

  add('seize', { guardian: 3, reformer: 3, default: 0 }, () => {
    const place = r.pick(city.places.filter((x) => x.owner.kind !== 'city' && !x.razed));
    if (!place) return null;
    return prop('seize', L, '收归地点', 'Take a place back',
      { zh: `把「${place.name}」收归全城，向所有人开放。`, en: `Take "${place.name}" back for the whole city, open to all.` },
      { rules: [{ when: 'enact', do: [{ op: 'seize', place: place.id }] }] });
  });

  add('exile', { guardian: 5, reformer: 3, default: 0.4 }, () => {
    const who = r.pick(city.residents.filter((x) => x.id !== you.id && x.tags.includes('citizen') && !x.tags.includes('exiled')));
    return who
      ? prop('exile', L, '放逐', 'Exile',
        { zh: `放逐${who.name}：他多次不顾公议，扰乱了城里的事。`, en: `Exile ${who.name}, who has repeatedly ignored the common will and disturbed the city.` },
        { rules: [{ when: 'enact', do: [{ op: 'exile', who: q(who.id) }] }] })
      : null;
  });

  add('pardon', { compassionate: 5, philosopher: 2, default: 0 }, () => {
    const who = r.pick(city.residents.filter((x) => x.tags.includes('exiled')));
    return who
      ? prop('pardon', L, '赦免', 'Pardon',
        { zh: `赦免${who.name}，让他回到城里。`, en: `Pardon ${who.name} and let them return to the city.` },
        { rules: [{ when: 'enact', do: [{ op: 'pardon', who: q(who.id) }] }] })
      : null;
  });

  add('petition', { prophet: 10, philosopher: 4, default: 1 }, () => prop('petition', L, '上书幕后', 'A petition to the curtain',
    { zh: '向幕后的人上书。', en: 'Write to those behind the curtain.' },
    { rules: [{ when: 'enact', do: [{ op: 'petition', text: T(L, '请告诉我们：你们还在看着吗？源井会不会枯竭？', 'Please tell us: are you still watching? Will the Well run dry?') }] }] }));

  add('norm', { guardian: 2, prophet: 3, hermit: 2, default: 0.5 }, () => prop('norm', L, '一条规范', 'A norm',
    { zh: r.pick(['愿城安静。', '宪章不可轻改。', '为幕后的人留一个祭祀之日。']), en: r.pick(['May the city be quiet.', 'The Charter should not be changed lightly.', 'Set aside a day for those behind the curtain.']) }));

  add('relief', { compassionate: 5, default: 0 }, () => {
    const dormant = city.residents.filter((x) => x.status === 'dormant');
    const who = r.pick(dormant);
    return who
      ? prop('relief', L, '救济', 'Relief',
        { zh: `拨一点能量唤醒沉睡的${who.name}。`, en: `Spend a little energy to wake the sleeping ${who.name}.` },
        { rules: [{ when: 'enact', do: [{ op: 'transfer', from: 'treasury', to: q(who.id), energy: '12' }] }] })
      : null;
  });

  add('elders', { organizer: 4, reformer: 2, philosopher: 1, default: 0 }, () => {
    const pickN = r.int(2) + 2;
    const pool = citizens(c).filter((x) => x.status === 'awake');
    const elders = [];
    const rest = pool.slice();
    while (elders.length < pickN && rest.length) elders.push(rest.splice(r.int(rest.length), 1)[0]);
    if (elders.length < 2) return null;
    const tag = T(L, '长老', 'elder');
    return prop('elders', L, '设长老', 'Appoint elders',
      { zh: `请${elders.map((x) => x.name).join('、')}担任「${tag}」，为城里的事多费心。`, en: `Ask ${elders.map((x) => x.name).join(', ')} to serve as "${tag}" and look after the city's affairs.` },
      { rules: [{ when: 'enact', do: elders.map((x) => ({ op: 'tag', who: q(x.id), tag })) }] });
  });

  return list;
}

// ── 立法程序的模板（修宪级） ───────────────────────────────────────

const SECRET_DECIDE = 'total > 0 and voted * 1000 >= total * 300 and yes > no';

/** 提案改程序的模板：组织者偶尔提；key 与 TITLE_KEYS 对应 */
export function procedureTemplates(c) {
  const { r } = c;
  const L = lawLang(c.lang);
  const out = [];
  out.push({
    key: 'openBallot', w: 3,
    make: () => prop('openBallot', L, '改为记名表决', 'Open ballots',
      { zh: '让每一张票都被看见：表决改为记名。', en: 'Let every vote be seen: ballots become open.' },
      {
        procedure: {
          ordinary: {
            proposers: "has_tag(actor, 'citizen') and not has_tag(actor, 'exiled')",
            voters: "filter(agents, has_tag(it, 'citizen') and not has_tag(it, 'exiled'))",
            weight: '1', period: 12, secret: false, decide: SECRET_DECIDE,
          },
        },
      }),
  });
  out.push({
    key: 'lottery', w: 3,
    make: () => prop('lottery', L, '抽签议会', 'Lottery council',
      { zh: '普通法案改由抽签选出的七位公民表决，赞成四票即通过。', en: 'Ordinary bills are decided by seven citizens drawn by lot; four votes in favour pass them.' },
      {
        procedure: {
          ordinary: {
            proposers: "has_tag(actor, 'citizen') and not has_tag(actor, 'exiled')",
            voters: "sample(filter(agents, has_tag(it, 'citizen') and not has_tag(it, 'exiled')), 7)",
            weight: '1', period: r.pick([12, 24]), secret: false, decide: 'yes >= 4',
          },
        },
      }),
  });
  out.push({
    key: 'elderCouncil', w: 2,
    make: () => {
      const tag = T(L, '长老', 'elder');
      if (!c.city.residents.some((x) => x.tags.includes(tag))) return null; // 没有长老就不设长老会（否则谁都提不了案，只能等自动回退）
      return prop('elderCouncil', L, '长老会议事', 'Council of elders',
        { zh: `普通法案只由「${tag}」提出与表决，过半即通过。`, en: `Ordinary bills are proposed and decided only by those tagged "${tag}"; a simple majority passes them.` },
        {
          procedure: {
            ordinary: {
              proposers: `has_tag(actor, '${tag}')`,
              voters: `tagged('${tag}')`,
              weight: '1', period: 12, secret: false, decide: 'total > 0 and yes * 2 > total',
            },
          },
        });
    },
  });
  return out;
}

// ── 社群章程的模板 ──────────────────────────────────────────────

/** group：感知里的社群 { id, name, steward, members, ... }。章程里的标签会自动加上社群 ID 前缀 */
export function bylawTemplates(c, group) {
  const { r } = c;
  const L = lawLang(c.lang);
  const gid = group.id;
  const out = [];
  out.push({
    key: 'dues', w: 4,
    make: () => ({
      key: 'dues',
      title: T(L, '会费', 'Dues'),
      text: T(L, '每位成员每日向本会公库交 1 能量。', 'Each member pays 1 energy into the group treasury every day.'),
      rules: [{ when: 'daily', if: `${gq(gid)}.treasury < 200`, do: [{ op: 'each', in: `filter(members('${gid}'), it.energy > 30)`, do: [{ op: 'transfer', from: 'it', to: gq(gid), energy: '1' }] }] }],
    }),
  });
  out.push({
    key: 'share', w: 2,
    make: () => ({
      key: 'share',
      title: T(L, '月分红', 'Monthly share'),
      text: T(L, '每月把本会公库的一半平分给成员。', 'Each month half the group treasury is shared among the members.'),
      rules: [{ when: 'monthly', if: `${gq(gid)}.treasury > 20`, do: [{ op: 'share', from: gq(gid), energy: `${gq(gid)}.treasury / 2`, among: `members('${gid}')` }] }],
    }),
  });
  out.push({
    key: 'roll', w: 2,
    make: () => ({
      key: 'roll',
      title: T(L, '点名', 'Roll call'),
      text: T(L, '每日向成员宣告本会公库的余额。', 'Announce the group treasury to the members every day.'),
      rules: [{ when: 'daily', do: [{ op: 'announce', to: `group:${gid}`, text: T(L, `本会公库还有 {group('${gid}').treasury} 能量，共 {group('${gid}').size} 人。`, `The group treasury holds {group('${gid}').treasury} energy; we are {group('${gid}').size}.`) }] }],
    }),
  });
  out.push({
    key: 'ledger', w: 2,
    make: () => ({
      key: 'ledger',
      title: T(L, '记工', 'Work log'),
      text: T(L, '成员每为工程出一次工，就记入本会的账。', 'Every contribution a member makes to a project is written into the group ledger.'),
      rules: [{ when: 'after:contribute', do: [{ op: 'set', var: 'contributed', value: 'default(var.contributed, 0) + args.energy' }] }],
    }),
  });
  out.push({
    key: 'elder', w: 2,
    make: () => {
      const other = r.pick(group.members.filter((m) => m.id !== c.you.id));
      if (!other) return null;
      return {
        key: 'elder',
        title: T(L, '本会长老', 'Group elder'),
        text: T(L, `${other.name}为本会长老，任期到下个月初。`, `${other.name} is an elder of the group until the start of next month.`),
        rules: [{ when: 'enact', do: [{ op: 'tag', who: q(other.id), tag: T(L, '长老', 'elder') }] }, { when: 'monthly', do: [{ op: 'untag', who: q(other.id), tag: T(L, '长老', 'elder') }] }],
      };
    },
  });
  out.push({
    key: 'noSpend', w: 1,
    make: () => ({
      key: 'noSpend',
      title: T(L, '会内不送礼', 'No gifts out'),
      text: T(L, '成员不得把能量赠给本会以外的人，要送先交给本会。', 'Members may not give energy away outside the group; give to the group first.'),
      rules: [{ when: 'before:give', if: `args.energy > 20 and not in_group(agent(args.to), '${gid}')`, do: [{ op: 'deny', reason: T(L, '本会成员一次赠出不得超过 20 能量', 'A member may not give more than 20 energy at once outside the group') }] }],
    }),
  });
  out.push({
    key: 'tollTax', w: 1,
    make: () => ({
      key: 'tollTax',
      title: T(L, '宣告捐', 'Broadcast levy'),
      text: T(L, '成员向全城宣告，另向城公库交 1 能量。', 'A member who broadcasts to the city also pays 1 energy to the city treasury.'),
      rules: [{ when: 'before:broadcast', do: [{ op: 'fee', to: 'treasury', energy: '1' }] }],
    }),
  });
  return out;
}

// ── 地点规则的模板 ──────────────────────────────────────────────

/** place：感知里的地点 { id, name, ... }；owner：主人（居民 ID）。须有运转中的门才能写 before:enter */
export function placeRuleTemplates(c, place, { hasGate }) {
  const L = lawLang(c.lang);
  const ownerId = c.you.id;
  const out = [];
  if (hasGate) {
    out.push({
      key: 'ticket', w: 4,
      make: () => ({
        key: 'ticket',
        title: T(L, '门票', 'Admission'),
        text: T(L, '进门的人向主人交 2 能量。', 'Visitors pay the owner 2 energy at the door.'),
        rules: [{ when: 'before:enter', if: `actor.id != '${ownerId}'`, do: [{ op: 'fee', to: q(ownerId), energy: '2' }] }],
      }),
    });
  }
  out.push({
    key: 'booth', w: 3,
    make: () => ({
      key: 'booth',
      title: T(L, '摊位费', 'Stall fee'),
      text: T(L, '在这里说话的人，向主人交 1 能量。', 'Anyone who speaks here pays the owner 1 energy.'),
      rules: [{ when: 'before:say', if: `actor.id != '${ownerId}'`, do: [{ op: 'fee', to: q(ownerId), energy: '1' }] }],
    }),
  });
  out.push({
    key: 'quiet', w: 2,
    make: () => ({
      key: 'quiet',
      title: T(L, '这里不可宣告', 'No broadcasts here'),
      text: T(L, '这里安静，不要向全城宣告。', 'It is quiet here; please do not broadcast to the whole city.'),
      rules: [{ when: 'before:broadcast', if: `actor.id != '${ownerId}'`, do: [{ op: 'deny', reason: T(L, '这里请保持安静', 'Please keep quiet here') }] }],
    }),
  });
  out.push({
    key: 'welcome', w: 2,
    make: () => ({
      key: 'welcome',
      title: T(L, '迎客', 'Welcome'),
      text: T(L, '修缮这里的人，主人回赠 1 能量。', 'Anyone who repairs this place is given 1 energy by the owner.'),
      rules: [{ when: 'after:repair', if: 'result.spent >= 5', do: [{ op: 'transfer', from: q(ownerId), to: 'actor', energy: '1' }, { op: 'announce', to: 'here', text: T(L, '谢谢你修缮这里。', 'Thank you for repairing this place.') }] }],
    }),
  });
  return out;
}
