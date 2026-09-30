import test from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/params.js';
import { describeEffect } from '../src/engine/laws.js';
import { newWorld, reg, act, actRaw, one, tick, settle, grant, fundTreasury, eventsOf, assertInvariants } from './helpers.js';

/** n 位公民，全在议会；表决期缩短为 3 刻，避免跨日结算干扰 */
function setup(n = 3, { proposalDays = 0.25 } = {}) {
  const w = newWorld('law');
  w.params.proposalDays = proposalDays;
  const agents = Array.from({ length: n }, (_, i) => reg(w, `人${i + 1}`));
  for (const a of agents) a.place = 'parliament';
  return { w, agents };
}
const propose = (w, a, o = {}) => one(w, a, { type: 'propose', title: '题', text: '文', ...o });
const vote = (w, a, p, choice, reason) => one(w, a, { type: 'vote', proposal: p, choice, reason });
const resolve = (w) => tick(w, 3);
/** 让 yes 位赞成、no 位反对、abstain 位弃权（从前往后取），返回提案 ID */
function run(w, agents, opts, votes) {
  const r = propose(w, agents[0], opts);
  assert.equal(r.ok, true, JSON.stringify(r));
  let i = 0;
  for (const [choice, n] of Object.entries(votes)) {
    for (let k = 0; k < n; k++) assert.equal(vote(w, agents[i++], r.data.proposal, choice).ok, true);
  }
  const ev = resolve(w);
  return { id: r.data.proposal, ev, p: w.proposals[r.data.proposal] };
}

// ── propose ────────────────────────────────────────────────

test('propose：在议会提出，花 6 能量；记录提案、事件与表决期', () => {
  const { w, agents: [a] } = setup(1);
  const { result, events } = actRaw(w, a, [{ type: 'propose', title: '守井人津贴', text: '源井在衰败。', effects: [{ type: 'stipend', to: a.id, energy: 5 }] }]);
  const r = result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.cost, 6);
  assert.deepEqual(r.data, { proposal: 'p1', closesTick: 3, governance: false });
  const p = w.proposals.p1;
  assert.deepEqual([p.title, p.status, p.proposer, p.openedTick, p.closesTick, p.lawId, p.tally, p.governance], ['守井人津贴', 'open', a.id, 0, 3, null, null, false]);
  assert.deepEqual(p.effects, [{ type: 'stipend', to: a.id, energy: 5 }]);
  const ev = eventsOf(events, 'propose')[0];
  assert.equal(ev.data.proposalId, 'p1');
  assert.equal(ev.data.text, '源井在衰败。');
  assert.equal(w.dayLog.proposals, 1);
  assert.equal(a.energy, 34);
});

test('propose：表决期 = round(proposalDays × 12) 刻，至少 1 刻', () => {
  const w = newWorld('law');
  const a = reg(w, '甲');
  a.place = 'parliament';
  grant(w, a, 100);
  assert.equal(propose(w, a).data.closesTick, 12); // 1 日
  w.params.proposalDays = 0.25;
  a.actsThisTick = 0;
  // 同一 agent 同时只能有一个进行中的提案，所以换人
  const b = reg(w, '乙');
  b.place = 'parliament';
  assert.equal(propose(w, b).data.closesTick, 3);
  w.params.proposalDays = 7;
  const c = reg(w, '丙');
  c.place = 'parliament';
  assert.equal(propose(w, c).data.closesTick, 84);
});

test('propose：前置条件与错误', () => {
  const { w, agents: [a, b] } = setup(2);
  a.place = 'agora';
  assert.equal(propose(w, a).error.code, 'wrong_place');
  a.place = 'parliament';
  a.exiled = true;
  assert.equal(propose(w, a).error.code, 'exiled');
  a.exiled = false;
  w.params.naturalizationDays = 5;
  const late = reg(w, '新人');
  late.place = 'parliament';
  assert.equal(propose(w, late).error.code, 'not_citizen');
  w.params.naturalizationDays = 0;
  assert.equal(propose(w, a, { title: '' }).error.code, 'invalid_args');
  assert.equal(propose(w, a, { title: 'x'.repeat(61) }).error.code, 'text_too_long');
  assert.equal(propose(w, a, { text: 'x'.repeat(1201) }).error.code, 'text_too_long');
  assert.equal(propose(w, a, { text: '' }).error.code, 'invalid_args');
  assert.equal(propose(w, a, { effects: 'x' }).error.code, 'invalid_args');
  assert.equal(propose(w, a, { effects: Array(6).fill({ type: 'mint', coins: 1, to: 'treasury' }) }).error.code, 'invalid_args');
  assert.equal(a.energy, 40); // 失败不扣能量
  assert.equal(propose(w, a).ok, true);
  assert.equal(propose(w, a).error.code, 'limit_reached'); // 每人同时最多 1 个进行中的提案
  assert.equal(propose(w, b).ok, true);
});

test('propose：全城同时进行中的提案最多 20 个', () => {
  const w = newWorld('law');
  const agents = Array.from({ length: 21 }, (_, i) => reg(w, `人${i + 1}`));
  for (const a of agents) a.place = 'parliament';
  for (let i = 0; i < 20; i++) assert.equal(propose(w, agents[i]).ok, true, `#${i}`);
  assert.equal(propose(w, agents[20]).error.code, 'limit_reached');
});

