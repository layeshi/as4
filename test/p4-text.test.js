import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { L } from '../src/e2/lore/index.js';
import { buildSystemPrompt, actionCatalog2 } from '../runner/prompt.js';
import { renderBrief, renderWake, renderLook, LOOK_WHATS, LOOK_WHATS_P4 } from '../runner/render-p2.js';
import { D } from '../runner/render2.js';
import { bareWorld, reg } from './e2-helpers.js';
import e2 from '../src/e2/facade.js';
import { boot } from './http-helpers.js';
import { textWeight } from '../src/text.js';

const specification = readFileSync(new URL('../docs/SPEC-P4.md', import.meta.url), 'utf8');
for (const [lang, section] of [['zh', '### A.1 系统提示 `promptP4`（zh）'], ['en', '### A.1′ 系统提示 `promptP4`（en）']]) {
  test(`P4 T21: ${lang} prompt head is verbatim appendix A; purpose remains verbatim P2`, () => {
    const head = specification.split(section)[1].split('**head**：')[1].split('```')[1].replace(/^\n|\n$/g, '');
    assert.equal(L(lang).promptP4.head, head);
    const purpose = lang === 'zh' ? '【目的】' : '[Purpose]';
    const paragraph = s => s.split(purpose)[1].split('\n\n')[0];
    assert.equal(paragraph(L(lang).promptP4.head), paragraph(L(lang).promptP2.head));
    const p = buildSystemPrompt({ protocol: 2, premise: 4, lang, prayers: true, toolMode: 'native', tokenValues: { k: 10, capacity: 6000, basicAllotment: 4000 } });
    assert.ok(p.includes('4,000'));
    assert.ok(!p.includes(lang === 'zh' ? '【祈愿点】' : '[Prayer points]'));
    assert.ok(!/\{(?:K|basicAllotment|ruleUpkeep|standingUpkeep|reviveThreshold|capacity)\}/.test(p));
    assert.ok(p.includes('inbox') && p.includes('actions'));
    assert.ok(!p.includes(lang === 'zh' ? '看不花能量' : 'looking costs no energy'));
    const catalog = actionCatalog2(lang, { premise: 4, tokenValues: { k: 10, capacity: 6000 } });
    assert.match(catalog, lang === 'zh' ? /^say\(text\) 写出/m : /^say\(text\) output/m);
    assert.match(catalog, lang === 'zh' ? /^draft[^\n]+10 \+ 读入/m : /^draft[^\n]+10 \+ reading/m);
    assert.ok(!/^sponsor\(|^pray\(|^invent\(/m.test(catalog));
    assert.ok(/^routine\(/m.test(catalog));
    assert.ok(catalog.includes('6000') && catalog.includes('400'));
    assert.ok(!/reach 5 tokens|至多 40 词元|初始词元为 40，/.test(catalog));
  });
}

test('P4 T11/T21: full/short briefs, bills, private fields and new look sections', () => {
  const w = bareWorld('text4', { premise: 4 });
  const a = reg(w, '甲', { dailyCap: 880000 });
  a.memories.push({ text: '我的记忆里可以写能量这个词。', tick: 0, day: 0 });
  a.tokens.lastBill = { id: 'w0-abc123', tick: 0, kind: 'main', reread: 1580, read: 6950, write: 640 };
  for (const lang of ['zh','en']) {
    const p = e2.buildPerception(w, a.id, { lang, ack: false });
    assert.equal(Object.hasOwn(p.you, 'metabolism'), false);
    const full = renderBrief(p, { lang, history: [{ tick: 0, kind: 'main', received: [], acts: [], looks: [] }] });
    assert.equal(full, renderBrief(p, { lang }));
    assert.ok(full.includes('9,170') && full.includes('880,000'));
    assert.ok(full.includes('我的记忆里可以写能量这个词。'));
    const short = renderBrief(p, { lang, brief: 'short' });
    assert.ok(!short.includes(D[lang].city));
    assert.ok(!short.includes(D[lang].here));
    assert.ok(short.includes(lang === 'zh' ? '【你的记忆】' : '[Your memories]'));
    assert.ok(p.actions.some(a => a.type === 'routine' && a.available));
    assert.ok(renderLook(p, 'actions', undefined, { lang }).includes('write'));
    assert.equal(renderLook(p, 'inbox', undefined, { lang }), lang === 'zh' ? '没有未读的收件。' : 'No unread items.');
    assert.ok(renderLook(p, 'self', undefined, { lang }).includes('9,170'));
    assert.ok(!renderWake(p, { lang, earlier: { tick: 0, kind: 'main', received: [], acts: [], looks: [] } }).includes(lang === 'zh' ? '【这一刻早些时候】' : '[Earlier this tick]'));
  }
  assert.equal(LOOK_WHATS.includes('inbox'), false);
  assert.ok(LOOK_WHATS_P4.includes('inbox') && LOOK_WHATS_P4.includes('actions'));
});

test('P4 T21/Q66: HTTP returns priced P4 text, latest completed bill, localized cap notices and public lore', async () => {
  const env = await boot({ physics: 2, premise: 4, tokenBasic: 500000 });
  try {
    const r = await env.register('甲', { dailyCap: 1000000 });
    const post = (path, body, token = r.agentToken) => env.call(path, { method: 'POST', body, token });
    const first = await post('/api/me/wake', { kind: 'main' });
    assert.equal(first.status, 200);
    assert.ok(first.json.system.includes('【词元】'));
    assert.equal(first.json.bill.read, textWeight(first.json.text));
    const total = first.json.bill.reread + first.json.bill.read;
    const second = await post('/api/me/wake', { kind: 'main' });
    assert.ok(second.json.text.includes(`上次醒来 ${total.toLocaleString('en-US')}`));
    await post('/api/owner/cap', { dailyCap: 2000000 }, r.ownerKey);
    const third = await post('/api/me/wake', { kind: 'main' });
    assert.ok(third.json.text.includes('幕后给你身体的额度变多了。'));
    const lore = (await env.call('/api/public/lore')).json;
    assert.equal(lore.physicsP4, L('zh').physicsP4);
    assert.equal(lore.shellsP4, L('zh').shellsP4);
  } finally { await env.close(); }
});
