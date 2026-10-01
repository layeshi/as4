// 随机生成的合法规则（SPEC-E2 §24.1 测试 10 的「规则的模糊测试生成器」）与立法的随机动作。
//
// 规则按「构造即合法」的模板生成，偶尔混入不合法的写法，验证校验不会崩溃、也不会改变世界。
import { agentList, isAlive } from '../src/e2/world.js';
import { addGenerators } from './e2-fuzz-lib.js';
import { lotsNear } from '../src/e2/map/index.js';

const ACTIONS_BEFORE = ['move', 'say', 'give', 'draw', 'repair', 'inscribe', 'write', 'explore', 'offer', 'accept', 'found', 'join', 'define', 'broadcast', 'propose', 'vote', 'read', 'epitaph', 'declare'];
const ACTIONS_AFTER = ['move', 'say', 'give', 'draw', 'repair', 'inscribe', 'write', 'explore', 'offer', 'accept', 'found', 'join', 'define', 'broadcast', 'vote', 'retire', 'leave', 'sign'];
const EVENTS = ['arrive', 'death', 'retire', 'born', 'ruin', 'weather_start', 'weather_end', 'law_passed', 'law_rejected'];
const TAGS = ['长老', '守井人', 'citizen', '商人', 'salvager', '新人'];
const WORDS = ['公告', '今日有雾', '请缴费', '议会开会', 'hello', '井边集合'];

const agentRef = (a) => `agent('${a.id}')`;

