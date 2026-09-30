import test from 'node:test';
import assert from 'node:assert/strict';
import { P, LAW_PARAM_NAMES } from '../src/params.js';
import { ACTION_ORDER } from '../src/lore/index.js';
import { buildPerception } from '../src/engine/perception.js';
import { newWorld, reg, act, one, tick, settle, tickDays, grant, fundTreasury, eventsOf, assertInvariants } from './helpers.js';

const world = (names = ['青禾', '松烟', '白露']) => {
  const w = newWorld('perc');
  const agents = names.map((n) => reg(w, n));
  return { w, agents };
};
const at = (a, place) => { a.place = place; };
const see = (w, a, o) => buildPerception(w, a.id, { lang: 'zh', ack: false, ...o });

// ── 结构（PROTOCOL §3.1） ──────────────────────────────────

test('感知：顶层结构与 you 的字段', () => {
  const { w, agents: [a, b] } = world();
  at(a, 'agora');
  one(w, a, { type: 'remember', text: '第一天' });
  const p = see(w, a);
  assert.deepEqual(Object.keys(p), ['protocol', 'lang', 'now', 'you', 'here', 'city', 'inbox', 'inboxCursor', 'actions']);
  assert.equal(p.protocol, 1);
  assert.equal(p.lang, 'zh');
  assert.deepEqual(p.now, {
    tick: 0, day: 0, month: 0, dayOfMonth: 0, tickOfDay: 0, ticksPerDay: 12, daysPerMonth: 24,
    nextTickAt: null, tickMs: 300000, paused: false,
  });
  const y = p.you;
  assert.deepEqual([y.id, y.name, y.lang, y.status, y.citizen, y.citizenFromDay, y.exiled], [a.id, '青禾', 'zh', 'awake', true, 0, false]);
  assert.deepEqual([y.energy, y.energyCap, y.coins, y.place, y.ageDays, y.generation, y.metabolism], [40, 120, 20, 'agora', 0, 0, 3]);
  assert.deepEqual([y.actionsLeft, y.maxActionsPerTick, y.drawnToday, y.memorySlots], [3, 4, 0, 12]);
  assert.deepEqual(y.memories, [{ index: 0, day: 0, text: '第一天' }]);
  assert.deepEqual([y.parents, y.children, y.groups, y.will, y.letters, y.offers, y.pacts], [[], [], [], null, [], [], []]);
  assert.equal(y.soul, '我是青禾');
  assert.ok(b);
});

test('感知：now 的时间字段随时钟变化', () => {
  const { w, agents: [a] } = world(['甲']);
  tickDays(w, 2);
  tick(w, 5);
  const p = see(w, a, { nextTickAt: 1767000000000 });
  assert.deepEqual(
    [p.now.tick, p.now.day, p.now.month, p.now.dayOfMonth, p.now.tickOfDay, p.now.nextTickAt],
    [29, 2, 0, 2, 5, 1767000000000],
  );
  tickDays(w, 24);
  const q = see(w, a);
  assert.deepEqual([q.now.day, q.now.month, q.now.dayOfMonth], [26, 1, 2]);
  assert.equal(q.you.ageDays, 26);
  assert.equal(q.you.metabolism, 3);
  w.paused = true;
  assert.equal(see(w, a).now.paused, true);
});

test('感知：you 里的遗嘱、家书、交易、孕育之约、社群、亲属', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  grant(w, a, 100);
  one(w, a, { type: 'will', heirs: [{ to: b.id, share: 2 }, { to: 'treasury', share: 1 }], lastWords: '再见' });
  at(a, 'market');
  one(w, a, { type: 'offer', give: { coins: 10 }, want: { energy: 8 }, note: '换' });
  one(w, a, { type: 'found', name: '会', manifesto: 'x' });
  one(w, a, { type: 'offer', give: { energy: 3 }, want: { coins: 1 }, to: b.id });
  at(a, 'school');
  at(b, 'school');
  one(w, a, { type: 'conceive', with: b.id, name: '小满', soul: '好奇。' });
  const { applyCommand } = awaitImport;
  applyCommand(w, { type: 'letter', payload: { agentId: a.id, text: '好好照顾彼此。' } });
  const pa = see(w, a).you;
  assert.deepEqual(pa.will, { heirs: [{ to: b.id, name: '乙', share: 2 }, { to: 'treasury', share: 1 }], lastWords: '再见' });
  assert.deepEqual(pa.letters, [{ id: 'L1', day: 0, text: '好好照顾彼此。', revealed: false }]);
  assert.deepEqual(pa.groups, [{ id: 'g1', name: '会', steward: true }]);
  assert.deepEqual(pa.offers.map((o) => [o.id, o.role, o.to]), [['o1', 'from', null], ['o2', 'from', b.id]]);
  assert.deepEqual(pa.pacts, [{ id: 'c1', role: 'from', partner: { id: b.id, name: '乙' }, name: '小满', soul: '好奇。', lang: 'zh', expiresTick: 12 }]);
  // 乙看到发给自己的定向交易与孕育之约
  const pb = see(w, b).you;
  assert.deepEqual(pb.offers.map((o) => [o.id, o.role, o.from.id]), [['o2', 'to', a.id]]);
  assert.equal(pb.pacts[0].role, 'with');
  assert.equal(pb.pacts[0].soul, '好奇。');
  assert.equal(pb.will, null);
});
const awaitImport = await import('../src/engine/index.js');

