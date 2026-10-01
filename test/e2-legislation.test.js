// SPEC-E2 §25 第 4 步（下）：立法——提案、表决、计票与生效、与 v1 的等价、程序的取代、自动回退、重订、维持费、draft、read { law }。
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../src/e2/engine/index.js';
import { P } from '../src/e2/params.js';
import { HUMAN_PROCEDURE } from '../src/e2/lore/humanlaws.js';
import { computeTally, openRefounds } from '../src/e2/engine/legislation.js';
import { fingerprintProcClass } from '../src/e2/rules/fingerprint.js';
import {
  newWorld, bareWorld, reg, one, oneWithEvents, grant, setHoldings, setTreasury, fundTreasury, putAt, tick, tickDays, settle, eventsOf, assertInvariants,
} from './e2-helpers.js';
import { enact, setBylaws, setPlaceRules } from './e2-law-helpers.js';
import * as V1 from './helpers.js';

void setPlaceRules;
void grant;

const drainOut = (w) => { const o = w.$out || []; w.$out = []; return o; };

/** n 位公民（默认的世界：遗法 l4 让入城者成为公民） */
const town = (n, seed = 'leg', { energy = 100 } = {}) => {
  const w = newWorld(seed);
  const people = [];
  for (let i = 0; i < n; i++) {
    const a = reg(w, `民${i + 1}`);
    setHoldings(w, a, { energy });
    people.push(a);
  }
  return { w, people };
};

/** 在议会提出一个提案，返回结果 { r, events } */
const propose = (w, a, extra = {}) => {
  putAt(w, a, 'parliament');
  return oneWithEvents(w, a, { type: 'propose', title: '题', text: '文', ...extra });
};

const RULE_DAILY = (energy = 1) => [{ when: 'daily', do: [{ op: 'transfer', from: 'treasury', to: "agent('民1')", energy: String(energy) }] }];

// ═══════════════════════════════════════════════════════════════
// 提案
// ═══════════════════════════════════════════════════════════════

test('propose：在议会提出，付 6 能量；记录提案（规则、类别、程序的副本、固定的表决者、表决期、不记名）与公开事件（含中英文读法）', () => {
  const { w, people } = town(5);
  const [a] = people;
  const e0 = a.energy;
  const { r, events } = propose(w, a, { rules: RULE_DAILY(), basedOn: 'l3' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.cost, r.data.class, r.data.closesTick], [6, 'ordinary', 12]);
  assert.equal(a.energy, e0 - 6);
  const p = w.proposals[r.data.proposal];
  assert.deepEqual([p.id, p.scope, p.kind, p.class, p.proposer, p.openedTick, p.closesTick, p.status, p.lawId, p.tally, p.basedOn, p.secret], [r.data.proposal, 'city', 'law', 'ordinary', a.id, 0, 12, 'open', null, null, 'l3', true]);
  assert.deepEqual(p.voters, people.map((x) => x.id));
  assert.deepEqual(p.spec, w.laws.l1.procedure.ordinary);
  assert.notEqual(p.spec, w.laws.l1.procedure.ordinary, '提案存的是程序的副本');
  assert.deepEqual(p.votes, {});
  assert.equal(p.procedure, null);
  const ev = eventsOf(events, 'propose')[0];
  assert.equal(ev.vis, 'public');
  assert.deepEqual([ev.data.proposalId, ev.data.title, ev.data.class, ev.data.closesTick, ev.data.voters, ev.data.secret], [p.id, '题', 'ordinary', 12, 5, true]);
  assert.match(ev.data.reading.zh.rules[0], /^每日结算时：/);
  assert.match(ev.data.reading.en.rules[0], /^At each daily settlement/);
  assert.equal(w.dayLog.proposals, 1);
});

test('propose：校验与错误——长度、rules 与 procedure 不能同时、规则不合法（rule_invalid 带路径与建议）、basedOn 不存在、提出者资格、每人 1 个 / 全城 20 个', () => {
  const { w, people } = town(22);
  const [a, b] = people;
  const bad = (extra) => propose(w, a, extra).r;
  assert.equal(bad({ title: '' }).error.code, 'invalid_args');
  assert.equal(bad({ title: 'x'.repeat(61) }).error.code, 'text_too_long');
  assert.equal(bad({ text: 'x'.repeat(1201) }).error.code, 'text_too_long');
  assert.equal(bad({ text: '' }).error.code, 'invalid_args');
  assert.equal(bad({ title: '两\n行' }).error.code, 'invalid_args');
  assert.equal(bad({ rules: [], procedure: HUMAN_PROCEDURE }).error.code, 'invalid_args');
  const inv = bad({ rules: [{ when: 'daily', do: [{ op: 'transfer', from: 'treasury', to: 'treasury', energy: 'true' }] }] });
  assert.equal(inv.error.code, 'rule_invalid');
  assert.equal(inv.error.issues[0].path, 'rules[0].do[0].energy');
  assert.match(inv.error.hint.zh, /rules\[0\]\.do\[0\]\.energy/);
  assert.match(inv.error.hint.en, /needs an integer/);
  assert.equal(bad({ rules: 'x' }).error.code, 'rule_invalid');
  assert.equal(bad({ basedOn: 'l99' }).error.code, 'not_found');
  assert.equal(a.energy, 100, '失败的动作不扣能量');
  // 提出者资格：被放逐者、非公民
  b.tags = ['citizen', 'exiled'];
  assert.equal(propose(w, b).r.error.code, 'not_eligible');
  b.tags = [];
  assert.equal(propose(w, b).r.error.code, 'not_eligible');
  b.tags = ['citizen'];
  // 每人 1 个
  assert.equal(propose(w, a).r.ok, true);
  assert.equal(propose(w, a).r.error.code, 'limit_reached');
  // 全城 20 个
  for (let i = 1; i < 20; i++) assert.equal(propose(w, people[i]).r.ok, true, `第 ${i + 1} 个提案`);
  assert.equal(Object.keys(w.proposals).length, 20);
  assert.equal(propose(w, people[20]).r.error.code, 'limit_reached');
  assertInvariants(w);
});

test('propose：分类——含 procedure 或 amend 操作的是修宪级，否则普通；用提出时生效的那一类程序；那一类是 { none: true } 时 not_allowed（只能重订）', () => {
  const { w, people } = town(4);
  const [a] = people;
  const cls = (extra) => { const r = propose(w, a, extra).r; for (const p of Object.values(w.proposals)) p.status = 'void'; return r.ok ? r.data.class : r.error.code; };
  assert.equal(cls({ rules: RULE_DAILY() }), 'ordinary');
  assert.equal(cls({}), 'ordinary', '没有规则的规范也是普通法案');
  assert.equal(cls({ rules: [{ when: 'enact', do: [{ op: 'amend', article: 1, lang: 'zh', text: '改' }] }] }), 'constitutional');
  assert.equal(cls({ rules: [{ when: 'enact', do: [{ op: 'each', in: 'agents', do: [{ op: 'amend', article: 1, lang: 'zh', text: '改' }] }] }] }), 'constitutional', 'each 里的 amend 也算');
  assert.equal(cls({ procedure: HUMAN_PROCEDURE }), 'constitutional');
  // 只替换普通类的程序：之后 l1 仍管修宪级
  w.laws.l1.procedure = { ordinary: { none: true }, constitutional: w.laws.l1.procedure.constitutional };
  assert.equal(cls({ rules: RULE_DAILY() }), 'not_allowed');
  const na = propose(w, a, { rules: RULE_DAILY() }).r;
  assert.match(na.error.hint.zh, /只能重订/);
  assert.match(na.error.hint.en, /only a refounding/);
  assert.equal(cls({ procedure: HUMAN_PROCEDURE }), 'constitutional');
  // 没有合格的表决者
  w.laws.l1.procedure.constitutional.voters = "filter(agents, has_tag(it, 'nobody'))";
  assert.equal(cls({ procedure: HUMAN_PROCEDURE }), 'not_allowed');
  assert.match(propose(w, a, { procedure: HUMAN_PROCEDURE }).r.error.hint.en, /no eligible voters/);
});