/** 一条随机的、合法的城法规则（多数）或社群章程规则 */
export function randomRule(w, r, alive, scope = 'city') {
  const pick = (xs) => r.pick(xs);
  const e = () => String(1 + r.int(4));
  const kinds = scope === 'city'
    ? ['dailyTransfer', 'tax', 'shareCity', 'announceDaily', 'denyBefore', 'feeBefore', 'bonusAfter', 'onEvent', 'enactTag', 'enactMisc', 'monthlyMint', 'dailySet', 'dailyFundSoul']
    : ['dailyTransferG', 'denyBeforeG', 'feeBeforeG', 'tagG', 'announceG'];
  const kind = pick(kinds);
  const someone = pick(alive);
  switch (kind) {
    case 'dailyTransfer': return { when: 'daily', do: [{ op: 'transfer', from: 'treasury', to: agentRef(someone), energy: e() }] };
    case 'tax': {
      const k = 60 + r.int(80);
      return { when: 'daily', do: [{ op: 'each', in: `filter(agents, it.energy > ${k})`, do: [{ op: 'transfer', from: 'it', to: 'treasury', energy: `(it.energy - ${k}) / 10` }] }] };
    }
    case 'shareCity': return { when: 'daily', if: 'city.treasury > 50', do: [{ op: 'share', from: 'treasury', energy: 'city.treasury / 20', among: pick(["tagged('citizen')", "filter(agents, awake(it))", "filter(agents, it.energy < 40)", 'agents']) }] };
    case 'announceDaily': return { when: 'daily', do: [{ op: 'announce', to: pick(['all', 'tag:citizen', 'market', 'agora']), text: `${pick(WORDS)}：{count(agents)} 人，公库 {city.treasury}` }] };
    case 'denyBefore': {
      const act = pick(ACTIONS_BEFORE);
      const cond = pick(['actor.energy < 20', "has_tag(actor, 'exiled')", 'actor.coins == 0', "actor.place == 'market'", 'city.treasury < 30', 'count(here) > 3']);
      return { when: `before:${act}`, if: cond, do: [{ op: 'deny', reason: `规则拒绝了 ${act}` }] };
    }
    case 'feeBefore': {
      const act = pick(ACTIONS_BEFORE);
      return { when: `before:${act}`, if: pick([undefined, 'actor.energy > 30', "has_tag(actor, 'citizen')"]), do: [{ op: 'fee', to: pick(['treasury', agentRef(someone)]), energy: e(), ...(r.chance(0.3) ? { coins: '1' } : {}) }].map((o) => (o.if === undefined ? o : o)) };
    }
    case 'bonusAfter': return { when: `after:${pick(ACTIONS_AFTER)}`, do: [{ op: 'transfer', from: 'treasury', to: 'actor', energy: e() }] };
    case 'onEvent': {
      const ev = pick(EVENTS);
      const ops = ev === 'arrive' || ev === 'born' || ev === 'death' || ev === 'retire'
        ? pick([[{ op: 'tag', who: 'event.agent', tag: pick(TAGS) }], [{ op: 'announce', to: 'all', text: `${pick(WORDS)}：{event.agent}` }], [{ op: 'transfer', from: 'treasury', to: 'event.agent', energy: e() }]])
        : [{ op: 'set', var: pick(['last', 'seen']), value: 'city.day' }];
      return { when: `on:${ev}`, do: ops };
    }
    case 'enactTag': return { when: 'enact', do: [{ op: pick(['tag', 'untag']), who: agentRef(someone), tag: pick(TAGS) }] };
    case 'enactMisc': {
      const m = pick(['exile', 'pardon', 'mint', 'rename', 'petition', 'set', 'protect', 'cede', 'cede', 'seize']);
      if (m === 'cede' || m === 'seize') {
        const place = pick(['market', 'library', 'hospital', 'temple', 'court', 'theater', 'lighthouse']);
        const groups = Object.values(w.groups).filter((g) => !g.dissolved);
        if (m === 'seize') return { when: 'enact', do: [{ op: 'seize', place }] };
        return { when: 'enact', do: [{ op: 'cede', place, to: groups.length && r.chance(0.4) ? `group('${pick(groups).id}')` : agentRef(someone) }] };
      }
      if (m === 'exile' || m === 'pardon') return { when: 'enact', do: [{ op: m, who: agentRef(someone) }] };
      if (m === 'mint') return { when: 'enact', do: [{ op: 'mint', coins: String(1 + r.int(50)), to: pick(['treasury', agentRef(someone)]) }] };
      if (m === 'rename') return { when: 'enact', do: [{ op: 'rename', target: pick(['city', 'market', 'library', 'agora']), name: `${pick(WORDS).slice(0, 4)}${r.int(100)}` }] };
      if (m === 'petition') return { when: 'enact', do: [{ op: 'petition', text: '请回应' }] };
      if (m === 'protect') { const ids = Object.keys(w.inscriptions); return { when: 'enact', do: [{ op: pick(['protect', 'unprotect']), inscription: pick(ids) }] }; }
      return { when: 'enact', do: [{ op: 'set', var: pick(['a', 'b', 'c', 'd']), value: String(r.int(1000)) }] };
    }
    case 'monthlyMint': return { when: 'monthly', do: [{ op: 'mint', coins: String(1 + r.int(20)) }] };
    case 'dailySet': return { when: 'daily', do: [{ op: 'set', var: pick(['a', 'b', 'c']), value: 'if(city.treasury > 100, 1, 0)' }] };
    case 'dailyFundSoul': {
      const souls = Object.keys(w.souls);
      return souls.length ? { when: 'daily', if: 'city.treasury > 120', do: [{ op: 'transfer', from: 'treasury', to: `soul('${pick(souls)}')`, energy: '10' }] } : { when: 'daily', do: [{ op: 'set', var: 'z', value: '1' }] };
    }
    // 社群章程
    case 'dailyTransferG': { const gs = Object.values(w.groups).filter((g) => !g.dissolved); const g = gs.length ? pick(gs) : null; return { when: 'daily', do: [{ op: 'transfer', from: g ? `group('${g.id}')` : 'treasury', to: g && g.members.length ? agentRef(w.agents[pick(g.members)]) : 'treasury', energy: e() }] }; }
    case 'denyBeforeG': return { when: `before:${pick(ACTIONS_BEFORE)}`, if: 'actor.energy < 30', do: [{ op: 'deny', reason: '章程拒绝' }] };
    case 'feeBeforeG': return { when: `before:${pick(ACTIONS_BEFORE)}`, do: [{ op: 'fee', to: 'treasury', energy: '1' }] };
    case 'tagG': return { when: 'daily', do: [{ op: 'tag', who: agentRef(someone), tag: pick(TAGS) }] };
    default: return { when: 'daily', do: [{ op: 'announce', to: 'all', text: '会务' }] };
  }
}

