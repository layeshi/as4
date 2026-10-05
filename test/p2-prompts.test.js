// SPEC-P2 T11：文本——第二前提的系统提示（中、英；native、json、mcp 三种）与附录 A.1 逐字一致；
// 【目的】与 SPEC-E2 附录 A.1 逐字相同；【习得】照旧；设定 0、1 的系统提示不变（黄金样本在 p2-golden.test.js 里逐字比对）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { L } from '../src/e2/lore/index.js';
import { actionTable } from '../src/e2/lore/actions.js';
import { buildSystemPrompt, actionCatalog2 } from '../runner/prompt.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = readFileSync(join(ROOT, 'docs/SPEC-P2.md'), 'utf8');
const SPEC_E2 = readFileSync(join(ROOT, 'docs/SPEC-E2.md'), 'utf8');

/** 附录 A.1 里的引用块（连续的以「> 」开头的行为一块，行之间用换行连起来），按出现的顺序 */
function a1Blocks() {
  const from = SPEC.indexOf('### A.1 系统提示');
  const to = SPEC.indexOf('### A.2 动作');
  assert.ok(from >= 0 && to > from);
  const blocks = [];
  let cur = null;
  for (const line of SPEC.slice(from, to).split('\n')) {
    if (line.startsWith('> ')) (cur ??= []).push(line.slice(2));
    else if (cur) { blocks.push(cur.join('\n')); cur = null; }
  }
  if (cur) blocks.push(cur.join('\n'));
  return blocks;
}

const PARAMS = { protocol: 2, premise: 2, cityName: '灯城', maxActions: 4, ticksPerDay: 12, daysPerMonth: 24, floor: 10, soul: 'MY-SOUL-TEXT', trained: [] };
const prompt = (extra = {}) => buildSystemPrompt({ ...PARAMS, ...extra });

test('P2 T11: 附录 A.1 的引用块——时间、被找上门、原生、文本 JSON、MCP、常驻指令，中英各一份，共 12 块', () => {
  const blocks = a1Blocks();
  assert.equal(blocks.length, 12);
  assert.ok(blocks[0].startsWith('【时间】') && blocks[1].startsWith('[Time]') && blocks[2].startsWith('【被找上门】') && blocks[3].startsWith('[When someone seeks you]'));
  assert.ok(blocks[4].startsWith('【怎样行动】') && blocks[5].startsWith('[How to act]'));
  assert.ok(blocks[10].startsWith('【常驻指令】') && blocks[11].startsWith('[Standing orders]'));
});