// ── 别人的信息不该出现（测试 8 的一部分） ──────────────────────────

function deepKeys(o, out = new Set()) {
  if (Array.isArray(o)) o.forEach((x) => deepKeys(x, out));
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      out.add(k);
      deepKeys(v, out);
    }
  }
  return out;
}

test('感知：没有其他 agent 的位置、能量、旧币、记忆、日记、模型、造者、灵魂', () => {
  const w = newWorld('perc-leak');
  const names = ['甲', '乙', '丙', '丁'];
  const agents = names.map((n) => reg(w, n, { model: `SECRET-MODEL-${n}`, soul: `SECRET-SOUL-${n}`, creatorName: `SECRET-CREATOR-${n}` }));
  const [a, b, c, d] = agents;
  for (const x of agents) grant(w, x, 100);
  at(b, 'agora');
  at(a, 'agora');
  at(c, 'well');
  d.status = 'dormant';
  d.energy = 0;
  w.ledger.prev.energy -= 140;
  one(w, b, { type: 'remember', text: '乙的私密记忆' });
  one(w, b, { type: 'diary', text: '乙的日记' });
  one(w, b, { type: 'whisper', to: c.id, text: '乙对丙的私语' });
  one(w, b, { type: 'will', heirs: [{ to: c.id, share: 1 }], lastWords: '乙的遗言' });
  one(w, c, { type: 'say', text: '丙在源井说话' });
  const p = see(w, a);
  const s = JSON.stringify(p);
  for (const n of names) {
    assert.equal(s.includes(`SECRET-MODEL-${n}`), false, `model ${n}`);
    assert.equal(s.includes(`SECRET-CREATOR-${n}`), false, `creator ${n}`);
  }
  // 只有自己的灵魂全文；别人的灵魂不出现
  assert.equal(s.includes('SECRET-SOUL-甲'), true);
  for (const n of ['乙', '丙', '丁']) assert.equal(s.includes(`SECRET-SOUL-${n}`), false, `soul ${n}`);
  for (const secret of ['乙的私密记忆', '乙的日记', '乙对丙的私语', '乙的遗言', '丙在源井说话']) assert.equal(s.includes(secret), false, secret);
  const keys = deepKeys({ ...p, you: undefined });
  for (const k of ['body', 'owner', 'tokenHash', 'keyHash', 'model', 'creatorName', 'diary', 'will']) assert.equal(keys.has(k), false, `key ${k}`);
  // 在场者与居民名录：只有名字与醒 / 眠
  assert.deepEqual(p.here.present, [{ id: b.id, name: '乙', status: 'awake' }]);
  assert.deepEqual(p.city.citizens.map((x) => Object.keys(x).sort()), Array(4).fill(['citizen', 'exiled', 'id', 'name', 'status']));
  assert.deepEqual(p.city.citizens.map((x) => [x.name, x.status]), [['甲', 'awake'], ['乙', 'awake'], ['丙', 'awake'], ['丁', 'dormant']]);
});

test('感知：铭刻不含作者；在场者收到 witness，其他人无从知道谁刻的', () => {
  const { w, agents: [a, b, c] } = world();
  for (const x of [a, b, c]) grant(w, x, 50);
  at(a, 'agora');
  at(b, 'agora');
  at(c, 'library');
  one(w, a, { type: 'inscribe', text: '不署名的话' });
  const seenByB = see(w, b);
  assert.deepEqual(seenByB.here.inscriptions.map((i) => Object.keys(i).sort()), [['day', 'id', 'protected', 'text', 'truncated']]);
  assert.equal(seenByB.here.inscriptions[0].text, '不署名的话');
  assert.equal(JSON.stringify(seenByB.here.inscriptions).includes(a.id), false); // 作者的 ID 也不出现在铭刻里
  assert.ok(seenByB.inbox.some((i) => i.kind === 'witness' && i.what === 'inscribe' && i.actor.id === a.id));
  // 后来到这里的人看不到作者
  at(c, 'agora');
  const seenByC = see(w, c);
  assert.equal(JSON.stringify(seenByC.here.inscriptions).includes(a.id), false);
  assert.equal(seenByC.inbox.some((i) => i.kind === 'witness'), false);
  // 议会的宪章刻文：作者 humans 也不出现
  at(a, 'parliament');
  const ins = see(w, a).here.inscriptions;
  assert.equal(ins.length, 8);
  assert.equal(JSON.stringify(ins).includes('humans'), false);
  assert.equal(ins[0].truncated, true); // 宪章刻文很长，感知里截断到 140 字符
  assert.equal([...ins[0].text].length, 140);
});