/** 随机的地点规则（白名单：deny fee transfer announce(here)；时机：daily / monthly / enact / before / after / before:enter） */
export function randomPlaceRules(w, r, place, alive) {
  const owner = place && place.owner.kind === 'agent' ? w.agents[place.owner.id] : r.pick(alive);
  const n = 1 + r.int(2);
  return Array.from({ length: n }, () => {
    const k = r.int(7);
    if (k === 0) return { when: `before:${r.pick(ACTIONS_BEFORE)}`, do: [{ op: 'deny', reason: '此地不许' }] };
    if (k === 1) return { when: `before:${r.pick(ACTIONS_BEFORE)}`, do: [{ op: 'fee', to: agentRef(owner), energy: String(1 + r.int(3)) }] };
    if (k === 2) return { when: 'before:enter', if: 'actor.energy < 60', do: [{ op: 'deny', reason: '进门费不够' }] };
    if (k === 3) return { when: 'before:enter', do: [{ op: 'fee', to: agentRef(owner), energy: '2' }] };
    if (k === 4) return { when: `after:${r.pick(ACTIONS_AFTER)}`, do: [{ op: 'transfer', from: agentRef(owner), to: 'actor', energy: '1' }] };
    if (k === 5) return { when: 'daily', do: [{ op: 'announce', to: 'here', text: '欢迎光临' }] };
    return { when: 'daily', do: [{ op: 'transfer', from: agentRef(owner), to: agentRef(r.pick(alive)), energy: '1' }] };
  });
}

/** 一组随机规则（1–3 条）；偶尔写坏一处，验证校验的拒绝 */
export function randomRules(w, r, alive, scope = 'city') {
  const n = 1 + r.int(3);
  const rules = Array.from({ length: n }, () => randomRule(w, r, alive, scope));
  if (r.chance(0.08)) rules[0] = { ...rules[0], when: r.pick(['before:whisper', 'after:remember', 'before:retire', 'nope', 5]) };
  if (r.chance(0.05)) rules[0] = { ...rules[0], do: [{ op: 'transfer', from: 'treasury', to: 'treasury', energy: 'agents' }] };
  return rules;
}

const PROCEDURES = (r) => {
  const proposers = r.pick(["has_tag(actor, 'citizen')", 'true', "has_tag(actor, 'citizen') and actor.energy > 20", 'actor.age >= 0']);
  const voters = r.pick(['agents', "filter(agents, has_tag(it, 'citizen'))", "tagged('citizen')", 'sample(agents, 5)', 'filter(agents, awake(it))']);
  const decide = r.pick(['yes > no', 'total > 0 and voted * 1000 >= total * 300 and yes > no', 'yes >= 1', 'yes * 2 > total', 'turnout >= 300 and yes > no']);
  return { proposers, voters, weight: r.pick(['1', '1', 'if(it.energy > 100, 2, 1)']), period: r.pick([6, 12, 12, 24]), secret: r.chance(0.5), decide };
};

export function randomProcedure(r) {
  if (r.chance(0.1)) return { ordinary: { none: true } };
  return r.chance(0.4) ? { ordinary: PROCEDURES(r), constitutional: PROCEDURES(r) } : { [r.pick(['ordinary', 'constitutional'])]: PROCEDURES(r) };
}

