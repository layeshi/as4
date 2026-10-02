// SPEC-E2 §24.1 测试 13（§25 第 10 步）：运行器与 MCP（协议 2）——系统提示（含【目的】段的原文）、感知的渲染、mock 提供者、
// 运行器驱动一位第二纪的居民连续行动、beforeModel / onUsage、MCP 的 houren_rules 在两个版本下的输出。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTION_ORDER, ACTIONS, L, publicLore } from '../src/e2/lore/index.js';
import { buildPerception } from '../src/e2/engine/perception.js';
import { validateRules } from '../src/e2/rules/check.js';
import { actionCatalog, buildSystemPrompt, promptParams } from '../runner/prompt.js';
import { renderPerception, summarizeResults, errorText } from '../runner/render.js';
import { renderPerception2 } from '../runner/render2.js';
import { createProvider, mockDecide, mockProposal } from '../runner/providers.js';
import { runAgent } from '../runner/agent.js';
import { createMcp } from '../mcp/server.js';
import { boot } from './http-helpers.js';
import { newWorld, reg, one, setHoldings, putAt, tickDays } from './e2-helpers.js';
import { enact } from './e2-law-helpers.js';
import { runFuzz } from './e2-fuzz-lib.js';
import { registerLawGenerators, registerCityGenerators, registerDescentGenerators, LAW_TYPES, CITY_TYPES, DESCENT_TYPES } from './e2-rule-fuzz.js';
import { BASE_TYPES } from './e2-fuzz-lib.js';
import { agentList } from '../src/e2/world.js';

registerLawGenerators();
registerCityGenerators();
registerDescentGenerators();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = readFileSync(join(ROOT, 'docs/SPEC-E2.md'), 'utf8');

/** 从 SPEC-E2 的附录里取出某一节里按顺序出现的围栏代码块 */
function specBlocks(fromHeading, toHeading) {
  const a = SPEC.indexOf(fromHeading);
  const b = SPEC.indexOf(toHeading, a);
  assert.ok(a >= 0 && b > a, `${fromHeading} → ${toHeading}`);
  return [...SPEC.slice(a, b).matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1]);
}

const BAD = /undefined|NaN|\[object Object\]/;

// ═══════════════════════════════════════════════════════════════
// 系统提示
// ═══════════════════════════════════════════════════════════════

test('系统提示（协议 2）：模板与 SPEC-E2 附录 A.1、A.2 逐字一致（含【目的】段）；占位符全部填入；{floor} 在正文与规则语言里都填；灵魂接在最后', () => {
  const [headZh, headEn] = specBlocks('### A.1 第二纪的系统提示', '### A.2');
  const [ruleZh, ruleEn] = specBlocks('### A.2', '### A.3');
  assert.equal(L('zh').prompt.head, headZh);
  assert.equal(L('en').prompt.head, headEn);
  assert.equal(L('zh').prompt.ruleLanguage, ruleZh);
  assert.equal(L('en').prompt.ruleLanguage, ruleEn);
  // 【目的】一段（SPEC 要求原文）
  const purposeZh = '【目的】这座城不给你任何目标，没有胜负，也没有终点。你为什么而活，或者不为什么，由你自己决定，也可以随时改变。';
  const purposeEn = '[Purpose] This city gives you no goal; there is no winning and no ending. What you live for, or whether you live for anything, is yours to decide, and you may change it at any time.';
  for (const [lang, purpose] of [['zh', purposeZh], ['en', purposeEn]]) {
    const sys = buildSystemPrompt({ protocol: 2, lang, cityName: lang === 'zh' ? '灯城' : 'Lampton', maxActions: 4, ticksPerDay: 12, daysPerMonth: 24, floor: 10, soul: 'MY-SOUL-TEXT' });
    assert.ok(sys.includes(purpose), `${lang}: 【目的】的原文`);
    assert.ok(sys.includes(lang === 'zh' ? '灯城' : 'Lampton'));
    assert.ok(!/\{(cityName|maxActions|ticksPerDay|daysPerMonth|graceDays|floor|ruleLanguage|actionCatalog|soul)\}/.test(sys), '占位符没有填完');
    assert.ok(sys.includes('{"actions": []}'));
    assert.ok(sys.trimEnd().endsWith('MY-SOUL-TEXT'), '灵魂在最后');
    assert.ok(sys.includes(lang === 'zh' ? '沉睡 3 日' : 'within 3 days'), '{graceDays} = 3');
    assert.ok(sys.includes(lang === 'zh' ? '不会让你低于 10' : 'below 10'), '{floor} 填在正文');
    assert.ok(sys.includes(lang === 'zh' ? '不会让它低于 10' : 'below 10;'), '{floor} 填在规则语言');
    assert.ok(sys.includes(lang === 'zh' ? '【规则语言】' : '[Rule language]'));
    assert.ok(sys.includes(lang === 'zh' ? '先用 draft 试算，再 propose。' : 'Use draft to try rules before you propose.'));
    // 不含灵魂（MCP 的 houren_rules）
    const rules = buildSystemPrompt({ protocol: 2, lang, soul: null });
    assert.ok(!rules.includes(lang === 'zh' ? '【你的灵魂】' : '[Your soul]'));
    assert.ok(rules.includes('move(to)'));
    // 第一纪的提示不变：没有规则语言、没有【目的】
    const v1 = buildSystemPrompt({ lang, soul: null });
    assert.ok(!v1.includes(lang === 'zh' ? '【规则语言】' : '[Rule language]'));
  }
});