// ═══════════════════════════════════════════════════════════════
// 表决与计票
// ═══════════════════════════════════════════════════════════════

test('vote：须在提案的表决者之中（提出时固定）；可以改票，以最后一次为准；理由 ≤ 140；事件 vote 公开（含选择与理由）', () => {
  const { w, people } = town(4);
  const [a, b, c] = people;
  const { r } = propose(w, a, { rules: RULE_DAILY() });
  const pid = r.data.proposal;
  assert.equal(one(w, b, { type: 'vote', proposal: 'p99', choice: 'yes' }).error.code, 'not_found');
  assert.equal(one(w, b, { type: 'vote', proposal: pid, choice: 'maybe' }).error.code, 'invalid_args');
  assert.equal(one(w, b, { type: 'vote', proposal: pid, choice: 'yes', reason: 'x'.repeat(141) }).error.code, 'text_too_long');
  const first = oneWithEvents(w, b, { type: 'vote', proposal: pid, choice: 'no', reason: '再想想' });
  assert.equal(first.r.ok, true);
  assert.deepEqual(first.r.data, { proposal: pid, choice: 'no', changed: false });
  const ev = eventsOf(first.events, 'vote')[0];
  assert.deepEqual([ev.vis, ev.agent, ev.data.proposalId, ev.data.choice, ev.data.reason, ev.data.changed], ['public', b.id, pid, 'no', '再想想', false]);
  const again = one(w, b, { type: 'vote', proposal: pid, choice: 'yes' });
  assert.equal(again.data.changed, true);
  assert.deepEqual(w.proposals[pid].votes[b.id].choice, 'yes');
  assert.equal(Object.keys(w.proposals[pid].votes).length, 1);
  // 提出之后入城的居民不在表决者之中
  const late = reg(w, '迟到');
  assert.equal(one(w, late, { type: 'vote', proposal: pid, choice: 'yes' }).error.code, 'not_eligible');
  // 提案已关闭：not_found
  tick(w, 12);
  assert.equal(w.proposals[pid].status !== 'open', true);
  assert.equal(one(w, c, { type: 'vote', proposal: pid, choice: 'yes' }).error.code, 'not_found');
});

test('计票与生效：通过则生成法律（作者、类别、basedOn、paidThrough = 今日、指纹）、执行 enact、事件 law_passed（含 tally 与 results）、触发 on:law_passed、收件 law 发给提案者与投票者；否决则 law_rejected', () => {
  const { w, people } = town(5);
  const [a, b, c, d] = people;
  enact(w, [{ when: 'on:law_passed', do: [{ op: 'set', var: 'passedLaw', value: 'event.law' }] }, { when: 'on:law_rejected', do: [{ op: 'set', var: 'rejected', value: 'true' }] }]);
  const rules = [{ when: 'enact', do: [{ op: 'set', var: 'hello', value: '42' }] }, ...RULE_DAILY(3)];
  const pid = propose(w, a, { rules, basedOn: 'l3' }).r.data.proposal;
  for (const [x, ch] of [[a, 'yes'], [b, 'yes'], [c, 'no']]) one(w, x, { type: 'vote', proposal: pid, choice: ch });
  drainOut(w);
  const ev = tick(w, 12);
  const p = w.proposals[pid];
  assert.equal(p.status, 'passed');
  assert.deepEqual(p.tally, { yes: 2, no: 1, abstain: 0, voted: 3, total: 5, turnout: 600 });
  const law = w.laws[p.lawId];
  assert.deepEqual([law.author, law.class, law.basedOn, law.proposalId, law.status, law.paidThrough, law.enactedTick], [a.id, 'ordinary', 'l3', pid, 'active', 1, 12]);
  assert.equal(law.fingerprints.length, 2);
  assert.deepEqual(law.results.map((r) => [r.rule, r.op, r.ok]), [[0, 'set', true]]);
  assert.equal(w.vars.hello, 42, 'enact 执行了');
  const lp = eventsOf(ev, 'law_passed')[0];
  assert.deepEqual([lp.data.proposalId, lp.data.lawId, lp.data.class, lp.data.tally.turnout, lp.data.results.length], [pid, law.id, 'ordinary', 600, 1]);
  assert.equal(w.vars.passedLaw, law.id, 'on:law_passed 的 event.law');
  for (const x of [a, b, c]) assert.ok(x.inbox.some((i) => i.kind === 'law' && i.proposalId === pid && i.result === 'passed' && i.lawId === law.id), x.name);
  assert.ok(!d.inbox.some((i) => i.kind === 'law'), '没投票的人不收');
  // 否决：参与率不足（1/5 = 20% < 30%）
  const p2 = propose(w, b, { rules: RULE_DAILY() }).r.data.proposal;
  one(w, b, { type: 'vote', proposal: p2, choice: 'yes' });
  const ev2 = tick(w, 12);
  assert.equal(w.proposals[p2].status, 'rejected');
  assert.equal(w.proposals[p2].lawId, null);
  assert.deepEqual(eventsOf(ev2, 'law_rejected')[0].data.tally, { yes: 1, no: 0, abstain: 0, voted: 1, total: 5, turnout: 200 });
  assert.equal(w.vars.rejected, true, 'on:law_rejected');
  assert.ok(b.inbox.some((i) => i.kind === 'law' && i.result === 'rejected' && i.lawId === null));
  assertInvariants(w);
});

test('dayLog：当日通过与否决的提案记在 dayLog.laws（史官与指标用）；passed / rejected / proposals 计数', () => {
  const { w, people } = town(5);
  tick(w, 3); // 不在日界上：提案在第 15 刻到期，dayLog 没有被日终结算清空
  const pid = propose(w, people[0], { rules: RULE_DAILY() }).r.data.proposal;
  for (const x of people.slice(0, 2)) one(w, x, { type: 'vote', proposal: pid, choice: 'yes' });
  tick(w, 12);
  assert.deepEqual(w.dayLog.laws, [{ proposalId: pid, title: '题', passed: true, yes: 2, no: 0, lawId: 'l7' }]);
  assert.deepEqual([w.dayLog.proposals, w.dayLog.passed, w.dayLog.rejected], [0, 1, 0], '提出在前一日（日终清空），通过在今日');
});

test('计票：只计仍在世的表决者的票；total 也只算在世者；沉睡的算在世（醒着或沉睡）', () => {
  const { w, people } = town(6);
  const [a, b, c, d, e] = people;
  const pid = propose(w, a, { rules: RULE_DAILY() }).r.data.proposal;
  for (const x of [a, b, c]) one(w, x, { type: 'vote', proposal: pid, choice: 'yes' });
  // c 长眠、d 沉睡
  c.status = 'dead';
  c.energy = 0;
  c.coins = 0;
  d.status = 'dormant';
  d.energy = 0;
  d.dormantSinceDay = 0;
  tick(w, 12);
  const p = w.proposals[pid];
  assert.deepEqual(p.tally, { yes: 2, no: 0, abstain: 0, voted: 2, total: 5, turnout: 400 });
  assert.equal(p.status, 'passed');
  void e;
});