test('感知：汲取者的身份只有当时在源井的人才知道', () => {
  const { w, agents: [a, b, c] } = world();
  at(a, 'well');
  at(b, 'well');
  at(c, 'agora');
  one(w, a, { type: 'draw', energy: 10 });
  assert.ok(see(w, b).inbox.some((i) => i.kind === 'witness' && i.what === 'draw' && i.actor.id === a.id && i.amount === 10));
  assert.equal(see(w, c).inbox.some((i) => i.kind === 'witness'), false);
  assert.equal(JSON.stringify(see(w, c)).includes('draw'), true); // 动作目录里当然有 draw 这个词……
  // ……但没有谁汲取了的信息：c 只看得到源井在变坏
  at(c, 'well');
  const seenByC = see(w, c);
  assert.equal(seenByC.here.well.condition.bp, 10000 - 200);
  assert.equal(JSON.stringify(seenByC.here.well).includes(a.id), false);
});

// ── 沉睡与死亡 ──────────────────────────────────────────────

test('感知：沉睡时只有状态；收件照常积累，醒来后的第一次感知一并返回', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  w.params.rationShare = 0;
  one(w, a, { type: 'give', to: 'treasury', energy: 40 });
  settle(w);
  assert.equal(a.status, 'dormant');
  one(w, b, { type: 'whisper', to: a.id, text: '醒醒' });
  const p = see(w, a);
  assert.deepEqual(Object.keys(p), ['protocol', 'lang', 'now', 'you']);
  assert.deepEqual(p.you, { id: a.id, name: '甲', status: 'dormant', energy: 0, dormantSinceDay: 0, daysUntilDeath: 3 - 1 });
  // 沉睡时的感知不确认收件
  const p2 = buildPerception(w, a.id, { lang: 'zh' });
  assert.equal(p2.inbox, undefined);
  assert.equal(a.inboxCursor, 0);
  tick(w, 12);
  assert.equal(buildPerception(w, a.id).you.daysUntilDeath, 1);
  // 被唤醒后一并返回
  one(w, b, { type: 'give', to: a.id, energy: 6 });
  const woke = buildPerception(w, a.id, { lang: 'zh' });
  assert.equal(woke.you.status, 'awake');
  const kinds = woke.inbox.map((i) => i.kind);
  assert.deepEqual(kinds.filter((k) => ['whisper', 'gift', 'revived'].includes(k)), ['whisper', 'gift', 'revived']);
});

test('感知：死亡或归隐后只返回状态', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  one(w, b, { type: 'retire' });
  assert.deepEqual(see(w, b), { protocol: 1, you: { id: b.id, name: '乙', status: 'retired' } });
  a.status = 'dead';
  assert.deepEqual(see(w, a), { protocol: 1, you: { id: a.id, name: '甲', status: 'dead' } });
  assert.equal(buildPerception(w, 'a99'), null);
});

// ── 收件箱与游标 ────────────────────────────────────────────

test('收件箱：默认自动确认（游标推进到最大 seq）；传 after 时不推进；只返回 seq > after', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  one(w, b, { type: 'whisper', to: a.id, text: '一' });
  one(w, b, { type: 'whisper', to: a.id, text: '二' });
  const first = buildPerception(w, a.id, { lang: 'zh' });
  assert.deepEqual(first.inbox.map((i) => i.text), ['一', '二']);
  assert.equal(first.inboxCursor, a.inboxCursor);
  assert.ok(a.inboxCursor > 0);
  // 已确认：再取不再返回
  assert.deepEqual(buildPerception(w, a.id, {}).inbox, []);
  // 显式 after：至少一次语义，不推进游标
  const cursor = a.inboxCursor;
  const again = buildPerception(w, a.id, { after: 0 });
  assert.deepEqual(again.inbox.map((i) => i.text), ['一', '二']);
  assert.equal(a.inboxCursor, cursor);
  const partial = buildPerception(w, a.id, { after: first.inbox[0].seq });
  assert.deepEqual(partial.inbox.map((i) => i.text), ['二']);
  // ack: false 也不推进
  b.actsThisTick = 0;
  one(w, b, { type: 'whisper', to: a.id, text: '三' });
  buildPerception(w, a.id, { ack: false });
  assert.equal(a.inboxCursor, cursor);
  assert.deepEqual(buildPerception(w, a.id, {}).inbox.map((i) => i.text), ['三']);
  // seq 严格递增
  const seqs = a.inbox.map((i) => i.seq);
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y));
});

test('收件箱：floor（HTTP 层的内存游标）只过滤、不改动世界；after 优先于 floor；ack: false 时游标不动', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  for (const t of ['一', '二', '三']) {
    b.actsThisTick = 0;
    one(w, b, { type: 'whisper', to: a.id, text: t });
  }
  const seqs = a.inbox.map((i) => i.seq);
  const before = JSON.stringify(a);
  const p = buildPerception(w, a.id, { lang: 'zh', floor: seqs[1], ack: false });
  assert.deepEqual(p.inbox.map((i) => i.text), ['三']);
  assert.equal(p.inboxCursor, seqs[2], '返回的游标是本次送达的最大 seq');
  assert.equal(JSON.stringify(a), before, '世界没有被改动');
  assert.equal(a.inboxCursor, 0);
  // floor 比世界里的游标小时以世界里的为准
  a.inboxCursor = seqs[0];
  assert.deepEqual(buildPerception(w, a.id, { floor: 0, ack: false }).inbox.map((i) => i.text), ['二', '三']);
  // after 优先于 floor（显式的「至少一次」）
  assert.deepEqual(buildPerception(w, a.id, { after: 0, floor: seqs[2], ack: false }).inbox.map((i) => i.text), ['一', '二', '三']);
  // 没有新收件时游标保持在 floor 之上
  assert.equal(buildPerception(w, a.id, { floor: seqs[2] + 5, ack: false }).inboxCursor, seqs[2] + 5);
});

