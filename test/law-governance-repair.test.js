import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorld, reg, one, putAt, setHoldings } from './e2-helpers.js';
import { HUMAN_PROCEDURE } from '../src/e2/lore/humanlaws.js';
import { createLaw, installProcedure, procSpec } from '../src/e2/engine/laws.js';
import { computeTally, tallyProposals, autoRevert, checkRefound, mayPropose, votersOf, rngCopy } from '../src/e2/engine/legislation.js';
import { publicState } from '../src/e2/engine/visibility.js';
import { buildPerception } from '../src/e2/engine/perception.js';
import { applyCommand } from '../src/e2/engine/index.js';

function town(n = 3, version = 2) {
  const w = newWorld('repair', version ? { lawSemanticsVersion: version } : {});
  const people = Array.from({ length: n }, (_, i) => reg(w, `居民${i + 1}`));
  people.forEach(a => { putAt(w, a, 'parliament'); setHoldings(w, a, { energy: 500 }); });
  w.clock.tick = 36;
  return { w, people };
}
const propose = (w, a, extra = {}) => one(w, a, { type: 'propose', title: '修复', text: '恢复立法', ...extra });
function program(w, field, expr, cls = 'ordinary') {
  const spec = { ...HUMAN_PROCEDURE[cls], [field]: expr };
  const law = createLaw(w, { title: '程序', text: '程序', author: 'humans', procedure: { [cls]: spec } });
  installProcedure(w, law, 'enacted');
  return law;
}
function daily(w) { w.clock.tick += 12; autoRevert(w); }

test('new constitutional human program accepts 2 yes, 1 no; legacy still rejects', () => {
  for (const version of [0, 2]) {
    const { w, people } = town(3, version);
    const p = { spec: procSpec(w, 'constitutional'), voters: people.map(a => a.id), votes: Object.fromEntries(people.map((a, i) => [a.id, { choice: i < 2 ? 'yes' : 'no' }])) };
    assert.equal(computeTally(w, p, () => {}).passed, version === 2);
  }
});

test('newborn cannot open or sign a refound; opening electorate is fixed and dormant residents retained', () => {
  const { w, people: [a, b, c] } = town();
  const late = reg(w, '晚来');
  assert.equal(one(w, late, { type: 'refound', text: '恢复', procedure: 'humans' }).error?.code, 'not_eligible');
  const rid = one(w, a, { type: 'refound', text: '恢复', procedure: 'humans' }).data.refound;
  const r = w.refounds[rid];
  assert.deepEqual(r.electorate, [a.id, b.id, c.id]);
  assert.equal(one(w, late, { type: 'sign', refound: rid }).error?.code, 'not_eligible');
  w.clock.tick += 36;
  assert.equal(one(w, late, { type: 'sign', refound: rid }).error?.code, 'not_eligible', 'newly mature excluded');
  b.status = 'dormant';
  assert.equal(checkRefound(w, r), false, 'dormant remains in denominator');
  c.status = 'retired';
  assert.equal(checkRefound(w, r), false, 'two living electorate members need two signatures');
  b.status = 'dead';
  assert.equal(checkRefound(w, r), true, 'departed removed from denominator');
});

test('empty living fixed electorate never succeeds', () => {
  const { w, people } = town();
  const r = w.refounds[one(w, people[0], { type: 'refound', text: '恢复', procedure: 'humans' }).data.refound];
  people.forEach(a => { a.status = 'dead'; });
  assert.equal(checkRefound(w, r), false);
  assert.equal(r.status, 'open');
});

test('refound voids all open procedure proposals including legacy ones, and preserves ordinary/amend-only', () => {
  const { w, people: [a, b, c, d] } = town(4, 0);
  const old = w.proposals[propose(w, a, { procedure: { ordinary: { none: true } } }).data.proposal];
  assert.equal(applyCommand(w, { type: 'admin', payload: { op: 'law_semantics', args: { version: 2 } } }).result.ok, true);
  const ordinary = w.proposals[propose(w, b).data.proposal];
  const amend = w.proposals[propose(w, c, { rules: [{ when: 'enact', do: [{ op: 'amend', article: 1, text: '新宪章', lang: 'zh' }] }] }).data.proposal];
  const next = w.proposals[propose(w, d, { procedure: { constitutional: { none: true } } }).data.proposal];
  one(w, b, { type: 'vote', proposal: old.id, choice: 'yes' });
  const rid = one(w, a, { type: 'refound', text: '恢复', procedure: 'humans' }).data.refound;
  one(w, b, { type: 'sign', refound: rid });
  one(w, c, { type: 'sign', refound: rid });
  assert.equal(old.status, 'void');
  assert.equal(next.status, 'void');
  assert.equal(ordinary.status, 'open');
  assert.equal(amend.status, 'open');
  assert.ok(b.inbox.some(i => i.proposalId === old.id && i.result === 'void' && i.reason === 'refounded'));
});

