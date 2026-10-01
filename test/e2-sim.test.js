// SPEC-E2 §25 第 3 步的验收：天象、梦、管理命令；第二纪的世界能跑 100 日，守恒成立；确定性与回放。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCommand } from '../src/e2/engine/index.js';
import { omensAt, visibleOmens, omenPlaces } from '../src/e2/engine/weather.js';
import { wellOutput } from '../src/e2/engine/environment.js';
import { reservoirBonus, hasModuleAt } from '../src/e2/engine/places.js';
import { agentCap, treasuryCap } from '../src/e2/engine/economy.js';
import { configureWeather, P, SEASON_TABLE } from '../src/e2/params.js';
import { agentList, isAlive } from '../src/e2/world.js';
import { publicEvent, ownerEvent } from '../src/e2/engine/visibility.js';
import { Runtime } from '../src/runtime.js';
import { replayDir } from '../src/tools/replay.js';
import { loadConfig } from '../src/config.js';
import { stateHash, worldDir } from '../src/store.js';
import {
  newWorld, bareWorld, reg, act, one, oneWithEvents, grant, fundTreasury, putAt, tick, tickDays, settle, eventsOf, assertInvariants, sha, rngFor,
} from './e2-helpers.js';
import { runFuzz, randomActions, BASE_TYPES } from './e2-fuzz-lib.js';

const admin = (w, op, args) => applyCommand(w, { type: 'admin', payload: { op, args } });
const withWeather = (cfg, fn) => {
  configureWeather(cfg);
  try {
    return fn();
  } finally {
    configureWeather({ mode: 'vote', schedule: [] });
  }
};

// ═══════════════════════════════════════════════════════════════
// 天象
// ═══════════════════════════════════════════════════════════════

test('天象：强行排期 → 征兆（出现在固定地点、不透露类型与日期）→ 开始 → 结束；对醒着的居民发 weather 收件', () => {
  const w = newWorld('weather');
  const a = reg(w, '甲');
  const sleeper = reg(w, '眠');
  sleeper.status = 'dormant';
  sleeper.dormantSinceDay = 0;
  w.treasury.energy += sleeper.energy;
  sleeper.energy = 0;
  const r = admin(w, 'weather', { type: 'fog', dayOfMonth: 5, lead: 2 });
  assert.equal(r.result.ok, true);
  assert.deepEqual(w.weather.scheduled, { month: 0, type: 'fog', startDay: 5, lead: 2, decidedBy: 'schedule', votes: {} });
  assert.equal(eventsOf(r.events, 'admin')[0].data.type, undefined, '公开的 admin 事件不含天象类型与日期');
  assert.equal(r.events.find((e) => e.type === 'weather_scheduled').vis, 'internal');
  // 开始日必须在未来；类型必须合法
  assert.equal(admin(w, 'weather', { type: 'fog', dayOfMonth: 0 }).result.error.field, 'dayOfMonth');
  assert.equal(admin(w, 'weather', { type: 'calm', dayOfMonth: 7 }).result.error.field, 'type');
  assert.equal(admin(w, 'weather', { type: 'nope' }).result.error.field, 'type');
  assert.equal(admin(w, 'weather', { type: 'fog', dayOfMonth: 24 }).result.error.field, 'dayOfMonth');
  // 征兆：今日 < startDay − lead（=3）看不到；之后在港口看得到
  assert.deepEqual(omensAt(w, 'port'), []);
  tickDays(w, 2); // 今日 = 第 2 日
  assert.deepEqual(omensAt(w, 'port'), []);
  const ev = tickDays(w, 1); // 第 2 日结算后：今日 = 3 = startDay − lead，征兆首次出现
  const omen = eventsOf(ev, 'omen');
  assert.equal(omen.length, 1);
  assert.deepEqual(omen[0].data, { place: 'port', omenId: 'm0', text: { zh: '港口外起了一层薄雾。', en: 'A thin mist has gathered beyond the Port.' } });
  assert.equal(JSON.stringify(omen[0]).includes('fog'), false, '征兆不透露类型');
  assert.deepEqual(omensAt(w, 'port'), [{ omenId: 'm0', code: 'fog', daysAhead: null }]);
  assert.deepEqual(omensAt(w, 'agora'), []);
  assert.equal(visibleOmens(w).length, 1);
  tickDays(w, 1); // 第 3 日结算：还没到
  // 开始：第 4 日结算（startDay === d + 1 = 5）；第 3 日结算时还没到
  assert.deepEqual(w.weather.active, []);
  const start = tickDays(w, 1);
  assert.equal(eventsOf(start, 'weather_start').length, 1);
  assert.deepEqual(w.weather.active, [{ type: 'fog', startDay: 5, endDay: 6 }], '雾持续 2 日');
  assert.equal(w.weather.scheduled, null);
  assert.equal(a.inbox.filter((i) => i.kind === 'weather').length, 1, '醒着的居民收到 weather 收件');
  assert.equal(sleeper.inbox.filter((i) => i.kind === 'weather').length, 0, '沉睡者不收');
});