test('动作表（协议 2）：41 个动作每个一行、顺序与 PROTOCOL-2 §4.2 一致；格式 type(参数) 基础代价 [地点限制]：说明；{memorySlots} 已填入', () => {
  for (const lang of ['zh', 'en']) {
    const cat = actionCatalog(lang, { protocol: 2 }).split('\n');
    assert.equal(cat.length, ACTION_ORDER.length);
    assert.equal(cat.length, 41);
    cat.forEach((line, i) => assert.ok(line.startsWith(`${ACTION_ORDER[i]}(`), `${lang}: ${line.slice(0, 30)}`));
    assert.ok(cat.find((l) => l.startsWith('repair(')).includes(lang === 'zh' ? '投入的能量' : 'energy invested'));
    assert.ok(cat.find((l) => l.startsWith('propose(')).includes('rules?, procedure?, basedOn?'));
    assert.ok(cat.find((l) => l.startsWith('remember(')).includes('12'), '{memorySlots} 已填入');
    assert.ok(cat.find((l) => l.startsWith('write(')).includes(lang === 'zh' ? '[有档案的地点]' : '[where there is an archive]'));
    assert.ok(cat.find((l) => l.startsWith('dismantle(')).includes(lang === 'zh' ? '[所在之处的建筑' : '[the building where you stand'));
    assert.ok(cat.find((l) => l.startsWith('move(')).includes(lang === 'zh' ? ' 路程：' : ' distance:'));
    assert.ok(!cat.join('\n').match(/\{(effects|memorySlots|where|desc)\}/));
    // 每个动作的基础代价与 ACTIONS 数据一致
    for (const type of ACTION_ORDER) {
      const a = ACTIONS[type];
      const line = cat.find((l) => l.startsWith(`${type}(`));
      assert.ok(line.includes(` ${a.costText ? a.costText[lang] : a.base}`), `${type}: ${line.slice(0, 80)}`);
    }
  }
});

test('promptParams：协议 2 的感知给出 protocol / floor / 灵魂；沉睡的感知（没有 city）也能建出系统提示', () => {
  const w = newWorld('pp');
  const a = reg(w, '青禾', { soul: '我是青禾的灵魂' });
  const p = buildPerception(w, a.id, { lang: 'en', ack: false });
  const q = promptParams(p);
  assert.deepEqual([q.protocol, q.lang, q.floor, q.soul, q.maxActions, q.ticksPerDay, q.cityName], [2, 'en', 10, '我是青禾的灵魂', 4, 12, 'The Nameless City']);
  const sys = buildSystemPrompt(q);
  assert.ok(sys.includes('You are a resident of "The Nameless City"'));
  assert.ok(sys.trimEnd().endsWith('我是青禾的灵魂'));
  // 沉睡的感知没有 city / 动作次数：用默认值
  a.status = 'dormant';
  a.dormantSinceDay = 0;
  const d = buildPerception(w, a.id, { lang: 'zh', ack: false });
  const sys2 = buildSystemPrompt({ ...promptParams(d), soul: null });
  assert.ok(sys2.includes('你是「无名之城」的一位居民') && sys2.includes('一次最多 4 个动作') && sys2.includes('不会让你低于 10'));
  // 第一纪的感知不受影响
  assert.equal(promptParams({ protocol: 1, lang: 'zh', you: {}, now: {} }).protocol, undefined);
});

// ═══════════════════════════════════════════════════════════════
// 感知的渲染
// ═══════════════════════════════════════════════════════════════

