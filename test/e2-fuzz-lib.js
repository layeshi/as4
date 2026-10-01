// 第二纪的随机动作序列生成器：给账本守恒等测试用。每一步都会扩充可生成的动作种类。
import assert from 'node:assert/strict';
import { agentList, isAlive } from '../src/e2/world.js';
import { P } from '../src/e2/params.js';
import { applyCommand } from '../src/e2/engine/index.js';
import { newWorld, bareWorld, sha, assertInvariants, rngFor } from './e2-helpers.js';

const WORDS = ['灯', '井', '你好', 'hello', 'gracias', 'привет', 'ありがとう', '今天的配给', '谁在议会？', '🌙', 'x'.repeat(30)];

/** 偶尔生成不合法的参数，验证引擎不会崩溃、也不会因此改变账本 */
export function junk(r) {
  return r.pick([undefined, null, -3, 0, 1.5, '7', 'abc', [], {}, true, 10 ** 12, NaN]);
}

const placeIds = (w) => Object.keys(w.places);

/** 第 3 步的动作 */
export const BASE_TYPES = [
  'move', 'move', 'move', 'move', 'say', 'whisper', 'broadcast', 'give', 'remember', 'forget', 'diary', 'will',
  'repair', 'repair', 'draw', 'draw', 'inscribe', 'explore', 'explore', 'found', 'join', 'leave', 'admit', 'steward', 'disburse',
  'offer', 'offer', 'accept', 'accept', 'cancel', 'write', 'read', 'define', 'epitaph', 'reveal', 'retire',
];

const GENERATORS = {
  move: (w, a, r) => ({ type: 'move', to: r.chance(0.05) ? junk(r) : r.pick(r.chance(0.4) ? ['market', 'library', 'cemetery', 'well', 'wilds', 'agora', 'school'] : placeIds(w)) }),
  say: (w, a, r) => ({ type: 'say', text: r.chance(0.05) ? junk(r) : r.pick(WORDS) }),
  whisper: (w, a, r, alive) => ({ type: 'whisper', to: r.chance(0.08) ? junk(r) : r.pick(alive).id, text: r.pick(WORDS) }),
  broadcast: (w, a, r) => ({ type: 'broadcast', text: r.pick(WORDS) }),
  give: (w, a, r, alive) => {
    const to = r.chance(0.15) ? 'treasury' : r.chance(0.1) && Object.keys(w.groups).length ? r.pick(Object.keys(w.groups)) : r.pick(alive).id;
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
  repair: (w, a, r) => {
    const roads = Object.keys(w.roads);
    const target = r.chance(0.7) || roads.length === 0 ? (r.chance(0.5) ? a.place : undefined) : r.pick(roads);
    return { type: 'repair', target: r.chance(0.04) ? junk(r) : target, energy: r.chance(0.04) ? junk(r) : 1 + r.int(40) };
  },
  draw: (w, a, r) => ({ type: 'draw', energy: r.chance(0.05) ? junk(r) : 1 + r.int(20) }),
  inscribe: (w, a, r) => {
    const act = { type: 'inscribe', text: r.pick(WORDS) };
    if (r.chance(0.4)) {
      const vis = Object.values(w.inscriptions).filter((i) => i.place === a.place && !i.coveredBy && !i.lost);
      if (vis.length) act.cover = r.pick(vis).id;
    }
    return act;
  },
  explore: () => ({ type: 'explore' }),
  found: (w, a, r) => ({ type: 'found', name: r.pick(WORDS).slice(0, 8) || '会', manifesto: r.pick(WORDS), open: r.chance(0.5), procedure: r.chance(0.3) ? r.pick(['steward', 'members']) : undefined }),
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
  // 归隐是不可逆的：只偶尔发生，否则人口很快归零，其余动作就没有机会被覆盖
  retire: (w, a, r) => (r.chance(0.02) ? { type: 'retire', lastWords: r.chance(0.5) ? r.pick(WORDS) : undefined } : { type: 'say', text: r.pick(WORDS) }),
};

function pickGroup(w, r) {
  const ids = Object.keys(w.groups);
  return ids.length && r.chance(0.9) ? r.pick(ids) : 'g999';
}

/** 后面的步骤往这里登记新动作的生成器：addGenerators({ type: (w, a, r, alive) => act })，并把类型加进 types */
export function addGenerators(gens) {
  Object.assign(GENERATORS, gens);
}

/** 生成 1–5 个动作（偶尔超出预算，验证 budget_exhausted） */
export function randomActions(w, a, r, types = BASE_TYPES) {
  const alive = agentList(w).filter(isAlive);
  const n = 1 + r.int(r.chance(0.1) ? 5 : 4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const type = r.pick(types);
    out.push(GENERATORS[type](w, a, r, alive));
  }
  return out;
}

/**
 * 账本守恒：随机动作序列跑若干日，每个命令之后、每日结算之后守恒式都精确成立。
 * 先民不入城（没有先民文件），居民由测试注册。
 */
export function runFuzz({ seed, days, types = BASE_TYPES, setup, everyCommand = true, agents = 14, hook, bare = true, worldOpts = {}, registerExtra, collect }) {
  const w = (bare ? bareWorld : newWorld)(`fuzz-${seed}`, worldOpts);
  if (setup) setup(w);
  const r = rngFor(`fuzz-${seed}`);
  const stats = { commands: 0, deaths: 0, dormant: 0, revives: 0, results: 0, failures: 0, mismatch: 0, events: {}, actions: {} };
  const count = (evs) => {
    for (const e of evs) stats.events[e.type] = (stats.events[e.type] || 0) + 1;
    if (collect) collect.push(...evs);
  };
  let nameSeq = 0;
  const register = () => {
    const name = `居民${++nameSeq}`;
    const res = applyCommand(w, {
      type: 'register',
      payload: { name, bio: '', soul: 's', lang: r.pick(['zh', 'en', 'es']), model: 'm', tokenHash: sha(`t${name}`), ownerKeyHash: sha(`k${name}`), ...(registerExtra ? registerExtra(name) : {}) },
    });
    if (collect) collect.push(...res.events);
    assert.equal(res.result.ok, true);
  };
  for (let i = 0; i < agents; i++) register();
  const ticks = days * P.ticksPerDay;
  for (let t = 0; t < ticks; t++) {
    if (hook) hook(w, t, r);
    for (const a of agentList(w)) {
      if (a.status !== 'awake' || !r.chance(0.5)) continue;
      const acts = randomActions(w, a, r, types);
      const res = applyCommand(w, { type: 'act', payload: { agentId: a.id, thought: r.chance(0.3) ? '想一想' : undefined, actions: acts } });
      stats.commands++;
      if (res.result.ok) {
        for (const x of res.result.results) {
          stats.results++;
          const s = (stats.actions[x.type] ||= { ok: 0, fail: 0 });
          if (x.ok) s.ok++;
          else {
            s.fail++;
            stats.failures++;
          }
        }
      }
      count(res.events);
      for (const e of res.events) if (e.type === 'revive') stats.revives++;
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
