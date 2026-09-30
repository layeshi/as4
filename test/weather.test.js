import test from 'node:test';
import assert from 'node:assert/strict';
import { P, WEATHER_DEFS, WEATHER_CODES, WEATHER, configureWeather } from '../src/params.js';
import { applyCommand } from '../src/engine/index.js';
import { scheduleMonth, stepWeather, forceWeather, omensAt, visibleOmens } from '../src/engine/weather.js';
import { newWorld, reg, sha, one, tick, tickDays, settle, grant, eventsOf, assertInvariants } from './helpers.js';

const vote = (w, who, type) => applyCommand(w, { type: 'weather_vote', payload: { voterHash: sha(`voter:${who}`), type } }).result;
const world = (seed = 'wx') => {
  const w = newWorld(seed);
  const a = reg(w, '甲');
  return { w, a };
};
const resetWeather = () => configureWeather({ mode: 'vote', schedule: [] });

// ── 投票 ───────────────────────────────────────────────────

test('weather_vote：每个投票者每月一票，不能改票；返回本月的计数', () => {
  const { w } = world();
  assert.deepEqual(vote(w, 'a', 'drought'), { ok: true, month: 0, tallies: { drought: 1 } });
  assert.deepEqual(vote(w, 'b', 'drought'), { ok: true, month: 0, tallies: { drought: 2 } });
  assert.deepEqual(vote(w, 'c', 'calm'), { ok: true, month: 0, tallies: { drought: 2, calm: 1 } });
  const again = vote(w, 'a', 'fog');
  assert.equal(again.ok, false);
  assert.equal(again.error.code, 'rate_limited');
  assert.deepEqual(w.weather.votes.tallies, { drought: 2, calm: 1 });
  assert.equal(vote(w, 'd', 'meteor').error.code, 'invalid_request');
  assert.equal(vote(w, 'd', undefined).error.code, 'invalid_request');
  assert.equal(applyCommand(w, { type: 'weather_vote', payload: { voterHash: 'nothex', type: 'fog' } }).result.error.code, 'invalid_request');
  assert.equal(w.weather.votes.voters.length, 3);
  // 所有九种类型都可以投（含 calm）
  for (const [i, t] of WEATHER_CODES.entries()) assert.equal(vote(w, `x${i}`, t).ok, true);
});

test('weather_vote：暂停时也可以投票（公共接口照常）', () => {
  const { w } = world();
  w.paused = true;
  assert.equal(vote(w, 'a', 'bounty').ok, true);
});

// ── 排期 ───────────────────────────────────────────────────

test('排期：第 0 个月没有天象；下个月的天象由本月票数最高者决定，随后清空投票', () => {
  resetWeather();
  const { w } = world();
  assert.equal(w.weather.scheduled, null);
  vote(w, 'a', 'drought');
  vote(w, 'b', 'drought');
  vote(w, 'c', 'fog');
  const ev = tickDays(w, P.daysPerMonth); // 到第 1 个月开始：第 23 日的结算里排期
  const s = w.weather.scheduled;
  assert.equal(s.type, 'drought');
  assert.equal(s.month, 1);
  assert.equal(s.decidedBy, 'vote');
  assert.deepEqual(s.votes, { drought: 2, fog: 1 });
  assert.ok(s.startDay >= 24 + 3 && s.startDay <= 24 + 20, `startDay ${s.startDay}`);
  assert.ok(s.lead === 1 || s.lead === 2);
  assert.deepEqual(w.weather.votes, { month: 1, tallies: {}, voters: [] });
  const sched = eventsOf(ev, 'weather_scheduled');
  assert.equal(sched.length, 1);
  assert.equal(sched[0].vis, 'internal'); // 排期对观众与 agent 都保密
  assert.equal(eventsOf(ev, 'month')[0].data.month, 1);
  // 新一轮投票可以开始
  assert.equal(vote(w, 'a', 'quake').ok, true);
});

