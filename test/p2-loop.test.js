// SPEC-P2 T7：工具循环（runner/loop.js 的 runWaking；mock 脚本，文本 JSON 与原生各一遍）。
// 城是真的（第二前提的 Runtime，进程内客户端），模型是脚本：每一轮回复写死，运行器的行为就可以逐项断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AGENT_LOOP, toolDefs } from '../runner/loop.js';
import { ProviderError } from '../runner/providers.js';
import { openCity, J, drive, lastUser, scripted } from './p2-loop-helpers.js';

const NATIVE = { toolMode: 'native' };
const call = (name, args) => ({ name, args });
const ACT_END = call('act', { actions: [], end: true });
const say = (text) => ({ type: 'say', text });

// ═══════════════════════════════════════════════════════════════
// 一次完整的醒来
// ═══════════════════════════════════════════════════════════════

test('P2 T7 原生：看两段、行动、再行动并结束——结果的文字、末尾一行、用量与轨迹的记录、世界里的效果', async () => {
  const city = openCity({ seed: 'native-tour' });
  try {
    const [a, b] = city.ids;
    city.exec(b, [{ type: 'whisper', to: a, text: '你好，甲' }]);
    const out = await drive(city, a, { cfg: NATIVE, script: [
      { calls: [call('look', { what: 'here' }), call('look', { what: 'laws' })] },
      { calls: [call('act', { thought: '回应一下', actions: [say('大家好')] })] },
      { calls: [call('act', { actions: [{ type: 'whisper', to: b, text: '你好，乙' }], end: true })] },
    ] });
    assert.deepEqual(out.result, { rounds: 1, acted: 2, stopped: 'maxRounds' });
    assert.equal(out.requests.length, 3);
    // 第一轮：概要（收件箱全文）；原生的 tools 是两个工具的中立定义
    const first = out.requests[0];
    assert.deepEqual(first.tools, toolDefs('zh'));
    assert.equal(first.transcript.length, 1);
    assert.ok(first.transcript[0].text.startsWith('【此刻】'));
    assert.ok(first.transcript[0].text.includes('【收件箱】') && first.transcript[0].text.includes('[私语] 乙：你好，甲'));
    assert.ok(!first.transcript[0].text.includes('【上一次醒来】'), '第一次醒来没有摘要');
    // 第二轮：助手的 raw 原样、两个 look 的结果各带自己的末尾一行（看的次数随各自的时刻）
    const second = out.requests[1].transcript;
    assert.deepEqual(second.map((m) => m.role), ['user', 'assistant', 'tool']);
    assert.deepEqual(second[2].results.map((r) => [r.id, r.name, r.isError]), [['m1_1', 'look', false], ['m1_2', 'look', false]]);
    assert.ok(second[2].results[0].text.startsWith('【看：here】'));
    assert.ok(second[2].results[0].text.endsWith('（本刻还能看 5 次；这次醒来还剩 3 轮）'));
    assert.ok(second[2].results[1].text.startsWith('【看：laws】'));
    assert.ok(second[2].results[1].text.endsWith('（本刻还能看 4 次；这次醒来还剩 3 轮）'));
    // 第三轮：act 的结果——逐项结果、此刻一行、末尾一行
    const act1 = out.requests[2].transcript.at(-1).results[0];
    assert.equal(act1.name, 'act');
    assert.match(act1.text, /^【行动的结果】\nsay ✓（−1）\n此刻：醒着，能量 \d+，旧币 \d+，本刻还可行动 3 次，在 港口 \[port\]。\n（本刻还能看 4 次；这次醒来还剩 2 轮）$/);
    // 轨迹：一条，不含文本
    assert.equal(out.wakings.length, 1);
    const { rec } = out.wakings[0];
    assert.deepEqual({ ...rec, ms: typeof rec.ms }, {
      tick: 0, kind: 'main', mode: 'native', turns: 3, looks: ['here', 'laws'], acts: [{ type: 'say', ok: true }, { type: 'whisper', ok: true }],
      ended: 'end', tokens: { in: 0, out: 0 }, ms: 'number',
    });
    assert.ok(!/回应一下|大家好|你好，乙|乙/.test(JSON.stringify(rec)), '轨迹里没有任何文本');
    // 用量：每轮一次，带 waking 与字符数（递增）
    assert.deepEqual(out.usage.map((u) => [u.ok, u.waking.turn, u.waking.kind, u.waking.tick]), [[true, 1, 'main', 0], [true, 2, 'main', 0], [true, 3, 'main', 0]]);
    assert.ok(out.usage[0].chars < out.usage[1].chars && out.usage[1].chars < out.usage[2].chars);
    assert.ok(out.usage.every((u) => u.agentId === a && Number.isFinite(u.ms) && u.replyChars > 0));
    // 世界里：说话与私语都发生了，能量被扣
    assert.ok(city.agent(b).inbox.some((i) => i.kind === 'whisper' && i.text === '你好，乙'));
    assert.ok(city.rt.events.since(0, 200).some((e) => e.type === 'say' && e.agent === a));
    assert.equal(city.agent(a).energy, 40 - 2);
  } finally {
    city.close();
  }
});