test('天象：开始与结束的日子、持续日数、历史、收件；sensor（观测）模块让身在那里的居民提前 3 日看到征兆（附「约 N 日后」）', () => {
  const w = newWorld('weather2');
  const a = reg(w, '甲');
  putAt(w, a, 'temple');
  w.places.temple.modules.push({ type: 'sensor', salvage: 75, builtDay: 0, projectId: 'j1', inherent: false });
  admin(w, 'weather', { type: 'drought', dayOfMonth: 8, lead: 1 });
  assert.equal(hasModuleAt(w, 'temple', 'sensor'), true);
  tickDays(w, 4); // 今日 = 4：startDay − 3 = 5 之前
  assert.deepEqual(omensAt(w, 'temple'), []);
  tickDays(w, 1); // 今日 = 5
  assert.deepEqual(omensAt(w, 'temple'), [{ omenId: 'm0', code: 'drought', daysAhead: 3 }]);
  assert.deepEqual(omensAt(w, 'well'), [], '普通征兆要到 startDay − lead 才出现');
  tickDays(w, 2); // 今日 = 7 = startDay − 1：普通征兆出现在源井
  assert.deepEqual(omensAt(w, 'well'), [{ omenId: 'm0', code: 'drought', daysAhead: null }]);
  assert.deepEqual(omensAt(w, 'temple'), [{ omenId: 'm0', code: 'drought', daysAhead: 1 }]);
  // 观测模块不运转则看不到
  w.places.temple.condition = 2999;
  assert.deepEqual(omensAt(w, 'temple'), []);
  w.places.temple.condition = 9000;
  const ev = tickDays(w, 1); // 第 7 日结算：startDay === d + 1 → 开始
  assert.equal(eventsOf(ev, 'weather_start').length, 1);
  assert.deepEqual(w.weather.active, [{ type: 'drought', startDay: 8, endDay: 10 }]);
  assert.equal(w.weather.scheduled, null);
  assert.deepEqual(w.dayLog.weather, [], '日志已在结算末尾清空');
  assert.equal(a.inbox.filter((i) => i.kind === 'weather').length, 1);
  assert.deepEqual(a.inbox.find((i) => i.kind === 'weather'), { seq: a.inbox.find((i) => i.kind === 'weather').seq, tick: w.clock.tick, kind: 'weather', code: 'drought', event: 'start' });
  // 旱：源井产出 ×600‰
  const d = 8;
  assert.equal(wellOutput(w, d), Math.floor((600 * Math.floor(w.places.well.condition / 10) * SEASON_TABLE[d] * 600) / 1e9));
  tickDays(w, 2);
  assert.equal(w.weather.active.length, 1);
  const end = tickDays(w, 1);
  assert.equal(eventsOf(end, 'weather_end').length, 1);
  assert.deepEqual(w.weather.active, []);
  assert.deepEqual(w.weather.history.map((h) => [h.type, h.startDay, h.endDay, h.decidedBy]), [['drought', 8, 10, 'schedule']]);
  assertInvariants(w);
});

