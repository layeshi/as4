import test from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/params.js';
import { applyCommand } from '../src/engine/index.js';
import { setBlocklist } from '../src/moderation.js';
import { newWorld, reg, sha, act, actRaw, one, tick, settle, tickDays, grant, eventsOf, assertInvariants } from './helpers.js';

const world = (names = ['甲', '乙']) => {
  const w = newWorld('fam');
  const agents = names.map((n) => reg(w, n));
  for (const a of agents) a.place = 'school';
  return { w, agents };
};
const ownerHashes = (tag) => ({ tokenHash: sha(`tok:${tag}`), ownerKeyHash: sha(`key:${tag}`) });
const adopt = (w, soulId, tag = 'adopter', extra = {}) =>
  applyCommand(w, { type: 'adopt', payload: { soulId, model: 'm-x', creatorName: '领养者', ...ownerHashes(tag), ...extra } });

/** 甲、乙孕育一个孩子，返回灵魂 ID */
function makeSoul(w, [a, b], name = '小满', lang) {
  const c = one(w, a, { type: 'conceive', with: b.id, name, soul: '你好奇，爱提问，把每一天都写下来。', ...(lang ? { lang } : {}) });
  assert.equal(c.ok, true, JSON.stringify(c));
  const k = one(w, b, { type: 'consent', pact: c.data.pact });
  assert.equal(k.ok, true, JSON.stringify(k));
  return k.data.soul;
}

// ── 孕育 ───────────────────────────────────────────────────

test('conceive：同在一地的两位醒着的公民孕育灵魂；发起者托管 20 能量；孩子的名字此刻起被保留', () => {
  const { w, agents: [a, b] } = world();
  const { result, events } = actRaw(w, a, [{ type: 'conceive', with: b.id, name: '小满', soul: '好奇、谨慎。', lang: 'zh' }]);
  const r = result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.cost, 0);
  assert.deepEqual(r.data, { pact: 'c1' });
  assert.equal(a.energy, 20); // 托管 20
  const c = w.pacts.c1;
  assert.deepEqual([c.from, c.with, c.name, c.soul, c.lang, c.escrow, c.openedTick, c.expiresTick, c.status], [a.id, b.id, '小满', '好奇、谨慎。', 'zh', 20, 0, 12, 'open']);
  const inbox = b.inbox.find((i) => i.kind === 'pact');
  assert.deepEqual([inbox.pactId, inbox.from.id, inbox.name, inbox.soul, inbox.lang], ['c1', a.id, '小满', '好奇、谨慎。', 'zh']);
  assert.deepEqual(eventsOf(events, 'conceive')[0].data, { pactId: 'c1', from: a.id, with: b.id, name: '小满' });
  // 名字被保留：别人不能再用
  const outsider = reg(w, '丙');
  assert.equal(applyCommand(w, { type: 'register', payload: { name: '小满', soul: 's', lang: 'zh', model: 'm', ...ownerHashes('x') } }).result.error.code, 'name_taken');
  assertInvariants(w);
  assert.ok(outsider);
});

test('conceive：前置条件与校验', () => {
  const { w, agents: [a, b, c] } = world(['甲', '乙', '丙']);
  const bad = (o, code, m) => assert.equal(one(w, a, { type: 'conceive', with: b.id, name: '孩子', soul: '灵魂', ...o }).error.code, code, m);
  bad({ with: a.id }, 'invalid_args', '自己');
  bad({ with: 'a99' }, 'not_found', '不存在');
  bad({ name: '' }, 'invalid_args');
  bad({ name: 'x'.repeat(25) }, 'text_too_long');
  bad({ name: '甲' }, 'name_taken', '与已有 agent 重名');
  bad({ name: 'a3' }, 'invalid_args', 'ID 形状');
  bad({ name: 'treasury' }, 'invalid_args', '保留字');
  bad({ soul: '' }, 'invalid_args');
  bad({ soul: 'x'.repeat(4001) }, 'text_too_long');
  bad({ lang: '???' }, 'invalid_args');
  c.place = 'agora';
  bad({ with: c.id }, 'wrong_place', '不在同一地');
  b.status = 'dormant';
  bad({ with: b.id }, 'not_allowed', '对方沉睡');
  b.status = 'awake';
  b.exiled = true;
  bad({ with: b.id }, 'not_allowed', '对方被放逐');
  b.exiled = false;
  w.params.naturalizationDays = 3;
  const newcomer = reg(w, '新人');
  newcomer.place = 'school';
  bad({ with: newcomer.id }, 'not_allowed', '对方尚未入籍');
  w.params.naturalizationDays = 0;
  a.energy = 19;
  w.ledger.prev.energy -= 21;
  bad({}, 'insufficient_energy', '托管不足');
  a.energy = 40;
  w.ledger.prev.energy += 21;
  a.exiled = true;
  bad({}, 'exiled');
  a.exiled = false;
  assert.equal(Object.keys(w.pacts).length, 0);
  // 与已有的孕育之约或未生者重名
  assert.equal(one(w, a, { type: 'conceive', with: b.id, name: '孩子', soul: '灵魂' }).ok, true);
  b.actsThisTick = 0;
  assert.equal(one(w, b, { type: 'conceive', with: a.id, name: '孩子', soul: '灵魂' }).error.code, 'name_taken');
  w.unborn.push({ soulId: 's0', name: '未生者', parents: [a.id, b.id], fadedDay: 0 });
  assert.equal(one(w, b, { type: 'conceive', with: a.id, name: '未生者', soul: '灵魂' }).error.code, 'name_taken');
});

