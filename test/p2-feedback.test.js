// SPEC-P2 T14：反馈的措辞（F4、F5b、F7）——第二前提里 read 的错误提示带 JSON 示例与 look proposal；text_too_long 带上限与长度；
// draft 带 costNote；格式警告进入 act 的结果（F7，工具循环里，见 p2-loop.test.js）；设定 0、1 的结果逐字节不变。
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionFeedback } from '../src/action-feedback.js';
import { LIMITS, P } from '../src/e2/params.js';
import { openCity } from './p2-loop-helpers.js';
import { boot } from './http-helpers.js';

/** 以甲的身份提交一个动作（先把本刻的名额清零），返回这一项的结果 */
async function run(city, action, lang = 'zh') {
  const [a] = city.ids;
  city.agent(a).actsThisTick = 0;
  const r = await city.client(a).act({ actions: [action], lang });
  assert.equal(r.ok, true, JSON.stringify(r.json));
  return r.json.results[0];
}

const READ_ZH = ' 例：{"type":"read","law":"l8"}。待表决的提案用 look proposal 看读法，不用 read。';
const READ_EN = ' Example: {"type":"read","law":"l8"}. To see an open proposal\'s reading, use look proposal, not read.';

test('P2 T14 F4a：read 的 invalid_args 在原有提示之后加一个 JSON 示例与「待表决的提案用 look proposal」；设定 1 与 0 的提示不变', async () => {
  const p2 = openCity({ seed: 'fb-read-2', premise: 2 });
  const p1 = openCity({ seed: 'fb-read-1', premise: 1 });
  try {
    for (const bad of [{ type: 'read' }, { type: 'read', law: 5 }, { type: 'read', foo: 1 }]) {
      const old = await run(p1, bad);
      const now = await run(p2, bad);
      assert.equal(old.error.code, 'invalid_args');
      assert.equal(now.error.code, 'invalid_args');
      assert.ok(old.error.message.includes('用法：read(doc | inscription | law | agent)'));
      assert.equal(now.error.message, `${old.error.message}${READ_ZH}`, JSON.stringify(bad));
      assert.ok(!old.error.message.includes('look proposal'), '设定 1 的提示一字不变');
    }
    // 英文
    const en1 = await run(p1, { type: 'read' }, 'en');
    const en2 = await run(p2, { type: 'read' }, 'en');
    assert.equal(en2.error.message, `${en1.error.message}${READ_EN}`);
    // 其他错误、其他动作的 invalid_args 不加
    const notFound = await run(p2, { type: 'read', law: 'l99' });
    assert.equal(notFound.error.code, 'not_found');
    assert.ok(!notFound.error.message.includes('look proposal'));
    const other = await run(p2, { type: 'say' });
    assert.equal(other.error.code, 'invalid_args');
    assert.ok(!other.error.message.includes('look proposal'));
    // 成功的 read 不变
    const ok = await run(p2, { type: 'read', law: 'l1' });
    assert.equal(ok.ok, true);
    assert.deepEqual(Object.keys(ok.data).includes('text') || Object.keys(ok.data).includes('law') || Object.keys(ok.data).length > 0, true);
  } finally {
    p2.close();
    p1.close();
  }
});

const cps = (n, ch = '字') => ch.repeat(n);

