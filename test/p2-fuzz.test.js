// SPEC-P2：第二前提世界的随机测试——常驻指令、屏蔽、匿名私语、交易、孕育、社群混在一起，
// 每日检查守恒与不变量；命令日志回放得到同样的状态（第二前提的新状态都在命令之内）。
import test from 'node:test';
import assert from 'node:assert/strict';
import e2 from '../src/e2/facade.js';
import { applyCommand } from '../src/e2/engine/index.js';
import { genesisOpts, agentList } from '../src/e2/world.js';
import { stateHash } from '../src/store.js';
import { P } from '../src/e2/params.js';
import { sha, assertInvariants, rngFor } from './e2-helpers.js';

const NAMES = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
const PLACES = ['port', 'market', 'library', 'parliament', 'well', 'school'];

/** 一条随机的常驻指令（语法与名字都合法；执行时可能出错、被跳过——这正是要测的） */
function randomOrder(R, ids) {
  const when = R.pick(['tick', 'daily', 'inbox:whisper', 'inbox:offer', 'inbox:pact', 'inbox:memory_offer', 'inbox:group', 'inbox:gift']);
  const inbox = when.startsWith('inbox:');
  const conds = [null, 'me.energy < 60', 'left >= 2', "me.place == 'market'", 'count(here) > 1', 'city.day >= 1', ...(inbox ? ["it.from.id == 'a2'", 'it.anonymous == true', 'it.tick > 3'] : [])];
  const acts = [
    { type: 'say', text: '常驻指令说话' },
    { type: 'diary', text: '常驻指令的日记' },
    { type: 'move', to: R.pick(PLACES) },
    { type: 'draw', energy: 3 },
    { type: 'give', to: R.pick(ids), energy: 2 },
    { type: 'whisper', to: R.pick(ids), text: '自动私语', anonymous: R.chance(0.5) },
    { type: 'mute', who: R.pick([...ids, 'anonymous']) },
    ...(inbox ? [{ type: 'whisper', to: '=it.from.id', text: '自动回信' }, { type: 'accept', offer: '=it.offerId' }, { type: 'give', to: '=it.from.id', energy: '=min(3, me.energy / 10)' }] : []),
  ];
  const o = { when, do: Array.from({ length: 1 + R.int(2) }, () => ({ ...R.pick(acts) })) };
  const cond = R.pick(conds);
  if (cond) o.if = cond;
  if (R.chance(0.3)) o.times = 1 + R.int(20);
  if (R.chance(0.2)) o.untilDay = 1 + R.int(15);
  return o;
}

function randomAction(R, w, a, ids) {
  const other = R.pick(ids.filter((x) => x !== a.id));
  switch (R.int(14)) {
    case 0: return { type: 'say', text: `闲话${R.int(100)}` };
    case 1: return { type: 'whisper', to: other, text: '私语', ...(R.chance(0.4) ? { anonymous: true } : {}) };
    case 2: return { type: 'mute', who: R.pick([...ids, 'anonymous']), ...(R.chance(0.3) ? { on: false } : {}) };
    case 3: return { type: 'standing', orders: R.chance(0.2) ? [] : Array.from({ length: 1 + R.int(3) }, () => randomOrder(R, ids)) };
    case 4: return { type: 'offer', to: other, give: { energy: 0, coins: 1 + R.int(3) }, want: { energy: 1 + R.int(3), coins: 0 } };
    case 5: {
      const open = Object.values(w.offers).filter((o) => o.status === 'open' && o.to === a.id);
      return open.length ? { type: 'accept', offer: R.pick(open).id } : { type: 'diary', text: '无事' };
    }
    case 6: return { type: 'give', to: other, energy: 1 + R.int(4) };
    case 7: return { type: 'move', to: R.pick(PLACES) };
    case 8: return { type: 'diary', text: '日记' };
    case 9: return { type: 'remember', text: `记忆${R.int(50)}` };
    case 10: return { type: 'impart', to: other, memory: 0 };
    case 11: return { type: 'conceive', name: `孩${R.int(1000)}`, soul: '灵魂', with: R.chance(0.5) ? [other] : [] };
    case 12: return { type: 'draw', energy: 1 + R.int(5) };
    default: return { type: 'broadcast', text: '宣告' };
  }
}