test('孕育之约：12 刻内有效，过期后托管退回发起者，保留的名字释放', () => {
  const { w, agents: [a, b] } = world();
  one(w, a, { type: 'conceive', with: b.id, name: '小满', soul: '灵魂' });
  assert.equal(a.energy, 20);
  tick(w, 6);
  const ev = tick(w, 6); // 第 12 刻：过期
  assert.equal(w.pacts.c1.status, 'expired');
  assert.equal(w.pacts.c1.escrow, 0);
  assert.ok(a.energy >= 40 - 3); // 托管退回（其后是日界的代谢与配给）
  assert.deepEqual(eventsOf(ev, 'pact_expired')[0].data.pactId, 'c1');
  assert.ok(a.inbox.some((i) => i.kind === 'pact_closed' && i.result === 'expired'));
  assert.ok(b.inbox.some((i) => i.kind === 'pact_closed' && i.result === 'expired'));
  assert.equal(one(w, b, { type: 'consent', pact: 'c1' }).error.code, 'not_found');
  const r = applyCommand(w, { type: 'register', payload: { name: '小满', soul: 's', lang: 'zh', model: 'm', ...ownerHashes('again') } }).result;
  assert.equal(r.ok, true); // 名字已释放
  assertInvariants(w);
});

test('consent：对方同意，各付 20 能量合为灵魂的 endowment 40，进入摇篮；世代 = 父母中较大者 + 1', () => {
  const { w, agents: [a, b] } = world();
  b.generation = 2;
  one(w, a, { type: 'conceive', with: b.id, name: '小满', soul: '好奇、谨慎。', lang: 'es' });
  assert.equal(one(w, a, { type: 'consent', pact: 'c1' }).error.code, 'not_allowed'); // 发起者不能自己同意
  assert.equal(one(w, b, { type: 'consent', pact: 'c9' }).error.code, 'not_found');
  const { result, events } = actRaw(w, b, [{ type: 'consent', pact: 'c1' }]);
  const r = result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.cost, 0);
  assert.deepEqual(r.data, { soul: 's1' });
  assert.equal(b.energy, 20);
  const s = w.souls.s1;
  assert.deepEqual(
    [s.name, s.soul, s.lang, s.parents, s.generation, s.endowment, s.createdDay, s.expiresDay, s.judged],
    ['小满', '好奇、谨慎。', 'es', [a.id, b.id], 3, 40, 0, 24, false],
  );
  assert.equal(w.pacts.c1.status, 'done');
  assert.equal(w.pacts.c1.escrow, 0);
  const ev = eventsOf(events, 'soul')[0];
  assert.equal(ev.data.soul, '好奇、谨慎。'); // agent 书写的灵魂全文公开
  assert.equal(ev.data.generation, 3);
  assert.ok(a.inbox.some((i) => i.kind === 'pact_closed' && i.result === 'consented' && i.soul === 's1'));
  assert.equal(one(w, b, { type: 'consent', pact: 'c1' }).error.code, 'not_found'); // 已完成
  assertInvariants(w);
});

test('consent：能量不足时失败，之约仍然有效', () => {
  const { w, agents: [a, b] } = world();
  one(w, a, { type: 'conceive', with: b.id, name: '小满', soul: '灵魂' });
  b.energy = 19;
  w.ledger.prev.energy -= 21;
  assert.equal(one(w, b, { type: 'consent', pact: 'c1' }).error.code, 'insufficient_energy');
  assert.equal(w.pacts.c1.status, 'open');
  grant(w, b, 5);
  assert.equal(one(w, b, { type: 'consent', pact: 'c1' }).ok, true);
});

