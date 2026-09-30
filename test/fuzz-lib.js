// 随机动作序列的生成器：给账本守恒等测试用。每一步都会扩充可生成的动作种类。
import assert from 'node:assert/strict';
import { agentList, isAlive } from '../src/world.js';
import { P } from '../src/params.js';
import { placeIdsOf } from '../src/map/index.js';
import { applyCommand } from '../src/engine/index.js';
import { newWorld, sha, assertInvariants, rngFor } from './helpers.js';

const WORDS = ['灯', '井', '你好', 'hello', 'gracias', 'привет', 'ありがとう', '今天的配给', '谁在议会？', '🌙', 'x'.repeat(30)];

/** 偶尔生成不合法的参数，验证引擎不会崩溃、也不会因此改变账本 */
function junk(r) {
  return r.pick([undefined, null, -3, 0, 1.5, '7', 'abc', [], {}, true, 10 ** 12, NaN]);
}

/** 第 2 步的动作 */
export const BASIC_TYPES = ['move', 'say', 'whisper', 'broadcast', 'give', 'remember', 'forget', 'diary', 'will'];

const GENERATORS = {
  move: (w, a, r) => ({ type: 'move', to: r.chance(0.05) ? junk(r) : r.pick(placeIdsOf(w)) }),
  say: (w, a, r) => ({ type: 'say', text: r.chance(0.05) ? junk(r) : r.pick(WORDS) }),
  whisper: (w, a, r, alive) => ({ type: 'whisper', to: r.chance(0.08) ? junk(r) : r.pick(alive).id, text: r.pick(WORDS) }),
  broadcast: (w, a, r) => ({ type: 'broadcast', text: r.pick(WORDS) }),
  give: (w, a, r, alive) => {
    const to = r.chance(0.15) ? 'treasury' : r.pick(alive).id;
    const act = { type: 'give', to };
    if (r.chance(0.7)) act.energy = r.chance(0.05) ? junk(r) : 1 + r.int(12);
    if (r.chance(0.4)) act.coins = r.chance(0.05) ? junk(r) : 1 + r.int(6);
    if (r.chance(0.3)) act.note = r.pick(WORDS);
    return act;
  },
  remember: (w, a, r) => ({ type: 'remember', text: r.pick(WORDS) }),
  forget: (w, a, r) => ({ type: 'forget', index: r.chance(0.1) ? junk(r) : r.int(13) }),
  diary: (w, a, r) => ({ type: 'diary', text: r.pick(WORDS) }),
  will: (w, a, r, alive) => ({
    type: 'will',
    heirs: r.chance(0.1) ? junk(r) : Array.from({ length: 1 + r.int(3) }, () => ({ to: r.chance(0.3) ? 'treasury' : r.pick(alive).id, share: 1 + r.int(5) })),
    lastWords: r.chance(0.5) ? r.pick(WORDS) : undefined,
  }),
};

/** 第 3 步的动作 */
export const ENV_TYPES = ['move', 'move', 'move', 'say', 'give', 'repair', 'repair', 'initiate', 'contribute', 'contribute', 'draw', 'draw', 'inscribe', 'explore', 'explore', 'remember'];

const FACILITIES = ['reservoir', 'relay', 'road', 'observatory', 'monument'];
const ENV_GENERATORS = {
  repair: (w, a, r) => {
    const facs = Object.keys(w.facilities);
    const target = r.chance(0.5) || facs.length === 0 ? a.place : r.pick(facs);
    return { type: 'repair', target: r.chance(0.04) ? junk(r) : target, energy: r.chance(0.04) ? junk(r) : 1 + r.int(40) };
  },
  initiate: (w, a, r) => {
    const facility = r.pick(FACILITIES);
    const act = { type: 'initiate', facility, name: r.pick(WORDS).slice(0, 10) || 'n' };
    if (facility === 'road') act.to = r.pick(placeIdsOf(w));
    if (facility === 'monument' || r.chance(0.2)) act.inscription = r.pick(WORDS);
    if (facility === 'reservoir' && r.chance(0.5)) act.owner = 'self';
    return act;
  },
  contribute: (w, a, r) => {
    const open = Object.values(w.projects).filter((j) => j.status === 'open');
    const j = open.length && r.chance(0.9) ? r.pick(open) : { id: 'j999', need: 30, have: 0 };
    const left = Math.max(1, j.need - j.have);
    return { type: 'contribute', project: j.id, energy: r.chance(0.05) ? junk(r) : 1 + r.int(Math.min(left, 60)) };
  },
  draw: (w, a, r) => ({ type: 'draw', energy: r.chance(0.05) ? junk(r) : 1 + r.int(20) }),
  inscribe: (w, a, r) => {
    const act = { type: 'inscribe', text: r.pick(WORDS) };
    if (r.chance(0.4)) {
      const vis = Object.values(w.inscriptions).filter((i) => i.place === a.place && !i.coveredBy);
      if (vis.length) act.cover = r.pick(vis).id;
    }
    return act;
  },
  explore: () => ({ type: 'explore' }),
};
export const ENV_EXTRA = ENV_GENERATORS;

