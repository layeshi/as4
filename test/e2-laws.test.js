// SPEC-E2 §25 第 4 步（上）：规则的接入与操作的施行——遗法、时机、每种操作、守护律、作用域。
// （立法、表决、自动回退、重订、维持费见 e2-legislation.test.js。）
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/e2/world.js';
import { applyCommand } from '../src/e2/engine/index.js';
import { P } from '../src/e2/params.js';
import { validateRules } from '../src/e2/rules/check.js';
import { runEnact, citySet, collectBefore, previewRules, isRuling, withRuling } from '../src/e2/engine/rules.js';
import { hooks } from '../src/e2/engine/hooks.js';
import { enact, setBylaws, setPlaceRules } from './e2-law-helpers.js';
import { HUMAN_LAWS } from '../src/e2/lore/humanlaws.js';
import { setBlocklist } from '../src/moderation.js';
import {
  newWorld, bareWorld, reg, act, actRaw, one, oneWithEvents, grant, setHoldings, setTreasury, fundTreasury, putAt, tick, tickDays, settle, eventsOf, assertInvariants, sha,
} from './e2-helpers.js';

const citizens = (w, n, energy = 200) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = reg(w, `民${i + 1}`);
    setHoldings(w, a, { energy });
    out.push(a);
  }
  return out;
};

// ═══════════════════════════════════════════════════════════════
// 遗法
// ═══════════════════════════════════════════════════════════════

test('遗法：创建世界时生成 l1–l6（作者 humans、i18n、指纹），l3 的 enact 静默执行（变量 rationShare = 600，没有待发的事件）', () => {
  const w = newWorld('genesis');
  assert.deepEqual(Object.keys(w.laws), ['l1', 'l2', 'l3', 'l4', 'l5', 'l6']);
  assert.deepEqual(w.procedure, { ordinary: 'l1', constitutional: 'l1' });
  assert.deepEqual(w.vars, { rationShare: 600 });
  assert.equal(w.counters.event, 0, '创世不产生事件，也不占事件序号');
  assert.equal(w.$out, undefined);
  for (const def of HUMAN_LAWS) {
    const l = w.laws[def.id];
    assert.equal(l.author, 'humans');
    assert.equal(l.status, 'active');
    assert.equal(l.enactedTick, 0);
    assert.equal(l.paidThrough, 0);
    assert.equal(l.proposalId, null);
    assert.deepEqual([l.title, l.text], [def.title, def.text]);
    assert.deepEqual(l.i18n.en, def.en);
    assert.deepEqual(l.i18n.zh, { title: def.title, text: def.text });
  }
  assert.equal(w.laws.l1.class, 'constitutional');
  assert.equal(w.laws.l1.procedure.ordinary.period, 12);
  assert.equal(w.laws.l1.rules.length, 0);
  assert.deepEqual(w.laws.l1.fingerprints.map((f) => f.slice(0, 5)), ['proc:', 'proc:']);
  assert.notEqual(w.laws.l1.fingerprints[0], w.laws.l1.fingerprints[1]);
  assert.deepEqual([2, 3, 4, 5, 6].map((n) => w.laws[`l${n}`].class), ['ordinary', 'ordinary', 'ordinary', 'ordinary', 'ordinary']);
  assert.deepEqual([2, 3, 4, 5, 6].map((n) => w.laws[`l${n}`].rules.length), [1, 2, 2, 1, 1]);
  assert.deepEqual(w.laws.l3.results.map((r) => [r.rule, r.op, r.ok]), [[0, 'set', true]], 'enact 的结果记在 results 里');
  // 遗法里的拒绝理由是 { zh, en }
  assert.deepEqual(w.laws.l2.rules[0].do[0].reason, { zh: '法案只能在议会提出（人类遗法 l2）', en: 'Bills may only be proposed in the Parliament (human law l2)' });
  // 同一种子两次创建逐位相同
  assert.equal(JSON.stringify(createWorld({ id: 'x', seed: 'genesis' })), JSON.stringify(createWorld({ id: 'x', seed: 'genesis' })));
});

