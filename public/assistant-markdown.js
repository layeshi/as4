// 实验助手回答的排版：Markdown 的一个安全子集，加依据角标。
// 只用 h() 和文本节点建 DOM：不渲染链接、图片和 HTML，链接写法只留文字，`<` 等字符原样显示。
// 生成中的半截写法（未闭合的 **、还没有分隔行的表头）按原文显示，不抛错。

import { h } from './dom.js';
import { tr } from './console-ui.js';

import { parseAnswer } from './answer-markdown.js';

/** 渲染一条回答：返回 .assistant-prose；caret 为真时在末尾放生成中的光标 */
export function renderAnswer(text, { sources = [], onSource = () => {}, caret = false } = {}) {
  const ctx = { sources: new Map(sources.filter((s) => s?.label).map((s) => [s.label.toUpperCase(), s])), onSource };
  const list = parseAnswer(text, ctx.sources.keys());
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

// ── 块的 DOM ──

const breakLines = (lines, ctx) => lines.flatMap((line, k) => (k ? [h('br'), ...inline(line, ctx)] : inline(line, ctx)));

function block(b, ctx, tail) {
  const end = tail ? caretNode() : null;
  switch (b.type) {
    case 'para':
      return h('p', null, breakLines(b.lines, ctx), end);
    case 'heading':
      return h(b.level <= 2 ? 'h3' : b.level === 3 ? 'h4' : 'h5', null, inline(b.inline, ctx), end);
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
  const cell = (tag, text, parts, k) => h(tag, { class: [b.right[k] ? 'num' : '', tag === 'td' && text.length > 24 ? 'wrap' : ''].join(' ').trim() || null }, inline(parts, ctx));
  return h('div', { class: 'scroll-table' }, h('table', null,
    h('thead', null, h('tr', null, b.head.map((c, k) => cell('th', c, b.headInline[k], k)))),
    b.rows.length ? h('tbody', null, b.rows.map((row, index) => h('tr', null, row.map((c, k) => cell('td', c, b.rowsInline[index][k], k))))) : null));
}

// 行内节点仍只用文本节点与固定标签构建，不接受原始 HTML。
function inline(parts, ctx) {
  return parts.map(part => {
    if (part.type === 'text') return part.text;
    if (part.type === 'cite') return citeChip(ctx.sources.get(part.label), ctx.onSource);
    if (part.type === 'code') return h('code', null, part.text);
    return h(part.type, null, inline(part.children, ctx));
  });
}
