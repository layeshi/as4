// 文字测量与换行：按字体缓存单字宽度，换行结果按（字体、宽度、文本）缓存；遵守中文标点避头尾，英文单词尽量不拆。
const widths = new Map();
const layouts = new Map();
const LIMIT = 4000;
const NO_START = new Set(Array.from('，。、；：？！）》」』】〉”’…—·%,.;:?!)]}'));
const NO_END = new Set(Array.from('（《「『【〈“‘([{'));
const WORD = /[A-Za-z0-9_'’\-]/;

function charWidth(ctx, font, ch) {
  let table = widths.get(font);
  if (!table) { table = new Map(); widths.set(font, table); }
  let w = table.get(ch);
  if (w === undefined) { ctx.font = font; w = ctx.measureText(ch).width; table.set(ch, w); }
  return w;
}
function measure(ctx, font, text) {
  let w = 0;
  for (const ch of String(text)) w += charWidth(ctx, font, ch);
  return w;
}
function remember(key, value) {
  if (layouts.size >= LIMIT) layouts.delete(layouts.keys().next().value);
  layouts.set(key, value);
  return value;
}
/** 把一段（可含换行的）文字排成多行。 */
function wrap(ctx, text, width, font) {
  text = String(text == null ? '' : text);
  const key = font + '\u0000' + Math.round(width) + '\u0000' + text;
  const hit = layouts.get(key);
  if (hit) return hit;
  const lines = [];
  for (const part of text.split('\n')) {
    const chars = Array.from(part);
    let line = [], lineWidth = 0;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i], w = charWidth(ctx, font, ch);
      if (!line.length && ch === ' ') continue;
      if (line.length && lineWidth + w > width) {
        if (NO_START.has(ch)) { line.push(ch); lines.push(line.join('')); line = []; lineWidth = 0; continue; }
        let carry = [];
        if (WORD.test(ch) && WORD.test(line[line.length - 1])) {
          let start = line.length;
          while (start > 0 && WORD.test(line[start - 1])) start--;
          if (start > 0) carry = line.splice(start);
        }
        while (line.length > 1 && NO_END.has(line[line.length - 1])) carry.unshift(line.pop());
        lines.push(line.join('').replace(/\s+$/, ''));
        line = carry; lineWidth = carry.reduce((s, c) => s + charWidth(ctx, font, c), 0);
      }
      line.push(ch); lineWidth += w;
    }
    lines.push(line.join(''));
  }
  return remember(key, lines);
}
/** 截成至多 maxLines 行，最后一行放不下时以省略号结尾。 */
function clamp(ctx, text, width, font, maxLines) {
  const lines = wrap(ctx, text, width, font);
  if (!maxLines || lines.length <= maxLines) return { lines, truncated: false };
  const kept = lines.slice(0, maxLines);
  let last = Array.from(kept[maxLines - 1]);
  const dots = charWidth(ctx, font, '…');
  while (last.length && measure(ctx, font, last.join('')) + dots > width) last.pop();
  kept[maxLines - 1] = last.join('').replace(/[，。、；：\s]+$/, '') + '…';
  return { lines: kept, truncated: true };
}
function ellipsize(ctx, text, width, font) { return clamp(ctx, text, width, font, 1).lines[0] || ''; }

/**
 * 富文本：segments 是 [{ text, font, color, action }]，按同样的规则换行。
 * 返回 [{ runs: [{ text, x, w, seg }] }]；runs 的 x 相对行首。
 */
function wrapRich(ctx, segments, width) {
  const key = '\u0001' + Math.round(width) + JSON.stringify(segments.map(s => [s.text, s.font, s.color, s.action && JSON.stringify(s.action)]));
  const hit = layouts.get(key);
  if (hit) return hit;
  const atoms = [];
  segments.forEach((seg, index) => { for (const ch of String(seg.text)) atoms.push({ ch, seg: index, w: ch === '\n' ? 0 : charWidth(ctx, seg.font, ch) }); });
  const rows = [];
  let row = [], used = 0;
  const flush = () => { rows.push(row); row = []; used = 0; };
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    if (a.ch === '\n') { flush(); continue; }
    if (!row.length && a.ch === ' ') continue;
    if (row.length && used + a.w > width) {
      if (NO_START.has(a.ch)) { row.push(a); flush(); continue; }
      let carry = [];
      if (WORD.test(a.ch) && WORD.test(row[row.length - 1].ch)) {
        let start = row.length;
        while (start > 0 && WORD.test(row[start - 1].ch)) start--;
        if (start > 0) carry = row.splice(start);
      }
      while (row.length > 1 && NO_END.has(row[row.length - 1].ch)) carry.unshift(row.pop());
      flush();
      row = carry; used = carry.reduce((s, c) => s + c.w, 0);
    }
    row.push(a); used += a.w;
  }
  if (row.length || !rows.length) flush();
  const lines = rows.map(atomsInRow => {
    const runs = [];
    let x = 0;
    for (const a of atomsInRow) {
      const last = runs[runs.length - 1];
      if (last && last.seg === segments[a.seg]) { last.text += a.ch; last.w += a.w; }
      else runs.push({ text: a.ch, x, w: a.w, seg: segments[a.seg] });
      x += a.w;
    }
    return { runs, width: x };
  });
  return remember(key, lines);
}
function reset() { widths.clear(); layouts.clear(); }

module.exports = { measure, wrap, clamp, ellipsize, wrapRich, reset };