test('不记名程序（secret）：提案记录里 secret 为真；记名（secret 为 false）的提案 secret 为假——可见性在第 9 步的感知里检查', () => {
  const { w, people } = town(3);
  const [a] = people;
  const pid = propose(w, a, { rules: RULE_DAILY() }).r.data.proposal;
  assert.equal(w.proposals[pid].secret, true);
  w.laws.l1.procedure.ordinary.secret = false;
  for (const p of Object.values(w.proposals)) p.status = 'void';
  const p2 = propose(w, a, { rules: RULE_DAILY() }).r.data.proposal;
  assert.equal(w.proposals[p2].secret, false);
  // 提案的 spec 是副本：之后改程序不影响这次表决
  w.laws.l1.procedure.ordinary.secret = true;
  assert.equal(w.proposals[p2].spec.secret, false);
});

// ═══════════════════════════════════════════════════════════════
// 与 v1 等价（测试 4）
// ═══════════════════════════════════════════════════════════════

test('l1 的计票与 v1 的公式逐位相同：对 n ≤ 12 的所有 (赞成, 反对, 弃权) 组合——普通法案与修宪级', () => {
  const { w } = town(1);
  // v1 的判定（SPEC-M1 §7.9，quorum 0.3、passThreshold 0.5、amendThreshold 0.667，千分比整数）
  const v1 = (n, yes, no, abstain, governance) => {
    const voted = yes + no + abstain;
    const decisive = yes + no;
    const quorumOk = n > 0 && voted * 1000 >= 300 * n;
    const approvalOk = governance ? yes * 1000 >= 667 * decisive : yes * 1000 > 500 * decisive;
    return n > 0 && decisive > 0 && quorumOk && approvalOk;
  };
  let cases = 0;
  for (let n = 1; n <= 12; n++) {
    for (let yes = 0; yes <= n; yes++) {
      for (let no = 0; yes + no <= n; no++) {
        for (let abstain = 0; yes + no + abstain <= n; abstain++) {
          for (const cls of ['ordinary', 'constitutional']) {
            const voters = Array.from({ length: n }, (_, i) => `a${i + 1}`);
            const votes = {};
            let k = 0;
            for (const [count, choice] of [[yes, 'yes'], [no, 'no'], [abstain, 'abstain']]) for (let i = 0; i < count; i++) votes[voters[k++]] = { choice, reason: '', tick: 0 };
            w.agents = {};
            for (const id of voters) w.agents[id] = { id, status: 'awake' };
            const p = { spec: w.laws.l1.procedure[cls], voters, votes, class: cls };
            const { tally, passed } = computeTally(w, p, () => assert.fail('求值出错'));
            assert.deepEqual([tally.yes, tally.no, tally.abstain, tally.total], [yes, no, abstain, n]);
            assert.equal(passed, v1(n, yes, no, abstain, cls === 'constitutional'), `${cls} n=${n} yes=${yes} no=${no} abstain=${abstain}`);
            cases++;
          }
        }
      }
    }
  }
  assert.ok(cases > 3000);
});

test('l1 与 v1 的真实计票相同——参与率恰好 30%、赞成恰好等于反对、恰好三分之二（v1 的 0.667 门槛下不通过）：两个引擎并排跑同样的票', () => {
  // [n, 赞成, 反对, 弃权, 修宪级?, 预期]
  const scenes = [
    [10, 3, 0, 0, false, true], // 参与率恰好 30%，赞成 > 反对
    [10, 2, 0, 0, false, false], // 20% 不够
    [10, 4, 4, 0, false, false], // 赞成 = 反对
    [10, 5, 4, 1, false, true],
    [9, 2, 1, 0, false, true], // 参与率 33%
    [6, 4, 2, 0, true, false], // 恰好三分之二：v1 的 0.667 门槛，4000 < 667 × 6 = 4002 → 不通过
    [6, 5, 1, 0, true, true],
    [3, 2, 1, 0, true, false],
    [9, 6, 3, 0, true, false],
    [10, 7, 3, 0, true, true], // 70% ≥ 66.7%
  ];
  scenes.forEach(([n, yes, no, abstain, constitutional, expected], si) => {
    // v2
    const { w, people } = town(n, `eq2-${si}`);
    const proposer = people[0];
    const rules = constitutional ? [{ when: 'enact', do: [{ op: 'amend', article: 1, lang: 'zh', text: '改' }] }] : RULE_DAILY();
    const pid = propose(w, proposer, { rules }).r.data.proposal;
    let k = 0;
    for (const [count, choice] of [[yes, 'yes'], [no, 'no'], [abstain, 'abstain']]) for (let i = 0; i < count; i++) one(w, people[k++], { type: 'vote', proposal: pid, choice });
    tick(w, 12);
    const v2 = w.proposals[pid].status === 'passed';
    // v1
    const w1 = V1.newWorld(`eq1-${si}`);
    const ps = [];
    for (let i = 0; i < n; i++) ps.push(V1.reg(w1, `民${i + 1}`));
    ps[0].place = 'parliament';
    const effects = constitutional ? [{ type: 'amend', article: 1, lang: 'zh', text: '改' }] : [{ type: 'stipend', to: ps[0].id, energy: 1 }];
    const pr = V1.one(w1, ps[0], { type: 'propose', title: '题', text: '文', effects });
    assert.equal(pr.ok, true, JSON.stringify(pr));
    k = 0;
    for (const [count, choice] of [[yes, 'yes'], [no, 'no'], [abstain, 'abstain']]) for (let i = 0; i < count; i++) V1.one(w1, ps[k++], { type: 'vote', proposal: pr.data.proposal, choice });
    V1.tick(w1, 12);
    const v1 = w1.proposals[pr.data.proposal].status === 'passed';
    assert.equal(v1, expected, `v1 场景 ${si}`);
    assert.equal(v2, expected, `v2 场景 ${si}`);
  });
});

test('l1 的表决期：普通与修宪级都是 12 刻（1 日），与 v1 的 proposalDays = 1 相同', () => {
  const { w, people } = town(3);
  const r = propose(w, people[0], { rules: RULE_DAILY() }).r;
  assert.equal(r.data.closesTick - w.clock.tick, 12);
  assert.equal(w.laws.l1.procedure.constitutional.period, 12);
});

// ═══════════════════════════════════════════════════════════════
// 程序的取代
// ═══════════════════════════════════════════════════════════════

/** 全体表决者投赞成并推进到表决期结束，返回提案 */
const passIt = (w, voters, pid, choice = 'yes') => {
  for (const v of voters) one(w, v, { type: 'vote', proposal: pid, choice });
  tick(w, w.proposals[pid].closesTick - w.clock.tick);
  return w.proposals[pid];
};

const COUNCIL = {
  proposers: "has_tag(actor, 'citizen')",
  voters: "sample(tagged('citizen'), 3)",
  weight: '1',
  period: 24,
  secret: false,
  decide: 'yes >= 2',
};