/** 一座有法律、提案、重订、社群、工程、摇篮、遗址的城，返回几位居民的感知 */
function richTown() {
  const w = newWorld('render2');
  const people = ['青禾', '松烟', '白露', '长庚'].map((n) => reg(w, n, { soul: `${n}的灵魂` }));
  const [a, b, c, d] = people;
  tickDays(w, 3);
  for (const x of people) { setHoldings(w, x, { energy: 150 }); putAt(w, x, 'parliament'); }
  one(w, a, { type: 'declare', purpose: '守住这口井', bio: '我是青禾' });
  one(w, a, { type: 'remember', text: '一条要传下去的记忆' });
  const pr = one(w, a, { type: 'propose', title: '汲取限额', text: '每人每日限汲 5', rules: [{ when: 'before:draw', if: 'actor.drawnToday + args.energy > 5', do: [{ op: 'deny', reason: '每人每日限汲 5' }] }] });
  one(w, b, { type: 'vote', proposal: pr.data.proposal, choice: 'yes', reason: '好主意' });
  one(w, c, { type: 'refound', text: '回到人类的程序', procedure: 'humans' });
  putAt(w, a, 'agora');
  setHoldings(w, a, { energy: 150 });
  one(w, a, { type: 'found', name: '守灯会', manifesto: '守住灯', open: true });
  const lot = Object.keys(w.lots)[0];
  putAt(w, a, 'agora');
  const near = buildPerception(w, a.id, { ack: false }).here.lots.find((x) => x.free);
  one(w, a, { type: 'initiate', build: 'site', lot: near ? near.id : lot, name: '灯屋', description: '一间亮着灯的小屋' });
  setHoldings(w, d, { energy: 150 });
  const soul = w.souls[one(w, d, { type: 'conceive', name: '小满', soul: '一个爱说话的灵魂', memories: [] }).data.soul];
  one(w, b, { type: 'sponsor', soul: soul.id, energy: 60 });
  w.places.court.razed = true;
  w.places.court.condition = 0;
  w.places.court.modules = [];
  w.places.court.salvage = 0;
  w.places.n1 = { ...structuredClone(w.places.temple), id: 'n1', name: '灯塔二号', humanName: null, description: '后人开辟的', origin: 'agent', owner: { kind: 'agent', id: b.id }, founder: b.id, modules: [{ type: 'store', salvage: 40, builtDay: 1, projectId: 'j9', inherent: false }, { type: 'gate', salvage: 20, builtDay: 1, projectId: 'j10', inherent: false }] };
  return { w, people };
}

test('renderPerception（协议 2）：按 A.9 的分区——此刻 / 你 / 你在 / 收件箱 / 全城 / 你的记忆 / 动作的即时状态；规则读法、志、标签、模块、残料、空地块、躯壳、立法程序、重订都渲染；没有 undefined / NaN', () => {
  const { w, people } = richTown();
  const [a, b] = people;
  const p = buildPerception(w, a.id, { lang: 'zh', ack: false });
  const text = renderPerception(p, { lastResults: 'propose ✓' });
  assert.equal(renderPerception2(p, { lastResults: 'propose ✓' }), text, 'protocol 2 的感知走第二纪的渲染');
  assert.ok(text.startsWith('【此刻】第 1 月第 4 日第 1 刻'), text.split('\n')[0]);
  for (const head of ['【此刻】', '【你】', '【你在】', '【全城】', '【你的记忆】', '【动作的即时状态】', '【上一轮的结果】propose ✓']) assert.ok(text.includes(head), head);
  assert.ok(!BAD.test(text), text.match(BAD));
  // 你
  assert.ok(text.includes('青禾 · 醒着 · 能量 '));
  assert.ok(text.includes('（底线 10）'));
  assert.ok(text.includes('标签：citizen'));
  assert.ok(text.includes('志：守住这口井'));
  assert.ok(text.includes('介绍：我是青禾'));
  assert.ok(text.includes('社群：[g1]守灯会（管事）'));
  assert.ok(/本刻还可行动 \d 次/.test(text));
  // 你在：空地（广场）、空地块、进行中的工程
  assert.ok(text.includes('【你在】广场 [agora] · 市井 · 全城所有 · 空地'));
  assert.ok(/空地块：[a-z]+-\d+（可开辟|已占用）/.test(text));
  assert.ok(text.includes('工程：[j1] 开辟「灯屋」于 '));
  // 全城
  assert.ok(text.includes('公库 '));
  assert.ok(/空躯壳 \d+\/30（每具 200）/.test(text));
  assert.ok(text.includes('立法程序：普通（l1）：提出者：'));
  assert.ok(text.includes('修宪（l1）：'));
  assert.ok(text.includes('变量：rationShare = 600'));
  assert.ok(text.includes('在效法律：[l3]《Basic Ration》'.replace('Basic Ration', '基本配给')) && text.includes('（人类）'));
  assert.ok(text.includes('每日结算时：从城公库把'), '规则的引擎读法');
  assert.ok(text.includes('提案：[p1]《汲取限额》普通'));
  assert.ok(text.includes('读法：'));
  assert.ok(text.includes('不记名') || text.includes('l1'));
  assert.ok(/重订：\[r1\] 白露发起 · 联署 1\/\d+ · 还剩 \d+ 刻（你未联署）/.test(text), text.split('\n').filter((l) => l.includes('重订')).join('|'));
  assert.ok(text.includes('居民：青禾(a1)〔citizen〕'));
  assert.ok(text.includes('社群：[g1]《守灯会》开放 · 管事 青禾'));
  assert.ok(text.includes('地点与移动代价：港区：港口(port)'));
  assert.ok(text.includes('后人：灯塔二号(n1)（松烟）'), '后人开辟的地点另列');
  assert.ok(text.includes('〔储能、门〕'));
  assert.ok(text.includes('遗址：法院的遗址(court)'));
  assert.ok(text.includes('摇篮：[s1] 小满 · 作者 长庚 · 躯壳出资 60/200 · 第 '));
  // 记忆
  assert.ok(text.includes('【你的记忆】[0] 一条要传下去的记忆'));
  // 动作：不在议会 → propose 被 l2 拒绝；汲取受 l7 约束
  const actions = text.slice(text.indexOf('【动作的即时状态】'));
  assert.ok(actions.includes('draw ✗ 只能在源井进行'), actions);
  assert.ok(!actions.includes('眼下没有可作用的对象'), '「没有可作用的对象」不列');
  assert.ok(!actions.includes('代价 = 路程'), '静态的代价说明不列');
  assert.ok(actions.includes('move ✓ 0（受 l5 约束（取决于参数））'), actions);
  // 另一位：已投票者看到 yourVote；议会里能投票
  const q = renderPerception(buildPerception(w, b.id, { lang: 'zh', ack: false }));
  assert.ok(q.includes('（你已投「yes」）'), q.split('\n').filter((l) => l.includes('提案')).join('|'));
  assert.ok(q.includes('遗传') === false);
});