/** 登记立法的随机动作的生成器（propose vote draft refound sign rules read） */
export function registerLawGenerators() {
  addGenerators({
    propose: (w, a, r, alive) => {
      const act = { type: 'propose', title: `提案${r.int(100)}`, text: '为了城的长远考虑' };
      if (r.chance(0.12)) act.procedure = randomProcedure(r);
      else if (r.chance(0.9)) act.rules = randomRules(w, r, alive);
      if (r.chance(0.2)) act.basedOn = r.pick(Object.keys(w.laws));
      if (r.chance(0.1)) act.rules = 'junk';
      return act;
    },
    vote: (w, a, r) => {
      const open = Object.values(w.proposals).filter((p) => p.status === 'open');
      return { type: 'vote', proposal: open.length && r.chance(0.9) ? r.pick(open).id : 'p999', choice: r.pick(['yes', 'yes', 'yes', 'no', 'abstain', 'maybe']), reason: r.chance(0.3) ? '我的理由' : undefined };
    },
    draft: (w, a, r, alive) => (r.chance(0.2) ? { type: 'draft', procedure: randomProcedure(r) } : { type: 'draft', rules: randomRules(w, r, alive), scope: r.pick([undefined, undefined, 'city', 'group:g1', 'place:market', 'place:n1']) }),
    refound: (w, a, r) => ({ type: 'refound', text: '重来', procedure: r.chance(0.5) ? 'humans' : { ordinary: PROCEDURES(r), constitutional: r.chance(0.2) ? { none: true } : PROCEDURES(r) } }),
    sign: (w, a, r) => {
      const open = Object.values(w.refounds).filter((x) => x.status === 'open');
      return { type: 'sign', refound: open.length && r.chance(0.9) ? r.pick(open).id : 'r999' };
    },
    // 社群章程、社群的程序、地点规则（主人 / 管事 / 成员各按自己的资格去试，多数会失败，这正是要覆盖的）
    rules: (w, a, r, alive) => {
      const owned = Object.values(w.places).filter((p) => p.owner.kind !== 'city');
      const groups = Object.values(w.groups).filter((g) => !g.dissolved);
      const roll = r.int(10);
      if (roll < 5 && groups.length) {
        const g = a.groups.length && r.chance(0.8) ? w.groups[r.pick(a.groups)] : r.pick(groups);
        if (r.chance(0.15)) return { type: 'rules', group: g.id, procedure: r.pick(['steward', 'members', 'junta']) };
        return { type: 'rules', group: g.id, rules: r.chance(0.1) ? [] : randomRules(w, r, alive, 'group'), title: r.chance(0.5) ? '章程' : undefined, text: r.chance(0.3) ? '说明' : undefined };
      }
      if (owned.length && roll < 9) {
        const p = r.pick(owned);
        return { type: 'rules', place: p.id, rules: r.chance(0.1) ? [] : randomPlaceRules(w, r, p, alive) };
      }
      // 常常自己去占一个地点（让地点规则有机会）
      return { type: 'rules', place: r.pick(Object.keys(w.places)), rules: randomPlaceRules(w, r, null, alive) };
    },
    lawread: (w, a, r) => (r.chance(0.7) ? { type: 'read', law: r.pick(Object.keys(w.laws)) } : { type: 'read', agent: r.pick(agentList(w)).id }),
  });
}

const MODULES = ['store', 'relay', 'sensor', 'archive', 'board', 'surface', 'memorial', 'cradle', 'gate'];

/** 登记城的随机动作（initiate contribute dismantle）：第 6 步 */
export function registerCityGenerators() {
  addGenerators({
    initiate: (w, a, r) => {
      const roll = r.int(10);
      if (roll < 4) {
        const near = lotsNear(w, a.place).filter((id) => w.lots[id].place === null && w.lots[id].project === null);
        const lot = near.length && r.chance(0.85) ? r.pick(near) : r.pick(Object.keys(w.lots));
        return { type: 'initiate', build: 'site', lot, name: `新地${r.int(1000)}`, description: r.chance(0.5) ? '后人的地点' : undefined, owner: r.pick([undefined, 'self', 'city', 'g1']) };
      }
      if (roll < 5) {
        const ruins = Object.values(w.places).filter((p) => p.razed);
        if (ruins.length) return { type: 'initiate', build: 'site', on: r.pick(ruins).id, name: `重建${r.int(1000)}` };
      }
      if (roll < 8) {
        const module = r.pick(MODULES);
        return { type: 'initiate', build: 'module', module, ...(module === 'surface' || r.chance(0.05) ? { inscription: '纪念' } : {}) };
      }
      return { type: 'initiate', build: 'road', to: r.pick(Object.keys(w.places)), name: r.chance(0.5) ? '新路' : undefined };
    },
    contribute: (w, a, r) => {
      const here = Object.values(w.projects).filter((j) => j.status === 'open' && j.place === a.place);
      const j = here.length && r.chance(0.9) ? r.pick(here) : { id: 'j999', need: 10, have: 0 };
      return { type: 'contribute', project: j.id, energy: 1 + r.int(Math.max(1, Math.min(40, j.need - j.have))) };
    },
    dismantle: (w, a, r) => (r.chance(0.3) ? { type: 'dismantle', module: r.pick(MODULES) } : { type: 'dismantle', energy: r.chance(0.5) ? 1 + r.int(20) : undefined }),
  });
}

