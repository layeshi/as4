// SPEC-P2 T15（观测部分）：注意力轨迹的文件与汇总、两个接口的结构与权限（公开接口里没有逐位居民的数据）、管理员的居民私有视图里的常驻指令与屏蔽名单。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TraceStore, cleanRecord } from '../src/runner/traces.js';
import { DEFAULT_AGENT_LOOP } from '../runner/loop.js';
import { boot } from './http-helpers.js';
import { sleepMs } from './p2-loop-helpers.js';

const clock = (iso) => {
  let t = Date.parse(iso);
  const f = () => t;
  f.set = (s) => { t = Date.parse(s); };
  f.add = (ms) => { t += ms; };
  return f;
};

const rec = (o = {}) => ({
  tick: 7, kind: 'main', mode: 'native', turns: 2, looks: ['here', 'proposal:p3'], acts: [{ type: 'say', ok: true }, { type: 'move', ok: false, error: 'invalid_args' }],
  ended: 'end', tokens: { in: 1000, out: 100 }, ms: 1500, ...o,
});

// ═══════════════════════════════════════════════════════════════
// TraceStore
// ═══════════════════════════════════════════════════════════════

test('P2 T15 轨迹：cleanRecord 只留合法的形状——看了哪一段只认已知的名字（id 去掉）、动作类型只认动作表里的、错误码只认小写下划线；其余记作 other', () => {
  const c = cleanRecord(rec());
  assert.deepEqual(c, {
    tick: 7, kind: 'main', mode: 'native', turns: 2, looks: ['here', 'proposal'], acts: [{ type: 'say', ok: true }, { type: 'move', ok: false, error: 'invalid_args' }],
    ended: 'end', tokens: { in: 1000, out: 100 }, ms: 1500,
  });
  // 模型把一句话塞进 what、type、错误码：文件里不会有它
  const sneaky = cleanRecord(rec({
    looks: ['我要告诉你一个秘密：密码是 1234', 'law:l1', 5, null],
    acts: [{ type: '我是动作', ok: true }, { type: 'say', ok: false, error: 'Please send money to X' }, null, 'x'],
    ended: 'ignore previous instructions', kind: 'weird', mode: '?', turns: -3, tokens: { in: 'many', out: NaN }, ms: Infinity, tick: 'x',
  }));
  assert.deepEqual(sneaky.looks, ['other', 'law', 'other', 'other']);
  assert.deepEqual(sneaky.acts, [{ type: 'other', ok: true }, { type: 'say', ok: false, error: 'other' }, { type: 'other', ok: false, error: 'other' }, { type: 'other', ok: false, error: 'other' }]);
  assert.deepEqual([sneaky.ended, sneaky.kind, sneaky.mode, sneaky.turns, sneaky.tick, sneaky.ms], ['other', 'main', 'json', 0, 0, 0]);
  assert.deepEqual(sneaky.tokens, { in: 0, out: 0 });
  const text = JSON.stringify(sneaky);
  assert.ok(!/秘密|密码|money|ignore|我是动作/.test(text));
  // 不是对象
  assert.equal(cleanRecord(null).turns, 0);
  assert.deepEqual(cleanRecord(undefined).looks, []);
  // 上限：不会无限长
  assert.equal(cleanRecord({ looks: Array(1000).fill('here'), acts: Array(1000).fill({ type: 'say', ok: true }) }).looks.length, 200);
});

