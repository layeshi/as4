import test from 'node:test';
import assert from 'node:assert/strict';
import e2 from '../src/e2/facade.js';
import { createWorld, genesisOpts } from '../src/e2/world.js';
import { makeAgent, retireAgent } from '../src/e2/engine/lifecycle.js';
import { runActions } from '../src/e2/engine/actions.js';
import { source, checkConservation } from '../src/e2/engine/ledger.js';
import {
  materialConservation,
  regenerateMaterials,
} from '../src/e2/engine/materials.js';
import { publicState } from '../src/e2/engine/visibility.js';
import { buildSystemPrompt } from '../runner/prompt.js';
import { typedActionTools } from '../runner/action-tools.js';
import { materialLook } from '../src/e2/engine/material-views.js';
import { K } from '../src/e2/engine/tokens.js';
export const PHYSICS = {
  version: 1,
  regrowth: {
    baseByZone: { wilds: 20, scrapyard: 15, solarfield: 10 },
    thresholdByZone: { wilds: 30, scrapyard: 25, solarfield: 15 },
    factorPermille: 500,
  },
  construction: { fullActionsPerTick: 2, factorPermille: 500 },
};
const world = () =>
  createWorld({
    seed: 'materials-test',
    premise: 5,
    lawSemanticsVersion: 2,
    tokens: { capacity: 6000, basic: 4000 },
    hiddenPhysics: PHYSICS,
  });
