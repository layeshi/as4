import test from 'node:test';
import assert from 'node:assert/strict';
import { town, enactP2 } from './p2-helpers.js';
import { one, putAt, tick, setTreasury } from './e2-helpers.js';
import { publicLaw, publicState } from '../src/e2/engine/visibility.js';
import { lawView } from '../src/e2/engine/laws.js';
const setup = () => { const t = town(1, 'law-outcomes'); t.w.lawSemantics = { version: 2 }; return t; };

test('passed city enact failure remains active and exposes identical enact diagnostics in receipt/event/views', () => {
  const { w, people: [a] } = setup(); putAt(w, a, 'parliament');
  const p = one(w, a, { type: 'propose', title: 'failing', text: 'x', rules: [{ when: 'enact', do: [{ op: 'set', var: 'bad', value: '1 / 0' }] }] });
  one(w, a, { type: 'vote', proposal: p.data.proposal, choice: 'yes' });
  const events = tick(w, 12); const proposal = w.proposals[p.data.proposal]; const law = w.laws[proposal.lawId];
  assert.equal(proposal.status, 'passed'); assert.equal(law.status, 'active');
  assert.equal(law.enact.status, 'failure');
  assert.deepEqual(law.enact.diagnostics, [{ rule: 0, phase: 'collect', code: 'div0' }]);
  assert.deepEqual(lawView(w, law).enact, law.enact);
  assert.deepEqual(publicLaw(w, law.id).enact, law.enact);
  assert.deepEqual(events.find(e => e.type === 'law_passed' && e.data.lawId === law.id).data.enact, law.enact);
  assert.deepEqual(a.inbox.findLast(i => i.kind === 'law' && i.lawId === law.id).enact, law.enact);
  assert.deepEqual(publicState(w).proposals.find(p => p.id === proposal.id).enact, law.enact);
  tick(w, 12); assert.equal(w.vars.bad, undefined);
});

for (const [name, rules, status] of [
  ['no enact', [], 'no_enact'],
  ['condition false', [{ when: 'enact', if: 'false', do: [{ op: 'set', var: 'x', value: '1' }] }], 'condition_false'],
  ['legal empty iteration', [{ when: 'enact', do: [{ op: 'each', in: 'filter(agents, false)', do: [{ op: 'tag', who: 'it', tag: 'x' }] }] }], 'success'],
  ['success', [{ when: 'enact', do: [{ op: 'set', var: 'x', value: '1' }] }], 'success'],
  ['partial transfer', [{ when: 'enact', do: [{ op: 'transfer', from: 'treasury', to: "agent('a1')", energy: '100' }] }], 'partial_failure'],
]) test(`city enact distinguishes ${name}`, () => {
  const { w } = setup(); setTreasury(w, { energy: 5 });
  const law = enactP2(w, rules); assert.equal(law.enact.status, status);
});

for (const target of ['group', 'place']) test(`${target} direct rules expose collect failure in stored summary and action result`, () => {
  const { w, people: [a] } = setup();
  let args;
  if (target === 'group') { one(w, a, { type: 'found', name: 'G', manifesto: 'x' }); args = { group: Object.keys(w.groups)[0] }; }
  else { enactP2(w, [{ when: 'enact', do: [{ op: 'cede', place: 'market', to: `agent('${a.id}')` }] }]); args = { place: 'market' }; }
  const op = target === 'group' ? { op: 'set', var: 'bad', value: '1 / 0' } : { op: 'announce', to: 'here', text: '{1 / 0}' };
  const out = one(w, a, { type: 'rules', ...args, rules: [{ when: 'enact', do: [op] }] });
  assert.equal(out.ok, true); assert.equal(out.data.enact.status, 'failure');
  const holder = target === 'group' ? w.groups[args.group].bylaws : w.places.market.rules;
  assert.deepEqual(holder.enact, out.data.enact);
  assert.deepEqual(publicLaw(w, `${target}:${args[target]}`).enact, holder.enact);
});

test('historical laws never receive inferred enact outcomes after migration', () => {
  const { w } = town(1, 'legacy-outcome'); delete w.lawSemantics;
  const law = enactP2(w, [{ when: 'enact', do: [{ op: 'set', var: 'bad', value: '1 / 0' }] }]);
  w.lawSemantics = { version: 2 };
  assert.equal(Object.hasOwn(publicLaw(w, law.id), 'enact'), false);
  assert.equal(Object.hasOwn(lawView(w, law), 'enact'), false);
});