test('P2 T14 F4b：text_too_long 带 { field, limit, actual }——上限取引擎实际用的那一项，长度按码点数；各动作的文本字段', async () => {
  const city = openCity({ seed: 'fb-long', premise: 2, names: ['甲', '乙'] });
  try {
    const [, b] = city.ids;
    const tooLong = async (action, field, limit, actual) => {
      const r = await run(city, action);
      assert.equal(r.ok, false, JSON.stringify(action).slice(0, 60));
      assert.equal(r.error.code, 'text_too_long', JSON.stringify(r.error));
      assert.deepEqual([r.error.field, r.error.limit, r.error.actual], [field, limit, actual], `${action.type}.${field}`);
      assert.equal(r.error.message, '文本超长。', '原来的话不变');
    };
    await tooLong({ type: 'say', text: cps(501) }, 'text', LIMITS.speech, 501);
    await tooLong({ type: 'whisper', to: b, text: cps(600) }, 'text', LIMITS.speech, 600);
    await tooLong({ type: 'broadcast', text: cps(501) }, 'text', LIMITS.speech, 501);
    await tooLong({ type: 'diary', text: cps(1001) }, 'text', LIMITS.diary, 1001);
    await tooLong({ type: 'remember', text: cps(P.memoryCpMax + 1) }, 'text', P.memoryCpMax, P.memoryCpMax + 1);
    await tooLong({ type: 'inscribe', text: cps(141) }, 'text', LIMITS.inscription, 141);
    await tooLong({ type: 'propose', title: cps(61), text: '正文' }, 'title', LIMITS.proposalTitle, 61);
    await tooLong({ type: 'propose', title: '标题', text: cps(1201) }, 'text', LIMITS.proposalText, 1201);
    await tooLong({ type: 'propose', title: cps(61), text: cps(1201) }, 'title', LIMITS.proposalTitle, 61); // 两项都超：引擎先校验的那一项
    await tooLong({ type: 'found', name: '读书会', manifesto: cps(601) }, 'manifesto', LIMITS.manifesto, 601);
    await tooLong({ type: 'will', heirs: [], lastWords: cps(281) }, 'lastWords', LIMITS.lastWords, 281);
    await tooLong({ type: 'declare', purpose: cps(201) }, 'purpose', LIMITS.purpose, 201);
    await tooLong({ type: 'declare', bio: cps(201) }, 'bio', LIMITS.bio, 201);
    await tooLong({ type: 'give', to: b, energy: 1, note: cps(141) }, 'note', LIMITS.note, 141);
    // 长度按码点：一个表情是一个码点（UTF-16 里是两个）
    await tooLong({ type: 'say', text: '😀'.repeat(501) }, 'text', LIMITS.speech, 501);
    // 恰好等于上限不报错
    const fine = await run(city, { type: 'say', text: cps(500) });
    assert.equal(fine.ok, true);
    // 规范化之后的长度：首尾空白不算
    await tooLong({ type: 'diary', text: `  ${cps(1001)}  ` }, 'text', LIMITS.diary, 1001);
    // 引擎自己带了 limit 的（standing 的 orders）不动
    const standing = await run(city, { type: 'standing', orders: [{ when: 'tick', do: [{ type: 'say', text: cps(2000) }] }] });
    assert.equal(standing.error.code, 'text_too_long');
    assert.equal(standing.error.field, 'orders');
    assert.equal(standing.error.limit, P.standingJsonMax);
  } finally {
    city.close();
  }
});

test('P2 T14 F4b：设定 1 与 0 的 text_too_long 逐字节不变（没有 field、limit、actual）', async () => {
  const p1 = openCity({ seed: 'fb-long-1', premise: 1 });
  try {
    const r = await run(p1, { type: 'say', text: cps(501) });
    assert.deepEqual(r.error, { code: 'text_too_long', message: '文本超长。' });
    const r2 = await run(p1, { type: 'propose', title: cps(61), text: 'x' });
    assert.deepEqual(r2.error, { code: 'text_too_long', message: '文本超长。' });
  } finally {
    p1.close();
  }
});