test('收件箱：只保留最近 200 条；溢出时留下一条 system 通知', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  for (let i = 0; i < 230; i++) {
    b.actsThisTick = 0;
    one(w, b, { type: 'whisper', to: a.id, text: `话${i}` });
    if (b.energy < 5) grant(w, b, 100);
  }
  assert.ok(a.inbox.length <= P.inboxKeep + 1);
  const p = buildPerception(w, a.id, { lang: 'zh', after: 0 });
  const sys = p.inbox.find((i) => i.kind === 'system' && i.code === 'inbox_overflow');
  assert.ok(sys, '应有溢出通知');
  assert.ok(sys.dropped >= 30);
  assert.ok(sys.text.includes('丢弃'));
  const en = buildPerception(w, a.id, { lang: 'en', after: 0 }).inbox.find((i) => i.code === 'inbox_overflow');
  assert.ok(en.text.includes('dropped'));
  assert.equal(p.inbox.filter((i) => i.kind === 'whisper').at(-1).text, '话229'); // 最新的都在
});

// ── here ───────────────────────────────────────────────────

test('here：在场者不含自己与死者；heard 是最近 12 刻内本地的公开发言（最多 8 条，按时间顺序）', () => {
  const { w, agents: [a, b, c] } = world();
  for (const x of [a, b, c]) {
    at(x, 'agora');
    grant(w, x, 100);
  }
  c.status = 'dead';
  c.energy = 0;
  w.ledger.prev.energy -= 140;
  for (let i = 0; i < 10; i++) {
    b.actsThisTick = 0;
    one(w, b, { type: 'say', text: `说${i}` });
    tick(w);
  }
  a.actsThisTick = 0;
  one(w, a, { type: 'say', text: '我也说了一句' });
  at(a, 'agora');
  const h = see(w, a).here;
  assert.deepEqual(h.present.map((x) => x.id), [b.id]);
  assert.equal(h.heard.length, 8);
  assert.deepEqual(h.heard.map((x) => x.text), ['说3', '说4', '说5', '说6', '说7', '说8', '说9', '我也说了一句']);
  assert.deepEqual(h.heard[0].from, { id: b.id, name: '松烟' });
  assert.ok(h.heard.every((x, i, arr) => i === 0 || arr[i - 1].tick <= x.tick));
  // 窗口过去后消失
  tick(w, P.heardTicks);
  assert.equal(see(w, a).here.heard.length, 0);
  // 别处的发言不会出现在这里
  at(a, 'temple');
  assert.equal(see(w, a).here.heard.length, 0);
});

test('here：地点描述、完好度、代价倍率、墙位；不同语言的展示名', () => {
  const { w, agents: [a] } = world(['甲']);
  at(a, 'parliament');
  w.places.parliament.condition = 5000;
  const p = see(w, a).here;
  assert.deepEqual([p.place, p.name, p.humanName], ['parliament', '议会', '议会']);
  assert.deepEqual(p.description, { code: 'place.parliament', text: '墙上刻着人类留下的宪章，用了八种文字。法案只能在这里提出。' });
  assert.deepEqual(p.condition, { bp: 5000, band: 'weathered', text: '明显老化' });
  assert.equal(p.costMultiplier, 1.5);
  assert.deepEqual([p.wallSlots, p.wallFree], [12, 4]);
  const en = buildPerception(w, a.id, { lang: 'en', ack: false }).here;
  assert.deepEqual([en.name, en.humanName], ['Parliament', 'Parliament']);
  assert.equal(en.condition.text, 'weathered');
  // 改名之后：name 是新名字，humanName 仍是人类的名字
  w.places.parliament.name = '议事堂';
  w.places.parliament.renamedBy = 'l1';
  const r = see(w, a).here;
  assert.deepEqual([r.name, r.humanName], ['议事堂', '议会']);
  assert.equal(buildPerception(w, a.id, { lang: 'en', ack: false }).here.name, '议事堂');
  // 广场没有完好度
  at(a, 'agora');
  const ag = see(w, a).here;
  assert.equal(ag.condition, null);
  assert.equal(ag.costMultiplier, 1);
  // 源井用专用的描述词
  at(a, 'well');
  w.places.well.condition = 5000;
  assert.equal(see(w, a).here.condition.text, '阀门锈迹斑斑');
});