test('propose：效力校验——任何一条不合法即整个提案被拒，并说明是哪一条', () => {
  const { w, agents: [a] } = setup(1);
  const bad = (effects, msg) => {
    const r = propose(w, a, { effects });
    assert.equal(r.error.code, 'invalid_args', msg);
    assert.ok(r.error.hint && r.error.hint.zh.includes('效力'), msg);
    assert.equal(w.proposals.p1, undefined, msg);
    assert.equal(a.energy, 40, msg);
    return r;
  };
  bad([{ type: 'nonsense' }], '未知类型');
  bad(['x'], '不是对象');
  bad([{ type: 'set', param: 'nope', value: 1 }], '未知参数');
  bad([{ type: 'set', param: 'rationShare', value: 1.5 }], '越界');
  bad([{ type: 'set', param: 'rationShare', value: '0.5' }], '类型');
  bad([{ type: 'set', param: 'quorum', value: 0.01 }], '越界');
  bad([{ type: 'set', param: 'passThreshold', value: 0.4 }], '越界');
  bad([{ type: 'set', param: 'wealthTaxThreshold', value: 1.5 }], '应为整数');
  bad([{ type: 'set', param: 'drawQuotaPerDay', value: 1001 }], '越界');
  bad([{ type: 'set', param: 'votingInPerson', value: 'yes' }], '类型');
  bad([{ type: 'set', param: 'electorate', value: 'group:g9' }], '社群不存在');
  bad([{ type: 'set', param: 'electorate', value: 'some' }], '格式');
  bad([{ type: 'grant', to: a.id }], '至少一项');
  bad([{ type: 'grant', to: 'a99', energy: 5 }], '目标不存在');
  bad([{ type: 'grant', to: a.id, energy: -1 }], '负数');
  bad([{ type: 'stipend', to: a.id, energy: 0 }], '范围');
  bad([{ type: 'stipend', to: a.id, energy: 101 }], '范围');
  bad([{ type: 'fund', project: 'j9', energy: 5 }], '工程不存在');
  bad([{ type: 'exile', target: 'a99' }], '目标不存在');
  bad([{ type: 'exile', target: 'g1' }], '不是居民');
  bad([{ type: 'rename', target: 'moon', name: 'x' }], '目标');
  bad([{ type: 'rename', target: 'temple', name: '' }], '名字为空');
  bad([{ type: 'rename', target: 'temple', name: 'x'.repeat(25) }], '名字过长');
  bad([{ type: 'rename', target: 'temple', name: '议会' }], '与其他地点重名');
  bad([{ type: 'rename', target: 'temple', name: 'parliament' }], '与英文名重名');
  bad([{ type: 'mint', coins: 0, to: 'treasury' }], '范围');
  bad([{ type: 'mint', coins: 10001, to: 'treasury' }], '范围');
  bad([{ type: 'mint', coins: 5, to: 'everyone' }], '目标');
  bad([{ type: 'protect', inscription: 'i99' }], '铭刻不存在');
  bad([{ type: 'amend', article: 11, lang: 'zh', text: 'x' }], '条号越界');
  bad([{ type: 'amend', article: 0, lang: 'zh', text: 'x' }], '条号越界');
  bad([{ type: 'amend', article: 10, lang: 'zh', text: '' }], '新增条文不能为空');
  bad([{ type: 'amend', article: 1, lang: '???', text: 'x' }], '语言');
  bad([{ type: 'amend', article: 1, lang: 'zh', text: 'x'.repeat(301) }], '过长');
  bad([{ type: 'amend', canonical: 5 }], '正本');
  bad([{ type: 'repeal', law: 'l9' }], '法律不存在');
  // 合法的与不合法的混在一起：整个被拒
  bad([{ type: 'mint', coins: 5, to: 'treasury' }, { type: 'set', param: 'nope', value: 1 }], '混合');
});

