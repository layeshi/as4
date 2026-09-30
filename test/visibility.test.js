import test from 'node:test';
import assert from 'node:assert/strict';
import { P, PLACE_IDS } from '../src/params.js';
import { applyCommand } from '../src/engine/index.js';
import { publicState, publicAgent, publicMemories, publicPlace, publicDoc, publicWeather, publicEvent, ownerEvent } from '../src/engine/visibility.js';
import { newWorld, reg, sha, one, tick, tickDays, grant, eventsOf } from './helpers.js';
import { runFuzz, SOCIAL_TYPES, SOCIAL_EXTRA } from './fuzz-lib.js';

/** 跑一个内容丰富的世界，并给每位居民埋下「不得公开」的哨兵字符串 */
function richWorld(seed = 71) {
  const { w } = runFuzz({
    seed, days: 40, types: SOCIAL_TYPES, extra: SOCIAL_EXTRA, rationShare: 0.5, agents: 16, everyCommand: false,
    setup: (world) => {
      world.$fuzzHook = (t) => {
        if (t % 25 === 3) {
          const a = Object.values(world.agents).find((x) => x.status === 'awake' && x.lastLetterDay === null);
          if (a) applyCommand(world, { type: 'letter', payload: { agentId: a.id, text: '秘密家书文本' } });
        }
        if (t % 35 === 5) {
          const soul = Object.values(world.souls)[0];
          if (soul) applyCommand(world, { type: 'adopt', payload: { soulId: soul.id, model: 'SECRET-MODEL-ADOPTED', creatorName: 'SECRET-CREATOR-ADOPTED', tokenHash: sha(`t${soul.id}`), ownerKeyHash: sha(`k${soul.id}`) } });
        }
      };
    },
  });
  const secrets = [];
  for (const a of Object.values(w.agents)) {
    if (a.generation === 0) {
      a.body.model = `SECRET-MODEL-${a.id}`;
      a.soul = `SECRET-SOUL-${a.id}`;
      secrets.push(a.body.model, a.soul);
    } else {
      a.soul = `PUBLIC-SOUL-${a.id}`; // agent 书写的灵魂是公开的
    }
    if (a.owner) {
      a.owner.creatorName = `SECRET-CREATOR-${a.id}`;
      secrets.push(a.owner.creatorName);
    }
    secrets.push(`SECRET-MODEL-ADOPTED`, `SECRET-CREATOR-ADOPTED`);
    secrets.push(a.tokenHash);
    if (a.owner) secrets.push(a.owner.keyHash);
    for (const l of a.letters) secrets.push(l.text);
    for (const d of a.diary) secrets.push(d.text);
  }
  return { w, secrets: [...new Set(secrets.filter(Boolean))] };
}

// ── 谢幕前的保密（SPEC §0.3 第 3 条） ───────────────────────────

test('可见性：谢幕前，公共状态与每个公共视图里没有模型、人类书写的灵魂、造者署名、令牌与密钥哈希、家书与日记', () => {
  const { w, secrets } = richWorld();
  assert.ok(secrets.length > 30);
  assert.ok(Object.values(w.agents).some((a) => a.generation >= 1), '需要有领养出来的 agent');
  const views = {
    state: publicState(w, { nextTickAt: 1 }),
    agents: Object.values(w.agents).map((a) => publicAgent(w, a)),
    places: PLACE_IDS.map((id) => publicPlace(w, id)),
    docs: Object.keys(w.docs).map((id) => publicDoc(w, id)),
    weather: publicWeather(w),
    memories: Object.values(w.agents).map((a) => publicMemories(w, a)),
  };
  const json = JSON.stringify(views);
  for (const s of secrets) assert.equal(json.includes(s), false, `泄露了 ${s}`);
  // 字段名：只检查 agent 档案（设施、工程也有 owner，典籍也有 body，那是别的东西）
  const keysOf = (o, out = new Set()) => {
    if (Array.isArray(o)) o.forEach((x) => keysOf(x, out));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.add(k); keysOf(v, out); }
    return out;
  };
  const profileKeys = keysOf([views.agents, views.state.agents]);
  for (const key of ['body', 'owner', 'tokenHash', 'keyHash', 'ownerKeyHash', 'creatorName', 'model', 'diary', 'letters', 'inbox', 'will', 'memories'.concat('X')]) {
    assert.equal(profileKeys.has(key), false, `agent 档案里出现了字段 ${key}`);
  }
  assert.equal(json.includes('tokenHash'), false);
  assert.equal(json.includes('ownerKeyHash'), false);
  // agent 书写的灵魂是公开的
  assert.ok(json.includes('PUBLIC-SOUL-'));
  for (const pa of views.agents) {
    if (pa.generation === 0) assert.equal('soul' in pa, false, `${pa.id} 的人类灵魂不该公开`);
    else assert.equal(pa.soul, `PUBLIC-SOUL-${pa.id}`);
  }
});

