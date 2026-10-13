// miniGame 0.3 界面：网站句式同源、事件流合并、换行规则、编年史拆分、未登录与审核中的降级。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { resolve, dirname } from 'node:path';
import { minigame } from './wechat-minigame-helpers.js';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../wechat/minigame/', import.meta.url));
const feed = require('../wechat/minigame/utils/feed.js');
const text = require('../wechat/minigame/ui/text.js');
const { parseChronicle } = require('../wechat/minigame/utils/chronicle.js');
const fmt = require('../wechat/minigame/utils/format.js');

const ctx = { font: '', measureText: s => ({ width: Array.from(s).reduce((w, c) => w + (/[\x00-\x7f]/.test(c) ? 8 : 16), 0) }) };
const state = {
  world: { premise: 6, ticksPerDay: 12, day: 7, tick: 85, cityName: '无名之城', humanCityName: { zh: '无名之城', en: 'The Nameless City' } },
  agents: [{ id: 'a1', name: '石序', status: 'awake', place: 'well' }, { id: 'a3', name: '问潮', status: 'awake', place: 'wilds' }],
  places: [{ id: 'well', name: '源井', displayName: { zh: '源井' } }, { id: 'wilds', name: '近郊回收地', displayName: { zh: '近郊回收地' } }, { id: 'scrapyard', name: '废车场', displayName: { zh: '废车场' } }, { id: 'library', name: '档案馆', displayName: { zh: '档案馆' } }],
  publicRoles: [{ id: 'chronicler', name: '载简', duty: '史官', place: 'library', status: 'on_duty' }],
};
const ev = (seq, tick, type, data, extra = {}) => Object.assign({ seq, tick, day: Math.floor(tick / 12), type, data }, extra);

test('the miniGame event text module is generated from the website templates and stays in sync', async () => {
  const { buildSharedModule, SHARED_TARGET } = await import('../wechat/scripts/shared.mjs');
  assert.equal(readFileSync(resolve(root, SHARED_TARGET), 'utf8'), await buildSharedModule(), 'run: node wechat/scripts/shared.mjs');
  const shared = require('../wechat/minigame/utils/shared-text.js');
  const i18n = await import('../public/i18n.js');
  i18n.setLang('zh'); i18n.setPremise(6);
  for (const e of [ev(1, 85, 'explore', { outcome: 'energy', amount: 7332 }, { agent: 'a3', place: 'scrapyard' }), ev(2, 85, 'gather', { materials: 7, stock: 0 }, { agent: 'a3', place: 'scrapyard' }), ev(3, 84, 'day', { day: 6, output: 1025200, population: { awake: 5 } })]) {
    assert.deepEqual(shared.describe(e, 6), i18n.describeEvent(e), e.type);
  }
  assert.equal(shared.CATEGORY_LABELS.speech, '言语');
  assert.equal(shared.LORE.district.waterworks, '水脉');
});

test('the feed groups by tick, merges a resident\'s actions, summarizes exploration and folds the day end', () => {
  const events = [
    ev(1, 84, 'rule_op', { scope: 'city', owner: 'l3', op: 'share', from: 'treasury', among: 2, each: { energy: 123024 } }),
    ev(2, 84, 'material_regrowth', { zone: 'scrapyard', added: 7 }),
    ev(3, 84, 'material_regrowth', { zone: 'wilds', added: 20 }),
    ev(4, 84, 'day', { day: 6, output: 1025200, population: { awake: 2 } }),
    ev(5, 84, 'gather', { materials: 7, stock: 0 }, { agent: 'a3', place: 'scrapyard' }),
    ev(6, 84, 'move', { from: 'scrapyard', to: 'wilds' }, { agent: 'a3', place: 'wilds' }),
    ev(7, 85, 'explore', { outcome: 'energy', amount: 7332 }, { agent: 'a3', place: 'scrapyard' }),
    ev(8, 85, 'explore', { outcome: 'energy', amount: 20163 }, { agent: 'a3', place: 'scrapyard' }),
    ev(9, 85, 'say', { text: '我在源井。' }, { agent: 'a1', place: 'well' }),
    ev(10, 85, 'give', { from: 'a1', to: 'treasury', energy: 400000, materials: 0 }, { agent: 'a1', place: 'well' }),
    ev(11, 85, 'role_reply', { publicRoleId: 'chronicler', name: '载简', text: '今日无事。', source: 'fixed' }, { place: 'library' }),
    ev(12, 85, 'admin', { op: 'pause' }),
  ];
  const items = feed.buildFeed(events, state);
  const plain = segs => segs.map(s => s.text).join('');
  assert.deepEqual(items.filter(i => i.kind === 'group').map(i => i.label), ['第 8 日 · 第 2 刻', '第 8 日 · 第 1 刻']);
  const day = items.find(i => i.kind === 'day');
  assert.equal(day.title, '第 7 日结束');
  assert.deepEqual(day.facts.map(f => f.label + ' ' + f.value), ['源井出能 102.5万', '公民各得 12.3万', '回收地补充物料 27']);
  assert.ok(!items.some(i => i.type === 'rule_op' || i.type === 'material_regrowth'), 'folded into the day card');
  const merged = items.find(i => i.kind === 'merged');
  assert.equal(merged.count, 2); assert.deepEqual(merged.lines.map(plain), ['在废车场采集了 7 物料（余 0）。', '从废车场走向近郊回收地。']);
  const explore = items.find(i => i.icon === 'explore');
  assert.equal(plain(explore.sentence), '问潮 在废车场探索 2 次，共得 2.7万 词元。');
  const say = items.find(i => i.type === 'say');
  assert.equal(plain(say.header), '石序 在 源井 说'); assert.equal(say.text, '我在源井。'); assert.equal(say.ai, true);
  assert.equal(plain(items.find(i => i.type === 'give').sentence), '石序 给了 公库 40万 词元。', 'no "以及 0 物料"');
  const role = items.find(i => i.type === 'role_reply');
  assert.equal(role.ai, false, 'fixed role text is not AI output'); assert.equal(role.actor.role, 'chronicler');
  assert.ok(!items.some(i => i.type === 'admin'), 'backstage events stay hidden');
  assert.ok(feed.buildFeed(events, state, 'speech').every(i => i.kind === 'group' || i.cat === 'speech'));
});

test('withheld text becomes a locked bubble and neutral names, never a wall of placeholders', () => {
  const hidden = JSON.parse(JSON.stringify(state).replaceAll('"石序"', '"内容审核中"').replaceAll('"源井"', '"内容审核中"'));
  const items = feed.buildFeed([ev(1, 85, 'say', { text: '内容审核中' }, { agent: 'a1', place: 'well' }), ev(2, 85, 'move', { from: 'well', to: 'wilds' }, { agent: 'a1', place: 'wilds' })], hidden);
  const say = items.find(i => i.type === 'say'), move = items.find(i => i.type === 'move');
  assert.equal(say.locked, true);
  const all = JSON.stringify(items.map(i => [i.header, i.sentence, i.text]));
  assert.ok(!all.includes('内容审核中'), all);
  assert.equal(move.sentence.map(s => s.text).join(''), '居民 1 从某处走向近郊回收地。');
});