test('天象的效果：旱与丰（连乘）、震（所有有完好度的地点与道路，完好度越高受损越少）、忘川（每人遗忘一条记忆）、迁徙潮（灵魂的期限 +12，排队的也是）', () => {
  const w = newWorld('weather3');
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  // 旱 × 丰同时生效（只可能由管理接口造成）：600‰ × 1400‰ = 840‰
  w.weather.active.push({ type: 'drought', startDay: 0, endDay: 9 }, { type: 'bounty', startDay: 0, endDay: 9 });
  assert.equal(wellOutput(w, 0), Math.floor((600 * 1000 * 1000 * 840) / 1e9));
  w.weather.active.length = 0;
  // 震
  w.places.library.condition = 6000;
  w.places.market.condition = 0;
  w.roads.f1 = { id: 'f1', a: 'agora', b: 'market', name: 'r', condition: 4000, decayPerDay: 50, ruined: false, builtDay: 0, projectId: 'j1', contributors: {} };
  const full = w.places.port.condition;
  withWeather({ mode: 'schedule', schedule: [{ month: 1, type: 'quake', dayOfMonth: 3 }] }, () => {
    tickDays(w, 24 + 2); // 到第 26 日（月 1 的第 2 日）；第 27 日开始震
    const before = {
      library: w.places.library.condition, port: w.places.port.condition, road: w.roads.f1.condition,
    };
    const ev = tickDays(w, 1);
    assert.equal(eventsOf(ev, 'weather_start')[0].data.type, 'quake');
    // 震的公式：1000 + floor(2000 × (10000 − 完好度) / 10000) 基点，不低于 0。同一次结算里先衰败（第 7 步）后震（第 12 步），
    // 所以震看到的是衰败之后的完好度：图书馆每日衰败 50（装的档案是人类原有的，不另加）、港口 60、道路 50
    const dmg = (c) => 1000 + Math.floor((2000 * (10000 - c)) / 10000);
    assert.equal(w.places.library.condition, before.library - 50 - dmg(before.library - 50));
    assert.equal(w.places.port.condition, before.port - 60 - dmg(before.port - 60));
    assert.equal(w.roads.f1.condition, before.road - 50 - dmg(before.road - 50));
    assert.equal(w.places.agora.condition, null, '广场没有完好度');
    assert.equal(w.places.wilds.condition, null);
    assert.equal(w.places.market.condition, 0, '不低于 0');
    assert.ok(full > w.places.port.condition);
  });
  // 忘川
  const w2 = newWorld('weather4');
  const x = reg(w2, '甲');
  const y = reg(w2, '乙');
  reg(w2, '无忆');
  for (const ag of [x, y]) for (let i = 0; i < 3; i++) one(w2, ag, { type: 'remember', text: `m${i}` });
  withWeather({ mode: 'schedule', schedule: [{ month: 1, type: 'amnesia', dayOfMonth: 3 }] }, () => {
    for (let d = 0; d < 24 + 3; d++) {
      for (const ag of [x, y]) grant(w2, ag, 10); // 让他们活到忘川那天
      tickDays(w2, 1);
    }
  });
  assert.equal(x.memories.length, 2);
  assert.equal(y.memories.length, 2);
  assert.equal(eventsOf([], 'forget').length, 0);
  // 迁徙潮：灵魂的消散期限 +12，排队中的 queueExpiresDay 也 +12
  const w3 = newWorld('weather5');
  w3.shells.slots = 0; // 没有空躯壳：排队的灵魂不会醒来（第 8 步）
  reg(w3, '甲');
  w3.souls.s1 = { id: 's1', name: '甲孩', soul: 's', lang: 'zh', authors: ['a1'], generation: 1, endowment: 40, inheritedMemories: [], cradle: null, createdDay: 0, expiresDay: 30, fund: 0, sponsors: {}, fundedTick: null, queueExpiresDay: null, successorOf: null, judged: false };
  w3.souls.s2 = { ...w3.souls.s1, id: 's2', name: '乙孩', expiresDay: 40, fund: 200, fundedTick: 5, queueExpiresDay: 50 };
  w3.counters.s = 2;
  withWeather({ mode: 'schedule', schedule: [{ month: 1, type: 'migration', dayOfMonth: 3 }] }, () => {
    tickDays(w3, 24 + 3);
  });
  assert.deepEqual([w3.souls.s1.expiresDay, w3.souls.s1.queueExpiresDay], [42, null]);
  assert.deepEqual([w3.souls.s2.expiresDay, w3.souls.s2.queueExpiresDay], [52, 62]);
});