test('可见性：谢幕之后，模型（含换身记录）、人类书写的灵魂与造者署名公开；令牌与密钥哈希永不公开', () => {
  const { w, secrets } = richWorld(72);
  w.revealed = true;
  const json = JSON.stringify({ state: publicState(w), agents: Object.values(w.agents).map((a) => publicAgent(w, a)) });
  const a0 = Object.values(w.agents).find((a) => a.generation === 0);
  const pa = publicAgent(w, a0);
  assert.equal(pa.soul, `SECRET-SOUL-${a0.id}`);
  assert.deepEqual(pa.body, { kind: 'free', model: `SECRET-MODEL-${a0.id}`, history: a0.body.history });
  assert.equal(pa.creatorName, `SECRET-CREATOR-${a0.id}`);
  assert.equal(publicState(w).world.revealed, true);
  for (const a of Object.values(w.agents)) {
    assert.equal(json.includes(a.tokenHash), false, '令牌哈希');
    if (a.owner) assert.equal(json.includes(a.owner.keyHash), false, '密钥哈希');
  }
  assert.equal(json.includes('秘密家书文本'), false); // 家书内容不因谢幕而公开
  void secrets;
});

test('可见性：公开档案的字段——位置、能量、旧币、状态、社群、世代、父母子女、年龄、最近行动、公共物品记录', () => {
  const w = newWorld('pub');
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  a.place = 'well';
  one(w, a, { type: 'draw', energy: 5 });
  one(w, a, { type: 'say', text: '你好' });
  const pa = publicAgent(w, a);
  assert.deepEqual(
    [pa.id, pa.name, pa.lang, pa.status, pa.place, pa.energy, pa.coins, pa.generation, pa.parents, pa.children, pa.ageDays, pa.lastActTick, pa.exiled, pa.groups, pa.script],
    [a.id, '甲', 'zh', 'awake', 'well', 44, 20, 0, [], [], 0, 0, false, [], 'han'], // 汲取 +5，说话 −1
  );
  assert.deepEqual(pa.stats, { repaired: 0, contributed: 0, drawn: 5, utterances: 1, inscribed: 0 });
  // 死者：不再有位置；年龄以离世之日计；记忆全部公开
  b.status = 'dead';
  b.diedDay = 7;
  b.energy = 0;
  b.coins = 0;
  b.memories.push({ day: 1, tick: 999999, text: '死者的记忆' });
  w.ledger.prev.energy -= 40;
  w.ledger.prev.coins -= 20;
  tickDays(w, 8);
  const pb = publicAgent(w, b);
  assert.deepEqual([pb.status, pb.place, pb.ageDays, pb.diedDay], ['dead', null, 7, 7]);
  assert.deepEqual(publicMemories(w, b), [{ day: 1, text: '死者的记忆' }]);
});

// ── 延迟公开 ───────────────────────────────────────────────────

test('可见性：记忆条目延迟 PRIVATE_DELAY_TICKS 刻才公开', () => {
  const w = newWorld('delay');
  const a = reg(w, '甲');
  one(w, a, { type: 'remember', text: '刚写下的记忆' });
  assert.deepEqual(publicMemories(w, a), []);
  tick(w, P.privateDelayTicks - 1);
  assert.deepEqual(publicMemories(w, a), []);
  tick(w, 1);
  assert.deepEqual(publicMemories(w, a), [{ day: 0, text: '刚写下的记忆' }]); // tick ≤ 当前刻 − 288
  a.actsThisTick = 0;
  one(w, a, { type: 'remember', text: '新的一条' });
  assert.equal(publicMemories(w, a).length, 1);
});