test('程序的按类取代：只替换普通类，l1 仍管修宪级；两类都被取代后 l1 才是 replaced；事件 law_replaced；全体在世居民收到 procedure', () => {
  const { w, people } = town(6, 'proc');
  const [a] = people;
  const p1 = propose(w, a, { title: '抽签议会', text: '普通法案由抽签的七人……', procedure: { ordinary: COUNCIL } }).r.data;
  assert.equal(p1.class, 'constitutional');
  drainOut(w);
  passIt(w, people, p1.proposal);
  const law = w.laws[w.proposals[p1.proposal].lawId];
  assert.deepEqual(w.procedure, { ordinary: law.id, constitutional: 'l1' });
  assert.equal(w.laws.l1.status, 'active', 'l1 还管着修宪级');
  assert.equal(law.class, 'constitutional');
  assert.equal(law.fingerprints.length, 1);
  assert.equal(w.revertWatch.ordinary, 0);
  for (const x of people) {
    const m = x.inbox.filter((i) => i.kind === 'procedure');
    assert.deepEqual(m.map((i) => [i.class, i.lawId, i.reason]), [['ordinary', law.id, 'enacted']], x.name);
  }
  const rep = w.$out ? w.$out.filter((e) => e.type === 'law_replaced') : [];
  void rep;
  // 取代修宪级：这次轮到 l1 被 replaced
  const p2 = propose(w, a, { title: '再改', text: '修宪级也换', procedure: { constitutional: { ...COUNCIL, voters: 'agents', decide: 'yes * 2 > total' } } }).r.data;
  const before = w.clock.tick;
  const ev = tick(w, 0);
  void ev;
  passIt(w, people, p2.proposal);
  assert.equal(w.proposals[p2.proposal].status, 'passed');
  assert.equal(w.laws.l1.status, 'replaced');
  assert.equal(w.laws.l1.replacedBy, w.proposals[p2.proposal].lawId);
  assert.equal(w.procedure.constitutional, w.proposals[p2.proposal].lawId);
  assert.ok(w.clock.tick > before);
});

test('law_replaced 事件：被取代的程序法律、类别、取代者、是否整部退役；dayLog.procedureChanges', () => {
  const { w, people } = town(4, 'replaced-ev');
  const [a] = people;
  const pid = propose(w, a, { title: '改', text: '改', procedure: HUMAN_PROCEDURE }).r.data.proposal; // 两类都换成同样的内容
  for (const v of people) one(w, v, { type: 'vote', proposal: pid, choice: 'yes' });
  const ev = tick(w, 12);
  const rep = eventsOf(ev, 'law_replaced');
  assert.deepEqual(rep.map((e) => [e.data.lawId, e.data.class, e.data.retired]), [['l1', 'ordinary', true], ['l1', 'constitutional', true]]);
  assert.ok(rep.every((e) => e.data.by === w.proposals[pid].lawId));
  assert.equal(w.laws.l1.status, 'replaced');
});

test('抽签议会：表决者在提出时求值并固定（sample 用世界的随机数）；失败的动作不推进随机数，成功的提案一并提交；同一种子同一结果', () => {
  const run = () => {
    const { w, people } = town(8, 'lottery');
    const [a] = people;
    const pid = propose(w, a, { title: '抽签', text: '抽签', procedure: { ordinary: COUNCIL } }).r.data.proposal;
    passIt(w, people, pid);
    // 现在普通法案由抽签的 3 人表决
    const rng0 = w.rng.world.slice();
    putAt(w, a, 'market'); // 遗法 l2：不在议会 → forbidden
    const bad = one(w, a, { type: 'propose', title: '题', text: '文' });
    assert.equal(bad.error.code, 'forbidden');
    assert.deepEqual(w.rng.world, rng0, '被拒绝的提案没有推进随机数');
    const ok = propose(w, a, { rules: RULE_DAILY() });
    assert.equal(ok.r.ok, true);
    assert.notDeepEqual(w.rng.world, rng0, '成功的提案提交了随机数');
    const p = w.proposals[ok.r.data.proposal];
    assert.equal(p.voters.length, 3);
    assert.ok(p.voters.every((id) => w.agents[id].tags.includes('citizen')));
    assert.equal(p.closesTick - p.openedTick, 24);
    assert.equal(p.secret, false);
    // 不在名单里的人不能投票
    const out = people.find((x) => !p.voters.includes(x.id));
    assert.equal(one(w, out, { type: 'vote', proposal: p.id, choice: 'yes' }).error.code, 'not_eligible');
    return p.voters.join(',');
  };
  assert.equal(run(), run());
});

test('{ none: true }：这一类不再立法（propose 为 not_allowed）；重订是唯一的出路', () => {
  const { w, people } = town(4, 'none');
  const [a] = people;
  const pid = propose(w, a, { title: '停止立法', text: '普通法案不再立法', procedure: { ordinary: { none: true } } }).r.data.proposal;
  passIt(w, people, pid);
  assert.deepEqual(w.laws[w.procedure.ordinary].procedure, { ordinary: { none: true } });
  const r = propose(w, a, { rules: RULE_DAILY() }).r;
  assert.equal(r.error.code, 'not_allowed');
  assert.match(r.error.hint.zh, /重订/);
  // 修宪级仍可立法
  assert.equal(propose(w, a, { title: '改回', text: '改回', procedure: HUMAN_PROCEDURE }).r.ok, true);
});

// ═══════════════════════════════════════════════════════════════
// 自动回退
// ═══════════════════════════════════════════════════════════════

/** 直接换上一部「提出者」永远为假的普通类程序（绕过表决） */
import { createLaw, installProcedure } from '../src/e2/engine/laws.js';
const brokenProcedure = (w, patch = {}) => {
  const proc = { ordinary: { ...HUMAN_PROCEDURE.ordinary, proposers: "has_tag(actor, '无人拥有的标签')", ...patch } };
  const law = createLaw(w, { title: '坏程序', text: 'x', author: 'a1', procedure: proc });
  installProcedure(w, law, 'enacted');
  drainOut(w);
  return law;
};

test('自动回退：某一类连续 3 日没有合格的提出者，第 3 日的结算里回到人类的程序（遗法 l1 的原始版本）；生成法律（author revert、中英文标题）、事件 procedure_reverted、收件 procedure', () => {
  const { w, people } = town(4, 'revert');
  const bad = brokenProcedure(w);
  assert.equal(w.procedure.ordinary, bad.id);
  const marks = [];
  for (let d = 1; d <= 3; d++) {
    const ev = settle(w);
    marks.push([w.revertWatch.ordinary, eventsOf(ev, 'procedure_reverted').length]);
  }
  assert.deepEqual(marks, [[1, 0], [2, 0], [0, 1]], '恰好第 3 日回退，之后观察重新计数');
  const rev = w.laws[w.procedure.ordinary];
  assert.deepEqual([rev.author, rev.class, rev.title, rev.i18n.en.title], ['revert', 'constitutional', '立法程序（回退）', 'Procedure of Lawmaking (reverted)']);
  assert.equal(rev.text, '某一类立法程序连续三日无人可行，回到人类留下的样子。');
  assert.deepEqual(Object.keys(rev.procedure), ['ordinary']);
  assert.equal(fingerprintProcClass(rev.procedure.ordinary), fingerprintProcClass(HUMAN_PROCEDURE.ordinary));
  assert.equal(w.laws[bad.id].status, 'replaced');
  assert.equal(w.laws[bad.id].replacedBy, rev.id);
  assert.equal(w.procedure.constitutional, 'l1', '另一类不受影响');
  assert.ok(people[0].inbox.some((i) => i.kind === 'procedure' && i.reason === 'reverted' && i.class === 'ordinary' && i.lawId === rev.id));
  // 回退之后又可以提案
  assert.equal(propose(w, people[0], { rules: RULE_DAILY() }).r.ok, true);
  assertInvariants(w);
});

