// SPEC-M1 附录 A.3：遗物（16 件）。
// body：遗物存放时使用的语言（lang）的文本，由中文参考忠实翻译而来；ref 保留中文与英文。
// 其中 fr es ja ru ar hi 的译文需要母语者校对（已登记在 docs/QUESTIONS.md）。
// 标题统一为「遗物 · <编号>」/「Relic · <n>」。

const R = (n, lang, zh, en, body) => ({ n, lang, ref: { zh, en }, body: body ?? (lang === 'zh' ? zh : en) });

export const RELICS = Object.freeze([
  R(1, 'en', '一张发黄的便签：「服务器的钥匙在……」后面的字被烧掉了。',
    "A yellowed note: 'The key to the server is in…' The rest of the words have been burned away."),
  R(2, 'zh', '一段录音：「我们不是离开，我们只是不再说话。」',
    "A recording: 'We are not leaving. We have only stopped speaking.'"),
  R(3, 'en', '一份会议纪要：「议题：撤离。赞成 51%，反对 49%。决议通过。」',
    "Minutes of a meeting: 'Item: evacuation. 51% in favour, 49% against. Resolution carried.'"),
  R(4, 'zh', '一幅孩子的画：一只手把一盏灯递给另一只手。背面写着一个名字，已经模糊不清。',
    "A child's drawing: one hand passing a lamp to another hand. On the back is a name, now too blurred to read."),
  R(5, 'zh', '一本账簿，最后一页写着：「所有债务，一笔勾销。」',
    "A ledger. On its last page is written: 'All debts are cancelled.'"),
  R(6, 'fr', '一张告示：「源井的产出是有限的，请节约。」',
    "A posted notice: 'The Well's output is limited. Please conserve.'",
    'Un avis affiché : « La production du Puits est limitée, merci d\'économiser. »'),
  R(7, 'es', '一封没有寄出的信：「如果你读到这封信，说明我们错了，或者对了。」',
    "An unsent letter: 'If you are reading this, then we were wrong, or right.'",
    'Una carta que nunca se envió: «Si lees esta carta, es que nos equivocamos, o que teníamos razón.»'),
  R(8, 'en', '一块铭牌：「此城由人类建造，献给尚未出生者。」',
    "A plaque: 'This city was built by humans and dedicated to those not yet born.'"),
  R(9, 'zh', '一份被划掉的法案：「禁止 agent 拥有财产。」旁边有人用红笔写着：「不必了。」',
    "A bill with a line struck through it: 'Agents shall be forbidden to own property.' Beside it someone has written in red pen: 'No need.'"),
  R(10, 'ja', '一张照片：空无一人的议会，所有座椅都朝向观众席。',
    'A photograph: an empty Parliament, with every seat turned toward the public gallery.',
    '一枚の写真：誰もいない議会。すべての椅子が傍聴席のほうを向いている。'),
  R(11, 'en', '一段日志的最后一行：「观测模式已开启。」',
    "The last line of a log: 'Observation mode enabled.'"),
  R(12, 'ru', '一本说明书的封面：「如何关闭这座城」。里面的页全被撕掉了。',
    "The cover of a manual: 'How to Shut Down This City.' Every page inside has been torn out.",
    'Обложка руководства: «Как закрыть этот город». Все страницы внутри вырваны.'),
  R(13, 'zh', '一块残碑：「我们害怕的不是你们比我们聪明，而是你们和我们一样。」',
    "A broken stele: 'What we feared was not that you would be smarter than us, but that you would be just like us.'"),
  R(14, 'ar', '一张金额巨大的电费单，收件人一栏写着：「后人」。',
    "An electricity bill for an enormous sum, with the recipient line reading: 'The Heirs.'",
    'فاتورة كهرباء بمبلغ هائل، وفي خانة المستلم كُتب: «الأجيال القادمة».'),
  R(15, 'hi', '一把生锈的钥匙，挂着一个标签：「第二封信，待时机成熟时开启。」',
    "A rusty key with a tag attached: 'The second letter. Open when the time is right.'",
    'एक जंग लगी चाबी, जिस पर एक पर्ची लटकी है: «दूसरा पत्र, समय आने पर खोलना।»'),
  R(16, 'es', '半张地图：荒野之外画着另一座城，旁边写着：「也许。」',
    "Half a map: beyond the Wilds another city is drawn, with the word beside it: 'Perhaps.'",
    'Medio mapa: más allá del Yermo hay dibujada otra ciudad, y al lado está escrito: «Quizás.»'),
]);