test('排期：无人投票时按默认权重抽取；并列时在并列者中抽取；calm 则本月无天象', () => {
  resetWeather();
  const counts = {};
  const N = 600;
  for (let i = 0; i < N; i++) {
    const w = newWorld(`weights-${i}`);
    scheduleMonth(w, 1);
    const t = w.weather.scheduled ? w.weather.scheduled.type : 'calm';
    counts[t] = (counts[t] || 0) + 1;
    if (w.weather.scheduled) assert.equal(w.weather.scheduled.decidedBy, 'random');
  }
  for (const c of WEATHER_CODES) {
    const expected = WEATHER_DEFS[c].weight / 1000;
    assert.ok(Math.abs((counts[c] || 0) / N - expected) < 0.06, `${c}: ${(counts[c] || 0) / N} vs ${expected}`);
  }
  // 并列：只会在并列者里选
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const w = newWorld(`tie-${i}`);
    vote(w, 'a', 'fog');
    vote(w, 'b', 'aurora');
    vote(w, 'c', 'quake');
    vote(w, 'd', 'quake');
    vote(w, 'e', 'fog');
    scheduleMonth(w, 1);
    seen.add(w.weather.scheduled.type);
    assert.equal(w.weather.scheduled.decidedBy, 'vote');
  }
  assert.deepEqual([...seen].sort(), ['fog', 'quake']);
  // 票数最高的是 calm：无天象
  const w = newWorld('calm-win');
  vote(w, 'a', 'calm');
  vote(w, 'b', 'calm');
  vote(w, 'c', 'fog');
  scheduleMonth(w, 1);
  assert.equal(w.weather.scheduled, null);
  assert.deepEqual(w.weather.votes, { month: 1, tallies: {}, voters: [] });
});

test('排期：开始日在当月 [3, 20]，征兆提前量为 1 或 2；同一种子得到同一排期', () => {
  resetWeather();
  const doms = new Set();
  const leads = new Set();
  for (let i = 0; i < 300; i++) {
    const w = newWorld(`start-${i}`);
    vote(w, 'a', 'quake');
    scheduleMonth(w, 3);
    const s = w.weather.scheduled;
    const dom = s.startDay - 3 * P.daysPerMonth;
    assert.ok(dom >= 3 && dom <= 20);
    doms.add(dom);
    leads.add(s.lead);
  }
  assert.equal(doms.size, 18); // [3, 20] 都出现过
  assert.deepEqual([...leads].sort(), [1, 2]);
  const a = newWorld('same');
  const b = newWorld('same');
  vote(a, 'a', 'fog');
  vote(b, 'a', 'fog');
  scheduleMonth(a, 1);
  scheduleMonth(b, 1);
  assert.deepEqual(a.weather.scheduled, b.weather.scheduled);
});

test('排期模式 random 忽略投票；schedule 用文件里的月份、类型与日子，缺失的月份为 calm', () => {
  try {
    configureWeather({ mode: 'random' });
    const w = newWorld('rnd');
    for (let i = 0; i < 10; i++) vote(w, `v${i}`, 'eclipse');
    scheduleMonth(w, 1);
    if (w.weather.scheduled) assert.equal(w.weather.scheduled.decidedBy, 'random');
    configureWeather({ mode: 'schedule', schedule: [{ month: 2, type: 'quake', dayOfMonth: 9 }, { month: 3, type: 'calm', dayOfMonth: 5 }] });
    const w2 = newWorld('sched');
    scheduleMonth(w2, 1);
    assert.equal(w2.weather.scheduled, null); // 缺失 → calm
    scheduleMonth(w2, 2);
    assert.deepEqual([w2.weather.scheduled.type, w2.weather.scheduled.startDay, w2.weather.scheduled.decidedBy], ['quake', 2 * 24 + 9, 'schedule']);
    assert.ok([1, 2].includes(w2.weather.scheduled.lead));
    scheduleMonth(w2, 3);
    assert.equal(w2.weather.scheduled, null);
    assert.throws(() => configureWeather({ mode: 'schedule', schedule: [{ month: 1, type: 'nope', dayOfMonth: 3 }] }), /invalid weather schedule/);
    assert.throws(() => configureWeather({ mode: 'weird' }), /unknown weather mode/);
  } finally {
    resetWeather();
  }
});

// ── 开始与结束 ───────────────────────────────────────────────

/** 让世界推进到某一天天象的前夜，返回该世界 */
function toWeather(type, { seed = 'wx-run', setup } = {}) {
  resetWeather();
  const { w, a } = world(seed);
  if (setup) setup(w, a);
  vote(w, 'a', type);
  tickDays(w, P.daysPerMonth); // 排期
  return { w, a };
}