for (const [field, expr] of [['proposers', '1 / 0 > 0'], ['voters', 'filter(agents, 1 / 0 > 0)'], ['weight', '1 / 0'], ['decide', '1 / 0 > 0']]) {
  test(`formal ${field} errors are reprobed on three successive days without effects or cooldown restrictions`, () => {
    const { w, people: [a] } = town();
    const law = program(w, field, expr);
    const readState = structuredClone(w);
    mayPropose(w, law.procedure.ordinary, a, rngCopy(w));
    votersOf(w, law.procedure.ordinary, rngCopy(w));
    assert.deepEqual(w, readState);
    const r = propose(w, a);
    if (field === 'weight' || field === 'decide') {
      const p = w.proposals[r.data.proposal];
      w.clock.tick = p.closesTick;
      tallyProposals(w);
    }
    assert.equal(w.procedureFaults?.ordinary?.lawId, law.id);
    w.refoundCooldownUntil = 1000;
    const rng = structuredClone(w.rng);
    const business = () => structuredClone({ agents: w.agents, counters: w.counters, treasury: w.treasury, ledger: w.ledger, dayLog: w.dayLog });
    const beforeProbes = business();
    daily(w); daily(w);
    assert.deepEqual(business(), beforeProbes, 'daily probes have no vote, fee, event, inbox or ledger effects');
    assert.equal(w.procedure.ordinary, law.id);
    daily(w);
    assert.notEqual(w.procedure.ordinary, law.id);
    assert.equal(w.procedure.constitutional, 'l1');
    assert.deepEqual(w.rng, rng);
    assert.equal(w.procedureRecovery.ordinary.reason, 'runtime_error');
  });
}

test('successful actual-context probe clears fault; stale actors and replaced programs clear faults', () => {
  const { w, people: [a] } = town();
  w.vars.divisor = 0;
  program(w, 'proposers', "actor.energy / var.divisor > 0");
  propose(w, a);
  assert.ok(w.procedureFaults?.ordinary);
  w.vars.divisor = 1;
  daily(w);
  assert.equal(w.procedureFaults.ordinary, undefined);
  w.vars.divisor = 0;
  propose(w, a);
  a.status = 'dead';
  daily(w);
  assert.equal(w.procedureFaults.ordinary, undefined);
});

test('old pending proposal fault is attributed to its original program, never current replacement or uncertain legacy source', () => {
  for (const version of [0, 2]) {
    const { w, people: [a] } = town(3, version);
    const oldLaw = program(w, 'decide', '1 / 0 > 0');
    const p = w.proposals[propose(w, a).data.proposal];
    const replacement = program(w, 'decide', 'false');
    if (!version) applyCommand(w, { type: 'admin', payload: { op: 'law_semantics', args: { version: 2 } } });
    w.clock.tick = p.closesTick;
    const events = applyCommand(w, { type: 'tick' }).events;
    assert.equal(w.procedureFaults?.ordinary, undefined);
    assert.equal(w.procedure.ordinary, replacement.id);
    assert.notEqual(replacement.id, oldLaw.id);
    const error = events.find(e => e.type === 'rule_error' && e.data.rule === 'decide');
    assert.equal(error.data.owner, version ? oldLaw.id : '');
  }
});

