// 实验助手回答的排版：Markdown 的一个安全子集，加依据角标。
// 只用 h() 和文本节点建 DOM：不渲染链接、图片和 HTML，链接写法只留文字，`<` 等字符原样显示。
// 生成中的半截写法（未闭合的 **、还没有分隔行的表头）按原文显示，不抛错。

import { h } from './dom.js';
import { tr } from './console-ui.js';

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

/** 渲染一条回答：返回 .assistant-prose；caret 为真时在末尾放生成中的光标 */
export function renderAnswer(text, { sources = [], onSource = () => {}, caret = false } = {}) {
  const ctx = { sources: new Map(sources.filter((s) => s?.label).map((s) => [s.label.toUpperCase(), s])), onSource };
  const list = parse(String(text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'));
  const nodes = list.map((b, k) => block(b, ctx, caret && k === list.length - 1));
  if (caret && !list.length) nodes.push(caretNode());
  return h('div', { class: 'assistant-prose' }, nodes);
}

/** 依据角标：小号描边标签，点开依据 */
export const citeChip = (source, onSource) => h('button', {
  type: 'button',
  class: 'assistant-cite',
  title: source.title || source.label,
  'aria-label': tr(`依据 ${source.label}：${source.title || ''}`, `Source ${source.label}: ${source.title || ''}`),
  onClick: () => onSource(source),
}, source.label);

export const caretNode = () => h('span', { class: 'assistant-caret', 'aria-hidden': 'true' });

// ── 块 ──

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
      let sub = item.subs.at(-1);
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

// ── 块的 DOM ──

const breakLines = (lines, ctx) => lines.flatMap((line, k) => (k ? [h('br'), ...inline(line, ctx)] : inline(line, ctx)));

function block(b, ctx, tail) {
  const end = tail ? caretNode() : null;
  switch (b.type) {
    case 'para':
      return h('p', null, breakLines(b.lines, ctx), end);
    case 'heading':
      return h(b.level <= 2 ? 'h3' : b.level === 3 ? 'h4' : 'h5', null, inline(b.text, ctx), end);
    case 'code':
      return h('pre', { class: 'assistant-code' }, b.text, end);
    case 'quote':
      return h('blockquote', null, b.blocks.map((x, k) => block(x, ctx, tail && k === b.blocks.length - 1)), tail && !b.blocks.length ? end : null);
    case 'list':
      return listNode(b, ctx, tail);
    case 'table':
      return [tableNode(b, ctx), tail ? h('p', null, end) : null];
    default:
      return [h('hr'), tail ? h('p', null, end) : null];
  }
}

function listNode(b, ctx, tail) {
  return h(b.ordered ? 'ol' : 'ul', { start: b.ordered && b.start !== 1 ? b.start : null }, b.items.map((it, k) => {
    const last = tail && k === b.items.length - 1;
    return h('li', null, breakLines(it.lines, ctx), it.subs.map((s, j) => listNode(s, ctx, last && j === it.subs.length - 1)), last && !it.subs.length ? caretNode() : null);
  }));
}

function tableNode(b, ctx) {
  const cell = (tag, text, k) => h(tag, { class: [b.right[k] ? 'num' : '', tag === 'td' && text.length > 24 ? 'wrap' : ''].join(' ').trim() || null }, inline(text, ctx));
  return h('div', { class: 'scroll-table' }, h('table', null,
    h('thead', null, h('tr', null, b.head.map((c, k) => cell('th', c, k)))),
    b.rows.length ? h('tbody', null, b.rows.map((row) => h('tr', null, row.map((c, k) => cell('td', c, k))))) : null));
}

// ── 行内 ──

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

function inline(text, ctx, depth = 0) {
  const out = [];
  let buf = '';
  const push = (...nodes) => {
    if (buf) out.push(buf);
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
        push(h('code', null, text.slice(i + run.length, close).replace(/^ (.+) $/, '$1')));
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
        push(h('strong', null, inline(inner, ctx, depth + 1)));
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
        push(h('em', null, inline(inner, ctx, depth + 1)));
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
        const labels = cite[1].split(/[ ]*[,，、;；][ ]*/).map((l) => l.toUpperCase());
        if (labels.every((l) => ctx.sources.has(l))) push(...labels.map((l) => citeChip(ctx.sources.get(l), ctx.onSource)));
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
        else push(...inline(label, ctx, depth + 1));
        i = paren + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  if (buf) out.push(buf);
  return out;
}