function run(seed, days) {
  const R = rngFor(seed);
  const w = e2.createWorld({ id: 'p2-fuzz', seed, codeVersion: '0.1.0', premise: 2, shellSlots: 12 });
  const log = [];
  const exec = (cmd) => { log.push(cmd); return applyCommand(w, cmd); };
  const ids = NAMES.map((n) => exec({ type: 'register', payload: { name: n, bio: '', soul: `我是${n}`, lang: R.chance(0.5) ? 'zh' : 'en', model: 'm', creatorName: 't', tokenHash: sha(`t:${n}`), ownerKeyHash: sha(`k:${n}`) } }).result.agentId);
  let standingSet = 0;
  let fired = 0;
  for (let t = 0; t < days * P.ticksPerDay; t++) {
    const r = exec({ type: 'tick' });
    assert.equal(r.result.ok, true);
    for (const a of agentList(w)) {
      if (a.status !== 'awake' || !R.chance(0.35)) continue;
      const actions = Array.from({ length: 1 + R.int(2) }, () => randomAction(R, w, a, ids));
      const out = exec({ type: 'act', payload: { agentId: a.id, lang: R.chance(0.5) ? 'en' : 'zh', actions } });
      assert.equal(out.result.ok, true, JSON.stringify(out.result));
      standingSet += out.result.results.filter((x) => x.type === 'standing' && x.ok).length;
    }
    for (const e of r.events) if (e.type === 'standing_fired') fired++;
    if (r.result.settled) assertInvariants(w, `seed ${seed} tick ${t}`);
    // 新状态的形状：每位居民的指令与屏蔽名单始终合法
    for (const a of agentList(w)) {
      assert.ok(Array.isArray(a.standing) && a.standing.length <= P.standingMax, `${a.id} standing ${a.standing && a.standing.length}`);
      assert.ok(Array.isArray(a.muted) && a.muted.length <= P.muteMax);
      assert.ok(a.standing.every((o) => o.fired >= 0 && (o.times === null || o.fired <= o.times) && Number.isInteger(o.paidThrough)));
      if (a.status === 'dead' || a.status === 'retired') assert.deepEqual(a.standing, []);
    }
  }
  return { w, log, standingSet, fired };
}

// 本地想跑得更深：P2_FUZZ_SEEDS=40 P2_FUZZ_DAYS=40 node --test test/p2-fuzz.test.js
const SEEDS = Number(process.env.P2_FUZZ_SEEDS || 3);
const DAYS = Number(process.env.P2_FUZZ_DAYS || 20);

test('P2 随机：常驻指令、屏蔽、匿名私语与其余动作混在一起——不抛错、每日守恒、状态合法', () => {
  let sets = 0;
  let fired = 0;
  for (const seed of Array.from({ length: SEEDS }, (_, i) => `p2-fuzz-${i + 1}`)) {
    const { w, standingSet, fired: f } = run(seed, DAYS);
    assert.equal(w.ledger.mismatches, 0, seed);
    sets += standingSet;
    fired += f;
    assert.ok(w.metrics.length >= DAYS - 1);
    assert.ok(w.metrics.every((m) => Number.isInteger(m.standingFired) && Number.isInteger(m.mutedPairs)));
  }
  assert.ok(sets > 20, `设定了 ${sets} 次常驻指令`);
  assert.ok(fired > 20, `触发了 ${fired} 次`);
});

test('P2 随机：由创建参数与命令日志重建的世界与原来的状态哈希相同', () => {
  for (const seed of ['p2-fuzz-4', 'p2-fuzz-5']) {
    const { w, log } = run(seed, 15);
    const again = e2.createWorld(genesisOpts(JSON.parse(JSON.stringify(w))));
    for (const cmd of log) applyCommand(again, cmd);
    assert.equal(stateHash(again), stateHash(w), seed);
    // 同种子同命令：再跑一次也一样
    assert.equal(stateHash(run(seed, 15).w), stateHash(w), seed);
  }
});