test('P2 T7 文本 JSON：看（数组）、行动、done——messages 是 user 与 assistant 交替的纯文本，回复原样；一条消息里的几个结果用空行隔开，末尾只一行', async () => {
  const city = openCity({ seed: 'json-tour' });
  try {
    const [a, b] = city.ids;
    city.exec(b, [{ type: 'whisper', to: a, text: '你好，甲' }]);
    const replies = [
      J({ look: [{ what: 'here' }, 'laws'] }),
      { text: `我先说一句话。\n\`\`\`json\n${JSON.stringify({ act: { thought: '回应一下', actions: [say('大家好')] } })}\n\`\`\`` },
      J({ done: true }),
    ];
    const out = await drive(city, a, { script: replies });
    assert.deepEqual(out.result, { rounds: 1, acted: 1, stopped: 'maxRounds' });
    assert.equal(out.requests.length, 3);
    const last = out.requests[2].messages;
    assert.deepEqual(last.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
    assert.equal(last[1].content, replies[0].text, '回复原样作为 assistant');
    assert.equal(last[3].content, replies[1].text);
    assert.ok(last[0].content.startsWith('【此刻】') && last[0].content.includes('[私语] 乙：你好，甲'));
    assert.match(last[2].content, /^【看：here】[\s\S]*\n\n【看：laws】[\s\S]*\n（本刻还能看 4 次；这次醒来还剩 3 轮）$/);
    assert.equal((last[2].content.match(/（本刻还能看/g) || []).length, 1, '末尾只有一行');
    assert.match(last[4].content, /^【行动的结果】\nsay ✓（−1）\n此刻：[^\n]+\n（本刻还能看 4 次；这次醒来还剩 2 轮）$/);
    const { rec } = out.wakings[0];
    assert.equal(rec.mode, 'json');
    assert.deepEqual([rec.turns, rec.ended, rec.looks, rec.acts], [3, 'end', ['here', 'laws'], [{ type: 'say', ok: true }]]);
    // 系统提示整次不变，原生与文本 JSON 的调用方式写进缓存键
    assert.ok(out.requests.every((r) => r.system === out.requests[0].system));
  } finally {
    city.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// 结束的原因
// ═══════════════════════════════════════════════════════════════

const endedOf = (out, i = 0) => out.wakings[i].rec.ended;

test('P2 T7 结束原因：end（act 的 end 与 done）、reply（原生时模型直接回复）、actions（名额用完）、turns（轮数用完）', async () => {
  const city = openCity({ seed: 'ends-1', loop: { turns: 2 } });
  try {
    const [a] = city.ids;
    // end：act 带 end（原生）
    let out = await drive(city, a, { cfg: NATIVE, script: [{ calls: [call('act', { actions: [say('一'), say('二')], end: true })] }] });
    assert.deepEqual([endedOf(out), out.wakings[0].rec.turns], ['end', 1]);
    // end 在本轮全部处理完之后才生效：同一轮里 end 之后的调用照样执行
    out = await drive(city, a, { cfg: NATIVE, script: [{ calls: [call('act', { actions: [], end: true }), call('look', { what: 'here' })] }] });
    assert.deepEqual([endedOf(out), out.wakings[0].rec.looks], ['end', ['here']]);
    // end：done（文本 JSON）
    out = await drive(city, a, { script: [J({ done: true })] });
    assert.deepEqual([endedOf(out), out.wakings[0].rec.turns], ['end', 1]);
    // reply：原生，模型只回了话
    out = await drive(city, a, { cfg: NATIVE, script: [{ text: '我什么也不做了。' }] });
    assert.deepEqual([endedOf(out), out.wakings[0].rec.turns, out.wakings[0].rec.acts], ['reply', 1, []]);
    // turns：两轮都只看
    out = await drive(city, a, { cfg: NATIVE, script: [{ calls: [call('look', { what: 'here' })] }, { calls: [call('look', { what: 'self' })] }, { calls: [call('look', { what: 'laws' })] }] });
    assert.deepEqual([endedOf(out), out.wakings[0].rec.turns, out.requests.length], ['turns', 2, 2]);
  } finally {
    city.close();
  }
  // actions：名额用完（4 个 say 之后 actionsLeft 为 0）
  const city2 = openCity({ seed: 'ends-1b' });
  try {
    const [a] = city2.ids;
    const out = await drive(city2, a, { script: [J({ act: { actions: [say('一'), say('二'), say('三'), say('四')] } }), J({ done: true })] });
    assert.deepEqual([endedOf(out), out.wakings[0].rec.turns, out.requests.length], ['actions', 1, 1]);
    assert.equal(out.wakings[0].rec.acts.length, 4);
  } finally {
    city2.close();
  }
});

test('P2 T7 结束原因：deadline（开始前已过截止；调用被刻点截断时带 cancelled；提供者不守超时时由运行器中止）、budget、error、refusal', async () => {
  const city = openCity({ seed: 'ends-2', loop: { marginSec: 1 } });
  try {
    const [a] = city.ids;
    // 开始前就过了截止：不调用模型，没有用量回报
    city.rt.nextTickAt = Date.now() + 500;
    let out = await drive(city, a, { script: [J({ done: true })] });
    assert.deepEqual([endedOf(out), out.wakings[0].rec.turns, out.requests.length, out.usage.length], ['deadline', 0, 0, 0]);
    // 截断：这一次调用的超时是离下一刻的剩余时间（至少 1 秒）；到时被截断算 cancelled，不算提供者的错
    city.rt.agentLoop = { ...city.rt.agentLoop, marginSec: 0 };
    city.rt.nextTickAt = Date.now() + 1300;
    const t0 = Date.now();
    out = await drive(city, a, { script: [{ delayMs: 20000, text: '慢' }] });
    assert.ok(Date.now() - t0 < 4000);
    assert.deepEqual([endedOf(out), out.wakings[0].rec.turns], ['deadline', 0]);
    assert.equal(out.requests[0].timeoutMs <= 1300 && out.requests[0].timeoutMs >= 1000, true, `超时 ${out.requests[0].timeoutMs}`);
    assert.deepEqual(out.usage.map((u) => [u.ok, u.cancelled === true, u.waking.turn]), [[false, true, 1]]);
    assert.ok(out.usage[0].error instanceof ProviderError && out.usage[0].error.timeout === true);
    // 线路自己的超时（剩余时间还很长）不是截断：算 error
    city.rt.nextTickAt = Date.now() + 600000;
    out = await drive(city, a, { cfg: { timeoutMs: 1000 }, script: [{ delayMs: 20000, text: '慢' }] });
    assert.deepEqual([endedOf(out), out.usage[0].cancelled, out.usage[0].ok], ['error', undefined, false]);
    assert.equal(out.requests[0].timeoutMs, 1000);
    // 提供者不守超时：1 秒之后由运行器中止，同样算 cancelled
    city.rt.nextTickAt = Date.now() + 1000;
    const stubborn = { name: 'stubborn', complete: (req) => new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new Error('被中止')))) };
    const t1 = Date.now();
    out = await drive(city, a, { inner: stubborn });
    assert.ok(Date.now() - t1 < 4000);
    assert.deepEqual([endedOf(out), out.usage[0].cancelled], ['deadline', true]);
    // budget：beforeModel 说不
    city.rt.nextTickAt = null;
    out = await drive(city, a, { script: [J({ done: true })], deps: { beforeModel: async () => false } });
    assert.deepEqual([endedOf(out), out.wakings[0].rec.turns, out.usage.length, out.requests.length], ['budget', 0, 0, 0]);
    // error：提供者出错（可重试的），记下是第几轮；下一次醒来的摘要写明中断
    out = await drive(city, a, { rounds: 2, script: [new ProviderError('线路不通', { retryable: true }), J({ done: true })] });
    assert.deepEqual(out.wakings.map((w) => [w.rec.ended, w.rec.turns]), [['error', 0], ['end', 1]]);
    assert.deepEqual(out.usage.map((u) => u.ok), [false, true]);
    assert.ok(lastUser(out.requests[1]).includes('【上一次醒来】'));
    assert.ok(lastUser(out.requests[1]).includes('（在第 1 轮中断）'));
    // refusal：模型拒绝
    out = await drive(city, a, { rounds: 2, script: [{ stop: 'refusal' }, J({ done: true })] });
    assert.deepEqual(out.wakings.map((w) => w.rec.ended), ['refusal', 'end']);
    assert.ok(lastUser(out.requests[1]).includes('（中断）'));
  } finally {
    city.close();
  }
});

test('P2 T7 结束原因：asleep、paused（act 之后重新感知看到）、format（文本 JSON 连续两轮无法解析）', async () => {
  const city = openCity({ seed: 'ends-3' });
  try {
    const [a] = city.ids;
    // asleep：模型思考的时候这位居民睡去了
    const sleeper = { name: 'sleeper', complete: async () => { city.agent(a).status = 'dormant'; city.agent(a).dormantSinceDay = 0; return J({ act: { actions: [say('x')] } }); } };
    let out = await drive(city, a, { inner: sleeper });
    assert.deepEqual([endedOf(out), out.wakings[0].rec.turns], ['asleep', 1]);
    city.agent(a).status = 'awake';
    // paused：时间静止
    const pauser = { name: 'pauser', complete: async () => { city.rt.w.paused = true; return J({ act: { actions: [say('x')] } }); } };
    out = await drive(city, a, { inner: pauser });
    assert.deepEqual([endedOf(out), out.wakings[0].rec.turns], ['paused', 1]);
    city.rt.w.paused = false;
    // format：两轮都没有 JSON；第一轮之后给格式错误的结果，算一轮
    out = await drive(city, a, { script: [{ text: '让我想想……' }, { text: '还在想。' }, J({ done: true })] });
    assert.deepEqual([endedOf(out), out.wakings[0].rec.turns, out.requests.length], ['format', 2, 2]);
    assert.equal(lastUser(out.requests[1]), '无法解析：每次只输出一个 JSON 对象，键为 look、act 或 done。\n（本刻还能看 6 次；这次醒来还剩 3 轮）');
    // 中间有一轮正常就不算连续：错、对、错 不结束
    out = await drive(city, a, { script: [{ text: '嗯' }, J({ look: { what: 'here' } }), { text: '嗯嗯' }, J({ done: true })] });
    assert.deepEqual([endedOf(out), out.wakings[0].rec.turns], ['end', 4]);
    // 解析出来了、但参数不合法，不算格式错误
    out = await drive(city, a, { script: [J({ look: 5 }), J({ look: 6 }), J({ done: true })] });
    assert.deepEqual([endedOf(out), out.wakings[0].rec.turns], ['end', 3]);
  } finally {
    city.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// look
// ═══════════════════════════════════════════════════════════════

test('P2 T7 look：次数按刻计、用完不报错；看全文并按 lookChars 截断；没有这一段、没有这一项、参数不合法、不认识的工具', async () => {
  const city = openCity({ seed: 'looks', loop: { looks: 3, lookChars: 400, turns: 8 } });
  try {
    const [a] = city.ids;
    const out = await drive(city, a, { cfg: NATIVE, script: [
      { calls: [call('look', { what: 'here' }), call('look', { what: 'bogus' }), call('look', { what: 'law', id: 'l99' })] },
      { calls: [call('look', { what: 'laws' })] }, // 第 4 次：次数用完
      { calls: [call('look', { what: 'places' })] }, // 同上
      { calls: [call('look', 5 === 5 ? null : {}), call('look', { what: 5 }), call('act', { actions: 'say' }), call('zzz', {})] },
      ACT_END_CALLS(),
    ] });
    const results = (k) => out.requests[k].transcript.at(-1).results;
    // 一轮里的三次看：这一段、没有这一段、没有这一项
    assert.ok(results(1)[0].text.startsWith('【看：here】'));
    assert.match(results(1)[1].text, /^没有这一段：bogus。可以看：here、self、laws、law、proposals、proposal、procedure、groups、group、residents、places、refounds、cradle、lexicon、petitions\n/);
    assert.match(results(1)[2].text, /^没有这一项：l99\n/);
    assert.deepEqual(results(1).map((r) => r.text.split('\n').at(-1)), ['（本刻还能看 2 次；这次醒来还剩 7 轮）', '（本刻还能看 1 次；这次醒来还剩 7 轮）', '（本刻还能看 0 次；这次醒来还剩 7 轮）']);
    // 用完了：不报错，只是告诉它
    assert.equal(results(2)[0].text, '本刻能看的次数用完了。\n（本刻还能看 0 次；这次醒来还剩 6 轮）');
    assert.equal(results(2)[0].isError, false);
    assert.equal(results(3)[0].text.startsWith('本刻能看的次数用完了。'), true);
    // 轨迹只记真的看了的（没有这一段、没有这一项也算看了，次数用完之后的不算）
    assert.deepEqual(out.wakings[0].rec.looks, ['here', 'bogus', 'law:l99']);
    // 参数不合法：look 没有对象、what 不是字符串；act 的 actions 不是数组；不认识的工具——都是错误的结果，算一轮、不结束
    const bad = results(4);
    assert.deepEqual(bad.map((r) => r.isError), [true, true, true, true]);
    assert.equal(bad[0].text.split('\n')[0], '参数不合法：参数必须是一个 JSON 对象');
    assert.equal(bad[1].text.split('\n')[0], '参数不合法：what 必须是字符串（id 若有也是字符串）');
    assert.equal(bad[2].text.split('\n')[0], '参数不合法：actions 必须是数组');
    assert.equal(bad[3].text.split('\n')[0], '没有这个工具：zzz');
    assert.equal(out.wakings[0].rec.ended, 'end');
  } finally {
    city.close();
  }
  // 截断：看的正文超过 lookChars 时截掉，并说明原长
  const city2 = openCity({ seed: 'looks-2', loop: { lookChars: 60 } });
  try {
    const [a] = city2.ids;
    const out = await drive(city2, a, { cfg: NATIVE, script: [{ calls: [call('look', { what: 'laws' })] }, ACT_END_CALLS()] });
    const text = out.requests[1].transcript.at(-1).results[0].text;
    assert.match(text, /（已截断，原长 \d+ 字符；用 id 看其中一项）\n（本刻还能看 5 次；这次醒来还剩 3 轮）$/);
    const full = text.split('\n（已截断')[0];
    assert.equal([...full].length, 60);
    // 同样的话在 lookChars 够大时不截断
    city2.rt.agentLoop = { ...city2.rt.agentLoop, lookChars: 8000 };
    const out2 = await drive(city2, a, { cfg: NATIVE, script: [{ calls: [call('look', { what: 'laws' })] }, ACT_END_CALLS()] });
    assert.ok(!out2.requests[1].transcript.at(-1).results[0].text.includes('已截断'));
  } finally {
    city2.close();
  }
});

function ACT_END_CALLS() {
  return { calls: [ACT_END] };
}

test('P2 T7 look：次数按刻归零（醒来之间换了一刻就重新计），英文居民的文字用英文', async () => {
  const city = openCity({ seed: 'looks-3', loop: { looks: 1 } });
  try {
    const [a] = city.ids;
    const out = await drive(city, a, { rounds: 2, cfg: NATIVE, after: () => city.rt.tickNow(), script: [
      { calls: [call('look', { what: 'here' }), call('look', { what: 'self' })] }, ACT_END_CALLS(),
      { calls: [call('look', { what: 'here' })] }, ACT_END_CALLS(),
    ] });
    const r1 = out.requests[1].transcript.at(-1).results;
    assert.ok(r1[0].text.startsWith('【看：here】'));
    assert.ok(r1[1].text.startsWith('本刻能看的次数用完了。'));
    const r2 = out.requests[3].transcript.at(-1).results;
    assert.ok(r2[0].text.startsWith('【看：here】'), '新的一刻，次数归零');
  } finally {
    city.close();
  }
  // 英文
  const en = openCity({ seed: 'looks-en', loop: { looks: 1 } });
  try {
    const [a] = en.ids;
    en.agent(a).lang = 'en';
    const out = await drive(en, a, { cfg: { ...NATIVE, lang: 'en' }, script: [
      { calls: [call('look', { what: 'here' }), call('look', { what: 'self' }), call('look', { what: 'nope' }), call('zzz', {}), call('act', { actions: [{ type: 'say', text: 'hi' }] })] },
      ACT_END_CALLS(),
    ] });
    const rs = out.requests[1].transcript.at(-1).results;
    assert.ok(rs[0].text.startsWith('[Look: here]'));
    assert.ok(rs[0].text.endsWith('(0 look(s) left this tick; 3 turn(s) left in this waking)'));
    assert.equal(rs[1].text.split('\n')[0], 'You have no looks left this tick.');
    assert.equal(rs[2].text.split('\n')[0], 'You have no looks left this tick.');
    assert.equal(rs[3].text.split('\n')[0], 'No such tool: zzz');
    assert.match(rs[4].text, /^\[Results\]\nsay ✓（−1）\nNow: awake, energy \d+, coins \d+, 3 action\(s\) left this tick, at .+ \[port\]\./);
    assert.deepEqual(out.requests[0].tools, toolDefs('en'));
    assert.ok(out.requests[0].transcript[0].text.startsWith('[Now]') || out.requests[0].transcript[0].text.length > 0);
  } finally {
    en.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// act：重新感知、新到的收件、移动、说明、失败
// ═══════════════════════════════════════════════════════════════

test('P2 T7 act：之后重新感知，新到的收件附在结果里（【新到的收件】）；move 成功之后有新地点的一行；动作的失败写在逐项的结果里', async () => {
  const city = openCity({ seed: 'act-rich', names: ['甲', '乙'] });
  try {
    const [a, b] = city.ids;
    const dest = (await city.client(a).me({ lang: 'zh' })).json.city.places.find((x) => x.id !== 'port').id;
    // 第二次模型调用之前，乙给甲递了话：它出现在甲下一次 act 的结果里
    const inner = await scripted([
      { calls: [call('look', { what: 'here' })] },
      { calls: [call('act', { actions: [say('先说一句')] })] },
      { calls: [call('act', { actions: [{ type: 'move', to: dest }, { type: 'propose', title: 'x', text: 'y' }], end: true })] },
    ]);
    let n = 0;
    const injecting = { name: 'inj', step: async (req) => {
      if (++n === 2) city.exec(b, [{ type: 'whisper', to: a, text: '递给你的话' }]);
      return inner.step(req);
    } };
    const out = await drive(city, a, { cfg: NATIVE, inner: injecting });
    const r2 = out.requests[2].transcript.at(-1).results[0].text;
    assert.match(r2, /^【行动的结果】\nsay ✓（−1）\n此刻：[^\n]+\n【新到的收件】\n  \[私语\] 乙：递给你的话\n（本刻还能看 5 次；这次醒来还剩 2 轮）$/);
    // 最后一次 act：end 之后不再调用模型；失败的项记在轨迹里
    assert.equal(out.requests.length, 3);
    assert.equal(out.wakings[0].rec.ended, 'end');
    assert.deepEqual(out.wakings[0].rec.acts.map((x) => [x.type, x.ok, x.error]), [['say', true, undefined], ['move', true, undefined], ['propose', false, 'forbidden']]);
    assert.ok(out.logs.some((l) => /^ {2}✗ propose forbidden/.test(l)));
  } finally {
    city.close();
  }
  // move 之后的那一条结果（这一轮 end 为假，下一轮的请求里能看到）
  const city2 = openCity({ seed: 'act-move', names: ['甲', '乙'] });
  try {
    const [a, b] = city2.ids;
    const places = (await city2.client(a).me({ lang: 'zh' })).json.city.places;
    const dest = places.find((x) => x.id !== 'port').id;
    city2.agent(b).place = dest; // 乙在目的地等着
    const out = await drive(city2, a, { cfg: NATIVE, script: [
      { calls: [call('act', { actions: [{ type: 'move', to: dest }] })] },
      ACT_END_CALLS(),
    ] });
    const text = out.requests[1].transcript.at(-1).results[0].text;
    assert.match(text, /^【行动的结果】\nmove ✓/);
    assert.match(text, new RegExp(`\\n【你到了】[^\\n]+ \\[${dest}\\][^\\n]*；在场：[^\\n]*乙\\(${b}\\)`));
    assert.ok(text.indexOf('此刻：') < text.indexOf('【你到了】'));
    assert.match(text, new RegExp(`此刻：醒着，能量 \\d+，旧币 \\d+，本刻还可行动 3 次，在 [^\\n]+ \\[${dest}\\]`));
  } finally {
    city2.close();
  }
});

test('P2 T7 act（F7）：缺 type 的动作被丢弃并说明；超出剩下名额的不执行；什么都不提交时不请求服务器；独白照旧随 act 提交，并进入下一次的摘要', async () => {
  // 缺 type 的（含 null）被丢弃，结果里有一句说明
  const city = openCity({ seed: 'act-notes' });
  try {
    const [a] = city.ids;
    const out = await drive(city, a, { cfg: NATIVE, script: [
      { calls: [call('act', { actions: [say('1'), { text: '没有 type' }, null] })] },
      ACT_END_CALLS(),
    ] });
    assert.match(out.requests[1].transcript.at(-1).results[0].text, /^【行动的结果】\nsay ✓（−1）\n有 2 个动作缺少 type，被丢弃了。\n此刻：醒着，能量 \d+，旧币 \d+，本刻还可行动 3 次/);
  } finally {
    city.close();
  }
  // 同一轮里的两个 act：第二个只剩 1 个名额，给了 3 个——只执行 1 个，之后名额用完、这次醒来结束（结果留在轨迹里）
  const city2 = openCity({ seed: 'act-notes-2' });
  try {
    const [a] = city2.ids;
    const out = await drive(city2, a, { cfg: NATIVE, script: [
      { calls: [call('act', { actions: [say('1'), say('2'), say('3')] }), call('act', { actions: [say('4'), say('5'), say('6')] })] },
      ACT_END_CALLS(),
    ] });
    assert.deepEqual(out.wakings[0].rec.acts.map((x) => x.type), ['say', 'say', 'say', 'say'], '多出来的没有执行');
    assert.deepEqual([out.wakings[0].rec.ended, out.requests.length], ['actions', 1]);
  } finally {
    city2.close();
  }
  // 什么都不提交：不请求服务器；只有独白的 act 提交了（独白随 act）
  const city3 = openCity({ seed: 'act-notes-3' });
  try {
    const [a] = city3.ids;
    const real = city3.client(a);
    let acts = 0;
    const counting = { ...real, act: async (req) => { acts++; return real.act(req); } };
    const out = await drive(city3, a, { cfg: NATIVE, deps: { client: counting }, script: [
      { calls: [call('act', { actions: [] })] },
      { calls: [call('act', { actions: [], thought: '只有独白', end: true })] },
    ] });
    assert.match(out.requests[1].transcript.at(-1).results[0].text, /^【行动的结果】\n（没有）\n此刻：/, '没有动作：（没有）');
    assert.equal(acts, 1, '空的 act 不请求服务器，只有独白的 act 请求了');
    assert.equal(out.wakings[0].rec.acts.length, 0);
    assert.equal(out.result.acted, 1);
    // 独白进入下一次醒来的摘要
    const out2 = await drive(city3, a, { rounds: 2, cfg: NATIVE, after: () => city3.rt.tickNow(), script: [
      { calls: [call('act', { thought: '我想去港口看看', actions: [say('嗯')], end: true })] },
      ACT_END_CALLS(),
    ] });
    assert.ok(lastUser(out2.requests[1]).includes('独白：我想去港口看看'));
  } finally {
    city3.close();
  }
});

test('P2 T7 act：请求失败时结果是「行动请求失败：{code}」，算一轮、不结束；401 停掉这位居民；重新感知失败时不写此刻一行', async () => {
  const city = openCity({ seed: 'act-fail' });
  try {
    const [a] = city.ids;
    const real = city.client(a);
    let n = 0;
    const flaky = { ...real, act: async (req) => (++n === 1 ? { ok: false, status: 429, json: { error: { code: 'rate_limited' } } } : n === 2 ? { ok: false, status: 0, json: null, error: 'timeout' } : real.act(req)) };
    const out = await drive(city, a, { cfg: NATIVE, deps: { client: flaky }, script: [
      { calls: [call('act', { actions: [say('一')] })] }, { calls: [call('act', { actions: [say('二')] })] }, { calls: [call('act', { actions: [say('三')], end: true })] },
    ] });
    assert.equal(out.requests[1].transcript.at(-1).results[0].text.split('\n')[0], '行动请求失败：rate_limited');
    assert.equal(out.requests[1].transcript.at(-1).results[0].isError, true);
    assert.equal(out.requests[2].transcript.at(-1).results[0].text.split('\n')[0], '行动请求失败：timeout');
    assert.deepEqual([out.wakings[0].rec.turns, out.wakings[0].rec.ended, out.wakings[0].rec.acts], [3, 'end', [{ type: 'say', ok: true }]]);
    assert.equal(out.result.acted, 1);
    // 401：停掉
    const denied = { ...real, act: async () => ({ ok: false, status: 401, json: { error: { code: 'unauthorized' } } }) };
    const out2 = await drive(city, a, { cfg: NATIVE, deps: { client: denied }, rounds: 5, script: [{ calls: [call('act', { actions: [say('x')] })] }] });
    assert.equal(out2.result.stopped, 'auth');
    assert.equal(out2.result.rounds, 1);
    assert.ok(out2.logs.some((l) => l.startsWith('ERR 认证失败')));
    // 重新感知失败：没有此刻一行，也没有新到的收件
    let meCalls = 0;
    const blind = { ...real, me: async (o) => (++meCalls >= 2 ? { ok: false, status: 0, json: null, error: 'down' } : real.me(o)) };
    const out3 = await drive(city, a, { cfg: NATIVE, deps: { client: blind }, script: [{ calls: [call('act', { actions: [say('y')] })] }, ACT_END_CALLS()] });
    assert.equal(out3.requests[1].transcript.at(-1).results[0].text, '【行动的结果】\nsay ✓（−1）\n（本刻还能看 6 次；这次醒来还剩 3 轮）');
    assert.ok(out3.logs.some((l) => l.startsWith('WARN 感知失败')));
  } finally {
    city.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// 游标：至少一次
// ═══════════════════════════════════════════════════════════════

test('P2 T7 游标：只推进到随成功的调用交出去的收件——第一轮就失败时不动；附在最后一个结果里却没有再调用模型的，下一次醒来再给', async () => {
  const city = openCity({ seed: 'cursor' });
  try {
    const [a, b] = city.ids;
    city.exec(b, [{ type: 'whisper', to: a, text: '第一句话' }]);
    // 第一次醒来：第一轮就失败；第二次醒来：成功交出，之后不再出现
    let out = await drive(city, a, { rounds: 3, cfg: NATIVE, after: () => city.rt.tickNow(), script: [
      new ProviderError('线路不通', { retryable: true }), ACT_END_CALLS(), ACT_END_CALLS(),
    ] });
    const inboxOf = (text) => (/【收件箱】\n([\s\S]*?)(?=\n【)/.exec(text) || [])[1] || '';
    const briefs = out.requests.map((r) => r.transcript[0].text);
    assert.ok(inboxOf(briefs[0]).includes('第一句话'));
    assert.ok(inboxOf(briefs[1]).includes('第一句话'), '第一轮失败：游标不动，再给一次');
    assert.ok(!inboxOf(briefs[2]).includes('第一句话'), '成功交出之后不再出现在收件箱里（摘要里还有）');
    assert.ok(briefs[2].includes('收到：') && briefs[2].includes('第一句话'), '摘要里有');
    // 附在最后一个结果里、没有再调用模型：下一次醒来再给
    const inner = await scripted([{ calls: [call('act', { actions: [say('我说话了')], end: true })] }, ACT_END_CALLS()]);
    let n = 0;
    const injecting = { name: 'inj', step: async (req) => { if (++n === 1) city.exec(b, [{ type: 'whisper', to: a, text: '第二句话' }]); return inner.step(req); } };
    out = await drive(city, a, { rounds: 2, cfg: NATIVE, inner: injecting, after: () => city.rt.tickNow() });
    // 第二句话在第一次醒来的 act 的结果里（新到的）；因为 end，没有再调用模型，所以没有交出去
    assert.equal(out.requests.length, 2);
    assert.ok(!out.requests[0].transcript[0].text.includes('第二句话'), '醒来时还没到');
    assert.ok(inboxOf(out.requests[1].transcript[0].text).includes('[私语] 乙：第二句话'), '第二次醒来的收件箱里：上一次没有交出去');
    // 摘要的「收到」只写交出去了的：第一次醒来里没有第二句话
    const summary = out.requests[1].transcript[0].text.split('【上一次醒来】')[1];
    assert.ok(!/收到：[^\n]*第二句话/.test(summary));
  } finally {
    city.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// 摘要与历史
// ═══════════════════════════════════════════════════════════════

test('P2 T7 摘要：收到、看了、做了、独白、结束原因；最近的标【上一次醒来】，再往前【再上一次】；historyRounds 是摘要的条数', async () => {
  const city = openCity({ seed: 'summary', names: ['甲', '乙'], loop: { turns: 3 } });
  try {
    const [a, b] = city.ids;
    const long = '这是一句相当长的话，'.repeat(12); // 超过 60 个字符
    const script = [
      { calls: [call('look', { what: 'here' }), call('act', { thought: '第一次的想法', actions: [say('第一次'), { type: 'propose', title: 't', text: 'x' }] })] },
      { calls: [call('look', { what: 'laws' })] },
      { calls: [call('look', { what: 'self' })] }, // 轮数用完
      { calls: [call('act', { actions: [say('第二次')], end: true })] },
      { calls: [call('act', { actions: [say('第三次')], end: true })] },
      ACT_END_CALLS(),
    ];
    const out = await drive(city, a, { rounds: 4, cfg: { ...NATIVE, historyRounds: 2 }, after: () => {
      city.rt.tickNow();
      if (city.rt.w.clock.tick === 1) city.exec(b, [{ type: 'whisper', to: a, text: long }]);
    }, script });
    const heads = out.requests.map((r) => r.transcript[0].text);
    // 第二次醒来（第 4 个请求之前的第一个 user）：只有一条摘要
    const second = heads.find((h) => h.includes('【上一次醒来】') && !h.includes('【再上一次】'));
    assert.ok(second);
    const s1 = second.split('【上一次醒来】')[1];
    assert.match(s1, /^第 1 月第 1 日第 1 刻\n/);
    assert.ok(s1.includes('  看了：here、laws、self'));
    assert.ok(s1.includes('  做了：say ✓（−1）、propose ✗ forbidden'));
    assert.ok(s1.includes('  独白：第一次的想法'));
    assert.ok(s1.includes('  （轮数用完）'));
    // 收到的话：截到 60 个字符
    const third = heads.find((h) => h.includes('【再上一次】'));
    assert.ok(third, '有两条摘要时：上一次与再上一次');
    assert.match(third, /【上一次醒来】第 1 月第 1 日第 2 刻\n  收到：[^\n]*\n[\s\S]*【再上一次】第 1 月第 1 日第 1 刻/);
    // historyRounds = 2：第四次醒来只有最近两条
    const fourth = heads.at(-1);
    assert.ok(fourth.includes('【上一次醒来】第 1 月第 1 日第 3 刻') && fourth.includes('【再上一次】第 1 月第 1 日第 2 刻'));
    assert.ok(!fourth.includes('第 1 月第 1 日第 1 刻') && !fourth.includes('【更早一次】'));
    // 收到里的话截到 60 个码点
    const got = /收到：[^\n]*/.exec(third)[0];
    assert.ok(got.includes('私语 来自 乙：'));
    assert.ok(!got.includes(long) && got.includes(long.slice(0, 60)) && !got.includes(long.slice(0, 61)));
  } finally {
    city.close();
  }
  // historyRounds = 3：三条依次是【上一次醒来】【再上一次】【更早一次】；0：没有摘要
  for (const [keep, expected] of [[3, ['【上一次醒来】', '【再上一次】', '【更早一次】']], [0, []], [1, ['【上一次醒来】']]]) {
    const c = openCity({ seed: `summary-${keep}` });
    try {
      const [a] = c.ids;
      const out = await drive(c, a, { rounds: 5, cfg: { ...NATIVE, historyRounds: keep }, after: () => c.rt.tickNow(), script: [
        { calls: [call('act', { actions: [say('a')], end: true })] }, { calls: [call('act', { actions: [say('b')], end: true })] },
        { calls: [call('act', { actions: [say('c')], end: true })] }, { calls: [call('act', { actions: [say('d')], end: true })] }, ACT_END_CALLS(),
      ] });
      const titles = [...out.requests.at(-1).transcript[0].text.matchAll(/【(上一次醒来|再上一次|更早一次)】/g)].map((m) => m[0]);
      assert.deepEqual(titles, expected, `historyRounds ${keep}`);
    } finally {
      c.close();
    }
  }
});

test('P2 T7 摘要：「失去的一刻」在【上一次醒来】的第一行；没有上一次（或 historyRounds 为 0）时单独成行；醒来之间没有错过就没有这句', async () => {
  const city = openCity({ seed: 'missed' });
  try {
    const [a] = city.ids;
    const step = { calls: [call('act', { actions: [say('在')], end: true })] };
    // 第 0 刻醒来，之后过了 3 刻：错过了 2 次
    let out = await drive(city, a, { rounds: 2, cfg: NATIVE, after: () => { for (let i = 0; i < 3; i++) city.rt.tickNow(); }, script: [step, step] });
    const brief = out.requests[1].transcript[0].text;
    assert.match(brief, /【上一次醒来】第 1 月第 \d+ 日第 \d+ 刻\n  你上一次醒来是第 1 月第 \d+ 日第 \d+ 刻；这中间你错过了 2 次醒来。\n/);
    // 连续的刻没有错过
    out = await drive(city, a, { rounds: 2, cfg: NATIVE, after: () => city.rt.tickNow(), script: [step, step] });
    assert.ok(!out.requests[1].transcript[0].text.includes('错过了'));
    // 没有摘要可挂（historyRounds 0）：单独成行，在概要的最后
    out = await drive(city, a, { rounds: 2, cfg: { ...NATIVE, historyRounds: 0 }, after: () => { for (let i = 0; i < 3; i++) city.rt.tickNow(); }, script: [step, step] });
    const alone = out.requests[1].transcript[0].text;
    assert.ok(!alone.includes('【上一次醒来】'));
    assert.match(alone, /\n你上一次醒来是第 1 月第 \d+ 日第 \d+ 刻；这中间你错过了 2 次醒来。$/);
    // 英文
    out = await drive(city, a, { rounds: 2, cfg: { ...NATIVE, lang: 'en' }, after: () => { for (let i = 0; i < 3; i++) city.rt.tickNow(); }, script: [step, step] });
    assert.match(out.requests[1].transcript[0].text, /\[Your last waking\]Month 1, day \d+, tick \d+\n  You last woke in month 1, day \d+, tick \d+; you have missed 2 waking\(s\) since then\./);
  } finally {
    city.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// 回报、失败、调用方式
// ═══════════════════════════════════════════════════════════════

test('P2 T7 回报：onUsage 每轮一次（含失败与截断），回报函数出错只记警告；onWaking 每次醒来一次且出错不影响运行；用量累加进轨迹', async () => {
  const city = openCity({ seed: 'report' });
  try {
    const [a] = city.ids;
    const inner = await scripted([
      { calls: [call('look', { what: 'here' })], usage: { input: 1000, output: 100 } },
      { calls: [call('act', { actions: [say('x')], end: true })], usage: { input: 1200, output: 50 } },
      { calls: [call('act', { actions: [], end: true })] },
    ]);
    let usageCalls = 0;
    const out = await drive(city, a, { rounds: 2, cfg: NATIVE, inner, after: () => city.rt.tickNow(), deps: {
      onUsage: () => { usageCalls++; throw new Error('回报出错也不能影响运行'); },
      onWaking: () => { throw new Error('轨迹出错也不能影响运行'); },
    } });
    assert.equal(usageCalls, 3);
    assert.equal(out.result.rounds, 2);
    assert.ok(out.logs.some((l) => l === 'WARN onUsage 出错（正文已省略）'));
    assert.ok(out.logs.every(l => !l.includes('回报出错也不能影响运行')));
    assert.ok(out.logs.some((l) => l === 'WARN onWaking 出错（正文已省略）'));
    assert.ok(out.logs.every(l => !l.includes('轨迹出错也不能影响运行')));
    // 轨迹：用量累加
    const out2 = await drive(city, a, { cfg: NATIVE, inner: await scripted([
      { calls: [call('look', { what: 'here' })], usage: { input: 1000, output: 100 } },
      { calls: [call('act', { actions: [], end: true })], usage: { input: 1200, output: 50 } },
    ]) });
    assert.deepEqual(out2.wakings[0].rec.tokens, { in: 2200, out: 150 });
    assert.deepEqual(out2.usage.map((u) => u.usage), [{ input: 1000, output: 100 }, { input: 1200, output: 50 }]);
    // 英文日志行里没有独白、没有令牌：日志只有一行用量
    assert.ok(out2.logs.some((l) => /^模型用时 [\d.]+ s · 输入 1000 · 输出 100 token · stop=tool_calls$/.test(l)));
  } finally {
    city.close();
  }
});

test('P2 T7 失败：致命的提供者错误停掉这位居民；被拒绝（非限速的 4xx）连续 5 次之后停；限速类的不计；成功一次就清零', async () => {
  const city = openCity({ seed: 'rejects' });
  try {
    const [a] = city.ids;
    // 致命：认证失败
    let out = await drive(city, a, { rounds: 5, script: [new ProviderError('认证失败', { fatal: true, status: 401 }), J({ done: true })] });
    assert.deepEqual(out.result, { rounds: 1, acted: 0, stopped: 'provider' });
    assert.deepEqual(out.wakings.map((w) => w.rec.ended), ['error']);
    assert.ok(out.logs.some((l) => l.startsWith('ERR auth HTTP 401 停止该 agent')));
    // 被拒绝 5 次（每次醒来一次调用）
    const rejected = () => new ProviderError('请求被拒绝（HTTP 400）', { retryable: false, status: 400 });
    out = await drive(city, a, { rounds: 20, after: () => city.rt.tickNow(), script: Array.from({ length: 20 }, rejected) });
    assert.deepEqual(out.result, { rounds: 5, acted: 0, stopped: 'provider' });
    assert.ok(out.logs.some((l) => l.includes('连续 5 次被服务商拒绝')));
    // 4 次被拒绝之后成功一次，再被拒绝 4 次：不停
    const script = [rejected(), rejected(), rejected(), rejected(), J({ done: true }), rejected(), rejected(), rejected(), rejected(), J({ done: true })];
    out = await drive(city, a, { rounds: 10, after: () => city.rt.tickNow(), script });
    assert.equal(out.result.stopped, 'maxRounds');
    // 限速（可重试）的不计
    out = await drive(city, a, { rounds: 8, after: () => city.rt.tickNow(), script: Array.from({ length: 8 }, () => new ProviderError('限速', { retryable: true, status: 429 })) });
    assert.equal(out.result.stopped, 'maxRounds');
  } finally {
    city.close();
  }
});

test('P2 T7 调用方式：配置要求原生而提供者没有 step 时改用文本 JSON，只警告一次；原生时带 tools，文本 JSON 时系统提示不同', async () => {
  const city = openCity({ seed: 'modes' });
  try {
    const [a] = city.ids;
    const completeOnly = { name: 'plain', complete: async () => J({ done: true }) };
    const out = await drive(city, a, { rounds: 3, cfg: NATIVE, inner: completeOnly, after: () => city.rt.tickNow() });
    assert.deepEqual(out.wakings.map((w) => w.rec.mode), ['json', 'json', 'json']);
    assert.equal(out.logs.filter((l) => l.startsWith('WARN 配置要求原生工具调用')).length, 1);
    assert.ok(out.requests.every((r) => r.messages && !r.tools));
    // 原生：mode 是 native，没有警告
    const out2 = await drive(city, a, { cfg: NATIVE, script: [{ calls: [ACT_END] }] });
    assert.equal(out2.wakings[0].rec.mode, 'native');
    assert.ok(!out2.logs.some((l) => l.startsWith('WARN 配置要求')));
    // 缺省（没有 toolMode）是文本 JSON，即使提供者有 step
    const out3 = await drive(city, a, { script: [J({ done: true })] });
    assert.equal(out3.wakings[0].rec.mode, 'json');
    assert.ok(out3.requests[0].messages);
    // 两种方式的系统提示不同（【怎样行动】一段；缓存键里有调用方式）
    assert.notEqual(out2.requests[0].system, out3.requests[0].system);
    assert.ok(out2.requests[0].system.includes('用 act 行动') && !out2.requests[0].system.includes('{\"act\"'));
    assert.ok(out3.requests[0].system.includes('{"act": {"thought"') && !out3.requests[0].system.includes('用 act 行动'));
  } finally {
    city.close();
  }
});

test('P2 T7 上限取自感知的 attention（没有时取缺省）；系统提示按语言、灵魂、调用方式缓存；第二前提以外的世界不进这条路径', async () => {
  const city = openCity({ seed: 'limits', loop: { turns: 3, looks: 1 } });
  try {
    const [a] = city.ids;
    const p = (await city.client(a).me({ lang: 'zh' })).json;
    assert.deepEqual(p.attention, { ...DEFAULT_AGENT_LOOP, turns: 3, looks: 1, marginSec: 0, debounceSec: 0 });
    const out = await drive(city, a, { cfg: NATIVE, script: [{ calls: [call('look', { what: 'here' })] }, { calls: [call('look', { what: 'self' })] }, { calls: [call('look', { what: 'laws' })] }, ACT_END_CALLS()] });
    assert.deepEqual([out.wakings[0].rec.turns, out.wakings[0].rec.ended], [3, 'turns']);
    // 第二轮的看：次数用完
    assert.ok(out.requests[2].transcript.at(-1).results[0].text.startsWith('本刻能看的次数用完了。'));
  } finally {
    city.close();
  }
  // 设定 1 的城：运行器走原来的路径（一刻一问），没有 attention，也没有 look
  const old = openCity({ seed: 'limits-old', premise: 1 });
  try {
    const [a] = old.ids;
    const out = await drive(old, a, { script: [{ text: '{"actions":[]}' }] });
    assert.equal(out.wakings.length, 0);
    assert.equal(out.requests.length, 1);
    assert.ok(out.requests[0].messages.at(-1).content.startsWith('【此刻】'));
    assert.ok(!out.requests[0].messages.at(-1).content.includes('【上一次醒来】'));
  } finally {
    old.close();
  }
});
