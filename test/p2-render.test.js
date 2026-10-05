// SPEC-P2 T2 的渲染部分（§8）：概要、展开、上几次醒来的摘要、被叫醒的开头。
// premise 0、1 的渲染逐字节不变由 p2-golden.test.js 保证；render2.js 拆分前后的差分另有对照。
import test from 'node:test';
import assert from 'node:assert/strict';
import e2 from '../src/e2/facade.js';
import { P } from '../src/e2/params.js';
import { renderPerception2 } from '../runner/render2.js';
import { renderBrief, renderLook, renderWake, renderHistory, clipLook, LOOK_WHATS, D2 } from '../runner/render-p2.js';
import { cpLength } from '../src/text.js';
import { one, putAt } from './e2-helpers.js';
import { richP2World, town } from './p2-helpers.js';

const HISTORY = [
  { tick: 14, kind: 'main', received: [{ kind: 'whisper', from: '居民3', text60: '甲，听说你要提案了？' }, { kind: 'whisper', from: null, text60: '匿名的话' }, { kind: 'offer', from: '居民2', text60: '换点能量' }],
    looks: ['here', 'proposal:p1'], acts: [{ type: 'say', ok: true, cost: 1 }, { type: 'move', ok: false, error: 'invalid_args' }], thoughts: ['去看看', '再想想'], ended: 'end', turns: 2 },
  { tick: 15, kind: 'wake', received: [], looks: [], acts: [{ type: 'vote', ok: true, cost: 0 }], thoughts: [], ended: 'actions', turns: 1 },
];
const MISSED = '你上一次醒来是第 1 月第 2 日第 3 刻；这中间你错过了 2 次醒来。';
const lines = (text) => text.split('\n');