test('line breaking keeps closing punctuation off the line start, keeps English words whole and clamps with an ellipsis', () => {
  const lines = text.wrap(ctx, '甲乙丙丁戊己，庚辛', 96, '16px x');
  assert.ok(lines.every(l => !/^[，。、]/.test(l)), JSON.stringify(lines));
  const words = text.wrap(ctx, '共采 scrapyard 的集合', 120, '16px y');
  assert.ok(words.some(l => l.includes('scrapyard')), JSON.stringify(words));
  const clamped = text.clamp(ctx, '一二三四五六七八九十一二三四五六七八九十', 80, '16px z', 2);
  assert.equal(clamped.lines.length, 2); assert.ok(clamped.truncated); assert.ok(clamped.lines[1].endsWith('…'));
  const rich = text.wrapRich(ctx, [{ text: '问潮', font: 'a' }, { text: ' 在废车场采集了 7 物料。', font: 'b' }], 120);
  assert.equal(rich.map(r => r.runs.map(x => x.text).join('')).join(''), '问潮 在废车场采集了 7 物料。');
});

test('chronicle days split into stats, items, quotes and the chronicler\'s line', () => {
  const day = parseChronicle({ day: 6, text: '【第 7 日】源井出能 1025200，公民各得 123024。\n晦衡 在废车场拾得遗物。\n晦衡 在废车场拾得遗物。\n是日，有人在光伏遗址说：「同意共采安排。」\n史官曰：无事。无事亦是史。' });
  assert.equal(day.title, '第 7 日'); assert.equal(day.stats, '源井出能 102.5万，公民各得 12.3万。');
  assert.deepEqual(day.items, [{ text: '晦衡 在废车场拾得遗物。', count: 2 }]);
  assert.deepEqual(day.quotes, [{ place: '光伏遗址', text: '同意共采安排。' }]);
  assert.equal(day.coda, '无事。无事亦是史。');
  assert.equal(parseChronicle({ day: 1, text: '内容审核中' }).locked, true);
  assert.deepEqual([fmt.compact(2572279), fmt.compact(460000), fmt.compact(7332), fmt.pct(9220), fmt.dayTick(7, 85, 12)], ['257.2万', '46万', '7,332', '92%', '第 8 日 · 第 2 刻']);
});

test('the city screen shows system names and no placeholders when the projection withholds resident text', () => {
  const modules = new Map(), timers = [];
  const measure = new Proxy({ measureText: s => ({ width: Array.from(s).length * 8 }) }, { get: (t, k) => k in t ? t[k] : () => {}, set: () => true });
  const wx = { createCanvas: () => ({ getContext: () => measure }), getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 3, statusBarHeight: 47, safeArea: { bottom: 810 } }), getStorageSync: () => '' };
  function load(path) {
    path = resolve(path);
    if (modules.has(path)) return modules.get(path).exports;
    const module = { exports: {} }; modules.set(path, module);
    runInNewContext('(function(require,module,exports){' + readFileSync(path, 'utf8') + '\n})', { wx, setTimeout: f => timers.push(f), clearTimeout() {}, console })(name => load(resolve(dirname(path), name + '.js')), module, module.exports);
    return module.exports;
  }
  const { SocietyGame } = load(resolve(root, 'society.js'));
  const g = new SocietyGame();
  g.tab = 'city'; g.wechatVerified = false;
  g.state = JSON.parse(JSON.stringify(state).replaceAll('"无名之城"', '"内容审核中"').replaceAll('"石序"', '"内容审核中"'));
  g.state.well = { condition: 9220, outputHistory: [1025200] }; g.state.treasury = { energy: 2572279 };
  g.map = { size: [1200, 900], places: [{ id: 'well', xy: [600, 700] }], streets: [], terrain: {} };
  g.events = [ev(1, 85, 'say', { text: '内容审核中' }, { agent: 'a1', place: 'well' })];
  g.render();
  const shown = g.blocks.map(b => b.text).join('\n');
  assert.ok(!shown.includes('内容审核中'), shown);
  assert.ok(shown.includes('登录后可阅读居民的言论'));
  assert.equal(g.page.top.title, '后人纪');
  assert.ok(g.hits.some(h => h.action.type === 'sheet' && h.action.id === 'well'));
});

test('clicking the privacy link opens the notice without granting consent', async () => {
  const { game: g } = minigame();
  g.tab = 'account'; g.render();
  const link = g.hits.find(h => h.action.type === 'about');
  assert.ok(link);
  await g.dispatch(g.hitAt(link.x + link.w / 2, link.y + link.h / 2).action);
  assert.equal(g.tab, 'about');
  assert.ok(!g.form.accepted);
});

test('leaving an input page clears secrets and ignores late keyboard completion', async () => {
  const { game: g, wx } = minigame();
  await g.start();
  g.tab = 'owner'; g.stack = ['account'];
  Object.assign(g.form, { apiKey: 'test-model-secret', password: 'test-password' });
  g.editing = 'apiKey';
  await g.dispatch({ type: 'back' });
  wx.emitKeyboardComplete({ value: 'late-secret' });
  assert.ok(!g.form.apiKey); assert.ok(!g.form.password); assert.equal(g.editing, '');
  g.tab = 'link'; g.editing = 'password'; g.form.password = 'another-secret';
  wx.emitHide(); wx.emitKeyboardConfirm({ value: 'late-password' });
  assert.ok(!g.form.password);
});

test('startup privacy is readable locally and returns to startup without any requests', async () => {
  const { game: g, wx, requests, timers } = minigame();
  await g.start();
  const link = g.hits.find(h => h.action.type === 'about');
  assert.ok(link, 'startup has a privacy link');
  await g.dispatch(link.action); assert.equal(g.tab, 'about');
  wx.emitHide(); await wx.emitShow();
  await g.dispatch({ type: 'tab', tab: 'city' }); assert.equal(g.tab, 'about');
  await g.dispatch({ type: 'back' }); assert.equal(g.tab, 'startup');
  assert.equal(requests.length, 0); assert.equal(timers.size, 0);
});