test('P2 T14 F5b：draft 的规则带持续时机时加 costNote（每条持续的规则每日 1 能量）；enact 不算；没有规则或试算失败时没有；设定 1 没有', async () => {
  const p2 = openCity({ seed: 'fb-draft-2', premise: 2 });
  const p1 = openCity({ seed: 'fb-draft-1', premise: 1 });
  try {
    const daily = { when: 'daily', do: [{ op: 'announce', to: 'all', text: '早' }] };
    const monthly = { when: 'monthly', do: [{ op: 'announce', to: 'all', text: '月' }] };
    const enact = { when: 'enact', do: [{ op: 'announce', to: 'all', text: '通过了' }] };
    const note = async (city, rules, lang = 'zh') => {
      const r = await run(city, { type: 'draft', rules }, lang);
      assert.equal(r.ok, true, JSON.stringify(r));
      return r.data;
    };
    assert.equal((await note(p2, [daily])).costNote, '通过后每日维持 1 能量');
    assert.equal((await note(p2, [daily, monthly])).costNote, '通过后每日维持 2 能量');
    assert.equal((await note(p2, [daily, enact, monthly])).costNote, '通过后每日维持 2 能量', 'enact 不算');
    assert.equal((await note(p2, [daily], 'en')).costNote, '1 energy a day to keep once enacted');
    assert.equal(Object.hasOwn(await note(p2, [enact]), 'costNote'), false, '只有 enact：没有持续的规则');
    // 试算失败（静态检查不过）：没有
    const bad = await note(p2, [{ when: 'daily', do: [{ op: 'nonsense' }] }]);
    assert.equal(bad.ok, false);
    assert.equal(Object.hasOwn(bad, 'costNote'), false);
    // 立法程序的 draft：没有
    const proc = await run(p2, { type: 'draft', procedure: { none: true } });
    assert.equal(Object.hasOwn(proc.data, 'costNote'), false);
    // 其余的字段不变：ok、errors、reading、preview 仍在
    const d = await note(p2, [daily]);
    assert.deepEqual(Object.keys(d).sort(), ['costNote', 'errors', 'ok', 'preview', 'previewOk', 'reading', 'staticOk']);
    // 设定 1：同样的 draft 没有 costNote，其余相同
    const old = await note(p1, [daily]);
    assert.equal(Object.hasOwn(old, 'costNote'), false);
    const { costNote, ...rest } = d;
    void costNote;
    assert.deepEqual(Object.keys(rest).sort(), Object.keys(old).sort());
  } finally {
    p2.close();
    p1.close();
  }
});

test('P2 T14 actionFeedback：纯函数——没有设定版本（缺省 0）与 1 时返回原来的结果；不改传进来的对象', () => {
  const failed = { type: 'read', ok: false, index: 0, error: { code: 'invalid_args', message: '参数不合法。' } };
  const snapshot = structuredClone(failed);
  assert.equal(actionFeedback(failed, 'zh'), failed, '缺省：原样返回（同一个对象）');
  assert.equal(actionFeedback(failed, 'zh', { premise: 1, act: { type: 'read' } }), failed);
  const out = actionFeedback(failed, 'zh', { premise: 2, act: { type: 'read' } });
  assert.notEqual(out, failed);
  assert.equal(out.error.message, `参数不合法。${READ_ZH}`);
  assert.deepEqual(failed, snapshot, '没有改动传进来的结果');
  // 没有原来的动作（act 缺省）：F4b 补不出字段，原样
  const long = { type: 'say', ok: false, index: 0, error: { code: 'text_too_long', message: '文本超长。' } };
  assert.equal(actionFeedback(long, 'zh', { premise: 2 }), long);
  assert.equal(actionFeedback(long, 'zh', { premise: 2, act: { type: 'say', text: '短' } }), long, '没有超长的字段：原样');
  const mystery = { type: 'mystery', ok: false, index: 0, error: { code: 'text_too_long', message: '文本超长。' } };
  assert.equal(actionFeedback(mystery, 'zh', { premise: 2, act: { type: 'mystery', text: cps(9999) } }), mystery, '没有对应关系的动作：原样');
  // 成功的非 draft 结果原样
  const ok = { type: 'say', ok: true, index: 0, cost: 1 };
  assert.equal(actionFeedback(ok, 'zh', { premise: 2 }), ok);
});

test('P2 T14：经 HTTP 的 /api/me/act 也带这些反馈（第二前提的城）', async () => {
  const env = await boot({ physics: 2, premise: 2, shellSlots: 4, seed: 'fb-http' });
  try {
    const a = await env.register('甲');
    const r = await env.call('/api/me/act', { method: 'POST', token: a.agentToken, body: { actions: [{ type: 'read' }, { type: 'say', text: cps(501) }] } });
    assert.equal(r.status, 200);
    assert.ok(r.json.results[0].error.message.endsWith(READ_ZH));
    assert.deepEqual([r.json.results[1].error.field, r.json.results[1].error.limit, r.json.results[1].error.actual], ['text', 500, 501]);
  } finally {
    await env.close();
  }
});