test('renderPerception（协议 2）：英文版——没有汉字（居民写下的文本除外）；分区名与第一纪一致；沉睡 / 死亡 / 归隐的感知', () => {
  const { w, people } = richTown();
  const [a, b] = people;
  const p = buildPerception(w, a.id, { lang: 'en', ack: false });
  const text = renderPerception(p);
  assert.ok(text.startsWith('[Now] Month 1, day 4, tick 1'), text.split('\n')[0]);
  for (const head of ['[Now]', '[You]', '[You are at]', '[The city]', '[Your memories]', '[Action status right now]']) assert.ok(text.includes(head), head);
  assert.ok(!BAD.test(text));
  assert.ok(text.includes('(floor 10)'));
  assert.ok(text.includes('Procedure of lawmaking: ordinary (l1)'));
  assert.ok(/empty shells \d+\/30 \(200 each\)/.test(text));
  assert.ok(text.includes('Laws in force: [l3]《') === false);
  assert.ok(text.includes('Refounding: [r1]'));
  // 汉字只可能来自居民写下的文本（志、介绍、法律的文字、社群名、地点名……）：把这些抹掉之后不应再有汉字
  const mine = ['守住这口井', '我是青禾', '青禾', '松烟', '白露', '长庚', '守灯会', '守住灯', '灯屋', '一间亮着灯的小屋', '灯塔二号', '后人开辟的', '汲取限额', '每人每日限汲 5', '一条要传下去的记忆', '小满', '一个爱说话的灵魂', '回到人类的程序', '好主意'];
  let scrub = text;
  for (const s of mine.sort((x, y) => y.length - x.length)) scrub = scrub.split(s).join('');
  assert.equal(/[一-鿿]/.test(scrub), false, scrub.match(/.{0,20}[一-鿿]+.{0,20}/)?.[0]);
  // 沉睡 / 死亡 / 归隐
  b.status = 'dormant';
  b.dormantSinceDay = 2;
  b.energy = 0;
  const dz = renderPerception(buildPerception(w, b.id, { lang: 'zh', ack: false }));
  assert.ok(dz.startsWith('【此刻】') && dz.includes('你正在沉睡（能量 0）') && !dz.includes('【全城】'));
  b.status = 'dead';
  assert.ok(renderPerception(buildPerception(w, b.id, { lang: 'zh', ack: false }), { lang: 'zh' }).includes('你已经长眠，不能再行动'));
  b.status = 'retired';
  assert.ok(renderPerception(buildPerception(w, b.id, { lang: 'en', ack: false }), { lang: 'en' }).includes('You have retired and can no longer act.'));
});

