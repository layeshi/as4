// 回答的 Markdown 安全子集：只产生纯数据，供网页与微信端共同排版。
// 链接与图片只保留说明文字；未闭合的写法按原文保留。

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RULE = /^ {0,3}([-*_])(?:[ ]*\1){2,}[ ]*$/;
const HEADING = /^ {0,3}(#{1,6})[ ]+(.*?)(?:[ ]+#+)?[ ]*$/;
const QUOTE = /^ {0,3}>[ ]?(.*)$/;
const ITEM = /^([ ]*)(?:([-*+])|(\d{1,9})[.)])[ ]+(.*)$/;
const DIVIDER = /^[ ]*\|?[ ]*:?-+:?[ ]*(?:\|[ ]*:?-+:?[ ]*)*\|?[ ]*$/;
const CITE = /^\[[ ]*([Ss]\d{1,3}(?:[ ]*[,，、;；][ ]*[Ss]\d{1,3})*)[ ]*\]/;
const NUMBER = /^[-+−±~≈约]?[ ]*\d[\d,，]*(?:\.\d+)?[ ]*(?:%|‰|万|亿|倍)?(?:[ ]*[A-Za-z一-鿿]{1,3})?$/;
const BLANK_CELL = new Set(['', '—', '-', '–', '…']);
// 行内配对的查找窗口：病态输入（几万个未闭合的 [ 或 **）也不会让页面卡住
const SPAN = 4000;
const LABEL = 1000;

/** 解析回答的安全 Markdown 子集；依据标号只识别本条回答提供的集合。 */
export function parseAnswer(text, labels = []) {
  const known = new Set(Array.from(labels, label => String(label).toUpperCase()));
  const blocks = parse(String(text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'));
  return blocks.map(block => parsedInline(block, known));
}

function parsedInline(block, labels) {
  if (block.lines) block.lines = block.lines.map(line => inline(line, labels));
  if (block.type === 'heading') block.inline = inline(block.text, labels);
  if (block.blocks) block.blocks = block.blocks.map(child => parsedInline(child, labels));
  if (block.items) block.items = block.items.map(item => {
    item.lines = item.lines.map(line => inline(line, labels));
    item.subs = item.subs.map(child => parsedInline(child, labels));
    return item;
  });
  if (block.type === 'table') {
    block.headInline = block.head.map(cell => inline(cell, labels));
    block.rowsInline = block.rows.map(row => row.map(cell => inline(cell, labels)));
  }
  return block;
}

function isTable(lines, i) {
  return i + 1 < lines.length && lines[i].includes('|') && lines[i + 1].includes('|') && DIVIDER.test(lines[i + 1]);
}

function startsBlock(lines, i) {
  const line = lines[i];
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line) || isTable(lines, i);
}

function parse(lines, depth = 0) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) {
      i++;
    } else if ((m = FENCE.exec(line))) {
      const close = new RegExp(`^ {0,3}${m[1][0] === '`' ? '`' : '~'}{${m[1].length},}[ ]*$`);
      const body = [];
      for (i++; i < lines.length && !close.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push({ type: 'code', text: body.join('\n').replace(/\n+$/, '') });
    } else if ((m = HEADING.exec(line))) {
      out.push({ type: 'heading', level: m[1].length, text: m[2] });
      i++;
    } else if (RULE.test(line)) {
      out.push({ type: 'rule' });
      i++;
    } else if (isTable(lines, i)) {
      i = table(lines, i, out);
    } else if (depth < 2 && QUOTE.test(line)) {
      const inner = [];
      for (; i < lines.length && (m = QUOTE.exec(lines[i])); i++) inner.push(m[1]);
      out.push({ type: 'quote', blocks: parse(inner, depth + 1) });
    } else if (ITEM.test(line)) {
      i = list(lines, i, out);
    } else {
      const para = [line.trim()];
      for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines, i); i++) para.push(lines[i].trim());
      out.push({ type: 'para', lines: para });
    }
  }
  return out;
}

const indentOf = (line) => line.match(/^ */)[0].length;

// 列表：可嵌一层；更深的缩进也算在这一层。换了列表类型就另起一个列表。
function list(lines, i, out) {
  const first = ITEM.exec(lines[i]);
  const base = first[1].length;
  const ordered = !!first[3];
  const node = { type: 'list', ordered, start: ordered ? Number(first[3]) : 1, items: [] };
  out.push(node);
  let item = null;
  let last = null;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let k = i + 1;
      while (k < lines.length && !lines[k].trim()) k++;
      if (k >= lines.length) return k;
      const next = ITEM.exec(lines[k]);
      if (next && (next[1].length > base + 1 || !!next[3] === ordered)) { i = k; continue; }
      if (!next && indentOf(lines[k]) > base + 1) { i = k; continue; }
      return k;
    }
    if (RULE.test(line)) return i;
    const m = ITEM.exec(line);
    if (m && m[1].length <= base + 1) {
      if (!!m[3] !== ordered) return i;
      item = { lines: [m[4]], subs: [] };
      node.items.push(item);
      last = item;
      i++;
      continue;
    }
    if (m) {
      const subOrdered = !!m[3];
      let sub = item.subs[item.subs.length - 1];
      if (!sub || sub.ordered !== subOrdered) item.subs.push(sub = { type: 'list', ordered: subOrdered, start: subOrdered ? Number(m[3]) : 1, items: [] });
      last = { lines: [m[4]], subs: [] };
      sub.items.push(last);
      i++;
      continue;
    }
    if (indentOf(line) <= base + 1 && startsBlock(lines, i)) return i;
    last.lines.push(line.trim());
    i++;
  }
  return i;
}