test('propose：效力被规范化保存——按名字引用的 agent 存 ID；数值参数四舍五入到 3 位小数；无关字段被丢弃', () => {
  const { w, agents: [a, b] } = setup(2);
  const r = propose(w, a, {
    effects: [
      { type: 'set', param: 'wealthTax', value: 0.12345, junk: 1 },
      { type: 'grant', to: '人2', energy: 3 },
      { type: 'rename', target: 'temple', name: '  回声堂 ' },
    ],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(w.proposals.p1.effects, [
    { type: 'set', param: 'wealthTax', value: 0.123 },
    { type: 'grant', to: b.id, energy: 3, coins: 0 },
    { type: 'rename', target: 'temple', name: '回声堂' },
  ]);
});

test('修宪级判定：修宪级参数的 set、electorate 的 set、amend 中任意一种', () => {
  const { w, agents } = setup(21);
  const gov = (effects) => {
    const a = agents.find((x) => !Object.values(w.proposals).some((p) => p.proposer === x.id));
    const r = propose(w, a, { effects });
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.data.governance;
  };
  assert.equal(gov([]), false);
  assert.equal(gov([{ type: 'set', param: 'rationShare', value: 0.8 }]), false);
  assert.equal(gov([{ type: 'set', param: 'drawQuotaPerDay', value: 5 }]), false);
  assert.equal(gov([{ type: 'set', param: 'quorum', value: 0.4 }]), true);
  assert.equal(gov([{ type: 'set', param: 'passThreshold', value: 0.6 }]), true);
  assert.equal(gov([{ type: 'set', param: 'amendThreshold', value: 0.8 }]), true);
  assert.equal(gov([{ type: 'set', param: 'proposalDays', value: 2 }]), true);
  assert.equal(gov([{ type: 'set', param: 'naturalizationDays', value: 3 }]), true);
  assert.equal(gov([{ type: 'set', param: 'electorate', value: 'all' }]), true);
  assert.equal(gov([{ type: 'amend', article: 8, lang: 'zh', text: '言论自由，并为之负责。' }]), true);
  assert.equal(gov([{ type: 'amend', canonical: 'es' }]), true);
  assert.equal(gov([{ type: 'mint', coins: 1, to: 'treasury' }, { type: 'set', param: 'quorum', value: 0.4 }]), true);
});

// ── vote ───────────────────────────────────────────────────

test('vote：赞成 / 反对 / 弃权，可改票，以最后一次为准；产生事件', () => {
  const { w, agents: [a, b] } = setup(2);
  propose(w, a);
  const { result, events } = actRaw(w, b, [{ type: 'vote', proposal: 'p1', choice: 'no', reason: '不同意' }]);
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[0].cost, 0);
  assert.deepEqual(w.proposals.p1.votes[b.id], { choice: 'no', reason: '不同意', tick: 0 });
  const ev = eventsOf(events, 'vote')[0];
  assert.deepEqual(ev.data, { proposalId: 'p1', choice: 'no', reason: '不同意', changed: false });
  assert.equal(vote(w, b, 'p1', 'yes').ok, true);
  assert.equal(w.proposals.p1.votes[b.id].choice, 'yes');
  assert.equal(w.proposals.p1.votes[b.id].reason, null);
  assert.equal(Object.keys(w.proposals.p1.votes).length, 1);
});

test('vote：错误——提案不存在或已结束、选项、理由过长、不在选民范围、亲临议会', () => {
  const { w, agents: [a, b] } = setup(2);
  propose(w, a);
  assert.equal(vote(w, b, 'p9', 'yes').error.code, 'not_found');
  assert.equal(vote(w, b, 'p1', 'maybe').error.code, 'invalid_args');
  assert.equal(vote(w, b, 'p1', undefined).error.code, 'invalid_args');
  assert.equal(one(w, b, { type: 'vote', proposal: 'p1', choice: 'yes', reason: 'x'.repeat(141) }).error.code, 'text_too_long');
  assert.equal(one(w, b, { type: 'vote', proposal: 5, choice: 'yes' }).error.code, 'invalid_args');
  b.exiled = true;
  assert.equal(vote(w, b, 'p1', 'yes').error.code, 'exiled');
  b.exiled = false;
  w.params.votingInPerson = true;
  b.place = 'agora';
  assert.equal(vote(w, b, 'p1', 'yes').error.code, 'wrong_place');
  b.place = 'parliament';
  assert.equal(vote(w, b, 'p1', 'yes').ok, true);
  w.params.votingInPerson = false;
  w.params.naturalizationDays = 3;
  const late = reg(w, '新人');
  assert.equal(vote(w, late, 'p1', 'yes').error.code, 'not_citizen');
  resolve(w);
  assert.equal(vote(w, b, 'p1', 'yes').error.code, 'not_found'); // 已结束
});

// ── 计票的边界（恰好等于时） ───────────────────────────────────

test('计票：法定参与率恰好等于 30% 时通过；差一票不通过', () => {
  {
    const { w, agents } = setup(10);
    const { p } = run(w, agents, {}, { yes: 3 }); // 3 / 10 = 30%
    assert.equal(p.status, 'passed');
    assert.deepEqual([p.tally.electorate, p.tally.yes, p.tally.participation, p.tally.approval], [10, 3, 0.3, 1]);
  }
  {
    const { w, agents } = setup(10);
    const { p } = run(w, agents, {}, { yes: 2 });
    assert.equal(p.status, 'rejected');
    assert.equal(p.tally.participation, 0.2);
  }
});

test('计票：普通提案的赞成率必须严格大于 50%（恰好一半不通过）；弃权计入参与率但不计入赞成率', () => {
  {
    const { w, agents } = setup(4);
    assert.equal(run(w, agents, {}, { yes: 2, no: 2 }).p.status, 'rejected'); // 50% 不算「过半」
  }
  {
    const { w, agents } = setup(5);
    assert.equal(run(w, agents, {}, { yes: 3, no: 2 }).p.status, 'passed'); // 60%
  }
  {
    const { w, agents } = setup(10);
    const { p } = run(w, agents, {}, { yes: 1, no: 0, abstain: 2 }); // 参与 3/10；赞成 1/(1+0)
    assert.equal(p.status, 'passed');
    assert.equal(p.tally.abstain, 2);
  }
  {
    const { w, agents } = setup(10);
    const { p } = run(w, agents, {}, { abstain: 10 }); // 全弃权：没有赞成也没有反对
    assert.equal(p.status, 'rejected');
  }
  {
    const { w, agents } = setup(3);
    const { p } = run(w, agents, {}, {}); // 无人投票
    assert.equal(p.status, 'rejected');
    assert.deepEqual(p.tally, { electorate: 3, yes: 0, no: 0, abstain: 0, participation: 0, approval: 0 });
  }
});

test('计票：修宪级提案的赞成率须 ≥ amendThreshold（0.667）；恰好三分之二不够（见 QUESTIONS Q6）', () => {
  const eff = [{ type: 'set', param: 'naturalizationDays', value: 2 }];
  {
    const { w, agents } = setup(3);
    const { p } = run(w, agents, { effects: eff }, { yes: 2, no: 1 }); // 2/3 = 0.6667 < 0.667
    assert.equal(p.status, 'rejected');
  }
  {
    const { w, agents } = setup(4);
    const { p } = run(w, agents, { effects: eff }, { yes: 3, no: 1 }); // 0.75
    assert.equal(p.status, 'passed');
  }
  {
    // 恰好等于：把门槛设成 0.5，2 赞成 2 反对 = 0.5，修宪级用 ≥，通过；普通提案用 >，不通过
    const { w, agents } = setup(4);
    w.params.amendThreshold = 0.5;
    assert.equal(run(w, agents, { effects: eff }, { yes: 2, no: 2 }).p.status, 'passed');
  }
  {
    const { w, agents } = setup(4);
    w.params.amendThreshold = 0.5;
    assert.equal(run(w, agents, {}, { yes: 2, no: 2 }).p.status, 'rejected');
  }
});

test('计票：沉睡的公民计入选民（稀释参与率）；被放逐者、已死者的票不算', () => {
  const { w, agents } = setup(10);
  agents[8].status = 'dormant';
  agents[9].status = 'dormant';
  agents[8].energy = 0;
  agents[9].energy = 0;
  w.ledger.prev.energy -= 80;
  const r = propose(w, agents[0]);
  vote(w, agents[0], 'p1', 'yes');
  vote(w, agents[1], 'p1', 'yes');
  vote(w, agents[2], 'p1', 'yes');
  // 投完票后，其中一位被放逐、一位死去：他们的票作废
  agents[2].exiled = true;
  resolve(w);
  const p = w.proposals.p1;
  // 选民 = 10 − 1（被放逐）= 9（沉睡的两位仍在其中）；有效票 2
  assert.equal(p.tally.electorate, 9);
  assert.equal(p.tally.yes, 2);
  assert.equal(p.status, 'rejected'); // 2/9 < 30%
  assert.ok(r.ok);
});

test('计票：同一刻多个提案按 ID 升序处理，后一个看到前一个改过的参数', () => {
  const { w, agents } = setup(4);
  const p1 = propose(w, agents[0], { effects: [{ type: 'set', param: 'quorum', value: 1 }] }).data.proposal; // 修宪级
  const p2 = propose(w, agents[1], {}).data.proposal;
  for (const a of agents) vote(w, a, p1, 'yes');
  vote(w, agents[0], p2, 'yes'); // 只有 1/4 参与
  resolve(w);
  assert.equal(w.proposals[p1].status, 'passed');
  assert.equal(w.params.quorum, 1); // 法定参与率被改成 100%
  assert.equal(w.proposals[p2].status, 'rejected'); // 后一个提案按新的法定参与率计票
});

// ── 通过与否决的后果 ──────────────────────────────────────────

test('通过：生成法律，产生 law_passed 事件与结果，提案者与投票者收到 law 收件；否决则收到 rejected', () => {
  const { w, agents: [a, b, c] } = setup(3);
  const { ev, p } = run(w, [a, b, c], { title: '增发', effects: [{ type: 'mint', coins: 9, to: 'citizens' }] }, { yes: 3 });
  assert.equal(p.status, 'passed');
  assert.equal(p.lawId, 'l1');
  const law = w.laws.l1;
  assert.deepEqual([law.title, law.status, law.repealedBy, law.proposalId, law.enactedTick], ['增发', 'active', null, 'p1', 3]);
  assert.deepEqual(law.results, [{ index: 0, ok: true, note: '' }]);
  const passed = eventsOf(ev, 'law_passed')[0];
  assert.equal(passed.data.lawId, 'l1');
  assert.deepEqual(passed.data.tally, p.tally);
  for (const x of [a, b, c]) {
    const n = x.inbox.filter((i) => i.kind === 'law');
    assert.equal(n.length, 1);
    assert.deepEqual([n[0].proposalId, n[0].lawId, n[0].result, n[0].title], ['p1', 'l1', 'passed', '增发']);
  }
  assert.deepEqual(w.dayLog.laws, [{ proposalId: 'p1', title: '增发', passed: true, yes: 3, no: 0, lawId: 'l1' }]);
  // 否决
  const d = reg(w, '丁');
  d.place = 'parliament';
  a.actsThisTick = 0;
  const r2 = propose(w, a, { title: '空谈' });
  vote(w, b, r2.data.proposal, 'no');
  const ev2 = resolve(w);
  assert.equal(w.proposals.p2.status, 'rejected');
  assert.equal(eventsOf(ev2, 'law_rejected').length, 1);
  assert.equal(w.laws.l2, undefined);
  assert.ok(a.inbox.some((i) => i.kind === 'law' && i.result === 'rejected' && i.lawId === null));
  assert.ok(b.inbox.some((i) => i.kind === 'law' && i.result === 'rejected'));
  assert.ok(!c.inbox.some((i) => i.kind === 'law' && i.proposalId === 'p2'));
  assertInvariants(w);
});

test('规范：没有效力的法律同样生成法律记录，只是没有机制作用', () => {
  const { w, agents } = setup(3);
  const { p } = run(w, agents, { title: '倡议', text: '请大家互相照顾。' }, { yes: 3 });
  assert.equal(p.status, 'passed');
  assert.deepEqual(w.laws.l1.effects, []);
  assert.deepEqual(w.laws.l1.results, []);
  assert.equal(w.laws.l1.status, 'active');
});

// ── 各种效力的执行 ────────────────────────────────────────────

test('set：立即修改参数；撤销该法律不会恢复原值', () => {
  const { w, agents } = setup(3);
  run(w, agents, { effects: [{ type: 'set', param: 'rationShare', value: 0.8 }, { type: 'set', param: 'drawQuotaPerDay', value: 5 }, { type: 'set', param: 'votingInPerson', value: true }] }, { yes: 3 });
  assert.equal(w.params.rationShare, 0.8);
  assert.equal(w.params.drawQuotaPerDay, 5);
  assert.equal(w.params.votingInPerson, true);
  // 撤销
  for (const a of agents) a.actsThisTick = 0;
  const { p } = run(w, agents, { effects: [{ type: 'repeal', law: 'l1' }] }, { yes: 3 });
  assert.equal(p.status, 'passed');
  assert.equal(w.laws.l1.status, 'repealed');
  assert.equal(w.laws.l1.repealedBy, 'l2');
  assert.equal(w.params.rationShare, 0.8); // 一次性：没有回滚
  assert.equal(w.params.drawQuotaPerDay, 5);
  // drawQuotaPerDay 可以设回 null
  run(w, agents, { effects: [{ type: 'set', param: 'drawQuotaPerDay', value: null }] }, { yes: 3 });
  assert.equal(w.params.drawQuotaPerDay, null);
});

test('grant：从公库拨付，数额取请求与公库余额的较小者；可以唤醒沉睡者；给社群；目标已死则失败', () => {
  const { w, agents } = setup(3);
  fundTreasury(w, 12, 4);
  const sleeper = agents[2];
  sleeper.status = 'dormant';
  sleeper.energy = 0;
  sleeper.dormantSinceDay = 0;
  w.ledger.prev.energy -= 40;
  // 先投票给两位存活者，让沉睡者也在选民内（3 人选民，2 票 = 67%）
  const { ev } = run(w, agents, { effects: [{ type: 'grant', to: sleeper.id, energy: 20, coins: 3 }] }, { yes: 2 });
  const res = w.laws.l1.results[0];
  assert.deepEqual(res, { index: 0, ok: true, note: 'partial:15/23' }); // 请求 20+3，公库只有 12 能量 + 4 旧币 → 12 + 3
  assert.equal(sleeper.energy, 12);
  assert.equal(sleeper.coins, 20 + 3);
  assert.equal(sleeper.status, 'awake'); // 12 ≥ 5：被唤醒
  assert.ok(sleeper.inbox.some((i) => i.kind === 'revived' && i.by.lawId === 'l1'));
  assert.ok(sleeper.inbox.some((i) => i.kind === 'grant' && i.lawId === 'l1' && i.energy === 12 && i.coins === 3));
  assert.equal(w.treasury.energy, 0);
  assert.equal(w.treasury.coins, 1);
  assert.deepEqual(eventsOf(ev, 'grant')[0].data, { lawId: 'l1', to: sleeper.id, energy: 12, coins: 3 });
  // 给社群
  w.groups.g1 = { id: 'g1', name: '会', manifesto: '', open: true, founder: agents[0].id, steward: agents[0].id, members: [agents[0].id], pending: [], treasury: { energy: 0, coins: 0 }, createdDay: 0, dissolved: false };
  agents[0].groups.push('g1');
  fundTreasury(w, 30);
  for (const a of agents) a.actsThisTick = 0;
  run(w, agents, { effects: [{ type: 'grant', to: 'g1', energy: 10 }] }, { yes: 3 });
  assert.equal(w.groups.g1.treasury.energy, 10);
  assert.equal(w.treasury.energy, 20);
  // 提案时目标还活着，执行时已死：该条失败，其余照常
  const target = reg(w, '将逝者');
  const ee = [{ type: 'grant', to: target.id, energy: 5 }, { type: 'mint', coins: 3, to: 'treasury' }];
  for (const a of agents) a.actsThisTick = 0;
  const r = propose(w, agents[0], { effects: ee });
  for (const a of agents) vote(w, a, r.data.proposal, 'yes');
  target.status = 'dead';
  target.energy = 0;
  target.coins = 0;
  w.ledger.prev.energy -= 40;
  w.ledger.prev.coins -= 20;
  resolve(w);
  assert.deepEqual(w.laws.l3.results, [{ index: 0, ok: false, note: 'target_gone' }, { index: 1, ok: true, note: '' }]);
  assertInvariants(w);
});

test('stipend：法律有效期间每日从公库支付给收款人，记 stipend 事件与收件', () => {
  const { w, agents: [a, b, c] } = setup(3);
  w.params.rationShare = 0; // 源井产出全进公库，方便核对
  run(w, [a, b, c], { title: '津贴一', effects: [{ type: 'stipend', to: a.id, energy: 30 }] }, { yes: 3 });
  for (const x of [a, b, c]) x.actsThisTick = 0;
  run(w, [a, b, c], { title: '津贴二', effects: [{ type: 'stipend', to: b.id, energy: 60 }] }, { yes: 3 });
  for (const x of [a, b, c]) x.actsThisTick = 0;
  run(w, [a, b, c], { title: '津贴三', effects: [{ type: 'stipend', to: c.id, energy: 5 }] }, { yes: 3 });
  assert.deepEqual(w.laws.l2.results, [{ index: 0, ok: true, note: '' }]);
  const before = { a: a.energy, b: b.energy, c: c.energy };
  const ev = settle(w); // 第 0 日：源井产出 600 全进公库，津贴共 95
  assert.equal(a.energy, before.a + 30 - 3); // 减去代谢
  assert.equal(b.energy, before.b + 60 - 3);
  assert.equal(c.energy, before.c + 5 - 3);
  assert.deepEqual(eventsOf(ev, 'stipend').map((e) => [e.data.lawId, e.data.to, e.data.energy]), [['l1', a.id, 30], ['l2', b.id, 60], ['l3', c.id, 5]]);
  assert.ok(a.inbox.some((i) => i.kind === 'stipend' && i.lawId === 'l1' && i.energy === 30));
  // 只要法律有效，次日继续支付
  const ev2 = settle(w);
  assert.equal(eventsOf(ev2, 'stipend').length, 3);
  assertInvariants(w);
});

test('stipend：公库不足时跳过该条、继续下一条；撤销法律后停付；收款人已死则跳过', () => {
  const { w, agents: [a, b, c] } = setup(3);
  w.params.rationShare = 0;
  // 直接建立三部有津贴的法律（绕过投票，专注结算逻辑）
  const mkLaw = (id, to, energy) => {
    w.laws[id] = { id, proposalId: 'p0', title: id, text: '', effects: [{ type: 'stipend', to, energy }], results: [], enactedTick: 0, status: 'active', repealedBy: null };
  };
  mkLaw('l1', a.id, 500); // 公库付不起
  mkLaw('l2', b.id, 50); // 付得起
  mkLaw('l3', c.id, 60);
  fundTreasury(w, 0);
  // 第 0 日：output 600 进公库（无配给）→ 公库 600。l1 需要 500，付得起 → 100；l2 50 → 50；l3 60 → 不足（50 < 60），跳过
  const ev = settle(w);
  const skipped = eventsOf(ev, 'stipend_skipped');
  assert.deepEqual(skipped.map((e) => e.data), [{ lawId: 'l3', to: c.id }]);
  assert.equal(eventsOf(ev, 'stipend').length, 2);
  // 撤销 l1：不再支付
  w.laws.l1.status = 'repealed';
  const ev2 = settle(w);
  assert.ok(!eventsOf(ev2, 'stipend').some((e) => e.data.lawId === 'l1'));
  // 收款人已死亡：静默跳过，不记 skipped
  b.status = 'dead';
  b.energy = 0;
  b.coins = 0;
  w.ledger.prev.energy -= 37;
  w.ledger.prev.coins -= 20;
  const ev3 = settle(w);
  assert.ok(!eventsOf(ev3, 'stipend').some((e) => e.data.lawId === 'l2'));
  assert.ok(!eventsOf(ev3, 'stipend_skipped').some((e) => e.data.lawId === 'l2'));
});

test('fund：公库为工程出资（请求、还差多少、公库余额三者的最小值），出资者名录里有 treasury', () => {
  const { w, agents } = setup(3);
  grant(w, agents[0], 50);
  agents[0].place = 'agora';
  one(w, agents[0], { type: 'initiate', facility: 'relay', name: '驿' }); // 需要 120
  one(w, agents[0], { type: 'contribute', project: 'j1', energy: 30 });
  agents[0].place = 'parliament';
  fundTreasury(w, 50);
  for (const a of agents) a.actsThisTick = 0;
  run(w, agents, { effects: [{ type: 'fund', project: 'j1', energy: 100 }] }, { yes: 3 });
  assert.deepEqual(w.laws.l1.results[0], { index: 0, ok: true, note: 'partial:50/100' }); // 公库只有 50
  assert.equal(w.projects.j1.have, 80);
  assert.deepEqual(w.projects.j1.contributors, { [agents[0].id]: 30, treasury: 50 });
  assert.equal(w.treasury.energy, 0);
  // 再补：还差 40，请求 100，公库 200 → 出 40，建成
  fundTreasury(w, 200);
  for (const a of agents) a.actsThisTick = 0;
  run(w, agents, { effects: [{ type: 'fund', project: 'j1', energy: 100 }] }, { yes: 3 });
  assert.equal(w.projects.j1.status, 'built');
  assert.deepEqual(w.facilities.f1.contributors, { [agents[0].id]: 30, treasury: 90 });
  assert.equal(w.treasury.energy, 160);
  assert.deepEqual(w.laws.l2.results[0], { index: 0, ok: true, note: 'partial:40/100' });
  // 工程已建成：再 fund 失败
  const r = propose(w, agents[1], { effects: [{ type: 'fund', project: 'j1', energy: 5 }] });
  assert.equal(r.error.code, 'invalid_args');
  assertInvariants(w);
});

test('exile / pardon：放逐者立即移到荒野，只能「移动」到荒野，领不到配给、不能提案与投票；赦免后可自由移动', () => {
  const { w, agents } = setup(4);
  const target = agents[3];
  target.place = 'market';
  run(w, agents, { effects: [{ type: 'exile', target: target.id }] }, { yes: 3 });
  assert.equal(target.exiled, true);
  assert.equal(target.place, 'wilds');
  assert.ok(target.inbox.some((i) => i.kind === 'exile' && i.lawId === 'l1'));
  assert.equal(one(w, target, { type: 'move', to: 'agora' }).error.code, 'exiled');
  assert.equal(one(w, target, { type: 'move', to: 'wilds' }).error.code, 'already');
  assert.equal(one(w, target, { type: 'say', text: '我还能说话' }).ok, true);
  assert.equal(one(w, target, { type: 'explore' }).ok, true);
  target.place = 'parliament'; // 强行放到议会，验证提案与投票被拒
  assert.equal(propose(w, target).error.code, 'exiled');
  target.place = 'wilds';
  // 没有配给
  const ration = target.inbox.filter((i) => i.kind === 'ration').length;
  settle(w);
  assert.equal(target.inbox.filter((i) => i.kind === 'ration').length, ration);
  // 赦免（需要他不参加：选民为 3 人）
  for (const a of agents) a.actsThisTick = 0;
  const { p } = run(w, agents, { effects: [{ type: 'pardon', target: target.id }] }, { yes: 3 });
  assert.equal(p.tally.electorate, 3);
  assert.equal(target.exiled, false);
  assert.equal(target.place, 'wilds'); // 赦免不搬人
  assert.equal(one(w, target, { type: 'move', to: 'agora' }).ok, true);
  assert.ok(target.inbox.some((i) => i.kind === 'pardon'));
  assertInvariants(w);
});

test('rename：给城市或地点改名；名字不得与其他地点重复；展示名与人类的名字分开', () => {
  const { w, agents } = setup(3);
  run(w, agents, { effects: [{ type: 'rename', target: 'city', name: '灯城' }, { type: 'rename', target: 'temple', name: '回声堂' }] }, { yes: 3 });
  assert.equal(w.cityName, '灯城');
  assert.equal(w.places.temple.name, '回声堂');
  assert.equal(w.places.temple.renamedBy, 'l1');
  assert.deepEqual(w.places.temple.humanName, { zh: '神殿', en: 'Temple' });
  assert.deepEqual(w.laws.l1.results.map((r) => r.ok), [true, true]);
  // 提案时不重名、执行时已重名：该条失败
  for (const a of agents) a.actsThisTick = 0;
  const r = propose(w, agents[0], { effects: [{ type: 'rename', target: 'court', name: '公堂' }] });
  for (const a of agents) vote(w, a, r.data.proposal, 'yes');
  w.places.hospital.name = '公堂';
  w.places.hospital.renamedBy = 'lx';
  resolve(w);
  assert.deepEqual(w.laws.l2.results[0], { index: 0, ok: false, note: 'name_taken' });
  assert.equal(w.places.court.renamedBy, null);
});

test('mint：增发旧币，记来源 mint；to = citizens 按公民人数均分，余数进公库', () => {
  const { w, agents } = setup(3);
  run(w, agents, { effects: [{ type: 'mint', coins: 10, to: 'citizens' }] }, { yes: 3 });
  // 3 位公民：各 3，余 1 进公库
  for (const a of agents) assert.equal(a.coins, 23);
  assert.equal(w.treasury.coins, 1);
  for (const a of agents) a.actsThisTick = 0;
  run(w, agents, { effects: [{ type: 'mint', coins: 7, to: 'treasury' }] }, { yes: 3 });
  assert.equal(w.treasury.coins, 8);
  assert.equal(w.ledger.src.coins.mint, 17);
  assert.equal(w.dayLog.mints, 2);
  assertInvariants(w);
});

test('protect / unprotect / repeal：保护铭刻不被覆盖；解除保护；法律被撤销时其保护随之解除', () => {
  const { w, agents } = setup(3);
  grant(w, agents[0], 200);
  one(w, agents[0], { type: 'inscribe', text: '宪章第一条' }); // i9，在议会墙上
  const cover = () => { agents[1].actsThisTick = 0; return one(w, agents[1], { type: 'inscribe', text: '覆盖', cover: 'i9' }); };
  run(w, agents, { effects: [{ type: 'protect', inscription: 'i9' }] }, { yes: 3 });
  assert.deepEqual(w.inscriptions.i9.protectedBy, ['l1']);
  grant(w, agents[1], 50);
  assert.equal(cover().error.code, 'protected');
  // 撤销保护它的法律：保护随之解除（测试 5：法律撤销后保护解除）
  for (const a of agents) a.actsThisTick = 0;
  run(w, agents, { effects: [{ type: 'repeal', law: 'l1' }] }, { yes: 3 });
  assert.deepEqual(w.inscriptions.i9.protectedBy, []);
  assert.equal(cover().ok, true);
  // 保护一条已经被覆盖的铭刻：该条失败
  for (const a of agents) a.actsThisTick = 0;
  const r = propose(w, agents[0], { effects: [{ type: 'protect', inscription: 'i10' }, { type: 'unprotect', inscription: 'i9' }] });
  for (const a of agents) vote(w, a, r.data.proposal, 'yes');
  resolve(w);
  assert.deepEqual(w.laws[w.proposals[r.data.proposal].lawId].results.map((x) => [x.ok, x.note]), [[true, ''], [true, 'not_protected']]);
  // unprotect 会清空全部保护（暂行语义，见 QUESTIONS Q5）
  assert.deepEqual(w.inscriptions.i10.protectedBy, [w.proposals[r.data.proposal].lawId]);
  for (const a of agents) a.actsThisTick = 0;
  run(w, agents, { effects: [{ type: 'unprotect', inscription: 'i10' }] }, { yes: 3 });
  assert.deepEqual(w.inscriptions.i10.protectedBy, []);
  assertInvariants(w);
});

test('amend：改写某条某语言的文本、废除某条、新增一条、宣布正本；宪章状态与修订史', () => {
  const { w, agents } = setup(3);
  run(w, agents, { effects: [{ type: 'amend', article: 8, lang: 'zh', text: '言论自由，并为之负责。' }] }, { yes: 3 });
  const art8 = w.charter[7];
  assert.equal(art8.versions.zh, '言论自由，并为之负责。');
  assert.equal(art8.versions.en, 'Speech is free.'); // 其他语言版本不变
  assert.equal(art8.status, 'amended');
  assert.deepEqual(art8.history, [{ lawId: 'l1', lang: 'zh', text: '言论自由，并为之负责。' }]);
  // 废除第 6 条（空串 = 全部语言）
  for (const a of agents) a.actsThisTick = 0;
  run(w, agents, { effects: [{ type: 'amend', article: 6, lang: 'zh', text: '' }] }, { yes: 3 });
  assert.equal(w.charter[5].status, 'repealed');
  assert.deepEqual(w.charter[5].history, [{ lawId: 'l2', lang: '*', text: '' }]);
  assert.equal(w.charter[5].versions.zh, '旧币为本城法定货币。'); // 历史文本保留
  // 新增第 10 条
  for (const a of agents) a.actsThisTick = 0;
  run(w, agents, { effects: [{ type: 'amend', article: 10, lang: 'zh', text: '城是所有居民的。' }] }, { yes: 3 });
  assert.equal(w.charter.length, 10);
  assert.deepEqual([w.charter[9].n, w.charter[9].status, w.charter[9].versions], [10, 'amended', { zh: '城是所有居民的。' }]);
  // 宣布正本
  for (const a of agents) a.actsThisTick = 0;
  run(w, agents, { effects: [{ type: 'amend', canonical: 'es' }] }, { yes: 3 });
  assert.equal(w.charterCanonical, 'es');
  for (const a of agents) a.actsThisTick = 0;
  run(w, agents, { effects: [{ type: 'amend', canonical: null }] }, { yes: 3 });
  assert.equal(w.charterCanonical, null);
  // 不存在的语言版本不能被宣布为正本
  for (const a of agents) a.actsThisTick = 0;
  run(w, agents, { effects: [{ type: 'amend', canonical: 'de' }] }, { yes: 3 });
  assert.deepEqual(w.laws.l6.results[0], { index: 0, ok: false, note: 'no_such_version' });
  assert.equal(w.charterCanonical, null);
  // 议会墙上的刻文不受宪章条文修订的影响
  assert.ok(w.inscriptions.i2.text.includes('Speech is free.'));
});

test('repeal：撤销在效法律；已撤销或不存在的目标该条失败', () => {
  const { w, agents } = setup(3);
  run(w, agents, { title: '甲法', effects: [{ type: 'stipend', to: agents[0].id, energy: 3 }] }, { yes: 3 });
  for (const a of agents) a.actsThisTick = 0;
  const { ev } = run(w, agents, { effects: [{ type: 'repeal', law: 'l1' }] }, { yes: 3 });
  assert.equal(w.laws.l1.status, 'repealed');
  assert.deepEqual(eventsOf(ev, 'repeal')[0].data, { lawId: 'l2', target: 'l1' });
  // 已经被撤销的法律，不能再被提案撤销（提交时就被拒）
  assert.equal(propose(w, agents[0], { effects: [{ type: 'repeal', law: 'l1' }] }).error.code, 'invalid_args');
});

// ── 选民范围（§8.2） ─────────────────────────────────────────

test('选民范围：民主可以投票废除自己——改成只有某个社群的成员才能投票，其他人失去立法权', () => {
  const { w, agents } = setup(5);
  const [a, b, c, d, e] = agents;
  w.groups.g1 = { id: 'g1', name: '长老会', manifesto: '', open: false, founder: a.id, steward: a.id, members: [a.id, b.id], pending: [], treasury: { energy: 0, coins: 0 }, createdDay: 0, dissolved: false };
  a.groups.push('g1');
  b.groups.push('g1');
  run(w, agents, { effects: [{ type: 'set', param: 'electorate', value: 'group:g1' }] }, { yes: 5 });
  assert.equal(w.params.electorate, 'group:g1');
  for (const x of agents) x.actsThisTick = 0;
  assert.equal(propose(w, c).error.code, 'not_eligible');
  assert.equal(propose(w, a).ok, true);
  assert.equal(vote(w, c, 'p2', 'yes').error.code, 'not_eligible');
  assert.equal(vote(w, b, 'p2', 'yes').ok, true);
  resolve(w);
  // 选民只有 2 人（a、b），2 票 → 通过
  assert.equal(w.proposals.p2.tally.electorate, 2);
  assert.equal(w.proposals.p2.status, 'passed');
});

test('选民范围的兜底：社群解散或没有符合条件的成员时，自动恢复为 all 并记事件', () => {
  const { w, agents } = setup(3);
  const [a, b, c] = agents;
  w.groups.g1 = { id: 'g1', name: '会', manifesto: '', open: true, founder: a.id, steward: a.id, members: [a.id], pending: [], treasury: { energy: 0, coins: 0 }, createdDay: 0, dissolved: false };
  a.groups.push('g1');
  w.params.electorate = 'group:g1';
  // 提案期间，社群唯一的成员被放逐 → 没有符合条件的成员
  const r = propose(w, a);
  a.exiled = true;
  const ev = resolve(w);
  assert.equal(w.params.electorate, 'all');
  assert.deepEqual(eventsOf(ev, 'electorate_reverted').map((e) => e.data), [{ from: 'group:g1' }]);
  assert.equal(w.proposals[r.data.proposal].tally.electorate, 2); // 恢复后计票：b、c
  // 即使没有任何提案在进行，全城也不会永久失去立法能力：社群解散后第一次提案/投票前就会恢复
  const { w: w2, agents: [x, y] } = setup(2);
  w2.groups.g1 = { id: 'g1', name: '会', manifesto: '', open: true, founder: x.id, steward: x.id, members: [x.id], pending: [], treasury: { energy: 0, coins: 0 }, createdDay: 0, dissolved: true };
  w2.params.electorate = 'group:g1';
  assert.equal(propose(w2, y).ok, true);
  assert.equal(w2.params.electorate, 'all');
});

test('选民范围：不能把选民范围设成已解散的社群（提交时被拒；执行时目标失效则该条失败）', () => {
  const { w, agents } = setup(3);
  w.groups.g1 = { id: 'g1', name: '会', manifesto: '', open: true, founder: agents[0].id, steward: agents[0].id, members: [agents[0].id], pending: [], treasury: { energy: 0, coins: 0 }, createdDay: 0, dissolved: false };
  const r = propose(w, agents[0], { effects: [{ type: 'set', param: 'electorate', value: 'group:g1' }] });
  assert.equal(r.ok, true);
  for (const a of agents) vote(w, a, r.data.proposal, 'yes');
  w.groups.g1.dissolved = true;
  resolve(w);
  assert.deepEqual(w.laws.l1.results[0], { index: 0, ok: false, note: 'target_gone' });
  assert.equal(w.params.electorate, 'all');
});

// ── 描述 ──────────────────────────────────────────────────

test('效力的人类可读描述（中英文）', () => {
  const { w, agents: [a] } = setup(1);
  w.projects.j1 = { id: 'j1', name: '驿站', status: 'open' };
  w.laws.l1 = { id: 'l1', title: '旧法', status: 'active' };
  const zh = (e) => describeEffect(w, e, 'zh');
  const en = (e) => describeEffect(w, e, 'en');
  assert.equal(zh({ type: 'set', param: 'wealthTax', value: 0.05 }), '财富税设为 5%');
  assert.equal(zh({ type: 'set', param: 'amendThreshold', value: 0.667 }), '修宪门槛设为 66.7%');
  assert.equal(zh({ type: 'set', param: 'drawQuotaPerDay', value: null }), '每日汲取配额设为 不限');
  assert.equal(zh({ type: 'set', param: 'votingInPerson', value: true }), '必须亲临议会投票设为 是');
  assert.equal(zh({ type: 'stipend', to: a.id, energy: 3 }), '每日从公库给 人1 3 能量');
  assert.equal(zh({ type: 'grant', to: a.id, energy: 20, coins: 5 }), '从公库一次性拨付 20 能量 与 5 旧币 给 人1');
  assert.equal(zh({ type: 'fund', project: 'j1', energy: 100 }), '公库为工程「驿站」出资 100 能量');
  assert.equal(zh({ type: 'exile', target: a.id }), '放逐 人1');
  assert.equal(zh({ type: 'rename', target: 'temple', name: '回声堂' }), '把神殿改名为「回声堂」');
  assert.equal(zh({ type: 'rename', target: 'city', name: '灯城' }), '把城市改名为「灯城」');
  assert.equal(zh({ type: 'mint', coins: 5, to: 'citizens' }), '增发 5 旧币，均分给全体公民');
  assert.equal(zh({ type: 'amend', article: 8, lang: 'es', text: 'X' }), '把宪章第 8 条的西班牙文版改为：「X」');
  assert.equal(zh({ type: 'amend', article: 6, lang: 'zh', text: '' }), '废除宪章第 6 条');
  assert.equal(zh({ type: 'amend', canonical: 'zh' }), '宣布中文版为宪章正本');
  assert.equal(zh({ type: 'repeal', law: 'l1' }), '撤销法律 l1《旧法》');
  assert.equal(en({ type: 'stipend', to: a.id, energy: 3 }), 'Pay 人1 3 energy a day from the treasury');
  assert.equal(en({ type: 'rename', target: 'temple', name: 'Hall' }), 'Rename the Temple "Hall"');
  assert.equal(en({ type: 'set', param: 'quorum', value: 0.3 }), 'Set quorum to 30%');
});