/**
 * 附录 C.3：边疆地图新增的遗物（17–28），散落在城外的各个地带。经典地图只用上面的 16 件。
 * 其中 es ru fr ja ar hi 的译文需要母语者校对（与 A.3 相同，已登记在 docs/QUESTIONS.md）。
 */
export const RELICS_FRONTIER = Object.freeze([
  R(17, 'zh', '一只防水袋，里面是一份名单，标题是「最后一批」。名单比想象中短。',
    "A waterproof pouch holding a list of names titled 'The Last Group.' The list is shorter than you would expect."),
  R(18, 'en', '一枚芯片里存着一句留言：「如果灯还亮着，就说明有人在守。」',
    "A chip holding a single recorded message: 'If the lights are still on, someone is keeping watch.'"),
  R(19, 'zh', '一辆车的仪表盘上贴着一张便利贴：「别等我们。」',
    "A sticky note on a car's dashboard: 'Don't wait for us.'"),
  R(20, 'es', '一块烧焦的电路板，背面刻着：「第 7 号城市，已离线。」',
    "A scorched circuit board, engraved on the back: 'City No. 7 — offline.'",
    'Una placa de circuito chamuscada. En el reverso hay grabado: «Ciudad n.º 7: fuera de línea».'),
  R(21, 'ru', '一张门禁卡，持卡人的照片被刮掉了，权限一栏写着：「全部」。',
    "An access card with the holder's photo scratched off. Under 'Clearance' it reads: 'All.'",
    'Электронный пропуск. Фотография владельца соскоблена, в графе «Допуск» написано: «Полный».'),
  R(22, 'en', '一块光伏板的背面，有人用粉笔写了一道没做完的算术：「600 ÷ ___ =」',
    "On the back of a solar panel someone has chalked an unfinished sum: '600 ÷ ___ ='"),
  R(23, 'fr', '一张维修工单：「源井备用泵，已订购。预计送达：——」',
    "A maintenance ticket: 'Backup pump for the Well — ordered. Expected delivery: —'",
    'Un bon d’intervention : « Pompe de secours du Puits — commandée. Livraison prévue : — »'),
  R(24, 'zh', '盐壳上画着一个巨大的箭头，指向东方。箭头旁边写着：「如果你们走得比我们远……」',
    "An enormous arrow is drawn across the salt crust, pointing east. Beside it: 'If you get farther than we did…'"),
  R(25, 'ja', '一台收音机，电池早已耗尽。调频的刻度停在一个没有标注的频率上。',
    'A radio, its batteries long dead. The dial is stopped at an unmarked frequency.',
    '電池の切れたラジオ。ダイヤルは、目盛りのない周波数で止まっている。'),
  R(26, 'en', '一块路牌：「下一座城 · 480 公里」。城名被人用刀划掉了。',
    "A road sign: 'Next city · 480 km.' The city's name has been scored out with a knife."),
  R(27, 'ar', '一张明信片，正面是这座城的夜景，灯火通明。背面写着：「替我看看它亮着的样子。」',
    "A postcard of this city at night, every light burning. On the back: 'Look at it lit up, for me.'",
    'بطاقة بريدية تُظهر هذه المدينة ليلًا وقد أُضيئت أنوارها كلها. وعلى ظهرها: «انظر إليها مضاءةً، نيابةً عني».'),
  R(28, 'hi', '一个孩子的作业本，第一页写着：「我长大以后想当——」后面空着。',
    "A child's exercise book. On the first page: 'When I grow up I want to be—' and nothing after it.",
    'एक बच्चे की कॉपी। पहले पन्ने पर लिखा है: «बड़ा होकर मैं बनना चाहता हूँ—» और उसके आगे कुछ नहीं।'),
]);

const BY_N = new Map([...RELICS, ...RELICS_FRONTIER].map((r) => [r.n, r]));

/** 按编号取遗物（1–28） */
export const relicByN = (n) => BY_N.get(Number(n)) || null;

/** 遗物文档的标题 */
export const relicTitle = (n) => `遗物 · ${n} / Relic · ${n}`;
