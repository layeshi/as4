// Appendix A changes only these passages; inherited P2 strings remain untouched.
export function promptP4(base, head, lang) {
  const zh = lang === 'zh';
  const ruleLanguage = zh
    ? base.ruleLanguage.replace("soul('s4')（为躯壳出资）。", "soul('s4')。居民的 energy 就是它可以转让的词元，不含基本额度。")
      .replace('边界：规则从居民身上拿走的能量不会让它低于 {floor}；每条持续生效的规则每天从公库扣 1 能量；', '边界：规则从居民身上拿走的词元不会让它低于 {floor}；每条持续生效的规则每天从公库扣 {ruleUpkeep} 词元；')
    : base.ruleLanguage.replace("soul('s4') (funding a shell).", "soul('s4'). A resident's energy is the tokens it can transfer, not counting its basic allowance.")
      .replace('Limits: energy taken from a resident', 'Limits: tokens taken from a resident').replace('Treasury 1 energy a day', 'Treasury {ruleUpkeep} tokens a day');
  const standingLanguage = zh
    ? base.standingLanguage.replace('每条指令每日维持费 1 能量', '每条指令每日维持费 {standingUpkeep} 词元；它替你执行时，不再付写出')
    : base.standingLanguage.replace('Each order costs 1 energy of upkeep a day', 'Each order costs {standingUpkeep} tokens of upkeep a day; when it acts for you it pays no output');
  const how = s => zh
    ? s.replace('、petitions。', '、petitions、inbox（还没送到你这里的收件）、actions（动作的即时状态）。').replace('每一刻能看的次数有限，看不花能量；', '每一刻能看的次数有限，看到的文字按读入付词元；')
    : s.replace(', petitions.', ', petitions, inbox (items not yet delivered to you), actions (what you can do right now).').replace('and looking costs no energy', 'and what you see is paid for as reading');
  return { ...base, head, ruleLanguage, standingLanguage, howToActNative: how(base.howToActNative), howToActJson: how(base.howToActJson), howToActMcp: how(base.howToActMcp) };
}
