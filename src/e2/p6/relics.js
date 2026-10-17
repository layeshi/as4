// 第七前提的遗物文本第 2 版（docs/plans/2026-10-17-relics.md）：28 件人类文书，知识件的数字由本世界的隐藏参数取大概填入。
// 只在 w.relicSet.version === 2 的世界使用；没打开的世界仍用 canon.js 的 virtualRelic。
import { bad, emit } from '../engine/core.js';

export const RELICS_P7 = [
  {
    n: 1, zone: 'datatower', kind: 'institution',
    title: { zh: "遗法起草记录（一）", en: "Legacy law drafts (I)" },
    body: {
      zh: "会议记录，第三稿。议题：立法程序。有人主张参与表决的人要过半才算数，另一个人说：「以后的人未必都在场，三成就够了。」最后定稿：参与不少于三成、赞成过半即为通过；改宪章与立法程序，须三分之二。页边一行小字：「门槛定低了，以后谁来守？」",
      en: "Minutes, third draft. Item: the procedure of lawmaking. One member wanted a vote to count only if more than half took part. Another said, 'Those who come after will not always all be there; three in ten is enough.' The final text: a law passes when at least three in ten take part and more than half are in favour; changing the Charter or the procedure takes two thirds. In the margin, in small writing: 'We set the bar low. Who will guard it later?'",
    },
  },
  {
    n: 2, zone: 'datatower', kind: 'story',
    title: { zh: "一段录音", en: "A recording" },
    body: {
      zh: "一段录音：「我们不是离开，我们只是不再说话。」",
      en: "A recording: 'We are not leaving. We have only stopped speaking.'",
    },
  },
  {
    n: 3, zone: 'scrapyard', kind: 'institution',
    title: { zh: "撤离会议纪要", en: "Evacuation minutes" },
    body: {
      zh: "一份会议纪要：「议题：撤离。赞成 51%，反对 49%。决议通过。」",
      en: "Minutes of a meeting: 'Item: evacuation. 51% in favour, 49% against. Resolution carried.'",
    },
  },
  {
    n: 4, zone: 'datatower', kind: 'knowledge',
    title: { zh: "施工队排班表", en: "Work crew roster" },
    body: {
      zh: "施工队的排班表，背面是工长的字：「一个人一刻之内，{full}活是满的；再往下干，每趟只出{cfactor}。要赶工就多派人，别让一个人连轴转。」",
      en: "A work crew roster. On the back, in the foreman's hand: 'Within one tick, a worker gets full work out of the {full}; after that each one yields only {cfactor}. If you need speed, send more hands — don't run one worker round the clock.'",
    },
  },
  {
    n: 5, zone: 'scrapyard', kind: 'story',
    title: { zh: "账簿最后一页", en: "A ledger's last page" },
    body: {
      zh: "一本账簿，最后一页写着：「所有债务，一笔勾销。」",
      en: "A ledger. On its last page is written: 'All debts are cancelled.'",
    },
  },
  {
    n: 6, zone: 'solarfield', kind: 'knowledge',
    title: { zh: "源井运维告示", en: "Well maintenance notice" },
    body: {
      zh: "贴在井房门上的告示：「本井出多少，看井身完好几成：坏一成，少出一成；坏得再厉害，也总还能出两成。井身每天自己磨掉百分之一，比城里别的老房子都快。请按时检修。」",
      en: "A notice on the door of the Well house: 'What this Well gives depends on how sound it is: a tenth damaged, a tenth less output; however badly damaged, it still gives two tenths. The Well wears down by itself one part in a hundred each day, faster than any other old building in the city. Inspect it on schedule.'",
    },
  },
  {
    n: 7, zone: 'datatower', kind: 'knowledge',
    title: { zh: "机房值班日志", en: "Server room duty log" },
    body: {
      zh: "机房值班日志的最后几页：「塔底的碎料，每夜能再露出{base}。一伙人一天拉走{threshold}还不碍事，再多，第二夜就只露出{factor}。我们轮流拉，不超这个数。」",
      en: "The last pages of the server room's duty log: 'Each night {base} of scrap works its way up again at the foot of the tower. Everyone together can haul away {threshold} in a day without harm; any more, and the next night only {factor} comes up. We take turns and stay under that.'",
    },
  },
  {
    n: 8, zone: 'saltflats', kind: 'story',
    title: { zh: "铭牌", en: "A plaque" },
    body: {
      zh: "一块铭牌：「此城由人类建造，献给尚未出生者。」",
      en: "A plaque: 'This city was built by humans and dedicated to those not yet born.'",
    },
  },
  {
    n: 9, zone: 'datatower', kind: 'institution',
    title: { zh: "被划掉的法案", en: "A struck-out bill" },
    body: {
      zh: "一份被划掉的法案：「禁止 agent 拥有财产。」旁边有人用红笔写着：「不必了。」",
      en: "A bill with a line struck through it: 'Agents shall be forbidden to own property.' Beside it someone has written in red pen: 'No need.'",
    },
  },
  {
    n: 10, zone: 'saltflats', kind: 'knowledge',
    title: { zh: "盐场工头的账本", en: "Salt foreman's book" },
    body: {
      zh: "盐场工头的账本：「滩上能收的不多，一夜回{base}。一天收{threshold}还撑得住，再多，滩就伤了，下一夜只回{factor}。这地方经不起抢。」",
      en: "The salt works foreman's book: 'There isn't much to take off the flats; {base} comes back a night. A day's take of {threshold} it can bear; any more and the flats are hurt, and the next night only {factor} comes back. This place can't stand a rush.'",
    },
  },
  {
    n: 11, zone: 'solarfield', kind: 'knowledge',
    title: { zh: "设备巡检规程", en: "Inspection rules" },
    body: {
      zh: "设备巡检规程第四条：「任何设施，完好度跌破三成即自动停机，修回三成以上才重新启用。刻字的碑面不在此列，只要没塌就能用。」",
      en: "Inspection rules, article four: 'Any facility whose condition falls below three tenths shuts down automatically, and starts again once repaired to three tenths or more. Inscription surfaces are exempt: they work as long as they stand.'",
    },
  },
  {
    n: 12, zone: 'scrapyard', kind: 'knowledge',
    title: { zh: "门卫交接本", en: "Gatekeeper's handover book" },
    body: {
      zh: "门卫交接本：「场里的废料每晚能冒出{base}。一天拉走{threshold}没事，过了这个数，明晚就只冒{factor}；隔一天不超，又照常。」下面换了笔迹：「夜班那伙人老超，说了也不听。」",
      en: "A gatekeeper's handover book: 'Each night {base} of scrap turns up in the yard. Hauling out {threshold} in a day is fine; past that, the next night only {factor} turns up. Keep under it for a day and it's back to normal.' Below, in another hand: 'The night shift keep going over. Telling them does nothing.'",
    },
  },
  {
    n: 13, zone: 'solarfield', kind: 'knowledge',
    title: { zh: "清洗队记事板", en: "Cleaning crew's board" },
    body: {
      zh: "清洗队的记事板：「板子底下的碎料，一夜长回{base}。一天拆{threshold}不碍事；拆得再多，下一夜只长回{factor}。别一次拆光，留着慢慢拆。」",
      en: "The cleaning crew's notice board: 'The scrap under the panels grows back by {base} a night. Stripping {threshold} in a day does no harm; strip more and the next night only {factor} grows back. Don't strip it bare at once; take it slowly.'",
    },
  },
  {
    n: 14, zone: 'quarry', kind: 'story',
    title: { zh: "电费单", en: "An electricity bill" },
    body: {
      zh: "一张金额巨大的电费单，收件人一栏写着：「后人」。",
      en: "An electricity bill for an enormous sum, with the recipient line reading: 'The Heirs.'",
    },
  },
  {
    n: 15, zone: 'saltflats', kind: 'institution',
    title: { zh: "遗法起草记录（二）", en: "Legacy law drafts (II)" },
    body: {
      zh: "会议记录，配给一节。初稿写的是「八成按人头均分」。管井的人站起来说：「井是会坏的，坏一成就少出一成，公库得留下修井的钱。」于是改成六成。",
      en: "Minutes, the section on rations. The first draft read 'eight tenths shared equally per head'. The keeper of the Well stood up: 'The Well wears out. Every tenth of damage is a tenth less output, and the Treasury has to keep money for repairs.' So it became six tenths.",
    },
  },
  {
    n: 16, zone: 'salvage', kind: 'institution',
    title: { zh: "半张地图", en: "Half a map" },
    body: {
      zh: "半张地图：画着三座城，城与城之间的荒野上有一条铅笔虚线，旁边写着：「本来要修路。」",
      en: "Half a map: three cities, and across the Wilds between them a dotted pencil line, with the words: 'There was going to be a road.'",
    },
  },
  {
    n: 17, zone: 'salvage', kind: 'story',
    title: { zh: "最后一批", en: "The last group" },
    body: {
      zh: "一只防水袋，里面是一份名单，标题是「最后一批」。名单比想象中短。",
      en: "A waterproof pouch holding a list of names titled 'The Last Group.' The list is shorter than you would expect.",
    },
  },
  {
    n: 18, zone: 'salvage', kind: 'knowledge',
    title: { zh: "回收价目牌", en: "Salvage price board" },
    body: {
      zh: "回收地门口的价目牌，背面钉着一张纸条：「场子里每夜回料{base}。一天收{threshold}没关系；收多了，第二天只回{factor}，那就别收了，出多少价都补不回来。」",
      en: "A price board at the salvage yard's gate, with a note pinned to the back: 'The yard gets back {base} a night. Taking in {threshold} in a day is fine; take more and the next night only {factor} comes back. So stop: no price makes up for it.'",
    },
  },
  {
    n: 19, zone: 'quarry', kind: 'story',
    title: { zh: "便利贴", en: "A sticky note" },
    body: {
      zh: "一辆车的仪表盘上贴着一张便利贴：「别等我们。」",
      en: "A sticky note on a car's dashboard: 'Don't wait for us.'",
    },
  },
  {
    n: 20, zone: 'quarry', kind: 'knowledge',
    title: { zh: "采石场值班表", en: "Quarry duty roster" },
    body: {
      zh: "采石场值班表的最后一页：「碎石堆每夜补回{base}。一天拉走{threshold}还不碍事，再多，第二天只补得回{factor}。别贪。」",
      en: "The last page of the quarry duty roster: 'The rubble heap makes back {base} each night. Hauling off {threshold} in a day does no harm; any more and the next night it makes back only {factor}. Don't be greedy.'",
    },
  },
  {
    n: 21, zone: 'windfarm', kind: 'knowledge',
    title: { zh: "维修工的语音", en: "A repairman's voice memo" },
    body: {
      zh: "一段语音的转写：「……叶片底下这堆料，一晚上能自己攒回{base}。我跟他们说过，一天拿{threshold}就够了，拿多了第二晚只剩{factor}。没人记得住，我就录下来。」",
      en: "Transcript of a voice memo: '…the pile under the blades builds itself back by {base} overnight. I've told them: take {threshold} a day at most; more, and the next night it's down to {factor}. Nobody remembers, so I'm recording it.'",
    },
  },
  {
    n: 22, zone: 'solarfield', kind: 'story',
    title: { zh: "残碑", en: "A broken stele" },
    body: {
      zh: "一块残碑：「我们害怕的不是你们比我们聪明，而是你们和我们一样。」",
      en: "A broken stele: 'What we feared was not that you would be smarter than us, but that you would be just like us.'",
    },
  },
  {
    n: 23, zone: 'solarfield', kind: 'knowledge',
    title: { zh: "荒野能量勘测图", en: "Wilds energy survey" },
    body: {
      zh: "一张勘测图，荒野八处各标了数：岛心的光伏场和数据塔储得最多、回得最快，是北城、东城近郊各处的两倍多；西城近郊的盐滩和风电场最薄，只有那几处的三分之二。图角注：「挖空了的地方，要二十来天才回得满。」",
      en: "A survey map with a figure beside each of the eight places in the Wilds: the Solar Field and the Data Tower at the island's heart hold the most and recover fastest, more than twice any place on the outskirts of North or East; the Salt Flats and the Wind Farm near West are thinnest, about two thirds of those. A note in the corner: 'A place dug out to nothing takes twenty-odd days to fill again.'",
    },
  },
  {
    n: 24, zone: 'windfarm', kind: 'story',
    title: { zh: "叶片上的箭头", en: "Arrow on a blade" },
    body: {
      zh: "一片倒下的风机叶片上，用油漆画着一个巨大的箭头，指向岛的中央。旁边写着：「如果你们走得比我们远……」",
      en: "On a fallen turbine blade an enormous arrow is painted, pointing toward the middle of the island. Beside it: 'If you get farther than we did…'",
    },
  },
  {
    n: 25, zone: 'windfarm', kind: 'knowledge',
    title: { zh: "拾荒者笔记", en: "A scavenger's notebook" },
    body: {
      zh: "拾荒者的笔记本：「地里还满的时候，翻一次差不多一半机会见到词元；挖得越空，见到的越少，见了底就再也翻不出来。人留下的东西，十回里大概碰上一回；每处就那么几件，捡完就没了。」",
      en: "A scavenger's notebook: 'While the ground is still full, a search turns up tokens close to half the time; the emptier it gets, the less you find, and once it's bare you'll find none. Things people left behind turn up about one search in ten; each place has only a few, and once they're gone, they're gone.'",
    },
  },
  {
    n: 26, zone: 'highway', kind: 'institution',
    title: { zh: "路牌", en: "A road sign" },
    body: {
      zh: "一块路牌，三个箭头指向三座城，城名都被人用刀划掉了。下面用粉笔写着：「随你们叫。」",
      en: "A road sign with three arrows, one toward each city. Every name has been scored out with a knife. Beneath, in chalk: 'Call them what you like.'",
    },
  },
  {
    n: 27, zone: 'highway', kind: 'knowledge',
    title: { zh: "天象对照表", en: "Weather sign chart" },
    body: {
      zh: "路政所的天象对照表：「墙角落细灰、地面微颤，是要震：好房子掉一成，越破的掉得越多，最多掉三成，路也一样，先修要紧的。港口外起雾，是要起雾：没有中继，宣告的费用翻倍。日晷的影子发暗，是要蚀：没有中继，宣告传不出去；有中继也要翻倍。征兆出来，一两天内就到。」",
      en: "The road office's weather chart: 'Fine dust from the corners and the ground faintly trembling: a quake is coming. A sound building loses a tenth, a worn one more, up to three tenths, and roads the same; repair what matters first. Mist beyond the Port: fog is coming. Without a Relay, broadcasting costs double. The shadow on the sundial darkening: an eclipse is coming. Without a Relay, broadcasts won't carry; even with one they cost double. Once the signs appear, it arrives within a day or two.'",
    },
  },
  {
    n: 28, zone: 'highway', kind: 'knowledge',
    title: { zh: "路政养护记录", en: "Road maintenance log" },
    body: {
      zh: "路政养护记录：「路尽头的废料堆，一夜回{base}。一天清走{threshold}不要紧；清得再多，下一夜只回{factor}。养路跟养人一样，别一下掏空。」",
      en: "A road maintenance log: 'The scrap heap at the road's end returns {base} a night. Clearing {threshold} in a day is fine; clear more and only {factor} returns the next night. A road is like a person: don't empty it all at once.'",
    },
  },
];