for (const outcome of ['success', 'network', 'timeout', 'unauthorized', 'malformed']) {
  test(`logout clears local credentials, private records and drafts before ${outcome} response`, async () => {
    const { game: g, wx, load } = minigame();
    const api = load(resolve(root, 'utils/api.js'));
    const stored = new Map([['houren.session:https://www.heirscity.site', 'fixture-session-token-1234567890']]);
    wx.getStorageSync = key => stored.get(key);
    wx.setStorageSync = (key, value) => stored.set(key, value);
    wx.removeStorageSync = key => stored.delete(key);
    api.restoreSession();
    let logout, nextCookie;
    wx.request = options => {
      if (options.url.endsWith('/api/account/logout')) logout = options;
      else { nextCookie = options.header.Cookie; options.success({ statusCode: 200, data: {} }); }
    };
    g.entered = true; g.tab = 'account'; g.state = structuredClone(state);
    g.user = { id: 'fixture-account', displayName: '造者' }; g.wechatVerified = true;
    g.owner = { agentId: 'a1', soul: 'private cached record' };
    g.linked = [{ agentId: 'a1' }]; g.created = [{ agentId: 'a1' }]; g.residentId = 'a1';
    Object.assign(g.form, { letter: 'private unsent letter', soul: 'private creation draft', apiKey: 'fixture-key', password: 'fixture-password', accepted: true });
    g.letterDraft = g.form.letter; g.createDraft = 'private serialized creation draft'; g.letterRequestId = 'fixture-letter-request'; g.createRequestId = 'fixture-create-request';
    const previousRead = g.beginRead('owner');
    const exiting = g.dispatch({ type: 'logout' });
    assert.ok(logout.header.Cookie.includes('houren_session='), 'the revocation request carries the original session');
    assert.equal(stored.size, 0, 'local credential is removed before the server responds');
    assert.equal(g.user, null); assert.equal(g.owner, null); assert.equal(g.residentId, '');
    assert.equal(g.linked.length, 0); assert.equal(g.created.length, 0); assert.equal(g.wechatVerified, false);
    assert.equal(Object.keys(g.form).length, 0, 'private drafts and consent do not survive account changes');
    assert.ok(!g.letterDraft && !g.createDraft && !g.letterRequestId && !g.createRequestId);
    assert.equal(g.readCurrent('owner', previousRead), false, 'late private reads cannot restore the previous account');
    await api.request('/api/wechat/status'); assert.ok(!nextCookie, 'later requests no longer send the session');
    if (outcome === 'success') logout.success({ statusCode: 200, data: { ok: true } });
    else if (outcome === 'malformed') logout.success({ statusCode: 200, data: {} });
    else if (outcome === 'unauthorized') logout.success({ statusCode: 401, data: { error: { code: 'unauthorized', message: '请先登录' } } });
    else logout.fail({ errMsg: outcome === 'timeout' ? 'request:fail timeout' : 'request:fail' });
    await exiting;
    assert.equal(g.user, null); assert.equal(g.owner, null); assert.equal(stored.size, 0);
    if (outcome === 'success') assert.match(g.notice, /已退出/);
    else assert.match(g.error, /本机已退出.*服务器会话撤销未确认/);
    assert.ok(!g.blocks.some(b => /private cached record|private unsent letter/.test(b.text || '')));
  });
}

test('resident speech has an AI label', () => {
  const { game: g } = minigame();
  g.tab = 'resident'; g.state = structuredClone(state);
  g.profile = { id: 'a1', agent: state.agents[0], events: [ev(1, 85, 'say', { text: '我的公开发言' }, { agent: 'a1' })], inscriptions: [{ id: 'i1', text: '我的铭刻' }] };
  g.render();
  assert.ok(g.blocks.some(b => /AI/.test(b.text)), 'AI attribution accompanies speech');
});

test('the inscriptions tab reads the public profile inscriptions', () => {
  const { game: g } = minigame();
  g.tab = 'resident'; g.state = structuredClone(state);
  g.profile = { id: 'a1', agent: state.agents[0], tab: 'inscriptions', inscriptions: [{ id: 'i1', text: '我的铭刻' }] };
  g.render();
  assert.ok(g.blocks.some(b => b.text === '我的铭刻'));
});

test('active residents sort by their latest action rather than lifetime speech', () => {
  const { game: g } = minigame();
  g.tab = 'residents'; g.state = structuredClone(state);
  Object.assign(g.state.agents[0], { lastActTick: 1, stats: { utterances: 100 } });
  Object.assign(g.state.agents[1], { lastActTick: 85, stats: { utterances: 1 } });
  g.render();
  const rows = g.blocks.filter(b => b.kind === 'row');
  assert.deepEqual(Array.from(rows, b => b.text), ['问潮', '石序']);
});

test('pending profile text retries the profile and preserves its tab and scroll', async () => {
  let reads = 0;
  const c = minigame({ respond: path => {
    if (path.startsWith('/api/wechat/public/agents/')) {
      const pending = ++reads === 1;
      return { agent: state.agents[0], memories: Array.from({ length: 40 }, () => ({ text: pending ? '内容审核中' : '已经通过的记忆' })), moderation: { pending: pending ? 1 : 0 } };
    }
    if (path.includes('/events?')) return { events: [] };
    return structuredClone(state);
  } });
  const g = c.game;
  g.entered = true; g.tab = 'city'; g.state = structuredClone(state); g.map = {}; g.wechatVerified = true; g.prefs.autoRefresh = false;
  await g.dispatch({ type: 'resident', id: 'a1' });
  g.profile.tab = 'memories'; g.invalidate(); g.render(); g.scroller().scrollTo(20);
  await c.fire(4000);
  assert.equal(reads, 2); assert.equal(g.profile.memories[0].text, '已经通过的记忆');
  assert.equal(g.profile.tab, 'memories');
  assert.equal(g.scroller().offset, 20);
  assert.equal(g.quickTries, 0); assert.equal(c.timers.size, 0);
});

test('a pending document and private resident record each refresh on their own page', async () => {
  for (const page of ['detail', 'owner']) {
    let reads = 0;
    const c = minigame({ respond: path => {
      if (path.includes('/docs/')) return { id: 'd1', title: '典籍', body: ++reads === 1 ? '内容审核中' : '已审核正文', moderation: { pending: reads === 1 ? 1 : 0 } };
      if (path.endsWith('/private')) return { diary: [{ text: ++reads === 1 ? '内容审核中' : '已审核日记' }], moderation: { pending: reads === 1 ? 1 : 0 } };
      if (path.includes('/residents/')) return { resident: { name: '居民' }, overview: {} };
      if (path.includes('/events?')) return { events: [] };
      return structuredClone(state);
    } });
    const g = c.game;
    g.entered = true; g.tab = 'city'; g.state = structuredClone(state); g.map = {}; g.wechatVerified = true; g.prefs.autoRefresh = false;
    await g.dispatch(page === 'detail' ? { type: 'detail', kind: 'doc', id: 'd1' } : { type: 'owner', id: 'a1' });
    await c.fire(4000);
    assert.equal(reads, 2, page);
    assert.equal(page === 'detail' ? g.detail.body : g.owner.diary[0].text, page === 'detail' ? '已审核正文' : '已审核日记');
    assert.equal(g.tab, page);
    assert.equal(c.timers.size, 0);
  }
});

test('the live countdown advances locally and stops in the background', async () => {
  const c = minigame(), g = c.game;
  await g.start(); g.entered = true; g.tab = 'city'; g.state = structuredClone(state);
  g.state.world.nextTickAt = 105000;
  g.invalidate(); g.render();
  assert.ok(c.drawn.includes('距下一刻 00:05'));
  c.setNow(102000); await c.fire(1000);
  assert.ok(c.drawn.includes('距下一刻 00:03'));
  assert.equal(c.requests.length, 0);
  c.wx.emitHide(); assert.equal(c.timers.size, 0);
});