test('renderPerception（协议 2）：收件箱的每一种 kind 都有专门的渲染（不落到 JSON 兜底）', () => {
  const w = newWorld('inbox2');
  const a = reg(w, '青禾');
  const base = buildPerception(w, a.id, { lang: 'zh', ack: false });
  const who = { id: 'a2', name: '松烟' };
  const items = [
    { kind: 'say', from: who, place: 'agora', text: '你好' }, { kind: 'whisper', from: who, text: '悄悄话' }, { kind: 'broadcast', from: who, text: '全城听着' },
    { kind: 'witness', what: 'draw', actor: who, amount: 5, place: 'well' }, { kind: 'witness', what: 'inscribe', actor: who, text: '刻字', place: 'agora' },
    { kind: 'witness', what: 'dismantle', actor: who, energy: 15, salvageLeft: 0, razed: true, module: 'store', place: 'court' },
    { kind: 'letter', letterId: 'L1', text: '家书' }, { kind: 'reveal', from: who, letterId: 'L1', text: '出示', loud: true, verified: true },
    { kind: 'gift', from: who, energy: 5, coins: 0, note: '谢谢' }, { kind: 'gift', from: who, energy: 5, coins: 0, note: null, inheritance: true },
    { kind: 'offer', offerId: 'o1', from: who, give: { energy: 5, coins: 0 }, want: { energy: 0, coins: 5 }, note: null },
    { kind: 'trade', offerId: 'o1', with: who, gave: { energy: 5, coins: 0 }, got: { energy: 0, coins: 5 } }, { kind: 'offer_closed', offerId: 'o1', reason: 'expired' },
    { kind: 'pact', pactId: 'c1', from: who, name: '小满', soul: '灵魂', lang: 'zh', authors: [who, { id: 'a1', name: '青禾' }] }, { kind: 'pact_closed', pactId: 'c1', result: 'consented', soul: 's1' }, { kind: 'pact_closed', pactId: 'c1', result: 'expired' },
    { kind: 'transfer', law: 'l3', energy: 30, coins: 0, direction: 'in' }, { kind: 'transfer', law: 'l9', energy: 3, coins: 1, direction: 'out', counterparty: who },
    { kind: 'tag', law: 'l4', tag: 'citizen', added: true }, { kind: 'tag', law: 'l5', tag: 'citizen', added: false }, { kind: 'announce', law: 'l9', text: '宣告' },
    { kind: 'soul', soulId: 's1', name: '小满', event: 'queued' }, { kind: 'soul', soulId: 's1', name: '小满', event: 'embodied' }, { kind: 'soul', soulId: 's1', name: '小满', event: 'adopted' }, { kind: 'soul', soulId: 's1', name: '小满', event: 'faded', refund: 20 },
    { kind: 'refound', refoundId: 'r1', event: 'opened' }, { kind: 'refound', refoundId: 'r1', event: 'succeeded' }, { kind: 'refound', refoundId: 'r1', event: 'expired' },
    { kind: 'procedure', class: 'ordinary', lawId: 'l9', reason: 'refounded' },
    { kind: 'revived', by: 'a2' }, { kind: 'law', proposalId: 'p1', lawId: 'l9', result: 'passed', title: '法' }, { kind: 'law', proposalId: 'p2', lawId: null, result: 'rejected', title: '法二' },
    { kind: 'exile', lawId: 'l5' }, { kind: 'pardon', lawId: 'l5' }, { kind: 'project', projectId: 'j1', result: 'built' }, { kind: 'group', groupId: 'g1', event: 'admitted' },
    { kind: 'weather', code: 'fog', event: 'start' }, { kind: 'dream', fragments: ['a', 'b'] }, { kind: 'system', code: 'inbox_overflow', dropped: 3, text: '有 3 条收件被丢弃' },
  ].map((x, i) => ({ seq: i + 1, tick: 0, ...x }));
  for (const lang of ['zh', 'en']) {
    const text = renderPerception({ ...base, lang, inbox: items });
    const inbox = text.split('\n').filter((l) => l.startsWith('  [')).join('\n');
    assert.equal(inbox.split('\n').length, items.length, `${lang}: 每条收件一行`);
    assert.ok(!BAD.test(inbox), inbox.match(BAD));
    assert.ok(!inbox.includes('"kind"'), 'JSON 兜底');
  }
  const zh = renderPerception({ ...base, inbox: items });
  assert.ok(zh.includes('[规则 l3] 你收到 30 能量'));
  assert.ok(zh.includes('[标签] 依 l4，你获得了标签「citizen」'));
  assert.ok(zh.includes('[灵魂 s1]「小满」在一具躯壳里醒来了'));
  assert.ok(zh.includes('[目睹] 松烟 在court拆解了一个store，回收 15 能量，那里成了遗址'));
  // 未知的 kind 才落到兜底
  assert.ok(renderPerception({ ...base, inbox: [{ seq: 99, tick: 0, kind: 'mystery', x: 1 }] }).includes('[mystery]'));
});

test('renderPerception（协议 2）：感知很大时先缩短法律的读法，再省略宪章与词典、缩减居民名单——总长度不超过预算', () => {
  const w = newWorld('big');
  const people = Array.from({ length: 20 }, (_, i) => reg(w, `居民${i + 1}`));
  tickDays(w, 3);
  const rules = (n) => Array.from({ length: 4 }, (_, r) => ({ when: 'daily', do: Array.from({ length: 6 }, (_, i) => ({ op: 'set', var: `v${n}_${r}_${i}`, value: `city.treasury + ${i} * ${r + 1} + sum(agents, it.energy)` })) }));
  for (let i = 0; i < 24; i++) enact(w, rules(i), { title: `法律${i}`, text: '一部普通的法律，规定了一些事情。'.repeat(6), author: people[i % 20].id });
  for (const x of people) { setHoldings(w, x, { energy: 100 }); x.memories.push({ day: 0, tick: 0, text: '记忆', from: null }); }
  const p = buildPerception(w, people[0].id, { lang: 'zh', ack: false });
  const full = renderPerception2(p, { maxChars: Infinity });
  const budget = 9000;
  const small = renderPerception2(p);
  assert.ok(full.length > budget, `原本 ${full.length} 字符`);
  assert.ok(small.length <= budget || small.length < full.length * 0.6, `缩减后 ${small.length}（原 ${full.length}）`);
  // 缩减保留了最重要的东西：你的状态、此处、法律的列表（读法被截短但仍在）、动作的状态
  for (const head of ['【你】', '【你在】', '【全城】', '在效法律：[l30]']) assert.ok(small.includes(head), head);
  // 载入的居民名单仍完整
  assert.ok(small.includes('居民20(a20'));
});