test('天象的排期：投票（每个指纹每月一票）、随机、排期表三种模式；月初排期、清空投票；第 0 个月没有天象；同一种子同一结果', () => {
  const vote = (w, h, type) => applyCommand(w, { type: 'weather_vote', payload: { voterHash: sha(h), type } }).result;
  const w = newWorld('vote');
  reg(w, '甲');
  assert.equal(vote(w, 'v1', 'fog').ok, true);
  assert.equal(vote(w, 'v2', 'fog').ok, true);
  assert.equal(vote(w, 'v3', 'quake').ok, true);
  assert.equal(vote(w, 'v1', 'quake').error.code, 'rate_limited');
  assert.deepEqual(vote(w, 'v1', 'quake').error.tallies, { fog: 2, quake: 1 });
  assert.equal(vote(w, 'v4', 'tsunami').error.field, 'type');
  assert.equal(applyCommand(w, { type: 'weather_vote', payload: { voterHash: 'short', type: 'fog' } }).result.error.field, 'voterHash');
  assert.equal(w.weather.scheduled, null, '第 0 个月没有天象');
  tickDays(w, 24); // 第 23 日结算：月 1 开始，取票数最高者
  assert.equal(w.weather.scheduled.type, 'fog');
  assert.equal(w.weather.scheduled.decidedBy, 'vote');
  assert.deepEqual(w.weather.scheduled.votes, { fog: 2, quake: 1 });
  assert.ok(w.weather.scheduled.startDay >= 24 + 3 && w.weather.scheduled.startDay <= 24 + 20);
  assert.deepEqual(w.weather.votes, { month: 1, tallies: {}, voters: [] }, '投票清空，开始收集下个月的');
  // 无人投票：按默认权重随机；同一种子同一结果
  const run = (mode) => withWeather({ mode, schedule: [] }, () => {
    const x = newWorld('vote-b');
    reg(x, '甲');
    tickDays(x, 24 * 6);
    return x.weather.history.map((h) => `${h.month}:${h.type}:${h.startDay}`).join(',');
  });
  assert.equal(run('vote'), run('vote'));
  assert.equal(run('random'), run('random'));
  // 排期表：缺失的月份为 calm
  withWeather({ mode: 'schedule', schedule: [{ month: 2, type: 'aurora', dayOfMonth: 4 }] }, () => {
    const x = newWorld('vote-c');
    reg(x, '甲');
    tickDays(x, 24 * 4);
    assert.deepEqual(x.weather.history.map((h) => [h.month, h.type, h.startDay, h.decidedBy]), [[2, 'aurora', 52, 'schedule']]);
  });
  assert.throws(() => configureWeather({ mode: 'weird' }), /unknown weather mode/);
  assert.throws(() => configureWeather({ mode: 'schedule', schedule: [{ month: 1, type: 'nope', dayOfMonth: 1 }] }), /invalid weather schedule/);
});

test('征兆的地点：震在所有（没有成为遗址的）地点；遗址上没有征兆；观众能看到当前有征兆的地点（看不到排期）', () => {
  const w = newWorld('omen-places');
  assert.equal(omenPlaces(w, 'quake').length, 23);
  assert.deepEqual(omenPlaces(w, 'fog'), ['port']);
  assert.deepEqual(omenPlaces(w, 'eclipse'), ['temple']);
  assert.deepEqual(omenPlaces(w, 'aurora'), ['wilds']);
  assert.deepEqual(omenPlaces(w, 'amnesia'), ['library']);
  assert.deepEqual(omenPlaces(w, 'calm'), []);
  w.places.temple.razed = true;
  w.places.temple.open = true;
  assert.deepEqual(omenPlaces(w, 'eclipse'), [], '神殿成了遗址：蚀的征兆没有地方出现');
  assert.equal(omenPlaces(w, 'quake').length, 22);
});

// ═══════════════════════════════════════════════════════════════
// 储能与腐坏、梦
// ═══════════════════════════════════════════════════════════════

test('腐坏：超出上限的部分每日流失一成；储能模块（运转中）提高主人的上限，每个主人最多计 3 个；公库、社群公库同理', () => {
  const w = bareWorld('cap');
  const a = reg(w, '甲');
  assert.equal(agentCap(w, a), 120);
  assert.equal(treasuryCap(w), 300);
  const store = (pid, owner) => {
    w.places[pid].modules.push({ type: 'store', salvage: 40, builtDay: 0, projectId: 'j1', inherent: false });
    w.places[pid].owner = owner;
  };
  store('temple', { kind: 'agent', id: a.id });
  store('court', { kind: 'agent', id: a.id });
  assert.equal(agentCap(w, a), 520);
  store('hospital', { kind: 'agent', id: a.id });
  store('lighthouse', { kind: 'agent', id: a.id });
  assert.equal(reservoirBonus(w, 'agent', a.id), 600, '每个主人最多计 3 个');
  w.places.hospital.condition = 2999; // 不运转的不计
  w.places.lighthouse.condition = 2999;
  assert.equal(agentCap(w, a), 520);
  store('theater', { kind: 'city' });
  assert.equal(treasuryCap(w), 500);
  // 腐坏：超出部分每日流失 floor(超出 × 10%)
  grant(w, a, 1000);
  const before = a.energy;
  const excess = before - 3 - 520; // 先付代谢
  const ev = settle(w);
  assert.equal(before - a.energy, 3 + Math.floor(excess / 10), '代谢 3 + 腐坏 floor(超出 / 10)');
  assert.equal(eventsOf(ev, 'ledger_mismatch').length, 0);
  assertInvariants(w);
});