test('unsupported transfer coin asset fails collection before any debit', () => {
  const { w, people: [a] } = setup();
  const soul = one(w, a, { type: 'conceive', name: 'Waiting', soul: 'x' }).data.soul;
  const before = { ...w.treasury };
  const law = enactP2(w, [{ when: 'enact', do: [{ op: 'transfer', from: 'treasury', to: `soul('${soul}')`, energy: '2', coins: '2' }] }]);
  assert.equal(law.enact.status, 'failure');
  assert.equal(law.enact.diagnostics[0].code, 'unsupported_asset');
  assert.deepEqual(w.treasury, before);
});

test('city and group apply failures retain phase, rule and code; mixed outcome is partial failure', async () => {
  const { P } = await import('../src/e2/params.js');
  const { w, people: [a] } = setup();
  for (let i = 0; i < P.varsCity; i++) w.vars[`full${i}`] = i;
  const law = enactP2(w, [{ when: 'enact', do: [{ op: 'set', var: 'overflow', value: '1' }, { op: 'tag', who: `agent('${a.id}')`, tag: 'success' }] }]);
  assert.equal(law.enact.status, 'partial_failure');
  assert.deepEqual(law.enact.diagnostics, [{ rule: 0, index: 0, phase: 'apply', code: 'vars_full' }]);
  one(w, a, { type: 'found', name: 'Full', manifesto: 'x' }); const g = Object.values(w.groups)[0];
  for (let i = 0; i < P.varsGroup; i++) g.vars[`full${i}`] = i;
  const out = one(w, a, { type: 'rules', group: g.id, rules: [{ when: 'enact', do: [{ op: 'set', var: 'overflow', value: '1' }] }] });
  assert.equal(out.data.enact.status, 'failure');
  assert.equal(out.data.enact.diagnostics[0].code, 'vars_full');
});

test('zero partial payment is failure, positive partial payment is partial_failure', () => {
  const { w, people: [a] } = setup();
  setTreasury(w, { energy: 0 });
  const law = enactP2(w, [{ when: 'enact', do: [{ op: 'transfer', from: 'treasury', to: `agent('${a.id}')`, energy: '100' }] }]);
  assert.equal(law.enact.status, 'failure');
  assert.equal(law.enact.diagnostics[0].code, 'partial_payment');
});

for (const target of ['group', 'place']) test(`member-voted ${target} enact failure still passes with receipt and event summary`, () => {
  const { w, people: [a] } = setup();
  one(w, a, { type: 'found', name: 'Vote', manifesto: 'x', procedure: 'members' }); const g = Object.values(w.groups)[0];
  let args = { group: g.id };
  if (target === 'place') { enactP2(w, [{ when: 'enact', do: [{ op: 'cede', place: 'market', to: `group('${g.id}')` }] }]); args = { place: 'market' }; }
  const op = target === 'group' ? { op: 'set', var: 'bad', value: '1 / 0' } : { op: 'announce', to: 'here', text: '{1 / 0}' };
  const out = one(w, a, { type: 'rules', ...args, rules: [{ when: 'enact', do: [op] }] });
  one(w, a, { type: 'vote', proposal: out.data.proposal, choice: 'yes' });
  const events = tick(w, 12); const p = w.proposals[out.data.proposal];
  assert.equal(p.status, 'passed'); assert.equal(p.enact.status, 'failure');
  assert.deepEqual(a.inbox.findLast(i => i.kind === 'law' && i.proposalId === p.id).enact, p.enact);
  assert.deepEqual(events.find(e => e.type === (target === 'group' ? 'bylaws' : 'place_rules')).data.enact, p.enact);
});

test('model next-round receipt and law detail show failure code and collection phase in both languages', async () => {
  const { buildPerception } = await import('../src/e2/engine/perception.js');
  const { renderPerception2 } = await import('../runner/render2.js');
  const { renderLook } = await import('../runner/render-p2.js');
  const { w, people: [a] } = setup(); putAt(w, a, 'parliament');
  const out = one(w, a, { type: 'propose', title: 'feedback', text: 'x', rules: [{ when: 'enact', do: [{ op: 'set', var: 'bad', value: '1 / 0' }] }] });
  one(w, a, { type: 'vote', proposal: out.data.proposal, choice: 'yes' }); tick(w, 12);
  const law = w.laws[w.proposals[out.data.proposal].lawId];
  for (const lang of ['zh', 'en']) {
    const perception = buildPerception(w, a.id, { ack: false, lang });
    const text = renderPerception2(perception, { lang });
    assert.match(text, /div0/); assert.match(text, /collect|收集/);
    assert.match(renderLook(perception, 'law', law.id, { lang }), /div0/);
  }
});