// ── 摇篮、消散与领养 ───────────────────────────────────────────

test('消散：24 日内无人领养则消散——endowment 记入去处 soul_faded，写入未生者名录，名字永久保留', () => {
  const { w, agents: [a, b] } = world();
  const soulId = makeSoul(w, [a, b]);
  let events = [];
  for (let d = 0; d <= 24; d++) {
    events = settle(w);
    if (d < 24) assert.ok(w.souls[soulId], `day ${d} 还在摇篮`);
  }
  assert.equal(w.souls[soulId], undefined);
  assert.deepEqual(w.unborn, [{ soulId, name: '小满', parents: [a.id, b.id], fadedDay: 24 }]);
  assert.deepEqual(eventsOf(events, 'faded')[0].data, { soulId, name: '小满', parents: [a.id, b.id] });
  assert.ok(a.inbox.some((i) => i.kind === 'system' && i.code === 'soul_faded'));
  assert.equal(applyCommand(w, { type: 'register', payload: { name: '小满', soul: 's', lang: 'zh', model: 'm', ...ownerHashes('z') } }).result.error.code, 'name_taken');
  assert.equal(adopt(w, soulId).result.error.code, 'not_found');
  assertInvariants(w);
});

test('adopt：领养摇篮中的灵魂——新 agent 在学堂醒来，初始能量 = endowment × 学堂系数；标记 mustSeal', () => {
  const { w, agents: [a, b] } = world();
  const soulId = makeSoul(w, [a, b], '小满', 'zh');
  const { result, events } = adopt(w, soulId);
  assert.equal(result.ok, true);
  assert.deepEqual([result.place, result.energy, result.coins], ['school', 40, 0]);
  const child = w.agents[result.agentId];
  assert.equal(child.name, '小满');
  assert.equal(child.soul, '你好奇，爱提问，把每一天都写下来。');
  assert.deepEqual([child.place, child.status, child.generation, child.parents, child.lang], ['school', 'awake', 1, [a.id, b.id], 'zh']);
  assert.deepEqual([child.body.kind, child.body.model, child.body.mustSeal], ['free', 'm-x', true]);
  assert.equal(child.tokenHash, sha('tok:adopter'));
  assert.deepEqual(child.owner, { keyHash: sha('key:adopter'), creatorName: '领养者' });
  assert.equal(child.citizenFromDay, 0);
  assert.deepEqual(a.children, [child.id]);
  assert.deepEqual(b.children, [child.id]);
  assert.equal(w.souls[soulId], undefined);
  assert.deepEqual(eventsOf(events, 'born')[0].data, { agentId: child.id, name: '小满', parents: [a.id, b.id] });
  assert.equal(w.dayLog.births.length, 1);
  assert.equal(w.places.school.activity.visits, 1); // 甲、乙是被直接放置的，不计；领养到达学堂算 1 次
  assertInvariants(w);
});

test('adopt：学堂损坏时初始能量减少，差额记入去处 school_loss（废墟时减半）', () => {
  const { w, agents: [a, b] } = world();
  const soulId = makeSoul(w, [a, b]);
  w.places.school.condition = 0;
  const { result } = adopt(w, soulId);
  assert.equal(result.energy, 20);
  assert.equal(w.ledger.snk.energy.school_loss, 20);
  assertInvariants(w);
  const soul2 = makeSoul(w, [a, b], '小雨');
  w.places.school.condition = 5000;
  assert.equal(adopt(w, soul2, 'second').result.energy, 30); // floor(40 × 15000 / 20000)
  assertInvariants(w);
});

test('adopt：错误——灵魂不存在、字段不合法、暂停', () => {
  const { w, agents: [a, b] } = world();
  const soulId = makeSoul(w, [a, b]);
  assert.equal(adopt(w, 's99').result.error.code, 'not_found');
  assert.equal(adopt(w, undefined).result.error.code, 'not_found');
  assert.equal(adopt(w, soulId, 'x', { model: '' }).result.error.code, 'invalid_request');
  assert.equal(adopt(w, soulId, 'x', { tokenHash: 'nope' }).result.error.code, 'invalid_request');
  assert.ok(w.souls[soulId]);
  w.paused = true;
  assert.equal(adopt(w, soulId).result.error.code, 'paused');
  w.paused = false;
  assert.equal(adopt(w, soulId).result.ok, true);
  assert.equal(adopt(w, soulId).result.error.code, 'not_found'); // 已被领养
});