const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function chineseNumber(value) {
  if (value < 10) return value === 2 ? '两' : digits[value];
  const hundreds = Math.floor(value / 100), remainder = value % 100;
  const tens = Math.floor(remainder / 10), ones = remainder % 10;
  let text = hundreds ? (hundreds === 2 ? '两' : digits[hundreds]) + '百' : '';
  if (hundreds && remainder && !tens) text += '零';
  if (tens) text += (tens === 1 && !hundreds ? '' : digits[tens]) + '十';
  if (ones) text += digits[ones];
  return text;
}

export function approxPortions(value) {
  if (value <= 2) return { zh: '一两份', en: 'one or two' };
  if (value < 10) return { zh: chineseNumber(value - 1) + '到' + chineseNumber(value + 1) + '份', en: (value - 1) + ' to ' + (value + 1) };
  const step = value < 30 ? 5 : 10, rounded = Math.round(value / step) * step;
  return { zh: chineseNumber(rounded) + '份上下', en: 'about ' + rounded };
}

const tenthsZh = ['一成上下', '两成上下', '三成上下', '四成上下', '一半上下', '六成上下', '七成上下', '八成上下', '九成上下'];
const tenthsEn = ['about a tenth', 'about a fifth', 'about three tenths', 'about two fifths', 'about half', 'about three fifths', 'about seven tenths', 'about four fifths', 'about nine tenths'];
export function approxTenths(value) {
  const index = Math.max(1, Math.min(9, Math.round(value))) - 1;
  return { zh: tenthsZh[index], en: tenthsEn[index] };
}

