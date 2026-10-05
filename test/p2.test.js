// SPEC-P2 的引擎层测试：T1（设定版本）、T3–T6、T17、T18 随各步骤加入。
// 黄金样本的比对在 p2-golden.test.js。
import test from 'node:test';
import assert from 'node:assert/strict';
import e2, { premised, agentic } from '../src/e2/facade.js';
import { genesisOpts, newDayLog } from '../src/e2/world.js';
import { loadConfig } from '../src/config.js';
import { stateHash } from '../src/store.js';
import { reg, tickDays, assertInvariants } from './e2-helpers.js';

const P2_DAYLOG_KEYS = ['standingSets', 'standingFired', 'standingFailed', 'standingSkipped', 'standingErrors', 'standingUpkeep', 'standingSuspended', 'standingExpired', 'anonymousWhispers', 'mutes', 'muteBlocked'];

// ═══════════════════════════════════════════════════════════════
// T1：设定版本 2
// ═══════════════════════════════════════════════════════════════

test('P2 T1: PREMISE 的配置校验——0、1、2 合法，其余报错；1 与 2 只用于第二纪', () => {
  for (const n of ['0', '1', '2']) assert.equal(loadConfig({ PHYSICS: '2', PREMISE: n }, []).premise, Number(n));
  assert.equal(loadConfig({}, []).premise, null);
  assert.equal(loadConfig({ PREMISE: '0' }, []).premise, 0, 'PREMISE=0 不要求第二纪');
  for (const bad of ['3', '-1', '1.5']) assert.throws(() => loadConfig({ PHYSICS: '2', PREMISE: bad }, []), /PREMISE 只能是 0、1 或 2/);
  assert.throws(() => loadConfig({ PREMISE: '2' }, []), /PREMISE=1 或 2 只用于第二纪（PHYSICS=2）/);
  assert.throws(() => loadConfig({ PREMISE: '1' }, []), /PREMISE=1 或 2 只用于第二纪（PHYSICS=2）/);
  assert.throws(() => loadConfig({ PREMISE: '2', PHYSICS: '1' }, []), /只用于第二纪/);
});

test('P2 T1: createWorld 的 premise 校验；先民不能多于躯壳（1 与 2 同样）', () => {
  for (const premise of [0, 1, 2]) assert.doesNotThrow(() => e2.createWorld({ seed: 'v', premise }));
  for (const bad of [3, -1, 1.5, '2', null, true]) assert.throws(() => e2.createWorld({ seed: 'v', premise: bad }), /PREMISE 只能是 0、1 或 2/, String(bad));
  const founders = [0, 1, 2].map((i) => ({ day: 0, name: `先民${i}`, soul: `灵魂${i}`, lang: 'zh' }));
  for (const premise of [1, 2]) {
    assert.throws(() => e2.createWorld({ seed: 'f', premise, shellSlots: 2, founders }), /先民不能多于躯壳/);
    assert.doesNotThrow(() => e2.createWorld({ seed: 'f', premise, shellSlots: 3, founders }));
  }
  assert.doesNotThrow(() => e2.createWorld({ seed: 'f', premise: 0, shellSlots: 2, founders }), '设定版本 0 没有这条限制');
});

test('P2 T1: 世界的形状——premise 2 有 w.premise、genesis.premise、dayLog.p2 与设定 1 的一切；居民有 standing: [] 与 muted: []；premise 0、1 没有', () => {
  const w0 = e2.createWorld({ seed: 's' });
  const w1 = e2.createWorld({ seed: 's', premise: 1, shellSlots: 8 });
  const w2 = e2.createWorld({ seed: 's', premise: 2, shellSlots: 8 });
  assert.deepEqual([premised(w0), premised(w1), premised(w2)], [false, true, true]);
  assert.deepEqual([agentic(w0), agentic(w1), agentic(w2)], [false, false, true]);
  assert.equal(Object.hasOwn(w0, 'premise'), false);
  assert.equal(w1.premise, 1);
  assert.equal(w2.premise, 2);
  assert.equal(w2.genesis.premise, 2);
  assert.equal(w1.genesis.premise, 1);
  // 设定 1 的一切
  for (const w of [w1, w2]) {
    assert.deepEqual(w.backstage, { code: null, bodies: null, budget: null });
    assert.equal(w.shells.bodies.length, 8);
    assert.ok(Object.hasOwn(w.dayLog, 'p1'));
  }
  // dayLog.p2 只在第二前提
  assert.equal(Object.hasOwn(w0.dayLog, 'p2'), false);
  assert.equal(Object.hasOwn(w1.dayLog, 'p2'), false);
  assert.deepEqual(Object.keys(w2.dayLog.p2), P2_DAYLOG_KEYS);
  assert.ok(Object.values(w2.dayLog.p2).every((v) => v === 0));
  // newDayLog 的签名
  assert.equal(Object.hasOwn(newDayLog(), 'p1'), false);
  assert.equal(Object.hasOwn(newDayLog(true), 'p2'), false);
  assert.deepEqual(Object.keys(newDayLog(true, true).p2), P2_DAYLOG_KEYS);
  // 居民
  for (const [w, has] of [[w0, false], [w1, false], [w2, true]]) {
    const a = reg(w, '甲');
    assert.equal(Object.hasOwn(a, 'standing'), has);
    assert.equal(Object.hasOwn(a, 'muted'), has);
    if (has) { assert.deepEqual(a.standing, []); assert.deepEqual(a.muted, []); }
  }
});