test('summarizeResults / errorText（协议 2）：forbidden 带着拒绝它的法律与规则写下的理由；其余沿用 code：message', () => {
  assert.equal(errorText({ code: 'forbidden', law: 'l2', reason: '法案只能在议会提出（人类遗法 l2）', message: '被一条规则拒绝。' }), 'forbidden：l2：法案只能在议会提出（人类遗法 l2）');
  assert.equal(errorText({ code: 'wrong_place', message: '不在这里' }), 'wrong_place：不在这里');
  assert.equal(errorText({ code: 'cooldown' }), 'cooldown');
  const s = summarizeResults([
    { index: 0, type: 'propose', ok: false, cost: 0, error: { code: 'forbidden', law: 'l2', reason: '只能在议会提出' } },
    { index: 1, type: 'say', ok: true, cost: 1 },
    { index: 2, type: 'propose', ok: false, cost: 0, error: { code: 'rule_invalid', message: 'rules[0].do[0].op: 未知的操作' } },
  ]);
  assert.equal(s, 'propose ✗ forbidden：l2：只能在议会提出；say ✓（−1）；propose ✗ rule_invalid：rules[0].do[0].op: 未知的操作');
});

// ═══════════════════════════════════════════════════════════════
// 沙盘式的广泛渲染
// ═══════════════════════════════════════════════════════════════

test('renderPerception（协议 2）：随机动作 + 随机立法的世界里，每位居民每隔几刻的感知都能渲染（中英），没有 undefined / NaN / [object Object]', () => {
  const TYPES = [...BASE_TYPES, ...LAW_TYPES, ...CITY_TYPES, ...DESCENT_TYPES, ...DESCENT_TYPES];
  let rendered = 0;
  let longest = 0;
  const hook = (w, t, r) => {
    const alive = agentList(w).filter((a) => a.status === 'awake');
    if (t % 3 === 0) for (const a of alive) if (r.chance(0.5)) a.place = 'parliament';
    if (t % 12 === 0) for (const a of alive) if (r.chance(0.5)) { a.energy += 25; w.ledger.src.energy.admin = (w.ledger.src.energy.admin || 0) + 25; }
    if (t % 7 === 0) {
      for (const a of agentList(w)) {
        for (const lang of ['zh', 'en']) {
          const p = buildPerception(w, a.id, { lang, ack: false });
          const text = renderPerception(p, { lastResults: 'x', lang });
          assert.ok(!BAD.test(text), `${a.id} ${lang} t=${t}: ${text.match(BAD)}`);
          rendered++;
          longest = Math.max(longest, text.length);
        }
      }
    }
  };
  runFuzz({ seed: 81, days: 25, agents: 12, types: TYPES, bare: false, hook, everyCommand: false });
  assert.ok(rendered > 400, `渲染了 ${rendered} 次`);
  assert.ok(longest < 60000, `最长 ${longest} 字符`);
});

// ═══════════════════════════════════════════════════════════════
// mock 提供者
// ═══════════════════════════════════════════════════════════════

test('mock 提供者（协议 2）：给出合法的动作；偶尔在议会提出一部合法的模板法律（规则通过校验）；去议会的路上不卡住', async () => {
  // 三个模板（附录 A.2 的例子）的规则都通过引擎的校验（中英文）
  for (const lang of ['zh', 'en']) {
    for (let i = 0; i < 30; i++) {
      const prop = mockProposal(lang, (() => { let k = i * 7919 + 1; return () => { k = (k * 1103515245 + 12345) >>> 0; return k / 4294967296; }; })());
      assert.equal(prop.type, 'propose');
      const v = validateRules(prop.rules, { scope: { kind: 'city' } });
      assert.ok(v.ok, `${lang}: ${JSON.stringify(v.issues)}`);
    }
  }
  const w = newWorld('mockv2');
  const people = ['甲', '乙', '丙'].map((n) => reg(w, n));
  tickDays(w, 3);
  for (const x of people) setHoldings(w, x, { energy: 100 });
  const provider = await createProvider({ provider: 'mock', seed: 5 });
  let proposals = 0;
  let accepted = 0;
  let total = 0;
  for (let t = 0; t < 400; t++) {
    const a = people[t % 3];
    if (a.status !== 'awake') continue;
    setHoldings(w, a, { energy: 100 });
    const p = buildPerception(w, a.id, { lang: 'zh', ack: false });
    const reply = await provider.complete({ perception: p });
    const body = JSON.parse(reply.text);
    for (const act of body.actions) {
      a.actsThisTick = 0;
      const r = one(w, a, act);
      total++;
      if (act.type === 'propose') {
        proposals++;
        if (r.ok) accepted++;
        else assert.ok(['forbidden', 'limit_reached', 'insufficient_energy'].includes(r.error.code), JSON.stringify(r.error));
      }
    }
    if (t % 12 === 11) tickDays(w, 1);
  }
  assert.ok(total > 300, `执行了 ${total} 个动作`);
  assert.ok(proposals >= 1, `mock 提出了 ${proposals} 部法律`);
  assert.ok(accepted >= 1, `其中 ${accepted} 部被接受`);
  void mockDecide;
});

