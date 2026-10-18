import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { renderAnswer } from '../public/assistant-markdown.js';
import { setLang } from '../public/i18n.js';

const ALLOWED = new Set(['div', 'p', 'br', 'h3', 'h4', 'h5', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'button', 'span']);
const sources = [{ id: 's1', label: 'S1', title: '北城公库' }, { id: 's2', label: 'S2', title: '法律 l8' }];
const tags = node => { const out = []; const walk = n => { if (n.tag) out.push(n.tag); n.childNodes.forEach(walk); }; walk(node); return out; };
const shape = node => (node.tag ? { [node.tag]: node.childNodes.map(shape) } : node.textContent);

function withDom(t) {
  const dom = installFakeDom();
  setLang('zh');
  t.after(() => dom.restore());
}

test('blocks: headings, lists with one nested level, quotes, rules, tables and fences', t => {
  withDom(t);
  const out = renderAnswer('# 一\n## 二\n### 三\n#### 四\n\n- 甲\n  - 乙\n      - 丙\n- 丁\n\n3. 三\n4. 四\n\n> 引用\n> **粗**\n\n---\n\n| 城 | 公库 | 变化 |\n|:--|--|--:|\n| 北城 | 1,234 | 上升 |\n| 西城 | — | 下降 |\n\n```\n<b>x</b>\n```');
  assert.deepEqual(out.childNodes.slice(0, 4).map(n => [n.tag, n.textContent]), [['h3', '一'], ['h3', '二'], ['h4', '三'], ['h5', '四']]);
  const list = out.querySelector('ul');
  assert.deepEqual(shape(list), { ul: [{ li: ['甲', { ul: [{ li: ['乙'] }, { li: ['丙'] }] }] }, { li: ['丁'] }] });
  assert.equal(out.querySelector('ol').getAttribute('start'), '3');
  assert.deepEqual(shape(out.querySelector('blockquote')), { blockquote: [{ p: ['引用', { br: [] }, { strong: ['粗'] }] }] });
  assert.ok(out.querySelector('hr'));
  const table = out.querySelector('.scroll-table table');
  assert.deepEqual(table.querySelectorAll('th').map(n => [n.textContent, n.className]), [['城', ''], ['公库', 'num'], ['变化', 'num']]);
  assert.deepEqual(out.querySelector('pre').textContent, '<b>x</b>');
});

test('inline: bold, italic, code, escapes; link syntax keeps only its text and nothing becomes a link or image', t => {
  withDom(t);
  const out = renderAnswer('**粗** *斜* `a<b>` \\*字面\\* [文字](https://evil.example/x) ![说明](javascript:alert(1)) <a href="x">标签</a> <https://y.example>');
  const p = out.querySelector('p');
  assert.deepEqual(p.childNodes.filter(n => n.tag).map(n => [n.tag, n.textContent]), [['strong', '粗'], ['em', '斜'], ['code', 'a<b>']]);
  assert.equal(p.textContent, '粗 斜 a<b> *字面* 文字 说明 <a href="x">标签</a> <https://y.example>');
  assert.deepEqual([...new Set(tags(out))].sort(), ['code', 'div', 'em', 'p', 'strong']);
});

test('source chips: [S1], [S1][S2] and [S1, S2] become buttons; unknown labels stay plain text', t => {
  withDom(t);
  const opened = [];
  const out = renderAnswer('见 [S1][S2]、[S1, S2]、[s2，S1] 与 [S9]、[S1, S9]。', { sources, onSource: s => opened.push(s.id) });
  const chips = out.querySelectorAll('button.assistant-cite');
  assert.deepEqual(chips.map(n => n.textContent), ['S1', 'S2', 'S1', 'S2', 'S2', 'S1']);
  assert.equal(chips[1].getAttribute('title'), '法律 l8');
  assert.equal(chips[0].getAttribute('type'), 'button');
  chips[1].click();
  assert.deepEqual(opened, ['s2']);
  assert.match(out.textContent, /与 \[S9\]、\[S1, S9\]。$/);
});

test('half-written answers render as plain text and keep a caret at the end of the last block', t => {
  withDom(t);
  const partial = renderAnswer('**还没闭合 与 *斜 和 [S1 以及 `代码\n| 城 | 公库 |', { sources, caret: true });
  assert.deepEqual(tags(partial), ['div', 'p', 'br', 'span']);
  assert.equal(partial.textContent, '**还没闭合 与 *斜 和 [S1 以及 `代码| 城 | 公库 |');
  assert.ok(partial.querySelector('p').lastChild.classList.contains('assistant-caret'));
  const list = renderAnswer('- 甲\n- 乙', { caret: true });
  assert.ok(list.querySelectorAll('li')[1].lastChild.classList.contains('assistant-caret'));
  const table = renderAnswer('| a | b |\n|---|---|\n| 1 | 2', { caret: true });
  assert.equal(table.querySelector('td').textContent, '1');
  assert.ok(table.lastChild.querySelector('.assistant-caret'));
  const empty = renderAnswer('', { caret: true });
  assert.ok(empty.querySelector('.assistant-caret'));
  const fence = renderAnswer('```\nconst a = 1;\n', { caret: true });
  assert.equal(fence.querySelector('pre').textContent, 'const a = 1;');
});

test('random and hostile input never throws, never builds other elements, and stays fast', t => {
  withDom(t);
  const alphabet = ['*', '**', '_', '`', '[', ']', '(', ')', '!', '#', '>', '-', '|', ':', '1.', ' ', '\n', '\n\n', 'S1', '[S1]', '<script>', '</a>', 'javascript:', '中', 'a', '\\', '~~~', '```'];
  let seed = 7;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
  for (let i = 0; i < 400; i++) {
    const text = Array.from({ length: next() % 80 }, () => alphabet[next() % alphabet.length]).join('');
    const out = renderAnswer(text, { sources, caret: i % 2 === 0 });
    for (const tag of tags(out)) assert.ok(ALLOWED.has(tag), `${tag} from ${JSON.stringify(text)}`);
  }
  const started = Date.now();
  renderAnswer('['.repeat(50000) + '*'.repeat(50000) + '`'.repeat(5000) + '**a '.repeat(10000));
  assert.ok(Date.now() - started < 2000, `${Date.now() - started}ms`);
});

test('shared parser preserves table inline formatting, escaped pipes, long-cell wrapping and source actions', t => {
  withDom(t);
  const opened = [];
  const long = '这是一段超过二十四个字符的表格内容用于核对长单元格自动换行的规则';
  const out = renderAnswer('| **项目** | 依据 |\n|---|---|\n| `甲\\|乙` | [S1] |\n| ' + long + ' | *说明* |', { sources, onSource: source => opened.push(source.id) });
  assert.equal(out.querySelector('th strong').textContent, '项目');
  assert.equal(out.querySelector('td code').textContent, '甲|乙');
  assert.equal(out.querySelector('td.wrap').textContent, long);
  assert.equal(out.querySelector('td em').textContent, '说明');
  out.querySelector('td button').click();
  assert.deepEqual(opened, ['s1']);
});