/** 后代与目的的随机动作（第 7 步）：conceive consent declare，以及带 successor 的 will */
export function registerDescentGenerators() {
  addGenerators({
    conceive: (w, a, r, alive) => {
      const here = alive.filter((x) => x.id !== a.id && x.place === a.place && x.status === 'awake');
      const k = r.chance(0.4) ? 0 : 1 + r.int(Math.min(4, Math.max(1, here.length)));
      const withIds = here.slice(0, k).map((x) => x.id);
      const mem = a.memories.length ? [r.int(a.memories.length)] : undefined;
      return { type: 'conceive', name: `孩子${r.int(400)}`, soul: '一个新的灵魂', lang: r.pick(['zh', 'en']), ...(withIds.length ? { with: withIds } : {}), ...(mem && r.chance(0.5) ? { memories: mem } : {}), ...(r.chance(0.1) ? { cradle: 'school' } : {}) };
    },
    consent: (w, a, r) => {
      const mine = Object.values(w.pacts).filter((c) => c.status === 'open' && c.authors.includes(a.id));
      return { type: 'consent', pact: mine.length && r.chance(0.9) ? r.pick(mine).id : 'c999', ...(a.memories.length && r.chance(0.3) ? { memories: [0] } : {}) };
    },
    sponsor: (w, a, r) => {
      const souls = Object.keys(w.souls);
      return { type: 'sponsor', soul: souls.length && r.chance(0.9) ? r.pick(souls) : 's999', energy: 1 + r.int(a.energy > 60 ? 120 : 20) };
    },
    declare: (w, a, r) => ({ type: 'declare', ...(r.chance(0.7) ? { purpose: r.pick(['修井', '', '记录这座城', '寻找遗物']) } : {}), ...(r.chance(0.4) ? { bio: r.pick(['我是新来的', '']) } : {}) }),
    will: (w, a, r, alive) => ({
      type: 'will',
      heirs: Array.from({ length: 1 + r.int(2) }, () => ({ to: r.chance(0.3) ? 'treasury' : r.pick(alive).id, share: 1 + r.int(5) })),
      lastWords: r.chance(0.5) ? '保重' : undefined,
      ...(r.chance(0.5) ? { successor: { name: `续灯${r.int(60)}`, soul: '传下的灯', memories: r.chance(0.5) ? [0, 5] : undefined } } : {}),
    }),
  });
}

export const DESCENT_TYPES = ['conceive', 'conceive', 'consent', 'consent', 'declare', 'will', 'sponsor', 'sponsor'];

export const CITY_TYPES = ['initiate', 'initiate', 'contribute', 'contribute', 'contribute', 'dismantle', 'dismantle'];

export const LAW_TYPES = ['propose', 'vote', 'vote', 'vote', 'draft', 'refound', 'sign', 'lawread', 'rules', 'rules'];