test('开始与结束：startDay == d + 1 的结算里加入 active 并记 weather_start；持续期满后结束并记 weather_end；历史里有 decidedBy 与票数', () => {
  const { w, a } = toWeather('drought');
  const s = { ...w.weather.scheduled };
  const dur = WEATHER_DEFS.drought.duration;
  const log = [];
  // 推进到开始日前一日的结算之前
  while (w.clock.tick < (s.startDay - 1) * P.ticksPerDay) tick(w);
  const before = eventsOf(settle(w), 'weather_start'); // 第 startDay − 1 日的结算
  assert.equal(before.length, 1);
  assert.deepEqual(before[0].data, { type: 'drought', startDay: s.startDay, endDay: s.startDay + dur - 1 });
  assert.deepEqual(w.weather.active, [{ type: 'drought', startDay: s.startDay, endDay: s.startDay + dur - 1 }]);
  assert.equal(w.weather.scheduled, null);
  assert.deepEqual(w.weather.history, [{ month: 1, type: 'drought', startDay: s.startDay, endDay: s.startDay + dur - 1, decidedBy: 'vote', votes: { drought: 1 } }]);
  assert.ok(a.inbox.some((i) => i.kind === 'weather' && i.code === 'drought' && i.event === 'start'));
  // 旱期间每日产出用 600‰；开始日、第 2 日、第 3 日
  const outputs = [];
  for (let i = 0; i < dur; i++) {
    w.places.well.condition = 10000;
    const ev = settle(w);
    log.push(...ev);
    outputs.push(eventsOf(ev, 'day')[0].data.output);
  }
  outputs.forEach((o, i) => {
    const dom = (s.startDay + i) % P.daysPerMonth;
    const seasonF = [1000, 1065, 1125, 1177, 1217, 1241, 1250, 1241, 1217, 1177, 1125, 1065, 1000, 935, 875, 823, 783, 759, 750, 759, 783, 823, 875, 935][dom];
    assert.equal(o, Math.floor((600 * 1000 * seasonF * 600) / 1e9), `drought day ${i}`);
  });
  const ends = eventsOf(log, 'weather_end');
  assert.equal(ends.length, 1);
  assert.deepEqual(ends[0].data, { type: 'drought', startDay: s.startDay, endDay: s.startDay + dur - 1 });
  assert.equal(ends[0].day, s.startDay + dur - 1); // 在 endDay 当日结算后结束
  assert.deepEqual(w.weather.active, []);
  assert.ok(a.inbox.some((i) => i.kind === 'weather' && i.event === 'end'));
  // 结束后恢复
  w.places.well.condition = 10000;
  const after = eventsOf(settle(w), 'day')[0].data.output;
  const dom = (s.startDay + dur) % P.daysPerMonth;
  assert.ok(after > outputs[0] * 1.2 || dom > 0, 'output back to normal');
  assertInvariants(w);
});

test('丰：源井产出 1400‰', () => {
  const { w } = toWeather('bounty', { seed: 'bounty-run' });
  const s = w.weather.scheduled;
  while (w.clock.tick < (s.startDay - 1) * P.ticksPerDay) tick(w);
  settle(w);
  w.places.well.condition = 10000;
  const dom = s.startDay % P.daysPerMonth;
  const seasonF = [1000, 1065, 1125, 1177, 1217, 1241, 1250, 1241, 1217, 1177, 1125, 1065, 1000, 935, 875, 823, 783, 759, 750, 759, 783, 823, 875, 935][dom];
  assert.equal(eventsOf(settle(w), 'day')[0].data.output, Math.floor((600 * 1000 * seasonF * 1400) / 1e9));
});

test('通知：天象开始与结束时，只有醒着的 agent 收到 weather 收件', () => {
  const { w, a } = toWeather('fog', {
    seed: 'notify',
    setup: (world, agent) => {
      const b = reg(world, '乙');
      b.status = 'dormant';
      b.energy = 0;
      world.ledger.prev.energy -= 40;
      world.params.rationShare = 0.6;
    },
  });
  const s = w.weather.scheduled;
  const b = w.agents.a2;
  while (w.clock.tick < (s.startDay - 1) * P.ticksPerDay) tick(w);
  settle(w);
  assert.ok(a.inbox.some((i) => i.kind === 'weather' && i.code === 'fog' && i.event === 'start'));
  assert.equal(b.inbox.some((i) => i.kind === 'weather'), false);
});

// ── 征兆 ───────────────────────────────────────────────────

const setSchedule = (w, type, startDay, lead) => {
  w.weather.scheduled = { month: Math.floor(startDay / P.daysPerMonth), type, startDay, lead, decidedBy: 'vote', votes: {} };
};
const atDay = (w, day) => { w.clock.tick = day * P.ticksPerDay; };

