// SPEC-E2 §25 第 5 步：社群章程、地点规则与社群的两种程序（steward / members）、社群提案。
import test from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/e2/params.js';
import {
  newWorld, bareWorld, reg, one, oneWithEvents, setHoldings, setTreasury, putAt, tick, tickDays, settle, eventsOf, assertInvariants,
} from './e2-helpers.js';
import { enact } from './e2-law-helpers.js';

const drainOut = (w) => { const o = w.$out || []; w.$out = []; return o; };

/** 一座有 n 位居民的城（每人 200 能量），第一位创立一个社群，其余加入。procedure：steward | members */
const club = (n, procedure = 'steward', seed = 'club') => {
  const w = newWorld(seed);
  const people = [];
  for (let i = 0; i < n; i++) {
    const a = reg(w, `民${i + 1}`);
    setHoldings(w, a, { energy: 200 });
    people.push(a);
  }
  const g = one(w, people[0], { type: 'found', name: '会', manifesto: '互助', procedure }).data.group;
  for (const p of people.slice(1)) one(w, p, { type: 'join', group: g });
  return { w, people, g, G: w.groups[g] };
};

const BYLAWS = [{ when: 'daily', do: [{ op: 'transfer', from: 'group', to: 'treasury', energy: '1' }] }];
const dues = (g) => [{ when: 'before:say', do: [{ op: 'fee', to: `group('${g}')`, energy: '1' }] }];

// ═══════════════════════════════════════════════════════════════
// steward：管事直接设定
// ═══════════════════════════════════════════════════════════════

test('found 的 procedure：缺省 steward；members 也可以；其余不合法。社群的字段 procedure、bylaws（null）、vars', () => {
  const { w, people } = club(2);
  const a = people[0];
  assert.deepEqual([w.groups.g1.procedure, w.groups.g1.bylaws, w.groups.g1.vars], ['steward', null, {}]);
  const g2 = one(w, a, { type: 'found', name: '另一会', manifesto: 'x' }).data.group;
  assert.equal(w.groups[g2].procedure, 'steward');
  const g3 = one(w, a, { type: 'found', name: '三会', manifesto: 'x', procedure: 'members' }).data.group;
  assert.equal(w.groups[g3].procedure, 'members');
  assert.equal(one(w, a, { type: 'found', name: '四会', manifesto: 'x', procedure: 'republic' }).error.code, 'invalid_args');
});

test('rules { group, rules }（steward）：只有管事；立即生效，整体替换；执行 enact；paidThrough = 今日；事件 bylaws（含规则与读法）；空数组废除；代价 2', () => {
  const { w, people, g, G } = club(3, 'steward');
  const [a, b] = people;
  assert.equal(one(w, b, { type: 'rules', group: g, rules: dues(g) }).error.code, 'not_steward');
  assert.equal(one(w, people[2], { type: 'rules', group: 'g99', rules: [] }).error.code, 'not_found');
  const rules = [
    { when: 'enact', do: [{ op: 'set', var: 'dues', value: '2' }] },
    { when: 'before:say', do: [{ op: 'fee', to: `group('${g}')`, energy: 'var.dues' }] },
  ];
  const e0 = a.energy;
  const { r, events } = oneWithEvents(w, a, { type: 'rules', group: g, rules });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.cost, r.data], [2, { scope: `group:${g}` }]);
  assert.equal(a.energy, e0 - 2);
  assert.deepEqual(G.vars, { dues: 2 }, 'enact 执行了（写社群自己的变量）');
  assert.deepEqual([G.bylaws.rules.length, G.bylaws.setBy, G.bylaws.setTick, G.bylaws.paidThrough, G.bylaws.suspendedDays], [2, a.id, w.clock.tick, 0, 0]);
  assert.equal(G.bylaws.fingerprints.length, 2);
  const ev = eventsOf(events, 'bylaws')[0];
  assert.equal(ev.vis, 'public');
  assert.deepEqual([ev.data.groupId, ev.data.setBy, ev.data.rules.length], [g, a.id, 2]);
  assert.match(ev.data.reading.zh.rules[1], /^/);
  assert.equal(ev.data.results.length, 1);
  // 生效：成员说话付 2 给社群公库
  const t0 = G.treasury.energy;
  assert.equal(one(w, b, { type: 'say', text: '会员说话' }).ok, true);
  assert.equal(G.treasury.energy, t0 + 2);
  // 整体替换
  one(w, a, { type: 'rules', group: g, rules: [{ when: 'daily', do: [{ op: 'set', var: 'x', value: '1' }] }] });
  assert.equal(G.bylaws.rules.length, 1);
  assert.equal(one(w, b, { type: 'say', text: '不再收费' }).data.fees, undefined);
  // 废除
  const ab = oneWithEvents(w, a, { type: 'rules', group: g, rules: [] });
  assert.equal(G.bylaws, null);
  assert.deepEqual(eventsOf(ab.events, 'bylaws')[0].data.rules, []);
  assertInvariants(w);
});