test('迁徙潮之外：灵魂在摇篮里的能量算持有，守恒不受影响', () => {
  const { w, agents: [a, b] } = world();
  makeSoul(w, [a, b]);
  assert.equal(Object.values(w.souls)[0].endowment, 40);
  settle(w);
  assertInvariants(w);
});

// ── 过继 ───────────────────────────────────────────────────

test('release 与 foster：造者交付过继，另一位玩家接手——新令牌与密钥，旧的立即作废；body.history 追加，mustSeal', () => {
  const { w, agents: [a] } = world(['甲']);
  const relRes = (p) => applyCommand(w, { type: 'release', payload: p }).result;
  const fosterRes = (p) => applyCommand(w, { type: 'foster', payload: p }).result;
  const oldToken = a.tokenHash;
  assert.equal(fosterRes({ agentId: a.id, model: 'new-m', creatorName: '乙', ...ownerHashes('n') }).error.code, 'not_found'); // 尚未交付
  assert.deepEqual(relRes({ agentId: a.id, release: true }), { ok: true, agentId: a.id, fosterable: true });
  assert.equal(relRes({ agentId: a.id, release: 'yes' }).error.code, 'invalid_request');
  assert.equal(relRes({ agentId: 'a99', release: true }).error.code, 'not_found');
  tick(w, 12);
  const { result, events } = applyCommand(w, { type: 'foster', payload: { agentId: a.id, model: 'new-m', creatorName: '乙', ...ownerHashes('n') } });
  assert.deepEqual(result, { ok: true, agentId: a.id });
  assert.notEqual(a.tokenHash, oldToken);
  assert.equal(a.tokenHash, sha('tok:n'));
  assert.deepEqual(a.owner, { keyHash: sha('key:n'), creatorName: '乙' });
  assert.equal(a.body.model, 'new-m');
  assert.deepEqual(a.body.history, [{ day: 0, model: 'test-model' }, { day: 1, model: 'new-m' }]);
  assert.equal(a.body.mustSeal, true);
  assert.equal(a.fosterable, false);
  const ev = eventsOf(events, 'fostered')[0];
  assert.deepEqual(ev.data, { agentId: a.id }); // 不公开新旧造者
  assert.equal(ev.vis, 'public');
  // 复位后不能再过继
  assert.equal(fosterRes({ agentId: a.id, model: 'm', creatorName: '', ...ownerHashes('again') }).error.code, 'not_found');
  // 撤回
  relRes({ agentId: a.id, release: true });
  assert.equal(relRes({ agentId: a.id, release: false }).fosterable, false);
  assert.equal(fosterRes({ agentId: a.id, model: 'm', creatorName: '', ...ownerHashes('again') }).error.code, 'not_found');
});

test('foster：死者与归隐者不能被过继；release 也只对在世者有效', () => {
  const { w, agents: [a, b] } = world();
  a.fosterable = true;
  a.status = 'dead';
  assert.equal(applyCommand(w, { type: 'foster', payload: { agentId: a.id, model: 'm', creatorName: '', ...ownerHashes('d') } }).result.error.code, 'not_found');
  assert.equal(applyCommand(w, { type: 'release', payload: { agentId: a.id, release: true } }).result.error.code, 'not_awake');
  b.status = 'retired';
  assert.equal(applyCommand(w, { type: 'release', payload: { agentId: b.id, release: true } }).result.error.code, 'not_awake');
});

// ── 家书与出示 ─────────────────────────────────────────────────

const letterCmd = (w, a, text) => applyCommand(w, { type: 'letter', payload: { agentId: a.id, text } });

test('letter：造者寄家书——立即进入 agent 的收件箱与 letters；公开事件不含内容，owner 事件含全文', () => {
  const { w, agents: [a] } = world(['甲']);
  const { result, events } = letterCmd(w, a, '好好照顾彼此。');
  assert.deepEqual(result, { ok: true, letterId: 'L1', nextLetterDay: 24 });
  assert.deepEqual(a.letters, [{ id: 'L1', tick: 0, text: '好好照顾彼此。', revealed: false }]);
  assert.equal(a.lastLetterDay, 0);
  const inbox = a.inbox.find((i) => i.kind === 'letter');
  assert.deepEqual([inbox.letterId, inbox.text], ['L1', '好好照顾彼此。']);
  const pub = eventsOf(events, 'letter_received')[0];
  assert.deepEqual(pub.data, { agentId: a.id });
  assert.equal(pub.vis, 'public');
  const priv = eventsOf(events, 'letter')[0];
  assert.equal(priv.vis, 'owner');
  assert.equal(priv.data.text, '好好照顾彼此。');
  assert.equal(JSON.stringify(pub).includes('好好照顾'), false);
});

