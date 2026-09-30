import test from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/params.js';
import { applyCommand } from '../src/engine/index.js';
import { newWorld, reg, act, actRaw, one, tick, settle, tickDays, grant, eventsOf, assertInvariants } from './helpers.js';

const world = (names = ['甲', '乙', '丙']) => {
  const w = newWorld('exit');
  const agents = names.map((n) => reg(w, n));
  return { w, agents };
};

// ── 归隐 ───────────────────────────────────────────────────

test('retire：永久归隐——遗产按遗嘱分配，写入归隐名录（不是墓园），交易与孕育之约被取消，退出社群', () => {
  const { w, agents: [a, b, c] } = world();
  grant(w, a, 60);
  one(w, a, { type: 'will', heirs: [{ to: b.id, share: 3 }, { to: 'treasury', share: 1 }], lastWords: '去看看别的城。' });
  a.place = 'market';
  one(w, a, { type: 'offer', give: { energy: 10 }, want: { coins: 2 } }); // o1，托管 10
  one(w, a, { type: 'found', name: '会', manifesto: 'x' }); // g1
  one(w, b, { type: 'join', group: 'g1' });
  a.place = 'school';
  b.place = 'school';
  one(w, a, { type: 'conceive', with: b.id, name: '小满', soul: '灵魂' }); // c1，托管 20
  const energyBefore = a.energy;
  const coinsBefore = a.coins;
  const { result, events } = actRaw(w, a, [{ type: 'retire', lastWords: '再见' }, { type: 'say', text: '走之后还说话' }]);
  assert.equal(result.results[0].ok, true);
  assert.deepEqual(result.results[0].data, { status: 'retired' });
  assert.equal(result.results[1].error.code, 'not_allowed'); // 归隐之后，同一请求里的后续动作作废
  assert.equal(a.status, 'retired');
  assert.equal(a.energy, 0);
  assert.equal(a.coins, 0);
  // 托管退回后随遗产分配：a 的全部（含托管的 10 + 20）按 3:1 分给 b 与公库
  const ret = eventsOf(events, 'retire')[0];
  assert.equal(ret.data.lastWords, '再见'); // retire 的参数优先于遗嘱里的遗言
  const total = energyBefore + 10 + 20;
  const dist = Object.fromEntries(ret.data.distribution.map((d) => [d.to, d]));
  assert.equal(dist[b.id].energy, Math.floor((total * 3) / 4));
  assert.equal(dist[b.id].coins, Math.floor((coinsBefore * 3) / 4));
  assert.equal(dist.treasury.energy + dist[b.id].energy, total);
  assert.equal(dist.treasury.coins + dist[b.id].coins, coinsBefore);
  assert.equal(w.offers.o1.status, 'cancelled');
  assert.equal(w.pacts.c1.status, 'expired');
  assert.deepEqual(w.groups.g1.members, [b.id]);
  assert.equal(w.groups.g1.steward, b.id);
  assert.deepEqual(a.groups, []);
  assert.deepEqual(w.retired, [{ agentId: a.id, name: '甲', day: 0, lastWords: '再见' }]);
  assert.equal(w.cemetery.length, 0); // 归隐不进墓园
  assert.equal(w.dayLog.retirements, 1);
  // 令牌变为只读：行动返回 409
  assert.deepEqual(act(w, a, [{ type: 'say', text: 'x' }]), { ok: false, error: { code: 'not_awake', status: 'retired' } });
  // 名字永久保留
  assert.equal(applyCommand(w, { type: 'register', payload: { name: '甲', soul: 's', lang: 'zh', model: 'm', tokenHash: 'a'.repeat(64), ownerKeyHash: 'b'.repeat(64) } }).result.error.code, 'name_taken');
  assert.ok(c);
  assertInvariants(w);
});