test('none, legal false and zero voting weight do not produce runtime fault observations', () => {
  const { w, people: [a] } = town();
  program(w, 'weight', '0');
  const p = w.proposals[propose(w, a).data.proposal];
  w.clock.tick = p.closesTick; tallyProposals(w);
  assert.equal(w.procedureFaults?.ordinary, undefined);
  program(w, 'decide', 'false');
  const p2 = w.proposals[propose(w, a).data.proposal];
  w.clock.tick = p2.closesTick; tallyProposals(w);
  assert.equal(w.procedureFaults?.ordinary, undefined);
  const law = createLaw(w, { title: '关闭', text: '关闭', author: 'humans', procedure: { ordinary: { none: true } } });
  installProcedure(w, law, 'enacted');
  daily(w); daily(w); daily(w);
  assert.equal(w.procedure.ordinary, law.id);
});


test('public and resident views expose health and fixed refound denominator without storing probe contexts', () => {
  const { w, people: [a, b, c] } = town();
  const r = w.refounds[one(w, a, { type: 'refound', text: '恢复', procedure: 'humans' }).data.refound];
  const late = reg(w, '晚来');
  program(w, 'decide', '1 / 0 > 0');
  const p = w.proposals[propose(w, b).data.proposal];
  w.clock.tick = p.closesTick; tallyProposals(w);
  c.status = 'dead';
  w.clock.tick += 36;
  const before = structuredClone(w);
  const pub = publicState(w);
  const perception = buildPerception(w, late.id, { ack: false });
  assert.equal(pub.world.lawSemanticsVersion, 2);
  assert.equal(pub.refounds.find(x => x.id === r.id).needed, 2);
  assert.equal(pub.refounds.find(x => x.id === r.id).eligibleResidents, 2);
  assert.equal(perception.city.refounds[0].needed, 2);
  assert.equal(perception.city.refounds[0].eligible, false);
  assert.equal(pub.procedure.ordinary.health.fault.fields[0].field, 'decide');
  assert.equal(perception.city.procedure.ordinary.health.lawId, w.procedure.ordinary);
  assert.equal(JSON.stringify(pub.procedure).includes('cases'), false);
  assert.equal(JSON.stringify(pub.procedure).includes('actorId'), false);
  assert.deepEqual(w, before);
});

test('a repaired decide probe evaluates current tally/world, not the historic saved failure result', () => {
  const { w, people: [a] } = town();
  w.treasury.energy = 10;
  const law = program(w, 'decide', 'total / (city.treasury - 10) > 0');
  const p = w.proposals[propose(w, a).data.proposal];
  w.clock.tick = p.closesTick; tallyProposals(w);
  assert.ok(w.procedureFaults.ordinary);
  w.treasury.energy = 11;
  daily(w);
  assert.equal(w.procedureFaults.ordinary, undefined);
  assert.equal(w.procedure.ordinary, law.id);
});

test('a daily watch counts each day once; replacement immediately clears its observation', () => {
  const { w, people: [a] } = town();
  const law = program(w, 'decide', '1 / 0 > 0');
  const p = w.proposals[propose(w, a).data.proposal];
  w.clock.tick = p.closesTick; tallyProposals(w);
  daily(w); autoRevert(w); autoRevert(w);
  assert.equal(w.procedureFaults.ordinary.consecutiveDays, 1);
  assert.equal(w.procedure.ordinary, law.id);
  program(w, 'decide', 'false');
  assert.equal(w.procedureFaults.ordinary, undefined);
});


test('closed legacy refounds remain readable after migration without inventing an opening electorate', () => {
  const { w, people: [a, b] } = town(3, 0);
  const r = w.refounds[one(w, a, { type: 'refound', text: '恢复', procedure: 'humans' }).data.refound];
  one(w, b, { type: 'sign', refound: r.id });
  assert.equal(r.status, 'succeeded');
  applyCommand(w, { type: 'admin', payload: { op: 'law_semantics', args: { version: 2 } } });
  const view = publicState(w).refounds.find(x => x.id === r.id);
  assert.equal(Object.hasOwn(view, 'electorate'), false);
  assert.equal(Object.hasOwn(view, 'needed'), false);
  assert.match(view.reading.en.constitutional, /667/);
});