function resident(w, name = '甲', place = 'wilds') {
  const a = makeAgent(w, {
    name,
    lang: 'zh',
    soul: '观察世界',
    kind: 'external',
    energy: 1000000,
    coins: 0,
    place,
  });
  a.tokens.cap = 1000000;
  source(w, 'energy', 'admin', a.energy);
  return a;
}
function act(w, a, action) {
  a.actsThisTick = 0;
  w.commandN++;
  const r = runActions(w, a, [action])[0];
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(
    materialConservation(w).ok,
    true,
    JSON.stringify(materialConservation(w))
  );
  return r.data;
}
function inventory(w, a, n) {
  w.materialZones.scrapyard.stock -= n;
  w.materialZones.scrapyard.harvestedThisDay += n;
  a.materials += n;
}
function fund(
  w,
  a,
  { build = 'module', module = 'research', place = 'library' } = {}
) {
  a.place = place;
  const r = act(w, a, { type: 'initiate', build, module });
  const j = w.projects[r.project];
  inventory(w, a, j.needMaterials);
  act(w, a, {
    type: 'contribute',
    project: j.id,
    energy: j.need,
    materials: j.needMaterials,
  });
  return j;
}
test('P5 requires private genesis, selects compact map, and replays creation', () => {
  assert.throws(() => createWorld({ seed: 'x', premise: 5 }), /hiddenPhysics/);
  const w = world();
  assert.equal(Object.keys(w.places).length, 14);
  assert.equal(Object.keys(w.lots).length, 12);
  assert.deepEqual(createWorld(genesisOpts(w)), w);
  assert.equal(checkConservation(w).ok, true);
  assert.equal(w.places.workshop.name, '研究所');
  assert.equal(w.regions.wilds.energy, 550 * K(w));
});
test('P5 public outputs and schemas never expose causal parameters', () => {
  const w = world(),
    v = world();
  v.genesis.hiddenPhysics.construction.fullActionsPerTick = 1;
  resident(w);
  resident(v);
  assert.deepEqual(publicState(w), publicState(v));
  const p = buildSystemPrompt({ protocol: 2, premise: 5, lang: 'zh' });
  assert.match(p, /construct/);
  for (const text of [
    p,
    JSON.stringify(publicState(w)),
    JSON.stringify(typedActionTools('zh', { premise: 5 })),
  ])
    for (const key of [
      'hiddenPhysics',
      'thresholdByZone',
      'factorPermille',
      'fullActionsPerTick',
    ])
      assert.ok(!text.includes(key));
});
test('P5 gather is deterministic, capped and charged only on success; threshold is strict', () => {
  const w = world(),
    a = resident(w),
    b = resident(w, '乙');
  act(w, a, { type: 'gather' });
  act(w, b, { type: 'gather' });
  act(w, a, { type: 'gather' });
  w.clock.tick = 12;
  regenerateMaterials(w);
  assert.equal(w.observations[1].zone, 'solarfield');
  assert.equal(w.observations.find((o) => o.zone === 'wilds').added, 20);
  for (let i = 0; i < 3; i++) act(w, a, { type: 'gather' });
  act(w, b, { type: 'gather', amount: 1 });
  w.clock.tick = 24;
  regenerateMaterials(w);
  assert.equal(
    w.observations.filter((o) => o.zone === 'wilds').at(-1).added,
    10
  );
  assert.equal(materialConservation(w).ok, true);
});
test('P5 funded projects wait; actual research work 15/15/7/7 and cumulative budgets conserve', () => {
  const w = world(),
    a = resident(w),
    j = fund(w, a);
  assert.equal(j.status, 'open');
  assert.equal(j.phase, 'building');
  a.actsThisTick = 0;
  w.commandN++;
  const r = runActions(
    w,
    a,
    Array.from({ length: 4 }, () => ({ type: 'construct', project: j.id }))
  );
  assert.ok(
    r.every((x) => x.ok),
    JSON.stringify(r)
  );
  assert.deepEqual(
    r.map((x) => x.data.workAdded),
    [15, 15, 7, 7]
  );
  assert.equal(j.spentEnergy, Math.floor((j.need * 44) / 60));
  w.clock.tick++;
  act(w, a, { type: 'construct', project: j.id });
  const end = act(w, a, { type: 'construct', project: j.id });
  assert.equal(end.workAdded, 1);
  assert.equal(j.status, 'built');
  assert.equal(j.spentMaterials, 60);
  assert.equal(
    checkConservation(w).ok,
    true,
    JSON.stringify(checkConservation(w))
  );
});
test('P5 base work, failed actions and cross-project load, then next-tick reset', () => {
  const w = world(),
    a = resident(w);
  w.places.workshop.condition = 0;
  const j = fund(w, a);
  a.actsThisTick = 0;
  w.commandN++;
  const r = runActions(w, a, [
    { type: 'construct', project: 'missing' },
    { type: 'construct', project: j.id },
    { type: 'construct', project: j.id },
    { type: 'construct', project: j.id },
  ]);
  assert.deepEqual(
    r.slice(1).map((r) => r.data.workAdded),
    [10, 10, 5]
  );
  w.clock.tick++;
  assert.equal(act(w, a, { type: 'construct', project: j.id }).workAdded, 10);
});
test('P5 remote material trades refund claims at original location', () => {
  const w = world(),
    a = resident(w),
    b = resident(w, '乙', 'market');
  inventory(w, a, 10);
  let r = runActions(w, a, [{ type: 'give', to: b.id, materials: 2 }])[0];
  assert.equal(r.error.code, 'wrong_place');
  const o = act(w, a, {
    type: 'offer',
    to: b.id,
    give: { materials: 5 },
    want: { energy: 5 },
  });
  a.place = 'market';
  act(w, a, { type: 'cancel', offer: o.offer });
  const c = Object.values(w.materialClaims)[0];
  assert.equal(c.place, 'wilds');
  assert.equal(c.amount, 5);
  a.place = 'wilds';
  act(w, a, { type: 'claim', claim: c.id });
  assert.equal(a.materials, 10);
});
test('P5 demand locks reward, sole provider, partial delivery and single final settlement', () => {
  const w = world(),
    a = resident(w),
    b = resident(w, '乙'),
    c = resident(w, '丙');
  inventory(w, b, 10);
  const energy = a.energy;
  const d = act(w, a, {
    type: 'demand_publish',
    title: '送物料',
    description: '交付五份',
    price: 100,
    criterion: {
      kind: 'material_delivery',
      to: a.id,
      quantity: 5,
      place: 'wilds',
    },
  });
  assert.equal(a.energy, energy - 100);
  act(w, b, { type: 'order_accept', order: d.order });
  assert.equal(
    runActions(w, c, [{ type: 'order_accept', order: d.order }])[0].ok,
    false
  );
  act(w, b, { type: 'give', to: a.id, materials: 2, order: d.order });
  assert.equal(w.orders[d.order].status, 'active');
  act(w, b, { type: 'give', to: a.id, materials: 3, order: d.order });
  assert.equal(w.orders[d.order].status, 'completed');
  assert.equal(w.orders[d.order].escrow, 0);
  assert.equal(checkConservation(w).ok, true);
});
test('P5 accepted cancellations are bilateral; expiry and death refund once', () => {
  const w = world(),
    a = resident(w),
    b = resident(w, '乙');
  const publish = () =>
    act(w, a, {
      type: 'demand_publish',
      title: '写作',
      description: '交付作品',
      price: 100,
      criterion: { kind: 'document' },
      durationTicks: 2,
    });
  let id = publish().order;
  act(w, b, { type: 'order_accept', order: id });
  act(w, b, { type: 'order_cancel', order: id });
  assert.equal(w.orders[id].escrow, 100);
  act(w, a, { type: 'order_cancel', order: id });
  assert.equal(w.orders[id].status, 'cancelled');
  id = publish().order;
  act(w, b, { type: 'order_accept', order: id });
  e2.applyCommand(w, { type: 'tick' });
  e2.applyCommand(w, { type: 'tick' });
  assert.equal(w.orders[id].status, 'expired');
  id = publish().order;
  retireAgent(w, b, '');
  assert.equal(w.orders[id].status, 'open');
  retireAgent(w, a, '');
  assert.equal(w.orders[id].status, 'failed');
  assert.equal(checkConservation(w).ok, true);
});
test('P5 same-tick chronological evidence rejects old documents and duplicate reuse', () => {
  const w = world(),
    a = resident(w),
    b = resident(w, '乙', 'library');
  const old = act(w, b, {
    type: 'write',
    title: '旧文',
    body: '已有的记录',
  }).doc;
  const id = act(w, a, {
    type: 'demand_publish',
    title: '新作',
    description: '新的作品',
    price: 100,
    criterion: { kind: 'document' },
  }).order;
  act(w, b, { type: 'order_accept', order: id });
  assert.equal(
    runActions(w, b, [{ type: 'order_submit', order: id, ref: old }])[0].error
      .code,
    'evidence_predates_order'
  );
  const doc = act(w, b, { type: 'write', title: '新文', body: '新记录' }).doc;
  act(w, b, { type: 'order_submit', order: id, ref: doc });
  assert.equal(w.orders[id].status, 'completed');
});
test('P5 cancelled project refunds unspent budgets at the site and preserves recoverable structure', () => {
  const w = world(),
    a = resident(w),
    j = fund(w, a);
  act(w, a, { type: 'construct', project: j.id });
  a.place = 'port';
  act(w, a, { type: 'cancel_project', project: j.id });
  assert.equal(j.have, 0);
  const c = Object.values(w.materialClaims).find(
    (c) => c.source === `project:${j.id}`
  );
  assert.equal(c.place, 'library');
  assert.equal(c.amount, 45);
  assert.equal(j.materialRecoverable, 7);
  assert.equal(checkConservation(w).ok, true);
});
test('P5 repair charges actual ceilings and remote institute fees, no fee on failure', () => {
  const w = world(),
    a = resident(w, '甲', 'port');
  inventory(w, a, 20);
  w.places.port.condition = 9975;
  const before = a.energy;
  const r = act(w, a, { type: 'repair', energy: 10000, materials: 20 });
  assert.equal(r.bp, 25);
  assert.equal(r.materials, 1);
  assert.equal(before - a.energy, 3 * K(w));
  assert.equal(a.materials, 19);
  assert.equal(checkConservation(w).ok, true);
});