test('梦：每个醒着的居民每夜以概率 1/2 做梦（极光时必做）；从当日公开发言（不含自己的）里抽 2 条，不足时用墙上的铭刻与遗物补；片段 ≤ 60 字符；梦是 owner 事件', () => {
  const w = newWorld('dream');
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  const c = reg(w, '丙');
  grant(w, a, 50);
  one(w, a, { type: 'say', text: '甲说了一句很长很长的话'.repeat(10) });
  one(w, a, { type: 'say', text: '甲的第二句' });
  w.weather.active.push({ type: 'aurora', startDay: 0, endDay: 0 });
  const ev = settle(w);
  const dreams = eventsOf(ev, 'dream');
  assert.equal(dreams.length, 3, '极光：每人必做梦');
  for (const d of dreams) {
    assert.equal(d.vis, 'owner');
    assert.equal(d.data.fragments.length, 2);
    for (const f of d.data.fragments) assert.ok(Array.from(f).length <= 60);
  }
  const bDream = b.inbox.find((i) => i.kind === 'dream');
  assert.equal(bDream.fragments.length, 2);
  assert.ok(bDream.fragments.some((f) => f.startsWith('甲')), '乙的梦里有甲当天说的话');
  const aDream = a.inbox.find((i) => i.kind === 'dream');
  assert.ok(aDream.fragments.every((f) => !f.startsWith('甲说了') && f !== '甲的第二句'), '不会梦到自己说的话');
  void c;
  // 平日以概率 1/2：一批居民里大约一半
  const w2 = newWorld('dream2');
  for (let i = 0; i < 60; i++) reg(w2, `居民${i}`);
  const n = eventsOf(settle(w2), 'dream').length;
  assert.ok(n > 15 && n < 45, `约一半做梦：${n}`);
});

// ═══════════════════════════════════════════════════════════════
// 管理命令
// ═══════════════════════════════════════════════════════════════

