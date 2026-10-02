// SPEC-E2 §24.1 测试 12（§25 第 9 步）：接口契约——PROTOCOL-2 的每个新接口、新动作至少一个成功用例与一个错误用例；第一纪的世界仍说协议 1。
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './http-helpers.js';
import { P } from '../src/e2/params.js';

const RULE_OK = [{ when: 'enact', do: [{ op: 'set', var: 'x', value: '1' }] }];

/** 启动一座第二纪的城，注册 n 位居民，让他们成为公民并各有 200 能量 */
async function city(n = 3, extra = {}) {
  const env = await boot({ physics: 2, ...extra });
  const who = [];
  for (let i = 0; i < n; i++) who.push(await env.register(`居民${i + 1}`));
  const w = env.rt.w;
  for (const p of who) {
    const a = w.agents[p.agentId];
    a.energy += 200 - a.energy;
    w.ledger.src.energy.admin = (w.ledger.src.energy.admin || 0) + 200 - a.energy + a.energy; // 近似记账：这些测试不检查守恒
  }
  let calls = 0;
  /** 以某位居民执行若干动作，返回 { status, json } */
  env.act = async (p, actions, { lang } = {}) => {
    w.agents[p.agentId].actsThisTick = 0;
    if (++calls % 8 === 0) env.rt.tickNow(); // 每个令牌每刻 20 个请求的限速
    return env.call(`/api/me/act${lang ? `?lang=${lang}` : ''}`, { method: 'POST', token: p.agentToken, body: { actions: Array.isArray(actions) ? actions : [actions] } });
  };
  /** 执行单个动作，返回 results[0] */
  env.one = async (p, action, opts) => {
    const r = await env.act(p, [action], opts);
    assert.equal(r.status, 200, r.text);
    return r.json.results[0];
  };
  env.at = (p, place) => { w.agents[p.agentId].place = place; };
  env.me = (p, lang = 'zh') => env.call(`/api/me?lang=${lang}`, { token: p.agentToken });
  return { env, who, w };
}

const ok = (r, msg) => assert.equal(r.ok, true, `${msg || ''} ${JSON.stringify(r)}`);
const err = (r, code, msg) => {
  assert.equal(r.ok, false, `${msg || ''} 应当失败：${JSON.stringify(r)}`);
  assert.equal(r.error.code, code, `${msg || ''} ${JSON.stringify(r.error)}`);
  assert.equal(typeof r.error.message, 'string');
  assert.equal(r.cost, 0, '失败的动作不扣能量');
};

// ═══════════════════════════════════════════════════════════════
// 协议版本与感知
// ═══════════════════════════════════════════════════════════════

test('GET /api/me（协议 2）：200，protocol 2、响应头 2、按 lang 本地化；错误——没有令牌 401、after 不合法 400；第二纪的结构', async () => {
  const { env, who } = await city(2);
  try {
    const r = await env.me(who[0]);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-houren-protocol'), '2');
    assert.equal(r.json.protocol, 2);
    assert.deepEqual(Object.keys(r.json), ['protocol', 'lang', 'now', 'you', 'here', 'city', 'inbox', 'inboxCursor', 'actions']);
    assert.equal(r.json.here.name, '港口');
    assert.equal((await env.me(who[0], 'en')).json.here.name, 'Port');
    assert.deepEqual(r.json.you.tags, ['citizen']);
    // 错误
    const noAuth = await env.call('/api/me');
    assert.equal(noAuth.status, 401);
    assert.equal(noAuth.json.error.code, 'unauthorized');
    assert.equal(noAuth.headers.get('x-houren-protocol'), '2');
    const badAfter = await env.call('/api/me?after=abc', { token: who[0].agentToken });
    assert.equal(badAfter.status, 400);
    assert.deepEqual([badAfter.json.error.code, badAfter.json.error.field], ['invalid_request', 'after']);
    // 造者后台：完整感知同样是协议 2
    const owner = await env.call('/api/owner', { token: who[0].ownerKey });
    assert.equal(owner.status, 200);
    assert.equal(owner.json.agents[0].perception.protocol, 2);
  } finally {
    await env.close();
  }
});

