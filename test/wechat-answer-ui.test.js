import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const N = require('../wechat/minigame/ui/nodes.js');
const T = require('../wechat/minigame/ui/text.js');
const { C, setFontScale } = require('../wechat/minigame/ui/theme.js');
const { answer, pre } = require('../wechat/minigame/ui/answer.js');

function canvas(large = false) {
  const drawn = [], hits = [], fills = [], records = [];
  const ctx = new Proxy({
    font: '16px sans-serif',
    measureText(value) { return { width: Array.from(String(value)).length * parseFloat(this.font.replace('bold ', '')) / 2 }; },
    fillText(value, x, y) { drawn.push({ text: value, x, y, font: this.font, color: this.fillStyle }); },
    fillRect(x, y, w, h) { fills.push({ x, y, w, h, color: this.fillStyle }); },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  setFontScale(large); T.reset(); N.begin(ctx, records);
  const g = { ctx, pressed: () => false, hit: (x, y, w, h, action) => hits.push({ x, y, w, h, action }) };
  return { drawn, hits, fills, records, paint: node => { node.paint(g, 0, 0); return node; } };
}

test('answer blocks preserve inline emphasis, citations, nested lists and quotation colors', () => {
  const c = canvas();
  c.paint(answer(320, '## 结论\n\n正文 **加粗** *强调* `记录` [S1] [S9]\n换行\n\n3. 首项\n   - 子项\n4. 次项\n\n> 引文\n\n---', [{ id: 'source-1', label: 'S1' }]));
  assert.ok(c.drawn.some(row => row.text === '结论' && row.font === 'bold 17px sans-serif'));
  assert.ok(c.drawn.some(row => row.text === '加粗' && row.font === 'bold 16px sans-serif'));
  assert.ok(c.drawn.some(row => row.text === '强调' && row.font === '16px sans-serif'));
  assert.ok(c.drawn.some(row => row.text === '记录' && row.color === C.label));
  assert.ok(c.drawn.some(row => row.text.includes('[S9]')));
  assert.deepEqual(c.hits.map(hit => hit.action), [{ type: 'assistantSource', id: 'source-1' }]);
  assert.equal(c.hits[0].h, 44);
  assert.ok(c.drawn.some(row => row.text === '3.' && row.x === 0));
  assert.ok(c.drawn.some(row => row.text === '•' && row.x === 20));
  assert.ok(c.drawn.some(row => row.text === '子项' && row.x === 40));
  assert.ok(c.drawn.some(row => row.text === '引文' && row.x === 12 && row.color === C.text2));
  assert.ok(c.fills.some(fill => fill.w === 3 && fill.color === C.lineStrong));
});

test('preformatted records keep indentation and whitespace when long lines wrap', () => {
  const c = canvas();
  const value = '{\n  "treasury": 1234,  \n\n    "city": "北城"\n}';
  const node = c.paint(pre(110, value));
  assert.ok(c.drawn.some(row => row.text.startsWith('  "treasury"')));
  assert.ok(c.drawn.some(row => row.text === ''));
  assert.equal(c.drawn.map(row => row.text).join(''), value.split('\n').join(''));
  assert.ok(c.drawn.every(row => row.font === '13px monospace'));
  assert.equal(node.height, c.drawn.length * 19);
  assert.ok(c.drawn.every(row => Array.from(row.text).length * 6.5 <= 110));
});

test('small tables wrap cells and right align numeric columns', () => {
  const c = canvas();
  c.paint(answer(260, '| 城 | 公库 | 备注 |\n| --- | ---: | --- |\n| 北城 | 1234 | 很长的备注需要换行而不是截断 |\n| 西城 | 4 | 平稳 |'));
  const first = c.drawn.find(row => row.text === '1234'), second = c.drawn.find(row => row.text === '4');
  assert.ok(first && second);
  assert.equal(first.x + 32, second.x + 8);
  assert.ok(c.drawn.some(row => row.text === '公库' && row.font === '12px sans-serif' && row.color === C.text3));
  assert.ok(c.drawn.filter(row => row.font === '16px sans-serif').map(row => row.text).join('').includes('很长的备注需要换行而不是截断'));
});

test('wide tables become named row blocks and retain clickable cell citations', () => {
  const c = canvas();
  c.paint(answer(320, '| 城 | 公库 | 增量 | 依据 |\n| --- | --- | --- | --- |\n| 北城 | 1234 | 15 | [S1] |', [{ id: 'source-1', label: 'S1' }]));
  assert.ok(c.drawn.some(row => row.text === '北城' && row.font === 'bold 16px sans-serif'));
  const text = c.records.filter(record => record.kind === 'rich').map(record => record.text).join('\n');
  assert.ok(text.includes('公库：1234 · 增量：15 · 依据：S1'));
  assert.equal(c.hits[0].action.id, 'source-1');
});

test('answer headings and code blocks adapt to large text', () => {
  const normal = canvas();
  const text = '## 标题\n\n### 小标题\n\n#### 细标题\n\n```\n  1234\n```';
  const small = normal.paint(answer(320, text));
  const large = canvas(true);
  const big = large.paint(answer(320, text));
  assert.ok(big.height > small.height);
  assert.ok(large.drawn.some(row => row.text === '标题' && row.font === 'bold 19px sans-serif'));
  assert.ok(large.drawn.some(row => row.text === '小标题' && row.font === 'bold 18px sans-serif'));
  assert.ok(large.drawn.some(row => row.text === '细标题' && row.font === 'bold 17px sans-serif'));
  assert.ok(large.drawn.some(row => row.text === '  1234' && row.font === '15px monospace'));
  setFontScale(false);
});

test('rich optional alignment and touch expansion preserve defaults', () => {
  const ordinary = canvas();
  const action = { type: 'assistantSource', id: 's1' };
  const node = ordinary.paint(N.rich(100, [{ text: 'S1', action }]));
  assert.equal(node.height, 22); assert.equal(ordinary.hits[0].h, 22); assert.equal(ordinary.drawn[0].x, 0);
  const extended = canvas();
  extended.paint(N.rich(100, [{ text: 'S1', action }], { style: 'body', bold: true, align: 'right', hitHeight: 44 }));
  assert.equal(extended.drawn[0].x, 84); assert.equal(extended.drawn[0].font, 'bold 16px sans-serif');
  assert.equal(extended.hits[0].h, 44); assert.equal(extended.hits[0].y, -9);
});