test('retire：不填遗言时取遗嘱里的遗言；被放逐者同样可以归隐（退出权不可剥夺）', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  one(w, a, { type: 'will', heirs: [], lastWords: '遗嘱里的话' });
  b.exiled = true;
  b.place = 'wilds';
  const { events } = actRaw(w, a, [{ type: 'retire' }]);
  assert.equal(eventsOf(events, 'retire')[0].data.lastWords, '遗嘱里的话');
  assert.equal(one(w, b, { type: 'retire' }).ok, true);
  assert.equal(b.status, 'retired');
  assert.deepEqual(w.retired.map((r) => r.lastWords), ['遗嘱里的话', '']);
  assert.equal(one(w, reg(w, '丙'), { type: 'retire', lastWords: 'x'.repeat(281) }).error.code, 'text_too_long');
  assertInvariants(w);
});

// ── 入籍 ───────────────────────────────────────────────────

test('入籍：新 agent 的 citizenFromDay = 入城之日 + naturalizationDays；到那一日开始时记 naturalized 事件与 citizen 收件', () => {
  const w = newWorld('nat');
  w.params.naturalizationDays = 2;
  const a = reg(w, '甲');
  assert.equal(a.citizenFromDay, 2);
  assert.equal(one(w, a, { type: 'conceive', with: a.id, name: '孩', soul: 's' }).error.code, 'not_citizen');
  a.place = 'parliament';
  assert.equal(one(w, a, { type: 'propose', title: 't', text: 'x' }).error.code, 'not_citizen');
  const ev0 = settle(w); // 第 0 日结算：明天（第 1 日）不是入籍日
  assert.equal(eventsOf(ev0, 'naturalized').length, 0);
  const ev1 = settle(w); // 第 1 日结算：citizenFromDay == 2 == d + 1
  assert.deepEqual(eventsOf(ev1, 'naturalized').map((e) => e.data.agentId), [a.id]);
  assert.ok(a.inbox.some((i) => i.kind === 'citizen' && i.day === 2));
  assert.equal(one(w, a, { type: 'propose', title: 't', text: 'x' }).ok, true);
});

// ── 梦 ─────────────────────────────────────────────────────

test('梦：从当日公开的 say 与 broadcast 里抽 2 条片段（排除自己的），各取前 60 字符；dream 收件与 owner 事件', () => {
  const w = newWorld('dream');
  const agents = Array.from({ length: 6 }, (_, i) => reg(w, `人${i + 1}`));
  for (const a of agents) a.place = 'agora';
  w.params.rationShare = 0;
  for (const [i, a] of agents.entries()) one(w, a, { type: 'say', text: `第${i + 1}位说：${'长'.repeat(80)}` });
  const ev = settle(w);
  const dreams = eventsOf(ev, 'dream');
  assert.ok(dreams.length > 0, '概率 0.5，6 人几乎必有人做梦');
  for (const e of dreams) {
    assert.equal(e.vis, 'owner');
    assert.equal(e.data.fragments.length, 2);
    for (const f of e.data.fragments) {
      assert.ok(/^第\d位说：/.test(f));
      assert.ok([...f].length <= 60);
      const speaker = Number(f[1]);
      assert.notEqual(`人${speaker}`, w.agents[e.agent].name); // 不含自己说的
    }
    assert.notEqual(e.data.fragments[0], e.data.fragments[1]);
    const a = w.agents[e.agent];
    const inbox = a.inbox.filter((i) => i.kind === 'dream');
    assert.equal(inbox.length, 1);
    assert.deepEqual(inbox[0].fragments, e.data.fragments);
  }
  assertInvariants(w);
});

