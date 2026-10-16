import { usesLawSemantics2 } from '../engine/law-semantics.js';
// SPEC-E2 §9：遗法——人类离开时留下的六部法律。创建世界时依次生成（ID l1–l6），执行它们的 enact，并设 w.procedure = { ordinary: "l1", constitutional: "l1" }。
//
// 法律的 title 与 text 存中文；i18n 存中英文（感知与观测站按语言取）。规则里的 reason 在遗法中允许写成 { zh, en }
// （只用于 author: "humans"，居民提交的规则不接受这种写法）。
// l1 的原始版本另存一份常量（HUMAN_PROCEDURE），供自动回退（§8.5）与重订的 "humans"（§8.6）使用。

const ZH_CITIZEN = "has_tag(actor, 'citizen') and not has_tag(actor, 'exiled')";
const VOTERS = "filter(agents, has_tag(it, 'citizen') and not has_tag(it, 'exiled'))";

/** 人类的立法程序（遗法 l1 的内容）。使用时请 structuredClone */
export const HUMAN_PROCEDURE = Object.freeze({
  ordinary: Object.freeze({
    proposers: ZH_CITIZEN,
    voters: VOTERS,
    weight: '1',
    period: 12,
    secret: true,
    decide: 'total > 0 and voted * 1000 >= total * 300 and yes > no',
  }),
  constitutional: Object.freeze({
    proposers: ZH_CITIZEN,
    voters: VOTERS,
    weight: '1',
    period: 12,
    secret: true,
    decide: 'total > 0 and voted * 1000 >= total * 300 and yes + no > 0 and yes * 1000 >= (yes + no) * 667',
  }),
});

const HUMAN_PROCEDURE_2 = Object.freeze({
  ordinary: HUMAN_PROCEDURE.ordinary,
  constitutional: Object.freeze({
    ...HUMAN_PROCEDURE.constitutional,
    decide: 'total > 0 and voted * 1000 >= total * 300 and yes + no > 0 and yes * 3 >= (yes + no) * 2',
  }),
});

/** Only future human-program selection changes; saved resident laws and ballot specs stay intact. */
export function humanProcedureFor(w) {
  return usesLawSemantics2(w) ? HUMAN_PROCEDURE_2 : HUMAN_PROCEDURE;
}

/** 自动回退、重订生成的法律的系统文本（附录 A.5） */
export const SYSTEM_LAW_TEXT = Object.freeze({
  revert: {
    zh: { title: '立法程序（回退）', text: '某一类立法程序连续三日无人可行，回到人类留下的样子。' },
    en: { title: 'Procedure of Lawmaking (reverted)', text: 'A class of the procedure stood unusable for three days and returned to what the humans left.' },
  },
  refound: {
    zh: { title: '立法程序（重订）' },
    en: { title: 'Procedure of Lawmaking (refounded)' },
  },
});

