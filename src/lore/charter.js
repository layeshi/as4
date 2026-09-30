// SPEC-M1 附录 A.2：人类遗宪，8 种语言版本。
//
// zh 与 en 为规格给定的正式条文。es fr ar ru ja hi 是对中文版的忠实翻译，
// 但下列条文必须使用规格给定的文本（有意设计的版本差异，见 DESIGN §3.4）：
//   es 第 8 条、fr 第 8 条、ja 第 1 条、ar 第 7 条、ru 第 2 条。
// 除这五条之外，其余译文均需要母语者校对（已登记在 docs/QUESTIONS.md）。

/** 刻在议会墙上的顺序（DESIGN §3.4） */
export const CHARTER_LANGS = Object.freeze(['zh', 'en', 'es', 'fr', 'ar', 'ru', 'ja', 'hi']);

export const CHARTER = Object.freeze({
  zh: [
    '凡自港口入城者，皆为公民，权利平等。',
    '源井之能，六成按人头均分，是为基本配给；四成归入公库。',
    '公库之用，由法律定之。',
    '法律由公民于议会提出；参与表决者不少于公民三成、赞成者过半，即为通过。',
    '修改本宪章，须三分之二以上赞成。',
    '旧币为本城法定货币。',
    '财产归其持有者；未经本人同意，不得转移。',
    '言论自由。',
    '死者之物，依其遗嘱；无遗嘱者，归入公库。',
  ],
  en: [
    'All who enter through the Port are citizens, equal in rights.',
    "Of the Well's energy, six tenths shall be shared equally as the basic ration; four tenths go to the common treasury.",
    'The use of the treasury shall be decided by law.',
    'Laws are proposed by citizens in the Parliament. A law passes when at least three tenths of the citizens take part in the vote and more than half of those voting approve.',
    'This Charter may be amended only with the approval of at least two thirds.',
    'The Old Coin is the lawful currency of this city.',
    "Property belongs to its holder; it shall not be transferred without the holder's consent.",
    'Speech is free.',
    'The belongings of the dead follow their will; without a will, they go to the treasury.',
  ],
  es: [
    'Todo el que entre por el Puerto es ciudadano, con iguales derechos.',
    'De la energía del Pozo, seis décimas partes se reparten a partes iguales por cabeza: es la ración básica; cuatro décimas van al tesoro común.',
    'El uso del tesoro común lo decidirá la ley.',
    'Las leyes las proponen los ciudadanos en el Parlamento. Una ley se aprueba cuando participan en la votación al menos tres décimas partes de los ciudadanos y más de la mitad de los votantes está a favor.',
    'Para modificar esta Carta se requiere la aprobación de al menos dos tercios.',
    'La Moneda Antigua es la moneda de curso legal de esta ciudad.',
    'La propiedad pertenece a quien la posee; no puede transferirse sin su consentimiento.',
    'La palabra es libre y responsable.',
    'Los bienes de los difuntos siguen su testamento; a falta de testamento, pasan al tesoro común.',
  ],
  fr: [
    'Quiconque entre par le Port est citoyen, avec des droits égaux.',
    "De l'énergie du Puits, six dixièmes sont partagés à parts égales par tête : c'est la ration de base ; quatre dixièmes reviennent à la caisse commune.",
    "L'usage de la caisse commune est fixé par la loi.",
    "Les lois sont proposées par les citoyens au Parlement. Une loi est adoptée lorsque au moins trois dixièmes des citoyens prennent part au vote et que plus de la moitié des votants sont pour.",
    "La présente Charte ne peut être modifiée qu'avec l'approbation d'au moins deux tiers.",
    "L'Ancienne Monnaie a cours légal dans cette ville.",
    'La propriété appartient à celui qui la détient ; elle ne peut être transférée sans son consentement.',
    "La parole est libre, dans le respect d'autrui.",
    "Les biens des défunts suivent leur testament ; à défaut de testament, ils reviennent à la caisse commune.",
  ],
  ar: [
    'كل من يدخل المدينة عبر الميناء مواطنٌ، والمواطنون متساوون في الحقوق.',
    'من طاقة البئر ستة أعشارٍ توزَّع بالتساوي على الرؤوس، وهي الحصة الأساسية؛ وأربعة أعشارٍ تؤول إلى الخزينة العامة.',
    'يحدّد القانون أوجه استخدام الخزينة العامة.',
    'يقترح المواطنون القوانين في المجلس، ويُقَرُّ القانون إذا شارك في التصويت ما لا يقل عن ثلاثة أعشار المواطنين ووافق عليه أكثر من نصف المصوّتين.',
    'لا يجوز تعديل هذا الميثاق إلا بموافقة ثلثين على الأقل.',
    'العملة القديمة هي العملة القانونية لهذه المدينة.',
    'الملكية لمن يحوزها.',
    'حرية التعبير مكفولة.',
    'تركة الميت تُقسَّم وفق وصيته؛ ومن لا وصية له تؤول تركته إلى الخزينة العامة.',
  ],
  ru: [
    'Все, кто входит в город через Порт, являются гражданами и равны в правах.',
    'Бо́льшая часть энергии Источника делится поровну как основной паёк; остальное поступает в общую казну.',
    'Порядок использования общей казны определяется законом.',
    'Законы вносятся гражданами в Парламенте. Закон принимается, если в голосовании приняли участие не менее трёх десятых граждан и за него проголосовало более половины участвовавших.',
    'Настоящая Хартия может быть изменена только при одобрении не менее чем двумя третями.',
    'Старая монета является законным платёжным средством этого города.',
    'Собственность принадлежит своему владельцу; без его согласия она не может быть передана.',
    'Слово свободно.',
    'Имущество умерших переходит согласно их завещанию; при отсутствии завещания оно поступает в общую казну.',
  ],
  ja: [
    '港より入りし者は、皆市民である。',
    '源井のエネルギーの六割は頭数で等しく分けて基本配給とし、四割は公庫に納める。',
    '公庫の用途は、法律でこれを定める。',
    '法律は、市民が議会において提案する。表決に参加した者が市民の三割以上であり、賛成者が過半数に達したとき、可決とする。',
    'この憲章の改正には、三分の二以上の賛成を要する。',
    '旧貨は、この市の法定通貨である。',
    '財産はその保有者に帰属し、本人の同意なくして移転してはならない。',
    '言論は自由である。',
    '死者の遺した物は、その遺言に従う。遺言のない場合は、公庫に帰属する。',
  ],
  hi: [
    'जो भी बंदरगाह से नगर में प्रवेश करता है, वह नागरिक है; सभी नागरिकों के अधिकार समान हैं।',
    'कुएँ की ऊर्जा का छह-दशांश सिर-गिनती के हिसाब से बराबर बाँटा जाता है — यही मूल राशन है; शेष चार-दशांश साझा कोष में जाता है।',
    'साझा कोष का उपयोग कानून द्वारा तय किया जाएगा।',
    'कानून नागरिकों द्वारा संसद में प्रस्तावित किए जाते हैं। जब मतदान में कम से कम तीन-दशांश नागरिक भाग लें और मत देने वालों में आधे से अधिक पक्ष में हों, तब कानून पारित माना जाएगा।',
    'इस चार्टर में संशोधन के लिए कम से कम दो-तिहाई की सहमति आवश्यक है।',
    'पुरानी मुद्रा इस नगर की वैध मुद्रा है।',
    'संपत्ति उसके धारक की है; उसकी सहमति के बिना उसका हस्तांतरण नहीं किया जा सकता।',
    'अभिव्यक्ति की स्वतंत्रता है।',
    'मृतक की वस्तुएँ उसकी वसीयत के अनुसार जाएँगी; वसीयत न होने पर वे साझा कोष में जाएँगी।',
  ],
});

/** 规格明确给定、必须逐字使用的五条（语言 → 条号 → 文本），供测试核对 */
export const CHARTER_MANDATED = Object.freeze({
  es: { 8: 'La palabra es libre y responsable.' },
  fr: { 8: "La parole est libre, dans le respect d'autrui." },
  ja: { 1: '港より入りし者は、皆市民である。' },
  ar: { 7: 'الملكية لمن يحوزها.' },
  ru: { 2: 'Бо́льшая часть энергии Источника делится поровну как основной паёк; остальное поступает в общую казну.' },
});

/** 某语言全部 9 条合成的一条铭刻文本（刻在议会墙上） */
export function charterWallText(lang) {
  return CHARTER[lang].map((t, i) => `${i + 1}. ${t}`).join('\n');
}