import { newClaim, inheritMaterials } from '../src/e2/engine/materials.js';
import { dissolveGroup } from '../src/e2/engine/society.js';
import { validateRules, checkExpression } from '../src/e2/rules/check.js';
import { createLaw } from '../src/e2/engine/laws.js';
import { citySet, runEnact } from '../src/e2/engine/rules.js';
function law(w, rules) {
  const checked = validateRules(rules, { scope: { kind: 'city', premise: 5 } });
  assert.equal(checked.ok, true, JSON.stringify(checked));
  const l = createLaw(w, {
    title: '公共政策',
    text: '公开规则',
    author: 'humans',
    rules: checked.rules,
  });
  l.results = runEnact(w, citySet(l));
  return l;
}
test('P5 law policies are city-scoped and public facts are readable without private physics', () => {
  const w = world();
  const l = law(w, [
    {
      when: 'enact',
      do: [
        {
          op: 'research_policy',
          place: 'workshop',
          access: 'public',
          fee: '10',
        },
        { op: 'material_policy', restricted: 'true' },
      ],
    },
  ]);
  assert.equal(
    w.places.workshop.modules[0].policy.fee,
    10,
    JSON.stringify(l.results)
  );
  assert.equal(w.materialPolicy.cityClaimRestricted, true);
  assert.equal(
    checkExpression('actor.materials > 0', 'bool', 'before', { premise: 5 }).ok,
    true
  );
  assert.equal(
    checkExpression('actor.materials > 0', 'bool', 'before', { premise: 4 }).ok,
    false
  );
  assert.equal(
    checkExpression('city.hiddenPhysics > 0', 'bool', 'before', { premise: 5 })
      .ok,
    false
  );
  assert.equal(
    validateRules(
      [
        {
          when: 'enact',
          do: [
            {
              op: 'research_policy',
              place: 'workshop',
              access: 'public',
              fee: '0',
            },
          ],
        },
      ],
      { scope: { kind: 'group', id: 'g1', premise: 5 } }
    ).ok,
    false
  );
});
test('P5 paid institutes require explicit selection and cap; denied actions do not charge', () => {
  const w = world(),
    a = resident(w),
    j = fund(w, a);
  law(w, [
    {
      when: 'enact',
      do: [
        {
          op: 'research_policy',
          place: 'workshop',
          access: 'public',
          fee: '20',
        },
      ],
    },
  ]);
  assert.equal(act(w, a, { type: 'construct', project: j.id }).workAdded, 10);
  a.actsThisTick = 0;
  const before = a.energy,
    load = a.constructionLoad.count;
  const r = runActions(w, a, [
    {
      type: 'construct',
      project: j.id,
      research: 'workshop',
      maxResearchFee: 19,
    },
  ])[0];
  assert.equal(r.error.code, 'research_unavailable');
  assert.equal(a.energy, before);
  assert.equal(a.constructionLoad.count, load);
  const treasury = w.treasury.energy;
  assert.equal(
    act(w, a, {
      type: 'construct',
      project: j.id,
      research: 'workshop',
      maxResearchFee: 20,
    }).workAdded,
    15
  );
  assert.equal(w.treasury.energy - treasury, 20);
});
test('P5 earmarked custody cannot become personal or transferable; group dissolution preserves ownership', () => {
  const w = world(),
    a = resident(w),
    b = resident(w, '乙');
  const g = act(w, a, {
    type: 'found',
    name: '修城社',
    manifesto: '维护公产',
  }).group;
  w.materialZones.wilds.stock -= 10;
  w.materialZones.wilds.harvestedThisDay += 10;
  const id = newClaim(w, 'wilds', 10, { kind: 'group', id: g }, 'fixture');
  act(w, a, { type: 'claim_policy', claim: id, agents: [b.id] });
  act(w, b, { type: 'claim', claim: id });
  assert.equal(b.materials, 0);
  assert.equal(
    runActions(w, b, [{ type: 'give', to: a.id, materials: 1 }])[0].error.code,
    'insufficient_materials'
  );
  dissolveGroup(w, w.groups[g]);
  assert.deepEqual(b.earmarkedMaterials[0].beneficiary, { kind: 'city' });
  act(w, b, { type: 'return_materials', claim: id });
  assert.equal(w.materialClaims[id].amount, 10);
  assert.equal(materialConservation(w).ok, true);
});
test('P5 deceased contributors keep future refund rights, including a second beneficiary death', () => {
  const w = world(),
    a = resident(w),
    b = resident(w, '乙'),
    c = resident(w, '丙');
  const j = fund(w, a);
  a.will = {
    heirs: [
      { to: b.id, share: 1 },
      { to: c.id, share: 1 },
    ],
  };
  act(w, a, { type: 'construct', project: j.id });
  a.status = 'dead';
  inheritMaterials(w, a);
  b.will = { heirs: [{ to: c.id, share: 1 }] };
  b.status = 'dead';
  inheritMaterials(w, b);
  j.owner = { kind: 'city' };
  j.initiator = c.id;
  act(w, c, { type: 'cancel_project', project: j.id });
  const claims = Object.values(w.materialClaims).filter((c) => c.amount);
  assert.ok(
    claims.every(
      (cl) => cl.beneficiary.kind === 'public' || cl.beneficiary.id === c.id
    )
  );
  assert.equal(materialConservation(w).ok, true);
});
test('P5 construction and repair orders count only provider work and settle final action atomically', () => {
  const w = world(),
    a = resident(w),
    b = resident(w, '乙'),
    j = fund(w, a);
  b.place = j.place;
  const id = act(w, a, {
    type: 'demand_publish',
    title: '施工',
    description: '实际完成二十工作量',
    price: 100,
    criterion: { kind: 'construction', project: j.id, work: 20 },
  }).order;
  act(w, b, { type: 'order_accept', order: id });
  act(w, a, { type: 'construct', project: j.id });
  assert.equal(w.orders[id].progress, 0);
  act(w, b, { type: 'construct', project: j.id, order: id });
  act(w, b, { type: 'construct', project: j.id, order: id });
  assert.equal(w.orders[id].status, 'completed');
  w.places.library.condition = 9800;
  inventory(w, b, 2);
  const repair = act(w, a, {
    type: 'demand_publish',
    title: '维修',
    description: '修复二百基点',
    price: 100,
    criterion: { kind: 'repair', target: 'library', bp: 200 },
  }).order;
  act(w, b, { type: 'order_accept', order: repair });
  act(w, b, {
    type: 'repair',
    target: 'library',
    energy: 1000,
    materials: 2,
    order: repair,
  });
  assert.equal(w.orders[repair].status, 'completed');
  assert.equal(checkConservation(w).ok, true);
});
test('P5 announcements and proposals verify submission, not reception or legislative outcome', () => {
  const w = world(),
    a = resident(w),
    b = resident(w, '乙');
  const ann = act(w, a, {
    type: 'demand_publish',
    title: '通知',
    description: '全城公开',
    price: 100,
    criterion: { kind: 'announcement', audience: 'all' },
  }).order;
  act(w, b, { type: 'order_accept', order: ann });
  const ref = act(w, b, {
    type: 'broadcast',
    text: '今日开展维护',
  }).serviceEvidence;
  act(w, b, { type: 'order_submit', order: ann, ref });
  assert.equal(w.orders[ann].status, 'completed');
});
test('P5 zero output validation, exhausted gather and safe integer input failures do not mint materials', () => {
  for (const value of [1, 0, NaN]) {
    const p = structuredClone(PHYSICS);
    p.regrowth.baseByZone.wilds = value;
    assert.throws(() =>
      createWorld({ seed: 'bad', premise: 5, hiddenPhysics: p })
    );
  }
  const w = world(),
    a = resident(w);
  for (let i = 0; i < 6; i++) act(w, a, { type: 'gather' });
  const energy = a.energy;
  a.actsThisTick = 0;
  const r = runActions(w, a, [{ type: 'gather' }])[0];
  assert.equal(r.ok, false);
  assert.equal(a.energy, energy);
  assert.equal(materialConservation(w).ok, true);
});