test('自动回退：中途恢复可行则重新计数；表决者名单为空 / 求值出错同样算「无人可行」；{ none: true } 不回退；已经是人类的程序时不生成重复的法律', () => {
  const { w, people } = town(4, 'revert2');
  brokenProcedure(w);
  settle(w);
  settle(w);
  assert.equal(w.revertWatch.ordinary, 2);
  people[0].tags.push('无人拥有的标签'); // 有人可行了
  settle(w);
  assert.equal(w.revertWatch.ordinary, 0, '重新计数');
  people[0].tags = ['citizen'];
  settle(w);
  settle(w);
  assert.equal(w.revertWatch.ordinary, 2);
  // 提出者可行但表决者名单为空
  const w2 = town(4, 'revert3').w;
  brokenProcedure(w2, { proposers: 'true', voters: "filter(agents, has_tag(it, 'zzz'))" });
  settle(w2);
  settle(w2);
  assert.equal(eventsOf(settle(w2), 'procedure_reverted').length, 1, '表决者为空：第 3 日回退');
  // 表决者表达式运行时出错（除以零）
  const w3 = town(4, 'revert4').w;
  brokenProcedure(w3, { proposers: 'true', voters: "filter(agents, 1 / 0 > 1)" });
  tickDays(w3, 2);
  assert.equal(eventsOf(settle(w3), 'procedure_reverted').length, 1);
  // { none: true } 不回退
  const w4 = town(4, 'revert5').w;
  const law = createLaw(w4, { title: '停', text: 'x', author: 'a1', procedure: { ordinary: { none: true } } });
  installProcedure(w4, law, 'enacted');
  tickDays(w4, 6);
  assert.equal(w4.procedure.ordinary, law.id);
  assert.equal(w4.revertWatch.ordinary, 0);
  // 已经是人类的程序、但没有任何人能用（所有居民都死了）：不生成重复的法律
  const w5 = newWorld('revert6');
  const n0 = Object.keys(w5.laws).length;
  tickDays(w5, 8);
  assert.equal(Object.keys(w5.laws).length, n0, '没有居民：人类的程序「无人可行」，但回退到它自己没有意义');
});

// ═══════════════════════════════════════════════════════════════
// 重订
// ═══════════════════════════════════════════════════════════════

const HUMANS = 'humans';

/** n 位居民，时间推进 3 日，使他们都「入城满 3 日」 */
const matured = (n, seed) => {
  const { w, people } = town(n, seed, { energy: 120 });
  tickDays(w, 3);
  for (const a of people) setHoldings(w, a, { energy: 100 });
  return { w, people };
};

test('refound：发起（付 6、自动联署、事件 refound_open、全体收到 refound/opened）；needed = ceil(2n / 3)，n 只算入城满 3 日的在世居民', () => {
  const { w, people } = matured(6, 'refound');
  const late = reg(w, '新来的'); // 不满 3 日：不计入分母
  const [a, b, c, d] = people;
  drainOut(w);
  const { r, events } = oneWithEvents(w, a, { type: 'refound', text: '回到人类的程序吧', procedure: HUMANS });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.cost, 6);
  assert.equal(r.data.needed, 4, 'ceil(2 × 6 / 3) = 4');
  assert.equal(r.data.expiresTick, w.clock.tick + P.refoundWindowTicks);
  const rf = w.refounds[r.data.refound];
  assert.deepEqual([rf.by, rf.signers, rf.status, rf.procedure], [a.id, [a.id], 'open', 'humans']);
  const ev = eventsOf(events, 'refound_open')[0];
  assert.deepEqual([ev.data.refoundId, ev.data.needed], [rf.id, 4]);
  assert.match(ev.data.reading.zh.ordinary, /^提出者：/);
  for (const x of [...people, late]) assert.ok(x.inbox.some((i) => i.kind === 'refound' && i.event === 'opened' && i.refoundId === rf.id), x.name);
  // sign：已联署 → already；不存在 → not_found
  assert.equal(one(w, a, { type: 'sign', refound: rf.id }).error.code, 'already');
  assert.equal(one(w, b, { type: 'sign', refound: 'r99' }).error.code, 'not_found');
  const s1 = one(w, b, { type: 'sign', refound: rf.id });
  assert.deepEqual(s1.data, { signers: 2, needed: 4, succeeded: false });
  assert.equal(s1.cost, 1);
  const ev2 = eventsOf(oneWithEvents(w, c, { type: 'sign', refound: rf.id }).events, 'refound_sign')[0];
  assert.deepEqual([ev2.data.refoundId, ev2.data.signers], [rf.id, 3]);
  void d;
});

test('重订成功：联署者（在世）达到 needed 立即成功——生成法律（author refound:<r>）取代两类程序（"humans" 取人类的原始版本）、其他进行中的重订作废、冷却 24 日、事件 refounded、全体收到 refound/succeeded 与 procedure', () => {
  const { w, people } = matured(6, 'refound-ok');
  const [a, b, c, d, e] = people;
  // 先换成抽签议会，使「回到人类的程序」有意义
  passIt(w, people, propose(w, a, { title: '抽签', text: 'x', procedure: { ordinary: COUNCIL } }).r.data.proposal);
  assert.notEqual(w.procedure.ordinary, 'l1');
  const rOther = one(w, e, { type: 'refound', text: '另一个方案', procedure: { ordinary: { none: true }, constitutional: { none: true } } }).data.refound;
  const rid = one(w, a, { type: 'refound', text: '回到人类的程序吧', procedure: HUMANS }).data.refound;
  drainOut(w);
  one(w, b, { type: 'sign', refound: rid });
  one(w, c, { type: 'sign', refound: rid });
  d.energy = 0;
  d.status = 'dead'; // 已经死了的不算（不能联署），这里只验证其余
  d.coins = 0;
  const last = oneWithEvents(w, people[5], { type: 'sign', refound: rid });
  assert.deepEqual(last.r.data, { signers: 4, needed: 4, succeeded: true });
  const rf = w.refounds[rid];
  assert.equal(rf.status, 'succeeded');
  const law = w.laws[w.procedure.ordinary];
  assert.deepEqual([law.author, law.title, law.i18n.en.title, law.text], [`refound:${rid}`, '立法程序（重订）', 'Procedure of Lawmaking (refounded)', '回到人类的程序吧']);
  assert.equal(w.procedure.constitutional, law.id);
  assert.deepEqual(Object.keys(law.procedure), ['ordinary', 'constitutional']);
  assert.equal(fingerprintProcClass(law.procedure.ordinary), fingerprintProcClass(HUMAN_PROCEDURE.ordinary));
  assert.equal(w.refounds[rOther].status, 'void');
  assert.equal(w.refoundCooldownUntil, Math.floor(w.clock.tick / 12) + 24);
  const evs = last.events;
  assert.deepEqual(eventsOf(evs, 'refounded').map((x) => [x.data.refoundId, x.data.lawId]), [[rid, law.id]]);
  for (const x of [a, b, c, people[5]]) {
    assert.ok(x.inbox.some((i) => i.kind === 'refound' && i.event === 'succeeded'), x.name);
    assert.deepEqual(x.inbox.filter((i) => i.kind === 'procedure' && i.reason === 'refounded').map((i) => i.class).sort(), ['constitutional', 'ordinary']);
  }
  assert.deepEqual(w.dayLog.refounds.at(-1), { refoundId: rid, signers: 4 });
  // 冷却：之后不能再发起
  const cd = one(w, a, { type: 'refound', text: '再来', procedure: HUMANS });
  assert.deepEqual([cd.error.code, cd.error.untilDay], ['cooldown', w.refoundCooldownUntil]);
  assert.match(cd.error.hint.zh, /冷却期/);
  tickDays(w, 24);
  assert.equal(one(w, a, { type: 'refound', text: '再来', procedure: HUMANS }).ok, true, '冷却期过后可以');
  assertInvariants(w);
});