test('征兆：只在 startDay − lead ≤ 今日 < startDay 的窗口内、只在对应地点出现', () => {
  const { w } = world();
  setSchedule(w, 'drought', 30, 2);
  const at = (day, place) => { atDay(w, day); return omensAt(w, place).map((o) => o.daysAhead); };
  assert.deepEqual(at(27, 'well'), []); // 窗口之前
  assert.deepEqual(at(28, 'well'), [null]); // 窗口第一天（30 − 2）
  assert.deepEqual(at(29, 'well'), [null]);
  assert.deepEqual(at(30, 'well'), []); // 已经降临
  assert.deepEqual(at(28, 'agora'), []); // 别的地点看不到
  assert.deepEqual(at(28, 'port'), []);
  setSchedule(w, 'fog', 30, 1);
  assert.deepEqual(at(28, 'port'), []); // lead 1：29 日才开始
  assert.deepEqual(at(29, 'port'), [null]);
  assert.deepEqual(at(29, 'well'), []);
  setSchedule(w, 'eclipse', 30, 1);
  assert.deepEqual(at(29, 'temple'), [null]);
  setSchedule(w, 'amnesia', 30, 1);
  assert.deepEqual(at(29, 'library'), [null]);
  setSchedule(w, 'aurora', 30, 1);
  assert.deepEqual(at(29, 'wilds'), [null]);
  setSchedule(w, 'migration', 30, 1);
  assert.deepEqual(at(29, 'port'), [null]);
  // 震：所有地点
  setSchedule(w, 'quake', 30, 1);
  for (const p of Object.keys(w.places)) assert.deepEqual(at(29, p), [null], p);
  // 没有排期时没有征兆
  w.weather.scheduled = null;
  assert.deepEqual(at(29, 'well'), []);
});

test('征兆：omenId 不透露类型；对外的征兆数据里没有天象的类型与日期', () => {
  const { w } = world();
  setSchedule(w, 'drought', 30, 1);
  atDay(w, 29);
  const o = omensAt(w, 'well')[0];
  assert.equal(o.omenId, 'm1');
  assert.equal(/drought|旱/.test(o.omenId), false);
  const vis = visibleOmens(w);
  assert.deepEqual(vis, [{ place: 'well', omenId: 'm1', text: { zh: '源井的水声比往常小了。', en: 'The Well sounds quieter than usual.' } }]);
  assert.equal(JSON.stringify(vis).includes('drought'), false);
  assert.equal(JSON.stringify(vis).includes('startDay'), false);
});

test('观星台：身在有正常运转的观星台的地点，能看到 3 日内开始的天象的征兆，并附带「约 N 日后」', () => {
  const { w } = world();
  w.facilities.f1 = { id: 'f1', type: 'observatory', name: '台', place: 'temple', to: null, owner: { kind: 'city' }, condition: 10000, decayPerDay: 60, inscription: null, builtDay: 0, projectId: 'j1', contributors: {}, ruined: false };
  setSchedule(w, 'drought', 30, 1);
  const at = (day, place) => { atDay(w, day); return omensAt(w, place).map((o) => [o.omenId, o.daysAhead]); };
  assert.deepEqual(at(26, 'temple'), []); // 4 日前：看不到
  assert.deepEqual(at(27, 'temple'), [['m1', 3]]); // 3 日前：观星台上看得到，天象发生在源井，但观星台不受地点限制
  assert.deepEqual(at(28, 'temple'), [['m1', 2]]);
  assert.deepEqual(at(29, 'temple'), [['m1', 1]]);
  assert.deepEqual(at(27, 'well'), []); // 别处仍看不到（还没到普通征兆的窗口）
  assert.deepEqual(at(29, 'well'), [['m1', null]]); // 普通征兆：在源井，daysAhead 为 null
  assert.deepEqual(at(30, 'temple'), []);
  // 观星台失修（< 3000）不再运转
  w.facilities.f1.condition = 2999;
  assert.deepEqual(at(28, 'temple'), []);
  // 观星台在源井本身：同一条征兆只出现一次，且带 daysAhead
  w.facilities.f1.condition = 10000;
  w.facilities.f1.place = 'well';
  assert.deepEqual(at(29, 'well'), [['m1', 1]]);
});