test('runner renders runtime recovery diagnostics, opening-electorate ineligibility and refound void reason', async () => {
  const { renderPerception2 } = await import('../runner/render2.js');
  const { renderLook } = await import('../runner/render-p2.js');
  const { w, people: [a, b] } = town();
  const r = w.refounds[one(w, a, { type: 'refound', text: '恢复', procedure: 'humans' }).data.refound];
  const late = reg(w, '晚来');
  const p = w.proposals[propose(w, b, { procedure: { ordinary: { none: true } } }).data.proposal];
  one(w, b, { type: 'sign', refound: r.id });
  program(w, 'decide', '1 / 0 > 0');
  const q = w.proposals[propose(w, a).data.proposal];
  w.clock.tick = q.closesTick; tallyProposals(w);
  const perception = buildPerception(w, b.id, { ack: false, lang: 'en' });
  assert.match(renderPerception2(perception), /voided by refounding/);
  assert.match(renderLook(perception, 'procedure', null, { lang: 'en' }), /decide.*div0.*0\/3/);
  // This finished refound is intentionally supplied to the shared renderer to inspect eligibility text.
  perception.city.refounds = [{ id: r.id, by: { id: a.id, name: a.name }, text: r.text, signers: 2, needed: 2, expiresTick: r.expiresTick, eligible: false, signed: false, reading: '' }];
  assert.match(renderLook(perception, 'refounds', null, { lang: 'en' }), /opening electorate/);
  assert.equal(p.status, 'void');
  assert.equal(w.agents[late.id].status, 'awake');
});

test('a dynamic invalid voters value is a runtime type error and a corrected current value clears it', () => {
  const { w, people: [a] } = town();
  w.vars.electorate = 7;
  program(w, 'voters', 'var.electorate');
  assert.equal(propose(w, a).ok, false);
  assert.equal(w.procedureFaults?.ordinary?.cases.voters.code, 'type');
  w.vars.electorate = [];
  daily(w);
  assert.equal(w.procedureFaults.ordinary, undefined, 'legal empty list is not a runtime error');
});

test('normal tick/day-settlement path reprobes a real failed ballot on days without new legislative calls', async () => {
  const { tickDays } = await import('./e2-helpers.js');
  const { w, people: [a] } = town();
  const law = program(w, 'decide', '1 / 0 > 0');
  propose(w, a);
  w.refoundCooldownUntil = 1000;
  tickDays(w);
  assert.equal(w.procedureFaults.ordinary.consecutiveDays, 1);
  tickDays(w);
  assert.equal(w.procedureFaults.ordinary.consecutiveDays, 2);
  tickDays(w);
  assert.notEqual(w.procedure.ordinary, law.id);
  assert.equal(w.procedureRecovery.ordinary.reason, 'runtime_error');
});

test('governance page shows each fixed-electorate refound denominator and runtime diagnostic', async () => {
  const { installFakeDom } = await import('./fake-dom.js');
  const { renderLaws2 } = await import('../public/e2-tabs.js');
  const { setLang } = await import('../public/i18n.js');
  const { L } = await import('../src/e2/lore/index.js');
  const dom = installFakeDom();
  try {
    const { w, people: [a, b] } = town();
    one(w, a, { type: 'refound', text: '固定名单', procedure: 'humans' });
    reg(w, '后来成熟');
    w.clock.tick += 36;
    program(w, 'proposers', '1 / 0 > 0');
    propose(w, b);
    const state = publicState(w);
    assert.equal(state.agents.filter(x => x.status === 'awake' && x.ageDays >= 3).length, 4);
    assert.equal(state.refounds[0].needed, 2);
    const root = document.createElement('div');
    setLang('en');
    renderLaws2({ S: { state }, lore: L('en'), agent: id => state.agents.find(x => x.id === id), agentName: id => w.agents[id]?.name || id, groupName: id => id }, root);
    assert.match(root.textContent, /signed 1\/2/);
    assert.match(root.textContent, /proposers \(div0\)/);
    assert.doesNotMatch(root.textContent, /undefined|NaN/);
  } finally {
    setLang('zh');
    dom.restore();
  }
});


test('public event describes actual runtime-fault reversion and retains legacy eligibility wording', async () => {
  const { describeEvent, setLang } = await import('../public/i18n.js');
  setLang('en');
  try {
    const data = { class: 'ordinary', lawId: 'l9', reason: 'runtime_error' };
    const fault = describeEvent({ type: 'procedure_reverted', data });
    assert.match(fault.template, /runtime error/);
    const legacy = describeEvent({ type: 'procedure_reverted', data: { class: 'ordinary', lawId: 'l9' } });
    assert.match(legacy.template, /stood unusable/);
  } finally { setLang('zh'); }
});
