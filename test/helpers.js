// 测试辅助：创建世界、注册 agent、执行动作、推进时间、检查不变量。
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createWorld, agentList, isAlive } from '../src/world.js';
import { applyCommand } from '../src/engine/index.js';
import { checkConservation, source } from '../src/engine/ledger.js';
import { P } from '../src/params.js';
import { nameKey } from '../src/text.js';
import { createStream, next, int } from '../src/rng.js';

export const sha = (s) => createHash('sha256').update(s).digest('hex');

export function newWorld(seed = 'test-seed', opts = {}) {
  return createWorld({ id: 'test', seed, codeVersion: '0.1.0', ...opts });
}

/** 注册一位 agent（走 register 命令）并返回世界里的 agent 对象 */
export function reg(w, name, o = {}) {
  const { result } = applyCommand(w, {
    type: 'register',
    payload: {
      name, bio: '', soul: `我是${name}`, lang: 'zh', model: 'test-model', creatorName: 'tester',
      tokenHash: sha(`tok:${name}`), ownerKeyHash: sha(`key:${name}`), ...o,
    },
  });
  if (!result.ok) throw new Error(`register(${name}) failed: ${JSON.stringify(result)}`);
  return w.agents[result.agentId];
}

/** 执行一次 act 命令，返回 { result, events } */
export function actRaw(w, agent, actions, thought) {
  const agentId = typeof agent === 'string' ? agent : agent.id;
  return applyCommand(w, { type: 'act', payload: { agentId, thought, actions: Array.isArray(actions) ? actions : [actions] } });
}

/** 执行一次 act，返回 result（{ ok, results, you } 或 { ok:false, error }） */
export function act(w, agent, actions, thought) {
  return actRaw(w, agent, actions, thought).result;
}

/**
 * 执行单个动作并返回它的结果 { index, type, ok, cost, data | error }。
 * 为了让测试能在同一刻里连续尝试很多动作，调用前会把该 agent 本刻的动作次数清零
 * （行动预算本身由 actions-basic.test.js 里专门的测试覆盖，那里直接用 act）。
 */
export function one(w, agent, action) {
  const target = typeof agent === 'string' ? w.agents[agent] : agent;
  target.actsThisTick = 0;
  const r = act(w, agent, [action]);
  assert.equal(r.ok, true, `act request rejected: ${JSON.stringify(r)}`);
  return r.results[0];
}

/** 给 agent 直接补能量 / 旧币，记入账本的 admin 来源（保持守恒） */
export function grant(w, agent, energy = 0, coins = 0) {
  const a = typeof agent === 'string' ? w.agents[agent] : agent;
  a.energy += energy;
  a.coins += coins;
  source(w, 'energy', 'admin', energy);
  source(w, 'coins', 'admin', coins);
  return a;
}

/** 给公库直接补能量 / 旧币，记入账本的 admin 来源（保持守恒） */
export function fundTreasury(w, energy = 0, coins = 0) {
  w.treasury.energy += energy;
  w.treasury.coins += coins;
  source(w, 'energy', 'admin', energy);
  source(w, 'coins', 'admin', coins);
}

/** 推进 n 刻，返回期间产出的全部事件 */
export function tick(w, n = 1) {
  const events = [];
  for (let i = 0; i < n; i++) {
    const r = applyCommand(w, { type: 'tick' });
    assert.equal(r.result.ok, true, `tick failed: ${JSON.stringify(r.result)}`);
    events.push(...r.events);
  }
  return events;
}

/** 推进 n 个整日（到下一个日界之后）。要求当前恰在日界上，或会推进到日界 */
export function tickDays(w, n = 1) {
  const events = [];
  for (let i = 0; i < n; i++) events.push(...tick(w, P.ticksPerDay - (w.clock.tick % P.ticksPerDay)));
  return events;
}

/** 推进到刚过一次日终结算 */
export const settle = (w) => tickDays(w, 1);

export function eventsOf(events, type) {
  return events.filter((e) => e.type === type);
}

/** 世界的基本不变量（每个步骤都会扩充） */
export function assertInvariants(w, msg = '') {
  const c = checkConservation(w);
  assert.ok(c.ok, `${msg} ledger mismatch: ${JSON.stringify(c)}`);
  const seen = new Set();
  for (const a of agentList(w)) {
    assert.ok(Number.isInteger(a.energy) && a.energy >= 0, `${msg} ${a.id} energy=${a.energy}`);
    assert.ok(Number.isInteger(a.coins) && a.coins >= 0, `${msg} ${a.id} coins=${a.coins}`);
    if (a.status === 'dormant') assert.ok(a.energy < P.reviveThreshold, `${msg} ${a.id} dormant with energy ${a.energy}`);
    if (a.status === 'dead' || a.status === 'retired') {
      assert.equal(a.energy, 0, `${msg} ${a.id} dead with energy`);
      assert.equal(a.coins, 0, `${msg} ${a.id} dead with coins`);
    }
    const k = nameKey(a.name);
    assert.ok(!seen.has(k), `${msg} duplicate name ${a.name}`);
    seen.add(k);
    assert.ok(a.inbox.length <= P.inboxKeep + 1);
    assert.ok(a.memories.length <= P.memorySlots);
  }
  assert.ok(Number.isInteger(w.treasury.energy) && w.treasury.energy >= 0);
  assert.ok(Number.isInteger(w.treasury.coins) && w.treasury.coins >= 0);
  for (const g of Object.values(w.groups)) {
    assert.ok(g.treasury.energy >= 0 && g.treasury.coins >= 0);
  }
  for (const p of Object.values(w.places)) {
    if (p.condition !== null) assert.ok(Number.isInteger(p.condition) && p.condition >= 0 && p.condition <= 10000, `${msg} ${p.id} condition ${p.condition}`);
  }
}

/** 测试用的可复现随机源 */
export function rngFor(seed = 'fuzz') {
  const s = createStream(seed, 'test');
  return { f: () => next(s), int: (n) => int(s, n), pick: (arr) => arr[int(s, arr.length)], chance: (p) => next(s) < p };
}

export { agentList, isAlive };