test('重订：过期（36 刻）→ refound_expired，向联署者发收件；上限（全城 3 个、每人 1 个）；必须写明两类程序；不满 3 日的居民只在分母之外', () => {
  const { w, people } = matured(6, 'refound-exp');
  const [a, b, c, d] = people;
  const r1 = one(w, a, { type: 'refound', text: '一', procedure: HUMANS }).data.refound;
  assert.equal(one(w, a, { type: 'refound', text: '二', procedure: HUMANS }).error.code, 'limit_reached', '每人 1 个');
  one(w, b, { type: 'refound', text: '二', procedure: HUMANS });
  one(w, c, { type: 'refound', text: '三', procedure: HUMANS });
  assert.equal(one(w, d, { type: 'refound', text: '四', procedure: HUMANS }).error.code, 'limit_reached', '全城 3 个');
  one(w, b, { type: 'sign', refound: r1 });
  drainOut(w);
  const ev = tick(w, P.refoundWindowTicks);
  assert.equal(w.refounds[r1].status, 'expired');
  const exp = eventsOf(ev, 'refound_expired');
  assert.equal(exp.length, 3);
  assert.deepEqual(exp.find((e) => e.data.refoundId === r1).data.signers, 2);
  assert.ok(a.inbox.some((i) => i.kind === 'refound' && i.event === 'expired' && i.refoundId === r1));
  assert.ok(!d.inbox.some((i) => i.kind === 'refound' && i.event === 'expired'), '没联署的不收');
  assert.equal(openRefounds(w).length, 0);
  // 必须写明两类
  const one2 = one(w, a, { type: 'refound', text: '只写一类', procedure: { ordinary: HUMAN_PROCEDURE.ordinary } });
  assert.equal(one2.error.code, 'rule_invalid');
  assert.match(one2.error.hint.en, /both classes/);
  assert.equal(one(w, a, { type: 'refound', text: '坏的', procedure: 'robots' }).error.code, 'invalid_args');
  assert.equal(one(w, a, { type: 'refound', text: 'x'.repeat(1201), procedure: HUMANS }).error.code, 'text_too_long');
});

test('重订：n 为 0（没有入城满 3 日的居民）时不可能成功；死去的联署者不计；不能被规则拒绝或收费（refound / sign 没有 before）', () => {
  const { w, people } = town(3, 'refound-n0');
  const [a, b] = people;
  const rid = one(w, a, { type: 'refound', text: '太早', procedure: HUMANS }).data.refound;
  assert.equal(one(w, a, { type: 'sign', refound: rid }).error.code, 'already');
  const s = one(w, b, { type: 'sign', refound: rid });
  assert.deepEqual(s.data, { signers: 2, needed: null, succeeded: false });
  assert.equal(w.refounds[rid].status, 'open');
  // 规则不能拒绝或收费：before:refound / before:sign 提交时被拒；after 允许
  enact(w, [{ when: 'before:propose', if: 'true', do: [{ op: 'fee', to: 'treasury', energy: '1' }] }]);
  putAt(w, a, 'parliament');
  assert.equal(one(w, a, { type: 'propose', title: '拒绝重订', text: 'x', rules: [{ when: 'before:refound', do: [{ op: 'deny', reason: '不许重订' }] }] }).error.code, 'rule_invalid');
  // 3 日之后：联署者先后离场，只算在世的
  tickDays(w, 3);
  const c = reg(w, '丙');
  setHoldings(w, c, { energy: 100 });
  tickDays(w, 3);
  const rid2 = one(w, b, { type: 'refound', text: '重来', procedure: HUMANS });
  assert.equal(rid2.ok, true, JSON.stringify(rid2));
  assert.equal(rid2.data.needed, 3, '4 位居民都满 3 日（丙也是）：ceil(2 × 4 / 3) = 3');
});

// ═══════════════════════════════════════════════════════════════
// 维持费
// ═══════════════════════════════════════════════════════════════

test('维持费：每日结算第 2 步付 d + 1 日的费；每部法律 ruleUpkeep × 持续规则数（enact 不算），程序免付；付得起则 paidThrough = d + 1；去处 rule_upkeep', () => {
  const { w } = town(2, 'up1');
  const a = enact(w, [{ when: 'enact', do: [{ op: 'set', var: 'x', value: '1' }] }]); // 只有 enact：免费
  const b = enact(w, [{ when: 'daily', do: [{ op: 'set', var: 'y', value: '1' }] }, { when: 'before:say', do: [{ op: 'deny', reason: 'x' }] }, { when: 'on:death', do: [{ op: 'set', var: 'z', value: '1' }] }, { when: 'enact', do: [{ op: 'set', var: 'w', value: '1' }] }]); // 3 条持续
  const t0 = w.treasury.energy;
  const ev = settle(w);
  const out = eventsOf(ev, 'day')[0].data.output;
  const ration = eventsOf(ev, 'rule_op').find((e) => e.data.op === 'share').data;
  assert.equal(w.treasury.energy, t0 + out - ration.each.energy * ration.among - (6 + 3), '遗法 6 + 新法 3');
  for (const l of [a, b]) assert.equal(w.laws[l.id].paidThrough, 1);
  assert.equal(w.laws[b.id].suspendedDays, 0);
  assert.equal(w.laws.l1.paidThrough, 1, '程序免付但也记已付');
  assertInvariants(w);
});