test('public law page renders summary and phase/code instead of a collect-error undefined operation', async () => {
  const { installFakeDom } = await import('./fake-dom.js');
  const { renderLaws2 } = await import('../public/e2-tabs.js');
  const { setLang } = await import('../public/i18n.js');
  const { L } = await import('../src/e2/lore/index.js');
  const dom = installFakeDom();
  try {
    const { w } = setup(); enactP2(w, [{ when: 'enact', do: [{ op: 'set', var: 'bad', value: '1 / 0' }] }]);
    const state = publicState(w); const root = document.createElement('div'); setLang('en');
    renderLaws2({ S: { state }, lore: L('en'), agent: id => state.agents.find(x => x.id === id), agentName: id => w.agents[id]?.name || id, groupName: id => id }, root);
    assert.match(root.textContent, /Execution.*failed.*collect.*div0/);
    assert.doesNotMatch(root.textContent, /undefined|NaN/);
  } finally { setLang('zh'); dom.restore(); }
});

test('place apply failure reports insufficient announcement funds with apply phase', async () => {
  const { setPlaceRulesOf } = await import('../src/e2/engine/bylaws.js');
  const { setHoldings } = await import('./e2-helpers.js');
  const { validateRules } = await import('../src/e2/rules/check.js');
  const { staticLookup } = await import('../src/e2/engine/legislation.js');
  const { w, people: [a] } = setup();
  enactP2(w, [{ when: 'enact', do: [{ op: 'cede', place: 'market', to: `agent('${a.id}')` }] }]);
  setHoldings(w, a, { energy: 0 });
  const v = validateRules([{ when: 'enact', do: [{ op: 'announce', to: 'here', text: 'unpaid' }] }], { scope: { kind: 'place', id: 'market' }, lookup: staticLookup(w) });
  assert.equal(v.ok, true); setPlaceRulesOf(w, w.places.market, v.rules, a.id);
  assert.deepEqual(w.places.market.rules.enact, { status: 'failure', diagnostics: [{ rule: 0, index: 0, phase: 'apply', code: 'insufficient' }] });
});

test('share records no delivered payment as failure even when the pre-rounding available amount is positive', () => {
  const { w } = town(2, 'share-rounding'); w.lawSemantics = { version: 2 }; setTreasury(w, { energy: 1 });
  const law = enactP2(w, [{ when: 'enact', do: [{ op: 'share', from: 'treasury', energy: '100', among: 'agents' }] }]);
  assert.equal(law.enact.status, 'failure');
  assert.equal(law.enact.diagnostics[0].note, 'partial:0/100');
  assert.equal(w.treasury.energy, 1);
});

test('same-tick rules replacement refreshes law page for changed enact outcomes', async () => {
  const { signature2 } = await import('../public/e2-tabs.js');
  const { w, people: [a] } = setup();
  one(w, a, { type: 'found', name: 'Refresh', manifesto: 'x' }); const g = Object.values(w.groups)[0];
  one(w, a, { type: 'rules', group: g.id, rules: [{ when: 'enact', if: 'false', do: [{ op: 'set', var: 'bad', value: '1' }] }] });
  const previous = signature2('laws', publicState(w));
  one(w, a, { type: 'rules', group: g.id, rules: [{ when: 'enact', do: [{ op: 'set', var: 'bad', value: '1 / 0' }] }] });
  assert.notEqual(signature2('laws', publicState(w)), previous);
});

test('public event descriptions expose enact status and collection code in both languages', async () => {
  const { oneWithEvents } = await import('./e2-helpers.js');
  const { setLang, describeEvent } = await import('../public/i18n.js');
  const { w, people: [a] } = setup(); one(w, a, { type: 'found', name: 'Events', manifesto: 'x' }); const g = Object.values(w.groups)[0];
  const { events } = oneWithEvents(w, a, { type: 'rules', group: g.id, rules: [{ when: 'enact', do: [{ op: 'set', var: 'bad', value: '1 / 0' }] }] });
  const event = events.find(e => e.type === 'bylaws');
  try {
    for (const lang of ['zh', 'en']) { setLang(lang); const d = describeEvent(event); assert.match(d.template, /\{enact\}/); assert.match(d.vars.enact, /div0/); assert.match(d.vars.enact, /collect|收集/); }
  } finally { setLang('zh'); }
});

test('partial project funding reports actual positive delivery as partial_failure', () => {
  const { w, people: [a] } = setup(); putAt(w, a, 'market');
  const out = one(w, a, { type: 'initiate', build: 'site', lot: 'commons-4', name: 'Funding' }); assert.equal(out.ok, true);
  setTreasury(w, { energy: 8 });
  const law = enactP2(w, [{ when: 'enact', do: [{ op: 'fund', project: out.data.project, energy: '100' }] }]);
  assert.equal(w.projects[out.data.project].have, 8);
  assert.equal(law.enact.status, 'partial_failure');
  assert.equal(law.enact.diagnostics[0].note, 'partial:8/100');
});