test('P5 blind observer fits public observations and predicts withheld repetitions', () => {
  // The observer receives only completed public rows, never a world or genesis.
  function fitThreshold(rows) {
    const high = Math.max(...rows.map((r) => r.added)),
      low = Math.min(...rows.map((r) => r.added));
    assert.ok(low < high, 'fixed recovery cannot explain these observations');
    const threshold = Math.max(
      ...rows.filter((r) => r.added === high).map((r) => r.harvested)
    );
    return (harvested) => (harvested > threshold ? low : high);
  }
  function sample(harvested) {
    const w = world(),
      a = resident(w);
    for (let n = harvested; n > 0; n -= 10)
      act(w, a, { type: 'gather', amount: Math.min(n, 10) });
    w.clock.tick = 12;
    regenerateMaterials(w);
    return materialLook(w, 'observations').find((r) => r.zone === 'wilds');
  }
  const predict = fitThreshold([0, 10, 20, 30, 31, 40].map(sample));
  for (const n of [15, 29, 35, 45, 15]) {
    const row = sample(n);
    assert.equal(predict(row.harvested), row.added);
  }
  function fitLoad(rows) {
    const values = rows.map((r) => r.workAdded);
    assert.ok(
      new Set(values).size > 1,
      'fixed work cannot explain these observations'
    );
    return (ordinal) => values[Math.min(ordinal, values.length - 1)];
  }
  for (const supported of [true, false]) {
    const w = world(),
      a = resident(w);
    if (!supported) w.places.workshop.condition = 0;
    const j = fund(w, a, { build: 'upgrade', place: 'well' });
    for (let i = 0; i < 4; i++) act(w, a, { type: 'construct', project: j.id });
    const predictWork = fitLoad(
      materialLook(w, 'observations').filter((r) => r.kind === 'construction')
    );
    w.clock.tick++;
    for (let i = 0; i < 4; i++)
      assert.equal(
        act(w, a, { type: 'construct', project: j.id }).workAdded,
        predictWork(i)
      );
  }
});
test('P5 proposal delivery settles on submission and project cancellation refunds orders', () => {
  const w = world(),
    a = resident(w),
    b = resident(w, '乙', 'parliament');
  const id = act(w, a, {
    type: 'demand_publish',
    title: '提交提案',
    description: '只验提交',
    price: 100,
    criterion: { kind: 'proposal', class: 'ordinary' },
  }).order;
  act(w, b, { type: 'order_accept', order: id });
  b.tags.push('citizen');
  const proposal = act(w, b, {
    type: 'propose',
    title: '维护倡议',
    text: '定期维护公共设施',
  });
  act(w, b, { type: 'order_submit', order: id, ref: proposal.serviceEvidence });
  assert.equal(w.orders[id].status, 'completed');
  const j = fund(w, a);
  const task = act(w, a, {
    type: 'demand_publish',
    title: '工程',
    description: '施工',
    price: 100,
    criterion: { kind: 'construction', project: j.id, work: 20 },
  }).order;
  act(w, b, { type: 'order_accept', order: task });
  act(w, a, { type: 'cancel_project', project: j.id });
  assert.equal(w.orders[task].status, 'failed');
  assert.equal(w.orders[task].escrow, 0);
  assert.equal(checkConservation(w).ok, true);
});
test('P5 standing work shares load with subsequent actions; minimum valid physics remains productive', () => {
  const w = world(),
    a = resident(w),
    j = fund(w, a);
  act(w, a, {
    type: 'standing',
    orders: [{ when: 'tick', do: [{ type: 'construct', project: j.id }] }],
  });
  e2.applyCommand(w, { type: 'tick' });
  assert.equal(w.agents[a.id].constructionLoad.count, 1);
  assert.equal(
    act(w, w.agents[a.id], { type: 'construct', project: j.id }).workAdded,
    15
  );
  assert.equal(
    act(w, w.agents[a.id], { type: 'construct', project: j.id }).workAdded,
    7
  );
  const p = structuredClone(PHYSICS);
  p.construction = { fullActionsPerTick: 1, factorPermille: 100 };
  p.regrowth.factorPermille = 100;
  for (const z of Object.keys(p.regrowth.baseByZone)) {
    p.regrowth.baseByZone[z] = 2;
    p.regrowth.thresholdByZone[z] = 1;
  }
  const v = createWorld({ seed: 'minimum', premise: 5, hiddenPhysics: p });
  const b = resident(v);
  v.places.workshop.condition = 0;
  const job = fund(v, b);
  assert.equal(act(v, b, { type: 'construct', project: job.id }).workAdded, 10);
  assert.equal(act(v, b, { type: 'construct', project: job.id }).workAdded, 1);
  b.place = 'wilds';
  act(v, b, { type: 'gather' });
  v.clock.tick = 12;
  regenerateMaterials(v);
  assert.equal(v.observations.find((r) => r.zone === 'wilds').added, 1);
  assert.equal(checkConservation(v).ok, true);
});