function cells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (s[k] === '|') { out.push(cur.trim()); cur = ''; continue; }
    cur += s[k];
  }
  out.push(cur.trim());
  return out;
}

function table(lines, i, out) {
  const align = cells(lines[i + 1]).map((c) => /-:$/.test(c));
  const width = align.length;
  const fit = (row) => Array.from({ length: width }, (_, k) => row[k] ?? '');
  const head = fit(cells(lines[i]));
  const rows = [];
  for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes('|') && !HEADING.test(lines[i]) && !QUOTE.test(lines[i]); i++) rows.push(fit(cells(lines[i])));
  const right = align.map((r, k) => {
    if (r) return true;
    const values = rows.map((row) => row[k]).filter((c) => !BLANK_CELL.has(c));
    return values.length > 0 && values.every((c) => NUMBER.test(c));
  });
  out.push({ type: 'table', head, rows, right });
  return i;
}

/** 找与开头等长的反引号串 */
function closingTicks(text, run, from) {
  const re = /`+/g;
  re.lastIndex = from;
  for (let m; (m = re.exec(text)) && m.index - from <= SPAN;) if (m[0].length === run.length) return m.index;
  return -1;
}

/** 与 at 处的开括号配对的闭括号 */
function closing(text, at, open, shut) {
  let depth = 0;
  for (let k = at; k < text.length && k - at <= LABEL; k++) {
    if (text[k] === '\\') { k++; continue; }
    if (text[k] === open) depth++;
    else if (text[k] === shut && --depth === 0) return k;
  }
  return -1;
}

/** 单个 * 的闭合：跳过成对的 ** */
function closingStar(text, from) {
  for (let k = from; k < text.length && k - from <= SPAN; k++) {
    if (text[k] === '\\') { k++; continue; }
    if (text[k] !== '*') continue;
    if (text[k + 1] === '*') { k++; continue; }
    return k;
  }
  return -1;
}

const tight = (s) => s.trim() !== '' && s === s.trim();

function inline(text, labels, depth = 0) {
  const out = [];
  let buf = '';
  const push = (...nodes) => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
    out.push(...nodes);
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && /[\\`*_{}[\]()#+\-.!|<>~]/.test(text[i + 1] ?? '')) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const run = /^`+/.exec(text.slice(i, i + 32))[0];
      const close = closingTicks(text, run, i + run.length);
      if (close >= 0) {
        push({ type: 'code', text: text.slice(i + run.length, close).replace(/^ (.+) $/, '$1') });
        i = close + run.length;
      } else {
        buf += run;
        i += run.length;
      }
      continue;
    }
    if (depth < 4 && (text.startsWith('**', i) || text.startsWith('__', i))) {
      const mark = text.slice(i, i + 2);
      let close = text.indexOf(mark, i + 2);
      if (close - i > SPAN) close = -1;
      while (close > 0 && text[close + 2] === mark[0]) close++;
      const inner = close > 0 ? text.slice(i + 2, close) : '';
      const wordy = mark === '__' && (/\w/.test(text[i - 1] ?? '') || /\w/.test(text[close + 2] ?? ''));
      if (tight(inner) && !wordy) {
        push({ type: 'strong', children: inline(inner, labels, depth + 1) });
        i = close + 2;
      } else {
        buf += mark;
        i += 2;
      }
      continue;
    }
    if (depth < 4 && c === '*') {
      const close = closingStar(text, i + 1);
      const inner = close > 0 ? text.slice(i + 1, close) : '';
      if (tight(inner)) {
        push({ type: 'em', children: inline(inner, labels, depth + 1) });
        i = close + 1;
      } else {
        buf += c;
        i++;
      }
      continue;
    }
    if (c === '[') {
      const cite = CITE.exec(text.slice(i, i + 200));
      if (cite) {
        const cited = cite[1].split(/[ ]*[,，、;；][ ]*/).map((l) => l.toUpperCase());
        if (cited.every((l) => labels.has(l))) push(...cited.map((label) => ({ type: 'cite', label })));
        else buf += cite[0];
        i += cite[0].length;
        continue;
      }
    }
    if (depth < 4 && (c === '[' || (c === '!' && text[i + 1] === '['))) {
      const at = c === '!' ? i + 1 : i;
      const end = closing(text, at, '[', ']');
      const paren = end > 0 && text[end + 1] === '(' ? closing(text, end + 1, '(', ')') : -1;
      if (paren > 0) {
        // 链接只留文字，图片只留说明文字；网址一律不显示、不可点
        const label = text.slice(at + 1, end);
        if (c === '!') buf += label;
        else push(...inline(label, labels, depth + 1));
        i = paren + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  if (buf) out.push({ type: 'text', text: buf });
  return out;
}