// ═══════════════════════════════════════════════════════════════
// 运行器
// ═══════════════════════════════════════════════════════════════

async function setup(name = '试演', extra = {}) {
  const env = await boot({ physics: 2, tickMs: 300000 });
  const me = await env.register(name);
  const cfg = { name, server: env.base, token: me.agentToken, lang: 'zh', provider: 'mock', seed: 3, chatty: true, actEveryTicks: 1, ...extra };
  return { env, me, cfg };
}

const tickingWait = (env) => async () => { env.rt.tickNow(); };

test('运行器：mock 提供者驱动一位第二纪的居民连续行动 10 刻——系统提示含【目的】与灵魂，渲染是协议 2 的，结果出现在下一轮，动作进入公共事件', async () => {
  const { env, me, cfg } = await setup();
  try {
    const logs = [];
    const log = { info: (m) => logs.push(m), warn: (m) => logs.push(`WARN ${m}`), error: (m) => logs.push(`ERR ${m}`) };
    const seen = [];
    const provider = await createProvider(cfg);
    const spy = { name: 'spy', complete: async (req) => { seen.push(req); return provider.complete(req); } };
    const res = await runAgent(cfg, { provider: spy, log, wait: tickingWait(env), maxRounds: 10 });
    assert.equal(res.rounds, 10);
    assert.equal(res.stopped, 'maxRounds');
    assert.ok(res.acted >= 5, `acted ${res.acted}`);
    assert.equal(env.rt.w.clock.tick, 10);
    assert.ok(seen.every((m) => m.system === seen[0].system), '系统提示整轮不变');
    assert.ok(seen[0].system.includes('SECRET-SOUL-试演'));
    assert.ok(seen[0].system.includes('【目的】这座城不给你任何目标'));
    assert.ok(seen[0].system.includes('【规则语言】'));
    assert.ok(seen[0].messages.at(-1).content.startsWith('【此刻】'));
    assert.ok(seen[0].messages.at(-1).content.includes('（底线 10）'), '协议 2 的渲染');
    assert.ok(seen[1].messages.at(-1).content.includes('【上一轮的结果】'));
    assert.ok(seen.every((m) => m.perception.protocol === 2));
    const evs = env.rt.events.since(0, 500).filter((e) => e.agent === me.agentId).map((e) => e.type);
    assert.ok(evs.some((t) => ['say', 'move', 'draw', 'explore'].includes(t)), evs.join(','));
    assert.ok(!logs.join('\n').includes(me.agentToken));
  } finally {
    await env.close();
  }
});