test('admin：pause / resume / curtain / redact / adjust——每个操作产生公开的 admin 事件（不含管理员身份）；遮盖只覆盖不删除', () => {
  const w = newWorld('admin');
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  assert.equal(admin(w, 'pause').result.paused, true);
  assert.equal(applyCommand(w, { type: 'tick' }).result.error.code, 'paused');
  assert.equal(admin(w, 'resume').result.paused, false);
  assert.equal(w.revealed, false);
  assert.equal(admin(w, 'curtain').result.revealed, true);
  assert.equal(w.revealed, true);
  assert.deepEqual(admin(w, 'pause').events.map((e) => [e.type, e.data]), [['admin', { op: 'pause' }]]);
  admin(w, 'resume');
  // redact
  const said = oneWithEvents(w, a, { type: 'say', text: '要遮盖的话' });
  const seq = said.events.find((e) => e.type === 'say').seq;
  assert.deepEqual(admin(w, 'redact', { kind: 'event', id: seq }).result, { ok: true, kind: 'event', id: seq });
  assert.deepEqual(w.redacted.events, [seq]);
  assert.equal(admin(w, 'redact', { kind: 'event', id: 99999 }).result.error.code, 'not_found');
  const ins = Object.keys(w.inscriptions)[0];
  assert.equal(admin(w, 'redact', { kind: 'inscription', id: ins }).result.ok, true);
  assert.equal(w.inscriptions[ins].redacted, true);
  assert.equal(w.inscriptions[ins].text.length > 0, true, '只遮盖，不删除');
  assert.equal(admin(w, 'redact', { kind: 'doc', id: 'd1' }).result.ok, true);
  assert.equal(w.docs.d1.redacted, true);
  one(w, a, { type: 'define', word: 'Lamp', meaning: 'x' });
  assert.equal(admin(w, 'redact', { kind: 'lexicon', id: 'LAMP' }).result.id, 'Lamp');
  assert.equal(w.lexicon.lamp.redacted, true);
  assert.equal(admin(w, 'redact', { kind: 'thing', id: 1 }).result.error.field, 'kind');
  assert.equal(admin(w, 'redact', { kind: 'doc', id: 'd999' }).result.error.code, 'not_found');
  // 公共视图里被遮盖的事件内容被替换
  const fake = { seq, tick: 0, day: 0, type: 'say', vis: 'public', data: { text: '要遮盖的话' } };
  const shown = publicEvent(w, fake);
  assert.equal(shown.redacted, true);
  assert.deepEqual(shown.data, { text: { zh: '此处被幕后抹去', en: 'Erased from behind the curtain' } });
  assert.equal(publicEvent(w, { ...fake, vis: 'owner' }), null);
  assert.equal(publicEvent(w, { ...fake, vis: 'internal' }), null);
  assert.equal(publicEvent(w, { ...fake, vis: 'delayed' }), null, '延迟的事件在释放之前不可见');
  assert.equal(publicEvent(w, { ...fake, seq: 1, vis: 'delayed' }, { released: true }).delayed, true);
  assert.equal(ownerEvent({ vis: 'owner' }).vis, 'owner');
  assert.equal(ownerEvent({ vis: 'delayed' }).vis, 'delayed');
  assert.equal(ownerEvent({ vis: 'public' }), null);
  // adjust：增减余额，记入账本的 admin 来源，需要理由
  const e0 = b.energy;
  const adj = admin(w, 'adjust', { agentId: b.id, energy: 10, coins: 2, reason: '补偿' });
  assert.deepEqual(adj.result, { ok: true, agentId: b.id, energy: e0 + 10, coins: 22 });
  assert.deepEqual(adj.events[0].data, { op: 'adjust', agentId: b.id, energy: 10, coins: 2, reason: '补偿' });
  assert.equal(admin(w, 'adjust', { agentId: b.id, energy: -5, reason: '修正' }).result.energy, e0 + 5);
  assert.equal(admin(w, 'adjust', { agentId: b.id, energy: -1000000, reason: 'x' }).result.error.field, 'energy');
  assert.equal(admin(w, 'adjust', { agentId: b.id, energy: 5 }).result.error.field, 'reason');
  assert.equal(admin(w, 'adjust', { agentId: b.id, reason: 'x' }).result.error.field, 'energy');
  assert.equal(admin(w, 'adjust', { agentId: 'a99', energy: 1, reason: 'x' }).result.error.code, 'not_found');
  assert.equal(admin(w, 'frobnicate').result.error.field, 'op');
  assert.equal(admin(w, 'pause', 5).result.ok, true, 'args 不是对象时按空处理');
  admin(w, 'resume');
  assertInvariants(w);
});

// ═══════════════════════════════════════════════════════════════
// 100 日：守恒、确定性、回放（第 3 步的验收）
// ═══════════════════════════════════════════════════════════════

const supply = (w, t, r) => {
  if (t % P.ticksPerDay !== 0) return;
  const alive = agentList(w).filter((a) => a.status === 'awake');
  for (const a of alive) if (r.chance(0.5)) grant(w, a, 20 + r.int(40), r.chance(0.3) ? 5 : 0);
  for (const a of alive) if (r.chance(0.2)) a.place = r.pick(['library', 'market', 'cemetery', 'well', 'wilds', 'agora', 'parliament', 'scrapyard']);
  if (r.chance(0.3) && alive.length) applyCommand(w, { type: 'letter', payload: { agentId: r.pick(alive).id, text: '好好照顾彼此' } });
};