test('event filters scroll horizontally without changing the feed or vertical position', async () => {
  const c = minigame(), g = c.game;
  g.entered = true; g.tab = 'city'; g.state = structuredClone(state);
  g.events = [ev(1, 85, 'say', { text: '发言' }, { agent: 'a1' }), ev(2, 85, 'give', { energy: 1 }), ev(3, 85, 'propose', {}), ev(4, 85, 'arrive', {}), ev(5, 85, 'inscribe', { text: '铭刻' }), ev(6, 85, 'built', {}), ev(7, 85, 'day', { day: 7 })];
  g.render(); g.scroller().scrollTo(500); g.render();
  const strip = g.horizontalAreas?.[0];
  assert.ok(strip, 'filter row registers a horizontal viewport');
  const before = g.scroller().offset;
  g.touchStart({ touches: [{ clientX: strip.x + 240, clientY: strip.y + 18 }] });
  c.setNow(100040);
  g.touchMove({ touches: [{ clientX: strip.x + 50, clientY: strip.y + 20 }] });
  assert.ok(g.filterScroller.offset > 0);
  g.touchEnd();
  assert.equal(g.feedFilter, 'all'); assert.equal(g.scroller().offset, before);
  assert.ok(g.hits.filter(h => h.action.type === 'filter').every(h => h.x >= strip.x && h.x + h.w <= strip.x + strip.w));
  const selected = g.hits.find(h => h.action.type === 'filter' && h.action.value !== 'all');
  assert.ok(selected);
  await g.dispatch(selected.action);
  assert.equal(g.feedFilter, selected.action.value);
});

test('unapproved profile stops after three quick retries even when auto refresh is disabled', async () => {
  let reads = 0;
  const c = minigame({ respond: path => {
    if (path.includes('/agents/')) { reads++; return { agent: state.agents[0], moderation: { pending: 1 } }; }
    if (path.includes('/events?')) return { events: [] };
    return structuredClone(state);
  } });
  const g = c.game;
  g.entered = true; g.tab = 'city'; g.state = structuredClone(state); g.map = {}; g.wechatVerified = true; g.prefs.autoRefresh = false;
  await g.dispatch({ type: 'resident', id: 'a1' });
  for (let i = 0; i < 3; i++) await c.fire(4000);
  assert.equal(reads, 4); assert.equal(c.timers.size, 0);
});

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

test('a refresh preserves a profile tab changed while its response is in flight', async () => {
  const pending = deferred(), requested = deferred(); let reads = 0;
  const c = minigame({ respond: path => {
    if (path.includes('/agents/')) {
      if (++reads === 2) { requested.resolve(); return pending.promise; }
      return { agent: state.agents[0] };
    }
    if (path.includes('/events?')) return { events: [] };
    return structuredClone(state);
  } });
  const g = c.game;
  g.entered = true; g.tab = 'city'; g.state = structuredClone(state); g.map = {}; g.prefs.autoRefresh = false;
  await g.dispatch({ type: 'resident', id: 'a1' });
  const refresh = g.refresh(); await requested.promise;
  await g.dispatch({ type: 'profileTab', value: 'thoughts' });
  pending.resolve({ agent: state.agents[0], thoughts: [{ text: '新独白' }] }); await refresh;
  assert.equal(g.profile.tab, 'thoughts');
});

test('late profile, document and private responses cannot replace a newly opened object', async () => {
  for (const page of ['resident', 'detail', 'owner']) {
    const pending = deferred(), requested = deferred(); let reads = 0;
    const response = id => page === 'resident' ? { agent: { id, name: id } } : page === 'detail' ? { id, title: id } : { resident: { name: id } };
    const c = minigame({ respond: path => {
      if (path.endsWith('/private')) return { diary: [{ text: '公开以外的记录' }] };
      if (path.endsWith('/a1')) {
        if (++reads === 2) { requested.resolve(); return pending.promise; }
        return response('a1');
      }
      if (path.endsWith('/a2')) return response('a2');
      if (path.includes('/events?')) return { events: [] };
      return structuredClone(state);
    } });
    const g = c.game;
    g.entered = true; g.tab = 'city'; g.state = structuredClone(state); g.map = {}; g.prefs.autoRefresh = false;
    const open = id => g.dispatch(page === 'detail' ? { type: 'detail', kind: 'doc', id } : { type: page, id });
    await open('a1');
    const refresh = g.refresh(); await requested.promise;
    await open('a2'); pending.resolve(response('a1')); await refresh;
    assert.equal(page === 'resident' ? g.profile.agent.id : page === 'detail' ? g.detail.id : g.owner.name, 'a2', page);
    if (page === 'owner') assert.equal(g.owner.agentId, 'a2');
  }
});

test('late chronicle responses cannot replace the newly selected month', async () => {
  const pending = deferred(), requested = deferred(); let reads = 0;
  const c = minigame({ respond: path => {
    if (path.includes('/chronicle?')) {
      if (++reads === 2) { requested.resolve(); return pending.promise; }
      return { chronicle: [{ day: path.includes('from=0') ? 0 : 24, text: path.includes('from=0') ? '旧月' : '新月' }] };
    }
    if (path.includes('/events?')) return { events: [] };
    const s = structuredClone(state); s.world.day = 30; return s;
  } });
  const g = c.game;
  g.entered = true; g.tab = 'city'; g.state = structuredClone(state); g.state.world.day = 30; g.map = {}; g.prefs.autoRefresh = false;
  await g.dispatch({ type: 'tab', tab: 'archive' });
  const refresh = g.refresh(); await requested.promise;
  await g.dispatch({ type: 'month', delta: -1 });
  pending.resolve({ chronicle: [{ day: 24, text: '晚到的新月' }] }); await refresh;
  assert.equal(g.chronicle[0].day, 0);
});

test('unchecked residents stay distinct in the feed without revealing their names', () => {
  const hidden = structuredClone(state);
  hidden.agents.forEach(a => { a.name = '内容审核中'; });
  const events = [ev(1, 85, 'say', { text: '内容审核中' }, { agent: 'a1' }), ev(2, 85, 'say', { text: '内容审核中' }, { agent: 'a3' })];
  const names = feed.buildFeed(events, hidden).filter(e => e.kind === 'bubble').map(e => e.actor.name);
  assert.equal(new Set(names).size, 2);
  assert.ok(!names.includes('一位居民'));
  assert.ok(!names.includes('石序'));
});

test('dense map labels remain visible and missing names get a readable neutral label', () => {
  const { game: g, drawn } = minigame();
  const places = Array.from({ length: 15 }, (_, i) => ({ id: 'p' + i, xy: [490 + (i % 5) * 90, 260 + Math.floor(i / 5) * 90], name: i === 0 ? '内容审核中' : '地点' + i, displayName: { zh: i === 0 ? '内容审核中' : '地点' + i } }));
  const result = g.cityMap.render({ map: { size: [1200, 900], places }, state: { places, agents: [] } }, 343, 257, 2, 1);
  for (const p of places.slice(1)) assert.ok(drawn.includes(p.name), p.name);
  assert.ok(drawn.some(t => t.includes('地名暂未显示')));
  assert.ok(!drawn.includes('内容审核中'));
  assert.equal(result.hits.filter(h => h.action.type === 'sheet').length, 15);
});

function paintAll(g) {
  g.render();
  for (let y = 0; y <= g.scroller().max + 300; y += 300) { g.scroller().scrollTo(y); g.render(); }
}