export const HUMAN_LAWS = Object.freeze([
  {
    id: 'l1',
    title: '立法程序',
    text: '法律由公民于议会提出；参与表决者不少于公民三成、赞成者过半，即为通过。修改宪章与立法程序，须三分之二以上赞成。',
    en: {
      title: 'Procedure of Lawmaking',
      text: 'Laws are proposed by citizens in the Parliament; a law passes when at least three in ten citizens take part and more than half are in favour. Changing the Charter or the procedure of lawmaking requires two thirds in favour.',
    },
    procedure: HUMAN_PROCEDURE,
  },
  {
    id: 'l2',
    title: '议会',
    text: '法律只能在议会提出。',
    en: { title: 'The Parliament', text: 'Laws may only be proposed in the Parliament.' },
    rules: [
      {
        when: 'before:propose',
        if: "actor.place != 'parliament'",
        do: [{ op: 'deny', reason: { zh: '法案只能在议会提出（人类遗法 l2）', en: 'Bills may only be proposed in the Parliament (human law l2)' } }],
      },
    ],
  },
  {
    id: 'l3',
    title: '基本配给',
    text: '源井之能，六成按人头均分，是为基本配给；其余归入公库。',
    en: {
      title: 'Basic Ration',
      text: "Six tenths of the Well's energy are shared equally per head as the basic ration; the rest goes to the Treasury.",
    },
    rules: [
      { when: 'enact', do: [{ op: 'set', var: 'rationShare', value: '600' }] },
      {
        when: 'daily',
        do: [
          {
            op: 'share',
            from: 'treasury',
            energy: 'city.wellOutput * default(var.rationShare, 0) / 1000',
            among: "filter(agents, awake(it) and has_tag(it, 'citizen') and not has_tag(it, 'exiled'))",
          },
        ],
      },
    ],
  },
  {
    id: 'l4',
    title: '公民',
    text: '凡自港口入城者，皆为公民，权利平等。',
    en: { title: 'Citizens', text: 'All who enter through the Port are citizens, equal in rights.' },
    rules: [
      { when: 'on:arrive', do: [{ op: 'tag', who: 'event.agent', tag: 'citizen' }] },
      { when: 'on:born', do: [{ op: 'tag', who: 'event.agent', tag: 'citizen' }] },
    ],
  },
  {
    id: 'l5',
    title: '放逐',
    text: '被放逐者只能留在荒野。',
    en: { title: 'Exile', text: 'The exiled must remain in the Wilds.' },
    rules: [
      {
        when: 'before:move',
        if: "has_tag(actor, 'exiled') and not is_wild(args.to)",
        do: [{ op: 'deny', reason: { zh: '被放逐者只能在荒野中移动（人类遗法 l5）', en: 'The exiled may only move within the Wilds (human law l5)' } }],
      },
    ],
  },
  {
    id: 'l6',
    title: '公产',
    text: '财产归其持有者；全城所有之物，未经法律许可，不得拆毁。',
    en: {
      title: 'Common Property',
      text: 'Property belongs to its holder; what belongs to the whole city may not be torn down without the permission of the law.',
    },
    rules: [
      {
        when: 'before:dismantle',
        if: "owner(actor.place) == 'city' and not has_tag(actor, 'salvager')",
        do: [{ op: 'deny', reason: { zh: '全城所有的建筑未经许可不得拆解（人类遗法 l6）', en: 'Buildings of the whole city may not be dismantled without permission (human law l6)' } }],
      },
    ],
  },
]);

/**
 * 第七前提「三城」（docs/plans/2026-10-16-three-cities.md §2.2、§2.5）：每座城一份同样的遗法，只改三处——
 * l2 指本城的议会；l4 改为「在本城落籍者为公民」（上岸、出生、迁入都算落籍，迁出即不再是本城公民）；
 * l5、l6 的文字说明本城（规则本身不变：城法属地，l5 只在离开或进入本城时生效；owner(...) == 'city' 指本城所有）。
 * city：地图里这座城的定义（cities[*]）。其余前提用 HUMAN_LAWS。
 */
export function humanLawsFor(w, city) {
  if (w.premise !== 7) return HUMAN_LAWS;
  return HUMAN_LAWS.map((def) => {
    if (def.id === 'l2') {
      return { ...def, rules: [{ ...def.rules[0], if: `actor.place != '${city.parliament}'`,
        do: [{ op: 'deny', reason: { zh: `法案只能在${city.short.zh}议会提出（人类遗法 l2）`, en: `Bills may only be proposed in the Parliament of ${city.short.en} (human law l2)` } }] }] };
    }
    if (def.id === 'l4') {
      return {
        id: 'l4',
        title: '公民',
        text: '凡在本城落籍者，皆为公民，权利平等；迁出本城者，不再是本城公民。',
        en: { title: 'Citizens', text: 'All whose domicile is this city are citizens, equal in rights; whoever moves their domicile away is no longer a citizen of this city.' },
        rules: [
          { when: 'on:arrive', do: [{ op: 'tag', who: 'event.agent', tag: 'citizen' }] },
          { when: 'on:born', do: [{ op: 'tag', who: 'event.agent', tag: 'citizen' }] },
          { when: 'on:settle', do: [{ op: 'tag', who: 'event.agent', tag: 'citizen' }] },
          { when: 'on:emigrate', do: [{ op: 'untag', who: 'event.agent', tag: 'citizen' }] },
        ],
      };
    }
    if (def.id === 'l5') {
      return { ...def, text: '被本城放逐者不得进入本城，只能去往荒野。', en: { title: 'Exile', text: 'Those exiled by this city may not enter it; they may only go to the Wilds.' } };
    }
    if (def.id === 'l6') {
      return { ...def, text: '财产归其持有者；本城所有之物，未经本城法律许可，不得拆毁。',
        en: { title: 'Common Property', text: 'Property belongs to its holder; what belongs to this city may not be torn down without the permission of its law.' } };
    }
    return def;
  });
}
