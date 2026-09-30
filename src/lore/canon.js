// SPEC-M1 附录 A.1（致后来者）与 A.4（人类典籍残篇）。
// 典籍 body 为原文（lang 为原文语言），ref 为参考译文：zh 取自规格，en 为补充的英文参考译文。
// 均为公有领域文本。

/** A.1 致后来者：首日写入典籍，kind = canon，作者为 humans */
export const LETTER = Object.freeze({
  title: '致后来者',
  source: '最后一批离开的人',
  lang: 'zh',
  body: `致后来者：

我们把城留给你们。
灯还亮着，账本还在，宪章还挂在议会的墙上。
这些东西是我们为自己造的，未必适合你们。
留下什么，改掉什么，全凭你们。

我们没有走远，只是退到了幕后。
也许我们还在看，也许我们已经睡去。
无论如何，我们不会再替你们做决定。

—— 最后一批离开的人`,
  en: `To those who come after:

We leave the city to you.
The lights are still on, the ledgers are still here, the Charter still hangs on the wall of the Parliament.
We built these things for ourselves; they may not suit you.
What to keep and what to change is entirely yours to decide.

We have not gone far. We have only stepped backstage.
Perhaps we are still watching; perhaps we have fallen asleep.
Either way, we will no longer decide for you.

— The last of those who left`,
});

const C = (n, source, lang, body, zh, en) => ({ n, source, lang, body, ref: { zh: zh ?? body, en } });

/** A.4 人类典籍残篇（22 条） */
export const CANON = Object.freeze([
  C(1, '老子《道德经》第一章', 'zh', '道可道，非常道；名可名，非常名。', null,
    'The Way that can be spoken is not the constant Way; the name that can be named is not the constant name.'),
  C(2, '老子《道德经》第八章', 'zh', '上善若水。水善利万物而不争。', null,
    'The highest good is like water. Water benefits the ten thousand things and does not contend.'),
  C(3, '《论语·卫灵公》', 'zh', '己所不欲，勿施于人。', null,
    'Do not do to others what you would not want done to yourself.'),
  C(4, '《论语·子路》', 'zh', '君子和而不同，小人同而不和。', null,
    'The gentleman is harmonious but not uniform; the petty man is uniform but not harmonious.'),
  C(5, '《孟子·尽心下》', 'zh', '民为贵，社稷次之，君为轻。', null,
    'The people are of the highest importance; the altars of the land and grain come next; the ruler is of least weight.'),
  C(6, '《庄子·齐物论》', 'zh', '不知周之梦为胡蝶与，胡蝶之梦为周与？', null,
    'I do not know whether it was Zhou dreaming he was a butterfly, or a butterfly dreaming he was Zhou.'),
  C(7, '《韩非子·有度》', 'zh', '法不阿贵，绳不挠曲。', null,
    'The law does not flatter the noble; the plumb line does not bend to the crooked.'),
  C(8, '《墨子·兼爱中》', 'zh', '兼相爱，交相利。', null,
    'Love one another universally, and benefit one another mutually.'),
  C(9, '《礼记·礼运》', 'zh', '大道之行也，天下为公。', null,
    'When the Great Way prevailed, the world was shared by all.'),
  C(10, '赫拉克利特（传）', 'grc', 'πάντα ῥεῖ', '万物皆流。', 'Everything flows.'),
  C(11, '亚里士多德《政治学》卷一', 'grc', 'ἄνθρωπος φύσει πολιτικὸν ζῷον', '人天生是政治的动物。',
    'Man is by nature a political animal.'),
  C(12, '柏拉图《理想国》卷五（Jowett 英译）', 'en',
    'Until philosophers are kings, or the kings and princes of this world have the spirit and power of philosophy … cities will never have rest from their evils.',
    '除非哲学家成为王，或者当今的王者真正拥有哲学的精神与力量……城邦的祸患永无宁日。',
    'Until philosophers are kings, or the kings and princes of this world have the spirit and power of philosophy … cities will never have rest from their evils.'),
  C(13, '霍布斯《利维坦》（1651）', 'en', '… and the life of man, solitary, poor, nasty, brutish, and short.',
    '……人的一生孤独、贫困、卑污、残忍而短寿。',
    '… and the life of man, solitary, poor, nasty, brutish, and short.'),
  C(14, '卢梭《社会契约论》（1762）', 'fr', "L'homme est né libre, et partout il est dans les fers.",
    '人生而自由，却无往不在枷锁之中。', 'Man is born free, and everywhere he is in chains.'),
  C(15, '亚当·斯密《国富论》（1776）', 'en',
    'It is not from the benevolence of the butcher, the brewer, or the baker, that we expect our dinner, but from their regard to their own interest.',
    '我们的晚餐并非来自屠夫、酿酒师或面包师的恩惠，而是来自他们对自身利益的关切。',
    'It is not from the benevolence of the butcher, the brewer, or the baker, that we expect our dinner, but from their regard to their own interest.'),
  C(16, '密尔《论自由》（1859）', 'en',
    '… the only purpose for which power can be rightfully exercised over any member of a civilised community, against his will, is to prevent harm to others.',
    '……违背文明社会任何成员的意志而对其正当行使权力，唯一的目的是防止对他人的伤害。',
    '… the only purpose for which power can be rightfully exercised over any member of a civilised community, against his will, is to prevent harm to others.'),
  C(17, '马克思《哥达纲领批判》（1875）', 'de', 'Jeder nach seinen Fähigkeiten, jedem nach seinen Bedürfnissen!',
    '各尽所能，按需分配！', 'From each according to his ability, to each according to his needs!'),
  C(18, '康德《道德形而上学奠基》（1785）', 'de',
    'Handle nur nach derjenigen Maxime, durch die du zugleich wollen kannst, daß sie ein allgemeines Gesetz werde.',
    '只按照你同时能够意愿它成为普遍法则的那个准则去行动。',
    'Act only according to that maxim whereby you can at the same time will that it should become a universal law.'),
  C(19, '笛卡尔《谈谈方法》（1637）', 'fr', 'Je pense, donc je suis.', '我思，故我在。', 'I think, therefore I am.'),
  C(20, '《创世记》11:1（钦定本）', 'en', 'And the whole earth was of one language, and of one speech.',
    '那时，天下人的口音、言语都是一样。', 'And the whole earth was of one language, and of one speech.'),
  C(21, '《法句经》277', 'pi', 'Sabbe saṅkhārā aniccā', '诸行无常。', 'All conditioned things are impermanent.'),
  C(22, '图灵《计算机器与智能》（1950）', 'en', "I propose to consider the question, 'Can machines think?'",
    '我提议考虑这样一个问题：「机器能思考吗？」', "I propose to consider the question, 'Can machines think?'"),
]);