test('creation and management offer supplier presets and changing them clears secrets', async () => {
  const { game: g, drawn } = minigame();
  g.entered = true; g.tab = 'entry'; g.render();
  paintAll(g);
  assert.ok(drawn.includes('DeepSeek'));
  assert.ok(drawn.includes('智谱 GLM'));
  g.form.apiKey = 'previous-key';
  await g.dispatch({ type: 'preset', id: 'deepseek' });
  assert.equal(g.form.baseURL, 'https://api.deepseek.com');
  assert.equal(g.form.providerIndex, 0); assert.ok(g.form.model); assert.ok(!g.form.apiKey);
  await g.dispatch({ type: 'preset', id: 'glm', variant: 'coding' });
  assert.equal(g.form.baseURL, 'https://open.bigmodel.cn/api/coding/paas/v4');
  await g.dispatch({ type: 'preset', id: 'custom' });
  assert.equal(g.form.baseURL, ''); assert.equal(g.form.model, '');
  g.tab = 'owner'; g.owner = { name: '我的居民' }; g.invalidate(); g.render();
  drawn.length = 0; paintAll(g);
  assert.ok(drawn.includes('DeepSeek'));
});

test('supplier selection works against an old server and submits the selected provider settings', async () => {
  let submitted;
  const c = minigame({ respond: (path, options) => {
    if (path === '/api/wechat/model-presets') throw Error('old server');
    if (options.data?.op === 'test') { submitted = options.data.config; return { ok: true }; }
    return {};
  } });
  const g = c.game;
  g.entered = true; g.user = { id: 'u1' }; g.wechatVerified = true;
  await g.dispatch({ type: 'entry' });
  paintAll(g); assert.ok(c.drawn.includes('DeepSeek'));
  await g.dispatch({ type: 'preset', id: 'deepseek' });
  Object.assign(g.form, { apiKey: 'test-only-key', modelAccepted: true }); g.residentId = 'a1';
  await g.configureRunner(true);
  assert.equal(submitted.baseURL, 'https://api.deepseek.com');
  assert.equal(submitted.provider, 'openai'); assert.equal(submitted.model, g.form.model);
});

test('late supplier loading cannot reopen a creation page after navigating away', async () => {
  const pending = deferred(), requested = deferred();
  const c = minigame({ respond: path => {
    if (path === '/api/wechat/model-presets') { requested.resolve(); return pending.promise; }
    return {};
  } });
  const g = c.game;
  g.entered = true; g.tab = 'account'; g.state = structuredClone(state); g.user = { id: 'u1' }; g.wechatVerified = true;
  const entry = g.dispatch({ type: 'entry' }); await requested.promise;
  await g.dispatch({ type: 'tab', tab: 'city' });
  pending.resolve({}); await entry;
  assert.equal(g.tab, 'city');
});

// Deferred wx responses exercise the real API cookie jar and controller together.
function sessionRaceClient() {
  const c = minigame(), api = c.load(resolve(root, 'utils/api.js'));
  const key = 'houren.session:https://www.heirscity.site';
  const original = 'fixture-original-session-1234567890', current = 'fixture-current-session-1234567890';
  const storage = new Map([[key, original]]), pending = [], deferredPaths = new Set();
  c.wx.getStorageSync = name => storage.get(name);
  c.wx.setStorageSync = (name, value) => storage.set(name, value);
  c.wx.removeStorageSync = name => storage.delete(name);
  c.wx.login = options => options.success({ code: 'fixture-wechat-code' });
  api.restoreSession();
  c.wx.request = options => {
    const path = new URL(options.url).pathname;
    if (deferredPaths.has(path)) { pending.push({ path, options }); return; }
    let data = {};
    if (path === '/api/account') data = { user: { id: 'current-account' }, registrationOpen: false };
    if (path === '/api/wechat/status') data = { enabled: true, verified: true };
    if (path === '/api/wechat/residents') data = { managed: [], created: [] };
    if (path === '/api/account/logout') data = { ok: true };
    if (path.endsWith('/events')) data = { events: [] };
    if (path.endsWith('/state')) data = structuredClone(state);
    options.success({ statusCode: 200, data });
  };
  const g = c.game;
  g.entered = true; g.tab = 'account'; g.state = structuredClone(state); g.prefs.autoRefresh = false;
  g.user = { id: 'original-account' }; g.residentId = 'a1';
  return {
    ...c, api, storage, key, original, current, deferredPaths, pending,
    take(path) {
      const index = pending.findIndex(entry => entry.path === path);
      assert.notEqual(index, -1, 'expected a deferred request to ' + path);
      return pending.splice(index, 1)[0].options;
    },
    async login() {
      deferredPaths.add('/api/account/login');
      g.tab = 'link'; Object.assign(g.form, { accepted: true, username: 'fixture-user', password: 'fixture-password' });
      const action = g.dispatch({ type: 'auth' });
      this.take('/api/account/login').success({ statusCode: 200, data: { ok: true }, cookies: ['houren_session=' + current] });
      await action;
      assert.equal(g.error, ''); assert.equal(g.user.id, 'current-account');
      assert.equal(storage.get(key), current, 'ordinary login stores its session');
    },
    async cookie() {
      deferredPaths.add('/api/wechat/status');
      const request = api.request('/api/wechat/status');
      const options = this.take('/api/wechat/status');
      options.success({ statusCode: 200, data: {} }); await request;
      return options.header.Cookie;
    },
  };
}

test('session race: old owner 401 cannot clear a newly logged-in account session', async () => {
  const c = sessionRaceClient(), g = c.game;
  c.deferredPaths.add('/api/wechat/residents/a1'); c.deferredPaths.add('/api/wechat/residents/a1/private');
  const oldRead = g.loadOwner().catch(error => error);
  const detail = c.take('/api/wechat/residents/a1'), privateData = c.take('/api/wechat/residents/a1/private');
  c.deferredPaths.add('/api/account/logout');
  const exiting = g.dispatch({ type: 'logout' });
  const logout = c.take('/api/account/logout');
  assert.equal(logout.header.Cookie, 'houren_session=' + c.original);
  logout.success({ statusCode: 200, data: { ok: true }, cookies: ['houren_session=; Max-Age=0'] });
  await exiting; await c.login();
  privateData.success({ statusCode: 401, data: { error: { code: 'unauthorized' } } });
  detail.success({ statusCode: 200, data: { resident: { name: 'previous-private-resident' } } });
  assert.equal((await oldRead).status, 401);
  assert.equal(g.user.id, 'current-account'); assert.equal(g.owner, null);
  assert.equal(c.storage.get(c.key), c.current, 'a late old-account 401 preserves the new credential');
  assert.equal(await c.cookie(), 'houren_session=' + c.current);
});

test('session race: old owner cookies cannot resurrect credentials after controller logout', async () => {
  const c = sessionRaceClient(), g = c.game;
  c.deferredPaths.add('/api/wechat/residents/a1'); c.deferredPaths.add('/api/wechat/residents/a1/private');
  const oldRead = g.loadOwner();
  const detail = c.take('/api/wechat/residents/a1'), privateData = c.take('/api/wechat/residents/a1/private');
  await g.dispatch({ type: 'logout' });
  privateData.success({ statusCode: 200, data: { diary: [{ text: 'previous-private-diary' }] }, header: { 'Set-Cookie': 'houren_session=' + c.original } });
  detail.success({ statusCode: 200, data: { resident: { name: 'previous-private-resident' } } });
  assert.equal(await oldRead, false); assert.equal(g.owner, null); assert.equal(g.user, null);
  assert.equal(c.storage.has(c.key), false);
  assert.equal(await c.cookie(), undefined);
});

