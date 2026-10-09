// P4-only labels and bill lines; resident-authored text is never translated.
const n = value => Number(value ?? 0).toLocaleString('en-US');
export function tokenHeadParts({ code, d, you }) {
  const t = you.tokens, en = code === 'en';
  return [you.name, d.status[you.status] || you.status,
    en ? `tokens ${n(you.energy)} (basic ${n(t.basic)})` : `词元 ${n(you.energy)}（基本额度 ${n(t.basic)}）`,
    en ? `body today ${n(t.usedToday)} / ${n(t.cap)}` : `身体今天 ${n(t.usedToday)} / ${n(t.cap)}`,
    en ? `keeping ${n(t.custody)}/day` : `保管 ${n(t.custody)}/日`, d.coins(n(you.coins)), d.age(n(you.ageDays))];
}
export function rhythmText(r, lang) {
  if (lang === 'en') return [r.every === 0 ? 'no scheduled waking' : r.every === 1 ? 'every tick' : `every ${r.every} ticks`, r.called ? 'woken when sought' : 'not woken when sought', r.brief === 'short' ? 'short summary' : 'full summary'].join(', ');
  return [r.every === 0 ? '不按时醒' : r.every === 1 ? '每刻醒' : `每 ${r.every} 刻醒`, r.called ? '被找上门会醒' : '被找上门不醒', r.brief === 'short' ? '短概要' : '全概要'].join('、');
}
export function tokenBillLines(t, lang) {
  const b = t.lastBill;
  if (!b) return [];
  const total = b.reread + b.read + b.write;
  return [lang === 'en'
    ? `  last waking ${n(total)} (re-read ${n(b.reread)} · read ${n(b.read)} · written ${n(b.write)}) · today ${n(t.wakes)} wakings, woken ${n(t.called)} times (${n(t.calledCost)}) · rhythm: ${rhythmText(t.routine, lang)}`
    : `  上次醒来 ${n(total)}（重读 ${n(b.reread)} · 读入 ${n(b.read)} · 写出 ${n(b.write)}）· 今天醒来 ${n(t.wakes)} 次，被叫醒 ${n(t.called)} 次（${n(t.calledCost)}）· 作息：${rhythmText(t.routine, lang)}`];
}
export const inboxMoreLine = (count, lang) => lang === 'en' ? `${count} earlier unread items: look inbox to see them.` : `另有 ${count} 条较早的未读收件：look inbox 查看。`;
export const emptyInboxLine = lang => lang === 'en' ? 'No unread items.' : '没有未读的收件。';
export function missedTokensLine(count, reason, lang) {
  if (lang === 'en') return reason === 'cap_reached' ? `You could not wake for ${count} tick(s): your body's allowance for today was used up.` : `You could not wake for ${count} tick(s): not enough tokens.`;
  return reason === 'cap_reached' ? `有 ${count} 刻你没能醒来：身体今天的额度用完了。` : `有 ${count} 刻你没能醒来：词元不够。`;
}
export const stoppedTokensLine = (reason, lang) => lang === 'en'
  ? reason === 'cap_reached' ? "Your body's allowance for today is used up: this waking ends here." : 'Out of tokens: this waking ends here.'
  : reason === 'cap_reached' ? '身体今天的额度用完了：这一次醒来到此为止。' : '词元不够了：这一次醒来到此为止。';