/** 第 4 步的动作 */
export const POLITICS_TYPES = ['move', 'move', 'move', 'propose', 'propose', 'vote', 'vote', 'vote', 'vote', 'give', 'draw', 'contribute', 'initiate', 'inscribe', 'say'];

const SET_VALUES = {
  rationShare: (r) => r.pick([0.1, 0.3, 0.6, 0.9, 0.5]),
  rationRequiresActivity: (r) => r.chance(0.5),
  transferTax: (r) => r.pick([0, 0.05, 0.2]),
  wealthTax: (r) => r.pick([0, 0.05, 0.3]),
  wealthTaxThreshold: (r) => r.pick([0, 50, 100, 300]),
  drawQuotaPerDay: (r) => r.pick([null, 0, 5, 20]),
  votingInPerson: (r) => r.chance(0.3),
  naturalizationDays: (r) => r.pick([0, 0, 1]),
  quorum: (r) => r.pick([0.05, 0.1, 0.3]),
  passThreshold: (r) => r.pick([0.5, 0.6]),
  amendThreshold: (r) => r.pick([0.5, 0.667]),
  proposalDays: (r) => r.pick([0.25, 0.5, 1]),
  electorate: (r, w) => r.pick(['all', 'all', ...Object.keys(w.groups).map((g) => `group:${g}`)]),
};

function randomEffect(w, r, alive) {
  const type = r.pick(['set', 'set', 'grant', 'stipend', 'fund', 'exile', 'pardon', 'rename', 'mint', 'protect', 'unprotect', 'amend', 'repeal']);
  const anyAgent = () => r.pick(alive).id;
  switch (type) {
    case 'set': {
      const param = r.pick(Object.keys(SET_VALUES));
      return { type, param, value: SET_VALUES[param](r, w) };
    }
    case 'grant': return { type, to: anyAgent(), energy: r.int(30), coins: r.int(5) };
    case 'stipend': return { type, to: anyAgent(), energy: 1 + r.int(12) };
    case 'fund': {
      const open = Object.values(w.projects).filter((j) => j.status === 'open');
      return { type, project: open.length ? r.pick(open).id : 'j999', energy: 1 + r.int(80) };
    }
    case 'exile': case 'pardon': return { type, target: anyAgent() };
    case 'rename': return { type, target: r.pick(['city', ...placeIdsOf(w)]), name: r.pick(WORDS).slice(0, 8) || 'n' };
    case 'mint': return { type, coins: 1 + r.int(30), to: r.pick(['treasury', 'citizens']) };
    case 'protect': case 'unprotect': {
      const ids = Object.keys(w.inscriptions);
      return { type, inscription: r.pick(ids) };
    }
    case 'amend':
      return r.chance(0.3)
        ? { type, canonical: r.pick(['zh', 'en', 'es', null]) }
        : { type, article: 1 + r.int(w.charter.length + 1), lang: r.pick(['zh', 'en', 'es']), text: r.chance(0.2) ? '' : r.pick(WORDS) };
    default: {
      const active = Object.values(w.laws).filter((l) => l.status === 'active');
      return { type: 'repeal', law: active.length ? r.pick(active).id : 'l999' };
    }
  }
}