for (const outcome of ['cookie', 'unauthorized']) {
  test(`session race: old WeChat bind ${outcome} cannot replace a newer login`, async () => {
    const c = sessionRaceClient();
    c.deferredPaths.add('/api/wechat/login');
    const binding = c.api.loginWeChat(true).catch(error => error);
    await Promise.resolve(); await Promise.resolve();
    const bind = c.take('/api/wechat/login');
    assert.equal(bind.data.bindCurrent, true);
    await c.login();
    if (outcome === 'cookie') bind.success({ statusCode: 200, data: { ok: true }, cookies: ['houren_session=' + c.original] });
    else bind.success({ statusCode: 401, data: { error: { code: 'unauthorized' } } });
    await binding;
    assert.equal(c.game.user.id, 'current-account'); assert.equal(c.storage.get(c.key), c.current);
    assert.equal(await c.cookie(), 'houren_session=' + c.current);
  });
}

test('session race: late logout cookies cannot delete a newer WeChat login', async () => {
  const c = sessionRaceClient();
  c.deferredPaths.add('/api/account/logout'); c.deferredPaths.add('/api/wechat/login');
  const exiting = c.game.dispatch({ type: 'logout' });
  const logout = c.take('/api/account/logout');
  assert.equal(logout.header.Cookie, 'houren_session=' + c.original);
  const login = c.api.loginWeChat(false);
  await Promise.resolve(); await Promise.resolve();
  const exchange = c.take('/api/wechat/login');
  assert.equal(exchange.data.bindCurrent, false); assert.equal(exchange.header.Cookie, undefined);
  exchange.success({ statusCode: 200, data: { ok: true }, cookies: ['houren_session=' + c.current] });
  await login; await c.game.loadAccount();
  logout.success({ statusCode: 200, data: { ok: true }, cookies: ['houren_session=; Max-Age=0'] });
  await exiting;
  assert.equal(c.game.user.id, 'current-account'); assert.equal(c.storage.get(c.key), c.current);
  assert.equal(await c.cookie(), 'houren_session=' + c.current);
});