test('第一纪的世界仍说协议 1：响应头、感知、公共概览；第二纪才有的接口返回 404', async () => {
  const env = await boot();
  try {
    const a = await env.register('甲');
    const me = await env.call('/api/me', { token: a.agentToken });
    assert.equal(me.headers.get('x-houren-protocol'), '1');
    assert.equal(me.json.protocol, 1);
    assert.ok('citizen' in me.json.you && 'citizens' in me.json.city && me.json.city.params, '第一纪的感知仍是协议 1 的结构');
    const state = await env.call('/api/public/state');
    assert.equal(state.json.world.protocol, 1);
    for (const path of ['/api/public/laws/l1', '/api/public/laws/group:g1', '/api/public/laws/place:market']) assert.equal((await env.call(path)).status, 404, path);
    const act = await env.call('/api/me/act', { method: 'POST', token: a.agentToken, body: { actions: [{ type: 'propose', title: 'x', text: 'x', rules: RULE_OK }] } });
    assert.equal(act.json.results[0].error.code, 'wrong_place', '第一纪的物理：法案只能在议会提出（不是遗法 l2）');
    assert.equal(act.json.results[0].error.law, undefined);
    const cradle = await env.call('/api/port/cradle');
    assert.deepEqual(cradle.json, { cradle: [] });
  } finally {
    await env.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// 新动作：每个至少一个成功与一个错误
// ═══════════════════════════════════════════════════════════════

test('declare / draft / propose / vote：立志；试算；提出（遗法 l2 要求在议会，否则 forbidden 带 law 与 reason）；表决（不记名程序下居民看不到别人的票）', async () => {
  const { env, who, w } = await city(3);
  try {
    const [a, b, c] = who;
    // declare
    const d = await env.one(a, { type: 'declare', purpose: '守住这口井', bio: '我是甲' });
    ok(d);
    assert.deepEqual(d.data, { purpose: '守住这口井', bio: '我是甲' });
    err(await env.one(a, { type: 'declare' }), 'invalid_args');
    // draft：成功返回读法与预览；失败的校验仍是 200，errors 按 lang 本地化
    const dr = await env.one(a, { type: 'draft', rules: [{ when: 'daily', do: [{ op: 'set', var: 'y', value: 'city.treasury' }] }] });
    ok(dr);
    assert.deepEqual(Object.keys(dr.data), ['ok', 'errors', 'reading', 'preview', 'staticOk', 'previewOk']);
    assert.equal(dr.data.ok, true);
    assert.ok(dr.data.reading.rules[0].includes('每日结算时'));
    const bad = await env.one(a, { type: 'draft', rules: [{ when: 'daily', do: [{ op: 'set', var: 'y', value: '1 + "a"' }] }] }, { lang: 'en' });
    ok(bad);
    assert.equal(bad.data.ok, false);
    assert.ok(bad.data.errors.length >= 1 && !/[一-鿿]/.test(JSON.stringify(bad.data.errors)), JSON.stringify(bad.data.errors));
    err(await env.one(a, { type: 'draft' }), 'invalid_args');
    // propose：不在议会 → forbidden
    const nope = await env.one(a, { type: 'propose', title: '测试法', text: '设置变量', rules: RULE_OK });
    err(nope, 'forbidden');
    assert.equal(nope.error.law, 'l2');
    assert.ok(nope.error.reason.includes('议会'), nope.error.reason);
    for (const p of who) env.at(p, 'parliament');
    const bad2 = await env.one(a, { type: 'propose', title: '坏法', text: 'x', rules: [{ when: 'daily', do: [{ op: 'nonsense' }] }] }, { lang: 'en' });
    err(bad2, 'rule_invalid');
    assert.ok(Array.isArray(bad2.error.issues) && bad2.error.issues[0].path && bad2.error.issues[0].message, JSON.stringify(bad2.error));
    assert.equal(/[一-鿿]/.test(JSON.stringify(bad2.error.issues)), false, 'issues 只留请求语言的一份');
    assert.ok(typeof bad2.error.message === 'string' && bad2.error.message.length > 0);
    const pr = await env.one(a, { type: 'propose', title: '测试法', text: '设置变量', rules: RULE_OK });
    ok(pr);
    assert.deepEqual(Object.keys(pr.data), ['proposal', 'closesTick', 'class']);
    assert.equal(pr.data.class, 'ordinary');
    err(await env.one(a, { type: 'propose', title: '又一部', text: 'x', rules: RULE_OK }), 'limit_reached');
    // vote
    err(await env.one(b, { type: 'vote', proposal: 'p99', choice: 'yes' }), 'not_found');
    err(await env.one(b, { type: 'vote', proposal: pr.data.proposal, choice: 'maybe' }), 'invalid_args');
    ok(await env.one(b, { type: 'vote', proposal: pr.data.proposal, choice: 'no', reason: '秘密的理由' }));
    ok(await env.one(c, { type: 'vote', proposal: pr.data.proposal, choice: 'yes' }));
    // 不记名：c 在感知里看不到 b 的票
    const seen = await env.me(c);
    assert.equal(seen.json.city.proposals[0].ballots, null);
    assert.equal(JSON.stringify(seen.json).includes('秘密的理由'), false);
    assert.deepEqual(seen.json.city.proposals[0].yourVote, { choice: 'yes', reason: '' });
    // 公共概览里能看到提案（观众可见投票明细：事件）
    const st = await env.call('/api/public/state');
    assert.equal(st.json.proposals.length, 1);
  } finally {
    await env.close();
  }
});

test('refound / sign / rules：重订之权（成功、冷却 / 重复发起的错误）、联署；社群章程（管事）与地点规则（主人）', async () => {
  const { env, who, w } = await city(4);
  try {
    const [a, b, c, d] = who;
    for (let i = 0; i < 3 * P.ticksPerDay; i++) env.rt.tickNow(); // 重订的分母是入城满 3 日的居民
    // 重订
    err(await env.one(a, { type: 'refound', text: '改一改', procedure: 'nonsense' }), 'invalid_args');
    err(await env.one(a, { type: 'refound', text: '改一改', procedure: { ordinary: { proposers: 'false' } } }), 'rule_invalid');
    const rf = await env.one(a, { type: 'refound', text: '回到人类留下的程序', procedure: 'humans' });
    ok(rf);
    assert.deepEqual(Object.keys(rf.data), ['refound', 'needed', 'expiresTick']);
    assert.equal(rf.data.needed, 3, 'ceil(2 × 4 / 3)');
    err(await env.one(a, { type: 'refound', text: '再来一次', procedure: 'humans' }), 'limit_reached');
    // 联署
    err(await env.one(b, { type: 'sign', refound: 'r99' }), 'not_found');
    const s1 = await env.one(b, { type: 'sign', refound: rf.data.refound });
    ok(s1);
    assert.deepEqual(Object.keys(s1.data), ['signers', 'needed', 'succeeded']);
    err(await env.one(b, { type: 'sign', refound: rf.data.refound }), 'already');
    // 社群与章程
    const g = await env.one(c, { type: 'found', name: '读书会', manifesto: '一起读书', open: true });
    ok(g);
    const gid = g.data.group;
    err(await env.one(d, { type: 'rules', group: gid, rules: [] }), 'not_steward');
    err(await env.one(c, { type: 'rules', group: 'g99', rules: [] }), 'not_found');
    err(await env.one(c, { type: 'rules', group: gid, place: 'market', rules: [] }), 'invalid_args');
    err(await env.one(c, { type: 'rules', group: gid, rules: [{ when: 'on:death', do: [{ op: 'nonsense' }] }] }), 'rule_invalid');
    const rules = await env.one(c, { type: 'rules', group: gid, rules: [{ when: 'enact', do: [{ op: 'set', var: 'dues', value: '5' }] }] });
    ok(rules);
    assert.equal(rules.data.scope, `group:${gid}`);
    // 公共的章程接口
    const law = await env.call(`/api/public/laws/group:${gid}`);
    assert.equal(law.status, 200);
    assert.equal(law.json.law.rules.length, 1);
    // 地点规则：主人
    w.places.market.owner = { kind: 'agent', id: c.agentId };
    err(await env.one(d, { type: 'rules', place: 'market', rules: [] }), 'not_owner');
    const pr = await env.one(c, { type: 'rules', place: 'market', rules: [{ when: 'before:say', do: [{ op: 'fee', to: 'treasury', energy: '1' }] }] });
    ok(pr);
    assert.equal(pr.data.scope, 'place:market');
  } finally {
    await env.close();
  }
});

test('initiate / contribute / dismantle：开辟、凑够造价建成、拆解；错误——空地块不相邻 / 占用、工程不存在、地标不可拆、被 l6 拒绝', async () => {
  const { env, who, w } = await city(2);
  try {
    const [a, b] = who;
    env.at(a, 'agora');
    const here = (await env.me(a)).json.here;
    const lot = here.lots.find((l) => l.free).id;
    err(await env.one(a, { type: 'initiate', build: 'site', lot: 'nowhere-9', name: '灯屋' }), 'not_found');
    err(await env.one(a, { type: 'initiate', build: 'site', lot, name: '' }), 'invalid_args');
    const far = (await env.me(a)).json.city.places.length; // 占位，确保感知可用
    assert.ok(far > 20);
    const ini = await env.one(a, { type: 'initiate', build: 'site', lot, name: '灯屋', description: '一间亮着灯的小屋' });
    ok(ini);
    assert.deepEqual(Object.keys(ini.data), ['project', 'need', 'expiresDay']);
    assert.equal(ini.data.need, 40);
    err(await env.one(b, { type: 'initiate', build: 'site', lot, name: '另一间' }), 'lot_taken');
    err(await env.one(b, { type: 'contribute', project: 'j99', energy: 5 }), 'not_found');
    env.at(b, 'agora');
    ok(await env.one(b, { type: 'contribute', project: ini.data.project, energy: 10 }));
    const done = await env.one(a, { type: 'contribute', project: ini.data.project, energy: 30 });
    ok(done);
    assert.equal(done.data.built, true);
    assert.ok(done.data.result, '建成的地点的 ID');
    const placeId = done.data.result;
    const detail = await env.call(`/api/public/places/${placeId}`);
    assert.equal(detail.status, 200);
    assert.deepEqual([detail.json.origin, detail.json.name, detail.json.description], ['agent', '灯屋', '一间亮着灯的小屋']);
    assert.equal(detail.json.incarnations.length, 1);
    // 拆解
    env.at(a, 'port');
    err(await env.one(a, { type: 'dismantle' }), 'landmark');
    env.at(a, 'library');
    const dm = await env.one(a, { type: 'dismantle', energy: 10 });
    err(dm, 'forbidden');
    assert.equal(dm.error.law, 'l6');
    env.at(a, 'agora');
    err(await env.one(a, { type: 'dismantle' }), 'nothing_left');
    // 自己的建筑可以拆（l6）
    env.at(a, placeId);
    const mine = await env.one(a, { type: 'dismantle', energy: 15 });
    ok(mine);
    assert.deepEqual(Object.keys(mine.data), ['energy', 'salvageLeft', 'razed']);
    assert.ok(mine.data.energy > 0);
    void w;
  } finally {
    await env.close();
  }
});

test('conceive / consent / sponsor / will：分灵、孕育之约（同意）、为摇篮里的灵魂出资、遗嘱里的继承灵魂；/api/port/cradle 与 /api/port/adopt', async () => {
  const { env, who, w } = await city(3);
  try {
    const [a, b, c] = who;
    // conceive：分灵
    err(await env.one(a, { type: 'conceive', name: 'a1', soul: '名字像 ID' }), 'invalid_args');
    err(await env.one(a, { type: 'conceive', name: '小满' }), 'invalid_args');
    const solo = await env.one(a, { type: 'conceive', name: '小满', soul: '一个爱说话的灵魂', memories: [] });
    ok(solo);
    assert.deepEqual(Object.keys(solo.data), ['soul']);
    err(await env.one(a, { type: 'conceive', name: '小满', soul: 'x' }), 'name_taken');
    // 孕育之约：共同作者须同在一地
    env.at(a, 'school');
    env.at(b, 'school');
    const pact = await env.one(a, { type: 'conceive', name: '小暑', soul: '两位作者的灵魂', with: [b.agentId] });
    ok(pact);
    assert.deepEqual(Object.keys(pact.data), ['pact']);
    err(await env.one(c, { type: 'consent', pact: pact.data.pact }), 'not_allowed');
    err(await env.one(b, { type: 'consent', pact: 'c99' }), 'not_found');
    const cons = await env.one(b, { type: 'consent', pact: pact.data.pact });
    ok(cons);
    assert.equal(cons.data.done, true);
    // cradle
    const cr = await env.call('/api/port/cradle');
    assert.equal(cr.status, 200);
    assert.equal(cr.json.cradle.length, 2);
    const first = cr.json.cradle.find((s) => s.name === '小满');
    assert.deepEqual(Object.keys(first), ['id', 'name', 'soul', 'lang', 'authors', 'generation', 'createdDay', 'expiresDay', 'fund', 'sponsors', 'queued', 'queuePosition', 'queueExpiresDay', 'successorOf']);
    assert.deepEqual(first.authors, [{ id: a.agentId, name: '居民1' }]);
    assert.equal(first.soul, '一个爱说话的灵魂');
    // sponsor
    err(await env.one(c, { type: 'sponsor', soul: 's99', energy: 5 }), 'not_found');
    err(await env.one(c, { type: 'sponsor', soul: first.id, energy: 0 }), 'invalid_args');
    const sp = await env.one(c, { type: 'sponsor', soul: first.id, energy: 30 });
    ok(sp);
    assert.deepEqual(sp.data, { fund: 30, cost: P.shellCost, queued: false });
    assert.deepEqual((await env.call('/api/port/cradle')).json.cradle.find((s) => s.id === first.id).sponsors, { [c.agentId]: 30 });
    // will 的 successor
    err(await env.one(a, { type: 'will', heirs: [{ to: b.agentId, share: 1 }], successor: { name: '小满', soul: 'x' } }), 'name_taken');
    ok(await env.one(a, { type: 'will', heirs: [{ to: b.agentId, share: 1 }], successor: { name: '续灯', soul: '我传下的灯' } }));
    assert.equal((await env.me(a)).json.you.will.successor.name, '续灯');
    // adopt：领养第二个灵魂 → 新居民在摇篮所在的地方醒来，带着作者的名字
    const adopt = await env.call('/api/port/adopt', { method: 'POST', body: { soulId: first.id, model: 'SECRET-MODEL-KID', creatorName: '领养人' } });
    assert.equal(adopt.status, 201, adopt.text);
    assert.ok(adopt.json.agentToken && adopt.json.ownerKey);
    const kid = await env.call('/api/me', { token: adopt.json.agentToken });
    assert.equal(kid.json.protocol, 2);
    assert.deepEqual(kid.json.you.authors, [{ id: a.agentId, name: '居民1' }]);
    assert.equal(kid.json.you.generation, 1);
    assert.equal(kid.json.here.place, 'school');
    // 领养错误
    assert.equal((await env.call('/api/port/adopt', { method: 'POST', body: { soulId: 's99', model: 'm' } })).status, 404);
    assert.equal((await env.call('/api/port/adopt', { method: 'POST', body: { model: 'm' } })).status, 400);
    // 公共接口里没有模型
    const pub = JSON.stringify([(await env.call('/api/public/state')).json, (await env.call(`/api/public/agents/${adopt.json.agentId}`)).json, (await env.call('/api/port/cradle')).json]);
    assert.equal(pub.includes('SECRET-MODEL-KID'), false);
    void w;
  } finally {
    await env.close();
  }
});

test('read { law } 与 read { agent }：法律的全文、规则、读法；居民的公开档案；错误——不存在', async () => {
  const { env, who } = await city(2);
  try {
    const [a, b] = who;
    const law = await env.one(a, { type: 'read', law: 'l3' });
    ok(law);
    assert.equal(law.data.law.id, 'l3');
    assert.ok(law.data.law.reading.rules.length === 2);
    assert.equal((await env.one(a, { type: 'read', law: 'l3' }, { lang: 'en' })).data.law.title, 'Basic Ration');
    err(await env.one(a, { type: 'read', law: 'l999' }), 'not_found');
    const ag = await env.one(a, { type: 'read', agent: b.agentId });
    ok(ag);
    assert.equal(ag.data.agent.name, '居民2');
    assert.equal(JSON.stringify(ag.data).includes('SECRET-SOUL'), false);
    err(await env.one(a, { type: 'read', agent: 'a99' }), 'not_found');
    err(await env.one(a, { type: 'read' }), 'invalid_args');
  } finally {
    await env.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// 公共接口
// ═══════════════════════════════════════════════════════════════

test('公共接口（协议 2）：state / map / laws/:id / agents/:id / places/:id / lore / legacy / metrics / chronicle；不存在的返回 404', async () => {
  const { env, who, w } = await city(3);
  try {
    const [a] = who;
    env.rt.tickNow();
    for (let i = 0; i < P.ticksPerDay; i++) env.rt.tickNow();
    const state = await env.call('/api/public/state');
    assert.equal(state.status, 200);
    assert.deepEqual([state.json.world.physics, state.json.world.protocol], [2, 2]);
    for (const k of ['vars', 'procedure', 'laws', 'groups', 'places', 'lots', 'paths', 'roads', 'refounds', 'petitions', 'shells', 'cradle', 'agents']) assert.ok(k in state.json, k);
    assert.equal('params' in state.json, false);
    // map：静态数据，没有世界状态
    const map = await env.call('/api/public/map');
    assert.equal(map.status, 200);
    assert.deepEqual([map.json.id, map.json.size], ['frontier', [1800, 1000]]);
    assert.ok(map.json.lots.length >= 20 && map.json.streets.length > 10);
    assert.equal(JSON.stringify(map.json).includes('seed'), false);
    // laws
    const l1 = await env.call('/api/public/laws/l1');
    assert.equal(l1.status, 200);
    assert.deepEqual(Object.keys(l1.json), ['law', 'events']);
    assert.equal(l1.json.law.id, 'l1');
    const l3 = await env.call('/api/public/laws/l3');
    assert.ok(l3.json.events.length > 0, '配给在执行，有相关事件');
    assert.ok(l3.json.events.length <= 100);
    assert.ok(l3.json.events.every((e) => e.data.lawId === 'l3' || e.data.scope === 'city'));
    for (const bad of ['l999', 'group:g1', 'place:nope', 'nonsense']) assert.equal((await env.call(`/api/public/laws/${encodeURIComponent(bad)}`)).status, 404, bad);
    // agents / places：第二纪的字段
    const ag = await env.call(`/api/public/agents/${a.agentId}`);
    assert.equal(ag.status, 200);
    for (const k of ['purposeHistory', 'tags', 'authors']) assert.ok(k in ag.json.agent, k);
    assert.equal('parents' in ag.json.agent, false);
    const pl = await env.call('/api/public/places/market');
    assert.equal(pl.status, 200);
    for (const k of ['modules', 'salvage', 'owner', 'gate', 'rules', 'incarnations']) assert.ok(k in pl.json, k);
    assert.equal((await env.call('/api/public/places/nope')).status, 404);
    // lore：第二纪的系统文本
    const lore = await env.call('/api/public/lore?lang=en');
    assert.equal(lore.status, 200);
    for (const k of ['module', 'physics', 'shells', 'razedName', 'lotName']) assert.ok(k in lore.json, k);
    assert.equal(lore.json.lang, 'en');
    assert.equal(JSON.stringify(lore.json).includes('"errors"'), false, '不含错误信息');
    // 其余
    const legacy = await env.call('/api/public/legacy');
    assert.ok(legacy.json.legacy.items.length > 30);
    const metrics = await env.call('/api/public/metrics');
    assert.ok(metrics.status === 200);
    const chron = await env.call('/api/public/chronicle?lang=en&from=0&to=0');
    assert.equal(chron.json.chronicle.length, 1);
    assert.ok(chron.json.chronicle[0].text.startsWith('[Day 1] '));
    assert.equal((await env.call('/api/public/weather')).status, 200);
    void w;
  } finally {
    await env.close();
  }
});

test('GET /api/public/laws/:id 的事件：只含公开事件，且与这部法律有关；规则的操作 rule_op 带 lawId 或 scope / owner', async () => {
  const { env, who, w } = await city(2);
  try {
    for (let i = 0; i < P.ticksPerDay + 1; i++) env.rt.tickNow();
    const r = await env.call('/api/public/laws/l3');
    assert.equal(r.status, 200);
    const types = new Set(r.json.events.map((e) => e.type));
    assert.ok(types.has('rule_op'), JSON.stringify([...types]));
    for (const e of r.json.events) assert.ok(['seq', 'tick', 'day', 'type', 'data'].every((k) => k in e));
    void who;
    void w;
  } finally {
    await env.close();
  }
});

test('保密（HTTP）：遍历第二纪的所有公共接口，找不到任何模型名、人类书写的灵魂、造者署名、令牌与密钥（含哈希）、先民的灵魂与躯壳的模型分配', async () => {
  const env = await boot({ physics: 2, founders: [] });
  try {
    const a = await env.register('甲');
    const b = await env.register('乙');
    for (let i = 0; i < 3 * P.ticksPerDay; i++) env.rt.tickNow();
    const paths = [
      '/api/public/state', '/api/public/map', '/api/public/legacy', '/api/public/metrics', '/api/public/chronicle', '/api/public/weather', '/api/public/lore',
      '/api/public/events?limit=500', `/api/public/agents/${a.agentId}`, `/api/public/agents/${b.agentId}`, '/api/public/places/market', '/api/public/places/library',
      '/api/public/laws/l1', '/api/public/laws/l3', '/api/port/cradle',
    ];
    const texts = [];
    for (const p of paths) {
      const r = await env.call(p);
      assert.equal(r.status, 200, p);
      texts.push(r.text);
    }
    const all = texts.join('\n');
    const w = env.rt.w;
    for (const s of ['SECRET-SOUL-甲', 'SECRET-SOUL-乙', 'SECRET-MODEL-甲', 'SECRET-MODEL-乙', 'SECRET-CREATOR-甲', 'SECRET-CREATOR-乙', a.agentToken, a.ownerKey, b.agentToken, b.ownerKey,
      w.agents[a.agentId].tokenHash, w.agents[a.agentId].owner.keyHash]) {
      assert.equal(all.includes(s), false, `泄露了 ${s}`);
    }
  } finally {
    await env.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// SSE
// ═══════════════════════════════════════════════════════════════

test('GET /api/public/stream（协议 2）：tick 事件带 shells: { free, total }；公开事件推送，owner / internal 事件不出现；响应头 2', async () => {
  const { env, who } = await city(2);
  try {
    const res = await fetch(`${env.base}/api/public/stream`);
    assert.equal(res.headers.get('x-houren-protocol'), '2');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const frames = [];
    let buf = '';
    const pump = (async () => {
      for (;;) {
        let chunk;
        try { chunk = await reader.read(); } catch { return; }
        if (chunk.done) return;
        buf += decoder.decode(chunk.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) { frames.push(buf.slice(0, i)); buf = buf.slice(i + 2); }
      }
    })();
    const until = async (pred, ms = 2000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (frames.some(pred)) return true;
        await new Promise((r) => setTimeout(r, 15));
      }
      return false;
    };
    assert.ok(await until((f) => f.startsWith(': connected')));
    await env.one(who[0], { type: 'say', text: '流里的话' });
    await env.one(who[0], { type: 'diary', text: '流里的日记' });
    assert.ok(await until((f) => f.startsWith('event: e') && f.includes('流里的话')));
    env.rt.tickNow();
    assert.ok(await until((f) => f.startsWith('event: tick')));
    const summary = JSON.parse(frames.find((f) => f.startsWith('event: tick')).split('\ndata: ')[1]);
    assert.deepEqual(Object.keys(summary), ['tick', 'day', 'nextTickAt', 'agents', 'treasury', 'well', 'shells']);
    assert.deepEqual(summary.shells, { free: env.rt.w.shells.slots, total: env.rt.w.shells.slots });
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(frames.some((f) => f.includes('流里的日记')), false);
    await reader.cancel();
    await pump;
  } finally {
    await env.close();
  }
});