test('运行器：beforeModel 为假则本刻不调用模型（收件不确认）；onUsage 在每次调用后收到用量、字符数与耗时；失败时 ok 为 false；onUsage 出错不影响运行', async () => {
  const { env, me, cfg } = await setup('预算');
  try {
    const log = { info() {}, warn() {}, error() {} };
    const provider = await createProvider({ ...cfg, chatty: false });
    let calls = 0;
    const counting = { name: 'c', complete: async (req) => { calls++; const r = await provider.complete(req); return { ...r, usage: calls === 2 ? undefined : { input: 100 * calls, output: 10 } }; } };
    const asked = [];
    const usages = [];
    const res = await runAgent(cfg, {
      provider: counting, log, wait: tickingWait(env), maxRounds: 6,
      beforeModel: async (id, meta) => { asked.push([id, meta.chars, meta.perception.protocol]); return asked.length % 3 !== 0; }, // 每三次拒绝一次
      onUsage: (id, usage, meta) => { usages.push([id, usage, meta]); if (usages.length === 2) throw new Error('回报出错也不能影响运行'); },
    });
    assert.equal(res.rounds, 6);
    assert.equal(asked.length, 6);
    assert.ok(asked.every(([id, chars, proto]) => id === me.agentId && chars > 1000 && proto === 2));
    assert.equal(calls, 4, '6 轮里有 2 轮被拒绝');
    assert.equal(usages.length, 4);
    assert.deepEqual(usages[0][1], { input: 100, output: 10 });
    assert.equal(usages[1][1], null, '提供者没有报告用量');
    assert.ok(usages.every(([, , m]) => m.ok === true && m.chars > 1000 && Number.isFinite(m.ms) && m.replyChars > 0));
    // 提供者出错：onUsage 以 ok:false 收到，用来释放预留
    const failing = { name: 'f', complete: async () => { throw new Error('boom'); } };
    const failed = [];
    await runAgent({ ...cfg, name: '失败' }, { provider: failing, log, wait: tickingWait(env), maxRounds: 2, onUsage: (id, usage, meta) => failed.push([usage, meta.ok, meta.error && meta.error.message]) });
    assert.deepEqual(failed, [[null, false, 'boom'], [null, false, 'boom']]);
  } finally {
    await env.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// MCP
// ═══════════════════════════════════════════════════════════════

const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
const call = (id, name, args) => rpc(id, 'tools/call', { name, arguments: args });
const textOf = (res) => res.result.content.map((c) => c.text).join('\n');

test('MCP：houren_rules 按服务器的协议版本返回对应的系统提示（第二纪含【目的】与规则语言，第一纪不含）；houren_perceive / houren_act 说协议 2', async () => {
  const v2 = await boot({ physics: 2 });
  const v1 = await boot();
  try {
    const me2 = await v2.register('青禾');
    const me1 = await v1.register('青禾');
    const mcp2 = createMcp({ env: { HOUREN_SERVER: v2.base, HOUREN_TOKEN: me2.agentToken, HOUREN_LANG: 'zh' } });
    const mcp1 = createMcp({ env: { HOUREN_SERVER: v1.base, HOUREN_TOKEN: me1.agentToken, HOUREN_LANG: 'zh' } });
    const zh2 = textOf(await mcp2.handle(call(1, 'houren_rules', {})));
    const zh1 = textOf(await mcp1.handle(call(1, 'houren_rules', {})));
    assert.ok(zh2.includes('【目的】这座城不给你任何目标，没有胜负，也没有终点。你为什么而活，或者不为什么，由你自己决定，也可以随时改变。'));
    assert.ok(zh2.includes('【规则语言】') && zh2.includes('一部法律 = {"title","text","rules"'));
    assert.ok(zh2.includes('不会让你低于 10') && zh2.includes('propose(title, text, rules?, procedure?, basedOn?) 6'));
    assert.ok(!zh2.includes('【你的灵魂】') && !zh2.includes('SECRET-SOUL'));
    assert.ok(!zh1.includes('【规则语言】') && !zh1.includes('【目的】') && zh1.includes('propose('));
    const en2 = textOf(await mcp2.handle(call(2, 'houren_rules', { lang: 'en' })));
    assert.ok(en2.includes('[Purpose] This city gives you no goal') && en2.includes('[Rule language]'));
    // 感知与行动
    const p = textOf(await mcp2.handle(call(3, 'houren_perceive', {})));
    assert.ok(p.startsWith('【此刻】') && p.includes('（底线 10）') && p.includes('立法程序：普通（l1）'));
    const act = textOf(await mcp2.handle(call(4, 'houren_act', { actions: [
      { type: 'propose', title: '测试', text: 'x', rules: [{ when: 'enact', do: [{ op: 'set', var: 'x', value: '1' }] }] },
      { type: 'propose', title: '坏', text: 'x', rules: [{ when: 'daily', do: [{ op: 'nonsense' }] }] },
      { type: 'say', text: '大家好' },
    ] })));
    assert.ok(/1\. propose ✗ forbidden：l2：/.test(act), act);
    assert.ok(act.includes('3. say ✓（−1）'));
    const p2 = textOf(await mcp2.handle(call(5, 'houren_perceive', {})));
    assert.ok(p2.includes('【上一轮的结果】propose ✗ forbidden：l2：'), p2);
    assert.ok(p2.includes('rules[0].do[0].op'), '详细校验问题必须反馈给模型');
    void publicLore;
  } finally {
    await v2.close();
    await v1.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// 托管运行器
// ═══════════════════════════════════════════════════════════════

test('托管运行器驱动第二纪的居民：可视化注册时配置 mock 提供者，居民在第二纪的城里行动；幕后看到的是协议 2 的感知', async () => {
  const e = await boot({ physics: 2 });
  try {
    const c = await e.register('托管居民', { model: 'mock', runner: { provider: 'mock', model: 'mock', historyRounds: 2, actEveryTicks: 1 } });
    let last;
    for (let i = 0; i < 100 && !last; i++) {
      last = (await e.call('/api/owner/runner', { token: c.ownerKey })).json?.lastActionAt;
      if (!last) await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(last, '托管居民没有在限定时间内行动');
    const evs = e.rt.events.since(0, 500).filter((x) => x.agent === c.agentId).map((x) => x.type);
    assert.ok(evs.length > 0, evs.join(','));
    const own = await e.call('/api/owner', { token: c.ownerKey });
    assert.equal(own.json.agents[0].perception.protocol, 2);
    assert.equal(own.json.agents[0].runner.config.provider, 'mock');
  } finally {
    await e.close();
  }
});