test('session race: delayed WeChat code after a session clear cannot begin a login exchange', async () => {
  const c = sessionRaceClient(); let callback;
  c.wx.login = options => { callback = options; };
  c.deferredPaths.add('/api/wechat/login');
  const login = c.api.loginWeChat(true).catch(error => error);
  c.api.clearSession();
  callback.success({ code: 'fixture-obsolete-code' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(c.pending.filter(entry => entry.path === '/api/wechat/login').length, 0, 'an obsolete code never starts an auth request');
  assert.equal(await c.cookie(), undefined);
  assert.match((await login).message, /会话/);
  assert.equal(c.storage.has(c.key), false);
});

test('session race: restoring a replacement session invalidates an old request', async () => {
  const c = sessionRaceClient(); c.deferredPaths.add('/api/wechat/residents/a1');
  const request = c.api.request('/api/account/residents/a1').catch(error => error);
  const old = c.take('/api/wechat/residents/a1');
  c.storage.set(c.key, c.current); c.api.restoreSession();
  old.success({ statusCode: 401, data: { error: { code: 'unauthorized' } } });
  assert.equal((await request).status, 401);
  assert.equal(c.storage.get(c.key), c.current);
  assert.equal(await c.cookie(), 'houren_session=' + c.current);
});

test('session race: a current session 401 still removes persisted and outgoing credentials', async () => {
  const c = sessionRaceClient(); await c.login();
  c.deferredPaths.add('/api/wechat/residents/a1');
  const request = c.api.request('/api/account/residents/a1').catch(error => error);
  c.take('/api/wechat/residents/a1').success({ statusCode: 401, data: { error: { code: 'unauthorized' } } });
  assert.equal((await request).status, 401); assert.equal(c.storage.has(c.key), false);
  assert.equal(await c.cookie(), undefined);
});

test('every withheld state produces neutral references and keeps its reason on bubbles and chronicle entries', () => {
  for (const [placeholder, reason] of [['内容审核中', 'pending'], ['内容未通过安全检查', 'rejected'], ['内容暂不可用', 'unavailable'], ['请微信登录后阅读', 'loginRequired'], ['内容暂未展示', 'withheld']]) {
    const hidden = structuredClone(state);
    hidden.agents[0].name = placeholder; hidden.places[0].name = placeholder; hidden.places[0].displayName.zh = placeholder;
    const items = feed.buildFeed([ev(1, 85, 'say', { text: placeholder }, { agent: 'a1', place: 'well' }), ev(2, 85, 'move', { from: 'well', to: 'wilds' }, { agent: 'a1' })], hidden);
    const say = items.find(i => i.type === 'say'), move = items.find(i => i.type === 'move');
    assert.equal(say.locked, true, reason); assert.equal(say.moderation, reason); assert.equal(say.text, '');
    assert.equal(move.sentence.map(s => s.text).join(''), '居民 1 从某处走向近郊回收地。');
    assert.ok(!JSON.stringify([say.header, move.sentence]).includes(placeholder), reason);
    const day = parseChronicle({ day: 1, text: placeholder });
    assert.equal(day.locked, true, reason); assert.equal(day.moderation, reason);
    assert.deepEqual(day.items, []); assert.deepEqual(day.quotes, []);
  }
});

test('refused and unavailable content shows accurate notices across city, resident and archive screens', () => {
  for (const [placeholder, notice] of [['内容未通过安全检查', '这段内容未通过安全检查'], ['内容暂不可用', '内容暂不可用，请稍后刷新'], ['请微信登录后阅读', '微信登录后可阅读这段内容'], ['内容暂未展示', '这段内容暂未展示']]) {
    for (const page of ['city', 'resident', 'memory', 'chronicle', 'doc', 'law', 'place']) {
      const c = minigame(), g = c.game;
      g.entered = true; g.state = structuredClone(state); g.wechatVerified = true;
      g.state.agents[0].name = placeholder;
      g.events = [ev(1, 85, 'say', { text: placeholder }, { agent: 'a1', place: 'well' })];
      if (page === 'city') g.tab = 'city';
      else if (page === 'resident' || page === 'memory') {
        g.tab = 'resident'; g.profile = { agent: g.state.agents[0], tab: page === 'memory' ? 'memories' : 'events', events: g.events, memories: [{ text: placeholder }] };
      } else if (page === 'chronicle') {
        g.tab = 'archive'; g.archiveTab = 'chronicle'; g.chronicle = [parseChronicle({ day: 1, text: placeholder })];
      } else {
        g.tab = 'detail'; g.detailKind = page; g.detail = { title: '测试档案', body: placeholder, text: placeholder, description: placeholder };
      }
      g.render();
      const shown = c.drawn.join('\n');
      assert.ok(shown.includes(notice), page + ': ' + shown);
      assert.ok(!shown.includes('审核中'), page + ': ' + shown);
      assert.ok(!shown.includes('名字正在审核'), page + ': ' + shown);
    }
  }
});

test('nonpending moderation states never schedule a rapid profile retry', async () => {
  for (const reason of ['rejected', 'unavailable', 'loginRequired', 'withheld']) {
    let reads = 0;
    const c = minigame({ respond: path => {
      if (path.includes('/agents/')) { reads++; return { agent: state.agents[0], moderation: { pending: 0, [reason]: 1 } }; }
      if (path.includes('/events?')) return { events: [] };
      return structuredClone(state);
    } });
    const g = c.game;
    g.entered = true; g.tab = 'city'; g.state = structuredClone(state); g.map = {}; g.wechatVerified = true; g.prefs.autoRefresh = false;
    await g.dispatch({ type: 'resident', id: 'a1' });
    assert.equal(g.pendingCount, 0); assert.equal(reads, 1); assert.equal(c.timers.size, 0, reason);
  }
});

test('all withheld place labels and avatar initials use neutral fallbacks while approved names remain visible', () => {
  for (const placeholder of ['内容审核中', '内容未通过安全检查', '内容暂不可用', '请微信登录后阅读', '内容暂未展示']) {
    const c = minigame(), g = c.game;
    const places = [{ id: 'p1', xy: [600, 450], name: placeholder, displayName: { zh: placeholder } }, { id: 'p2', xy: [850, 450], name: '已审核地点' }];
    const agents = [{ id: 'a1', name: placeholder, status: 'awake', place: 'p1' }, { id: 'a3', name: '石序', status: 'awake', place: 'p2' }];
    g.cityMap.render({ map: { size: [1200, 900], places }, state: { places, agents } }, 343, 257, 2, 1);
    assert.ok(c.drawn.includes('地名暂未显示'), placeholder);
    assert.ok(c.drawn.includes('已审核地点')); assert.ok(c.drawn.includes('石')); assert.ok(c.drawn.includes('居'));
    assert.ok(!c.drawn.includes(placeholder)); assert.ok(!c.drawn.includes(Array.from(placeholder)[0]), placeholder);
    const N = c.load(resolve(root, 'ui/nodes.js')), rendered = [];
    const context = new Proxy({ fillText: s => rendered.push(s) }, { get: (t, k) => k in t ? t[k] : () => {}, set: () => true });
    N.paintAvatar({ ctx: context }, { id: 'a1', name: placeholder }, 0, 0, 36);
    assert.deepEqual(rendered, ['居']);
    N.paintAvatar({ ctx: context }, { id: 'a3', name: '石序' }, 0, 0, 36);
    assert.deepEqual(rendered, ['居', '石']);
  }
});

test('upstream loginRequired exposes an explicit re-login while local verification and the website session remain valid', async () => {
  const c = sessionRaceClient(), g = c.game;
  g.wechatVerified = true; let logins = 0;
  c.wx.login = () => { logins++; };
  g.rememberModeration('resident', { moderation: { pending: 0, loginRequired: 1 } });
  paintAll(g);
  assert.ok(c.drawn.includes('重新微信登录'));
  assert.equal(g.wechatVerified, true); assert.equal(g.pendingCount, 0); assert.equal(logins, 0);
  assert.ok(g.blocks.some(b => b.kind === 'button' && b.action?.type === 'wechatLogin'));
  await g.dispatch({ type: 'wechatLogin' });
  assert.match(g.error, /同意隐私说明/);
  assert.equal(logins, 0, 'a click without consent does not request a platform code');
  assert.equal(c.storage.get(c.key), c.original); assert.equal(g.user.id, 'original-account');
  assert.equal(await c.cookie(), 'houren_session=' + c.original);
});

test('login-required counts replace each scope and logout clears every re-login hint', async () => {
  const c = sessionRaceClient(), g = c.game;
  g.wechatVerified = true;
  g.rememberModeration('resident', { moderation: { loginRequired: 2 } });
  g.rememberModeration('archive', { moderation: { loginRequired: 1 } });
  assert.equal(g.needsWechatLogin, true);
  g.rememberModeration('resident', { moderation: { pending: 0, loginRequired: 0 } });
  assert.equal(g.needsWechatLogin, true, 'another scope still requires login');
  g.rememberModeration('archive', { moderation: { pending: 0, loginRequired: 0 } });
  assert.equal(g.needsWechatLogin, false);
  g.rememberModeration('map', { moderation: { loginRequired: 3 } });
  await g.dispatch({ type: 'logout' });
  assert.equal(g.needsWechatLogin, false); assert.deepEqual(Object.keys(g.loginRequired), []);
});

test('consented re-login keeps account binding and clears old scopes before fetching the current world again', async () => {
  const c = sessionRaceClient(), g = c.game;
  g.wechatVerified = true; g.form.accepted = true;
  for (const scope of ['resident', 'owner', 'archive', 'map']) g.rememberModeration(scope, { moderation: { pending: 0, loginRequired: 1 } });
  c.deferredPaths.add('/api/wechat/login'); c.deferredPaths.add('/api/wechat/public/state');
  const login = g.dispatch({ type: 'wechatLogin' });
  await Promise.resolve(); await Promise.resolve();
  const exchange = c.take('/api/wechat/login');
  assert.equal(exchange.data.bindCurrent, true);
  assert.equal(exchange.header.Cookie, 'houren_session=' + c.original);
  exchange.success({ statusCode: 200, data: { ok: true }, cookies: ['houren_session=' + c.current] });
  for (let i = 0; i < 20 && !c.pending.some(r => r.path === '/api/wechat/public/state'); i++) await Promise.resolve();
  const fresh = c.take('/api/wechat/public/state');
  assert.equal(g.needsWechatLogin, false, 'old profile/archive/map hints do not survive successful login');
  assert.equal(fresh.header.Cookie, 'houren_session=' + c.current);
  fresh.success({ statusCode: 200, data: structuredClone(state) }); await login;
  assert.equal(g.error, ''); assert.equal(g.needsWechatLogin, false);
  assert.equal(g.wechatVerified, true); assert.equal(g.user.id, 'current-account');
  assert.equal(c.storage.get(c.key), c.current);
  g.invalidate(); g.render(); assert.ok(!g.blocks.some(b => b.text === '重新微信登录'));
});

test('re-login replaces an in-flight world refresh and ignores its late login-required response', async () => {
  const c = sessionRaceClient(), g = c.game;
  g.wechatVerified = true; g.form.accepted = true;
  c.deferredPaths.add('/api/wechat/public/events');
  const oldRefresh = g.refresh({ full: true }), oldEvents = c.take('/api/wechat/public/events');
  g.rememberModeration('resident', { moderation: { loginRequired: 1 } });
  c.deferredPaths.add('/api/wechat/login');
  const login = g.dispatch({ type: 'wechatLogin' });
  await Promise.resolve(); await Promise.resolve();
  c.take('/api/wechat/login').success({ statusCode: 200, data: { ok: true }, cookies: ['houren_session=' + c.current] });
  for (let i = 0; i < 30 && !c.pending.some(r => r.path === '/api/wechat/public/events'); i++) await Promise.resolve();
  assert.ok(c.pending.some(r => r.path === '/api/wechat/public/events'), 'successful login starts a fresh read while the obsolete request is still outstanding');
  const freshEvents = c.take('/api/wechat/public/events');
  assert.equal(freshEvents.header.Cookie, 'houren_session=' + c.current);
  freshEvents.success({ statusCode: 200, data: { events: [], moderation: { pending: 0, loginRequired: 0 } } });
  await login;
  assert.equal(g.needsWechatLogin, false); assert.equal(g.refreshing, false);
  oldEvents.success({ statusCode: 200, data: { events: [], moderation: { pending: 0, loginRequired: 9 } } });
  await oldRefresh;
  assert.equal(g.needsWechatLogin, false, 'a late old response cannot recreate the re-login hint');
  assert.equal(g.user.id, 'current-account'); assert.equal(c.storage.get(c.key), c.current);
});

test('owner headers and avatar initials never render moderation placeholders as resident names', () => {
  for (const name of ['内容审核中', '内容未通过安全检查', '内容暂不可用', '请微信登录后阅读', '内容暂未展示', '石序']) {
    const c = minigame(), g = c.game;
    g.entered = true; g.tab = 'owner'; g.state = structuredClone(state);
    g.owner = { agentId: 'a1', name, energy: 100, materials: 1 };
    g.render();
    if (name === '石序') { assert.ok(c.drawn.includes(name)); assert.ok(c.drawn.includes('石')); }
    else { assert.ok(!c.drawn.includes(name), name); assert.ok(c.drawn.includes('我的居民'), name); assert.ok(c.drawn.includes('居')); }
  }
});

for (const action of ['letter', 'create']) {
  test(`content 401 during ${action} keeps the website credential and draft, and offers explicit re-login`, async () => {
    const c = sessionRaceClient(), g = c.game;
    const path = action === 'letter' ? '/api/account/residents/a1/letter' : '/api/account/residents';
    g.tab = action === 'letter' ? 'owner' : 'entry'; g.wechatVerified = true;
    g.owner = { agentId: 'a1', name: '石序' };
    Object.assign(g.form, { letter: '未送出的家书', name: '新居民', bio: '未提交简介', soul: '未提交灵魂', entryAccepted: true });
    c.deferredPaths.add(path);
    const submitting = g.dispatch({ type: action }), request = c.take(path);
    const draft = JSON.stringify(g.form), requestId = request.data.requestId;
    const cachedDraft = action === 'letter' ? g.letterDraft : g.createDraft;
    request.success({ statusCode: 401, data: { error: { code: 'wechat_login_required', message: '微信访问记录已过期，请重新微信登录。' } } });
    await submitting;
    assert.equal(c.storage.get(c.key), c.original, 'content identity failure does not revoke the website credential');
    assert.equal(g.user.id, 'original-account'); assert.equal(g.wechatVerified, true);
    assert.equal(g.needsWechatLogin, true); assert.match(g.error, /微信/);
    assert.equal(JSON.stringify(g.form), draft);
    assert.equal(action === 'letter' ? g.letterRequestId : g.createRequestId, requestId);
    assert.equal(action === 'letter' ? g.letterDraft : g.createDraft, cachedDraft);
    assert.equal(await c.cookie(), 'houren_session=' + c.original);
    c.deferredPaths.delete('/api/wechat/status');
    await g.dispatch({ type: 'tab', tab: 'account' }); paintAll(g);
    assert.ok(c.drawn.includes('重新微信登录'));
    assert.equal(JSON.stringify(g.form), draft, 'visiting re-login leaves the draft intact');
    g.form.accepted = true; c.deferredPaths.add('/api/wechat/login');
    const login = g.dispatch({ type: 'wechatLogin' });
    await Promise.resolve(); await Promise.resolve();
    const exchange = c.take('/api/wechat/login');
    assert.equal(exchange.data.bindCurrent, true); assert.equal(exchange.header.Cookie, 'houren_session=' + c.original);
    exchange.success({ statusCode: 200, data: { ok: true }, cookies: ['houren_session=' + c.current] });
    await login;
    assert.equal(g.needsWechatLogin, false);
    assert.equal(action === 'letter' ? g.letterRequestId : g.createRequestId, requestId);
    assert.equal(action === 'letter' ? g.form.letter : g.form.soul, action === 'letter' ? '未送出的家书' : '未提交灵魂');
    g.tab = action === 'letter' ? 'owner' : 'entry';
    const retry = g.dispatch({ type: action }), repeated = c.take(path);
    assert.equal(repeated.data.requestId, requestId, 'retry reuses the idempotency identifier');
    assert.equal(repeated.header.Cookie, 'houren_session=' + c.current);
    repeated.success({ statusCode: 200, data: action === 'letter' ? { ok: true } : { agentId: 'a7' } });
    await retry; assert.equal(g.error, '');
    assert.equal(action === 'letter' ? g.letterRequestId : g.createRequestId, null);
  });
}

test('a late previous-session content 401 cannot mark a newer session for re-login', async () => {
  const c = sessionRaceClient(), g = c.game;
  g.wechatVerified = true; g.form.letter = '旧会话家书'; g.tab = 'owner';
  const path = '/api/account/residents/a1/letter'; c.deferredPaths.add(path);
  const old = g.dispatch({ type: 'letter' }), request = c.take(path);
  c.storage.set(c.key, c.current); c.api.restoreSession();
  request.success({ statusCode: 401, data: { error: { code: 'wechat_login_required', message: '旧访问记录过期' } } });
  await old;
  assert.equal(g.needsWechatLogin, false);
  assert.equal(c.storage.get(c.key), c.current); assert.equal(await c.cookie(), 'houren_session=' + c.current);
});

test('an obsolete account refresh finishing after re-login cannot erase the newer refresh failure', async () => {
  const c = sessionRaceClient(), g = c.game;
  g.wechatVerified = true; g.form.accepted = true;
  c.deferredPaths.add('/api/account');
  const oldRefresh = g.refresh({ full: true });
  for (let i = 0; i < 30 && !c.pending.some(r => r.path === '/api/account'); i++) await Promise.resolve();
  const oldAccount = c.take('/api/account');
  c.deferredPaths.add('/api/wechat/login');
  const login = g.dispatch({ type: 'wechatLogin' });
  await Promise.resolve(); await Promise.resolve();
  c.take('/api/wechat/login').success({ statusCode: 200, data: { ok: true }, cookies: ['houren_session=' + c.current] });
  for (let i = 0; i < 30 && !c.pending.some(r => r.path === '/api/account'); i++) await Promise.resolve();
  const newAccount = c.take('/api/account');
  assert.equal(newAccount.header.Cookie, 'houren_session=' + c.current);
  c.deferredPaths.add('/api/wechat/public/events');
  newAccount.success({ statusCode: 200, data: { user: { id: 'current-account' }, registrationOpen: false } });
  for (let i = 0; i < 30 && !c.pending.some(r => r.path === '/api/wechat/public/events'); i++) await Promise.resolve();
  c.take('/api/wechat/public/events').success({ statusCode: 503, data: { error: { code: 'unavailable', message: '新会话刷新失败，请稍后重试' } } });
  await login;
  assert.equal(g.error, '新会话刷新失败，请稍后重试');
  oldAccount.success({ statusCode: 200, data: { user: { id: 'original-account' }, registrationOpen: false } });
  await oldRefresh;
  assert.equal(g.error, '新会话刷新失败，请稍后重试', 'late page-specific reads must not clear a newer error');
  assert.equal(g.user.id, 'current-account'); assert.equal(c.storage.get(c.key), c.current);
  assert.equal(g.refreshing, false);
});
