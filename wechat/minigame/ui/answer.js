// 已审核回答的 Markdown 排版，与网页使用同一份解析结果。
const N = require('./nodes');
const P = require('./paint');
const T = require('./text');
const { C, size, font } = require('./theme');
const { parseAnswer } = require('../utils/answer-markdown');

function segments(parts, sources, bold) {
  const out = [];
  for (const part of parts) {
    if (part.type === 'strong' || part.type === 'em') out.push(...segments(part.children, sources, bold || part.type === 'strong'));
    else if (part.type === 'cite') {
      const source = sources.get(part.label);
      out.push({ text: part.label, color: C.moon, bold, action: { type: 'assistantSource', id: source.id } });
    } else out.push({ text: part.text, bold, color: part.type === 'code' ? C.label : undefined });
  }
  return out;
}

function lines(W, values, sources, opts = {}) {
  const parts = [];
  values.forEach((value, index) => {
    if (index) parts.push({ text: '\n' });
    parts.push(...segments(value, sources, opts.bold));
  });
  return N.rich(W, parts, Object.assign({ style: 'body', color: C.text, hitHeight: 44 }, opts));
}

/** 等宽记录保留所有空白；长行按可用宽度换行，不裁掉缩进。 */
function pre(W, value) {
  const s = size('meta'), f = `${s.size}px monospace`, rows = [];
  const text = String(value == null ? '' : value).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  N.record('code', text);
  for (const line of text.split('\n')) {
    let row = '', used = 0;
    for (const ch of Array.from(line)) {
      const w = T.measure(N.measureCtx(), f, ch);
      if (row && used + w > W) { rows.push(row); row = ''; used = 0; }
      row += ch; used += w;
    }
    rows.push(row);
  }
  return N.node(rows.length * s.line, (g, x, y) => rows.forEach((row, index) => P.text(g.ctx, row, x, y + index * s.line + s.line / 2, f, C.text)));
}

function list(W, block, sources, color) {
  return N.stack(block.items.map((item, index) => {
    const body = N.stack([
      lines(W - 20, item.lines, sources, { color }),
      ...item.subs.map(sub => list(W - 20, sub, sources, color)),
    ], 8);
    const label = block.ordered ? `${block.start + index}.` : '•', s = size('body');
    return N.node(body.height, (g, x, y) => {
      P.text(g.ctx, label, x, y + s.line / 2, font(s.size), color);
      body.paint(g, x + 20, y);
    });
  }), 8);
}

function table(W, block, sources, color) {
  if (block.head.length > 3) {
    return N.stack(block.rowsInline.map(row => {
      const rest = [];
      for (let k = 1; k < block.head.length; k++) {
        if (k > 1) rest.push({ type: 'text', text: ' · ' });
        rest.push(...block.headInline[k], { type: 'text', text: '：' }, ...row[k]);
      }
      return N.stack([
        lines(W, [row[0]], sources, { color, bold: true }),
        lines(W, [rest], sources, { color }),
      ], 4);
    }), 12);
  }
  const gap = 12, count = block.head.length, width = (W - gap * (count - 1)) / count;
  const row = (cells, header) => {
    const built = cells.map((cell, index) => lines(width, [cell], sources, {
      style: header ? 'caption' : 'body', color: header ? C.text3 : color, align: block.right[index] ? 'right' : 'left',
    }));
    const h = Math.max(...built.map(cell => cell.height)) + 16;
    return N.node(h, (g, x, y) => {
      built.forEach((cell, index) => cell.paint(g, x + index * (width + gap), y + 8));
      P.line(g.ctx, x, y + h - 0.5, x + W, y + h - 0.5, C.divider, 1);
    });
  };
  return N.stack([row(block.headInline, true), ...block.rowsInline.map(cells => row(cells, false))]);
}

function blocks(W, values, sources, color) {
  return N.stack(values.map(block => {
    if (block.type === 'para') return lines(W, block.lines, sources, { color });
    if (block.type === 'heading') return lines(W, [block.inline], sources, { style: block.level <= 2 ? 'heading' : block.level === 3 ? 'body' : 'feed', color: C.text, bold: true });
    if (block.type === 'list') return list(W, block, sources, color);
    if (block.type === 'code') return N.card(W, width => [pre(width, block.text)], { fill: C.raised, border: false, pad: 12 });
    if (block.type === 'table') return table(W, block, sources, color);
    if (block.type === 'quote') {
      const body = blocks(W - 12, block.blocks, sources, C.text2);
      return N.node(body.height, (g, x, y) => {
        g.ctx.fillStyle = C.lineStrong; g.ctx.fillRect(x, y, 3, body.height);
        body.paint(g, x + 12, y);
      });
    }
    return N.node(17, (g, x, y) => P.line(g.ctx, x, y + 8.5, x + W, y + 8.5, C.divider, 1));
  }), 12);
}

function answer(W, text, sources = []) {
  const known = new Map(sources.filter(source => source && source.label).map(source => [String(source.label).toUpperCase(), source]));
  return blocks(W, parseAnswer(text, known.keys()), known, C.text);
}

module.exports = { answer, pre };