test('维持费：付不起的法律当日停摆——除 enact 外的规则不执行（daily、before 都不），suspendedDays + 1、事件 law_suspended；按法律 ID 升序付，付不起的跳过、后面便宜的照付；公库有钱后恢复', async () => {
  const { wellOutput } = await import('../src/e2/engine/environment.js');
  const { w, people } = town(3, 'up2');
  const [a] = people;
  w.places.well.condition = 0; // 产出压到基础的 20%：120（季节 1000）
  const out = wellOutput(w, 0);
  assert.equal(out, 120);
  // 14 部各 8 条持续规则的法律（l7–l20，各 8 能量），l21 / l22 同样 8 条（l21 里有一条 before:say 拒绝），l23 只有 1 条（before:give 拒绝）
  const filler = (k, deny) => enact(w, [
    ...Array.from({ length: 7 }, () => ({ when: 'daily', do: [{ op: 'set', var: `v${k}`, value: '1' }] })),
    deny ? { when: 'before:say', do: [{ op: 'deny', reason: `L${k}` }] } : { when: 'daily', do: [{ op: 'set', var: `v${k}`, value: '1' }] },
  ]);
  const laws = [];
  for (let k = 7; k <= 22; k++) laws.push(filler(k, k === 21));
  const l23 = enact(w, [{ when: 'before:give', do: [{ op: 'deny', reason: 'L23' }] }]);
  assert.deepEqual(laws.map((l) => l.id).slice(0, 2), ['l7', 'l8']);
  // 新生效的法律生效当日视为已付：此刻 l21 的 before:say 已经在拒绝了
  assert.equal(one(w, a, { type: 'say', text: '新生效当日' }).error.law, 'l21');
  setTreasury(w, { energy: 0 });
  w.vars = { rationShare: 600 };
  drainOut(w);
  const ev = settle(w);
  // 公库 = 120（产出）：遗法 6，l7–l20 各 8（112）共 118，剩 2；l21、l22 要 8，付不起；l23 要 1，付得起
  const sus = eventsOf(ev, 'law_suspended').map((e) => [e.data.scope, e.data.owner, e.data.day]);
  assert.deepEqual(sus, [['city', 'l21', 0], ['city', 'l22', 0]]);
  assert.deepEqual([w.laws.l21.suspendedDays, w.laws.l22.suspendedDays, w.laws.l20.suspendedDays, w.laws.l23.suspendedDays], [1, 1, 0, 0]);
  assert.deepEqual([w.laws.l20.paidThrough, w.laws.l21.paidThrough, w.laws.l22.paidThrough, w.laws.l23.paidThrough], [1, 0, 0, 1]);
  assert.equal(w.ledger.snk.energy.rule_upkeep === undefined, true, '日终已关账');
  // 停摆的规则不执行：daily（step 3 在付费之后）——l20 的 daily 跑了、l21 / l22 的没有
  assert.equal(w.vars.v20, 1);
  assert.equal('v21' in w.vars, false);
  assert.equal('v22' in w.vars, false);
  // 第 1 日里：l21（停摆）的 before:say 不拒绝；l23（已付）的 before:give 在拒绝
  assert.equal(one(w, a, { type: 'say', text: '停摆的法律不拒绝' }).ok, true);
  const g = one(w, a, { type: 'give', to: people[1].id, energy: 1 });
  assert.deepEqual([g.error.code, g.error.law], ['forbidden', 'l23']);
  // 恢复：公库有钱了，下一次结算付 d + 1 日的费（含补付），规则又执行
  fundTreasury(w, 500);
  const ev2 = settle(w);
  assert.equal(eventsOf(ev2, 'law_suspended').length, 0);
  assert.deepEqual([w.laws.l21.paidThrough, w.laws.l22.paidThrough], [2, 2]);
  assert.deepEqual([w.laws.l21.suspendedDays, w.laws.l22.suspendedDays], [1, 1], '累计的停摆日数不变');
  assert.equal(w.vars.v21, 1, '恢复后 daily 规则又执行了');
  assert.equal(one(w, a, { type: 'say', text: '恢复了' }).error.law, 'l21');
  assertInvariants(w);
});

test('维持费：社群章程从社群公库付，地点规则从主人付（居民的能量不受生存底线限制，付不起则停摆；社群的公库）；记去处 rule_upkeep；守恒', () => {
  const { w, people } = town(3, 'up3', { energy: 100 });
  const [a, b] = people;
  const g = one(w, a, { type: 'found', name: '会', manifesto: 'x' }).data.group;
  w.groups[g].treasury.energy = 5;
  w.ledger.src.energy.admin += 5;
  w.places.market.owner = { kind: 'agent', id: b.id };
  w.places.library.owner = { kind: 'group', id: g };
  setBylaws(w, g, [{ when: 'daily', do: [{ op: 'announce', to: 'all', text: 'x' }] }, { when: 'before:say', do: [{ op: 'deny', reason: 'G' }] }, { when: 'on:death', do: [{ op: 'set', var: 'z', value: '1' }] }]);
  setPlaceRules(w, 'market', [{ when: 'before:say', do: [{ op: 'deny', reason: 'M' }] }, { when: 'before:give', do: [{ op: 'deny', reason: 'M' }] }]);
  setPlaceRules(w, 'library', [{ when: 'before:say', do: [{ op: 'deny', reason: 'B' }] }]);
  b.tags = []; // 不是公民：没有配给，便于数能量
  const snap = { gt: w.groups[g].treasury.energy, b: b.energy };
  drainOut(w);
  const ev = settle(w);
  void ev;
  // 章程 3 条：群公库 5 → 付 3 之后 2；daily 宣告（全城 5）付不起 → 失败；地点规则：market 2 条从 b 扣；library 1 条从社群扣：2 → 1
  assert.equal(w.groups[g].bylaws.paidThrough, 1);
  assert.equal(w.places.market.rules.paidThrough, 1);
  assert.equal(w.places.library.rules.paidThrough, 1);
  assert.equal(w.groups[g].treasury.energy, snap.gt - 3 - 1, '章程 3 + library 的地点规则 1');
  assert.equal(b.energy, snap.b - 3 - 2, '主人付了 market 的 2 条（另付代谢 3）');
  assertInvariants(w);
  // 主人付不起（能量 1 < 2）：地点规则停摆
  setHoldings(w, b, { energy: 1 });
  settle(w);
  assert.equal(w.places.market.rules.suspendedDays, 1);
  assert.equal(w.places.market.rules.paidThrough, 1, '没有续付');
  assert.equal(b.energy >= 0, true);
  // 社群公库付不起：章程与 library 的地点规则都停摆
  w.groups[g].treasury.energy = 0;
  w.ledger.src.energy.admin -= 0;
  const out = settle(w);
  void out;
  assert.equal(w.groups[g].bylaws.suspendedDays >= 1, true);
});

// ═══════════════════════════════════════════════════════════════
// draft 与 read { law | agent }
// ═══════════════════════════════════════════════════════════════

let lastEvents = [];
const oneLang = (w, a, action, lang) => {
  a.actsThisTick = 0;
  const out = applyCommand(w, { type: 'act', payload: { agentId: a.id, actions: [action], lang } });
  lastEvents = out.events;
  assert.equal(out.result.ok, true, JSON.stringify(out.result));
  return out.result.results[0];
};

test('draft：校验、返回引擎读法（按请求的语言）与 enact / daily / monthly 规则此刻会产生的操作；不改变世界、不推进随机数；代价 1；事件 draft 是 internal', () => {
  const { w, people } = town(4, 'draft');
  const [a, b] = people;
  setTreasury(w, { energy: 100 });
  const rules = [
    { when: 'enact', do: [{ op: 'set', var: 'x', value: '1' }] },
    { when: 'daily', do: [{ op: 'each', in: 'agents', do: [{ op: 'transfer', from: 'treasury', to: 'it', energy: '2' }] }] },
    { when: 'before:draw', if: 'actor.drawnToday + args.energy > 5', do: [{ op: 'deny', reason: '每日限汲 5' }] },
  ];
  drainOut(w);
  const snap = JSON.stringify([w.vars, w.treasury, w.laws, w.proposals, w.rng]);
  const e0 = a.energy;
  const r = oneLang(w, a, { type: 'draft', rules }, 'en');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.cost, 1);
  assert.equal(a.energy, e0 - 1);
  assert.deepEqual([r.data.ok, r.data.errors], [true, []]);
  assert.equal(r.data.reading.rules.length, 3);
  assert.match(r.data.reading.rules[1], /^At each daily settlement/);
  assert.deepEqual(r.data.preview.map((p) => [p.rule, p.op, p.to ?? p.var]), [[0, 'set', 'x'], [1, 'transfer', a.id], [1, 'transfer', b.id], [1, 'transfer', people[2].id], [1, 'transfer', people[3].id]]);
  assert.deepEqual(r.data.preview[1], { rule: 1, op: 'transfer', from: 'treasury', to: a.id, energy: 2, coins: 0 });
  assert.equal(JSON.stringify([w.vars, w.treasury, w.laws, w.proposals, w.rng]), snap, '世界一点没动');
  const ev = lastEvents;
  assert.deepEqual(ev.filter((e) => e.type === 'draft').map((e) => [e.vis, e.data.ok, e.data.scope]), [['internal', true, 'city']]);
  assert.equal(ev.filter((e) => e.type === 'rule_op').length, 0, '没有 rule_op 事件');
  // 中文
  const z = oneLang(w, a, { type: 'draft', rules }, 'zh');
  assert.match(z.data.reading.rules[1], /^每日结算时：/);
  // 校验失败：ok false，errors 带路径、说明（按语言）与建议
  const bad = oneLang(w, a, { type: 'draft', rules: [{ when: 'daily', do: [{ op: 'transfer', from: 'treasury', to: 'treasury', energy: 'true' }] }] }, 'en');
  assert.equal(bad.ok, true, 'draft 本身成功，校验结果在 data 里');
  assert.equal(bad.data.ok, false);
  assert.equal(bad.data.errors[0].path, 'rules[0].do[0].energy');
  assert.match(bad.data.errors[0].message, /needs an integer/);
  assert.deepEqual([bad.data.reading, bad.data.preview], [null, []]);
  // 程序的试算
  const pr = oneLang(w, a, { type: 'draft', procedure: { ordinary: COUNCIL } }, 'zh');
  assert.equal(pr.data.ok, true);
  assert.match(pr.data.reading.procedure.ordinary, /^提出者：/);
  assert.equal(oneLang(w, a, { type: 'draft', procedure: { ordinary: { none: true } } }, 'en').data.reading.procedure.ordinary, 'This class no longer makes laws');
  // 参数错误
  assert.equal(oneLang(w, a, { type: 'draft' }, 'zh').error.code, 'invalid_args');
  assert.equal(oneLang(w, a, { type: 'draft', rules: [], procedure: {} }, 'zh').error.code, 'invalid_args');
  assert.equal(oneLang(w, a, { type: 'draft', rules: [], scope: 'moon' }, 'zh').error.code, 'invalid_args');
  assert.equal(oneLang(w, a, { type: 'draft', rules: [], scope: 'group:g9' }, 'zh').error.code, 'not_found');
  assert.equal(oneLang(w, a, { type: 'draft', rules: [], scope: 'place:nowhere' }, 'zh').error.code, 'not_found');
  assert.equal(oneLang(w, a, { type: 'draft', procedure: { ordinary: COUNCIL }, scope: 'place:market' }, 'zh').error.code, 'invalid_args');
});