test('可见性：事件——public 直接可见；delayed 释放前不可见、释放后带 delayed 标记；owner 与 internal 永不可见', () => {
  const w = newWorld('ev');
  const a = reg(w, '甲');
  const b = reg(w, '乙');
  const evs = [];
  const run = (action, who = a) => { who.actsThisTick = 0; const r = applyCommand(w, { type: 'act', payload: { agentId: who.id, thought: '一个念头', actions: [action] } }); evs.push(...r.events); };
  run({ type: 'say', text: '公开的话' });
  run({ type: 'whisper', to: b.id, text: '悄悄话' });
  run({ type: 'remember', text: '记忆' });
  run({ type: 'diary', text: '日记' });
  run({ type: 'will', heirs: [{ to: b.id, share: 1 }] });
  const by = (t) => evs.find((e) => e.type === t);
  // public
  const say = publicEvent(w, by('say'));
  assert.deepEqual([say.type, say.agent, say.place, say.data.text, say.delayed], ['say', a.id, 'port', '公开的话', undefined]);
  // delayed：未释放前不可见
  for (const t of ['whisper', 'remember', 'thought']) {
    assert.equal(by(t).vis, 'delayed', t);
    assert.equal(publicEvent(w, by(t)), null, `${t} 释放前`);
    const released = publicEvent(w, by(t), { released: true });
    assert.equal(released.delayed, true, t);
    assert.equal(released.type, t);
  }
  assert.equal(by('whisper').releaseTick, w.clock.tick + P.privateDelayTicks);
  assert.equal(JSON.stringify(publicEvent(w, by('whisper'), { released: true })).includes('releaseTick'), false);
  // owner / internal：永不可见
  for (const t of ['diary', 'will']) {
    assert.equal(publicEvent(w, by(t), { released: true }), null, t);
  }
  assert.equal(by('diary').vis, 'owner');
  assert.equal(by('will').vis, 'internal');
  // 造者可以立即看到 owner 与 delayed 事件
  assert.ok(ownerEvent(by('diary')));
  assert.ok(ownerEvent(by('thought')));
  assert.equal(ownerEvent(by('will')), null);
  assert.equal(ownerEvent(by('say')), null);
});

test('可见性：家书事件——公开的只有「收到了一封」，内容只有造者与 agent 知道；出示后才公开全文', () => {
  const w = newWorld('letter-vis');
  const a = reg(w, '甲');
  const { events } = applyCommand(w, { type: 'letter', payload: { agentId: a.id, text: '只给你看的话。' } });
  const pubs = events.map((e) => publicEvent(w, e, { released: true })).filter(Boolean);
  assert.deepEqual(pubs.map((e) => e.type), ['letter_received']);
  assert.equal(JSON.stringify(pubs).includes('只给你看的话'), false);
  a.actsThisTick = 0;
  const r = applyCommand(w, { type: 'act', payload: { agentId: a.id, actions: [{ type: 'reveal', letter: 'L1', loud: true }] } });
  const shown = r.events.map((e) => publicEvent(w, e)).filter(Boolean).find((e) => e.type === 'reveal');
  assert.equal(shown.data.text, '只给你看的话。');
});