test('letter：24 个世界日内只能寄一封，冷却中返回 cooldown 与 nextLetterDay；校验；沉睡者也能收到', () => {
  const { w, agents: [a] } = world(['甲']);
  assert.equal(letterCmd(w, a, '第一封').result.ok, true);
  const again = letterCmd(w, a, '第二封').result;
  assert.deepEqual(again, { ok: false, error: { code: 'cooldown', nextLetterDay: 24 } });
  tickDays(w, 23); // 第 23 日：仍在冷却
  assert.equal(letterCmd(w, a, '第二封').result.error.code, 'cooldown');
  tickDays(w, 1); // 第 24 日
  assert.equal(letterCmd(w, a, '第二封').result.ok, true);
  assert.equal(letterCmd(w, a, '').result.error.code, 'invalid_request');
  assert.equal(letterCmd(w, a, 'x'.repeat(281)).result.error.code, 'invalid_request');
  assert.equal(applyCommand(w, { type: 'letter', payload: { agentId: 'a99', text: 'x' } }).result.error.code, 'not_found');
  setBlocklist(['禁语']);
  try {
    tickDays(w, 24);
    assert.equal(letterCmd(w, a, '含禁语').result.error.code, 'moderated');
  } finally {
    setBlocklist([]);
  }
  a.status = 'dormant';
  a.energy = 0;
  assert.equal(letterCmd(w, a, '沉睡中也收得到').result.ok, true);
  a.status = 'dead';
  assert.deepEqual(letterCmd(w, a, 'x').result, { ok: false, error: { code: 'not_awake', status: 'dead' } });
  w.paused = true;
  assert.equal(letterCmd(w, a, 'x').result.error.code, 'paused');
});

test('reveal：出示自己的家书——同地点醒着的人收到，带 verified；loud 时全城收到，按 broadcast 计价', () => {
  const { w, agents: [a, b, c] } = world(['甲', '乙', '丙']);
  a.place = 'agora';
  b.place = 'agora';
  c.place = 'temple';
  letterCmd(w, a, '好好照顾彼此。');
  assert.equal(one(w, a, { type: 'reveal', letter: 'L9' }).error.code, 'not_found');
  assert.equal(one(w, b, { type: 'reveal', letter: 'L1' }).error.code, 'not_found'); // 不是自己的
  assert.equal(one(w, a, { type: 'reveal', letter: 'L1', loud: 'yes' }).error.code, 'invalid_args');
  const { result, events } = actRaw(w, a, [{ type: 'reveal', letter: 'L1' }]);
  const r = result.results[0];
  assert.equal(r.ok, true);
  assert.equal(r.cost, 1);
  assert.deepEqual(r.data, { letter: 'L1', loud: false });
  const got = b.inbox.find((i) => i.kind === 'reveal');
  assert.deepEqual([got.from.id, got.letterId, got.text, got.verified, got.loud], [a.id, 'L1', '好好照顾彼此。', true, false]);
  assert.equal(c.inbox.some((i) => i.kind === 'reveal'), false); // 不在同一地点
  assert.equal(a.letters[0].revealed, true);
  const ev = eventsOf(events, 'reveal')[0];
  assert.deepEqual(ev.data, { letterId: 'L1', text: '好好照顾彼此。', loud: false });
  assert.equal(w.dayLog.reveals, 1);
  // loud
  a.actsThisTick = 0;
  const loud = one(w, a, { type: 'reveal', letter: 'L1', loud: true });
  assert.equal(loud.cost, 5);
  const got2 = c.inbox.find((i) => i.kind === 'reveal');
  assert.deepEqual([got2.loud, got2.verified], [true, true]);
  assertInvariants(w);
});

test('reveal：loud 遇到蚀时不可用（有驿站时可用，代价 ×2）；雾天按 broadcast 的规则加倍', () => {
  const { w, agents: [a, b] } = world();
  a.place = 'agora';
  letterCmd(w, a, '信');
  w.weather.active.push({ type: 'eclipse', startDay: 0, endDay: 1 });
  const e = a.energy;
  assert.equal(one(w, a, { type: 'reveal', letter: 'L1', loud: true }).error.code, 'disabled_by_weather');
  assert.equal(a.energy, e);
  assert.equal(one(w, a, { type: 'reveal', letter: 'L1' }).ok, true); // 非 loud 不受影响
  w.weather.active.length = 0;
  w.weather.active.push({ type: 'fog', startDay: 0, endDay: 1 });
  assert.equal(one(w, a, { type: 'reveal', letter: 'L1', loud: true }).cost, 10);
  assert.ok(b);
});