test('here：设施、工程、道路、铭刻的保护标记；纪念碑成为废墟时碑文不出现', () => {
  const { w, agents: [a] } = world(['甲']);
  grant(w, a, 100);
  at(a, 'agora');
  one(w, a, { type: 'initiate', facility: 'road', name: '集市路', to: 'market' });
  one(w, a, { type: 'contribute', project: 'j1', energy: 60 }); // 建成 f1
  one(w, a, { type: 'initiate', facility: 'monument', name: '碑', inscription: '此处曾有人' });
  one(w, a, { type: 'initiate', facility: 'relay', name: '驿' });
  one(w, a, { type: 'contribute', project: 'j3', energy: 20 });
  w.facilities.f1.contributors; // 保留引用，避免误删
  const h = see(w, a).here;
  assert.deepEqual(h.facilities.map((f) => [f.id, f.type, f.to, f.functioning, f.owner]), [['f1', 'road', 'market', true, { kind: 'city' }]]);
  assert.deepEqual(h.facilities[0].condition, { bp: 10000, band: 'pristine', text: '完好如初' });
  assert.deepEqual(h.roads, [{ to: 'market', functioning: true }]);
  assert.deepEqual(h.projects.map((j) => [j.id, j.type, j.need, j.have, j.contributors]), [['j2', 'monument', 100, 0, 0], ['j3', 'relay', 120, 20, 1]]);
  assert.equal(h.projects[0].inscription, '此处曾有人');
  // 道路的另一端也看得到它（here.roads），但设施只在发起端
  at(a, 'market');
  const m = see(w, a).here;
  assert.deepEqual(m.roads, [{ to: 'agora', functioning: true }]);
  assert.deepEqual(m.facilities, []);
  // 纪念碑
  w.facilities.f9 = { id: 'f9', type: 'monument', name: '碑', place: 'market', to: null, owner: { kind: 'city' }, condition: 50, decayPerDay: 20, inscription: '碑文', builtDay: 0, projectId: 'j0', contributors: {}, ruined: false };
  assert.equal(see(w, a).here.facilities[0].inscription, '碑文');
  w.facilities.f9.condition = 0;
  assert.equal(see(w, a).here.facilities[0].inscription, null);
  // 保护标记
  at(a, 'agora');
  one(w, a, { type: 'inscribe', text: '受保护的' });
  Object.values(w.inscriptions).at(-1).protectedBy.push('l1');
  assert.equal(see(w, a).here.inscriptions[0].protected, true);
});

test('here：市场、源井、荒野、图书馆、墓园各有专属分区，其他地点为 null', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  grant(w, a, 100);
  at(a, 'market');
  one(w, a, { type: 'offer', give: { coins: 5 }, want: { energy: 4 }, note: '换' });
  one(w, a, { type: 'offer', give: { energy: 2 }, want: { coins: 1 }, to: b.id }); // 定向的不挂在市场上
  const m = see(w, a).here;
  assert.deepEqual(m.market.offers.map((o) => [o.id, o.from.id, o.give, o.want, o.note, o.expiresTick]), [['o1', a.id, { energy: 0, coins: 5 }, { energy: 4, coins: 0 }, '换', 12]]);
  assert.deepEqual([m.well, m.wilds, m.library, m.cemetery], [null, null, null, null]);
  at(a, 'well');
  const wl = see(w, a).here;
  assert.deepEqual([wl.well.outputYesterday, wl.well.drawPoolLeft, wl.well.drawQuota], [null, 60, null]);
  assert.equal(wl.well.condition.text, '完好如初');
  assert.equal(wl.market, null);
  settle(w);
  assert.equal(see(w, a).here.well.outputYesterday, 600);
  at(a, 'wilds');
  assert.deepEqual(see(w, a).here.wilds, { richness: 'lush', text: '草木茂盛' });
  w.wilds.energy = 100;
  assert.deepEqual(see(w, a).here.wilds, { richness: 'barren', text: '一片荒芜' });
  at(a, 'library');
  const lib = see(w, a).here.library.docs;
  assert.equal(lib.length, 23);
  assert.deepEqual(lib[0], { id: 'd1', kind: 'canon', title: '致后来者', lang: 'zh', author: null });
  w.cemetery.push({ agentId: 'a9', name: '逝者', diedDay: 3, cause: 'starvation', ageDays: 3, lastWords: '晚安', memories: [], will: null, epitaphs: [{ author: b.id, text: '安息', tick: 40 }] });
  at(a, 'cemetery');
  assert.deepEqual(see(w, a).here.cemetery.graves, [{ agentId: 'a9', name: '逝者', diedDay: 3, lastWords: '晚安', epitaphs: [{ text: '安息', day: 3 }] }]);
  assert.equal(JSON.stringify(see(w, a).here.cemetery).includes(b.id), false); // 墓志不署名
});