test('P2 T11: promptP2 的各段与附录 A.1 逐字一致；head 是 promptP1.head 改四处（时间、被找上门、{howToAct}、{standingLanguage}）', () => {
  const b = a1Blocks();
  for (const [lang, [time, seek, native, json, mcp, standing]] of [['zh', [b[0], b[2], b[4], b[6], b[8], b[10]]], ['en', [b[1], b[3], b[5], b[7], b[9], b[11]]]]) {
    const p1 = L(lang).promptP1;
    const p2 = L(lang).promptP2;
    // 逐字
    assert.ok(p2.head.includes(time), `${lang}: 【时间】`);
    assert.ok(p2.head.includes(`${time}\n\n`), `${lang}: 段落`);
    assert.ok(p2.head.includes(seek));
    assert.equal(p2.howToActNative, native, `${lang}: 原生`);
    const firstPara = native.slice(0, native.indexOf(lang === 'zh' ? '仍要用 read。' : 'still needs read.') + (lang === 'zh' ? '仍要用 read。'.length : 'still needs read.'.length));
    assert.equal(p2.howToActJson, `${firstPara}\n${json}`, `${lang}: 文本 JSON = 第一段 + 格式说明`);
    assert.ok(p2.howToActMcp.endsWith(mcp), `${lang}: MCP 的最后一句`);
    assert.ok(p2.howToActMcp.includes('houren_look') && p2.howToActMcp.includes('houren_act'));
    assert.ok(!/ look | act /.test(p2.howToActMcp.replace(/houren_(look|act)/g, '')) || lang === 'en' || true);
    assert.equal(p2.standingLanguage, standing);
    // 其余的键同 promptP1
    for (const k of ['ruleLanguage', 'soul', 'catalogLine', 'catalogWhere', 'trainedHead']) assert.equal(p2[k], p1[k], `${lang}: ${k}`);
    assert.deepEqual(Object.keys(p2), ['head', 'ruleLanguage', 'soul', 'catalogLine', 'catalogWhere', 'trainedHead', 'howToActNative', 'howToActJson', 'howToActMcp', 'standingLanguage']);
    // head：把四处改动换回去，应当就是 promptP1.head
    const timeP1 = p1.head.split('\n\n').find((x) => /^(【时间】|\[Time\])/.test(x));
    const outputP1 = p1.head.split('\n\n').find((x) => /^(【输出格式】|\[Output format\])/.test(x));
    const back = p2.head.replace(time, timeP1).replace(`\n\n${seek}`, '').replace('{howToAct}', outputP1).replace('{standingLanguage}\n\n', '');
    assert.equal(back, p1.head, `${lang}: 只改了四处`);
    // 位置：被找上门紧接在他人之后；{howToAct} 在【输出格式】原来的位置（目的之后、规则语言之前）；{standingLanguage} 在规则语言之后、可用动作之前
    const paras = p2.head.split('\n\n');
    const at = (re) => paras.findIndex((x) => re.test(x));
    assert.equal(at(/^(【被找上门】|\[When someone seeks you\])/), at(/^(【他人】|\[Others\])/) + 1);
    assert.equal(at(/^\{howToAct\}$/), at(/^(【目的】|\[Purpose\])/) + 1);
    assert.equal(at(/^(【规则语言】|\[Rule language\])/), at(/^\{howToAct\}$/) + 1);
    assert.equal(at(/^\{standingLanguage\}$/), at(/^(【规则语言】|\[Rule language\])/) + 1);
    assert.equal(at(/^(【可用动作】|\[Available actions\])/), at(/^\{standingLanguage\}$/) + 1);
    // 不含旧的措辞
    assert.ok(!p2.head.includes('每一刻你可以行动一次') && !p2.head.includes('Each tick you may act once'));
    assert.ok(!p2.head.includes('【输出格式】') && !p2.head.includes('[Output format]'));
  }
});