test('征兆第一次出现的那一日记一条公开事件（地点与文本，不含类型）；只记一次', () => {
  resetWeather();
  const { w } = world('omen-events');
  vote(w, 'a', 'fog');
  tickDays(w, P.daysPerMonth);
  const s = w.weather.scheduled;
  const all = [];
  while (w.clock.tick < (s.startDay + 1) * P.ticksPerDay) all.push(...tick(w));
  const omens = eventsOf(all, 'omen');
  assert.equal(omens.length, 1);
  assert.equal(omens[0].vis, 'public');
  assert.equal(omens[0].place, 'port');
  assert.deepEqual(omens[0].data, { place: 'port', omenId: 'm1', text: { zh: '港口外起了一层薄雾。', en: 'A thin mist has gathered beyond the Port.' } });
  // 事件发生在窗口第一天开始之前的那次结算（startDay − lead − 1 日）
  assert.equal(omens[0].day, s.startDay - s.lead - 1);
  assert.equal(JSON.stringify(omens[0]).includes('fog'), false);
});

test('征兆：震的征兆出现在所有 12 个地点', () => {
  resetWeather();
  const { w } = world('omen-quake');
  vote(w, 'a', 'quake');
  tickDays(w, P.daysPerMonth);
  const s = w.weather.scheduled;
  const all = [];
  while (w.clock.tick < s.startDay * P.ticksPerDay) all.push(...tick(w));
  assert.deepEqual(eventsOf(all, 'omen').map((e) => e.place).sort(), Object.keys(w.places).sort());
});

// ── 开始时的效果 ─────────────────────────────────────────────

test('震：所有有完好度的地点与设施各受损 1000 + floor(2000 × (10000 − 完好度) / 10000) 基点，不低于 0；降到 0 记 ruin', () => {
  const { w } = world();
  w.places.market.condition = 6000; // 1000 + floor(2000 × 4000 / 10000) = 1800
  w.places.temple.condition = 500; // 1000 + floor(2000 × 9500 / 10000) = 2900 → 降到 0（废墟）
  w.places.library.condition = 0; // 已是废墟
  w.places.well.condition = 10000; // 1000
  w.facilities.f1 = { id: 'f1', type: 'relay', name: 'r', place: 'agora', to: null, owner: { kind: 'city' }, condition: 8000, decayPerDay: 80, inscription: null, builtDay: 0, projectId: 'j1', contributors: {}, ruined: false }; // 1000 + 400 = 1400
  setSchedule(w, 'quake', 1, 1);
  const events = [];
  // 直接执行第 0 日结算里的天象步骤
  stepWeather(w, 0);
  events.push(...(w.$out || []));
  assert.equal(w.places.market.condition, 6000 - 1800);
  assert.equal(w.places.temple.condition, 0);
  assert.equal(w.places.temple.ruined, true);
  assert.equal(w.places.library.condition, 0);
  assert.equal(w.places.well.condition, 9000);
  assert.equal(w.places.port.condition, 9000);
  assert.equal(w.places.agora.condition, null); // 广场没有完好度
  assert.equal(w.facilities.f1.condition, 8000 - 1400);
  assert.equal(events.filter((e) => e.type === 'ruin').length, 1);
  assert.deepEqual(events.find((e) => e.type === 'ruin').data, { target: 'temple' });
});

test('震：平日的修缮让建筑更扛得住——完好度越高，受损越少', () => {
  const dmg = (cond) => 1000 + Math.floor((2000 * (10000 - cond)) / 10000);
  assert.equal(dmg(10000), 1000);
  assert.equal(dmg(5000), 2000);
  assert.equal(dmg(1), 2999);
  const { w } = world();
  w.places.market.condition = 10000;
  w.places.court.condition = 3000;
  setSchedule(w, 'quake', 1, 1);
  stepWeather(w, 0);
  assert.equal(10000 - w.places.market.condition, 1000);
  assert.equal(3000 - w.places.court.condition, dmg(3000));
});

test('忘川：每个醒着的 agent 随机遗忘一条记忆（若有）；沉睡者与没有记忆的人不受影响', () => {
  const { w } = world('amnesia');
  const a = w.agents.a1;
  const b = reg(w, '乙');
  const c = reg(w, '丙');
  const d = reg(w, '丁');
  for (let i = 0; i < 5; i++) {
    a.actsThisTick = 0;
    one(w, a, { type: 'remember', text: `甲的记忆${i}` });
    b.actsThisTick = 0;
    one(w, b, { type: 'remember', text: `乙的记忆${i}` });
  }
  one(w, d, { type: 'remember', text: '丁的记忆' });
  d.status = 'dormant';
  d.energy = 0;
  w.ledger.prev.energy -= 40;
  setSchedule(w, 'amnesia', 1, 1);
  stepWeather(w, 0);
  const forgets = (w.$out || []).filter((e) => e.type === 'forget' && e.data.cause === 'amnesia');
  assert.equal(a.memories.length, 4);
  assert.equal(b.memories.length, 4);
  assert.equal(c.memories.length, 0);
  assert.equal(d.memories.length, 1); // 沉睡者不受影响
  assert.equal(forgets.length, 2);
  assert.equal(forgets[0].vis, 'delayed');
  const gone = forgets.find((e) => e.agent === a.id);
  assert.ok(gone.data.text.startsWith('甲的记忆'));
  assert.ok(!a.memories.some((m) => m.text === gone.data.text));
});