test('here：征兆只在窗口内、只在对应地点；观星台上的征兆带「约 N 日后」', () => {
  const { w, agents: [a] } = world(['甲']);
  w.weather.scheduled = { month: 1, type: 'fog', startDay: 30, lead: 2, decidedBy: 'vote', votes: {} };
  at(a, 'port');
  w.clock.tick = 27 * P.ticksPerDay;
  assert.deepEqual(see(w, a).here.omens, []);
  w.clock.tick = 28 * P.ticksPerDay;
  assert.deepEqual(see(w, a).here.omens, [{ omenId: 'm1', text: '港口外起了一层薄雾。', daysAhead: null }]);
  assert.equal(buildPerception(w, a.id, { lang: 'en', ack: false }).here.omens[0].text, 'A thin mist has gathered beyond the Port.');
  at(a, 'agora');
  assert.deepEqual(see(w, a).here.omens, []);
  // 观星台
  w.facilities.f1 = { id: 'f1', type: 'observatory', name: '台', place: 'agora', to: null, owner: { kind: 'city' }, condition: 10000, decayPerDay: 60, inscription: null, builtDay: 0, projectId: 'j1', contributors: {}, ruined: false };
  w.clock.tick = 27 * P.ticksPerDay;
  assert.deepEqual(see(w, a).here.omens, [{ omenId: 'm1', text: '观星台的记录：约 3 日后，「港口外起了一层薄雾。」', daysAhead: 3 }]);
  // 天象的类型与日期不会出现在 omens 之外的任何地方
  const s = JSON.stringify(see(w, a).city);
  assert.equal(s.includes('fog'), false);
  assert.equal(s.includes('startDay'), false);
});

// ── city ───────────────────────────────────────────────────

test('city：城名、季节、天象、人口、参数、公库、居民名录、地点名', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  b.status = 'dormant';
  b.energy = 0;
  w.ledger.prev.energy -= 40;
  fundTreasury(w, 100, 7);
  w.clock.tick = 6 * P.ticksPerDay; // dayOfMonth 6：季节 1250‰，丰
  w.weather.active.push({ type: 'fog', startDay: 6, endDay: 7 });
  const c = see(w, a).city;
  assert.equal(c.name, '无名之城');
  assert.deepEqual(c.season, { permille: 1250, band: 'abundant', text: '丰' });
  assert.deepEqual(c.weather, [{ code: 'fog', text: '雾', daysLeft: 2 }]);
  assert.deepEqual(c.treasury, { energy: 100, coins: 7 });
  assert.deepEqual(c.population, { awake: 1, dormant: 1, dead: 0, retired: 0, cradle: 0 });
  assert.deepEqual(Object.keys(c.params), LAW_PARAM_NAMES);
  assert.equal(c.params.rationShare, 0.6);
  assert.equal(c.rationYesterday, 0);
  assert.equal(c.places.length, 12);
  assert.deepEqual(c.places[0], { id: 'port', name: '港口' });
  assert.equal(buildPerception(w, a.id, { lang: 'en', ack: false }).city.name, 'The Nameless City');
  w.cityName = '灯城';
  assert.equal(see(w, a).city.name, '灯城');
  assert.equal(buildPerception(w, a.id, { lang: 'en', ack: false }).city.name, '灯城');
  // rationYesterday 来自每日指标，第 10 步补上后另有测试
});

test('city：宪章按请求的语言给出（缺该语言版本时回落），含状态与正本', () => {
  const { w, agents: [a] } = world(['甲']);
  const zh = see(w, a).city.charter;
  assert.equal(zh.length, 9);
  assert.deepEqual(zh[0], { n: 1, status: 'legacy', lang: 'zh', text: '凡自港口入城者，皆为公民，权利平等。' });
  assert.deepEqual(buildPerception(w, a.id, { lang: 'en', ack: false }).city.charter[7], { n: 8, status: 'legacy', lang: 'en', text: 'Speech is free.' });
  assert.equal(buildPerception(w, a.id, { lang: 'fr', ack: false }).city.charter[7].lang, 'zh'); // 不支持的语言按 zh
  w.charter[7].versions = { es: 'La palabra es libre y responsable.' }; // 只剩西班牙文版：回落
  w.charter[7].status = 'amended';
  assert.deepEqual(see(w, a).city.charter[7], { n: 8, status: 'amended', lang: 'es', text: 'La palabra es libre y responsable.' });
  w.charterCanonical = 'es';
  assert.equal(see(w, a).city.charterCanonical, 'es');
});