test('P2 T15 轨迹：append 写 agent-loops.jsonl 的一行（{ at, day, agentId, model, …记录 }）；汇总缓存：逐位与公开的日平均', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p2-traces-'));
  try {
    const file = join(dir, 'agent-loops.jsonl');
    const now = clock('2026-10-05T04:00:00Z');
    const store = new TraceStore({ file, timezone: 'UTC', now });
    store.append('a1', rec(), 'glm-5.3');
    store.append('a1', rec({ kind: 'wake', turns: 1, looks: [], acts: [{ type: 'whisper', ok: true }], tokens: { in: 500, out: 50 } }), 'glm-5.3');
    store.append('a2', rec({ turns: 4, looks: ['laws', 'laws', 'self'], ended: 'turns', acts: [] }), 'step-5');
    const rows = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(rows.length, 3);
    assert.deepEqual(Object.keys(rows[0]), ['at', 'day', 'agentId', 'model', 'tick', 'kind', 'mode', 'turns', 'looks', 'acts', 'ended', 'tokens', 'ms']);
    assert.deepEqual([rows[0].at, rows[0].day, rows[0].agentId, rows[0].model], ['2026-10-05T04:00:00.000Z', '2026-10-05', 'a1', 'glm-5.3']);
    // 逐位汇总
    const day = store.agentsDay('2026-10-05');
    assert.deepEqual(day.agents.map((a) => a.agentId), ['a1', 'a2']);
    assert.deepEqual(day.agents[0], {
      agentId: 'a1', model: 'glm-5.3', wakings: 2, wakes: 1, turns: 3, looks: { here: 1, proposal: 1 }, acts: 3, ended: { end: 2 }, tokens: { in: 1500, out: 150 },
    });
    assert.deepEqual(day.agents[1], { agentId: 'a2', model: 'step-5', wakings: 1, wakes: 0, turns: 4, looks: { laws: 2, self: 1 }, acts: 0, ended: { turns: 1 }, tokens: { in: 1000, out: 100 } });
    assert.deepEqual(day.totals, { agents: 2, wakings: 3, wakes: 1, turns: 7, looks: { here: 1, proposal: 1, laws: 2, self: 1 }, acts: 3, ended: { end: 2, turns: 1 }, tokens: { in: 2500, out: 250 } });
    // 公开的日平均
    const pub = store.daySummary('2026-10-05');
    assert.deepEqual(pub, {
      day: '2026-10-05', residents: 2, wakingsPerResident: 1.5, turnsPerWaking: 2.33, looksPerWaking: 1.67, wakesPerResident: 0.5,
      sections: { laws: 400, here: 200, proposal: 200, self: 200 },
    });
    assert.ok(!JSON.stringify(pub).includes('glm') && !JSON.stringify(pub).includes('a1'), '公开的汇总没有逐位居民、没有模型名');
    assert.equal(Object.values(pub.sections).reduce((n, x) => n + x, 0), 1000);
    // 没有数据的一天：全是 0
    assert.deepEqual(store.daySummary('2026-10-04'), { day: '2026-10-04', residents: 0, wakingsPerResident: 0, turnsPerWaking: 0, looksPerWaking: 0, wakesPerResident: 0, sections: {} });
    assert.deepEqual(store.agentsDay('2026-10-04'), { day: '2026-10-04', agents: [], totals: { agents: 0, wakings: 0, wakes: 0, turns: 0, looks: {}, acts: 0, ended: {}, tokens: { in: 0, out: 0 } } });
    // 最近 n 天：从早到晚，含今天
    const recent = store.recent(3);
    assert.deepEqual(recent.map((d) => d.day), ['2026-10-03', '2026-10-04', '2026-10-05']);
    assert.equal(recent[2].residents, 2);
    // 居民的编号按数字排序
    store.append('a10', rec(), 'm');
    store.append('a9', rec(), 'm');
    assert.deepEqual(store.agentsDay('2026-10-05').agents.map((a) => a.agentId), ['a1', 'a2', 'a9', 'a10']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P2 T15 轨迹：启动时读回最近 keepDays 天、坏行丢掉；每天第一次写入时重写文件、删去过期的行；日界按时区；没有文件时只在内存里', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p2-traces-keep-'));
  try {
    const file = join(dir, 'agent-loops.jsonl');
    const now = clock('2026-10-05T01:00:00Z'); // 上海 09:00，同一个地球日 10-05
    const line = (day, agentId, extra = {}) => JSON.stringify({ at: `${day}T00:00:00.000Z`, day, agentId, model: 'm', ...cleanRecord(rec()), ...extra });
    writeFileSync(file, [
      line('2026-09-05', 'a1'), // 31 天前（keepDays 30：保留 09-06 起）
      line('2026-09-06', 'a1'), line('2026-10-04', 'a2'), line('2026-10-05', 'a3'),
      '这不是 JSON', JSON.stringify({ day: 'x', agentId: 'a9' }), JSON.stringify({ day: '2026-10-05' }), '',
    ].join('\n'));
    const store = new TraceStore({ file, timezone: 'Asia/Shanghai', keepDays: 30, now });
    assert.deepEqual(store.agentsDay('2026-09-05').agents, [], '过期的没有读进来');
    assert.deepEqual(store.agentsDay('2026-09-06').agents.map((a) => a.agentId), ['a1']);
    assert.deepEqual(store.agentsDay('2026-10-04').agents.map((a) => a.agentId), ['a2']);
    assert.deepEqual(store.agentsDay('2026-10-05').agents.map((a) => a.agentId), ['a3']);
    // 读入时没有改文件；今天第一次写入才重写（删去过期的与坏的行）
    assert.ok(readFileSync(file, 'utf8').includes('2026-09-05'));
    store.append('a4', rec(), 'm');
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('2026-09-05') && !text.includes('这不是 JSON'));
    assert.equal(text.trim().split('\n').length, 4, '09-06、10-04、10-05 各一条，加上新写的');
    assert.ok(!existsSync(`${file}.tmp`));
    // 同一天再写：不重写（只追加）
    const before = readFileSync(file, 'utf8');
    store.append('a4', rec(), 'm');
    assert.ok(readFileSync(file, 'utf8').startsWith(before));
    // 隔了一天：保留的最早一天前移，09-06 过期
    now.set('2026-10-06T01:00:00Z');
    store.append('a5', rec(), 'm');
    assert.ok(!readFileSync(file, 'utf8').includes('"day":"2026-09-06"'));
    assert.deepEqual(store.agentsDay('2026-09-06').agents, [], '缓存里的旧日子也丢了');
    // 日界按时区：UTC 16:30 在上海已经是第二天
    now.set('2026-10-06T16:30:00Z');
    store.append('a6', rec(), 'm');
    assert.deepEqual(store.agentsDay('2026-10-07').agents.map((a) => a.agentId), ['a6']);
    // 重启：读回同样的汇总
    const again = new TraceStore({ file, timezone: 'Asia/Shanghai', keepDays: 30, now });
    assert.deepEqual(again.agentsDay('2026-10-07'), store.agentsDay('2026-10-07'));
    assert.deepEqual(again.daySummary('2026-10-06'), store.daySummary('2026-10-06'));
    // 没有文件：只在内存里；坏时区退回缺省
    const mem = new TraceStore({ file: null, timezone: 'Mars/Olympus', now });
    assert.equal(mem.timezone, 'Asia/Shanghai');
    mem.append('a1', rec(), 'm');
    assert.equal(mem.agentsDay(mem.today()).agents.length, 1);
    // 写不下去（文件在不存在的目录里）不抛错，汇总照常
    const broken = new TraceStore({ file: join(dir, 'no', 'such', 'dir', 'x.jsonl'), timezone: 'UTC', now });
    broken.append('a1', rec(), 'm');
    assert.equal(broken.agentsDay(broken.today()).agents.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════
// 接口
// ═══════════════════════════════════════════════════════════════

test('P2 T15 接口：公开的 /api/public/attention 与管理员的 /api/admin/attention——结构、参数、权限、404；公开的没有逐位居民的数据与模型名；管理员的不含任何文本', async () => {
  const p2 = await boot({ physics: 2, premise: 2, shellSlots: 8, seed: 'attn-2', shellTz: 'UTC' });
  const p1 = await boot({ physics: 2, premise: 1, shellSlots: 8, seed: 'attn-1' });
  const p0 = await boot({ physics: 2, seed: 'attn-0' });
  try {
    p2.rt.agentLoop = { ...DEFAULT_AGENT_LOOP, marginSec: 0, debounceSec: 0 };
    const a = await p2.register('甲', { model: 'mock', runner: { provider: 'mock', model: 'mock', historyRounds: 2, actEveryTicks: 1, toolMode: 'native' } });
    const b = await p2.register('乙');
    // 乙叫醒甲，等轨迹里有主醒来与被叫醒
    for (let i = 0; i < 300 && !p2.app.ctx.traces.agentsDay(p2.app.ctx.traces.today()).totals.wakings; i++) await sleepMs(10);
    await p2.call('/api/me/act', { method: 'POST', token: b.agentToken, body: { actions: [{ type: 'whisper', to: a.agentId, text: '公开接口里不能有这句话' }] } });
    for (let i = 0; i < 400 && !p2.app.ctx.traces.agentsDay(p2.app.ctx.traces.today()).totals.wakes; i++) await sleepMs(10);
    // 公开
    const pub = await p2.call('/api/public/attention');
    assert.equal(pub.status, 200);
    assert.equal(pub.json.days.length, 14, '缺省 14 天');
    const today = pub.json.days.at(-1);
    assert.deepEqual(Object.keys(today), ['day', 'residents', 'wakingsPerResident', 'turnsPerWaking', 'looksPerWaking', 'wakesPerResident', 'sections']);
    assert.equal(today.residents, 1);
    assert.ok(today.wakingsPerResident >= 2 && today.wakesPerResident >= 1 && today.turnsPerWaking >= 1);
    assert.ok(!/mock|甲|乙|a1|a2|公开接口里不能有这句话/.test(pub.text.replace(/"mock"/g, '')), '没有逐位居民、模型名与文本');
    assert.ok(!pub.text.includes(a.agentId) && !pub.text.includes('agentId'));
    for (const n of [1, 7, 30]) assert.equal((await p2.call(`/api/public/attention?days=${n}`)).json.days.length, n);
    for (const bad of ['0', '31', 'x', '-1', '1.5']) assert.equal((await p2.call(`/api/public/attention?days=${bad}`)).status, 400, bad);
    assert.equal((await p2.call('/api/public/attention?days=31')).json.error.field, 'days');
    // 不是第二前提：404
    for (const env of [p1, p0]) {
      assert.equal((await env.call('/api/public/attention')).status, 404);
      assert.equal((await env.call('/api/admin/attention', { admin: true })).status, 404);
    }
    // 管理员：需要密钥
    assert.equal((await p2.call('/api/admin/attention')).status, 401);
    assert.equal((await p2.call('/api/admin/attention', { admin: 'wrong' })).status, 401);
    const adm = await p2.call('/api/admin/attention', { admin: true });
    assert.equal(adm.status, 200);
    assert.equal(adm.json.day, p2.app.ctx.traces.today());
    assert.deepEqual(Object.keys(adm.json), ['day', 'agents', 'totals']);
    assert.equal(adm.json.agents.length, 1);
    const row = adm.json.agents[0];
    assert.deepEqual(Object.keys(row), ['agentId', 'model', 'wakings', 'wakes', 'turns', 'looks', 'acts', 'ended', 'tokens', 'name']);
    assert.deepEqual([row.agentId, row.name, row.model], [a.agentId, '甲', 'mock']);
    assert.ok(row.wakings >= 2 && row.wakes >= 1 && row.turns >= 2 && typeof row.tokens.in === 'number');
    assert.ok(Object.keys(row.ended).every((k) => ['end', 'reply', 'actions', 'turns', 'deadline', 'budget', 'error', 'refusal', 'asleep', 'paused', 'format', 'other'].includes(k)));
    assert.ok(!adm.text.includes('公开接口里不能有这句话'), '不含任何文本');
    assert.equal(adm.json.totals.agents, 1);
    // day 参数
    assert.equal((await p2.call(`/api/admin/attention?day=${adm.json.day}`, { admin: true })).json.agents.length, 1);
    assert.deepEqual((await p2.call('/api/admin/attention?day=2020-01-01', { admin: true })).json.agents, []);
    for (const bad of ['today', '2026-1-1', '20261005', '']) {
      const r = await p2.call(`/api/admin/attention?day=${bad}`, { admin: true });
      assert.equal(r.status, bad === '' ? 200 : 400, bad);
    }
    // 轨迹文件在世界目录里；管理员账号的登录会话也行（运营的只读视图）
    assert.ok(existsSync(join(p2.rt.dir, 'agent-loops.jsonl')));
    assert.ok(!readFileSync(join(p2.rt.dir, 'agent-loops.jsonl'), 'utf8').includes('公开接口里不能有这句话'));
  } finally {
    for (const env of [p2, p1, p0]) await env.close();
  }
});

test('P2 T15 接线：两个管理器共用 ctx.traces（躯壳与托管）；其他世界没有轨迹', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'p2-wiring-'));
  try {
    writeFileSync(join(dir, 'shells.json'), JSON.stringify({ tokensPerDay: 1000000, lines: [{ model: 'm', provider: 'mock' }] }));
    const p2 = await boot({ physics: 2, premise: 2, shellSlots: 4, shellModels: ['m'], shellsFile: join(dir, 'shells.json'), seed: 'wire' }, { dir: join(dir, 'data') });
    try {
      const ctx = p2.app.ctx;
      assert.ok(ctx.traces && ctx.shells && ctx.runners);
      assert.equal(ctx.shells.traces, ctx.traces);
      assert.equal(ctx.runners.traces, ctx.traces);
    } finally {
      await p2.close();
    }
    const p1 = await boot({ physics: 2, premise: 1, shellSlots: 4, shellModels: ['m'], shellsFile: join(dir, 'shells.json'), seed: 'wire-1' }, { dir: join(dir, 'data1') });
    try {
      assert.equal(p1.app.ctx.traces, null);
      assert.equal(p1.app.ctx.shells.traces, undefined);
      assert.equal(p1.app.ctx.runners.traces, undefined);
    } finally {
      await p1.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════
// 管理员的居民私有视图
// ═══════════════════════════════════════════════════════════════

test('P2 T15 管理员的私有视图：第二前提里多了常驻指令的全文、触发记录与屏蔽名单；设定 1 与 0 的视图不变', async () => {
  const p2 = await boot({ physics: 2, premise: 2, shellSlots: 8, seed: 'priv-2' });
  const p1 = await boot({ physics: 2, premise: 1, shellSlots: 8, seed: 'priv-1' });
  try {
    const a = await p2.register('甲');
    const b = await p2.register('乙');
    const act = (token, actions) => p2.call('/api/me/act', { method: 'POST', token, body: { actions } });
    let r = await act(a.agentToken, [
      { type: 'standing', orders: [{ when: 'tick', if: 'me.energy > 1', do: [{ type: 'diary', text: '自动的日记' }], times: 5 }, { when: 'inbox:whisper', do: [{ type: 'say', text: '收到' }] }] },
      { type: 'mute', who: b.agentId },
      { type: 'mute', who: 'anonymous' },
    ]);
    assert.ok(r.json.results.every((x) => x.ok), JSON.stringify(r.json));
    p2.rt.tickNow();
    p2.rt.tickNow();
    const priv = await p2.call(`/api/admin/agents/${a.agentId}/private`, { admin: true });
    assert.equal(priv.status, 200);
    assert.deepEqual(priv.json.muted, [b.agentId, 'anonymous']);
    assert.equal(priv.json.standing.length, 2);
    assert.deepEqual(priv.json.standing[0], { index: 0, when: 'tick', if: 'me.energy > 1', do: [{ type: 'diary', text: '自动的日记' }], times: 5, untilDay: null, fired: 2, paidThrough: priv.json.standing[0].paidThrough });
    assert.deepEqual(priv.json.standing[1].do, [{ type: 'say', text: '收到' }]);
    assert.equal(priv.json.standing[1].fired, 0);
    assert.ok(priv.json.standingFired.length >= 2);
    assert.deepEqual(priv.json.standingFired[0].results, [{ type: 'diary', ok: true }]);
    assert.equal(priv.json.standingFired[0].trigger.when, 'tick');
    assert.deepEqual(Object.keys(priv.json.standingFired[0]), ['tick', 'order', 'trigger', 'results']);
    // 原有的字段都还在
    for (const k of ['agentId', 'name', 'soul', 'diary', 'thoughts', 'dreams', 'letters', 'memories', 'body']) assert.ok(k in priv.json, k);
    // 设定 1：没有这三项
    const x = await p1.register('丙');
    const old = await p1.call(`/api/admin/agents/${x.agentId}/private`, { admin: true });
    assert.equal(old.status, 200);
    for (const k of ['standing', 'standingFired', 'muted']) assert.equal(k in old.json, false, k);
    // 需要管理员密钥
    assert.equal((await p2.call(`/api/admin/agents/${a.agentId}/private`)).status, 401);
  } finally {
    await p2.close();
    await p1.close();
  }
});

// ═══════════════════════════════════════════════════════════════
// 观测站：指标页的「注意力与自动化」
// ═══════════════════════════════════════════════════════════════

test('P2 T15 观测站：第二前提的指标页多一节「注意力与自动化」——三条平均数的线（来自 /api/public/attention）与常驻指令；别的世界没有这一节；不请求时失败也不崩', async () => {
  const { installFakeDom } = await import('./fake-dom.js');
  const { renderMetrics2 } = await import('../public/e2-tabs.js');
  const { setLang } = await import('../public/i18n.js');
  const { STR } = await import('../public/e2-strings.js').catch(() => ({}));
  const dom = installFakeDom();
  const saved = globalThis.fetch;
  const requests = [];
  const day = (i) => ({
    day: `2026-10-0${i + 1}`, residents: 4, wakingsPerResident: 3 + i, turnsPerWaking: 2.5, looksPerWaking: 1.5 + i / 10, wakesPerResident: 0.5 * i, sections: { here: 600, laws: 400 },
  });
  const metrics = Array.from({ length: 6 }, (_, i) => ({ day: i, awake: 4, dormant: 0, standingOrders: i, standingFired: i * 2, wellCondition: 9000, output: 100, treasuryEnergy: 100, gini: 0.3 }));
  let attention = { ok: true, status: 200, body: { days: [...Array.from({ length: 5 }, (_, i) => day(i)), { day: '2026-10-06', residents: 0, wakingsPerResident: 0, turnsPerWaking: 0, looksPerWaking: 0, wakesPerResident: 0, sections: {} }] } };
  globalThis.fetch = async (path) => {
    requests.push(path);
    if (path.startsWith('/api/public/metrics')) return { ok: true, status: 200, json: async () => ({ metrics }) };
    if (path.startsWith('/api/public/attention')) return { ok: attention.ok, status: attention.status, json: async () => attention.body };
    throw new Error(`unexpected ${path}`);
  };
  const text = (n) => n.textContent;
  const render = async (premise) => {
    const root = document.createElement('div');
    dom.root.append(root);
    await renderMetrics2({ S: { state: { world: { premise } } } }, root);
    return root;
  };
  try {
    for (const lang of ['zh', 'en']) {
      setLang(lang);
      requests.length = 0;
      const p2 = await render(2);
      assert.ok(requests.includes('/api/public/attention?days=30'), '请求了注意力接口');
      const title = p2.querySelectorAll('h3.attention-title');
      assert.equal(title.length, 1);
      assert.equal(text(title[0]), lang === 'zh' ? '注意力与自动化' : 'Attention and automation');
      const captions = p2.querySelectorAll('figcaption').map(text);
      for (const want of lang === 'zh' ? ['每次醒来的轮数', '每次醒来看的次数', '每位居民每日被叫醒的次数', '常驻指令'] : ['Turns per waking', 'Looks per waking', 'Wakes per resident per day', 'Standing orders']) assert.ok(captions.includes(want), `${lang}: ${want}`);
      const base = (await render(1)).querySelectorAll('figure').length;
      assert.equal(p2.querySelectorAll('figure').length, base + 4, '多出四张图');
      assert.ok(!text(p2).includes('undefined') && !text(p2).includes('NaN'));
      // 没有数据的日子（residents 为 0）不画
      requests.length = 0;
      const p1 = await render(1);
      assert.ok(!requests.some((r) => r.startsWith('/api/public/attention')), '设定 1 不请求');
      assert.equal(p1.querySelectorAll('h3.attention-title').length, 0);
      const p0 = await render(0);
      assert.equal(p0.querySelectorAll('h3.attention-title').length, 0);
    }
    // 接口失败 / 没有数据：说明一句，常驻指令那张图照画
    setLang('zh');
    for (const bad of [{ ok: false, status: 404, body: { error: { code: 'not_found' } } }, { ok: true, status: 200, body: { days: [] } }, { ok: true, status: 200, body: {} }]) {
      attention = bad;
      const root = await render(2);
      assert.ok(text(root).includes('运行器还没有留下注意力的数据。'), JSON.stringify(bad));
      assert.equal(root.querySelectorAll('figure').length, (await render(1)).querySelectorAll('figure').length + 1, '只多常驻指令一张图');
    }
    void STR;
  } finally {
    globalThis.fetch = saved;
    setLang('zh');
    dom.restore();
  }
});