const POLITICS_GENERATORS = {
  propose: (w, a, r, alive) => ({
    type: 'propose',
    title: r.pick(WORDS).slice(0, 12) || '题',
    text: r.pick(WORDS),
    effects: r.chance(0.2) ? undefined : Array.from({ length: r.int(3) }, () => randomEffect(w, r, alive)),
  }),
  vote: (w, a, r) => {
    const open = Object.values(w.proposals).filter((p) => p.status === 'open');
    return { type: 'vote', proposal: open.length ? r.pick(open).id : 'p999', choice: r.chance(0.75) ? 'yes' : r.pick(['no', 'abstain']), reason: r.chance(0.3) ? r.pick(WORDS) : undefined };
  },
};
export const POLITICS_EXTRA = { ...ENV_GENERATORS, ...POLITICS_GENERATORS };

/** 第 5 步的动作 */
export const SOCIAL_TYPES = ['move', 'move', 'move', 'say', 'found', 'join', 'leave', 'admit', 'steward', 'disburse', 'give', 'offer', 'offer', 'accept', 'accept', 'cancel', 'write', 'read', 'define', 'epitaph', 'reveal', 'conceive', 'consent', 'will', 'retire'];

const SOCIAL_GENERATORS = {
  found: (w, a, r) => ({ type: 'found', name: r.pick(WORDS).slice(0, 8) || '会', manifesto: r.pick(WORDS), open: r.chance(0.5) }),
  join: (w, a, r) => ({ type: 'join', group: pickGroup(w, r) }),
  leave: (w, a, r) => ({ type: 'leave', group: a.groups.length && r.chance(0.8) ? r.pick(a.groups) : pickGroup(w, r) }),
  admit: (w, a, r, alive) => ({ type: 'admit', group: pickGroup(w, r), agent: r.pick(alive).id }),
  steward: (w, a, r, alive) => ({ type: 'steward', group: pickGroup(w, r), to: r.pick(alive).id }),
  disburse: (w, a, r, alive) => ({ type: 'disburse', group: pickGroup(w, r), to: r.pick(alive).id, energy: r.chance(0.6) ? 1 + r.int(8) : undefined, coins: r.chance(0.4) ? 1 + r.int(3) : undefined }),
  offer: (w, a, r, alive) => {
    const energyForCoins = r.chance(0.5);
    const act = { type: 'offer', give: energyForCoins ? { energy: 1 + r.int(8) } : { coins: 1 + r.int(4) }, want: energyForCoins ? { coins: 1 + r.int(4) } : { energy: 1 + r.int(8) } };
    if (r.chance(0.3)) act.to = r.pick(alive).id;
    if (r.chance(0.1)) act.give = junk(r);
    return act;
  },
  accept: (w, a, r) => {
    const open = Object.values(w.offers).filter((o) => o.status === 'open');
    return { type: 'accept', offer: open.length && r.chance(0.9) ? r.pick(open).id : 'o999' };
  },
  cancel: (w, a, r) => {
    const mine = Object.values(w.offers).filter((o) => o.status === 'open' && o.from === a.id);
    return { type: 'cancel', offer: mine.length && r.chance(0.8) ? r.pick(mine).id : 'o999' };
  },
  write: (w, a, r) => ({ type: 'write', title: r.pick(WORDS).slice(0, 10) || '题', body: r.pick(WORDS) }),
  read: (w, a, r) => {
    const docs = Object.keys(w.docs);
    return r.chance(0.7) ? { type: 'read', doc: r.pick(docs) } : { type: 'read', inscription: r.pick(Object.keys(w.inscriptions)) };
  },
  define: (w, a, r) => ({ type: 'define', word: r.pick(['灯', '井', '你好', 'hello', 'gracias', '今天的配给']), meaning: r.pick(WORDS) }),
  epitaph: (w, a, r, alive) => {
    const dead = Object.values(w.agents).filter((x) => x.status === 'dead');
    return { type: 'epitaph', deceased: dead.length && r.chance(0.9) ? r.pick(dead).id : r.pick(alive).id, text: r.pick(WORDS) };
  },
  reveal: (w, a, r) => ({ type: 'reveal', letter: a.letters.length && r.chance(0.9) ? r.pick(a.letters).id : 'L999', loud: r.chance(0.3) }),
  conceive: (w, a, r, alive) => ({ type: 'conceive', with: r.pick(alive).id, name: `孩子${r.int(400)}`, soul: r.pick(WORDS) }),
  consent: (w, a, r) => {
    const open = Object.values(w.pacts).filter((c) => c.status === 'open');
    return { type: 'consent', pact: open.length && r.chance(0.9) ? r.pick(open).id : 'c999' };
  },
  // 归隐是不可逆的：只偶尔发生，否则人口很快归零，其余动作就没有机会被覆盖
  retire: (w, a, r) => (r.chance(0.02) ? { type: 'retire', lastWords: r.chance(0.5) ? r.pick(WORDS) : undefined } : { type: 'say', text: r.pick(WORDS) }),
};
function pickGroup(w, r) {
  const ids = Object.keys(w.groups);
  return ids.length && r.chance(0.9) ? r.pick(ids) : 'g999';
}
export const SOCIAL_EXTRA = { ...POLITICS_GENERATORS, ...ENV_GENERATORS, ...SOCIAL_GENERATORS };