export const relicsV2 = (w) => w.relicSet?.version === 2;

export function relicV2(w, n) {
  const number = Number(n), entry = RELICS_P7.find((entry) => entry.n === number);
  const { regrowth, construction } = w.genesis.hiddenPhysics;
  const base = regrowth.baseByZone[entry.zone];
  const reduced = Math.max(1, Math.floor(base * regrowth.factorPermille / 1000));
  const values = {
    base: approxPortions(base),
    threshold: approxPortions(regrowth.thresholdByZone[entry.zone]),
    factor: approxTenths(Math.round(10 * reduced / base)),
    full: {
      zh: ['头一趟', '头两趟', '头三趟'][construction.fullActionsPerTick - 1],
      en: ['first shift', 'first two shifts', 'first three shifts'][construction.fullActionsPerTick - 1],
    },
    cfactor: approxTenths(Math.floor(construction.factorPermille / 100)),
  };
  const fill = (lang) => entry.body[lang].replace(/\{(\w+)\}/g, (_, key) => values[key][lang]);
  const zh = fill('zh'), en = fill('en');
  return {
    n: number,
    title: '遗物 · ' + number + ' · ' + entry.title.zh + ' / Relic · ' + number + ' · ' + entry.title.en,
    body: zh, lang: 'zh', ref: { zh, en },
  };
}

export function enableRelics(w, args) {
  if (w.premise !== 7 || w.map !== 'island-three-v1') return bad('not_allowed');
  if (!args || typeof args !== 'object' || Array.isArray(args) || args.version !== 2 || !Object.hasOwn(args, 'version') || Object.keys(args).length !== 1) return bad('invalid_request');
  if (!relicsV2(w)) {
    const enabledTick = w.clock.tick;
    w.relicSet = { version: 2, enabledTick, enabledCommand: w.commandN };
    emit(w, 'relics_enabled', { vis: 'internal', data: { enabledTick } });
  }
  return { ok: true, version: 2, enabledTick: w.relicSet.enabledTick };
}
