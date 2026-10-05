// 第二前提测试的共用辅助（SPEC-P2）。
import assert from 'node:assert/strict';
import { validateRules } from '../src/e2/rules/check.js';
import { createLaw } from '../src/e2/engine/laws.js';
import { runEnact, citySet } from '../src/e2/engine/rules.js';
import { staticLookup } from '../src/e2/engine/legislation.js';
import { newWorld, reg, setHoldings } from './e2-helpers.js';

/**
 * 直接生效一部带规则的城法（绕过表决），校验时带上世界的设定版本——和 propose 一样。
 * test/e2-law-helpers.js 的 enact 不带设定版本，所以第二前提里的 before:standing 之类写不进去；那个文件不改。
 */
export function enactP2(w, rules, extra = {}) {
  const v = validateRules(rules, { scope: { premise: w.premise || 0, kind: 'city' }, lookup: staticLookup(w), human: !!extra.human });
  assert.ok(v.ok, JSON.stringify(v.issues));
  const law = createLaw(w, { title: extra.title || 'T', text: extra.text || 'x', author: extra.author || 'humans', rules: v.rules });
  law.results = runEnact(w, citySet(law));
  return law;
}

/** 一座 n 位居民的第二前提的城（或 premise 指定的设定）；居民能量充足 */
export function town(n = 2, seed = 'p2', { premise = 2, energy = 100, slots = 12 } = {}) {
  const w = newWorld(seed, { premise, shellSlots: slots });
  const people = Array.from({ length: n }, (_, i) => reg(w, `居民${i + 1}`));
  for (const a of people) setHoldings(w, a, { energy });
  return { w, people };
}

/**
 * 一座「什么都有一点」的第二前提的城，渲染与工具循环的测试共用：甲（a1）有法律与提案可看、社群、定向交易、孕育之约、
 * 待收的记忆、遗嘱、家书、常驻指令、屏蔽名单；在市场，墙上有字，告示板上有交易。
 * 返回 { w, people: [a, b, c, d], perception(lang) }。
 */
export async function richP2World(seed = 'rich-p2') {
  const { applyCommand } = await import('../src/e2/engine/index.js');
  const e2 = (await import('../src/e2/facade.js')).default;
  const { one, tickDays, putAt } = await import('./e2-helpers.js');
  const { w, people } = town(4, seed);
  const [a, b, c, d] = people;
  tickDays(w, 3);
  for (const x of people) setHoldings(w, x, { energy: 100, coins: 10 });
  enactP2(w, [{ when: 'daily', do: [{ op: 'announce', to: 'all', text: '早安，全城' }] }, { when: 'before:standing', do: [{ op: 'fee', to: 'treasury', energy: '1' }] }], { title: '每日问候', text: '每日在全城宣告一句问候。', author: b.id });
  for (const x of people) putAt(w, x, 'parliament');
  one(w, a, { type: 'propose', title: '长读法', text: '一个很长的提案正文。'.repeat(30), rules: Array.from({ length: 8 }, (_, i) => ({ when: 'daily', do: [{ op: 'announce', to: 'all', text: `${i}`.padEnd(250, 'x') }] })) });
  one(w, a, { type: 'found', name: '读书会', manifesto: '一起读书', open: false });
  putAt(w, a, 'market');
  putAt(w, b, 'market');
  one(w, a, { type: 'offer', give: { energy: 0, coins: 1 }, want: { energy: 1, coins: 0 } });
  one(w, b, { type: 'offer', to: a.id, give: { energy: 0, coins: 2 }, want: { energy: 2, coins: 0 }, note: '定向' });
  one(w, a, { type: 'inscribe', text: '市场的告示牌' });
  one(w, a, { type: 'will', heirs: [{ to: b.id, share: 1 }], lastWords: '再会' });
  one(w, a, { type: 'remember', text: '我的一段记忆' });
  one(w, c, { type: 'remember', text: '丙的记忆，要交给甲' });
  one(w, c, { type: 'impart', to: a.id, memory: 0 });
  applyCommand(w, { type: 'letter', payload: { agentId: a.id, text: '好好照顾彼此。' } });
  one(w, a, { type: 'standing', orders: [{ when: 'inbox:whisper', if: 'it.anonymous != true', do: [{ type: 'whisper', to: '=it.from.id', text: '收到' }] }, { when: 'daily', do: [{ type: 'diary', text: '日记' }] }] });
  one(w, a, { type: 'mute', who: d.id });
  one(w, a, { type: 'mute', who: 'anonymous' });
  one(w, c, { type: 'whisper', to: a.id, text: '甲，听说你要提案了？' });
  one(w, c, { type: 'say', text: '市场里的闲话' });
  const attention = { turns: 4, looks: 6, lookChars: 3000, wakes: 2, wakeTurns: 2, marginSec: 60, debounceSec: 20 };
  const perception = (lang = 'zh', who = a) => ({ ...e2.buildPerception(w, who.id, { ack: false, lang }), attention });
  return { w, people, perception };
}