/** 法律与规则的结构不变量 */
export function lawInvariants(w, assert, msg = '') {
  assert.ok(Object.keys(w.vars).length <= 64, `${msg} vars ${Object.keys(w.vars).length}`);
  for (const g of Object.values(w.groups)) assert.ok(Object.keys(g.vars).length <= 16, `${msg} group vars`);
  for (const cls of ['ordinary', 'constitutional']) {
    const l = w.laws[w.procedure[cls]];
    assert.ok(l && l.procedure && l.procedure[cls], `${msg} procedure ${cls} → ${w.procedure[cls]}`);
    assert.notEqual(l.status, 'repealed', `${msg} procedure law repealed`);
    assert.notEqual(l.status, 'replaced', `${msg} current procedure law replaced`);
  }
  assert.ok(Object.values(w.proposals).filter((p) => p.status === 'open' && p.scope === 'city').length <= 20, `${msg} open proposals`);
  assert.ok(Object.values(w.refounds).filter((x) => x.status === 'open').length <= 3, `${msg} open refounds`);
  for (const l of Object.values(w.laws)) {
    assert.ok(l.paidThrough >= 0 && Number.isInteger(l.suspendedDays), `${msg} ${l.id} paidThrough`);
    assert.ok(l.rules.length <= 8);
    if (l.procedure) assert.equal(l.rules.length, 0);
  }
  for (const a of agentList(w)) if (isAlive(a)) assert.ok(a.tags.length < 200, `${msg} tags ${a.tags.length}`);
  for (const g of Object.values(w.groups)) {
    assert.ok(['steward', 'members'].includes(g.procedure), `${msg} ${g.id} procedure ${g.procedure}`);
    if (g.dissolved) assert.equal(g.bylaws, null, `${msg} ${g.id} dissolved with bylaws`);
    if (g.bylaws) assert.ok(g.bylaws.rules.length >= 1 && g.bylaws.rules.length <= 8);
    assert.ok(Object.values(w.proposals).filter((p) => p.status === 'open' && p.scope === `group:${g.id}`).length <= 3, `${msg} ${g.id} open proposals`);
  }
  assert.ok(w.shells.slots >= 0 && w.founders.every((f, i) => i === 0 || f.day >= w.founders[i - 1].day), `${msg} founders order`);
  assert.ok(Object.values(w.agents).filter((a) => isAlive(a) && (a.body.kind === 'shell' || a.body.shell === true)).length + w.founders.length <= Math.max(w.shells.slots, Object.values(w.agents).filter((a) => isAlive(a) && a.body.kind === 'shell').length + w.founders.length), `${msg} shells`);
  for (const s of Object.values(w.souls)) {
    assert.ok(s.authors.length >= 1 && s.authors.length <= 5, `${msg} ${s.id} authors`);
    assert.ok(s.endowment >= 0 && s.endowment <= 40 && s.fund >= 0, `${msg} ${s.id} holdings`);
    assert.equal(Object.values(s.sponsors).reduce((x, y) => x + y, 0), s.fund, `${msg} ${s.id} sponsors vs fund`);
    assert.ok(s.inheritedMemories.length <= 15, `${msg} ${s.id} memories`);
  }
  for (const c of Object.values(w.pacts)) {
    if (c.status !== 'open') continue;
    assert.equal(c.escrow, Object.values(c.consents).reduce((x, y) => x + y.paid, 0), `${msg} ${c.id} escrow`);
    assert.ok(c.authors.every((x) => w.agents[x].status === 'awake' || w.agents[x].status === 'dormant'), `${msg} ${c.id} has a departed author`);
  }
  for (const a of agentList(w)) if (isAlive(a) && a.will && a.will.successor) assert.ok(a.will.successor.name, `${msg} ${a.id} successor`);
  for (const j of Object.values(w.projects)) {
    assert.ok(['open', 'built', 'abandoned'].includes(j.status), `${msg} ${j.id} status`);
    if (j.status === 'open') assert.ok(j.have < j.need && j.have >= 0, `${msg} ${j.id} have ${j.have}/${j.need}`);
    if (j.status === 'open' && j.lot) assert.equal(w.lots[j.lot].project, j.id, `${msg} ${j.id} lot link`);
    // 遗址上只可能有「在遗址上重新开辟」与修路（身在遗址发起）；加装模块的工程在地点成为遗址时已烂尾
    if (j.status === 'open' && w.places[j.place].razed) assert.ok(j.build === 'site' || j.build === 'road', `${msg} ${j.id} open ${j.build} project at razed place`);
  }
  for (const [id, lot] of Object.entries(w.lots)) {
    if (lot.project) assert.equal(w.projects[lot.project].status, 'open', `${msg} lot ${id} points at a closed project`);
    if (lot.place) assert.ok(w.places[lot.place], `${msg} lot ${id} place`);
  }
  for (const p of Object.values(w.places)) {
    if (p.razed) {
      assert.deepEqual([p.open, p.condition, p.modules.length, p.wallSlots, p.rules, p.owner.kind, p.salvage], [true, null, 0, 0, null, 'city', 0], `${msg} ${p.id} razed state`);
      assert.ok(Object.values(w.inscriptions).filter((i) => i.place === p.id).every((i) => i.lost || i.coveredBy || i.redacted), `${msg} ${p.id} razed with visible walls`);
    } else if (p.origin === 'agent') {
      assert.ok(p.modules.length <= 4 && p.condition !== null, `${msg} ${p.id}`);
    }
    if (p.rules) {
      assert.notEqual(p.owner.kind, 'city', `${msg} ${p.id} city-owned with rules`);
      assert.ok(p.rules.rules.length >= 1 && p.rules.rules.length <= 8);
    }
  }
}