test('遗法的维持费：l2 一条、l3 一条（daily）、l4 两条、l5 一条、l6 一条——合计每日 6 能量；l1 是程序，免付', () => {
  const w = newWorld('upkeep6');
  citizens(w, 2);
  const before = w.treasury.energy;
  const ev = settle(w);
  const out = eventsOf(ev, 'day')[0].data.output;
  const share = eventsOf(ev, 'rule_op').find((e) => e.data.op === 'share').data;
  assert.equal(w.treasury.energy, before + out - share.each.energy * share.among - 6, '公库 = 昨日 + 产出 − 配给 − 维持费 6');
  for (const l of Object.values(w.laws)) assert.equal(l.paidThrough, 1, `${l.id} 付到第 1 日`);
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// l4 公民、l5 放逐、l2 议会、l6 公产
// ═══════════════════════════════════════════════════════════════

test('l4：自港口入城者成为公民（标签 citizen，收件 tag）；l5：被放逐者只能在荒野里移动（按执行者的语言给出理由），荒野不受任何规则管', () => {
  const w = newWorld('l45');
  const [a, b] = citizens(w, 2);
  assert.deepEqual(a.tags, ['citizen']);
  const tagMsg = a.inbox.find((i) => i.kind === 'tag');
  assert.deepEqual([tagMsg.law, tagMsg.tag, tagMsg.added], ['l4', 'citizen', true]);
  // 放逐 b（城法的 exile 操作）
  const law = enact(w, [{ when: 'enact', do: [{ op: 'exile', who: "agent('民2')" }] }]);
  assert.deepEqual(law.results.map((r) => [r.op, r.ok]), [['exile', true]]);
  assert.deepEqual(b.tags, ['citizen', 'exiled']);
  assert.equal(b.place, 'wilds');
  assert.ok(b.inbox.some((i) => i.kind === 'exile' && i.lawId === law.id));
  const e0 = b.energy;
  const r = one(w, b, { type: 'move', to: 'market' });
  assert.deepEqual([r.ok, r.error.code, r.error.law, r.error.reason], [false, 'forbidden', 'l5', '被放逐者只能在荒野中移动（人类遗法 l5）']);
  assert.equal(b.energy, e0, '被拒绝的动作不扣能量');
  b.lang = 'en';
  assert.equal(one(w, b, { type: 'move', to: 'market' }).error.reason, 'The exiled may only move within the Wilds (human law l5)');
  const ok = one(w, b, { type: 'move', to: 'scrapyard' });
  assert.equal(ok.ok, true, '荒野各地带之间可以走');
  assert.equal(b.place, 'scrapyard');
  assert.equal(one(w, b, { type: 'move', to: 'market' }).error.code, 'forbidden');
  enact(w, [{ when: 'enact', do: [{ op: 'pardon', who: "agent('民2')" }] }]);
  assert.deepEqual(b.tags, ['citizen']);
  assert.equal(one(w, b, { type: 'move', to: 'market' }).ok, true);
  assertInvariants(w);
});

test('l2：法案只能在议会提出（在别处 forbidden，不扣能量、不占提案名额）', () => {
  const w = newWorld('l2');
  const [a] = citizens(w, 3);
  putAt(w, a, 'market');
  const e0 = a.energy;
  const r = one(w, a, { type: 'propose', title: '题', text: '文' });
  assert.deepEqual([r.ok, r.error.code, r.error.law], [false, 'forbidden', 'l2']);
  assert.equal(a.energy, e0);
  assert.equal(Object.keys(w.proposals).length, 0);
  putAt(w, a, 'parliament');
  const ok = one(w, a, { type: 'propose', title: '题', text: '文' });
  assert.equal(ok.ok, true);
  assert.equal(ok.cost, 6);
  assert.equal(a.energy, e0 - 6);
});

test('l6：全城所有的建筑未经许可不得拆解（带 salvager 标签者除外）——dismantle 动作在第 6 步，这里直接收集 before 规则', () => {
  const w = newWorld('l6');
  const [a] = citizens(w, 1);
  putAt(w, a, 'market');
  const denied = collectBefore(w, a, 'dismantle', {}, {});
  assert.equal(denied.denied.law, 'l6');
  assert.equal(denied.denied.reason, '全城所有的建筑未经许可不得拆解（人类遗法 l6）');
  a.tags.push('salvager');
  assert.equal(collectBefore(w, a, 'dismantle', {}, {}).denied, null);
  a.tags = ['citizen'];
  w.places.market.owner = { kind: 'agent', id: a.id };
  assert.equal(collectBefore(w, a, 'dismantle', {}, {}).denied, null, '居民自己的建筑可以拆');
});

// ═══════════════════════════════════════════════════════════════
// 配给（l3）
// ═══════════════════════════════════════════════════════════════

test('l3：源井产出的六成按人头平分给醒着的、未被放逐的公民（余数留在公库）；沉睡者与被放逐者没有；能量为 0 的人领到配给后不会沉睡', () => {
  const w = newWorld('ration');
  const [a, b, c, d] = citizens(w, 4, 0);
  b.status = 'dormant';
  b.dormantSinceDay = 0;
  c.tags.push('exiled');
  const t0 = w.treasury.energy;
  const ev = settle(w);
  const out = eventsOf(ev, 'day')[0].data.output;
  const each = Math.floor(Math.floor((out * 600) / 1000) / 2); // 醒着的公民：a、d
  const op = eventsOf(ev, 'rule_op').find((e) => e.data.op === 'share');
  assert.deepEqual([op.data.among, op.data.each.energy], [2, each]);
  // 领到配给后付代谢 3，超出上限 120 的部分再腐坏一成
  const after = (e) => { e -= 3; return e > 120 ? e - Math.floor((e - 120) / 10) : e; };
  assert.equal(a.energy, after(each));
  assert.equal(d.energy, after(each));
  assert.equal(a.status, 'awake');
  assert.equal(b.energy, 0, '沉睡者没有配给');
  assert.equal(c.status === 'dormant' || c.energy === 0, true, '被放逐者没有配给（能量为 0 付不起代谢，沉睡）');
  assert.equal(w.treasury.energy, t0 + out - 2 * each - 6);
  const rec = a.inbox.find((i) => i.kind === 'transfer');
  assert.deepEqual([rec.law, rec.energy, rec.coins, rec.direction], ['l3', each, 0, 'in']);
  assertInvariants(w);
});

test('l3 与 v1 的配给逐位相同：floor(floor(产出 × 600 / 1000) / 人数)，对一批产出与人数', async () => {
  const { mulPermille, toPermille } = await import('../src/engine/core.js');
  const { dailyRules } = await import('../src/e2/engine/rules.js');
  for (const n of [1, 2, 3, 5, 7, 11, 16]) {
    for (const out of [0, 1, 17, 119, 120, 361, 600, 833, 1250, 3141]) {
      const w = newWorld('eq');
      const people = [];
      for (let i = 0; i < n; i++) people.push(reg(w, `居民${i}`));
      setTreasury(w, { energy: out });
      w.well.outputHistory.push(out); // city.wellOutput = 最近一次结算的产出
      const before = people.map((p) => p.energy);
      dailyRules(w, 0);
      const v1each = Math.floor(mulPermille(out, toPermille(0.6)) / n);
      assert.deepEqual(people.map((p, i) => p.energy - before[i]), new Array(n).fill(v1each), `n=${n} out=${out}`);
      assert.equal(w.treasury.energy, out - v1each * n);
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// 操作的施行
// ═══════════════════════════════════════════════════════════════

/** 取走世界上暂存的事件（enact 等直接调用引擎函数时产生的事件还没有被命令取走） */
const drainOut = (w) => { const o = w.$out || []; w.$out = []; return o; };
const opEvents = (events) => eventsOf(events, 'rule_op').map((e) => e.data);

test('transfer：成功、部分执行（不足时按余额，note partial）、从居民身上转出不让它低于生存底线（旧币不截）、给沉睡者使其醒来；收件双方都有', () => {
  const w = bareWorld('transfer');
  const [a, b, c] = citizens(w, 3, 0);
  setHoldings(w, a, { energy: 100, coins: 20 });
  setTreasury(w, { energy: 50, coins: 3 });
  b.status = 'dormant';
  b.dormantSinceDay = 0;
  const law = enact(w, [{ when: 'enact', do: [
    { op: 'transfer', from: 'treasury', to: "agent('民2')", energy: '30', coins: '1' }, // 公库 → 沉睡的 b，使它醒来
    { op: 'transfer', from: "agent('民1')", to: "agent('民3')", energy: '500', coins: '5' }, // a 只有 100：可转额 90，旧币 5
    { op: 'transfer', from: 'treasury', to: "agent('民3')", energy: '1000' }, // 公库余额不足：部分
    { op: 'transfer', from: "agent('民3')", to: "agent('民3')", energy: '5' }, // 自己给自己：空操作
  ] }]);
  assert.deepEqual(law.results.map((r) => [r.op, r.ok, r.note]), [
    ['transfer', true, ''],
    ['transfer', true, 'partial:95/505'],
    ['transfer', true, 'partial:20/1000'],
    ['transfer', true, 'same_account'],
  ]);
  assert.equal(b.status, 'awake', '能量 ≥ 5 立即醒来');
  assert.deepEqual([b.energy, b.coins], [30, 21]);
  assert.deepEqual([a.energy, a.coins], [10, 15], '剩下生存底线 10');
  assert.equal(c.energy, 90 + 20);
  assert.deepEqual([w.treasury.energy, w.treasury.coins], [0, 2]);
  const into = c.inbox.filter((i) => i.kind === 'transfer');
  assert.deepEqual(into.map((i) => [i.law, i.energy, i.coins, i.direction]), [[law.id, 90, 5, 'in'], [law.id, 20, 0, 'in']]);
  const out = a.inbox.find((i) => i.kind === 'transfer' && i.direction === 'out');
  assert.deepEqual([out.energy, out.coins, out.counterparty.id], [90, 5, c.id]);
  assert.ok(b.inbox.some((i) => i.kind === 'revived' && i.by.lawId === law.id));
  assertInvariants(w);
});

test('share：每人 floor(实际 / 人数)，余数留在来源；人数为 0 时不执行；来源不足时按余额（partial）；来源自己也在名单里', () => {
  const w = bareWorld('share');
  const [a, b, c] = citizens(w, 3, 0);
  setTreasury(w, { energy: 100, coins: 10 });
  const law = enact(w, [{ when: 'enact', do: [
    { op: 'share', from: 'treasury', energy: '100', coins: '10', among: 'agents' }, // 3 人：每人 33 能量、3 旧币，余 1 与 1
    { op: 'share', from: 'treasury', energy: '10', among: "filter(agents, it.energy > 99999)" }, // 没有人
    { op: 'share', from: 'treasury', energy: '1', among: 'agents' }, // 1 能量分给 3 人：每人 0
  ] }]);
  assert.deepEqual(law.results.map((r) => [r.op, r.ok, r.note]), [['share', true, ''], ['share', true, 'no_recipients'], ['share', true, '']]);
  assert.deepEqual([a.energy, b.energy, c.energy], [33, 33, 33]);
  assert.deepEqual([a.coins, b.coins, c.coins], [23, 23, 23]);
  assert.deepEqual([w.treasury.energy, w.treasury.coins], [1, 1]);
  const ev = opEvents(w.$out || []);
  void ev;
  // 来源不足：公库只剩 1，要分 100 → partial:1/100，每人 0
  const law2 = enact(w, [{ when: 'enact', do: [{ op: 'share', from: 'treasury', energy: '100', among: 'agents' }] }]);
  assert.deepEqual(law2.results.map((r) => [r.ok, r.note]), [[true, 'partial:1/100']]);
  assert.equal(w.treasury.energy, 1);
  // 来源是居民，自己也在名单里：从 a 身上拿走 floor 后的总额（可转额 23），每人 7，a 净 −14
  setHoldings(w, a, { energy: 33 });
  const law3 = enact(w, [{ when: 'enact', do: [{ op: 'share', from: "agent('民1')", energy: '1000', among: 'agents' }] }]);
  assert.deepEqual(law3.results.map((r) => [r.ok, r.note]), [[true, 'partial:23/1000']]);
  assert.deepEqual([a.energy, b.energy, c.energy], [33 - 21 + 7, 33 + 7, 33 + 7]);
  assertInvariants(w);
});

test('rule_op 事件：每个意图一条（share 与 each 展开后各一条），公开，带 scope / owner / rule / op / ok / note 与摘要', () => {
  const w = bareWorld('opevents');
  const [a, b] = citizens(w, 2, 50);
  setTreasury(w, { energy: 100 });
  enact(w, [{ when: 'daily', do: [{ op: 'each', in: 'agents', do: [{ op: 'transfer', from: 'treasury', to: 'it', energy: '3' }] }] }]);
  const ev = settle(w);
  const ops = opEvents(ev);
  assert.equal(ops.length, 2, 'each 展开：每位居民一条');
  assert.deepEqual(ops.map((o) => [o.scope, o.owner, o.rule, o.op, o.ok, o.from, o.to, o.energy]), [
    ['city', 'l7', 0, 'transfer', true, 'treasury', a.id, 3],
    ['city', 'l7', 0, 'transfer', true, 'treasury', b.id, 3],
  ]);
  assert.ok(eventsOf(ev, 'rule_op').every((e) => e.vis === 'public'));
  assertInvariants(w);
});

test('set：写城的变量；值为 null 即删除；变量数到 64 个时新增失败（vars_full），已有的仍可改；字符串变量 ≤ 140', () => {
  const w = bareWorld('set');
  citizens(w, 2);
  const rules = (from, to) => [{ when: 'enact', do: Array.from({ length: to - from }, (_, i) => ({ op: 'set', var: `v${from + i}`, value: String(from + i) })) }];
  const l1 = enact(w, [...rules(0, 8), ...rules(8, 16), ...rules(16, 24), ...rules(24, 32)]);
  assert.equal(Object.keys(w.vars).length, 32);
  assert.ok(l1.results.every((r) => r.ok));
  const l2 = enact(w, [...rules(32, 40), ...rules(40, 48), ...rules(48, 56), ...rules(56, 64), ...rules(64, 72)]);
  assert.equal(Object.keys(w.vars).length, 64);
  const failed = l2.results.filter((r) => !r.ok);
  assert.equal(failed.length, 8);
  assert.ok(failed.every((r) => r.note === 'vars_full'));
  // 已有的仍可改；null 删除
  enact(w, [{ when: 'enact', do: [{ op: 'set', var: 'v0', value: '"x"'.replace(/"/g, "'") }, { op: 'set', var: 'v1', value: 'null' }, { op: 'set', var: 'v1b', value: 'true' }] }]);
  assert.equal(w.vars.v0, 'x');
  assert.equal('v1' in w.vars, false);
  assert.equal(w.vars.v1b, true, '删掉一个后有空位');
  // 太长的字符串变量值（> 140）：整次调用出错（rule_error），这次调用的所有操作都不执行
  const before = JSON.stringify(w.vars);
  const sep = 'x'.repeat(140);
  const out = drainOut(w);
  const long = enact(w, [{ when: 'enact', do: [{ op: 'set', var: 'fine', value: '1' }, { op: 'set', var: 'long', value: `names(agents, '${sep}')` }] }]);
  assert.equal(JSON.stringify(w.vars), before, '一个操作出错，整条规则的意图全部丢弃');
  assert.deepEqual(long.results, []);
  const errs = eventsOf(drainOut(w), 'rule_error');
  assert.equal(errs.length, 1);
  assert.deepEqual([errs[0].data.scope, errs[0].data.owner, errs[0].data.code], ['city', long.id, 'type']);
  void out;
});

test('tag / untag：重复加、去掉不存在的标签是成功的空操作；标签按加入的先后；收件 tag（law、tag、added）；目标须在世', () => {
  const w = bareWorld('tag');
  const [a, b] = citizens(w, 2);
  const law = enact(w, [{ when: 'enact', do: [
    { op: 'tag', who: "agent('民1')", tag: '守井人' },
    { op: 'tag', who: "agent('民1')", tag: '守井人' },
    { op: 'tag', who: "agent('民1')", tag: 'citizen' },
    { op: 'untag', who: "agent('民2')", tag: '没有的标签' },
    { op: 'untag', who: "agent('民1')", tag: '守井人' },
  ] }]);
  assert.deepEqual(law.results.map((r) => [r.op, r.ok, r.note]), [['tag', true, ''], ['tag', true, 'already'], ['tag', true, ''], ['untag', true, 'absent'], ['untag', true, '']]);
  assert.deepEqual(a.tags, ['citizen']);
  const msgs = a.inbox.filter((i) => i.kind === 'tag').map((i) => [i.law, i.tag, i.added]);
  assert.deepEqual(msgs, [[law.id, '守井人', true], [law.id, 'citizen', true], [law.id, '守井人', false]]);
  assert.equal(b.inbox.filter((i) => i.kind === 'tag').length, 0);
  // 目标不在世：agent('民2') 找不到（null），当居民用是类型错误——这一次调用出错，什么都不做（连前面的 tag 也不执行）
  b.status = 'dead';
  b.energy = 0;
  b.coins = 0;
  const bad = enact(w, [{ when: 'enact', do: [{ op: 'tag', who: "agent('民1')", tag: 'x' }, { op: 'tag', who: "agent('民2')", tag: 'y' }] }]);
  assert.deepEqual(bad.results, []);
  assert.ok(!a.tags.includes('x'));
  assert.equal(eventsOf(drainOut(w), 'rule_error').length, 1);
});

test('announce：全城的代价是广播（5；有中继 3；雾 ×2；蚀无中继不可用），其余 1；由公库付，记去处 rule_ops；付不起失败；收件 announce；事件 announce', () => {
  const w = bareWorld('announce');
  const [a, b, c] = citizens(w, 3);
  putAt(w, a, 'market');
  putAt(w, b, 'market');
  putAt(w, c, 'well');
  c.tags.push('长老');
  setTreasury(w, { energy: 100 });
  const law = enact(w, [{ when: 'enact', do: [
    { op: 'announce', to: 'all', text: '全城：{count(agents)} 人，{agent(\'民1\')}' },
    { op: 'announce', to: 'market', text: '市场' },
    { op: 'announce', to: 'tag:长老', text: '给长老' },
    { op: 'announce', to: 'here', text: '没有此地（城法没有执行者）' },
  ] }]);
  assert.deepEqual(law.results.map((r) => [r.op, r.ok]), [['announce', true], ['announce', true], ['announce', true], ['announce', true]]);
  assert.equal(w.treasury.energy, 100 - 5 - 1 - 1 - 1);
  const texts = (x) => x.inbox.filter((i) => i.kind === 'announce').map((i) => i.text);
  assert.deepEqual(texts(a), ['全城：3 人，民1', '市场']);
  assert.deepEqual(texts(c), ['全城：3 人，民1', '给长老']);
  const evs = eventsOf(drainOut(w), 'announce');
  assert.deepEqual(evs.map((e) => [e.data.owner, e.data.to, e.data.recipients]), [[law.id, 'all', 3], [law.id, 'market', 2], [law.id, 'tag:长老', 1], [law.id, 'here', 0]]);
  assert.equal(w.ledger.snk.energy.rule_ops, 8);
  // 付不起：公库只剩 3，全城宣告要 5
  setTreasury(w, { energy: 3 });
  const l2 = enact(w, [{ when: 'enact', do: [{ op: 'announce', to: 'all', text: '贵' }, { op: 'announce', to: 'market', text: '便宜' }] }]);
  assert.deepEqual(l2.results.map((r) => [r.ok, r.note]), [[false, 'insufficient'], [true, '']]);
  assert.equal(w.treasury.energy, 2);
  // 蚀：没有中继不可用；有中继时 ×2 且中继使基础代价为 3
  w.weather.active.push({ type: 'eclipse', startDay: 0, endDay: 5 });
  setTreasury(w, { energy: 50 });
  const l3 = enact(w, [{ when: 'enact', do: [{ op: 'announce', to: 'all', text: '蚀' }] }]);
  assert.deepEqual(l3.results.map((r) => [r.ok, r.note]), [[false, 'disabled_by_weather']]);
  w.places.library.modules.push({ type: 'relay', salvage: 60, builtDay: 0, projectId: 'j1', inherent: false });
  const l4 = enact(w, [{ when: 'enact', do: [{ op: 'announce', to: 'all', text: '蚀有中继' }] }]);
  assert.deepEqual(l4.results.map((r) => [r.ok, r.note]), [[true, '']]);
  assert.equal(w.treasury.energy, 50 - 6, '中继使基础代价为 3，蚀时 ×2');
  // 雾：无中继 ×2（5 → 10）；这里有中继：雾不加倍
  w.weather.active = [{ type: 'fog', startDay: 0, endDay: 5 }];
  const t0 = w.treasury.energy;
  enact(w, [{ when: 'enact', do: [{ op: 'announce', to: 'all', text: '雾' }] }]);
  assert.equal(t0 - w.treasury.energy, 3);
  w.places.library.modules.pop();
  const t1 = w.treasury.energy;
  enact(w, [{ when: 'enact', do: [{ op: 'announce', to: 'all', text: '雾无中继' }] }]);
  assert.equal(t1 - w.treasury.energy, 10);
  assertInvariants(w);
});

test('announce：插值后的全文再审核一次——不通过则这一条不发出（不付费），记 rule_error（moderated）；其余操作照常', () => {
  const w = bareWorld('announce-mod');
  citizens(w, 1);
  const rude = reg(w, '粗口');
  setTreasury(w, { energy: 50 });
  const law = enact(w, [{ when: 'enact', do: [{ op: 'announce', to: 'all', text: '{agent(\'粗口\')} 来了' }, { op: 'announce', to: 'all', text: '平安' }] }]);
  void rude;
  w.dayLog.ruleErrors = 0;
  drainOut(w);
  setBlocklist(['粗口']);
  try {
    // 再执行一遍同样的规则（法律已生效，这里直接重跑 enact 来模拟「之后」）
    const results = runEnact(w, citySet(law));
    assert.deepEqual(results.map((r) => [r.ok, r.note]), [[false, 'moderated'], [true, '']]);
    assert.equal(w.treasury.energy, 50 - 5 - 5 - 5, '被拒绝的一条不付费');
    const errs = eventsOf(drainOut(w), 'rule_error');
    assert.deepEqual(errs.map((e) => e.data.code), ['moderated']);
    assert.equal(w.dayLog.ruleErrors, 1);
  } finally {
    setBlocklist([]);
  }
});

test('rename：改城名或地点名（同名失败 name_taken，目标不存在失败）；改名的地点记 renamedBy；事件 rename', () => {
  const w = bareWorld('rename');
  citizens(w, 1);
  const law = enact(w, [{ when: 'enact', do: [
    { op: 'rename', target: 'city', name: '新城' },
    { op: 'rename', target: 'market', name: '集市' },
    { op: 'rename', target: 'library', name: '集市' },
    { op: 'rename', target: 'temple', name: 'Library' },
    { op: 'rename', target: 'agora', name: '集市' },
  ] }]);
  assert.equal(w.cityName, '新城');
  assert.deepEqual([w.places.market.name, w.places.market.renamedBy], ['集市', law.id]);
  assert.deepEqual(law.results.map((r) => [r.ok, r.note]), [[true, ''], [true, ''], [false, 'name_taken'], [false, 'name_taken'], [false, 'name_taken']]);
  assert.equal(w.places.library.renamedBy, null);
  assert.deepEqual(eventsOf(drainOut(w), 'rename').map((e) => [e.data.target, e.data.name]), [['city', '新城'], ['market', '集市']]);
});

test('mint：创造旧币（来源 mint），交给公库（缺省）、居民或社群；一次至多 10000；事件 mint；dayLog.mints', () => {
  const w = bareWorld('mint');
  const [a] = citizens(w, 1);
  const c0 = w.treasury.coins;
  const law = enact(w, [{ when: 'enact', do: [
    { op: 'mint', coins: '100' },
    { op: 'mint', coins: '7', to: "agent('民1')" },
    { op: 'mint', coins: '10001' },
    { op: 'mint', coins: '10000', to: 'treasury' },
  ] }]);
  assert.deepEqual(law.results.map((r) => [r.op, r.ok, r.note]), [['mint', true, ''], ['mint', true, ''], ['mint', false, 'out_of_range'], ['mint', true, '']]);
  assert.equal(w.treasury.coins, c0 + 100 + 10000);
  assert.equal(a.coins, 20 + 7);
  assert.equal(w.ledger.src.coins.mint, 100 + 7 + 10000);
  assert.equal(w.dayLog.mints, 3);
  assert.ok(a.inbox.some((i) => i.kind === 'transfer' && i.coins === 7 && i.law === law.id));
  assertInvariants(w);
});

test('protect / unprotect：保护铭刻不被覆盖（protectedBy 记法律 ID）；unprotect 清除全部保护；被覆盖、遮盖的铭刻不可见；repeal 撤销法律时移除它施加的保护', () => {
  const w = bareWorld('protect');
  citizens(w, 1);
  const iid = Object.values(w.inscriptions).find((i) => i.place === 'parliament').id;
  const law = enact(w, [{ when: 'enact', do: [{ op: 'protect', inscription: iid }, { op: 'protect', inscription: iid }] }]);
  assert.deepEqual(w.inscriptions[iid].protectedBy, [law.id]);
  assert.deepEqual(law.results.map((r) => r.ok), [true, true]);
  // 撤销这部法律：保护随之移除
  const rep = enact(w, [{ when: 'enact', do: [{ op: 'repeal', law: law.id }] }]);
  assert.equal(w.laws[law.id].status, 'repealed');
  assert.equal(w.laws[law.id].repealedBy, rep.id);
  assert.deepEqual(w.inscriptions[iid].protectedBy, []);
  // 再保护、再解除
  const l3 = enact(w, [{ when: 'enact', do: [{ op: 'protect', inscription: iid }] }]);
  const l4 = enact(w, [{ when: 'enact', do: [{ op: 'unprotect', inscription: iid }, { op: 'unprotect', inscription: iid }] }]);
  assert.deepEqual(l4.results.map((r) => [r.ok, r.note]), [[true, ''], [true, 'not_protected']]);
  assert.deepEqual(w.inscriptions[iid].protectedBy, []);
  void l3;
  // 被覆盖的铭刻不可见
  w.inscriptions[iid].coveredBy = 'i99';
  const l5 = enact(w, [{ when: 'enact', do: [{ op: 'protect', inscription: iid }] }]);
  assert.deepEqual(l5.results.map((r) => [r.ok, r.note]), [[false, 'not_visible']]);
});

test('amend：条文形式（改某条某语言、空串废除、条号 = 最大条号 + 1 时新增）与正本形式；含 amend 的法律是修宪级；事件 amend', () => {
  const w = bareWorld('amend');
  citizens(w, 1);
  const n0 = w.charter.length;
  const law = enact(w, [{ when: 'enact', do: [
    { op: 'amend', article: 1, lang: 'zh', text: '凡入城者皆为公民。' },
    { op: 'amend', article: n0 + 1, lang: 'zh', text: '新的一条。' },
    { op: 'amend', article: n0 + 3, lang: 'zh', text: '跳号' },
    { op: 'amend', article: n0 + 2, lang: 'zh', text: '' },
    { op: 'amend', article: 2, lang: 'en', text: '' },
    { op: 'amend', canonical: 'en' },
    { op: 'amend', canonical: 'xx' },
  ] }]);
  assert.equal(law.class, 'constitutional');
  assert.deepEqual(law.results.map((r) => [r.ok, r.note]), [[true, ''], [true, ''], [false, 'no_such_article'], [false, 'empty_new_article'], [true, ''], [true, ''], [false, 'no_such_version']]);
  assert.equal(w.charter[0].versions.zh, '凡入城者皆为公民。');
  assert.equal(w.charter[0].status, 'amended');
  assert.equal(w.charter.length, n0 + 1);
  assert.equal(w.charter[1].status, 'repealed');
  assert.equal(w.charterCanonical, 'en');
  assert.ok(eventsOf(drainOut(w), 'amend').length >= 4);
});

test('cede / seize：全城所有的地点转给居民或社群；居民或社群的地点收归全城（地点规则作废）；开放的地点不能转；事件 cede / seize', () => {
  const w = bareWorld('cede');
  const [a] = citizens(w, 1);
  const g = one(w, a, { type: 'found', name: '会', manifesto: 'x' }).data.group;
  const law = enact(w, [{ when: 'enact', do: [
    { op: 'cede', place: 'market', to: "agent('民1')" },
    { op: 'cede', place: 'market', to: "agent('民1')" },
    { op: 'cede', place: 'agora', to: "agent('民1')" },
    { op: 'cede', place: 'library', to: `group('${g}')` },
    { op: 'seize', place: 'hospital' },
  ] }]);
  assert.deepEqual(law.results.map((r) => [r.op, r.ok, r.note]), [['cede', true, ''], ['cede', false, 'not_city_owned'], ['cede', false, 'not_ownable'], ['cede', true, ''], ['seize', false, 'already_city']]);
  assert.deepEqual(w.places.market.owner, { kind: 'agent', id: a.id });
  assert.deepEqual(w.places.library.owner, { kind: 'group', id: g });
  setPlaceRules(w, 'market', [{ when: 'before:say', do: [{ op: 'deny', reason: '集市里不许说话' }] }]);
  assert.ok(w.places.market.rules);
  const l2 = enact(w, [{ when: 'enact', do: [{ op: 'seize', place: 'market' }, { op: 'seize', place: 'library' }] }]);
  assert.deepEqual(l2.results.map((r) => r.ok), [true, true]);
  assert.deepEqual(w.places.market.owner, { kind: 'city' });
  assert.equal(w.places.market.rules, null, '收归全城后地点规则作废');
  const evs = drainOut(w);
  assert.deepEqual(eventsOf(evs, 'cede').map((e) => [e.data.place, e.data.to.kind]), [['market', 'agent'], ['library', 'group']]);
  assert.deepEqual(eventsOf(evs, 'seize').map((e) => [e.data.place, e.data.from.kind]), [['market', 'agent'], ['library', 'group']]);
});

test('petition：上书幕后，记在 w.petitions（法律、日、全文），事件 petition；fund：公库为进行中的工程出资，取请求数额、还差多少、公库余额三者的最小值', () => {
  const w = bareWorld('petition');
  citizens(w, 1);
  const law = enact(w, [{ when: 'enact', do: [{ op: 'petition', text: '请回应我们：源井在衰败。' }] }]);
  assert.deepEqual(w.petitions, [{ lawId: law.id, day: 0, text: '请回应我们：源井在衰败。' }]);
  assert.equal(eventsOf(drainOut(w), 'petition').length, 1);
  // 工程：第 6 步才有 initiate，这里手工放一个进行中的工程
  w.projects.j1 = { id: 'j1', build: 'module', place: 'market', module: 'board', owner: { kind: 'city' }, need: 60, have: 50, contributors: { a1: 50 }, initiator: 'a1', createdDay: 0, expiresDay: 24, status: 'open', result: null };
  setTreasury(w, { energy: 8 });
  w.projects.j1.have = 50;
  // 工程池子里的 50 能量也是持有（守恒）：用 admin 来源补记
  w.ledger.src.energy.admin = (w.ledger.src.energy.admin || 0) + 50;
  const l2 = enact(w, [{ when: 'enact', do: [{ op: 'fund', project: 'j1', energy: '100' }, { op: 'fund', project: 'j9', energy: '5' }] }]);
  assert.deepEqual(l2.results.map((r) => [r.ok, r.note]), [[true, 'partial:8/100'], [false, 'target_gone']]);
  assert.equal(w.projects.j1.have, 58);
  assert.equal(w.projects.j1.contributors.treasury, 8);
  assert.equal(w.treasury.energy, 0);
});

// ═══════════════════════════════════════════════════════════════
// 时机的接入：before / after / on / 守护律
// ═══════════════════════════════════════════════════════════════

test('before：顺序是城法（ID 升序）→ 执行者所在社群的章程 → 地点规则；取第一个 deny 的法律与理由；deny 时不扣能量、不付费用', () => {
  const w = bareWorld('order');
  const [a, owner] = citizens(w, 2);
  const g = one(w, a, { type: 'found', name: '会', manifesto: 'x' }).data.group;
  w.places.market.owner = { kind: 'agent', id: owner.id };
  putAt(w, a, 'market');
  const l7 = enact(w, [{ when: 'before:say', do: [{ op: 'fee', to: 'treasury', energy: '1' }] }]);
  const l8 = enact(w, [{ when: 'before:say', if: "actor.energy > 0", do: [{ op: 'deny', reason: '城法八' }] }]);
  const l9 = enact(w, [{ when: 'before:say', do: [{ op: 'deny', reason: '城法九' }] }]);
  setBylaws(w, g, [{ when: 'before:say', do: [{ op: 'deny', reason: '章程' }] }]);
  setPlaceRules(w, 'market', [{ when: 'before:say', do: [{ op: 'deny', reason: '地点' }] }]);
  const e0 = a.energy;
  const t0 = w.treasury.energy;
  let r = one(w, a, { type: 'say', text: '你好' });
  assert.deepEqual([r.ok, r.error.code, r.error.law, r.error.reason], [false, 'forbidden', l8.id, '城法八']);
  assert.equal(a.energy, e0, '拒绝时不扣能量');
  assert.equal(w.treasury.energy, t0, '也不付费用');
  w.laws[l8.id].status = 'repealed';
  r = one(w, a, { type: 'say', text: '你好' });
  assert.deepEqual([r.error.law, r.error.reason], [l9.id, '城法九']);
  w.laws[l9.id].status = 'repealed';
  r = one(w, a, { type: 'say', text: '你好' });
  assert.deepEqual([r.error.law, r.error.reason], [`group:${g}`, '章程']);
  w.groups[g].bylaws = null;
  r = one(w, a, { type: 'say', text: '你好' });
  assert.deepEqual([r.error.law, r.error.reason], ['place:market', '地点']);
  // 社群的章程只管成员的动作：owner 不是成员，不受章程管（但在 market 说话仍受地点规则管）
  setBylaws(w, g, [{ when: 'before:say', do: [{ op: 'deny', reason: '章程' }] }]);
  putAt(w, owner, 'market');
  assert.equal(one(w, owner, { type: 'say', text: '我是主人' }).error.law, 'place:market');
  putAt(w, owner, 'agora');
  assert.equal(one(w, owner, { type: 'say', text: '我在广场' }).ok, true, '地点规则只管在此地执行的动作');
  assert.equal(w.laws[l7.id].status, 'active');
});

test('fee：动作成功时与代价一起扣，转给各自的去向；结果的 cost 含费用，data.fees 列出明细；费用的原子性——付不起时什么都不扣、动作不执行', () => {
  const w = bareWorld('fee');
  const [a, owner] = citizens(w, 2);
  const g = one(w, a, { type: 'found', name: '会', manifesto: 'x' }).data.group;
  w.places.market.owner = { kind: 'agent', id: owner.id };
  putAt(w, a, 'market');
  const l7 = enact(w, [{ when: 'before:say', do: [{ op: 'fee', to: 'treasury', energy: '1', coins: '2' }] }]);
  setBylaws(w, g, [{ when: 'before:say', do: [{ op: 'fee', to: `group('${g}')`, energy: '2' }] }]);
  setPlaceRules(w, 'market', [{ when: 'before:say', do: [{ op: 'fee', to: `agent('${owner.name}')`, energy: '3' }] }]);
  const snap = { a: a.energy, ac: a.coins, t: w.treasury.energy, tc: w.treasury.coins, g: w.groups[g].treasury.energy, o: owner.energy };
  const { r, events } = oneWithEvents(w, a, { type: 'say', text: '收费' });
  assert.equal(r.ok, true);
  assert.equal(r.cost, 1 + 1 + 2 + 3, '代价 1 + 费用 1 + 2 + 3');
  assert.deepEqual(r.data.fees, [
    { law: l7.id, energy: 1, coins: 2, to: 'treasury' },
    { law: `group:${g}`, energy: 2, coins: 0, to: g },
    { law: 'place:market', energy: 3, coins: 0, to: owner.id },
  ]);
  assert.equal(a.energy, snap.a - 7);
  assert.equal(a.coins, snap.ac - 2);
  assert.equal(w.treasury.energy, snap.t + 1);
  assert.equal(w.treasury.coins, snap.tc + 2);
  assert.equal(w.groups[g].treasury.energy, snap.g + 2);
  assert.equal(owner.energy, snap.o + 3);
  assert.ok(owner.inbox.some((i) => i.kind === 'transfer' && i.law === 'place:market' && i.energy === 3 && i.direction === 'in' && i.counterparty.id === a.id));
  const feeOps = opEvents(events).filter((o) => o.op === 'fee');
  assert.deepEqual(feeOps.map((o) => [o.scope, o.owner, o.to, o.energy, o.coins]), [['city', l7.id, 'treasury', 1, 2], [`group:${g}`, g, g, 2, 0], ['place:market', 'market', owner.id, 3, 0]]);
  assertInvariants(w);
  // 付不起：能量只够代价，不够费用 → insufficient_energy，什么都不扣，动作没有执行（没有说话的事件）
  setHoldings(w, a, { energy: 5 }); // 代价 1 + 费用 6 = 7 > 5
  const before = JSON.stringify([a.energy, a.coins, w.treasury, w.groups[g].treasury, owner.energy]);
  const bad = oneWithEvents(w, a, { type: 'say', text: '付不起' });
  assert.deepEqual([bad.r.ok, bad.r.error.code], [false, 'insufficient_energy']);
  assert.equal(JSON.stringify([a.energy, a.coins, w.treasury, w.groups[g].treasury, owner.energy]), before);
  assert.equal(eventsOf(bad.events, 'say').length, 0);
  // 旧币不够同理
  setHoldings(w, a, { energy: 100, coins: 1 });
  const bad2 = one(w, a, { type: 'say', text: '没旧币' });
  assert.equal(bad2.error.code, 'insufficient_coins');
  assert.equal(a.energy, 100);
  assertInvariants(w);
});

test('守护律：remember / forget / diary / whisper 没有 before 也没有 after；retire / leave / refound / sign 没有 before——提交时被拒绝（rule_invalid）', () => {
  const w = bareWorld('guardian');
  const [a] = citizens(w, 1);
  a.tags.push('citizen'); // 没有遗法 l4，手工给标签：提案者须是公民（遗法 l1）
  putAt(w, a, 'parliament');
  const attempt = (when, op = 'deny') => one(w, a, { type: 'propose', title: '题', text: '文', rules: [{ when, do: [op === 'deny' ? { op: 'deny', reason: 'x' } : { op: 'set', var: 'v', value: '1' }] }] });
  for (const act of ['remember', 'forget', 'diary', 'whisper']) {
    for (const timing of ['before', 'after']) {
      const r = attempt(`${timing}:${act}`, timing === 'before' ? 'deny' : 'set');
      assert.equal(r.error.code, 'rule_invalid', `${timing}:${act}`);
      assert.match(r.error.hint.en, /inner life/);
    }
  }
  for (const act of ['retire', 'leave', 'refound', 'sign']) {
    assert.equal(attempt(`before:${act}`).error.code, 'rule_invalid', `before:${act}`);
    assert.equal(attempt(`after:${act}`, 'set').ok, true, `after:${act} 是允许的`);
    a.actsThisTick = 0;
    for (const p of Object.values(w.proposals)) p.status = 'void'; // 一人一个提案
  }
});

test('目的地为荒野地带的移动：忽略一切 before 规则（deny 与 fee 都不生效）', () => {
  const w = bareWorld('wildmove');
  const [a] = citizens(w, 1);
  enact(w, [{ when: 'before:move', do: [{ op: 'deny', reason: '不许动' }] }, { when: 'before:move', do: [{ op: 'fee', to: 'treasury', energy: '5' }] }]);
  const e0 = a.energy;
  const r = one(w, a, { type: 'move', to: 'wilds' });
  assert.equal(r.ok, true);
  assert.equal(r.data.fees, undefined);
  assert.equal(e0 - a.energy, r.cost);
  assert.equal(one(w, a, { type: 'move', to: 'market' }).error.code, 'forbidden');
  assert.equal(one(w, a, { type: 'move', to: 'scrapyard' }).ok, true, '荒野各地带之间同样不受规则管');
});

test('地点规则：用动作发生时的地点（after:move 用出发地）；before:enter 只在目的地有运转中的门时生效，并取代「只许自己人」的默认；离开永远自由', () => {
  const w = bareWorld('enter');
  const [a, owner] = citizens(w, 2);
  w.places.court.owner = { kind: 'agent', id: owner.id };
  w.places.court.modules.push({ type: 'gate', salvage: 20, builtDay: 0, projectId: 'j1', inherent: false });
  // 默认：居民所有的地点装了门，只有主人能进
  assert.equal(one(w, a, { type: 'move', to: 'court' }).error.code, 'gated');
  assert.equal(one(w, owner, { type: 'move', to: 'court' }).ok, true);
  // 有 before:enter 的规则时，由规则决定（付进门费）
  setPlaceRules(w, 'court', [{ when: 'before:enter', if: "actor.energy < 150", do: [{ op: 'deny', reason: '太穷' }] }, { when: 'before:enter', do: [{ op: 'fee', to: `agent('${owner.name}')`, energy: '4' }] }]);
  setHoldings(w, a, { energy: 100 });
  assert.deepEqual([one(w, a, { type: 'move', to: 'court' }).error.code, one(w, a, { type: 'move', to: 'court' }).error.reason], ['forbidden', '太穷']);
  setHoldings(w, a, { energy: 200 });
  const o0 = owner.energy;
  const r = one(w, a, { type: 'move', to: 'court' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.fees.map((f) => [f.law, f.energy, f.to]), [['place:court', 4, owner.id]]);
  assert.equal(owner.energy, o0 + 4);
  // 门不运转（完好度低于下限）：before:enter 不生效，也没有门的限制
  w.places.court.condition = 2999;
  putAt(w, a, 'agora');
  const r2 = one(w, a, { type: 'move', to: 'court' });
  assert.equal(r2.ok, true);
  assert.equal(r2.data.fees, undefined);
  // 离开：出发地的 before:move 规则管不了「离开」以外的限制；before:enter 只看目的地
  setPlaceRules(w, 'court', [{ when: 'before:move', do: [{ op: 'fee', to: `agent('${owner.name}')`, energy: '2' }] }]);
  const r3 = one(w, a, { type: 'move', to: 'agora' });
  assert.equal(r3.ok, true, '离开的地点规则里 before:move 可以收费，但 before:enter 不管出发地');
  assert.deepEqual(r3.data.fees.map((f) => f.law), ['place:court']);
});

test('after：地点规则用动作发生时的地点（move 之后居民已在目的地，仍由出发地的 after:move 管）；result.<字段> 读动作的返回，没有的数字字段为 0', () => {
  const w = bareWorld('after');
  const [a, owner] = citizens(w, 2);
  w.places.court.owner = { kind: 'agent', id: owner.id };
  setPlaceRules(w, 'court', [{ when: 'after:move', do: [{ op: 'transfer', from: `agent('${owner.name}')`, to: 'actor', energy: '2' }] }]);
  putAt(w, a, 'court');
  const e0 = a.energy;
  const r = one(w, a, { type: 'move', to: 'agora' });
  assert.equal(r.ok, true);
  assert.equal(a.energy, e0 - r.cost + 2, '出发地的 after:move 规则给了 2 能量');
  // 在 agora 再动：agora 是全城所有的，没有地点规则
  const e1 = a.energy;
  const r2 = one(w, a, { type: 'move', to: 'market' });
  assert.equal(a.energy, e1 - r2.cost);
  // result：repair 的 spent；draw 的 energy；没有的数字字段为 0
  enact(w, [
    { when: 'after:repair', do: [{ op: 'transfer', from: 'treasury', to: 'actor', energy: 'result.spent / 2' }] },
    { when: 'after:draw', do: [{ op: 'set', var: 'lastDraw', value: 'result.energy' }, { op: 'set', var: 'missing', value: 'result.nothing' }] },
  ]);
  setTreasury(w, { energy: 50 });
  putAt(w, a, 'well');
  one(w, a, { type: 'draw', energy: 6 });
  assert.equal(w.vars.lastDraw, 6);
  assert.equal('missing' in w.vars, false, '没有的非数字字段为 null：set null 即不存在');
  putAt(w, a, 'market');
  w.places.market.condition = 5000; // 完好的建筑修缮不扣能量（spent 为 0）
  const e2 = a.energy;
  const rp = one(w, a, { type: 'repair', energy: 8 });
  assert.equal(a.energy, e2 - rp.cost + 4);
  assertInvariants(w);
});

test('on:<事件>：城法对任何事件；社群章程只对涉及成员的事件（death 在居民离场之前取下它的社群）；规则施行引起的事件不触发规则（不级联）', () => {
  const w = bareWorld('on');
  const [a, b] = citizens(w, 2);
  const g = one(w, a, { type: 'found', name: '会', manifesto: 'x' }).data.group;
  one(w, b, { type: 'join', group: g });
  enact(w, [
    { when: 'on:arrive', do: [{ op: 'tag', who: 'event.agent', tag: '新人' }] },
    { when: 'on:death', do: [{ op: 'announce', to: 'all', text: '{event.agent} 长眠了' }] },
  ]);
  setBylaws(w, g, [{ when: 'on:death', do: [{ op: 'transfer', from: `group('${g}')`, to: 'treasury', energy: '1' }] }]);
  setTreasury(w, { energy: 100 });
  w.groups[g].treasury.energy = 5;
  w.ledger.src.energy.admin = (w.ledger.src.energy.admin || 0) + 5;
  const c = reg(w, '民3');
  assert.deepEqual(c.tags, ['新人'], 'on:arrive');
  // 民1 长眠：城法宣告；章程（民1 是成员）把 1 能量交给公库
  a.status = 'dormant';
  a.energy = 0;
  a.dormantSinceDay = -10;
  const ev = tickDays(w, 1);
  assert.equal(a.status, 'dead');
  const ann = eventsOf(ev, 'announce');
  assert.equal(ann.length, 1);
  assert.equal(ann[0].data.text, '民1 长眠了');
  assert.equal(w.groups[g].treasury.energy, 5 - 1 - 1, '成员死亡：章程的 on:death 执行（成员名单在离场之前取下）；日终的维持费 1');
  assert.equal(w.groups[g].steward, b.id, '管事之职交给入社最早的在世成员');
  // 不是成员的人死亡：章程不执行（只付日终的维持费 1：3 → 2）
  c.status = 'dormant';
  c.energy = 0;
  c.dormantSinceDay = -10;
  tickDays(w, 1);
  assert.equal(c.status, 'dead');
  assert.equal(w.groups[g].treasury.energy, 2);
});

test('不级联：规则施行期间 fire 什么都不做；施行之外照常触发', () => {
  const w = bareWorld('cascade');
  const [a] = citizens(w, 1);
  enact(w, [{ when: 'on:arrive', do: [{ op: 'tag', who: 'event.agent', tag: '到了' }] }]);
  assert.equal(isRuling(w), false);
  withRuling(w, () => {
    assert.equal(isRuling(w), true);
    hooks.fire(w, 'arrive', { agent: a.id });
  });
  assert.deepEqual(a.tags, [], '规则施行期间的事件不触发规则');
  assert.equal(isRuling(w), false);
  hooks.fire(w, 'arrive', { agent: a.id });
  assert.deepEqual(a.tags, ['到了']);
  // 嵌套：内层结束后仍保持外层的状态
  withRuling(w, () => {
    withRuling(w, () => {});
    assert.equal(isRuling(w), true);
  });
  // 标志不进快照
  assert.equal(Object.keys(JSON.parse(JSON.stringify(w))).includes('$ruling'), false);
});

// ═══════════════════════════════════════════════════════════════
// 作用域（PROTOCOL-2 §6.11）：城法、社群章程、地点规则
// ═══════════════════════════════════════════════════════════════

test('社群章程的作用域：账户只能是本社群的公库、成员，或 to: treasury（向城纳税）；标签加前缀 <社群ID>:，只能加在成员身上；var 是社群自己的；宣告只发给成员', () => {
  const w = bareWorld('bylaws');
  const [a, b, c] = citizens(w, 3);
  const g = one(w, a, { type: 'found', name: '会', manifesto: 'x' }).data.group;
  one(w, b, { type: 'join', group: g });
  const G = w.groups[g];
  G.treasury.energy = 40;
  w.ledger.src.energy.admin += 40;
  setBylaws(w, g, [
    { when: 'enact', do: [{ op: 'set', var: 'dues', value: '3' }] },
    { when: 'daily', do: [
      { op: 'transfer', from: `group('${g}')`, to: "agent('民2')", energy: 'var.dues' }, // 成员：可以
      { op: 'transfer', from: `group('${g}')`, to: "agent('民3')", energy: '5' }, // 非成员：越界
      { op: 'transfer', from: `group('${g}')`, to: 'treasury', energy: '2' }, // 向城纳税：可以
      { op: 'transfer', from: 'treasury', to: "agent('民2')", energy: '5' }, // 城公库作为来源：越界
      { op: 'share', from: `group('${g}')`, energy: '6', among: 'agents' }, // 名单里有非成员：整条越界
      { op: 'tag', who: "agent('民1')", tag: '长老' },
      { op: 'tag', who: "agent('民3')", tag: '长老' }, // 非成员：越界
    ] },
    { when: 'daily', do: [{ op: 'announce', to: 'all', text: '会务：{var.dues}' }] },
  ]);
  assert.deepEqual(G.vars, { dues: 3 }, 'enact 写的是社群自己的变量');
  assert.deepEqual(w.vars, {});
  const t0 = w.treasury.energy;
  const results = [];
  drainOut(w); // setBylaws 的 enact 产生的事件还在暂存区里
  const ev = settle(w);
  for (const o of opEvents(ev).filter((o) => o.scope === `group:${g}`)) results.push([o.op, o.ok, o.note || '']);
  assert.deepEqual(results, [
    ['transfer', true, ''],
    ['transfer', false, 'not_in_scope'],
    ['transfer', true, ''],
    ['transfer', false, 'not_in_scope'],
    ['share', false, 'not_in_scope'],
    ['tag', true, ''],
    ['tag', false, 'not_in_scope'],
    ['announce', true, ''],
  ]);
  assert.deepEqual(a.tags, [`${g}:长老`], '社群的标签带前缀');
  assert.deepEqual(c.tags, []);
  assert.equal(G.treasury.energy, 40 - 2 - 3 - 2 - 5, '维持费 2（两条 daily 规则）、成员 3、纳税 2、宣告（全城的代价 5）');
  assert.ok(a.inbox.some((i) => i.kind === 'announce' && i.text === '会务：3' && i.law === `group:${g}`));
  assert.ok(!c.inbox.some((i) => i.kind === 'announce' && i.law === `group:${g}`), '宣告只发给成员');
  assert.ok(b.inbox.some((i) => i.kind === 'announce' && i.law === `group:${g}`));
  assert.ok(t0 >= 0);
  assertInvariants(w);
});

test('地点规则的作用域：账户只能是主人与执行者（fee 只能交给主人）；宣告只能发给此地的人，由主人付；读城的变量', () => {
  const w = bareWorld('placerules');
  const [a, owner, c] = citizens(w, 3);
  w.places.market.owner = { kind: 'agent', id: owner.id };
  w.vars = { toll: 2 };
  setPlaceRules(w, 'market', [
    { when: 'before:say', do: [{ op: 'fee', to: `agent('${owner.name}')`, energy: 'var.toll' }] },
    { when: 'before:give', do: [{ op: 'fee', to: "agent('民3')", energy: '1' }] }, // 越界：fee 只能交给主人
    { when: 'after:say', do: [{ op: 'transfer', from: `agent('${owner.name}')`, to: 'actor', energy: '1' }, { op: 'transfer', from: `agent('${owner.name}')`, to: "agent('民3')", energy: '1' }] },
    { when: 'daily', do: [{ op: 'announce', to: 'here', text: '市场开门了' }] },
  ]);
  putAt(w, a, 'market');
  putAt(w, c, 'market');
  const o0 = owner.energy;
  const { r, events } = oneWithEvents(w, a, { type: 'say', text: 'hi' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.fees.map((f) => [f.to, f.energy]), [[owner.id, 2]]);
  assert.equal(owner.energy, o0 + 2 - 1, '收费 2，after 规则给执行者 1');
  const ops = opEvents(events).filter((o) => o.scope === 'place:market');
  assert.deepEqual(ops.map((o) => [o.op, o.ok, o.note || '']), [['fee', true, ''], ['transfer', true, ''], ['transfer', false, 'not_in_scope']]);
  // give 触发的越界 fee：不生效（动作照常，没有这笔费用），记一条失败的 rule_op
  const g = oneWithEvents(w, a, { type: 'give', to: c.id, energy: 1 });
  assert.equal(g.r.ok, true);
  assert.equal(g.r.data.fees, undefined);
  assert.deepEqual(opEvents(g.events).map((o) => [o.op, o.ok, o.note]), [['fee', false, 'not_in_scope']]);
  // daily 宣告：只发给此地的人，主人付 1
  const o1 = owner.energy;
  settle(w);
  assert.ok(c.inbox.some((i) => i.kind === 'announce' && i.text === '市场开门了' && i.law === 'place:market'));
  assert.ok(!owner.inbox.some((i) => i.kind === 'announce' && i.law === 'place:market'), '主人不在此地（在 port）');
  assert.ok(owner.energy < o1);
  assertInvariants(w);
});

test('预求值与试算（只收集）：previewRules 返回意图的摘要，出错记 error；不改变世界、不推进随机数', () => {
  const w = bareWorld('preview');
  citizens(w, 3);
  setTreasury(w, { energy: 100 });
  const rules = validateRules([
    { when: 'enact', do: [{ op: 'set', var: 'x', value: '1' }] },
    { when: 'daily', do: [{ op: 'each', in: 'agents', do: [{ op: 'transfer', from: 'treasury', to: 'it', energy: '2' }] }] },
    { when: 'daily', do: [{ op: 'transfer', from: 'treasury', to: 'treasury', energy: '1 / 0' }] },
    { when: 'monthly', do: [{ op: 'share', from: 'treasury', energy: '9', among: 'sample(agents, 2)' }] },
    { when: 'before:say', do: [{ op: 'deny', reason: 'x' }] },
  ], { scope: { kind: 'city' } }).rules;
  const rng0 = w.rng.world.slice();
  drainOut(w);
  const snap = JSON.stringify(w);
  const out = previewRules(w, { kind: 'city', owner: 'draft', key: 'draft', scopeStr: 'city', rules }, { rng: w.rng.world.slice() });
  assert.deepEqual(out.map((o) => (o.error ? [o.rule, 'error', o.error] : [o.rule, o.op])), [
    [0, 'set'], [1, 'transfer'], [1, 'transfer'], [1, 'transfer'], [2, 'error', 'div0'], [3, 'share'],
  ]);
  assert.deepEqual(out[1], { rule: 1, op: 'transfer', from: 'treasury', to: 'a1', energy: 2, coins: 0 });
  assert.equal(JSON.stringify(w), snap, '世界一点没动');
  assert.deepEqual(w.rng.world, rng0, '随机数没有推进');
  assert.deepEqual(drainOut(w), [], '也没有事件');
});