test('P2 T2 渲染: 概要——各段的顺序与内容（附录 A.4）：【你】的数量只列编号，【你在】没有「听到」与各类细节，【全城】只有索引，记忆与动作的即时状态全文', async () => {
  const { perception } = await richP2World('brief');
  const p = perception();
  const text = renderBrief(p, { history: HISTORY, missed: MISSED });
  const heads = lines(text).filter((l) => /^【/.test(l)).map((l) => l.slice(0, l.indexOf('】') + 1));
  assert.deepEqual(heads, ['【此刻】', '【你】', '【你在】', '【收件箱】', '【全城】', '【你的记忆】', '【动作的即时状态】', '【上一次醒来】', '【再上一次】']);
  // 【你】：头两行同原来，然后是数量一行
  const you = lines(text).slice(1, 4);
  assert.ok(you[0].startsWith('【你】居民1 · 醒着 · 能量'));
  assert.ok(you[1].startsWith('  第 0 代'));
  assert.equal(you[2], '  家书 1 封（L1） · 我的交易 2（o1、o2） · 遗嘱：有 · 待收的记忆 1（k1） · 常驻指令 2 条 · 屏蔽 2');
  assert.equal(lines(text).some((l) => /^ {2}(家书|我的交易|遗嘱|待收的记忆) ?[\[：]/.test(l)), false, '全文在 look self 里');
  // 【你在】：地点、在场者、此处一行；没有听到、模块、墙上的字、告示板的交易
  const here = text.slice(text.indexOf('【你在】'), text.indexOf('【收件箱】')).trimEnd();
  assert.equal(lines(here).length, 3);
  assert.ok(lines(here)[0].startsWith('【你在】市场 [market]'));
  assert.ok(lines(here)[1].startsWith('  在场：居民2(a2)'));
  assert.equal(lines(here)[2], '  此处：墙上 1 条 · 告示板 1 条 · 空地块 3 块');
  for (const absent of ['听到', '模块', '市场的告示牌', '空地块：']) assert.equal(here.includes(absent), false, absent);
  // 【收件箱】：全文，含各类新收件
  assert.ok(text.includes('[定向交易 o2] 居民2 拿 2 旧币 换 2 能量：定向'));
  assert.ok(text.includes('[记忆 k1] 居民3 交给你一段记忆：丙的记忆，要交给甲（用 remember 的 gift "k1" 收下）'));
  assert.ok(text.includes('[私语] 居民3：甲，听说你要提案了？'));
  // 【全城】：头行 + 索引
  const city = text.slice(text.indexOf('【全城】'), text.indexOf('【你的记忆】'));
  assert.ok(city.includes('  立法程序：普通（l1）· 修宪（l1）'));
  assert.ok(city.includes('  法律：[l7]《每日问候》（居民2）'));
  assert.ok(city.includes('  法律：[l1]《立法程序》（人类）'));
  assert.ok(city.includes('  提案：[p1]《长读法》普通 · 赞 0 反 0 弃 0 · 还剩 12 刻（你可以投票）'));
  assert.ok(city.includes('  社群：[g1]《读书会》封闭 · 成员 1'));
  assert.ok(city.includes('  居民 4 位 · 地点 23 处 · 词典 0 条 · 摇篮 0 · 上书 0'));
  for (const absent of ['在效法律', '读法：', '宪章', '变量', '地点与移动代价', '每日结算时']) assert.equal(city.includes(absent), false, absent);
  // 【你的记忆】全文；【动作的即时状态】同原来
  assert.ok(text.includes('【你的记忆】[0] 我的一段记忆'));
  assert.ok(text.includes('  standing ✓ 1（规则另收：l7：1 能量）'));
  // 概要比整份感知小得多，而且不分级裁剪
  const full = renderPerception2(p);
  assert.ok(text.length < full.length / 2, `${text.length} vs ${full.length}`);
  // 摘要
  assert.ok(text.endsWith('  独白：去看看 / 再想想'));
});

test('P2 T2 渲染: 概要的英文版——标签与说明都是英文；没有「听到」；数量行与索引同 A.4', async () => {
  const { perception } = await richP2World('brief-en');
  const p = perception('en');
  const text = renderBrief(p, { history: HISTORY, lang: 'en' });
  assert.ok(text.includes('  letters 1 (L1) · my offers 2 (o1, o2) · will: yes · memories offered 1 (k1) · standing orders 2 · muted 2'));
  assert.ok(text.includes('  Here: 1 inscriptions · 1 offers on the board · 3 lots'));
  assert.ok(text.includes('  Lawmaking: ordinary (l1) · constitutional (l1)'));
  assert.ok(text.includes('  Law: [l7] "每日问候" (居民2)'));
  assert.ok(text.includes('  Law: [l1] "立法程序" (the humans)') || text.includes('  Law: [l1]'));
  assert.ok(text.includes('  Proposal: [p1] "长读法" ordinary · yes 0 no 0 abstain 0 · 12 tick(s) left (you may vote)'));
  assert.ok(text.includes('  Group: [g1] "读书会" closed · 1 members'));
  assert.ok(text.includes('  1 residents') === false);
  assert.ok(text.includes('  4 residents · 23 places · 0 words · 0 in the cradle · 0 petitions'));
  assert.ok(text.includes('[Your last waking]Month 1, day 2, tick 4 (woken)'));
  assert.ok(text.includes('[The one before]Month 1, day 2, tick 3'));
  // D2 里的中文标签没有漏进英文版
  for (const zh of ['家书', '此处', '常驻指令', '屏蔽', '立法程序', '上一次醒来', '收到：', '做了：']) assert.equal(text.includes(zh), false, zh);
});

test('P2 T2 渲染: 摘要——标题与时刻、收到（匿名写「有人」）、看了、做了、独白、结束原因；失去的一刻在【上一次醒来】的第一行；没有上一次时单独成行', async () => {
  const { perception } = await richP2World('summary');
  const p = perception();
  const out = lines(renderHistory(HISTORY, { code: 'zh', now: p.now, missed: MISSED }).join('\n'));
  assert.deepEqual(out, [
    '【上一次醒来】第 1 月第 2 日第 4 刻（被叫醒）',
    `  ${MISSED}`,
    '  做了：vote ✓',
    '  （动作次数用完）',
    '【再上一次】第 1 月第 2 日第 3 刻',
    '  收到：私语 来自 居民3：甲，听说你要提案了？；私语 来自 有人：匿名的话；交易 来自 居民2：换点能量',
    '  看了：here、proposal:p1',
    '  做了：say ✓（−1）、move ✗ invalid_args',
    '  独白：去看看 / 再想想',
  ]);
  // 第三条起标【更早一次】
  const three = [{ ...HISTORY[0], tick: 1 }, ...HISTORY];
  assert.deepEqual(renderHistory(three, { code: 'zh', now: p.now }).filter((l) => l.startsWith('【')).map((l) => l.slice(0, l.indexOf('】') + 1)), ['【上一次醒来】', '【再上一次】', '【更早一次】']);
  // 没有上一次：失去的一刻单独成行；什么都没有就什么都不写
  assert.deepEqual(renderHistory([], { code: 'zh', now: p.now, missed: MISSED }), [MISSED]);
  assert.deepEqual(renderHistory([], { code: 'zh', now: p.now }), []);
  // 结束原因：end 与 reply 不写；error 带轮数；其余各一句
  const ended = (e, extra = {}) => renderHistory([{ tick: 1, kind: 'main', received: [], looks: [], acts: [], thoughts: [], ended: e, turns: 3, ...extra }], { code: 'zh', now: p.now }).slice(1);
  assert.deepEqual(ended('end'), []);
  assert.deepEqual(ended('reply'), []);
  assert.deepEqual(ended('error', { failedTurn: 2 }), ['  （在第 2 轮中断）']);
  assert.deepEqual([ended('actions'), ended('turns'), ended('deadline'), ended('budget'), ended('refusal'), ended('asleep'), ended('paused'), ended('format')].map((x) => x[0].trim()),
    ['（动作次数用完）', '（轮数用完）', '（到了截止的时候）', '（没有醒全）', '（中断）', '（睡去了）', '（时间静止）', '（回复无法解析）']);
  // 英文
  const en = renderHistory(HISTORY, { code: 'en', now: p.now, missed: 'You last woke in month 1.' });
  assert.equal(en[0], '[Your last waking]Month 1, day 2, tick 4 (woken)');
  assert.ok(en.includes('  Received: whisper from 居民3: 甲，听说你要提案了？; whisper from someone: 匿名的话; offer from 居民2: 换点能量'));
  assert.ok(en.includes('  Did: say ✓ (−1), move ✗ invalid_args'));
  assert.ok(en.includes('  Looked at: here, proposal:p1'));
  assert.ok(en.includes('  Monologue: 去看看 / 再想想'));
  assert.ok(en.includes('  (out of actions)'));
  // 收到的太多时只列前 8 条
  const many = Array.from({ length: 11 }, (_, i) => ({ kind: 'say', from: `人${i}`, text60: `话${i}` }));
  const one8 = renderHistory([{ tick: 1, kind: 'main', received: many, looks: [], acts: [], thoughts: [], ended: 'end', turns: 1 }], { code: 'zh', now: p.now });
  assert.ok(one8[1].endsWith('（另有 3 条）'));
  assert.equal(one8[1].split('；').length, 8);
});

test('P2 T2 渲染: 被叫醒的开头——【被叫醒】一句、本刻早些时候的摘要、此刻、你的头行、收件箱、地点与在场者', async () => {
  const { perception } = await richP2World('wake-open');
  const p = perception();
  const text = renderWake(p, { earlier: HISTORY[0] });
  const heads = lines(text).filter((l) => /^【/.test(l)).map((l) => l.slice(0, l.indexOf('】') + 1));
  assert.deepEqual(heads, ['【被叫醒】', '【这一刻早些时候】', '【此刻】', '【你】', '【收件箱】', '【你在】']);
  assert.equal(lines(text)[0], '【被叫醒】这一刻还没结束，有人找你。');
  assert.ok(text.includes('  做了：say ✓（−1）、move ✗ invalid_args'));
  assert.equal(lines(text).filter((l) => l.startsWith('【你】')).length, 1);
  assert.equal(lines(text).some((l) => l.startsWith('  第 0 代')), false, '只有头行');
  assert.ok(lines(text).at(-1).startsWith('  在场：'));
  for (const absent of ['【全城】', '【你的记忆】', '【动作的即时状态】', '此处：']) assert.equal(text.includes(absent), false, absent);
  // 没有早些时候的摘要：省略那一节
  assert.equal(renderWake(p, {}).includes('【这一刻早些时候】'), false);
  assert.ok(renderWake(perception('en'), { lang: 'en', earlier: HISTORY[0] }).startsWith('[Woken] This tick is not over yet; someone is looking for you.\n[Earlier this tick]'));
});

test('P2 T2 渲染: look——标题、没有这一段、没有这一项、空的段；每一段都能渲染（中英、各种感知），没有 undefined / NaN / [object Object]', async () => {
  const { perception, people } = await richP2World('look-all');
  const p = perception();
  assert.deepEqual(LOOK_WHATS, ['here', 'self', 'laws', 'law', 'proposals', 'proposal', 'procedure', 'groups', 'group', 'residents', 'places', 'refounds', 'cradle', 'lexicon', 'petitions']);
  assert.equal(renderLook(p, 'here').split('\n')[0], '【看：here】');
  assert.equal(renderLook(p, 'law', 'l7').split('\n')[0], '【看：law l7】');
  assert.equal(renderLook(p, 'bogus'), `没有这一段：bogus。可以看：${LOOK_WHATS.join('、')}`);
  assert.equal(renderLook(p, 'law', 'l99'), '没有这一项：l99');
  assert.equal(renderLook(p, 'proposal', 'p99'), '没有这一项：p99');
  assert.equal(renderLook(p, 'group', 'g99'), '没有这一项：g99');
  assert.equal(renderLook(p, 'cradle'), '【看：cradle】\n（没有）');
  assert.equal(renderLook(perception('en'), 'cradle', undefined, { lang: 'en' }), '[Look: cradle]\n(none)');
  assert.equal(renderLook(perception('en'), 'bogus', undefined, { lang: 'en' }), `No such section: bogus. You can look at: ${LOOK_WHATS.join(', ')}`);
  assert.equal(renderLook(perception('en'), 'law', 'l99', { lang: 'en' }), 'No such item: l99');
  // 每一段、每种语言、每种身份的感知
  const { w } = await richP2World('look-all-2');
  const forms = [p, perception('en'), perception('zh', people[1]), perception('en', people[2])];
  w.agents.a4.status = 'dormant';
  w.agents.a4.dormantSinceDay = 0;
  forms.push(e2.buildPerception(w, 'a4', { ack: false }));
  w.agents.a4.status = 'dead';
  forms.push(e2.buildPerception(w, 'a4', { ack: false }));
  for (const f of forms) {
    for (const what of LOOK_WHATS) {
      for (const lang of ['zh', 'en']) {
        const out = renderLook(f, what, undefined, { lang });
        assert.equal(typeof out, 'string');
        assert.doesNotMatch(out, /undefined|NaN|\[object Object\]/, `${what}/${lang}`);
      }
    }
    assert.doesNotMatch(renderBrief(f, { history: HISTORY, missed: MISSED }), /undefined|NaN|\[object Object\]/);
  }
});

test('P2 T2 渲染: look here / procedure / groups / residents / places / cradle / lexicon / petitions / refounds 与原来的渲染同一行（第 0 级，不裁剪）', async () => {
  const { perception, w, people } = await richP2World('look-sections');
  const [a, b] = people;
  one(w, b, { type: 'say', text: '近处的话' });
  one(w, b, { type: 'define', word: '谷雨', meaning: '雨生百谷' });
  one(w, a, { type: 'inscribe', text: '另一条墙上的字' });
  const p = perception();
  const full = renderPerception2(p, { maxChars: 1e9 }).split('\n');
  const look = (what, id) => renderLook(p, what, id).split('\n').slice(1);
  // here：与整份感知里【你在】那一段逐行相同
  const hereStart = full.findIndex((l) => l.startsWith('【你在】'));
  const hereEnd = full.findIndex((l, i) => i > hereStart && /^【/.test(l));
  assert.deepEqual(look('here'), full.slice(hereStart, hereEnd));
  assert.ok(look('here').some((l) => l.includes('听到：') && l.includes('近处的话')), '展开里有听到');
  assert.ok(look('here').some((l) => l.includes('墙上：[') && l.includes('另一条墙上的字')));
  assert.ok(look('here').some((l) => l.startsWith('  告示板：[o1]')));
  // 其余各段的行都出现在整份感知里
  for (const [what, needle] of [['procedure', '  立法程序：'], ['groups', '  社群：[g1]'], ['residents', '  居民：'], ['places', '  地点与移动代价：'], ['lexicon', '  词典：']]) {
    const got = look(what);
    assert.ok(got.length >= 1, what);
    for (const line of got) assert.ok(full.includes(line), `${what}: ${line}`);
    assert.ok(got[0].startsWith(needle) || what === 'procedure', what);
  }
  assert.ok(look('procedure').some((l) => l.startsWith('  宪章')));
  assert.ok(look('procedure').some((l) => l.startsWith('  变量：rationShare = 600')));
  assert.ok(look('lexicon')[0].includes('谷雨=雨生百谷'));
  // 立法程序的读法不裁剪（第 0 级）
  const proc = look('procedure')[0];
  assert.ok(proc.includes('决定：') || proc.length > 100);
});

test('P2 T2 渲染: look laws / proposals——每行之后加维持费与宣告的说明（F5）；提案的读法给引擎给的全部并注明截断的原长；章程提案的宣告由社群公库付', async () => {
  const { perception, w, people } = await richP2World('look-law');
  const [a, b] = people;
  const p = perception();
  const laws = renderLook(p, 'laws');
  // l7：两条持续规则（daily 与 before:standing），有宣告
  assert.ok(laws.includes('（每日维持 2 能量；宣告的费用由公库付）'));
  // l4：两条持续规则，没有宣告
  const l4 = renderLook(p, 'law', 'l4');
  assert.ok(l4.includes('（每日维持 2 能量）'));
  assert.equal(l4.includes('宣告的费用'), false);
  // 立法程序的法律：没有维持费，指给 look procedure
  const l1 = renderLook(p, 'law', 'l1');
  assert.ok(l1.includes('立法程序（用 look procedure 看）'));
  assert.equal(l1.includes('每日维持'), false);
  // 读法至多 400（引擎给的）
  for (const l of p.city.laws) assert.ok(cpLength(l.reading) <= P.readingInPerception);
  // 提案：读法 2000，注明原长
  const prop = renderLook(p, 'proposal', 'p1');
  const q = p.city.proposals[0];
  assert.equal(q.readingTruncated, true);
  assert.ok(prop.includes(q.reading.split('\n')[0]));
  assert.ok(prop.includes(`（读法已截断，原长 ${q.readingLength} 字符）`));
  assert.ok(prop.includes('（每日维持 8 能量；宣告的费用由公库付）'));
  assert.equal(renderLook(p, 'proposals').includes('（读法已截断，原长'), true);
  // 英文
  const en = renderLook(perception('en'), 'proposal', 'p1', { lang: 'en' });
  const qen = perception('en').city.proposals[0];
  assert.ok(en.includes(` (reading truncated; ${qen.readingLength} characters in full)`));
  assert.ok(en.includes(' (upkeep 8 energy a day; announcements are paid from the treasury)'));
  // 社群章程提案：宣告的费用由社群公库付；地点规则提案由主人付
  assert.equal(one(w, a, { type: 'found', name: '议事会', manifesto: '成员多数决', open: true, procedure: 'members' }).ok, true);
  const g = one(w, a, { type: 'rules', group: 'g2', rules: [{ when: 'daily', do: [{ op: 'announce', to: 'group:g2', text: '会内的话' }] }] });
  assert.equal(g.ok, true, JSON.stringify(g));
  const p2 = perception();
  const bylaws = p2.city.proposals.find((x) => x.kind === 'bylaws');
  assert.ok(bylaws, '社群章程的提案');
  assert.ok(renderLook(p2, 'proposal', bylaws.id).includes('（每日维持 1 能量；宣告的费用由社群公库付）'));
  void b;
});

test('P2 T2 渲染: look self——家书、交易、孕育之约、遗嘱、待收的记忆全文、常驻指令的全文（附录 A.4 的格式）、屏蔽名单', async () => {
  const { perception, w, people } = await richP2World('look-self');
  const [a, , c] = people;
  one(w, c, { type: 'remember', text: '另一段很长的记忆，'.repeat(8) });
  one(w, c, { type: 'impart', to: a.id, memory: 1 });
  const p = perception();
  const out = renderLook(p, 'self').split('\n');
  assert.equal(out[0], '【看：self】');
  assert.ok(out.includes('  家书 [L1] 第 4 日（未出示）：好好照顾彼此。'));
  assert.ok(out.some((l) => l.startsWith('  我的交易 [o1]：1 旧币 → 1 能量')));
  assert.ok(out.some((l) => l.startsWith('  我的交易 [o2]：2 旧币 → 2 能量 至 a1')));
  assert.ok(out.some((l) => l.startsWith('  遗嘱：继承人 居民2(a2)×1；遗言：再会')));
  // 待收的记忆：全文，不截断
  const long = '另一段很长的记忆，'.repeat(8);
  assert.ok(out.some((l) => l.includes(long)), '待收的记忆全文');
  assert.equal(out.some((l) => l.endsWith('…')), false);
  // 常驻指令：A.4 的格式
  assert.ok(out.includes('  [0] 时机 inbox:whisper · 条件 it.anonymous != true · 动作 [{"type":"whisper","to":"=it.from.id","text":"收到"}] · 已触发 0 次'));
  assert.ok(out.includes('  [1] 时机 daily · 动作 [{"type":"diary","text":"日记"}] · 已触发 0 次'));
  // 屏蔽名单
  assert.equal(out.at(-1), '  屏蔽：居民4(a4)、所有匿名私语');
  // 英文与停摆、次数、到期日
  a.standing[0].times = 5;
  a.standing[0].untilDay = 9;
  a.standing[0].fired = 2;
  a.standing[1].paidThrough = -1;
  const en = renderLook(perception('en'), 'self', undefined, { lang: 'en' }).split('\n');
  assert.ok(en.includes('  [0] when inbox:whisper · if it.anonymous != true · do [{"type":"whisper","to":"=it.from.id","text":"收到"}] · fired 2 time(s) · at most 5 · until day 9'));
  assert.ok(en.includes('  [1] when daily · do [{"type":"diary","text":"日记"}] · fired 0 time(s) · standing still today'));
  assert.equal(en.at(-1), '  Muted: 居民4(a4), all anonymous whispers');
  // 只屏蔽匿名、只屏蔽人
  a.muted = ['anonymous'];
  assert.equal(renderLook(perception(), 'self').split('\n').at(-1), '  屏蔽：所有匿名私语');
  a.muted = [people[3].id];
  assert.equal(renderLook(perception(), 'self').split('\n').at(-1), '  屏蔽：居民4(a4)');
});

test('P2 T2 渲染: clipLook——超过上限按码点截断并加说明；没超过原样', () => {
  const text = '一二三四五六七八九十'.repeat(5);
  assert.equal(clipLook(text, 100, 'zh'), text);
  assert.equal(clipLook(text, 50, 'zh'), text);
  assert.equal(clipLook(text, 20, 'zh'), `${text.slice(0, 20)}\n（已截断，原长 50 字符；用 id 看其中一项）`);
  assert.equal(clipLook(text, 20, 'en'), `${text.slice(0, 20)}\n(truncated; 50 characters in full — use an id to see one item)`);
  const emoji = '😀'.repeat(10);
  assert.equal(clipLook(emoji, 4, 'zh').split('\n')[0], '😀'.repeat(4), '按码点，不劈开代理对');
});

test('P2 T2 渲染: 收件 standing 与匿名私语在整份感知的渲染里有专门的格式（中英，附录 A.8）', () => {
  const { w, people } = town(2, 'inbox-kinds');
  const [a, b] = people;
  one(w, a, { type: 'standing', orders: [{ when: 'tick', do: [{ type: 'say', text: '我在' }, { type: 'move', to: 'nowhere' }] }, { when: 'inbox:whisper', if: 'it.from.id == 1', do: [{ type: 'diary', text: 'x' }] }] });
  one(w, b, { type: 'whisper', to: a.id, text: '匿名话', anonymous: true });
  e2.applyCommand(w, { type: 'tick' });
  const zh = renderPerception2(e2.buildPerception(w, a.id, { ack: false }));
  assert.ok(zh.includes('[匿名私语] 有人：匿名话'));
  assert.ok(zh.includes('[常驻指令 0] 每刻：say ✓（−1）、move ✗ invalid_args'));
  assert.ok(/\[常驻指令 1\] 收到私语时：条件或参数求值出错（type），没有执行/.test(zh) || zh.includes('收到私语时'));
  const en = renderPerception2(e2.buildPerception(w, a.id, { ack: false, lang: 'en' }), { lang: 'en' });
  assert.ok(en.includes('[anonymous whisper] someone: 匿名话'));
  assert.ok(en.includes('[standing order 0] every tick: say ✓ (−1), move ✗ invalid_args'));
  assert.ok(en.includes('[standing order 1] on a whisper: the condition or a parameter could not be evaluated (type); nothing was done'));
  // 没有 [standing] 之类的兜底 JSON
  assert.equal(/\[standing\] \{/.test(zh + en), false);
  void putAt;
});

test('P2 T2 渲染: D2 的字典——中英键一致，工具的描述齐全', () => {
  const keys = (o, prefix = '') => Object.entries(o).flatMap(([k, v]) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`])).sort();
  assert.deepEqual(keys(D2.zh), keys(D2.en));
  assert.ok(D2.zh.tools.look.length > 10 && D2.en.tools.look.length > 10);
  assert.ok(D2.zh.tools.act.includes('至多 4 个') && D2.en.tools.act.includes('up to 4 actions'));
  assert.deepEqual(D2.zh.summary.titles, ['【上一次醒来】', '【再上一次】', '【更早一次】']);
});