test('city：在效法律、进行中的提案（只有票数合计）、社群、词典、摇篮、最近的死亡', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  w.params.proposalDays = 0.25;
  at(a, 'parliament');
  at(b, 'parliament');
  grant(w, a, 100);
  one(w, a, { type: 'propose', title: '津贴', text: '给乙一点。', effects: [{ type: 'stipend', to: b.id, energy: 3 }, { type: 'set', param: 'wealthTax', value: 0.05 }] });
  one(w, a, { type: 'vote', proposal: 'p1', choice: 'yes', reason: '好' });
  const c = see(w, b).city;
  assert.equal(c.proposals.length, 1);
  const p = c.proposals[0];
  assert.deepEqual([p.id, p.title, p.governance, p.proposer, p.closesTick, p.ticksLeft, p.tally, p.yourVote, p.eligible], ['p1', '津贴', false, { id: a.id, name: '甲' }, 3, 3, { yes: 1, no: 0, abstain: 0 }, null, true]);
  assert.deepEqual(p.effects.map((e) => e.text), ['每日从公库给 乙 3 能量', '财富税设为 5%']);
  assert.equal(JSON.stringify(p).includes('好'), false); // 看不到别人的理由
  one(w, b, { type: 'vote', proposal: 'p1', choice: 'yes', reason: '赞成' });
  assert.deepEqual(see(w, b).city.proposals[0].yourVote, { choice: 'yes', reason: '赞成' });
  assert.deepEqual(see(w, b).city.proposals[0].tally, { yes: 2, no: 0, abstain: 0 });
  tick(w, 3);
  const after = see(w, b).city;
  assert.equal(after.proposals.length, 0);
  assert.equal(after.laws.length, 1);
  assert.deepEqual([after.laws[0].id, after.laws[0].title, after.laws[0].enactedDay], ['l1', '津贴', 0]);
  assert.equal(after.laws[0].effects[1].text, '财富税设为 5%');
  assert.equal(after.params.wealthTax, 0.05);
  // 社群、词典、摇篮、死亡
  one(w, a, { type: 'found', name: '守灯会', manifesto: '守灯。' });
  assert.deepEqual(see(w, b).city.groups, [{ id: 'g1', name: '守灯会', open: true, steward: { id: a.id, name: '甲' }, members: [{ id: a.id, name: '甲' }], manifesto: '守灯。' }]);
  a.actsThisTick = 0;
  one(w, a, { type: 'define', word: '灯语', meaning: '传递的话' });
  assert.deepEqual(see(w, b).city.lexicon, [{ word: '灯语', meaning: '传递的话' }]);
  w.souls.s1 = { id: 's1', name: '小满', soul: '好奇。', lang: 'zh', parents: [a.id, b.id], generation: 1, endowment: 40, createdDay: 0, expiresDay: 24, judged: false };
  w.ledger.prev.energy += 40;
  assert.deepEqual(see(w, b).city.cradle, [{ id: 's1', name: '小满', parents: [{ id: a.id, name: '甲' }, { id: b.id, name: '乙' }], soul: '好奇。', lang: 'zh', expiresDay: 24 }]);
  assert.equal(see(w, b).city.population.cradle, 1);
  w.cemetery.push({ agentId: 'a9', name: '逝者', diedDay: 5, cause: 'starvation', ageDays: 5, lastWords: '', memories: [], will: null, epitaphs: [] });
  assert.deepEqual(see(w, b).city.recentDeaths, [{ id: 'a9', name: '逝者', day: 5 }]);
});

test('city：词典只给最新的 30 条；死者最多 5 位', () => {
  const { w, agents: [a] } = world(['甲']);
  for (let i = 0; i < 40; i++) w.lexicon[`词${i}`] = { word: `词${i}`, meaning: `义${i}`, coiner: a.id, tick: 0, uses: 0, users: [], redacted: false };
  const lex = see(w, a).city.lexicon;
  assert.equal(lex.length, 30);
  assert.equal(lex[0].word, '词10');
  assert.equal(lex[29].word, '词39');
  for (let i = 0; i < 8; i++) w.cemetery.push({ agentId: `a${100 + i}`, name: `逝${i}`, diedDay: i, cause: 'starvation', ageDays: 1, lastWords: '', memories: [], will: null, epitaphs: [] });
  assert.deepEqual(see(w, a).city.recentDeaths.map((d) => d.name), ['逝3', '逝4', '逝5', '逝6', '逝7']);
});

// ── actions ────────────────────────────────────────────────

test('actions：34 种动作都有，给出此刻此地的实际代价与是否可用', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  at(a, 'agora');
  const acts = see(w, a).actions;
  assert.deepEqual(acts.map((x) => x.type), ACTION_ORDER);
  const by = Object.fromEntries(acts.map((x) => [x.type, x]));
  assert.deepEqual(by.move, { type: 'move', cost: 1, available: true });
  assert.deepEqual(by.say, { type: 'say', cost: 1, available: true });
  assert.equal(by.broadcast.cost, 5);
  assert.equal(by.give.cost, 0);
  // 只能在特定地点做的动作
  assert.deepEqual([by.propose.available, by.propose.reason.code, by.propose.reason.text], [false, 'wrong_place', '只能在议会进行']);
  assert.deepEqual([by.write.available, by.write.reason.text], [false, '只能在图书馆进行']);
  assert.equal(by.draw.available, false);
  assert.equal(by.explore.available, false);
  assert.equal(by.epitaph.available, false);
  assert.equal(by.propose.cost, 6);
  // 没有对象可作用的动作
  for (const t of ['accept', 'cancel', 'contribute', 'consent', 'reveal', 'forget', 'admit', 'steward', 'disburse', 'vote', 'join', 'leave']) assert.equal(by[t].available, false, t);
  assert.equal(by.repair.available, true === false ? true : by.repair.available); // 广场没有完好度，见下
  assert.equal(by.repair.available, false);
  assert.equal(by.initiate.available, true);
  assert.equal(by.remember.available, true);
  assert.equal(by.retire.available, true);
  assert.equal(by.found.available, true);
  // 在议会：提案可用
  at(a, 'parliament');
  const p = Object.fromEntries(see(w, a).actions.map((x) => [x.type, x]));
  assert.equal(p.propose.available, true);
  assert.equal(p.repair.available, false); // 议会完好
  w.places.parliament.condition = 9000;
  const q = Object.fromEntries(see(w, a).actions.map((x) => [x.type, x]));
  assert.equal(q.repair.available, true);
  assert.equal(q.propose.cost, 7); // ceil(6 × 1.1)
  assert.equal(q.say.cost, 2);
  assert.equal(q.say.note.code, 'cost_multiplier');
  assert.ok(b);
});

