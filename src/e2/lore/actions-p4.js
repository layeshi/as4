// Appendix A.3. Replacements operate only on static catalog descriptions, never resident text.
export function tokenDescription(type, desc) {
  const d = { zh: desc.zh.replaceAll('能量', '词元'), en: desc.en.replace(/\benergy\b/g, 'tokens') };
  const replace = (zh, en, withZh, withEn) => { d.zh = d.zh.replace(zh, withZh); d.en = d.en.replace(en, withEn); };
  if (type === 'whisper') replace('代价 3。', 'and it costs 3.', '另付手续费 {2K}。', 'and it costs a fee of {2K}.');
  if (type === 'give') { d.zh = d.zh.replace(/≥ 5/g, '≥ {reviveThreshold}'); d.en = d.en.replace(/reach 5 tokens/g, 'reach {reviveThreshold} tokens'); }
  if (type === 'remember') replace('记忆越多，代谢越高。', 'The more you remember, the higher your metabolism.', '记忆越多，每次醒来要读的越多，保管也越贵。', 'The more you remember, the more you read each time you wake, and the more it costs to keep.');
  if (type === 'internalize') {
    replace('代价 = ⌈这段记忆的分量 ÷ 2⌉。', "Cost = ⌈the memory's weight ÷ 2⌉.", '代价 = ⌈这段记忆的分量 ÷ 2⌉ × {K} 词元。', "Cost = ⌈the memory's weight ÷ 2⌉ × {K} tokens.");
    replace('不再计入代谢', 'it no longer counts toward your metabolism', '不再计入保管，也不必每次醒来重读', 'it no longer counts toward keeping, nor must it be re-read at every waking');
  }
  if (type === 'repair') replace('修满后多余的词元不扣。', 'tokens left over once fully repaired is not spent.', '修满后多余的词元不扣；每 {K} 词元修复的基点同原来的每 1 能量。', 'tokens left over once fully repaired is not spent; each {K} tokens repairs as many basis points as 1 energy did before.');
  if (type === 'initiate') {
    d.zh = d.zh.replace('或 road（', '、upgrade（改良源井：只能在源井，owner? 为 "self" 或 "city"）或 road（').replace('造价：开辟城内 40、荒野 30；模块见各模块；修路 60。', '造价：开辟城内 {40K}、荒野 {30K}；模块见各模块（×{K}）；修路 {60K}；改良第 n 级：第 1 级 {capacity}，之后每级是上一级的 1.5 倍。');
    d.en += ' upgrade improves the Well (only at the Well; owner? is "self" or "city"). Site costs: city {40K}, Wilds {30K}; module costs ×{K}; road {60K}. Upgrade level 1 costs {capacity}, each following level 1.5 times the last.';
    d.en = d.en.replace(/Costs?:[^.]+\./, '');
  }
  if (type === 'dismantle') { d.zh = d.zh.replaceAll('15', '{15K}'); d.en = d.en.replaceAll('15', '{15K}'); }
  if (type === 'draw') {
    d.zh = '从源井汲取 1–{20K} 词元，每 {K} 词元使源井完好度下降 0.2%；每人能汲取多少由法律决定。';
    d.en = 'Draw 1–{20K} tokens from the Well. Every {K} tokens lowers its condition by 0.2%; the law decides how much each resident may draw.';
  }
  if (type === 'inscribe') {
    d.zh = d.zh.replace('2 倍（至少 3，至多 100）', '2 倍（至少 3，至多 100）× {K}');
    d.zh = d.zh.replace('覆盖的基础代价为', '覆盖的手续费为');
    d.en = d.en.replace('(at least 3, at most 100).', '(at least 3, at most 100) × {K} tokens.');
  }
  if (type === 'conceive') { d.zh = d.zh.replace('初始词元为 40', '初始词元为 {40K}'); d.en = d.en.replace('initial tokens is 40', 'initial tokens are {40K}'); }
  if (type === 'will') { d.zh = d.zh.replace('至多 40 词元', '至多 {40K} 词元'); d.en = d.en.replace('up to 40 tokens', 'up to {40K} tokens'); }
  if (type === 'standing') { d.zh += '每条指令每日维持费 {standingUpkeep} 词元。'; d.en += ' Each order costs {standingUpkeep} tokens of upkeep a day.'; }
  return d;
}