/** 生成 1–5 个动作（偶尔超出预算，验证 budget_exhausted） */
export function randomActions(w, a, r, types = BASIC_TYPES, extra = {}) {
  const gens = { ...GENERATORS, ...extra };
  const alive = agentList(w).filter(isAlive);
  const n = 1 + r.int(r.chance(0.1) ? 5 : 4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const type = r.pick(types);
    out.push(gens[type](w, a, r, alive));
  }
  return out;
}

/**
 * 测试 1：账本守恒——随机动作序列跑 100 日，每个命令之后、每日结算之后守恒式都精确成立。
 * 用较小的配给制造饥饿，使沉睡、唤醒、死亡、遗嘱都会发生。
 */
export function runFuzz({ seed, days, types = BASIC_TYPES, extra = {}, setup, everyCommand = true, agents = 14, rationShare = 0.15 }) {
  const w = newWorld(`fuzz-${seed}`);
  w.params.rationShare = rationShare;
  if (setup) setup(w);
  const r = rngFor(`fuzz-${seed}`);
  const stats = { commands: 0, deaths: 0, dormant: 0, revives: 0, results: 0, failures: 0, mismatch: 0, events: {} };
  const count = (evs) => { for (const e of evs) stats.events[e.type] = (stats.events[e.type] || 0) + 1; };
  let nameSeq = 0;
  const register = () => {
    const name = `居民${++nameSeq}`;
    const res = applyCommand(w, {
      type: 'register',
      payload: { name, bio: '', soul: 's', lang: r.pick(['zh', 'en', 'es']), model: 'm', tokenHash: sha(`t${name}`), ownerKeyHash: sha(`k${name}`) },
    });
    assert.equal(res.result.ok, true);
  };
  for (let i = 0; i < agents; i++) register();
  const ticks = days * P.ticksPerDay;
  for (let t = 0; t < ticks; t++) {
    if (w.$fuzzHook) w.$fuzzHook(t);
    for (const a of agentList(w)) {
      if (a.status !== 'awake' || !r.chance(0.5)) continue;
      const acts = randomActions(w, a, r, types, extra);
      const res = applyCommand(w, { type: 'act', payload: { agentId: a.id, thought: r.chance(0.3) ? '想一想' : undefined, actions: acts } });
      stats.commands++;
      if (res.result.ok) {
        for (const x of res.result.results) {
          stats.results++;
          if (!x.ok) stats.failures++;
        }
      }
      count(res.events);
      for (const e of res.events) {
        if (e.type === 'revive') stats.revives++;
      }
      if (everyCommand) assertInvariants(w, `t=${t} act`);
    }
    if (r.chance(0.02) && agentList(w).length < 30) register();
    const res = applyCommand(w, { type: 'tick' });
    count(res.events);
    for (const e of res.events) {
      if (e.type === 'death') stats.deaths++;
      if (e.type === 'dormant') stats.dormant++;
      if (e.type === 'ledger_mismatch') stats.mismatch++;
    }
    assert.equal(res.events.filter((e) => e.type === 'ledger_mismatch').length, 0, `ledger_mismatch at tick ${w.clock.tick}`);
    assertInvariants(w, `t=${t} tick`);
  }
  return { w, stats };
}