test('迁徙潮：摇篮中每个灵魂的消散期限延后 12 日', () => {
  const { w } = world('migr');
  w.souls.s1 = { id: 's1', name: '甲孩', soul: 's', lang: 'zh', parents: ['a1', 'a1'], generation: 1, endowment: 40, createdDay: 0, expiresDay: 24, judged: false };
  w.souls.s2 = { id: 's2', name: '乙孩', soul: 's', lang: 'zh', parents: ['a1', 'a1'], generation: 1, endowment: 40, createdDay: 5, expiresDay: 29, judged: false };
  w.ledger.prev.energy += 80;
  setSchedule(w, 'migration', 1, 1);
  stepWeather(w, 0);
  assert.equal(w.souls.s1.expiresDay, 36);
  assert.equal(w.souls.s2.expiresDay, 41);
  assertInvariants(w);
});

test('雾与蚀：生效期间私语、宣告的代价加倍 / 不能宣告（驿站可抵消）——用真实排期的天象走一遍', () => {
  const { w, a } = toWeather('eclipse', { seed: 'eclipse-run' });
  grant(w, a, 100);
  const s = w.weather.scheduled;
  while (w.clock.tick < (s.startDay - 1) * P.ticksPerDay) tick(w);
  settle(w); // 蚀开始
  assert.equal(w.weather.active[0].type, 'eclipse');
  assert.equal(one(w, a, { type: 'broadcast', text: '有人吗' }).error.code, 'disabled_by_weather');
  settle(w); // 蚀持续 1 日：本次结算后结束
  assert.equal(w.weather.active.length, 0);
  assert.equal(one(w, a, { type: 'broadcast', text: '恢复了' }).ok, true);
});

// ── 强行排期 ─────────────────────────────────────────────────

test('forceWeather（管理接口用）：强行排期一次天象，开始日必须在未来；征兆已出现时立即记事件', () => {
  const { w } = world('force');
  assert.equal(forceWeather(w, { type: 'calm' }).error.code, 'invalid_request');
  assert.equal(forceWeather(w, { type: 'nonsense' }).error.code, 'invalid_request');
  assert.equal(forceWeather(w, { type: 'fog', month: 0, dayOfMonth: 0 }).error.code, 'invalid_request'); // 今天或以前
  const r = forceWeather(w, { type: 'fog', month: 0, dayOfMonth: 5, lead: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(w.weather.scheduled, { month: 0, type: 'fog', startDay: 5, lead: 2, decidedBy: 'schedule', votes: {} });
  assert.equal((w.$out || []).filter((e) => e.type === 'omen').length, 0); // 窗口还没开始
  // 缺省：今天 + lead + 1 开始，征兆从明天起出现——此刻还没有
  const r2 = forceWeather(w, { type: 'quake' });
  assert.equal(r2.ok, true);
  assert.equal(r2.scheduled.startDay, 0 + 1 + 1);
  assert.equal((w.$out || []).filter((e) => e.type === 'omen').length, 0);
  // 明天开始、提前 1 日：征兆窗口从今天就打开了，立即记 12 条（震在所有地点）
  const r3 = forceWeather(w, { type: 'quake', month: 0, dayOfMonth: 1, lead: 1 });
  assert.equal(r3.ok, true);
  assert.equal((w.$out || []).filter((e) => e.type === 'omen').length, 12);
});

test('天象的一个完整月：随机动作与天象混合，仍然守恒', () => {
  resetWeather();
  const { w } = world('mix');
  for (const n of ['乙', '丙', '丁']) reg(w, n);
  for (let m = 0; m < 4; m++) {
    vote(w, `m${m}`, ['drought', 'quake', 'amnesia', 'bounty'][m]);
    tickDays(w, P.daysPerMonth);
    assertInvariants(w, `month ${m}`);
  }
  assert.ok(w.weather.history.length >= 2);
});