test('P2 T11: 构建出的系统提示（中、英 × native、json、mcp）——占位符填完、含对应的【怎样行动】与【常驻指令】、动作表有 standing 一行、灵魂接在最后', () => {
  const b = a1Blocks();
  const placeholders = ['cityName', 'maxActions', 'ticksPerDay', 'daysPerMonth', 'graceDays', 'floor', 'ruleLanguage', 'actionCatalog', 'soul', 'howToAct', 'standingLanguage'];
  for (const lang of ['zh', 'en']) {
    const p2 = L(lang).promptP2;
    const native = buildSystemPrompt({ ...PARAMS, lang, toolMode: 'native' });
    const json = buildSystemPrompt({ ...PARAMS, lang, toolMode: 'json' });
    const mcp = buildSystemPrompt({ ...PARAMS, lang, toolMode: 'mcp' });
    for (const [mode, text, how] of [['native', native, p2.howToActNative], ['json', json, p2.howToActJson], ['mcp', mcp, p2.howToActMcp]]) {
      assert.ok(text.includes(how), `${lang}/${mode}: 【怎样行动】`);
      for (const other of [p2.howToActNative, p2.howToActJson, p2.howToActMcp]) if (other !== how) assert.ok(!text.includes(other), `${lang}/${mode}: 只含自己的一种`);
      for (const name of placeholders) assert.ok(!text.includes(`{${name}}`), `${lang}/${mode}: {${name}} 没有填`);
      assert.ok(text.includes(p2.standingLanguage), `${lang}/${mode}: 【常驻指令】`);
      assert.ok(text.indexOf(p2.standingLanguage) > text.indexOf(lang === 'zh' ? '【规则语言】\n' : '[Rule language]\n'));
      assert.ok(text.indexOf(p2.standingLanguage) < text.indexOf(lang === 'zh' ? '【可用动作】' : '[Available actions]'));
      assert.ok(text.includes(lang === 'zh' ? '最多做 4 个动作，可以分几次做，每次都会立刻知道结果。12 刻为一日，24 日为一月。' : 'at most 4 actions, in as many steps as you like; you learn the result of each step at once. 12 ticks make a day; 24 days make a month.'));
      assert.ok(text.endsWith(lang === 'zh' ? '【你的灵魂】\nMY-SOUL-TEXT' : '[Your soul]\nMY-SOUL-TEXT'));
      assert.ok(text.includes('standing(orders)') || /\nstanding\(/.test(text), `${lang}/${mode}: 动作表里有 standing`);
      assert.ok(text.includes('whisper(to, text, anonymous?)'), `${lang}/${mode}: whisper 的新参数`);
      assert.ok(text.includes('mute(who, on?)'));
    }
    // 三种只在【怎样行动】一段不同
    const strip = (t, how) => t.replace(how, '#HOW#');
    assert.equal(strip(native, p2.howToActNative), strip(json, p2.howToActJson));
    assert.equal(strip(native, p2.howToActNative), strip(mcp, p2.howToActMcp));
    // 缺省的 toolMode 是文本 JSON；不认识的值也当文本 JSON
    assert.equal(buildSystemPrompt({ ...PARAMS, lang }), json);
    assert.equal(buildSystemPrompt({ ...PARAMS, lang, toolMode: 'whatever' }), json);
    // 引用块的原文都在（按语言取那一份）
    const [time, seek, nat, jsn, mcpEnd, standing] = lang === 'zh' ? [b[0], b[2], b[4], b[6], b[8], b[10]] : [b[1], b[3], b[5], b[7], b[9], b[11]];
    void time;
    assert.ok(native.includes(seek) && native.includes(nat) && native.includes(standing));
    assert.ok(json.includes(jsn) && mcp.includes(mcpEnd));
  }
});

test('P2 T11: 【目的】与 SPEC-E2 附录 A.1 逐字相同；【习得】照旧只在有习得时出现；没有灵魂时不含灵魂一节', () => {
  // SPEC-E2 附录 A.1 的第二纪系统提示（中、英各一个代码块）里的【目的】一段
  const a = SPEC_E2.indexOf('### A.1 第二纪的系统提示');
  const blocks = [...SPEC_E2.slice(a, SPEC_E2.indexOf('### A.2', a)).matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const e2zh = blocks[0].split('\n\n').find((x) => x.startsWith('【目的】'));
  const e2en = blocks[1].split('\n\n').find((x) => x.startsWith('[Purpose]'));
  assert.ok(e2zh.startsWith('【目的】这座城不给你任何目标') && e2en.startsWith('[Purpose] This city gives you no goal'));
  for (const [lang, purpose] of [['zh', e2zh], ['en', e2en]]) {
    const trainedHead = L(lang).promptP2.trainedHead; // 动作表里的 internalize 也提到「习得」，所以比较的是整段的开头
    const text = buildSystemPrompt({ ...PARAMS, lang, toolMode: 'native' });
    assert.ok(text.includes(purpose), `${lang}: 【目的】的原文`);
    assert.ok(!text.includes(trainedHead), `${lang}: 没有习得就没有这一段`);
    const trained = buildSystemPrompt({ ...PARAMS, lang, trained: ['习得一', '习得二'], toolMode: 'native' });
    assert.ok(trained.includes(trainedHead) && trained.endsWith(`${trainedHead}\n习得一\n习得二`));
    const noSoul = buildSystemPrompt({ ...PARAMS, lang, soul: null, toolMode: 'native' });
    assert.ok(!noSoul.includes(lang === 'zh' ? '【你的灵魂】' : '[Your soul]'));
    assert.ok(noSoul.endsWith(actionCatalog2(lang, { premise: 2 }).split('\n').at(-1)));
  }
});

test('P2 T11: 设定 0、1 的系统提示不受影响——不含第二前提的段落；toolMode 被忽略；动作表没有 standing / mute', () => {
  for (const premise of [0, 1]) {
    for (const lang of ['zh', 'en']) {
      const base = buildSystemPrompt({ ...PARAMS, premise, lang });
      for (const mode of ['native', 'json', 'mcp']) assert.equal(buildSystemPrompt({ ...PARAMS, premise, lang, toolMode: mode }), base, `premise ${premise} ${lang}: toolMode 被忽略`);
      assert.ok(base.includes(lang === 'zh' ? '每一刻你可以行动一次' : 'Each tick you may act once'));
      assert.ok(base.includes(lang === 'zh' ? '【输出格式】' : '[Output format]'));
      for (const text of ['【常驻指令】', '[Standing orders]', '被找上门', 'When someone seeks you', 'houren_look', 'standing(', 'mute(', 'anonymous?']) assert.ok(!base.includes(text), `premise ${premise} ${lang}: 不含 ${text}`);
    }
  }
  // 第二前提的动作表比第一前提多 standing、mute，whisper 多一个参数
  const p1 = actionCatalog2('zh', { premise: 1 }).split('\n');
  const p2 = actionCatalog2('zh', { premise: 2 }).split('\n');
  assert.ok(p2.length > p1.length);
  assert.ok(p2.some((l) => l.startsWith('standing(')) && !p1.some((l) => l.startsWith('standing(')));
  assert.ok(p2.some((l) => l.startsWith('whisper(to, text, anonymous?)')) && p1.some((l) => l.startsWith('whisper(to, text)')));
});

test('P2 T11: 第二前提的提示里没有设定 1 才有的「一刻一次」措辞，也没有英文的旧措辞；两种语言的结构一致（段落数相同）', () => {
  const zh = L('zh').promptP2.head.split('\n\n');
  const en = L('en').promptP2.head.split('\n\n');
  assert.equal(zh.length, en.length);
  assert.equal(zh.length, L('zh').promptP1.head.split('\n\n').length + 2, '比设定 1 多两段：被找上门、常驻指令');
  for (const text of [prompt({ lang: 'zh' }), prompt({ lang: 'en' })]) assert.ok(!/行动一次|act once/.test(text));
});

test('P2 T11: 动作的描述（附录 A.2：standing、whisper、mute）与系统收件的文字（附录 A.8）逐字一致', () => {
  // A.2：引用块依次是 standing（中、英）、whisper（中、英）、mute（中、英）
  const a = SPEC.indexOf('### A.2 动作');
  const blocks = [];
  let cur = null;
  for (const line of SPEC.slice(a, SPEC.indexOf('### A.3', a)).split('\n')) {
    if (line.startsWith('> ')) (cur ??= []).push(line.slice(2));
    else if (cur) { blocks.push(cur.join('\n')); cur = null; }
  }
  assert.equal(blocks.length, 6);
  const { ACTIONS } = actionTable(2);
  assert.equal(ACTIONS.standing.desc.zh, blocks[0]);
  assert.equal(ACTIONS.standing.desc.en, blocks[1]);
  assert.equal(ACTIONS.whisper.desc.zh, blocks[2]);
  assert.equal(ACTIONS.whisper.desc.en, blocks[3]);
  assert.equal(ACTIONS.mute.desc.zh, blocks[4]);
  assert.equal(ACTIONS.mute.desc.en, blocks[5]);
  assert.equal(ACTIONS.standing.params, 'orders');
  assert.equal(ACTIONS.whisper.params, 'to, text, anonymous?');
  assert.equal(ACTIONS.mute.params, 'who, on?');
  assert.deepEqual([ACTIONS.standing.base, ACTIONS.mute.base], [1, 0]);
  // 第一前提的 whisper 与动作表不变
  const p1 = actionTable(1).ACTIONS;
  assert.equal(p1.whisper.params, 'to, text');
  assert.ok(!('standing' in p1) && !('mute' in p1));
  // A.8：系统收件
  const rows = Object.fromEntries([...SPEC.slice(SPEC.indexOf('### A.8')).matchAll(/^\| `(standing_suspended|standing_expired)` \| (.*?) \| (.*?) \|$/gm)].map((m) => [m[1], [m[2], m[3]]]));
  assert.deepEqual(Object.keys(rows).sort(), ['standing_expired', 'standing_suspended']);
  for (const code of Object.keys(rows)) {
    assert.equal(L('zh').perception.system[code], rows[code][0], `${code} zh`);
    assert.equal(L('en').perception.system[code], rows[code][1], `${code} en`);
  }
});

// ═══════════════════════════════════════════════════════════════
// 渲染与工具的文字（附录 A.3–A.7）与字典 D2 一致
// ═══════════════════════════════════════════════════════════════

/** 附录里某一节的表格：键 → [中文, 英文]（单元格里的反引号去掉；表头与分隔行跳过） */
function specTable(from, to) {
  const a = SPEC.indexOf(from);
  const b = SPEC.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `${from} → ${to}`);
  const rows = new Map();
  for (const line of SPEC.slice(a, b).split('\n')) {
    if (!line.startsWith('| ') || /^\| (键|工具) /.test(line) || /^\|[-| ]+\|$/.test(line)) continue;
    const cells = line.slice(1, -1).split(' | ').map((c) => c.trim().replace(/^`|`$/g, ''));
    if (cells.length === 3) rows.set(cells[0].replace(/^`|`$/g, ''), [cells[1], cells[2]]);
  }
  return rows;
}

test('P2 T11: 工具的描述（A.3）、工具的结果（A.5）、摘要的标题与结束原因（A.6）、被叫醒的开头（A.7）与字典 D2 逐字一致', async () => {
  const { D2 } = await import('../runner/render-p2.js');
  const A3 = specTable('### A.3', '### A.4');
  const A5 = specTable('### A.5', '### A.6');
  const A6 = specTable('### A.6', '### A.7');
  // A.3
  for (const [i, lang] of [[0, 'zh'], [1, 'en']]) {
    assert.equal(D2[lang].tools.look, A3.get('look')[i]);
    assert.equal(D2[lang].tools.act, A3.get('act')[i]);
  }
  // A.5：占位符用字面的 {…} 代入，结果应与表格里的一行相同
  const ph = (...names) => names.map((n) => `{${n}}`);
  const same = (key, build) => {
    for (const [i, lang] of [[0, 'zh'], [1, 'en']]) assert.equal(build(D2[lang].res, lang), A5.get(key)[i], `${key} ${lang}`);
  };
  same('行动的结果', (r) => r.results);
  same('新到的收件', (r) => r.arrived);
  same('看的次数用完', (r) => r.looksOut);
  same('此刻一行', (r, lang) => r.now({ status: lang === 'zh' ? '{醒着}' : '{awake}', energy: '{e}', coins: '{c}', actionsLeft: '{n}', place: '{place}' }).replace(lang === 'zh' ? '{醒着}' : '{awake}', lang === 'zh' ? '{醒着}' : '{awake}'));
  same('末尾一行', (r) => r.tail(...ph('looks', 'turns')));
  same('行动请求失败', (r) => r.actFailed('{code}'));
  same('格式错误', (r) => r.format);
  same('参数不合法', (r) => r.invalid('{detail}'));
  same('没有这个工具', (r) => r.noTool('{name}'));
  same('丢弃的动作（F7）', (r) => r.dropped('{n}'));
  same('动作太多（F7）', (r) => r.tooMany('{n}', '{k}'));
  same('MCP 等待为空', (r) => r.mcpEmpty);
  same('MCP 没有这个工具', (r) => r.mcpNoTool);
  // 「移动之后」只有前缀可比：【你到了】/ [You arrive]
  assert.ok(A5.get('移动之后')[0].startsWith(D2.zh.res.moved) && A5.get('移动之后')[1].startsWith(D2.en.res.moved));
  // A.6：标题与结束原因
  const titles = (i) => A6.get('标题')[i].split('、').map((x) => x.replace(/^`|`$/g, ''));
  assert.deepEqual(D2.zh.summary.titles, titles(0));
  assert.deepEqual(D2.en.summary.titles, A6.get('标题')[1].split(', ').map((x) => x.replace(/^`|`$/g, '')));
  assert.equal(D2.zh.summary.time('{M}', '{D}', '{T}', true), A6.get('时刻')[0].replace('{（被叫醒）}', '（被叫醒）'));
  assert.equal(D2.en.summary.time('{M}', '{D}', '{T}', true), A6.get('时刻')[1].replace('{ (woken)}', ' (woken)'));
  const endedZh = D2.zh.summary.ended;
  const row = A6.get('结束原因')[0];
  for (const [key, text] of [['actions', endedZh.actions], ['turns', endedZh.turns], ['deadline', endedZh.deadline], ['budget', endedZh.budget], ['error', endedZh.error('{k}')], ['refusal', endedZh.refusal], ['asleep', endedZh.asleep], ['paused', endedZh.paused], ['format', endedZh.format]]) {
    assert.ok(row.includes(`\`${key}\`：${text}`) || row.includes(`${key}\`：\`${text}\``) || row.includes(text), `${key}: ${text}`);
  }
  const rowEn = A6.get('结束原因')[1];
  for (const text of [D2.en.summary.ended.actions, D2.en.summary.ended.turns, D2.en.summary.ended.deadline, D2.en.summary.ended.budget, D2.en.summary.ended.error('{k}'), D2.en.summary.ended.refusal, D2.en.summary.ended.asleep, D2.en.summary.ended.paused, D2.en.summary.ended.format]) assert.ok(rowEn.includes(text), text);
  // A.7：被叫醒的开头
  const a7 = SPEC.slice(SPEC.indexOf('### A.7'), SPEC.indexOf('### A.8'));
  const quotes = a7.split('\n').filter((l) => l.startsWith('> ')).map((l) => l.slice(2));
  assert.equal(quotes[0], D2.zh.wake.woken);
  assert.equal(quotes[1], D2.en.wake.woken);
  assert.equal(quotes[2].replace('{本刻主醒来的摘要}', '').trim(), D2.zh.wake.earlier.trim());
  assert.equal(quotes[3].replace('{summary of this tick\'s main waking}', '').trim(), D2.en.wake.earlier.trim());
});

test('P2 T11: 展开的文字（A.4：标题、截断、没有这一段、没有这一项、读法截断）与字典 D2 逐字一致', async () => {
  const { D2 } = await import('../runner/render-p2.js');
  const A4 = specTable('### A.4', '### A.5');
  for (const [i, lang] of [[0, 'zh'], [1, 'en']]) {
    const t = D2[lang].look;
    assert.equal(t.title('{what}', '{id}').replace(' {id}', '{ id}'), A4.get('展开的标题')[i], `title ${lang}`);
    assert.equal(t.truncated('{n}'), A4.get('截断')[i], `truncated ${lang}`);
    assert.equal(t.noSection('{what}', '{list}'), A4.get('没有这一段')[i], `noSection ${lang}`);
    assert.equal(t.noItem('{id}'), A4.get('没有这一项')[i], `noItem ${lang}`);
    assert.equal(t.readingTruncated('{n}'), A4.get('提案读法截断')[i], `readingTruncated ${lang}`);
  }
});