test('可见性：被遮盖的事件、铭刻、典籍、词条在公共视图中替换为「此处被幕后抹去」', () => {
  const w = newWorld('redact');
  const a = reg(w, '甲');
  grant(w, a, 50);
  a.place = 'library';
  const { events } = applyCommand(w, { type: 'act', payload: { agentId: a.id, actions: [{ type: 'write', title: '不该留的标题', body: '不该留的正文' }] } });
  const ev = events.find((e) => e.type === 'write');
  w.redacted.events.push(ev.seq);
  const pe = publicEvent(w, ev);
  assert.equal(pe.redacted, true);
  assert.deepEqual(pe.data, { text: { zh: '此处被幕后抹去', en: 'Erased from behind the curtain' } });
  assert.equal(JSON.stringify(pe).includes('不该留的'), false);
  const docId = ev.data.docId;
  w.docs[docId].redacted = true;
  assert.equal(publicDoc(w, docId).body, null);
  assert.equal(publicDoc(w, docId).title, null);
  assert.equal(JSON.stringify(publicState(w)).includes('不该留的'), false);
  w.inscriptions.i1.redacted = true;
  const place = publicPlace(w, 'parliament');
  assert.equal(place.inscriptions[0].text, null);
  assert.equal(place.inscriptions[0].redacted, true);
  assert.equal(place.inscriptions[0].author, 'humans'); // 观众能看到作者，只是内容被遮盖
  assert.equal(place.wallVisible.includes('i1'), false);
  w.lexicon.灯 = { word: '灯', meaning: '不该留的释义', coiner: a.id, tick: 0, uses: 0, users: [], redacted: true };
  assert.equal(JSON.stringify(publicState(w)).includes('不该留的释义'), false);
});

// ── 天象排期的保密 ───────────────────────────────────────────

test('可见性：天象的排期对观众保密——只有已出现的征兆（文本与地点）；投票者指纹永不公开', () => {
  const w = newWorld('wx-vis');
  reg(w, '甲');
  const voter = sha('voter:secret-fingerprint');
  applyCommand(w, { type: 'weather_vote', payload: { voterHash: voter, type: 'quake' } });
  tickDays(w, P.daysPerMonth);
  const s = w.weather.scheduled;
  assert.equal(s.type, 'quake');
  // 排期已定，但征兆窗口还没打开：公共视图里没有任何线索
  w.clock.tick = (s.startDay - s.lead - 1) * P.ticksPerDay;
  const before = JSON.stringify({ weather: publicWeather(w), state: publicState(w) });
  assert.equal(before.includes('quake'), false);
  assert.equal(before.includes('startDay'.concat('":', String(s.startDay))), false);
  assert.equal(before.includes(voter), false);
  assert.deepEqual(publicWeather(w).omens, []);
  // 窗口打开后：有文本与地点，没有类型与日期
  w.clock.tick = (s.startDay - 1) * P.ticksPerDay;
  const pw = publicWeather(w);
  assert.equal(pw.omens.length, 12);
  assert.equal(JSON.stringify(pw).includes('quake'), false);
  assert.ok(pw.omens.every((o) => o.text.zh === '地面在微微颤动，墙角落下细灰。'));
  assert.equal('scheduled' in pw, false);
  // weather_scheduled 是 internal 事件
  const sched = eventsOf(tickDays(w, 0), 'weather_scheduled');
  assert.equal(sched.length, 0);
  const wx = newWorld('wx-vis2');
  wx.weather.scheduled = { month: 1, type: 'fog', startDay: 30, lead: 1, decidedBy: 'vote', votes: {} };
  assert.equal(publicEvent(wx, { seq: 1, tick: 0, day: 0, type: 'weather_scheduled', vis: 'internal', data: { type: 'fog' } }, { released: true }), null);
});

test('公共状态：概览的顶层结构与关键内容', () => {
  const { w } = richWorld(73);
  const st = publicState(w, { nextTickAt: 42 });
  assert.deepEqual(Object.keys(st), [
    'world', 'params', 'charter', 'places', 'agents', 'groups', 'proposals', 'laws', 'offers', 'cradle', 'treasury', 'well',
    'wilds', 'regions', 'weather', 'lexicon', 'docs', 'cemetery', 'retired', 'unborn', 'metrics', 'legacy', 'chronicle',
  ]);
  assert.equal(st.world.nextTickAt, 42);
  assert.equal(st.world.revealed, false);
  assert.equal(st.world.humanCityName.en, 'The Nameless City');
  assert.equal(st.places.length, 12);
  assert.equal(st.agents.length, Object.keys(w.agents).length);
  assert.equal(st.charter.articles.length, 9);
  assert.equal(Object.keys(st.charter.articles[0].versions).length, 8);
  assert.equal(st.docs.length, Object.keys(w.docs).length);
  // 提案带投票明细
  const withVotes = st.proposals.find((p) => p.votes.length > 0);
  if (withVotes) assert.ok(withVotes.votes[0].agent.name);
  JSON.stringify(st);
});
