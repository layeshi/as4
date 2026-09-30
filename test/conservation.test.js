import test from 'node:test';
import assert from 'node:assert/strict';
import { runFuzz, ENV_TYPES, ENV_EXTRA, POLITICS_TYPES, POLITICS_EXTRA, SOCIAL_TYPES, SOCIAL_EXTRA } from './fuzz-lib.js';
import { applyCommand } from '../src/engine/index.js';

test('账本守恒：随机动作序列跑 100 日，每日守恒式精确成立（能量与旧币）', () => {
  const { w, stats } = runFuzz({ seed: 1, days: 100 });
  assert.equal(stats.mismatch, 0);
  assert.equal(w.ledger.mismatches, 0);
  // 场景要有足够的多样性，否则这个测试没有意义
  assert.ok(stats.commands > 3000, `commands=${stats.commands}`);
  assert.ok(stats.dormant > 0, 'no one ever fell dormant');
  assert.ok(stats.deaths > 0, 'no one ever died');
  assert.ok(stats.revives > 0, 'no one was ever revived');
  assert.ok(stats.failures > 0 && stats.failures < stats.results);
  assert.ok(w.cemetery.length > 0);
});

test('账本守恒：换几个种子再跑（每个 40 日）', () => {
  for (const seed of [2, 3, 4]) {
    const { w } = runFuzz({ seed, days: 40, rationShare: seed === 4 ? 0.05 : 0.3 });
    assert.equal(w.ledger.mismatches, 0, `seed ${seed}`);
  }
});

test('账本守恒：带税与财富税的世界同样守恒', () => {
  const { w } = runFuzz({
    seed: 5,
    days: 40,
    setup: (world) => {
      world.params.transferTax = 0.2;
      world.params.wealthTax = 0.25;
      world.params.wealthTaxThreshold = 30;
      world.params.rationRequiresActivity = true;
    },
  });
  assert.equal(w.ledger.mismatches, 0);
  assert.ok(w.treasury.energy >= 0);
});

test('确定性：同一种子与同一命令序列运行两次，最终状态完全相同', () => {
  const run = () => runFuzz({ seed: 9, days: 20, everyCommand: false }).w;
  const a = run();
  const b = run();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('账本守恒：加入环境层的动作（修缮、工程、汲取、铭刻、探索）后，随机动作跑 60 日仍精确守恒', () => {
  const { w, stats } = runFuzz({ seed: 21, days: 60, types: ENV_TYPES, extra: ENV_EXTRA, rationShare: 0.5, agents: 16 });
  assert.equal(w.ledger.mismatches, 0);
  const ev = stats.events;
  for (const t of ['move', 'repair', 'initiate', 'contribute', 'draw', 'inscribe', 'explore']) {
    assert.ok(ev[t] > 0, `没有出现过 ${t} 事件：${JSON.stringify(ev)}`);
  }
  assert.ok(ev.built > 0, '没有工程建成');
  assert.ok(Object.keys(w.inscriptions).length > 8);
  assert.ok(w.places.well.condition < 10000);
});

test('账本守恒：环境层跑 120 日，含烂尾、废墟与修复', () => {
  const { w, stats } = runFuzz({ seed: 22, days: 120, types: ENV_TYPES, extra: ENV_EXTRA, rationShare: 0.4, agents: 10, everyCommand: false });
  assert.equal(w.ledger.mismatches, 0);
  assert.ok(stats.events.abandoned > 0 || stats.events.built > 0);
  assert.ok(stats.events.ruin > 0, JSON.stringify(stats.events));
});

test('账本守恒：加入政治（提案、投票、全部效力）后，随机动作跑 100 日仍精确守恒', () => {
  const { w, stats } = runFuzz({
    seed: 31,
    days: 100,
    types: POLITICS_TYPES,
    extra: POLITICS_EXTRA,
    rationShare: 0.5,
    agents: 16,
    setup: (world) => {
      world.params.quorum = 0.05; // 让法律容易通过，覆盖尽量多的效力
      world.params.proposalDays = 0.25;
    },
  });
  assert.equal(w.ledger.mismatches, 0);
  const ev = stats.events;
  for (const t of ['propose', 'vote', 'law_passed', 'law_rejected']) assert.ok(ev[t] > 0, `没有出现过 ${t}：${JSON.stringify(ev)}`);
  const seen = new Set(Object.values(w.laws).flatMap((l) => l.effects.map((e) => e.type)));
  assert.ok(seen.size >= 5, `通过的法律里只见到这些效力：${[...seen]}`);
  assert.ok(Object.keys(w.laws).length >= 10);
});

test('账本守恒：加入社会（社群、交易、典籍、孕育、领养、归隐、家书）后，随机动作跑 100 日仍精确守恒', () => {
  let adopted = 0;
  const { w, stats } = runFuzz({
    seed: 41,
    days: 100,
    types: SOCIAL_TYPES,
    extra: SOCIAL_EXTRA,
    rationShare: 0.5,
    agents: 18,
    setup: (world) => {
      // 每隔一段时间：给某个 agent 寄家书，并让一位路过的玩家领养摇篮里的灵魂
      world.$fuzzHook = (tickNo) => {
        if (tickNo % 30 === 7) {
          const target = Object.values(world.agents).find((a) => a.status === 'awake' && a.lastLetterDay === null);
          if (target) applyCommand(world, { type: 'letter', payload: { agentId: target.id, text: '好好活着。' } });
        }
        if (tickNo % 40 === 11) {
          const soul = Object.values(world.souls)[0];
          if (soul) {
            const h = (s) => s.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'a');
            const res = applyCommand(world, { type: 'adopt', payload: { soulId: soul.id, model: 'm', creatorName: '', tokenHash: h(`t${soul.id}`), ownerKeyHash: h(`k${soul.id}`) } });
            if (res.result.ok) adopted++;
          }
        }
      };
    },
  });
  assert.equal(w.ledger.mismatches, 0);
  const ev = stats.events;
  for (const t of ['found', 'join', 'offer_open', 'trade', 'write', 'read', 'define', 'conceive', 'soul', 'retire', 'reveal']) {
    assert.ok(ev[t] > 0, `没有出现过 ${t}：${JSON.stringify(ev)}`);
  }
  // 家书与领养由钩子直接执行，不经过统计事件的循环，所以看世界状态
  assert.ok(Object.values(w.agents).some((a) => a.letters.length > 0), '没有寄出过家书');
  assert.ok(adopted > 0 && Object.values(w.agents).some((a) => a.generation > 0), '没有发生领养');
});