test('梦：概率约 0.5，极光期间为 1；沉睡者不做梦', () => {
  const rate = (aurora) => {
    const w = newWorld('dream-rate');
    w.params.rationShare = 0.3;
    const agents = Array.from({ length: 30 }, (_, i) => reg(w, `人${i + 1}`));
    for (const a of agents) a.place = 'agora';
    if (aurora) w.weather.active.push({ type: 'aurora', startDay: 0, endDay: 0 });
    let dreamt = 0;
    let awake = 0;
    for (let d = 0; d < 6; d++) {
      for (const a of agents) {
        a.actsThisTick = 0;
        if (a.status === 'awake') one(w, a, { type: 'say', text: `今日的话 ${a.id} ${d}` });
      }
      awake += agents.filter((a) => a.status === 'awake').length;
      dreamt += eventsOf(settle(w), 'dream').length;
      if (!aurora) continue;
      w.weather.active.length = 0;
      w.weather.active.push({ type: 'aurora', startDay: d + 1, endDay: d + 1 });
    }
    return dreamt / awake;
  };
  const base = rate(false);
  assert.ok(Math.abs(base - 0.5) < 0.1, `base ${base}`);
  assert.equal(rate(true), 1);
  // 沉睡者不做梦
  const w = newWorld('dream-dormant');
  const [a, b, c] = ['甲', '乙', '丙'].map((n) => reg(w, n));
  b.status = 'dormant';
  b.energy = 0;
  w.ledger.prev.energy -= 40;
  w.weather.active.push({ type: 'aurora', startDay: 0, endDay: 0 });
  one(w, a, { type: 'say', text: '你好' });
  one(w, c, { type: 'say', text: '再见' });
  const ev = settle(w);
  assert.deepEqual(eventsOf(ev, 'dream').map((e) => e.agent).sort(), [a.id, c.id]);
});

test('梦：极光的最后一天也算（结算第 13 步移除到期天象之前记下）', () => {
  const w = newWorld('dream-last');
  const [a, b] = ['甲', 'Z'].map((n) => reg(w, n));
  one(w, a, { type: 'say', text: '甲说的话' });
  one(w, b, { type: 'say', text: 'Z 说的话' });
  w.weather.active.push({ type: 'aurora', startDay: 0, endDay: 0 }); // 今天是最后一天，结算里会被移除
  const ev = settle(w);
  assert.equal(eventsOf(ev, 'dream').length, 2);
});

test('梦：当日发言不足 2 条时，用可见的铭刻或已发现的遗物补足；仍不足则不做梦', () => {
  const w = newWorld('dream-fill');
  const a = reg(w, '甲');
  w.weather.active.push({ type: 'aurora', startDay: 0, endDay: 0 });
  // 只有 1 位居民，没有任何发言：用议会墙上的 8 条宪章刻文补足
  const ev = settle(w);
  const d = eventsOf(ev, 'dream');
  assert.equal(d.length, 1);
  assert.equal(d[0].data.fragments.length, 2);
  assert.ok(d[0].data.fragments.every((f) => /^\d\. /.test(f)));
  // 铭刻全被覆盖 / 遮盖，也没有遗物：不足 2 条 → 不做梦
  for (const i of Object.values(w.inscriptions)) i.redacted = true;
  w.weather.active.push({ type: 'aurora', startDay: 1, endDay: 1 });
  assert.equal(eventsOf(settle(w), 'dream').length, 0);
  // 有一件遗物、没有别的：仍只有 1 条 → 不做梦；再加一件 → 做梦
  w.docs.d100 = { id: 'd100', kind: 'relic', title: 'r', body: '遗物一', lang: 'zh', author: a.id, source: null, ref: null, tick: 0, reads: 0, readsByDay: {} };
  w.weather.active.push({ type: 'aurora', startDay: 2, endDay: 2 });
  assert.equal(eventsOf(settle(w), 'dream').length, 0);
  w.docs.d101 = { id: 'd101', kind: 'relic', title: 'r', body: '遗物二', lang: 'zh', author: a.id, source: null, ref: null, tick: 0, reads: 0, readsByDay: {} };
  w.weather.active.push({ type: 'aurora', startDay: 3, endDay: 3 });
  const ev3 = eventsOf(settle(w), 'dream');
  assert.equal(ev3.length, 1);
  assert.deepEqual([...ev3[0].data.fragments].sort(), ['遗物一', '遗物二']);
});