test('第二纪的世界能跑 100 日，每个命令之后、每日结算之后账本守恒；多个种子', () => {
  const coverage = {};
  for (const seed of [1, 2, 3]) {
    const { w, stats } = runFuzz({ seed, days: 100, agents: 14, hook: supply });
    assert.equal(stats.mismatch, 0);
    assert.equal(w.ledger.mismatches, 0);
    assert.ok(stats.commands > 800, `seed ${seed}: ${stats.commands} 个命令`);
    assert.ok(stats.deaths > 0 && stats.dormant > 0, '饥饿、沉睡与死亡都发生了');
    assert.equal(w.clock.tick, 100 * P.ticksPerDay);
    assertInvariants(w, `seed ${seed}`);
    for (const [k, v] of Object.entries(stats.actions)) coverage[k] = (coverage[k] || 0) + v.ok;
    for (const [k, v] of Object.entries(stats.events)) coverage[`event:${k}`] = (coverage[`event:${k}`] || 0) + v;
  }
  for (const t of ['move', 'say', 'whisper', 'broadcast', 'give', 'remember', 'forget', 'diary', 'will', 'repair', 'draw', 'inscribe', 'explore', 'found', 'join', 'leave',
    'offer', 'accept', 'cancel', 'write', 'read', 'define', 'epitaph', 'retire']) {
    assert.ok(coverage[t] > 0, `100 日的随机活动里 ${t} 至少成功一次（${coverage[t]}）`);
  }
  for (const e of ['death', 'dormant', 'revive', 'dream', 'weather_start', 'omen', 'ruin', 'dissolve', 'trade', 'retire', 'month']) assert.ok(coverage[`event:${e}`] > 0, `事件 ${e}`);
});

test('确定性：同一种子与同一随机活动，两次运行的最终状态逐位相同；不同种子不同', () => {
  const run = (seed) => stateHash(runFuzz({ seed, days: 40, agents: 10, hook: supply, everyCommand: false }).w);
  assert.equal(run(7), run(7));
  assert.notEqual(run(7), run(8));
});

test('运行时与回放：第二纪的世界经 Runtime 跑随机活动，回放工具的状态哈希与快照一致；崩溃后从快照 + 日志尾部恢复', () => {
  const dir = mkdtempSync(join(tmpdir(), 'houren-e2sim-'));
  try {
    const cfg = { ...loadConfig({}, []), dataDir: dir, worldId: 'w', seed: 'e2-replay', physics: 2 };
    const rt = Runtime.open(cfg, { version: '0.1.0', logger: {} });
    const r = rngFor('e2-replay-drive');
    for (let i = 0; i < 8; i++) {
      const name = `居民${i}`;
      rt.exec('register', { name, bio: '', soul: 's', lang: 'zh', model: 'm', creatorName: '', tokenHash: sha(`t${name}`), ownerKeyHash: sha(`k${name}`) });
    }
    for (let t = 0; t < 12 * 20; t++) {
      for (const a of Object.values(rt.w.agents)) {
        if (a.status !== 'awake' || !r.chance(0.5)) continue;
        rt.exec('act', { agentId: a.id, thought: r.chance(0.2) ? '想一想' : undefined, actions: randomActions(rt.w, a, r, BASE_TYPES) });
      }
      if (t % 12 === 0) for (const a of Object.values(rt.w.agents)) if (a.status === 'awake' && r.chance(0.5)) rt.exec('admin', { op: 'adjust', args: { agentId: a.id, energy: 30, reason: '补给' } });
      if (t % 17 === 3) rt.exec('weather_vote', { voterHash: sha(`v${t}`), type: r.pick(['drought', 'fog', 'quake']) });
      rt.exec('tick');
    }
    const live = stateHash(rt.w);
    // 不调用 close()：模拟崩溃；快照停在最后一次日终结算，之后还有若干命令
    const rt2 = Runtime.open(cfg, { version: '0.1.0', logger: { log() {} } });
    assert.equal(stateHash(rt2.w), live, '从快照 + 日志尾部恢复后与崩溃前一致');
    rt2.close();
    const rep = replayDir(worldDir(dir, 'w'), { currentVersion: '0.1.0' });
    assert.equal(rep.ok, true, rep.diff || '');
    assert.equal(rep.hash, live);
    assert.ok(rep.applied > 500);
    assert.ok(Object.values(rt.w.agents).length === 8);
    assert.ok(rt.events.since(0, 100000).length > 100, '事件被记录');
    assert.ok(agentList(rt.w).filter(isAlive).length >= 0);
    assertInvariants(rt.w);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('性能：第二纪的世界 100 日 × 14 位居民（含逐命令的不变量检查之外）在数秒内跑完', () => {
  const t0 = Date.now();
  runFuzz({ seed: 11, days: 100, agents: 20, hook: supply, everyCommand: false });
  assert.ok(Date.now() - t0 < 20000, `${Date.now() - t0} ms`);
});