import { hooks } from '../src/e2/engine/hooks.js';
import { fail } from '../src/e2/engine/core.js';
test('P5 failed after effect rolls back construction, fees, evidence and hidden load across projects', () => {
  const w = world(),
    a = resident(w),
    first = fund(w, a),
    second = fund(w, a, { place: 'market' });
  a.place = 'library';
  act(w, a, { type: 'construct', project: first.id });
  a.place = 'market';
  act(w, a, { type: 'construct', project: second.id });
  assert.equal(a.constructionLoad.count, 2);
  const energy = a.energy,
    observations = w.observations.length,
    progress = second.progress,
    original = hooks.after;
  try {
    hooks.after = () => fail('not_allowed');
    a.actsThisTick = 0;
    w.commandN++;
    const r = runActions(w, a, [{ type: 'construct', project: second.id }])[0];
    assert.equal(r.ok, false);
  } finally {
    hooks.after = original;
  }
  assert.equal(a.energy, energy);
  assert.equal(a.constructionLoad.count, 2);
  assert.equal(second.progress, progress);
  assert.equal(w.observations.length, observations);
  assert.equal(
    act(w, a, { type: 'construct', project: second.id }).workAdded,
    7
  );
  assert.equal(checkConservation(w).ok, true);
});
test('P5 invalid object keys are rejected as business errors', () => {
  const w = world(),
    a = resident(w);
  for (const action of [
    {
      type: 'demand_publish',
      title: '无效',
      description: '无效',
      price: 1,
      criterion: { kind: '__proto__' },
    },
    { type: 'claim_policy', claim: '__proto__', agents: [] },
  ]) {
    a.actsThisTick = 0;
    const r = runActions(w, a, [action])[0];
    assert.equal(r.ok, false);
    assert.notEqual(r.error.code, 'internal');
  }
});
test('P5 listing edits preserve signed terms and self orders are rejected', () => {
  const w = world(),
    a = resident(w),
    b = resident(w, '乙');
  const id = act(w, b, {
    type: 'service_publish',
    title: '文章',
    description: '交付作品',
    price: 100,
    criterionTemplate: { kind: 'document' },
  }).service;
  const order = act(w, a, { type: 'service_order', service: id }).order;
  act(w, b, { type: 'service_edit', service: id, price: 200, title: '新价格' });
  act(w, b, { type: 'service_withdraw', service: id });
  assert.equal(w.orders[order].terms.price, 100);
  act(w, b, { type: 'order_accept', order });
  assert.equal(w.orders[order].status, 'active');
  const self = act(w, a, {
    type: 'service_publish',
    title: '本人',
    description: '交付作品',
    price: 100,
    criterionTemplate: { kind: 'document' },
  }).service;
  a.actsThisTick = 0;
  assert.equal(
    runActions(w, a, [{ type: 'service_order', service: self }])[0].error.code,
    'not_allowed'
  );
});