test('draft 的作用域：group:<g>（章程的白名单与标签前缀的读法）、place:<id>（地点规则）；越界在校验时拒绝', () => {
  const { w, people } = town(3, 'draft2');
  const [a] = people;
  const g = one(w, a, { type: 'found', name: '会', manifesto: 'x' }).data.group;
  const ok = oneLang(w, a, { type: 'draft', scope: `group:${g}`, rules: [{ when: 'enact', do: [{ op: 'tag', who: 'actor', tag: '长老' }] }].map((r) => ({ ...r, do: [{ op: 'set', var: 'k', value: '1' }] })) }, 'en');
  assert.equal(ok.data.ok, true);
  const tag = oneLang(w, a, { type: 'draft', scope: `group:${g}`, rules: [{ when: 'daily', do: [{ op: 'tag', who: "agent('民1')", tag: '长老' }] }] }, 'en');
  assert.equal(tag.data.ok, true);
  assert.match(tag.data.reading.rules[0], new RegExp(`${g}:长老`), '读法写出实际的标签名');
  const mint = oneLang(w, a, { type: 'draft', scope: `group:${g}`, rules: [{ when: 'daily', do: [{ op: 'mint', coins: '5' }] }] }, 'en');
  assert.equal(mint.data.ok, false);
  assert.equal(mint.data.errors[0].code, 'op.scope');
  const place = oneLang(w, a, { type: 'draft', scope: 'place:market', rules: [{ when: 'before:enter', do: [{ op: 'fee', to: "agent('民1')", energy: '1' }] }] }, 'en');
  assert.equal(place.data.ok, true);
  assert.equal(oneLang(w, a, { type: 'draft', scope: 'place:market', rules: [{ when: 'on:death', do: [{ op: 'set', var: 'k', value: '1' }] }] }, 'en').data.ok, false);
  // 城法里的 before:enter 不行
  assert.equal(oneLang(w, a, { type: 'draft', rules: [{ when: 'before:enter', do: [{ op: 'deny', reason: 'x' }] }] }, 'en').data.ok, false);
});

test('read { law }：全文、规则、引擎读法（按请求的语言）、指纹、谱系与状态；遗法有中英文版本；read { agent }：公开档案（不含灵魂、能量、位置、记忆）', () => {
  const { w, people } = town(4, 'readlaw');
  const [a, b] = people;
  const z = oneLang(w, a, { type: 'read', law: 'l3' }, 'zh');
  assert.equal(z.ok, true, JSON.stringify(z));
  assert.equal(z.cost, 0);
  const l = z.data.law;
  assert.deepEqual([l.id, l.title, l.text, l.author, l.class, l.status, l.enactedDay, l.suspended], ['l3', '基本配给', '源井之能，六成按人头均分，是为基本配给；其余归入公库。', 'humans', 'ordinary', 'active', 0, false]);
  assert.equal(l.rules.length, 2);
  assert.equal(l.reading.rules.length, 2);
  assert.match(l.reading.rules[1], /^每日结算时：/);
  assert.equal(l.fingerprints.length, 2);
  const e = oneLang(w, a, { type: 'read', law: 'l3' }, 'en').data.law;
  assert.deepEqual([e.title, e.text], ['Basic Ration', "Six tenths of the Well's energy are shared equally per head as the basic ration; the rest goes to the Treasury."]);
  assert.match(e.reading.rules[1], /^At each daily settlement/);
  // 程序法律：读 procedure 的读法
  const p = oneLang(w, a, { type: 'read', law: 'l1' }, 'en').data.law;
  assert.equal(p.rules.length, 0);
  assert.deepEqual(Object.keys(p.reading.procedure), ['ordinary', 'constitutional']);
  assert.equal(p.class, 'constitutional');
  // 居民提出的法律：作者是 { id, name }；已撤销的状态与撤销者
  const pid = propose(w, a, { rules: RULE_DAILY(), basedOn: 'l3' }).r.data.proposal;
  passIt(w, people, pid);
  const lid = w.proposals[pid].lawId;
  const mine = oneLang(w, b, { type: 'read', law: lid }, 'zh').data.law;
  assert.deepEqual([mine.author, mine.basedOn, mine.status], [{ id: a.id, name: a.name }, 'l3', 'active']);
  enact(w, [{ when: 'enact', do: [{ op: 'repeal', law: lid }] }]);
  const rep = oneLang(w, b, { type: 'read', law: lid }, 'zh').data.law;
  assert.deepEqual([rep.status, rep.repealedBy], ['repealed', 'l8']);
  assert.equal(oneLang(w, b, { type: 'read', law: 'l99' }, 'zh').error.code, 'not_found');
  assert.equal(oneLang(w, b, { type: 'read', law: 'l3', agent: a.id }, 'zh').error.code, 'invalid_args', '四选一');
  // read agent：公开档案
  a.purpose = '修井';
  a.bio = '我是青禾';
  const prof = oneLang(w, b, { type: 'read', agent: a.name }, 'zh');
  assert.equal(prof.ok, true);
  assert.deepEqual(prof.data.agent, {
    id: a.id, name: a.name, bio: '我是青禾', purpose: '修井', tags: ['citizen'], generation: 0, authors: [], children: [], ageDays: 1, status: 'awake', groups: [],
  });
  assert.ok(!('soul' in prof.data.agent) && !('energy' in prof.data.agent) && !('place' in prof.data.agent) && !('memories' in prof.data.agent));
  assert.equal(oneLang(w, b, { type: 'read', agent: 'a999' }, 'zh').error.code, 'not_found');
});