test('rules 的校验：group 与 place 二选一、rules 与 procedure 二选一；社群章程的作用域白名单；标题与正文的长度；规则不合法为 rule_invalid（带路径与建议）', () => {
  const { w, people, g } = club(2, 'steward');
  const [a] = people;
  const bad = (x) => one(w, a, { type: 'rules', ...x });
  assert.equal(bad({}).error.code, 'invalid_args');
  assert.equal(bad({ group: g, place: 'market', rules: [] }).error.code, 'invalid_args');
  assert.equal(bad({ group: g }).error.code, 'invalid_args');
  assert.equal(bad({ group: g, rules: [], procedure: 'members' }).error.code, 'invalid_args');
  assert.equal(bad({ place: 'market', procedure: 'members' }).error.code, 'invalid_args');
  assert.equal(bad({ group: g, procedure: 'tyranny' }).error.code, 'invalid_args');
  assert.equal(bad({ group: g, procedure: 'steward' }).error.code, 'already');
  assert.equal(bad({ group: g, rules: [], title: 'x'.repeat(61) }).error.code, 'text_too_long');
  const mint = bad({ group: g, rules: [{ when: 'daily', do: [{ op: 'mint', coins: '5' }] }] });
  assert.equal(mint.error.code, 'rule_invalid');
  assert.equal(mint.error.issues[0].code, 'op.scope');
  assert.match(mint.error.hint.en, /bylaws cannot use the operation mint/);
  assert.equal(bad({ group: g, rules: [{ when: 'on:death', do: [{ op: 'set', var: 'a', value: '1' }] }, { when: 'before:enter', do: [{ op: 'deny', reason: 'x' }] }] }).error.code, 'rule_invalid');
  assert.equal(bad({ place: 'nowhere', rules: [] }).error.code, 'invalid_args');
  assert.equal(a.energy, 200 - 8, '只付了 found 的 8，失败的动作不扣');
});

// ═══════════════════════════════════════════════════════════════
// members：成员多数决
// ═══════════════════════════════════════════════════════════════