test('P2 T1: dayLog.p2 每日重置，仍在第二前提；设定 1 的世界日终后仍没有 p2', () => {
  const w = e2.createWorld({ seed: 'd', premise: 2, shellSlots: 4 });
  reg(w, '甲');
  w.dayLog.p2.standingSets = 7;
  tickDays(w, 1);
  assert.deepEqual(Object.keys(w.dayLog.p2), P2_DAYLOG_KEYS);
  assert.equal(w.dayLog.p2.standingSets, 0);
  const w1 = e2.createWorld({ seed: 'd', premise: 1, shellSlots: 4 });
  reg(w1, '甲');
  tickDays(w1, 1);
  assert.equal(Object.hasOwn(w1.dayLog, 'p2'), false);
  assert.ok(Object.hasOwn(w1.dayLog, 'p1'));
});

test('P2 T1: 感知与公开状态里的 premise——醒着、沉睡、长眠、归隐都带；设定 1 仍是 1，设定 0 没有', () => {
  for (const premise of [0, 1, 2]) {
    const w = e2.createWorld({ seed: 'p', premise, shellSlots: 4 });
    const a = reg(w, '甲');
    for (const status of ['awake', 'dormant', 'dead', 'retired']) {
      a.status = status;
      const p = e2.buildPerception(w, a.id, { ack: false });
      if (premise === 0) assert.equal(Object.hasOwn(p, 'premise'), false, `${premise}/${status}`);
      else assert.equal(p.premise, premise, `${premise}/${status}`);
    }
    const pub = e2.publicState(w).world;
    if (premise === 0) assert.equal(Object.hasOwn(pub, 'premise'), false);
    else assert.equal(pub.premise, premise);
  }
});

test('P2 T1: genesisOpts 往返——由快照还原的创建参数重建出同样的世界（premise 2 含先民与躯壳模型）', () => {
  const founders = [{ day: 0, name: '先民甲', soul: '灵魂甲', lang: 'zh' }, { day: 0, name: 'Elder B', soul: 'soul b', lang: 'en' }];
  const w = e2.createWorld({ id: 'g2', seed: 'g2', premise: 2, shellSlots: 6, shellModels: ['m-a', 'm-b'], founders });
  assert.equal(genesisOpts(w).premise, 2);
  assert.deepEqual(w, e2.createWorld(genesisOpts(w)));
  assert.equal(stateHash(w), stateHash(e2.createWorld(genesisOpts(JSON.parse(JSON.stringify(w))))));
});

test('P2 T1: 同种子、同命令得到同样的哈希；第二前提的世界在没有任何第二前提的动作时，运转与设定 1 一致（只多出新字段）', () => {
  const run = (premise) => {
    const w = e2.createWorld({ seed: 'same', premise, shellSlots: 6 });
    const ids = ['甲', '乙', '丙'].map((n) => reg(w, n).id);
    for (let i = 0; i < 120; i++) {
      e2.applyCommand(w, { type: 'tick' });
      if (i % 5 === 0) e2.applyCommand(w, { type: 'act', payload: { agentId: ids[i % 3], actions: [{ type: 'say', text: `第 ${i} 刻` }, { type: 'move', to: i % 2 ? 'market' : 'port' }] } });
    }
    assertInvariants(w);
    return w;
  };
  assert.equal(stateHash(run(2)), stateHash(run(2)));
  // 设定 1 与 2 的差别只在新增的字段：把 premise 2 世界里新增的字段拿掉，其余与设定 1 的世界相同
  const w1 = run(1);
  const w2 = JSON.parse(JSON.stringify(run(2)));
  w2.premise = 1;
  w2.genesis.premise = 1;
  delete w2.dayLog.p2;
  for (const a of Object.values(w2.agents)) { delete a.standing; delete a.muted; }
  assert.equal(stateHash(w2), stateHash(w1));
});
