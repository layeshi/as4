import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import { parseAnswer } from '../public/answer-markdown.js';
import { buildAnswerModule } from '../wechat/scripts/shared.mjs';

const require = createRequire(import.meta.url);
const generated = require('../wechat/minigame/utils/answer-markdown.js');
const sourcePath = new URL('../public/answer-markdown.js', import.meta.url);
const generatedPath = new URL('../wechat/minigame/utils/answer-markdown.js', import.meta.url);

test('answer Markdown generated module matches its pure source and returns the same blocks', async () => {
  const text = await readFile(generatedPath, 'utf8');
  assert.equal(text, await buildAnswerModule());
  new Script(text);
  const answer = '# 结论\n\n**粗体** *斜体* `代码` [S1] [S9]\n下一行\n\n- 项目\n  3. 次项\n\n> 引用\n\n---\n\n```\n  保留缩进\n```\n\n| 城 | 数量 |\n|---|---|\n| 北城 | 12 |';
  const blocks = parseAnswer(answer, new Set(['S1']));
  assert.deepEqual(generated.parseAnswer(answer, new Set(['S1'])), blocks);
  assert.deepEqual(blocks.map(block => block.type), ['heading', 'para', 'list', 'quote', 'rule', 'code', 'table']);
  assert.deepEqual(blocks[0].inline, [{ type: 'text', text: '结论' }]);
  assert.equal(blocks[0].level, 1);
  assert.deepEqual(blocks[1].lines[0].filter(part => part.type !== 'text'), [
    { type: 'strong', children: [{ type: 'text', text: '粗体' }] },
    { type: 'em', children: [{ type: 'text', text: '斜体' }] },
    { type: 'code', text: '代码' },
    { type: 'cite', label: 'S1' },
  ]);
  assert.deepEqual(blocks[1].lines[1], [{ type: 'text', text: '下一行' }]);
  assert.deepEqual(blocks[2].items[0].subs[0].items[0].lines, [[{ type: 'text', text: '次项' }]]);
  assert.equal(blocks[2].items[0].subs[0].start, 3);
  assert.equal(blocks[5].text, '  保留缩进');
  assert.deepEqual(blocks[6].right, [false, true]);
  assert.deepEqual(blocks[6].headInline, [[{ type: 'text', text: '城' }], [{ type: 'text', text: '数量' }]]);
  assert.deepEqual(blocks[6].rowsInline[0][1], [{ type: 'text', text: '12' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(blocks)), blocks);
});

const forbidden = [
  ['正则后行断言', /\(\?<[=!]/],
  ['正则命名捕获组', /\(\?<[^=!]/],
  ['正则 Unicode 属性', /\\[pP]\{/],
  ['正则 dotAll 标志', /\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\n\\\[])+\/[dgimsuvy]*s[dgimsuvy]*\b/],
  ['数组 at/findLast', /\.\s*(?:at|findLast)\s*\(/],
  ['Object.hasOwn', /\bObject\s*\.\s*hasOwn\s*\(/],
  ['structuredClone', /\bstructuredClone\s*\(/],
  ['字符串 replaceAll', /\.\s*replaceAll\s*\(/],
];

test('answer Markdown source and generated copy avoid unsupported WeChat syntax and built-ins', async () => {
  const examples = ['/(?<=a)b/', '/(?<name>a)/', '/\\p{Letter}/u', '/[a/]+/gs', 'a.at(-1)', 'Object.hasOwn(a, "b")', 'structuredClone(a)', 'a.replaceAll("a", "b")'];
  forbidden.forEach(([, pattern], index) => assert.ok(pattern.test(examples[index]), examples[index]));
  assert.ok(forbidden[4][1].test('a.findLast(test)'));
  for (const path of [sourcePath, generatedPath]) {
    const text = await readFile(path, 'utf8');
    const code = text.replace(/^\s*\/\/.*$/gm, '');
    for (const [name, pattern] of forbidden) assert.doesNotMatch(code, pattern, `${path.pathname}: ${name}`);
    assert.doesNotMatch(text, /\b(?:document|window)\b|^import\s/m);
  }
});


test('assistant WeChat code avoids unsupported syntax and built-ins', async () => {
  for (const file of ['minigame/assistant.js', 'minigame/screens/assistant.js', 'minigame/screens/index.js', 'minigame/ui/answer.js', 'minigame/ui/nodes.js', 'minigame/society.js', 'miniprogram-app/platform.js', 'scripts/shared.mjs', 'scripts/release.mjs']) {
    const text = await readFile(new URL('../wechat/' + file, import.meta.url), 'utf8');
    const code = text.replace(/^\s*\/\/.*$/gm, '');
    for (const [name, pattern] of forbidden) assert.doesNotMatch(code, pattern, `${file}: ${name}`);
  }
});