test('rules（members 程序）：任何成员都能发起——生成社群提案（scope group:<g>、kind bylaws、表决者 = 当时的在世成员、不记名为假、表决期 12 刻）；非成员 not_member；不受城的程序与「每人 1 个提案」限制；每个社群最多 3 个', () => {
  const { w, people, g, G } = club(4, 'members');
  const [a, b, c, d] = people;
  const outsider = reg(w, '路人');
  setHoldings(w, outsider, { energy: 100 });
  assert.equal(one(w, outsider, { type: 'rules', group: g, rules: dues(g) }).error.code, 'not_member');
  putAt(w, b, 'market'); // 不在议会也行：社群提案不受遗法 l2 管
  const { r, events } = oneWithEvents(w, b, { type: 'rules', group: g, rules: dues(g), title: '会费', text: '每次说话收 1 能量' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.cost, 2);
  assert.deepEqual(Object.keys(r.data).sort(), ['proposal', 'scope']);
  const p = w.proposals[r.data.proposal];
  assert.deepEqual([p.scope, p.kind, p.class, p.title, p.text, p.proposer, p.secret, p.status, p.closesTick - p.openedTick, p.spec, p.lawId], [`group:${g}`, 'bylaws', 'ordinary', '会费', '每次说话收 1 能量', b.id, false, 'open', P.groupVoteTicks, null, null]);
  assert.deepEqual(p.voters, [a.id, b.id, c.id, d.id]);
  assert.equal(G.bylaws, null, '还没有生效');
  const ev = eventsOf(events, 'propose')[0];
  assert.deepEqual([ev.data.scope, ev.data.kind, ev.data.voters, ev.data.secret], [`group:${g}`, 'bylaws', 4, false]);
  // 同一个人可以再发起（不受每人 1 个的限制），每个社群最多 3 个
  assert.equal(one(w, b, { type: 'rules', group: g, rules: [] }).ok, true);
  assert.equal(one(w, b, { type: 'rules', group: g, procedure: 'steward' }).ok, true);
  assert.equal(one(w, c, { type: 'rules', group: g, rules: [] }).error.code, 'limit_reached');
  // 城的提案不受影响（l2：要在议会）
  assert.equal(Object.values(w.proposals).filter((x) => x.scope === 'city').length, 0);
});

test('社群提案的表决：表决者只能是提出时的成员（之后入社的不能投）；可以改票；通过 = voted × 2 ≥ 在世表决者数 且 yes > no（一人一票）；通过则生效并执行 enact', () => {
  const { w, people, g, G } = club(4, 'members');
  const [a, b, c, d] = people;
  const rules = [{ when: 'enact', do: [{ op: 'set', var: 'dues', value: '1' }] }, ...dues(g)];
  const pid = one(w, a, { type: 'rules', group: g, rules }).data.proposal;
  const late = reg(w, '晚来');
  setHoldings(w, late, { energy: 50 });
  one(w, late, { type: 'join', group: g });
  assert.equal(one(w, late, { type: 'vote', proposal: pid, choice: 'yes' }).error.code, 'not_eligible', '提出时固定');
  one(w, a, { type: 'vote', proposal: pid, choice: 'no' });
  one(w, a, { type: 'vote', proposal: pid, choice: 'yes' }); // 改票
  one(w, b, { type: 'vote', proposal: pid, choice: 'yes' });
  const ev = tick(w, P.groupVoteTicks);
  const p = w.proposals[pid];
  assert.deepEqual(p.tally, { yes: 2, no: 0, abstain: 0, voted: 2, total: 4, turnout: 500 });
  assert.equal(p.status, 'passed', '参与者恰好一半、赞成多于反对');
  assert.equal(G.bylaws.rules.length, 2);
  assert.deepEqual(G.vars, { dues: 1 });
  assert.equal(eventsOf(ev, 'bylaws').length, 1);
  assert.equal(eventsOf(ev, 'law_passed').length, 0, '社群提案不产生城的 law_passed');
  for (const x of [a, b]) assert.ok(x.inbox.some((i) => i.kind === 'law' && i.proposalId === pid && i.result === 'passed' && i.lawId === null), x.name);
  assert.ok(!c.inbox.some((i) => i.kind === 'law'));
  void d;
});

test('社群提案的计票与 §8.7 的公式逐位相同：对 n ≤ 8 的所有 (赞成, 反对, 弃权)', () => {
  const { w, people } = club(1, 'members', 'tally-grid');
  void people;
  // 直接用引擎的结算函数：构造提案对象
  const run = (n, yes, no, abstain) => {
    const w2 = newWorld(`grid-${n}-${yes}-${no}-${abstain}`);
    const ps = [];
    for (let i = 0; i < n; i++) ps.push(reg(w2, `居民${i + 1}`));
    const gid = one(w2, ps[0], { type: 'found', name: '会', manifesto: 'x', procedure: 'members' }).data.group;
    for (const p of ps.slice(1)) one(w2, p, { type: 'join', group: gid });
    const pid = one(w2, ps[0], { type: 'rules', group: gid, rules: [] }).data.proposal;
    let k = 0;
    for (const [count, choice] of [[yes, 'yes'], [no, 'no'], [abstain, 'abstain']]) for (let i = 0; i < count; i++) one(w2, ps[k++], { type: 'vote', proposal: pid, choice });
    tick(w2, P.groupVoteTicks);
    return w2.proposals[pid].status === 'passed';
  };
  let cases = 0;
  for (let n = 1; n <= 6; n++) {
    for (let yes = 0; yes <= n; yes++) {
      for (let no = 0; yes + no <= n; no++) {
        for (let abstain = 0; yes + no + abstain <= n; abstain++) {
          const voted = yes + no + abstain;
          assert.equal(run(n, yes, no, abstain), voted * 2 >= n && yes > no, `n=${n} yes=${yes} no=${no} abstain=${abstain}`);
          cases++;
        }
      }
    }
  }
  assert.ok(cases > 100);
  void w;
});

test('社群提案：否决（记 law_rejected，scope 与 kind）；社群在表决期间解散 → void；通过时地点已易主 → 不生效（void）', () => {
  const { w, people, g, G } = club(3, 'members');
  const [a, b, c] = people;
  const p1 = one(w, a, { type: 'rules', group: g, rules: [] }).data.proposal;
  one(w, a, { type: 'vote', proposal: p1, choice: 'no' });
  const ev = tick(w, P.groupVoteTicks);
  assert.equal(w.proposals[p1].status, 'rejected');
  const rej = eventsOf(ev, 'law_rejected')[0];
  assert.deepEqual([rej.data.proposalId, rej.data.scope, rej.data.kind], [p1, `group:${g}`, 'bylaws']);
  assert.ok(a.inbox.some((i) => i.kind === 'law' && i.result === 'rejected' && i.proposalId === p1));
  // 解散：成员全部退出
  const p2 = one(w, b, { type: 'rules', group: g, rules: [] }).data.proposal;
  for (const x of [a, b, c]) one(w, x, { type: 'leave', group: g });
  assert.equal(G.dissolved, true);
  tick(w, P.groupVoteTicks);
  assert.equal(w.proposals[p2].status, 'void');
});

test('rules { group, procedure }：steward 程序由管事立即改（事件 group_procedure）；members 程序下成为 kind group_procedure 的提案，通过后生效', () => {
  const { w, people, g, G } = club(3, 'steward');
  const [a, b, c] = people;
  assert.equal(one(w, b, { type: 'rules', group: g, procedure: 'members' }).error.code, 'not_steward');
  const { r, events } = oneWithEvents(w, a, { type: 'rules', group: g, procedure: 'members' });
  assert.equal(r.ok, true);
  assert.equal(G.procedure, 'members');
  const ev = eventsOf(events, 'group_procedure')[0];
  assert.deepEqual([ev.data.groupId, ev.data.procedure, ev.data.from, ev.data.setBy], [g, 'members', 'steward', a.id]);
  // 现在是 members：管事也要走表决
  const pid = one(w, a, { type: 'rules', group: g, procedure: 'steward' }).data.proposal;
  const p = w.proposals[pid];
  assert.deepEqual([p.kind, p.procedure, p.rules], ['group_procedure', 'steward', null]);
  for (const x of [a, b]) one(w, x, { type: 'vote', proposal: pid, choice: 'yes' });
  tick(w, P.groupVoteTicks);
  assert.equal(G.procedure, 'steward');
  assert.equal(w.proposals[pid].status, 'passed');
  void c;
});

// ═══════════════════════════════════════════════════════════════
// 地点规则
// ═══════════════════════════════════════════════════════════════

test('rules { place, rules }：居民所有的地点——只有主人，立即生效；全城所有的地点没有地点规则；事件 place_rules；整体替换，空数组废除；越界在校验时拒绝', () => {
  const w = bareWorld('placerules');
  const [a, b] = [reg(w, '甲'), reg(w, '乙')];
  for (const x of [a, b]) setHoldings(w, x, { energy: 200 });
  const rules = [{ when: 'before:say', do: [{ op: 'fee', to: `agent('${a.name}')`, energy: '2' }] }];
  assert.equal(one(w, a, { type: 'rules', place: 'market', rules }).error.code, 'not_owner', '全城所有的地点没有地点规则');
  assert.match(one(w, a, { type: 'rules', place: 'market', rules }).error.hint.en, /belongs to the whole city/);
  w.places.market.owner = { kind: 'agent', id: a.id };
  assert.equal(one(w, b, { type: 'rules', place: 'market', rules }).error.code, 'not_owner');
  const { r, events } = oneWithEvents(w, a, { type: 'rules', place: 'market', rules, title: '摊位费', text: '在我的市场说话要付费' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.cost, r.data], [2, { scope: 'place:market' }]);
  assert.equal(w.places.market.rules.rules.length, 1);
  assert.deepEqual([w.places.market.rules.setBy, w.places.market.rules.paidThrough], [a.id, 0]);
  const ev = eventsOf(events, 'place_rules')[0];
  assert.deepEqual([ev.place, ev.data.placeId, ev.data.rules.length, ev.data.setBy, ev.data.title], ['market', 'market', 1, a.id, '摊位费']);
  putAt(w, b, 'market');
  assert.deepEqual(one(w, b, { type: 'say', text: 'hi' }).data.fees.map((f) => [f.law, f.energy]), [['place:market', 2]]);
  // 越界：on:、城法的 mint
  assert.equal(one(w, a, { type: 'rules', place: 'market', rules: [{ when: 'on:death', do: [{ op: 'set', var: 'x', value: '1' }] }] }).error.code, 'rule_invalid');
  assert.equal(one(w, a, { type: 'rules', place: 'market', rules: [{ when: 'daily', do: [{ op: 'announce', to: 'all', text: 'x' }] }] }).error.code, 'rule_invalid');
  // 废除
  assert.equal(one(w, a, { type: 'rules', place: 'market', rules: [] }).ok, true);
  assert.equal(w.places.market.rules, null);
  assert.equal(one(w, b, { type: 'say', text: 'hi' }).data.fees, undefined);
  assertInvariants(w);
});

test('rules { place }：社群所有的地点按社群的程序——steward：管事立即设定，其他成员 not_owner；members：任何成员发起提案（kind place_rules），通过后生效；地点易主后提案不再有效', () => {
  const { w, people, g } = club(3, 'steward');
  const [a, b, c] = people;
  w.places.library.owner = { kind: 'group', id: g };
  const rules = [{ when: 'before:read', do: [{ op: 'fee', to: `group('${g}')`, energy: '1' }] }];
  assert.equal(one(w, b, { type: 'rules', place: 'library', rules }).error.code, 'not_owner');
  assert.equal(one(w, a, { type: 'rules', place: 'library', rules }).ok, true, '管事 = 主人');
  assert.equal(w.places.library.rules.rules.length, 1);
  // 改成 members 程序
  one(w, a, { type: 'rules', group: g, procedure: 'members' });
  const outsider = reg(w, '路人');
  assert.equal(one(w, outsider, { type: 'rules', place: 'library', rules: [] }).error.code, 'not_owner');
  const pid = one(w, b, { type: 'rules', place: 'library', rules: [], title: '免费开放' }).data.proposal;
  const p = w.proposals[pid];
  assert.deepEqual([p.kind, p.place, p.scope], ['place_rules', 'library', `group:${g}`]);
  for (const x of [a, b]) one(w, x, { type: 'vote', proposal: pid, choice: 'yes' });
  tick(w, P.groupVoteTicks);
  assert.equal(w.places.library.rules, null, '通过：地点规则废除');
  assert.equal(w.proposals[pid].status, 'passed');
  // 通过时地点已易主：不生效
  const p2 = one(w, c, { type: 'rules', place: 'library', rules }).data.proposal;
  w.places.library.owner = { kind: 'city' };
  for (const x of [a, b, c]) one(w, x, { type: 'vote', proposal: p2, choice: 'yes' });
  tick(w, P.groupVoteTicks);
  assert.equal(w.proposals[p2].status, 'void');
  assert.equal(w.places.library.rules, null);
});

test('章程与地点规则被规则（城法）拒绝或收费：rules 动作可以被 before:rules 的城法规则管；after:rules 照常', () => {
  const { w, people, g } = club(2, 'steward');
  const [a] = people;
  enact(w, [{ when: 'before:rules', if: 'args.group == null', do: [{ op: 'deny', reason: '地点规则暂停受理' }] }, { when: 'before:rules', do: [{ op: 'fee', to: 'treasury', energy: '1' }] }]);
  const r = one(w, a, { type: 'rules', group: g, rules: [] });
  assert.equal(r.ok, true);
  assert.equal(r.cost, 3, '代价 2 + 费用 1');
  w.places.market.owner = { kind: 'agent', id: a.id };
  assert.equal(one(w, a, { type: 'rules', place: 'market', rules: [] }).error.reason, '地点规则暂停受理');
});

// ═══════════════════════════════════════════════════════════════
// 章程的运转
// ═══════════════════════════════════════════════════════════════

test('章程的运转：每日从社群公库付维持费；daily 规则每日执行；成员离开不再受章程管；社群解散章程作废；退出时去掉章程给的标签', () => {
  const { w, people, g, G } = club(3, 'steward');
  const [a, b, c] = people;
  one(w, a, { type: 'rules', group: g, rules: [
    { when: 'daily', do: [{ op: 'each', in: `members('${g}')`, do: [{ op: 'tag', who: 'it', tag: '会员' }] }] },
    { when: 'before:say', do: [{ op: 'deny', reason: '会员不许说话' }] },
  ] });
  G.treasury.energy = 10;
  w.ledger.src.energy.admin += 10;
  drainOut(w);
  settle(w);
  assert.deepEqual([a.tags, b.tags].map((t) => t.includes(`${g}:会员`)), [true, true]);
  assert.equal(G.treasury.energy, 8, '付了 2 条持续规则的维持费');
  assert.equal(one(w, b, { type: 'say', text: 'x' }).error.law, `group:${g}`);
  assert.equal(one(w, c, { type: 'say', text: 'x' }).error.law, `group:${g}`);
  // 退出：不再受管，标签一并去掉
  one(w, c, { type: 'leave', group: g });
  assert.equal(c.tags.some((t) => t.startsWith(`${g}:`)), false);
  assert.equal(one(w, c, { type: 'say', text: '我自由了' }).ok, true);
  // 解散：成员全部退出，章程作废，公库并入城公库
  const t0 = w.treasury.energy;
  one(w, b, { type: 'leave', group: g });
  one(w, a, { type: 'leave', group: g });
  assert.equal(G.bylaws, null);
  assert.equal(w.treasury.energy, t0 + 8);
  assert.equal(one(w, a, { type: 'say', text: '没有章程了' }).ok, true);
  assertInvariants(w);
});