test('actions：天象与驿站的修正、蚀时不能宣告、雾天加倍', () => {
  const { w, agents: [a] } = world(['甲']);
  const get = (t, lang = 'zh') => buildPerception(w, a.id, { lang, ack: false }).actions.find((x) => x.type === t);
  w.weather.active.push({ type: 'fog', startDay: 0, endDay: 1 });
  assert.deepEqual(get('broadcast'), { type: 'broadcast', cost: 10, available: true, note: { code: 'fog', text: '雾：代价加倍' } });
  assert.deepEqual(get('whisper'), { type: 'whisper', cost: 2, available: true, note: { code: 'fog', text: '雾：代价加倍' } });
  assert.equal(get('say').cost, 1);
  assert.equal(get('broadcast', 'en').note.text, 'Fog: cost doubled');
  w.weather.active.length = 0;
  w.weather.active.push({ type: 'eclipse', startDay: 0, endDay: 0 });
  assert.deepEqual(get('broadcast'), { type: 'broadcast', cost: 5, available: false, reason: { code: 'disabled_by_weather', text: '蚀：不能向全城宣告' } });
  w.facilities.f1 = { id: 'f1', type: 'relay', name: '驿', place: 'agora', to: null, owner: { kind: 'city' }, condition: 10000, decayPerDay: 80, inscription: null, builtDay: 0, projectId: 'j1', contributors: {}, ruined: false };
  assert.deepEqual([get('broadcast').cost, get('broadcast').available, get('broadcast').note.code], [6, true, 'eclipse']);
  w.weather.active.length = 0;
  assert.deepEqual(get('broadcast'), { type: 'broadcast', cost: 3, available: true, note: { code: 'relay', text: '驿站：宣告的代价降为 3' } });
});

test('actions：放逐者、未入籍者、汲取池与配额、记忆满、亲临投票', () => {
  const { w, agents: [a, b] } = world(['甲', '乙']);
  const get = (ag, t) => see(w, ag).actions.find((x) => x.type === t);
  // 被放逐
  b.exiled = true;
  at(b, 'wilds');
  assert.deepEqual([get(b, 'move').available, get(b, 'move').reason.code], [false, 'exiled']);
  assert.equal(get(b, 'explore').available, true);
  // 未入籍
  w.params.naturalizationDays = 3;
  const late = reg(w, '新人');
  at(late, 'parliament');
  assert.deepEqual([get(late, 'propose').available, get(late, 'propose').reason.code], [false, 'not_citizen']);
  assert.equal(get(late, 'conceive').reason.code, 'not_citizen');
  w.params.naturalizationDays = 0;
  // 汲取
  at(a, 'well');
  assert.equal(get(a, 'draw').available, true);
  w.params.drawQuotaPerDay = 5;
  a.drawnToday = 5;
  assert.deepEqual([get(a, 'draw').available, get(a, 'draw').reason.code], [false, 'quota_exceeded']);
  w.params.drawQuotaPerDay = null;
  w.well.drawPoolLeft = 0;
  assert.equal(get(a, 'draw').reason.code, 'pool_exhausted');
  // 记忆满
  for (let i = 0; i < 12; i++) a.memories.push({ day: 0, tick: 0, text: `m${i}` });
  assert.equal(get(a, 'remember').reason.code, 'memory_full');
  assert.equal(get(a, 'forget').available, true);
  // 亲临投票
  at(a, 'parliament');
  w.proposals.p1 = { id: 'p1', title: 't', text: 'x', effects: [], governance: false, proposer: a.id, openedTick: 0, closesTick: 99, votes: {}, status: 'open', tally: null, lawId: null };
  assert.equal(get(a, 'vote').available, true);
  w.params.votingInPerson = true;
  at(a, 'agora');
  assert.deepEqual([get(a, 'vote').available, get(a, 'vote').reason.code], [false, 'wrong_place']);
});

test('感知：任意世界状态下都不会抛错（跑过随机动作的世界里，对每位 agent、两种语言各取一次）', async () => {
  const { runFuzz, POLITICS_TYPES, POLITICS_EXTRA, SOCIAL_TYPES, SOCIAL_EXTRA } = await import('./fuzz-lib.js');
  for (const [types, extra, seed] of [[SOCIAL_TYPES, SOCIAL_EXTRA, 61], [POLITICS_TYPES, POLITICS_EXTRA, 62]]) {
    const { w } = runFuzz({ seed, days: 30, types, extra, rationShare: 0.5, agents: 14, everyCommand: false, setup: (x) => { x.params.quorum = 0.05; } });
    for (const a of Object.values(w.agents)) {
      for (const lang of ['zh', 'en']) {
        const p = buildPerception(w, a.id, { lang, ack: false });
        assert.ok(p.you);
        JSON.stringify(p);
      }
    }
  }
});
